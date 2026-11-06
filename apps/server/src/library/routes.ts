// Library and stream statistics. Admins see everything; users see the
// shared statistics without other people's names.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../http/validate.js';
import type { StreamHistoryService } from '../streams/history.js';
import type { LibraryService } from './service.js';

const days = z.coerce.number().int().min(1).max(365).default(30);
/** The viewer's offset from UTC in minutes, for weekday and hour buckets. */
const tz = z.coerce.number().int().min(-840).max(840).default(0);

export function registerLibraryRoutes(
  app: FastifyInstance,
  deps: { library: LibraryService; history: StreamHistoryService },
): void {
  const { library, history } = deps;

  app.get('/api/library', async (req) => {
    const q = parse(z.object({ days, tz }), req.query);
    return { servers: library.list(), streams: history.stats(q.days, true, q.tz) };
  });

  app.post<{ Params: { id: string } }>('/api/library/:id/refresh', async (req) => {
    void library.refresh(req.params.id).catch(() => undefined);
    // Answer at once; the page follows the refresh through live updates.
    if (!library.list().some((s) => s.instanceId === req.params.id)) return { ok: false };
    return { ok: true };
  });

  app.get('/api/streams/history', async (req) => {
    const q = parse(
      z.object({
        limit: z.coerce.number().int().min(1).max(200).default(50),
        before: z.coerce.number().int().min(1).optional(),
      }),
      req.query,
    );
    return { plays: history.recent(q.limit, q.before) };
  });

  app.get('/api/stats', { config: { access: 'user' } }, async (req) => {
    const q = parse(z.object({ days, tz }), req.query);
    const { users: _users, ...streams } = history.stats(q.days, false, q.tz);
    return { library: library.totals(), streams };
  });
}
