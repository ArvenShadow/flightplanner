#!/usr/bin/env node
/**
 * Prepare VFR reporting points from the VACs - `npm run build:vac`.
 *
 * SOURCE AND LICENCE. The Visual Approach Charts are part of Avinor's eAIP:
 * © Avinor AS, used with permission, NON-COMMERCIALLY. Same grant as the
 * airspace data, and the same condition - see CLAUDE.md. Nothing here is
 * Kartverket's, so this step depends on one grant only.
 *
 * WHY IT IS A SEPARATE, COMMITTED STEP, like the border. It downloads ~48 PDFs
 * and needs a PDF library that the airspace build has no use for. The output,
 * `tools/prepared/vac-points.json`, is committed so `npm run build:aip` reads
 * a snapshot rather than re-fetching Avinor, and so a re-run cannot silently
 * change a published coordinate. The retrieval date in the file says when.
 *
 * WHAT IT DOES NOT DO. It reads the printed coordinate TABLE only. The chart
 * raster is NOT georeferenced - the PDFs carry no GeoPDF markers (/Measure,
 * /GPTS, /Viewport are all absent), so a chart overlay stays out of reach and
 * is not attempted here.
 *
 * pdfjs-dist is a devDependency: it is needed to PREPARE the data, never to
 * run the planner. The shipped dataset is plain numbers.
 *
 * VERIFIED Sep 2026 against edition 2026-06-11-AIRAC: 53 AD 2 pages, 48 with
 * a VAC, 25 whose VAC carries a coordinate table, 244 points - and 23 VACs
 * that publish their points graphically only, which is reported, not guessed
 * at. Two independent cross-checks are asserted per point; see below.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { extractFields, parseDms } from './aip-fields.mjs';
import {
  reportingPointTables, graticuleRange, isPlausibleName, roughNM, MAX_ARP_NM
} from './aip-vac.mjs';

const CACHE = '.aip-cache';
const OUT = 'tools/prepared/vac-points.json';
const ROOT = 'https://aim-prod.avinor.no';
const UA = 'C182FlightPlanner-AipImporter/1.0 (ground planning; permission held)';

/** Follow /no/AIP to whichever index Avinor currently publishes - a hardcoded
 *  index silently serves a superseded edition. Same discovery as build-aip. */
async function discoverEdition() {
  const res = await fetch(ROOT + '/no/AIP', { redirect: 'manual', headers: { 'user-agent': UA } });
  const m = (res.headers.get('location') || '').match(/\/View\/Index\/(\d+)/);
  if (!m) throw new Error('could not discover the current AIP index');
  const index = m[1];
  const anchor = Date.UTC(2026, 5, 11);
  let k = Math.ceil((Date.now() - anchor) / (28 * 86400000)) + 1;
  for (; k >= -13; k--) {
    const d = new Date(anchor + k * 28 * 86400000);
    const label = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}-AIRAC`;
    const url = `${ROOT}/no/AIP/View/Index/${index}/${label}/html/eAIP/EN-AD-1.3-en-GB.html`;
    const probe = await fetch(url, { headers: { 'user-agent': UA } });
    if (probe.ok) {
      const html = await probe.text();
      const eff = html.match(/effectiveDateStart"\s+content="([\d-]+)"/);
      return {
        index, editionLabel: label, effectiveFrom: eff ? eff[1] : null,
        htmlBase: `${ROOT}/no/AIP/View/Index/${index}/${label}/html/eAIP`,
        // The AD 2.24 links are `../../graphics/<id>.pdf` relative to
        // html/eAIP/, i.e. one level under the edition - NOT under html/.
        graphicsBase: `${ROOT}/no/AIP/View/Index/${index}/${label}/graphics`
      };
    }
  }
  throw new Error('no AIRAC edition path resolved under index ' + index);
}

async function page(edition, name) {
  await mkdir(CACHE, { recursive: true });
  const file = join(CACHE, `${edition.editionLabel}-${name}.html`);
  const cached = await readFile(file, 'utf8').catch(() => null);
  if (cached) return cached;
  const res = await fetch(`${edition.htmlBase}/${name}-en-GB.html`, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`${name} -> HTTP ${res.status}`);
  const html = await res.text();
  await writeFile(file, html, 'utf8');
  return html;
}

/** @param {{graphicsBase: string}} edition @param {string} id */
async function graphic(edition, id) {
  await mkdir(join(CACHE, 'graphics'), { recursive: true });
  const file = join(CACHE, 'graphics', id + '.pdf');
  const cached = await readFile(file).catch(() => null);
  if (cached) return cached;
  const res = await fetch(`${edition.graphicsBase}/${id}.pdf`, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`graphics/${id}.pdf -> HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(file, buf);
  return buf;
}

