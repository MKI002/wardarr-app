// Library: media server libraries and what was watched. Admins see every
// server, plays per person and recent plays; everyone else sees the shared
// totals without names.
import { useMutation, useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  spring,
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

export function LibraryPage() {
  const { t } = useTranslation();
  const { me } = useSession();
  const isAdmin = me.role === 'admin';
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const shared = useQuery({
    queryKey: ['stats', days],
    queryFn: () => api<SharedStats>(`/api/stats?days=${days}`),
  });
  const full = useQuery({
    queryKey: ['library', days],
    queryFn: () => api<{ servers: ServerView[]; streams: StreamStats }>(`/api/library?days=${days}`),
    enabled: isAdmin,
  });
  const streams = isAdmin ? full.data?.streams : shared.data?.streams;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('ui.library.title')}</h1>
          <p className="text-sm text-muted">{t(isAdmin ? 'ui.library.introAdmin' : 'ui.library.intro')}</p>
        </div>
        <Choice
          label={t('ui.library.range')}
          hideLabel
          value={String(days)}
          onChange={(v) => setDays(Number(v) as (typeof RANGES)[number])}
          options={RANGES.map((d) => [String(d), t('ui.library.days', { count: d })])}
        />
      </div>

      {shared.isError ? (
        <InlineError {...errorText(t, shared.error)} onRetry={() => void shared.refetch()} />
      ) : null}

      <Totals data={shared.data} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionTitle>{t('ui.library.playsPerDay')}</SectionTitle>
          {streams ? <PlaysPerDay stats={streams} /> : <Skeleton className="h-40" />}
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
            <SectionTitle>{t('ui.library.servers')}</SectionTitle>
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

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Card className="!p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{children}</p>
    </Card>
  );
}

function Totals({ data }: { data: SharedStats | undefined }) {
  const { t, i18n } = useTranslation();
  if (!data) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-20 rounded-[var(--radius-card)]" />
        ))}
      </div>
    );
  }
  const n = new Intl.NumberFormat(i18n.language);
  const k = data.library.kinds;
  const transcodeShare = data.streams.plays
    ? Math.round((data.streams.transcodes / data.streams.plays) * 100)
    : 0;
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label={t('ui.library.movies')}>
          <CountUp value={k.movie?.items ?? 0} format={(v) => n.format(Math.round(v))} />
        </Stat>
        <Stat label={t('ui.library.shows')}>
          <CountUp value={k.show?.items ?? 0} format={(v) => n.format(Math.round(v))} />
        </Stat>
        <Stat label={t('ui.library.size')}>{formatBytes(data.library.sizeBytes || null)}</Stat>
        <Stat label={t('ui.library.plays')}>
          <CountUp value={data.streams.plays} format={(v) => n.format(Math.round(v))} />
        </Stat>
        <Stat label={t('ui.library.watched')}>
          {formatDuration(Math.round(data.streams.playedMs / 1000))}
        </Stat>
      </div>
      <p className="text-xs text-muted">
        {t('ui.library.transcodeShare', { percent: transcodeShare })}
        {' · '}
        {data.library.refreshedAt
          ? t('ui.library.refreshed', { when: formatRelative(data.library.refreshedAt, i18n.language) })
          : t('ui.library.notRefreshed')}
      </p>
    </div>
  );
}

/** Plays per day as thin bars, one hue, with a value on hover and focus. */
function PlaysPerDay({ stats }: { stats: StreamStats }) {
  const { t, i18n } = useTranslation();
  const [hover, setHover] = useState<number | null>(null);
  const [today] = useState(() => Date.now());
  const days = Array.from({ length: stats.days }, (_, i) => {
    const d = new Date(today - (stats.days - 1 - i) * 86_400_000).toISOString().slice(0, 10);
    return { day: d, plays: stats.perDay.find((p) => p.day === d)?.plays ?? 0 };
  });
  const max = Math.max(1, ...days.map((d) => d.plays));
  if (stats.plays === 0)
    return <EmptyState title={t('ui.library.noPlays')} body={t('ui.library.noPlaysBody')} />;
  const dateFmt = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short' });
  const active = hover !== null ? days[hover] : undefined;
  return (
    <figure className="flex flex-col gap-2">
      <p className="h-5 text-sm tabular-nums" aria-live="polite">
        {active ? (
          <>
            <span className="text-muted">{dateFmt.format(new Date(active.day))}: </span>
            {t('ui.library.playsCount', { count: active.plays })}
          </>
        ) : (
          <span className="text-muted">{t('ui.library.peak', { count: max })}</span>
        )}
      </p>
      <div className="flex h-36 items-end gap-[2px]" onMouseLeave={() => setHover(null)}>
        {days.map((d, i) => (
          <button
            key={d.day}
            type="button"
            className="group flex h-full min-w-0 flex-1 items-end outline-none"
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            aria-label={`${dateFmt.format(new Date(d.day))}: ${t('ui.library.playsCount', { count: d.plays })}`}
          >
            <motion.span
              className={`block w-full rounded-t-[4px] ${hover === i ? 'bg-accent' : 'bg-accent/70'} group-focus-visible:ring-2 group-focus-visible:ring-accent`}
              initial={{ height: 0 }}
              animate={{ height: d.plays ? `${Math.max(4, (d.plays / max) * 100)}%` : '2px' }}
              transition={spring}
              style={d.plays ? undefined : { opacity: 0.25 }}
            />
          </button>
        ))}
      </div>
      <figcaption className="flex justify-between text-xs text-muted">
        <span>{dateFmt.format(new Date(days[0]!.day))}</span>
        <span>{dateFmt.format(new Date(days[days.length - 1]!.day))}</span>
      </figcaption>
    </figure>
  );
}

