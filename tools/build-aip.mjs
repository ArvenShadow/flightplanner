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
import { borderPath, isForeignBorder, SNAP_TOLERANCE_NM } from './aip-border.mjs';

const CACHE = '.aip-cache';
const OUT_DATA = 'data/aip.js';
const OUT_REPORT = 'data/aip-report.json';
const BORDER_FILE = 'tools/prepared/norway-border.json';
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
 * Split one page's field stream into airspace blocks, and each block into its
 * SUB-VOLUMES.
 *
 * THE STRUCTURE, read off the source rather than assumed (this is what a first
 * version got wrong, and it produced 71 self-crossing polygons): a stepped
 * TMA is published as several sub-volumes, and EACH ONE HAS ITS OWN LATERAL
 * RING as well as its own vertical band and class. Document order is:
 *
 *   Alta  TMA                        <- TAIRSPACE;CUSTOM_ATT24 + untagged type
 *     <vertices of sub-volume 1>
 *     TAIRSPACE_VOLUME;...;1411      <- band of sub-volume 1
 *     TAIRSPACE_LAYER_CLASS;...      <- class of sub-volume 1
 *     <vertices of sub-volume 2>
 *     TAIRSPACE_VOLUME;...;1007
 *     ...
 *
 * So the vertices accumulated since the previous volume belong to the volume
 * that closes them. Concatenating a block's vertices into one ring merges
 * several separate lateral areas into a bow tie - the polygon crosses itself
 * and the airspace it draws does not exist.
 *
 * Frequencies, units and callsigns are stated once per block, after the
 * volumes, and apply to all of them.
 *
 * The numeric record ids are pairing keys within a block, not identities
 * across the document - the same id can recur - so they are never used as
 * feature ids.
 */
function airspaceBlocks(fields) {
  const blocks = [];
  let cur = null;
  /** vertices/border refs seen since the last volume closed */
  let pending = [];
  let volume = null;

  const closeVolume = () => { volume = null; };

  for (const f of fields) {
    if (f.record === 'TAIRSPACE' && f.field === 'CUSTOM_ATT24') {
      cur = { name: f.value, type: (f.after || '').trim(), volumes: [], outline: [], services: [] };
      blocks.push(cur);
      pending = []; volume = null;
      continue;
    }
    if (!cur) continue;

    if (f.record === 'TAIRSPACE' && f.field === 'TXT_LOCAL_TYPE') { cur.type = f.value || cur.type; continue; }

    if (f.record === 'TGEO_BORDER' && f.field === 'TXT_NAME') {
      pending.push({ kind: 'border', name: f.value });
      cur.outline.push(pending[pending.length - 1]);
      continue;
    }
    if (f.record === 'TAIRSPACE_VERTEX') {
      // A vertex after a volume closed starts the NEXT sub-volume's ring.
      if (volume) closeVolume();
      const last = pending[pending.length - 1];
      if (f.field === 'GEO_LAT') {
        pending.push({ kind: 'vertex', id: f.id, lat: f.value, lng: null });
        cur.outline.push(pending[pending.length - 1]);   // same objects, block order
      }
      else if (f.field === 'GEO_LONG' && last && last.kind === 'vertex' && last.lng === null) last.lng = f.value;
      continue;
    }
    if (f.record === 'TAIRSPACE_VOLUME') {
      if (!volume || volume.id !== f.id) {
        volume = { id: f.id, outline: pending, fields: {}, class: null };
        cur.volumes.push(volume);
        pending = [];
      }
      volume.fields[f.field] = f.value;
      continue;
    }
    if (f.record === 'TAIRSPACE_LAYER_CLASS' && f.field === 'CODE_CLASS') {
      // The class row follows the volume it belongs to.
      if (volume && volume.class === null) volume.class = f.value;
      continue;
    }

    // ---- ATS communication, kept AS SERVICES rather than a flat list ----
    //
    // The source publishes service, then callsign, then that service's
    // frequencies, then the next service. AD 2.18 tags the service explicitly
    // (TSERVICE;CODE_TYPE = APP / TWR / ATIS / AFIS / SMC / CLR / RADIO);
    // ENR 2.1 and 2.2 do NOT - they give only a callsign, which is
    // self-describing ("Banak Approach", "Longyear Information"), so the code
    // is derived from it there and left null if it does not match.
    //
    // Flattening these into one frequency list, as v16.31 did, loses the one
    // thing that makes them usable: which frequency is the tower and which is
    // a military UHF channel.
    if (f.record === 'TSERVICE' && f.field === 'CODE_TYPE') {
      cur.services.push({ code: f.value.toUpperCase(), callsign: null, freqs: [] });
      continue;
    }
    if (f.record === 'TCALLSIGN_DETAIL' && f.field === 'CUSTOM_ATT7') {
      const open = cur.services[cur.services.length - 1];
      if (open && open.callsign === null && !open.freqs.length) open.callsign = f.value;
      else cur.services.push({ code: null, callsign: f.value, freqs: [] });
      continue;
    }
    if (f.record === 'TFREQUENCY') {
      let svc = cur.services[cur.services.length - 1];
      if (!svc) { svc = { code: null, callsign: null, freqs: [] }; cur.services.push(svc); }
      if (f.field === 'VAL_FREQ_TRANS') { svc.freqs.push({ id: f.id, mhz: f.value, unit: '', remarks: '' }); continue; }
      // UOM and the remark arrive after the value, keyed by the same id.
      const q = svc.freqs.find((x) => x.id === f.id);
      if (!q) continue;
      if (f.field === 'UOM_FREQ') q.unit = f.value;
      // CUSTOM_ATT27 is the published remark. It carries 'MIL' on a military
      // channel - though NOT on every one of them, so the VHF band is what
      // actually keeps military UHF out; see src/lib/airspace.js.
      else if (f.field === 'CUSTOM_ATT27') q.remarks = f.value;
      continue;
    }
  }
  return blocks;
}

