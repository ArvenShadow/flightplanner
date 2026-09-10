/**
 * Export / import payloads - the shape of the JSON the pilot carries
 * between machines. Extracted from section 8 (v16.18).
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: personal data must never leak
 * into an export. A route file gets emailed, dropped in a shared folder,
 * handed to someone else - so what leaves must be a deliberate list, not
 * "whatever happens to be on the settings object".
 *
 * Import already whitelisted the profile keys it would accept. Export
 * did not: it serialised the live profile object wholesale, so any key a
 * future feature parked there would have shipped with every route file.
 * Both directions now share ONE list, PROFILE_KEYS, so the two can never
 * drift apart again.
 *
 * Why the profile travels at all: without it the same route computes
 * different times and fuel on another computer, because it would be
 * running factory defaults.
 *
 * Pure: no DOM, no localStorage, no file I/O. The page reads the inputs
 * and writes the blob.
 */

/** The ONLY profile keys that may cross the boundary, in either direction.
 *  Aircraft performance, units and display preference - nothing that
 *  identifies a person, a machine or a place. */
import { normaliseKeymap } from './keys.js';
import { normaliseStopKind, normaliseStopMinutes, normaliseRefuelGal } from './anchors.js';

export const PROFILE_KEYS = [
  'mode', 'cruiseRpm', 'cruiseMp', 'cruiseTas', 'cruiseFf',
  'climbMode', 'ccRoc', 'ccKias', 'ccFf',
  'roc', 'climbTas', 'climbFf', 'rod', 'descTas', 'descFf',
  'patternTime', 'patternFf', 'taxiFuel',
  'theme', 'distUnit', 'fuelUnit', 'minuteMark', 'declutter', 'baseChart', 'chartDetail',
  'airspaceOn', 'fixesOn',
  // Map-page display preferences. Colours are stored already validated to
  // #rrggbb; normaliseFixStyle re-checks them on the way in regardless,
  // because a route file can arrive from anyone.
  'fixAdColor', 'fixRpColor', 'fixAdShape', 'fixRpShape', 'fixStyle', 'fixSize', 'fixLabels',
  // Whether a touch & go or a full stop opens the next sector for you (v16.54).
  'autoPlanAfterStop',
  // The corridor ring (v16.61): a map-display preference, exactly like the fix
  // style and the track weight, and re-validated on every read for the same
  // reason - it can arrive from a settings file somebody else wrote.
  'corridorOn',
  'corridorNM',
  'corridorFillPct',
  'skin',
  'splitRatio',
  'stackRatio',
  'navPath',
  'corridorColorMode',
  'corridorColor',
  // The route line's thickness (v16.50). Validated by normaliseRouteWeight on
  // every read, because a route file can carry it.
  'routeWeight'
];

/** Copy across only the allowed profile keys. Anything else - now or
 *  added later - is dropped silently and deliberately. */
/** @param {Record<string, any>|null|undefined} profile
 *  @returns {Record<string, any>} only the allowed keys */
export function pickProfileKeys(profile) {
  /** @type {Record<string, any>} */
  const out = {};
  if (!profile || typeof profile !== 'object') return out;
  for (const k of PROFILE_KEYS) {
    if (profile[k] !== undefined) out[k] = profile[k];
  }
  return out;
}

/** A blank plan: one empty flight. */
export function defaultFlights() {
  return [{ id: 1, title: 'Flight Plan 1', depElev: 0, waypoints: [] }];
}

/**
 * Make an untrusted flight list safe to load: drop non-objects, drop
 * waypoints without usable coordinates, drop empty via arrays. Returns
 * null when nothing usable survives, so the caller can keep what it has
 * rather than replacing a good plan with an empty one.
 */
/** @param {any} candidate untrusted, straight out of a JSON file
 *  @returns {Flight[]|null} null when nothing usable survives, so the caller
 *  keeps the plan it already has rather than replacing it with an empty one */
