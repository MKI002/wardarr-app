// Library quality scores through the API: the page answers at once, reads in
// the background and keeps the last report when a read fails.
import { AdapterError, defineAdapter, type QualityScan } from '@wardarr/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FAKE_KEY, createTestApp, setupAdmin } from './helpers.js';

const state = { fail: false, reads: 0 };

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
    expect(done.report.files).toBe(2);
    expect(done.report.profiles[0].perfect).toBe(1300);
    expect(done.report.tiers).toEqual({ perfect: 1, target: 1, upgrading: 0, penalised: 0 });
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
    expect(inst.report.files).toBe(2);
    state.fail = false;
  });

  it('refuses an unknown instance', async () => {
    expect((await api('POST', '/api/quality/refresh', { instance: 'nope' })).statusCode).toBe(404);
  });
});
