// How Wardarr changes a service's own block list: it adds what is wanted and
// takes away only what it put there itself, so entries a person added by
// hand in the service stay.

import { uniqueExtensions } from './extensions.js';

export interface ListPlan {
  /** The list the service should hold afterwards. */
  next: string[];
  added: string[];
  removed: string[];
  /** What Wardarr owns in the service afterwards. */
  managed: string[];
}

export function planList(
  current: readonly string[],
  managedBefore: readonly string[],
  wanted: readonly string[],
): ListPlan {
  const cur = new Set(uniqueExtensions(current));
  const want = new Set(uniqueExtensions(wanted));
  const removed = uniqueExtensions(managedBefore).filter((e) => !want.has(e) && cur.has(e));
  const added = [...want].filter((e) => !cur.has(e)).sort();
  const next = uniqueExtensions([...[...cur].filter((e) => !removed.includes(e)), ...want]);
  // Entries that were there before Wardarr stay the person's, even when wanted.
  const managed = uniqueExtensions([...uniqueExtensions(managedBefore).filter((e) => want.has(e)), ...added]);
  return { next, added, removed, managed };
}

export type TargetSync = 'inSync' | 'drift' | 'partial' | 'off';

/**
 * How a service's list compares with the wanted one. `partial` means the
 * service blocks what it can, but cannot hold every extension (Sonarr v4 and
 * Radarr only know fixed groups).
 */
export function compareList(
  current: readonly string[],
  wanted: readonly string[],
  opts: { active: boolean; possible?: readonly string[] },
): { sync: TargetSync; missing: string[]; unreachable: string[] } {
  const cur = new Set(uniqueExtensions(current));
  const want = uniqueExtensions(wanted);
  const possible = opts.possible ? new Set(opts.possible) : null;
  const unreachable = possible ? want.filter((e) => !possible.has(e)) : [];
  const missing = want.filter((e) => !cur.has(e) && (!possible || possible.has(e)));
  if (!opts.active) return { sync: 'off', missing, unreachable };
  if (missing.length) return { sync: 'drift', missing, unreachable };
  return { sync: unreachable.length ? 'partial' : 'inSync', missing, unreachable };
}
