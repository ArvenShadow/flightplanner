/**
 * Forecast winds aloft - the vector maths and the Open-Meteo request and
 * response shapes. Extracted from section 6b (v16.16).
 *
 * SOURCE (settled): Open-Meteo pressure levels 1000-600 hPa. MET Nordic
 * (api.met.no) was checked and has NO pressure-level data, so it cannot
 * serve winds aloft. CC BY attribution is required and lives in the page.
 *
 * WHY VECTORS AND NOT AVERAGED DEGREES: winds are averaged in u/v space,
 * which makes the mean SPEED-WEIGHTED. That is the physically right
 * answer and it is not the same as averaging the direction numbers - the
 * three-model mean of 260/20, 280/24 and 300/28 is 282.3 degrees, not
 * 280. A test once asserted 280 and was wrong; the app was right.
 * Averaging degrees also breaks across north (350 and 010 average to 180
 * instead of 000).
 *
 * Pure: no DOM, no fetch. The network call, the status line and the
 * matrix fill stay in the page.
 */
import { toRad, toDeg } from './performance.js';
import { pathSegments, pointAlongSegments } from './legs.js';

// The pressure levels requested from Open-Meteo, 1000-600 hPa. Both the
// request builder and the response parser key off this list, so it lives
// with them rather than in the page.
export const OM_LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700, 600];


/** Wind direction/speed to a u/v vector. Averaging in u/v space is what
 *  makes a multi-model or multi-point mean SPEED-WEIGHTED, and what stops
 *  350 and 010 averaging to the reciprocal 180.
 *  @param {number} dirDeg degrees the wind blows FROM @param {number} spd knots
 *  @returns {[number, number]} [u, v] */
export function windToUV(dirDeg, spd) {
  const r = toRad(dirDeg);
  return [-spd * Math.sin(r), -spd * Math.cos(r)];
}
/** @param {number} u @param {number} v
 *  @returns {[number, number]} [direction degrees, speed knots] */
export function uvToWind(u, v) {
  const spd = Math.hypot(u, v);
  const dir = (toDeg(Math.atan2(-u, -v)) + 360) % 360;
  return [dir, spd];
}

// Three samples per non-pattern leg: start wp, geodesic midpoint, end wp.
/** Three sample points per leg - start, midpoint, end - for every flight.
 *  Takes the flight list and the leg start-time map as ARGUMENTS: they are
 *  app state owned by the page, and reading them off the ambient scope is
 *  what made this module unusable outside a browser.
 *  @param {Flight[]} flights @param {Record<string, number>} [legStartTimes]
 *  @returns {WindSamplePoint[]} three per non-pattern leg */
export function buildWindSamplePoints(flights, legStartTimes) {
  /** @type {WindSamplePoint[]} */
  const pts = [];
  (flights || []).forEach((/** @type {Flight} */ fl, /** @type {number} */ fIdx) => {
    for (let i = 0; i < fl.waypoints.length - 1; i++) {
      const from = fl.waypoints[i], to = fl.waypoints[i + 1];
      if (from.isPattern || to.isPattern) continue;
      const segs = pathSegments(from, to);
      if (segs.length === 0) continue;
      const totalD = segs.reduce((a2, s2) => a2 + s2.distNM, 0);
      const mid = pointAlongSegments(segs, totalD / 2);
      const legKey = fIdx + '-' + i;
      const offsetMin = (legStartTimes && legStartTimes[legKey]) || 0;
      [[from.lat, from.lng], [mid.lat, mid.lng], [to.lat, to.lng]].forEach(([lat, lng]) => {
        pts.push({ legKey, fIdx, i, lat, lng, altFt: to.alt, offsetMin });
      });
    }
  });
  return pts;
}

/** @param {WindSamplePoint[]} pts @param {string} dateStr "YYYY-MM-DD"
 *  @param {string} [modelId] @returns {string} */
export function buildOpenMeteoUrl(pts, dateStr, modelId) {
  const vars = ['wind_speed_10m', 'wind_direction_10m', 'temperature_2m'];
  OM_LEVELS.forEach(L => vars.push(
    `wind_speed_${L}hPa`, `wind_direction_${L}hPa`,
    `temperature_${L}hPa`, `geopotential_height_${L}hPa`));
  return 'https://api.open-meteo.com/v1/forecast'
    + '?latitude=' + pts.map(p => p.lat.toFixed(4)).join(',')
    + '&longitude=' + pts.map(p => p.lng.toFixed(4)).join(',')
    + '&hourly=' + vars.join(',')
    + '&wind_speed_unit=kn'
    + '&timezone=auto'
    + `&start_date=${dateStr}&end_date=${dateStr}`
    + (modelId && modelId !== 'best_match' ? `&models=${modelId}` : '');
}

