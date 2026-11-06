// Requests: everyone sees their own; admins see all of them, approve,
// decline, edit and retry, and decide which Seerr user each person requests as.
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../components/Dialog';
import { Poster } from '../components/Poster';
import {
  Badge,
  Button,
  Card,
  Choice,
  EmptyState,
  InlineError,
  Select,
  Skeleton,
  Tabs,
  Toggle,
  spring,
} from '../components/ui';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { formatRelative } from '../lib/format';
import { REQUEST_TONE, type MediaRequest, type RequestOptions } from '../lib/media';
import { useSession } from '../lib/session';

const FILTERS = ['all', 'pending', 'approved', 'processing', 'available', 'failed', 'declined'] as const;
type Filter = (typeof FILTERS)[number];
type View = 'all' | 'mine' | 'links';
const PAGE = 20;

interface RequestPage {
  instanceId: string;
  linked?: boolean;
  total: number;
  results: MediaRequest[];
}

export function RequestsPage() {
  const { t } = useTranslation();
  const { me } = useSession();
  const isAdmin = me.role === 'admin';
  const search = useSearch({ from: '/requests' });
  const navigate = useNavigate({ from: '/requests' });
  const view: View = isAdmin ? (search.view ?? 'all') : 'mine';
  const filter: Filter = search.status ?? (isAdmin && view === 'all' ? 'pending' : 'all');

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('ui.requests.title')}</h1>
        <p className="text-sm text-muted">{t(isAdmin ? 'ui.requests.introAdmin' : 'ui.requests.intro')}</p>
      </div>
      {isAdmin ? (
        <Tabs
          label={t('ui.requests.views')}
          value={view}
          onChange={(v) => void navigate({ search: { view: v === 'all' ? undefined : v } })}
          options={[
            ['all', t('ui.requests.all')],
            ['mine', t('ui.requests.mine')],
            ['links', t('ui.requests.links')],
          ]}
        />
      ) : null}
      {view === 'links' ? (
        <LinksView />
      ) : (
        <>
          <Choice
            label={t('ui.requests.filter')}
            hideLabel
            value={filter}
            onChange={(v) => void navigate({ search: (s) => ({ ...s, status: v }) })}
            options={FILTERS.map((f) => [f, t(`ui.requests.filters.${f}`)])}
          />
          <RequestList mine={view === 'mine'} filter={filter} />
        </>
      )}
    </div>
  );
}

