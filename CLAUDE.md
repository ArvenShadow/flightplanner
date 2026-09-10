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

## Licence constraint (v16.29 — NEW, and it binds the whole project)

The AIP airspace data comes from Avinor's eAIP, which is **copyright Avinor
AS**: GEN 0.1 states that any use outside copyright law is inadmissible
without permission. **The user HOLDS that permission, conditional on the
software not being used commercially.**

That condition is now a constraint on the project, not a footnote:

- The planner MUST NOT be commercialised while `data/aip.js` ships with it.
  If commercial use is ever wanted, the AIP dataset comes out first.
- The attribution and the non-commercial condition are stated in the dataset
  itself, in `tools/build-aip.mjs`, and in the app (guide + attribution line).
  A test asserts the dataset carries them.
- This is a PERMISSION, not an open licence. It does not transfer to anyone
  who forks the repo, and it cannot be widened by assumption. Kartverket
  (topo tiles, and the national-border WFS if that is ever wired in) is
  separately NLOD; MET Norway is NLOD 2.0. Do not conflate the three.

## Architecture (deliberate, do not "modernize")

- **v16.45 (user decision, premise changed AGAIN): there is now ONE delivery,
  `site/`. The single-file `dist/C182_FlightPlanner.html` is GONE.**
  The author's words: *"I don't want any unused files... the flightplanner is
  more for myself now and I don't plan on distributing it to anyone anymore."*
  Also, explicitly: *"CLAUDE.md shouldn't always be taken literally to the
  extremes"* - this file records decisions, it does not outrank the person whose
  project it is.
  - THE STATED REASON FOR KEEPING IT DID NOT SURVIVE INSPECTION. It was "the
    fallback on a machine that has never seen the app" - but a `file://` page
    CANNOT register a service worker, so it cached no chart tiles at all, while
    the hosted copy does. On the very machine the fallback existed for there is
    no internet, so both base charts are blank: it was the LESS capable offline
    option, not the more capable one.
  - WHAT IT COST, MEASURED: `file://` forbids `fetch()`, so `data/aip.js` had to
    be INLINED - 366 KB, 42% of the page. The shell and the dataset change on
    completely different schedules (app releases vs the 28-day AIRAC cycle), so
    every app release re-downloaded 366 KB of unchanged AIP data and every AIRAC
    update re-downloaded the whole shell. `index.html` is now 497 KB with the
    dataset a separately cached `aip.js`.
  - **THE BUNDLE IS STILL A CLASSIC IIFE, and that is NOT leftover.** The reason
    was never only `file://`: the page script is a classic script whose inline
    `on*=` handlers need the bundle's functions as globals, and a
    `type="module"` script is DEFERRED - it would run AFTER the page script.
    That constraint is unchanged. `data/*.js` as a sidecar is likewise still
    right; it is just linked now instead of pasted in.
  - THE SERVICE WORKER MUST PRECACHE `aip.js`. Miss it and the airspace overlay
    and the fix layer vanish offline, which looks like a bug rather than a gap.
    `verify-hosted.mjs` reads the real shell cache and asserts all three assets
    are in it - asserting the filename appears in `sw.js` is not the same thing.
  - THE TESTS ASSEMBLE THE THREE FILES IN MEMORY and grep the result (`APP_SRC`).
    Reading `site/index.html` alone would miss everything in `app.js` and
    `aip.js`, so a guard against a REMOVED feature would pass because it was
    looking in the wrong file. That bit immediately: four such guards went green
    for the wrong reason before `APP_SRC` existed.
  - `build.cmd` went with it (its only job was opening the double-click file);
    `serve.cmd` builds, serves and opens the browser.

- **v16.14 (superseded at v16.45 - the single-file half is gone; kept for the
  history of why `site/` exists at all): the planner is now HOSTED as well.** The user asked for GitHub Pages plus the ability to
  serve it on the local wifi or a phone hotspot. `tools/build.mjs` emits
  TWO deliveries from one source: `dist/C182_FlightPlanner.html` (the
  double-click file, unchanged) and `site/` (index.html + app.js + sw.js,
  deployed by .github/workflows/pages.yml, served locally by
  `npm run serve`). `site/` is gitignored; `dist/` stays committed.
  - The single-file artifact is STILL a supported delivery and must keep
    working - it is the fallback on a machine that has never seen the app.
  - Both deliveries use the SAME classic-script IIFE bundle. For site/
    that is not inertia: the page script is a classic script whose top
    level calls setAircraftProfile() and whose 108 inline on*= handlers
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
    merged in cascade order, and a TEST asserts exactly one remains - the
    build does not check it, and this file said it did until v16.48).
    `plotting.js` took the copyable text; the unit conversions joined
    `format.js`. Page: 4260 -> 3326 lines.
    The remaining script is NOT being force-modularised, and this is a
    decision, not unfinished work: it is one web of 40 shared mutable
    globals (flights, activeFlightIndex, map, markers, undoStack...) plus
    108 inline on*= handlers that need its functions as globals. Threading
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
  identifies a person, a machine or a place. (v16.34 added `fixesOn`, a
  boolean layer toggle.)

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
5. **BUMP THE VERSION ON EVERY SHIPPED CHANGE - `package.json` AND
   `APP_VERSION` TOGETHER.** vMAJOR.MINOR is what the user sees in the app and
   in the filename they receive, and it is how they tell one build from another.
   It is easy to miss because the build only checks that the two agree with EACH
   OTHER (major.minor) - nothing forces a bump when the CONTENT changes, so a
   dataset re-import or a fix can ship under the previous number and look
   identical to the build before it.
   - This has already happened once: the 2026-09-03 AIP re-import shipped with
     `package.json` still at 16.41.0 while the CLAUDE.md text written in the very
     same commit said "v16.42". The documentation claimed a version the artifact
     did not carry.
   - A DATA-ONLY change counts. `data/aip.js` is inlined into both deliveries, so
     a new AIRAC edition IS a new build even though no source line moved.
   - Bump BEFORE the final `npm test`, so `dist/` and `site/` are rebuilt at the
     new number and the committed artifact matches the tag in the notes.

### THE PAGE SCRIPT IS THE THIN SHELL - three rules that are not optional (v16.42)

An outside review of v16.41 put it exactly right: *"a well-engineered core with
a thin shell"*. The pure modules take what they need as arguments, are checked by
the real compiler and are proved to have no hidden globals; the 4 100-line page
script is the least tested surface, and EVERY high finding in `AUDIT.md` lives
there. The answer is NOT the module refactor this file rightly declined - it is
three cheap disciplines applied every time the page is touched:

6. **ESCAPE EVERY INTERPOLATED STRING that reaches `innerHTML`.** The METAR card,
   the OFP sheet and the fix labels already do; the OFP rows, the pattern row,
   `flightTitle`, the wind modal, the sub-leg row, the plotting list and the leg
   panel do not. This is correctness before it is security: a waypoint named
   `Bodø <VOR>` breaks the table with no malice at all.
7. **RE-READ STATE AFTER EVERY `await`.** Never hold `flights[activeFlightIndex]`
   (or an fIdx, or a waypoint) across a dialog: `undoLast` rebinds `flights` to a
   fresh copy, so the captured object is detached and the confirmed action
   silently does nothing - or, with an index, hits the wrong flight. This is a
   PATTERN, not a one-off, and every new dialog reproduces it unless the handler
   re-reads after the await.
8. **THE SAFETY NET RUNS FIRST, AND IT RUNS ON EVERY SURFACE.** `runIntegrityCheck`
   is the last call in the render pipeline with nothing guarding it, so a throw
   anywhere earlier skips it silently; and the print rule hides the banner, so the
   one output that goes on company paperwork is the one the guard cannot reach.
   A guard that can be bypassed is not a guard.

### TWO FAILURE SHAPES THIS PROJECT KEEPS PRODUCING - look for them by name

- **AN OLD RULE NOT APPLIED TO A NEW SURFACE.** Both critical findings are this.
  The pattern-stop chain break was written for the backward pass and never for
  the forward one; the wind modal predates the v16.20 "never assume calm wind"
  rule and was never revisited. When a rule is added HERE, grep for every place
  it should already have applied.
- **A TEST ASSERT LOOSER THAN THE MEASUREMENT THAT JUSTIFIED IT.** The advice
  sweep measured 305 suggestions and asserts `given > 30`; a regression halving
  the rate would pass. Where a number in this file is quoted as evidence, the
  suite should assert close to it, or the file should say the figure was an
  offline run. Do not let the documentation get ahead of the code.

## Test harness notes

- `npm install` then `npm test` (which BUILDS first). **Requires Node 20.19+ or
  22.12+, NOT 18** - this file said 18 for a long time and was wrong: the suite
  `require()`s ESM modules from `tools/` (`aip-fields.mjs`, and `lock-rules.mjs`
  since v16.78), and `require(esm)` only exists from those versions. Stated in
  `package.json` engines so it is machine-readable, and CI pins 22.
- `SWEEP_N=<n> npm test` multiplies every generated sweep, so the big figures
  quoted in this file are reproducible on demand instead of aspirational. The
  everyday run uses the smaller sizes; the asserts are absolute lower bounds, so
  a larger multiplier can only make them easier.
- SIX CHROMIUM VERIFIERS, and each exists for something jsdom cannot see:
  `verify:hosted` (the service worker and the real tile cache), `verify:ofp`
  (whether a value FITS its printed cell), `verify:fixes` (that a marker is
  visible and a click does not bubble), `verify:leg` (that a right-click reaches
  a 20 px invisible hit-line), `verify:hover` (that the card re-resolves across a
  sector seam) and `verify:layout` (v16.49 - what a 1280x720 laptop can actually
  SEE without scrolling). They need `npm install --no-save playwright`, or
  `CHROME_PATH` pointing at a browser already on the machine.
