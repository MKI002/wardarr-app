// Health checks of download clients against invented data.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deluge, trackerError } from '../src/downloaders/deluge.js';
import { PORT_CLOSED_GRACE_MS } from '../src/downloaders/health.js';
import { nzbget } from '../src/downloaders/nzbget.js';
import { qbittorrent } from '../src/downloaders/qbittorrent.js';
import { sabnzbd } from '../src/downloaders/sabnzbd.js';
import { transmission } from '../src/downloaders/transmission.js';
import { createFixtureHttp, type FixtureRoute } from './fixtureHttp.js';

interface Health {
  health(): Promise<Array<{ source?: string; level: string; data?: Record<string, unknown> }>>;
}

function make<C>(def: { create: (ctx: never) => unknown }, credentials: C, routes: FixtureRoute[]) {
  const http = createFixtureHttp(routes);
  const adapter = def.create({
    instanceId: 'd1',
    instanceName: 'Client',
    baseUrl: 'http://client.example.test',
    credentials,
    http,
    log: { debug() {}, warn() {} },
  } as never) as Health;
  return { adapter, http };
}

const brief = (signals: Awaited<ReturnType<Health['health']>>) =>
  signals.map((s) => ({ source: s.source, level: s.level, status: s.data?.status }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('qBittorrent health', () => {
  function client(status: string, active: unknown[] = [{ hash: 'a' }]) {
    return make(qbittorrent, { username: 'u', password: 'p' }, [
      {
        method: 'POST',
        path: '/api/v2/auth/login',
        text: 'Ok.',
        responseHeaders: { 'set-cookie': 'SID=s; path=/' },
      },
      { path: '/api/v2/transfer/info', json: { connection_status: status } },
      { path: '/api/v2/torrents/info', query: { filter: 'active', limit: '1' }, json: active },
    ]);
  }

  it('reports a disconnected client at once', async () => {
    const { adapter } = client('disconnected');
    expect(brief(await adapter.health())).toEqual([
      { source: 'Downloader.connection', level: 'error', status: 'disconnected' },
    ]);
  });

  it('stays quiet while connected', async () => {
    const { adapter } = client('connected');
    expect(await adapter.health()).toEqual([]);
  });

  it('reports a closed port only after the grace period and with active torrents', async () => {
    const { adapter } = client('firewalled');
    expect(await adapter.health()).toEqual([]);
    vi.setSystemTime(Date.now() + PORT_CLOSED_GRACE_MS);
    expect(brief(await adapter.health())).toEqual([
      { source: 'Downloader.connection', level: 'warning', status: 'firewalled' },
    ]);
  });

  it('ignores "firewalled" when nothing is transferring', async () => {
    const { adapter } = client('firewalled', []);
    await adapter.health();
    vi.setSystemTime(Date.now() + PORT_CLOSED_GRACE_MS);
    expect(await adapter.health()).toEqual([]);
  });
});

describe('Transmission health', () => {
  const torrents = (errorKey: string) => [
    { name: 'Example.Show.S01E01', error: 2, [errorKey]: 'Unregistered torrent' },
    { name: 'Sample.Movie.2021', error: 1, [errorKey]: 'announce timed out' },
    { name: 'Other.Movie.2020', error: 0, [errorKey]: '' },
  ];

  it('reports tracker errors but not tracker warnings (legacy RPC)', async () => {
    const { adapter } = make(transmission, {}, [
      {
        method: 'POST',
        path: '/transmission/rpc',
        body: { method: 'session-get' },
        json: { result: 'success', arguments: {} },
      },
      {
        method: 'POST',
        path: '/transmission/rpc',
        body: { method: 'torrent-get' },
        json: { result: 'success', arguments: { torrents: torrents('errorString') } },
      },
    ]);
    const signals = await adapter.health();
    expect(brief(signals)).toEqual([
      { source: 'Downloader.trackerError', level: 'warning', status: undefined },
    ]);
    expect(signals[0]!.data).toEqual({ name: 'Example.Show.S01E01', reason: 'Unregistered torrent' });
  });

  it('reads snake_case fields over JSON-RPC 2.0', async () => {
    const { adapter, http } = make(transmission, {}, [
      {
        method: 'POST',
        path: '/transmission/rpc',
        body: { jsonrpc: '2.0', method: 'session_get' },
        json: { result: {} },
      },
      {
        method: 'POST',
        path: '/transmission/rpc',
        body: { jsonrpc: '2.0', method: 'torrent_get' },
        json: { result: { torrents: torrents('error_string') } },
      },
      { method: 'POST', path: '/transmission/rpc', json: { result: 'method name not recognized' } },
    ]);
    const signals = await adapter.health();
    expect(signals.map((s) => s.data)).toEqual([
      { name: 'Example.Show.S01E01', reason: 'Unregistered torrent' },
    ]);
    const get = http.calls.find((c) => (c.json as { method?: string }).method === 'torrent_get');
    expect((get!.json as { params: { fields: string[] } }).params.fields).toContain('error_string');
  });
});

describe('Deluge health', () => {
  function client(incoming: boolean | undefined, active: Record<string, unknown> = { h1: { name: 'A' } }) {
    return make(deluge, { password: 'p' }, [
      {
        method: 'POST',
        path: '/json',
        body: { method: 'auth.login' },
        json: { result: true, error: null },
        responseHeaders: { 'set-cookie': '_session_id=s; path=/' },
      },
      {
        method: 'POST',
        path: '/json',
        body: { method: 'web.connected' },
        json: { result: true, error: null },
      },
      {
        method: 'POST',
        path: '/json',
        body: { method: 'core.get_torrents_status', params: [{}, ['name', 'tracker_status']] },
        json: {
          result: {
            h1: { name: 'Example.Show.S01E01', tracker_status: 'Error: unregistered torrent' },
            h2: { name: 'Sample.Movie.2021', tracker_status: 'Announce OK' },
          },
          error: null,
        },
      },
      {
        method: 'POST',
        path: '/json',
        body: { method: 'core.get_torrents_status', params: [{ state: 'Active' }, ['name']] },
        json: { result: active, error: null },
      },
      {
        method: 'POST',
        path: '/json',
        body: { method: 'core.get_session_status' },
        json: { result: incoming === undefined ? {} : { has_incoming_connections: incoming }, error: null },
      },
    ]);
  }

  it('reads the tracker error out of tracker_status', () => {
    expect(trackerError('Error: unregistered torrent')).toBe('unregistered torrent');
    expect(trackerError('Announce OK')).toBeNull();
    expect(trackerError(undefined)).toBeNull();
  });

  it('reports tracker errors and, after the grace period, a closed port', async () => {
    const { adapter } = client(false);
    expect(brief(await adapter.health())).toEqual([
      { source: 'Downloader.trackerError', level: 'warning', status: undefined },
    ]);
    vi.setSystemTime(Date.now() + PORT_CLOSED_GRACE_MS);
    expect(brief(await adapter.health())).toEqual([
      { source: 'Downloader.trackerError', level: 'warning', status: undefined },
      { source: 'Downloader.connection', level: 'warning', status: 'firewalled' },
    ]);
  });

  it('skips the port check when the daemon does not know the key or nothing is active', async () => {
    for (const { adapter } of [client(undefined), client(false, {})]) {
      await adapter.health();
      vi.setSystemTime(Date.now() + PORT_CLOSED_GRACE_MS);
      expect(brief(await adapter.health()).map((s) => s.source)).toEqual(['Downloader.trackerError']);
    }
  });
});

describe('NZBGet health', () => {
  const client = (status: Record<string, unknown>) =>
    make(nzbget, { username: 'u', password: 'p' }, [
      { method: 'POST', path: '/jsonrpc', body: { method: 'status' }, json: { result: status } },
    ]);

  it('reports an open-ended pause as info', async () => {
    expect(brief(await client({ DownloadPaused: true, ResumeTime: 0 }).adapter.health())).toEqual([
      { source: 'Downloader.paused', level: 'info', status: undefined },
    ]);
  });

  it('ignores a pause with a resume timer', async () => {
    expect(await client({ DownloadPaused: true, ResumeTime: 1767272400 }).adapter.health()).toEqual([]);
  });

  it('reports a used-up quota instead of the pause it causes', async () => {
    expect(brief(await client({ DownloadPaused: true, QuotaReached: true }).adapter.health())).toEqual([
      { source: 'Downloader.quota', level: 'warning', status: undefined },
    ]);
  });
});

describe('SABnzbd health', () => {
  const KEY = '00000000000000000000000000000001';
  const client = (queue: Record<string, unknown>) =>
    make(sabnzbd, { apiKey: KEY }, [
      { path: '/api', query: { mode: 'warnings' }, json: { warnings: [] } },
      { path: '/api', query: { mode: 'queue' }, json: { queue: { slots: [], ...queue } } },
    ]);

  it('reports an open-ended pause', async () => {
    expect(brief(await client({ paused: true, pause_int: '0' }).adapter.health())).toEqual([
      { source: 'Downloader.paused', level: 'info', status: undefined },
    ]);
  });

  it('ignores a timed pause and a running queue', async () => {
    expect(await client({ paused: true, pause_int: '4:59' }).adapter.health()).toEqual([]);
    expect(await client({ paused: false, pause_int: '0' }).adapter.health()).toEqual([]);
  });
});
