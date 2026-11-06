// Queue Cleaner and Hunting through the API, with a fake *arr adapter.
// All titles are invented.
import { defineAdapter, type ImportPreviewFile, type QueueItem, type WantedItem } from '@wardarr/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FAKE_KEY, createTestApp, setupAdmin } from './helpers.js';

const calls: Array<{ op: string; args: unknown[] }> = [];
const fake = {
  queue: [] as QueueItem[],
  preview: [] as ImportPreviewFile[],
  wanted: [] as WantedItem[],
};

const fakeArr = defineAdapter({
  id: 'fakearr',
  name: 'Fake Arr',
  category: 'arr',
  lifecycle: 'active',
  homepage: 'https://example.com',
  fields: [{ key: 'apiKey', kind: 'secret', label: 'fields.apiKey', required: true }],
  credentials: z.object({ apiKey: z.string().min(1) }),
  capabilities: ['health', 'queue', 'queueActions', 'manualImport', 'wanted', 'search', 'history'],
  create() {
    return {
      testConnection: async () => ({ version: '4.0.0' }),
      health: async () => [],
      queue: async () => fake.queue,
      removeQueueItem: async (...args: unknown[]) => {
        calls.push({ op: 'remove', args });
        fake.queue = [];
      },
      search: async (...args: unknown[]) => void calls.push({ op: 'search', args }),
      importPreview: async () => fake.preview,
      importFiles: async (...args: unknown[]) => void calls.push({ op: 'import', args }),
      wanted: async (list: string) => (list === 'missing' ? fake.wanted : []),
      historySince: async () => [],
    };
  },
});

function failed(over: Partial<QueueItem> = {}): QueueItem {
  return {
    id: 5,
    downloadId: 'ABC123',
    title: 'Example.Movie.2020.1080p',
    mediaKind: 'movie',
    matched: true,
    mediaId: 9,
    state: 'failed',
    statusMessages: [],
    errorMessage: 'Download failed',
    sizeBytes: 100,
    sizeLeftBytes: 100,
    inLibrary: false,
    tags: [],
    titleKey: 'movie:9',
    searchTarget: { kind: 'movies', ids: [9] },
    ...over,
  };
}

let t: Awaited<ReturnType<typeof createTestApp>>;
let headers: Record<string, string>;
let id: string;

beforeAll(async () => {
  t = await createTestApp({ adapters: [fakeArr] });
  headers = await setupAdmin(t);
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/instances',
    headers,
    payload: {
      adapter: 'fakearr',
      name: 'Movies',
      baseUrl: 'http://arr.example.test',
      fields: { apiKey: FAKE_KEY },
    },
  });
  id = res.json().id;
  await t.runtime.poll(id);
});
afterAll(async () => t.close());
beforeEach(() => {
  calls.length = 0;
});

const api = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
  t.app.inject({ method, url, headers, payload });

