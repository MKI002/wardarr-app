// Bundles the server into dist/main.js. Native modules stay external and are
// installed as regular dependencies. No source maps are written.
import { build } from 'esbuild';
import { cpSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: false,
  legalComments: 'none',
  external: ['better-sqlite3', '@node-rs/argon2'],
  // Some bundled CommonJS dependencies call require().
  banner: {
    js: "import { createRequire as __wardarrRequire } from 'node:module'; const require = __wardarrRequire(import.meta.url);",
  },
  logLevel: 'warning',
});

cpSync('drizzle', 'dist/drizzle', { recursive: true });
