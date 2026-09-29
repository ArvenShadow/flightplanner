#!/usr/bin/env node
/**
 * EVERY SKIN MUST KEEP THE WHOLE PLANNER USABLE - `npm run verify:skins`.
 *
 * A skin is CSS, so it cannot break the WIRING - that is the design, and it is
 * why skins are safe to experiment with. What CSS absolutely can do is push a
 * control off the screen, collapse it to nothing, or hide it behind something
 * else, and none of that shows up in a test that reads text.
 *
 * This project has shipped exactly that failure before: v16.22 and v16.23 put
 * two map buttons at y=900 on a 900 px viewport. A grep for the id passed. Only
 * measuring getBoundingClientRect in a real browser found them.
 *
 * So for EVERY skin, at two viewport sizes, this asserts:
 *   1. the same INVENTORY of interactive elements as the default - a look that
 *      loses a button is not a look, it is a bug;
 *   2. every control that is meant to be visible has a real box ON screen;
 *   3. nothing makes the page scroll sideways.
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

/** Everything a pilot can press, and where it is. */
const SURVEY = () => {
  const out = { controls: [], offscreen: [], zero: [], overflowX: 0 };
  const vw = window.innerWidth, vh = window.innerHeight;
  for (const el of document.querySelectorAll('button, select, input, a[href], [onclick]')) {
    // Skip anything deliberately hidden: a layout/skin may legitimately not
    // show a panel, and the modals are closed.
    if (el.closest('#ofp-print')) continue;
    const cs = getComputedStyle(el);
    const id = el.id || (el.name || el.textContent || el.tagName).trim().slice(0, 24);
    out.controls.push(id);
    if (cs.display === 'none' || cs.visibility === 'hidden' || !el.offsetParent && cs.position !== 'fixed') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) { out.zero.push(id); continue; }
    const onScreen = r.right > 0 && r.left < vw && r.bottom > 0 && r.top < vh;
    if (onScreen) continue;
    // BELOW THE FOLD IS NOT LOST. The sidebar is a designed scroll region - on
    // a 720 px window something must scroll, and CLAUDE.md says so (v16.49:
    // the daylight card is on screen, the METAR card below it is not). What
    // this check exists for is a control that is UNREACHABLE: clipped away by
    // an overflow:hidden ancestor, or positioned outside the scrollable area.
    let reachable = false;
    for (let a = el.parentElement; a; a = a.parentElement) {
      const acs = getComputedStyle(a);
      const scrolls = /auto|scroll/.test(acs.overflowY + acs.overflowX);
      if (!scrolls) {
        if (/hidden|clip/.test(acs.overflowY + acs.overflowX)) {
          const ar = a.getBoundingClientRect();
          if (r.bottom < ar.top || r.top > ar.bottom || r.right < ar.left || r.left > ar.right) break;
        }
        continue;
      }
      const ar = a.getBoundingClientRect();
      const top = r.top - ar.top + a.scrollTop;
      const left = r.left - ar.left + a.scrollLeft;
      if (top >= -1 && left >= -1 && top <= a.scrollHeight && left <= a.scrollWidth) reachable = true;
      break;
    }
    if (!reachable) out.offscreen.push(id);
  }
  out.overflowX = Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth);
  return out;
};

