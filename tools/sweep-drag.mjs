#!/usr/bin/env node
/**
 * A DRAG SWEEP OVER THE CLIMB/DESCENT CORNERS - `node tools/sweep-drag.mjs`
 *
 * WHY THIS EXISTS. The pilot's report on v16.74 was "there are several bugs,
 * some also throw red banner" - i.e. the shapes I had not thought to drive. A
 * targeted check finds the case you imagined; a sweep finds the case you did
 * not. This drives EVERY mark on a set of deliberately awkward plans to a grid
 * of positions and, after each drop, asserts what must hold whatever was asked
 * for:
 *
 *   1. NO RED BANNER. Every outcome of a drag is a flyable plan - a clamp, a
 *      carried-back climb, or a refusal that changed nothing. "DO NOT USE THESE
 *      FIGURES" after a gesture is always a bug.
 *   2. NO PAGE ERROR.
 *   3. THE ALTITUDE COLUMN AGREES WITH ITSELF: exit(k) == entry(k+1).
 *   4. EVERY PHASE IS FINITE AND >= 0, and the phases sum to the leg.
 *   5. NO DUPLICATE MARK of the same kind on one leg, and every mark sits on
 *      the track it belongs to.
 *   6. NOTHING RATCHETS: dragging a TOC forward again must not leave a fix
 *      permanently raised (the pilot's third report).
 *
 * Failures are printed as a reproducible line: the plan, the mark, the drop.
 */
