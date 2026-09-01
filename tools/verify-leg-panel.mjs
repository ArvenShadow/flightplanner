#!/usr/bin/env node
/**
 * The leg settings panel, in a real browser - `npm run verify:leg`.
 *
 * WHY jsdom IS NOT ENOUGH. The panel is opened by a REAL right-click on a
 * 20 px invisible hit-line over the route, and the pins it sets are drawn as
 * rotated ticks with chips beside them. test.js drives the stubbed handler and
 * proves the engine; only a browser proves the gesture reaches the line, that
 * the panel lands on screen, and that the four marks are actually painted
 * where they belong.
 *
 * It also re-checks the thing the gesture change put at risk: right-click used
 * to insert a waypoint outright, so the panel must not lose that, and a LEFT
 * click on the line must still bend it.
 *
 * Playwright is not a project dependency; install it when you need this:
 *   npm install --no-save playwright && npx playwright install chromium
 * (Set CHROME_PATH to use a browser already on the machine.)
 */
let chromium;
try { ({ chromium } = await import('playwright')); }
catch (e) { console.error('playwright is not installed - see the header of this file.'); process.exit(2); }

const APP = process.env.CURRENT || new URL('../dist/C182_FlightPlanner.html', import.meta.url).pathname;
const fails = [];
const check = (ok, msg) => { console.log((ok ? '  ok    ' : '  FAIL  ') + msg); if (!ok) fails.push(msg); };

const b = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await (await b.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.route('**://**/**', (r) => r.request().url().startsWith('file:') ? r.continue() : r.abort());
await page.goto('file://' + APP, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);

/** A north-south route so container points map predictably onto the track. */
await page.evaluate(async () => {
  closeHelpModal();
  flights = [{ id: 1, title: 'F1', depElev: 254, waypoints: [
    { lat: 68.40, lng: 18.50, name: 'ENDU', alt: 254,  oat: 5, wdir: 250, wspd: 15, var: -11 },
    { lat: 69.30, lng: 18.50, name: 'MID',  alt: 7500, oat: 0, wdir: 250, wspd: 20, var: -11 },
    { lat: 70.05, lng: 18.50, name: 'ENTC', alt: 1500, oat: 2, wdir: 260, wspd: 18, var: -12 }] }];
  activeFlightIndex = 0;
  map.setView([69.25, 18.5], 7, { animate: false });
  await new Promise((r) => setTimeout(r, 350));
  refreshMap(); renderAllFlightTables();
});
await page.waitForTimeout(280);

const ptOf = (lat, lng) => page.evaluate(([la, ln]) => {
  const p = map.latLngToContainerPoint([la, ln]);
  const r = document.getElementById('map').getBoundingClientRect();
  return [r.left + p.x, r.top + p.y];
}, [lat, lng]);

// ---- the gesture reaches the line ------------------------------------------
const before = await page.evaluate(() => flights[0].waypoints.length);
let at = await ptOf(68.75, 18.5);
await page.mouse.click(at[0], at[1], { button: 'right' });
await page.waitForTimeout(280);
const panel = await page.evaluate(() => {
  const el = document.getElementById('leg-modal');
  const box = el.querySelector('.modal').getBoundingClientRect();
  return { open: getComputedStyle(el).display === 'flex',
           title: document.getElementById('leg-modal-title').textContent.trim(),
           hint: document.getElementById('leg-hint').textContent.trim(),
           x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) };
});
check(panel.open, 'a real right-click on the track opened the panel');
check(/ENDU/.test(panel.title) && /MID/.test(panel.title), 'it named the leg clicked: ' + panel.title);
check(panel.w > 300 && panel.h > 200 && panel.y >= 0 && panel.y + panel.h <= 950 + 1,
  `the panel is on screen (${panel.x},${panel.y} ${panel.w}x${panel.h})`);
check(/NM after ENDU/.test(panel.hint) && /NM before MID/.test(panel.hint),
  'it states where the click landed: ' + panel.hint);
check(await page.evaluate(() => flights[0].waypoints.length) === before,
  'right-clicking did not alter the route by itself');

