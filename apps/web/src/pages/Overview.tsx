import { useQuery } from '@tanstack/react-query';
import { Link, Navigate } from '@tanstack/react-router';
import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CATEGORY_ORDER } from '../components/InstanceForm';
import {
  Badge,
  Button,
  Card,
  CountUp,
  EmptyState,
  InlineError,
  ProgressBar,
  SectionTitle,
  Skeleton,
  StatusDot,
  spring,
  type Tone,
} from '../components/ui';
import { api, type Overview } from '../lib/api';
import { formatDuration, formatRelative, formatSpeed } from '../lib/format';
import { tm } from '../lib/i18n';
import { STATUS_TONE, groupByProduct } from '../lib/instances';
import { useSession } from '../lib/session';
import { useTabs } from '../components/Layout';

const SEVERITY_TONE: Record<string, Tone> = { critical: 'critical', warning: 'warning', info: 'info' };

export function useOverview() {
  return useQuery({
    queryKey: ['overview'],
    queryFn: () => api<Overview>('/api/overview'),
    refetchInterval: 30_000,
  });
}

function Stat({
  label,
  children,
  hint,
  delay,
}: {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring, delay }}
    >
      <Card as="div" className="flex h-full flex-col gap-1 p-4">
        <span className="text-xs font-medium text-muted">{label}</span>
        <span className="text-2xl font-semibold tabular-nums">{children}</span>
        {hint ? <span className="text-xs text-muted">{hint}</span> : null}
      </Card>
    </motion.div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 rounded-[var(--radius-card)]" />
        ))}
      </div>
      <Skeleton className="h-40 rounded-[var(--radius-card)]" />
      <Skeleton className="h-56 rounded-[var(--radius-card)]" />
    </div>
  );
}

export function OverviewPage() {
  const { me } = useSession();
  const tabs = useTabs();
  // The overview is for admins. Everyone else starts in Discover when a
  // request manager is connected, otherwise in Settings.
  if (me.role !== 'admin') {
    if (tabs.isPending) return null;
    return <Navigate to={tabs.data?.tabs.includes('discover') ? '/discover' : '/settings'} />;
  }
  return <AdminOverview />;
}

