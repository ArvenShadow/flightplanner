/**
 * The company OFP form, MEASURED in a real browser (v16.41).
 *
 * jsdom has no layout, so it cannot tell whether a value fits its cell - and
 * "make sure the text is sized properly to fit into the cells" is the whole
 * requirement. This drives Chromium with print media emulated and measures
 * every cell of a deliberately worst-case plan: long fix names, three-digit
 * tracks, two-digit fuel figures and a route long enough to spill onto a
 * second sheet.
 *
 * Run: node tools/verify-ofp-print.mjs   (CHROME_PATH=... to pick the browser)
 */
let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.error('playwright is not installed'); process.exit(2); }

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

// A WORST CASE, not a happy path: 19 legs (so it spills to a second sheet),
// the longest published reporting-point names, strong winds and a westerly
// track so VAR, WCA and the three-digit fields are all at full width.
//
// THE LEGS ARE LONG ON PURPOSE. The ACC columns accumulate over the whole
// MISSION, so the accumulated distance is the one figure with no bound short
// of the flight itself, and a three-digit fixture would never have measured
// the cell that now has to hold four. The longitude zigzag is what does it:
// about 64 NM a leg at this latitude, so the sheet carries ACC Dist past
// 1000 NM. A check below fails if it ever stops reaching four digits.
await page.evaluate(() => {
  const names = ['ENDU', 'KVALØYSLETTA', 'FINNSNES', 'SØRKJOSEN', 'BARDUFOSS', 'MALANGEN',
    'LYNGSEIDET', 'SKIBOTN', 'OTEREN', 'NORDKJOSBOTN', 'TAMOKDALEN', 'ØVERGÅRD',
    'SETERMOEN', 'SALANGEN', 'GRATANGEN', 'BJERKVIK', 'NARVIK', 'BALLANGEN',
    'EVENESMARKA', 'ENEV'];
  const wps = names.map((n, i) => ({
    lat: 68.5 + i * 0.09, lng: 17.0 + (i % 2 ? 1.5 : -1.5), name: n,
    alt: i === 0 ? 254 : 500 + i * 450, oat: -12, wdir: 285, wspd: 45, var: -11.6
  }));
  flights = [{ id: 1, title: 'Worst case', depElev: 254, waypoints: wps }];
  activeFlightIndex = 0;
  const fd = document.getElementById('fuel-dep'); if (fd) fd.value = '88';
  renderAllFlightTables();
});
await page.waitForTimeout(500);
await page.emulateMedia({ media: 'print' });
await page.waitForTimeout(400);

const built = await page.evaluate(() => ({
  sheets: document.querySelectorAll('#ofp-print .ofp-sheet').length,
  visible: getComputedStyle(document.getElementById('ofp-print')).display,
  // Whether the app RENDERS, not what its own display says: the print rule
  // hides body's children, so a nested element keeps its own computed display
  // while painting nothing. A zero box is the honest test.
  appBox: (() => { const r = document.getElementById('sidebar').getBoundingClientRect();
                   return Math.round(r.width) + 'x' + Math.round(r.height); })(),
  strayInk: [...document.body.children]
    .filter((el) => el.id !== 'ofp-print' && el.getBoundingClientRect().height > 0)
    .map((el) => el.id || el.className || el.tagName)
}));
check(built.sheets === 2, 'a 19-leg plan makes two sheets: ' + built.sheets);
check(built.visible !== 'none', 'the form is shown when printing');
check(built.appBox === '0x0', 'the app itself is not painted: #sidebar box is ' + built.appBox);
// The first-run guide once printed ON TOP of the form, with its backdrop
// tinting the whole sheet, because the print rule listed what to hide instead
// of hiding everything. Nothing but the form may put ink on the page.
check(built.strayInk.length === 0,
  'nothing but the form is printed' + (built.strayInk.length ? ': ' + built.strayInk.join(', ') : ''));

