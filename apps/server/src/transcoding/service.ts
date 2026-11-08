// Transcode servers (Tdarr). Wardarr records the server's running totals
// once per day for a history, remembers the nodes it saw so it notices when
// one goes away, follows the progress of every job to find stuck ones, and
// feeds what it finds into the issue center.
import {
  AdapterError,
  TRANSCODE_SOURCES,
  sourceKey,
  type InstanceRef,
  type Signal,
  type TranscodeFailure,
  type TranscodeLibrary,
  type TranscodeStatus,
} from '@wardarr/core';
import { and, asc, eq, gte, lt, ne } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { transcodeDaily, transcodeNodes } from '../db/schema.js';
import type { InstanceRuntime } from '../instances/runtime.js';
import type { InstanceRow } from '../instances/store.js';

const CHANNEL = 'transcoding';
const DETAIL_TTL_MS = 5 * 60_000;
const DAY_MS = 86_400_000;
/** A job whose progress does not move for this long counts as stuck. */
export const STUCK_MINUTES = 30;
/** Nodes missing for longer than this are forgotten, so their issue resolves. */
const FORGET_NODE_DAYS = 7;
/** A node may reconnect briefly; only then does it count as offline. */
const OFFLINE_GRACE_MS = 2 * 60_000;
const HISTORY_DAYS = 30;
const KEEP_DAYS = 400;
const FAILURE_LIMIT = 25;

interface JobTrack {
  progress: number;
  /** When the progress last changed. */
  since: number;
  node: string;
  file: string;
}

interface Detail {
  at: number;
  libraries: TranscodeLibrary[] | null;
  failures: TranscodeFailure[] | null;
  error: string | null;
}

export interface TranscodeDay {
  day: string;
  transcodes: number;
  healthChecks: number;
  failed: number;
  savedBytes: number;
}

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const kindOf = (err: unknown) => (err instanceof AdapterError ? err.kind : 'badResponse');

export class TranscodingService {
  private readonly jobs = new Map<string, Map<string, JobTrack>>();
  /** Instances whose last poll read the transcode status. */
  private readonly fresh = new Set<string>();
  private readonly details = new Map<string, Detail>();

  constructor(
    private readonly db: Db,
    private readonly runtime: InstanceRuntime,
    private readonly now: () => number = () => Date.now(),
  ) {
    runtime.onPolled((row, snapshot, fresh) => {
      if (fresh.has('transcoding') && snapshot.transcoding) {
        this.record(row, snapshot.transcoding);
        this.fresh.add(row.id);
      } else {
        this.fresh.delete(row.id);
      }
    });
    runtime.onReload(() => {
      const ids = new Set(this.eligible().map((e) => e.row.id));
      for (const id of [...this.jobs.keys()]) if (!ids.has(id)) this.jobs.delete(id);
      for (const id of [...this.fresh]) if (!ids.has(id)) this.fresh.delete(id);
      this.details.clear();
    });
    runtime.registerSignalSource(CHANNEL, () => this.signals());
  }

  private eligible() {
    return this.runtime
      .snapshots()
      .filter(({ row, def }) => row.enabled && def.capabilities.includes('transcoding'));
  }

  /** Stores what one poll saw: nodes, the day's totals and job progress. */
  record(row: Pick<InstanceRow, 'id'>, status: TranscodeStatus): void {
    const now = this.now();
    const at = new Date(now).toISOString();
    this.db.transaction((tx) => {
      for (const node of status.nodes) {
        // Tdarr gives a node a new session id each time it starts, so the
        // name is what stays the same: earlier sessions of a node that is
        // connected now are forgotten.
        tx.delete(transcodeNodes)
          .where(
            and(
              eq(transcodeNodes.instanceId, row.id),
              eq(transcodeNodes.name, node.name),
              ne(transcodeNodes.nodeId, node.id),
            ),
          )
          .run();
        tx.insert(transcodeNodes)
          .values({ instanceId: row.id, nodeId: node.id, name: node.name, firstSeenAt: at, lastSeenAt: at })
          .onConflictDoUpdate({
            target: [transcodeNodes.instanceId, transcodeNodes.nodeId],
            set: { name: node.name, lastSeenAt: at },
          })
          .run();
      }
      const forget = new Date(now - FORGET_NODE_DAYS * DAY_MS).toISOString();
      tx.delete(transcodeNodes)
        .where(and(eq(transcodeNodes.instanceId, row.id), lt(transcodeNodes.lastSeenAt, forget)))
        .run();

      const t = status.totals;
      if (t) {
        const values = {
          transcodes: t.transcodes,
          healthChecks: t.healthChecks,
          savedBytes: t.savedBytes,
          failedTranscodes: t.failed.transcode,
          failedHealthChecks: t.failed.healthCheck,
          queued: t.queued.transcode + t.queued.healthCheck,
        };
        tx.insert(transcodeDaily)
          .values({ instanceId: row.id, day: dayOf(now), ...values })
          .onConflictDoUpdate({ target: [transcodeDaily.instanceId, transcodeDaily.day], set: values })
          .run();
        tx.delete(transcodeDaily)
          .where(
            and(
              eq(transcodeDaily.instanceId, row.id),
              lt(transcodeDaily.day, dayOf(now - KEEP_DAYS * DAY_MS)),
            ),
          )
          .run();
      }
    });

