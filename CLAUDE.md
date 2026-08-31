# C182 Flight Planner — project memory

Single-file HTML VFR flight planner for Cessna 182T NAV III (LN-TRA…LN-TRE),
built for a flight school in Tromsø. Developed iteratively with Claude in
claude.ai; this repo is the continuation point for Claude Code.

## The two non-negotiable rules

1. **GROUND PLANNING ONLY.** This tool is never used in the air. Reject or
   deprioritize any feature that only helps in flight (timers, own-ship,
   cockpit themes). Everything must serve pre-flight planning at a desk.
2. **NO GUESSTIMATES.** Every value, formula, API endpoint, and dataset is
   verified against an authoritative source (POH, the school's Excel OFP,
   official API docs) BEFORE implementation. If verification fails, the
   feature is not built — an honest "no" beats a plausible wrong answer.
   When data may be outdated or unofficial, say so in the UI and the guide.

## Architecture (deliberate, do not "modernize")

- **v16.14 (user decision, premise changed AGAIN): the planner is now
  HOSTED as well.** The user asked for GitHub Pages plus the ability to
  serve it on the local wifi or a phone hotspot. `tools/build.mjs` emits
  TWO deliveries from one source: `dist/C182_FlightPlanner.html` (the
  double-click file, unchanged) and `site/` (index.html + app.js + sw.js,
  deployed by .github/workflows/pages.yml, served locally by
  `npm run serve`). `site/` is gitignored; `dist/` stays committed.
  - The single-file artifact is STILL a supported delivery and must keep
    working - it is the fallback on a machine that has never seen the app.
  - Both deliveries use the SAME classic-script IIFE bundle. For site/
    that is not inertia: the page script is a classic script whose top
    level calls setAircraftProfile() and whose 61 inline on*= handlers
    need its functions as globals. A `type="module"` script is DEFERRED,
    so it would run AFTER the page script - too late. site/ can move to a
    real module graph only once Phase 1 has extracted the page script and
    the handlers are bound in code. Do not "just add type=module".
  - SERVICE WORKER (src/sw.js) is the whole point of hosting: a file://
    page cannot register one, so chart tiles could never be cached. It
    only runs on a secure context - HTTPS or localhost - so the
    plain-http LAN case (phone on the hotspot) works but caches nothing.
    Registration is feature-detected; nothing about the worker is
    load-bearing.
  - THE STALE-CHART RULE: tile URLs do NOT carry the AIRAC cycle, so the
    same URL returns whatever Avinor currently publishes. The worker
    therefore refuses to read or write a tile cache until the page posts
    the live edition (from the JSONP layer name). Tile caches are keyed
    by cycle and retired by cycle - an app release must not discard a
    downloaded chart, and a new cycle MUST. Weather is never cached: a
    cached forecast is a wrong forecast. jsdom cannot test any of this;
    `tools/verify-hosted.mjs` drives real Chromium and asserts all four
    rules, and test.js guards the structure they depend on.
- The single-file artifact: ONE self-contained HTML file, opened by
  double-click, offline except live-data features. Vanilla JS, Leaflet inlined, Kartverket topo tiles.
- v16.8 restructure (user decision, premise changed): the single file is
  now BUILT, not hand-edited. Source lives in `src/` (`index.html` = page
  + shrinking inline script; `src/lib/*.js` = extracted modules);
  `tools/build.mjs` bundles `src/main.js` with esbuild as a CLASSIC
  script (`--format=iife`), inlines it at the `@BUNDLE` marker and
  refuses to write `dist/` unless both scripts parse, DOM ids are unique
  and APP_VERSION matches package.json. `dist/` is committed so a plain
  download still runs with no tooling.
  - WHY classic and not ES modules: browsers BLOCK ES modules on file://
    pages (verified in Chromium: net::ERR_FAILED); classic scripts load.
    This is also why bulk data ships as `data/*.js` sidecars, never
    fetch()ed. Do not "modernize" the bundle format.
  - The old rationale for hand-editing one file (zero-install handout to
    the flight school) EXPIRED: the user no longer distributes it there.
    The goal is a typed, modular, test-per-module codebase while the
    artifact stays double-clickable.
  - Migration order: extract module -> delete from the page script ->
    leave a `-> src/lib/x.js` pointer comment -> module unit tests + an
    equality test against the built page.
  - Phase 1 progress: `performance.js` (POH climb/cruise tables, isaTemp,
    climbPerf, cruisePerf, calcWCA) and `format.js` (formatTimeHHMM,
    toDMM, clockFromMinutes) are out; the page script is down from 5121
    to 4922 lines. Still inline: map setup, base chart, leg engine,
    altitude schedule, map interactions, winds, table rendering, modals,
    integrity check, plotting list, storage.
  - HIDDEN GLOBALS ARE THE TRAP when extracting. `performance.js` read
    `aircraftProfile`, which is declared `let` at the top level of the
    page script: that is a global LEXICAL binding, shared with the
    bundle's IIFE, so it resolved in the browser and every page test
    passed - but `require()`ing the module threw. The rule: a module
    takes what it needs as an argument or through an explicit injector
    (`setAircraftProfile(ref)`, called once where the page declares the
    object), never off the ambient scope. Grepping for `document.` is
    NOT enough to prove a slice is pure; requiring it in bare Node is. `src/main.js` puts every export
    on `window` (and `window.C182`) so not-yet-migrated inline code and
    the test suite keep working during the move.
  - Bundling made real libraries possible; prefer an authoritative one
    over a hand-rolled approximation when it is verifiable (see Geodesy
    and MagVar below).
