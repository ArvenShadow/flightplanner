/**
 * The integrity check - the rules behind the red DO-NOT-USE banner.
 * Extracted from section 7b2 of the page script (v16.17).
 *
 * This is the last line of defence before a number reaches the pilot, so
 * it is the part that most deserves to be testable without a browser.
 * The rules are pure and live here; the three signals that can only come
 * from what was actually RENDERED - a NaN in the table, an invalid time
 * on the daylight card, negative fuel remaining - are read from the DOM
 * by the page and handed in.
 *
 * Every rule states what is untrustworthy and why, rather than just
 * flagging it: a pilot who cannot see the reason cannot judge the risk.
 */
import { computeFlightSchedule, computeLegTotals } from './legs.js';

/** Route-derived name: first and last real waypoint, e.g. "ENDU-ENTC". */
/** @param {Flight} fl @returns {string} e.g. "ENDU-ENTC" */
export function flightTitle(fl) {
  const pts = (fl.waypoints || []).filter(w => !w.isPattern && w.name);
  if (pts.length >= 2) return `${pts[0].name}-${pts[pts.length - 1].name}`;
  return fl.title || `Flight Plan ${fl.id || ''}`.trim();
}

/**
 * All integrity problems for a set of flights.
 *
 * @param {Flight[]} flights  the flight list
 * @param {{tableText?: string, daylightText?: string, fuelRemaining?: number}} [signals]
 *        what the page actually rendered
 * @returns {string[]} human-readable problems, de-duplicated, in the order
 *          found. Empty means nothing was detected - never a guarantee
 *          that the plan is sound, which is why the guide leads with
 *          PIC responsibility.
 */
