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

import { escapeText } from './format.js';
import { calcDistanceNM, calcTrueTrack } from './geodesy.js';

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
  const hits = scored.slice(0, limit).map((s) => s.a);
  // HOW FAR AND WHICH WAY, FOR THE FEW THAT ARE SHOWN (QoL 9). The ordering
  // above uses roughNM, which is a local-scale approximation and must never be
  // READ - so the figures offered to the pilot are computed properly, on the
  // WGS-84 geodesic, exactly like every other distance in this planner. It is
  // at most `limit` calls, so the exactness is free.
  //
  // THE BEARING IS TRUE AND SAYS SO. A magnetic one would need a variation at
  // the map centre, and this is a hint for telling two BREIVIKAs apart, not a
  // heading to fly - labelling a true bearing as magnetic is exactly the
  // plausible wrong answer this project refuses.
  if (near) {
    return hits.map((a) => Object.assign({}, a, {
      fromNM: calcDistanceNM(near[0], near[1], a.lat, a.lng),
      fromTrueBrg: calcTrueTrack(near[0], near[1], a.lat, a.lng)
    }));
  }
  return hits;
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
 * HOW A FIX IS DRAWN, and why it is a setting rather than a constant.
 *
 * The first version drew reporting points in the same muted green as the TIZ
 * boundaries, which is exactly wrong for a symbol you are hunting for on a
 * dense chart: the overlay should be quiet, but the thing you are trying to
 * CLICK should not be. Rather than pick a second colour and be wrong again,
 * the symbol is a preference - Map settings.
 *
 * The default reporting-point colour is ORANGE for that reason: nothing on
 * either base chart or in the airspace palette is orange except the mandatory
 * zones, so it cannot be mistaken for published chart ink.
 */
export const FIX_SHAPES = ['triangle', 'circle', 'square', 'diamond'];
export const FIX_STYLES = ['filled', 'outline'];

/** @type {{adColor: string, rpColor: string, adShape: string, rpShape: string,
 *          style: string, size: number, labels: boolean}} */
export const DEFAULT_FIX_STYLE = {
  adColor: '#2b6cb0',   // the same blue the CTR boundaries use: an aerodrome IS its CTR
  rpColor: '#dd6b20',   // orange - see above
  adShape: 'square',
  rpShape: 'triangle',  // the symbol the VAC itself uses for a reporting point
  style: 'filled',
  size: 10,
  labels: true
};

/** Symbols smaller than this are not reliable click targets; larger than this
 *  they cover the chart they are supposed to sit on. Both ends measured
 *  against a real 1:500 000 raster at reading zoom. */
export const FIX_SIZE_MIN = 6;
export const FIX_SIZE_MAX = 18;

/**
 * Is this a colour we are willing to put in markup?
 *
 * NOT fussiness. The colour is interpolated into the SVG that becomes a
 * marker's innerHTML, so an unvalidated string is an HTML-injection vector -
 * and this value travels through export/import, which means it can arrive
 * from a route file someone else wrote. Six hex digits with a leading hash,
 * or it is not used.
 *
 * @param {unknown} v @returns {boolean}
 */
export function isHexColor(v) {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
}

/**
 * The fix style a profile asks for, with every field checked.
 *
 * Anything missing, malformed or out of range falls back to the default rather
 * than being trusted: this object is rebuilt from localStorage and from
 * imported route files on every load, and a broken value must degrade to a
 * visible symbol, never to an invisible one or to injected markup.
 *
 * @param {Record<string, any>|null|undefined} profile
 * @returns {{adColor: string, rpColor: string, adShape: string, rpShape: string,
 *            style: string, size: number, labels: boolean}}
 */
