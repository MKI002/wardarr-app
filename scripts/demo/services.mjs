// Mock services for the public demo. The demo data is captured from a real
// Wardarr server that talks to these mocks (see capture.mjs), so the demo
// shows exactly what the app would show.
//
// Films are real public-domain titles (see docs/demo.md for how their status
// was checked); everything else (series, users, hosts, keys, indexers,
// albums) is invented.
import http from 'node:http';
import { createProfileStore } from '../../apps/e2e/mocks/profiles.mjs';
import { DEMO_DISKS } from './disks.mjs';
import { createTdarr } from './tdarr.mjs';
import { DEMO_KEY, FILMS, SERIES } from './titles.mjs';

const PORT = Number(process.env.DEMO_MOCK_PORT ?? 19300);
const HOST = '127.0.0.1';
const NOW = Date.now();
const ago = (minutes) => new Date(NOW - minutes * 60_000).toISOString();
const film = (key) => FILMS.find((f) => f.key === key);
const series = (key) => SERIES.find((s) => s.key === key);

function json(res, body, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
function text(res, body, status = 200, headers = {}) {
  res.writeHead(status, { 'content-type': 'text/plain', ...headers });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : null);
      } catch {
        resolve(null);
      }
    });
  });
}
const paged = (records) => ({ page: 1, pageSize: 250, totalRecords: records.length, records });

// ------------------------------------------------------------------ *arr apps

const INDEXER_DOWN = 'Indexers unavailable due to failures for more than 6 hours: Nightjar (Prowlarr)';
const indexerHealth = (app) => [
  {
    source: 'IndexerLongTermStatusCheck',
    type: 'warning',
    message: INDEXER_DOWN,
    wikiUrl: `https://wiki.servarr.com/${app}/system#indexers-are-unavailable-due-to-failures`,
  },
];

const radarrMovie = (f, id, hasFile) => ({
  id,
  title: f.title,
  year: f.year,
  tmdbId: f.tmdbId,
  hasFile,
  monitored: true,
  isAvailable: true,
  tags: [],
  qualityProfileId: 1,
  digitalRelease: `${f.year}-03-01T00:00:00Z`,
});

const RADARR_MOVIES = FILMS.map((f, i) => radarrMovie(f, 101 + i, f.inLibrary));
// The 4K library is still being filled: only two films have a file.
const RADARR_4K_MOVIES = FILMS.map((f, i) => radarrMovie(f, 201 + i, f.key === 'nosferatu'));

const radarr4kQueue = () => {
  const intolerance = RADARR_4K_MOVIES.find((m) => m.title === film('intolerance').title);
  const moon = RADARR_4K_MOVIES.find((m) => m.title === film('moon').title);
  return [
    {
      id: 41,
      title: 'Intolerance.1916.Restored.2160p.WEB.H265',
      status: 'completed',
      trackedDownloadStatus: 'warning',
      trackedDownloadState: 'failed',
      downloadId: 'DEMOFAIL0001',
      movieId: intolerance.id,
      movie: intolerance,
      size: 31_400_000_000,
      sizeleft: 0,
      protocol: 'torrent',
      downloadClient: 'qBittorrent',
      added: ago(300),
      statusMessages: [{ title: 'Intolerance.1916.Restored.2160p.WEB.H265', messages: ['Download failed'] }],
    },
    {
      id: 42,
      title: 'A.Trip.to.the.Moon.1902.Hand.Colored.2160p.WEB',
      status: 'completed',
      trackedDownloadStatus: 'warning',
      trackedDownloadState: 'importBlocked',
      downloadId: 'DEMOIMPORT01',
      movieId: moon.id,
      movie: moon,
      size: 2_100_000_000,
      sizeleft: 0,
      protocol: 'torrent',
      downloadClient: 'qBittorrent',
      added: ago(180),
      statusMessages: [
        {
          title: 'A.Trip.to.the.Moon.1902.Hand.Colored.2160p.WEB',
          messages: ['Found matching movie via grab history, but release was matched to movie by ID'],
        },
      ],
    },
  ];
};

