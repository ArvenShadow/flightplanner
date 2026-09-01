#!/usr/bin/env node
/**
 * Build the AIP airspace dataset - `npm run build:aip`.
 *
 * PERMISSION. Avinor's eAIP is copyright Avinor AS and its GEN 0.1 states
 * that any use outside copyright law is inadmissible without permission. The
 * project owner HOLDS that permission from Avinor, conditional on the
 * software not being used commercially. That condition is a project-level
 * constraint now, not a footnote: it is recorded in CLAUDE.md, stated in the
 * generated dataset, and shown in the app's guide and attribution line. If
 * this planner is ever commercialised, this dataset must be removed first.
 *
 * WHAT IT DOES. Fetches the current eAIP edition once, at BUILD time, and
 * emits a normalized sidecar. The browser never contacts Avinor and never
 * parses eAIP HTML - the same rule the winds and weather features follow for
 * a different reason. Pages are cached under .aip-cache/ so a re-run needs
 * no network and a parser change can be re-tested offline.
 *
 * WHY A SIDECAR AND NOT JSON: ES modules and fetch() are both blocked on a
 * file:// page, so bulk data ships as `data/*.js` assigning to a global. That
 * is the same constraint that forced the classic-script bundle.
 *
 * WHAT IT REFUSES TO DO. An airspace whose published boundary references the
 * national border, or a coastline, or an arc, is SKIPPED and named in the
 * report. It is never approximated with straight lines between the published
 * points - that would draw a boundary that does not exist, in a tool whose
 * whole purpose is to be right. Resolving border references needs
 * Kartverket's official boundary (their WFS publishes it under NLOD); until
 * that is wired in, those airspaces are absent and the report says so.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { extractFields, parseDms, verticalLimit } from './aip-fields.mjs';

const CACHE = '.aip-cache';
const OUT_DATA = 'data/aip.js';
const OUT_REPORT = 'data/aip-report.json';
const ROOT = 'https://aim-prod.avinor.no';
const UA = 'C182FlightPlanner-AipImporter/1.0 (ground planning; permission held)';

/** Follow /no/AIP to whichever index Avinor currently publishes, rather than
 *  hardcoding one: a hardcoded index silently serves a superseded edition. */
