// Transcode servers (Tdarr). Admin only (the default access).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../http/validate.js';
import type { TranscodingService } from './service.js';

export function registerTranscodingRoutes(
  app: FastifyInstance,
  deps: { transcoding: TranscodingService },
): void {
  app.get('/api/tdarr', async (req) => {
    const q = parse(z.object({ refresh: z.enum(['1']).optional() }), req.query);
    return { instances: await deps.transcoding.list(q.refresh === '1') };
  });
}
