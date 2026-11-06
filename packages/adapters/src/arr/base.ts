// Shared implementation for *arr apps (Sonarr, Radarr, Lidarr, Readarr,
// Whisparr). They share the same API shape with different paths and names.
import {
  AdapterError,
  type AdapterContext,
  type AdapterInstance,
  type MediaKind,
  type QueueItem,
  type QueueItemState,
  type SettingsSection,
  type Signal,
} from '@wardarr/core';
import { arrLevel, jsonOf, toEntries } from '../shared/http.js';

export interface ArrFlavor {
  /** API prefix, for example `/api/v3`. */
  apiBase: string;
  /** Query flag that includes queue entries without a library match. */
  includeUnknownParam: string;
  /** Field of a queue record that links to the library entry. */
  mediaIdField: string;
  mediaKind: MediaKind;
}

interface StatusResource {
  version?: string;
  appName?: string;
  instanceName?: string;
}

interface HealthResource {
  source?: string;
  type?: string;
  message?: string;
  wikiUrl?: string;
}

export interface ArrQueueRecord {
  id: number;
  title?: string;
  status?: string;
  trackedDownloadStatus?: string;
  trackedDownloadState?: string;
  statusMessages?: Array<{ title?: string; messages?: string[] }>;
  errorMessage?: string;
  downloadId?: string;
  protocol?: string;
  downloadClient?: string;
  size?: number;
  sizeleft?: number;
  added?: string;
  estimatedCompletionTime?: string;
  [key: string]: unknown;
}

interface Paged<T> {
  page: number;
  pageSize: number;
  totalRecords: number;
  records: T[];
}

const PAGE_SIZE = 250;
const MAX_PAGES = 40;

export function queueState(r: ArrQueueRecord): QueueItemState {
  const tracked = (r.trackedDownloadState ?? '').toLowerCase();
  const status = (r.status ?? '').toLowerCase();
  if (tracked === 'failed' || tracked === 'failedpending' || status === 'failed') return 'failed';
  if (tracked === 'importblocked') return 'importBlocked';
  if (tracked === 'importpending' || tracked === 'importing') return 'importPending';
  if (status === 'paused') return 'paused';
  if (status === 'queued' || status === 'delay') return 'queued';
  if (status === 'completed') return 'completed';
  if (status === 'downloading')
    return (r.trackedDownloadStatus ?? '').toLowerCase() === 'warning' ? 'warning' : 'downloading';
  if (status === 'warning' || (r.trackedDownloadStatus ?? '').toLowerCase() === 'warning') return 'warning';
  return 'unknown';
}

export function normalizeQueueRecord(r: ArrQueueRecord, flavor: ArrFlavor): QueueItem {
  const mediaId = typeof r[flavor.mediaIdField] === 'number' ? (r[flavor.mediaIdField] as number) : undefined;
  const protocol = r.protocol === 'usenet' || r.protocol === 'torrent' ? r.protocol : 'unknown';
  return {
    id: r.id,
    downloadId: r.downloadId ?? null,
    title: r.title ?? `#${r.id}`,
    mediaKind: flavor.mediaKind,
    matched: mediaId !== undefined && mediaId > 0,
    mediaId,
    state: queueState(r),
    trackedState: r.trackedDownloadState,
    trackedStatus: r.trackedDownloadStatus,
    statusMessages: (r.statusMessages ?? []).flatMap((m) =>
      [m.title, ...(m.messages ?? [])].filter((x): x is string => !!x),
    ),
    errorMessage: r.errorMessage || undefined,
    sizeBytes: r.size,
    sizeLeftBytes: r.sizeleft,
    downloadClient: r.downloadClient,
    protocol,
    added: r.added,
    estimatedCompletion: r.estimatedCompletionTime,
  };
}

export function createArrInstance(
  ctx: AdapterContext<{ apiKey: string }>,
  adapterId: string,
  resolveFlavor: () => Promise<ArrFlavor> | ArrFlavor,
  extra: { webPaths?: Partial<Record<'indexer' | 'queue' | 'settings' | 'system', string>> } = {},
): AdapterInstance & { flavor(): Promise<ArrFlavor> } {
  const headers = { 'X-Api-Key': ctx.credentials.apiKey };
  let flavorCache: ArrFlavor | null = null;
  const flavor = async () => (flavorCache ??= await resolveFlavor());

  const get = async <T>(path: string, query?: Record<string, string | number | boolean>) => {
    const f = await flavor();
    return jsonOf<T>(await ctx.http.request({ path: `${f.apiBase}${path}`, query, headers }));
  };

  const webPaths = {
    indexer: '/settings/indexers',
    queue: '/activity/queue',
    settings: '/settings',
    system: '/system/status',
    ...extra.webPaths,
  };

  return {
    flavor,
    async testConnection() {
      const status = await get<StatusResource>('/system/status');
      if (!status || typeof status.version !== 'string')
        throw new AdapterError('badResponse', 'not an *arr API');
      return { version: status.version, product: status.appName };
    },

    async health() {
      const items = await get<HealthResource[]>('/health');
      return items.map((h): Signal => ({
        origin: 'service',
        instance: { id: ctx.instanceId, name: ctx.instanceName, adapter: adapterId },
        kind: 'health',
        source: h.source,
        level: arrLevel(h.type),
        message: h.message ?? '',
        wikiUrl: h.wikiUrl,
      }));
    },

    async queue() {
      const f = await flavor();
      const records: ArrQueueRecord[] = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        const res = await get<Paged<ArrQueueRecord>>('/queue', {
          page,
          pageSize: PAGE_SIZE,
          [f.includeUnknownParam]: true,
        });
        records.push(...res.records);
        if (records.length >= res.totalRecords || res.records.length === 0) break;
      }
      return records.map((r) => normalizeQueueRecord(r, f));
    },

    async settings(): Promise<SettingsSection[]> {
      const host = await get<Record<string, unknown>>('/config/host');
      return [{ id: 'host', entries: toEntries(host) }];
    },

    webUrl(target) {
      const path = target ? webPaths[target.kind] : '';
      return `${ctx.baseUrl}${path}`;
    },
  };
}
