import { useQuery } from '@tanstack/react-query';
import { Link, Navigate } from '@tanstack/react-router';
import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LiveDot, ProgressRing, SegmentBar, Sparkline, useCalm } from '../components/charts';
import { InsightRow, KpiCard, MiniBars, Odometer, PageHeader, SectionRule } from '../components/dash';
import { CATEGORY_ORDER } from '../components/InstanceForm';
import { IssueIcon } from '../components/IssueIcon';
import { useTabs } from '../components/Layout';
import { Radar } from '../components/Radar';
import { ServiceLogo } from '../components/ServiceLogo';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Guardian,
  InlineError,
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
import { parseRelease } from '../lib/release';
import { formatBytes } from '@wardarr/i18n';
import { useSession } from '../lib/session';

const SEVERITY_TONE: Record<string, Tone> = { critical: 'critical', warning: 'warning', info: 'info' };

export function useOverview() {
  return useQuery({
    queryKey: ['overview'],
    queryFn: () => api<Overview>('/api/overview'),
    refetchInterval: 30_000,
  });
}

function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy>
      <Skeleton className="h-16 w-64" />
      <div className="grid gap-4 lg:grid-cols-5">
        <Skeleton className="h-72 rounded-[var(--radius-card)] lg:col-span-3" />
        <Skeleton className="h-72 rounded-[var(--radius-card)] lg:col-span-2" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-28 rounded-[var(--radius-card)]" />
        ))}
      </div>
    </div>
  );
}

export function OverviewPage() {
  const { me } = useSession();
  const tabs = useTabs();
  // The overview is for admins. Everyone else starts in Discover when a
  // request manager is connected, then in the calendar, otherwise in Settings.
  if (me.role !== 'admin') {
    if (tabs.isPending) return null;
    const open = tabs.data?.tabs ?? [];
    return (
      <Navigate
        to={open.includes('discover') ? '/discover' : open.includes('calendar') ? '/calendar' : '/settings'}
      />
    );
  }
  return <AdminOverview />;
}

function AdminOverview() {
  const { t } = useTranslation();
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
  const { instances } = overview.data;

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

  return <Dashboard data={overview.data} />;
}

// ------------------------------------------------------------------ parts

type Data = Overview;

interface TrendPoint {
  at: string;
  speed: number;
  downloads: number;
  streams: number;
}

function useTrend() {
  return useQuery({
    queryKey: ['overview', 'trend'],
    queryFn: () => api<{ points: TrendPoint[] }>('/api/overview/trend'),
    refetchInterval: 60_000,
  });
}

function Dashboard({ data }: { data: Data }) {
  const { t, i18n } = useTranslation();
  const trend = useTrend().data?.points ?? [];
  const { stats, streams, downloads } = data;
  const today = new Intl.DateTimeFormat(i18n.language, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());
  const time = (i: number) =>
    trend[i]
      ? new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }).format(
          new Date(trend[i].at),
        )
      : '';
  const peak = Math.max(0, ...trend.map((p) => p.speed));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow={today} title={t('ui.overview.title')} />

      <div className="grid gap-4 lg:grid-cols-5">
        <HealthHero data={data} />
        <WorthALook data={data} />
      </div>

      <SectionRule>{t('ui.overview.rightNow')}</SectionRule>
      <div className={`grid gap-4 ${data.storage ? 'sm:grid-cols-2 xl:grid-cols-4' : 'sm:grid-cols-3'}`}>
        <KpiCard
          label={t('ui.overview.streams')}
          tone={stats.activeStreams > 0 ? 'ok' : 'neutral'}
          value={<Odometer text={String(stats.activeStreams)} />}
          sub={
            stats.activeStreams === 0
              ? t('ui.overview.nobodyWatching')
              : stats.transcodes > 0
                ? t('ui.overview.transcodes', { count: stats.transcodes })
                : t('ui.overview.directPlay')
          }
          chart={
            <MiniBars
              tone="ok"
              values={trend.map((p) => p.streams)}
              label={t('ui.overview.lastHour', { label: t('ui.overview.streams') })}
            />
          }
        />
        <KpiCard
          delay={0.05}
          label={t('ui.overview.downloads')}
          tone={stats.activeDownloads > 0 ? 'info' : 'neutral'}
          value={<Odometer text={String(stats.activeDownloads)} />}
          sub={
            stats.activeDownloads === 0
              ? t('ui.overview.idle')
              : t('ui.overview.totalSpeed', { speed: formatSpeed(stats.downloadSpeed) })
          }
          chart={
            <MiniBars
              tone="info"
              values={trend.map((p) => p.downloads)}
              label={t('ui.overview.lastHour', { label: t('ui.overview.downloads') })}
            />
          }
        />
        <KpiCard
          delay={0.1}
          label={t('ui.overview.speed')}
          value={<Odometer text={formatSpeed(stats.downloadSpeed)} />}
          sub={
            peak > 0
              ? t('ui.overview.peak', { speed: formatSpeed(peak) })
              : stats.activeDownloads > 0
                ? t('ui.overview.acrossDownloads', { count: stats.activeDownloads })
                : t('ui.overview.idle')
          }
          chart={
            <div className="w-28">
              <Sparkline
                values={trend.map((p) => p.speed)}
                height={44}
                format={formatSpeed}
                pointLabel={time}
                label={t('ui.overview.lastHour', { label: t('ui.overview.speed') })}
              />
            </div>
          }
        />
        {data.storage ? <StorageKpi storage={data.storage} /> : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <DownloadsCard downloads={downloads} />
        <StreamsCard streams={streams} />
      </div>

      <section className="flex flex-col gap-4">
        <SectionRule
          action={
            <Link
              to="/settings"
              search={{ section: 'instances' }}
              className="shrink-0 text-sm text-accent hover:underline"
            >
              {t('ui.common.edit')}
            </Link>
          }
        >
          {t('ui.overview.services')}
        </SectionRule>
        <ServiceTiles instances={data.instances} />
      </section>
    </div>
  );
}