export function normaliseFixStyle(profile) {
  const p = profile || {};
  const shape = (/** @type {unknown} */ v, /** @type {string} */ dflt) =>
    typeof v === 'string' && FIX_SHAPES.includes(v) ? v : dflt;
  const n = Number(p.fixSize);
  return {
    adColor: isHexColor(p.fixAdColor) ? String(p.fixAdColor).toLowerCase() : DEFAULT_FIX_STYLE.adColor,
    rpColor: isHexColor(p.fixRpColor) ? String(p.fixRpColor).toLowerCase() : DEFAULT_FIX_STYLE.rpColor,
    adShape: shape(p.fixAdShape, DEFAULT_FIX_STYLE.adShape),
    rpShape: shape(p.fixRpShape, DEFAULT_FIX_STYLE.rpShape),
    style: typeof p.fixStyle === 'string' && FIX_STYLES.includes(p.fixStyle)
      ? p.fixStyle : DEFAULT_FIX_STYLE.style,
    size: isFinite(n) ? Math.min(FIX_SIZE_MAX, Math.max(FIX_SIZE_MIN, Math.round(n))) : DEFAULT_FIX_STYLE.size,
    // Only an explicit false hides the labels; an absent key means default on.
    labels: p.fixLabels === undefined || p.fixLabels === null ? DEFAULT_FIX_STYLE.labels : p.fixLabels !== false
  };
}

/** The shape itself, in a 100x100 box so one path serves every size.
 *  @type {Record<string, string>} */
const SHAPE_GEOMETRY = {
  triangle: '<polygon points="50,10 92,86 8,86"/>',
  circle: '<circle cx="50" cy="50" r="40"/>',
  square: '<rect x="12" y="12" width="76" height="76" rx="10"/>',
  diamond: '<polygon points="50,7 93,50 50,93 7,50"/>'
};

/**
 * The marker symbol, as inline SVG.
 *
 * WHY SVG AND NOT CSS. The first version drew the aerodrome as a bordered
 * div and the reporting point as a CSS border-triangle. That triangle has a
 * ZERO-SIZED box by construction - it is drawn entirely from borders - so it
 * could not be measured, could not be resized from one number, and forced the
 * browser verifier to special-case it. An `<svg>` has a real box at any size
 * and one attribute swaps the shape.
 *
 * THE HALO IS `paint-order="stroke"`, not a second element: it draws the white
 * stroke UNDER the fill, so the symbol keeps its full colour area and still
 * reads over dark terrain and over white sea. A halo drawn as a border around
 * a 2 px shape leaves almost no colour once antialiased - the same mistake the
 * v16.28 TOC/TOD ticks made before they moved to a box-shadow.
 *
 * @param {string} shape one of FIX_SHAPES
 * @param {string} color a validated hex colour
 * @param {number} size px
 * @param {string} [style] 'filled' (default) or 'outline'
 * @returns {string} SVG markup
 */
export function fixSymbolSvg(shape, color, size, style) {
  const geom = SHAPE_GEOMETRY[FIX_SHAPES.includes(shape) ? shape : DEFAULT_FIX_STYLE.rpShape];
  const col = isHexColor(color) ? color : DEFAULT_FIX_STYLE.rpColor;
  const px = Math.min(FIX_SIZE_MAX, Math.max(FIX_SIZE_MIN, Math.round(Number(size) || DEFAULT_FIX_STYLE.size)));
  const outline = style === 'outline';
  // Stroke widths are in the 100-unit space, so they scale with the symbol
  // instead of vanishing at 6 px and swamping it at 18.
  const paint = outline
    ? `fill="none" stroke="${col}" stroke-width="16"`
    : `fill="${col}" stroke="#ffffff" stroke-width="14" paint-order="stroke"`;
  return `<svg class="fix-svg" width="${px}" height="${px}" viewBox="0 0 100 100" ` +
    `aria-hidden="true" focusable="false"><g ${paint} stroke-linejoin="round">${geom}</g>` +
    (outline ? `<g fill="none" stroke="#ffffff" stroke-width="5" stroke-linejoin="round">${geom}</g>` : '') +
    `</svg>`;
}

/**
 * The whole marker: symbol plus an optional label, and the sizes Leaflet needs.
 *
 * The label offset SCALES with the symbol - it was hardcoded at 12 px for a
 * 9 px square, so at 18 px the text sat on top of the shape.
 *
 * @param {Anchor} a @param {ReturnType<typeof normaliseFixStyle>} st
 * @returns {{html: string, size: number, anchor: number}}
 */
export function fixMarkerHtml(a, st) {
  const isAd = a.kind === 'AD';
  const svg = fixSymbolSvg(isAd ? st.adShape : st.rpShape,
    isAd ? st.adColor : st.rpColor, st.size, st.style);
  const label = st.labels
    ? `<span class="fix-label ${isAd ? 'ad' : 'rp'}" style="left:${st.size + 3}px;` +
      `top:${Math.round(st.size / 2) - 6}px;">${escapeText(a.label)}</span>`
    : '';
  return { html: svg + label, size: st.size, anchor: st.size / 2 };
}