export function sanitiseFlights(candidate) {
  if (!Array.isArray(candidate) || candidate.length === 0) return null;
  const cleaned = candidate
    .filter((f) => f && typeof f === 'object')
    .map((f, i) => {
      const dep = num(f.depElev);
      return {
        id: Number.isFinite(num(f.id)) ? num(f.id) : (i + 1),
        title: f.title === null || f.title === undefined ? `Flight Plan ${i + 1}` : String(f.title),
        // 0 ft is a GENERIC default, not an invented aerodrome elevation: the
        // schedule needs a finite datum, and the first waypoint's own altitude
        // overrides it everywhere it matters.
        depElev: Number.isFinite(dep) ? dep : 0,
        waypoints: Array.isArray(f.waypoints)
          ? f.waypoints.filter((/** @type {any} */ w) => w && typeof w === 'object'
              && isFinite(num(w.lat)) && isFinite(num(w.lng))).map(sanitiseWaypoint)
          : []
      };
    });
  return cleaned.length ? cleaned : null;
}

/** Absent is NaN, not 0. A missing OAT or wind must STAY missing so the red
 *  banner names it - turning it into a number is the calm-wind assumption this
 *  planner refuses (v16.20, and C2 all over again). A typed 0 is a real value
 *  and survives. */
function num(/** @type {any} */ v) {
  if (v === null || v === undefined || v === '') return NaN;
  const n = Number(v);
  return typeof n === 'number' ? n : NaN;
}

/**
 * ONE waypoint, rebuilt rather than patched.
 *
 * The old version checked coordinate finiteness and passed everything else
 * through untouched, so `lat: "69.3"` reached `toFixed` (a string has no
 * toFixed - it took the daylight card down, and with it the integrity banner),
 * `name` could be an object that printed `[object Object]`, `laps` could be
 * negative and `isPattern` a string. It also MUTATED the caller's objects,
 * reassigning and deleting `via` in place.
 *
 * The key list is explicit: an unknown key is dropped rather than carried into
 * the live plan. Add a field here when the app gains one.
 */
function sanitiseWaypoint(/** @type {any} */ w) {
  /** @type {any} */
  const out = {
    lat: num(w.lat), lng: num(w.lng),
    name: w.name === null || w.name === undefined ? '' : String(w.name),
    alt: num(w.alt), oat: num(w.oat), wdir: num(w.wdir), wspd: num(w.wspd),
    var: num(w.var),
    isPattern: w.isPattern === true || w.isPattern === 'true'
  };
  if (w.varSource !== undefined && w.varSource !== null) out.varSource = String(w.varSource);
  if (w.anchor !== undefined && w.anchor !== null) out.anchor = String(w.anchor);
  // What happens AT this aerodrome (v16.54). An unknown kind is dropped, not
  // guessed at - a stop the app does not understand must not silently become
  // one it does. The minutes follow the kind, so clearing the kind clears both.
  const stop = normaliseStopKind(w.stop);
  if (stop) {
    out.stop = stop;
    out.stopMin = normaliseStopMinutes(stop, w.stopMin);
    // Refuelling belongs to a FULL STOP only: a touch & go never stops moving.
    // Stored in gallons, so switching display units cannot reinterpret it.
    const gal = stop === 'full-stop' ? normaliseRefuelGal(w.fuelAfterGal) : null;
    if (gal !== null) out.fuelAfterGal = gal;
  }
  if (out.isPattern) out.laps = Math.max(1, Math.floor(num(w.laps)) || 1);
  // Pins: cleared is null, never 0, so a route saved before pins existed reads
  // identically to one made after.
  // ONE TARGET (v16.76): where the leg's altitude must be attained, from the
  // leg's start fix. The three v16.37 pins are still ACCEPTED so a route saved
  // before this reads identically, and still written back out if that is all the
  // file carries - but nothing writes them any more.
  const at = num(w.altAtNM);
  if (Number.isFinite(at) && at > 0) out.altAtNM = at;
  for (const k of ['bocNM', 'bodNM', 'tocNM']) {
    const v = num(w[k]);
    if (Number.isFinite(v) && v > 0) out[k] = v;
  }
  if (Array.isArray(w.via)) {
    const via = w.via
      .filter((/** @type {any} */ v) => v && isFinite(num(v.lat)) && isFinite(num(v.lng)))
      .map((/** @type {any} */ v) => ({ lat: num(v.lat), lng: num(v.lng) }));
    if (via.length) out.via = via;
  }
  return out;
}

