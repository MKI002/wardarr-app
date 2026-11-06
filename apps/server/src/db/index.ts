// Opens the SQLite database and applies migrations.
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema>;

export function migrationsFolder(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // Source layout: src/db -> ../../drizzle. Bundled layout: dist -> ./drizzle.
  const candidates = [path.resolve(here, '../../drizzle'), path.resolve(here, './drizzle')];
  return process.env.WARDARR_MIGRATIONS_DIR ?? candidates.find((c) => existsDir(c)) ?? candidates[0]!;
}

function existsDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Hashes of every migration this build knows, in order. */
export function knownMigrations(): string[] {
  return readMigrationFiles({ migrationsFolder: migrationsFolder() }).map((m) => m.hash);
}

/** Hashes of the migrations applied to a database, in order. Empty for a new database. */
export function appliedMigrations(sqlite: Database.Database): string[] {
  const table = sqlite
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
    .get();
  if (!table) return [];
  return (
    sqlite.prepare('SELECT hash FROM __drizzle_migrations ORDER BY created_at, id').all() as Array<{
      hash: string;
    }>
  ).map((r) => r.hash);
}

/** Migrations the migrator will apply, with the same rule it uses. */
function pendingMigrations(sqlite: Database.Database): number {
  const files = readMigrationFiles({ migrationsFolder: migrationsFolder() });
  if (appliedMigrations(sqlite).length === 0) return files.length;
  const last = sqlite
    .prepare('SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1')
    .get() as { created_at: number | string } | undefined;
  const lastMillis = Number(last?.created_at ?? 0);
  return files.filter((m) => m.folderMillis > lastMillis).length;
}

export interface OpenOptions {
  /**
   * Runs before migrations change an existing database, for example to back
   * it up. A new, empty database is not passed here.
   */
  beforeMigrate?: (sqlite: Database.Database, pending: number) => void;
}

/** Opens the database file in the data directory, or in memory for tests. */
export function openDatabase(
  file: string | ':memory:',
  opts: OpenOptions = {},
): { db: Db; sqlite: Database.Database; close(): void } {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  const db = drizzle(sqlite, { schema });
  if (opts.beforeMigrate && appliedMigrations(sqlite).length > 0) {
    const pending = pendingMigrations(sqlite);
    if (pending > 0) opts.beforeMigrate(sqlite, pending);
  }
  migrate(db, { migrationsFolder: migrationsFolder() });
  return { db, sqlite, close: () => sqlite.close() };
}

export { schema };
