// TRaSH Guides sync through the API, against an in-memory Radarr and the
// invented guide in testbed/trash-guides.
import { defineAdapter } from '@wardarr/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { GUIDE_DIR, createFakeArr } from '../../../packages/core/test/trash-fakes.js';
import { FAKE_KEY, createTestApp, setupAdmin } from './helpers.js';

const arr = createFakeArr();

const fakeRadarr = defineAdapter({
  id: 'radarr',
  name: 'Radarr',
  category: 'arr',
  lifecycle: 'active',
  homepage: 'https://example.com',
  fields: [{ key: 'apiKey', kind: 'secret', label: 'fields.apiKey', required: true }],
  credentials: z.object({ apiKey: z.string().min(1) }),
  capabilities: ['health', 'trashSync'],
  create() {
    return { testConnection: async () => ({ version: '5.0.0' }), health: async () => [], profileSync: arr };
  },
});

let t: Awaited<ReturnType<typeof createTestApp>>;
let headers: Record<string, string>;
let id: string;
let templateId: string;

const api = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) =>
  t.app.inject({ method, url, headers, payload });

beforeAll(async () => {
  t = await createTestApp({ adapters: [fakeRadarr], trashDir: GUIDE_DIR });
  headers = await setupAdmin(t);
  const res = await api('POST', '/api/instances', {
    adapter: 'radarr',
    name: 'Example Films',
    baseUrl: 'http://radarr.example.test',
    fields: { apiKey: FAKE_KEY },
  });
  id = res.json().id;
  await t.runtime.poll(id);
});
afterAll(async () => t.close());

const issues = async () =>
  (await api('GET', '/api/issues'))
    .json()
    .map((i: { group: { ruleId: string } }) => i.group.ruleId) as string[];