    // Job progress: remember when each job last moved.
    const previous = this.jobs.get(row.id) ?? new Map<string, JobTrack>();
    const next = new Map<string, JobTrack>();
    for (const node of status.nodes) {
      for (const w of node.workers) {
        const key = `${node.id}\u0000${w.id}\u0000${w.file ?? ''}`;
        const before = previous.get(key);
        const moved = !before || Math.abs(before.progress - w.progress) > 0.0005;
        next.set(key, {
          progress: w.progress,
          since: moved ? now : before.since,
          node: node.name,
          file: w.file ?? '',
        });
      }
    }
    this.jobs.set(row.id, next);
  }

  /** Jobs of an instance that have not moved for `STUCK_MINUTES`. */
  private stuck(instanceId: string): Array<JobTrack & { key: string; minutes: number }> {
    const now = this.now();
    return [...(this.jobs.get(instanceId) ?? new Map<string, JobTrack>()).entries()]
      .map(([key, j]) => ({ ...j, key, minutes: Math.floor((now - j.since) / 60_000) }))
      .filter((j) => j.minutes >= STUCK_MINUTES);
  }

  /**
   * Nodes seen before that are not connected now. A node counts by its name:
   * Tdarr gives it a new session id on every start, so an older id of a node
   * that is connected again is not offline, and several old sessions of a
   * node that is away count once (the latest).
   */
  private offline(instanceId: string, status: TranscodeStatus) {
    const now = this.now();
    const connectedIds = new Set(status.nodes.map((n) => n.id));
    const connectedNames = new Set(status.nodes.map((n) => n.name));
    const latest = new Map<string, typeof transcodeNodes.$inferSelect>();
    for (const n of this.db
      .select()
      .from(transcodeNodes)
      .where(eq(transcodeNodes.instanceId, instanceId))
      .all()) {
      if (connectedIds.has(n.nodeId) || connectedNames.has(n.name)) continue;
      if (now - Date.parse(n.lastSeenAt) <= OFFLINE_GRACE_MS) continue;
      const seen = latest.get(n.name);
      if (!seen || n.lastSeenAt > seen.lastSeenAt) latest.set(n.name, n);
    }
    return [...latest.values()];
  }

  /** Failures added today, against the last counters of an earlier day. */
  private recentFailures(instanceId: string, status: TranscodeStatus): number {
    const t = status.totals;
    if (!t) return 0;
    const since = dayOf(this.now());
    const base = this.db
      .select()
      .from(transcodeDaily)
      .where(and(eq(transcodeDaily.instanceId, instanceId), lt(transcodeDaily.day, since)))
      .orderBy(asc(transcodeDaily.day))
      .all()
      .at(-1);
    if (!base) return 0;
    const now = t.failed.transcode + t.failed.healthCheck;
    return Math.max(0, now - base.failedTranscodes - base.failedHealthChecks);
  }

  signals(): { signals: Signal[]; checked: string[] } {
    const signals: Signal[] = [];
    const checked: string[] = [];
    for (const { row, def, snapshot } of this.eligible()) {
      const status = snapshot.transcoding;
      if (!status || !this.fresh.has(row.id) || snapshot.status === 'down') continue;
      checked.push(sourceKey('service', row.id, CHANNEL));
      const instance: InstanceRef = { id: row.id, name: row.name, adapter: def.id };
      const base = { origin: 'service' as const, instance, kind: 'health' as const, channel: CHANNEL };

      const offline = this.offline(row.id, status);
      for (const n of offline) {
        signals.push({
          ...base,
          source: TRANSCODE_SOURCES.nodeOffline,
          level: 'warning',
          message: `Node ${n.name} is offline`,
          data: { nodeId: n.nodeId, node: n.name, lastSeenAt: n.lastSeenAt },
        });
      }
      if (status.nodes.length === 0 && offline.length === 0) {
        signals.push({
          ...base,
          source: TRANSCODE_SOURCES.noNodes,
          level: 'warning',
          message: 'No node connected',
        });
      }

      const t = status.totals;
      if (t && t.failed.transcode + t.failed.healthCheck > 0) {
        signals.push({
          ...base,
          source: TRANSCODE_SOURCES.failedFiles,
          level: 'warning',
          message: `${t.failed.transcode} transcodes and ${t.failed.healthCheck} health checks failed`,
          data: {
            transcode: t.failed.transcode,
            healthCheck: t.failed.healthCheck,
            recent: this.recentFailures(row.id, status),
          },
        });
      }

      for (const j of this.stuck(row.id)) {
        signals.push({
          ...base,
          source: TRANSCODE_SOURCES.stuckJobs,
          level: 'warning',
          message: `${j.file} on ${j.node} has not moved for ${j.minutes} minutes`,
          data: { file: j.file, node: j.node, minutes: j.minutes, jobKey: j.key },
        });
      }
    }
    return { signals, checked };
  }

