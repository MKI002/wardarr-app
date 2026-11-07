// Indexer overview from Prowlarr: status, statistics and which apps lose
// indexers when one fails.
//
// The page never waits for Prowlarr. A request answers at once with the last
// statistics Wardarr read (kept in the database, so they survive a restart);
// when they are old, a read starts in the background and an
// `indexers.updated` event tells the page to fetch the new numbers.
import { AdapterError, type IndexerApp, type IndexerStats } from '@wardarr/core';
import type { EventBus } from '../events/bus.js';
import type { FeatureStore } from '../features/store.js';
import { HttpError } from '../http/validate.js';
import type { InstanceRuntime } from '../instances/runtime.js';

const FEATURE = 'indexerOverview';
/** Statistics this old are read again when someone looks. */
const TTL_MS = 5 * 60_000;
/** After a failed read, wait this long before trying again on its own. */
const RETRY_MS = 60_000;

function kindOf(err: unknown): string {
  return err instanceof AdapterError ? err.kind : 'badResponse';
}

interface Stored {
  /** When the statistics were last read successfully (ISO). */
  at: string | null;
  stats: IndexerStats[] | null;
  apps: IndexerApp[] | null;
}

interface Details extends Stored {
  /** Why the last read failed; the stored numbers stay in place. */
  error: string | null;
  /** When the last read finished, successful or not (ms). */
  triedAt: number;
}

const EMPTY: Stored = { at: null, stats: null, apps: null };

export class IndexerService {
  private readonly details = new Map<string, Details>();
  private readonly inflight = new Map<string, Promise<void>>();
  private readonly now: () => number;

  constructor(
    private readonly runtime: InstanceRuntime,
    private readonly opts: { features?: FeatureStore; bus?: EventBus; now?: () => number } = {},
  ) {
    this.now = opts.now ?? (() => Date.now());
    runtime.onReload(() => this.details.clear());
  }

  private eligible() {
    return this.runtime
      .snapshots()
      .filter(
        ({ row, def }) => row.enabled && def.category === 'indexer' && def.capabilities.includes('indexers'),
      );
  }

  /** What is known right now, from memory or the database. Never calls Prowlarr. */
  private known(instanceId: string): Details {
    const hit = this.details.get(instanceId);
    if (hit) return hit;
    const stored = this.opts.features?.state<Stored>(instanceId, FEATURE, EMPTY) ?? EMPTY;
    const out: Details = { ...EMPTY, ...stored, error: null, triedAt: 0 };
    this.details.set(instanceId, out);
    return out;
  }

  /** Reads statistics and apps from Prowlarr; resolves when done, never rejects. */
  refresh(instanceId: string): Promise<void> {
    const running = this.inflight.get(instanceId);
    if (running) return running;
    const job = this.read(instanceId).finally(() => this.inflight.delete(instanceId));
    this.inflight.set(instanceId, job);
    return job;
  }

  /** Resolves once every background read has finished. */
  async settled(): Promise<void> {
    await Promise.all([...this.inflight.values()]);
  }

  private async read(instanceId: string): Promise<void> {
    const entry = this.runtime.adapter(instanceId);
    let error: string | null = null;
    const read = async <T>(fn: (() => Promise<T>) | undefined): Promise<T | null> => {
      if (!fn || !entry) return null;
      try {
        // A slow statistics endpoint is not an outage, so it does not trip the circuit.
        return await entry.gate.run(fn, { trip: false });
      } catch (err) {
        error = kindOf(err);
        return null;
      }
    };
    const [stats, apps] = await Promise.all([
      read(entry?.adapter.indexerStats?.bind(entry.adapter)),
      read(entry?.adapter.indexerApps?.bind(entry.adapter)),
    ]);
    const prev = this.known(instanceId);
    const next: Details = {
      at: stats ? new Date(this.now()).toISOString() : prev.at,
      stats: stats ?? prev.stats,
      apps: apps ?? prev.apps,
      error,
      triedAt: this.now(),
    };
    this.details.set(instanceId, next);
    if (stats || apps) {
      try {
        this.opts.features?.saveState(instanceId, FEATURE, {
          at: next.at,
          stats: next.stats,
          apps: next.apps,
        } satisfies Stored);
      } catch {
        // The instance was removed while reading.
      }
    }
    this.opts.bus?.publish({ type: 'indexers.updated', audience: 'admin' });
  }

  /**
   * The overview of every Prowlarr. Old statistics start a background read;
   * `force` also re-checks the indexers' status right away.
   */
  list(force = false) {
    return this.eligible().map(({ row, def, snapshot }) => {
      const d = this.known(row.id);
      const due = force || this.now() - d.triedAt >= (d.error ? RETRY_MS : TTL_MS);
      if (due && !this.inflight.has(row.id)) void this.refresh(row.id);
      if (force) void this.runtime.poll(row.id);
      const statsById = new Map((d.stats ?? []).map((s) => [s.indexerId, s]));
      const apps = (d.apps ?? []).map((a) => ({
        id: a.id,
        name: a.name,
        implementation: a.implementation,
        enabled: a.enabled,
        indexerIds: a.indexerIds,
      }));
      const indexers = (snapshot.indexers ?? []).map((ix) => {
        const receivers = apps.filter((a) => a.enabled && a.indexerIds.includes(ix.id));
        const others = (app: (typeof apps)[number]) =>
          (snapshot.indexers ?? []).some(
            (o) => o.id !== ix.id && o.enabled && !o.failing && app.indexerIds.includes(o.id),
          );
        return {
          ...ix,
          stats: statsById.get(ix.id) ?? null,
          apps: receivers.map((a) => a.name),
          /** Apps that have no working indexer left while this one fails. */
          stranded: ix.failing ? receivers.filter((a) => !others(a)).map((a) => a.name) : [],
          webUrl: this.runtime.adapter(row.id)?.adapter.webUrl?.({ kind: 'indexer', id: ix.id }) ?? null,
        };
      });
      const failing = indexers.filter((i) => i.failing);
      return {
        instanceId: row.id,
        instanceName: row.name,
        adapterName: def.name,
        status: snapshot.status,
        checkedAt: snapshot.checkedAt,
        error: d.error,
        /** When the statistics shown were read. */
        statsAt: d.at,
        /** A background read is running; fresh numbers follow. */
        refreshing: this.inflight.has(row.id),
        indexers,
        apps: apps.map((a) => ({
          ...a,
          failing: failing.filter((f) => a.indexerIds.includes(f.id)).map((f) => f.name),
        })),
      };
    });
  }

  async test(instanceId: string, indexerId: number): Promise<{ ok: boolean; message: string | null }> {
    if (!this.eligible().some((e) => e.row.id === instanceId)) throw new HttpError(404, 'notFound');
    const entry = this.runtime.adapter(instanceId);
    if (!entry?.adapter.testIndexer) throw new HttpError(400, 'unsupported');
    try {
      const result = await entry.gate.run(() => entry.adapter.testIndexer!(indexerId));
      return { ok: result.ok, message: result.message ?? null };
    } catch (err) {
      return { ok: false, message: kindOf(err) };
    } finally {
      void this.runtime.poll(instanceId);
    }
  }
}
