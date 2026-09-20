/**
 * Georeferencing a Visual Approach Chart - tools/vac-geo.mjs
 *
 * THE PROBLEM. A VAC is a projected map sheet with no georeference in the
 * file: the PDFs carry NO GeoPDF markers (/Measure, /GPTS and /Viewport are
 * all absent, verified across the edition) and no projection note in the text
 * layer. Drawing one as a plain four-corner image overlay is not close: fitted
 * over ENDU, a Web Mercator + affine model leaves 409 m RMS and 790 m worst
 * case, which at 69 N is a quarter of a nautical mile of chart ink in the
 * wrong place.
 *
 * THE TWO SOURCES OF CONTROL, in the order they are preferred:
 *
 *   1. PUBLISHED POINTS. Where the aerodrome's VAC prints a reporting-point
 *      coordinate table (24 of 53 aerodromes - see tools/aip-vac.mjs), each
 *      tabled point is also DRAWN on the chart face as a filled triangle. The
 *      symbol is placed by the publishing system at full precision, so the
 *      pairing (drawn symbol, published WGS-84 coordinate) is exact control.
 *
 *   2. THE PRINTED GRATICULE, where there is no table. Every sheet carries a
 *      tick scale on all four edges of the map neatline: one tick per MINUTE,
 *      a longer tick every 10', and the 10' ticks carry a printed label. That
 *      is the chart's own statement about its own coordinate frame.
 *
 * WHICH REFERENCE POINT OF THE SYMBOL IS THE PUBLISHED COORDINATE - AND IT IS
 * MEASURED, NOT ASSUMED. This is the whole trick of the primary path, and
 * getting it wrong is silent: every point moves the same way, so the chart
 * still looks internally consistent and still lines up with itself.
 *   - The published coordinate sits at the symbol's BOUNDING-BOX CENTRE.
 *   - It is NOT the centroid. For a triangle the centroid is h/6 below the
 *     bounding-box centre, which at these sheets is ~1.3 pt = ~170 m.
 *   - Measured over 199 matched points on three symbol sizes: the offset from
 *     the CENTROID grows with the symbol (1.329 / 1.367 / 1.409 pt at
 *     perimeter 25.9 / 28.1 / 30.6, tracking the geometric h/6 prediction of
 *     1.246 / 1.350 / 1.473), while the offset from the BOUNDING-BOX CENTRE
 *     stays at zero throughout (0.086 / 0.021 / -0.060 pt).
 *   - THAT SCALING IS THE PROOF. An error in the fitted model would be a
 *     CONSTANT distance, independent of how big the symbol happens to be
 *     drawn. An error in the anchor is proportional to the symbol. It is
 *     proportional, so the anchor is the bounding-box centre.
 *
 * A HOLDOUT CANNOT CATCH THAT, and this is why the build cross-checks the two
 * control sources against each other. Fit points and held-out points share the
 * anchor convention, so a wrong anchor biases both equally and the holdout
 * residual comes back near zero while the chart is 170 m out. The graticule is
 * derived from completely different ink, so requiring the two models to AGREE
 * is the one check that sees a shared-assumption bias. Measured with the
 * bounding-box anchor: the two agree to about 6 m.
 *
 * THE MODEL IS CONFORMAL, AND THAT IS WHAT LETS THE EDGES DETERMINE THE
 * MIDDLE. Any conformal projection of the ellipsoid is a holomorphic function
 * of (longitude + i * isometric latitude), so the inverse mapping from the
 * page is a holomorphic function of (x + iy). Fitting a low-order complex
 * polynomial therefore CANNOT produce a shape that is not a projection, which
 * matters because the graticule only ever observes the boundary. Measured on
 * ENDU: order 1 leaves 1.84 pt, order 2 reaches 0.069 pt, order 3 gains 3%
 * and order 4 nothing - because 0.069 pt IS the sheet's own tick quantisation
 * (tick positions are snapped to a 0.24 pt grid, whose standard deviation is
 * 0.069 pt). The model has hit the chart's drafting precision, and no further
 * order can help.
 *
 * ALL FOUR EDGES ARE REQUIRED, and the reason is VERIFICATION rather than
 * rank - a distinction worth stating because the obvious argument is wrong.
 * Measured on ENDU: two edges (one per axis) really are degenerate and the
 * solver refuses them outright, but THREE edges fit perfectly well and
 * reproduce the fourth to 25.9 m. Conformality is why: the Cauchy-Riemann
 * relations tie the imaginary part to the real one, so longitude observed on
 * two lines already determines most of the model and a single latitude line
 * fixes the rest.
 *
 * So the fourth edge is not needed to SOLVE the fit; it is needed to CHECK it.
 * It is what lets the two edges of each axis be compared against one another,
 * which is the test that catches an edge whose labels were read one major out.
 * An edge that refuses itself has something wrong with it, and accepting the
 * chart on the strength of the other three would mean fitting a sheet nobody
 * has verified. So a chart missing a usable edge is REFUSED, never fitted.
 *
 * Pure: no network, no PDF library, no DOM, no filesystem. The caller extracts
 * the page's path segments and text items and hands them in;
 * tools/build-vac-raster.mjs does that with pdfjs and drives the rendering.
 */

/* ------------------------------------------------------------------ *
 * The sheet template
 * ------------------------------------------------------------------ */

/**
 * Where the map neatline sits on an Avinor VAC sheet, in PDF points.
 *
 * Avinor's VACs are produced from one sheet template, so the frame is in the
 * same place on every chart. Verified two ways: the four rules are the most
 * repeated long axis-aligned strokes on every sheet in the edition, and the
 * independently written crop rectangle in a sibling project's reviewed
 * configuration for ENDU is the same rectangle to within 0.25 pt.
 *
 * It is a STARTING POINT for the search, not an assumption: `chartFrame`
 * picks the nearest real stroke to each template edge and the result is only
 * used if the graticule ticks then verify against it.
 */
