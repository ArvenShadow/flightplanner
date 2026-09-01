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
    to 4922 lines, and `legs.js` (v16.15: the via-point leg engine and
    the v16.5 altitude schedule - legPath, pathSegments,
    pointAlongSegments, distToSegmentNM, phaseGS, computeLegTotals,
    computeLegProfile, climbAltReached, computeFlightSchedule,
    computeLegMarkers) took it to 4531. `insertViaAtLatLng` deliberately
    stayed in the page: it mutates app state and drives the UI, so it
    belongs with the map interactions, not the engine. legs.js takes the
    aircraft profile from performance.js (`activeAircraftProfile()`), so
    there is still exactly ONE injected copy. v16.16 added `daylight.js`
    (the SERA solar math) and `winds.js` (u/v vector maths + the
    Open-Meteo request/response shapes), taking the page to 4338, and
    v16.17 added `integrity.js` (the RULES behind the red banner, plus
    flightTitle), taking it to 4289. runIntegrityCheck stays in the page
    as a thin wrapper: three of its inputs can only come from what was
    actually RENDERED (a NaN in the table, an invalid daylight time,
    negative fuel remaining), so the page reads those from the DOM and
    hands them in as a `signals` object. v16.18 added `exchange.js`
    (buildExportPayload, pickProfileKeys, sanitiseFlights,
    defaultFlights), taking the page to 4260 and completing the pure
    slices.
  - Phase 1 CLOSED at v16.19, deliberately short of a full module graph.
    ALL 938 lines of CSS moved to `src/styles.css`, inlined at a @STYLES
    marker into both deliveries (there were TWO style blocks; they are
    merged in cascade order, and the build asserts exactly one remains).
    `plotting.js` took the copyable text; the unit conversions joined
    `format.js`. Page: 4260 -> 3326 lines.
    The remaining script is NOT being force-modularised, and this is a
    decision, not unfinished work: it is one web of 24 shared mutable
    globals (flights, activeFlightIndex, map, markers, undoStack...) plus
    61 inline on*= handlers that need its functions as globals. Threading
    that state through module boundaries would make a UI edit span MORE
    files. Instead the script opens with a WHERE TO EDIT WHAT index, and a
    test asserts the index still points at every module that exists.
    A CSS move is verified by PIXELS, not tests: tools compare full-page
    screenshots and computed styles of nine key selectors, light and dark,
    against the previous build.
  - HIDDEN GLOBALS ARE THE TRAP when extracting. `performance.js` read
    `aircraftProfile`, which is declared `let` at the top level of the
    page script: that is a global LEXICAL binding, shared with the
    bundle's IIFE, so it resolved in the browser and every page test
    passed - but `require()`ing the module threw. The rule: a module
    takes what it needs as an argument or through an explicit injector
    (`setAircraftProfile(ref)`, called once where the page declares the
    object), never off the ambient scope. Grepping for `document.` is
    NOT enough to prove a slice is pure; requiring it in bare Node is.
    IMPORTING IS NOT ENOUGH EITHER - `require()` does not execute function
    bodies, so a free identifier inside one only throws when CALLED. The
    winds extraction proved it: the module imported cleanly and all 261
    tests passed while it silently depended on THREE page globals
    (`toRad`, `OM_LEVELS`, `flights`). test.js now has a standalone-run
    guard that CALLS at least one export of every module with real
    arguments; it found all three immediately. Add every new module to it.
    Where the dependency is genuine app state (`flights`,
    `legStartTimes`), the fix is an explicit ARGUMENT, not an injector:
    `buildWindSamplePoints(flights, legStartTimes)`. `src/main.js` puts every export
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
  ENFORCED SINCE v16.18 by `src/lib/exchange.js`: `PROFILE_KEYS` is the
  ONE whitelist and BOTH directions use it. Import had always whitelisted;
  export had not - it serialised the live profile object wholesale, so any
  key a future feature parked there would have shipped in every route
  file the user emails or shares. A test now feeds a profile carrying a
  name, an email, a licence number and coordinates through
  buildExportPayload and asserts none of it appears in the JSON. Add new
  aircraft settings to PROFILE_KEYS; never widen it to anything that
  identifies a person, a machine or a place.

