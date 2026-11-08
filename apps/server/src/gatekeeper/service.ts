// The gatekeeper ("Torwache"): one list of file extensions that must never
// reach the library, written into the services that can block them, and a
// record of every download they kept out, so the indexer insights can count
// it against the indexer that sent it.
import {
  AdapterError,
  DEFAULT_EXTENSIONS,
  EXTENSION_PRESETS,
  buildFlow,
  compareList,
  normalizeIndexerName,
  parseBlockMessage,
  planList,
  uniqueExtensions,
  type BlockedDownload,
  type BlockReason,
  type ExtensionBlockStatus,
  type Flow,
  type TargetSync,
} from '@wardarr/core';
import { desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/index.js';
import { gatekeeperCatches, gatekeeperSettings, indexerGrabs } from '../db/schema.js';
import type { EventBus } from '../events/bus.js';
import type { InstanceRuntime } from '../instances/runtime.js';
import type { IndexerInsightsService } from '../indexers/insights/service.js';

const JOB = 'gatekeeper';
const COLLECT_MS = 15 * 60_000;
const STATUS_TTL_MS = 5 * 60_000;
const BACKFILL_DAYS = 30;
const KEEP_DAYS = 400;
const DAY = 86_400_000;
const HOUR = 3_600_000;

export type GatekeeperRange = '7d' | '30d' | '90d';
const RANGE_DAYS: Record<GatekeeperRange, number> = { '7d': 7, '30d': 30, '90d': 90 };

export interface GatekeeperConfig {
  extensions: string[];
  /** Instance id -> whether Wardarr writes the list there. */
  targets: Record<string, boolean>;
  sabAction: 'abort' | 'pause';
  /** Write the list again when a service lost it (for example after a Prowlarr sync). */
  autoRepair: boolean;
}

export const DEFAULT_GATEKEEPER_CONFIG: GatekeeperConfig = {
  extensions: [...DEFAULT_EXTENSIONS],
  targets: {},
  sabAction: 'abort',
  autoRepair: true,
};

interface GatekeeperState {
  /** What Wardarr added in each service, so it only ever takes back its own. */
  managed: Record<string, string[]>;
  /** Read up to here, per instance (ISO). */
  cursors: Record<string, string>;
  applied: Record<string, { at: string; error: string | null }>;
  lastRun: string | null;
}

const EMPTY_STATE: GatekeeperState = { managed: {}, cursors: {}, applied: {}, lastRun: null };

export interface GatekeeperTarget {
  instanceId: string;
  name: string;
  adapter: string;
  level: 'downloader' | 'arr';
  recommended: boolean;
  enabled: boolean;
  status: ExtensionBlockStatus | null;
  error: string | null;
  sync: TargetSync | 'error' | 'blocked';
  /** Wanted extensions the service could hold but does not. */
  missing: string[];
  /** Wanted extensions the service cannot block at all. */
  unreachable: string[];
  lastApplied: { at: string; error: string | null } | null;
}

export interface GatekeeperCatch {
  downloadId: string;
  name: string;
  at: string;
  extensions: string[];
  outcome: string;
  reason: string;
  seenBy: Array<{ instanceId: string; name: string; adapter: string }>;
  indexer: { key: string | null; name: string } | null;
}

export interface IndexerImpact {
  key: string;
  name: string;
  grabs: number;
  caught: number;
  rate: number | null;
  scoreWith: number | null;
  scoreWithout: number | null;
}

export interface GatekeeperView {
  configured: boolean;
  config: GatekeeperConfig;
  presets: typeof EXTENSION_PRESETS;
  targets: GatekeeperTarget[];
  range: GatekeeperRange;
  totals: { caught: number; previous: number; grabs: number; indexers: number };
  daily: Array<{ day: string; count: number }>;
  flow: Flow;
  impact: IndexerImpact[];
  recent: GatekeeperCatch[];
  lastRun: string | null;
}

const kindOf = (err: unknown) => (err instanceof AdapterError ? err.kind : 'badResponse');
const iso = (t: number) => new Date(t).toISOString();

const OUTCOME_RANK: Record<string, number> = { held: 0, skipped: 1, paused: 2, failed: 3, aborted: 4 };

export function normalizeConfig(input: Partial<GatekeeperConfig>): GatekeeperConfig {
  const targets: Record<string, boolean> = {};
  for (const [id, on] of Object.entries(input.targets ?? {})) if (typeof on === 'boolean') targets[id] = on;
  return {
    extensions: uniqueExtensions(input.extensions ?? DEFAULT_GATEKEEPER_CONFIG.extensions).slice(0, 200),
    targets,
    sabAction: input.sabAction === 'pause' ? 'pause' : 'abort',
    autoRepair: input.autoRepair !== false,
  };
}

export class GatekeeperService {
  private statusCache = new Map<
    string,
    { at: number; status: ExtensionBlockStatus | null; error: string | null }
  >();
  private collecting: Promise<void> | null = null;

  constructor(
    private readonly db: Db,
    private readonly runtime: InstanceRuntime,
    private readonly insights: IndexerInsightsService,
    private readonly bus: EventBus,
    private readonly log: FastifyBaseLogger,
    private readonly now: () => Date = () => new Date(),
  ) {
    runtime.onReload(() => {
      this.statusCache.clear();
      this.reschedule();
    });
    runtime.onPolled((row, snapshot, fresh) => {
      if (!fresh.has('queue') || !snapshot.queue || !this.configured()) return;
      this.recordQueue(row.id, snapshot.queue);
    });
  }

  // -------------------------------------------------------------- settings

  private row() {
    return this.db.select().from(gatekeeperSettings).where(eq(gatekeeperSettings.id, 1)).get();
  }

  configured(): boolean {
    return !!this.row();
  }

  config(): GatekeeperConfig {
    const stored = this.row()?.config as Partial<GatekeeperConfig> | undefined;
    return normalizeConfig({ ...DEFAULT_GATEKEEPER_CONFIG, ...stored });
  }

  private state(): GatekeeperState {
    return { ...EMPTY_STATE, ...((this.row()?.state ?? {}) as Partial<GatekeeperState>) };
  }

  private save(patch: { config?: GatekeeperConfig; state?: GatekeeperState }): void {
    const updatedAt = this.now().toISOString();
    const current = this.row();
    const config = (patch.config ?? current?.config ?? this.config()) as Record<string, unknown>;
    const state = (patch.state ?? current?.state ?? EMPTY_STATE) as unknown as Record<string, unknown>;
    this.db
      .insert(gatekeeperSettings)
      .values({ id: 1, config, state, updatedAt })
      .onConflictDoUpdate({ target: gatekeeperSettings.id, set: { config, state, updatedAt } })
      .run();
  }

  private patchState(fn: (s: GatekeeperState) => void): void {
    const s = this.state();
    fn(s);
    this.save({ state: s });
  }

  async saveConfig(input: Partial<GatekeeperConfig>): Promise<void> {
    const before = this.configured();
    const next = normalizeConfig({ ...this.config(), ...input });
    // Instances that no longer exist drop out of the target list.
    const known = new Set(this.eligible().map((e) => e.row.id));
    next.targets = Object.fromEntries(Object.entries(next.targets).filter(([id]) => known.has(id)));
    this.save({ config: next });
    if (!before) this.reschedule();
    await this.apply();
    this.publish();
  }

  // --------------------------------------------------------------- targets

  private eligible() {
    return this.runtime.snapshots().filter(({ row }) => {
      if (!row.enabled) return false;
      const a = this.runtime.adapter(row.id)?.adapter;
      return !!a?.extensionBlock && !!a.setExtensionBlock;
    });
  }

  private async status(
    id: string,
    force = false,
  ): Promise<{ status: ExtensionBlockStatus | null; error: string | null }> {
    const cached = this.statusCache.get(id);
    if (!force && cached && this.now().getTime() - cached.at < STATUS_TTL_MS) return cached;
    const entry = this.runtime.adapter(id);
    const read = entry?.adapter.extensionBlock?.bind(entry.adapter);
    if (!entry || !read) return { status: null, error: 'unsupported' };
    let result: { status: ExtensionBlockStatus | null; error: string | null };
    try {
      result = { status: await entry.gate.run(() => read()), error: null };
    } catch (err) {
      this.log.debug({ instance: id, err }, 'gatekeeper status failed');
      result = { status: null, error: kindOf(err) };
    }
    this.statusCache.set(id, { at: this.now().getTime(), ...result });
    return result;
  }

  async targets(force = false): Promise<GatekeeperTarget[]> {
    const config = this.config();
    const state = this.state();
    const list = await Promise.all(
      this.eligible().map(async ({ row, def }): Promise<GatekeeperTarget> => {
        const { status, error } = await this.status(row.id, force);
        const level = def.category === 'downloader' ? 'downloader' : 'arr';
        const enabled = config.targets[row.id] ?? false;
        let sync: GatekeeperTarget['sync'] = 'error';
        let missing: string[] = [];
        let unreachable: string[] = [];
        if (status) {
          const cmp = compareList(status.extensions, config.extensions, {
            active: status.active,
            possible: status.possible,
          });
          sync = status.blocker ? 'blocked' : cmp.sync;
          missing = cmp.missing;
          unreachable = cmp.unreachable;
          // SABnzbd blocks nothing while its action is off, even with a full list.
          if (sync === 'inSync' && status.action === 'off') sync = 'drift';
        }
        return {
          instanceId: row.id,
          name: row.name,
          adapter: def.id,
          level,
          recommended: level === 'downloader',
          enabled,
          status,
          error,
          sync,
          missing,
          unreachable,
          lastApplied: state.applied[row.id] ?? null,
        };
      }),
    );
    return list.sort(
      (a, b) =>
        Number(b.level === 'downloader') - Number(a.level === 'downloader') ||
        a.adapter.localeCompare(b.adapter) ||
        a.name.localeCompare(b.name),
    );
  }

  /**
   * Writes the list into every target that is switched on, and takes back
   * what Wardarr added in targets that were switched off.
   */
  async apply(only?: string[]): Promise<Array<{ instanceId: string; ok: boolean; error: string | null }>> {
    if (!this.configured()) return [];
    const config = this.config();
    const results: Array<{ instanceId: string; ok: boolean; error: string | null }> = [];
    for (const { row } of this.eligible()) {
      if (only && !only.includes(row.id)) continue;
      const enabled = config.targets[row.id] ?? false;
      const managed = this.state().managed[row.id] ?? [];
      if (!enabled && managed.length === 0) continue;
      const entry = this.runtime.adapter(row.id);
      const write = entry?.adapter.setExtensionBlock?.bind(entry.adapter);
      if (!entry || !write) continue;
      const at = this.now().toISOString();
      try {
        const { status, error } = await this.status(row.id, true);
        if (!status) throw new AdapterError('badResponse', error ?? 'no status');
        if (status.blocker && enabled) throw new AdapterError('unsupported', status.blocker);
        const possible = status.possible ? new Set(status.possible) : null;
        const wanted = enabled ? config.extensions.filter((e) => !possible || possible.has(e)) : [];
        const plan = planList(status.extensions, managed, wanted);
        const after = await entry.gate.run(() =>
          write({ extensions: wanted, remove: plan.removed, action: config.sabAction }),
        );
        this.statusCache.set(row.id, { at: this.now().getTime(), status: after, error: null });
        this.patchState((s) => {
          s.managed[row.id] = plan.managed;
          s.applied[row.id] = { at, error: null };
        });
        results.push({ instanceId: row.id, ok: true, error: null });
      } catch (err) {
        const kind = err instanceof AdapterError && err.kind === 'unsupported' ? err.message : kindOf(err);
        this.log.warn({ instance: row.id, err }, 'gatekeeper could not write the block list');
        this.patchState((s) => {
          s.applied[row.id] = { at, error: kind };
        });
        results.push({ instanceId: row.id, ok: false, error: kind });
      }
    }
    if (results.length) this.publish();
    return results;
  }

  // -------------------------------------------------------------- catches

  private reschedule(): void {
    const scheduler = this.runtime.schedulerRef;
    if (!scheduler) return;
    scheduler.cancel(JOB);
    if (!this.configured()) return;
    scheduler.schedule(JOB, COLLECT_MS, () => this.collect(), 20_000);
  }

  collect(): Promise<void> {
    if (!this.collecting) {
      this.collecting = this.runCollect().finally(() => {
        this.collecting = null;
      });
    }
    return this.collecting;
  }

  private async runCollect(): Promise<void> {
    if (!this.configured()) return;
    const now = this.now().getTime();
    for (const { row } of this.runtime.snapshots()) {
      if (!row.enabled) continue;
      const entry = this.runtime.adapter(row.id);
      if (!entry) continue;
      const cursor = this.state().cursors[row.id];
      // Overlap an hour so late entries are not missed; writes are idempotent.
      const since = iso(cursor ? Date.parse(cursor) - HOUR : now - BACKFILL_DAYS * DAY);
      try {
        const blocked = entry.adapter.blockedDownloads?.bind(entry.adapter);
        const history = entry.adapter.historySince?.bind(entry.adapter);
        if (blocked) {
          for (const b of await entry.gate.run(() => blocked(since))) this.record(row.id, b, 'list');
        } else if (history && entry.def.category === 'arr') {
          const events = await entry.gate.run(() => history(since));
          for (const e of events) {
            if (e.type !== 'failed' || !e.downloadId) continue;
            const parsed = parseBlockMessage(e.message);
            if (!parsed) continue;
            this.record(
              row.id,
              {
                downloadId: e.downloadId,
                name: e.sourceTitle ?? e.downloadId,
                at: e.at,
                extensions: parsed.extensions,
                outcome: 'failed',
              },
              parsed.reason,
            );
          }
        } else continue;
        this.patchState((s) => {
          s.cursors[row.id] = iso(now);
        });
      } catch (err) {
        this.log.debug({ instance: row.id, err }, 'gatekeeper could not read blocked downloads');
      }
    }
    this.db
      .delete(gatekeeperCatches)
      .where(lt(gatekeeperCatches.at, iso(now - KEEP_DAYS * DAY)))
      .run();
    const config = this.config();
    if (config.autoRepair) {
      const drifting = (await this.targets(true)).filter((t) => t.enabled && t.sync === 'drift');
      if (drifting.length) await this.apply(drifting.map((t) => t.instanceId));
    }
    this.patchState((s) => {
      s.lastRun = iso(now);
    });
    this.publish();
  }

  /** Imports an *arr app holds back because of a blocked file. */
  private recordQueue(
    instanceId: string,
    queue: NonNullable<ReturnType<InstanceRuntime['snapshots']>[number]['snapshot']['queue']>,
  ): void {
    let changed = false;
    for (const item of queue) {
      if (!item.downloadId) continue;
      const parsed = [...(item.statusMessages ?? []), item.errorMessage ?? '']
        .map(parseBlockMessage)
        .filter((p): p is NonNullable<typeof p> => !!p);
      if (parsed.length === 0) continue;
      changed =
        this.record(
          instanceId,
          {
            downloadId: item.downloadId,
            name: item.title,
            at: item.added ?? this.now().toISOString(),
            extensions: uniqueExtensions(parsed.flatMap((p) => p.extensions)),
            outcome: item.state === 'failed' ? 'failed' : 'held',
          },
          parsed[0]!.reason,
        ) || changed;
    }
    if (changed) this.publish();
  }

  /** Stores a catch, merging with what other services reported for the same download. */
  record(instanceId: string, b: BlockedDownload, reason: BlockReason | 'list'): boolean {
    const id = b.downloadId.toLowerCase();
    const existing = this.db
      .select()
      .from(gatekeeperCatches)
      .where(eq(gatekeeperCatches.downloadId, id))
      .get();
    const extensions = uniqueExtensions([...(existing?.extensions ?? []), ...b.extensions]);
    const seenBy = [...new Set([...(existing?.seenBy ?? []), instanceId])];
    const outcome =
      existing && (OUTCOME_RANK[existing.outcome] ?? 0) >= (OUTCOME_RANK[b.outcome] ?? 0)
        ? existing.outcome
        : b.outcome;
    const at = existing && existing.at < b.at ? existing.at : b.at;
    const keepReason = existing && existing.reason !== 'unwanted' && existing.reason !== 'list';
    const values = {
      downloadId: id,
      name: (existing?.name && existing.name !== existing.downloadId ? existing.name : b.name).slice(0, 300),
      at,
      extensions,
      seenBy,
      outcome,
      reason: keepReason ? existing.reason : reason,
    };
    if (
      existing &&
      existing.outcome === values.outcome &&
      existing.extensions.join() === extensions.join() &&
      existing.seenBy.join() === seenBy.join() &&
      existing.at === at &&
      existing.reason === values.reason
    )
      return false;
    this.db
      .insert(gatekeeperCatches)
      .values(values)
      .onConflictDoUpdate({ target: gatekeeperCatches.downloadId, set: values })
      .run();
    return true;
  }

  private publish(): void {
    this.bus.publish({ type: 'gatekeeper.updated', audience: 'admin' });
  }

  // ------------------------------------------------------------------ view

  async view(range: GatekeeperRange, timeZone: string, refresh = false): Promise<GatekeeperView> {
    const now = this.now().getTime();
    const days = RANGE_DAYS[range];
    const from = now - days * DAY;
    const prevFrom = from - days * DAY;
    const rows = this.db
      .select()
      .from(gatekeeperCatches)
      .where(gte(gatekeeperCatches.at, iso(prevFrom)))
      .orderBy(desc(gatekeeperCatches.at))
      .all();
    const current = rows.filter((r) => r.at >= iso(from));
    const previous = rows.length - current.length;

    // Which indexer sent each download, from the *arr grab history.
    const ids = current.map((r) => r.downloadId);
    const grabs = new Map<string, { instanceId: string; indexer: string }>();
    for (let i = 0; i < ids.length; i += 400) {
      const chunk = ids.slice(i, i + 400);
      const found = this.db
        .select({
          downloadId: indexerGrabs.downloadId,
          instanceId: indexerGrabs.instanceId,
          indexer: indexerGrabs.indexer,
        })
        .from(indexerGrabs)
        .where(inArray(sql`lower(${indexerGrabs.downloadId})`, chunk))
        .all();
      for (const g of found)
        grabs.set(g.downloadId.toLowerCase(), { instanceId: g.instanceId, indexer: g.indexer });
    }

    const report = this.insights.report(range, timeZone, refresh);
    const byNorm = new Map(report.trackers.map((t) => [normalizeIndexerName(t.name), t]));
    const trackerFor = (indexer: string) => byNorm.get(normalizeIndexerName(indexer)) ?? null;

    const names = new Map(
      this.runtime.snapshots().map(({ row, def }) => [row.id, { name: row.name, adapter: def.id }]),
    );
    const catches: GatekeeperCatch[] = current.map((r) => {
      const g = grabs.get(r.downloadId);
      const tracker = g ? trackerFor(g.indexer) : null;
      return {
        downloadId: r.downloadId,
        name: r.name,
        at: r.at,
        extensions: r.extensions,
        outcome: r.outcome,
        reason: r.reason,
        seenBy: r.seenBy.map((id) => ({
          instanceId: id,
          name: names.get(id)?.name ?? id,
          adapter: names.get(id)?.adapter ?? '',
        })),
        indexer: g ? { key: tracker?.key ?? null, name: tracker?.name ?? g.indexer } : null,
      };
    });

    const grabsByIndexer = new Map(
      report.trackers.map((t) => [t.key, { name: t.name, grabs: t.metrics.arrGrabs }]),
    );
    const flow = buildFlow(
      catches.map((c) => ({
        indexerKey: c.indexer ? (c.indexer.key ?? `n:${c.indexer.name}`) : null,
        indexerName: c.indexer?.name ?? null,
        extensions: c.extensions,
      })),
      grabsByIndexer,
    );

    const impact: IndexerImpact[] = report.trackers
      .filter((t) => t.metrics.arrGrabs > 0 || t.metrics.caught > 0)
      .map((t) => ({
        key: t.key,
        name: t.name,
        grabs: t.metrics.arrGrabs,
        caught: t.metrics.caught,
        rate: t.metrics.arrGrabs > 0 ? t.metrics.caught / t.metrics.arrGrabs : null,
        scoreWith: t.metrics.score,
        scoreWithout: t.metrics.scoreWithoutClean,
      }))
      .sort(
        (a, b) =>
          b.caught - a.caught ||
          (b.scoreWithout ?? 0) - (b.scoreWith ?? 0) - ((a.scoreWithout ?? 0) - (a.scoreWith ?? 0)) ||
          a.name.localeCompare(b.name),
      );

    const daily = new Map<string, number>();
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    for (let t = from + DAY; t <= now + 1; t += DAY) daily.set(fmt.format(t), 0);
    for (const c of current) {
      const day = fmt.format(Date.parse(c.at));
      if (daily.has(day)) daily.set(day, daily.get(day)! + 1);
    }

    return {
      configured: this.configured(),
      config: this.config(),
      presets: EXTENSION_PRESETS,
      targets: await this.targets(refresh),
      range,
      totals: {
        caught: current.length,
        previous,
        grabs: report.trackers.reduce((s, t) => s + t.metrics.arrGrabs, 0),
        indexers: new Set(catches.filter((c) => c.indexer).map((c) => c.indexer!.key ?? c.indexer!.name))
          .size,
      },
      daily: [...daily.entries()].map(([day, count]) => ({ day, count })),
      flow,
      impact,
      recent: catches.slice(0, 50),
      lastRun: this.state().lastRun,
    };
  }
}
