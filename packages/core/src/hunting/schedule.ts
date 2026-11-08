// When Hunting runs, how many API calls it may make, and why it pauses.
import type { HistoryEvent } from '../adapter/types.js';
import type { Msg, Signal } from '../issues/types.js';
import type {
  HuntCandidate,
  HuntingConfig,
  HuntList,
  HuntPause,
  HuntRate,
  HuntResult,
  HuntSearchRecord,
  ScheduledCandidate,
} from './types.js';

const HOUR = 3_600_000;

/** API calls left in the sliding hour before `now`. */
export function budgetLeft(calls: readonly string[], limit: number, now: Date): number {
  const since = now.getTime() - HOUR;
  const used = calls.filter((c) => Date.parse(c) > since).length;
  return Math.max(0, limit - used);
}

/** Drops call timestamps older than an hour. */
export function pruneCalls(calls: readonly string[], now: Date): string[] {
  const since = now.getTime() - HOUR;
  return calls.filter((c) => Date.parse(c) > since);
}

export function nextRunAt(rate: HuntRate, lastRunAt: string | null, now: Date): Date | null {
  if (rate.count <= 0) return null;
  if (!lastRunAt) return now;
  const next = Date.parse(lastRunAt) + rate.everyMinutes * 60_000;
  return new Date(Math.max(next, now.getTime()));
}

export function isDue(rate: HuntRate, lastRunAt: string | null, now: Date): boolean {
  const next = nextRunAt(rate, lastRunAt, now);
  return next !== null && next.getTime() <= now.getTime();
}

/** Health checks that report indexers the *arr cannot use right now. */
const INDEXER_STATUS_CHECKS = new Set(['IndexerStatusCheck', 'IndexerLongTermStatusCheck']);
/** Health check that only fires when no indexer can run an automatic search. */
const INDEXER_SEARCH_CHECK = 'IndexerSearchCheck';

export interface IndexerHealth {
  /** Why no search can work at all, or null. */
  blocking: string | null;
  /** Some indexers fail but others still search, or null. */
  degraded: string | null;
}

/**
 * Reads the *arr health checks about indexers. The status checks report a
 * warning while some indexers fail and an error once all of them fail, so
 * only the error (and the search check, which means no indexer can search)
 * stops Hunting. A warning keeps it running on the healthy indexers.
 */
export function indexerHealth(signals: readonly Signal[]): IndexerHealth {
  let blocking: string | null = null;
  let degraded: string | null = null;
  for (const s of signals) {
    if (s.kind !== 'health' || !s.source) continue;
    if (s.level !== 'error' && s.level !== 'warning') continue;
    // The "all indexers" text names no indexer after a colon, in every language.
    const allDown =
      s.source === INDEXER_SEARCH_CHECK ||
      (INDEXER_STATUS_CHECKS.has(s.source) && (s.level === 'error' || !s.message.includes(':')));
    if (allDown) blocking ??= s.message;
    else if (INDEXER_STATUS_CHECKS.has(s.source)) degraded ??= s.message;
  }
  return { blocking, degraded };
}

/** A note shown while Hunting keeps searching with some indexers down. */
export function indexerNotice(health: IndexerHealth): Msg | null {
  if (health.blocking || !health.degraded) return null;
  return { key: 'hunting.notice.indexer', params: { name: health.degraded } };
}

export interface PauseInput {
  config: HuntingConfig;
  /** Why no indexer can search right now, or null. Some failing indexers do not pause Hunting. */
  indexerProblem: string | null;
  queueSize: number;
  budget: number;
  /** Calls a run needs at least: the wanted list plus one search. */
  callsNeeded: number;
}

/** The first reason Hunting must wait, or null when it may search. */
export function pauseReason(p: PauseInput): HuntPause | null {
  if (p.config.missing.count <= 0 && p.config.cutoff.count <= 0)
    return { kind: 'off', reason: { key: 'hunting.pause.off' } };
  if (p.indexerProblem)
    return { kind: 'indexer', reason: { key: 'hunting.pause.indexer', params: { name: p.indexerProblem } } };
  if (p.queueSize >= p.config.pauseQueueSize)
    return {
      kind: 'queueFull',
      reason: {
        key: 'hunting.pause.queueFull',
        params: { size: p.queueSize, limit: p.config.pauseQueueSize },
      },
    };
  if (p.budget < p.callsNeeded)
    return {
      kind: 'budget',
      reason: { key: 'hunting.pause.budget', params: { limit: p.config.apiCallsPerHour } },
    };
  return null;
}

/**
 * How many searches a run of one list may start: the rate, limited by the
 * API budget after the calls needed to read the list.
 */
export function searchesAllowed(rate: HuntRate, budget: number, readCalls: number): number {
  return Math.max(0, Math.min(rate.count, budget - readCalls));
}

/** Assigns each upcoming candidate the time Hunting would search it. */
export function scheduleUpcoming(
  candidates: readonly HuntCandidate[],
  rate: HuntRate,
  lastRunAt: string | null,
  now: Date,
  limit = 10,
): ScheduledCandidate[] {
  const first = nextRunAt(rate, lastRunAt, now);
  if (!first) return [];
  return candidates.slice(0, limit).map((c, i) => ({
    ...c,
    at: new Date(first.getTime() + Math.floor(i / rate.count) * rate.everyMinutes * 60_000).toISOString(),
  }));
}

export function rateFor(config: HuntingConfig, list: HuntList): HuntRate {
  return list === 'missing' ? config.missing : config.cutoff;
}

/** After this long without a grab, a search counts as "nothing found". */
const NOTHING_AFTER = 2 * HOUR;

/** Derives the result of a search from the *arr history. */
export function resolveResult(
  search: HuntSearchRecord,
  history: readonly HistoryEvent[],
  now: Date,
): HuntResult {
  const since = Date.parse(search.at);
  const ids = new Set(search.mediaIds);
  const events = history.filter((e) => e.mediaId !== null && ids.has(e.mediaId) && Date.parse(e.at) >= since);
  if (events.some((e) => e.type === 'imported')) return 'imported';
  if (events.some((e) => e.type === 'failed')) return 'failed';
  if (events.some((e) => e.type === 'grabbed')) return 'grabbed';
  return now.getTime() - since >= NOTHING_AFTER ? 'nothing' : 'pending';
}

/** Results that can still change and need another look at the history. */
export function isOpen(result: HuntResult): boolean {
  return result === 'pending' || result === 'grabbed' || result === 'nothing';
}

export interface SuccessStats {
  searches: number;
  finished: number;
  found: number;
  imported: number;
  /** Share of finished searches that found something, 0..1, or null. */
  rate: number | null;
}

export function successStats(searches: readonly HuntSearchRecord[]): SuccessStats {
  const finished = searches.filter((s) => s.result !== 'pending');
  const found = finished.filter(
    (s) => s.result === 'grabbed' || s.result === 'imported' || s.result === 'failed',
  ).length;
  const imported = finished.filter((s) => s.result === 'imported').length;
  return {
    searches: searches.length,
    finished: finished.length,
    found,
    imported,
    rate: finished.length ? found / finished.length : null,
  };
}