// Vertical interpolation through the model column, wind via u/v components
// so direction interpolates correctly across the 360-degree wrap.
/** @param {WindLevel[]} profile the model column, lowest level first
 *  @param {number} targetM geopotential height, metres
 *  @returns {WindAtPoint|null} */
export function interpolateWindProfile(profile, targetM) {
  if (!profile.length) return null;
  if (targetM <= profile[0].h) return { dir: profile[0].dir, spd: profile[0].spd, temp: profile[0].temp };
  const top = profile[profile.length - 1];
  if (targetM >= top.h) return { dir: top.dir, spd: top.spd, temp: top.temp };
  for (let k = 0; k < profile.length - 1; k++) {
    const a = profile[k], b = profile[k + 1];
    if (targetM >= a.h && targetM <= b.h) {
      const f = (targetM - a.h) / (b.h - a.h || 1);
      const [ua, va] = windToUV(a.dir, a.spd);
      const [ub, vb] = windToUV(b.dir, b.spd);
      const [dir, spd] = uvToWind(ua + f * (ub - ua), va + f * (vb - va));
      const temp = (a.temp != null && b.temp != null) ? a.temp + f * (b.temp - a.temp) : (b.temp != null ? b.temp : a.temp);
      return { dir, spd, temp };
    }
  }
  return { dir: top.dir, spd: top.spd, temp: top.temp };
}

// Blend the columns at floor/ceil of a fractional forecast hour in u/v
// space, so a 09:30 ETD uses half of 09:00 and half of 10:00 rather than
// snapping to the nearest hour.
/** @param {any} loc one Open-Meteo location response
 *  @param {number} hourFloat fractional forecast hour @param {number} altFt
 *  @returns {WindAtPoint|null} */
export function extractPointWeather(loc, hourFloat, altFt) {
  const h0 = Math.max(0, Math.min(23, Math.floor(hourFloat)));
  const h1 = Math.min(23, h0 + 1);
  const f = Math.max(0, Math.min(1, hourFloat - h0));
  const a = extractPointWeatherAt(loc, h0, altFt);
  if (f < 0.001 || h1 === h0) return a;
  const b = extractPointWeatherAt(loc, h1, altFt);
  if (!a) return b;
  if (!b) return a;
  const [ua, va] = windToUV(a.dir, a.spd);
  const [ub, vb] = windToUV(b.dir, b.spd);
  const [dir, spd] = uvToWind(ua + f * (ub - ua), va + f * (vb - va));
  const temp = (a.temp != null && b.temp != null) ? a.temp + f * (b.temp - a.temp) : (a.temp != null ? a.temp : b.temp);
  return { dir, spd, temp };
}

// One location's column at one whole forecast hour -> wind/temp at altFt.
/** @param {any} loc @param {number} hourIdx @param {number} altFt
 *  @returns {WindAtPoint|null} */
export function extractPointWeatherAt(loc, hourIdx, altFt) {
  const H = loc.hourly || {};
  const groundH = (typeof loc.elevation === 'number' ? loc.elevation : 0) + 10;
  const prof = [];
  if (H.wind_speed_10m && H.wind_direction_10m &&
      H.wind_speed_10m[hourIdx] != null && H.wind_direction_10m[hourIdx] != null) {
    prof.push({ h: groundH, dir: H.wind_direction_10m[hourIdx], spd: H.wind_speed_10m[hourIdx],
                temp: H.temperature_2m ? H.temperature_2m[hourIdx] : null });
  }
  OM_LEVELS.forEach(L => {
    const gh = H[`geopotential_height_${L}hPa`], ws = H[`wind_speed_${L}hPa`],
          wd = H[`wind_direction_${L}hPa`], t = H[`temperature_${L}hPa`];
    if (gh && ws && wd && gh[hourIdx] != null && ws[hourIdx] != null &&
        wd[hourIdx] != null && gh[hourIdx] > groundH) {
      prof.push({ h: gh[hourIdx], dir: wd[hourIdx], spd: ws[hourIdx],
                  temp: t ? t[hourIdx] : null });
    }
  });
  prof.sort((a, b) => a.h - b.h);
  return interpolateWindProfile(prof, altFt * 0.3048);
}

/** Smallest angle between two bearings, degrees 0-180 - so 350 and 010 are
 *  20 apart, not 340.
 *  @param {number} a @param {number} b @returns {number} */
export function angleDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}
