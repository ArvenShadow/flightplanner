#!/usr/bin/env node
/**
 * Drive the LOCKED build in real Chromium - `npm run verify:locked`.
 *
 * Nothing here can be checked with jsdom or by grepping, and that is the whole
 * reason this file exists:
 *
 *   1. WebCrypto. jsdom has no crypto.subtle, so the KDF and AES-GCM cannot
 *      run there at all.
 *   2. THE RELAUNCH. The gate replaces documentElement and then re-creates
 *      every <script> so the classic bundle lands at global scope in document
 *      order. Whether the app's 100-odd inline on*= handlers can see those
 *      globals afterwards is a question about a real browser's script
 *      execution, not about markup - and it is the one thing that would make
 *      this feature ship broken while every string check passed.
 *   3. THE LOCK ITSELF. "Wrong passphrase shows nothing" has to be measured on
 *      a real page, because the failure mode worth catching is an app that
 *      boots anyway.
 *   4. PER-BROWSER PERSISTENCE. A second load with the same storage must not
 *      ask again - and, just as important, must not ask again for the WRONG
 *      reason (a cached key that no longer decrypts).
 *
 * The server is inline rather than tools/serve.mjs so this verifier owns its
 * own port and cannot pass by talking to whatever is already running.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';

let chromium;
try { ({ chromium } = await import('playwright')); }
catch {
  console.error('playwright is not installed: npm install --no-save playwright');
  process.exit(1);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCKED = join(ROOT, 'site-locked');
const PASS = (process.env.SITE_PASSWORD
  || (existsSync(join(ROOT, '.site-password'))
      ? readFileSync(join(ROOT, '.site-password'), 'utf8') : '')).replace(/\r?\n$/, '');

if (!existsSync(join(LOCKED, 'index.html'))) {
  console.error('site-locked/ is missing - run `npm run lock` first.');
  process.exit(1);
}
if (!PASS) {
  console.error('no passphrase - set SITE_PASSWORD or create .site-password.');
  process.exit(1);
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
                '.enc': 'application/octet-stream' };
const PORT = 8189;
const server = createServer((req, res) => {
  let rel = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname))
    .replace(/^(\.\.[/\\])+/, '');
  if (rel === '/' || rel.endsWith('/')) rel = join(rel, 'index.html');
  const file = join(LOCKED, rel);
  if (!file.startsWith(LOCKED) || !existsSync(file)) { res.writeHead(404).end('nope'); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${PORT}/`;

const fails = [];
const check = (ok, label) => {
  console.log((ok ? '  ok    ' : '  FAIL  ') + label);
  if (!ok) fails.push(label);
};

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });

/** A fresh context is a fresh machine: no localStorage, so the gate must ask. */
async function freshPage() {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  // OFFLINE except this origin, exactly as the other verifiers do it: the
  // planner must unlock and boot with no internet at all.
  await ctx.route('**/*', (r) => r.request().url().startsWith(URL_) ? r.continue() : r.abort());
  await page.goto(URL_, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  return { ctx, page, errs };
}

const gateShowing = (page) => page.evaluate(() =>
  !!document.getElementById('pw') && !document.getElementById('map'));
const appShowing = (page) => page.evaluate(() =>
  !!document.getElementById('map') && !document.getElementById('pw'));

// ---- 1. THE DEPLOYED ARTIFACT CARRIES NO APP -----------------------------
// Measured on the bytes a visitor can actually fetch, not on the build log.
console.log('\n--- the artifact ---');
const gateHtml = readFileSync(join(LOCKED, 'index.html'), 'utf8');
const LEAKS = ['computeFlightSchedule', 'C182_AIP', 'Operational flightplan', 'APP_VERSION',
               'runIntegrityCheck', 'ENDU'];
const leaked = LEAKS.filter((n) => gateHtml.includes(n));
check(leaked.length === 0, 'the gate page contains none of the app: ' + JSON.stringify(leaked));
check(!gateHtml.includes(PASS), 'the gate page does not contain the passphrase');
// THE PAYLOAD NAMES ARE READ OUT OF THE GATE'S OWN METADATA, not listed here.
// Since v16.88 they carry the build id, so a fixed list would have to be
// edited every release - and, worse, a gate naming a file that was never
// written is exactly the failure this check exists to catch. Asking the gate
// what it will fetch is what makes that visible.
const META = JSON.parse(gateHtml.match(/var META = (\{.*?\});/)[1]);
const payloads = META.parts.map((p) => p.file);
check(payloads.length === 4 && payloads.every((f) => /^[a-z]+-[0-9a-f]{8}\.enc$/.test(f)),
  'the gate names four content-addressed payloads: ' + JSON.stringify(payloads));
for (const f of payloads) {
  check(existsSync(join(LOCKED, f)), `the gate asks for ${f}, and it was written`);
  const bytes = readFileSync(join(LOCKED, f)).toString('latin1');
  const found = LEAKS.filter((n) => bytes.includes(n));
  check(found.length === 0, `${f} is ciphertext, not text: ` + JSON.stringify(found));
}
// A plaintext asset left behind would make the whole exercise pointless.
check(!existsSync(join(LOCKED, 'app.js')) && !existsSync(join(LOCKED, 'aip.js')),
  'no plaintext app.js / aip.js was left in the locked build');
// The worker must precache what actually exists - addAll is atomic, so one
// 404 caches nothing and the app silently stops working offline (v16.45).
const swText = readFileSync(join(LOCKED, 'sw.js'), 'utf8');
check(payloads.every((f) => swText.includes("'./" + f + "'")) && !/'\.\/app\.js'/.test(swText),
  'the service worker precaches the locked payloads and not the plaintext ones');

// ---- 2. A VISITOR WITHOUT THE PASSPHRASE GETS NOTHING --------------------
console.log('\n--- no passphrase ---');
{
  const { ctx, page, errs } = await freshPage();
  check(await gateShowing(page), 'a fresh browser is asked for the passphrase');
  check(await page.evaluate(() => document.body.innerText.length < 400),
    'the gate page is a gate, not the app with a prompt over it');
  await page.fill('#pw', 'this-is-not-the-passphrase');
  await page.click('#go');
  await page.waitForTimeout(1500);
  check(await gateShowing(page), 'a wrong passphrase does not unlock it');
  check(/does not unlock/i.test(await page.innerText('#msg')),
    'it says the passphrase is wrong: ' + JSON.stringify(await page.innerText('#msg')));
  check(await page.evaluate(() => !window.computeFlightSchedule && !window.C182),
    'no app code ran on a wrong passphrase');
  check(errs.length === 0, 'no page errors while refusing: ' + errs.join(' | '));
  await ctx.close();
}

// ---- 3. THE RIGHT PASSPHRASE BOOTS THE REAL APP --------------------------
// This is the check the feature lives or dies on. Every string test in the
// suite would pass against a page that unlocks to a blank screen.
console.log('\n--- the right passphrase ---');
let storageState = null;
{
  const { ctx, page, errs } = await freshPage();
  const t0 = Date.now();
  await page.fill('#pw', PASS);
  await page.click('#go');
  await page.waitForFunction(() => !!document.getElementById('map'), null, { timeout: 20000 })
    .catch(() => {});
  await page.waitForTimeout(1200);
  const ms = Date.now() - t0;
  check(await appShowing(page), 'the right passphrase replaces the gate with the app');
  console.log(`        unlock to app: ${ms} ms (includes the one-time KDF)`);

  // THE BUNDLE REACHED GLOBAL SCOPE. This is the v16.45 constraint: the page's
  // inline on*= handlers resolve against globals, so a bundle that ran in some
  // other scope would leave a page that renders and does nothing.
  const globals = await page.evaluate(() => ({
    sched: typeof window.computeFlightSchedule,
    c182: typeof window.C182,
    aip: !!(window.C182_AIP && window.C182_AIP.features && window.C182_AIP.features.length),
    version: (document.getElementById('app-version-badge') || {}).textContent || ''
  }));
  check(globals.sched === 'function', 'the bundle is at global scope: ' + globals.sched);
  check(globals.c182 === 'object', 'window.C182 is present: ' + globals.c182);
  check(globals.aip, 'the AIP dataset decrypted and loaded');
  check(/16\./.test(globals.version), 'the version badge rendered: ' + JSON.stringify(globals.version));

  // THE PAGE SCRIPT RAN, and its top level is what seeds the plan. A relaunch
  // that skipped it would leave every bundle global defined and no flight.
  //
  // `flights` AND `aircraftProfile` ARE NOT ON `window`, and reading them
  // there is the trap CLAUDE.md names: they are declared `let` at the top
  // level of a classic script, which is a global LEXICAL binding - shared with
  // the bundle's IIFE, invisible as a window property. The first version of
  // this probe read window.flights, got undefined, and reported a correctly
  // booted app as never having run its page script. Bare identifiers, in a
  // try/catch for the temporal dead zone (`typeof` THROWS on a let that has
  // not been initialised yet, where an undeclared name would answer
  // 'undefined') - the same guard verify-visual.mjs needs.
  const booted = await page.evaluate(() => {
    let n = -1, prof = false;
    try { n = Array.isArray(flights) ? flights.length : -1; } catch (e) { /* dead zone */ }
    try { prof = typeof aircraftProfile === 'object' && aircraftProfile !== null; } catch (e) {}
    return { flights: n, profile: prof,
      rows: document.querySelectorAll('#flight-tables tr, .table-container tr').length };
  });
  check(booted.flights >= 1, 'the seed plan exists: ' + booted.flights + ' flight(s)');
  check(booted.profile, 'the page script ran (aircraftProfile is set up)');
  check(booted.rows > 0, 'the OFP table rendered: ' + booted.rows + ' rows');

  // THE REAL ENGINE, on the decrypted bundle, over a plan built here.
  //
  // A FRESH BROWSER HAS NO SAVED ROUTE, so the plan it boots with is the v16.49
  // empty state - one flight with nothing in it and therefore no legs. The
  // first version of this probe asked for schedule[0] of that and reported a
  // perfectly working engine as returning null. The plan has to be seeded.
  const computed = await page.evaluate(() => {
    flights = [{ id: 1, title: 'L', depElev: 254, waypoints: [
      { lat: 69.055, lng: 18.544, name: 'ENDU', alt: 254, oat: 5, wdir: 0, wspd: 0, var: -11 },
      { lat: 69.679, lng: 18.911, name: 'ENTC', alt: 3000, oat: 0, wdir: 0, wspd: 0, var: -12 }] }];
    activeFlightIndex = 0;
    refreshMap(); renderAllFlightTables();
    const s = window.computeFlightSchedule(flights[0]);
    return s && s[0] ? Number(s[0].distNM.toFixed(1)) : null;
  });
  // ENDU -> ENTC is a known leg: ~38 NM on the WGS-84 geodesic.
  check(typeof computed === 'number' && computed > 30 && computed < 45,
    'the decrypted engine computes the ENDU-ENTC leg: ' + computed + ' NM');
  check(await page.evaluate(() =>
    document.querySelectorAll('.table-container tr').length > 1),
    'and the decrypted page script rendered it into the OFP table');

  // THE VAC OVERLAY SURVIVES THE RELAUNCH, AND THIS IS NOT DECORATION. The
  // manifest is a separate <script src> in the plaintext page, so until it was
  // added to PARTS the decrypted page kept a link to a file site-locked/ does
  // not have: it 404s, window.C182_VAC is undefined, updateVacBtn HIDES the
  // control, and the whole feature is missing from the deployed copy with
  // nothing on screen to say so. Silent feature loss is the failure this
  // project refuses, so the deployed build is asked directly.
  const vac = await page.evaluate(async () => {
    const set = window.C182_VAC;
    if (!set) return { set: false };
    const c = set.charts.find((x) => window.vacDrawable(x));
    if (!c) return { set: true, charts: set.charts.length, drawable: 0 };
    // AND THE RASTER MUST REALLY FETCH. The manifest being present says the app
    // knows about 49 charts; only asking for one says the pictures shipped too.
    let status = 0;
    try { status = (await fetch((set.assetDir ? 'vac/' : '') + c.file)).status; } catch (e) { status = -1; }
    return { set: true, charts: set.charts.length, drawable: set.charts.filter((x) => window.vacDrawable(x)).length,
             file: c.file, status };
  });
  check(vac.set, 'the encrypted VAC manifest decrypted into the page: ' + JSON.stringify(vac));
  check(vac.drawable > 0, `${vac.drawable} of ${vac.charts} charts pass the gate in the locked build`);
  check(vac.status === 200, `and the raster itself is served: ${vac.file} -> HTTP ${vac.status}`);

  // AN INLINE HANDLER ACTUALLY FIRES. Driving a function would prove the
  // function; clicking is what proves the wiring survived the relaunch (the
  // v16.53 lesson). Last, because it mutates the plan the checks above read.
  const clicked = await page.evaluate(() => {
    const b = document.getElementById('undo-btn');
    if (!b) return 'no undo button';
    if (!b.getAttribute('onclick')) return 'the button has no inline handler to test';
    b.click();
    return 'fired';
  });
  check(clicked === 'fired', 'an inline on*= handler still resolves after the relaunch: ' + clicked);

  check(errs.length === 0, 'no page errors after unlocking: ' + errs.join(' | '));
  storageState = await ctx.storageState();
  await ctx.close();
}

// ---- 4. ONCE PER MACHINE ------------------------------------------------
console.log('\n--- remembered per browser ---');
{
  const ctx = await browser.newContext({ storageState });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await ctx.route('**/*', (r) => r.request().url().startsWith(URL_) ? r.continue() : r.abort());
  await page.goto(URL_, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!document.getElementById('map'), null, { timeout: 20000 })
    .catch(() => {});
  await page.waitForTimeout(600);
  check(await appShowing(page), 'the same browser is not asked again');
  check(await page.evaluate(() => typeof window.computeFlightSchedule === 'function'),
    'and the app really booted the second time, not just skipped the gate');
  // THE PASSPHRASE ITSELF IS NOT WHAT IS KEPT. Storing it would put it in
  // localStorage on every machine that ever unlocked; the derived key cannot
  // be turned back into it.
  const stored = await page.evaluate(() => localStorage.getItem('c182_unlock_v1') || '');
  check(!!stored, 'a key is remembered');
  check(!stored.includes(PASS), 'the stored value is not the passphrase');
  check(errs.length === 0, 'no page errors on the remembered load: ' + errs.join(' | '));
  await ctx.close();
}

// ---- 5. A STALE KEY ASKS AGAIN INSTEAD OF BREAKING ----------------------
// Rebuilding under a new passphrase changes the salt, so yesterday's cached
// key must read as "ask me again" rather than as a corrupt install.
console.log('\n--- a stale remembered key ---');
// THE REAL SALT comes from META, read out of the artifact above: the tamper
// case needs a key whose SALT MATCHES so the failure happens in decrypt()
// rather than in the cheap salt comparison. Guessing a salt would only
// re-test the rebuild case.
for (const [why, bad] of [
  ['a key from another build (a rebuild under a new passphrase)',
   { salt: 'AAAAAAAAAAAAAAAAAAAAAA==', key: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' }],
  ['a tampered key with this build\'s salt',
   { salt: META.salt, key: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' }]
]) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await ctx.route('**/*', (r) => r.request().url().startsWith(URL_) ? r.continue() : r.abort());
  await page.goto(URL_, { waitUntil: 'domcontentloaded' });
  await page.evaluate((v) => localStorage.setItem('c182_unlock_v1', JSON.stringify(v)), bad);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  check(await gateShowing(page), why + ' falls back to asking');
  check(await page.evaluate(() => !localStorage.getItem('c182_unlock_v1')),
    '...and is cleared rather than left to fail on every load');
  check(errs.length === 0, '...with no page errors: ' + errs.join(' | '));
  await ctx.close();
}

// ---- 6. A CACHED GATE FROM AN OLDER BUILD HEALS ITSELF ------------------
// THIS IS THE ONE THAT WOULD HAVE CAUGHT THE v16.87 LOCKOUT, and it is
// measured rather than reasoned about because the platform's own caching is
// half of the mechanism. GitHub Pages sends `cache-control: max-age=600` on
// every file, so for ten minutes after a deploy a browser can hold the OLD
// index.html while fetching NEW payloads - and before v16.88 both builds
// called their payloads the same thing, so the stale gate derived a key from
// the old salt, met fresh ciphertext, and told the pilot their CORRECT
// passphrase was wrong.
//
// The fixture serves the payload names the CURRENT gate does not know, which
// is the same thing from the browser's point of view: the gate asks for a file
// that is not there. What must happen is a self-heal, never a false accusation
// against the passphrase.
console.log('\n--- a gate older than the site it is talking to ---');
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  let navs = 0;
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) navs++; });
  // Everything is served as normal EXCEPT the payloads, which 404 the way
  // another build's would. The gate itself is untouched, so this measures the
  // gate's behaviour and not a doctored page.
  await ctx.route('**/*', (r) => {
    const u = r.request().url();
    if (!u.startsWith(URL_)) return r.abort();
    if (/-[0-9a-f]{8}\.enc$/.test(u)) return r.fulfill({ status: 404, body: 'gone' });
    return r.continue();
  });
  await page.goto(URL_, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#pw', { timeout: 10000 });
  await page.fill('#pw', PASS);
  await page.click('#go');
  await page.waitForTimeout(2500);
  const msg = await page.innerText('#msg').catch(() => '');
  check(!/does not unlock/i.test(msg),
    'a missing payload is NOT reported as a wrong passphrase: ' + JSON.stringify(msg));
  check(navs >= 2, 'the gate refreshed itself rather than waiting to be told: '
    + navs + ' navigation(s)');
  // AND IT MUST NOT LOOP. If the payloads really are absent - a half-finished
  // deploy - reloading for ever is worse than saying so. The second time round
  // it says what is wrong and stops.
  await page.waitForTimeout(1500);
  if (await page.$('#pw')) {
    await page.fill('#pw', PASS);
    await page.click('#go');
    await page.waitForTimeout(2000);
  }
  const msg2 = await page.innerText('#msg').catch(() => '');
  check(/out of date/i.test(msg2) && !/does not unlock/i.test(msg2),
    'a second failure says the page is out of date and stops: ' + JSON.stringify(msg2));
  // EXACTLY TWO: the first load and the one self-heal. `<= 3` was written here
  // first and PASSED with the once-per-session guard removed - the assert was
  // looser than the promise it was checking, which is the M5 trap by name.
  check(navs === 2, 'it reloaded once and only once: ' + navs + ' navigation(s)');
  check(errs.length === 0, 'no page errors while healing: ' + errs.join(' | '));
  await ctx.close();
}

await browser.close();
server.close();

if (fails.length) {
  console.error('\n' + fails.length + ' check(s) FAILED');
  process.exit(1);
}
console.log('\nall locked-build checks passed');