/** Free space on the media disks, and the disk that runs full first. */
function StorageKpi({ storage }: { storage: NonNullable<Data['storage']> }) {
  const { t, i18n } = useTranslation();
  const used = storage.totalBytes > 0 ? 1 - storage.freeBytes / storage.totalBytes : 0;
  const soon = storage.soonest && storage.soonest.daysLeft !== null ? storage.soonest : null;
  const tone: Tone = storage.worst === 'ok' ? 'ok' : storage.worst;
  return (
    <Link
      to="/storage"
      search={soon ? { disk: soon.key } : {}}
      className="block h-full rounded-[var(--radius-card)]"
    >
      <KpiCard
        delay={0.15}
        label={t('ui.storage.overviewLabel')}
        tone={tone}
        value={<Odometer text={formatBytes(storage.freeBytes, i18n.language)} />}
        sub={
          soon
            ? t('ui.storage.overviewSoon', {
                disk: soon.label,
                count: Math.max(0, Math.round(soon.daysLeft!)),
              })
            : t('ui.storage.overviewFine', { count: storage.disks })
        }
        chart={
          <ProgressRing
            value={used}
            size={44}
            tone={storage.worst === 'ok' ? 'accent' : tone}
            label={t('ui.storage.overviewChart')}
          >
            {Math.round(used * 100)}%
          </ProgressRing>
        }
      />
    </Link>
  );
}

const RADAR_SECTORS = CATEGORY_ORDER as string[];

