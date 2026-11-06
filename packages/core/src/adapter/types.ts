// The adapter contract. Every connected service implements this shape, so new
// services can be contributed without touching the rest of Wardarr.
import type { z } from 'zod';
import type { HttpClient } from './http.js';
import type { Signal } from '../issues/types.js';

export type AdapterCategory = 'arr' | 'indexer' | 'downloader' | 'mediaServer' | 'requests';

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
  /** Read-only settings. Secrets must already be masked. */
  settings?(): Promise<SettingsSection[]>;
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
