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
 * @property {string} [city]         the town, published
 * @property {string} [civil]        the name it is CALLED, from its ATS callsign
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
        // The town, carried through so a FLY-BY can be named after the place
        // rather than the ICAO code (v16.54). Without it civilName() fell back
        // to `name` - which for an aerodrome anchor IS the code - and a fly-by
        // over Tromsø would have been called "Entc".
        city: a.city || a.name || '',
        // The name the aerodrome is CALLED, resolved once here from its
        // published ATS callsign (v16.55). This is what a fly-by is named.
        civil: aerodromeCallName(a.icao, dataset) || publishedFieldName(a) || '',
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
 * THE ROUTE LINE'S THICKNESS (v16.50, the pilot's request).
 *
 * It lives here for the same reason the fix style does: it is a map-display
 * preference that travels in PROFILE_KEYS, so it can arrive from a route file
 * somebody else wrote and MUST be validated on the way in. It reaches Leaflet
 * as a number rather than markup, so the risk is a NaN or an absurd value
 * rather than injection - but "validate every door into the profile" is the
 * rule regardless (v16.35).
 *
 * THE BOUNDS ARE ARGUED, NOT PICKED. Below 2 px the track is hard to follow
 * across chart ink at reading zoom; above 10 px it covers the chart detail it
 * is drawn over - the frequencies, MEF and airspace limits that are the whole
 * point of the VFR raster - which is the same argument that caps the fix
 * symbol at 18 px. 4 px is what the planner has always drawn.
 *
 * The invisible grab line is NOT this number: it stays a generous 20 px, so a
 * thin track is no harder to grab than a thick one (v16.27).
 */
export const ROUTE_WEIGHT_MIN = 2;
export const ROUTE_WEIGHT_MAX = 10;
export const ROUTE_WEIGHT_DEFAULT = 4;

/**
 * WHAT HAPPENS AT AN AERODROME (v16.54, roadmap item 17).
 *
 * Clicking a published aerodrome offers three things, because they mean three
 * different things to the plan:
 *
 *  - TOUCH & GO   the aircraft never stops. It costs circuit time and then
 *                 climbs out again, so the next sector departs from the FIELD
 *                 ELEVATION. Optionally followed by circuits (the existing
 *                 PATTERN mechanism, unchanged).
 *  - FULL STOP    the aircraft is on the ground. It costs ground time AND a
 *                 fresh start-up and taxi, which is why taxi fuel is charged
 *                 per full stop rather than once per mission - the author
 *                 settled that in AUDIT.md.
 *  - FLY-BY       nothing happens at all. It is an ordinary waypoint that
 *                 happens to be over an aerodrome, named after the place.
 *
 * THE DEFAULT MINUTES ARE THE PILOT'S FIGURES, not measured ones - 5 for a
 * touch and go, 10 for a full stop - and both are editable per stop, because
 * how long a turnaround takes is a fact about the day, not about the aircraft.
 */
export const STOP_KINDS = ['touch-go', 'full-stop'];
/** @type {Record<string, number>} */
export const STOP_DEFAULT_MIN = { 'touch-go': 5, 'full-stop': 10 };
/** Nobody turns a C182 round in under a minute, and a stop longer than a
 *  working day is a typo rather than a plan. */
export const STOP_MIN_MINUTES = 1;
export const STOP_MAX_MINUTES = 600;

/**
 * REFUELLING AT A FULL STOP (v16.57, the pilot's request).
 *
 * A full stop is where fuel goes in, so the fuel on board for the next sector
 * can be set outright rather than carried over. Stored in GALLONS like every
 * other fuel figure in this project - the POH's unit - and converted only for
 * display, so a pilot switching to litres cannot silently reinterpret a number
 * already written into a saved route.
 *
 * A TOUCH & GO CANNOT REFUEL and the field is not offered there: the engine
 * never stops and the aircraft never leaves the runway. That is a real
 * constraint, not a UI simplification.
 *
 * THE CAP IS A TYPO GUARD, NOT A TANK LIMIT, and the difference matters. This
 * planner holds no published usable-fuel figure for the aircraft - the profile
 * carries rates and a taxi burn, never a capacity - so it cannot tell 87
 * gallons from 90. 1000 gal is roughly eleven times a C182's full tanks: it
 * cannot reject a real figure, and it still catches a slipped decimal point or
 * a corrupted file. The pilot is the authority on what fits in the tanks, and
 * the field says so.
 */
