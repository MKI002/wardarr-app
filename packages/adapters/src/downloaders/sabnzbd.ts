import {
  AdapterError,
  defineAdapter,
  uniqueExtensions,
  type BlockedDownload,
  type BlockedFileHint,
  type DownloadJob,
  type ExtensionBlockStatus,
  type Signal,
} from '@wardarr/core';
import { z } from 'zod';
import { folder, part } from '../shared/topology.js';
import { jsonOf } from '../shared/http.js';
import { downloaderSignal } from './health.js';

interface QueueSlot {
  nzo_id: string;
  filename: string;
  status: string;
  percentage: string;
  mb: string;
  mbleft: string;
  timeleft?: string;
  cat?: string;
}

interface QueueResponse {
  queue?: { slots?: QueueSlot[]; kbpersec?: string; paused?: boolean; pause_int?: string };
  error?: string;
}

interface MiscConfig {
  complete_dir?: string;
  download_dir?: string;
  unwanted_extensions?: string[] | string;
  action_on_unwanted_extensions?: number | string;
  unwanted_extensions_mode?: number | string;
}

interface HistorySlot {
  nzo_id?: string;
  name?: string;
  status?: string;
  fail_message?: string;
  completed?: number;
}

type SabWarning = { text?: string; type?: string; time?: number; origin?: string } | string;

const BLOCK_WARNING = /^In "(.+)" unwanted extension in RAR file\. Unwanted file is (.+?)\s*$/s;

/**
 * SABnzbd names the file it blocked only in a warning ("In "<job>" unwanted
 * extension in RAR file. Unwanted file is <file>"), never in the history. The
 * warnings list keeps the last 20 entries in memory. Newer versions send
 * objects with the source line in `origin`, which also finds the translated
 * wording; older ones send "time\nLEVEL\ntext" strings.
 */
