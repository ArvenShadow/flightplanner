#!/usr/bin/env node
/**
 * The VAC overlay, in a real browser - `npm run verify:vac`.
 *
 * WHY jsdom CANNOT DO THIS. The whole feature is a question about what a
 * pointer hits and where ink lands, and jsdom has neither layout nor a
 * compositor:
 *
 *  - PANE ORDER is a computed z-index on elements the Leaflet stub never
 *    creates. The jsdom test greps the source for the numbers; only a browser
 *    can say what the browser actually stacked.
 *  - CLICK-THROUGH is the load-bearing claim. The overlay covers the whole
 *    aerodrome, so if it took pointer events the pilot would lose every fix,
 *    every leg and every airspace tooltip inside it - the feature would break
 *    the planner it is drawn on. `pointer-events: none` is asserted here by
 *    CLICKING THROUGH the drawn image, not by reading the style (v16.53: a
 *    control is only proved by using it).
 *  - WHERE THE INK IS. The georeferencing is measured at build time against
 *    the chart's own graticule and published points, but that measurement is
 *    about the SOURCE SHEET. What the pilot sees is Leaflet placing an
 *    EPSG:3857 raster inside lat/lng bounds, and an error in the bounds, the
 *    warp or the projection assumption would put a correctly-fitted chart in
 *    the wrong place with nothing complaining. So at least three published
 *    fixes are projected to screen pixels and compared against the overlay's
 *    own rendered box.
 *
 * Playwright is not a project dependency; install it when you need this:
 *   npm install --no-save playwright && npx playwright install chromium
 * (Set CHROME_PATH to use a browser already on the machine.)
 *
 * Runs OFFLINE: every non-file:// request is aborted, so the overlay is proved
 * to work with no chart tiles and no network at all - which is the case it
 * exists for.
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

// ---- the dataset actually reached the page ------------------------------
const set = await page.evaluate(() => {
  const v = window.C182_VAC;
  if (!v) return null;
  return { charts: v.charts.length, edition: v.editionLabel || null, dir: v.assetDir || null,
           drawable: v.charts.filter((c) => vacDrawable(c)).length,
           refused: v.charts.filter((c) => !vacDrawable(c)).map((c) => c.icao + ': ' + vacRefusal(c)) };
});
check(!!set && set.charts > 0, 'the VAC index loaded: ' + (set ? set.charts + ' charts, ' + set.edition : 'MISSING'));
check(!!set && set.drawable > 0, (set ? set.drawable : 0) + ' charts pass the fail-closed gate' +
  (set && set.refused.length ? ' (withheld: ' + set.refused.join('; ') + ')' : ''));

// ---- the control is on screen, which this project has shipped wrong -----
// v16.22: two map buttons shipped at y=900 on a 900 px viewport with every
// grep passing. Every control gets a real rect.
const btn = await page.evaluate(() => {
  const el = document.getElementById('vac-btn');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
           text: el.textContent.trim(), inStack: !!el.closest('#map-controls') };
});
check(!!btn && btn.w > 0 && btn.h > 0 && btn.y >= 0 && btn.y < 900 && btn.x >= 0 && btn.x < 1400,
  'the VAC button is on screen: ' + JSON.stringify(btn));
check(!!btn && btn.inStack, 'the VAC button is inside #map-controls, so it needs no CSS of its own');

/** Pick a chart to fly this check over, and go there. */
const chart = await page.evaluate(() => {
  const v = window.C182_VAC;
  const c = v.charts.filter((x) => vacDrawable(x))
    .find((x) => x.icao === 'ENDU') || v.charts.find((x) => vacDrawable(x));
  return c ? { icao: c.icao, bounds: c.bounds, file: c.file, chartDate: c.chartDate,
               residualM: c.residualM, controlSource: c.controlSource } : null;
});
check(!!chart, 'a drawable chart to check: ' + (chart ? chart.icao + ' ' + chart.chartDate : 'NONE'));
if (!chart) { console.log('\nRESULT: cannot continue without a chart'); await b.close(); process.exit(1); }

const centre = [(chart.bounds.north + chart.bounds.south) / 2, (chart.bounds.east + chart.bounds.west) / 2];

