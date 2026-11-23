/**
 * RESHAPING A ROUTE THAT ALREADY EXISTS (v17.19).
 *
 * The author: "I want more flexibility on a pre-planned route, for example be
 * able to make a touch and go/landing instead of a waypoint flying by the
 * airport (splitting the plan into two flight plans)" - and the way back,
 * "the option to remove a touch-n-go and revert to one longer flight plan".
 *
 * Until this existed the only way to put a landing in the middle of a route
 * was to undo everything after it and plan the rest again.
 *
 * PURE: every function takes the `flights` array and returns a NEW one (the
 * touched plans and waypoints are copied, the rest are shared), or `null` when
 * the change is not one that can be made. The page pushes its undo step,
 * assigns the result and redraws - so nothing here can leave a plan half
 * changed, and all of it is tested in bare Node.
 *
 * WHAT THE PAGE'S OWN RULES ALREADY SAY, and these follow rather than restate:
 *  - a stop ENDS its plan; only circuits may follow it (v16.84), and the plan
 *    it opened is the NEXT one, departing from the stop's own coordinates
 *    (`sectorOpenedByStop`, v17.4). Splitting produces exactly that shape, so
 *    the ground time, the taxi fuel and "delete the stop deletes its sector"
 *    all apply to a plan made here as they do to one drawn that way.
 *  - everything about a LEG is stored on the waypoint it ends at (altitude,
 *    wind, via points, the altitude target, the descent rate, the MSA).
 */
import { sectorOpenedByStop } from './exchange.js';
import { normaliseStopKind, normaliseStopMinutes } from './anchors.js';

/** The leg-shaped fields: they describe the leg ENDING at the waypoint, so they
 *  stop being true the moment that leg runs between two different places. */
const LEG_FIELDS = ['via', 'altAtNM', 'rodFpm', 'bocNM', 'bodNM', 'tocNM', 'msa'];

/** @param {any[]} wps @param {number} i the first index after `i`'s own circuits */
function afterCircuits(wps, i) {
  let j = i + 1;
  while (j < wps.length && wps[j] && wps[j].isPattern) j++;
  return j;
}

/** A copy of `flights` in which plan `fIdx` and its waypoints are new objects.
 *  @param {any[]} flights @param {number} fIdx */
function copyPlan(flights, fIdx) {
  const out = flights.slice();
  out[fIdx] = Object.assign({}, flights[fIdx], {
    waypoints: flights[fIdx].waypoints.map((/** @type {any} */ w) => Object.assign({}, w))
  });
  return out;
}

/**
 * Can this waypoint be made a touch & go or a full stop? Not the departure
 * (you cannot land before taking off), not a circuit, not already a stop.
 * @param {any[]} flights @param {number} fIdx @param {number} wpIdx
 */
export function canBecomeStop(flights, fIdx, wpIdx) {
  const wp = flights && flights[fIdx] && flights[fIdx].waypoints[wpIdx];
  return !!wp && wpIdx > 0 && !wp.isPattern && !wp.stop;
}

/**
 * MAKE A WAYPOINT A STOP, AND START THE NEXT PLAN FROM IT.
 *
 * The waypoint becomes the stop that ends its plan; whatever was flown after
 * it moves, untouched, into a new plan placed directly behind, departing from
 * the stop's coordinates at the field elevation. With nothing after it, only
 * the stop is made and `newPlanIdx` is -1 - opening an empty next sector is the
 * page's setting (`autoPlanAfterStop`), not this function's decision.
 *
 * @param {any[]} flights
 * @param {number} fIdx
 * @param {number} wpIdx
 * @param {{kind: string, newId: number,
 *          at?: {lat: number, lng: number, name: string, elevFt?: number|null}|null}} opts
 *   `at` is the published aerodrome: the waypoint is put ON it (coordinate,
 *   name, field elevation). Without it the waypoint stays where it is.
 * @returns {{flights: any[], newPlanIdx: number, moved: number}|null}
 */
