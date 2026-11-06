// Queue Cleaner API. Admin only (the default access).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, parse } from '../http/validate.js';
import type { CleanerService } from './service.js';

const int = (min: number, max: number) => z.number().int().min(min).max(max);

const settingsSchema = z
  .object({
    enabled: z.boolean(),
    maxStrikes: int(1, 50),
    strikeIntervalMinutes: int(1, 24 * 60),
    checkIntervalMinutes: int(1, 24 * 60),
    tbaMaxWaitHours: int(1, 24 * 60),
    waitForImportClick: z.boolean(),
    importClickMaxHours: int(1, 24 * 60),
    attemptsPerTitle: int(1, 50),
    stalledAfterHours: int(1, 24 * 30),
    failedEnabled: z.boolean(),
    slowEnabled: z.boolean(),
    slowMinBytesPerSecond: int(1, 1024 * 1024 * 1024),
    maxRemovalsPerRun: int(1, 500),
    protectedTags: z.array(z.string().trim().min(1).max(100)).max(50),
    whitelist: z.array(z.string().trim().min(1).max(200)).max(200),
  })
  .partial()
  .strict();

const keySchema = z.object({ key: z.string().min(1).max(500) });

export function registerCleanerRoutes(app: FastifyInstance, deps: { cleaner: CleanerService }): void {
  const { cleaner } = deps;
  const known = (id: string) => {
    if (!cleaner.isEligible(id)) throw new HttpError(404, 'notFound');
    return id;
  };

  app.get('/api/cleaner', async () => ({ instances: cleaner.summary(), orphans: cleaner.orphanList() }));

  app.get<{ Querystring: { instance?: string; limit?: string; before?: string } }>(
    '/api/cleaner/history',
    async (req) => {
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
      const before = Number(req.query.before) || undefined;
      return { entries: cleaner.history({ instanceId: req.query.instance, limit, before }) };
    },
  );

  app.get<{ Querystring: { instance?: string; days?: string; tz?: string } }>(
    '/api/cleaner/activity',
    async (req) => {
      const days = Math.min(90, Math.max(1, Number(req.query.days) || 14));
      const tz = Math.max(-840, Math.min(840, Number(req.query.tz) || 0));
      return { days: cleaner.activity({ instanceId: req.query.instance, days, tzMinutes: tz }) };
    },
  );

  app.get<{ Params: { id: string } }>('/api/cleaner/:id/preview', async (req) => {
    const plan = cleaner.preview(known(req.params.id));
    return { at: cleaner.nextRunAt(req.params.id)?.toISOString() ?? null, plan };
  });

  app.post<{ Params: { id: string } }>('/api/cleaner/:id/run', async (req) => {
    await cleaner.run(known(req.params.id));
    return { ok: true };
  });

  app.put<{ Params: { id: string } }>('/api/cleaner/:id/settings', async (req) => {
    const body = parse(settingsSchema, req.body ?? {});
    return { config: cleaner.saveConfig(known(req.params.id), body) };
  });

  /** Arming is a deliberate action: the request must confirm it. */
  app.post<{ Params: { id: string } }>('/api/cleaner/:id/arm', async (req) => {
    parse(z.object({ confirm: z.literal(true) }), req.body ?? {});
    return { config: cleaner.setDryRun(known(req.params.id), false, req.user!.id) };
  });

  app.post<{ Params: { id: string } }>('/api/cleaner/:id/disarm', async (req) => {
    return { config: cleaner.setDryRun(known(req.params.id), true, req.user!.id) };
  });

  app.post<{ Params: { id: string } }>('/api/cleaner/:id/downloads/remove', async (req) => {
    const body = parse(
      keySchema.extend({ blocklist: z.boolean(), search: z.boolean(), confirm: z.literal(true) }),
      req.body ?? {},
    );
    await cleaner.removeNow(known(req.params.id), body.key, body, req.user!.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/cleaner/:id/downloads/ignore', async (req) => {
    const body = parse(keySchema.extend({ ignored: z.boolean() }), req.body ?? {});
    cleaner.setIgnored(known(req.params.id), body.key, body.ignored, req.user!.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/cleaner/:id/downloads/import-preview', async (req) => {
    const body = parse(keySchema, req.body ?? {});
    const files = await cleaner.importPreview(known(req.params.id), body.key);
    // The raw *arr payload stays on the server.
    return { files: files.map(({ raw: _raw, ...f }) => f) };
  });

  app.post<{ Params: { id: string } }>('/api/cleaner/:id/downloads/import', async (req) => {
    const body = parse(
      keySchema.extend({
        paths: z.array(z.string().min(1).max(4096)).min(1).max(500),
        confirm: z.literal(true),
      }),
      req.body ?? {},
    );
    return cleaner.importConfirmed(known(req.params.id), body.key, body.paths, req.user!.id);
  });

  app.post<{ Params: { id: string } }>('/api/cleaner/:id/attempts/reset', async (req) => {
    const body = parse(z.object({ titleKey: z.string().min(1).max(200) }), req.body ?? {});
    cleaner.resetAttempts(known(req.params.id), body.titleKey, req.user!.id);
    return { ok: true };
  });

  app.post('/api/cleaner/orphans/delete', async (req) => {
    const body = parse(
      z.object({
        clientId: z.string().min(1),
        jobId: z.string().min(1).max(500),
        deleteFiles: z.boolean(),
        confirm: z.literal(true),
      }),
      req.body ?? {},
    );
    await cleaner.deleteOrphan(body.clientId, body.jobId, body.deleteFiles, req.user!.id);
    return { ok: true };
  });
}
