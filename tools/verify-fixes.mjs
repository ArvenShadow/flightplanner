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

const APP = process.env.CURRENT || new URL('../site/index.html', import.meta.url).pathname;
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

// ---- AN AERODROME ASKS WHAT HAPPENS THERE (v16.54, roadmap item 17) ------
// A reporting point is added with no dialog (asserted above); an aerodrome is
// the deliberate exception. Clicked for real, because v16.53 shipped a menu of
// dead buttons that every function-level test passed.
{
  await page.evaluate(() => {
    flights = [{ id: 1, title: 'F', depElev: 254, waypoints: [
      { lat: 69.05505349, lng: 18.54466865, name: 'ENDU', alt: 254, oat: 10, wdir: 0, wspd: 0, var: -11 }]}];
    activeFlightIndex = 0;
    map.setView([69.679, 18.911], 10, { animate: false });
    refreshMap(); renderAllFlightTables();
  });
  await page.waitForTimeout(500);
  const ads = await page.locator('.fix-icon.fix-ad').count();
  check(ads >= 1, `an aerodrome symbol is on screen to click (${ads})`);
  await page.locator('.fix-icon.fix-ad').first().click();
  await page.waitForTimeout(300);
  const asked = await page.evaluate(() => {
    const d = document.getElementById('app-dialog');
    return d ? d.textContent.replace(/\s+/g, ' ') : '';
  });
  check(/what happens here/.test(asked), 'clicking an aerodrome asks what happens: ' + asked.slice(0, 60));
  check(/Touch & go/.test(asked) && /Full stop/.test(asked) && /Fly-by/.test(asked),
    'all three options are offered');
  // The dialog must NAME the fly-by waypoint, because the AIP publishes two
  // names and neither is always the one pilots say.
  check(/Troms\u00f8/.test(asked), 'the fly-by option names the place: ' + asked.slice(0, 140));
  // v16.55: the name is the published CALLSIGN's place, not the town. ENTC
  // happens to agree; ENEV is the case that proves the rule, so it is checked
  // through the same resolver the dialog uses.
  const named = await page.evaluate(() => {
    const ads = buildAnchors(window.C182_AIP).filter((a) => a.kind === 'AD');
    const of = (i) => { const a = ads.find((x) => x.icao === i); return a ? civilName(a) : null; };
    return { ENEV: of('ENEV'), ENSK: of('ENSK'), ENSH: of('ENSH'),
             codeNamed: ads.filter((a) => civilName(a).toUpperCase() === a.icao).length };
  });
  check(named.ENEV === 'Evenes' && named.ENSK === 'Skagen' && named.ENSH === 'Helle',
    'the callsign names them: ' + JSON.stringify(named));
  check(named.codeNamed === 0, `no aerodrome falls back to its ICAO code (${named.codeNamed})`);

  await page.locator('#app-dialog .dlg-btn', { hasText: 'Full stop' }).click();
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => {
    const w = flights[0].waypoints.slice(-1)[0];
    const hdrs = [...document.querySelectorAll('.flight-header')].map((h) => h.textContent.replace(/\s+/g, ' '));
    return { plans: flights.length, stop: w.stop, stopMin: w.stopMin, name: w.name,
             nextDepElev: flights[1] && flights[1].depElev, hdr: hdrs[1] || '' };
  });
  check(after.stop === 'full-stop' && after.stopMin === 10,
    `the full stop is recorded with its default minutes (${after.stop}, ${after.stopMin})`);
  check(after.name === 'ENTC', 'a full stop keeps the ICAO code: ' + after.name);
  check(after.plans === 2, `the next sector opened (${after.plans} plans)`);
  // ENTC publishes 32 ft: the next climb starts from the RUNWAY, not from the
  // altitude the arrival row showed.
  check(after.nextDepElev === 32, `the next sector departs from the field (${after.nextDepElev} ft)`);
  check(/Full stop/.test(after.hdr) && /ENTC/.test(after.hdr),
    'the next plan header shows the editable ground time: ' + after.hdr.slice(0, 90));

  // A REFUELLING STOP (v16.57). The box must be VISIBLE - this project has
  // shipped present-but-invisible controls before - and typing in it must
  // reach the plan. Filled, not called: a control is only proved by using it.
  const refuel = page.locator('.flight-header input[placeholder="carry over"]');
  const nBoxes = await refuel.count();
  const rBox = nBoxes ? await refuel.first().boundingBox() : null;
  check(nBoxes === 1 && !!rBox && rBox.width > 0 && rBox.height > 0,
    `the refuel box is on screen at a full stop (${nBoxes}, ${rBox ? Math.round(rBox.width) + 'x' + Math.round(rBox.height) : 'no box'})`);
  const remBefore = await page.evaluate(() => document.getElementById('grand-final-rem').textContent);
  await refuel.first().fill('80');
  await refuel.first().dispatchEvent('change');
  await page.waitForTimeout(250);
  const fuelled = await page.evaluate(() => ({
    gal: flights[0].waypoints[1].fuelAfterGal,
    rem: document.getElementById('grand-final-rem').textContent
  }));
  check(fuelled.gal === 80, `typing in the box stored the figure in gallons (${fuelled.gal})`);
  check(parseFloat(fuelled.rem) > parseFloat(remBefore),
    `refuelling raised the final remaining (${remBefore} -> ${fuelled.rem})`);
}

