// Shared implementation for *arr apps (Sonarr, Radarr, Lidarr, Readarr,
// Whisparr). They share the same API shape with different paths and names.
import {
  AdapterError,
  type AdapterContext,
  type ArrCustomFormat,
  type ArrLanguage,
  type ArrNaming,
  type ArrQualityDefinition,
  type ArrQualityProfile,
  type ProfileSyncApi,
  type AdapterInstance,
  type ArrIndexerInfo,
  type DiskReport,
  type MediaKind,
  type QueueItem,
  type QueueItemState,
  type ServiceLink,
  type SettingsSection,
  type Signal,
  type StorageFolder,
  type TagInfo,
} from '@wardarr/core';
import {
  compatSignal,
  detectApi,
  detectionCache,
  majorOf,
  type ApiDetection,
  type VersionProfile,
} from '../shared/apiVersion.js';
import { arrLevel, ensureOk, jsonOf, toEntries } from '../shared/http.js';
import type { HttpResponse } from '@wardarr/core';
import { addressOf, fieldValue, folder, link, mountOf, part } from '../shared/topology.js';
import { FAMILIES, type ArrFamily } from './families.js';
import { readQualityScan } from './quality.js';

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

interface DiskSpaceResource {
  path?: string;
  label?: string | null;
  freeSpace?: number;
  totalSpace?: number;
}

interface RootFolderResource {
  path?: string;
  accessible?: boolean;
  freeSpace?: number | null;
  /** Lidarr and Readarr report it; Sonarr and Radarr only the free space. */
  totalSpace?: number | null;
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

interface IndexerResource {
  id: number;
  name?: string;
  implementation?: string;
  protocol?: string;
  enableRss?: boolean;
  enableAutomaticSearch?: boolean;
  enableInteractiveSearch?: boolean;
  priority?: number;
  tags?: number[];
  fields?: Array<{ name?: string; value?: unknown }>;
}

/** Normalizes an *arr indexer; the API key field is never read. */
export function normalizeArrIndexer(r: IndexerResource): ArrIndexerInfo {
  const baseUrl = r.fields?.find((f) => f.name === 'baseUrl')?.value;
  return {
    id: r.id,
    name: r.name ?? `#${r.id}`,
    implementation: r.implementation ?? '',
    protocol: r.protocol === 'usenet' || r.protocol === 'torrent' ? r.protocol : 'unknown',
    baseUrl: typeof baseUrl === 'string' && baseUrl ? baseUrl : null,
    enableRss: r.enableRss !== false,
    enableAutomaticSearch: r.enableAutomaticSearch !== false,
    enableInteractiveSearch: r.enableInteractiveSearch !== false,
    priority: typeof r.priority === 'number' ? r.priority : null,
    tags: Array.isArray(r.tags) ? r.tags.filter((t): t is number => typeof t === 'number') : [],
  };
}

interface Paged<T> {
  page: number;
  pageSize: number;
  totalRecords: number;
  records: T[];
}

interface ProviderResource {
  name?: string;
  implementation?: string;
  enable?: boolean;
  fields?: Array<{ name?: string; value?: unknown }>;
  [key: string]: unknown;
}

const FOLDER_KIND: Record<MediaKind, StorageFolder['kind']> = {
  episode: 'show',
  movie: 'movie',
  album: 'music',
  book: 'book',
  scene: 'other',
  item: 'other',
};

function hostLink(kind: ServiceLink['kind'], r: ProviderResource, enabled: boolean): ServiceLink {
  const f = r.fields;
  return link(
    kind,
    r.implementation ?? '',
    r.name ?? r.implementation ?? '',
    addressOf({
      host: fieldValue(f, 'host'),
      port: fieldValue(f, 'port'),
      ssl: fieldValue(f, 'useSsl'),
      base: fieldValue(f, 'urlBase'),
    }),
    enabled,
  );
}

const PAGE_SIZE = 250;
/** Timeout for reads of a whole library, which a big instance answers slowly. */
const SLOW_TIMEOUT_MS = 120_000;
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
  extra: {
    webPaths?: Partial<Record<'indexer' | 'queue' | 'settings' | 'system', string>>;
    /** Lowest product major version with custom formats; enables `profileSync` and `qualityScan`. */
    profileSyncSince?: number;
  } = {},
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

