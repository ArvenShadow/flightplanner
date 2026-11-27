/**
 * NOTAM relay - a Cloudflare Worker (v17.28).
 *
 * WHY IT EXISTS. The planner is a static page. No NOTAM source lets a page on
 * another site read it (ippc.no and autorouter's API both answer without an
 * Access-Control-Allow-Origin header - measured), and autorouter's API logs in
 * with an account password that can never sit in a public page. So one small
 * function stands between them: it holds the login, asks autorouter for the
 * NOTAMs of the aerodromes the planner names, and hands the answer back.
 *
 * WHERE THE NOTAMs COME FROM. autorouter imports them from Eurocontrol's EAD,
 * the official European source, and states its database is updated in real
 * time (https://www.autorouter.aero/wiki/api/notam/). This relay stores
 * NOTHING and answers `no-store`: every request is a live request. A stale
 * NOTAM is a wrong NOTAM.
 *
 * WHAT IT IS NOT. An official briefing. The planner says so beside every list.
 *
 * THE API IT CALLS, as documented at https://www.autorouter.aero/wiki/api/ :
 *   POST https://api.autorouter.aero/v1.0/oauth2/token
 *        grant_type=client_credentials, client_id=<email>, client_secret=<password>
 *        -> an access token "valid for some time (one hour presently)"
 *   GET  https://api.autorouter.aero/v1.0/notam?itemas=["ENTC"]&offset=0&limit=100
 *        -> { total, rows: [...] }, at most 100 rows a call
 * The autorouter account must have API access enabled (a support ticket).
 *
 * NOT YET RUN AGAINST THE LIVE SERVICE when this was written - that needs the
 * owner's account. It is built to the documentation above and tested against
 * its documented shapes; the first real fetch is the real test.
 *
 * SECRETS (Cloudflare, set by .github/workflows/relay.yml from GitHub secrets):
 *   AUTOROUTER_USER, AUTOROUTER_PASS, RELAY_KEY
 * VARIABLE (wrangler.toml): ALLOWED_ORIGINS, a comma-separated list.
 */

export const API = 'https://api.autorouter.aero/v1.0';
/** Aerodromes or FIRs in one request. A plan has a handful. */
export const MAX_LOCATIONS = 12;
/** autorouter's documented maximum rows per call. */
export const PAGE = 100;
/** A FIR can carry several hundred NOTAMs; this is where the relay stops and
 *  SAYS it stopped (`truncated`), rather than loop on a bad `total`. */
export const MAX_PAGES = 15;

/** The one cached thing: the login token, in memory, until just before it
 *  expires. NOTAMs are never cached. @type {{token: string, until: number}|null} */
let session = null;
export function forgetSession() { session = null; }

/** Four-letter location indicators, upper-cased, de-duplicated.
 *  @param {string|null} raw @returns {string[]|null} null when the list is not usable */
export function parseLocations(raw) {
  const parts = String(raw || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const out = [...new Set(parts)];
  if (!out.length || out.length > MAX_LOCATIONS) return null;
  if (!out.every((s) => /^[A-Z]{4}$/.test(s))) return null;
  return out;
}

/** Is this Origin one of ours? `http://localhost:*` in the list allows any port.
 *  @param {string|null} origin @param {string} allowed @returns {boolean} */
export function originAllowed(origin, allowed) {
  if (!origin) return false;
  for (const a of String(allowed || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    if (a === origin) return true;
    if (a.endsWith(':*') && origin.startsWith(a.slice(0, -1)) && /^\d+$/.test(origin.slice(a.length - 1))) return true;
  }
  return false;
}

/** Compare without stopping at the first difference. @param {string} a @param {string} b */
export function sameKey(a, b) {
  const x = String(a || ''), y = String(b || '');
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0 && x.length > 0;
}

/** @param {any} body @param {number} status @param {Record<string,string>} cors */
function json(body, status, cors) {
  return new Response(JSON.stringify(body), { status, headers: {
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors } });
}

/** @param {any} env @param {typeof fetch} doFetch @returns {Promise<string>} */
async function login(env, doFetch) {
  if (session && session.until > Date.now()) return session.token;
  const r = await doFetch(API + '/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials',
      client_id: env.AUTOROUTER_USER, client_secret: env.AUTOROUTER_PASS }).toString()
  });
  if (!r.ok) throw new Error('login refused (HTTP ' + r.status + ')');
  const t = await r.json();
  if (!t || typeof t.access_token !== 'string' || !t.access_token) throw new Error('login gave no token');
  const life = Number(t.expires_in) > 0 ? Number(t.expires_in) : 3600;
  session = { token: t.access_token, until: Date.now() + Math.max(60, life - 120) * 1000 };
  return session.token;
}

