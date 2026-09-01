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
    20 000 pinned routes now pass with 0 violations, and the no-pin schedule is
    BIT-IDENTICAL to the derived v16.5 one (asserted on climb/descent minutes,
    fuel, TOC, TOD and the leg totals).
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
- **ACC SECTORS: THE RIGHT POLARIS FREQUENCY, BY POSITION (v16.33)**. Hovering
  Polaris CTA printed ALL 26 VHF Polaris frequencies, which tells a pilot
  nothing. The CTA is ONE airspace over the whole country, so its published
  block genuinely does list every sector. ENR 2.2 publishes each sector as its
  own airspace with its own lateral boundary, so the sector under the cursor is
  a LOOKUP. 28 of 30 imported (`sectors` in `data/aip.js`); they are NOT drawn -
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

9. **BOC/BOD map chips share the TOC/TOD colours** - a pinned BOC is the same
   green as the TOC, a BOD the same orange as the TOD. The chip text
   distinguishes them; a hollow tick for the pinned corners would read faster.
   (The plotting text already uses hollow glyphs: `▲ TOC / △ BOC`.)
10. **The leg panel's "Insert one where I right-clicked" discards unapplied
    pins** - it closes the panel to open the naming dialog.
11. **"Save & Recalculate"** is aircraft-centric wording for a button that now
    also saves the Map page.
12. **The fix-style preview background** is a beige gradient standing in for
    chart paper; it reads as a strip in light mode.
13. **`verify-visual.mjs` always reports 2 problems on a version bump** (the
    8x8 badge). It could accept a known badge region rather than needing the
    diff read by hand every time.

## Roadmap (the user's list, v16.28 - NOT yet agreed in detail)

Written down so it is not lost. NOTHING here is built, and none of it is
approved for implementation without asking first - several items need
verification work under the NO GUESSTIMATES rule before they can even be
scoped. In the user's order:

1. **DONE at v16.37** - right-click the track -> a leg settings panel, with
   BOC and BOD placeable. See "PINNED CLIMB AND DESCENT CORNERS" above.
   The insert-a-waypoint gesture moved INTO the panel rather than being
   replaced, so nothing was lost.
2. **An editable radius ring (default 1 NM) around the whole track**, for
   MSA planning - a corridor buffer drawn along the route.
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
7. More to come.

## Circuit altitude, and editing a waypoint from the map (v16.40)

- **A CIRCUIT ALTITUDE IS DERIVED, NOT INHERITED.** A PATTERN stop used to take
  whatever altitude the previous waypoint happened to be at, which is not a
  circuit altitude at all. `patternAltitude` (anchors.js) is the field elevation
  ROUNDED TO THE NEAREST 100 ft plus 1000 ft - rounding the elevation before
  adding, not the sum, because that is the arithmetic a pilot does in their head
  and it differs only on a half-hundred. ENTC's 31 ft gives 1000 ft.
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
- A flight longer than the form's 16 lines runs onto a second sheet, and the
  Total line is printed on the LAST one only - a running total printed half way
  through would read as the flight's total. One sheet per SECTOR, because the
  form has a DEP and a DEST.
- jsdom has no layout, so it cannot tell whether a value fits its cell - and
  "make sure the text is sized properly to fit into the cells" is the whole
  requirement. `tools/verify-ofp-print.mjs` drives Chromium with print media
  emulated over a deliberately worst-case plan (19 legs, the longest published
  reporting-point names, 45 kt winds, five-digit altitudes) and asserts
  `scrollWidth <= clientWidth` on EVERY filled cell - 413 of them, 0 overflowing
  - then renders a real PDF and counts the pages.
- NOT REPRODUCED: the school's UiT logo. Embedding someone's letterhead into
  generated output is their call, not ours; ask before adding it.

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
