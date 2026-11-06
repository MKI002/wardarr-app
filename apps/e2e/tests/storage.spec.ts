// Storage: the shared disk of all apps shows once, with its apps and a
// forecast that is still learning on a fresh install.
import { expect, test } from '@playwright/test';

const ADMIN = { username: 'admin', password: 'example-password-1' };

test('the storage page shows each disk once with the apps that use it', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('User name').fill(ADMIN.username);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  const nav = page.getByRole('navigation', { name: 'Main navigation' }).first();
  await nav.getByRole('link', { name: 'Storage', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Storage', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Check now' }).click();

  const media = page.getByRole('button', { name: /^\/data/ });
  await expect(media).toHaveCount(1);
  await expect(media).toContainText('2 TB free of 8 TB');
  await expect(media).toContainText('learning');
  // The container's own disk is listed apart from the media disks; /etc/hosts is not a disk.
  await expect(page.getByRole('button', { name: /^\/ / })).toHaveCount(1);
  await expect(page.getByText('/etc/hosts')).toHaveCount(0);

  await expect(page.getByText('/data in detail')).toBeVisible();
  await expect(
    page.getByText('Wardarr is still learning how fast /data fills', { exact: false }),
  ).toBeVisible();
});
