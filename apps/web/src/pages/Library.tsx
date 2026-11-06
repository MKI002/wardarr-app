// Library: media server libraries and what was watched. Admins see every
// server, plays per person and recent plays; everyone else sees the shared
// totals without names.
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BarRow, Columns, Heatmap, LiveDot, ProgressRing, SegmentBar } from '../components/charts';
import { KpiCard, Odometer, PageHeader, SectionRule } from '../components/dash';
import {
  Badge,
  Button,
  Card,
  Choice,
  CountUp,
  EmptyState,
  InlineError,
  SectionTitle,
  Skeleton,
} from '../components/ui';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { formatBytes, formatDuration, formatRelative } from '../lib/format';
import { useSession } from '../lib/session';

type Kind = 'movie' | 'show' | 'music' | 'other';

interface LibraryStats {
  id: string;
  name: string;
  kind: Kind;
  items: number;
  files: number;
  sizeBytes: number | null;
  resolutions: Record<string, number>;
  videoCodecs: Record<string, number>;
}

interface ServerView {
  instanceId: string;
  instanceName: string;
  adapterName: string;
  refreshedAt: string | null;
  error: string | null;
  refreshing: boolean;
  libraries: LibraryStats[];
}

interface StreamStats {
  days: number;
  plays: number;
  playedMs: number;
  transcodes: number;
  users?: Array<{ user: string; plays: number; playedMs: number }>;
  topTitles: Array<{ title: string; mediaType: string; plays: number }>;
  perDay: Array<{ day: string; plays: number }>;
  /** Plays per weekday (Monday first) and local hour. */
  perHour?: number[][];
}

interface SharedStats {
  library: {
    kinds: Partial<Record<Kind, { items: number; sizeBytes: number }>>;
    resolutions: Record<string, number>;
    sizeBytes: number;
    refreshedAt: string | null;
  };
  streams: StreamStats;
}

interface Play {
  id: number;
  user: string;
  title: string;
  subtitle: string | null;
  startedAt: string;
  endedAt: string | null;
  playedMs: number;
  progress: number;
  transcoding: boolean;
  resolution: string | null;
  client: string | null;
}

const RANGES = [7, 30, 90, 365] as const;
const RES_ORDER = ['4K', '1080p', '720p', 'SD'];

const tz = () => -new Date().getTimezoneOffset();

export function LibraryPage() {
  const { t } = useTranslation();
  const { me } = useSession();
  const isAdmin = me.role === 'admin';
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const shared = useQuery({
    queryKey: ['stats', days],
    queryFn: () => api<SharedStats>(`/api/stats?days=${days}&tz=${tz()}`),
  });
  const full = useQuery({
    queryKey: ['library', days],
    queryFn: () =>
      api<{ servers: ServerView[]; streams: StreamStats }>(`/api/library?days=${days}&tz=${tz()}`),
    enabled: isAdmin,
  });
  const streams = isAdmin ? full.data?.streams : shared.data?.streams;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={t('ui.library.eyebrow')}
        title={t('ui.library.title')}
        intro={t(isAdmin ? 'ui.library.introAdmin' : 'ui.library.intro')}
        actions={
          <Choice
            label={t('ui.library.range')}
            hideLabel
            value={String(days)}
            onChange={(v) => setDays(Number(v) as (typeof RANGES)[number])}
            options={RANGES.map((d) => [String(d), t('ui.library.days', { count: d })])}
          />
        }
      />

      {shared.isError ? (
        <InlineError {...errorText(t, shared.error)} onRetry={() => void shared.refetch()} />
      ) : null}

      {streams ? <Hero stats={streams} /> : <Skeleton className="h-64 rounded-[var(--radius-card)]" />}
      <Totals data={shared.data} />

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card className="flex flex-col gap-3">
          <SectionTitle>{t('ui.library.whenWatched')}</SectionTitle>
          {streams ? <WhenWatched stats={streams} /> : <Skeleton className="h-40" />}
        </Card>
        <Card>
          <SectionTitle>{t('ui.library.topTitles')}</SectionTitle>
          {streams ? <TopTitles stats={streams} /> : <Skeleton className="h-40" />}
        </Card>
      </div>

      {isAdmin ? (
        <>
          {full.isError ? (
            <InlineError {...errorText(t, full.error)} onRetry={() => void full.refetch()} />
          ) : null}
          {full.data?.streams.users ? <PerUser users={full.data.streams.users} /> : null}
          <section className="flex flex-col gap-3">
            <SectionRule>{t('ui.library.servers')}</SectionRule>
            {full.isPending ? (
              <Skeleton className="h-48 rounded-[var(--radius-card)]" />
            ) : full.data?.servers.length === 0 ? (
              <Card>
                <EmptyState title={t('ui.library.noServers')} body={t('ui.library.noServersBody')} />
              </Card>
            ) : (
              full.data?.servers.map((s) => <ServerCard key={s.instanceId} server={s} />)
            )}
          </section>
          <RecentPlays />
        </>
      ) : null}
    </div>
  );
}

