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

const APP = process.env.CURRENT || new URL('../site/index.html', import.meta.url).pathname;
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
// v16.76: THE BOC BOX IS ALWAYS A DERIVED DISPLAY. There is one target field
// now, so the bottom of climb is never an input - reading it back as one fed
// the derived value straight into the write.
check(await page.evaluate(() => document.getElementById('leg-boc').readOnly),
  'the BOC box is a derived, read-only display');

await page.evaluate(() => saveLegSettings());   // Apply - the button is
// wired to this; the GESTURE is what this file is testing, not the click target.
await page.waitForTimeout(320);
const applied = await page.evaluate(() => ({
  target: flights[0].waypoints[1].altAtNM,
  closed: getComputedStyle(document.getElementById('leg-modal')).display !== 'flex',
  climbStart: computeFlightSchedule(flights[0])[0].climbStartNM
}));
check(applied.closed, 'Apply closed the panel');
// THE OBSERVABLE IS WHERE THE CLIMB STARTS, not the stored number: "start the
// climb here" is the same attain-by target one climb-length further on.
check(applied.target > 1 && applied.climbStart > 1,
  'the target reached the schedule: target ' + applied.target + ', climb starts ' + applied.climbStart);

// ---- an unreachable target on a LATER leg (v16.77) ------------------------
// It is REPORTED and nothing is rewritten. This block used to check the offer
// to raise MID, and the button that took it.
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
// AN UNREACHABLE TARGET IS REPORTED AND NOTHING ELSE HAPPENS (v16.77).
// Until v16.76 this warning carried a "Do that" button that RAISED MID to the
// altitude the climb passes through. The pilot retired it: "I set what altitude
// i plan on using, not the exact altitude i will have at that point." So the
// panel states the problem, offers no button, and MID keeps its 2500 ft.
await page.evaluate(() => { document.getElementById('leg-toc').value = '5'; updateLegPreview(); });
await page.waitForTimeout(200);
const reported = await page.evaluate(() => {
  const w = document.querySelector('#leg-preview .leg-warn');
  return { text: w ? w.innerText : '',
           hasButton: !!document.querySelector('#leg-preview .leg-warn button'),
           midAlt: flights[0].waypoints[1].alt };
});
check(/cannot be level/.test(reported.text) && /ft\/min/.test(reported.text),
  'an unreachable target was not reported with the rate it would need: ' + JSON.stringify(reported.text));
check(/no altitude you typed is changed/.test(reported.text),
  'the report does not promise the altitudes are left alone: ' + JSON.stringify(reported.text));
check(!reported.hasButton,
  'the removed "raise the previous fix" button is still offered');
check(reported.midAlt === 2500, 'MID was rewritten by a preview: ' + reported.midAlt + ' ft');
// APPLYING IT MUST ALSO LEAVE MID ALONE. The panel commits the target it was
// given; whether the climb reaches it is reported, never bargained for.
await page.evaluate(() => saveLegSettings());
await page.waitForTimeout(320);
const applied2 = await page.evaluate(() => ({
  midAlt: flights[0].waypoints[1].alt, pin: flights[0].waypoints[2].altAtNM,
  banner: getComputedStyle(document.getElementById('integrity-banner')).display
}));
check(applied2.midAlt === 2500, 'Apply rewrote MID: ' + applied2.midAlt + ' ft');
check(applied2.pin === 5, 'the target was not stored: ' + applied2.pin);

// A REACHABLE TARGET ON THE SAME LEG IS HONOURED, and still touches no
// altitude - which is the whole of the v16.76 one-field model.
const reach = await page.evaluate(() => {
  const S = computeFlightSchedule(flights[0])[1];
  return { dist: S.distNM, natural: S.tocAlongNM };
});
const want = Math.round(reach.dist - 2);
await page.evaluate((v) => {
  openLegPanel(0, L.latLng(69.58, 18.5));   // the MID -> ENTC leg
  document.getElementById('leg-toc').value = String(v);
  updateLegPreview();
  saveLegSettings();
}, want);
await page.waitForTimeout(320);
const committed = await page.evaluate(() => {
  const S = computeFlightSchedule(flights[0])[1];
  return { pin: flights[0].waypoints[2].altAtNM, met: S.tocTargetMet, toc: S.tocAlongNM,
           midAlt: flights[0].waypoints[1].alt };
});
check(committed.pin === want, 'the reachable target was not stored: ' + committed.pin);
check(committed.met && Math.abs(committed.toc - want) < 0.1,
  'the schedule did not top out on the target - TOC at ' +
  (committed.toc && committed.toc.toFixed(3)) + ' NM against ' + want);