// THE FIRST WAYPOINT OF A PLAN IS ASKED A DIFFERENT QUESTION (v16.58), and it
// is clicked for real for the same reason as everything above: v16.56 fixed
// the fly-by altitude with a jsdom test that ASSERTED the broken case as
// correct, so the suite was green while the reported bug was untouched.
{
  await page.evaluate(() => {
    flights = [{ id: 1, title: 'F', depElev: 500, waypoints: [] }];
    activeFlightIndex = 0;
    document.getElementById('def-alt').value = '4500';
    map.setView([69.679, 18.911], 10, { animate: false });
    refreshMap(); renderAllFlightTables();
  });
  await page.waitForTimeout(400);
  await page.locator('.fix-icon.fix-ad').first().click();
  await page.waitForTimeout(300);
  const asked = await page.evaluate(() => {
    const d = document.getElementById('app-dialog');
    return d ? d.textContent.replace(/\s+/g, ' ') : '';
  });
  check(/first waypoint of the plan/.test(asked),
    'an empty plan is asked the departure question: ' + asked.slice(0, 80));
  check(/Departure/.test(asked) && !/Touch & go/.test(asked) && !/Full stop/.test(asked),
    'Departure replaces the two stop options before there is a departure');

  await page.locator('#app-dialog .dlg-btn', { hasText: 'Fly-by' }).click();
  await page.waitForTimeout(400);
  const flew = await page.evaluate(() => ({
    alt: flights[0].waypoints[0].alt, name: flights[0].waypoints[0].name,
    depElev: flights[0].depElev
  }));
  // ENTC publishes 32 ft. A fly-by is overhead at the planned altitude.
  check(flew.alt === 4500, `a fly-by on an empty plan keeps its altitude (${flew.alt} ft, ENTC publishes 32)`);
  check(flew.depElev === 500, `a fly-by left the departure elevation alone (${flew.depElev} ft)`);

  await page.evaluate(() => {
    flights = [{ id: 1, title: 'F', depElev: 500, waypoints: [] }];
    activeFlightIndex = 0; refreshMap(); renderAllFlightTables();
  });
  await page.waitForTimeout(300);
  await page.locator('.fix-icon.fix-ad').first().click();
  await page.waitForTimeout(300);
  await page.locator('#app-dialog .dlg-btn', { hasText: 'Departure' }).click();
  await page.waitForTimeout(400);
  const dep = await page.evaluate(() => ({
    alt: flights[0].waypoints[0].alt, name: flights[0].waypoints[0].name,
    depElev: flights[0].depElev
  }));
  check(dep.alt === 32 && dep.depElev === 32,
    `Departure puts it on the runway and moves the plan's datum (${dep.alt} ft / ${dep.depElev} ft)`);
  check(dep.name === 'ENTC', 'a departure keeps the ICAO code: ' + dep.name);
}

