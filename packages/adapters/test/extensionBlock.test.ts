// Extension blocking in SABnzbd, qBittorrent and the *arr apps, against
// invented answers shaped like the real APIs.
import { describe, expect, it } from 'vitest';
import { arrBlockStatus } from '../src/arr/base.js';
import { nextExcludedPatterns, qbitBlockStatus, qbittorrent } from '../src/downloaders/qbittorrent.js';
import { sabBlockStatus, sabList, sabnzbd } from '../src/downloaders/sabnzbd.js';
import { sonarr } from '../src/arr/sonarr.js';
import { createFixtureHttp, type FixtureRoute } from './fixtureHttp.js';

function make(def: { create: (ctx: never) => unknown }, credentials: unknown, routes: FixtureRoute[]) {
  const http = createFixtureHttp(routes);
  const adapter = def.create({
    instanceId: 'd1',
    instanceName: 'Client',
    baseUrl: 'http://client.example.test',
    credentials,
    http,
    log: { debug() {}, warn() {} },
  } as never) as Record<string, (...a: unknown[]) => Promise<unknown>>;
  return { adapter, http };
}

describe('SABnzbd', () => {
  it('reads the list in both shapes and knows when it blocks nothing', () => {
    expect(sabList(['.EXE', 'com'])).toEqual(['com', 'exe']);
    expect(sabList('exe, lnk')).toEqual(['exe', 'lnk']);
    expect(
      sabBlockStatus({ unwanted_extensions: ['exe'], action_on_unwanted_extensions: 0 }, '4.5.0'),
    ).toMatchObject({
      active: false,
      action: 'off',
    });
    expect(
      sabBlockStatus({ unwanted_extensions: ['exe'], action_on_unwanted_extensions: '2' }, null),
    ).toMatchObject({
      active: true,
      action: 'abort',
      extensions: ['exe'],
    });
  });

  it('never writes into a whitelist', () => {
    expect(
      sabBlockStatus(
        { unwanted_extensions: ['mkv'], action_on_unwanted_extensions: 2, unwanted_extensions_mode: 1 },
        null,
      ),
    ).toMatchObject({ active: false, blocker: 'whitelist', extensions: [] });
  });

  it('writes the merged list and the action through set_config', async () => {
    const misc = {
      unwanted_extensions: ['nfo', 'lnk'],
      action_on_unwanted_extensions: 0,
      unwanted_extensions_mode: 0,
    };
    const { adapter, http } = make(sabnzbd, { apiKey: 'k' }, [
      { path: '/api', query: { mode: 'get_config', section: 'misc' }, json: { config: { misc } } },
      { path: '/api', query: { mode: 'set_config' }, json: { status: true } },
      { path: '/api', query: { mode: 'version' }, json: { version: '4.5.0' } },
    ]);
    await adapter.setExtensionBlock!({ extensions: ['exe', 'scr'], remove: ['lnk'], action: 'abort' });
    const sets = http.calls
      .filter((c) => c.query?.mode === 'set_config')
      .map((c) => [c.query!.keyword, c.query!.value]);
    expect(sets).toEqual([
      ['unwanted_extensions', 'exe,nfo,scr'],
      ['action_on_unwanted_extensions', '2'],
    ]);
  });

  it('reports downloads it aborted for an unwanted extension', async () => {
    const { adapter } = make(sabnzbd, { apiKey: 'k' }, [
      {
        path: '/api',
        query: { mode: 'history', failed_only: '1' },
        json: {
          history: {
            slots: [
              {
                nzo_id: 'SABnzbd_nzo_x1',
                name: 'Invented.S01E01',
                fail_message: 'Aborted, unwanted extension detected',
                completed: 1767268800,
              },
              {
                nzo_id: 'SABnzbd_nzo_x2',
                name: 'Invented.S01E02',
                fail_message: 'Repair failed',
                completed: 1767268800,
              },
            ],
          },
        },
      },
    ]);
    const list = (await adapter.blockedDownloads!('2026-01-01T00:00:00Z')) as Array<{ downloadId: string }>;
    expect(list.map((b) => b.downloadId)).toEqual(['SABnzbd_nzo_x1']);
  });
});