export const REFUEL_MAX_GAL = 1000;

/** Fuel on board after a stop, in gallons. null means "carry on with what is
 *  left", which is what every plan did before this existed.
 *  @param {any} v @returns {number|null} */
export function normaliseRefuelGal(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!isFinite(n) || n < 0) return null;
  return Math.min(REFUEL_MAX_GAL, Math.round(n * 10) / 10);
}

/** @param {any} kind @returns {string|null} */
export function normaliseStopKind(kind) {
  return typeof kind === 'string' && STOP_KINDS.includes(kind) ? kind : null;
}

/** Minutes for a stop, validated. Absent means the kind's default.
 *  @param {any} kind @param {any} min @returns {number|null} */
export function normaliseStopMinutes(kind, min) {
  const k = normaliseStopKind(kind);
  if (!k) return null;
  const n = Number(min);
  if (!isFinite(n)) return STOP_DEFAULT_MIN[k];
  return Math.min(STOP_MAX_MINUTES, Math.max(STOP_MIN_MINUTES, Math.round(n)));
}

/**
 * THE NAME A PILOT SAYS IS THE ATS CALLSIGN (v16.55, the pilot's correction).
 *
 * v16.54 used the AIP's `city` field and was wrong about a third of the time -
 * ENEV came out "Harstad/Narvik" where the chart and the radio say EVENES. The
 * pilot asked whether the information exists anywhere. It does, and we already
 * ship it: every aerodrome's own station is published with a CALLSIGN in the
 * airspace data ("Evenes Tower", "Skagen Information", "Helle Information"),
 * and the place part of that callsign IS the name.
 *
 * MEASURED over the edition: 49 of 53 aerodromes publish a station of their own,
 * and 22 of those give a name the `city` field does not - Vigra, Flesland,
 * Kjevik, Gardermoen, Banak, Værnes, Sola, Torp, Skagen, Helle, Evenes...
 *
 * THE OTHER CANDIDATE WAS TRIED AND IS WORSE. `name` carries the aerodrome
 * after a " / " ("TROMSØ / Langnes"), which agrees with the callsign on 40 of
 * the 49 - but where they differ the callsign is the one flown: Tromsø not
 * Langnes, Kirkenes not Høybuktmoen, Molde not Årø, Vardø not Svartnes. It is
 * used only as the fallback for the 4 uncontrolled fields with no station at
 * all (Eggemoen, Gullknapp, Kjeller, Rena), where it IS the name pilots use.
 *
 * ONLY THE AERODROME'S OWN STATION COUNTS - tower, AFIS, or the ATIS. An
 * approach service can be an area control centre ("Polaris Control" answers for
 * Skagen's TIZ), and taking that would name half of Norway "Polaris".
 */
const ATS_SERVICE_WORD =
  /\s+(Tower|Information|Ground|Delivery|Approach|Radar|Control|Director|Apron|Traffic)\b.*$/i;

/** The place part of a published callsign: "Evenes Tower" -> "Evenes".
 *  @param {any} callsign @returns {string} */
export function callsignPlace(callsign) {
  const raw = String(callsign || '').trim();
  if (!raw) return '';
  const place = raw.replace(ATS_SERVICE_WORD, '').trim();
  // A callsign that is NOTHING but a service word names no place; better to
  // say so and let the caller fall back than to return an empty waypoint name.
  return place === raw && ATS_SERVICE_WORD.test(' ' + raw) ? '' : place;
}

/** The stations an aerodrome answers on itself, in the order we trust them. */
const OWN_STATION_CODES = ['TWR', 'AFIS', 'ATIS'];