const grid = await page.evaluate(() => {
  const s = document.querySelector('#ofp-print .ofp-sheet');
  const heads = [...s.querySelectorAll('.ofp-grid thead tr')][1].children;
  return { cols: heads.length, labels: [...heads].slice(0, 5).map((h) => h.textContent),
           bodyRows: s.querySelectorAll('.ofp-grid tbody tr').length };
});
check(grid.cols === 25, 'the grid has the form\'s 25 columns: ' + grid.cols);
check(grid.bodyRows === 16, 'the form\'s 16 numbered lines are drawn: ' + grid.bodyRows);
check(JSON.stringify(grid.labels) === JSON.stringify(['From', 'TAS', 'TT', 'VAR', 'MT']),
  'the columns are in form order: ' + JSON.stringify(grid.labels));

// The fixture has to REACH the widths it claims to test, or the cell check
// below passes for the wrong reason.
const widest = await page.evaluate(() => {
  let acc = 0;
  for (const tr of document.querySelectorAll('#ofp-print .ofp-grid tbody tr')) {
    const td = tr.children[7];               // ACC Dist
    const v = td ? Number(td.textContent.trim()) : NaN;
    if (Number.isFinite(v)) acc = Math.max(acc, v);
  }
  return acc;
});
check(widest >= 1000,
  'the worst case drives ACC Dist to four digits: ' + widest.toFixed(1) + ' NM');

// ---- DOES THE TEXT FIT? ---------------------------------------------------
// scrollWidth > clientWidth means the value is being clipped by the cell.
const fit = await page.evaluate(() => {
  const bad = [];
  let filled = 0;
  for (const td of document.querySelectorAll('#ofp-print .ofp-grid td')) {
    const t = td.textContent.trim();
    if (!t) continue;
    filled++;
    if (td.scrollWidth > td.clientWidth + 1)
      bad.push({ t, w: td.clientWidth, need: td.scrollWidth,
                 col: td.cellIndex, row: td.parentElement.rowIndex });
  }
  return { bad, filled };
});
check(fit.filled > 250, 'the sheet is actually populated: ' + fit.filled + ' filled cells');
check(fit.bad.length === 0, fit.bad.length + ' cells overflow their box' +
  (fit.bad.length ? ': ' + fit.bad.slice(0, 6).map((b) => `"${b.t}" needs ${b.need} in ${b.w}px (col ${b.col})`).join(' | ') : ''));

// ...and the sheet must fit the PAGE, or the printer drops a column.
const size = await page.evaluate(() => {
  const s = document.querySelector('#ofp-print .ofp-sheet');
  const g = s.querySelector('.ofp-grid');
  return { sheetW: s.scrollWidth, hostW: document.getElementById('ofp-print').clientWidth,
           gridW: g.scrollWidth, gridBox: g.clientWidth,
           sheetH: s.getBoundingClientRect().height };
});
check(size.gridW <= size.gridBox + 1, 'the grid fits its page width: ' + size.gridW + ' in ' + size.gridBox);
check(size.sheetW <= size.hostW + 1, 'the sheet does not run off the page: ' + size.sheetW + ' in ' + size.hostW);

// The real proof that it paginates: render an actual PDF and count pages.
const pdf = await page.pdf({ format: 'A4', landscape: true, printBackground: true,
  margin: { top: '6mm', bottom: '6mm', left: '6mm', right: '6mm' } });
const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
check(pages === 2, 'the printed PDF is one page per sheet: ' + pages);
if (process.env.OUT) { const { writeFileSync } = await import('fs'); writeFileSync(process.env.OUT, pdf); }