  /** For heavy reads (every file of a library): a longer timeout than polls get. */
  const slowGet = async <T>(path: string, query?: Record<string, string | number | boolean>) => {
    const f = await flavor();
    try {
      return jsonOf<T>(
        await ctx.http.request({ path: `${f.apiBase}${path}`, query, headers, timeoutMs: SLOW_TIMEOUT_MS }),
      );
    } catch (err) {
      return onError(err);
    }
  };

  const send = async (
    method: 'POST' | 'PUT' | 'DELETE',
    path: string,
    json?: unknown,
    query?: Record<string, string | number | boolean>,
  ): Promise<HttpResponse> => {
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

  const ensureCustomFormats = async () => {
    const d = await detection.get();
    const major = majorOf(d.productVersion);
    if (major && major < extra.profileSyncSince!)
      throw new AdapterError('unsupported', `${profile.product} ${d.productVersion} has no custom formats`);
  };
  const profileSync =
    extra.profileSyncSince === undefined ? undefined : createProfileSync(get, send, ensureCustomFormats);
  const qualityScan =
    extra.profileSyncSince === undefined
      ? undefined
      : async (onProgress?: (done: number, total: number) => void) => {
          await ensureCustomFormats();
          const f = await flavor();
          return readQualityScan(slowGet, f.family, ctx.baseUrl, onProgress);
        };

  return {
    flavor,
    detection: () => detection.get(),
    profileSync,
    qualityScan,
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

    async arrIndexers() {
      const list = await get<IndexerResource[]>('/indexer');
      return list.map(normalizeArrIndexer);
    },

    async setIndexerPriority(indexerId, priority) {
      // The whole resource goes back as read: secret fields come masked and
      // the app keeps their stored value.
      const resource = await get<IndexerResource>(`/indexer/${indexerId}`);
      if (resource.priority === priority) return;
      await send('PUT', `/indexer/${indexerId}`, { ...resource, priority }, { forceSave: true });
    },

    async historySince(since) {
      const f = await flavor();
      const records = await get<Array<Record<string, unknown>>>('/history/since', { date: since });
      return records.map((r) => FAMILIES[f.family].historyEvent(r));
    },

    async topology() {
      const f = await flavor();
      const [clients, notifications, roots, disks] = await Promise.all([
        part(() => get<ProviderResource[]>('/downloadclient'), []),
        part(() => get<ProviderResource[]>('/notification'), []),
        part(
          () => get<Array<{ path?: string; freeSpace?: number; accessible?: boolean }>>('/rootfolder'),
          [],
        ),
        part(() => get<Array<{ path?: string; freeSpace?: number; totalSpace?: number }>>('/diskspace'), []),
      ]);
      const links: ServiceLink[] = [
        ...clients.map((c) => hostLink('downloads', c, c.enable !== false)),
        // Media server connections that refresh the library after an import.
        ...notifications
          .filter((n) => /^(plexserver|mediabrowser|emby|jellyfin)$/i.test(n.implementation ?? ''))
          .map((n) => hostLink('libraryUpdate', n, n.onDownload !== false || n.onUpgrade !== false)),
      ];
      const folders = roots
        .filter((r) => typeof r.path === 'string' && r.path)
        .map((r) => {
          const mount = mountOf(r.path!, disks);
          return folder(
            r.path!,
            'media',
            { free: r.freeSpace ?? mount?.freeSpace, total: mount?.totalSpace, mount: mount?.path },
            { kind: FOLDER_KIND[f.mediaKind], accessible: r.accessible !== false },
          );
        });
      return { links, folders };
    },

    async calendar(start, end) {
      const f = await flavor();
      return FAMILIES[f.family].calendar(get, start, end);
    },

    async storage(): Promise<DiskReport> {
      const [disks, folders] = await Promise.all([
        get<DiskSpaceResource[]>('/diskspace'),
        get<RootFolderResource[]>('/rootfolder'),
      ]);
      const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
      return {
        disks: (Array.isArray(disks) ? disks : [])
          .filter((d) => typeof d.path === 'string' && n(d.totalSpace) !== null && n(d.freeSpace) !== null)
          .map((d) => ({
            path: d.path!,
            label: d.label ?? null,
            freeBytes: d.freeSpace!,
            totalBytes: d.totalSpace!,
          })),
        rootFolders: (Array.isArray(folders) ? folders : [])
          .filter((r) => typeof r.path === 'string')
          .map((r) => ({
            path: r.path!,
            freeBytes: n(r.freeSpace),
            totalBytes: n(r.totalSpace),
            accessible: r.accessible !== false,
          })),
      };
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

type Get = <T>(path: string, query?: Record<string, string | number | boolean>) => Promise<T>;
type Send = (
  method: 'POST' | 'PUT' | 'DELETE',
  path: string,
  json?: unknown,
  query?: Record<string, string | number | boolean>,
) => Promise<HttpResponse>;

/**
 * Profile settings of Sonarr (v4 and later) and Radarr: custom formats,
 * quality profiles, quality definitions and naming. Used by the TRaSH Guides
 * sync; every write goes through Wardarr's confirmed sync with a backup.
 */
function createProfileSync(get: Get, send: Send, ensureSupported: () => Promise<void>): ProfileSyncApi {
  const guarded =
    <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      await ensureSupported();
      return fn(...args);
    };
  const body = <T>(res: HttpResponse): T => res.json<T>();
  return {
    ensureSupported,
    customFormats: guarded(() => get<ArrCustomFormat[]>('/customformat')),
    createCustomFormat: guarded(async (cf) => body<ArrCustomFormat>(await send('POST', '/customformat', cf))),
    updateCustomFormat: guarded(async (cf) =>
      body<ArrCustomFormat>(await send('PUT', `/customformat/${cf.id}`, cf)),
    ),
    deleteCustomFormat: guarded(async (id) => {
      await send('DELETE', `/customformat/${id}`);
    }),
    qualityProfiles: guarded(() => get<ArrQualityProfile[]>('/qualityprofile')),
    qualityProfileSchema: guarded(() => get<ArrQualityProfile>('/qualityprofile/schema')),
    createQualityProfile: guarded(async (p) =>
      body<ArrQualityProfile>(await send('POST', '/qualityprofile', p)),
    ),
    updateQualityProfile: guarded(async (p) =>
      body<ArrQualityProfile>(await send('PUT', `/qualityprofile/${p.id}`, p)),
    ),
    deleteQualityProfile: guarded(async (id) => {
      await send('DELETE', `/qualityprofile/${id}`);
    }),
    qualityDefinitions: guarded(() => get<ArrQualityDefinition[]>('/qualitydefinition')),
    updateQualityDefinitions: guarded(async (defs) => {
      await send('PUT', '/qualitydefinition/update', defs);
    }),
    naming: guarded(() => get<ArrNaming>('/config/naming')),
    updateNaming: guarded(async (naming) => {
      await send('PUT', `/config/naming/${naming.id ?? 1}`, naming);
    }),
    languages: guarded(async () => {
      const list = await get<Array<{ id: number; name: string }>>('/language');
      return list.map((l): ArrLanguage => ({ id: l.id, name: l.name }));
    }),
    parseRelease: guarded(async (title) => {
      const res = await get<{
        title?: string;
        parsedMovieInfo?: ParsedInfo;
        parsedEpisodeInfo?: ParsedInfo;
        customFormats?: Array<{ id: number; name: string }>;
      }>('/parse', { title });
      const info = res.parsedMovieInfo ?? res.parsedEpisodeInfo;
      return {
        title: res.title ?? title,
        quality: info?.quality?.quality?.name ?? null,
        customFormats: (res.customFormats ?? []).map((f) => ({ id: f.id, name: f.name })),
        languages: (info?.languages ?? []).map((l) => l.name).filter((n): n is string => !!n),
        releaseGroup: info?.releaseGroup ?? null,
      };
    }),
  };
}

interface ParsedInfo {
  quality?: { quality?: { name?: string } };
  languages?: Array<{ name?: string }>;
  releaseGroup?: string;
}