export const SHEET_TEMPLATE = { left: 63.9, right: 534.3, bottom: 157.2, top: 711.5 };

/** The smallest map frame that could be a chart, in PDF points. */
export const MIN_FRAME_PT = 200;

/**
 * How many times a stroke must repeat before it is taken for a frame rule.
 *
 * The neatline is drawn several times over (border, mask, tick baseline), so a
 * genuine rule repeats; a single long stroke at the same x is usually a
 * coastline or an airspace boundary. Three is the lowest count observed for a
 * real rule in the edition (ENSK's left rule), so a higher threshold silently
 * loses charts - it did, at 8, which rejected 27 of 49 sheets.
 */
export const MIN_RULE_REPEATS = 3;

/** How far from the template a frame edge may be looked for, in PDF points. */
export const FRAME_SEARCH_PT = 40;

/* ------------------------------------------------------------------ *
 * Ellipsoid and conformal helpers
 * ------------------------------------------------------------------ */

const WGS84_A = 6378137.0;
const WGS84_F = 1 / 298.257223563;
const WGS84_E = Math.sqrt(WGS84_F * (2 - WGS84_F));
const DEG = Math.PI / 180;

/**
 * Isometric latitude, the vertical coordinate in which every conformal
 * projection of the ellipsoid becomes a holomorphic function.
 * @param {number} latDeg @returns {number}
 */
export function isometricLatitude(latDeg) {
  const phi = latDeg * DEG, s = Math.sin(phi);
  return Math.log(Math.tan(Math.PI / 4 + phi / 2) *
    Math.pow((1 - WGS84_E * s) / (1 + WGS84_E * s), WGS84_E / 2));
}

/**
 * Geodetic latitude from isometric latitude (Newton; converges in 3-4 steps).
 * @param {number} psi @returns {number} degrees
 */
export function geodeticLatitude(psi) {
  let phi = 2 * Math.atan(Math.exp(psi)) - Math.PI / 2;
  for (let i = 0; i < 12; i++) {
    const s = Math.sin(phi);
    const f = Math.log(Math.tan(Math.PI / 4 + phi / 2) *
      Math.pow((1 - WGS84_E * s) / (1 + WGS84_E * s), WGS84_E / 2)) - psi;
    // d(psi)/d(phi); Newton DIVIDES by it. Multiplying overshoots by a factor
    // of ~2.8 at these latitudes, walks phi past the pole, and the next
    // log() of a negative tangent returns NaN rather than diverging visibly.
    const dPsiDPhi = (1 - WGS84_E * WGS84_E) / ((1 - WGS84_E * WGS84_E * s * s) * Math.cos(phi));
    const step = f / dPsiDPhi;
    phi -= step;
    if (Math.abs(step) < 1e-14) break;
  }
  return phi / DEG;
}

/**
 * Metres on the ground per degree of latitude and of longitude at a latitude.
 * Only ever used to report a residual in metres, so the ellipsoidal radii are
 * ample and no geodesic solver is needed here.
 * @param {number} latDeg @returns {{perLat: number, perLng: number}}
 */
export function metresPerDegree(latDeg) {
  const phi = latDeg * DEG, e2 = WGS84_E * WGS84_E;
  const w = 1 - e2 * Math.sin(phi) * Math.sin(phi);
  const meridional = WGS84_A * (1 - e2) / Math.pow(w, 1.5);
  const primeVertical = WGS84_A / Math.sqrt(w);
  return { perLat: meridional * DEG, perLng: primeVertical * Math.cos(phi) * DEG };
}

/* ------------------------------------------------------------------ *
 * Small linear algebra
 * ------------------------------------------------------------------ */

/**
 * Least squares for A x = b by normal equations with partial pivoting.
 * Returns null when the system is rank-deficient, which is how a chart with a
 * missing edge refuses itself instead of returning a runaway solution.
 * @param {number[][]} rows @param {number[]} rhs @returns {number[]|null}
 */
export function leastSquares(rows, rhs) {
  if (!rows.length) return null;
  const first = rows[0];
  if (!first) return null;
  const n = first.length;
  /** @type {number[][]} */
  const S = Array.from({ length: n }, () => new Array(n).fill(0));
  const r = new Array(n).fill(0);
  for (let k = 0; k < rows.length; k++) {
    const t = rows[k], y = rhs[k];
    if (!t || y === undefined) continue;
    for (let i = 0; i < n; i++) {
      const ti = t[i]; if (ti === undefined) continue;
      const Si = S[i]; if (!Si) continue;
      for (let j = 0; j < n; j++) {
        const tj = t[j]; if (tj === undefined) continue;
        Si[j] = (Si[j] ?? 0) + ti * tj;
      }
      r[i] += ti * y;
    }
  }
  /** @type {number[][]} */
  const m = S.map((row, i) => row.concat([r[i] ?? 0]));
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let q = i + 1; q < n; q++) {
      const a = m[q], b = m[p];
      if (a && b && Math.abs(a[i] ?? 0) > Math.abs(b[i] ?? 0)) p = q;
    }
    const mi = m[i], mp = m[p];
    if (!mi || !mp) return null;
    m[i] = mp; m[p] = mi;
    const pivot = m[i]?.[i] ?? 0;
    if (!Number.isFinite(pivot) || Math.abs(pivot) < 1e-13) return null;
    for (let q = 0; q < n; q++) {
      if (q === i) continue;
      const mq = m[q], mrow = m[i];
      if (!mq || !mrow) continue;
      const f = (mq[i] ?? 0) / pivot;
      for (let c = i; c <= n; c++) mq[c] = (mq[c] ?? 0) - f * (mrow[c] ?? 0);
    }
  }
  return m.map((row, i) => (row[n] ?? 0) / (m[i]?.[i] ?? 1));
}

