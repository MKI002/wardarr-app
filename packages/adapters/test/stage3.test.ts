// Discover, requests, library and indexer statistics against invented data.
import { describe, expect, it } from 'vitest';
import { prowlarr } from '../src/indexers/prowlarr.js';
import { jellyfin } from '../src/media/jellyfin.js';
import { plex } from '../src/media/plex.js';
import { seerr } from '../src/requests/seerr.js';
import { createFixtureHttp, type FixtureRoute } from './fixtureHttp.js';

const KEY = '00000000000000000000000000000001';

function make<C>(def: { create: (ctx: never) => unknown }, credentials: C, routes: FixtureRoute[]) {
  const http = createFixtureHttp(routes);
  const adapter = def.create({
    instanceId: 'i1',
    instanceName: 'Test',
    baseUrl: 'http://svc.example.test',
    credentials,
    http,
    log: { debug() {}, warn() {} },
  } as never) as Record<string, (...a: unknown[]) => Promise<unknown>>;
  return { adapter, http };
}

describe('Seerr', () => {
  const H = { 'X-Api-Key': KEY };
  const routes: FixtureRoute[] = [
    {
      path: '/api/v1/discover/trending',
      headers: H,
      json: {
        page: 1,
        totalPages: 3,
        results: [
          {
            id: 101,
            mediaType: 'movie',
            title: 'Example Film',
            releaseDate: '2024-05-01',
            posterPath: '/p1.jpg',
            voteAverage: 7.1,
            mediaInfo: { status: 5, status4k: 1 },
          },
          {
            id: 202,
            mediaType: 'tv',
            name: 'Example Series',
            firstAirDate: '2023-01-10',
            posterPath: '/p2.jpg',
            mediaInfo: { status: 2 },
          },
          { id: 303, mediaType: 'person', name: 'Example Person' },
        ],
      },
    },
    {
      path: '/api/v1/discover/movies',
      headers: H,
      json: {
        page: 2,
        totalPages: 9,
        results: [{ id: 104, title: 'Another Film', releaseDate: '2022-02-02' }],
      },
    },
    {
      path: '/api/v1/tv/202',
      headers: H,
      json: {
        id: 202,
        name: 'Example Series',
        firstAirDate: '2023-01-10',
        externalIds: { tvdbId: 9202 },
        seasons: [
          { seasonNumber: 0, name: 'Specials', episodeCount: 2 },
          { seasonNumber: 1, name: 'Season 1', episodeCount: 8 },
          { seasonNumber: 2, name: 'Season 2', episodeCount: 8 },
        ],
        mediaInfo: { status: 4, seasons: [{ seasonNumber: 1, status: 5 }] },
      },
    },
    {
      path: '/api/v1/movie/101',
      headers: H,
      json: { id: 101, title: 'Example Film', posterPath: '/p1.jpg' },
    },
    {
      path: '/api/v1/service/radarr',
      headers: H,
      json: [
        {
          id: 0,
          name: 'Radarr',
          is4k: false,
          isDefault: true,
          activeProfileId: 4,
          activeDirectory: '/movies',
        },
        { id: 1, name: 'Radarr 4K', is4k: true, isDefault: true },
      ],
    },
    {
      path: '/api/v1/service/radarr/0',
      headers: H,
      json: { profiles: [{ id: 4, name: 'HD-1080p' }], rootFolders: [{ id: 1, path: '/movies' }] },
    },
    {
      path: '/api/v1/service/radarr/1',
      headers: H,
      json: { profiles: [{ id: 5, name: 'Ultra-HD' }], rootFolders: [{ id: 2, path: '/movies-uhd' }] },
    },
    { path: '/api/v1/service/sonarr', headers: H, json: [] },
    {
      path: '/api/v1/request',
      headers: H,
      query: { filter: 'pending', take: '20', skip: '0' },
      json: {
        pageInfo: { results: 1 },
        results: [
          {
            id: 7,
            status: 1,
            is4k: false,
            media: { mediaType: 'movie', tmdbId: 101, status: 2 },
            requestedBy: { id: 3, displayName: 'Example User' },
            createdAt: '2026-01-01T00:00:00Z',
          },
        ],
      },
    },
    {
      method: 'POST',
      path: '/api/v1/request',
      headers: { ...H, 'X-API-User': '3' },
      body: { mediaType: 'movie', mediaId: 101, is4k: true, serverId: 1 },
      json: {
        id: 8,
        status: 1,
        is4k: true,
        media: { mediaType: 'movie', tmdbId: 101 },
        requestedBy: { id: 3, displayName: 'Example User' },
        createdAt: '2026-01-02T00:00:00Z',
      },
    },
    {
      method: 'POST',
      path: '/api/v1/request/7/approve',
      headers: H,
      json: { id: 7, status: 2, media: { mediaType: 'movie', tmdbId: 101 }, requestedBy: { id: 3 } },
    },
    {
      path: '/api/v1/user',
      headers: H,
      json: {
        results: [
          { id: 3, displayName: 'Example User', plexUsername: 'example-user', email: 'user@example.com' },
        ],
      },
    },
  ];

  it('lists Discover without people, with library and request state', async () => {
    const { adapter } = make(seerr, { apiKey: KEY }, routes);
    const page = (await adapter.discover!('trending', 1)) as {
      results: Array<Record<string, unknown>>;
      totalPages: number;
    };
    expect(page.totalPages).toBe(3);
    expect(page.results).toEqual([
      expect.objectContaining({
        tmdbId: 101,
        mediaType: 'movie',
        title: 'Example Film',
        year: 2024,
        status: 'available',
        status4k: 'unknown',
      }),
      expect.objectContaining({ tmdbId: 202, mediaType: 'tv', title: 'Example Series', status: 'requested' }),
    ]);
    const movies = (await adapter.discover!('movies', 2)) as { results: Array<Record<string, unknown>> };
    expect(movies.results[0]).toMatchObject({ mediaType: 'movie', title: 'Another Film' });
  });

  it('reads seasons without specials', async () => {
    const { adapter } = make(seerr, { apiKey: KEY }, routes);
    const d = (await adapter.mediaDetails!('tv', 202)) as {
      seasons: unknown[];
      tvdbId: number;
      status: string;
    };
    expect(d).toMatchObject({ tvdbId: 9202, status: 'partial' });
    expect(d.seasons).toEqual([
      { seasonNumber: 1, name: 'Season 1', episodeCount: 8, status: 'available', status4k: 'unknown' },
      { seasonNumber: 2, name: 'Season 2', episodeCount: 8, status: 'unknown', status4k: 'unknown' },
    ]);
  });

  it('lists request servers with profiles and folders', async () => {
    const { adapter } = make(seerr, { apiKey: KEY }, routes);
    expect(await adapter.requestServers!()).toEqual([
      expect.objectContaining({
        id: 0,
        type: 'radarr',
        is4k: false,
        profiles: [{ id: 4, name: 'HD-1080p' }],
        rootFolders: ['/movies'],
        defaultProfileId: 4,
      }),
      expect.objectContaining({ id: 1, type: 'radarr', is4k: true, rootFolders: ['/movies-uhd'] }),
    ]);
  });

  it('requests as the matching Seerr user', async () => {
    const { adapter, http } = make(seerr, { apiKey: KEY }, routes);
    const r = await adapter.createRequest!({ mediaType: 'movie', tmdbId: 101, is4k: true, serverId: 1 }, 3);
    expect(r).toMatchObject({ id: 8, is4k: true, title: 'Example Film', requestedBy: { id: 3 } });
    const post = http.calls.find((c) => c.method === 'POST');
    expect(post?.headers).toMatchObject({ 'X-API-User': '3' });
  });

  it('lists, filters and approves requests', async () => {
    const { adapter } = make(seerr, { apiKey: KEY }, routes);
    const list = (await adapter.requests!({ status: 'pending', take: 20, skip: 0 })) as {
      total: number;
      results: unknown[];
    };
    expect(list.total).toBe(1);
    expect(list.results[0]).toMatchObject({
      id: 7,
      status: 'pending',
      title: 'Example Film',
      mediaStatus: 'requested',
    });
    expect(await adapter.setRequestStatus!(7, 'approve')).toMatchObject({ id: 7, status: 'approved' });
  });

  it('lists users with their aliases but without e-mail addresses', async () => {
    const { adapter } = make(seerr, { apiKey: KEY }, routes);
    expect(await adapter.users!()).toEqual([
      { id: 3, name: 'Example User', aliases: ['example-user', 'Example User'] },
    ]);
  });
});

