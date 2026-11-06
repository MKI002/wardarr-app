// Switching tabs faster than the view transition must never leave a blank or
// half-faded view. Runs after stages 1 to 4, against the setup they created.
import { expect, test, type Page } from '@playwright/test';

const ADMIN = { username: 'admin', password: 'example-password-1' };

/**
 * Lowest opacity that motion left on anything inside <main>. A view stuck in its
 * exit sits at 0 while its content is still in the DOM, which is exactly the
 * blank tab, so `toBeVisible()` alone would not catch it.
 */
function lowestOpacity(page: Page) {
  return page.evaluate(() => {
    let min = 1;
    for (const el of document.querySelectorAll<HTMLElement>('main#main [style*="opacity"]')) {
      min = Math.min(min, Number(el.style.opacity));
    }
    return min;
  });
}

async function settled(page: Page) {
  await expect.poll(() => lowestOpacity(page), { timeout: 3000 }).toBe(1);
}

// One sign-in for the whole file: the login route is rate limited, and later specs sign in too.
test.describe.configure({ mode: 'serial' });

let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await page.getByLabel('User name').fill(ADMIN.username);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).first()).toBeVisible();
});
test.afterAll(async () => page.close());

// Back and forth to a view whose transition is still running, at several speeds.
const PAUSES = [0, 30, 60, 100];

test('rapid switching between main tabs always ends on a visible page', async () => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Main navigation' }).first();
  const tab = (name: string) => nav.getByRole('link', { name, exact: true });
  const rounds = [
    ['Settings', 'Overview', 'Settings'],
    ['Issues', 'Settings', 'Issues', 'Settings'],
    ['Overview', 'Settings', 'Overview'],
    ['Settings', 'Library', 'Settings', 'Library', 'Settings'],
  ];
  for (const [i, path] of rounds.entries()) {
    for (const name of path) {
      await tab(name).click();
      if (PAUSES[i]) await page.waitForTimeout(PAUSES[i]);
    }
    await expect(page.getByRole('heading', { level: 1, name: path.at(-1) })).toBeVisible();
    await settled(page);
  }
});

test('rapid switching between settings sections always shows the section', async () => {
  await page.goto('/settings');
  const sections = page.getByRole('navigation', { name: 'Settings', exact: true });
  const section = (name: string) => sections.getByRole('link', { name, exact: true });
  for (const pause of PAUSES) {
    for (const name of ['Users', 'Services', 'Users', 'Appearance', 'Users']) {
      await section(name).click();
      if (pause) await page.waitForTimeout(pause);
    }
    await expect(section('Users')).toHaveAttribute('aria-current', 'page');
    await settled(page);
  }
});

test('switching Discover lists brings every list in the same way', async () => {
  await page.goto('/discover');
  const lists = page.getByRole('tablist', { name: 'Lists' });
  const grid = page.locator('main#main ul.grid').first();
  for (const pause of PAUSES) {
    for (const name of ['Popular movies', 'Trending', 'Popular series', 'Trending', 'Popular movies']) {
      await lists.getByRole('tab', { name }).click();
      if (pause) await page.waitForTimeout(pause);
    }
    await expect(lists.getByRole('tab', { name: 'Popular movies' })).toHaveAttribute('aria-selected', 'true');
    await expect(grid.getByRole('button').first()).toBeVisible();
    await settled(page);
  }
  // A switch replaces the grid, so titles that are in both lists animate like the rest.
  const before = await grid.elementHandle();
  await lists.getByRole('tab', { name: 'Trending' }).click();
  await expect.poll(() => before!.evaluate((el) => el.isConnected)).toBe(false);
  await settled(page);
});
