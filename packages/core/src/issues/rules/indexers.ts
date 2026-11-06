// Indexer failures reported by *arr apps and Prowlarr.
import type { IssueAction, IssueRule } from '../types.js';
import {
  instanceNames,
  listAfterColon,
  normalizeKey,
  stripIndexerSuffix,
  uniqueInstances,
} from './helpers.js';

const INDEXER_STATUS_SOURCES = new Set(['IndexerStatusCheck', 'IndexerLongTermStatusCheck']);

interface IndexerParams {
  indexer: string;
  longTerm: boolean;
}

function isAllIndexersMessage(message: string): boolean {
  return listAfterColon(message).length === 0;
}

/** One group per failing indexer, across all apps that use it. */
export const indexerUnavailable: IssueRule<IndexerParams> = {
  id: 'indexer-unavailable',
  detect(signal) {
    if (signal.kind !== 'health' || !signal.source || !INDEXER_STATUS_SOURCES.has(signal.source)) return null;
    if (isAllIndexersMessage(signal.message)) return null;
    const longTerm = signal.source === 'IndexerLongTermStatusCheck';
    return listAfterColon(signal.message).map((raw) => {
      const indexer = stripIndexerSuffix(raw);
      return { key: normalizeKey(indexer), params: { indexer, longTerm } };
    });
  },
  build(matches, ctx) {
    const indexer = matches[0]!.params.indexer;
    const longTerm = matches.some((m) => m.params.longTerm);
    const instances = uniqueInstances(matches);
    const actions: IssueAction[] = [];
    const found = ctx.findIndexer(indexer);
    if (found) {
      actions.push({
        id: 'test-indexer',
        kind: 'testIndexer',
        class: 'safe',
        label: { key: 'issues.action.testIndexer' },
        instanceId: found.instanceId,
        payload: { indexerId: found.indexerId },
      });
      const href = ctx.webUrl(found.instanceId, { kind: 'indexer', id: found.indexerId });
      if (href) {
        actions.push({
          id: 'open-prowlarr',
          kind: 'openLink',
          class: 'safe',
          label: { key: 'issues.action.openInProwlarr' },
          href,
        });
      }
    }
    return {
      severity: 'warning',
      title: {
        key: longTerm ? 'issues.indexerUnavailable.titleLongTerm' : 'issues.indexerUnavailable.title',
        params: { indexer },
      },
      affected: { key: 'issues.common.instances', params: { instances: instanceNames(matches) } },
      explanation: {
        key: 'issues.indexerUnavailable.explanation',
        params: { indexer, count: instances.length },
      },
      fix: { key: 'issues.indexerUnavailable.fix' },
      actions,
    };
  },
};

/** "All indexers are unavailable" points at the app, not a single indexer. */
export const allIndexersUnavailable: IssueRule<{ longTerm: boolean }> = {
  id: 'all-indexers-unavailable',
  detect(signal) {
    if (signal.kind !== 'health' || !signal.source || !INDEXER_STATUS_SOURCES.has(signal.source)) return null;
    if (!isAllIndexersMessage(signal.message)) return null;
    return [
      { key: signal.instance.id, params: { longTerm: signal.source === 'IndexerLongTermStatusCheck' } },
    ];
  },
  build(matches, ctx) {
    const instance = matches[0]!.signal.instance;
    const href = ctx.webUrl(instance.id, { kind: 'indexer' });
    return {
      severity: 'critical',
      title: { key: 'issues.allIndexersUnavailable.title', params: { instance: instance.name } },
      affected: { key: 'issues.common.instances', params: { instances: instance.name } },
      explanation: { key: 'issues.allIndexersUnavailable.explanation', params: { instance: instance.name } },
      fix: { key: 'issues.allIndexersUnavailable.fix', params: { instance: instance.name } },
      actions: href
        ? [
            {
              id: 'open-indexers',
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

const SEARCH_SOURCES = new Set(['IndexerRssCheck', 'IndexerSearchCheck']);

/** No indexer enabled for RSS or search, or all temporarily failing. */
export const indexerSearchUnavailable: IssueRule<{ source: string }> = {
  id: 'indexer-search-unavailable',
  detect(signal) {
    if (signal.kind !== 'health' || !signal.source || !SEARCH_SOURCES.has(signal.source)) return null;
    return [{ key: `${signal.instance.id}:${signal.source}`, params: { source: signal.source } }];
  },
  build(matches, ctx) {
    const instance = matches[0]!.signal.instance;
    const rss = matches[0]!.params.source === 'IndexerRssCheck';
    const href = ctx.webUrl(instance.id, { kind: 'indexer' });
    return {
      severity: 'warning',
      title: {
        key: rss ? 'issues.indexerSearch.titleRss' : 'issues.indexerSearch.titleSearch',
        params: { instance: instance.name },
      },
      affected: { key: 'issues.common.instances', params: { instances: instance.name } },
      explanation: {
        key: rss ? 'issues.indexerSearch.explanationRss' : 'issues.indexerSearch.explanationSearch',
      },
      fix: { key: 'issues.indexerSearch.fix', params: { instance: instance.name } },
      actions: href
        ? [
            {
              id: 'open-indexers',
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
