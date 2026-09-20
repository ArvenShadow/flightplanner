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
 * A VAC covers roughly 60 km of ground. At zoom 9 a 1000 px window spans about
 * 110 km at these latitudes, so the whole sheet is a postage stamp and its ink
 * is a smear over the ICAO chart it is meant to add to; the raster is also
 * downscaled about 7x, which is pure decode cost for detail nobody can read.
 * At zoom 10 the sheet fills the window and reads as a chart. The build renders
 * at 600 dpi, which is 1:1 around zoom 12, so 10 to 13 is the band where the
 * overlay is worth its pixels.
 */
export const VAC_MIN_ZOOM = 10;

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
export function vacDrawOrder(charts, centre) {
  const d = (/** @type {VacChart} */ c) => {
    const cy = (c.bounds.north + c.bounds.south) / 2, cx = (c.bounds.east + c.bounds.west) / 2;
    const k = Math.cos((centre.lat || 0) * Math.PI / 180);
    return Math.hypot(cy - centre.lat, (cx - centre.lng) * k);
  };
  return charts.slice().sort((a, b) => d(b) - d(a));
}

/**
 * What the label bar says while a VAC is drawn.
 * @param {VacChart[]} drawn @param {{editionLabel?: string}|null} set
 * @param {string|null} [airacEdition] the edition the airspace data is on
 * @returns {string}
 */
export function vacLabel(drawn, set, airacEdition) {
  if (!drawn || !drawn.length) return '';
  const names = drawn.map((c) => `${c.icao} VAC ${c.chartDate}`).join(' + ');
  const edition = set && set.editionLabel ? set.editionLabel : null;
  const mismatch = edition && airacEdition && edition !== airacEdition
    ? ` — prepared from ${edition}, airspace data is ${airacEdition}` : '';
  return names + mismatch;
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
