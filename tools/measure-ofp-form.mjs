#!/usr/bin/env node
/**
 * Measure the ruled lines of the school's OFP form (C182OFPMBv4.2.pdf), in PDF
 * points, and write them to tools/prepared/ofp-form-rules.json.
 *
 * WHY THIS EXISTS: the boxes in src/lib/ofppdf.js are where the printed OFP
 * writes its figures, and the only authority for where a box is is the form
 * itself. Page 1's rules are vector paths, but page 2 is six 600 dpi raster
 * strips with the text drawn over them, so its rules cannot be read out of the
 * content stream - they are found here by rendering each page at 4x with
 * pdf.js in real Chromium and detecting runs of dark pixels. A test then
 * requires every box edge in ofppdf.js to sit on one of these rules, so the
 * numbers there cannot drift from the paper.
 *
 * Committed output, like tools/prepared/border.json: the test reads the
 * snapshot, so it needs no browser, and a re-run that changes a rule shows up
 * as a diff to read rather than as a silent move.
 *
 *   npm install --no-save playwright   (or CHROME_PATH=/path/to/chrome)
 *   node tools/measure-ofp-form.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FORM = join(ROOT, 'C182OFPMBv4.2.pdf');
const OUT = join(ROOT, 'tools', 'prepared', 'ofp-form-rules.json');
/** px per pt: 288 dpi. Fine enough to put a 0.5 pt rule on two pixels. */
const SCALE = 4;
/** A pixel is ink below this luminance. 170 rather than 128 because page 2's
 *  thin rules are antialiased across two pixels in the 600 dpi strips. */
const INK = 170;
/** A rule is at least this long, in points - shorter runs are lettering. */
const MIN_PT = 6;
/** Thicker than this is a filled bar (a header), not a rule. */
const MAX_T_PT = 3.2;

const { chromium } = await import('playwright').catch(() => {
  console.error('playwright is not installed: npm install --no-save playwright');
  process.exit(2);
});
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await browser.newPage();
const PDFJS = join(ROOT, 'node_modules', 'pdfjs-dist', 'legacy', 'build');
await page.route('**/*', (r) => {
  const u = new URL(r.request().url());
  if (u.pathname === '/') return r.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
  if (u.pathname.startsWith('/pdfjs/')) {
    return r.fulfill({ contentType: 'text/javascript', body: readFileSync(join(PDFJS, u.pathname.slice(7))) });
  }
  if (u.pathname === '/form.pdf') return r.fulfill({ contentType: 'application/pdf', body: readFileSync(FORM) });
  return r.fulfill({ status: 404 });
});
await page.goto('http://measure.invalid/');

const pages = await page.evaluate(async ([scale, ink, minPt]) => {
  const pdfjs = await import('/pdfjs/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.mjs';
  const doc = await pdfjs.getDocument({ url: '/form.pdf' }).promise;
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const pg = await doc.getPage(p);
    const vp = pg.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height;
    const ctx = c.getContext('2d');
    await pg.render({ canvasContext: ctx, viewport: vp, background: '#fff' }).promise;
    const W = c.width, H = c.height, d = ctx.getImageData(0, 0, W, H).data;
    const dark = (x, y) => { const i = (y * W + x) * 4; return d[i] < ink && d[i + 1] < ink && d[i + 2] < ink; };
    const min = minPt * scale, hs = [], vs = [];
    for (let y = 0; y < H; y++) {
      let s = -1;
      for (let x = 0; x <= W; x++) {
        const k = x < W && dark(x, y);
        if (k && s < 0) s = x;
        if (!k && s >= 0) { if (x - s >= min) hs.push([y, s, x - 1]); s = -1; }
      }
    }
    for (let x = 0; x < W; x++) {
      let s = -1;
      for (let y = 0; y <= H; y++) {
        const k = y < H && dark(x, y);
        if (k && s < 0) s = y;
        if (!k && s >= 0) { if (y - s >= min) vs.push([x, s, y - 1]); s = -1; }
      }
    }
    out.push({ view: pg.view, hs, vs });
  }
  return out;
}, [SCALE, INK, MIN_PT]);
await browser.close();

/**
 * Adjacent pixel runs with the same extent are ONE rule of some thickness.
 * p0/p1 are the run's perpendicular extent and are taken as a min/max - the
 * first version of this assigned them in visiting order and produced rules of
 * zero and negative thickness, which silently dropped two real rules.
 * @param {number[][]} runs [perpendicular, from, to] in pixels
 */
function merge(runs) {
  runs.sort((a, b) => a[0] - b[0]);
  /** @type {{p0: number, p1: number, a0: number, a1: number}[]} */
  const res = [];
  for (const [p, a0, a1] of runs) {
    const m = res.find((r) => Math.abs(r.a0 - a0) <= 3 && Math.abs(r.a1 - a1) <= 3 && p - r.p1 <= 1 && p >= r.p0);
    if (m) { m.p1 = Math.max(m.p1, p); m.a0 = Math.min(m.a0, a0); m.a1 = Math.max(m.a1, a1); }
    else res.push({ p0: p, p1: p, a0, a1 });
  }
  return res;
}

const k = 1 / SCALE, r2 = (v) => Math.round(v * 100) / 100;
const result = { source: 'C182OFPMBv4.2.pdf', unit: 'pt, origin bottom-left', ink: INK, scale: SCALE, pages: [] };
for (const pg of pages) {
  const top = pg.view[3];
  const H = merge(pg.hs).map((r) => ({
    y: r2(top - (r.p0 + r.p1) / 2 * k), x0: r2(r.a0 * k), x1: r2((r.a1 + 1) * k), t: r2((r.p1 - r.p0 + 1) * k)
  })).filter((l) => l.t <= MAX_T_PT);
  const V = merge(pg.vs).map((r) => ({
    x: r2((r.p0 + r.p1) / 2 * k), y0: r2(top - (r.a1 + 1) * k), y1: r2(top - r.a0 * k), t: r2((r.p1 - r.p0 + 1) * k)
  })).filter((l) => l.t <= MAX_T_PT);
  H.sort((a, b) => b.y - a.y || a.x0 - b.x0);
  V.sort((a, b) => a.x - b.x || a.y0 - b.y0);
  result.pages.push({ size: [pg.view[2], pg.view[3]], H, V });
}
writeFileSync(OUT, JSON.stringify(result, null, 1) + '\n');
console.log(`measured ${result.pages.map((p, i) => `page ${i + 1}: ${p.H.length} horizontal + ${p.V.length} vertical rules`).join(', ')}` +
  ` -> ${OUT.slice(ROOT.length + 1)}`);
