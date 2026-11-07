// Drill-in for one node of the stack map: status, live figures, every
// connection with how Wardarr found it, and links to the matching tabs.
import { Link } from '@tanstack/react-router';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { formatBytes, formatRelative, formatSpeed } from '../../lib/format';
import { ServiceLogo } from '../ServiceLogo';
import { Badge, Card, ProgressBar, spring, type Tone } from '../ui';
import { edgeText } from './StackMapCanvas';
import type { MapEdge, MapNode, MapTone, StackMap, StorageMember } from './types';

const BADGE: Record<MapTone, Tone> = {
  ok: 'ok',
  warning: 'warning',
  critical: 'critical',
  unknown: 'neutral',
  off: 'neutral',
};

/** Tabs that show more about a product. */
const TAB_FOR: Record<
  string,
  Array<'cleaner' | 'hunting' | 'indexers' | 'library' | 'requests' | 'tdarr'>
> = {
  sonarr: ['cleaner', 'hunting'],
  radarr: ['cleaner', 'hunting'],
  lidarr: ['cleaner', 'hunting'],
  readarr: ['cleaner', 'hunting'],
  whisparr: ['cleaner', 'hunting'],
  prowlarr: ['indexers'],
  plex: ['library'],
  jellyfin: ['library'],
  emby: ['library'],
  seerr: ['requests'],
  tdarr: ['tdarr'],
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-base font-semibold">{value}</p>
    </div>
  );
}

function DiskIcon({ size }: { size: number }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className="inline-flex shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted"
    >
      <svg
        viewBox="0 0 24 24"
        width={size * 0.62}
        height={size * 0.62}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      >
        <ellipse cx="12" cy="6" rx="7" ry="2.6" />
        <path d="M5 6v12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6M5 12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6" />
      </svg>
    </span>
  );
}

function Peer({ node, onSelect }: { node: MapNode | undefined; onSelect: (id: string) => void }) {
  if (!node) return null;
  return (
    <button
      type="button"
      onClick={() => onSelect(node.id)}
      className="inline-flex min-w-0 items-center gap-2 rounded-md font-medium hover:text-accent"
    >
      {node.type === 'storage' ? (
        <DiskIcon size={20} />
      ) : (
        <ServiceLogo adapter={node.adapter ?? ''} name={node.name} size={20} />
      )}
      <span className="truncate">{node.name || node.adapterName}</span>
    </button>
  );
}

/** Folders of one service on a storage node, with the least certain match. */
function groupMembers(members: StorageMember[]) {
  const order: StorageMember['match'][] = ['self', 'space', 'path', 'kind'];
  const groups = new Map<
    string,
    { instanceId: string; use: StorageMember['use']; match: StorageMember['match']; members: StorageMember[] }
  >();
  for (const m of members) {
    const g = groups.get(m.instanceId);
    if (!g) groups.set(m.instanceId, { instanceId: m.instanceId, use: m.use, match: m.match, members: [m] });
    else {
      g.members.push(m);
      if (order.indexOf(m.match) > order.indexOf(g.match)) g.match = m.match;
    }
  }
  return [...groups.values()];
}

