// End-to-end flow for stage 4: webhook and e-mail notifications are set up and tested,
// and the interface follows the browser language. Runs after stages 1 to 3.
import { expect, test } from '@playwright/test';

const MOCK = 'http://127.0.0.1:19000';
const ADMIN = { username: 'admin', password: 'example-password-1' };

interface Call {
  service: string;
  path: string;
  body: Record<string, unknown> | null;
  signature?: string;
}

test('an admin adds a webhook and its test message arrives signed', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('User name').fill(ADMIN.username);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).first()).toBeVisible();

  await page.goto('/settings?section=notifications');
  await page.getByRole('button', { name: 'Add notification' }).click();
  await page.getByRole('button', { name: /^Webhook/ }).click();
  await page.getByLabel('Name').fill('Example hook');
  await page.getByLabel('Address').fill(`${MOCK}/hook/example`);
  await page.getByLabel(/Signing secret/).fill('example-signing-secret');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByText('Example hook')).toBeVisible();
  await page.getByRole('button', { name: 'Send test' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Test sent' })).toBeVisible();

  const calls = (await (await page.request.get(`${MOCK}/__control/calls`)).json()) as Call[];
  const hook = calls.find((c) => c.service === 'hook');
  expect(hook?.path).toBe('/example');
  expect(hook?.body).toMatchObject({ source: 'wardarr', event: 'test' });
  expect(hook?.signature).toMatch(/^sha256=[0-9a-f]{64}$/);
});

test('an e-mail channel sends its test through SMTP', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('User name').fill(ADMIN.username);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).first()).toBeVisible();

  await page.goto('/settings?section=notifications');
  await page.getByRole('button', { name: 'Add notification' }).click();
  await page.getByRole('button', { name: /^E-mail/ }).click();
  await page.getByLabel('Name', { exact: true }).fill('Example mail');
  await page.getByLabel('SMTP server').fill('127.0.0.1');
  await page.getByLabel('Port', { exact: true }).fill('19025');
  await page.getByLabel('Encryption').selectOption('none');
  await page.getByLabel(/^User name/).fill('wardarr');
  await page.getByLabel('Sender address').fill('wardarr@example.test');
  await page.getByLabel('Recipients').fill('one@example.test, two@example.test');
  await page.getByLabel(/^Password/).fill('example-mail-password');
  await page.getByRole('button', { name: 'Save' }).click();

  const card = page.getByRole('listitem').filter({ hasText: 'Example mail' });
  await expect(card).toContainText('E-mail');
  await card.getByRole('button', { name: 'Send test' }).click();
  await expect(card.getByRole('status')).toContainText('Test sent');

  const calls = (await (await page.request.get(`${MOCK}/__control/calls`)).json()) as Call[];
  expect(calls.find((c) => c.service === 'smtp')?.body).toEqual({ subject: 'Wardarr test notification' });
});

test.describe('in German', () => {
  test.use({ locale: 'de-DE' });

  test('the sign-in page follows the browser language', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Anmelden' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  });
});
