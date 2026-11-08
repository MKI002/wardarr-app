// Discover, requests, library, stream history and indexers through the API,
// with fake Seerr, media server and Prowlarr adapters. All data is invented.
import {
  AdapterError,
  defineAdapter,
  type IndexerInfo,
  type LibraryStats,
  type MediaRequest,
  type NewRequest,
  type StreamSession,
} from '@wardarr/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FAKE_KEY, authHeaders, createTestApp, setupAdmin } from './helpers.js';

const seen: { create: Array<{ req: NewRequest; asUser?: number }>; requestedBy: Array<number | undefined> } =
  {
    create: [],
    requestedBy: [],
  };

function request(over: Partial<MediaRequest> = {}): MediaRequest {
  return {
    id: 1,
    status: 'pending',
    mediaType: 'movie',
    tmdbId: 101,
    title: 'Example Film',
    posterPath: null,
    is4k: false,
    seasons: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: null,
    requestedBy: { id: 3, name: 'Example Viewer' },
    serverId: 0,
    profileId: null,
    rootFolder: null,
    mediaStatus: 'requested',
    ...over,
  };
}

const credentials = z.object({ apiKey: z.string().min(1) });
const base = {
  lifecycle: 'active' as const,
  homepage: 'https://example.com',
  fields: [{ key: 'apiKey', kind: 'secret' as const, label: 'fields.apiKey', required: true }],
  credentials,
};

const fakeSeerr = defineAdapter({
  ...base,
  id: 'fakeseerr',
  name: 'Fake Seerr',
  category: 'requests',
  capabilities: ['discover', 'requests'],
  create() {
    return {
      testConnection: async () => ({ version: '2.0.0' }),
      discover: async () => ({
        page: 1,
        totalPages: 1,
        results: [
          {
            tmdbId: 101,
            mediaType: 'movie' as const,
            title: 'Example Film',
            year: 2024,
            overview: '',
            posterPath: '/p1.jpg',
            backdropPath: null,
            rating: 7,
            status: 'available' as const,
            status4k: 'unknown' as const,
          },
        ],
      }),
      requestServers: async () => [
        {
          id: 0,
          name: 'Movies',
          type: 'radarr' as const,
          is4k: false,
          isDefault: true,
          profiles: [{ id: 4, name: 'HD' }],
          rootFolders: ['/films'],
          defaultProfileId: 4,
          defaultRootFolder: '/films',
        },
        {
          id: 1,
          name: 'Movies 4K',
          type: 'radarr' as const,
          is4k: true,
          isDefault: true,
          profiles: [{ id: 5, name: 'UHD' }],
          rootFolders: ['/films-uhd'],
          defaultProfileId: 5,
          defaultRootFolder: '/films-uhd',
        },
      ],
      users: async () => [
        { id: 1, name: 'Example Admin', aliases: [] },
        { id: 3, name: 'Example Viewer', aliases: ['viewer'] },
        { id: 4, name: 'Another Viewer', aliases: ['other'] },
      ],
      createRequest: async (req: NewRequest, asUser?: number) => {
        seen.create.push({ req, asUser });
        return request({ id: 9, is4k: req.is4k, requestedBy: { id: asUser ?? 1, name: 'x' } });
      },
      requests: async (filter: { requestedBy?: number }) => {
        seen.requestedBy.push(filter.requestedBy);
        return { total: 1, results: [request()] };
      },
      setRequestStatus: async (id: number, s: string) =>
        request({ id, status: s === 'approve' ? 'approved' : 'declined' }),
      editRequest: async (id: number) => request({ id }),
      retryRequest: async (id: number) => request({ id }),
    };
  },
});

const media = {
  sessions: [] as StreamSession[],
  libraries: [] as LibraryStats[],
  libraryFails: false,
};

const fakeMedia = defineAdapter({
  ...base,
  id: 'fakemedia',
  name: 'Fake Media',
  category: 'mediaServer',
  capabilities: ['sessions', 'library'],
  create() {
    return {
      testConnection: async () => ({ version: '10.0.0' }),
      sessions: async () => media.sessions,
      libraries: async () => {
        if (media.libraryFails) throw new AdapterError('timeout', 'slow');
        return media.libraries;
      },
    };
  },
});

const prowlarr = { statsFail: false };

const indexers: IndexerInfo[] = [
  { id: 7, name: 'Example Indexer', enabled: true, protocol: 'torrent', failing: true },
  { id: 8, name: 'Other Indexer', enabled: true, protocol: 'usenet', failing: false },
];

