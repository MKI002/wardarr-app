// Acceptance test of stage 1: the example from the Issue Center
// specification yields exactly the expected groups.
import { describe, expect, it } from 'vitest';
import { RULE_CATALOG, groupSignals, needsAttention, type RuleContext, type Signal } from '../src/index.js';
import example from './fixtures/issue-center-example.json' with { type: 'json' };
import { t } from './render.js';

const ctx: RuleContext = {
  webUrl: (instanceId, target) =>
    `https://${instanceId}.example.test/${target?.kind ?? ''}/${target?.id ?? ''}`,
  findIndexer: (name) =>
    name === 'ExampleIndexer' ? { instanceId: 'inst-prowlarr', indexerId: 7 } : undefined,
};

const groups = groupSignals(example.signals as Signal[], RULE_CATALOG, ctx);

function row(fingerprintPrefix: string) {
  const g = groups.find((x) => x.fingerprint.startsWith(fingerprintPrefix));
  if (!g) throw new Error(`group ${fingerprintPrefix} missing`);
  return {
    title: t(g.title),
    severity: g.severity,
    affected: t(g.affected),
    fix: t(g.fix),
    actions: g.actions.map((a) => t(a.label)),
    origin: g.origin,
  };
}

describe('Issue Center example', () => {
  it('produces exactly four groups', () => {
    expect(groups).toHaveLength(4);
  });

  it('groups the indexer failure of three apps into one cause', () => {
    expect(row('indexer-unavailable:')).toEqual({
      title: 'ExampleIndexer unreachable for more than 6 hours',
      severity: 'warning',
      affected: 'Sonarr, Radarr, Radarr 4K',
      fix: "Test the indexer in Prowlarr and check the provider's status",
      actions: ['Test indexer', 'Open in Prowlarr', 'Recheck', 'Mute'],
      origin: 'service',
    });
  });

  it('merges both Jellyfin cache messages into one Wardarr issue', () => {
    expect(row('wardarr-media-cache:')).toEqual({
      title: 'Wardarr cannot refresh the Jellyfin cache',
      severity: 'warning',
      affected: '2 libraries, cache stale for 21 days',
      fix: 'Check the reachability and response time of Jellyfin, then reload',
      actions: ['Reload', 'Open settings', 'Recheck', 'Mute'],
      origin: 'wardarr',
    });
  });

  it('summarizes the failed Lidarr downloads', () => {
    expect(row('downloads-failed:')).toEqual({
      title: '3 downloads failed in Lidarr',
      severity: 'warning',
      affected: '3 albums',
      fix: 'The Queue Cleaner takes care of this, or you act now',
      actions: ['Go to queue', 'Recheck', 'Mute'],
      origin: 'service',
    });
  });

  it('reports the Lidarr update as info outside "needs attention"', () => {
    expect(row('update-available:')).toEqual({
      title: 'Update available for Lidarr',
      severity: 'info',
      affected: 'Lidarr',
      fix: 'Install the update when it suits you',
      actions: ['Open release notes', 'Recheck', 'Mute'],
      origin: 'service',
    });
    expect(needsAttention(groups).map((g) => g.ruleId)).not.toContain('update-available');
  });

  it('keeps original texts and check names in the details, not in titles', () => {
    const indexer = groups.find((g) => g.ruleId === 'indexer-unavailable')!;
    expect(indexer.details).toHaveLength(3);
    expect(indexer.details[0]!.source).toBe('IndexerLongTermStatusCheck');
    expect(indexer.details[0]!.message).toContain('Indexers unavailable due to failures');
    const cache = groups.find((g) => g.ruleId === 'wardarr-media-cache')!;
    expect(t(cache.title)).not.toMatch(/alice|bob/);
    expect(cache.details.map((d) => d.message).join(' ')).toContain('alice');
  });

  it('uses stable fingerprints independent of instance order', () => {
    const reversed = groupSignals([...(example.signals as Signal[])].reverse(), RULE_CATALOG, ctx);
    expect(reversed.map((g) => g.fingerprint).sort()).toEqual(groups.map((g) => g.fingerprint).sort());
  });
});