/**
 * Powers 1, z, z^2 ... z^order of a complex z, as [re, im] pairs.
 * @param {number} x @param {number} y @param {number} order
 * @returns {[number, number][]}
 */
export function complexPowers(x, y, order) {
  /** @type {[number, number][]} */
  const out = [[1, 0]];
  let re = 1, im = 0;
  for (let k = 1; k <= order; k++) {
    const nr = re * x - im * y, ni = re * y + im * x;
    re = nr; im = ni;
    out.push([re, im]);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * The map frame and its graticule ticks
 * ------------------------------------------------------------------ */

/**
 * A straight stroke from the page content, in PDF user space (y upwards),
 * with the current transformation matrix already applied.
 * @typedef {{a: [number, number], b: [number, number]}} Segment
 */

/**
 * A positioned text run from the page's text layer. `x`/`y` are the run's
 * origin and `width` its advance, both in PDF points.
 * @typedef {{str: string, x: number, y: number, width: number}} TextItem
 */

/** @typedef {{left: number, right: number, bottom: number, top: number}} Frame */

const segLength = (/** @type {Segment} */ s) => Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
const segAngle = (/** @type {Segment} */ s) =>
  ((Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0]) * 180 / Math.PI) + 360) % 180;

/**
 * The map neatline, found by taking the repeated long rules nearest the sheet
 * template. Returns null when no plausible rectangle is present.
 * @param {Segment[]} segments @returns {Frame|null}
 */
export function chartFrame(segments) {
  /** @type {Map<number, number>} */ const vertical = new Map();
  /** @type {Map<number, number>} */ const horizontal = new Map();
  for (const s of segments) {
    if (segLength(s) < 80) continue;
    const a = segAngle(s);
    if (Math.abs(a - 90) < 0.3) {
      const x = Number(s.a[0].toFixed(1));
      vertical.set(x, (vertical.get(x) ?? 0) + 1);
    } else if (Math.min(a, 180 - a) < 0.3) {
      const y = Number(s.a[1].toFixed(1));
      horizontal.set(y, (horizontal.get(y) ?? 0) + 1);
    }
  }
  const rules = (/** @type {Map<number, number>} */ m) =>
    [...m.entries()].filter(([, n]) => n >= MIN_RULE_REPEATS).map(([v]) => v);
  const xs = rules(vertical), ys = rules(horizontal);
  if (xs.length < 2 || ys.length < 2) return null;
  const nearest = (/** @type {number[]} */ arr, /** @type {number} */ target) =>
    arr.reduce((best, v) => Math.abs(v - target) < Math.abs(best - target) ? v : best, arr[0] ?? target);
  let frame = {
    left: nearest(xs, SHEET_TEMPLATE.left), right: nearest(xs, SHEET_TEMPLATE.right),
    bottom: nearest(ys, SHEET_TEMPLATE.bottom), top: nearest(ys, SHEET_TEMPLATE.top)
  };
  if (frame.right - frame.left < MIN_FRAME_PT || frame.top - frame.bottom < MIN_FRAME_PT) return null;
  // THE FRAME EDGE IS THE RULE THE GRATICULE STANDS ON, which is not always
  // the outermost one: ENTO and ENVA print their bottom scale on an inner
  // rule 18-27 pt above the sheet border, and reading the border instead finds
  // no ticks at all. So each side is re-chosen among the nearby rules by which
  // one actually carries ticks. The template still bounds the search, so this
  // cannot wander off to an unrelated line.
  for (const side of /** @type {const} */ (['bottom', 'top', 'left', 'right'])) {
    const vertical = side === 'left' || side === 'right';
    const candidates = (vertical ? xs : ys)
      .filter((v) => Math.abs(v - SHEET_TEMPLATE[side]) <= FRAME_SEARCH_PT);
    /** @type {{value: number, ticks: number}|null} */ let best = null;
    for (const value of candidates) {
      const trial = { ...frame, [side]: value };
      if (trial.right - trial.left < MIN_FRAME_PT || trial.top - trial.bottom < MIN_FRAME_PT) continue;
      const count = edgeTicks(segments, trial)[side].length;
      if (!best || count > best.ticks) best = { value, ticks: count };
    }
    if (best) frame = { ...frame, [side]: best.value };
  }
  return frame;
}

/** @typedef {{pos: number, length: number}} Tick */

/** How far two drawn tick lengths may differ and still be the same tick. */
export const TICK_LENGTH_TOLERANCE_PT = 0.15;

/**
 * The graticule ticks on each edge of the frame.
 *
 * A tick is any short stroke standing on the neatline and pointing into the
 * map. Which of them are the labelled 10' ticks is settled by the labels
 * themselves, not by how long they are drawn - see below.
 *
 * @param {Segment[]} segments @param {Frame} frame
 * @returns {{bottom: Tick[], top: Tick[], left: Tick[], right: Tick[]}}
 */