/** A ranked list with a bar per row; the number stays in text color. */
function BarList({
  rows,
  format,
}: {
  rows: Array<{ key: string; label: string; value: number }>;
  format: (n: number) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <li key={r.key} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate">{r.label}</span>
            <span className="shrink-0 text-muted tabular-nums">{format(r.value)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-surface-2">
            <motion.div
              className="h-full rounded-full bg-accent"
              initial={{ width: 0 }}
              animate={{ width: `${(r.value / max) * 100}%` }}
              transition={spring}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function TopTitles({ stats }: { stats: StreamStats }) {
  const { t } = useTranslation();
  if (stats.topTitles.length === 0) return <EmptyState title={t('ui.library.noPlays')} />;
  return (
    <BarList
      rows={stats.topTitles.map((x) => ({
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
      <BarList
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
            const res = Object.entries(lib.resolutions).sort(
              (a, b) => ((RES_ORDER.indexOf(a[0]) + 99) % 99) - ((RES_ORDER.indexOf(b[0]) + 99) % 99),
            );
            const codecs = Object.entries(lib.videoCodecs).sort((a, b) => b[1] - a[1]);
            return (
              <li key={lib.id} className="rounded-xl border border-border p-4">
                <div className="mb-3 flex items-baseline justify-between gap-2">
                  <p className="truncate font-medium">{lib.name}</p>
                  <Badge tone="neutral">{t(`ui.library.kind.${lib.kind}`)}</Badge>
                </div>
                <p className="text-sm">
                  <span className="text-xl font-semibold tabular-nums">{n.format(lib.items)}</span>{' '}
                  <span className="text-muted">
                    {t(`ui.library.items.${lib.kind}`)} · {formatBytes(lib.sizeBytes)}
                  </span>
                </p>
                {res.length ? (
                  <div className="mt-3">
                    <BarList
                      rows={res.map(([k, v]) => ({ key: k, label: k, value: v }))}
                      format={(v) => n.format(v)}
                    />
                  </div>
                ) : null}
                {codecs.length ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {codecs.map(([c, v]) => (
                      <Badge key={c} tone="neutral">
                        {c.toUpperCase()} {n.format(v)}
                      </Badge>
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

function RecentPlays() {
  const { t, i18n } = useTranslation();
  const plays = useQuery({
    queryKey: ['stream-history'],
    queryFn: () => api<{ plays: Play[] }>('/api/streams/history?limit=25'),
  });
  return (
    <section>
      <SectionTitle>{t('ui.library.recent')}</SectionTitle>
      <Card className="!p-0">
        {plays.isPending ? (
          <div className="p-5">
            <Skeleton className="h-24" />
          </div>
        ) : plays.isError ? (
          <div className="p-5">
            <InlineError {...errorText(t, plays.error)} onRetry={() => void plays.refetch()} />
          </div>
        ) : plays.data.plays.length === 0 ? (
          <EmptyState title={t('ui.library.noPlays')} body={t('ui.library.noPlaysBody')} />
        ) : (
          <ul className="divide-y divide-border">
            {plays.data.plays.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <div className="min-w-0">
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
                <div className="flex items-center gap-1.5">
                  {p.endedAt ? null : <Badge tone="ok">{t('ui.library.live')}</Badge>}
                  {p.transcoding ? <Badge tone="warning">{t('ui.library.transcoded')}</Badge> : null}
                  <Badge tone="neutral">{p.progress}%</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
