// The priority watchdog: indexers with a better score get a better (lower)
// priority. Prowlarr and the *arr apps take 1 (first) to 50 (last) and use it
// as a tie breaker between releases of the same quality.
//
// Where a priority has to be written depends on how an indexer gets into an
// app. Prowlarr pushes its priority to apps it syncs with "Full Sync". With
// "Add and Remove Only" it only creates and deletes entries, and indexers added
// by hand in an app are unknown to Prowlarr, so those are set in the app.
import type { ProwlarrSide, SourceAnalysis } from './sources.js';

export const PRIORITY_MIN = 1;
export const PRIORITY_MAX = 50;

export interface PriorityConfig {
  /** Priority of the best scored indexer. */
  best: number;
  /** Priority of the weakest scored indexer. */
  worst: number;
  /** Priorities are rounded to this step, so small score moves change nothing. */
  step: number;
  /** Also write to apps where Prowlarr does not push priorities. */
  includeApps: boolean;
}

/**
 * Score points that span the whole priority range at least. When every
 * indexer works well (scores of 85 to 98, say), a few points apart should not
 * put them at opposite ends of the range.
 */
export const MIN_SCORE_SPREAD = 30;

export const DEFAULT_PRIORITY_CONFIG: PriorityConfig = { best: 10, worst: 40, step: 5, includeApps: false };

export type PriorityTarget = 'prowlarr' | 'app';

/**
 * Why an entry is planned as it is:
 * - `change`: the priority will be written.
 * - `same`: it already has the planned priority.
 * - `close`: the planned value moved less than one step from the current one.
 * - `noScore`: not enough numbers for a score yet.
 * - `disabled`: switched off in Prowlarr.
 * - `prowlarrSyncs`: an app entry Prowlarr keeps in sync itself (Full Sync).
 * - `appsOff`: an app entry, but writing to apps is switched off.
 */
export type PriorityReason =
  'change' | 'same' | 'close' | 'noScore' | 'disabled' | 'prowlarrSyncs' | 'appsOff';

export interface PriorityItem {
  target: PriorityTarget;
  instanceId: string;
  instanceName: string;
  indexerId: number;
  indexerName: string;
  /** Site key, see `Tracker`. */
  key: string;
  score: number | null;
  current: number | null;
  /** The priority after this run; equals `current` unless `reason` is `change`. */
  planned: number | null;
  reason: PriorityReason;
  /** For app entries: how Prowlarr syncs this app, null when Prowlarr does not feed it. */
  syncLevel?: 'fullSync' | 'addOnly' | 'disabled' | null;
  source?: 'prowlarr' | 'direct';
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Keeps a config inside what Prowlarr and the apps accept. */
export function normalizePriorityConfig(input: Partial<PriorityConfig>): PriorityConfig {
  const d = DEFAULT_PRIORITY_CONFIG;
  const int = (v: unknown, fallback: number) => (Number.isFinite(v) ? Math.round(v as number) : fallback);
  const best = clamp(int(input.best, d.best), PRIORITY_MIN, PRIORITY_MAX);
  const worst = clamp(int(input.worst, d.worst), PRIORITY_MIN, PRIORITY_MAX);
  return {
    best: Math.min(best, worst),
    worst: Math.max(best, worst),
    step: clamp(int(input.step, d.step), 1, 10),
    includeApps: input.includeApps === true,
  };
}

/**
 * Target priority per site key. The best score gets `best`, the rest move
 * towards `worst` by how far they are behind it, rounded to `step`. A gap of
 * `MIN_SCORE_SPREAD` points or the gap to the weakest score, whichever is
 * larger, spans the whole range, so close scores stay close. The raw
 * (unrounded) value comes along for the hysteresis.
 */
export function targetPriorities(
  scores: ReadonlyMap<string, number | null>,
  config: PriorityConfig,
): Map<string, { value: number; raw: number }> {
  const scored = [...scores].filter((e): e is [string, number] => e[1] !== null);
  const out = new Map<string, { value: number; raw: number }>();
  if (scored.length === 0) return out;
  const top = Math.max(...scored.map(([, s]) => s));
  const low = Math.min(...scored.map(([, s]) => s));
  const span = config.worst - config.best;
  const spread = Math.max(top - low, MIN_SCORE_SPREAD);
  for (const [key, score] of scored) {
    const share = (top - score) / spread;
    const raw = config.best + share * span;
    const stepped = config.best + Math.round((raw - config.best) / config.step) * config.step;
    out.set(key, { value: clamp(stepped, config.best, config.worst), raw });
  }
  return out;
}

/**
 * Whether to write `target` over `current`. A value that is already a step
 * value inside the range stays while the raw target is less than a step away,
 * so an indexer near a boundary does not flip back and forth every day.
 */
function decide(
  current: number | null,
  target: { value: number; raw: number },
  config: PriorityConfig,
): PriorityReason {
  if (current === target.value) return 'same';
  const onGrid =
    current !== null &&
    current >= config.best &&
    current <= config.worst &&
    (current - config.best) % config.step === 0;
  if (onGrid && Math.abs(target.raw - current!) < config.step) return 'close';
  return 'change';
}

export interface PlanInput {
  analysis: SourceAnalysis;
  prowlarrs: ProwlarrSide[];
  /** Score per site key over the scoring range. */
  scores: ReadonlyMap<string, number | null>;
  config: PriorityConfig;
}

/** Every Prowlarr indexer and every app entry the watchdog looks at, with what it would do. */
export function planPriorities({ analysis, prowlarrs, scores, config }: PlanInput): PriorityItem[] {
  const targets = targetPriorities(scores, config);
  const items: PriorityItem[] = [];
  const plan = (current: number | null, key: string) => {
    const target = targets.get(key);
    if (!target) return { planned: current, reason: 'noScore' as const };
    const reason = decide(current, target, config);
    return { planned: reason === 'change' ? target.value : current, reason };
  };

  for (const p of prowlarrs) {
    for (const ix of p.indexers) {
      const key = `p:${p.instanceId}:${ix.id}`;
      const current = ix.priority ?? null;
      const base = {
        target: 'prowlarr' as const,
        instanceId: p.instanceId,
        instanceName: p.instanceName,
        indexerId: ix.id,
        indexerName: ix.name,
        key,
        score: scores.get(key) ?? null,
        current,
      };
      items.push(
        ix.enabled ? { ...base, ...plan(current, key) } : { ...base, planned: current, reason: 'disabled' },
      );
    }
  }

  const viaProwlarr = new Map(items.map((i) => [i.key, i.planned]));
  for (const app of analysis.arrs) {
    if (app.mode === 'unknown') continue;
    const syncLevel = app.prowlarrApp?.syncLevel ?? null;
    for (const ix of app.indexers) {
      const current = ix.priority ?? null;
      const base = {
        target: 'app' as const,
        instanceId: app.instanceId,
        instanceName: app.instanceName,
        indexerId: ix.id,
        indexerName: ix.name,
        key: ix.key,
        score: scores.get(ix.key) ?? null,
        current,
        syncLevel,
        source: ix.source,
      };
      // Prowlarr overwrites the entry on its next sync anyway.
      if (ix.source === 'prowlarr' && syncLevel === 'fullSync') {
        items.push({ ...base, planned: viaProwlarr.get(ix.key) ?? current, reason: 'prowlarrSyncs' });
        continue;
      }
      if (!config.includeApps) {
        items.push({ ...base, planned: current, reason: 'appsOff' });
        continue;
      }
      items.push({ ...base, ...plan(current, ix.key) });
    }
  }
  return items;
}
