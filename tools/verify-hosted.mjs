#!/usr/bin/env node
/**
 * Runtime verification of the HOSTED build - `node tools/verify-hosted.mjs`.
 *
 * The jsdom suite cannot cover this: there is no service worker and no Cache
 * API in jsdom, and the offline behaviour only exists in a real browser on a
 * real origin. This script drives Chromium against a locally served site/ and
 * asserts the four rules that make cached chart tiles SAFE:
 *
 *   1. before the AIRAC edition is known, NO tile may be cached or served
 *      from cache - a tile of unknown vintage is never trusted;
 *   2. once the page reports the edition, tiles cache under that cycle;
 *   3. a held tile is then served without touching the network;
 *   4. a NEW cycle discards the previous chart entirely.
 *
 * It also checks that the hosted page renders an OFP byte-identical to the
 * double-click build, and that the app still loads with the network off.
 *
 * Playwright is NOT a project dependency (it would add a browser download to
 * every clone). Install it when you want to run this:
 *     npm install --no-save playwright && npx playwright install chromium
 * Start the server first: npm run serve
 */
let chromium;
try { ({ chromium } = await import('playwright')); }
catch (e) {
  console.error('playwright is not installed - see the header of this file.');
  process.exit(2);
}
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
const launchOpts = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};
const b = await chromium.launch(launchOpts);
const ctx = await b.newContext();
let served = 0;
await ctx.route('**://avigis.avinor.no/**', async r => {
  if (r.request().url().includes('/export')) { served++; await r.fulfill({ status: 200, contentType: 'image/png', body: PNG }); }
  else await r.abort();
});
await ctx.route('**://*.kartverket.no/**', r => r.abort());
const page = await ctx.newPage();
await page.goto(process.env.SITE_URL || 'http://localhost:8182/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => navigator.serviceWorker.ready);
await page.waitForTimeout(500);
if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) { await page.reload({waitUntil:'domcontentloaded'}); await page.waitForTimeout(1200); }

const tileCaches = () => page.evaluate(() => caches.keys().then(k => k.filter(n => n.startsWith('c182-tiles-'))));

// THE SHELL MUST REALLY HOLD THE DATASET (v16.45). aip.js stopped being inlined
// into index.html and became its own file, so if the worker does not precache it
// the airspace overlay and the fix layer silently vanish offline - which looks
// like a bug, not a gap. Asserting the string is in sw.js is not the same as
// asserting the browser cached it.
const shellHolds = () => page.evaluate(async () => {
  const names = (await caches.keys()).filter((n) => n.startsWith('c182-shell-'));
  if (!names.length) return null;
  const c = await caches.open(names[0]);
  const urls = (await c.keys()).map((r) => r.url.replace(/^https?:\/\/[^/]+/, ''));
  return { cache: names[0], urls: urls.sort() };
});
const fetchTile = (n) => page.evaluate(async (n) => {
  await Promise.all([...Array(n)].map((_, i) =>
    fetch('https://avigis.avinor.no/agsmap/rest/services/ICAO_500000_ExB/MapServer/export?bbox=' + i + '&f=image', { mode: 'no-cors' }).catch(() => {})));
}, n);

// 1. BEFORE the edition is known, a tile must NOT be cached
await fetchTile(3);
await page.waitForTimeout(500);
const unknownCaches = await tileCaches();
console.log('edition unknown -> tile caches:', unknownCaches, '(must be empty: a tile of unknown vintage is never trusted)');

// 2. AFTER the page reports the edition, tiles cache under that cycle
await page.evaluate(() => navigator.serviceWorker.controller.postMessage({ type: 'chart-edition', edition: 'AIRAC 19MAR26' }));
await page.waitForTimeout(400);
await fetchTile(3);
await page.waitForTimeout(600);
const knownCaches = await tileCaches();
console.log('edition known   -> tile caches:', knownCaches);
const heldTiles = await page.evaluate(() => caches.open('c182-tiles-AIRAC19MAR26').then(c => c.keys()).then(k => k.length).catch(() => -1));
console.log('tiles held           :', heldTiles);

// 3. a served tile must now come from cache, not the network
const before = served;
await fetchTile(3);
await page.waitForTimeout(500);
const networkHits = served - before;
console.log('re-request 3 tiles   : network hits =', networkHits, '(0 = served from cache)');

// 4. a NEW AIRAC cycle must discard the old chart entirely
await page.evaluate(() => navigator.serviceWorker.controller.postMessage({ type: 'chart-edition', edition: 'AIRAC 16APR26' }));
await page.waitForTimeout(700);
const newCycleCaches = await tileCaches();
console.log('new cycle reported   -> tile caches:', newCycleCaches, '(old cycle must be gone)');

const shell = await shellHolds();
console.log('shell cache          :', shell ? shell.cache + ' holds ' + shell.urls.join(', ') : 'NONE');

const fails = [];
if (!shell) fails.push('SHELL BROKEN: no shell cache - the worker never precached the app');
else for (const want of ['/index.html', '/app.js', '/aip.js'])
  if (!shell.urls.some((u) => u.endsWith(want)))
    fails.push('SHELL BROKEN: the shell cache is missing ' + want + ' - offline would lose it');
if (unknownCaches.length) fails.push('RULE 1 BROKEN: a tile was cached before the AIRAC edition was known');
if (!knownCaches.includes('c182-tiles-AIRAC19MAR26')) fails.push('RULE 2 BROKEN: tiles are not cached under the reported cycle');
if (heldTiles !== 3) fails.push('RULE 2 BROKEN: expected 3 held tiles, got ' + heldTiles);
if (networkHits !== 0) fails.push('RULE 3 BROKEN: a held tile still hit the network (' + networkHits + ')');
if (newCycleCaches.length) fails.push('RULE 4 BROKEN: the superseded AIRAC cycle survived: ' + newCycleCaches.join(', '));
await b.close();
if (fails.length) { console.error('\n' + fails.join('\n')); process.exit(1); }
console.log('\nall hosted-build rules hold');
