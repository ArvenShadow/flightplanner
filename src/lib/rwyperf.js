/**
 * Take-off and landing distance against a runway - roadmap item 5, phase D.
 *
 * THE METHOD IS THE SCHOOL'S, taken cell by cell from `OFP-C182.xlsx`
 * (`CALC_TOD`, `CALC_LDG` and OFP!J24:V32), and the TABLES ARE THE POH's, from
 * the snapshots in tools/prepared/ that already agree with that workbook 90/90
 * and 30/30. Four places depart from the workbook, each because the workbook
 * is wrong there, and each is stated where it happens:
 *
 *  1. THE RUNWAY DIRECTION IS TRUE. METAR wind is reported TRUE (ICAO Annex 3);
 *     the workbook's NavData holds MAGNETIC runway headings (ENDU 10 -> 099,
 *     where the AIP's true bearing is 109.01) and subtracts one from the other,
 *     so every component there is off by the local variation - 10 to 16 degrees
 *     across Northern Norway. The AIP publishes the true bearing; it is used.
 *  2. ABOVE THE TABLE IS REFUSED, NOT EXTRAPOLATED. The workbook's FILTER
 *     fallbacks read a missing row as distance 0, so PA 6000 came out SHORTER
 *     than PA 5000. The POH tabulates to PA 8000 / 40 C / 3100 lb; beyond any
 *     of those there is no published figure and none is invented.
 *  3. A VARIABLE WIND IS A TAILWIND ON BOTH ENDS (the author's decision). The
 *     workbook gives take-off no correction and landing the full speed as
 *     tailwind; treating both the conservative way is consistent.
 *  4. THE COMPARISON IS AGAINST TODA (the author's decision). The workbook's
 *     cell is LABELLED TODA but reads the ASDA column: Avinor publishes TORA |
 *     ASDA | TODA | LDA, not the textbook TORA | TODA | ASDA | LDA, and the
 *     lookup assumed the textbook. Identical at ENDU; ENBR 17 is 2826 vs 3119.
 *
 * Everything else is the workbook's, including the parts a textbook would do
 * differently: pressure altitude is `elevation + 27 x (1013 - QNH)`, the
 * headwind earns NO credit below 9 kt, braking action scales the corrected
 * figure, and the factors are x1.25 on take-off and x1.43 on landing.
 */
import TAKEOFF from '../../tools/prepared/poh-takeoff.json' with { type: 'json' };
import LANDING from '../../tools/prepared/poh-landing.json' with { type: 'json' };

/** OFP!L31 and OFP!S31: the school's performance factors. */
export const TAKEOFF_FACTOR = 1.25;
export const LANDING_FACTOR = 1.43;

/** OFP!P18: feet of pressure altitude per hPa, and the datum it counts from.
 *  The school's arithmetic, not a standard atmosphere - 1013, not 1013.25. */
export const FT_PER_HPA = 27;
export const QNH_DATUM_HPA = 1013;

/** OFP!O25: the POH's "decrease 10% for each 9 knots headwind", with the
 *  school's rule that a headwind under 9 kt earns nothing. Conservative: the
 *  proportional reading would credit 8 kt with 8.9%. */
export const HEADWIND_CREDIT_FROM_KT = 9;

/** The POH's tailwind limit, read from the table's own notes. */
export const TAILWIND_LIMIT_KT = TAKEOFF.corrections.tailwindLimitKt;

/** OFP!O26: braking action, 6 (good) to 0. 0 is prohibited. */
/** @type {Record<number, number>} */
export const BRAKING_FACTORS = { 6: 1, 5: 1, 4: 1.1, 3: 1.2, 2: 1.5, 1: 2 };

/** The POH's dry-grass notes: a share of the GROUND ROLL, not the total, and
 *  a different share for each - 15% take-off, 45% landing. */
export const GRASS_TAKEOFF_SHARE = 0.15;
export const GRASS_LANDING_SHARE = 0.45;

/** Surfaces the POH's figures apply to as published, and the one it corrects. */
export const PAVED = /^(ASPH|CONC|ASPH\/CONC|CONC\/ASPH|BITUM)$/;
const GRASS = /^GRASS$/;

const M_PER_FT = 0.3048;

