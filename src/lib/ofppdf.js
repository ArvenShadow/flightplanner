/**
 * The printed OFP, written INTO the school's own form (C182OFPMBv4.2.pdf).
 *
 * THE FORM IS NOT REDRAWN, IT IS THE FORM. Both pages of the committed PDF are
 * embedded unchanged as the background of every printed page and the figures
 * are written on top at measured positions - so the ruling, the hatching, the
 * logo, the printed arms and the CG chart are the school's own bytes, not a
 * reconstruction of them. v16.41-v16.96 rebuilt page 1 in HTML from measured
 * column widths and page 2 from its row names; the author's verdict was that
 * the printout "HAS to be IDENTICAL to the C182OFPMBv4.2.pdf". An HTML copy can
 * only ever be close. This cannot be anything else.
 *
 * THE GEOMETRY IS MEASURED IN PDF POINTS (1/72 in, origin bottom-left, page
 * 792 x 612 = US Letter landscape, which is the form's own MediaBox). Page 1's
 * rules are vector paths; page 2 is six 600 dpi raster strips with the text
 * drawn over them, so its rules were found by rendering at 4x and detecting
 * runs of dark pixels - `tools/measure-ofp-form.mjs` does it and writes
 * `tools/prepared/ofp-form-rules.json`, and a test requires every box below to
 * sit on those measured rules. Do not "tidy" these numbers.
 *
 * WHAT IS BLANK IS BLANK ON PURPOSE (v16.41, unchanged): actuals (ATO, Diff,
 * ACT, block and take-off/landing times, flight and block time), MSA (no
 * terrain data by decision), Freq, the alternate line, crew and passengers
 * (people), and on page 2 the alternate, contingency and extra fuel and so the
 * total required (no alternate is planned here), MSA and MDA, max crosswind,
 * runway state, the minima tables and the signatures. An empty box for the
 * pilot's pen, never a zero or a dash.
 *
 * Pure except `renderOfpPdf`, which takes pdf-lib as an ARGUMENT - the library
 * is a separately cached file loaded only when printing, and this way the
 * module has no hidden dependency on how it got there (the v16.16 rule).
 */

/** The form's page size in points: its own MediaBox, both pages. */
export const PAGE_SIZE = [792, 612];

/**
 * @typedef {{x0: number, x1: number, y0: number, y1: number}} Box
 * @typedef {{text: string, box: Box, align?: 'l'|'c'|'r', size?: number,
 *            bold?: boolean, white?: boolean}} TextItem
 */

// ---------------------------------------------------------------------------
// PAGE 1 - "Operational flightplan"
// ---------------------------------------------------------------------------

/** The 26 vertical rules of the main table (25 columns), in points. The same
 *  edges the v16.41 percentages described, now read off the vector paths. */
export const OFP_COL_EDGES = [
  28.63, 93.5, 121.5, 149.75, 177.75, 206.5, 242.88, 270.5, 299.38, 327.38,
  354.63, 381, 408.63, 470.5, 494.5, 519.38, 544.13, 569, 592.75, 617.5, 642,
  665.63, 690.88, 714.75, 738.88, 774
];

/** The 17 horizontal rules bounding the 16 numbered lines, top to bottom. */
export const OFP_ROW_RULES = [
  534.25, 516.75, 499.25, 481.75, 464.13, 446.63, 429.13, 411.63, 394.13,
  376.5, 359, 341.5, 324, 306.5, 289, 271.5, 254
];

/** The first Total line, directly under line 16. */
export const OFP_TOTAL_ROW = { y0: 237.63, y1: 254 };

/** The single-value boxes on page 1. */
export const OFP_BOXES = {
  dep:     { x0: 494.5, x1: 544.25, y0: 577.25, y1: 589.13 },
  dest:    { x0: 494.5, x1: 544.25, y0: 565,    y1: 577.25 },
  date:    { x0: 59.5,  x1: 149.75, y0: 184.25, y1: 200.63 },
  reg:     { x0: 59.5,  x1: 149.75, y0: 151.63, y1: 168 },
  fuelDep: { x0: 206.5, x1: 270.5,  y0: 151.75, y1: 168 },
  fuelRem: { x0: 206.5, x1: 270.5,  y0: 135.38, y1: 151.75 },
  /** Free paper right of the title, for "sheet 2 of 2". Not a form box. */
  sheetNo: { x0: 236,   x1: 400,    y0: 566,    y1: 578 }
};

