// Opens the SQLite database and applies migrations.
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema>;

function migrationsFolder(): string {
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

/** Opens the database file in the data directory, or in memory for tests. */
export function openDatabase(file: string | ':memory:'): { db: Db; close(): void } {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: migrationsFolder() });
  return { db, close: () => sqlite.close() };
}

export { schema };
