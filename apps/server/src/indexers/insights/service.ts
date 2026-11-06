// Indexer insights: collects Prowlarr statistics per hour, indexer outages
// and *arr grab history into SQLite, and works out where each app's indexers
// come from (synced by Prowlarr or added by hand).
import {
  AdapterError,
  analyzeSources,
  planStatsWindows,
  type ArrIndexerInfo,
  type ArrSide,
  type IndexerApp,
  type IndexerInfo,
  type IndexerStatsWindow,
  type ProwlarrSide,
  type SourceAnalysis,
} from '@wardarr/core';
import { and, eq, lt, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../../db/index.js';
import {
  indexerAgentBuckets,
  indexerGrabs,
  indexerSourceDaily,
  indexerStatBuckets,
  indexerStatusLog,
} from '../../db/schema.js';
import type { EventBus } from '../../events/bus.js';
import type { FeatureStore } from '../../features/store.js';
import type { InstanceRuntime } from '../../instances/runtime.js';
import { buildReport, type InsightsRange, type InsightsReport } from './report.js';

const FEATURE = 'indexerInsights';
const COLLECT_MS = 15 * 60_000;
const SOURCES_TTL_MS = 5 * 60_000;
const HISTORY_BACKFILL_DAYS = 30;
/** Hourly rows older than this are folded into daily rows. */
const HOURLY_KEEP_DAYS = 35;
const KEEP_DAYS = 400;
const DAY = 86_400_000;
const HOUR = 3_600_000;

interface CollectState {
  /** Start of the next Prowlarr window to read (ISO). */
  statsCursor: string | null;
  /** History read up to here (ISO). */
  historyCursor: string | null;
  lastRunAt: string | null;
  error: string | null;
}

const EMPTY: CollectState = { statsCursor: null, historyCursor: null, lastRunAt: null, error: null };

export interface SourcesSnapshot {
  at: number;
  analysis: SourceAnalysis;
  prowlarrs: Array<ProwlarrSide & { error: string | null }>;
  arrs: Array<ArrSide & { error: string | null; webUrl: string | null }>;
}

const kindOf = (err: unknown) => (err instanceof AdapterError ? err.kind : 'badResponse');
const iso = (t: number) => new Date(t).toISOString();

export class IndexerInsightsService {
  private sources: SourcesSnapshot | null = null;
  private sourcesInflight: Promise<SourcesSnapshot> | null = null;
  private collecting: Promise<void> | null = null;
  private lastStatus = new Map<string, boolean>();
  private statusLoaded = new Set<string>();
  private lastMaintenance = 0;

  constructor(
    private readonly db: Db,
    private readonly features: FeatureStore,
    private readonly runtime: InstanceRuntime,
    private readonly bus: EventBus,
    private readonly log: FastifyBaseLogger,
    private readonly now: () => Date = () => new Date(),
  ) {
    runtime.onReload(() => {
      this.sources = null;
      this.reschedule();
    });
    runtime.onPolled((row, snapshot, fresh) => {
      if (fresh.has('indexers') && snapshot.indexers) this.recordStatus(row.id, snapshot.indexers);
    });
  }

  // ------------------------------------------------------------ eligibility

  prowlarrInstances() {
    return this.runtime
      .snapshots()
      .filter(
        ({ row, def }) => row.enabled && def.category === 'indexer' && def.capabilities.includes('indexers'),
      );
  }

  arrInstances() {
    return this.runtime.snapshots().filter(({ row, def }) => {
      if (!row.enabled || def.category !== 'arr') return false;
      const a = this.runtime.adapter(row.id)?.adapter;
      return !!a?.arrIndexers;
    });
  }

  private reschedule(): void {
    const scheduler = this.runtime.schedulerRef;
    if (!scheduler) return;
    scheduler.cancel('indexerInsights');
    if (this.prowlarrInstances().length + this.arrInstances().length === 0) return;
    scheduler.schedule('indexerInsights', COLLECT_MS, () => this.collect(), 15_000);
  }

  // ------------------------------------------------------------- outages

  /** Remembers indexer state changes seen while polling Prowlarr. */
  recordStatus(instanceId: string, indexers: IndexerInfo[]): void {
    if (!this.statusLoaded.has(instanceId)) {
      const rows = this.db
        .select({
          indexerId: indexerStatusLog.indexerId,
          failing: indexerStatusLog.failing,
          at: indexerStatusLog.at,
        })
        .from(indexerStatusLog)
        .where(eq(indexerStatusLog.instanceId, instanceId))
        .orderBy(indexerStatusLog.at)
        .all();
      for (const r of rows) this.lastStatus.set(`${instanceId}:${r.indexerId}`, r.failing);
      this.statusLoaded.add(instanceId);
    }
    const at = this.now().toISOString();
    for (const ix of indexers) {
      const key = `${instanceId}:${ix.id}`;
      // A disabled indexer is not an outage.
      const failing = ix.enabled && ix.failing;
      if (this.lastStatus.get(key) === failing) continue;
      this.lastStatus.set(key, failing);
      // An outage noticed for the first time started at its most recent failure.
      const since =
        failing && ix.mostRecentFailure && !Number.isNaN(Date.parse(ix.mostRecentFailure))
          ? new Date(Math.min(Date.parse(ix.mostRecentFailure), Date.parse(at))).toISOString()
          : at;
      this.db
        .insert(indexerStatusLog)
        .values({ instanceId, indexerId: ix.id, indexerName: ix.name, at: since, failing })
        .run();
    }
  }

  // ----------------------------------------------------------- collecting

  /** Reads new statistics and history from every instance. */
  collect(): Promise<void> {
    if (!this.collecting) {
      this.collecting = this.doCollect().finally(() => {
        this.collecting = null;
      });
    }
    return this.collecting;
  }

  get isCollecting(): boolean {
    return this.collecting !== null;
  }

  private async doCollect(): Promise<void> {
    const tasks = [
      ...this.prowlarrInstances().map(({ row }) => this.collectProwlarr(row.id)),
      ...this.arrInstances().map(({ row }) => this.collectHistory(row.id)),
    ];
    await Promise.allSettled(tasks);
    try {
      const snap = await this.refreshSources(true);
      this.recordSourcesDaily(snap.analysis);
    } catch (err) {
      this.log.warn({ err }, 'indexer sources failed');
    }
    if (this.now().getTime() - this.lastMaintenance > DAY) {
      this.maintain();
      this.lastMaintenance = this.now().getTime();
    }
    this.bus.publish({ type: 'indexers.updated', audience: 'admin' });
  }

  private state(id: string): CollectState {
    return this.features.state(id, FEATURE, EMPTY);
  }

  private saveState(id: string, patch: Partial<CollectState>): void {
    this.features.saveState(id, FEATURE, { ...this.state(id), ...patch });
  }

  async collectProwlarr(id: string): Promise<void> {
    const entry = this.runtime.adapter(id);
    const read = entry?.adapter.indexerStatsWindow?.bind(entry.adapter);
    if (!entry || !read) return;
    const st = this.state(id);
    const now = this.now().getTime();
    const windows = planStatsWindows(st.statsCursor ? Date.parse(st.statsCursor) : null, now);
    let cursor = st.statsCursor;
    try {
      for (const w of windows) {
        const end = w.start + w.minutes * 60_000;
        const data = await entry.gate.run(() => read(iso(w.start), iso(end)));
        this.storeWindow(id, w.start, w.minutes, data);
        // The open hour is read again next time; finished windows are done.
        cursor = iso(end > now ? w.start : end);
      }
      this.saveState(id, { statsCursor: cursor, lastRunAt: iso(now), error: null });
    } catch (err) {
      this.saveState(id, { statsCursor: cursor, lastRunAt: iso(now), error: kindOf(err) });
      this.log.debug({ instance: id, err }, 'indexer stats failed');
    }
  }

  private storeWindow(instanceId: string, start: number, minutes: number, data: IndexerStatsWindow): void {
    const bucketStart = iso(start);
    this.db.transaction((tx) => {
      for (const s of data.indexers) {
        const any =
          s.queries + s.grabs + s.failedQueries + s.failedGrabs + (s.rssQueries ?? 0) + (s.authQueries ?? 0);
        if (any === 0) continue;
        const values = {
          instanceId,
          indexerId: s.indexerId,
          indexerName: s.name,
          bucketStart,
          bucketMinutes: minutes,
          queries: s.queries,
          grabs: s.grabs,
          failedQueries: s.failedQueries,
          failedGrabs: s.failedGrabs,
          rssQueries: s.rssQueries ?? 0,
          authQueries: s.authQueries ?? 0,
          avgResponseMs: s.averageResponseMs && s.queries > 0 ? s.averageResponseMs : null,
          avgGrabResponseMs: s.averageGrabResponseMs && s.grabs > 0 ? s.averageGrabResponseMs : null,
        };
        tx.insert(indexerStatBuckets)
          .values(values)
          .onConflictDoUpdate({
            target: [
              indexerStatBuckets.instanceId,
              indexerStatBuckets.indexerId,
              indexerStatBuckets.bucketStart,
            ],
            set: values,
          })
          .run();
      }
      for (const a of data.userAgents) {
        if (a.queries + a.grabs === 0) continue;
        const values = {
          instanceId,
          agent: a.agent.slice(0, 120),
          bucketStart,
          bucketMinutes: minutes,
          queries: a.queries,
          grabs: a.grabs,
        };
        tx.insert(indexerAgentBuckets)
          .values(values)
          .onConflictDoUpdate({
            target: [
              indexerAgentBuckets.instanceId,
              indexerAgentBuckets.agent,
              indexerAgentBuckets.bucketStart,
            ],
            set: values,
          })
          .run();
      }
    });
  }

  async collectHistory(id: string): Promise<void> {
    const entry = this.runtime.adapter(id);
    const read = entry?.adapter.historySince?.bind(entry.adapter);
    if (!entry || !read) return;
    const st = this.state(id);
    const now = this.now().getTime();
    // Overlap one hour so late writes are not missed; writes are idempotent.
    const since = st.historyCursor ? Date.parse(st.historyCursor) - HOUR : now - HISTORY_BACKFILL_DAYS * DAY;
    try {
      const events = await entry.gate.run(() => read(iso(since)));
      events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
      this.db.transaction((tx) => {
        for (const e of events) {
          if (!e.downloadId) continue;
          if (e.type === 'grabbed' && e.indexer) {
            tx.insert(indexerGrabs)
              .values({
                instanceId: id,
                downloadId: e.downloadId,
                indexer: e.indexer.slice(0, 200),
                grabbedAt: e.at,
                sizeBytes: e.sizeBytes ?? null,
              })
              .onConflictDoUpdate({
                target: [indexerGrabs.instanceId, indexerGrabs.downloadId],
                // A later grab of the same download starts over.
                set: {
                  indexer: sql`excluded.indexer`,
                  grabbedAt: sql`excluded.grabbed_at`,
                  sizeBytes: sql`excluded.size_bytes`,
                  importedAt: sql`case when excluded.grabbed_at > ${indexerGrabs.grabbedAt} then null else ${indexerGrabs.importedAt} end`,
                  failedAt: sql`case when excluded.grabbed_at > ${indexerGrabs.grabbedAt} then null else ${indexerGrabs.failedAt} end`,
                },
              })
              .run();
          } else if (e.type === 'imported' || e.type === 'failed') {
            const col = e.type === 'imported' ? indexerGrabs.importedAt : indexerGrabs.failedAt;
            tx.update(indexerGrabs)
              .set(
                e.type === 'imported'
                  ? { importedAt: sql`coalesce(${col}, ${e.at})` }
                  : { failedAt: sql`coalesce(${col}, ${e.at})` },
              )
              .where(and(eq(indexerGrabs.instanceId, id), eq(indexerGrabs.downloadId, e.downloadId)))
              .run();
          }
        }
      });
      this.saveState(id, { historyCursor: iso(now), lastRunAt: iso(now), error: null });
    } catch (err) {
      this.saveState(id, { lastRunAt: iso(now), error: kindOf(err) });
      this.log.debug({ instance: id, err }, 'indexer history failed');
    }
  }

  // -------------------------------------------------------------- sources

  /** Prowlarr apps and indexers plus every *arr app's own indexer list. */
  refreshSources(force = false): Promise<SourcesSnapshot> {
    const fresh = this.sources && this.now().getTime() - this.sources.at < SOURCES_TTL_MS;
    if (!force && fresh) return Promise.resolve(this.sources!);
    if (!this.sourcesInflight) {
      this.sourcesInflight = this.readSources().finally(() => {
        this.sourcesInflight = null;
      });
    }
    return this.sourcesInflight;
  }

  cachedSources(): SourcesSnapshot | null {
    return this.sources;
  }

  private async readSources(): Promise<SourcesSnapshot> {
    const prowlarrs = await Promise.all(
      this.prowlarrInstances().map(async ({ row, snapshot }) => {
        const entry = this.runtime.adapter(row.id);
        let error: string | null = null;
        let apps: IndexerApp[] = [];
        let indexers: IndexerInfo[] = snapshot.indexers ?? [];
        try {
          if (entry?.adapter.indexerApps) apps = await entry.gate.run(() => entry.adapter.indexerApps!());
          if (entry?.adapter.indexers) indexers = await entry.gate.run(() => entry.adapter.indexers!());
        } catch (err) {
          error = kindOf(err);
        }
        return { instanceId: row.id, instanceName: row.name, baseUrl: row.baseUrl, indexers, apps, error };
      }),
    );
    const arrs = await Promise.all(
      this.arrInstances().map(async ({ row, def }) => {
        const entry = this.runtime.adapter(row.id);
        let error: string | null = null;
        let indexers: ArrIndexerInfo[] | null = null;
        try {
          indexers = await entry!.gate.run(() => entry!.adapter.arrIndexers!());
        } catch (err) {
          error = kindOf(err);
        }
        return {
          instanceId: row.id,
          instanceName: row.name,
          adapter: def.id,
          baseUrl: row.baseUrl,
          indexers,
          error,
          webUrl: entry?.adapter.webUrl?.({ kind: 'indexer' }) ?? null,
        };
      }),
    );
    const analysis = analyzeSources(prowlarrs, arrs);
    this.sources = { at: this.now().getTime(), analysis, prowlarrs, arrs };
    return this.sources;
  }

  private recordSourcesDaily(analysis: SourceAnalysis): void {
    const day = this.now().toISOString().slice(0, 10);
    for (const r of analysis.arrs) {
      if (r.mode === 'unknown') continue;
      const values = {
        instanceId: r.instanceId,
        day,
        mode: r.mode,
        total: r.counts.total,
        synced: r.counts.synced,
        direct: r.counts.direct,
        duplicate: r.counts.duplicate,
        missing: r.counts.missing,
        orphan: r.counts.orphan,
      };
      this.db
        .insert(indexerSourceDaily)
        .values(values)
        .onConflictDoUpdate({ target: [indexerSourceDaily.instanceId, indexerSourceDaily.day], set: values })
        .run();
    }
  }

  // ---------------------------------------------------------- maintenance

  /** Folds old hourly rows into days and drops rows past the retention. */
  maintain(): void {
    const now = this.now().getTime();
    const foldBefore = iso(Math.floor((now - HOURLY_KEEP_DAYS * DAY) / DAY) * DAY);
    const dropBefore = iso(now - KEEP_DAYS * DAY);
    this.db.transaction((tx) => {
      tx.run(sql`
        CREATE TEMP TABLE IF NOT EXISTS fold_stats AS SELECT * FROM indexer_stat_buckets WHERE 0`);
      tx.run(sql`DELETE FROM fold_stats`);
      tx.run(sql`
        INSERT INTO fold_stats
        SELECT instance_id, indexer_id, max(indexer_name), substr(bucket_start, 1, 10) || 'T00:00:00.000Z', 1440,
          sum(queries), sum(grabs), sum(failed_queries), sum(failed_grabs), sum(rss_queries), sum(auth_queries),
          sum(avg_response_ms * queries) / nullif(sum(case when avg_response_ms is null then 0 else queries end), 0),
          sum(avg_grab_response_ms * grabs) / nullif(sum(case when avg_grab_response_ms is null then 0 else grabs end), 0)
        FROM indexer_stat_buckets
        WHERE bucket_minutes = 60 AND bucket_start < ${foldBefore}
        GROUP BY instance_id, indexer_id, substr(bucket_start, 1, 10)`);
      tx.run(
        sql`DELETE FROM indexer_stat_buckets WHERE bucket_minutes = 60 AND bucket_start < ${foldBefore}`,
      );
      tx.run(sql`INSERT OR REPLACE INTO indexer_stat_buckets SELECT * FROM fold_stats`);
      tx.run(sql`DELETE FROM fold_stats`);
      tx.run(sql`
        INSERT OR REPLACE INTO indexer_agent_buckets
        SELECT instance_id, agent, substr(bucket_start, 1, 10) || 'T00:00:00.000Z', 1440, sum(queries), sum(grabs)
        FROM indexer_agent_buckets
        WHERE bucket_minutes = 60 AND bucket_start < ${foldBefore}
        GROUP BY instance_id, agent, substr(bucket_start, 1, 10)`);
      tx.run(
        sql`DELETE FROM indexer_agent_buckets WHERE bucket_minutes = 60 AND bucket_start < ${foldBefore}`,
      );
      tx.delete(indexerStatBuckets).where(lt(indexerStatBuckets.bucketStart, dropBefore)).run();
      tx.delete(indexerAgentBuckets).where(lt(indexerAgentBuckets.bucketStart, dropBefore)).run();
      tx.delete(indexerGrabs).where(lt(indexerGrabs.grabbedAt, dropBefore)).run();
      tx.delete(indexerSourceDaily)
        .where(lt(indexerSourceDaily.day, dropBefore.slice(0, 10)))
        .run();
    });
    // Keep the newest state change before the cut, so an ongoing outage keeps its start.
    this.db.run(sql`
      DELETE FROM indexer_status_log WHERE at < ${dropBefore} AND id NOT IN (
        SELECT max(id) FROM indexer_status_log WHERE at < ${dropBefore} GROUP BY instance_id, indexer_id)`);
  }

  // --------------------------------------------------------------- report

  async report(range: InsightsRange, timeZone: string, refresh = false): Promise<InsightsReport> {
    if (refresh) await this.collect();
    const sources = await this.refreshSources(refresh);
    const states = [...this.prowlarrInstances(), ...this.arrInstances()].map(({ row }) => ({
      instanceId: row.id,
      ...this.state(row.id),
    }));
    return buildReport(this.db, {
      range,
      timeZone,
      now: this.now().getTime(),
      sources,
      states,
      collecting: this.isCollecting,
      prowlarrWebUrl: (id) => this.runtime.adapter(id)?.adapter.webUrl?.() ?? null,
      currentStatus: (instanceId, indexerId) =>
        this.prowlarrInstances()
          .find((p) => p.row.id === instanceId)
          ?.snapshot.indexers?.find((i) => i.id === indexerId) ?? null,
    });
  }
}
