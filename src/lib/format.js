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
  // A NEGATIVE offset marks the day too (L4). accMins is always forward today,
  // so this is latent - but "01:00" for a time the day BEFORE the departure is
  // the same defect the "+1" exists to prevent, in the other direction.
  const dayTag = days > 0 ? `+${days}` : (days < 0 ? `${days}` : '');
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}` + dayTag;
}

// ETO ON A REAL DATE, WHICH IS WHERE clockFromMinutes IS WRONG (M3, v16.48).
//
// clockFromMinutes is pure clock arithmetic - ETD plus elapsed minutes, mod
// 1440 - and it disagreed with the daylight card by an HOUR across a DST
// transition, because the card works in absolute instants. With TZ=Europe/Oslo,
// ETD 01:30 on 2026-10-25 plus 120 min: the OFP column printed 03:30 while the
// card (correctly) put the landing at 02:30. On 2026-03-29 an ETD typed as
// 02:30 does not exist locally; the card reads it as 03:30, the column did not.
//
// Both transitions fall at 02:00-03:00 local, which is deep SERA night in
// Norway on those dates, so a legal day-VFR flight cannot be airborne across
// one. It was still a wrong time on a printed form, and only ever wrong in the
// output the pilot copies - the legality check itself was always right.
//
// So the ETO is now built from the SAME instant the card uses, and the two
// cannot disagree. Without a date there is no instant to build, and the old
// arithmetic is the honest fallback rather than an invented calendar day.
//
// THE "+1" IS A CALENDAR-DAY DIFFERENCE, NOT 1440 MINUTES. Across a transition
// a local day is 23 or 25 hours long, so counting minutes would put the marker
// on the wrong side of midnight in exactly the case this function exists for.

/** @param {Date} a @param {Date} b @returns {number} whole local days b is after a */
function localDaysBetween(a, b) {
  const a0 = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const b0 = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((b0 - a0) / 86400000);
}

/**
 * @param {string} dateStr flight date "YYYY-MM-DD" ('' or malformed -> fallback)
 * @param {string} etd "HH:MM" local
 * @param {number} accMins minutes after the ETD
 * @returns {string|null} "HH:MM" local, with "+1" past midnight; null if the ETD is unusable
 */
export function clockFromInstant(dateStr, etd, accMins) {
  if (!etd || !/^\d{1,2}:\d{2}$/.test(etd)) return null;
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return clockFromMinutes(etd, accMins);
  const [Y, M, D] = dateStr.split('-').map(Number);
  const [h, m] = etd.split(':').map(Number);
  const start = new Date(Y, M - 1, D, h, m);
  if (isNaN(start.getTime())) return clockFromMinutes(etd, accMins);
  const at = new Date(start.getTime() + Math.round(accMins) * 60000);
  const days = localDaysBetween(start, at);
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}` +
    (days > 0 ? `+${days}` : '');
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