describe('media server libraries', () => {
  it('counts Jellyfin titles, size, resolutions and codecs', async () => {
    const auth = { authorization: `MediaBrowser Token="${KEY}"` };
    const { adapter } = make(jellyfin, { apiKey: KEY }, [
      {
        path: '/Library/VirtualFolders',
        headers: auth,
        json: [
          { Name: 'Movies', CollectionType: 'movies', ItemId: 'lib1' },
          { Name: 'Shows', CollectionType: 'tvshows', ItemId: 'lib2' },
        ],
      },
      { path: '/Items', query: { ParentId: 'lib1', Limit: '0' }, json: { TotalRecordCount: 2 } },
      {
        path: '/Items',
        query: { ParentId: 'lib1', IncludeItemTypes: 'Movie' },
        json: {
          TotalRecordCount: 2,
          Items: [
            {
              MediaSources: [{ Size: 4000, MediaStreams: [{ Type: 'Video', Height: 2160, Codec: 'hevc' }] }],
            },
            {
              MediaSources: [{ Size: 1000, MediaStreams: [{ Type: 'Video', Height: 1080, Codec: 'h264' }] }],
            },
          ],
        },
      },
      {
        path: '/Items',
        query: { ParentId: 'lib2', IncludeItemTypes: 'Series' },
        json: { TotalRecordCount: 1 },
      },
      {
        path: '/Items',
        query: { ParentId: 'lib2', IncludeItemTypes: 'Episode' },
        json: {
          TotalRecordCount: 1,
          Items: [
            { MediaSources: [{ Size: 500, MediaStreams: [{ Type: 'Video', Height: 720, Codec: 'avc' }] }] },
          ],
        },
      },
    ]);
    expect(await adapter.libraries!()).toEqual([
      {
        id: 'lib1',
        name: 'Movies',
        kind: 'movie',
        items: 2,
        files: 2,
        sizeBytes: 5000,
        resolutions: { '4K': 1, '1080p': 1 },
        videoCodecs: { hevc: 1, h264: 1 },
      },
      {
        id: 'lib2',
        name: 'Shows',
        kind: 'show',
        items: 1,
        files: 1,
        sizeBytes: 500,
        resolutions: { '720p': 1 },
        videoCodecs: { h264: 1 },
      },
    ]);
  });

  it('counts Plex titles, size, resolutions and codecs', async () => {
    const { adapter } = make(plex, { token: KEY }, [
      {
        path: '/library/sections',
        json: { MediaContainer: { Directory: [{ key: '1', title: 'Films', type: 'movie' }] } },
      },
      {
        path: '/library/sections/1/all',
        query: { type: '1' },
        headers: { 'X-Plex-Container-Size': '0' },
        json: { MediaContainer: { totalSize: 2 } },
      },
      {
        path: '/library/sections/1/all',
        query: { type: '1' },
        json: {
          MediaContainer: {
            totalSize: 2,
            Metadata: [
              { Media: [{ videoResolution: '4k', videoCodec: 'hevc', Part: [{ size: 3000 }] }] },
              { Media: [{ videoResolution: '480', videoCodec: 'mpeg4', Part: [{ size: 200 }] }] },
            ],
          },
        },
      },
    ]);
    expect(await adapter.libraries!()).toEqual([
      {
        id: '1',
        name: 'Films',
        kind: 'movie',
        items: 2,
        files: 2,
        sizeBytes: 3200,
        resolutions: { '4K': 1, SD: 1 },
        videoCodecs: { hevc: 1, mpeg4: 1 },
      },
    ]);
  });
});

