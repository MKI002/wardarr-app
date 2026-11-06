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

describe('download client rules', () => {
  const qbit = { id: 'q1', name: 'qBittorrent', adapter: 'qbittorrent' };
  const tr = { id: 't1', name: 'Transmission', adapter: 'transmission' };
  const sab = { id: 'n1', name: 'SABnzbd', adapter: 'sabnzbd' };

  function dl(
    instance: typeof qbit,
    source: string,
    level: Signal['level'],
    data?: Record<string, unknown>,
  ): Signal {
    return { origin: 'service', instance, kind: 'health', source, level, message: source, data };
  }

  it('turns a disconnected client into a critical issue and a closed port into a warning', () => {
    const groups = groupSignals(
      [
        dl(qbit, 'Downloader.connection', 'error', { status: 'disconnected' }),
        dl({ ...qbit, id: 'q2', name: 'qBittorrent 2' }, 'Downloader.connection', 'warning', {
          status: 'firewalled',
        }),
      ],
      RULE_CATALOG,
    );
    const byRule = Object.fromEntries(groups.map((g) => [g.ruleId, g]));
    expect(byRule['downloader-offline']!.severity).toBe('critical');
    expect(t(byRule['downloader-offline']!.title)).toBe('qBittorrent has no network connection');
    expect(byRule['downloader-port-closed']!.severity).toBe('warning');
    expect(t(byRule['downloader-port-closed']!.title)).toBe('Incoming port of qBittorrent 2 is closed');
  });

  it('collects tracker errors of one client into one issue with one item per torrent', () => {
    const groups = groupSignals(
      [
        dl(tr, 'Downloader.trackerError', 'warning', {
          name: 'Example.Show.S01E01',
          reason: 'Unregistered torrent',
        }),
        dl(tr, 'Downloader.trackerError', 'warning', { name: 'Sample.Movie.2021', reason: 'timed out' }),
      ],
      RULE_CATALOG,
    );
    expect(groups).toHaveLength(1);
    const g = groups[0]!;
    expect(g.fingerprint).toBe('tracker-errors:t1');
    expect(t(g.title)).toBe('2 torrents in Transmission have tracker errors');
    expect(t(g.affected)).toBe('2 torrents');
    expect(g.explanation.key).toBe('issues.trackerErrors.explanationUnregistered');
    expect(g.items.map((i) => i.label)).toEqual(['Example.Show.S01E01', 'Sample.Movie.2021']);
    expect(t(g.items[0]!.info!)).toBe('Unregistered torrent');
  });

  it('keeps a paused client calm and flags a used-up quota', () => {
    const groups = groupSignals(
      [
        dl(sab, 'Downloader.paused', 'info'),
        dl({ id: 'z1', name: 'NZBGet', adapter: 'nzbget' }, 'Downloader.quota', 'warning'),
      ],
      RULE_CATALOG,
    );
    const byRule = Object.fromEntries(groups.map((g) => [g.ruleId, g]));
    expect(byRule['downloader-paused']!.severity).toBe('info');
    expect(t(byRule['downloader-paused']!.title)).toBe('Downloads in SABnzbd are paused');
    expect(byRule['downloader-quota']!.severity).toBe('warning');
  });

  it('every download client rule has translations', () => {
    const signals = [
      dl(qbit, 'Downloader.connection', 'error', { status: 'disconnected' }),
      dl(tr, 'Downloader.connection', 'warning', { status: 'firewalled' }),
      dl(tr, 'Downloader.trackerError', 'warning', { name: 'A', reason: 'x' }),
      dl(sab, 'Downloader.paused', 'info'),
      dl(sab, 'Downloader.quota', 'warning'),
    ];
    for (const g of groupSignals(signals, RULE_CATALOG)) {
      expect(g.ruleId).not.toBe('unknown');
      for (const m of [g.title, g.affected, g.explanation, g.fix, ...g.actions.map((a) => a.label)])
        expect(() => t(m)).not.toThrow();
    }
  });
});