- Tests load `site/index.html` via the APP_HTML constant and assemble it with
  `app.js` and `aip.js` into `APP_SRC`, so source-level guard greps keep working
  wherever code currently lives. Grepping the shell alone is not enough - four
  guards once went green for the wrong reason that way.
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
- **Mass & Balance**: WAS out of scope — the user kept M&B in their Excel
  OFP. SUPERSEDED at v16.28: it is roadmap item 5 (see Roadmap below), but
  nothing is built yet and it needs the real sheet plus the POH arms and
  limits in hand first. Fuel-requirement and POH takeoff/landing features
  remain out of scope.
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
- **PINNED CLIMB AND DESCENT CORNERS (v16.37, roadmap item 1)**: the pilot can
  now place the BOTTOM of climb and the BOTTOM of descent on a leg. Right-click
  the track opens the leg panel (section 2g of the page); `pinNM` and the
  extended `computeFlightSchedule` are in `src/lib/legs.js`.
  - **THREE CORNERS ARE NAMEABLE; THE AIRCRAFT IS NEVER INVENTED.** BOC ("hold
    this altitude for 12 NM, then climb") and BOD ("be level 5 NM before the
    fix, then run in level") are pure GEOMETRY: the climb and descent are
    unchanged, they only move, so they are always flyable and the existing
    spillover/back-up machinery handles them.
  - **v16.38 (user's correction, and they were right): "be level by X" SETS THE
    BOC** by working backwards at the profile's own rate, instead of being a
    check that reported an unflyable rate. v16.37 shipped it as a target only,
    reasoning that a TOC pin implies a rate of climb the POH cannot price. That
    was the wrong conclusion from a correct premise: you do not need a steeper
    climb to top out earlier, you need to START EARLIER. `climbStartForToc`
    bisects the start position so the POH climb ends exactly on the target -
    same minutes, same fuel, same TAS, only the position moves. A target LATER
    than the derived TOC is just a delay; the pilot gets the corner they
    actually care about and the BOC box becomes a derived read-only display.
  - **WHEN IT WILL NOT FIT, THE ANSWER IS AN ALTITUDE, NOT A RATE.** If the
    climb cannot finish by the target even starting at the leg's first fix,
    `entryAltForClimbBy` computes what the PREVIOUS fix would have to be crossed
    at, and the panel offers a one-click "Do that". That keeps the altitude
    column the single source of truth for what is flown where, rather than the
    schedule quietly doing something the column denies - which is what a
    spill-the-climb-onto-the-previous-leg implementation would have done (the
    descent's own spill-back already has that flaw: leg 0 reports exit 8000 ft
    while a backed-up descent actually crosses that fix ~5000 ft lower).
  - **v16.39 (the user's second correction, and again they were right): TAKING
    THAT ADVICE MUST GIVE ONE CONTINUOUS CLIMB.** "Cross MID at 6032 ft" only
    raised the fix, and raising a fix makes the EARLIER leg climb to it
    immediately and then HOLD the new altitude all the way there. So the pilot
    who asked for one corner got a climb, a 29.5 NM level stretch and a second
    climb - two climbs with a phantom "TOC" chip painted at MID, a point the
    aircraft flies straight through. The user's words: "i want the BOC to begin
    at a point where i would cross wp at xxxx in the climb".
    - THE FIX IS THE MECHANISM THAT ALREADY EXISTED, not a new one. "Do that"
      now also pins the earlier leg's TOC target at that leg's FULL length -
      "top out ON this fix" - so `climbStartForToc` delays the same climb (same
      minutes, same fuel, same TAS) to the end of the leg, where it runs
      straight on into this leg's climb. Measured: level gap 0.000 NM before the
      fix and 0.000 NM after, TOC exactly on the 5 NM target.
    - **THE VERIFICATION TRIAL HAS TO APPLY BOTH HALVES**, or it validates a
      plan the button does not produce. It now also requires the EARLIER leg's
      new target to be met, because that leg has a target of its own now.
      `tocAdviceLevelByNM` / `tocAdviceClimbFromNM` are read back OUT of that
      trial, so the sentence offering the advice cannot describe something other
      than what applying it does.
    - **THE ROUNDING TO THE NEXT HUNDRED FEET WAS DROPPED**, and it was the
      cause of the last remaining sliver. 6032 -> 6100 crosses the fix 68 ft
      higher than needed, which shortens the second climb, which delays it 0.23
      NM to still hit the target - a 7-second level segment at the fix, i.e. the
      same defect in miniature. A crossing altitude passed in a climb is not a
      level to be flown, so tidiness bought nothing. The rounding ALSO made the
      offer differ from what the engine had verified (rounding up is strictly
      harder for the earlier legs, not easier). A test still asserts a pilot
      rounding it up BY HAND stays safe.
    - **WHO DRAWS THE MARK IS THE TEST FOR SUPPRESSING IT, NOT HOW LONG THE
      NEXT CLIMB IS.** `climbContinues` is set when a leg's climb tops out on
      its end fix AND the next leg climbs on from that fix AND the next leg (or
      a later one) actually draws that climb's top. Testing the next climb's
      LENGTH failed on the degenerate case the sweep found: a 0.0499 NM climb is
      too short to mark by length, yet its TOC lands at 0.0500 NM and IS drawn -
      so nothing was suppressed and two chips appeared a twentieth of a mile
      apart. `EDGE_NM` is now one module-level constant shared by the marks and
      the continuity pass, so what the schedule calls one climb and what the map
      draws as one climb cannot drift.
    - IT IS A PROPERTY OF THE SCHEDULE, NOT OF THE ADVICE, so it also fixes the
      unpinned case: 21 of 48 957 generated unpinned legs top out exactly on a
      fix the next leg climbs on from, and every one of those was drawing two
      TOC marks for one climb since v16.5. Rare (0.04%) but always wrong.
    - THE SWEEP IS AGAIN THE TEST: 305 pieces of advice, all verified, 265 give
      one continuous climb and 0 split the climb; 40 legitimately DESCEND into
      the raised fix, where the climb genuinely begins at the fix and there is
      nothing to join - so no pin is written there, rather than parking a "be
      level by" on a leg with no climb. The 20 000-route pin sweep gained a
      whole-flight invariant: a suppressed TOC must really reach its end fix,
      have no level stretch after it, and its mark must reappear on a later leg.
  - **v16.40 (user request): THE CROSSING ALTITUDE IS A WHOLE HUNDRED FEET, AND
    IT ROUNDS UP.** v16.39 had dropped the rounding because it re-introduced a
    level sliver; the user asked for it back, and they fly and write round
    altitudes. It rounds UP, never to the NEAREST, and that is not stylistic:
    the figure is a MINIMUM, so the nearest hundred is below it half the time
    and taking that advice would miss the very target it was computed to meet.
    Capped at the leg's own target altitude - crossing the previous fix ABOVE
    what this leg climbs to would make it a descent.
    - **THE SLIVER IS GONE BECAUSE A HANDED-OVER CLIMB IS NEVER DELAYED**, which
      is the piece v16.39 was missing. When the leg before tops out exactly ON
      the shared fix and this leg climbs on, the two are one climb through the
      fix: there is no level flight there to postpone. A "be level by" target on
      such a leg is therefore a DEADLINE to check (`tocContinuation`), not a
      position to set. The extra height from rounding makes the climb finish a
      little SOONER than asked instead of levelling off for seven seconds at the
      fix - and early is safe, which is what "be level BY" means.
    - THAT IS ALSO WHY THE TARGET IS NO LONGER MET EXACTLY, and the tests say so
      rather than asserting equality: TOC at 4.77 NM against a 5 NM deadline.
    - THREE OUTCOMES ARE NOW LEGITIMATE and the sweep asserts all three occur:
      302 suggestions, all verified - 251 one continuous climb, 40 that DESCEND
      into the raised fix (the climb genuinely begins there), and 11 where
      rounding up reaches the leg's OWN target altitude so the whole climb is
      absorbed by the earlier leg and finishes on the fix. 0 split the climb.
      The one-TOC check counts marks over the WHOLE flight, because a climb
      continuing through more than one fix lands its mark on a later leg.
  - **BOTH SIDES OF THAT BISECTION MOVE**, which is why `entryAltForClimbBy`
    takes a callback rather than a minutes budget. A higher entry altitude
    shortens the climb but also raises its TAS, covering the target distance in
    LESS time; comparing against a budget computed at the ORIGINAL TAS missed
    by 0.11 NM.
  - **ADVICE IS TRIED BEFORE IT IS OFFERED.** Raising a fix also changes the leg
    BEFORE it, and if those earlier legs cannot climb that high by then the
    target is missed all over again. Measured over 20 000 generated routes: the
    per-leg figure alone was wrong 382 times in 947. Each candidate is now run
    through `computeFlightSchedule` on a copy (one level deep, guarded by
    `opts.verifyAdvice`) and dropped unless the target is really met - after
    which it is 565 of 565. A failed candidate means NO altitude helps, because
    a higher one is strictly harder for the earlier legs to reach, so verifying
    once is enough and there is nothing to search. `tocNoAltHelps` says which.
  - THE FIRST LEG IS THE ONE HONEST REFUSAL: there is no earlier fix to raise
    because you cannot climb before takeoff. Only there is the required rate the
    useful thing to report, and only there is it reported.
  - PINS LIVE ON THE LEG'S **TO** WAYPOINT (`bocNM`, `bodNM`, `tocNM`), where
    alt, OAT and wind already do. Distances are along the FLOWN path, stated
    the way a pilot says them: BOC and TOC after the start fix, BOD before the
    end fix. Cleared means `null`, not 0, so a saved route reads identically to
    one made before pins existed - a test asserts that.
  - **A BOD PIN IS REFUSED, NOT HALF-APPLIED**, when a descent for a LATER,
    lower fix already runs through that leg's tail: the aircraft is still going
    down there, so "be level before this fix" cannot be true. `bodPinNM` keeps
    the request, `bodTailNM` is what was actually applied, `bodRefused` says
    which. The red banner names it. Contradictory pins (a TOC target before the
    BOC) are named as contradicting rather than reported as a rate of nothing.
  - THE SWEEP IS THE TEST, exactly as for the v16.28 vanishing TOD. It found
    FOUR real bugs while this was being written, and every one of them would
    have put a wrong number on the OFP:
    1. the descent placed INSIDE a delayed climb - `availDist` has to subtract
       `climbStartNM + climbDistNM`, not just the climb's length;
    2. the BOD tail read from the RAW pin on legs that do not terminate the
       descent, so `computeLegTotals` and the markers disagreed with the walk;
    3. phase distances not summing to the leg;
    4. `todBeforeNM` LATCHED mid-walk, then wrong once a second descent
       extended further back on the same leg. It is now settled in one pass
       after all placement. That flaw was latent before the pins - the right
       altitudes alone could always have produced two descents on one leg -
       and 0 of 39 483 unpinned legs hit it, which is why it was never seen.
    20 000 pinned routes passed with 0 violations. **THAT WAS A DEVELOPMENT
    RUN, AND THIS FILE USED TO IMPLY IT WAS THE SHIPPED SIZE** (M5). The suite
    sweeps 4 000 by default so the everyday run stays fast; `SWEEP_N=5 npm test`
    reproduces the 20 000 quoted here, and any multiplier only makes the
    absolute lower bounds easier - the sweep is a search for violations, not a
    fixed-size sample. The no-pin schedule is BIT-IDENTICAL to the derived v16.5
    one (asserted on climb/descent minutes, fuel, TOC, TOD and the leg totals).
  - `computeLegTotals` HAD TO CHANGE its level-flight maths. Before the pins
    there was one level stretch and it always FOLLOWED the climb, so the code
    could assume `[climbDistNM, climbDistNM + cruiseDist]`. A BOC puts level
    flight before the climb and a BOD after the descent, so there are up to
    THREE level pieces - and they are not at the same altitude. Each is now
    priced at its own: the lead at the entry altitude, the middle at cruise,
    the run-in at the arrival altitude.
  - MARKERS: BOC and BOD are drawn ONLY when pinned. With no pin the bottom of
    a climb IS the start fix, and marking a point that is already a named
    waypoint is pure clutter - the same reasoning that leaves a degenerate TOC
    to the neighbouring leg. `computeLegMarkers` now also sorts its output into
    FLIGHT ORDER, because the plotting list and the OFP sub-line print it
    straight through and "TOC ... BOC" down a leg flown BOC-first makes the
    pilot reorder it in their head. Which end a distance is measured from is
    `rel`, not the kind - testing for `'TOC'` put two of the four marks on the
    wrong end of the leg, in both the page and plotting.js.
  - THE RIGHT-CLICK GESTURE MOVED WITHOUT LOSING ANYTHING. Right-click used to
    insert a waypoint outright; it is now the first action IN the panel, at the
    exact point clicked. That freed the gesture the user asked for with no new
    modifier to learn. `alongLegNM` (legs.js) turns the click into a distance
    along the flown path, which is what the "Here" buttons use - the pin is
    easier to set by gesture than to type, which is the whole point.
  - The panel's PREVIEW runs the real engine on a COPY of the flight, so it
    cannot disagree with what Apply will do - same rule as the v16.35 fix-style
    preview. It is also where an unmet target or a refused pin is shown BEFORE
    committing, rather than only afterwards in the banner.
  - jsdom cannot prove a right-click reaches a 20 px invisible hit-line, or
    that a rotated tick is painted where the schedule says.
    `tools/verify-leg-panel.mjs` drives real Chromium: the gesture, the panel on
    screen, the Here buttons, both warning shapes, Apply reaching the schedule,
    all four marks measured against the projection of their OWN coordinates,
    and - because the gesture changed - that the panel still inserts a waypoint
    and that a LEFT click still bends the line. TWO TRAPS it hit: the declutter
    feature hides the TOC/TOD chips at far zoom on purpose, so measuring them at
    zoom 7 reads `display:none` and proves nothing; and `page.evaluate` AWAITS
    what the function returns, so returning `insertWaypointFromLegPanel()`
    deadlocks against answering the dialog it opens.
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
- **TOC / TOD marks (v16.28, bug fix + the user's preference)**: they are
  now a short TICK ACROSS THE TRACK with a small `TOC` / `TOD` chip beside
  it, and the sentence moved to the chip's hover tooltip.
  - THE BUG: `computeLegMarkers` dropped any mark falling within 0.05 NM of
    a leg's end (`todBeforeNM < distNM - 0.05`). When a descent fills a
    WHOLE leg - which happens whenever the last leg is exactly long enough -
    the TOD lands a few hundredths of a mile after the previous fix and was
    thrown away, so the pilot saw a descent begin with no TOD anywhere.
    Measured over ~60 000 generated routes: 667 of them descended with the
    mark silently missing. It is now KEPT and carries `atWaypoint`, so the
    label says "at B" instead of "27.1 NM before ENTC" - which is the only
    useful reading of a descent that starts on a fix. The same sweep now
    reports 0 missing and 0 duplicated marks, and that sweep IS the test.
  - The remaining guard is only against a degenerate mark: a climb or
    descent occupying no distance on THIS leg belongs to the neighbouring
    one, which draws it. That is what stops duplicates.
  - Z-ORDER MATTERED: a TOD landing on a fix was drawn UNDER that fix's own
    name label - invisible in exactly the case the fix exists to expose.
    `zIndexOffset: 650` puts the marks above the waypoint markers.
  - THE HALO MUST BE A BOX-SHADOW, not a border. A white 1px border on each
    side of a 2px bar leaves almost no colour once the rotation is
    antialiased; the first attempt rendered as a pale smear and was only
    caught by looking at a 4x crop of a real screenshot.
  - The numbers are NOT lost: they stay in the leg's sub-line and the
    plotting list, which is what gets copied and what prints. A tooltip
    does not print, and that is fine because it never carried the only copy.
- **The per-row "+" insert button (v16.27) was REMOVED at v16.28** on the
  user's request - clicking the map adds a waypoint and right-clicking the
  line inserts one mid-route, so a button in every OFP row was paying table
  width for nothing. `legMidpoint` stays in legs.js (tested, cheap) in case
  a positioned insert is wanted again. The right-click gesture and the
  leg-splitting rules are unchanged.
- **AIP airspace (v16.29, roadmap item 4 — the DATA half is built)**: 140
  drawable airspaces (53 TMA volumes, 33 TIZ, 19 CTR, 17 TIA, 6 ADS, 5 CTA,
  2 RMZ/TMZ, 2 HTZ, 1 RMZ) with class, published vertical limits, callsigns
  and frequencies, from the official Avinor eAIP. Permission held — see the
  Licence constraint at the top. The planner OVERLAY is not built yet; this
  is the importer and the dataset.
  - THE SOURCE IS NOT PROSE, AND THIS IS THE WHOLE TRICK. The eAIP is
    generated from Avinor's AIP database and carries the DATABASE FIELD
    NAMES in hidden spans:
      `<span class="SD">4500</span><span class="sdParams">TAIRSPACE_VOLUME;VAL_DIST_VER_UPPER;1058</span>`
    The vocabulary is AIXM-derived. So every value we need is individually
    identified at source and NOTHING is inferred from English wording: a
    vertical limit arrives as three separate fields (VAL / UOM / CODE), a
    frequency arrives with its unit, a class arrives as a code, and a
    national-border reference arrives as `TGEO_BORDER;TXT_NAME`. A parser
    that read the sentence would be guessing.
  - EDITION DISCOVERY: GET `/no/AIP` and follow the redirect to
    `/View/Index/<N>`; do NOT hardcode the index, or a superseded edition is
    served silently. Then probe AIRAC dates backwards from today (28-day
    series) and read `effectiveDateStart` from AD 1.3's meta. Verified Sep
    2026: index 154, edition 2026-06-11-AIRAC, and that IS current — an eAIP
    edition is republished per AIP AMDT, not per 28-day cycle, so a June
    edition being current in September is normal, not stale.
  - THREE STRUCTURAL TRAPS, each of which broke a first attempt and each of
    which is now a test:
    1. AN EMPTY VALUE IS A SELF-CLOSING SPAN (`<span class="SD" id="X"/>`).
       A `>...</span>` regex runs straight past it and captures the NEXT
       field's marker as this field's value. Empty is also MEANINGFUL: GND as
       a lower limit has no UOM and no CODE, which is exactly how a code-only
       limit is distinguished from a measured altitude.
    2. A `sdParams` SPAN IS SOMETIMES NESTED INSIDE ITS `SD` SPAN (12 times
       in ENR 2.1), so a flat previous-sibling walk mis-assigns those. The
       scan is nesting-aware.
    3. ENR 2.1 PUBLISHES THE AIRSPACE TYPE AS UNTAGGED TEXT after the name
       (`<span class="SD">Alta</span><span class="sdParams">…CUSTOM_ATT24…</span>
       <span>TMA</span>`), where AD 2 tags it as `TXT_LOCAL_TYPE`. Without
       reading the trailing text, 114 of 197 ENR 2.1 entries were
       unclassified blobs.
  - VERTICAL LIMITS ARE NEVER COLLAPSED TO A NUMBER. GND/SFC/UNL are codes
    and a flight level is not an altitude AMSL, so `ft` is filled in ONLY for
    a published measured altitude and the datum is kept beside it. Metres are
    shown as published and left numerically unresolved rather than converted.
    FL is published as VAL=105 UOM=FL and must render "FL 105", not "105 FL".
  - WHAT IS DELIBERATELY ABSENT, and it is reported, never approximated:
    18 offshore HTZ/ADS published as a circle radius rather than a polygon,
    4 volumes referencing the MARITIME Norway-Sweden boundary in the
    Skagerrak, and 1 referencing the Finland-Sweden border. See the border
    entry below - the land-border cases are now RESOLVED.
    FIR/UIR/OCA and the Polaris ACC sectors are excluded on purpose: the FIR
    is the whole country and an ACC sector is an en-route division far above
    a C182 — drawing them buries the CTRs and TMAs that matter.
  - The eAIP restates 22 volumes verbatim; drawing them twice double-darkens
    the polygon and shows two airspaces where there is one. Deduplicated on
    (name, band, ring), and a test asserts no polygon is drawn twice.
  - 140 features = 152 KB raw, 12.8 KB gzipped, shipped as `data/aip.js`
    assigning `window.C182_AIP`. A SIDECAR, not JSON, for the same reason the
    bundle is a classic script: `fetch()` and ES modules are both blocked on
    a file:// page. `.aip-cache/` holds the fetched pages so a re-run and a
    parser change need no network; it is gitignored, `data/` is committed.
  - REPORTING POINTS ARE NOT IN THE eAIP HTML. There is no reporting-point
    marker on an AD 2 page — verified against the full 189-marker vocabulary
    for ENDU. They exist only on the VAC chart. Either transcribe the VAC's
    printed coordinate table per aerodrome (which is what 1ntray did, for 23
    of them, and 23 more VACs publish their points graphically only) or get
    Avinor's AIXM 5.1 export, which likely carries DesignatedPoints properly.
    Do NOT read coordinates off a chart image.
- **National-border resolution (v16.30)**: 22 airspaces whose published
  boundary follows the national border are now DRAWN, from Kartverket's
  official line rather than a straight-line guess. Dataset: 140 -> 228
  volumes.
  - SOURCE: Kartverket's administrative-units WFS
    (`wfs.geonorge.no/skwms1/wfs.administrative_enheter`, `app:Grense`
    filtered server-side to `avgrensningstype = Riksgrense`), under **NLOD**.
    That is a SEPARATE grant from the Avinor permission - the airspace
    dataset now depends on both, and each keeps its own attribution.
  - MEASURED: 329 LineString fragments, 18 763 points, which stitch by EXACT
    shared endpoint into exactly ONE chain of 18 435 points (lat 58.88-70.09,
    lng 11.45-30.95) - the whole land border with Sweden, Finland and Russia.
    `tools/build-border.mjs` FAILS if a future run yields more than one chain:
    resolving airspace against a broken border would invent boundary.
    Committed to `tools/prepared/` so the airspace build is reproducible and
    cannot change because a WFS moved underneath it.
  - THE WALK HAS NO FREE CHOICES. The chain is a single OPEN polyline, so
    between the point nearest fix A and the point nearest fix B there is
    exactly one path along it - no "which way round" to get wrong. The
    PUBLISHED fixes replace the snapped endpoints, because the AIP is the
    authority for where the corner is and Kartverket for the shape between.
  - THE TOLERANCE IS MEASURED, NOT PICKED. Over every border-referenced
    airspace in the edition the population splits cleanly: corners genuinely
    on the land border are 0.00-1.16 NM off Kartverket's line; everything
    else is 8.44 NM or more. 2 NM sits in that 7x gap. Every resolved
    airspace records its actual `borderMaxSnapNM` so this is auditable.
  - THREE REFUSALS THAT MUST STAY REFUSALS: the Skagerrak (south of ~58.88N
    the Norway-Sweden boundary is MARITIME and Kartverket's Riksgrense is a
    LAND boundary that stops there, so Farris TMA / Koster / Bohus C snap
    8-25 NM away and no tolerance can fix it); a FOREIGN border (Halti cites
    the Finland-Sweden border, which is not in Norwegian data - snapping it
    to the nearest Norwegian border would be a silent, confident error, and
    `isForeignBorder` refuses it by name); and an implausible path (>6x the
    direct distance means a bad snap).
  - Simplification is Douglas-Peucker at 0.02 NM (37 m, 0.07 mm on a
    1:500 000 chart), so it cannot move a boundary anywhere a pilot could see.
- **A BORDER REFERENCE IS PUBLISHED TWO WAYS, AND ONE OF THEM WAS BEING
  DROPPED (v16.36 bug fix, user-spotted)**. The user looked at the ICAO chart
  and said the CTA south-east of ENDU did not match the FIR border. It did not:
  between Treriksrøset (the Norway/Sweden/Finland tripoint, 690336N 0203255E)
  and 683212N 0180734E we drew a 60 NM STRAIGHT LINE where the AIP says
  "westwards along the border between Norway and Sweden to", cutting off the
  whole Abisko salient - a boundary that does not exist, which is the exact
  failure this project is built to refuse.
  - THE TWO FORMS. One is a properly typed field, which was handled:
    `<span class="SD">Norway and Sweden</span>` + `TGEO_BORDER;TXT_NAME`.
    The other carries the whole ENGLISH SENTENCE as a REMARK ON THE PRECEDING
    VERTEX, under a marker that says nothing about borders at all:
    `<span class="SD">westwards along the border between Norway and Sweden to</span>`
    + `TAIRSPACE_VERTEX;CUSTOM_ATT27`. Measured on the 2026-06-11 edition: 40 of
    the first form, 27 of the second, and ALL 27 were silently ignored.
    `borderNameFromRemark` in `tools/aip-fields.mjs` reads it; every
    CUSTOM_ATT27 on a vertex in the edition turned out to be a border phrase.
  - Border-resolved airspaces 25 -> 41, resolved stretches -> 51. The Polaris
    CTA over the whole eastern border (Russia, Finland, Sweden) now follows the
    surveyed line: 58 ring points -> 1261, worst snap 0.236 NM.
  - THE DIRECTION WORD IS DELIBERATELY NOT PARSED. "southwards"/"westwards" is
    confirmation, not information - the prepared border is a single OPEN
    polyline, so between the fix nearest A and the fix nearest B there is
    exactly one path and no way round to choose. Parsing it would add a second
    thing that can disagree with the geometry.
  - **THE INVARIANT THAT WOULD HAVE CAUGHT IT ON DAY ONE, and it is now a build
    error, not a warning**: count every border reference the SOURCE states, in
    both forms, and require `resolved + refused + notDrawn == published`. It
    reconciles at 67 = 51 + 11 + 5. Every count in the old report looked
    healthy precisely because nothing knew to expect the missing 27. Two things
    it immediately exposed while being written: references in airspace that is
    never drawn (the FIR cites three borders) need their own bucket, and a
    refusal returns from `ringOf` IMMEDIATELY - so the references AFTER the
    failing one are never visited. Halti states two and only the first was ever
    seen; `refuse()` now books `refsHere - resolved.length`.
  - A COST, and it is the right one: `Polaris CTA (FL 115 - FL 660)` is now
    REFUSED (`fix-not-on-border`, 19.44 NM) because its border reference is the
    Skagerrak maritime stretch. It used to be drawn with a wrong straight line.
    Absent for a stated reason beats present and wrong.
  - Drawing cost measured in Chromium after the change: 2-22 ms per redraw at
    z7-z11, ~1400 ring points on screen. Culling is what makes a 1261-point
    polygon a non-issue; do not "optimise" the 0.02 NM simplification instead.
- **ATS DELEGATION AREAS ARE NOT AIRSPACE (v16.36, user-spotted)**. The user
  asked why a "FIR" called Silver 1 / Silver 2 was on their map when they have
  no use for non-Norwegian airspace. They were right twice over.
  - WHAT THEY ARE: ENR 2.2 **section 5** publishes the areas where Norway and a
    neighbour have agreed, by bilateral letter, to transfer WHO PROVIDES THE
    SERVICE. The airspace itself is unchanged and already drawn. Silver 1 and 2
    are inside **SWEDEN FIR**; Halti and Manto inside HELSINKI FIR; Area II
    inside SCOTTISH FIR. **13 of the 17 are inside a foreign FIR.**
  - Drawing them as class-C volumes with a vertical band made them look like
    controlled airspace to clear. Their bands are mostly FL 95 and above, which
    a C182 never sees, so they were pure noise even where Norwegian.
  - **THE DISCRIMINATOR IS THE SOURCE'S OWN MARKER, NOT THE NAME.** A
    delegation row carries `TORG_AUTH` - the organisation authority - twice:
    the FIR the area lies WITHIN (`TXT_NAME` whose trailing text is "FIR") and
    the responsible state. Measured: `TORG_AUTH` appears on exactly 17 rows in
    exactly one page, and they are exactly the 17 delegation areas. No name
    matching, no section-offset arithmetic.
  - THE CONFIRMATION THAT IT IS COMPLETE: the `OTHER` catch-all kind is now
    **empty**. Every unclassified blob in the edition was one of these, which is
    why they had no type to classify in the first place.
  - Nothing is discarded: `report.delegations` keeps all 17 with `withinFir`
    and `atsBy`, and each is reported in `skipped` with the reason
    `ats-delegation-not-airspace` and that detail. Features 227 -> 212.
- **STEPPED AIRSPACE: EACH BAND HAS ITS OWN RING (v16.30 bug fix)**. This was
  wrong in v16.29 and it is the worst kind of wrong - 71 of 164 polygons
  crossed themselves, each drawing an airspace that does not exist.
  - ENR 2.1 states, per airspace: vertices, volume, class, THEN the next
    volume's vertices, volume, class. A stepped TMA is several sub-volumes and
    EACH HAS ITS OWN LATERAL RING as well as its own band and class (Flesland
    TMA has 11). Concatenating a block's vertices into one ring merges those
    separate areas into a bow tie.
  - AD 2.17 USES THE OPPOSITE LAYOUT: every ring first, then every volume. So
    the per-volume walk gives volume 1 everything and the rest nothing.
    Recovered by the source's OWN delimiter: A PUBLISHED RING CLOSES BY
    REPEATING ITS FIRST VERTEX. Verified corpus-wide - for 143 of 144 blocks,
    splitting on closure yields exactly as many rings as volumes. The closure
    split is applied ONLY when a volume came back empty, so ENR 2.1's explicit
    per-volume association is never second-guessed; a block where ring count
    and volume count disagree is refused and reported, not paired by guess.
  - A test now checks EVERY ring for self-intersection. It is 0 of 228. The
    v16.29 "duplicate volumes" dedupe was masking this bug: those were not
    duplicates, they were distinct sub-volumes all given the same wrong ring.
- **AIP FIXES: AERODROMES AND REPORTING POINTS (v16.34, roadmap item 3 —
  BUILT)**: 53 aerodromes and 243 VFR reporting points, clickable on the map
  and searchable by name. `src/lib/anchors.js` (pure: search, culling, the
  waypoint an anchor becomes), section 2e of the page, `tools/aip-vac.mjs`
  (pure parse) and `tools/build-vac.mjs` (fetch + validate + report).
  - REPORTING POINTS ARE NOT IN THE eAIP HTML — verified against ENDU's full
    189-marker vocabulary. They exist only on the VAC, whose PDF has a TEXT
    LAYER, not a scan. `AD 2 <ICAO> 6-1 "Visual Approach Chart - ICAO"` in the
    AD 2.24 chart table gives the graphic id; the PDF is at
    `<edition>/graphics/<id>.pdf` (NOT under `html/`). Read from the AD 2.24
    ROW TITLE, not by scanning links: an AD 2 page links 4 to 103 charts.
  - **THE PARSE RULE IS A COLUMN AND A FONT, NEVER PROXIMITY.** This is the
    whole trick. Reading the nearest text item left of a coordinate is WRONG:
    the chart's artwork overlaps the table, so spot heights ("355", "1388"),
    tick glyphs and symbol-font mojibake sit BETWEEN a point's name and its
    latitude. Measured: nearest-left lost the name on 30 of 244 rows and
    returned chart symbology for 8 more. Instead coordinate pairs are clustered
    by page and x, and the name column is the (x, fontName) combination
    appearing on the most rows of that cluster. One column, one font, one table
    — 244 of 244 rows named, 0 suspect.
  - THAT ALSO DISPOSES OF THE MOJIBAKE the v16.30 survey warned about
    ("CHANGES: 0$*9$5"). Some VACs draw symbols with a custom font encoding
    that extracts as garbage, but it is always a DIFFERENT font from the
    table's, so the font consensus excludes it STRUCTURALLY rather than by
    blacklisting characters that happen to look wrong today.
  - TWO INDEPENDENT CROSS-CHECKS, both asserted at build time and re-asserted
    on the shipped data:
    1. **GRATICULE: 244 of 244.** The VAC labels its own lat/long grid on the
       sheet border — a different part of the document from the table — so a
       coordinate inside that range was read correctly. A corrupted digit lands
       off the sheet. This is the real coordinate check.
    2. **NAME ECHO: 237 of 244** names appear a second time in the same PDF as
       a drawn chart label. Of the 7 that do not, 5 are shared coastal points
       (FLATHOLMEN, TUNGENES, BOKN VEST/ØST, SKUDE) tabulated on one sheet and
       DRAWN on the neighbouring aerodrome's — corroborated across two charts.
       This is a corroboration, not a gate, precisely because a sheet-edge
       point legitimately has no label.
  - THE ARP BOUND IS A CORRUPTION GUARD, NOT A MEASURED TOLERANCE, and the
    difference matters. The border could pick 2 NM because its population split
    with a 7x gap; here all 244 points lie 0.7-30.0 NM from their ARP on a
    SMOOTH distribution (p50 8.3, p90 14.6) — that is just what a VAC covers,
    with no outlier group to cut off. So MAX_ARP_NM is 60, twice the observed
    max: it cannot reject real data and still catches the failure it exists for
    (a misread digit moves a point a whole degree). Each aerodrome records its
    own `maxPointNM` so this is auditable.
  - WHAT IS ABSENT IS SAID, NOT APPROXIMATED. **29 of 53 aerodromes publish
    their reporting points on the chart face only**, with no coordinate table:
    24 VACs carry no table, 7 aerodromes have no VAC, and ENSG prints ONE
    stray coordinate which is refused as `not-a-table` (with a single row there
    is no column consensus, so whatever sits left of it would become a
    reporting point). Those aerodromes still ANCHOR — the ARP is a tagged field
    on every AD 2 page — they simply have no points, and `anchorCoverage`
    reports the split so a pilot is not left assuming the list is complete.
    Reading coordinates off a chart image stays refused.
  - CLICK, NOT HOVER — the OPPOSITE choice from the airspace overlay, for a
    stated reason. An airspace polygon covers most of the map, so a click
    handler there would break route building; a fix is a 9 px symbol, so a
    click is unambiguous and IS the useful gesture. Leaflet markers do not
    bubble clicks to the map the way paths do, so the map's own add-waypoint
    handler never also fires — verified in Chromium: one click, one waypoint,
    no naming dialog. The LABEL is `pointer-events: none`; a wide text label
    beside the symbol would otherwise swallow clicks meant for the map or the
    route line.
  - NO DIALOG ON ADD, deliberately: clicking bare map must ask for a name
    because there is nothing to name the point after, but a fix ALREADY has its
    published name. An AERODROME as the first waypoint also sets the flight's
    `depElev` to its published field elevation — leaving the two disagreeing
    would put the climb profile on the wrong datum. (ENDU publishes 254 ft,
    which is what the seed route already used.)
  - SEARCH FOLDS Æ Ø Å ONTO ASCII, both sides, so SORKJOSEN finds SØRKJOSEN.
    An aerodrome answers to its ICAO **and** its published name (`folds[]`),
    because a pilot who does not know the code has only the name. Ranking:
    exact ICAO/name, then prefix, then substring, aerodromes ahead of points at
    equal strength, and within a rank NEAREST THE MAP CENTRE first — BREIVIKA
    exists at both Tromsø and Evenes.
  - THE CHART RASTER IS STILL NOT GEOREFERENCED. The PDFs carry no GeoPDF
    markers (/Measure, /GPTS, /Viewport all absent), so a VAC overlay remains
    out of reach. This is the coordinate TABLE only.
  - `pdfjs-dist` is a devDependency — needed to PREPARE the data, never to run
    the planner. `tools/prepared/vac-points.json` is COMMITTED, same
    arrangement as the border, so `npm run build:aip` reads a snapshot and a
    re-run cannot silently change a published coordinate. build-aip WARNS if
    the snapshot's edition differs from the airspace edition.
  - jsdom cannot prove a marker is visible or that a click does not bubble.
    `tools/verify-fixes.mjs` drives real Chromium offline and MEASURES:
    every map control's rect (the v16.22 lesson — two buttons once shipped at
    y=900 on a 900 px viewport), every symbol on-screen, every label
    click-through, one click adding exactly one waypoint on the published
    coordinate with no dialog, the hover card's size and content, the zoom
    thresholds (aerodromes at 7, points at 9, nothing at 6), and that bare-map
    clicking still works. NOTE its zoom checks MUST use
    `setView(..., {animate: false})` and settle: with the default animation
    `getZoom()` reports the OLD zoom for a frame, which made the first run read
    15 fixes at zoom 6 and 0 at zoom 7 — exactly inverted.
- **MAP SETTINGS, AND THE FIX SYMBOL AS A PREFERENCE (v16.35, user request)**:
  the settings modal is now TWO PAGES - `✈ Aircraft & Units` and `🗺 Map` -
  and the fix symbol's shape, colour, size, fill style and labels are settings
  with a live preview. `showSettingsPage()`, `readFixStyleForm()`,
  `populateMapSettingsForm()`, `updateFixPreview()`, `resetFixStyle()` in
  section 2f of the page; `normaliseFixStyle`, `fixSymbolSvg`, `fixMarkerHtml`
  in `src/lib/anchors.js`.
  - WHY IT IS A SETTING AT ALL. v16.34 drew reporting points in the same muted
    green as the TIZ boundaries, which is exactly backwards: the overlay should
    be quiet enough to read the chart through, but the thing you are trying to
    CLICK should not be. Rather than pick a second colour and be wrong again,
    the user asked for it to be configurable. The DEFAULT is now ORANGE
    (#dd6b20) for a stated reason - nothing on either base chart or in the
    airspace palette is orange except the mandatory zones, so it cannot be
    mistaken for published chart ink.
  - THE SYMBOL IS INLINE SVG, NOT CSS, and that was forced by the settings.
    v16.34 drew the aerodrome as a bordered div and the reporting point as a
    CSS border-triangle. A border-triangle has a ZERO-SIZED BOX by construction
    - it is drawn entirely from borders - so it could not be measured, could
    not be resized from one number, and made `tools/verify-fixes.mjs`
    special-case it. One `<svg>` at `viewBox="0 0 100 100"` has a real box at
    every size and one attribute swaps the shape.
  - THE HALO IS `paint-order="stroke"`, so the white stroke is drawn UNDER the
    fill and the symbol keeps its full colour area. Same lesson as the v16.28
    TOC/TOD ticks: a halo drawn AROUND a small shape leaves almost no colour
    once antialiased. Stroke widths are in the 100-unit space so they scale
    with the symbol instead of vanishing at 6 px and swamping it at 18.
  - **AN UNVALIDATED COLOUR IS AN HTML-INJECTION VECTOR**, and this is the real
    reason `normaliseFixStyle` exists. The colour is interpolated into the SVG
    that becomes a marker's `innerHTML`, AND it is in PROFILE_KEYS, so it can
    arrive from a route file someone else wrote. Colours must match
    `^#[0-9a-f]{6}$`, shapes must be in FIX_SHAPES, the size clamps to 6-18,
    and anything else falls back to the DEFAULT - never to invisible markup.
    Values are stored already-validated and re-validated on every read, because
    localStorage can be hand-edited. Both jsdom and Chromium assert that a
    hostile colour neither executes nor blanks the symbol.
  - SIZE BOUNDS ARE MEASURED, not picked: below 6 px the symbol is not a
    reliable click target, above 18 px it covers the chart it is meant to sit
    on. The page says both, rather than presenting a slider with mystery ends.
  - THE LABEL DOES NOT FOLLOW THE THEME, and v16.34 got this WRONG. It shipped
    a `body.dark-mode .fix-label` override putting pale blue text with a dark
    halo on the map - but BOTH base charts are light rasters in dark mode too,
    so the label was invisible in exactly the case it exists for. It was hidden
    during development because the offline placeholder background is grey.
    `.wp-label` has no dark override for precisely this reason; `.fix-label`
    now matches. The label also does NOT take the symbol's colour: a bright
    orange is right for a 10 px shape you are hunting for and wrong for text
    you have to read.
  - THE KIND IS ON THE ICON (`fix-icon fix-ad` / `fix-rp`), not only in the
    markup: with labels turned off there is otherwise nothing to tell an
    aerodrome from a reporting point, in CSS or in a browser check. The first
    run of the new Chromium checks read the aerodrome marker and reported the
    reporting-point colour as unchanged - a test passing for the wrong reason.
  - WHAT DELIBERATELY DID NOT MOVE TO THE MAP PAGE: the layer toggles, the base
    chart and the chart-detail cap stay on the MAP, beside what they change -
    they are used while planning, not set once, which is the whole basis for the
    split. The zoom thresholds are not adjustable and the page SAYS SO with the
    reason, rather than leaving a gap where a setting looks like it should be.
    The quoted numbers are read from the modules, so they cannot drift from the
    code.
  - The PREVIEW renders through `fixSymbolSvg` - the same function the map calls
    - so what it shows is what gets drawn. A preview built from its own markup
    would drift from the map the first time either changed.
- **Airspace OVERLAY (v16.31, roadmap item 4 COMPLETE)**: `src/lib/airspace.js`
  (pure: culling, colours, hover text) plus the Leaflet layers in section 2d of
  the page. 228 volumes available, ~11 drawn over Troms at z9.
  - THE DATASET IS INLINED at an `@AIPDATA` marker into BOTH deliveries, not
    loaded with `<script src>`: a file:// page can neither fetch() it nor load
    a module, and one code path means the service worker needs no extra shell
    asset for the overlay to work offline. dist is 533 KB -> 756 KB.
  - PANE ORDER IS LOAD-BEARING. Airspace draws in its own pane at z-index 380,
    BELOW Leaflet's overlayPane (400) which holds the route line. If it sat
    above, a press meant for a leg would hit an airspace polygon first and
    bubble to the map as "add a waypoint" instead of bending the line. Verified
    in Chromium with a real drag: via created, waypoint count unchanged.
  - HOVER, NOT CLICK, and this is the whole interaction design. Clicking the
    map adds a waypoint and airspace covers most of the map, so a click
    handler on the polygons would break route building inside every TMA. The
    polygons carry a tooltip, have NO click handler, and leave
    bubblingMouseEvents at its default so the click reaches the map untouched.
    A test asserts all three.
  - CULLING IS NOT OPTIONAL: nothing below zoom 7 (at country zoom 228
    polygons are a wash that hides the CTRs that matter) plus a bbox
    intersection test, redrawn on moveend/zoomend. Largest drawn first so a
    CTR inside a TMA is not buried. Fill opacity 0.07 - the ICAO chart
    underneath is the thing being read.
  - THE HOVER CARD IS A CARD, NOT A PARAGRAPH (v16.32, user request). Name +
    class chip, the kind, the vertical band emphasised (it decides whether the
    airspace is even relevant), then a 3-column grid: service tag, frequency,
    callsign. The accent colour is the polygon's own so the card cannot be
    mistaken for the airspace next to the one under the cursor.
  - FREQUENCIES ARE PAIRED WITH THEIR SERVICE, and that needed an IMPORTER
    change: v16.31 flattened every frequency in a block into one list, which
    loses the only thing that makes them usable - which is the tower and which
    is a military UHF channel. `TSERVICE;CODE_TYPE` (AD 2.18) gives the code
    (APP / TWR / ATIS / AFIS / SMC / CLR / RADIO) and document order pairs it
    with its callsign and frequencies. ENR 2.1 and 2.2 do NOT tag a service,
    so the code is derived from the published callsign there ("Banak
    Approach" -> APP, "Longyear Information" -> AFIS) and left null if it
    matches nothing.
  - WHAT THE CARD SHOWS: ATIS, APP, TWR, AFIS. Hidden: CLR, SMC, RADIO, TFC -
    a C182 planning VFR is not calling clearance delivery or surface movement.
    ACC is a FALLBACK, shown only when an airspace has none of the four:
    Hammerfest, Helgeland and Lofoten TMA have no local approach and are worked
    by Polaris Control, so hiding it would leave CONTROLLED airspace with
    nobody to call. A CTR with TWR and APP never gains a Polaris row.
  - MILITARY: the source's `MIL` remark is NOT sufficient - only six
    frequencies in the whole edition carry it, and ENDU TWR publishes 243.000
    with no marker at all. The civil VHF band (118-137) is the real filter,
    because military air is UHF 225-400; the MIL flag is applied on top to
    catch a military VHF channel. 121.500 and 243.000 are dropped as guard:
    every pilot knows them and they appear under almost every service.
  - THE ATIS LABEL IS DELIBERATELY NOT THE PUBLISHED CALLSIGN. Norway
    publishes ENDU's ATIS as "Bardufoss Information", which reads exactly like
    the AFIS service you would talk to - and Bardufoss has a TWR, not an AFIS.
    An ATIS row is labelled `<ICAO> ATIS`: you listen to an ATIS, you do not
    call it, and "Information" is reserved for AFIS where it means a station
    that answers. The published callsign stays in the dataset.
  - NO "+N hidden" REMARK (user request). It was noise. NOTHING is dropped
    from the DATA - `services` carries every published service and frequency,
    including CLR and the UHF - it is purely a display filter, and a test
    asserts both halves of that.
  - The flat `freqs`/`callsigns` arrays were REMOVED once `services` existed:
    68 KB of pure duplication in a sidecar that ships in both deliveries.
  - TWO CSS TRAPS, both found by MEASURING a real tooltip: Leaflet tooltips
    are `white-space: nowrap`, so the frequency line ran off the card; and
    overriding to `normal` ALONE collapsed the card to 64px wide by 392 tall.
    `width: max-content` with a `max-width` is the fix, and it is the same
    pattern `.wp-label` already uses.
  - The v16.x test guarding "the airspace overlay stays removed" was about
    OPENAIP specifically - community data that lagged the chart. It now guards
    the openAIP tile endpoint and key field, still asserts the old
    localStorage purge is present, and additionally requires the replacement
    to name its edition. Drawing airspace was never the objection; drawing
    unofficial airspace was.
  - jsdom's Leaflet stub needed createPane/getPane/getBounds/polygon/
    bindTooltip/setStyle. It also kept only the LAST handler per map event, so
    adding moveend/zoomend silently disabled the declutter tests - the stub now
    keeps a list and `__fireMap(ev)` fires them all, like the real map.
- **A ROW IS A POSITION, NOT A SERVICE CODE (v16.60, the pilot's question: "why
  does ENGM have so many approach frequencies?").** `collectServices` unioned
  every service sharing a code into ONE row and labelled it with the FIRST
  callsign it found. At the 47 aerodromes publishing one approach position that
  is the same thing; at the six that publish several it is a plausible wrong
  answer. Gardermoen read
  `APP · Final · 128.905 · 119.980 · 118.480 · 129.305 · 136.405 · 120.455`,
  and a pilot would call Final on 118.480, which is Oslo Approach sector E.
  - IT IS THE v16.32 RULE UNAPPLIED TO ITS OWN SURFACE. That entry says a
    frequency is only usable PAIRED WITH ITS SERVICE, and made the IMPORTER keep
    the pairing - then the DISPLAY threw it away again. Same shape as v16.33
    (all 26 Polaris frequencies, no position) and v16.42 (a prose frequency
    landing on the last APP service). Grep for every surface when a rule is
    added.
  - **VERIFIED AGAINST THE SOURCE, NOT AGAINST OUR OWN DATASET.** AD 2.18 for
    ENGM carries four separate `TSERVICE;CODE_TYPE = APP` blocks - Final
    128.905, Oslo Approach 118.480 "Oslo TMA sector E", Director 136.405, Oslo
    Approach 120.455 "sector W". The long list was faithful; the label was not.
  - **TWO SPELLINGS OF ONE POSITION MUST STILL MERGE.** Ørland publishes
    "Ørland Approach/radar" AND "Ørland Approach/ Radar" in the same edition, so
    the split is keyed on the callsign normalised for case, spacing and
    punctuation. Splitting naively invents a second position at ENOL - a test
    asserts both halves.
  - **A STANDBY FREQUENCY IS NOT ONE YOU DIAL.** 103 of 1673 are published `HO`
    with "AVBL only when <primary> U/S". Off the card, kept in the data, exactly
    like the guard frequencies. This is what pays for the extra rows: ENBR's
    card actually got SHORTER.
  - **TWO PUBLISHED SERVICES WERE INVISIBLE, and a regex was the reason.** ENR
    2.1/2.2 do not tag a service type, so a TMA's code is derived from the
    callsign - and "Final" (Oslo TMA 128.905) and "Sola Arrival" (Sola TMA
    119.405) matched nothing, got `code: null`, and the card collects by code.
    `codeFromCallsign` now knows both words. The re-import reproduced the
    2026-09-03 edition EXACTLY - same 212 features, 27 sectors, 53 aerodromes -
    with nine `null -> APP` changes and nothing else, which is why it was safe
    to run. A test now asserts NO published service with a dialable frequency
    reaches no card: it is 0.
  - **THE COST WAS MEASURED IN THE BROWSER BEFORE IT WAS ACCEPTED**, because the
    pilot's question was "will it clutter my screen". ENGM 290x133 -> 249x173:
    40 px taller, 41 px NARROWER, and it is the worst card in the country. 174
    of 212 airspaces are unchanged, Tromsø and Bardufoss among them; only ENGM
    reaches 6 rows.
  - **THE PUBLISHED REMARKS WERE MEASURED AND REJECTED.** Showing "sector E/W"
    beside a frequency sounds obviously right; only 6 of 31 distinct remarks on
    shown frequencies are sector letters. The rest is operational prose -
    "IFR TFC only" (15 frequencies), "Remote AFIS is provided from RTC Bodø",
    telephone numbers - so a sector-letter regex would surface the minority and
    hide the one that matters most to a VFR pilot. Showing every SHORT remark
    instead costs +50 px at ENGM and widens TROMSØ by 62 px, a card that is
    otherwise untouched. Left out; say so rather than leaving it looking like an
    oversight.
  - NOTHING TESTED THE PAIRING BEFORE THIS. The whole suite passed while ENGM
    was wrong. The new invariant walks EVERY row of EVERY feature and requires
    the frequency to be published by a service whose callsign is that row's
    (351 frequencies checked).
- **ACC SECTORS: THE RIGHT POLARIS FREQUENCY, BY POSITION (v16.33)**. Hovering
  Polaris CTA printed ALL 26 VHF Polaris frequencies, which tells a pilot
  nothing. The CTA is ONE airspace over the whole country, so its published
  block genuinely does list every sector. ENR 2.2 publishes each sector as its
  own airspace with its own lateral boundary, so the sector under the cursor is
  a LOOKUP. 27 of 29 imported at 2026-09-03 (`sectors` in `data/aip.js`); they
  are NOT drawn -
  an en-route sector division far above a C182 would bury the CTRs and TMAs.
  - THE eAIP NAMES AN ACC SECTOR IN THE **LAST** CELL OF ITS ROW, where ENR 2.1
    and AD 2 name it in the FIRST. Grouping on the name marker therefore shifted
    every ENR 2.2 sector's data by one row and put Sector 2's frequency on
    Sector 1 - a plausible wrong frequency, the exact failure mode this project
    refuses. `extractFields` now records each span's enclosing table `row`
    (binary search; ENR 2.1 has ~4900 spans and a linear scan per span is
    quadratic), and `airspaceBlocks` detects the orientation PER ENTRY by
    whether the row's first vertex precedes or follows the name. Measured: ENR
    2.2 is mixed, 35 name-first and 30 name-last, and the name-last run is
    exactly the Polaris ACC sector table. A pure row-grouping fix was tried
    first and REGRESSED `no-published-vertical-limits` from 1 to 50, because the
    table uses `rowspan`.
  - THE REMARK CROSS-CHECK IS A DESIGNATOR MATCH, NOT STRING EQUALITY. The
    remark opens by naming the sector(s) and anything after the first full stop
    is free text: "Sector 9/12" is ONE frequency working TWO combined sectors,
    and "Sector 17. The radio coverage in the ISVIG area ... may be marginal."
    carries a real operational note. Strict equality refused 8 legitimate
    sectors. Only the leading phrase is read (or "FL100/180NM" in the prose
    starts matching sector numbers) and it is compared as WHOLE TOKENS, so "1"
    cannot match "15/16". `remarkDesignators`/`designatorTokens`/`remarkNote`
    live in `tools/aip-fields.mjs` and are unit-tested.
  - **THE GEOMETRY MAY ONLY SELECT, NEVER ASSERT.** A resolved sector's
    frequency is shown only if it ALSO appears in the hovered airspace's own
    published list, so the card can never state something that airspace does
    not state. Measured over a grid of every point inside a Polaris CTA volume:
    **1648 of 1648** sector hits corroborated. Independently, the lookup
    reproduces the AIP's own per-airspace pairing at 24 of the 31 airspaces
    publishing exactly one sector frequency - and the other 7 do not matter,
    because an airspace that publishes ONE frequency never consults the
    geometry at all. That is deliberate: Sogn TIA is published as Sector 17's
    even though two sub-volumes reach east into Sector 6/7 territory, and the
    AIP's own statement about its own airspace wins.
  - THE CROSS-CHECK THAT SETTLED IT: Sørkjosen TIA - a small airspace right
    where the user hovers - publishes exactly ONE ACC frequency, 126.705
    "Sector 26". The point-in-polygon lookup on the sector rings returns Sector
    26, 126.705. Two independent parts of the same edition agree.
  - VERTICAL BAND IS NOT USED TO EXCLUDE A SECTOR, and that is a decision:
    comparing a published FL against an altitude AMSL needs a QNH the planner
    does not have. Where the AIP stacks sectors (23 GND-FL 85 under 27
    FL 285-UNL) BOTH rows are shown, each labelled with its band, lowest first.
    ~85% of positions resolve to one sector anyway; the band is only used to
    ORDER rows, where a wrong answer is untidy rather than wrong.
  - UNRESOLVED IS SAID, NOT PAPERED OVER. Sectors 3 and 4 are refused
    (`fix-not-on-border`, 19-25 NM): their boundary follows the MARITIME
    Norway-Sweden line in the outer Oslofjord, which Kartverket's LAND
    Riksgrense does not contain - the same structural refusal as Farris TMA.
    Over the Oslofjord the card shows NO frequency and points at ENR 2.2.
    "No position yet" (the tooltip's initial content) is a THIRD state and says
    something different, because claiming the sector is missing would be false.
  - jsdom CANNOT PROVE THIS. The card is rebuilt on `mousemove` (keyed on the
    resolved sector list, so the markup is regenerated when the cursor crosses a
    boundary, not per pixel). `tools/verify-airspace-hover.mjs` drives real
    Chromium offline: hovers a Sector 26 point and a Sector 25 point, asserts
    ONE row each with the right frequency and not the other's, drags across the
    seam in one continuous motion and asserts the card re-resolved, and
    re-asserts that a click inside the airspace still reaches the map.
  - 227 features (was 228): Ørje 2 publishes ONE volume, and the old rule had
    given it two wrong bands. A correctness improvement, not a loss.
- **Not planned** (verified dead ends): NOTAM (no reliable free API),
  georeferenced VFR charts (licensing), traffic (needs receivers).
  auto-METAR from aviationweather.gov: re-checked Sep 2026 and it sends
  NO CORS header, so it is genuinely unusable from a browser - MET Norway
  is used instead, and is the authoritative source for Norway anyway.

## DEFERRED: known nits and small bugs (v16.39)

**See also `AUDIT.md`** (the read-only deep audit of v16.41, with the author's
answers inline) and roadmap items 11-17, which are the ORDERED plan for it. The
audit deliberately did not re-report anything on this list, so the two do not
overlap - it did add that deferred nit 4 (`tocNM` ignored on a leg with no climb)
applies equally to `bocNM` and to `bodNM` on a leg with no descent: measured over
6 000 routes, 434 ignored TOC, 758 ignored BOC and 3 221 ignored BOD pins. One
fix covers all three.

The user's instruction: "we will iron out all the small bugs and nitpicks
later, make sure you keep track of all the small details that can be ironed
out." This is that list. Everything here is OBSERVED, not speculative - each
line says what was measured or reproduced. Nothing here is urgent; nothing here
is forgotten.

### Real bugs, in rough order of how wrong they are

1. **A SPILLED DESCENT MISREPORTS THE LEG ALTITUDES.** Reproduced on
   `ENDU(254) -> A(8000) -> B(2000)` with a 3.6 NM final leg: the descent backs
   up 20.4 NM onto leg 0, so the aircraft actually crosses A at roughly 2900 ft,
   but leg 0 reports `exitAlt 8000` and leg 1 reports `entryAlt 8000`. Time,
   fuel and the TOD position are all correct - only the entry/exit figures are
   the PLANNED values rather than the flown ones. Pre-existing since v16.5, and
   it is why v16.38 chose "raise the previous fix" over spilling a climb
   backwards rather than adding a second place where the altitude column lies.
   Fixing it means deciding what an OFP row should say when the plan is only
   flyable by crossing a fix off its stated altitude.
   - **STILL OPEN AT v16.77, AND STILL WORTH SAYING PLAINLY.** v16.77 removed
     everything that CHANGED a stated altitude; it did nothing to make a spilled
     descent's stated altitudes true. What it did change is the priority: the
     pilot's own reading is that "the planned altitude on my OFP isnt really a
     super restricting value... not the exact altitude i will have at that
     point", so a plan figure differing from the flown height is a nit rather
     than the accuracy failure it looked like. Measured live at v16.76:
     `ENDU 254 -> A 8000 -> ENTC 2000` (72.3 / 18.1 NM) crosses A at ~6 525 ft
     while the column says 8 000, with no banner.
2. **SPLITTING A PINNED LEG LEAVES THE PIN ON THE SECOND HALF, MEASURED FROM A
   NEW FIX.** `insertWaypointOnLeg` copies alt/OAT/wind from the waypoint it
   inserts before (correct) but does not touch `bocNM`/`bodNM`/`tocNM`.
   Reproduced: a 12 NM BOC set on a 54 NM ENDU->MID leg becomes a 12 NM BOC on
   the 27.1 NM NEW->MID leg - the same number now means something the pilot did
   not ask for. The v16.27 via-splitting rule (`via.slice`) is the precedent:
   decide which half each pin belongs to, or clear them and say so.
3. **A PIN IS CLAMPED ON READ, NOT ON EDIT.** `pinNM` clamps to the leg length
   every time, so shortening a leg by dragging a waypoint quietly caps the pin -
   and lengthening it again restores the original value. Defensible, but the
   pilot is never told the pin moved.
4. **A `tocNM` on a leg with NO climb is silently ignored** (the else branch in
   the forward pass). It should say so, the way a refused BOD does.

### Absent data, each for a stated reason (need a new source, not a fix)

5. **The Skagerrak maritime boundary** is not in Kartverket's LAND Riksgrense,
   so these stay refused: `Polaris CTA (FL 115 - FL 660)`,
   `Polaris CTA (FL 155 - FL 660)`, Farris TMA (3 volumes), Bohus C, Koster,
   and Polaris ACC Sectors 3 and 4 (so the hover card names no sector over the
   Oslofjord). Needs a maritime-boundary dataset; all of it is southern Norway.
6. **Halti** cites the Finland-Sweden border, which is not in Norwegian data.
7. **18 offshore HTZ/ADS are published as a circle radius**, not a polygon
   (`insufficient-coordinates`). Needs arc/circle support in `ringOf`.
8. **29 of 53 aerodromes publish their reporting points on the chart face
   only.** Needs Avinor's AIXM 5.1 export, or per-aerodrome VAC transcription.
   ENSG additionally prints ONE stray coordinate, refused as `not-a-table`.

### Cosmetic and UX

9. ~~**BOC/BOD map chips share the TOC/TOD colours**~~ - DONE at v16.73: a top
   is a tick across the track and a bottom is a ring on it. The colour still
   says which phase; the shape now says which end.
10. **The leg panel's "Insert one where I right-clicked" discards unapplied
    pins** - it closes the panel to open the naming dialog.
11. **"Save & Recalculate"** is aircraft-centric wording for a button that now
    also saves the Map page.
12. **The fix-style preview background** is a beige gradient standing in for
    chart paper; it reads as a strip in light mode.
13. **`verify-visual.mjs` always reports 2 problems on a version bump** (the
    8x8 badge). It could accept a known badge region rather than needing the
    diff read by hand every time.

## Roadmap (the user's list, v16.28, extended v16.41 - NOT yet agreed in detail)

Written down so it is not lost. NOTHING here is built, and none of it is
approved for implementation without asking first - several items need
verification work under the NO GUESSTIMATES rule before they can even be
scoped. In the user's order:

1. **DONE at v16.37** - right-click the track -> a leg settings panel, with
   BOC and BOD placeable. See "PINNED CLIMB AND DESCENT CORNERS" above.
   The insert-a-waypoint gesture moved INTO the panel rather than being
   replaced, so nothing was lost.
2. **DONE at v16.61** - an editable radius ring (default 1 NM) around the whole
   track, for MSA planning. See "The corridor ring" above. Radius and
   transparency are Map settings; it draws geometry only and computes no MSA.
3. **DONE at v16.34** — AIP reimplementation with anchored waypoints:
   aerodromes with their reporting points and the information for each. See
   "AIP FIXES" above. 53 aerodromes, 243 reporting points, clickable and
   searchable; 29 aerodromes publish their points graphically only and are
   reported as carrying none.
4. **DONE at v16.31** — More AIP: draw every airspace with hoverable name,
   vertical limits, class, and the frequencies plus station callsigns.
   (Data landed v16.29-v16.30; see the two AIP entries and the overlay entry
   above.) What is NOT done: reporting points (item 3), and the 23 airspaces
   still absent for stated structural reasons.
   ~~**DATA DONE at v16.29**~~
   (see the AIP airspace entry above): 140 airspaces imported from the
   official eAIP with class, limits, callsigns and frequencies. What remains
   is the planner overlay itself — a Leaflet layer per airspace kind with
   min-zoom and viewport culling (140 polygons drawn at once will choke the
   map), hover for the name, click for the detail, a layer toggle in
   PROFILE_KEYS, and the attribution line. Sourcing rule satisfied: it is
   AIP Norge, it names its edition, and permission is held.
5. **Mass & Balance from the Excel sheet.** NOTE: CLAUDE.md currently
   records M&B as explicitly OUT OF SCOPE at the user's own decision. That
   entry is now superseded by this roadmap item, but the work needs the
   real sheet and the POH arms/limits in hand before a line is written.
6. **PARTLY DONE at v16.41** - the OFP half. Print OFP now outputs the
   company "Operational flightplan" form filled from the plan; see the section
   above. The M&B half waits on item 5.

### Added v16.41 (a QoL batch, in the user's order)

Nothing below is built. The notes are what a look at the code turned up, so
whoever picks these up starts from facts rather than assumptions.

7. **DONE at v16.50** - two controls in the `#map-controls` stack: `＋ New plan`
   and an active-plan indicator that cycles. See the section below.
   ~~original entry:~~ An easy way to begin a new flight plan from the MAP-ONLY view.
   This is a real gap, not a preference: the `+ Add Flight Plan` button lives
   INSIDE `#sidebar`, and `layout-map` hides the sidebar - so in the view where
   you are actually drawing on the chart there is no way to start a plan.
   The place for it is the `#map-controls` stack (`.map-ctl`), which since
   v16.24 is a flex column where a new control needs no CSS at all. Worth
   pairing with an active-plan indicator there, because the flight switcher
   (`setActiveFlight`, the per-section Select button) is also inside the
   sidebar and equally unreachable in map-only.
8. **DONE at v16.50** - the dashes are gone; the colour and the edit-mode
   dimming carry it. See the section below.
   ~~original entry:~~ Remove the dashed track on every other flight plan.
   `refreshMap` sets `dashArray: (fIdx % 2 === 1) ? '10, 8' : null`. NOTE this
   REVERSES a stated decision - the comment there says the dash exists so an
   identical return route drawn on top of the outbound stays distinguishable.
   Ask what should carry that instead before deleting it: colour
   (`ROUTE_COLORS`) and the edit-mode dimming of inactive flights already
   separate them, so the dash may simply be redundant now. The guide says
   "every second one is dashed" and would need the same edit.
9. **DONE at v16.50** - 1-9 in `resolveKey`, below the v16.46 overlay guard
   that the trap needed. See the section below.
   ~~original entry:~~ Number keys to activate a flight plan (1-9 -> that plan).
   THE TRAP IS ALREADY IN THE CODEBASE: `dialog.js` binds 1-9 to pick a
   dialog option, and `ask()` is used everywhere. A global digit binding MUST
   stand down while a dialog is open, or naming a waypoint becomes a game of
   chance. Same for the settings/wind/help modals.
10. **DONE at v16.52** - `Settings -> Keyboard` binds every action to any key,
   and the bindings travel in the exported JSON. See the section below.
   ~~original entry:~~ General keybinds for navigation and editing.
    Only two exist today (Esc closes modals, Ctrl+Z / Ctrl+Shift+Z undo and
    redo). Two constraints are already documented in the Ctrl+Z handler and
    apply to anything added: a binding must be inert while the user is TYPING,
    and "inert in every input" is too blunt - the app's number/date/select
    fields commit on change and keep focus, so exempting them all made undo
    silently dead right after editing fuel or an altitude (verified in
    Chromium). The existing handler's `textLike` test is the precedent.
    A pure key->action resolver in `src/lib/*.js` would let the whole mapping
    be tested without a browser, which is how every other rule in this project
    is checked. Whatever is bound has to be discoverable: the Feature Guide
    and a `?` overlay, not folklore.

### The audit backlog (v16.42 - from AUDIT.md, with the author's answers)

`AUDIT.md` (committed to the repo) is the read-only deep audit of v16.41 with the
author's replies inline. It is the DETAIL; this is the ordered plan. Three
findings were re-reproduced independently before this list was written - C1, C2
and H2 all hold exactly as described.

**11. DONE at v16.43 - THE "NEVER PRESENT BROKEN OUTPUT AS CLEAN" BLOCK.**
   See "Broken output is never presented as clean" below. C1, C2, H2 and the
   half of H1 that shares the same three lines are fixed; the invariant they
   share is asserted, and the pin sweep now generates circuit stops.
   ~~do this first~~
   C1, C2 and H2 are one class, not three bugs: the project's refuse-to-invent
   discipline bypassed at an edge. C2 turns UNKNOWN into calm-and-0C, H2 turns
   INVALID into a printable company form, C1 turns STALE into planned. Fix them
   together and add the invariant they share: *a plan with missing or invalid
   inputs must not produce clean-looking output on ANY surface.*
   - **H2 is the worst of them and it is CRITICAL, not high** (it was ranked
     high). Measured: 7 cells print the literal `NaN` (`tas, tt, var, wv, wca,
     pl, gs`) because `ofpRowCells` uses `pad3`/raw `String()` where it should
     use the finite-checking `one()`; and `body > *` in the print rule hides the
     red banner, so a plan the app has declared DO NOT USE prints as clean
     company paperwork. Blank every non-finite value, and render a print-only
     "INTEGRITY CHECK FAILED - DO NOT USE" band inside `#ofp-print`.
   - **C2**: the wind matrix's `Number(x) || 0` (index.html ~2597) writes 0 into
     an EMPTY box and the banner goes from red to hidden. Refuse to save with an
     empty box and highlight it; keep `Number()` for a typed 0.
   - **C1**: a PATTERN pair leaves the forward `alt` cursor holding the previous
     leg's altitude, so the leg after a circuit is scheduled from a stale figure
     (measured: `B->ENTC` entered at 2500 ft where B is planned at 6000). It can
     HIDE a descent shortfall the banner would otherwise show. Fix the cursor,
     and add pattern waypoints to the pin sweep - it has never generated one.
**12. DONE at v16.44 - robustness of load and boot.** See the section below.
   ~~original entry:~~ H4 (a corrupt `c182_custom_routes` /
   `c182_custom_missions` throws out of the top-level script - no map, no table,
   no way back) and H7 (route load and import bypass `sanitiseFlights`, and the
   live plan is left half-assigned when the throw comes). NOTE: the author has
   ruled route files TRUSTED, which lowers H3/H7 as a SECURITY matter - but H7's
   damage is a stale or malformed file corrupting the live plan, which trust does
   not prevent, so it stays high. M1 (sanitiseFlights coerces nothing but
   coordinates, and mutates its input) is the same work.
**13. DONE at v16.46 - stuck states and dialogs.** See the section below.
   ~~original entry:~~ H5 (a line drag has no exit but a mouseup:
   Escape, blur, right-click or alt-tab leave the map stuck with dragging
   disabled) and H6 (Ctrl+Z fires while a dialog is open, then the confirmed
   action mutates a detached flight). H6 is rule 7 above, and it converges with
   roadmap items 9-10: the author's answer is *"only escape and relevant key
   bindings on dialog popups, all other keybindings disabled during popup"* -
   which is exactly the guard the 1-9 digit binding needs anyway.
**14. DONE at v16.47 - one escaper, applied everywhere.** See the section below.
   H3 and the remaining half of H1 are fixed; 17 sinks now go through the single
   `escapeText`, and the print host is emptied before the render rather than only
   refilled at the end.
   ~~original entry:~~ H3 escaping (rule 6 above) and H1 (a throw in the daylight
   card skips the banner AND leaves the previous plan's print sheets on screen -
   rule 8).
**15. DONE at v16.48 - housekeeping, one batch.** See the section below.
   M3, M4, M5 + SWEEP_N and L1-L10 are fixed; M2 had landed at v16.44 and L6 is a
   constraint on item 18 rather than a defect.
   ~~original entry:~~ Housekeeping, one batch. M4 (`build-aip.mjs` writes `data/aip.js` BEFORE
   the border reconciliation can throw, and deletes `report._border` after the
   write - L1's 1 129 KB report), L2 (`package-lock.json` says 16.33.0), L3
   (documentation drift: 61 vs 101 handlers, 24 vs 32 globals, invariants
   described as build failures that are tests), M2 (an unrecognised import file
   reports "Import complete"), M5 + a `SWEEP_N` env var so the big sweeps are
   runnable without slowing the suite (the author agreed: *"if it costs nothing
   and is a smart move, then sure"*), M3 (ETO and the daylight card disagree by
   an hour across a DST transition; cannot bite a legal day-VFR flight in Norway
   because both transitions fall in SERA night, but it is a wrong time on the
   form), L4-L10.
**16. DONE at v16.49 - the QoL list.** See the section below. Twelve items
   built, two already done (v16.43 and v16.44), and QoL 13 was not a gap - a
   Print OFP button has existed since v16.41.
   ~~original entry:~~ The QoL list in AUDIT.md section 4 (14 items): Escape/backdrop closes the
   leg panel; undo for ETD/fuel/reserve; a 13" layout default; an empty state;
   an import summary; labelled undo/redo; fix-search distance and bearing; a
   timezone statement beside the ETD field; a print-preview button; row-hover
   highlights the leg on the map. Nothing there changes a calculation.
**17. DONE at v16.54 - touch & go / full stop / fly-by.** See the section below.
   ~~original entry:~~ TOUCH & GO / FULL STOP / FLY-OVER on an aerodrome (the author's own
   feature, from the taxi-fuel question). Clicking an airport offers the three,
   and they mean different things to the plan: FULL STOP carries taxi fuel into
   the next sector (which settles the open question - taxi fuel is per full stop,
   NOT once per mission as it is today); TOUCH & GO costs only the descent and
   climb-out; FLY-OVER renames the fix from the ICAO code to the civil name
   (`ENDU` -> Bardufoss - the AIP dataset already carries `name` and `city`, so
   nothing is invented). This also settles C1's semantics: after a full stop the
   next leg climbs from the FIELD ELEVATION, after a touch & go from the circuit
   altitude - which is why C1's mechanical fix (no stale cursor) and its
   semantics are separable, and the mechanical one should not wait for this.

### 18. PUT THE PAGE SCRIPT UNDER THE COMPILER (`src/page.js`)

From a comparison against a friend's React/TypeScript planner. Most of what that
project does better is architectural and is NOT worth buying at the price (theirs
needs `pnpm dev`; this one is a file you double-click, and `dist/` is the fallback
on a machine that has never seen the app). But one finding underneath the
comparison is sharper than the comparison itself, and it is cheap:

- **`tsc` HAS NEVER SEEN THE PAGE SCRIPT.** `tsconfig.json` includes
  `src/**/*.js`; the page script lives in `src/index.html`, an `.html` file. So
  all ~4 900 lines of it are unchecked, while the 15 modules are checked with
  `strict`. That is not a JSDoc-versus-`.ts` question - the code simply is not in
  a file the checker looks at, and it explains the audit's asymmetry better than
  the architecture does: the engine is checked, the shell is not, and every high
  finding is in the unchecked half.
- **THE FIX IS THE TRICK THE BUILD ALREADY USES THREE TIMES.** Extract the script
  to `src/page.js` and inline it at a `@PAGE` marker, exactly as `@STYLES`,
  `@AIPDATA` and `@BUNDLE` are inlined. No globals need untangling, no module
  graph, no framework, and the emitted artifact is byte-identical. The code does
  not change; it becomes visible to the compiler that already guards everything
  else.
- **IT IS A STAGED CLEANUP, NOT AN AFTERNOON.** `checkJs` over 4 900 lines of DOM
  code produces hundreds of errors on day one - every `getElementById` is
  `HTMLElement | null`. Land the extraction first (build + tests unchanged), then
  turn checking on and work the errors down. Do not let that discourage it: those
  errors ARE H1 (a throw in the daylight card), M1 (string coordinates reaching
  `toFixed`) and half of L5.
- **TWO tsconfig FLAGS ARE A ONE-LINE TRY**: `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes` are the only two the comparison named that this
  project does not already run (`strict`, `noImplicitAny`, `strictNullChecks`,
  `noUnusedLocals`, `noImplicitReturns` are all on).
- WHAT THE COMPARISON GOT RIGHT AND IS ALREADY PLANNED: a validating loader with
  typed errors (items 11-12 - and it needs neither React nor `.ts`), and escaping
  at every `innerHTML` sink (item 14 / discipline rule 6 - the METAR card, the OFP
  sheet and the fix labels already do it, so it is an inconsistency, not a policy).
- WHAT IT DID NOT ESTABLISH: test COVERAGE. 347 cases in 58 files against 352 in
  one is a difference of organisation, not of what is tested. Splitting the
  5 451-line `test.js` is worth doing for navigability, but it would not have
  caught anything - the real test-quality gap is M5, asserts looser than the
  measurements that justified them.

### 19. SPLIT `test.js` (5 451 lines, 352 tests, 75 sections)

For NAVIGABILITY, and say so plainly: this closes no quality gap. The friend's
planner has 347 cases in 58 files against this project's 352 in one, and that is
a difference of organisation, not of what is tested. The real test-quality gap is
M5 - asserts looser than the measurements that justified them - and splitting the
file does not touch it. Do not let the split be mistaken for fixing M5.

- **THE SECTIONS ARE ALREADY THE SEAMS.** 75 numbered `=== N. title ===` headers,
  each a coherent group. Four natural files suggest themselves: the PURE module
  tests (no jsdom at all - they would run first and fast), the PAGE/jsdom tests,
  the DATASET tests that read `data/aip.js`, and the SWEEPS.
- **SPLIT INTO MODULES THAT RECEIVE THE HARNESS, NOT INTO SEPARATE PROCESSES.**
  One jsdom is built once from `dist/` (test.js:69) and shared by every page test,
  along with `ev()`, `SEED`, `SEED2`, `answerDialog`, `typeInDialog`, `txtOf` and
  `moduleExports`. A file-per-process runner would rebuild jsdom per file and
  multiply the slowest part of the run for no benefit.
- **THREE THINGS THE SPLIT MUST NOT LOSE**, each of which caught real bugs:
  the standalone-run guard that `require()`s every module in bare Node and CALLS
  an export (that is the hidden-globals proof - toRad, OM_LEVELS and flights);
  the source-level greps against `APP_HTML` that guard REMOVED features from
  coming back; and the `T()`-does-not-await trap - a new harness must keep the
  `TA()` semantics or fix them properly, never quietly re-introduce a runner
  where an async body reports PASS without asserting.
- **THE SWEEPS ARE THE SLOW PART** and pair with the `SWEEP_N` env var in item 15:
  split them out and the everyday run gets faster, while the big sizes quoted in
  this file become runnable on demand instead of aspirational.
- **SEQUENCE IT AFTER THE AUDIT BLOCKS (items 11-14).** Those will rewrite parts
  of this file - new invariants for the pattern chain, the wind matrix, the print
  banner, the validating loader. Reorganising 5 451 lines is easier when nothing
  in them is about to change, and a split done first would just have to be redone.

### Settled by the author in AUDIT.md - do not relitigate

- **Times are LOCAL, not UTC**, because that is what the school plans in. It must
  be clearly labelled wherever it is printed or shown.
- **Route files are TRUSTED** - shared only between trusted parties. This lowers
  the SECURITY weight of H3/H7; it does not remove the robustness work (see 12).
- **NO HARDCODED ODD VALUES.** The `|| 254` fallbacks (ENDU's elevation, four
  sites) are leftovers and come out; first-run defaults must be generic.
- **Taxi fuel belongs to a full stop**, not to the mission - see 17.
- **A dialog disables every keybinding but Escape and its own.**

## Circuit altitude, and editing a waypoint from the map (v16.40)

- **A CIRCUIT ALTITUDE IS DERIVED, NOT INHERITED.** A PATTERN stop used to take
  whatever altitude the previous waypoint happened to be at, which is not a
  circuit altitude at all. `patternAltitude` (anchors.js) is the field elevation
  ROUNDED TO THE NEAREST 100 ft plus 1000 ft - rounding the elevation before
  adding, not the sum, because that is the arithmetic a pilot does in their head
  and it differs only on a half-hundred. ENTC's published 32 ft gives 1000 ft.
  - **ENDU IS 1500 ft AND THAT IS A TOLD VALUE, NOT A COMPUTED ONE.** The rule
    would give 1300. `KNOWN_PATTERN_ALT_FT` is a table on purpose: the eAIP hands
    us elevations and NEVER circuit altitudes, so every entry in it comes from a
    person who knows the field, and the VAC stays the authority. The guide and
    the toast both say the derived figure is a default to check, and the OFP cell
    is now editable (it was static text).
  - **THE RESOLUTION RADIUS CANNOT BE AMBIGUOUS**: the two closest aerodromes in
    the dataset are ENGM and ENKJ at 14.07 NM, so a 5 NM catch cannot pick the
    wrong field, and a VFR circuit is flown within ~3 NM of the runway. A test
    re-measures that spacing so the constant fails if the dataset ever changes.
    Beyond 5 NM NOTHING is derived and the old behaviour stands - an invented
    circuit altitude is exactly the plausible wrong answer this project refuses.
- **RIGHT-CLICK A WAYPOINT TO RENAME OR DELETE IT** (`openWaypointMenu`). One
  dialog with the name pre-filled, so Rename is Enter and Delete is one click.
  - THE GESTURE HAD TO GO ON THE MARKER, and this is the trap: right-clicking
    the route LINE opens the leg panel (v16.37), and a waypoint sits on that
    line. Leaflet markers do not bubble to the map, and `L.DomEvent.stop` is
    applied as well, so exactly one panel can open. jsdom cannot prove which one
    a real right-click reaches - `verify-leg-panel.mjs` asserts the waypoint menu
    opens AND the leg panel stays closed, then renames and deletes through the
    real dialog.
  - A CIRCUIT STOP IS OFFERED DELETION ONLY. Its name is the literal "PATTERN"
    that the add-flow and the return-leg builder test for, so a renamed circuit
    stop would silently stop being one. A test guards that the option is withheld.
  - `toDMM(value, isLat)` TAKES A FLAG, NOT THE OTHER COORDINATE. Calling it
    `toDMM(wp.lat, wp.lng)` printed the latitude alone and silently dropped the
    longitude; only reading the real dialog text in Chromium showed it.

## The company OFP form as the print output (v16.41, roadmap item 6 - the OFP half)

`C182OFPMBv4.2.pdf` (committed to the repo by the user) is the flight school's
two-page form: page 1 the "Operational flightplan", page 2 Mass & Balance.
**Print OFP now prints page 1, filled from the plan.** The M&B side is NOT
reproduced - it is roadmap item 5 and needs the real sheet and the POH arms and
limits first. Half-building it would be worse than not building it, and a test
asserts nothing M&B appears on the sheet.

- **THE GEOMETRY IS MEASURED, NOT EYEBALLED.** The PDF's table body is a RASTER
  image with the text drawn over it - `getOperatorList` yields 118 vector boxes
  for the header blocks and nothing at all for the 16 numbered lines - so the
  column boundaries cannot be read out of the content stream. They were measured
  off a 200 dpi `pdftoppm` render by finding runs of dark pixels spanning >=30%
  of the sheet: 26 vertical rules, i.e. 25 columns. `COLUMN_EDGES_PCT` in
  `src/lib/ofpform.js` IS that measurement. Do not "tidy" those numbers.
- **THE GROUP HEADERS SETTLED THE ONE REAL AMBIGUITY, and the form settled it
  itself.** "ACC" spans Dist+Time and "Intermediate" spans GS+Dist+Time, which
  alone could be read either way round - and putting accumulated figures in the
  per-leg cells would put wrong numbers on company paperwork. The Fuel group
  spells the vocabulary out by carrying BOTH "Int" and "Acc" over its three
  columns, so Int(ermediate) is this leg and ACC is the running total. Measured
  the same way: the group row's own rules, at 26.07 / 34.16 / 41.34 / 51.57 /
  59.39 / 65.57 / 68.70 / 77.98 / 87.20 / 93.30 %.
- **WHICH CELLS THE TOTAL LINE WANTS WAS ALSO MEASURED**, by averaging each
  cell's darkness: the form HATCHES what it does not want filled (95% dark)
  and leaves six cells open - ACC Dist, ACC Time, Fuel Acc, Intermediate Time,
  EST and ACT. `totalKey` in OFP_COLUMNS records exactly that.
- **ONE COMPUTATION, TWO OUTPUTS.** The rows are captured while
  `renderAllFlightTables` renders the on-screen table, not recomputed, so the
  printed sheet cannot disagree with the table the pilot checked. A test
  compares the screen's sector total against the form's Total line.
- **WHAT IS BLANK IS BLANK ON PURPOSE**, and the guide says so: MSA (this tool
  has no terrain data by an explicit decision - the chart's contours and MEF are
  the reference); ATO / Diff / ACT and the block/take-off/landing times
  (actuals, and this is a ground-planning tool); Freq (AIP frequencies belong to
  an airspace, not to a leg); the alternate line. An empty box for the pilot's
  pen, never a 0 or a dash that could read as a planned figure.
- **Reg, CREW, PASSENGERS and PIC STAY EMPTY, and that is the privacy rule, not
  laziness.** Crew are people; a tail number identifies a MACHINE. PROFILE_KEYS
  must never carry either, so there is nothing to read - which is why adding a
  registration setting to fill the Reg box was rejected. A test asserts the crew
  block prints empty and that PROFILE_KEYS has not grown a reg/pic/crew key.
- **SOLID BLACK ON WHITE, and getting there needed a BLUNT rule** (v16.41, the
  pilot's correction: "the OFP looks greyed and the texting is also greyed").
  The app's theme variables reach the form's cells through the global table
  styles, so `--bg-calc` (#f7fafc) filled the boxes and `--text-main` (#2d3748)
  wrote the figures - a sheet that reads grey on paper. `#ofp-print, #ofp-print *`
  forces colour, background and border-colour, and the alternating row band was
  dropped with it.
  - **AN ID-LEVEL BLANKET RULE OUT-RANKS A CLASS**, `!important` on both sides or
    not, and that silently erased the Total line's hatching, the black CREW bar
    and the ATIS writing lines. The three deliberate fills carry `#ofp-print` in
    their own selectors now. The verifier measures both halves: every rule and
    character computes to black on white, AND those three fills survive.
- ROW HEIGHT IS MEASURED TOO: the form's 16 lines span 10.03%-55.62% of the
  sheet, which is 95.7 mm on A4 landscape, i.e. 6 mm a line. At the first
  attempt's 4.6 mm the grid filled half the page and the sheet looked cramped.
- **HOW A SECTOR READS DOWN THE SHEET** (the pilot's rule): line 1 leaves the
  DEPARTURE aerodrome for the first waypoint, the last flown leg ARRIVES at the
  destination, and a circuit hangs off the arrival aerodrome - `ENTC ->
  PATTERN x3` - carrying its time and fuel but no track, distance or speed,
  because it is not a line on the ground. Asserted end to end.
- **THE PRINT RULE HIDES EVERYTHING AND THEN SHOWS THE FORM** (`body > *` then
  `body > #ofp-print`). The first attempt listed what to hide, and the first-run
  Feature Guide printed straight over the sheet with its backdrop tinting the
  whole page: dialogs, toasts and modals are appended to `<body>` at RUNTIME, so
  no fixed list can cover them. Only rendering the PDF and LOOKING at it caught
  it - every measurement had passed.
- **`table-layout: fixed` IS LOAD-BEARING.** Without it the browser re-apportions
  the measured column widths to fit content and the sheet stops matching the
  paper. Nothing in the CSS sets a column width; they all come from the module.
- THE LINE NUMBER RIDES INSIDE THE "From" CELL, as it does on the form. Giving
  it a column of its own added a 26th column and squeezed all 25 measured
  widths.
- **ONE SECTOR PER OFP, and this is a rule the user stated explicitly**: a sheet
  carries ONE departure and ONE arrival, because that is what the form's DEP/DEST
  block means. Each flight plan gets its own sheet - ENDU-ENTC and ENTC-ENSR are
  two OFPs, never two halves of one - and its own printed page. The ONLY reason a
  sector spans more than one sheet is running out of the form's 16 lines, and
  then the continuation sheet repeats that sector's OWN aerodromes and says
  "sheet 2 of 2". Asserted twice: in the module (the 16/17-leg boundary) and in
  Chromium (three sectors, one of them long -> four sheets, four pages, no
  sheet showing another sector's fixes).
- The Total line is printed on the LAST sheet of a sector only - a running total
  printed half way through would read as the flight's total.
- jsdom has no layout, so it cannot tell whether a value fits its cell - and
  "make sure the text is sized properly to fit into the cells" is the whole
  requirement. `tools/verify-ofp-print.mjs` drives Chromium with print media
  emulated over a deliberately worst-case plan (19 legs, the longest published
  reporting-point names, 45 kt winds, five-digit altitudes) and asserts
  `scrollWidth <= clientWidth` on EVERY filled cell - 413 of them, 0 overflowing
  - then renders a real PDF and counts the pages.
- NOT REPRODUCED: the school's UiT logo. Embedding someone's letterhead into
  generated output is their call, not ours; ask before adding it.

## AIRAC updates: what re-importing actually costs (v16.42, 2026-09-03)

The dataset moved 2026-06-11-AIRAC -> 2026-09-03-AIRAC. `npm run build:aip`
rediscovered the index on its own (154 -> 155), so the discovery is doing its
job. What the cycle changed, and what it exposed:

- **THE DIFF HAS TO BE A MULTISET, NOT A MAP.** Many volumes share a name AND a
  band - "Polaris CTA (FL 115 - FL 660)" appears a dozen times - so keying a
  comparison on name+band pairs each new volume against the SAME old one and
  invents changes. The first diff claimed 41 rings had changed; every one of them
  reported the same old point count (`7 -> 40`, `7 -> 10`, `7 -> 24` ...), which
  is the tell. Compared properly, exactly TWO features differed.
- **REAL CHANGES**: Polaris ACC Sector 8 was withdrawn (verified in the source -
  "Sector 8" appears twice in the June ENR 2.2 and not once in September), and
  Norne ADS lost a vertex. 212 features, 0 added, 0 removed, 243 reporting points
  unchanged; the border invariant still reconciles at 67 = 51 + 11 + 5.
- **THE EDITION NOW CARRIES TRACKED-CHANGE MARKUP** (`<ins class="AmdtInsertedAIRAC">`
  / `<del ...>`). Checked before trusting anything: NO `class="SD"` span sits
  inside a `<del>` anywhere in the edition, so no superseded value is being
  imported. Re-check this on future editions rather than assuming.
- **A FREQUENCY WITHOUT A PUBLISHED UNIT IS NOT AN ATS FREQUENCY** - and this was
  a live wrong number, not a new one. AD 2.18's table states every frequency with
  its unit (`TFREQUENCY;UOM_FREQ`). Some PROSE paragraphs also carry a tagged
  `VAL_FREQ_TRANS` and no unit, and because frequencies pair with the preceding
  service in document order, each of them was landing on the aerodrome's last
  APPROACH service - which is one of the four the hover card shows. So the
  shipped card was telling a pilot that Kjevik Approach works 121.780, which is
  Wideroe ground handling.
  - MEASURED over the edition: 10 of 1683 frequencies have no unit, and all 10
    are prose - "Wideroe Ground Handling: 121.780", "De-icing FREQ 121.780",
    "De-ice frequency for WGH 121.955", "DEICE COORDINATOR ... FREQ 131.905".
    A clean split, so the unit IS the discriminator; `build-aip.mjs` now drops a
    unit-less frequency and the dataset carries 1673.
  - The new edition is what surfaced it: ENBR's de-icing paragraph previously
    published 131.900 as untagged prose and now publishes 131.905 with a real
    marker, so it entered the dataset for the first time and made the pattern
    visible. The other 9 had been shipping since v16.31.
- THE SECTOR COUNT IN `test.js` IS PINNED ON PURPOSE and updated per edition, not
  loosened: it is edition-dependent data, not an invariant. A parser regression
  looks exactly like a real withdrawal here, so the assert message says to check
  the source before editing the number. That is what caught Sector 8.

## What happens at an aerodrome (v16.54-v16.59, roadmap item 17)

Clicking a published aerodrome now asks: **touch & go**, **full stop**, or
**fly-by**. They are three different plans, and only the pilot knows which.

- **THE FIRST WAYPOINT OF A PLAN IS ASKED A DIFFERENT QUESTION (v16.58, the
  pilot's second report of the SAME bug).** A fresh plan offers **Departure**
  and **Fly-by**; a touch & go or a full stop before you have taken off is not
  a plan, so those two are withheld and the message says why.
- **THE NEXT SECTOR FOLLOWS THE PLAN THE STOP WAS MADE ON (v16.59, the pilot's
  report: "a full stop does not start a new flight plan, only a touch n go").**
  `addNewFlightPlan` always seeded from `flights[flights.length - 1]` and
  appended at the END. On a one-sector mission those are the same plan, which is
  why every test and every verifier passed; the moment there are several they
  are not.
  - MEASURED: a full stop on plan 2 of 3 created plan **4**, seeded from plan
    3's last waypoint. The sector that should follow the stop never existed, the
    ground time landed on plan 3's header (`stopBeforeHTML` reads
    `flights[fIdx - 1]`, and plan 3 merely happened to sit after plan 2), and the
    pilot was jumped to a plan with nothing to do with the aerodrome they had
    just landed at. From the cockpit that reads exactly as "the full stop did
    not open a sector".
  - **WHICH PLAN IT CONTINUES FROM IS NOW AN ARGUMENT, NOT AN ASSUMPTION.**
    `addNewFlightPlan(afterIdx)` inserts directly after that plan and seeds from
    it. The `＋ New plan` button passes nothing and still appends at the end -
    its tooltip used to claim it continued "the current one", which was never
    true, and now says what it does.
  - THE STOP'S PLAN IS REMEMBERED BY **ID**, not by index (discipline rule 7):
    the circuits dialog sits between adding the waypoint and opening the sector.
  - `addPatternStop()` IS NOW AWAITED. It was not, so on a touch & go with
    circuits the next sector was created while the laps dialog was still open.
  - THE TEST WROTE ITS OWN BUG FIRST: `.replace(/\s+/g, ' ')` inside a template
    literal is `/s+/g`, because `\s` in a template literal collapses to a bare
    `s`. It was replacing the LETTER s - "Full stop" came back as "Full  top" -
    so the assert failed against correct output. Do not normalise whitespace
    inside an `ev()` template without doubling the backslash.
  - **THE v16.56 FIX HAD A HOLE, AND ITS OWN TEST NAILED THE HOLE SHUT.**
    `atField` read `first || !!o.stop` - "the first waypoint of a plan must be
    the departure" - which is a GUESS about intent, and it OVERRODE the pilot's
    stated one. So an explicit fly-by on an empty plan still went to the deck:
    exactly the bug v16.56 was written to fix, surviving in the one case where
    it mattered. It is now `!!o.departure || !!o.stop`: the caller says which,
    and nothing guesses on top of it.
  - **THE TEST WRITTEN WITH THE FIX ASSERTED THE BROKEN CASE AS CORRECT**
    (`assert(wp.alt === 254, 'the departure is not at the field elevation')`),
    so the suite was green, the verifier was green, and the reported bug was
    untouched. That is the "test assert looser than the measurement" failure in
    its worst form - not looser, but *pointed the wrong way*. When a fix is
    reported as not working, re-derive the pilot's ACTUAL path before defending
    the code: the reproduction here took one browser probe of three shapes, and
    the broken one was the shape no test drove.
  - **THE REAL DEFECT WAS A MISSING OPTION, NOT A WRONG BRANCH.** Until v16.58
    the dialog offered no way to say "I take off from here" at all, so on a
    fresh plan Fly-by was the only sensible pick - and the code then quietly
    reinterpreted it. A menu that has no word for what the pilot means will get
    the wrong answer however carefully the branches are written.
  - A FLY-BY NO LONGER SETS `depElev` either. The aircraft did not take off
    there, so the field elevation says nothing about where the climb starts.
  - Three mutations are checked: restoring `first ||`, removing the empty-plan
    question, and letting a fly-by move `depElev` each fail the suite by name.
    `verify-fixes.mjs` CLICKS both options on a real empty plan, because the
    v16.53 lesson is that driving the function proves the function.

- **THIS REVERSES THE v16.34 "NO DIALOG ON ADD" RULE - FOR AERODROMES ONLY.**
  That rule is still right for a reporting point: it has a published name and
  there is nothing to decide, so it is added with one click and no question. An
  aerodrome is the exception because overflying one, touching down and going,
  and shutting down for ten minutes produce different times, different fuel and
  a different next sector. A test asserts the reporting-point path is unchanged.
- **THE MINUTES ARE THE PILOT'S FIGURES** - 5 for a touch & go, 10 for a full
  stop, both stated by them - and they are EDITABLE, because how long a
  turnaround takes is a fact about the day rather than about the aircraft. They
  live on the stop waypoint (one source of truth, and they still count when the
  auto-open is off) and are edited in the FOLLOWING plan's header, which is the
  sector whose off-block time actually moves.
- **THE STOP TIME SITS BETWEEN TWO SECTORS, NOT IN A ROW OF ITS OWN.** It is
  added to the running clock at the sector boundary, so every ETO in the next
  sector moves by it - which is exactly what a turnaround does to a plan.
- **TAXI FUEL IS NOW CHARGED PER DEPARTURE, NOT PER MISSION, and that is a
  CALCULATION CHANGE.** The author settled it in AUDIT.md ("taxi fuel belongs to
  a full stop"). It used to be charged once for the whole mission, so every
  sector after a full stop read low by one start-up and taxi. A TOUCH & GO is
  charged nothing here - the engine never stopped - and its minutes are priced
  at the PATTERN fuel flow, which is the rate the pilot already set for circuit
  work. Neither figure is invented.
- **THE NEXT SECTOR DEPARTS FROM THE PUBLISHED FIELD ELEVATION**, looked up from
  the dataset rather than inherited from the arrival row. This SETTLES the
  question CLAUDE.md left open at v16.43: the old note guessed that a touch & go
  would resume from the circuit altitude, and the pilot's answer is that both
  resume from the field - you are on the runway either way.
- **A FULL STOP CAN REFUEL (v16.57, the pilot's request), AND A TOUCH & GO
  CANNOT.** The fuel on board for the next sector is set outright in the `⛽ Fuel
  after` box beside the ground time; empty means "carry on with what is left",
  which is what every plan did before this existed. The touch & go gets no box
  at all - the engine never stops and the aircraft never leaves the runway -
  and the sanitiser drops a refuel figure on one, so a hand-edited file cannot
  smuggle it in either.
  - **STORED IN GALLONS, TYPED AND SHOWN IN THE PILOT'S UNIT.** Every fuel
    figure in this project is held in the POH's unit and converted only for
    display; a refuel value travels in saved routes, so storing it in display
    units would let a later switch to litres silently reinterpret a number
    already written down. `setStopRefuel` is the one conversion point.
  - **THE CAP IS A TYPO GUARD, NOT A TANK LIMIT**, and the difference is the
    same one MAX_ARP_NM turns on. This planner holds NO published usable-fuel
    figure for the aircraft - the profile carries rates and a taxi burn, never a
    capacity - so it cannot tell 87 gallons from 90 and must not pretend to.
    1000 gal is roughly eleven times a C182's full tanks: it cannot reject a
    real figure and still catches a slipped decimal. The field says outright
    that what fits in the tanks is the pilot's call.
  - ZERO IS A REAL ANSWER, not "unset". A sector that departs with empty tanks
    must show it rather than silently carrying the previous figure over.
- **AN AERODROME IS AT FIELD ELEVATION ONLY WHEN THE AIRCRAFT IS ON IT (v16.56,
  the pilot's bug report).** `anchorWaypoint` gave EVERY aerodrome waypoint its
  published elevation, which is right for a departure and for a stop - the
  aircraft is on the runway - and wrong for a FLY-BY: it planned a descent to
  the deck and a climb back out over an aerodrome that was only overflown. The
  caller now says which, with `atField`, because only the caller knows.
  - `atField` is `first || !!stop`: the first waypoint of a plan IS the
    departure whichever option was chosen, so it stays on the field.
  - The bug rode in with v16.54: before that, an aerodrome anchor was only ever
    added as a departure or an arrival, so "always the field elevation" and
    "always on the field" were the same statement. Adding the fly-by made them
    different and nothing noticed - the existing test asserted the old rule
    verbatim, which is what a test does when the rule it encodes was true for a
    reason that has since expired.
- **A FLY-BY IS NAMED FROM THE PUBLISHED ATS CALLSIGN (v16.55, the pilot's
  correction), AND THE ANSWER WAS IN THE DATA ALL ALONG.**
  v16.54 used the AIP's `city` field and was wrong about a third of the time -
  ENEV came out "Harstad/Narvik" where the chart and the radio both say EVENES.
  The pilot asked whether that information exists anywhere. It does, and this
  project already ships it: every aerodrome's own station is published with a
  CALLSIGN in the airspace data, and the place part of it IS the name.
  - MEASURED: 49 of 53 aerodromes publish a station of their own, and 22 of
    those give a name `city` does not - Vigra, Flesland, Kjevik, Gardermoen,
    Banak, Værnes, Sola, Torp, Skagen, Helle, Evenes.
  - **THE OTHER CANDIDATE WAS TRIED AND MEASURED, NOT ASSUMED.** `name` carries
    the aerodrome after a " / " and agrees with the callsign on 40 of the 49 -
    but where they differ the callsign is the one flown: Tromsø not Langnes,
    Kirkenes not Høybuktmoen, Molde not Årø, Vardø not Svartnes. It is used only
    for the 4 uncontrolled fields with no station (Eggemoen, Gullknapp, Kjeller,
    Rena), where it IS what pilots call them. 53 of 53 now resolve, and a test
    asserts none of them falls back to the ICAO code.
  - **ONLY THE AERODROME'S OWN STATION COUNTS** - tower, AFIS or the ATIS. An
    APPROACH service can be an area centre: "Polaris Control" answers for
    Skagen's TIZ, and taking it would name half of Norway "Polaris". A test
    asserts no aerodrome is called Polaris.
  - THE LESSON, and it is the NO GUESSTIMATES rule in a new place: v16.54
    reached for the field with the likeliest-sounding NAME (`city`) instead of
    asking which published field actually carries the thing wanted. "No single
    field gives every colloquial name" was true of the two fields I looked at,
    and false of the dataset.
  - **THE ANCHOR HAD TO CARRY THE NAME, and the test caught that it did not.**
    `buildAnchors` built an aerodrome anchor whose `name` IS the ICAO code, so
    `civilName` fell back to it and a fly-by over Tromsø would have been called
    "Entc". Written before the test ran; found the moment it did.
- **CLICKED FOR REAL IN THE VERIFIER.** v16.53's lesson: `verify-fixes.mjs`
  clicks the actual aerodrome symbol, reads the dialog, clicks Full stop, and
  asserts the next sector opened at 32 ft with the ground time in its header.
  Driving `clickAnchor()` from a test would have proved the function, not the
  marker.
- CLAUDE.md said "ENTC's published 32 ft gives 1000 ft" - the published figure is **32 ft**
  and the derived circuit altitude is unchanged at 1000. Corrected here rather
  than left as a number the code disagrees with.

## IMPORT ASKS BEFORE IT OVERWRITES ANYTHING (v16.81)

The pilot asked what import actually did - *"does it override all my other
routes/settings?"* - and the answer was mostly reassuring and had one hole in
it. Reading the code rather than answering from memory is what found the hole.

### WHAT IT ALREADY DID RIGHT, AND THE ONE THING IT DID NOT

- The saved library was always MERGED: importing three routes left the other
  twenty alone. The profile was merged key by key through `PROFILE_KEYS`.
- **BUT A SAME-NAMED ENTRY REPLACED THEIRS WITH NOTHING SAID, AND THAT ONE WAS
  UNRECOVERABLE.** `pushUndoState` snapshots `{flights, loadedRouteRef,
  planFieldState()}` - the plan on screen and the plan fields. It does NOT
  cover `localStorage`, so the saved route that a collision overwrote was gone
  for good. Every other thing an import does is undoable; that was the
  exception, and it was silent.
- A second surprise, found on the way: **`keybinds` is a WHOLESALE
  replacement.** `normaliseKeymap` builds from `defaultKeymap()` and falls back
  per action to the SHIPPED default, not to what the pilot had - so importing a
  file with a `keybinds` block resets every shortcut the file does not mention.
  That is now stated in the guide, in a comment at the assignment, and is half
  the reason "Routes only" exists.

### TWO FEATURES, BOTH THE PILOT'S WORDS

1. **A SCOPE CHOICE**: `Routes and settings` or `Routes only`. Asked ONLY when
   the file carries both, because offering "routes only" for a file with no
   settings is a click with nothing to choose between - `importScopeOf` decides
   that, and it is pure. `Routes and settings` is the primary, so Enter
   reproduces exactly what every import did before the choice existed.
2. **A COLLISION PROMPT WITH THE TWO ROUTES SIDE BY SIDE**, yours left and the
   file's right, rows that differ highlighted. **`Keep mine` is the primary**:
   the destructive answer must never be what Enter does when the pilot is
   clearing a dialog out of the way.

### DECIDE, THEN APPLY - AND THAT IS WHAT MAKES CANCEL HONEST

Every question is asked before a single write; the whole import then applies in
one synchronous pass. So Cancel really means nothing changed, including routes
the loop had already got past - the v16.44 rule (refuse before touching the
live plan) applied to a CHOICE rather than to a validation failure.

**IT ALSO DISPOSES OF DISCIPLINE RULE 7 BY CONSTRUCTION.** There is no
`flights` reference held across an await because nothing touches `flights`
until every dialog has closed. A test asserts that structurally - every
`await ask(...)` / `await resolveImportCollisions(...)` sits before
`pushUndoState`, and the first write comes after the last question - rather
than hoping one example case would notice.

### WHAT THE COMPARISON IS, AND THE LIMIT IT ADMITS

- **ALIGNED BY INDEX, not by a longest-common-subsequence diff.** The case this
  exists for is a route edited in place, where index alignment is exactly
  right. Insert a fix in the middle and every later row reads as changed -
  which OVERSTATES the difference and never understates it, so the pilot is
  never told two routes agree when they do not. Stated in the function rather
  than left to be discovered.
- **A DIFFERENCE OUTSIDE THE FOUR SHOWN FIELDS GETS ITS OWN STATE AND ITS OWN
  SENTENCE.** Name, altitude and position are on screen; OAT, wind, a pin and a
  via are not. Flagging a row as different when all four visible values match,
  with nothing to explain why, would read as a bug in the preview - so those
  rows say "match by name, altitude and position but differ in other values".
- **`Object.is`, NOT `!==`, FOR THE NUMBERS.** A missing OAT is NaN and
  `NaN !== NaN`, so a plain comparison would call every absent value a
  difference and make a route with a blank field collide with itself. The
  signature side uses a key-SORTED stringify for the same reason plus one more:
  a route saved by an older build must not differ from an identical one saved
  by a newer just because the keys were written in another order.
- **IDENTICAL NEEDS NO QUESTION.** Replace and keep produce the same library,
  so it is counted and reported, never adjudicated.
- Both sides go through `sanitiseFlights` before comparing, or a route saved
  before a field existed would read as different in every row.

### THE PREVIEW IS DOM NODES, WHICH IS STRONGER THAN ESCAPING

`ask()` grew a `body` slot that takes a **NODE, never an HTML string**. Every
cell is a waypoint name the pilot typed or one out of a file - exactly the
`Bodø <VOR>` case discipline rule 6 exists for - and `textContent` has no
parser behind it, so there is no `innerHTML` sink to remember to escape.
Discipline rule 6 satisfied by construction rather than by vigilance, and a
test asserts a hostile name neither executes nor gets mangled.

### MISSIONS GET THE SAME QUESTION, WITH A DIFFERENT PREVIEW

The pilot asked about routes; missions have the identical silent-overwrite
hazard, so leaving them out would be the "old rule not applied to a new
surface" failure this file names. A waypoint table would misrepresent a
multi-plan mission, so the preview is one line per plan with its fix chain -
enough to tell "the same mission, edited" from "a different mission with the
same name" without inventing a mission-diff model.

### AND THE FIRST BROWSER CHECK FAILED A WORKING STYLE

`verify:layout` measures the preview at 1280x720: both columns side by side
with real boxes (341+300 | 640+300), 30 rows present, the list capped at 240 px
so every answer button stays on screen (lowest edge 586 of 720), the highlight
painted, and Cancel leaving the saved route alone.

The highlight check failed on its first run and **the style was fine** - the
FIXTURE was wrong. It compared `MINE-1..30` against `THEIRS-1..30`, so every
row differed, there was no `.rd-same` on the page at all, and the baseline read
`null`. A comparison needs both states present to mean anything; the fixture is
now one route with two waypoints edited, which is the case the preview exists
for anyway. Same family as the v16.66 finding where both sides of a comparison
read `''` and the check passed while a control was three places adrift - a
comparison against a value that cannot be there proves nothing in either
direction.

### AN EMPTY PREF IN A FILE DOES NOT BLANK THE ONE ON SCREEN (v16.82)

The pilot's follow-up, after being told about it: the ETD was the one planning
pref read without the empty-value guard its two neighbours had, so importing
blanked it.

**AND IT WAS NOT AN EDGE CASE.** `buildExportPayload` writes
`etd: (planningPrefs && planningPrefs.etd) || ''`, so EVERY file exported from a
session that had no ETD carries an empty one - which means the normal shape of a
route file silently cleared the importer's departure time. Fuel and reserve were
already guarded; only the ETD was not.

It is the v16.44 **"absent stays absent"** rule read the other way round: a
missing value must not be coerced INTO the plan, and equally must not overwrite
something the pilot has set. The guard belongs on the READ, not in the exporter:
the file format is internally consistent (`savePlanningPrefs` stores `''` too),
and it is the read that loses data.

- **THE SHAPE WAS ONE OF THREE LINES DIFFERING FROM THE OTHER TWO**, which is
  how it hid - a rule applied to a surface and not to its neighbours, this
  file's first named failure shape. A test now walks the block and requires
  EVERY `pp.<key>` read to carry the guard, so a fourth pref cannot be added
  without it.
- **AND THAT TEST FAILED AGAINST CORRECT CODE FIRST.** It sliced the block on
  the bare word `savePlanningPrefs` - which the comment written with the fix
  MENTIONS - so the slice ended at the comment, before the three lines it meant
  to inspect. An anchor that prose can match is not an anchor; it splits on
  `savePlanningPrefs();` now. Same lesson as the v16.52 `@KEY-DISPATCH` marker,
  in a smaller shape.

### THE TOAST DISTINGUISHES SIX OUTCOMES

Applied, replaced (a saved entry is gone), kept (the pilot chose theirs),
already identical, dropped as unreadable, and declined by choice. **Keeping
every colliding route is not "nothing was recognised"** - the file was
understood perfectly and the pilot chose their own copy each time - so it gets
its own sentence instead of the v16.44 warning, and the undo step is popped
because nothing was applied.

## THE DEPLOYED COPY IS ENCRYPTED, AND THE SOURCE IS NOT (v16.78)

The author asked for "a password set in an encrypted file only i can access so
that if anyone opens the website without permission, they wont access", applied
once per machine. What was built is real: `site-locked/` carries no app at all,
only AES-256-GCM ciphertext. What it does NOT do is stated everywhere it could
be mistaken - here, in `tools/lock-site.mjs`, in the workflow and in the app's
own guide.

### THE THREE FACTS THAT DECIDED THE DESIGN, EACH VERIFIED FIRST

1. **THE REPO IS PUBLIC** (`"visibility": "public"`, read off the API, not
   assumed). So `src/`, `data/aip.js` and the whole planner are one click away
   on GitHub and anyone can run it locally. **This gates the deployed URL and
   nothing else.** Saying otherwise would be the plausible wrong answer at its
   most expensive.
2. **GITHUB PAGES HAS NO ACCESS CONTROL on a personal account** - authenticated
   visitors are a GitHub Enterprise Cloud feature. Publishing Pages from a
   PRIVATE repo is a cheaper tier (GitHub Pro), not Enterprise; the author's
   call was to keep the repo public for now, so the artifact itself has to be
   the gate. Correcting "Enterprise" to "Pro" mattered: it is a different
   decision at a different price.
3. **A PASSWORD PROMPT OVER A PLAINTEXT APP PROTECTS NOTHING.** The files are
   downloaded by the time it appears, so devtools or a direct fetch of `app.js`
   walks past it. That option was offered and named as protecting nothing, not
   built and quietly labelled a lock. It is the v16.26 offline-chart lesson: a
   promise the platform revokes at the moment it matters.

### HOW IT WORKS, AND WHAT IS DELIBERATELY ABSENT

- `tools/lock-site.mjs` turns the TESTED `site/` into `site-locked/`: the page,
  the bundle and the dataset become `body.enc`, `app.enc`, `aip.enc`, and
  `src/unlock.html` becomes the gate. `npm run lock`, and CI deploys that.
- **NO PASSWORD HASH IS STORED ANYWHERE.** The GCM authentication tag is what
  fails on a wrong key, so the artifact holds only salt, iteration count and
  ciphertext. There is nothing to attack except the payload, which an attacker
  would have to attack anyway.
- **THE PASSPHRASE IS NEVER IN THE REPO OR THE ARTIFACT.** `.site-password`
  (gitignored) locally, the `SITE_PASSWORD` repository secret in CI - GitHub
  stores that encrypted and cannot show it back, only replace it, which is
  exactly the property wanted. A test asserts both paths stay untracked,
  because a passphrase committed once is a passphrase an attacker has for good.
- **WHAT IS REMEMBERED PER BROWSER IS THE DERIVED KEY, NOT THE PASSPHRASE.**
  The expensive KDF runs once per machine and the phrase cannot be recovered
  from `localStorage` afterwards.
- **THE ITERATION COUNT IS MEASURED.** PBKDF2-SHA256 in Chromium is ~154 ns an
  iteration (310k/49 ms, 600k/94 ms, 1.2M/185 ms, 2.4M/369 ms). 2 000 000 is
  ~310 ms here, ~3.3x the OWASP floor, and it is paid once per browser rather
  than per load. **AND IT IS NOT WHAT MAKES THIS SAFE** - the attacker guesses
  offline at their own pace, so entropy comes first and the KDF second. That is
  why `readPassphrase` REFUSES a short or obvious phrase and says which rule
  was broken: a locker reporting success on "1234" would be theatre.
- **IT NEEDS https OR localhost.** `crypto.subtle` is secure-context-only, so
  the plain-http LAN case this project supports (phone on a hotspot) CANNOT
  unlock - the same rule that stops the service worker there. The gate says so
  in those words rather than letting an absent API surface as "wrong
  passphrase". Serve the unlocked build on the LAN; the https URL is the locked
  one. `SITE_DIR=site-locked node tools/serve.mjs` checks it on localhost.

### THE RELAUNCH IS THE v16.45 CONSTRAINT AGAIN, AND IT IS WHY THIS IS VERIFIED IN CHROMIUM

The bundle is a CLASSIC script whose functions the page's 100-odd inline `on*=`
handlers need as GLOBALS, and the page script's top level calls into it. So the
gate cannot just dump HTML: `innerHTML` does not execute scripts, and
`document.write` after load is a parser re-entry problem. It parses the
decrypted page with `DOMParser`, replaces `documentElement`, then RE-CREATES
every script element in document order - dataset, bundle, page script - which
executes them at global scope exactly as a normal load would.

- `tools/verify-locked.mjs` measures that in real Chromium, offline: wrong
  passphrase shows nothing and runs no app code; the right one boots the app,
  `computeFlightSchedule` is a global, the dataset loads, the OFP table
  renders, the ENDU-ENTC leg computes at 38.4 NM, and **an inline `on*=`
  handler actually fires** (the v16.53 lesson - driving a function proves the
  function, clicking proves the wiring). Then: not asked again on a second
  load, and a stale or tampered key falls back to asking.
- **A KEY WHOSE SALT IS NOT THIS BUILD'S IS NOW CLEARED, and the verifier found
  that.** The branch returned early and left dead bytes in `localStorage` on
  every machine for good after a rebuild under a new passphrase.

### TWO BUGS WORTH RECORDING, BOTH MINE

- **A LITERAL CLOSING SCRIPT TAG INSIDE A JS COMMENT TRUNCATED THE GATE'S OWN
  SCRIPT** - in a comment that was explaining such a tag is harmless in the app
  payload. The HTML parser does not read comments: it ended the element there,
  the gate threw a SyntaxError, rendered the rest of its source as text, and
  unlocked nothing. Every string check in the locker passed; only the browser
  caught it. The locker now runs `node --check` over the extracted block, the
  way `tools/build.mjs` already does for the page script.
- **AND THE OBVIOUS GUARD FOR IT WAS THE WRONG ONE.** "A stray tag yields TWO
  script blocks" is false - there is no second opening tag, so you get ONE
  block that stops mid-statement, and counting would have missed the original
  bug entirely. The PARSE is what catches truncation; the count guards a
  genuinely added second script. Both are asserted, for different reasons, and
  the test says which does what. Straight M5: assert the thing that actually
  justified the check.
- Two smaller ones, both my own probes rather than the app: `window.flights` is
  `undefined` because `flights` is `let` at the top level of a classic script -
  a global LEXICAL binding, the exact trap this file names - and a fresh
  browser boots the v16.49 EMPTY plan, so asking it for `schedule[0]` reported
  a working engine as returning null.

### THE PASSPHRASE RULE WAS DRAWN TOO WIDE, AND THE FIRST REAL DEPLOY FOUND IT (v16.79)

`readPassphrase` started as a bare `includes` ban on OBVIOUS, and the very
first deploy failed on it. That failure was CORRECT - the author's secret was
`SECRETPASSWORD`, which is the two most-guessed words concatenated and has a
residue of zero - but looking at the rule with a real failure in front of it
showed the rule itself was wrong:

- **IT REFUSED STRONG PASSPHRASES AND TOLD THE AUTHOR THEY WERE GUESSABLE.**
  `my-c182-flies-over-tromso-at-dawn` is 33 characters and fine, and a
  substring ban rejected it for containing `c182` while reporting it as one of
  the strings tried first. **That is a false claim about the passphrase** - the
  plausible wrong answer pointing the other way, and worse than useless because
  the honest fix then looks like a tool malfunction.
- `obviousResidue` strips every obvious string and what REMAINS must stand on
  its own against MIN_LENGTH. A long phrase MAY contain one of those words; it
  may not largely BE one. Measured: `flightplanner` 0, `flightplanner-2026` 4,
  `MySecretPassword123` 5, `SECRETPASSWORD` 0 - all refused; the 33-character
  phrase 23 - accepted.
- **PUNCTUATION DOES NOT COUNT toward the remainder**, or `c182` plus twenty
  hyphens would pass. Æ Ø Å do, because the author's own words are Norwegian.
- **IT IS EXPLICITLY NOT AN ENTROPY ESTIMATOR**, and a test asserts that by
  requiring `abababababababab` to be ACCEPTED. It cannot tell that from four
  random words, and this project has no business inventing a strength score it
  cannot justify. One guard against one specific mistake; the guide says the
  passphrase's own quality is what carries the security.

THE SHAPE IS THE ONE THIS FILE ALREADY NAMES: a rule stated once and applied
too bluntly, caught only when something real ran into it. The refusal message
now says how many characters of non-obvious material were found, so it is
actionable rather than a verdict.

### THERE IS NO FALLBACK TO PUBLISHING THE PLAINTEXT BUILD

If `SITE_PASSWORD` is missing the deploy FAILS, loudly. Publishing `site/`
instead would put the whole planner up unlocked and report success. The
workflow also greps the artifact for the app's own identifiers immediately
before upload - proved load-bearing by removing the locker's own leak check and
leaving one payload unencrypted, which CI then caught.

**FIVE MUTATIONS, ALL CAUGHT**: deploying `site/` (1 test), a 4-character
minimum (1 test), an emptied obvious-list (1 test), a reintroduced closing tag
(build failure), and a payload left in plaintext (CI guard). None of them died
only in `tsc`.

## THE ALTITUDE COLUMN IS THE PILOT'S, AND NOTHING REWRITES IT (v16.77)

The pilot, on the v16.74/v16.75 carry-back that had just been built for them:
*"TBH, the planned altitude on my OFP isnt really a super restricting value. I
set what altitude i plan on using, not the exact altitude i will have at that
point, thats more nitpicky and detail than a flight school vfr plan requires. Id
prefer the Climb and descent doesnt really fuck with the altitudes that much.
Just a simple 'climb here, descend there'."*

**THIS REVERSES A FEATURE REQUESTED TWO TURNS EARLIER, and it is recorded as a
reversal rather than a refinement.** v16.74 was asked for in these words: *"Even
if there is a leg behind it, id like the BOC to move across the legs."* It was
built the only way that keeps the altitude column literally true - by RAISING
the earlier fix to the altitude the climb passes through - and v16.75 then added
the `altBase`/`tocBase` cache so the raises could be walked back instead of
compounding. Both were correct implementations of the request. What the pilot
saw when they flew it was the tool arguing with a number they had typed.

### WHAT CAME OUT, AND WHAT REPLACED IT

The engine's whole advice-and-repair layer is gone, not disabled:

- `entryAltForClimbBy` (the bisection that computed the crossing altitude),
  `tocNeedsEntryAlt`, `tocNoAltHelps`, `tocAdviceLevelByNM`,
  `tocAdviceClimbFromNM`, and the `verifyAdvice` recursion - the only reason
  `computeFlightSchedule` ever called itself. The `opts` parameter went with it.
- The panel's `applySuggestedEntryAlt` and its "Do that" button, and the
  drag's CANDIDATE 2 (the carry-back).
- `altBase`/`tocBase` from the sanitiser, the types and the route file. They
  existed ONLY to undo the raising; with nothing raising a fix there is nothing
  to cache, and a cache with no writer is a field a future reader can misread.

**WHAT IS KEPT IS EVERYTHING THAT ONLY REPORTS.** `tocTargetMet` and
`climbRateReqFpm` stay: the first says the request was not honoured, the second
is a rate to JUDGE and is never used to recompute a climb. So an unreachable
target now has exactly one outcome on every surface - the panel, the red banner
and the toast all say what could not be done and name the rate - and the leg's
climb is bit-identical to the same leg with no target at all.

**TWO OUTCOMES REMAIN FOR A DRAG**: it fits, or the leg goes back to the corner
the POH puts there. Both are flyable plans, so neither raises the banner.

### THE INVARIANT, AND WHY IT IS ABSOLUTE AND NOT A ROUND TRIP

*A drag, a pin or a target never changes an altitude the pilot typed.*

- `sweep-drag.mjs` asserted this as a RATCHET check - drag it back and the
  altitudes must return. v16.74 and v16.75 both PASSED that check, because the
  cache gave the figure back. Restoring what you took is a weaker promise than
  never taking it, so the sweep now compares the altitudes after EVERY drop
  against the ones the plan started with.
- The pure sweep that used to verify the advice (3 000 generated routes) now
  verifies its absence: for every unmet target, the waypoints come back exactly
  as they went in and the climb minutes equal the same leg with no target.
  Measured: 900 targets met, 1 373 unreachable, 0 rewrote an altitude, 0 changed
  a climb.
- `verify:leg` no longer looks for the offer button; it asserts the report
  carries the rate AND the sentence "no altitude you typed is changed", that no
  button is present, and that MID still reads 2 500 ft after a preview, after
  Apply, and after a real mouse drag on the later leg.
- **PROVED LOAD-BEARING BY MUTATION**, because a guard nobody has seen fail is
  not known to guard anything. Making the no-pin fallback raise the previous fix
  by 100 ft fails two jsdom tests by name (0 `error TS` lines - not the
  typechecker trap) and produces **87 sweep problems**, of which the new
  `ALTITUDE` finding is the one the old round-trip check could not see.

### WHAT THIS DOES **NOT** FIX, and it must not be read as fixing it

Deferred nit 1 is untouched: a descent that spills back onto an earlier leg
still REPORTS that leg's planned exit altitude rather than the one actually
crossed (measured live: `ENDU 254 -> A 8000 -> ENTC 2000`, A crossed at ~6 525
ft while the column says 8 000). v16.77 removes the machinery that CHANGED an
altitude; it does not make the spilled descent's stated altitudes true. The
pilot's message is also the reason that is now low priority rather than urgent -
the column is a plan, not a promise about a height at a point - but the entry
stays on the deferred list because a stated figure that is not flown is still
worth being honest about.

## ONE TARGET PER LEG, AND THE CORNERS ARE DERIVED (v16.76)

The pilot asked the right question: *"is the amount of work to fix all these
bugs worth it? Or should we decide to revert to a simple TOD, TOC logic before
it gets too complex"* - and pointed at `1ntray/flight_planner`.

### WHAT THE COMPARISON ACTUALLY SHOWED

Their `performancePhaseBoundaries.ts` is **85 lines** against our pin machinery,
and the reason is the DATA MODEL, not a better algorithm:

- A leg carries `altitudeFtMsl` plus a `targetPlacement` (`automatic` |
  `distance-along-leg`), and optionally a second `endAltitudeFtMsl`. One concept.
- BOC/TOC/TOD/BOD are **scanned out of the integrated step list** by looking for
  phase transitions. Nothing is stored; nothing can disagree.
- They run THE SAME SOLVER we do: `addTransition` bisects the climb start to hit
  a target distance, which is `climbStartForToc`.
- **Their answer to an unreachable target is strictly worse for a pilot**:
  `insufficient-leg-distance` returns `no-solution` for the WHOLE route, and the
  nav log and route tables blank out behind an error line. One bad drag and every
  figure disappears. Ours repairs instead.

So the feature was never the problem. THE REPRESENTATION WAS: three pins
measured from different ends (`bocNM` after the start fix, `bodNM` before the end
fix, `tocNM` a deadline) which could CONTRADICT each other - forcing rules about
which wins, a state where a target is "missed", and a repair layer on top. Every
bug report from v16.73 to v16.75 lived in that layer.

### ONE FIELD REPLACES ALL THREE, AND IT WAS ALREADY PROVEN

`altAtNM` - where this leg's altitude must be attained, from the leg's start fix.
Absent means "as soon as the POH allows", the derived v16.5 behaviour.

    attain EARLY  ->  the climb begins at the fix and tops out sooner   (a TOC)
    attain LATE   ->  the climb is DELAYED, level flight first          (a BOC)
    descending    ->  the descent finishes there, level flight after    (a BOD)

**`bocNM` WAS ALREADY A SECOND SPELLING OF `tocNM`.** `climbStartForToc` bisects
the climb's START so it ENDS on the target, so a target beyond the natural top
delays the whole climb. Measured before the change, which is why it was safe:
dragging the TOC to 26.4 NM with `tocNM` alone placed the BOC at 6.4 NM and kept
the climb's POH length.

- ALL FOUR MARKS NOW WRITE THE ONE FIELD, differing only in which end of the
  manoeuvre was grabbed: a bottom is the same target one manoeuvre-length on.
  There is no BOC that can contradict a TOC, so there are no rules about which
  wins - the contradiction warning has nothing left to warn about.
- **LEGACY FIELDS ARE READ, NEVER WRITTEN.** `legTarget` falls back to the three
  pins, so a route saved before this reads identically - proven by all 480
  existing tests passing UNCHANGED across the engine swap.
- THE FOUR CORNERS WERE ALREADY DERIVED: `computeLegMarkers` drew the BOC from
  `climbStartNM > EDGE_NM`, not from pin presence. That half was right already.

### HONEST ABOUT WHAT THIS STEP DID AND DID NOT DO

- The ENGINE IS NOT SMALLER YET - 44 pin references before, 51 after - because
  the one-field path was ADDED while the three-pin fallback stayed for saved
  routes. The simplification is in the interaction model: one thing is written,
  and contradictions are now unrepresentable.
- DELETING the old machinery (`tocTargetMet`, the advice, the caching) needs a
  one-time migration on load so no file in the wild still carries the old pins.
  That is the next step, and it is where the line count comes down.

### THREE BUGS THE REFACTOR ITSELF PRODUCED, ALL CAUGHT

- **`isFinite(null)` IS TRUE.** The global coerces (`Number(null)` is 0), so a
  descent leg's null TOC went down the numeric branch and threw on `.toFixed`.
  `Number.isFinite` is the one that means what it says.
- **A PHASE-BLIND FIT TEST BROKE EVERY DESCENT DRAG.** `tocTargetNM` and
  `tocTargetMet` exist only on a CLIMB; consulting them alone made every descent
  drop look unachievable, so it fell through to "clear the target" and no BOD
  could be placed. `verify:leg` drags both ends, which is why it was caught.
- **A DERIVED DISPLAY MUST NEVER BE READ BACK AS INPUT.** `updateLegPreview`
  writes the computed climb start into the BOC box; the panel then read that box
  as the target, so a "clear" re-applied a target one climb-length short of the
  one it had just removed. The box is `readonly` now, and "start the climb here"
  goes into the one target field like every other request.

## A DRAG NEVER COMMITS A PLAN THE APP CALLS UNUSABLE (v16.75)

Four reports on v16.74, and the fourth was *"there are several bugs, some also
throw red banner. Please do extensive chromium testing."* That one shaped the
work: a targeted check finds the case you imagined, a SWEEP finds the case you
did not.

### `tools/sweep-drag.mjs` - 266 real mouse drags over 11 deliberately awkward plans

`npm run sweep:drag` drags EVERY mark on each plan to seven positions along the
mark's OWN leg, and after each drop asserts what must hold whatever was asked
for: no NEW red banner, no page error, `exit(k) == entry(k+1)`, every phase
finite and >= 0, the climb inside its leg, no duplicate mark, every mark on the
track, and NOTHING RATCHETING (drag it back and the pilot's altitudes must
return).

- **THE FIRST RUN FOUND 46 DISTINCT PROBLEMS AND 38 OF THEM WERE THE SWEEP'S OWN
  FAULT.** A sweep has to be calibrated before it can be believed:
  1. a plan can be unflyable BEFORE anything is dragged (`short-final-leg`
     genuinely cannot lose 6000 ft in 3.6 NM), so the banner is baselined and
     only what the drag ADDS counts;
  2. a NULL schedule leg is legitimate - a circuit stop breaks the chain (v16.5)
     and those legs render through `computeLegTotals` instead;
  3. the off-track tolerance is the great circle's own bow against the straight
     chord `alongLegNM` measures from - 0.18 NM on these legs, and v16.63
     measured 5.16 NM on a 229 NM east-west one.
- **WHAT SURVIVED WAS ONE REAL BUG, AND IT IS A WHOLE CLASS.** On a plan whose
  last leg is 3.6 NM, delaying the climb on the leg before pushes it into the
  tail the descent needs: two reasonable requests contradict, and v16.74
  ACCEPTED the pin and then raised the banner. **A pin is a REQUEST. One that
  cannot be honoured is refused with a reason** - never accepted and then
  reported as figures not to use. `addedProblems` runs
  `collectIntegrityProblems` on a candidate copy and compares it with now;
  problems that were already there are not the drag's fault.
- **THE SWEEP'S BLIND SPOT, recorded because it is the interesting part.** It
  first dropped at a fraction of the WHOLE route line, and on a three-fix plan
  every fraction past the first leg projects onto that leg's END - so a TOC two
  thirds along its own leg, which is exactly where the conflict lives, was never
  asked for. Drops are leg-relative now. **And a mutation of the guard STILL
  escapes the sweep through the real-mouse path** while a direct call reproduces
  it in one line: the sweep is a broad net that found the bug, and the targeted
  jsdom tests are what actually hold it down. Do not read a green sweep as proof.

### THE OTHER THREE REPORTS

- **THE NUMBER KEYS ARE GONE FROM EVERY DIALOG.** They were guarded against
  typing in `field` - the FIRST field - and a dialog has carried SEVERAL fields
  since v16.74, so a digit typed into the altitude box counted as "outside the
  text field" and pressed Delete. Widening the guard was the wrong fix: a dialog
  that takes typed values cannot also treat bare digits as commands. The badges
  came out with them, because a badge showing a dead shortcut is worse than none.
  A test that pressed `2` and awaited the promise now HUNG the whole suite -
  which printed 476 passes, no summary, and exit 0. **A suite that exits 0 with
  no RESULT line has not passed; it has stopped.**
- **A CLAMPED TOC DREW A BOC AT THE DEPARTURE.** v16.74 clamped the pin to the
  earliest reachable TOC; the engine then derived a bottom-of-climb a fraction
  of a mile in, so the pilot got a ring just past the departure. It now CLEARS
  the pin instead, which is strictly better rather than a change of mind: with
  nothing pinned the climb starts at the fix, that IS the earliest possible, and
  no BOC is drawn - the bottom of the climb is the fix itself.
- **THE RAISED CROSSING ALTITUDE IS CACHED AND GIVEN BACK.** *(REMOVED at
  v16.77 - see the section above. Nothing raises a fix any more, so there is
  nothing to cache; kept here for why the cache existed.)* `altBase` (plus
  `tocBase`) remembers what the pilot typed when a carried-back climb raised a
  fix, and EVERY drag is judged from that baseline. Without it the raises
  COMPOUND - each drag lifts the fix again from the already-lifted figure and it
  can never come down. With it, moving the TOC forward walks the crossing
  altitude back to the original and drops the cache when it is no longer needed.
  It travels in the route file, because a fix stranded at a raised figure with
  nothing to restore it to is worse than not caching at all.

### THE LAST RESORT IS THE PILOT'S OWN PLAN, AND IT IS NEVER REFUSED

The sweep's second useful find, on a plan that was ALREADY unflyable before
anything was dragged. `addedProblems` compares a candidate with the state NOW -
so once a fix had been raised, EVERY candidate including "put it back" looked
like it was adding a problem, all three were refused, and the fix was stranded
at an altitude the pilot never typed with no way to drag it back down.

- **A refusal cannot undo the past.** The no-pin candidate is the pilot's own
  plan - this leg unpinned and every cached altitude restored - so it can never
  be worse than what they typed, and it is now committed unconditionally. Where
  putting it back re-exposes a problem their own altitudes cause, the toast says
  the leg is back as they had it rather than letting it read as the drag's fault.
- **AND I EMPTIED A SOURCE FILE AGAIN GETTING THERE** - `src/index.html` this
  time, by the same `b"""` typo, because `io.open(p,'w')` truncates before the
  argument to `.write()` is evaluated. The edit pattern that survives it is:
  read, replace, ASSERT on the finished string, and only then open for writing.
  The next attempt used it and the assert fired harmlessly on a bad anchor
  instead of destroying the file.

## The waypoint box, and a TOC dragged past what the aircraft can climb (v16.74)

The pilot, on the v16.73 menu: *"the 'set altitude from here' button is
unnecessary. I just want an 'altitude' input box... it automatically applies it
when pressing enter"* - with the goal stated plainly: *"I want to be able to
pretty much finish the whole flight plan in the map only view."* And a bug:
*"when moving the TOC backwards it automatically resets, the red integrity
banner appears."*

### ONE DIALOG, TWO FIELDS, ENTER COMMITS

`ask()` grew a `fields` array beside its single `input` (which twenty call sites
and `promptDialog` still use). The waypoint menu now edits the name AND the
altitude in one box; the primary button applies whichever changed, as ONE undo
step, and Enter is already bound to the primary button so the whole thing is
type-type-Enter without reaching for the mouse.

- A test helper that types into "the dialog's input" is now ambiguous;
  `typeInDialog(value, fieldId)` takes the field, and the verifier selects
  `input[data-field="name"]`. Both had been picking the first input.

### A TOC DRAGGED TOO FAR BACK IS A REQUEST, NOT AN ERROR

*(Outcome 2 below - carrying the climb onto the leg before by RAISING that
fix - was REMOVED at v16.77 on the pilot's instruction. Outcomes 1 and 3
stand. See "THE ALTITUDE COLUMN IS THE PILOT'S" above.)*

Three outcomes, and **none of them is the red banner** - in every case the
resulting plan is flyable, so "DO NOT USE THESE FIGURES" would be false.

1. **It fits** -> applied silently.
2. **There is a leg behind it** -> the climb begins on that leg. **THE BOC
   CROSSES THE LEG BOUNDARY BY THE ONE MECHANISM THAT KEEPS THE ALTITUDE COLUMN
   HONEST**: the earlier fix is RAISED to the altitude the climb passes through
   and that leg's own climb is pinned to finish exactly on it, so the two halves
   are one continuous climb and every stated altitude is still what is flown.
   Simply starting the climb early would make the shared fix be crossed at an
   altitude the column denies - the flaw CLAUDE.md refuses, and the one the
   descent's spill-back still has (deferred nit 1). Measured: MID 2500 -> 6800 ft,
   target met, no banner.
3. **There is no leg behind it** (the first leg - you cannot climb before
   takeoff) -> the TOC is CLAMPED to the earliest the POH reaches, with a toast.

- **THE MACHINERY IS v16.38-v16.40's, NOT NEW.** `tocNeedsEntryAlt` and
  `tocAdviceLevelByNM` are already verified by running the real engine on a
  copy; this only reaches for them automatically instead of raising a banner and
  waiting to be asked. Every trial here runs on a `JSON.parse(JSON.stringify())`
  copy for the same reason.
- **THE CLAMP ROUNDS UP, NEVER TO THE NEAREST**, and that is the v16.40 rule
  again: the figure is a MINIMUM, so the nearest tenth is below it half the time
  and a clamp landing 0.004 NM early misses the very target it was computed to
  meet - measured, and it put the banner straight back up.
- **THE NUMBER IN THE NOTE IS WHERE THE MARK LANDED**, not the raw figure it was
  derived from. They differ by the rounding, and a note that disagrees with the
  chart is the drift this file keeps naming.
- **RAISING A FIX THE PILOT SET IS NEVER SILENT.** The toast names the fix and
  the new altitude, and one Ctrl+Z takes the whole gesture back - the pin and the
  raised fix together, because it was one gesture.

## Dragging the corners, and setting an altitude for a phase (v16.73)

Two requests in one: *"a separate icon for BOC and TOC, same with TOD and BOD...
drag the icon across the track and it will automatically calculate and place a
BOC / BOD as well which should also be draggable to move the whole segment"*,
and *"when right clicking a waypoint, let me have the ability to set a new
altitude... All waypoints after that waypoint will automatically be set to the
same altitude."*

### THE ENGINE ALREADY UNDERSTOOD EVERY DROP; WHAT WAS MISSING WAS THE GESTURE

No schedule maths changed. A drop is turned into ONE of the pins v16.37 already
takes, so every existing refusal (a contradictory pin, a descent that cannot
fit) still reports itself in the red banner exactly as before.

    BOC dropped at d  ->  bocNM = d        hold this altitude for d, then climb
    TOC dropped at d  ->  tocNM = d        "be level by d" - climbStartForToc works
                                            the POH climb BACKWARDS and the BOC
                                            appears where it has to begin
    BOD dropped at d  ->  bodNM = D - d    be level d before the end fix
    TOD dropped at d  ->  bodNM shifted by the SAME distance the top moved

- **THE MANOEUVRE IS NEVER STRETCHED.** Its length is the POH's, so moving
  either end moves the whole thing - which is exactly what the pilot asked the
  ring for, and the only honest answer: the POH prices a rate of climb, not a
  wish. Measured in Chromium: TOC dragged 20 -> 26.4 NM placed the BOC at
  6.4 NM, and the climb stayed 20.0 NM; dragging that ring to 9.9 NM took the
  TOC to 29.9 NM. The descent behaves identically from the other end.
- **A POSITION AND A DEADLINE CANNOT BOTH BE THE TRUTH.** Dragging the top sets
  `tocNM` and CLEARS `bocNM`; dragging the bottom does the reverse. A leg that
  carried both would be reporting itself as contradicting.
- **THE TOD USES A DELTA, NOT THE DESCENT LENGTH.** Moving the top moves the
  bottom by the same distance, which is right whether or not the descent also
  runs back onto an earlier leg - where the length on THIS leg is not the whole
  manoeuvre.

### A TOP IS A TICK, A BOTTOM IS A RING

Deferred nit 9, closed. A tick across the track means "the profile changes
across this line", which is what a TOC and a TOD are; drawing the pinned corners
with the same glyph in the same colour left the chip text as the only thing
telling them apart. The ring matches the plotting list, which has used a hollow
glyph for them since v16.37. Same colour per phase, so a climb still reads as
one pair.

### AN INTERACTIVE MARKER EATS WHAT IS UNDER IT, AND THAT COST TWO GESTURES

Making the marks draggable made them interactive, and Leaflet markers do not
bubble. **The right-click that opens the leg panel stopped working wherever a
mark happened to sit** - caught by `verify:leg`, which right-clicks a leg that
has a TOC on it. Two fixes, and both are now asserted rather than reasoned
about: `bubblingMouseEvents: true` so a LEFT click still falls through to the
map and adds a waypoint as it always did, and a `contextmenu` handler that opens
the leg panel for the leg that corner belongs to - forwarding beats passing
through, because the mark IS the leg the pilot is pointing at.

### THREE TRAPS, AND THE MIDDLE ONE MADE THE DEBUG OUTPUT LIE

- **`alongLegNM` RETURNS A REPORT, NOT A NUMBER** - `{alongNM, totalNM,
  offTrackNM}`. Treating it as a scalar makes every later step NaN.
- **AND `JSON.stringify(NaN)` PRINTS `null`**, so the debug line accused the
  projection of returning nothing when the projection was fine. A drop guard
  written `=== null` then let the NaN straight through to the pin arithmetic,
  where every comparison is false and the pin was quietly CLEARED instead of
  set - which looks exactly like a gesture that never registered. Guard with
  `isFinite`, never against `null`, wherever a NaN can reach.
- A marker `drag` event carries **no `latlng`**; that field belongs to mouse
  events on the map. The live position is `e.target.getLatLng()`.

### SET AN ALTITUDE FROM A WAYPOINT ONWARD

`levelFromIndices` (legs.js) is the whole rule, pure and tested without a
browser. Two exclusions, both the project refusing to invent something:

- **THE LAST WAYPOINT KEEPS ITS OWN ALTITUDE.** It is the destination at its
  published field elevation, and raising it to cruise would silently delete the
  descent - the plan would still look clean and would no longer arrive. Pointing
  AT the last fix still sets it, because then the pilot said so.
- **A CIRCUIT STOP IS SKIPPED**, because its altitude is DERIVED from the field
  (v16.40), not inherited. A cruise level written into a circuit is a pattern
  flown at 6500 ft.
- The author settled the other two questions: it overwrites hand-set altitudes
  (one Ctrl+Z takes it back), and what it will NOT touch is stated in the dialog
  BEFORE it runs rather than discovered afterwards.
- **AN UNREADABLE ALTITUDE IS REFUSED, NOT COERCED.** `Number('')` is 0, and a
  plan silently levelled at sea level is the v16.43 wind-matrix defect again.

### AND I EMPTIED THIS FILE AGAIN WHILE WRITING THAT SECTION

The warning under "Test harness notes" has been here since the first time it
happened, and it caught me anyway - in a new shape. `open(p, 'w')` TRUNCATES THE
FILE THE MOMENT IT IS CALLED, and Python evaluates it BEFORE the argument to
`.write()`. So `open(p,'w').write(s.replace(a, b))` with a typo in `b` raises
*after* the file is already empty: the exception looks like "nothing happened"
and the file is gone. `git checkout HEAD -- CLAUDE.md` got it back because the
last commit was clean. Build the new text into a variable, assert on it, and
only then open for writing.

### A FIXED BASIS DOES NOT FILL A WINDOW THE WAY A GROW FACTOR DID (v16.72)

The pilot: *"the map only view is broken, the sidebar is removed and leaves a
blank space in front of the map."* A v16.67 regression, and one nobody could see
until a divider had actually been dragged.

- **WHAT CHANGED UNDER IT.** Map-only hides the sidebar with `display: none` and
  has always relied on the map's `flex: 1.05` - a GROW factor - to take the space
  the hidden panel left behind. v16.67 made the map a fixed BASIS
  (`flex: 0 0 X%`) so the divider could land under the cursor, and a fixed basis
  holds the map at the dragged fraction with the rest of the window blank.
  Measured: **645 px of dead space at a 0.57 divider, 1050 px at 0.30.**
- **AN UNDRAGGED APP NEVER SHOWED IT**, because with nothing stored the
  stylesheet's own `var(--map-flex, 1.05)` fallback is still a grow factor. So
  the bug needed the feature to have been USED, which no check did.
- **THE CHECK v16.67 SHOULD HAVE HAD.** It asserted that the DIVIDER disappears
  in a one-panel layout, and never that the panel which is LEFT fills the window.
  Testing that the thing you changed went away is not the same as testing that
  what remains still works. `verify:layout` now measures the dead space in
  Map-only and Plan-only at four stored ratios, and removing the one-line fix
  fails it three times.
- One line: `body.layout-map #map-container { flex: 1 1 auto; }`. Plan-only was
  never affected - the map is `display: none` there and the sidebar's own grow
  factor was untouched.

### THE FLOOR IS TEXT PLUS CHROME, AND THE CHROME IS NOT A CONSTANT (v16.71)

Four rounds on one report, and the last one produced the actual cause. The
pilot's console output was decisive where three screenshots had not been:

    "12500 ... box=41 needs=45 min=42.05px font=12px appear=textfield"

- **THE FONT WAS 12 px, NOT 11 - THEY USE THE BOLD SKIN.** And the Bold skin
  puts **14 px** of padding and border inside a number input against the default
  skin's **6 px**. A floor stated purely in `ch` therefore sizes itself against
  ONE skin: measured on the default it was 8 px short on Bold, and a five-digit
  altitude clipped there. Three fixes in a row were sized in the skin I develop
  in, for a pilot who does not use it.
- **THE FIX STATES THE TWO PARTS SEPARATELY**: `calc(<characters>ch + 16px)`.
  The `ch` term is the widest value the column can legitimately hold plus a
  character of slack; the 16 px covers the most box chrome any skin adds (14 px,
  measured on Bold). The `th` floors carry 20 px because they also swallow the
  cell's own 4 px of padding.
- **THE VERIFIER TESTED ONE SKIN, WHICH IS WHY THE SUITE WAS GREEN THROUGHOUT.**
  It now runs the number-cell check under **default, compact and bold**. A cell
  check that does not vary the skin does not cover the app - and the skins exist
  precisely so the shell can be restyled, so anything measured in pixels has to
  be measured in each of them.
- **`scrollWidth` CAN ONLY SAY "CLIPPED", NEVER "CRAMPED".** An input that fits
  reports `scrollWidth === clientWidth`, so the old check went green while every
  value sat hard against its border with zero slack - which is what the pilot
  kept reporting and what the assertion was structurally unable to see. The
  check now measures the TEXT in the input's own font with a canvas and requires
  a character of room inside the content box. Reverting to the v16.70 floors
  fails it by name.
- **THE LESSON ABOUT THE PROCESS, not the CSS: three fixes were shipped for a
  symptom that had never been reproduced.** Each widened a number and called it
  measured - measured on the wrong machine, in the wrong skin, against a failure
  that was not happening there. One console read-out from the pilot's own
  browser settled it in a single round. When a report survives one fix, stop
  widening and get the failing measurement.

### WHY TEXT DEFENDS ITSELF AND AN INPUT DOES NOT (v16.70, the pilot's question)

*"What is different between the OAT field and say, the TAS field which is always
visible when narrowing the sidebar?"* It is the right question and it names the
mechanism: **TAS is TEXT in a cell, OAT is an `<input>`.**

- A table column can never be squeezed below its content's MIN-CONTENT width,
  and text has one for free - the browser will not take the TAS column below the
  width of `119`. An `<input>` with `width: 100%` contributes essentially NONE,
  so the column is free to shrink and the value is clipped INSIDE the box rather
  than overflowing it. Every editable column in this table needs its minimum
  stated explicitly, because text gets one and a control does not.
- **THE FLOOR ON THE INPUT IS THE GUARANTEE; THE FLOOR ON THE `th` IS THE TIDIER
  ALLOCATION.** Measured by disabling each half in turn: with the `th` floors
  ignored - which is what an engine that does not honour `min-width` on a table
  CELL would do - the input floors alone still clip nothing. The reverse is not
  true. A verifier check now disables the `th` floors and re-measures, so which
  half is load-bearing is asserted rather than believed.
- **THE FLOORS COUNT THE BOX, NOT THE DIGITS**, and v16.69 left that out: 4 px
  of padding and 2 px of border is about a character on top of the value, so a
  5.4ch floor gave a five-digit altitude 4.4ch of room. 6.5ch and 4.5ch now.
- **TWO ALTERNATIVES WERE TRIED AND MEASURED AND ARE NOT SHIPPED.** The `size`
  attribute does NOTHING while `width: 100%` stands - it was added, measured
  with both CSS floors off, left the value clipped, and was removed rather than
  left in place looking like a safeguard. `min-width: fit-content` on a form
  control resolves to nothing useful for the same reason. Shipping either as
  belt-and-braces would be documentation getting ahead of the code.

### TYPING IS NOT A SHORTCUT, AND THE COLUMN IS WHAT HOLDS THE NUMBER (v16.69)

Two reports from the same session with the OFP table.

**1. THE DIGITS SWITCHED FLIGHT PLAN WHILE THE PILOT WAS TYPING.** *"The numbers
keys change between flightplans when trying to type a number in the editable
number values."* v16.51 bound 1-9 to the flight plans; `isTextLikeTarget` lists
only genuinely free-text input types, so a NUMBER field is not text-like, and
every digit typed into an altitude also picked a plan.

- **IT WAS NEVER ONLY THE DIGITS.** `.` and `,` are the next and previous plan,
  so a decimal point typed into the fuel or the reserve stepped sector; `/`
  jumps to the fix search; and `Delete` removes the selected waypoint, so
  erasing a digit forward could take a fix out of the route.
- **RULE 2 WAS DRAWN ONE NOTCH TOO WIDE, NOT WRONGLY.** Its reason still holds:
  a pilot reaches for undo right after editing an altitude, and the cursor is
  still in the box - which is why number fields must NOT be treated as text.
  **THE LINE IS THE MODIFIER.** A chord with Ctrl, Alt or Cmd is a shortcut
  wherever it is pressed; a BARE key belongs to the field being typed in.
  `isBareKey` in `keys.js` says which, `editing` is the new context flag, and
  `textLike` stays the stricter free-text test that blocks modified chords too.
- SHIFT IS NOT A MODIFIER HERE, because Shift+2 is how a keyboard types `@`.
  Escape is answered before any of this, so it is still the way out.
- **A TEST THAT DISPATCHES ON `document` PROVES NOTHING.** The guard reads
  `e.target`, so the event has to be dispatched ON the focused field, the way a
  real keypress arrives. The first version of the page test fired one event at
  `document` first and then blamed the code for the plan it had itself switched.
- `verify-layout.mjs` TYPES FOR REAL: 4500 into an altitude with three plans
  open, 8.5 into the reserve, and asserts the active plan never moved and the
  digits actually landed in the box.

**2. THE EDITABLE COLUMNS WERE PINNED TO A PERCENTAGE OF THE TABLE.** *"The real
estate the numbers get is still insufficient compared to the other values."*
Every header carries an inline percentage width - `Alt` **5%**, `OAT` and `VAR`
**4%**, against **10% each** for From and To - so the columns holding the widest
typed values shrank with the panel and were the first to starve.

- v16.68's `min-width` on the nested INPUT was arguing with the column's own
  declared width instead of setting it. On the `th` it IS the column minimum,
  and the percentages go on distributing whatever is left.
- **THE ch COUNT IS MEASURED, NOT ARITHMETIC.** `ch` on a `th` resolves against
  the header's 10 px font while the value is typed at 11 px in an input that
  also spends 4 px on padding and 2 px on its border. Working it out on paper
  crosses two font sizes and gets it wrong: 7ch measured 39 px where a
  five-digit altitude needs 44.
- MEASURED AFTER, at panel widths from 901 px down to 163 px: Alt **47 px**,
  OAT and VAR **36**, against MT 28 and TAS 24 - the editable columns are now
  the roomiest of the numeric group rather than the narrowest, and nothing
  clips at any width.
- **A `|| true` IN A CHECK IS NOT A CHECK.** The first Ctrl+Z assertion here was
  written as `check(a !== b || true, ...)` and passed unconditionally. Worse,
  the thing it meant to assert was untestable as written: these fields push
  their undo state on `change`, so typing without committing leaves nothing to
  undo. It commits with Enter first now, and asserts the value really reverts.

## The panel divider (v16.67)

The pilot asked whether the edge of the plan panel could be dragged to give more
or less of the window to the map, in Split and in Stacked. It can, and the whole
thing is 6 px of bar plus one number per layout.

- **WHAT IS STORED IS THE MAP'S FRACTION OF `#main`**, not a pixel width, so the
  same figure means the same thing after a window resize - and Split and Stacked
  keep SEPARATE figures (`splitRatio`, `stackRatio`), because a good side-by-side
  split is not a good stacked one and one number for both would move the divider
  every time the layout changed.
- **AN UNDRAGGED APP WRITES NOTHING AT ALL.** The sizes go through
  `var(--map-flex, 1.05)` and `var(--map-h, 42vh)`, so the stylesheet's own
  fallbacks are still the shipped design. Reset CLEARS the stored figure rather
  than writing a default one - there is no second place for the default to live
  and drift.
- **THE BAR IS EXACTLY AS WIDE AS THE BORDER IT REPLACES (2 px), AND THAT WAS
  DECIDED BY MEASUREMENT.** A fatter handle is easier to see, and the first
  version was 6 px - which pushed the whole plan panel sideways and re-laid the
  map out narrower: `verify:visual` against v16.66 reported **75 648 pixels
  changed** for a feature that adds a gesture. At 2 px, with the map's own
  `border-right` removed where the divider is shown, the sidebar is **0 pixels
  different** and what is left is the version badge plus ~1 px of antialiasing
  on the route line. The shipped design is the author's; it should not move as a
  side effect. What makes the divider findable is the CURSOR and the hover
  highlight, and neither costs any layout.
- **A BASIS, NOT A GROWTH FACTOR, AND THAT WAS MEASURED.** The first version set
  `flex: <r>` on the map and `flex: <1-r>` on the plan; in Chromium the bar came
  to rest **11 px left of the cursor**, and further off the further right it was
  dragged. Growth factors share out the space LEFT OVER after every panel's own
  border and padding - 2 px of map border, 20 px of sidebar padding here - and
  nothing in the page can see those numbers to correct for them. `flex: 0 0 X%`
  is a length the browser resolves exactly as `paneRatioFromPoint` computes it,
  and the plan panel keeps its grow factor and takes the rest. Landed at 1 px.
- **THE 240 px FLOOR IS FOR THE AUTOMATIC LAYOUT, NOT FOR THE PILOT.**
  `min-height` on the stacked map exists so a short window never collapses the
  map on its own; a floor that silently overrode a hand-placed divider would
  drag it back with nothing said, which is the silent failure this project
  refuses. It is `var(--map-min-h, 240px)` and a drag sets it to 0.
- **THE BOUNDS ARE ARGUED, like every other bound here**: below 0.15 the map is
  a strip too narrow to read a chart in; above 0.85 the OFP table is squeezed
  past the point where its columns fit, which is the one thing `verify:ofp`
  exists to prevent. Neither end reduces a panel to nothing - a divider you
  cannot find again is a trap.
- **THE ARITHMETIC IS A PURE MODULE** (`paneRatioFromPoint`, `normalisePaneRatio`
  in `anchors.js`), so the whole of it is tested without a browser and the
  browser only has to prove the wiring - the same division of labour as
  `keys.js`. The page picks the axis and nothing else.
- **POINTER CAPTURE IS THE PLATFORM'S ANSWER TO THE v16.46 STUCK DRAG.** The
  line drag had to grow four cancel paths because a mouseup could go missing;
  `setPointerCapture` routes every later pointer event to the bar whatever it
  crosses, and `lostpointercapture` and `pointercancel` both end the drag.
- **`role="separator"` WITH A TAB STOP IS A PROMISE THAT THE ARROW KEYS WORK**,
  so they do: 2% a press, Home or Enter to reset. Offering the tab stop without
  them would be an accessibility claim the page does not honour.
- **NO INLINE HANDLER.** A pointer drag needs move and up bound in code anyway,
  and the v16.53 keybind row is the standing reminder that a handler built by
  string interpolation is where a quote goes wrong.
- **THERE IS NO DIVIDER WHEN THERE IS ONLY ONE PANEL.** Plan-only and Map-only
  hide one of them, and the Menu skin collapses the plan to a hover rail -
  resizing a panel that is about to slide away is not a gesture with a meaning.
- jsdom has no layout, so every rect is zero and a drag cannot be measured
  there. `verify-layout.mjs` drags the real bar with the real mouse on both
  axes and reads the boxes back: the bar lands within 1 px of the cursor, the
  map gains what the plan loses, the position survives a reload, double-click
  clears it, the arrow keys nudge it, a hand-placed divider beats the 240 px
  floor (131 px measured), and the bar is absent in all three cases above.
  Six mutations were run against the finished guards - the ratio over free space
  instead of the container, a growth factor instead of a basis, the floor left
  in, a reset that writes a default, the Menu skin keeping a divider, and no
  clamp at all - and all six fail the suite by name, none of them only through
  `tsc`.

### A NUMBER CELL HAS TO BE ABLE TO HOLD ITS NUMBER (v16.68, the pilot's report)

Dragging the divider inwards showed something that had been wrong all along:
*"the increase / decrease button space hides the values of altitude, OAT, VAR"*.
Two causes, and the divider only made the second one obvious.

- **THE NATIVE SPIN BUTTON COSTS ~18 px INSIDE THE BOX.** Measured on the OFP
  table at the SHIPPED panel width, before any dragging: the Alt input had 22 px
  of content box against 45 px of content, and every numeric cell rendered as a
  dash. With the divider dragged in it was 11 px. The stepper was never paying
  for itself either - the UP and DOWN keys already step by the field's own
  `step`, which is where the 500 ft came from in the first place - so it is
  suppressed everywhere and the fields stay `type="number"` (validation, and a
  numeric keypad on a touch device, both survive). The titles now say which keys
  step, because the arrows used to say it for themselves.
- **`width: 100%` ON A FORM CONTROL GIVES ITS COLUMN NO MINIMUM**, so the table
  crushed exactly the editable columns while From and To kept their text. That
  is the half a screenshot does not explain: `.table-container` has been
  `overflow-x: auto` all along and simply never had to scroll, because those
  columns collapsed first. `td input[type="number"]` now has a floor of 3.4ch
  and the altitude a wider 5.4ch - the widest value each column can legitimately
  hold, a five-digit altitude and a signed two-digit OAT or variation - and the
  table scrolls instead.
- MEASURED AFTER: 0 of 6 number cells clipped at 901, 598, 418 and 223 px of
  plan panel, against 6 of 6 clipped at every one of those widths before.
- **THE WHEEL WAS CHECKED, NOT ASSUMED.** A scroll that silently re-planned an
  altitude would be the plausible wrong answer this project exists to refuse.
  Chromium does not step a number field on wheel here (13000 -> 13000 over a
  focused Alt cell), so no guard was added - but the verifier asserts it, so a
  browser change would surface as a failure rather than as a wrong number.
- BOTH HALVES WERE PROVED LOAD-BEARING: restoring the stepper and removing the
  column floors each fail four checks in `verify:layout`. The FIRST attempt at
  the stepper mutation reported "not caught" and was wrong - it flipped
  `appearance` and left `::-webkit-inner-spin-button` still hiding the arrows.
  A mutation that does not actually restore the old behaviour proves nothing.

## SKINS, and the plan for restyling the whole shell (v16.65)

The author wants to try WHOLE DIFFERENT LOOKS - "sidebar becoming top bar",
"sidebar becoming a menu if I want it minimalistic", different button styles and
placing - cheaply, and without a typo slipping past the checks. This is the
agreed plan and where it has got to.

### THE THREE TIERS, AND WHY THE LINE FALLS WHERE IT DOES

The shell is `#header` and `#main`, and `#main` holds exactly two children:
`#map-container` and `#sidebar`. That structure decides what is cheap:

- **TIER 1 - CSS ONLY. DONE at v16.65.** Anything that RE-PLACES or RE-STYLES a
  whole panel. Making `#main` a grid lets a skin put the sidebar across the top,
  collapse it to a rail, stack it, or reverse it - and style every control -
  without one element moving in the markup. No id changes, no `on*=` handler
  rewritten, so **no wiring can break**. That is the safety argument, and it is
  why skins are CSS-only BY RULE: a test asserts every rule in `src/skins.css`
  is scoped to a `body.skin-` class.
- **TIER 2 - DONE at v16.66, and it did NOT need roadmap 18.** REPARENTING a
  control: lifting one button out of the sidebar and dropping it in the header.
  CSS places a box inside its own container and no further - that part was
  right. The wrong part was the conclusion: **`appendChild` MOVES A LIVE NODE**,
  and the node keeps its id, its inline `on*=` attribute and every listener
  already attached. So a skin reparents real controls at runtime, and neither
  the markup nor the handlers nor the compiler come into it. See "Tier 2" below.
- **TIER 3 - NEEDS A DATA-DRIVEN RENDERER.** Reordering the OFP COLUMNS ("the
  flight plan screen shows the values in different orders"). CSS cannot reorder
  `<table>` cells - `order` does not apply to table-cell boxes - and the row
  markup is generated by `ofpRowCells` with the column order hardcoded. The fix
  is to make that order a LIST the renderer walks, which is a contained change
  to one function plus the header row. NOT attempted yet; it is the next thing
  to do if column order matters more than panel placement.

### WHAT v16.65 SHIPPED

- `src/skins.css` (a `body.skin-<id>` block each) and `src/lib/skins.js` (the
  list, kept pure so the page, the tests and the verifier read the same one).
  Both are inlined into the SAME `<style>` element, because a test asserts the
  page carries exactly one (v16.19).
- Three skins beyond the default: **Menu** (the plan collapses to a rail and
  opens on hover or focus, no JavaScript), **Compact**, **Bold**.
- **TOP BAR WAS TRIED AND REMOVED at v16.66** - the author's own example of what
  they wanted, and having seen it, *"didn't do any wonders"*. Recorded because
  the mechanism worked exactly as intended: one CSS block deleted, one line out
  of `SKINS`, nothing else touched. A look that is cheap to try is also cheap to
  throw away, which is the entire point of the arrangement.
- **THE DEFAULT SKIN HAS NO CSS AT ALL, and a test enforces it.** It is the
  shipped design; every restyling change must leave it pixel-identical, which
  `verify:visual` proves rather than assumes.
- ADDING ONE is a block in `skins.css` plus a line in `SKINS`. Nothing else -
  which is the whole point, because a look that is expensive to try does not get
  tried.

### TIER 2 - A SKIN MAY MOVE A CONTROL BETWEEN PANELS (v16.66)

`SLOTS` are the containers that may receive; `MOVABLE` is the whitelist that may
move; a skin carries `place: { 'undo-btn': 'map-controls' }`. Both lists are
enforced, so a skin can neither relocate something the layout depends on nor
drop a control somewhere unstyled.

- **THE MENU SKIN USES IT IN ANGER**, which matters - a mechanism no skin
  exercises is untested by definition, and a test asserts at least one does.
  With the plan collapsed to a rail, Undo, Redo and Settings would be behind a
  hover, so they move onto the map. Same buttons, same handlers, different
  parent.
- **HOME IS A PARENT *AND* A POSITION.** Putting a control back with
  `appendChild` returns it to the END of the row, so every switch drifts the
  header one place further.
- **AND RESTORING HAS TO RUN RIGHT-TO-LEFT.** A control is put back before the
  sibling it used to precede - but if that sibling moved too, it is not back
  yet and the insert falls through to the end anyway. Measured: Undo came home
  at index 11 instead of 8. Restoring in descending original index means each
  control's next sibling is already home by the time it is needed.
- **THE WEAK ASSERTION HID IT, AND THAT IS THE LESSON.** The first version of
  both the test and the verifier compared `parentElement.id` on each side - and
  the home row has NO id, so both sides read `''` (or the same hard-coded
  fallback) and the check passed while the control was three places adrift.
  Comparing a value that is constant on both sides is not a comparison. They
  compare the INDEX among siblings now, and that found the bug immediately.

### THE TYPO NET, because a CSS mistake is SILENT

A browser drops a declaration it cannot parse and says nothing, so `colr: red`,
a missing brace and `var(--text-mutedd)` all render as "no rule applied" - which
looks exactly like a rule nobody wrote. Nothing else here could catch it: the
tests read text, and the pixel verifier only knows the page changed, not why.
`lintCss` in the build now fails on three things that are certain rather than
arguable: unbalanced braces, a declaration with no colon, and a `var(--x)` whose
`--x` is never defined (a var() WITH a fallback is a deliberate default and is
allowed).

**IT FOUND FOUR REAL BUGS THE MOMENT IT WAS WRITTEN.** `--card-bg`, `--text`,
`--bg` and `--border` were used but never defined - the real names are
`--bg-card`, `--text-main` and `--border-color`. Nine declarations, silently
doing nothing: the settings tabs and the fix/route/leg previews had no borders
at all. They had been broken for as long as those rules existed.

### `verify:skins` - A LOOK THAT LOSES A BUTTON IS NOT A LOOK, IT IS A BUG

CSS cannot break the wiring, but it can absolutely push a control off screen,
collapse it to nothing or clip it away - and this project has shipped exactly
that (v16.22, two map buttons at y=900 on a 900 px viewport, with every grep
passing). So every skin, at 1500x950 and 1280x720, is held to: the same
INVENTORY of interactive elements as the default (118 of 118), every visible
control REACHABLE, nothing collapsed to zero, and no sideways scroll.

- **BELOW THE FOLD IS NOT LOST**, and the first version of the check got this
  wrong - it failed the DEFAULT skin over `metar-fetch-btn`. The sidebar is a
  designed scroll region and CLAUDE.md already says so (v16.49: on a 720 px
  window something must scroll). The check walks up to the nearest scrolling
  ancestor and asks whether the control is inside its scrollable area; it fails
  only for something genuinely unreachable.
- **MEASURE THE AXIS THAT ACTUALLY COLLAPSES.** The Menu check compared WIDTH
  and reported a correct skin as broken at 1280x720 - where the layout is
  stacked, `#main` is a column, and the rail collapses HEIGHT. It compares area
  now, and the skin gained an explicit stacked-layout rule, because without it
  Menu silently did nothing on exactly the window size it was meant for.

## Restyling has to be cheap before it can be safe (v16.64)

The author wants to try WHOLE DIFFERENT LOOKS - layouts, button styles, placing -
and asked for it to be fast and for typos not to slip past. Measured first, and
the codebase was not ready for either:

- **THE CSS WAS BARELY TOKEN-DRIVEN.** 14 custom properties against **223 literal
  hex colours (79 distinct)** and 40 `rgba()` scattered through the rules. A new
  look meant editing hundreds of places - expensive, and exactly where a typo
  hides.
- **THE COLOURS ARE NOT ONE POPULATION**, so the fix was scoped by measurement
  rather than swept: 164 uses belong to the APP, 31 to LEAFLET's bundled CSS
  (third-party, left alone) and 12 to the PRINTED OFP - and those 12 stay
  literal ON PURPOSE. `#ofp-print, #ofp-print *` forces black on white so the
  sheet survives a mono printer (v16.41); a theme must never be able to make
  company paperwork grey.
- **30 TONE TOKENS, AND 17 DARK-MODE OVERRIDE RULES DELETED.** Every paired
  rule (`.row-highlight` plus `body.dark-mode .row-highlight`) collapses to one
  rule and one token defined per theme. Zero dark-mode rules still carry a
  literal colour.
- **PROVED BY PIXELS, NOT BY TESTS**, which is the standing rule for a CSS move
  (v16.19). `verify-visual` renders both builds in real Chromium and the
  tokenised one is byte-identical in light AND dark.

### THE VERIFIER WAS BROKEN IN THREE WAYS, AND THAT IS WHY IT WAS NEVER USED

It is not in `package.json`, so it had rotted quietly since v16.45:

1. **ITS DEFAULT REFERENCE WAS A SINGLE FILE** (`/tmp/old_build.html`), left from
   the `dist/` era. The delivery has been THREE files since v16.45, so copying
   `index.html` alone gives a page whose bundle never loads - it failed with
   `escapeText is not defined`. The reference must be a whole `site/` directory.
2. **IT RACED THE BOOT.** A fixed 900 ms wait, then `toggleTheme()` - which
   reached `aircraftProfile` before the page script's top level had run. It
   waits for the app now, not for a clock. **AND THE READINESS PROBE ITSELF HAD
   TO SURVIVE THE DEAD ZONE**: `typeof flights` THROWS while `flights` is a
   `let` in its temporal dead zone, where an undeclared name would simply
   return 'undefined'. The probe is wrapped in try/catch for that one reason.
3. **IT CRIED WOLF ON AN UNCHANGED BUILD.** Comparing a build against ITSELF
   reported 11 differing pixels - the top border of the `#route-selector`
   `<select>`. Native form controls are platform-themed and Chromium does not
   rasterise them identically between runs.
   - **THE FIX MEASURES THE NOISE INSTEAD OF TOLERATING IT.** Each side is shot
     TWICE; pixels that differ between two shots of the SAME build are noise by
     demonstration and are excluded. No threshold is picked, and if the flake
     ever grows the mask grows with it and the run says so.
   - That is deferred nit 13 ("verify-visual always reports 2 problems") - the
     same class of defect, found from the other end.

## Great circle or rhumb line - the pilot chooses (v16.63)

The pilot asked which model the distances used, and the answer exposed a
disagreement the planner had always had.

- **THE NUMBERS SAID ONE PATH AND THE PICTURE SHOWED ANOTHER.** Every distance
  and track was a GEODESIC; the route line drawn on the map was a RHUMB, because
  Leaflet draws straight segments in Web Mercator and a straight line in
  Mercator IS a constant-heading line. Verified in the browser, not assumed: the
  drawn midpoint of ENDU-ENEV sits 1.5 px from the rhumb midpoint and 4.3 px
  from the geodesic one.
- **MEASURED AT 69 N**, and the three effects are different sizes:
  | | 38 NM leg | 53 NM leg | 229 NM E-W leg |
  |---|---|---|---|
  | distance | +0.000 NM | +0.002 NM | +0.308 NM |
  | track | +0.2 deg | -0.9 deg | **+5.1 deg** |
  | how far apart the paths lie | 0.057 NM | 0.301 NM | **5.16 NM** |
  Distance is a non-issue - below the 0.1 NM the OFP prints. The TRACK and WHERE
  THE LINE LIES are what matter, and east-west legs are where they show.
- **THE FIRST COMPARISON OF THE TWO WAS WRONG, and in an instructive way.** It
  put a SPHERICAL rhumb beside an ELLIPSOIDAL geodesic and reported the rhumb as
  0.12 NM SHORTER - which is impossible, a rhumb is never shorter. What it had
  measured was the v16.9 sphere-versus-ellipsoid bias wearing a rhumb costume.
  Compare like with like before drawing a conclusion from a table.
- **IT IS A SETTING, AND IT GOVERNS FOUR THINGS AT ONCE** - line, corridor,
  distance and track. A mode that drew a rhumb and printed the great-circle
  heading would hand the pilot a course that does not fly the line in front of
  them, which is the plausible-wrong-answer failure in its purest form. Default
  is the great circle: it is what a GPS flies, and the paper ICAO 1:500 000 is
  Lambert conformal, on which a ruler line between two fixes is very nearly a
  great circle.
- **`src/lib/rhumb.js` IS ELLIPSOIDAL**, and that is not pedantry. A spherical
  rhumb would reintroduce the exact 0.3% short bias v16.9 removed. The meridian
  arc comes from GeographicLib itself - a geodesic due north IS the meridian -
  so no series is hand-rolled and the ellipsoid matches every other distance.
- **EQUAL FRACTIONS ARE NOT EQUAL DISTANCES ALONG A RHUMB.** Isometric latitude
  interpolates linearly along a loxodrome, but distance is proportional to the
  MERIDIAN ARC, and the two are different functions of latitude. Hence two point
  functions: `rhumbPoint` (by fraction) and `rhumbPointAtDistance` (by distance,
  which is what TOC/TOD marks and the corridor walk need).
- **THE EAST-WEST CASE IS NOT A SPECIAL CASE BOLTED ON.** As the course
  approaches 090 the meridian arc and `cos(course)` both go to zero and the
  quotient is 0/0. A rhumb along a parallel is an arc of that parallel, whose
  ellipsoidal radius is `a*cos(phi)/sqrt(1 - e^2 sin^2 phi)`.
- **THE PATH MODEL IS INJECTED, NOT THREADED** (`setNavPath`), the same
  arrangement performance.js uses for the aircraft profile. Threading a mode
  through computeLegTotals, computeFlightSchedule, computeLegMarkers and every
  caller would touch dozens of signatures to carry one word.
- **THE CORRIDOR NEEDED NO CHANGES AT ALL.** It walks through `interpolateGeo`
  and `trueTrackExact`, both of which consult the setting - so it followed for
  free. That is what the v16.61 decision to build it on the shared geodesy
  primitives bought.
- **ONE DENSIFIER FOR BOTH MODES** (`drawnLineCoords`). In great-circle mode the
  extra points curve the line; in rhumb mode they land on the straight Mercator
  segment and change nothing. A mode branch there would be a second place for
  the two to disagree - and a browser check asserts the point count is the SAME
  in both modes, because asserting otherwise would assert an implementation this
  does not have. Measured in Chromium on Tromso-Kirkenes: 1 px of bow for the
  rhumb, 22 px for the great circle.
- THE LOGICAL PATH IS UNTOUCHED: hit-testing, `alongLegNM`, `legMidpoint` and
  the leg indices all still work waypoint-to-waypoint. The densification is for
  DRAWING only.

### THE tsc TRAP, THREE TIMES IN ONE SITTING

Five mutations reported "not caught" and every one of them had been killed by
the TYPECHECKER before a single test ran - zero FAIL lines, which reads exactly
like a missing guard. Three distinct variants:
1. removing a call left an import unused (`noUnusedLocals`);
2. `navPath === 'never'` has no overlap with `'gc'|'rhumb'` (TS2367);
3. dropping a term left a local unused.
The pattern that works is to keep the call and discard its result
(`void rhumbBearing(...)`). **Count the `error TS` lines as well as the FAIL
lines** - a mutation run that produces neither has proved nothing.

## The corridor ring (v16.61-v16.62, roadmap item 2)

A band of a chosen radius either side of the WHOLE flown track. The author's
purpose, in their words: *"to easily find the MSA around my track by referencing
the altitudes on the chart, its supposed to be [see-through] to be able to read
off the chart"*.

- **IT IS GEOMETRY, AND IT SAYS SO EVERYWHERE.** It shows WHERE to read the
  chart's contours and MEF; it computes no MSA and states no altitude. That is
  the terrain decision (Kartverket's elevation API was offered and DECLINED)
  applied consistently - a height invented here would be the plausible wrong
  answer this project exists to refuse. The guide, the setting's help text and
  the button tooltip all say it.
- **ROUND JOINS AND ROUND CAPS ARE NOT A STYLE CHOICE.** "Within 1 NM of the
  track" is a SET, and the boundary of that set is genuinely circular at every
  vertex and both ends. A squared end would stop the corridor flat across the
  departure fix; a mitred outer corner would claim ground further away than the
  radius.
- **THE UNION IS DRAWN AS PIECES, NOT AS ONE TRAVERSAL.** `corridorPieces`
  returns a band per leg plus a disc per turn, handed to ONE `L.polygon` so
  there is one fill and nothing double-darkens (the v16.30 defect). A single
  traversal has to fold back at the inside of a turn, and where the fold is
  tight the winding cancels and the fill punches a NOTCH out of the band -
  measured at 2-9 of 224 boundary samples once the turn approaches a hairpin
  and the radius reaches half the leg length. Rare, and a hole in the corridor
  at the corner a pilot looks hardest at.
- **`fillRule: 'nonzero'` IS LOAD-BEARING.** Under the default evenodd every
  overlap between pieces becomes a hole, at exactly the turns.
- **`L.polygon([[ringA],[ringB]])` MEANS "ringB IS A HOLE IN ringA".** The discs
  were being punched OUT of the bands until the pieces were nested one level
  deeper as a MultiPolygon. Nothing in the maths was wrong; the handoff was.
- **A MITER AT INNER CORNERS WAS WRITTEN AND THEN DELETED.** Removing it changed
  no test, because the disc at every turn already covers that pocket. Two
  mechanisms for one job, one of them limited at sharp angles and untested
  because the other hid it. Prefer the deletion to the second mechanism.
- **THE EDGE IS WALKED, NOT STEPPED END TO END.** A leg's bearing changes along
  it - a third of a degree over 38 NM at 69 N, and miles over a 600 NM leg - so
  offsetting only the two endpoints draws an edge that leaves the corridor in
  the middle. The step is capped BOTH absolutely (10 NM) and at twice the
  radius, because what matters is the chord sag as a FRACTION of the radius.
- **THE TRANSPARENCY IS A SETTING** (2-60%, default 8%, the pilot's request):
  the right value depends on the chart underneath. The bounds are argued -
  below 2% the band is not reliably visible, above 40% the contours and MEF stop
  being legible through it, which is the whole point.
- Radius 0.1-25 NM: below 0.1 the band is narrower than the track symbol at
  reading zoom; above 25 it is wider than a screenful, so both edges are off
  screen and it has stopped being a corridor you can see the sides of.
- Its own pane at z-index **370** - below airspace (380) and far below the route
  line (400). Above them, a press meant for a leg would hit the band first and
  bubble to the map as "add a waypoint". `interactive: false` as well.

### v16.62 - the pilot flying it, three days later

- **THE MAP SETTINGS PAGE WAS A WALL OF PROSE.** Every bound and default in this
  project is argued in the UI on purpose - "the page says both, rather than
  presenting a slider with mystery ends" (v16.35). Four settings' worth of that
  reasoning stacked up is a page nobody reads. Each help block is now a native
  `<details>` whose summary says what the setting does in a few words ("Shows a
  ring around the track"); the argument is one click away and still there.
  Measured collapsed at 13 px a block.
  - **MEASURE THE `<details>` BOX, NOT THE INNER DIV.** A closed details hides
    its content with `content-visibility`, and a descendant's rect under that is
    not a reliable zero - the first check read 15/45/60/225 px for four blocks
    that were all correctly closed. What matters is how much page the block
    occupies anyway.
- **THE BAND'S COLOUR IS SETTABLE: route colour, or one for all.** The pilot's
  words: *"some colours are harder to read than others"*. The corridor is
  BACKGROUND rather than an identifier - unlike the track itself there is rarely
  a need to tell one plan's band from another - so one colour for the lot is a
  legitimate default position. It follows the fix-style precedent exactly:
  validated hex, re-checked on every read, falling back to a default rather than
  to invisible markup. The default single colour is slate grey, deliberately NOT
  one of ROUTE_COLORS, so it cannot read as belonging to a particular plan.
- **THE TRANSPARENCY CEILING WENT 40% -> 60%, AT THE PILOT'S REQUEST.** The
  legibility argument behind 40 is unchanged and the setting still states it -
  past roughly 40% the contours and MEF start to wash out, which is the whole
  point of the band. But which is worse, a band you cannot see or a chart you
  can only just read, is a judgement about their own eyes and their own chart.
  Raising the ceiling did not move the default.

### THREE TEST FAILURES THAT WERE THE TEST, NOT THE CODE

Worth recording, because each cost a cycle and each has the same shape - the
harness being less exact than the thing it measures:

1. A sampler walking a CONSTANT INITIAL BEARING instead of the geodesic. Over
   600 NM it is a different line, so a correct corridor failed.
2. A distance-to-track search sampling COARSER THAN THE RADIUS: 400 steps over
   a 604 NM leg is 1.5 NM apart, and it reported a 0.1 NM corridor as reaching
   0.761 NM. Replaced with a coarse scan plus a bisection.
3. `isPointInFill` fed container coordinates. Leaflet transforms its pane, so
   `getScreenCTM` did not account for it and every probe came back false.
   Measuring the band's WIDTH against Leaflet's own projection needs no
   coordinate gymnastics and proves the same thing.

### AND FOUR MUTATIONS THAT REVEALED MORE THAN THE FEATURE

- **A MUTATION KILLED BY `tsc` PROVES NOTHING.** Twice a mutation made a local
  unused, so `noUnusedLocals` failed the run BEFORE the tests - zero FAIL lines,
  which reads exactly like "not caught". Mutate so the identifier stays
  referenced (`Math.min(1, ...)` rather than `1`).
- **`grep ... | head` ALWAYS EXITS 0**, so `|| echo "not caught"` never fires.
  Count the FAIL lines instead.
- **TESTING RING VERTICES CANNOT CATCH CHORD SAG.** Every vertex of a
  chord-only edge is at exactly r by construction; it is the straight line
  BETWEEN them that leaves the corridor. The test now checks segment midpoints
  too, which is what finally caught the un-densified build.
- **A THRESHOLD JUST ABOVE THE BROKEN VALUE IS NOT A GUARD.** `band.length >
  L / 10` was 62 for a 604 NM leg and the broken build produced 66, so it
  passed. It is `> 300` now, against a real value in the thousands.

## The keyboard belongs to the pilot (v16.52, roadmap item 10)

`Settings -> Keyboard` lists every action the planner has and binds any of them
to any keystroke. The mapping used to be a chain of `if`s in `keys.js`; it is
now a TABLE - `ACTION_SPECS` plus a keymap - which is what makes it settable,
and what stops a binding being added without saying where it may fire.

- **EVERY ACTION IS IN THE MENU; MOST SHIP UNBOUND.** The pilot asked for the
  whole list, and a menu that hides half the app's verbs is not a keybind menu.
  But inventing a dozen shortcuts to fill it would take chords away from them
  and guess at what they want - so the DEFAULTS are exactly the bindings that
  already existed, and the other ~15 (layers, base chart, ruler, View Mode, new
  plan, wind matrix, Settings, guide, Print, layout) are listed, described, and
  left to be claimed.
- **THREE REFUSALS, EACH WITH A STATED REASON.** A menu that silently ignores
  what you pressed is the same silent-key failure this module exists to prevent.
  1. **A CHORD THE BROWSER OWNS.** `preventDefault` does NOT stop Ctrl+W,
     Ctrl+T, F5 and friends in any mainstream browser - the tab closes anyway.
     Offering them would be a promise the platform revokes at the moment it
     matters, which is the NO GUESSTIMATES rule applied to a keystroke.
     `RESERVED_CHORDS` refuses them by name.
  2. **A CHORD ALREADY IN USE.** Two actions on one chord means whichever comes
     second never fires. The menu refuses it and NAMES the other action;
     `normaliseKeymap` drops it as well, for a hand-edited file.
  3. **ESCAPE IS FIXED.** It is the way out of a dialog AND out of a stuck line
     drag (v16.46), so rebinding it could leave the pilot with no way back. The
     row says so rather than leaving a Set button that refuses.
- **ONE CHORD PER ACTION, and that cost two aliases** - `Ctrl+Y` for redo and
  `Backspace` for delete. Both were hardcoded second bindings, and carrying them
  would have meant two slots per row in the menu. They are bindable in one
  click now, which is the whole point of the feature; the loss is stated rather
  than quietly absorbed. A Mac's "delete" key reports `Backspace`, so that one
  matters more than it looks - it is called out in the guide.
- **"Ctrl" MEANS CTRL OR COMMAND**, as it always has here. One binding that
  works on either keyboard beats two rows that differ by platform, and the menu
  says so. The chord's canonical spelling has a FIXED modifier order
  (`Ctrl+Alt+Shift+X`), so one keystroke cannot sit in the map under two names
  and shadow itself.
- **THE ROW HAS NO INLINE HANDLERS, AND THAT IS A FIX (v16.53).** v16.52 shipped
  a list whose Set and Clear buttons were COMPLETELY INERT. They were built as
  `onclick="beginKeybindCapture(' + JSON.stringify(id) + ')"` - and
  `JSON.stringify` emits DOUBLE quotes, which closed the `onclick` attribute on
  the spot, leaving the handler as `beginKeybindCapture(`. It is the same
  attribute-quoting failure v16.47 was written about, in code written after it.
  - **IT GOT THROUGH BECAUSE THE TESTS DROVE THE FUNCTIONS, NOT THE CONTROLS.**
    Both the jsdom tests and `verify-layout.mjs` called `beginKeybindCapture()`
    and `clearKeybind()` directly, so all of them passed against a list of dead
    buttons. Driving the function proves the function; only a real CLICK proves
    the control. Both now click, and reinstating the v16.52 markup fails the
    suite by name.
  - Listeners are attached to the elements, so there is no attribute for a
    quote to escape from, and a test asserts NO `on*` attribute exists anywhere
    in the list. The handler count guard catches it independently.
  - Checked rather than assumed: every OTHER inline handler in the page
    interpolates a number (`${fIdx}`) or a hand-written single-quoted literal.
    The keybind list was the only place a string was serialised into one.
- **THE CHORD BOX IS THE CONTROL** (the pilot's request): click the shortcut you
  want to change, rather than aiming at a separate Set button beside it. While
  capturing, **Cancel takes the Clear button's place**, so the row never grows a
  third control and the way out is where the hand already is.
- **CAPTURE RUNS IN THE CAPTURE PHASE AND SWALLOWS THE EVENT.** Binding Ctrl+S
  must not also SAVE, and binding Delete must not also delete a waypoint. jsdom
  cannot prove that, so `verify-layout.mjs` presses Ctrl+S at a real browser
  while capturing and asserts the save dialog opened ZERO times - then rebinds
  undo to Alt+U, presses Ctrl+Z (nothing happens) and Alt+U (it undoes).
  Closing the modal ends any capture, or the map would go deaf with nothing on
  screen to explain it.
- **KEYBINDS TRAVEL IN THE EXPORTED JSON**, normalised on the way OUT as well as
  in, so an export can never carry a chord the app would refuse to load. They
  are NOT in PROFILE_KEYS: that whitelist guards the aircraft profile and the
  personal-data rule, and a list of keystrokes identifies nobody - but it gets
  the same treatment on every read regardless.
- **THE HELP IS BUILT FROM THE LIVE KEYMAP** (`keyHelp()`), so it cannot describe
  a binding that is not in force. The static list it replaced could.
- **A TEST SLICING THE PAGE SCRIPT NEEDS AN ANCHOR, NOT A GREP.** Three guards
  split the built file on `document.addEventListener('keydown'` - and the
  keybind CAPTURE listener now registers earlier in the file, so all three
  silently started inspecting the wrong function. They anchor on a
  `/* @KEY-DISPATCH */` marker now. The same trap will catch the next person who
  adds a listener above the dispatcher.
- **THE NINE FLIGHT-PLAN CASES ARE WRITTEN OUT** rather than caught by a regex in
  `default:`. A test asserts the switch has a `case` for every id the resolver
  can return, and a catch-all makes that guard inexact - which is the
  looser-assert-than-the-measurement trap this file names by name.

## The track, and reaching a plan from the map (v16.50-v16.51, roadmap 7 - 9)

- **THE DASHED ALTERNATE TRACK IS GONE, and this REVERSES a stated decision.**
  Every second flight used to be dashed so an identical return route drawn on
  top of its outbound stayed distinguishable. The author's call: *"I want to
  remove the dashes as they've become obsolete with the hiding of the inactive
  route. The colour difference is enough."* They are right about the premise -
  the dash predates the edit-mode dimming, which fades every inactive plan to
  0.35 and stops it taking the mouse, and `ROUTE_COLORS` already separates them.
  A dash on top of that read as a property OF the route rather than as "this one
  is not active". The guide said "every second one is dashed" and now says what
  actually distinguishes them.
- **TRACK THICKNESS IS A SETTING (2-10 px), AND THE GRAB LINE IS NOT.** The
  bounds are argued rather than picked: below 2 px the track is hard to follow
  across chart ink at reading zoom, above 10 px it covers the frequencies, MEF
  and airspace limits it is drawn over - which is the same argument that caps
  the fix symbol at 18 px.
  - The invisible hit line stays a flat 20 px. Tying it to the visible weight
    would make a THIN track harder to grab than a thick one, which is the exact
    pixel-hunting that line exists to remove (v16.27). A test asserts
    `ROUTE_WEIGHT_MAX < 20`, so the two cannot cross.
  - `normaliseRouteWeight` lives beside `normaliseFixStyle` in `anchors.js` for
    the reason that file already owns: it is a map-display preference carried in
    PROFILE_KEYS, so it can arrive from a route file somebody else wrote and is
    RE-VALIDATED on every read, not trusted from storage. It reaches Leaflet as
    a number rather than markup, so the risk is a NaN or an absurd value rather
    than injection - but the rule does not have exceptions.
- **THE MAP-ONLY VIEW COULD NOT START A PLAN (roadmap 7), and that was a real
  gap rather than a preference.** `+ Add Flight Plan` lives inside `#sidebar`
  and `layout-map` hides the sidebar, so in the one view where you are actually
  drawing on the chart there was no way to begin. Two controls join the
  `#map-controls` stack, which since v16.24 is a flex column where a new control
  needs no CSS at all and therefore cannot fall off the bottom of the page.
  - The flight SWITCHER was unreachable there for the same reason, which is why
    the second control both NAMES the active plan (with its route colour on its
    left edge) and cycles to the next. With one plan there is nothing to cycle
    to and it says so - a control that appears to do nothing is worse than one
    that explains itself.
  - `verify-layout.mjs` asserts it by MEASURING: sidebar really hidden, both
    controls on screen with a real box, and the button actually adding a plan.
    Grepping for the id is what passed in v16.22 while the buttons sat at y=900.
- **"," AND "." STEP BETWEEN PLANS, AND THEY DO NOT WRAP (v16.51, the pilot's
  request).** A wrapping "next" on the last plan jumps silently to the first,
  which on a five-sector mission reads as the key having done nothing - or as
  having gone the wrong way. Stopping at the ends means a keystroke's effect is
  always what its direction says, and the end is REPORTED rather than passing in
  silence, which is the failure the pure resolver exists to prevent.
  - **THE MAP BUTTON STILL CYCLES, and that difference is deliberate rather than
    an oversight.** It is ONE control, and in the map-only view it is the only
    way to change plan without a keyboard - so a non-wrapping version would
    strand the pilot on the last plan with no way back. A cycle is the right
    affordance for a single button; a directional pair is the right one for two
    keys. Its tooltip says which it is, and a test asserts both behaviours so
    the pair cannot quietly converge.
- **1-9 ACTIVATE A FLIGHT PLAN (roadmap 9), and it was cheap because the trap
  was already handled.** `dialog.js` binds those same digits to pick a dialog
  option, and `ask()` is used everywhere - so a global digit binding would have
  made naming a waypoint a game of chance. The overlay guard that prevents it
  has existed since v16.46, and `resolveKey` puts this binding below it. A
  number with no plan behind it says so rather than doing nothing silently.
  - The resolver returns an `index`, not an action per digit, so the page
    decides what an out-of-range number means. That keeps the mapping a
    description of the keystroke rather than a list of nine near-identical
    cases.

## Quality of life, one batch (v16.49, item 16 - AUDIT.md section 4)

Fourteen items, none of which changes a calculation. Two were already done (the
wind-matrix guard at v16.43, the import summary at v16.44) and one turned out
not to be a gap at all. What is worth recording is the three that needed a
DECISION rather than a change, and the one the audit measured wrongly.

- **THE KEY MAPPING IS A PURE MODULE NOW (`src/lib/keys.js`), which is what
  roadmap item 10 asked for.** Every other rule in this project is checked
  without a browser; the keyboard was the exception, and it is the one surface
  where a wrong answer is SILENT - a binding that quietly does nothing looks
  exactly like a key that was never pressed. `resolveKey` takes a description of
  the keystroke and of what is on screen and returns what should happen; the
  page does it. A test asserts the page has a `case` for every action the
  resolver can return, so a binding cannot go dead by being unhandled.
  - The v16.46 overlay rule and the v16.11 `textLike` rule both live here now,
    and the overlay test is BEHAVIOURAL rather than a grep for one line.
  - **Ctrl+S IS CLAIMED EVEN INSIDE A TEXT FIELD**, and that is the one
    deliberate exception: the browser's own Ctrl+S saves the PAGE, which is
    never what is wanted here, and a pilot naming a route has their cursor in a
    field at exactly the moment they want to save.
  - **Cmd+Y IS NOT CLAIMED** though Ctrl+Y is: on a Mac browser Cmd+Y opens
    History, and taking it would be worse than not offering redo twice.
- **THE AUDIT'S DELETE BINDING WOULD HAVE CONTRADICTED ITS OWN MODE.** It asked
  for "Delete to remove the highlighted waypoint IN VIEW MODE" - and View Mode
  is locked and read-only by definition. The entry read `highlightedWaypoint`,
  saw it only ever set in View Mode, and wrote the binding against that without
  weighing what the mode is for.
  - The fix is to give EDIT MODE a selection, which it never had: a marker click
    now selects in both modes (Leaflet fires `click` only when the marker was
    not dragged, so this cannot fire at the end of a drag), and Delete acts on
    it only where editing is allowed. The right-click menu remains the other way
    to remove a waypoint.
- **UNDO NOW COVERS THE PLAN, NOT JUST THE ROUTE (QoL 3).** ETD moves every ETO
  and the whole daylight verdict, and it was the one plan input Ctrl+Z could not
  take back - it lives in a DOM field, not in `flights`. Initial fuel, reserve,
  departure elevation and the flight date go in the snapshot too.
  - **THE SNAPSHOT HAS TO PREDATE THE EDIT, and `onchange` fires too late**: the
    new value is already in the box, so pushing there stores the change rather
    than the state before it. The old value is remembered on `focusin` and put
    back for the length of the push. (`focusin`, not `focus`, because two of
    these fields already use `onfocus` to select their contents.)
  - The flight DATE is in the undo snapshot and still never in storage. Those
    are different questions: v16.3 forbids a STALE date showing wrong sun times
    on a later day; undoing a change made this session is not that.
- **UNDO AND REDO NAME THE STEP (QoL 7).** A stack of bare JSON strings could
  not; the entries carry a label now and all 25 call sites pass one, so the
  buttons say "Undo: delete a waypoint" before you press them. A test asserts no
  unlabelled `pushUndoState()` comes back.
- **THE 13" LAPTOP IS SHORT, NOT NARROW (QoL 4), and this one is measured.** The
  layout auto-pick only ever looked at WIDTH, so 1280x720 already got Stacked -
  and Stacked then spent 42vh of a 720 px window on the map, putting the
  daylight card below the fold at 826 px. `tools/verify-layout.mjs` opens the
  real page at the real sizes and reads `getBoundingClientRect`, because this
  project has shipped invisible controls before with every grep passing (v16.22).
  - Measured after the fix at 1280x720: map 302 -> 230 px, header 76 -> 64 px,
    and the card 440 px into a 426 px sidebar. **THAT STILL FAILED**, and the
    verifier said so - the media query was written ABOVE the base `.card` rule,
    and a media query adds no specificity, so source order won. Moved below it:
    410 px into 426. A wide, tall window is asserted UNCHANGED.
  - The honest limit: on a 720 px window with a header, a map, an inputs card,
    an OFP table and three more cards, something must scroll. The daylight card
    is on screen now; the METAR card below it is not.
- **A SEARCH HIT SAYS HOW FAR AND WHICH WAY (QoL 9), AND IT IS NOT THE NUMBER
  THE RANKING USED.** The audit noted the ranking already computes a distance -
  it does, with `roughNM`, a local-scale approximation whose own comment says it
  must never be read. The few hits actually shown get proper WGS-84 figures from
  geodesy.js, which costs at most nine calls.
  - **THE BEARING IS TRUE AND SAYS SO.** A magnetic one would need a variation at
    the map centre, and this is a hint for telling the two BREIVIKAs apart, not a
    heading to fly. Labelling a true bearing as magnetic is exactly the plausible
    wrong answer this project refuses.
- **QoL 13 WAS NOT A GAP.** It asked for a print preview "since today the only
  route is Ctrl+P" - but a `Print OFP` button has been in the header since
  v16.41, and `window.print()` IS the browser's preview. Nothing was built; the
  button is renamed `Print / preview OFP` and its title says what it opens.
  Reporting the item as done without saying this would have been a lie by
  omission.
- The rest, briefly: the leg panel closes on a backdrop click like every other
  modal (QoL 1 - Escape already reached it at v16.46); an empty plan says how to
  start instead of showing a blank panel (QoL 5); the ETD field names the ACTUAL
  offset rather than the word "local", read from the flight date so it is right
  across a DST change (QoL 10); the save dialog says `Replace "X" with this plan`
  instead of `Update "X"`, because that option is the one that destroys
  something (QoL 11); the version badge distinguishes offline from blocked
  (QoL 12); and hovering an OFP row traces that leg on the map (QoL 14) as a
  TRANSIENT overlay - re-rendering on `mouseenter` would rebuild the table under
  the cursor and run the integrity check on every row the pointer crosses.

## Housekeeping, one batch (v16.48, item 15 - M3, M4, M5 and L1-L10)

Nothing here changes a number a pilot flies by. Two of them changed a number a
pilot READS, and one of them was a gate that did not gate.

- **M4: NOTHING IS WRITTEN UNTIL THE BORDER RECONCILIATION HAS PASSED.** This
  file calls `resolved + refused + notDrawn == published` "a build error, not a
  warning" - and it was, except the throw came AFTER the writes, so the dataset
  that violated it was already on disk and a `git add -A` would have committed
  it. Exiting 1 does not un-write a file. The check is the gate now.
  - **L1 was the same ordering bug wearing a different hat**: `delete
    report._border` sat after the write too, so the 18 435-point Kartverket line
    shipped in `data/aip-report.json` (1 129 KB against 74 KB of real content)
    AND the delete had nothing left to affect. The committed report is 159 KB
    now, stripped with the same JSON.stringify the tool uses so the diff is a
    pure deletion rather than a reformat.
- **M3: THE ETO IS AN INSTANT, NOT CLOCK ARITHMETIC.** `clockFromMinutes` is ETD
  plus elapsed minutes mod 1440; the daylight card works in absolute time. Under
  Europe/Oslo they disagreed by an HOUR across a DST transition - ETD 01:30 on
  2026-10-25 plus 120 min printed 03:30 on the form while the card correctly put
  the landing at 02:30. `clockFromInstant` builds the same instant the card does.
  - **THE "+1" IS A CALENDAR-DAY DIFFERENCE, NOT 1440 MINUTES.** A local day is
    23 or 25 hours long across a transition, so counting minutes puts the marker
    on the wrong side of midnight in exactly the case the function exists for.
  - WHY IT WAS NEVER CRITICAL, and it is worth saying: both transitions fall at
    02:00-03:00 local, which is deep SERA night in Norway on those dates, so a
    legal day-VFR flight cannot be airborne across one. The legality check was
    always right; only the printed time was wrong.
  - **THE SUITE PINS `TZ=UTC`, SO IT COULD NEVER SEE THIS.** A zone with no DST
    cannot produce the disagreement. The test spawns a CHILD PROCESS under
    Europe/Oslo - the pilot's own zone - and asserts the old arithmetic still
    produces the defect, so the fixture cannot quietly stop testing anything.
- **M5: THE ASSERTS NOW MATCH THE MEASUREMENTS THAT JUSTIFIED THEM.** Five
  invariants this file describes were asserted nowhere. Each was added to the
  pin sweep and then PROVED LOAD-BEARING by mutating `legs.js` until it fired:
  1. `exitAlt(k) === entryAlt(k+1)` - the altitude column is the one thing an
     OFP row is, and nothing checked that two adjacent rows agreed. (Mutation:
     +7 ft on one leg's exit -> 870 violations.)
  2. every phase is `>= 0` and finite, asserted DIRECTLY. The bounds checks
     catch a phase that leaves the leg; a negative duration sailed through them.
  3. marks come back in FLIGHT ORDER (legs.js says so, nothing tested it).
     (Mutation: reverse the sort -> 938 violations.)
  4. `atWaypoint` really is within `EDGE_NM` of the fix it names, and names the
     right END. (Mutation: widen to 50 NM -> 3 672 violations.)
  5. `EDGE_NM` is referenced by a test at last - both that it is declared once
     and that the behaviour turns at exactly that value, built directly rather
     than hoping a random route lands on 0.05.
  - A NaN OAT and a NaN wind now go through the whole pin machinery: the totals
    must come out NaN (the v16.20 rule) rather than throwing or, far worse,
    producing a plausible number.
  - **`SWEEP_N` MAKES THE QUOTED SIZES RUNNABLE.** `SWEEP_N=5 npm test`
    reproduces the "20 000 pinned routes" this file quotes; the everyday run
    sweeps 4 000. The figures in this file were development runs and now say so.
- **L3: A FIGURE QUOTED AS EVIDENCE IS RE-MEASURED BY A TEST.** The page script
  said "61 inline on*= handlers" and this file said "24 shared mutable globals";
  both were true when written, neither was true at v16.41, and the audit spent
  effort re-deriving them. It is 108 handlers (83 in markup, 25 generated) and
  32 globals, and a test now fails the day those stop being true. Also corrected:
  the one-`<style>`-block invariant is a TEST, not a build failure, and the boot
  comment said "airspace overlay was removed" three versions after an official
  one was added - the two purged keys belong to the old openAIP one.
- **L5: EVERY DOOR INTO THE PROFILE GOES THROUGH THE WHITELIST.** Export and
  import have used `PROFILE_KEYS` since v16.18; BOOT did not, so a key parked in
  localStorage by an older build survived every reload even though both file
  paths would have dropped it. There was no reason for the storage door to be
  the exception.
- **L7: "PATTERN" IS RESERVED IN BOTH DIRECTIONS.** v16.40 stopped a circuit
  stop being renamed, because the add flow and the return-leg builder test for
  the literal name. The reverse was open: a normal waypoint renamed to PATTERN
  kept `isPattern` false and started being treated as a circuit stop by both - a
  fix on the ground that the route builder thinks is a lap in the air. A name
  that merely CONTAINS the word is still fine.
- **L8: THE SAVED-ROUTE REFERENCE TRAVELS WITH THE PLAN.** `loadedRouteRef` is
  what makes the save dialog offer `Update "X"` first, and nothing cleared it -
  so after undoing back PAST the load, or clearing everything, or importing a
  file, the dialog still offered to update X with a plan that had nothing to do
  with X, and taking that offer overwrote the saved route.
  - **UNDO IS NOT "FORGET X", THOUGH**, which is why it is not simply cleared:
    undo one waypoint off a loaded route and it IS still that route. The
    reference is pushed and popped WITH the undo state; only a wholesale
    replacement (clear-all, an import) drops it outright.
- **L10: A CIRCUIT ROW IS FORMATTED LIKE EVERY OTHER ROW ON THE FORM.** `accBurn`
  was passed through raw, so a running total of 3.4000000000000004 printed in
  full while the rows above and below it read 3.4 - and `String(row.pl)` printed
  the literal "NaN", which is H2 surviving in this one row. `accDist` is left as
  a string on purpose: `one('')` prints 0.0, because `Number('')` is 0 and
  `isFinite` says yes.
- **L2: THE LOCKFILE IS THE THIRD PLACE THE VERSION LIVES**, and it sat at
  16.33.0 for eight releases, so every `npm install` rewrote it and dirtied the
  tree - which trains you to ignore a lockfile diff, the one diff worth reading.
  The build now fails when it drifts, alongside the APP_VERSION check.
- **L4: A CLOCK BEFORE THE DEPARTURE MARKS THE DAY TOO** (`23:30-1`). Latent -
  `accMins` is always forward - but it is the same defect the "+1" exists to
  prevent, in the other direction.
- **L9: A LOOP THAT HOLDS THE ASSERTIONS STATES ITS SIZE FIRST.** Five
  `for (const x of set.features / .sectors / .aerodromes)` loops carried the
  substantive checks and would have passed silently on an empty dataset.

WHAT WAS ALREADY DONE AND IS NOT REPEATED HERE: M2 (an unrecognised import
reporting "Import complete") landed at v16.44, and L6 (`defaultOatTouched` being
assigned from an inline attribute) is a note about what would break if the page
script were ever wrapped - it is a constraint on roadmap item 18, not a defect.

## One escaper, applied everywhere (v16.47, item 14 - H3 and the rest of H1)

Discipline rule 6, finally applied to every surface instead of the three that
already had it.

- **THIS IS CORRECTNESS BEFORE IT IS SECURITY, and the argument matters because
  the author has ruled route files TRUSTED.** A waypoint the pilot names
  `Bodø <VOR>` breaks the OFP row with no malice at all: `<VOR>` is parsed as a
  tag and the rest of the row disappears. That a shared route file can no longer
  carry a script is a second benefit, not the reason.
- **THERE WAS NOT ONE ESCAPER, THERE WERE SIX**, each a local `const esc` inside
  the function that needed it - and they disagreed: three omitted `"`, one
  omitted `>`. Which characters were safe depended on which function you were
  in. `escapeText` now lives in `src/lib/format.js` (a formatting primitive, not
  an anchors one - `anchors.js` re-exports it so existing callers keep the name),
  the page script aliases it ONCE as `esc`, and a test asserts no local copy
  comes back.
- **TWENTY SINKS, and the audit named nine of them.** The rest turned up by
  grepping for `.name` reaching `innerHTML`: the map's own waypoint and circuit
  LABELS (Leaflet `divIcon` html, which is not in the DOM under jsdom), the
  TOC/TOD chip's tooltip, the daylight card's rows AND its warning list, the red
  banner (problem messages NAME the waypoint at fault - that is the v16.20 rule),
  and the version badge's remote tag, which is the one genuinely remote string
  the app renders.
- **WHAT NEEDED NO CHANGE, checked rather than assumed:** `dialog.js` and `say()`
  build their text with `createTextNode`; the route dropdown uses `innerText` and
  `opt.value`; the leg-panel headings use `textContent`; `metarStatus` only ever
  interpolates ICAO codes that `isIcao` has already validated. The METAR card,
  the OFP sheet and the fix labels escaped already.
- **THE TEST IS ONE QUERY OVER THE WHOLE DOCUMENT**, because a per-sink test
  would have missed the eight sinks the audit did not name. A plan whose every
  waypoint is named `<img src=x onerror=... class="xss-probe">` is rendered
  through the table, the sub-leg line, the plotting list, the wind modal, the
  daylight card, the leg panel, the banner and the print sheets, and then
  `body` is asked for a single selector.
  - **THE SELECTOR HAS TO COVER TWO SHAPES, and the second one passed at first.**
    In element content the payload becomes an `<img>`. Inside an ATTRIBUTE - the
    plotting list's `value="..."` - its own quote closes the attribute first, so
    the browser hangs `class="xss-probe"` on the INPUT and there is no `<img>`
    anywhere. Looking only for a tag reported that sink clean.
  - A SECOND TEST ASSERTS THE SURFACES ACTUALLY RENDERED, or "no `<img>`
    anywhere" would also pass if nothing had rendered at all.
  - A THIRD ASSERTS THE NAME SURVIVES: `Bodø <VOR> & co` reads back intact and
    the row still has all its cells. Escaping that silently stripped the name
    would pass the injection test and be a different bug.
  - **EVERY SITE WAS REVERTED IN TURN and the suite re-run**, because a guard
    nobody has seen fail is not known to guard anything. The first pass came back
    17 of 20 - and the three misses were the useful part, because each was a
    surface the probe simply never drove:
    - the CIRCUIT-STOP map label is a SEPARATE interpolation from the waypoint
      label, and the probe's pattern waypoint was named the literal `PATTERN`. A
      route file can give a circuit stop any name even though the app's own
      rename refuses to (v16.40), so it is named hostilely now.
    - the daylight WARNING and CAUTION lists are two more interpolations, and
      both need a plan that is actually illegal. Midwinter at 69 N: the day-VFR
      window is 08:21-13:06, so an 05:00 ETD fires a warning and a 12:00 ETD
      fires the within-30-minutes caution. The probe renders at both.
    - the version badge needed a remote string that reads as NEWER, or the branch
      that renders it never runs; `compareVersions` splits on `.`, so the payload
      goes in a later segment and `99` stays a clean first one.
    That leaves **19 of 20 guarded**. The one that is not is the VAR-source
    `title=` attribute, and it stays that way honestly: `varIndicator` is built in
    the page from `window.WMM_MODEL`, a bundle constant, so no route file can
    steer it. It is escaped for uniformity, not because a path exists. Stated here
    rather than counted as covered - documentation must not get ahead of the code.
- **THE REST OF H1: THE PRINT HOST IS EMPTIED BEFORE THE RENDER, not only
  refilled at the end.** v16.43 stopped the daylight card from skipping the
  banner, but the sheets are written in the LAST statement of
  `renderAllFlightTables`, so a throw anywhere before it still left the PREVIOUS
  plan's sheets in `#ofp-print` - another route's figures going onto company
  paperwork. A failed render now prints nothing, which is the honest outcome.

## An overlay owns the keyboard, and a drag has an exit (v16.46, item 13)

H5 and H6, plus the stale-capture pattern behind H6.

- **AN OVERLAY OWNS THE KEYBOARD WHILE IT IS UP.** The author's rule: *"only
  escape and relevant key bindings on dialog popups, all other keybindings
  disabled during popup."* `anyOverlayOpen()` consults `dialogIsOpen()` plus the
  five page modals, and the global keydown returns early for everything except
  Escape.
  - WHY IT MATTERED: Ctrl+Z fired straight through a dialog. `undoLast` rebinds
    `flights` to a fresh copy, so the handler awaiting that dialog was left
    holding a DETACHED flight - it then "succeeded" and changed nothing.
    Reproduced on "Apply defaults to every leg".
  - **THIS IS ALSO THE GUARD ROADMAP 9 NEEDS.** `dialog.js` binds 1-9 to pick an
    option, so a global digit shortcut for flight plans must stand down here or
    naming a waypoint becomes a game of chance. It already does.
  - A COMMENT CAN TRIP A SOURCE-LEVEL GUARD: writing the words `confirm()` in a
    new comment failed the "no native dialogs remain" test. The guard greps the
    built app; prose counts. Reword rather than weaken the guard.
- **A DRAG NOW HAS EXITS OTHER THAN A MOUSEUP.** It used to have exactly one, so
  anything that swallowed the mouseup - alt-tab, a right-click (the native menu
  eats it), Escape, a window blur - left the map with `dragging` disabled, the
  via following a button-less cursor, and `|| lineDrag` blocking any new gesture
  until some later mouseup happened to arrive.
  - `blur`, `visibilitychange`, `contextmenu` and `pointercancel` all cancel;
    Escape reaches the drag BEFORE any modal handling, because the drag is the
    state that traps the map.
  - **ESCAPE TAKES THE VIA BACK OUT**, spliced by identity - which is why
    `beginLineDrag` now keeps the waypoint it was inserted on. Escape means
    "forget this", not "drop it wherever the cursor is".
  - EVERY exit goes through one `releaseLineDragListeners()`, so no path can
    leave a listener behind and keep the map half-captured. A test asserts the
    install list and the release list are the same set.
- **AN INDEX IS NOT AN IDENTITY ACROSS AN AWAIT** (discipline rule 7).
  `removeFlightPlan` captured `fIdx` before the dialog and spliced it after, so
  a list that changed meanwhile deleted the wrong plan; it now remembers the
  flight's `id` and finds it again. `applyBulkDefaultsToActive` re-reads
  `flights[activeFlightIndex]` after its await instead of using the reference it
  captured.
- **THE BEHAVIOURAL TEST HAD TO BE MADE DISCRIMINATING.** The first version
  passed with the guard disabled: there was nothing on the undo stack, so a
  leaked Ctrl+Z changed nothing either. It now renames a waypoint first, so an
  unguarded Ctrl+Z visibly reverts it - and with the guard removed, three tests
  fail. A guard nobody has seen fail is not known to guard anything.

## Every door into the live plan goes through the sanitiser (v16.44, item 12)

H4, H7, M1 and M2. The engine was hardened long ago; the shell was trusting, and
these are the four places that showed it.

- **M1: `sanitiseFlights` NOW COERCES, AND NO LONGER MUTATES ITS INPUT.** It used
  to check coordinate finiteness and pass everything else through untouched, so
  `lat: "69.3"` reached `toFixed` (a string has none - that is what took the
  daylight card down, and with it the banner), `name` could be an object that
  printed `[object Object]`, `laps` could be negative and `isPattern` a string.
  It also reassigned and deleted `via` on the CALLER's objects.
  - **ABSENT STAYS ABSENT.** `num()` returns NaN for null/undefined/'' rather
    than 0, so a missing OAT or wind is still NAMED by the banner. Coercing it to
    a number would be C2 in a new place. A TYPED 0 is a real value and survives.
  - The key list is EXPLICIT and an unknown key is dropped. Add a field there
    when the app gains one; the alternative is a future feature's half-written
    field riding into the live plan from an old file.
- **H4: A CORRUPT SAVED-ROUTE LIBRARY NO LONGER BRICKS THE BOOT.** The two
  getters ran `JSON.parse` with no try/catch and are called from
  `populateRouteDropdown()` at boot, BEFORE `refreshMap()` and
  `renderAllFlightTables()` - so a partial write threw out of the top-level
  script and left no map, no table and no way to recover from inside the app.
  `readStoredLibrary` degrades to `{}` and says so once. A broken library costs
  the SAVED ROUTES, never the plan in front of the pilot.
- **H7: A MALFORMED ROUTE IS REFUSED BEFORE ANYTHING IS TOUCHED.** The route
  branch assigned the stored value onto the live flight and only THEN walked it,
  so a bad entry threw with `flights[i].waypoints` already replaced. Every path -
  route load, `parsed.routes`, `parsed.missions`, `parsed.current`, a bare array
  - now goes through `sanitiseFlights` first, and a library entry that is not an
  array of waypoints is dropped with a count rather than stored.
  - The author ruled route files TRUSTED, which lowers this as a SECURITY matter.
    It does not lower it as a ROBUSTNESS one: the file that breaks a plan is
    usually one of your own, saved before a field existed.
- **M2: AN UNRECOGNISED FILE IS NOT AN IMPORT.** `{"hello":"world"}` matched no
  branch, changed nothing, and said "Import complete." The toast now names what
  actually landed ("Imported 2 routes, aircraft settings.") and refuses to claim
  success when nothing did.
- **NO HOUSE DEFAULT ELEVATION.** The four `|| 254` fallbacks were ENDU's field
  elevation standing in for "unknown" - an invented climb datum on every leg of
  a sea-level route. Gone; the departure elevation is set only from a finite
  published altitude, and a test greps for the number so it cannot return.

## Broken output is never presented as clean (v16.43, roadmap item 11)

Four audit findings, one class: the refuse-to-invent discipline bypassed at an
edge. Fixed together because they share an invariant - *a plan with missing or
invalid inputs must not produce clean-looking output on ANY surface.*

- **C1: A CIRCUIT STOP NOW BREAKS THE CHAIN FORWARD AS WELL AS BACKWARD.** It
  always broke the DESCENT chain, but the forward `alt` cursor survived the
  pattern pair, so the first real leg after a circuit was scheduled from the
  altitude BEFORE it. On `ENDU(254) -> A(2500) -> PATTERN -> B(6000) -> ENTC(31)`
  the last leg entered at 2500 while the column said B is crossed at 6000 - and
  the stale figure HID a 7.4-minute descent shortfall, i.e. an arrival that
  cannot be flown. One line (`alt = null`), and the next leg starts from its own
  `from.alt`, which is what the independent `computeLegTotals` path rendering the
  PATTERN->B row already assumed. The two agree again.
  - WHAT ALTITUDE A CIRCUIT RESUMES FROM (field elevation after a full stop,
    circuit altitude after a touch & go) is roadmap item 17 and is a SEPARATE
    question: the stale cursor is wrong under every answer to it.
  - **THE PIN SWEEP HAD NEVER GENERATED A PATTERN WAYPOINT**, which is why this
    survived every run of it. It does now (523 legs after a circuit per run), and
    reverting the one-line fix produces 114 violations plus the targeted test -
    checked, because a guard nobody has seen fail is not known to guard anything.
- **C2: AN EMPTY BOX IN THE WIND MATRIX IS NOT CALM WIND AND NOT 0 °C.**
  `Number(x) || 0` wrote a 0 into every blank field, so a waypoint whose wind or
  OAT was genuinely UNKNOWN got calm wind at 0 °C and the red banner went from
  naming the missing field to hidden - the v16.20 rule exactly inverted. A blank
  box now BLOCKS the save, is outlined red, and the toast names the waypoints.
  `Number()` still accepts a typed 0, which is a real value and a different thing.
- **H2: THE BANNER REACHES THE PAPER.** Two failures at once, both mine from
  v16.41. `pad3`/`String(Math.round())` printed the literal `NaN` into seven
  cells (TAS, TT, VAR, Dir/Vel, WCA, PL, GS); and `body > *` in the print rule
  hid the red banner along with the rest of the page, so the one output that goes
  on company paperwork was the one output the guard could not reach.
  - Every numeric cell now goes through a finite check and blanks - an empty box
    for the pilot's pen, exactly like the fields we deliberately never fill.
  - A broken plan prints an `INTEGRITY CHECK FAILED - DO NOT USE` band above
    EVERY sheet, naming the first problem and counting the rest. Solid black on
    white so it survives a mono printer. `verify-ofp-print.mjs` measures the
    painted box (1400x27 px, 4 bands for 4 sheets), not just the markup.
- **H1 (the half that shares those lines): THE SAFETY NET RUNS FIRST.** The order
  was card -> sheets -> check with nothing guarding it, so a throw in the
  daylight card skipped the banner AND left the PREVIOUS plan's sheets in the
  print host. Now the check runs first, its verdict is handed to the sheets, and
  the card is wrapped so it can only add a banner line, never remove one.
  `showIntegrityProblems` is split out so a failure discovered after the check
  still reaches the same banner.

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
