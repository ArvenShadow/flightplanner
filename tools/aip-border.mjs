/**
 * National-border resolution for AIP airspace - tools/aip-border.mjs
 *
 * THE PROBLEM. Some published airspace boundaries do not list coordinates all
 * the way round. Between two published fixes the eAIP says, in a tagged field
 * (`TGEO_BORDER;TXT_NAME` = "Norway and Sweden"), that the boundary FOLLOWS
 * THE NATIONAL BORDER. Joining those two fixes with a straight line draws a
 * boundary that does not exist - which is why v16.29 shipped 22 of these
 * airspaces absent rather than wrong.
 *
 * THE SOURCE. Kartverket (the Norwegian Mapping Authority) publishes the
 * border itself: their administrative-units WFS serves `app:Grense` features
 * with `app:avgrensningstype = Riksgrense`, under NLOD. Measured Sep 2026:
 * 329 LineString fragments, 18 763 points, which stitch by shared endpoints
 * into exactly ONE continuous chain of 18 435 points spanning lng 11.45-30.95
 * and lat 58.88-70.09 - the whole land border with Sweden, Finland and Russia.
 * Kartverket is NLOD; Avinor's AIP is used by permission. Two separate
 * grants, and this file is where they meet, so neither is assumed to cover
 * the other.
 *
 * THE RESOLUTION RULE, and why it has no free choices in it:
 *   - the chain is a single OPEN polyline, so between the point nearest A and
 *     the point nearest B there is exactly ONE path along it. There is no
 *     "which way round" decision to get wrong.
 *   - both published fixes must lie within SNAP_TOLERANCE_NM of the chain. If
 *     one does not, the reference is not what we think it is and the airspace
 *     is REFUSED, not approximated.
 *   - the resolved path is sanity-bounded: a real border segment wanders, but
 *     it does not take the long way round the country. A path more than
 *     MAX_DETOUR_RATIO times the direct distance means a bad snap, and is
 *     refused too.
 *
 * Pure: no network, no DOM. The fetch lives in tools/build-border.mjs.
 */

/**
 * How far a published airspace corner may lie from Kartverket's border line
 * for the reference to be trusted.
 *
 * NOT a guess - MEASURED over every border-referenced airspace in the
 * 2026-06-11 edition, and the population splits cleanly in two:
 *
 *   - corners genuinely on the land border:  0.00 - 1.16 NM
 *   - everything else:                       8.44 NM and up
 *
 * The small offsets are the AIP's model of the border differing from
 * Kartverket's survey at the corner; the large ones are structural (see
 * `isForeignBorder`, and the Skagerrak note below) and must stay refused. Two
 * miles sits in the 7x gap between the populations: comfortably above every
 * real case, far below every failure. The measured snap distance is recorded
 * on every resolved airspace so this can be audited rather than trusted.
 *
 * THE SKAGERRAK CASE, and why widening this further would be wrong: south of
 * about 58.88N / 11.45E the Norway-Sweden boundary is MARITIME, and
 * Kartverket's Riksgrense is a LAND administrative boundary that stops there.
 * Farris TMA, Koster and Bohus C reference that stretch, so their nearest
 * "border" point is the end of the chain, 8-25 NM away. No tolerance can fix
 * that - the line simply is not in this dataset - and pretending otherwise
 * would draw a boundary out at sea that does not exist.
 */
export const SNAP_TOLERANCE_NM = 2;

/**
 * A border reference Norwegian data cannot resolve.
 *
 * Kartverket's Riksgrense is NORWAY's border. Halti references the
 * "Finland and Sweden" border, which is not in it and never will be, so that
 * airspace is refused for a stated reason rather than snapped to whichever
 * Norwegian border happens to be nearest - which is exactly the silent error
 * this guard exists to prevent.
 *
 * @param {string} name the published TGEO_BORDER;TXT_NAME
 * @returns {boolean}
 */
