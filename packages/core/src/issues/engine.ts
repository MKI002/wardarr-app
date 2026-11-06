// Groups raw signals into issue groups, one group per cause.
import type {
  InstanceRef,
  IssueAction,
  IssueDetail,
  IssueGroup,
  IssueRule,
  MatchedSignal,
  RuleContext,
  Severity,
  Signal,
} from './types.js';

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

export const emptyRuleContext: RuleContext = {
  webUrl: () => undefined,
  findIndexer: () => undefined,
};

interface Bucket {
  rule: IssueRule;
  key: string;
  matches: MatchedSignal<Record<string, unknown>>[];
}

/** Actions every group has. */
function commonActions(fingerprint: string): IssueAction[] {
  return [
    {
      id: 'recheck',
      kind: 'recheck',
      class: 'safe',
      label: { key: 'issues.action.recheck' },
      payload: { fingerprint },
    },
    {
      id: 'mute',
      kind: 'mute',
      class: 'safe',
      label: { key: 'issues.action.mute' },
      payload: { fingerprint },
    },
  ];
}

function uniqueInstances(signals: Signal[]): InstanceRef[] {
  const seen = new Map<string, InstanceRef>();
  for (const s of signals) if (!seen.has(s.instance.id)) seen.set(s.instance.id, s.instance);
  return [...seen.values()];
}

function details(signals: Signal[]): IssueDetail[] {
  const seen = new Set<string>();
  const out: IssueDetail[] = [];
  for (const s of signals) {
    const id = `${s.instance.id}\u0000${s.source ?? ''}\u0000${s.message}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      instance: s.instance,
      source: s.source,
      level: s.level,
      message: s.message,
      wikiUrl: s.wikiUrl,
    });
  }
  return out;
}

/**
 * Groups signals by the fingerprint of their cause. The first rule whose
 * `detect` returns a result wins; the catalog must end with a catch-all rule.
 */
export function groupSignals(
  signals: Signal[],
  rules: readonly IssueRule[],
  ctx: RuleContext = emptyRuleContext,
): IssueGroup[] {
  const buckets = new Map<string, Bucket>();
  for (const signal of signals) {
    for (const rule of rules) {
      const hits = rule.detect(signal);
      if (!hits) continue;
      for (const hit of hits) {
        const fingerprint = `${rule.id}:${hit.key}`;
        let bucket = buckets.get(fingerprint);
        if (!bucket) {
          bucket = { rule, key: hit.key, matches: [] };
          buckets.set(fingerprint, bucket);
        }
        bucket.matches.push({ signal, params: hit.params as Record<string, unknown> });
      }
      break;
    }
  }

  const groups: IssueGroup[] = [];
  for (const [fingerprint, bucket] of buckets) {
    const out = bucket.rule.build(bucket.matches, ctx);
    const signalsOfGroup = bucket.matches.map((m) => m.signal);
    groups.push({
      fingerprint,
      ruleId: bucket.rule.id,
      origin: signalsOfGroup[0]!.origin,
      severity: out.severity,
      title: out.title,
      affected: out.affected,
      explanation: out.explanation,
      fix: out.fix,
      instances: uniqueInstances(signalsOfGroup),
      details: details(signalsOfGroup),
      items: out.items ?? [],
      actions: [...out.actions, ...commonActions(fingerprint)],
    });
  }
  return sortGroups(groups);
}

export function sortGroups<T extends Pick<IssueGroup, 'severity' | 'fingerprint'>>(groups: T[]): T[] {
  return [...groups].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.fingerprint.localeCompare(b.fingerprint),
  );
}

/** Groups that belong under "Needs attention". Info never does. */
export function needsAttention<T extends Pick<IssueGroup, 'severity'>>(groups: T[]): T[] {
  return groups.filter((g) => g.severity !== 'info');
}
