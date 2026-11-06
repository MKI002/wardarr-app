// Discover: trending and popular titles from Seerr, search, and requests in
// standard quality or 4K. Titles already requested or in the library say so.
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../components/Dialog';
import { Poster } from '../components/Poster';
import {
  Badge,
  Button,
  Choice,
  Disclosure,
  EmptyState,
  Guardian,
  InlineError,
  Select,
  Skeleton,
  Tabs,
  spring,
} from '../components/ui';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import {
  AVAILABILITY_TONE,
  type Availability,
  type DiscoverDetails,
  type DiscoverItem,
  type DiscoverPage,
  type RequestOptions,
} from '../lib/media';
import { useSession } from '../lib/session';

type List = 'trending' | 'movies' | 'tv';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

function AvailabilityBadge({ status, is4k }: { status: Availability; is4k?: boolean }) {
  const { t } = useTranslation();
  if (status === 'unknown') return null;
  return (
    <Badge tone={AVAILABILITY_TONE[status]}>
      {t(`ui.discover.status.${status}`)}
      {is4k ? ' · 4K' : ''}
    </Badge>
  );
}

export function DiscoverPage() {
  const { t } = useTranslation();
  const search = useSearch({ from: '/discover' });
  const navigate = useNavigate({ from: '/discover' });
  const list: List = search.list ?? 'trending';
  const [query, setQuery] = useState(search.q ?? '');
  const q = useDebounced(query.trim(), 350);
  // The last chosen title stays mounted while the dialog closes, so it can
  // animate out; a new title remounts it with fresh choices.
  const [selected, setSelected] = useState<DiscoverItem | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if ((search.q ?? '') !== q)
      void navigate({ search: (s) => ({ ...s, q: q || undefined }), replace: true });
  }, [q, search.q, navigate]);

  const pages = useInfiniteQuery({
    queryKey: ['discover', q ? `search:${q}` : list],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api<DiscoverPage>(
        q
          ? `/api/discover/search?q=${encodeURIComponent(q)}&page=${pageParam}`
          : `/api/discover?list=${list}&page=${pageParam}`,
      ),
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
  });
  const items = useMemo(() => {
    const seen = new Set<string>();
    return (pages.data?.pages ?? [])
      .flatMap((p) => p.results)
      .filter((i) => {
        const key = `${i.mediaType}:${i.tmdbId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [pages.data]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('ui.discover.title')}</h1>
          <p className="text-sm text-muted">{t('ui.discover.intro')}</p>
        </div>
        <label className="relative w-full sm:w-80">
          <span className="sr-only">{t('ui.discover.search')}</span>
          <svg
            viewBox="0 0 24 24"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
          >
            <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4-4" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('ui.discover.searchPlaceholder')}
            className="min-h-10 w-full rounded-lg border border-border bg-surface pr-3 pl-9 text-sm outline-none placeholder:text-muted focus:border-accent"
          />
        </label>
      </div>

      {q ? (
        <p className="text-sm text-muted">{t('ui.discover.resultsFor', { query: q })}</p>
      ) : (
        <Tabs
          label={t('ui.discover.lists')}
          value={list}
          onChange={(v) =>
            void navigate({ search: (s) => ({ ...s, list: v === 'trending' ? undefined : v }) })
          }
          options={[
            ['trending', t('ui.discover.trending')],
            ['movies', t('ui.discover.movies')],
            ['tv', t('ui.discover.tv')],
          ]}
        />
      )}

      {pages.isError ? (
        <InlineError {...errorText(t, pages.error)} onRetry={() => void pages.refetch()} />
      ) : null}

      {pages.isPending ? (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 12 }, (_, i) => (
            <li key={i} className="flex flex-col gap-2">
              <Skeleton className="aspect-[2/3] rounded-xl" />
              <Skeleton className="h-4 w-3/4" />
            </li>
          ))}
        </ul>
      ) : items.length === 0 && !pages.isError ? (
        <EmptyState title={t('ui.discover.empty')} body={q ? t('ui.discover.emptySearch') : undefined} />
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {items.map((item, index) => (
            <motion.li
              key={`${item.mediaType}:${item.tmdbId}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring, delay: Math.min(index % 20, 12) * 0.015 }}
            >
              <button
                type="button"
                onClick={() => {
                  setSelected(item);
                  setDialogOpen(true);
                }}
                className="group flex w-full flex-col gap-2 rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <div className="relative transition-transform duration-200 group-hover:-translate-y-0.5 motion-reduce:transform-none">
                  <Poster path={item.posterPath} title={item.title} />
                  <div className="absolute top-2 left-2 flex flex-col items-start gap-1">
                    <AvailabilityBadge status={item.status} />
                    {item.status === 'unknown' ? <AvailabilityBadge status={item.status4k} is4k /> : null}
                  </div>
                </div>
                <div>
                  <p className="line-clamp-2 text-sm font-medium">{item.title}</p>
                  <p className="text-xs text-muted">
                    {[item.year, t(item.mediaType === 'movie' ? 'ui.discover.movie' : 'ui.discover.series')]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
              </button>
            </motion.li>
          ))}
        </ul>
      )}

      {pages.hasNextPage ? (
        <div className="flex justify-center">
          <Button busy={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>
            {t('ui.discover.more')}
          </Button>
        </div>
      ) : null}

      <RequestDialog
        key={selected ? `${selected.mediaType}:${selected.tmdbId}` : 'none'}
        item={selected}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  );
}

