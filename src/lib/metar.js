/**
 * METAR and TAF from MET Norway - src/lib/metar.js (v16.21).
 *
 * SOURCE (verified before building, Sep 2026):
 *   https://api.met.no/weatherapi/tafmetar/1.0/{metar,taf}?icao=ENDU,ENTC
 *   - the OFFICIAL Norwegian met service, and therefore the authoritative
 *     source for Norwegian aerodromes;
 *   - sends `access-control-allow-origin: *`, so a browser page may read it.
 *     aviationweather.gov (the American source, recorded in CLAUDE.md as
 *     "CORS never verified") was re-checked at the same time and sends NO
 *     such header - it is genuinely unusable from a browser;
 *   - accepts comma-separated ICAO ids, so a whole route costs one request;
 *   - returns the last 24 hours, oldest first, one report per line, each
 *     line beginning with its station id;
 *   - accepted a normal browser User-Agent (200). fetch() cannot set a
 *     custom User-Agent - it is a forbidden header - so that mattered.
 *   - Licence: Norwegian Licence for Open Government Data (NLOD) 2.0,
 *     credit to The Norwegian Meteorological Institute. The page carries it.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: decode the whole report. A METAR
 * carries RVR, wind shear, runway state, CAVOK, NSC, vertical visibility,
 * recent and forecast phenomena - and a decoder that silently gets one of
 * them wrong is exactly the plausible wrong answer this project refuses to
 * give. The RAW text is what a pilot is trained to read and is always shown
 * in full; only these unambiguous fields are pulled out, as a convenience:
 * report time, wind, temperature/dew point and QNH. Anything unrecognised
 * is left alone rather than guessed at.
 *
 * Pure: no DOM, no fetch. The page performs the request and renders.
 */

export const METAR_BASE = 'https://api.met.no/weatherapi/tafmetar/1.0/';

/** MET Norway asks that clients identify themselves and credit the data. */
export const METAR_ATTRIBUTION = 'MET Norway (Norwegian Meteorological Institute), NLOD 2.0';

/**
 * @param {string[]} icaos 4-letter ICAO ids
 * @param {'metar'|'taf'} kind
 * @returns {string} request URL, or '' when there is nothing to ask for
 */
export function buildTafMetarUrl(icaos, kind) {
  const list = (icaos || []).filter(isIcao);
  if (!list.length) return '';
  return METAR_BASE + (kind === 'taf' ? 'taf' : 'metar') + '?icao=' + list.join(',');
}

/** A 4-letter ICAO location indicator, e.g. ENDU. Waypoint names that are
 *  not aerodromes (FINNSNES, a lake, a bend in a valley) have no reports.
 *  @param {string} name @returns {boolean} */
export function isIcao(name) {
  return typeof name === 'string' && /^[A-Z]{4}$/.test(name.trim().toUpperCase());
}

/**
 * The aerodromes worth asking about: the first and last real waypoint of
 * every flight, which is every takeoff and every landing - the same rule the
 * daylight card uses. De-duplicated, order preserved.
 * @param {Flight[]} flights
 * @returns {string[]}
 */
export function routeAerodromes(flights) {
  /** @type {string[]} */
  const out = [];
  for (const fl of flights || []) {
    const real = (fl.waypoints || []).filter(w => !w.isPattern && w.name);
    if (!real.length) continue;
    for (const w of [real[0], real[real.length - 1]]) {
      const id = String(w.name).trim().toUpperCase();
      if (isIcao(id) && !out.includes(id)) out.push(id);
    }
  }
  return out;
}

/**
 * Split the response into the LATEST report per station.
 *
 * The service returns the last 24 hours oldest-first, so the last line for a
 * station is the current one. A "NIL" report means the station filed nothing
 * and is treated as no report rather than as data.
 *
 * @param {string} text raw response body
 * @returns {Record<string, string>} ICAO -> raw report line
 */
export function latestPerStation(text) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const line of String(text || '').split('\n')) {
    const raw = line.trim().replace(/=$/, '').trim();
    if (!raw) continue;
    const m = raw.match(/^([A-Z]{4})\b/);
    if (!m) continue;
    if (/\bNIL\b/.test(raw)) continue;
    out[m[1]] = raw;             // later lines overwrite earlier ones
  }
  return out;
}

/**
 * Pull out the few fields that cannot be misread. Everything else stays in
 * `raw`, which is what should be displayed.
 *
 * @param {string} raw one report line
 * @returns {WeatherReport}
 */
