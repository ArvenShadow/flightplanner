/**
 * MASS & BALANCE - the second page of the school's OFP form (roadmap item 5).
 *
 * THIS SUPERSEDES THE "OUT OF SCOPE" DECISION recorded in CLAUDE.md under
 * "Mass & Balance". That entry said M&B stayed in the user's Excel sheet and
 * that this tool would not reproduce it. The premise has changed twice: the
 * form itself (`C182OFPMBv4.2.pdf`) and the live workbook (`OFP-C182.xlsx`)
 * are both committed to this repo now, and the planner already computes the
 * one number the sheet cannot get for itself - the fuel actually burned on
 * each sector.
 *
 * TWO SOURCES, AND THEY AGREE - which is what makes this importable at all
 * under the NO GUESSTIMATES rule. Every constant below appears in BOTH the
 * printed form and the workbook, independently:
 *
 *   - the station arms (37 / 37 / 74 / 46.5 / 97 / 116 / 129 in) are printed
 *     in the form's Arm column and typed into `OFP!E4:E10`;
 *   - the five aircraft (LN-TRA..LN-TRE) with their empty weight and empty
 *     moment are printed on the form AND tabulated in `'AC REG'!A3:C7`, to
 *     the last decimal in every one of the ten figures;
 *   - the Va table (3100->110, 2600->101, 2100->91) is printed on the form
 *     and repeated in `Performance!R7:S9`.
 *
 * The form carries `Version date 10.08.2026`, which is what `FLEET_SOURCE`
 * records. Nothing here is read off a chart, inferred from wording, or
 * averaged: where the two sources are silent, this module is silent too, and
 * `massBalanceProblems` says so rather than filling the gap in.
 *
 * WHAT IS DELIBERATELY ABSENT, and it is reported rather than approximated:
 * a MAXIMUM BAGGAGE weight. The user states one exists; neither the form nor
 * the workbook prints a figure for it, and neither does anything in this
 * repo. So no baggage limit is checked, `BAGGAGE_MAX_LB` is `null`, and the
 * UI must say the baggage check is not performed. Inventing 200 lb from
 * general C182 knowledge is exactly the plausible wrong answer this project
 * refuses - it would read as a checked limit and be a guess.
 *
 * POH UNITS THROUGHOUT: pounds, inches aft of datum, inch-pounds, US
 * gallons. Conversion happens at the display edge and nowhere else, which is
 * the rule `types.d.ts` already states for the rest of the domain.
 *
 * ONE FUEL DENSITY. `FUEL_LB_PER_GAL` is the single constant; the workbook
 * uses it in `=M8*6` and `=M3*6` and the user confirmed 6 lb/gal for
 * planning at standard temperature. Every pound-per-gallon and
 * kilogram-per-gallon figure in the app derives from it, so the M&B sheet
 * and the fuel column cannot disagree about what a gallon weighs.
 */

/**
 * AvGas 100LL, planning density, pounds per US gallon.
 *
 * The workbook's own arithmetic (`=M8*6`), and the user's answer when asked:
 * "6lb/gal, i personally never set fuel in KG. However if KG is used, the
 * correct amount shall be displayed, but assume standard temperatures". So
 * the kilogram figure is DERIVED from this rather than carried separately -
 * two independently rounded densities are two things that can drift.
 */
export const FUEL_LB_PER_GAL = 6.0;

/** Pounds in a kilogram, exact by definition of the international pound. */
export const LB_PER_KG = 2.20462262184878;

/** Kilograms per US gallon, derived from the one density above. */
export const FUEL_KG_PER_GAL = FUEL_LB_PER_GAL / LB_PER_KG;

/**
 * Station arms, inches aft of datum. Printed on the form's Arm column and
 * typed into `OFP!E4:E10`.
 *
 * BAGGAGE A, B AND C ARE ONE PHYSICAL COMPARTMENT at three distances from
 * the datum (the user's words: "baggage compartment A, B and C are all one
 * compartment but just different lengths from the datum"). They are kept as
 * three stations because the arm is what the moment needs, not because they
 * are three spaces.
 */
export const STATION_ARMS = {
  pilotLb: 37,
  rightLb: 37,
  rearLb: 74,
  bagALb: 97,
  bagBLb: 116,
  bagCLb: 129
};

/** The fuel station's arm, inches aft of datum (`OFP!E7`, `OFP!E12`). */
export const FUEL_ARM_IN = 46.5;

/**
 * Maximum take-off mass, pounds.
 *
 * ALSO THE MAXIMUM RAMP MASS, on the user's instruction ("We have max bagg,
 * max ramp. only MTOW and MLW. Assume MTOW is max ramp"). This matters
 * because taxi fuel is counted IN the take-off mass here, so the figure this
 * is checked against is really a ramp weight - and the user's answer is that
 * the two limits are the same number for this fleet.
 */
export const MTOW_LB = 3100;

/** Maximum landing mass, pounds (`Performance!X2:X3`, the drawn MLW line). */
export const MLW_LB = 2950;

/**
 * NOT KNOWN, AND THEREFORE NOT CHECKED. See the note at the top of this
 * file: a maximum baggage weight exists but is printed nowhere in either
 * source. `null` is the honest value and `massBalanceProblems` reports that
 * the check is absent.
 */
export const BAGGAGE_MAX_LB = null;

/**
 * The CG envelope, `[armIn, weightLb]`, from `Performance!Q1:R8` - the block
 * the workbook itself labels `USED FOR CG CALCS`. Given in ring order; the
 * closing repeat of the first vertex is dropped, because every function here
 * closes the ring itself and a duplicated vertex would make the convexity
 * walk see a zero-length edge.
 *
 * THE TOP OF THE ENVELOPE IS MTOW. 3100 lb is both the weight limit and the
 * envelope's ceiling, so a point above MTOW is outside the envelope as well
 * as over weight - reported as both, because they are two different things a
 * pilot has to fix in two different ways.
 */
export const CG_ENVELOPE = [
  [33, 1800],
  [33, 2225],
  [35.8, 2700],
  [41, 3100],
  [46, 3100],
  [46, 1800]
];

