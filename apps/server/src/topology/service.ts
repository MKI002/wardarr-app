// The stack map: what each service reports about its neighbours, matched to
// the connected instances, with live status from the latest polls on top.
import {
  AdapterError,
  deriveStackGraph,
  type MapEdge,
  type MapNode,
  type ServiceTopology,
  type TopologyInput,
} from '@wardarr/core';
import type { InstanceRuntime, InstanceSnapshot } from '../instances/runtime.js';

const TTL_MS = 5 * 60_000;
const ACTIVE_QUEUE = new Set([
  'downloading',
  'queued',
  'paused',
  'warning',
  'importPending',
  'importBlocked',
]);

type Tone = 'ok' | 'warning' | 'critical' | 'unknown' | 'off';

export interface MapNodeView extends MapNode {
  status: Tone;
  /** Product name, for example `Sonarr`. */
  adapterName?: string;
  instanceStatus?: InstanceSnapshot['status'];
  version?: string | null;
  checkedAt?: string | null;
  errorKind?: string | null;
  webUrl?: string | null;
  /** Small live figures shown on the node. */
  live: {
    downloading?: number;
    speed?: number;
    queue?: number;
    streams?: number;
    transcodes?: number;
    indexers?: number;
    failingIndexers?: number;
    issues?: number;
  };
}

export interface MapEdgeView extends MapEdge {
  status: Tone;
  /** Downloads running over this link right now. */
  active?: number;
  /** Indexers this link carries that are failing. */
  failing?: number;
}

export interface StackMapView {
  nodes: MapNodeView[];
  edges: MapEdgeView[];
  /** Instances whose neighbours could not be read. */
  unread: string[];
  readAt: string | null;
}

function kindOf(err: unknown): string {
  return err instanceof AdapterError ? err.kind : 'badResponse';
}

const STATUS_TONE: Record<InstanceSnapshot['status'], Tone> = {
  ok: 'ok',
  degraded: 'warning',
  down: 'critical',
  unknown: 'unknown',
  disabled: 'off',
};

export class TopologyService {
  private readonly cache = new Map<
    string,
    { at: number; updatedAt: string; topology: ServiceTopology | null; error: string | null }
  >();
  private inflight: Promise<void> | null = null;

  constructor(
    private readonly runtime: InstanceRuntime,
    private readonly now: () => number = () => Date.now(),
  ) {
    runtime.onReload(() => {
      const ids = new Set(runtime.snapshots().map((s) => s.row.id));
      for (const id of this.cache.keys()) if (!ids.has(id)) this.cache.delete(id);
    });
  }

  /** Reads the neighbours of every instance whose cached answer is stale. */
  private async refresh(force: boolean): Promise<void> {
    const stale = this.runtime.snapshots().filter(({ row, snapshot }) => {
      if (!row.enabled) return false;
      const c = this.cache.get(row.id);
      if (!c || c.updatedAt !== row.updatedAt) return true;
      if (force) return true;
      // A service that was down when read is read again once it is back.
      if (c.error && snapshot.status !== 'down') return this.now() - c.at > 30_000;
      return this.now() - c.at > TTL_MS;
    });
    await Promise.all(
      stale.map(async ({ row }) => {
        const entry = this.runtime.adapter(row.id);
        let topology: ServiceTopology | null = null;
        let error: string | null = null;
        if (entry?.adapter.topology) {
          try {
            topology = await entry.gate.run(() => entry.adapter.topology!());
          } catch (err) {
            error = kindOf(err);
          }
        }
        this.cache.set(row.id, { at: this.now(), updatedAt: row.updatedAt, topology, error });
      }),
    );
  }

