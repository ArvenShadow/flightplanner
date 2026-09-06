/**
 * THE CORRIDOR RING - an editable radius either side of the flown track
 * (v16.61, roadmap item 2).
 *
 * WHAT IT IS, AND WHAT IT DELIBERATELY IS NOT. The ring is the set of points
 * within `radiusNM` of the route, drawn on the chart so the pilot can read the
 * MEF and the contours that actually lie beside their track. It is GEOMETRY
 * ONLY. It does not compute an MSA, and it never will from this tool: the
 * terrain decision (CLAUDE.md, "Terrain/elevation") is that the chart's own
 * contours and MEF are the reference, and Kartverket's elevation API was
 * offered and declined. A corridor that printed a height would be inventing
 * one; a corridor that shows you WHERE to look on the chart invents nothing.
 *
 * ROUND JOINS AND ROUND CAPS ARE NOT A STYLE CHOICE. "Within 1 NM of the
 * track" is a set, and the boundary of that set is genuinely circular at every
 * vertex and at both ends. A mitred corner would claim protection out at the
 * miter point that is more than 1 NM from the track; a butt end would stop the
 * corridor square across the departure fix. So the arcs are the honest shape.
 *
 * WGS-84 THROUGHOUT, via geodesy.js - the same exact geodesics the distances
 * and tracks use (v16.9). Offsetting on a sphere would put the edge in a
 * slightly different place from the leg it is measured off, which is the kind
 * of quiet disagreement this project keeps finding and removing.
 */
import { destinationPoint, trueTrackExact, distanceNMExact, interpolateGeo } from './geodesy.js';

/** Default radius, in nautical miles. One mile either side is the figure the
 *  roadmap item asked for. */
export const CORRIDOR_DEFAULT_NM = 1;

/**
 * The bounds, and both ends are argued rather than picked.
 *
 * BELOW 0.1 NM the band is narrower than the track symbol itself at the zooms
 * the chart is actually read at (z10-z11, where a CSS pixel is ~26 m, so
 * 0.1 NM is 7 px against a 2-10 px track) - it would be a line beside a line.
 * ABOVE 25 NM the corridor is wider than a 1280 px screenful at z9 (~19 NM),
 * so both edges are off-screen at once and it has stopped being a corridor you
 * can see the sides of.
 */
export const CORRIDOR_MIN_NM = 0.1;
export const CORRIDOR_MAX_NM = 25;

/** How finely an arc is walked. 6 degrees is 30 points per end cap; at 25 NM -
 *  the widest the ring goes - that is a chord error of 0.0034 NM (6 m), which
 *  is 0.01 mm on a 1:500 000 chart and so cannot be seen. Finer costs points
 *  on every redraw for nothing. */
export const ARC_STEP_DEG = 6;

/** How far apart the points along a straight stretch of the edge are. Not a
 *  round number picked for looks - see the measurement in the edge() comment
 *  and the enclosure test: at this spacing the drawn edge and the true offset
 *  agree to well inside the 3% band the test allows, on legs from 1 NM to the
 *  length of the country. */
export const EDGE_STEP_NM = 10;

/**
 * Clamp a radius to something drawable, the way every other map preference in
 * this project is re-validated on every read: it lives in PROFILE_KEYS, so it
 * can arrive from a settings file somebody else wrote or from a hand-edited
 * localStorage, and must never reach Leaflet as NaN.
 *
 * @param {unknown} v
 * @returns {number}
 */
export function normaliseCorridorNM(v) {
  const n = Number(v);
  if (!isFinite(n) || n <= 0) return CORRIDOR_DEFAULT_NM;
  return Math.min(CORRIDOR_MAX_NM, Math.max(CORRIDOR_MIN_NM, Math.round(n * 100) / 100));
}

/** Signed turn from `a` to `b`, in (-180, 180]. Positive is a right turn.
 *  @param {number} a @param {number} b @returns {number} */
function turnDelta(a, b) {
  let d = ((b - a) % 360 + 540) % 360 - 180;
  if (d === -180) d = 180;
  return d;
}

/** The bearing the geodesic ARRIVES on at `to`. Not the same as the bearing it
 *  leaves `from` on - over a 100 NM leg at 69 N the two differ by several
 *  degrees, and using the departure bearing at the far end would skew the band.
 *  The reverse geodesic's initial azimuth is that arrival bearing turned round.
 *  @param {[number, number]} from @param {[number, number]} to @returns {number} */
function arrivalBearing(from, to) {
  return (trueTrackExact(to[0], to[1], from[0], from[1]) + 180) % 360;
}

/**
 * Points along an arc of `radiusNM` about `centre`, from bearing `fromDeg` to
 * `toDeg`, sweeping by `sweep` degrees (signed: positive clockwise).
 *
 * @param {[number, number]} centre @param {number} fromDeg @param {number} sweep
 * @param {number} radiusNM
 * @returns {[number, number][]}
 */
function arc(centre, fromDeg, sweep, radiusNM) {
  const steps = Math.max(1, Math.ceil(Math.abs(sweep) / ARC_STEP_DEG));
  /** @type {[number, number][]} */
  const out = [];
  for (let i = 0; i <= steps; i++) {
    out.push(destinationPoint(centre[0], centre[1], fromDeg + (sweep * i) / steps, radiusNM));
  }
  return out;
}

/** Consecutive duplicates make a zero-length segment, which has no bearing at
 *  all - a via point dropped exactly on a waypoint is enough to produce one.
 *  @param {[number, number][]} path @returns {[number, number][]} */
