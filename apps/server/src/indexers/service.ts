// Indexer overview from Prowlarr: status, statistics and which apps lose
// indexers when one fails.
import { AdapterError, type IndexerApp, type IndexerStats } from '@wardarr/core';
import { HttpError } from '../http/validate.js';
import type { InstanceRuntime } from '../instances/runtime.js';

const TTL_MS = 5 * 60_000;

function kindOf(err: unknown): string {
  return err instanceof AdapterError ? err.kind : 'badResponse';
}

export class IndexerService {
  private readonly cache = new Map<
    string,
    { at: number; stats: IndexerStats[] | null; apps: IndexerApp[] | null; error: string | null }
  >();

  constructor(
    private readonly runtime: InstanceRuntime,
    private readonly now: () => number = () => Date.now(),
  ) {
    runtime.onReload(() => this.cache.clear());
  }

  private eligible() {
    return this.runtime
      .snapshots()
      .filter(
        ({ row, def }) => row.enabled && def.category === 'indexer' && def.capabilities.includes('indexers'),
      );
  }

  private async details(instanceId: string, force: boolean) {
    const cached = this.cache.get(instanceId);
    if (!force && cached && this.now() - cached.at < TTL_MS) return cached;
    const entry = this.runtime.adapter(instanceId);
    let error: string | null = null;
    const read = async <T>(fn: (() => Promise<T>) | undefined): Promise<T | null> => {
      if (!fn || !entry) return null;
      try {
        return await entry.gate.run(fn);
      } catch (err) {
        error = kindOf(err);
        return null;
      }
    };
    const [stats, apps] = await Promise.all([
      read(entry?.adapter.indexerStats?.bind(entry.adapter)),
      read(entry?.adapter.indexerApps?.bind(entry.adapter)),
    ]);
    const out = { at: this.now(), stats, apps, error };
    this.cache.set(instanceId, out);
    return out;
  }

  async list(force = false) {
    return Promise.all(
      this.eligible().map(async ({ row, def, snapshot }) => {
        const d = await this.details(row.id, force);
        const statsById = new Map((d.stats ?? []).map((s) => [s.indexerId, s]));
        const apps = (d.apps ?? []).map((a) => ({
          id: a.id,
          name: a.name,
          implementation: a.implementation,
          enabled: a.enabled,
          indexerIds: a.indexerIds,
        }));
        const indexers = (snapshot.indexers ?? []).map((ix) => {
          const receivers = apps.filter((a) => a.enabled && a.indexerIds.includes(ix.id));
          const others = (app: (typeof apps)[number]) =>
            (snapshot.indexers ?? []).some(
              (o) => o.id !== ix.id && o.enabled && !o.failing && app.indexerIds.includes(o.id),
            );
          return {
            ...ix,
            stats: statsById.get(ix.id) ?? null,
            apps: receivers.map((a) => a.name),
            /** Apps that have no working indexer left while this one fails. */
            stranded: ix.failing ? receivers.filter((a) => !others(a)).map((a) => a.name) : [],
            webUrl: this.runtime.adapter(row.id)?.adapter.webUrl?.({ kind: 'indexer', id: ix.id }) ?? null,
          };
        });
        const failing = indexers.filter((i) => i.failing);
        return {
          instanceId: row.id,
          instanceName: row.name,
          adapterName: def.name,
          status: snapshot.status,
          checkedAt: snapshot.checkedAt,
          error: d.error,
          indexers,
          apps: apps.map((a) => ({
            ...a,
            failing: failing.filter((f) => a.indexerIds.includes(f.id)).map((f) => f.name),
          })),
        };
      }),
    );
  }

  async test(instanceId: string, indexerId: number): Promise<{ ok: boolean; message: string | null }> {
    if (!this.eligible().some((e) => e.row.id === instanceId)) throw new HttpError(404, 'notFound');
    const entry = this.runtime.adapter(instanceId);
    if (!entry?.adapter.testIndexer) throw new HttpError(400, 'unsupported');
    try {
      const result = await entry.gate.run(() => entry.adapter.testIndexer!(indexerId));
      return { ok: result.ok, message: result.message ?? null };
    } catch (err) {
      return { ok: false, message: kindOf(err) };
    } finally {
      void this.runtime.poll(instanceId);
    }
  }
}
