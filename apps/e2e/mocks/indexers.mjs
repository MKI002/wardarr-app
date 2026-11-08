// Invented indexers for the e2e mocks and the demo: a Prowlarr with six
// sites, its apps, statistics for any time window and a grab history per
// *arr app. Everything is deterministic, so a demo capture changes little.
//
// The setup shows every case the indexer analysis knows:
// - Sonarr takes every indexer from Prowlarr.
// - Radarr (add only sync) lacks Harbor Light and keeps a leftover entry.
// - Radarr 4K has Lantern twice: synced and added by hand.
// - Sonarr 4K is not in Prowlarr and has its own indexers.
// - Lidarr mixes a synced and an own indexer.
// - Prowlarr also syncs to a Readarr that Wardarr does not know.

const HOUR = 3_600_000;
const PROWLARR_URL = 'http://prowlarr:9696';

/** Prowlarr indexers. `profile` drives the invented numbers. */
export const INDEXERS = [
  {
    id: 1,
    name: 'Lantern',
    priority: 25,
    protocol: 'torrent',
    privacy: 'public',
    enable: true,
    categories: [2000, 5000],
    profile: { perHour: 34, grab: 0.09, fail: 0.012, ms: 320, importMin: 40, importOk: 0.93, bait: 0.3 },
  },
  {
    id: 2,
    name: 'Nightjar',
    priority: 25,
    protocol: 'torrent',
    privacy: 'semiPrivate',
    enable: true,
    categories: [2000],
    profile: { perHour: 18, grab: 0.025, fail: 0.14, ms: 2600, importMin: 95, importOk: 0.55, bait: 0.7 },
  },
  {
    id: 3,
    name: 'Harbor Light',
    priority: 10,
    protocol: 'usenet',
    privacy: 'private',
    enable: true,
    categories: [2000, 5000],
    profile: { perHour: 26, grab: 0.11, fail: 0.02, ms: 520, importMin: 18, importOk: 0.97, bait: 0.6 },
  },
  {
    id: 4,
    name: 'Old Mill',
    priority: 25,
    protocol: 'torrent',
    privacy: 'public',
    enable: false,
    categories: [2000, 5000],
    profile: { perHour: 0, grab: 0, fail: 0, ms: 0, importMin: 0, importOk: 0 },
  },
  {
    id: 5,
    name: 'Songbird',
    priority: 20,
    protocol: 'torrent',
    privacy: 'public',
    enable: true,
    categories: [3000],
    profile: { perHour: 7, grab: 0.07, fail: 0.05, ms: 760, importMin: 25, importOk: 0.9 },
  },
  {
    id: 6,
    name: 'Driftwood',
    priority: 25,
    protocol: 'usenet',
    privacy: 'private',
    enable: true,
    categories: [5000, 7000],
    profile: { perHour: 21, grab: 0, fail: 0.06, ms: 1350, importMin: 0, importOk: 0 },
  },
];

const site = (name) => `https://${name.toLowerCase().replace(/[^a-z]/g, '')}.example.invalid/`;

/** GET /api/v1/indexer */
export const prowlarrIndexers = () =>
  INDEXERS.map((i) => ({
    id: i.id,
    name: i.name,
    enable: i.enable,
    protocol: i.protocol,
    privacy: i.privacy,
    priority: i.priority,
    tags: [],
    indexerUrls: [site(i.name)],
    capabilities: { categories: i.categories.map((id) => ({ id, subCategories: [] })) },
  }));

/** GET /api/v1/applications; `base` is the mock's own address. */
export const prowlarrApplications = (base) => {
  const app = (id, name, implementation, prefix, syncLevel, cats) => ({
    id,
    name,
    implementation,
    syncLevel,
    tags: [],
    fields: [
      { name: 'prowlarrUrl', value: PROWLARR_URL },
      { name: 'baseUrl', value: prefix ? `${base}/${prefix}` : 'http://readarr:8787' },
      { name: 'apiKey', value: '********' },
      { name: 'syncCategories', value: cats },
    ],
  });
  return [
    app(1, 'Sonarr', 'Sonarr', 'sonarr', 'fullSync', [5000, 5030, 5040]),
    app(2, 'Radarr', 'Radarr', 'radarr', 'addOnly', [2000, 2040]),
    app(3, 'Radarr 4K', 'Radarr', 'radarr-4k', 'fullSync', [2000, 2045]),
    app(4, 'Lidarr', 'Lidarr', 'lidarr', 'fullSync', [3000, 3040]),
    app(5, 'Readarr', 'Readarr', null, 'fullSync', [7000, 7020]),
  ];
};

// ------------------------------------------------------------- statistics

