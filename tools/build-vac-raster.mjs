#!/usr/bin/env node
/**
 * Georeferenced VAC rasters - `npm run build:vac-raster`.
 *
 * SOURCE AND LICENCE. The Visual Approach Charts are part of Avinor's eAIP:
 * (c) Avinor AS, used with permission, NON-COMMERCIALLY. Same grant as the
 * airspace data and the reporting points, and the same condition - see
 * CLAUDE.md. Nothing here is Kartverket's.
 *
 * THE RASTER IS DISPLAYED, NEVER READ. No coordinate in this project comes off
 * a chart image: the 243 reporting points still come from the printed
 * coordinate TABLE (tools/build-vac.mjs), and the symbols located here are used
 * only to FIT the sheet's own georeference, never to publish a position.
 *
 * WHAT IT DOES, per chart:
 *   1. pins the source PDF by SHA-256 and reads its printed chart date;
 *   2. fits page -> coordinate with tools/vac-geo.mjs, from the published
 *      reporting points where the sheet prints a table, and from the printed
 *      graticule where it does not;
 *   3. holds points back from the fit and measures against them;
 *   4. cross-checks the two independent models against each other, which is the
 *      only check that can see a shared-assumption bias in the anchor;
 *   5. renders, crops to the neatline, warps to EPSG:3857 and writes a lossless
 *      WebP whose path carries the chart date, the source hash and the
 *      preparation revision, so a changed preparation is a NEW asset rather
 *      than a silent overwrite of an approved one.
 *
 * MAINTAINER PREREQUISITES, checked before anything runs: GDAL
 * (gdal_translate, gdalwarp, gdaltransform, gdalinfo) and Poppler's pdftoppm.
 * They never run in the planner and the planner never needs them - exactly like
 * pdfjs-dist, which prepares data and is not shipped. GDAL 3.11 is NOT required:
 * that is for `gdal raster tile`, which is only needed for XYZ tiles, and this
 * writes one image per chart.
 *
 * TWO NUMBERS THAT ARE MEASURED, NOT PICKED - see CLAUDE.md for the tables:
 *   - 600 DPI. It puts the raster at 1:1 around zoom 12 (15.2 m/px on a
 *     1:360 000 sheet, 8.5 m/px on a 1:200 000 one) with the smallest printed
 *     text at 18.2 px cap height, for 3.7 MB and 880 ms of decode. 1200 DPI
 *     costs 2 246 ms of decode and 323 MB of bitmap for sharpness at a zoom
 *     past where a VAC is read - and v16.23 already established that decode,
 *     not network, is what makes a chart feel slow.
 *   - LOSSLESS. WebP at quality 92 shifts chart ink by up to 128 levels at
 *     600 dpi (127 at 800, 132 at 1200). png8 and jpg are banned for the ICAO
 *     chart at 71 and 37 levels, because the small print is the whole point;
 *     the same standard applies here.
 */
