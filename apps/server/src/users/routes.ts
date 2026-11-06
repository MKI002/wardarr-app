// Admin API for user accounts.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { SessionStore } from '../auth/sessions.js';
import { HttpError, parse } from '../http/validate.js';
import { PASSWORD_MIN_LENGTH } from '../security/password.js';
import { USERNAME_PATTERN, type UserStore } from './store.js';

const createSchema = z.object({
  username: z.string().regex(USERNAME_PATTERN),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(1024),
  role: z.enum(['admin', 'user']),
  displayName: z.string().max(64).nullable().optional(),
});

const updateSchema = z.object({
  role: z.enum(['admin', 'user']).optional(),
  disabled: z.boolean().optional(),
  displayName: z.string().max(64).nullable().optional(),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(1024).optional(),
});

export function registerUserRoutes(
  app: FastifyInstance,
  deps: { users: UserStore; sessions: SessionStore },
): void {
  app.get('/api/users', async () => deps.users.list());

  app.post('/api/users', async (req, reply) => {
    const body = parse(createSchema, req.body);
    if (deps.users.list().some((u) => u.username === body.username.toLowerCase()))
      throw new HttpError(409, 'usernameTaken');
    reply.code(201);
    return deps.users.createLocal(body);
  });

  app.patch<{ Params: { id: string } }>('/api/users/:id', async (req) => {
    const body = parse(updateSchema, req.body);
    const target = deps.users.list().find((u) => u.id === req.params.id);
    if (!target) throw new HttpError(404, 'notFound');
    const demotesLastAdmin =
      target.role === 'admin' &&
      (body.role === 'user' || body.disabled === true) &&
      deps.users.count('admin') <= 1;
    if (demotesLastAdmin) throw new HttpError(409, 'lastAdmin');
    const { password, ...patch } = body;
    deps.users.update(target.id, patch);
    if (password) await deps.users.setPassword(target.id, password);
    if (password || body.disabled || body.role)
      deps.sessions.revokeAllForUser(target.id, req.authSession!.id);
    return deps.users.list().find((u) => u.id === target.id);
  });

  app.delete<{ Params: { id: string } }>('/api/users/:id', async (req, reply) => {
    const target = deps.users.list().find((u) => u.id === req.params.id);
    if (!target) throw new HttpError(404, 'notFound');
    if (target.id === req.user!.id) throw new HttpError(409, 'cannotDeleteSelf');
    if (target.role === 'admin' && deps.users.count('admin') <= 1) throw new HttpError(409, 'lastAdmin');
    deps.users.delete(target.id);
    reply.code(204);
  });
}