function HealthHero({ data }: { data: Data }) {
  const { t } = useTranslation();
  const { instances, stats } = data;
  const count = (tone: Tone) => instances.filter((i) => STATUS_TONE[i.status] === tone).length;
  const down = count('critical');
  const warn = count('warning');
  const sentence =
    down > 0
      ? t('ui.overview.healthDown', { count: down })
      : warn > 0
        ? t('ui.overview.healthSome', { count: warn })
        : t('ui.overview.healthAllGood');
  const legend: Array<[Tone, number]> = (['ok', 'warning', 'critical', 'neutral'] as Tone[])
    .map((tone) => [tone, count(tone)] as [Tone, number])
    .filter(([, n]) => n > 0);
  const toneLabel: Record<Tone, string> = {
    ok: t('ui.status.ok'),
    warning: t('ui.status.degraded'),
    critical: t('ui.status.down'),
    info: '',
    neutral: t('ui.status.unknown'),
  };

  return (
    <motion.div
      className="lg:col-span-3"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
    >
      <Card as="div" className="flex h-full flex-col items-center gap-6 overflow-hidden sm:flex-row sm:p-7">
        <div className="flex min-w-0 flex-1 flex-col gap-3 self-stretch">
          <span className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">
            {t('ui.overview.status')}
          </span>
          <div className="flex items-baseline gap-3">
            <span className="text-6xl leading-none font-bold tracking-tight">
              <Odometer text={String(stats.instancesOnline)} />
            </span>
            <span className="text-lg text-muted">
              {t('ui.overview.onlineOf', { total: stats.instancesTotal })}
            </span>
          </div>
          <p className="text-base font-medium text-balance">{sentence}</p>
          <CategoryBreakdown instances={instances} />
          <ul className="mt-auto flex flex-wrap gap-2 pt-1">
            {legend.map(([tone, n]) => (
              <li
                key={tone}
                className="flex items-center gap-2 rounded-full bg-surface-2 px-3 py-1 text-xs font-medium"
              >
                <StatusDot tone={tone} label={toneLabel[tone]} />
                <span className="tabular-nums">{n}</span>
                <span className="text-muted">{toneLabel[tone]}</span>
              </li>
            ))}
          </ul>
        </div>
        <Radar
          size={232}
          label={t('ui.overview.radar')}
          sectors={RADAR_SECTORS}
          sectorLabel={(s) => t(`adapters.category.${s}`)}
          blips={instances.map((i) => ({
            id: i.id,
            name: i.name,
            sector: i.category,
            tone: STATUS_TONE[i.status],
            detail:
              i.status === 'ok' || i.status === 'degraded'
                ? `${t(`ui.status.${i.status}`)}${i.version ? ` · ${i.version}` : ''}`
                : t(`ui.status.${i.status}`),
          }))}
        />
      </Card>
    </motion.div>
  );
}

/** Per category: how many services, and a thin bar of their states. */
function CategoryBreakdown({ instances }: { instances: Data['instances'] }) {
  const { t } = useTranslation();
  const cats = CATEGORY_ORDER.map((cat) => ({
    cat,
    items: instances.filter((i) => i.category === cat),
  })).filter((c) => c.items.length > 0);
  return (
    <ul className="grid grid-cols-2 gap-x-6 gap-y-3 pt-2">
      {cats.map(({ cat, items }) => (
        <li key={cat} className="flex min-w-0 flex-col gap-1.5">
          <span className="flex items-baseline justify-between gap-2 text-xs">
            <span className="truncate text-muted">{t(`adapters.category.${cat}`)}</span>
            <span className="font-semibold tabular-nums">{items.length}</span>
          </span>
          <SegmentBar
            label={t(`adapters.category.${cat}`)}
            segments={(['ok', 'warning', 'critical', 'neutral'] as Tone[]).map((tone) => ({
              key: tone,
              label: t(`ui.overview.tone.${tone}`),
              value: items.filter((i) => STATUS_TONE[i.status] === tone).length,
              tone,
            }))}
          />
        </li>
      ))}
    </ul>
  );
}

function WorthALook({ data }: { data: Data }) {
  const { t } = useTranslation();
  const { issues } = data;
  const total = issues.needsAttention.length + (issues.wardarr > 0 ? 1 : 0);
  return (
    <motion.div
      className="lg:col-span-2"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring, delay: 0.05 }}
    >
      <Card as="div" className="flex h-full flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">{t('ui.overview.worthALook')}</h2>
          {total > 0 ? (
            <span className="grid size-6 place-items-center rounded-full bg-accent text-xs font-semibold text-accent-contrast tabular-nums">
              {total}
            </span>
          ) : null}
        </div>
        <SegmentBar
          legend
          label={t('ui.issues.bySeverity')}
          segments={(['critical', 'warning', 'info'] as const).map((s) => ({
            key: s,
            label: t(`ui.issues.severity.${s}`),
            value: issues.counts[s],
            tone: s,
          }))}
        />
        {total === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center">
            <Guardian size={56} glance />
            <p className="font-medium">{t('ui.overview.allClearTitle')}</p>
            <p className="text-sm text-muted">{t('ui.overview.attentionNone')}</p>
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            <AnimatePresence initial={false}>
              {issues.wardarr > 0 ? (
                <InsightRow key="wardarr" icon={<Guardian size={36} happy={false} />} action={<LookLink />}>
                  <span className="font-medium">
                    {t('ui.overview.wardarrIssues', { count: issues.wardarr })}
                  </span>
                </InsightRow>
              ) : null}
              {issues.needsAttention.map((i, idx) => (
                <InsightRow
                  key={i.fingerprint}
                  index={idx + 1}
                  icon={
                    <IssueIcon
                      fingerprint={i.fingerprint}
                      tone={SEVERITY_TONE[i.severity] ?? 'neutral'}
                      label={t(`ui.issues.severity.${i.severity}`)}
                    />
                  }
                  action={<LookLink focus={i.fingerprint} />}
                >
                  <span className="font-medium">{tm(t, i.title)}</span>
                  <span className="text-muted"> · {tm(t, i.affected)}</span>
                </InsightRow>
              ))}
            </AnimatePresence>
          </ul>
        )}
        {total > 0 ? (
          <Link to="/issues" className="mt-auto pt-1 text-sm text-accent hover:underline">
            {t('ui.overview.attentionAll')}
          </Link>
        ) : null}
      </Card>
    </motion.div>
  );
}