const fakeProwlarr = defineAdapter({
  ...base,
  id: 'fakeprowlarr',
  name: 'Fake Prowlarr',
  category: 'indexer',
  capabilities: ['indexers'],
  create() {
    return {
      testConnection: async () => ({ version: '2.0.0' }),
      indexers: async () => indexers,
      testIndexer: async (id: number) => ({ ok: id === 8 }),
      indexerStats: async () => {
        if (prowlarr.statsFail) throw new AdapterError('timeout', 'slow');
        return [
          {
            indexerId: 7,
            name: 'Example Indexer',
            queries: 10,
            grabs: 2,
            failedQueries: 5,
            failedGrabs: 0,
            averageResponseMs: 900,
          },
        ];
      },
      indexerApps: async () => [
        { id: 1, name: 'Series', implementation: 'Sonarr', baseUrl: null, enabled: true, indexerIds: [7] },
        { id: 2, name: 'Films', implementation: 'Radarr', baseUrl: null, enabled: true, indexerIds: [7, 8] },
      ],
    };
  },
});

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: Record<string, string>;
let viewer: Record<string, string>;
let other: Record<string, string>;
const ids: Record<string, string> = {};
const images: string[] = [];

async function addInstance(adapter: string, name: string) {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/instances',
    headers: admin,
    payload: { adapter, name, baseUrl: 'http://svc.example.test', fields: { apiKey: FAKE_KEY } },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

async function login(username: string, displayName?: string) {
  const created = await t.app.inject({
    method: 'POST',
    url: '/api/users',
    headers: admin,
    payload: {
      username,
      password: `${username}-password-1`,
      role: 'user',
      ...(displayName ? { displayName } : {}),
    },
  });
  expect(created.statusCode).toBeLessThan(300);
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { 'x-wardarr-request': '1' },
    payload: { username, password: `${username}-password-1` },
  });
  return { headers: authHeaders(res), id: created.json().id as string };
}

beforeAll(async () => {
  t = await createTestApp({
    adapters: [fakeSeerr, fakeMedia, fakeProwlarr],
    imageFetch: async (url) => {
      images.push(url);
      return new Response(Buffer.from([0xff, 0xd8, 0xff]), { headers: { 'content-type': 'image/jpeg' } });
    },
  });
  admin = await setupAdmin(t);
  ids.seerr = await addInstance('fakeseerr', 'Requests');
  ids.media = await addInstance('fakemedia', 'Media');
  ids.prowlarr = await addInstance('fakeprowlarr', 'Indexers');
  viewer = (await login('viewer')).headers;
  const o = await login('stranger');
  other = o.headers;
  ids.stranger = o.id;
  await t.runtime.pollMany(Object.values(ids).filter((x) => x !== ids.stranger));
});
afterAll(async () => t.close());

const call = (
  headers: Record<string, string>,
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  payload?: object,
) => t.app.inject({ method, url, headers, payload });

describe('tabs', () => {
  it('shows users Discover, requests and library, and admins the indexers too', async () => {
    const user = (await call(viewer, 'GET', '/api/capabilities')).json().tabs;
    expect(user).toEqual(expect.arrayContaining(['discover', 'requests', 'library']));
    expect(user).not.toContain('indexers');
    expect((await call(admin, 'GET', '/api/capabilities')).json().tabs).toContain('indexers');
  });
});

