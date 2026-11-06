import { describe, expect, it } from 'vitest';
import {
  agentProduct,
  analyzeSources,
  downtimeIntervals,
  indexerScore,
  median,
  normalizeIndexerName,
  parseIndexerAddress,
  responseScore,
  stripProwlarrSuffix,
  uptimeRatio,
  type ArrIndexerInfo,
  type ArrSide,
  type ProwlarrSide,
} from '../src/index.js';

const arrIx = (id: number, name: string, baseUrl: string | null, extra: Partial<ArrIndexerInfo> = {}) =>
  ({
    id,
    name,
    implementation: 'Torznab',
    protocol: 'torrent',
    baseUrl,
    enableRss: true,
    enableAutomaticSearch: true,
    enableInteractiveSearch: true,
    priority: 25,
    tags: [],
    ...extra,
  }) satisfies ArrIndexerInfo;

const prowlarr: ProwlarrSide = {
  instanceId: 'prowlarr-1',
  instanceName: 'Prowlarr',
  baseUrl: 'http://prowlarr.example.test:9696',
  indexers: [
    {
      id: 1,
      name: 'Lantern',
      enabled: true,
      protocol: 'torrent',
      failing: false,
      urls: ['https://lantern.example.test/'],
      categories: [5000, 5040],
    },
    {
      id: 2,
      name: 'Nightjar',
      enabled: true,
      protocol: 'torrent',
      failing: true,
      urls: ['https://nightjar.example.test/'],
      categories: [2000],
    },
    {
      id: 3,
      name: 'Harbor Light',
      enabled: true,
      protocol: 'usenet',
      failing: false,
      urls: ['https://harbor.example.test/'],
      categories: [2000, 5000],
    },
    {
      id: 4,
      name: 'Songbird',
      enabled: true,
      protocol: 'torrent',
      failing: false,
      urls: [],
      categories: [3000],
    },
  ],
  apps: [
    {
      id: 1,
      name: 'Sonarr',
      implementation: 'Sonarr',
      baseUrl: 'http://sonarr.example.test:8989',
      prowlarrUrl: 'http://prowlarr:9696',
      enabled: true,
      syncLevel: 'fullSync',
      syncCategories: [5000, 5030, 5040],
      indexerIds: [1, 2, 3, 4],
    },
    {
      id: 2,
      name: 'Radarr',
      implementation: 'Radarr',
      baseUrl: 'http://radarr.example.test:7878/',
      prowlarrUrl: 'http://prowlarr:9696',
      enabled: true,
      syncLevel: 'addOnly',
      syncCategories: [2000],
      indexerIds: [1, 2, 3],
    },
    {
      id: 3,
      name: 'Old Readarr',
      implementation: 'Readarr',
      baseUrl: 'http://readarr.example.test:8787',
      prowlarrUrl: 'http://prowlarr:9696',
      enabled: true,
      indexerIds: [],
    },
  ],
};

const sonarr: ArrSide = {
  instanceId: 'sonarr-1',
  instanceName: 'Sonarr',
  adapter: 'sonarr',
  baseUrl: 'http://sonarr.example.test:8989',
  indexers: [
    arrIx(10, 'Lantern (Prowlarr)', 'http://prowlarr:9696/1/'),
    arrIx(11, 'Harbor Light (Prowlarr)', 'http://prowlarr:9696/3/', {
      protocol: 'usenet',
      implementation: 'Newznab',
    }),
  ],
};

const radarr: ArrSide = {
  instanceId: 'radarr-1',
  instanceName: 'Radarr',
  adapter: 'radarr',
  baseUrl: 'http://radarr.example.test:7878',
  indexers: [
    arrIx(20, 'Lantern (Prowlarr)', 'http://prowlarr:9696/1/'),
    arrIx(21, 'Nightjar (Prowlarr)', 'http://prowlarr:9696/2/'),
    // Added by hand next to the synced copy of the same site.
    arrIx(22, 'Lantern', 'https://lantern.example.test/api'),
    // Left behind after the indexer was deleted in Prowlarr (add only sync).
    arrIx(23, 'Gone Site (Prowlarr)', 'http://prowlarr:9696/9/'),
    arrIx(24, 'Paused', 'https://paused.example.test', {
      enableRss: false,
      enableAutomaticSearch: false,
      enableInteractiveSearch: false,
    }),
  ],
};

const lidarr: ArrSide = {
  instanceId: 'lidarr-1',
  instanceName: 'Lidarr',
  adapter: 'lidarr',
  baseUrl: 'http://lidarr.example.test:8686',
  indexers: [
    arrIx(30, 'Songbird', 'https://songbird.example.test'),
    arrIx(31, 'Tunes', 'https://tunes.example.test'),
  ],
};