async function discoverEdition() {
  const res = await fetch(ROOT + '/no/AIP', { redirect: 'manual', headers: { 'user-agent': UA } });
  const loc = res.headers.get('location') || '';
  const m = loc.match(/\/View\/Index\/(\d+)/);
  if (!m) throw new Error('could not discover the current AIP index from ' + JSON.stringify(loc));
  const index = m[1];

  // The edition path is not in the redirect; probe the AIRAC path the index
  // page itself serves. AD 1.3 carries the effective date in a meta tag.
  const editions = [];
  for (const guess of editionCandidates()) {
    const url = `${ROOT}/no/AIP/View/Index/${index}/${guess}/html/eAIP/EN-AD-1.3-en-GB.html`;
    const probe = await fetch(url, { headers: { 'user-agent': UA } });
    if (probe.ok) { editions.push({ label: guess, url, html: await probe.text() }); break; }
  }
  if (!editions.length) throw new Error('no AIRAC edition path resolved under index ' + index);
  const found = editions[0];
  const eff = found.html.match(/effectiveDateStart"\s+content="([\d-]+)"/);
  const amdt = found.html.match(/AMDT[^A-Za-z0-9]{0,4}(\d{2}\/\d{4})/);
  return {
    index,
    editionLabel: found.label,
    effectiveFrom: eff ? eff[1] : null,
    revision: amdt ? 'AIP AMDT ' + amdt[1] : null,
    base: `${ROOT}/no/AIP/View/Index/${index}/${found.label}/html/eAIP`,
    indexUrl: found.url
  };
}

/** AIRAC dates are every 28 days. Walk backwards from today so the newest
 *  published edition is found first, and stop after a year. */
function editionCandidates() {
  const out = [];
  // 2026-06-11 is a known AIRAC effective date; the series steps by 28 days.
  const anchor = Date.UTC(2026, 5, 11);
  const now = Date.now();
  let k = Math.ceil((now - anchor) / (28 * 86400000)) + 1;
  for (; k >= -13; k--) {
    const d = new Date(anchor + k * 28 * 86400000);
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}-AIRAC`);
  }
  return out;
}

async function page(edition, name) {
  await mkdir(CACHE, { recursive: true });
  const file = join(CACHE, `${edition.editionLabel}-${name}.html`);
  const cached = await readFile(file, 'utf8').catch(() => null);
  if (cached) return cached;
  const url = `${edition.base}/${name}-en-GB.html`;
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const html = await res.text();
  await writeFile(file, html, 'utf8');
  return html;
}

/**
 * Split one page's field stream into airspace blocks.
 *
 * Document order IS the structure: the published table states an airspace's
 * name, then its lateral limits, then its vertical limits, class, unit and
 * frequencies, before the next airspace begins. So a new block starts at
 * every `TAIRSPACE;CUSTOM_ATT24` (the name) and everything until the next one
 * belongs to it. The numeric record ids are pairing keys within a block, not
 * identities across the document - the same id can recur - so they are never
 * used as feature ids.
 */
function airspaceBlocks(fields) {
  const blocks = [];
  let cur = null;
  for (const f of fields) {
    if (f.record === 'TAIRSPACE' && f.field === 'CUSTOM_ATT24') {
      cur = { name: f.value, type: (f.after || '').trim(), vertices: [], volumes: new Map(), classes: [], borders: [], freqs: new Map(), units: [] };
      blocks.push(cur);
      continue;
    }
    if (!cur) continue;
    if (f.record === 'TAIRSPACE' && f.field === 'TXT_LOCAL_TYPE') { cur.type = f.value || cur.type; continue; }
    if (f.record === 'TGEO_BORDER') { cur.borders.push(f.value); continue; }
    if (f.record === 'TAIRSPACE_VERTEX') {
      const last = cur.vertices[cur.vertices.length - 1];
      if (f.field === 'GEO_LAT') cur.vertices.push({ id: f.id, lat: f.value, lng: null });
      else if (f.field === 'GEO_LONG' && last && last.lng === null) last.lng = f.value;
      continue;
    }
    if (f.record === 'TAIRSPACE_VOLUME') {
      if (!cur.volumes.has(f.id)) cur.volumes.set(f.id, {});
      cur.volumes.get(f.id)[f.field] = f.value;
      continue;
    }
    if (f.record === 'TAIRSPACE_LAYER_CLASS' && f.field === 'CODE_CLASS') { cur.classes.push(f.value); continue; }
    if (f.record === 'TUNIT' && f.field === 'TXT_NAME') { cur.units.push(f.value); continue; }
    if (f.record === 'TCALLSIGN_DETAIL' && f.field === 'CUSTOM_ATT7') { cur.units.push(f.value); continue; }
    if (f.record === 'TFREQUENCY') {
      if (!cur.freqs.has(f.id)) cur.freqs.set(f.id, {});
      cur.freqs.get(f.id)[f.field] = f.value;
      continue;
    }
  }
  return blocks;
}

/** A published ring, or a reason it cannot be drawn. */
function ringOf(block) {
  if (block.borders.length) {
    return { skip: 'national-border-reference', detail: block.borders.join(', ') };
  }
  const pts = [];
  for (const v of block.vertices) {
    const lat = parseDms(v.lat), lng = parseDms(v.lng || '');
    if (lat === null || lng === null) return { skip: 'unparsable-coordinate', detail: `${v.lat} ${v.lng}` };
    // The published ring repeats its first point to close; drop the repeat.
    const prev = pts[pts.length - 1];
    if (prev && prev[0] === lat && prev[1] === lng) continue;
    pts.push([Number(lat.toFixed(6)), Number(lng.toFixed(6))]);
  }
  if (pts.length > 1) {
    const a = pts[0], z = pts[pts.length - 1];
    if (a[0] === z[0] && a[1] === z[1]) pts.pop();
  }
  if (pts.length < 3) return { skip: 'insufficient-coordinates', detail: pts.length + ' points' };
  return { ring: pts };
}

const KINDS = [
  [/\bTMA\b/i, 'TMA'], [/\bCTR\b/i, 'CTR'], [/\bTIZ\b/i, 'TIZ'],
  [/\bTIA\b/i, 'TIA'], [/\bCTA\b/i, 'CTA'], [/\bRMZ\b/i, 'RMZ'],
  [/\bTMZ\b/i, 'TMZ'], [/\bHTZ\b/i, 'HTZ'], [/\bADS\b/i, 'ADS'],
  [/\bACC\b|\bSector\b/i, 'ACC'], [/\bOCA\b/i, 'OCA'],
  [/\bFIR\b/i, 'FIR'], [/\bUIR\b/i, 'UIR']
];

/** Airspace that is not a VFR planning consideration and is not drawn: the
 *  FIR is the whole country, an oceanic CTA is the whole sea, and an ACC
 *  sector is an en-route control division several flight levels above a
 *  C182. Drawing them buries the CTRs and TMAs that matter. */
const NOT_DRAWN = new Set(['FIR', 'UIR', 'OCA', 'ACC']);

/** The type is published as a tagged field in AD 2 and as untagged text in
 *  ENR 2.1, and for a few entries only the NAME carries it (POLARIS FIR).
 *  Read both. */
function kindOf(type, name) {
  const text = `${type || ''} ${name || ''}`;
  for (const [re, k] of KINDS) if (re.test(text)) return k;
  return (type || '').toUpperCase() || 'OTHER';
}

function buildFeatures(blocks, source, report) {
  const out = [];
  // The eAIP restates some volumes (23 of them in this edition), so the same
  // name, band and ring can arrive twice. Drawing it twice double-darkens the
  // polygon and shows the pilot two airspaces where there is one.
  const seen = new Set();
  for (const b of blocks) {
    const kind = kindOf(b.type, b.name);
    if (NOT_DRAWN.has(kind)) { report.skipped.push({ name: `${b.name} ${b.type}`.trim(), kind, reason: 'not-a-vfr-planning-airspace', source }); continue; }
    if (!b.volumes.size) { report.skipped.push({ name: b.name, kind, reason: 'no-published-vertical-limits', source }); continue; }

    const geom = ringOf(b);
    if (geom.skip) {
      report.skipped.push({ name: `${b.name} ${b.type}`.trim(), kind, reason: geom.skip, detail: geom.detail, source });
      continue;
    }

    const freqs = [...b.freqs.values()]
      .map(f => ({ mhz: (f.VAL_FREQ_TRANS || '').trim(), unit: (f.UOM_FREQ || '').trim() }))
      .filter(f => f.mhz);
    const callsigns = [...new Set(b.units.filter(Boolean))];
    const volumes = [...b.volumes.values()];

    volumes.forEach((v, i) => {
      const lower = verticalLimit(v.VAL_DIST_VER_LOWER, v.UOM_DIST_VER_LOWER, v.CODE_DIST_VER_LOWER);
      const upper = verticalLimit(v.VAL_DIST_VER_UPPER, v.UOM_DIST_VER_UPPER, v.CODE_DIST_VER_UPPER);
      if (!lower.text && !upper.text) return;
      const band = [lower.text, upper.text].filter(Boolean).join(' - ');
      const name = `${b.name} ${b.type}`.trim() + (volumes.length > 1 && band ? ` (${band})` : '');
      const key = name + '|' + band + '|' + JSON.stringify(geom.ring);
      if (seen.has(key)) { report.duplicatesDropped = (report.duplicatesDropped || 0) + 1; return; }
      seen.add(key);
      out.push({
        name,
        kind,
        // The class is published per layer; when one class is published for
        // the whole airspace it applies to every volume.
        class: b.classes.length === volumes.length ? (b.classes[i] || null) : (b.classes[0] || null),
        lower, upper,
        ring: geom.ring,
        callsigns,
        freqs,
        source
      });
    });
  }
  return out;
}

async function main() {
  const edition = await discoverEdition();
  console.log(`edition ${edition.editionLabel}  index ${edition.index}  effective ${edition.effectiveFrom}  ${edition.revision || ''}`);

  const report = {
    provider: 'Avinor', source: 'eAIP',
    editionLabel: edition.editionLabel,
    effectiveFrom: edition.effectiveFrom,
    revision: edition.revision,
    indexUrl: edition.indexUrl,
    retrievedAtUtc: new Date().toISOString(),
    permission: 'Used with permission from Avinor AS. Non-commercial use only.',
    counts: {}, skipped: [], pages: []
  };

  const features = [];
  const pages = [
    ['EN-ENR-2.1', 'ENR 2.1'],
    ['EN-ENR-2.2', 'ENR 2.2']
  ];
  // AD 2.17 carries each aerodrome's own CTR / TIZ.
  const ad13 = await page(edition, 'EN-AD-1.3');
  const icaos = [...new Set((ad13.match(/\bEN[A-Z]{2}\b/g) || []))].sort();
  for (const icao of icaos) pages.push([`EN-AD-2.${icao}`, `AD 2.17 ${icao}`]);

  for (const [file, label] of pages) {
    let html;
    try { html = await page(edition, file); }
    catch (err) { report.pages.push({ page: label, error: String(err.message || err) }); continue; }
    const fields = extractFields(html);
    const blocks = airspaceBlocks(fields);
    const url = `${edition.base}/${file}-en-GB.html`;
    const built = buildFeatures(blocks, { section: label, url }, report);
    features.push(...built);
    report.pages.push({ page: label, blocks: blocks.length, features: built.length });
    process.stdout.write(`  ${label}: ${built.length} volume(s) from ${blocks.length} block(s)\n`);
  }

  const byKind = {};
  for (const f of features) byKind[f.kind] = (byKind[f.kind] || 0) + 1;
  report.counts = { features: features.length, byKind, skipped: report.skipped.length };

  const reasons = {};
  for (const s of report.skipped) reasons[s.reason] = (reasons[s.reason] || 0) + 1;
  report.skippedByReason = reasons;

  const dataset = {
    schema: 1,
    provider: 'Avinor',
    source: 'eAIP',
    editionLabel: edition.editionLabel,
    effectiveFrom: edition.effectiveFrom,
    revision: edition.revision,
    attribution: 'Airspace data © Avinor eAIP, used with permission. Non-commercial use only.',
    features
  };

  await mkdir('data', { recursive: true });
  // A classic-script sidecar: a file:// page can load this with <script src>,
  // which it cannot do with JSON.
  await writeFile(OUT_DATA,
    '// GENERATED by tools/build-aip.mjs - do not edit by hand.\n' +
    '// ' + dataset.attribution + '\n' +
    'window.C182_AIP = ' + JSON.stringify(dataset) + ';\n', 'utf8');
  await writeFile(OUT_REPORT, JSON.stringify(report, null, 2) + '\n', 'utf8');

  console.log(`\nwrote ${OUT_DATA}  ${features.length} airspace volumes`, byKind);
  console.log(`skipped ${report.skipped.length}:`, reasons);
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
