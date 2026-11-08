// Required Queue Cleaner tests. All titles are invented.
import { describe, expect, it, vi } from 'vitest';
import type { DownloadJob, ImportPreviewFile, QueueItem } from '../src/adapter/types.js';
import {
  DEFAULT_CLEANER_CONFIG,
  buildDownloads,
  detectInfrastructure,
  executePlan,
  findOrphans,
  importHint,
  planCleanerRun,
  type CleanerConfig,
  type CleanerInput,
  type CleanerPlan,
  type DownloadState,
  type TitleAttempts,
} from '../src/cleaner/index.js';

const T0 = new Date('2026-03-01T12:00:00Z');
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);
const hours = (n: number) => minutes(n * 60);

function item(over: Partial<QueueItem> = {}): QueueItem {
  return {
    id: 1,
    downloadId: 'DL0001',
    title: 'Example.Show.S01E01.1080p',
    mediaKind: 'episode',
    matched: true,
    mediaId: 10,
    state: 'failed',
    statusMessages: [],
    errorMessage: 'Download failed',
    sizeBytes: 1000,
    sizeLeftBytes: 1000,
    inLibrary: false,
    tags: [],
    titleKey: 'episode:101',
    searchTarget: { kind: 'episodes', ids: [101] },
    parentId: 10,
    seasonNumber: 1,
    ...over,
  };
}

const cleanPreview: ImportPreviewFile[] = [
  {
    path: '/dl/Example_Show_-_01.mkv',
    name: 'Example_Show_-_01',
    target: 'Example Show S01E01',
    rejections: [],
    raw: {},
  },
];
const rejectedPreview: ImportPreviewFile[] = [
  {
    path: '/dl/Example_Show_-_01.mkv',
    name: 'Example_Show_-_01',
    target: null,
    rejections: ['Unknown Series'],
    raw: {},
  },
];

interface Run {
  config?: Partial<CleanerConfig>;
  queue: QueueItem[];
  jobs?: DownloadJob[];
  previews?: Record<string, ImportPreviewFile[] | null>;
  now: Date;
  health?: CleanerInput['infra'];
  dryRun?: boolean;
}

/** Runs the planner repeatedly, carrying state between runs like the server does. */
function runner(initialAttempts: TitleAttempts[] = []) {
  let state = new Map<string, DownloadState>();
  let attempts = new Map(initialAttempts.map((a) => [a.titleKey, a]));
  return (r: Run): CleanerPlan => {
    const downloads = buildDownloads(r.queue, r.jobs);
    const plan = planCleanerRun({
      config: { ...DEFAULT_CLEANER_CONFIG, ...r.config },
      downloads,
      previews: new Map(Object.entries(r.previews ?? {})),
      infra: r.health ?? detectInfrastructure(downloads),
      state,
      attempts,
      now: r.now,
      dryRun: r.dryRun,
    });
    state = new Map(plan.nextState.map((s) => [s.key, s]));
    attempts = new Map(plan.nextAttempts.map((a) => [a.titleKey, a]));
    return plan;
  };
}

const only = (plan: CleanerPlan) => plan.downloads[0]!;

