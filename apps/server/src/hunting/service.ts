// Runs Hunting per *arr instance: at the configured pace it searches missing
// titles and upgrades, within the API budget, and reads the results from
// the *arr history.
import {
  AdapterError,
  DEFAULT_HUNTING_CONFIG,
  budgetLeft,
  isDue,
  isOpen,
  nextRunAt,
  pauseReason,
  pruneCalls,
  rateFor,
  resolveResult,
  scheduleUpcoming,
  searchesAllowed,
  selectCandidates,
  successStats,
  targetMediaIds,
  withPace,
  type HuntCandidate,
  type HuntingConfig,
  type HuntList,
  type HuntPause,
  type Msg,
} from '@wardarr/core';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { huntExclusions, huntSearches } from '../db/schema.js';
import type { EventBus } from '../events/bus.js';
import type { FeatureStore } from '../features/store.js';
import { HttpError } from '../http/validate.js';
import type { InstanceRuntime } from '../instances/runtime.js';
import type { CleanerService } from '../cleaner/service.js';

const FEATURE = 'hunting';
const TICK_MS = 5 * 60_000;
const RESULTS_MS = 15 * 60_000;
const WANTED_MAX = 250;
const RESULT_WINDOW_DAYS = 7;
const LISTS: HuntList[] = ['missing', 'cutoff'];
/** Health checks that mean searches cannot work right now. */
const INDEXER_CHECKS = new Set(['IndexerStatusCheck', 'IndexerLongTermStatusCheck', 'IndexerSearchCheck']);

interface StoredState {
  lastRun: Record<HuntList, string | null>;
  /** Timestamps of API calls in the last hour. */
  calls: string[];
}

const EMPTY_STATE: StoredState = { lastRun: { missing: null, cutoff: null }, calls: [] };

interface Live {
  pause: HuntPause | null;
  candidates: Record<HuntList, HuntCandidate[]>;
  error: string | null;
}

export class HuntingService {
  private readonly live = new Map<string, Live>();

  constructor(
    private readonly db: Db,
    private readonly features: FeatureStore,
    private readonly runtime: InstanceRuntime,
    private readonly cleaner: CleanerService,
    private readonly bus: EventBus,
    private readonly now: () => Date = () => new Date(),
  ) {
    runtime.onReload(() => this.reschedule());
  }

  eligible() {
    return this.runtime
      .snapshots()
      .filter(
        ({ row, def }) =>
          row.enabled &&
          def.category === 'arr' &&
          def.capabilities.includes('wanted') &&
          def.capabilities.includes('search'),
      );
  }

  private known(id: string) {
    const found = this.eligible().find((e) => e.row.id === id);
    const entry = this.runtime.adapter(id);
    if (!found || !entry) throw new HttpError(404, 'notFound');
    return { ...found, entry };
  }

  config(instanceId: string): HuntingConfig {
    return this.features.config(instanceId, FEATURE, DEFAULT_HUNTING_CONFIG);
  }

  saveConfig(instanceId: string, patch: Partial<HuntingConfig>): HuntingConfig {
    this.known(instanceId);
    let next = { ...this.config(instanceId), ...patch };
    // A preset sets both rates; changing a rate by hand makes the pace custom.
    if (patch.pace && patch.pace !== 'custom' && !patch.missing && !patch.cutoff)
      next = withPace(next, patch.pace);
    else if (patch.missing || patch.cutoff) next.pace = 'custom';
    this.features.saveConfig(instanceId, FEATURE, next);
    this.bus.publish({ type: 'hunting.updated', audience: 'admin' });
    return next;
  }

  private state(instanceId: string): StoredState {
    return this.features.state(instanceId, FEATURE, EMPTY_STATE);
  }

  private liveFor(instanceId: string): Live {
    let l = this.live.get(instanceId);
    if (!l) {
      l = { pause: null, candidates: { missing: [], cutoff: [] }, error: null };
      this.live.set(instanceId, l);
    }
    return l;
  }

  private reschedule(): void {
    const scheduler = this.runtime.schedulerRef;
    if (!scheduler) return;
    const ids = new Set<string>();
    for (const { row } of this.eligible()) {
      ids.add(row.id);
      scheduler.schedule(`hunting:${row.id}`, TICK_MS, () => this.tick(row.id), 60_000);
      scheduler.schedule(`hunting:results:${row.id}`, RESULTS_MS, () => this.updateResults(row.id), 90_000);
    }
    for (const id of [...this.live.keys()]) {
      if (ids.has(id)) continue;
      scheduler.cancel(`hunting:${id}`);
      scheduler.cancel(`hunting:results:${id}`);
      this.live.delete(id);
    }
  }

