// Indexer insights through the API: source detection, stored statistics,
// outages, grab history and the "worth a look" notes. All data is invented.
import { defineAdapter, type ArrIndexerInfo, type HistoryEvent, type IndexerInfo } from '@wardarr/core';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { authHeaders, createTestApp, FAKE_KEY, setupAdmin } from './helpers.js';

const base = {
  lifecycle: 'active' as const,
  homepage: 'https://example.com',
  fields: [{ key: 'apiKey', kind: 'secret' as const, label: 'fields.apiKey', required: true }],
  credentials: z.object({ apiKey: z.string().min(1) }),
};

const prowlarrIndexers: IndexerInfo[] = [
  {
    id: 1,
    name: 'Lantern',
    enabled: true,
    protocol: 'torrent',
    failing: false,
    urls: ['https://lantern.example.test'],
  },
  {
    id: 2,
    name: 'Nightjar',
    enabled: true,
    protocol: 'torrent',
    failing: true,
    mostRecentFailure: new Date(Date.now() - 3_600_000).toISOString(),
  },
];
const windows: string[] = [];

const fakeProwlarr = defineAdapter({
  ...base,
  id: 'insightprowlarr',
  name: 'Insight Prowlarr',
  category: 'indexer',
  capabilities: ['indexers'],
  create() {
    return {
      testConnection: async () => ({ version: '2.0.0' }),
      indexers: async () => prowlarrIndexers,
      indexerApps: async () => [
        {
          id: 1,
          name: 'Sonarr',
          // Prowlarr names the app type; it matches the adapter id of the arr side.
          implementation: 'InsightSonarr',
          baseUrl: 'http://sonarr.example.test:8989',
          prowlarrUrl: 'http://prowlarr:9696',
          enabled: true,
          syncLevel: 'fullSync' as const,
          indexerIds: [1, 2],
        },
      ],
      indexerStatsWindow: async (start: string, end: string) => {
        windows.push(start);
        const hours = (Date.parse(end) - Date.parse(start)) / 3_600_000;
        return {
          indexers: [
            {
              indexerId: 1,
              name: 'Lantern',
              queries: 10 * hours,
              grabs: hours,
              failedQueries: 0,
              failedGrabs: 0,
              averageResponseMs: 300,
              rssQueries: 4 * hours,
            },
            {
              indexerId: 2,
              name: 'Nightjar',
              queries: 5 * hours,
              grabs: 0,
              failedQueries: 4 * hours,
              failedGrabs: 0,
              averageResponseMs: 4000,
              rssQueries: 0,
            },
          ],
          userAgents: [{ agent: 'Sonarr/4.0.15.2941', queries: 15 * hours, grabs: hours }],
        };
      },
    };
  },
});

const arrIx = (id: number, name: string, baseUrl: string): ArrIndexerInfo => ({
  id,
  name,
  implementation: 'Torznab',
  protocol: 'torrent',
  baseUrl,
  enableRss: true,
  enableAutomaticSearch: true,
  enableInteractiveSearch: true,
  priority: 25,
  tags: [],
});
const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const history: HistoryEvent[] = [
  {
    at: ago(30),
    type: 'grabbed',
    mediaId: 1,
    downloadId: 'A',
    indexer: 'Lantern (Prowlarr)',
    sizeBytes: 1000,
  },
  { at: ago(29), type: 'imported', mediaId: 1, downloadId: 'A' },
  { at: ago(20), type: 'grabbed', mediaId: 2, downloadId: 'B', indexer: 'Lantern (Prowlarr)' },
  { at: ago(19), type: 'failed', mediaId: 2, downloadId: 'B' },
  { at: ago(10), type: 'grabbed', mediaId: 3, downloadId: 'C', indexer: 'Lantern' },
  { at: ago(9), type: 'imported', mediaId: 3, downloadId: 'C' },
  { at: ago(9), type: 'imported', mediaId: 3, downloadId: 'C' },
];

