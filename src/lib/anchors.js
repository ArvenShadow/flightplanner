/**
 * AIP anchors - aerodromes and VFR reporting points - src/lib/anchors.js
 *
 * WHAT THIS IS FOR. Until now every waypoint was a spot the pilot clicked on
 * the map, so a leg to a named reporting point was only ever as accurate as
 * the click. These anchors put a waypoint on the PUBLISHED coordinate of a
 * published fix, with its published name - which is the whole point, and the
 * reason nothing here rounds, snaps or interpolates anything.
 *
 * DATA: `window.C182_AIP.aerodromes`, built by tools/build-vac.mjs from the
 * official Avinor eAIP - the aerodrome ARP, elevation and variation from the
 * tagged AD 2 fields, the reporting points from the VAC's printed coordinate
 * table. Used with permission from Avinor AS, NON-COMMERCIALLY (see CLAUDE.md;
 * the condition binds the whole project).
 *
 * WHAT IS NOT HERE, and it is reported rather than filled in: 24 aerodromes
 * publish their reporting points GRAPHICALLY ONLY - there is no coordinate
 * table on those VACs to read - and 7 have no VAC at all. Those aerodromes
 * still anchor (the ARP is a tagged field on every AD 2 page); they simply
 * have no points. Reading coordinates off a chart image is exactly the
 * plausible-wrong-answer this project refuses.
 *
 * Pure: no DOM, no Leaflet. The page draws; this decides what and says what.
 */

/**
 * Zoom thresholds, and why they differ.
 *
 * There are 53 aerodromes and 243 reporting points. At country zoom the points
 * are an unreadable spatter that hides the aerodromes, so they appear later.
 * Aerodromes are few enough to be useful as soon as the airspace is.
 */
export const AERODROME_MIN_ZOOM = 7;
export const REPORTING_POINT_MIN_ZOOM = 9;

/**
 * Fold a name for searching, so the keyboard does not have to produce Æ Ø Å.
 *
 * A pilot types "SORKJOSEN" or "SØRKJOSEN"; both must find SØRKJOSEN. The
 * folding is one-way onto ASCII and applied to BOTH sides of the comparison,
 * so it can only ever widen what matches - it never renames anything. The
 * published name is what gets stored on the waypoint.
 *
 * @param {string} s @returns {string}
 */
