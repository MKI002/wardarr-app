// Starts the built Wardarr server with a fresh, temporary data directory.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = mkdtempSync(path.join(tmpdir(), 'wardarr-e2e-'));
const child = spawn(process.execPath, [path.resolve(here, '../server/dist/main.js')], {
  stdio: 'inherit',
  env: {
    ...process.env,
    WARDARR_DATA_DIR: dataDir,
    WARDARR_PORT: process.env.WARDARR_PORT ?? '18484',
    WARDARR_HOST: '127.0.0.1',
    WARDARR_WEB_DIR: path.resolve(here, '../web/dist'),
    WARDARR_LOG_LEVEL: 'warn',
  },
});
const stop = () => child.kill('SIGTERM');
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
child.on('exit', (code) => {
  rmSync(dataDir, { recursive: true, force: true });
  process.exit(code ?? 0);
});
