// Indexers: Prowlarr status, statistics, tests, and which apps lose search
// coverage when an indexer fails.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { ActionMenu } from '../components/ActionMenu';
import { LiveDot, ProgressRing, Ring, toneColor, useCalm } from '../components/charts';
import { Odometer, PageHeader, SectionRule } from '../components/dash';
import { ServiceLogo } from '../components/ServiceLogo';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  InlineError,
  Skeleton,
  StatusDot,
  spring,
  type Tone,
} from '../components/ui';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { formatRelative } from '../lib/format';

interface IndexerRow {
  id: number;
  name: string;
  enabled: boolean;
  protocol: 'usenet' | 'torrent' | 'unknown';
  failing: boolean;
  disabledUntil?: string;
  mostRecentFailure?: string;
  stats: {
    queries: number;
    grabs: number;
    failedQueries: number;
    failedGrabs: number;
    averageResponseMs: number | null;
  } | null;
  apps: string[];
  stranded: string[];
  webUrl: string | null;
}

interface ProwlarrView {
  instanceId: string;
  instanceName: string;
  adapterName: string;
  status: string;
  checkedAt: string | null;
  error: string | null;
  /** When the statistics shown were read; older servers leave it out. */
  statsAt?: string | null;
  /** Fresh statistics are being read in the background. */
  refreshing?: boolean;
  indexers: IndexerRow[];
  apps: Array<{
    id: number;
    name: string;
    implementation: string;
    enabled: boolean;
    indexerIds: number[];
    failing: string[];
  }>;
}

export function IndexersPage() {
  const { t } = useTranslation();
  const client = useQueryClient();
  // The server answers at once with the last known numbers and reads new ones
  // in the background; an event (or this faster poll as a fallback) brings them in.
  const data = useQuery({
    queryKey: ['indexers'],
    queryFn: () => api<{ instances: ProwlarrView[] }>('/api/indexers'),
    refetchInterval: (query) => (query.state.data?.instances.some((i) => i.refreshing) ? 3_000 : 60_000),
  });
  const reload = useMutation({
    mutationFn: () => api<{ instances: ProwlarrView[] }>('/api/indexers?refresh=1'),
    onSuccess: (fresh) => client.setQueryData(['indexers'], fresh),
  });
  const refreshing = reload.isPending || !!data.data?.instances.some((i) => i.refreshing);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={t('ui.indexers.eyebrow')}
        title={t('ui.indexers.title')}
        intro={t('ui.indexers.intro')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/indexer-insights"
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-accent hover:bg-surface-2"
            >
              {t('insights.fromIndexers')} →
            </Link>
            <Button busy={refreshing} onClick={() => reload.mutate()}>
              {t('ui.indexers.reload')}
            </Button>
          </div>
        }
      />
      {data.isError ? (
        <InlineError {...errorText(t, data.error)} onRetry={() => void data.refetch()} />
      ) : null}
      {reload.isError ? <InlineError {...errorText(t, reload.error)} /> : null}
      {data.isPending ? (
        <Skeleton className="h-64 rounded-[var(--radius-card)]" />
      ) : data.data?.instances.length === 0 ? (
        <Card>
          <EmptyState title={t('ui.indexers.none')} body={t('ui.indexers.noneBody')} />
        </Card>
      ) : (
        data.data?.instances.map((inst) => (
          <ProwlarrSection
            key={inst.instanceId}
            inst={inst}
            showName={(data.data?.instances.length ?? 0) > 1}
            onRetry={() => reload.mutate()}
          />
        ))
      )}
    </div>
  );
}

function appTone(app: ProwlarrView['apps'][number]): Tone {
  const working = app.indexerIds.length - app.failing.length;
  if (!app.enabled) return 'neutral';
  if (working <= 0 && app.indexerIds.length) return 'critical';
  return app.failing.length ? 'warning' : 'ok';
}

