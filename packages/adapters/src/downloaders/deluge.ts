// Deluge Web UI JSON API. Logs in with the Web UI password and connects to
// the first daemon if the Web UI is not connected yet.
import { AdapterError, defineAdapter, type DownloadJob } from '@wardarr/core';
import { z } from 'zod';
import { passwordField } from '../shared/fields.js';
import { ensureOk } from '../shared/http.js';

interface TorrentStatus {
  name: string;
  state: string;
  progress: number;
  total_size: number;
  total_done: number;
  download_payload_rate: number;
  eta: number;
  label?: string;
  time_added?: number;
}

export function delugeState(state: string): DownloadJob['state'] {
  switch (state) {
    case 'Downloading':
      return 'downloading';
    case 'Seeding':
      return 'seeding';
    case 'Paused':
      return 'paused';
    case 'Queued':
      return 'queued';
    case 'Checking':
    case 'Moving':
    case 'Allocating':
      return 'checking';
    case 'Error':
      return 'failed';
    default:
      return 'unknown';
  }
}

export const deluge = defineAdapter({
  id: 'deluge',
  name: 'Deluge',
  category: 'downloader',
  lifecycle: 'active',
  homepage: 'https://deluge-torrent.org',
  fields: [passwordField(true)],
  credentials: z.object({ password: z.string().min(1).max(1024) }),
  capabilities: ['downloads'],
  create(ctx) {
    let cookie = '';
    let id = 0;

    const raw = async <T>(method: string, params: unknown[]): Promise<T> => {
      const res = ensureOk(
        await ctx.http.request({
          method: 'POST',
          path: '/json',
          headers: cookie ? { cookie } : {},
          json: { method, params, id: ++id },
        }),
      );
      const setCookie = res.headers['set-cookie'];
      const m = setCookie?.match(/_session_id=([^;,\s]+)/);
      if (m?.[1]) cookie = `_session_id=${m[1]}`;
      const body = res.json<{ result: T; error: { message?: string; code?: number } | null }>();
      if (body.error) {
        if (body.error.code === 1) throw new AdapterError('unauthorized', 'not authenticated');
        throw new AdapterError('badResponse', body.error.message ?? 'rpc error');
      }
      return body.result;
    };

    const ensureSession = async () => {
      if (!cookie) {
        const ok = await raw<boolean>('auth.login', [ctx.credentials.password]);
        if (!ok) throw new AdapterError('unauthorized', 'login rejected');
      }
      if (!(await raw<boolean>('web.connected', []))) {
        const hosts = await raw<Array<[string, ...unknown[]]>>('web.get_hosts', []);
        if (!hosts[0]) throw new AdapterError('unreachable', 'no daemon configured');
        await raw('web.connect', [hosts[0][0]]);
      }
    };

    const call = async <T>(method: string, params: unknown[] = []): Promise<T> => {
      await ensureSession();
      try {
        return await raw<T>(method, params);
      } catch (err) {
        if (err instanceof AdapterError && err.kind === 'unauthorized') {
          cookie = '';
          await ensureSession();
          return raw<T>(method, params);
        }
        throw err;
      }
    };

    return {
      async testConnection() {
        const version = await call<string>('daemon.info');
        return { version: typeof version === 'string' ? version : null };
      },
      async downloads() {
        const fields = [
          'name',
          'state',
          'progress',
          'total_size',
          'total_done',
          'download_payload_rate',
          'eta',
          'label',
          'time_added',
        ];
        const res = await call<Record<string, TorrentStatus>>('core.get_torrents_status', [{}, fields]);
        return Object.entries(res).map(([hash, t]): DownloadJob => ({
          id: hash,
          name: t.name,
          state: delugeState(t.state),
          progress: t.progress / 100,
          sizeBytes: t.total_size,
          downloadedBytes: t.total_done,
          speedBytesPerSecond: t.download_payload_rate,
          etaSeconds: t.eta > 0 ? t.eta : null,
          category: t.label || null,
          addedAt: t.time_added ? new Date(t.time_added * 1000).toISOString() : null,
          tags: t.label ? [t.label] : [],
        }));
      },
      async removeDownload(jobId, opts) {
        await call('core.remove_torrent', [jobId.toLowerCase(), opts.deleteFiles]);
      },
      webUrl: () => `${ctx.baseUrl}/`,
    };
  },
});