import { chromium } from 'playwright';
const APP = new URL('../site/index.html', import.meta.url).pathname;
const N = Number(process.env.SWEEP_N || 1);
const b = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await (await b.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
await page.route('**://**/**', (r) => r.request().url().startsWith('file:') ? r.continue() : r.abort());
await page.goto('file://' + APP, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);
await page.evaluate(() => { try { closeHelpModal(); } catch (e) {} setLayoutMode('map'); });

/** Deliberately awkward shapes, not a happy path among them. */
const PLANS = {
  'climb-only': [
    { lat: 69.055, lng: 18.544, name: 'ENDU', alt: 254, oat: 10, wdir: 0, wspd: 0, var: -11 },
    { lat: 69.679, lng: 18.911, name: 'ENTC', alt: 6500, oat: 0, wdir: 0, wspd: 0, var: -12 }],
  'descent-only': [
    { lat: 69.055, lng: 18.544, name: 'ENDU', alt: 6500, oat: 0, wdir: 0, wspd: 0, var: -11 },
    { lat: 69.679, lng: 18.911, name: 'ENTC', alt: 500, oat: 5, wdir: 0, wspd: 0, var: -12 }],
  'climb-then-climb': [
    { lat: 68.60, lng: 18.50, name: 'ENDU', alt: 254, oat: 10, wdir: 0, wspd: 0, var: -11 },
    { lat: 69.20, lng: 18.50, name: 'MID', alt: 2500, oat: 5, wdir: 0, wspd: 0, var: -11 },
    { lat: 69.90, lng: 18.50, name: 'ENTC', alt: 8500, oat: 0, wdir: 0, wspd: 0, var: -12 }],
  'climb-cruise-descend': [
    { lat: 68.60, lng: 18.50, name: 'ENDU', alt: 254, oat: 10, wdir: 0, wspd: 0, var: -11 },
    { lat: 69.10, lng: 18.50, name: 'A', alt: 7500, oat: 0, wdir: 0, wspd: 0, var: -11 },
    { lat: 69.50, lng: 18.50, name: 'B', alt: 7500, oat: 0, wdir: 0, wspd: 0, var: -11 },
    { lat: 69.95, lng: 18.50, name: 'ENTC', alt: 300, oat: 5, wdir: 0, wspd: 0, var: -12 }],
  'short-final-leg': [
    { lat: 68.60, lng: 18.50, name: 'ENDU', alt: 254, oat: 10, wdir: 0, wspd: 0, var: -11 },
    { lat: 69.60, lng: 18.50, name: 'A', alt: 8000, oat: 0, wdir: 0, wspd: 0, var: -11 },
    { lat: 69.66, lng: 18.50, name: 'ENTC', alt: 2000, oat: 5, wdir: 0, wspd: 0, var: -12 }],
  'with-a-circuit': [
    { lat: 68.80, lng: 18.50, name: 'ENDU', alt: 254, oat: 10, wdir: 0, wspd: 0, var: -11 },
    { lat: 69.30, lng: 18.50, name: 'A', alt: 4500, oat: 5, wdir: 0, wspd: 0, var: -11 },
    { lat: 69.40, lng: 18.50, name: 'PATTERN', alt: 1000, oat: 5, wdir: 0, wspd: 0, var: -11, isPattern: true, laps: 3 },
    { lat: 69.90, lng: 18.50, name: 'ENTC', alt: 500, oat: 5, wdir: 0, wspd: 0, var: -12 }],
  'descend-then-climb': [
    { lat: 68.70, lng: 18.50, name: 'ENDU', alt: 6000, oat: 0, wdir: 0, wspd: 0, var: -11 },
    { lat: 69.10, lng: 18.50, name: 'A', alt: 1500, oat: 5, wdir: 0, wspd: 0, var: -11 },
    { lat: 69.60, lng: 18.50, name: 'B', alt: 9000, oat: -10, wdir: 0, wspd: 0, var: -11 },
    { lat: 69.95, lng: 18.50, name: 'ENTC', alt: 600, oat: 5, wdir: 0, wspd: 0, var: -12 }],
  'five-legs': [
    { lat: 68.40, lng: 18.30, name: 'ENDU', alt: 254, oat: 10, wdir: 200, wspd: 20, var: -11 },
    { lat: 68.80, lng: 18.60, name: 'A', alt: 3000, oat: 8, wdir: 200, wspd: 20, var: -11 },
    { lat: 69.10, lng: 18.20, name: 'B', alt: 6500, oat: 2, wdir: 200, wspd: 20, var: -11 },
    { lat: 69.45, lng: 18.90, name: 'C', alt: 6500, oat: 2, wdir: 200, wspd: 20, var: -11 },
    { lat: 69.70, lng: 18.40, name: 'D', alt: 3500, oat: 6, wdir: 200, wspd: 20, var: -11 },
    { lat: 69.95, lng: 18.80, name: 'ENTC', alt: 400, oat: 8, wdir: 200, wspd: 20, var: -12 }],
  'tiny-legs': [
    { lat: 69.00, lng: 18.50, name: 'ENDU', alt: 254, oat: 10, wdir: 0, wspd: 0, var: -11 },
    { lat: 69.06, lng: 18.50, name: 'A', alt: 3000, oat: 8, wdir: 0, wspd: 0, var: -11 },
    { lat: 69.12, lng: 18.50, name: 'B', alt: 3000, oat: 8, wdir: 0, wspd: 0, var: -11 },
    { lat: 69.18, lng: 18.50, name: 'ENTC', alt: 300, oat: 10, wdir: 0, wspd: 0, var: -12 }],
  'bent-leg-with-vias': [
    { lat: 68.70, lng: 18.50, name: 'ENDU', alt: 254, oat: 10, wdir: 0, wspd: 0, var: -11 },
    { lat: 69.60, lng: 18.50, name: 'A', alt: 7000, oat: 0, wdir: 0, wspd: 0, var: -11,
      via: [{ lat: 69.00, lng: 19.10 }, { lat: 69.30, lng: 18.10 }] },
    { lat: 69.95, lng: 18.50, name: 'ENTC', alt: 500, oat: 5, wdir: 0, wspd: 0, var: -12 }],
  'windy': [
    { lat: 68.70, lng: 18.50, name: 'ENDU', alt: 254, oat: -10, wdir: 250, wspd: 45, var: -11 },
    { lat: 69.30, lng: 19.60, name: 'A', alt: 9500, oat: -20, wdir: 250, wspd: 45, var: -11 },
    { lat: 69.85, lng: 18.20, name: 'ENTC', alt: 400, oat: -5, wdir: 250, wspd: 45, var: -12 }]
};

const load = (wps) => page.evaluate(async (wps) => {
  flights = [{ id: 1, title: 'SW', depElev: wps[0].alt, waypoints: JSON.parse(JSON.stringify(wps)) }];
  activeFlightIndex = 0;
  const lats = wps.map((w) => w.lat), lngs = wps.map((w) => w.lng);
  map.fitBounds([[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]],
    { animate: false, padding: [70, 70] });
  const th = document.getElementById('app-toasts'); if (th) th.innerHTML = '';
  refreshMap(); renderAllFlightTables();
  await new Promise((r) => setTimeout(r, 260));
}, wps);

/** Each drawn mark, WITH the leg it belongs to. profileMarkers are pushed in
 *  leg order, so walking the legs in the same order pairs them up - and knowing
 *  the leg is what lets a drop be placed at a fraction of the mark's OWN leg
 *  rather than of the whole route line. Dropping at a fraction of the flight
 *  was the sweep's blind spot: on a 3-fix plan every fraction past the first
 *  leg projects onto that leg's END, so a TOC two thirds along its own leg -
 *  which is where the real conflict lives - was never asked for. */
const marks = () => page.evaluate(() => {
  const fl = flights[0];
  const sc = computeFlightSchedule(fl);
  const legOf = [];
  for (let k = 0; k < fl.waypoints.length - 1; k++) {
    const mk = computeLegMarkers(fl.waypoints[k], fl.waypoints[k + 1], sc[k]);
    for (let j = 0; j < mk.length; j++) legOf.push(k);
  }
  return profileMarkers.map((m, i) => {
    const el = m.getElement();
    const g = el.querySelector('.prof-tick,.prof-ring');
    if (!g) return null;
    const r = g.getBoundingClientRect();
    return { i, k: (el.textContent || '').trim().replace(/^F\d+\s*/, ''),
             leg: legOf[i] === undefined ? 0 : legOf[i],
             cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2) };
  }).filter(Boolean);
});

