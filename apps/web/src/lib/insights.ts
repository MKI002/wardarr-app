// Types and helpers of the indexer insights page. The shapes mirror
// apps/server/src/indexers/insights/report.ts.
import type { ChartTone } from '../components/charts';
import { tint } from '../components/charts';

export type InsightsRange = '24h' | '7d' | '30d' | '90d';
export const RANGES: InsightsRange[] = ['24h', '7d', '30d', '90d'];

export type CellState = 'synced' | 'direct' | 'both' | 'missing' | 'off';

export interface SeriesSet {
  queries: number[];
  grabs: number[];
  failed: number[];
  responseMs: Array<number | null>;
}

export interface TrackerMetrics {
  queries: number;
  rssQueries: number;
  grabs: number;
  failedQueries: number;
  failedGrabs: number;
  successRate: number | null;
  grabRate: number | null;
  averageResponseMs: number | null;
  averageGrabResponseMs: number | null;
  uptime: number | null;
  outages: number;
  downMs: number;
  arrGrabs: number;
  imported: number;
  failedDownloads: number;
  pending: number;
  importRate: number | null;
  medianImportMinutes: number | null;
  grabbedBytes: number;
  score: number | null;
}

export interface TrackerRow {
  key: string;
  name: string;
  protocol: 'usenet' | 'torrent' | 'unknown';
  privacy: 'public' | 'semiPrivate' | 'private' | null;
  prowlarr: { instanceId: string; instanceName: string; indexerId: number } | null;
  enabled: boolean;
  failing: boolean;
  present: boolean;
  apps: Array<{ instanceId: string; state: CellState }>;
  metrics: TrackerMetrics;
  previous: { queries: number; grabs: number; successRate: number | null; averageResponseMs: number | null };
  series: SeriesSet;
  downtime: Array<{ start: string; end: string }>;
  /** Start of what Wardarr watched in the range; uptime counts from here. */
  observedFrom: string | null;
}

export type InsightKind =
  | 'failing'
  | 'duplicate'
  | 'missing'
  | 'orphan'
  | 'mixed'
  | 'directOnly'
  | 'unmatchedApp'
  | 'unknownProwlarr'
  | 'highFailRate'
  | 'slow'
  | 'noGrabs'
  | 'lowImport'
  | 'best';

export interface Insight {
  kind: InsightKind;
  tone: 'critical' | 'warning' | 'info' | 'ok';
  params: Record<string, string | number>;
  url: string | null;
  trackerKey?: string;
  instanceId?: string;
}

export type AppMode = 'prowlarr' | 'direct' | 'mixed' | 'none' | 'unknown';

export interface AppReport {
  instanceId: string;
  instanceName: string;
  adapter: string;
  error: string | null;
  url: string | null;
  mode: AppMode;
  prowlarrApp: {
    prowlarrInstanceId: string;
    prowlarrName: string;
    appId: number;
    appName: string;
    syncLevel: 'disabled' | 'addOnly' | 'fullSync' | null;
  } | null;
  counts: {
    total: number;
    synced: number;
    direct: number;
    duplicate: number;
    missing: number;
    orphan: number;
    searchOff: number;
  };
  indexers: Array<{
    id: number;
    name: string;
    key: string;
    source: 'prowlarr' | 'direct';
    evidence: 'url' | 'name' | 'none';
    protocol: string;
    implementation: string;
    priority: number | null;
    flags: string[];
    duplicateOf: string[];
    search: { rss: boolean; automatic: boolean; interactive: boolean };
  }>;
  missing: Array<{ key: string; name: string }>;
  grabs: { total: number; imported: number; failed: number };
  history: Array<{ day: string; synced: number; direct: number; duplicate: number; missing: number }>;
}

export interface InsightsReport {
  generatedAt: string;
  range: InsightsRange;
  from: string;
  to: string;
  stepMs: number;
  points: string[];
  collection: {
    running: boolean;
    /** Which app gets which indexer is still being read; older servers leave it out. */
    sourcesPending?: boolean;
    lastRunAt: string | null;
    since: string | null;
    errors: Array<{ instanceId: string; error: string }>;
  };
  prowlarrs: Array<{
    instanceId: string;
    instanceName: string;
    error: string | null;
    indexers: number;
    apps: number;
    url: string | null;
  }>;
  apps: AppReport[];
  unmatchedApps: Array<{ prowlarrInstanceId: string; appId: number; name: string; implementation: string }>;
  trackers: TrackerRow[];
  totals: {
    queries: number;
    grabs: number;
    failedQueries: number;
    successRate: number | null;
    averageResponseMs: number | null;
    arrGrabs: number;
    imported: number;
    importRate: number | null;
    failing: number;
    previous: {
      queries: number;
      grabs: number;
      successRate: number | null;
      averageResponseMs: number | null;
    };
    series: SeriesSet;
  };
  callers: Array<{ name: string; queries: number; grabs: number }>;
  heatmap: { values: number[][]; days: number };
  insights: Insight[];
}

/** Colour and tone per cell state. Sources use accent steps, problems use status colours. */
export const CELL_TONE: Record<CellState, ChartTone> = {
  synced: 'accent',
  direct: 'accent',
  both: 'warning',
  missing: 'critical',
  off: 'neutral',
};

/** "Added by hand" is a lighter step of the accent, so the two sources read as one family. */
export const DIRECT_COLOR = tint('accent', 60);

export function percent(value: number | null, locale: string, digits = 0): string {
  if (value === null) return '–';
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: digits }).format(value);
}

export function number(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}

export function compact(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export function ms(value: number | null, locale: string): string {
  if (value === null) return '–';
  if (value >= 1000)
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value / 1000)} s`;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value)} ms`;
}

export function minutes(value: number, locale: string): string {
  const f = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  if (value < 60) return `${f.format(value)} min`;
  if (value < 48 * 60)
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value / 60)} h`;
  return `${f.format(value / 1440)} d`;
}

/** Label of one series point: time for hours, weekday and time for 6 hours, date for days. */
export function pointLabel(iso: string, stepMs: number, locale: string): string {
  const d = new Date(iso);
  if (stepMs <= 3_600_000)
    return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(d);
  if (stepMs < 86_400_000)
    return new Intl.DateTimeFormat(locale, { weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(
      d,
    );
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(d);
}

/** Change against the previous range in percent points or percent, with sign. */
export function delta(
  now: number | null,
  before: number | null,
  locale: string,
  kind: 'points' | 'relative',
) {
  if (now === null || before === null) return null;
  if (kind === 'points') {
    const d = Math.round((now - before) * 1000) / 10;
    if (d === 0) return null;
    return `${d > 0 ? '+' : '−'}${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Math.abs(d))} pp`;
  }
  if (before === 0) return null;
  const d = (now - before) / before;
  if (Math.abs(d) < 0.005) return null;
  return `${d > 0 ? '+' : '−'}${percent(Math.abs(d), locale)}`;
}

export function scoreTone(score: number | null): ChartTone {
  if (score === null) return 'neutral';
  return 'accent';
}

export function successTone(rate: number | null): 'ok' | 'warning' | 'critical' | 'neutral' {
  if (rate === null) return 'neutral';
  if (rate < 0.5) return 'critical';
  if (rate < 0.8) return 'warning';
  return 'ok';
}
