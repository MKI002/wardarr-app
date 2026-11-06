// Stack map of the connected services.
import type { FastifyInstance } from 'fastify';
import type { TopologyService } from './service.js';

export function registerTopologyRoutes(app: FastifyInstance, deps: { topology: TopologyService }): void {
  // Admin only: the map lists addresses and folders of the services.
  app.get<{ Querystring: { refresh?: string } }>('/api/topology', async (req) =>
    deps.topology.view(req.query.refresh === '1'),
  );
}