export function edgeTicks(segments, frame) {
  /** @type {Map<string, {edge: string, pos: number, length: number}>} */
  const seen = new Map();
  for (const s of segments) {
    const len = segLength(s);
    if (len < 2 || len > 8) continue;
    const key = [s.a[0], s.a[1], s.b[0], s.b[1]].map((v) => v.toFixed(3)).join(',');
    if (seen.has(key)) continue;
    const a = segAngle(s);
    const xmin = Math.min(s.a[0], s.b[0]), xmax = Math.max(s.a[0], s.b[0]);
    const ymin = Math.min(s.a[1], s.b[1]), ymax = Math.max(s.a[1], s.b[1]);
    const upright = Math.abs(a - 90) < 0.3, flat = Math.min(a, 180 - a) < 0.3;
    const withinX = xmin > frame.left && xmax < frame.right;
    const withinY = ymin > frame.bottom && ymax < frame.top;
    /** @type {string|null} */ let edge = null;
    if (upright && Math.abs(ymin - frame.bottom) < 0.6 && withinX) edge = 'bottom';
    else if (upright && Math.abs(ymax - frame.top) < 0.6 && withinX) edge = 'top';
    else if (flat && Math.abs(xmin - frame.left) < 0.6 && withinY) edge = 'left';
    else if (flat && Math.abs(xmax - frame.right) < 0.6 && withinY) edge = 'right';
    if (!edge) continue;
    const pos = (edge === 'bottom' || edge === 'top') ? (s.a[0] + s.b[0]) / 2 : (s.a[1] + s.b[1]) / 2;
    seen.set(key, { edge, pos, length: Number(len.toFixed(2)) });
  }
  /** @type {{bottom: Tick[], top: Tick[], left: Tick[], right: Tick[]}} */
  const out = { bottom: [], top: [], left: [], right: [] };
  /** @type {Record<string, {pos: number, length: number}[]>} */
  const grouped = { bottom: [], top: [], left: [], right: [] };
  for (const t of seen.values()) (grouped[t.edge] ??= []).push({ pos: t.pos, length: t.length });
  // NO LENGTH CLASSIFICATION AT ALL, and that is a deliberate deletion. The
  // code here used to pick out "major" ticks by drawn length, and it kept
  // breaking a different chart: ENSO's left rule buries its 5.04 pt majors
  // under 7.92 pt marks, ENRM draws its minor ticks at 2.88, 3.06 and 2.16 pt
  // on three different edges, and a sheet-wide vote just lets the busiest edge
  // decide for the others. Length was only ever a PROXY for the thing that
  // actually matters: a tick is major because a printed LABEL points at it.
  // So every stroke standing on the rule is kept here, and labelEdgeTicks
  // decides which ones are named. What guards against a stray mark is not its
  // length but the checks that follow - the printed values must step
  // uniformly, both edges of an axis must agree on the interval, and the fit
  // has to meet its residual gate.
  for (const edge of /** @type {const} */ (['bottom', 'top', 'left', 'right'])) {
    out[edge] = (grouped[edge] ?? []).sort((a, b) => a.pos - b.pos);
  }
  return out;
}

/** @typedef {{kind: 'lat'|'lng', value: number, x: number, y: number, centre: number}} GraticuleLabel */

/**
 * The printed graticule labels, e.g. "69°20'N" and "018°30'E".
 *
 * `centre` is the run's midpoint along its own text direction, which is where
 * the tick sits: measured across the edition the tick is 0.12 pt from the
 * label centre on a horizontal edge and 0.08 pt on a vertical one.
 *
 * @param {TextItem[]} items @returns {GraticuleLabel[]}
 */
export function graticuleLabels(items) {
  /** @type {GraticuleLabel[]} */ const out = [];
  for (const it of items) {
    const s = String(it.str || '').trim().replace(/[’′]/g, "'");
    let m = /^(\d{1,2})°(\d{2})'?([NS])$/.exec(s);
    if (m && m[1] && m[2]) {
      out.push({ kind: 'lat', value: (Number(m[1]) + Number(m[2]) / 60) * (m[3] === 'N' ? 1 : -1),
        x: it.x, y: it.y, centre: it.y + it.width / 2 });
      continue;
    }
    m = /^(\d{1,3})°(\d{2})'?([EW])$/.exec(s);
    if (m && m[1] && m[2]) {
      out.push({ kind: 'lng', value: (Number(m[1]) + Number(m[2]) / 60) * (m[3] === 'E' ? 1 : -1),
        x: it.x, y: it.y, centre: it.x + it.width / 2 });
    }
  }
  return out;
}

/**
 * How many labelled 10' ticks an edge must carry.
 *
 * ONLY THE MAJOR TICKS ARE FITTED, and that is a deliberate narrowing. The
 * minute ticks between them carry no printed value, so numbering them means
 * counting - and counting assumes the edge holds every tick. It does not:
 * ENOL's right edge yields gaps of 10, 6, 5 and 10 ticks between successive
 * labelled majors, because some minute ticks are drawn over other ink and do
 * not survive extraction. Counting through a gap like that shifts every tick
 * after it by a whole minute, which is a kilometre of chart, and the resulting
 * model still looks plausible.
 *
 * Nothing is lost by dropping them: measured across the edition, a fit on the
 * majors alone predicts the held-out minute ticks to 5-11 m RMS, because the
 * model is already at the sheet's tick quantisation. So the minute ticks are
 * worth more as INDEPENDENT VALIDATION than as fit data, and that is what they
 * are used for.
 */
export const MIN_LABELLED_MAJORS = 2;

/** One minute of arc, in degrees - the pitch of a VAC's minor graticule ticks. */
export const GRATICULE_MINUTE = 1 / 60;

/** @typedef {{kind: 'lat'|'lng', x: number, y: number, value: number, major: boolean}} Observation */
/** @typedef {{edge: string, reason: string, detail?: string}} Refusal */