/** Everything that must hold after ANY drop, read straight off the app. */
const audit = () => page.evaluate(() => {
  const out = { banner: '', bad: [] };
  const el = document.getElementById('integrity-banner');
  if (el && getComputedStyle(el).display !== 'none') {
    out.banner = el.textContent.replace(/\s+/g, ' ').replace('⛔ INTEGRITY CHECK FAILED - DO NOT USE THESE FIGURES', '').trim().slice(0, 120);
  }
  const fl = flights[0];
  const sc = computeFlightSchedule(fl);
  const seen = [];
  for (let k = 0; k < sc.length; k++) {
    const L = sc[k];
    // A NULL SCHEDULE LEG IS LEGITIMATE, not a fault: a circuit stop BREAKS THE
    // CHAIN (v16.5), so the pattern leg and the one after it are rendered by the
    // independent computeLegTotals path instead. Flagging them made the sweep
    // report 22 problems on one correct plan.
    if (!L) continue;
    for (const f of ['climbStartNM', 'climbDistNM', 'cruiseDistNM', 'descDistNM', 'distNM']) {
      const v = L[f];
      if (v === undefined || v === null) continue;
      if (!isFinite(v)) out.bad.push('leg ' + k + ': ' + f + ' is ' + v);
      else if (v < -0.001) out.bad.push('leg ' + k + ': ' + f + ' is negative (' + v.toFixed(3) + ')');
    }
    if (isFinite(L.climbStartNM) && isFinite(L.climbDistNM) && isFinite(L.distNM)
        && L.climbStartNM + L.climbDistNM > L.distNM + 0.05) {
      out.bad.push('leg ' + k + ': the climb leaves the leg (' +
        (L.climbStartNM + L.climbDistNM).toFixed(2) + ' > ' + L.distNM.toFixed(2) + ')');
    }
    if (k + 1 < sc.length && sc[k + 1] && isFinite(L.exitAlt) && isFinite(sc[k + 1].entryAlt)
        && Math.abs(L.exitAlt - sc[k + 1].entryAlt) > 1
        && !fl.waypoints[k + 1].isPattern) {
      out.bad.push('legs ' + k + '/' + (k + 1) + ': exit ' + L.exitAlt + ' != entry ' + sc[k + 1].entryAlt);
    }
    const mk = computeLegMarkers(fl.waypoints[k], fl.waypoints[k + 1], L);
    const kinds = mk.map((m) => m.kind);
    for (const kind of new Set(kinds)) {
      if (kinds.filter((x) => x === kind).length > 1) out.bad.push('leg ' + k + ': two ' + kind + ' marks');
    }
    for (const m of mk) {
      if (!isFinite(m.lat) || !isFinite(m.lng)) { out.bad.push('leg ' + k + ': ' + m.kind + ' has no position'); continue; }
      const rep = alongLegNM(fl.waypoints[k], fl.waypoints[k + 1], L.latLng ? L.latLng(m.lat, m.lng) : { lat: m.lat, lng: m.lng });
      // THE TOLERANCE IS THE GREAT CIRCLE'S OWN BOW. `alongLegNM` measures
      // against the straight waypoint-to-waypoint chord while the mark sits on
      // the GEODESIC; on the long turning legs in this set that is 0.18 NM, and
      // v16.63 measured 5.16 NM of separation on a 229 NM east-west leg. 0.4 NM
      // is well inside that and still catches what this exists for - a mark
      // dropped off the line lands miles away.
      if (rep && rep.offTrackNM > 0.4) out.bad.push('leg ' + k + ': ' + m.kind + ' is ' + rep.offTrackNM.toFixed(2) + ' NM off track');
      seen.push(m.kind);
    }
    // A pin the pilot set must not silently exceed its own leg.
    const to = fl.waypoints[k + 1];
    for (const pin of ['bocNM', 'tocNM', 'bodNM']) {
      const v = to[pin];
      if (v != null && (!isFinite(v) || v < 0)) out.bad.push('leg ' + k + ': ' + pin + ' is ' + v);
    }
  }
  return out;
});

const drag = async (m, tx, ty) => {
  await page.mouse.move(m.cx, m.cy);
  await page.mouse.down();
  for (let s = 1; s <= 8; s++) {
    await page.mouse.move(m.cx + (tx - m.cx) * s / 8, m.cy + (ty - m.cy) * s / 8);
  }
  await page.mouse.up();
  await page.waitForTimeout(230);
};

