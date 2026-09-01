/**
 * Daylight and the day-VFR window - extracted from the DAYLIGHT & VFR DAY
 * section of the page script (v16.16).
 *
 * LEGAL BASIS (verified Aug 2026), and the reason this is not a
 * convenience feature: SERA Article 2(97), Regulation (EU) 923/2012 -
 * "'night' means the hours between the end of evening civil twilight and
 * the beginning of morning civil twilight. Civil twilight ends in the
 * evening when the centre of the sun's disc is 6 degrees below the
 * horizon and begins in the morning when the centre of the sun's disc is
 * 6 degrees below the horizon." Norway applies SERA via BSL F 1-1
 * (forskrift 2016-12-14-1578) WITHOUT prescribing any other night
 * period, so the -6 degree civil-twilight boundary IS the Norwegian
 * day/night VFR boundary - not sunset. Day-VFR window = morning CT to
 * evening CT.
 *
 * Solar positions: NOAA Global Monitoring Laboratory equations (Meeus),
 * cross-checked against USNO almanac data for 69.7N - including polar
 * night and midnight sun - to within 2 minutes. NOAA states accuracy
 * degrades beyond 72 degrees latitude, and the card warns there.
 *
 * Pure: no DOM, no I/O. computeDaylight returns UTC milliseconds and the
 * polar flags; formatting for the card, and the card itself, stay in the
 * page. The exception to "pure" worth knowing: fmtLocalHM and
 * localDateStrOf deliberately render in the HOST timezone, because the
 * pilot reads local time.
 */

export const SOLAR_DEG = Math.PI / 180;

// Sun declination (rad) and equation of time (minutes) at a UTC instant.
/** @param {number} ms UTC milliseconds
 *  @returns {{decl: number, eqTime: number}} declination in radians, equation of time in minutes */
export function sunDeclEqTime(ms) {
  const T = (ms / 86400000 + 2440587.5 - 2451545) / 36525;
  const L0 = ((280.46646 + T * (36000.76983 + 0.0003032 * T)) % 360 + 360) % 360;
  const M = (357.52911 + T * (35999.05029 - 0.0001537 * T)) * SOLAR_DEG;
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M) * (1.914602 - T * (0.004817 + 0.000014 * T))
          + Math.sin(2 * M) * (0.019993 - 0.000101 * T)
          + Math.sin(3 * M) * 0.000289;
  const omega = (125.04 - 1934.136 * T) * SOLAR_DEG;
  const lambda = (L0 + C - 0.00569 - 0.00478 * Math.sin(omega)) * SOLAR_DEG;
  const eps = (23.43929111 - T * (0.013004167 + T * (0.000000164 - T * 0.0000005036))
               + 0.00256 * Math.cos(omega)) * SOLAR_DEG;
  const decl = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const y = Math.pow(Math.tan(eps / 2), 2);
  const L0r = L0 * SOLAR_DEG;
  const eqTime = (4 / SOLAR_DEG) * (y * Math.sin(2 * L0r) - 2 * e * Math.sin(M)
    + 4 * e * y * Math.sin(M) * Math.cos(2 * L0r)
    - 0.5 * y * y * Math.sin(4 * L0r) - 1.25 * e * e * Math.sin(2 * M));
  return { decl, eqTime };
}

// One crossing of the given solar zenith angle on a UTC calendar date.
// zenith 90.833° = official sunrise/sunset (refraction + semidiameter);
// zenith 96° = civil twilight (sun centre 6° below the horizon).
// rising=true -> morning crossing. Returns UTC ms, or the string
// 'above'/'below' when the sun stays above/below that altitude all day.
/** UTC instant at which the sun centre crosses a given zenith angle.
 *  @param {string} dateStr "YYYY-MM-DD" @param {number} lat @param {number} lng
 *  @param {number} zenithDeg 90.833 for sunrise/set, 96 for civil twilight
 *  @param {boolean} rising true for the morning crossing
 *  @returns {number|'below'|'above'} UTC ms, or a sentinel when the sun never
 *  reaches that angle: 'below' = it stays below it all day, 'above' = it
 *  never drops to it. The caller turns those into the polar regimes. */
