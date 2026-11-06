#!/usr/bin/env node
// Captures the demo data: starts the built Wardarr server against the demo
// mocks (services.mjs), sets it up like a real install and records every
// API answer the web UI asks for. The result is
// apps/web/src/demo/fixtures.json, which the demo build serves in place of a
// server.
//
// Usage (after `pnpm build`): node scripts/demo/capture.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_KEY, FILMS, SERIES } from './titles.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const MOCK_PORT = 19300;
const PORT = 18585;
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.join(root, 'apps/web/src/demo/fixtures.json');

/** Hosts in the captured data are replaced with names a real install would use. */
const HOSTS = [
  [`${MOCK}/sonarr-4k`, 'http://sonarr-4k:8989'],
  [`${MOCK}/sonarr`, 'http://sonarr:8989'],
  [`${MOCK}/radarr-4k`, 'http://radarr-4k:7878'],
  [`${MOCK}/radarr`, 'http://radarr:7878'],
  [`${MOCK}/lidarr`, 'http://lidarr:8686'],
  [`${MOCK}/prowlarr`, 'http://prowlarr:9696'],
  [`${MOCK}/qbittorrent`, 'http://qbittorrent:8080'],
  [`${MOCK}/sabnzbd`, 'http://sabnzbd:8080'],
  [`${MOCK}/jellyfin`, 'http://jellyfin:8096'],
  [`${MOCK}/seerr`, 'http://seerr:5055'],
  [`${MOCK}/hook`, 'https://hooks.example.com'],
  [`${MOCK}/ntfy`, 'https://ntfy.example.com'],
  [MOCK, 'http://wardarr.example.com'],
];

const INSTANCES = [
  ['sonarr', 'Sonarr', 'sonarr', { apiKey: DEMO_KEY }],
  ['sonarr', 'Sonarr 4K', 'sonarr-4k', { apiKey: DEMO_KEY }],
  ['radarr', 'Radarr', 'radarr', { apiKey: DEMO_KEY }],
  ['radarr', 'Radarr 4K', 'radarr-4k', { apiKey: DEMO_KEY }],
  ['lidarr', 'Lidarr', 'lidarr', { apiKey: DEMO_KEY }],
  ['prowlarr', 'Prowlarr', 'prowlarr', { apiKey: DEMO_KEY }],
  ['qbittorrent', 'qBittorrent', 'qbittorrent', { username: 'demo', password: 'demo-password' }],
  ['sabnzbd', 'SABnzbd', 'sabnzbd', { apiKey: DEMO_KEY }],
  ['jellyfin', 'Jellyfin', 'jellyfin', { apiKey: DEMO_KEY }],
  ['seerr', 'Seerr', 'seerr', { apiKey: DEMO_KEY }],
];
const ADMIN = { username: 'demo', password: 'demo-password-1' };
const USERS = [
  { username: 'mira', password: 'demo-password-2', displayName: 'Mira', role: 'user', seerrId: 2 },
  { username: 'jonas', password: 'demo-password-3', displayName: 'Jonas', role: 'user', seerrId: 3 },
];

const children = [];
const stop = () => children.forEach((c) => c.kill('SIGTERM'));
process.on('exit', stop);

function start(args, env = {}) {
  const child = spawn(process.execPath, args, { stdio: 'inherit', env: { ...process.env, ...env } });
  children.push(child);
  return child;
}

async function waitFor(url) {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`${url} did not come up`);
}

