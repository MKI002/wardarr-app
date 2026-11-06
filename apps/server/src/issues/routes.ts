// Issue Center API.
import { AdapterError, type IssueGroup } from '@wardarr/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, parse } from '../http/validate.js';
import type { InstanceRuntime } from '../instances/runtime.js';
import type { IssueService } from './service.js';

const muteSchema = z.object({
  /** Minutes to mute; omitted means forever. */
  minutes: z
    .number()
    .int()
    .min(1)
    .max(60 * 24 * 365)
    .optional(),
});

export function registerIssueRoutes(
  app: FastifyInstance,
  deps: { issues: IssueService; runtime: InstanceRuntime },
): void {
  app.get<{ Querystring: { status?: string } }>('/api/issues', async (req) => {
    const status =
      req.query.status === 'resolved' ? 'resolved' : req.query.status === 'all' ? undefined : 'open';
    return deps.issues.list({ status });
  });

  app.get<{ Params: { fp: string } }>('/api/issues/:fp', async (req) => {
    return { issue: deps.issues.get(req.params.fp), history: deps.issues.history(req.params.fp) };
  });

  /** Polls only the sources of this issue and returns its new state. */
  app.post<{ Params: { fp: string } }>('/api/issues/:fp/recheck', async (req) => {
    const issue = deps.issues.get(req.params.fp);
    await deps.runtime.pollMany(issue.group.instances.map((i) => i.id));
    return deps.issues.get(req.params.fp);
  });

  app.post<{ Params: { fp: string } }>('/api/issues/:fp/mute', async (req) => {
    const body = parse(muteSchema, req.body ?? {});
    const until = body.minutes ? new Date(Date.now() + body.minutes * 60_000) : null;
    return deps.issues.mute(req.params.fp, until, req.user!.id);
  });

  app.post<{ Params: { fp: string } }>('/api/issues/:fp/unmute', async (req) => {
    return deps.issues.unmute(req.params.fp, req.user!.id);
  });

  /** Runs a harmless action of the issue, identified by its action id. */
  app.post<{ Params: { fp: string; actionId: string } }>('/api/issues/:fp/actions/:actionId', async (req) => {
    const issue = deps.issues.get(req.params.fp);
    const action = (issue.group as IssueGroup).actions.find((a) => a.id === req.params.actionId);
    if (!action) throw new HttpError(404, 'notFound');
    if (action.class !== 'safe') throw new HttpError(400, 'needsConfirmation');
    if (action.kind === 'testIndexer' && action.instanceId) {
      const entry = deps.runtime.adapter(action.instanceId);
      if (!entry?.adapter.testIndexer) throw new HttpError(400, 'unsupported');
      try {
        const result = await entry.gate.run(() =>
          entry.adapter.testIndexer!(Number(action.payload?.indexerId)),
        );
        return { ok: result.ok, message: result.message ?? null };
      } catch (err) {
        return { ok: false, message: err instanceof AdapterError ? err.kind : 'badResponse' };
      }
    }
    throw new HttpError(400, 'unsupported');
  });
}
