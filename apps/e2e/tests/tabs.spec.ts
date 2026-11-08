// Switching tabs faster than the view transition must never leave a blank or
// half-faded view, the navigation (sidebar, rail, palette, phone menu) works,
// and the indexer insights tab shows what it found. Runs after stages 1 to 4,
// against the setup they created.
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
    ['Quality score', 'Overview', 'Quality score'],
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

// Reads where every app gets its indexers from and the numbers Prowlarr
// collected. Lives here to share the one sign-in.
test('the indexer insights tab shows sources, numbers and what needs a look', async () => {
  // The Indexers page links to the analysis.
  await page.goto('/indexers');
  await page.getByRole('link', { name: /Analysis and history/ }).click();
  await expect(page).toHaveURL(/\/indexer-insights/);
  await expect(page.getByRole('heading', { level: 1, name: 'Indexer insights' })).toBeVisible();

  // Read everything now instead of waiting for the next collection run.
  await page.getByRole('button', { name: 'Update now' }).click();
  const main = page.locator('main');

  // Radarr takes its indexer from Prowlarr; Radarr 4K also has one added by hand.
  const card = (name: string) =>
    main.locator('article', { has: page.getByRole('heading', { name, exact: true }) });
  await expect(card('Radarr').getByText('Prowlarr', { exact: true })).toBeVisible();
  await expect(card('Radarr 4K').getByText('Mixed', { exact: true })).toBeVisible();

  // The matrix names how each site gets into each app.
  const matrix = page.getByRole('table', { name: 'Which app gets which indexer, and how' });
  await expect(matrix.getByRole('img', { name: 'ExampleIndexer in Radarr: From Prowlarr' })).toBeVisible();
  await expect(matrix.getByRole('img', { name: 'Example Extra in Radarr 4K: Added by hand' })).toBeVisible();

  // Numbers from Prowlarr reach the comparison table.
  const table = page.getByRole('table', { name: 'Indexer comparison' });
  await expect(table.getByText('ExampleIndexer', { exact: true })).toBeVisible();

  // A mixed setup is worth a look.
  await expect(main.getByText(/mixes sources: 1 from Prowlarr, 1 added by hand/)).toBeVisible();

  // Switching the range keeps the page and the address in step.
  await page.getByRole('tab', { name: '30 days' }).click();
  await expect(page).toHaveURL(/range=30d/);
  await expect(table).toBeVisible();

  // The priority watchdog starts off and plans priorities from the scores.
  const daily = page.getByRole('switch', { name: 'Run every day' });
  await expect(daily).toHaveAttribute('aria-checked', 'false');
  await expect(
    main.getByRole('listitem', { name: /^ExampleIndexer, score \d+: priority 25 becomes 10$/ }),
  ).toBeVisible();
  // Prowlarr syncs Radarr fully, so Radarr is left to Prowlarr.
  await expect(
    main.getByText('Prowlarr passes every priority change on. Nothing to do in the app.').first(),
  ).toBeVisible();
  await daily.click();
  await expect(daily).toHaveAttribute('aria-checked', 'true');
  // A preview writes nothing and logs what it would change.
  await page.getByRole('button', { name: 'Preview now' }).click();
  await expect(main.getByText('Last preview', { exact: false })).toBeVisible();
  await expect(main.getByText('Nothing yet.', { exact: false })).toHaveCount(0);
  await daily.click();
  await expect(daily).toHaveAttribute('aria-checked', 'false');

  // Nothing may stay half faded after the charts came in.
  await settled(page);
});

// Shares this file's sign-in: the login route allows only a few attempts a minute.
test('the storage page shows each disk once, with the apps that use it, and settles', async () => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Main navigation' }).first();
  await nav.getByRole('link', { name: 'Storage', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Storage', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Check now' }).click();

  // Every app sees the same disk under /data: it is listed once.
  const media = page.getByRole('button', { name: /^\/data/ });
  await expect(media).toHaveCount(1);
  await expect(media).toContainText('2 TB free of 8 TB');
  await expect(media).toContainText('learning');
  // The container's own disk is listed apart; /etc/hosts is not a disk.
  await expect(page.getByRole('button', { name: /^\/ / })).toHaveCount(1);
  await expect(page.getByText('/etc/hosts')).toHaveCount(0);
  await expect(page.getByText('/data in detail')).toBeVisible();
  await expect(
    page.getByText('Wardarr is still learning how fast /data fills', { exact: false }),
  ).toBeVisible();
  await settled(page);
});

// ------------------------------------------------------------- navigation

const sidebar = () => page.getByRole('navigation', { name: 'Main navigation' }).first();

test('the sidebar groups pages into sections and marks the current one', async () => {
  await page.goto('/');
  for (const section of ['Status', 'Media', 'Automation', 'System']) {
    await expect(sidebar().getByRole('button', { name: section })).toBeVisible();
  }
  await sidebar().getByRole('link', { name: 'Queue Cleaner', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Queue Cleaner' })).toBeVisible();
  await expect(sidebar().getByRole('link', { name: 'Queue Cleaner', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('a folded section keeps the current page and stays folded after a reload', async () => {
  await page.goto('/cleaner');
  const automation = sidebar().getByRole('button', { name: 'Automation' });
  await automation.click();
  await expect(automation).toHaveAttribute('aria-expanded', 'false');
  await expect(sidebar().getByRole('link', { name: 'Hunting', exact: true })).toHaveCount(0);
  await expect(sidebar().getByRole('link', { name: 'Queue Cleaner', exact: true })).toBeVisible();
  await page.reload();
  await expect(sidebar().getByRole('button', { name: 'Automation' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await sidebar().getByRole('button', { name: 'Automation' }).click();
  await expect(sidebar().getByRole('link', { name: 'Hunting', exact: true })).toBeVisible();
});

test('the sidebar folds to an icon rail and back, remembered across reloads', async () => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  // Labels stay as accessible names in the rail.
  await expect(sidebar().getByRole('link', { name: 'Library', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
  await sidebar().getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toBeVisible();
});

test('the command palette jumps to pages, settings and services', async () => {
  await page.goto('/');
  // The shortcut listens once the app shell is up.
  await expect(sidebar()).toBeVisible();
  await page.keyboard.press('Control+k');
  const input = page.getByRole('combobox', { name: 'Go to' });
  await expect(input).toBeFocused();
  await input.fill('hunt');
  await expect(page.getByRole('option').first()).toContainText('Hunting');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Hunting' })).toBeVisible();

  // "/" opens it too; a German synonym finds the notifications settings.
  await page.locator('body').press('/');
  await input.fill('benachrichtigungen');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/section=notifications/);

  // Connected services are listed by name and open their settings.
  await page.keyboard.press('Control+k');
  await input.fill('sonarr');
  await expect(page.getByRole('option', { name: /Sonarr/ }).first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(input).toHaveCount(0);
});

test('on a phone the bottom bar opens a menu with every page', async () => {
  await page.setViewportSize({ width: 400, height: 860 });
  await page.goto('/');
  const bar = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(bar).toBeVisible();
  await bar.getByRole('button', { name: 'Menu' }).click();
  const menu = page.getByRole('dialog', { name: 'Menu' });
  await menu.getByRole('link', { name: 'TRaSH Guides' }).click();
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1, name: 'TRaSH Guides' })).toBeVisible();
  // The page is behind "Menu", so Menu is the highlighted entry.
  await expect(bar.getByRole('button', { name: 'Menu' })).toHaveClass(/text-accent/);
  await page.setViewportSize({ width: 1280, height: 720 });
});