const lanternfall = series('lanternfall');
const kestrel = series('kestrel');
const sonarrSeries = [
  {
    id: 11,
    title: lanternfall.title,
    year: lanternfall.year,
    monitored: true,
    tags: [],
    qualityProfileId: 1,
  },
  { id: 12, title: kestrel.title, year: kestrel.year, monitored: true, tags: [], qualityProfileId: 1 },
  {
    id: 13,
    title: series('salt').title,
    year: series('salt').year,
    monitored: true,
    tags: [],
    qualityProfileId: 1,
  },
];
const episode = (id, s, season, ep, minutesAgo) => ({
  id,
  seriesId: s.id,
  seasonNumber: season,
  episodeNumber: ep,
  monitored: true,
  hasFile: false,
  airDateUtc: ago(minutesAgo),
  series: s,
});
const SONARR_MISSING = [
  episode(1201, sonarrSeries[1], 1, 4, 60 * 24 * 2),
  episode(1202, sonarrSeries[1], 1, 5, 60 * 24 * 9),
  episode(1203, sonarrSeries[1], 1, 6, 60 * 24 * 16),
  episode(1101, sonarrSeries[0], 2, 3, 60 * 24 * 1),
];
const sonarrQueue = () => [
  {
    id: 51,
    title: 'Lanternfall.S02E01.1080p.WEB.H264',
    status: 'downloading',
    trackedDownloadStatus: 'ok',
    trackedDownloadState: 'downloading',
    downloadId: `${'D3M0'.repeat(9)}0000`,
    seriesId: 11,
    episodeId: 1102,
    series: sonarrSeries[0],
    episode: { id: 1102, seasonNumber: 2, episodeNumber: 1, hasFile: false },
    size: 2_300_000_000,
    sizeleft: 850_000_000,
    protocol: 'torrent',
    downloadClient: 'qBittorrent',
    added: ago(25),
  },
  {
    id: 52,
    title: 'Lanternfall.S02E02.1080p.WEB.H264',
    status: 'downloading',
    trackedDownloadStatus: 'ok',
    trackedDownloadState: 'downloading',
    downloadId: 'SABnzbd_nzo_demo0001',
    seriesId: 11,
    episodeId: 1103,
    series: sonarrSeries[0],
    episode: { id: 1103, seasonNumber: 2, episodeNumber: 2, hasFile: false },
    size: 2_250_000_000,
    sizeleft: 1_900_000_000,
    protocol: 'usenet',
    downloadClient: 'SABnzbd',
    added: ago(12),
  },
  {
    id: 53,
    title: 'Kestrel.Station.S01E03.1080p.WEB.H264',
    status: 'completed',
    trackedDownloadStatus: 'warning',
    trackedDownloadState: 'failed',
    downloadId: 'D3M0D3M0D3M0D3M0D3M0D3M0D3M0D3M0D3M00053',
    seriesId: 12,
    episodeId: 1200,
    series: sonarrSeries[1],
    episode: { id: 1200, seasonNumber: 1, episodeNumber: 3, hasFile: false },
    size: 1_900_000_000,
    sizeleft: 0,
    protocol: 'torrent',
    downloadClient: 'qBittorrent',
    added: ago(95),
    statusMessages: [
      {
        title: 'Kestrel.Station.S01E03.1080p.WEB.H264',
        messages: ['Download failed: the torrent has no seeders'],
      },
    ],
  },
  {
    id: 54,
    title: 'The.Salt.Archive.S02E06.1080p.WEB.H264',
    status: 'downloading',
    trackedDownloadStatus: 'warning',
    trackedDownloadState: 'downloading',
    downloadId: 'D3M0D3M0D3M0D3M0D3M0D3M0D3M0D3M0D3M00054',
    seriesId: 13,
    episodeId: 1306,
    series: sonarrSeries[2],
    episode: { id: 1306, seasonNumber: 2, episodeNumber: 6, hasFile: false },
    size: 1_700_000_000,
    sizeleft: 1_450_000_000,
    protocol: 'torrent',
    downloadClient: 'qBittorrent',
    added: ago(60 * 9),
    statusMessages: [
      {
        title: 'The.Salt.Archive.S02E06.1080p.WEB.H264',
        messages: ['The download is stalled with no connections'],
      },
    ],
  },
];

const LIDARR_QUEUE = [
  ['The Lamplighters', 'Night Shift', 'usenet'],
  ['The Lamplighters', 'Harbour Songs', 'torrent'],
  ['Marrow & Pine', 'Low Tide', 'torrent'],
].map(([artist, album, protocol], i) => ({
  id: 61 + i,
  title: `${artist}-${album}`,
  status: 'completed',
  trackedDownloadStatus: 'warning',
  trackedDownloadState: 'failed',
  downloadId: `DEMOALBUM00${i + 1}`,
  albumId: 301 + i,
  artistId: 31,
  size: 420_000_000,
  sizeleft: 0,
  protocol,
  downloadClient: protocol === 'usenet' ? 'SABnzbd' : 'qBittorrent',
  added: ago(600 + i * 30),
  statusMessages: [{ title: `${artist}-${album}`, messages: ['Download failed'] }],
}));

// ------------------------------------------------------------- calendars

const DAY_MS = 86_400_000;
/** A time `days` from now at a fixed hour (UTC), like a weekly air slot. */
const slot = (days, hour) => {
  const d = new Date(NOW + days * DAY_MS);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};
const dayAt = (days) => `${slot(days, 0).slice(0, 10)}T00:00:00Z`;
const tmdbImages = (poster) => [
  { coverType: 'poster', remoteUrl: `https://image.tmdb.org/t/p/original/${poster}.jpg` },
];

// Episode titles are invented, like the series.
const EPISODES = {
  lanternfall: [
    'The Keeper’s Log',
    'Low Water',
    'Signal Fires',
    'The Northern Light',
    'Salt and Glass',
    'A Map of Shoals',
    'Fog Bell',
    'The Last Lamp',
  ],
  kestrel: [
    'Station Zero',
    'Pressure Front',
    'Isobars',
    'Whiteout',
    'The Long Night Shift',
    'Static',
    'Eye of the Storm',
    'Barometer',
    'Clear Skies',
    'Calm',
  ],
  salt: ['Water Damage', 'Ledger', 'The Drowned Bell', 'Index Cards', 'Tidemark', 'Dated Next Week'],
};

function calendarEpisode(s, show, season, ep, days, hour, hasFile, extra = {}) {
  const t = series(show);
  return {
    id: s.id * 1000 + season * 100 + ep,
    seriesId: s.id,
    seasonNumber: season,
    episodeNumber: ep,
    title: EPISODES[show][ep - 1],
    airDateUtc: slot(days, hour),
    runtime: show === 'kestrel' ? 42 : 52,
    hasFile,
    monitored: true,
    series: { ...s, network: 'Northlight', runtime: 50, tmdbId: t.tmdbId, images: tmdbImages(t.poster) },
    ...extra,
  };
}