- The user explicitly evaluated alternatives and rejected a dev-server
  architecture: a friend's React+Vite planner needs `pnpm dev` to run,
  while this one stays a file you open.
- User data (routes, settings) lives in browser localStorage plus manual
  JSON export/import. Personal data must NEVER leak into exports.

## Editing discipline (this is how quality was maintained)

1. Make edits with unique-anchor string replacement (in Claude Code: the
   Edit tool with old_str asserted unique — same idea as the python
   `assert s.count(a)==1` scripts used previously).
2. After every edit: syntax-check the main script block
   (`node --check` on the extracted last <script>), then `npm test`.
3. Every feature ships with tests in `test.js` (jsdom + Leaflet stub).
   140 tests pass at v16.2. Never ship with failures. Add tests for new
   behavior AND for removals (guard that removed features stay removed).
4. Check for duplicate DOM ids before shipping.
5. Version naming: vMAJOR.MINOR in the filename the user receives.

## Test harness notes

- `npm install` then `npm test` (which BUILDS first). Requires Node 18+.
- Tests load `dist/C182_FlightPlanner.html` via the APP_HTML constant, so
  source-level guard greps keep working wherever code currently lives.
  Extracted modules also get pure `require()` unit tests with no jsdom,
  plus an equality test proving module and built page agree.
- WARNING when scripting edits: `open(p,'w').write(open(p).read()...)`
  TRUNCATES the file before the read runs. It silently emptied CLAUDE.md
  once. Read fully into a variable first, then open for write.
- test.js stubs Leaflet (captures polyline/marker/tileLayer args) and
  loads the HTML via jsdom. jsdom quirk: innerText is undefined until
  set, and does not coerce numbers — app code writes String(v); tests
  use the txtOf() helper.
- Seed route: ENDU → FINNSNES → ENTC (leg 1 climb 254→2500 ft).
- `c182_flight_routes.json` is a test fixture (import/export round-trip).

## Domain decisions already settled (do not relitigate silently)

- **Geodesy (v16.9, superseded the spherical model)**: exact WGS-84
  geodesics via GeographicLib (`geographiclib-geodesic`, Karney's
  reference algorithm) in `src/lib/geodesy.js`. The old spherical law of
  cosines was inside its audited <0.5%, but biased ONE way - short:
  -0.33% ENDU-ENTC, -0.37% ENDU-ENEV, -0.41% ENTC-ENKR. On the user's
  ENDU-ENSK-ENLK-ENEV-ENDU mission it under-reported 1.13 NM (0.37%),
  i.e. under-planned fuel. Tracks moved <=0.02 deg. Bundling a library
  only became possible once the build existed (v16.8). Note a degree of
  latitude is now 60.2 NM at 60N, not the spherical 60.0 - the tests
  assert the ellipsoidal values deliberately.
- **Winds aloft**: Open-Meteo (api.open-meteo.com), pressure levels
  1000–600 hPa, u/v vector averaging, 3 samples per leg, model selector
  incl. COMPARE3 spread report. CC BY attribution required. MET Nordic
  (api.met.no) was verified to have NO pressure-level data — rejected.
