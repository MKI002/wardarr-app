// Server-sent events. Clients refetch the named resource on each event.
import type { FastifyInstance } from 'fastify';
import type { EventBus } from './bus.js';

const HEARTBEAT_MS = 25_000;

export function registerEventRoutes(app: FastifyInstance, deps: { bus: EventBus }): void {
  app.get('/api/events', { config: { access: 'user' } }, (req, reply) => {
    const isAdmin = req.user!.role === 'admin';
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write('retry: 5000\n\n');
    const unsubscribe = deps.bus.subscribe((event) => {
      if (event.audience === 'admin' && !isAdmin) return;
      res.write(`event: ${event.type}\ndata: {}\n\n`);
    });
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    req.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