/**
 * Pressure altitude the school's way.
 * @param {number} elevFt aerodrome elevation
 * @param {number} qnhHpa
 */
export function pressureAltitudeFt(elevFt, qnhHpa) {
  return Number(elevFt) + FT_PER_HPA * (QNH_DATUM_HPA - Number(qnhHpa));
}

/**
 * Density altitude, the school's way: `OFP!P19` is
 * `=ROUND(P18 + (120 * (N20 - (15 - (2 * (P18 / 1000))))), 0)` - 120 ft per
 * degree of deviation from ISA, with ISA at 15 degrees C less 2 per 1000 ft of
 * pressure altitude. It goes on the form's D. Alt box and is NOT used in any
 * distance: the POH tables are entered by pressure altitude and temperature,
 * which already is the density correction.
 * @param {number} paFt @param {number} tempC
 * @returns {number} whole feet, or NaN when either input is not known
 */
export function densityAltitudeFt(paFt, tempC) {
  const pa = Number(paFt), t = Number(tempC);
  if (!Number.isFinite(pa) || !Number.isFinite(t) || paFt === null || tempC === null) return NaN;
  return Math.round(pa + 120 * (t - (15 - 2 * (pa / 1000))));
}

/**
 * The wind along and across a runway. Both directions are TRUE.
 *
 * Whole knots, as the workbook rounds them: the 9 kt credit threshold is
 * compared against the rounded figure there, and a component quoted to a
 * tenth of a knot from a wind reported in whole knots would be false precision.
 *
 * @param {number} rwyTrueDeg
 * @param {number|'VRB'|null} windTrueDeg  'VRB' for a variable wind
 * @param {number} speedKt
 * @returns {{headKt:number, crossKt:number, crossFrom:'L'|'R'|null, variable:boolean}}
 */
export function windAlongRunway(rwyTrueDeg, windTrueDeg, speedKt) {
  const v = Number(speedKt);
  if (windTrueDeg === 'VRB') {
    // The author's decision: a variable wind can come from behind, so it is
    // priced as the full speed from behind, and as the full speed across.
    return { headKt: -Math.round(v), crossKt: Math.round(v), crossFrom: null, variable: true };
  }
  const rad = (Number(rwyTrueDeg) - Number(windTrueDeg)) * Math.PI / 180;
  const head = Math.round(v * Math.cos(rad));
  const crossRaw = v * Math.sin(rad);
  const cross = Math.round(Math.abs(crossRaw));
  return {
    // `+ 0` turns a -0 into 0, so a calm reads as calm and not as a tailwind.
    headKt: head + 0,
    crossKt: cross,
    crossFrom: cross === 0 ? null : (crossRaw > 0 ? 'L' : 'R'),
    variable: false
  };
}

/**
 * Where a value sits on one table axis: the two bracketing entries and the
 * fraction between them. BELOW the axis it clamps to the first entry, which is
 * the workbook's behaviour and the conservative one (lighter, lower and colder
 * all mean shorter). ABOVE it there is nothing published, so null.
 *
 * @param {number[]} axis ascending
 * @param {number} x
 * @returns {{lo:number, hi:number, f:number}|null}
 */
function bracket(axis, x) {
  if (!Number.isFinite(x)) return null;
  if (x <= axis[0]) return { lo: 0, hi: 0, f: 0 };
  if (x > axis[axis.length - 1]) return null;
  for (let i = 1; i < axis.length; i++) {
    if (x <= axis[i]) return { lo: i - 1, hi: i, f: (x - axis[i - 1]) / (axis[i] - axis[i - 1]) };
  }
  return null;
}

/**
 * Bilinear across pressure altitude and temperature on one weight's grid.
 * @param {Record<string, Array<number[]|null>>} grid  PA -> temps -> [roll, total]
 * @param {number[]} pas
 * @param {{lo:number,hi:number,f:number}} p
 * @param {{lo:number,hi:number,f:number}} t
 * @returns {number[]|null} [ground roll, total] ft, or null if a corner is deleted
 */