  /** Spends one API call from the budget, or throws when none is left. */
  private spend(instanceId: string, config: HuntingConfig): void {
    const now = this.now();
    const st = this.state(instanceId);
    const calls = pruneCalls(st.calls, now);
    if (budgetLeft(calls, config.apiCallsPerHour, now) <= 0) throw new HttpError(429, 'budget');
    calls.push(now.toISOString());
    this.features.saveState(instanceId, FEATURE, { ...st, calls });
  }

  private budget(instanceId: string, config: HuntingConfig): number {
    return budgetLeft(this.state(instanceId).calls, config.apiCallsPerHour, this.now());
  }

  private indexerProblem(instanceId: string): string | null {
    const snap = this.runtime.snapshots().find((s) => s.row.id === instanceId)?.snapshot;
    const hit = snap?.signals.find(
      (s) =>
        s.kind === 'health' &&
        s.source &&
        INDEXER_CHECKS.has(s.source) &&
        (s.level === 'error' || s.level === 'warning'),
    );
    return hit ? hit.message : null;
  }

  private currentPause(instanceId: string, config: HuntingConfig): HuntPause | null {
    const snap = this.runtime.snapshots().find((s) => s.row.id === instanceId)?.snapshot;
    return pauseReason({
      config,
      indexerProblem: this.indexerProblem(instanceId),
      queueSize: snap?.queue?.length ?? 0,
      budget: this.budget(instanceId, config),
      callsNeeded: 2,
    });
  }

  private lastSearched(instanceId: string): Map<string, string> {
    const rows = this.db
      .select({ itemKeys: huntSearches.itemKeys, at: huntSearches.at })
      .from(huntSearches)
      .where(eq(huntSearches.instanceId, instanceId))
      .orderBy(huntSearches.at)
      .all();
    const out = new Map<string, string>();
    for (const r of rows) for (const k of r.itemKeys) out.set(k, r.at);
    return out;
  }

  private excluded(instanceId: string): Set<string> {
    return new Set(
      this.db
        .select({ key: huntExclusions.key })
        .from(huntExclusions)
        .where(eq(huntExclusions.instanceId, instanceId))
        .all()
        .map((r) => r.key),
    );
  }

  /** Regular run: searches each list whose time has come. */
  async tick(instanceId: string, force = false): Promise<void> {
    const found = this.eligible().find((e) => e.row.id === instanceId);
    const entry = this.runtime.adapter(instanceId);
    if (!found || !entry) return;
    const config = this.config(instanceId);
    const live = this.liveFor(instanceId);
    live.pause = this.currentPause(instanceId, config);

    for (const list of LISTS) {
      const rate = rateFor(config, list);
      const st = this.state(instanceId);
      if (rate.count <= 0) continue;
      if (!force && !isDue(rate, st.lastRun[list], this.now())) continue;
      if (live.pause) break;
      try {
        await this.runList(instanceId, list, config, live);
        live.error = null;
      } catch (err) {
        live.error =
          err instanceof AdapterError ? err.kind : err instanceof HttpError ? err.code : 'badResponse';
      }
      live.pause = this.currentPause(instanceId, config);
    }
    this.bus.publish({ type: 'hunting.updated', audience: 'admin' });
  }

  private async runList(
    instanceId: string,
    list: HuntList,
    config: HuntingConfig,
    live: Live,
  ): Promise<void> {
    const { entry } = this.known(instanceId);
    this.spend(instanceId, config);
    const wanted = await entry.gate.run(() =>
      entry.adapter.wanted!(list, { monitoredOnly: config.monitoredOnly, max: WANTED_MAX }),
    );
    const candidates = selectCandidates({
      list,
      wanted,
      config,
      lastSearched: this.lastSearched(instanceId),
      excluded: this.excluded(instanceId),
      exhausted: this.cleaner.exhaustedKeys(instanceId),
      now: this.now(),
    });
    const allowed = searchesAllowed(rateFor(config, list), this.budget(instanceId, config), 0);
    const picked = candidates.slice(0, allowed);
    for (const c of picked) await this.search(instanceId, c, false);
    live.candidates[list] = candidates.slice(picked.length);
    const st = this.state(instanceId);
    this.features.saveState(instanceId, FEATURE, {
      ...st,
      lastRun: { ...st.lastRun, [list]: this.now().toISOString() },
    });
  }

  private async search(instanceId: string, c: HuntCandidate, manual: boolean): Promise<void> {
    const { entry } = this.known(instanceId);
    const config = this.config(instanceId);
    this.spend(instanceId, config);
    await entry.gate.run(() => entry.adapter.search!(c.target));
    this.db
      .insert(huntSearches)
      .values({
        instanceId,
        key: c.key,
        itemKeys: c.itemKeys,
        title: c.title,
        list: c.list,
        mediaIds: targetMediaIds(c.target),
        reason: manual ? { key: 'hunting.reason.manual' } : c.reason,
        at: this.now().toISOString(),
        manual,
        result: 'pending',
      })
      .run();
  }