// ---- "Here" turns the gesture into the number ------------------------------
await page.evaluate(() => document.getElementById('leg-boc-here').click());
await page.waitForTimeout(200);
const seeded = await page.evaluate(() => ({
  boc: document.getElementById('leg-boc').value,
  preview: document.getElementById('leg-preview').innerText.replace(/\n+/g, ' | ')
}));
check(Number(seeded.boc) > 1, 'the Here button seeded the BOC: ' + seeded.boc);
check(/BOC|Climb/i.test(seeded.preview) && /starts/i.test(seeded.preview),
  'the preview describes the pinned climb: ' + seeded.preview);
console.log('        preview: ' + seeded.preview);

// A target the profile cannot meet must be WARNED about before applying, and
// the warning must carry the rate it would actually need. The BOC is cleared
// first: with a BOC of 20 NM and a target of 3 NM the two pins CONTRADICT each
// other, which is a different message and is checked separately below.
await page.evaluate(() => {
  document.getElementById('leg-boc').value = '';
  document.getElementById('leg-toc').value = '4';
  updateLegPreview();
});
await page.waitForTimeout(150);
const warned = await page.evaluate(() => {
  const w = document.querySelector('#leg-preview .leg-warn');
  return w ? { text: w.innerText, h: Math.round(w.getBoundingClientRect().height) } : null;
});
check(!!warned && /ft\/min/.test(warned.text) && warned.h > 10,
  'an impossible "be level by" is warned about, with the rate it would need: ' + (warned ? warned.text : 'no warning'));

// A "be level by" target OWNS the bottom of climb, so the BOC box must stop
// taking input and say so - two settings for one corner is how a contradiction
// arises in the first place.
const owned = await page.evaluate(() => ({
  disabled: document.getElementById('leg-boc').disabled,
  note: getComputedStyle(document.getElementById('leg-boc-note')).display
}));
check(owned.disabled && owned.note !== 'none',
  'the BOC box is derived and says so while a target is set: ' + JSON.stringify(owned));

// back to just the BOC for the rest of the run. updateLegPreview() must run
// BEFORE the click: it is what re-enables the button, and clicking a disabled
// one silently does nothing.
await page.evaluate(() => {
  document.getElementById('leg-toc').value = '';
  updateLegPreview();
  document.getElementById('leg-boc-here').click();
  updateLegPreview();
});
check(await page.evaluate(() => !document.getElementById('leg-boc').disabled),
  'clearing the target hands the BOC box back');

await page.evaluate(() => saveLegSettings());   // Apply - the button is
// wired to this; the GESTURE is what this file is testing, not the click target.
await page.waitForTimeout(320);
const applied = await page.evaluate(() => ({
  boc: flights[0].waypoints[1].bocNM,
  closed: getComputedStyle(document.getElementById('leg-modal')).display !== 'flex',
  climbStart: computeFlightSchedule(flights[0])[0].climbStartNM
}));
check(applied.closed, 'Apply closed the panel');
check(applied.boc > 1 && Math.abs(applied.boc - applied.climbStart) < 1e-6,
  'the pin reached the schedule: pin ' + applied.boc + ', climb starts ' + applied.climbStart);

// ---- the ALTITUDE advice, and the one-click fix ---------------------------
// A target on a LATER leg that does not fit must offer the altitude the
// previous fix needs - and pressing the button must actually satisfy it.
await page.evaluate(async () => {
  flights = [{ id: 1, title: 'F2', depElev: 254, waypoints: [
    { lat: 68.40, lng: 18.50, name: 'ENDU', alt: 254,  oat: 5, wdir: 0, wspd: 0, var: -11 },
    { lat: 69.20, lng: 18.50, name: 'MID',  alt: 2500, oat: 0, wdir: 0, wspd: 0, var: -11 },
    { lat: 69.95, lng: 18.50, name: 'ENTC', alt: 7500, oat: 0, wdir: 0, wspd: 0, var: -12 }] }];
  activeFlightIndex = 0;
  map.setView([69.58, 18.5], 8, { animate: false });
  await new Promise((r) => setTimeout(r, 320));
  applyZoomDeclutter(); refreshMap(); renderAllFlightTables();
});
await page.waitForTimeout(320);
const mid2 = await page.evaluate(() => {
  const b = map.getBounds();
  const p = map.latLngToContainerPoint([(b.getSouth() + b.getNorth()) / 2, 18.5]);
  const r = document.getElementById('map').getBoundingClientRect();
  return [r.left + p.x, r.top + p.y];
});
await page.mouse.click(mid2[0], mid2[1], { button: 'right' });
await page.waitForTimeout(320);
const onMid = await page.evaluate(() => document.getElementById('leg-modal-title').textContent);
check(/MID/.test(onMid), 'the panel opened on the MID leg: ' + onMid);
await page.evaluate(() => { document.getElementById('leg-toc').value = '5'; updateLegPreview(); });
await page.waitForTimeout(200);
const advice = await page.evaluate(() => {
  const w = document.querySelector('#leg-preview .leg-warn');
  return { text: w ? w.innerText : '', hasButton: !!document.querySelector('#leg-preview .leg-warn button') };
});
check(/Cross MID at/.test(advice.text) && advice.hasButton,
  'it offers the altitude MID needs, with a button: ' + JSON.stringify(advice.text));
