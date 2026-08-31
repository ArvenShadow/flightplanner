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

const geod = geographiclib.Geodesic.WGS84;
const M_PER_NM = 1852;

/** Great-circle (geodesic) distance in NM, rounded to 0.1 as the OFP shows it. */
export function calcDistanceNM(lat1, lon1, lat2, lon2) {
  const r = geod.Inverse(lat1, lon1, lat2, lon2);
  return Number((r.s12 / M_PER_NM).toFixed(1));
}

/** Unrounded geodesic distance in NM, for math that must not accumulate rounding. */
export function distanceNMExact(lat1, lon1, lat2, lon2) {
  return geod.Inverse(lat1, lon1, lat2, lon2).s12 / M_PER_NM;
}

/** INITIAL true track in whole degrees (the course you set out on). */
export function calcTrueTrack(lat1, lon1, lat2, lon2) {
  const r = geod.Inverse(lat1, lon1, lat2, lon2);
  return Math.round((r.azi1 + 360) % 360);
}

/** Unrounded initial true track, for interpolation and chip placement. */
export function trueTrackExact(lat1, lon1, lat2, lon2) {
  return (geod.Inverse(lat1, lon1, lat2, lon2).azi1 + 360) % 360;
}

/**
 * Point `distNM` along the geodesic from 1 to 2 (used for TOC/TOD marks).
 * Walks the real geodesic rather than interpolating a sphere, so the mark
 * lands where the distance is actually flown.
 */
export function interpolateGeo(lat1, lon1, lat2, lon2, distNM, totalDistNM) {
  if (totalDistNM <= 0 || distNM <= 0) return [lat1, lon1];
  if (distNM >= totalDistNM) return [lat2, lon2];
  const line = geod.InverseLine(lat1, lon1, lat2, lon2);
  const pos = line.Position(distNM * M_PER_NM);
  return [pos.lat2, pos.lon2];
}

/** Point at `distNM` on `bearingDeg` from a start point (chart circles/sectors). */
export function destinationPoint(lat, lon, bearingDeg, distNM) {
  const p = geod.Direct(lat, lon, bearingDeg, distNM * M_PER_NM);
  return [p.lat2, p.lon2];
}