// ---- SOLID BLACK ON WHITE -------------------------------------------------
// The first sheet printed GREY: the app's theme variables (--bg-calc #f7fafc,
// --text-main #2d3748) reach these cells through the global table styles, so
// the boxes were pale blue-grey and the text dark slate instead of ink. Measure
// the computed colours rather than trusting the stylesheet.
const ink = await page.evaluate(() => {
  const bad = [];
  const cells = [...document.querySelectorAll('#ofp-print .ofp-grid td, #ofp-print .ofp-grid th, #ofp-print .ofp-admin td, #ofp-print .ofp-depdest td')];
  for (const el of cells) {
    const cs = getComputedStyle(el);
    if (cs.color !== 'rgb(0, 0, 0)') { bad.push('text ' + cs.color); continue; }
    // The Total line's hatch is a gradient and is allowed; a flat grey is not.
    const bg = cs.backgroundColor;
    if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'rgb(255, 255, 255)') bad.push('fill ' + bg);
    if (!/rgb\(0, 0, 0\)/.test(cs.borderTopColor)) bad.push('rule ' + cs.borderTopColor);
  }
  return { checked: cells.length, bad: [...new Set(bad)] };
});
check(ink.checked > 400, 'enough cells were measured for ink: ' + ink.checked);
check(ink.bad.length === 0, 'every rule and every character is solid black on white' +
  (ink.bad.length ? ', found: ' + ink.bad.slice(0, 5).join(', ') : ''));
// ...and the few deliberate fills must SURVIVE that. An id-level blanket rule
// out-ranks a class, which silently erased all three the first time.
const fills = await page.evaluate(() => ({
  hatch: getComputedStyle(document.querySelector('#ofp-print .ofp-total td.ofp-hatch')).backgroundImage,
  crew: getComputedStyle(document.querySelector('#ofp-print .ofp-crew th')).backgroundColor,
  note: getComputedStyle(document.querySelector('#ofp-print .ofp-note-box')).backgroundImage
}));
check(/gradient/.test(fills.hatch), 'the Total line keeps its hatching: ' + fills.hatch.slice(0, 30));
check(fills.crew === 'rgb(0, 0, 0)', 'the CREW bar keeps its black fill: ' + fills.crew);
check(/gradient/.test(fills.note), 'the ATIS/notes boxes keep their writing lines');

// ---- ONE SECTOR PER OFP ---------------------------------------------------
// A sheet must carry ONE departure and ONE arrival. Three sectors, the last
// long enough to need a continuation sheet, and every sheet is checked: its own
// aerodromes, its own fixes, and its own page.
await page.emulateMedia({ media: 'screen' });
await page.evaluate(() => {
  const wp = (lat, name, alt) => ({ lat, lng: 18.5, name, alt, oat: 0, wdir: 250, wspd: 20, var: -11 });
  flights = [
    { id: 1, title: 'A', depElev: 254, waypoints: [wp(68.5, 'ENDU', 254), wp(69.2, 'MID', 3500), wp(69.7, 'ENTC', 31)] },
    { id: 2, title: 'B', depElev: 31, waypoints: [wp(69.7, 'ENTC', 31), wp(70.2, 'SKJ', 4500), wp(70.6, 'ENSR', 10)] },
    { id: 3, title: 'C', depElev: 10, waypoints: Array.from({ length: 19 },
        (_, i) => wp(68.4 + i * 0.1, 'P' + i, i ? 800 + i * 300 : 10)) }
  ];
  activeFlightIndex = 0; renderAllFlightTables();
});
await page.waitForTimeout(400);
await page.emulateMedia({ media: 'print' });
await page.waitForTimeout(300);
const sectors = await page.evaluate(() => [...document.querySelectorAll('#ofp-print .ofp-sheet')].map((s) => {
  const td = s.querySelectorAll('.ofp-depdest td');
  return { dep: td[0].textContent.trim(), dest: td[3].textContent.trim(),
           depBoxes: s.querySelectorAll('.ofp-depdest tr').length,
           grid: s.querySelector('.ofp-grid').textContent,
           page: s.querySelector('.ofp-page') ? s.querySelector('.ofp-page').textContent.trim() : '' };
}));
check(sectors.length === 4, 'three sectors (one of them long) make four sheets: ' + sectors.length);
check(sectors.every((s) => s.depBoxes === 2),
  'every sheet carries exactly one DEP row and one DEST row');
