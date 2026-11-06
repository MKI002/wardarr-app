import { AdapterError, defineAdapter, type Signal } from '@wardarr/core';
import { apiKeyField, apiKeySchema } from '../shared/fields.js';
import { jsonOf } from '../shared/http.js';

export const bazarr = defineAdapter({
  id: 'bazarr',
  name: 'Bazarr',
  category: 'arr',
  lifecycle: 'active',
  homepage: 'https://www.bazarr.media',
  fields: [apiKeyField],
  credentials: apiKeySchema,
  capabilities: ['health'],
  create(ctx) {
    const headers = { 'X-API-KEY': ctx.credentials.apiKey };
    const get = async <T>(path: string) => jsonOf<T>(await ctx.http.request({ path, headers }));
    return {
      async testConnection() {
        const res = await get<{ data?: { bazarr_version?: string } }>('/api/system/status');
        const version = res.data?.bazarr_version;
        if (typeof version !== 'string') throw new AdapterError('badResponse', 'not a Bazarr API');
        return { version };
      },
      async health() {
        const res = await get<{ data?: Array<{ object?: string; issue?: string }> }>('/api/system/health');
        return (res.data ?? []).map((h): Signal => ({
          origin: 'service',
          instance: { id: ctx.instanceId, name: ctx.instanceName, adapter: 'bazarr' },
          kind: 'health',
          source: h.object,
          level: 'warning',
          message: h.issue ?? '',
        }));
      },
      webUrl(target) {
        return `${ctx.baseUrl}${target?.kind === 'settings' ? '/settings/general' : '/system/status'}`;
      },
    };
  },
});
