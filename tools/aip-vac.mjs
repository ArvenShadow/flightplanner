/**
 * VFR reporting points from the VAC text layer - tools/aip-vac.mjs
 *
 * THE PROBLEM. VFR reporting points are NOT in the eAIP HTML. That was
 * verified against ENDU's full 189-marker vocabulary: there is no reporting-
 * point marker on an AD 2 page. They exist only on the Visual Approach Chart.
 *
 * THE SOURCE, and why it is machine-readable after all. The VAC PDF is not a
 * scan - it carries a TEXT LAYER, and the chart prints a three-column table of
 * every significant point with its coordinates:
 *
 *     ELLA        690200N   0183820E
 *     ESPENES     690712N   0174249E
 *
 * `AD 2 <ICAO> 6-1 "Visual Approach Chart - ICAO"` in the AD 2.24 chart table
 * gives the graphic id; the PDF is at `<edition>/graphics/<id>.pdf` (NOT under
 * html/). So no transcription is needed and this scales to every aerodrome
 * whose VAC carries a text layer.
 *
 * THE PARSE RULE IS A COLUMN AND A FONT, NOT PROXIMITY. This is the whole
 * trick, and reading the nearest item to the left of the coordinate is WRONG:
 * the chart's own artwork overlaps the table, so between a point's name and
 * its latitude there are spot heights ("355", "1388"), tick glyphs and arrow
 * symbols. Measured over the 2026-06-11 edition, nearest-left lost the name on
 * 30 of 244 rows and returned chart symbology for 8 more.
 *
 * Instead the table is recovered from its own geometry: coordinate pairs are
 * clustered by page and x, and the name column is the (x, fontName)
 * combination that appears on the most rows of that cluster. One column, one
 * font, one table. That also disposes of the MOJIBAKE the earlier survey
 * warned about ("CHANGES: 0$*9$5"): some VACs draw symbols with a custom font
 * encoding that extracts as garbage, but it is always a DIFFERENT font from
 * the table's, so the font consensus excludes it structurally rather than by
 * blacklisting characters that happen to look wrong today.
 *
 * NOTHING IS GUESSED. A row with no name at the consensus column is refused
 * and reported. A cluster of fewer than MIN_TABLE_ROWS is not a table at all -
 * ENSG prints one stray coordinate on the chart face, and reading it as a
 * one-row table would invent a reporting point.
 *
 * Pure: no network, no PDF library, no DOM. The caller hands in the text items
 * ({str, x, y, page, font}); tools/build-vac.mjs does the fetching and the
 * text extraction.
 */

/** A latitude as the VAC prints it: DDMMSS then the hemisphere. */
const LAT_RE = /^(\d{2})(\d{2})(\d{2})([NS])$/;
/** A longitude: DDDMMSS then the hemisphere. */
const LNG_RE = /^(\d{3})(\d{2})(\d{2})([EW])$/;

/**
 * Two coordinate pairs make a table; one does not.
 *
 * ENSG's VAC prints a single coordinate on the chart face with no table at
 * all. A one-row "table" has no column consensus to speak of - whatever
 * happens to sit left of that coordinate becomes a reporting point - so the
 * cluster is refused by name instead.
 */
export const MIN_TABLE_ROWS = 2;

/** How far a name or coordinate may sit from its column, in PDF points.
 *  Measured: within a real column the x varies by at most 1.4 pt (the table is
 *  typeset, not hand-placed), and the nearest competing artwork is 17 pt away. */
export const COLUMN_TOLERANCE_PT = 2.5;

/**
 * A published point name, as the charts actually write them.
 *
 * Upper case, Norwegian letters, and the few separators that appear in real
 * names: "BJØRNØY LIGHT", "LANDEGO WEST", "RCF E", "BØKFJORD FYR",
 * "TJELDBERGODDEN", "COZIP". Anything else - a lower-case letter, a Unicode
 * replacement character, a stray "ó" from a symbol font - means the text layer
 * did not decode and the point is refused rather than shipped misspelt.
 *
 * @param {string} name @returns {boolean}
 */
