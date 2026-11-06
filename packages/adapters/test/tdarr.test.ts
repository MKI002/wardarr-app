// Tdarr specifics: nodes and workers, totals, libraries per version,
// failures and compatibility mode. All data is invented.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HttpResponse } from '@wardarr/core';
import { describe, expect, it } from 'vitest';
import { tdarr, versionAtLeast } from '../src/transcoders/tdarr.js';
import { createFixtureHttp, type FixtureRoute } from './fixtureHttp.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(path.resolve(here, '../fixtures/tdarr.json'), 'utf8')) as {
  credentials: { apiKey: string };
  routes: FixtureRoute[];
};
const KEY = fixture.credentials.apiKey;
const GB = 1024 ** 3;

function make(routes: FixtureRoute[] = fixture.routes, apiKey = KEY) {
  const http = createFixtureHttp(routes);
  const adapter = tdarr.create({
    instanceId: 't1',
    instanceName: 'Tdarr',
    baseUrl: 'http://tdarr.example.test:8265',
    credentials: tdarr.credentials.parse({ apiKey }),
    http,
    log: { debug() {}, warn() {} },
  });
  return { adapter, http };
}

/** The fixture routes with another version on the status endpoint. */
function withVersion(version: string, extra: FixtureRoute[] = []): FixtureRoute[] {
  return [
    ...extra,
    ...fixture.routes.map((r) =>
      r.path === '/api/v2/status' ? { ...r, json: { ...(r.json as object), version } } : r,
    ),
  ];
}

describe('tdarr adapter', () => {
  it('reads nodes with their busy workers', async () => {
    const { adapter } = make();
    const { nodes } = await adapter.transcoding!();
    expect(nodes.map((n) => [n.name, n.paused, n.workers.length])).toEqual([
      ['Example Node A', false, 2],
      ['Example Node B', true, 0],
    ]);
    const [gpu, check] = nodes[0]!.workers;
    expect(gpu).toMatchObject({ kind: 'transcode', gpu: true, progress: 0.425, fps: 118, eta: '0:08:12' });
    expect(gpu!.originalBytes).toBe(Math.round(8.4 * GB));
    expect(gpu!.startedAt).toBe(new Date(1793990000000).toISOString());
    expect(check).toMatchObject({ kind: 'healthCheck', gpu: false, progress: 0.8 });
    expect(nodes[0]!.limits).toEqual({
      transcodeCpu: 1,
      transcodeGpu: 1,
      healthCheckCpu: 2,
      healthCheckGpu: 0,
    });
    expect(nodes[0]!.cpuPercent).toBe(63.5);
  });

  it('reads totals, preferring the counts Tdarr shows', async () => {
    const { adapter } = make();
    const { totals } = await adapter.transcoding!();
    expect(totals).toEqual({
      files: 1240,
      transcodes: 318,
      healthChecks: 1190,
      savedBytes: Math.round(412.6 * GB),
      queued: { transcode: 57, healthCheck: 12 },
      done: { transcode: 1101, healthCheck: 1180 },
      failed: { transcode: 3, healthCheck: 2 },
    });
  });

  it('sends no key header when no key is set', async () => {
    const { adapter, http } = make(
      fixture.routes.map((r) => ({ ...r, headers: undefined })),
      '',
    );
    await adapter.testConnection();
    expect(http.calls.every((c) => !c.headers?.['x-api-key'])).toBe(true);
  });

  it('reads library totals from the pies endpoint on current versions', async () => {
    const { adapter, http } = make();
    const libs = await adapter.transcodeLibraries!();
    expect(libs.map((l) => [l.name, l.folder, l.files, l.transcodes])).toEqual([
      ['Movies', '/media/movies', 420, 201],
      ['Series', '/media/tv', 820, 117],
    ]);
    expect(http.calls.some((c) => c.path === '/api/v2/stats/get-pies')).toBe(true);
  });

  it('reads library totals from the statistics document before 2.24.01', async () => {
    const stats: FixtureRoute = {
      method: 'POST',
      path: '/api/v2/cruddb',
      body: { data: { collection: 'StatisticsJSONDB', mode: 'getById', docID: 'statistics', obj: {} } },
      json: { pies: [['Movies', 'lib-movies', 400, 190, 300.5, 380]] },
    };
    const { adapter, http } = make(withVersion('2.20.01', [stats]));
    const libs = await adapter.transcodeLibraries!();
    expect(libs[0]).toMatchObject({ name: 'Movies', files: 400, transcodes: 190, healthChecks: 380 });
    expect(libs[1]).toMatchObject({ name: 'Series', files: null });
    expect(http.calls.some((c) => c.path === '/api/v2/stats/get-pies')).toBe(false);
  });

  it('lists failed transcodes and health checks, newest first', async () => {
    const { adapter } = make();
    const list = await adapter.transcodeFailures!(20);
    expect(list.map((f) => [f.kind, f.outcome])).toEqual([
      ['healthCheck', 'error'],
      ['transcode', 'error'],
      ['transcode', 'cancelled'],
    ]);
    expect(list[1]!.sizeBytes).toBe(4300 * 1024 * 1024);
  });

  it('reports library folders for the stack map', async () => {
    const { adapter } = make();
    const topo = await adapter.topology!();
    expect(topo.folders.map((f) => [f.path, f.use])).toEqual([
      ['/media/movies', 'library'],
      ['/media/tv', 'library'],
    ]);
  });

  it('runs an untested major version in compatibility mode', async () => {
    const { adapter } = make(withVersion('3.01.00'));
    expect(await adapter.testConnection()).toMatchObject({
      version: '3.01.00',
      compatibility: 'untestedVersion',
    });
    const signals = await adapter.health!();
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ source: 'Wardarr.apiCompatibility', data: { product: 'Tdarr' } });
  });

  it('notices an update and detects again', async () => {
    let version = '2.26.01';
    const routes = fixture.routes.map((r) => (r.path === '/api/v2/status' ? { ...r, json: undefined } : r));
    const http = createFixtureHttp(routes);
    const status = (): HttpResponse => ({
      status: 200,
      headers: {},
      text: '',
      json: <T>() => ({ version }) as T,
    });
    const adapter = tdarr.create({
      instanceId: 't1',
      instanceName: 'Tdarr',
      baseUrl: 'http://tdarr.example.test:8265',
      credentials: { apiKey: KEY },
      http: {
        request: (req) => (req.path === '/api/v2/status' ? Promise.resolve(status()) : http.request(req)),
      },
      log: { debug() {}, warn() {} },
    });
    await adapter.transcodeLibraries!();
    expect(http.calls.some((c) => c.path === '/api/v2/stats/get-pies')).toBe(true);
    version = '3.00.00';
    await adapter.transcoding!();
    expect(await adapter.health!()).toHaveLength(1);
  });

  it('rejects something that is not Tdarr', async () => {
    const { adapter } = make([{ path: '/api/v2/status', json: { hello: 'world' } }]);
    await expect(adapter.testConnection()).rejects.toMatchObject({ kind: 'badResponse' });
  });

  it('compares Tdarr versions', () => {
    expect(versionAtLeast('2.24.01', [2, 24, 1])).toBe(true);
    expect(versionAtLeast('2.24.00', [2, 24, 1])).toBe(false);
    expect(versionAtLeast('2.3.0', [2, 24, 1])).toBe(false);
    expect(versionAtLeast('3.00.00', [2, 24, 1])).toBe(true);
  });
});
