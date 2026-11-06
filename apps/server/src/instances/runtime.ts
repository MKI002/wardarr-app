// Polls instances in isolation and keeps their latest state in memory.
import {
  AdapterError,
  sourceKey,
  type AdapterDefinition,
  type AdapterInstance,
  type ConnectionInfo,
  type DownloadJob,
  type IndexerInfo,
  type QueueItem,
  type Signal,
  type StreamSession,
} from '@wardarr/core';
import type { FastifyBaseLogger } from 'fastify';
import type { EventBus } from '../events/bus.js';
import type { IssueService } from '../issues/service.js';
import { InstanceGate } from '../jobs/gate.js';
import type { Scheduler } from '../jobs/scheduler.js';
import { createHttpClient } from '../net/httpClient.js';
import { redact } from '../security/redact.js';
import type { InstanceOptions, InstanceRow, InstanceStore } from './store.js';

export type InstanceHealth = 'ok' | 'degraded' | 'down' | 'unknown' | 'disabled';

export interface InstanceSnapshot {
  instanceId: string;
  status: InstanceHealth;
  connection: ConnectionInfo | null;
  checkedAt: string | null;
  errorKind: AdapterError['kind'] | null;
  signals: Signal[];
  queue: QueueItem[] | null;
  sessions: StreamSession[] | null;
  downloads: DownloadJob[] | null;
  indexers: IndexerInfo[] | null;
}

interface Entry {
  row: InstanceRow;
  def: AdapterDefinition<Record<string, unknown>>;
  adapter: AdapterInstance;
  gate: InstanceGate;
  snapshot: InstanceSnapshot;
  /** Last poll fully succeeded, so its signals are current. */
  current: boolean;
  inflight: Promise<void> | null;
}

const DEFAULT_POLL_SECONDS = 60;

function emptySnapshot(id: string, status: InstanceHealth): InstanceSnapshot {
  return {
    instanceId: id,
    status,
    connection: null,
    checkedAt: null,
    errorKind: null,
    signals: [],
    queue: null,
    sessions: null,
    downloads: null,
    indexers: null,
  };
}

function errorKind(err: unknown): AdapterError['kind'] {
  return err instanceof AdapterError ? err.kind : 'badResponse';
}

export class InstanceRuntime {
  private readonly entries = new Map<string, Entry>();
  private scheduler: Scheduler | null = null;

  constructor(
    private readonly store: InstanceStore,
    private readonly issues: IssueService,
    private readonly bus: EventBus,
    private readonly log: FastifyBaseLogger,
    private readonly defaultTimeoutMs: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Creates an adapter for a row, wired to an isolated HTTP client. */
  createAdapter(
    row: Pick<InstanceRow, 'id' | 'name' | 'baseUrl' | 'allowInsecureTls' | 'options'>,
    def: AdapterDefinition<Record<string, unknown>>,
    credentials: Record<string, unknown>,
  ): AdapterInstance {
    const options = row.options as InstanceOptions;
    const http = createHttpClient({
      baseUrl: row.baseUrl,
      timeoutMs: options.timeoutMs ?? this.defaultTimeoutMs,
      allowInsecureTls: row.allowInsecureTls,
    });
    const child = this.log.child({ instance: row.id, adapter: def.id });
    return def.create({
      instanceId: row.id,
      instanceName: row.name,
      baseUrl: row.baseUrl,
      credentials,
      http,
      log: {
        debug: (msg, data) => child.debug(redact(data ?? {}) as object, msg),
        warn: (msg, data) => child.warn(redact(data ?? {}) as object, msg),
      },
    });
  }

  /** Syncs adapters with the stored instances. Call after any change. */
  reload(): void {
    const rows = this.store.list();
    const seen = new Set<string>();
    for (const row of rows) {
      seen.add(row.id);
      const existing = this.entries.get(row.id);
      if (existing && existing.row.updatedAt === row.updatedAt) continue;
      const def = this.store.definition(row);
      const entry: Entry = {
        row,
        def,
        adapter: this.createAdapter(row, def, this.store.credentials(row)),
        gate: new InstanceGate({ concurrency: 4, failureThreshold: 3, openMs: 30_000 }),
        snapshot: emptySnapshot(row.id, row.enabled ? 'unknown' : 'disabled'),
        current: false,
        inflight: null,
      };
      this.entries.set(row.id, entry);
      this.scheduleEntry(entry);
    }
    for (const id of [...this.entries.keys()]) {
      if (!seen.has(id)) {
        this.entries.delete(id);
        this.scheduler?.cancel(`poll:${id}`);
      }
    }
    this.publishIssues();
    this.bus.publish({ type: 'instances.updated', audience: 'admin' });
  }

  start(scheduler: Scheduler): void {
    this.scheduler = scheduler;
    this.reload();
  }

  private scheduleEntry(entry: Entry): void {
    if (!this.scheduler) return;
    if (!entry.row.enabled) {
      this.scheduler.cancel(`poll:${entry.row.id}`);
      return;
    }
    const seconds = (entry.row.options as InstanceOptions).pollIntervalSeconds ?? DEFAULT_POLL_SECONDS;
    this.scheduler.schedule(`poll:${entry.row.id}`, seconds * 1000, () => this.poll(entry.row.id), 500);
  }

  snapshots(): Array<{
    row: InstanceRow;
    def: AdapterDefinition<Record<string, unknown>>;
    snapshot: InstanceSnapshot;
  }> {
    return [...this.entries.values()].map((e) => ({ row: e.row, def: e.def, snapshot: e.snapshot }));
  }

  adapter(
    id: string,
  ):
    | { adapter: AdapterInstance; gate: InstanceGate; def: AdapterDefinition<Record<string, unknown>> }
    | undefined {
    const e = this.entries.get(id);
    return e && { adapter: e.adapter, gate: e.gate, def: e.def };
  }

  /** Polls several instances in parallel; each one is isolated from the others. */
  async pollMany(ids: string[]): Promise<void> {
    await Promise.allSettled(ids.map((id) => this.poll(id)));
  }

  async poll(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry || !entry.row.enabled) return;
    if (entry.inflight) return entry.inflight;
    entry.inflight = this.doPoll(entry).finally(() => {
      entry.inflight = null;
    });
    return entry.inflight;
  }

