// The adapter contract. Every connected service implements this shape, so new
// services can be contributed without touching the rest of Wardarr.
import type { z } from 'zod';
import type { HttpClient } from './http.js';
import type { Signal } from '../issues/types.js';
import type { ProfileSyncApi } from '../trash/types.js';
import type { DiskReport } from '../storage/disks.js';

export type AdapterCategory = 'arr' | 'indexer' | 'downloader' | 'mediaServer' | 'requests' | 'transcoder';

/** Capabilities drive which parts of the UI are shown. */
export const CAPABILITIES = [
  'health',
  'queue',
  'queueActions',
  'manualImport',
  'wanted',
  'search',
  'history',
  'settings',
  'sessions',
  'library',
  'discover',
  'requests',
  'downloads',
  'indexers',
  'trashSync',
  'calendar',
  'storage',
  'transcoding',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export type AdapterLifecycle = 'active' | 'upstreamDiscontinued';

/** One input on the "add instance" form. Secret fields are write-only. */
export interface CredentialField {
  key: string;
  kind: 'url' | 'text' | 'secret' | 'number' | 'boolean';
  /** i18n key for the label. */
  label: string;
  /** i18n key for help text. */
  help?: string;
  required: boolean;
  placeholder?: string;
}

export interface AdapterLogger {
  debug(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
}

export interface AdapterContext<C> {
  instanceId: string;
  instanceName: string;
  /** Base URL without trailing slash. */
  baseUrl: string;
  credentials: C;
  http: HttpClient;
  log: AdapterLogger;
}

export interface ConnectionInfo {
  version: string | null;
  /** Product name as reported by the service, if any. */
  product?: string;
  /** Adapter specific variant, for example `v3` for Whisparr Eros. */
  variant?: string;
  /** API version Wardarr detected and uses, for example `v3`. */
  apiVersion?: string;
  /** Set when Wardarr talks to a version it was not tested with. */
  compatibility?: 'untestedVersion' | 'newerApi' | 'both';
}

export type QueueItemState =
  | 'downloading'
  | 'queued'
  | 'paused'
  | 'completed'
  | 'importPending'
  | 'importBlocked'
  | 'failed'
  | 'warning'
  | 'unknown';

/** A normalized queue entry of an *arr instance. */
export interface QueueItem {
  /** The *arr queue record id. */
  id: number;
  /** Download client id, shared by all records of a season pack. */
  downloadId: string | null;
  title: string;
  /** Kind of media for labels, for example `episode` or `album`. */
  mediaKind: MediaKind;
  /** Whether the item is matched to a library entry. */
  matched: boolean;
  /** Library entry the item belongs to, when matched. */
  mediaId?: number;
  state: QueueItemState;
  /** Raw tracked download state and status of the *arr. */
  trackedState?: string;
  trackedStatus?: string;
  statusMessages: string[];
  errorMessage?: string;
  sizeBytes?: number;
  sizeLeftBytes?: number;
  downloadClient?: string;
  protocol?: 'usenet' | 'torrent' | 'unknown';
  added?: string;
  estimatedCompletion?: string;
  /** The library entry already has a file, so a failed download is an upgrade. */
  inLibrary?: boolean;
  /** Tag labels of the library entry (series, movie, artist, author). */
  tags?: string[];
  /** Ids used to search the title again, for example episode ids. */
  searchTarget?: SearchTarget;
  /** Stable key of the title, for example `episode:12`, for attempt counting. */
  titleKey?: string;
  /** Series, artist or author id. */
  parentId?: number;
  seasonNumber?: number;
}

/** A file in a manual import preview. */
export interface ImportPreviewFile {
  path: string;
  name: string;
  /** Where the file would go, for example `Example Show S01E01`. Null when unmapped. */
  target: string | null;
  rejections: string[];
  /** The preview record as the service sent it, needed to start the import. */
  raw: Record<string, unknown>;
}

/** What a search command targets. */
export type SearchTarget =
  | { kind: 'episodes'; ids: number[] }
  | { kind: 'season'; seriesId: number; seasonNumber: number; episodeIds: number[] }
  | { kind: 'movies'; ids: number[] }
  | { kind: 'albums'; ids: number[] }
  | { kind: 'books'; ids: number[] };

/** A title on the wanted list (missing or below cutoff). */
export interface WantedItem {
  /** Stable key, for example `episode:12`. */
  key: string;
  title: string;
  mediaKind: MediaKind;
  /** Ids the search command takes, for example the episode id. */
  mediaId: number;
  /** Series, artist or author id. */
  parentId?: number;
  parentTitle?: string;
  seasonNumber?: number;
  monitored: boolean;
  tags: number[];
  qualityProfileId?: number;
  year?: number;
  /** Air or release date. */
  releaseDate?: string;
}

/** What a calendar entry is about. */
export type CalendarKind = 'episode' | 'movie' | 'album' | 'book';
/** Which release a date stands for. Movies have up to three. */
export type CalendarRelease = 'airing' | 'cinema' | 'digital' | 'physical' | 'release';

/** One upcoming (or recent) release from an *arr calendar. */
export interface CalendarEntry {
  /** Stable within the instance, for example `episode:12` or `movie:5:digital`. */
  id: string;
  kind: CalendarKind;
  release: CalendarRelease;
  /** Series, movie, artist or author. */
  title: string;
  /** Episode, album or book title. */
  subtitle: string | null;
  seasonNumber?: number;
  episodeNumber?: number;
  /** An ISO time for airings, `YYYY-MM-DD` for releases that only have a day. */
  date: string;
  allDay: boolean;
  runtimeMinutes: number | null;
  hasFile: boolean;
  monitored: boolean;
  /** First episode of a series or a season. */
  premiere?: 'series' | 'season';
  finale?: 'series' | 'season' | 'midseason';
  year: number | null;
  /** TMDB poster path such as `/abc.jpg`, when the service has one. */
  posterPath: string | null;
  /** TMDB id of the movie or series, used to merge duplicates across instances. */
  tmdbId: number | null;
  network: string | null;
  overview: string | null;
}

export interface HistoryEvent {
  at: string;
  type: 'grabbed' | 'imported' | 'failed' | 'other';
  mediaId: number | null;
  downloadId: string | null;
}

export interface TagInfo {
  id: number;
  label: string;
}

export interface QualityProfileInfo {
  id: number;
  name: string;
}

export type MediaKind = 'episode' | 'movie' | 'album' | 'book' | 'scene' | 'item';

/** A job on a download client. */
export interface DownloadJob {
  id: string;
  name: string;
  state:
    | 'downloading'
    | 'queued'
    | 'paused'
    | 'seeding'
    | 'completed'
    | 'checking'
    | 'failed'
    | 'stalled'
    | 'unknown';
  progress: number;
  sizeBytes: number | null;
  downloadedBytes: number | null;
  speedBytesPerSecond: number | null;
  etaSeconds: number | null;
  category: string | null;
  addedAt: string | null;
  /** Labels or tags set on the job in the client. */
  tags?: string[];
}

/** A playback session on a media server. */
export interface StreamSession {
  id: string;
  user: string;
  title: string;
  subtitle?: string;
  mediaType: 'movie' | 'episode' | 'track' | 'other';
  state: 'playing' | 'paused' | 'buffering';
  progress: number;
  durationMs: number | null;
  positionMs: number | null;
  transcoding: boolean;
  device?: string;
  client?: string;
  resolution?: string;
}

export interface IndexerInfo {
  id: number;
  name: string;
  enabled: boolean;
  protocol: 'usenet' | 'torrent' | 'unknown';
  failing: boolean;
  disabledUntil?: string;
  mostRecentFailure?: string;
}

/** Query and grab statistics of one indexer (Prowlarr). */
export interface IndexerStats {
  indexerId: number;
  name: string;
  queries: number;
  grabs: number;
  failedQueries: number;
  failedGrabs: number;
  averageResponseMs: number | null;
}

/** An app Prowlarr syncs indexers to, with the indexers it receives. */
export interface IndexerApp {
  id: number;
  name: string;
  implementation: string;
  baseUrl: string | null;
  enabled: boolean;
  /** Indexer ids synced to this app. */
  indexerIds: number[];
}

/** A title on a Discover list (Seerr). Music is never included. */
export type MediaAvailability = 'unknown' | 'requested' | 'processing' | 'partial' | 'available';

export interface DiscoverItem {
  /** TMDB id. */
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  year: number | null;
  overview: string;
  posterPath: string | null;
  backdropPath: string | null;
  rating: number | null;
  status: MediaAvailability;
  status4k: MediaAvailability;
}

export interface DiscoverPage {
  page: number;
  totalPages: number;
  results: DiscoverItem[];
}

export interface DiscoverDetails extends DiscoverItem {
  /** Seasons of a series, without specials. */
  seasons: Array<{
    seasonNumber: number;
    name: string;
    episodeCount: number;
    status: MediaAvailability;
    status4k: MediaAvailability;
  }>;
  tvdbId: number | null;
}

/** An *arr server Seerr can send requests to. */
export interface RequestServer {
  id: number;
  name: string;
  type: 'radarr' | 'sonarr';
  is4k: boolean;
  isDefault: boolean;
  profiles: Array<{ id: number; name: string }>;
  rootFolders: string[];
  defaultProfileId: number | null;
  defaultRootFolder: string | null;
}

export type RequestStatus = 'pending' | 'approved' | 'declined' | 'failed' | 'completed';

export interface MediaRequest {
  id: number;
  status: RequestStatus;
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  title: string | null;
  posterPath: string | null;
  is4k: boolean;
  seasons: number[];
  createdAt: string;
  updatedAt: string | null;
  requestedBy: { id: number; name: string };
  serverId: number | null;
  profileId: number | null;
  rootFolder: string | null;
  mediaStatus: MediaAvailability;
}

export interface RequestFilter {
  status?: 'all' | 'pending' | 'approved' | 'processing' | 'available' | 'failed' | 'declined';
  requestedBy?: number;
  take: number;
  skip: number;
}

export interface NewRequest {
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  tvdbId?: number;
  seasons?: number[] | 'all';
  is4k: boolean;
  serverId?: number;
  profileId?: number;
  rootFolder?: string;
}

export interface RequestEdit {
  seasons?: number[];
  is4k?: boolean;
  serverId?: number;
  profileId?: number;
  rootFolder?: string;
}

export interface ExternalUser {
  id: number;
  name: string;
  /** Names to match against Wardarr users, for example the Plex or Jellyfin user name. */
  aliases: string[];
}

/** Library statistics of a media server. */
export interface LibraryStats {
  id: string;
  name: string;
  kind: 'movie' | 'show' | 'music' | 'other';
  items: number;
  /** Movies or episodes counted for size, resolution and codec. */
  files: number;
  sizeBytes: number | null;
  resolutions: Record<string, number>;
  videoCodecs: Record<string, number>;
}

/** What a transcode worker does: convert files or check that they play. */
export type TranscodeWorkKind = 'transcode' | 'healthCheck';

/** One worker on a transcode node (Tdarr). */
export interface TranscodeWorker {
  id: string;
  kind: TranscodeWorkKind;
  gpu: boolean;
  /** Path of the file being worked on, as the service reports it. */
  file: string | null;
  /** 0-1. */
  progress: number;
  fps: number | null;
  /** Remaining time as the service reports it, for example `0:12:03`. */
  eta: string | null;
  /** Current step, for example the plugin or flow step that runs. */
  step: string | null;
  /** When the job started. */
  startedAt: string | null;
  originalBytes: number | null;
  /** Expected size of the output, while the job runs. */
  estimatedBytes: number | null;
}

/** Worker slots of a node per kind of work. */
export interface TranscodeWorkerLimits {
  transcodeCpu: number;
  transcodeGpu: number;
  healthCheckCpu: number;
  healthCheckGpu: number;
}

/** A machine that runs transcode workers for a server (a Tdarr node). */
export interface TranscodeNode {
  id: string;
  name: string;
  paused: boolean;
  workers: TranscodeWorker[];
  limits: TranscodeWorkerLimits;
  cpuPercent: number | null;
  memoryUsedBytes: number | null;
  memoryTotalBytes: number | null;
}

/** Totals of a transcode server. Counters cover the whole library. */
export interface TranscodeTotals {
  files: number;
  transcodes: number;
  healthChecks: number;
  /** Space saved by transcodes so far; negative when files grew. */
  savedBytes: number;
  queued: { transcode: number; healthCheck: number };
  /** Transcoded or not required, healthy. */
  done: { transcode: number; healthCheck: number };
  /** Errors and cancelled jobs. */
  failed: { transcode: number; healthCheck: number };
}

/** What a transcode server is doing right now (capability `transcoding`). */
export interface TranscodeStatus {
  nodes: TranscodeNode[];
  totals: TranscodeTotals | null;
}

/** A library a transcode server watches, with its own totals when known. */
export interface TranscodeLibrary {
  id: string;
  name: string;
  folder: string | null;
  files: number | null;
  transcodes: number | null;
  healthChecks: number | null;
  savedBytes: number | null;
}

/** A file whose transcode or health check failed. */
export interface TranscodeFailure {
  file: string;
  kind: TranscodeWorkKind;
  /** `error` or `cancelled`. */
  outcome: 'error' | 'cancelled';
  at: string | null;
  sizeBytes: number | null;
}

/** What a reported connection between two services is for (stack map). */
export type LinkKind = 'indexers' | 'downloads' | 'requests' | 'subtitles' | 'mediaServer' | 'libraryUpdate';

/**
 * A connection a service reports to another service, for example a download
 * client configured in Sonarr. Wardarr matches it to a connected instance.
 */
export interface ServiceLink {
  kind: LinkKind;
  /** Wardarr adapter ids the other side can be, most likely first. Empty when unknown. */
  products: string[];
  /** Implementation as the service names it, for example `QBittorrent`. */
  implementation: string;
  /** Name the link has in the service. */
  name: string;
  /** Address configured in the service, without credentials. */
  url: string | null;
  enabled: boolean;
  /** Ids of the indexers a Prowlarr app receives. */
  indexerIds?: number[];
  is4k?: boolean;
}

/** A folder a service reads or writes, with the space of its disk when known. */
export interface StorageFolder {
  path: string;
  /** `media`: *arr root folder, `downloads`: download client folder, `library`: media server library. */
  use: 'media' | 'downloads' | 'library';
  kind?: 'movie' | 'show' | 'music' | 'book' | 'other';
  /** Library or folder name, when the service gives one. */
  name?: string;
  freeBytes: number | null;
  totalBytes: number | null;
  /** Mount point the space figures belong to, when the service reports one. */
  mount?: string;
  accessible?: boolean;
}

/** Everything a service reports about its neighbours. */
export interface ServiceTopology {
  links: ServiceLink[];
  folders: StorageFolder[];
}

export interface SettingsEntry {
  key: string;
  value: string | number | boolean | null;
  secret: boolean;
}

export interface SettingsSection {
  id: string;
  entries: SettingsEntry[];
}

export interface AdapterInstance {
  /** Checks reachability and credentials. Throws AdapterError on failure. */
  testConnection(): Promise<ConnectionInfo>;
  /** Health messages of the service, normalized into issue signals. */
  health?(): Promise<Signal[]>;
  /** Full *arr queue, including entries without a library match. */
  queue?(): Promise<QueueItem[]>;
  downloads?(): Promise<DownloadJob[]>;
  sessions?(): Promise<StreamSession[]>;
  indexers?(): Promise<IndexerInfo[]>;
  testIndexer?(indexerId: number): Promise<{ ok: boolean; message?: string }>;
  // Queue actions (capability `queueActions`).
  /** Removes a queue record. Removing one record of a season pack removes the whole download. */
  removeQueueItem?(queueId: number, opts: { removeFromClient: boolean; blocklist: boolean }): Promise<void>;
  // Manual import (capability `manualImport`).
  importPreview?(downloadId: string): Promise<ImportPreviewFile[]>;
  importFiles?(downloadId: string, files: ImportPreviewFile[]): Promise<void>;
  // Wanted lists and searches (capabilities `wanted`, `search`, `history`).
  wanted?(list: 'missing' | 'cutoff', opts: { monitoredOnly: boolean; max: number }): Promise<WantedItem[]>;
  search?(target: SearchTarget): Promise<void>;
  historySince?(since: string): Promise<HistoryEvent[]>;
  /** Releases between two ISO times, monitored titles only (capability `calendar`). */
  calendar?(start: string, end: string): Promise<CalendarEntry[]>;
  tags?(): Promise<TagInfo[]>;
  qualityProfiles?(): Promise<QualityProfileInfo[]>;
  // Prowlarr (capability `indexers`).
  indexerStats?(): Promise<IndexerStats[]>;
  indexerApps?(): Promise<IndexerApp[]>;
  // Seerr (capabilities `discover`, `requests`). `asUser` is the Seerr user id
  // the request is made for (X-API-User); without it the API key owner acts.
  discover?(list: 'trending' | 'movies' | 'tv', page: number, asUser?: number): Promise<DiscoverPage>;
  searchMedia?(query: string, page: number, asUser?: number): Promise<DiscoverPage>;
  mediaDetails?(mediaType: 'movie' | 'tv', tmdbId: number, asUser?: number): Promise<DiscoverDetails>;
  requestServers?(): Promise<RequestServer[]>;
  requests?(filter: RequestFilter): Promise<{ total: number; results: MediaRequest[] }>;
  createRequest?(req: NewRequest, asUser?: number): Promise<MediaRequest>;
  setRequestStatus?(id: number, status: 'approve' | 'decline'): Promise<MediaRequest>;
  editRequest?(id: number, edit: RequestEdit): Promise<MediaRequest>;
  retryRequest?(id: number): Promise<MediaRequest>;
  users?(): Promise<ExternalUser[]>;
  // Media servers (capability `library`).
  libraries?(): Promise<LibraryStats[]>;
  // Transcode servers (capability `transcoding`).
  transcoding?(): Promise<TranscodeStatus>;
  transcodeLibraries?(): Promise<TranscodeLibrary[]>;
  transcodeFailures?(limit: number): Promise<TranscodeFailure[]>;
  // Download clients.
  removeDownload?(jobId: string, opts: { deleteFiles: boolean }): Promise<void>;
  /** Read-only settings. Secrets must already be masked. */
  settings?(): Promise<SettingsSection[]>;
  /** Mounts and root folders with their free space (capability `storage`). */
  storage?(): Promise<DiskReport>;
  /** Custom formats, quality profiles, sizes and naming (capability `trashSync`). */
  profileSync?: ProfileSyncApi;
  /** Connections and folders for the stack map. Parts that fail are left out. */
  topology?(): Promise<ServiceTopology>;
  /** Deep link into the service UI. */
  webUrl?(target?: { kind: 'indexer' | 'queue' | 'settings' | 'system'; id?: string | number }): string;
}

export interface AdapterDefinition<C = Record<string, unknown>> {
  /** Stable id, lowercase, used in the database. */
  id: string;
  /** Product name shown in the UI. */
  name: string;
  category: AdapterCategory;
  lifecycle: AdapterLifecycle;
  /** Public project homepage. */
  homepage: string;
  fields: CredentialField[];
  credentials: z.ZodType<C>;
  capabilities: readonly Capability[];
  /** Media kind of queue entries, for labels. */
  mediaKind?: MediaKind;
  create(ctx: AdapterContext<C>): AdapterInstance;
}

/** Helper that keeps the generic credential type when defining an adapter. */
export function defineAdapter<C>(def: AdapterDefinition<C>): AdapterDefinition<C> {
  for (const cap of def.capabilities) {
    if (!(CAPABILITIES as readonly string[]).includes(cap)) {
      throw new Error(`Adapter ${def.id} declares unknown capability ${cap}`);
    }
  }
  return def;
}

export type AdapterErrorKind =
  'unreachable' | 'timeout' | 'unauthorized' | 'notFound' | 'badResponse' | 'blocked' | 'unsupported';

/** Error type adapters throw, so callers can classify failures. */
export class AdapterError extends Error {
  readonly kind: AdapterErrorKind;
  readonly status?: number;
  constructor(kind: AdapterErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'AdapterError';
    this.kind = kind;
    this.status = status;
  }
}