/** Hours watched as the hero, plays per day beside it, and how playback went. */
function Hero({ stats }: { stats: StreamStats }) {
  const { t, i18n } = useTranslation();
  const [today] = useState(() => Date.now());
  const dateFmt = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short' });
  const perDay = Array.from({ length: stats.days }, (_, i) => {
    const day = new Date(today - (stats.days - 1 - i) * 86_400_000).toISOString().slice(0, 10);
    return { day, plays: stats.perDay.find((p) => p.day === day)?.plays ?? 0 };
  });
  const direct = stats.plays - stats.transcodes;
  return (
    <Card className="grid gap-8 lg:grid-cols-[1fr_1.7fr] lg:items-center">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col">
          <Odometer
            text={formatDuration(Math.round(stats.playedMs / 1000))}
            className="text-5xl font-bold tracking-tight sm:text-6xl"
          />
          <span className="text-sm text-muted">{t('ui.library.watchedLabel')}</span>
        </div>
        <p className="text-lg font-medium text-balance">
          {t('ui.library.heroPlays', { count: stats.plays, days: stats.days })}
        </p>
        {stats.plays > 0 ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted">{t('ui.overview.playback')}</span>
            <SegmentBar
              tall
              label={t('ui.overview.playback')}
              segments={[
                { key: 'direct', label: t('ui.overview.directPlay'), value: direct, tone: 'accent' },
                {
                  key: 'transcode',
                  label: t('ui.library.transcoded'),
                  value: stats.transcodes,
                  tone: 'accent',
                  shade: 0.45,
                },
              ]}
            />
          </div>
        ) : null}
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">
          {t('ui.library.playsPerDay')}
        </span>
        <Columns
          height={180}
          label={t('ui.library.playsPerDay')}
          emptyLabel={t('ui.library.noPlays')}
          data={perDay.map((d) => ({
            key: d.day,
            label: dateFmt.format(new Date(`${d.day}T12:00:00`)),
            parts: [{ tone: 'accent', value: d.plays, label: t('ui.library.plays') }],
          }))}
        />
      </div>
    </Card>
  );
}

function Totals({ data }: { data: SharedStats | undefined }) {
  const { t, i18n } = useTranslation();
  if (!data) {
    return (
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-[var(--radius-card)]" />
        ))}
      </div>
    );
  }
  const n = new Intl.NumberFormat(i18n.language);
  const k = data.library.kinds;
  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard
          label={t('ui.library.movies')}
          value={<CountUp value={k.movie?.items ?? 0} format={(v) => n.format(Math.round(v))} />}
          sub={formatBytes(k.movie?.sizeBytes || null)}
        />
        <KpiCard
          label={t('ui.library.shows')}
          value={<CountUp value={k.show?.items ?? 0} format={(v) => n.format(Math.round(v))} />}
          sub={formatBytes(k.show?.sizeBytes || null)}
          delay={0.05}
        />
        <KpiCard
          label={t('ui.library.size')}
          value={formatBytes(data.library.sizeBytes || null)}
          delay={0.1}
        />
      </div>
      <p className="text-xs text-muted">
        {data.library.refreshedAt
          ? t('ui.library.refreshed', { when: formatRelative(data.library.refreshedAt, i18n.language) })
          : t('ui.library.notRefreshed')}
      </p>
    </div>
  );
}