/**
 * The published ring, with any national-border stretch expanded from
 * Kartverket's prepared boundary - or a reason it cannot be drawn.
 *
 * A border reference means "from the previous published fix, ALONG THIS
 * BORDER, to the next one". So the outline is walked in order: a vertex
 * contributes its point, a border item contributes the boundary between its
 * two neighbours. Nothing is ever joined with a straight line to stand in for
 * a border - if the border cannot be resolved the whole airspace is refused.
 */
function ringOf(outline, label, border, report) {
  const pts = [];
  /** @type {{name: string, snapFromNM: number, snapToNM: number, lengthNM: number}[]} */
  const resolved = [];
  const push = (p) => {
    const prev = pts[pts.length - 1];
    if (prev && prev[0] === p[0] && prev[1] === p[1]) return;
    pts.push(p);
  };
  const at = (i) => {
    const item = outline[i];
    if (!item || item.kind !== 'vertex') return null;
    const lat = parseDms(item.lat), lng = parseDms(item.lng || '');
    if (lat === null || lng === null) return null;
    return [Number(lat.toFixed(6)), Number(lng.toFixed(6))];
  };

  for (let i = 0; i < outline.length; i++) {
    const item = outline[i];
    if (item.kind === 'vertex') {
      const p = at(i);
      if (!p) return { skip: 'unparsable-coordinate', detail: `${item.lat} ${item.lng}` };
      push(p);
      continue;
    }
    // a border stretch between the fix before it and the fix after it
    const from = at(i - 1), to = at(i + 1);
    if (!from || !to) {
      return { skip: 'border-reference-without-two-fixes', detail: item.name };
    }
    if (isForeignBorder(item.name)) {
      // Kartverket publishes NORWAY's border. A Finland-Sweden stretch is not
      // in it, and snapping to the nearest Norwegian border instead would be
      // a silent, confident error.
      return { skip: 'foreign-border-reference', detail: `${item.name} is not in Norway's national-border dataset` };
    }
    if (!border) {
      return { skip: 'national-border-reference', detail: `${item.name} (no prepared boundary - run npm run build:border)` };
    }
    const path = borderPath(border.line, from, to);
    if ('refuse' in path) {
      return { skip: path.refuse, detail: `${item.name}: ${path.detail}` };
    }
    // borderPath returns from..to inclusive; `from` is already pushed and the
    // loop will push `to` when it reaches that vertex.
    for (const p of path.points.slice(1, -1)) push(p);
    resolved.push({ name: item.name, snapFromNM: path.snapFromNM, snapToNM: path.snapToNM, lengthNM: path.lengthNM });
  }

  if (pts.length > 1) {
    const a = pts[0], z = pts[pts.length - 1];
    if (a[0] === z[0] && a[1] === z[1]) pts.pop();
  }
  if (pts.length < 3) return { skip: 'insufficient-coordinates', detail: pts.length + ' points' };
  const maxSnap = resolved.length
    ? Math.max(...resolved.map((r) => Math.max(r.snapFromNM, r.snapToNM))) : 0;
  if (resolved.length) {
    report.borderResolved.push({ name: label, maxSnapNM: Number(maxSnap.toFixed(3)), segments: resolved });
  }
  return { ring: pts, borderSegments: resolved.length, maxSnapNM: Number(maxSnap.toFixed(3)) };
}

