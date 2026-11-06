// End-to-end flow for stage 2: Queue Cleaner and Hunting against invented
// mock services. Runs after stage 1, which created the admin and instances.
import { expect, test, type Page } from '@playwright/test';

const MOCK = 'http://127.0.0.1:19000';
const ADMIN = { username: 'admin', password: 'example-password-1' };

test.describe.configure({ mode: 'serial' });

let page: Page;
let instanceId = '';

interface Call {
  service: string;
  method: string;
  path: string;
  body: { name?: string } | null;
}

async function calls(page: Page): Promise<Call[]> {
  return (await (await page.request.get(`${MOCK}/__control/calls`)).json()) as Call[];
}
const changes = async (page: Page) =>
  (await calls(page)).filter((c) => c.method === 'DELETE' || c.body?.name === 'ManualImport');

test.beforeAll(async ({ browser, request }) => {
  await request.post(`${MOCK}/__control/stage2`);
  page = await browser.newPage();
  await page.goto('/');
  await page.getByLabel('User name').fill(ADMIN.username);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('link', { name: 'Queue Cleaner' }).first()).toBeVisible();
  const list = (await (await page.request.get('/api/instances')).json()) as Array<{
    id: string;
    name: string;
  }>;
  instanceId = list.find((i) => i.name === 'Radarr 4K')!.id;
  const me = (await (await page.request.get('/api/auth/me')).json()) as { csrfToken: string };
  await page.request.post(`/api/instances/${instanceId}/poll`, { headers: { 'x-csrf-token': me.csrfToken } });
});
test.afterAll(async () => page.close());

test('the Queue Cleaner starts in dry run and changes nothing', async () => {
  await page.goto(`/cleaner?instance=${instanceId}`);
  await expect(page.getByText('Dry run', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Run now' }).click();
  const failed = page.locator('main li', { hasText: 'Example.Film.2021.2160p' });
  await expect(failed).toContainText('Failed');
  await expect(failed).toContainText('1/4');
  expect(await changes(page)).toEqual([]);
});

test('the preview and the history explain each decision', async () => {
  await page.getByRole('tab', { name: 'Preview' }).click();
  await expect(page.getByText(/What the run .* would do/)).toBeVisible();
  await page.getByRole('tab', { name: 'History' }).click();
  const entry = page.locator('main li', { hasText: 'Example.Film.2021.2160p' }).first();
  await expect(entry).toContainText('Strike');
  await expect(entry).toContainText('Dry run');
  await expect(entry).toContainText('Download failed, strike 1 of 4');
});

test('a clean import waits for "Review import" and imports only after confirmation', async () => {
  await page.goto('/issues');
  const issue = page.locator('main li', { hasText: 'ready to import' });
  await expect(issue).toContainText('1 download in Radarr 4K is ready to import');
  const toggle = issue.locator('button[aria-expanded]');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await issue.getByRole('button', { name: 'Review import' }).click();
  const dialog = page.getByRole('dialog', { name: 'Review import' });
  await expect(dialog).toContainText('Second Example (2022)');
  expect(await changes(page)).toEqual([]);
  await dialog.getByRole('button', { name: 'Import 1 file' }).click();
  await expect(dialog).toContainText('The import has started');
  const imports = (await changes(page)).filter((c) => c.body?.name === 'ManualImport');
  expect(imports).toHaveLength(1);
  await dialog.getByRole('button', { name: 'Close' }).first().click();
});

test('arming is a deliberate step, then the cleaner removes and searches', async () => {
  await page.goto(`/cleaner?instance=${instanceId}&tab=settings`);
  await page.getByLabel('Strikes before removal').fill('1');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await page.getByRole('tab', { name: /Downloads/ }).click();
  await page.getByRole('button', { name: 'Run now' }).click();
  await expect(page.locator('main li', { hasText: 'Example.Film.2021.2160p' })).toContainText(
    'Removed on the next run',
  );
  expect((await changes(page)).filter((c) => c.method === 'DELETE')).toEqual([]);

  await page.getByRole('button', { name: 'Arm', exact: true }).click();
  const confirm = page.getByRole('dialog');
  await expect(confirm).toContainText('Switch off other queue cleaners');
  await confirm.getByRole('button', { name: 'Arm now' }).click();
  await expect(page.getByText('Armed', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Run now' }).click();
  await expect
    .poll(async () => (await changes(page)).filter((c) => c.method === 'DELETE').map((c) => c.path))
    .toEqual(['/queue/21']);
  const searches = (await calls(page)).filter((c) => c.body?.name === 'MoviesSearch');
  expect(searches.length).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Back to dry run' }).click();
  await expect(page.getByText('Dry run', { exact: true }).first()).toBeVisible();
});

test('Hunting shows what comes next, searches and excludes', async () => {
  await page.goto(`/hunting?instance=${instanceId}`);
  await expect(page.getByRole('radio', { name: 'Normal' })).toBeChecked();
  await page.getByRole('button', { name: 'Search now' }).first().click();
  await expect(page.locator('section', { hasText: 'Results' }).locator('li').first()).toBeVisible();
  const upNext = page.locator('section', { hasText: 'Up next' });
  const first = upNext.locator('li').first();
  await expect(first).toContainText('never searched');
  const title = (await first.locator('span[title]').first().getAttribute('title')) ?? '';
  await first.getByRole('button', { name: 'Exclude' }).click();
  await expect(page.locator('section', { hasText: 'Excluded titles' })).toContainText(title);
});