describe('Queue Cleaner API', () => {
  it('starts in dry run and changes nothing at the service', async () => {
    fake.queue = [failed()];
    expect((await api('PUT', `/api/cleaner/${id}/settings`, { maxStrikes: 1 })).statusCode).toBe(200);
    expect((await api('POST', `/api/cleaner/${id}/run`)).statusCode).toBe(200);
    const summary = (await api('GET', '/api/cleaner')).json();
    const inst = summary.instances.find((i: { instanceId: string }) => i.instanceId === id);
    expect(inst.config.dryRun).toBe(true);
    expect(inst.downloads[0]).toMatchObject({
      rule: 'failed',
      strikes: 1,
      action: { type: 'remove', blocklist: true },
    });
    expect(calls).toEqual([]);
    const history = (await api('GET', `/api/cleaner/history?instance=${id}`)).json().entries;
    expect(history.map((h: { kind: string; dryRun: boolean }) => [h.kind, h.dryRun])).toEqual(
      expect.arrayContaining([
        ['removeBlocklist', true],
        ['search', true],
      ]),
    );
  });

  it('counts what the cleaner did per day', async () => {
    const res = (await api('GET', `/api/cleaner/activity?instance=${id}&days=7`)).json();
    expect(res.days).toHaveLength(7);
    const today = res.days.at(-1);
    expect(today.removed).toBeGreaterThanOrEqual(1);
  });

  it('shows a preview of the next run', async () => {
    const res = (await api('GET', `/api/cleaner/${id}/preview`)).json();
    expect(res.plan.downloads[0].action.type).toBe('remove');
  });

  it('settings never arm the cleaner; arming needs confirmation', async () => {
    expect((await api('PUT', `/api/cleaner/${id}/settings`, { dryRun: false })).statusCode).toBe(400);
    expect((await api('POST', `/api/cleaner/${id}/arm`, {})).statusCode).toBe(400);
    const armed = await api('POST', `/api/cleaner/${id}/arm`, { confirm: true });
    expect(armed.json().config.dryRun).toBe(false);
    await api('POST', `/api/cleaner/${id}/run`);
    expect(calls.map((c) => c.op)).toEqual(['remove', 'search']);
    expect(calls[0]!.args).toEqual([5, { removeFromClient: true, blocklist: true }]);
    await api('POST', `/api/cleaner/${id}/disarm`);
  });

  it('a clean import preview raises an issue with "Review import" and imports only after confirmation', async () => {
    fake.queue = [failed({ state: 'importBlocked', errorMessage: undefined, downloadId: 'IMP1' })];
    fake.preview = [
      {
        path: '/downloads/file.mkv',
        name: 'file',
        target: 'Example Movie (2020)',
        rejections: [],
        raw: { a: 1 },
      },
    ];
    await api('POST', `/api/cleaner/${id}/run`);
    const issues = (await api('GET', '/api/issues')).json();
    const issue = issues.find(
      (i: { group: { ruleId: string } }) => i.group.ruleId === 'cleaner-import-ready',
    );
    expect(issue.group.actions[0]).toMatchObject({
      id: 'review-import',
      href: expect.stringContaining('review=imp1'),
    });
    expect(calls).toEqual([]);

    const preview = (
      await api('POST', `/api/cleaner/${id}/downloads/import-preview`, { key: 'imp1' })
    ).json();
    expect(preview.files[0]).toEqual({
      path: '/downloads/file.mkv',
      name: 'file',
      target: 'Example Movie (2020)',
      rejections: [],
    });
    expect(
      (
        await api('POST', `/api/cleaner/${id}/downloads/import`, {
          key: 'imp1',
          paths: ['/downloads/file.mkv'],
        })
      ).statusCode,
    ).toBe(400);
    const done = await api('POST', `/api/cleaner/${id}/downloads/import`, {
      key: 'imp1',
      paths: ['/downloads/file.mkv'],
      confirm: true,
    });
    expect(done.json()).toEqual({ imported: 1 });
    expect(calls.map((c) => c.op)).toEqual(['import']);
  });

  it('ignores a download on request', async () => {
    fake.queue = [failed({ downloadId: 'IGN1' })];
    await api('POST', `/api/cleaner/${id}/run`);
    await api('POST', `/api/cleaner/${id}/downloads/ignore`, { key: 'ign1', ignored: true });
    await api('POST', `/api/cleaner/${id}/run`);
    const inst = (await api('GET', '/api/cleaner'))
      .json()
      .instances.find((i: { instanceId: string }) => i.instanceId === id);
    expect(inst.downloads[0]).toMatchObject({ rule: 'ignored', strikes: 0 });
  });
});

describe('Hunting API', () => {
  it('searches at the default pace and shows what comes next', async () => {
    fake.queue = [];
    fake.wanted = [1, 2, 3].map((n) => ({
      key: `movie:${n}`,
      title: `Example Movie ${n}`,
      mediaKind: 'movie' as const,
      mediaId: n,
      monitored: true,
      tags: [],
      releaseDate: `2020-01-0${n}T00:00:00Z`,
    }));
    await api('POST', `/api/hunting/${id}/run`);
    expect(calls.filter((c) => c.op === 'search').map((c) => c.args[0])).toEqual([
      { kind: 'movies', ids: [3] },
      { kind: 'movies', ids: [2] },
    ]);
    const inst = (await api('GET', '/api/hunting'))
      .json()
      .instances.find((i: { instanceId: string }) => i.instanceId === id);
    expect(inst.lists.missing.upcoming.map((c: { key: string }) => c.key)).toEqual(['movie:1']);
    expect(inst.searches).toHaveLength(2);
    // Two list reads and two searches.
    expect(inst.budget.left).toBe(96);
  });

  it('searches now and excludes titles', async () => {
    expect((await api('POST', `/api/hunting/${id}/search`, { key: 'movie:1' })).statusCode).toBe(200);
    expect(calls.map((c) => c.op)).toEqual(['search']);
    await api('POST', `/api/hunting/${id}/exclude`, { key: 'movie:1', title: 'Example Movie 1' });
    const inst = (await api('GET', '/api/hunting'))
      .json()
      .instances.find((i: { instanceId: string }) => i.instanceId === id);
    expect(inst.exclusions.map((e: { key: string }) => e.key)).toEqual(['movie:1']);
  });

  it('pauses while the queue is full', async () => {
    fake.queue = Array.from({ length: 15 }, (_, i) =>
      failed({ id: i, downloadId: `Q${i}`, state: 'downloading', errorMessage: undefined }),
    );
    await t.runtime.poll(id);
    const inst = (await api('GET', '/api/hunting'))
      .json()
      .instances.find((i: { instanceId: string }) => i.instanceId === id);
    expect(inst.pause).toMatchObject({ kind: 'queueFull' });
  });
});
