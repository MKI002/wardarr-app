import { AdapterError, defineAdapter, type Signal } from '@wardarr/core';
import { apiKeyField, apiKeySchema } from '../shared/fields.js';
import { jsonOf } from '../shared/http.js';
import { addressOf, link, part } from '../shared/topology.js';

interface BazarrSettings {
  general?: { use_sonarr?: boolean; use_radarr?: boolean };
  sonarr?: { ip?: string; port?: number; base_url?: string; ssl?: boolean };
  radarr?: { ip?: string; port?: number; base_url?: string; ssl?: boolean };
}

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
      async topology() {
        const settings = await part(() => get<BazarrSettings>('/api/system/settings'), {});
        const links = (['sonarr', 'radarr'] as const).flatMap((type) => {
          const s = settings[type];
          const enabled = settings.general?.[`use_${type}`] === true;
          if (!s || !enabled) return [];
          const url = addressOf({ host: s.ip, port: s.port, ssl: s.ssl, base: s.base_url });
          return [link('subtitles', type, type === 'sonarr' ? 'Sonarr' : 'Radarr', url, true)];
        });
        return { links, folders: [] };
      },
      webUrl(target) {
        return `${ctx.baseUrl}${target?.kind === 'settings' ? '/settings/general' : '/system/status'}`;
      },
    };
  },
});
