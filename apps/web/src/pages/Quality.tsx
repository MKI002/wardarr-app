// Quality score: how close every file in Sonarr and Radarr comes to the best
// file its quality profile allows. The hero answers "how good is my library?";
// below it: how far files are from perfect, which kinds of custom formats
// cost the most points, every profile's perfect file, the titles furthest
// away and what the files contain. Clicking a state lists its files; the one
// action asks Sonarr and Radarr to search the lowest-rated files again.
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { motion } from 'motion/react';
import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BarRow,
  Columns,
  LiveDot,
  ProgressRing,
  SegmentBar,
  useCalm,
  type ChartTone,
  type Segment,
} from '../components/charts';
import { InstanceChips, Odometer, PageHeader, SectionRule } from '../components/dash';
import { ConfirmDialog, Dialog } from '../components/Dialog';
import { ServiceLogo } from '../components/ServiceLogo';
import {
  Badge,
  Button,
  Card,
  Choice,
  Disclosure,
  EmptyState,
  InlineError,
  SectionTitle,
  Skeleton,
  ViewTransition,
  spring,
  type Tone,
} from '../components/ui';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { formatRelative } from '../lib/format';
import {
  MAX_SEARCH,
  SEARCHABLE,
  TIERS,
  mergeReports,
  topParts,
  type CountMap,
  type MergedReport,
  type QualityFile,
  type QualityFilePage,
  type QualityInstance,
  type QualitySearchResult,
  type Tier,
} from '../lib/quality';

const TIER_TONE: Record<Tier, Tone> = {
  perfect: 'ok',
  target: 'info',
  upgrading: 'warning',
  penalised: 'critical',
};

/** Steps of the accent for the parts of one whole, darkest first. */
const SHADES = [1, 0.78, 0.6, 0.45, 0.32, 0.22];

function useNumber() {
  const { i18n } = useTranslation();
  return useMemo(() => {
    const nf = new Intl.NumberFormat(i18n.language);
    return (n: number) => nf.format(Math.round(n));
  }, [i18n.language]);
}

export function QualityPage() {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const search = useSearch({ from: '/quality' });
  const navigate = useNavigate({ from: '/quality' });
  const num = useNumber();
  // The server answers at once with the last report and checks in the
  // background; events (or this faster poll while checking) bring progress.
  const query = useQuery({
    queryKey: ['quality'],
    queryFn: () => api<{ instances: QualityInstance[] }>('/api/quality'),
    refetchInterval: (q) => (q.state.data?.instances.some((i) => i.refreshing) ? 2_000 : 5 * 60_000),
  });
  const rescan = useMutation({
    mutationFn: (instance?: string) => api('/api/quality/refresh', { method: 'POST', body: { instance } }),
    onSettled: () => client.invalidateQueries({ queryKey: ['quality'] }),
  });

  const instances = useMemo(() => query.data?.instances ?? [], [query.data]);
  const current = instances.find((i) => i.instanceId === search.instance);
  const shown = useMemo(() => (current ? [current] : instances), [current, instances]);
  const report = useMemo(() => mergeReports(shown), [shown]);
  const refreshing = rescan.isPending || shown.some((i) => i.refreshing);
  const files = report?.files ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={
          report ? t('quality.eyebrow', { files: num(files + report.unscored) }) : t('quality.eyebrowEmpty')
        }
        title={t('quality.title')}
        intro={t('quality.intro')}
        actions={
          instances.length > 0 ? (
            <Button busy={refreshing} onClick={() => rescan.mutate(current?.instanceId)}>
              {t('quality.rescan')}
            </Button>
          ) : null
        }
      />
      {instances.length > 1 ? (
        <InstanceChips
          label={t('quality.instances')}
          current={current?.instanceId ?? 'all'}
          onPick={(id) =>
            void navigate({ search: { instance: id === 'all' ? undefined : id }, replace: true })
          }
          items={[
            { id: 'all', name: t('quality.all'), tone: 'accent' },
            ...instances.map((i) => ({
              id: i.instanceId,
              name: i.instanceName,
              adapter: i.adapter,
              tone: (i.error ? 'warning' : i.report ? 'ok' : 'neutral') as ChartTone,
            })),
          ]}
        />
      ) : null}
      {query.isError ? (
        <InlineError {...errorText(t, query.error)} onRetry={() => void query.refetch()} />
      ) : null}
      {rescan.isError ? <InlineError {...errorText(t, rescan.error)} /> : null}
      <StatusNotes instances={shown} lang={i18n.language} hasReport={!!report} />

      {query.isPending ? (
        <div className="grid gap-4 lg:grid-cols-5" aria-busy>
          <Skeleton className="h-80 rounded-[var(--radius-card)] lg:col-span-3" />
          <Skeleton className="h-80 rounded-[var(--radius-card)] lg:col-span-2" />
        </div>
      ) : instances.length === 0 ? (
        <Card>
          <EmptyState title={t('quality.noneTitle')} body={t('quality.noneBody')} />
        </Card>
      ) : !report ? (
        <FirstScan instances={shown} />
      ) : report.files === 0 ? (
        <Card>
          <EmptyState title={t('quality.emptyTitle')} body={t('quality.emptyBody')} />
        </Card>
      ) : (
        <ViewTransition view={current?.instanceId ?? 'all'}>
          <Report report={report} showOrigin={shown.length > 1} instance={current?.instanceId} />
        </ViewTransition>
      )}
    </div>
  );
}