describe('indexer sources', () => {
  const result = analyzeSources([prowlarr], [sonarr, radarr, lidarr]);
  const report = (id: string) => result.arrs.find((a) => a.instanceId === id)!;

  it('recognises an app that takes every indexer from Prowlarr', () => {
    const r = report('sonarr-1');
    expect(r.mode).toBe('prowlarr');
    expect(r.prowlarrApp).toMatchObject({ appId: 1, prowlarrInstanceId: 'prowlarr-1' });
    expect(r.indexers.map((i) => [i.source, i.evidence, i.prowlarr?.indexerId])).toEqual([
      ['prowlarr', 'url', 1],
      ['prowlarr', 'url', 3],
    ]);
  });

  it('reports indexers Prowlarr should sync but the app lacks, respecting categories', () => {
    // Nightjar is movies only and Songbird music only: Prowlarr does not sync them to Sonarr.
    expect(report('sonarr-1').missing).toEqual([]);
    // Radarr lacks Harbor Light (movies + TV).
    expect(report('radarr-1').missing.map((m) => m.name)).toEqual(['Harbor Light']);
  });

  it('finds mixed setups, duplicates, leftovers and switched off entries', () => {
    const r = report('radarr-1');
    expect(r.mode).toBe('mixed');
    const byId = new Map(r.indexers.map((i) => [i.id, i]));
    expect(byId.get(22)).toMatchObject({ source: 'direct', key: 'p:prowlarr-1:1' });
    expect(byId.get(20)!.flags).toContain('duplicate');
    expect(byId.get(22)!.duplicateOf).toEqual(['Lantern (Prowlarr)']);
    expect(byId.get(23)!.flags).toContain('orphan');
    expect(byId.get(24)!.flags).toEqual(['searchOff']);
    expect(r.counts).toMatchObject({
      total: 5,
      synced: 3,
      direct: 2,
      duplicate: 2,
      missing: 1,
      orphan: 1,
      searchOff: 1,
    });
  });

  it('treats an app without a Prowlarr entry as direct and links known sites by name', () => {
    const r = report('lidarr-1');
    expect(r.mode).toBe('direct');
    expect(r.prowlarrApp).toBeNull();
    expect(r.indexers[0]!.key).toBe('p:prowlarr-1:4');
    expect(r.indexers[1]!.key).toBe('d:tunes');
  });

  it('builds the apps x sites matrix', () => {
    const cell = (key: string, inst: string) =>
      result.cells.find((c) => c.key === key && c.instanceId === inst)?.state;
    expect(cell('p:prowlarr-1:1', 'sonarr-1')).toBe('synced');
    expect(cell('p:prowlarr-1:1', 'radarr-1')).toBe('both');
    expect(cell('p:prowlarr-1:3', 'radarr-1')).toBe('missing');
    expect(cell('d:paused', 'radarr-1')).toBe('off');
    expect(cell('p:prowlarr-1:4', 'lidarr-1')).toBe('direct');
    expect(result.trackers.find((t) => t.key === 'd:tunes')).toMatchObject({ name: 'Tunes', prowlarr: null });
  });

  it('lists Prowlarr apps Wardarr does not know', () => {
    expect(result.unmatchedApps.map((a) => a.name)).toEqual(['Old Readarr']);
  });

  it('recognises synced entries by name when the address is unknown', () => {
    const other = analyzeSources(
      [prowlarr],
      [
        {
          ...sonarr,
          instanceId: 's2',
          baseUrl: 'http://elsewhere.example.test',
          indexers: [arrIx(1, 'Lantern (Prowlarr)', 'http://192.0.2.9:9696/1/')],
        },
      ],
    );
    const ix = other.arrs[0]!.indexers[0]!;
    expect(ix).toMatchObject({ source: 'prowlarr', evidence: 'name', key: 'p:prowlarr-1:1' });
    const unknown = analyzeSources(
      [],
      [{ ...sonarr, indexers: [arrIx(1, 'Somewhere (Prowlarr)', 'http://192.0.2.9:9696/1/')] }],
    );
    expect(unknown.arrs[0]!.indexers[0]!.flags).toEqual(['unknownProwlarr']);
    expect(unknown.arrs[0]!.mode).toBe('prowlarr');
  });

  it('matches apps behind one host by path, product and name, never by guess', () => {
    const host = 'http://apps.example.test';
    const app = (id: number, name: string, implementation: string, path: string) => ({
      id,
      name,
      implementation,
      baseUrl: `${host}${path}`,
      prowlarrUrl: 'http://prowlarr:9696',
      enabled: true,
      indexerIds: [1],
    });
    const shared: ProwlarrSide = {
      ...prowlarr,
      apps: [app(1, 'Sonarr', 'Sonarr', '/sonarr'), app(2, 'Radarr', 'Radarr', '/radarr')],
    };
    const side = (instanceId: string, instanceName: string, adapter: string, path: string): ArrSide => ({
      instanceId,
      instanceName,
      adapter,
      baseUrl: `${host}${path}`,
      indexers: [arrIx(1, 'Tunes', 'https://tunes.example.test')],
    });
    const r = analyzeSources(
      [shared],
      [
        side('a', 'Sonarr', 'sonarr', '/sonarr'),
        side('b', 'Radarr', 'radarr', '/radarr'),
        // A second Sonarr on the same host that Prowlarr does not know.
        side('c', 'Sonarr 4K', 'sonarr', '/sonarr4k'),
      ],
    );
    const appOf = (id: string) => r.arrs.find((a) => a.instanceId === id)!.prowlarrApp?.appId ?? null;
    expect(appOf('a')).toBe(1);
    expect(appOf('b')).toBe(2);
    expect(appOf('c')).toBeNull();
  });

  it('marks apps it could not read as unknown', () => {
    const r = analyzeSources([prowlarr], [{ ...sonarr, indexers: null }]);
    expect(r.arrs[0]!.mode).toBe('unknown');
  });
});

