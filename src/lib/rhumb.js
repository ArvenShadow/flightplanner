/**
 * RHUMB LINES (loxodromes) on the WGS-84 ellipsoid - v16.63.
 *
 * WHY THIS EXISTS. Up to v16.62 every distance and track in the planner was a
 * GEODESIC (great circle), while the route LINE drawn on the map was a rhumb -
 * because Leaflet draws straight segments in Web Mercator, and a straight line
 * in Mercator IS a constant-heading line. So the numbers described one path and
 * the picture showed another. Measured at 69 N: 0.06 NM apart on a 38 NM leg,
 * 0.30 NM on a 53 NM leg, and 5.16 NM on the 229 NM Tromso-Kirkenes leg.
 *
 * The fix is a SETTING rather than a decision made for the pilot, because both
 * are legitimate ways to navigate and they differ in what they ask of you:
 *   - GREAT CIRCLE is the shortest path and what a GPS flies. The heading
 *     changes continuously along the leg.
 *   - RHUMB LINE is one constant heading from fix to fix. Slightly longer -
 *     measured at 0.002 NM on a 53 NM leg, which is below the 0.1 NM the OFP
 *     prints - but you set the heading once.
 * Whichever is chosen governs the line, the corridor and the track TOGETHER.
 *
 * ELLIPSOIDAL, NOT SPHERICAL, and that is not pedantry: the rest of this
 * project moved off the sphere at v16.9 because the spherical model ran 0.3%
 * short at 69 N, always in the unsafe direction. A spherical rhumb beside an
 * ellipsoidal geodesic would reintroduce exactly that bias, and it would look
 * like a rhumb-versus-great-circle difference when it is nothing of the kind -
 * which is the mistake the first comparison of these two made.
 */
import geographiclib from 'geographiclib-geodesic';

const geod = geographiclib.Geodesic.WGS84;
const M_PER_NM = 1852;
const A_M = geod.a;                       // WGS-84 semi-major axis, metres
const F = geod.f;                         // flattening
const E = Math.sqrt(F * (2 - F));         // first eccentricity
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/**
 * Isometric latitude - the vertical coordinate of the Mercator projection.
 *
 * A rhumb line is a STRAIGHT LINE in (lambda, psi), which is the whole reason
 * the drawn Leaflet segment is one: Web Mercator's y axis is this quantity.
 *
 * @param {number} latDeg @returns {number}
 */
export function isometricLat(latDeg) {
  const phi = latDeg * D2R;
  const s = Math.sin(phi);
  return Math.log(Math.tan(Math.PI / 4 + phi / 2) * Math.pow((1 - E * s) / (1 + E * s), E / 2));
}

/**
 * Back from isometric latitude to geodetic. Newton's method: the closed form
 * needs a series, and this converges in three or four passes to well below a
 * micro-degree, which is a millimetre on the ground.
 *
 * @param {number} psi @returns {number} degrees
 */
export function latFromIsometric(psi) {
  let phi = 2 * Math.atan(Math.exp(psi)) - Math.PI / 2;   // spherical seed
  for (let i = 0; i < 8; i++) {
    const s = Math.sin(phi);
    const est = Math.log(Math.tan(Math.PI / 4 + phi / 2) * Math.pow((1 - E * s) / (1 + E * s), E / 2));
    const d = (est - psi) * (1 - E * E * s * s) * Math.cos(phi) / (1 - E * E);
    phi -= d;
    if (Math.abs(d) < 1e-14) break;
  }
  return phi * R2D;
}

/** Wrap a longitude difference into (-180, 180], so a leg never goes the long
 *  way round the world. @param {number} d @returns {number} */
function wrapLon(d) {
  let x = ((d + 180) % 360 + 360) % 360 - 180;
  if (x === -180) x = 180;
  return x;
}

/**
 * The CONSTANT true course of the rhumb line from 1 to 2.
 *
 * Constant is the point: unlike a geodesic there is no departure bearing and
 * arrival bearing to tell apart, which is what makes this the heading you set
 * once and hold.
 *
 * @param {number} lat1 @param {number} lon1 @param {number} lat2 @param {number} lon2
 * @returns {number} degrees true, 0-360
 */
export function rhumbBearing(lat1, lon1, lat2, lon2) {
  const dPsi = isometricLat(lat2) - isometricLat(lat1);
  const dLon = wrapLon(lon2 - lon1) * D2R;
  return ((Math.atan2(dLon, dPsi) * R2D) + 360) % 360;
}

/**
 * Rhumb distance in nautical miles, on the ellipsoid.
 *
 * The meridian arc comes from GeographicLib itself - a geodesic along a
 * meridian IS the meridian arc - so no series expansion is hand-rolled here and
 * the ellipsoid is the same one every other distance in this project uses.
 *
 * The EAST-WEST case is not a special case bolted on: as the course approaches
 * 090 or 270 the meridian arc goes to zero and `cos(course)` with it, so the
 * quotient is 0/0. A rhumb along a parallel is an arc of that parallel, whose
 * radius on the ellipsoid is a*cos(phi)/sqrt(1 - e^2 sin^2 phi).
 *
 * @param {number} lat1 @param {number} lon1 @param {number} lat2 @param {number} lon2
 * @returns {number} nautical miles
 */
