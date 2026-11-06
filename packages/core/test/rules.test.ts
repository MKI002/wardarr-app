import { describe, expect, it } from 'vitest';
import { RULE_CATALOG, groupSignals, type Signal } from '../src/index.js';
import { t } from './render.js';

const sonarr = { id: 's1', name: 'Sonarr', adapter: 'sonarr' };
const sonarr4k = { id: 's2', name: 'Sonarr 4K', adapter: 'sonarr' };

function health(
  instance: typeof sonarr,
  source: string,
  message: string,
  extra: Partial<Signal> = {},
): Signal {
  return { origin: 'service', instance, kind: 'health', source, level: 'warning', message, ...extra };
}

describe('catalog rules', () => {
  it('splits a message naming several indexers into one group per indexer', () => {
    const groups = groupSignals(
      [
        health(
          sonarr,
          'IndexerStatusCheck',
          'Indexers unavailable due to failures: Alpha (Prowlarr), Beta (Prowlarr)',
        ),
      ],
      RULE_CATALOG,
    );
    expect(groups.map((g) => g.fingerprint).sort()).toEqual([
      'indexer-unavailable:alpha',
      'indexer-unavailable:beta',
    ]);
  });

  it('detects localized messages through the check name', () => {
    const groups = groupSignals(
      [
        health(
          sonarr,
          'IndexerLongTermStatusCheck',
          'Indexer seit mehr als 6 Stunden nicht verfügbar: Alpha (Prowlarr)',
        ),
      ],
      RULE_CATALOG,
    );
    expect(groups[0]!.fingerprint).toBe('indexer-unavailable:alpha');
  });

  it('treats "all indexers" as a critical problem of the app', () => {
    const [g] = groupSignals(
      [health(sonarr, 'IndexerStatusCheck', 'All indexers are unavailable due to failures')],
      RULE_CATALOG,
    );
    expect(g!.ruleId).toBe('all-indexers-unavailable');
    expect(g!.severity).toBe('critical');
  });

  it('groups a failing download client across apps', () => {
    const groups = groupSignals(
      [
        health(
          sonarr,
          'DownloadClientStatusCheck',
          'Download clients unavailable due to failures: ExampleClient',
        ),
        health(
          sonarr4k,
          'DownloadClientCheck',
          'Unable to communicate with ExampleClient. Connection refused',
        ),
      ],
      RULE_CATALOG,
    );
    expect(groups).toHaveLength(1);
    expect(t(groups[0]!.affected)).toBe('Sonarr, Sonarr 4K');
  });

  it('puts unknown messages into their own group with the original text', () => {
    const msg = 'Something entirely new happened';
    const [g] = groupSignals(
      [health(sonarr, 'BrandNewCheck', msg, { wikiUrl: 'https://wiki.example.test/x' })],
      RULE_CATALOG,
      { webUrl: () => 'https://sonarr.example.test/system/status', findIndexer: () => undefined },
    );
    expect(g!.ruleId).toBe('unknown');
    expect(g!.details[0]!.message).toBe(msg);
    expect(g!.actions.map((a) => a.id)).toEqual(['open-instance', 'open-wiki', 'recheck', 'mute']);
  });

  it('groups the same unknown message across instances of one service type', () => {
    const groups = groupSignals(
      [
        health(sonarr, 'BrandNewCheck', 'Value 12 is odd'),
        health(sonarr4k, 'BrandNewCheck', 'Value 13 is odd'),
      ],
      RULE_CATALOG,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.instances).toHaveLength(2);
  });

  it('marks updates as info even when the app reports a warning', () => {
    const [g] = groupSignals(
      [
        health(sonarr, 'UpdateCheck', 'Neues Update verfügbar: v9.9.9', {
          wikiUrl: 'https://wiki.example.test/sonarr#new-update-is-available',
        }),
      ],
      RULE_CATALOG,
    );
    expect(g!.ruleId).toBe('update-available');
    expect(g!.severity).toBe('info');
  });

  it('does not treat other UpdateCheck messages as updates', () => {
    const [g] = groupSignals(
      [
        health(sonarr, 'UpdateCheck', 'Cannot install update because startup folder is not writable', {
          wikiUrl: 'https://wiki.example.test/sonarr#cannot-install-update',
        }),
      ],
      RULE_CATALOG,
    );
    expect(g!.ruleId).toBe('unknown');
  });

  it('counts a season pack once in failed downloads', () => {
    const failed = (title: string): Signal => ({
      origin: 'service',
      instance: sonarr,
      kind: 'queueItem',
      level: 'warning',
      message: title,
      data: { state: 'failed', title, mediaKind: 'episode', downloadId: 'PACK1' },
    });
    const [g] = groupSignals([failed('Example Show S01E01'), failed('Example Show S01E02')], RULE_CATALOG);
    expect(t(g!.title)).toBe('1 download failed in Sonarr');
  });

  it('every rule output has translations', () => {
    const signals: Signal[] = [
      health(sonarr, 'RootFolderCheck', 'Missing root folder: /media/example'),
      health(sonarr, 'RemotePathMappingCheck', 'Remote download client places downloads in /downloads'),
      health(sonarr, 'IndexerRssCheck', 'No indexers available with RSS sync enabled'),
      health(sonarr, 'IndexerSearchCheck', 'No indexers available with Automatic Search enabled'),
      {
        origin: 'service',
        instance: sonarr4k,
        kind: 'connection',
        level: 'error',
        message: 'timeout',
        data: { errorKind: 'timeout' },
      },
      {
        origin: 'service',
        instance: { id: 'r', name: 'Radarr', adapter: 'radarr' },
        kind: 'connection',
        level: 'error',
        message: '401',
        data: { errorKind: 'unauthorized' },
      },
    ];
    for (const g of groupSignals(signals, RULE_CATALOG)) {
      for (const m of [g.title, g.affected, g.explanation, g.fix, ...g.actions.map((a) => a.label)]) {
        expect(() => t(m)).not.toThrow();
      }
      for (const a of g.actions) for (const s of a.steps ?? []) expect(() => t(s)).not.toThrow();
    }
  });
});
