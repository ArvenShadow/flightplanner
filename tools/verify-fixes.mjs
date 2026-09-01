#!/usr/bin/env node
/**
 * The AIP fixes layer, in a real browser - `npm run verify:fixes`.
 *
 * WHY jsdom IS NOT ENOUGH, and this file exists for a specific past failure:
 * v16.22 and v16.23 shipped two map buttons that were INVISIBLE. A grep for
 * the id passed, the markup looked right, and only measuring
 * getBoundingClientRect in a real browser showed the button at y=900 on a
 * 900 px viewport. So every new control and every new marker gets measured,
 * not asserted from source.
 *
 * It also proves the two things about a fix marker that only a real event
 * loop can: that a click on the 9 px symbol adds the waypoint, and that it
 * does NOT also reach the map's add-waypoint handler (Leaflet markers do not
 * bubble clicks the way paths do). If it did, one click would add two
 * waypoints and open a naming dialog for the second.
 *
 * Playwright is not a project dependency; install it when you need this:
 *   npm install --no-save playwright && npx playwright install chromium
 * (Set CHROME_PATH to use a browser already on the machine.)
 *
 * Runs OFFLINE: every non-file:// request is aborted, so the layer is proved
 * to work with no chart tiles at all.
 */
let chromium;
try { ({ chromium } = await import('playwright')); }
catch (e) { console.error('playwright is not installed - see the header of this file.'); process.exit(2); }

const APP = process.env.CURRENT || new URL('../dist/C182_FlightPlanner.html', import.meta.url).pathname;
const fails = [];
const check = (ok, msg) => { console.log((ok ? '  ok    ' : '  FAIL  ') + msg); if (!ok) fails.push(msg); };

const b = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.route('**://**/**', (r) => r.request().url().startsWith('file:') ? r.continue() : r.abort());
await page.goto('file://' + APP, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);
await page.evaluate(() => { closeHelpModal(); });