describe('Prowlarr statistics and apps', () => {
  const H = { 'X-Api-Key': KEY };
  const routes: FixtureRoute[] = [
    { path: '/api/v1/system/status', headers: H, json: { version: '2.0.5.5160' } },
    {
      path: '/api/v1/indexerstats',
      headers: H,
      json: {
        indexers: [
          {
            indexerId: 7,
            indexerName: 'ExampleIndexer',
            numberOfQueries: 120,
            numberOfGrabs: 30,
            numberOfFailedQueries: 4,
            numberOfFailedGrabs: 1,
            averageResponseTime: 350,
          },
        ],
      },
    },
    {
      path: '/api/v1/indexer',
      headers: H,
      json: [
        { id: 7, name: 'ExampleIndexer', enable: true, tags: [1] },
        { id: 8, name: 'OtherIndexer', enable: true, tags: [] },
      ],
    },
    {
      path: '/api/v1/applications',
      headers: H,
      json: [
        {
          id: 1,
          name: 'Sonarr',
          implementation: 'Sonarr',
          syncLevel: 'fullSync',
          tags: [],
          fields: [
            { name: 'baseUrl', value: 'http://sonarr.example.test:8989' },
            { name: 'apiKey', value: '********' },
          ],
        },
        { id: 2, name: 'Radarr 4K', implementation: 'Radarr', syncLevel: 'addOnly', tags: [2], fields: [] },
        { id: 3, name: 'Lidarr', implementation: 'Lidarr', syncLevel: 'disabled', tags: [], fields: [] },
      ],
    },
  ];

  it('reads indexer statistics', async () => {
    const { adapter } = make(prowlarr, { apiKey: KEY }, routes);
    expect(await adapter.indexerStats!()).toEqual([
      {
        indexerId: 7,
        name: 'ExampleIndexer',
        queries: 120,
        grabs: 30,
        failedQueries: 4,
        failedGrabs: 1,
        averageResponseMs: 350,
      },
    ]);
  });

  it('knows which apps receive which indexers', async () => {
    const { adapter } = make(prowlarr, { apiKey: KEY }, routes);
    const apps = (await adapter.indexerApps!()) as Array<Record<string, unknown>>;
    expect(apps.map((a) => [a.name, a.indexerIds, a.baseUrl])).toEqual([
      ['Sonarr', [7, 8], 'http://sonarr.example.test:8989'],
      ['Radarr 4K', [], null],
      ['Lidarr', [], null],
    ]);
    expect(JSON.stringify(apps)).not.toContain('apiKey');
  });
});