const SONARR_CALENDAR = [
  calendarEpisode(sonarrSeries[0], 'lanternfall', 2, 1, -15, 20, true, {
    overview: 'The lights go dark again.',
  }),
  calendarEpisode(sonarrSeries[0], 'lanternfall', 2, 2, -8, 20, true),
  calendarEpisode(sonarrSeries[0], 'lanternfall', 2, 3, -1, 20, false),
  calendarEpisode(sonarrSeries[0], 'lanternfall', 2, 4, 6, 20, false),
  calendarEpisode(sonarrSeries[0], 'lanternfall', 2, 5, 13, 20, false),
  calendarEpisode(sonarrSeries[0], 'lanternfall', 2, 6, 20, 20, false),
  calendarEpisode(sonarrSeries[0], 'lanternfall', 2, 7, 27, 20, false),
  calendarEpisode(sonarrSeries[1], 'kestrel', 1, 4, -2, 2, false),
  calendarEpisode(sonarrSeries[1], 'kestrel', 1, 5, 0, 21, false),
  calendarEpisode(sonarrSeries[1], 'kestrel', 1, 6, 1, 2, false),
  calendarEpisode(sonarrSeries[1], 'kestrel', 1, 7, 5, 2, false),
  calendarEpisode(sonarrSeries[1], 'kestrel', 1, 8, 12, 2, false),
  calendarEpisode(sonarrSeries[1], 'kestrel', 1, 9, 19, 2, false),
  calendarEpisode(sonarrSeries[1], 'kestrel', 1, 10, 26, 2, false, { finaleType: 'season' }),
  calendarEpisode(sonarrSeries[2], 'salt', 3, 1, 3, 19, false),
  calendarEpisode(sonarrSeries[2], 'salt', 3, 2, 3, 20, false),
  calendarEpisode(sonarrSeries[2], 'salt', 3, 3, 10, 19, false),
  calendarEpisode(sonarrSeries[2], 'salt', 3, 4, 17, 19, false),
];
// The 4K Sonarr only follows Lanternfall; its entries merge with the HD ones.
const SONARR_4K_CALENDAR = SONARR_CALENDAR.filter((e) => e.seriesId === sonarrSeries[0].id).map((e) => ({
  ...e,
  id: e.id + 50_000,
  hasFile: e.episodeNumber === 1,
}));

/** Restored editions of the public-domain films come out on disc and online. */
const calendarMovie = (m, key, dates) => ({
  ...m,
  runtime: { nosferatu: 94, intolerance: 163, nanook: 79, moon: 14, train: 12 }[key],
  studio: 'Archive Restorations',
  overview: film(key).overview,
  images: tmdbImages(film(key).poster),
  ...dates,
});
const RADARR_CALENDAR = [
  calendarMovie(RADARR_MOVIES[0], 'nosferatu', { physicalRelease: dayAt(4), digitalRelease: dayAt(-3) }),
  calendarMovie(RADARR_MOVIES[3], 'intolerance', { digitalRelease: dayAt(11) }),
  calendarMovie(RADARR_MOVIES[4], 'nanook', { inCinemas: dayAt(2), physicalRelease: dayAt(23) }),
];
const RADARR_4K_CALENDAR = [
  calendarMovie(RADARR_4K_MOVIES[0], 'nosferatu', { physicalRelease: dayAt(4) }),
  calendarMovie(RADARR_4K_MOVIES[1], 'moon', { physicalRelease: dayAt(9) }),
];

const LIDARR_CALENDAR = [
  ['The Lamplighters', 'Lantern Hours', 6, 'Album', 2_700_000],
  ['Marrow & Pine', 'Cedar Lines', 15, 'EP', 1_380_000],
  ['The Lamplighters', 'Harbour Songs (Live)', -4, 'Album', 3_120_000],
].map(([artistName, title, days, albumType, duration], i) => ({
  id: 401 + i,
  title,
  releaseDate: dayAt(days),
  albumType,
  duration,
  monitored: true,
  artist: { artistName },
  statistics: { percentOfTracks: days < 0 ? 100 : 0 },
}));

/** Calendar entries whose date falls between `start` and `end`. */
function inRange(list, url, dates) {
  const start = Date.parse(url.searchParams.get('start') ?? '') || 0;
  const end = Date.parse(url.searchParams.get('end') ?? '') || Infinity;
  return list.filter((e) =>
    dates.some((f) => e[f] && Date.parse(e[f]) >= start - DAY_MS && Date.parse(e[f]) <= end),
  );
}

// ------------------------------------------------------------------ disks

const SYSTEM_MOUNTS = [
  { path: '/', label: '', freeSpace: DEMO_DISKS.system.freeBytes, totalSpace: DEMO_DISKS.system.totalBytes },
  {
    path: '/config',
    label: '',
    freeSpace: DEMO_DISKS.system.freeBytes,
    totalSpace: DEMO_DISKS.system.totalBytes,
  },
  {
    path: '/etc/hosts',
    label: '',
    freeSpace: DEMO_DISKS.system.freeBytes,
    totalSpace: DEMO_DISKS.system.totalBytes,
  },
];
const mount = (path, disk) => ({
  path,
  label: '',
  freeSpace: DEMO_DISKS[disk].freeBytes,
  totalSpace: DEMO_DISKS[disk].totalBytes,
});
const folder = (path, disk, withTotal = false) => ({
  id: 1,
  path,
  accessible: true,
  freeSpace: DEMO_DISKS[disk].freeBytes,
  ...(withTotal ? { totalSpace: DEMO_DISKS[disk].totalBytes } : {}),
  unmappedFolders: [],
});
const STORAGE = {
  sonarr: { disks: [...SYSTEM_MOUNTS, mount('/data', 'data')], folders: [folder('/data/media/tv', 'data')] },
  'sonarr-4k': {
    disks: [...SYSTEM_MOUNTS, mount('/uhd', 'uhd')],
    folders: [folder('/uhd/media/tv-4k', 'uhd')],
  },
  radarr: {
    disks: [...SYSTEM_MOUNTS, mount('/data', 'data')],
    folders: [folder('/data/media/movies', 'data')],
  },
  'radarr-4k': {
    disks: [...SYSTEM_MOUNTS, mount('/uhd', 'uhd')],
    folders: [folder('/uhd/media/movies-4k', 'uhd')],
  },
  lidarr: {
    disks: [...SYSTEM_MOUNTS, mount('/data', 'data')],
    folders: [folder('/data/media/music', 'data', true)],
  },
};