function paTemp(grid, pas, p, t) {
  /** @param {number} pi @param {number} ti */
  const at = (pi, ti) => grid[String(pas[pi])][ti];
  const c = [at(p.lo, t.lo), at(p.lo, t.hi), at(p.hi, t.lo), at(p.hi, t.hi)];
  // A POH-deleted cell (3100 lb at the hot, high corner) poisons any figure
  // interpolated from it: the manufacturer declines to certify that condition.
  if (c.some((x) => !x)) return null;
  const [ll, lh, hl, hh] = c.map((x) => /** @type {number[]} */ (x));
  return [0, 1].map((k) => {
    const lo = ll[k] + t.f * (lh[k] - ll[k]);
    const hi = hl[k] + t.f * (hh[k] - hl[k]);
    return lo + p.f * (hi - lo);
  });
}

/**
 * The POH figure, interpolated the workbook's way.
 * @param {'takeoff'|'landing'} kind
 * @param {number|null} weightLb   ignored for landing - its table is 2950 lb only
 * @param {number} paFt
 * @param {number} tempC
 * @returns {{rollFt:number, totalFt:number}|{refused:string}}
 */
export function pohDistanceFt(kind, weightLb, paFt, tempC) {
  const src = kind === 'takeoff' ? TAKEOFF : LANDING;
  const pas = src.pressureAltitudesFt, temps = src.temperaturesC;
  const p = bracket(pas, paFt);
  if (!p) return { refused: `pressure altitude ${Math.round(paFt)} ft is above the POH table (${pas[pas.length - 1]} ft)` };
  const t = bracket(temps, tempC);
  if (!t) return { refused: `${Number(tempC).toFixed(0)} °C is above the POH table (${temps[temps.length - 1]} °C)` };
  const deleted = 'the POH deletes this condition (climb after lift-off under 150 fpm)';

  if (kind === 'landing') {
    // ONE WEIGHT, AND IT IS MLW. Never scaled: a lighter aeroplane lands
    // shorter, so the 2950 lb figure errs long for every legal landing weight.
    const r = paTemp(/** @type {any} */ (LANDING.table), pas, p, t);
    return r ? { rollFt: r[0], totalFt: r[1] } : { refused: deleted };
  }
  const ws = TAKEOFF.weightsLb;
  const w = bracket(ws, Number(weightLb));
  if (!w) {
    return { refused: Number.isFinite(Number(weightLb))
      ? `${Number(weightLb).toFixed(0)} lb is above the POH table (${ws[ws.length - 1]} lb)`
      : 'the take-off mass is not known' };
  }
  const tables = /** @type {Record<string, any>} */ (TAKEOFF.table);
  const lo = paTemp(tables[String(ws[w.lo])], pas, p, t);
  const hi = paTemp(tables[String(ws[w.hi])], pas, p, t);
  if (!lo || !hi) return { refused: deleted };
  return {
    rollFt: lo[0] + w.f * (hi[0] - lo[0]),
    totalFt: lo[1] + w.f * (hi[1] - lo[1])
  };
}

/**
 * The wind multiplier, the school's reading of the POH notes.
 * @param {number} headKt  negative = tailwind
 * @returns {number|null}  null past the POH's tailwind limit
 */
export function windFactor(headKt) {
  const h = Number(headKt);
  if (h >= 0) return h < HEADWIND_CREDIT_FROM_KT ? 1 : 1 - (h / 9) * 0.1;
  if (-h > TAILWIND_LIMIT_KT) return null;
  return 1 + (-h / 2) * 0.1;
}

/**
 * @typedef {object} DistanceInput
 * @property {'takeoff'|'landing'} kind
 * @property {number|null} weightLb     take-off mass; unused for landing
 * @property {number} elevFt            aerodrome elevation
 * @property {number} qnhHpa
 * @property {number} tempC
 * @property {number} headKt            from windAlongRunway
 * @property {number} braking           6..0, OFP!M26
 * @property {string} surface           AD 2.12 CODE_COMPOSITION
 * @property {number|null} availableM  TODA (take-off) or LDA (landing)
 */

/**
 * One distance, worked the way the school's sheet works it, in metres.
 *
 * @param {DistanceInput} x
 * @returns {RunwayDistance}
 */
