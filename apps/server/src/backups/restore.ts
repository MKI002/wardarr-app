// Applies a staged restore while the database is closed, at startup.
import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';

export const PENDING_DB = 'restore-pending.db';
export const PENDING_MARKER = 'restore-pending.json';

/**
 * Replaces the database with a staged backup. Runs before the database is
 * opened, so no connection holds the old file. Returns the id of the restored
 * backup, or null when nothing was staged.
 */
export function applyPendingRestore(dataDir: string, dbFile: string): string | null {
  const marker = path.join(dataDir, PENDING_MARKER);
  const staged = path.join(dataDir, PENDING_DB);
  if (!existsSync(marker)) {
    // A staged file without its marker is a restore that never finished.
    rmSync(staged, { force: true });
    return null;
  }
  let backupId: string | null;
  try {
    backupId = String((JSON.parse(readFileSync(marker, 'utf8')) as { backupId?: unknown }).backupId ?? '');
  } catch {
    backupId = '';
  }
  if (existsSync(staged)) {
    rmSync(`${dbFile}-wal`, { force: true });
    rmSync(`${dbFile}-shm`, { force: true });
    renameSync(staged, dbFile);
  } else backupId = null;
  rmSync(marker, { force: true });
  return backupId;
}
