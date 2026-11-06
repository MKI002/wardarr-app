// Settings and state of per-instance features (Queue Cleaner, Hunting).
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { featureSettings } from '../db/schema.js';

export type Feature = 'cleaner' | 'hunting';

export class FeatureStore {
  constructor(private readonly db: Db) {}

  private row(instanceId: string, feature: Feature) {
    return this.db
      .select()
      .from(featureSettings)
      .where(and(eq(featureSettings.instanceId, instanceId), eq(featureSettings.feature, feature)))
      .get();
  }

  /** Stored settings merged over the defaults, so new options get their default. */
  config<T extends object>(instanceId: string, feature: Feature, defaults: T): T {
    const stored = this.row(instanceId, feature)?.config ?? {};
    const out = { ...defaults } as Record<string, unknown>;
    for (const key of Object.keys(defaults)) if (key in stored) out[key] = stored[key];
    return out as T;
  }

  state<T extends object>(instanceId: string, feature: Feature, empty: T): T {
    return { ...empty, ...((this.row(instanceId, feature)?.state ?? {}) as Partial<T>) };
  }

  hasConfig(instanceId: string, feature: Feature): boolean {
    return !!this.row(instanceId, feature);
  }

  saveConfig(instanceId: string, feature: Feature, config: object): void {
    this.upsert(instanceId, feature, { config: config as Record<string, unknown> });
  }

  saveState(instanceId: string, feature: Feature, state: object): void {
    this.upsert(instanceId, feature, { state: state as Record<string, unknown> });
  }

  private upsert(
    instanceId: string,
    feature: Feature,
    patch: { config?: Record<string, unknown>; state?: Record<string, unknown> },
  ): void {
    const updatedAt = new Date().toISOString();
    this.db
      .insert(featureSettings)
      .values({ instanceId, feature, config: patch.config ?? {}, state: patch.state ?? {}, updatedAt })
      .onConflictDoUpdate({
        target: [featureSettings.instanceId, featureSettings.feature],
        set: { ...patch, updatedAt },
      })
      .run();
  }
}
