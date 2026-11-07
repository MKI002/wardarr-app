/* global document */
// Takes the screenshots and the hero images for the README from the demo
// build, so every picture shows the invented demo setup and matches the
// current UI.
//
//   pnpm --filter @wardarr/web build:demo
//   node scripts/screenshots/capture.mjs
//
// Writes docs/screenshots/*.png and docs/assets/{hero-dark,hero-light,
// social-preview}.png. Playwright comes from apps/e2e. Afterwards strip the
// metadata (`exiftool -all= -overwrite_original docs/screenshots/*.png`) and,
// if you like, shrink the files with a PNG quantizer.
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { chromium } = createRequire(path.join(repo, 'apps/e2e/package.json'))('@playwright/test');
const site = path.join(repo, 'apps/web/dist-demo');
const shots = path.join(repo, 'docs/screenshots');
const assets = path.join(repo, 'docs/assets');
if (!fs.existsSync(path.join(site, 'index.html'))) {
  console.error('Build the demo first: pnpm --filter @wardarr/web build:demo');
  process.exit(1);
}

// Desktop pages, in the order of the sidebar. Overview also gets a light
// version for the README header.
const PAGES = [
  ['overview', '/'],
  ['issues', '/issues'],
  ['map', '/map'],
  ['discover', '/discover'],
  ['requests', '/requests'],
  ['library', '/library'],
  ['calendar', '/calendar'],
  ['cleaner', '/cleaner'],
  ['hunting', '/hunting'],
  ['trash', '/trash'],
  ['tdarr', '/tdarr'],
  ['indexers', '/indexers'],
  ['indexer-insights', '/indexer-insights'],
  ['storage', '/storage'],
];

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

// Serve only the files the build produced; every other path gets the app
// shell, so a request path never reaches the file system.
const FILES = new Map(
  fs
    .readdirSync(site, { recursive: true })
    .map((rel) => path.join(site, rel))
    .filter((file) => fs.statSync(file).isFile())
    .map((file) => ['/' + path.relative(site, file).split(path.sep).join('/'), file]),
);
const server = http.createServer((req, res) => {
  const file = FILES.get((req.url ?? '/').split('?')[0]) ?? path.join(site, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

// Let the demo answer its first requests, then drop the demo banner.
async function settle(page) {
  await page.waitForTimeout(2200);
  await page.evaluate(() => document.querySelectorAll('body > [role=note]').forEach((n) => n.remove()));
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
}

const browser = await chromium.launch();
const options = { locale: 'en-US', reducedMotion: 'reduce' };

for (const scheme of ['dark', 'light']) {
  const desktop = await browser.newContext({
    ...options,
    colorScheme: scheme,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await desktop.newPage();
  for (const [name, route] of PAGES) {
    if (scheme === 'light' && name !== 'overview') continue;
    await page.goto(base + route);
    await settle(page);
    await page.screenshot({ path: path.join(shots, `${name}${scheme === 'light' ? '-light' : ''}.png`) });
  }
  if (scheme === 'dark') {
    await page.goto(base + '/');
    await settle(page);
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(400);
    await page.keyboard.type('rad', { delay: 60 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(shots, 'palette.png') });
  }
  await desktop.close();

  const phone = await browser.newContext({
    ...options,
    colorScheme: scheme,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const mobile = await phone.newPage();
  await mobile.goto(base + '/');
  await settle(mobile);
  await mobile.screenshot({ path: path.join(shots, `phone-${scheme}.png`) });
  await mobile.goto(base + '/library');
  await settle(mobile);
  await mobile.screenshot({ path: path.join(assets, `.phone-library-${scheme}.png`) });
  await phone.close();
}

// Hero images: the overview in a window with the library on a phone, on the
// night glow from the app. Colours follow docs/DESIGN.md.
const dataUri = (file, type = 'image/png') =>
  `data:${type};base64,${fs.readFileSync(file).toString('base64')}`;
const THEMES = {
  dark: { bg: '#0b0c13', glowA: '#9d8cff', glowB: '#4f7cff', glow: 0.28, frame: '#262838', bezel: '#1b1d29' },
  light: {
    bg: '#f3f2fb',
    glowA: '#7b66ff',
    glowB: '#4f9dff',
    glow: 0.22,
    frame: '#d9d8ea',
    bezel: '#ffffff',
  },
};
const css = (t) => `*{box-sizing:border-box;margin:0}
body{font-family:Inter,system-ui,sans-serif;background:${t.bg}}
.stage{position:relative;overflow:hidden;background:${t.bg}}
.glow{position:absolute;border-radius:50%;filter:blur(90px);opacity:${t.glow}}
.win{position:absolute;border-radius:18px;overflow:hidden;border:1px solid ${t.frame};box-shadow:0 40px 120px rgba(0,0,0,.45)}
.phone{position:absolute;border-radius:44px;overflow:hidden;border:10px solid ${t.bezel};box-shadow:0 40px 100px rgba(0,0,0,.5)}
img{display:block;width:100%}
h1{font:700 52px/1.1 Inter,system-ui,sans-serif;letter-spacing:-.02em;color:#e9eaf2}
p{font:400 24px/1.45 Inter,system-ui,sans-serif;color:#a3a6bd;margin-top:22px}`;

const canvas = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.5 });
for (const [scheme, t] of Object.entries(THEMES)) {
  const overview = dataUri(path.join(shots, scheme === 'dark' ? 'overview.png' : 'overview-light.png'));
  const library = dataUri(path.join(assets, `.phone-library-${scheme}.png`));
  await canvas.setContent(`<style>${css(t)}</style><div class="stage" style="width:1600px;height:900px">
    <div class="glow" style="width:900px;height:900px;left:-200px;top:-420px;background:${t.glowA}"></div>
    <div class="glow" style="width:800px;height:800px;right:-260px;bottom:-460px;background:${t.glowB}"></div>
    <div class="win" style="left:70px;top:70px;width:1280px"><img src="${overview}"></div>
    <div class="phone" style="right:60px;top:170px;width:300px"><img src="${library}"></div></div>`);
  await canvas.waitForTimeout(300);
  await canvas.screenshot({ path: path.join(assets, `hero-${scheme}.png`) });
}

// Social preview for the repository settings (1280 × 640).
const t = THEMES.dark;
await canvas.setViewportSize({ width: 1280, height: 640 });
await canvas.setContent(`<style>${css(t)}</style><div class="stage" style="width:1280px;height:640px">
  <div class="glow" style="width:760px;height:760px;left:-260px;top:-380px;background:${t.glowA}"></div>
  <div class="glow" style="width:700px;height:700px;right:-240px;bottom:-420px;background:${t.glowB}"></div>
  <div style="position:absolute;left:80px;top:150px;width:470px">
    <img src="${dataUri(path.join(assets, 'wardarr-lockup-on-dark.svg'), 'image/svg+xml')}" style="width:300px;margin-bottom:44px">
    <h1>One calm place for your whole media stack.</h1>
    <p>Self-hosted control center for the *arr apps, downloaders, media servers and Seerr.</p>
  </div>
  <div class="win" style="left:610px;top:90px;width:900px;border-radius:16px"><img src="${dataUri(path.join(shots, 'overview.png'))}"></div></div>`);
await canvas.waitForTimeout(300);
await canvas.screenshot({ path: path.join(assets, 'social-preview.png'), scale: 'css' });

for (const scheme of Object.keys(THEMES)) fs.rmSync(path.join(assets, `.phone-library-${scheme}.png`));
await browser.close();
server.close();
console.log('Screenshots written to docs/screenshots and docs/assets.');
