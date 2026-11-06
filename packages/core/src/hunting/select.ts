// Picks the titles Hunting searches next. Pure and deterministic.
import type { WantedItem } from '../adapter/types.js';
import type { HuntCandidate, HuntingConfig, HuntList } from './types.js';

const DAY = 86_400_000;

export interface SelectInput {
  list: HuntList;
  wanted: WantedItem[];
  config: HuntingConfig;
  /** Last search per item key. */
  lastSearched: ReadonlyMap<string, string>;
  /** Item or search keys excluded by the user. */
  excluded: ReadonlySet<string>;
  /** Item or season keys whose cleaner attempts are used up. */
  exhausted: ReadonlySet<string>;
  now: Date;
}

function passesFilters(w: WantedItem, c: HuntingConfig, now: Date): boolean {
  if (c.monitoredOnly && !w.monitored) return false;
  if (c.includeTags.length && !w.tags.some((t) => c.includeTags.includes(t))) return false;
  if (c.excludeTags.length && w.tags.some((t) => c.excludeTags.includes(t))) return false;
  if (
    c.qualityProfileIds.length &&
    (w.qualityProfileId === undefined || !c.qualityProfileIds.includes(w.qualityProfileId))
  )
    return false;
  if (c.minYear !== null && (w.year === undefined || w.year < c.minYear)) return false;
  if (c.maxYear !== null && (w.year === undefined || w.year > c.maxYear)) return false;
  // Titles that are not out yet cannot be found.
  if (w.releaseDate && Date.parse(w.releaseDate) > now.getTime()) return false;
  return true;
}

const seasonKey = (w: WantedItem) => `season:${w.parentId}:${w.seasonNumber}`;

/**
 * Returns all titles that may be searched now, in the order Hunting searches
 * them: titles never searched first (newest release first), then the titles
 * searched longest ago. Several missing episodes of a season become one
 * season search when `preferSeasonPacks` is on.
 */
export function selectCandidates(input: SelectInput): HuntCandidate[] {
  const { config: c, now } = input;
  const deadline = now.getTime() - c.researchAfterDays * DAY;

  const eligible = input.wanted.filter((w) => {
    if (!passesFilters(w, c, now)) return false;
    if (input.excluded.has(w.key) || input.exhausted.has(w.key)) return false;
    if (w.mediaKind === 'episode' && w.parentId !== undefined && w.seasonNumber !== undefined) {
      const sk = seasonKey(w);
      if (input.excluded.has(sk) || input.exhausted.has(sk)) return false;
    }
    const last = input.lastSearched.get(w.key);
    return !last || Date.parse(last) <= deadline;
  });

  interface Group {
    items: WantedItem[];
    season: boolean;
  }
  const groups = new Map<string, Group>();
  for (const w of eligible) {
    const canPack =
      c.preferSeasonPacks &&
      input.list === 'missing' &&
      w.mediaKind === 'episode' &&
      w.parentId !== undefined &&
      w.seasonNumber !== undefined &&
      w.seasonNumber > 0;
    const key = canPack ? seasonKey(w) : w.key;
    const g = groups.get(key) ?? { items: [], season: canPack };
    g.items.push(w);
    groups.set(key, g);
  }

  const candidates: (HuntCandidate & { lastAt: number | null; released: number })[] = [];
  for (const [key, g] of groups) {
    const first = g.items[0]!;
    const lastTimes = g.items
      .map((w) => input.lastSearched.get(w.key))
      .filter((x): x is string => !!x)
      .map(Date.parse);
    const lastAt = lastTimes.length === g.items.length ? Math.max(...lastTimes) : null;
    const released = Math.max(...g.items.map((w) => (w.releaseDate ? Date.parse(w.releaseDate) : 0)));
    if (g.season && g.items.length >= 2) {
      const episodeIds = g.items.map((w) => w.mediaId).sort((a, b) => a - b);
      candidates.push({
        key,
        itemKeys: g.items.map((w) => w.key),
        title: `${first.parentTitle ?? first.title} – S${String(first.seasonNumber).padStart(2, '0')}`,
        list: input.list,
        target: { kind: 'season', seriesId: first.parentId!, seasonNumber: first.seasonNumber!, episodeIds },
        reason: { key: 'hunting.reason.seasonPack', params: { count: g.items.length } },
        lastAt,
        released,
      });
      continue;
    }
    for (const w of g.items) {
      const last = input.lastSearched.get(w.key);
      const wLast = last ? Date.parse(last) : null;
      candidates.push({
        key: w.key,
        itemKeys: [w.key],
        title: w.parentTitle && w.parentTitle !== w.title ? `${w.parentTitle} – ${w.title}` : w.title,
        list: input.list,
        target: targetFor(w),
        reason:
          wLast === null
            ? { key: `hunting.reason.${input.list === 'missing' ? 'neverSearched' : 'upgradeNeverSearched'}` }
            : {
                key: 'hunting.reason.searchedBefore',
                params: { days: Math.floor((now.getTime() - wLast) / DAY) },
              },
        lastAt: wLast,
        released: w.releaseDate ? Date.parse(w.releaseDate) : 0,
      });
    }
  }

  candidates.sort((a, b) => {
    if (a.lastAt === null && b.lastAt !== null) return -1;
    if (a.lastAt !== null && b.lastAt === null) return 1;
    if (a.lastAt === null && b.lastAt === null)
      return b.released - a.released || b.itemKeys.length - a.itemKeys.length || a.key.localeCompare(b.key);
    return a.lastAt! - b.lastAt! || a.key.localeCompare(b.key);
  });
  return candidates.map(({ lastAt: _l, released: _r, ...c }) => c);
}

function targetFor(w: WantedItem): HuntCandidate['target'] {
  switch (w.mediaKind) {
    case 'movie':
      return { kind: 'movies', ids: [w.mediaId] };
    case 'album':
      return { kind: 'albums', ids: [w.mediaId] };
    case 'book':
      return { kind: 'books', ids: [w.mediaId] };
    default:
      return { kind: 'episodes', ids: [w.mediaId] };
  }
}

/** Media ids a search covers, for matching it against the history. */
export function targetMediaIds(target: HuntCandidate['target']): number[] {
  return target.kind === 'season' ? target.episodeIds : target.ids;
}
