// Available updates. Always info, never "needs attention".
import type { IssueRule } from '../types.js';
import { instanceNames, normalizeKey } from './helpers.js';

// *arr apps report updates through the UpdateCheck health check. Its message
// is localized, but the wiki anchor is not, so the anchor is checked first.
const UPDATE_WIKI_ANCHOR = '#new-update-is-available';

function extractVersion(message: string): string {
  const m = message.match(/v?(\d+(?:\.\d+){1,3})/);
  return m?.[1] ?? '';
}

export const updateAvailable: IssueRule<{ version: string }> = {
  id: 'update-available',
  detect(signal) {
    const isUpdate =
      signal.kind === 'update' ||
      (signal.kind === 'health' &&
        signal.source === 'UpdateCheck' &&
        (signal.wikiUrl?.endsWith(UPDATE_WIKI_ANCHOR) || /new update is available/i.test(signal.message)));
    if (!isUpdate) return null;
    const version =
      typeof signal.data?.version === 'string' ? signal.data.version : extractVersion(signal.message);
    return [
      {
        key: `${signal.instance.adapter}:${normalizeKey(version) || signal.instance.id}`,
        params: { version },
      },
    ];
  },
  build(matches, ctx) {
    const names = instanceNames(matches);
    const first = matches[0]!.signal.instance;
    const href = ctx.webUrl(first.id, { kind: 'system' });
    return {
      severity: 'info',
      title: { key: 'issues.update.title', params: { instances: names } },
      affected: { key: 'issues.common.instances', params: { instances: names } },
      explanation: matches[0]!.params.version
        ? { key: 'issues.update.explanation', params: { version: matches[0]!.params.version } }
        : { key: 'issues.update.explanationNoVersion' },
      fix: { key: 'issues.update.fix' },
      actions: href
        ? [
            {
              id: 'release-notes',
              kind: 'openLink',
              class: 'safe',
              label: { key: 'issues.action.releaseNotes' },
              href,
            },
          ]
        : [],
    };
  },
};
