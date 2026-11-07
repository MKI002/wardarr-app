// Read model of the indexer insights page: per-site metrics, time series,
// outages, app traffic, a weekday x hour heatmap and "worth a look" notes.
import {
  agentProduct,
  downtimeIntervals,
  indexerScore,
  median,
  normalizeIndexerName,
  uptimeRatio,
  weightedAverage,
  type CellState,
  type IndexerInfo,
  type StatusSample,
  stripProwlarrSuffix,
} from '@wardarr/core';
import { and, gte, lt, sql } from 'drizzle-orm';
import type { Db } from '../../db/index.js';
import { indexerGrabs, indexerSourceDaily, indexerStatBuckets, indexerStatusLog } from '../../db/schema.js';
import type { SourcesSnapshot } from './service.js';

export const RANGES = ['24h', '7d', '30d', '90d'] as const;
export type InsightsRange = (typeof RANGES)[number];

const HOUR = 3_600_000;
const DAY = 86_400_000;
const RANGE: Record<InsightsRange, { points: number; step: number }> = {
  '24h': { points: 24, step: HOUR },
  '7d': { points: 28, step: 6 * HOUR },
  '30d': { points: 30, step: DAY },
  '90d': { points: 90, step: DAY },
};

export interface SeriesSet {
  queries: number[];
  grabs: number[];
  failed: number[];
  /** Average answer time per step; null without queries. */
  responseMs: Array<number | null>;
}

export interface TrackerMetrics {
  queries: number;
  rssQueries: number;
  grabs: number;
  failedQueries: number;
  failedGrabs: number;
  /** 0..1, null without enough queries. */
  successRate: number | null;
  /** Grabs per 100 searches. */
  grabRate: number | null;
  averageResponseMs: number | null;
  averageGrabResponseMs: number | null;
  /** 0..1 over the range, null without Prowlarr status data. */
  uptime: number | null;
  outages: number;
  downMs: number;
  /** From *arr history. */
  arrGrabs: number;
  imported: number;
  failedDownloads: number;
  pending: number;
  /** imported / (imported + failed), null with fewer than 3 finished grabs. */
  importRate: number | null;
  medianImportMinutes: number | null;
  grabbedBytes: number;
  score: number | null;
}

export interface TrackerRow {
  key: string;
  name: string;
  protocol: 'usenet' | 'torrent' | 'unknown';
  privacy: IndexerInfo['privacy'] | null;
  /** Prowlarr that manages it, if any. */
  prowlarr: { instanceId: string; instanceName: string; indexerId: number } | null;
  enabled: boolean;
  failing: boolean;
  /** Still set up somewhere (false for names only found in history). */
  present: boolean;
  /** Per app: how the site gets there. */
  apps: Array<{ instanceId: string; state: CellState }>;
  metrics: TrackerMetrics;
  previous: { queries: number; grabs: number; successRate: number | null; averageResponseMs: number | null };
  series: SeriesSet;
  downtime: Array<{ start: string; end: string }>;
  /** Start of what Wardarr watched in the range; uptime counts from here. */
  observedFrom: string | null;
}

export interface Insight {
  kind:
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
  tone: 'critical' | 'warning' | 'info' | 'ok';
  /** Values for the sentence. */
  params: Record<string, string | number>;
  /** Where the fix happens. */
  url: string | null;
  trackerKey?: string;
  instanceId?: string;
}