/** Where the INTEGRITY band goes on either page: the empty top margin, above
 *  every printed element of both pages (page 1 starts at 589.1, page 2 at
 *  581.5). A plan the app calls unusable must not print as clean paperwork. */
export const BAND_BOX = { x0: 28.63, x1: 774, y0: 593, y1: 608 };

// ---------------------------------------------------------------------------
// PAGE 2 - Mass & Balance, fuel, speeds, aerodromes, distances, CG chart
// ---------------------------------------------------------------------------

/** The Mass & Balance table's three value columns, as [x0, x1]. */
export const MB_COLS = { w: [134.13, 182.63], arm: [183.13, 235.63], mom: [236.63, 288.13] };
const MB_W = MB_COLS.w, MB_A = MB_COLS.arm, MB_M = MB_COLS.mom;

/** Each line of the Mass & Balance table, as [y0, y1]. */
export const MB_ROWS = {
  bem:     [541.38, 553.63],
  pilot:   [528.13, 540.38],
  right:   [514.88, 527.13],
  rear:    [501.63, 513.88],
  fuel:    [488.13, 500.63],
  bagA:    [474.38, 487.13],
  bagB:    [460.63, 473.38],
  bagC:    [447.38, 459.63],
  tom:     [433.63, 445.63],
  enroute: [419.38, 431.88],
  lmc:     [406.13, 418.63],
  ldg:     [392.63, 404.38]
};

/** Lines whose ARM the form does not print, so the planner writes it. The
 *  stations print their own (37,0 / 74,0 / 46,5 / 97,0 / 116,0 / 129,0). */
const MB_ARM_WRITTEN = ['bem', 'tom', 'ldg'];

/** Fuel requirements: columns and lines. */
export const FR_COLS = { gal: [461.38, 528.63], lb: [529.38, 588.88], time: [589.63, 668.63] };
const FR_GAL = FR_COLS.gal, FR_LB = FR_COLS.lb, FR_TIME = FR_COLS.time;
export const FR_ROWS = {
  trip:      [541.38, 553.63],
  alternate: [528.13, 540.38],
  contingency: [514.88, 527.13],
  extra:     [501.63, 513.88],
  reserve:   [488.38, 500.88],
  required:  [474.63, 486.88],
  onboard:   [461.13, 473.13],
  endurance: [447.13, 459.38]
};

/** The single-value boxes on page 2. `dep*`/`dest*` are the two aerodrome
 *  blocks, which are laid out differently from each other on the form. */
