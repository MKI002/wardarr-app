// Indexer insights: where each app gets its indexers from (synced by
// Prowlarr, added by hand, twice, missing) and how every indexer performs
// over time, from numbers Wardarr keeps in its own database.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
  BarRow,
  Columns,
  Heatmap,
  LiveDot,
  ProgressRing,
  Ring,
  Sparkline,
  tint,
  type ChartTone,
} from '../components/charts';
import { InsightRow, KpiCard, MiniBars, Odometer, PageHeader, SectionRule } from '../components/dash';
import { IndexerTable, OutageBoard, SpeedMap } from '../components/insights/compare';
import { AppSourceCard, SourceMatrix, sourceCounts } from '../components/insights/sources';
import { IssueIcon } from '../components/IssueIcon';
import { Button, Card, EmptyState, Guardian, InlineError, Skeleton, spring } from '../components/ui';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { formatRelative } from '../lib/format';
import {
  DIRECT_COLOR,
  RANGES,
  compact,
  delta,
  ms,
  number,
  percent,
  pointLabel,
  type AppMode,
  type Insight,
  type InsightsRange,
  type InsightsReport,
} from '../lib/insights';

const TIME_ZONE = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
})();

function useInsights(range: InsightsRange) {
  return useQuery({
    queryKey: ['indexerInsights', range],
    queryFn: () =>
      api<InsightsReport>(`/api/indexer-insights?range=${range}&tz=${encodeURIComponent(TIME_ZONE)}`),
    // The server answers from stored data and reads new data in the background;
    // poll faster while it does, in case the update event is missed.
    refetchInterval: (query) => {
      const c = query.state.data?.collection;
      return c?.running || c?.sourcesPending ? 3_000 : 5 * 60_000;
    },
    placeholderData: (prev) => prev,
  });
}