- **Airspace overlay**: built on openAIP tiles, then REMOVED at the
  user's request because community data lagged the current VFR chart.
  Verified there is no official alternative yet (Avinor AIXM downloads
  are only "planned"). Do not re-add without an official, current source.
  Init code purges old localStorage keys `c182_openaip_key` /
  `c182_airspace_on`; tests guard the feature's absence.
- **Terrain/elevation**: Kartverket høydedata API exists and is open
  (ws.geonorge.no/hoydedata/v1/punkt), but the user DECLINED elevation
  features. Chart contours + MEF remain the terrain reference.
- **Map**: locked to a single world copy (maxBounds ±180°, viscosity 1,
  noWrap on tiles). Kartverket tile URL is WMTS webmercator cache.
- **Mass & Balance**: out of scope — the user keeps M&B in their Excel
  OFP. Do not build M&B, fuel-requirement or POH takeoff/landing
  features into the planner.
- **Daylight / VFR day (v16.3)**: legal basis verified — SERA Art. 2(97)
  (Reg. (EU) 923/2012) defines night via civil twilight, sun centre 6°
  below the horizon; Norway's BSL F 1-1 (forskrift 2016-12-14-1578) was
  checked and prescribes NO other period, so −6° is the Norwegian day/
  night VFR boundary (not sunset). Solar math: NOAA/Meeus equations,
  validated ≤0.5 min against USNO almanac fixtures (encoded in test.js,
  ±2 min tolerance) incl. midnight sun, polar-night twilight window and
  deep polar night. Flight Date input deliberately NOT persisted (stale
  date must never show wrong sun times). 30-min ETA margin is labeled a
  planning margin, not a rule. Card defers to AIP Norge GEN 2.7.
  Multi-sector missions: EVERY takeoff and landing is checked at its own
  aerodrome on its own calendar date (STOP rows on the card); ETO/ETA
  strings mark midnight rollover with "+1".
- **MagVar (v16.9, the real WMM)**: `src/lib/magvar.js` uses the actual
  World Magnetic Model (`magvar` package, WMM2025 coefficients, valid
  2025-2030), replacing the regional polynomial. Measured against NOAA
  at epoch 2026.6438: <=0.005 deg error everywhere, versus the
  polynomial's 0.59-0.72 deg in Troms and -1.94 deg at ENGM. VAR feeds
  MH directly, so this is the heading actually flown. The polynomial's
  "refit around 2029-2030" debt is retired; instead `isWmmCurrent()`
  exists and a test asserts it, so the suite FAILS when WMM2025 expires
  in 2030 and the package needs updating. NOAA fixtures stay in test.js
  with a 0.02 deg tolerance. VAR cells remain editable.
- **Via-leg row semantics (v16.4, user decision)**: on a leg with via
  points the OFP row's TT/MT/WCA/MH show the DIRECT waypoint-to-waypoint
  line (the chart measurement between the named fixes); the flown
  per-segment tracks live in the ↳ sub-line and the plotting list, and
  the guide says to steer by those. Distance/time/fuel/GS always walk
  the bent path. Do not switch the row back to first-segment track.
- **Flight altitude schedule (v16.5, user decision)**: legs are NOT
  independent. computeFlightSchedule(fl) does a forward pass (climb
  spillover: TOC lands on the leg where the target altitude is actually
  reached; POH partial climbs inverted via climbCumulative bisection)
  and a backward pass (TOD backs up onto earlier legs so every waypoint
  is crossed AT its planned altitude, never above). Pattern stops break
  the chain. Impossible descents / unfinished climbs go to the red
  integrity banner. computeLegTotals(from,to) WITHOUT a schedule leg
  keeps the old independent behavior (tests and one-off tools rely on
  it); all UI paths (OFP rows, map markers, plotting list, integrity)
  pass the schedule.
- **Base chart switch (v16.7, verified Aug 2026)**: the map toggles
  between Kartverket topo (WMTS webmercator cache = EPSG:3857) and the
  OFFICIAL ICAO VFR 1:500 000 chart from Avinor's public ArcGIS service
  (avigis.avinor.no/agsmap/rest/services/ICAO_500000_ExB/MapServer,
  item owner AvinorSuperbruker, mosaic layer named per edition e.g.
  AIRAC_19MAR26). The paper chart is Lambert conformal conic (EUREF89,
  SP 59°40'/69°20', CM 9°E - confirmed in the service WKT), but the
  service is DYNAMIC (singleFusedMapCache:false) and reprojects
  server-side: we request export tiles with imageSR=3857, so both base
  charts render in Web Mercator and waypoints project identically -
  alignment verified against the chart's own printed graticule. No WMS,
  no CORS on the REST JSON but JSONP works (used for the edition label).
  A bottom-left label bar always names the active chart + projection +
  edition. VFR needs internet; topo remains the offline base. Do not swap
  the export approach for the LCC tile cache without re-checking alignment.
