// Discover and requests. Users see Discover and their own requests; managing
// all requests and user links is for admins.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../http/validate.js';
import type { RequestService } from './service.js';

const instanceQuery = z.object({ instance: z.string().min(1).max(64).optional() });
const page = z.coerce.number().int().min(1).max(500).default(1);
const mediaType = z.enum(['movie', 'tv']);
const id = z.coerce.number().int().min(0).max(2_147_483_647);
const seasons = z.array(z.number().int().min(1).max(500)).max(500);

const statusFilter = z
  .enum(['all', 'pending', 'approved', 'processing', 'available', 'failed', 'declined'])
  .default('all');

const newRequest = z
  .object({
    instance: z.string().min(1).max(64).optional(),
    mediaType,
    tmdbId: id,
    tvdbId: id.optional(),
    seasons: z.union([seasons.min(1), z.literal('all')]).optional(),
    is4k: z.boolean().default(false),
    serverId: id.optional(),
    profileId: id.optional(),
    rootFolder: z.string().min(1).max(500).optional(),
  })
  .strict();

const edit = z
  .object({
    seasons: seasons.optional(),
    is4k: z.boolean().optional(),
    serverId: id.optional(),
    profileId: id.optional(),
    rootFolder: z.string().min(1).max(500).optional(),
  })
  .strict();

export function registerRequestRoutes(app: FastifyInstance, deps: { requests: RequestService }): void {
  const { requests } = deps;
  const user = { config: { access: 'user' as const } };

  app.get('/api/discover/instances', user, async () => ({ instances: requests.instances() }));

  app.get('/api/discover', user, async (req) => {
    const q = parse(
      instanceQuery.extend({ list: z.enum(['trending', 'movies', 'tv']).default('trending'), page }),
      req.query,
    );
    return requests.discover(req.user!, q.list, q.page, q.instance);
  });

  app.get('/api/discover/search', user, async (req) => {
    const q = parse(instanceQuery.extend({ q: z.string().trim().min(1).max(200), page }), req.query);
    return requests.search(req.user!, q.q, q.page, q.instance);
  });

  app.get('/api/discover/options', user, async (req) => {
    const q = parse(instanceQuery, req.query);
    return requests.options(req.user!, q.instance);
  });

  app.get<{ Params: { type: string; tmdbId: string } }>('/api/discover/:type/:tmdbId', user, async (req) => {
    const p = parse(z.object({ type: mediaType, tmdbId: id }), req.params);
    const q = parse(instanceQuery, req.query);
    return requests.details(req.user!, p.type, p.tmdbId, q.instance);
  });

  app.post('/api/requests', user, async (req) => {
    const { instance, ...body } = parse(newRequest, req.body ?? {});
    return requests.create(req.user!, body, instance);
  });

  app.get('/api/requests/mine', user, async (req) => {
    const q = parse(
      instanceQuery.extend({
        status: statusFilter,
        take: z.coerce.number().int().min(1).max(100).default(20),
        skip: z.coerce.number().int().min(0).max(100_000).default(0),
      }),
      req.query,
    );
    return requests.mine(req.user!, { status: q.status, take: q.take, skip: q.skip }, q.instance);
  });

  // Admin only from here on.

  app.get('/api/requests', async (req) => {
    const q = parse(
      instanceQuery.extend({
        status: statusFilter,
        requestedBy: id.optional(),
        take: z.coerce.number().int().min(1).max(100).default(20),
        skip: z.coerce.number().int().min(0).max(100_000).default(0),
      }),
      req.query,
    );
    return requests.all(
      { status: q.status, requestedBy: q.requestedBy, take: q.take, skip: q.skip },
      q.instance,
    );
  });

  app.post<{ Params: { instance: string; id: string; action: string } }>(
    '/api/requests/:instance/:id/:action',
    async (req) => {
      const p = parse(
        z.object({
          instance: z.string().min(1).max(64),
          id,
          action: z.enum(['approve', 'decline', 'retry']),
        }),
        req.params,
      );
      if (p.action === 'retry') return requests.retry(p.instance, p.id);
      return requests.setStatus(p.instance, p.id, p.action);
    },
  );

  app.put<{ Params: { instance: string; id: string } }>('/api/requests/:instance/:id', async (req) => {
    const p = parse(z.object({ instance: z.string().min(1).max(64), id }), req.params);
    return requests.edit(p.instance, p.id, parse(edit, req.body ?? {}));
  });

  app.get('/api/requests/links', async (req) => {
    const q = parse(instanceQuery, req.query);
    return requests.links(q.instance);
  });

  app.put<{ Params: { userId: string } }>('/api/requests/links/:userId', async (req) => {
    const body = parse(
      z.object({ instance: z.string().min(1).max(64), externalId: id.nullable() }).strict(),
      req.body ?? {},
    );
    await requests.setLink(req.params.userId, body.instance, body.externalId);
    return { ok: true };
  });
}