describe('Queue Cleaner', () => {
  it('1. sees and evaluates an entry without a library match', () => {
    const run = runner();
    const plan = run({
      queue: [
        item({
          matched: false,
          mediaId: undefined,
          titleKey: undefined,
          searchTarget: undefined,
          inLibrary: undefined,
          state: 'importBlocked',
          errorMessage: undefined,
          statusMessages: ['Unknown item. Unable to match to an existing item'],
        }),
      ],
      previews: { dl0001: rejectedPreview },
      now: T0,
    });
    expect(plan.downloads).toHaveLength(1);
    expect(only(plan)).toMatchObject({ matched: false, rule: 'importBlocked', strikes: 1 });
  });

  it('2. TBA waits without strikes and collects strikes after one week', () => {
    const run = runner();
    const tba = item({
      state: 'importBlocked',
      errorMessage: undefined,
      statusMessages: ['Episode has a TBA title and recently aired'],
    });
    expect(only(run({ queue: [tba], now: T0 }))).toMatchObject({ rule: 'tbaWaiting', strikes: 0 });
    expect(only(run({ queue: [tba], now: hours(24 * 6) }))).toMatchObject({ rule: 'tbaWaiting', strikes: 0 });
    expect(only(run({ queue: [tba], now: hours(24 * 7 + 1) }))).toMatchObject({
      rule: 'tbaExpired',
      strikes: 1,
    });
  });

  it('3. a clean preview creates the button and an issue, but no strikes and no import', () => {
    const run = runner();
    const blocked = item({
      state: 'importBlocked',
      errorMessage: undefined,
      statusMessages: ['Found matching series via grab history, but release was matched to series by ID'],
    });
    const plan = run({ queue: [blocked], previews: { dl0001: cleanPreview }, now: T0 });
    expect(only(plan)).toMatchObject({ rule: 'importReady', strikes: 0, action: { type: 'none' } });
    // The app's own words come along, and the "matched by ID" case is named.
    expect(only(plan).messages).toEqual(blocked.statusMessages);
    expect(only(plan).importHint).toBe('idOnly');
    expect(only(plan).waitUntil).toBe(hours(24 * 7).toISOString());
    // A week later it collects strikes like any other blocked import.
    expect(
      only(run({ queue: [blocked], previews: { dl0001: cleanPreview }, now: hours(24 * 7 + 1) })),
    ).toMatchObject({
      rule: 'importReadyExpired',
      strikes: 1,
    });
  });

  it('names imports the app holds back because only the search matched the title', () => {
    expect(
      importHint(['Found matching movie via grab history, but release was matched to movie by ID']),
    ).toBe('idOnly');
    expect(importHint(['Movie title mismatch, automatic import is not possible'])).toBe('idOnly');
    expect(importHint(['No files found are eligible for import'])).toBeNull();
    expect(importHint([])).toBeNull();
  });

  it('4. without waiting for the click, the same download collects strikes', () => {
    const run = runner();
    const blocked = item({ state: 'importBlocked', errorMessage: undefined });
    const plan = run({
      config: { waitForImportClick: false },
      queue: [blocked],
      previews: { dl0001: cleanPreview },
      now: T0,
    });
    expect(only(plan)).toMatchObject({ rule: 'importBlocked', strikes: 1, action: { type: 'strike' } });
  });

  it('5. a preview with objections leads to strikes', () => {
    const run = runner();
    const blocked = item({ state: 'importBlocked', errorMessage: undefined });
    expect(only(run({ queue: [blocked], previews: { dl0001: rejectedPreview }, now: T0 }))).toMatchObject({
      rule: 'importBlocked',
      strikes: 1,
    });
  });

  it('6. a full disk pauses the instance without strikes', () => {
    const run = runner();
    const full = item({
      state: 'warning',
      errorMessage: undefined,
      statusMessages: ['Not enough free space to import'],
    });
    const other = item({ id: 2, downloadId: 'DL0002', title: 'Other.Show.S01E01', state: 'failed' });
    const plan = run({ queue: [full, other], now: T0 });
    expect(plan.paused?.kind).toBe('diskFull');
    expect(plan.downloads.every((d) => d.rule === 'paused' && d.strikes === 0)).toBe(true);
    // Once the disk has space again, the cleaner continues by itself.
    const next = run({ queue: [other], now: minutes(5) });
    expect(next.paused).toBeNull();
    expect(only(next)).toMatchObject({ rule: 'failed', strikes: 1 });
  });

  it('7. removes a season pack exactly once, without 404 errors', async () => {
    const run = runner();
    const pack = [1, 2, 3].map((n) =>
      item({
        id: n,
        downloadId: 'PACK01',
        title: 'Example.Show.S01.1080p',
        titleKey: `episode:${100 + n}`,
        searchTarget: { kind: 'episodes', ids: [100 + n] },
      }),
    );
    let plan: CleanerPlan | null = null;
    for (let i = 0; i < 4; i++) plan = run({ queue: pack, now: minutes(i * 60) });
    expect(plan!.downloads).toHaveLength(1);
    const action = only(plan!).action;
    expect(action).toMatchObject({ type: 'remove', queueId: 1, blocklist: true });
    expect(action.type === 'remove' && action.search).toEqual({
      kind: 'season',
      seriesId: 10,
      seasonNumber: 1,
      episodeIds: [101, 102, 103],
    });

    const removed = new Set<number>();
    const ops = {
      removeQueueItem: vi.fn(async (id: number) => {
        // A real *arr removes all records of the download; a second call would 404.
        if (removed.size > 0) throw new Error('HTTP 404');
        removed.add(id);
      }),
      search: vi.fn(async () => {}),
    };
    const result = await executePlan(plan!, { dryRun: false }, ops);
    expect(ops.removeQueueItem).toHaveBeenCalledTimes(1);
    expect(result.every((r) => r.ok)).toBe(true);
  });

  it('8. custom strike count and interval apply', () => {
    const run = runner();
    const config = { maxStrikes: 2, strikeIntervalMinutes: 10 };
    const failed = item();
    expect(only(run({ config, queue: [failed], now: T0 })).strikes).toBe(1);
    // Too early for the next strike.
    const early = only(run({ config, queue: [failed], now: minutes(5) }));
    expect(early).toMatchObject({ strikes: 1, action: { type: 'none' } });
    expect(early.nextStrikeAt).toBe(minutes(10).toISOString());
    expect(only(run({ config, queue: [failed], now: minutes(10) })).action.type).toBe('remove');
  });

  it('9. strikes reset when the problem disappears', () => {
    const run = runner();
    const failing = item({ state: 'importBlocked', errorMessage: undefined });
    run({ queue: [failing], previews: { dl0001: rejectedPreview }, now: T0 });
    expect(
      only(run({ queue: [failing], previews: { dl0001: rejectedPreview }, now: minutes(60) })).strikes,
    ).toBe(2);
    const fine = item({ state: 'downloading', errorMessage: undefined, sizeLeftBytes: 500 });
    expect(only(run({ queue: [fine], now: minutes(65) }))).toMatchObject({ rule: 'healthy', strikes: 0 });
    expect(
      only(run({ queue: [failing], previews: { dl0001: rejectedPreview }, now: minutes(70) })).strikes,
    ).toBe(1);
  });

  it('10. a title already in the library is only removed, without blocklist or search', () => {
    const run = runner();
    const upgrade = item({ inLibrary: true });
    let plan: CleanerPlan | null = null;
    for (let i = 0; i < 4; i++) plan = run({ queue: [upgrade], now: minutes(i * 60) });
    expect(only(plan!).action).toEqual({
      type: 'remove',
      queueId: 1,
      blocklist: false,
      search: null,
      exhausted: false,
    });
    expect(plan!.nextAttempts).toEqual([]);
  });

  it('11. after 3 attempts there is no new search, and an issue is raised', () => {
    const run = runner([
      {
        titleKey: 'episode:101',
        title: 'Example.Show.S01E01.1080p',
        attempts: 3,
        lastAttemptAt: T0.toISOString(),
      },
    ]);
    let plan: CleanerPlan | null = null;
    for (let i = 0; i < 4; i++) plan = run({ queue: [item()], now: minutes(i * 60) });
    expect(only(plan!).action).toMatchObject({
      type: 'remove',
      blocklist: true,
      search: null,
      exhausted: true,
    });
    expect(plan!.exhausted.map((a) => a.titleKey)).toEqual(['episode:101']);
  });

  it('counts attempts and searches until the limit', () => {
    const run = runner();
    const searches: number[] = [];
    for (let attempt = 1; attempt <= 4; attempt++) {
      let plan: CleanerPlan | null = null;
      for (let i = 0; i < 4; i++)
        plan = run({ queue: [item({ downloadId: `DL${attempt}` })], now: hours(attempt * 10 + i) });
      const a = only(plan!).action;
      if (a.type === 'remove' && a.search) searches.push(attempt);
      run({ queue: [], now: hours(attempt * 10 + 5) });
    }
    expect(searches).toEqual([1, 2, 3]);
  });

  it('12. a dry run changes nothing on the services', async () => {
    const run = runner();
    let plan: CleanerPlan | null = null;
    for (let i = 0; i < 4; i++) plan = run({ queue: [item()], now: minutes(i * 60) });
    const ops = { removeQueueItem: vi.fn(), search: vi.fn() };
    const result = await executePlan(plan!, { dryRun: true }, ops);
    expect(ops.removeQueueItem).not.toHaveBeenCalled();
    expect(ops.search).not.toHaveBeenCalled();
    expect(result.map((r) => [r.kind, r.dryRun])).toEqual([
      ['removeBlocklist', true],
      ['search', true],
    ]);
  });

  it('a dry run keeps the state and uses up no attempts', () => {
    const run = runner();
    let plan: CleanerPlan | null = null;
    for (let i = 0; i < 5; i++)
      plan = run({ config: { dryRun: true }, queue: [item()], now: minutes(i * 60), dryRun: true });
    expect(only(plan!).action.type).toBe('remove');
    expect(plan!.nextAttempts).toEqual([]);
    expect(plan!.nextState[0]?.strikes).toBe(4);
  });

  it('13. reports an orphaned job but does not delete it', async () => {
    const jobs: DownloadJob[] = [
      {
        id: 'dl0001',
        name: 'Known',
        state: 'downloading',
        progress: 0.5,
        sizeBytes: 1,
        downloadedBytes: 0,
        speedBytesPerSecond: 1,
        etaSeconds: 1,
        category: null,
        addedAt: null,
      },
      {
        id: 'ORPHAN1',
        name: 'Unknown.Download',
        state: 'downloading',
        progress: 0.1,
        sizeBytes: 1,
        downloadedBytes: 0,
        speedBytesPerSecond: 1,
        etaSeconds: 1,
        category: null,
        addedAt: null,
      },
      {
        id: 'SEED1',
        name: 'Seeding.After.Import',
        state: 'seeding',
        progress: 1,
        sizeBytes: 1,
        downloadedBytes: 1,
        speedBytesPerSecond: 0,
        etaSeconds: null,
        category: null,
        addedAt: null,
      },
    ];
    const orphans = findOrphans(jobs, ['DL0001'], { now: T0, minAgeMinutes: 60 });
    expect(orphans.map((j) => j.id)).toEqual(['ORPHAN1']);
    // The planner only sees *arr queue entries, so an orphan never becomes a removal.
    const plan = runner()({
      queue: [item({ state: 'downloading', errorMessage: undefined })],
      jobs,
      now: T0,
    });
    const ops = { removeQueueItem: vi.fn(), search: vi.fn() };
    await executePlan(plan, { dryRun: false }, ops);
    expect(ops.removeQueueItem).not.toHaveBeenCalled();
  });

  it('protects downloads with a protection tag or on the whitelist', () => {
    const run = runner();
    const tagged = run({ queue: [item({ tags: ['wardarr-keep'] })], now: T0 });
    expect(only(tagged)).toMatchObject({ rule: 'protected', strikes: 0 });
    const listed = run({
      config: { whitelist: ['example.show'] },
      queue: [item({ downloadId: 'DL9' })],
      now: T0,
    });
    expect(only(listed)).toMatchObject({ rule: 'protected' });
  });

  it('marks downloads without progress as stalled after the threshold', () => {
    const run = runner();
    const slow = item({ state: 'downloading', errorMessage: undefined, sizeLeftBytes: 800 });
    expect(only(run({ queue: [slow], now: T0 })).rule).toBe('healthy');
    expect(only(run({ queue: [slow], now: hours(5) })).rule).toBe('healthy');
    expect(only(run({ queue: [slow], now: hours(6) })).rule).toBe('stalled');
  });

  it('slow downloads collect strikes only when enabled', () => {
    const jobs: DownloadJob[] = [
      {
        id: 'DL0001',
        name: 'x',
        state: 'downloading',
        progress: 0.1,
        sizeBytes: 1,
        downloadedBytes: 0,
        speedBytesPerSecond: 10,
        etaSeconds: null,
        category: null,
        addedAt: null,
      },
    ];
    const q = [item({ state: 'downloading', errorMessage: undefined })];
    expect(only(runner()({ queue: q, jobs, now: T0 })).rule).toBe('healthy');
    expect(only(runner()({ config: { slowEnabled: true }, queue: q, jobs, now: T0 })).rule).toBe('slow');
  });

  it('respects the maximum removals per run', () => {
    const run = runner();
    const queue = [1, 2, 3].map((n) => item({ id: n, downloadId: `DL${n}`, titleKey: `episode:${n}` }));
    let plan: CleanerPlan | null = null;
    for (let i = 0; i < 4; i++) plan = run({ config: { maxRemovalsPerRun: 2 }, queue, now: minutes(i * 60) });
    expect(plan!.downloads.map((d) => d.action.type)).toEqual(['remove', 'remove', 'deferred']);
  });
});