export function rhumbDistanceNM(lat1, lon1, lat2, lon2) {
  const dLon = wrapLon(lon2 - lon1);
  const dPsi = isometricLat(lat2) - isometricLat(lat1);
  // Meridian arc between the two latitudes, exactly, from the same solver the
  // geodesic distances use.
  const meridian = geod.Inverse(lat1, lon1, lat2, lon1).s12 || 0;
  const course = Math.atan2(dLon * D2R, dPsi);
  if (Math.abs(Math.cos(course)) > 1e-8) {
    return Math.abs(meridian / Math.cos(course)) / M_PER_NM;
  }
  // Along a parallel: the radius of that parallel, times the longitude arc.
  const phi = ((lat1 + lat2) / 2) * D2R;
  const s = Math.sin(phi);
  const rParallel = A_M * Math.cos(phi) / Math.sqrt(1 - E * E * s * s);
  return Math.abs(rParallel * dLon * D2R) / M_PER_NM;
}

/**
 * The point a fraction `f` of the way along the rhumb line.
 *
 * Interpolating ISOMETRIC latitude linearly is what makes this exact: the rhumb
 * is by definition a straight line in (lambda, psi), so equal steps in psi and
 * lambda stay on it. Interpolating geodetic latitude instead would leave the
 * line - which is the error the first version of the comparison in this
 * conversation made.
 *
 * @param {number} lat1 @param {number} lon1 @param {number} lat2 @param {number} lon2
 * @param {number} f 0 at the first point, 1 at the second
 * @returns {[number, number]}
 */
export function rhumbPoint(lat1, lon1, lat2, lon2, f) {
  if (f <= 0) return [lat1, lon1];
  if (f >= 1) return [lat2, lon2];
  const psi1 = isometricLat(lat1);
  const dPsi = isometricLat(lat2) - psi1;
  const dLon = wrapLon(lon2 - lon1);
  // A due-east or due-west leg has no change in isometric latitude at all, and
  // Newton on an unchanged psi is a waste - the latitude simply does not move.
  const lat = Math.abs(dPsi) < 1e-12 ? lat1 : latFromIsometric(psi1 + dPsi * f);
  return [lat, lon1 + dLon * f];
}

/**
 * The point a given DISTANCE along the rhumb line - not a fraction.
 *
 * EQUAL FRACTIONS ARE NOT EQUAL DISTANCES, which is why this is separate from
 * rhumbPoint. Isometric latitude interpolates linearly along a loxodrome, but
 * the distance travelled is proportional to the MERIDIAN ARC, and the two are
 * different functions of latitude. Stepping by fraction and calling it distance
 * would put every TOC, TOD and corridor sample slightly off its mark.
 *
 * The latitude at a given meridian arc comes from GeographicLib - a geodesic
 * due north IS the meridian - so no series is hand-rolled and the ellipsoid
 * matches every other distance in the project.
 *
 * @param {number} lat1 @param {number} lon1 @param {number} lat2 @param {number} lon2
 * @param {number} distNM how far along
 * @returns {[number, number]}
 */
export function rhumbPointAtDistance(lat1, lon1, lat2, lon2, distNM) {
  if (!(distNM > 0)) return [lat1, lon1];
  const dLon = wrapLon(lon2 - lon1);
  const psi1 = isometricLat(lat1);
  const dPsi = isometricLat(lat2) - psi1;
  const course = Math.atan2(dLon * D2R, dPsi);
  const cosC = Math.cos(course);
  if (Math.abs(cosC) <= 1e-8) {
    // Along a parallel: latitude does not move, longitude scales with the arc.
    const phi = lat1 * D2R;
    const sn = Math.sin(phi);
    const rParallel = A_M * Math.cos(phi) / Math.sqrt(1 - E * E * sn * sn);
    const dl = (distNM * M_PER_NM) / rParallel * R2D;
    return [lat1, lon1 + (dLon >= 0 ? dl : -dl)];
  }
  // Walk the MERIDIAN by the north-south component of the distance, using the
  // same solver the geodesic distances use.
  const dm = distNM * M_PER_NM * cosC;
  const p = geod.Direct(lat1, lon1, dm >= 0 ? 0 : 180, Math.abs(dm));
  const lat = p.lat2 === undefined ? lat1 : p.lat2;
  const newPsi = isometricLat(lat);
  // ...and take the longitude straight off the line's own constant slope.
  const lon = Math.abs(dPsi) < 1e-12
    ? lon1
    : lon1 + dLon * ((newPsi - psi1) / dPsi);
  return [lat, lon];
}