describe('Discover and requests', () => {
  it('lets users browse Discover', async () => {
    const res = await call(viewer, 'GET', '/api/discover?list=trending');
    expect(res.statusCode).toBe(200);
    expect(res.json().results[0]).toMatchObject({ title: 'Example Film', status: 'available' });
  });

  it('hides quality profiles and folders from users', async () => {
    const res = (await call(viewer, 'GET', '/api/discover/options')).json();
    expect(res.linked).toBe(true);
    expect(res.servers[0]).toEqual({ id: 0, name: 'Movies', type: 'radarr', is4k: false, isDefault: true });
    expect((await call(admin, 'GET', '/api/discover/options')).json().servers[0].profiles).toHaveLength(1);
  });

  it('requests as the Seerr user matched by name, without user-chosen profiles', async () => {
    seen.create.length = 0;
    const res = await call(viewer, 'POST', '/api/requests', {
      mediaType: 'movie',
      tmdbId: 101,
      is4k: true,
      serverId: 1,
      profileId: 99,
    });
    expect(res.statusCode).toBe(200);
    expect(seen.create[0]).toEqual({
      req: { mediaType: 'movie', tmdbId: 101, is4k: true, serverId: 1 },
      asUser: 3,
    });
  });

  it('rejects a server that does not match the chosen quality', async () => {
    const res = await call(viewer, 'POST', '/api/requests', {
      mediaType: 'movie',
      tmdbId: 101,
      is4k: false,
      serverId: 1,
    });
    expect(res.statusCode).toBe(400);
  });

  it('refuses requests of users without a Seerr user', async () => {
    const res = await call(other, 'POST', '/api/requests', { mediaType: 'movie', tmdbId: 101 });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('notLinked');
    expect((await call(other, 'GET', '/api/requests/mine')).json()).toMatchObject({
      linked: false,
      results: [],
    });
  });

  it('lets an admin link a user by hand', async () => {
    const links = (await call(admin, 'GET', '/api/requests/links')).json();
    expect(links.users.find((u: { username: string }) => u.username === 'viewer').link).toMatchObject({
      externalId: 3,
      source: 'auto',
    });
    const put = await call(admin, 'PUT', `/api/requests/links/${ids.stranger}`, {
      instance: ids.seerr,
      externalId: 4,
    });
    expect(put.statusCode).toBe(200);
    seen.create.length = 0;
    expect((await call(other, 'POST', '/api/requests', { mediaType: 'movie', tmdbId: 101 })).statusCode).toBe(
      200,
    );
    expect(seen.create[0]?.asUser).toBe(4);
  });

  it('shows users only their own requests', async () => {
    seen.requestedBy.length = 0;
    expect((await call(viewer, 'GET', '/api/requests/mine')).statusCode).toBe(200);
    expect(seen.requestedBy).toEqual([3]);
    expect((await call(viewer, 'GET', '/api/requests')).statusCode).toBe(403);
    expect((await call(viewer, 'POST', `/api/requests/${ids.seerr}/1/approve`)).statusCode).toBe(403);
    expect((await call(viewer, 'GET', '/api/requests/links')).statusCode).toBe(403);
  });

  it('lets admins approve, decline, edit and retry', async () => {
    expect((await call(admin, 'GET', '/api/requests?status=pending')).json().total).toBe(1);
    expect((await call(admin, 'POST', `/api/requests/${ids.seerr}/1/approve`)).json().status).toBe(
      'approved',
    );
    expect((await call(admin, 'POST', `/api/requests/${ids.seerr}/1/decline`)).json().status).toBe(
      'declined',
    );
    expect((await call(admin, 'POST', `/api/requests/${ids.seerr}/1/retry`)).statusCode).toBe(200);
    expect((await call(admin, 'PUT', `/api/requests/${ids.seerr}/1`, { is4k: true })).statusCode).toBe(200);
    expect((await call(admin, 'POST', `/api/requests/${ids.seerr}/1/delete`)).statusCode).toBe(400);
  });
});

describe('posters', () => {
  it('proxies posters from the fixed host and caches them', async () => {
    images.length = 0;
    const a = await call(viewer, 'GET', '/api/images/tmdb/w342/p1.jpg');
    expect(a.statusCode).toBe(200);
    expect(a.headers['content-type']).toBe('image/jpeg');
    await call(viewer, 'GET', '/api/images/tmdb/w342/p1.jpg');
    expect(images).toEqual(['https://image.tmdb.org/t/p/w342/p1.jpg']);
  });

  it('proxies TheTVDB artwork for Sonarr series', async () => {
    images.length = 0;
    const url = '/api/images/tvdb/banners/v4/series/9007/posters/abc123.jpg';
    expect((await call(viewer, 'GET', url)).statusCode).toBe(200);
    await call(viewer, 'GET', url);
    expect(images).toEqual(['https://artworks.thetvdb.com/banners/v4/series/9007/posters/abc123.jpg']);
  });

  it('rejects other sizes and paths', async () => {
    for (const url of [
      '/api/images/tmdb/w9999/p1.jpg',
      '/api/images/tmdb/w342/..%2Fx.jpg',
      '/api/images/tmdb/w342/p1.svg',
      '/api/images/tvdb/banners/../secret.jpg',
      '/api/images/tvdb/banners/%2E%2E/secret.jpg',
      '/api/images/tvdb/other/posters/1.jpg',
      '/api/images/tvdb/banners/posters/1.svg',
    ]) {
      expect((await call(viewer, 'GET', url)).statusCode, url).toBe(404);
    }
  });
});