check(committed.midAlt === 2500,
  'honouring a reachable target rewrote MID: ' + committed.midAlt + ' ft');

// ...and the map paints exactly one top of climb for it.
await page.evaluate(() => { map.setView([69.2, 18.5], 9, { animate: false }); });
await page.waitForTimeout(400);
await page.evaluate(() => { applyZoomDeclutter(); refreshMap(); });
await page.waitForTimeout(320);
const painted = await page.evaluate(() => ({
  labels: [...document.querySelectorAll('.toc-label, .tod-label')].map((el) => el.textContent.trim()),
  climbing: computeFlightSchedule(flights[0]).filter((L) => L && L.climbDistNM > 0.05).length
}));
// ONE TOP PER CLIMB, counted over the whole flight: with a target part way
// along the second leg the FIRST leg legitimately climbs to MID as well, so
// asserting a single mark would assert a plan this is not.
check(painted.labels.filter((t) => /TOC/.test(t) && !/BOC/.test(t)).length === painted.climbing,
  'each climb paints exactly one TOC: ' + JSON.stringify(painted));
check(painted.labels.some((t) => /BOC/.test(t)),
  'the delayed climb painted no bottom-of-climb ring: ' + JSON.stringify(painted.labels));

// ---- A STUCK DRAG HAS AN EXIT (v16.46) ------------------------------------
// The drag used to end only on a mouseup, so Escape / a blur / a right-click
// left the map with dragging disabled and the via following a button-less
// cursor. jsdom cannot prove the map was given back; measure it.
await page.evaluate(async () => {
  flights = [{ id: 1, title: 'D', depElev: 254, waypoints: [
    { lat: 68.50, lng: 18.50, name: 'A', alt: 254,  oat: 0, wdir: 0, wspd: 0, var: -11 },
    { lat: 69.50, lng: 18.50, name: 'B', alt: 3000, oat: 0, wdir: 0, wspd: 0, var: -11 }] }];
  activeFlightIndex = 0;
  map.setView([69.0, 18.5], 8, { animate: false });
  await new Promise((r) => setTimeout(r, 320));
  refreshMap(); renderAllFlightTables();
});
await page.waitForTimeout(320);
const midPt = await page.evaluate(() => {
  const p = map.latLngToContainerPoint([69.0, 18.5]);
  const r = document.getElementById('map').getBoundingClientRect();
  return [r.left + p.x, r.top + p.y];
});
const viaCount = () => page.evaluate(() =>
  (flights[0].waypoints[1].via || []).length);
check(await viaCount() === 0, 'the route starts with no via points');
await page.mouse.move(midPt[0], midPt[1]);
await page.mouse.down();
await page.mouse.move(midPt[0] + 40, midPt[1] + 25, { steps: 6 });
await page.waitForTimeout(120);
const mid = await page.evaluate(() => ({ dragging: !!lineDrag, mapDrag: map.dragging.enabled() }));
check(mid.dragging && mid.mapDrag === false,
  'a press-drag really captured the map: ' + JSON.stringify(mid));
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
const freed = await page.evaluate(() => ({ dragging: !!lineDrag, mapDrag: map.dragging.enabled() }));
check(!freed.dragging, 'Escape ended the drag');
check(freed.mapDrag === true, 'Escape gave map panning back: ' + JSON.stringify(freed));
check(await viaCount() === 0, 'Escape took the via back out');
// ...and the map is usable again: a fresh drag must still work.
await page.mouse.up();
await page.mouse.move(midPt[0], midPt[1]);
await page.mouse.down();
await page.mouse.move(midPt[0] + 30, midPt[1] + 15, { steps: 4 });
await page.mouse.up();
await page.waitForTimeout(250);
check(await viaCount() === 1, 'a new drag after the abort still bends the line');