import { mkdir, readFile, writeFile, readdir, rm, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { writeFileSync, openSync, closeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pageGeometry } from './vac-pdf.mjs';
import { vacGraphics } from './aip-vac.mjs';
import * as G from './vac-geo.mjs';

const CACHE = '.aip-cache';
const WORK = '.vacwork/build';
const ASSET_DIR = 'data/vac';
const SNAPSHOT = 'tools/prepared/vac-charts.json';
const INDEX = 'data/vac-index.js';
const REPORT = 'data/vac-raster-report.json';
const ROOT = 'https://aim-prod.avinor.no';
const UA = 'C182FlightPlanner-AipImporter/1.0 (ground planning; permission held)';

/** Bump when the pipeline changes what it produces. Asset paths carry it, so a
 *  new revision is a NEW file rather than an overwrite of an approved one. */
export const PREPARATION_REVISION = 1;
export const RENDER_DPI = 600;
/** GDAL reproduces the fitted model from a 5x5 grid sampled off it. Measured at
 *  20 off-grid points: order 1 is 158 m out, order 2 is 1.16 m, order 3 is
 *  0.003 m and a thin-plate spline is 7.08 m - TPS interpolates its control
 *  points exactly and wobbles between them, so on a sampled grid it is worse
 *  than a plain cubic. Order 3 puts the warp four orders of magnitude below the
 *  model's own residual, so it contributes nothing to the error budget. */
export const GCP_GRID = 5;
export const WARP_ORDER = 3;

const NEEDED = ['gdal_translate', 'gdalwarp', 'gdaltransform', 'gdalinfo', 'pdftoppm'];

function requireTools() {
  const missing = NEEDED.filter((t) => spawnSync('which', [t]).status !== 0);
  if (missing.length) {
    console.error(
      `\nMissing: ${missing.join(', ')}\n\n` +
      'This step needs GDAL and Poppler on PATH. They prepare the charts and are\n' +
      'never used by the planner itself.\n\n' +
      '  Debian/Ubuntu:  apt-get install gdal-bin poppler-utils\n' +
      '  macOS:          brew install gdal poppler\n');
    process.exit(1);
  }
}

/** @param {string} cmd @param {string[]} args */
function sh(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`${cmd} exited ${r.status}: ${(r.stderr || '').slice(0, 400)}`);
  return r.stdout;
}

/**
 * gdaltransform reads its points from STDIN, and a Node PIPE DEADLOCKS it once
 * pdfjs has been loaded in this process - verified both ways: the identical
 * call returns instantly from a process that never imported pdfjs, and returns
 * instantly here as soon as stdin is a real file descriptor. So the points go
 * through a file. Do not "simplify" this back to `input:`.
 */
function gdaltransform(args, points) {
  const file = join(WORK, 'points.txt');
  writeFileSync(file, points.join('\n') + '\n');
  const fd = openSync(file, 'r');
  try {
    const r = spawnSync('gdaltransform', args, { stdio: [fd, 'pipe', 'pipe'], encoding: 'utf8' });
    if (r.status !== 0) throw new Error('gdaltransform exited ' + r.status + ': ' + (r.stderr || ''));
    return r.stdout.trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number));
  } finally { closeSync(fd); }
}


const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };

/**
 * The chart's OWN printed date, e.g. "14 MAY 2026" -> "2026-05-14".
 * A VAC is versioned by this and by its source hash, NOT by the AIRAC cycle it
 * was fetched in: an edition that republishes an unchanged chart must not
 * produce a new asset.
 * @param {{str: string}[]} items @returns {string|null}
 */
