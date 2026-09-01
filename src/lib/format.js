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

export function formatTimeHHMM(mins) {
  if (mins === undefined || mins === null || isNaN(mins) || mins === '') return '-';
  const total = Math.max(0, Math.round(mins));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Degrees + decimal minutes, the format printed on VFR chart margins,
// so waypoints can be plotted without any mental conversion.
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
export function clockFromMinutes(etd, accMins) {
  if (!etd || !/^\d{1,2}:\d{2}$/.test(etd)) return null;
  const [h, m] = etd.split(':').map(Number);
  const raw = h * 60 + m + Math.round(accMins);
  const total = ((raw % 1440) + 1440) % 1440;
  const days = Math.floor(raw / 1440);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}` + (days > 0 ? `+${days}` : '');
}

export function distLabel(u) { return u === 'KM' ? 'km' : (u === 'SM' ? 'SM' : 'NM'); }
export function fuelLabel(u) { return u === 'LITERS' ? 'L' : (u === 'KG' ? 'kg' : 'gal'); }
export function fuelRateLabel(u) { return fuelLabel(u) + '/h'; }

export function convertDist(nm, targetUnit) {
  if (targetUnit === 'KM') return nm * 1.852;
  if (targetUnit === 'SM') return nm * 1.15078;
  return nm;
}

export function convertFuel(gal, targetUnit) {
  if (targetUnit === 'LITERS') return gal * 3.78541;
  if (targetUnit === 'KG') return gal * 2.72; // AvGas 100LL density approx
  return gal;
}