/** @param {string} icao @param {any} dataset @returns {string} */
export function aerodromeCallName(icao, dataset) {
  if (!icao || !dataset || !Array.isArray(dataset.features)) return '';
  for (const code of OWN_STATION_CODES) {
    for (const f of dataset.features) {
      if (f.icao !== icao) continue;
      for (const sv of f.services || []) {
        if ((sv.code || '') !== code) continue;
        const place = callsignPlace(sv.callsign);
        if (place) return place;
      }
    }
  }
  return '';
}

/** The published aerodrome name where the AIP gives one after a " / ", e.g.
 *  "HØNEFOSS / Eggemoen" -> "Eggemoen". Only used where no station is
 *  published; see aerodromeCallName for why the callsign wins where both exist.
 *  @param {any} ad @returns {string} */
export function publishedFieldName(ad) {
  const m = / \/ (.+)$/.exec(String((ad && ad.name) || ''));
  return m ? m[1].trim() : '';
}

/**
 * The civil name of an aerodrome, for a fly-by waypoint.
 *
 * THE AIP PUBLISHES TWO NAMES AND NEITHER IS ALWAYS THE ONE PILOTS SAY.
 * `city` is the town (TROMSØ, HARSTAD/NARVIK); `name` adds the aerodrome after
 * a " / " on 35 of the 53 (TROMSØ / Langnes, HARSTAD/NARVIK / Evenes). A pilot
 * says "Tromsø" for the first and "Evenes" for the second, so no single field
 * reproduces both - which is exactly the kind of gap this project refuses to
 * paper over with a guess.
 *
 * So this returns the published CITY, title-cased: it is a real published
 * value, it is the shorter of the two, and it is the town the point is over.
 * The dialog SHOWS the name before the pilot commits, and a waypoint is
 * renameable in one right-click, so nothing here is a trap.
 *
 * @param {any} ad an aerodrome record or anchor
 * @param {any} [dataset] the AIP dataset, when `ad` has no resolved name yet
 * @returns {string}
 */
export function civilName(ad, dataset) {
  if (!ad) return '';
  // 1. the callsign the aerodrome answers on - already resolved onto the anchor
  //    by buildAnchors, or looked up here when given the dataset.
  const called = ad.civil || (dataset ? aerodromeCallName(ad.icao, dataset) : '');
  if (called) return called;
  // 2. the published aerodrome name, for the fields with no station at all
  const field = publishedFieldName(ad);
  if (field) return field;
  // 3. the town. Nothing is invented: if the AIP publishes no name at all,
  //    neither do we.
  const raw = String((ad.city || ad.name) || '').trim();
  if (!raw) return '';
  // Title-case each word, keeping "/" and "-" as separators: HARSTAD/NARVIK
  // becomes Harstad/Narvik, not Harstad/narvik.
  return raw.toLocaleLowerCase('nb')
    .replace(/(^|[\s/\-])([^\s/\-])/g, (m, sep, ch) => sep + ch.toLocaleUpperCase('nb'));
}

/** @param {any} profile @returns {number} px */
export function normaliseRouteWeight(profile) {
  const n = Number((profile || {}).routeWeight);
  if (!isFinite(n)) return ROUTE_WEIGHT_DEFAULT;
  return Math.min(ROUTE_WEIGHT_MAX, Math.max(ROUTE_WEIGHT_MIN, Math.round(n)));
}

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
 * this feature exists. A reporting point publishes no elevation and so is
 * given the caller's default rather than an invented one.
 *
 * An AERODROME takes its published elevation only when `atField` says the
 * aircraft is on it - departing, or stopping there. Overflying one is an
 * ordinary waypoint at the planned altitude.
 *
 * @param {Anchor} a
 * @param {{alt?: number, oat?: number, wdir?: number, wspd?: number,
 *          atField?: boolean}} defaults
 * @returns {{lat: number, lng: number, name: string, alt: number, oat: number,
 *            wdir: number, wspd: number, anchor: string}}
 */
