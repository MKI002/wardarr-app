// Indexer insights. Admin only (the default access).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../http/validate.js';
import { RANGES } from './insights/report.js';
import type { PriorityWatchdog } from './insights/priorities.js';
import type { IndexerInsightsService } from './insights/service.js';

export function registerIndexerInsightRoutes(
  app: FastifyInstance,
  deps: { insights: IndexerInsightsService; priorities: PriorityWatchdog },
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

  /** The priority watchdog: settings, the plan for the next run, and what it changed. */
  app.get('/api/indexer-insights/priorities', async () => deps.priorities.view());

  app.put('/api/indexer-insights/priorities', async (req) => {
    const body = parse(
      z.object({
        enabled: z.boolean().optional(),
        mode: z.enum(['preview', 'apply']).optional(),
        best: z.number().int().min(1).max(50).optional(),
        worst: z.number().int().min(1).max(50).optional(),
        step: z.number().int().min(1).max(10).optional(),
        includeApps: z.boolean().optional(),
      }),
      req.body,
    );
    deps.priorities.saveConfig(body);
    return deps.priorities.view();
  });

  /** Runs the watchdog now, in the configured mode, even when it is off. */
  app.post('/api/indexer-insights/priorities/run', async () => {
    const run = await deps.priorities.run('manual');
    return { run, view: await deps.priorities.view() };
  });
}
