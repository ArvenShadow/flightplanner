#!/usr/bin/env node
/**
 * The layout on a real screen, measured - `npm run verify:layout` (v16.49).
 *
 * WHY THIS FILE EXISTS. The audit's QoL 4 is a MEASUREMENT, not an opinion: at
 * 1280x720 the map was 300 px tall and the daylight card's top sat at 826 px in
 * a 720 px window - below the fold, on the screen size a flight-school laptop
 * actually has. The layout auto-pick only ever looked at WIDTH, so a 13" laptop
 * already got the Stacked layout and Stacked then spent 42vh of a short window
 * on the map.
 *
 * A CSS media query is easy to write and easy to get wrong, and this project
 * has shipped invisible controls before (v16.22, two buttons at y=900 on a
 * 900 px viewport, with every grep passing). So the fix is asserted the same
 * way the finding was made: open the real page at the real size and read
 * getBoundingClientRect.
 *
 * Playwright is not a project dependency; install it when you need this:
 *   npm install --no-save playwright && npx playwright install chromium
 * (Set CHROME_PATH to use a browser already on the machine.)
 *
 * Runs OFFLINE: every non-file:// request is aborted.
 */
let chromium;
try { ({ chromium } = await import('playwright')); }
catch (e) { console.error('playwright is not installed - see the header of this file.'); process.exit(2); }

const APP = process.env.CURRENT || new URL('../site/index.html', import.meta.url).pathname;
const fails = [];
const check = (ok, msg) => { console.log((ok ? '  ok    ' : '  FAIL  ') + msg); if (!ok) fails.push(msg); };

const b = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const errs = [];

/** Open the app at one viewport and measure what a pilot can actually see. */
async function measure(width, height) {
  const ctx = await b.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(width + 'x' + height + ': ' + e));
  await page.route('**://**/**', (r) => r.request().url().startsWith('file:') ? r.continue() : r.abort());
  await page.goto('file://' + APP, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  await page.evaluate(() => { closeHelpModal(); });
  // A real plan, so the sidebar has the content a pilot is looking for.
  await page.evaluate(() => {
    flights = [{ id: 1, title: 'F1', depElev: 254, waypoints: [
      { lat: 69.05505349, lng: 18.54466865, name: 'ENDU', alt: 254, oat: 14, wdir: 0, wspd: 0, var: -11 },
      { lat: 69.23781330, lng: 17.97902780, name: 'FINNSNES', alt: 2500, oat: 10, wdir: 0, wspd: 0, var: -11 },
      { lat: 69.67895054, lng: 18.91143033, name: 'ENTC', alt: 2500, oat: 10, wdir: 0, wspd: 0, var: -12 }
    ] }];
    activeFlightIndex = 0;
    document.getElementById('def-etd').value = '10:00';
    refreshMap(); renderAllFlightTables();
  });
  await page.waitForTimeout(250);
  const m = await page.evaluate(() => {
    const r = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { top: Math.round(b.top), height: Math.round(b.height), width: Math.round(b.width) };
    };
    const card = document.getElementById('daylight-body');
    const sb = document.getElementById('sidebar');
    return {
      layout: document.body.className.match(/layout-\w+/)[0],
      header: r('#header'),
      map: r('#map-container'),
      sidebar: r('#sidebar'),
      // Where the card sits INSIDE the scrolling sidebar - that is what
      // "below the fold" means here, not its position in the document.
      cardOffsetInSidebar: card && sb
        ? Math.round(card.getBoundingClientRect().top - sb.getBoundingClientRect().top + sb.scrollTop)
        : null,
      sidebarVisible: sb ? Math.round(sb.getBoundingClientRect().height) : 0
    };
  });
  await ctx.close();
  return m;
}

// ---- 1280x720, the size the finding was made at -------------------------
const laptop = await measure(1280, 720);
console.log('  1280x720:', JSON.stringify(laptop));
check(laptop.layout === 'layout-stacked',
  `a 1280-wide window still picks Stacked (${laptop.layout})`);
