/**
 * Aerodrome ATS operational hours - src/lib/opshours.js (v17.0).
 *
 * SOURCE: Avinor's "Operational Hours" publication, the table AD 2.3 of every
 * aerodrome points at ("REF AIS Portal www.avinor.no/ais" - 49 of 53 AD 2
 * pages carry no hours themselves). tools/build-hours.mjs imports its ATS
 * table at build time, by AIRAC, into data/aip.js as the published TEXT; this
 * module is the one reader of that text.
 *
 * THE NOTATION IS READ STRICTLY, AND ANYTHING OUTSIDE IT IS REFUSED - the METAR
 * rule (v16.21): the raw text is always shown in full, and only what cannot be
 * misread is decoded. The grammar, measured over the whole table:
 *
 *     H24
 *     No ATS provided / No ATS service provided
 *     O/R
 *     DAYS: SPEC, DAYS: SPEC, ...     DAYS = MON | MON - FRI
 *                                     SPEC = NIL | CLSD | CLOSED
 *                                          | HHMM - HHMM (HHMM - HHMM) [/ ...]
 *
 * The figure outside the brackets is UTC with reference to WINTER time, the one
 * inside it UTC with reference to SUMMER time (the page says so). Every one of
 * the 132 pairs in the 2026-09-03 table is exactly an hour apart, so that is
 * REQUIRED: a pair that is not means the text was not read the way it was
 * written, and the whole aerodrome is refused rather than half-decoded.
 *
 * REFUSED, and shown raw, measured at 2026-09-03: ENRY (hours by week number),
 * ENOL (separate TWR and APP hours), ENAS (prose), ENHV (a published "13:30").
 * Every day must be stated exactly once, or the schedule is refused: a day the
 * text does not mention is not a day the aerodrome is closed.
 *
 * Pure: no DOM, no fetch.
 */

export const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

/**
 * @typedef {{kind: 'h24'} | {kind: 'none'} | {kind: 'or'}
 *   | {kind: 'schedule', winter: number[][][], summer: number[][][]}
 *   | {kind: 'unparsed', reason: string}} AtsHours
 * A schedule is indexed by DAYS (0 = MON); each day is a list of [from, to]
 * minutes after 00:00 UTC.
 */

/** @param {string} s @returns {number|null} minutes, or null for a malformed HHMM */
function hhmm(s) {
  if (!/^\d{4}$/.test(s)) return null;
  const h = Number(s.slice(0, 2)), m = Number(s.slice(2));
  if (h > 24 || m > 59 || (h === 24 && m !== 0)) return null;
  return h * 60 + m;
}

/**
 * Decode one published ATS hours text.
 * @param {unknown} raw
 * @returns {AtsHours}
 */
export function parseAtsHours(raw) {
  const text = String(raw === null || raw === undefined ? '' : raw).replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
  if (!text) return { kind: 'unparsed', reason: 'no hours published' };
  if (text === 'H24') return { kind: 'h24' };
  if (/^No ATS( service)? provided\.?$/i.test(text)) return { kind: 'none' };
  if (text === 'O/R') return { kind: 'or' };
  /** @type {number[][][]} */
  const winter = DAYS.map(() => /** @type {number[][]} */ ([]));
  /** @type {number[][][]} */
  const summer = DAYS.map(() => /** @type {number[][]} */ ([]));
  const seen = DAYS.map(() => false);
  const groups = text.split(/,\s*(?=(?:MON|TUE|WED|THU|FRI|SAT|SUN)\b)/);
  for (const g of groups) {
    const m = g.match(/^(MON|TUE|WED|THU|FRI|SAT|SUN)(?:\s*-\s*(MON|TUE|WED|THU|FRI|SAT|SUN))?\s*:\s*(.+)$/);
    if (!m) return { kind: 'unparsed', reason: 'not in the day-and-hours notation: "' + g + '"' };
    const a = DAYS.indexOf(m[1]), b = m[2] ? DAYS.indexOf(m[2]) : a;
    if (b < a) return { kind: 'unparsed', reason: 'a day range runs backwards: ' + m[1] + ' - ' + m[2] };
    const spec = m[3].trim();
    /** @type {number[][]} */
    const w = [], su = [];
    if (!/^(NIL|CLSD|CLOSED)$/.test(spec)) {
      for (const part of spec.split(/\s*\/\s*/)) {
        const t = part.match(/^(\d{4})\s*-\s*(\d{4})\s*\(\s*(\d{4})\s*-\s*(\d{4})\s*\)$/);
        if (!t) return { kind: 'unparsed', reason: 'not an HHMM - HHMM (HHMM - HHMM) pair: "' + part + '"' };
        const [w0, w1, s0, s1] = [hhmm(t[1]), hhmm(t[2]), hhmm(t[3]), hhmm(t[4])];
        if (w0 === null || w1 === null || s0 === null || s1 === null) return { kind: 'unparsed', reason: 'not a clock time: "' + part + '"' };
        if (w1 <= w0 || s1 <= s0) return { kind: 'unparsed', reason: 'a period ends before it starts: "' + part + '"' };
        if (w0 - s0 !== 60 || w1 - s1 !== 60) return { kind: 'unparsed', reason: 'the summer time is not the winter time less an hour: "' + part + '"' };
        w.push([w0, w1]); su.push([s0, s1]);
      }
    }
    for (let d = a; d <= b; d++) {
      if (seen[d]) return { kind: 'unparsed', reason: DAYS[d] + ' is stated twice' };
      seen[d] = true;
      winter[d] = w.map((x) => x.slice()); summer[d] = su.map((x) => x.slice());
    }
  }
  const missing = DAYS.filter((_, i) => !seen[i]);
  if (missing.length) return { kind: 'unparsed', reason: 'no hours stated for ' + missing.join(', ') };
  return { kind: 'schedule', winter, summer };
}