export function solarCrossingUTC(dateStr, lat, lng, zenithDeg, rising) {
  const p = dateStr.split('-').map(Number);
  const midnight = Date.UTC(p[0], p[1] - 1, p[2]);
  let t = midnight + (720 - 4 * lng) * 60000;   // ~ local solar noon
  for (let i = 0; i < 3; i++) {                 // refine decl/eqTime at the event itself
    const s = sunDeclEqTime(t);
    const noonUTC = midnight + (720 - 4 * lng - s.eqTime) * 60000;
    const cosH = (Math.cos(zenithDeg * SOLAR_DEG) - Math.sin(lat * SOLAR_DEG) * Math.sin(s.decl))
               / (Math.cos(lat * SOLAR_DEG) * Math.cos(s.decl));
    if (cosH > 1) return 'below';
    if (cosH < -1) return 'above';
    const haMin = (Math.acos(cosH) / SOLAR_DEG) * 4;
    t = noonUTC + (rising ? -haMin : haMin) * 60000;
  }
  return t;
}

// Full daylight picture for one date and point. kinds:
//  'normal'      window + sunrise/sunset exist
//  'no-sunrise'  day-VFR window exists but the sun never reaches the
//                horizon (polar night edge — legal day VFR in twilight)
//  'all-day'     civil twilight never ends: midnight sun, or the sun
//                sets but stays above -6° (bright polar summer night)
//  'polar-night' the sun never reaches -6°: NO day-VFR window this date
/** Sun times and the SERA day-VFR window for one date and place.
 *  @param {string} dateStr "YYYY-MM-DD" @param {number} lat @param {number} lng
 *  @returns {DaylightResult} */
export function computeDaylight(dateStr, lat, lng) {
  /** @param {number|string} v @returns {number|null} */
  const num = v => (typeof v === 'number' ? v : null);
  const mct = solarCrossingUTC(dateStr, lat, lng, 96, true);
  if (mct === 'below') return { kind: 'polar-night', mct: null, ect: null, sunrise: null, sunset: null };
  const sr = solarCrossingUTC(dateStr, lat, lng, 90.833, true);
  const ss = solarCrossingUTC(dateStr, lat, lng, 90.833, false);
  if (mct === 'above') return { kind: 'all-day', mct: null, ect: null, sunrise: num(sr), sunset: num(ss) };
  const ect = solarCrossingUTC(dateStr, lat, lng, 96, false);
  return { kind: num(sr) === null ? 'no-sunrise' : 'normal',
           mct, ect: num(ect), sunrise: num(sr), sunset: num(ss) };
}

// "UTC+2" / "UTC-3:30" for the LOCAL offset in effect at noon of the
// given date — evaluated per-date so DST (CET vs CEST) labels correctly.
/** @param {string} dateStr "YYYY-MM-DD" @returns {string} e.g. "UTC+2" */
export function utcOffsetLabel(dateStr) {
  const p = dateStr.split('-').map(Number);
  const offMin = -new Date(p[0], p[1] - 1, p[2], 12).getTimezoneOffset();
  const a = Math.abs(offMin);
  return 'UTC' + (offMin < 0 ? '-' : '+') + Math.floor(a / 60) + (a % 60 ? ':' + String(a % 60).padStart(2, '0') : '');
}

/** @param {number|null} ms UTC milliseconds @returns {string} local "HH:MM" */
export function fmtLocalHM(ms) {
  if (ms == null || !isFinite(ms)) return '—';
  const d = new Date(ms);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
/** @param {number} ms @returns {string} LOCAL date "YYYY-MM-DD" - local, not
 *  UTC, because it decides which calendar day a takeoff belongs to */
export function localDateStrOf(ms) {
  const d = new Date(ms);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** @param {Flight} fl @returns {Waypoint|null} first real waypoint with usable coordinates */
export function firstPlottedWaypoint(fl) {
  return (fl.waypoints || []).find(w => !w.isPattern && isFinite(w.lat) && isFinite(w.lng)) || null;
}
