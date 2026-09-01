/// <reference lib="webworker" />

// In a worker `self` is a ServiceWorkerGlobalScope, not a Window. Everything
// worker-specific goes through this alias so the difference is visible.
// NOTE: tools/build.mjs replaces the literal `sw.__APP_VERSION__ || 'dev'`
// below with the real version, and FAILS the build if it cannot find it.
const sw = /** @type {any} */ (self);

/** @type {string|null} the live AIRAC cycle, once the page has told us */
let knownEdition = null;

/**
 * Service worker for the hosted planner.
 *
 * This file only ever runs on a SECURE CONTEXT (https:, or http://localhost).
 * On a plain-http LAN address - the "host it off my laptop over wifi or a
 * phone hotspot" case - browsers refuse to register a service worker at all,
 * so the page must work without it. Nothing here is load-bearing: every
 * cache lookup falls through to the network, and the registration in the
 * page is feature-detected.
 *
 * Two caches, deliberately separate:
 *
 *  - SHELL: the app itself (page + bundle). Precached on install so the
 *    planner opens with no network once it has been visited. Keyed by
 *    APP_VERSION, so a new release drops the old shell.
 *
 *  - TILES: ICAO VFR chart tiles from Avinor, keyed by the CHART EDITION
 *    (the AIRAC cycle in the mosaic layer name, e.g. AIRAC_19MAR26) and NOT
 *    by app version. An app release must not throw away a chart the pilot
 *    already downloaded, and a new AIRAC cycle MUST throw it away. A stale
 *    chart is a safety problem; a stale app is an inconvenience.
 *
 * THE STALE-CHART RULE: tile URLs do not carry the edition - the same URL
 * returns whatever cycle Avinor currently publishes. So a cached tile is
 * only trustworthy once we know which cycle it belongs to. Until the page
 * tells us the edition (it reads it from the service and posts it here),
 * tiles are fetched live and NOT cached, and nothing is ever served out of
 * a tile cache. Being slow is acceptable; showing last cycle's airspace is
 * not.
 */

const APP_VERSION = sw.__APP_VERSION__ || 'dev';
const SHELL_CACHE = `c182-shell-v${APP_VERSION}`;
const TILE_PREFIX = 'c182-tiles-';
const SHELL_ASSETS = ['./', './index.html', './app.js'];

// Chart tiles come only from this host; nothing else is cached at runtime.
const TILE_HOST = 'avigis.avinor.no';

// A cap so a few sessions of panning cannot fill the origin's storage quota
// and get the whole cache evicted, shell included.
const TILE_LIMIT = 400;

// knownEdition is declared at the top: null = we do not yet know which AIRAC
// cycle is live, so no tile may be read from or written to a cache.

const sanitize = (/** @type {any} */ s) => String(s).replace(/[^A-Za-z0-9_-]/g, '');

sw.addEventListener('install', (/** @type {any} */ event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      // addAll is atomic: one 404 and nothing is cached, which is what we
      // want - a half-cached shell is worse than none.
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => sw.skipWaiting())
      .catch(() => sw.skipWaiting())
  );
});

sw.addEventListener('activate', (/** @type {any} */ event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.map((/** @type {string} */ name) =>
        // drop old shells; never touch tile caches here, those are retired
        // by edition rather than by app release
        (name.startsWith('c182-shell-') && name !== SHELL_CACHE) ? caches.delete(name) : null
      )))
      .then(() => sw.clients.claim())
  );
});

/** The page reports the live AIRAC edition once it has read it. */
sw.addEventListener('message', (/** @type {any} */ event) => {
  const data = event.data || {};
  if (data.type !== 'chart-edition' || !data.edition) return;
  knownEdition = sanitize(data.edition);
  const keep = TILE_PREFIX + knownEdition;
  event.waitUntil(
    caches.keys().then((names) => Promise.all(names.map((/** @type {string} */ name) =>
      (name.startsWith(TILE_PREFIX) && name !== keep) ? caches.delete(name) : null
    )))
  );
});

/** Bound a cache by trimming oldest-first (Cache API keys are insertion-ordered). */
/** @param {Cache} cache @param {number} limit */
async function trim(cache, limit) {
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  await Promise.all(keys.slice(0, keys.length - limit).map((/** @type {Request} */ k) => cache.delete(k)));
}

/** Cache-first, but only within a known edition. A chart cycle is immutable,
 *  so once a tile is held for THIS cycle there is no reason to ask again. */
/** @param {Request} request */
async function tileFirst(request) {
  const cache = await caches.open(TILE_PREFIX + knownEdition);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  // Opaque responses (no CORS) still cache and still render in an <img>;
  // only store real successes, never an error page.
  if (response && (response.ok || response.type === 'opaque')) {
    await cache.put(request, response.clone());
    await trim(cache, TILE_LIMIT);
  }
  return response;
}

/** @param {Request} request */
async function shellFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const hit = await caches.match(request);
    if (hit) return hit;
    throw err;
  }
}

sw.addEventListener('fetch', (/** @type {any} */ event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try { url = new URL(request.url); } catch (e) { return; }

  if (url.hostname === TILE_HOST) {
    // Only the chart raster is worth holding. The edition metadata is a tiny
    // JSONP call that must stay live, or a new cycle would never be noticed.
    if (!url.pathname.endsWith('/export')) return;
    if (!knownEdition) return;          // edition unknown -> straight to the network
    event.respondWith(tileFirst(request));
    return;
  }

  // Same-origin app shell. Live data (winds) is cross-origin and is left
  // alone: a cached forecast is a wrong forecast.
  if (url.origin === sw.location.origin) {
    event.respondWith(shellFirst(request));
  }
});
