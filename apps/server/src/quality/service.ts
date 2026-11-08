// Library quality scores: how far every file in Sonarr and Radarr is from the
// best file its quality profile allows. Read-only.
//
// Reading a whole library is slow (Sonarr answers one series at a time), so
// the page never waits for it: a request answers at once with the last
// report Wardarr stored, and an old report starts a read in the background.
// While it runs, `quality.updated` events carry the progress to the page.
import { AdapterError, buildQualityReport, type QualityReport } from '@wardarr/core';
import type { EventBus } from '../events/bus.js';
import type { FeatureStore } from '../features/store.js';
import { HttpError } from '../http/validate.js';
import type { InstanceRuntime } from '../instances/runtime.js';

const FEATURE = 'qualityScore';
/** A report this old is read again when someone opens the page. */
const TTL_MS = 12 * 3600_000;
/** After a failed read, wait this long before trying again on its own. */
const RETRY_MS = 10 * 60_000;
/** Progress events at most this often. */
const PROGRESS_EVERY_MS = 1_500;

interface Stored {
  /** When the report was made (ISO). */
  at: string | null;
  report: QualityReport | null;
}

interface Details extends Stored {
  error: string | null;
  triedAt: number;
  progress: { done: number; total: number } | null;
}

const EMPTY: Stored = { at: null, report: null };

function kindOf(err: unknown): string {
  return err instanceof AdapterError ? err.kind : 'badResponse';
}

export class QualityService {
  private readonly details = new Map<string, Details>();
  private readonly inflight = new Map<string, Promise<void>>();
  private readonly now: () => number;

  constructor(
    private readonly runtime: InstanceRuntime,
    private readonly opts: { features?: FeatureStore; bus?: EventBus; now?: () => number } = {},
  ) {
    this.now = opts.now ?? (() => Date.now());
    runtime.onReload(() => {
      for (const id of this.details.keys()) if (!this.inflight.has(id)) this.details.delete(id);
    });
  }

  private eligible() {
    return this.runtime
      .snapshots()
      .filter(({ row, def }) => row.enabled && def.capabilities.includes('qualityScore'));
  }

  private known(instanceId: string): Details {
    const hit = this.details.get(instanceId);
    if (hit) return hit;
    const stored = this.opts.features?.state<Stored>(instanceId, FEATURE, EMPTY) ?? EMPTY;
    const out: Details = { ...EMPTY, ...stored, error: null, triedAt: 0, progress: null };
    this.details.set(instanceId, out);
    return out;
  }

  /** Reads the library of one instance; resolves when done, never rejects. */
  refresh(instanceId: string): Promise<void> {
    const running = this.inflight.get(instanceId);
    if (running) return running;
    const job = this.read(instanceId).finally(() => this.inflight.delete(instanceId));
    this.inflight.set(instanceId, job);
    return job;
  }

  /** Starts a read for one instance, or all, and returns at once. */
  start(instanceId?: string): void {
    const ids = this.eligible().map((e) => e.row.id);
    if (instanceId && !ids.includes(instanceId)) throw new HttpError(404, 'notFound');
    for (const id of instanceId ? [instanceId] : ids) void this.refresh(id);
    this.publish();
  }

  /** Resolves once every background read has finished. */
  async settled(): Promise<void> {
    await Promise.all([...this.inflight.values()]);
  }

  private publish(): void {
    this.opts.bus?.publish({ type: 'quality.updated', audience: 'admin' });
  }

  private async read(instanceId: string): Promise<void> {
    const entry = this.runtime.adapter(instanceId);
    const prev = this.known(instanceId);
    let lastEvent = 0;
    const progress = (done: number, total: number) => {
      prev.progress = { done, total };
      if (this.now() - lastEvent >= PROGRESS_EVERY_MS) {
        lastEvent = this.now();
        this.publish();
      }
    };
    let report: QualityReport | null = null;
    let error: string | null = null;
    try {
      if (!entry?.adapter.qualityScan) throw new AdapterError('unsupported', 'no quality scan');
      const scan = await entry.gate.run(() => entry.adapter.qualityScan!(progress), { trip: false });
      report = buildQualityReport(scan);
    } catch (err) {
      error = kindOf(err);
    }
    const next: Details = {
      at: report ? new Date(this.now()).toISOString() : prev.at,
      report: report ?? prev.report,
      error,
      triedAt: this.now(),
      progress: null,
    };
    this.details.set(instanceId, next);
    if (report) {
      try {
        this.opts.features?.saveState(instanceId, FEATURE, { at: next.at, report } satisfies Stored);
      } catch {
        // The instance was removed while reading.
      }
    }
    this.publish();
  }

  /** Every Sonarr and Radarr with its last report. Old reports start a background read. */
  list(force = false) {
    return this.eligible().map(({ row, def, snapshot }) => {
      const d = this.known(row.id);
      const due = force || this.now() - d.triedAt >= (d.error ? RETRY_MS : TTL_MS);
      const stale = !d.at || this.now() - Date.parse(d.at) >= TTL_MS;
      if (due && (force || stale || d.error) && !this.inflight.has(row.id)) void this.refresh(row.id);
      return {
        instanceId: row.id,
        instanceName: row.name,
        adapter: def.id,
        adapterName: def.name,
        version: snapshot.connection?.version ?? null,
        status: snapshot.status,
        /** When the report shown was made. */
        at: d.at,
        refreshing: this.inflight.has(row.id),
        progress: d.progress,
        error: d.error,
        report: d.report,
      };
    });
  }
}
