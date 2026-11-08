import { describe, expect, it } from 'vitest';
import {
  arrGroupsFor,
  buildFlow,
  cleanScore,
  compareList,
  DEFAULT_EXTENSIONS,
  extensionOf,
  indexerScore,
  parseBlockMessage,
  parseExtensionList,
  patternExtension,
  planList,
  primaryExtension,
  wildcardToRegExp,
} from '../src/index.js';

describe('extensions', () => {
  it('normalises what people type', () => {
    expect(parseExtensionList('.EXE, lnk;  *.scr\nexe bad/name')).toEqual(['exe', 'lnk', 'scr']);
    expect(DEFAULT_EXTENSIONS).toContain('exe');
    expect(DEFAULT_EXTENSIONS).not.toContain('iso');
  });

  it('reads the extension of a file inside a download', () => {
    expect(extensionOf('Show/Season 1/setup.EXE')).toBe('exe');
    expect(extensionOf('Show\\readme')).toBeNull();
    expect(extensionOf('.hidden')).toBeNull();
  });

  it('matches qBittorrent wildcard patterns', () => {
    expect(wildcardToRegExp('*.exe').test('Setup.EXE')).toBe(true);
    expect(wildcardToRegExp('*.exe').test('movie.mkv')).toBe(false);
    expect(wildcardToRegExp('sample?.mkv').test('sample1.mkv')).toBe(true);
    expect(patternExtension('*.lnk')).toBe('lnk');
    expect(patternExtension('sample*')).toBeNull();
  });

  it('maps a list to the fixed groups of Sonarr and Radarr', () => {
    expect(arrGroupsFor(['exe', 'iso'])).toEqual(['executables']);
    expect(arrGroupsFor(['lnk', 'bat'])).toEqual(['executables', 'dangerous']);
    expect(arrGroupsFor(['iso'])).toEqual([]);
  });

  it('reads blocked file messages of Sonarr, Radarr and SABnzbd', () => {
    expect(parseBlockMessage("Caution: Found executable file with extension: '.exe'")).toEqual({
      reason: 'executable',
      extensions: ['exe'],
    });
    expect(parseBlockMessage('Caution: Found potentially dangerous file with extension: .lnk')).toEqual({
      reason: 'dangerous',
      extensions: ['lnk'],
    });
    expect(parseBlockMessage('Aborted, unwanted extension detected')).toEqual({
      reason: 'unwanted',
      extensions: [],
    });
    expect(parseBlockMessage('Caution: Found executable file')).toEqual({
      reason: 'executable',
      extensions: [],
    });
    expect(parseBlockMessage('No files found are eligible for import')).toBeNull();
  });
});

describe('planList', () => {
  it('adds what is wanted and keeps what a person added by hand', () => {
    const p = planList(['nfo', 'exe'], [], ['exe', 'lnk']);
    expect(p.next).toEqual(['exe', 'lnk', 'nfo']);
    expect(p.added).toEqual(['lnk']);
    // exe was there before Wardarr, so it stays the person's.
    expect(p.managed).toEqual(['lnk']);
  });

  it('takes back only its own entries', () => {
    const p = planList(['nfo', 'exe', 'lnk'], ['lnk'], ['exe']);
    expect(p.removed).toEqual(['lnk']);
    expect(p.next).toEqual(['exe', 'nfo']);
    expect(p.managed).toEqual([]);
  });

  it('compares a service list with the wanted one', () => {
    expect(compareList(['exe'], ['exe', 'lnk'], { active: true }).sync).toBe('drift');
    expect(compareList(['exe', 'lnk'], ['exe', 'lnk'], { active: false }).sync).toBe('off');
    expect(compareList(['exe'], ['exe', 'iso'], { active: true, possible: ['exe', 'lnk'] })).toEqual({
      sync: 'partial',
      missing: [],
      unreachable: ['iso'],
    });
  });
});

describe('analysis', () => {
  it('files a catch under its most telling extension', () => {
    expect(primaryExtension(['nfo', 'exe'])).toBe('exe');
    expect(primaryExtension([])).toBe('?');
  });

  it('builds the flow from indexers to extensions and folds small ones', () => {
    const catches = [
      { indexerKey: 'a', indexerName: 'Lantern', extensions: ['exe'] },
      { indexerKey: 'a', indexerName: 'Lantern', extensions: ['exe'] },
      { indexerKey: 'b', indexerName: 'Nightjar', extensions: ['lnk'] },
      { indexerKey: null, indexerName: null, extensions: [] },
    ];
    const grabs = new Map([
      ['a', { name: 'Lantern', grabs: 20 }],
      ['b', { name: 'Nightjar', grabs: 10 }],
    ]);
    const flow = buildFlow(catches, grabs, { maxIndexers: 2 });
    expect(flow.total).toBe(4);
    expect(flow.indexers.map((i) => [i.key, i.caught])).toEqual([
      ['a', 2],
      ['*', 2],
    ]);
    expect(flow.indexers[0]!.rate).toBe(0.1);
    expect(flow.links.find((l) => l.from === 'a')).toEqual({ from: 'a', to: 'exe', count: 2 });
    expect(flow.links.reduce((s, l) => s + l.count, 0)).toBe(4);
  });

  it('lowers the score of an indexer that sends blocked files', () => {
    expect(cleanScore(0, 50)).toBe(1);
    expect(cleanScore(5, 50)).toBeCloseTo(0.5);
    expect(cleanScore(1, 2)).toBeNull();
    const base = { successRate: 1, averageResponseMs: 300, uptime: 1, importRate: 1 };
    expect(indexerScore(base)).toBe(100);
    expect(indexerScore({ ...base, cleanScore: 0 })).toBe(87);
    expect(indexerScore({ ...base, cleanScore: null })).toBe(100);
  });
});
