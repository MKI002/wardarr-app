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
  type TagInfo,
} from '@wardarr/core';
import {
  compatSignal,
  detectApi,
  detectionCache,
  type ApiDetection,
  type VersionProfile,
} from '../shared/apiVersion.js';
import { arrLevel, ensureOk, jsonOf, toEntries } from '../shared/http.js';
import { FAMILIES, type ArrFamily } from './families.js';

/**
 * How Wardarr talks to one *arr product. The flavor is chosen per detected
 * API and product version, so a product update switches it automatically.
 */
export interface ArrProfile extends VersionProfile {
  product: string;
  flavor(d: ApiDetection): Omit<ArrFlavor, 'apiBase'>;
}

export interface ArrFlavor {
  /** API prefix, for example `/api/v3`. */
  apiBase: string;
  /** Query flag that includes queue entries without a library match. */
  includeUnknownParam: string;
  /** Field of a queue record that links to the library entry. */
  mediaIdField: string;
  mediaKind: MediaKind;
  /** API shape of the library: series (Sonarr), movie (Radarr), music (Lidarr), book (Readarr). */
  family: ArrFamily;
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

export function normalizeQueueRecord(
  r: ArrQueueRecord,
  flavor: ArrFlavor,
  tagLabels: Map<number, string> = new Map(),
): QueueItem {
  const family = FAMILIES[flavor.family];
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
    ...family.queueExtras(r, tagLabels),
  };
}

export function createArrInstance(
  ctx: AdapterContext<{ apiKey: string }>,
  adapterId: string,
  profile: ArrProfile,
  extra: { webPaths?: Partial<Record<'indexer' | 'queue' | 'settings' | 'system', string>> } = {},
): AdapterInstance & { flavor(): Promise<ArrFlavor>; detection(): Promise<ApiDetection> } {
  const headers = { 'X-Api-Key': ctx.credentials.apiKey };
  const detection = detectionCache(() => detectApi(ctx, profile));
  const flavor = async (): Promise<ArrFlavor> => {
    const d = await detection.get();
    return { ...profile.flavor(d), apiBase: d.apiBase };
  };
  const instanceRef = { id: ctx.instanceId, name: ctx.instanceName, adapter: adapterId };

  // A 404 on a known endpoint usually means the product changed its API:
  // detect again on the next call.
  const onError = (err: unknown): never => {
    if (err instanceof AdapterError && err.kind === 'notFound') detection.reset();
    throw err;
  };

  const get = async <T>(path: string, query?: Record<string, string | number | boolean>) => {
    const f = await flavor();
    try {
      return jsonOf<T>(await ctx.http.request({ path: `${f.apiBase}${path}`, query, headers }));
    } catch (err) {
      return onError(err);
    }
  };

  const send = async (
    method: 'POST' | 'PUT' | 'DELETE',
    path: string,
    json?: unknown,
    query?: Record<string, string | number | boolean>,
  ) => {
    const f = await flavor();
    try {
      const res = await ctx.http.request({ method, path: `${f.apiBase}${path}`, query, headers, json });
      ensureOk(res);
      return res;
    } catch (err) {
      return onError(err);
    }
  };

  const tags = async (): Promise<TagInfo[]> => {
    const list = await get<Array<{ id: number; label: string }>>('/tag');
    return list.map((t) => ({ id: t.id, label: t.label }));
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
    detection: () => detection.get(),
    async testConnection() {
      let d = await detection.get();
      const status = await get<StatusResource>('/system/status');
      if (!status || typeof status.version !== 'string')
        throw new AdapterError('badResponse', 'not an *arr API');
      // The product was updated since the last detection: detect again.
      if (await detection.noteVersion(status.version)) d = await detection.get();
      return {
        version: status.version,
        product: status.appName,
        apiVersion: d.api,
        compatibility: d.compat ? d.compat.reason : undefined,
      };
    },

    async health() {
      const items = await get<HealthResource[]>('/health');
      const compat = compatSignal(await detection.get(), instanceRef, profile.product);
      const signals = items.map((h): Signal => ({
        origin: 'service',
        instance: { id: ctx.instanceId, name: ctx.instanceName, adapter: adapterId },
        kind: 'health',
        source: h.source,
        level: arrLevel(h.type),
        message: h.message ?? '',
        wikiUrl: h.wikiUrl,
      }));
      return compat ? [...signals, compat] : signals;
    },

    async queue() {
      const f = await flavor();
      const family = FAMILIES[f.family];
      const tagLabels = new Map((await tags().catch(() => [] as TagInfo[])).map((t) => [t.id, t.label]));
      const records: ArrQueueRecord[] = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        const res = await get<Paged<ArrQueueRecord>>('/queue', {
          page,
          pageSize: PAGE_SIZE,
          [f.includeUnknownParam]: true,
          ...family.queueIncludes,
        });
        records.push(...res.records);
        if (records.length >= res.totalRecords || res.records.length === 0) break;
      }
      return records.map((r) => normalizeQueueRecord(r, f, tagLabels));
    },

    tags,

    async qualityProfiles() {
      const list = await get<Array<{ id: number; name: string }>>('/qualityprofile');
      return list.map((p) => ({ id: p.id, name: p.name }));
    },

    async removeQueueItem(queueId, opts) {
      await send('DELETE', `/queue/${queueId}`, undefined, {
        removeFromClient: opts.removeFromClient,
        blocklist: opts.blocklist,
        // Wardarr starts searches itself so it can count attempts.
        skipRedownload: true,
      });
    },

    async importPreview(downloadId) {
      const f = await flavor();
      const files = await get<Array<Record<string, unknown>>>('/manualimport', {
        downloadId,
        filterExistingFiles: true,
      });
      return files.map((file) => FAMILIES[f.family].previewFile(file));
    },

    async importFiles(downloadId, files) {
      const f = await flavor();
      await send('POST', '/command', {
        name: 'ManualImport',
        importMode: 'auto',
        files: files.map((file) => FAMILIES[f.family].importFile(file.raw, downloadId)),
      });
    },

    async wanted(list, opts) {
      const f = await flavor();
      return FAMILIES[f.family].wanted(list, opts, get);
    },

    async search(target) {
      const f = await flavor();
      await send('POST', '/command', FAMILIES[f.family].searchCommand(target));
    },

    async historySince(since) {
      const f = await flavor();
      const records = await get<Array<Record<string, unknown>>>('/history/since', { date: since });
      return records.map((r) => FAMILIES[f.family].historyEvent(r));
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
