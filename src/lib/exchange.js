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
  'fixAdColor', 'fixRpColor', 'fixAdShape', 'fixRpShape', 'fixStyle', 'fixSize', 'fixLabels'
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
  if (out.isPattern) out.laps = Math.max(1, Math.floor(num(w.laps)) || 1);
  // Pins: cleared is null, never 0, so a route saved before pins existed reads
  // identically to one made after.
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
 *           planningPrefs?: {fuel?: string, reserve?: string, etd?: string}}} input
 *  @returns {Record<string, any>} the exact contents of the exported file */
export function buildExportPayload({ routes, missions, flights, profile, planningPrefs }) {
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
    }
  };
}
