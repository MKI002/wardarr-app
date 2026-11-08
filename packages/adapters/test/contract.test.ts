// Contract tests: every adapter is checked against its invented fixtures.
// Fixtures live in ../fixtures/<adapter>.json and contain no real data.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CAPABILITIES } from '@wardarr/core';
import {
  AdapterError,
  buildQualityReport,
  groupDisks,
  type AdapterDefinition,
  type AdapterInstance,
} from '@wardarr/core';
import { resources } from '@wardarr/i18n';
import { describe, expect, it } from 'vitest';
import { ADAPTERS } from '../src/index.js';
import { createFixtureHttp, type FixtureRoute } from './fixtureHttp.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.resolve(here, '../fixtures');

interface Fixture {
  adapter: string;
  baseUrl: string;
  credentials: Record<string, unknown>;
  wrongCredentials: Record<string, unknown>;
  routes: FixtureRoute[];
  expect: {
    version: string;
    variant?: string;
    health?: Array<{ source?: string; level: string; kind?: string }>;
    queue?: Array<{ state: string; matched: boolean; downloadId?: string }>;
    sessions?: Array<{ title: string; state: string; transcoding: boolean }>;
    downloads?: Array<{ state: string }>;
    indexers?: Array<{ name: string; failing: boolean }>;
    /** Queue extras of the first matched record. */
    queueExtras?: { inLibrary?: boolean; tags?: string[]; titleKey?: string };
    importPreview?: { downloadId: string; files: Array<{ target: string | null; rejections: string[] }> };
    wantedMissing?: Array<{ key: string; title: string }>;
    history?: { since: string; events: Array<{ type: string; mediaId: number | null }> };
    /** A call that must hit a fixture route (method + path). */
    remove?: { id: string | number; path: string };
    search?: { target: Record<string, unknown>; body: Record<string, unknown> };
    /** Calendar entries between two times, matched field by field. */
    calendar?: { start: string; end: string; entries: Array<Record<string, unknown>> };
    /** Mount paths Wardarr keeps after grouping, and the root folders on them. */
    storage?: { mounts: string[]; rootFolders: string[] };
    /** Titles with files, files, the perfect score of the first profile and a title link. */
    quality?: {
      titles: number;
      files: number;
      perfect: number;
      webUrl: string;
      search: {
        files: Array<{ titleId: number; fileId: number }>;
        body: Record<string, unknown>;
        count: number;
      };
    };
  };
}

const fixtures = new Map<string, Fixture>(
  readdirSync(fixtureDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const fx = JSON.parse(readFileSync(path.join(fixtureDir, f), 'utf8')) as Fixture;
      return [fx.adapter, fx];
    }),
);

function translate(key: string): string | undefined {
  let node: unknown = resources.en.translation;
  for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part];
  return typeof node === 'string' ? node : undefined;
}

function instantiate(
  def: AdapterDefinition<Record<string, unknown>>,
  fx: Fixture,
  credentials = fx.credentials,
) {
  const http = createFixtureHttp(fx.routes);
  const adapter = def.create({
    instanceId: 'inst-1',
    instanceName: `${def.name} Test`,
    baseUrl: fx.baseUrl,
    credentials: def.credentials.parse(credentials),
    http,
    log: { debug() {}, warn() {} },
  });
  return { adapter, http };
}

const METHOD_FOR: Partial<Record<(typeof CAPABILITIES)[number], keyof AdapterInstance>> = {
  health: 'health',
  queue: 'queue',
  sessions: 'sessions',
  downloads: 'downloads',
  indexers: 'indexers',
  settings: 'settings',
  queueActions: 'removeQueueItem',
  manualImport: 'importPreview',
  wanted: 'wanted',
  search: 'search',
  history: 'historySince',
  library: 'libraries',
  discover: 'discover',
  requests: 'requests',
  calendar: 'calendar',
  storage: 'storage',
  transcoding: 'transcoding',
  qualityScore: 'qualityScan',
};

