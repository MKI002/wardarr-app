// Stack map: a picture of the whole stack, drawn from what the services
// report about each other. Click a node to drill in; the list view shows the
// same connections as text.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWidth } from '../components/charts';
import { PageHeader } from '../components/dash';
import { computeLayout, nodesPerRow } from '../components/map/layout';
import { NodeDetails } from '../components/map/NodeDetails';
import { StackMapCanvas, TONE_VAR, edgeText, nodeSubline } from '../components/map/StackMapCanvas';
import type { MapTone, StackMap } from '../components/map/types';
import { ServiceLogo } from '../components/ServiceLogo';
import { Button, Card, EmptyState, InlineError, Skeleton, Tabs } from '../components/ui';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { formatRelative } from '../lib/format';

/** Below this width the map runs top to bottom. */
const VERTICAL_BELOW = 680;
/** Nodes are laid out so they fit at this scale; waypoints may shrink it a little more. */
const MIN_SCALE = 0.85;
const FLOOR_SCALE = 0.7;
const MAX_SCALE = 1.15;

function Legend() {
  const { t } = useTranslation();
  const tones: MapTone[] = ['ok', 'warning', 'critical', 'off'];
  const line = (dash: string | undefined, label: string) => (
    <span className="inline-flex items-center gap-1.5">
      <svg width="26" height="8" aria-hidden>
        <path
          d="M2 4h22"
          stroke="var(--muted)"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeDasharray={dash}
        />
      </svg>
      {label}
    </span>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
      {tones.map((tone) => (
        <span key={tone} className="inline-flex items-center gap-1.5">
          <svg width="12" height="12" aria-hidden>
            <circle
              cx="6"
              cy="6"
              r="4.5"
              fill="none"
              stroke={TONE_VAR[tone]}
              strokeWidth="2"
              strokeDasharray={tone === 'off' ? '2 2' : undefined}
            />
          </svg>
          {t(`ui.map.status.${tone}`)}
        </span>
      ))}
      {line(undefined, t('ui.map.legend.reported'))}
      {line('1 5', t('ui.map.legend.inferred'))}
      {line('5 5', t('ui.map.legend.off'))}
      <span className="inline-flex items-center gap-1.5">
        <svg width="26" height="8" aria-hidden>
          <path d="M2 4h22" stroke="var(--accent)" strokeWidth="1.75" strokeLinecap="round" />
          <circle cx="13" cy="4" r="2.6" fill="var(--accent)" />
        </svg>
        {t('ui.map.legend.active')}
      </span>
    </div>
  );
}