export interface InsightsReport {
  generatedAt: string;
  range: InsightsRange;
  from: string;
  to: string;
  stepMs: number;
  /** Start of each series point (ISO). */
  points: string[];
  collection: {
    running: boolean;
    /** Which app gets which indexer is still being read. */
    sourcesPending: boolean;
    lastRunAt: string | null;
    /** Earliest stored data point; the history grows from here. */
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
  apps: Array<{
    instanceId: string;
    instanceName: string;
    adapter: string;
    error: string | null;
    url: string | null;
    mode: string;
    prowlarrApp: SourcesSnapshot['analysis']['arrs'][number]['prowlarrApp'];
    counts: SourcesSnapshot['analysis']['arrs'][number]['counts'];
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
  }>;
  unmatchedApps: SourcesSnapshot['analysis']['unmatchedApps'];
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
  /** Calls per calling product (Sonarr, Radarr, ...), from Prowlarr. */
  callers: Array<{ name: string; queries: number; grabs: number }>;
  /** Searches per weekday (Monday first) and hour in the viewer's time zone. */
  heatmap: { values: number[][]; days: number };
  insights: Insight[];
}

interface BuildContext {
  range: InsightsRange;
  timeZone: string;
  now: number;
  sources: SourcesSnapshot;
  /** The sources were not read yet; apps follow once they are. */
  sourcesPending?: boolean;
  states: Array<{ instanceId: string; lastRunAt: string | null; error: string | null }>;
  collecting: boolean;
  prowlarrWebUrl: (instanceId: string) => string | null;
  currentStatus: (instanceId: string, indexerId: number) => IndexerInfo | null;
}

const rate = (part: number, whole: number, min = 1) => (whole >= min ? part / whole : null);
const iso = (t: number) => new Date(t).toISOString();

function emptySeries(n: number): SeriesSet {
  return {
    queries: Array(n).fill(0),
    grabs: Array(n).fill(0),
    failed: Array(n).fill(0),
    responseMs: Array(n).fill(null),
  };
}

const WEEKDAYS: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

function zoneParts(timeZone: string) {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: 'numeric', hourCycle: 'h23' });
  } catch {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      weekday: 'short',
      hour: 'numeric',
      hourCycle: 'h23',
    });
  }
  return (t: number) => {
    const parts = fmt.formatToParts(new Date(t));
    const day = WEEKDAYS[parts.find((p) => p.type === 'weekday')?.value ?? 'Mon'] ?? 0;
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
    return { day, hour };
  };
}

