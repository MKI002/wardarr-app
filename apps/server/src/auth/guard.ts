// Default-deny access control and CSRF protection for every route.
//
// Every route requires an admin session unless its config says otherwise.
// Public routes must be declared explicitly with `config: { access: 'public' }`.
// State-changing requests must come from the same origin and carry the
// session's CSRF token (or, before login, the Wardarr request header that a
// cross-site form cannot send).
import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { SESSION_COOKIE, type SessionStore } from './sessions.js';
import type { Access } from './types.js';

export const CSRF_HEADER = 'x-csrf-token';
export const REQUEST_HEADER = 'x-wardarr-request';
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface RegisteredRoute {
  method: string;
  url: string;
  access: Access;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function sameOrigin(req: FastifyRequest): boolean {
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const o = new URL(origin);
    return o.host === req.host && o.protocol === `${req.protocol}:`;
  } catch {
    return false;
  }
}

function deny(reply: FastifyReply, status: 401 | 403, code: string) {
  return reply.code(status).send({ error: code });
}

export const authGuard = fp<{ sessions: SessionStore; routes: RegisteredRoute[] }>(
  async (app: FastifyInstance, opts) => {
    app.decorateRequest('user', null);
    app.decorateRequest('authSession', null);

    app.addHook('onRoute', (route) => {
      const methods = Array.isArray(route.method) ? route.method : [route.method];
      const access: Access = route.config?.access ?? 'admin';
      for (const method of methods) {
        if (method === 'HEAD') continue;
        opts.routes.push({ method, url: route.url, access });
      }
    });

    app.addHook('onRequest', async (req, reply) => {
      const access: Access = req.routeOptions.config?.access ?? 'admin';
      const auth = opts.sessions.validate(req.cookies[SESSION_COOKIE]);
      if (auth) {
        req.user = auth.user;
        req.authSession = auth.session;
      }

      if (UNSAFE.has(req.method)) {
        if (!sameOrigin(req)) return deny(reply, 403, 'crossOrigin');
        if (auth) {
          const token = req.headers[CSRF_HEADER];
          if (typeof token !== 'string' || !safeEqual(token, auth.session.csrfToken)) {
            return deny(reply, 403, 'csrf');
          }
        } else if (req.headers[REQUEST_HEADER] !== '1') {
          return deny(reply, 403, 'csrf');
        }
      }

      if (access === 'public') return;
      if (!req.user) return deny(reply, 401, 'unauthenticated');
      if (access === 'admin' && req.user.role !== 'admin') return deny(reply, 403, 'forbidden');
    });
  },
);