const ARR = {
  sonarr: {
    api: '/api/v3',
    appName: 'Sonarr',
    version: '4.0.15.2941',
    health: () => [],
    queue: sonarrQueue,
    wanted: { missing: SONARR_MISSING, cutoff: [] },
    calendar: (url) => inRange(SONARR_CALENDAR, url, ['airDateUtc']),
  },
  'sonarr-4k': {
    api: '/api/v3',
    appName: 'Sonarr',
    version: '4.0.15.2941',
    health: () => [],
    queue: () => [],
    wanted: { missing: [], cutoff: [] },
    calendar: (url) => inRange(SONARR_4K_CALENDAR, url, ['airDateUtc']),
  },
  radarr: {
    api: '/api/v3',
    appName: 'Radarr',
    version: '5.26.2.10099',
    health: () => indexerHealth('radarr'),
    queue: () => [],
    movies: RADARR_MOVIES,
    calendar: (url) => inRange(RADARR_CALENDAR, url, ['inCinemas', 'digitalRelease', 'physicalRelease']),
  },
  'radarr-4k': {
    api: '/api/v3',
    appName: 'Radarr',
    version: '5.26.2.10099',
    health: () => [],
    queue: radarr4kQueue,
    movies: RADARR_4K_MOVIES,
    calendar: (url) => inRange(RADARR_4K_CALENDAR, url, ['inCinemas', 'digitalRelease', 'physicalRelease']),
  },
  lidarr: {
    api: '/api/v1',
    appName: 'Lidarr',
    version: '2.13.3.4711',
    health: () => [
      {
        source: 'UpdateCheck',
        type: 'warning',
        message: 'New update is available: 2.14.1.4800',
        wikiUrl: 'https://wiki.servarr.com/lidarr/system#new-update-is-available',
      },
    ],
    queue: () => LIDARR_QUEUE,
    wanted: { missing: [], cutoff: [] },
    calendar: (url) => inRange(LIDARR_CALENDAR, url, ['releaseDate']),
  },
};

/** Custom formats, quality profiles, sizes and naming for the TRaSH Guides tab. */
const PROFILES = {
  sonarr: createProfileStore('sonarr', ['HD-1080p', 'Any']),
  'sonarr-4k': createProfileStore('sonarr', ['Ultra HD', 'Any']),
  radarr: createProfileStore('radarr', ['HD-1080p', 'Any']),
  'radarr-4k': createProfileStore('radarr', ['Ultra HD', 'Any']),
};
const PROFILE_PATH = /^\/(customformat|qualityprofile|qualitydefinition|config\/naming|language|parse)(\/|$)/;

/** Changes a score by hand, as if someone edited it in the service. */
function profileDrift(prefix, res) {
  const profile = PROFILES[prefix]?.state.profiles.find((p) => p.formatItems.some((f) => f.score));
  const item = profile?.formatItems.find((f) => f.score);
  if (item) item.score += 25;
  return json(res, { changed: Boolean(item) });
}
// --------------------------------------------------------------- stack map
// What the services report about each other: download clients, folders and
// disks. Host names are invented container names, so Wardarr has to match
// them by name and product, as it would behind Docker.

// The download folder lies on the shared media disk of the demo (disks.mjs).
const DATA_TOTAL = DEMO_DISKS.data.totalBytes;
const DATA_FREE = DEMO_DISKS.data.freeBytes;
const GIB = 1024 ** 3;
const client = (id, name, implementation, host, port, enable = true) => ({
  id,
  name,
  implementation,
  enable,
  protocol: implementation === 'Sabnzbd' ? 'usenet' : 'torrent',
  fields: [
    { name: 'host', value: host },
    { name: 'port', value: port },
    { name: 'useSsl', value: false },
    { name: 'urlBase', value: '' },
  ],
});
const QBIT = client(1, 'qBittorrent', 'QBittorrent', 'qbittorrent', 8080);
const SAB = client(2, 'SABnzbd', 'Sabnzbd', 'sabnzbd', 8080);
const JELLYFIN_HOOK = {
  id: 1,
  name: 'Jellyfin',
  implementation: 'MediaBrowser',
  onDownload: true,
  onUpgrade: true,
  fields: [
    { name: 'host', value: 'jellyfin' },
    { name: 'port', value: 8096 },
    { name: 'useSsl', value: false },
  ],
};
const STACK = {
  sonarr: { clients: [QBIT, SAB], hooks: [JELLYFIN_HOOK], root: '/data/media/tv' },
  'sonarr-4k': { clients: [QBIT], hooks: [], root: '/uhd/media/tv-4k' },
  radarr: { clients: [QBIT, SAB], hooks: [JELLYFIN_HOOK], root: '/data/media/movies' },
  'radarr-4k': { clients: [QBIT], hooks: [JELLYFIN_HOOK], root: '/uhd/media/movies-4k' },
  // Lidarr also knows a Deluge client that is not connected to Wardarr.
  lidarr: {
    clients: [SAB, client(3, 'Deluge', 'Deluge', 'deluge', 8112)],
    hooks: [],
    root: '/data/media/music',
  },
};