// ---- the toggle turns it on, and the image really paints ----------------
await page.evaluate(([lat, lng]) => {
  // setView with the animation ON reports the OLD zoom for a frame, which once
  // made verify:fixes read 15 fixes at zoom 6 and 0 at zoom 7 - exactly
  // inverted. Always animate: false, then settle.
  map.setView([lat, lng], 12, { animate: false });
  aircraftProfile.fixesOn = true; updateFixesBtn(); drawFixes();
}, centre);
await page.waitForTimeout(400);

const beforeToggle = await page.locator('img.vac-image').count();
check(beforeToggle === 0, 'nothing is drawn before the toggle (' + beforeToggle + ')');

await page.locator('#vac-btn').click();
await page.waitForTimeout(1200);

const img = await page.evaluate(() => {
  const el = document.querySelector('img.vac-image');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return { src: el.getAttribute('src'), complete: el.complete,
           naturalWidth: el.naturalWidth, naturalHeight: el.naturalHeight,
           x: r.x, y: r.y, w: r.width, h: r.height,
           opacity: cs.opacity, pointerEvents: cs.pointerEvents,
           paneEvents: getComputedStyle(el.parentElement).pointerEvents,
           paneZ: getComputedStyle(el.parentElement).zIndex, pane: el.parentElement.className };
});
check(!!img, 'the toggle drew an overlay image');
// A BROKEN IMAGE HAS A BOX TOO. `naturalWidth` is 0 when the browser could not
// decode the file - which is exactly what a wrong path, a stale asset copy or
// an unsupported codec looks like, and the box alone would not show it.
check(!!img && img.complete && img.naturalWidth > 0,
  'the raster DECODED: ' + (img ? img.naturalWidth + 'x' + img.naturalHeight + ' from ' + img.src : 'no image'));
check(!!img && img.w > 200 && img.h > 200,
  'the sheet covers the view: ' + (img ? Math.round(img.w) + 'x' + Math.round(img.h) + ' css px' : ''));

// ---- Z-ORDER AND POINTER EVENTS, computed, not read off the source ------
const panes = await page.evaluate(() => {
  const z = (n) => {
    const p = map.getPane(n);
    return p ? { z: Number(getComputedStyle(p).zIndex), events: getComputedStyle(p).pointerEvents } : null;
  };
  return { vac: z('vacPane'), corridor: z('corridorPane'), airspace: z('airspacePane'),
           overlay: z('overlayPane'), marker: z('markerPane') };
});
check(panes.vac && Number.isFinite(panes.vac.z), 'vacPane exists with a computed z-index: ' +
  JSON.stringify(panes));
check(panes.vac.z < panes.corridor.z, `the VAC is below the corridor (${panes.vac.z} < ${panes.corridor.z})`);
check(panes.vac.z < panes.airspace.z, `the VAC is below the airspace (${panes.vac.z} < ${panes.airspace.z})`);
check(panes.vac.z < panes.overlay.z, `the VAC is below the route line (${panes.vac.z} < ${panes.overlay.z})`);
check(panes.vac.z < panes.marker.z, `the VAC is below the fix markers (${panes.vac.z} < ${panes.marker.z})`);
check(img.paneEvents === 'none', 'the vacPane takes no pointer events: ' + img.paneEvents);

// THE REAL TEST of click-through: what does the browser say is on top at a
// point the overlay covers? If the image is there, every gesture inside the
// chart is lost.
const onTop = await page.evaluate(() => {
  const el = document.querySelector('img.vac-image');
  const r = el.getBoundingClientRect();
  const mr = document.getElementById('map').getBoundingClientRect();
  const x = Math.max(mr.left + 30, Math.min(mr.right - 30, r.left + r.width / 2));
  const y = Math.max(mr.top + 30, Math.min(mr.bottom - 30, r.top + r.height / 2));
  const hit = document.elementFromPoint(x, y);
  return { x, y, tag: hit ? hit.tagName : null, cls: hit ? String(hit.className) : null };
});
check(!/vac-image/.test(String(onTop.cls)),
  'the image is not what the pointer finds over the chart: ' + onTop.tag + '|' + onTop.cls);