export function buildReport(db: Db, ctx: BuildContext): InsightsReport {
  const { step, points } = RANGE[ctx.range];
  const end = Math.floor(ctx.now / step) * step + step;
  const from = end - points * step;
  const span = end - from;
  const prevFrom = from - span;
  const { analysis } = ctx.sources;
  const prowlarrName = new Map(ctx.sources.prowlarrs.map((p) => [p.instanceId, p.instanceName]));

  // ------------------------------------------------------------ trackers
  const rows = new Map<string, TrackerRow>();
  const blankMetrics = (): TrackerMetrics => ({
    queries: 0,
    rssQueries: 0,
    grabs: 0,
    failedQueries: 0,
    failedGrabs: 0,
    successRate: null,
    grabRate: null,
    averageResponseMs: null,
    averageGrabResponseMs: null,
    uptime: null,
    outages: 0,
    downMs: 0,
    arrGrabs: 0,
    imported: 0,
    failedDownloads: 0,
    pending: 0,
    importRate: null,
    medianImportMinutes: null,
    grabbedBytes: 0,
    score: null,
  });
  for (const t of analysis.trackers) {
    const status = t.prowlarr ? ctx.currentStatus(t.prowlarr.instanceId, t.prowlarr.indexerId) : null;
    rows.set(t.key, {
      key: t.key,
      name: t.name,
      protocol: t.protocol,
      privacy: t.privacy,
      prowlarr: t.prowlarr
        ? { ...t.prowlarr, instanceName: prowlarrName.get(t.prowlarr.instanceId) ?? '' }
        : null,
      enabled: t.enabled,
      failing: !!status && status.enabled && status.failing,
      present: true,
      apps: analysis.cells
        .filter((c) => c.key === t.key)
        .map((c) => ({ instanceId: c.instanceId, state: c.state })),
      metrics: blankMetrics(),
      previous: { queries: 0, grabs: 0, successRate: null, averageResponseMs: null },
      series: emptySeries(points),
      downtime: [],
      observedFrom: null,
    });
  }
  const prowlarrKey = (instanceId: string, indexerId: number) => `p:${instanceId}:${indexerId}`;
  const ensure = (key: string, name: string) => {
    let row = rows.get(key);
    if (!row) {
      row = {
        key,
        name,
        protocol: 'unknown',
        privacy: null,
        prowlarr: null,
        enabled: false,
        failing: false,
        present: false,
        apps: [],
        metrics: blankMetrics(),
        previous: { queries: 0, grabs: 0, successRate: null, averageResponseMs: null },
        series: emptySeries(points),
        downtime: [],
        observedFrom: null,
      };
      rows.set(key, row);
    }
    return row;
  };

  // ------------------------------------------------------ Prowlarr stats
  const stats = db
    .select()
    .from(indexerStatBuckets)
    .where(
      and(gte(indexerStatBuckets.bucketStart, iso(prevFrom)), lt(indexerStatBuckets.bucketStart, iso(end))),
    )
    .all();
  const responses = new Map<string, Array<{ value: number | null; weight: number }>>();
  const grabResponses = new Map<string, Array<{ value: number | null; weight: number }>>();
  const prevResponses = new Map<string, Array<{ value: number | null; weight: number }>>();
  const stepResponses = new Map<string, Array<Array<{ value: number | null; weight: number }>>>();
  const total = emptySeries(points);
  const totalStepResponses: Array<Array<{ value: number | null; weight: number }>> = Array.from(
    { length: points },
    () => [],
  );
  const prevFailedBy = new Map<string, number>();
  const prev = {
    queries: 0,
    grabs: 0,
    failedQueries: 0,
    responses: [] as Array<{ value: number | null; weight: number }>,
  };
  const heat = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
  const zone = zoneParts(ctx.timeZone);
  const heatFrom = Math.min(from, end - 7 * DAY);
  let earliest: number | null = null;

  for (const s of stats) {
    const t = Date.parse(s.bucketStart);
    earliest = earliest === null ? t : Math.min(earliest, t);
    const row = ensure(prowlarrKey(s.instanceId, s.indexerId), s.indexerName);
    if (t < from) {
      row.previous.queries += s.queries;
      row.previous.grabs += s.grabs;
      const list = prevResponses.get(row.key) ?? [];
      list.push({ value: s.avgResponseMs, weight: s.queries });
      prevResponses.set(row.key, list);
      prev.queries += s.queries;
      prev.grabs += s.grabs;
      prev.failedQueries += s.failedQueries;
      prev.responses.push({ value: s.avgResponseMs, weight: s.queries });
      prevFailedBy.set(row.key, (prevFailedBy.get(row.key) ?? 0) + s.failedQueries);
      continue;
    }
    const m = row.metrics;
    m.queries += s.queries;
    m.rssQueries += s.rssQueries;
    m.grabs += s.grabs;
    m.failedQueries += s.failedQueries;
    m.failedGrabs += s.failedGrabs;
    (responses.get(row.key) ?? responses.set(row.key, []).get(row.key)!).push({
      value: s.avgResponseMs,
      weight: s.queries,
    });
    (grabResponses.get(row.key) ?? grabResponses.set(row.key, []).get(row.key)!).push({
      value: s.avgGrabResponseMs,
      weight: s.grabs,
    });
    const i = Math.min(points - 1, Math.floor((t - from) / step));
    row.series.queries[i]! += s.queries;
    row.series.grabs[i]! += s.grabs;
    row.series.failed[i]! += s.failedQueries;
    total.queries[i]! += s.queries;
    total.grabs[i]! += s.grabs;
    total.failed[i]! += s.failedQueries;
    const steps = stepResponses.get(row.key) ?? Array.from({ length: points }, () => []);
    steps[i]!.push({ value: s.avgResponseMs, weight: s.queries });
    stepResponses.set(row.key, steps);
    totalStepResponses[i]!.push({ value: s.avgResponseMs, weight: s.queries });
  }
  for (const s of stats) {
    const t = Date.parse(s.bucketStart);
    if (s.bucketMinutes !== 60 || t < heatFrom) continue;
    const { day, hour } = zone(t);
    heat[day]![hour]! += s.queries;
  }
  // Heat from rows older than the range needs them loaded too.
  if (heatFrom < prevFrom) {
    const extra = db
      .select({
        bucketStart: indexerStatBuckets.bucketStart,
        queries: sql<number>`sum(${indexerStatBuckets.queries})`,
      })
      .from(indexerStatBuckets)
      .where(
        and(
          gte(indexerStatBuckets.bucketStart, iso(heatFrom)),
          lt(indexerStatBuckets.bucketStart, iso(prevFrom)),
          sql`${indexerStatBuckets.bucketMinutes} = 60`,
        ),
      )
      .groupBy(indexerStatBuckets.bucketStart)
      .all();
    for (const e of extra) {
      const { day, hour } = zone(Date.parse(e.bucketStart));
      heat[day]![hour]! += Number(e.queries);
    }
  }

  // ------------------------------------------------------------- outages
  const statusRows = db
    .select()
    .from(indexerStatusLog)
    .where(lt(indexerStatusLog.at, iso(end)))
    .orderBy(indexerStatusLog.at)
    .all();
  const samples = new Map<string, { before: StatusSample | null; within: StatusSample[]; first: number }>();
  for (const r of statusRows) {
    const key = prowlarrKey(r.instanceId, r.indexerId);
    const t = Date.parse(r.at);
    const entry = samples.get(key) ?? { before: null, within: [], first: t };
    if (t < from) entry.before = { at: t, failing: r.failing };
    else entry.within.push({ at: t, failing: r.failing });
    samples.set(key, entry);
  }
  for (const [key, s] of samples) {
    const row = rows.get(key);
    if (!row) continue;
    // Uptime only counts from the first time Wardarr saw the indexer.
    const start = Math.max(from, s.first);
    const end2 = Math.min(end, ctx.now);
    const intervals = downtimeIntervals(s.within, start, end2, s.before);
    row.downtime = intervals.map((i) => ({ start: iso(i.start), end: iso(i.end) }));
    row.observedFrom = end2 > start ? iso(start) : null;
    row.metrics.outages = intervals.length;
    row.metrics.downMs = intervals.reduce((sum, i) => sum + (i.end - i.start), 0);
    // A switched off indexer has no availability to speak of.
    row.metrics.uptime = end2 > start && row.enabled ? uptimeRatio(intervals, start, end2) : null;
  }

  // ------------------------------------------------------- *arr history
  const nameToKey = new Map<string, string>();
  for (const a of analysis.arrs)
    for (const ix of a.indexers)
      nameToKey.set(`${a.instanceId}\u0000${ix.name.trim().toLowerCase()}`, ix.key);
  const byNorm = new Map<string, string>();
  for (const r of rows.values()) byNorm.set(normalizeIndexerName(r.name), r.key);

  const grabs = db
    .select()
    .from(indexerGrabs)
    .where(and(gte(indexerGrabs.grabbedAt, iso(from)), lt(indexerGrabs.grabbedAt, iso(end))))
    .all();
  const importMinutes = new Map<string, number[]>();
  const appGrabs = new Map<string, { total: number; imported: number; failed: number }>();
  let arrGrabs = 0;
  let imported = 0;
  let failedDownloads = 0;
  for (const g of grabs) {
    const key =
      nameToKey.get(`${g.instanceId}\u0000${g.indexer.trim().toLowerCase()}`) ??
      byNorm.get(normalizeIndexerName(g.indexer)) ??
      `d:${normalizeIndexerName(g.indexer) || g.indexer}`;
    const row = ensure(key, stripProwlarrSuffix(g.indexer));
    const m = row.metrics;
    m.arrGrabs++;
    m.grabbedBytes += g.sizeBytes ?? 0;
    const a = appGrabs.get(g.instanceId) ?? { total: 0, imported: 0, failed: 0 };
    a.total++;
    arrGrabs++;
    if (g.importedAt) {
      m.imported++;
      a.imported++;
      imported++;
      const mins = (Date.parse(g.importedAt) - Date.parse(g.grabbedAt)) / 60_000;
      if (mins >= 0) (importMinutes.get(key) ?? importMinutes.set(key, []).get(key)!).push(mins);
    } else if (g.failedAt) {
      m.failedDownloads++;
      a.failed++;
      failedDownloads++;
    } else m.pending++;
    appGrabs.set(g.instanceId, a);
  }

  // ------------------------------------------------------------- finish
  for (const row of rows.values()) {
    const m = row.metrics;
    m.successRate = m.queries >= 10 ? 1 - m.failedQueries / m.queries : null;
    m.grabRate = m.queries - m.rssQueries >= 20 ? (m.grabs / (m.queries - m.rssQueries)) * 100 : null;
    m.averageResponseMs = weightedAverage(responses.get(row.key) ?? []);
    m.averageGrabResponseMs = weightedAverage(grabResponses.get(row.key) ?? []);
    m.importRate = rate(m.imported, m.imported + m.failedDownloads, 3);
    const mins = median(importMinutes.get(row.key) ?? []);
    m.medianImportMinutes = mins === null ? null : Math.round(mins);
    // Availability alone says nothing about an indexer nobody used.
    m.score =
      m.successRate === null && m.importRate === null
        ? null
        : indexerScore({
            successRate: m.successRate,
            averageResponseMs: m.averageResponseMs,
            uptime: m.uptime,
            importRate: m.importRate,
          });
    const steps = stepResponses.get(row.key);
    if (steps) row.series.responseMs = steps.map((s) => roundOrNull(weightedAverage(s)));
    if (m.averageResponseMs !== null) m.averageResponseMs = Math.round(m.averageResponseMs);
    if (m.averageGrabResponseMs !== null) m.averageGrabResponseMs = Math.round(m.averageGrabResponseMs);
    const prevFailed = prevFailedBy.get(row.key) ?? 0;
    row.previous = {
      queries: row.previous.queries,
      grabs: row.previous.grabs,
      successRate: row.previous.queries >= 10 ? 1 - prevFailed / row.previous.queries : null,
      averageResponseMs: roundOrNull(weightedAverage(prevResponses.get(row.key) ?? [])),
    };
  }
  total.responseMs = totalStepResponses.map((s) => roundOrNull(weightedAverage(s)));

  const trackerList = [...rows.values()]
    .filter((r) => r.present || r.metrics.arrGrabs > 0 || r.metrics.queries > 0)
    .sort((a, b) => (b.metrics.score ?? -1) - (a.metrics.score ?? -1) || a.name.localeCompare(b.name));

  const totalQueries = trackerList.reduce((s, r) => s + r.metrics.queries, 0);
  const totalFailed = trackerList.reduce((s, r) => s + r.metrics.failedQueries, 0);
  const totals: InsightsReport['totals'] = {
    queries: totalQueries,
    grabs: trackerList.reduce((s, r) => s + r.metrics.grabs, 0),
    failedQueries: totalFailed,
    successRate: totalQueries >= 10 ? 1 - totalFailed / totalQueries : null,
    averageResponseMs: roundOrNull(weightedAverage([...responses.values()].flat())),
    arrGrabs,
    imported,
    importRate: rate(imported, imported + failedDownloads, 3),
    failing: trackerList.filter((r) => r.failing).length,
    previous: {
      queries: prev.queries,
      grabs: prev.grabs,
      successRate: prev.queries >= 10 ? 1 - prev.failedQueries / prev.queries : null,
      averageResponseMs: roundOrNull(weightedAverage(prev.responses)),
    },
    series: total,
  };

  // ------------------------------------------------------------ callers
  const agentRows = db.all<{ agent: string; queries: number; grabs: number }>(sql`
    SELECT agent, sum(queries) AS queries, sum(grabs) AS grabs FROM indexer_agent_buckets
    WHERE bucket_start >= ${iso(from)} AND bucket_start < ${iso(end)} GROUP BY agent`);
  const callers = new Map<string, { name: string; queries: number; grabs: number }>();
  for (const a of agentRows) {
    const name = agentProduct(a.agent);
    const c = callers.get(name) ?? { name, queries: 0, grabs: 0 };
    c.queries += Number(a.queries);
    c.grabs += Number(a.grabs);
    callers.set(name, c);
  }

  // --------------------------------------------------------------- apps
  const historyRows = db
    .select()
    .from(indexerSourceDaily)
    .where(gte(indexerSourceDaily.day, iso(from).slice(0, 10)))
    .orderBy(indexerSourceDaily.day)
    .all();
  const apps: InsightsReport['apps'] = analysis.arrs.map((r) => {
    const side = ctx.sources.arrs.find((a) => a.instanceId === r.instanceId);
    return {
      instanceId: r.instanceId,
      instanceName: r.instanceName,
      adapter: r.adapter,
      error: side?.error ?? null,
      url: side?.webUrl ?? null,
      mode: r.mode,
      prowlarrApp: r.prowlarrApp,
      counts: r.counts,
      indexers: r.indexers.map((ix) => ({
        id: ix.id,
        name: ix.name,
        key: ix.key,
        source: ix.source,
        evidence: ix.evidence,
        protocol: ix.protocol,
        implementation: ix.implementation,
        priority: ix.priority,
        flags: ix.flags,
        duplicateOf: ix.duplicateOf,
        search: {
          rss: ix.enableRss,
          automatic: ix.enableAutomaticSearch,
          interactive: ix.enableInteractiveSearch,
        },
      })),
      missing: r.missing.map((m) => ({ key: m.key, name: m.name })),
      grabs: appGrabs.get(r.instanceId) ?? { total: 0, imported: 0, failed: 0 },
      history: historyRows
        .filter((h) => h.instanceId === r.instanceId)
        .map((h) => ({
          day: h.day,
          synced: h.synced,
          direct: h.direct,
          duplicate: h.duplicate,
          missing: h.missing,
        })),
    };
  });

  const report: InsightsReport = {
    generatedAt: iso(ctx.now),
    range: ctx.range,
    from: iso(from),
    to: iso(end),
    stepMs: step,
    points: Array.from({ length: points }, (_, i) => iso(from + i * step)),
    collection: {
      running: ctx.collecting,
      sourcesPending: ctx.sourcesPending ?? false,
      lastRunAt:
        ctx.states
          .map((s) => s.lastRunAt)
          .filter((x): x is string => !!x)
          .sort()
          .at(-1) ?? null,
      since: earliest === null ? (grabs[0]?.grabbedAt ?? null) : iso(earliest),
      errors: ctx.states.filter((s) => s.error).map((s) => ({ instanceId: s.instanceId, error: s.error! })),
    },
    prowlarrs: ctx.sources.prowlarrs.map((p) => ({
      instanceId: p.instanceId,
      instanceName: p.instanceName,
      error: p.error,
      indexers: p.indexers.length,
      apps: p.apps.length,
      url: ctx.prowlarrWebUrl(p.instanceId),
    })),
    apps,
    unmatchedApps: analysis.unmatchedApps,
    trackers: trackerList,
    totals,
    callers: [...callers.values()].sort((a, b) => b.queries - a.queries),
    heatmap: { values: heat, days: Math.round((end - heatFrom) / DAY) },
    insights: [],
  };
  report.insights = buildInsights(report, ctx);
  return report;
}

