// The gatekeeper through the API: writes the list only into targets that are
// switched on, keeps entries a person added by hand, takes back only its own,
// records blocked downloads and lets them lower the indexer score.
// All data is invented.
import {
  defineAdapter,
  uniqueExtensions,
  type BlockedDownload,
  type ExtensionBlockChange,
  type HistoryEvent,
} from '@wardarr/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createTestApp, FAKE_KEY, setupAdmin } from './helpers.js';

const base = {
  lifecycle: 'active' as const,
  homepage: 'https://example.com',
  fields: [{ key: 'apiKey', kind: 'secret' as const, label: 'fields.apiKey', required: true }],
  credentials: z.object({ apiKey: z.string().min(1) }),
};

const now = Date.now();
const ago = (h: number) => new Date(now - h * 3_600_000).toISOString();

// A usenet client with a free list; "nfo" was there before Wardarr.
const sab = { list: ['nfo'], action: 'off' as 'off' | 'pause' | 'abort' };
const sabWrites: ExtensionBlockChange[] = [];
const blocked: BlockedDownload[] = [
  {
    downloadId: 'SABnzbd_nzo_aaa1',
    name: 'Invented.Show.S01E01',
    at: ago(5),
    extensions: [],
    outcome: 'aborted',
  },
  {
    downloadId: 'SABnzbd_nzo_aaa2',
    name: 'Invented.Show.S01E02',
    at: ago(4),
    extensions: [],
    outcome: 'aborted',
  },
];

const fakeSab = defineAdapter({
  ...base,
  id: 'gksab',
  name: 'Gate SAB',
  category: 'downloader',
  capabilities: ['downloads', 'extensionBlock'],
  create() {
    const status = () => ({
      style: 'list' as const,
      active: sab.action !== 'off' && sab.list.length > 0,
      extensions: [...sab.list],
      action: sab.action,
    });
    return {
      testConnection: async () => ({ version: '4.5.0' }),
      downloads: async () => [],
      extensionBlock: async () => status(),
      setExtensionBlock: async (change: ExtensionBlockChange) => {
        sabWrites.push(change);
        sab.list = uniqueExtensions([
          ...sab.list.filter((e) => !change.remove.includes(e)),
          ...change.extensions,
        ]);
        sab.action = change.action ?? 'abort';
        return status();
      },
      blockedDownloads: async (since: string) => blocked.filter((b) => b.at >= since),
    };
  },
});

// An *arr app with fixed groups only, and history with one dangerous file.
const arrGroups = { on: [] as string[] };
const history: HistoryEvent[] = [
  ...Array.from({ length: 10 }, (_, i) => ({
    at: ago(10 + i),
    type: 'grabbed' as const,
    mediaId: i,
    downloadId: i < 2 ? `SABnzbd_nzo_aaa${i + 1}` : `SABnzbd_nzo_ok${i}`,
    indexer: 'Lantern (Prowlarr)',
  })),
  ...Array.from({ length: 10 }, (_, i) => ({
    at: ago(10 + i),
    type: 'grabbed' as const,
    mediaId: 100 + i,
    downloadId: `HASH${i}`,
    indexer: 'Nightjar (Prowlarr)',
  })),
  ...Array.from({ length: 8 }, (_, i) => ({
    at: ago(3),
    type: 'imported' as const,
    mediaId: i + 2,
    downloadId: `SABnzbd_nzo_ok${i + 2}`,
  })),
  ...Array.from({ length: 9 }, (_, i) => ({
    at: ago(3),
    type: 'imported' as const,
    mediaId: 101 + i,
    downloadId: `HASH${i + 1}`,
  })),
  {
    at: ago(2),
    type: 'failed',
    mediaId: 100,
    downloadId: 'HASH0',
    message: "Caution: Found executable file with extension: '.exe'",
    sourceTitle: 'Invented.Show.S02E01',
  },
];

const fakeArr = defineAdapter({
  ...base,
  id: 'gkarr',
  name: 'Gate Arr',
  category: 'arr',
  capabilities: ['search', 'history', 'extensionBlock'],
  create() {
    const possible = ['bat', 'cmd', 'exe', 'sh', 'arj', 'lnk', 'lzh', 'ps1', 'scr', 'vbs', 'zipx'];
    const status = () => ({
      style: 'groups' as const,
      active: arrGroups.on.length > 0,
      extensions: [...arrGroups.on],
      possible,
      indexers: { covered: arrGroups.on.length ? 2 : 0, total: 2 },
    });
    return {
      testConnection: async () => ({ version: '4.0.0' }),
      arrIndexers: async () => [],
      historySince: async (since: string) => history.filter((e) => e.at >= since),
      extensionBlock: async () => status(),
      setExtensionBlock: async (change: ExtensionBlockChange) => {
        arrGroups.on = uniqueExtensions([
          ...arrGroups.on.filter((e) => !change.remove.includes(e)),
          ...change.extensions.filter((e) => possible.includes(e)),
        ]);
        return status();
      },
    };
  },
});

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: Record<string, string>;
let sabId: string;
let arrId: string;

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
  t = await createTestApp({ adapters: [fakeSab, fakeArr] });
  admin = await setupAdmin(t);
  sabId = await addInstance('gksab', 'SABnzbd', 'http://sab.example.test:8080');
  arrId = await addInstance('gkarr', 'Sonarr', 'http://sonarr.example.test:8989');
  await t.runtime.pollMany([sabId, arrId]);
  await t.app.inject({ method: 'POST', url: '/api/indexer-insights/collect', headers: admin });
});
afterAll(async () => t.close());