// WHICH HALF IS LOAD-BEARING, MEASURED RATHER THAN BELIEVED (the v16.70
// discipline). Two things keep the raster out of the pointer's way: the pane's
// `pointer-events: none`, and `interactive: false` on the overlay itself.
// MEASURED by mutation: with the pane set to `auto` the click-through checks
// all still pass, because Leaflet leaves a non-interactive image layer inert
// on its own - so `interactive: false` is what carries this, and the pane rule
// is the BACKSTOP for anything later added to that pane. Flip it here and
// re-measure, so the comment above cannot drift from the code.
const withPaneAuto = await page.evaluate(() => {
  const pane = map.getPane('vacPane');
  const was = pane.style.pointerEvents;
  pane.style.pointerEvents = 'auto';
  const el = document.querySelector('img.vac-image');
  const r = el.getBoundingClientRect();
  const mr = document.getElementById('map').getBoundingClientRect();
  const x = Math.max(mr.left + 30, Math.min(mr.right - 30, r.left + r.width / 2));
  const y = Math.max(mr.top + 30, Math.min(mr.bottom - 30, r.top + r.height / 2));
  const hit = document.elementFromPoint(x, y);
  const out = { events: getComputedStyle(el).pointerEvents,
                cls: hit ? String(hit.className.baseVal || hit.className) : null };
  pane.style.pointerEvents = was;
  return out;
});
check(withPaneAuto.events === 'none' && !/vac-image/.test(String(withPaneAuto.cls)),
  'the overlay is inert on its own too (interactive:false -> pointer-events ' +
  withPaneAuto.events + '), so the pane rule is the backstop, not the mechanism');

// ---- CLICK A REPORTING POINT THROUGH THE DRAWN CHART --------------------
// The v16.34 promise: one click, one waypoint, on the published coordinate,
// no naming dialog. It must survive a full-sheet image being drawn over it.
const pick = await page.evaluate((icao) => {
  const layer = fixLayers.find((l) => {
    if (!l._icon || !l._icon.classList.contains('fix-rp')) return false;
    const r = l._icon.getBoundingClientRect();
    const v = document.querySelector('img.vac-image').getBoundingClientRect();
    return r.left > v.left && r.right < v.right && r.top > v.top && r.bottom < v.bottom;
  });
  if (!layer) return null;
  const r = layer._icon.querySelector('.fix-svg').getBoundingClientRect();
  const name = layer._icon.textContent.trim();
  const ad = window.C182_AIP.aerodromes.find((a) => a.icao === icao);
  const pub = ad && ad.points.find((p) => p.name === name);
  return { name, at: [r.left + r.width / 2, r.top + r.height / 2],
           lat: pub ? pub.lat : null, lng: pub ? pub.lng : null };
}, chart.icao);
check(!!pick, 'a reporting point is drawn inside the chart to click: ' + (pick ? pick.name : 'NONE'));

if (pick) {
  const before = await page.evaluate(() => flights[activeFlightIndex].waypoints.length);
  await page.mouse.click(pick.at[0], pick.at[1]);
  await page.waitForTimeout(350);
  const after = await page.evaluate(() => {
    const w = flights[activeFlightIndex].waypoints;
    const last = w.slice(-1)[0];
    return { n: w.length, name: last ? last.name : null, lat: last ? last.lat : null,
             lng: last ? last.lng : null, dialogs: document.querySelectorAll('#app-dialog').length };
  });
  check(after.n === before + 1,
    `one click through the chart added exactly one waypoint (${before} -> ${after.n})`);
  check(after.name === pick.name, 'it is the fix that was clicked: ' + after.name);
  check(pick.lat !== null && after.lat === pick.lat && after.lng === pick.lng,
    `on the PUBLISHED coordinate, not a pixel off the raster (${after.lat}, ${after.lng})`);
  check(after.dialogs === 0, 'the click did not also reach the map (no naming dialog)');
}