function roundOrNull(v: number | null): number | null {
  return v === null ? null : Math.round(v);
}

const TONE_ORDER = { critical: 0, warning: 1, info: 2, ok: 3 } as const;

export function buildInsights(report: InsightsReport, ctx: Pick<BuildContext, 'prowlarrWebUrl'>): Insight[] {
  const out: Insight[] = [];
  const appName = new Map(report.apps.map((a) => [a.instanceId, a.instanceName]));
  const anyProwlarr = report.prowlarrs.length > 0;

  for (const t of report.trackers) {
    const m = t.metrics;
    const purl = t.prowlarr ? ctx.prowlarrWebUrl(t.prowlarr.instanceId) : null;
    if (t.failing) {
      const affected = t.apps
        .filter((a) => a.state !== 'missing' && a.state !== 'off')
        .map((a) => appName.get(a.instanceId));
      out.push({
        kind: 'failing',
        tone: 'critical',
        params: { name: t.name, apps: affected.filter(Boolean).join(', '), count: affected.length },
        url: purl,
        trackerKey: t.key,
      });
    }
    if (m.successRate !== null && m.queries >= 50 && m.successRate < 0.8) {
      out.push({
        kind: 'highFailRate',
        tone: 'warning',
        params: { name: t.name, percent: Math.round((1 - m.successRate) * 100), queries: m.queries },
        url: purl,
        trackerKey: t.key,
      });
    }
    if (m.averageResponseMs !== null && m.averageResponseMs >= 3000 && m.queries >= 20) {
      out.push({
        kind: 'slow',
        tone: 'info',
        params: { name: t.name, ms: m.averageResponseMs },
        url: purl,
        trackerKey: t.key,
      });
    }
    if (m.queries - m.rssQueries >= 200 && m.grabs === 0 && m.arrGrabs === 0) {
      out.push({
        kind: 'noGrabs',
        tone: 'info',
        params: { name: t.name, queries: m.queries - m.rssQueries },
        url: purl,
        trackerKey: t.key,
      });
    }
    if (m.importRate !== null && m.importRate < 0.5 && m.imported + m.failedDownloads >= 5) {
      out.push({
        kind: 'lowImport',
        tone: 'warning',
        params: { name: t.name, percent: Math.round(m.importRate * 100), failed: m.failedDownloads },
        url: null,
        trackerKey: t.key,
      });
    }
  }

  for (const a of report.apps) {
    for (const ix of a.indexers) {
      if (ix.flags.includes('duplicate') && ix.source === 'direct') {
        out.push({
          kind: 'duplicate',
          tone: 'warning',
          params: { app: a.instanceName, name: ix.name, other: ix.duplicateOf.join(', ') },
          url: a.url,
          instanceId: a.instanceId,
          trackerKey: ix.key,
        });
      }
      if (ix.flags.includes('orphan')) {
        out.push({
          kind: 'orphan',
          tone: 'warning',
          params: { app: a.instanceName, name: ix.name },
          url: a.url,
          instanceId: a.instanceId,
          trackerKey: ix.key,
        });
      }
      if (ix.flags.includes('unknownProwlarr')) {
        out.push({
          kind: 'unknownProwlarr',
          tone: 'info',
          params: { app: a.instanceName, name: ix.name },
          url: a.url,
          instanceId: a.instanceId,
        });
      }
    }
    if (a.missing.length > 0) {
      out.push({
        kind: 'missing',
        tone: 'warning',
        params: {
          app: a.instanceName,
          list: a.missing.map((m) => m.name).join(', '),
          count: a.missing.length,
        },
        url: a.prowlarrApp ? ctx.prowlarrWebUrl(a.prowlarrApp.prowlarrInstanceId) : null,
        instanceId: a.instanceId,
      });
    }
    if (a.mode === 'mixed') {
      out.push({
        kind: 'mixed',
        tone: 'info',
        params: { app: a.instanceName, direct: a.counts.direct, synced: a.counts.synced },
        url: a.url,
        instanceId: a.instanceId,
      });
    }
    if (a.mode === 'direct' && anyProwlarr && !a.prowlarrApp) {
      out.push({
        kind: 'directOnly',
        tone: 'info',
        params: { app: a.instanceName, count: a.counts.direct },
        url: a.url,
        instanceId: a.instanceId,
      });
    }
  }
  for (const u of report.unmatchedApps) {
    out.push({
      kind: 'unmatchedApp',
      tone: 'info',
      params: { name: u.name, implementation: u.implementation },
      url: ctx.prowlarrWebUrl(u.prowlarrInstanceId),
    });
  }

  const best = report.trackers.find((t) => t.metrics.score !== null && t.metrics.queries >= 50 && !t.failing);
  if (best && best.metrics.score! >= 80) {
    out.push({
      kind: 'best',
      tone: 'ok',
      params: { name: best.name, score: best.metrics.score! },
      url: null,
      trackerKey: best.key,
    });
  }
  return out.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);
}
