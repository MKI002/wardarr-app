// qBittorrent WebUI API v2. Uses cookie login; supports the 5.x endpoint
// names and the 4.x ones, selected from the reported API version.
import { AdapterError, defineAdapter, type DownloadJob } from '@wardarr/core';
import { z } from 'zod';
import { passwordField, usernameField } from '../shared/fields.js';
import { ensureOk } from '../shared/http.js';
import { folder, part } from '../shared/topology.js';
import { downloaderSignal, portWatch } from './health.js';

interface Torrent {
  hash: string;
  name: string;
  state: string;
  tags?: string;
  progress: number;
  size: number;
  downloaded: number;
  dlspeed: number;
  eta: number;
  category?: string;
  added_on?: number;
}

export function torrentState(state: string): DownloadJob['state'] {
  switch (state) {
    case 'downloading':
    case 'forcedDL':
    case 'metaDL':
    case 'forcedMetaDL':
      return 'downloading';
    case 'stalledDL':
      return 'stalled';
    case 'pausedDL':
    case 'stoppedDL':
      return 'paused';
    case 'queuedDL':
    case 'allocating':
      return 'queued';
    case 'uploading':
    case 'forcedUP':
    case 'stalledUP':
    case 'queuedUP':
      return 'seeding';
    case 'pausedUP':
    case 'stoppedUP':
      return 'completed';
    case 'checkingDL':
    case 'checkingUP':
    case 'checkingResumeData':
    case 'moving':
      return 'checking';
    case 'error':
    case 'missingFiles':
      return 'failed';
    default:
      return 'unknown';
  }
}

export const qbittorrent = defineAdapter({
  id: 'qbittorrent',
  name: 'qBittorrent',
  category: 'downloader',
  lifecycle: 'active',
  homepage: 'https://www.qbittorrent.org',
  fields: [usernameField(false), passwordField(false)],
  credentials: z.object({
    username: z.string().max(256).optional(),
    password: z.string().max(1024).optional(),
  }),
  capabilities: ['health', 'downloads'],
  create(ctx) {
    let sid: string | null = null;
    const port = portWatch();

    const login = async () => {
      const res = await ctx.http.request({
        method: 'POST',
        path: '/api/v2/auth/login',
        form: { username: ctx.credentials.username ?? '', password: ctx.credentials.password ?? '' },
      });
      if (res.status === 403) throw new AdapterError('unauthorized', 'login banned or rejected', 403);
      ensureOk(res);
      const match = (res.headers['set-cookie'] ?? '').match(/SID=([^;,\s]+)/);
      if (match?.[1]) sid = match[1];
      else if (!/^ok\.?$/i.test(res.text.trim())) throw new AdapterError('unauthorized', 'login rejected');
    };

    const get = async (path: string, query?: Record<string, string>, retried = false): Promise<string> => {
      if (sid === null) await login();
      const res = await ctx.http.request({ path, query, headers: sid ? { cookie: `SID=${sid}` } : {} });
      if (res.status === 403 && !retried) {
        sid = null;
        return get(path, query, true);
      }
      return ensureOk(res).text;
    };

    const post = async (path: string, form: Record<string, string>, retried = false): Promise<void> => {
      if (sid === null) await login();
      const res = await ctx.http.request({
        method: 'POST',
        path,
        form,
        headers: sid ? { cookie: `SID=${sid}` } : {},
      });
      if (res.status === 403 && !retried) {
        sid = null;
        return post(path, form, true);
      }
      ensureOk(res);
    };

    return {
      async testConnection() {
        const version = (await get('/api/v2/app/version')).trim();
        const api = (await get('/api/v2/app/webapiVersion')).trim();
        return { version, variant: `webapi ${api}` };
      },
      async health() {
        const info = JSON.parse(await get('/api/v2/transfer/info')) as { connection_status?: string };
        const status = info.connection_status;
        if (status === 'disconnected') {
          port.update(false);
          return [
            downloaderSignal(ctx, 'qbittorrent', 'connection', 'error', 'qBittorrent is disconnected', {
              status: 'disconnected',
            }),
          ];
        }
        if (!port.update(status === 'firewalled')) return [];
        // Without anything transferring, "firewalled" is expected and says nothing.
        const active = JSON.parse(
          await get('/api/v2/torrents/info', { filter: 'active', limit: '1' }),
        ) as unknown[];
        if (active.length === 0) return [];
        return [
          downloaderSignal(ctx, 'qbittorrent', 'connection', 'warning', 'qBittorrent is firewalled', {
            status: 'firewalled',
          }),
        ];
      },
      async downloads() {
        const list = JSON.parse(await get('/api/v2/torrents/info')) as Torrent[];
        return list.map((t): DownloadJob => ({
          id: t.hash,
          name: t.name,
          state: torrentState(t.state),
          progress: t.progress,
          sizeBytes: t.size,
          downloadedBytes: t.downloaded,
          speedBytesPerSecond: t.dlspeed,
          etaSeconds: t.eta >= 8640000 ? null : t.eta,
          category: t.category || null,
          addedAt: t.added_on ? new Date(t.added_on * 1000).toISOString() : null,
          tags: t.tags
            ? t.tags
                .split(',')
                .map((x) => x.trim())
                .filter(Boolean)
            : [],
        }));
      },
      async removeDownload(jobId, opts) {
        await post('/api/v2/torrents/delete', {
          hashes: jobId.toLowerCase(),
          deleteFiles: String(opts.deleteFiles),
        });
      },
      async topology() {
        const dir = (await part(() => get('/api/v2/app/defaultSavePath'), '')).trim();
        if (!dir) return { links: [], folders: [] };
        const main = await part(
          async () =>
            JSON.parse(await get('/api/v2/sync/maindata', { rid: '0' })) as {
              server_state?: { free_space_on_disk?: number };
            },
          {},
        );
        return {
          links: [],
          folders: [folder(dir, 'downloads', { free: main.server_state?.free_space_on_disk })],
        };
      },
      webUrl: () => `${ctx.baseUrl}/`,
    };
  },
});