/**
 * The autopilot's forward CG limit, inches aft of datum, and the weight
 * below which it bites.
 *
 * READ OFF `Performance!T1:U3`, a two-point line labelled `autopilot`: arm
 * 34 at 1800 lb and arm 34 at 2400 lb, i.e. a vertical line at 34 in
 * spanning 1800-2400 lb. THE REASON IT STOPS AT 2400 IS THE ARITHMETIC OF
 * THE STANDARD ENVELOPE, which is what makes this an inference from the data
 * rather than a guess about intent: the standard forward limit reaches
 * 34.03 in at 2400 lb, so 34 in is only ever FORWARD of the standard limit
 * below that weight. The line is drawn exactly as far as it constrains
 * anything.
 *
 * STILL AN INTERPRETATION OF A LINE, not a quoted limitation, so
 * `massBalanceProblems` phrases it as a caution naming the source rather
 * than as an out-of-limits finding. It wants confirming against the POH
 * supplement for the installed autopilot.
 */
export const AUTOPILOT_MIN_ARM_IN = 34;
/** Above this weight the standard forward limit is already aft of 34 in. */
export const AUTOPILOT_LIMIT_MAX_LB = 2400;

/**
 * THE SHEET'S ONE PLANNING FUEL FLOW, US gallons per hour: `OFP!P4`, labelled
 * "FUEL FLOW" and set to 12.
 *
 * Every TIME the fuel block states is gallons at this rate, and never at the
 * cruise level's POH figure: endurance is `OFP!O9 = (M8/P4)/24` and the final
 * reserve `OFP!M6 = (O6*24)*P4`. The author (v16.98): "make sure it always
 * uses 12GPH. 64GAL should give endurance of 05:20". v16.97 had timed both at
 * the cruise POH flow, which put 64 gal at ~05:23 at 4500 ft and moved with the
 * cruise level - a second fuel flow on a page the school works with one.
 * The per-leg burn on the OFP is still the POH's, per leg: that is a different
 * figure answering a different question.
 */
export const PLANNING_GPH = 12;

/**
 * The fuel flow used for the "Min FLT" figure, US gallons per hour.
 *
 * `OFP!N13` divides by the same `P4`, and the user's answer was "MinFLT keep
 * 12gph for simplicity". It IS the planning rate above - one cell on the
 * sheet - so it is defined as that rather than as a second 12.
 */
export const MIN_FLIGHT_GPH = PLANNING_GPH;

/**
 * Minutes a quantity of fuel lasts at `PLANNING_GPH`. 64 gal is exactly 320
 * (05:20). An unknown or negative figure has no endurance, so NaN - never 0,
 * which would print as a planned 00:00.
 * @param {number} gal
 * @returns {number}
 */
export function minutesAtPlanningRate(gal) {
  const g = num(gal);
  return Number.isFinite(g) && g >= 0 ? g / PLANNING_GPH * 60 : NaN;
}

/**
 * Va against weight, `[weightLb, kt]`, from the POH table printed on the
 * form and repeated in `Performance!R7:S9`.
 *
 * THE TABLE IS USED AND INTERPOLATED, NOT THE SHEET'S LINEAR FORMULA. The
 * workbook computes `=110-(((3100-D14)*9)/500)`, which is exact at 3100 and
 * 2600 and gives 92 kt at 2100 where the table in the same workbook says
 * 91 - it states a Va ONE KNOT HIGHER than the POH at the light end, which
 * is the unsafe direction. The user's instruction was "Use POH table and
 * interpolate".
 */
export const VA_TABLE = [
  [2100, 91],
  [2600, 101],
  [3100, 110]
];

/**
 * The fleet, from `'AC REG'!A3:D7`, corroborated figure for figure by the
 * table printed on the form itself.
 *
 * `standardBagBLb` IS THE WORKBOOK'S `'AC REG'!D` COLUMN - 22.7 lb on LN-TRE,
 * nothing on the others - and since v16.97 it is a DEFAULT LOAD on the
 * compartment B line, not a hidden addition to the empty mass. The author:
 * "the standard baggage weights in the aircrafts should always be present
 * (7.3 lbs in comp A, 0.7 lbs in comp C and LNTRE has 22.7 lbs in comp B).
 * That should ALWAYS be defaulted whenever a plane is chosen." That is exactly
 * the workbook's arrangement: `OFP!D9` is `=VLOOKUP(A2,'AC REG'!A:D,4,FALSE)`,
 * the Baggage Area B cell itself, and the sheet's own note invites the pilot
 * to add extra baggage in that same cell. v16.93-v16.96 added it invisibly to
 * the empty mass instead, which gave the same numbers and a sheet whose
 * Basic Empty Mass line did not match the paper form's.
 *
 * NO PERSON IS NAMED IN THIS DATASET. The workbook's document properties
 * carry an author; a registration identifies a machine, which the user has
 * explicitly cleared for storage, and that is where it stops.
 */
export const FLEET = [
  { reg: 'LN-TRA', emptyWeightLb: 1993.6, emptyMomentInLb: 75870.2, standardBagBLb: 0 },
  { reg: 'LN-TRB', emptyWeightLb: 2020.3, emptyMomentInLb: 78756.2, standardBagBLb: 0 },
  { reg: 'LN-TRC', emptyWeightLb: 2031.1, emptyMomentInLb: 77121.6, standardBagBLb: 0 },
  { reg: 'LN-TRD', emptyWeightLb: 2024.5, emptyMomentInLb: 76587.7, standardBagBLb: 0 },
  { reg: 'LN-TRE', emptyWeightLb: 2038.5, emptyMomentInLb: 78989.1, standardBagBLb: 22.7 }
];

/** Where the numbers came from, shown in the UI so a stale sheet is visible. */
export const FLEET_SOURCE = {
  form: 'C182OFPMBv4.2.pdf',
  workbook: 'OFP-C182.xlsx',
  sheet: 'AC REG',
  /** Printed on page 2 of the form as "Version date 10.08.2026". */
  versionDate: '10.08.2026',
  operator: 'flight school OFP / M&B form'
};

/**
 * @param {unknown} v
 * @returns {number} `v` when it is a real number, otherwise NaN.
 */
