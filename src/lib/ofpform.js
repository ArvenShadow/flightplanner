/**
 * The company OFP form (UiT "Operational flightplan", C182OFPMBv4.2.pdf page 1)
 * as data: its columns, and a flight's rows laid onto its 16 lines.
 *
 * WHY THIS IS A MODULE AND NOT MARKUP IN THE PAGE: the form is a fixed grid the
 * flight school prints on, so what goes in which cell is a specification, not a
 * styling detail, and it is worth testing without a browser.
 *
 * THE GEOMETRY LIVES IN ofppdf.js since v16.97, in PDF points, beside the
 * code that writes into the form. This module is only WHAT goes in which cell.
 *
 * THE GROUP HEADERS SETTLE THE ONE AMBIGUITY, and they were measured the same
 * way. "ACC" spans Dist+Time and "Intermediate" spans GS+Dist+Time, which on
 * its own could be read either way round - but the Fuel group spells the
 * vocabulary out by carrying BOTH "Int" and "Acc" over the same three columns.
 * So Int(ermediate) is this leg and ACC is the running total. Nothing here is
 * inferred from the English words alone.
 *
 * WHAT IS DELIBERATELY LEFT BLANK, because filling it would be a guess:
 *   - MSA. Terrain data is out of scope by an explicit decision; the chart's
 *     contours and MEF are the reference, and the pilot writes it from there.
 *   - ATO, Diff, ACT, and the block/take-off/landing times. These are ACTUALS,
 *     recorded in flight. This is a ground-planning tool.
 *   - Freq. The AIP frequencies are per airspace, not per leg; picking one for
 *     a leg would be a plausible wrong answer.
 *   - The alternate row, crew and passengers. Not planned here, and crew names
 *     are personal data this project keeps out of everything it generates.
 *
 * No DOM, no I/O.
 */

/** The form's 16 numbered lines. A flight with more legs runs onto a second
 *  sheet, exactly as the paper form is used. */
export const OFP_ROWS_PER_SHEET = 16;

/**
 * The 25 columns, in form order.
 *  - `key` is the field of a row object built by the page.
 *  - `group` is the header the form prints above it, or null.
 *  - `totalKey` names the value the Total line carries; the form HATCHES every
 *    other cell on that line, and those stay hatched here.
 * @type {{key: string, label: string, group: string|null, totalKey: string|null}[]}
 */
export const OFP_COLUMNS = [
  { key: 'from',     label: 'From',    group: null,             totalKey: 'label' },
  { key: 'tas',      label: 'TAS',     group: null,             totalKey: null },
  { key: 'tt',       label: 'TT',      group: null,             totalKey: null },
  { key: 'var',      label: 'VAR',     group: null,             totalKey: null },
  { key: 'mt',       label: 'MT',      group: null,             totalKey: null },
  { key: 'wv',       label: 'Dir/Vel', group: 'WIND',           totalKey: null },
  { key: 'wca',      label: 'WCA',     group: 'WIND',           totalKey: null },
  { key: 'accDist',  label: 'Dist',    group: 'ACC',            totalKey: 'dist' },
  { key: 'accTime',  label: 'Time',    group: 'ACC',            totalKey: 'time' },
  { key: 'ff',       label: 'FF',      group: 'Fuel',           totalKey: null },
  { key: 'legBurn',  label: 'Int',     group: 'Fuel',           totalKey: null },
  { key: 'accBurn',  label: 'Acc',     group: 'Fuel',           totalKey: 'burn' },
  { key: 'to',       label: 'To',      group: null,             totalKey: 'label' },
  { key: 'msa',      label: 'MSA',     group: 'Altitude',       totalKey: null },
  { key: 'pl',       label: 'PL',      group: 'Altitude',       totalKey: null },
  { key: 'mh',       label: 'MH',      group: null,             totalKey: null },
  { key: 'gs',       label: 'GS',      group: 'Intermediate',   totalKey: null },
  { key: 'dist',     label: 'Dist',    group: 'Intermediate',   totalKey: null },
  { key: 'time',     label: 'Time',    group: 'Intermediate',   totalKey: 'time' },
  { key: 'eto',      label: 'ETO',     group: 'Time',           totalKey: null },
  { key: 'ato',      label: 'ATO',     group: 'Time',           totalKey: null },
  { key: 'diff',     label: 'Diff',    group: 'Time',           totalKey: null },
  { key: 'estRem',   label: 'EST',     group: 'Fuel remaining', totalKey: 'rem' },
  { key: 'actRem',   label: 'ACT',     group: 'Fuel remaining', totalKey: 'act' },
  { key: 'freq',     label: 'Freq',    group: null,             totalKey: null }
];

