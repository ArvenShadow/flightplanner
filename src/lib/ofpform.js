/**
 * The company OFP form (UiT "Operational flightplan", C182OFPMBv4.2.pdf page 1)
 * as data: its columns, and a flight's rows laid onto its 16 lines.
 *
 * WHY THIS IS A MODULE AND NOT MARKUP IN THE PAGE: the form is a fixed grid the
 * flight school prints on, so what goes in which cell is a specification, not a
 * styling detail, and it is worth testing without a browser.
 *
 * THE GEOMETRY IS MEASURED, NOT EYEBALLED. The PDF's table body is a raster
 * image with the text drawn over it, so the column boundaries cannot be read
 * out of the vector content. They were measured off a 200 dpi render by
 * detecting the vertical rules (runs of dark pixels spanning >=30% of the
 * sheet) - COLUMN_EDGES_PCT below is that measurement, as a percentage of the
 * page width. Do not "tidy" those numbers: they are what makes a printed sheet
 * line up with the paper form.
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

/** Vertical rules of the main table, as a percentage of the PAGE width,
 *  measured off a 200 dpi render of the form. 26 edges = 25 columns. */
export const COLUMN_EDGES_PCT = [
  3.61, 11.80, 15.34, 18.89, 22.43, 26.07, 30.66, 34.16, 37.80, 41.34, 44.75,
  48.11, 51.57, 59.39, 62.43, 65.57, 68.70, 71.84, 74.84, 77.98, 81.07, 84.02,
  87.20, 90.25, 93.30, 97.70
];

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

/** Column widths as a percentage of the TABLE width (not the page), so the
 *  sheet keeps the form's proportions on any paper size. */
export function columnWidthsPct() {
  const span = COLUMN_EDGES_PCT[COLUMN_EDGES_PCT.length - 1] - COLUMN_EDGES_PCT[0];
  const out = [];
  for (let i = 1; i < COLUMN_EDGES_PCT.length; i++)
    out.push(((COLUMN_EDGES_PCT[i] - COLUMN_EDGES_PCT[i - 1]) / span) * 100);
  return out;
}

/** The group header cells, in order, each spanning the columns it covers.
 *  Built from OFP_COLUMNS so a column added to a group cannot desynchronise
 *  the two header rows. */
export function groupSpans() {
  const out = [];
  for (const c of OFP_COLUMNS) {
    const last = out[out.length - 1];
    if (last && last.label === c.group && c.group !== null) last.span++;
    else out.push({ label: c.group, span: 1 });
  }
  return out;
}

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
const one = (/** @type {number} */ v) => (isFinite(v) ? Number(v).toFixed(1) : BLANK);
const whole = (/** @type {number} */ v) => (isFinite(v) ? String(Math.round(v)) : BLANK);
const signed = (/** @type {number} */ v) =>
  (isFinite(v) ? (v > 0 ? '+' : '') + Math.round(v) : BLANK);

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
      accTime: row.accTime, accBurn: row.accBurn,
      ff: one(row.ff), legBurn: one(row.legBurn),
      pl: row.pl === null || row.pl === undefined ? BLANK : String(row.pl),
      time: row.time, eto: row.eto || BLANK, estRem: one(row.rem),
      tas: BLANK, tt: BLANK, var: BLANK, mt: BLANK, wv: BLANK, wca: BLANK,
      accDist: row.accDist, msa: BLANK, mh: BLANK, gs: BLANK, dist: BLANK,
      ato: BLANK, diff: BLANK, actRem: BLANK, freq: BLANK
    };
  }
  const wv = isFinite(row.wdir) && isFinite(row.wspd)
    ? pad3(row.wdir) + '/' + String(Math.round(row.wspd)).padStart(2, '0') : BLANK;
  return {
    from: row.from,
    tas: whole(row.tas),
    tt: pad3(row.tt),
    var: signed(row.var),
    mt: row.mt === null || row.mt === undefined ? '---' : pad3(row.mt),
    wv,
    wca: signed(row.wca),
    accDist: one(row.accDist),
    accTime: row.accTime,
    ff: one(row.ff),
    legBurn: one(row.legBurn),
    accBurn: one(row.accBurn),
    to: row.to,
    msa: BLANK,
    pl: whole(row.alt),
    mh: row.mh === null || row.mh === undefined ? '---' : pad3(row.mh),
    gs: whole(row.gs),
    dist: one(row.dist),
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