export function splitPlanAtStop(flights, fIdx, wpIdx, opts) {
  const kind = normaliseStopKind(opts && opts.kind);
  if (!kind || !canBecomeStop(flights, fIdx, wpIdx)) return null;
  const out = copyPlan(flights, fIdx);
  const fl = out[fIdx];
  const wp = fl.waypoints[wpIdx];
  const at = opts.at || null;
  if (at) {
    wp.lat = at.lat; wp.lng = at.lng; wp.name = at.name;
    wp.anchor = 'AIP-AD';
  }
  const elev = at && typeof at.elevFt === 'number' ? at.elevFt : null;
  // ON THE FIELD (v16.56): a stop is at the published elevation when there is one.
  if (elev !== null) wp.alt = elev;
  wp.stop = kind;
  wp.stopMin = normaliseStopMinutes(kind, undefined);
  delete wp.flyby;
  delete wp.fuelAfterGal;

  const cut = afterCircuits(fl.waypoints, wpIdx);
  const rest = fl.waypoints.slice(cut);
  fl.waypoints = fl.waypoints.slice(0, cut);
  if (!rest.some((/** @type {any} */ w) => !w.isPattern)) {
    // Nothing flown after it (stray circuits only): they stay with the stop.
    fl.waypoints = fl.waypoints.concat(rest);
    return { flights: out, newPlanIdx: -1, moved: 0 };
  }
  const depElev = elev !== null ? elev : wp.alt;
  const dep = {
    lat: wp.lat, lng: wp.lng, name: wp.name, alt: depElev,
    oat: wp.oat, wdir: wp.wdir, wspd: wp.wspd,
    var: wp.var, varSource: wp.varSource,
    isPattern: false, laps: 1
  };
  out.splice(fIdx + 1, 0, {
    id: opts.newId, title: 'Flight Plan ' + opts.newId, depElev,
    waypoints: [dep].concat(rest)
  });
  return { flights: out, newPlanIdx: fIdx + 1, moved: rest.length };
}

/**
 * THE WAY BACK: A STOP BECOMES A WAYPOINT FLOWN OVER, AND THE TWO PLANS JOIN.
 *
 * The stop's own circuits go (a fly-by flies none); the plan it opened loses
 * its departure - the same place - and the rest of it is appended. A next plan
 * that is not this stop's (`sectorOpenedByStop`) is left alone.
 *
 * THE ALTITUDE IS GIVEN, NOT DERIVED: a stop sits at field elevation, and a
 * fly-by left there would plan a descent to the runway and a climb back out
 * over an aerodrome the aircraft never touches (the v16.56 bug). The caller
 * passes the planning altitude a new fly-by gets.
 *
 * @param {any[]} flights @param {number} fIdx @param {number} wpIdx
 * @param {{alt?: number, name?: string, flyby?: boolean}} [opts]
 * @returns {{flights: any[], joinedPlanIdx: number, joined: number, circuits: number}|null}
 */
export function mergeStopIntoFlyby(flights, fIdx, wpIdx, opts) {
  const src = flights && flights[fIdx] && flights[fIdx].waypoints[wpIdx];
  if (!src || !src.stop || src.isPattern) return null;
  const o = opts || {};
  const nextIdx = sectorOpenedByStop(flights, fIdx, wpIdx);
  const out = copyPlan(flights, fIdx);
  const fl = out[fIdx];
  const wp = fl.waypoints[wpIdx];
  const cut = afterCircuits(fl.waypoints, wpIdx);
  let circuits = cut - (wpIdx + 1);
  fl.waypoints.splice(wpIdx + 1, circuits);
  delete wp.stop; delete wp.stopMin; delete wp.fuelAfterGal;
  if (typeof o.alt === 'number' && Number.isFinite(o.alt)) wp.alt = o.alt;
  if (o.name) wp.name = o.name;
  if (o.flyby) wp.flyby = true;
  let joined = 0;
  if (nextIdx >= 0) {
    // Its first waypoint IS this place; circuits flown there before leaving go
    // with the landing they belonged to.
    let rest = flights[nextIdx].waypoints.slice(1);
    while (rest.length && rest[0].isPattern) { rest = rest.slice(1); circuits++; }
    joined = rest.length;
    fl.waypoints = fl.waypoints.concat(rest.map((/** @type {any} */ w) => Object.assign({}, w)));
    out.splice(nextIdx, 1);
  }
  return { flights: out, joinedPlanIdx: nextIdx, joined, circuits };
}

/**
 * Touch & go <-> full stop, in place. The minutes become the new kind's
 * default (5 and 10 mean different things), and a refuel leaves with the full
 * stop it belonged to - a touch & go never stops moving.
 * @param {any[]} flights @param {number} fIdx @param {number} wpIdx @param {string} kind
 * @returns {{flights: any[]}|null}
 */
export function setStopKind(flights, fIdx, wpIdx, kind) {
  const k = normaliseStopKind(kind);
  const src = flights && flights[fIdx] && flights[fIdx].waypoints[wpIdx];
  if (!k || !src || !src.stop || src.stop === k) return null;
  const out = copyPlan(flights, fIdx);
  const wp = out[fIdx].waypoints[wpIdx];
  wp.stop = k;
  wp.stopMin = normaliseStopMinutes(k, undefined);
  if (k !== 'full-stop') delete wp.fuelAfterGal;
  return { flights: out };
}

/** Does this waypoint already have circuits flown at it?
 *  @param {any[]} flights @param {number} fIdx @param {number} wpIdx */
