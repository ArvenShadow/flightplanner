#!/usr/bin/env node
/*
 * Avinor eAIP airspace extractor.
 *
 * Reads the OFFICIAL Norwegian eAIP (aim-prod.avinor.no) and emits the
 * planner's airspace data sidecars (data/airspace_*.js). Run manually once
 * per AIRAC cycle (28 days), review the diff, commit, bump the app version.
 *
 *   node tools/scrape_eaip.js            # fetch current AIRAC, write data/
 *   node tools/scrape_eaip.js --from-dir <dir>   # parse saved HTML instead
 *
 * The eAIP HTML is a structured database export: every value is wrapped as
 *   <span class="SD">700500N</span>
 *   <span class="sdParams">TAIRSPACE_VERTEX;GEO_LAT;8519</span>
 * so extraction reads typed fields, not free text. Verified facts this tool
 * relies on (checked Aug 2026):
 *   - ENR 5.1: one <tr> per area, 4 cells (id | name+lateral | vertical | rmk)
 *   - ENR 2.1: heading rows (1 cell), sector rows (5 cells:
 *     name?+lateral+vertical+class | unit | callsign/hours | freq | rmk),
 *     2-cell continuation rows carrying extra frequencies
 *   - geometry uses plain vertices and FULL circles only (no partial arcs);
 *     segments may follow national borders ("along the border between ...")
 *     which are flagged approxBorder and connected with a straight line.
 * If Avinor changes the format, the validation step fails loudly rather than
 * emitting silently wrong data.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const AIP_INDEX = 'https://aim-prod.avinor.no/no/AIP/';
const UA = { headers: { 'User-Agent': 'C182-FlightPlanner-airspace-tool (github.com/ArvenShadow/flightplanner)' } };

// ---------------------------------------------------------------- geometry

// "700500N" / "0185000E" (degrees-minutes-seconds, seconds optional) -> deg.
function parseAipCoord(latStr, lngStr) {
  const p = (s, isLat) => {
    const m = String(s).trim().match(isLat ? /^(\d{2})(\d{2})(\d{2}(?:\.\d+)?)?([NS])$/
                                           : /^(\d{3})(\d{2})(\d{2}(?:\.\d+)?)?([EW])$/);
    if (!m) return null;
    const deg = Number(m[1]) + Number(m[2]) / 60 + (m[3] ? Number(m[3]) / 3600 : 0);
    return (m[4] === 'S' || m[4] === 'W') ? -deg : deg;
  };
  const lat = p(latStr, true), lng = p(lngStr, false);
  if (lat === null || lng === null) return null;
  return { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) };
}

// Spherical destination point (standard great-circle formula) - accurate
// enough at any of the radii in the AIP (up to 39 NM annuli at 69N).
const EARTH_NM = 3440.065;
function destPoint(center, bearingDeg, distNM) {
  const la1 = center.lat * Math.PI / 180, lo1 = center.lng * Math.PI / 180;
  const brg = bearingDeg * Math.PI / 180, d = distNM / EARTH_NM;
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(brg));
  const lo2 = lo1 + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(la1),
                               Math.cos(d) - Math.sin(la1) * Math.sin(la2));
  return [Number((la2 * 180 / Math.PI).toFixed(6)), Number((lo2 * 180 / Math.PI).toFixed(6))];
}

// Full circle around a centre -> closed ring.
function discretizeCircle(center, radiusNM, n = 72) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(destPoint(center, (360 * i) / n, radiusNM));
  out.push(out[0].slice());
  return out;
}

// Pie slice (rInner=0) or annular sector between two TRUE bearings, swept
// clockwise from b1 to b2 -> closed ring.
function sectorRing(center, b1, b2, rInner, rOuter, stepDeg = 5) {
  if (b2 <= b1) b2 += 360;
  const outer = [], inner = [];
  for (let b = b1; b <= b2 + 1e-9; b += Math.min(stepDeg, b2 - b1 || stepDeg)) {
    outer.push(destPoint(center, b % 360, rOuter));
    if (rInner > 0) inner.push(destPoint(center, b % 360, rInner));
  }
  const ring = rInner > 0 ? outer.concat(inner.reverse())
                          : outer.concat([[Number(center.lat.toFixed(6)), Number(center.lng.toFixed(6))]]);
  ring.push(ring[0].slice());
  return ring;
}

// Free-text geometry used by some danger areas (the whole shape lives in one
// TAIRSPACE_VOLUME;CUSTOM_ATT27 string). Handles, in one string and in any
// combination: a leading vertex list, "A circle, radius R NM [centred on
// <coords>]", and "Sector B1° - B2° (T), radius R NM" / "radius R1 - R2 NM"
// (annulus). Returns a list of closed rings, or null.
function parseTextGeometry(str) {
  const s = String(str).replace(/\s+/g, ' ').trim();
  const coordRe = /(\d{6}(?:\.\d+)?[NS])\s+(\d{7}(?:\.\d+)?[EW])/g;
  const coords = [];
  let m;
  while ((m = coordRe.exec(s)) !== null) coords.push({ idx: m.index, c: parseAipCoord(m[1], m[2]) });
  if (!coords.length) return null;
  const rings = [];

  // vertex list = coordinates NOT owned by a "centred on" clause
  const centredIdx = new Set();
  const centredRe = /centred on\s+(\d{6}(?:\.\d+)?[NS])\s+(\d{7}(?:\.\d+)?[EW])/gi;
  while ((m = centredRe.exec(s)) !== null) {
    const c = coords.find(x => x.idx > m.index && x.idx < m.index + m[0].length + 2);
    if (c) centredIdx.add(c.idx);
  }
  const listCoords = coords.filter(x => !centredIdx.has(x.idx));
  // the FIRST coordinate doubles as the default centre for circle/sector
  const defCenter = listCoords.length ? listCoords[0].c : coords[0].c;
  const vertexList = listCoords.map(x => x.c);
  if (vertexList.length >= 3) {
    const ring = vertexList.map(c => [c.lat, c.lng]);
    ring.push(ring[0].slice());
    rings.push(ring);
  }

  const sectorRe = /Sector\s+(\d{1,3})°?\s*-\s*(\d{1,3})°?\s*\(T\),?\s*radius\s+([\d.]+)(?:\s*-\s*([\d.]+))?\s*NM/gi;
  while ((m = sectorRe.exec(s)) !== null) {
    const b1 = Number(m[1]), b2 = Number(m[2]);
    const rA = Number(m[3]), rB = m[4] !== undefined ? Number(m[4]) : null;
    rings.push(rB !== null ? sectorRing(defCenter, b1, b2, rA, rB)
                           : sectorRing(defCenter, b1, b2, 0, rA));
  }
  const circleRe = /circle,?\s*(?:with\s+)?radius\s+([\d.]+)\s*NM(?:\s*centred on\s+(\d{6}(?:\.\d+)?[NS])\s+(\d{7}(?:\.\d+)?[EW]))?/gi;
  while ((m = circleRe.exec(s)) !== null) {
    const ctr = m[2] ? parseAipCoord(m[2], m[3]) : defCenter;
    rings.push(discretizeCircle(ctr, Number(m[1])));
  }
  return rings.length ? rings : null;
}

// ------------------------------------------------------------ token walker

// Flatten a table cell into ordered tokens: typed SD values and the plain
// text between them (needed for "along the border ...", "Class C", etc.).
function cellTokens(td) {
  const tokens = [];
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {           // text node
        const t = child.textContent;
        if (t.trim()) tokens.push({ type: 'text', text: t });
        continue;
      }
      if (child.nodeType !== 1) continue;
      if (child.classList && child.classList.contains('SD')) {
        tokens.push({ type: 'value', value: child.textContent.trim() });
        continue;
      }
      if (child.classList && child.classList.contains('sdParams')) {
        const parts = child.textContent.trim().split(';');
        const last = tokens[tokens.length - 1];
        if (last && last.type === 'value' && !last.entity) {
          last.entity = parts[0]; last.field = parts[1]; last.rid = parts[2];
        }
        continue;
      }
      walk(child);
    }
  };
  walk(td);
  return tokens;
}

// Ordered tokens -> polygon coords plus border flags. Returns null when the
// cell has no usable geometry.
function tokensToGeometry(tokens) {
  const coords = [];
  let approxBorder = false;
  let borderNames = [];
  let pendingLat = null, pendingArcCenter = null;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'text') {
      if (/along the .{0,30}border|along the coast/i.test(t.text)) {
        approxBorder = true;
        const m = t.text.match(/border between ([^,.]+?)(?: to| -|$)/i);
        if (m) borderNames.push(m[1].trim());
      }
      continue;
    }
    if (t.field === 'GEO_LAT' && t.entity === 'TAIRSPACE_VERTEX') { pendingLat = t.value; continue; }
    if (t.field === 'GEO_LONG' && t.entity === 'TAIRSPACE_VERTEX' && pendingLat !== null) {
      const c = parseAipCoord(pendingLat, t.value);
      if (c) coords.push([c.lat, c.lng]);
      pendingLat = null;
      continue;
    }
    if (t.field === 'GEO_LAT_ARC') { pendingLat = t.value; pendingArcCenter = 'lat'; continue; }
    if (t.field === 'GEO_LONG_ARC' && pendingArcCenter === 'lat') {
      const c = parseAipCoord(pendingLat, t.value);
      pendingLat = null; pendingArcCenter = c;
      continue;
    }
    // "A circle with radius 1.0 NM" arrives as a CUSTOM_ATT27 value on the vertex
    if (t.entity === 'TAIRSPACE_VERTEX' && /circle with radius/i.test(t.value || '')) {
      const m = t.value.match(/radius\s+([\d.]+)\s*(NM|KM|M)\b/i);
      if (m && pendingArcCenter && pendingArcCenter !== 'lat') {
        let r = Number(m[1]);
        if (/km/i.test(m[2])) r = r / 1.852;
        else if (/^m$/i.test(m[2])) r = r / 1852;
        return { coords: discretizeCircle(pendingArcCenter, r), approxBorder: false, borderNames: [],
                 circle: { center: pendingArcCenter, radiusNM: Number(r.toFixed(3)) } };
      }
    }
  }
  if (coords.length < 3) return null;
  // close the ring (the eAIP repeats the first point in parentheses; if the
  // repeat was parsed we keep it, otherwise close explicitly)
  const [f, l] = [coords[0], coords[coords.length - 1]];
  if (f[0] !== l[0] || f[1] !== l[1]) coords.push(f.slice());
  return { coords, approxBorder, borderNames, circle: null };
}

// Vertical limit fields for one TAIRSPACE_VOLUME -> { upper, lower } with
// raw value/unit/datum kept verbatim (no guessing).
function tokensToLimits(tokens) {
  const lim = { upper: {}, lower: {} };
  for (const t of tokens) {
    if (t.entity !== 'TAIRSPACE_VOLUME') continue;
    const side = /UPPER$/.test(t.field || '') ? 'upper' : (/LOWER$/.test(t.field || '') ? 'lower' : null);
    if (!side) continue;
    if (t.field.startsWith('VAL_')) lim[side].val = t.value;
    if (t.field.startsWith('UOM_')) lim[side].uom = t.value;
    if (t.field.startsWith('CODE_')) lim[side].ref = t.value;
  }
  const fmt = s => [s.val, s.uom, s.ref].filter(Boolean).join(' ') || null;
  lim.upper.txt = fmt(lim.upper);
  lim.lower.txt = fmt(lim.lower);
  return lim;
}

function tokensText(tokens) {
  return tokens.map(t => (t.type === 'text' ? t.text : t.value)).join(' ').replace(/\s+/g, ' ').trim();
}

function classOf(tokens) {
  for (const t of tokens) {
    if (t.entity === 'TAIRSPACE_LAYER_CLASS' && t.field === 'CODE_CLASS') return t.value;
  }
  const m = tokensText(tokens).match(/Class ([A-G])\b/);
  return m ? m[1] : null;
}

function typeFromName(name) {
  for (const t of ['TMA', 'CTA', 'CTR', 'TIZ', 'TIA', 'FIZ', 'ATZ', 'FIR', 'OCEANIC']) {
    if (new RegExp('\\b' + t + '\\b', 'i').test(name)) return t === 'OCEANIC' ? 'FIR' : t;
  }
  return null;
}

// -------------------------------------------------------------- ENR 5.1

// One <tr> per area: [designator | name + lateral limits | vertical | remarks]
// The eAIP embeds BOTH sides of pending amendments; the deleted (old)
// content is class AmdtDeletedAIRAC and must not be parsed as data.
function docWithoutDeleted(html) {
  const doc = new JSDOM(html).window.document;
  doc.querySelectorAll('.AmdtDeletedAIRAC').forEach(el => el.remove());
  return doc;
}

function parseEnr51(html) {
  const doc = docWithoutDeleted(html);
  const areas = [];
  for (const tr of doc.querySelectorAll('tr')) {
    const cells = [...tr.children];
    if (cells.length < 3) continue;
    const t0 = cellTokens(cells[0]);
    const idTok = t0.find(t => t.entity === 'TAIRSPACE' && t.field === 'CODE_ID');
    if (!idTok) continue;
    const t1 = cellTokens(cells[1]);
    const nameTok = t1.find(t => t.entity === 'TAIRSPACE' && t.field === 'CUSTOM_ATT24');
    const geo = tokensToGeometry(t1);
    let polys = null, approxBorder = false, geomNote = null;
    if (geo) { polys = [geo.coords]; approxBorder = geo.approxBorder; }
    else {
      // sector/multi-shape danger areas carry their whole geometry as one
      // free-text TAIRSPACE_VOLUME;CUSTOM_ATT27 value
      const g = t1.find(t => t.entity === 'TAIRSPACE_VOLUME' && t.field === 'CUSTOM_ATT27'
                             && /Sector|circle/i.test(t.value || ''));
      if (g) { polys = parseTextGeometry(g.value); if (polys) geomNote = g.value.trim(); }
    }
    if (!polys) continue;   // header/empty rows
    const t2 = cellTokens(cells[2]);
    const id = idTok.value.replace(/\s+/g, ' ').trim();
    const kind = id.replace(/^EN\s*/, '')[0];
    areas.push({
      id,
      name: nameTok ? nameTok.value.trim() : id,
      type: kind === 'R' ? 'RESTRICTED' : (kind === 'D' ? 'DANGER' : 'PROHIBITED'),
      class: null,
      polys,
      approxBorder,
      geomNote,
      upper: tokensToLimits(t2).upper.txt,
      lower: tokensToLimits(t2).lower.txt,
      freqs: [],
      remarks: cells[3] ? tokensText(cellTokens(cells[3])).slice(0, 400) : ''
    });
  }
  return areas;
}