export function sabBlockedFiles(warnings: SabWarning[] | undefined): BlockedFileHint[] {
  const out: BlockedFileHint[] = [];
  for (const w of warnings ?? []) {
    const parts = typeof w === 'string' ? w.split('\n') : null;
    const text = (typeof w === 'string' ? parts!.slice(2).join('\n') || w : (w.text ?? '')).trim();
    const time = typeof w === 'string' ? Date.parse(parts![0] ?? '') : (w.time ?? 0) * 1000;
    const at = Number.isFinite(time) && time > 0 ? new Date(time).toISOString() : new Date().toISOString();
    let name: string | undefined;
    let file: string | undefined;
    const english = BLOCK_WARNING.exec(text);
    if (english) [, name, file] = english;
    else if (typeof w !== 'string' && /^assembler\.py/.test(w.origin ?? '')) {
      // Translated wording: the job comes first in quotes, the file last.
      const quoted = [...text.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
      name = quoted[0];
      const rest = name ? text.slice(text.indexOf(`"${name}"`) + name.length + 2) : '';
      file = quoted.length > 1 ? quoted[quoted.length - 1] : rest.trim().split(/\s+/).pop();
    }
    file = file?.trim().replace(/^"|"$/g, '');
    if (!name || !file || !/\.[^./\\]+$/.test(file)) continue;
    out.push({ name, file: file.slice(0, 300), at });
  }
  return out;
}

/** SABnzbd's list comes as an array or as "exe, com" depending on the version. */
export function sabList(v: unknown): string[] {
  if (Array.isArray(v)) return uniqueExtensions(v.map(String));
  if (typeof v === 'string') return uniqueExtensions(v.split(/[\s,]+/));
  return [];
}

const SAB_ACTION = { 0: 'off', 1: 'pause', 2: 'abort' } as const;

export function sabBlockStatus(misc: MiscConfig, version: string | null): ExtensionBlockStatus {
  const action = SAB_ACTION[Number(misc.action_on_unwanted_extensions ?? 0) as 0 | 1 | 2] ?? 'off';
  const extensions = sabList(misc.unwanted_extensions);
  // Mode 1 turns the list into the files that are allowed.
  const whitelist = Number(misc.unwanted_extensions_mode ?? 0) === 1;
  return {
    style: 'list',
    active: action !== 'off' && extensions.length > 0 && !whitelist,
    extensions: whitelist ? [] : extensions,
    action,
    version,
    ...(whitelist ? { blocker: 'whitelist' as const } : {}),
  };
}

function parseTimeLeft(s: string | undefined): number | null {
  if (!s) return null;
  const parts = s.split(':').map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function slotState(status: string): DownloadJob['state'] {
  switch (status.toLowerCase()) {
    case 'downloading':
    case 'fetching':
      return 'downloading';
    case 'paused':
      return 'paused';
    case 'queued':
    case 'grabbing':
      return 'queued';
    case 'checking':
    case 'verifying':
    case 'repairing':
    case 'extracting':
      return 'checking';
    case 'failed':
      return 'failed';
    default:
      return 'unknown';
  }
}

export const sabnzbd = defineAdapter({
  id: 'sabnzbd',
  name: 'SABnzbd',
  category: 'downloader',
  lifecycle: 'active',
  homepage: 'https://sabnzbd.org',
  fields: [
    {
      key: 'apiKey',
      kind: 'secret',
      label: 'adapters.fields.apiKey',
      help: 'adapters.help.apiKeySabnzbd',
      required: true,
    },
  ],
  credentials: z.object({ apiKey: z.string().trim().min(1).max(256) }),
  capabilities: ['health', 'downloads', 'extensionBlock'],
  create(ctx) {
    const call = async <T>(mode: string, extra: Record<string, string> = {}) => {
      const res = jsonOf<T & { error?: string; status?: boolean }>(
        await ctx.http.request({
          path: '/api',
          query: { mode, output: 'json', apikey: ctx.credentials.apiKey, ...extra },
        }),
      );
      if (typeof res.error === 'string' && /api key/i.test(res.error))
        throw new AdapterError('unauthorized', 'API key rejected');
      return res;
    };
    return {
      async testConnection() {
        // `version` works without a key, so the queue call checks the key too.
        const v = await call<{ version?: string }>('version');
        await call<QueueResponse>('queue', { limit: '1' });
        return { version: v.version ?? null };
      },
      async health() {
        const [res, queue] = await Promise.all([
          call<{ warnings?: Array<{ text?: string; type?: string } | string> }>('warnings'),
          call<QueueResponse>('queue', { limit: '1' }),
        ]);
        const signals: Signal[] = [];
        // A timed pause ends on its own; only an open-ended pause is worth a note.
        // pause_int is "0" without a timer, otherwise the time left ("4:59").
        const pauseInt = String(queue.queue?.pause_int ?? '0').trim();
        const timed = pauseInt !== '' && pauseInt !== '0';
        if (queue.queue?.paused === true && !timed)
          signals.push(downloaderSignal(ctx, 'sabnzbd', 'paused', 'info', 'SABnzbd is paused'));
        return [
          ...signals,
          ...(res.warnings ?? []).map((w): Signal => {
            const text = typeof w === 'string' ? w : (w.text ?? '');
            const type = typeof w === 'string' ? 'WARNING' : (w.type ?? 'WARNING');
            return {
              origin: 'service',
              instance: { id: ctx.instanceId, name: ctx.instanceName, adapter: 'sabnzbd' },
              kind: 'health',
              source: 'Warnings',
              level: type.toUpperCase() === 'ERROR' ? 'error' : 'warning',
              message: text,
            };
          }),
        ];
      },
      async downloads() {
        const res = await call<QueueResponse>('queue');
        const speed = Number(res.queue?.kbpersec ?? 0) * 1024;
        const slots = res.queue?.slots ?? [];
        return slots.map((s, i): DownloadJob => {
          const total = Number(s.mb) * 1024 * 1024;
          const left = Number(s.mbleft) * 1024 * 1024;
          const state = slotState(s.status);
          return {
            id: s.nzo_id,
            name: s.filename,
            state,
            progress: Math.min(1, Number(s.percentage) / 100),
            sizeBytes: Number.isFinite(total) ? total : null,
            downloadedBytes: Number.isFinite(total - left) ? total - left : null,
            speedBytesPerSecond: state === 'downloading' && i === 0 ? speed : 0,
            etaSeconds: parseTimeLeft(s.timeleft),
            category: s.cat ?? null,
            addedAt: null,
          };
        });
      },
      async removeDownload(jobId, opts) {
        await call('queue', { name: 'delete', value: jobId, del_files: opts.deleteFiles ? '1' : '0' });
      },
      async topology() {
        const [queue, config] = await Promise.all([
          part(() => call<{ queue?: Record<string, unknown> }>('queue', { limit: '1' }), {}),
          part(
            () =>
              call<{ config?: { misc?: MiscConfig } }>('get_config', {
                section: 'misc',
              }),
            {},
          ),
        ]);
        // Space figures come in GB as strings: 1 is the incomplete, 2 the complete folder.
        const gb = (v: unknown) => {
          const n = Number(v);
          return v !== undefined && v !== '' && Number.isFinite(n) ? Math.round(n * 1024 ** 3) : undefined;
        };
        const q = queue.queue ?? {};
        const misc = config.config?.misc ?? {};
        const folders = [];
        if (misc.complete_dir)
          folders.push(
            folder(misc.complete_dir, 'downloads', { free: gb(q.diskspace2), total: gb(q.diskspacetotal2) }),
          );
        if (misc.download_dir && misc.download_dir !== misc.complete_dir)
          folders.push(
            folder(misc.download_dir, 'downloads', { free: gb(q.diskspace1), total: gb(q.diskspacetotal1) }),
          );
        return { links: [], folders };
      },
      async extensionBlock() {
        const [v, config] = await Promise.all([
          call<{ version?: string }>('version'),
          call<{ config?: { misc?: MiscConfig } }>('get_config', { section: 'misc' }),
        ]);
        return sabBlockStatus(config.config?.misc ?? {}, v.version ?? null);
      },
      async setExtensionBlock(change) {
        const read = async () =>
          (await call<{ config?: { misc?: MiscConfig } }>('get_config', { section: 'misc' })).config?.misc ??
          {};
        const misc = await read();
        if (Number(misc.unwanted_extensions_mode ?? 0) === 1)
          throw new AdapterError('unsupported', 'SABnzbd uses the list as a whitelist');
        const remove = new Set(change.remove);
        const next = uniqueExtensions([
          ...sabList(misc.unwanted_extensions).filter((e) => !remove.has(e)),
          ...change.extensions,
        ]);
        await call('set_config', { section: 'misc', keyword: 'unwanted_extensions', value: next.join(',') });
        const action = change.action === 'pause' ? '1' : '2';
        if (String(misc.action_on_unwanted_extensions ?? '0') !== action)
          await call('set_config', {
            section: 'misc',
            keyword: 'action_on_unwanted_extensions',
            value: action,
          });
        const v = await call<{ version?: string }>('version');
        return sabBlockStatus(await read(), v.version ?? null);
      },
      async blockedDownloads(since) {
        const res = await call<{ history?: { slots?: HistorySlot[] } }>('history', {
          failed_only: '1',
          limit: '200',
        });
        const from = Date.parse(since);
        return (res.history?.slots ?? [])
          .filter((h) => h.nzo_id && /unwanted extension/i.test(h.fail_message ?? ''))
          .map((h): BlockedDownload => ({
            downloadId: h.nzo_id!,
            name: h.name ?? h.nzo_id!,
            at: new Date((h.completed ?? 0) * 1000).toISOString(),
            // SABnzbd does not say which file it found.
            extensions: [],
            outcome: 'aborted',
          }))
          .filter((b) => Date.parse(b.at) >= from);
      },
      async blockedFiles() {
        const res = await call<{ warnings?: SabWarning[] }>('warnings');
        return sabBlockedFiles(res.warnings);
      },
      webUrl: () => `${ctx.baseUrl}/`,
    };
  },
});
