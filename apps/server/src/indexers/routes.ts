// Indexer overview. Admin only (the default access).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../http/validate.js';
import type { IndexerService } from './service.js';

export function registerIndexerRoutes(app: FastifyInstance, deps: { indexers: IndexerService }): void {
  app.get('/api/indexers', async (req) => {
    const q = parse(z.object({ refresh: z.enum(['1']).optional() }), req.query);
    return { instances: deps.indexers.list(q.refresh === '1') };
  });

  app.post<{ Params: { instance: string; indexerId: string } }>(
    '/api/indexers/:instance/:indexerId/test',
    async (req) => {
      const p = parse(
        z.object({ instance: z.string().min(1).max(64), indexerId: z.coerce.number().int().min(0) }),
        req.params,
      );
      return deps.indexers.test(p.instance, p.indexerId);
    },
  );
}