// -------------------------------------------------------------- ENR 2.1

// Heading rows (1 cell, e.g. "POLARIS FIR"), sector rows (5 cells), 2-cell
// frequency continuation rows for the airspace above.
function parseEnr21(html) {
  const doc = docWithoutDeleted(html);
  const areas = [];
  let heading = null, unnamedSeq = 0;
  for (const tr of doc.querySelectorAll('tr')) {
    const cells = [...tr.children];
    if (cells.length === 1) {
      const t = tokensText(cellTokens(cells[0]));
      if (t && t.length < 80) { heading = t; unnamedSeq = 0; }
      continue;
    }
    if (cells.length === 2 && areas.length) {   // extra frequency row
      const f = freqsOf(cellTokens(cells[0]).concat(cellTokens(cells[1])));
      areas[areas.length - 1].freqs.push(...f);
      continue;
    }
    if (cells.length < 4) continue;
    const t0 = cellTokens(cells[0]);
    const geo = tokensToGeometry(t0);
    if (!geo) continue;
    const nameTok = t0.find(t => t.entity === 'TAIRSPACE' && t.field === 'CUSTOM_ATT24');
    let name;
    if (nameTok) {
      // the plain text right after the name usually says "TMA" / "CTA" etc.
      const idx = t0.indexOf(nameTok);
      const after = t0.slice(idx + 1, idx + 3).filter(t => t.type === 'text').map(t => t.text.trim()).join(' ');
      name = (nameTok.value.trim() + ' ' + (after.match(/^[A-Za-z ]{2,12}/) ? after.split(/\d/)[0].trim() : '')).trim();
      unnamedSeq = 0;
    } else {
      unnamedSeq++;
      name = (heading || 'UNNAMED') + ' sector ' + unnamedSeq;
    }
    if (nameTok) heading = name;
    const type = typeFromName(name) || typeFromName(heading || '') || 'CTA';
    // FIR and oceanic control areas are continent-scale polygons - chart
    // noise for VFR planning, and their boundaries follow borders/meridians
    // we would only approximate. Deliberately excluded.
    if (type === 'FIR' || /\bOCA\b|Oceanic/i.test(name)) continue;
    const lim = tokensToLimits(t0);
    areas.push({
      id: null,
      name,
      type,
      class: classOf(t0),
      polys: [geo.coords],
      approxBorder: geo.approxBorder,
      geomNote: null,
      upper: lim.upper.txt,
      lower: lim.lower.txt,
      freqs: freqsOf(cells.slice(1).flatMap(c => cellTokens(c))),
      remarks: ''
    });
  }
  return areas;
}

