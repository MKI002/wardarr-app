// Disk space and forecasts. Admins only: paths and sizes describe the server.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../http/validate.js';
import type { StorageService } from './service.js';

const settingsBody = z
  .object({
    warnDays: z.number().int().min(1).max(365),
    criticalDays: z.number().int().min(0).max(365),
    warnPercent: z.number().min(0).max(50),
    criticalPercent: z.number().min(0).max(50),
    lookbackDays: z.number().int().min(7).max(180),
  })
  .refine((s) => s.criticalDays <= s.warnDays && s.criticalPercent <= s.warnPercent, {
    message: 'critical must not be looser than warning',
  });

export function registerStorageRoutes(app: FastifyInstance, deps: { storage: StorageService }): void {
  const { storage } = deps;

  app.get('/api/storage', async (req) => {
    const q = parse(z.object({ days: z.coerce.number().int().min(7).max(365).default(90) }), req.query);
    return storage.list(q.days);
  });

  app.post('/api/storage/refresh', async () => {
    await storage.refresh();
    return { ok: true };
  });

  app.put('/api/storage/settings', async (req) => {
    return { settings: storage.saveSettings(parse(settingsBody, req.body)) };
  });
}