/** The text layer, as positioned items. */
async function textItems(pdfBytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdfBytes), verbosity: 0 }).promise;
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    for (const i of tc.items) {
      const it = /** @type {any} */ (i);
      if (!it.str || !String(it.str).trim()) continue;
      out.push({
        str: String(it.str).trim(),
        x: Math.round(it.transform[4] * 10) / 10,
        y: Math.round(it.transform[5] * 10) / 10,
        page: p, font: String(it.fontName || '')
      });
    }
  }
  return out;
}

/**
 * The graphic id of an aerodrome's Visual Approach Chart(s), from AD 2.24.
 *
 * Read from the chart table's own rows rather than by scanning every
 * `graphics/*.pdf` link on the page: an AD 2 page links 4 to 103 charts, and
 * only the row TITLED "Visual Approach Chart" is the VAC. Bergen publishes
 * two sheets (6-2 and 6-3), so this returns a list.
 *
 * @param {string} html @returns {{id: string, ref: string, title: string}[]}
 */
function vacGraphics(html) {
  const rows = [...html.matchAll(
    /<p[^>]*>([^<]{3,80})<\/p>\s*<\/td>\s*<td[^>]*>\s*<a href="\.\.\/\.\.\/graphics\/(\d+)\.pdf">([^<]*)<\/a>/g)];
  return rows.filter((m) => /Visual Approach Chart/i.test(m[1]))
    .map((m) => ({ title: m[1].trim(), id: m[2], ref: m[3].replace(/ /g, ' ').trim() }));
}

/** Aerodrome display names, keyed by ICAO, from the AD 1.3 index. Both halves
 *  are tagged fields (TCITY;CUSTOM_ATT7 and the optional TAD_HP;CUSTOM_ATT24),
 *  so "BERGEN / Flesland" is the source's own wording, not ours. */
function aerodromeNames(html) {
  const byRow = new Map();
  for (const f of extractFields(html)) {
    if (!byRow.has(f.row)) byRow.set(f.row, []);
    const list = byRow.get(f.row); if (list) list.push(f);
  }
  /** @type {Map<string, {city: string, name: string|null}>} */
  const out = new Map();
  for (const [, v] of byRow) {
    const icao = v.find((x) => x.record === 'TAD_HP' && x.field === 'CODE_ICAO');
    const city = v.find((x) => x.record === 'TCITY' && x.field === 'CUSTOM_ATT7');
    const nm = v.find((x) => x.record === 'TAD_HP' && x.field === 'CUSTOM_ATT24');
    if (icao && city) out.set(icao.value, { city: city.value, name: nm ? nm.value : null });
  }
  return out;
}

/** The ARP, elevation and published variation from an AD 2 page. All tagged
 *  fields; the elevation uses a non-breaking space as a thousands separator
 *  (Røros is "2 054"), which is why it is stripped rather than parsed as-is. */
function aerodromeFacts(html) {
  const f = extractFields(html);
  const get = (/** @type {string} */ rec, /** @type {string} */ fld) => {
    const x = f.find((y) => y.record === rec && y.field === fld);
    return x ? x.value : null;
  };
  const lat = get('TAD_HP', 'GEO_LAT'), lng = get('TAD_HP', 'GEO_LONG');
  const elev = get('TAD_HP', 'VAL_ELEV');
  return {
    lat: lat ? parseDms(lat) : null,
    lng: lng ? parseDms(lng) : null,
    rawLat: lat, rawLng: lng,
    elevFt: elev ? Number(String(elev).replace(/[\s ]/g, '')) : null,
    magVar: get('TAD_HP', 'VAL_MAG_VAR'),
    magVarYear: get('TAD_HP', 'DATE_MAG_VAR'),
    situation: get('TAD_HP', 'CUSTOM_ATT12')
  };
}

