import { AdapterError, defineAdapter, type DownloadJob, type Signal } from '@wardarr/core';
import { z } from 'zod';
import { jsonOf } from '../shared/http.js';

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
  queue?: { slots?: QueueSlot[]; kbpersec?: string; paused?: boolean };
  error?: string;
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
  capabilities: ['health', 'downloads'],
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
        const res = await call<{ warnings?: Array<{ text?: string; type?: string } | string> }>('warnings');
        return (res.warnings ?? []).map((w): Signal => {
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
        });
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
      webUrl: () => `${ctx.baseUrl}/`,
    };
  },
});
