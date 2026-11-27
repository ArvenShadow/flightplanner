/**
 * NOTAMs - reading the relay's answer and laying a NOTAM out (v17.28).
 *
 * The planner cannot read a NOTAM source itself (no source allows a page on
 * another site to), so it asks the owner's own relay - relay/notam-relay.mjs -
 * which asks autorouter, which imports from Eurocontrol's EAD. This module is
 * the pure half: the request URL, a strict reading of the answer, and the
 * ICAO-format text of one NOTAM. The fetch and the card are in the page.
 *
 * FIELD NAMES are autorouter's, from the documented example at
 * https://www.autorouter.aero/wiki/api/notams/ - series, number, year, type,
 * fir, code23, code45, traffic, purpose, scope, lower, upper, lat, lon, radius,
 * itema, startvalidity, endvalidity, estimation, itemd, iteme, itemf, itemg.
 * That example is reproduced in the tests and must lay out as the page shows it.
 *
 * NOTHING HERE DECIDES ANYTHING. A NOTAM is shown, sorted and labelled with
 * when it applies; it never reaches the banner, the plan or the paper. Reading
 * free text to decide "the runway is closed" would be a guess.
 *
 * Pure: no DOM, no fetch.
 */

/** Locations in one request - the relay's own limit. */
export const NOTAM_MAX_LOCATIONS = 12;
/** autorouter's "no end" value for a validity (its documented default). */
export const NOTAM_NO_END = 4294967295;
/** What every list says about itself. */
export const NOTAM_SOURCE_NOTE = 'Unofficial copy via autorouter (source: Eurocontrol EAD), fetched live through your own relay. ' +
  'Not a briefing and not complete by guarantee - check ippc.no before flight.';

/** A relay address the planner will call: https, or http on localhost only.
 *  @param {any} v @returns {string} '' when not usable */
export function normaliseRelayUrl(v) {
  const s = String(v == null ? '' : v).trim().replace(/\/+$/, '');
  if (!s) return '';
  let u;
  try { u = new URL(s); } catch (e) { return ''; }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return '';
  if (u.search || u.hash || u.username || u.password) return '';
  return u.origin + u.pathname.replace(/\/+$/, '');
}

/** Four-letter location indicators, upper-cased, de-duplicated, capped.
 *  @param {any[]} list @returns {string[]} */
export function notamLocations(list) {
  /** @type {string[]} */ const out = [];
  for (const x of list || []) {
    const s = String(x || '').trim().toUpperCase();
    if (/^[A-Z]{4}$/.test(s) && !out.includes(s)) out.push(s);
  }
  return out.slice(0, NOTAM_MAX_LOCATIONS);
}

/** @param {string} base a normalised relay address @param {string[]} icaos @returns {string} */
export function notamRequestUrl(base, icaos) {
  return base + '/notam?icao=' + notamLocations(icaos).join(',');
}

/**
 * Read the relay's answer strictly. Anything not in the expected form throws,
 * so a broken answer is reported as a failed fetch and never shown as "no
 * NOTAMs" - an empty list is a claim, and it must be the relay's, not ours.
 * @param {any} body
 * @returns {{fetchedAtMs: number, requested: string[], total: number, truncated: boolean, rows: any[], source: string}}
 */
export function parseNotamResponse(body) {
  if (!body || typeof body !== 'object') throw new Error('the relay did not answer with JSON');
  if (typeof body.error === 'string') throw new Error(body.error);
  if (!Array.isArray(body.notams) || !Array.isArray(body.requested)) throw new Error('the relay\'s answer is not in the expected form');
  const at = Date.parse(body.fetchedAtUtc);
  if (!Number.isFinite(at)) throw new Error('the relay\'s answer carries no fetch time');
  const rows = body.notams.filter((/** @type {any} */ r) => r && typeof r === 'object' &&
    typeof r.iteme === 'string' && Number.isFinite(Number(r.startvalidity)));
  if (rows.length !== body.notams.length) throw new Error((body.notams.length - rows.length) + ' NOTAM(s) in the answer are not in the documented form');
  return { fetchedAtMs: at, requested: notamLocations(body.requested), total: Number(body.total) || rows.length,
    truncated: body.truncated === true || rows.length < (Number(body.total) || 0), rows,
    source: typeof body.source === 'string' ? body.source : 'relay' };
}

/** "P0825/17". @param {any} r @returns {string} */
export function notamId(r) {
  const series = String(r.series || '').trim();
  const n = Number(r.number), y = Number(r.year);
  if (!series || !Number.isFinite(n) || !Number.isFinite(y)) return '(no number)';
  return series + String(n).padStart(4, '0') + '/' + String(y % 100).padStart(2, '0');
}

/** autorouter's coordinate integers to degrees ("Garmin format: * 90 / (1 << 30)").
 *  @param {any} v @returns {number} */
export function garminToDeg(v) { return Number(v) * 90 / 1073741824; }

/** @param {number} sec seconds since the Unix epoch @returns {string} "2017-01-30 08:06" UTC */
function utcStamp(sec) {
  const d = new Date(sec * 1000);
  return d.toISOString().slice(0, 10) + ' ' + d.toISOString().slice(11, 16);
}

/** When a NOTAM applies. @param {any} r
 *  @returns {{fromMs: number, toMs: number|null, from: string, to: string}} toMs null = no end stated */
