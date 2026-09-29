/**
 * The printed OFP, MEASURED in a real browser (v16.41; rewritten at v16.97).
 *
 * Since v16.97 the OFP is the school's own PDF (C182OFPMBv4.2.pdf) with the
 * figures written on, built by pdf-lib in the page. So what this checks is
 * the author's rule, literally - "The printed OFP HAS to be IDENTICAL to the
 * C182OFPMBv4.2.pdf" - by rendering pages with pdf.js and counting pixels:
 *
 *   1. a sheet with NOTHING written on it is pixel-identical to the form, on
 *      both pages - the form is embedded, not redrawn;
 *   2. on a deliberately worst-case plan, EVERY pixel that differs from the
 *      blank form lies inside a box the planner wrote into (or the CG chart
 *      marks, or the DO NOT USE band) - nothing strays across the ruling;
 *   3. nothing had to be shrunk below the smallest size to fit its box;
 *   4. the real "Print / preview OFP" button opens a new tab holding a PDF
 *      with one page per sheet, at the form's own size.
 *
 * jsdom cannot see pixels, and a PDF is nothing but pixels once printed.
 *
 * Run: node tools/verify-ofp-print.mjs   (CHROME_PATH=... to pick the browser)
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.error('playwright is not installed'); process.exit(2); }

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = process.env.CURRENT ? dirname(process.env.CURRENT) : join(ROOT, 'site');
const PDFJS = join(ROOT, 'node_modules', 'pdfjs-dist', 'legacy', 'build');
const fails = [];
const check = (ok, msg) => { console.log((ok ? '  ok    ' : '  FAIL  ') + msg); if (!ok) fails.push(msg); };

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.pdf': 'application/pdf', '.json': 'application/json', '.webp': 'image/webp' };
const b = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const ctx = await b.newContext({ viewport: { width: 1400, height: 950 } });
// The site, served from disk under an http origin - fetch() needs one, and the
// form is fetched. Anything else (tiles, weather) is refused: this is offline.
await ctx.route('**/*', (r) => {
  const u = new URL(r.request().url());
  if (u.hostname !== 'ofp.test') return r.abort();
  if (u.pathname.startsWith('/__pdfjs/')) {
    return r.fulfill({ contentType: 'text/javascript', body: readFileSync(join(PDFJS, u.pathname.slice(9))) });
  }
  const f = join(SITE, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname));
  if (!existsSync(f)) return r.fulfill({ status: 404, body: '' });
  return r.fulfill({ contentType: TYPES[extname(f)] || 'application/octet-stream', body: readFileSync(f) });
});
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto('http://ofp.test/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => { try { return typeof renderAllFlightTables === 'function' && Array.isArray(flights); } catch (e) { return false; } });

// A WORST CASE, not a happy path: 19 legs (so it spills to a second sheet),
// the longest published reporting-point names, strong winds and a westerly
// track so VAR, WCA and the three-digit fields are all at full width. The
// longitude zigzag is ~64 NM a leg, so ACC Dist reaches FOUR digits - the one
// figure with no bound short of the flight itself.
// The aircraft is LN-TRE and both ends have a METAR, so page 2 is filled all
// the way down: M&B, fuel, speeds, cruise, both aerodrome blocks and both
// distance blocks. Since v16.98 the ENDU METAR carries a TEMPO wind (its note
// in the take-off block) and an actual fuel is typed, so the Last Minute
// Change line and the top-margin note strip are written too - that strip is
// free paper, and only the stray-pixel check below proves it stayed free.
await page.evaluate(() => {
  // The first-run Feature Guide opens over everything on a fresh browser.
  try { closeHelpModal(); } catch (e) { /* not open */ }
  const names = ['ENDU', 'KVALØYSLETTA', 'FINNSNES', 'SØRKJOSEN', 'BARDUFOSS', 'MALANGEN',
    'LYNGSEIDET', 'SKIBOTN', 'OTEREN', 'NORDKJOSBOTN', 'TAMOKDALEN', 'ØVERGÅRD',
    'SETERMOEN', 'SALANGEN', 'GRATANGEN', 'BJERKVIK', 'NARVIK', 'BALLANGEN',
    'EVENESMARKA', 'ENEV'];
  const wps = names.map((n, i) => ({
    lat: 68.5 + i * 0.09, lng: 17.0 + (i % 2 ? 1.5 : -1.5), name: n,
    alt: i === 0 ? 254 : 500 + i * 450, oat: -12, wdir: 285, wspd: 45, var: -11.6
  }));
  const ad = (icao) => C182_AIP.aerodromes.find((a) => a.icao === icao);
  wps[0] = Object.assign(wps[0], { lat: ad('ENDU').lat, lng: ad('ENDU').lng });
  wps[19] = Object.assign(wps[19], { lat: ad('ENEV').lat, lng: ad('ENEV').lng, alt: ad('ENEV').elevFt });
  flights = [{ id: 1, title: 'Worst case', depElev: 254, waypoints: wps }];
  activeFlightIndex = 0;
  document.getElementById('fuel-dep').value = '88';
  document.getElementById('def-date').value = '2026-09-29';
  mbPrefs.reg = null; setMbReg('LN-TRE'); setMbLoad('pilotLb', 195); setMbLoad('rightLb', 180);
  mbPrefs.view = 'sector';
  lastWeather = { icaos: ['ENDU', 'ENEV'], tafs: {}, metars: {
    ENDU: 'ENDU 291150Z 28012KT 9999 FEW040 11/05 Q0990 TEMPO 30018G28KT',
    ENEV: 'ENEV 291150Z 17014KT 9999 SCT030 08/04 Q1003' } };
  setActualFuel('100.5');
});
await page.waitForTimeout(300);
const lmcSeen = await page.evaluate(() => {
  const s = buildPrintDoc().sheets.find((sh) => sh.kind === 'mb');
  const txt = s ? s.items.map((it) => it.text) : [];
  return { lmc: txt.includes('+75,0'), note: txt.some((t) => /Last Minute Change: planned 88,0 US gal, actual 100,5/.test(t)),
           tempo: txt.includes('Wind from the METAR TEMPO group') || txt.some((t) => /TEMPO/.test(t)) };
});
check(lmcSeen.lmc && lmcSeen.note, 'the worst case writes the Last Minute Change line and the note strip: ' + JSON.stringify(lmcSeen));
check(lmcSeen.tempo, 'the worst case works the ENDU take-off with its TEMPO wind: ' + JSON.stringify(lmcSeen));

// ---- 4. the real button opens a PDF --------------------------------------
const [popup] = await Promise.all([ctx.waitForEvent('page'), page.click('#print-btn')]);
await popup.waitForURL(/^blob:/, { timeout: 15000 }).catch(() => {});
check(/^blob:/.test(popup.url()), 'the Print / preview OFP button opens a new tab on a PDF: ' + popup.url().slice(0, 40));
// The popup's blob belongs to the opener's origin, so the opener reads it.
const fromButton = await page.evaluate(async (url) => {
  const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
  let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return { head: s.slice(0, 5), b64: btoa(s), sheets: buildPrintDoc().sheets.map((x) => x.kind) };
}, popup.url());
await popup.close();
check(fromButton.head === '%PDF-', 'what it opens is a PDF');
check(JSON.stringify(fromButton.sheets) === JSON.stringify(['ofp', 'ofp', 'mb']),
  'a 19-leg sector prints two OFP sheets and then its M&B page: ' + fromButton.sheets.join(','));

// ---- render with pdf.js, in the page ---------------------------------------
const res = await page.evaluate(async (b64) => {
  const pdfjs = await import('/__pdfjs/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/__pdfjs/pdf.worker.mjs';
  const DPI = 150, k = DPI / 72;
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const { PDFLib, form } = await loadPrintAssets();
  const docOf = (data) => pdfjs.getDocument({ data: data.slice() }).promise;
  const render = async (d, n) => {
    const pg = await d.getPage(n);
    const vp = pg.getViewport({ scale: k });
    const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
    const g = c.getContext('2d');
    await pg.render({ canvasContext: g, viewport: vp, background: '#fff' }).promise;
    return { w: c.width, h: c.height, d: g.getImageData(0, 0, c.width, c.height).data, view: pg.view };
  };
  // A PAGE IS READ ONLY ONCE TWO CONSECUTIVE RENDERS AGREE. The FIRST pdf.js
  // render of a freshly opened document is sometimes wrong - measured at
  // v16.98: the blank form's page 1 rendered twice differed from ITSELF by
  // 324 px while the second render matched our blank sheet exactly (0), and it
  // struck 2 runs in 5 once the fixture grew. That is the renderer warming up
  // (a font-load race), not the PDF, so it is measured and waited out rather
  // than tolerated with a threshold - the verify-visual rule. A page that never
  // settles is a failure in its own right, not a pass.
  const same = (a, b2) => { for (let i = 0; i < a.d.length; i++) if (a.d[i] !== b2.d[i]) return false; return a.d.length === b2.d.length; };
  const unsettled = [];
  const pixels = async (d, n) => {
    let prev = await render(d, n);
    for (let k = 0; k < 4; k++) {
      const next = await render(d, n);
      if (same(prev, next)) return next;
      prev = next;
    }
    unsettled.push(n);
    return prev;
  };
  const diff = (a, b2) => { let n = 0; const at = [];
    for (let i = 0; i < a.d.length; i += 4) {
      if (a.d[i] !== b2.d[i] || a.d[i + 1] !== b2.d[i + 1] || a.d[i + 2] !== b2.d[i + 2]) { n++; at.push(i / 4); }
    }
    return { n, at };
  };
  const formDoc = await docOf(form);
  const formPages = [await pixels(formDoc, 1), await pixels(formDoc, 2)];

  // 1. NOTHING WRITTEN -> THE FORM, EXACTLY.
  const blank = await renderOfpPdf(PDFLib, form, { title: 'blank', band: null,
    sheets: [{ kind: 'ofp', items: [] }, { kind: 'mb', items: [], marks: [], ldHwind: false }] });
  const blankDoc = await docOf(blank.bytes);
  const blankDiff = [diff(formPages[0], await pixels(blankDoc, 1)).n, diff(formPages[1], await pixels(blankDoc, 2)).n];

  // 2. EVERY CHANGED PIXEL IS INSIDE A BOX WE WROTE INTO.
  const model = buildPrintDoc();
  const rebuilt = await renderOfpPdf(PDFLib, form, model);
  const real = await docOf(bytes);
  const sizes = [], stray = [];
  let changed = 0;
  for (let i = 0; i < real.numPages; i++) {
    const sh = model.sheets[i];
    const p = await pixels(real, i + 1);
    sizes.push(p.view.slice(2).join('x'));
    const f = formPages[sh.kind === 'ofp' ? 0 : 1];
    const zones = sh.items.map((it) => it.box);
    if (sh.kind === 'mb') zones.push({ x0: CG_CHART.x0 - 6, x1: CG_CHART.x1 + 60, y0: CG_CHART.y0 - 6, y1: CG_CHART.y1 + 6 });
    if (sh.kind === 'mb' && sh.ldHwind) zones.push(PREPRINTED_ZERO);
    if (model.band) zones.push(BAND_BOX);
    const d = diff(f, p);
    changed += d.n;
    let outside = 0, first = null;
    for (const idx of d.at) {
      const x = (idx % p.w + 0.5) / k, y = 612 - (Math.floor(idx / p.w) + 0.5) / k;
      // A pixel counts as inside when it is within 1 pt of a zone: text is
      // antialiased, and a glyph's edge pixel can straddle the box edge.
      if (!zones.some((z) => x >= z.x0 - 1 && x <= z.x1 + 1 && y >= z.y0 - 1 && y <= z.y1 + 1)) {
        outside++; if (!first) first = x.toFixed(1) + ',' + y.toFixed(1);
      }
    }
    stray.push({ page: i + 1, kind: sh.kind, outside, first });
  }
  const acc = Math.max(...model.sheets.filter((s) => s.kind === 'ofp')
    .flatMap((s) => s.items).filter((it) => /^\d+\.\d$/.test(it.text)).map((it) => Number(it.text)));
  return { unsettled, blankDiff, stray, changed, pages: real.numPages, sheets: model.sheets.length, sizes,
           overflow: rebuilt.overflow, acc, band: model.band };
}, fromButton.b64);

check(res.unsettled.length === 0, 'every page rendered the same twice running (pdf.js had settled): ' + JSON.stringify(res.unsettled));
check(res.blankDiff[0] === 0 && res.blankDiff[1] === 0,
  'a sheet with nothing written on it IS the form: ' + res.blankDiff.join(' / ') + ' pixels differ (page 1 / page 2) at 150 dpi');
check(res.pages === res.sheets, 'one PDF page per sheet: ' + res.pages + ' for ' + res.sheets);
check(res.sizes.every((s) => s === '792x612'), 'every page is the form\'s own 792 x 612 pt: ' + [...new Set(res.sizes)].join(','));
check(res.changed > 5000, 'the plan actually wrote on the form (' + res.changed + ' pixels) - not a vacuous pass');
for (const s of res.stray) {
  check(s.outside === 0, `page ${s.page} (${s.kind}): every changed pixel is inside a box the planner wrote into` +
    (s.outside ? ` - ${s.outside} outside, first at ${s.first} pt` : ''));
}
check(res.overflow.length === 0, 'nothing had to be shrunk below the smallest size: ' + JSON.stringify(res.overflow));
check(res.acc >= 1000, 'the fixture really reaches a four-digit ACC Dist (' + res.acc + ') - the widest figure on page 1');
// The worst case really does run out of fuel (1200 NM on 88 gal), so it
// carries the DO NOT USE band. Its zone is only the top margin (BAND_BOX), so
// it cannot excuse a figure written anywhere else on the sheet.

// ---- a broken plan: the DO NOT USE band, on every page ----------------------
const broken = await page.evaluate(async () => {
  flights[0].waypoints[3].alt = 26000;
  renderAllFlightTables();
  const pdfjs = await import('/__pdfjs/pdf.mjs');
  const { PDFLib, form } = await loadPrintAssets();
  const model = buildPrintDoc();
  const out = await renderOfpPdf(PDFLib, form, model);
  const d = await pdfjs.getDocument({ data: out.bytes }).promise;
  const withBand = [];
  for (let i = 1; i <= d.numPages; i++) {
    const tc = await (await d.getPage(i)).getTextContent();
    withBand.push(tc.items.some((t) => /INTEGRITY CHECK FAILED - DO NOT USE/.test(t.str)));
  }
  flights[0].waypoints[3].alt = 1850; renderAllFlightTables();
  return { pages: d.numPages, withBand };
});
check(broken.withBand.length > 0 && broken.withBand.every(Boolean),
  'a plan the app calls unusable prints DO NOT USE on every page: ' + broken.withBand.join(','));

check(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
await b.close();
if (fails.length) { console.log(`\n${fails.length} check(s) FAILED`); process.exit(1); }
console.log('\nall OFP print checks passed');