/**
 * Read one edge's graticule: the labelled 10' ticks to fit, and the minute
 * ticks between them to validate against.
 *
 * @param {'bottom'|'top'|'left'|'right'} edge
 * @param {Tick[]} ticks
 * @param {GraticuleLabel[]} labels
 * @param {Frame} frame
 * @returns {{fit: Observation[], holdout: Observation[], labelOffset: number, valueStep: number}|Refusal}
 */
export function labelEdgeTicks(edge, ticks, labels, frame) {
  if (ticks.length < 4) return { edge, reason: 'few-ticks', detail: `${ticks.length} found` };
  const horizontal = edge === 'bottom' || edge === 'top';
  /** @type {'lat'|'lng'} */ const kind = horizontal ? 'lng' : 'lat';
  const majors = ticks.map((t, i) => ({ t, i }));
  const outside = {
    bottom: (/** @type {GraticuleLabel} */ l) => l.y < frame.bottom && frame.bottom - l.y < 22,
    top: (/** @type {GraticuleLabel} */ l) => l.y > frame.top && l.y - frame.top < 22,
    left: (/** @type {GraticuleLabel} */ l) => l.x < frame.left && frame.left - l.x < 22,
    right: (/** @type {GraticuleLabel} */ l) => l.x > frame.right && l.x - frame.right < 22
  }[edge];
  const candidates = labels.filter((l) => l.kind === kind && outside(l));
  if (candidates.length < MIN_LABELLED_MAJORS) {
    return { edge, reason: 'no-labels', detail: `${candidates.length} beside this edge` };
  }
  // The label sits a fixed distance from its tick, so take the median offset
  // first and match against that rather than against raw proximity. Measured
  // across the edition: 0.12 pt on a horizontal edge, 0.08 pt on a vertical
  // one - the tick is effectively at the label's own centre.
  // Measured from the LABEL side for the same reason the pairing is: a spare
  // mark drawn at major length would otherwise drag the median offset away
  // from the truth and take the 3.5 pt matching window with it.
  const offsets = candidates.map((l) => {
    let best = Number.NaN;
    for (const { i } of majors) {
      const d = (ticks[i]?.pos ?? 0) - l.centre;
      if (Number.isNaN(best) || Math.abs(d) < Math.abs(best)) best = d;
    }
    return best;
  }).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const labelOffset = offsets[Math.floor(offsets.length / 2)] ?? 0;
  // MATCH FROM THE LABEL, NOT FROM THE TICK. The labels are the scarce and
  // authoritative side: a sheet prints one per 10' tick, while an edge can
  // carry other marks drawn at the same length as a major tick - ENBS's right
  // edge has four 5.04 pt marks against two labels. Matching tick -> nearest
  // label makes those spares collide on a label and, with every collision
  // dropped, throws the whole edge away. Matching label -> nearest tick gives
  // each printed value the one tick it names and simply ignores the spares.
  /** @type {{i: number, pos: number, value: number}[]} */ const kept = [];
  /** @type {Set<number>} */ const taken = new Set();
  for (const l of candidates) {
    /** @type {{d: number, i: number, pos: number}|null} */ let best = null;
    for (const { i } of majors) {
      if (taken.has(i)) continue;
      const pos = ticks[i]?.pos ?? 0;
      const d = Math.abs(pos - l.centre - labelOffset);
      if (!best || d < best.d) best = { d, i, pos };
    }
    if (best && best.d < 3.5) { taken.add(best.i); kept.push({ i: best.i, pos: best.pos, value: l.value }); }
  }
  kept.sort((a, b) => a.i - b.i);
  if (kept.length < MIN_LABELLED_MAJORS) {
    return { edge, reason: 'unlabelled-major-ticks',
      detail: `${kept.length} of ${majors.length} major ticks carry a label of their own` };
  }
  // The PRINTED values must step uniformly. This says nothing about how many
  // ticks lie between them, so it holds even where minute ticks are missing.
  /** @type {number[]} */ const gaps = [];
  for (let k = 1; k < kept.length; k++) {
    const a = kept[k - 1], b = kept[k];
    if (a && b) gaps.push(b.value - a.value);
  }
  const valueStep = gaps[0];
  if (valueStep === undefined || valueStep === 0) return { edge, reason: 'zero-label-step' };
  if (gaps.some((g) => Math.abs(g - valueStep) > 1e-9)) {
    return { edge, reason: 'uneven-label-values',
      detail: gaps.map((g) => (g * 60).toFixed(3)).join(', ') + ' minutes apart' };
  }
  const place = (/** @type {number} */ pos, /** @type {number} */ value, /** @type {boolean} */ major) => ({
    kind,
    x: horizontal ? pos : (edge === 'left' ? frame.left : frame.right),
    y: edge === 'bottom' ? frame.bottom : edge === 'top' ? frame.top : pos,
    value, major
  });
  const fit = kept.map((p) => place(p.pos, p.value, true));
  // Validation: the minute ticks inside an interval, but ONLY where the number
  // of ticks found matches the number of minutes the interval spans. An
  // interval that is missing a tick is skipped rather than interpolated, so a
  // holdout value is never itself a guess.
  const perInterval = Math.round(Math.abs(valueStep) / GRATICULE_MINUTE) - 1;
  /** @type {Observation[]} */ const holdout = [];
  for (let k = 1; k < kept.length; k++) {
    const a = kept[k - 1], b = kept[k];
    if (!a || !b || b.i - a.i - 1 !== perInterval) continue;
    for (let j = a.i + 1; j < b.i; j++) {
      const t = ticks[j];
      if (t) holdout.push(place(t.pos, a.value + (j - a.i) * (valueStep / (perInterval + 1)), false));
    }
  }
  return { fit, holdout, labelOffset, valueStep };
}