  /** "Search now" for a title from "Up next". */
  async searchNow(instanceId: string, key: string): Promise<void> {
    const live = this.liveFor(instanceId);
    const c = [...live.candidates.missing, ...live.candidates.cutoff].find((x) => x.key === key);
    if (!c) throw new HttpError(404, 'notFound');
    try {
      await this.search(instanceId, c, true);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(502, 'serviceError', {
        kind: err instanceof AdapterError ? err.kind : 'badResponse',
      });
    }
    live.candidates[c.list] = live.candidates[c.list].filter((x) => x.key !== key);
    this.bus.publish({ type: 'hunting.updated', audience: 'admin' });
  }

  exclude(instanceId: string, key: string, title: string): void {
    this.known(instanceId);
    this.db.insert(huntExclusions).values({ instanceId, key, title }).onConflictDoNothing().run();
    const live = this.liveFor(instanceId);
    for (const list of LISTS) live.candidates[list] = live.candidates[list].filter((x) => x.key !== key);
    this.bus.publish({ type: 'hunting.updated', audience: 'admin' });
  }

  include(instanceId: string, key: string): void {
    this.db
      .delete(huntExclusions)
      .where(and(eq(huntExclusions.instanceId, instanceId), eq(huntExclusions.key, key)))
      .run();
    this.bus.publish({ type: 'hunting.updated', audience: 'admin' });
  }

  /** Reads the *arr history once and updates all open results. */
  async updateResults(instanceId: string): Promise<void> {
    const found = this.eligible().find((e) => e.row.id === instanceId);
    const entry = this.runtime.adapter(instanceId);
    if (!found || !entry?.adapter.historySince) return;
    const since = new Date(this.now().getTime() - RESULT_WINDOW_DAYS * 86_400_000).toISOString();
    const open = this.db
      .select()
      .from(huntSearches)
      .where(
        and(
          eq(huntSearches.instanceId, instanceId),
          gte(huntSearches.at, since),
          inArray(huntSearches.result, ['pending', 'grabbed', 'nothing']),
        ),
      )
      .all()
      .filter((s) => isOpen(s.result));
    if (open.length === 0) return;
    const config = this.config(instanceId);
    if (this.budget(instanceId, config) <= 0) return;
    this.spend(instanceId, config);
    const oldest = open.reduce((min, s) => (s.at < min ? s.at : min), open[0]!.at);
    let history;
    try {
      history = await entry.gate.run(() => entry.adapter.historySince!(oldest));
    } catch {
      return;
    }
    for (const s of open) {
      const result = resolveResult(s, history, this.now());
      if (result !== s.result)
        this.db.update(huntSearches).set({ result }).where(eq(huntSearches.id, s.id)).run();
    }
    this.bus.publish({ type: 'hunting.updated', audience: 'admin' });
  }

  summary() {
    const now = this.now();
    const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
    return this.eligible().map(({ row, def }) => {
      const config = this.config(row.id);
      const st = this.state(row.id);
      const live = this.liveFor(row.id);
      const pause = this.currentPause(row.id, config);
      const recent = this.db
        .select()
        .from(huntSearches)
        .where(and(eq(huntSearches.instanceId, row.id), gte(huntSearches.at, since)))
        .orderBy(desc(huntSearches.at))
        .all();
      const lists = Object.fromEntries(
        LISTS.map((list) => {
          const rate = rateFor(config, list);
          const next = pause ? null : nextRunAt(rate, st.lastRun[list], now);
          return [
            list,
            {
              rate,
              lastRunAt: st.lastRun[list],
              nextRunAt: next?.toISOString() ?? null,
              upcoming: pause
                ? live.candidates[list].slice(0, 10).map((c) => ({ ...c, at: null }))
                : scheduleUpcoming(live.candidates[list], rate, st.lastRun[list], now),
              waiting: live.candidates[list].length,
            },
          ];
        }),
      );
      return {
        instanceId: row.id,
        instanceName: row.name,
        adapter: def.id,
        adapterName: def.name,
        config,
        pause: pause as { kind: string; reason: Msg } | null,
        error: live.error,
        budget: { left: budgetLeft(st.calls, config.apiCallsPerHour, now), limit: config.apiCallsPerHour },
        lists,
        stats: successStats(recent),
        searches: recent.slice(0, 50).map((s) => ({
          id: s.id,
          key: s.key,
          title: s.title,
          list: s.list,
          reason: s.reason,
          at: s.at,
          manual: s.manual,
          result: s.result,
        })),
        exclusions: this.db.select().from(huntExclusions).where(eq(huntExclusions.instanceId, row.id)).all(),
      };
    });
  }
}