export function printedChartDate(items) {
  for (const it of items) {
    const m = /^(\d{1,2})\s+([A-Z]{3})\s+(\d{4})$/.exec(String(it.str || '').trim().toUpperCase());
    if (!m) continue;
    const mon = MONTHS[m[2]];
    if (!mon) continue;
    return `${m[3]}-${String(mon).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
  }
  return null;
}

async function pdfBytes(id, graphicsBase) {
  await mkdir(join(CACHE, 'graphics'), { recursive: true });
  const file = join(CACHE, 'graphics', id + '.pdf');
  const cached = await readFile(file).catch(() => null);
  if (cached) return cached;
  if (!graphicsBase) throw new Error(`graphics/${id}.pdf is not cached and no edition base was resolved`);
  const res = await fetch(`${graphicsBase}/${id}.pdf`, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`graphics/${id}.pdf -> HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(file, buf);
  return buf;
}

/**
 * Split controls into a fit set and an independent holdout set, deterministically.
 * Every fourth point is held back, so the holdout is spread over the sheet
 * rather than bunched at one end, and re-running produces the same split.
 * @param {G.Control[]} controls
 */
function splitControls(controls) {
  const fit = [], holdout = [];
  controls.forEach((c, i) => ((i % 4 === 2 ? holdout : fit).push(c)));
  return { fit, holdout };
}

/** Observations for a conformal fit from published-point controls. */
function controlObservations(controls) {
  const out = [];
  for (const c of controls) {
    out.push({ kind: /** @type {const} */ ('lng'), x: c.x, y: c.y, value: c.lng, major: true });
    out.push({ kind: /** @type {const} */ ('lat'), x: c.x, y: c.y, value: c.lat, major: true });
  }
  return out;
}

function controlResiduals(model, controls) {
  let worst = 0, sum = 0;
  for (const c of controls) {
    const at = G.evaluate(model, c.x, c.y);
    const per = G.metresPerDegree(c.lat);
    const d = Math.hypot((at.lng - c.lng) * per.perLng, (at.lat - c.lat) * per.perLat);
    worst = Math.max(worst, d); sum += d * d;
  }
  return { rmsMetres: controls.length ? Math.sqrt(sum / controls.length) : NaN, maxMetres: worst };
}

/**
 * Fit one chart and decide whether it may be drawn.
 * @returns {Promise<{ok: true, record: any}|{ok: false, icao: string, chart: string, reason: string, detail?: string}>}
 */
async function prepareChart(entry, published, graphicsBase) {
  const { icao, id, ref } = entry;
  const bytes = await pdfBytes(id, graphicsBase);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const geo = await pageGeometry(new Uint8Array(bytes), 1);
  const chartDate = printedChartDate(geo.textItems);
  if (!chartDate) return { ok: false, icao, chart: ref, reason: 'no-printed-chart-date' };

  const frame = G.chartFrame(geo.segments);
  if (!frame) return { ok: false, icao, chart: ref, reason: 'no-chart-frame' };
  const grat = G.graticuleObservations(geo.segments, geo.textItems, frame);
  if ('refused' in grat) {
    return { ok: false, icao, chart: ref, reason: 'graticule-unreadable',
      detail: grat.refused.map((r) => `${r.edge}: ${r.reason}${r.detail ? ' (' + r.detail + ')' : ''}`).join('; ') };
  }
  const gratModel = G.fitConformal(grat.fit, frame);
  if (!gratModel) return { ok: false, icao, chart: ref, reason: 'graticule-fit-singular' };
  const gratFit = G.observationResiduals(gratModel, grat.fit);
  const gratHold = grat.holdout.length ? G.observationResiduals(gratModel, grat.holdout) : null;
  if (!(gratFit.maxMetres <= G.MAX_GRATICULE_RESIDUAL_M)) {
    return { ok: false, icao, chart: ref, reason: 'graticule-residual-too-large',
      detail: `${gratFit.maxMetres.toFixed(1)} m > ${G.MAX_GRATICULE_RESIDUAL_M} m` };
  }

  // PUBLISHED POINTS are the primary control where the sheet prints a table.
  // The graticule model supplies the CORRESPONDENCE - roughly where each point
  // should be - and the published table supplies the PRECISION.
  let source = 'graticule', model = gratModel, pointInfo = null, crossMax = null;
  const table = (published.get(icao) || []).filter((p) => p.chart === ref);
  if (table.length >= G.MIN_FIT_POINTS + G.MIN_VALIDATION_POINTS) {
    const symbols = G.chartTriangles(geo.segments, frame);
    const matched = G.matchPublishedPoints(symbols, table,
      (lat, lng) => G.project(gratModel, lat, lng, frame));
    const { fit, holdout } = splitControls(matched.controls);
    const span = G.controlSpanFraction(fit, frame);
    const enough = fit.length >= G.MIN_FIT_POINTS && holdout.length >= G.MIN_VALIDATION_POINTS;
    const spread = span.x >= G.MIN_CONTROL_SPAN_FRACTION && span.y >= G.MIN_CONTROL_SPAN_FRACTION;
    if (enough && spread) {
      const pm = G.fitConformal(controlObservations(fit), frame);
      if (pm) {
        const fitRes = controlResiduals(pm, fit), holdRes = controlResiduals(pm, holdout);
        // THE CHECK A HOLDOUT CANNOT MAKE: fit and holdout share the anchor
        // convention, so only a second, independently derived model sees a bias
        // in it. Taking the symbol centroid instead of its bounding-box centre
        // moves this to ~180 m.
        let worst = 0;
        for (const c of matched.controls) {
          const a = G.evaluate(pm, c.x, c.y), b = G.evaluate(gratModel, c.x, c.y);
          const per = G.metresPerDegree(a.lat);
          worst = Math.max(worst, Math.hypot((a.lng - b.lng) * per.perLng, (a.lat - b.lat) * per.perLat));
        }
        crossMax = worst;
        if (holdRes.maxMetres > G.MAX_PUBLISHED_RESIDUAL_M) {
          return { ok: false, icao, chart: ref, reason: 'published-holdout-too-large',
            detail: `${holdRes.maxMetres.toFixed(1)} m > ${G.MAX_PUBLISHED_RESIDUAL_M} m` };
        }
        if (worst > G.MAX_CROSS_CHECK_M) {
          return { ok: false, icao, chart: ref, reason: 'control-sources-disagree',
            detail: `graticule and published points differ by ${worst.toFixed(1)} m ` +
              `> ${G.MAX_CROSS_CHECK_M} m - one of them is anchored wrongly` };
        }
        source = 'published-points'; model = pm;
        pointInfo = {
          matched: matched.controls.length, unmatched: matched.unmatched,
          symbolPerimeterPt: matched.consensusPerimeter,
          fitPoints: fit.map((c) => ({ name: c.name, lat: c.lat, lng: c.lng, pageX: +c.x.toFixed(3), pageY: +c.y.toFixed(3) })),
          validationPoints: holdout.map((c) => ({ name: c.name, lat: c.lat, lng: c.lng, pageX: +c.x.toFixed(3), pageY: +c.y.toFixed(3) })),
          spanFraction: { x: +span.x.toFixed(3), y: +span.y.toFixed(3) },
          fitResidualM: +fitRes.maxMetres.toFixed(2),
          holdoutResidualM: +holdRes.maxMetres.toFixed(2),
          holdoutRmsM: +holdRes.rmsMetres.toFixed(2)
        };
      }
    }
  }

  // ---- raster ------------------------------------------------------------
  const s = RENDER_DPI / 72;
  const base = join(WORK, icao + '-' + id);
  sh('pdftoppm', ['-r', String(RENDER_DPI), '-png', '-singlefile',
    join(CACHE, 'graphics', id + '.pdf'), base]);
  const cropX = Math.round(frame.left * s), cropY = Math.round((geo.height - frame.top) * s);
  const cropW = Math.round((frame.right - frame.left) * s), cropH = Math.round((frame.top - frame.bottom) * s);
  sh('gdal_translate', ['-q', '-srcwin', String(cropX), String(cropY), String(cropW), String(cropH),
    base + '.png', base + '-crop.tif']);

  const gcps = [];
  for (let i = 0; i < GCP_GRID; i++) for (let j = 0; j < GCP_GRID; j++) {
    const xPdf = frame.left + (i / (GCP_GRID - 1)) * (frame.right - frame.left);
    const yPdf = frame.bottom + (j / (GCP_GRID - 1)) * (frame.top - frame.bottom);
    const at = G.evaluate(model, xPdf, yPdf);
    gcps.push('-gcp', ((xPdf - frame.left) * s).toFixed(4), ((frame.top - yPdf) * s).toFixed(4),
      at.lng.toFixed(9), at.lat.toFixed(9));
  }
  sh('gdal_translate', ['-q', '-a_srs', 'EPSG:4326', ...gcps, base + '-crop.tif', base + '-gcp.tif']);

  // THE WARP MUST REPRODUCE THE MODEL, and that is asserted rather than assumed:
  // points NOT on the GCP grid are pushed through GDAL's own transform and
  // compared with what the model says.
  const probes = [], expect = [];
  for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) {
    const xPdf = frame.left + ((i + 0.5) / 7) * (frame.right - frame.left);
    const yPdf = frame.bottom + ((j + 0.5) / 7) * (frame.top - frame.bottom);
    probes.push(`${((xPdf - frame.left) * s).toFixed(4)} ${((frame.top - yPdf) * s).toFixed(4)}`);
    expect.push(G.evaluate(model, xPdf, yPdf));
  }
  const got = gdaltransform([...gcps, '-order', String(WARP_ORDER)], probes);
  let warpMax = 0;
  for (let k = 0; k < expect.length; k++) {
    const per = G.metresPerDegree(expect[k].lat);
    warpMax = Math.max(warpMax, Math.hypot((got[k][0] - expect[k].lng) * per.perLng,
      (got[k][1] - expect[k].lat) * per.perLat));
  }
  if (warpMax > 1) {
    return { ok: false, icao, chart: ref, reason: 'warp-does-not-reproduce-the-model',
      detail: `${warpMax.toFixed(3)} m at 49 off-grid probes` };
  }

  sh('gdalwarp', ['-q', '-overwrite', '-order', String(WARP_ORDER), '-t_srs', 'EPSG:3857',
    '-r', 'cubic', '-dstalpha', base + '-gcp.tif', base + '-warp.tif']);
  const info = JSON.parse(sh('gdalinfo', ['-json', base + '-warp.tif']));
  const ring = info.wgs84Extent.coordinates[0].map((p) => [Number(p[0]), Number(p[1])]);
  const bounds = {
    west: Math.min(...ring.map((p) => p[0])), east: Math.max(...ring.map((p) => p[0])),
    south: Math.min(...ring.map((p) => p[1])), north: Math.max(...ring.map((p) => p[1]))
  };
  const file = `${icao.toLowerCase()}-${chartDate}-${sha256.slice(0, 8)}-r${PREPARATION_REVISION}.webp`;
  await mkdir(ASSET_DIR, { recursive: true });
  sh('gdal_translate', ['-q', '-of', 'WEBP', '-co', 'LOSSLESS=YES', base + '-warp.tif', join(ASSET_DIR, file)]);
  await rm(join(ASSET_DIR, file + '.aux.xml'), { force: true });
  const bytesOut = (await stat(join(ASSET_DIR, file))).size;
  for (const f of ['.png', '-crop.tif', '-gcp.tif', '-warp.tif']) await rm(base + f, { force: true });

  return {
    ok: true,
    // The seam pass needs the fitted model, the frame and the sheet's drawn
    // symbols; none of them belongs in the snapshot, so they travel beside it.
    geo: { icao, chart: ref, model, frame, symbols: G.chartTriangles(geo.segments, frame) },
    record: {
      icao, chart: ref, chartDate, sourcePdfSha256: sha256,
      sourceUrl: graphicsBase ? `${graphicsBase}/${id}.pdf` : null,
      graphicId: id,
      preparationRevision: PREPARATION_REVISION,
      file, bytes: bytesOut, pixelWidth: info.size[0], pixelHeight: info.size[1],
      renderDpi: RENDER_DPI, targetCrs: 'EPSG:3857', bounds,
      controlSource: source,
      framePdfPoints: { left: +frame.left.toFixed(3), right: +frame.right.toFixed(3),
        bottom: +frame.bottom.toFixed(3), top: +frame.top.toFixed(3) },
      graticule: {
        fitTicks: grat.fit.length, holdoutTicks: grat.holdout.length,
        fitResidualM: +gratFit.maxMetres.toFixed(2),
        holdoutResidualM: gratHold ? +gratHold.maxMetres.toFixed(2) : null
      },
      publishedPoints: pointInfo,
      crossCheckM: crossMax === null ? null : +crossMax.toFixed(2),
      warpReproductionM: +warpMax.toFixed(4),
      thresholds: {
        maxGraticuleResidualM: G.MAX_GRATICULE_RESIDUAL_M,
        maxPublishedResidualM: G.MAX_PUBLISHED_RESIDUAL_M,
        maxCrossCheckM: G.MAX_CROSS_CHECK_M
      }
    }
  };
}

