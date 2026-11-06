// Problems seen in *arr queues.
import type { MediaKind } from '../../adapter/types.js';
import type { IssueRule } from '../types.js';

interface FailedParams {
  title: string;
  mediaKind: MediaKind;
  downloadId: string;
}

/**
 * Failed downloads of one instance form one group. Season packs share a
 * download id and are counted once.
 */
export const downloadsFailed: IssueRule<FailedParams> = {
  id: 'downloads-failed',
  detect(signal) {
    if (signal.kind !== 'queueItem' || signal.data?.state !== 'failed') return null;
    const mediaKind = (signal.data.mediaKind as MediaKind | undefined) ?? 'item';
    const title = typeof signal.data.title === 'string' ? signal.data.title : signal.message;
    const downloadId = typeof signal.data.downloadId === 'string' ? signal.data.downloadId : title;
    return [{ key: signal.instance.id, params: { title, mediaKind, downloadId } }];
  },
  build(matches) {
    const instance = matches[0]!.signal.instance;
    const unique = new Map<string, FailedParams>();
    for (const m of matches) if (!unique.has(m.params.downloadId)) unique.set(m.params.downloadId, m.params);
    const count = unique.size;
    const kinds = new Set([...unique.values()].map((p) => p.mediaKind));
    const kind = kinds.size === 1 ? [...kinds][0]! : 'item';
    return {
      severity: 'warning',
      title: { key: 'issues.downloadsFailed.title', params: { count, instance: instance.name } },
      affected: { key: `issues.mediaKind.${kind}`, params: { count } },
      explanation: { key: 'issues.downloadsFailed.explanation' },
      fix: { key: 'issues.downloadsFailed.fix' },
      items: [...unique.values()].map((p) => ({ label: p.title, instanceId: instance.id })),
      actions: [
        {
          id: 'open-queue',
          kind: 'openWardarr',
          class: 'safe',
          label: { key: 'issues.action.openQueue' },
          href: `/cleaner?instance=${encodeURIComponent(instance.id)}`,
        },
      ],
    };
  },
};