function sortedResolutions(r: Record<string, number>): Array<[string, number]> {
  return Object.entries(r).sort(
    (a, b) => ((RES_ORDER.indexOf(a[0]) + 99) % 99) - ((RES_ORDER.indexOf(b[0]) + 99) % 99),
  );
}

/** One hue, darker for higher resolutions. */
function resolutionSegments(res: Array<[string, number]>) {
  return res.map(([key, value], i) => ({
    key,
    label: key,
    value,
    tone: 'accent' as const,
    shade: Math.max(0.3, 1 - i * 0.22),
  }));
}

/** Weekday × hour heatmap in the viewer's time zone. */
function WhenWatched({ stats }: { stats: StreamStats }) {
  const { t, i18n } = useTranslation();
  if (!stats.perHour || stats.plays === 0)
    return <EmptyState title={t('ui.library.noPlays')} body={t('ui.library.noPlaysBody')} />;
  // 2024-01-01 was a Monday.
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Date(2024, 0, 1 + i).toLocaleDateString(i18n.language, { weekday: 'short' }),
  );
  return (
    <Heatmap
      rows={weekdays}
      columns={24}
      values={stats.perHour}
      label={t('ui.library.heatLabel')}
      cellLabel={(row, col, value) =>
        t('ui.library.heatCell', {
          day: weekdays[row],
          hour: String(col).padStart(2, '0'),
          plays: t('ui.library.playsCount', { count: value }),
        })
      }
      columnTicks={[
        [0, '0'],
        [6, '6'],
        [12, '12'],
        [18, '18'],
        [23, '23'],
      ]}
      less={t('ui.library.fewer')}
      more={t('ui.library.more')}
    />
  );
}

function RankList({
  rows,
  format,
}: {
  rows: Array<{ key: string; label: string; value: number }>;
  format: (n: number) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="flex flex-col gap-3">
      {rows.map((r, i) => (
        <BarRow
          key={r.key}
          label={r.label}
          value={r.value}
          max={max}
          display={format(r.value)}
          delay={0.05 * i}
        />
      ))}
    </div>
  );
}

function TopTitles({ stats }: { stats: StreamStats }) {
  const { t } = useTranslation();
  if (stats.topTitles.length === 0) return <EmptyState title={t('ui.library.noPlays')} />;
  return (
    <RankList
      rows={stats.topTitles.slice(0, 8).map((x) => ({
        key: `${x.mediaType}:${x.title}`,
        label: x.title,
        value: x.plays,
      }))}
      format={(n) => t('ui.library.playsCount', { count: n })}
    />
  );
}

function PerUser({ users }: { users: NonNullable<StreamStats['users']> }) {
  const { t } = useTranslation();
  if (users.length === 0) return null;
  return (
    <Card>
      <SectionTitle>{t('ui.library.perUser')}</SectionTitle>
      <RankList
        rows={users.map((u) => ({ key: u.user, label: u.user, value: u.plays }))}
        format={(n) => t('ui.library.playsCount', { count: n })}
      />
    </Card>
  );
}

