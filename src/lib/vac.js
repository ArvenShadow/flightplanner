/**
 * The VAC chart overlay - src/lib/vac.js
 *
 * A Visual Approach Chart drawn on the map, georeferenced at build time by
 * tools/build-vac-raster.mjs and shipped as one EPSG:3857 WebP per chart. This
 * module holds the rules: which charts are drawn, which one is on top, how the
 * opacity setting is validated, and - the load-bearing one - whether a chart
 * may be drawn at all.
 *
 * THE RASTER IS DISPLAY-ONLY. No coordinate in this planner comes off a chart
 * image: the reporting points come from the printed coordinate TABLE, and the
 * symbols the build located were used to FIT the sheet, never to publish a
 * position. Nothing in this module reads a pixel.
 *
 * FAIL-CLOSED. A manifest entry missing a required field, or one whose recorded
 * residual exceeds its own declared threshold, is NOT DRAWN, and the label bar
 * says which. That is the v16.26 lesson: a chart that quietly turns out to be
 * in the wrong place is worse than one that was never offered. The check is
 * here rather than in the build so that a hand-edited or half-written index
 * cannot put ink on the map either.
 *
 * Pure: no DOM, no Leaflet, no fetch.
 */

/** @typedef {{west: number, east: number, south: number, north: number}} LngLatBounds */
/**
 * @typedef {{icao: string, chart: string, chartDate: string, file: string,
 *            bounds: LngLatBounds, width: number, height: number,
 *            sourcePdfSha256: string, preparationRevision: number,
 *            controlSource: string, residualM: number, thresholdM: number,
 *            superseded?: string|null}} VacChart
 */

/**
 * Nothing is drawn below this zoom.
 *
 * WAS 10 UNTIL v16.87, ON A REASON THAT WAS ONLY HALF RIGHT. The old note said
 * the sheet is a smear further out and the decode is wasted. The legibility
 * half is the pilot's call and they asked for it further out; the COST half was
 * measured, and it turned out not to be about zoom at all - it is about HOW
 * MANY sheets land on screen at once.
 *
 * MEASURED in Chromium, with Leaflet's own bounds on the real map container
 * (597x874 in the split layout - an earlier scan assumed the whole window and
 * overstated every count):
 *
 *     zoom   worst-case sheets in view, anywhere in Norway
 *       7        20
 *       8         9
 *       9         6
 *      10         4     <- the shipped floor until v16.87
 *      11         3
 *
 * And the cost tracks the COUNT, not the zoom: 12 sheets froze the map for
 * 2.2 s while it rasterised, and the same viewport with 3 settled in 727 ms.
 * Once settled, even 12 sheets pan in 17 ms - the cost is all first paint.
 *
 * So the floor moves to 8 and VAC_MAX_DRAWN bounds the load. Zoom 7 is still
 * refused, and not for cost: capping would hide 14 of 20 sheets, and a chart
 * that is silently absent is worse than one that was never offered.
 */
export const VAC_MIN_ZOOM = 8;

/**
 * How many sheets may be drawn at once, nearest the middle of the map first.
 *
 * DERIVED, NOT PICKED: 6 is exactly the worst case zoom 9 already produced
 * before the floor moved, so going further out can never cost more than the
 * shipped floor's own neighbour already did. It only bites at zoom 8, whose
 * worst viewport holds 9 - measured there at 2300 ms uncapped against 1493 ms
 * capped.
 *
 * WHAT IS WITHHELD IS SAID, because this is the one place the overlay can be
 * incomplete without being wrong - see vacLabel.
 */
export const VAC_MAX_DRAWN = 6;

/** Opacity bounds, and the default. */
export const VAC_OPACITY_MIN = 0.2;
export const VAC_OPACITY_MAX = 1;
export const VAC_OPACITY_DEFAULT = 0.85;

/** Every field a manifest entry must carry before anything is drawn. */
export const REQUIRED_FIELDS = ['icao', 'chart', 'chartDate', 'file', 'bounds', 'width', 'height',
  'sourcePdfSha256', 'preparationRevision', 'controlSource', 'residualM', 'thresholdM'];

/**
 * The opacity setting, validated.
 *
 * Re-validated on EVERY read, not trusted from storage: it is carried in
 * PROFILE_KEYS, so it can arrive from a route file somebody else wrote or from
 * a hand-edited localStorage. Anything unreadable falls back to the default
 * rather than to an invisible or opaque overlay.
 * @param {unknown} value @returns {number}
 */
export function normaliseVacOpacity(value) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return VAC_OPACITY_DEFAULT;
  if (n < VAC_OPACITY_MIN) return VAC_OPACITY_MIN;
  if (n > VAC_OPACITY_MAX) return VAC_OPACITY_MAX;
  return Math.round(n * 100) / 100;
}

/** @param {unknown} value @returns {boolean} */
export function normaliseVacOn(value) {
  return value === true || value === 'true';
}

