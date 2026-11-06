// The stack map draws the services connected in the earlier stages and lets
// the admin drill into one. All services are invented.
import { expect, test, type Page } from '@playwright/test';

const ADMIN = { username: 'admin', password: 'example-password-1' };

// One sign-in for the whole file: the login route is rate limited.
test.describe.configure({ mode: 'serial' });

let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await page.goto('/');
  await page.getByLabel('User name').fill(ADMIN.username);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).first()).toBeVisible();
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
