// Library statistics of media servers. Counting a library reads every item,
// so Wardarr keeps a cache and refreshes it every few hours.
import { AdapterError, type LibraryStats, type Signal } from '@wardarr/core';
import type { FastifyBaseLogger } from 'fastify';
import type { EventBus } from '../events/bus.js';
import type { FeatureStore } from '../features/store.js';
import { HttpError } from '../http/validate.js';
import type { InstanceRuntime } from '../instances/runtime.js';

const FEATURE = 'library';
const REFRESH_MS = 6 * 3600_000;
/** The cache counts as stale after this many hours without a successful refresh. */
const STALE_HOURS = 48;

interface CacheState {
  libraries: LibraryStats[];
  refreshedAt: string | null;
  attemptedAt: string | null;
  error: string | null;
}

const EMPTY: CacheState = { libraries: [], refreshedAt: null, attemptedAt: null, error: null };

export interface LibraryView {
  instanceId: string;
  instanceName: string;
  adapter: string;
  adapterName: string;
  refreshedAt: string | null;
  error: string | null;
  refreshing: boolean;
  libraries: LibraryStats[];
}

export class LibraryService {
  private readonly running = new Map<string, Promise<void>>();

  constructor(
    private readonly features: FeatureStore,
    private readonly runtime: InstanceRuntime,
    private readonly bus: EventBus,
    private readonly log: FastifyBaseLogger,
    private readonly now: () => Date = () => new Date(),
  ) {
    runtime.registerSignalSource(FEATURE, () => this.signals());
    runtime.onReload(() => this.reschedule());
    runtime.onRecheck(async (ids) => {
      await Promise.allSettled(ids.filter((id) => this.isEligible(id)).map((id) => this.refresh(id)));
    });
  }

  eligible() {
    return this.runtime
      .snapshots()
      .filter(({ row, def }) => row.enabled && def.capabilities.includes('library'));
  }

  private isEligible(id: string): boolean {
    return this.eligible().some((e) => e.row.id === id);
  }

  private reschedule(): void {
    const scheduler = this.runtime.schedulerRef;
    if (!scheduler) return;
    for (const { row } of this.runtime.snapshots()) scheduler.cancel(`library:${row.id}`);
    for (const { row } of this.eligible()) {
      const state = this.cache(row.id);
      const last = state.attemptedAt ? Date.parse(state.attemptedAt) : 0;
      const wait = Math.max(30_000, last + REFRESH_MS - this.now().getTime());
      scheduler.schedule(`library:${row.id}`, REFRESH_MS, () => this.refresh(row.id), wait);
    }
  }

  private cache(instanceId: string): CacheState {
    return this.features.state(instanceId, FEATURE, EMPTY);
  }

  list(): LibraryView[] {
    return this.eligible().map(({ row, def }) => {
      const c = this.cache(row.id);
      return {
        instanceId: row.id,
        instanceName: row.name,
        adapter: def.id,
        adapterName: def.name,
        refreshedAt: c.refreshedAt,
        error: c.error,
        refreshing: this.running.has(row.id),
        libraries: c.libraries,
      };
    });
  }

  /** Reads all libraries of a media server again. Runs once at a time per server. */
  refresh(instanceId: string): Promise<void> {
    const existing = this.running.get(instanceId);
    if (existing) return existing;
    const entry = this.runtime.adapter(instanceId);
    if (!entry?.adapter.libraries || !this.isEligible(instanceId)) {
      return Promise.reject(new HttpError(404, 'notFound'));
    }
    const job = (async () => {
      const prev = this.cache(instanceId);
      const at = this.now().toISOString();
      try {
        // A full count can take a while on big libraries; it does not use the gate.
        const libraries = await entry.adapter.libraries!();
        this.features.saveState(instanceId, FEATURE, {
          libraries,
          refreshedAt: at,
          attemptedAt: at,
          error: null,
        });
      } catch (err) {
        const kind = err instanceof AdapterError ? err.kind : 'badResponse';
        this.log.warn({ instance: instanceId, kind }, 'library refresh failed');
        this.features.saveState(instanceId, FEATURE, { ...prev, attemptedAt: at, error: kind });
      }
    })().finally(() => {
      this.running.delete(instanceId);
      this.runtime.refreshIssues();
      this.bus.publish({ type: 'library.updated', audience: 'all' });
    });
    this.running.set(instanceId, job);
    this.bus.publish({ type: 'library.updated', audience: 'all' });
    return job;
  }

  /** Totals across all servers, for the statistics every user may see. */
  totals() {
    const kinds: Record<string, { items: number; sizeBytes: number }> = {};
    const resolutions: Record<string, number> = {};
    let sizeBytes = 0;
    let refreshedAt: string | null = null;
    for (const view of this.list()) {
      if (view.refreshedAt && (!refreshedAt || view.refreshedAt > refreshedAt))
        refreshedAt = view.refreshedAt;
      for (const lib of view.libraries) {
        const k = (kinds[lib.kind] ??= { items: 0, sizeBytes: 0 });
        k.items += lib.items;
        k.sizeBytes += lib.sizeBytes ?? 0;
        sizeBytes += lib.sizeBytes ?? 0;
        for (const [r, n] of Object.entries(lib.resolutions)) resolutions[r] = (resolutions[r] ?? 0) + n;
      }
    }
    return { kinds, resolutions, sizeBytes, refreshedAt };
  }

  /** A failed refresh or a cache older than two days is a Wardarr issue. */
  private signals(): { signals: Signal[]; checked: string[] } {
    const signals: Signal[] = [];
    const checked: string[] = [];
    const nowMs = this.now().getTime();
    for (const { row, def } of this.eligible()) {
      const c = this.cache(row.id);
      if (!c.attemptedAt) continue;
      checked.push(`wardarr:${row.id}:cache`);
      const ageHours = c.refreshedAt ? (nowMs - Date.parse(c.refreshedAt)) / 3600_000 : Infinity;
      const stale = ageHours >= STALE_HOURS;
      if (!c.error && !stale) continue;
      const staleHours = Number.isFinite(ageHours) ? Math.round(ageHours) : 0;
      signals.push({
        origin: 'wardarr',
        instance: { id: row.id, name: row.name, adapter: def.id },
        kind: 'cache',
        channel: 'cache',
        source: 'Wardarr.libraryCache',
        level: 'warning',
        message: c.error ?? 'stale',
        data: {
          failedLibraries: c.error ? (c.libraries.length ? c.libraries.map((l) => l.id) : ['all']) : [],
          staleHours: stale ? staleHours : 0,
        },
      });
    }
    return { signals, checked };
  }
}
