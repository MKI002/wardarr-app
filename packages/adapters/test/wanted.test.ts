// Wanted lists longer than one page. All titles are invented.
import { describe, expect, it } from 'vitest';
import { radarr } from '../src/arr/radarr.js';
import { sonarr } from '../src/arr/sonarr.js';
import { createFixtureHttp, type FixtureRoute } from './fixtureHttp.js';

const KEY = '00000000000000000000000000000001';
const headers = { 'X-Api-Key': KEY };

function make(def: typeof sonarr | typeof radarr, appName: string, routes: FixtureRoute[]) {
  const http = createFixtureHttp([
    { path: '/api', headers, json: { current: 'v3', deprecated: [] } },
    { path: '/api/v3/system/status', headers, json: { appName, version: '5.0.0.1' } },
    ...routes,
  ]);
  return def.create({
    instanceId: 'i1',
    instanceName: 'Test',
    baseUrl: 'http://arr.example.test',
    credentials: { apiKey: KEY },
    http,
    log: { debug() {}, warn() {} },
  });
}

const episode = (id: number) => ({
  id,
  title: `Episode ${id}`,
  seriesId: 1,
  seasonNumber: 1,
  episodeNumber: id,
  monitored: true,
  series: { id: 1, title: 'Example Show', tags: [] },
});

describe('wanted lists', () => {
  it('reads every page of a long list and reports each call', async () => {
    const total = 600;
    const pages: FixtureRoute[] = [1, 2, 3].map((page) => ({
      path: '/api/v3/wanted/cutoff',
      headers,
      query: { page: String(page), pageSize: '250' },
      json: {
        totalRecords: total,
        records: Array.from({ length: Math.min(250, total - (page - 1) * 250) }, (_, i) =>
          episode((page - 1) * 250 + i + 1),
        ),
      },
    }));
    const adapter = make(sonarr, 'Sonarr', pages);
    let requests = 0;
    const items = await adapter.wanted!('cutoff', {
      monitoredOnly: true,
      max: 10_000,
      onRequest: () => void requests++,
    });
    expect(items).toHaveLength(600);
    expect(items.at(-1)!.key).toBe('episode:600');
    expect(requests).toBe(3);
  });

  it('stops at the given limit', async () => {
    const adapter = make(sonarr, 'Sonarr', [
      {
        path: '/api/v3/wanted/missing',
        headers,
        query: { page: '1', pageSize: '250' },
        json: { totalRecords: 600, records: Array.from({ length: 250 }, (_, i) => episode(i + 1)) },
      },
    ]);
    let requests = 0;
    const items = await adapter.wanted!('missing', {
      monitoredOnly: true,
      max: 250,
      onRequest: () => void requests++,
    });
    expect(items).toHaveLength(250);
    expect(requests).toBe(1);
  });

  it('keeps every missing movie, whatever the limit', async () => {
    const movies = Array.from({ length: 400 }, (_, i) => ({
      id: i + 1,
      title: `Example Movie ${i + 1}`,
      year: 2000,
      monitored: true,
      hasFile: false,
      isAvailable: true,
      tags: [],
    }));
    const adapter = make(radarr, 'Radarr', [{ path: '/api/v3/movie', headers, json: movies }]);
    let requests = 0;
    const items = await adapter.wanted!('missing', {
      monitoredOnly: true,
      max: 250,
      onRequest: () => void requests++,
    });
    expect(items).toHaveLength(400);
    expect(requests).toBe(1);
  });
});