export function foldName(s) {
  return String(s || '').toUpperCase()
    .replace(/Æ/g, 'AE').replace(/Ø/g, 'O').replace(/Å/g, 'A')
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * @typedef {Object} Anchor
 * @property {'AD'|'RP'} kind        aerodrome, or reporting point
 * @property {string} name           the PUBLISHED name
 * @property {string} icao           the aerodrome, or the point's aerodrome
 * @property {number} lat
 * @property {number} lng
 * @property {string} label          what to draw on the map
 * @property {string} detail         one line for the picker and the tooltip
 * @property {number|null} elevFt    aerodrome elevation; null for a point
 * @property {string|null} published the printed DMS, where there is one
 * @property {string[]} folds        every spelling this anchor answers to,
 *                                   folded. An aerodrome answers to its ICAO
 *                                   AND its name: a pilot planning out of
 *                                   Sorkjosen types "SORKJOSEN" as readily as
 *                                   "ENSR", and only one of those is the
 *                                   published designator.
 */

/**
 * Flatten the dataset into one searchable, drawable list.
 *
 * An aerodrome is an anchor in its own right (the ARP), and every reporting
 * point is one. A waypoint named for the aerodrome gets its ICAO, because that
 * is what goes on the OFP and what the METAR/TAF card looks for.
 *
 * @param {{aerodromes?: any[]}|null} dataset
 * @returns {Anchor[]}
 */
export function buildAnchors(dataset) {
  /** @type {Anchor[]} */
  const out = [];
  for (const a of (dataset && dataset.aerodromes) || []) {
    if (typeof a.lat === 'number' && typeof a.lng === 'number') {
      out.push({
        kind: 'AD', name: a.icao, icao: a.icao, lat: a.lat, lng: a.lng,
        label: a.icao,
        detail: a.name + (a.elevFt !== null && a.elevFt !== undefined ? ` · ${a.elevFt} ft` : '') +
          (a.situation ? ` · ${a.situation}` : ''),
        elevFt: typeof a.elevFt === 'number' ? a.elevFt : null,
        published: a.rawLat && a.rawLng ? `${a.rawLat} ${a.rawLng}` : null,
        folds: [...new Set([foldName(a.icao), foldName(a.city), foldName(a.name)].filter(Boolean))]
      });
    }
    for (const p of a.points || []) {
      out.push({
        kind: 'RP', name: p.name, icao: a.icao, lat: p.lat, lng: p.lng,
        label: p.name,
        detail: `Reporting point · ${a.icao} ${a.name}`,
        elevFt: null,
        published: p.published || null,
        folds: [foldName(p.name)]
      });
    }
  }
  return out;
}

/**
 * Rank anchors against what the pilot typed.
 *
 * The order is deliberate and it is about what a four-letter query means: an
 * ICAO code typed in full is almost certainly the aerodrome, so an exact
 * aerodrome match wins outright. After that, a name that STARTS with the query
 * beats one that merely contains it - "STOR" should offer STORSLETT before
 * OKSFJORDHAMN's neighbours - and aerodromes come before points at equal
 * strength because there are far fewer of them and they are what a route
 * usually begins and ends with.
 *
 * @param {Anchor[]} anchors
 * @param {string} query
 * @param {{limit?: number, near?: [number, number]|null}} [opts]
 * @returns {Anchor[]}
 */
export function searchAnchors(anchors, query, opts) {
  const q = foldName(query);
  if (!q) return [];
  const limit = (opts && opts.limit) || 9;
  const near = (opts && opts.near) || null;
  const scored = [];
  for (const a of anchors || []) {
    // An aerodrome answers to several spellings; the STRONGEST match among
    // them is the one that ranks it, so "ENSR" and "SORKJOSEN" are equally
    // direct hits rather than one of them being a weak substring match.
    let rank = Infinity;
    for (const f of a.folds) {
      if (f === q) rank = Math.min(rank, a.kind === 'AD' ? 0 : 1);
      else if (f.startsWith(q)) rank = Math.min(rank, a.kind === 'AD' ? 2 : 3);
      else if (f.includes(q)) rank = Math.min(rank, a.kind === 'AD' ? 4 : 5);
    }
    if (!isFinite(rank)) continue;
    // Within a rank, nearer the map centre first: a pilot planning out of
    // Tromso who types "BREIVIKA" wants the one up the road.
    const d = near ? roughNM(near, [a.lat, a.lng]) : 0;
    scored.push({ a, rank, d });
  }
  scored.sort((x, y) => x.rank - y.rank || x.d - y.d || x.a.name.localeCompare(y.a.name, 'nb'));
  return scored.slice(0, limit).map((s) => s.a);
}

/** Local-scale distance in NM. Used only for ORDERING search hits and for
 *  culling; every distance a pilot reads comes from geodesy.js.
 *  @param {[number, number]} a @param {[number, number]} b @returns {number} */
export function roughNM(a, b) {
  const kx = Math.cos((a[0] + b[0]) / 2 * Math.PI / 180) * 60.04;
  return Math.hypot((a[0] - b[0]) * 60.04, (a[1] - b[1]) * kx);
}

/**
 * Which anchors to draw for a viewport, and at what zoom.
 *
 * Same reasoning as the airspace overlay: hand Leaflet 296 markers at country
 * zoom and panning is unusable, and the result buries what matters anyway.
 *
 * @param {Anchor[]} anchors
 * @param {{south: number, west: number, north: number, east: number}} view
 * @param {number} zoom
 * @returns {Anchor[]}
 */
export function visibleAnchors(anchors, view, zoom) {
  if (!view) return [];
  const ad = zoom >= AERODROME_MIN_ZOOM, rp = zoom >= REPORTING_POINT_MIN_ZOOM;
  if (!ad && !rp) return [];
  return (anchors || []).filter((a) => {
    if (a.kind === 'AD' ? !ad : !rp) return false;
    return a.lat >= view.south && a.lat <= view.north && a.lng >= view.west && a.lng <= view.east;
  });
}

/**
 * The waypoint an anchor becomes.
 *
 * The coordinate is the PUBLISHED one, unrounded - that is the entire reason
 * this feature exists. An aerodrome also carries its published elevation,
 * which is the altitude the first and last waypoint of a flight should have;
 * a reporting point publishes no elevation and so is given the caller's
 * default rather than an invented one.
 *
 * @param {Anchor} a
 * @param {{alt?: number, oat?: number, wdir?: number, wspd?: number}} defaults
 * @returns {{lat: number, lng: number, name: string, alt: number, oat: number,
 *            wdir: number, wspd: number, anchor: string}}
 */
export function anchorWaypoint(a, defaults) {
  const d = defaults || {};
  return {
    lat: a.lat, lng: a.lng, name: a.name,
    alt: a.kind === 'AD' && typeof a.elevFt === 'number' ? a.elevFt : Number(d.alt || 0),
    oat: Number(d.oat || 0), wdir: Number(d.wdir || 0), wspd: Number(d.wspd || 0),
    // Stamped so the row can say the coordinate came from the AIP and not
    // from a click. Never a person, a machine or a place beyond the fix name.
    anchor: a.kind === 'AD' ? 'AIP-AD' : 'AIP-RP'
  };
}

/**
 * The attribution the anchor layer must show whenever it is on.
 *
 * One grant only - this is Avinor's, by permission and non-commercially.
 * Kartverket is not involved in the reporting points, and saying so keeps the
 * three licences in this project from being conflated.
 *
 * @param {{aerodromeSource?: {editionLabel?: string, effectiveFrom?: string,
 *          points?: number, aerodromesWithPoints?: number}|null}|null} dataset
 * @returns {string}
 */
export function anchorAttribution(dataset) {
  const s = dataset && dataset.aerodromeSource;
  if (!s) return '';
  const ed = s.editionLabel ? ` ${s.editionLabel}` : '';
  const eff = s.effectiveFrom ? `, effective ${s.effectiveFrom}` : '';
  return `Fixes: AIP Norge${ed}${eff} — © Avinor, used with permission, non-commercial. ` +
    `${s.points} reporting points at ${s.aerodromesWithPoints} aerodromes, read from the ` +
    `published VAC tables. Not for navigation; verify against the current AIP and NOTAM.`;
}

/**
 * What the layer cannot offer, in the pilot's words rather than the parser's.
 *
 * Said out loud because an ABSENCE is the dangerous kind of gap: an aerodrome
 * with no points looks identical to an aerodrome whose points failed to load,
 * and a pilot who assumes the second will go looking for a fix that is on
 * their chart but not in this tool.
 *
 * @param {{aerodromes?: any[]}|null} dataset
 * @returns {{withPoints: number, withoutPoints: number, total: number, points: number}}
 */
export function anchorCoverage(dataset) {
  const ads = (dataset && dataset.aerodromes) || [];
  const withPoints = ads.filter((a) => (a.points || []).length).length;
  return {
    total: ads.length,
    withPoints,
    withoutPoints: ads.length - withPoints,
    points: ads.reduce((n, a) => n + (a.points || []).length, 0)
  };
}
