// Indexer insights. Admin only (the default access).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../http/validate.js';
import { RANGES } from './insights/report.js';
import type { IndexerInsightsService } from './insights/service.js';

export function registerIndexerInsightRoutes(
  app: FastifyInstance,
  deps: { insights: IndexerInsightsService },
): void {
  app.get('/api/indexer-insights', async (req) => {
    const q = parse(
      z.object({
        range: z.enum(RANGES).default('7d'),
        tz: z
          .string()
          .max(64)
          .regex(/^[A-Za-z0-9_+\-/]+$/)
          .optional(),
        refresh: z.enum(['1']).optional(),
      }),
      req.query,
    );
    return deps.insights.report(q.range, q.tz ?? 'UTC', q.refresh === '1');
  });

  /** Reads new data now instead of waiting for the next quarter hour. */
  app.post('/api/indexer-insights/collect', async () => {
    await deps.insights.collect();
    return { ok: true };
  });
}