check(sectors[0].dep === 'ENDU' && sectors[0].dest === 'ENTC' &&
      sectors[1].dep === 'ENTC' && sectors[1].dest === 'ENSR',
  'each sector kept its own aerodromes: ' + sectors.slice(0, 2).map((s) => s.dep + '->' + s.dest).join(', '));
check(sectors[2].dep === sectors[3].dep && sectors[2].dest === sectors[3].dest &&
      /sheet 1 of 2/.test(sectors[2].page) && /sheet 2 of 2/.test(sectors[3].page),
  'a sector too long for one sheet continues under the SAME aerodromes: ' +
  sectors.slice(2).map((s) => s.dep + '->' + s.dest + ' ' + s.page).join(', '));
check(!/SKJ|ENSR/.test(sectors[0].grid) && !/\bMID\b/.test(sectors[1].grid),
  'no sheet shows another sector\'s fixes');
const pdf3 = await page.pdf({ format: 'A4', landscape: true, printBackground: true,
  margin: { top: '6mm', bottom: '6mm', left: '6mm', right: '6mm' } });
const pages3 = (pdf3.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
check(pages3 === 4, 'each sheet gets its own printed page: ' + pages3);

// ---- A BROKEN PLAN MUST SAY SO ON THE PAPER (v16.43) ----------------------
// The print rule hides the whole page and shows only the form, so the red
// banner never reached print: a plan the app had declared DO NOT USE printed as
// clean company paperwork. Measure that the band is really painted, not just
// present in the markup.
await page.emulateMedia({ media: 'screen' });
await page.evaluate(() => {
  flights[0].waypoints[1].alt = 26000;   // above the POH ceiling
  renderAllFlightTables();
});
await page.waitForTimeout(300);
await page.emulateMedia({ media: 'print' });
await page.waitForTimeout(300);
const voided = await page.evaluate(() => {
  const bands = [...document.querySelectorAll('#ofp-print .ofp-void')];
  const sheets = document.querySelectorAll('#ofp-print .ofp-sheet').length;
  const r = bands[0] && bands[0].getBoundingClientRect();
  return { n: bands.length, sheets, text: bands[0] ? bands[0].textContent : '',
           h: r ? Math.round(r.height) : 0, w: r ? Math.round(r.width) : 0,
           banner: !!document.getElementById('integrity-banner').innerHTML };
});
check(voided.banner, 'the plan is genuinely broken (the banner fired)');
check(voided.n === voided.sheets && voided.n > 0,
  'one DO NOT USE band per sheet: ' + voided.n + ' bands for ' + voided.sheets + ' sheets');
check(/INTEGRITY CHECK FAILED/.test(voided.text), 'the band names itself: ' + voided.text.slice(0, 60));
check(voided.h > 10 && voided.w > 200, 'the band has a real painted box: ' + voided.w + 'x' + voided.h);
const pdfBad = await page.pdf({ format: 'A4', landscape: true, printBackground: true,
  margin: { top: '6mm', bottom: '6mm', left: '6mm', right: '6mm' } });
check(pdfBad.length > 1000, 'the broken plan still renders a PDF (' + pdfBad.length + ' bytes)');

// THE M&B SIDE EXISTS SINCE v16.95, so this check's OLD premise ("left out,
// not half-built") has expired and is replaced DELIBERATELY rather than left
// to pass for the wrong reason - the v16.56 lesson. What it guards now is the
// rule that makes it safe for a pilot who does not use M&B: the page prints
// only once a REGISTRATION is chosen, and is absent until then. Both
// directions, because one of them alone is not a test of the condition.
const mbOff = await page.evaluate(() => document.getElementById('ofp-print').textContent);
check(!/MASS\s*&\s*BALANCE/i.test(mbOff),
  'with no registration chosen, no M&B page is printed');
const mbOn = await page.evaluate(() => {
  // @ts-ignore - page globals
  setMbReg('LN-TRA');
  const t = document.getElementById('ofp-print');
  return { text: t.textContent, sheets: t.querySelectorAll('.mb-sheet').length };
});
check(/MASS\s*&\s*BALANCE/i.test(mbOn.text),
  'choosing a registration prints the M&B page');
check(/LN-TRA/.test(mbOn.text), 'the M&B page names the aircraft it was computed for');
check(mbOn.sheets > 0, 'the M&B page is a real sheet: ' + mbOn.sheets);
// Page 1's Reg box was an empty cell for fifty versions, so a value there has
// never been measured against the box it prints in.
const regBox = await page.evaluate(() => {
  const ths = [...document.querySelectorAll('#ofp-print .ofp-sheet:not(.mb-sheet) th')]
    .filter((t) => /^Reg:?$/.test(t.textContent.trim()));
  return ths.map((t) => {
    const td = t.nextElementSibling;
    return { v: td.textContent.trim(), need: td.scrollWidth, w: td.clientWidth };
  });
});
check(regBox.length > 0 && regBox.every((r) => r.v === 'LN-TRA'),
  'every OFP sheet names the same tail the M&B page weighed: ' + JSON.stringify(regBox.map((r) => r.v)));
check(regBox.every((r) => r.need <= r.w + 1),
  'the registration fits its Reg box: ' + regBox.map((r) => r.need + ' in ' + r.w).join(', '));
// The plan on screen is still the BROKEN one, so the band rule (v16.43) has to
// reach page 2 as well - company paperwork must not print clean on either side.
const mbBands = await page.evaluate(() => {
  const sh = [...document.querySelectorAll('#ofp-print .mb-sheet')];
  return sh.every((s) => s.previousElementSibling &&
    s.previousElementSibling.classList.contains('ofp-void'));
});
check(mbBands, 'every M&B sheet of a broken plan carries the DO NOT USE band');

// AND THE REASON THIS VERIFIER EXISTS APPLIES TO PAGE 2 TOO: jsdom has no
// layout, so only a browser can say whether a value fits its printed cell.
// The M&B figures are bounded by the airframe rather than by the route - a
// weight is under four digits and a tenth, an arm under three, a moment under
// six - so any populated sheet exercises the widest cell the page can hold.
const mbFit = await page.evaluate(() => {
  const bad = [];
  let filled = 0;
  for (const td of document.querySelectorAll('#ofp-print .mb-sheet td')) {
    const t = td.textContent.trim();
    if (!t) continue;
    filled++;
    if (td.scrollWidth > td.clientWidth + 1)
      bad.push(`"${t}" needs ${td.scrollWidth} in ${td.clientWidth}px`);
  }
  const sh = document.querySelector('#ofp-print .mb-sheet');
  const host = document.getElementById('ofp-print');
  return { bad, filled, w: sh ? sh.scrollWidth : 0, hostW: host.clientWidth };
});
check(mbFit.filled > 20, 'the M&B sheet is actually populated: ' + mbFit.filled + ' filled cells');
check(mbFit.bad.length === 0, mbFit.bad.length + ' M&B cells overflow their box' +
  (mbFit.bad.length ? ': ' + mbFit.bad.slice(0, 6).join(' | ') : ''));
check(mbFit.w <= mbFit.hostW + 1,
  'the M&B sheet does not run off the page: ' + mbFit.w + ' in ' + mbFit.hostW);
const mbPdf = await page.pdf({ format: 'A4', landscape: true, printBackground: true,
  margin: { top: '6mm', bottom: '6mm', left: '6mm', right: '6mm' } });
check(mbPdf.length > 1000, 'the plan with an M&B page still renders a PDF (' + mbPdf.length + ' bytes)');
// THE WHOLE-MISSION SHEET HAS A ROW THE SECTOR SHEETS NEVER DO - the net fuel
// change at the stops - and its label is the longest on the page, so it has to
// be measured in the view that prints it. A full stop with a refuel is put on
// the first sector so there is a change to print.
const master = await page.evaluate(() => {
  // @ts-ignore - page globals
  const wps = flights[0].waypoints, last = wps[wps.length - 1];
  last.stop = 'full-stop'; last.stopMin = 10; last.fuelAfterGal = 80;
  // @ts-ignore - page globals
  setMbView('mission'); renderAllFlightTables();
  const sh = [...document.querySelectorAll('#ofp-print .mb-sheet')];
  const bad = [];
  let stopRow = null;
  for (const td of document.querySelectorAll('#ofp-print .mb-sheet td')) {
    if (/^Fuel change at stops/.test(td.textContent.trim())) stopRow = td.textContent.trim();
    if (td.textContent.trim() && td.scrollWidth > td.clientWidth + 1)
      bad.push(`"${td.textContent.trim()}" needs ${td.scrollWidth} in ${td.clientWidth}px`);
  }
  return { sheets: sh.length, stopRow, bad,
           w: sh[0] ? sh[0].scrollWidth : 0, hostW: document.getElementById('ofp-print').clientWidth };
});
check(master.sheets === 1, 'the whole-mission view prints ONE M&B sheet: ' + master.sheets);
check(!!master.stopRow, 'the refuel is on the printed master: ' + master.stopRow);
check(master.bad.length === 0, master.bad.length + ' whole-mission cells overflow' +
  (master.bad.length ? ': ' + master.bad.slice(0, 4).join(' | ') : ''));
check(master.w <= master.hostW + 1, 'the whole-mission sheet fits the page: ' + master.w + ' in ' + master.hostW);
await page.evaluate(() => {
  // @ts-ignore - page globals
  setMbView('sector');
  // @ts-ignore - page globals
  setMbReg('');
});

// THE DISTANCE TABLE (v16.96) HAS TO FIT ITS CELLS TOO, with real figures in
// them. The fixtures above do not start or end at an aerodrome, so every row
// there is a "not computed" sentence and no NUMBER column was ever measured.
// This one departs ENDU from the longest-named take-off position on the sheet
// and lands at ENTC, with every input typed so both rows compute.
const perf = await page.evaluate(() => {
  // @ts-ignore - page globals
  flights = [{ id: 91, title: 'PERF', depElev: 254, waypoints: [
    { lat: 69.05583, lng: 18.54, name: 'ENDU', alt: 254, oat: 10, wdir: 0, wspd: 0, var: -11 },
    { lat: 69.68306, lng: 18.91889, name: 'ENTC', alt: 2500, oat: 10, wdir: 0, wspd: 0, var: -12 }]}];
  // @ts-ignore
  activeFlightIndex = 0; mbPrefs.reg = 'LN-TRA'; mbPrefs.view = 'sector';
  // @ts-ignore
  perfInputs = { '91:dep': { end: '10@RWY SFC start 10', windDir: '290', windKt: '8', qnh: '1003', oat: '-7', braking: '4' },
                 '91:arr': { windDir: '180', windKt: '6', qnh: '1003', oat: '-7', braking: '5' } };
  // @ts-ignore
  refreshMap(); renderAllFlightTables();
  const cells = [...document.querySelectorAll('#ofp-print .mb-perf-print td')];
  const bad = cells.filter((td) => td.textContent.trim() && td.scrollWidth > td.clientWidth + 1)
    .map((td) => `"${td.textContent.trim()}" needs ${td.scrollWidth} in ${td.clientWidth}px`);
  const computed = [...document.querySelectorAll('#ofp-print .mb-perf-print td b')].map((b) => b.textContent);
  const text = document.querySelector('#ofp-print .mb-perf-print') ? document.querySelector('#ofp-print .mb-perf-print').textContent : '';
  return { n: cells.length, bad, computed, text };
});
check(perf.computed.length === 2, 'both ends of the sector print a computed distance: ' + JSON.stringify(perf.computed));
check(/RWY SFC start 10/.test(perf.text), 'the take-off position is named on the paper');
check(perf.bad.length === 0, perf.bad.length + ' distance cells overflow' + (perf.bad.length ? ': ' + perf.bad.slice(0, 4).join(' | ') : ''));

check(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs[0] : ''));
await b.close();
console.log(fails.length ? `\n${fails.length} check(s) FAILED` : '\nall OFP-print checks passed');
process.exit(fails.length ? 1 : 0);