// READ FROM THE MODULE, never listed here. This was a hardcoded list of four
// until v17.2, so three new skins would have shipped with not one of these
// checks run against them - the same drift the WHERE TO EDIT WHAT guard had at
// v16.86, where a list of eleven modules sat under a directory of twenty.
const SKINS_MOD = await import(new URL('../src/lib/skins.js', import.meta.url).href);
const SKINS = SKINS_MOD.SKINS.map((s) => s.id);
// THE SIZE IS A SECOND AXIS (v17.3), so every style is checked at every size:
// Bold Float and Compact Chart are combinations nobody would otherwise look at.
const DENSITIES = SKINS_MOD.DENSITIES.map((d) => d.id);
check(DENSITIES.join() === 'normal,compact,bold', 'the sizes were read from src/lib/skins.js (' + DENSITIES.join(', ') + ')');
check(SKINS.length >= 5 && SKINS[0] === 'default', 'the skin list was read from src/lib/skins.js (' + SKINS.join(', ') + ')');
for (const [w, h] of [[1500, 950], [1280, 720]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.route('**://**/**', (r) => r.request().url().startsWith('file:') ? r.continue() : r.abort());
  await page.goto('file://' + APP, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    try { return typeof applySkin === 'function' && !!aircraftProfile; } catch (e) { return false; }
  }, null, { timeout: 20000 });
  await page.evaluate(() => { closeHelpModal(); });

  console.log(`\n### ${w}x${h}`);
  /** @type {string[]|null} */
  let baseline = null;
  for (const skinId of SKINS) for (const den of DENSITIES) {
    await page.evaluate(([s, d]) => { applySkin(s); applyDensity(d); }, [skinId, den]);
    await page.waitForTimeout(220);
    const r = await page.evaluate(SURVEY);
    if (skinId === 'default' && den === 'normal') baseline = r.controls;
    const skin = den === 'normal' ? skinId : skinId + '+' + den;
    // THE SET, NOT THE ORDER. A skin may MOVE a control into another panel
    // (v16.66), which legitimately changes its position in document order -
    // comparing the sequence called a correct skin broken. What must never
    // change is WHICH controls exist.
    const sorted = (a) => [...a].sort().join('\u0000');
    const lost = baseline.filter((c) => !r.controls.includes(c));
    check(sorted(r.controls) === sorted(baseline),
      `${skin.padEnd(14)} keeps every control the default has (${r.controls.length} of ${baseline.length})` +
      (lost.length ? ' - MISSING: ' + lost.slice(0, 4).join(', ') : ''));
    check(r.offscreen.length === 0,
      `${skin.padEnd(14)} puts no visible control off the screen${r.offscreen.length ? ': ' + r.offscreen.slice(0, 4).join(', ') : ''}`);
    check(r.zero.length === 0,
      `${skin.padEnd(14)} collapses no visible control to nothing${r.zero.length ? ': ' + r.zero.slice(0, 4).join(', ') : ''}`);
    check(r.overflowX === 0,
      `${skin.padEnd(14)} does not scroll sideways (${r.overflowX} px of overflow)`);
  }
  await page.evaluate(() => { applySkin('default'); applyDensity('normal'); });
  // THE LAYERING (v17.3), measured rather than read: SIZE rules sit after every
  // style so they win, and SHAPE rules sit before so a style keeps its own.
  // Put either half in the wrong place and the combination silently becomes
  // "the style, not bold" or "bold, not the style" - both look deliberate.
  const measure = await page.evaluate(async ([skins, dens]) => {
    const out = {};
    for (const k of skins) for (const d of dens) {
      applySkin(k); applyDensity(d);
      // `.btn` has `transition: 0.1s` on EVERY property, so a read straight
      // after the switch returns the PREVIOUS combination's padding and radius
      // mid-animation. The first run of this check reported Chart with Slate's
      // corners for exactly that reason.
      await new Promise((r) => setTimeout(r, 180));
      const btn = document.getElementById('print-btn');
      const cs = getComputedStyle(btn);
      out[k + '+' + d] = { h: btn.getBoundingClientRect().height, radius: cs.borderTopLeftRadius };
    }
    applySkin('default'); applyDensity('normal');
    return out;
  }, [SKINS, DENSITIES]);
  for (const k of SKINS) {
    const n = measure[k + '+normal'], bo = measure[k + '+bold'], c = measure[k + '+compact'];
    check(bo.h >= n.h + 6 && c.h < n.h,
      `${k.padEnd(8)} gets bigger in Bold and smaller in Compact (${c.h} < ${n.h} < ${bo.h} px)`);
    if (k === 'slate' || k === 'chart' || k === 'float') {
      check(bo.radius === n.radius && c.radius === n.radius,
        `${k.padEnd(8)} keeps its own corner shape at every size (${c.radius} / ${n.radius} / ${bo.radius})`);
    }
  }
  // ...and the skin really changed something, or the CSS never arrived.
  const boxes = {};
  for (const skin of ['default', 'menu']) {
    boxes[skin] = await page.evaluate((s) => {
      applySkin(s);
      const el = document.getElementById('sidebar');
      const r = el.getBoundingClientRect();
      return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
    }, skin);
    await page.waitForTimeout(150);
  }
  // MEASURE AREA, NOT WIDTH. Under the stacked layout #main is a COLUMN, so the
  // rail collapses the panel's HEIGHT rather than its width - checking one axis
  // reported a correct skin as broken at 1280x720.
  const area = (bx) => bx[2] * bx[3];
  check(area(boxes.menu) < area(boxes.default) / 2,
    `menu really collapses the plan panel (${boxes.default[2]}x${boxes.default[3]} -> ${boxes.menu[2]}x${boxes.menu[3]})`);
  // FLOAT (v17.2): the plan panel floats OVER the map in Split, so the map
  // must really take the whole width, and nothing the pilot needs on the map -
  // the control stack, the licence attribution - may sit under the panel.
  const fl = await page.evaluate(async () => {
    const was = [...document.body.classList].find((c) => c.startsWith('layout-'));
    setLayoutMode('split'); applySkin('float');
    await new Promise((r) => setTimeout(r, 250));
    const R = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
    const sb = R(document.getElementById('sidebar'));
    const map = R(document.getElementById('map-container'));
    const hit = (a) => !(a.r <= sb.l || a.l >= sb.r || a.b <= sb.t || a.t >= sb.b);
    const under = [...document.querySelectorAll('#map-controls > *, #map-container .leaflet-control-attribution')]
      .filter((el) => getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0)
      .filter((el) => hit(R(el))).map((el) => el.id || el.className);
    const splitter = getComputedStyle(document.getElementById('splitter')).display;
    const active = splitterActive();
    applySkin('default'); setLayoutMode(was ? was.slice(7) : 'split');
    return { sb, map, under, splitter, active, pos: getComputedStyle(document.getElementById('sidebar')).position };
  });
  check(fl.map.w >= w - 4, `float lets the map take the whole width in Split (${Math.round(fl.map.w)} of ${w})`);
  check(fl.sb.l > w * 0.3 && fl.sb.r <= w, `float puts the plan panel over the map (${Math.round(fl.sb.l)}-${Math.round(fl.sb.r)})`);
  check(fl.under.length === 0, 'float leaves no map control or the attribution under the panel' + (fl.under.length ? ': ' + fl.under.join(', ') : ''));
  check(fl.splitter === 'none' && fl.active === false, `float has no divider in Split (display ${fl.splitter}, active ${fl.active})`);

  // TIER 2: A MOVED CONTROL MUST STILL BE THE SAME CONTROL (v16.66).
  // appendChild moves the live node, so the handler comes with it - but that is
  // the sort of claim that has to be demonstrated by CLICKING, not asserted.
  const moved = await page.evaluate(async () => {
    // The app boots with an EMPTY plan, so the probe seeds its own route.
    flights = [{ id: 1, title: 'P', depElev: 254, waypoints: [
      { lat: 69.05, lng: 18.54, name: 'ENDU', alt: 254, oat: 5, wdir: 0, wspd: 0, var: -11 },
      { lat: 69.40, lng: 18.20, name: 'MID', alt: 3000, oat: 5, wdir: 0, wspd: 0, var: -11 }] }];
    activeFlightIndex = 0;
    refreshMap(); renderAllFlightTables();
    applySkin('default');
    await new Promise((r) => setTimeout(r, 150));
    // THE HOME PARENT HAS NO ID, so `parentElement.id || 'header-row'` compared
    // the same fallback on both sides and proved nothing. The index among its
    // siblings is what "exactly home" actually means.
    const spot = () => { const el = document.getElementById('undo-btn');
      const k = [...el.parentElement.children];
      return k.indexOf(el) + '/' + k.length + '@' + (el.parentElement.id || el.parentElement.className); };
    const homeParent = spot();
    applySkin('menu');
    await new Promise((r) => setTimeout(r, 200));
    const u = document.getElementById('undo-btn');
    const inSlot = u.parentElement.id;
    const r = u.getBoundingClientRect();
    // ...and it still undoes. Rename a waypoint, then press the moved button.
    flights[0].waypoints[1].name = 'MOVED-PROBE';
    renderAllFlightTables();
    pushUndoState('probe');
    flights[0].waypoints[1].name = 'CHANGED';
    renderAllFlightTables();
    u.click();
    await new Promise((r2) => setTimeout(r2, 200));
    const after = flights[0].waypoints[1].name;
    applySkin('default');
    await new Promise((r2) => setTimeout(r2, 200));
    return { homeParent, inSlot, box: [Math.round(r.width), Math.round(r.height)], after,
             backHome: spot() };
  });
  check(moved.inSlot === 'map-controls',
    `the Menu skin moves Undo onto the map (parent is now "${moved.inSlot}")`);
  check(moved.box[0] > 0 && moved.box[1] > 0,
    `the moved control is visible where it landed (${moved.box[0]}x${moved.box[1]})`);
  check(moved.after === 'MOVED-PROBE',
    `the moved control still WORKS - clicking it undid the edit (got "${moved.after}")`);
  check(moved.backHome === moved.homeParent,
    `leaving the skin puts it back where it came from ("${moved.backHome}")`);

  check(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs[0] : ''));
  await ctx.close();
}
await b.close();
console.log(fails.length ? `\n${fails.length} skin check(s) FAILED` : '\nall skin checks passed');
if (fails.length) process.exitCode = 1;