function cleanPath(path) {
  /** @type {[number, number][]} */
  const out = [];
  for (const p of path || []) {
    if (!p || !isFinite(p[0]) || !isFinite(p[1])) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - p[0]) < 1e-9 && Math.abs(last[1] - p[1]) < 1e-9) continue;
    out.push([p[0], p[1]]);
  }
  return out;
}

/**
 * One side of the corridor, walked from the first point to the last.
 *
 * `side` is +90 for the right-hand edge and -90 for the left.
 *
 * A turn AWAY from this side is the OUTER one and gets the round join - the
 * boundary there really is an arc of radius r about the vertex.
 *
 * A turn INTO this side is the INNER one, where the two offsets genuinely cross.
 * Nothing is emitted there: the disc corridorPieces places at every turn already
 * covers that pocket, and the union is what is drawn.
 *
 * @param {[number, number][]} path @param {number} radiusNM @param {number} side
 * @returns {[number, number][]}
 */
function edge(path, radiusNM, side) {
  /** @type {[number, number][]} */
  const out = [];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const arrive = arrivalBearing(a, b);
    // A GEODESIC IS NOT ITS CHORD, and the edge has to be walked rather than
    // stepped from end to end. A leg's bearing changes along it - over 38 NM at
    // 69 N by about a third of a degree, which puts a two-point edge 0.1 NM off
    // the true offset near the far end, and over a very long leg puts it miles
    // out. Offsetting only the two endpoints therefore draws a corridor that
    // is not 1 NM from the track anywhere in the middle.
    const L = distanceNMExact(a[0], a[1], b[0], b[1]);
    // THE STEP SCALES WITH THE RADIUS as well as being capped absolutely. The
    // straight chords between the emitted points sag away from the true offset
    // curve, and what matters is that sag as a FRACTION of the radius: a 10 NM
    // step is invisible on a 5 NM corridor and coarser than the whole band on a
    // 0.1 NM one. Measured: 2x the radius keeps every sample inside a 3% band
    // from 0.1 NM to 25 NM.
    const step = Math.min(EDGE_STEP_NM, Math.max(radiusNM * 2, 0.05));
    const steps = Math.max(1, Math.ceil(L / step));
    for (let k = 0; k <= steps; k++) {
      const on = k === 0 ? a
        : k === steps ? b
        : interpolateGeo(a[0], a[1], b[0], b[1], (L * k) / steps, L);
      const brg = k === steps ? arrive : trueTrackExact(on[0], on[1], b[0], b[1]);
      out.push(destinationPoint(on[0], on[1], brg + side, radiusNM));
    }
    const next = path[i + 2];
    if (!next) continue;
    const outBearing = trueTrackExact(b[0], b[1], next[0], next[1]);
    const delta = turnDelta(arrive, outBearing);
    if (Math.abs(delta) < 0.01) continue;
    // The outer edge of a turn is the one the aircraft swings away from.
    const outer = side > 0 ? delta < 0 : delta > 0;
    if (outer) {
      out.push(...arc(b, arrive + side, delta, radiusNM));
    }
    // NOTHING IS ADDED ON THE INNER SIDE, and that is a deletion rather than an
    // omission. A first version mitred the inner corner out to the intersection
    // of the two offset lines; removing it changed no test, because the DISC
    // this module already places at every turn covers exactly that pocket. Two
    // mechanisms for one job, one of them limited at sharp angles and untested
    // because the other hid it - so the miter went.
  }
  return out;
}

/**
 * The corridor as a SET OF RINGS whose union is the corridor exactly: one band
 * per segment, one disc per interior vertex.
 *
 * WHY NOT THE SINGLE RING BELOW, WHICH IS PRETTIER. One traversal has to fold
 * back on itself at the inside of a turn, and where the fold is tight enough
 * the winding number cancels to zero and the fill punches a NOTCH out of the
 * band. Measured over generated two-leg routes: it appears once the turn is
 * about a hairpin AND the radius reaches roughly half the leg length - 2 to 9
 * of 224 boundary samples fall outside the filled area. Rare, but it is a hole
 * in the corridor at the one corner a pilot is looking hardest at, and a
 * corridor that silently under-reports is the plausible wrong answer this
 * project refuses.
 *
 * Every piece here is convex-ish and traversed the same way round, so under the
 * NONZERO rule they add and never cancel, whatever the route does. One polygon
 * with many rings gives ONE fill, so nothing double-darkens either - the defect
 * the v16.30 stepped-airspace entry describes.
 *
 * @param {[number, number][]} path @param {number} radiusNM
 * @returns {[number, number][][]} rings for a single multi-ring polygon
 */
export function corridorPieces(path, radiusNM) {
  const pts = cleanPath(path);
  const r = normaliseCorridorNM(radiusNM);
  if (!pts.length) return [];
  if (pts.length === 1) return [arc(pts[0], 0, 360, r)];
  /** @type {[number, number][][]} */
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const seg = [pts[i], pts[i + 1]];
    const leave = trueTrackExact(seg[0][0], seg[0][1], seg[1][0], seg[1][1]);
    const arrive = arrivalBearing(seg[0], seg[1]);
    /** @type {[number, number][]} */
    const band = [];
    band.push(...edge(seg, r, 90));
    band.push(...arc(seg[1], arrive + 90, -180, r));
    band.push(...edge(seg.slice().reverse(), r, 90));
    band.push(...arc(seg[0], leave - 90, -180, r));
    out.push(band);
  }
  // The discs fill the outside of every turn, and the inside too - which is
  // exactly the pocket the single-ring fold could lose.
  for (let i = 1; i < pts.length - 1; i++) out.push(arc(pts[i], 0, 360, r));
  return out;
}
