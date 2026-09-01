#!/usr/bin/env node
/**
 * The position-dependent area-control frequency, in a real browser -
 * `node tools/verify-airspace-hover.mjs`.
 *
 * WHY THIS CANNOT BE A jsdom TEST. Polaris CTA is ONE airspace over the whole
 * country, so its published block lists all 26 VHF sector frequencies and the
 * card has to pick the one for the sector under the cursor. That means the
 * tooltip content is rebuilt on `mousemove` - a real pointer, a real Leaflet
 * sticky tooltip, real hit-testing through the airspace pane. test.js proves
 * the LOOKUP (src/lib/airspace.js, pure, over a grid); only a browser proves
 * the card the pilot actually sees changes as they move.
 *
 * Playwright is not a project dependency; install it when you need this:
 *   npm install --no-save playwright && npx playwright install chromium
 * (Set CHROME_PATH to use a browser that is already on the machine.)
 *
 * Runs OFFLINE on purpose: every non-file:// request is aborted, so the
 * overlay is proved to work with no chart tiles at all.
 */
let chromium;
try { ({ chromium } = await import('playwright')); }
catch (e) { console.error('playwright is not installed - see the header of this file.'); process.exit(2); }

const APP = process.env.CURRENT || new URL('../dist/C182_FlightPlanner.html', import.meta.url).pathname;

/**
 * Two points chosen from the dataset, both inside a Polaris CTA volume and
 * inside NO other airspace (so the CTA is the topmost polygon under the
 * cursor), one in each of the two sectors that cover the user's region.
 * Sorkjosen is the case that prompted this: hovering there used to list all
 * 26 Polaris frequencies.
 */
const SECTOR_26 = { at: [69.6, 21.6], mhz: '126.705', label: 'Sector 26' };
const SECTOR_25 = { at: [68.6, 18.0], mhz: '126.455', label: 'Sector 25' };

const fails = [];
const check = (ok, msg) => { console.log((ok ? '  ok    ' : '  FAIL  ') + msg); if (!ok) fails.push(msg); };

const b = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.route('**://**/**', (r) => r.request().url().startsWith('file:') ? r.continue() : r.abort());
await page.goto('file://' + APP, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);

await page.evaluate(() => {
  closeHelpModal();
  aircraftProfile.airspaceOn = true;
  updateAirspaceBtn();
  map.setView([69.1, 19.8], 7);
  drawAirspace();
});
await page.waitForTimeout(600);

const drawn = await page.evaluate(() => airspaceLayers.length);
check(drawn > 0, drawn + ' airspace polygons drawn at zoom 7');

/** Hover a lat/lng and read back the card. */
async function hover(at) {
  const p = await page.evaluate((at) => {
    const pt = map.latLngToContainerPoint(at);
    const r = document.getElementById('map').getBoundingClientRect();
    return { x: r.left + pt.x, y: r.top + pt.y };
  }, at);
  await page.mouse.move(p.x - 30, p.y - 30);
  await page.waitForTimeout(120);
  await page.mouse.move(p.x, p.y, { steps: 6 });
  await page.waitForTimeout(350);
  return page.$$eval('.airspace-tip', (els) => els.map((e) => ({
    w: Math.round(e.getBoundingClientRect().width),
    h: Math.round(e.getBoundingClientRect().height),
    rows: e.querySelectorAll('.as-tag').length,
    text: e.innerText.replace(/\n+/g, ' | ')
  })));
}

for (const c of [SECTOR_26, SECTOR_25]) {
  const tips = await hover(c.at);
  check(tips.length === 1, 'exactly one card visible at ' + c.at + ' (got ' + tips.length + ')');
  const t = tips[0] || { text: '', rows: 0, w: 0, h: 0 };
  console.log('        ' + t.w + 'x' + t.h + '  ' + JSON.stringify(t.text));
  check(/^Polaris CTA/.test(t.text), 'the card is for the Polaris CTA');
  check(t.rows === 1, 'ONE service row, not 26 (got ' + t.rows + ')');
  check(t.text.includes(c.mhz), 'names ' + c.mhz);
  check(t.text.includes(c.label), 'names ' + c.label);
  // The whole point: the OTHER sector's frequency must be gone.
  const other = c === SECTOR_26 ? SECTOR_25 : SECTOR_26;
  check(!t.text.includes(other.mhz), 'does not carry ' + other.label + "'s frequency");
  check(t.w < 420 && t.h < 200, 'the card stays compact (' + t.w + 'x' + t.h + ')');
}

// The card must be REBUILT in place as the cursor moves, not only on entry:
// the second hover above already re-entered the polygon, so drive one
// continuous move across the sector seam without leaving the airspace.
const seam = await page.evaluate(async (pts) => {
  const cp = (at) => { const p = map.latLngToContainerPoint(at); const r = document.getElementById('map').getBoundingClientRect(); return [r.left + p.x, r.top + p.y]; };
  return { a: cp(pts[0]), b: cp(pts[1]) };
}, [SECTOR_26.at, SECTOR_25.at]);
await page.mouse.move(seam.a[0], seam.a[1], { steps: 4 });
await page.waitForTimeout(300);
const before = (await page.$$eval('.airspace-tip', (e) => e.map((x) => x.innerText)))[0] || '';
await page.mouse.move(seam.b[0], seam.b[1], { steps: 40 });   // one continuous drag
await page.waitForTimeout(300);
const after = (await page.$$eval('.airspace-tip', (e) => e.map((x) => x.innerText)))[0] || '';
check(/126\.705/.test(before) && /126\.455/.test(after),
  'one continuous move across the seam re-resolved the sector (' +
  (before.match(/1\d\d\.\d\d\d/) || ['-'])[0] + ' -> ' + (after.match(/1\d\d\.\d\d\d/) || ['-'])[0] + ')');

// And the airspace must still not eat a route gesture: airspace draws in its
// own pane BELOW the overlay pane, the polygons carry no click handler and
// leave bubblingMouseEvents at its default, so a click inside a TMA reaches
// the map and starts adding a waypoint exactly as it does over bare chart.
const before2 = await page.evaluate(() => flights[activeFlightIndex].waypoints.length);
const clickAt = await page.evaluate(() => {
  const p = map.latLngToContainerPoint([69.6, 21.6]);
  const r = document.getElementById('map').getBoundingClientRect();
  return [r.left + p.x, r.top + p.y];
});
await page.mouse.click(clickAt[0], clickAt[1]);   // a REAL click, through the panes
await page.waitForTimeout(400);
// The map's click handler asks for the waypoint's name first, so the proof the
// click arrived is the dialog - then answering it adds the waypoint.
const asked = await page.$$eval('#app-dialog .dlg-title', (e) => e.map((x) => x.textContent));
check(asked.length === 1 && /waypoint|departure/i.test(asked[0]),
  'the click reached the map through the airspace (dialog: ' + JSON.stringify(asked) + ')');
await page.evaluate(() => {
  const b = [...document.querySelectorAll('#app-dialog .dlg-btn')]
    .find((x) => /add (waypoint|departure)/i.test(x.textContent));
  if (b) b.click();
});
await page.waitForTimeout(400);
const added = await page.evaluate(() => flights[activeFlightIndex].waypoints.length) - before2;
check(added === 1, 'a click inside the airspace still adds a waypoint (delta ' + added + ')');

check(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
await b.close();

if (fails.length) { console.error('\n' + fails.length + ' check(s) FAILED'); process.exit(1); }
console.log('\nall airspace-hover checks passed');
