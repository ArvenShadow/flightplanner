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

const SKINS = ['default', 'topbar', 'compact', 'bold', 'menu'];
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
  for (const skin of SKINS) {
    await page.evaluate((s) => { applySkin(s); }, skin);
    await page.waitForTimeout(220);
    const r = await page.evaluate(SURVEY);
    if (skin === 'default') baseline = r.controls;
    const sameInventory = JSON.stringify(r.controls) === JSON.stringify(baseline);
    check(sameInventory,
      `${skin.padEnd(8)} keeps every control the default has (${r.controls.length} of ${baseline.length})`);
    check(r.offscreen.length === 0,
      `${skin.padEnd(8)} puts no visible control off the screen${r.offscreen.length ? ': ' + r.offscreen.slice(0, 4).join(', ') : ''}`);
    check(r.zero.length === 0,
      `${skin.padEnd(8)} collapses no visible control to nothing${r.zero.length ? ': ' + r.zero.slice(0, 4).join(', ') : ''}`);
    check(r.overflowX === 0,
      `${skin.padEnd(8)} does not scroll sideways (${r.overflowX} px of overflow)`);
  }
  // ...and the skin really changed something, or the CSS never arrived.
  const boxes = {};
  for (const skin of ['default', 'topbar', 'menu']) {
    boxes[skin] = await page.evaluate((s) => {
      applySkin(s);
      const el = document.getElementById('sidebar');
      const r = el.getBoundingClientRect();
      return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
    }, skin);
    await page.waitForTimeout(150);
  }
  check(JSON.stringify(boxes.topbar) !== JSON.stringify(boxes.default),
    `topbar really moves the plan panel (${boxes.default} -> ${boxes.topbar})`);
  // MEASURE AREA, NOT WIDTH. Under the stacked layout #main is a COLUMN, so the
  // rail collapses the panel's HEIGHT rather than its width - checking one axis
  // reported a correct skin as broken at 1280x720.
  const area = (bx) => bx[2] * bx[3];
  check(area(boxes.menu) < area(boxes.default) / 2,
    `menu really collapses the plan panel (${boxes.default[2]}x${boxes.default[3]} -> ${boxes.menu[2]}x${boxes.menu[3]})`);
  check(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs[0] : ''));
  await ctx.close();
}
await b.close();
console.log(fails.length ? `\n${fails.length} skin check(s) FAILED` : '\nall skin checks passed');
if (fails.length) process.exitCode = 1;