function freqsOf(tokens) {
  const out = [];
  for (const t of tokens) {
    if (t.entity === 'TFREQUENCY' && t.field === 'VAL_FREQ_TRANS' && /^\d/.test(t.value)) {
      out.push(Number(t.value));
    }
  }
  return out.filter(v => v >= 108 && v <= 137);   // VHF airband only
}

// ------------------------------------------------------------- validation

function validate(areas, label) {
  const problems = [];
  for (const a of areas) {
    if (!a.polys || !a.polys.length) { problems.push(`${label} ${a.name}: no geometry`); continue; }
    for (const ring of a.polys) {
      // A ring of only 2 unique fixes is legitimate when the remaining side
      // follows a national border (e.g. Farris TMA's easternmost sliver).
      const minLen = a.approxBorder ? 3 : 4;
      if (!ring || ring.length < minLen) problems.push(`${label} ${a.name}: degenerate ring`);
      for (const [lat, lng] of (ring || [])) {
        if (!(lat > 50 && lat < 82.5 && lng > -10 && lng < 40))   // incl. Svalbard
          problems.push(`${label} ${a.name}: coordinate out of Norway bbox: ${lat},${lng}`);
      }
      const [f, l] = [ring[0], ring[ring.length - 1]];
      if (f[0] !== l[0] || f[1] !== l[1]) problems.push(`${label} ${a.name}: ring not closed`);
    }
  }
  return problems;
}

