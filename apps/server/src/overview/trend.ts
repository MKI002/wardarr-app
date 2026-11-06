// Short history of the overview's live numbers (download speed, downloads,
// streams), so the overview can draw sparklines. Kept in memory only: one
// point per minute for the last hour, rebuilt after a restart.
import type { FastifyInstance } from 'fastify';
import type { InstanceRuntime } from '../instances/runtime.js';

export interface TrendPoint {
  /** Start of the minute, ISO. */
  at: string;
  /** Sum of all download clients, bytes per second. */
  speed: number;
  downloads: number;
  streams: number;
}

const MINUTE = 60_000;
const KEEP = 60;

export class TrendSampler {
  private readonly points = new Map<number, TrendPoint>();

  constructor(
    private readonly runtime: InstanceRuntime,
    private readonly now: () => Date = () => new Date(),
  ) {
    runtime.onPolled(() => this.sample());
  }

  /** Records the current totals into the bucket of the current minute. */
  sample(): void {
    let speed = 0;
    let downloads = 0;
    let streams = 0;
    for (const { row, snapshot } of this.runtime.snapshots()) {
      if (!row.enabled) continue;
      for (const d of snapshot.downloads ?? []) {
        if (d.state !== 'downloading' && d.state !== 'queued' && d.state !== 'stalled') continue;
        downloads++;
        speed += d.speedBytesPerSecond ?? 0;
      }
      streams += snapshot.sessions?.length ?? 0;
    }
    const bucket = Math.floor(this.now().getTime() / MINUTE);
    this.points.set(bucket, { at: new Date(bucket * MINUTE).toISOString(), speed, downloads, streams });
    for (const key of this.points.keys()) if (key <= bucket - KEEP) this.points.delete(key);
  }

  list(): TrendPoint[] {
    return [...this.points.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p);
  }
}

export function registerTrendRoutes(app: FastifyInstance, deps: { trend: TrendSampler }): void {
  app.get('/api/overview/trend', async () => ({ points: deps.trend.list() }));
}
