// Seeds a fresh testbed Wardarr with an admin account and instances.
// All values are invented. Usage: node testbed/seed.mjs [--real]
const BASE = process.env.WARDARR_URL ?? 'http://127.0.0.1:8484';
const KEY = '00000000000000000000000000000001';
const ADMIN = { username: 'admin', password: 'example-password-1' };

let cookie = '';
let csrf = '';

async function call(method, path, body) {
  const headers = { accept: 'application/json', cookie };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET')
    Object.assign(headers, csrf ? { 'x-csrf-token': csrf } : { 'x-wardarr-request': '1' });
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${data.error ?? ''}`);
  return data;
}

const MOCKS = [
  ['sonarr', 'Sonarr', 'http://mocks:19000/sonarr'],
  ['sonarr', 'Sonarr 4K', 'http://mocks:19000/sonarr-4k'],
  ['radarr', 'Radarr', 'http://mocks:19000/radarr'],
  ['radarr', 'Radarr 4K', 'http://mocks:19000/radarr-4k'],
  ['lidarr', 'Lidarr', 'http://mocks:19000/lidarr'],
  ['prowlarr', 'Prowlarr', 'http://mocks:19000/prowlarr'],
];
const REAL = [
  ['sonarr', 'Sonarr (real)', 'http://sonarr:8989'],
  ['sonarr', 'Sonarr 4K (real)', 'http://sonarr-4k:8989'],
  ['radarr', 'Radarr (real)', 'http://radarr:7878'],
  ['prowlarr', 'Prowlarr (real)', 'http://prowlarr:9696'],
];

const status = await call('GET', '/api/setup/status');
const session = status.needsSetup
  ? await call('POST', '/api/setup/admin', ADMIN)
  : await call('POST', '/api/auth/login', ADMIN);
csrf = session.csrfToken;

const existing = new Set((await call('GET', '/api/instances')).map((i) => i.name));
const wanted = process.argv.includes('--real') ? [...MOCKS, ...REAL] : MOCKS;
for (const [adapter, name, baseUrl] of wanted) {
  if (existing.has(name)) continue;
  await call('POST', '/api/instances', { adapter, name, baseUrl, fields: { apiKey: KEY } });
  console.log(`added ${name}`);
}
console.log(`Open ${BASE} and sign in as ${ADMIN.username} / ${ADMIN.password}`);