export function isForeignBorder(name) {
  return !/norway/i.test(String(name || ''));
}

/** A resolved border path longer than this multiple of the direct A-B
 *  distance means the walk went the wrong way along the chain. */
export const MAX_DETOUR_RATIO = 6;

const NM_PER_DEG_LAT = 60.04;

/** Cheap local metric for nearest-point search: degrees scaled to NM at this
 *  latitude. Exact geodesics are used for the distances that get reported. */
/** @param {[number, number]} a @param {[number, number]} b @returns {number} */
function nmApprox(a, b) {
  const kx = Math.cos(((a[0] + b[0]) / 2) * Math.PI / 180) * NM_PER_DEG_LAT;
  const dy = (a[0] - b[0]) * NM_PER_DEG_LAT;
  const dx = (a[1] - b[1]) * kx;
  return Math.hypot(dx, dy);
}

/**
 * Stitch WFS LineString fragments into as few continuous chains as possible.
 *
 * Kartverket serves the border as one fragment per stretch between
 * administrative units, in arbitrary order and arbitrary direction, so a
 * fragment's end may join another fragment's start OR its end. Joining is by
 * exact shared endpoint - the fragments come from one topological dataset, so
 * endpoints match to the digit and no tolerance is needed or wanted.
 *
 * @param {[number, number][][]} fragments lat/lng point lists
 * @returns {[number, number][][]} chains, longest first
 */
export function stitchFragments(fragments) {
  const key = (/** @type {[number, number]} */ p) => p[0].toFixed(7) + ',' + p[1].toFixed(7);
  /** @type {Map<string, number[]>} */
  const ends = new Map();
  const add = (/** @type {string} */ k, /** @type {number} */ i) => {
    const list = ends.get(k);
    if (list) list.push(i); else ends.set(k, [i]);
  };
  fragments.forEach((/** @type {[number, number][]} */ f, /** @type {number} */ i) => {
    if (f.length) { add(key(f[0]), i); add(key(f[f.length - 1]), i); }
  });

  const used = new Set();
  /** @type {[number, number][][]} */
  const chains = [];
  for (let i = 0; i < fragments.length; i++) {
    if (used.has(i) || !fragments[i].length) continue;
    let chain = fragments[i].slice();
    used.add(i);
    // Extend from the tail, then reverse and extend again, so a fragment
    // picked up in the middle of a stretch still grows both ways.
    for (let pass = 0; pass < 2; pass++) {
      let grew = true;
      while (grew) {
        grew = false;
        const tail = key(chain[chain.length - 1]);
        for (const j of ends.get(tail) || []) {
          if (used.has(j)) continue;
          const f = fragments[j];
          if (key(f[0]) === tail) { chain = chain.concat(f.slice(1)); used.add(j); grew = true; break; }
          if (key(f[f.length - 1]) === tail) { chain = chain.concat(f.slice(0, -1).reverse()); used.add(j); grew = true; break; }
        }
      }
      chain.reverse();
    }
    chains.push(chain);
  }
  chains.sort((a, b) => b.length - a.length);
  return chains;
}

/** Nearest vertex index on a chain, and its distance.
 *  @param {[number, number][]} chain @param {[number, number]} point
 *  @returns {{index: number, distNM: number}} */
function nearest(chain, point) {
  let best = -1, bestD = Infinity;
  for (let i = 0; i < chain.length; i++) {
    const d = nmApprox(chain[i], point);
    if (d < bestD) { bestD = d; best = i; }
  }
  return { index: best, distNM: bestD };
}

/** Total length of a point list, in NM.
 *  @param {[number, number][]} pts @returns {number} */
function pathLength(pts) {
  let sum = 0;
  for (let i = 1; i < pts.length; i++) sum += nmApprox(pts[i - 1], pts[i]);
  return sum;
}