export function IndexerInsightsPage() {
  const { t, i18n } = useTranslation();
  const search = useSearch({ from: '/indexer-insights' });
  const navigate = useNavigate({ from: '/indexer-insights' });
  const range = search.range ?? '7d';
  const client = useQueryClient();
  const data = useInsights(range);
  const refresh = useMutation({
    mutationFn: () =>
      api<InsightsReport>(
        `/api/indexer-insights?range=${range}&tz=${encodeURIComponent(TIME_ZONE)}&refresh=1`,
      ),
    onSuccess: (fresh) => client.setQueryData(['indexerInsights', range], fresh),
  });
  const [open, setOpen] = useState<string | null>(null);

  const select = (key: string) => {
    setOpen(key);
    requestAnimationFrame(() =>
      document.getElementById(`indexer-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
    );
  };

  const report = data.data;
  const since = report?.collection.since
    ? new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short' }).format(
        new Date(report.collection.since),
      )
    : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-2">
            {t('insights.eyebrow', { range: t(`insights.range.long.${range}`) })}
            {since ? (
              <span className="normal-case tracking-normal">· {t('insights.since', { date: since })}</span>
            ) : null}
            {report?.collection.running || report?.collection.sourcesPending || refresh.isPending ? (
              <LiveDot tone="accent" label={t('insights.collecting')} />
            ) : null}
          </span>
        }
        title={t('insights.title')}
        intro={t('insights.intro')}
        actions={
          <>
            <RangeSwitch
              value={range}
              onChange={(r) => void navigate({ search: { range: r === '7d' ? undefined : r } })}
            />
            <Button busy={refresh.isPending || !!report?.collection.running} onClick={() => refresh.mutate()}>
              {t('insights.refresh')}
            </Button>
          </>
        }
      />
      {data.isError ? (
        <InlineError {...errorText(t, data.error)} onRetry={() => void data.refetch()} />
      ) : null}
      {refresh.isError ? <InlineError {...errorText(t, refresh.error)} /> : null}
      {!report ? (
        data.isPending ? (
          <InsightsSkeleton />
        ) : null
      ) : report.apps.length === 0 && report.prowlarrs.length === 0 && !report.collection.sourcesPending ? (
        <Card>
          <EmptyState
            title={t('insights.empty.title')}
            body={t('insights.empty.body')}
            action={
              <Link to="/settings" search={{ section: 'instances' }}>
                <Button variant="primary">{t('ui.overview.emptyAction')}</Button>
              </Link>
            }
          />
        </Card>
      ) : (
        <Dashboard report={report} open={open} setOpen={setOpen} select={select} />
      )}
    </div>
  );
}

function RangeSwitch({ value, onChange }: { value: InsightsRange; onChange: (r: InsightsRange) => void }) {
  const { t } = useTranslation();
  return (
    <div role="tablist" aria-label={t('insights.range.label')} className="flex rounded-xl bg-surface-2 p-1">
      {RANGES.map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={value === id}
          onClick={() => onChange(id)}
          className={`relative rounded-lg px-3 py-1.5 text-sm font-medium ${value === id ? 'text-text' : 'text-muted hover:text-text'}`}
        >
          {value === id ? (
            <motion.span
              layoutId="insights-range"
              className="absolute inset-0 rounded-lg bg-surface shadow-sm"
              transition={spring}
            />
          ) : null}
          <span className="relative">{t(`insights.range.${id}`)}</span>
        </button>
      ))}
    </div>
  );
}

function InsightsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Skeleton className="h-72 rounded-[var(--radius-card)] lg:col-span-3" />
        <Skeleton className="h-72 rounded-[var(--radius-card)] lg:col-span-2" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 rounded-[var(--radius-card)]" />
        ))}
      </div>
    </div>
  );
}

function Dashboard({
  report,
  open,
  setOpen,
  select,
}: {
  report: InsightsReport;
  open: string | null;
  setOpen: (key: string | null) => void;
  select: (key: string) => void;
}) {
  const { t } = useTranslation();
  const names = new Map([
    ...report.apps.map((a) => [a.instanceId, a.instanceName] as const),
    ...report.prowlarrs.map((p) => [p.instanceId, p.instanceName] as const),
  ]);
  return (
    <>
      {report.collection.errors.length > 0 ? (
        <InlineError
          message={t('insights.errors.collect', {
            list: report.collection.errors
              .map(
                (e) =>
                  `${names.get(e.instanceId) ?? e.instanceId} (${t(`ui.instance.testFailed.${e.error}`)})`,
              )
              .join(', '),
          })}
        />
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Hero report={report} />
        <WorthALook report={report} onSelect={select} />
      </div>

      <Kpis report={report} />

      {report.collection.sourcesPending && report.apps.length === 0 ? (
        <section className="flex flex-col gap-4" aria-busy>
          <SectionRule>{t('insights.sections.sources')}</SectionRule>
          <p className="flex items-center gap-2 text-sm text-muted" role="status">
            <LiveDot tone="accent" label={t('insights.collecting')} />
            {t('insights.sourcesPending')}
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-40 rounded-[var(--radius-card)]" />
            ))}
          </div>
        </section>
      ) : null}

      {report.apps.length > 0 ? (
        <section className="flex flex-col gap-4">
          <SectionRule>{t('insights.sections.sources')}</SectionRule>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {report.apps.map((a, i) => (
              <AppSourceCard key={a.instanceId} app={a} index={i} />
            ))}
          </div>
          <SourceMatrix report={report} onSelect={select} />
        </section>
      ) : null}

      {report.trackers.length > 0 ? (
        <section className="flex flex-col gap-4">
          <SectionRule>{t('insights.sections.compare')}</SectionRule>
          <SpeedMap report={report} onSelect={select} />
          <IndexerTable report={report} open={open} onToggle={(key) => setOpen(open === key ? null : key)} />
        </section>
      ) : null}

      <section className="flex flex-col gap-4">
        <SectionRule>{t('insights.sections.time')}</SectionRule>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <SearchColumns report={report} />
          <WhenHeatmap report={report} />
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <OutageBoard report={report} />
          <WhoSearches report={report} />
        </div>
      </section>
    </>
  );
}

// -------------------------------------------------------------------- hero

function joinList(items: string[], lang: string): string {
  try {
    return new Intl.ListFormat(lang, { style: 'long', type: 'conjunction' }).format(items);
  } catch {
    return items.join(', ');
  }
}

function Hero({ report }: { report: InsightsReport }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { totals } = report;
  const hasStats = totals.successRate !== null;
  const value = hasStats ? totals.successRate : totals.importRate;
  const waiting = report.collection.since === null;
  const sentence = waiting
    ? t('insights.hero.waiting')
    : totals.failing > 0
      ? t('insights.hero.failing', { count: totals.failing })
      : !hasStats
        ? t('insights.hero.noStats')
        : totals.successRate! >= 0.95
          ? t('insights.hero.reliable')
          : t('insights.hero.someFail', { percent: percent(1 - totals.successRate!, lang) });
  const change = hasStats ? delta(totals.successRate, totals.previous.successRate, lang, 'points') : null;
  const counts = sourceCounts(report.apps);
  const total = counts.synced + counts.direct + counts.both;
  const modes: AppMode[] = ['prowlarr', 'mixed', 'direct', 'none', 'unknown'];
  const modeSentences = modes
    .map((mode) => {
      const apps = report.apps.filter((a) => a.mode === mode).map((a) => a.instanceName);
      return apps.length ? t(`insights.sentence.${mode}`, { apps: joinList(apps, lang) }) : null;
    })
    .filter((s): s is string => !!s);
  const ringSegments = [
    { key: 'synced', label: t('insights.source.synced'), value: counts.synced, tone: 'accent' as ChartTone },
    {
      key: 'direct',
      label: t('insights.source.direct'),
      value: counts.direct,
      tone: 'accent' as ChartTone,
      color: DIRECT_COLOR,
    },
    { key: 'both', label: t('insights.source.both'), value: counts.both, tone: 'warning' as ChartTone },
    {
      key: 'missing',
      label: t('insights.source.missing'),
      value: counts.missing,
      tone: 'critical' as ChartTone,
    },
  ];
  return (
    <motion.div
      className="lg:col-span-3"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
    >
      <Card as="div" className="flex h-full flex-col gap-6 overflow-hidden sm:flex-row sm:p-7">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <span className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">
            {hasStats ? t('insights.hero.label') : t('insights.hero.importLabel')}
          </span>
          <span className="text-6xl leading-none font-bold tracking-tight">
            {value === null ? t('insights.hero.none') : <Odometer text={percent(value, lang, 1)} />}
          </span>
          <p className="text-base font-medium text-balance">{sentence}</p>
          {change ? (
            <span className="w-fit rounded-full bg-surface-2 px-3 py-1 text-xs font-medium tabular-nums">
              {t('insights.hero.versus', { delta: change, range: t(`insights.range.long.${report.range}`) })}
            </span>
          ) : null}
          <dl className="mt-auto grid grid-cols-3 gap-4 pt-2">
            {[
              [t('insights.hero.searches'), compact(totals.queries, lang)],
              [t('insights.hero.grabs'), compact(hasStats ? totals.grabs : totals.arrGrabs, lang)],
              [t('insights.hero.response'), ms(totals.averageResponseMs, lang)],
            ].map(([label, text]) => (
              <div key={label} className="flex flex-col gap-0.5">
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="text-xl font-semibold tabular-nums">{text}</dd>
              </div>
            ))}
          </dl>
        </div>
        {report.apps.length > 0 ? (
          <div className="flex shrink-0 flex-col items-center gap-3 sm:w-56">
            <Ring segments={ringSegments} size={168} thickness={14} label={t('insights.sourcesRing')}>
              <span className="flex flex-col items-center">
                <span className="text-3xl font-semibold tabular-nums">{total}</span>
                <span className="text-xs text-muted">{t('insights.entries', { count: total })}</span>
              </span>
            </Ring>
            <ul className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-muted">
              {ringSegments
                .filter((s) => s.value > 0)
                .map((s) => (
                  <li key={s.key} className="flex items-center gap-1.5">
                    <span
                      className="size-2.5 rounded-sm"
                      style={{ background: s.color ?? tint(s.tone, 100) }}
                      aria-hidden
                    />
                    {s.label}
                    <span className="text-text tabular-nums">{s.value}</span>
                  </li>
                ))}
            </ul>
            <ul className="flex flex-col gap-1 text-center text-xs text-muted">
              {modeSentences.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>
    </motion.div>
  );
}

// ---------------------------------------------------------- worth a look

const INSIGHT_ICON: Record<string, string> = {
  failing: 'indexerUnavailable:x',
  highFailRate: 'indexerSearch:x',
  slow: 'indexerSearch:x',
  noGrabs: 'indexerSearch:x',
  lowImport: 'downloadsFailed:x',
  missing: 'apiCompat:x',
  orphan: 'apiCompat:x',
  duplicate: 'alert:x',
  mixed: 'alert:x',
  directOnly: 'alert:x',
  unmatchedApp: 'apiCompat:x',
  unknownProwlarr: 'apiCompat:x',
  best: 'indexerSearch:x',
};

function insightValues(i: Insight, lang: string): Record<string, string | number> {
  const out: Record<string, string | number> = { ...i.params };
  if (typeof i.params.percent === 'number') out.percent = percent(i.params.percent / 100, lang);
  if (typeof i.params.queries === 'number') out.queries = number(i.params.queries, lang);
  if (typeof i.params.ms === 'number')
    out.seconds = new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(i.params.ms / 1000);
  return out;
}

function WorthALook({ report, onSelect }: { report: InsightsReport; onSelect: (key: string) => void }) {
  const { t, i18n } = useTranslation();
  const list = report.insights.slice(0, 7);
  const problems = report.insights.filter((i) => i.tone !== 'ok').length;
  return (
    <motion.div
      className="lg:col-span-2"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring, delay: 0.05 }}
    >
      <Card as="div" className="flex h-full flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">{t('insights.worthALook')}</h2>
          {problems > 0 ? (
            <span className="grid size-6 place-items-center rounded-full bg-accent text-xs font-semibold text-accent-contrast tabular-nums">
              {problems}
            </span>
          ) : null}
        </div>
        {problems === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
            <Guardian size={56} glance />
            <p className="font-medium">{t('insights.allGood')}</p>
            <p className="text-sm text-muted">{t('insights.allGoodBody')}</p>
          </div>
        ) : null}
        <ul className="flex flex-col divide-y divide-border">
          <AnimatePresence initial={false}>
            {list
              .filter((i) => problems > 0 || i.tone === 'ok')
              .map((i, idx) => {
                const values = insightValues(i, i18n.language);
                return (
                  <InsightRow
                    key={`${i.kind}:${i.trackerKey ?? ''}:${i.instanceId ?? ''}:${String(i.params.name ?? '')}`}
                    index={idx}
                    icon={
                      <IssueIcon
                        fingerprint={INSIGHT_ICON[i.kind] ?? 'alert:x'}
                        tone={i.tone}
                        label={t(`ui.issues.severity.${i.tone === 'ok' ? 'info' : i.tone}`)}
                      />
                    }
                    action={
                      i.url ? (
                        <a
                          href={i.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="shrink-0 rounded-lg px-2 py-1 text-sm text-accent hover:bg-surface-2"
                        >
                          {t('insights.open')}
                        </a>
                      ) : i.trackerKey ? (
                        <button
                          type="button"
                          onClick={() => onSelect(i.trackerKey!)}
                          className="shrink-0 rounded-lg px-2 py-1 text-sm text-accent hover:bg-surface-2"
                        >
                          {t('insights.open')}
                        </button>
                      ) : undefined
                    }
                  >
                    <Trans
                      i18nKey={`insights.insight.${i.kind}`}
                      values={values}
                      count={typeof i.params.count === 'number' ? i.params.count : undefined}
                      components={{ b: <strong className="font-semibold" /> }}
                    />
                    {i.kind === 'failing' && i.params.apps ? (
                      <span className="text-muted">
                        {' '}
                        {t('insights.insight.failingApps', { apps: i.params.apps })}
                      </span>
                    ) : null}
                  </InsightRow>
                );
              })}
          </AnimatePresence>
        </ul>
      </Card>
    </motion.div>
  );
}

// -------------------------------------------------------------------- kpis

function Kpis({ report }: { report: InsightsReport }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { totals } = report;
  const rangeText = t(`insights.range.long.${report.range}`);
  const label = (i: number) => (report.points[i] ? pointLabel(report.points[i], report.stepMs, lang) : '');
  const rss = report.trackers.reduce((s, r) => s + r.metrics.rssQueries, 0);
  const searchesForGrabs = totals.queries - rss;
  const finished = report.trackers.reduce((s, r) => s + r.metrics.imported + r.metrics.failedDownloads, 0);
  const grabResponse = (() => {
    const items = report.trackers.filter((r) => r.metrics.averageGrabResponseMs !== null);
    const weight = items.reduce((s, r) => s + r.metrics.grabs, 0);
    return weight > 0
      ? items.reduce((s, r) => s + r.metrics.averageGrabResponseMs! * r.metrics.grabs, 0) / weight
      : null;
  })();
  const responses = totals.series.responseMs.map((v) => v ?? 0);
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <KpiCard
        label={t('insights.kpi.searches')}
        value={<Odometer text={compact(totals.queries, lang)} />}
        sub={
          delta(totals.queries, totals.previous.queries, lang, 'relative') ??
          t('insights.kpi.searchesSub', { rss: compact(rss, lang) })
        }
        chart={
          <MiniBars
            values={totals.series.queries}
            label={t('insights.kpi.trend', { label: t('insights.kpi.searches'), range: rangeText })}
          />
        }
      />
      <KpiCard
        delay={0.05}
        label={t('insights.kpi.grabs')}
        value={<Odometer text={compact(totals.grabs || totals.arrGrabs, lang)} />}
        sub={
          searchesForGrabs > 0
            ? t('insights.kpi.grabsSub', {
                rate: new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(
                  (totals.grabs / searchesForGrabs) * 100,
                ),
              })
            : undefined
        }
        chart={
          <MiniBars
            values={totals.series.grabs}
            label={t('insights.kpi.trend', { label: t('insights.kpi.grabs'), range: rangeText })}
          />
        }
      />
      <KpiCard
        delay={0.1}
        label={t('insights.kpi.response')}
        value={<Odometer text={ms(totals.averageResponseMs, lang)} />}
        sub={
          grabResponse !== null
            ? t('insights.kpi.responseSub', { ms: ms(Math.round(grabResponse), lang) })
            : undefined
        }
        chart={
          responses.some((v) => v > 0) ? (
            <div className="w-28">
              <Sparkline
                values={responses}
                height={44}
                format={(n) => ms(n, lang)}
                pointLabel={label}
                label={t('insights.kpi.trend', { label: t('insights.kpi.response'), range: rangeText })}
              />
            </div>
          ) : undefined
        }
      />
      <KpiCard
        delay={0.15}
        label={t('insights.kpi.imports')}
        tone={totals.importRate !== null && totals.importRate < 0.5 ? 'warning' : 'accent'}
        value={<Odometer text={percent(totals.importRate, lang)} />}
        sub={
          finished > 0
            ? t('insights.kpi.importsSub', {
                imported: number(totals.imported, lang),
                finished: number(finished, lang),
              })
            : t('insights.kpi.noImports')
        }
        chart={
          <ProgressRing value={totals.importRate ?? 0} size={48} label={t('insights.kpi.imports')}>
            {totals.importRate === null ? '–' : Math.round(totals.importRate * 100)}
          </ProgressRing>
        }
      />
    </div>
  );
}

// -------------------------------------------------------------- over time

function SearchColumns({ report }: { report: InsightsReport }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const s = report.totals.series;
  return (
    <Card className="flex flex-col gap-3 lg:col-span-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">{t('insights.time.searches')}</h3>
        <ul className="flex gap-3 text-xs text-muted">
          <li className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-accent" aria-hidden />
            {t('insights.time.ok')}
          </li>
          <li className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-critical" aria-hidden />
            {t('insights.time.failed')}
          </li>
        </ul>
      </div>
      <Columns
        height={180}
        label={t('insights.time.searches')}
        emptyLabel={t('insights.scatter.empty')}
        data={report.points.map((p, i) => ({
          key: p,
          label: pointLabel(p, report.stepMs, lang),
          parts: [
            {
              tone: 'accent',
              value: Math.max(0, (s.queries[i] ?? 0) - (s.failed[i] ?? 0)),
              label: t('insights.time.ok'),
            },
            { tone: 'critical', value: s.failed[i] ?? 0, label: t('insights.time.failed') },
          ],
        }))}
      />
    </Card>
  );
}

function WhenHeatmap({ report }: { report: InsightsReport }) {
  const { t, i18n } = useTranslation();
  const days = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(i18n.language, { weekday: 'short', timeZone: 'UTC' }).format(
      new Date(Date.UTC(2024, 0, 1 + i)),
    ),
  );
  return (
    <Card className="flex flex-col gap-3 lg:col-span-2">
      <h3 className="font-semibold">{t('insights.time.heat')}</h3>
      <Heatmap
        rows={days}
        columns={24}
        values={report.heatmap.values}
        label={t('insights.time.heatLabel', { days: report.heatmap.days })}
        cellLabel={(r, c, v) =>
          t('insights.time.heatCell', {
            day: days[r],
            hour: String(c).padStart(2, '0'),
            count: number(v, i18n.language),
          })
        }
        columnTicks={[
          [0, '0'],
          [6, '6'],
          [12, '12'],
          [18, '18'],
        ]}
        less={t('insights.time.less')}
        more={t('insights.time.more')}
      />
    </Card>
  );
}

function WhoSearches({ report }: { report: InsightsReport }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const maxCalls = Math.max(1, ...report.callers.map((c) => c.queries));
  const apps = report.apps.filter((a) => a.grabs.total > 0).sort((a, b) => b.grabs.total - a.grabs.total);
  const maxGrabs = Math.max(1, ...apps.map((a) => a.grabs.total));
  return (
    <Card className="flex flex-col gap-4">
      <h3 className="font-semibold">{t('insights.sections.who')}</h3>
      <div className="flex flex-col gap-3">
        <span className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">
          {t('insights.who.callers')}
        </span>
        {report.callers.length === 0 ? (
          <p className="text-sm text-muted">{t('insights.who.none')}</p>
        ) : (
          report.callers.slice(0, 6).map((c, i) => (
            <BarRow
              key={c.name}
              label={c.name}
              value={c.queries}
              max={maxCalls}
              delay={0.05 * i}
              display={t('insights.who.callerValue', {
                queries: compact(c.queries, lang),
                grabs: compact(c.grabs, lang),
              })}
            />
          ))
        )}
      </div>
      {apps.length > 0 ? (
        <div className="flex flex-col gap-3">
          <span className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">
            {t('insights.who.grabs')}
          </span>
          {apps.map((a, i) => (
            <BarRow
              key={a.instanceId}
              label={a.instanceName}
              value={a.grabs.total}
              max={maxGrabs}
              delay={0.05 * i}
              display={t('insights.who.grabValue', {
                total: number(a.grabs.total, lang),
                imported: number(a.grabs.imported, lang),
              })}
            />
          ))}
        </div>
      ) : null}
      <p className="mt-auto text-xs text-muted">{formatRelative(report.collection.lastRunAt, lang)}</p>
    </Card>
  );
}
