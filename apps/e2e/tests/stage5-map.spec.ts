// The stack map draws the services connected in the earlier stages and lets
// the admin drill into one. Then a (mock) Tdarr server joins: its view, its
// issues and its node on the map. All services are invented. Both share one
// sign-in, because the login route is rate limited.
import { expect, test, type Page } from '@playwright/test';

const ADMIN = { username: 'admin', password: 'example-password-1' };
const MOCK = 'http://127.0.0.1:19000';
const TDARR_KEY = 'tapi_e2e0000000000001';

// One sign-in for the whole file: the login route is rate limited.
test.describe.configure({ mode: 'serial' });

let page: Page;
let csrf = '';

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await page.goto('/');
  await page.getByLabel('User name').fill(ADMIN.username);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).first()).toBeVisible();
  csrf = ((await (await page.request.get('/api/auth/me')).json()) as { csrfToken: string }).csrfToken;
});
test.afterAll(async () => page.close());

test('the map shows every connected service and opens details on click', async () => {
  const instances = (await (await page.request.get('/api/instances')).json()) as Array<{ name: string }>;
  expect(instances.length).toBeGreaterThan(0);

  await page.goto('/map');
  await expect(page.getByRole('heading', { name: 'Stack map' })).toBeVisible();
  const map = page.getByRole('group', { name: /Map of the connected services/ });
  await expect(map).toBeVisible();
  const first = instances[0]!;
  const node = map.getByRole('button', { name: new RegExp(`^${first.name},`) });
  await expect(node).toBeVisible();

  await node.click();
  await expect(page.getByRole('heading', { level: 2, name: first.name })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { level: 2, name: first.name })).toHaveCount(0);

  // The same connections as a table.
  await page.getByRole('tab', { name: 'List' }).click();
  await expect(page.getByRole('table')).toBeVisible();
});

test('the topology API is for admins only and answers with nodes and edges', async () => {
  const res = await page.request.get('/api/topology');
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { nodes: unknown[]; edges: unknown[] };
  expect(Array.isArray(body.nodes)).toBe(true);
  expect(Array.isArray(body.edges)).toBe(true);
  const anonymous = await page.context().browser()!.newContext();
  expect((await anonymous.request.get('http://127.0.0.1:18484/api/topology')).status()).toBe(401);
  await anonymous.close();
});

// ------------------------------------------------------------------ Tdarr

const post = (url: string, data?: unknown) =>
  page.request.post(url, { headers: { 'x-csrf-token': csrf }, ...(data ? { data } : {}) });

test('Tdarr connects with its API key and reports its version', async () => {
  const wrong = await post('/api/instances/test', {
    adapter: 'tdarr',
    baseUrl: `${MOCK}/tdarr`,
    fields: { apiKey: 'tapi_wrong' },
  });
  expect((await wrong.json()).ok).toBe(false);
  const right = await post('/api/instances/test', {
    adapter: 'tdarr',
    baseUrl: `${MOCK}/tdarr`,
    fields: { apiKey: TDARR_KEY },
  });
  expect(await right.json()).toMatchObject({ ok: true, version: '3.06.00' });

  const created = await post('/api/instances', {
    adapter: 'tdarr',
    name: 'Tdarr',
    baseUrl: `${MOCK}/tdarr`,
    fields: { apiKey: TDARR_KEY },
  });
  expect(created.ok()).toBe(true);
  await post(`/api/instances/${(await created.json()).id}/poll`);
});

test('the Tdarr view shows space saved, nodes, workers and failed files', async () => {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .first()
    .getByRole('link', { name: 'Tdarr' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Tdarr' })).toBeVisible();
  await expect(page.getByText('Space saved', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Server node' })).toBeVisible();
  await expect(page.getByText('Nosferatu (1922) Remux-1080p.mkv')).toBeVisible();
  await expect(page.getByText('Paused in Tdarr. It takes no new jobs.')).toBeVisible();
  await expect(page.getByText('Intolerance (1916) Bluray-1080p.mkv')).toBeVisible();
});

test('failed files show up in the issue center', async () => {
  const issues = (await (await page.request.get('/api/issues')).json()) as Array<{ fingerprint: string }>;
  expect(issues.some((i) => i.fingerprint.startsWith('transcode-failures:'))).toBe(true);
  await page.goto('/issues');
  await expect(page.getByText(/10 files failed in Tdarr/).first()).toBeVisible();
});

test('Tdarr appears on the stack map', async () => {
  await page.goto('/map');
  const map = page.getByRole('group', { name: /Map of the connected services/ });
  await expect(map.getByRole('button', { name: /^Tdarr,/ })).toBeVisible();
});
