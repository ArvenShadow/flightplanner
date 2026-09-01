/**
 * Working out which chart tiles cover a route - src/lib/tiles.js (v16.22).
 *
 * WHY THIS EXISTS. Avinor serves every chart tile with
 *   Cache-Control: must-revalidate, max-age=0, public
 * which tells the browser it may never reuse a tile without asking the
 * server first. So panning the VFR chart costs a network round trip per
 * tile, every time, even though the bytes are already on disk. (Kartverket
 * sends max-age=432000 - five days - which is why the topo map feels
 * fine by comparison.)
 *
 * A service worker is not bound by that: once a tile is in ITS cache we
 * serve it without asking. That already happens for tiles you have
 * panned over. This module is for taking the next step deliberately -
 * working out every tile along a route so the whole corridor can be
 * fetched once and then used with no network at all.
 *
 * The tiles are keyed by AIRAC cycle in the worker, so a download
 * survives an app release and is discarded when the chart edition
 * changes. A downloaded chart from a superseded cycle would be worse
 * than no download.
 *
 * Pure: no DOM, no fetch, no Cache API. The page does the fetching.
 */

/** Slippy-tile X for a longitude. @param {number} lon @param {number} z @returns {number} */
export function lonToTileX(lon, z) {
  return Math.floor((lon + 180) / 360 * Math.pow(2, z));
}

/** Slippy-tile Y for a latitude. @param {number} lat @param {number} z @returns {number} */
export function latToTileY(lat, z) {
  const r = lat * Math.PI / 180;
  return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z));
}

/**
 * Bounding box of every plotted point on every flight, including via
 * points, grown by a margin so the corridor is usable rather than a
 * hairline along the track.
 *
 * @param {Flight[]} flights
 * @param {number} [marginDeg] degrees of latitude to add on each side
 * @returns {{north: number, south: number, west: number, east: number}|null}
 */
export function routeBounds(flights, marginDeg) {
  const m = typeof marginDeg === 'number' ? marginDeg : 0.25;
  let n = -Infinity, s = Infinity, w = Infinity, e = -Infinity, any = false;
  for (const fl of flights || []) {
    for (const wp of fl.waypoints || []) {
      /** @type {Array<{lat: number, lng: number}>} */
      const pts = [{ lat: wp.lat, lng: wp.lng }].concat(wp.via || []);
      for (const p of pts) {
        if (!isFinite(p.lat) || !isFinite(p.lng)) continue;
        any = true;
        n = Math.max(n, p.lat); s = Math.min(s, p.lat);
        w = Math.min(w, p.lng); e = Math.max(e, p.lng);
      }
    }
  }
  if (!any) return null;
  // A degree of longitude is much shorter than a degree of latitude this
  // far north, so widen it by the same GROUND distance rather than the
  // same number of degrees.
  const lonScale = Math.max(0.2, Math.cos((n + s) / 2 * Math.PI / 180));
  return {
    north: Math.min(85, n + m), south: Math.max(-85, s - m),
    west: w - m / lonScale, east: e + m / lonScale
  };
}

/**
 * Every tile covering a bounding box across a zoom range.
 *
 * @param {{north: number, south: number, west: number, east: number}} b
 * @param {number} minZoom
 * @param {number} maxZoom
 * @param {number} [cap] stop after this many tiles, so a careless bounding
 *        box cannot generate a runaway list
 * @returns {{tiles: Array<{z: number, x: number, y: number}>, capped: boolean}}
 */
export function tilesForBounds(b, minZoom, maxZoom, cap) {
  const limit = typeof cap === 'number' ? cap : 4000;
  /** @type {Array<{z: number, x: number, y: number}>} */
  const tiles = [];
  let capped = false;
  for (let z = minZoom; z <= maxZoom; z++) {
    const x0 = lonToTileX(b.west, z), x1 = lonToTileX(b.east, z);
    const y0 = latToTileY(b.north, z), y1 = latToTileY(b.south, z);
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
        if (tiles.length >= limit) { capped = true; return { tiles, capped }; }
        tiles.push({ z, x, y });
      }
    }
  }
  return { tiles, capped };
}

/**
 * Rough download size.
 *
 * MEASURED, not assumed: a 1024x1024 png24 chart tile is about 1078 kB,
 * and the bytes scale with the pixel count, so a tile's size is estimated
 * from the raster size the request actually asks for. It is an estimate -
 * a tile over open sea compresses far better than one over Tromso - so
 * the UI presents it as approximate.
 *
 * @param {Array<{z: number, x: number, y: number}>} tiles
 * @param {(z: number, y: number) => number} tilePxFn the build's vfrTilePx
 * @returns {number} bytes
 */
export function estimateBytes(tiles, tilePxFn) {
  const BYTES_AT_1024 = 1078 * 1024;
  let total = 0;
  for (const t of tiles) {
    const px = tilePxFn(t.z, t.y);
    total += BYTES_AT_1024 * (px * px) / (1024 * 1024);
  }
  return Math.round(total);
}

/**
 * NOTE, so nobody adds this back: there was a paddedCostBytes() and a
 * tilesThatFit() here, to predict how much browser storage a download
 * would need and refuse when it would not fit.
 *
 * The prediction is not obtainable. Avinor sends no CORS header, so a tile
 * is an opaque response, and browsers RANDOMISE the padding they charge
 * for opaque entries precisely so a page cannot measure them - on top of
 * updating navigator.storage.estimate() asynchronously. Six consecutive
 * probes of the same single-tile store measured 0.38, 9.15, 0.38, 5.69,
 * 10.15 and 4.78 MB. A figure that swings 27x is worse than no figure, and
 * refusing a download on the strength of it is worse still: it showed the
 * pilot "5000 MB" and then "23000 MB" for the same unchanged route.
 *
 * What the page does instead: quote the DOWNLOAD size, which is known;
 * say plainly that browser storage costs far more for reasons outside our
 * control; attempt it; then count what is actually in the cache afterwards
 * and report THAT. Measure the outcome, do not predict it.
 */

/** "45 MB" / "820 kB". @param {number} bytes @returns {string} */
export function formatBytes(bytes) {
  if (!isFinite(bytes) || bytes <= 0) return '0 kB';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' kB';
  const mb = bytes / (1024 * 1024);
  return (mb < 10 ? mb.toFixed(1) : Math.round(mb)) + ' MB';
}
