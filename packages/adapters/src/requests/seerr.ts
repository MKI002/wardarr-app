// Seerr, the request manager that succeeds Overseerr and Jellyseerr.
import { AdapterError, defineAdapter, type Signal } from '@wardarr/core';
import { z } from 'zod';
import { jsonOf } from '../shared/http.js';

interface StatusResponse {
  version?: string;
  commitTag?: string;
  updateAvailable?: boolean;
  commitsBehind?: number;
}

export const seerr = defineAdapter({
  id: 'seerr',
  name: 'Seerr',
  category: 'requests',
  lifecycle: 'active',
  homepage: 'https://seerr.dev',
  fields: [
    {
      key: 'apiKey',
      kind: 'secret',
      label: 'adapters.fields.apiKey',
      help: 'adapters.help.apiKeySeerr',
      required: true,
    },
  ],
  credentials: z.object({ apiKey: z.string().trim().min(1).max(256) }),
  capabilities: ['health'],
  create(ctx) {
    const headers = { 'X-Api-Key': ctx.credentials.apiKey };
    const get = async <T>(path: string) =>
      jsonOf<T>(await ctx.http.request({ path: `/api/v1${path}`, headers }));
    return {
      async testConnection() {
        // /status is public in Seerr; /auth/me proves the API key works.
        const status = await get<StatusResponse>('/status');
        if (typeof status.version !== 'string') throw new AdapterError('badResponse', 'not a Seerr API');
        await get<{ id?: number }>('/auth/me');
        return { version: status.version };
      },
      async health() {
        const status = await get<StatusResponse>('/status');
        if (!status.updateAvailable) return [];
        return [
          {
            origin: 'service',
            instance: { id: ctx.instanceId, name: ctx.instanceName, adapter: 'seerr' },
            kind: 'update',
            source: 'Status',
            level: 'info',
            message: 'Update available',
            data: { version: '' },
          } satisfies Signal,
        ];
      },
      webUrl(target) {
        return `${ctx.baseUrl}${target?.kind === 'settings' ? '/settings' : target?.kind === 'system' ? '/settings/about' : '/'}`;
      },
    };
  },
});