// ---- WHERE THE INK IS: three published fixes against the rendered box ----
// The build measures the fit against the SOURCE SHEET. This measures the
// delivery: bounds, warp and projection together, as the pilot sees them.
// The overlay is an EPSG:3857 raster placed in lat/lng bounds, so a fix's
// position INSIDE the image is computable from Web Mercator alone - and if
// Leaflet, the bounds or the warp disagreed, it would land somewhere else.
const ink = await page.evaluate((icao) => {
  const el = document.querySelector('img.vac-image');
  const r = el.getBoundingClientRect();
  const c = window.C182_VAC.charts.find((x) => x.icao === icao);
  const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2));
  const ad = window.C182_AIP.aerodromes.find((a) => a.icao === icao);
  const pts = ad.points.slice(0, 20).filter((p) =>
    p.lng > c.bounds.west && p.lng < c.bounds.east && p.lat > c.bounds.south && p.lat < c.bounds.north);
  const y0 = merc(c.bounds.north), y1 = merc(c.bounds.south);
  const out = [];
  for (const p of pts) {
    // Where Web Mercator says the fix is inside the image...
    const fx = (p.lng - c.bounds.west) / (c.bounds.east - c.bounds.west);
    const fy = (y0 - merc(p.lat)) / (y0 - y1);
    // ...and where Leaflet actually puts that coordinate on screen.
    const ll = map.latLngToContainerPoint([p.lat, p.lng]);
    const mr = document.getElementById('map').getBoundingClientRect();
    out.push({ name: p.name,
      dx: (r.left + fx * r.width) - (mr.left + ll.x),
      dy: (r.top + fy * r.height) - (mr.top + ll.y) });
  }
  // CSS px -> metres, at this zoom and latitude, so the number is comparable
  // with the build's residual rather than being a screen artefact.
  const mPerPx = 156543.03392 * Math.cos(map.getCenter().lat * Math.PI / 180) / Math.pow(2, map.getZoom());
  return { pts: out, mPerPx };
}, chart.icao);
const worst = ink.pts.length ? Math.max(...ink.pts.map((p) => Math.hypot(p.dx, p.dy))) : Infinity;
check(ink.pts.length >= 3, `${ink.pts.length} published fixes measured against the drawn sheet`);
// ONE PIXEL IS THE BOUND, AND IT IS THE RIGHT ONE. This check compares two
// projections of the SAME bounds, so anything above rounding means the
// delivery disagrees with itself; the georeferencing accuracy proper is the
// build's residual, asserted there. At z12 and 69N a pixel is ~10 m.
check(worst <= 1.5, `every one lands within ${worst.toFixed(2)} px ` +
  `(~${(worst * ink.mPerPx).toFixed(1)} m) of where Leaflet projects it`);