/** Every NOTAM for these locations, page by page.
 *  @param {string[]} locations @param {any} env @param {typeof fetch} doFetch */
export async function fetchNotams(locations, env, doFetch) {
  /** @type {any[]} */ const rows = [];
  let total = 0, truncated = false;
  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES) { truncated = true; break; }
    const url = API + '/notam?itemas=' + encodeURIComponent(JSON.stringify(locations)) +
      '&offset=' + page * PAGE + '&limit=' + PAGE;
    let r = await doFetch(url, { headers: { authorization: 'Bearer ' + await login(env, doFetch) } });
    if (r.status === 401) {          // the token died early: log in once more, once
      forgetSession();
      r = await doFetch(url, { headers: { authorization: 'Bearer ' + await login(env, doFetch) } });
    }
    if (!r.ok) throw new Error('NOTAM request refused (HTTP ' + r.status + ')');
    const body = await r.json();
    if (!body || !Array.isArray(body.rows)) throw new Error('NOTAM answer is not in the documented form');
    total = Number(body.total) || 0;
    rows.push(...body.rows);
    if (!body.rows.length || rows.length >= total) break;
  }
  return { total, rows, truncated };
}

/** @param {Request} request @param {any} env @param {typeof fetch} [doFetch] */
export async function handle(request, env, doFetch = fetch) {
  const origin = request.headers.get('origin');
  const ok = originAllowed(origin, env.ALLOWED_ORIGINS);
  /** @type {Record<string,string>} */
  const cors = ok ? { 'access-control-allow-origin': /** @type {string} */ (origin), vary: 'Origin' } : {};
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: ok ? 204 : 403, headers: { ...cors,
      'access-control-allow-methods': 'GET', 'access-control-allow-headers': 'x-relay-key',
      'access-control-max-age': '86400' } });
  }
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.pathname !== '/notam') return json({ error: 'not found' }, 404, cors);
  // THE KEY IS THE GATE. The origin check only stops another website's page;
  // anything that is not a browser can send any Origin it likes.
  if (!env.RELAY_KEY || !sameKey(request.headers.get('x-relay-key') || '', env.RELAY_KEY)) {
    return json({ error: 'wrong or missing relay key' }, 401, cors);
  }
  const locations = parseLocations(url.searchParams.get('icao'));
  if (!locations) {
    return json({ error: 'icao must be 1-' + MAX_LOCATIONS + ' four-letter location indicators, comma separated' }, 400, cors);
  }
  if (!env.AUTOROUTER_USER || !env.AUTOROUTER_PASS) return json({ error: 'the relay has no autorouter login configured' }, 500, cors);
  try {
    const got = await fetchNotams(locations, env, doFetch);
    return json({ source: 'autorouter (Eurocontrol EAD)', fetchedAtUtc: new Date().toISOString(),
      requested: locations, total: got.total, truncated: got.truncated, notams: got.rows }, 200, cors);
  } catch (e) {
    // The message names what failed and never what was sent.
    return json({ error: 'autorouter: ' + String((e && /** @type {any} */ (e).message) || 'request failed') }, 502, cors);
  }
}

export default { fetch: (/** @type {Request} */ request, /** @type {any} */ env) => handle(request, env) };
