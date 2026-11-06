// The fixed rule catalog. Order matters: the first rule that detects a
// signal wins, and the catch-all `unknownMessage` must stay last.
import type { IssueRule } from '../types.js';
import { credentialsRejected, instanceUnreachable } from './connection.js';
import { downloadClientUnavailable } from './downloadClients.js';
import { allIndexersUnavailable, indexerSearchUnavailable, indexerUnavailable } from './indexers.js';
import { attemptsExhausted, cleanerPaused, importReady, orphanedDownloads } from './cleaner.js';
import { downloadsFailed } from './queue.js';
import { remotePathMapping, rootFolderMissing } from './storage.js';
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
  rootFolderMissing,
  remotePathMapping,
  updateAvailable,
  cleanerPaused,
  importReady,
  attemptsExhausted,
  orphanedDownloads,
  downloadsFailed,
  mediaCacheRefresh,
  apiCompatibility,
  unknownMessage,
] as IssueRule[];

export * from './helpers.js';