async function main() {
  const edition = await discoverEdition();
  console.log(`edition ${edition.editionLabel} (index ${edition.index})` +
    (edition.effectiveFrom ? `, effective ${edition.effectiveFrom}` : ''));

  const names = aerodromeNames(await page(edition, 'EN-AD-1.3'));
  console.log(`AD 1.3 lists ${names.size} aerodromes`);

  /** @type {any[]} */
  const aerodromes = [];
  const report = {
    noVac: [], noTable: [], refusedTables: [], unnamedRows: [],
    refusedPoints: [], duplicates: [],
    checks: { nameEchoed: 0, nameOnly: 0, graticule: 0, noGraticule: 0, total: 0 }
  };

  for (const icao of [...names.keys()].sort()) {
    let html;
    try { html = await page(edition, 'EN-AD-2.' + icao); }
    catch (e) { report.noVac.push({ icao, reason: 'no AD 2 page: ' + String(e.message || e) }); continue; }

    const facts = aerodromeFacts(html);
    const label = names.get(icao) || { city: icao, name: null };
    const ad = {
      icao,
      name: label.name ? `${label.city} / ${label.name}` : label.city,
      city: label.city,
      lat: facts.lat, lng: facts.lng,
      rawLat: facts.rawLat, rawLng: facts.rawLng,
      elevFt: facts.elevFt,
      magVar: facts.magVar, magVarYear: facts.magVarYear,
      situation: facts.situation,
      points: /** @type {any[]} */ ([]),
      charts: /** @type {string[]} */ ([]),
      maxPointNM: 0
    };

    const vacs = vacGraphics(html);
    if (!vacs.length) { report.noVac.push({ icao, reason: 'AD 2.24 lists no Visual Approach Chart' }); aerodromes.push(ad); continue; }

    const seen = new Set();
    for (const v of vacs) {
      const items = await textItems(await graphic(edition, v.id));
      const grat = graticuleRange(items);
      if (!grat) report.checks.noGraticule++;
      const { tables, refused } = reportingPointTables(items);
      for (const r of refused) report.refusedTables.push({ icao, chart: v.ref, ...r });
      let got = 0;
      for (const t of tables) {
        for (const u of t.unnamed) report.unnamedRows.push({ icao, chart: v.ref, row: u });
        for (const p of t.points) {
          report.checks.total++;
          if (!isPlausibleName(p.name)) {
            report.refusedPoints.push({ icao, chart: v.ref, name: p.name, reason: 'implausible-name' });
            continue;
          }
          // CHECK 1, independent of the table parse: the chart's own printed
          // graticule must cover the point. A misread digit lands off-sheet.
          if (grat) {
            if (p.lat < grat.south || p.lat > grat.north || p.lng < grat.west || p.lng > grat.east) {
              report.refusedPoints.push({
                icao, chart: v.ref, name: p.name, reason: 'outside-chart-graticule',
                detail: `${p.rawLat} ${p.rawLng} vs ${grat.south.toFixed(2)}..${grat.north.toFixed(2)}N` +
                  ` / ${grat.west.toFixed(2)}..${grat.east.toFixed(2)}E`
              });
              continue;
            }
            report.checks.graticule++;
          }
          // CHECK 2: a corruption bound against the ARP, not a tolerance.
          if (ad.lat !== null && ad.lng !== null) {
            const d = roughNM([ad.lat, ad.lng], [p.lat, p.lng]);
            if (d > MAX_ARP_NM) {
              report.refusedPoints.push({
                icao, chart: v.ref, name: p.name, reason: 'implausibly-far-from-aerodrome',
                detail: `${d.toFixed(1)} NM from the ARP (bound ${MAX_ARP_NM} NM)`
              });
              continue;
            }
            ad.maxPointNM = Math.max(ad.maxPointNM, Number(d.toFixed(2)));
          }
          // CHECK 3, a corroboration rather than a gate: is the name also
          // DRAWN on a chart, as a label, and not only listed in the table?
          const key = p.name.toUpperCase().replace(/\s+/g, '');
          const echoed = items.some((b) => b.str.toUpperCase().replace(/\s+/g, '') === key
            && !(b.font === t.font && Math.abs(b.x - t.nameX) <= 2.5));
          if (echoed) report.checks.nameEchoed++; else report.checks.nameOnly++;

          const dedupe = key + '|' + p.rawLat + '|' + p.rawLng;
          if (seen.has(dedupe)) { report.duplicates.push({ icao, name: p.name }); continue; }
          seen.add(dedupe);
          ad.points.push({
            name: p.name,
            lat: Number(p.lat.toFixed(6)), lng: Number(p.lng.toFixed(6)),
            published: `${p.rawLat} ${p.rawLng}`,
            chart: v.ref, nameOnChart: echoed
          });
          got++;
        }
      }
      ad.charts.push(v.ref);
      if (!got) report.noTable.push({ icao, chart: v.ref });
    }
    ad.points.sort((a, b) => a.name.localeCompare(b.name, 'nb'));
    aerodromes.push(ad);
    if (ad.points.length) {
      console.log(`  ${icao} ${ad.name.padEnd(26)} ${String(ad.points.length).padStart(3)} points` +
        `  (max ${ad.maxPointNM.toFixed(1)} NM from the ARP)`);
    }
  }

  const withPoints = aerodromes.filter((a) => a.points.length);
  const total = withPoints.reduce((s, a) => s + a.points.length, 0);
  const dataset = {
    schema: 1,
    provider: 'Avinor AS',
    source: 'AIP Norge eAIP, AD 2 <ICAO> 6-1 Visual Approach Chart - ICAO (PDF text layer)',
    attribution: 'VFR reporting points and aerodrome data: AIP Norge © Avinor AS, ' +
      'used with permission for NON-COMMERCIAL use. Not for navigation - verify against ' +
      'the current AIP and NOTAM.',
    editionLabel: edition.editionLabel,
    effectiveFrom: edition.effectiveFrom,
    retrievedAtUtc: new Date().toISOString(),
    aerodromes: aerodromes.length,
    aerodromesWithPoints: withPoints.length,
    points: total,
    data: aerodromes
  };
  await mkdir('tools/prepared', { recursive: true });
  await writeFile(OUT, JSON.stringify(dataset) + '\n', 'utf8');
  await writeFile('tools/prepared/vac-report.json', JSON.stringify(report, null, 2) + '\n', 'utf8');

  console.log(`\n${OUT}: ${aerodromes.length} aerodromes, ${withPoints.length} with points, ${total} points`);
  console.log(`  names corroborated by a drawn chart label: ${report.checks.nameEchoed}/${report.checks.total}` +
    ` (${report.checks.nameOnly} appear in the table only)`);
  console.log(`  coordinates inside the chart's own graticule: ${report.checks.graticule}/${report.checks.total}` +
    (report.checks.noGraticule ? ` (${report.checks.noGraticule} chart(s) print no graticule)` : ''));
  console.log(`  refused points: ${report.refusedPoints.length}` +
    (report.refusedPoints.length ? ' -> ' + JSON.stringify(report.refusedPoints.slice(0, 5)) : ''));
  console.log(`  unnamed rows: ${report.unnamedRows.length}`);
  console.log(`  charts with no coordinate table (points printed graphically only): ${report.noTable.length}`);
  console.log(`  aerodromes with no VAC at all: ${report.noVac.length}` +
    (report.noVac.length ? ' -> ' + report.noVac.map((n) => n.icao).join(', ') : ''));
  console.log(`  tables refused: ${report.refusedTables.length}` +
    (report.refusedTables.length ? ' -> ' + report.refusedTables.map((r) => r.icao + ' ' + r.reason).join(', ') : ''));
}

main().catch((err) => { console.error(String(err.stack || err.message || err)); process.exitCode = 1; });