  /** Daily counts of the last `HISTORY_DAYS` days, oldest first, from the running totals. */
  history(instanceId: string): TranscodeDay[] {
    const now = this.now();
    const first = dayOf(now - HISTORY_DAYS * DAY_MS);
    const rows = this.db
      .select()
      .from(transcodeDaily)
      .where(and(eq(transcodeDaily.instanceId, instanceId), gte(transcodeDaily.day, first)))
      .orderBy(asc(transcodeDaily.day))
      .all();
    const byDay = new Map(rows.map((r) => [r.day, r]));
    const out: TranscodeDay[] = [];
    let prev: (typeof rows)[number] | undefined;
    for (let i = HISTORY_DAYS - 1; i >= 0; i--) {
      const day = dayOf(now - i * DAY_MS);
      const row = byDay.get(day);
      const delta = (a: number | undefined, b: number | undefined) =>
        a === undefined || b === undefined ? 0 : Math.max(0, a - b);
      out.push({
        day,
        transcodes: delta(row?.transcodes, prev?.transcodes),
        healthChecks: delta(row?.healthChecks, prev?.healthChecks),
        failed: delta(
          row && row.failedTranscodes + row.failedHealthChecks,
          prev && prev.failedTranscodes + prev.failedHealthChecks,
        ),
        savedBytes: row && prev ? row.savedBytes - prev.savedBytes : 0,
      });
      if (row) prev = row;
    }
    return out;
  }

  private async detail(instanceId: string, force: boolean): Promise<Detail> {
    const cached = this.details.get(instanceId);
    if (!force && cached && this.now() - cached.at < DETAIL_TTL_MS) return cached;
    const entry = this.runtime.adapter(instanceId);
    let error: string | null = null;
    const read = async <T>(fn: (() => Promise<T>) | undefined): Promise<T | null> => {
      if (!fn || !entry) return null;
      try {
        return await entry.gate.run(fn);
      } catch (err) {
        error = kindOf(err);
        return null;
      }
    };
    const [libraries, failures] = await Promise.all([
      read(entry?.adapter.transcodeLibraries?.bind(entry.adapter)),
      read(
        entry?.adapter.transcodeFailures ? () => entry.adapter.transcodeFailures!(FAILURE_LIMIT) : undefined,
      ),
    ]);
    const out: Detail = { at: this.now(), libraries, failures, error };
    this.details.set(instanceId, out);
    return out;
  }

  async list(force = false) {
    const now = this.now();
    return Promise.all(
      this.eligible().map(async ({ row, def, snapshot }) => {
        const status = snapshot.transcoding;
        const d = snapshot.status === 'down' ? null : await this.detail(row.id, force);
        const stuck = new Map(this.stuck(row.id).map((j) => [j.key, j.minutes]));
        const nodes = (status?.nodes ?? []).map((n) => ({
          ...n,
          workers: n.workers.map((w) => ({
            ...w,
            stuckMinutes: stuck.get(`${n.id}\u0000${w.id}\u0000${w.file ?? ''}`) ?? null,
          })),
        }));
        const offline = status
          ? this.offline(row.id, status).map((n) => ({
              id: n.nodeId,
              name: n.name,
              lastSeenAt: n.lastSeenAt,
            }))
          : [];
        return {
          instanceId: row.id,
          instanceName: row.name,
          adapter: def.id,
          adapterName: def.name,
          status: snapshot.status,
          version: snapshot.connection?.version ?? null,
          compatibility: snapshot.connection?.compatibility ?? null,
          checkedAt: snapshot.checkedAt,
          errorKind: snapshot.errorKind,
          webUrl: this.runtime.adapter(row.id)?.adapter.webUrl?.() ?? null,
          nodes,
          offline,
          totals: status?.totals ?? null,
          history: this.history(row.id),
          libraries: d?.libraries ?? null,
          failures: d?.failures ?? null,
          detailError: d?.error ?? null,
          readAt: d ? new Date(d.at).toISOString() : new Date(now).toISOString(),
        };
      }),
    );
  }
}