// EVERY map control must be inside the viewport. This is the v16.22 lesson.
const ctls = await page.evaluate(() => [...document.querySelectorAll('#map-controls .map-ctl')]
  .map((b) => { const r = b.getBoundingClientRect();
    return { id: b.id, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; }));
for (const c of ctls) {
  check(c.w > 0 && c.h > 0 && c.y >= 0 && c.y < 900 && c.x >= 0 && c.x < 1400,
    `control ${c.id} is on screen at ${c.x},${c.y} (${c.w}x${c.h})`);
}
check(ctls.some((c) => c.id === 'fixes-btn') && ctls.some((c) => c.id === 'fix-search-btn'),
  'both fixes controls are in the stack');

await page.evaluate(() => {
  aircraftProfile.fixesOn = true;
  updateFixesBtn();
  map.setView([69.05583, 18.54028], 10, { animate: false });   // ENDU
  drawFixes();
});
await page.waitForTimeout(500);

const drawn = await page.evaluate(() => fixLayers.length);
check(drawn > 0, drawn + ' fixes drawn over Bardufoss at zoom 10');

// The symbols and their labels must actually be PAINTED, and inside the map.
// Every symbol is now inline SVG with a real box at every size - the old CSS
// border-triangle had a zero-sized box and could not be measured at all.
const shapes = await page.evaluate(() => {
  const out = { svgs: 0, labels: 0, offscreen: 0, zeroSized: 0, labelClickable: 0, sizes: {} };
  const mr = document.getElementById('map').getBoundingClientRect();
  for (const el of document.querySelectorAll('.fix-svg')) {
    const r = el.getBoundingClientRect();
    out.svgs++;
    out.sizes[Math.round(r.width) + 'x' + Math.round(r.height)] = 1;
    if (r.width < 4 || r.height < 4) out.zeroSized++;
    if (r.bottom < mr.top || r.top > mr.bottom || r.right < mr.left || r.left > mr.right) out.offscreen++;
  }
  for (const el of document.querySelectorAll('.fix-label')) {
    out.labels++;
    if (getComputedStyle(el).pointerEvents !== 'none') out.labelClickable++;
  }
  return out;
});
check(shapes.svgs > 0 && shapes.labels === shapes.svgs,
  `${shapes.svgs} symbols and ${shapes.labels} labels painted`);
check(shapes.zeroSized === 0,
  'every symbol has a measurable box (' + Object.keys(shapes.sizes).join(', ') + ')');
check(shapes.offscreen === 0, 'no fix symbol is drawn outside the map');
check(shapes.labelClickable === 0,
  'every label is click-through - a wide label would swallow clicks meant for the map');

/** Click a drawn fix by name, through the real DOM. */
async function clickFix(name) {
  const at = await page.evaluate((name) => {
    const l = fixLayers.find((x) => x._icon && x._icon.textContent.trim() === name);
    if (!l) return null;
    const r = l._icon.querySelector('.fix-svg').getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }, name);
  if (!at) return null;
  await page.mouse.click(at[0], at[1]);
  await page.waitForTimeout(350);
  return at;
}

const before = await page.evaluate(() => flights[activeFlightIndex].waypoints.length);
const at = await clickFix('ELLA');
check(!!at, 'ELLA is drawn and hittable at ' + JSON.stringify(at));
const after = await page.evaluate(() => flights[activeFlightIndex].waypoints.length);
check(after === before + 1, `one click added exactly one waypoint (${before} -> ${after})`);
// THE BUBBLING CHECK: if the marker's click also reached the map, the map's
// handler would be waiting on its "name this waypoint" dialog right now.
const dlg = await page.evaluate(() => document.querySelectorAll('#app-dialog').length);
check(dlg === 0, 'the click did not also reach the map (no naming dialog open)');

const wp = await page.evaluate(() => {
  const w = flights[activeFlightIndex].waypoints.slice(-1)[0];
  return { name: w.name, lat: w.lat, lng: w.lng, alt: w.alt, anchor: w.anchor };
});
const published = await page.evaluate(() => {
  const p = window.C182_AIP.aerodromes.find((a) => a.icao === 'ENDU').points.find((x) => x.name === 'ELLA');
  return { lat: p.lat, lng: p.lng, published: p.published };
});
check(wp.name === 'ELLA' && wp.lat === published.lat && wp.lng === published.lng,
  `the waypoint sits on the published coordinate ${published.published} (${wp.lat}, ${wp.lng})`);
check(wp.anchor === 'AIP-RP', 'the waypoint is stamped as an AIP reporting point: ' + wp.anchor);

// The hover card must appear, be readable, and lead with the published fix.
// Whichever reporting point is actually DRAWN here - naming one by hand ties
// this check to a viewport, and the point of the layer is that it culls.
const card = await page.evaluate(async () => {
  const l = fixLayers.find((x) => x._icon && x._icon.classList.contains('fix-rp'));
  if (!l) return null;
  l.openTooltip();
  await new Promise((r) => setTimeout(r, 250));
  const el = document.querySelector('.fix-tip');
  if (!el) return { name: l._icon.textContent.trim(), missing: true };
  const r = el.getBoundingClientRect();
  return { name: l._icon.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height),
           text: el.innerText.replace(/\n+/g, ' | ') };
});
check(!!card && !card.missing && card.w > 40 && card.w < 320 && card.h > 20,
  'the hover card is content-sized: ' + JSON.stringify(card));
check(!!card && !card.missing && card.text.includes(card.name) && /\d{6}N \d{7}E/.test(card.text),
  'the card names the fix and its published coordinate: ' + (card ? card.text : '-'));

// The attribution must be visible while the layer is on, and name the grant.
const attr = await page.evaluate(() => {
  const el = document.getElementById('fixes-attribution');
  const r = el.getBoundingClientRect();
  return { y: Math.round(r.y), w: Math.round(r.width), shown: getComputedStyle(el).display !== 'none', text: el.textContent };
});
check(attr.shown && attr.w > 0 && attr.y > 0 && attr.y < 900, 'the attribution is on screen at y=' + attr.y);
check(/Avinor/.test(attr.text) && /non-commercial/.test(attr.text), 'it names the grant');