export function parseReport(raw) {
  const text = String(raw || '').trim();
  /** @type {WeatherReport} */
  const out = {
    raw: text, icao: null, timeUTC: null, wind: null,
    tempC: null, dewC: null, qnhHpa: null, isTaf: false
  };
  if (!text) return out;

  const icao = text.match(/^([A-Z]{4})\b/);
  if (icao) out.icao = icao[1];

  // DDHHMMZ - day of month, hour, minute, always UTC
  const t = text.match(/\b(\d{2})(\d{2})(\d{2})Z\b/);
  if (t) out.timeUTC = { day: +t[1], hour: +t[2], minute: +t[3] };

  // A TAF carries a validity period DDHH/DDHH; a METAR never does.
  out.isTaf = /\b\d{4}\/\d{4}\b/.test(text);

  // Wind: dddffKT, dddffGggKT, VRBffKT, or 00000KT for calm. Norwegian
  // reports are in knots; anything in MPS is left undecoded rather than
  // silently converted.
  const w = text.match(/\b(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?KT\b/);
  if (w) {
    const speedKt = +w[2];
    out.wind = {
      dir: w[1] === 'VRB' ? null : +w[1],
      variable: w[1] === 'VRB',
      calm: w[1] === '000' && speedKt === 0,
      speedKt,
      gustKt: w[3] ? +w[3] : null
    };
  }

  // Temperature/dew point, M prefix for negative. Only on a METAR.
  const td = text.match(/\s(M?\d{2})\/(M?\d{2})\b/);
  if (td && !out.isTaf) {
    const num = (/** @type {string} */ v) => (v[0] === 'M' ? -Number(v.slice(1)) : Number(v));
    out.tempC = num(td[1]);
    out.dewC = num(td[2]);
  }

  // QNH in hectopascals. An A-prefixed inHg altimeter (US practice) is NOT
  // converted here - Norwegian reports use Q, and a wrong altimeter setting
  // is not an error worth risking for convenience.
  const q = text.match(/\bQ(\d{4})\b/);
  if (q) out.qnhHpa = +q[1];

  return out;
}

/**
 * How old an observation is, in minutes.
 *
 * A METAR carries only day-of-month, hour and minute, so the month and year
 * come from the clock. The report is taken to be the most recent instant
 * matching that day and time which is not in the future, allowing a few
 * minutes of clock skew - which is what makes it work across a month
 * boundary, when the report's day number is larger than today's.
 *
 * Age matters enough to compute: a three-hour-old observation is not the
 * current weather, and the card has to be able to say so.
 *
 * @param {{day: number, hour: number, minute: number}|null} timeUTC
 * @param {number} [nowMs]
 * @returns {number|null} whole minutes, or null when the time is unknown
 */
export function reportAgeMinutes(timeUTC, nowMs) {
  if (!timeUTC) return null;
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  const d = new Date(now);
  const SKEW_MIN = 10;
  for (let back = 0; back < 3; back++) {
    const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, timeUTC.day,
                       timeUTC.hour, timeUTC.minute);
    const ageMin = (now - t) / 60000;
    if (ageMin >= -SKEW_MIN) return Math.round(ageMin);
  }
  return null;
}

/** "12 min ago" / "3 h 05 min ago", or null when the age is unknown.
 *  @param {number|null} ageMin @returns {string|null} */
export function formatAge(ageMin) {
  if (ageMin === null || !isFinite(ageMin)) return null;
  if (ageMin < 0) return 'just issued';
  if (ageMin < 60) return ageMin + ' min ago';
  const h = Math.floor(ageMin / 60), m = ageMin % 60;
  return h + ' h ' + String(m).padStart(2, '0') + ' min ago';
}

/**
 * An observation this old should not be read as current conditions. METARs
 * are issued half-hourly at most Norwegian aerodromes, so anything beyond
 * about 90 minutes means the station has stopped reporting or you are
 * looking at the tail of the archive.
 */
export const STALE_AFTER_MIN = 90;

/** @param {number|null} ageMin @returns {boolean} */
export function isStale(ageMin) {
  return ageMin !== null && isFinite(ageMin) && ageMin > STALE_AFTER_MIN;
}

/** A one-line summary of the decoded fields, for the card. Returns '' when
 *  nothing could be decoded - in which case the raw text stands alone.
 *  @param {WeatherReport} p @returns {string} */
export function summariseReport(p) {
  const bits = [];
  if (p.wind) {
    if (p.wind.calm) bits.push('wind calm');
    else {
      const dir = p.wind.variable ? 'VRB' : String(p.wind.dir).padStart(3, '0') + '°';
      bits.push('wind ' + dir + ' ' + p.wind.speedKt + ' kt' +
        (p.wind.gustKt ? ' gusting ' + p.wind.gustKt : ''));
    }
  }
  if (p.tempC !== null) bits.push(p.tempC + '°C' + (p.dewC !== null ? '/' + p.dewC + '°C dew' : ''));
  if (p.qnhHpa !== null) bits.push('QNH ' + p.qnhHpa);
  return bits.join(' · ');
}
