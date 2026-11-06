// Backups of Wardarr's own database: automatic ones with smart retention,
// manual ones, one before every migration and one before every restore.
//
// Backups live as single files in the backup folder (by default `backups/` in
// the data directory). Their settings and pins live next to them, not in the
// database, so restoring a backup never changes the backup policy and the
// backup before a migration can be written before the database is usable.
import {
  DEFAULT_RETENTION_LEVEL,
  RETENTION_LEVELS,
  planRetention,
  retentionPolicy,
  simulateRetention,
  type BackupKind,
  type KeepReason,
  type RetentionLevel,
} from '@wardarr/core';
import Database from 'better-sqlite3';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  statfsSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { appliedMigrations, knownMigrations } from '../db/index.js';
import { HttpError } from '../http/validate.js';
import { createSecretBox } from '../security/crypto.js';
import { APP_VERSION } from '../version.js';
import {
  BackupFormatError,
  EXTENSION,
  decodeBackup,
  decodeHeader,
  encodeBackup,
  encodeBackupSync,
  encodeEncryptedBackup,
  isSqlite,
  keyId,
  sha256,
  type BackupHeader,
} from './format.js';
import { PENDING_DB, PENDING_MARKER } from './restore.js';

const ID_PATTERN = /^wardarr-\d{8}T\d{6}Z-(scheduled|manual|pre-migration|pre-restore|uploaded)-[0-9a-f]{6}$/;
const SETTINGS_FILE = 'settings.json';
const HEADER_READ = 64 * 1024;
const TICK_MS = 10 * 60_000;
/** Automatic backups pause when less than this is left on the backup disk. */
const MIN_FREE_BYTES = 200 * 1024 * 1024;

export type Compatibility = 'current' | 'older' | 'newer' | 'foreign';
/** Whether the credentials in a backup can be read after a restore. */
export type KeyState = 'same' | 'included' | 'foreign';

export interface BackupInfo {
  id: string;
  kind: BackupKind;
  createdAt: string;
  size: number;
  appVersion: string;
  encrypted: boolean;
  compatibility: Compatibility;
  key: KeyState;
  pinned: boolean;
  /** Why smart retention keeps it; empty when the next cleanup removes it. */
  keep: KeepReason[];
}

interface Settings {
  level: RetentionLevel;
  pinned: string[];
  lastRun?: { at: string; ok: boolean; error?: string };
}

export interface BackupServiceOptions {
  /** Folder for backup files. */
  dir: string;
  /** Data directory with the database; staged restores go here. */
  dataDir: string;
  /** The installation's secret key, to tell whether credentials stay readable. */
  secretKey: Buffer;
  now?: () => Date;
  /** Free bytes on the backup disk; replaceable for tests. */
  freeBytes?: (dir: string) => number;
  onChange?: () => void;
}

export interface RestoreOptions {
  passphrase?: string;
  /** Restore although the credentials in the backup cannot be read. */
  acceptKeyMismatch?: boolean;
}

export interface RestoreSummary {
  backupId: string;
  /** Services and notification channels whose credentials must be entered again. */
  credentialsCleared: number;
  migrationsToApply: number;
}

function stamp(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
}

function defaultFreeBytes(dir: string): number {
  const s = statfsSync(dir);
  return Number(s.bavail) * Number(s.bsize);
}

function readHead(file: string): Buffer {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(HEADER_READ);
    const n = readSync(fd, buf, 0, HEADER_READ, 0);
    return buf.subarray(0, n);
  } finally {
    closeSync(fd);
  }
}

