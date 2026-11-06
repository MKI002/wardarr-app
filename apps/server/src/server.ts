// Starts Wardarr: data directory, backups, database, background jobs and the
// HTTP server. A restore restarts all of it in place, in the same process.
import type { FastifyBaseLogger } from 'fastify';
import path from 'node:path';
import { buildApp } from './app.js';
import { applyPendingRestore } from './backups/restore.js';
import { BackupService } from './backups/service.js';
import type { Config } from './config.js';
import { openDatabase } from './db/index.js';
import { Scheduler } from './jobs/scheduler.js';
import { createSecretBox, loadOrCreateKey } from './security/crypto.js';

export interface RunningServer {
  /** Address the server listens on. */
  address(): string;
  log(): FastifyBaseLogger;
  /** Stops jobs, HTTP server and database. */
  stop(): Promise<void>;
  /** Stops and starts again; applies a staged restore in between. */
  restart(): Promise<void>;
}

interface Instance {
  stop(): Promise<void>;
  address(): string;
  log: FastifyBaseLogger;
}

async function boot(config: Config, webDir: string, requestRestart: () => void): Promise<Instance> {
  const dbFile = path.join(config.dataDir, 'wardarr.db');
  const restored = applyPendingRestore(config.dataDir, dbFile);
  const key = loadOrCreateKey(config.dataDir, config.secretKey);
  const backups = new BackupService({ dir: config.backupDir, dataDir: config.dataDir, secretKey: key });
  const { db, sqlite, close } = openDatabase(dbFile, {
    beforeMigrate: (live) => void backups.createBeforeMigration(live),
  });
  backups.attach(sqlite);
  const { app, runtime, sessions, history } = await buildApp({
    db,
    box: createSecretBox(key),
    trustProxy: config.trustProxy,
    cookieSecure: config.cookieSecure,
    logLevel: config.logLevel,
    webDir,
    httpTimeoutMs: config.httpTimeoutMs,
    publicUrl: config.publicUrl,
    trashDir: config.trashDir,
    backups,
    restart: requestRestart,
  });
  if (restored !== null) app.log.info({ backup: restored }, 'restored backup');

  const scheduler = new Scheduler(app.log);
  runtime.start(scheduler);
  scheduler.schedule('sessions:purge', 3600_000, async () => sessions.purgeExpired(), 60_000);
  scheduler.schedule('streams:prune', 24 * 3600_000, async () => history.prune(), 120_000);
  scheduler.schedule('backups:auto', BackupService.TICK_MS, () => backups.tick(), 90_000);

  try {
    await app.listen({ port: config.port, host: config.host });
  } catch (err) {
    scheduler.stop();
    await app.close();
    close();
    throw err;
  }
  return {
    log: app.log,
    address: () => {
      const a = app.server.address();
      return typeof a === 'object' && a ? `http://127.0.0.1:${a.port}` : String(a);
    },
    stop: async () => {
      scheduler.stop();
      await app.close();
      close();
    },
  };
}

export async function startServer(
  config: Config,
  webDir: string,
  hooks: { onRestartFailed?: (err: unknown) => void } = {},
): Promise<RunningServer> {
  let current: Instance;
  let restarting: Promise<void> | null = null;

  const restart = (): Promise<void> => {
    restarting ??= (async () => {
      try {
        await current.stop();
        current = await boot(config, webDir, () => void restart());
      } catch (err) {
        current.log.error({ err }, 'restart failed');
        hooks.onRestartFailed?.(err);
        throw err;
      } finally {
        restarting = null;
      }
    })();
    return restarting;
  };

  current = await boot(config, webDir, () => void restart().catch(() => undefined));
  return {
    address: () => current.address(),
    log: () => current.log,
    stop: async () => {
      await restarting?.catch(() => undefined);
      await current.stop();
    },
    restart,
  };
}