function AdminOverview() {
  const { t, i18n } = useTranslation();
  const overview = useOverview();

  if (overview.isError)
    return (
      <InlineError
        message={t('ui.errors.loadFailed')}
        next={t('ui.errors.loadFailedNext')}
        onRetry={() => void overview.refetch()}
      />
    );
  if (!overview.data) return <OverviewSkeleton />;
  const { stats, instances, issues, streams, downloads } = overview.data;

  if (instances.length === 0) {
    return (
      <Card>
        <EmptyState
          title={t('ui.overview.emptyTitle')}
          body={t('ui.overview.emptyBody')}
          action={
            <Link to="/settings" search={{ section: 'instances' }}>
              <Button variant="primary">{t('ui.overview.emptyAction')}</Button>
            </Link>
          }
        />
      </Card>
    );
  }

  const byCategory = CATEGORY_ORDER.map((cat) => ({
    cat,
    groups: groupByProduct(instances.filter((i) => i.category === cat)),
  })).filter((c) => c.groups.length > 0);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="sr-only">{t('ui.overview.title')}</h1>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t('ui.overview.online')} delay={0}>
          <CountUp value={stats.instancesOnline} />
          <span className="text-base text-muted"> / {stats.instancesTotal}</span>
        </Stat>
        <Stat
          label={t('ui.overview.streams')}
          delay={0.04}
          hint={stats.transcodes > 0 ? t('ui.overview.transcodes', { count: stats.transcodes }) : undefined}
        >
          <CountUp value={stats.activeStreams} />
        </Stat>
        <Stat label={t('ui.overview.downloads')} delay={0.08}>
          <CountUp value={stats.activeDownloads} />
        </Stat>
        <Stat label={t('ui.overview.speed')} delay={0.12}>
          <CountUp value={stats.downloadSpeed} format={(n) => formatSpeed(n)} />
        </Stat>
      </div>

      <Card>
        <SectionTitle
          action={
            <Link to="/issues" className="text-sm text-accent hover:underline">
              {t('ui.overview.attentionAll')}
            </Link>
          }
        >
          {t('ui.overview.attention')}
        </SectionTitle>
        {issues.wardarr > 0 ? (
          <p className="mb-3 rounded-lg bg-surface-2 px-3 py-2 text-sm">
            <Link to="/issues" className="hover:underline">
              {t('ui.overview.wardarrIssues', { count: issues.wardarr })}
            </Link>
          </p>
        ) : null}
        {issues.needsAttention.length === 0 ? (
          <div className="flex items-center gap-3 text-sm text-muted">
            <StatusDot tone="ok" label={t('ui.issues.allClear')} />
            {t('ui.overview.attentionNone')}
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            <AnimatePresence initial={false}>
              {issues.needsAttention.map((i) => (
                <motion.li
                  key={i.fingerprint}
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={spring}
                >
                  <Link
                    to="/issues"
                    search={{ focus: i.fingerprint }}
                    className="flex items-center gap-3 py-2.5 hover:text-accent"
                  >
                    <Badge tone={SEVERITY_TONE[i.severity] ?? 'neutral'}>
                      {t(`ui.issues.severity.${i.severity}`)}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate font-medium">{tm(t, i.title)}</span>
                    <span className="hidden truncate text-sm text-muted sm:block">{tm(t, i.affected)}</span>
                  </Link>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </Card>

      <Card>
        <SectionTitle
          action={
            <Link
              to="/settings"
              search={{ section: 'instances' }}
              className="text-sm text-accent hover:underline"
            >
              {t('ui.common.edit')}
            </Link>
          }
        >
          {t('ui.overview.services')}
        </SectionTitle>
        <div className="flex flex-col gap-5">
          {byCategory.map(({ cat, groups }) => (
            <div key={cat}>
              <h3 className="mb-2 text-xs font-medium text-muted">{t(`adapters.category.${cat}`)}</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {groups.map((g) => (
                  <div key={g.adapter} className="rounded-xl border border-border bg-bg p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="font-medium">{g.items[0]?.adapterName}</span>
                      {g.items.length > 1 ? (
                        <Badge tone="neutral">{t('ui.instance.instances', { count: g.items.length })}</Badge>
                      ) : null}
                    </div>
                    <ul className="flex flex-col gap-1.5">
                      {g.items.map((i) => (
                        <li key={i.id} className="flex items-center gap-2 text-sm">
                          <StatusDot tone={STATUS_TONE[i.status]} label={t(`ui.status.${i.status}`)} />
                          <span className="min-w-0 flex-1 truncate" title={t(`ui.status.${i.status}`)}>
                            {i.name}
                          </span>
                          <span
                            className="text-xs text-muted tabular-nums"
                            title={
                              i.checkedAt
                                ? t('ui.overview.checked', {
                                    when: formatRelative(i.checkedAt, i18n.language),
                                  })
                                : undefined
                            }
                          >
                            {i.status === 'down' || i.status === 'unknown' || i.status === 'disabled'
                              ? t(`ui.status.${i.status}`)
                              : (i.version ?? '')}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionTitle>{t('ui.overview.nowPlaying')}</SectionTitle>
          {streams.length === 0 ? (
            <p className="text-sm text-muted">{t('ui.overview.noStreams')}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {streams.map((s) => (
                <li key={`${s.instanceId}:${s.id}`} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate font-medium">{s.title}</span>
                    <Badge tone={s.transcoding ? 'warning' : 'ok'}>
                      {s.transcoding ? t('ui.overview.transcoding') : t('ui.overview.directPlay')}
                    </Badge>
                  </div>
                  <div className="flex gap-2 text-xs text-muted">
                    {s.subtitle ? <span className="truncate">{s.subtitle}</span> : null}
                    <span>{s.user}</span>
                    {s.device ? <span>· {s.device}</span> : null}
                    <span className="ml-auto">
                      {s.state === 'paused' ? t('ui.overview.paused') : s.instanceName}
                    </span>
                  </div>
                  <ProgressBar
                    value={s.progress}
                    tone={s.state === 'paused' ? 'warning' : 'accent'}
                    label={s.title}
                  />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <SectionTitle>{t('ui.overview.activeDownloads')}</SectionTitle>
          {downloads.length === 0 ? (
            <p className="text-sm text-muted">{t('ui.overview.noDownloads')}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {downloads.slice(0, 12).map((d) => (
                <li key={`${d.instanceId}:${d.id}`} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate font-medium">{d.name}</span>
                    <span className="text-xs text-muted tabular-nums">
                      {formatSpeed(d.speedBytesPerSecond)}
                    </span>
                  </div>
                  <div className="flex gap-2 text-xs text-muted">
                    <span>{d.instanceName}</span>
                    {d.etaSeconds ? (
                      <span className="ml-auto">
                        {t('ui.overview.eta', { time: formatDuration(d.etaSeconds) })}
                      </span>
                    ) : null}
                  </div>
                  <ProgressBar value={d.progress} tone="ok" label={d.name} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
