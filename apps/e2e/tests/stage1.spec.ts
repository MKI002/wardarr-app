// End-to-end flow for stage 1 against invented mock services.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const MOCK = 'http://127.0.0.1:19000';
const KEY = '00000000000000000000000000000001';
const ADMIN = { username: 'admin', password: 'example-password-1' };

test.describe.configure({ mode: 'serial' });

let page: Page;

test.beforeAll(async ({ browser, request }) => {
  await request.post(`${MOCK}/__control/reset`);
  page = await browser.newPage();
});
test.afterAll(async () => page.close());

async function csrf(request: APIRequestContext) {
  const me = await request.get('/api/auth/me');
  return ((await me.json()) as { csrfToken: string }).csrfToken;
}

async function addInstanceInWizard(name: string | null, product: string, path: string) {
  await page
    .getByRole('button', { name: new RegExp(`^${product}`) })
    .first()
    .click();
  if (name) await page.getByLabel('Name').fill(name);
  await page.getByLabel('Address').fill(`${MOCK}/${path}`);
  await page.getByLabel('API key').fill(KEY);
  await page.getByRole('button', { name: 'Add instance' }).click();
}

test('setup wizard creates the admin and two Sonarr instances', async () => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome to Wardarr' })).toBeVisible();
  await page.getByLabel('User name').fill(ADMIN.username);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
  await page.getByLabel('Repeat password').fill('something-else-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('The passwords do not match.')).toBeVisible();
  await page.getByLabel('Repeat password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Create account' }).click();

  // First Sonarr, with a connection test.
  await page
    .getByRole('button', { name: /^Sonarr/ })
    .first()
    .click();
  await expect(page.getByLabel('Name')).toHaveValue('Sonarr');
  await page.getByLabel('Address').fill(`${MOCK}/sonarr`);
  await page.getByLabel('API key').fill('00000000000000000000000000000009');
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByText('The service rejected the credentials.')).toBeVisible();
  await page.getByLabel('API key').fill(KEY);
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByText('Connected. Version 4.0.15.2941.')).toBeVisible();
  await page.getByRole('button', { name: 'Add instance' }).click();

  // Second Sonarr: the suggested name avoids the clash.
  await page.getByRole('button', { name: /Add a service/ }).click();
  await page
    .getByRole('button', { name: /^Sonarr/ })
    .first()
    .click();
  await expect(page.getByLabel('Name')).toHaveValue('Sonarr 2');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await addInstanceInWizard('Sonarr 4K', 'Sonarr', 'sonarr-4k');

  const added = page.getByRole('list', { name: 'Connected' });
  await expect(added.getByText('Sonarr 4K')).toBeVisible();
  await expect(added.getByRole('listitem')).toHaveCount(2);
  await page.getByRole('button', { name: 'Finish setup' }).click();
  await page.getByRole('button', { name: 'Open overview' }).click();
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).first()).toBeVisible();
});

test('more instances via the API, grouped per product on the overview', async () => {
  const request = page.request;
  const token = await csrf(request);
  for (const [adapter, name, path] of [
    ['radarr', 'Radarr', 'radarr'],
    ['radarr', 'Radarr 4K', 'radarr-4k'],
    ['lidarr', 'Lidarr', 'lidarr'],
    ['prowlarr', 'Prowlarr', 'prowlarr'],
  ] as const) {
    const res = await request.post('/api/instances', {
      headers: { 'x-csrf-token': token },
      data: { adapter, name, baseUrl: `${MOCK}/${path}`, fields: { apiKey: KEY } },
    });
    expect(res.status(), name).toBe(201);
    expect(await res.text()).not.toContain(KEY);
  }
  // Poll everything once more so issues are based on all instances.
  const list = (await (await request.get('/api/instances')).json()) as Array<{ id: string }>;
  for (const i of list)
    await request.post(`/api/instances/${i.id}/poll`, { headers: { 'x-csrf-token': token } });

  await page.goto('/');
  const services = page.locator('section', { has: page.getByRole('heading', { name: 'Services' }) });
  const sonarr = services.locator('div.rounded-xl', { hasText: 'Sonarr' }).first();
  await expect(sonarr.getByText('2 instances')).toBeVisible();
  await expect(sonarr.getByText('Sonarr 4K')).toBeVisible();
  await expect(
    services.locator('div.rounded-xl', { hasText: 'Radarr' }).first().getByText('2 instances'),
  ).toBeVisible();
});