// ---- right-clicking a WAYPOINT is the OTHER panel (v16.40) -----------------
// A waypoint sits ON the route line, and right-clicking the line opens the leg
// panel. jsdom cannot prove which one a real right-click reaches, so measure it:
// the waypoint menu must open and the leg panel must NOT.
await page.evaluate(async () => {
  flights = [{ id: 1, title: 'F3', depElev: 254, waypoints: [
    { lat: 68.40, lng: 18.50, name: 'ENDU', alt: 254,  oat: 5, wdir: 0, wspd: 0, var: -11 },
    { lat: 69.20, lng: 18.50, name: 'MID',  alt: 2500, oat: 0, wdir: 0, wspd: 0, var: -11 },
    { lat: 69.95, lng: 18.50, name: 'ENTC', alt: 4500, oat: 0, wdir: 0, wspd: 0, var: -12 }] }];
  activeFlightIndex = 0;
  map.setView([69.2, 18.5], 8, { animate: false });
  await new Promise((r) => setTimeout(r, 320));
  applyZoomDeclutter(); refreshMap(); renderAllFlightTables();
});
await page.waitForTimeout(320);
const wpPt = await page.evaluate(() => {
  const p = map.latLngToContainerPoint([69.20, 18.50]);
  const r = document.getElementById('map').getBoundingClientRect();
  return [r.left + p.x, r.top + p.y];
});
await page.mouse.click(wpPt[0], wpPt[1], { button: 'right' });
await page.waitForTimeout(320);
const wpMenu = await page.evaluate(() => {
  const d = document.getElementById('app-dialog');
  return { open: !!d, text: d ? d.textContent : '',
           legPanel: getComputedStyle(document.getElementById('leg-modal')).display };
});
check(wpMenu.open && /MID/.test(wpMenu.text),
  'right-clicking a waypoint opened its own menu: ' + JSON.stringify(wpMenu.text.slice(0, 80)));
check(wpMenu.legPanel !== 'flex',
  'the route line underneath ALSO opened the leg panel (display ' + wpMenu.legPanel + ')');
// Rename through the real dialog, then confirm the route changed.
await page.evaluate(() => {
  // ONE dialog with a name AND an altitude since v16.74, so the field has to be
  // named - the first input is no longer necessarily the one you mean.
  const inp = document.querySelector('#app-dialog input[data-field="name"]');
  inp.value = 'MIDPOINT';
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  [...document.querySelectorAll('#app-dialog button')]
    .find((b) => /Apply/.test(b.textContent)).click();
});
await page.waitForTimeout(320);
check(await page.evaluate(() => flights[0].waypoints[1].name) === 'MIDPOINT',
  'the rename did not reach the route');
// ...and delete it.
await page.mouse.click(wpPt[0], wpPt[1], { button: 'right' });
await page.waitForTimeout(320);
await page.evaluate(() => [...document.querySelectorAll('#app-dialog button')]
  .find((b) => /Delete/.test(b.textContent)).click());
await page.waitForTimeout(320);
const afterDel = await page.evaluate(() => flights[0].waypoints.map((w) => w.name));
check(JSON.stringify(afterDel) === JSON.stringify(['ENDU', 'ENTC']),
  'delete from the map removed the wrong waypoint: ' + JSON.stringify(afterDel));

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


