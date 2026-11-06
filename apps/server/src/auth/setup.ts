// First-run setup. Open only while no admin account exists.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, parse } from '../http/validate.js';
import { PASSWORD_MIN_LENGTH } from '../security/password.js';
import { USERNAME_PATTERN, type UserStore } from '../users/store.js';
import { publicUser, setSessionCookie, type CookieOptions } from './routes.js';
import type { SessionStore } from './sessions.js';

const adminSchema = z.object({
  username: z.string().regex(USERNAME_PATTERN),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(1024),
});

export function registerSetupRoutes(
  app: FastifyInstance,
  deps: { users: UserStore; sessions: SessionStore; cookie: CookieOptions },
): void {
  app.get('/api/setup/status', { config: { access: 'public' } }, async () => {
    return { needsSetup: deps.users.count('admin') === 0 };
  });

  app.post(
    '/api/setup/admin',
    { config: { access: 'public', rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = parse(adminSchema, req.body);
      // Checked again right before the insert; SQLite serializes writes.
      if (deps.users.count('admin') > 0) throw new HttpError(409, 'setupComplete');
      const user = await deps.users.createLocal({
        username: body.username,
        password: body.password,
        role: 'admin',
      });
      if (deps.users.count('admin') > 1) {
        deps.users.delete(user.id);
        throw new HttpError(409, 'setupComplete');
      }
      const { token, session, expiresAt } = deps.sessions.create(user.id);
      setSessionCookie(reply, token, expiresAt, deps.cookie, req.protocol === 'https');
      return {
        user: publicUser({ ...user, preferences: {} }),
        csrfToken: session.csrfToken,
      };
    },
  );
}
