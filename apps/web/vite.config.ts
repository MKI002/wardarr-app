import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// `--mode demo` builds the public demo (see docs/demo.md): the same UI with
// recorded answers instead of a server, served from a sub-path.
export default defineConfig(({ mode }) => {
  const demo = mode === 'demo';
  return {
    plugins: [react(), tailwindcss()],
    base: demo ? (process.env.WARDARR_DEMO_BASE ?? '/') : '/',
    build: {
      // Source maps would expose local paths; they are never built.
      sourcemap: false,
      outDir: demo ? 'dist-demo' : 'dist',
      emptyOutDir: true,
    },
    server: {
      port: 5173,
      proxy: demo ? undefined : { '/api': 'http://localhost:8484', '/healthz': 'http://localhost:8484' },
    },
  };
});
