import { AdapterError, defineAdapter, type IndexerInfo, type Signal } from '@wardarr/core';
import { apiKeyField, apiKeySchema } from '../shared/fields.js';
import { arrLevel, ensureOk, jsonOf, toEntries } from '../shared/http.js';

interface IndexerResource {
  id: number;
  name: string;
  enable: boolean;
  protocol?: string;
  [key: string]: unknown;
}

interface IndexerStatusResource {
  indexerId: number;
  disabledTill?: string;
  mostRecentFailure?: string;
}

export const prowlarr = defineAdapter({
  id: 'prowlarr',
  name: 'Prowlarr',
  category: 'indexer',
  lifecycle: 'active',
  homepage: 'https://prowlarr.com',
  fields: [apiKeyField],
  credentials: apiKeySchema,
  capabilities: ['health', 'indexers', 'settings'],
  create(ctx) {
    const headers = { 'X-Api-Key': ctx.credentials.apiKey };
    const get = async <T>(path: string) =>
      jsonOf<T>(await ctx.http.request({ path: `/api/v1${path}`, headers }));

    return {
      async testConnection() {
        const status = await get<{ version?: string }>('/system/status');
        if (typeof status.version !== 'string') throw new AdapterError('badResponse', 'not a Prowlarr API');
        return { version: status.version };
      },
      async health() {
        const items =
          await get<Array<{ source?: string; type?: string; message?: string; wikiUrl?: string }>>('/health');
        return items.map((h): Signal => ({
          origin: 'service',
          instance: { id: ctx.instanceId, name: ctx.instanceName, adapter: 'prowlarr' },
          kind: 'health',
          source: h.source,
          level: arrLevel(h.type),
          message: h.message ?? '',
          wikiUrl: h.wikiUrl,
        }));
      },
      async indexers() {
        const [list, status] = await Promise.all([
          get<IndexerResource[]>('/indexer'),
          get<IndexerStatusResource[]>('/indexerstatus'),
        ]);
        const byId = new Map(status.map((s) => [s.indexerId, s]));
        const now = Date.now();
        return list.map((i): IndexerInfo => {
          const st = byId.get(i.id);
          const failing = !!st?.disabledTill && new Date(st.disabledTill).getTime() > now;
          return {
            id: i.id,
            name: i.name,
            enabled: i.enable,
            protocol: i.protocol === 'usenet' || i.protocol === 'torrent' ? i.protocol : 'unknown',
            failing,
            disabledUntil: st?.disabledTill,
            mostRecentFailure: st?.mostRecentFailure,
          };
        });
      },
      async testIndexer(indexerId) {
        const resource = await get<IndexerResource>(`/indexer/${indexerId}`);
        const res = await ctx.http.request({
          method: 'POST',
          path: '/api/v1/indexer/test',
          headers,
          json: resource,
          timeoutMs: 60_000,
        });
        if (res.status >= 200 && res.status < 300) return { ok: true };
        if (res.status === 400) {
          const body = res.json<Array<{ errorMessage?: string }>>();
          return { ok: false, message: body[0]?.errorMessage };
        }
        ensureOk(res);
        return { ok: false };
      },
      async settings() {
        return [{ id: 'host', entries: toEntries(await get<Record<string, unknown>>('/config/host')) }];
      },
      webUrl(target) {
        if (target?.kind === 'system') return `${ctx.baseUrl}/system/status`;
        if (target?.kind === 'settings') return `${ctx.baseUrl}/settings`;
        return `${ctx.baseUrl}/`;
      },
    };
  },
});
