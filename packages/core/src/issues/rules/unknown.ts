// Catch-all for messages no catalog rule recognizes. Must be last.
import type { IssueRule } from '../types.js';
import { hash, levelToSeverity, normalizeMessage, worstSeverity } from './helpers.js';

export const unknownMessage: IssueRule<Record<string, never>> = {
  id: 'unknown',
  detect(signal) {
    const key = `${signal.instance.adapter}:${signal.source ?? signal.kind}:${hash(normalizeMessage(signal.message))}`;
    return [{ key, params: {} }];
  },
  build(matches, ctx) {
    const first = matches[0]!.signal;
    const instances = [...new Map(matches.map((m) => [m.signal.instance.id, m.signal.instance])).values()];
    const href = ctx.webUrl(first.instance.id, { kind: 'system' });
    return {
      severity: worstSeverity(matches.map((m) => levelToSeverity(m.signal.level))),
      title: { key: 'issues.unknown.title', params: { instances: instances.map((i) => i.name).join(', ') } },
      affected: {
        key: 'issues.common.instances',
        params: { instances: instances.map((i) => i.name).join(', ') },
      },
      explanation: { key: 'issues.unknown.explanation' },
      fix: { key: 'issues.unknown.fix' },
      actions: [
        ...(href
          ? [
              {
                id: 'open-instance',
                kind: 'openLink' as const,
                class: 'safe' as const,
                label: { key: 'issues.action.openInstance', params: { name: first.instance.name } },
                href,
              },
            ]
          : []),
        ...(first.wikiUrl
          ? [
              {
                id: 'open-wiki',
                kind: 'openLink' as const,
                class: 'safe' as const,
                label: { key: 'issues.action.openWiki' },
                href: first.wikiUrl,
              },
            ]
          : []),
      ],
    };
  },
};