function num(v) {
  if (v === null || v === undefined || v === '') return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * The aircraft with this registration, or null.
 * Case and surrounding space are forgiven; nothing else is.
 * @param {string|null|undefined} reg
 * @returns {Aircraft|null}
 */
export function aircraftByReg(reg) {
  if (typeof reg !== 'string') return null;
  const key = reg.trim().toUpperCase();
  for (const a of FLEET) if (a.reg === key) return a;
  return null;
}

/**
 * A weight and moment, with the arm derived rather than stored.
 *
 * ARM IS NEVER ROUNDED HERE, and that is a departure from the sheet worth
 * stating: `OFP!E11` rounds the take-off arm to 0.1 in while `E14` and `E15`
 * leave the landing and zero-fuel arms at full precision. Rounding one of
 * three identical calculations is an inconsistency, not a rule, so all three
 * are exact and the DISPLAY rounds - which reproduces every figure the sheet
 * prints while removing the asymmetry.
 *
 * @param {number} weightLb
 * @param {number} momentInLb
 * @returns {MassPoint}
 */
function point(weightLb, momentInLb) {
  return {
    weightLb,
    momentInLb,
    armIn: weightLb > 0 ? momentInLb / weightLb : null
  };
}

/**
 * The forward and aft CG limits at a weight, inches aft of datum.
 *
 * Derived from `CG_ENVELOPE` by intersecting the horizontal line at
 * `weightLb` with every edge of the closed ring and taking the extremes -
 * so which edges are "forward" and which "aft" is read out of the geometry
 * rather than hardcoded, and the envelope can be edited without touching
 * this. Endpoints are INCLUSIVE, so a weight exactly at a vertex, at the top
 * or at the bottom of the envelope gets real limits rather than falling
 * through a boundary case.
 *
 * @param {number} weightLb
 * @returns {{fwdIn: number, aftIn: number}|null} null when the weight is
 *   outside the envelope's own weight range, where there is no limit to
 *   state.
 */
export function armLimits(weightLb) {
  const w = num(weightLb);
  if (!Number.isFinite(w)) return null;
  /** @type {number[]} */
  const arms = [];
  const n = CG_ENVELOPE.length;
  for (let i = 0; i < n; i++) {
    const [a1, w1] = CG_ENVELOPE[i];
    const [a2, w2] = CG_ENVELOPE[(i + 1) % n];
    const lo = Math.min(w1, w2), hi = Math.max(w1, w2);
    if (w < lo || w > hi) continue;
    if (w1 === w2) { arms.push(a1, a2); continue; }
    arms.push(a1 + (a2 - a1) * ((w - w1) / (w2 - w1)));
  }
  if (!arms.length) return null;
  return { fwdIn: Math.min.apply(null, arms), aftIn: Math.max.apply(null, arms) };
}

/**
 * The moment a weight may carry, inch-pounds. The same limits as
 * `armLimits`, in the space the fuel burn is a straight line in.
 * @param {number} weightLb
 * @returns {{minInLb: number, maxInLb: number}|null}
 */
export function momentLimits(weightLb) {
  const lim = armLimits(weightLb);
  if (!lim) return null;
  return { minInLb: lim.fwdIn * weightLb, maxInLb: lim.aftIn * weightLb };
}

/**
 * Is this weight and arm inside the envelope? Boundaries count as inside -
 * a published limit is a value you may load to.
 * @param {number} weightLb
 * @param {number|null} armIn
 * @returns {'ok'|'fwd'|'aft'|'weight'|'unknown'} `weight` means the weight
 *   itself is outside the envelope's range, so the CG question does not
 *   arise; `unknown` means a figure was missing.
 */
export function envelopePosition(weightLb, armIn) {
  const w = num(weightLb), a = num(armIn);
  if (!Number.isFinite(w) || !Number.isFinite(a)) return 'unknown';
  const lim = armLimits(w);
  if (!lim) return 'weight';
  // A tenth of an inch is the precision the arms are published to, and a
  // hundredth of that is comfortably below anything a load sheet can state -
  // so this forgives binary float residue and nothing a pilot could type.
  const eps = 1e-6;
  if (a < lim.fwdIn - eps) return 'fwd';
  if (a > lim.aftIn + eps) return 'aft';
  return 'ok';
}

/**
 * Is the autopilot's forward CG limit satisfied? See
 * `AUTOPILOT_MIN_ARM_IN` for where the figure comes from and why this is a
 * caution rather than a limit.
 * @param {number} weightLb
 * @param {number|null} armIn
 * @returns {boolean}
 */
export function autopilotAllowed(weightLb, armIn) {
  const w = num(weightLb), a = num(armIn);
  if (!Number.isFinite(w) || !Number.isFinite(a)) return true;
  if (w > AUTOPILOT_LIMIT_MAX_LB) return true;
  return a >= AUTOPILOT_MIN_ARM_IN;
}

/**
 * Minutes that must be flown before the aircraft is light enough to land,
 * at `MIN_FLIGHT_GPH`.
 *
 * `OFP!N13` = `IF((D11>2950),((D11-2950)/6)/P4/24,0)` - the excess over MLW
 * in pounds, turned into gallons at the one density and then into hours at
 * the one rate. The `/24` there is Excel's day fraction; this returns
 * minutes, which is what every other duration in this app is.
 *
 * @param {number} takeoffWeightLb
 * @returns {number} 0 when the aircraft may land immediately.
 */
export function minFlightMinutes(takeoffWeightLb) {
  const w = num(takeoffWeightLb);
  if (!Number.isFinite(w) || w <= MLW_LB) return 0;
  return ((w - MLW_LB) / FUEL_LB_PER_GAL) / MIN_FLIGHT_GPH * 60;
}

/**
 * Va at a weight, knots, interpolated in the POH table.
 *
 * NULL BELOW THE TABLE rather than extrapolated. 2100 lb is below the empty
 * weight of every aircraft in the fleet plus a pilot, so this is close to
 * unreachable - and a Va invented for a weight the POH does not tabulate is
 * a speed a pilot would write on the form and fly to. Clamped at the top
 * instead, because a weight above 3100 lb is already reported as over MTOW
 * and Va is not the finding that matters there.
 *
 * @param {number} weightLb
 * @returns {number|null}
 */
export function vaKt(weightLb) {
  const w = num(weightLb);
  if (!Number.isFinite(w)) return null;
  const first = VA_TABLE[0], last = VA_TABLE[VA_TABLE.length - 1];
  if (w < first[0]) return null;
  if (w >= last[0]) return last[1];
  for (let i = 0; i < VA_TABLE.length - 1; i++) {
    const [w1, v1] = VA_TABLE[i], [w2, v2] = VA_TABLE[i + 1];
    if (w >= w1 && w <= w2) return v1 + (v2 - v1) * ((w - w1) / (w2 - w1));
  }
  return null;
}

/**
 * Best glide speed, knots, from the sheet's own formula
 * `=ROUND(76-(((3100-D11)*6)/500),0)`.
 *
 * FLAGGED, AND DIFFERENT IN KIND FROM Va. There is no POH glide table in
 * either source - the form prints a `V GLIDE` box with nothing behind it and
 * the workbook fills it with this straight line. So this reproduces the
 * school's figure and is labelled as the school's figure; it is not a POH
 * value and must not be presented as one.
 *
 * @param {number} weightLb
 * @returns {number|null}
 */
export function vGlideKt(weightLb) {
  const w = num(weightLb);
  if (!Number.isFinite(w)) return null;
  return Math.round(76 - ((3100 - w) * 6) / 500);
}

/**
 * The aircraft on its own: the published basic empty weight and moment,
 * exactly as the form's Basic Empty Mass line prints them. Nothing is added -
 * the standard items are LOADS (`standardLoads`), shown on their own lines.
 * @param {Aircraft} aircraft
 * @returns {MassPoint}
 */
export function emptyMass(aircraft) {
  return point(aircraft.emptyWeightLb, aircraft.emptyMomentInLb);
}

/**
 * What is always in the baggage compartment, in pounds: `OFP!D8` (7.3 lb at
 * A) and `OFP!D10` (0.7 lb at C) on every aircraft, typed as constants in the
 * workbook, and compartment B from `'AC REG'!D`. The workbook does not say
 * what the items are, so this does not either.
 */
export const STANDARD_BAGGAGE_LB = { bagALb: 7.3, bagCLb: 0.7 };

/**
 * The baggage lines an aircraft starts with, applied whenever that aircraft
 * is chosen. Seats are not touched: who is aboard is not a property of the
 * machine.
 * @param {Aircraft} aircraft
 * @returns {{bagALb: number, bagBLb: number, bagCLb: number}}
 */
export function standardLoads(aircraft) {
  return {
    bagALb: STANDARD_BAGGAGE_LB.bagALb,
    bagBLb: num(aircraft.standardBagBLb) || 0,
    bagCLb: STANDARD_BAGGAGE_LB.bagCLb
  };
}

/**
 * One sector's mass and balance.
 *
 * THE FUEL FIGURES ARE THE PLAN'S, NOT A TYPED GUESS, and that is the whole
 * point of building this here rather than leaving it in the spreadsheet.
 * `fuelDepGal` is what is on board when the sector's engine starts and
 * INCLUDES the taxi fuel it is about to burn - the user's instruction was
 * "Count taxi fuel in takeoff mass", and with `MTOW_LB` doubling as the ramp
 * limit that is the figure the limit applies to. `fuelArrGal` is what the
 * OFP says remains at the arrival fix, so the burn between them already
 * carries the taxi, the circuits and every pattern lap exactly as the fuel
 * column counts them. Nothing is recomputed here and nothing can disagree.
 *
 * WHY CHECKING THE TWO ENDS IS ENOUGH, and this is a proof rather than a
 * hope. Burning fuel moves the aeroplane along a STRAIGHT LINE in
 * (moment, weight): weight falls by one pound per pound and moment falls by
 * `FUEL_ARM_IN` per pound, both linear in the amount burned. The envelope is
 * CONVEX in that same space - its forward boundary `moment = arm(w) * w` is
 * convex on every edge (the second derivative is twice the edge's
 * `d(arm)/d(weight)`, positive on all three forward edges) and its slopes
 * are non-decreasing across both joins (33.00 -> 46.12, then 51.72 -> 70.90),
 * while the aft boundary is the straight line `moment = 46 * weight`. A
 * segment between two points of a convex set lies inside it. So if take-off
 * and landing are both legal, every intermediate weight is too, and there is
 * no interior case to sample for.
 *
 * The test asserts the convexity this rests on rather than taking it from
 * this comment, and separately sweeps the whole burn path - because an
 * argument in a docblock is not a guard.
 *
 * @param {Aircraft} aircraft
 * @param {StationLoads} stations Pounds at each station.
 * @param {number} fuelDepGal On board at engine start, US gallons.
 * @param {number} fuelArrGal Remaining at the arrival fix, US gallons.
 * @param {string} [label] What to call this sector in a message.
 * @returns {MassBalanceResult}
 */
export function computeMassBalance(aircraft, stations, fuelDepGal, fuelArrGal, label) {
  const bem = emptyMass(aircraft);
  let weight = bem.weightLb;
  let moment = bem.momentInLb;
  /** @type {Record<string, number>} */
  const loads = {};
  for (const key of Object.keys(STATION_ARMS)) {
    const lb = num(/** @type {any} */ (stations)[key]) || 0;
    loads[key] = lb;
    weight += lb;
    moment += lb * /** @type {any} */ (STATION_ARMS)[key];
  }
  const zeroFuel = point(weight, moment);

  const depGal = num(fuelDepGal);
  const arrGal = num(fuelArrGal);
  const depLb = depGal * FUEL_LB_PER_GAL;
  const arrLb = arrGal * FUEL_LB_PER_GAL;
  const takeoff = point(weight + depLb, moment + depLb * FUEL_ARM_IN);
  const landing = point(weight + arrLb, moment + arrLb * FUEL_ARM_IN);

  const res = {
    label: label || '',
    aircraft,
    loads: /** @type {StationLoads} */ (/** @type {any} */ (loads)),
    emptyMass: bem,
    zeroFuel,
    takeoff,
    landing,
    fuelDepGal: depGal,
    fuelArrGal: arrGal,
    burnGal: depGal - arrGal,
    checks: {
      takeoffWeight: takeoff.weightLb > MTOW_LB ? 'over' : 'ok',
      landingWeight: landing.weightLb > MLW_LB ? 'over' : 'ok',
      takeoffCg: envelopePosition(takeoff.weightLb, takeoff.armIn),
      landingCg: envelopePosition(landing.weightLb, landing.armIn),
      zeroFuelCg: envelopePosition(zeroFuel.weightLb, zeroFuel.armIn),
      autopilotTakeoff: autopilotAllowed(takeoff.weightLb, takeoff.armIn),
      autopilotLanding: autopilotAllowed(landing.weightLb, landing.armIn)
    },
    minFlightMin: minFlightMinutes(takeoff.weightLb),
    vaKt: vaKt(landing.weightLb),
    vGlideKt: vGlideKt(takeoff.weightLb)
  };
  return /** @type {MassBalanceResult} */ (res);
}

/**
 * Every sector's mass and balance, plus the master figures for the whole
 * mission.
 *
 * THE MASTER WALKS THE SECTORS; IT DOES NOT SUBTRACT A TOTAL. With a refuel
 * at a full stop the landing weight is NOT the take-off weight less the trip
 * burn, so a master computed that way would print a weight the aircraft
 * never has. `first` is the first sector's take-off and `last` is the last
 * sector's landing, both taken from the sector results themselves.
 *
 * `worstLanding` is the heaviest arrival anywhere in the mission, because
 * the MLW check has to be made at EVERY landing - the user's instruction was
 * "Check the landing weight / t&g weight for every stop to ensure we're
 * within limits (2950lbs)", and a master that only looked at the final
 * arrival would miss a mid-mission stop made heavy by a refuel.
 *
 * @param {Aircraft} aircraft
 * @param {StationLoads} stations
 * @param {Array<{fuelDepGal: number, fuelArrGal: number, label?: string}>} sectors
 * @returns {MassBalanceMission}
 */
export function computeMissionMassBalance(aircraft, stations, sectors) {
  const list = (sectors || []).map((s, i) =>
    computeMassBalance(aircraft, stations, s.fuelDepGal, s.fuelArrGal,
      s.label || ('sector ' + (i + 1))));
  /** @type {MassBalanceResult|null} */
  let worst = null;
  for (const r of list) {
    if (!worst || r.landing.weightLb > worst.landing.weightLb) worst = r;
  }
  // THE WHOLE-MISSION FUEL IS WALKED, NOT SUBTRACTED - the same rule as
  // `first` and `last` above. "Departure fuel minus arrival fuel" is the burn
  // only when nothing was taken on: refuel to 64 gal half way and a mission
  // that burned 44 reports 24. So the two things that happen to the tanks are
  // kept apart and each is summed where it happens:
  //   consumedGal   - burned IN each sector, taxi included (dep - arr)
  //   stopChangeGal - the NET change at the stops between them: a refuel adds,
  //                   circuit and ground minutes subtract. It is net on purpose:
  //                   a refuel is entered as the fuel AFTER, so the split
  //                   between uplift and ground burn is not something the plan
  //                   states, and inventing one would be a guess.
  // Together they reconcile exactly: depGal - consumedGal + stopChangeGal
  // is arrGal, which is what lets a printed sheet add up.
  let consumed = 0, stopChange = 0;
  for (let i = 0; i < list.length; i++) {
    consumed += list[i].fuelDepGal - list[i].fuelArrGal;
    if (i > 0) stopChange += list[i].fuelDepGal - list[i - 1].fuelArrGal;
  }
  const res = {
    aircraft,
    sectors: list,
    first: list.length ? list[0] : null,
    last: list.length ? list[list.length - 1] : null,
    worstLanding: worst,
    zeroFuel: list.length ? list[0].zeroFuel : emptyMass(aircraft),
    fuel: {
      depGal: list.length ? list[0].fuelDepGal : NaN,
      arrGal: list.length ? list[list.length - 1].fuelArrGal : NaN,
      consumedGal: list.length ? consumed : NaN,
      stopChangeGal: list.length ? stopChange : NaN
    }
  };
  return /** @type {MassBalanceMission} */ (res);
}

/**
 * What is wrong with this mission, in the words the red banner uses.
 *
 * ONE LIST FOR EVERY SURFACE. The banner, the M&B tab and the printed sheet
 * all take their wording from here, so a plan the app calls unusable cannot
 * read as clean on any of them (discipline rule 8). Each message NAMES the
 * sector and the figure, which is the v16.20 rule - "a non-numeric value
 * appeared" is not a finding a pilot can act on.
 *
 * A MISSING FIGURE IS A FINDING, NOT A ZERO. An absent fuel figure or an
 * unselected aircraft produces a message saying so, never a plausible
 * weight computed from nothing.
 *
 * @param {MassBalanceMission|null} mission
 * @returns {string[]}
 */
export function massBalanceProblems(mission) {
  /** @type {string[]} */
  const out = [];
  if (!mission || !mission.aircraft) {
    out.push('Mass & balance: no aircraft selected, so no weight or CG has been computed.');
    return out;
  }
  const reg = mission.aircraft.reg;
  if (!mission.sectors.length) {
    out.push('Mass & balance: ' + reg + ' has no sector to weigh.');
    return out;
  }
  /** @param {number} n */
  const f1 = (n) => (Math.round(n * 10) / 10).toFixed(1);
  for (const r of mission.sectors) {
    const where = r.label ? ' on ' + r.label : '';
    if (!Number.isFinite(r.fuelDepGal) || !Number.isFinite(r.fuelArrGal)) {
      out.push('Mass & balance: the fuel on board is not known' + where +
        ', so no take-off or landing mass can be stated.');
      continue;
    }
    if (r.checks.takeoffWeight === 'over') {
      out.push('Mass & balance: take-off mass ' + f1(r.takeoff.weightLb) +
        ' lb exceeds the ' + MTOW_LB + ' lb maximum' + where + '.');
    }
    if (r.checks.landingWeight === 'over') {
      out.push('Mass & balance: landing mass ' + f1(r.landing.weightLb) +
        ' lb exceeds the ' + MLW_LB + ' lb maximum' + where +
        ' - at ' + MIN_FLIGHT_GPH + ' gal/h that needs ' +
        Math.ceil(minFlightMinutes(r.takeoff.weightLb)) + ' min of flight first.');
    }
    /** @type {Array<[string, MassPoint, 'ok'|'fwd'|'aft'|'weight'|'unknown']>} */
    const cgs = [
      ['take-off', r.takeoff, r.checks.takeoffCg],
      ['landing', r.landing, r.checks.landingCg],
      ['zero-fuel', r.zeroFuel, r.checks.zeroFuelCg]
    ];
    for (const [name, pt, verdict] of cgs) {
      if (verdict === 'ok') continue;
      if (verdict === 'unknown') {
        out.push('Mass & balance: the ' + name + ' CG could not be computed' + where + '.');
        continue;
      }
      if (verdict === 'weight') {
        // The weight finding above already names this; saying the CG is
        // outside the envelope as well would be one fault reported twice.
        continue;
      }
      const lim = armLimits(pt.weightLb);
      const edge = lim ? (verdict === 'fwd' ? f1(lim.fwdIn) : f1(lim.aftIn)) : '?';
      out.push('Mass & balance: the ' + name + ' CG ' + f1(Number(pt.armIn)) +
        ' in is ' + (verdict === 'fwd' ? 'forward of the forward' : 'aft of the aft') +
        ' limit ' + edge + ' in at ' + f1(pt.weightLb) + ' lb' + where + '.');
    }
  }
  return out;
}

/**
 * Cautions: true but not disqualifying, so they are kept apart from
 * `massBalanceProblems` and must never raise the DO-NOT-USE banner.
 * @param {MassBalanceMission|null} mission
 * @returns {string[]}
 */
export function massBalanceCautions(mission) {
  /** @type {string[]} */
  const out = [];
  if (!mission || !mission.aircraft || !mission.sectors.length) return out;
  if (BAGGAGE_MAX_LB === null) {
    out.push('No maximum baggage weight is published in the OFP form or the ' +
      'workbook, so the baggage limit is NOT checked - check it against the POH.');
  }
  for (const r of mission.sectors) {
    const where = r.label ? ' on ' + r.label : '';
    if (!r.checks.autopilotTakeoff || !r.checks.autopilotLanding) {
      out.push('The CG is forward of ' + AUTOPILOT_MIN_ARM_IN + ' in' + where +
        ', which the OFP workbook draws as the autopilot limit below ' +
        AUTOPILOT_LIMIT_MAX_LB + ' lb - confirm against the autopilot supplement.');
    }
    if (r.vaKt === null) {
      out.push('Va is not tabulated below ' + VA_TABLE[0][0] + ' lb, so none is stated' +
        where + '.');
    }
  }
  return out;
}

/**
 * A registration, or null. Only the published fleet is accepted - a typed
 * tail that is not one of ours has no empty weight, and an M&B computed
 * against a guessed airframe is the plausible wrong answer.
 * @param {unknown} v
 * @returns {string|null}
 */
export function normaliseReg(v) {
  if (typeof v !== 'string') return null;
  const a = aircraftByReg(v);
  return a ? a.reg : null;
}

/**
 * The most a single station may be given, pounds.
 *
 * A TYPO GUARD, NOT A LIMIT, and the difference is the one REFUEL_MAX_GAL
 * turns on. The real limits are MTOW and the CG envelope, and both are
 * checked; this only catches a slipped decimal (1700 for 170). 1000 lb in one
 * seat is roughly the whole useful load of the aeroplane, so it cannot reject
 * a figure anybody would really load.
 */
/**
 * The whole-mission sheet: the weights the mission leaves with and comes back
 * at, as the author asked for ("a master OFP to show the start and final
 * weights") - built ONCE here so the screen and the printed page cannot
 * describe two different masters.
 *
 * **EVERY FIGURE IS THE ONE THAT BINDS THE WHOLE MISSION, NOT THE FIRST OR
 * THE LAST SECTOR'S.** Assembling it from `first` and `last` alone was wrong in
 * four places at once, and all four were silent on a one-sector mission:
 *   - the BURN was the first sector's, so the printed take-off minus consumed
 *     did not equal the printed landing;
 *   - the CHECKS were the first take-off's and the last landing's, so a heavy
 *     intermediate take-off after a refuel could print a green master;
 *   - Va came from the last landing, but Va falls with weight and the LIGHTEST
 *     landing is what binds it (the v16.93 rule), which a refuel can move to
 *     the middle of the mission;
 *   - Min FLT came from the first take-off, where the heaviest one binds.
 * A check that fails anywhere fails here, so the master can summarise but
 * never launder a sector's finding.
 *
 * @param {MassBalanceMission} m
 * @returns {MassBalanceResult & {stopChangeGal:number}|null}
 */
export function missionMaster(m) {
  if (!m || !m.first || !m.last) return null;
  /** @param {'takeoffWeight'|'landingWeight'|'takeoffCg'|'landingCg'|'zeroFuelCg'} k */
  const worst = (k) => {
    for (const r of m.sectors) if (r.checks[k] !== 'ok') return r.checks[k];
    return 'ok';
  };
  let lightest = m.sectors[0];
  let minFlt = 0;
  for (const r of m.sectors) {
    if (r.landing.weightLb < lightest.landing.weightLb) lightest = r;
    if (r.minFlightMin > minFlt) minFlt = r.minFlightMin;
  }
  return Object.assign({}, m.first, {
    label: 'Whole flight',
    landing: m.last.landing,
    fuelDepGal: m.fuel.depGal,
    fuelArrGal: m.fuel.arrGal,
    burnGal: m.fuel.consumedGal,
    stopChangeGal: m.fuel.stopChangeGal,
    checks: Object.assign({}, m.first.checks, {
      takeoffWeight: worst('takeoffWeight'),
      landingWeight: worst('landingWeight'),
      takeoffCg: worst('takeoffCg'),
      landingCg: worst('landingCg'),
      zeroFuelCg: worst('zeroFuelCg'),
      autopilotTakeoff: m.sectors.every((r) => r.checks.autopilotTakeoff),
      autopilotLanding: m.sectors.every((r) => r.checks.autopilotLanding)
    }),
    minFlightMin: minFlt,
    vaKt: vaKt(lightest.landing.weightLb)
  });
}

/**
 * The typo guard on a typed actual fuel figure, US gallons. The same bound,
 * and for the same reason, as a refuel's (`REFUEL_MAX_GAL`, anchors.js): the
 * planner holds no published usable-fuel figure, so it cannot tell 87 gal from
 * 90 and must not pretend to - but ~11x a C182's tanks is a slipped decimal.
 */
export const ACTUAL_FUEL_MAX_GAL = 1000;

/**
 * The actual fuel on board as the pilot typed it. `null` means nothing was
 * typed - there is no last minute change - and that is a different answer
 * from `0`, which is a real (if alarming) figure. Anything unreadable, below
 * zero or past the typo guard is NaN: REFUSED, not clamped, because a clamped
 * typo is a plausible wrong fuel load weighed as though it were right.
 * @param {unknown} v
 * @returns {number|null}
 */
export function normaliseActualFuelGal(v) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > ACTUAL_FUEL_MAX_GAL) return NaN;
  return Math.round(n * 10) / 10;
}