function ConnectionList({ map, onSelect }: { map: StackMap; onSelect: (id: string) => void }) {
  const { t } = useTranslation();
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  const name = (id: string) => byId.get(id)?.name || t('ui.map.storage.name');
  const linked = new Set(map.edges.flatMap((e) => [e.from, e.to]));
  const alone = map.nodes.filter((n) => !linked.has(n.id));
  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{t('ui.map.listCaption')}</caption>
        <thead className="text-xs text-muted">
          <tr className="border-b border-border">
            <th scope="col" className="px-4 py-2.5 font-medium">
              {t('ui.map.list.from')}
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              {t('ui.map.list.to')}
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              {t('ui.map.list.what')}
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              {t('ui.map.list.status')}
            </th>
          </tr>
        </thead>
        <tbody>
          {map.edges.map((e) => (
            <tr key={e.id} className="border-b border-border last:border-0">
              {[e.from, e.to].map((id) => (
                <td key={id} className="px-4 py-2.5">
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 font-medium hover:text-accent"
                    onClick={() => onSelect(id)}
                  >
                    {byId.get(id)?.adapter ? (
                      <ServiceLogo adapter={byId.get(id)!.adapter!} name={name(id)} size={18} />
                    ) : null}
                    {name(id)}
                  </button>
                </td>
              ))}
              <td className="px-4 py-2.5 text-muted">{edgeText(t, e)}</td>
              <td className="px-4 py-2.5">{t(`ui.map.status.${e.status}`)}</td>
            </tr>
          ))}
          {alone.map((n) => (
            <tr key={n.id} className="border-b border-border last:border-0">
              <td className="px-4 py-2.5 font-medium">{n.name}</td>
              <td className="px-4 py-2.5 text-muted">–</td>
              <td className="px-4 py-2.5 text-muted">{nodeSubline(t, n) || t('ui.map.noLinks')}</td>
              <td className="px-4 py-2.5">{t(`ui.map.status.${n.status}`)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export function StackMapPage() {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['topology'],
    queryFn: () => api<StackMap>('/api/topology'),
    refetchInterval: 60_000,
  });
  const reload = useMutation({
    mutationFn: () => api<StackMap>('/api/topology?refresh=1'),
    onSuccess: (fresh) => client.setQueryData(['topology'], fresh),
  });
  const [view, setView] = useState<'map' | 'list'>('map');
  const [selected, setSelected] = useState<string | null>(null);
  const [ref, width] = useWidth<HTMLDivElement>();
  const map = query.data;
  const orientation = width && width < VERTICAL_BELOW ? 'vertical' : 'horizontal';
  const layout = useMemo(
    () =>
      map
        ? computeLayout(
            map.nodes,
            map.edges,
            orientation,
            orientation === 'vertical' ? nodesPerRow(width, MIN_SCALE) : Infinity,
          )
        : null,
    [map, orientation, width],
  );
  const scale =
    layout && width
      ? Math.max(
          orientation === 'vertical' ? FLOOR_SCALE : MIN_SCALE,
          Math.min(MAX_SCALE, width / layout.width),
        )
      : 1;
  const node = selected ? map?.nodes.find((n) => n.id === selected) : undefined;
  const unread = (map?.unread ?? []).map((id) => map?.nodes.find((n) => n.id === id)?.name).filter(Boolean);
  const select = (id: string) => setSelected((cur) => (cur === id ? null : id));

  return (
    <div className="flex flex-col gap-5" onKeyDown={(e) => e.key === 'Escape' && setSelected(null)}>
      <PageHeader
        eyebrow={
          map && map.nodes.length
            ? `${t('ui.map.eyebrowServices', { count: map.nodes.filter((n) => n.type === 'instance').length })} · ${t('ui.map.eyebrowLinks', { count: map.edges.filter((e) => !e.redundant).length })}`
            : undefined
        }
        title={t('ui.map.title')}
        intro={t('ui.map.intro')}
        actions={
          <>
            {map?.readAt ? (
              <span className="text-xs text-muted">
                {t('ui.map.readAt', { when: formatRelative(map.readAt, i18n.language) })}
              </span>
            ) : null}
            <Button busy={reload.isPending} onClick={() => reload.mutate()}>
              {t('ui.map.reload')}
            </Button>
          </>
        }
      />

      {query.isError ? (
        <InlineError {...errorText(t, query.error)} onRetry={() => void query.refetch()} />
      ) : null}

      <Tabs
        value={view}
        onChange={setView}
        label={t('ui.map.views')}
        options={[
          ['map', t('ui.map.viewMap')],
          ['list', t('ui.map.viewList')],
        ]}
      />

      {unread.length ? (
        <p className="rounded-lg bg-warning-bg px-3 py-2 text-sm text-warning" role="status">
          {t('ui.map.unread', { list: unread.join(', ') })}
        </p>
      ) : null}

      <div className={`grid gap-5 ${node ? 'lg:grid-cols-[minmax(0,1fr)_320px]' : ''}`}>
        <div ref={ref} className="min-w-0">
          {!map ? (
            query.isPending ? (
              <Skeleton className="h-80" />
            ) : null
          ) : map.nodes.length === 0 ? (
            <Card>
              <EmptyState
                title={t('ui.map.empty')}
                body={t('ui.map.emptyBody')}
                action={
                  <Link to="/settings" search={{ section: 'instances' }}>
                    <Button variant="primary">{t('ui.map.addService')}</Button>
                  </Link>
                }
              />
            </Card>
          ) : view === 'list' ? (
            <ConnectionList map={map} onSelect={setSelected} />
          ) : (
            <div className="flex flex-col gap-3">
              <Card className="map-surface overflow-x-auto p-0">
                <div
                  className="mx-auto py-2"
                  style={{ width: layout ? layout.width * scale : undefined }}
                  aria-busy={reload.isPending}
                >
                  {layout && width ? (
                    <StackMapCanvas layout={layout} scale={scale} selected={selected} onSelect={select} />
                  ) : null}
                </div>
              </Card>
              <Legend />
              {map.nodes.length === 1 ? <p className="text-sm text-muted">{t('ui.map.lonely')}</p> : null}
            </div>
          )}
        </div>
        {node && map ? (
          <div className="lg:sticky lg:top-20 lg:self-start">
            <NodeDetails map={map} node={node} onSelect={setSelected} onClose={() => setSelected(null)} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
