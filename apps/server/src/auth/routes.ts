// Login, logout and the current user.
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { HttpError, parse } from '../http/validate.js';
import { dummyVerify, verifyPassword } from '../security/password.js';
import type { UserStore } from '../users/store.js';
import type { LoginLockout } from './lockout.js';
import { SESSION_COOKIE, type SessionStore } from './sessions.js';
import type { AuthUser } from './types.js';

export interface CookieOptions {
  secure: boolean | 'auto';
}

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(1024),
});

const preferencesSchema = z
  .object({
    language: z.enum(['en', 'de']).optional(),
    theme: z.enum(['system', 'dark', 'light']).optional(),
    reducedMotion: z.enum(['system', 'reduce', 'full']).optional(),
  })
  .strict();

export function publicUser(user: AuthUser) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    preferences: user.preferences,
  };
}

export function setSessionCookie(
  reply: FastifyReply,
  token: string,
  expiresAt: Date,
  opts: CookieOptions,
  isHttps: boolean,
): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: opts.secure === 'auto' ? isHttps : opts.secure,
    path: '/',
    expires: expiresAt,
  });
}

export function registerAuthRoutes(
  app: FastifyInstance,
  deps: { users: UserStore; sessions: SessionStore; lockout: LoginLockout; cookie: CookieOptions },
): void {
  app.post(
    '/api/auth/login',
    { config: { access: 'public', rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = parse(loginSchema, req.body);
      const username = body.username.trim().toLowerCase();
      if (deps.lockout.isLocked(username)) throw new HttpError(429, 'tooManyAttempts');
      const found = deps.users.findLocal(username);
      const ok = found
        ? await verifyPassword(found.passwordHash, body.password)
        : await dummyVerify(body.password);
      if (!found || !ok || found.user.disabled) {
        deps.lockout.fail(username);
        throw new HttpError(401, 'invalidCredentials');
      }
      deps.lockout.succeed(username);
      if (req.authSession) deps.sessions.revoke(req.authSession.id);
      const { token, session, expiresAt } = deps.sessions.create(found.user.id);
      setSessionCookie(reply, token, expiresAt, deps.cookie, req.protocol === 'https');
      return { user: publicUser(found.user), csrfToken: session.csrfToken };
    },
  );

  app.post('/api/auth/logout', { config: { access: 'user' } }, async (req, reply) => {
    if (req.authSession) deps.sessions.revoke(req.authSession.id);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', { config: { access: 'user' } }, async (req) => {
    return { user: publicUser(req.user!), csrfToken: req.authSession!.csrfToken };
  });

  app.put('/api/auth/me/preferences', { config: { access: 'user' } }, async (req) => {
    const patch = parse(preferencesSchema, req.body);
    const preferences = { ...req.user!.preferences, ...patch };
    deps.users.setPreferences(req.user!.id, preferences);
    return { preferences };
  });

  app.put('/api/auth/me/password', { config: { access: 'user' } }, async (req) => {
    const body = parse(
      z.object({ currentPassword: z.string().min(1).max(1024), newPassword: z.string().min(10).max(1024) }),
      req.body,
    );
    const found = deps.users.findLocal(req.user!.username);
    if (!found || !(await verifyPassword(found.passwordHash, body.currentPassword))) {
      throw new HttpError(403, 'invalidCredentials');
    }
    await deps.users.setPassword(req.user!.id, body.newPassword);
    deps.sessions.revokeAllForUser(req.user!.id, req.authSession!.id);
    return { ok: true };
  });
}