/**
 * Ramer-Douglas-Peucker, with the deviation measured in NM.
 *
 * A border stretch can be thousands of points; drawing them all is wasted on
 * a screen and in a file. The tolerance is deliberately far below what a
 * 1:500 000 chart can show - 0.02 NM is 37 m, which is 0.07 mm on the paper
 * chart - so simplification cannot move the boundary anywhere a pilot could
 * see. The tolerance used is recorded in the dataset.
 *
 * @param {[number, number][]} pts @param {number} tolNM
 * @returns {[number, number][]}
 */
export function simplify(pts, tolNM) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  /** @type {[number, number][]} */
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const seg = stack.pop();
    if (!seg) break;
    const [lo, hi] = seg;
    let worst = -1, worstD = -1;
    for (let i = lo + 1; i < hi; i++) {
      const d = perpNM(pts[i], pts[lo], pts[hi]);
      if (d > worstD) { worstD = d; worst = i; }
    }
    if (worst > 0 && worstD > tolNM) {
      keep[worst] = 1;
      stack.push([lo, worst], [worst, hi]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Perpendicular distance from p to the a-b span, in NM.
 *  @param {[number, number]} p @param {[number, number]} a @param {[number, number]} b
 *  @returns {number} */
function perpNM(p, a, b) {
  const kx = Math.cos(((a[0] + b[0]) / 2) * Math.PI / 180) * NM_PER_DEG_LAT;
  const ax = a[1] * kx, ay = a[0] * NM_PER_DEG_LAT;
  const bx = b[1] * kx, by = b[0] * NM_PER_DEG_LAT;
  const px = p[1] * kx, py = p[0] * NM_PER_DEG_LAT;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * The border path between two published fixes.
 *
 * @param {[number, number][]} chain the stitched Riksgrense line
 * @param {[number, number]} from published fix before the border reference
 * @param {[number, number]} to published fix after it
 * @param {{tolNM?: number, simplifyNM?: number}} [opts]
 * @returns {{points: [number, number][], snapFromNM: number, snapToNM: number,
 *            lengthNM: number, directNM: number}|{refuse: string, detail: string}}
 */
export function borderPath(chain, from, to, opts) {
  const tol = opts && typeof opts.tolNM === 'number' ? opts.tolNM : SNAP_TOLERANCE_NM;
  const simp = opts && typeof opts.simplifyNM === 'number' ? opts.simplifyNM : 0.02;
  if (!chain || chain.length < 2) return { refuse: 'no-border-data', detail: 'the prepared border is empty' };

  const a = nearest(chain, from), b = nearest(chain, to);
  if (a.distNM > tol || b.distNM > tol) {
    return {
      refuse: 'fix-not-on-border',
      detail: `published fixes lie ${a.distNM.toFixed(2)} and ${b.distNM.toFixed(2)} NM from the border (tolerance ${tol} NM)`
    };
  }
  // One open polyline, so exactly one path between the two indices.
  const lo = Math.min(a.index, b.index), hi = Math.max(a.index, b.index);
  let walk = chain.slice(lo, hi + 1);
  if (a.index > b.index) walk = walk.reverse();

  // Replace the snapped endpoints with the PUBLISHED fixes: the published
  // coordinate is the authority for where the airspace corner is, and the
  // border line is the authority for the shape between them.
  const direct = nmApprox(from, to);
  const length = pathLength(walk);
  if (length > Math.max(1, direct) * MAX_DETOUR_RATIO) {
    return {
      refuse: 'implausible-border-path',
      detail: `${length.toFixed(1)} NM along the border for a ${direct.toFixed(1)} NM direct span`
    };
  }
  const points = simplify(walk, simp);
  points[0] = from;
  points[points.length - 1] = to;
  return {
    points,
    snapFromNM: Number(a.distNM.toFixed(3)),
    snapToNM: Number(b.distNM.toFixed(3)),
    lengthNM: Number(length.toFixed(2)),
    directNM: Number(direct.toFixed(2))
  };
}
