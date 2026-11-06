// Version detection of *arr APIs. All data is invented.
import { describe, expect, it } from 'vitest';
import { sonarr } from '../src/arr/sonarr.js';
import { whisparr } from '../src/arr/whisparr.js';
import { createFixtureHttp, type FixtureRoute } from './fixtureHttp.js';

const KEY = '00000000000000000000000000000001';
const headers = { 'X-Api-Key': KEY };

function make(def: typeof sonarr | typeof whisparr, routes: FixtureRoute[]) {
  const http = createFixtureHttp(routes);
  const adapter = def.create({
    instanceId: 'i1',
    instanceName: 'Test',
    baseUrl: 'http://arr.example.test',
    credentials: { apiKey: KEY },
    http,
    log: { debug() {}, warn() {} },
  });
  return { adapter, http };
}

const status = (version: string, api = 'v3'): FixtureRoute => ({
  path: `/api/${api}/system/status`,
  headers,
  json: { appName: 'Sonarr', version },
});

describe('API version detection', () => {
  it('uses the API version the product offers', async () => {
    const { adapter } = make(sonarr, [
      { path: '/api', headers, json: { current: 'v3', deprecated: [] } },
      status('4.0.15.2941'),
    ]);
    expect(await adapter.testConnection()).toMatchObject({
      version: '4.0.15.2941',
      apiVersion: 'v3',
      compatibility: undefined,
    });
  });

  it('falls back to probing when the product does not list its API versions', async () => {
    const { adapter, http } = make(sonarr, [status('3.0.10.1567')]);
    expect(await adapter.testConnection()).toMatchObject({ apiVersion: 'v3' });
    expect(http.calls[0]!.path).toBe('/api');
  });

  it('runs a newer product in compatibility mode and says so', async () => {
    const { adapter } = make(sonarr, [
      { path: '/api', headers, json: { current: 'v5', deprecated: ['v3'] } },
      status('5.0.0.1000'),
      { path: '/api/v3/health', headers, json: [] },
    ]);
    expect(await adapter.testConnection()).toMatchObject({ apiVersion: 'v3', compatibility: 'both' });
    const signals = await adapter.health!();
    expect(signals).toEqual([
      expect.objectContaining({
        origin: 'wardarr',
        source: 'Wardarr.apiCompatibility',
        level: 'info',
        data: expect.objectContaining({
          product: 'Sonarr',
          productVersion: '5.0.0.1000',
          api: 'v3',
          newestOffered: 'v5',
        }),
      }),
    ]);
  });

  it('detects again after the product was updated', async () => {
    const routes: FixtureRoute[] = [status('2.9.0', 'v3')];
    const { adapter } = make(whisparr, routes);
    expect(await adapter.testConnection()).toMatchObject({ variant: 'v2' });
    routes[0] = status('3.0.1', 'v3');
    // The update is noticed on the next poll; the flavor follows right away.
    expect(await adapter.testConnection()).toMatchObject({ version: '3.0.1', variant: 'v3' });
  });

  it('detects again when a known endpoint suddenly answers 404', async () => {
    const routes: FixtureRoute[] = [
      status('4.0.0'),
      { path: '/api/v3/health', headers, status: 404, json: {} },
    ];
    const { adapter, http } = make(sonarr, routes);
    await adapter.testConnection();
    await expect(adapter.health!()).rejects.toMatchObject({ kind: 'notFound' });
    const before = http.calls.length;
    await adapter.testConnection();
    expect(http.calls.slice(before).map((c) => c.path)).toContain('/api');
  });

  it('reports wrong credentials as unauthorized during detection', async () => {
    const { adapter } = make(sonarr, [{ path: '*', status: 401, json: {} }]);
    await expect(adapter.testConnection()).rejects.toMatchObject({ kind: 'unauthorized' });
  });

  it('reports an API it does not know as unsupported', async () => {
    const { adapter } = make(sonarr, [{ path: '/api', headers, json: { current: 'v9' } }]);
    await expect(adapter.testConnection()).rejects.toMatchObject({ kind: 'unsupported' });
  });
});
