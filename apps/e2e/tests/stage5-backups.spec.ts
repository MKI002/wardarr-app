// Backups: an admin makes a backup, changes something, restores the backup
// and finds the old state after Wardarr restarted in place. The restore goes
// back to the state right before this spec, so later specs see no difference.
import { expect, test, type Page } from '@playwright/test';

const ADMIN = { username: 'admin', password: 'example-password-1' };

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByLabel('User name').fill(ADMIN.username);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).first()).toBeVisible();
}

/** Calls the API from the page with the session's CSRF token. */
async function apiCall(page: Page, method: string, path: string, body?: object) {
  return page.evaluate(
    async ({ method, path, body }) => {
      const me = (await (await fetch('/api/auth/me')).json()) as { csrfToken: string };
      const res = await fetch(path, {
        method,
        headers: { 'content-type': 'application/json', 'x-csrf-token': me.csrfToken },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: res.status, body: (await res.json().catch(() => null)) as unknown };
    },
    { method, path, body },
  );
}

test('an admin restores a backup and Wardarr restarts with it', async ({ page }) => {
  await signIn(page);
  await page.goto('/settings?section=backups');
  await expect(page.getByRole('heading', { name: 'How long backups are kept' })).toBeVisible();

  // The slider explains what a level does before it is saved.
  const slider = page.getByRole('slider', { name: 'Retention' });
  await slider.fill('4');
  await expect(page.getByText('A backup every 3 hours.')).toBeVisible();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: 'Save' })).toBeHidden();

  await page.getByRole('button', { name: 'Back up now' }).click();
  const newest = page
    .locator('li')
    .filter({ has: page.getByRole('button', { name: 'Actions for this backup' }) })
    .filter({ hasText: 'Manual' })
    .first();
  await expect(newest).toBeVisible();

  // A change after the backup: a new user.
  const created = await apiCall(page, 'POST', '/api/users', {
    username: 'after-backup',
    password: 'example-password-2',
    role: 'user',
  });
  expect(created.status).toBe(201);

  await newest.getByRole('button', { name: 'Actions for this backup' }).click();
  await page.getByRole('menuitem', { name: 'Restore…' }).click();
  await page.getByRole('button', { name: 'Restore and restart' }).click();
  await expect(page.getByRole('heading', { name: 'Wardarr restarts with the backup…' })).toBeVisible();

  // The page reloads into the sign-in once the server is back.
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible({ timeout: 20_000 });
  await signIn(page);
  const users = await apiCall(page, 'GET', '/api/users');
  expect((users.body as Array<{ username: string }>).map((u) => u.username)).not.toContain('after-backup');

  // The state before the restore is kept as a safety copy; the level stays.
  await page.goto('/settings?section=backups');
  await expect(page.getByText('Before restore').first()).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Retention' })).toHaveValue('4');
});