/**
 * Whether Norway is on summer time at an instant: UTC+2 (CEST) is summer, UTC+1
 * (CET) winter. Read from the platform's own Europe/Oslo rules rather than
 * computed from a last-Sunday rule written here. Null when the platform has no
 * time-zone data, which is then said rather than guessed.
 * @param {number} ms
 * @returns {'summer'|'winter'|null}
 */
export function norwaySeason(ms) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', timeZoneName: 'shortOffset' })
      .formatToParts(new Date(ms));
    const tz = (parts.find((p) => p.type === 'timeZoneName') || { value: '' }).value;
    if (/GMT\+2\b/.test(tz)) return 'summer';
    if (/GMT\+1\b/.test(tz)) return 'winter';
    return null;
  } catch (e) { return null; }
}

/** @param {number} min @returns {string} "0715" */
function hm(min) {
  return String(Math.floor(min / 60)).padStart(2, '0') + String(min % 60).padStart(2, '0');
}

/**
 * Is ATS open at this instant? The published times are UTC and so is the day
 * they belong to, so both are read in UTC. An instant exactly at the edge of a
 * period counts as inside it.
 *
 *   open: true | false - decided by a decoded schedule, or H24
 *   open: null         - not decidable here: no ATS, on request, refused text,
 *                        or no time-zone data; `why` says which
 *
 * @param {AtsHours} h
 * @param {number} ms
 * @returns {{open: boolean|null, why: string, window: string, season: 'summer'|'winter'|null}}
 */
export function atsOpenAt(h, ms) {
  if (!h || !Number.isFinite(ms)) return { open: null, why: 'no time', window: '', season: null };
  if (h.kind === 'h24') return { open: true, why: 'H24', window: 'H24', season: null };
  if (h.kind === 'none') return { open: null, why: 'no ATS is provided', window: '', season: null };
  if (h.kind === 'or') return { open: null, why: 'ATS on request only', window: '', season: null };
  if (h.kind === 'unparsed') return { open: null, why: 'the published hours could not be read (' + h.reason + ')', window: '', season: null };
  const season = norwaySeason(ms);
  if (!season) return { open: null, why: 'this browser has no time-zone data for Norway', window: '', season: null };
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7;
  const t = d.getUTCHours() * 60 + d.getUTCMinutes();
  const periods = (season === 'summer' ? h.summer : h.winter)[day];
  const window = DAYS[day] + ' ' + (periods.length ? periods.map((p) => hm(p[0]) + '-' + hm(p[1])).join(' / ') + ' UTC' : 'closed');
  return { open: periods.some((p) => t >= p[0] && t <= p[1]), why: '', window, season };
}

/** A remark that says public holidays are not covered by the published hours. @param {unknown} rmk */
export function holidaysExcluded(rmk) {
  return /\b(public )?hol(iday)?s?\b.*\bexcl/i.test(String(rmk || '')) || /\bEXC\s+hol/i.test(String(rmk || ''));
}
