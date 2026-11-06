// Problems of Wardarr itself, shown apart from problems of connected services.
import type { IssueRule, Msg } from '../types.js';

interface CacheParams {
  failedLibraries: number;
  staleHours: number;
}

/**
 * Wardarr keeps a cache of media server libraries for statistics. Refresh
 * failures and a stale cache of one server are one cause.
 */
export const mediaCacheRefresh: IssueRule<CacheParams> = {
  id: 'wardarr-media-cache',
  detect(signal) {
    if (signal.origin !== 'wardarr' || signal.kind !== 'cache') return null;
    const libs = Array.isArray(signal.data?.failedLibraries) ? signal.data.failedLibraries.length : 0;
    const staleHours = typeof signal.data?.staleHours === 'number' ? signal.data.staleHours : 0;
    return [{ key: signal.instance.id, params: { failedLibraries: libs, staleHours } }];
  },
  build(matches) {
    const instance = matches[0]!.signal.instance;
    const failedLibraries = Math.max(...matches.map((m) => m.params.failedLibraries));
    const staleHours = Math.max(...matches.map((m) => m.params.staleHours));
    const days = Math.round(staleHours / 24);
    const affected: Msg =
      failedLibraries > 0 && days > 0
        ? { key: 'issues.mediaCache.affectedBoth', params: { count: failedLibraries, days } }
        : failedLibraries > 0
          ? { key: 'issues.mediaCache.affectedLibraries', params: { count: failedLibraries } }
          : { key: 'issues.mediaCache.affectedStale', params: { days } };
    return {
      severity: 'warning',
      title: { key: 'issues.mediaCache.title', params: { instance: instance.name } },
      affected,
      explanation: { key: 'issues.mediaCache.explanation', params: { instance: instance.name } },
      fix: { key: 'issues.mediaCache.fix', params: { instance: instance.name } },
      actions: [
        {
          id: 'reload-cache',
          kind: 'reloadCache',
          class: 'safe',
          label: { key: 'issues.action.reload' },
          instanceId: instance.id,
        },
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
