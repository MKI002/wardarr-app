// Overview data and the capability map that drives which tabs are shown.
import { isMuted, needsAttention, sortGroups, type Capability } from '@wardarr/core';
import type { FastifyInstance } from 'fastify';
import type { InstanceRuntime } from '../instances/runtime.js';
import type { IssueService } from '../issues/service.js';

/** Tabs available in this build and the capability each one needs. */
const TABS: Array<{ id: string; needs: Capability | null; role: 'admin' | 'user' }> = [
  { id: 'overview', needs: null, role: 'admin' },
  { id: 'issues', needs: null, role: 'admin' },
  { id: 'cleaner', needs: 'queueActions', role: 'admin' },
  { id: 'hunting', needs: 'search', role: 'admin' },
  { id: 'settings', needs: null, role: 'user' },
];

export function registerOverviewRoutes(
  app: FastifyInstance,
  deps: { runtime: InstanceRuntime; issues: IssueService },
): void {
  app.get('/api/capabilities', { config: { access: 'user' } }, async (req) => {
    const caps = new Set<Capability>();
    const categories = new Set<string>();
    for (const { row, def } of deps.runtime.snapshots()) {
      if (!row.enabled) continue;
      categories.add(def.category);
      for (const c of def.capabilities) caps.add(c);
    }
    const isAdmin = req.user!.role === 'admin';
    const tabs = TABS.filter(
      (t) => (isAdmin || t.role === 'user') && (t.needs === null || caps.has(t.needs)),
    ).map((t) => t.id);
    return { tabs, capabilities: isAdmin ? [...caps] : [], categories: isAdmin ? [...categories] : [] };
  });

  app.get('/api/overview', async () => {
    const now = new Date();
    const snapshots = deps.runtime.snapshots();
    const instances = snapshots.map(({ row, def, snapshot }) => ({
      id: row.id,
      name: row.name,
      adapter: def.id,
      adapterName: def.name,
      category: def.category,
      lifecycle: def.lifecycle,
      status: snapshot.status,
      version: snapshot.connection?.version ?? null,
      checkedAt: snapshot.checkedAt,
      errorKind: snapshot.errorKind,
    }));
    const streams = snapshots.flatMap(({ row, snapshot }) =>
      (snapshot.sessions ?? []).map((s) => ({ ...s, instanceId: row.id, instanceName: row.name })),
    );
    const downloads = snapshots.flatMap(({ row, snapshot }) =>
      (snapshot.downloads ?? [])
        .filter(
          (d) =>
            d.state === 'downloading' ||
            d.state === 'queued' ||
            d.state === 'paused' ||
            d.state === 'stalled',
        )
        .map((d) => ({ ...d, instanceId: row.id, instanceName: row.name })),
    );
    const open = deps.issues.list({ status: 'open' }).filter((i) => !isMuted(i, now));
    const counts = { critical: 0, warning: 0, info: 0 };
    for (const i of open) counts[i.group.severity]++;
    const attention = sortGroups(needsAttention(open.map((i) => ({ ...i, severity: i.group.severity }))));
    return {
      instances,
      streams,
      downloads,
      issues: {
        counts,
        needsAttention: attention.slice(0, 6).map((i) => ({
          fingerprint: i.fingerprint,
          severity: i.group.severity,
          origin: i.group.origin,
          title: i.group.title,
          affected: i.group.affected,
        })),
        wardarr: open.filter((i) => i.group.origin === 'wardarr').length,
      },
      stats: {
        instancesOnline: instances.filter((i) => i.status === 'ok' || i.status === 'degraded').length,
        instancesTotal: instances.filter((i) => i.status !== 'disabled').length,
        activeStreams: streams.length,
        transcodes: streams.filter((s) => s.transcoding).length,
        activeDownloads: downloads.filter((d) => d.state === 'downloading').length,
        downloadSpeed: downloads.reduce((sum, d) => sum + (d.speedBytesPerSecond ?? 0), 0),
      },
    };
  });

  /** Read-only queue view. Actions on queue items come with the Queue Cleaner. */
  app.get<{ Querystring: { instance?: string } }>('/api/queue', async (req) => {
    return deps.runtime
      .snapshots()
      .filter(({ row, def }) => row.enabled && def.capabilities.includes('queue'))
      .filter(({ row }) => !req.query.instance || row.id === req.query.instance)
      .map(({ row, def, snapshot }) => ({
        instanceId: row.id,
        instanceName: row.name,
        adapter: def.id,
        adapterName: def.name,
        checkedAt: snapshot.checkedAt,
        items: snapshot.queue ?? [],
      }));
  });
}