## Phase 2: types (v16.20)

The REAL TypeScript compiler checks every module, but the sources stay
plain `.js` with the types in JSDoc, and `src/types.d.ts` holds the
domain (Waypoint, Flight, LegResult, ScheduleLeg, EngineProfile,
DaylightResult, WindLevel...). `npm test` runs `tsc --noEmit` first; 0
errors is the standard.

- WHY NOT `.ts` FILES: the suite proves a module has no hidden page
  globals by `require()`ing it directly in bare Node - that is how
  toRad, OM_LEVELS and flights were caught. With `.ts` sources Node
  cannot load them without a compile step, so that guard would test
  compiled output instead of source. Same checker, same errors, no new
  build step, and the annotations carry over unchanged if we ever move.
- The checker found NO arithmetic bugs - the calculations were already
  guarded - but it did find three real defects, all of the same shape:
  a value that is legitimately absent being used as though it were not.
  1. MAGNETIC TRACK. `(tt + wp.var + 360) % 360` was inline at four call
     sites. With `var` undefined it printed NaN; with `var` null it
     printed MT === TT, which is FAR worse - a plausible heading a pilot
     could copy onto the OFP and fly. Now one helper, `magneticTrack()`
     returning null, and `magneticTrackLabel()` rendering `---`. MH is
     derived from the numeric value and shows `---` too: without a
     variation there IS no magnetic heading.
  2. A waypoint with no OAT or wind yields NaN time and fuel. That is
     CORRECT - assuming calm wind would be a plausible wrong answer - but
     the banner only said "a non-numeric value appeared". It now names
     the waypoint and the missing field.
  3. `closeDialog` takes a button id; `ask()` passed it a result object,
     so a dialog superseded by another resolved with `id` set to an
     object and `r.id === 'cancel'` never matched.
- It also caught the author's own inaccurate documentation twice: there
  are FOUR daylight regimes (polar-night is distinct from no-sunrise),
  and `solarCrossingUTC` returns 'below'/'above' sentinels, not null.
  Types written from reading the code are guesses; only the checker
  proves them.
