// Test helpers: an app with an in-memory database and a fake adapter.
import { randomBytes } from 'node:crypto';
import { AdapterError, defineAdapter, type Signal } from '@wardarr/core';
import { z } from 'zod';
import { buildApp } from '../src/app.js';
import { openDatabase } from '../src/db/index.js';
import { AdapterRegistry } from '../src/instances/registry.js';
import { createSecretBox } from '../src/security/crypto.js';

export const FAKE_KEY = '00000000000000000000000000000042';

/** Behaviour of the fake adapter, switchable per test. */
export const fakeState: { down: boolean; signals: Signal[] } = { down: false, signals: [] };

export const fakeAdapter = defineAdapter({
  id: 'fake',
  name: 'Fake',
  category: 'arr',
  lifecycle: 'active',
  homepage: 'https://example.com',
  fields: [{ key: 'apiKey', kind: 'secret', label: 'fields.apiKey', required: true }],
  credentials: z.object({ apiKey: z.string().min(1) }),
  capabilities: ['health'],
  create(ctx) {
    return {
      async testConnection() {
        if (fakeState.down) throw new AdapterError('unreachable', 'down');
        if (ctx.credentials.apiKey !== FAKE_KEY) throw new AdapterError('unauthorized', 'bad key', 401);
        return { version: '1.0.0' };
      },
      async health() {
        return fakeState.signals.map((s) => ({
          ...s,
          instance: { id: ctx.instanceId, name: ctx.instanceName, adapter: 'fake' },
        }));
      },
      webUrl: () => 'https://fake.example.test/',
    };
  },
});

export async function createTestApp(extra: { cookieSecure?: boolean | 'auto'; adapters?: unknown[] } = {}) {
  const { db, close } = openDatabase(':memory:');
  const box = createSecretBox(randomBytes(32));
  const built = await buildApp({
    db,
    box,
    registry: new AdapterRegistry([fakeAdapter, ...(extra.adapters ?? [])] as never),
    logLevel: 'silent',
    cookieSecure: extra.cookieSecure,
  });
  await built.app.ready();
  return {
    ...built,
    close: async () => {
      await built.app.close();
      close();
    },
  };
}

type Built = Awaited<ReturnType<typeof createTestApp>>;

export const ADMIN = { username: 'admin', password: 'correct-horse-battery' };

/** Completes setup and returns headers for authenticated requests. */
export async function setupAdmin(t: Built) {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/setup/admin',
    headers: { 'x-wardarr-request': '1' },
    payload: ADMIN,
  });
  if (res.statusCode !== 200) throw new Error(`setup failed: ${res.statusCode} ${res.body}`);
  return authHeaders(res);
}

export function authHeaders(res: { cookies: Array<{ name: string; value: string }>; json(): unknown }) {
  const cookie = res.cookies.find((c) => c.name === 'wardarr_session');
  const { csrfToken } = res.json() as { csrfToken: string };
  return { cookie: `wardarr_session=${cookie!.value}`, 'x-csrf-token': csrfToken };
}