await page.evaluate(() => document.querySelector('#leg-preview .leg-warn button').click());
await page.waitForTimeout(400);
// The button raises the fix straight away (it is a route edit, and undoable);
// the target itself is still only in the form until Apply, so the PREVIEW is
// what shows whether the advice worked.
const afterFix = await page.evaluate(() => ({
  midAlt: flights[0].waypoints[1].alt,
  warn: !!document.querySelector('#leg-preview .leg-warn'),
  preview: document.getElementById('leg-preview').innerText.replace(/\n+/g, ' | ')
}));
check(afterFix.midAlt > 2500, 'the button raised MID: ' + afterFix.midAlt + ' ft');
check(!afterFix.warn, 'the warning is gone once the advice is taken: ' + afterFix.preview);
// Now commit the target and confirm the schedule really lands on it.
await page.evaluate(() => saveLegSettings());
await page.waitForTimeout(320);
const committed = await page.evaluate(() => {
  const S = computeFlightSchedule(flights[0])[1];
  return { pin: flights[0].waypoints[2].tocNM, met: S.tocTargetMet, toc: S.tocAlongNM };
});
check(committed.pin === 5, 'the target was stored: ' + committed.pin);
check(committed.met && Math.abs(committed.toc - 5) < 0.05,
  'the schedule lands on the target - TOC at ' + (committed.toc && committed.toc.toFixed(3)) + ' NM against 5');

// ---- the pinned corners are PAINTED ---------------------------------------
// Rebuild the route with BOTH pins set, so all four marks exist at once, and
// ZOOM IN: the declutter feature hides the TOC/TOD chips and ticks at far zoom
// on purpose (`#map.zoom-far .toc-label`), so measuring them at zoom 7 reads
// display:none and says nothing about whether they were drawn where they belong.
await page.evaluate(async () => {
  flights = [{ id: 1, title: 'F1', depElev: 254, waypoints: [
    { lat: 68.40, lng: 18.50, name: 'ENDU', alt: 254,  oat: 5, wdir: 250, wspd: 15, var: -11 },
    { lat: 69.30, lng: 18.50, name: 'MID',  alt: 7500, oat: 0, wdir: 250, wspd: 20, var: -11, bocNM: 20 },
    { lat: 70.05, lng: 18.50, name: 'ENTC', alt: 1500, oat: 2, wdir: 260, wspd: 18, var: -12, bodNM: 6 }] }];
  activeFlightIndex = 0;
  map.setView([69.0, 18.5], 9, { animate: false });
  await new Promise((r) => setTimeout(r, 320));
  applyZoomDeclutter(); refreshMap(); renderAllFlightTables();
});
await page.waitForTimeout(320);
const zoomCls = await page.evaluate(() => document.getElementById('map').className);
check(!/zoom-far|zoom-mid/.test(zoomCls), 'the map is at a zoom that shows labels: ' + JSON.stringify(zoomCls));

