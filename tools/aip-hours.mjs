/**
 * Read Avinor's "Operational Hours" page - pure, no fetch (v17.0).
 *
 * The page is one table per service ("AD 2.3 Operational hours: ATS", ...:
 * Admin, Customs, MET, ATS, Fuel, Handling, Security, De-icing, AD 2.6 rescue
 * and fire fighting, AD 3.3/6 heliports). Each aerodrome's entry is its own
 * `<tbody id="<ICAO>_<table>">` - the SOURCE's identifier, so nothing is
 * assigned by row position - holding a row of AIRPORT | ICAO | HR and a row of
 * "RMK:" | text.
 *
 * Only the TEXT is read here. Decoding it is src/lib/opshours.js's job, so the
 * planner and the importer share one reader of the notation.
 */

/** @param {string} s */
function clean(s) {
  return s.replace(/<br\s*\/?>/gi, ' / ').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}

const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };

/**
 * @param {string} html the whole page
 * @param {string} [table] the id suffix, "ATS" by default
 * @returns {{revisedAirac: string|null, entries: Record<string, {name: string, hours: string, rmk: string}>}}
 */
export function parseOpsHoursPage(html, table = 'ATS') {
  const text = String(html || '');
  // "Revised per AIRAC 03 SEP 2026" - the cycle these hours belong to, compared
  // with the AIP edition before anything is merged.
  const rev = clean(text).match(/Revised per AIRAC (\d{2}) ([A-Z]{3}) (\d{4})/);
  const revisedAirac = rev && MONTHS[rev[2]]
    ? rev[3] + '-' + String(MONTHS[rev[2]]).padStart(2, '0') + '-' + rev[1] : null;
  /** @type {Record<string, {name: string, hours: string, rmk: string}>} */
  const entries = {};
  const re = new RegExp('<tbody id="(EN[A-Z]{2})_' + table + '">([\\s\\S]*?)</tbody>', 'g');
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const rows = [...m[2].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((r) =>
      [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => clean(c[1])));
    const main = rows.find((r) => r.length >= 3 && r[1] === m[1]);
    if (!main) continue;
    const rmkRow = rows.find((r) => r.length >= 2 && /^RMK:?$/.test(r[0]));
    entries[m[1]] = { name: main[0], hours: main[2], rmk: rmkRow && rmkRow[1] !== 'NIL' ? rmkRow[1] : '' };
  }
  return { revisedAirac, entries };
}