let cookie = '';
let csrf = '';
async function call(method, p, body) {
  const headers = { accept: 'application/json', cookie };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET')
    Object.assign(headers, csrf ? { 'x-csrf-token': csrf } : { 'x-wardarr-request': '1' });
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, data };
}
async function must(method, p, body) {
  const r = await call(method, p, body);
  if (r.status >= 400) throw new Error(`${method} ${p}: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Plays from the last months, written straight into the database: Wardarr
 * only records plays while it runs, and the demo should show some history.
 * Deterministic, so a new capture changes as little as possible.
 */
function seedStreamHistory(instanceId) {
  const require = createRequire(path.join(root, 'apps/server/package.json'));
  const Database = require('better-sqlite3');
  const db = new Database(path.join(dataDir, 'wardarr.db'));
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const EPISODES = {
    Lanternfall: [
      'The Dark Coast',
      'Lamp Oil',
      'The Long Watch',
      'Fog Signal',
      'Keeper’s Log',
      'Spring Tide',
    ],
    'The Salt Archive': [
      'Index Cards',
      'Water Damage',
      'Dated Tomorrow',
      'The Ledger',
      'Low Shelves',
      'Return Address',
    ],
    'Kestrel Station': ['Pressure Drop', 'Isobars', 'Night Reading'],
  };
  const MINUTES = { nosferatu: 94, moon: 13, train: 12, intolerance: 163, nanook: 79 };
  const users = [
    ['Mira', 'Jellyfin Web', false, '1080p'],
    ['Jonas', 'Jellyfin Android', true, '720p'],
    ['Demo', 'Jellyfin Media Player', false, '4K'],
    ['Mira', 'Jellyfin for Android TV', false, '1080p'],
  ];
  const insert = db.prepare(
    `INSERT INTO stream_history (id, instance_id, session_id, user, title, subtitle, media_type, started_at,
       last_seen_at, ended_at, played_ms, duration_ms, progress, transcoding, resolution, client)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const now = Date.now();
  const rows = [];
  for (let i = 0; i < 150; i++) {
    // Most plays in recent weeks, a few going back a year.
    const daysAgo = 1 + Math.floor(rand() * (rand() < 0.6 ? 40 : 360));
    const start = now - daysAgo * 86_400_000 - Math.floor(rand() * 10) * 3_600_000;
    const [user, client, transcoding, resolution] = pick(users);
    const isFilm = rand() < 0.45;
    let title;
    let subtitle = null;
    let minutes;
    if (isFilm) {
      const f = pick(FILMS.filter((x) => x.inLibrary || daysAgo < 20));
      title = f.title;
      minutes = MINUTES[f.key];
    } else {
      title = pick(Object.keys(EPISODES));
      const n = Math.floor(rand() * EPISODES[title].length);
      subtitle = `S01E${String(n + 1).padStart(2, '0')} · ${EPISODES[title][n]}`;
      minutes = 48 + Math.floor(rand() * 10);
    }
    const progress = rand() < 0.8 ? 100 : 20 + Math.floor(rand() * 70);
    const played = Math.round((minutes * 60_000 * progress) / 100);
    const end = new Date(start + played).toISOString();
    rows.push([
      instanceId,
      `demo-${i}`,
      user,
      title,
      subtitle,
      isFilm ? 'movie' : 'episode',
      new Date(start).toISOString(),
      end,
      end,
      played,
      minutes * 60_000,
      progress,
      transcoding ? 1 : 0,
      resolution,
      client,
    ]);
  }
  // History lists newest first by id: insert oldest first and keep the plays
  // Wardarr already saw (the sessions running now) on top.
  rows.sort((a, b) => a[6].localeCompare(b[6]));
  db.prepare('UPDATE stream_history SET id = id + 100000').run();
  rows.forEach((row, i) => insert.run(i + 1, ...row));
  db.close();
}

const dataDir = mkdtempSync(path.join(tmpdir(), 'wardarr-demo-'));
try {
  start([path.join(here, 'services.mjs')], { DEMO_MOCK_PORT: String(MOCK_PORT) });
  start([path.join(root, 'apps/server/dist/main.js')], {
    WARDARR_DATA_DIR: dataDir,
    WARDARR_PORT: String(PORT),
    WARDARR_HOST: '127.0.0.1',
    WARDARR_LOG_LEVEL: 'warn',
    // The invented guide data, never the real TRaSH Guides.
    WARDARR_TRASH_DIR: path.join(root, 'testbed/trash-guides'),
  });
  await waitFor(`${MOCK}/__ready`);
  await waitFor(`${BASE}/healthz`);

  // ------------------------------------------------------------ set up
  csrf = (await must('POST', '/api/setup/admin', ADMIN)).csrfToken;
  const me = await must('GET', '/api/auth/me');
  await must('PATCH', `/api/users/${me.user.id}`, { displayName: 'Demo Admin' });
  const userIds = {};
  for (const u of USERS) {
    const { seerrId: _s, ...body } = u;
    const created = await must('POST', '/api/users', body);
    userIds[u.username] = created.id ?? created.user?.id;
  }
  const ids = {};
  for (const [adapter, name, mockPath, fields] of INSTANCES) {
    const created = await must('POST', '/api/instances', {
      adapter,
      name,
      baseUrl: `${MOCK}/${mockPath}`,
      fields,
    });
    ids[mockPath] = created.id;
  }
  for (const id of Object.values(ids)) await must('POST', `/api/instances/${id}/poll`);

  // Link Wardarr users to Seerr users, so requests show who asked.
  await call('PUT', `/api/requests/links/${me.user.id}`, { externalId: 1 });
  for (const u of USERS)
    await call('PUT', `/api/requests/links/${userIds[u.username]}`, { externalId: u.seerrId });

  // Notification channels.
  const events = { issueOpened: 'warning', issueResolved: true, requestPending: true };
  await call('POST', '/api/notifications', {
    name: 'Phone',
    kind: 'ntfy',
    language: 'en',
    events,
    config: { server: `${MOCK}/ntfy`, topic: 'wardarr-demo' },
  });
  await call('POST', '/api/notifications', {
    name: 'Home automation',
    kind: 'webhook',
    language: 'en',
    events: { ...events, issueOpened: 'critical', requestPending: false },
    config: { url: `${MOCK}/hook/wardarr` },
  });

  // TRaSH Guides: three templates, two synced instances, one with a change
  // made by hand, one waiting for its first sync.
  const trashTemplate = async (name, product, profiles, extra = {}) => {
    const catalog = await must('GET', `/api/trash/catalog/${product}`);
    const config = {
      profiles: profiles.map((n) => catalog.profiles.find((p) => p.name === n).suggested),
      qualitySize: catalog.qualitySizes[0]?.trashId ?? null,
      naming: Object.fromEntries(Object.keys(catalog.naming).map((k) => [k, 'default'])),
      rename: true,
      ...extra,
    };
    return (await must('POST', '/api/trash/templates', { name, product, config })).template.id;
  };
  const trashTemplates = {
    radarr: await trashTemplate('Movies HD', 'radarr', ['Example HD Bluray + WEB']),
    'radarr-4k': await trashTemplate('Movies 4K', 'radarr', ['Example UHD Bluray + WEB']),
    sonarr: await trashTemplate('Series', 'sonarr', ['Example WEB-1080p', '[German] Example WEB-1080p']),
  };
  for (const [key, templateId] of Object.entries(trashTemplates)) {
    await must('PUT', `/api/trash/instances/${ids[key]}/template`, { templateId });
  }
  for (const key of ['radarr', 'radarr-4k'])
    await must('POST', `/api/trash/instances/${ids[key]}/sync`, { confirm: true });
  await must('PUT', `/api/trash/instances/${ids.radarr}/guard`, { mode: 'auto', confirm: true });
  await fetch(`${MOCK}/__drift/radarr-4k`, { method: 'POST' });
  for (const key of Object.keys(trashTemplates)) await must('POST', `/api/trash/instances/${ids[key]}/check`);

  seedStreamHistory(ids.jellyfin);
  await must('POST', `/api/library/${ids.jellyfin}/refresh`);

  // Give the jobs (issue engine, library) a moment, then poll again.
  await sleep(3000);
  for (const id of Object.values(ids)) await call('POST', `/api/instances/${id}/poll`);
  for (const id of ['sonarr', 'radarr', 'radarr-4k', 'lidarr']) {
    await call('POST', `/api/cleaner/${ids[id]}/run`);
    await call('POST', `/api/hunting/${ids[id]}/run`);
  }
  await sleep(3000);

  // ----------------------------------------------------------- capture
  const fixtures = {};
  const get = async (p) => {
    const r = await call('GET', p);
    fixtures[p] = { status: r.status, body: r.data };
    if (r.status >= 400) console.warn(`  ${p} -> ${r.status}`);
    return r.data;
  };

  for (const p of [
    '/api/setup/status',
    '/api/auth/me',
    '/api/capabilities',
    '/api/overview',
    '/api/adapters',
    '/api/instances',
    '/api/queue',
    '/api/users',
    '/api/notifications',
    '/api/indexers',
    '/api/streams/history?limit=25',
    '/api/discover/instances',
    '/api/discover/options',
    '/api/requests/links',
  ])
    await get(p);

  for (const id of Object.values(ids)) {
    await get(`/api/instances/${id}`);
    await get(`/api/instances/${id}/settings`);
  }

  const issues = await get('/api/issues?status=all');
  for (const i of issues ?? []) await get(`/api/issues/${encodeURIComponent(i.fingerprint)}`);

  const cleaner = await get('/api/cleaner');
  for (const inst of cleaner?.instances ?? []) {
    const id = encodeURIComponent(inst.instanceId);
    await get(`/api/cleaner/${id}/preview`);
    await get(`/api/cleaner/history?instance=${id}&limit=100`);
  }

  const hunting = await get('/api/hunting');
  for (const inst of hunting?.instances ?? [])
    await get(`/api/hunting/${encodeURIComponent(inst.instanceId)}/filters`);

  for (const list of ['trending', 'movies', 'tv']) await get(`/api/discover?list=${list}&page=1`);
  for (const f of FILMS) await get(`/api/discover/movie/${f.tmdbId}`);
  for (const s of SERIES) await get(`/api/discover/tv/${s.tmdbId}`);

  for (const status of ['all', 'pending', 'approved', 'processing', 'available', 'failed', 'declined']) {
    await get(`/api/requests?status=${status}&take=20&skip=0`);
    await get(`/api/requests/mine?status=${status}&take=20&skip=0`);
  }

  const trash = await get('/api/trash');
  await get('/api/trash/history?limit=100');
  for (const product of ['radarr', 'sonarr']) await get(`/api/trash/catalog/${product}`);
  for (const inst of trash?.instances ?? [])
    if (inst.templateId) await get(`/api/trash/instances/${encodeURIComponent(inst.id)}/preview`);

  for (const days of [7, 30, 90, 365]) {
    await get(`/api/library?days=${days}`);
    await get(`/api/stats?days=${days}`);
  }

  // Answers to a few actions, so buttons in the demo show real results.
  const mutations = {};
  const radarr4k = encodeURIComponent(ids['radarr-4k']);
  const blocked = cleaner?.instances
    .find((i) => i.instanceId === ids['radarr-4k'])
    ?.downloads.find((d) => JSON.stringify(d).includes('DEMOIMPORT01'));
  const preview = await call('POST', `/api/cleaner/${radarr4k}/downloads/import-preview`, {
    key: blocked?.key,
  });
  mutations[`POST /api/cleaner/${radarr4k}/downloads/import-preview`] = {
    status: preview.status,
    body: preview.data,
  };
  const test = await call('POST', '/api/instances/test', {
    adapter: 'sonarr',
    baseUrl: `${MOCK}/sonarr`,
    fields: { apiKey: DEMO_KEY },
  });
  mutations['POST /api/instances/test'] = { status: test.status, body: test.data };
  const record = async (method, p, body) => {
    const r = await call(method, p, body);
    mutations[`${method} ${p}`] = { status: r.status, body: r.data };
  };
  const templates = trash?.templates ?? [];
  const movies = templates.find((x) => x.name === 'Movies HD');
  if (movies) await record('POST', '/api/trash/resolve', { product: 'radarr', config: movies.config });
  for (const key of ['radarr', 'radarr-4k', 'sonarr', 'sonarr-4k']) {
    const id = encodeURIComponent(ids[key]);
    await record('POST', `/api/trash/instances/${id}/suggest`);
  }
  await record('POST', `/api/trash/instances/${encodeURIComponent(ids.radarr)}/release-test`, {
    title: 'Nosferatu.1922.1080p.BluRay.x264-EXAMPLE',
  });

  // ----------------------------------------------------------- clean up
  let out = JSON.stringify({ capturedAt: new Date().toISOString(), fixtures, mutations }, null, 1);
  for (const [from, to] of HOSTS) out = out.split(from).join(to);
  // Stable ids keep a new capture's diff small.
  const uuids = new Map();
  out = out.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (id) => {
    if (!uuids.has(id)) uuids.set(id, `00000000-0000-4000-8000-${String(uuids.size + 1).padStart(12, '0')}`);
    return uuids.get(id);
  });
  out = out.replace(/"csrfToken": ?"[^"]*"/g, '"csrfToken": "demo"');
  if (out.includes('127.0.0.1')) console.warn('warning: a local address is left in the fixtures');
  if (out.includes(dataDir) || out.includes(tmpdir()))
    throw new Error('a local path is left in the fixtures');
  writeFileSync(OUT, `${out}\n`);
  console.log(`wrote ${Object.keys(fixtures).length} answers to ${path.relative(root, OUT)}`);
} finally {
  stop();
  rmSync(dataDir, { recursive: true, force: true });
}