export const MB_BOXES = {
  reg:      { x0: 60,     x1: 133.13, y0: 554.38, y1: 566.88 },
  va:       { x0: 739.88, x1: 772.38, y0: 474.13, y1: 487.13 },
  vglide:   { x0: 739.88, x1: 772.38, y0: 460.88, y1: 473.38 },
  // CRUISE / APPROACH / MAX CROSSWIND value line
  cruiseAlt: { x0: 323.88, x1: 357.4,  y0: 392.63, y1: 404.88 },
  cruiseOat: { x0: 358.4,  x1: 391.38, y0: 392.63, y1: 404.88 },
  cruiseRpm: { x0: 392.38, x1: 426.38, y0: 392.63, y1: 404.88 },
  cruiseMp:  { x0: 427.13, x1: 460.13, y0: 392.63, y1: 404.88 },
  cruiseTas: { x0: 461.13, x1: 494.13, y0: 392.63, y1: 404.88 },
  cruiseFf:  { x0: 494.88, x1: 528.13, y0: 392.63, y1: 404.88 },
  minFlt:    { x0: 547.63, x1: 588.88, y0: 392.63, y1: 404.88 },
  // DEP. AERODROME
  depIcao:  { x0: 427.13, x1: 459.63, y0: 365.13, y1: 377.13 },
  depRwy:   { x0: 358.5,  x1: 391.38, y0: 351.13, y1: 363.38 },
  depElev:  { x0: 427.13, x1: 460.13, y0: 351.13, y1: 363.38 },
  depWdir:  { x0: 358.5,  x1: 375.38, y0: 337.38, y1: 350.13 },
  depWspd:  { x0: 376.13, x1: 391.38, y0: 337.38, y1: 350.13 },
  depXwind: { x0: 427.13, x1: 460.13, y0: 337.38, y1: 350.13 },
  depPa:    { x0: 495.13, x1: 527.88, y0: 337.38, y1: 350.13 },
  depQnh:   { x0: 358.5,  x1: 391.38, y0: 324.38, y1: 336.38 },
  depTemp:  { x0: 427.13, x1: 460.13, y0: 324.38, y1: 336.38 },
  depDa:    { x0: 495.13, x1: 527.88, y0: 324.38, y1: 336.38 },
  // DEST. AERODROME
  destIcao:  { x0: 669.88, x1: 705.13, y0: 365.13, y1: 377.13 },
  destRwy:   { x0: 589.5,  x1: 629.38, y0: 351.13, y1: 363.38 },
  destElev:  { x0: 669.88, x1: 705.63, y0: 351.13, y1: 363.38 },
  destWdir:  { x0: 589.5,  x1: 608.63, y0: 337.38, y1: 350.13 },
  destWspd:  { x0: 609.63, x1: 629.38, y0: 337.38, y1: 350.13 },
  destXwind: { x0: 669.88, x1: 705.63, y0: 337.38, y1: 350.13 },
  destPa:    { x0: 739.88, x1: 772.38, y0: 337.38, y1: 350.13 },
  destQnh:   { x0: 589.5,  x1: 629.38, y0: 324.38, y1: 336.38 },
  destTemp:  { x0: 669.88, x1: 705.63, y0: 324.38, y1: 336.38 },
  destDa:    { x0: 739.88, x1: 772.38, y0: 324.38, y1: 336.38 },
  // Uncorrected short field TAKE-OFF distance
  toUncorr:   { x0: 495.13, x1: 527.88, y0: 296.63, y1: 308.88 },
  toHwind:    { x0: 358.38, x1: 375.38, y0: 283.38, y1: 295.63 },
  toWindCorr: { x0: 495.13, x1: 527.88, y0: 283.38, y1: 295.63 },
  toBrk:      { x0: 427.13, x1: 460.13, y0: 270.13, y1: 282.38 },
  toBrkCorr:  { x0: 495.13, x1: 527.88, y0: 269.63, y1: 282.38 },
  toNote:     { x0: 323.88, x1: 494.5,  y0: 256.38, y1: 268.63 },
  toCorr:     { x0: 495.13, x1: 527.88, y0: 203.38, y1: 215.88 },
  toReq:      { x0: 495.13, x1: 527.88, y0: 189.88, y1: 201.63 },
  toAvail:    { x0: 495.13, x1: 527.88, y0: 176.13, y1: 188.13 },
  // Uncorrected short field LANDING distance
  ldUncorr:   { x0: 739.88, x1: 772.38, y0: 296.63, y1: 308.88 },
  ldHwind:    { x0: 589.63, x1: 608.63, y0: 283.38, y1: 295.63 },
  ldWindCorr: { x0: 739.88, x1: 772.38, y0: 283.38, y1: 295.63 },
  ldBrk:      { x0: 669.88, x1: 705.63, y0: 270.13, y1: 282.38 },
  ldBrkCorr:  { x0: 739.88, x1: 772.38, y0: 269.63, y1: 282.38 },
  ldNote:     { x0: 547.63, x1: 739.2,  y0: 256.38, y1: 268.63 },
  ldCorr:     { x0: 739.88, x1: 772.38, y0: 203.38, y1: 215.88 },
  ldReq:      { x0: 739.88, x1: 772.38, y0: 189.88, y1: 201.63 },
  ldAvail:    { x0: 739.88, x1: 772.38, y0: 176.13, y1: 188.13 },
  /** Free paper in the top margin, between the tables (from 581.5) and the
   *  integrity band (593), for the sector this page weighs. Not a form box. */
  title:     { x0: 30.25,  x1: 460,    y0: 583,    y1: 591.5 },
  /** The same free strip, right of the title: what this page's figures rest
   *  on that the form has no line for - the last minute change it was worked
   *  with, and on the whole-mission master the net fuel change at the stops.
   *  Not a form box. */
  note:      { x0: 462,    x1: 774,    y0: 583,    y1: 591.5 }
};