describe('TRaSH Guides API', () => {
  it('shows the tab for instances that can sync', async () => {
    expect((await api('GET', '/api/capabilities')).json().tabs).toContain('trash');
    const overview = (await api('GET', '/api/trash')).json();
    expect(overview.instances).toEqual([
      expect.objectContaining({ id, product: 'radarr', templateId: null }),
    ]);
  });

  it('loads the guide and lists its profiles', async () => {
    const refresh = await api('POST', '/api/trash/guide/refresh');
    expect(refresh.json()).toEqual({ changed: true });
    expect((await api('POST', '/api/trash/guide/refresh')).json()).toEqual({ changed: false });
    const catalog = (await api('GET', '/api/trash/catalog/radarr')).json();
    expect(catalog.categories).toEqual(['Standard', 'German']);
    expect(catalog.profiles.map((p: { name: string }) => p.name)).toContain('Example HD Bluray + WEB');
    const guide = (await api('GET', '/api/trash')).json().guide;
    expect(guide.skipped).toHaveLength(2);
  });

  it('saves a template and explains it', async () => {
    const catalog = (await api('GET', '/api/trash/catalog/radarr')).json();
    const hd = catalog.profiles.find((p: { name: string }) => p.name === 'Example HD Bluray + WEB');
    const config = {
      profiles: [hd.suggested],
      qualitySize: hd.qualitySize,
      naming: { folder: 'default' },
      rename: true,
    };
    const explained = (await api('POST', '/api/trash/resolve', { product: 'radarr', config })).json();
    expect(explained.counts).toEqual({ customFormats: 6, qualityProfiles: 1 });
    const res = await api('POST', '/api/trash/templates', { name: 'Films HD', product: 'radarr', config });
    expect(res.statusCode).toBe(200);
    templateId = res.json().template.id;
    expect(
      (await api('POST', '/api/trash/templates', { name: 'films hd', product: 'radarr', config })).statusCode,
    ).toBe(409);
  });

  it('previews and syncs only after confirmation', async () => {
    expect((await api('PUT', `/api/trash/instances/${id}/template`, { templateId })).statusCode).toBe(200);
    const preview = (await api('GET', `/api/trash/instances/${id}/preview`)).json();
    expect(preview.neverSynced).toBe(true);
    expect(preview.plan.counts.create).toBe(7);
    expect(arr.state.formats).toEqual([]);
    expect((await api('POST', `/api/trash/instances/${id}/sync`, {})).statusCode).toBe(400);
    const sync = await api('POST', `/api/trash/instances/${id}/sync`, { confirm: true });
    expect(sync.json().entry).toMatchObject({ status: 'ok', kind: 'sync', hasBackup: true });
    expect(arr.state.formats).toHaveLength(6);
    expect(arr.state.profiles.map((p) => p.name)).toEqual(['Example HD Bluray + WEB']);
    const after = (await api('GET', `/api/trash/instances/${id}/preview`)).json();
    expect(after.plan.counts).toMatchObject({ create: 0, update: 0 });
  });

  it('reports a change made in the instance as an issue, without changing it', async () => {
    const lq = arr.state.formats.find((f) => f.name === 'LQ')!;
    arr.state.profiles[0]!.formatItems.find((f) => f.format === lq.id)!.score = 0;
    await api('POST', `/api/trash/instances/${id}/check`);
    expect(await issues()).toContain('trash-local-drift');
    expect(arr.state.profiles[0]!.formatItems.find((f) => f.format === lq.id)!.score).toBe(0);
  });

  it('auto modes need a confirmation and leave local changes alone', async () => {
    expect((await api('PUT', `/api/trash/instances/${id}/guard`, { mode: 'auto' })).statusCode).toBe(400);
    expect(
      (await api('PUT', `/api/trash/instances/${id}/guard`, { mode: 'auto', confirm: true })).statusCode,
    ).toBe(200);
    await api('POST', `/api/trash/instances/${id}/check`);
    const lq = arr.state.formats.find((f) => f.name === 'LQ')!;
    expect(arr.state.profiles[0]!.formatItems.find((f) => f.format === lq.id)!.score).toBe(0);
    // Strict mode sets it back.
    await api('PUT', `/api/trash/instances/${id}/guard`, { mode: 'strict', confirm: true });
    await api('POST', `/api/trash/instances/${id}/check`);
    expect(arr.state.profiles[0]!.formatItems.find((f) => f.format === lq.id)!.score).toBe(-10000);
    expect(await issues()).not.toContain('trash-local-drift');
  });

  it('pauses when a setting keeps being changed back', async () => {
    const lq = arr.state.formats.find((f) => f.name === 'LQ')!;
    for (let i = 0; i < 3; i++) {
      arr.state.profiles[0]!.formatItems.find((f) => f.format === lq.id)!.score = 5;
      await api('POST', `/api/trash/instances/${id}/check`);
    }
    const inst = (await api('GET', '/api/trash')).json().instances[0];
    expect(inst.state.pause.reasons).toContain('pingPong');
    expect(await issues()).toContain('trash-sync-paused');
    expect((await api('POST', `/api/trash/instances/${id}/resume`)).statusCode).toBe(200);
    await api('PUT', `/api/trash/instances/${id}/guard`, { mode: 'notify' });
  });

  it('tests a release against the profiles of the instance', async () => {
    const res = (
      await api('POST', `/api/trash/instances/${id}/release-test`, {
        title: 'Example.Film.2021.1080p.BluRay.COMPLETE.BLURAY-HARBOR',
      })
    ).json();
    const profile = res.profiles[0];
    expect(profile).toMatchObject({ managed: true, accepted: false });
    expect(profile.formats.map((f: { name: string }) => f.name)).toContain('BR-DISK');
  });

  it('suggests a template from what the instance has', async () => {
    const res = (await api('POST', `/api/trash/instances/${id}/suggest`)).json();
    expect(res.matches).toEqual([
      expect.objectContaining({ trashProfile: 'Example HD Bluray + WEB', match: 'name' }),
    ]);
    expect(res.config.profiles[0].groups).toHaveLength(1);
  });

  it('rolls the first sync back and switches the guard to notify', async () => {
    const history = (await api('GET', `/api/trash/history?instance=${id}`)).json().entries;
    const first = history[history.length - 1];
    expect((await api('POST', `/api/trash/history/${first.id}/rollback`, {})).statusCode).toBe(400);
    const res = await api('POST', `/api/trash/history/${first.id}/rollback`, { confirm: true });
    expect(res.json().entry).toMatchObject({ kind: 'rollback', status: 'ok' });
    expect(arr.state.formats).toEqual([]);
    expect(arr.state.profiles).toEqual([]);
    expect((await api('POST', `/api/trash/history/${first.id}/rollback`, { confirm: true })).statusCode).toBe(
      409,
    );
    expect((await api('GET', '/api/trash')).json().instances[0].guardMode).toBe('notify');
  });

  it('keeps templates that instances use', async () => {
    expect((await api('DELETE', `/api/trash/templates/${templateId}`)).statusCode).toBe(409);
    await api('PUT', `/api/trash/instances/${id}/template`, { templateId: null });
    expect((await api('DELETE', `/api/trash/templates/${templateId}`)).statusCode).toBe(200);
  });

  it('answers 502 with the reason when the instance fails', async () => {
    await api('POST', '/api/trash/templates', {
      name: 'Again',
      product: 'radarr',
      config: { profiles: [], qualitySize: null, naming: {}, rename: false },
    });
    arr.state.unsupported = true;
    const res = await api('POST', `/api/trash/instances/${id}/release-test`, { title: 'Example.Film.2021' });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: 'serviceError', details: { kind: 'unsupported' } });
    arr.state.unsupported = false;
  });
});