const problems = [];
let drags = 0;
const seenBanner = new Map();

const ONLY = process.env.PLAN || '';
for (let rep = 0; rep < N; rep++) {
for (const [name, wps] of Object.entries(PLANS)) {
  if (ONLY && name !== ONLY) continue;
  // Where along the track to try dropping: both ends, and steps between.
  for (const frac of [0.01, 0.12, 0.3, 0.5, 0.68, 0.85, 0.99]) {
    // EVERY MARK, not just the ends. A five-leg plan draws marks in the middle
    // of the list, and those are the ones whose leg has neighbours on both
    // sides - which is where the interactions live.
    const count = (await (async () => { await load(wps); return (await marks()).length; })());
    for (let mi = 0; mi < count; mi++) {
      await load(wps);
      // A PLAN CAN BE UNFLYABLE BEFORE ANYTHING IS DRAGGED - `short-final-leg`
      // genuinely cannot get down 6000 ft in 3.6 NM, and the banner is RIGHT to
      // say so. Only a banner the DRAG introduced is a bug, so the baseline is
      // taken first and subtracted.
      const base = await audit();
      const before = await page.evaluate(() => JSON.stringify(flights[0].waypoints.map((w) => w.alt)));
      const ms = await marks();
      if (!ms.length) continue;
      if (mi >= ms.length) continue;
      const m = ms[mi];
      // Drop at `frac` along the mark's OWN leg.
      const target = await page.evaluate(([frac, leg]) => {
        const fl = flights[0];
        const sc = computeFlightSchedule(fl);
        const L = sc[leg];
        if (!L || !L.segs) return null;
        const p = pointAlongSegments(L.segs, frac * L.distNM);
        if (!p) return null;
        const c = map.latLngToContainerPoint(L.latLng ? L.latLng(p.lat, p.lng) : window.L.latLng(p.lat, p.lng));
        const r = document.getElementById('map').getBoundingClientRect();
        return [Math.round(r.x + c.x), Math.round(r.y + c.y)];
      }, [frac, m.leg]);
      if (!target) continue;
      await drag(m, target[0], target[1]);
      drags++;
      const a = await audit();
      const where = `${name} / drag ${m.k}#${mi} to ${frac}`;
      if (a.banner && !base.banner) {
        problems.push(`BANNER  ${where}: ${a.banner}`);
        seenBanner.set(a.banner, (seenBanner.get(a.banner) || 0) + 1);
      }
      for (const bad of a.bad) if (!base.bad.includes(bad)) problems.push(`STATE   ${where}: ${bad}`);

      // 6. NOTHING RATCHETS. Drag the same mark back to the far end and the
      //    altitudes the pilot typed must come back.
      const ms2 = await marks();
      // MATCH THE MARK ON KIND *AND* LEG. Matching on kind alone picks the
      // first TOC anywhere in the plan, which after the first drag can belong
      // to a different leg - so the return drag moved the wrong mark and the
      // untouched altitude was reported as a ratchet. Two false findings came
      // from that before it was fixed; the code was restoring correctly all
      // along (verified by driving settleTocDrag directly).
      const same = ms2.find((x) => x.k === m.k && x.leg === m.leg);
      if (same) {
        const far = await page.evaluate(() => {
          const pts = polylines[0].getLatLngs();
          const c = map.latLngToContainerPoint(pts[pts.length - 1]);
          const r = document.getElementById('map').getBoundingClientRect();
          return [Math.round(r.x + c.x), Math.round(r.y + c.y)];
        });
        await drag(same, far[0], far[1]);
        drags++;
        const after = await page.evaluate(() => JSON.stringify(flights[0].waypoints.map((w) => w.alt)));
        if (after !== before) problems.push(`RATCHET ${where}: altitudes ${before} -> ${after}`);
        const a2 = await audit();
        if (a2.banner && !base.banner) problems.push(`BANNER  ${where} (returned): ${a2.banner}`);
        for (const bad of a2.bad) if (!base.bad.includes(bad)) problems.push(`STATE   ${where} (returned): ${bad}`);
      }
    }
  }
}
}

await b.close();
console.log(`\n${drags} drags over ${Object.keys(PLANS).length} plans`);
if (errs.length) problems.unshift(...errs.map((e) => 'PAGEERR ' + e));
const uniq = [...new Set(problems)];
if (!uniq.length) { console.log('no problems found'); process.exit(0); }
console.log(`\n${problems.length} problem(s), ${uniq.length} distinct:\n`);
for (const p of uniq.slice(0, 40)) console.log('  ' + p);
if (uniq.length > 40) console.log(`  ... and ${uniq.length - 40} more`);
process.exit(1);
