// Admin API for adapters and instances. Secrets are write-only.
import { AdapterError } from '@wardarr/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, parse } from '../http/validate.js';
import type { AdapterRegistry } from './registry.js';
import type { InstanceRuntime } from './runtime.js';
import { normalizeBaseUrl, type InstanceStore } from './store.js';

const optionsSchema = z
  .object({
    pollIntervalSeconds: z.number().int().min(15).max(3600).optional(),
    timeoutMs: z.number().int().min(1000).max(120000).optional(),
  })
  .strict();

const createSchema = z.object({
  adapter: z.string().min(1).max(64),
  name: z.string().min(1).max(64),
  baseUrl: z.string().min(1).max(2048),
  fields: z.record(z.string(), z.unknown()).default({}),
  enabled: z.boolean().optional(),
  allowInsecureTls: z.boolean().optional(),
  options: optionsSchema.optional(),
});

const updateSchema = createSchema.omit({ adapter: true }).partial();

const testSchema = z.object({
  adapter: z.string().min(1).max(64),
  baseUrl: z.string().min(1).max(2048),
  fields: z.record(z.string(), z.unknown()).default({}),
  allowInsecureTls: z.boolean().optional(),
  /** When set, empty secret fields use the stored values of this instance. */
  instanceId: z.string().optional(),
});

function testError(err: unknown): { ok: false; error: string } {
  if (err instanceof AdapterError) return { ok: false, error: err.kind };
  if (err instanceof HttpError) throw err;
  return { ok: false, error: 'badResponse' };
}

export function registerInstanceRoutes(
  app: FastifyInstance,
  deps: { registry: AdapterRegistry; store: InstanceStore; runtime: InstanceRuntime },
): void {
  app.get('/api/adapters', async () => {
    return deps.registry.all().map((d) => ({
      id: d.id,
      name: d.name,
      category: d.category,
      lifecycle: d.lifecycle,
      homepage: d.homepage,
      fields: d.fields,
      capabilities: d.capabilities,
    }));
  });

  app.get('/api/instances', async () => deps.store.list().map((r) => deps.store.toPublic(r)));

  app.get<{ Params: { id: string } }>('/api/instances/:id', async (req) => {
    const row = deps.store.get(req.params.id);
    if (!row) throw new HttpError(404, 'notFound');
    return deps.store.toPublic(row);
  });

  app.post('/api/instances/test', async (req) => {
    const body = parse(testSchema, req.body);
    const def = deps.registry.get(body.adapter);
    if (!def) throw new HttpError(400, 'unknownAdapter');
    const existing = body.instanceId ? deps.store.get(body.instanceId) : undefined;
    if (body.instanceId && (!existing || existing.adapter !== def.id)) throw new HttpError(404, 'notFound');
    const baseUrl = normalizeBaseUrl(body.baseUrl);
    const { merged } = deps.store.resolveCredentials(def, body.fields, existing);
    const adapter = deps.runtime.createAdapter(
      {
        id: existing?.id ?? 'test',
        name: existing?.name ?? def.name,
        baseUrl,
        allowInsecureTls: body.allowInsecureTls ?? false,
        options: existing?.options ?? {},
      },
      def,
      merged,
    );
    try {
      const info = await adapter.testConnection();
      return { ok: true, version: info.version, variant: info.variant ?? null };
    } catch (err) {
      return testError(err);
    }
  });

  app.post('/api/instances', async (req, reply) => {
    const body = parse(createSchema, req.body);
    const row = deps.store.create(body);
    deps.runtime.reload();
    void deps.runtime.poll(row.id);
    reply.code(201);
    return deps.store.toPublic(row);
  });

  app.patch<{ Params: { id: string } }>('/api/instances/:id', async (req) => {
    const body = parse(updateSchema, req.body);
    const row = deps.store.update(req.params.id, body);
    deps.runtime.reload();
    void deps.runtime.poll(row.id);
    return deps.store.toPublic(row);
  });

  app.delete<{ Params: { id: string } }>('/api/instances/:id', async (req, reply) => {
    if (!deps.store.get(req.params.id)) throw new HttpError(404, 'notFound');
    deps.store.delete(req.params.id);
    deps.runtime.reload();
    reply.code(204);
  });

  app.get<{ Params: { id: string } }>('/api/instances/:id/settings', async (req) => {
    const entry = deps.runtime.adapter(req.params.id);
    if (!entry) throw new HttpError(404, 'notFound');
    if (!entry.adapter.settings) return { sections: [] };
    try {
      const sections = await entry.gate.run(() => entry.adapter.settings!());
      // Defense in depth: never trust an adapter to have masked everything.
      return {
        sections: sections.map((s) => ({
          id: s.id,
          entries: s.entries.map((e) => (e.secret ? { ...e, value: e.value ? '********' : null } : e)),
        })),
      };
    } catch (err) {
      throw new HttpError(502, err instanceof AdapterError ? err.kind : 'badResponse');
    }
  });

  app.post<{ Params: { id: string } }>('/api/instances/:id/poll', async (req) => {
    if (!deps.store.get(req.params.id)) throw new HttpError(404, 'notFound');
    await deps.runtime.poll(req.params.id);
    return { ok: true };
  });
}