/**
 * Why a chart may not be drawn, or null when it may.
 * @param {any} chart @returns {string|null}
 */
export function vacRefusal(chart) {
  if (!chart || typeof chart !== 'object') return 'the entry is not a chart';
  for (const key of REQUIRED_FIELDS) {
    if (chart[key] === undefined || chart[key] === null) return `no ${key} recorded`;
  }
  const b = chart.bounds;
  for (const k of ['west', 'east', 'south', 'north']) {
    if (!Number.isFinite(b[k])) return `bounds.${k} is not a number`;
  }
  if (!(b.east > b.west) || !(b.north > b.south)) return 'the bounds are empty or inverted';
  if (!Number.isFinite(chart.residualM) || !Number.isFinite(chart.thresholdM)) {
    return 'the measured error is not recorded';
  }
  if (chart.residualM > chart.thresholdM) {
    return `measured ${chart.residualM.toFixed(1)} m against its own ${chart.thresholdM} m limit`;
  }
  // A chart the live edition has amended is not this chart any more.
  if (chart.superseded) return `superseded in ${chart.superseded}`;
  return null;
}

/** @param {any} chart @returns {boolean} */
export function vacDrawable(chart) { return vacRefusal(chart) === null; }

/**
 * The charts that should be on screen: drawable, above the min zoom, and
 * overlapping the viewport.
 * @param {VacChart[]} charts @param {LngLatBounds} view @param {number} zoom
 * @returns {VacChart[]}
 */
export function visibleVacCharts(charts, view, zoom) {
  if (!Array.isArray(charts) || zoom < VAC_MIN_ZOOM) return [];
  return charts.filter((c) => vacDrawable(c)
    && c.bounds.east > view.west && c.bounds.west < view.east
    && c.bounds.north > view.south && c.bounds.south < view.north);
}

/**
 * Draw order for charts that overlap on screen: the one whose sheet centre is
 * NEAREST the middle of the map goes on top, because that is the aerodrome the
 * pilot is looking at. Returned FARTHEST FIRST, so a caller can add them in
 * order and let the last win.
 *
 * They are not blended. Two half-transparent charts over one another produce a
 * third thing that is neither, and ENTC and ENDU genuinely abut.
 * @param {VacChart[]} charts @param {{lat: number, lng: number}} centre
 * @returns {VacChart[]}
 */
export function vacDrawOrder(charts, centre, limit = VAC_MAX_DRAWN) {
  const d = (/** @type {VacChart} */ c) => {
    const cy = (c.bounds.north + c.bounds.south) / 2, cx = (c.bounds.east + c.bounds.west) / 2;
    const k = Math.cos((centre.lat || 0) * Math.PI / 180);
    return Math.hypot(cy - centre.lat, (cx - centre.lng) * k);
  };
  const ordered = charts.slice().sort((a, b) => d(b) - d(a));
  // THE CAP TAKES FROM THE FRONT, because the list is farthest-first: the
  // sheets dropped are the ones furthest from where the pilot is looking.
  return Number.isFinite(limit) && limit >= 0 && ordered.length > limit
    ? ordered.slice(ordered.length - limit) : ordered;
}

/**
 * What the label bar says while a VAC is drawn.
 * @param {VacChart[]} drawn @param {{editionLabel?: string}|null} set
 * @param {string|null} [airacEdition] the edition the airspace data is on
 * @param {number} [inView] how many sheets overlap the viewport, drawn or not
 * @returns {string}
 */
export function vacLabel(drawn, set, airacEdition, inView) {
  if (!drawn || !drawn.length) return '';
  const names = drawn.map((c) => `${c.icao} VAC ${c.chartDate}`).join(' + ');
  const edition = set && set.editionLabel ? set.editionLabel : null;
  const mismatch = edition && airacEdition && edition !== airacEdition
    ? ` — prepared from ${edition}, airspace data is ${airacEdition}` : '';
  // AN INCOMPLETE OVERLAY MUST SAY SO. Everything else the overlay withholds is
  // withheld for ACCURACY and is wrong to draw; these are correct sheets left
  // out purely for load, so the pilot has to be told the picture is partial
  // rather than concluding there is no chart at that aerodrome.
  const held = typeof inView === 'number' && Number.isFinite(inView) && inView > drawn.length
    ? ` — ${drawn.length} of ${inView} on screen, nearest first (zoom in for the rest)` : '';
  return names + mismatch + held;
}

/**
 * The attribution line. The permission is NON-COMMERCIAL and says so wherever
 * the data appears - see the licence constraint in CLAUDE.md.
 * @param {{attribution?: string, editionLabel?: string}|null} set @returns {string}
 */
export function vacAttribution(set) {
  if (!set) return '';
  return set.attribution || ('Visual Approach Charts: AIP Norge © Avinor AS, used with permission ' +
    'for non-commercial use' + (set.editionLabel ? ` (${set.editionLabel})` : ''));
}
