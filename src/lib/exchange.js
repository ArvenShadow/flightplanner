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
  'airspaceOn', 'fixesOn'
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
    .filter(f => f && typeof f === 'object')
    .map((f, i) => ({
      id: f.id || (i + 1),
      title: f.title || `Flight Plan ${i + 1}`,
      depElev: Number(f.depElev) || 0,
      waypoints: Array.isArray(f.waypoints)
        ? f.waypoints.filter((/** @type {any} */ w) => w && isFinite(w.lat) && isFinite(w.lng))
            .map((/** @type {any} */ w) => {
              if (Array.isArray(w.via)) {
                w.via = w.via.filter((/** @type {any} */ v) => v && isFinite(v.lat) && isFinite(v.lng));
                if (w.via.length === 0) delete w.via;
              }
              return w;
            })
        : []
    }));
  return cleaned.length ? cleaned : null;
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
