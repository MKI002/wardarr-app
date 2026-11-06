// Disk space through the API: shared disks fold into one, history feeds the
// forecast, and a disk that runs full becomes one issue.
import { defineAdapter, type DiskReport } from '@wardarr/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { diskSamples } from '../src/db/schema.js';
import { FAKE_KEY, createTestApp, setupAdmin } from './helpers.js';

const GiB = 1024 ** 3;
const TiB = 1024 * GiB;
/** Free space of the shared media disk, changed by the tests. */
const state = { mediaFree: 2 * TiB, fail: false };

function fakeArr(id: string, mount: string, rootFolder: string) {
  return defineAdapter({
    id,
    name: id,
    category: 'arr',
    lifecycle: 'active',
    homepage: 'https://example.com',
    fields: [{ key: 'apiKey', kind: 'secret', label: 'fields.apiKey', required: true }],
    credentials: z.object({ apiKey: z.string().min(1) }),
    capabilities: ['health', 'storage'],
    create() {
      return {
        testConnection: async () => ({ version: '4.0.0' }),
        health: async () => [],
        async storage(): Promise<DiskReport> {
          if (state.fail && id === 'radarr') throw new Error('down');
          return {
            disks: [
              { path: '/', freeBytes: 20 * GiB, totalBytes: 60 * GiB },
              { path: '/etc/hosts', freeBytes: 20 * GiB, totalBytes: 60 * GiB },
              { path: mount, freeBytes: state.mediaFree, totalBytes: 8 * TiB },
            ],
            rootFolders: [
              { path: rootFolder, freeBytes: state.mediaFree, totalBytes: null, accessible: true },
            ],
          };
        },
      };
    },
  });
}

let t: Awaited<ReturnType<typeof createTestApp>>;
let headers: Record<string, string>;
const api = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
  t.app.inject({ method, url, headers, payload });

beforeAll(async () => {
  t = await createTestApp({
    adapters: [fakeArr('sonarr', '/tv', '/tv/shows'), fakeArr('radarr', '/movies', '/movies')],
  });
  headers = await setupAdmin(t);
  for (const [adapter, name] of [
    ['sonarr', 'Example Series'],
    ['radarr', 'Example Films'],
  ]) {
    const res = await api('POST', '/api/instances', {
      adapter,
      name,
      baseUrl: `http://${adapter}.example.test`,
      fields: { apiKey: FAKE_KEY },
    });
    await t.runtime.poll(res.json().id);
  }
});
afterAll(async () => t.close());

const storage = async () => (await api('GET', '/api/storage?days=30')).json();
const diskIssues = async () =>
  (await api('GET', '/api/issues'))
    .json()
    .filter((i: { group: { ruleId: string } }) => i.group.ruleId === 'disk-filling-up');

describe('storage API', () => {
  it('shows the tab for apps that report disks', async () => {
    expect((await api('GET', '/api/capabilities')).json().tabs).toContain('storage');
  });

  it('folds a disk two apps share into one and drops system mounts', async () => {
    await api('POST', '/api/storage/refresh');
    const s = await storage();
    expect(s.disks).toHaveLength(2);
    const media = s.disks.find((d: { media: boolean }) => d.media);
    expect(media.totalBytes).toBe(8 * TiB);
    expect(media.members.map((m: { path: string }) => m.path).sort()).toEqual(['/movies', '/tv']);
    expect(media.forecast.status).toBe('collecting');
    expect(s.disks.some((d: { label: string }) => d.label === '/etc/hosts')).toBe(false);
  });

  it('forecasts from the stored history and opens one issue for the disk', async () => {
    const media = (await storage()).disks.find((d: { media: boolean }) => d.media);
    // Thirty days of history: 25 GiB more used every day.
    const now = Date.now();
    for (let i = 30; i >= 1; i--) {
      t.db
        .insert(diskSamples)
        .values({
          diskKey: media.key,
          at: new Date(now - i * 86_400_000).toISOString(),
          freeBytes: 400 * GiB + i * 25 * GiB,
          totalBytes: 8 * TiB,
        })
        .run();
    }
    state.mediaFree = 400 * GiB;
    await api('POST', '/api/storage/refresh');
    const after = (await storage()).disks.find((d: { key: string }) => d.key === media.key);
    expect(after.forecast.status).toBe('filling');
    expect(after.forecast.daysLeft).toBeGreaterThan(14);
    expect(after.forecast.daysLeft).toBeLessThan(18);
    expect(after.level).toBe('warning');

    const open = await diskIssues();
    expect(open).toHaveLength(1);
    expect(open[0].fingerprint).toBe(`disk-filling-up:${media.key}`);
    expect(open[0].group.explanation.params.apps).toBe('Example Films, Example Series');
  });

  it('keeps the issue while an app cannot be read and resolves it after a cleanup', async () => {
    state.fail = true;
    await api('POST', '/api/storage/refresh');
    expect(await diskIssues()).toHaveLength(1);
    state.fail = false;
    // Looser thresholds: 16 days and 4.9 % free are no longer urgent.
    const settings = (await storage()).settings;
    const res = await api('PUT', '/api/storage/settings', {
      ...settings,
      warnDays: 7,
      criticalDays: 3,
      warnPercent: 3,
      criticalPercent: 1,
    });
    expect(res.statusCode).toBe(200);
    await api('POST', '/api/storage/refresh');
    const issues = await diskIssues();
    expect(issues.every((i: { status: string }) => i.status === 'resolved')).toBe(true);
  });

  it('rejects thresholds where critical is looser than warning', async () => {
    const res = await api('PUT', '/api/storage/settings', {
      warnDays: 7,
      criticalDays: 30,
      warnPercent: 5,
      criticalPercent: 2,
      lookbackDays: 30,
    });
    expect(res.statusCode).toBe(400);
  });

  it('shows a short summary on the overview', async () => {
    const overview = (await api('GET', '/api/overview')).json();
    expect(overview.storage).toEqual(
      expect.objectContaining({ disks: 1, totalBytes: 8 * TiB, freeBytes: 400 * GiB }),
    );
  });
});