export function notamValidity(r) {
  const a = Number(r.startvalidity), b = Number(r.endvalidity);
  const open = !Number.isFinite(b) || b >= NOTAM_NO_END;
  return { fromMs: a * 1000, toMs: open ? null : b * 1000, from: utcStamp(a),
    to: open ? 'PERM' : utcStamp(b) + (r.estimation ? ' EST' : '') };
}

/** Is it in force during [startMs, endMs]? 'now' overlaps the window, 'later'
 *  starts after it, 'ended' finished before it.
 *  @param {any} r @param {number} startMs @param {number} endMs @returns {'now'|'later'|'ended'} */
export function notamPhase(r, startMs, endMs) {
  const v = notamValidity(r);
  if (v.toMs !== null && v.toMs < startMs) return 'ended';
  if (v.fromMs > endMs) return 'later';
  return 'now';
}

/** "4840N00912E" from the Q-line centre. @param {any} r @returns {string} '' when absent */
function qPosition(r) {
  if (r.lat == null || r.lon == null) return '';
  const lat = garminToDeg(r.lat), lon = garminToDeg(r.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '';
  const dm = (/** @type {number} */ v, /** @type {number} */ w) => {
    // Whole minutes, TRUNCATED: autorouter's own example lays 48.682N 9.2167E
    // out as 4840N00912E, and a Q-line position is a centre, not a fix.
    const a = Math.abs(v), d = Math.floor(a), m = Math.floor((a - d) * 60);
    return String(d).padStart(w, '0') + String(m).padStart(2, '0');
  };
  const rad = Number.isFinite(Number(r.radius)) ? String(Math.round(Number(r.radius))).padStart(3, '0') : '';
  return dm(lat, 2) + (lat < 0 ? 'S' : 'N') + dm(lon, 3) + (lon < 0 ? 'W' : 'E') + rad;
}

/**
 * One NOTAM as its ICAO-format lines: the Q line, A) B) C), D) where given,
 * E), and F) G) where given. Plain strings - the caller escapes them.
 * @param {any} r @returns {string[]}
 */
export function notamLines(r) {
  const v = notamValidity(r);
  const type = r.type === 'R' ? 'NOTAMR' : r.type === 'C' ? 'NOTAMC' : 'NOTAMN';
  const ref = (r.type === 'R' || r.type === 'C') && r.referredseries
    ? ' ' + notamId({ series: r.referredseries, number: r.referrednumber, year: r.referredyear }) : '';
  const lvl = (/** @type {any} */ x) => String(Math.max(0, Math.min(999, Math.round(Number(x) || 0)))).padStart(3, '0');
  const q = [String(r.fir || '').trim(), 'Q' + String(r.code23 || '').trim() + String(r.code45 || '').trim(),
    String(r.traffic || '').trim(), String(r.purpose || '').trim(), String(r.scope || '').trim(),
    lvl(r.lower), lvl(r.upper), qPosition(r)].filter((s, i) => i < 7 || s);
  const lines = [notamId(r) + ' ' + type + ref, 'Q) ' + q.join('/'),
    'A) ' + (Array.isArray(r.itema) ? r.itema.join(' ') : String(r.itema || '')) + '  B) ' + v.from + '  C) ' + v.to];
  if (r.itemd) lines.push('D) ' + String(r.itemd));
  lines.push('E) ' + String(r.iteme));
  if (r.itemf || r.itemg) lines.push('F) ' + String(r.itemf || '') + '  G) ' + String(r.itemg || ''));
  return lines;
}

/**
 * Group the NOTAMs by the requested location they name, each group ordered:
 * in force during the flight first, then starting later, then already ended;
 * newest first inside each. A NOTAM naming several requested locations is
 * listed under each. NOTAMs naming none of them (possible for a FIR request)
 * come last under ''.
 * @param {any[]} rows @param {string[]} requested @param {number} startMs @param {number} endMs
 * @returns {{icao: string, notams: {row: any, phase: 'now'|'later'|'ended'}[]}[]}
 */
export function groupNotams(rows, requested, startMs, endMs) {
  const rank = { now: 0, later: 1, ended: 2 };
  /** @type {Map<string, {row: any, phase: 'now'|'later'|'ended'}[]>} */
  const by = new Map(requested.map((i) => [i, []]));
  /** @type {{row: any, phase: 'now'|'later'|'ended'}[]} */ const other = [];
  for (const row of rows) {
    const item = { row, phase: notamPhase(row, startMs, endMs) };
    const where = (Array.isArray(row.itema) ? row.itema : [row.itema]).map((/** @type {any} */ s) => String(s || '').toUpperCase());
    const hit = requested.filter((i) => where.includes(i));
    if (!hit.length) other.push(item);
    for (const i of hit) /** @type {any[]} */ (by.get(i)).push(item);
  }
  const order = (/** @type {{row: any, phase: 'now'|'later'|'ended'}} */ a, /** @type {{row: any, phase: 'now'|'later'|'ended'}} */ b) =>
    rank[a.phase] - rank[b.phase] || Number(b.row.startvalidity) - Number(a.row.startvalidity);
  const out = requested.map((icao) => ({ icao, notams: /** @type {any[]} */ (by.get(icao)).sort(order) }));
  if (other.length) out.push({ icao: '', notams: other.sort(order) });
  return out;
}