export function anchorWaypoint(a, defaults) {
  const d = defaults || {};
  return {
    lat: a.lat, lng: a.lng, name: a.name,
    // AN AERODROME IS ONLY AT FIELD ELEVATION WHEN THE AIRCRAFT IS ON IT
    // (v16.56, the pilot's bug report). Departing from it, or stopping there,
    // puts the waypoint on the runway - so the published elevation is exactly
    // the number wanted. FLYING OVER it does not: a fly-by is an ordinary
    // en-route waypoint, and forcing it to ground level planned a descent to
    // the deck and a climb back out over an aerodrome the aircraft never
    // touched. The caller says which, because only the caller knows.
    alt: d.atField && a.kind === 'AD' && typeof a.elevFt === 'number'
      ? a.elevFt : Number(d.alt || 0),
    oat: Number(d.oat || 0), wdir: Number(d.wdir || 0), wspd: Number(d.wspd || 0),
    // Stamped so the row can say the coordinate came from the AIP and not
    // from a click. Never a person, a machine or a place beyond the fix name.
    anchor: a.kind === 'AD' ? 'AIP-AD' : 'AIP-RP'
  };
}

// ---------------------------------------------------------------------------
// CIRCUIT (PATTERN) ALTITUDE
// ---------------------------------------------------------------------------

/**
 * HOW MUCH OF THE WINDOW THE MAP GETS, when the pilot has dragged the divider
 * between the two panels (v16.67).
 *
 * A FRACTION OF THE MAIN AXIS, not a pixel width, so the same number means the
 * same thing when the window is resized - and so Split (a row) and Stacked (a
 * column) can each keep their own without one being expressed in the other's
 * units.
 *
 * THE BOUNDS ARE ARGUED. Below 0.15 the map is a strip too narrow to read a
 * chart in, and the plan panel has more width than its table needs; above 0.85
 * the OFP table is squeezed past the point where its columns fit, which is the
 * one thing `verify:ofp` exists to prevent. Neither end is allowed to reduce a
 * panel to nothing, because a divider you cannot find again is a trap.
 */
export const PANE_MIN = 0.15;
export const PANE_MAX = 0.85;

/** @param {unknown} v @param {number} dflt @returns {number} */
export function normalisePaneRatio(v, dflt) {
  const n = Number(v);
  if (!isFinite(n) || n <= 0) return dflt;
  return Math.min(PANE_MAX, Math.max(PANE_MIN, Math.round(n * 1000) / 1000));
}

/**
 * Where a pointer sits along the panel axis, as the FIRST panel's fraction of
 * the container. Pure, so the whole of the divider's arithmetic is testable
 * without a browser - the browser only has to prove the wiring.
 *
 * IT IS THE FIRST PANEL'S SHARE OF THE WHOLE CONTAINER, THE DIVIDER INCLUDED,
 * and that is what makes the bar land under the cursor. The first attempt made
 * it a share of the space LEFT OVER after the divider and fed it to flex-grow;
 * measured in Chromium, the bar came to rest 11 px left of where it was
 * dragged. Growth factors share out FREE space, so the panels' own borders and
 * padding (2 px of map border, 20 px of sidebar padding) shift the answer, and
 * nothing in the page can see those numbers to correct for them. A share of the
 * container is a length the browser resolves the same way we compute it.
 *
 * Half the divider comes off the position because the bar is CENTRED on the
 * boundary: leave it in and the divider trails the cursor by its own width.
 *
 * @param {number} pos   pointer position along the axis (client coords)
 * @param {number} start container's leading edge along that axis
 * @param {number} span  container's length along that axis
 * @param {number} bar   the divider's thickness along that axis
 * @returns {number|null} null when there is no room to divide
 */
export function paneRatioFromPoint(pos, start, span, bar) {
  if (!isFinite(span) || span <= 0) return null;
  return normalisePaneRatio((pos - start - bar / 2) / span, PANE_MIN);
}

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