describe('qBittorrent', () => {
  const login: FixtureRoute = {
    method: 'POST',
    path: '/api/v2/auth/login',
    text: 'Ok.',
    responseHeaders: { 'set-cookie': 'SID=s; path=/' },
  };

  it('reads excluded file names and keeps patterns that are not extensions', () => {
    const prefs = { excluded_file_names_enabled: true, excluded_file_names: '*.exe\nsample*\n*.LNK' };
    expect(qbitBlockStatus(prefs, '5.1.0')).toMatchObject({ active: true, extensions: ['exe', 'lnk'] });
    expect(qbitBlockStatus({}, '4.5.0')).toMatchObject({ blocker: 'tooOld', active: false });
    expect(nextExcludedPatterns(['*.exe', 'sample*', '*.lnk'], ['lnk'], ['scr'])).toEqual([
      'sample*',
      '*.exe',
      '*.scr',
    ]);
  });

  it('switches the option on and writes one pattern per line', async () => {
    const { adapter, http } = make(qbittorrent, { username: 'u', password: 'p' }, [
      login,
      {
        path: '/api/v2/app/preferences',
        json: { excluded_file_names_enabled: false, excluded_file_names: 'sample*' },
      },
      { method: 'POST', path: '/api/v2/app/setPreferences', text: '' },
      { path: '/api/v2/app/version', text: 'v5.1.0' },
    ]);
    await adapter.setExtensionBlock!({ extensions: ['exe'], remove: [] });
    const write = http.calls.find((c) => c.path === '/api/v2/app/setPreferences');
    expect(JSON.parse(write!.form!.json!)).toEqual({
      excluded_file_names_enabled: true,
      excluded_file_names: 'sample*\n*.exe',
    });
  });

  it('finds new torrents whose blocked files were left out', async () => {
    const { adapter } = make(qbittorrent, { username: 'u', password: 'p' }, [
      login,
      {
        path: '/api/v2/app/preferences',
        json: { excluded_file_names_enabled: true, excluded_file_names: '*.exe' },
      },
      {
        path: '/api/v2/torrents/info',
        json: [
          { hash: 'aaa', name: 'Invented.S01E01', added_on: 1767268800 },
          { hash: 'bbb', name: 'Invented.S01E02', added_on: 1767268800 },
        ],
      },
      {
        path: '/api/v2/torrents/files',
        query: { hash: 'aaa' },
        json: [
          { name: 'x/Setup.exe', priority: 0 },
          { name: 'x/v.mkv', priority: 1 },
        ],
      },
      { path: '/api/v2/torrents/files', query: { hash: 'bbb' }, json: [{ name: 'y/v.mkv', priority: 1 }] },
    ]);
    const list = (await adapter.blockedDownloads!('2026-01-01T00:00:00Z')) as Array<{
      downloadId: string;
      extensions: string[];
    }>;
    expect(list).toEqual([
      expect.objectContaining({ downloadId: 'aaa', extensions: ['exe'], outcome: 'skipped' }),
    ]);
  });
});

describe('*arr apps', () => {
  const ix = (id: number, fail: number[] | null) => ({
    id,
    fields: fail === null ? [{ name: 'baseUrl', value: 'x' }] : [{ name: 'failDownloads', value: fail }],
  });

  it('counts a group only when every indexer with the option fails it', () => {
    const s = arrBlockStatus([ix(1, [0, 1]), ix(2, [0]), ix(3, null)], null, '4.0.15');
    expect(s).toMatchObject({ style: 'groups', active: true, indexers: { covered: 2, total: 2 } });
    expect(s.extensions).toEqual(['bat', 'cmd', 'exe', 'sh']);
    expect(s.possible).toContain('lnk');
  });

  it('cannot help without indexers that have the option', () => {
    expect(arrBlockStatus([ix(1, null)], null, '3.0.10')).toMatchObject({
      blocker: 'noIndexers',
      active: false,
    });
  });

  it('adds the user list of Sonarr v5 when its flag is on', () => {
    const s = arrBlockStatus([ix(1, [0, 1, 2])], ['iso'], '5.0.0');
    expect(s.style).toBe('list');
    expect(s.extensions).toContain('iso');
    expect(s.possible).toBeUndefined();
  });

  it('switches the groups on in every indexer that has the option and keeps the rest', async () => {
    const H = { 'X-Api-Key': 'k' };
    const indexers = [
      {
        id: 7,
        name: 'Lantern',
        fields: [
          { name: 'apiKey', value: '********' },
          { name: 'failDownloads', value: [] },
        ],
      },
      { id: 8, name: 'Nightjar', fields: [{ name: 'failDownloads', value: [0, 1] }] },
      { id: 9, name: 'Rss', fields: [{ name: 'baseUrl', value: 'x' }] },
    ];
    const { adapter, http } = make(sonarr, { apiKey: 'k' }, [
      { path: '/api', headers: H, json: { current: 'v3', deprecated: [] } },
      { path: '/api/v3/system/status', headers: H, json: { appName: 'Sonarr', version: '4.0.15.2941' } },
      { path: '/api/v3/indexer', headers: H, json: indexers },
      { path: '/api/v3/config/mediamanagement', headers: H, json: { id: 1, recycleBin: '' } },
      { method: 'PUT', path: '/api/v3/indexer/7', headers: H, query: { forceSave: 'true' }, json: {} },
    ]);
    await adapter.setExtensionBlock!({ extensions: ['exe', 'lnk', 'iso'], remove: [] });
    const puts = http.calls.filter((c) => c.method === 'PUT');
    expect(puts.map((c) => c.path)).toEqual(['/api/v3/indexer/7']);
    const body = puts[0]!.json as { fields: Array<{ name: string; value: unknown }> };
    expect(body.fields).toEqual([
      { name: 'apiKey', value: '********' },
      { name: 'failDownloads', value: [0, 1] },
    ]);
  });
});