/**
 * Every graticule observation on a sheet, from all four edges.
 *
 * ALL FOUR ARE REQUIRED - see the header. Three would still fit; the fourth
 * is what makes the axis cross-check below possible, so an edge that refuses
 * itself refuses the chart.
 *
 * @param {Segment[]} segments @param {TextItem[]} items @param {Frame} frame
 * @returns {{fit: Observation[], holdout: Observation[],
 *            edges: Record<string, {valueStep: number, labelOffset: number, fit: number, holdout: number}>}
 *           | {refused: Refusal[]}}
 */
export function graticuleObservations(segments, items, frame) {
  const ticks = edgeTicks(segments, frame);
  const labels = graticuleLabels(items);
  /** @type {Observation[]} */ const fit = [];
  /** @type {Observation[]} */ const holdout = [];
  /** @type {Record<string, {valueStep: number, labelOffset: number, fit: number, holdout: number}>} */ const edges = {};
  /** @type {Refusal[]} */ const refused = [];
  for (const edge of /** @type {const} */ (['bottom', 'top', 'left', 'right'])) {
    const got = labelEdgeTicks(edge, ticks[edge], labels, frame);
    if ('reason' in got) { refused.push(got); continue; }
    fit.push(...got.fit);
    holdout.push(...got.holdout);
    edges[edge] = { valueStep: got.valueStep, labelOffset: got.labelOffset,
      fit: got.fit.length, holdout: got.holdout.length };
  }
  if (refused.length) return { refused };
  // THE TWO EDGES OF AN AXIS MUST AGREE ON THE INTERVAL. A sheet draws one
  // graticule, so the bottom and top are labelled at the same interval and so
  // are the left and right. This catches an edge whose labels were matched one
  // major out: nothing is wrong with that edge on its own terms, and only its
  // disagreement with the opposite edge gives it away.
  for (const [a, b] of [['bottom', 'top'], ['left', 'right']]) {
    const x = edges[a ?? ''], y = edges[b ?? ''];
    if (!x || !y) continue;
    if (Math.abs(x.valueStep - y.valueStep) > 1e-9) {
      return { refused: [{ edge: `${a}/${b}`, reason: 'edges-disagree-on-interval',
        detail: `${(x.valueStep * 60).toFixed(3)} vs ${(y.valueStep * 60).toFixed(3)} minutes` }] };
    }
  }
  return { fit, holdout, edges };
}

/* ------------------------------------------------------------------ *
 * The conformal model
 * ------------------------------------------------------------------ */

/**
 * The order of the complex polynomial.
 *
 * MEASURED on ENDU's 256 graticule observations: order 1 leaves 1.84 pt,
 * order 2 reaches 0.069 pt, order 3 gains 3% and order 4 nothing. 0.069 pt is
 * the sheet's own tick quantisation (positions are snapped to a 0.24 pt grid,
 * standard deviation 0.069 pt), so order 2 has reached the chart's drafting
 * precision and a higher order only fits the quantisation noise.
 */
export const MODEL_ORDER = 2;

/** @typedef {{order: number, cx: number, cy: number, scale: number, coefficients: number[]}} Model */

/**
 * Fit the inverse mapping page (x, y) -> (longitude, isometric latitude) as a
 * complex polynomial, which is conformal by construction.
 *
 * Each observation constrains exactly one component - a longitude tick fixes
 * the real part, a latitude tick the imaginary part - and both are LINEAR in
 * the complex coefficients, so this is one least-squares solve with no
 * iteration and no starting guess.
 *
 * @param {Observation[]} observations @param {Frame} frame @param {number} [order]
 * @returns {Model|null}
 */
export function fitConformal(observations, frame, order = MODEL_ORDER) {
  const cx = (frame.left + frame.right) / 2, cy = (frame.bottom + frame.top) / 2;
  const scale = 100;
  /** @type {number[][]} */ const rows = [];
  /** @type {number[]} */ const rhs = [];
  for (const o of observations) {
    const p = complexPowers((o.x - cx) / scale, (o.y - cy) / scale, order);
    const row = new Array(2 * (order + 1)).fill(0);
    if (o.kind === 'lng') {
      for (let k = 0; k <= order; k++) {
        const pk = p[k]; if (!pk) continue;
        row[2 * k] = pk[0]; row[2 * k + 1] = -pk[1];
      }
      rhs.push(o.value * DEG);
    } else {
      for (let k = 0; k <= order; k++) {
        const pk = p[k]; if (!pk) continue;
        row[2 * k] = pk[1]; row[2 * k + 1] = pk[0];
      }
      rhs.push(isometricLatitude(o.value));
    }
    rows.push(row);
  }
  const coefficients = leastSquares(rows, rhs);
  if (!coefficients || coefficients.some((c) => !Number.isFinite(c))) return null;
  return { order, cx, cy, scale, coefficients };
}

/**
 * Where a point on the page is, in degrees.
 * @param {Model} model @param {number} x @param {number} y
 * @returns {{lng: number, psi: number, lat: number}}
 */
export function evaluate(model, x, y) {
  const p = complexPowers((x - model.cx) / model.scale, (y - model.cy) / model.scale, model.order);
  let re = 0, im = 0;
  for (let k = 0; k <= model.order; k++) {
    const pk = p[k]; if (!pk) continue;
    const cr = model.coefficients[2 * k] ?? 0, ci = model.coefficients[2 * k + 1] ?? 0;
    re += cr * pk[0] - ci * pk[1];
    im += cr * pk[1] + ci * pk[0];
  }
  return { lng: re / DEG, psi: im, lat: geodeticLatitude(im) };
}

