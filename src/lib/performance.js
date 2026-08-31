/**
 * C182T performance engine - the POH numbers and the arithmetic on top of
 * them. Extracted from section 4 of the page script (v16.13).
 *
 * Every figure here is read straight from the Cessna Model 182T NAV III
 * POH (182TPHBUS-00, Section 5). Nothing in this file is estimated,
 * interpolated from another aircraft, or adjusted for convenience:
 *   - Climb:  Fig 5-8 Sheet 2, "Time, Fuel and Distance to Climb",
 *             3100 lb, Normal Climb 90 KIAS, standard temperature.
 *             Per POH note: time/fuel/dist +10% per 10 degC above ISA.
 *   - Cruise: Fig 5-9 Sheets 1-11, "Cruise Performance", 3100 lb,
 *             recommended lean, cowl flaps closed. Full RPM x MP x
 *             altitude x temperature dataset.
 * Rows the POH leaves partially blank (dashes) are omitted, so the usable
 * MP ceiling at each altitude acts as the full-throttle cap.
 *
 * No DOM and no I/O. The one input that is not an argument is the
 * aircraft profile (MANUAL overrides, cruise-climb figures, default
 * RPM/MP), which the page owns because it is what the settings form
 * edits and localStorage persists. It is INJECTED here rather than read
 * off the global scope: setAircraftProfile() takes the page's object by
 * reference, and until it is called the module runs on POH defaults, so
 * `require()`ing this file on its own works. syncDefaultOatToIsa() stays
 * in the page because it reads and writes input elements.
 */

// Cumulative from sea level: [pressureAlt, timeMin, fuelGal, distNM]
export const C182T_CLIMB = [
  [0,     0,  0.0,  0],
  [2000,  3,  0.8,  5],
  [4000,  6,  1.6, 10],
  [6000, 10,  2.5, 16],
  [8000, 14,  3.5, 23],
  [10000,19,  4.6, 31]
];