/** Blank cell. The form is printed and written on, so an unknown is an empty
 *  box for the pilot's pen - never a zero, a dash or an invented value. */
const BLANK = '';

// EVERY NUMERIC CELL GOES THROUGH A FINITE CHECK (v16.43). `pad3` and a raw
// `String()` printed the literal "NaN" into TAS, TT, VAR, Dir/Vel, WCA, PL and
// GS - seven cells of a company form, on a plan the app had already declared
// unusable. A figure that is not a number is an EMPTY BOX for the pilot's pen,
// exactly like the fields we deliberately never fill.
const pad3 = (/** @type {number} */ v) =>
  (isFinite(v) ? String(Math.round(v)).padStart(3, '0') : BLANK);
/**
 * THE PRINTED WIND DIRECTION IS TO THE NEAREST 10 DEGREES (v17.13, the author:
 * "the OFP should show whole 10 degrees" - 043/9 prints 040/09, 145/11 prints
 * 150/11). The paper only: the plan's WCA, MH and GS are worked from the exact
 * direction. A wind from the north is 360, the way a METAR writes it; 000 is
 * kept for calm, which is what a new waypoint's 000/00 is.
 * @param {number} dir degrees true
 * @param {number} kt
 */
export function windDirTen(dir, kt) {
  if (!isFinite(dir)) return BLANK;
  const r = (((Math.round(dir / 10) * 10) % 360) + 360) % 360;
  return pad3(r === 0 && Math.round(kt) > 0 ? 360 : r);
}
const one = (/** @type {number} */ v) => (isFinite(v) ? Number(v).toFixed(1) : BLANK);
const whole = (/** @type {number} */ v) => (isFinite(v) ? String(Math.round(v)) : BLANK);
const signed = (/** @type {number} */ v) =>
  (isFinite(v) ? (v > 0 ? '+' : '') + Math.round(v) : BLANK);

// =========================================================================
// THE PAPER ROUNDS, THE PLAN DOES NOT (v17.9, the author).
//
// "In the printed OFP, i want the intermediate distances and fuel consumption
// rounded to the nearest whole number for easy copying and reading. If a leg
// uses less than 1 gal of fuel, it shall show 1 ... Round it in a way that
// makes sure that the rounded fuel used NEVER becomes less than ACTUAL fuel
// used. Distances should also be rounded to nearest whole, never 0, but lowest
// may be 0.5NM. The fuel consumption should be based on actual distance flown,
// and the rounding is only for show ... Accumulated fuel and distance will just
// use the rounded intermediate values."
//
//  - FUEL IS ROUNDED TO THE NEAREST WHOLE UNIT, up AND down (v17.10, the
//    author: "why is it rounding 1.1gal up to 2? Round it to the nearest whole
//    number, both up and down. Same for distance"). v17.9 rounded UP, from the
//    request that the paper never show less than the actual burn; this
//    reverses that. It rounds the UNROUNDED burn (`legBurnRaw`), not the tenth
//    the screen shows, so the half-way case is decided by the real figure.
//    A leg under 1 still prints 1 (the original request), never 0.
//  - DISTANCE IS ROUNDED TO THE NEAREST WHOLE, with 0.5 as the floor: a 0.3 NM
//    leg reads 0.5, never 0.
//  - THE ACC COLUMNS AND THE TOTAL LINE ADD UP THE ROUNDED FIGURES, so a pilot
//    checking the sheet down the column gets the printed total.
//  - EST FUEL REMAINING MOVES WITH THE PRINTED ACC COLUMN, so on one sheet
//    start - acc = remaining. Rounding to the nearest means that difference
//    can go either way (under half a unit a leg, plus the floor of 1). It
//    restarts at a refuel, where the tanks hold a stated figure again.
//  - NOTHING ELSE MOVES: the screen, Mass & Balance and the fuel tracker keep
//    the exact figures. This runs on a COPY when the print is built.
// =========================================================================

