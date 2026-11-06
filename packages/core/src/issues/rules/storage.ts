// Root folder and path mapping problems of *arr apps.
import type { IssueRule } from '../types.js';
import { listAfterColon } from './helpers.js';

export const rootFolderMissing: IssueRule<{ folders: string[] }> = {
  id: 'root-folder-missing',
  detect(signal) {
    if (signal.kind !== 'health' || signal.source !== 'RootFolderCheck') return null;
    return [{ key: signal.instance.id, params: { folders: listAfterColon(signal.message) } }];
  },
  build(matches, ctx) {
    const instance = matches[0]!.signal.instance;
    const folders = [...new Set(matches.flatMap((m) => m.params.folders))];
    const href = ctx.webUrl(instance.id, { kind: 'settings' });
    return {
      severity: 'critical',
      title: { key: 'issues.rootFolder.title', params: { instance: instance.name } },
      affected: {
        key: 'issues.rootFolder.affected',
        params: { count: folders.length, folders: folders.join(', ') },
      },
      explanation: { key: 'issues.rootFolder.explanation' },
      fix: { key: 'issues.rootFolder.fix' },
      actions: href
        ? [
            {
              id: 'open-instance',
              kind: 'openLink',
              class: 'safe',
              label: { key: 'issues.action.openInstance', params: { name: instance.name } },
              href,
            },
          ]
        : [],
    };
  },
};

export const remotePathMapping: IssueRule<Record<string, never>> = {
  id: 'remote-path-mapping',
  detect(signal) {
    if (signal.kind !== 'health' || signal.source !== 'RemotePathMappingCheck') return null;
    return [{ key: signal.instance.id, params: {} }];
  },
  build(matches, ctx) {
    const instance = matches[0]!.signal.instance;
    const href = ctx.webUrl(instance.id, { kind: 'settings' });
    return {
      severity: 'warning',
      title: { key: 'issues.remotePath.title', params: { instance: instance.name } },
      affected: { key: 'issues.common.instances', params: { instances: instance.name } },
      explanation: { key: 'issues.remotePath.explanation' },
      fix: { key: 'issues.remotePath.fix' },
      actions: [
        {
          id: 'guide',
          kind: 'guide',
          class: 'guide',
          label: { key: 'issues.action.showSteps' },
          steps: [
            { key: 'issues.remotePath.step1' },
            { key: 'issues.remotePath.step2' },
            { key: 'issues.remotePath.step3' },
          ],
        },
        ...(href
          ? [
              {
                id: 'open-instance',
                kind: 'openLink' as const,
                class: 'safe' as const,
                label: { key: 'issues.action.openInstance', params: { name: instance.name } },
                href,
              },
            ]
          : []),
      ],
    };
  },
};