/**
 * THE LAST MINUTE CHANGE: the fuel actually on board at preflight against the
 * fuel the plan was made with (the author, v16.98: "Say i planned with 64GAL
 * and actual fuel is 60, then i can type in 60GAL actual and it will do
 * recalculations"). The form's LMC line exists for exactly this and nothing
 * else - v16.97 had also parked the whole-mission stop change on it.
 *
 * It is a change at the FIRST engine start, and it follows the fuel from
 * there: every sector flown on those tanks departs and arrives with the same
 * difference, until a full stop REFUELS to a stated figure - after which the
 * tanks hold what the refuel says, whatever was aboard before. A touch & go or
 * a full stop without a refuel carries it on, because the fuel is still the
 * fuel that was aboard.
 *
 * The first sector's departure is set to the typed figure EXACTLY rather than
 * to planned + delta, so 64 - 4 cannot print as 59.99999.
 *
 * @template {{fuelDepGal: number, fuelArrGal: number, refuelled?: boolean}} S
 * @param {S[]} sectors in flight order; `refuelled` marks a sector that
 *   starts from a refuel at the stop before it.
 * @param {number|null} actualGal from `normaliseActualFuelGal`
 * @returns {{sectors: Array<S & {lmcGal: number}>, plannedGal: number,
 *   actualGal: number|null, deltaGal: number|null, reach: number}}
 *   `deltaGal` is null when no change applies; `reach` is how many sectors it
 *   reached.
 */