export function NodeDetails({
  map,
  node,
  onSelect,
  onClose,
}: {
  map: StackMap;
  node: MapNode;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  const links = map.edges.filter((e) => e.from === node.id || e.to === node.id);
  const status = t(`ui.map.status.${node.status}`);
  const l = node.live;
  const stats: Array<[string, string]> = [];
  if (l.queue !== undefined) stats.push([t('ui.map.stat.queue'), String(l.queue)]);
  if (l.downloading !== undefined) stats.push([t('ui.map.stat.downloading'), String(l.downloading)]);
  if (l.speed) stats.push([t('ui.map.stat.speed'), formatSpeed(l.speed)]);
  if (l.streams !== undefined) stats.push([t('ui.map.stat.streams'), String(l.streams)]);
  if (l.transcodes) stats.push([t('ui.map.stat.transcodes'), String(l.transcodes)]);
  if (l.nodes !== undefined) stats.push([t('ui.map.stat.nodes'), String(l.nodes)]);
  if (l.workers !== undefined) stats.push([t('ui.map.stat.workers'), String(l.workers)]);
  if (l.indexers !== undefined && node.adapter === 'prowlarr') {
    stats.push([t('ui.map.stat.indexers'), String(l.indexers)]);
    stats.push([t('ui.map.stat.failing'), String(l.failingIndexers ?? 0)]);
  }
  if (l.issues) stats.push([t('ui.map.stat.issues'), String(l.issues)]);

  const s = node.storage;
  const used = s?.totalBytes && s.freeBytes !== null ? 1 - s.freeBytes / s.totalBytes : null;

  return (
    <motion.div
      initial={{ opacity: 0, x: 16, scale: 0.98 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      transition={spring}
      key={node.id}
    >
      <Card className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          {node.type === 'storage' ? (
            <DiskIcon size={40} />
          ) : (
            <ServiceLogo adapter={node.adapter ?? ''} name={node.name} size={40} />
          )}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold">{node.name || t('ui.map.storage.name')}</h2>
            <p className="text-sm text-muted">
              {node.type === 'storage'
                ? t('ui.map.storage.title')
                : [node.adapterName, node.version ? `v${node.version.replace(/^v/i, '')}` : null]
                    .filter(Boolean)
                    .join(' · ')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('ui.common.close')}
            className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-text"
          >
            <svg
              viewBox="0 0 24 24"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden
            >
              <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={BADGE[node.status]}>{status}</Badge>
          {node.checkedAt ? (
            <span className="text-xs text-muted">
              {t('ui.map.checked', { when: formatRelative(node.checkedAt, i18n.language) })}
            </span>
          ) : null}
        </div>

        {stats.length ? (
          <div className="grid grid-cols-2 gap-2">
            {stats.map(([label, value]) => (
              <Stat key={label} label={label} value={value} />
            ))}
          </div>
        ) : null}

        {s ? (
          <div className="flex flex-col gap-2">
            {s.freeBytes !== null ? (
              <p className="text-sm">
                {s.totalBytes
                  ? t('ui.map.storage.freeOf', {
                      free: formatBytes(s.freeBytes),
                      total: formatBytes(s.totalBytes),
                    })
                  : t('ui.map.storage.free', { free: formatBytes(s.freeBytes) })}
              </p>
            ) : (
              <p className="text-sm text-muted">{t('ui.map.storage.noSpaceBody')}</p>
            )}
            {used !== null ? (
              <ProgressBar
                value={used}
                tone={node.status === 'ok' ? 'accent' : 'warning'}
                label={t('ui.map.storage.used')}
              />
            ) : null}
            <ul className="mt-1 flex flex-col gap-3 text-sm">
              {groupMembers(s.members).map((g) => (
                <li key={g.instanceId} className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-2">
                    <Peer node={byId.get(g.instanceId)} onSelect={onSelect} />
                    <span className="text-xs text-muted">{t(`ui.map.storage.use.${g.use}`)}</span>
                  </span>
                  {g.members.map((m) => (
                    <code key={m.path} className="truncate pl-7 text-xs text-muted" title={m.path}>
                      {m.path}
                      {m.name ? ` (${m.name})` : ''}
                      {m.accessible === false ? (
                        <span className="ml-1 font-sans text-critical">
                          {t('ui.map.storage.inaccessible')}
                        </span>
                      ) : null}
                    </code>
                  ))}
                  {g.match !== 'self' ? (
                    <span className="pl-7 text-xs text-muted">{t(`ui.map.match.${g.match}`)}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {links.length && node.type !== 'storage' ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">
              {t('ui.map.connections')}
            </h3>
            <ul className="flex flex-col gap-2.5 text-sm">
              {links.map((e: MapEdge) => {
                const peer = byId.get(e.from === node.id ? e.to : e.from);
                return (
                  <li key={e.id} className="flex flex-col gap-0.5">
                    <span className="flex items-center gap-2">
                      <span aria-hidden className="text-muted">
                        {e.from === node.id ? '→' : '←'}
                      </span>
                      <Peer node={peer} onSelect={onSelect} />
                    </span>
                    <span className="pl-5 text-xs text-muted">
                      {edgeText(t, e)}
                      {e.labels.length && e.labels.some((x) => x !== peer?.name)
                        ? ` · ${t('ui.map.edge.as', { name: e.labels.join(', ') })}`
                        : ''}
                    </span>
                    {e.kind !== 'storage' && e.match !== 'self' ? (
                      <span className="pl-5 text-xs text-muted">{t(`ui.map.match.${e.match}`)}</span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : node.type === 'instance' ? (
          <p className="text-sm text-muted">{t('ui.map.noLinks')}</p>
        ) : null}

        {node.type === 'instance' ? (
          <div className="flex flex-wrap gap-2">
            {(TAB_FOR[node.adapter ?? ''] ?? []).map((tab) => (
              <Link
                key={tab}
                to={`/${tab}`}
                search={
                  tab === 'cleaner' || tab === 'hunting' || tab === 'tdarr'
                    ? { instance: node.instanceId }
                    : {}
                }
                className="rounded-lg bg-surface-2 px-3 py-1.5 text-sm font-medium hover:bg-border"
              >
                {t(`ui.tabs.${tab}`)}
              </Link>
            ))}
            {node.webUrl ? (
              <a
                href={node.webUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="rounded-lg bg-surface-2 px-3 py-1.5 text-sm font-medium hover:bg-border"
              >
                {t('ui.map.open', { name: node.adapterName ?? node.name })} ↗
              </a>
            ) : null}
          </div>
        ) : null}
      </Card>
    </motion.div>
  );
}
