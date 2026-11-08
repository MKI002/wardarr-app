// The analysis map: which indexer sent which kind of blocked file, and how
// much that costs each indexer in its score.

import { EXTENSION_PRESETS } from './extensions.js';

export interface FlowCatch {
  /** Indexer key from the indexer insights, null when no grab is known. */
  indexerKey: string | null;
  indexerName: string | null;
  extensions: readonly string[];
}

export interface FlowIndexer {
  key: string;
  name: string;
  caught: number;
  /** Grabs of this indexer in the same range, from *arr history. */
  grabs: number;
  /** caught / grabs, null without grabs. */
  rate: number | null;
}

export interface FlowLink {
  from: string;
  to: string;
  count: number;
}

export interface Flow {
  indexers: FlowIndexer[];
  extensions: Array<{ ext: string; count: number }>;
  links: FlowLink[];
  total: number;
}

export const UNKNOWN_KEY = '?';
export const OTHER_KEY = '*';

const RANK = new Map(EXTENSION_PRESETS.flatMap((p) => p.extensions).map((e, i) => [e, i]));

/** The extension a catch is filed under: the most telling one it contains. */
export function primaryExtension(extensions: readonly string[]): string {
  if (extensions.length === 0) return UNKNOWN_KEY;
  return [...extensions].sort(
    (a, b) => (RANK.get(a) ?? 999) - (RANK.get(b) ?? 999) || a.localeCompare(b),
  )[0]!;
}

function fold<T extends { count: number }>(items: T[], max: number, other: (rest: T[]) => T): T[] {
  if (items.length <= max) return items;
  const keep = items.slice(0, max - 1);
  return [...keep, other(items.slice(max - 1))];
}

export function buildFlow(
  catches: readonly FlowCatch[],
  grabsByIndexer: ReadonlyMap<string, { name: string; grabs: number }>,
  opts: { maxIndexers?: number; maxExtensions?: number } = {},
): Flow {
  const maxIndexers = opts.maxIndexers ?? 7;
  const maxExtensions = opts.maxExtensions ?? 6;
  const byIndexer = new Map<string, { name: string; caught: number }>();
  const byExt = new Map<string, number>();
  const pairs = new Map<string, number>();
  for (const c of catches) {
    const key = c.indexerKey ?? UNKNOWN_KEY;
    const ext = primaryExtension(c.extensions);
    const ix = byIndexer.get(key) ?? { name: c.indexerName ?? '', caught: 0 };
    ix.caught++;
    byIndexer.set(key, ix);
    byExt.set(ext, (byExt.get(ext) ?? 0) + 1);
    pairs.set(`${key}\u0000${ext}`, (pairs.get(`${key}\u0000${ext}`) ?? 0) + 1);
  }

  const rankedExt = [...byExt.entries()]
    .map(([ext, count]) => ({ ext, count }))
    .sort((a, b) => b.count - a.count || a.ext.localeCompare(b.ext));
  const extensions = fold(rankedExt, maxExtensions, (rest) => ({
    ext: OTHER_KEY,
    count: rest.reduce((s, r) => s + r.count, 0),
  }));
  const keptExt = new Set(extensions.map((e) => e.ext));

  const rankedIx = [...byIndexer.entries()]
    .map(([key, v]): FlowIndexer & { count: number } => {
      const grabs = grabsByIndexer.get(key)?.grabs ?? 0;
      return {
        key,
        name: v.name || grabsByIndexer.get(key)?.name || '',
        caught: v.caught,
        count: v.caught,
        grabs,
        rate: grabs > 0 ? Math.min(1, v.caught / grabs) : null,
      };
    })
    .sort((a, b) => b.caught - a.caught || a.name.localeCompare(b.name));
  const foldedIx = fold(rankedIx, maxIndexers, (rest) => {
    const caught = rest.reduce((s, r) => s + r.caught, 0);
    const grabs = rest.reduce((s, r) => s + r.grabs, 0);
    return {
      key: OTHER_KEY,
      name: '',
      caught,
      count: caught,
      grabs,
      rate: grabs > 0 ? caught / grabs : null,
    };
  });
  const keptIx = new Set(foldedIx.map((i) => i.key));

  const links = new Map<string, FlowLink>();
  for (const [pair, count] of pairs) {
    const [rawFrom, rawTo] = pair.split('\u0000') as [string, string];
    const from = keptIx.has(rawFrom) ? rawFrom : OTHER_KEY;
    const to = keptExt.has(rawTo) ? rawTo : OTHER_KEY;
    const id = `${from}\u0000${to}`;
    const l = links.get(id) ?? { from, to, count: 0 };
    l.count += count;
    links.set(id, l);
  }

  return {
    indexers: foldedIx.map(({ count: _count, ...rest }) => rest),
    extensions,
    links: [...links.values()].sort((a, b) => b.count - a.count),
    total: catches.length,
  };
}

/**
 * How much of an indexer's score its blocked downloads take: a clean
 * indexer keeps everything, one where every fifth grab is blocked loses all
 * of this part. Few grabs say too little, so below 3 there is no value.
 */
export function cleanScore(caught: number, grabs: number): number | null {
  if (grabs < 3) return null;
  return Math.max(0, 1 - 5 * Math.min(1, caught / grabs));
}
