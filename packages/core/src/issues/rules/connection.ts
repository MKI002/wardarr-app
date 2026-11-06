// Wardarr cannot reach or log in to an instance.
import type { IssueRule } from '../types.js';

export const instanceUnreachable: IssueRule<{ errorKind: string }> = {
  id: 'instance-unreachable',
  detect(signal) {
    if (signal.kind !== 'connection') return null;
    const errorKind = String(signal.data?.errorKind ?? 'unreachable');
    if (errorKind === 'unauthorized') return null;
    return [{ key: signal.instance.id, params: { errorKind } }];
  },
  build(matches) {
    const instance = matches[0]!.signal.instance;
    const errorKind = matches[0]!.params.errorKind;
    return {
      severity: 'critical',
      title: { key: 'issues.unreachable.title', params: { instance: instance.name } },
      affected: { key: 'issues.common.instances', params: { instances: instance.name } },
      explanation: {
        key:
          errorKind === 'timeout'
            ? 'issues.unreachable.explanationTimeout'
            : 'issues.unreachable.explanation',
      },
      fix: { key: 'issues.unreachable.fix', params: { instance: instance.name } },
      actions: [
        {
          id: 'open-settings',
          kind: 'openWardarr',
          class: 'safe',
          label: { key: 'issues.action.openSettings' },
          href: `/settings/instances/${encodeURIComponent(instance.id)}`,
        },
      ],
    };
  },
};

export const credentialsRejected: IssueRule<Record<string, never>> = {
  id: 'credentials-rejected',
  detect(signal) {
    if (signal.kind !== 'connection' || signal.data?.errorKind !== 'unauthorized') return null;
    return [{ key: signal.instance.id, params: {} }];
  },
  build(matches) {
    const instance = matches[0]!.signal.instance;
    return {
      severity: 'critical',
      title: { key: 'issues.unauthorized.title', params: { instance: instance.name } },
      affected: { key: 'issues.common.instances', params: { instances: instance.name } },
      explanation: { key: 'issues.unauthorized.explanation' },
      fix: { key: 'issues.unauthorized.fix' },
      actions: [
        {
          id: 'open-settings',
          kind: 'openWardarr',
          class: 'safe',
          label: { key: 'issues.action.openSettings' },
          href: `/settings/instances/${encodeURIComponent(instance.id)}`,
        },
      ],
    };
  },
};