- **VFR chart resolution (v16.12, measured against the service)**: the
  chart raster is 31.75 m/px - NOT an estimate, it is the mosaic's own
  footprint attribute LowPS (MapServer/2/query ->
  ICAO_500k_Norway_ScreenMapMosaic), and exactly 400 dpi at 1:500 000.
  The old flat `size=256,256` therefore threw the chart away at low zoom.
  `vfrPixelRatio(z,y,dpr)` now requests exactly the resolution the source
  holds - cssRes/31.75, floored by devicePixelRatio, capped at 4x - and
  `vfrTilePx` rounds up to a multiple of 8; tiles stay 256 CSS px, only
  the raster inside them gets denser. Measured over Tromso at z9: the
  source-matched 856 px tile carries 2.1x the high-frequency detail of
  the 256 px one, and 0.4% LESS than a 1024 px one costing 32% more
  bytes - so do NOT flat-4x it the way the friend's planner does. At z11
  the CSS pixel is already 26.5 m, finer than the source, so the ratio
  bottoms out at 1 and the zoom you actually read the chart at costs
  nothing extra (20 tiles / 1.5 MB / 1.0 s, unchanged); the z9 overview
  pays 13.8 MB / 3.2 s for a screen, browser-cached by URL thereafter.
  Two params were settled by measurement, not convention: `dpi` is a
  NO-OP here (dpi=384 returned a byte-identical image to dpi=96 - the
  mosaic has no scale-dependent symbology, minScale/maxScale 0), so it
  stays 96; and `format=png24` is pixel-identical to png32 (alpha unused
  under transparent=false) at 10% fewer bytes. png8 and jpg are BANNED -
  measured to shift chart ink by 71 and 37 levels, and the small print
  (frequencies, MEF, airspace limits) is the entire point of the feature.
- **Not planned** (verified dead ends): NOTAM (no reliable free API),
  georeferenced VFR charts (licensing), traffic (needs receivers),
  auto-METAR from aviationweather.gov (browser CORS never verified).

## Dialogs (v16.11)

`src/lib/dialog.js` replaced every window.alert/confirm/prompt (20 call
sites, now zero). `ask()` takes any number of options and resolves the
chosen id; `confirmDialog`/`promptDialog` wrap it; `say()` is a toast
for notifications so they cost no click. Keyboard: Enter = primary,
1-9 = pick, Esc = cancel. Plain DOM (no <dialog>) so jsdom and Chromium
behave alike. The save flow is the reason this exists: as native
dialogs it had to ask "[OK] route / [Cancel] mission", and it is now
ONE dialog listing update-in-place, save-as-route, save-as-mission,
cancel. Call sites are async - functions that ask something must be
`async` and awaited.

TEST HARNESS: tests are queued via `TA(name, async fn)` and awaited by
`runAsyncTests()` before the summary; drive dialogs with
`answerDialog(label)` / `typeInDialog(v)`. NOTE: `T()` does NOT await,
so an async body passed to it reports PASS without asserting - eight
tests were silently doing this and are now converted.

## Saved-route freshness (v16.10)

Saved routes store the magnetic variation current WHEN SAVED, so
`loadSelectedRouteOrMission` re-resolves every waypoint through
`resolveMagVar` on load and reports how many changed. Values the pilot
typed are stamped `varSource: 'MANUAL'` by the VAR cell's onchange and
are never overwritten. `loadedRouteRef` remembers which saved entry the
plan came from so a re-save offers "update in place" before falling
through to save-as-new. The version badge is a state machine
(idle/checking/done/failed) because "up to date" and "the check never
ran" previously looked identical; it is click-to-recheck.

## Safety posture

A red integrity banner (`runIntegrityCheck`) validates all rendered
numbers each recalc (NaN/coords/altitudes/wind vs TAS/GS bounds/fuel).
The help guide opens on first run and leads with a PIC-responsibility
notice. Keep both intact. A 3-page company justification document exists
(Methodology_and_Safety_Notes.pdf, reportlab). When features are removed
for data-quality reasons, that reasoning belongs in the guide and is
worth a line in that document.
