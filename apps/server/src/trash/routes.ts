// TRaSH Guides API. Admin only (the default access).
import { TRASH_PRODUCTS } from '@wardarr/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, parse } from '../http/validate.js';
import { BRANCH_PATTERN, REPO_PATTERN } from './source.js';
import { GUARD_MODES, type TrashService } from './service.js';

const trashId = z.string().min(1).max(64);
const productSchema = z.enum(TRASH_PRODUCTS as unknown as ['radarr', 'sonarr']);

const templateProfileSchema = z
  .object({
    trashId,
    name: z.string().trim().max(100).optional(),
    groups: z.array(trashId).max(200),
    excludedFormats: z.array(trashId).max(500),
    extraFormats: z.array(trashId).max(500),
    scoreOverrides: z.record(trashId, z.number().int().min(-1_000_000).max(1_000_000)),
    scoreSet: z.string().min(1).max(64).optional(),
  })
  .strict();

const templateConfigSchema = z
  .object({
    profiles: z.array(templateProfileSchema).max(20),
    qualitySize: trashId.nullable(),
    naming: z.record(z.string().min(1).max(64), z.string().min(1).max(64)),
    rename: z.boolean(),
  })
  .strict();

const templateSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    product: productSchema,
    config: templateConfigSchema,
  })
  .strict();

const settingsSchema = z
  .object({
    repo: z.string().regex(REPO_PATTERN),
    branch: z.string().regex(BRANCH_PATTERN),
    refreshHours: z
      .number()
      .int()
      .min(1)
      .max(24 * 30),
    guardHours: z
      .number()
      .int()
      .min(1)
      .max(24 * 7),
    maxAutoChanges: z.number().int().min(1).max(1000),
    backupsPerInstance: z.number().int().min(1).max(100),
  })
  .partial()
  .strict();

export function registerTrashRoutes(app: FastifyInstance, deps: { trash: TrashService }): void {
  const { trash } = deps;

  app.get('/api/trash', async () => ({
    guide: trash.guideState(),
    settings: trash.settings(),
    instances: trash.instances(),
    templates: trash.templates(),
    changelog: trash.changelog(),
  }));

  app.post('/api/trash/guide/refresh', async () => trash.refreshGuide());

  app.put('/api/trash/settings', async (req) => ({
    settings: trash.saveSettings(parse(settingsSchema, req.body ?? {})),
  }));

  app.get<{ Params: { product: string } }>('/api/trash/catalog/:product', async (req) => {
    const product = parse(productSchema, req.params.product);
    await trash.ensureGuide();
    return trash.catalog(product);
  });

  /** Resolves a template without saving it, for the editor summary. */
  app.post('/api/trash/resolve', async (req) => {
    const body = parse(
      z.object({ product: productSchema, config: templateConfigSchema }).strict(),
      req.body ?? {},
    );
    await trash.ensureGuide();
    return trash.explain(body.product, body.config);
  });

  app.post('/api/trash/templates', async (req) => ({
    template: trash.saveTemplate(parse(templateSchema, req.body ?? {})),
  }));

  app.put<{ Params: { id: string } }>('/api/trash/templates/:id', async (req) => ({
    template: trash.saveTemplate({ ...parse(templateSchema, req.body ?? {}), id: req.params.id }),
  }));

  app.delete<{ Params: { id: string } }>('/api/trash/templates/:id', async (req) => {
    trash.deleteTemplate(req.params.id);
    return { ok: true };
  });

  app.put<{ Params: { id: string } }>('/api/trash/instances/:id/template', async (req) => {
    const body = parse(
      z.object({ templateId: z.string().min(1).max(64).nullable() }).strict(),
      req.body ?? {},
    );
    trash.assign(req.params.id, body.templateId);
    return { ok: true };
  });

  /** Auto modes change settings on their own, so they need `confirm: true`. */
  app.put<{ Params: { id: string } }>('/api/trash/instances/:id/guard', async (req) => {
    const body = parse(
      z.object({ mode: z.enum(GUARD_MODES as unknown as ['off']), confirm: z.boolean().optional() }).strict(),
      req.body ?? {},
    );
    trash.setGuard(req.params.id, body.mode, body.confirm === true);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/trash/instances/:id/resume', async (req) => {
    trash.resume(req.params.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/trash/instances/:id/check', async (req) => {
    await trash.check(req.params.id);
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/trash/instances/:id/preview', async (req) =>
    trash.preview(req.params.id),
  );

  /** Applies the previewed changes. A backup is taken first. */
  app.post<{ Params: { id: string } }>('/api/trash/instances/:id/sync', async (req) => {
    const body = parse(
      z.object({ confirm: z.literal(true), removals: z.boolean().optional() }).strict(),
      req.body ?? {},
    );
    return {
      entry: await trash.sync(req.params.id, { removals: body.removals === true, actor: req.user!.id }),
    };
  });

  app.post<{ Params: { id: string } }>('/api/trash/instances/:id/suggest', async (req) =>
    trash.suggestFromInstance(req.params.id),
  );

  app.post<{ Params: { id: string } }>('/api/trash/instances/:id/release-test', async (req) => {
    const body = parse(z.object({ title: z.string().trim().min(3).max(500) }).strict(), req.body ?? {});
    return trash.releaseTest(req.params.id, body.title);
  });

  app.get<{ Querystring: { instance?: string; limit?: string } }>('/api/trash/history', async (req) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    return { entries: trash.history({ instanceId: req.query.instance, limit }) };
  });

  app.post<{ Params: { id: string } }>('/api/trash/history/:id/rollback', async (req) => {
    const body = parse(z.object({ confirm: z.literal(true) }).strict(), req.body ?? {});
    if (!body.confirm) throw new HttpError(400, 'confirmationRequired');
    return { entry: await trash.rollback(req.params.id, req.user!.id) };
  });
}
