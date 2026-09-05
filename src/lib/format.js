/**
 * Display formatting for the OFP - pure string builders, extracted from
 * section 1 of the page script (v16.13).
 *
 * clockFromMinutes carries the midnight rule: a leg that lands after
 * 00:00 must never read EARLIER than the departure time, so the day
 * rollover is marked "+1" (and "+2"...). The DOM read that supplies the
 * ETD stays in the page; the arithmetic is here so it can be tested
 * across midnight without a browser.
 */

// ---- units -------------------------------------------------------------
// The pilot picks NM/SM/KM and gal/L/kg; everything is COMPUTED in NM and
// US gallons (the POH's units) and converted only for display, so a unit
// change can never move a number.

/** @param {number|string|null|undefined} mins @returns {string} "HH:MM", or "-" */
export function formatTimeHHMM(mins) {
  if (mins === undefined || mins === null || mins === '') return '-';
  const n = Number(mins);
  if (isNaN(n)) return '-';
  const total = Math.max(0, Math.round(n));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Degrees + decimal minutes, the format printed on VFR chart margins,
// so waypoints can be plotted without any mental conversion.
/** @param {number} value degrees @param {boolean} isLat @returns {string} e.g. "69\u00b040.83'N" */
export function toDMM(value, isLat) {
  const hemi = isLat ? (value >= 0 ? 'N' : 'S') : (value >= 0 ? 'E' : 'W');
  const abs = Math.abs(value);
  let deg = Math.floor(abs);
  let min = (abs - deg) * 60;
  if (min >= 59.995) { deg += 1; min = 0; }   // avoid 60.00' after rounding
  return `${String(deg).padStart(isLat ? 2 : 3, '0')}\u00b0${min.toFixed(2).padStart(5, '0')}'${hemi}`;
}

// ETD "HH:MM" + accumulated minutes -> ETO clock string. Wrapping past
// midnight is marked "+1" (etc.) so a 23:30 departure with a 90-minute
// mission reads "01:00+1", not a time that looks earlier than the ETD.
// Returns null for a missing or malformed ETD - the caller shows nothing
// rather than an invented time.
/** @param {string} etd "HH:MM" @param {number} accMins minutes after ETD
 *  @returns {string|null} "HH:MM", with "+1" past midnight; null if the ETD is unusable */
export function clockFromMinutes(etd, accMins) {
  if (!etd || !/^\d{1,2}:\d{2}$/.test(etd)) return null;
  const [h, m] = etd.split(':').map(Number);
  const raw = h * 60 + m + Math.round(accMins);
  const total = ((raw % 1440) + 1440) % 1440;
  const days = Math.floor(raw / 1440);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}` + (days > 0 ? `+${days}` : '');
}

/** @param {string} [u] @returns {string} */
export function distLabel(u) { return u === 'KM' ? 'km' : (u === 'SM' ? 'SM' : 'NM'); }
/** @param {string} [u] @returns {string} */
export function fuelLabel(u) { return u === 'LITERS' ? 'L' : (u === 'KG' ? 'kg' : 'gal'); }
/** @param {string} [u] @returns {string} */
export function fuelRateLabel(u) { return fuelLabel(u) + '/h'; }

/** @param {number} nm @param {string} [targetUnit] @returns {number} */
export function convertDist(nm, targetUnit) {
  if (targetUnit === 'KM') return nm * 1.852;
  if (targetUnit === 'SM') return nm * 1.15078;
  return nm;
}

/** @param {number} gal @param {string} [targetUnit] @returns {number} */
export function convertFuel(gal, targetUnit) {
  if (targetUnit === 'LITERS') return gal * 3.78541;
  if (targetUnit === 'KG') return gal * 2.72; // AvGas 100LL density approx
  return gal;
}

// ---- HTML escaping -----------------------------------------------------
// THE ONE ESCAPER (v16.47). Every string the app interpolates into innerHTML
// goes through this, and there is exactly one of it on purpose: six
// near-identical local copies had grown across the page script, three of
// which omitted `"` and one of which omitted `>`, so which characters were
// safe depended on which function you happened to be in.
//
// THIS IS CORRECTNESS BEFORE IT IS SECURITY. A waypoint the pilot names
// `Bodø <VOR>` breaks the OFP table with no malice at all - the `<VOR>`
// is parsed as a tag and the rest of the row disappears. That it ALSO
// closes an injection door on a shared route file is a second benefit,
// not the argument.

/** @param {any} t @returns {string} */
export function escapeText(t) {
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