export function applyActualFuel(sectors, actualGal) {
  const list = (sectors || []).map((s) => Object.assign({}, s, { lmcGal: 0 }));
  const planned = list.length ? num(list[0].fuelDepGal) : NaN;
  const none = { sectors: list, plannedGal: planned, actualGal: null, deltaGal: null, reach: 0 };
  if (actualGal === null || actualGal === undefined || !Number.isFinite(actualGal) || !Number.isFinite(planned)) return none;
  const delta = actualGal - planned;
  let reach = 0;
  for (let i = 0; i < list.length; i++) {
    if (i > 0 && list[i].refuelled) break;
    list[i].fuelDepGal = i === 0 ? actualGal : list[i].fuelDepGal + delta;
    list[i].fuelArrGal = list[i].fuelArrGal + delta;
    list[i].lmcGal = delta;
    reach++;
  }
  return { sectors: list, plannedGal: planned, actualGal, deltaGal: delta, reach };
}

/**
 * What the actual fuel makes wrong, for the red banner. The OFP's own
 * negative-fuel rule reads the PLANNED fuel column, which a last minute change
 * does not touch, so without this a pilot who typed 20 gal actual for a
 * 34 gal trip would get a recalculated M&B sheet and no warning.
 * @param {{sectors: Array<{fuelArrGal: number, label?: string, lmcGal: number}>,
 *   actualGal: number|null, deltaGal: number|null, reach: number}} applied
 * @returns {string[]}
 */
