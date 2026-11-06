// Hunting API. Admin only (the default access).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../http/validate.js';
import type { HuntingService } from './service.js';

const rate = z.object({
  count: z.number().int().min(0).max(50),
  everyMinutes: z
    .number()
    .int()
    .min(5)
    .max(7 * 24 * 60),
});

const settingsSchema = z
  .object({
    pace: z.enum(['off', 'gentle', 'normal', 'fast', 'custom']),
    missing: rate,
    cutoff: rate,
    apiCallsPerHour: z.number().int().min(5).max(1000),
    pauseQueueSize: z.number().int().min(1).max(1000),
    researchAfterDays: z.number().int().min(1).max(365),
    monitoredOnly: z.boolean(),
    preferSeasonPacks: z.boolean(),
    includeTags: z.array(z.number().int()).max(100),
    excludeTags: z.array(z.number().int()).max(100),
    qualityProfileIds: z.array(z.number().int()).max(100),
    minYear: z.number().int().min(1800).max(3000).nullable(),
    maxYear: z.number().int().min(1800).max(3000).nullable(),
  })
  .partial()
  .strict();

export function registerHuntingRoutes(app: FastifyInstance, deps: { hunting: HuntingService }): void {
  const { hunting } = deps;

  app.get('/api/hunting', async () => ({ instances: hunting.summary() }));

  /** Tags and quality profiles of the instance, for the filters under "Advanced". */
  app.get<{ Params: { id: string } }>('/api/hunting/:id/filters', async (req) =>
    hunting.filters(req.params.id),
  );

  app.put<{ Params: { id: string } }>('/api/hunting/:id/settings', async (req) => {
    return { config: hunting.saveConfig(req.params.id, parse(settingsSchema, req.body ?? {})) };
  });

  app.post<{ Params: { id: string } }>('/api/hunting/:id/run', async (req) => {
    await hunting.tick(req.params.id, true);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/hunting/:id/search', async (req) => {
    const body = parse(z.object({ key: z.string().min(1).max(200) }), req.body ?? {});
    await hunting.searchNow(req.params.id, body.key);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/hunting/:id/exclude', async (req) => {
    const body = parse(
      z.object({ key: z.string().min(1).max(200), title: z.string().min(1).max(500) }),
      req.body ?? {},
    );
    hunting.exclude(req.params.id, body.key, body.title);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/hunting/:id/include', async (req) => {
    const body = parse(z.object({ key: z.string().min(1).max(200) }), req.body ?? {});
    hunting.include(req.params.id, body.key);
    return { ok: true };
  });
}