async function arr(prefix, path, url, req, res) {
  const svc = ARR[prefix];
  if (!svc || !path.startsWith(svc.api)) return json(res, {}, 404);
  const p = path.slice(svc.api.length);
  if (PROFILES[prefix] && PROFILE_PATH.test(p)) {
    const body = req.method === 'POST' || req.method === 'PUT' ? await readBody(req) : null;
    const answer = PROFILES[prefix].handle(req.method, p, url, body);
    return answer ? json(res, answer.body, answer.status) : json(res, {}, 404);
  }
  if (req.method !== 'GET') {
    await readBody(req);
    if (p === '/command') return json(res, { id: 1, name: 'Command', status: 'queued' }, 201);
    return json(res, {});
  }
  if (p === '/system/status') return json(res, { version: svc.version, appName: svc.appName });
  if (p === '/health') return json(res, svc.health());
  if (p === '/diskspace') return json(res, STORAGE[prefix]?.disks ?? []);
  if (p === '/rootfolder') return json(res, STORAGE[prefix]?.folders ?? []);
  if (p === '/queue') return json(res, paged(svc.queue()));
  if (p === '/tag') return json(res, [{ id: 1, label: 'wardarr-keep' }]);
  if (p === '/qualityprofile')
    return json(res, [
      { id: 1, name: 'Lossless' },
      { id: 2, name: 'Any' },
    ]);
  if (p === '/movie') return json(res, svc.movies ?? []);
  if (p === '/series') return json(res, sonarrSeries);
  if (p === '/wanted/missing') return json(res, paged(svc.wanted?.missing ?? []));
  if (p === '/wanted/cutoff') return json(res, paged(svc.wanted?.cutoff ?? []));
  if (p === '/history/since') return json(res, []);
  if (p === '/downloadclient') return json(res, STACK[prefix]?.clients ?? []);
  if (p === '/notification') return json(res, STACK[prefix]?.hooks ?? []);
  if (p === '/calendar') return json(res, svc.calendar?.(url) ?? []);
  if (p === '/config/host') return json(res, { port: 8989, urlBase: '', apiKey: DEMO_KEY });
  if (p === '/manualimport') {
    if (url.searchParams.get('downloadId') !== 'DEMOIMPORT01') return json(res, []);
    const moon = RADARR_4K_MOVIES.find((m) => m.title === film('moon').title);
    return json(res, [
      {
        path: '/downloads/A.Trip.to.the.Moon.1902.Hand.Colored.2160p.WEB/trip.to.the.moon.1902.mkv',
        name: 'trip.to.the.moon.1902',
        folderName: 'A.Trip.to.the.Moon.1902.Hand.Colored.2160p.WEB',
        movie: { id: moon.id, title: moon.title, year: moon.year },
        quality: { quality: { id: 19, name: 'WEBDL-2160p' } },
        languages: [{ id: 1, name: 'English' }],
        rejections: [],
      },
    ]);
  }
  return json(res, {}, 404);
}

// ------------------------------------------------------------------ Prowlarr

const INDEXERS = [
  { id: 1, name: 'Lantern', enable: true, protocol: 'torrent', priority: 25 },
  { id: 2, name: 'Nightjar', enable: true, protocol: 'torrent', priority: 25 },
  { id: 3, name: 'Harbor Light', enable: true, protocol: 'usenet', priority: 20 },
  { id: 4, name: 'Old Mill', enable: false, protocol: 'torrent', priority: 50 },
];

function prowlarr(path, req, res) {
  const one = path.match(/^\/api\/v1\/indexer\/(\d+)$/);
  if (one) return json(res, INDEXERS.find((i) => i.id === Number(one[1])) ?? {});
  if (path === '/api/v1/indexer/test')
    return json(res, [{ errorMessage: 'Unable to connect to indexer' }], 400);
  if (path === '/api/v1/system/status') return json(res, { version: '2.0.5.5160', appName: 'Prowlarr' });
  if (path === '/api/v1/health') return json(res, []);
  if (path === '/api/v1/indexer') return json(res, INDEXERS);
  if (path === '/api/v1/indexerstats')
    return json(res, {
      indexers: [
        [1, 'Lantern', 1840, 212, 9, 1, 310],
        [2, 'Nightjar', 960, 41, 388, 3, 2900],
        [3, 'Harbor Light', 1215, 167, 14, 0, 520],
        [4, 'Old Mill', 0, 0, 0, 0, 0],
      ].map(([indexerId, indexerName, q, g, fq, fg, ms]) => ({
        indexerId,
        indexerName,
        numberOfQueries: q,
        numberOfGrabs: g,
        numberOfFailedQueries: fq,
        numberOfFailedGrabs: fg,
        averageResponseTime: ms,
      })),
    });
  if (path === '/api/v1/applications')
    return json(res, [
      ...[
        ['Sonarr', 'Sonarr', 'fullSync', 'http://sonarr:8989'],
        ['Radarr', 'Radarr', 'fullSync', 'http://radarr:7878'],
        ['Radarr 4K', 'Radarr', 'fullSync', 'http://radarr-4k:7878'],
        ['Lidarr', 'Lidarr', 'addOnly', 'http://lidarr:8686'],
      ].map(([name, implementation, syncLevel, baseUrl], i) => ({
        id: i + 1,
        name,
        implementation,
        syncLevel,
        tags: [],
        fields: [{ name: 'baseUrl', value: baseUrl }],
      })),
    ]);
  if (path === '/api/v1/indexerstatus')
    return json(res, [{ indexerId: 2, disabledTill: '2099-01-01T00:00:00Z', mostRecentFailure: ago(400) }]);
  return json(res, {}, 404);
}

// --------------------------------------------------------------- downloaders