/**
 * THE ONE PRE-PRINTED VALUE ON THE FORM: a "0" in the landing H-Wind box
 * (x 597.4-600.9, y 286.8), left there by the workbook it was printed from.
 * It is a FIGURE, not form artwork, and writing the landing headwind over it
 * would print two numbers in one box. So it is covered - exactly the glyph's
 * box plus half a point, inside the cell - ONLY when a headwind is written
 * there. That is the single place a printed page differs from the blank form
 * outside a written value, and a test pins both its size and its condition.
 */
export const PREPRINTED_ZERO = { x0: 596.9, x1: 601.4, y0: 286.3, y1: 293.4 };

/**
 * The CG chart's axes, from its own gridlines at 10 px/pt: arm 30 at x 55.45,
 * arm 50 at 267.25 (10.59 pt/in); 1800 lb at y 66.80, 3200 lb at 251.30
 * (0.131786 pt/lb). Cross-checked on the envelope the form prints: the aft
 * limit at 46 in lands on the measured rule at 224.90, the MTOW line at
 * 3100 lb on 238.10 and the MLW line at 2950 lb on 218.35.
 */
export const CG_CHART = {
  arm0: 30, arm1: 50, x0: 55.45, x1: 267.25,
  lb0: 1800, lb1: 3200, y0: 66.80, y1: 251.30
};

/** The chart marks' colours - the same three the M&B tab uses, so the paper
 *  and the screen say "take-off" in the same colour. Each also has its own
 *  SHAPE, because the sheet is usually printed in black and white. */
export const MARK_STYLE = {
  TO:  { rgb: [0.145, 0.388, 0.922], shape: 'circle',   label: 'T/O' },
  LDG: { rgb: [0.086, 0.639, 0.290], shape: 'triangle', label: 'LDG' },
  ZFM: { rgb: [0.918, 0.345, 0.047], shape: 'square',   label: 'ZFM' }
};

/** @param {number} arm @param {number} lb @returns {{x: number, y: number, clipped: boolean}} */
export function cgChartPoint(arm, lb) {
  const c = CG_CHART;
  const cx = c.x0 + (arm - c.arm0) * (c.x1 - c.x0) / (c.arm1 - c.arm0);
  const cy = c.y0 + (lb - c.lb0) * (c.y1 - c.y0) / (c.lb1 - c.lb0);
  // A point off the paper chart is drawn AT ITS EDGE and says so - hiding the
  // one out-of-limits point would hide the only thing the chart is for.
  const x = Math.min(c.x1, Math.max(c.x0, cx)), y = Math.min(c.y1, Math.max(c.y0, cy));
  return { x, y, clipped: x !== cx || y !== cy };
}

// ---------------------------------------------------------------------------
// Formatting: the form's own convention
// ---------------------------------------------------------------------------

/**
 * Page 2 prints its arms and fleet figures with a DECIMAL COMMA ("37,0",
 * "1993,6") - it is a Norwegian Excel sheet. Figures written beside them use
 * the same, or one box reads 46,5 and the next 2582.3. Page 1 prints no
 * figures of its own, and its rows are the on-screen table's own strings, so
 * it keeps the screen's point (v16.41: one computation, two outputs).
 * @param {number} v @param {number} [dp]
 */