export function collectIntegrityProblems(flights, signals) {
  /** @type {string[]} */
  const problems = [];
  /** @param {string} m */
  const add = m => { if (!problems.includes(m)) problems.push(m); };
  const sig = signals || {};

  // --- what was rendered ---------------------------------------------
  const tableTxt = sig.tableText || '';
  if (tableTxt.includes('NaN')) add('A non-numeric value (NaN) appeared in the flight table.');
  if (tableTxt.includes('Infinity')) add('An infinite value appeared in the flight table.');

  const dlTxt = sig.daylightText || '';
  if (dlTxt.includes('NaN') || dlTxt.includes('Invalid'))
    add('The daylight/VFR-day card shows an invalid time - do not trust its window.');

  // --- what the data itself says --------------------------------------
  (flights || []).forEach((/** @type {Flight} */ fl) => {
    (fl.waypoints || []).forEach((/** @type {any} */ wp) => {
      if (!isFinite(wp.lat) || !isFinite(wp.lng) || Math.abs(wp.lat) > 90 || Math.abs(wp.lng) > 180)
        add(`Waypoint "${wp.name}" has invalid coordinates.`);
      if (!isFinite(wp.alt))
        add(`Waypoint "${wp.name}" has a non-numeric altitude.`);
      else if (wp.alt > 14000)
        add(`Waypoint "${wp.name}" is above the POH table ceiling (14,000 ft) - cruise figures are clamped, not computed.`);
      else if (wp.alt < -1300)
        add(`Waypoint "${wp.name}" altitude ${wp.alt} ft is below any terrain on Earth.`);
      // A waypoint with no OAT or no wind cannot be computed at all - the
      // leg time and fuel come out NaN, which the banner catches further
      // down as "a non-numeric value appeared". Refusing to compute is
      // RIGHT (assuming calm wind would be a plausible wrong answer), but
      // the pilot needs to know WHICH field is missing, not just that
      // something is NaN. Reachable through an imported file: the import
      // sanitiser requires coordinates, not weather.
      for (const [field, label] of [['oat', 'temperature (OAT)'], ['wdir', 'wind direction'], ['wspd', 'wind speed']]) {
        if (typeof wp[field] !== 'number' || !isFinite(wp[field]))
          add(`Waypoint "${wp.name}" has no ${label} - the leg ending there cannot be computed.`);
      }
      // Without a variation there is no magnetic track or heading: the row
      // shows "---" rather than a number that could be flown, and the pilot
      // is told which waypoint needs one.
      if (typeof wp.var !== 'number' || !isFinite(wp.var))
        add(`Waypoint "${wp.name}" has no magnetic variation - MT and MH cannot be computed and show "---".`);
      if (typeof wp.wdir === 'number' && isFinite(wp.wdir) && (wp.wdir < 0 || wp.wdir > 360))
        add(`Waypoint "${wp.name}" wind direction ${wp.wdir}\u00b0 is outside 000-360.`);
      if (typeof wp.wspd === 'number' && isFinite(wp.wspd) && (wp.wspd < 0 || wp.wspd > 120))
        add(`Waypoint "${wp.name}" wind speed ${wp.wspd} kt is implausible for VFR planning.`);
    });
    const schedI = computeFlightSchedule(fl);
    /** @type {LegResult|null} */ let lastTravelRes = null;
    /** @type {Waypoint|null} */ let lastTravelTo = null;
    for (let i = 0; i < (fl.waypoints || []).length - 1; i++) {
      const from = fl.waypoints[i], to = fl.waypoints[i + 1];
      if (from.isPattern || to.isPattern) continue;
      const res = computeLegTotals(from, to, schedI[i]);
      if (!res) continue;
      lastTravelRes = res; lastTravelTo = to;
      if (!isFinite(res.timeMin) || res.timeMin < 0 || !isFinite(res.burnGal) || res.burnGal < 0)
        add(`Leg ${from.name} \u2192 ${to.name}: computed time/fuel is invalid.`);
      // no wind entered is not a problem; a wind that swamps the aircraft is
      if (typeof to.wspd === 'number' && to.wspd >= res.minPhaseTas)
        add(`Leg ${from.name} \u2192 ${to.name}: wind (${to.wspd} kt) meets or exceeds the slowest phase's TAS (${res.minPhaseTas} kt) - groundspeed and time are NOT reliable.`);
      else if (res.effGS < 30)
        add(`Leg ${from.name} \u2192 ${to.name}: effective groundspeed ${res.effGS} kt - check the wind entry.`);
      if (res.shortfall)
        add(`Leg ${from.name} \u2192 ${to.name}: cannot get down to ${res.shortfall.alt} ft at ${res.shortfall.target} - the descent is ${res.shortfall.min.toFixed(1)} min short even when started on earlier legs. Lower the cruise altitude or expect to arrive HIGH.`);
      // A PIN THE SCHEDULE COULD NOT HONOUR IS SAID OUT LOUD. Quietly ignoring
      // what the pilot asked for is exactly the kind of confident wrongness
      // this banner exists to catch - and a TOC target is usually pinned for
      // terrain, so a missed one is not cosmetic.
      const SL = schedI[i];
      if (SL && SL.tocTargetNM != null && !SL.tocTargetMet) {
        const need = SL.climbRateReqFpm;
        // The target SETS the bottom of climb, so it is only unmet when the
        // climb does not fit even starting at the leg's first fix. Then the
        // useful thing is not the rate - it is the altitude the previous fix
        // would have to be crossed at, which the pilot can actually change.
        add(`Leg ${from.name} \u2192 ${to.name}: cannot be level at ${to.alt} ft by ` +
          `${SL.tocTargetNM.toFixed(1)} NM after ${from.name} - the climb would have to begin before ` +
          `${from.name}` +
          (SL.tocNeedsEntryAlt !== null
            ? `. Cross ${from.name} at about ${SL.tocNeedsEntryAlt} ft instead of ${Math.round(SL.entryAlt)} ft and it fits.`
            : SL.tocNoAltHelps
              ? `, and crossing ${from.name} higher does not help either - the earlier legs cannot climb that high by then.` +
                (need ? ` Reaching it from ${from.name} would need about ${need} ft/min.` : '')
              : ` and there is no earlier leg to start it on` +
                (need ? ` - reaching it from ${from.name} would need about ${need} ft/min` : '') + '.') +
          ` The climb is always flown at YOUR profile's rate; nothing steeper is invented.`);
      }
      if (SL && SL.bodRefused)
        add(`Leg ${from.name} \u2192 ${to.name}: cannot be level ${SL.bodPinNM.toFixed(1)} NM before ${to.name} - a descent for a later, lower fix already runs through that stretch, so the aircraft is still going down there. The pin was NOT applied.`);
    }
    if (lastTravelRes && lastTravelTo && lastTravelRes.stillClimbing)
      add(`${flightTitle(fl)}: still climbing at ${lastTravelTo.name} - the climb to ${lastTravelTo.alt} ft does not fit within the flight (reaches ~${lastTravelRes.exitAlt} ft).`);
  });

  // --- fuel, as actually totalled on screen ----------------------------
  if (typeof sig.fuelRemaining === 'number' && isFinite(sig.fuelRemaining) && sig.fuelRemaining < 0)
    add('Planned fuel remaining goes NEGATIVE - the mission does not fit the fuel on board.');

  return problems;
}

/** Banner markup for a problem list. Only the first few are shown; the
 *  rest go to the console, so the banner stays readable. */
/** @param {string[]} problems @param {number} [maxShown] @returns {string} */
export function integrityBannerHTML(problems, maxShown) {
  const shown = problems.slice(0, maxShown || 5);
  return '\u26d4 <u>INTEGRITY CHECK FAILED - DO NOT USE THESE FIGURES</u><br>' +
    shown.map(m => '\u2022 ' + m).join('<br>') +
    (problems.length > shown.length ? `<br>\u2026 and ${problems.length - shown.length} more (see console).` : '');
}
