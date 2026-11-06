// Backups: creating, smart retention, the backup before migrations, upload,
// passphrase export and restore, including the in-place restart.
import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeBackup, decodeHeader } from '../src/backups/format.js';
import { applyPendingRestore } from '../src/backups/restore.js';
import { BackupService } from '../src/backups/service.js';
import type { Config } from '../src/config.js';
import { migrationsFolder, openDatabase } from '../src/db/index.js';
import { HttpError } from '../src/http/validate.js';
import { createSecretBox } from '../src/security/crypto.js';
import { startServer } from '../src/server.js';
import { ADMIN, createTestApp, setupAdmin } from './helpers.js';

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'wardarr-backup-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  delete process.env.WARDARR_MIGRATIONS_DIR;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A file database with a backup service, like a running installation. */
function installation(opts: { key?: Buffer; now?: () => Date; freeBytes?: () => number } = {}) {
  const dataDir = tempDir();
  const key = opts.key ?? randomBytes(32);
  const dbFile = path.join(dataDir, 'wardarr.db');
  const backups = new BackupService({
    dir: path.join(dataDir, 'backups'),
    dataDir,
    secretKey: key,
    now: opts.now,
    freeBytes: opts.freeBytes ?? (() => 10 * 1024 ** 3),
  });
  let handle = openDatabase(dbFile);
  backups.attach(handle.sqlite);
  return {
    dataDir,
    dbFile,
    key,
    backups,
    get sqlite() {
      return handle.sqlite;
    },
    reopen() {
      handle.close();
      applyPendingRestore(dataDir, dbFile);
      handle = openDatabase(dbFile);
      backups.attach(handle.sqlite);
    },
    close: () => handle.close(),
  };
}

function addUser(sqlite: Database.Database, name: string) {
  sqlite
    .prepare("INSERT INTO users (id, username, role, created_at) VALUES (?, ?, 'admin', datetime('now'))")
    .run(name, name);
}
const usernames = (sqlite: Database.Database) =>
  (sqlite.prepare('SELECT username FROM users ORDER BY username').all() as Array<{ username: string }>).map(
    (r) => r.username,
  );

function addInstanceSecret(sqlite: Database.Database, key: Buffer, id: string, secret: object) {
  sqlite
    .prepare(
      "INSERT INTO instances (id, adapter, name, base_url, public_fields, secret_fields, enabled, created_at, updated_at) VALUES (?, 'fake', ?, 'http://service.test', '{}', ?, 1, datetime('now'), datetime('now'))",
    )
    .run(id, id, createSecretBox(key).encrypt(JSON.stringify(secret), id));
}
const instanceSecret = (sqlite: Database.Database, key: Buffer, id: string) => {
  const row = sqlite.prepare('SELECT secret_fields AS s FROM instances WHERE id = ?').get(id) as {
    s: string;
  };
  return JSON.parse(createSecretBox(key).decrypt(row.s, id)) as Record<string, unknown>;
};