function RequestDialog({
  item,
  open,
  onClose,
}: {
  item: DiscoverItem | null;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { me } = useSession();
  const client = useQueryClient();
  const isAdmin = me.role === 'admin';
  const [quality, setQuality] = useState<'standard' | '4k'>('standard');
  const [serverId, setServerId] = useState<number | null>(null);
  const [profileId, setProfileId] = useState<number | null>(null);
  const [rootFolder, setRootFolder] = useState<string | null>(null);
  const [seasons, setSeasons] = useState<Set<number>>(new Set());
  const [done, setDone] = useState(false);

  const details = useQuery({
    queryKey: ['discover-details', item?.mediaType, item?.tmdbId],
    queryFn: () => api<DiscoverDetails>(`/api/discover/${item!.mediaType}/${item!.tmdbId}`),
    enabled: !!item,
  });
  const options = useQuery({
    queryKey: ['discover-options'],
    queryFn: () => api<RequestOptions>('/api/discover/options'),
    enabled: !!item,
    staleTime: 60_000,
  });

  const type = item?.mediaType === 'movie' ? 'radarr' : 'sonarr';
  const servers = (options.data?.servers ?? []).filter((s) => s.type === type);
  const has4k = servers.some((s) => s.is4k);
  const is4k = quality === '4k';
  const forQuality = servers.filter((s) => s.is4k === is4k);
  const server =
    forQuality.find((s) => s.id === serverId) ?? forQuality.find((s) => s.isDefault) ?? forQuality[0];
  const d = details.data;
  const statusFor = (s: { status: Availability; status4k: Availability }) => (is4k ? s.status4k : s.status);
  const openSeasons = (d?.seasons ?? []).filter((s) => statusFor(s) === 'unknown');
  const itemStatus = d ? statusFor(d) : item ? statusFor(item) : 'unknown';
  const blocked =
    item?.mediaType === 'movie'
      ? itemStatus !== 'unknown'
      : !!d && openSeasons.length === 0 && itemStatus !== 'unknown';

  const request = useMutation({
    mutationFn: () =>
      api('/api/requests', {
        method: 'POST',
        body: {
          mediaType: item!.mediaType,
          tmdbId: item!.tmdbId,
          ...(item!.mediaType === 'tv'
            ? {
                tvdbId: d?.tvdbId ?? undefined,
                seasons: seasons.size
                  ? [...seasons].sort((a, b) => a - b)
                  : openSeasons.map((s) => s.seasonNumber),
              }
            : {}),
          is4k,
          ...(server ? { serverId: server.id } : {}),
          ...(isAdmin && profileId !== null ? { profileId } : {}),
          ...(isAdmin && rootFolder ? { rootFolder } : {}),
        },
      }),
    onSuccess: () => {
      setDone(true);
      void client.invalidateQueries({ queryKey: ['discover'] });
      void client.invalidateQueries({ queryKey: ['discover-details'] });
      void client.invalidateQueries({ queryKey: ['requests'] });
    },
  });

  const title = item ? `${item.title}${item.year ? ` (${item.year})` : ''}` : '';
  return (
    <Dialog open={open && !!item} onOpenChange={(o) => (o ? null : onClose())} title={title} wide>
      {item ? (
        <AnimatePresence mode="wait" initial={false}>
          {done ? (
            <motion.div
              key="done"
              className="flex flex-col items-center gap-3 py-6 text-center"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={spring}
            >
              <Guardian size={64} />
              <p className="font-medium">{t('ui.discover.requested')}</p>
              <p className="max-w-sm text-sm text-muted">{t('ui.discover.requestedBody')}</p>
              <Button variant="primary" onClick={onClose}>
                {t('ui.common.done')}
              </Button>
            </motion.div>
          ) : (
            <motion.div key="form" className="flex flex-col gap-5 sm:flex-row" exit={{ opacity: 0 }}>
              <Poster
                path={item.posterPath}
                title={item.title}
                className="w-32 shrink-0 self-start sm:w-40"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-4">
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone="neutral">
                    {t(item.mediaType === 'movie' ? 'ui.discover.movie' : 'ui.discover.series')}
                  </Badge>
                  <AvailabilityBadge status={item.status} />
                  <AvailabilityBadge status={item.status4k} is4k />
                </div>
                {details.isPending ? (
                  <div className="flex flex-col gap-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-5/6" />
                    <Skeleton className="h-4 w-2/3" />
                  </div>
                ) : (
                  <p className="line-clamp-6 text-sm text-muted">{d?.overview || item.overview}</p>
                )}
                {details.isError ? <InlineError {...errorText(t, details.error)} /> : null}
                {options.isError ? <InlineError {...errorText(t, options.error)} /> : null}

                {options.data && !options.data.linked ? (
                  <InlineError message={t('ui.errors.notLinked')} next={t('ui.errors.notLinkedNext')} />
                ) : options.data && servers.length === 0 ? (
                  <InlineError message={t('ui.discover.noServer')} />
                ) : options.data ? (
                  <>
                    {has4k ? (
                      <Choice
                        label={t('ui.discover.quality')}
                        value={quality}
                        onChange={(v) => {
                          setQuality(v);
                          setServerId(null);
                          setProfileId(null);
                          setRootFolder(null);
                        }}
                        options={[
                          ['standard', t('ui.discover.standard')],
                          ['4k', t('ui.discover.uhd')],
                        ]}
                      />
                    ) : null}
                    {forQuality.length > 1 ? (
                      <Choice
                        label={t('ui.discover.server')}
                        value={String(server?.id ?? '')}
                        onChange={(v) => setServerId(Number(v))}
                        options={forQuality.map((s) => [String(s.id), s.name])}
                      />
                    ) : null}
                    {item.mediaType === 'tv' && d && openSeasons.length > 0 ? (
                      <fieldset className="flex flex-col gap-2">
                        <legend className="mb-2 text-sm font-medium">{t('ui.discover.seasons')}</legend>
                        <p className="text-xs text-muted">{t('ui.discover.seasonsHint')}</p>
                        <div className="flex flex-wrap gap-2">
                          {d.seasons.map((s) => {
                            const st = statusFor(s);
                            const free = st === 'unknown';
                            const checked = seasons.has(s.seasonNumber);
                            return (
                              <label
                                key={s.seasonNumber}
                                className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${free ? 'cursor-pointer focus-within:ring-2 focus-within:ring-accent' : 'opacity-60'} ${checked ? 'border-accent bg-surface-2' : 'border-border'}`}
                              >
                                <input
                                  type="checkbox"
                                  className="accent-[var(--color-accent)]"
                                  disabled={!free}
                                  checked={checked}
                                  onChange={() =>
                                    setSeasons((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(s.seasonNumber)) next.delete(s.seasonNumber);
                                      else next.add(s.seasonNumber);
                                      return next;
                                    })
                                  }
                                />
                                {t('ui.discover.season', { number: s.seasonNumber })}
                                {!free ? (
                                  <span className="text-xs text-muted">{t(`ui.discover.status.${st}`)}</span>
                                ) : null}
                              </label>
                            );
                          })}
                        </div>
                      </fieldset>
                    ) : null}
                    {isAdmin && server?.profiles ? (
                      <Disclosure title={t('ui.common.advanced')}>
                        <Select
                          label={t('ui.discover.profile')}
                          value={String(profileId ?? server.defaultProfileId ?? '')}
                          onChange={(v) => setProfileId(Number(v))}
                          options={server.profiles.map((p) => [String(p.id), p.name])}
                        />
                        <Select
                          label={t('ui.discover.rootFolder')}
                          value={rootFolder ?? server.defaultRootFolder ?? ''}
                          onChange={setRootFolder}
                          options={(server.rootFolders ?? []).map((f) => [f, f])}
                        />
                      </Disclosure>
                    ) : null}
                  </>
                ) : (
                  <Skeleton className="h-10 w-48" />
                )}

                {request.isError ? <InlineError {...errorText(t, request.error)} /> : null}
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {blocked ? (
                    <span className="text-sm text-muted">
                      {t(
                        itemStatus === 'available'
                          ? 'ui.discover.alreadyAvailable'
                          : 'ui.discover.alreadyRequested',
                      )}
                    </span>
                  ) : null}
                  <Button variant="ghost" onClick={onClose}>
                    {t('ui.common.cancel')}
                  </Button>
                  <Button
                    variant="primary"
                    busy={request.isPending}
                    disabled={
                      !options.data?.linked ||
                      servers.length === 0 ||
                      blocked ||
                      (item.mediaType === 'tv' && !d)
                    }
                    onClick={() => request.mutate()}
                  >
                    {is4k ? t('ui.discover.request4k') : t('ui.discover.request')}
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      ) : null}
    </Dialog>
  );
}
