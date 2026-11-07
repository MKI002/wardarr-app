// The indexer priority watchdog through the API: off by default, preview
// first, writes only what changes, and logs every write. All data is invented.
import { defineAdapter, type ArrIndexerInfo, type IndexerInfo } from '@wardarr/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createTestApp, FAKE_KEY, setupAdmin } from './helpers.js';

const base = {
  lifecycle: 'active' as const,
  homepage: 'https://example.com',
  fields: [{ key: 'apiKey', kind: 'secret' as const, label: 'fields.apiKey', required: true }],
  credentials: z.object({ apiKey: z.string().min(1) }),
};

const prowlarrIndexers: IndexerInfo[] = [
  { id: 1, name: 'Lantern', enabled: true, protocol: 'torrent', failing: false, priority: 25 },
  { id: 2, name: 'Nightjar', enabled: true, protocol: 'torrent', failing: false, priority: 25 },
];
const prowlarrWrites: Array<[number, number]> = [];

const fakeProwlarr = defineAdapter({
  ...base,
  id: 'prioprowlarr',
  name: 'Priority Prowlarr',
  category: 'indexer',
  capabilities: ['indexers'],
  create() {
    return {
      testConnection: async () => ({ version: '2.0.0' }),
      indexers: async () => prowlarrIndexers.map((i) => ({ ...i })),
      indexerApps: async () => [
        {
          id: 1,
          name: 'Sonarr',
          implementation: 'PrioSonarr',
          baseUrl: 'http://sonarr.example.test:8989',
          prowlarrUrl: 'http://prowlarr:9696',
          enabled: true,
          // Prowlarr only adds and removes: priorities have to be set in Sonarr.
          syncLevel: 'addOnly' as const,
          indexerIds: [1, 2],
        },
      ],
      indexerStatsWindow: async (start: string, end: string) => {
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
            },
            {
              indexerId: 2,
              name: 'Nightjar',
              queries: 10 * hours,
              grabs: hours,
              failedQueries: 6 * hours,
              failedGrabs: 0,
              averageResponseMs: 4000,
            },
          ],
          userAgents: [],
        };
      },
      setIndexerPriority: async (id: number, priority: number) => {
        prowlarrWrites.push([id, priority]);
        const ix = prowlarrIndexers.find((i) => i.id === id)!;
        ix.priority = priority;
      },
    };
  },
});

const arrIx = (id: number, name: string, baseUrl: string, priority: number): ArrIndexerInfo => ({
  id,
  name,
  implementation: 'Torznab',
  protocol: 'torrent',
  baseUrl,
  enableRss: true,
  enableAutomaticSearch: true,
  enableInteractiveSearch: true,
  priority,
  tags: [],
});
const sonarrIndexers = [
  arrIx(10, 'Lantern (Prowlarr)', 'http://prowlarr:9696/1/', 25),
  arrIx(11, 'Nightjar (Prowlarr)', 'http://prowlarr:9696/2/', 25),
];
let sonarrFails = false;

const fakeSonarr = defineAdapter({
  ...base,
  id: 'priosonarr',
  name: 'Priority Sonarr',
  category: 'arr',
  capabilities: ['search', 'history'],
  create() {
    return {
      testConnection: async () => ({ version: '4.0.0' }),
      arrIndexers: async () => sonarrIndexers.map((i) => ({ ...i })),
      historySince: async () => [],
      setIndexerPriority: async (id: number, priority: number) => {
        if (sonarrFails) throw new Error('boom');
        sonarrIndexers.find((i) => i.id === id)!.priority = priority;
      },
    };
  },
});

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: Record<string, string>;

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
  const ids = [
    await addInstance('prioprowlarr', 'Prowlarr', 'http://prowlarr.example.test:9696'),
    await addInstance('priosonarr', 'Sonarr', 'http://sonarr.example.test:8989'),
  ];
  await t.runtime.pollMany(ids);
  await t.app.inject({ method: 'POST', url: '/api/indexer-insights/collect', headers: admin });
});
afterAll(async () => t.close());

const url = '/api/indexer-insights/priorities';
const view = async () => (await t.app.inject({ method: 'GET', url, headers: admin })).json();
const put = (payload: Record<string, unknown>) =>
  t.app.inject({ method: 'PUT', url, headers: admin, payload });
const run = async () => (await t.app.inject({ method: 'POST', url: `${url}/run`, headers: admin })).json();

type Item = { target: string; indexerName: string; current: number; planned: number; reason: string };
const item = (items: Item[], target: string, name: string) =>
  items.find((i) => i.target === target && i.indexerName === name)!;

describe('indexer priority watchdog', () => {
  it('is off and in preview mode until an admin changes it', async () => {
    const v = await view();
    expect(v.config).toMatchObject({ enabled: false, mode: 'preview', best: 10, worst: 40, step: 5 });
    expect(v.nextRunAt).toBeNull();
    expect(v.available).toBe(true);
    expect(v.apps).toEqual([
      expect.objectContaining({ instanceName: 'Sonarr', syncLevel: 'addOnly', prowlarrName: 'Prowlarr' }),
    ]);
    expect(item(v.items, 'prowlarr', 'Lantern')).toMatchObject({
      current: 25,
      planned: 10,
      reason: 'change',
    });
    expect(item(v.items, 'prowlarr', 'Nightjar')).toMatchObject({ planned: 40, reason: 'change' });
    expect(item(v.items, 'app', 'Lantern (Prowlarr)').reason).toBe('appsOff');
  });

  it('only records what it would change in preview mode', async () => {
    const res = await run();
    expect(res.run).toMatchObject({ mode: 'preview', changed: 2, failed: 0 });
    expect(prowlarrWrites).toEqual([]);
    expect(res.view.log).toHaveLength(2);
    expect(res.view.log[0]).toMatchObject({ preview: true, from: 25, error: null });
  });

  it('writes the planned priorities to Prowlarr, and nothing when they already match', async () => {
    const saved = await put({ enabled: true, mode: 'apply' });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().nextRunAt).not.toBeNull();
    const first = await run();
    expect(first.run).toMatchObject({ mode: 'apply', changed: 2, failed: 0 });
    expect(prowlarrWrites.sort()).toEqual([
      [1, 10],
      [2, 40],
    ]);
    expect(item(first.view.items, 'prowlarr', 'Lantern')).toMatchObject({ current: 10, reason: 'same' });
    const again = await run();
    expect(again.run.changed).toBe(0);
    expect(prowlarrWrites).toHaveLength(2);
  });

  it('sets priorities in apps Prowlarr does not keep in sync when asked to, and logs failures', async () => {
    await put({ includeApps: true });
    sonarrFails = true;
    const failed = await run();
    expect(failed.run).toMatchObject({ changed: 0, failed: 2 });
    expect(failed.view.log[0]).toMatchObject({ target: 'app', preview: false, error: 'badResponse' });
    sonarrFails = false;
    const ok = await run();
    expect(ok.run).toMatchObject({ changed: 2, failed: 0 });
    expect(sonarrIndexers.map((i) => i.priority)).toEqual([10, 40]);
  });

  it('runs once a day on its own', async () => {
    const watchdog = t.indexerPriorities;
    const before = (await view()).lastRun.at;
    await watchdog.tick();
    expect((await view()).lastRun.at).toBe(before);
  });

  it('rejects settings outside what the apps accept', async () => {
    expect((await put({ best: 0 })).statusCode).toBe(400);
    expect((await put({ mode: 'yolo' })).statusCode).toBe(400);
  });
});