function LookLink({ focus }: { focus?: string }) {
  const { t } = useTranslation();
  return (
    <Link
      to="/issues"
      search={focus ? { focus } : {}}
      className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-medium hover:border-accent hover:text-accent"
    >
      {t('ui.overview.look')}
      <Chevron />
    </Link>
  );
}

function Chevron() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function DownloadsCard({ downloads }: { downloads: Data['downloads'] }) {
  const { t } = useTranslation();
  const calm = useCalm();
  const fastest = Math.max(1, ...downloads.map((d) => d.speedBytesPerSecond ?? 0));
  return (
    <Card>
      <SectionTitle>{t('ui.overview.activeDownloads')}</SectionTitle>
      {downloads.length === 0 ? (
        <EmptyLine text={t('ui.overview.noDownloads')} />
      ) : (
        <ul className="flex flex-col gap-4">
          {downloads.slice(0, 5).map((d, i) => {
            const r = parseRelease(d.name);
            const speed = d.speedBytesPerSecond ?? 0;
            const pct = Math.round(Math.max(0, Math.min(1, d.progress)) * 100);
            const moving = speed > 0 && !calm;
            return (
              <motion.li
                key={`${d.instanceId}:${d.id}`}
                className="flex flex-col gap-1.5"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...spring, delay: i * 0.04 }}
              >
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 truncate font-medium" title={d.name}>
                    {r.title}
                  </span>
                  {r.episode ? <Chip>{r.episode}</Chip> : r.year ? <Chip>{r.year}</Chip> : null}
                  <span className="ml-auto shrink-0 text-sm font-semibold tabular-nums">
                    {speed > 0 ? formatSpeed(speed) : '–'}
                  </span>
                </div>
                <div className="relative h-2 w-full overflow-hidden rounded-full bg-surface-2">
                  <motion.div
                    className={`h-full rounded-full bg-info ${moving ? 'flow-stripes' : ''}`}
                    style={
                      moving
                        ? { ['--flow-speed' as string]: `${(2.2 - 1.6 * (speed / fastest)).toFixed(2)}s` }
                        : undefined
                    }
                    initial={calm ? false : { width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.8, ease: [0.2, 0.8, 0.2, 1] }}
                    role="progressbar"
                    aria-label={r.title}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={pct}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                  <span>{d.instanceName}</span>
                  {r.tags.map((tag) => (
                    <span key={tag} className="rounded bg-surface-2 px-1.5 py-px font-mono text-[10px]">
                      {tag}
                    </span>
                  ))}
                  <span className="ml-auto tabular-nums">
                    {t('ui.overview.done', { percent: pct })}
                    {d.etaSeconds ? ` · ${t('ui.overview.eta', { time: formatDuration(d.etaSeconds) })}` : ''}
                  </span>
                </div>
              </motion.li>
            );
          })}
        </ul>
      )}
      {downloads.length > 5 ? (
        <p className="mt-3 text-xs text-muted">
          {t('ui.overview.moreDownloads', { count: downloads.length - 5 })}
        </p>
      ) : null}
    </Card>
  );
}