/** A stable pseudo random number in [0, 1) for a key. */
function noise(...parts) {
  let h = 2166136261;
  for (const ch of parts.join(':')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10_000) / 10_000;
}

/** Busy evenings, quiet nights. */
const rhythm = (hour) => 0.35 + 0.65 * Math.max(0, Math.sin(((hour - 8) / 24) * Math.PI * 2) * 0.5 + 0.5);

/** Outages per indexer, as [start, end] in hours before now. */
const OUTAGES = {
  2: [
    [7, 0],
    [100, 97],
  ],
  1: [[250, 249]],
};

function isDown(id, t, now) {
  const hoursAgo = (now - t) / HOUR;
  return (OUTAGES[id] ?? []).some(([from, to]) => hoursAgo <= from && hoursAgo >= to);
}

function hourStats(ix, t, now) {
  const p = ix.profile;
  if (!ix.enable || p.perHour === 0 || t > now) return null;
  const hour = new Date(t).getUTCHours();
  const n = noise(ix.id, t);
  const queries = Math.round(p.perHour * rhythm(hour) * (0.75 + n * 0.5));
  const down = isDown(ix.id, t, now);
  const failRate = down ? 0.92 : p.fail;
  const failed = Math.round(queries * failRate * (0.6 + n * 0.8));
  const grabs = down ? 0 : Math.round((queries - failed) * p.grab * (0.5 + noise(ix.id, t, 'g')));
  return {
    queries,
    failed,
    grabs,
    rss: Math.round(queries * 0.4),
    ms: Math.round(p.ms * (down ? 3 : 0.8 + n * 0.45)),
  };
}

/** GET /api/v1/indexerstats?startDate&endDate */
export function indexerStats(startIso, endIso, now = Date.now()) {
  const start = startIso ? Date.parse(startIso) : now - 30 * 24 * HOUR;
  const end = endIso ? Date.parse(endIso) : now;
  const indexers = INDEXERS.map((ix) => {
    let q = 0;
    let f = 0;
    let g = 0;
    let rss = 0;
    let msSum = 0;
    for (let t = Math.floor(start / HOUR) * HOUR; t < end; t += HOUR) {
      const s = hourStats(ix, t, now);
      if (!s) continue;
      q += s.queries;
      f += s.failed;
      g += s.grabs;
      rss += s.rss;
      msSum += s.ms * s.queries;
    }
    return {
      indexerId: ix.id,
      indexerName: ix.name,
      averageResponseTime: q ? Math.round(msSum / q) : 0,
      averageGrabResponseTime: g ? Math.round((msSum / q) * 1.4) : 0,
      numberOfQueries: q,
      numberOfGrabs: g,
      numberOfRssQueries: rss,
      numberOfAuthQueries: 0,
      numberOfFailedQueries: f,
      numberOfFailedGrabs: Math.round(g * 0.02),
      numberOfFailedRssQueries: 0,
      numberOfFailedAuthQueries: 0,
    };
  });
  const total = indexers.reduce((s, i) => s + i.numberOfQueries, 0);
  const grabs = indexers.reduce((s, i) => s + i.numberOfGrabs, 0);
  const share = [
    ['Sonarr/4.0.15.2941', 0.46],
    ['Radarr/5.26.2.10099', 0.38],
    ['Lidarr/2.13.3.4711', 0.09],
    ['Prowlarr/2.0.5.5160', 0.07],
  ];
  return {
    indexers,
    userAgents: share.map(([userAgent, s]) => ({
      userAgent,
      numberOfQueries: Math.round(total * s),
      numberOfGrabs: Math.round(grabs * s),
    })),
    hosts: [],
  };
}

/**
 * Every status change of the enabled indexers since `sinceHours` ago, oldest
 * first. Wardarr only sees changes while it polls; the demo writes these into
 * its database so the outage board has a history.
 */
export function indexerStatusChanges(now = Date.now(), sinceHours = 30 * 24) {
  const out = [];
  for (const i of INDEXERS.filter((x) => x.enable)) {
    out.push({
      indexerId: i.id,
      name: i.name,
      at: new Date(now - sinceHours * HOUR).toISOString(),
      failing: false,
    });
    for (const [from, to] of [...(OUTAGES[i.id] ?? [])].sort((a, b) => b[0] - a[0])) {
      if (from > sinceHours) continue;
      out.push({
        indexerId: i.id,
        name: i.name,
        at: new Date(now - from * HOUR).toISOString(),
        failing: true,
      });
      if (to > 0)
        out.push({
          indexerId: i.id,
          name: i.name,
          at: new Date(now - to * HOUR).toISOString(),
          failing: false,
        });
    }
  }
  return out;
}