  async view(force = false): Promise<StackMapView> {
    // Parallel callers share one refresh.
    if (!this.inflight) this.inflight = this.refresh(force).finally(() => (this.inflight = null));
    await this.inflight;

    const snaps = this.runtime.snapshots();
    const inputs: TopologyInput[] = snaps.map(({ row, def }) => ({
      id: row.id,
      name: row.name,
      adapter: def.id,
      category: def.category,
      baseUrl: row.baseUrl,
      enabled: row.enabled,
      topology: this.cache.get(row.id)?.topology ?? null,
    }));
    const graph = deriveStackGraph(inputs);
    const byId = new Map(snaps.map((s) => [s.row.id, s]));

    const nodes = graph.nodes.map((n): MapNodeView => {
      if (n.type === 'ghost') return { ...n, status: 'unknown', live: {} };
      if (n.type === 'storage') {
        const s = n.storage!;
        const share = s.totalBytes && s.freeBytes !== null ? s.freeBytes / s.totalBytes : null;
        const blocked = s.members.some((m) => m.accessible === false);
        const status: Tone =
          blocked || (share !== null && share < 0.03)
            ? 'critical'
            : share !== null && share < 0.1
              ? 'warning'
              : 'ok';
        return { ...n, status, live: {} };
      }
      const e = byId.get(n.instanceId!)!;
      const snap = e.snapshot;
      const live: MapNodeView['live'] = {};
      if (snap.queue) live.queue = snap.queue.filter((q) => ACTIVE_QUEUE.has(q.state)).length;
      if (snap.downloads) {
        const running = snap.downloads.filter((d) => d.state === 'downloading');
        live.downloading = running.length;
        live.speed = running.reduce((sum, d) => sum + (d.speedBytesPerSecond ?? 0), 0);
      }
      if (snap.sessions) {
        live.streams = snap.sessions.length;
        live.transcodes = snap.sessions.filter((s) => s.transcoding).length;
      }
      if (snap.indexers) {
        live.indexers = snap.indexers.filter((i) => i.enabled).length;
        live.failingIndexers = snap.indexers.filter((i) => i.enabled && i.failing).length;
      }
      const issues = snap.signals.filter((s) => s.level === 'error' || s.level === 'warning').length;
      if (issues) live.issues = issues;
      return {
        ...n,
        status: STATUS_TONE[snap.status],
        adapterName: e.def.name,
        instanceStatus: snap.status,
        version: snap.connection?.version ?? null,
        checkedAt: snap.checkedAt,
        errorKind: snap.errorKind,
        webUrl: this.runtime.adapter(e.row.id)?.adapter.webUrl?.() ?? null,
        live,
      };
    });

    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const edges = graph.edges.map((edge): MapEdgeView => {
      const from = nodeById.get(edge.from)!;
      const to = nodeById.get(edge.to)!;
      const view: MapEdgeView = { ...edge, status: 'ok' };
      if (edge.kind === 'downloads') {
        const labels = new Set(edge.labels.map((l) => l.toLowerCase()));
        const queue = byId.get(edge.from)?.snapshot.queue ?? [];
        view.active = queue.filter(
          (q) => q.state === 'downloading' && q.downloadClient && labels.has(q.downloadClient.toLowerCase()),
        ).length;
      }
      if (edge.kind === 'indexers' && edge.indexerIds) {
        const ids = new Set(edge.indexerIds);
        view.failing = (byId.get(edge.from)?.snapshot.indexers ?? []).filter(
          (i) => ids.has(i.id) && i.failing,
        ).length;
      }
      const ends = [from.status, to.status];
      if (!edge.enabled || ends.includes('off')) view.status = 'off';
      else if (ends.includes('critical')) view.status = 'critical';
      else if (view.failing) view.status = 'warning';
      else if (to.type === 'ghost') view.status = 'unknown';
      return view;
    });

    const unread = snaps
      .filter(({ row }) => row.enabled && this.cache.get(row.id)?.error)
      .map(({ row }) => row.id);
    const times = [...this.cache.values()].map((c) => c.at);
    return {
      nodes,
      edges,
      unread,
      readAt: times.length ? new Date(Math.min(...times)).toISOString() : null,
    };
  }
}