const view = async () =>
  (await t.app.inject({ method: 'GET', url: '/api/gatekeeper?range=7d', headers: admin })).json();
const put = (payload: Record<string, unknown>) =>
  t.app.inject({ method: 'PUT', url: '/api/gatekeeper/settings', headers: admin, payload });

describe('gatekeeper', () => {
  it('shows the tab and changes nothing before it is set up', async () => {
    const caps = (await t.app.inject({ method: 'GET', url: '/api/capabilities', headers: admin })).json();
    expect(caps.tabs).toContain('gatekeeper');
    const v = await view();
    expect(v.configured).toBe(false);
    expect(v.config.extensions).toContain('exe');
    expect(v.targets.map((x: { name: string }) => x.name)).toEqual(['SABnzbd', 'Sonarr']);
    expect(v.targets[0]).toMatchObject({
      level: 'downloader',
      recommended: true,
      enabled: false,
      sync: 'off',
    });
    expect(sabWrites).toHaveLength(0);
  });

  it('writes the list into targets that are switched on and keeps entries added by hand', async () => {
    const res = await put({ extensions: ['exe', 'lnk', 'scr', '.ISO'], targets: { [sabId]: true } });
    expect(res.statusCode).toBe(200);
    expect(res.json().config.extensions).toEqual(['exe', 'iso', 'lnk', 'scr']);
    expect(sab.list).toEqual(['exe', 'iso', 'lnk', 'nfo', 'scr']);
    expect(sab.action).toBe('abort');
    expect(arrGroups.on).toEqual([]);
    const v = await view();
    expect(v.targets[0]).toMatchObject({ sync: 'inSync', enabled: true });
  });

  it('marks a target that can only block some extensions as partial', async () => {
    await put({ targets: { [sabId]: true, [arrId]: true } });
    const v = await view();
    const arr = v.targets.find((x: { name: string }) => x.name === 'Sonarr');
    expect(arr).toMatchObject({ sync: 'partial', unreachable: ['iso'] });
    expect(arrGroups.on).toEqual(['exe', 'lnk', 'scr']);
  });

  it('takes back only what it added when an extension is dropped', async () => {
    await put({ extensions: ['exe', 'lnk', 'scr'] });
    expect(sab.list).toEqual(['exe', 'lnk', 'nfo', 'scr']);
    await put({ targets: { [sabId]: false, [arrId]: true } });
    expect(sab.list).toEqual(['nfo']);
  });

  it('records blocked downloads and counts them against the indexer', async () => {
    await put({ targets: { [sabId]: true, [arrId]: true } });
    await t.app.inject({ method: 'POST', url: '/api/gatekeeper/collect', headers: admin });
    const v = await view();
    expect(v.totals.caught).toBe(3);
    expect(v.recent.map((c: { name: string }) => c.name).sort()).toEqual([
      'Invented.Show.S01E01',
      'Invented.Show.S01E02',
      'Invented.Show.S02E01',
    ]);
    const exe = v.recent.find((c: { name: string }) => c.name === 'Invented.Show.S02E01');
    expect(exe).toMatchObject({ extensions: ['exe'], reason: 'executable', indexer: { name: 'Nightjar' } });

    const lantern = v.impact.find((i: { name: string }) => i.name === 'Lantern');
    expect(lantern).toMatchObject({ grabs: 10, caught: 2 });
    // Two of ten grabs blocked: the clean part of the score drops to 0.
    expect(lantern.scoreWith).toBeLessThan(lantern.scoreWithout);
    const nightjar = v.impact.find((i: { name: string }) => i.name === 'Nightjar');
    expect(nightjar.scoreWith).toBeGreaterThan(lantern.scoreWith);

    expect(v.flow.total).toBe(3);
    expect(v.flow.extensions.map((e: { ext: string }) => e.ext).sort()).toEqual(['?', 'exe']);

    const report = (
      await t.app.inject({ method: 'GET', url: '/api/indexer-insights?range=7d', headers: admin })
    ).json();
    const notes = report.insights.filter((n: { kind: string }) => n.kind === 'blocked');
    expect(notes).toEqual([
      expect.objectContaining({ params: expect.objectContaining({ name: 'Lantern', count: 2 }) }),
    ]);
  });

  it('rejects bad settings', async () => {
    const res = await put({ sabAction: 'explode' });
    expect(res.statusCode).toBe(400);
  });
});