// THE CORRIDOR RING (v16.61). jsdom has no geometry and no projection, so it
// cannot tell whether the band is drawn at the right SIZE on the chart - which
// is the only thing that matters for a feature you read distances off.
{
  const drawn = await page.evaluate(async () => {
    // A due-north leg, so the band's on-screen WIDTH is exactly twice the radius.
    flights = [{ id: 1, title: 'P', depElev: 0, waypoints: [
      { lat: 69.20, lng: 18.50, name: 'A', alt: 3000, oat: 5, wdir: 0, wspd: 0, var: -11 },
      { lat: 69.50, lng: 18.50, name: 'B', alt: 3000, oat: 5, wdir: 0, wspd: 0, var: -11 }] }];
    activeFlightIndex = 0;
    aircraftProfile.corridorOn = true;
    map.setView([69.35, 18.50], 10, { animate: false });
    const out = [];
    for (const R of [1, 2, 5]) {
      aircraftProfile.corridorNM = R;
      refreshMap();
      await new Promise((r) => setTimeout(r, 350));
      const path = document.querySelector('.leaflet-corridor-pane path');
      if (!path) { out.push({ R, err: 'nothing drawn' }); continue; }
      const w = path.getBoundingClientRect().width;
      // What 2R actually is in pixels here, from Leaflet's OWN projection.
      const e = destinationPoint(69.35, 18.50, 90, R);
      const wst = destinationPoint(69.35, 18.50, 270, R);
      const pe = map.latLngToContainerPoint(L.latLng(e[0], e[1]));
      const pw = map.latLngToContainerPoint(L.latLng(wst[0], wst[1]));
      out.push({ R, drawn: w, expect: Math.abs(pe.x - pw.x),
                 fillRule: path.getAttribute('fill-rule'),
                 fillOpacity: path.getAttribute('fill-opacity') });
    }
    return out;
  });
  for (const d of drawn) {
    const err = d.err ? 999 : Math.abs(100 * (d.drawn - d.expect) / d.expect);
    check(!d.err && err < 3,
      `a ${d.R} NM corridor is drawn ${Math.round(d.drawn || 0)} px wide against ${Math.round(d.expect || 0)} px projected (${err.toFixed(1)}%)`);
  }
  check(drawn.every((d) => d.fillRule === 'nonzero'),
    'the band fills with nonzero - evenodd punches a hole through it at every turn');

  // IT MUST BE SEE-THROUGH. The band exists so the chart's contours and MEF can
  // be read beside the track; an opaque one defeats its own purpose.
  const fills = await page.evaluate(async () => {
    const out = {};
    for (const pct of [8, 40, 60, 100]) {
      aircraftProfile.corridorFillPct = pct;
      drawCorridor();
      await new Promise((r) => setTimeout(r, 150));
      const p = document.querySelector('.leaflet-corridor-pane path');
      out[pct] = p ? Number(p.getAttribute('fill-opacity')) : null;
    }
    return out;
  });
  check(fills[8] === 0.08, `the default band is 8% opaque (got ${fills[8]})`);
  check(fills[40] === 0.4, `the transparency setting reaches the band (got ${fills[40]})`);
  check(fills[60] === 0.6, `60% is reachable, as the pilot asked (got ${fills[60]})`);
  check(fills[100] === 0.6, `an out-of-range value clamps to the ceiling (got ${fills[100]})`);

  // COLOUR: the route's own, or one for every plan (v16.62).
  const cols = await page.evaluate(async () => {
    flights.push({ id: 2, title: 'Q', depElev: 0, waypoints: [
      { lat: 69.25, lng: 18.90, name: 'C', alt: 3000, oat: 5, wdir: 0, wspd: 0, var: -11 },
      { lat: 69.45, lng: 18.90, name: 'D', alt: 3000, oat: 5, wdir: 0, wspd: 0, var: -11 }] });
    const read = () => [...document.querySelectorAll('.leaflet-corridor-pane path')]
      .map((p) => (p.getAttribute('fill') || '').toLowerCase());
    delete aircraftProfile.corridorColorMode;
    refreshMap(); await new Promise((r) => setTimeout(r, 250));
    const route = read();
    aircraftProfile.corridorColorMode = 'single';
    aircraftProfile.corridorColor = '#112233';
    refreshMap(); await new Promise((r) => setTimeout(r, 250));
    const single = read();
    aircraftProfile.corridorColor = 'javascript:alert(1)';
    refreshMap(); await new Promise((r) => setTimeout(r, 250));
    const hostile = read();
    flights.pop();
    delete aircraftProfile.corridorColorMode; delete aircraftProfile.corridorColor;
    refreshMap();
    return { route, single, hostile };
  });
  check(cols.route.length === 2 && cols.route[0] !== cols.route[1],
    `each plan's band takes its own route colour (${cols.route.join(' ')})`);
  check(cols.single.length === 2 && cols.single.every((c) => c === '#112233'),
    `one colour for all applies to every plan (${cols.single.join(' ')})`);
  check(cols.hostile.every((c) => c !== 'javascript:alert(1)'),
    `a hostile colour is rejected before it reaches the map (${cols.hostile.join(' ')})`);

  // AND IT MUST NEVER TAKE A CLICK. The band covers the whole route, so an
  // interactive one would swallow every press meant for a leg or for bare map.
  const clicks = await page.evaluate(async () => {
    aircraftProfile.corridorFillPct = 8;
    aircraftProfile.corridorNM = 5;
    refreshMap();
    await new Promise((r) => setTimeout(r, 300));
    const p = document.querySelector('.leaflet-corridor-pane path');
    const mid = map.latLngToContainerPoint(L.latLng(69.35, 18.52));
    const mr = document.getElementById('map').getBoundingClientRect();
    const top = document.elementFromPoint(mr.left + mid.x, mr.top + mid.y);
    return { pe: p ? getComputedStyle(p).pointerEvents : null,
             topIsCorridor: !!(top && top.closest && top.closest('.leaflet-corridor-pane')) };
  });
  check(clicks.pe === 'none', `the band takes no pointer events (got ${clicks.pe})`);
  check(!clicks.topIsCorridor, 'a point over the band does not hit-test to the band');
  await page.evaluate(() => { aircraftProfile.corridorOn = false; refreshMap(); });
}

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
// Three since v16.52 (Aircraft, Map, Keyboard). The point of the check is that
// every tab has a real box on screen, not how many there happen to be - but it
// still states the count, so a tab going missing is a failure rather than a
// silently shorter list.
check(tabs.tabs.length === 3 && tabs.tabs.every((t) => t.w > 0 && t.y > 0 && t.y < 900),
  'every settings tab is on screen: ' + JSON.stringify(tabs.tabs.map((t) => t.text + '@' + t.y)));
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
