// Download client failures reported by *arr apps.
import type { IssueRule, RuleOutput } from '../types.js';
import { instanceNames, listAfterColon, normalizeKey } from './helpers.js';

/** One group per failing download client name, across apps. */
export const downloadClientUnavailable: IssueRule<{ client: string }> = {
  id: 'download-client-unavailable',
  detect(signal) {
    if (signal.kind !== 'health') return null;
    if (signal.source === 'DownloadClientStatusCheck') {
      const names = listAfterColon(signal.message);
      if (names.length === 0) return [{ key: `all:${signal.instance.id}`, params: { client: '' } }];
      return names.map((client) => ({ key: normalizeKey(client), params: { client } }));
    }
    if (signal.source === 'DownloadClientCheck') {
      // "Unable to communicate with <name>. <error>" or "No download client is available"
      const m = signal.message.match(/^[^.]*?\b(?:with|mit|avec|con)\s+(.+?)\.\s/i);
      if (m?.[1]) return [{ key: normalizeKey(m[1]), params: { client: m[1] } }];
      return [{ key: `none:${signal.instance.id}`, params: { client: '' } }];
    }
    return null;
  },
  build(matches): RuleOutput {
    const client = matches.find((m) => m.params.client)?.params.client ?? '';
    const instances = instanceNames(matches);
    if (!client) {
      return {
        severity: 'critical',
        title: { key: 'issues.downloadClient.titleNone', params: { instance: instances } },
        affected: { key: 'issues.common.instances', params: { instances } },
        explanation: { key: 'issues.downloadClient.explanationNone' },
        fix: { key: 'issues.downloadClient.fixNone' },
        actions: [],
      };
    }
    return {
      severity: 'critical',
      title: { key: 'issues.downloadClient.title', params: { client } },
      affected: { key: 'issues.common.instances', params: { instances } },
      explanation: { key: 'issues.downloadClient.explanation', params: { client } },
      fix: { key: 'issues.downloadClient.fix', params: { client } },
      actions: [],
    };
  },
};