export function isPlausibleName(name) {
  const s = String(name || '').trim();
  if (s.length < 2 || s.length > 24) return false;
  return /^[A-ZÆØÅ0-9][A-ZÆØÅ0-9 .\-/]*$/.test(s);
}

/**
 * A printed DMS coordinate, or null.
 *
 * Deliberately strict about the minute and second fields: 60 or more is not a
 * coordinate, it is a misread, and letting it through would place a point
 * roughly a mile from where the chart says it is.
 *
 * @param {string} text @returns {number|null}
 */
export function parsePrintedDms(text) {
  const s = String(text || '').trim();
  const m = LAT_RE.exec(s) || LNG_RE.exec(s);
  if (!m) return null;
  const deg = Number(m[1]), min = Number(m[2]), sec = Number(m[3]);
  if (min >= 60 || sec >= 60) return null;
  const v = deg + min / 60 + sec / 3600;
  if (m[4] === 'N' || m[4] === 'E') return v;
  return -v;
}

/** @param {string} s @returns {boolean} */
export function looksLikeLat(s) { return LAT_RE.test(String(s || '').trim()); }
/** @param {string} s @returns {boolean} */
export function looksLikeLng(s) { return LNG_RE.test(String(s || '').trim()); }

/** @param {number[]} a @returns {number} */
function median(a) {
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

/**
 * The chart's OWN printed graticule range - an independent check on the
 * coordinates, from a different part of the document than the table.
 *
 * The VAC labels its lat/lng grid on the sheet border ("69°00'N", "018°00'E").
 * A coordinate read out of the table must fall inside that range: if the table
 * parse had corrupted a digit the point would land off the sheet, and the
 * chart would have to be drawing a point it does not cover. Labels sit ON the
 * border lines, so one grid interval of slack is allowed on each side.
 *
 * @param {{str: string}[]} items
 * @returns {{south: number, north: number, west: number, east: number}|null}
 */
export function graticuleRange(items) {
  const lat = [], lng = [];
  for (const it of items || []) {
    const s = String(it.str || '').trim().replace(/[’′]/g, "'");
    let m = /^(\d{1,2})°(\d{2})'?([NS])$/.exec(s);
    if (m) { lat.push((Number(m[1]) + Number(m[2]) / 60) * (m[3] === 'N' ? 1 : -1)); continue; }
    m = /^(\d{1,3})°(\d{2})'?([EW])$/.exec(s);
    if (m) lng.push((Number(m[1]) + Number(m[2]) / 60) * (m[3] === 'E' ? 1 : -1));
  }
  if (lat.length < 2 || lng.length < 2) return null;
  // The grid on a 1:250 000-ish VAC is 30' of latitude and 1 degree of
  // longitude; one interval of slack on each side covers a point plotted
  // between the outermost label and the sheet edge.
  return {
    south: Math.min(...lat) - 0.5, north: Math.max(...lat) + 0.5,
    west: Math.min(...lng) - 1.0, east: Math.max(...lng) + 1.0
  };
}

/**
 * Every reporting-point table on a chart, recovered from the text layer.
 *
 * @param {{str: string, x: number, y: number, page: number, font: string}[]} items
 * @param {{lineTolerance?: number}} [opts]
 * @returns {{tables: {page: number, nameX: number, font: string,
 *            points: {name: string, lat: number, lng: number, rawLat: string, rawLng: string}[],
 *            unnamed: string[]}[],
 *           refused: {reason: string, detail: string}[]}}
 */
export function reportingPointTables(items, opts) {
  const lineTol = (opts && opts.lineTolerance) || 3;
  const all = (items || []).filter((i) => i && String(i.str || '').trim())
    .map((i) => ({ str: String(i.str).trim(), x: i.x, y: i.y, page: i.page, font: i.font }));

  // A row is a latitude with EXACTLY ONE longitude to its right on the same
  // line. Two candidates means the line is ambiguous and it is left alone.
  const pairs = [];
  for (const a of all) {
    if (!looksLikeLat(a.str)) continue;
    const cands = all.filter((b) => looksLikeLng(b.str) && b.page === a.page
      && Math.abs(b.y - a.y) <= lineTol && b.x > a.x && b.x - a.x < 80);
    if (cands.length === 1) pairs.push({ lat: a, lng: cands[0] });
  }

  // Cluster by page and latitude column: one chart may print two tables
  // (Bergen publishes two VAC sheets), and a stray coordinate on the chart
  // face is its own cluster and gets refused below.
  const clusters = [];
  for (const p of pairs) {
    let c = clusters.find((c) => c.page === p.lat.page
      && Math.abs(c.latX - p.lat.x) <= COLUMN_TOLERANCE_PT);
    if (!c) { c = { page: p.lat.page, latX: p.lat.x, rows: [] }; clusters.push(c); }
    c.rows.push(p);
  }

  const tables = [], refused = [];
  for (const c of clusters) {
    if (c.rows.length < MIN_TABLE_ROWS) {
      refused.push({
        reason: 'not-a-table',
        detail: `${c.rows.length} coordinate(s) at x ${c.latX.toFixed(1)} on page ${c.page}` +
          ` - fewer than ${MIN_TABLE_ROWS}, so there is no column to read a name from`
      });
      continue;
    }
    // THE NAME COLUMN: the (x, font) that appears on the most rows.
    const tally = new Map();
    for (const p of c.rows) {
      for (const b of all) {
        if (b.page !== p.lat.page || Math.abs(b.y - p.lat.y) > lineTol) continue;
        if (b.x >= c.latX - 4) continue;
        const k = Math.round(b.x) + '|' + b.font;
        if (!tally.has(k)) tally.set(k, { x: b.x, font: b.font, n: 0 });
        const t = tally.get(k); if (t) t.n++;
      }
    }
    const best = [...tally.values()].sort((a, b) => b.n - a.n)[0];
    if (!best) {
      refused.push({ reason: 'no-name-column', detail: `page ${c.page}: nothing is printed left of the coordinates` });
      continue;
    }
    const points = [], unnamed = [];
    for (const p of c.rows) {
      const parts = all.filter((b) => b.page === p.lat.page && Math.abs(b.y - p.lat.y) <= lineTol
        && b.font === best.font && Math.abs(b.x - best.x) <= COLUMN_TOLERANCE_PT)
        .sort((u, v) => u.x - v.x);
      if (!parts.length) { unnamed.push(`${p.lat.str} ${p.lng.str}`); continue; }
      const lat = parsePrintedDms(p.lat.str), lng = parsePrintedDms(p.lng.str);
      if (lat === null || lng === null) { unnamed.push(`${p.lat.str} ${p.lng.str}`); continue; }
      points.push({
        name: parts.map((x) => x.str).join(' ').replace(/\s+/g, ' ').trim(),
        lat, lng, rawLat: p.lat.str, rawLng: p.lng.str
      });
    }
    tables.push({ page: c.page, nameX: best.x, font: best.font, points, unnamed });
  }
  return { tables, refused };
}

/** Great-circle-ish distance in NM. Local scaling is ample here: it only
 *  bounds a point against its own aerodrome, never plans anything.
 *  @param {[number, number]} a @param {[number, number]} b @returns {number} */
export function roughNM(a, b) {
  const kx = Math.cos((a[0] + b[0]) / 2 * Math.PI / 180) * 60.04;
  return Math.hypot((a[0] - b[0]) * 60.04, (a[1] - b[1]) * kx);
}

/**
 * How far a reporting point may lie from its aerodrome's ARP.
 *
 * THIS IS A CORRUPTION GUARD, NOT A MEASURED TOLERANCE, and the difference
 * matters. The border work could pick 2 NM because the population split
 * cleanly in two with a 7x gap; here it does not. Measured over the
 * 2026-06-11 edition, all 244 points lie 0.7 to 30.0 NM from their ARP with a
 * smooth distribution (p50 8.3, p90 14.6), which is simply what a VAC covers -
 * there is no outlier group to cut off.
 *
 * So the bound is set at twice the observed maximum. It cannot reject real
 * data, and it still catches the failure it exists for: a misread digit moves
 * a point by a whole degree or flips a hemisphere, which is hundreds of miles.
 * The real per-point coordinate check is the graticule test above, which is
 * independent of the table parse.
 */
export const MAX_ARP_NM = 60;