function ProwlarrSection({
  inst,
  showName,
  onRetry,
}: {
  inst: ProwlarrView;
  showName: boolean;
  onRetry: () => void;
}) {
  const { t, i18n } = useTranslation();
  const refreshing = !!inst.refreshing;
  const statsAt = inst.statsAt ?? null;
  const sorted = [...inst.indexers].sort(
    (a, b) =>
      Number(b.failing) - Number(a.failing) ||
      Number(b.enabled) - Number(a.enabled) ||
      a.name.localeCompare(b.name),
  );
  return (
    <section className="flex flex-col gap-4">
      {showName ? <SectionRule>{inst.instanceName}</SectionRule> : null}
      {inst.error && !refreshing ? (
        statsAt ? (
          <StaleNote
            message={t('ui.indexers.statsStale', {
              when: formatRelative(statsAt, i18n.language),
              reason: t(`ui.instance.testFailed.${inst.error}`),
            })}
            onRetry={onRetry}
          />
        ) : (
          <InlineError
            message={t('ui.indexers.statsFailed', { reason: t(`ui.instance.testFailed.${inst.error}`) })}
            onRetry={onRetry}
          />
        )
      ) : null}
      {refreshing && !statsAt ? (
        <p className="flex items-center gap-2 text-sm text-muted" role="status">
          <LiveDot tone="accent" label={t('ui.indexers.refreshing')} />
          {t('ui.indexers.statsPending')}
        </p>
      ) : null}
      <IndexerHero inst={inst} />
      <SectionRule
        action={
          <span className="flex items-center gap-2 text-xs text-muted" aria-live="polite">
            {refreshing ? (
              <>
                <LiveDot tone="accent" label={t('ui.indexers.refreshing')} />
                {t('ui.indexers.refreshing')}
              </>
            ) : (
              [
                t('ui.indexers.checked', { when: formatRelative(inst.checkedAt, i18n.language) }),
                statsAt ? t('ui.indexers.statsFrom', { when: formatRelative(statsAt, i18n.language) }) : null,
              ]
                .filter(Boolean)
                .join(' · ')
            )}
          </span>
        }
      >
        {t('ui.indexers.list')}
      </SectionRule>
      <Card className="!p-0">
        {sorted.length === 0 ? (
          <EmptyState title={t('ui.indexers.noIndexers')} />
        ) : (
          <ul className="divide-y divide-border" aria-busy={refreshing}>
            {sorted.map((ix, i) => (
              <IndexerItem
                key={ix.id}
                ix={ix}
                instanceId={inst.instanceId}
                index={i}
                refreshing={refreshing}
              />
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

function IndexerHero({ inst }: { inst: ProwlarrView }) {
  const { t, i18n } = useTranslation();
  const n = new Intl.NumberFormat(i18n.language);
  const enabled = inst.indexers.filter((i) => i.enabled);
  const failing = enabled.filter((i) => i.failing).length;
  const working = enabled.length - failing;
  const disabled = inst.indexers.length - enabled.length;
  const stranded = inst.apps.filter((a) => appTone(a) === 'critical').length;
  const totals = enabled.reduce(
    (acc, i) => ({
      queries: acc.queries + (i.stats?.queries ?? 0),
      grabs: acc.grabs + (i.stats?.grabs ?? 0),
      failed: acc.failed + (i.stats?.failedQueries ?? 0),
    }),
    { queries: 0, grabs: 0, failed: 0 },
  );
  const success = totals.queries
    ? Math.round(((totals.queries - totals.failed) / totals.queries) * 100)
    : null;
  // No numbers yet: show where they will appear instead of zeros.
  const waiting = !!inst.refreshing && !inst.statsAt;

  return (
    <Card className="grid gap-8 lg:grid-cols-[auto_1fr_1.25fr] lg:items-center">
      <div className="flex justify-center">
        <Ring
          size={168}
          thickness={14}
          label={t('ui.indexers.ring')}
          segments={[
            { key: 'ok', value: working, tone: 'ok', label: `${working} ${t('ui.indexers.state.ok')}` },
            {
              key: 'failing',
              value: failing,
              tone: 'critical',
              label: `${failing} ${t('ui.indexers.state.critical')}`,
            },
            {
              key: 'off',
              value: disabled,
              tone: 'neutral',
              label: `${disabled} ${t('ui.indexers.state.neutral')}`,
            },
          ]}
        >
          <span className="flex flex-col items-center leading-tight">
            <Odometer text={String(working)} className="text-5xl font-bold tracking-tight" />
            <span className="text-xs text-muted">{t('ui.indexers.ofTotal', { count: enabled.length })}</span>
            <span className="text-xs text-muted">{t('ui.indexers.working')}</span>
          </span>
        </Ring>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-xl font-semibold text-balance">
            {failing ? t('ui.indexers.heroFailing', { count: failing }) : t('ui.indexers.heroAllGood')}
          </p>
          <p className={`text-sm ${stranded ? 'text-critical' : 'text-muted'}`}>
            {stranded ? t('ui.indexers.heroStranded', { count: stranded }) : t('ui.indexers.heroCovered')}
          </p>
        </div>
        <dl className="grid grid-cols-3 gap-3">
          {[
            [t('ui.indexers.queries'), n.format(totals.queries)],
            [t('ui.indexers.grabs'), n.format(totals.grabs)],
            [t('ui.indexers.failRate'), success === null ? '–' : `${100 - success}%`],
          ].map(([label, value]) => (
            <div key={label} className="flex flex-col gap-0.5 rounded-xl bg-surface-2 px-3 py-2.5">
              <dt className="truncate text-xs text-muted">{label}</dt>
              <dd className="text-xl font-semibold tabular-nums">
                {waiting ? <Skeleton className="mt-1 h-6 w-16" /> : value}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <Coverage inst={inst} />
    </Card>
  );
}

/** One row per app: a cell for each indexer it uses, green when it answers, red when it fails. */
function Coverage({ inst }: { inst: ProwlarrView }) {
  const { t } = useTranslation();
  const calm = useCalm();
  const byId = new Map(inst.indexers.map((i) => [i.id, i]));
  if (inst.apps.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      <span className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">
        {t('ui.indexers.coverage')}
      </span>
      <ul className="flex flex-col gap-2.5">
        {inst.apps.map((app, row) => {
          const tone = appTone(app);
          const cells = app.indexerIds.map((id) => byId.get(id)).filter((i) => i !== undefined);
          const working = cells.filter((c) => !c.failing).length;
          return (
            <li key={app.id} className="flex items-center gap-3 text-sm">
              <ServiceLogo adapter={app.implementation.toLowerCase()} name={app.implementation} size={18} />
              <span className="w-24 truncate">{app.name}</span>
              <span className="flex flex-1 gap-1" role="img" aria-label={t(`ui.indexers.appTone.${tone}`)}>
                {cells.map((c, i) => (
                  <motion.span
                    key={c.id}
                    title={t('ui.indexers.cell', {
                      name: c.name,
                      state: t(`ui.indexers.state.${c.failing ? 'critical' : 'ok'}`),
                    })}
                    className="h-5 max-w-10 flex-1 rounded-[5px]"
                    style={{ background: toneColor(c.failing ? 'critical' : 'ok') }}
                    initial={calm ? false : { scale: 0.4 }}
                    animate={{ scale: 1 }}
                    transition={{ ...spring, delay: 0.15 + (row + i) * 0.04 }}
                  />
                ))}
              </span>
              <span
                className={`w-10 text-right text-xs tabular-nums ${tone === 'critical' ? 'text-critical' : 'text-muted'}`}
              >
                {app.enabled ? `${working}/${cells.length}` : t('ui.indexers.state.neutral')}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function IndexerItem({
  ix,
  instanceId,
  index,
  refreshing,
}: {
  ix: IndexerRow;
  instanceId: string;
  index: number;
  refreshing: boolean;
}) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const test = useMutation({
    mutationFn: () =>
      api<{ ok: boolean; message: string | null }>(
        `/api/indexers/${encodeURIComponent(instanceId)}/${ix.id}/test`,
        { method: 'POST' },
      ),
    onSettled: () => void client.invalidateQueries({ queryKey: ['indexers'] }),
  });
  const n = new Intl.NumberFormat(i18n.language);
  const s = ix.stats;
  const success = s && s.queries ? Math.round(((s.queries - s.failedQueries) / s.queries) * 100) : null;
  const tone: Tone = !ix.enabled ? 'neutral' : ix.failing ? 'critical' : 'ok';
  const ringTone = ix.failing ? 'critical' : success !== null && success < 80 ? 'warning' : 'ok';
  return (
    <motion.li
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring, delay: 0.05 + index * 0.04 }}
      className="flex flex-col gap-2 px-5 py-4"
    >
      <div className="flex items-center gap-4">
        <span className="relative grid size-11 shrink-0 place-items-center">
          {success !== null && ix.enabled ? (
            <ProgressRing
              value={success / 100}
              size={44}
              tone={ringTone}
              label={t('ui.indexers.successRate', { percent: success })}
            >
              {success}%
            </ProgressRing>
          ) : (
            <StatusDot tone={tone} label={t(`ui.indexers.state.${tone}`)} />
          )}
          {refreshing && ix.enabled ? <ScanArc index={index} track={success === null} /> : null}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium">{ix.name}</span>
            <span className="rounded-md bg-surface-2 px-1.5 text-xs text-muted">
              {t(`ui.indexers.protocol.${ix.protocol}`)}
            </span>
            {ix.failing ? <Badge tone="critical">{t('ui.indexers.state.critical')}</Badge> : null}
            {!ix.enabled ? <Badge tone="neutral">{t('ui.indexers.state.neutral')}</Badge> : null}
          </p>
          {refreshing && ix.enabled && !s ? <Skeleton className="mt-1.5 h-3 w-48 max-w-full" /> : null}
          <p className="mt-0.5 text-xs text-muted">
            {[
              s && ix.enabled
                ? t('ui.indexers.perIndexer', {
                    queries: n.format(s.queries),
                    grabs: n.format(s.grabs),
                    ms: n.format(s.averageResponseMs ?? 0),
                  })
                : null,
              ix.apps.length
                ? t('ui.indexers.usedBy', { list: ix.apps.join(', ') })
                : t('ui.indexers.unused'),
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button busy={test.isPending} onClick={() => test.mutate()}>
            {t('ui.indexers.test')}
          </Button>
          {ix.webUrl ? (
            <ActionMenu
              label={t('ui.common.moreActions')}
              actions={[{ label: t('ui.indexers.open'), href: ix.webUrl }]}
            />
          ) : null}
        </div>
      </div>
      {ix.stranded.length ? (
        <p className="text-sm text-critical">
          {t('ui.indexers.stranded', { list: ix.stranded.join(', '), count: ix.stranded.length })}
        </p>
      ) : null}
      {test.data ? (
        <motion.p
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring}
          role="status"
          className={`text-sm ${test.data.ok ? 'text-ok' : 'text-critical'}`}
        >
          {test.data.ok ? t('ui.indexers.testOk') : t('ui.indexers.testFailed')}
        </motion.p>
      ) : null}
      {test.isError ? <InlineError {...errorText(t, test.error)} /> : null}
    </motion.li>
  );
}

/** The calm note for numbers that are older than they should be, with a retry. */
function StaleNote({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 rounded-lg bg-warning-bg px-3 py-2 text-sm text-warning sm:flex-nowrap"
    >
      <span className="min-w-0 flex-1">{message}</span>
      <Button variant="ghost" onClick={onRetry} className="ml-auto">
        {t('ui.common.retry')}
      </Button>
    </div>
  );
}

/**
 * An accent arc circling an indexer's ring while its numbers are read again.
 * Each row starts a little later, so the list ripples instead of spinning in
 * step. Calm mode keeps the arc still.
 */
function ScanArc({ index, track }: { index: number; track: boolean }) {
  const size = track ? 44 : 52;
  const r = size / 2 - 2;
  const c = 2 * Math.PI * r;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={`scan-spin pointer-events-none absolute ${track ? 'inset-0' : '-inset-1'}`}
      style={{ animationDelay: `${-index * 0.12}s` }}
      aria-hidden
    >
      {/* Without a success ring, a quiet track gives the arc something to run on. */}
      {track ? (
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={3} />
      ) : null}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={track ? 3 : 2}
        strokeLinecap="round"
        strokeDasharray={`${c * 0.22} ${c}`}
      />
    </svg>
  );
}
