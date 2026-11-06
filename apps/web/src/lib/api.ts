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
  category: 'arr' | 'indexer' | 'downloader' | 'mediaServer' | 'requests';
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