// ------------------------------------------------------------------ main

async function fetchText(url) {
  const resp = await fetch(url, UA);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  return resp.text();
}

async function discoverCycle() {
  // The AIP index redirects to .../Index/<pub>/history-no-NO.html which
  // links the current "<date>-AIRAC" folder.
  const resp = await fetch(AIP_INDEX, UA);
  const finalUrl = resp.url;
  const html = await resp.text();
  const m = html.match(/(\d{4}-\d{2}-\d{2})-AIRAC/);
  if (!m) throw new Error('could not find the current AIRAC on ' + finalUrl);
  const base = finalUrl.replace(/history.*$/, '') + m[1] + '-AIRAC/html/eAIP/';
  return { airac: m[1], base };
}

function emitSidecar(file, setId, airac, source, areas) {
  const payload = {
    set: setId,
    airac,
    fetched: new Date().toISOString().slice(0, 10),
    source,
    disclaimer: 'Extracted from the official Avinor eAIP for PLANNING support only. The current AIP and VFR chart remain authoritative. Border-following segments are drawn as straight approximations (approxBorder).',
    areas
  };
  const js = '// GENERATED by tools/scrape_eaip.js - do not edit by hand.\n'
    + 'window.AIRSPACE_SETS = window.AIRSPACE_SETS || [];\n'
    + 'window.AIRSPACE_SETS.push(' + JSON.stringify(payload) + ');\n';
  fs.writeFileSync(file, js);
  return js.length;
}