/**
 * The exported file's contents. The profile is passed through the
 * whitelist on the way OUT as well as on the way in.
 */
/** @param {{routes?: any, missions?: any, flights?: Flight[],
 *           profile?: Record<string, any>,
 *           keybinds?: Record<string, string|null>,
 *           planningPrefs?: {fuel?: string, reserve?: string, etd?: string}}} input
 *  @returns {Record<string, any>} the exact contents of the exported file */
export function buildExportPayload({ routes, missions, flights, profile, planningPrefs, keybinds }) {
  return {
    formatVersion: 2,
    routes: routes || {},
    missions: missions || {},
    currentFlights: flights || [],
    // Without this the same routes compute different times and fuel on
    // another computer, because it would be running factory defaults.
    profile: pickProfileKeys(profile),
    planningPrefs: {
      fuel: (planningPrefs && planningPrefs.fuel) || '',
      reserve: (planningPrefs && planningPrefs.reserve) || '',
      etd: (planningPrefs && planningPrefs.etd) || ''
    },
    // THE KEYBOARD TRAVELS WITH THE PILOT (v16.52). Bindings are a personal
    // setting like the units and the fix colours, and re-teaching a new laptop
    // a dozen shortcuts by hand is exactly the busywork an export exists to
    // remove. It is normalised on the way OUT as well as in, so an export can
    // never carry a chord the app would refuse to load.
    //
    // It identifies NOBODY - it is a list of keystrokes - so it does not touch
    // the personal-data rule that PROFILE_KEYS enforces.
    keybinds: normaliseKeymap(keybinds)
  };
}

// ---------------------------------------------------------------------------
// IMPORT: WHAT IS IN THE FILE, AND WHETHER IT COLLIDES (v16.81)
//
// The pilot asked for two things after finding out what import actually did:
// a choice between "routes and settings" and "routes only", and a prompt with
// a side-by-side preview when a route in the file has the same NAME as one
// they have saved.
//
// THE SILENT OVERWRITE WAS THE REAL DEFECT. Import merges into the saved
// library - your other routes are kept - but a same-named entry replaced yours
// with nothing said, and the undo snapshot covers `flights` and the plan
// fields, NOT localStorage. So that one was unrecoverable, and it was the only
// unrecoverable thing import did.
//
// These are pure so the rules are testable without a browser; the page turns
// the comparison into DOM nodes.
// ---------------------------------------------------------------------------

/**
 * A canonical string for a value, for EQUALITY ONLY - never for display.
 *
 * Keys are sorted, so two waypoints that differ only in the order their keys
 * happened to be written compare equal. `JSON.stringify(NaN)` is `null`, which
 * this file warns about elsewhere; here it is the behaviour wanted, because a
 * missing OAT and a missing OAT ARE the same thing and must not read as a
 * difference the pilot has to adjudicate.
 * @param {any} v @returns {string}
 */
function stableString(v) {
  if (Array.isArray(v)) return '[' + v.map(stableString).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort()
      .map((k) => JSON.stringify(k) + ':' + stableString(v[k])).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}

/** Canonical signature of one saved route (an array of waypoints).
 *  @param {any} wps @returns {string} */
export function routeSignature(wps) {
  return stableString(Array.isArray(wps) ? wps : []);
}

/** @param {any} w the four fields the side-by-side preview shows. A difference
 *  OUTSIDE them (OAT, wind, a pin, a via) is reported as "other values differ"
 *  rather than flagged on a row that looks identical - two visually identical
 *  rows marked as different, with no way to see why, is worse than saying so. */