describe('indexer helpers', () => {
  it('strips the Prowlarr suffix quickly, even from long runs of spaces', () => {
    expect(stripProwlarrSuffix('  Lantern (Prowlarr) ')).toBe('Lantern');
    expect(stripProwlarrSuffix('Lantern')).toBe('Lantern');
    const started = performance.now();
    normalizeIndexerName(`a${' '.repeat(50_000)}b`);
    expect(performance.now() - started).toBeLessThan(200);
  });

  it('normalizes names and addresses', () => {
    expect(normalizeIndexerName('Harbor-Light.info (Prowlarr)')).toBe('harborlight');
    expect(parseIndexerAddress('https://Example.test/x/')).toEqual({
      host: 'example.test',
      port: '443',
      path: '/x',
    });
    expect(parseIndexerAddress('prowlarr:9696')).toEqual({ host: 'prowlarr', port: '9696', path: '' });
    expect(parseIndexerAddress('::nope')).toBeNull();
  });

  it('computes downtime and uptime', () => {
    const iv = downtimeIntervals(
      [
        { at: 20, failing: false },
        { at: 50, failing: true },
        { at: 60, failing: true },
        { at: 70, failing: false },
        { at: 90, failing: true },
      ],
      0,
      100,
      { at: -5, failing: true },
    );
    expect(iv).toEqual([
      { start: 0, end: 20 },
      { start: 50, end: 70 },
      { start: 90, end: 100 },
    ]);
    expect(uptimeRatio(iv, 0, 100)).toBeCloseTo(0.5);
  });

  it('scores indexers and skips missing parts', () => {
    expect(responseScore(300)).toBe(1);
    expect(responseScore(9000)).toBe(0);
    expect(indexerScore({ successRate: 1, averageResponseMs: 200, uptime: 1, importRate: 1 })).toBe(100);
    expect(indexerScore({ successRate: null, averageResponseMs: null, uptime: null, importRate: 0.5 })).toBe(
      50,
    );
    expect(
      indexerScore({ successRate: null, averageResponseMs: null, uptime: null, importRate: null }),
    ).toBeNull();
    expect(median([3, 1, 2, 4])).toBe(2.5);
    expect(agentProduct('Sonarr/4.0.15.2941 (ubuntu 24.04)')).toBe('Sonarr');
  });
});

import { DAY_MS, HOUR_MS, planStatsWindows } from '../src/index.js';

describe('stats windows', () => {
  const now = Date.UTC(2026, 10, 6, 14, 25);
  it('backfills 30 days: whole days first, then hours for the last week', () => {
    const w = planStatsWindows(null, now);
    const days = w.filter((x) => x.minutes === 1440);
    const hours = w.filter((x) => x.minutes === 60);
    expect(days).toHaveLength(23);
    expect(days[0]!.start).toBe(Date.UTC(2026, 9, 7));
    expect(hours).toHaveLength(7 * 24 + 15);
    expect(hours.at(-1)!.start).toBe(Date.UTC(2026, 10, 6, 14));
  });
  it('reads the open hour again and continues from the cursor', () => {
    const w = planStatsWindows(Date.UTC(2026, 10, 6, 12), now);
    expect(w.map((x) => new Date(x.start).getUTCHours())).toEqual([12, 13, 14]);
  });
  it('fills a long gap per day and finishes a started day per hour', () => {
    const w = planStatsWindows(Date.UTC(2026, 9, 20, 21), now);
    expect(w.slice(0, 3).map((x) => x.minutes)).toEqual([60, 60, 60]);
    expect(w[3]).toEqual({ start: Date.UTC(2026, 9, 21), minutes: 1440 });
    expect(w.every((x, i) => i === 0 || x.start === w[i - 1]!.start + w[i - 1]!.minutes * 60_000)).toBe(true);
    expect(DAY_MS / HOUR_MS).toBe(24);
  });
});