const fakeSonarr = defineAdapter({
  ...base,
  id: 'insightsonarr',
  name: 'Insight Sonarr',
  category: 'arr',
  capabilities: ['search', 'history'],
  create() {
    return {
      testConnection: async () => ({ version: '4.0.0' }),
      arrIndexers: async () => [
        arrIx(10, 'Lantern (Prowlarr)', 'http://prowlarr:9696/1/'),
        arrIx(11, 'Nightjar (Prowlarr)', 'http://prowlarr:9696/2/'),
        // The same site again, added by hand.
        arrIx(12, 'Lantern', 'https://lantern.example.test/api'),
      ],
      historySince: async () => history,
      webUrl: () => 'http://sonarr.example.test:8989/settings/indexers',
    };
  },
});

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: Record<string, string>;
const ids: Record<string, string> = {};

async function addInstance(adapter: string, name: string, baseUrl: string) {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/instances',
    headers: admin,
    payload: { adapter, name, baseUrl, fields: { apiKey: FAKE_KEY } },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

beforeAll(async () => {
  t = await createTestApp({ adapters: [fakeProwlarr, fakeSonarr] });
  admin = await setupAdmin(t);
  ids.prowlarr = await addInstance('insightprowlarr', 'Prowlarr', 'http://prowlarr.example.test:9696');
  ids.sonarr = await addInstance('insightsonarr', 'Sonarr', 'http://sonarr.example.test:8989');
  await t.runtime.pollMany(Object.values(ids));
});
afterAll(async () => t.close());

const get = (url: string) => t.app.inject({ method: 'GET', url, headers: admin });

describe('indexer insights', () => {
  it('shows the tab to admins', async () => {
    expect((await get('/api/capabilities')).json().tabs).toContain('indexerInsights');
  });

  it('answers before anything was read and reads the sources in the background', async () => {
    const r = (await get('/api/indexer-insights?range=7d')).json();
    expect(r.collection.sourcesPending).toBe(true);
    expect(r.apps).toEqual([]);
    expect(r.prowlarrs.map((p: { instanceName: string }) => p.instanceName)).toEqual(['Prowlarr']);
    const snap = await t.indexerInsights.refreshSources();
    expect(snap.analysis.arrs).toHaveLength(1);
    expect((await get('/api/indexer-insights?range=7d')).json().collection.sourcesPending).toBe(false);
  });

  it('backfills 30 days of Prowlarr statistics, per day first and per hour for the last week', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/indexer-insights/collect', headers: admin });
    expect(res.statusCode).toBe(200);
    expect(windows.length).toBeGreaterThan(7 * 24 + 23);
    const rows = t.indexerInsights['db'].all<{ m: number; n: number }>(
      sql`SELECT bucket_minutes AS m, count(*) AS n FROM indexer_stat_buckets GROUP BY bucket_minutes ORDER BY m`,
    );
    expect(rows.map((r) => r.m)).toEqual([60, 1440]);
  });

  it('detects synced, direct and duplicate indexers per app', async () => {
    const r = (await get('/api/indexer-insights?range=7d&tz=Europe/Berlin')).json();
    const app = r.apps[0];
    expect(app).toMatchObject({ instanceName: 'Sonarr', mode: 'mixed' });
    expect(app.prowlarrApp).toMatchObject({ appName: 'Sonarr', syncLevel: 'fullSync' });
    expect(app.indexers.map((i: { name: string; source: string }) => [i.name, i.source])).toEqual([
      ['Lantern (Prowlarr)', 'prowlarr'],
      ['Nightjar (Prowlarr)', 'prowlarr'],
      ['Lantern', 'direct'],
    ]);
    expect(app.counts).toMatchObject({ synced: 2, direct: 1, duplicate: 2 });
    expect(app.history).toHaveLength(1);
    // Nothing that could identify a host leaves the server.
    expect(JSON.stringify(r)).not.toContain('example.test:9696/1');
  });

  it('compares indexers with stored numbers, outages and grab results', async () => {
    const r = (await get('/api/indexer-insights?range=24h')).json();
    expect(r.points).toHaveLength(24);
    const lantern = r.trackers.find((x: { name: string }) => x.name === 'Lantern');
    const nightjar = r.trackers.find((x: { name: string }) => x.name === 'Nightjar');
    expect(lantern.metrics.queries).toBe(240);
    expect(lantern.metrics.successRate).toBe(1);
    expect(lantern.metrics.averageResponseMs).toBe(300);
    // B failed, C imported; A is older than 24 hours.
    expect(lantern.metrics).toMatchObject({ arrGrabs: 2, imported: 1, failedDownloads: 1, importRate: null });
    // Grabs from both copies of the site count for it.
    const week = (await get('/api/indexer-insights?range=7d')).json();
    const lanternWeek = week.trackers.find((x: { name: string }) => x.name === 'Lantern');
    expect(lanternWeek.metrics).toMatchObject({
      arrGrabs: 3,
      imported: 2,
      failedDownloads: 1,
      medianImportMinutes: 60,
    });
    expect(lanternWeek.metrics.importRate).toBeCloseTo(2 / 3);
    expect(lantern.apps).toEqual([{ instanceId: ids.sonarr, state: 'both' }]);
    expect(nightjar.failing).toBe(true);
    expect(nightjar.metrics.successRate).toBeCloseTo(0.2);
    expect(nightjar.metrics.uptime).toBeLessThan(1);
    expect(nightjar.downtime).toHaveLength(1);
    expect(lantern.metrics.score).toBeGreaterThan(nightjar.metrics.score);
    expect(r.totals.series.queries.reduce((a: number, b: number) => a + b, 0)).toBe(360);
    expect(r.callers).toEqual([{ name: 'Sonarr', queries: 360, grabs: 24 }]);
    expect(r.heatmap.values.flat().reduce((a: number, b: number) => a + b, 0)).toBeGreaterThan(0);
    const kinds = r.insights.map((i: { kind: string }) => i.kind);
    expect(kinds[0]).toBe('failing');
    expect(kinds).toEqual(expect.arrayContaining(['duplicate', 'highFailRate', 'slow', 'mixed']));
  });

  it('starts an update without waiting for it', async () => {
    const r = (await get('/api/indexer-insights?range=7d&refresh=1')).json();
    expect(r.collection.running).toBe(true);
    await t.indexerInsights.collect();
    expect((await get('/api/indexer-insights?range=7d')).json().collection.running).toBe(false);
  });

  it('reads again without counting twice', async () => {
    await t.indexerInsights.collect();
    const r = (await get('/api/indexer-insights?range=24h')).json();
    const lantern = r.trackers.find((x: { name: string }) => x.name === 'Lantern');
    expect(lantern.metrics.queries).toBe(240);
    expect(lantern.metrics.arrGrabs).toBe(2);
  });

  it('folds old hourly rows into days', async () => {
    const db = t.indexerInsights['db'];
    const old = new Date(Date.now() - 60 * 86_400_000);
    old.setUTCHours(0, 0, 0, 0);
    for (const h of [1, 2]) {
      const at = new Date(old.getTime() + h * 3_600_000).toISOString();
      db.run(sql`INSERT INTO indexer_stat_buckets (instance_id, indexer_id, indexer_name, bucket_start, bucket_minutes, queries, grabs, avg_response_ms)
        VALUES (${ids.prowlarr}, 1, 'Lantern', ${at}, 60, ${h * 10}, 1, ${h * 100})`);
    }
    t.indexerInsights.maintain();
    const rows = db.all<{ bucket_minutes: number; queries: number; avg_response_ms: number }>(
      sql`SELECT bucket_minutes, queries, avg_response_ms FROM indexer_stat_buckets WHERE bucket_start = ${old.toISOString()}`,
    );
    expect(rows).toEqual([
      { bucket_minutes: 1440, queries: 30, avg_response_ms: (10 * 100 + 20 * 200) / 30 },
    ]);
  });

  it('rejects bad input and non-admins', async () => {
    expect((await get('/api/indexer-insights?range=1y')).statusCode).toBe(400);
    expect((await get('/api/indexer-insights?tz=../../etc')).statusCode).toBe(400);
    await t.app.inject({
      method: 'POST',
      url: '/api/users',
      headers: admin,
      payload: { username: 'viewer', password: 'viewer-password-1', role: 'user' },
    });
    const login = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-wardarr-request': '1' },
      payload: { username: 'viewer', password: 'viewer-password-1' },
    });
    const viewer = authHeaders(login);
    expect(
      (await t.app.inject({ method: 'GET', url: '/api/indexer-insights', headers: viewer })).statusCode,
    ).toBe(403);
  });
});
