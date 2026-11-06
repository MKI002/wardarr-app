// End-to-end flow for the TRaSH Guides tab: a template from the invented
// guide in testbed/trash-guides is synced to a Radarr, a change made in the
// instance is found, and the sync is rolled back. Runs after stages 1 to 4,
// which connect the instances.
import { expect, test, type Page } from '@playwright/test';

const MOCK = 'http://127.0.0.1:19000';
const ADMIN = { username: 'admin', password: 'example-password-1' };

interface Call {
  service: string;
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByLabel('User name').fill(ADMIN.username);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).first()).toBeVisible();
}

const radarrCalls = async (page: Page) =>
  ((await (await page.request.get(`${MOCK}/__control/calls`)).json()) as Call[]).filter(
    (c) => c.service === 'radarr',
  );

test('a template is synced to Radarr, drift is found and the sync is rolled back', async ({ page }) => {
  await signIn(page);
  await page.goto('/trash');
  await expect(page.getByRole('heading', { name: 'TRaSH Guides' })).toBeVisible();
  // The guide is only fetched once someone uses it.
  await expect(page.getByText('No guide data yet')).toBeVisible();

  // A template with one profile and the quality sizes of the guide.
  await page.getByRole('button', { name: 'New template' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Example movies');
  await page.getByRole('radio', { name: 'Radarr' }).check({ force: true });
  await page.getByLabel('Add a TRaSH profile').selectOption({ label: 'Example HD Bluray + WEB' });
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByLabel('Name in the instance')).toBeVisible();
  await page.getByLabel('Quality sizes').selectOption({ label: 'movie' });
  await expect(page.getByText(/^1 quality profiles with \d+ custom formats$/)).toBeVisible();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Example movies')).toBeVisible();

  // Assign it to Radarr and sync after the preview.
  await page.getByRole('tab', { name: /Instances/ }).click();
  await expect(page.getByText(/^Guide version [0-9a-f]{7}$/)).toBeVisible();
  const card = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Radarr', exact: true }) });
  await card.getByLabel('Template').selectOption({ label: 'Example movies' });
  await expect(card.getByText('Not synced yet')).toBeVisible();
  await card.getByRole('button', { name: 'Preview and sync' }).click();

  const dialog = page.getByRole('dialog', { name: 'Sync Radarr' });
  await expect(dialog.getByText(/First sync/)).toBeVisible();
  await expect(dialog.getByText('Example HD Bluray + WEB')).toBeVisible();
  await dialog.getByRole('button', { name: /^Sync \d+ changes?$/ }).click();
  await expect(dialog.getByRole('status')).toContainText('synced');
  await dialog.getByRole('button', { name: 'Close' }).first().click();

  const synced = await radarrCalls(page);
  expect(synced.filter((c) => c.method === 'POST' && c.path === '/customformat').length).toBeGreaterThan(3);
  expect(synced.find((c) => c.method === 'POST' && c.path === '/qualityprofile')?.body).toMatchObject({
    name: 'Example HD Bluray + WEB',
  });
  expect(synced.some((c) => c.method === 'PUT' && c.path === '/qualitydefinition/update')).toBe(true);
  await expect(card.getByText('In sync')).toBeVisible();

  // Someone changes a score in Radarr by hand: the check reports it.
  await page.request.post(`${MOCK}/__control/trash-drift`);
  await card.getByRole('button', { name: 'Check now' }).click();
  await expect(card.getByText('1 change made in the instance')).toBeVisible();

  // The release test asks Radarr itself.
  await page.getByRole('tab', { name: /Release test/ }).click();
  await page.getByLabel('Instance').selectOption({ label: 'Radarr' });
  await page.getByLabel('Release name').fill('Example.Film.2021.1080p.BluRay.x264-EXAMPLE');
  await page.getByRole('button', { name: 'Test', exact: true }).click();
  await expect(page.getByText('Bluray-1080p')).toBeVisible();

  // Roll the sync back: what it created is removed again.
  await page.getByRole('tab', { name: /History/ }).click();
  await page.getByRole('button', { name: 'Roll back' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Roll back' }).click();
  await expect(page.getByText('Rolled back')).toBeVisible();
  const after = await radarrCalls(page);
  expect(after.some((c) => c.method === 'DELETE' && c.path.startsWith('/qualityprofile/'))).toBe(true);
  expect(after.some((c) => c.method === 'DELETE' && c.path.startsWith('/customformat/'))).toBe(true);
});