  private async doPoll(entry: Entry): Promise<void> {
    const ref = { id: entry.row.id, name: entry.row.name, adapter: entry.def.id };
    const { adapter, gate } = entry;
    const snap: InstanceSnapshot = { ...entry.snapshot, checkedAt: this.now().toISOString() };
    const signals: Signal[] = [];
    let complete = true;

    try {
      snap.connection = await gate.run(() => adapter.testConnection());
      snap.errorKind = null;
    } catch (err) {
      const kind = errorKind(err);
      snap.status = 'down';
      snap.errorKind = kind;
      // Keep the last known service signals so their issues stay visible.
      const kept = entry.snapshot.signals.filter((s) => s.kind !== 'connection');
      snap.signals = [
        ...kept,
        {
          origin: 'service',
          instance: ref,
          kind: 'connection',
          level: 'error',
          message: kind,
          data: { errorKind: kind },
        },
      ];
      entry.snapshot = snap;
      entry.current = false;
      this.log.debug({ instance: ref.id, kind }, 'instance poll failed');
      this.publishIssues();
      return;
    }

    const step = async <T>(name: string, fn: (() => Promise<T>) | undefined): Promise<T | null> => {
      if (!fn) return null;
      try {
        return await gate.run(fn);
      } catch (err) {
        complete = false;
        signals.push({
          origin: 'wardarr',
          instance: ref,
          kind: 'health',
          source: `adapter.${name}`,
          level: 'warning',
          message: `Wardarr could not read ${name} from ${entry.row.name}: ${errorKind(err)}`,
        });
        return null;
      }
    };

    const [health, queue, sessions, downloads, indexers] = await Promise.all([
      step('health', adapter.health?.bind(adapter)),
      step('queue', adapter.queue?.bind(adapter)),
      step('sessions', adapter.sessions?.bind(adapter)),
      step('downloads', adapter.downloads?.bind(adapter)),
      step('indexers', adapter.indexers?.bind(adapter)),
    ]);

    if (health) signals.push(...health);
    if (queue) {
      for (const item of queue) {
        if (item.state !== 'failed') continue;
        signals.push({
          origin: 'service',
          instance: ref,
          kind: 'queueItem',
          source: 'Queue',
          level: 'warning',
          message: [item.title, item.errorMessage, ...item.statusMessages].filter(Boolean).join('. '),
          data: {
            state: 'failed',
            title: item.title,
            mediaKind: item.mediaKind,
            downloadId: item.downloadId ?? String(item.id),
          },
        });
      }
    }

    snap.queue = queue ?? entry.snapshot.queue;
    snap.sessions = sessions ?? entry.snapshot.sessions;
    snap.downloads = downloads ?? entry.snapshot.downloads;
    snap.indexers = indexers ?? entry.snapshot.indexers;
    snap.signals = signals;
    const hasProblems = signals.some((s) => s.level === 'error' || s.level === 'warning');
    snap.status = complete && !hasProblems ? 'ok' : 'degraded';
    entry.snapshot = snap;
    entry.current = complete;
    this.publishIssues();
    this.bus.publish({ type: 'overview.updated', audience: 'all' });
  }

  /** Feeds all current signals into the issue service. */
  private publishIssues(): void {
    const signals: Signal[] = [];
    const checked = new Set<string>();
    const active = new Set<string>();
    for (const e of this.entries.values()) {
      if (!e.row.enabled) continue;
      active.add(e.row.id);
      signals.push(...e.snapshot.signals);
      if (e.current) {
        checked.add(sourceKey('service', e.row.id));
        checked.add(sourceKey('wardarr', e.row.id));
      }
    }
    // Issues of removed or disabled instances can never be checked again,
    // so they count as checked and resolve.
    for (const issue of this.issues.list({ status: 'open' })) {
      for (const source of issue.group.sources) {
        const instanceId = source.split(':')[1];
        if (instanceId && !active.has(instanceId)) checked.add(source);
      }
    }
    this.issues.update(signals, checked);
  }
}
