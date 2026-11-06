// Hunting tests. All titles are invented.
import { describe, expect, it } from 'vitest';
import type { HistoryEvent, WantedItem } from '../src/adapter/types.js';
import {
  DEFAULT_HUNTING_CONFIG,
  PACES,
  budgetLeft,
  isDue,
  pauseReason,
  resolveResult,
  scheduleUpcoming,
  searchesAllowed,
  selectCandidates,
  successStats,
  withPace,
  type HuntSearchRecord,
  type SelectInput,
} from '../src/hunting/index.js';

const NOW = new Date('2026-05-10T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

function movie(id: number, over: Partial<WantedItem> = {}): WantedItem {
  return {
    key: `movie:${id}`,
    title: `Example Movie ${id}`,
    mediaKind: 'movie',
    mediaId: id,
    monitored: true,
    tags: [],
    qualityProfileId: 1,
    year: 2020,
    releaseDate: daysAgo(100 - id),
    ...over,
  };
}

function episode(id: number, season: number, over: Partial<WantedItem> = {}): WantedItem {
  return {
    key: `episode:${id}`,
    title: `Episode ${id}`,
    mediaKind: 'episode',
    mediaId: id,
    parentId: 7,
    parentTitle: 'Example Show',
    seasonNumber: season,
    monitored: true,
    tags: [],
    releaseDate: daysAgo(50),
    ...over,
  };
}

function input(over: Partial<SelectInput>): SelectInput {
  return {
    list: 'missing',
    wanted: [],
    config: DEFAULT_HUNTING_CONFIG,
    lastSearched: new Map(),
    excluded: new Set(),
    exhausted: new Set(),
    now: NOW,
    ...over,
  };
}

describe('Hunting title selection', () => {
  it('prefers titles never searched, newest first, then the oldest searched', () => {
    const wanted = [movie(1), movie(2), movie(3), movie(4)];
    const lastSearched = new Map([
      ['movie:3', daysAgo(40)],
      ['movie:4', daysAgo(60)],
    ]);
    const keys = selectCandidates(input({ wanted, lastSearched })).map((c) => c.key);
    expect(keys).toEqual(['movie:2', 'movie:1', 'movie:4', 'movie:3']);
  });

  it('never searches a title again before the deadline', () => {
    const wanted = [movie(1), movie(2)];
    const lastSearched = new Map([
      ['movie:1', daysAgo(29)],
      ['movie:2', daysAgo(31)],
    ]);
    expect(selectCandidates(input({ wanted, lastSearched })).map((c) => c.key)).toEqual(['movie:2']);
    const custom = { ...DEFAULT_HUNTING_CONFIG, researchAfterDays: 10 };
    expect(selectCandidates(input({ wanted, lastSearched, config: custom })).map((c) => c.key)).toHaveLength(
      2,
    );
  });

  it('skips unmonitored, excluded, exhausted and unreleased titles', () => {
    const wanted = [
      movie(1, { monitored: false }),
      movie(2),
      movie(3),
      movie(4, { releaseDate: new Date(NOW.getTime() + 86_400_000).toISOString() }),
      movie(5),
    ];
    const keys = selectCandidates(
      input({ wanted, excluded: new Set(['movie:2']), exhausted: new Set(['movie:3']) }),
    ).map((c) => c.key);
    expect(keys).toEqual(['movie:5']);
  });

  it('applies tag, profile and year filters', () => {
    const wanted = [
      movie(1, { tags: [3] }),
      movie(2, { qualityProfileId: 9 }),
      movie(3, { year: 1990 }),
      movie(4, { tags: [3] }),
    ];
    const config = { ...DEFAULT_HUNTING_CONFIG, includeTags: [3] };
    expect(selectCandidates(input({ wanted, config })).map((c) => c.key)).toEqual(['movie:4', 'movie:1']);
    const profile = { ...DEFAULT_HUNTING_CONFIG, qualityProfileIds: [9] };
    expect(selectCandidates(input({ wanted, config: profile })).map((c) => c.key)).toEqual(['movie:2']);
    const years = { ...DEFAULT_HUNTING_CONFIG, minYear: 2000 };
    expect(selectCandidates(input({ wanted, config: years })).map((c) => c.key)).not.toContain('movie:3');
  });

  it('searches a season pack when several episodes of a season are missing', () => {
    const wanted = [episode(11, 1), episode(12, 1), episode(13, 1), episode(21, 2)];
    const [first, second] = selectCandidates(input({ wanted }));
    expect(first).toMatchObject({
      key: 'season:7:1',
      itemKeys: ['episode:11', 'episode:12', 'episode:13'],
      target: { kind: 'season', seriesId: 7, seasonNumber: 1, episodeIds: [11, 12, 13] },
      reason: { key: 'hunting.reason.seasonPack' },
    });
    expect(second).toMatchObject({ key: 'episode:21', target: { kind: 'episodes', ids: [21] } });
    const noPacks = { ...DEFAULT_HUNTING_CONFIG, preferSeasonPacks: false };
    expect(selectCandidates(input({ wanted, config: noPacks }))).toHaveLength(4);
  });

  it('skips a season whose cleaner attempts are used up', () => {
    const wanted = [episode(11, 1), episode(12, 1)];
    expect(selectCandidates(input({ wanted, exhausted: new Set(['season:7:1']) }))).toEqual([]);
  });
});

describe('Hunting limits', () => {
  it('stays within the API limit per hour', () => {
    const calls = Array.from({ length: 99 }, (_, i) => new Date(NOW.getTime() - i * 30_000).toISOString());
    const left = budgetLeft(calls, 100, NOW);
    expect(left).toBe(1);
    // Reading the list takes one call, so no search is left.
    expect(searchesAllowed(PACES.fast.missing, left, 1)).toBe(0);
    expect(
      pauseReason({
        config: DEFAULT_HUNTING_CONFIG,
        indexerProblem: null,
        queueSize: 0,
        budget: left,
        callsNeeded: 2,
      }),
    ).toMatchObject({
      kind: 'budget',
    });
    // Calls older than an hour no longer count.
    const later = new Date(NOW.getTime() + 3_600_000);
    expect(budgetLeft(calls, 100, later)).toBe(100);
  });

  it('pauses while the queue is full', () => {
    const p = pauseReason({
      config: DEFAULT_HUNTING_CONFIG,
      indexerProblem: null,
      queueSize: 15,
      budget: 100,
      callsNeeded: 2,
    });
    expect(p).toMatchObject({ kind: 'queueFull', reason: { params: { size: 15, limit: 15 } } });
    expect(
      pauseReason({
        config: DEFAULT_HUNTING_CONFIG,
        indexerProblem: null,
        queueSize: 14,
        budget: 100,
        callsNeeded: 2,
      }),
    ).toBeNull();
  });

  it('pauses and names the reason when an indexer fails', () => {
    const p = pauseReason({
      config: DEFAULT_HUNTING_CONFIG,
      indexerProblem: 'Example Indexer',
      queueSize: 0,
      budget: 100,
      callsNeeded: 2,
    });
    expect(p).toEqual({
      kind: 'indexer',
      reason: { key: 'hunting.pause.indexer', params: { name: 'Example Indexer' } },
    });
  });

  it('runs at the configured pace', () => {
    const rate = PACES.normal.missing;
    expect(isDue(rate, null, NOW)).toBe(true);
    expect(isDue(rate, new Date(NOW.getTime() - 59 * 60_000).toISOString(), NOW)).toBe(false);
    expect(isDue(rate, new Date(NOW.getTime() - 60 * 60_000).toISOString(), NOW)).toBe(true);
    expect(isDue(PACES.off.missing, null, NOW)).toBe(false);
    expect(withPace(DEFAULT_HUNTING_CONFIG, 'gentle').cutoff).toEqual({ count: 1, everyMinutes: 240 });
  });

  it('shows when the next titles are searched', () => {
    const candidates = selectCandidates(input({ wanted: [movie(1), movie(2), movie(3)] }));
    const at = scheduleUpcoming(candidates, PACES.normal.missing, NOW.toISOString(), NOW).map((c) => c.at);
    const inMin = (m: number) => new Date(NOW.getTime() + m * 60_000).toISOString();
    expect(at).toEqual([inMin(60), inMin(60), inMin(120)]);
  });
});

describe('Hunting results', () => {
  const search: HuntSearchRecord = {
    key: 'movie:1',
    title: 'Example Movie 1',
    list: 'missing',
    mediaIds: [1],
    at: NOW.toISOString(),
    manual: false,
    result: 'pending',
  };
  const ev = (type: HistoryEvent['type'], minutes: number, mediaId = 1): HistoryEvent => ({
    at: new Date(NOW.getTime() + minutes * 60_000).toISOString(),
    type,
    mediaId,
    downloadId: 'DLX',
  });
  const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

  it('reads found, downloaded and imported from the history', () => {
    expect(resolveResult(search, [], at(30))).toBe('pending');
    expect(resolveResult(search, [], at(180))).toBe('nothing');
    expect(resolveResult(search, [ev('grabbed', 5)], at(30))).toBe('grabbed');
    expect(resolveResult(search, [ev('grabbed', 5), ev('imported', 40)], at(60))).toBe('imported');
    expect(resolveResult(search, [ev('grabbed', 5, 2)], at(180))).toBe('nothing');
    expect(resolveResult(search, [ev('grabbed', -5)], at(180))).toBe('nothing');
  });

  it('computes the success rate', () => {
    const s = (result: HuntSearchRecord['result']) => ({ ...search, result });
    expect(successStats([s('imported'), s('nothing'), s('grabbed'), s('pending')])).toEqual({
      searches: 4,
      finished: 3,
      found: 2,
      imported: 1,
      rate: 2 / 3,
    });
    expect(successStats([]).rate).toBeNull();
  });
});