export function runwayDistance(x) {
  const paFt = pressureAltitudeFt(x.elevFt, x.qnhHpa);
  const base = {
    kind: x.kind, paFt, availableM: x.availableM,
    uncorrectedM: NaN, windCorrM: NaN, brakingCorrM: NaN, surfaceCorrM: NaN,
    correctedM: NaN, factor: x.kind === 'takeoff' ? TAKEOFF_FACTOR : LANDING_FACTOR,
    requiredM: NaN, marginM: NaN, ok: false, refused: /** @type {string|null} */ (null),
    refusedKind: /** @type {'input'|'limit'|'surface'|null} */ (null)
  };
  // THREE KINDS OF "NO FIGURE", and only one of them is a finding. A LIMIT
  // (past the tailwind limit, above the POH table, a deleted cell, braking
  // action 0) is the aircraft saying no, and belongs in the red banner. An
  // INPUT not yet given is the pilot not having got there. A SURFACE the POH
  // does not correct for is a gap in the source, stated but not a finding.
  const refuse = (/** @type {string} */ why, /** @type {'input'|'limit'|'surface'} */ kind) =>
    Object.assign(base, { refused: why, refusedKind: kind });

  for (const [name, v] of /** @type {[string, number][]} */ ([['QNH', x.qnhHpa], ['temperature', x.tempC],
    ['elevation', x.elevFt], ['wind component', x.headKt]])) {
    if (!Number.isFinite(Number(v)) || v === null) return refuse(`the ${name} is not known`, 'input');
  }
  const surface = String(x.surface || '').trim().toUpperCase();
  const grass = GRASS.test(surface);
  if (!grass && !PAVED.test(surface)) {
    return refuse(`the POH publishes no correction for a ${surface || 'unknown'} surface`, 'surface');
  }
  const bf = BRAKING_FACTORS[Number(x.braking)];
  if (Number(x.braking) === 0) return refuse('braking action 0: operations prohibited', 'limit');
  if (!bf) return refuse('braking action must be 1 to 6', 'input');
  const wf = windFactor(x.headKt);
  if (wf === null) return refuse(`a ${-x.headKt} kt tailwind is past the POH's ${TAILWIND_LIMIT_KT} kt limit`, 'limit');

  const poh = pohDistanceFt(x.kind, x.weightLb, paFt, Number(x.tempC));
  // The mass not being known is the pilot not having picked an aircraft; every
  // other POH refusal is the table ending, which is the aircraft's limit.
  if ('refused' in poh) return refuse(poh.refused, /not known/.test(poh.refused) ? 'input' : 'limit');

  const uncorrected = poh.totalFt * M_PER_FT;
  const wind = uncorrected * (wf - 1);
  const braking = (uncorrected + wind) * (bf - 1);
  const surfaceCorr = grass
    ? poh.rollFt * M_PER_FT * (x.kind === 'takeoff' ? GRASS_TAKEOFF_SHARE : GRASS_LANDING_SHARE)
    : 0;
  const corrected = uncorrected + wind + braking + surfaceCorr;
  // Rounded UP to the whole metre, never to the nearest: the figure is a
  // requirement, and rounding it down by half a metre is rounding the wrong way.
  const required = Math.ceil(corrected * base.factor - 1e-9);
  const available = x.availableM;
  return Object.assign(base, {
    uncorrectedM: uncorrected, windCorrM: wind, brakingCorrM: braking, surfaceCorrM: surfaceCorr,
    correctedM: corrected, requiredM: required,
    marginM: Number.isFinite(Number(available)) && available !== null ? Number(available) - required : NaN,
    ok: Number.isFinite(Number(available)) && available !== null && required <= Number(available)
  });
}

/**
 * The end of a runway with the most headwind, for a default. The pilot can
 * always pick another: an ATC-assigned runway is not a wind calculation.
 *
 * @param {Array<{desig:string, trueBrg:number}>} ends
 * @param {number|'VRB'|null} windTrueDeg
 * @param {number} speedKt
 */
export function bestEnd(ends, windTrueDeg, speedKt) {
  if (!ends.length) return null;
  if (windTrueDeg === 'VRB' || windTrueDeg === null || !Number.isFinite(Number(speedKt)) || Number(speedKt) === 0) {
    return ends[0];
  }
  let best = ends[0], bestHead = -Infinity;
  for (const e of ends) {
    const h = windAlongRunway(e.trueBrg, windTrueDeg, speedKt).headKt;
    if (h > bestHead) { best = e; bestHead = h; }
  }
  return best;
}