// C182T_CRUISE[pressureAlt][rpm][mp] =
//   [%MCP(std), tasCold, gphCold, tasStd, gphStd, tasHot, gphHot]
// where cold/std/hot are ISA-20 / ISA / ISA+20 for that altitude.
export const C182T_CRUISE = {
  0: {
    2400: { 25:[81,134,14.5,136,14.0,138,13.5], 24:[76,132,13.6,133,13.2,135,12.8], 23:[71,129,12.8,130,12.4,131,12.1], 22:[67,126,12.1,127,11.7,127,11.4], 21:[62,122,11.4,122,11.1,123,10.8], 20:[58,118,10.7,118,10.4,118,10.2] },
    2300: { 25:[78,133,13.9,135,13.4,136,13.0], 24:[73,130,13.2,132,12.7,132,12.3], 23:[69,127,12.4,128,12.0,129,11.7], 22:[65,124,11.7,124,11.4,125,11.1], 21:[60,120,11.1,120,10.8,121,10.5], 20:[56,116,10.4,116,10.2,116,9.9] },
    2200: { 26:[79,133,14.2,135,13.6,136,13.2], 25:[75,131,13.4,133,12.9,134,12.6], 24:[71,129,12.7,130,12.3,130,11.9], 23:[66,126,12.0,126,11.7,126,11.3], 22:[62,122,11.4,122,11.1,123,10.8], 21:[58,118,10.8,119,10.5,118,10.2], 20:[54,114,10.2,114,9.9,114,9.7] },
    2100: { 27:[79,133,14.2,135,13.7,136,13.2], 26:[75,131,13.4,133,13.0,134,12.6], 25:[71,129,12.8,130,12.4,130,12.0], 24:[67,126,12.1,127,11.8,127,11.4], 23:[63,123,11.5,123,11.2,123,10.9], 22:[59,119,10.9,120,10.6,120,10.4], 21:[55,115,10.4,116,10.1,115,9.9], 20:[51,111,9.8,111,9.6,111,9.3] },
    2000: { 27:[75,131,13.4,133,13.0,134,12.6], 26:[71,129,12.8,130,12.4,131,12.0], 25:[67,126,12.2,127,11.8,127,11.5], 24:[64,123,11.6,124,11.3,124,11.0], 23:[60,120,11.0,120,10.7,121,10.5], 22:[56,116,10.5,117,10.2,116,10.0], 21:[53,113,10.0,112,9.7,112,9.5], 20:[49,108,9.4,108,9.2,108,9.0] }
  },
  2000: {
    2400: { 24:[79,136,14.1,138,13.6,139,13.2], 23:[74,133,13.3,134,12.8,135,12.4], 22:[69,130,12.5,131,12.1,131,11.7], 21:[65,126,11.8,126,11.4,127,11.1], 20:[60,122,11.0,122,10.7,122,10.5] },
    2300: { 25:[80,137,14.4,139,13.9,140,13.4], 24:[76,134,13.6,136,13.1,137,12.7], 23:[71,131,12.8,133,12.4,133,12.0], 22:[67,128,12.1,128,11.7,129,11.4], 21:[62,124,11.4,124,11.1,125,10.8], 20:[58,120,10.7,120,10.5,120,10.2] },
    2200: { 25:[77,135,13.8,137,13.3,138,12.9], 24:[73,132,13.1,134,12.6,134,12.3], 23:[69,129,12.4,130,12.0,130,11.6], 22:[64,126,11.7,126,11.4,127,11.0], 21:[60,122,11.1,122,10.8,122,10.5], 20:[56,118,10.5,118,10.2,118,9.9] },
    2100: { 26:[77,135,13.9,137,13.4,138,12.9], 25:[73,133,13.1,134,12.7,134,12.3], 24:[69,130,12.5,131,12.1,131,11.7], 23:[65,127,11.8,127,11.5,127,11.2], 22:[61,123,11.2,123,10.9,124,10.6], 21:[57,119,10.6,119,10.4,119,10.1], 20:[53,115,10.1,115,9.8,115,9.6] },
    2000: { 26:[73,133,13.1,134,12.7,134,12.3], 25:[69,130,12.5,131,12.1,131,11.8], 24:[66,127,11.9,128,11.5,128,11.2], 23:[62,124,11.3,124,11.0,124,10.7], 22:[58,120,10.8,120,10.5,120,10.2], 21:[54,116,10.2,116,10.0,116,9.7], 20:[51,112,9.7,112,9.4,111,9.2] }
  },
  4000: {
    2400: { 24:[81,140,14.6,142,14.0,143,13.6], 23:[76,138,13.7,139,13.2,139,12.8], 22:[72,134,12.9,135,12.5,135,12.1], 21:[67,130,12.1,131,11.7,131,11.4], 20:[62,126,11.4,126,11.1,126,10.8] },
    2300: { 24:[78,138,14.0,140,13.5,141,13.1], 23:[74,135,13.2,137,12.8,137,12.4], 22:[69,132,12.5,133,12.1,133,11.7], 21:[65,128,11.7,128,11.4,129,11.1], 20:[60,124,11.1,124,10.7,124,10.5] },
    2200: { 25:[79,139,14.2,141,13.7,142,13.2], 24:[75,136,13.4,138,13.0,138,12.6], 23:[71,133,12.7,134,12.3,134,11.9], 22:[66,130,12.0,130,11.7,130,11.3], 21:[62,126,11.4,126,11.0,126,10.7], 20:[58,122,10.7,122,10.4,121,10.2] },
    2100: { 25:[75,137,13.5,138,13.0,138,12.6], 24:[71,134,12.8,135,12.4,135,12.0], 23:[67,131,12.2,131,11.8,131,11.4], 22:[63,127,11.5,127,11.2,127,10.9], 21:[59,123,10.9,123,10.6,123,10.3], 20:[55,119,10.3,119,10.1,118,9.8] },
    2000: { 25:[71,134,12.8,135,12.4,135,12.1], 24:[68,131,12.2,131,11.8,132,11.5], 23:[64,127,11.6,128,11.3,128,11.0], 22:[60,124,11.0,124,10.7,124,10.4], 21:[56,120,10.5,120,10.2,120,9.9], 20:[52,116,9.9,115,9.7,115,9.4] }
  },
  6000: {
    2400: { 23:[79,142,14.2,143,13.6,144,13.2], 22:[74,138,13.3,139,12.8,139,12.4], 21:[69,135,12.5,135,12.1,135,11.7], 20:[65,130,11.7,130,11.4,131,11.1], 19:[60,126,11.0,126,10.7,125,10.4] },
    2300: { 23:[76,140,13.6,141,13.1,141,12.7], 22:[71,136,12.8,137,12.4,137,12.0], 21:[67,132,12.1,133,11.7,133,11.4], 20:[62,128,11.4,128,11.0,128,10.7], 19:[58,124,10.7,123,10.4,123,10.1] },
    2200: { 23:[73,137,13.1,138,12.6,138,12.3], 22:[69,134,12.4,134,12.0,135,11.6], 21:[64,130,11.7,130,11.3,130,11.0], 20:[60,126,11.0,126,10.7,125,10.4], 19:[56,121,10.4,121,10.1,120,9.9] },
    2100: { 23:[69,135,12.5,135,12.1,135,11.7], 22:[65,131,11.8,131,11.5,131,11.1], 21:[61,127,11.2,127,10.9,127,10.6], 20:[57,123,10.6,122,10.3,122,10.0], 19:[53,118,10.0,118,9.8,117,9.5] },
    2000: { 23:[66,131,11.9,132,11.5,132,11.2], 22:[62,127,11.3,128,11.0,128,10.7], 21:[58,124,10.7,123,10.4,123,10.2], 20:[54,119,10.2,119,9.9,118,9.7], 19:[50,115,9.6,114,9.4,113,9.1] }
  },
  8000: {
    2400: { 21:[72,139,12.9,139,12.5,140,12.1], 20:[67,134,12.1,135,11.7,135,11.4], 19:[62,130,11.4,130,11.0,130,10.7], 18:[57,125,10.6,124,10.3,124,10.1] },
    2300: { 21:[69,136,12.5,137,12.0,137,11.7], 20:[64,132,11.7,132,11.3,132,11.0], 19:[60,128,11.0,127,10.7,127,10.4], 18:[55,122,10.3,122,10.1,121,9.8] },
    2200: { 21:[66,134,12.0,134,11.6,134,11.3], 20:[62,130,11.3,130,11.0,129,10.7], 19:[57,125,10.7,125,10.4,124,10.1], 18:[53,120,10.1,119,9.8,119,9.5] },
    2100: { 21:[63,131,11.5,131,11.2,131,10.8], 20:[59,127,10.9,126,10.6,126,10.3], 19:[55,122,10.3,121,10.0,121,9.7], 18:[50,117,9.7,116,9.4,115,9.2] },
    2000: { 21:[60,128,11.0,127,10.7,127,10.4], 20:[56,123,10.4,123,10.1,122,9.9], 19:[52,118,9.9,118,9.6,117,9.4] }
  },
  10000: {
    2400: { 20:[69,139,12.5,139,12.1,139,11.7], 19:[64,134,11.7,134,11.3,134,11.0], 18:[59,129,11.0,129,10.6,128,10.3] },
    2300: { 21:[71,141,12.8,141,12.4,142,12.0], 20:[66,136,12.1,137,11.7,136,11.3], 19:[62,132,11.3,132,11.0,131,10.7], 18:[57,126,10.6,126,10.3,125,10.1] },
    2200: { 20:[64,134,11.6,134,11.3,133,10.9], 19:[59,129,11.0,129,10.6,128,10.4], 18:[55,124,10.3,123,10.0,123,9.8] },
    2100: { 20:[61,131,11.2,130,10.8,130,10.5], 19:[56,126,10.5,125,10.2,125,10.0], 18:[52,121,9.9,120,9.7,119,9.4] },
    2000: { 20:[58,127,10.7,127,10.4,126,10.1], 19:[54,122,10.1,122,9.8,121,9.6], 18:[50,117,9.6,116,9.3,115,9.0] }
  },
  12000: {
    2400: { 18:[61,133,11.3,133,10.9,133,10.6], 17:[56,127,10.5,127,10.2,126,10.0], 16:[51,121,9.8,120,9.6,119,9.3] },
    2300: { 18:[59,131,10.9,130,10.6,130,10.3], 17:[54,125,10.2,124,10.0,123,9.7], 16:[50,118,9.6,118,9.3,117,9.0] },
    2200: { 18:[57,128,10.6,128,10.3,127,10.0], 17:[52,122,9.9,121,9.7,121,9.4] },
    2100: { 18:[54,125,10.2,124,9.9,123,9.6], 17:[50,119,9.6,118,9.3,117,9.1] },
    2000: { 19:[55,126,10.4,125,10.1,125,9.8], 18:[51,121,9.8,120,9.5,119,9.3] }
  },
  14000: {
    2400: { 16:[53,126,10.1,125,9.8,124,9.6], 15:[48,118,9.4,117,9.1,116,8.9] },
    2300: { 16:[51,123,9.8,122,9.6,121,9.3] },
    2200: { 16:[49,120,9.6,119,9.3,118,9.0] },
    2100: { 16:[47,116,9.2,115,8.9,114,8.7] }
  }
};
export const C182T_LEVELS = [0, 2000, 4000, 6000, 8000, 10000, 12000, 14000];