/**
 * The service code implied by a published callsign, for the sections that do
 * not tag one (ENR 2.1 and 2.2).
 *
 * This reads a published NAME to pick a LABEL - it never invents a value. An
 * unrecognised callsign yields null and the card then shows the callsign
 * alone rather than guessing at a service.
 *
 * @param {string|null} callsign @returns {string|null}
 */
function codeFromCallsign(callsign) {
  const t = String(callsign || '');
  if (/\bApproach\b|\bRadar\b|\bDirector\b/i.test(t)) return 'APP';
  if (/\bTower\b/i.test(t)) return 'TWR';
  if (/\bInformation\b/i.test(t)) return 'AFIS';
  if (/\bControl\b/i.test(t)) return 'ACC';
  if (/\bRadio\b/i.test(t)) return 'RADIO';
  if (/\bTraffic\b/i.test(t)) return 'TFC';
  return null;
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

/**
 * Split an outline into closed rings.
 *
 * A PUBLISHED RING CLOSES BY REPEATING ITS OWN FIRST VERTEX - that repeat is
 * the source's own delimiter, not a heuristic. Verified across the whole
 * edition: for 143 of 144 airspace blocks, splitting on closure yields exactly
 * as many rings as the block has volumes.
 *
 * This is needed because AD 2.17 uses the OPPOSITE layout to ENR 2.1: it lists
 * every ring first and then every volume, so the per-volume association below
 * leaves all but the first volume with no vertices at all. Notodden TIZ is the
 * case that exposed it - 21 vertices and 3 volumes, which without this rule
 * became one ring crossing itself 35 times.
 *
 * @param {{kind: string, lat?: string, lng?: string|null, name?: string}[]} items
 * @returns {typeof items[]}
 */
function splitRings(items) {
  const rings = [];
  let cur = [], first = null;
  for (const it of items) {
    if (it.kind !== 'vertex') { cur.push(it); continue; }
    const key = `${it.lat} ${it.lng}`;
    if (!cur.length) { first = key; cur.push(it); continue; }
    if (key === first) { rings.push(cur); cur = []; first = null; continue; }
    cur.push(it);
  }
  if (cur.length) rings.push(cur);
  return rings;
}

function buildFeatures(blocks, source, report, border) {
  const out = [];
  // The eAIP restates a few volumes verbatim. Drawing one twice double-darkens
  // the polygon and shows two airspaces where there is one.
  const seen = new Set();

  for (const b of blocks) {
    const kind = kindOf(b.type, b.name);
    const label = `${b.name} ${b.type}`.trim();
    if (NOT_DRAWN.has(kind)) {
      report.skipped.push({ name: label, kind, reason: 'not-a-vfr-planning-airspace', source });
      continue;
    }
    if (!b.volumes.length) {
      report.skipped.push({ name: label, kind, reason: 'no-published-vertical-limits', source });
      continue;
    }

    // AD 2.17 layout: every ring is listed before any volume, so the
    // per-volume walk gave volume 1 everything and the rest nothing. Recover
    // by splitting the block's outline on ring closure - but ONLY when a
    // volume really came back empty, so the ENR 2.1 layout (which states each
    // volume's own vertices, and is the document's own association) is never
    // second-guessed.
    if (b.volumes.length > 1 && b.volumes.some((v) => !v.outline.length)) {
      const rings = splitRings(b.outline);
      if (rings.length === b.volumes.length) {
        b.volumes.forEach((v, i) => { v.outline = rings[i]; });
      } else {
        report.skipped.push({
          name: label, kind, reason: 'rings-do-not-match-volumes',
          detail: `${rings.length} published ring(s) for ${b.volumes.length} volume(s) - not guessing which is which`,
          source
        });
        continue;
      }
    }

    const services = b.services
      .map((sv) => ({
        code: sv.code || codeFromCallsign(sv.callsign),
        callsign: sv.callsign || null,
        freqs: sv.freqs.map((q) => ({
          mhz: String(q.mhz || '').trim(),
          unit: String(q.unit || '').trim(),
          remarks: String(q.remarks || '').trim()
        })).filter((q) => q.mhz)
      }))
      .filter((sv) => sv.freqs.length || sv.callsign);

    const multi = b.volumes.length > 1;

    for (const v of b.volumes) {
      const lower = verticalLimit(v.fields.VAL_DIST_VER_LOWER, v.fields.UOM_DIST_VER_LOWER, v.fields.CODE_DIST_VER_LOWER);
      const upper = verticalLimit(v.fields.VAL_DIST_VER_UPPER, v.fields.UOM_DIST_VER_UPPER, v.fields.CODE_DIST_VER_UPPER);
      if (!lower.text && !upper.text) continue;
      const band = [lower.text, upper.text].filter(Boolean).join(' - ');
      const name = label + (multi && band ? ` (${band})` : '');

      // EACH sub-volume has its own lateral ring.
      const geom = ringOf(v.outline, name, border, report);
      if (geom.skip) {
        report.skipped.push({ name, kind, reason: geom.skip, detail: geom.detail, source });
        continue;
      }

      const key = name + '|' + band + '|' + JSON.stringify(geom.ring);
      if (seen.has(key)) { report.duplicatesDropped = (report.duplicatesDropped || 0) + 1; continue; }
      seen.add(key);

      out.push({
        name,
        kind,
        class: v.class || null,
        lower, upper,
        ring: geom.ring,
        borderSegments: geom.borderSegments || 0,
        // How far the published corner sat from Kartverket's surveyed border.
        // Recorded so the shape can be audited instead of trusted.
        borderMaxSnapNM: geom.maxSnapNM || 0,
        services,
        // The ICAO of the AD 2 page this came from, where there is one. ENR 2.1
        // airspace spans aerodromes and has none.
        icao: source.icao || null,
        source
      });
    }
  }
  return out;
}

async function main() {
  const edition = await discoverEdition();
  console.log(`edition ${edition.editionLabel}  index ${edition.index}  effective ${edition.effectiveFrom}  ${edition.revision || ''}`);

  /** The prepared Kartverket boundary. Absent is not fatal - the airspaces
   *  that need it are then reported as absent, exactly as before. */
  const border = await readFile(BORDER_FILE, 'utf8').then(JSON.parse).catch(() => null);
  if (border) {
    console.log(`border: ${border.points} points, ${border.provider}, retrieved ${border.retrievedAtUtc.slice(0, 10)}`);
  } else {
    console.log('border: NOT PREPARED - run `npm run build:border`; border-referenced airspaces will be omitted');
  }

  const report = {
    provider: 'Avinor', source: 'eAIP',
    editionLabel: edition.editionLabel,
    effectiveFrom: edition.effectiveFrom,
    revision: edition.revision,
    indexUrl: edition.indexUrl,
    retrievedAtUtc: new Date().toISOString(),
    permission: 'Used with permission from Avinor AS. Non-commercial use only.',
    border: border ? {
      provider: border.provider, attribution: border.attribution,
      retrievedAtUtc: border.retrievedAtUtc, points: border.points,
      snapToleranceNM: SNAP_TOLERANCE_NM
    } : null,
    counts: {}, skipped: [], borderResolved: [], pages: []
  };

  const features = [];
  const pages = [
    ['EN-ENR-2.1', 'ENR 2.1'],
    ['EN-ENR-2.2', 'ENR 2.2']
  ];
  // AD 2.17 carries each aerodrome's own CTR / TIZ.
  const ad13 = await page(edition, 'EN-AD-1.3');
  const icaos = [...new Set((ad13.match(/\bEN[A-Z]{2}\b/g) || []))].sort();
  for (const icao of icaos) pages.push([`EN-AD-2.${icao}`, `AD 2.17 ${icao}`, icao]);

  for (const [file, label, icao] of pages) {
    let html;
    try { html = await page(edition, file); }
    catch (err) { report.pages.push({ page: label, error: String(err.message || err) }); continue; }
    const fields = extractFields(html);
    const blocks = airspaceBlocks(fields);
    const url = `${edition.base}/${file}-en-GB.html`;
    const built = buildFeatures(blocks, { section: label, url, icao: icao || null }, report, border);
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
    attribution: 'Airspace data © Avinor eAIP, used with permission. Non-commercial use only.' +
      (border ? ' National border © Kartverket (NLOD).' : ''),
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
  console.log(`border-resolved airspaces: ${report.borderResolved.length}`);
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