export function hasCircuits(flights, fIdx, wpIdx) {
  const wps = flights && flights[fIdx] && flights[fIdx].waypoints;
  return !!(wps && wps[wpIdx + 1] && wps[wpIdx + 1].isPattern);
}

/**
 * Circuits at a waypoint that is already in the route. One PATTERN waypoint on
 * the fix it follows (v16.84); a second is refused - the laps are edited.
 * @param {any[]} flights @param {number} fIdx @param {number} wpIdx
 * @param {{laps: number, alt: number}} opts the circuit altitude is the caller's
 *   (derived from the field by `patternAltitudeAt`, or the waypoint's own)
 * @returns {{flights: any[]}|null}
 */
export function addCircuitsAt(flights, fIdx, wpIdx, opts) {
  const src = flights && flights[fIdx] && flights[fIdx].waypoints[wpIdx];
  const laps = Math.floor(Number(opts && opts.laps));
  if (!src || src.isPattern || hasCircuits(flights, fIdx, wpIdx) || !(laps >= 1)) return null;
  const out = copyPlan(flights, fIdx);
  out[fIdx].waypoints.splice(wpIdx + 1, 0, {
    lat: src.lat, lng: src.lng, name: 'PATTERN',
    alt: Number.isFinite(Number(opts.alt)) ? Number(opts.alt) : src.alt,
    oat: src.oat, wdir: src.wdir, wspd: src.wspd,
    var: src.var, varSource: src.varSource, isPattern: true, laps
  });
  return { flights: out };
}

/**
 * Where may this waypoint move to? One place earlier or later, among the
 * ordinary en-route waypoints only: the departure stays first, the destination
 * stays last, and a stop or a circuit neither moves nor is passed (a stop ends
 * its plan; a circuit sits on its fix).
 * @param {any[]} flights @param {number} fIdx @param {number} wpIdx @param {number} dir -1 or +1
 */
export function canMoveWaypoint(flights, fIdx, wpIdx, dir) {
  const wps = flights && flights[fIdx] && flights[fIdx].waypoints;
  if (!wps || (dir !== -1 && dir !== 1)) return false;
  const a = wps[wpIdx], b = wps[wpIdx + dir];
  const plain = (/** @type {any} */ w) => !!w && !w.isPattern && !w.stop;
  // THE DESTINATION STAYS LAST, as the departure stays first: it is the last
  // waypoint that is not a circuit, it sits at field elevation, and swapping it
  // inward would plan a descent to a runway in the middle of the route.
  let dest = wps.length - 1;
  while (dest > 0 && wps[dest] && wps[dest].isPattern) dest--;
  const hi = Math.max(wpIdx, wpIdx + dir);
  return wpIdx >= 1 && wpIdx + dir >= 1 && hi < dest && plain(a) && plain(b);
}

/**
 * Swap a waypoint with its neighbour. The three legs around the pair now run
 * between different places, so what was typed FOR those legs - via points, an
 * altitude target, a descent rate, the MSA - is cleared rather than left
 * describing a leg that no longer exists; `cleared` counts them so the page can
 * say so. A stale MSA is the one that matters: it is a terrain figure.
 * @param {any[]} flights @param {number} fIdx @param {number} wpIdx @param {number} dir
 * @returns {{flights: any[], cleared: number, newIdx: number}|null}
 */
export function moveWaypoint(flights, fIdx, wpIdx, dir) {
  if (!canMoveWaypoint(flights, fIdx, wpIdx, dir)) return null;
  const out = copyPlan(flights, fIdx);
  const wps = out[fIdx].waypoints;
  const lo = Math.min(wpIdx, wpIdx + dir);
  const t = wps[lo]; wps[lo] = wps[lo + 1]; wps[lo + 1] = t;
  let cleared = 0;
  for (const i of [lo, lo + 1, lo + 2]) {
    const w = wps[i];
    if (!w || w.isPattern) continue;
    for (const k of LEG_FIELDS) {
      if (w[k] !== undefined && !(Array.isArray(w[k]) && !w[k].length)) cleared++;
      delete w[k];
    }
  }
  return { flights: out, cleared, newIdx: wpIdx + dir };
}

/**
 * How far a drop may land from a fix's symbol and still be "on" it, in NM, for
 * a tolerance given in screen pixels. Web-Mercator ground resolution: a pixel
 * is 156543.03392 m x cos(latitude) / 2^zoom (256 px tiles).
 * @param {number} px @param {number} zoom @param {number} latDeg
 */
export function dropToleranceNM(px, zoom, latDeg) {
  if (![px, zoom, latDeg].every(Number.isFinite)) return 0;
  const mPerPx = 156543.03392 * Math.cos(latDeg * Math.PI / 180) / Math.pow(2, zoom);
  return Math.max(0, px * mPerPx / 1852);
}