// The aircraft profile is the page's object, handed over by reference at
// startup (see setAircraftProfile). These defaults mirror the page's own
// and only apply when the module is used standalone - e.g. in unit tests.
const DEFAULT_PROFILE = {
  mode: 'C182T', cruiseRpm: 2300, cruiseMp: 23, cruiseTas: 130, cruiseFf: 12.5,
  climbMode: 'CRUISECLIMB', ccRoc: 500, ccKias: 90, ccFf: 15.0,
  roc: 700, climbTas: 90, climbFf: 15.0, rod: 500, descTas: 120, descFf: 8.5
};
let profile = DEFAULT_PROFILE;

/** Hand the module the live profile object. Held by reference, so later
 *  edits to its fields (settings form, imported route) are seen here. */
export function setAircraftProfile(p) {
  if (p && typeof p === 'object') profile = p;
  return profile;
}
export function activeAircraftProfile() { return profile; }

export function isaTemp(alt) { return 15 - 2 * alt / 1000; }

// Cumulative climb figures at an arbitrary altitude, linear between POH
// rows; above 10,000 ft extrapolates the last segment (POH table ends
// there), capped at 14,000 ft.
export function climbCumulative(alt) {
  const a = Math.max(0, Math.min(14000, alt));
  const tbl = C182T_CLIMB;
  let lo = tbl[0], hi = tbl[tbl.length - 1];
  if (a >= hi[0]) {
    const p = tbl[tbl.length - 2], q = tbl[tbl.length - 1];
    const f = (a - q[0]) / (q[0] - p[0]);
    return { t: q[1] + f * (q[1] - p[1]), f: q[2] + f * (q[2] - p[2]), d: q[3] + f * (q[3] - p[3]) };
  }
  for (let i = 0; i < tbl.length - 1; i++) {
    if (tbl[i][0] <= a && a <= tbl[i + 1][0]) { lo = tbl[i]; hi = tbl[i + 1]; break; }
  }
  const f = (a - lo[0]) / (hi[0] - lo[0] || 1);
  return { t: lo[1] + f * (hi[1] - lo[1]), f: lo[2] + f * (hi[2] - lo[2]), d: lo[3] + f * (hi[3] - lo[3]) };
}