describe('stream history and library', () => {
  const session: StreamSession = {
    id: 's1',
    user: 'Example Viewer',
    title: 'Example Film',
    mediaType: 'movie',
    state: 'playing',
    progress: 0.25,
    durationMs: 6_000_000,
    positionMs: 1_500_000,
    transcoding: true,
  };

  it('records plays from the session polls and ends them when the session is gone', async () => {
    media.sessions = [session];
    await t.runtime.poll(ids.media!);
    media.sessions = [{ ...session, progress: 0.5 }];
    await t.runtime.poll(ids.media!);
    media.sessions = [];
    await t.runtime.poll(ids.media!);
    const plays = (await call(admin, 'GET', '/api/streams/history')).json().plays;
    expect(plays).toHaveLength(1);
    expect(plays[0]).toMatchObject({ title: 'Example Film', progress: 50, transcoding: true });
    expect(plays[0].endedAt).not.toBeNull();
  });

  it('counts library statistics and hides user names in shared stats', async () => {
    media.libraries = [
      {
        id: 'l1',
        name: 'Films',
        kind: 'movie',
        items: 3,
        files: 3,
        sizeBytes: 3000,
        resolutions: { '1080p': 2, '4K': 1 },
        videoCodecs: { h264: 3 },
      },
    ];
    await t.library.refresh(ids.media!);
    const full = (await call(admin, 'GET', '/api/library')).json();
    expect(full.servers[0].libraries[0].items).toBe(3);
    expect(full.streams.users).toEqual([expect.objectContaining({ user: 'Example Viewer', plays: 1 })]);
    const shared = (await call(viewer, 'GET', '/api/stats')).json();
    expect(shared.library.kinds.movie).toEqual({ items: 3, sizeBytes: 3000 });
    expect(shared.streams.plays).toBe(1);
    expect(JSON.stringify(shared)).not.toContain('Example Viewer');
    expect((await call(viewer, 'GET', '/api/library')).statusCode).toBe(403);
    expect((await call(viewer, 'GET', '/api/streams/history')).statusCode).toBe(403);
  });

  it('reports a failed library refresh as a Wardarr issue and keeps the old numbers', async () => {
    media.libraryFails = true;
    await t.library.refresh(ids.media!);
    const issue = t.issues.list({ status: 'open' }).find((i) => i.group.ruleId === 'wardarr-media-cache');
    expect(issue?.group.origin).toBe('wardarr');
    expect(t.library.list()[0]).toMatchObject({
      error: 'timeout',
      libraries: [expect.objectContaining({ items: 3 })],
    });
    media.libraryFails = false;
    await t.library.refresh(ids.media!);
    expect(t.issues.list({ status: 'open' }).some((i) => i.group.ruleId === 'wardarr-media-cache')).toBe(
      false,
    );
  });
});

describe('indexers', () => {
  it('answers at once and reads the statistics in the background', async () => {
    const first = (await call(admin, 'GET', '/api/indexers')).json().instances[0];
    expect(first).toMatchObject({ refreshing: true, statsAt: null });
    expect(first.indexers.map((i: { name: string }) => i.name)).toEqual(['Example Indexer', 'Other Indexer']);
    await t.indexers.settled();
  });

  it('shows statistics and the apps a failing indexer leaves without indexers', async () => {
    const res = (await call(admin, 'GET', '/api/indexers')).json();
    const inst = res.instances[0];
    expect(inst).toMatchObject({ refreshing: false, error: null });
    expect(inst.statsAt).toEqual(expect.any(String));
    const failing = inst.indexers.find((i: { id: number }) => i.id === 7);
    expect(failing).toMatchObject({ failing: true, apps: ['Series', 'Films'], stranded: ['Series'] });
    expect(failing.stats.failedQueries).toBe(5);
    expect(inst.apps.find((a: { name: string }) => a.name === 'Films').failing).toEqual(['Example Indexer']);
  });

  it('keeps the last statistics when Prowlarr is too slow', async () => {
    prowlarr.statsFail = true;
    try {
      const busy = (await call(admin, 'GET', '/api/indexers?refresh=1')).json().instances[0];
      expect(busy.refreshing).toBe(true);
      await t.indexers.settled();
      const inst = (await call(admin, 'GET', '/api/indexers')).json().instances[0];
      expect(inst).toMatchObject({ refreshing: false, error: 'timeout' });
      expect(inst.statsAt).toEqual(expect.any(String));
      expect(inst.indexers.find((i: { id: number }) => i.id === 7).stats.failedQueries).toBe(5);
    } finally {
      prowlarr.statsFail = false;
    }
  });

  it('tests an indexer', async () => {
    expect((await call(admin, 'POST', `/api/indexers/${ids.prowlarr}/8/test`)).json()).toEqual({
      ok: true,
      message: null,
    });
    expect((await call(viewer, 'POST', `/api/indexers/${ids.prowlarr}/8/test`)).statusCode).toBe(403);
  });
});
