// Issue rules of the Queue Cleaner and the API compatibility notice.
import { describe, expect, it } from 'vitest';
import {
  RULE_CATALOG,
  cleanerSignals,
  groupSignals,
  orphanSignals,
  type CleanerPlan,
  type Signal,
} from '../src/index.js';
import { t } from './render.js';

const radarr = { id: 'r1', name: 'Radarr', adapter: 'radarr' };
const client = { id: 'q1', name: 'qBittorrent', adapter: 'qbittorrent' };

const plan = (over: Partial<CleanerPlan>): CleanerPlan => ({
  paused: null,
  downloads: [],
  nextState: [],
  nextAttempts: [],
  exhausted: [],
  removals: 0,
  ...over,
});

function renderAll(signals: Signal[]) {
  return groupSignals(signals, RULE_CATALOG).map((g) => ({
    g,
    text: [g.title, g.affected, g.explanation, g.fix, ...g.actions.map((a) => a.label)].map(t),
  }));
}

describe('cleaner issue rules', () => {
  it('raises a critical issue when the cleaner pauses', () => {
    const [r] = renderAll(
      cleanerSignals(plan({ paused: { kind: 'diskFull', message: 'Not enough free space' } }), radarr),
    );
    expect(r!.g).toMatchObject({
      ruleId: 'cleaner-paused',
      severity: 'critical',
      sources: ['service:r1:cleaner'],
    });
    expect(r!.text[0]).toBe('Queue Cleaner paused for Radarr');
  });

  it('offers "Review import" for importable downloads', () => {
    const d = {
      key: 'abc',
      title: 'Example.Movie.2020',
      downloadId: 'ABC',
      queueIds: [1],
      matched: true,
      state: 'importBlocked' as const,
      rule: 'importReady' as const,
      strikes: 0,
      maxStrikes: 4,
      nextStrikeAt: null,
      waitUntil: '2026-01-08T00:00:00.000Z',
      action: { type: 'none' as const },
      reason: { key: 'cleaner.reason.importReady' },
      messages: [],
      importHint: null,
    };
    const [r] = renderAll(cleanerSignals(plan({ downloads: [d] }), radarr));
    expect(r!.g.ruleId).toBe('cleaner-import-ready');
    expect(r!.g.actions[0]).toMatchObject({ id: 'review-import', href: '/cleaner?instance=r1&review=abc' });
    expect(r!.text[0]).toBe('1 download in Radarr is ready to import');
  });

  it('reports titles without attempts left and orphaned downloads', () => {
    const signals = [
      ...cleanerSignals(
        plan({
          exhausted: [{ titleKey: 'movie:1', title: 'Example Movie', attempts: 3, lastAttemptAt: null }],
        }),
        radarr,
      ),
      ...orphanSignals(
        [
          {
            id: 'h1',
            name: 'Unknown.Thing',
            state: 'downloading',
            progress: 0,
            sizeBytes: 1,
            downloadedBytes: 0,
            speedBytesPerSecond: 0,
            etaSeconds: null,
            category: null,
            addedAt: null,
          },
        ],
        client,
      ),
    ];
    const rendered = renderAll(signals);
    expect(rendered.map((r) => r.g.ruleId).sort()).toEqual([
      'cleaner-attempts-exhausted',
      'cleaner-orphaned-downloads',
    ]);
    const orphan = rendered.find((r) => r.g.ruleId === 'cleaner-orphaned-downloads')!;
    // Deleting needs a confirmation in the Queue Cleaner; the issue only links there.
    expect(orphan.g.actions.some((a) => a.class === 'risky')).toBe(false);
    expect(orphan.g.actions[0]).toMatchObject({
      kind: 'openWardarr',
      href: '/cleaner?tab=orphans&client=q1',
    });
  });

  it('notes an instance in API compatibility mode', () => {
    const [r] = renderAll([
      {
        origin: 'wardarr',
        instance: { id: 's1', name: 'Sonarr', adapter: 'sonarr' },
        kind: 'health',
        source: 'Wardarr.apiCompatibility',
        level: 'info',
        message: 'Sonarr 5.0.0 uses API v3 in compatibility mode',
        data: { product: 'Sonarr', productVersion: '5.0.0', api: 'v3', reason: 'both', newestOffered: 'v5' },
      },
    ]);
    expect(r!.g).toMatchObject({ ruleId: 'wardarr-api-compatibility', origin: 'wardarr', severity: 'info' });
    expect(r!.text[2]).toContain('offers API v5');
  });
});