describe.each(ADAPTERS.map((d) => [d.id, d] as const))('%s adapter', (_id, rawDef) => {
  const def = rawDef as unknown as AdapterDefinition<Record<string, unknown>>;
  const fx = fixtures.get(def.id);

  it('has a fixture', () => {
    expect(fx, `fixtures/${def.id}.json`).toBeDefined();
  });
  if (!fx) return;

  it('has a valid definition with translated fields', () => {
    expect(def.id).toMatch(/^[a-z0-9]+$/);
    for (const f of def.fields) {
      expect(translate(f.label), f.label).toBeDefined();
      if (f.help) expect(translate(f.help), f.help).toBeDefined();
    }
  });

  it('implements every declared capability', () => {
    const { adapter } = instantiate(def, fx);
    for (const cap of def.capabilities) {
      const method = METHOD_FOR[cap];
      if (method) expect(typeof adapter[method], cap).toBe('function');
    }
  });

  it('connects and reports the version', async () => {
    const { adapter } = instantiate(def, fx);
    const info = await adapter.testConnection();
    expect(info.version).toBe(fx.expect.version);
    if (fx.expect.variant) expect(info.variant).toBe(fx.expect.variant);
  });

  it('reports wrong credentials as unauthorized', async () => {
    const { adapter } = instantiate(def, fx, fx.wrongCredentials);
    await expect(adapter.testConnection()).rejects.toMatchObject({
      name: 'AdapterError',
      kind: 'unauthorized',
    });
  });

  it('propagates connection failures as AdapterError', async () => {
    const adapter = def.create({
      instanceId: 'inst-1',
      instanceName: 'Down',
      baseUrl: fx.baseUrl,
      credentials: def.credentials.parse(fx.credentials),
      http: { request: async () => Promise.reject(new AdapterError('unreachable', 'down')) },
      log: { debug() {}, warn() {} },
    });
    await expect(adapter.testConnection()).rejects.toBeInstanceOf(AdapterError);
  });

  if (fx.expect.health) {
    it('normalizes health messages into signals', async () => {
      const { adapter } = instantiate(def, fx);
      const signals = await adapter.health!();
      expect(signals.map((s) => ({ source: s.source, level: s.level, kind: s.kind }))).toEqual(
        fx.expect.health!.map((h) => ({ kind: 'health', ...h })),
      );
      for (const s of signals)
        expect(s.instance).toEqual({ id: 'inst-1', name: `${def.name} Test`, adapter: def.id });
    });
  }

  if (fx.expect.queue) {
    it('reads the full queue including unmatched entries', async () => {
      const { adapter, http } = instantiate(def, fx);
      const items = await adapter.queue!();
      expect(
        items.map((i) => ({
          state: i.state,
          matched: i.matched,
          ...(i.downloadId ? { downloadId: i.downloadId } : {}),
        })),
      ).toEqual(fx.expect.queue);
      const queueCall = http.calls.find((c) => c.path.endsWith('/queue'));
      expect(Object.keys(queueCall!.query ?? {}).some((k) => k.startsWith('includeUnknown'))).toBe(true);
    });
  }

  if (fx.expect.queueExtras) {
    it('reads library state, tags and title keys of queue entries', async () => {
      const { adapter } = instantiate(def, fx);
      const first = (await adapter.queue!()).find((i) => i.matched)!;
      expect({ inLibrary: first.inLibrary, tags: first.tags, titleKey: first.titleKey }).toMatchObject(
        fx.expect.queueExtras!,
      );
    });
  }

  if (fx.expect.importPreview) {
    it('reads the manual import preview', async () => {
      const { adapter } = instantiate(def, fx);
      const files = await adapter.importPreview!(fx.expect.importPreview!.downloadId);
      expect(files.map((f) => ({ target: f.target, rejections: f.rejections }))).toEqual(
        fx.expect.importPreview!.files,
      );
    });
  }

  if (fx.expect.wantedMissing) {
    it('reads the wanted list', async () => {
      const { adapter } = instantiate(def, fx);
      const items = await adapter.wanted!('missing', { monitoredOnly: true, max: 50 });
      expect(items.map((i) => ({ key: i.key, title: i.title }))).toEqual(fx.expect.wantedMissing);
    });
  }

  if (fx.expect.history) {
    it('reads history events', async () => {
      const { adapter } = instantiate(def, fx);
      const events = await adapter.historySince!(fx.expect.history!.since);
      expect(events.map((e) => ({ type: e.type, mediaId: e.mediaId }))).toEqual(fx.expect.history!.events);
    });
  }

  if (fx.expect.remove) {
    it('removes a queue entry or download job', async () => {
      const { adapter, http } = instantiate(def, fx);
      const r = fx.expect.remove!;
      if (adapter.removeQueueItem)
        await adapter.removeQueueItem(Number(r.id), { removeFromClient: true, blocklist: true });
      else await adapter.removeDownload!(String(r.id), { deleteFiles: true });
      expect(http.calls.some((c) => c.path === r.path && c.method && c.method !== 'GET')).toBe(true);
    });
  }

  if (fx.expect.search) {
    it('starts a search command', async () => {
      const { adapter, http } = instantiate(def, fx);
      await adapter.search!(fx.expect.search!.target as never);
      const call = http.calls.find((c) => c.method === 'POST' && c.path.endsWith('/command'));
      expect(call?.json).toMatchObject(fx.expect.search!.body);
    });
  }

  if (fx.expect.calendar) {
    it('reads the calendar of monitored titles', async () => {
      const { adapter, http } = instantiate(def, fx);
      const c = fx.expect.calendar!;
      const entries = await adapter.calendar!(c.start, c.end);
      expect(entries).toHaveLength(c.entries.length);
      entries.forEach((e, i) => expect(e).toMatchObject(c.entries[i]!));
      const call = http.calls.find((x) => x.path.endsWith('/calendar'));
      expect(call?.query).toMatchObject({ start: c.start, end: c.end, unmonitored: false });
    });
  }

  if (def.capabilities.includes('calendar')) {
    it('has calendar fixtures', () => expect(fx.expect.calendar).toBeDefined());
  }

  if (def.capabilities.includes('downloads')) {
    it('can remove download jobs', () => {
      const { adapter } = instantiate(def, fx);
      expect(typeof adapter.removeDownload).toBe('function');
    });
  }

  if (fx.expect.sessions) {
    it('lists active streams', async () => {
      const { adapter } = instantiate(def, fx);
      const sessions = await adapter.sessions!();
      expect(sessions.map((s) => ({ title: s.title, state: s.state, transcoding: s.transcoding }))).toEqual(
        fx.expect.sessions,
      );
    });
  }

  if (fx.expect.downloads) {
    it('lists downloads', async () => {
      const { adapter } = instantiate(def, fx);
      const jobs = await adapter.downloads!();
      expect(jobs.map((j) => ({ state: j.state }))).toEqual(fx.expect.downloads);
      for (const j of jobs) expect(j.progress).toBeGreaterThanOrEqual(0);
    });
  }

  if (fx.expect.indexers) {
    it('lists indexers with their failure state', async () => {
      const { adapter } = instantiate(def, fx);
      const list = await adapter.indexers!();
      expect(list.map((i) => ({ name: i.name, failing: i.failing }))).toEqual(fx.expect.indexers);
    });
  }

  if (def.capabilities.includes('settings')) {
    it('never exposes secrets in settings', async () => {
      const { adapter } = instantiate(def, fx);
      const sections = await adapter.settings!();
      const dump = JSON.stringify(sections);
      for (const v of Object.values(fx.credentials))
        if (typeof v === 'string' && v) expect(dump).not.toContain(v);
      expect(sections.flatMap((s) => s.entries).some((e) => e.secret)).toBe(true);
    });
  }

  if (def.capabilities.includes('storage')) {
    it('reports mounts and root folders, without system mounts', async () => {
      const { adapter } = instantiate(def, fx);
      const report = await adapter.storage!();
      expect(report.rootFolders.map((r) => r.path)).toEqual(fx.expect.storage?.rootFolders);
      const disks = groupDisks([{ instance: { id: 'inst-1', name: 'x', adapter: def.id }, report }]);
      const paths = disks.flatMap((d) => d.members.map((m) => m.path)).sort();
      expect(paths).toEqual(fx.expect.storage?.mounts);
      expect(disks.find((d) => d.media)?.members[0]?.rootFolders).toEqual(fx.expect.storage?.rootFolders);
    });
  }

  if (def.capabilities.includes('qualityScore')) {
    it('reads every file with its custom formats and media info', async () => {
      const { adapter } = instantiate(def, fx);
      const progress: Array<[number, number]> = [];
      const scan = await adapter.qualityScan!((done, total) => progress.push([done, total]));
      const want = fx.expect.quality!;
      expect(scan.titles).toHaveLength(want.titles);
      expect(scan.files).toHaveLength(want.files);
      expect(scan.titles[0]?.webUrl).toBe(`${fx.baseUrl}${want.webUrl}`);
      expect(scan.files[0]?.formatIds.length).toBeGreaterThan(0);
      expect(scan.files[0]?.media.audioLanguages).toContain('ger');
      expect(progress.at(-1)?.[0]).toBe(progress.at(-1)?.[1]);
      const report = buildQualityReport(scan);
      expect(report.profiles[0]?.perfect).toBe(want.perfect);
      expect(report.files).toBe(want.files);
      expect(scan.files[0]?.name).toMatch(/\.mkv$/);
    });

    it('searches a better release for the worst files', async () => {
      const { adapter, http } = instantiate(def, fx);
      const want = fx.expect.quality!.search;
      expect(await adapter.qualitySearch!(want.files)).toBe(want.count);
      const call = http.calls.find((c) => c.method === 'POST' && c.path.endsWith('/command'));
      expect(call?.json).toEqual(want.body);
    });
  }

  it('does not leak credentials into web links', () => {
    const { adapter } = instantiate(def, fx);
    const url = adapter.webUrl?.({ kind: 'system' }) ?? '';
    for (const v of Object.values(fx.credentials))
      if (typeof v === 'string' && v) expect(url).not.toContain(v);
  });
});