describe('backups', () => {
  it('writes a verified, compressed copy without login sessions', async () => {
    const inst = installation();
    addUser(inst.sqlite, 'keeper');
    inst.sqlite
      .prepare(
        "INSERT INTO sessions (id, user_id, csrf_token, created_at, last_seen_at, expires_at) VALUES ('s1', 'keeper', 'c', '', '', '')",
      )
      .run();
    const info = await inst.backups.create('manual');
    expect(info).toMatchObject({ kind: 'manual', compatibility: 'current', key: 'same', encrypted: false });

    const decoded = await decodeBackup(readFileSync(inst.backups.file(info.id)));
    const copyPath = path.join(inst.dataDir, 'plain.db');
    writeFileSync(copyPath, decoded.db);
    const copy = new Database(copyPath, { readonly: true });
    expect(usernames(copy)).toEqual(['keeper']);
    expect(copy.prepare('SELECT count(*) AS n FROM sessions').get()).toEqual({ n: 0 });
    copy.close();
    // The backup holds no plain session id, not even in free pages.
    expect(decoded.db.includes(Buffer.from('csrf_token'))).toBe(true);
    expect(decoded.db.indexOf(Buffer.from('s1\u0000'))).toBe(-1);
    inst.close();
  });

  it('backs up the database before migrations change it', () => {
    const dataDir = tempDir();
    const partial = path.join(dataDir, 'migrations');
    cpSync(migrationsFolder(), partial, { recursive: true });
    const journalFile = path.join(partial, 'meta/_journal.json');
    const journal = JSON.parse(readFileSync(journalFile, 'utf8')) as { entries: unknown[] };
    journal.entries.pop();
    writeFileSync(journalFile, JSON.stringify(journal));

    const dbFile = path.join(dataDir, 'wardarr.db');
    const backups = new BackupService({
      dir: path.join(dataDir, 'backups'),
      dataDir,
      secretKey: randomBytes(32),
    });
    const calls: number[] = [];
    // A new database gets no backup.
    process.env.WARDARR_MIGRATIONS_DIR = partial;
    const first = openDatabase(dbFile, { beforeMigrate: () => calls.push(1) });
    first.close();
    expect(calls).toEqual([]);

    // An update brings one more migration: back up first.
    delete process.env.WARDARR_MIGRATIONS_DIR;
    const second = openDatabase(dbFile, {
      beforeMigrate: (sqlite, pending) => {
        calls.push(pending);
        backups.createBeforeMigration(sqlite);
      },
    });
    expect(calls).toEqual([1]);
    const [backup] = backups.list();
    expect(backup).toMatchObject({ kind: 'pre-migration', compatibility: 'older' });
    second.close();

    // Nothing pending on the next start, no further backup.
    const third = openDatabase(dbFile, { beforeMigrate: () => calls.push(99) });
    third.close();
    expect(calls).toEqual([1]);
  });

  it('makes automatic backups on time and thins them out', async () => {
    let now = new Date('2026-03-01T08:00:00Z');
    const inst = installation({ now: () => now });
    await inst.backups.setLevel(1);
    // 60 days with a tick every hour; level 1 backs up once a day.
    for (let h = 0; h < 60 * 24; h++) {
      await inst.backups.tick();
      now = new Date(now.getTime() + 3600_000);
    }
    const list = inst.backups.list();
    expect(list.every((b) => b.kind === 'scheduled')).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(9);
    expect(list.length).toBeLessThanOrEqual(14);
    expect(list.every((b) => b.keep.length > 0)).toBe(true);
    expect(inst.backups.settings().lastRun).toMatchObject({ ok: true });

    // Lowering the level cleans up right away, but keeps the newest one.
    await inst.backups.setLevel(0);
    expect(inst.backups.list().map((b) => b.keep)).toEqual([['latest']]);
    inst.close();
  });

  it('skips the automatic backup when the disk is almost full', async () => {
    const inst = installation({ freeBytes: () => 1024 });
    await inst.backups.tick();
    expect(inst.backups.list()).toEqual([]);
    expect(inst.backups.settings().lastRun).toMatchObject({ ok: false, error: 'lowDisk' });
    inst.close();
  });

  it('restores a backup and keeps the state before it', async () => {
    const inst = installation();
    addUser(inst.sqlite, 'before');
    const backup = await inst.backups.create('manual');
    addUser(inst.sqlite, 'after');

    const summary = await inst.backups.stageRestore(backup.id);
    expect(summary).toEqual({ backupId: backup.id, credentialsCleared: 0, migrationsToApply: 0 });
    expect(inst.backups.list().map((b) => b.kind)).toContain('pre-restore');
    // Nothing changes until the restart.
    expect(usernames(inst.sqlite)).toEqual(['after', 'before']);
    inst.reopen();
    expect(usernames(inst.sqlite)).toEqual(['before']);
    expect(existsSync(path.join(inst.dataDir, 'restore-pending.json'))).toBe(false);

    // The safety backup undoes the restore.
    const safety = inst.backups.list().find((b) => b.kind === 'pre-restore')!;
    await inst.backups.stageRestore(safety.id);
    inst.reopen();
    expect(usernames(inst.sqlite)).toEqual(['after', 'before']);
    inst.close();
  });

  it('asks before restoring credentials it cannot read, and clears them', async () => {
    const source = installation();
    addInstanceSecret(source.sqlite, source.key, 'sonarr-a', { apiKey: 'k1' });
    const backup = await source.backups.create('manual');
    const target = installation();
    cpSync(
      source.backups.file(backup.id),
      path.join(target.backups.dir, path.basename(source.backups.file(backup.id))),
    );
    expect(target.backups.list()[0]).toMatchObject({ key: 'foreign' });

    await expect(target.backups.stageRestore(backup.id)).rejects.toMatchObject({
      status: 409,
      code: 'keyMismatch',
    });
    const summary = await target.backups.stageRestore(backup.id, { acceptKeyMismatch: true });
    expect(summary.credentialsCleared).toBe(1);
    target.reopen();
    expect(instanceSecret(target.sqlite, target.key, 'sonarr-a')).toEqual({});
    source.close();
    target.close();
  });

  it('moves a passphrase-protected backup to a new installation with its credentials', async () => {
    const source = installation();
    addInstanceSecret(source.sqlite, source.key, 'radarr-a', { apiKey: 'k2' });
    const backup = await source.backups.create('manual');
    const exported = await source.backups.exportProtected(backup.id, 'correct horse battery');
    expect(decodeHeader(exported.data).header.encryption).toMatchObject({ includesKey: true });
    // The key and the database are not readable without the passphrase.
    expect(exported.data.includes(source.key)).toBe(false);

    const target = installation();
    const uploaded = await target.backups.importUpload(exported.data);
    expect(uploaded).toMatchObject({ kind: 'uploaded', encrypted: true, key: 'included' });
    await expect(target.backups.stageRestore(uploaded.id)).rejects.toMatchObject({
      code: 'passphraseRequired',
    });
    await expect(
      target.backups.stageRestore(uploaded.id, { passphrase: 'wrong passphrase' }),
    ).rejects.toMatchObject({
      code: 'wrongPassphrase',
    });
    const summary = await target.backups.stageRestore(uploaded.id, { passphrase: 'correct horse battery' });
    expect(summary.credentialsCleared).toBe(0);
    target.reopen();
    expect(instanceSecret(target.sqlite, target.key, 'radarr-a')).toEqual({ apiKey: 'k2' });
    source.close();
    target.close();
  });

  it('rejects broken uploads and backups from a newer Wardarr', async () => {
    const inst = installation();
    await expect(inst.backups.importUpload(Buffer.from('hello'))).rejects.toBeInstanceOf(HttpError);
    const good = await inst.backups.create('manual');
    const raw = readFileSync(inst.backups.file(good.id));
    const flipped = Buffer.from(raw);
    flipped[flipped.length - 20]! ^= 0xff;
    await expect(inst.backups.importUpload(flipped)).rejects.toMatchObject({ status: 422 });

    // A plain database file is accepted and wrapped.
    inst.sqlite.pragma('wal_checkpoint(TRUNCATE)');
    const plain = await inst.backups.importUpload(readFileSync(inst.dbFile));
    expect(plain).toMatchObject({ kind: 'uploaded', compatibility: 'current' });

    // A backup with a migration this build does not know cannot be restored.
    const { header } = decodeHeader(raw);
    const newer = Buffer.concat([
      Buffer.from(
        `WARDARR-BACKUP 1\n${JSON.stringify({ ...header, migrations: [...header.migrations, 'f'.repeat(64)] })}\n`,
      ),
      decodeHeader(raw).payload,
    ]);
    const up = await inst.backups.importUpload(newer);
    expect(up.compatibility).toBe('newer');
    await expect(inst.backups.stageRestore(up.id)).rejects.toMatchObject({ code: 'backupTooNew' });
    inst.close();
  });

  it('refuses ids that point outside the backup folder', () => {
    const inst = installation();
    for (const id of ['../wardarr', 'wardarr-x', '..%2Fsecret.key']) {
      expect(() => inst.backups.file(id)).toThrow(HttpError);
    }
    inst.close();
  });
});