function diffCell(w) {
  return { name: String(w.name == null ? '' : w.name),
           lat: num(w.lat), lng: num(w.lng), alt: num(w.alt) };
}

/**
 * Compare two versions of one route, for the replace-or-keep prompt.
 *
 * ALIGNED BY INDEX, not by a longest-common-subsequence diff, and that is a
 * deliberate limit rather than an oversight: the case this exists for is a
 * route edited in place, where index alignment is exactly right. Insert a fix
 * in the middle and every later row reads as changed - which overstates the
 * difference but never understates it, so the pilot is never told two routes
 * agree when they do not. Both sides must already be sanitised.
 *
 * @param {any[]} before the saved route
 * @param {any[]} after the one in the file
 * @returns {{identical: boolean,
 *            rows: {i: number, before: any, after: any, state: string}[],
 *            summary: {before: number, after: number, changed: number,
 *                      added: number, removed: number, hidden: number}}}
 */
export function compareRoutes(before, after) {
  const a = Array.isArray(before) ? before : [];
  const b = Array.isArray(after) ? after : [];
  const rows = [];
  let changed = 0, added = 0, removed = 0, hidden = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const o = a[i], w = b[i];
    if (!o) { added++; rows.push({ i, before: null, after: diffCell(w), state: 'added' }); continue; }
    if (!w) { removed++; rows.push({ i, before: diffCell(o), after: null, state: 'removed' }); continue; }
    const cellO = diffCell(o), cellW = diffCell(w);
    let state = 'same';
    if (stableString(o) !== stableString(w)) {
      // `Object.is`, NOT `!==`, for the numbers: a missing OAT is NaN and
      // `NaN !== NaN`, so a plain comparison would call every absent value a
      // difference. Written out rather than looped over a key list, which the
      // typechecker rejected as an unsafe index and which was less clear anyway.
      const shownDiffers = cellO.name !== cellW.name
        || !Object.is(cellO.lat, cellW.lat)
        || !Object.is(cellO.lng, cellW.lng)
        || !Object.is(cellO.alt, cellW.alt);
      if (shownDiffers) { state = 'changed'; changed++; } else { state = 'other'; hidden++; }
    }
    rows.push({ i, before: cellO, after: cellW, state });
  }
  return {
    identical: routeSignature(a) === routeSignature(b),
    rows,
    summary: { before: a.length, after: b.length, changed, added, removed, hidden }
  };
}

/**
 * What an import file actually carries, so the scope question is only asked
 * when there is a choice to make.
 *
 * A file with routes and no settings gets no dialog: offering "routes only"
 * when that is the only possibility is a click for nothing. Same the other way
 * round.
 *
 * @param {any} parsed the parsed JSON
 * @returns {{routeKinds: string[], settingKinds: string[],
 *            hasRoutes: boolean, hasSettings: boolean}}
 */
export function importScopeOf(parsed) {
  const obj = (/** @type {any} */ v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const filled = (/** @type {any} */ v) => obj(v) && Object.keys(v).length > 0;
  const routeKinds = [], settingKinds = [];
  if (Array.isArray(parsed)) {
    if (parsed.length) routeKinds.push('a route');
  } else if (obj(parsed)) {
    if (filled(parsed.routes)) routeKinds.push('saved routes');
    if (filled(parsed.missions)) routeKinds.push('saved missions');
    if (Array.isArray(parsed.currentFlights) && parsed.currentFlights.length) {
      routeKinds.push('the open flight plans');
    }
    // A SETTINGS KIND COUNTS EVEN IF EMPTY-ISH, because `planningPrefs: {}`
    // still reaches the branch that writes the ETD field.
    if (obj(parsed.profile)) settingKinds.push('aircraft settings');
    if (obj(parsed.planningPrefs)) settingKinds.push('planning preferences');
    if (obj(parsed.keybinds)) settingKinds.push('keyboard shortcuts');
  }
  return { routeKinds, settingKinds,
           hasRoutes: routeKinds.length > 0, hasSettings: settingKinds.length > 0 };
}
