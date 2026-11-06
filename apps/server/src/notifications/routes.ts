// Notification channels. Admin only (the default access).
import { SUPPORTED_LANGUAGES } from '@wardarr/i18n';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../http/validate.js';
import { CHANNEL_KINDS, KIND_SCHEMAS, SECRET_FIELDS } from './senders.js';
import type { ChannelInput, NotificationService } from './service.js';

const input = z
  .object({
    name: z.string().trim().min(1).max(80),
    kind: z.enum(CHANNEL_KINDS),
    enabled: z.boolean().default(true),
    language: z.enum(SUPPORTED_LANGUAGES).default('en'),
    events: z
      .object({
        issueOpened: z.enum(['critical', 'warning', 'info', 'off']),
        issueResolved: z.boolean(),
        requestPending: z.boolean(),
      })
      .strict(),
    config: z.record(z.string(), z.unknown()).default({}),
    secret: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export function registerNotificationRoutes(
  app: FastifyInstance,
  deps: { notifications: NotificationService },
): void {
  const { notifications } = deps;

  app.get('/api/notifications', async () => ({
    channels: notifications.list(),
    kinds: CHANNEL_KINDS.map((kind) => ({
      kind,
      fields: Object.keys(KIND_SCHEMAS[kind].config.shape),
      secrets: SECRET_FIELDS[kind],
    })),
  }));

  app.post('/api/notifications', async (req, reply) => {
    const created = notifications.create(parse(input, req.body ?? {}) as ChannelInput);
    return reply.code(201).send(created);
  });

  app.put<{ Params: { id: string } }>('/api/notifications/:id', async (req) =>
    notifications.update(req.params.id, parse(input, req.body ?? {}) as ChannelInput),
  );

  app.delete<{ Params: { id: string } }>('/api/notifications/:id', async (req) => {
    notifications.delete(req.params.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/notifications/:id/test', async (req) =>
    notifications.test(req.params.id),
  );
}
