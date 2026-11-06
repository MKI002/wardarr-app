import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, authHeaders, createTestApp, setupAdmin } from './helpers.js';

let t: Awaited<ReturnType<typeof createTestApp>>;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => t.close());

const json = { 'x-wardarr-request': '1' };

describe('setup', () => {
  it('is open until an admin exists, then closed', async () => {
    expect((await t.app.inject({ url: '/api/setup/status' })).json()).toEqual({ needsSetup: true });
    await setupAdmin(t);
    expect((await t.app.inject({ url: '/api/setup/status' })).json()).toEqual({ needsSetup: false });
    const again = await t.app.inject({
      method: 'POST',
      url: '/api/setup/admin',
      headers: json,
      payload: { username: 'intruder', password: 'another-long-password' },
    });
    expect(again.statusCode).toBe(409);
    expect(t.users.count()).toBe(1);
  });

  it('rejects short passwords', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/setup/admin',
      headers: json,
      payload: { username: 'admin', password: 'short' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('stores an argon2id hash, never the password', async () => {
    await setupAdmin(t);
    const found = t.users.findLocal('admin');
    expect(found!.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(found!.passwordHash).not.toContain(ADMIN.password);
  });
});

describe('login', () => {
  beforeEach(async () => {
    await setupAdmin(t);
  });

  it('logs in and sets a hardened session cookie', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/auth/login', headers: json, payload: ADMIN });
    expect(res.statusCode).toBe(200);
    const cookie = res.cookies.find((c) => c.name === 'wardarr_session')!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe('Lax');
    const me = await t.app.inject({ url: '/api/auth/me', headers: authHeaders(res) });
    expect(me.json().user.username).toBe('admin');
  });

  it('marks the cookie secure when configured', async () => {
    const secure = await createTestApp({ cookieSecure: true });
    await setupAdmin(secure);
    const res = await secure.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: json,
      payload: ADMIN,
    });
    expect(res.cookies.find((c) => c.name === 'wardarr_session')!.secure).toBe(true);
    await secure.close();
  });

  it('gives the same answer for unknown users and wrong passwords', async () => {
    const a = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: json,
      payload: { username: 'nobody', password: 'x' },
    });
    const b = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: json,
      payload: { username: 'admin', password: 'wrong' },
    });
    expect(a.statusCode).toBe(401);
    expect(b.statusCode).toBe(401);
    expect(a.json()).toEqual(b.json());
  });

  it('locks a user name after repeated failures', async () => {
    for (let i = 0; i < 5; i++) {
      await t.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: json,
        payload: { username: 'admin', password: `wrong-${i}` },
      });
    }
    const res = await t.app.inject({ method: 'POST', url: '/api/auth/login', headers: json, payload: ADMIN });
    expect(res.statusCode).toBe(429);
  });

  it('logs out and invalidates the session', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/auth/login', headers: json, payload: ADMIN });
    const headers = authHeaders(res);
    expect((await t.app.inject({ method: 'POST', url: '/api/auth/logout', headers })).statusCode).toBe(200);
    expect((await t.app.inject({ url: '/api/auth/me', headers })).statusCode).toBe(401);
  });
});

describe('csrf', () => {
  it('rejects state-changing requests without the CSRF token', async () => {
    const headers = await setupAdmin(t);
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: headers.cookie },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'csrf' });
  });

  it('rejects cross-origin requests even with a valid token', async () => {
    const headers = await setupAdmin(t);
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { ...headers, origin: 'https://evil.example.com' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects anonymous POSTs without the Wardarr request header', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: ADMIN });
    expect(res.statusCode).toBe(403);
  });
});

describe('roles', () => {
  it('keeps admin routes away from normal users', async () => {
    const admin = await setupAdmin(t);
    await t.app.inject({
      method: 'POST',
      url: '/api/users',
      headers: admin,
      payload: { username: 'viewer', password: 'viewer-password-1', role: 'user' },
    });
    const login = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: json,
      payload: { username: 'viewer', password: 'viewer-password-1' },
    });
    const user = authHeaders(login);
    expect((await t.app.inject({ url: '/api/instances', headers: user })).statusCode).toBe(403);
    expect((await t.app.inject({ url: '/api/overview', headers: user })).statusCode).toBe(403);
    expect((await t.app.inject({ url: '/api/capabilities', headers: user })).json().tabs).toEqual([
      'settings',
    ]);
  });

  it('never removes the last admin', async () => {
    const admin = await setupAdmin(t);
    const id = t.users.list()[0]!.id;
    const res = await t.app.inject({
      method: 'PATCH',
      url: `/api/users/${id}`,
      headers: admin,
      payload: { role: 'user' },
    });
    expect(res.statusCode).toBe(409);
  });
});
