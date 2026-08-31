/**
 * Magnetic variation — the real WMM.
 *
 * Up to v16.8 this was a low-order polynomial fitted to WMM output over
 * Northern Scandinavia. Replaced by the actual World Magnetic Model
 * (WMM2025 coefficients, valid 2025-2030) now that the build can bundle
 * dependencies. Measured against NOAA's calculator at epoch 2026.6438:
 *
 *   site   WMM2025 model   old polynomial
 *   ENDU      -0.003 deg      +0.59 deg
 *   ENTC      -0.002          +0.63
 *   ENEV      +0.001          +0.72
 *   ENBO      -0.000          +0.69
 *   ENGM      +0.005          -1.94
 *   ENKR      +0.003          -0.43
 *
 * i.e. exact to rounding, versus up to 1.94 deg of error - and magnetic
 * variation feeds MH directly, the heading actually flown. It also
 * retires the polynomial's "refit around 2029-2030" maintenance debt.
 *
 * Every VAR cell in the OFP stays editable so it can still be overridden
 * from the chart.
 */
import { calculateMagVarForDecimalYear, MODEL_EPOCH, MODEL_VALID_UNTIL } from 'magvar';

export const WMM_MODEL = `WMM${MODEL_EPOCH}`;
export const WMM_VALID_UNTIL = MODEL_VALID_UNTIL;

function nowDecimalYear() {
  const d = new Date();
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  const end = Date.UTC(d.getUTCFullYear() + 1, 0, 1);
  return d.getUTCFullYear() + (d.getTime() - start) / (end - start);
}

/**
 * Declination in degrees, EAST-POSITIVE (the sign convention NOAA and the
 * WMM use).
 * @param {number} lat
 * @param {number} lng
 * @param {number} [yearDecimal] pin the epoch (test fixtures); live use omits it.
 */
export function magneticDeclination(lat, lng, yearDecimal) {
  const year = (typeof yearDecimal === 'number') ? yearDecimal : nowDecimalYear();
  return calculateMagVarForDecimalYear(year, lat, lng);
}

/** True whether the WMM epoch still covers the given (or current) year. */
export function isWmmCurrent(yearDecimal) {
  const y = (typeof yearDecimal === 'number') ? yearDecimal : nowDecimalYear();
  return y >= MODEL_EPOCH && y < MODEL_VALID_UNTIL;
}

/**
 * The app's VAR value for a waypoint.
 * `val` follows the OFP convention (negative = easterly declination, so that
 * MT = TT + val); `raw` keeps two decimals of the east-positive declination.
 */
export function resolveMagVar(lat, lng, yearDecimal) {
  const east = magneticDeclination(lat, lng, yearDecimal);
  return {
    val: -Math.round(east),
    raw: east.toFixed(2),
    source: WMM_MODEL
  };
}
