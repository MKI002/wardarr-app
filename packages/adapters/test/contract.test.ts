// Contract tests: every adapter is checked against its invented fixtures.
// Fixtures live in ../fixtures/<adapter>.json and contain no real data.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CAPABILITIES } from '@wardarr/core';
import { AdapterError, type AdapterDefinition, type AdapterInstance } from '@wardarr/core';
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

  it('does not leak credentials into web links', () => {
    const { adapter } = instantiate(def, fx);
    const url = adapter.webUrl?.({ kind: 'system' }) ?? '';
    for (const v of Object.values(fx.credentials))
      if (typeof v === 'string' && v) expect(url).not.toContain(v);
  });
});