- TRACKS AND HEADINGS ARE THREE DIGITS. The plotting list always padded;
  the OFP row did not, so the same leg read "36 / 24" in one place and
  "036 / 024" in the other. Both padded now.

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
- **METAR & TAF (v16.21)**: MET Norway,
  `api.met.no/weatherapi/tafmetar/1.0/{metar,taf}?icao=ENDU,ENTC`. Verified
  before building: sends `access-control-allow-origin: *` (so a browser
  may read it), accepts comma-separated ICAOs so a route costs ONE
  request per kind, returns the last 24 h oldest-first with each line
  prefixed by its station, and accepts a normal browser User-Agent -
  which mattered, because fetch() CANNOT set User-Agent (forbidden
  header) and MET returns 403 for bad ones. Licence NLOD 2.0, credit
  "The Norwegian Meteorological Institute"; the card carries it.
  - THE DECODING RULE: the RAW report is always shown in full, and only
    report time, wind, temperature/dew point and QNH are read out. A
    METAR carries RVR, wind shear, runway state, CAVOK, vertical
    visibility...; a decoder that silently misreads one is exactly the
    plausible wrong answer this project refuses to give. A US inHg
    altimeter (A2992) is deliberately NOT converted to a QNH.
  - Observation AGE is computed and shown, and >90 min is flagged "not
    current" - a three-hour-old METAR is not the weather.
  - NEVER CACHED, like the winds: the SW only touches same-origin files
    and Avinor tiles, the fetch sends `cache: 'no-store'`, and a test
    asserts the worker never learns the weather host.
  - Aerodromes are the first and last real waypoint of EVERY flight (the
    daylight card's rule); non-ICAO names like FINNSNES are excluded.
- **Map controls stack themselves (v16.24)**: the ⬇ Chart and 🔍 Detail
  buttons shipped INVISIBLE in v16.22 and v16.23. The map controls were
  each positioned by id with a hardcoded `top` (10px, 40px), so a button
  added without its own CSS rule fell into normal flow at the bottom of
  the page - present in the DOM, off the bottom of the screen. They are
  now one `#map-controls` flex column with a shared `.map-ctl` class, so
  adding a control needs no CSS at all. A test asserts every control is
  inside the stack and that none is positioned by id again.
  THE LESSON: markup that LOOKS right is not verified. A grep for the id
  in the built file passed; only measuring getBoundingClientRect in a real
  browser showed it at y=900 on a 900px viewport.
- **Chart detail setting (v16.23)**: the thing that actually made the VFR
  chart feel slow was never the network. MEASURED with img.decode() on real
  tiles: one 856 px tile takes 58.1 ms to rasterise against 2.6 ms for a
  256 px one, so a z9 screenful is ~1.2 SECONDS of pure decoding. NO amount
  of caching removes that - it is paid from the browser cache, the service
  worker, a local disk or GitHub alike. That cost arrived with the v16.12
  resolution work and is the price of the legibility it bought.
  - The whole cost is at the OVERVIEW zooms. At z10-z11, where frequencies,
    MEF and airspace limits are actually read, the CSS pixel is already at
    or finer than the 31.75 m source, so the ratio is 1-2 and a tile
    decodes in single-digit ms.
  - `chartDetail` (auto | sharp | fast, a map button, persisted, in
    PROFILE_KEYS) therefore caps the ratio at 2 for z<=9 in AUTO and leaves
    z10-z11 untouched: ~3.5x less rasterising on the overview, nothing lost
    where the chart is read. Sharp restores v16.22 behaviour everywhere.
  - The devicePixelRatio floor still wins over the cap, or a HiDPI screen
    would be made soft at reading zoom; the absolute 4x ceiling still wins
    over the floor.
  - Do not "fix" perceived map slowness with more caching again without
    measuring decode first.
- **Offline chart download: BUILT v16.22-v16.25, REMOVED v16.26. Do not
  rebuild it.** A button pre-fetched the route corridor into the
  service-worker cache. It failed in the pilot's hands - "it worked for a
  small while, but zooming far enough out and back in deletes the cache" -
  and the reason is structural, not a bug that was left unfixed.
  - THE HARD LIMIT, and it is the browser's, not ours: Avinor sends no
    Access-Control-Allow-Origin, so a chart tile is an OPAQUE response.
    Browsers PAD the storage cost of opaque entries so a page cannot
    measure cross-origin resources by watching its own quota - Chromium
    charged 8.46 MB for a single 68-byte tile. So a 45 MB route download
    actually costs ~2.5 GB of quota. When an origin's quota fills, the
    browser discards EVERYTHING for that origin - which is precisely the
    disappearing cache the pilot reported. Nothing in the page can prevent
    that, ration around it, or even see it coming.
  - THAT PADDING CANNOT BE MEASURED either, and v16.22 was wrong to try.
    Browsers RANDOMISE it precisely so a page cannot, and usage updates
    asynchronously: six consecutive probes of the same single-tile store
    measured 0.38, 9.15, 0.38, 5.69, 10.15 and 4.78 MB. The pilot saw
    "5000 MB" and then "23000 MB" for the same unchanged route. v16.25
    replaced the prediction with measure-the-outcome; the feature still
    could not hold what it stored, so v16.26 removed it.
  - The GENERAL LESSON, and it is the NO GUESSTIMATES rule again: a feature
    whose promise the platform can silently revoke is a plausible wrong
    answer. "Your chart is downloaded" that turns out false at the moment
    the internet is gone is worse than never offering it. Do not reintroduce
    this without a tile source that sends CORS headers - then tiles are no
    longer opaque, the quota accounting is real, and the promise can be kept.
  - WHAT SURVIVED, and why it is not the same thing: Avinor sends
    `Cache-Control: must-revalidate, max-age=0`, so the browser may never
    reuse a tile without asking the server first - which is why panning the
    VFR chart felt like it reloaded constantly. Kartverket sends
    max-age=432000, which is why the topo map feels fine by comparison. The
    service worker is not bound by that and still keeps a SMALL tile cache
    (TILE_LIMIT back to 400, down from the 2500 the download needed), and
    both layers keep a wider ring of off-screen tiles (`keepBuffer: 4`).
    That is a PANNING CONVENIENCE only. Nothing claims the chart works
    offline, and a big limit would not help: it would fill the quota and get
    the whole origin evicted, app shell included.
  - The tileerror banner used to say "switch back to Topo for the
    offline-cached map". NOTHING cached topo - the worker only touches
    same-origin files and Avinor tiles - so that sent a pilot looking for a
    map that was never stored. It now says only what is true: both charts
    are streamed and need internet, and everything else still works.
- **Route editing gestures (v16.27, QoL)**: bending a leg was two gestures -
  click the line to drop a via point, let go, hunt for the diamond, drag it.
  It is now one press-drag-release, and every drag redraws the line live.
  - THE DRAG CANNOT USE LEAFLET'S OWN MARKER DRAGGING: the via marker does
    not exist until the press happens, and there is no way to hand an
    in-progress mouse gesture to a Draggable created mid-press. So the drag
    runs off map-level `mousemove` with `map.dragging.disable()` for its
    duration, plus a DOCUMENT-level `mouseup` - releasing outside the map
    must not leave the route stuck to the cursor.
  - A press-release with no movement fires a click on the same element, on
    top of the mousedown that already created the via. A 250 ms window
    swallows exactly that trailing click. It is short on purpose: the browser
    synthesises it immediately, and a longer window starts eating a genuine
    second click further along the line. The click path is KEPT, not replaced
    - a tap on a touch screen fires `click` with no `mousedown`.
  - `hitLines[]`: an invisible weight-20 polyline per flight, over the visible
    weight-4 one, carrying every route gesture. A 4 px line is a 4 px target;
    verified by grabbing 7 px off the stroke in Chromium. Same coords, same
    index as `polylines[]`, and both are redrawn by `drawLiveLine`.
  - LIVE REDRAWS GO THROUGH `flightLineCoords(fl)` (legs.js), which is also
    what refreshMap draws. The old waypoint-drag handler rebuilt the line from
    waypoints ALONE, so dragging a waypoint on a bent leg made its via points
    visibly vanish until the drag ended. One function, one answer.
  - INSERTING A REAL WAYPOINT MID-ROUTE (right-click the line, or the `+` on
    the leg's OFP row, which uses `legMidpoint` - halfway along the FLOWN
    path, so a dog-legged leg does not put it in the terrain the vias were
    added to avoid). Splitting a leg that already has vias has one right
    answer: `via.slice(0, insertAt)` stays on the first half, `via.slice(insertAt)`
    goes to the second. Anything else silently moves the flown track.
    The new waypoint INHERITS alt/OAT/wind from the waypoint it is inserted
    before - the leg was already planned to arrive at those, so nothing is
    invented - and its variation is computed for the new position. All
    editable in the row. PATTERN legs are not lines on the ground: they are
    skipped by the hit-test and their rows get no `+`.
  - jsdom cannot prove a gesture. The suite drives the stubbed handlers
    (which caught the trailing-click double-insert), but press-drag-release,
    the 7 px grab, map-pan suppression and the live bend were all measured in
    real Chromium with `page.mouse`.
- **Not planned** (verified dead ends): NOTAM (no reliable free API),
  georeferenced VFR charts (licensing), traffic (needs receivers).
  auto-METAR from aviationweather.gov: re-checked Sep 2026 and it sends
  NO CORS header, so it is genuinely unusable from a browser - MET Norway
  is used instead, and is the authoritative source for Norway anyway.

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
