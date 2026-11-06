// Small fetch wrapper. Adds the CSRF token to state-changing requests.
import type { IssueGroup, Msg } from '@wardarr/core';

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(code);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json' };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') {
    if (csrfToken) headers['x-csrf-token'] = csrfToken;
    else headers['x-wardarr-request'] = '1';
  }
  const res = await fetch(path, {
    method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: 'same-origin',
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { error?: string; details?: unknown };
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'unknown', data.details);
  return data as T;
}

/** Sends a file or JSON and receives a file, for backup upload and download. */
export async function apiBinary(
  path: string,
  init: { method: string; body: Blob | object },
): Promise<{ blob: Blob; filename: string | null; json: unknown }> {
  const headers: Record<string, string> = {};
  if (csrfToken) headers['x-csrf-token'] = csrfToken;
  else headers['x-wardarr-request'] = '1';
  const isBlob = init.body instanceof Blob;
  headers['content-type'] = isBlob ? 'application/octet-stream' : 'application/json';
  const res = await fetch(path, {
    method: init.method,
    headers,
    body: isBlob ? (init.body as Blob) : JSON.stringify(init.body),
    credentials: 'same-origin',
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; details?: unknown };
    throw new ApiError(res.status, data.error ?? 'unknown', data.details);
  }
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('application/json')) return { blob: new Blob(), filename: null, json: await res.json() };
  const disposition = res.headers.get('content-disposition') ?? '';
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? null;
  return { blob: await res.blob(), filename, json: null };
}

export interface Me {
  user: {
    id: string;
    username: string;
    displayName: string | null;
    role: 'admin' | 'user';
    preferences: Preferences;
  };
  csrfToken: string;
}

export interface Preferences {
  language?: 'en' | 'de';
  theme?: 'system' | 'dark' | 'light';
  reducedMotion?: 'system' | 'reduce' | 'full';
}

export interface CredentialField {
  key: string;
  kind: 'url' | 'text' | 'secret' | 'number' | 'boolean';
  label: string;
  help?: string;
  required: boolean;
  placeholder?: string;
}

export interface AdapterInfo {
  id: string;
  name: string;
  category: 'arr' | 'indexer' | 'downloader' | 'mediaServer' | 'requests' | 'transcoder';
  lifecycle: 'active' | 'upstreamDiscontinued';
  homepage: string;
  fields: CredentialField[];
  capabilities: string[];
}

export interface Instance {
  id: string;
  adapter: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  allowInsecureTls: boolean;
  fields: Record<string, string | number | boolean | { isSet: boolean } | null>;
  options: { pollIntervalSeconds?: number; timeoutMs?: number };
}

export type InstanceStatus = 'ok' | 'degraded' | 'down' | 'unknown' | 'disabled';

export interface Overview {
  instances: Array<{
    id: string;
    name: string;
    adapter: string;
    adapterName: string;
    category: AdapterInfo['category'];
    lifecycle: AdapterInfo['lifecycle'];
    status: InstanceStatus;
    version: string | null;
    checkedAt: string | null;
    errorKind: string | null;
  }>;
  streams: Array<{
    id: string;
    user: string;
    title: string;
    subtitle?: string;
    state: 'playing' | 'paused' | 'buffering';
    progress: number;
    transcoding: boolean;
    device?: string;
    resolution?: string;
    instanceId: string;
    instanceName: string;
  }>;
  downloads: Array<{
    id: string;
    name: string;
    state: string;
    progress: number;
    speedBytesPerSecond: number | null;
    etaSeconds: number | null;
    instanceId: string;
    instanceName: string;
  }>;
  /** Disks of the *arr apps; null when no app reports any. */
  storage: {
    disks: number;
    totalBytes: number;
    freeBytes: number;
    worst: 'ok' | 'warning' | 'critical';
    soonest: { key: string; label: string; daysLeft: number | null } | null;
  } | null;
  issues: {
    counts: { critical: number; warning: number; info: number };
    needsAttention: Array<{
      fingerprint: string;
      severity: IssueGroup['severity'];
      origin: IssueGroup['origin'];
      title: Msg;
      affected: Msg;
    }>;
    wardarr: number;
  };
  stats: {
    instancesOnline: number;
    instancesTotal: number;
    activeStreams: number;
    transcodes: number;
    activeDownloads: number;
    downloadSpeed: number;
  };
}

export interface IssueView {
  fingerprint: string;
  status: 'open' | 'resolved';
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  mutedUntil: string | null;
  mutedForever: boolean;
  muted: boolean;
  group: IssueGroup;
}

export interface QueueEntry {
  instanceId: string;
  instanceName: string;
  items: Array<{
    id: number;
    downloadId: string | null;
    title: string;
    state: string;
    matched: boolean;
    statusMessages: string[];
    errorMessage?: string;
    sizeBytes?: number;
    sizeLeftBytes?: number;
    downloadClient?: string;
  }>;
}
