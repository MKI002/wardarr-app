import {
  AdapterError,
  defineAdapter,
  type AdapterInstance,
  type IndexerApp,
  type IndexerInfo,
  type IndexerStats,
  type Signal,
} from '@wardarr/core';
import { apiKeyField, apiKeySchema } from '../shared/fields.js';
import { compatSignal, detectApi, detectionCache, type VersionProfile } from '../shared/apiVersion.js';
import { arrLevel, ensureOk, jsonOf, toEntries } from '../shared/http.js';
import { link, stripCredentials } from '../shared/topology.js';

/** Prowlarr v1 and v2 speak API v1. */
export const PROWLARR_PROFILE: VersionProfile = { apis: ['v1'], testedMajors: { min: 1, max: 2 } };

interface IndexerResource {
  id: number;
  name: string;
  enable: boolean;
  protocol?: string;
  [key: string]: unknown;
}

interface ApplicationResource {
  id: number;
  name?: string;
  implementation?: string;
  syncLevel?: string;
  tags?: number[];
  fields?: Array<{ name?: string; value?: unknown }>;
}

interface IndexerStatsResource {
  indexerId?: number;
  indexerName?: string;
  averageResponseTime?: number;
  numberOfQueries?: number;
  numberOfGrabs?: number;
  numberOfFailedQueries?: number;
  numberOfFailedGrabs?: number;
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
    const detection = detectionCache(() => detectApi(ctx, PROWLARR_PROFILE));
    const base = async () => (await detection.get()).apiBase;
    const get = async <T>(path: string) => {
      try {
        return jsonOf<T>(await ctx.http.request({ path: `${await base()}${path}`, headers }));
      } catch (err) {
        if (err instanceof AdapterError && err.kind === 'notFound') detection.reset();
        throw err;
      }
    };

    const instance: AdapterInstance = {
      async testConnection() {
        let d = await detection.get();
        const status = await get<{ version?: string }>('/system/status');
        if (typeof status.version !== 'string') throw new AdapterError('badResponse', 'not a Prowlarr API');
        if (await detection.noteVersion(status.version)) d = await detection.get();
        return { version: status.version, apiVersion: d.api, compatibility: d.compat?.reason };
      },
      async health() {
        const items =
          await get<Array<{ source?: string; type?: string; message?: string; wikiUrl?: string }>>('/health');
        const compat = compatSignal(
          await detection.get(),
          { id: ctx.instanceId, name: ctx.instanceName, adapter: 'prowlarr' },
          'Prowlarr',
        );
        const signals = items.map((h): Signal => ({
          origin: 'service',
          instance: { id: ctx.instanceId, name: ctx.instanceName, adapter: 'prowlarr' },
          kind: 'health',
          source: h.source,
          level: arrLevel(h.type),
          message: h.message ?? '',
          wikiUrl: h.wikiUrl,
        }));
        return compat ? [...signals, compat] : signals;
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
      async indexerStats() {
        const res = await get<{ indexers?: IndexerStatsResource[] }>('/indexerstats');
        return (res.indexers ?? []).map((i): IndexerStats => ({
          indexerId: i.indexerId ?? 0,
          name: i.indexerName ?? '',
          queries: i.numberOfQueries ?? 0,
          grabs: i.numberOfGrabs ?? 0,
          failedQueries: i.numberOfFailedQueries ?? 0,
          failedGrabs: i.numberOfFailedGrabs ?? 0,
          averageResponseMs: typeof i.averageResponseTime === 'number' ? i.averageResponseTime : null,
        }));
      },
      /**
       * Apps Prowlarr syncs to. An app with tags only receives indexers that
       * share a tag; an app without tags receives every enabled indexer.
       */
      async indexerApps() {
        const [apps, indexers] = await Promise.all([
          get<ApplicationResource[]>('/applications'),
          get<Array<IndexerResource & { tags?: number[] }>>('/indexer'),
        ]);
        return apps.map((a): IndexerApp => {
          const tags = a.tags ?? [];
          const baseUrl = a.fields?.find((f) => f.name === 'baseUrl')?.value;
          const enabled = a.syncLevel !== 'disabled';
          return {
            id: a.id,
            name: a.name ?? '',
            implementation: a.implementation ?? '',
            baseUrl: typeof baseUrl === 'string' && baseUrl ? baseUrl : null,
            enabled,
            indexerIds: enabled
              ? indexers
                  .filter(
                    (i) => i.enable && (tags.length === 0 || (i.tags ?? []).some((t) => tags.includes(t))),
                  )
                  .map((i) => i.id)
              : [],
          };
        });
      },
      async testIndexer(indexerId) {
        const resource = await get<IndexerResource>(`/indexer/${indexerId}`);
        const res = await ctx.http.request({
          method: 'POST',
          path: `${await base()}/indexer/test`,
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
      async topology() {
        const apps = await instance.indexerApps!();
        return {
          links: apps.map((a) =>
            link(
              'indexers',
              a.implementation,
              a.name,
              a.baseUrl ? stripCredentials(a.baseUrl) : null,
              a.enabled,
              {
                indexerIds: a.indexerIds,
              },
            ),
          ),
          folders: [],
        };
      },
      webUrl(target) {
        if (target?.kind === 'system') return `${ctx.baseUrl}/system/status`;
        if (target?.kind === 'settings') return `${ctx.baseUrl}/settings`;
        return `${ctx.baseUrl}/`;
      },
    };
    return instance;
  },
});
