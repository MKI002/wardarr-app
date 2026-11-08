// Library quality scores. Admin only (the default access): quality profiles
// and file details describe the setup.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../http/validate.js';
import { MAX_SEARCH, type QualityService } from './service.js';

const TIER = z.enum(['perfect', 'target', 'upgrading', 'penalised']);

export function registerQualityRoutes(app: FastifyInstance, deps: { quality: QualityService }): void {
  app.get('/api/quality', async (req) => {
    const q = parse(z.object({ refresh: z.enum(['1']).optional() }), req.query);
    return { instances: deps.quality.list(q.refresh === '1') };
  });

  app.post('/api/quality/refresh', async (req) => {
    const b = parse(z.object({ instance: z.string().min(1).max(64).optional() }).default({}), req.body ?? {});
    deps.quality.start(b.instance);
    return { ok: true };
  });

  app.get('/api/quality/files', async (req) => {
    const q = parse(
      z.object({
        instance: z.string().min(1).max(64).optional(),
        tier: TIER.optional(),
        offset: z.coerce.number().int().min(0).default(0),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      }),
      req.query,
    );
    return deps.quality.files(q);
  });

  app.post('/api/quality/search', async (req) => {
    const b = parse(
      z.object({
        instance: z.string().min(1).max(64).optional(),
        tier: z.enum(['upgrading', 'penalised']).optional(),
        count: z.number().int().min(1).max(MAX_SEARCH),
      }),
      req.body ?? {},
    );
    return deps.quality.search(b);
  });
}