/** GET /api/v1/indexerstatus */
export const indexerStatus = (now = Date.now()) =>
  INDEXERS.filter((i) => isDown(i.id, now - 60_000, now)).map((i) => ({
    indexerId: i.id,
    disabledTill: new Date(now + 2 * HOUR).toISOString(),
    mostRecentFailure: new Date(now - (OUTAGES[i.id]?.[0]?.[0] ?? 1) * HOUR).toISOString(),
  }));

// ----------------------------------------------------------- *arr side

const synced = (id, name, protocol = 'torrent') => ({
  id,
  name: `${name} (Prowlarr)`,
  prowlarrId: INDEXERS.find((i) => i.name === name)?.id,
  protocol,
});

/** Indexers set up in each app. `prowlarrId` says which Prowlarr indexer the entry points at. */
const ARR_INDEXERS = {
  sonarr: [synced(1, 'Lantern'), synced(2, 'Harbor Light', 'usenet'), synced(3, 'Driftwood', 'usenet')],
  // Add only: the entries keep the priority they were created with.
  radarr: [
    { ...synced(1, 'Lantern'), priority: 25 },
    { ...synced(2, 'Nightjar'), priority: 25 },
    // Deleted in Prowlarr; the add only sync left it behind.
    { id: 3, name: 'Gaslight (Prowlarr)', prowlarrId: 9, protocol: 'torrent' },
  ],
  'radarr-4k': [
    synced(1, 'Lantern'),
    synced(2, 'Nightjar'),
    synced(3, 'Harbor Light', 'usenet'),
    { id: 4, name: 'Lantern', url: 'https://lantern.example.invalid/api', protocol: 'torrent' },
  ],
  'sonarr-4k': [
    {
      id: 1,
      name: 'Harbor Light',
      priority: 15,
      url: 'https://harborlight.example.invalid',
      protocol: 'usenet',
      impl: 'Newznab',
    },
    { id: 2, name: 'Kettle', url: 'https://kettle.example.invalid', protocol: 'usenet', impl: 'Newznab' },
  ],
  lidarr: [
    synced(1, 'Songbird'),
    { id: 2, name: 'Tunes Archive', url: 'https://tunesarchive.example.invalid', protocol: 'torrent' },
    { id: 3, name: 'Paused Site', url: 'https://paused.example.invalid', protocol: 'torrent', off: true },
  ],
};

/** GET /api/v3/indexer (or /api/v1 for Lidarr) */
export const arrIndexers = (prefix) =>
  (ARR_INDEXERS[prefix] ?? []).map((i) => ({
    id: i.id,
    name: i.name,
    implementation: i.impl ?? (i.protocol === 'usenet' ? 'Newznab' : 'Torznab'),
    protocol: i.protocol,
    enableRss: !i.off,
    enableAutomaticSearch: !i.off,
    enableInteractiveSearch: !i.off,
    // Full sync copies Prowlarr's priority; everything else keeps what it was given.
    priority: i.priority ?? INDEXERS.find((x) => x.id === i.prowlarrId)?.priority ?? 25,
    tags: [],
    fields: [
      { name: 'baseUrl', value: i.url ?? `${PROWLARR_URL}/${i.prowlarrId}/` },
      { name: 'apiPath', value: '/api' },
      { name: 'apiKey', value: '********' },
      // Sonarr v4 and Radarr can fail downloads with dangerous files per indexer.
      ...(prefix === 'lidarr'
        ? []
        : [{ name: 'failDownloads', value: FAIL_DOWNLOADS.get(`${prefix}/${i.id}`) ?? [] }]),
    ],
  }));

/** What the gatekeeper switched on per indexer (`prefix/id` -> failDownloads). */
const FAIL_DOWNLOADS = new Map();

/** PUT /indexer/{id}: keeps the failDownloads value the gatekeeper wrote. */
export function saveArrIndexer(prefix, id, body) {
  const field = body?.fields?.find((f) => f.name === 'failDownloads');
  if (field && Array.isArray(field.value)) FAIL_DOWNLOADS.set(`${prefix}/${id}`, field.value);
  return arrIndexers(prefix).find((i) => i.id === Number(id)) ?? null;
}

const GRABS_PER_DAY = { sonarr: 5, radarr: 3, 'radarr-4k': 1.5, 'sonarr-4k': 1.2, lidarr: 1.5 };
const MEDIA_FIELD = {
  sonarr: 'episodeId',
  'sonarr-4k': 'episodeId',
  radarr: 'movieId',
  'radarr-4k': 'movieId',
  lidarr: 'albumId',
};
/** Sites without Prowlarr numbers still need a grab profile. */
const DIRECT_PROFILE = {
  Kettle: { importMin: 30, importOk: 0.85 },
  'Tunes Archive': { importMin: 50, importOk: 0.8 },
};