check(laptop.map.height <= 260,
  `the map no longer eats the window: ${laptop.map.height} px tall (was ~302)`);
check(laptop.map.height >= 150,
  `...but it is still a usable map: ${laptop.map.height} px`);
check(laptop.cardOffsetInSidebar !== null && laptop.cardOffsetInSidebar < laptop.sidebarVisible,
  `the daylight card is within the first screenful of the sidebar: ` +
  `${laptop.cardOffsetInSidebar} px into ${laptop.sidebarVisible} px visible`);
check(laptop.header.height <= 80, `the header is compact: ${laptop.header.height} px`);

// ---- a full desktop must be UNCHANGED -----------------------------------
const desk = await measure(1600, 1000);
console.log('  1600x1000:', JSON.stringify(desk));
check(desk.layout === 'layout-split', `a wide, tall window still picks Split (${desk.layout})`);
check(desk.map.height > 700, `the desktop map is untouched: ${desk.map.height} px`);

// ---- a very short window degrades further, not worse --------------------
const short = await measure(1280, 600);
console.log('  1280x600:', JSON.stringify(short));
check(short.map.height <= laptop.map.height,
  `a shorter window gives the map no more room: ${short.map.height} vs ${laptop.map.height}`);
check(short.map.height >= 140, `...and the map does not vanish: ${short.map.height} px`);

// ---- THE MAP-ONLY VIEW MUST BE ABLE TO START A PLAN (roadmap 7) ----------
// This is the finding itself: `+ Add Flight Plan` lives inside #sidebar, and
// layout-map HIDES the sidebar, so the one view where you draw on the chart had
// no way to begin a plan. Asserted by measuring, not by grepping for the id -
// v16.22 shipped two controls that were present in the DOM and off screen.
{
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push('map-only: ' + e));
  await page.route('**://**/**', (r) => r.request().url().startsWith('file:') ? r.continue() : r.abort());
  await page.goto('file://' + APP, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  await page.evaluate(() => { closeHelpModal(); setLayoutMode('map', false); });
  await page.waitForTimeout(250);
  const seen = await page.evaluate(() => {
    const sb = document.getElementById('sidebar');
    const vis = (id) => {
      const el = document.getElementById(id);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height),
               x: Math.round(r.x), y: Math.round(r.y), text: el.textContent.trim() };
    };
    return {
      sidebarHidden: !sb || getComputedStyle(sb).display === 'none',
      add: vis('add-flight-btn'),
      active: vis('active-flight-btn')
    };
  });
  console.log('  map-only:', JSON.stringify(seen));
  check(seen.sidebarHidden, 'the map-only layout really does hide the sidebar');
  for (const [name, c] of [['New plan', seen.add], ['active-plan indicator', seen.active]]) {
    check(!!c && c.w > 0 && c.h > 0 && c.y >= 0 && c.y < 900 && c.x >= 0 && c.x < 1400,
      `${name} is on screen in the map-only view: ${c ? c.x + ',' + c.y + ' ' + c.w + 'x' + c.h : 'MISSING'}`);
  }
  check(!!seen.active && /\S/.test(seen.active.text), 'the indicator names a plan: ' +
    (seen.active ? JSON.stringify(seen.active.text) : 'MISSING'));
  // and it must actually work from here
  const added = await page.evaluate(() => {
    const before = flights.length;
    document.getElementById('add-flight-btn').click();
    return { before, after: flights.length };
  });
  check(added.after === added.before + 1,
    `the map-only New plan button starts a plan (${added.before} -> ${added.after})`);
  await ctx.close();
}

check(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs[0] : ''));

await b.close();
console.log(fails.length ? `\n${fails.length} layout check(s) FAILED` : '\nall layout checks passed');
process.exit(fails.length ? 1 : 0);
