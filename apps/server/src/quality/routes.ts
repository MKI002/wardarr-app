// Library quality scores. Admin only (the default access): quality profiles
// and file details describe the setup.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../http/validate.js';
import type { QualityService } from './service.js';

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
}