function RequestList({ mine, filter }: { mine: boolean; filter: Filter }) {
  const { t } = useTranslation();
  const pages = useInfiniteQuery({
    queryKey: ['requests', mine ? 'mine' : 'all', filter],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api<RequestPage>(`/api/requests${mine ? '/mine' : ''}?status=${filter}&take=${PAGE}&skip=${pageParam}`),
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((n, p) => n + p.results.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
  });
  const items = (pages.data?.pages ?? []).flatMap((p) => p.results);
  const first = pages.data?.pages[0];

  if (pages.isPending) {
    return (
      <ul className="flex flex-col gap-3">
        {Array.from({ length: 4 }, (_, i) => (
          <li key={i}>
            <Skeleton className="h-24 rounded-[var(--radius-card)]" />
          </li>
        ))}
      </ul>
    );
  }
  if (pages.isError)
    return <InlineError {...errorText(t, pages.error)} onRetry={() => void pages.refetch()} />;
  if (mine && first?.linked === false) {
    return <EmptyState title={t('ui.errors.notLinked')} body={t('ui.errors.notLinkedNext')} />;
  }
  if (items.length === 0) {
    return (
      <EmptyState
        title={t(filter === 'pending' ? 'ui.requests.emptyPending' : 'ui.requests.empty')}
        body={mine ? t('ui.requests.emptyMineBody') : undefined}
      />
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <motion.ul layout className="flex flex-col gap-3">
        <AnimatePresence initial={false}>
          {items.map((r) => (
            <RequestRow key={r.id} request={r} instanceId={first!.instanceId} admin={!mine} />
          ))}
        </AnimatePresence>
      </motion.ul>
      {pages.hasNextPage ? (
        <div className="flex justify-center">
          <Button busy={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>
            {t('ui.discover.more')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function RequestRow({
  request: r,
  instanceId,
  admin,
}: {
  request: MediaRequest;
  instanceId: string;
  admin: boolean;
}) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const act = useMutation({
    mutationFn: (action: 'approve' | 'decline' | 'retry') =>
      api(`/api/requests/${encodeURIComponent(instanceId)}/${r.id}/${action}`, { method: 'POST' }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['requests'] }),
  });
  const title = r.title ?? t('ui.requests.unknownTitle', { id: r.tmdbId });
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={spring}
    >
      <Card className="flex gap-4 !p-3 sm:!p-4">
        <Poster path={r.posterPath} title={title} size="w185" className="w-14 shrink-0 sm:w-16" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-medium">{title}</p>
              <p className="text-xs text-muted">
                {[
                  t(r.mediaType === 'movie' ? 'ui.discover.movie' : 'ui.discover.series'),
                  r.mediaType === 'tv' && r.seasons.length
                    ? t('ui.requests.seasons', { list: r.seasons.join(', ') })
                    : null,
                  admin ? t('ui.requests.by', { name: r.requestedBy.name }) : null,
                  formatRelative(r.createdAt, i18n.language),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {r.is4k ? <Badge tone="neutral">4K</Badge> : null}
              <Badge tone={REQUEST_TONE[r.status]}>{t(`ui.requests.status.${r.status}`)}</Badge>
              {r.status === 'approved' && r.mediaStatus !== 'unknown' ? (
                <Badge tone="info">{t(`ui.discover.status.${r.mediaStatus}`)}</Badge>
              ) : null}
            </div>
          </div>
          {act.isError ? <InlineError {...errorText(t, act.error)} /> : null}
          {admin ? (
            <div className="flex flex-wrap gap-2">
              {r.status === 'pending' ? (
                <>
                  <Button
                    variant="primary"
                    busy={act.isPending && act.variables === 'approve'}
                    onClick={() => act.mutate('approve')}
                  >
                    {t('ui.requests.approve')}
                  </Button>
                  <Button
                    variant="ghost"
                    busy={act.isPending && act.variables === 'decline'}
                    onClick={() => act.mutate('decline')}
                  >
                    {t('ui.requests.decline')}
                  </Button>
                </>
              ) : null}
              {r.status === 'failed' ? (
                <Button
                  variant="primary"
                  busy={act.isPending && act.variables === 'retry'}
                  onClick={() => act.mutate('retry')}
                >
                  {t('ui.requests.retry')}
                </Button>
              ) : null}
              {r.status === 'pending' || r.status === 'approved' || r.status === 'failed' ? (
                <Button variant="ghost" onClick={() => setEditing(true)}>
                  {t('ui.common.edit')}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </Card>
      {admin ? (
        <EditDialog request={r} instanceId={instanceId} open={editing} onOpenChange={setEditing} />
      ) : null}
    </motion.li>
  );
}

function EditDialog({
  request: r,
  instanceId,
  open,
  onOpenChange,
}: {
  request: MediaRequest;
  instanceId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [is4k, setIs4k] = useState(r.is4k);
  const [serverId, setServerId] = useState<number | null>(r.serverId);
  const [profileId, setProfileId] = useState<number | null>(r.profileId);
  const [rootFolder, setRootFolder] = useState<string | null>(r.rootFolder);
  const options = useQuery({
    queryKey: ['discover-options'],
    queryFn: () => api<RequestOptions>('/api/discover/options'),
    enabled: open,
    staleTime: 60_000,
  });
  const type = r.mediaType === 'movie' ? 'radarr' : 'sonarr';
  const servers = (options.data?.servers ?? []).filter((s) => s.type === type && s.is4k === is4k);
  const server = servers.find((s) => s.id === serverId) ?? servers.find((s) => s.isDefault) ?? servers[0];
  const save = useMutation({
    mutationFn: () =>
      api(`/api/requests/${encodeURIComponent(instanceId)}/${r.id}`, {
        method: 'PUT',
        body: {
          is4k,
          ...(server ? { serverId: server.id } : {}),
          ...(profileId !== null ? { profileId } : {}),
          ...(rootFolder ? { rootFolder } : {}),
          ...(r.mediaType === 'tv' ? { seasons: r.seasons } : {}),
        },
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['requests'] });
      onOpenChange(false);
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('ui.requests.editTitle', { title: r.title ?? '' })}
    >
      <div className="flex flex-col gap-4">
        {options.isError ? <InlineError {...errorText(t, options.error)} /> : null}
        <Toggle
          label={t('ui.discover.uhd')}
          checked={is4k}
          onChange={(v) => {
            setIs4k(v);
            setServerId(null);
            setProfileId(null);
            setRootFolder(null);
          }}
        />
        {options.isPending ? <Skeleton className="h-10 w-full" /> : null}
        {servers.length > 0 ? (
          <Select
            label={t('ui.discover.server')}
            value={String(server?.id ?? '')}
            onChange={(v) => {
              setServerId(Number(v));
              setProfileId(null);
              setRootFolder(null);
            }}
            options={servers.map((s) => [String(s.id), s.name])}
          />
        ) : options.data ? (
          <InlineError message={t('ui.discover.noServer')} />
        ) : null}
        {server?.profiles ? (
          <Select
            label={t('ui.discover.profile')}
            value={String(profileId ?? server.defaultProfileId ?? '')}
            onChange={(v) => setProfileId(Number(v))}
            options={server.profiles.map((p) => [String(p.id), p.name])}
          />
        ) : null}
        {server?.rootFolders ? (
          <Select
            label={t('ui.discover.rootFolder')}
            value={rootFolder ?? server.defaultRootFolder ?? ''}
            onChange={setRootFolder}
            options={server.rootFolders.map((f) => [f, f])}
          />
        ) : null}
        {save.isError ? <InlineError {...errorText(t, save.error)} /> : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('ui.common.cancel')}
          </Button>
          <Button variant="primary" busy={save.isPending} disabled={!server} onClick={() => save.mutate()}>
            {t('ui.common.save')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

interface Links {
  instanceId: string;
  error: string | null;
  users: Array<{
    userId: string;
    username: string;
    displayName: string | null;
    role: 'admin' | 'user';
    link: RequestOptions['link'];
  }>;
  external: Array<{ id: number; name: string }>;
}

function LinksView() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const links = useQuery({ queryKey: ['request-links'], queryFn: () => api<Links>('/api/requests/links') });
  const save = useMutation({
    mutationFn: (v: { userId: string; externalId: number | null }) =>
      api(`/api/requests/links/${encodeURIComponent(v.userId)}`, {
        method: 'PUT',
        body: { instance: links.data!.instanceId, externalId: v.externalId },
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['request-links'] }),
  });
  if (links.isPending) return <Skeleton className="h-40 rounded-[var(--radius-card)]" />;
  if (links.isError)
    return <InlineError {...errorText(t, links.error)} onRetry={() => void links.refetch()} />;
  const data = links.data;
  return (
    <Card>
      <p className="mb-4 text-sm text-muted">{t('ui.requests.linksIntro')}</p>
      {data.error ? (
        <div className="mb-4">
          <InlineError
            message={t('ui.errors.serviceError', { reason: t(`ui.instance.testFailed.${data.error}`) })}
            onRetry={() => void links.refetch()}
          />
        </div>
      ) : null}
      {save.isError ? (
        <div className="mb-4">
          <InlineError {...errorText(t, save.error)} />
        </div>
      ) : null}
      <ul className="divide-y divide-border">
        {data.users.map((u) => (
          <li key={u.userId} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="font-medium">{u.displayName ?? u.username}</p>
              <p className="text-xs text-muted">
                {u.link.externalId === null
                  ? t(u.role === 'admin' ? 'ui.requests.linkNoneAdmin' : 'ui.requests.linkNone')
                  : t(`ui.requests.linkSource.${u.link.source}`, { name: u.link.externalName })}
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <span className="sr-only">
                {t('ui.requests.linkFor', { name: u.displayName ?? u.username })}
              </span>
              <select
                value={u.link.source === 'manual' ? String(u.link.externalId) : ''}
                disabled={save.isPending}
                onChange={(e) =>
                  save.mutate({
                    userId: u.userId,
                    externalId: e.target.value === '' ? null : Number(e.target.value),
                  })
                }
                className="min-h-10 rounded-lg border border-border bg-bg px-3 text-sm outline-none focus:border-accent"
              >
                <option value="">{t('ui.requests.linkAuto')}</option>
                {data.external.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
          </li>
        ))}
      </ul>
    </Card>
  );
}