/** Errors, versions without scores and checks running in the background. */
function StatusNotes({
  instances,
  lang,
  hasReport,
}: {
  instances: QualityInstance[];
  lang: string;
  hasReport: boolean;
}) {
  const { t } = useTranslation();
  type Note = { key: string; tone: 'warning' | 'info' | 'live'; text: string };
  const notes = instances.flatMap((i): Note[] => {
    if (i.error === 'unsupported')
      return [
        {
          key: i.instanceId,
          tone: 'info',
          text: t('quality.unsupported', { name: i.instanceName, version: i.version ?? '' }),
        },
      ];
    if (i.error)
      return [
        {
          key: i.instanceId,
          tone: 'warning',
          text: t('quality.failed', {
            name: i.instanceName,
            reason: t(`quality.error.${i.error}`, { defaultValue: i.error }),
          }),
        },
      ];
    if (i.refreshing && hasReport && i.report)
      return [
        {
          key: i.instanceId,
          tone: 'live',
          text: `${progressText(t, i)} · ${t('quality.scanningAgain', { when: formatRelative(i.at, lang) })}`,
        },
      ];
    return [];
  });
  if (notes.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2">
      {notes.map((n) => (
        <li
          key={n.key}
          role="status"
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
            n.tone === 'warning'
              ? 'bg-warning-bg text-warning'
              : n.tone === 'info'
                ? 'bg-info-bg text-info'
                : 'bg-surface-2 text-text'
          }`}
        >
          {n.tone === 'live' ? <LiveDot tone="accent" label={t('quality.rescan')} /> : null}
          {n.text}
        </li>
      ))}
    </ul>
  );
}

function progressText(t: (k: string, o?: Record<string, unknown>) => string, i: QualityInstance): string {
  return i.progress && i.progress.total > 0
    ? t('quality.scanning', { name: i.instanceName, done: i.progress.done, total: i.progress.total })
    : t('quality.scanningStart', { name: i.instanceName });
}

/** No report yet: the guardian with the progress of the first check. */
function FirstScan({ instances }: { instances: QualityInstance[] }) {
  const { t } = useTranslation();
  const running = instances.filter((i) => i.refreshing);
  return (
    <Card>
      <EmptyState
        title={t('quality.firstTitle')}
        body={t('quality.firstBody')}
        action={
          running.length > 0 ? (
            <ul className="flex flex-col items-center gap-2 text-sm text-muted">
              {running.map((i) => (
                <li key={i.instanceId} className="flex items-center gap-2">
                  <ProgressRing
                    size={28}
                    value={i.progress && i.progress.total > 0 ? i.progress.done / i.progress.total : 0}
                    label={progressText(t, i)}
                  />
                  {progressText(t, i)}
                </li>
              ))}
            </ul>
          ) : undefined
        }
      />
    </Card>
  );
}

function Report({
  report,
  showOrigin,
  instance,
}: {
  report: MergedReport;
  showOrigin: boolean;
  instance: string | undefined;
}) {
  const { t } = useTranslation();
  const [tier, setTier] = useState<Tier | null>(null);
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 lg:grid-cols-5">
        <Hero report={report} onTier={setTier} />
        <motion.div
          className="lg:col-span-2"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: 0.05 }}
        >
          <Histogram report={report} />
        </motion.div>
      </div>

      <SectionRule>{t('quality.points.title')}</SectionRule>
      <Points report={report} />

      <SectionRule>{t('quality.profiles.title')}</SectionRule>
      <Profiles report={report} showOrigin={showOrigin} />

      <SectionRule>{t('quality.contents.title')}</SectionRule>
      <Contents report={report} />

      <SectionRule>{t('quality.titles.title')}</SectionRule>
      <SearchWorst report={report} instance={instance} />
      <Titles report={report} showOrigin={showOrigin} />

      <FilesDialog tier={tier} onTier={setTier} report={report} instance={instance} showOrigin={showOrigin} />
    </div>
  );
}

function Hero({ report, onTier }: { report: MergedReport; onTier: (tier: Tier) => void }) {
  const { t } = useTranslation();
  const num = useNumber();
  const percent = Math.round((report.percentSum / report.files) * 100);
  const segments: Segment[] = TIERS.map((tier) => ({
    key: tier,
    label: t(`quality.tier.${tier}`),
    value: report.tiers[tier],
    tone: TIER_TONE[tier],
  }));
  return (
    <motion.div
      className="lg:col-span-3"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
    >
      <Card as="div" className="flex h-full flex-col justify-between gap-6">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">
            {t('quality.hero.label')}
          </span>
          <Odometer text={`${percent} %`} className="text-6xl font-bold tracking-tight" />
          <p className="max-w-prose text-base">
            {report.tiers.perfect === report.files
              ? t('quality.hero.sentenceAllPerfect', { files: num(report.files) })
              : t('quality.hero.sentence', {
                  percent,
                  perfect: num(report.tiers.perfect),
                  files: num(report.files),
                })}
          </p>
          <p className="text-sm text-muted">
            {t('quality.hero.gap', {
              score: num(report.scoreSum / report.files),
              perfect: num(report.perfectSum / report.files),
              gap: num(report.gapSum / report.files),
            })}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <SegmentBar
            tall
            segments={segments}
            label={t('quality.hero.tiers')}
            format={num}
            onSelect={(key) => onTier(key as Tier)}
          />
          <p className="text-xs text-muted">{t('quality.hero.tiersHint')}</p>
        </div>
      </Card>
    </motion.div>
  );
}

function Histogram({ report }: { report: MergedReport }) {
  const { t } = useTranslation();
  const label = (i: number) =>
    i === 10
      ? t('quality.histogram.perfect')
      : t('quality.histogram.bucket', { from: i * 10, to: i * 10 + 9 });
  const data = report.histogram.map((value, i) => ({
    key: String(i),
    label: label(i),
    parts: [{ tone: (i === 10 ? 'ok' : 'accent') as ChartTone, value, label: t('quality.histogram.files') }],
  }));
  // The fullest bucket below perfect, for the sentence.
  const peak = report.histogram
    .slice(0, 10)
    .reduce((best, v, i, all) => (v > (all[best] ?? 0) ? i : best), 0);
  return (
    <Card as="div" className="flex h-full flex-col gap-3">
      <SectionTitle>{t('quality.histogram.title')}</SectionTitle>
      <Columns data={data} height={180} label={t('quality.histogram.label')} />
      {(report.histogram[peak] ?? 0) > 0 ? (
        <p className="text-sm text-muted">
          {t('quality.histogram.sentence', { from: peak * 10, to: peak * 10 + 9 })}
        </p>
      ) : null}
    </Card>
  );
}

function Points({ report }: { report: MergedReport }) {
  const { t } = useTranslation();
  const num = useNumber();
  const kinds = report.categories.filter((c) => c.points > 0);
  const total = kinds.reduce((s, c) => s + c.points, 0);
  const missed = report.formats
    .filter((f) => !f.penalty)
    .sort((a, b) => b.files - a.files)
    .slice(0, 8);
  const penalties = report.formats.filter((f) => f.penalty).slice(0, 5);
  const maxMissed = Math.max(1, ...missed.map((f) => f.files));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card as="div" className="flex flex-col gap-4">
        <SectionTitle>{t('quality.points.byKind')}</SectionTitle>
        {kinds.length === 0 ? (
          <p className="text-sm text-muted">{t('quality.points.nothing')}</p>
        ) : (
          <div className="flex flex-col gap-3" role="list" aria-label={t('quality.points.byKindLabel')}>
            {kinds.map((c, i) => (
              <div role="listitem" key={c.category}>
                <BarRow
                  label={t(`quality.category.${c.category}`)}
                  value={c.points}
                  max={kinds[0]!.points}
                  tone={c.category === 'unwanted' ? 'critical' : 'accent'}
                  delay={0.05 * i}
                  display={t('quality.points.kindDisplay', {
                    share: Math.max(1, Math.round((c.points / total) * 100)),
                    files: num(c.files),
                  })}
                />
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-muted">{t('quality.points.explain')}</p>
      </Card>
      <Card as="div" className="flex flex-col gap-4">
        <SectionTitle>{t('quality.points.missed')}</SectionTitle>
        {missed.length === 0 ? (
          <p className="text-sm text-muted">{t('quality.points.nothing')}</p>
        ) : (
          <div className="flex flex-col gap-3" role="list">
            {missed.map((f, i) => (
              <div role="listitem" key={`${f.category}:${f.name}`}>
                <BarRow
                  label={
                    <span className="flex items-center gap-2">
                      <span className="truncate">{f.name}</span>
                      <Badge tone="neutral">{t(`quality.category.${f.category}`)}</Badge>
                    </span>
                  }
                  value={f.files}
                  max={maxMissed}
                  delay={0.05 * i}
                  display={t('quality.points.missedDisplay', { files: num(f.files) })}
                />
              </div>
            ))}
          </div>
        )}
        {penalties.length > 0 ? (
          <div className="flex flex-col gap-2 border-t border-border pt-4">
            <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">
              {t('quality.points.penalties')}
            </h3>
            <ul className="flex flex-col gap-1.5 text-sm">
              {penalties.map((f) => (
                <li key={f.name} className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <Badge tone="critical">{t('quality.titles.penalty')}</Badge>
                    <span className="truncate">{f.name}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted tabular-nums">
                    {t('quality.points.penaltyDisplay', {
                      files: num(f.files),
                      points: num(f.points / Math.max(1, f.files)),
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

/** A file's score against perfect, with a tick at the upgrade target. */
function ScoreMeter({
  percent,
  target,
  perfect,
  label,
  delay = 0,
}: {
  percent: number;
  target: number | null;
  perfect: number;
  label: string;
  delay?: number;
}) {
  const { t } = useTranslation();
  const calm = useCalm();
  const targetAt = target !== null && perfect > 0 && target < perfect ? Math.max(0, target / perfect) : null;
  return (
    <div className="relative h-2 w-full rounded-full bg-surface-2" role="img" aria-label={label}>
      <motion.div
        className="h-full rounded-full bg-accent"
        style={{ width: `${Math.max(0, Math.min(1, percent)) * 100}%`, originX: 0 }}
        initial={calm ? false : { scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.5, delay, ease: [0.2, 0.8, 0.2, 1] }}
      />
      {targetAt !== null ? (
        <span
          className="absolute -top-1 h-4 w-0.5 rounded-full bg-text"
          style={{ left: `calc(${targetAt * 100}% - 1px)` }}
          title={t('quality.titles.targetMark')}
          aria-hidden
        />
      ) : null}
    </div>
  );
}

const PAGE = 10;

function Titles({ report, showOrigin }: { report: MergedReport; showOrigin: boolean }) {
  const { t } = useTranslation();
  const num = useNumber();
  const [count, setCount] = useState(PAGE);
  const titles = report.titles;
  if (titles.length === 0)
    return (
      <Card>
        <p className="text-sm text-muted">{t('quality.titles.none')}</p>
      </Card>
    );
  const shown = titles.slice(0, count);
  return (
    <Card as="div" className="flex flex-col gap-1 p-0">
      <ul className="divide-y divide-border">
        {shown.map((title, i) => {
          const pct = Math.round(title.percent * 100);
          return (
            <motion.li
              key={`${title.instanceId}:${title.id}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring, delay: Math.min(i, PAGE) * 0.04 }}
              className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:gap-5"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{title.title}</span>
                  {title.year ? <span className="text-sm text-muted">{title.year}</span> : null}
                </div>
                <span className="flex items-center gap-1.5 text-xs text-muted">
                  {showOrigin ? (
                    <>
                      <ServiceLogo adapter={title.adapter} name={title.adapterName} size={14} />
                      {title.instanceName} ·
                    </>
                  ) : null}{' '}
                  {title.files === 1
                    ? t('quality.titles.subOne', { profile: title.profile })
                    : t('quality.titles.sub', { profile: title.profile, files: num(title.files) })}
                </span>
                {title.missing.length > 0 || title.penalties.length > 0 ? (
                  <ul className="flex flex-wrap gap-1.5" aria-label={t('quality.titles.missing')}>
                    {title.penalties.map((p) => (
                      <li key={`p:${p.name}`}>
                        <Badge tone="critical">{p.name}</Badge>
                      </li>
                    ))}
                    {title.missing.map((m) => (
                      <li
                        key={`${m.category}:${m.name}`}
                        title={
                          title.files > 1
                            ? t('quality.titles.missingIn', { name: m.name, files: num(m.files) })
                            : undefined
                        }
                      >
                        <Badge tone="neutral">
                          <span className="text-muted">−</span>
                          {m.name}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <div className="flex w-full shrink-0 flex-col gap-1.5 sm:w-56">
                <div className="flex items-baseline justify-between text-xs text-muted tabular-nums">
                  <span>
                    {t('quality.titles.score', { score: num(title.score), perfect: num(title.perfect) })}
                  </span>
                  <span className="text-sm font-semibold text-text">{pct} %</span>
                </div>
                <ScoreMeter
                  percent={title.percent}
                  target={title.target}
                  perfect={title.perfect}
                  label={t('quality.titles.meter', { percent: pct })}
                  delay={0.1 + Math.min(i, PAGE) * 0.04}
                />
              </div>
              {title.webUrl ? (
                <a
                  href={title.webUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium text-accent hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                >
                  {t('quality.titles.open', { app: title.adapterName })} ↗
                </a>
              ) : null}
            </motion.li>
          );
        })}
      </ul>
      {titles.length > PAGE ? (
        <div className="flex justify-center border-t border-border px-5 py-3">
          <Button variant="ghost" onClick={() => setCount(count >= titles.length ? PAGE : count + PAGE * 2)}>
            {count >= titles.length
              ? t('quality.titles.less')
              : t('quality.titles.more', { count: Math.min(PAGE * 2, titles.length - count) })}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

/** Files per page of the file list. */
const FILE_PAGE = 50;

function filesPath(instance: string | undefined, tier: Tier, offset: number): string {
  const q = new URLSearchParams({ tier, offset: String(offset), limit: String(FILE_PAGE) });
  if (instance) q.set('instance', instance);
  return `/api/quality/files?${q.toString()}`;
}

/** The files of one state, worst first, in pages. Opens from the hero bar. */
function FilesDialog({
  tier,
  onTier,
  report,
  instance,
  showOrigin,
}: {
  tier: Tier | null;
  onTier: (tier: Tier | null) => void;
  report: MergedReport;
  instance: string | undefined;
  showOrigin: boolean;
}) {
  const { t } = useTranslation();
  const num = useNumber();
  const pages = useInfiniteQuery({
    queryKey: ['quality', 'files', instance ?? 'all', tier],
    queryFn: ({ pageParam }) => api<QualityFilePage>(filesPath(instance, tier!, pageParam)),
    initialPageParam: 0,
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((n, p) => n + p.files.length, 0);
      return last.files.length > 0 && loaded < last.total ? loaded : undefined;
    },
    enabled: tier !== null,
  });
  const files = pages.data?.pages.flatMap((p) => p.files) ?? [];
  const total = pages.data?.pages[0]?.total ?? 0;
  const options = TIERS.filter((x) => report.tiers[x] > 0).map((x): [Tier, string] => [
    x,
    `${t(`quality.tier.${x}`)} · ${num(report.tiers[x])}`,
  ]);
  return (
    <Dialog
      open={tier !== null}
      onOpenChange={(open) => (open ? undefined : onTier(null))}
      title={t('quality.files.title')}
      description={t('quality.files.intro')}
      wide
    >
      <div className="flex flex-col gap-4">
        {tier ? (
          <Choice
            label={t('quality.hero.tiers')}
            hideLabel
            value={tier}
            options={options}
            onChange={onTier}
          />
        ) : null}
        {pages.isError ? (
          <InlineError {...errorText(t, pages.error)} onRetry={() => void pages.refetch()} />
        ) : pages.isPending ? (
          <div className="flex flex-col gap-2" aria-busy>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))}
          </div>
        ) : files.length === 0 ? (
          <p className="text-sm text-muted">{t('quality.files.none')}</p>
        ) : (
          <>
            <ul className="-mx-5 divide-y divide-border border-y border-border">
              {files.map((f) => (
                <FileRow key={`${f.instanceId}:${f.fileId}`} file={f} showOrigin={showOrigin} />
              ))}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
              <span>{t('quality.files.shown', { shown: num(files.length), total: num(total) })}</span>
              {pages.hasNextPage ? (
                <Button
                  variant="ghost"
                  busy={pages.isFetchingNextPage}
                  onClick={() => void pages.fetchNextPage()}
                >
                  {t('quality.titles.more', { count: Math.min(FILE_PAGE, total - files.length) })}
                </Button>
              ) : null}
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

function FileRow({ file, showOrigin }: { file: QualityFile; showOrigin: boolean }) {
  const { t } = useTranslation();
  const num = useNumber();
  const pct = Math.round(file.percent * 100);
  const missing = file.missing.slice(0, 5);
  return (
    <li className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium">{file.title}</span>
          {file.season !== null ? (
            <span className="text-sm text-muted">{t('quality.files.season', { season: file.season })}</span>
          ) : file.year ? (
            <span className="text-sm text-muted">{file.year}</span>
          ) : null}
        </div>
        {file.name ? (
          <span className="truncate text-xs text-muted" title={file.name}>
            {file.name}
          </span>
        ) : null}
        <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
          {showOrigin ? (
            <>
              <ServiceLogo adapter={file.adapter} name={file.adapterName} size={14} />
              {file.instanceName} ·
            </>
          ) : null}{' '}
          {[file.profile, file.quality].filter(Boolean).join(' · ')}
        </span>
        {missing.length > 0 || file.penalties.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5" aria-label={t('quality.titles.missing')}>
            {file.penalties.map((p) => (
              <li key={`p:${p}`}>
                <Badge tone="critical">{p}</Badge>
              </li>
            ))}
            {missing.map((m) => (
              <li key={`${m.category}:${m.name}`}>
                <Badge tone="neutral">
                  <span className="text-muted">−</span>
                  {m.name}
                </Badge>
              </li>
            ))}
            {file.missing.length > missing.length ? (
              <li className="self-center text-xs text-muted">
                {t('quality.files.moreMissing', { count: file.missing.length - missing.length })}
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>
      <div className="flex w-full shrink-0 flex-col gap-1.5 sm:w-44">
        <div className="flex items-baseline justify-between text-xs text-muted tabular-nums">
          <span>{t('quality.titles.score', { score: num(file.score), perfect: num(file.perfect) })}</span>
          <span className="text-sm font-semibold text-text">{pct} %</span>
        </div>
        <ScoreMeter
          percent={file.percent}
          target={file.target}
          perfect={file.perfect}
          label={t('quality.titles.meter', { percent: pct })}
        />
      </div>
      {file.webUrl ? (
        <a
          href={file.webUrl}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 self-start rounded-lg px-3 py-1.5 text-sm font-medium text-accent hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none sm:self-center"
        >
          {t('quality.titles.open', { app: file.adapterName })} ↗
        </a>
      ) : null}
    </li>
  );
}

/** Asks Sonarr and Radarr to search a better release for the lowest-rated files. */
function SearchWorst({ report, instance }: { report: MergedReport; instance: string | undefined }) {
  const { t } = useTranslation();
  const num = useNumber();
  const id = useId();
  const below = SEARCHABLE.reduce((n, x) => n + report.tiers[x], 0);
  const [count, setCount] = useState(25);
  const [confirm, setConfirm] = useState(false);
  const run = useMutation({
    mutationFn: (n: number) =>
      api<QualitySearchResult>('/api/quality/search', { method: 'POST', body: { instance, count: n } }),
    onSettled: () => setConfirm(false),
  });
  const valid = Number.isInteger(count) && count >= 1 && count <= Math.min(MAX_SEARCH, below);
  if (below === 0) return null;
  const result = run.data;
  const failed = result?.instances.filter((i) => i.error) ?? [];
  const started = result?.instances.filter((i) => !i.error) ?? [];
  return (
    <Card as="div" className="flex flex-col gap-3">
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) setConfirm(true);
        }}
      >
        <div className="flex max-w-prose flex-col gap-1">
          <SectionTitle>{t('quality.search.title')}</SectionTitle>
          <p className="text-sm text-muted">
            {t('quality.search.body', { count: below, formatted: num(below) })}
          </p>
        </div>
        <div className="flex shrink-0 items-end gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor={id} className="text-xs font-medium text-muted">
              {t('quality.search.count')}
            </label>
            <input
              id={id}
              type="number"
              inputMode="numeric"
              min={1}
              max={Math.min(MAX_SEARCH, below)}
              value={Number.isFinite(count) ? count : ''}
              onChange={(e) => setCount(e.target.value === '' ? NaN : Number(e.target.value))}
              className="min-h-9 w-24 rounded-lg border border-border bg-bg px-3 text-sm tabular-nums outline-none focus:border-accent"
            />
          </div>
          <Button type="submit" variant="primary" disabled={!valid} busy={run.isPending}>
            {t('quality.search.button')}
          </Button>
        </div>
      </form>
      {!valid && Number.isFinite(count) ? (
        <p className="text-xs text-warning">
          {t('quality.search.range', { max: num(Math.min(MAX_SEARCH, below)) })}
        </p>
      ) : null}
      {run.isError ? <InlineError {...errorText(t, run.error)} /> : null}
      {result ? (
        <div className="flex flex-col gap-2" role="status">
          {result.files === 0 ? (
            <p className="rounded-lg bg-info-bg px-3 py-2 text-sm text-info">{t('quality.search.nothing')}</p>
          ) : null}
          {started.length > 0 ? (
            <p className="rounded-lg bg-ok-bg px-3 py-2 text-sm text-ok">
              {t('quality.search.started', {
                parts: started
                  .map((i) => t('quality.search.part', { name: i.instanceName, count: i.items }))
                  .join(', '),
              })}
            </p>
          ) : null}
          {failed.map((i) => (
            <p key={i.instanceId} className="rounded-lg bg-warning-bg px-3 py-2 text-sm text-warning">
              {t('quality.failed', {
                name: i.instanceName,
                reason: t(`quality.error.${i.error}`, { defaultValue: i.error ?? '' }),
              })}
            </p>
          ))}
        </div>
      ) : null}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('quality.search.confirmTitle', { count, formatted: num(count) })}
        body={t('quality.search.confirmBody', { count, formatted: num(count) })}
        confirmLabel={t('quality.search.button')}
        busy={run.isPending}
        onConfirm={() => run.mutate(count)}
      />
    </Card>
  );
}

function Profiles({ report, showOrigin }: { report: MergedReport; showOrigin: boolean }) {
  const { t } = useTranslation();
  const num = useNumber();
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {report.profiles.map((p, i) => {
        const pct = p.files > 0 ? Math.round((p.percentSum / p.files) * 100) : 0;
        return (
          <motion.div
            key={`${p.instanceId}:${p.id}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: 0.04 * i }}
          >
            <Card as="article" className="flex h-full flex-col gap-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <h3 className="truncate text-lg font-semibold">{p.name}</h3>
                  <span className="flex items-center gap-1.5 text-xs text-muted">
                    {showOrigin ? (
                      <>
                        <ServiceLogo adapter={p.adapter} name={p.adapterName} size={14} />
                        {p.instanceName} ·
                      </>
                    ) : null}{' '}
                    {t('quality.profiles.files', { count: p.files, formatted: num(p.files) })}
                  </span>
                </div>
                {p.files > 0 ? (
                  <ProgressRing
                    size={52}
                    stroke={5}
                    value={pct / 100}
                    label={t('quality.profiles.average', { percent: pct })}
                  >
                    <span className="text-xs">{pct} %</span>
                  </ProgressRing>
                ) : null}
              </div>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-surface-2 px-3 py-2">
                  <dt className="text-xs text-muted">{t('quality.profiles.perfect')}</dt>
                  <dd className="text-xl font-semibold tabular-nums">{num(p.perfect)}</dd>
                </div>
                <div className="rounded-lg bg-surface-2 px-3 py-2">
                  <dt className="text-xs text-muted">{t('quality.profiles.target')}</dt>
                  <dd className="text-xl font-semibold tabular-nums">
                    {p.target === null ? (
                      <span className="text-sm font-normal text-muted">{t('quality.profiles.noTarget')}</span>
                    ) : (
                      num(p.target)
                    )}
                  </dd>
                </div>
              </dl>
              {p.files > 0 ? (
                <SegmentBar
                  segments={TIERS.map((tier) => ({
                    key: tier,
                    label: t(`quality.tier.${tier}`),
                    value: p.tiers[tier],
                    tone: TIER_TONE[tier],
                  }))}
                  label={t('quality.hero.tiers')}
                  legend
                  format={num}
                />
              ) : (
                <p className="text-sm text-muted">{t('quality.profiles.noFiles')}</p>
              )}
              <Disclosure title={t('quality.profiles.recipe')}>
                <ul className="flex flex-col gap-1.5 text-sm">
                  {p.recipe.map((r) => (
                    <li key={r.name} className="flex items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate">{r.name}</span>
                        <span className="shrink-0 text-xs text-muted">
                          {t(`quality.category.${r.category}`)}
                        </span>
                      </span>
                      <span className="shrink-0 font-medium tabular-nums">+{num(r.score)}</span>
                    </li>
                  ))}
                </ul>
              </Disclosure>
            </Card>
          </motion.div>
        );
      })}
    </div>
  );
}

function useContentLabel() {
  const { t, i18n } = useTranslation();
  return useMemo(() => {
    let names: Intl.DisplayNames | null = null;
    try {
      names = new Intl.DisplayNames([i18n.language], { type: 'language' });
    } catch {
      names = null;
    }
    return (key: string, language = false) => {
      if (key === 'unknown' || key === 'und') return t('quality.contents.unknown');
      if (key === 'other') return t('quality.contents.other');
      if (key === 'none') return t('quality.contents.none');
      if (!language || !names) return key;
      try {
        return names.of(key) ?? key;
      } catch {
        return key;
      }
    };
  }, [t, i18n.language]);
}

const SPLITS = ['resolution', 'source', 'video', 'hdr', 'audio', 'channels'] as const;

function Contents({ report }: { report: MergedReport }) {
  const { t } = useTranslation();
  const num = useNumber();
  const name = useContentLabel();
  const languageList = (map: CountMap, what: 'audioLanguages' | 'subtitles') => {
    const parts = topParts(map, 8);
    const max = Math.max(1, ...parts.map((p) => p.value));
    return (
      <Card as="div" className="flex flex-col gap-3">
        <SectionTitle>{t(`quality.contents.${what}`)}</SectionTitle>
        <div
          className="flex flex-col gap-3"
          role="list"
          aria-label={t('quality.contents.languageLabel', { what: t(`quality.contents.${what}`) })}
        >
          {parts.map((p, i) => (
            <div role="listitem" key={p.key}>
              <BarRow
                label={name(p.key, true)}
                value={p.value}
                max={max}
                delay={0.04 * i}
                display={t('quality.contents.files', { count: p.value, formatted: num(p.value) })}
              />
            </div>
          ))}
        </div>
      </Card>
    );
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {SPLITS.map((key) => (
          <Card as="div" key={key} className="flex flex-col gap-3">
            <SectionTitle>{t(`quality.contents.${key}`)}</SectionTitle>
            <SegmentBar
              tall
              label={t(`quality.contents.${key}`)}
              format={num}
              segments={topParts(report.contents[key]).map((p, i) => ({
                key: p.key,
                label: name(p.key),
                value: p.value,
                tone: 'accent',
                shade: SHADES[i] ?? 0.2,
              }))}
            />
          </Card>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {languageList(report.contents.audioLanguages, 'audioLanguages')}
        {languageList(report.contents.subtitles, 'subtitles')}
      </div>
    </div>
  );
}