export function nb(v, dp = 1) {
  return Number.isFinite(v) ? v.toFixed(dp).replace('.', ',') : '';
}
/** @param {number} v */
const whole = (v) => (Number.isFinite(v) ? String(Math.round(v)) : '');
/** hh:mm from minutes, as the form's Time column prints it. @param {number} min */
export function hhmm(min) {
  if (!Number.isFinite(min) || min < 0) return '';
  const m = Math.round(min);
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

// ---------------------------------------------------------------------------
// The items: what goes where. Pure, so a test can check every one of them
// without a PDF library.
// ---------------------------------------------------------------------------

/** @param {number} a @param {number} b @param {number} c @param {number} d @returns {Box} */
const bx = (a, b, c, d) => ({ x0: a, x1: b, y0: c, y1: d });

/**
 * One page-1 sheet's text items.
 * @param {{index: number, of: number, dep: string, dest: string, date: string,
 *          reg: string, fuelDep: string, fuelRem: string,
 *          cells: Record<string, string>[], totals: Record<string, string>|null}} sheet
 *          a sheet from `buildOfpSheets` (ofpform.js)
 * @param {string[]} columns the column keys in form order (OFP_COLUMNS)
 * @param {Record<string, string|null>} totalKeys column key -> Total-line key
 * @returns {TextItem[]}
 */
export function ofpPageItems(sheet, columns, totalKeys) {
  /** @type {TextItem[]} */
  const out = [];
  const put = (/** @type {string} */ text, /** @type {Box} */ box, /** @type {'l'|'c'|'r'} */ align = 'c') => {
    if (text !== '' && text !== undefined && text !== null) out.push({ text: String(text), box, align });
  };
  put(sheet.dep, OFP_BOXES.dep, 'l');
  put(sheet.dest, OFP_BOXES.dest, 'l');
  put(sheet.date, OFP_BOXES.date, 'l');
  put(sheet.reg, OFP_BOXES.reg, 'l');
  put(sheet.fuelDep, OFP_BOXES.fuelDep);
  put(sheet.fuelRem, OFP_BOXES.fuelRem);
  if (sheet.of > 1) put('sheet ' + sheet.index + ' of ' + sheet.of, OFP_BOXES.sheetNo, 'l');

  sheet.cells.forEach((cells, r) => {
    if (r >= OFP_ROW_RULES.length - 1) return;
    const top = OFP_ROW_RULES[r], bottom = OFP_ROW_RULES[r + 1];
    columns.forEach((key, ci) => {
      const x0 = OFP_COL_EDGES[ci], x1 = OFP_COL_EDGES[ci + 1];
      // The form prints each line's NUMBER in the top-left of the From cell, so
      // the text sits in the lower part of the row there - clear of it.
      const box = ci === 0 ? bx(x0, x1, bottom, top - 5) : bx(x0, x1, bottom, top);
      put(cells[key], box, key === 'from' || key === 'to' ? 'l' : 'c');
    });
  });
  if (sheet.totals) {
    columns.forEach((key, ci) => {
      const tk = totalKeys[key];
      // 'label' is "Total", which the form already prints in both places.
      if (!tk || tk === 'label') return;
      put(/** @type {any} */ (sheet.totals)[tk],
        bx(OFP_COL_EDGES[ci], OFP_COL_EDGES[ci + 1], OFP_TOTAL_ROW.y0, OFP_TOTAL_ROW.y1));
    });
  }
  return out;
}

/**
 * @typedef {{w: number, arm?: number|null, mom: number, signed?: boolean}} MbLine
 * @typedef {{icao: string, rwy: string, elevFt: number, wdir: string, wspdKt: number,
 *   xwind: string, paFt: number, qnh: number, tempC: number, daFt: number,
 *   hwindKt: number, uncorrM: number, windCorrM: number, braking: number,
 *   brakingCorrM: number, correctedM: number, requiredM: number, availableM: number,
 *   note: string}} MbAerodrome
 * @typedef {{title: string, note?: string, reg: string,
 *   lines: Partial<Record<'bem'|'pilot'|'right'|'rear'|'fuel'|'bagA'|'bagB'|'bagC'|'tom'|'enroute'|'lmc'|'ldg', MbLine>>,
 *   fuel: {tripGal: number, tripMin: number, reserveGal: number, reserveMin: number,
 *          onboardGal: number, enduranceMin: number},
 *   vaKt: number|null, vGlideKt: number|null,
 *   cruise: {altFt: number, oatC: number, rpm: number|null, mp: number|null, tasKt: number, ffGph: number},
 *   minFltMin: number,
 *   dep: MbAerodrome|null, dest: MbAerodrome|null,
 *   marks: {key: 'TO'|'LDG'|'ZFM', lb: number, arm: number, ok: boolean}[]}} MbSheet
 */

/**
 * One page-2 sheet's text items.
 * @param {MbSheet} s
 * @returns {TextItem[]}
 */
export function mbPageItems(s) {
  /** @type {TextItem[]} */
  const out = [];
  const put = (/** @type {string} */ text, /** @type {Box} */ box,
               /** @type {'l'|'c'|'r'} */ align = 'c', /** @type {number} */ size = 7) => {
    if (text !== '' && text !== undefined && text !== null) out.push({ text: String(text), box, align, size });
  };
  put(s.reg, MB_BOXES.reg, 'l');
  put(s.title, MB_BOXES.title, 'l', 6);
  if (s.note) put(s.note, MB_BOXES.note, 'r', 6);
  for (const [key, row] of Object.entries(MB_ROWS)) {
    const line = /** @type {any} */ (s.lines)[key];
    if (!line) continue;
    // A CHANGE is written with its sign, so +24,0 cannot be read as a load.
    const sg = (/** @type {number} */ v) => (line.signed && v > 0 ? '+' : '') + nb(v);
    put(sg(line.w), bx(MB_W[0], MB_W[1], row[0], row[1]));
    if (MB_ARM_WRITTEN.includes(key)) put(nb(line.arm, 2), bx(MB_A[0], MB_A[1], row[0], row[1]));
    put(sg(line.mom), bx(MB_M[0], MB_M[1], row[0], row[1]));
  }

  const f = s.fuel;
  const frow = (/** @type {keyof typeof FR_ROWS} */ k, /** @type {number} */ gal, /** @type {number} */ min) => {
    const r = FR_ROWS[k];
    put(nb(gal), bx(FR_GAL[0], FR_GAL[1], r[0], r[1]));
    put(nb(gal * 6), bx(FR_LB[0], FR_LB[1], r[0], r[1]));
    put(hhmm(min), bx(FR_TIME[0], FR_TIME[1], r[0], r[1]));
  };
  frow('trip', f.tripGal, f.tripMin);
  frow('reserve', f.reserveGal, f.reserveMin);
  put(nb(f.onboardGal), bx(FR_GAL[0], FR_GAL[1], FR_ROWS.onboard[0], FR_ROWS.onboard[1]));
  put(nb(f.onboardGal * 6), bx(FR_LB[0], FR_LB[1], FR_ROWS.onboard[0], FR_ROWS.onboard[1]));
  put(hhmm(f.enduranceMin), bx(FR_TIME[0], FR_TIME[1], FR_ROWS.endurance[0], FR_ROWS.endurance[1]));

  if (s.vaKt !== null) put(whole(s.vaKt), MB_BOXES.va, 'r');
  if (s.vGlideKt !== null) put(whole(s.vGlideKt), MB_BOXES.vglide, 'r');

  const c = s.cruise;
  put(whole(c.altFt), MB_BOXES.cruiseAlt);
  put(Number.isFinite(c.oatC) ? String(Math.round(c.oatC)) : '', MB_BOXES.cruiseOat);
  if (c.rpm !== null) put(whole(c.rpm), MB_BOXES.cruiseRpm);
  if (c.mp !== null) put(whole(c.mp), MB_BOXES.cruiseMp);
  put(whole(c.tasKt), MB_BOXES.cruiseTas);
  put(nb(c.ffGph), MB_BOXES.cruiseFf);
  put(hhmm(s.minFltMin), MB_BOXES.minFlt);

  for (const [pre, ad] of /** @type {['dep'|'dest', MbAerodrome|null][]} */ ([['dep', s.dep], ['dest', s.dest]])) {
    if (!ad) continue;
    const B = /** @type {any} */ (MB_BOXES);
    put(ad.icao, B[pre + 'Icao']);
    put(ad.rwy, B[pre + 'Rwy']);
    put(whole(ad.elevFt), B[pre + 'Elev']);
    put(ad.wdir, B[pre + 'Wdir']);
    put(whole(ad.wspdKt), B[pre + 'Wspd']);
    put(ad.xwind, B[pre + 'Xwind']);
    put(whole(ad.paFt), B[pre + 'Pa']);
    put(whole(ad.qnh), B[pre + 'Qnh']);
    put(Number.isFinite(ad.tempC) ? String(Math.round(ad.tempC)) : '', B[pre + 'Temp']);
    put(whole(ad.daFt), B[pre + 'Da']);
    const d = pre === 'dep' ? 'to' : 'ld';
    put(whole(ad.uncorrM), B[d + 'Uncorr']);
    put(Number.isFinite(ad.hwindKt) ? String(ad.hwindKt) : '', B[d + 'Hwind']);
    put(whole(ad.windCorrM), B[d + 'WindCorr']);
    put(Number.isFinite(ad.braking) ? String(ad.braking) : '', B[d + 'Brk']);
    put(whole(ad.brakingCorrM), B[d + 'BrkCorr']);
    put(whole(ad.correctedM), B[d + 'Corr']);
    put(whole(ad.requiredM), B[d + 'Req']);
    put(whole(ad.availableM), B[d + 'Avail']);
    // A figure that was not computed says why, on the first of the four
    // "fill out as required" lines - never a blank that reads as "no
    // limitation".
    put(ad.note, B[d + 'Note'], 'l', 6);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Text is written at this size and shrunk to fit, never below MIN_SIZE. */
export const TEXT_SIZE = 7;
export const MIN_SIZE = 4.5;
/** Inside a ruled box, figures keep this far from the rules. */
export const PAD = 1.2;

/**
 * The size a string needs to fit a width, shrinking in quarter points - the
 * friend's planner's rule (1ntray/flight_planner), and it is the right one:
 * a long waypoint name gets smaller type rather than a clipped box. Returns
 * `fits: false` when even MIN_SIZE is too wide, and the caller reports it.
 * @param {(text: string, size: number) => number} widthOf
 * @param {string} text @param {number} width @param {number} size
 */
export function fitSize(widthOf, text, width, size) {
  let s = size;
  while (s > MIN_SIZE && widthOf(text, s) > width) s -= 0.25;
  return { size: s, fits: widthOf(text, s) <= width };
}

/**
 * Only characters Helvetica's WinAnsi encoding can carry. Æ Ø Å, °, × and ·
 * all can; an arrow cannot, and pdf-lib throws on it rather than drawing a box.
 * @param {string} text @param {Set<number>} charset
 */
export function encodable(text, charset) {
  const map = /** @type {Record<string, string>} */ ({ '→': '-', '−': '-', '–': '-', '—': '-', '…': '...' });
  let out = '';
  for (const ch of String(text)) {
    const c = map[ch] !== undefined ? map[ch] : ch;
    for (const d of c) out += charset.has(/** @type {number} */ (d.codePointAt(0))) ? d : '?';
  }
  return out;
}

/**
 * The printable document: every sheet on its own copy of the form page.
 *
 * THE FORM IS EMBEDDED ONCE AND DRAWN ON EVERY SHEET, as a form XObject. The
 * PDF is 2.6 MB of 600 dpi strips; copying the page per sheet would ship it
 * once per sector. Drawn at identity it renders pixel-for-pixel as the
 * original page - the verifier renders both and compares.
 *
 * @param {any} PDFLib  the pdf-lib namespace
 * @param {Uint8Array|ArrayBuffer} formBytes  C182OFPMBv4.2.pdf
 * @param {{title: string, band: string|null,
 *          sheets: ({kind: 'ofp', items: TextItem[]} |
 *                   {kind: 'mb', items: TextItem[], marks: MbSheet['marks'], ldHwind: boolean})[]}} doc
 * @returns {Promise<{bytes: Uint8Array, overflow: string[]}>}
 */
export async function renderOfpPdf(PDFLib, formBytes, doc) {
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const pdf = await PDFDocument.create();
  pdf.setTitle(doc.title || 'Operational flightplan');
  pdf.setCreator('C182 Flight Planner');
  pdf.setProducer('C182 Flight Planner (pdf-lib)');
  const [p1, p2] = await pdf.embedPdf(formBytes, [0, 1]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const charset = new Set(font.getCharacterSet());
  const black = rgb(0, 0, 0), white = rgb(1, 1, 1);
  /** @type {string[]} */
  const overflow = [];

  /** @param {any} page @param {TextItem} it */
  const draw = (page, it) => {
    const f = it.bold ? bold : font;
    const text = encodable(it.text, charset);
    const w = it.box.x1 - it.box.x0 - 2 * PAD;
    const fit = fitSize((t, s) => f.widthOfTextAtSize(t, s), text, w, it.size || TEXT_SIZE);
    if (!fit.fits) overflow.push(text);
    const tw = f.widthOfTextAtSize(text, fit.size);
    const x = it.align === 'l' ? it.box.x0 + PAD
      : it.align === 'r' ? it.box.x1 - PAD - tw
        : (it.box.x0 + it.box.x1 - tw) / 2;
    // Vertically centred on the box: Helvetica's cap height is ~0.72 em, so
    // the baseline sits that far below the centre plus half of it.
    const y = (it.box.y0 + it.box.y1) / 2 - fit.size * 0.36;
    page.drawText(text, { x, y, size: fit.size, font: f, color: it.white ? white : black });
  };

  /** @param {any} page */
  const band = (page) => {
    if (!doc.band) return;
    const b = BAND_BOX;
    page.drawRectangle({ x: b.x0, y: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0, color: black });
    draw(page, { text: 'INTEGRITY CHECK FAILED - DO NOT USE:  ' + doc.band,
                 box: b, align: 'l', size: 8, bold: true, white: true });
  };

  for (const sh of doc.sheets) {
    const page = pdf.addPage(PAGE_SIZE);
    page.drawPage(sh.kind === 'ofp' ? p1 : p2, { x: 0, y: 0, width: PAGE_SIZE[0], height: PAGE_SIZE[1] });
    if (sh.kind === 'mb') {
      if (sh.ldHwind) {
        const z = PREPRINTED_ZERO;
        page.drawRectangle({ x: z.x0, y: z.y0, width: z.x1 - z.x0, height: z.y1 - z.y0, color: white });
      }
      drawMarks(page, sh.marks || [], { rgb, font, black });
    }
    for (const it of sh.items) draw(page, it);
    band(page);
  }
  return { bytes: await pdf.save(), overflow };
}

/**
 * The T/O, landing and zero-fuel points on the form's own CG chart, with the
 * fuel-burn line from take-off to landing - the path the aircraft actually
 * moves along, which is why checking its two ends is enough (massbalance.js).
 * @param {any} page
 * @param {MbSheet['marks']} marks
 * @param {{rgb: any, font: any, black: any}} k
 */
function drawMarks(page, marks, k) {
  const at = /** @type {Record<string, {x: number, y: number, clipped: boolean}>} */ ({});
  for (const m of marks) if (Number.isFinite(m.arm) && Number.isFinite(m.lb)) at[m.key] = cgChartPoint(m.arm, m.lb);
  if (at.TO && at.LDG) {
    page.drawLine({ start: { x: at.TO.x, y: at.TO.y }, end: { x: at.LDG.x, y: at.LDG.y },
      thickness: 0.8, color: k.black, dashArray: [2, 1.5] });
  }
  for (const m of marks) {
    const p = at[m.key];
    if (!p) continue;
    const st = MARK_STYLE[m.key];
    const col = k.rgb(st.rgb[0], st.rgb[1], st.rgb[2]);
    const r = 2.6;
    if (!m.ok) {
      page.drawCircle({ x: p.x, y: p.y, size: r + 2.2, borderColor: k.rgb(0.863, 0.149, 0.149), borderWidth: 1.2 });
    }
    if (st.shape === 'circle') {
      page.drawCircle({ x: p.x, y: p.y, size: r, color: col, borderColor: k.black, borderWidth: 0.5 });
    } else if (st.shape === 'square') {
      page.drawRectangle({ x: p.x - r * 0.9, y: p.y - r * 0.9, width: r * 1.8, height: r * 1.8,
        color: col, borderColor: k.black, borderWidth: 0.5 });
    } else {
      // drawSvgPath takes SVG coordinates: y grows DOWN from the anchor.
      const h = r * 1.15;
      page.drawSvgPath(`M 0 ${-h} L ${h} ${h * 0.75} L ${-h} ${h * 0.75} Z`,
        { x: p.x, y: p.y, color: col, borderColor: k.black, borderWidth: 0.5 });
    }
    const label = st.label + (p.clipped ? ' (off chart)' : '');
    page.drawText(label, { x: p.x + 4.5, y: p.y - 1.8, size: 5, font: k.font, color: col });
  }
}
