#!/usr/bin/env node
/**
 * The layout and the keyboard page on a real screen, measured
 * - `npm run verify:layout` (v16.49, extended v16.52).
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

// ---- THE KEYBOARD PAGE (v16.52, roadmap 10) -----------------------------
// jsdom cannot prove the two things that matter here: that a 30-row list is
// actually ON SCREEN with real boxes, and that pressing Ctrl+S to BIND it does
// not also fire Ctrl+S. The second is why the capture listener runs in the
// capture phase and stops the event dead.
{
  const ctx = await b.newContext({ viewport: { width: 1400, height: 950 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push('keys: ' + e));
  await page.route('**://**/**', (r) => r.request().url().startsWith('file:') ? r.continue() : r.abort());
  await page.goto('file://' + APP, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    closeHelpModal();
    flights = [{ id: 1, title: 'F', depElev: 254, waypoints: [
      { lat: 69.05505349, lng: 18.54466865, name: 'ENDU', alt: 254, oat: 10, wdir: 0, wspd: 0, var: -11 },
      { lat: 69.67895054, lng: 18.91143033, name: 'ENTC', alt: 2500, oat: 10, wdir: 0, wspd: 0, var: -12 }]}];
    refreshMap(); renderAllFlightTables();
    // count the real save dialog, so "did binding it also fire it?" is measurable
    window.__saveOpened = 0;
    const orig = window.saveCurrentMission;
    window.saveCurrentMission = function () { window.__saveOpened++; return orig.apply(this, arguments); };
    openSettingsModal(); showSettingsPage('keys');
  });
  await page.waitForTimeout(250);

  const list = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#keybind-list .keybind-row')];
    return { n: rows.length,
             sized: rows.filter((r) => { const b = r.getBoundingClientRect();
                                         return b.width > 0 && b.height > 0; }).length };
  });
  check(list.n >= 25, `the keyboard page lists every action: ${list.n} rows`);
  check(list.sized === list.n, `every row has a real box on screen: ${list.sized}/${list.n}`);

  // THE CONTROLS ARE CLICKED, NOT CALLED. v16.52 shipped a list whose buttons
  // were inert - a JSON.stringify'd id closed the onclick attribute - and it
  // got through because this file and the jsdom tests both drove the functions
  // instead of the controls. A real mouse click is the only thing that proves
  // a control is wired up.
  const chordBox = (id) => page.locator(`.keybind-row[data-action="${id}"] .keybind-chord`);
  const sideBtn = (id) => page.locator(`.keybind-row[data-action="${id}"] .keybind-actions button`);

  await chordBox('print').click();
  await page.waitForTimeout(120);
  check(await page.evaluate(() => keybindCapturing === 'print'),
    'CLICKING the chord box starts a capture');
  check((await sideBtn('print').textContent()).trim() === 'Cancel',
    'Clear becomes Cancel while capturing');

  // BINDING Ctrl+S MUST NOT ALSO SAVE.
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(200);
  const afterCtrlS = await page.evaluate(() => ({
    saves: window.__saveOpened, capturing: keybindCapturing, print: keybinds['print'],
    note: document.getElementById('keybind-capture-note').textContent }));
  check(afterCtrlS.saves === 0, `capturing Ctrl+S did not also save (${afterCtrlS.saves} dialogs)`);
  check(afterCtrlS.print === null && /already/.test(afterCtrlS.note),
    'the clash with Save was refused and explained');
  check(afterCtrlS.capturing === 'print', 'a refused chord leaves capture open to try again');

  await page.keyboard.press('Alt+p');
  await page.waitForTimeout(150);
  check(await page.evaluate(() => keybinds['print'] === 'Alt+P' && keybindCapturing === null),
    'a free chord is accepted and ends the capture');
  check((await chordBox('print').textContent()).trim() === 'Alt+P', 'the row shows the new chord');

  // CLICKING CLEAR really unbinds.
  await sideBtn('print').click();
  await page.waitForTimeout(120);
  check(await page.evaluate(() => keybinds['print'] === null), 'CLICKING Clear unbinds the action');
  check(await sideBtn('print').isDisabled(), 'Clear disables itself once there is nothing to clear');

  // A REBOUND KEY FIRES AND THE OLD ONE GOES QUIET - measured on real presses.
  await chordBox('undo').click();
  await page.keyboard.press('Alt+u');
  await page.waitForTimeout(120);
  await page.evaluate(() => closeSettingsModal());
  await page.waitForTimeout(120);
  await page.evaluate(() => {
    pushUndoState('test'); flights[0].waypoints[1].name = 'CHANGED'; renderAllFlightTables();
  });
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(150);
  const afterOld = await page.evaluate(() => flights[0].waypoints[1].name);
  await page.keyboard.press('Alt+u');
  await page.waitForTimeout(150);
  const afterNew = await page.evaluate(() => flights[0].waypoints[1].name);
  check(afterOld === 'CHANGED', `the old chord went quiet after rebinding (got "${afterOld}")`);
  check(afterNew === 'ENTC', `the new chord undoes (got "${afterNew}")`);
  await ctx.close();
}