/** Fuel for the paper: the nearest whole unit (half rounds up), never below
 *  1 for a leg that burns anything. @param {number} raw @returns {number} */
export function paperFuel(raw) {
  const v = Number(raw);
  if (!isFinite(v)) return NaN;
  if (v <= 0) return 0;
  return Math.max(1, Math.round(v));
}

/** A leg distance for the paper: nearest whole, never 0 - 0.5 is the floor.
 *  @param {number} raw @returns {number} */
export function paperDist(raw) {
  const v = Number(raw);
  if (!isFinite(v)) return NaN;
  const r = Math.round(v);
  return r < 1 ? 0.5 : r;
}

/** "12", or "12.5" where a 0.5 leg is in the sum. @param {number} v */
const distText = (v) => (isFinite(v) ? (Number.isInteger(v) ? String(v) : v.toFixed(1)) : BLANK);
const round1 = (/** @type {number} */ v) => Math.round(v * 10) / 10;

/**
 * Every sector of the flight, rounded for the paper. The ACC columns count the
 * WHOLE flight (v16.85), so the running sums carry across sectors; the Total
 * line counts the SECTOR.
 *
 * A sector may open with burn that has no row of its own - a touch & go's
 * ground time, `prefixBurnRaw` - and that is rounded the same way and added
 * to the sums, so no fuel the plan counts is missing from the paper's.
 *
 * @param {any[]} sectors ofpPrintModel entries: {meta, rows, refuelled, prefixBurn, prefixBurnRaw}
 * @returns {any[]} copies, with rounded rows and totals
 */
export function paperRoundSectors(sectors) {
  let accDist = 0, accBurn = 0, remSurplus = 0;
  return (Array.isArray(sectors) ? sectors : []).map((s) => {
    if (!s) return s;
    if (s.refuelled) remSurplus = 0;
    const preRaw = Number(s.prefixBurnRaw) || 0;
    const pre = preRaw > 0 ? paperFuel(preRaw) : 0;
    accBurn += pre;
    remSurplus += pre - (Number(s.prefixBurn) || 0);
    let secDist = 0, secBurn = pre;
    let lastRem = null;
    const rows = (s.rows || []).map((/** @type {any} */ r) => {
      const raw = isFinite(r.legBurnRaw) ? r.legBurnRaw : Number(r.legBurn);
      const burn = paperFuel(raw);
      accBurn += burn; secBurn += burn;
      remSurplus += burn - (Number(r.legBurn) || 0);
      const rem = isFinite(Number(r.rem)) ? round1(Number(r.rem) - remSurplus) : r.rem;
      lastRem = rem;
      const out = Object.assign({}, r, { paper: true, legBurn: burn, accBurn, rem });
      if (r.pattern) {
        out.accDist = accDist ? distText(accDist) : '';
      } else {
        const d = paperDist(isFinite(r.distRaw) ? r.distRaw : Number(r.dist));
        accDist += d; secDist += d;
        out.dist = d; out.accDist = accDist;
      }
      return out;
    });
    const meta = Object.assign({}, s.meta);
    const remAfter = lastRem !== null ? lastRem : round1(Number(meta.fuelRem) - remSurplus);
    meta.fuelRem = isFinite(remAfter) ? remAfter.toFixed(1) : meta.fuelRem;
    if (meta.totals) {
      meta.totals = Object.assign({}, meta.totals, {
        dist: distText(round1(secDist)), burn: String(secBurn), rem: meta.fuelRem
      });
    }
    return Object.assign({}, s, { meta, rows });
  });
}

/**
 * One flight's rows as the form's cells: strings, ready to print.
 *
 * The numbers are NOT recomputed here - they arrive from the same pass that
 * renders the on-screen OFP, so the printed sheet and the screen cannot
 * disagree. This function only decides which cell each one belongs in and how
 * it is written.
 *
 * @param {any} row  a row captured by renderAllFlightTables
 * @returns {Record<string, string>}
 */