/**
 * The model's derivatives at a page point, by central difference.
 * @param {Model} model @param {number} x @param {number} y
 * @returns {{dLngDx: number, dLngDy: number, dPsiDx: number, dPsiDy: number}}
 */
function jacobian(model, x, y) {
  const h = 0.25;
  const ex = evaluate(model, x + h, y), wx = evaluate(model, x - h, y);
  const ey = evaluate(model, x, y + h), wy = evaluate(model, x, y - h);
  return {
    dLngDx: (ex.lng - wx.lng) / (2 * h), dLngDy: (ey.lng - wy.lng) / (2 * h),
    dPsiDx: (ex.psi - wx.psi) / (2 * h), dPsiDy: (ey.psi - wy.psi) / (2 * h)
  };
}

/**
 * Metres on the ground per PDF point at a page position. A conformal map has
 * one scale in every direction, so this is a single number.
 * @param {Model} model @param {number} x @param {number} y @returns {number}
 */
export function groundScale(model, x, y) {
  const here = evaluate(model, x, y), east = evaluate(model, x + 1, y);
  const per = metresPerDegree(here.lat);
  return Math.hypot((east.lng - here.lng) * per.perLng, (east.lat - here.lat) * per.perLat);
}

/**
 * Where a coordinate falls on the page. Newton on the model's own Jacobian.
 * @param {Model} model @param {number} lat @param {number} lng @param {Frame} frame
 * @returns {[number, number]|null}
 */
export function project(model, lat, lng, frame) {
  let x = (frame.left + frame.right) / 2, y = (frame.bottom + frame.top) / 2;
  const targetPsi = isometricLatitude(lat);
  for (let i = 0; i < 60; i++) {
    const p = evaluate(model, x, y), j = jacobian(model, x, y);
    const f1 = p.lng - lng, f2 = p.psi - targetPsi;
    const det = j.dLngDx * j.dPsiDy - j.dLngDy * j.dPsiDx;
    if (!det || !Number.isFinite(det)) return null;
    x -= (f1 * j.dPsiDy - f2 * j.dLngDy) / det;
    y -= (-f1 * j.dPsiDx + f2 * j.dLngDx) / det;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (Math.abs(f1) < 1e-12 && Math.abs(f2) < 1e-12) break;
  }
  return [x, y];
}

/**
 * How far each observation lies from where the model puts its coordinate.
 *
 * The residual is the PERPENDICULAR distance on the page from the observed
 * tick to the model's iso-line for that tick's value, which is the honest
 * measure for an observation that constrains one coordinate only.
 *
 * @param {Model} model @param {Observation[]} observations
 * @returns {{rmsPoints: number, maxPoints: number, rmsMetres: number, maxMetres: number, count: number}}
 */
export function observationResiduals(model, observations) {
  let sumSq = 0, max = 0, sumSqM = 0, maxM = 0, n = 0;
  for (const o of observations) {
    const p = evaluate(model, o.x, o.y), j = jacobian(model, o.x, o.y);
    const err = o.kind === 'lng' ? (p.lng - o.value) * DEG : p.psi - isometricLatitude(o.value);
    const gx = o.kind === 'lng' ? j.dLngDx * DEG : j.dPsiDx;
    const gy = o.kind === 'lng' ? j.dLngDy * DEG : j.dPsiDy;
    const grad = Math.hypot(gx, gy);
    if (!grad) continue;
    const pts = Math.abs(err) / grad;
    const metres = pts * groundScale(model, o.x, o.y);
    sumSq += pts * pts; sumSqM += metres * metres;
    max = Math.max(max, pts); maxM = Math.max(maxM, metres);
    n++;
  }
  return {
    rmsPoints: n ? Math.sqrt(sumSq / n) : Number.NaN,
    maxPoints: max,
    rmsMetres: n ? Math.sqrt(sumSqM / n) : Number.NaN,
    maxMetres: maxM,
    count: n
  };
}

/* ------------------------------------------------------------------ *
 * Published reporting points drawn on the chart face
 * ------------------------------------------------------------------ */

/** @typedef {{x: number, y: number, perimeter: number, vertices: [number, number][]}} ChartSymbol */

/**
 * Every closed triangle drawn inside the map frame, with its BOUNDING-BOX
 * CENTRE as the anchor.
 *
 * The anchor is the measured one - see the header. `x`/`y` are the
 * bounding-box centre; the vertices are kept so a caller can audit it.
 *
 * @param {Segment[]} segments @param {Frame} frame @returns {ChartSymbol[]}
 */
export function chartTriangles(segments, frame) {
  /** @type {Map<string, Segment>} */ const unique = new Map();
  for (const s of segments) {
    unique.set([s.a[0], s.a[1], s.b[0], s.b[1]].map((v) => v.toFixed(3)).join(','), s);
  }
  const at = (/** @type {[number, number]} */ p) => p.map((v) => v.toFixed(2)).join(',');
  /** @type {Map<string, Segment[]>} */ const fromPoint = new Map();
  for (const s of unique.values()) {
    const k = at(s.a);
    const list = fromPoint.get(k);
    if (list) list.push(s); else fromPoint.set(k, [s]);
  }
  /** @type {ChartSymbol[]} */ const found = [];
  for (const s1 of unique.values()) {
    for (const s2 of fromPoint.get(at(s1.b)) ?? []) {
      for (const s3 of fromPoint.get(at(s2.b)) ?? []) {
        if (Math.hypot(s3.b[0] - s1.a[0], s3.b[1] - s1.a[1]) > 0.05) continue;
        const perimeter = segLength(s1) + segLength(s2) + segLength(s3);
        if (perimeter < 8 || perimeter > 60) continue;
        /** @type {[number, number][]} */ const vertices = [s1.a, s2.a, s3.a];
        const xs = vertices.map((v) => v[0]), ys = vertices.map((v) => v[1]);
        const x = (Math.min(...xs) + Math.max(...xs)) / 2;
        const y = (Math.min(...ys) + Math.max(...ys)) / 2;
        if (x < frame.left || x > frame.right || y < frame.bottom || y > frame.top) continue;
        if (found.some((f) => Math.hypot(f.x - x, f.y - y) < 0.4)) continue;
        found.push({ x, y, perimeter, vertices });
      }
    }
  }
  return found;
}