export function actualFuelProblems(applied) {
  if (!applied || applied.deltaGal === null) return [];
  /** @type {string[]} */
  const out = [];
  for (const s of applied.sectors.slice(0, applied.reach)) {
    if (!Number.isFinite(s.fuelArrGal) || s.fuelArrGal >= 0) continue;
    out.push('Last minute change: with ' + Number(applied.actualGal).toFixed(1) + ' gal actually on board the fuel ' +
      'remaining goes NEGATIVE' + (s.label ? ' on ' + s.label : '') + ' (' + s.fuelArrGal.toFixed(1) + ' gal) - ' +
      'the mission does not fit the fuel on board.');
  }
  return out;
}

export const STATION_MAX_LB = 1000;

/**
 * Station loads, validated on every read.
 *
 * They can arrive from `localStorage`, which is hand-editable, so this is the
 * same arrangement `normaliseFixStyle` has: values are stored already-checked
 * and re-checked on the way out, and anything unreadable falls back to 0
 * rather than to NaN. A station carrying NaN would make the whole take-off
 * mass NaN, which reads as "no M&B" when the pilot has simply left a seat
 * empty - and an empty seat IS zero.
 *
 * @param {unknown} o
 * @returns {StationLoads}
 */
export function normaliseStationLoads(o) {
  const src = (o && typeof o === 'object') ? /** @type {any} */ (o) : {};
  /** @type {any} */
  const out = {};
  for (const key of Object.keys(STATION_ARMS)) {
    const n = Number(src[key]);
    out[key] = Number.isFinite(n) ? Math.min(STATION_MAX_LB, Math.max(0, n)) : 0;
  }
  return /** @type {StationLoads} */ (out);
}