async function main() {
  requireTools();
  const only = (process.argv.find((a) => a.startsWith('--icao=')) || '').split('=')[1];
  await mkdir(WORK, { recursive: true });
  await mkdir('tools/prepared', { recursive: true });

  const vac = JSON.parse(await readFile('tools/prepared/vac-points.json', 'utf8'));
  const edition = vac.editionLabel;
  const graphicsBase = `${ROOT}/no/AIP/View/Index/155/${edition}/graphics`;
  /** @type {Map<string, any[]>} */
  const published = new Map();
  for (const a of vac.data) if (a.points.length) published.set(a.icao, a.points);

  const pages = (await readdir(CACHE)).filter((f) => f.startsWith(`${edition}-EN-AD-2.`));
  if (!pages.length) throw new Error(`no cached AD 2 pages for ${edition} - run npm run build:vac first`);
  /** @type {{icao: string, id: string, ref: string}[]} */
  const charts = [];
  for (const f of pages.sort()) {
    const icao = f.replace(`${edition}-EN-AD-2.`, '').replace('.html', '');
    if (only && icao !== only) continue;
    for (const v of vacGraphics(await readFile(join(CACHE, f), 'utf8'))) charts.push({ icao, ...v });
  }
  console.log(`${edition}: ${charts.length} Visual Approach Chart(s)` + (only ? ` (${only} only)` : ''));

  const records = [], refused = [], geos = [];
  for (const c of charts) {
    let out;
    try { out = await prepareChart(c, published, graphicsBase); }
    catch (e) { out = { ok: false, icao: c.icao, chart: c.ref, reason: 'threw', detail: String(e.message || e) }; }
    if (out.ok) {
      const r = out.record;
      records.push(r);
      geos.push(out.geo);
      const acc = r.publishedPoints
        ? `points ${r.publishedPoints.fitPoints.length}+${r.publishedPoints.validationPoints.length} ` +
          `holdout ${r.publishedPoints.holdoutResidualM} m  cross ${r.crossCheckM} m`
        : `graticule ${r.graticule.fitTicks} ticks  holdout ${r.graticule.holdoutResidualM} m`;
      console.log(`  ${r.icao} ${r.chartDate} ${String(Math.round(r.bytes / 1024)).padStart(5)} KB  ` +
        `${r.controlSource.padEnd(16)} ${acc}`);
    } else {
      refused.push(out);
      console.log(`  ${out.icao} REFUSED ${out.reason}${out.detail ? ' - ' + out.detail : ''}`);
    }
  }

  // ---- THE SEAM PASS ------------------------------------------------------
  // Where two sheets cover the same ground, they must agree about where it is.
  // This is a CORROBORATION and it says so: the population is three points on
  // the 2026-09-03 edition, because the sheets barely overlap (see
  // G.seamObservations for the measurement). The per-chart holdout and the
  // graticule-vs-published cross-check are what actually gate a chart; this
  // catches the one thing neither can see - two sheets each internally
  // consistent and placed differently.
  const seams = [], seamViolations = [];
  for (let i = 0; i < geos.length; i++) {
    for (let j = i + 1; j < geos.length; j++) {
      const A = geos[i], B = geos[j], ra = records[i], rb = records[j];
      // Cheap reject on the bounding boxes first; the footprint test costs 361
      // model evaluations a pair, and 18 of 1176 pairs survive this.
      if (!(ra.bounds.east > rb.bounds.west && ra.bounds.west < rb.bounds.east &&
            ra.bounds.north > rb.bounds.south && ra.bounds.south < rb.bounds.north)) continue;
      // A WARPED SHEET'S BBOX IS THE ENVELOPE OF A ROTATED QUAD, so two sheets
      // that merely abut share a bbox corner and no ground at all. ENDU/ENTC
      // measures 0.0% here despite looking like the obvious neighbours.
      const overlap = G.footprintOverlap(A, B);
      if (overlap <= 0) continue;
      const pts = [...(published.get(A.icao) || []), ...(published.get(B.icao) || [])];
      const obs = G.seamObservations(A, B, pts);
      const worst = obs.reduce((m, o) => Math.max(m, o.metres), 0);
      const entry = { a: `${A.icao} ${A.chart}`, b: `${B.icao} ${B.chart}`,
        footprintOverlap: +overlap.toFixed(3), points: obs.length,
        worstM: obs.length ? +worst.toFixed(1) : null,
        observations: obs.map((o) => ({ name: o.name, metres: +o.metres.toFixed(1),
          aMetres: +o.aMetres.toFixed(1), bMetres: +o.bMetres.toFixed(1) })) };
      seams.push(entry);
      if (obs.length && worst > G.MAX_SEAM_M) seamViolations.push(entry);
    }
  }
  const seamPts = seams.reduce((n, s2) => n + s2.points, 0);
  console.log(`\n  seams: ${seams.length} overlapping pair(s), ${seamPts} shared point(s)` +
    (seamPts ? `, worst ${Math.max(...seams.filter((x) => x.points).map((x) => x.worstM)).toFixed(1)} m ` +
      `against a ${G.MAX_SEAM_M} m limit` : ''));
  if (seamViolations.length) {
    throw new Error('neighbouring charts disagree beyond ' + G.MAX_SEAM_M + ' m: ' +
      seamViolations.map((v) => `${v.a} vs ${v.b} ${v.worstM} m`).join('; '));
  }

  // NOTHING IS WRITTEN UNTIL EVERY CHART HAS BEEN DECIDED (the v16.48 M4 rule:
  // exiting 1 does not un-write a file, so the gate has to come first).
  const snapshot = {
    schema: 1,
    provider: 'Avinor AS',
    source: 'AIP Norge eAIP, AD 2 <ICAO> 6-1 Visual Approach Chart - ICAO',
    attribution: 'Visual Approach Charts: AIP Norge (c) Avinor AS, used with permission for ' +
      'NON-COMMERCIAL use. Display only - not for navigation. Verify against the current AIP and NOTAM.',
    editionLabel: edition,
    preparationRevision: PREPARATION_REVISION,
    renderDpi: RENDER_DPI,
    preparedAtUtc: new Date().toISOString(),
    charts: records.length,
    data: records
  };
  await writeFile(SNAPSHOT, JSON.stringify(snapshot, null, 1) + '\n', 'utf8');

  const runtime = records.map((r) => ({
    icao: r.icao, chart: r.chart, chartDate: r.chartDate, file: r.file,
    bounds: r.bounds, width: r.pixelWidth, height: r.pixelHeight,
    sourcePdfSha256: r.sourcePdfSha256, preparationRevision: r.preparationRevision,
    controlSource: r.controlSource,
    residualM: r.controlSource === 'published-points'
      ? r.publishedPoints.holdoutResidualM : r.graticule.holdoutResidualM,
    thresholdM: r.controlSource === 'published-points'
      ? r.thresholds.maxPublishedResidualM : r.thresholds.maxGraticuleResidualM
  }));
  await writeFile(INDEX,
    '// GENERATED by tools/build-vac-raster.mjs - do not edit by hand.\n' +
    '// ' + snapshot.attribution + '\n' +
    'window.C182_VAC = ' + JSON.stringify({
      schema: 1, editionLabel: edition, attribution: snapshot.attribution,
      preparationRevision: PREPARATION_REVISION, assetDir: 'data/vac', charts: runtime
    }) + ';\n', 'utf8');
  await writeFile(REPORT, JSON.stringify({ edition, prepared: records.length, refused,
    seamLimitM: G.MAX_SEAM_M, seams }, null, 2) + '\n', 'utf8');

  const total = records.reduce((s, r) => s + r.bytes, 0);
  console.log(`\n${records.length} chart(s) prepared, ${refused.length} refused` +
    `\n  ${(total / 1048576).toFixed(1)} MB total, ${(total / 1048576 / Math.max(1, records.length)).toFixed(2)} MB average` +
    `\n  control: ${records.filter((r) => r.controlSource === 'published-points').length} from published points, ` +
    `${records.filter((r) => r.controlSource === 'graticule').length} from the printed graticule` +
    `\n  ${SNAPSHOT}, ${INDEX}, ${REPORT}`);
  if (refused.length) console.log('  refused: ' + refused.map((r) => `${r.icao} (${r.reason})`).join(', '));
}

main().catch((err) => { console.error(String(err.stack || err.message || err)); process.exitCode = 1; });
