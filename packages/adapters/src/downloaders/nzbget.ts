import { AdapterError, defineAdapter, type DownloadJob } from '@wardarr/core';
import { z } from 'zod';
import { passwordField, usernameField } from '../shared/fields.js';
import { ensureOk } from '../shared/http.js';

interface Group {
  NZBID: number;
  NZBName: string;
  Status: string;
  FileSizeMB: number;
  RemainingSizeMB: number;
  Category?: string;
  MinPostTime?: number;
}

function groupState(status: string): DownloadJob['state'] {
  const s = status.toUpperCase();
  if (s === 'DOWNLOADING') return 'downloading';
  if (s === 'PAUSED') return 'paused';
  if (s === 'QUEUED' || s === 'FETCHING') return 'queued';
  if (
    [
      'PP_QUEUED',
      'LOADING_PARS',
      'VERIFYING_SOURCES',
      'REPAIRING',
      'VERIFYING_REPAIRED',
      'RENAMING',
      'UNPACKING',
      'MOVING',
      'EXECUTING_SCRIPT',
      'PP_FINISHED',
    ].includes(s)
  )
    return 'checking';
  return 'unknown';
}

export const nzbget = defineAdapter({
  id: 'nzbget',
  name: 'NZBGet',
  category: 'downloader',
  lifecycle: 'active',
  homepage: 'https://nzbget.com',
  fields: [usernameField(true), passwordField(true)],
  credentials: z.object({ username: z.string().min(1).max(256), password: z.string().min(1).max(1024) }),
  capabilities: ['downloads'],
  create(ctx) {
    const auth = `Basic ${Buffer.from(`${ctx.credentials.username}:${ctx.credentials.password}`).toString('base64')}`;
    let id = 0;
    const rpc = async <T>(method: string, params: unknown[] = []): Promise<T> => {
      const res = ensureOk(
        await ctx.http.request({
          method: 'POST',
          path: '/jsonrpc',
          headers: { authorization: auth },
          json: { method, params, id: ++id },
        }),
      );
      const body = res.json<{ result?: T; error?: { message?: string } }>();
      if (body.error) throw new AdapterError('badResponse', body.error.message ?? 'rpc error');
      return body.result as T;
    };
    return {
      async testConnection() {
        return { version: await rpc<string>('version') };
      },
      async downloads() {
        const [groups, status] = await Promise.all([
          rpc<Group[]>('listgroups', [0]),
          rpc<{ DownloadRate?: number }>('status'),
        ]);
        return groups.map((g): DownloadJob => {
          const state = groupState(g.Status);
          const total = g.FileSizeMB * 1024 * 1024;
          const left = g.RemainingSizeMB * 1024 * 1024;
          return {
            id: String(g.NZBID),
            name: g.NZBName,
            state,
            progress: total > 0 ? (total - left) / total : 0,
            sizeBytes: total,
            downloadedBytes: total - left,
            speedBytesPerSecond: state === 'downloading' ? (status.DownloadRate ?? 0) : 0,
            etaSeconds:
              state === 'downloading' && status.DownloadRate ? Math.round(left / status.DownloadRate) : null,
            category: g.Category || null,
            addedAt: null,
          };
        });
      },
      async removeDownload(jobId, opts) {
        const ok = await rpc<boolean>('editqueue', [
          opts.deleteFiles ? 'GroupFinalDelete' : 'GroupDelete',
          '',
          [Number(jobId)],
        ]);
        if (!ok) throw new AdapterError('badResponse', 'editqueue failed');
      },
      webUrl: () => `${ctx.baseUrl}/`,
    };
  },
});