function StreamsCard({ streams }: { streams: Data['streams'] }) {
  const { t } = useTranslation();
  const transcodes = streams.filter((s) => s.transcoding).length;
  return (
    <Card className="flex flex-col">
      <SectionTitle>{t('ui.overview.nowPlaying')}</SectionTitle>
      {streams.length === 0 ? (
        <EmptyLine text={t('ui.overview.noStreams')} />
      ) : (
        <ul className="mb-4 flex flex-col gap-3">
          {streams.map((s, i) => {
            const pct = Math.round(Math.max(0, Math.min(1, s.progress)) * 100);
            const paused = s.state === 'paused';
            return (
              <motion.li
                key={`${s.instanceId}:${s.id}`}
                className="flex items-center gap-3"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...spring, delay: i * 0.05 }}
              >
                <ProgressRing
                  value={s.progress}
                  size={44}
                  tone={paused ? 'warning' : 'accent'}
                  label={s.title}
                >
                  {pct}%
                </ProgressRing>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    {paused ? (
                      <span className="text-xs font-medium text-warning">{t('ui.overview.paused')}</span>
                    ) : (
                      <LiveDot label={t('ui.overview.playing')} />
                    )}
                    <span className="min-w-0 truncate font-medium">{s.title}</span>
                  </div>
                  <span className="truncate text-xs text-muted">
                    {[s.subtitle, s.user, s.device].filter(Boolean).join(' · ')}
                  </span>
                </div>
                <Badge tone={s.transcoding ? 'warning' : 'ok'}>
                  {s.transcoding ? t('ui.overview.transcoding') : t('ui.overview.directPlay')}
                </Badge>
              </motion.li>
            );
          })}
        </ul>
      )}
      {streams.length > 0 ? (
        <div className="mt-auto flex flex-col gap-2 border-t border-border pt-4">
          <span className="text-xs font-medium text-muted">{t('ui.overview.playback')}</span>
          <SegmentBar
            tall
            label={t('ui.overview.playback')}
            segments={[
              {
                key: 'direct',
                label: t('ui.overview.directPlay'),
                value: streams.length - transcodes,
                tone: 'ok',
              },
              { key: 'transcode', label: t('ui.overview.transcoding'), value: transcodes, tone: 'warning' },
            ]}
          />
        </div>
      ) : null}
    </Card>
  );
}

function ServiceTiles({ instances }: { instances: Data['instances'] }) {
  const { t, i18n } = useTranslation();
  const byCategory = CATEGORY_ORDER.map((cat) => ({
    cat,
    groups: groupByProduct(instances.filter((i) => i.category === cat)),
  })).filter((c) => c.groups.length > 0);
  let n = 0;
  return (
    <div className="flex flex-wrap gap-x-8 gap-y-5">
      {byCategory.map(({ cat, groups }) => (
        <div key={cat} className="flex min-w-0 flex-col gap-2">
          <h3 className="text-xs font-medium text-muted">{t(`adapters.category.${cat}`)}</h3>
          <div className="flex flex-wrap gap-2">
            {groups.map((g) => (
              <motion.div
                key={g.adapter}
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ ...spring, delay: n++ * 0.03 }}
                className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-border bg-surface px-3 py-2.5"
              >
                <div className="flex items-center gap-2">
                  <ServiceLogo adapter={g.adapter} name={g.items[0]?.adapterName ?? g.adapter} size={18} />
                  <span className="text-sm font-semibold">{g.items[0]?.adapterName}</span>
                  {g.items.length > 1 ? (
                    <Badge tone="neutral">{t('ui.instance.instances', { count: g.items.length })}</Badge>
                  ) : null}
                </div>
                <ul className="flex flex-wrap gap-x-3 gap-y-1">
                  {g.items.map((i) => {
                    const detail =
                      i.status === 'ok' || i.status === 'degraded'
                        ? `${t(`ui.status.${i.status}`)}${i.version ? ` · ${i.version}` : ''}`
                        : t(`ui.status.${i.status}`);
                    return (
                      <li
                        key={i.id}
                        className="flex items-center gap-1.5 text-sm"
                        title={`${detail}${i.checkedAt ? ` · ${t('ui.overview.checked', { when: formatRelative(i.checkedAt, i18n.language) })}` : ''}`}
                      >
                        <StatusDot tone={STATUS_TONE[i.status]} label={detail} />
                        <span className="max-w-40 truncate">{i.name}</span>
                      </li>
                    );
                  })}
                </ul>
              </motion.div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 rounded-md bg-accent/12 px-1.5 py-px text-xs font-semibold text-accent tabular-nums">
      {children}
    </span>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3 py-4 text-sm text-muted">
      <Guardian size={32} />
      {text}
    </div>
  );
}
