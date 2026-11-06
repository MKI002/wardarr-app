// Guards against the class of bug where an endpoint is reachable without
// login. Every registered route is called anonymously.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers.js';

const EXPECTED_PUBLIC = [
  'GET /*',
  'GET /api/calendar/ical/:file',
  'GET /api/setup/status',
  'GET /healthz',
  'POST /api/auth/login',
  'POST /api/setup/admin',
];

let t: Awaited<ReturnType<typeof createTestApp>>;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => t.close());

function concrete(url: string): string {
  return url.replace(/:([a-zA-Z]+)/g, 'x').replace('*', 'anything');
}

describe('route security', () => {
  it('declares exactly the expected public routes', () => {
    const publicRoutes = t.routes.filter((r) => r.access === 'public').map((r) => `${r.method} ${r.url}`);
    expect(publicRoutes.sort()).toEqual(EXPECTED_PUBLIC.sort());
  });

  it('answers 401 for every non-public route without a session', async () => {
    const protectedRoutes = t.routes.filter((r) => r.access !== 'public');
    expect(protectedRoutes.length).toBeGreaterThan(15);
    for (const route of protectedRoutes) {
      const res = await t.app.inject({
        method: route.method as 'GET',
        url: concrete(route.url),
        headers: { 'x-wardarr-request': '1' },
        payload: route.method === 'GET' ? undefined : {},
      });
      expect(res.statusCode, `${route.method} ${route.url}`).toBe(401);
    }
  });

  it('answers 401 for unknown API paths without a session', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/does-not-exist' });
    expect(res.statusCode).toBe(401);
  });

  it('health check reveals nothing but status', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/healthz' });
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('sets security headers', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/healthz' });
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });
});