export function ofpRowCells(row) {
  if (!row) return {};
  if (row.pattern) {
    // A circuit is not a leg on the ground: no track, no distance, no speed.
    return {
      from: row.from, to: row.to + ' ×' + row.laps,
      // EVERY NUMERIC CELL GOES THROUGH THE SAME FORMATTER AS A LEG ROW (L10).
      // `accBurn` was passed through RAW, so a running total of
      // 3.4000000000000004 printed in full on the form while the leg rows above
      // and below it read 3.4 - and `String(row.pl)` printed the literal "NaN"
      // for a circuit with no altitude, which is H2 surviving in this one row.
      // `accDist` arrives pre-formatted (or '' where the sector has no distance
      // yet) and is passed on as a string: one('') would print 0.0, because
      // Number('') is 0 and isFinite says yes.
      accTime: row.accTime, accBurn: row.paper ? whole(row.accBurn) : one(row.accBurn),
      ff: one(row.ff), legBurn: row.paper ? whole(row.legBurn) : one(row.legBurn),
      pl: whole(row.pl),
      time: row.time, eto: row.eto || BLANK, estRem: one(row.rem),
      tas: BLANK, tt: BLANK, var: BLANK, mt: BLANK, wv: BLANK, wca: BLANK,
      accDist: row.accDist === '' || row.accDist == null ? BLANK : String(row.accDist),
      msa: BLANK, mh: BLANK, gs: BLANK, dist: BLANK,
      ato: BLANK, diff: BLANK, actRem: BLANK, freq: BLANK
    };
  }
  const wv = isFinite(row.wdir) && isFinite(row.wspd)
    ? windDirTen(row.wdir, row.wspd) + '/' + String(Math.round(row.wspd)).padStart(2, '0') : BLANK;
  return {
    from: row.from,
    tas: whole(row.tas),
    tt: pad3(row.tt),
    var: signed(row.var),
    mt: row.mt === null || row.mt === undefined ? '---' : pad3(row.mt),
    wv,
    wca: signed(row.wca),
    // ROUNDED ROWS (paperRoundSectors) print as whole numbers; a distance can
    // be 0.5 at the floor, and a sum that includes one keeps its half.
    accDist: row.paper ? distText(row.accDist) : one(row.accDist),
    accTime: row.accTime,
    ff: one(row.ff),
    legBurn: row.paper ? whole(row.legBurn) : one(row.legBurn),
    accBurn: row.paper ? whole(row.accBurn) : one(row.accBurn),
    to: row.to,
    msa: BLANK,
    pl: whole(row.alt),
    mh: row.mh === null || row.mh === undefined ? '---' : pad3(row.mh),
    gs: whole(row.gs),
    dist: row.paper ? distText(row.dist) : one(row.dist),
    time: row.time,
    eto: row.eto || BLANK,
    ato: BLANK,
    diff: BLANK,
    estRem: one(row.rem),
    actRem: BLANK,
    freq: BLANK
  };
}

/**
 * A flight split onto as many copies of the form as its legs need.
 *
 * @param {{title?: string, dep?: string, dest?: string, date?: string,
 *          reg?: string, fuelDep?: string, fuelRem?: string,
 *          totals?: {dist: string, time: string, burn: string, rem: string}}} meta
 * @param {any[]} rows
 * @returns {{index: number, of: number, dep: string, dest: string, date: string,
 *            reg: string, fuelDep: string, fuelRem: string,
 *            cells: Record<string, string>[], lines: number,
 *            totals: Record<string, string>|null}[]}
 */
export function buildOfpSheets(meta, rows) {
  const m = meta || {};
  const list = Array.isArray(rows) ? rows : [];
  const pages = Math.max(1, Math.ceil(list.length / OFP_ROWS_PER_SHEET));
  const out = [];
  for (let p = 0; p < pages; p++) {
    const slice = list.slice(p * OFP_ROWS_PER_SHEET, (p + 1) * OFP_ROWS_PER_SHEET);
    // The Total line belongs on the LAST sheet only: a running total printed
    // half way through the flight would read as the flight's total.
    const isLast = p === pages - 1;
    const t = m.totals || null;
    out.push({
      index: p + 1, of: pages,
      dep: m.dep || BLANK, dest: m.dest || BLANK,
      date: m.date || BLANK, reg: m.reg || BLANK,
      fuelDep: m.fuelDep || BLANK, fuelRem: m.fuelRem || BLANK,
      cells: slice.map(ofpRowCells),
      lines: OFP_ROWS_PER_SHEET,
      totals: isLast && t
        ? { label: 'Total', dist: t.dist, time: t.time, burn: t.burn,
            rem: t.rem, act: BLANK }
        : null
    });
  }
  return out;
}
