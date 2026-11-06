// Entry point: configuration, database, background jobs and HTTP server.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db/index.js';
import { Scheduler } from './jobs/scheduler.js';
import { createSecretBox, loadOrCreateKey } from './security/crypto.js';

const config = loadConfig();
const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = config.webDir ?? path.resolve(here, '../../web/dist');

const { db, close } = openDatabase(path.join(config.dataDir, 'wardarr.db'));
const box = createSecretBox(loadOrCreateKey(config.dataDir, config.secretKey));
const { app, runtime, sessions } = await buildApp({
  db,
  box,
  trustProxy: config.trustProxy,
  cookieSecure: config.cookieSecure,
  logLevel: config.logLevel,
  webDir,
  httpTimeoutMs: config.httpTimeoutMs,
});

const scheduler = new Scheduler(app.log);
runtime.start(scheduler);
scheduler.schedule('sessions:purge', 3600_000, async () => sessions.purgeExpired(), 60_000);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  scheduler.stop();
  await app.close();
  close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: config.port, host: config.host });
