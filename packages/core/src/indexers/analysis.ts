// Pure helpers for the indexer analysis: downtime from status samples, a
// combined score and time series from stored buckets.

export interface StatusSample {
  /** Epoch ms. */
  at: number;
  failing: boolean;
}

export interface Interval {
  start: number;
  end: number;
}

/**
 * Failing intervals within [from, to]. `before` is the last sample before
 * `from`, so an outage that started earlier is counted from `from`.
 */
export function downtimeIntervals(
  samples: readonly StatusSample[],
  from: number,
  to: number,
  before: StatusSample | null = null,
): Interval[] {
  const out: Interval[] = [];
  let start: number | null = before?.failing ? from : null;
  for (const s of [...samples].sort((a, b) => a.at - b.at)) {
    if (s.at < from || s.at > to) continue;
    if (s.failing && start === null) start = s.at;
    else if (!s.failing && start !== null) {
      out.push({ start, end: s.at });
      start = null;
    }
  }
  if (start !== null) out.push({ start, end: to });
  return out.filter((i) => i.end > i.start);
}

/** Share of [from, to] without an outage, 0..1. */
export function uptimeRatio(intervals: readonly Interval[], from: number, to: number): number {
  const span = to - from;
  if (span <= 0) return 1;
  const down = intervals.reduce(
    (sum, i) => sum + Math.max(0, Math.min(i.end, to) - Math.max(i.start, from)),
    0,
  );
  return Math.max(0, Math.min(1, 1 - down / span));
}

/** 1 for answers up to 400 ms, 0 from 6 s on, logarithmic in between. */
export function responseScore(ms: number): number {
  const fast = 400;
  const slow = 6000;
  if (ms <= fast) return 1;
  if (ms >= slow) return 0;
  return 1 - Math.log(ms / fast) / Math.log(slow / fast);
}

export interface ScoreInput {
  /** Successful queries / all queries, 0..1. */
  successRate: number | null;
  averageResponseMs: number | null;
  /** 0..1 */
  uptime: number | null;
  /** Imported grabs / finished grabs, 0..1. */
  importRate: number | null;
}

export const SCORE_WEIGHTS = { successRate: 0.35, response: 0.2, uptime: 0.25, importRate: 0.2 } as const;

/**
 * A 0-100 score that combines reliability, speed, availability and whether
 * grabs end up in the library. Missing parts are left out and the others
 * weighted up, so a direct indexer without Prowlarr numbers still gets one.
 */
export function indexerScore(input: ScoreInput): number | null {
  const parts: Array<[number, number]> = [];
  if (input.successRate !== null) parts.push([input.successRate, SCORE_WEIGHTS.successRate]);
  if (input.averageResponseMs !== null)
    parts.push([responseScore(input.averageResponseMs), SCORE_WEIGHTS.response]);
  if (input.uptime !== null) parts.push([input.uptime, SCORE_WEIGHTS.uptime]);
  if (input.importRate !== null) parts.push([input.importRate, SCORE_WEIGHTS.importRate]);
  if (parts.length === 0) return null;
  const weight = parts.reduce((s, [, w]) => s + w, 0);
  const value = parts.reduce((s, [v, w]) => s + Math.max(0, Math.min(1, v)) * w, 0) / weight;
  return Math.round(value * 100);
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Average of `value` weighted by `weight`, ignoring entries without a value. */
export function weightedAverage(
  items: ReadonlyArray<{ value: number | null; weight: number }>,
): number | null {
  let sum = 0;
  let weight = 0;
  for (const i of items) {
    if (i.value === null || i.weight <= 0) continue;
    sum += i.value * i.weight;
    weight += i.weight;
  }
  return weight > 0 ? sum / weight : null;
}

/** Product name of a Prowlarr user agent, for example `Sonarr/4.0.15` -> `Sonarr`. */
export function agentProduct(agent: string): string {
  const name = agent.split(/[/\s(]/)[0]?.trim() ?? '';
  return name || agent;
}

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

export interface StatsWindow {
  /** Epoch ms, aligned to the hour or the UTC day. */
  start: number;
  minutes: 60 | 1440;
}

/**
 * Windows to read from Prowlarr. Recent days are read per hour, older ones
 * per day. `cursor` is the start of the next window to read; the newest
 * hour is read again on every run because it was still open last time.
 */
export function planStatsWindows(
  cursor: number | null,
  now: number,
  opts: { hourlyDays?: number; backfillDays?: number } = {},
): StatsWindow[] {
  const hourlyDays = opts.hourlyDays ?? 7;
  const backfillDays = opts.backfillDays ?? 30;
  const today = Math.floor(now / DAY_MS) * DAY_MS;
  const currentHour = Math.floor(now / HOUR_MS) * HOUR_MS;
  const hourlyBegin = today - hourlyDays * DAY_MS;
  const earliest = today - backfillDays * DAY_MS;
  let t = Math.floor(Math.max(cursor ?? earliest, earliest) / HOUR_MS) * HOUR_MS;
  const out: StatsWindow[] = [];
  if (t < hourlyBegin) {
    // Finish a started day per hour, then whole days.
    const dayEnd = Math.ceil(t / DAY_MS) * DAY_MS;
    for (; t < dayEnd && t < hourlyBegin; t += HOUR_MS) out.push({ start: t, minutes: 60 });
    for (; t < hourlyBegin; t += DAY_MS) out.push({ start: t, minutes: 1440 });
  }
  for (; t <= currentHour; t += HOUR_MS) out.push({ start: t, minutes: 60 });
  return out;
}
