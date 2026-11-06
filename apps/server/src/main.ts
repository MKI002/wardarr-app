// Entry point: reads the configuration and runs the server until a signal.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { startServer } from './server.js';

const config = loadConfig();
const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = config.webDir ?? path.resolve(here, '../../web/dist');

const server = await startServer(config, webDir, {
  // A failed in-place restart exits; a supervisor such as Docker starts
  // Wardarr again, which applies the staged restore on the way up.
  onRestartFailed: () => process.exit(1),
});

const shutdown = async (signal: string) => {
  server.log().info({ signal }, 'shutting down');
  await server.stop();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
