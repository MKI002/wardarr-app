// What adapters report for the stack map. All hosts, paths and names are invented.
import type { ServiceTopology } from '@wardarr/core';
import { describe, expect, it } from 'vitest';
import { radarr } from '../src/arr/radarr.js';
import { jellyfin } from '../src/media/jellyfin.js';
import { seerr } from '../src/requests/seerr.js';
import { bazarr } from '../src/subtitles/bazarr.js';
import { addressOf, mountOf, productsOf } from '../src/shared/topology.js';
import { createFixtureHttp, type FixtureRoute } from './fixtureHttp.js';

const KEY = '00000000000000000000000000000001';
const H = { 'X-Api-Key': KEY };
const GB = 1024 ** 3;

function make(def: { create: (ctx: never) => unknown }, routes: FixtureRoute[]) {
  const http = createFixtureHttp(routes);
  return def.create({
    instanceId: 'i1',
    instanceName: 'Test',
    baseUrl: 'http://svc.example.test',
    credentials: { apiKey: KEY },
    http,
    log: { debug() {}, warn() {} },
  } as never) as { topology(): Promise<ServiceTopology> };
}

describe('topology helpers', () => {
  it('builds addresses without credentials', () => {
    expect(addressOf({ host: 'qbit', port: 8080, ssl: false, base: '/qb/' })).toBe('http://qbit:8080/qb');
    expect(addressOf({ host: 'https://user:secret@sab.example.test/sab', port: 443 })).toBe(
      'https://sab.example.test/sab',
    );
    expect(addressOf({ host: '' })).toBeNull();
  });

  it('maps implementations to adapters', () => {
    expect(productsOf('QBittorrent')).toEqual(['qbittorrent']);
    expect(productsOf('MediaBrowser')).toEqual(['jellyfin', 'emby']);
    expect(productsOf('Aria2')).toEqual([]);
  });

  it('finds the mount of a folder', () => {
    const disks = [{ path: '/' }, { path: '/data' }, { path: '/data/media' }];
    expect(mountOf('/data/media/movies', disks)?.path).toBe('/data/media');
    expect(mountOf('/database', disks)?.path).toBe('/');
  });
});

describe('adapter topology', () => {
  it('Radarr reports download clients, media server links and root folders with disk space', async () => {
    const adapter = make(radarr, [
      { path: '/api', headers: H, json: { current: 'v3' } },
      { path: '/api/v3/system/status', headers: H, json: { appName: 'Radarr', version: '5.26.2.10099' } },
      {
        path: '/api/v3/downloadclient',
        headers: H,
        json: [
          {
            name: 'Torrents',
            implementation: 'QBittorrent',
            enable: true,
            fields: [
              { name: 'host', value: 'qbit' },
              { name: 'port', value: 8080 },
              { name: 'password', value: 'never-read' },
            ],
          },
        ],
      },
      {
        path: '/api/v3/notification',
        headers: H,
        json: [
          { name: 'Hook', implementation: 'Webhook', fields: [] },
          {
            name: 'Plex',
            implementation: 'PlexServer',
            onDownload: true,
            fields: [{ name: 'host', value: 'plex' }],
          },
        ],
      },
      {
        path: '/api/v3/rootfolder',
        headers: H,
        json: [{ path: '/data/movies', freeSpace: 400 * GB, accessible: true }],
      },
      {
        path: '/api/v3/diskspace',
        headers: H,
        json: [
          { path: '/', freeSpace: 10 * GB, totalSpace: 50 * GB },
          { path: '/data', freeSpace: 400 * GB, totalSpace: 2000 * GB },
        ],
      },
    ]);
    const topo = await adapter.topology();
    expect(topo.links).toEqual([
      expect.objectContaining({
        kind: 'downloads',
        products: ['qbittorrent'],
        name: 'Torrents',
        url: 'http://qbit:8080',
      }),
      expect.objectContaining({ kind: 'libraryUpdate', products: ['plex'], url: 'http://plex' }),
    ]);
    expect(JSON.stringify(topo)).not.toContain('never-read');
    expect(topo.folders).toEqual([
      {
        path: '/data/movies',
        use: 'media',
        kind: 'movie',
        accessible: true,
        freeBytes: 400 * GB,
        totalBytes: 2000 * GB,
        mount: '/data',
      },
    ]);
  });

  it('a missing endpoint drops only its part', async () => {
    const adapter = make(radarr, [
      { path: '/api', headers: H, json: { current: 'v3' } },
      { path: '/api/v3/system/status', headers: H, json: { appName: 'Radarr', version: '5.26.2.10099' } },
      { path: '/api/v3/rootfolder', headers: H, json: [{ path: '/movies', freeSpace: 5 * GB }] },
    ]);
    const topo = await adapter.topology();
    expect(topo.links).toEqual([]);
    expect(topo.folders[0]).toMatchObject({ path: '/movies', freeBytes: 5 * GB, totalBytes: null });
  });

  it('Seerr reports its Radarr and Sonarr servers and the media server', async () => {
    const adapter = make(seerr, [
      {
        path: '/api/v1/settings/radarr',
        json: [
          { name: 'Radarr 4K', hostname: 'radarr4k', port: 7878, useSsl: false, is4k: true, apiKey: 'x' },
        ],
      },
      { path: '/api/v1/settings/sonarr', json: [] },
      { path: '/api/v1/settings/main', json: { mediaServerType: 2 } },
      { path: '/api/v1/settings/jellyfin', json: { name: 'Home', ip: 'jf', port: 8096, useSsl: true } },
    ]);
    const topo = await adapter.topology();
    expect(topo.links).toEqual([
      expect.objectContaining({
        kind: 'requests',
        products: ['radarr'],
        url: 'http://radarr4k:7878',
        is4k: true,
      }),
      expect.objectContaining({
        kind: 'mediaServer',
        products: ['jellyfin'],
        name: 'Home',
        url: 'https://jf:8096',
      }),
    ]);
  });

  it('Bazarr reports the *arr apps it is switched on for', async () => {
    const adapter = make(bazarr, [
      {
        path: '/api/system/settings',
        json: {
          general: { use_sonarr: true, use_radarr: false },
          sonarr: { ip: 'sonarr', port: 8989, base_url: '/', ssl: false, apikey: 'x' },
          radarr: { ip: 'radarr', port: 7878 },
        },
      },
    ]);
    const topo = await adapter.topology();
    expect(topo.links).toEqual([
      expect.objectContaining({ kind: 'subtitles', products: ['sonarr'], url: 'http://sonarr:8989' }),
    ]);
  });

  it('Jellyfin reports the folders of its libraries', async () => {
    const adapter = make(jellyfin, [
      {
        path: '/Library/VirtualFolders',
        json: [{ Name: 'Films', CollectionType: 'movies', ItemId: 'a', Locations: ['/media/films'] }],
      },
    ]);
    const topo = await adapter.topology();
    expect(topo.folders).toEqual([
      {
        path: '/media/films',
        use: 'library',
        name: 'Films',
        kind: 'movie',
        freeBytes: null,
        totalBytes: null,
      },
    ]);
  });
});
