// qBittorrent WebUI API v2. Uses cookie login; supports the 5.x endpoint
// names and the 4.x ones, selected from the reported API version.
import {
  AdapterError,
  defineAdapter,
  extensionOf,
  extensionPattern,
  patternExtension,
  uniqueExtensions,
  wildcardToRegExp,
  type BlockedDownload,
  type DownloadJob,
  type ExtensionBlockStatus,
} from '@wardarr/core';
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

interface Preferences {
  excluded_file_names_enabled?: boolean;
  excluded_file_names?: string;
}

/** The excluded names list as qBittorrent keeps it: one wildcard pattern per line. */
export function excludedPatterns(prefs: Preferences): string[] {
  return (prefs.excluded_file_names ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

export function qbitBlockStatus(prefs: Preferences, version: string | null): ExtensionBlockStatus {
  // The option arrived in qBittorrent 4.6; older versions leave the keys out.
  if (prefs.excluded_file_names_enabled === undefined)
    return { style: 'list', active: false, extensions: [], blocker: 'tooOld', version };
  const extensions = uniqueExtensions(
    excludedPatterns(prefs)
      .map(patternExtension)
      .filter((e): e is string => !!e),
  );
  return {
    style: 'list',
    active: prefs.excluded_file_names_enabled === true && extensions.length > 0,
    extensions,
    version,
  };
}

/** Keeps patterns that are not plain `*.ext` and rebuilds the extension ones. */
export function nextExcludedPatterns(current: string[], remove: string[], wanted: string[]): string[] {
  const drop = new Set(remove);
  const other = current.filter((p) => patternExtension(p) === null);
  const keep = current.map(patternExtension).filter((e): e is string => !!e && !drop.has(e));
  return [...other, ...uniqueExtensions([...keep, ...wanted]).map(extensionPattern)];
}

/** At most this many new torrents get their file list read per run. */
const FILE_READS_PER_RUN = 40;

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
  capabilities: ['health', 'downloads', 'extensionBlock'],
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
      async extensionBlock() {
        const [version, prefs] = await Promise.all([
          get('/api/v2/app/version'),
          get('/api/v2/app/preferences'),
        ]);
        return qbitBlockStatus(JSON.parse(prefs) as Preferences, version.trim());
      },
      async setExtensionBlock(change) {
        const prefs = JSON.parse(await get('/api/v2/app/preferences')) as Preferences;
        if (prefs.excluded_file_names_enabled === undefined)
          throw new AdapterError('unsupported', 'qBittorrent is too old for excluded file names');
        const patterns = nextExcludedPatterns(excludedPatterns(prefs), change.remove, change.extensions);
        await post('/api/v2/app/setPreferences', {
          json: JSON.stringify({
            excluded_file_names_enabled: true,
            excluded_file_names: patterns.join('\n'),
          }),
        });
        const [version, after] = await Promise.all([
          get('/api/v2/app/version'),
          get('/api/v2/app/preferences'),
        ]);
        return qbitBlockStatus(JSON.parse(after) as Preferences, version.trim());
      },
      async blockedDownloads(since) {
        const prefs = JSON.parse(await get('/api/v2/app/preferences')) as Preferences;
        const patterns = prefs.excluded_file_names_enabled
          ? excludedPatterns(prefs).map(wildcardToRegExp)
          : [];
        if (patterns.length === 0) return [];
        const from = Math.floor(Date.parse(since) / 1000);
        const list = (
          JSON.parse(await get('/api/v2/torrents/info', { sort: 'added_on', reverse: 'true' })) as Torrent[]
        )
          .filter((t) => (t.added_on ?? 0) >= from)
          .slice(0, FILE_READS_PER_RUN);
        const out: BlockedDownload[] = [];
        for (const t of list) {
          const files = JSON.parse(await get('/api/v2/torrents/files', { hash: t.hash })) as Array<{
            name: string;
            priority: number;
          }>;
          const hits = files.filter((f) => {
            if (f.priority !== 0) return false;
            const base = f.name.split(/[\\/]/).pop() ?? f.name;
            return patterns.some((re) => re.test(base) || re.test(f.name));
          });
          if (hits.length === 0) continue;
          out.push({
            downloadId: t.hash,
            name: t.name,
            at: new Date((t.added_on ?? 0) * 1000).toISOString(),
            extensions: uniqueExtensions(hits.map((f) => extensionOf(f.name) ?? '')),
            files: hits.map((f) => f.name),
            outcome: 'skipped',
          });
        }
        return out;
      },
      webUrl: () => `${ctx.baseUrl}/`,
    };
  },
});