describe('backup routes', () => {
  it('lists, creates, pins, downloads and restores through the API', async () => {
    let restarts = 0;
    const t = await createTestApp({ restart: () => restarts++ });
    const headers = await setupAdmin(t);
    const api = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) =>
      t.app.inject({ method, url, headers, payload });

    const empty = (await api('GET', '/api/backups')).json();
    expect(empty).toMatchObject({ level: 2, backups: [], lastRun: null });
    expect(empty.levels).toHaveLength(5);

    const created = await api('POST', '/api/backups');
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;

    expect((await api('PUT', `/api/backups/${id}/pin`, { pinned: true })).statusCode).toBe(200);
    expect((await api('GET', '/api/backups')).json().backups[0]).toMatchObject({ id, pinned: true });

    const download = await api('GET', `/api/backups/${id}/download`);
    expect(download.headers['content-disposition']).toContain(`${id}.wbak`);
    expect(download.rawPayload.subarray(0, 16).toString()).toBe('WARDARR-BACKUP 1');

    const exported = await api('POST', `/api/backups/${id}/export`, { passphrase: 'short' });
    expect(exported.statusCode).toBe(400);

    const upload = await t.app.inject({
      method: 'POST',
      url: '/api/backups/upload',
      headers: { ...headers, 'content-type': 'application/octet-stream' },
      payload: download.rawPayload,
    });
    expect(upload.statusCode).toBe(201);

    expect((await api('PUT', '/api/backups/settings', { level: 7 })).statusCode).toBe(400);
    expect((await api('PUT', '/api/backups/settings', { level: 3 })).json().level).toBe(3);

    const restore = await api('POST', `/api/backups/${id}/restore`, {});
    expect(restore.json()).toMatchObject({ restarting: true, backupId: id });
    await new Promise((r) => setTimeout(r, 300));
    expect(restarts).toBe(1);

    const user = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-wardarr-request': '1' },
      payload: ADMIN,
    });
    expect(user.statusCode).toBe(200);
    await t.close();
  });

  it('restarts the whole server in place with the restored data', async () => {
    const dataDir = tempDir();
    const config: Config = {
      port: 18000 + Math.floor(Math.random() * 2000),
      host: '127.0.0.1',
      dataDir,
      backupDir: path.join(dataDir, 'backups'),
      secretKey: undefined,
      trustProxy: false,
      cookieSecure: false,
      logLevel: 'silent',
      webDir: undefined,
      httpTimeoutMs: 5000,
      publicUrl: undefined,
      trashDir: undefined,
    };
    const server = await startServer(config, path.join(dataDir, 'no-web'));
    const base = server.address();
    const setup = await fetch(`${base}/api/setup/admin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-wardarr-request': '1' },
      body: JSON.stringify(ADMIN),
    });
    const csrf = ((await setup.json()) as { csrfToken: string }).csrfToken;
    const cookie = setup.headers.get('set-cookie')!.split(';')[0]!;
    const headers = { cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' };
    const call = (method: string, url: string, body?: object) =>
      fetch(`${base}${url}`, { method, headers, body: body ? JSON.stringify(body) : undefined });

    const backup = (await (await call('POST', '/api/backups', {})).json()) as { id: string };
    const created = await call('POST', '/api/users', {
      username: 'later',
      password: 'another-long-password',
      role: 'user',
    });
    expect(created.status).toBe(201);
    // An open event stream must not block the restart.
    const events = await fetch(`${base}/api/events`, { headers: { cookie } });
    expect(events.status).toBe(200);

    const restore = await call('POST', `/api/backups/${backup.id}/restore`, {});
    expect(restore.status).toBe(200);
    let health = 0;
    for (let i = 0; i < 50 && health !== 401; i++) {
      await new Promise((r) => setTimeout(r, 100));
      // The old session is gone after the restore.
      health = await fetch(`${base}/api/users`, { headers: { cookie } })
        .then((r) => r.status)
        .catch(() => 0);
    }
    expect(health).toBe(401);
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-wardarr-request': '1' },
      body: JSON.stringify(ADMIN),
    });
    expect(login.status).toBe(200);
    const fresh = login.headers.get('set-cookie')!.split(';')[0]!;
    const users = (await (await fetch(`${base}/api/users`, { headers: { cookie: fresh } })).json()) as Array<{
      username: string;
    }>;
    expect(users.map((u) => u.username)).toEqual([ADMIN.username]);
    expect(readdirSync(config.backupDir).some((f) => f.includes('pre-restore'))).toBe(true);
    await events.body?.cancel().catch(() => undefined);
    await server.stop();
  });
});