// Below the point zoom, reporting points must be gone but aerodromes stay -
// otherwise the country view is a spatter that hides the aerodromes.
//
// NOTE: setView must be UNANIMATED and given time to settle. With the default
// animation getZoom() still reports the OLD zoom for a frame or two, so an
// immediate drawFixes() culls for the zoom you just left - which made this
// check read 15 fixes at zoom 6 and 0 at zoom 7, exactly inverted.
const byZoom = await page.evaluate(async () => {
  const out = {};
  for (const z of [6, 7, 9]) {
    map.setView([69.05583, 18.54028], z, { animate: false });
    await new Promise((r) => setTimeout(r, 300));
    drawFixes();
    await new Promise((r) => setTimeout(r, 150));
    out[z] = { zoom: map.getZoom(), total: fixLayers.length,
               rp: document.querySelectorAll('.fix-icon.fix-rp').length };
  }
  return out;
});
for (const z of [6, 7, 9]) check(byZoom[z].zoom === z, 'the map really is at zoom ' + z + ' (' + byZoom[z].zoom + ')');
check(byZoom[6].total === 0, 'nothing drawn at zoom 6 (got ' + byZoom[6].total + ')');
check(byZoom[7].total > 0 && byZoom[7].rp === 0,
  'zoom 7 draws aerodromes only (' + byZoom[7].total + ' fixes, ' + byZoom[7].rp + ' points)');
check(byZoom[9].rp > 0, 'zoom 9 draws reporting points (' + byZoom[9].rp + ')');

// And clicking bare map still adds a waypoint the old way - the fixes layer
// must not have taken over route building.
await page.evaluate(async () => { map.setView([69.6, 21.6], 9, { animate: false });
  await new Promise((r) => setTimeout(r, 300)); drawFixes(); });
await page.waitForTimeout(300);
const n0 = await page.evaluate(() => flights[activeFlightIndex].waypoints.length);
await page.mouse.click(700, 450);
await page.waitForTimeout(400);
const asked = await page.evaluate(() => [...document.querySelectorAll('#app-dialog .dlg-title')].map((x) => x.textContent));
check(asked.length === 1 && /waypoint|departure/i.test(asked[0]),
  'a click on bare map still asks for a waypoint name (' + JSON.stringify(asked) + ')');
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('#app-dialog .dlg-btn')].find((x) => /cancel/i.test(x.textContent));
  if (btn) btn.click();
});
await page.waitForTimeout(200);
check(await page.evaluate(() => flights[activeFlightIndex].waypoints.length) === n0,
  'cancelling that dialog changed nothing');

// =====================================================================
// MAP SETTINGS. The point of the page is that it changes what is DRAWN, and
// only a browser can confirm the marker really came out orange at 16 px.
// =====================================================================
await page.evaluate(async () => {
  map.setView([69.05583, 18.54028], 10, { animate: false });
  await new Promise((r) => setTimeout(r, 300));
  drawFixes();
});
await page.waitForTimeout(200);

await page.evaluate(() => openSettingsModal());
await page.waitForTimeout(250);
const tabs = await page.evaluate(() => {
  const t = [...document.querySelectorAll('.settings-tab')].map((b) => {
    const r = b.getBoundingClientRect();
    return { id: b.id, text: b.textContent.trim(), y: Math.round(r.y), w: Math.round(r.width),
             active: b.classList.contains('is-active') };
  });
  return { tabs: t, aircraftShown: !document.getElementById('settings-page-aircraft').hidden,
           mapShown: !document.getElementById('settings-page-map').hidden };
});
check(tabs.tabs.length === 2 && tabs.tabs.every((t) => t.w > 0 && t.y > 0 && t.y < 900),
  'both settings tabs are on screen: ' + JSON.stringify(tabs.tabs.map((t) => t.text + '@' + t.y)));
check(tabs.aircraftShown && !tabs.mapShown, 'the modal opens on the aircraft page');