const TORRENTS = [
  ['Lanternfall.S02E01.1080p.WEB.H264', 'downloading', 0.63, 2_300_000_000, 12_400_000, 74, 'tv-sonarr', 25],
  [
    'The.Great.Train.Robbery.1903.Restored.1080p.BluRay',
    'downloading',
    0.18,
    1_400_000_000,
    6_100_000,
    190,
    'radarr',
    8,
  ],
  ['Lanternfall.S02E03.1080p.WEB.H264', 'queuedDL', 0, 2_200_000_000, 0, 8_640_000, 'tv-sonarr', 3],
  ['Nosferatu.1922.Restored.2160p.WEB.H265', 'stalledUP', 1, 24_800_000_000, 0, 8_640_000, 'radarr-4k', 2880],
  ['Intolerance.1916.Restored.2160p.WEB.H265', 'error', 0.41, 31_400_000_000, 0, 8_640_000, 'radarr-4k', 300],
  [
    'A.Trip.to.the.Moon.1902.Hand.Colored.2160p.WEB',
    'pausedUP',
    1,
    2_100_000_000,
    0,
    8_640_000,
    'radarr-4k',
    180,
  ],
].map(([name, state, progress, size, dlspeed, eta, category, minutesAgo], i) => ({
  hash: `${'d3m0'.repeat(9)}${String(i).padStart(4, '0')}`,
  name,
  state,
  progress,
  size,
  downloaded: Math.round(size * progress),
  dlspeed,
  eta,
  category,
  tags: '',
  added_on: Math.floor((NOW - minutesAgo * 60_000) / 1000),
}));

function qbittorrent(path, res) {
  if (path === '/api/v2/auth/login')
    return text(res, 'Ok.', 200, { 'set-cookie': 'SID=demo-session; path=/' });
  if (path === '/api/v2/app/version') return text(res, 'v5.1.2');
  if (path === '/api/v2/app/webapiVersion') return text(res, '2.11.4');
  if (path === '/api/v2/torrents/info') return json(res, TORRENTS);
  if (path === '/api/v2/torrents/delete') return text(res, '');
  if (path === '/api/v2/app/defaultSavePath') return text(res, '/data/torrents');
  if (path === '/api/v2/sync/maindata')
    return json(res, { rid: 1, server_state: { free_space_on_disk: DATA_FREE } });
  return json(res, {}, 404);
}

function sabnzbd(url, res) {
  const mode = url.searchParams.get('mode');
  if (mode === 'version') return json(res, { version: '4.5.3' });
  if (mode === 'warnings') return json(res, { warnings: [] });
  if (mode === 'get_config')
    return json(res, {
      config: { misc: { complete_dir: '/data/usenet/complete', download_dir: '/data/usenet/incomplete' } },
    });
  if (mode === 'queue')
    return json(res, {
      queue: {
        diskspace1: (DATA_FREE / GIB).toFixed(2),
        diskspacetotal1: (DATA_TOTAL / GIB).toFixed(2),
        diskspace2: (DATA_FREE / GIB).toFixed(2),
        diskspacetotal2: (DATA_TOTAL / GIB).toFixed(2),
        kbpersec: '41250',
        paused: false,
        slots: [
          {
            nzo_id: 'SABnzbd_nzo_demo0001',
            filename: 'Lanternfall.S02E02.1080p.WEB.H264',
            status: 'Downloading',
            percentage: '16',
            mb: '2145.8',
            mbleft: '1802.5',
            timeleft: '0:00:44',
            cat: 'tv',
          },
          {
            nzo_id: 'SABnzbd_nzo_demo0002',
            filename: 'Kestrel.Station.S01E04.1080p.WEB.H264',
            status: 'Queued',
            percentage: '0',
            mb: '1980.2',
            mbleft: '1980.2',
            timeleft: '0:00:00',
            cat: 'tv',
          },
        ],
      },
    });
  return json(res, {});
}

// ------------------------------------------------------------------ Jellyfin

const TICKS = 10_000;
const SESSIONS = [
  {
    Id: 'session-1',
    UserName: 'Mira',
    Client: 'Jellyfin Web',
    DeviceName: 'Living room TV',
    PlayMethod: 'DirectPlay',
    PlayState: { PositionTicks: 41 * 60_000 * TICKS, IsPaused: false },
    NowPlayingItem: {
      Name: film('nosferatu').title,
      Type: 'Movie',
      RunTimeTicks: 94 * 60_000 * TICKS,
      Height: 1080,
    },
  },
  {
    Id: 'session-2',
    UserName: 'Jonas',
    Client: 'Jellyfin Android',
    DeviceName: 'Phone',
    PlayMethod: 'Transcode',
    TranscodingInfo: { IsVideoDirect: false, IsAudioDirect: true },
    PlayState: { PositionTicks: 12 * 60_000 * TICKS, IsPaused: true },
    NowPlayingItem: {
      Name: 'The Long Watch',
      SeriesName: lanternfall.title,
      Type: 'Episode',
      ParentIndexNumber: 1,
      IndexNumber: 3,
      RunTimeTicks: 52 * 60_000 * TICKS,
      Height: 720,
    },
  },
  {
    Id: 'session-3',
    UserName: 'Demo',
    Client: 'Jellyfin Media Player',
    DeviceName: 'Desk',
    PlayMethod: 'DirectPlay',
    PlayState: { PositionTicks: 6 * 60_000 * TICKS, IsPaused: false },
    NowPlayingItem: {
      Name: film('moon').title,
      Type: 'Movie',
      RunTimeTicks: 13 * 60_000 * TICKS,
      Height: 2160,
    },
  },
];
const LIBRARIES = [
  {
    Name: 'Films',
    CollectionType: 'movies',
    ItemId: 'lib-films',
    Locations: ['/media/movies', '/media/movies-4k'],
  },
  { Name: 'Series', CollectionType: 'tvshows', ItemId: 'lib-series', Locations: ['/media/tv'] },
];
const media = (size, height, codec) => ({
  MediaSources: [{ Size: size, MediaStreams: [{ Type: 'Video', Height: height, Codec: codec }] }],
});
const repeat = (n, make) => Array.from({ length: n }, (_, i) => make(i));
const ITEMS = {
  'lib-films:Movie': [
    ...repeat(6, () => media(22e9, 2160, 'hevc')),
    ...repeat(31, (i) => media(6e9 + i * 1e8, 1080, i % 3 ? 'h264' : 'hevc')),
    ...repeat(9, () => media(1.4e9, 720, 'h264')),
    ...repeat(4, () => media(7e8, 480, 'mpeg2video')),
  ],
  'lib-series:Series': repeat(7, () => ({})),
  'lib-series:Episode': [
    ...repeat(118, (i) => media(1.6e9 + (i % 5) * 1e8, 1080, i % 4 ? 'h264' : 'hevc')),
    ...repeat(46, () => media(7e8, 720, 'h264')),
    ...repeat(12, () => media(5.2e9, 2160, 'hevc')),
  ],
};

