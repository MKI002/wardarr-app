// Types of the Queue Cleaner. The decision logic is pure: it takes the
// queue, the previous state and the settings, and returns a plan.
import type {
  DownloadJob,
  ImportPreviewFile,
  QueueItemState,
  SearchTarget,
} from '../adapter/types.js';
import type { Msg, Signal } from '../issues/types.js';

export interface CleanerConfig {
  /** The cleaner evaluates the queue at all. */
  enabled: boolean;
  /** Plans and records decisions but never changes a service. */
  dryRun: boolean;
  maxStrikes: number;
  strikeIntervalMinutes: number;
  checkIntervalMinutes: number;
  tbaMaxWaitHours: number;
  /** Importable downloads wait for "Review import" instead of collecting strikes. */
  waitForImportClick: boolean;
  importClickMaxHours: number;
  attemptsPerTitle: number;
  stalledAfterHours: number;
  failedEnabled: boolean;
  slowEnabled: boolean;
  slowMinBytesPerSecond: number;
  maxRemovalsPerRun: number;
  /** Tags on the library entry or the download job that protect a download. */
  protectedTags: string[];
  /** Case-insensitive substrings of the title or download id that protect a download. */
  whitelist: string[];
}

export const DEFAULT_CLEANER_CONFIG: CleanerConfig = {
  enabled: true,
  dryRun: true,
  maxStrikes: 4,
  strikeIntervalMinutes: 60,
  checkIntervalMinutes: 5,
  tbaMaxWaitHours: 24 * 7,
  waitForImportClick: true,
  importClickMaxHours: 24 * 7,
  attemptsPerTitle: 3,
  stalledAfterHours: 6,
  failedEnabled: true,
  slowEnabled: false,
  slowMinBytesPerSecond: 100 * 1024,
  maxRemovalsPerRun: 20,
  protectedTags: ['wardarr-keep'],
  whitelist: [],
};

/** One download as the cleaner sees it. Season packs are merged into one. */
export interface CleanerDownload {
  /** Lowercased download id, or `queue:<id>` without one. */
  key: string;
  downloadId: string | null;
  /** All queue records of this download; the first is used for removal. */
  queueIds: number[];
  title: string;
  state: QueueItemState;
  matched: boolean;
  messages: string[];
  inLibrary: boolean | undefined;
  tags: string[];
  /** Key for attempt counting, for example `episode:12` or `season:3:1`. */
  titleKey: string | null;
  searchTarget: SearchTarget | null;
  sizeLeftBytes: number | null;
  /** From the download client, when it is connected. */
  speedBytesPerSecond: number | null;
  clientState: DownloadJob['state'] | null;
}

export type InfraKind = 'diskFull' | 'pathMissing' | 'permissions' | 'rootFolderMissing' | 'clientUnreachable';

export interface InfraProblem {
  kind: InfraKind;
  /** Original text that triggered it. */
  message: string;
}

/** Remembered per download between runs. */
export interface DownloadState {
  key: string;
  title: string;
  firstSeenAt: string;
  /** The rule that collected strikes or made the download wait. */
  problem: CleanerRule | null;
  problemSince: string | null;
  strikes: number;
  lastStrikeAt: string | null;
  lastProgressAt: string;
  lastSizeLeft: number | null;
  /** Set by "Ignore": the download is left alone. */
  ignored: boolean;
}

export interface TitleAttempts {
  titleKey: string;
  title: string;
  attempts: number;
  lastAttemptAt: string | null;
}

export type CleanerRule =
  | 'ignored'
  | 'protected'
  | 'paused'
  | 'tbaWaiting'
  | 'tbaExpired'
  | 'importReady'
  | 'importReadyExpired'
  | 'importBlocked'
  | 'failed'
  | 'stalled'
  | 'slow'
  | 'healthy';

/** Rules that collect strikes. */
export const STRIKE_RULES: ReadonlySet<CleanerRule> = new Set([
  'tbaExpired',
  'importReadyExpired',
  'importBlocked',
  'failed',
  'stalled',
  'slow',
]);

export type CleanerAction =
  | { type: 'none' }
  | { type: 'strike' }
  | {
      type: 'remove';
      queueId: number;
      blocklist: boolean;
      /** Search started after the removal, or null. */
      search: SearchTarget | null;
      /** The title used up its attempts with this removal. */
      exhausted: boolean;
    }
  /** Would be removed, but the per-run limit is reached. */
  | { type: 'deferred' };

export interface PlannedDownload {
  key: string;
  title: string;
  downloadId: string | null;
  queueIds: number[];
  matched: boolean;
  state: QueueItemState;
  rule: CleanerRule;
  strikes: number;
  maxStrikes: number;
  nextStrikeAt: string | null;
  /** Until when a waiting download waits without strikes. */
  waitUntil: string | null;
  action: CleanerAction;
  reason: Msg;
}

export interface CleanerInput {
  config: CleanerConfig;
  downloads: CleanerDownload[];
  /** Import previews of blocked downloads, by key. `null` means the preview failed. */
  previews: ReadonlyMap<string, ImportPreviewFile[] | null>;
  infra: InfraProblem | null;
  state: ReadonlyMap<string, DownloadState>;
  attempts: ReadonlyMap<string, TitleAttempts>;
  now: Date;
}

export interface CleanerPlan {
  paused: InfraProblem | null;
  downloads: PlannedDownload[];
  /** State to store after the run. Downloads that left the queue are dropped. */
  nextState: DownloadState[];
  nextAttempts: TitleAttempts[];
  /** Titles whose attempts are used up, for the issue and for Hunting. */
  exhausted: TitleAttempts[];
  removals: number;
}

export type { Signal };
