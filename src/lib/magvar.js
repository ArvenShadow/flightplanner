/**
 * Magnetic variation.
 *
 * A low-order polynomial fitted to WMM output over Northern Scandinavia -
 * NOT a full WMM implementation. Verified Aug 2026 against NOAA WMM2025
 * (epoch 2026.6438): <=0.75 deg error at ENDU/ENTC/ENEV/ENBO/ENKR and
 * -1.9 deg at ENGM, i.e. honest to its documented regional validity. The
 * model's secular term (0.20 deg/yr) lags WMM's (0.26), so error grows
 * ~0.06 deg/yr: refit around 2029-2030 or when WMM2030 lands.
 *
 * Every VAR cell in the OFP stays editable so it can be overridden from
 * the chart.
 */

/**
 * @param {number} lat
 * @param {number} lng
 * @param {number} [yearDecimal] pin the epoch (used by the test fixtures so
 *   they cannot drift as the wall clock advances); live use omits it.
 * @returns {{val: number, raw: string, source: string}} val is the OFP
 *   convention (negative = easterly declination), raw keeps two decimals.
 */
export function getRegionalMagVar(lat, lng, yearDecimal) {
  const now = new Date();
  const currentYearDecimal = (typeof yearDecimal === 'number') ? yearDecimal
    : now.getFullYear() + (now.getMonth() / 12.0) + (now.getDate() / 365.0);
  const dLat = (lat - 65.0);
  const dLng = (lng - 15.0);
  const dYr = (currentYearDecimal - 2025.0);

  const baseDeclinationEast = 7.42
    + (0.542 * dLat)
    + (0.428 * dLng)
    - (0.0031 * dLat * dLat)
    + (0.0018 * dLng * dLng)
    - (0.0042 * dLat * dLng);

  const secularVariationPerYear = 0.178 + (0.004 * dLat) + (0.002 * dLng);
  const totalDeclinationEast = baseDeclinationEast + (secularVariationPerYear * dYr);

  return {
    val: -Math.round(totalDeclinationEast),
    raw: totalDeclinationEast.toFixed(2),
    source: 'REGIONAL'
  };
}

/** Resolution point for a waypoint's variation (kept as the seam where a
 *  future full-WMM source would plug in). */
export function resolveMagVar(lat, lng) {
  return getRegionalMagVar(lat, lng);
}