function jellyfin(path, url, res) {
  if (path === '/System/Info') return json(res, { Version: '10.10.7', ProductName: 'Jellyfin Server' });
  if (path === '/Sessions') return json(res, SESSIONS);
  if (path === '/Library/VirtualFolders') return json(res, LIBRARIES);
  if (path === '/Items') {
    const list =
      ITEMS[`${url.searchParams.get('ParentId')}:${url.searchParams.get('IncludeItemTypes')}`] ?? [];
    const start = Number(url.searchParams.get('StartIndex') ?? 0);
    const limit = Number(url.searchParams.get('Limit') ?? 100);
    return json(res, {
      TotalRecordCount: list.length,
      Items: limit === 0 ? [] : list.slice(start, start + limit),
    });
  }
  return json(res, {}, 404);
}

// --------------------------------------------------------------------- Seerr

const TITLES = [
  ...FILMS.map((f) => ({
    id: f.tmdbId,
    mediaType: 'movie',
    title: f.title,
    releaseDate: `${f.year}-01-01`,
    overview: f.overview,
    voteAverage: f.rating,
    posterPath: `/${f.poster}.jpg`,
    status: f.seerr,
  })),
  ...SERIES.map((s) => ({
    id: s.tmdbId,
    mediaType: 'tv',
    name: s.title,
    firstAirDate: `${s.year}-02-01`,
    overview: s.overview,
    voteAverage: s.rating,
    posterPath: `/${s.poster}.jpg`,
    status: s.seerr,
    seasons: s.seasons,
  })),
];
const SEERR_USERS = [
  { id: 1, displayName: 'Demo Admin', username: 'demo', jellyfinUsername: 'Demo' },
  { id: 2, displayName: 'Mira', jellyfinUsername: 'Mira' },
  { id: 3, displayName: 'Jonas', jellyfinUsername: 'Jonas' },
];
const SERVERS = {
  radarr: [
    {
      id: 0,
      name: 'Radarr',
      is4k: false,
      isDefault: true,
      activeProfileId: 1,
      activeDirectory: '/data/films',
    },
    {
      id: 1,
      name: 'Radarr 4K',
      is4k: true,
      isDefault: true,
      activeProfileId: 1,
      activeDirectory: '/data/films-uhd',
    },
  ],
  sonarr: [
    {
      id: 0,
      name: 'Sonarr',
      is4k: false,
      isDefault: true,
      activeProfileId: 1,
      activeDirectory: '/data/series',
    },
    {
      id: 1,
      name: 'Sonarr 4K',
      is4k: true,
      isDefault: true,
      activeProfileId: 1,
      activeDirectory: '/data/series-uhd',
    },
  ],
};
const byKey = (key) => {
  const f = FILMS.find((x) => x.key === key);
  if (f) return { mediaType: 'movie', tmdbId: f.tmdbId };
  const s = SERIES.find((x) => x.key === key);
  return { mediaType: 'tv', tmdbId: s.tmdbId };
};
const REQUESTS = [
  [9, 'nanook', 1, 3, false, [], 35],
  [8, 'kestrel', 2, 2, false, [1], 160],
  [7, 'intolerance', 2, 1, true, [], 300],
  [6, 'lanternfall', 2, 3, false, [2], 60 * 26],
  [5, 'train', 2, 2, false, [], 60 * 50],
  [4, 'nanook', 3, 2, true, [], 60 * 24 * 3],
  [3, 'salt', 5, 2, false, [1, 2], 60 * 24 * 6],
  [2, 'nosferatu', 5, 1, false, [], 60 * 24 * 12],
  [1, 'moon', 4, 3, true, [], 60 * 24 * 15],
].map(([id, key, status, userId, is4k, seasons, minutesAgo]) => ({
  id,
  ...byKey(key),
  status,
  userId,
  is4k,
  seasons,
  createdAt: ago(minutesAgo),
  serverId: is4k ? 1 : 0,
}));

function seerrItem(t) {
  const { status, seasons: _s, ...rest } = t;
  return { ...rest, mediaInfo: status ? { status: status[0], status4k: status[1], seasons: [] } : undefined };
}
const seerrPage = (results) => ({
  page: 1,
  totalPages: 1,
  totalResults: results.length,
  results: results.map(seerrItem),
});
function asRequest(r) {
  const t = TITLES.find((x) => x.id === r.tmdbId);
  const user = SEERR_USERS.find((u) => u.id === r.userId);
  return {
    id: r.id,
    status: r.status,
    is4k: r.is4k,
    createdAt: r.createdAt,
    updatedAt: r.createdAt,
    serverId: r.serverId,
    profileId: 1,
    rootFolder: SERVERS[r.mediaType === 'movie' ? 'radarr' : 'sonarr'][r.serverId].activeDirectory,
    media: {
      mediaType: r.mediaType,
      tmdbId: r.tmdbId,
      status: t.status?.[0] ?? 1,
      status4k: t.status?.[1] ?? 1,
    },
    requestedBy: { id: user.id, displayName: user.displayName },
    seasons: r.seasons.map((n) => ({ seasonNumber: n })),
  };
}
const REQUEST_FILTERS = {
  pending: [1],
  approved: [2],
  processing: [2],
  available: [5],
  failed: [4],
  declined: [3],
};