/** Fix names are published data, not user input, but they land in innerHTML
 *  and one of them could gain an ampersand in a future edition. The escaper
 *  itself lives in format.js - one helper for the whole app (v16.47) - and is
 *  re-exported here so existing callers keep the name they know. */
export { escapeText };

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

// ---------------------------------------------------------------------------
// CIRCUIT (PATTERN) ALTITUDE
// ---------------------------------------------------------------------------

/** The convention a circuit altitude is derived from when nothing is published
 *  to us: 1000 ft above the field. */
export const PATTERN_AGL_FT = 1000;

/** How near an aerodrome a circuit stop has to be for that aerodrome to be the
 *  one it is flown at. NOT a picked number: the two closest aerodromes in the
 *  dataset are ENGM and ENKJ at 14.07 NM apart, so anything under ~7 NM cannot
 *  resolve to the wrong field, and a VFR circuit is flown within ~3 NM of the
 *  runway. Beyond this the circuit is not at a known aerodrome and NO altitude
 *  is derived - the caller keeps whatever it had rather than inventing one. */
export const PATTERN_AD_MAX_NM = 5;

/** Circuit altitudes we have been TOLD, which override the derived figure.
 *  ENDU is the user's home field and the flight school flies its circuit at
 *  1500 ft, not the 1300 ft the convention would give. This is a table on
 *  purpose: the eAIP does not hand us circuit altitudes, so anything in here
 *  arrives from a person who knows the field, and the VAC remains the
 *  authority. Keys are ICAO codes.
 *  @type {Record<string, number>} */
export const KNOWN_PATTERN_ALT_FT = { ENDU: 1500 };

/**
 * The circuit altitude for an aerodrome, in feet AMSL.
 *
 * The field elevation is rounded to the nearest 100 ft BEFORE the 1000 ft is
 * added, so the result is a whole hundred a pilot can fly and write down -
 * ENTC's 31 ft gives 1000 ft, ENDU's 254 ft would give 1300 ft. Rounding the
 * SUM instead would differ only on a half-hundred and reads less like the
 * arithmetic a pilot does in their head.
 *
 * This is a DERIVED DEFAULT, not a published value: the eAIP gives us the
 * elevation, never the circuit altitude. It is editable in the OFP row and the
 * guide says the VAC is what to check.
 *
 * @param {{icao?: string|null, elevFt?: number|null}|null} ad
 * @returns {number|null} null when the field elevation is unknown
 */
export function patternAltitude(ad) {
  if (!ad) return null;
  const known = ad.icao ? KNOWN_PATTERN_ALT_FT[String(ad.icao).toUpperCase()] : undefined;
  if (typeof known === 'number') return known;
  if (typeof ad.elevFt !== 'number' || !isFinite(ad.elevFt)) return null;
  return Math.round(ad.elevFt / 100) * 100 + PATTERN_AGL_FT;
}

/**
 * The circuit altitude for a point, resolved to the aerodrome it is at.
 *
 * @param {number} lat @param {number} lng
 * @param {Anchor[]} anchors
 * @returns {{alt: number, icao: string|null, name: string, elevFt: number|null,
 *            known: boolean, distNM: number}|null} null when no aerodrome is near
 */
export function patternAltitudeAt(lat, lng, anchors) {
  if (!isFinite(lat) || !isFinite(lng) || !Array.isArray(anchors)) return null;
  let best = null, bestD = Infinity;
  for (const a of anchors) {
    if (a.kind !== 'AD') continue;
    const d = roughNM([lat, lng], [a.lat, a.lng]);
    if (d < bestD) { bestD = d; best = a; }
  }
  if (!best || bestD > PATTERN_AD_MAX_NM) return null;
  const alt = patternAltitude(best);
  if (alt === null) return null;
  return { alt, icao: best.icao || null, name: best.name,
           elevFt: typeof best.elevFt === 'number' ? best.elevFt : null,
           known: !!(best.icao && KNOWN_PATTERN_ALT_FT[String(best.icao).toUpperCase()]),
           distNM: bestD };
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
