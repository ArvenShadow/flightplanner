/**
 * Geodesy — exact WGS-84 geodesics.
 *
 * Uses GeographicLib (Karney's algorithm, the reference implementation;
 * accurate to nanometres) instead of the spherical law of cosines used up
 * to v16.8. Measured on real legs at 69N, the spherical model ran
 * consistently SHORT: -0.33% ENDU-ENTC, -0.37% ENDU-ENEV, -0.41%
 * ENTC-ENKR, -0.28% ENDU-ENGM. That is within the "<0.5%" the original
 * audit claimed, but the bias always pointed the same, unsafe way -
 * under-reporting distance means under-reporting time and fuel. Tracks
 * agreed to <=0.02 deg, so headings barely move; distances gain ~0.1 NM
 * on a 38 NM leg and ~0.9 NM on a 228 NM leg.
 */
// geographiclib-geodesic is CommonJS: the default-import interop form works
// both in esbuild's bundle and under Node's ESM loader (a named import of a
// CJS export does not).
import geographiclib from 'geographiclib-geodesic';

import { rhumbBearing, rhumbDistanceNM, rhumbPointAtDistance } from './rhumb.js';

const geod = geographiclib.Geodesic.WGS84;
const M_PER_NM = 1852;

/**
 * WHICH PATH THE PLANNER MEASURES ALONG - 'gc' (default) or 'rhumb'.
 *
 * Set ONCE by the page from the pilot's setting, through the explicit injector
 * below - the same arrangement performance.js uses for the aircraft profile,
 * and for the same reason: threading a mode through `computeLegTotals`,
 * `computeFlightSchedule`, `computeLegMarkers` and every caller of those would
 * touch dozens of signatures to carry one word.
 *
 * IT GOVERNS THE PATH, NOT JUST THE PICTURE. A mode that drew a rhumb line and
 * printed the great-circle track would hand the pilot a heading that does not
 * fly the line they are looking at - measured at up to 1 degree on a Troms leg
 * and 5.1 degrees on Tromso-Kirkenes. Distance, track, the drawn line and the
 * corridor all follow this together or none of them do.
 *
 * @type {'gc'|'rhumb'}
 */
let navPath = 'gc';

/** @param {unknown} mode @returns {'gc'|'rhumb'} */
export function normaliseNavPath(mode) {
  return mode === 'rhumb' ? 'rhumb' : 'gc';
}

/** Set the path model. Called once where the page reads the profile.
 *  @param {unknown} mode @returns {void} */
export function setNavPath(mode) { navPath = normaliseNavPath(mode); }

/** @returns {'gc'|'rhumb'} */
export function getNavPath() { return navPath; }

/** Great-circle (geodesic) distance in NM, rounded to 0.1 as the OFP shows it.
 *  @param {number} lat1 @param {number} lon1 @param {number} lat2 @param {number} lon2
 *  @returns {number} nautical miles */
export function calcDistanceNM(lat1, lon1, lat2, lon2) {
  return Number(distanceNMExact(lat1, lon1, lat2, lon2).toFixed(1));
}

/** Unrounded geodesic distance in NM, for math that must not accumulate rounding.
 *  @param {number} lat1 @param {number} lon1 @param {number} lat2 @param {number} lon2
 *  @returns {number} */
export function distanceNMExact(lat1, lon1, lat2, lon2) {
  if (navPath === 'rhumb') return rhumbDistanceNM(lat1, lon1, lat2, lon2);
  // Inverse() with the default outmask always sets s12; NaN inputs give NaN
  // rather than undefined, and the integrity check catches NaN on screen.
  return (geod.Inverse(lat1, lon1, lat2, lon2).s12 || 0) / M_PER_NM;
}

/** INITIAL true track in whole degrees (the course you set out on).
 *  @param {number} lat1 @param {number} lon1 @param {number} lat2 @param {number} lon2
 *  @returns {number} degrees true, 0-359 */
export function calcTrueTrack(lat1, lon1, lat2, lon2) {
  return Math.round(trueTrackExact(lat1, lon1, lat2, lon2)) % 360;
}

/** Unrounded initial true track, for interpolation and chip placement.
 *  @param {number} lat1 @param {number} lon1 @param {number} lat2 @param {number} lon2
 *  @returns {number} */
export function trueTrackExact(lat1, lon1, lat2, lon2) {
  // A RHUMB HAS ONE COURSE, not a departure and an arrival bearing - that is
  // exactly what makes it the heading you set once and hold.
  if (navPath === 'rhumb') return rhumbBearing(lat1, lon1, lat2, lon2);
  return ((geod.Inverse(lat1, lon1, lat2, lon2).azi1 || 0) + 360) % 360;
}

/**
 * Point `distNM` along the geodesic from 1 to 2 (used for TOC/TOD marks).
 * Walks the real geodesic rather than interpolating a sphere, so the mark
 * lands where the distance is actually flown.
 *
 * @param {number} lat1 @param {number} lon1 @param {number} lat2 @param {number} lon2
 * @param {number} distNM        how far along the leg
 * @param {number} totalDistNM   the leg's full length
 * @returns {[number, number]} [lat, lng]
 */
export function interpolateGeo(lat1, lon1, lat2, lon2, distNM, totalDistNM) {
  if (totalDistNM <= 0 || distNM <= 0) return [lat1, lon1];
  if (distNM >= totalDistNM) return [lat2, lon2];
  if (navPath === 'rhumb') return rhumbPointAtDistance(lat1, lon1, lat2, lon2, distNM);
  const line = geod.InverseLine(lat1, lon1, lat2, lon2);
  const pos = line.Position(distNM * M_PER_NM);
  return [pos.lat2 || lat1, pos.lon2 || lon1];
}

/** Point at `distNM` on `bearingDeg` from a start point (chart circles/sectors).
 *  @param {number} lat @param {number} lon @param {number} bearingDeg @param {number} distNM
 *  @returns {[number, number]} [lat, lng] */
export function destinationPoint(lat, lon, bearingDeg, distNM) {
  const p = geod.Direct(lat, lon, bearingDeg, distNM * M_PER_NM);
  return [p.lat2 || lat, p.lon2 || lon];
}