check(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs[0] : ''));

// THE MAP SETTINGS PAGE IS NOT A WALL OF PROSE (v16.62, the pilot's request).
// Every help block starts COLLAPSED behind a one-line summary; the reasoning is
// one click away and still there, because a slider with mystery ends is exactly
// what those paragraphs exist to prevent. Measured, not grepped: a <details>
// that is open by default would pass a source check and fail the request.
{
  const ctx = await b.newContext({ viewport: { width: 1400, height: 950 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push('help: ' + e));
  await page.route('**://**/**', (r) => r.request().url().startsWith('file:') ? r.continue() : r.abort());
  await page.goto('file://' + APP, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  await page.evaluate(() => { try { closeHelpModal(); } catch (e) {} });
  await page.evaluate(() => { openSettingsModal(); showSettingsPage('map'); });
  await page.waitForTimeout(300);
  const help = await page.evaluate(() => {
    const out = [];
    for (const d of document.querySelectorAll('#settings-page-map .setting-help')) {
      const sum = d.querySelector('summary');
      const body = d.querySelector('div');
      // MEASURE THE <details> BOX, not the inner div. A closed details hides its
      // content with content-visibility, and a descendant's rect under that is
      // not a reliable zero - the first attempt read 15/45/60/225 px for four
      // blocks that were all correctly closed. What matters for "the page is
      // not a wall of prose" is how much page the block OCCUPIES anyway.
      out.push({ open: d.open, summary: (sum && sum.textContent || '').trim(),
                 h: Math.round(d.getBoundingClientRect().height),
                 hasBody: !!body });
    }
    return out;
  });
  check(help.length >= 4, `the Map page has collapsible help (${help.length} blocks)`);
  check(help.every((h) => !h.open), 'every help block starts collapsed');
  check(help.every((h) => h.hasBody), 'every summary has a body to expand');
  check(help.every((h) => h.h <= 26),
    'a collapsed block is one line: ' + JSON.stringify(help.map((h) => h.h)));
  check(help.some((h) => /ring around the track/i.test(h.summary)),
    'the corridor summary says what it does: ' + JSON.stringify(help.map((h) => h.summary)));
  // ...and it really opens.
  const opened = await page.evaluate(async () => {
    const d = document.querySelector('#settings-page-map .setting-help');
    const before = Math.round(d.getBoundingClientRect().height);
    d.querySelector('summary').click();
    await new Promise((r) => setTimeout(r, 150));
    return { open: d.open, before, after: Math.round(d.getBoundingClientRect().height) };
  });
  check(opened.open && opened.after > opened.before * 2,
    `clicking the summary expands it (${opened.before} -> ${opened.after} px)`);

  // THE PATH SETTING CHANGES WHAT IS DRAWN (v16.63). jsdom has no projection,
  // so only a real browser can show that the great-circle line actually bows
  // away from the straight Mercator segment the rhumb draws.
  const paths = await page.evaluate(async () => {
    closeSettingsModal();
    flights = [{ id: 1, title: 'P', depElev: 0, waypoints: [
      { lat: 69.67895, lng: 18.91143, name: 'ENTC', alt: 5000, oat: 5, wdir: 0, wspd: 0, var: -11 },
      { lat: 69.72578, lng: 29.89135, name: 'ENKR', alt: 5000, oat: 5, wdir: 0, wspd: 0, var: -11 }] }];
    activeFlightIndex = 0;
    map.setView([69.9, 24.4], 7, { animate: false });
    const read = async (mode) => {
      aircraftProfile.navPath = mode;
      setNavPath(mode);
      refreshMap(); renderAllFlightTables();
      await new Promise((r) => setTimeout(r, 350));
      const pts = polylines[0].getLatLngs();
      const a = map.latLngToContainerPoint(pts[0]);
      const z = map.latLngToContainerPoint(pts[pts.length - 1]);
      // how far the drawn line bows off the straight screen chord
      let bow = 0;
      for (const ll of pts) {
        const p = map.latLngToContainerPoint(ll);
        const t = ((p.x - a.x) * (z.x - a.x) + (p.y - a.y) * (z.y - a.y)) /
                  ((z.x - a.x) ** 2 + (z.y - a.y) ** 2);
        bow = Math.max(bow, Math.hypot(p.x - (a.x + (z.x - a.x) * t), p.y - (a.y + (z.y - a.y) * t)));
      }
      const row = document.querySelector('#flight-tables tbody tr');
      return { pts: pts.length, bowPx: Math.round(bow),
               text: row ? row.textContent.replace(/\s+/g, ' ').slice(0, 120) : '' };
    };
    const gc = await read('gc');
    const rh = await read('rhumb');
    aircraftProfile.navPath = 'gc'; setNavPath('gc'); refreshMap();
    return { gc, rh };
  });
  check(paths.rh.bowPx <= 1,
    `a rhumb line is drawn dead straight on screen (${paths.rh.bowPx} px of bow)`);
  check(paths.gc.bowPx > 4,
    `a great circle is drawn bowed away from it (${paths.gc.bowPx} px of bow)`);
  // BOTH modes are densified - one code path, deliberately - so the point count
  // is the SAME and it is where the points LIE that differs. Asserting a bigger
  // count for the great circle would be asserting an implementation this
  // module does not have.
  check(paths.gc.pts === paths.rh.pts && paths.gc.pts > 2,
    `both paths are drawn from the same densified helper (${paths.gc.pts} points each)`);
  await ctx.close();
}

// THE PANEL DIVIDER (v16.67). CSS variables with fallbacks, pointer capture and
// a percentage height that has to resolve against a flex item are three things
// a grep cannot check. This drags the real bar with the real mouse and reads
// the boxes back, which is the only way to know the pilot got the panel they
// pulled to.
{
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push('splitter: ' + e));
  await page.route('**://**/**', (r) => r.request().url().startsWith('file:') ? r.continue() : r.abort());
  await page.goto('file://' + APP, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  await page.evaluate(() => { try { closeHelpModal(); } catch (e) {} setLayoutMode('split'); });
  await page.waitForTimeout(250);

  const boxes = () => page.evaluate(() => {
    const r = (id) => { const el = document.getElementById(id); const q = el.getBoundingClientRect();
      return { x: q.x, y: q.y, w: q.width, h: q.height, shown: q.width > 0 && q.height > 0 }; };
    return { map: r('map-container'), bar: r('splitter'), side: r('sidebar'),
             flex: document.body.style.getPropertyValue('--map-flex'),
             mapH: document.body.style.getPropertyValue('--map-h'),
             stored: JSON.parse(localStorage.getItem('c182_perf_profile') || '{}') };
  });

  // AN UNTOUCHED APP WRITES NOTHING. The stylesheet's fallbacks are the shipped
  // design, so verify:visual can still compare an undragged build byte for byte.
  const before = await boxes();
  check(before.flex === '' && before.mapH === '',
    'an undragged app sets no pane variables at all');
  check(before.bar.shown && before.bar.w > 0 && before.bar.w < 12,
    `the divider is a thin bar between the panels (${Math.round(before.bar.w)} px wide)`);
  check(before.bar.x > before.map.x && before.side.x > before.bar.x,
    'the divider sits between the map and the plan');

  // Drag it 260 px to the right: the map gains, the plan loses, and the BAR
  // ends up under the cursor rather than trailing it by its own width.
  const target = Math.round(before.bar.x + before.bar.w / 2) + 260;
  await page.mouse.move(before.bar.x + before.bar.w / 2, 500);
  await page.mouse.down();
  await page.mouse.move(target, 500, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const after = await boxes();
  const centre = after.bar.x + after.bar.w / 2;
  check(Math.abs(centre - target) <= 4,
    `the bar lands under the cursor (asked ${target}, got ${Math.round(centre)})`);
  check(after.map.w > before.map.w + 200 && after.side.w < before.side.w - 200,
    `the map gained what the plan lost (${Math.round(before.map.w)} -> ${Math.round(after.map.w)} px)`);
  check(after.flex !== '' && Number(after.stored.splitRatio) > 0,
    `the split is remembered (${after.stored.splitRatio})`);

  // A RELOAD PUTS IT BACK. It travels in the profile, so it survives the app
  // being closed - which is the whole reason it is a setting and not a session.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  await page.evaluate(() => { try { closeHelpModal(); } catch (e) {} setLayoutMode('split'); });
  await page.waitForTimeout(250);
  const reloaded = await boxes();
  check(Math.abs(reloaded.map.w - after.map.w) <= 3,
    `the divider is where it was left after a reload (${Math.round(reloaded.map.w)} px)`);

  // Double-click resets by CLEARING the stored figure, so the stylesheet is
  // once again the only place the default lives.
  await page.dblclick('#splitter');
  await page.waitForTimeout(250);
  const reset = await boxes();
  check(reset.flex === '' && (reset.stored.splitRatio === null || reset.stored.splitRatio === undefined),
    'double-click clears the stored split rather than writing a default');
  check(Math.abs(reset.map.w - before.map.w) <= 2,
    `and the panels are back to the shipped proportions (${Math.round(reset.map.w)} px)`);

  // ARROW KEYS. role="separator" with a tab stop promises they work.
  await page.focus('#splitter');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(200);
  const nudged = await boxes();
  check(nudged.map.w > reset.map.w + 20,
    `arrow keys nudge the divider (${Math.round(reset.map.w)} -> ${Math.round(nudged.map.w)} px)`);
  await page.keyboard.press('Home');
  await page.waitForTimeout(200);
  check(Math.abs((await boxes()).map.w - reset.map.w) <= 2, 'Home puts it back');

  // STACKED IS THE OTHER AXIS, and it is where the risky bit is: the map's
  // height is a PERCENTAGE of #main, which only resolves because #main's own
  // height is definite. Measure it rather than trust it.
  await page.evaluate(() => setLayoutMode('stacked'));
  await page.waitForTimeout(300);
  const s0 = await boxes();
  check(s0.bar.h > 0 && s0.bar.h < 12 && s0.bar.y > s0.map.y,
    'stacked puts the divider under the map');
  const targetY = Math.round(s0.bar.y + s0.bar.h / 2) + 180;
  await page.mouse.move(750, s0.bar.y + s0.bar.h / 2);
  await page.mouse.down();
  await page.mouse.move(750, targetY, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const s1 = await boxes();
  check(Math.abs((s1.bar.y + s1.bar.h / 2) - targetY) <= 4,
    `the stacked bar lands under the cursor (asked ${targetY}, got ${Math.round(s1.bar.y + s1.bar.h / 2)})`);
  check(s1.map.h > s0.map.h + 140,
    `the map grew downwards (${Math.round(s0.map.h)} -> ${Math.round(s1.map.h)} px)`);
  check(/%$/.test(s1.mapH) && Number(s1.stored.stackRatio) > 0,
    `the stacked ratio is stored separately from the split one (${s1.stored.stackRatio}, split ${s1.stored.splitRatio})`);

  // THE 240 px FLOOR IS FOR THE AUTOMATIC LAYOUT, NOT FOR THE PILOT. Drag the
  // map well under it: a floor that silently won would pull the divider back
  // with nothing said, which is the failure this project refuses.
  await page.mouse.move(750, s1.bar.y + s1.bar.h / 2);
  await page.mouse.down();
  await page.mouse.move(750, 200, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const s2 = await boxes();
  check(s2.map.h < 200,
    `a hand-placed divider beats the 240 px auto floor (${Math.round(s2.map.h)} px)`);

  // ONE PANEL, NO DIVIDER. Plan-only and Map-only hide one of them, and the
  // Menu skin collapses the plan to a hover rail.
  const hidden = await page.evaluate(async () => {
    const out = {};
    const seen = (mode, skin) => {
      const el = document.getElementById('splitter');
      return { mode, skin, shown: el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0 };
    };
    setLayoutMode('plan'); out.plan = seen('plan').shown;
    setLayoutMode('map'); out.map = seen('map').shown;
    setLayoutMode('split'); applySkin('menu'); out.menu = seen('split', 'menu').shown;
    applySkin('default'); out.back = seen('split', 'default').shown;
    return out;
  });
  check(!hidden.plan && !hidden.map, 'no divider when only one panel is on screen');
  check(!hidden.menu, 'no divider under the Menu skin, whose plan is a hover rail');
  check(hidden.back, 'and it comes back with the default skin');
  await ctx.close();
}

await b.close();
console.log(fails.length ? `\n${fails.length} layout check(s) FAILED` : '\nall layout checks passed');
process.exit(fails.length ? 1 : 0);