async function seerr(path, url, req, res) {
  const p = path.replace(/^\/api\/v1/, '');
  if (req.method !== 'GET') await readBody(req);
  if (p === '/status') return json(res, { version: '2.7.3', updateAvailable: false });
  if (p === '/auth/me') return json(res, { id: 1 });
  const arrServer = (id, name, hostname, port, is4k) => ({
    id,
    name,
    hostname,
    port,
    useSsl: false,
    is4k,
    isDefault: true,
  });
  if (p === '/settings/radarr')
    return json(res, [
      arrServer(0, 'Radarr', 'radarr', 7878, false),
      arrServer(1, 'Radarr 4K', 'radarr-4k', 7878, true),
    ]);
  if (p === '/settings/sonarr')
    return json(res, [
      arrServer(0, 'Sonarr', 'sonarr', 8989, false),
      arrServer(1, 'Sonarr 4K', 'sonarr-4k', 8989, true),
    ]);
  if (p === '/settings/main') return json(res, { mediaServerType: 2 });
  if (p === '/settings/jellyfin')
    return json(res, { name: 'Jellyfin', ip: 'jellyfin', port: 8096, useSsl: false });
  if (p === '/discover/trending') return json(res, seerrPage(TITLES));
  if (p === '/discover/movies') return json(res, seerrPage(TITLES.filter((t) => t.mediaType === 'movie')));
  if (p === '/discover/tv') return json(res, seerrPage(TITLES.filter((t) => t.mediaType === 'tv')));
  if (p === '/search') {
    const q = (url.searchParams.get('query') ?? '').toLowerCase();
    return json(res, seerrPage(TITLES.filter((t) => (t.title ?? t.name).toLowerCase().includes(q))));
  }
  const detail = p.match(/^\/(movie|tv)\/(\d+)$/);
  if (detail) {
    const t = TITLES.find((x) => x.id === Number(detail[2]) && x.mediaType === detail[1]);
    if (!t) return json(res, {}, 404);
    return json(res, {
      ...seerrItem(t),
      externalIds: { tvdbId: t.mediaType === 'tv' ? t.id + 70000 : undefined },
      seasons: t.seasons?.map((s) => ({
        seasonNumber: s.n,
        name: `Season ${s.n}`,
        episodeCount: s.episodes,
      })),
      mediaInfo: t.status
        ? {
            status: t.status[0],
            status4k: t.status[1],
            seasons: (t.seasons ?? []).map((s) => ({ seasonNumber: s.n, status: s.status, status4k: 1 })),
          }
        : undefined,
    });
  }
  const service = p.match(/^\/service\/(radarr|sonarr)(?:\/(\d+))?$/);
  if (service) {
    const list = SERVERS[service[1]];
    if (service[2] === undefined) return json(res, list);
    const s = list.find((x) => x.id === Number(service[2]));
    return json(res, {
      server: s,
      profiles: [
        { id: 1, name: s?.is4k ? 'Ultra HD' : 'HD-1080p' },
        { id: 2, name: 'Any' },
      ],
      rootFolders: [{ id: 1, path: s?.activeDirectory }],
    });
  }
  if (p === '/user') return json(res, { pageInfo: { results: SEERR_USERS.length }, results: SEERR_USERS });
  if (p === '/request') {
    const filter = url.searchParams.get('filter') ?? 'all';
    const by = url.searchParams.get('requestedBy');
    const take = Number(url.searchParams.get('take') ?? 20);
    const skip = Number(url.searchParams.get('skip') ?? 0);
    const list = REQUESTS.filter(
      (r) => filter === 'all' || (REQUEST_FILTERS[filter] ?? []).includes(r.status),
    ).filter((r) => !by || r.userId === Number(by));
    return json(res, {
      pageInfo: { results: list.length },
      results: list.slice(skip, skip + take).map(asRequest),
    });
  }
  const one = p.match(/^\/request\/(\d+)/);
  if (one) {
    const r = REQUESTS.find((x) => x.id === Number(one[1]));
    return r ? json(res, asRequest(r)) : json(res, {}, 404);
  }
  return json(res, {}, 404);
}

// -------------------------------------------------------------------- server

const tdarr = createTdarr({ now: NOW });

http
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://mock.invalid');
    const [, prefix = '', ...rest] = url.pathname.split('/');
    const path = `/${rest.join('/')}`;
    if (prefix === '__ready') return json(res, { ok: true });
    if (prefix === '__drift') return profileDrift(rest[0], res);
    // Notification channels point here while the demo data is captured.
    if (prefix === 'hook' || prefix === 'ntfy') return readBody(req).then(() => json(res, {}));
    if (prefix === 'qbittorrent') return qbittorrent(path, res);
    if (prefix === 'sabnzbd') return sabnzbd(url, res);
    if (prefix === 'jellyfin') return jellyfin(path, url, res);
    if (prefix === 'prowlarr') return prowlarr(path, req, res);
    if (prefix === 'seerr') return seerr(path, url, req, res);
    if (prefix === 'tdarr') return tdarr(path, req, res);
    return arr(prefix, path, url, req, res);
  })
  .listen(PORT, HOST);