function ServerCard({ server }: { server: ServerView }) {
  const { t, i18n } = useTranslation();
  const refresh = useMutation({
    mutationFn: () =>
      api(`/api/library/${encodeURIComponent(server.instanceId)}/refresh`, { method: 'POST' }),
  });
  const n = new Intl.NumberFormat(i18n.language);
  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">{server.instanceName}</h3>
          <p className="text-xs text-muted">
            {server.adapterName} ·{' '}
            {server.refreshedAt
              ? t('ui.library.refreshed', { when: formatRelative(server.refreshedAt, i18n.language) })
              : t('ui.library.notRefreshed')}
          </p>
        </div>
        <Button busy={server.refreshing || refresh.isPending} onClick={() => refresh.mutate()}>
          {server.refreshing ? t('ui.library.refreshing') : t('ui.library.refresh')}
        </Button>
      </div>
      {server.error ? (
        <div className="mb-4">
          <InlineError
            message={t('ui.library.refreshFailed', { reason: t(`ui.instance.testFailed.${server.error}`) })}
            next={server.libraries.length ? t('ui.library.refreshFailedNext') : undefined}
          />
        </div>
      ) : null}
      {server.libraries.length === 0 && !server.error ? (
        server.refreshing || !server.refreshedAt ? (
          <Skeleton className="h-24" />
        ) : (
          <EmptyState title={t('ui.library.noLibraries')} />
        )
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {server.libraries.map((lib) => {
            const res = sortedResolutions(lib.resolutions);
            const codecs = Object.entries(lib.videoCodecs).sort((a, b) => b[1] - a[1]);
            return (
              <li key={lib.id} className="flex flex-col gap-3 rounded-xl bg-surface-2 p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate font-medium">{lib.name}</p>
                  <span className="text-xs text-muted">{t(`ui.library.kind.${lib.kind}`)}</span>
                </div>
                <p className="text-sm">
                  <span className="text-2xl font-semibold tabular-nums">{n.format(lib.items)}</span>{' '}
                  <span className="text-muted">
                    {t(`ui.library.items.${lib.kind}`)} · {formatBytes(lib.sizeBytes)}
                  </span>
                </p>
                {res.length ? (
                  <SegmentBar tall label={t('ui.library.resolutions')} segments={resolutionSegments(res)} />
                ) : null}
                {codecs.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {codecs.map(([c, v]) => (
                      <span key={c} className="rounded-md bg-surface px-1.5 py-0.5 text-xs text-muted">
                        {c.toUpperCase()} <span className="text-text tabular-nums">{n.format(v)}</span>
                      </span>
                    ))}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

const RECENT = 8;

function RecentPlays() {
  const { t, i18n } = useTranslation();
  const [all, setAll] = useState(false);
  const plays = useQuery({
    queryKey: ['stream-history'],
    queryFn: () => api<{ plays: Play[] }>('/api/streams/history?limit=25'),
  });
  const list = plays.data?.plays ?? [];
  const shown = all ? list : list.slice(0, RECENT);
  return (
    <section className="flex flex-col gap-3">
      <SectionRule
        action={
          list.length > RECENT ? (
            <button
              type="button"
              className="rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-text"
              onClick={() => setAll(!all)}
            >
              {all ? t('ui.library.showFewer') : t('ui.library.showAll', { count: list.length })}
            </button>
          ) : null
        }
      >
        {t('ui.library.recent')}
      </SectionRule>
      <Card className="!p-0">
        {plays.isPending ? (
          <div className="p-5">
            <Skeleton className="h-24" />
          </div>
        ) : plays.isError ? (
          <div className="p-5">
            <InlineError {...errorText(t, plays.error)} onRetry={() => void plays.refetch()} />
          </div>
        ) : list.length === 0 ? (
          <EmptyState title={t('ui.library.noPlays')} body={t('ui.library.noPlaysBody')} />
        ) : (
          <ul className="divide-y divide-border">
            {shown.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                <ProgressRing value={p.progress / 100} size={36} label={`${p.progress}%`}>
                  {p.progress}
                </ProgressRing>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {p.title}
                    {p.subtitle ? <span className="font-normal text-muted"> · {p.subtitle}</span> : null}
                  </p>
                  <p className="text-xs text-muted">
                    {[p.user, p.client, formatRelative(p.startedAt, i18n.language)]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {p.transcoding ? <Badge tone="warning">{t('ui.library.transcoded')}</Badge> : null}
                  {p.endedAt ? null : (
                    <span className="flex items-center gap-1.5 text-xs text-ok">
                      <LiveDot label={t('ui.library.live')} />
                      {t('ui.library.live')}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