// POH climb between two altitudes, with the POH's "+10% per 10 degC above
// standard" correction. Average climb TAS falls straight out of the table
// (air distance / time), so no separate climb-TAS assumption is needed.
export function climbPerf(fromAlt, toAlt, oat) {
  if (profile.mode === 'MANUAL') {
    const t = (toAlt - fromAlt) / Math.max(1, profile.roc);
    return { timeMin: t, fuelGal: (t / 60) * profile.climbFf, tasAvg: profile.climbTas };
  }
  // Reduced-power cruise climb (e.g. 23"/2400/90 KIAS). Fig 5-8 assumes
  // FULL THROTTLE, so it would understate the time of a partial-power
  // climb; here ROC and FF are the pilot's own observed figures, and TAS
  // is derived from climb KIAS at the mid-climb altitude (~2%/1000 ft).
  if (profile.climbMode === 'CRUISECLIMB') {
    const t = (toAlt - fromAlt) / Math.max(1, profile.ccRoc);
    const midAlt = (fromAlt + toAlt) / 2;
    const tas = profile.ccKias * (1 + 0.02 * midAlt / 1000);
    return { timeMin: t, fuelGal: (t / 60) * profile.ccFf, tasAvg: tas };
  }
  const a = climbCumulative(fromAlt);
  const b = climbCumulative(toAlt);
  let t = Math.max(0.05, b.t - a.t);
  let f = Math.max(0, b.f - a.f);
  const d = Math.max(0.1, b.d - a.d);
  const tasAvg = d / (t / 60);
  const dIsa = oat - isaTemp(toAlt);
  const k = dIsa > 0 ? 1 + 0.10 * (dIsa / 10) : 1;   // POH note 2
  return { timeMin: t * k, fuelGal: f * k, tasAvg: tasAvg };
}

