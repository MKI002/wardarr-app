// Calendar routes. Everyone with an account sees what's coming; each person
// manages their own iCal link, admins see and revoke all of them.
//
// The feed itself is public, because calendar apps cannot log in. It is
// protected by the random token in its path, which works like a password:
// only its hash is stored, it can be revoked at any time, and it stops working
// when the account is disabled or deleted.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, parse } from '../http/validate.js';
import { buildCalendar } from './ical.js';
import type { CalendarService } from './service.js';

const DAY = 86_400_000;
const MAX_RANGE_DAYS = 100;
/** The feed covers two weeks back and three months ahead. */
const FEED_BACK_DAYS = 14;
const FEED_AHEAD_DAYS = 90;

const time = z
  .string()
  .max(40)
  .refine((v) => /^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(Date.parse(v)), 'invalidDate')
  .transform((v) => new Date(v));

export const feedPath = (token: string) => `/api/calendar/ical/${token}.ics`;

export function registerCalendarRoutes(
  app: FastifyInstance,
  deps: { calendar: CalendarService; publicUrl?: string },
): void {
  const { calendar } = deps;
  // Trailing slashes are trimmed without a regular expression (no backtracking on long runs).
  let base = deps.publicUrl;
  while (base?.endsWith('/')) base = base.slice(0, -1);

  app.get('/api/calendar', { config: { access: 'user' } }, async (req) => {
    const q = parse(z.object({ start: time.optional(), end: time.optional() }), req.query);
    const now = Date.now();
    const start = q.start ?? new Date(now - DAY);
    const end = q.end ?? new Date(now + 30 * DAY);
    if (end.getTime() < start.getTime()) throw new HttpError(400, 'invalidInput', [{ path: 'end' }]);
    if (end.getTime() - start.getTime() > MAX_RANGE_DAYS * DAY)
      throw new HttpError(400, 'rangeTooLong', { maxDays: MAX_RANGE_DAYS });
    return calendar.range(start, end);
  });

  app.get('/api/calendar/feed', { config: { access: 'user' } }, async (req) => ({
    feed: calendar.feedOf(req.user!.id),
  }));

  app.post('/api/calendar/feed', { config: { access: 'user' } }, async (req, reply) => {
    const { token, feed } = calendar.createFeed(req.user!.id);
    const path = feedPath(token);
    reply.header('cache-control', 'no-store');
    return reply.code(201).send({ feed, path, url: base ? `${base}${path}` : null });
  });

  app.delete('/api/calendar/feed', { config: { access: 'user' } }, async (_req, reply) => {
    calendar.revokeFeedOf(_req.user!.id);
    return reply.code(204).send();
  });

  app.get('/api/calendar/feeds', async () => ({ feeds: calendar.feeds() }));

  app.delete<{ Params: { id: string } }>('/api/calendar/feeds/:id', async (req, reply) => {
    if (!calendar.revokeFeed(req.params.id)) throw new HttpError(404, 'notFound');
    return reply.code(204).send();
  });

  app.get<{ Params: { file: string } }>(
    '/api/calendar/ical/:file',
    { config: { access: 'public', rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const token = req.params.file.replace(/\.ics$/, '');
      const owner = calendar.resolveFeed(token);
      if (!owner) throw new HttpError(404, 'notFound');
      const now = new Date();
      const { items } = await calendar.range(
        new Date(now.getTime() - FEED_BACK_DAYS * DAY),
        new Date(now.getTime() + FEED_AHEAD_DAYS * DAY),
      );
      const lang = owner.preferences.language === 'de' ? 'de' : 'en';
      reply.header('content-type', 'text/calendar; charset=utf-8');
      reply.header('content-disposition', 'inline; filename="wardarr.ics"');
      reply.header('cache-control', 'private, max-age=300');
      return reply.send(buildCalendar({ name: 'Wardarr', lang, items, now }));
    },
  );
}
