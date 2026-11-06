// Types of Hunting: Wardarr searches missing titles and upgrades at a
// gentle pace so indexers are not flooded.
import type { SearchTarget } from '../adapter/types.js';
import type { Msg } from '../issues/types.js';

export type HuntList = 'missing' | 'cutoff';
export type HuntPace = 'off' | 'gentle' | 'normal' | 'fast' | 'custom';

/** `count` searches every `everyMinutes`. A count of 0 turns the list off. */
export interface HuntRate {
  count: number;
  everyMinutes: number;
}

export const PACES: Record<Exclude<HuntPace, 'custom'>, { missing: HuntRate; cutoff: HuntRate }> = {
  off: { missing: { count: 0, everyMinutes: 60 }, cutoff: { count: 0, everyMinutes: 60 } },
  gentle: { missing: { count: 1, everyMinutes: 60 }, cutoff: { count: 1, everyMinutes: 240 } },
  normal: { missing: { count: 2, everyMinutes: 60 }, cutoff: { count: 1, everyMinutes: 120 } },
  fast: { missing: { count: 5, everyMinutes: 60 }, cutoff: { count: 1, everyMinutes: 60 } },
};

export interface HuntingConfig {
  pace: HuntPace;
  missing: HuntRate;
  cutoff: HuntRate;
  /** All API calls of Hunting on this instance within a sliding hour. */
  apiCallsPerHour: number;
  /** Hunting pauses while the queue holds at least this many entries. */
  pauseQueueSize: number;
  /** A title is searched again at the earliest after this many days. */
  researchAfterDays: number;
  monitoredOnly: boolean;
  preferSeasonPacks: boolean;
  /** Only titles with at least one of these tag ids (empty: all). */
  includeTags: number[];
  excludeTags: number[];
  /** Only these quality profiles (empty: all). */
  qualityProfileIds: number[];
  minYear: number | null;
  maxYear: number | null;
}

export const DEFAULT_HUNTING_CONFIG: HuntingConfig = {
  pace: 'normal',
  ...PACES.normal,
  apiCallsPerHour: 100,
  pauseQueueSize: 15,
  researchAfterDays: 30,
  monitoredOnly: true,
  preferSeasonPacks: true,
  includeTags: [],
  excludeTags: [],
  qualityProfileIds: [],
  minYear: null,
  maxYear: null,
};

/** Applies a pace preset; `custom` keeps the given rates. */
export function withPace(config: HuntingConfig, pace: HuntPace): HuntingConfig {
  if (pace === 'custom') return { ...config, pace };
  return { ...config, pace, ...PACES[pace] };
}

export interface HuntCandidate {
  /** Key of the search: an item key or `season:<series>:<season>`. */
  key: string;
  /** Item keys this search covers, for the re-search deadline. */
  itemKeys: string[];
  title: string;
  list: HuntList;
  target: SearchTarget;
  reason: Msg;
}

export interface ScheduledCandidate extends HuntCandidate {
  at: string;
}

export type HuntResult = 'pending' | 'nothing' | 'grabbed' | 'imported' | 'failed';

export interface HuntSearchRecord {
  key: string;
  title: string;
  list: HuntList;
  /** Media ids of the search, matched against the history. */
  mediaIds: number[];
  at: string;
  manual: boolean;
  result: HuntResult;
}

export type HuntPauseKind = 'off' | 'indexer' | 'queueFull' | 'budget';

export interface HuntPause {
  kind: HuntPauseKind;
  reason: Msg;
}
