// When does a disk run full? Wardarr fits the growth of used space over the
// last weeks and projects it forward from today's free space.
//
// The fit is a Theil-Sen line: the median of the slopes between every pair of
// days. A cleanup that frees a terabyte in one night moves a handful of pairs,
// not the median, so one big delete does not make the disk look "stable"
// for a month. The 25th and 75th percentile slopes give an honest range.

export interface UsageSample {
  at: string;
  usedBytes: number;
}

export type ForecastStatus = 'collecting' | 'stable' | 'filling' | 'full';

export interface Forecast {
  status: ForecastStatus;
  /** Median growth of used space, bytes per day (negative when shrinking). */
  bytesPerDay: number | null;
  /** Days until free space reaches zero at the median rate. */
  daysLeft: number | null;
  fullAt: string | null;
  /** Range of the projection: fast growth (earliest) and slow growth (latest, null = maybe never). */
  earliestAt: string | null;
  latestAt: string | null;
  /** Days of history the forecast is based on. */
  basisDays: number;
}

export interface ForecastOptions {
  /** How far back the fit looks. */
  lookbackDays?: number;
  /** Fewer days of history than this give no forecast yet. */
  minDays?: number;
}

const DAY = 86_400_000;
/** A disk that needs more than this to run full counts as stable. */
const HORIZON_DAYS = 5 * 365;

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** One point per UTC day: the last sample of that day. */
export function dailyPoints(samples: UsageSample[]): UsageSample[] {
  const byDay = new Map<string, UsageSample>();
  for (const s of [...samples].sort((a, b) => a.at.localeCompare(b.at))) byDay.set(s.at.slice(0, 10), s);
  return [...byDay.values()];
}

export function forecastDisk(
  samples: UsageSample[],
  current: { freeBytes: number; totalBytes: number },
  now: Date,
  opts: ForecastOptions = {},
): Forecast {
  const lookback = opts.lookbackDays ?? 30;
  const minDays = opts.minDays ?? 3;
  const since = now.getTime() - lookback * DAY;
  const points = dailyPoints(samples.filter((s) => Date.parse(s.at) >= since));
  const first = points[0];
  const basisDays = first ? Math.max(0, (now.getTime() - Date.parse(first.at)) / DAY) : 0;
  const empty: Forecast = {
    status: 'collecting',
    bytesPerDay: null,
    daysLeft: null,
    fullAt: null,
    earliestAt: null,
    latestAt: null,
    basisDays: Math.round(basisDays * 10) / 10,
  };
  if (current.freeBytes <= 0) return { ...empty, status: 'full', daysLeft: 0, fullAt: now.toISOString() };
  if (points.length < minDays || basisDays < minDays - 1) return empty;

  const slopes: number[] = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dt = (Date.parse(points[j]!.at) - Date.parse(points[i]!.at)) / DAY;
      if (dt <= 0) continue;
      slopes.push((points[j]!.usedBytes - points[i]!.usedBytes) / dt);
    }
  }
  if (slopes.length === 0) return empty;
  slopes.sort((a, b) => a - b);
  const median = quantile(slopes, 0.5);
  const fast = quantile(slopes, 0.75);
  const slow = quantile(slopes, 0.25);

  const at = (days: number) => new Date(now.getTime() + days * DAY).toISOString();
  const free = current.freeBytes;
  const daysAt = (rate: number) => (rate > 0 ? free / rate : Infinity);
  const days = daysAt(median);
  const result: Forecast = { ...empty, bytesPerDay: Math.round(median) };
  if (!Number.isFinite(days) || days > HORIZON_DAYS) return { ...result, status: 'stable' };
  const early = daysAt(fast);
  const late = daysAt(slow);
  return {
    ...result,
    status: 'filling',
    daysLeft: Math.round(days * 10) / 10,
    fullAt: at(days),
    earliestAt: Number.isFinite(early) ? at(early) : at(days),
    latestAt: Number.isFinite(late) && late <= HORIZON_DAYS ? at(late) : null,
  };
}

export interface StorageThresholds {
  /** Warn when the disk runs full within this many days. */
  warnDays: number;
  /** Critical when it runs full within this many days. */
  criticalDays: number;
  /** Warn below this share of free space, in percent. */
  warnPercent: number;
  /** Critical below this share of free space, in percent. */
  criticalPercent: number;
}

export const DEFAULT_THRESHOLDS: StorageThresholds = {
  warnDays: 30,
  criticalDays: 7,
  warnPercent: 5,
  criticalPercent: 2,
};

export type DiskLevel = 'ok' | 'warning' | 'critical';

/** Why a disk needs attention: it is almost full now, or will be soon. */
export function diskLevel(
  disk: { freeBytes: number; totalBytes: number },
  forecast: Forecast,
  t: StorageThresholds,
): { level: DiskLevel; reason: 'lowSpace' | 'forecast' | null } {
  const pct = disk.totalBytes > 0 ? (disk.freeBytes / disk.totalBytes) * 100 : 100;
  const days = forecast.daysLeft;
  if (pct < t.criticalPercent || forecast.status === 'full') return { level: 'critical', reason: 'lowSpace' };
  if (days !== null && days <= t.criticalDays) return { level: 'critical', reason: 'forecast' };
  if (pct < t.warnPercent) return { level: 'warning', reason: 'lowSpace' };
  if (days !== null && days <= t.warnDays) return { level: 'warning', reason: 'forecast' };
  return { level: 'ok', reason: null };
}