function hasTable(sqlite: Database.Database, name: string): boolean {
  return !!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

function compatibility(migrations: string[], known: string[]): Compatibility {
  const prefix = (a: string[], b: string[]) => a.every((h, i) => b[i] === h);
  if (migrations.length === known.length && prefix(migrations, known)) return 'current';
  if (migrations.length < known.length && prefix(migrations, known)) return 'older';
  if (migrations.length > known.length && prefix(known, migrations)) return 'newer';
  return 'foreign';
}

export class BackupService {
  readonly dir: string;
  private readonly dataDir: string;
  private readonly key: Buffer;
  private readonly keyId: string;
  private readonly now: () => Date;
  private readonly freeBytes: (dir: string) => number;
  private sqlite: Database.Database | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private known: string[] | null = null;
  private listeners: Array<() => void> = [];

  constructor(opts: BackupServiceOptions) {
    this.dir = path.resolve(opts.dir);
    this.dataDir = path.resolve(opts.dataDir);
    this.key = opts.secretKey;
    this.keyId = keyId(opts.secretKey);
    this.now = opts.now ?? (() => new Date());
    this.freeBytes = opts.freeBytes ?? defaultFreeBytes;
    if (opts.onChange) this.listeners.push(opts.onChange);
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
  }

  /** Connects the live database once it is open. */
  attach(sqlite: Database.Database): void {
    this.sqlite = sqlite;
  }

  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  private changed(): void {
    for (const l of this.listeners) l();
  }

  private knownMigrations(): string[] {
    this.known ??= knownMigrations();
    return this.known;
  }

  /** Runs one backup operation at a time. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  // ------------------------------------------------------------ settings

  settings(): Settings {
    try {
      const raw = JSON.parse(readFileSync(path.join(this.dir, SETTINGS_FILE), 'utf8')) as Partial<Settings>;
      const level = (RETENTION_LEVELS as readonly number[]).includes(raw.level as number)
        ? (raw.level as RetentionLevel)
        : DEFAULT_RETENTION_LEVEL;
      return {
        level,
        pinned: Array.isArray(raw.pinned) ? raw.pinned.filter((p) => typeof p === 'string') : [],
        ...(raw.lastRun ? { lastRun: raw.lastRun } : {}),
      };
    } catch {
      return { level: DEFAULT_RETENTION_LEVEL, pinned: [] };
    }
  }

  private saveSettings(settings: Settings): void {
    const file = path.join(this.dir, SETTINGS_FILE);
    const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
    writeFileSync(tmp, JSON.stringify(settings, null, 2), { mode: 0o600 });
    renameSync(tmp, file);
  }

  /** Changes the retention level and cleans up right away. */
  async setLevel(level: RetentionLevel): Promise<void> {
    await this.exclusive(async () => {
      this.saveSettings({ ...this.settings(), level });
      this.prune();
    });
    this.changed();
  }

  setPinned(id: string, pinned: boolean): void {
    this.file(id);
    const settings = this.settings();
    const set = new Set(settings.pinned);
    if (pinned) set.add(id);
    else set.delete(id);
    this.saveSettings({ ...settings, pinned: [...set] });
    this.changed();
  }

  // ------------------------------------------------------------- listing

  /** Absolute path of a backup, after checking the id. */
  file(id: string): string {
    if (!ID_PATTERN.test(id)) throw new HttpError(404, 'notFound');
    // The path is built from the directory listing, never from the request.
    const wanted = `${id}${EXTENSION}`;
    const name = readdirSync(this.dir).find((f) => f === wanted);
    if (!name) throw new HttpError(404, 'notFound');
    return path.join(this.dir, name);
  }

  private header(id: string): BackupHeader {
    try {
      return decodeHeader(readHead(this.file(id))).header;
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(422, 'backupCorrupt');
    }
  }

  list(): BackupInfo[] {
    const settings = this.settings();
    const pinned = new Set(settings.pinned);
    const known = this.knownMigrations();
    const out: Array<Omit<BackupInfo, 'keep'>> = [];
    for (const name of readdirSync(this.dir)) {
      if (!name.endsWith(EXTENSION)) continue;
      const id = name.slice(0, -EXTENSION.length);
      const match = ID_PATTERN.exec(id);
      if (!match) continue;
      const file = path.join(this.dir, name);
      let header: BackupHeader;
      try {
        header = decodeHeader(readHead(file)).header;
      } catch {
        continue;
      }
      const enc = header.encryption;
      out.push({
        id,
        kind: match[1] as BackupKind,
        createdAt: header.createdAt,
        size: statSync(file).size,
        appVersion: header.appVersion,
        encrypted: !!enc,
        compatibility: compatibility(header.migrations, known),
        key: enc?.includesKey ? 'included' : header.keyId === this.keyId ? 'same' : 'foreign',
        pinned: pinned.has(id),
      });
    }
    out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const plan = planRetention(out, retentionPolicy(settings.level), this.now());
    return out.map((b) => ({ ...b, keep: plan.keep.get(b.id) ?? [] }));
  }

  /** Everything the backup settings page shows. */
  overview() {
    const settings = this.settings();
    const backups = this.list();
    const dbSize = this.liveSize();
    const sizes = backups.filter((b) => !b.encrypted).map((b) => b.size);
    const typical = sizes.length
      ? sizes.slice(0, 5).reduce((a, b) => a + b, 0) / Math.min(5, sizes.length)
      : 0;
    const now = this.now();
    const levels = RETENTION_LEVELS.map((level) => {
      const policy = retentionPolicy(level);
      const sim = simulateRetention(policy, now);
      return {
        ...policy,
        count: sim.points.length,
        reachDays: sim.reachDays,
        estimatedBytes: Math.round(sim.points.length * (typical || dbSize / 3)),
      };
    });
    let free: number | null;
    try {
      free = this.freeBytes(this.dir);
    } catch {
      free = null;
    }
    return {
      level: settings.level,
      levels,
      backups,
      lastRun: settings.lastRun ?? null,
      nextRunAt: this.upcomingRun(),
      storage: {
        usedBytes: backups.reduce((sum, b) => sum + b.size, 0),
        freeBytes: free,
        sameDiskAsData: this.sameDisk(),
      },
    };
  }

  private liveSize(): number {
    if (!this.sqlite) return 0;
    const row = this.sqlite
      .prepare('SELECT page_count * page_size AS size FROM pragma_page_count(), pragma_page_size()')
      .get() as { size: number } | undefined;
    return row?.size ?? 0;
  }

  private sameDisk(): boolean {
    try {
      return statSync(this.dir).dev === statSync(this.dataDir).dev;
    } catch {
      return true;
    }
  }

  /** When the next automatic backup runs; an overdue one runs at the next check. */
  private upcomingRun(): string | null {
    const due = this.nextRunAt();
    if (due === null) return null;
    return new Date(Math.max(Date.parse(due), this.now().getTime())).toISOString();
  }

  private nextRunAt(): string | null {
    const policy = retentionPolicy(this.settings().level);
    if (policy.intervalHours === null) return null;
    const last = this.list().find((b) => b.kind === 'scheduled');
    if (!last) return this.now().toISOString();
    return new Date(Date.parse(last.createdAt) + policy.intervalHours * 3600_000).toISOString();
  }

  // ------------------------------------------------------------ creating

  /**
   * Copies the database with VACUUM INTO, which gives a consistent, compact
   * file while the server keeps running. Login sessions are left out.
   */
  private snapshot(sqlite: Database.Database): Buffer {
    const tmp = path.join(this.dir, `.snapshot-${randomUUID()}.db`);
    try {
      sqlite.prepare('VACUUM INTO ?').run(tmp);
      const copy = new Database(tmp);
      try {
        copy.pragma('journal_mode = DELETE');
        copy.pragma('secure_delete = ON');
        if (hasTable(copy, 'sessions')) copy.prepare('DELETE FROM sessions').run();
      } finally {
        copy.close();
      }
      return readFileSync(tmp);
    } finally {
      rmSync(tmp, { force: true });
      rmSync(`${tmp}-journal`, { force: true });
    }
  }

  private headerFor(kind: BackupKind, db: Buffer, migrations: string[], at: Date): BackupHeader {
    return {
      format: 1,
      createdAt: at.toISOString(),
      kind,
      appVersion: APP_VERSION,
      migrations,
      dbSize: db.length,
      sha256: sha256(db),
      keyId: this.keyId,
      encryption: null,
    };
  }

  private write(kind: BackupKind, at: Date, data: Buffer): string {
    const id = `wardarr-${stamp(at)}-${kind}-${randomBytes(3).toString('hex')}`;
    const file = path.join(this.dir, `${id}${EXTENSION}`);
    const tmp = path.join(this.dir, `.${id}.tmp`);
    writeFileSync(tmp, data, { mode: 0o600 });
    renameSync(tmp, file);
    return id;
  }

  /** Backup before migrations change the database. Blocks; runs before the server starts. */
  createBeforeMigration(sqlite: Database.Database): string {
    const at = this.now();
    const db = this.snapshot(sqlite);
    const id = this.write(
      'pre-migration',
      at,
      encodeBackupSync(this.headerFor('pre-migration', db, appliedMigrations(sqlite), at), db),
    );
    this.prune();
    return id;
  }

  /** Makes a backup of the live database now. */
  create(kind: 'scheduled' | 'manual' | 'pre-restore'): Promise<BackupInfo> {
    return this.exclusive(async () => {
      const info = await this.createNow(kind);
      this.prune();
      return info;
    }).finally(() => this.changed());
  }

  private async createNow(kind: 'scheduled' | 'manual' | 'pre-restore'): Promise<BackupInfo> {
    const sqlite = this.sqlite;
    if (!sqlite) throw new HttpError(409, 'backupUnavailable');
    const at = this.now();
    const db = this.snapshot(sqlite);
    const data = await encodeBackup(this.headerFor(kind, db, appliedMigrations(sqlite), at), db);
    const id = this.write(kind, at, data);
    return this.list().find((b) => b.id === id)!;
  }

  /** Removes what smart retention no longer keeps. */
  prune(): string[] {
    const settings = this.settings();
    const backups = this.list();
    const plan = planRetention(backups, retentionPolicy(settings.level), this.now());
    for (const id of plan.remove) rmSync(path.join(this.dir, `${id}${EXTENSION}`), { force: true });
    if (plan.remove.length) {
      const gone = new Set(plan.remove);
      this.saveSettings({ ...settings, pinned: settings.pinned.filter((p) => !gone.has(p)) });
    }
    return plan.remove;
  }

  /** Called regularly: makes the automatic backup when it is due. */
  async tick(): Promise<void> {
    const due = this.nextRunAt();
    if (due === null || Date.parse(due) > this.now().getTime()) {
      await this.exclusive(async () => void this.prune());
      return;
    }
    let free = Number.POSITIVE_INFINITY;
    try {
      free = this.freeBytes(this.dir);
    } catch {
      // Unknown free space does not stop the backup.
    }
    const at = this.now().toISOString();
    if (free < MIN_FREE_BYTES + this.liveSize() * 2) {
      this.saveSettings({ ...this.settings(), lastRun: { at, ok: false, error: 'lowDisk' } });
      this.changed();
      return;
    }
    try {
      await this.create('scheduled');
      this.saveSettings({ ...this.settings(), lastRun: { at, ok: true } });
    } catch (err) {
      this.saveSettings({ ...this.settings(), lastRun: { at, ok: false, error: 'failed' } });
      throw err;
    } finally {
      this.changed();
    }
  }

  static readonly TICK_MS = TICK_MS;

  // ------------------------------------------------------- import/export

  async remove(id: string): Promise<void> {
    const file = this.file(id);
    await this.exclusive(async () => rmSync(file, { force: true }));
    const settings = this.settings();
    if (settings.pinned.includes(id))
      this.saveSettings({ ...settings, pinned: settings.pinned.filter((p) => p !== id) });
    this.changed();
  }

  /** A copy protected by a passphrase that also carries the secret key. */
  async exportProtected(id: string, passphrase: string): Promise<{ name: string; data: Buffer }> {
    const raw = readFileSync(this.file(id));
    const decoded = await this.decode(raw);
    if (decoded.header.encryption) throw new HttpError(409, 'alreadyEncrypted');
    const includeKey = decoded.header.keyId === this.keyId;
    const data = await encodeEncryptedBackup(
      decoded.header,
      decoded.db,
      passphrase,
      includeKey ? this.key : null,
    );
    return { name: `${id}-protected${EXTENSION}`, data };
  }

  /** Stores an uploaded backup, or a plain copy of a Wardarr database. */
  async importUpload(data: Buffer): Promise<BackupInfo> {
    return this.exclusive(async () => {
      let header: BackupHeader;
      let payload = data;
      if (isSqlite(data)) {
        const migrations = this.inspect(data).migrations;
        header = { ...this.headerFor('uploaded', data, migrations, this.now()), keyId: '' };
        payload = await encodeBackup(header, data);
      } else {
        try {
          header = decodeHeader(data).header;
        } catch (err) {
          throw new HttpError(422, err instanceof BackupFormatError ? err.code : 'notABackup');
        }
        if (!header.encryption) {
          const decoded = await this.decode(data);
          this.inspect(decoded.db);
        }
      }
      const at = new Date(header.createdAt);
      const id = this.write('uploaded', Number.isNaN(at.getTime()) ? this.now() : at, payload);
      return this.list().find((b) => b.id === id)!;
    }).finally(() => this.changed());
  }

  private async decode(data: Buffer, passphrase?: string) {
    try {
      return await decodeBackup(data, passphrase);
    } catch (err) {
      if (err instanceof BackupFormatError) {
        const status = err.code === 'passphraseRequired' || err.code === 'wrongPassphrase' ? 400 : 422;
        throw new HttpError(status, err.code === 'corrupt' ? 'backupCorrupt' : err.code);
      }
      throw err;
    }
  }

  /** Checks that a database file is intact and belongs to this Wardarr. */
  private inspect(db: Buffer): { migrations: string[] } {
    const tmp = path.join(this.dir, `.inspect-${randomUUID()}.db`);
    writeFileSync(tmp, db, { mode: 0o600 });
    try {
      const sqlite = new Database(tmp, { readonly: true });
      try {
        const check = sqlite.pragma('integrity_check', { simple: true });
        if (check !== 'ok') throw new HttpError(422, 'backupCorrupt');
        const migrations = appliedMigrations(sqlite);
        const compat = compatibility(migrations, this.knownMigrations());
        if (migrations.length === 0 || compat === 'foreign') throw new HttpError(422, 'notABackup');
        return { migrations };
      } finally {
        sqlite.close();
      }
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(422, 'backupCorrupt');
    } finally {
      rmSync(tmp, { force: true });
    }
  }

  // ------------------------------------------------------------- restore

  /**
   * Prepares a restore: checks the backup, makes the credentials readable
   * with this installation's key, backs up the current state and leaves the
   * database next to the live one. The swap happens on the next start.
   */
  stageRestore(id: string, opts: RestoreOptions = {}): Promise<RestoreSummary> {
    return this.exclusive(async () => {
      const header = this.header(id);
      const compat = compatibility(header.migrations, this.knownMigrations());
      if (compat === 'newer') throw new HttpError(409, 'backupTooNew');
      if (compat === 'foreign') throw new HttpError(409, 'notABackup');
      const decoded = await this.decode(readFileSync(this.file(id)), opts.passphrase);
      const sourceKey = decoded.secretKey ?? (header.keyId === this.keyId ? this.key : null);

      const staging = path.join(this.dataDir, `${PENDING_DB}.tmp`);
      rmSync(staging, { force: true });
      writeFileSync(staging, decoded.db, { mode: 0o600 });
      let cleared: number;
      try {
        const sqlite = new Database(staging);
        try {
          if (sqlite.pragma('integrity_check', { simple: true }) !== 'ok')
            throw new HttpError(422, 'backupCorrupt');
          sqlite.pragma('journal_mode = DELETE');
          sqlite.pragma('secure_delete = ON');
          const locked = this.countSecrets(sqlite);
          if (!sourceKey && locked > 0 && !opts.acceptKeyMismatch) {
            throw new HttpError(409, 'keyMismatch', { credentials: locked });
          }
          cleared = this.rekey(sqlite, sourceKey);
          if (hasTable(sqlite, 'sessions')) sqlite.prepare('DELETE FROM sessions').run();
        } finally {
          sqlite.close();
        }
        // The state right before the restore, so it can be undone.
        await this.createNow('pre-restore');
        renameSync(staging, path.join(this.dataDir, PENDING_DB));
        writeFileSync(
          path.join(this.dataDir, PENDING_MARKER),
          JSON.stringify({ backupId: id, stagedAt: this.now().toISOString() }),
          { mode: 0o600 },
        );
      } catch (err) {
        rmSync(staging, { force: true });
        throw err;
      }
      this.prune();
      return {
        backupId: id,
        credentialsCleared: cleared,
        migrationsToApply: this.knownMigrations().length - header.migrations.length,
      };
    }).finally(() => this.changed());
  }

  /** Encrypted credential rows: [table, id column, secret column, aad prefix]. */
  private static readonly SECRETS = [
    ['instances', 'id', 'secret_fields', ''],
    ['notification_channels', 'id', 'secret', 'notification:'],
  ] as const;

  private countSecrets(sqlite: Database.Database): number {
    let n = 0;
    for (const [table, , col] of BackupService.SECRETS) {
      if (!hasTable(sqlite, table)) continue;
      n += (
        sqlite.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${col} IS NOT NULL`).get() as { n: number }
      ).n;
    }
    return n;
  }

  /**
   * Re-encrypts stored credentials with this installation's key. Credentials
   * that cannot be decrypted are replaced by empty ones, so the service asks
   * for them again instead of failing on every poll.
   */
  private rekey(sqlite: Database.Database, sourceKey: Buffer | null): number {
    if (sourceKey && sourceKey.equals(this.key)) return 0;
    const from = sourceKey ? createSecretBox(sourceKey) : null;
    const to = createSecretBox(this.key);
    let cleared = 0;
    sqlite.transaction(() => {
      for (const [table, idCol, secretCol, prefix] of BackupService.SECRETS) {
        if (!hasTable(sqlite, table)) continue;
        const rows = sqlite
          .prepare(
            `SELECT ${idCol} AS id, ${secretCol} AS secret FROM ${table} WHERE ${secretCol} IS NOT NULL`,
          )
          .all() as Array<{
          id: string;
          secret: string;
        }>;
        const update = sqlite.prepare(`UPDATE ${table} SET ${secretCol} = ? WHERE ${idCol} = ?`);
        for (const row of rows) {
          const aad = `${prefix}${row.id}`;
          let plain: string | null;
          try {
            plain = from ? from.decrypt(row.secret, aad) : null;
          } catch {
            plain = null;
          }
          if (plain === null) cleared++;
          update.run(to.encrypt(plain ?? '{}', aad), row.id);
        }
      }
    })();
    return cleared;
  }
}
