// Carries out a plan. In a dry run nothing is sent to any service; the
// result lists what would have happened.
import type { SearchTarget } from '../adapter/types.js';
import type { CleanerPlan, CleanerRule } from './types.js';

export interface CleanerOps {
  removeQueueItem(queueId: number, opts: { removeFromClient: boolean; blocklist: boolean }): Promise<void>;
  search(target: SearchTarget): Promise<void>;
}

export type ExecutedKind = 'strike' | 'remove' | 'removeBlocklist' | 'search' | 'deferred';

export interface ExecutedAction {
  key: string;
  title: string;
  kind: ExecutedKind;
  rule: CleanerRule;
  reason: CleanerPlan['downloads'][number]['reason'];
  dryRun: boolean;
  ok: boolean;
  error?: string;
}

export async function executePlan(
  plan: CleanerPlan,
  opts: { dryRun: boolean },
  ops: CleanerOps,
): Promise<ExecutedAction[]> {
  const out: ExecutedAction[] = [];
  for (const d of plan.downloads) {
    const base = { key: d.key, title: d.title, rule: d.rule, reason: d.reason, dryRun: opts.dryRun };
    const a = d.action;
    if (a.type === 'strike') out.push({ ...base, kind: 'strike', ok: true });
    if (a.type === 'deferred') out.push({ ...base, kind: 'deferred', ok: true });
    if (a.type !== 'remove') continue;
    const kind: ExecutedKind = a.blocklist ? 'removeBlocklist' : 'remove';
    if (opts.dryRun) {
      out.push({ ...base, kind, ok: true });
      if (a.search) out.push({ ...base, kind: 'search', ok: true });
      continue;
    }
    try {
      // One call per download: removing the first record removes the whole season pack.
      await ops.removeQueueItem(a.queueId, { removeFromClient: true, blocklist: a.blocklist });
      out.push({ ...base, kind, ok: true });
    } catch (err) {
      out.push({ ...base, kind, ok: false, error: err instanceof Error ? err.message : 'failed' });
      continue;
    }
    if (a.search) {
      try {
        await ops.search(a.search);
        out.push({ ...base, kind: 'search', ok: true });
      } catch (err) {
        out.push({
          ...base,
          kind: 'search',
          ok: false,
          error: err instanceof Error ? err.message : 'failed',
        });
      }
    }
  }
  return out;
}