/**
 * How close a symbol must be to where the graticule model puts its published
 * point. Generous on purpose: the consensus on symbol size and the one-to-one
 * requirement below are what actually decide a match, and a tight radius here
 * would instead hide a real disagreement between the two control sources.
 */
export const SYMBOL_MATCH_RADIUS_PT = 6;

/** How far a symbol's perimeter may sit from the sheet's consensus size. */
export const SYMBOL_PERIMETER_TOLERANCE_PT = 0.6;

/** @typedef {{name: string, lat: number, lng: number}} PublishedPoint */
/** @typedef {{name: string, lat: number, lng: number, x: number, y: number, perimeter: number}} Control */

/**
 * Pair the published coordinate table with the symbols drawn on the chart.
 *
 * The graticule model supplies the CORRESPONDENCE and the published table
 * supplies the PRECISION: the model says roughly where a point should be, the
 * nearest symbol is taken, and the final control coordinate is the published
 * one paired with the symbol's own measured anchor. A symbol whose size is not
 * the sheet's consensus is dropped - one chart in the edition draws a smaller
 * triangle near a reporting point and it would otherwise be matched instead of
 * the real symbol. A symbol claimed by two points is dropped from both.
 *
 * @param {ChartSymbol[]} symbols @param {PublishedPoint[]} points
 * @param {(lat: number, lng: number) => [number, number]|null} projector
 * @returns {{controls: Control[], unmatched: string[], consensusPerimeter: number|null}}
 */
export function matchPublishedPoints(symbols, points, projector) {
  /** @type {{point: PublishedPoint, symbol: ChartSymbol}[]} */ const candidates = [];
  /** @type {string[]} */ const unmatched = [];
  for (const p of points) {
    const where = projector(p.lat, p.lng);
    if (!where) { unmatched.push(p.name); continue; }
    /** @type {{d: number, symbol: ChartSymbol}|null} */ let best = null;
    for (const s of symbols) {
      const d = Math.hypot(s.x - where[0], s.y - where[1]);
      if (!best || d < best.d) best = { d, symbol: s };
    }
    if (!best || best.d > SYMBOL_MATCH_RADIUS_PT) { unmatched.push(p.name); continue; }
    candidates.push({ point: p, symbol: best.symbol });
  }
  // The sheet draws its reporting points at ONE size; anything else is a
  // different chart symbol that happened to be nearest.
  /** @type {Map<string, number>} */ const tally = new Map();
  for (const c of candidates) {
    const k = c.symbol.perimeter.toFixed(1);
    tally.set(k, (tally.get(k) ?? 0) + 1);
  }
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  const consensusPerimeter = top ? Number(top[0]) : null;
  /** @type {Map<string, number>} */ const claims = new Map();
  for (const c of candidates) {
    const k = `${c.symbol.x.toFixed(3)},${c.symbol.y.toFixed(3)}`;
    claims.set(k, (claims.get(k) ?? 0) + 1);
  }
  /** @type {Control[]} */ const controls = [];
  for (const c of candidates) {
    const k = `${c.symbol.x.toFixed(3)},${c.symbol.y.toFixed(3)}`;
    const sized = consensusPerimeter !== null &&
      Math.abs(c.symbol.perimeter - consensusPerimeter) <= SYMBOL_PERIMETER_TOLERANCE_PT;
    if (!sized || (claims.get(k) ?? 0) > 1) { unmatched.push(c.point.name); continue; }
    controls.push({
      name: c.point.name, lat: c.point.lat, lng: c.point.lng,
      x: c.symbol.x, y: c.symbol.y, perimeter: c.symbol.perimeter
    });
  }
  controls.sort((a, b) => a.name.localeCompare(b.name, 'nb'));
  return { controls, unmatched, consensusPerimeter };
}

/**
 * The fraction of the chart frame that a set of control points spans, in each
 * pixel axis. Four points in one corner is not a fit, however small its
 * residual comes back.
 * @param {{x: number, y: number}[]} controls @param {Frame} frame
 * @returns {{x: number, y: number}}
 */
export function controlSpanFraction(controls, frame) {
  if (controls.length < 2) return { x: 0, y: 0 };
  const xs = controls.map((c) => c.x), ys = controls.map((c) => c.y);
  return {
    x: (Math.max(...xs) - Math.min(...xs)) / (frame.right - frame.left),
    y: (Math.max(...ys) - Math.min(...ys)) / (frame.top - frame.bottom)
  };
}

/**
 * The smallest span a fit may cover, as a fraction of the chart frame.
 * A distribution guard, not a substitute for looking at the layout.
 */
export const MIN_CONTROL_SPAN_FRACTION = 0.4;

/** The minimum number of points that may be fitted, and held out. */
export const MIN_FIT_POINTS = 4;
export const MIN_VALIDATION_POINTS = 2;