test('issue center groups causes like the specification example', async () => {
  await page.goto('/issues');
  const cards = page.locator('main li', { has: page.locator('button[aria-expanded]') });
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toContainText('ExampleIndexer unreachable for more than 6 hours');
  await expect(cards.nth(0)).toContainText('Sonarr, Radarr, Radarr 4K');
  await expect(page.getByText('3 downloads failed in Lidarr')).toBeVisible();
  await expect(page.getByText('3 albums')).toBeVisible();
  await expect(page.getByText('Update available for Lidarr')).toBeVisible();

  // Expand the indexer issue: explanation, fix and actions in this order.
  await cards.nth(0).locator('button[aria-expanded]').click();
  await expect(cards.nth(0).getByText('What happened')).toBeVisible();
  const actions = cards
    .nth(0)
    .getByRole('button')
    .filter({ hasNotText: /ExampleIndexer/ });
  await expect(actions.filter({ hasText: 'Test indexer' })).toBeVisible();
  await expect(
    cards
      .nth(0)
      .getByRole('button', { name: 'Open in Prowlarr' })
      .or(cards.nth(0).getByRole('link', { name: 'Open in Prowlarr' })),
  ).toBeVisible();

  // A safe action runs on click and reports the result.
  await cards.nth(0).getByRole('button', { name: 'Test indexer' }).click();
  await expect(cards.nth(0).getByText(/That did not work: Unable to connect to indexer/)).toBeVisible();
});

test('mute hides an issue and unmute brings it back', async () => {
  const update = page.locator('main li', { hasText: 'Update available for Lidarr' });
  await update.locator('button[aria-expanded]').click();
  await update.getByRole('button', { name: 'Mute' }).click();
  await page.getByRole('menuitem', { name: 'For 1 day' }).click();
  await expect(page.locator('main li', { hasText: 'Update available for Lidarr' })).toHaveCount(0);
  await page.getByRole('tab', { name: /Muted/ }).click();
  const muted = page.locator('main li', { hasText: 'Update available for Lidarr' });
  await expect(muted).toContainText('Muted until');
  await muted.locator('button[aria-expanded]').click();
  await muted.getByRole('button', { name: 'Unmute' }).click();
  await expect(muted).toHaveCount(0);
  await page.getByRole('tab', { name: /Open/ }).click();
  await expect(page.getByText('Update available for Lidarr')).toBeVisible();
});

test('recheck resolves a fixed issue and keeps it in the history', async ({ request }) => {
  await request.post(`${MOCK}/__control/fix?what=indexer`);
  const indexer = page.locator('main li', { hasText: 'ExampleIndexer unreachable' });
  const toggle = indexer.locator('button[aria-expanded]');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await indexer.getByRole('button', { name: 'Recheck' }).click();
  await expect(indexer).toHaveCount(0);
  await page.getByRole('tab', { name: /Resolved/ }).click();
  await expect(page.locator('main li', { hasText: 'ExampleIndexer unreachable' })).toContainText('Resolved');
});

test('all clear shows the guardian once nothing is open', async ({ request }) => {
  await request.post(`${MOCK}/__control/fix?what=update`);
  await request.post(`${MOCK}/__control/fix?what=queue`);
  const token = await csrf(page.request);
  const list = (await (await page.request.get('/api/instances')).json()) as Array<{ id: string }>;
  for (const i of list)
    await page.request.post(`/api/instances/${i.id}/poll`, { headers: { 'x-csrf-token': token } });
  await page.goto('/issues');
  await expect(page.getByText('All clear')).toBeVisible();
});

test('logout, wrong password, login', async () => {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByLabel('User name').fill(ADMIN.username);
  await page.getByLabel('Password').fill('wrong-password-1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('User name or password is wrong.')).toBeVisible();
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(
    page.getByRole('heading', { name: 'Needs attention' }).or(page.getByText('Needs attention')),
  ).toBeVisible();
});
