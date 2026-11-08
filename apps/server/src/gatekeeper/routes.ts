// Gatekeeper ("Torwache"). Admin only (the default access).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../http/validate.js';
import type { GatekeeperService } from './service.js';

const settingsBody = z.object({
  extensions: z.array(z.string().max(32)).max(200).optional(),
  targets: z.record(z.string().max(64), z.boolean()).optional(),
  sabAction: z.enum(['abort', 'pause']).optional(),
  autoRepair: z.boolean().optional(),
});

export function registerGatekeeperRoutes(
  app: FastifyInstance,
  deps: { gatekeeper: GatekeeperService },
): void {
  const { gatekeeper } = deps;

  app.get('/api/gatekeeper', async (req) => {
    const q = parse(
      z.object({
        range: z.enum(['7d', '30d', '90d']).default('30d'),
        tz: z
          .string()
          .max(64)
          .regex(/^[A-Za-z0-9_+\-/]+$/)
          .optional(),
        refresh: z.enum(['1']).optional(),
      }),
      req.query,
    );
    return gatekeeper.view(q.range, q.tz ?? 'UTC', q.refresh === '1');
  });

  app.put('/api/gatekeeper/settings', async (req) => {
    await gatekeeper.saveConfig(parse(settingsBody, req.body));
    return { config: gatekeeper.config() };
  });

  /** Writes the list into the services again now. */
  app.post('/api/gatekeeper/apply', async () => ({ results: await gatekeeper.apply() }));

  /** Switches "Redownload Failed" on in an *arr app, so a blocked release is replaced. */
  app.post('/api/gatekeeper/redownload', async (req) => {
    const body = parse(z.object({ instanceId: z.string().min(1).max(64) }), req.body);
    return { check: await gatekeeper.enableRedownload(body.instanceId) };
  });

  /** Reads blocked downloads now instead of waiting for the next quarter hour. */
  app.post('/api/gatekeeper/collect', async () => {
    await gatekeeper.collect();
    return { ok: true };
  });
}