await page.click('#settings-tab-map');
await page.waitForTimeout(200);
const onMap = await page.evaluate(() => ({
  mapShown: !document.getElementById('settings-page-map').hidden,
  aircraftShown: !document.getElementById('settings-page-aircraft').hidden,
  active: document.getElementById('settings-tab-map').classList.contains('is-active'),
  // the preview must render through the same code the map uses
  previewSvgs: document.querySelectorAll('#map-fix-preview .fix-svg').length,
  previewBox: (() => { const r = document.getElementById('map-fix-preview').getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
  sizeLabel: document.getElementById('map-fix-size-val').textContent
}));
check(onMap.mapShown && !onMap.aircraftShown && onMap.active, 'the Map tab switches pages');
check(onMap.previewSvgs === 2, 'the preview shows both symbols (' + onMap.previewSvgs + ')');
check(onMap.previewBox.w > 100 && onMap.previewBox.h > 20,
  'the preview has a real box: ' + JSON.stringify(onMap.previewBox));
check(/px/.test(onMap.sizeLabel), 'the size readout says a value: ' + JSON.stringify(onMap.sizeLabel));

// The default reporting-point colour must be the orange, not the old green.
const defaults = await page.evaluate(() => ({
  rp: document.getElementById('map-fix-rp-color').value,
  ad: document.getElementById('map-fix-ad-color').value,
  rpShape: document.getElementById('map-fix-rp-shape').value
}));
check(defaults.rp === '#dd6b20', 'the reporting-point default is orange: ' + defaults.rp);
check(defaults.rpShape === 'triangle', 'the reporting-point default shape is a triangle');

// Change every field, save, and MEASURE the drawn marker.
await page.evaluate(() => {
  document.getElementById('map-fix-rp-color').value = '#ff2d95';
  document.getElementById('map-fix-rp-shape').value = 'diamond';
  document.getElementById('map-fix-style').value = 'outline';
  document.getElementById('map-fix-size').value = '16';
  document.getElementById('map-fix-labels').value = 'no';
  updateFixPreview();
});
const preview = await page.evaluate(() =>
  document.querySelector('#map-fix-preview').innerHTML);
check(/#ff2d95/.test(preview) && /polygon points="50,7/.test(preview) && /width="16"/.test(preview),
  'the preview followed every change');
check(!/pv-name/.test(preview), 'the preview dropped the names when they were turned off');

await page.evaluate(() => saveSettings());
await page.waitForTimeout(500);
const drawnNow = await page.evaluate(() => {
  // A REPORTING POINT specifically - the first marker over Bardufoss is the
  // aerodrome, which keeps its own blue, and reading that one made this check
  // pass or fail for the wrong reason.
  const l = fixLayers.find((x) => x._icon && x._icon.classList.contains('fix-rp'));
  if (!l) return null;
  const svg = l._icon.querySelector('.fix-svg');
  const r = svg.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height), html: l._icon.innerHTML,
           labels: document.querySelectorAll('.fix-label').length,
           stored: JSON.parse(localStorage.getItem('c182_perf_profile') || '{}') };
});
check(!!drawnNow && drawnNow.w === 16 && drawnNow.h === 16,
  'the drawn symbol is 16 px: ' + JSON.stringify(drawnNow && { w: drawnNow.w, h: drawnNow.h }));
check(!!drawnNow && /#ff2d95/.test(drawnNow.html), 'the drawn symbol took the new colour');
check(!!drawnNow && /stroke="#ff2d95"/.test(drawnNow.html), 'the outline style stroked rather than filled');
check(!!drawnNow && drawnNow.labels === 0, 'the labels are gone (' + (drawnNow && drawnNow.labels) + ')');
check(!!drawnNow && drawnNow.stored.fixSize === 16 && drawnNow.stored.fixRpColor === '#ff2d95',
  'the choice persisted to localStorage: ' + JSON.stringify(drawnNow && {
    size: drawnNow.stored.fixSize, rp: drawnNow.stored.fixRpColor, style: drawnNow.stored.fixStyle }));

// A garbage colour in storage must degrade to the DEFAULT, never to invisible
// markup - the value reaches innerHTML, and it can arrive from a route file.
const hostile = await page.evaluate(async () => {
  const p = JSON.parse(localStorage.getItem('c182_perf_profile'));
  p.fixRpColor = '#fff" onload="window.__pwned=1';
  p.fixSize = 9999;
  aircraftProfile.fixRpColor = p.fixRpColor;
  aircraftProfile.fixSize = p.fixSize;
  localStorage.setItem('c182_perf_profile', JSON.stringify(p));
  drawFixes();
  await new Promise((r) => setTimeout(r, 200));
  const l = fixLayers.find((x) => x._icon && x._icon.classList.contains('fix-rp'));
  const r = l ? l._icon.querySelector('.fix-svg').getBoundingClientRect() : null;
  return { pwned: !!window.__pwned, html: l ? l._icon.innerHTML : '', w: r ? Math.round(r.width) : 0 };
});
check(!hostile.pwned, 'a hostile colour did not execute');
check(/#dd6b20/.test(hostile.html), 'a malformed colour fell back to the default orange');
check(hostile.w === 18, 'an absurd size clamped to the 18 px maximum (got ' + hostile.w + ')');

check(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
await b.close();
if (fails.length) { console.error('\n' + fails.length + ' check(s) FAILED'); process.exit(1); }
console.log('\nall AIP-fixes checks passed');
