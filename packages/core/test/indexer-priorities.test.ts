import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRIORITY_CONFIG,
  analyzeSources,
  normalizePriorityConfig,
  planPriorities,
  targetPriorities,
  type ArrIndexerInfo,
  type ArrSide,
  type ProwlarrSide,
} from '../src/index.js';

const cfg = DEFAULT_PRIORITY_CONFIG;

describe('target priorities', () => {
  it('spreads the scores between best and worst in steps', () => {
    const t = targetPriorities(
      new Map([
        ['a', 95],
        ['b', 70],
        ['c', 55],
        ['d', null],
      ]),
      cfg,
    );
    expect(t.get('a')!.value).toBe(10);
    expect(t.get('c')!.value).toBe(40);
    // 25 of 40 points behind: 10 + 18.75, rounded to the step.
    expect(t.get('b')!.value).toBe(30);
    expect(t.has('d')).toBe(false);
  });

  it('keeps close scores close', () => {
    // All good indexers: 13 points apart are not spread over the whole range.
    const t = targetPriorities(
      new Map([
        ['a', 98],
        ['b', 88],
        ['c', 85],
      ]),
      cfg,
    );
    // 10 of at least 30 points behind: 10 + 10.
    expect([t.get('a')!.value, t.get('b')!.value, t.get('c')!.value]).toEqual([10, 20, 25]);
  });

  it('gives every indexer the best priority when all scores are equal', () => {
    const t = targetPriorities(
      new Map([
        ['a', 80],
        ['b', 80],
      ]),
      cfg,
    );
    expect([t.get('a')!.value, t.get('b')!.value]).toEqual([10, 10]);
  });

  it('keeps settings inside what the apps accept', () => {
    expect(normalizePriorityConfig({ best: 60, worst: -3, step: 0, includeApps: true })).toEqual({
      best: 1,
      worst: 50,
      step: 1,
      includeApps: true,
    });
    expect(normalizePriorityConfig({ best: 40, worst: 10 })).toMatchObject({ best: 10, worst: 40 });
  });
});

const arrIx = (id: number, name: string, baseUrl: string, priority: number) =>
  ({
    id,
    name,
    implementation: 'Newznab',
    protocol: 'usenet',
    baseUrl,
    enableRss: true,
    enableAutomaticSearch: true,
    enableInteractiveSearch: true,
    priority,
    tags: [],
  }) satisfies ArrIndexerInfo;

const prowlarr: ProwlarrSide = {
  instanceId: 'p',
  instanceName: 'Prowlarr',
  baseUrl: 'http://prowlarr.example.test:9696',
  indexers: [
    { id: 1, name: 'Lantern', enabled: true, protocol: 'usenet', failing: false, priority: 25 },
    { id: 2, name: 'Nightjar', enabled: true, protocol: 'usenet', failing: false, priority: 40 },
    { id: 3, name: 'Old Mill', enabled: false, protocol: 'usenet', failing: false, priority: 25 },
    { id: 4, name: 'Kettle', enabled: true, protocol: 'usenet', failing: false, priority: 25 },
  ],
  apps: [
    {
      id: 1,
      name: 'Sonarr',
      implementation: 'Sonarr',
      baseUrl: 'http://sonarr.example.test:8989',
      prowlarrUrl: 'http://prowlarr.example.test:9696',
      enabled: true,
      syncLevel: 'fullSync',
      indexerIds: [1, 2],
    },
    {
      id: 2,
      name: 'Radarr',
      implementation: 'Radarr',
      baseUrl: 'http://radarr.example.test:7878',
      prowlarrUrl: 'http://prowlarr.example.test:9696',
      enabled: true,
      syncLevel: 'addOnly',
      indexerIds: [1, 2],
    },
  ],
};

const arrs: ArrSide[] = [
  {
    instanceId: 's',
    instanceName: 'Sonarr',
    adapter: 'sonarr',
    baseUrl: 'http://sonarr.example.test:8989',
    indexers: [arrIx(1, 'Lantern (Prowlarr)', 'http://prowlarr.example.test:9696/1/', 25)],
  },
  {
    instanceId: 'r',
    instanceName: 'Radarr',
    adapter: 'radarr',
    baseUrl: 'http://radarr.example.test:7878',
    indexers: [
      arrIx(1, 'Lantern (Prowlarr)', 'http://prowlarr.example.test:9696/1/', 25),
      arrIx(2, 'Tunes', 'https://tunes.example.test/api', 25),
    ],
  },
];

describe('priority plan', () => {
  const analysis = analyzeSources([prowlarr], arrs);
  const scores = new Map<string, number | null>([
    ['p:p:1', 95],
    ['p:p:2', 60],
    ['p:p:3', 80],
    ['p:p:4', null],
    ['d:tunes', 70],
  ]);
  const find = (items: ReturnType<typeof planPriorities>, target: string, instanceId: string, name: string) =>
    items.find((i) => i.target === target && i.instanceId === instanceId && i.indexerName === name)!;

  it('writes Prowlarr priorities and leaves apps alone by default', () => {
    const items = planPriorities({ analysis, prowlarrs: [prowlarr], scores, config: cfg });
    expect(find(items, 'prowlarr', 'p', 'Lantern')).toMatchObject({ planned: 10, reason: 'change' });
    // Already where it belongs.
    expect(find(items, 'prowlarr', 'p', 'Nightjar')).toMatchObject({ planned: 40, reason: 'same' });
    expect(find(items, 'prowlarr', 'p', 'Old Mill').reason).toBe('disabled');
    expect(find(items, 'prowlarr', 'p', 'Kettle')).toMatchObject({ planned: 25, reason: 'noScore' });
    // Full Sync: Prowlarr pushes the new value itself.
    expect(find(items, 'app', 's', 'Lantern (Prowlarr)')).toMatchObject({
      reason: 'prowlarrSyncs',
      planned: 10,
      syncLevel: 'fullSync',
    });
    expect(find(items, 'app', 'r', 'Lantern (Prowlarr)').reason).toBe('appsOff');
    expect(find(items, 'app', 'r', 'Tunes').reason).toBe('appsOff');
  });

  it('writes to apps Prowlarr does not keep in sync when asked to', () => {
    const items = planPriorities({
      analysis,
      prowlarrs: [prowlarr],
      scores,
      config: { ...cfg, includeApps: true },
    });
    // Add and Remove Only: Prowlarr never pushes the priority.
    expect(find(items, 'app', 'r', 'Lantern (Prowlarr)')).toMatchObject({
      planned: 10,
      reason: 'change',
      syncLevel: 'addOnly',
    });
    // Added by hand in Radarr: scored from its grabs.
    expect(find(items, 'app', 'r', 'Tunes')).toMatchObject({ source: 'direct', reason: 'change' });
    expect(find(items, 'app', 's', 'Lantern (Prowlarr)').reason).toBe('prowlarrSyncs');
  });

  it('does not flip an indexer that sits near a step boundary', () => {
    const near = new Map<string, number | null>([
      ['p:p:1', 100],
      ['p:p:2', 0],
      // Raw target 22.2 rounds to 20, but the current 25 is less than one step away.
      ['p:p:4', 59.4],
    ]);
    const items = planPriorities({ analysis, prowlarrs: [prowlarr], scores: near, config: cfg });
    expect(find(items, 'prowlarr', 'p', 'Kettle')).toMatchObject({
      current: 25,
      planned: 25,
      reason: 'close',
    });
  });
});