// ---- THE ROUTE LINE STILL TAKES A DRAG UNDER THE CHART ------------------
// The v16.31 airspace check, on the new surface: press the leg, move, release,
// and a via must appear with the waypoint count unchanged. If the image were
// above overlayPane the press would land on it and bubble to the map as "add
// a waypoint" instead.
{
  const seeded = await page.evaluate(([icao, lat, lng]) => {
    const ad = window.C182_AIP.aerodromes.find((a) => a.icao === icao);
    const ps = ad.points;
    if (ps.length < 2) return null;
    // THE VIEW IS SET, NOT FITTED. fitBounds on two reporting points lands
    // wherever they happen to be apart - the first version of this check came
    // to rest at ZOOM 9, where the overlay is deliberately not drawn, so it
    // "passed" having proved click-through under nothing at all. The M5 trap:
    // a fixture that quietly stops exercising what it claims.
    map.setView([lat, lng], 11, { animate: false });
    const near = ps.map((p) => ({ p, d: Math.hypot(p.lat - lat, (p.lng - lng) * 0.4) }))
      .sort((a, b) => a.d - b.d).slice(0, 2).map((x) => x.p);
    flights = [{ id: 1, title: 'F', depElev: 254, waypoints: near.map((p) => (
      { lat: p.lat, lng: p.lng, name: p.name, alt: 2500, oat: 0, wdir: 0, wspd: 0, var: -11 }))}];
    activeFlightIndex = 0;
    refreshMap(); renderAllFlightTables(); drawVac();
    // DERIVE THE GRAB POINT AND PROVE IT. Walk the screen chord between the
    // two fixes and take the first place the browser says an interactive route
    // path is on top. A hardcoded or merely-computed point is an unchecked
    // assertion about the layout, and when it is wrong the failure ACCUSES THE
    // FEATURE (the v16.83 bare-map lesson).
    const a = map.latLngToContainerPoint([near[0].lat, near[0].lng]);
    const c = map.latLngToContainerPoint([near[1].lat, near[1].lng]);
    const mr = document.getElementById('map').getBoundingClientRect();
    let grab = null, onTop = null;
    for (let t = 0.5, k = 0; k < 40; k++, t = 0.5 + (k % 2 ? 1 : -1) * 0.01 * Math.ceil(k / 2)) {
      const x = mr.left + a.x + (c.x - a.x) * t, y = mr.top + a.y + (c.y - a.y) * t;
      if (x < mr.left + 20 || x > mr.right - 20 || y < mr.top + 20 || y > mr.bottom - 20) continue;
      const el = document.elementFromPoint(x, y);
      const cls = el ? String(el.className.baseVal || el.className || '') : '';
      if (el) onTop = el.tagName + '|' + cls;
      if (el && el.tagName === 'path' && /leaflet-interactive/.test(cls)) { grab = [x, y]; break; }
    }
    return { grab, onTop, zoom: map.getZoom(),
             wps: flights[0].waypoints.length, vias: (flights[0].waypoints[1].via || []).length };
  }, [chart.icao, centre[0], centre[1]]);
  check(!!seeded, 'a two-fix route seeded over the chart');
  const drawnHere = await page.locator('img.vac-image').count();
  // NOT "if the zoom happens to be high enough". The whole point of the drag
  // below is that it happens UNDER a drawn chart, so an undrawn chart fails.
  check(seeded && seeded.zoom >= 10 && drawnHere > 0,
    `the chart really is drawn under the route at zoom ${seeded ? seeded.zoom : '?'} (${drawnHere} image(s))`);
  check(!!(seeded && seeded.grab),
    'the route line is what the pointer finds over the chart: ' + (seeded ? seeded.onTop : 'no route'));
  if (seeded && seeded.grab) {
    await page.mouse.move(seeded.grab[0], seeded.grab[1]);
    await page.mouse.down();
    await page.mouse.move(seeded.grab[0] + 40, seeded.grab[1] + 40, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(350);
    const got = await page.evaluate(() => ({
      wps: flights[0].waypoints.length, vias: (flights[0].waypoints[1].via || []).length,
      dialogs: document.querySelectorAll('#app-dialog').length }));
    check(got.wps === seeded.wps, `the drag did not add a waypoint (${seeded.wps} -> ${got.wps})`);
    check(got.vias === seeded.vias + 1, `the leg bent under the chart (${seeded.vias} -> ${got.vias} via)`);
    check(got.dialogs === 0, 'and no naming dialog opened');
  }
}

// ---- THE AIRSPACE CARD STILL RESOLVES UNDER THE CHART -------------------
{
  const found = await page.evaluate(([lat, lng]) => {
    aircraftProfile.airspaceOn = true;
    if (typeof updateAirspaceBtn === 'function') updateAirspaceBtn();
    map.setView([lat, lng], 12, { animate: false });
    drawAirspace(); drawVac();
    // A POLYGON'S BOUNDING-BOX CENTRE IS NOT A POINT ON SCREEN, and the first
    // version of this check assumed it was: at zoom 12 the enclosing TMA's
    // bbox centre measured 24 000 px off the viewport, elementFromPoint
    // returned null, nothing was hovered, and the failure read as "the chart
    // swallowed the airspace card". Scan the visible map instead and take the
    // first point the browser says an airspace path is under - which also
    // PROVES the point before it is used, rather than hoping.
    const mr = document.getElementById('map').getBoundingClientRect();
    const pane = map.getPane('airspacePane');
    for (let fy = 0.2; fy <= 0.8; fy += 0.1) {
      for (let fx = 0.2; fx <= 0.8; fx += 0.1) {
        const x = mr.left + mr.width * fx, y = mr.top + mr.height * fy;
        const el = document.elementFromPoint(x, y);
        if (el && el.tagName === 'path' && pane && pane.contains(el)) return { at: [x, y], n: airspaceLayers.length };
      }
    }
    return { at: null, n: airspaceLayers.length };
  }, centre);
  check(found.n > 0, `${found.n} airspace polygons drawn under the chart`);
  check(!!found.at, 'an airspace polygon is what the pointer finds through the chart');
  if (found.at) {
    // Leaflet rebuilds a sticky tooltip on mousemove, so the card needs a real
    // MOVE into the polygon - arriving by teleport fires nothing. Same gesture
    // tools/verify-airspace-hover.mjs uses.
    await page.mouse.move(found.at[0] - 30, found.at[1] - 30);
    await page.waitForTimeout(150);
    await page.mouse.move(found.at[0], found.at[1], { steps: 6 });
    await page.waitForTimeout(400);
    const tip = await page.evaluate(() => {
      const t = document.querySelector('.airspace-tip');
      return t ? t.innerText.replace(/\s+/g, ' ').slice(0, 70) : '';
    });
    check(tip.length > 0, 'the airspace card still appears through the chart: ' + tip);
  }
}

// ---- THE MIN ZOOM IS A REAL THRESHOLD, MEASURED -------------------------
// Reasoned in src/lib/vac.js; asserted here on screen, because a threshold
// nobody has seen fire is not known to fire.
{
  const counts = {};
  for (const z of [9, 10]) {
    await page.evaluate(([lat, lng, zoom]) => { map.setView([lat, lng], zoom, { animate: false }); drawVac(); },
      [centre[0], centre[1], z]);
    await page.waitForTimeout(500);
    counts[z] = await page.locator('img.vac-image').count();
  }
  check(counts[9] === 0, `nothing is drawn at zoom 9 (${counts[9]})`);
  check(counts[10] > 0, `the chart appears at zoom ${'10'} (${counts[10]})`);
}

// ---- THE OPACITY SETTING REACHES THE PIXEL ------------------------------
{
  const applied = await page.evaluate(() => {
    const out = {};
    for (const v of [0.2, 0.6, 1, 5, 'nonsense']) {
      aircraftProfile.vacOpacity = v;
      drawVac();
      const el = document.querySelector('img.vac-image');
      out[String(v)] = el ? Number(getComputedStyle(el).opacity) : null;
    }
    aircraftProfile.vacOpacity = 0.85; drawVac();
    return out;
  });
  check(Math.abs(applied['0.2'] - 0.2) < 0.02 && Math.abs(applied['0.6'] - 0.6) < 0.02,
    'the opacity setting reaches the rendered image: ' + JSON.stringify(applied));
  // A hostile or absurd value must fall back to the default, never to invisible.
  check(applied['5'] === 1 && Math.abs(applied['nonsense'] - 0.85) < 0.02,
    'an out-of-range value clamps and an unreadable one falls back: ' + JSON.stringify(applied));
}

// ---- THE LABEL BAR NAMES THE CHART AND ITS LICENCE ----------------------
{
  const bar = await page.evaluate(() => {
    const el = document.getElementById('chart-label');
    return el ? el.textContent.replace(/\s+/g, ' ') : '';
  });
  check(/VAC/.test(bar), 'the label bar names the drawn chart: ' + bar.slice(0, 140));
  const attrib = await page.evaluate(() => vacAttribution(window.C182_VAC));
  check(/Avinor/.test(attrib) && /non-commercial/i.test(attrib),
    'the attribution carries the permission and its condition: ' + attrib.slice(0, 110));
}

// ---- THE TOGGLE TURNS IT BACK OFF ---------------------------------------
await page.evaluate(([lat, lng]) => { map.setView([lat, lng], 12, { animate: false }); drawVac(); }, centre);
await page.waitForTimeout(400);
await page.locator('#vac-btn').click();
await page.waitForTimeout(500);
const offCount = await page.locator('img.vac-image').count();
check(offCount === 0, `turning it off removes every image (${offCount})`);

check(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));

console.log('\nRESULT: ' + (fails.length ? fails.length + ' PROBLEM(S)' : 'all VAC checks passed'));
await b.close();
process.exit(fails.length ? 1 : 0);
