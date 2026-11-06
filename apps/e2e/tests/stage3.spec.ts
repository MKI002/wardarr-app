// End-to-end flow for stage 3: a request goes from Discover through Seerr
// into Radarr, library statistics appear, and indexers show who depends on
// them. Runs after stages 1 and 2. All services and titles are invented.
import { expect, test, type Browser, type Page } from '@playwright/test';

const MOCK = 'http://127.0.0.1:19000';
const KEY = '00000000000000000000000000000001';
const ADMIN = { username: 'admin', password: 'example-password-1' };
const VIEWER = { username: 'viewer', password: 'viewer-password-1' };

test.describe.configure({ mode: 'serial' });

interface Call {
  service: string;
  method: string;
  path: string;
  user?: number;
  body: Record<string, unknown> | null;
}

const calls = async (page: Page) =>
  (await (await page.request.get(`${MOCK}/__control/calls`)).json()) as Call[];

async function login(browser: Browser, who: { username: string; password: string }) {
  const page = await browser.newPage();
  await page.goto('/');
  await page.getByLabel('User name').fill(who.username);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).first()).toBeVisible();
  return page;
}

async function csrf(page: Page) {
  return ((await (await page.request.get('/api/auth/me')).json()) as { csrfToken: string }).csrfToken;
}

let admin: Page;
const ids: Record<string, string> = {};

test.beforeAll(async ({ browser }) => {
  admin = await login(browser, ADMIN);
  const token = await csrf(admin);
  for (const [adapter, name, path] of [
    ['seerr', 'Seerr', 'seerr'],
    ['jellyfin', 'Jellyfin', 'jellyfin'],
  ] as const) {
    const res = await admin.request.post('/api/instances', {
      headers: { 'x-csrf-token': token },
      data: { adapter, name, baseUrl: `${MOCK}/${path}`, fields: { apiKey: KEY } },
    });
    expect(res.status(), name).toBe(201);
    ids[adapter] = ((await res.json()) as { id: string }).id;
    await admin.request.post(`/api/instances/${ids[adapter]}/poll`, { headers: { 'x-csrf-token': token } });
  }
  const created = await admin.request.post('/api/users', {
    headers: { 'x-csrf-token': token },
    data: { ...VIEWER, role: 'user' },
  });
  expect(created.ok()).toBe(true);
});
test.afterAll(async () => admin.close());

test('Discover shows what is in the library or already requested', async () => {
  await admin.goto('/discover');
  const harbor = admin.getByRole('button', { name: /Example Harbor/ });
  await expect(harbor).toContainText('In the library');
  await expect(admin.getByRole('button', { name: /Example Chronicles/ })).toContainText('Requested');
  await expect(admin.getByRole('button', { name: /Example Voyage/ })).not.toContainText('Requested');
});

test('a 4K request from Discover reaches the 4K Radarr', async () => {
  await admin.getByRole('button', { name: /Example Voyage/ }).click();
  const dialog = admin.getByRole('dialog', { name: /Example Voyage/ });
  await dialog.getByText('4K', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Request in 4K' }).click();
  await expect(dialog.getByText('The request is on its way')).toBeVisible();
  const all = await calls(admin);
  const sent = all.find((c) => c.service === 'seerr' && c.path === '/request');
  expect(sent?.body).toMatchObject({ mediaType: 'movie', mediaId: 9001, is4k: true, serverId: 1 });
  expect(sent?.user).toBe(1);
  const added = all.filter((c) => c.service === 'radarr-4k' && c.path === '/movie');
  expect(added).toHaveLength(1);
  expect(added[0]?.body).toMatchObject({ tmdbId: 9001, title: 'Example Voyage' });
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(admin.getByRole('button', { name: /Example Voyage/ })).toContainText('On its way');
});

test('a user requests as their own Seerr user and an admin approves it', async ({ browser }) => {
  const viewer = await login(browser, VIEWER);
  await expect(viewer).toHaveURL(/\/discover/);
  await viewer.getByRole('button', { name: /Example Voyage/ }).click();
  const dialog = viewer.getByRole('dialog', { name: /Example Voyage/ });
  await expect(dialog.getByText('Advanced')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Request', exact: true }).click();
  await expect(dialog.getByText('The request is on its way')).toBeVisible();
  const sent = (await calls(viewer)).filter((c) => c.service === 'seerr' && c.path === '/request');
  expect(sent.at(-1)).toMatchObject({ user: 2, body: { is4k: false, serverId: 0 } });

  await viewer.goto('/requests');
  const mine = viewer.locator('main li', { hasText: 'Example Voyage' });
  await expect(mine).toContainText('Waiting for approval');
  await expect(mine.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await viewer.close();

  await admin.goto('/requests');
  const pending = admin.locator('main li', { hasText: 'Example Voyage' });
  await expect(pending).toContainText('by Example Viewer');
  await pending.getByRole('button', { name: 'Approve' }).click();
  await expect(admin.getByText('Nothing is waiting for approval')).toBeVisible();
  const added = (await calls(admin)).filter((c) => c.service === 'radarr' && c.path === '/movie');
  expect(added).toHaveLength(1);
});

test('the library shows statistics of the test setup', async () => {
  await admin.goto('/library');
  const server = admin.locator('section', { hasText: 'Media servers' });
  await server.getByRole('button', { name: 'Count again' }).click();
  const films = server.locator('li', { hasText: 'Films' }).first();
  await expect(films).toContainText('3 movies');
  await expect(films).toContainText('4K');
  await expect(server.locator('li', { hasText: 'Series' }).first()).toContainText('2 series');
  await expect(admin.getByText('Example Harbor').first()).toBeVisible();
  await expect(admin.locator('section', { hasText: 'Recent plays' })).toContainText('Example Viewer');
});

test('indexers show statistics and the apps that use them', async () => {
  await admin.goto('/indexers');
  const row = admin.locator('main li', { hasText: 'ExampleIndexer' }).first();
  await expect(row).toContainText('Used by Sonarr, Radarr');
  await expect(row).toContainText('240');
  await row.getByRole('button', { name: 'Test' }).click();
  await expect(row.getByText('Test passed.')).toBeVisible();
});