async function main() {
  const args = process.argv.slice(2);
  const dirIdx = args.indexOf('--from-dir');
  let airac, base, enr21html, enr51html, srcLabel;
  if (dirIdx >= 0) {
    const dir = args[dirIdx + 1];
    enr21html = fs.readFileSync(path.join(dir, 'enr21.html'), 'utf8');
    enr51html = fs.readFileSync(path.join(dir, 'enr51.html'), 'utf8');
    // The AIRAC is part of the eAIP URL, not the page body - pass it in when
    // parsing saved files: --airac 2026-06-11
    const aIdx = args.indexOf('--airac');
    airac = aIdx >= 0 ? args[aIdx + 1]
          : (enr21html.match(/(\d{4}-\d{2}-\d{2})-AIRAC/) || [null, 'unknown'])[1];
    srcLabel = 'https://aim-prod.avinor.no/no/AIP/ (' + airac + '-AIRAC) via local copy: ';
  } else {
    ({ airac, base } = await discoverCycle());
    console.log('current AIRAC:', airac);
    enr21html = await fetchText(base + 'EN-ENR-2.1-en-GB.html');
    enr51html = await fetchText(base + 'EN-ENR-5.1-en-GB.html');
    srcLabel = base;
  }

  const a21 = parseEnr21(enr21html);
  const a51 = parseEnr51(enr51html);
  const problems = [...validate(a21, 'ENR2.1'), ...validate(a51, 'ENR5.1')];
  console.log(`ENR 2.1: ${a21.length} areas | ENR 5.1: ${a51.length} areas | validation problems: ${problems.length}`);
  problems.slice(0, 10).forEach(p => console.log('  !', p));
  if (problems.length) { console.error('REFUSING to write sidecars with validation problems.'); process.exit(1); }
  if (a21.length < 30 || a51.length < 80) {
    console.error(`REFUSING: suspiciously few areas (format change?) - ENR2.1=${a21.length} ENR5.1=${a51.length}`);
    process.exit(1);
  }

  const outDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(outDir, { recursive: true });
  const s1 = emitSidecar(path.join(outDir, 'airspace_enr21.js'), 'ENR 2.1 (TMA/CTA)', airac, srcLabel + 'EN-ENR-2.1-en-GB.html', a21);
  const s2 = emitSidecar(path.join(outDir, 'airspace_enr51.js'), 'ENR 5.1 (P/R/D)', airac, srcLabel + 'EN-ENR-5.1-en-GB.html', a51);
  console.log(`wrote data/airspace_enr21.js (${(s1 / 1024).toFixed(0)} KB), data/airspace_enr51.js (${(s2 / 1024).toFixed(0)} KB)`);
}

module.exports = { parseAipCoord, discretizeCircle, destPoint, sectorRing, parseTextGeometry,
                   cellTokens, tokensToGeometry, tokensToLimits, parseEnr21, parseEnr51, validate, freqsOf, typeFromName };

if (require.main === module) {
  main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
}