// One (altitude level, rpm, mp) cell with temperature interpolation on
// ISA deviation, clamped to the POH's +/-20 degC envelope. MP is capped
// to what the table lists at that level (= full throttle with altitude).
export function cruiseAtLevel(level, rpm, mp, oat) {
  const bank = C182T_CRUISE[level];
  const rpms = Object.keys(bank).map(Number);
  const useRpm = rpms.includes(rpm)
    ? rpm
    : rpms.reduce((p, c) => Math.abs(c - rpm) < Math.abs(p - rpm) ? c : p);
  const rows = bank[useRpm];
  const mps = Object.keys(rows).map(Number);
  const useMp = Math.min(Math.max(mp, Math.min(...mps)), Math.max(...mps));
  const r = rows[useMp];
  const dIsa = Math.max(-20, Math.min(20, oat - isaTemp(level)));
  let tas, gph;
  if (dIsa <= 0) {
    const t = (dIsa + 20) / 20;
    tas = r[1] + t * (r[3] - r[1]);
    gph = r[2] + t * (r[4] - r[2]);
  } else {
    const t = dIsa / 20;
    tas = r[3] + t * (r[5] - r[3]);
    gph = r[4] + t * (r[6] - r[4]);
  }
  return { tas, gph, mcp: r[0], usedMp: useMp, usedRpm: useRpm };
}

// Cruise TAS/GPH for any altitude & OAT. C182T mode: POH Fig 5-9 with
// altitude + temperature interpolation. MANUAL mode: user's fixed values.
export function cruisePerf(alt, oat, rpmOpt, mpOpt) {
  if (profile.mode === 'MANUAL' && rpmOpt === undefined) {
    return { tas: Math.round(profile.cruiseTas), gph: Number(Number(profile.cruiseFf).toFixed(1)), mcp: null, usedMp: null, usedRpm: null };
  }
  const rpm = rpmOpt !== undefined ? Number(rpmOpt) : (profile.cruiseRpm || 2300);
  const mp = mpOpt !== undefined ? Number(mpOpt) : (profile.cruiseMp || 23);
  const a = Math.max(0, Math.min(14000, alt));
  let lo = 0, hi = 14000;
  for (let i = 0; i < C182T_LEVELS.length - 1; i++) {
    if (C182T_LEVELS[i] <= a && a <= C182T_LEVELS[i + 1]) { lo = C182T_LEVELS[i]; hi = C182T_LEVELS[i + 1]; break; }
  }
  const rLo = cruiseAtLevel(lo, rpm, mp, oat);
  const rHi = cruiseAtLevel(hi, rpm, mp, oat);
  const f = (a - lo) / (hi - lo || 1);
  return {
    tas: Math.round(rLo.tas + f * (rHi.tas - rLo.tas)),
    gph: Number((rLo.gph + f * (rHi.gph - rLo.gph)).toFixed(1)),
    mcp: Math.round(rLo.mcp + f * (rHi.mcp - rLo.mcp)),
    usedMp: rHi.usedMp,       // report the more restrictive (higher-alt) cap
    usedRpm: rHi.usedRpm
  };
}

export const toRad = deg => deg * Math.PI / 180;
export const toDeg = rad => rad * 180 / Math.PI;

// Wind Correction Angle. Clamped so wind stronger than TAS cannot produce
// NaN out of Math.asin (which previously poisoned MH / GS / time / fuel).
export function calcWCA(tas, wspd, wAngleRad) {
  if (!tas || tas <= 0 || !wspd || wspd <= 0) return 0;
  const ratio = (wspd * Math.sin(wAngleRad)) / tas;
  return Math.round(toDeg(Math.asin(Math.max(-1, Math.min(1, ratio)))));
}