// ---------------------------------------------------------------------------
// DRAGGING A CLIMB OR DESCENT CORNER ALONG THE TRACK (v16.73, the pilot's
// request). jsdom has no projection and no drag, so only a real browser can
// show that the gesture reaches the track, that the mark SNAPS to the line
// rather than floating off it, and that the manoeuvre keeps its POH length
// while both ends move together.
// ---------------------------------------------------------------------------
{
  await page.evaluate(async () => {
    OVERLAY_IDS.forEach(closeModal); closeLegModal();
    setLayoutMode('map');
    flights = [{ id: 1, title: 'F1', depElev: 254, waypoints: [
      { lat: 69.055, lng: 18.544, name: 'ENDU', alt: 254, oat: 10, wdir: 0, wspd: 0, var: -11 },
      { lat: 69.679, lng: 18.911, name: 'ENTC', alt: 6500, oat: 0, wdir: 0, wspd: 0, var: -12 }] }];
    activeFlightIndex = 0;
    map.setView([69.37, 18.73], 9, { animate: false });
    refreshMap(); renderAllFlightTables();
    await new Promise((r) => setTimeout(r, 350));
  });

  const marks = () => page.evaluate(() => profileMarkers.map((m) => {
    const el = m.getElement();
    const g = el.querySelector('.prof-tick,.prof-ring');
    const r = g.getBoundingClientRect();
    return { k: (el.textContent || '').trim(),
             cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2),
             shape: /prof-ring/.test(g.className) ? 'ring' : 'tick',
             drag: /prof-drag/.test(g.className) };
  }));
  const sched = () => page.evaluate(() => {
    const sc = computeFlightSchedule(flights[0]);
    return { climbStart: +sc[0].climbStartNM.toFixed(2), toc: +sc[0].tocAlongNM.toFixed(2),
             climbDist: +sc[0].climbDistNM.toFixed(2),
             boc: flights[0].waypoints[1].bocNM, tocPin: flights[0].waypoints[1].altAtNM };
  });
  const dragMark = async (kind, dx, dy) => {
    const m = (await marks()).find((x) => x.k === kind);
    if (!m) return false;
    await page.mouse.move(m.cx, m.cy);
    await page.mouse.down();
    for (let k = 1; k <= 10; k++) await page.mouse.move(m.cx + dx * k / 10, m.cy + dy * k / 10);
    await page.mouse.up();
    await page.waitForTimeout(420);
    return true;
  };

  // A TOP IS A TICK ACROSS THE TRACK, A BOTTOM IS A RING ON IT.
  const m0 = await marks();
  check(m0.length === 1 && m0[0].k === 'TOC' && m0[0].shape === 'tick',
    `an unpinned climb draws one TOC, as a tick (${JSON.stringify(m0.map((x) => x.k + ':' + x.shape))})`);
  check(m0[0].drag, 'the TOC carries the grab affordance');
  const s0 = await sched();

  // DRAGGING THE TOP PLACES THE BOTTOM. The pilot names where they want to be
  // level; the engine works the POH climb backwards to find where it must
  // begin, and that corner appears as a ring.
  check(await dragMark('TOC', 20, -110), 'the TOC tick can be grabbed and dragged');
  const m1 = await marks(), s1 = await sched();
  check(m1.length === 2 && m1.some((x) => x.k === 'BOC' && x.shape === 'ring'),
    `dragging the TOC placed a BOC ring (${JSON.stringify(m1.map((x) => x.k + ':' + x.shape))})`);
  check(s1.toc > s0.toc + 1,
    `the top of climb actually moved (${s0.toc} -> ${s1.toc} NM)`);
  // v16.76: ONE field. There is no longer a BOC that can contradict a TOC, so
  // there is nothing to clear and no rule about which wins - which is the whole
  // reason the three pins were collapsed.
  check(s1.tocPin != null && s1.boc == null,
    `dragging the top sets the one attain-by target (${s1.tocPin})`);
  // THE CLIMB IS NEVER STRETCHED: the POH prices a rate, not a wish, so the
  // manoeuvre keeps its length and only its position moves.
  check(Math.abs(s1.climbDist - s0.climbDist) < 0.35,
    `the climb kept its POH length (${s0.climbDist} -> ${s1.climbDist} NM)`);
  check(Math.abs((s1.toc - s1.climbStart) - s1.climbDist) < 0.35,
    'the drawn BOC and TOC are not one climb apart');

  // DRAGGING THE BOTTOM MOVES THE WHOLE SEGMENT, which is what the pilot asked
  // the ring for.
  check(await dragMark('BOC', 10, -60), 'the BOC ring can be grabbed and dragged');
  const s2 = await sched();
  check(s2.climbStart > s1.climbStart + 1,
    `the bottom of climb moved (${s1.climbStart} -> ${s2.climbStart} NM)`);
  check(s2.toc > s1.toc + 1,
    `and the top came with it (${s1.toc} -> ${s2.toc} NM)`);
  check(s2.tocPin != null && s2.boc == null,
    `dragging the bottom sets the SAME target, one climb-length further on (${s2.tocPin})`);
  check(Math.abs(s2.climbDist - s0.climbDist) < 0.35,
    `the climb still has its POH length after both drags (${s2.climbDist} NM)`);

  // THE MARK STAYS ON THE TRACK. A bottom of climb three miles off the line is
  // not something a pilot can fly, so the drag projects onto the flown path
  // instead of letting the icon float free.
  const off = await page.evaluate(() => {
    const sc = computeFlightSchedule(flights[0]);
    const marksNow = computeLegMarkers(flights[0].waypoints[0], flights[0].waypoints[1], sc[0]);
    return marksNow.map((mk) => {
      const rep = alongLegNM(flights[0].waypoints[0], flights[0].waypoints[1], L.latLng(mk.lat, mk.lng));
      return +rep.offTrackNM.toFixed(3);
    });
  });
  // THE TOLERANCE IS THE GREAT CIRCLE'S OWN BOW, not a fudge. `alongLegNM`
  // measures against the straight waypoint-to-waypoint chord while the mark is
  // placed on the GEODESIC, and v16.63 measured those two lines 0.057 NM apart
  // on a 38 NM leg at 69N. 0.1 NM is inside that and still catches the failure
  // this exists for - an icon dropped off the line lands miles away.
  check(off.every((v) => v < 0.1),
    `every mark sits on the track after a drag (worst ${Math.max(...off)} NM off)`);

  // ONE UNDO PUTS IT BACK - the drag is one edit, not two.
  await page.evaluate(() => undoLast(true));
  await page.waitForTimeout(320);
  const s3 = await sched();
  check(s3.climbStart < s2.climbStart - 0.5 || s3.boc === null,
    `undo took the last drag back (${s2.climbStart} -> ${s3.climbStart} NM)`);

  // THE DESCENT IS THE SAME GESTURE FROM THE OTHER END.
  await page.evaluate(async () => {
    flights = [{ id: 1, title: 'F1', depElev: 254, waypoints: [
      { lat: 69.055, lng: 18.544, name: 'ENDU', alt: 6500, oat: 0, wdir: 0, wspd: 0, var: -11 },
      { lat: 69.679, lng: 18.911, name: 'ENTC', alt: 500, oat: 5, wdir: 0, wspd: 0, var: -12 }] }];
    activeFlightIndex = 0; refreshMap(); renderAllFlightTables();
    await new Promise((r) => setTimeout(r, 350));
  });
  const dsc = () => page.evaluate(() => {
    const sc = computeFlightSchedule(flights[0]);
    return { todBefore: +(sc[0].todBeforeNM || 0).toFixed(2), bodTail: +(sc[0].bodTailNM || 0).toFixed(2),
             descDist: +(sc[0].descDistNM || 0).toFixed(2), bodPin: flights[0].waypoints[1].bodNM };
  });
  const d0 = await dsc();
  const dm0 = await marks();
  check(dm0.length === 1 && dm0[0].k === 'TOD' && dm0[0].shape === 'tick',
    `an unpinned descent draws one TOD, as a tick (${JSON.stringify(dm0.map((x) => x.k))})`);
  check(await dragMark('TOD', -10, 90), 'the TOD tick can be grabbed and dragged');
  const d1 = await dsc(), dm1 = await marks();
  check(dm1.some((x) => x.k === 'BOD' && x.shape === 'ring'),
    `dragging the TOD placed a BOD ring (${JSON.stringify(dm1.map((x) => x.k + ':' + x.shape))})`);
  check(d1.todBefore > d0.todBefore + 1,
    `the top of descent moved earlier (${d0.todBefore} -> ${d1.todBefore} NM before the fix)`);
  check(Math.abs(d1.descDist - d0.descDist) < 0.35,
    `the descent kept its POH length (${d0.descDist} -> ${d1.descDist} NM)`);
  check(await dragMark('BOD', -10, 60), 'the BOD ring can be grabbed and dragged');
  const d2 = await dsc();
  check(d2.bodTail > d1.bodTail + 1 && d2.todBefore > d1.todBefore + 1,
    `dragging the BOD moved the whole descent (tail ${d1.bodTail} -> ${d2.bodTail}, top ${d1.todBefore} -> ${d2.todBefore})`);

  // A MARK IS TRANSPARENT TO EVERY GESTURE BUT ITS OWN DRAG. Making these
  // draggable made them interactive, and an interactive marker eats what is
  // under it: the right-click that opens the leg panel stopped working
  // wherever a mark happened to sit. Both gestures are asserted here rather
  // than reasoned about.
  const tickPt = await page.evaluate(() => {
    const t = profileMarkers[0].getElement().querySelector('.prof-tick,.prof-ring').getBoundingClientRect();
    return [Math.round(t.x + t.width / 2), Math.round(t.y + t.height / 2)];
  });
  await page.evaluate(() => { OVERLAY_IDS.forEach(closeModal); closeLegModal(); });
  await page.mouse.click(tickPt[0], tickPt[1]);
  await page.waitForTimeout(420);
  const throughAsk = await page.evaluate(() =>
    [...document.querySelectorAll('#app-dialog .dlg-title')].map((x) => x.textContent));
  check(throughAsk.length === 1 && /waypoint/i.test(throughAsk[0]),
    `a LEFT click on a mark still falls through to the map (${JSON.stringify(throughAsk)})`);
  await page.evaluate(() => { const d = document.getElementById('app-dialog'); if (d) d.remove(); });
  await page.mouse.click(tickPt[0], tickPt[1], { button: 'right' });
  await page.waitForTimeout(400);
  check(await page.evaluate(() => {
    const el = document.getElementById('leg-modal');
    return !!el && getComputedStyle(el).display !== 'none';
  }), 'a RIGHT click on a mark opens the leg panel for that leg');
  await page.evaluate(() => { closeLegModal(); });

  // A TOC DRAGGED FURTHER BACK THAN THE POH CAN CLIMB (v16.74, the pilot's
  // report: it "automatically resets, the red integrity banner appears"). Three
  // outcomes, and none of them is a banner - the resulting plan is flyable in
  // every case, so saying DO NOT USE would be false.
  const bannerText = () => page.evaluate(() => {
    const el = document.getElementById('integrity-banner');
    return el && getComputedStyle(el).display !== 'none'
      ? el.textContent.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
  });
  const toastText = () => page.evaluate(() => {
    const h = document.getElementById('app-toasts');
    return h ? h.textContent.replace(/\s+/g, ' ').trim().slice(0, 130) : '';
  });

  // (1) THE FIRST LEG has nothing behind it - clamp, and say why.
  await page.evaluate(async () => {
    document.getElementById('app-toasts').innerHTML = '';
    flights = [{ id: 1, title: 'F1', depElev: 254, waypoints: [
      { lat: 69.055, lng: 18.544, name: 'ENDU', alt: 254, oat: 10, wdir: 0, wspd: 0, var: -11 },
      { lat: 69.679, lng: 18.911, name: 'ENTC', alt: 6500, oat: 0, wdir: 0, wspd: 0, var: -12 }] }];
    activeFlightIndex = 0;
    map.setView([69.37, 18.73], 9, { animate: false });
    refreshMap(); renderAllFlightTables();
    await new Promise((r) => setTimeout(r, 350));
  });
  const firstMark = (await marks())[0];
  await page.mouse.move(firstMark.cx, firstMark.cy);
  await page.mouse.down();
  for (let k = 1; k <= 10; k++) await page.mouse.move(firstMark.cx - 2 * k, firstMark.cy + 22 * k);
  await page.mouse.up();
  await page.waitForTimeout(520);
  const clamped = await page.evaluate(() => {
    const sc = computeFlightSchedule(flights[0]);
    const mk = computeLegMarkers(flights[0].waypoints[0], flights[0].waypoints[1], sc[0]);
    return { toc: flights[0].waypoints[1].tocNM, met: sc[0].tocTargetMet,
             kinds: mk.map((m) => m.kind).join(','), at: +sc[0].tocAlongNM.toFixed(2) };
  });
  // v16.75: the pin is CLEARED rather than clamped. With nothing pinned the
  // climb starts at the fix, which IS the earliest reachable point - and no
  // bottom-of-climb ring is drawn, where the clamp left one a fraction of a
  // mile past the departure (the pilot's second report).
  check(clamped.toc == null && clamped.met !== false,
    `dragging the TOC past the POH climb leaves no pin and a target it can meet (${clamped.toc}, TOC at ${clamped.at} NM)`);
  check(!/BOC/.test(clamped.kinds),
    `and draws no BOC just past the departure (${clamped.kinds})`);
  check((await bannerText()) === '',
    `and raises no red banner (${JSON.stringify(await bannerText())})`);
  check(/cannot go further back/i.test(await toastText()),
    `it says why instead (${JSON.stringify(await toastText())})`);

  // (2) A LEG WITH ONE BEHIND IT IS TREATED THE SAME WAY (v16.77). v16.74 and
  //     v16.75 carried the climb back by RAISING the earlier fix; the pilot
  //     retired that - "I set what altitude i plan on using, not the exact
  //     altitude i will have at that point" - so the only two outcomes left are
  //     "it fits" and "the corner goes back to the POH's own", and neither
  //     touches a number they typed.
  await page.evaluate(async () => {
    document.getElementById('app-toasts').innerHTML = '';
    flights = [{ id: 1, title: 'F1', depElev: 254, waypoints: [
      { lat: 68.60, lng: 18.50, name: 'ENDU', alt: 254, oat: 10, wdir: 0, wspd: 0, var: -11 },
      { lat: 69.20, lng: 18.50, name: 'MID',  alt: 2500, oat: 5, wdir: 0, wspd: 0, var: -11 },
      { lat: 69.90, lng: 18.50, name: 'ENTC', alt: 8500, oat: 0, wdir: 0, wspd: 0, var: -12 }] }];
    activeFlightIndex = 0;
    map.setView([69.25, 18.5], 8, { animate: false });
    refreshMap(); renderAllFlightTables();
    await new Promise((r) => setTimeout(r, 400));
  });
  const midWas = await page.evaluate(() => flights[0].waypoints[1].alt);
  const northToc = (await marks()).filter((m) => m.k === 'TOC').sort((a, c) => a.cy - c.cy)[0];
  check(!!northToc, 'the later leg has a TOC to drag');
  await page.mouse.move(northToc.cx, northToc.cy);
  await page.mouse.down();
  for (let k = 1; k <= 10; k++) await page.mouse.move(northToc.cx - k, northToc.cy + 12 * k);
  await page.mouse.up();
  await page.waitForTimeout(560);
  const carried = await page.evaluate(() => ({
    endu: flights[0].waypoints[0].alt,
    mid: flights[0].waypoints[1].alt,
    entc: flights[0].waypoints[2].alt,
    met: computeFlightSchedule(flights[0])[1].tocTargetMet
  }));
  check(carried.mid === midWas && carried.endu === 254 && carried.entc === 8500,
    `a drag on a later leg rewrote no altitude (${midWas} -> ${carried.mid} ft, ` +
    `${carried.endu}/${carried.entc})`);
  check(carried.met !== false, 'and the target is met rather than reported missed');
  check((await bannerText()) === '',
    `no red banner for a plan that is flyable (${JSON.stringify(await bannerText())})`);
  check(/cannot go further back|does not fit/i.test(await toastText()),
    `the pilot is told why the corner stopped (${JSON.stringify(await toastText())})`);
}

check(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
await b.close();
if (fails.length) { console.error('\n' + fails.length + ' check(s) FAILED'); process.exit(1); }
console.log('\nall leg-panel checks passed');
