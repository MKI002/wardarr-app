// The fixed rule catalog. Order matters: the first rule that detects a
// signal wins, and the catch-all `unknownMessage` must stay last.
import type { IssueRule } from '../types.js';
import { credentialsRejected, instanceUnreachable } from './connection.js';
import { downloadClientUnavailable } from './downloadClients.js';
import {
  downloaderOffline,
  downloaderPaused,
  downloaderPortClosed,
  downloaderQuota,
  trackerErrors,
} from './downloaders.js';
import { allIndexersUnavailable, indexerSearchUnavailable, indexerUnavailable } from './indexers.js';
import { attemptsExhausted, cleanerPaused, importReady, orphanedDownloads } from './cleaner.js';
import { downloadsFailed } from './queue.js';
import { diskFillingUp, remotePathMapping, rootFolderMissing } from './storage.js';
import {
  trashGuideDrift,
  trashGuideFetchFailed,
  trashLocalDrift,
  trashSyncFailed,
  trashSyncPaused,
  trashUnsupported,
} from './trash.js';
import { transcodeFailures, transcodeNodeOffline, transcodeNoNodes, transcodeStuck } from './transcoding.js';
import { unknownMessage } from './unknown.js';
import { updateAvailable } from './updates.js';
import { apiCompatibility, mediaCacheRefresh } from './wardarr.js';

export const RULE_CATALOG: readonly IssueRule[] = [
  credentialsRejected,
  instanceUnreachable,
  indexerUnavailable,
  allIndexersUnavailable,
  indexerSearchUnavailable,
  downloadClientUnavailable,
  downloaderOffline,
  downloaderPortClosed,
  trackerErrors,
  downloaderQuota,
  downloaderPaused,
  rootFolderMissing,
  remotePathMapping,
  diskFillingUp,
  updateAvailable,
  cleanerPaused,
  importReady,
  attemptsExhausted,
  orphanedDownloads,
  downloadsFailed,
  transcodeNodeOffline,
  transcodeNoNodes,
  transcodeFailures,
  transcodeStuck,
  mediaCacheRefresh,
  apiCompatibility,
  trashSyncFailed,
  trashSyncPaused,
  trashGuideDrift,
  trashLocalDrift,
  trashUnsupported,
  trashGuideFetchFailed,
  unknownMessage,
] as IssueRule[];

export * from './helpers.js';
export { DOWNLOADER_SOURCES } from './downloaders.js';