// EACH MARK MUST SIT WHERE THE SCHEDULE SAYS. Comparing the chip's screen
// position against the projection of the marker's own lat/lng is the real
// check and it does not care which part of the route is in view - asserting
// "on screen" instead just measures the viewport.
const marks = await page.evaluate(() => {
  const out = { kinds: [], zeroSized: 0, ticks: 0, misplaced: [], checked: 0 };
  for (const el of document.querySelectorAll('.toc-label, .tod-label')) {
    const r = el.getBoundingClientRect();
    out.kinds.push(el.textContent.trim());
    if (r.width < 5 || r.height < 5) out.zeroSized++;
  }
  for (const el of document.querySelectorAll('.prof-tick')) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) out.ticks++;
  }
  const mr = document.getElementById('map').getBoundingClientRect();
  for (const m of profileMarkers) {
    const ll = m.getLatLng();
    const want = map.latLngToContainerPoint(ll);
    const icon = m._icon;
    if (!icon) continue;
    const got = icon.getBoundingClientRect();
    out.checked++;
    // The icon's anchor is its top-left at [0,0], so the marker's own point is
    // exactly there; the tick and chip are transformed off it.
    const dx = Math.abs((got.left - mr.left) - want.x), dy = Math.abs((got.top - mr.top) - want.y);
    if (dx > 2 || dy > 2) out.misplaced.push({ dx: Math.round(dx), dy: Math.round(dy) });
  }
  return out;
});
const has = (k) => marks.kinds.some((t) => t.includes(k));
check(has('TOC') && has('TOD'), 'TOC and TOD are drawn: ' + marks.kinds.join(', '));
check(has('BOC'), 'the pinned BOC is drawn: ' + marks.kinds.join(', '));
check(has('BOD'), 'the pinned BOD is drawn: ' + marks.kinds.join(', '));
check(marks.zeroSized === 0, `every chip has a real box (${marks.kinds.length} chips, ${marks.ticks} ticks)`);
check(marks.checked === 4 && marks.misplaced.length === 0,
  `all ${marks.checked} marks are drawn at their own coordinate` +
  (marks.misplaced.length ? ' - off by ' + JSON.stringify(marks.misplaced) : ''));

// ---- the old capabilities survive the gesture change ----------------------
// Back to a view that holds the whole route, or the clicks below land on empty
// map instead of on the track.
await page.evaluate(async () => {
  map.setView([69.25, 18.5], 7, { animate: false });
  await new Promise((r) => setTimeout(r, 300));
  applyZoomDeclutter(); refreshMap();
});
await page.waitForTimeout(320);
const n0 = await page.evaluate(() => flights[0].waypoints.length);
at = await ptOf(68.75, 18.5);
await page.mouse.click(at[0], at[1], { button: 'right' });
await page.waitForTimeout(350);
// NOT awaited as a promise: insertWaypointFromLegPanel() does not resolve
// until the naming dialog is answered, and page.evaluate waits for whatever
// the function returns - so returning it deadlocks against the answer below.
await page.evaluate(() => { insertWaypointFromLegPanel(); });
await page.waitForTimeout(280);
const asked = await page.evaluate(() =>
  [...document.querySelectorAll('#app-dialog .dlg-title')].map((x) => x.textContent));
check(asked.length === 1 && /Insert a waypoint/i.test(asked[0]),
  'the panel still offers the old insert action: ' + JSON.stringify(asked));
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('#app-dialog .dlg-btn')].find((x) => /insert waypoint/i.test(x.textContent));
  if (btn) btn.click();
});
await page.waitForTimeout(320);
check(await page.evaluate(() => flights[0].waypoints.length) === n0 + 1,
  'it inserted the waypoint');

// A LEFT click on the line must still bend it - that gesture was untouched.
const via0 = await page.evaluate(() => (flights[0].waypoints[1].via || []).length);
at = await ptOf(68.60, 18.5);
await page.mouse.click(at[0], at[1]);
await page.waitForTimeout(320);
const via1 = await page.evaluate(() =>
  flights[0].waypoints.reduce((n, w) => n + ((w.via || []).length), 0));
check(via1 > via0, `a left click on the line still drops a via point (${via0} -> ${via1})`);

check(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
await b.close();
if (fails.length) { console.error('\n' + fails.length + ' check(s) FAILED'); process.exit(1); }
console.log('\nall leg-panel checks passed');