/**
 * Everything an inline CG chart needs, in SVG pixel coordinates.
 *
 * PURE ON PURPOSE. The page emits `<svg>` from this and computes no geometry
 * of its own, so what the chart draws and what `envelopePosition` decides are
 * the same envelope - the v16.35 rule that made the fix-style preview call the
 * map's own `fixSymbolSvg`.
 *
 * **THE AXES EXPAND TO INCLUDE THE MARKS.** A chart that clipped the very
 * point that is out of limits would hide the one thing it exists to show, so
 * the range is the envelope's own box widened to hold every mark, then padded.
 * The envelope is drawn at its true size either way; it is the VIEW that grows.
 *
 * @param {Array<{key: string, label: string, weightLb: number, armIn: number|null}>} marks
 * @param {{width?: number, height?: number, pad?: number, padL?: number, padR?: number, padT?: number, padB?: number}} [opts]
 * @returns {CgChartModel}
 */
export function cgChartModel(marks, opts) {
  const width = (opts && opts.width) || 320;
  const height = (opts && opts.height) || 240;
  const pad = (opts && opts.pad) || 34;
  // THE PLOT AREA HAS ITS OWN MARGINS (v16.97): room on the left for the
  // weight labels and below for the arm labels, and only a little on the other
  // two sides - a symmetric pad wasted a quarter of a sidebar-width chart.
  const padL = (opts && opts.padL) || pad, padR = (opts && opts.padR) || Math.round(pad / 3);
  const padT = (opts && opts.padT) || Math.round(pad / 3), padB = (opts && opts.padB) || pad;

  let aLo = Infinity, aHi = -Infinity, wLo = Infinity, wHi = -Infinity;
  for (const [a, w] of CG_ENVELOPE) {
    if (a < aLo) aLo = a; if (a > aHi) aHi = a;
    if (w < wLo) wLo = w; if (w > wHi) wHi = w;
  }
  const drawable = (marks || []).filter(
    (m) => Number.isFinite(m.weightLb) && Number.isFinite(Number(m.armIn)));
  for (const m of drawable) {
    const a = Number(m.armIn), w = m.weightLb;
    if (a < aLo) aLo = a; if (a > aHi) aHi = a;
    if (w < wLo) wLo = w; if (w > wHi) wHi = w;
  }
  // A margin so a point sitting exactly on a limit is not drawn on the frame,
  // then out to whole grid steps so the frame IS a gridline on every side -
  // a chart read by eye is read against its grid.
  const aPad = Math.max(0.5, (aHi - aLo) * 0.06);
  const wPad = Math.max(50, (wHi - wLo) * 0.06);
  aLo = Math.floor(aLo - aPad); aHi = Math.ceil(aHi + aPad);
  wLo = Math.floor((wLo - wPad) / 100) * 100; wHi = Math.ceil((wHi + wPad) / 100) * 100;

  const plot = { x0: padL, x1: width - padR, y0: padT, y1: height - padB };
  /** @param {number} a @param {number} w */
  const px = (a, w) => ({
    x: plot.x0 + ((a - aLo) / (aHi - aLo)) * (plot.x1 - plot.x0),
    // Weight grows UPWARDS, as it does on the paper chart.
    y: plot.y1 - ((w - wLo) / (wHi - wLo)) * (plot.y1 - plot.y0)
  });

  /** @param {number[][]} pts */
  const path = (pts) => pts.map(([a, w]) => px(a, w));

  // MAJOR lines every inch and every 100 lb, labelled; MINOR every half inch
  // and 50 lb. Labels thin out (every 2 in / 200 lb) only when the steps get
  // too close to read, which depends on the size the chart is drawn at.
  const aStep = (plot.x1 - plot.x0) / (aHi - aLo) < 16 ? 2 : 1;
  const wStep = (plot.y1 - plot.y0) / ((wHi - wLo) / 100) < 13 ? 200 : 100;
  /** @type {Array<{arm:number, x:number, label:boolean}>} */
  const gridX = [];
  for (let a = aLo; a <= aHi + 1e-9; a += 1) gridX.push({ arm: a, x: px(a, wLo).x, label: a % aStep === 0 });
  /** @type {Array<{weight:number, y:number, label:boolean}>} */
  const gridY = [];
  for (let w = wLo; w <= wHi + 1e-9; w += 100) gridY.push({ weight: w, y: px(aLo, w).y, label: w % wStep === 0 });
  /** @type {number[]} */
  const minorX = [];
  for (let a = aLo + 0.5; a < aHi; a += 1) minorX.push(px(a, wLo).x);
  /** @type {number[]} */
  const minorY = [];
  for (let w = wLo + 50; w < wHi; w += 100) minorY.push(px(aLo, w).y);

  const top = CG_ENVELOPE.filter(([, w]) => w === MTOW_LB);
  const byKey = (/** @type {string} */ k) => drawable.find((m) => m.key === k);
  const to = byKey('TO'), ldg = byKey('LDG');
  const res = {
    width, height, pad, plot,
    armRange: [aLo, aHi],
    weightRange: [wLo, wHi],
    envelope: path(CG_ENVELOPE),
    // The reference lines the workbook draws beside the envelope, and the
    // MTOW edge on its own so it can be labelled where it is.
    autopilot: path([[AUTOPILOT_MIN_ARM_IN, 1800], [AUTOPILOT_MIN_ARM_IN, AUTOPILOT_LIMIT_MAX_LB]]),
    mlw: path([[39, MLW_LB], [46, MLW_LB]]),
    mtow: path(top.length >= 2 ? [top[0], top[top.length - 1]] : []),
    // The fuel burns along a straight line from take-off to landing - the
    // path the aircraft actually moves along, and the reason checking its two
    // ends is enough (see computeMassBalance).
    burn: to && ldg ? path([[Number(to.armIn), to.weightLb], [Number(ldg.armIn), ldg.weightLb]]) : [],
    gridX, gridY, minorX, minorY,
    marks: drawable.map((m) => {
      const p = px(Number(m.armIn), m.weightLb);
      return {
        key: m.key, label: m.label, x: p.x, y: p.y,
        weightLb: m.weightLb, armIn: Number(m.armIn),
        verdict: envelopePosition(m.weightLb, Number(m.armIn))
      };
    }),
    // A mark with no arm or no weight cannot be plotted, and saying so beats
    // dropping it silently - the pilot would read an absent point as "fine".
    undrawn: (marks || []).filter(
      (m) => !(Number.isFinite(m.weightLb) && Number.isFinite(Number(m.armIn)))).map((m) => m.key)
  };
  return /** @type {CgChartModel} */ (res);
}
