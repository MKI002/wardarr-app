// Library quality scores through the API: the page answers at once, reads in
// the background and keeps the last report when a read fails.
import { AdapterError, defineAdapter, type QualityScan } from '@wardarr/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FeatureStore } from '../src/features/store.js';
import { QualityService } from '../src/quality/service.js';
import { FAKE_KEY, createTestApp, setupAdmin } from './helpers.js';

const state = { fail: false, reads: 0, searched: [] as Array<{ titleId: number; fileId: number }[]> };

const media = {
  videoCodec: 'x265',
  dynamicRange: '',
  audioCodec: 'EAC3',
  audioChannels: 6,
  audioLanguages: ['ger'],
  subtitles: [],
};

function scan(): QualityScan {
  return {
    formats: [
      { id: 1, name: 'Language: German', specs: ['LanguageSpecification'] },
      { id: 2, name: 'Audio: Atmos', specs: [] },
      { id: 3, name: 'Reject: LQ Groups', specs: [] },
    ],
    profiles: [
      {
        id: 1,
        name: 'Example HD',
        upgradeAllowed: true,
        cutoffFormatScore: 500,
        minFormatScore: 0,
        scores: [
          { format: 1, score: 1000 },
          { format: 2, score: 300 },
          { format: 3, score: -10000 },
        ],
      },
    ],
    titles: [{ id: 5, title: 'Example Show', year: 2021, profileId: 1, webUrl: null }],
    files: [
      {
        id: 1,
        titleId: 5,
        formatIds: [1, 2],
        reportedScore: 1300,
        quality: 'WEBDL-1080p',
        resolution: 1080,
        sizeBytes: 1,
        media,
      },
      {
        id: 2,
        titleId: 5,
        formatIds: [1],
        reportedScore: 1000,
        quality: 'WEBDL-1080p',
        resolution: 1080,
        sizeBytes: 1,
        media,
      },
      {
        id: 3,
        titleId: 5,
        formatIds: [2],
        reportedScore: 300,
        quality: 'WEBDL-1080p',
        resolution: 1080,
        sizeBytes: 1,
        media,
        name: 'Example Show - S01E03.mkv',
        season: 1,
      },
      {
        id: 4,
        titleId: 5,
        formatIds: [1, 3],
        reportedScore: -9000,
        quality: 'WEBDL-1080p',
        resolution: 1080,
        sizeBytes: 1,
        media,
        name: 'Example Show - S01E04.mkv',
        season: 1,
      },
    ],
  };
}

const fakeSonarr = defineAdapter({
  id: 'sonarr',
  name: 'Sonarr',
  category: 'arr',
  lifecycle: 'active',
  homepage: 'https://example.com',
  fields: [{ key: 'apiKey', kind: 'secret', label: 'fields.apiKey', required: true }],
  credentials: z.object({ apiKey: z.string().min(1) }),
  capabilities: ['health', 'qualityScore'],
  create() {
    return {
      testConnection: async () => ({ version: '4.0.0' }),
      health: async () => [],
      async qualityScan(onProgress) {
        state.reads++;
        if (state.fail) throw new AdapterError('timeout', 'slow');
        onProgress?.(1, 1);
        return scan();
      },
      async qualitySearch(files) {
        state.searched.push(files);
        return files.length;
      },
    };
  },
});

let t: Awaited<ReturnType<typeof createTestApp>>;
let headers: Record<string, string>;
const api = (method: 'GET' | 'POST', url: string, payload?: object) =>
  t.app.inject({ method, url, headers, payload });

beforeAll(async () => {
  t = await createTestApp({ adapters: [fakeSonarr] });
  headers = await setupAdmin(t);
  const res = await api('POST', '/api/instances', {
    adapter: 'sonarr',
    name: 'Example Series',
    baseUrl: 'http://sonarr.example.test',
    fields: { apiKey: FAKE_KEY },
  });
  await t.runtime.poll(res.json().id);
});
afterAll(async () => t.close());

describe('quality API', () => {
  it('shows the tab for apps with custom format scores', async () => {
    expect((await api('GET', '/api/capabilities')).json().tabs).toContain('quality');
  });

  it('answers at once and reads the library in the background', async () => {
    const first = (await api('GET', '/api/quality')).json().instances[0];
    expect(first.report).toBeNull();
    expect(first.refreshing).toBe(true);
    await t.quality.settled();
    const done = (await api('GET', '/api/quality')).json().instances[0];
    expect(done.refreshing).toBe(false);
    expect(done.report.files).toBe(4);
    expect(done.report.profiles[0].perfect).toBe(1300);
    expect(done.report.tiers).toEqual({ perfect: 1, target: 1, upgrading: 1, penalised: 1 });
  });

  it('does not read again while the report is fresh', async () => {
    const reads = state.reads;
    await api('GET', '/api/quality');
    await t.quality.settled();
    expect(state.reads).toBe(reads);
  });

  it('keeps the last report when a read fails', async () => {
    state.fail = true;
    expect((await api('POST', '/api/quality/refresh', {})).statusCode).toBe(200);
    await t.quality.settled();
    const inst = (await api('GET', '/api/quality')).json().instances[0];
    expect(inst.error).toBe('timeout');
    expect(inst.report.files).toBe(4);
    state.fail = false;
  });

  it('lists files worst first, by state and in pages', async () => {
    const all = (await api('GET', '/api/quality/files')).json();
    expect(all.total).toBe(4);
    expect(all.files.map((f: { fileId: number }) => f.fileId)).toEqual([4, 3, 2, 1]);
    expect(all.files[0]).toMatchObject({
      title: 'Example Show',
      name: 'Example Show - S01E04.mkv',
      tier: 'penalised',
      penalties: ['Reject: LQ Groups'],
      missing: [{ name: 'Audio: Atmos', category: 'audio' }],
      perfect: 1300,
      target: 500,
    });
    const below = (await api('GET', '/api/quality/files?tier=upgrading')).json();
    expect(below.files.map((f: { fileId: number }) => f.fileId)).toEqual([3]);
    const page = (await api('GET', '/api/quality/files?offset=1&limit=2')).json();
    expect(page.files.map((f: { fileId: number }) => f.fileId)).toEqual([3, 2]);
    expect((await api('GET', '/api/quality/files?tier=nope')).statusCode).toBe(400);
  });

  it('keeps the file list over a restart', () => {
    const again = new QualityService(t.runtime, { features: new FeatureStore(t.db) });
    expect(again.files({ offset: 0, limit: 10 }).total).toBe(4);
  });

  it('searches the worst files below their upgrade target only', async () => {
    const res = await api('POST', '/api/quality/search', { count: 10 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ files: 2, instances: [{ files: 2, items: 2, error: null }] });
    expect(state.searched.at(-1)).toEqual([
      { titleId: 5, fileId: 4 },
      { titleId: 5, fileId: 3 },
    ]);
    const one = (await api('POST', '/api/quality/search', { count: 1 })).json();
    expect(one.files).toBe(1);
    expect(state.searched.at(-1)).toEqual([{ titleId: 5, fileId: 4 }]);
    expect((await api('POST', '/api/quality/search', { count: 0 })).statusCode).toBe(400);
    expect((await api('POST', '/api/quality/search', { count: 1, instance: 'nope' })).statusCode).toBe(404);
  });

  it('refuses an unknown instance', async () => {
    expect((await api('POST', '/api/quality/refresh', { instance: 'nope' })).statusCode).toBe(404);
  });
});