// Some failed downloads were stopped because of a dangerous file: usenet ones
// by SABnzbd (it does not say which file), torrents by the *arr app itself.
const BAIT_MESSAGES = [
  "Caution: Found executable file with extension: '.exe'",
  'Caution: Found potentially dangerous file with extension: .lnk',
  "Caution: Found executable file with extension: '.exe'",
  'Caution: Found potentially dangerous file with extension: .scr',
  "Caution: Found executable file with extension: '.bat'",
  'Caution: Found potentially dangerous file with extension: .zipx',
];
const SAB_ABORT = 'Aborted, unwanted extension detected';
const RELEASES = ['Lanternfall', 'Kestrel.Station', 'Harbor.Nights', 'The.Long.Watch', 'Paper.Moons'];
const releaseName = (prefix, n) =>
  prefix.startsWith('radarr')
    ? `${RELEASES[n % RELEASES.length]}.${1900 + (n % 30)}.${prefix.endsWith('4k') ? '2160p' : '1080p'}.WEB`
    : `${RELEASES[n % RELEASES.length]}.S0${1 + (n % 3)}E${String(1 + (n % 12)).padStart(2, '0')}.1080p.WEB`;

/** GET /history/since?date= : grabs of the last 30 days and what became of them. */
export function arrHistory(prefix, sinceIso, now = Date.now()) {
  const list = (ARR_INDEXERS[prefix] ?? []).filter((i) => !i.off);
  const perDay = GRABS_PER_DAY[prefix] ?? 0;
  const since = sinceIso ? Date.parse(sinceIso) : 0;
  const field = MEDIA_FIELD[prefix] ?? 'movieId';
  const events = [];
  const count = Math.round(perDay * 30);
  for (let n = 0; n < count; n++) {
    const at = now - (n / perDay) * 24 * HOUR - noise(prefix, n) * 6 * HOUR;
    const entry = list[Math.floor(noise(prefix, n, 'i') * list.length)];
    if (!entry) continue;
    const base = entry.name.replace(/ \(Prowlarr\)$/, '');
    const prof = INDEXERS.find((i) => i.name === base)?.profile ?? DIRECT_PROFILE[base];
    // Leftover entries and sites without grabs never grab.
    if (!prof || prof.importOk === 0 || entry.prowlarrId === 9) continue;
    const downloadId = `DEMO${prefix.replace(/[^a-z0-9]/g, '').toUpperCase()}${String(n).padStart(4, '0')}`;
    const mediaId = 1000 + n;
    const size = Math.round((0.6 + noise(prefix, n, 's') * 4) * 1_000_000_000);
    events.push({
      date: new Date(at).toISOString(),
      eventType: 'grabbed',
      downloadId,
      [field]: mediaId,
      sourceTitle: releaseName(prefix, n),
      data: { indexer: entry.name, size: String(size) },
    });
    const done = at + prof.importMin * (0.5 + noise(prefix, n, 'd')) * 60_000;
    if (done > now) continue;
    const ok = noise(prefix, n, 'ok') < prof.importOk;
    const bait = !ok && prefix !== 'lidarr' && noise(prefix, n, 'b') < (prof.bait ?? 0);
    const message = bait
      ? entry.protocol === 'usenet'
        ? SAB_ABORT
        : BAIT_MESSAGES[n % BAIT_MESSAGES.length]
      : undefined;
    events.push({
      date: new Date(done).toISOString(),
      eventType: ok
        ? field === 'albumId'
          ? 'trackFileImported'
          : 'downloadFolderImported'
        : 'downloadFailed',
      downloadId,
      [field]: mediaId,
      sourceTitle: releaseName(prefix, n),
      data: message ? { message } : {},
    });
  }
  return events
    .filter((e) => Date.parse(e.date) >= since)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

/** SABnzbd history slots for the usenet downloads it aborted (mode=history&failed_only=1). */
export function sabAborts(now = Date.now()) {
  return ['sonarr', 'radarr']
    .flatMap((prefix) => arrHistory(prefix, null, now))
    .filter((e) => e.data?.message === SAB_ABORT)
    .map((e) => ({
      nzo_id: e.downloadId,
      name: e.sourceTitle,
      status: 'Failed',
      fail_message: SAB_ABORT,
      completed: Math.floor(Date.parse(e.date) / 1000),
    }))
    .sort((a, b) => b.completed - a.completed);
}
