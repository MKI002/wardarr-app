// Transmission RPC. Speaks the legacy protocol (Transmission up to 4.x) and
// JSON-RPC 2.0 with snake_case names (Transmission 4.1 and later); the
// protocol is detected on first contact.
import { AdapterError, defineAdapter, type DownloadJob } from '@wardarr/core';
import { z } from 'zod';
import { passwordField, usernameField } from '../shared/fields.js';
import { ensureOk } from '../shared/http.js';

type Protocol = 'legacy' | 'jsonrpc';

const FIELDS_LEGACY = [
  'id',
  'hashString',
  'name',
  'status',
  'percentDone',
  'totalSize',
  'rateDownload',
  'eta',
  'addedDate',
  'error',
  'labels',
  'downloadedEver',
];
const FIELDS_SNAKE = [
  'id',
  'hash_string',
  'name',
  'status',
  'percent_done',
  'total_size',
  'rate_download',
  'eta',
  'added_date',
  'error',
  'labels',
  'downloaded_ever',
];

export function transmissionState(status: number, error: number): DownloadJob['state'] {
  // Error 3 is a local error (for example missing files); 1 and 2 are tracker problems.
  if (error === 3) return 'failed';
  switch (status) {
    case 0:
      return 'paused';
    case 1:
    case 2:
      return 'checking';
    case 3:
      return 'queued';
    case 4:
      return 'downloading';
    case 5:
    case 6:
      return 'seeding';
    default:
      return 'unknown';
  }
}

export const transmission = defineAdapter({
  id: 'transmission',
  name: 'Transmission',
  category: 'downloader',
  lifecycle: 'active',
  homepage: 'https://transmissionbt.com',
  fields: [
    {
      key: 'rpcPath',
      kind: 'text',
      label: 'adapters.fields.rpcPath',
      required: false,
      placeholder: '/transmission/rpc',
    },
    usernameField(false),
    passwordField(false),
  ],
  credentials: z.object({
    rpcPath: z.string().startsWith('/').max(256).optional(),
    username: z.string().max(256).optional(),
    password: z.string().max(1024).optional(),
  }),
  capabilities: ['downloads'],
  create(ctx) {
    const path = ctx.credentials.rpcPath ?? '/transmission/rpc';
    const auth = ctx.credentials.username
      ? `Basic ${Buffer.from(`${ctx.credentials.username}:${ctx.credentials.password ?? ''}`).toString('base64')}`
      : undefined;
    let sessionId = '';
    let protocol: Protocol | null = null;
    let rpcId = 0;

    const post = async (body: unknown, retried = false): Promise<Record<string, unknown>> => {
      const headers: Record<string, string> = { 'X-Transmission-Session-Id': sessionId };
      if (auth) headers.authorization = auth;
      const res = await ctx.http.request({ method: 'POST', path, headers, json: body });
      if (res.status === 409 && !retried) {
        sessionId = res.headers['x-transmission-session-id'] ?? '';
        return post(body, true);
      }
      return ensureOk(res).json<Record<string, unknown>>();
    };

    const call = async (legacyMethod: string, snakeMethod: string, args: Record<string, unknown> = {}) => {
      if (protocol === null || protocol === 'legacy') {
        const res = await post({ method: legacyMethod, arguments: args });
        if (res.result === 'success') {
          protocol = 'legacy';
          return res.arguments as Record<string, unknown>;
        }
        if (protocol === 'legacy') throw new AdapterError('badResponse', String(res.result ?? 'rpc error'));
      }
      const res = await post({ jsonrpc: '2.0', method: snakeMethod, params: args, id: ++rpcId });
      if (res.error) throw new AdapterError('badResponse', 'rpc error');
      protocol = 'jsonrpc';
      return res.result as Record<string, unknown>;
    };

    return {
      async testConnection() {
        const s = await call('session-get', 'session_get', {
          fields: ['version', 'rpc-version', 'rpc_version_semver'],
        });
        const version = String(s.version ?? '').split(' ')[0] || null;
        return { version, variant: protocol ?? undefined };
      },
      async downloads() {
        const snake = protocol === 'jsonrpc';
        const res = await call('torrent-get', 'torrent_get', {
          fields: snake ? FIELDS_SNAKE : FIELDS_LEGACY,
        });
        const torrents = (res.torrents ?? []) as Array<Record<string, unknown>>;
        const f = (t: Record<string, unknown>, legacy: string, sn: string) => t[snake ? sn : legacy];
        return torrents.map((t): DownloadJob => {
          const size = Number(f(t, 'totalSize', 'total_size') ?? 0);
          const eta = Number(t.eta ?? -1);
          const labels = (t.labels as string[] | undefined) ?? [];
          return {
            id: String(f(t, 'hashString', 'hash_string') ?? t.id),
            name: String(t.name ?? ''),
            state: transmissionState(Number(t.status), Number(t.error ?? 0)),
            progress: Number(f(t, 'percentDone', 'percent_done') ?? 0),
            sizeBytes: size,
            downloadedBytes: Number(f(t, 'downloadedEver', 'downloaded_ever') ?? 0),
            speedBytesPerSecond: Number(f(t, 'rateDownload', 'rate_download') ?? 0),
            etaSeconds: eta >= 0 ? eta : null,
            category: labels[0] ?? null,
            tags: labels,
            addedAt: f(t, 'addedDate', 'added_date')
              ? new Date(Number(f(t, 'addedDate', 'added_date')) * 1000).toISOString()
              : null,
          };
        });
      },
      async removeDownload(jobId, opts) {
        if (protocol === null) await call('session-get', 'session_get', { fields: ['version'] });
        if (protocol === 'jsonrpc') await call('torrent-remove', 'torrent_remove', { ids: [jobId.toLowerCase()], delete_local_data: opts.deleteFiles });
        else await call('torrent-remove', 'torrent_remove', { ids: [jobId.toLowerCase()], 'delete-local-data': opts.deleteFiles });
      },
      webUrl: () => `${ctx.baseUrl}/transmission/web/`,
    };
  },
});
