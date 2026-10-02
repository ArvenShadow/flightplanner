# C182 Flight Planner — project memory

VFR flight planner for Cessna 182T NAV III (LN-TRA…LN-TRE), built for a flight
school in Tromsø; now the author's private tool. Developed iteratively with
Claude; this repo is the continuation point for Claude Code.

## The two non-negotiable rules

1. **GROUND PLANNING ONLY.** This tool is never used in the air. Reject or
   deprioritize any feature that only helps in flight (timers, own-ship,
   cockpit themes). Everything must serve pre-flight planning at a desk.
2. **NO GUESSTIMATES.** Every value, formula, API endpoint, and dataset is
   verified against an authoritative source (POH, the school's Excel OFP,
   official API docs) BEFORE implementation. If verification fails, the
   feature is not built — an honest "no" beats a plausible wrong answer.
   When data may be outdated or unofficial, say so in the UI and the guide.

## Data sources and credit (v17.5 - the author's decision)

The AIP data (airspace, aerodromes, reporting points, runways, ATS hours and
the VAC rasters) is Avinor's eAIP, **copyright Avinor AS**, and every
attribution line credits it: "© Avinor AS" / "AIP Norge". Kartverket (topo
tiles, the national border) is NLOD, MET Norway is NLOD 2.0, Open-Meteo is
CC BY; each keeps its own credit line.

**The v16.29 "permission, non-commercial only" wording was REMOVED at v17.5**
on the author's instruction: *"I am doing this on my own responsibility and it
is a private project for me only."* The project is private use, not
commercial. Do not re-add a permission or licence statement on the author's
behalf; credit the source, and leave the rest to them. Tests now require the
credit AND guard that the removed wording stays out.
→ §{The permission wording came out, and CLAUDE.md was split (v17.5)}

## How this file works (v17.5)

This file is the RULES and every decision still in force, one or two lines
each. The measurements, the bugs found on the way, the mutation runs and the
reasoning live in **`docs/HISTORY.md`**, moved there verbatim at v17.5.

- **Before changing a feature, read its history section.** Each entry below
  ends with `→ §{heading}`, the exact heading in `docs/HISTORY.md`. A test
  requires every pointer to name exactly one heading there, so a pointer
  cannot silently go stale.
- **This file wins on a conflict.** HISTORY.md keeps superseded entries for
  their reasoning; the entry that superseded them says so.
- **When shipping a change**, write its full entry in HISTORY.md and add or
  update the one-line summary and pointer here. Do not let this file grow the long form back.

## Editing discipline (this is how quality was maintained)

1. Make edits with unique-anchor string replacement (in Claude Code: the
   Edit tool with old_str asserted unique — same idea as the python
   `assert s.count(a)==1` scripts used previously).
2. After every edit: syntax-check the main script block
   (`node --check` on the extracted last <script>), then `npm test`.
3. Every feature ships with tests in `test.js` (jsdom + Leaflet stub).
   Over 700 pass at v17.6 (it said "140 at v16.2" until then - the L3 drift
   again, so no exact count is kept here). Never ship with failures. Add tests for new
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
the real compiler and are proved to have no hidden globals; the page script
(4 100 lines then, about 8 800 at v17.6) is the least tested surface, and EVERY high finding in `AUDIT.md` lives
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
- CHROMIUM VERIFIERS, and each exists for something jsdom cannot see:
  `verify:hosted` (the service worker and the real tile cache), `verify:ofp`
  (whether a value FITS its printed cell), `verify:fixes` (that a marker is
  visible and a click does not bubble), `verify:leg` (that a right-click reaches
  a 20 px invisible hit-line), `verify:hover` (that the card re-resolves across a
  sector seam), `verify:layout` (v16.49 - what a 1280x720 laptop can actually
  SEE without scrolling), `verify:skins`, `verify:visual`, `verify:locked` and
  `verify:vac` (v16.86 - that the chart raster lands where Leaflet projects it,
  and that every gesture still reaches THROUGH it). They need
  `npm install --no-save playwright`, or `CHROME_PATH` pointing at a browser
  already on the machine. THE COUNT IS DELIBERATELY NOT STATED HERE any more:
  it was "SIX" for four versions while there were nine, which is the L3 drift
  this file keeps having to correct.
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

## Architecture (deliberate, do not "modernize")

- **One delivery, `site/`** (index.html + app.js + aip.js + sw.js), built by
  `tools/build.mjs`, deployed to GitHub Pages locked (see below), served
  locally by `npm run serve`. The single-file `dist/` build is GONE (v16.45):
  this is the author's private tool now. The author: *"CLAUDE.md shouldn't
  always be taken literally to the extremes"* - it records decisions, it does
  not outrank the person whose project it is.
  → §{v16.45 (user decision, premise changed AGAIN): there is now ONE delivery, `site/`. The single-file `dist/C182_FlightPlanner.html` is GONE}
- **THE BUNDLE IS A CLASSIC IIFE, NOT A MODULE, AND THAT IS LOAD-BEARING.** The
  page script is a classic script whose inline `on*=` handlers need the
  bundle's functions as globals, and a `type="module"` script is DEFERRED -
  it would run too late. `src/main.js` puts every export on `window`. Do not
  "just add type=module". `data/*.js` are sidecars assigning a global.
- **Source layout**: `src/index.html` (page + the page script), `src/lib/*.js`
  (pure modules, JSDoc-typed, checked by the real `tsc` with `strict`),
  `src/styles.css` and `src/skins.css` (inlined into ONE `<style>` - a test
  asserts one), `src/sw.js`, `src/unlock.html`. The page script opens with a
  WHERE TO EDIT WHAT index; a test requires it to name every module in
  `src/lib/`. → §{The single-file artifact and the v16.8 build, Phase 1 extraction}
- **Phase 1 closed at v16.19 on purpose.** The remaining page script is NOT
  being force-modularised: it is one web of 58 shared mutable globals plus
  the inline handlers, and threading that through module boundaries would
  make a UI edit span more files. (A test re-counts that number.)
- **HIDDEN GLOBALS ARE THE TRAP when extracting.** A module takes what it needs
  as an argument or an explicit injector (`setAircraftProfile`, `setNavPath`),
  never off the ambient scope. `require()` does not run function bodies, so
  the standalone-run guard in test.js CALLS an export of every module in bare
  Node. Add every new module to it. App state goes in as an ARGUMENT.
- **Phase 2 (v16.20): types in JSDoc, not `.ts`**, so bare-Node `require()`
  still tests the source. `src/types.d.ts` holds the domain. 0 `tsc` errors
  is the standard. Tracks and headings are three digits. A missing variation
  gives `---`, never MT === TT. → §{Phase 2: types (v16.20)}
- **The service worker** precaches the shell (all three assets incl.
  `aip.js`) and the print assets; tile caches are keyed and retired by the
  live AIRAC edition; weather is never cached; it only runs on https or
  localhost. → §{v16.14 (superseded at v16.45 - the single-file half is gone; kept for the history of why `site/` exists at all): the planner is now HOSTED as well}
- **The deployed copy is ENCRYPTED** (`npm run lock` -> `site-locked/`,
  AES-256-GCM, PBKDF2 2M; passphrase in `SITE_PASSWORD` / gitignored
  `.site-password`, NEVER committed; no hash stored; the derived key is
  remembered per browser; no fallback to publishing plaintext). The REPO is
  public, so this gates the URL only. Needs https or localhost.
  → §{THE DEPLOYED COPY IS ENCRYPTED, AND THE SOURCE IS NOT (v16.78)}
  Payload names are content-addressed so a cached gate can never pair with
  another build's ciphertext; a stale gate heals itself once per session.
  → §{A CACHED GATE LOCKED THE PILOT OUT OF THEIR OWN SITE (v16.88)}
  `readPassphrase` refuses a phrase that is mostly an obvious word, and is
  explicitly not an entropy estimator. → §{THE PASSPHRASE RULE WAS DRAWN TOO WIDE, AND THE FIRST REAL DEPLOY FOUND IT (v16.79)}
- A dev-server architecture was evaluated and REJECTED.
- **User data** lives in localStorage plus JSON export/import. `PROFILE_KEYS`
  (exchange.js) is the ONE whitelist for both directions and for boot; never
  widen it to anything that identifies a PERSON or a PLACE. A registration
  may be stored (the author cleared it); crew names, licence numbers and
  seat weights may not travel in a route file - the M&B inputs live under
  `c182_mb_prefs`, outside PROFILE_KEYS.
  → §{User data and PROFILE_KEYS (v16.18; the registration rule relaxed at v16.93-v16.95)}

## Domain decisions already settled (do not relitigate silently)

### Engine, navigation and data

- **Geodesy**: exact WGS-84 geodesics via GeographicLib in
  `src/lib/geodesy.js`. The old spherical model under-planned fuel. A degree
  of latitude is 60.2 NM at 60N, deliberately. → §{Geodesy (v16.9, superseded the spherical model)}
- **Great circle or rhumb line is a setting** (default great circle); it
  governs the drawn line, corridor, distance and track together - never a
  line in one model with a track from the other. `rhumb.js` is ellipsoidal.
  Every drawn line goes through one densifier (`densifyPath`).
  → §{Great circle or rhumb line - the pilot chooses (v16.63)}
- **MagVar**: the real WMM2025 (`src/lib/magvar.js`); a test FAILS when WMM2025
  expires in 2030. Saved routes re-resolve variation on load; a typed VAR is
  `MANUAL` and never overwritten. → §{MagVar (v16.9, the real WMM)} and →
  §{Saved-route freshness (v16.10)}
- **Winds aloft**: Open-Meteo pressure levels, u/v averaging, 3 samples a
  leg. MET Nordic has no pressure levels. **Never assume calm wind**: a
  missing wind or OAT is NaN and named on the banner.
  → §{Winds aloft}
- **Flight Defaults hold no departure elevation and no wind** (v17.6, the
  author): the elevation comes from the departure aerodrome (editable in the
  plan header), a new waypoint starts at `NEW_WP_WIND` 000/00 for the fetch to
  replace, and Apply Bulk never writes a wind.
  → §{FLIGHT DEFAULTS HOLD NO DEPARTURE ELEVATION AND NO WIND (v17.6)}
- **Flight altitude schedule**: legs are NOT independent. Forward pass
  (climb spillover), backward pass (TOD backs up so fixes are crossed at
  their planned altitude). A circuit stop breaks the chain BOTH ways.
  → §{Flight altitude schedule (v16.5, user decision)}
- **ONE TARGET PER LEG** (`altAtNM`): where this leg's altitude is attained.
  BOC/TOC/TOD/BOD are DERIVED; all four marks write the one field; a
  manoeuvre is never stretched. Legacy `bocNM`/`bodNM`/`tocNM` are read,
  never written. → §{ONE TARGET PER LEG, AND THE CORNERS ARE DERIVED (v16.76)}
  The pin engine's full history: → §{PINNED CLIMB AND DESCENT CORNERS (v16.37, roadmap item 1)}
- **THE ALTITUDE COLUMN IS THE PILOT'S.** Nothing - a drag, a pin, a target -
  changes an altitude the pilot typed. An unreachable target is REPORTED with
  the required rate; the climb stays the POH's. (Reverses v16.74's
  carry-back.) → §{THE ALTITUDE COLUMN IS THE PILOT'S, AND NOTHING REWRITES IT (v16.77)}
- **A drag never commits a plan the app calls unusable**; it fits, stops at a
  POH LIMIT (a TOC earlier than the climb allows), or NOTHING MOVES - a refused
  drop no longer snaps to the natural corner (v17.9 supersedes v16.75's
  fallback). One decision (`profileDropDecision`) drives the live preview and
  the drop; a climb/descent crossing gives the ceiling and the rate
  (`descentConflict`); a descent may have its own rate (`rodFpm`, profile's by
  default, rate only). → §{THE CORNERS FOLLOW THE DRAG, AND A DROP THAT CANNOT BE FLOWN CHANGES NOTHING (v17.9)}
  → §{A DRAG NEVER COMMITS A PLAN THE APP CALLS UNUSABLE (v16.75)}
- **Dragging the marks**: a top is a tick, a bottom is a ring; marks forward
  a right-click to the leg panel and bubble a left click to the map.
  "Set altitude from here" skips the destination (the last NON-circuit fix)
  and circuit and stop fixes. → §{A TOUCH & GO WITH CIRCUITS KEEPS ITS LANDING ALTITUDE (v17.9)}
  → §{Dragging the corners, and setting an altitude for a phase (v16.73)}
  The waypoint dialog edits name and altitude together; Enter commits.
  → §{The waypoint box, and a TOC dragged past what the aircraft can climb (v16.74)}
- **Via-leg rows** show the DIRECT waypoint-to-waypoint TT/MT/MH; the flown
  per-segment tracks are in the sub-line. → §{Via-leg row semantics (v16.4, user decision)}
- **TOC/TOD marks**: kept when a descent fills a whole leg (`atWaypoint`),
  drawn above waypoint markers, halo is a box-shadow. → §{TOC / TOD marks (v16.28, bug fix + the user's preference)}
- **Route editing gestures**: press-drag-release bends a leg; a 20 px
  invisible hit line carries every gesture; live redraws use
  `flightLineCoords`. Splitting a leg with vias uses `via.slice`.
  → §{Route editing gestures (v16.27, QoL)}
- **A circuit is time and fuel, never a place** (reverses v16.83): a PATTERN
  waypoint sits on the fix it follows (`applyPatternPositions`, enforced
  where positions are READ); a leading circuit keeps its own position.
  → §{A CIRCUIT IS TIME AND FUEL, NEVER A PLACE (v16.84) - THIS REVERSES v16.83}
  Why v16.83 was tried and what survived of it: → §{A PATTERN IS A PLACE, AND THE FLIGHT OUT TO IT IS REAL (v16.83 - REVERSED at v16.84, see above)}
- **Circuit altitude** is field elevation rounded + 1000 ft, or a told value
  (`KNOWN_PATTERN_ALT_FT`, ENDU 1500) within 5 NM; editable.
  "PATTERN" is a reserved name in both directions.
  → §{Circuit altitude, and editing a waypoint from the map (v16.40)}
- **At an aerodrome**: first waypoint asks Departure / Fly-by; later ones
  Touch & go / Full stop / Fly-by. Ground time (5/10 min, editable) belongs
  to the sector it delays; taxi fuel per departure; a full stop may refuel
  (stored in gallons); the next sector departs from the published field
  elevation and opens directly after the stop's plan. A fly-by is named from
  the published ATS callsign. → §{What happens at an aerodrome (v16.54-v16.59, roadmap item 17)}
  and → §{THE GROUND TIME BELONGS TO THE SECTOR IT DELAYS (v16.84)}
- **Deleting a stop deletes the sector it opened** (found by position, not a
  stored link): an empty one silently, a planned one after asking; one undo
  step. → §{DELETING A STOP DELETES THE SECTOR IT OPENED (v17.4)}
- **Daylight / VFR day**: SERA civil twilight (sun -6°); every takeoff and
  landing checked at its own aerodrome on its own date; Flight Date is never
  persisted. → §{Daylight / VFR day (v16.3)}
- **Times are LOCAL**, clearly labelled; ETO is an instant, so DST is right.
  → §{Housekeeping, one batch (v16.48, item 15 - M3, M4, M5 and L1-L10)}
- **Terrain**: the author DECLINED elevation features; chart contours + MEF
  are the reference. The corridor ring (radius, colour, transparency are
  settings) draws GEOMETRY only and computes no MSA. → §{Terrain/elevation} and
  → §{The corridor ring (v16.61-v16.62, roadmap item 2)}
- **The ruler** previews to the cursor with the commit's own arithmetic;
  Escape backs out one level, the undo chord removes the last point and
  never falls through to the plan. → §{THE RULER PREVIEWS, AND MEASURING IT FOUND THE RULER DRAWING THE WRONG LINE (v16.91)}
  and → §{ESCAPE AND UNDO BELONG TO THE RULER WHILE IT IS RUNNING (v16.92)}

### AIP data (Avinor eAIP, imported at build time)

- **The importer reads the eAIP's tagged database fields, never prose.**
  Edition discovered by redirect, never hardcoded. Three structural traps
  (self-closing spans, nested sdParams, untagged type text).
  → §{AIP airspace (v16.29, roadmap item 4 — the DATA half is built)}
- **Avinor republishes the eAIP only when an AMDT changes it** (the author,
  v17.6, restating what the v16.29 entry found): editions fall on AIRAC dates
  but NOT every 28 days, so no new edition on an AIRAC date is normal, not
  stale. Never suggest a re-import just because a cycle date passed; check
  whether Avinor published one. → §{AIP airspace (v16.29, roadmap item 4 — the DATA half is built)}
- **A re-import is a multiset diff**; the ACC sector count is pinned per
  edition; a frequency without a unit is prose and dropped.
  → §{AIRAC updates: what re-importing actually costs (v16.42, 2026-09-03)}
- **Border**: Kartverket's land border, one chain, 2 NM snap tolerance
  (measured); the Skagerrak maritime line, foreign borders and implausible
  paths are REFUSED. Both border forms (typed field and vertex remark) are
  read, and `resolved + refused + notDrawn == published` gates the build.
  → §{National-border resolution (v16.30)} and → §{A BORDER REFERENCE IS PUBLISHED TWO WAYS, AND ONE OF THEM WAS BEING DROPPED (v16.36 bug fix, user-spotted)}
- **Each stepped band has its own ring**; 0 self-intersections asserted.
  → §{STEPPED AIRSPACE: EACH BAND HAS ITS OWN RING (v16.30 bug fix)}
- **ATS delegation areas are not airspace** (`TORG_AUTH`), kept in the report.
  → §{ATS DELEGATION AREAS ARE NOT AIRSPACE (v16.36, user-spotted)}
- **Airspace overlay**: own pane at z 380 below the route line; HOVER, not
  click; culled below z7; card shows ATIS/APP/TWR/AFIS (ACC as fallback),
  civil VHF only. → §{Airspace OVERLAY (v16.31, roadmap item 4 COMPLETE)}
  A card row is a POSITION, not a service code; standby frequencies hidden.
  → §{A ROW IS A POSITION, NOT A SERVICE CODE (v16.60, the pilot's question: "why does ENGM have so many approach frequencies?")}
  The ACC sector is a point-in-polygon LOOKUP that may only select a
  frequency the airspace itself publishes. → §{ACC SECTORS: THE RIGHT POLARIS FREQUENCY, BY POSITION (v16.33)}
  openAIP was removed for lagging the chart and stays out.
  → §{Airspace overlay}
- **Fixes**: 53 aerodromes, 243 reporting points from the VAC coordinate
  TABLE (column + font, never proximity); click adds with no dialog except
  at an aerodrome; search folds Æ Ø Å. Never read a coordinate off a chart
  image. → §{AIP FIXES: AERODROMES AND REPORTING POINTS (v16.34, roadmap item 3 — BUILT)}
  Fix symbol style is a validated setting (colour is an injection vector).
  → §{MAP SETTINGS, AND THE FIX SYMBOL AS A PREFERENCE (v16.35, user request)}
- **The VAC raster is DISPLAYED, never read**: conformal complex-polynomial
  fit, bounding-box-centre anchor, fail-closed gates checked again at
  runtime, lossless 600 dpi, pane z 360, `interactive: false`. Amended charts
  are marked superseded by the AD 2.24 graphic id.
  → §{THE VAC IS DRAWN ON THE MAP, AND A SHEET THAT CANNOT BE PLACED IS NOT DRAWN (v16.86)}
  Floor zoom 8, at most 6 sheets, partial overlay says so; opacity slider
  under the button, one write point. → §{THE FLOOR IS THE SHEET COUNT, NOT THE ZOOM (v16.87)}
- **ATS opening hours** from Avinor's Operational Hours table, read strictly,
  refused when not decodable; only a decoded CLOSED take-off/landing is a
  banner finding; the day is the UTC day. **NOTAMs are REFUSED** (ippc.no:
  session DWR, no CORS). → §{ATS OPENING HOURS BUILT, NOTAMs REFUSED (v17.0, roadmap item 20)}
  A LANDING open at its ETA but closed within ±30 min of it gets an amber
  card line and header chip, never the banner (`atsMarginAt`).
  → §{A LANDING WITHIN 30 MIN OF ATS CLOSING GETS AN AMBER LABEL (v17.8)}
- **A fly-by is not a movement** (`flyby: true` or a reporting point); a CTR
  outside ATS hours is class G RMZ (ENR 1.4). → §{A FLY-BY IS NOT A MOVEMENT, AND A CLOSED CTR IS CLASS G RMZ (v17.1)}

### Charts and weather

- **Base charts**: Kartverket topo (offline-capable base) and Avinor's
  official ICAO 1:500 000 via the ArcGIS export at `imageSR=3857`. Do not
  swap to the LCC tile cache without re-checking alignment.
  → §{Base chart switch (v16.7, verified Aug 2026)}
- **Chart resolution** matches the source's 31.75 m/px; png24, never png8 or
  jpg; `dpi` is a no-op. → §{VFR chart resolution (v16.12, measured against the service)}
  The `chartDetail` cap exists because DECODE, not network, is the cost.
  → §{Chart detail setting (v16.23)}
- **Offline chart download: REMOVED, do not rebuild** without a CORS tile
  source (opaque responses are quota-padded and the browser evicts the
  origin). → §{Offline chart download: BUILT v16.22-v16.25, REMOVED v16.26. Do not rebuild it}
- **Map controls stack themselves** (`#map-controls`, `.map-ctl`); a hidden
  control is listed, never silently excused. → §{Map controls stack themselves (v16.24)}
- **Map**: one world copy. → §{Map}
- **METAR & TAF** from MET Norway: raw shown in full, only time/wind/temp/QNH
  decoded, never cached, one request per kind. → §{METAR & TAF (v16.21)}
  Fetch re-renders the plan; outdated = past the report's own routine
  interval (METAR 30 min; TAF by its length). → §{THE WEATHER FEEDS THE DISTANCES, AND SAYS WHEN IT IS OLD (v16.99)}
  Before the first fetch the M&B weather card IS a large centred Fetch button.
  → §{THE WEATHER CARD IS ITS FETCH BUTTON UNTIL IT HAS WEATHER (v17.6)}

### The OFP, Mass & Balance and performance

- **The printout is the school's own PDF** (`C182OFPMBv4.2.pdf`, US Letter
  landscape) embedded with pdf-lib and filled at measured coordinates;
  0 differing pixels on a blank sheet; figures shrink, never clip; one sector
  per sheet; a DO NOT USE band reaches the paper; Print opens a PDF tab.
  → §{THE PRINTOUT IS THE SCHOOL'S FORM, AND THE TAB LOOKS LIKE ITS PAGE 2 (v16.97)}
  The blank-on-purpose decisions (MSA, actuals, Freq, crew) and the
  sector-per-sheet rule: → §{The company OFP form as the print output (v16.41, roadmap item 6 - the OFP half)}
- **The paper rounds, the plan does not** (`paperRoundSectors`): leg fuel and
  leg distance to the NEAREST whole, up or down (v17.10 reverses v17.9's
  round-up: "why is it rounding 1.1gal up to 2?"); fuel floor 1, distance floor
  0.5; ACC, Total and EST remaining follow the printed figures - the author:
  "The paper should only use the rounded values".
  → §{THE PAPER ROUNDS TO THE NEAREST, BOTH WAYS (v17.10) - THIS REVERSES v17.9's ROUND-UP}
  → §{THE PRINTED OFP ROUNDS FOR COPYING, AND NEVER DOWN (v17.9)}
- **ACC columns count the flight; the Total line counts the sector.**
  → §{THE ACC COLUMNS COUNT THE MISSION; THE TOTAL LINE COUNTS THE SECTOR (v16.85)}
- **Mass & Balance**: the workbook and the form agree on every constant; the
  envelope is convex so the two ends prove the path; Va from the POH table
  (null below 2100 lb); no baggage limit is invented; MLW at every landing;
  a master WALKS. → §{MASS & BALANCE, THE OTHER HALF OF THE FORM (v16.93, roadmap item 5 - PHASE A)}
  Standard baggage (7.3 A / 0.7 C / LN-TRE 22.7 B) is a default LOAD.
  → §{THE STANDARD BAGGAGE IS A LOAD, NOT PART OF THE EMPTY MASS}
- **One fuel density** (`FUEL_LB_PER_GAL = 6.0`, `toGallons` is the one
  inverse); exact gallons leave the render on `ofpPrintModel[i].fuelGal`.
  → §{PHASE B (v16.94): THE EXACT GALLONS, AND ONE FUEL DENSITY}
- **The M&B tab** reads the plan's fuel, raises findings through the same
  banner only once a tail is chosen, and the whole-flight view changes what
  is shown, never what is checked. → §{PHASE C (v16.95): THE TAB, THE CHART, AND THE PAPER}
- **Take-off/landing distance**: runways and declared distances imported
  from AD 2.12/2.13 by table header; the school's method cell for cell, with
  five stated departures (TRUE runway direction, TODA, VRB is a tailwind,
  above the table refused, rounds up). → §{PHASE D (v16.96): RUNWAYS FROM THE AIP, AND THE DISTANCE AGAINST THEM}
  POH tables are PA 0-8000 (the workbook stops at 5000); three deleted cells
  stay refused; landing is at MLW only.
  Each check is DRAWN (`rwydiagram.js`): the strip is the declared TODA/LDA,
  distances to scale along it, markings per CS ADR-DSN L.525/530/535 (stripes
  by width; a width not in the table gets none; unpaved gets no paint).
  → §{THE DISTANCES ARE DRAWN ON A RUNWAY (v17.6)} → §{THE PERFORMANCE TABLES: THE WORKBOOK IS SHORT OF THE POH, NOT THE OTHER WAY ROUND}
  The wind box is sized from its last line, even padding. → §{THE WIND BOX HAS ROOM BELOW ITS LAST LINE (v17.7)}
- **Page 2 corrections**: endurance and reserve at 12 gal/h; take-off always
  full length, stationary, even after a touch & go; the METAR TEMPO wind
  wins; the LMC line is the actual fuel at preflight, applied until a refuel.
  → §{FOUR CORRECTIONS TO PAGE 2, FROM THE PERSON WHO FLIES IT (v16.98)}
- **"The whole flight"** is the visible word (storage keys unchanged); Save
  leads with it. → §{"THE WHOLE FLIGHT", AND IT IS WHAT SAVE DOES FIRST (v16.100)}

### Safety net, input and the shell

- **Broken output is never presented as clean**: no NaN printed, an empty
  wind box is not calm, the banner reaches the paper, the check runs first.
  → §{Broken output is never presented as clean (v16.43, roadmap item 11)}
- **Every door into the live plan goes through `sanitiseFlights`**; absent
  stays absent; a corrupt library never bricks the boot; no house-default
  elevation. → §{Every door into the live plan goes through the sanitiser (v16.44, item 12)}
- **Import asks before it overwrites**: scope choice, side-by-side collision
  preview (Keep mine is primary), decide-then-apply. An empty pref in a file
  does not blank one on screen. → §{IMPORT ASKS BEFORE IT OVERWRITES ANYTHING (v16.81)}
- **One escaper** (`escapeText`, aliased `esc`) at every `innerHTML` sink.
  → §{One escaper, applied everywhere (v16.47, item 14 - H3 and the rest of H1)}
- **An overlay owns the keyboard**; a drag has exits other than mouseup.
  → §{An overlay owns the keyboard, and a drag has an exit (v16.46, item 13)}
- **Dialogs**: `dialog.js`, no native dialogs, async call sites.
  → §{Dialogs (v16.11)}
- **Keyboard**: `keys.js` resolves keys purely; every action is bindable in
  Settings -> Keyboard; browser-owned chords and duplicates refused; Escape
  fixed; bare keys belong to the field being typed in. Keybinds travel in
  the export. → §{The keyboard belongs to the pilot (v16.52, roadmap item 10)}
  and → §{TYPING IS NOT A SHORTCUT, AND THE COLUMN IS WHAT HOLDS THE NUMBER (v16.69)}
- **QoL batch**: Edit mode has a selection; undo covers plan fields and
  names its step; short-window layout; search hits give true bearing.
  → §{Quality of life, one batch (v16.49, item 16 - AUDIT.md section 4)}
- **Every undo/redo, keyboard included, shows `#undo-notice`** naming the
  step (one box, rewritten). → §{EVERY UNDO AND REDO SAYS WHICH STEP IT TOOK (v17.6)}
  A selection is put down by a second click, Escape, the ✕ Deselect map
  control, or a View-Mode map click. → §{A SELECTION CAN BE PUT DOWN (v17.6)}
- **Track and map-only view**: no dashed track; track weight is a setting;
  New plan and active-plan controls on the map; 1-9 and , . pick plans.
  → §{The track, and reaching a plan from the map (v16.50-v16.51, roadmap 7 - 9)}
- **Panel divider**: stores the map's FRACTION per layout, a flex BASIS,
  document-level tracking so a fast drag cannot lose the grip; one-panel
  layouts fill the window. → §{The panel divider (v16.67)} and
  → §{THE DRAG IS ANCHORED TO THE MOUSE, NOT TO THE THING UNDER IT (v16.89)}
  and → §{A FIXED BASIS DOES NOT FILL A WINDOW THE WAY A GROW FACTOR DID (v16.72)}
- **Sliders** keep dragging off the track (learned scale).
  → §{THE CONTROL STOPS AT ITS OWN EDGE, SO THE APP CARRIES THE DRAG (v16.90)}
- **Number cells**: no spin buttons; floors are `calc(<n>ch + 16px)` and are
  checked in every style and size. → §{THE FLOOR IS TEXT PLUS CHROME, AND THE CHROME IS NOT A CONSTANT (v16.71)}
- **Skins and sizes**: `body.skin-*` (Default, Menu, Slate, Chart, Float) and
  `body.density-*` (Normal, Compact, Bold), CSS only, default skin has NO
  CSS; shape rules before the styles, size rules after. Tier 3 (column order)
  not attempted. → §{SKINS, and the plan for restyling the whole shell (v16.65)}
  and → §{SIZE IS ITS OWN SETTING: BOLD AND COMPACT GO WITH ANY STYLE (v17.3)}
- **Colours are tokens** on `:root` per theme; the printed form stays literal
  black. The build lints CSS for undefined `var()`s. → §{Restyling has to be cheap before it can be safe (v16.64)}
- **The SERA VMC-minima modal is gone**; the daylight card stays.
  → §{THE SERA VMC-MINIMA MODAL IS GONE (the author: "it doesnt add anything other than extra space")}

### Not planned (verified dead ends)

NOTAM (ippc.no: no CORS), georeferenced 1:500 000 ICAO chart tiles
(licensing), traffic (needs receivers), aviationweather.gov (no CORS),
terrain elevation (declined), openAIP (lags the chart), offline chart
download (quota eviction). → §{Not planned}

## Open items

### Deferred nits (observed, not urgent) → §{DEFERRED: known nits and small bugs (v16.39)}

1. A spilled descent reports planned, not flown, entry/exit altitudes.
2. Splitting a pinned leg leaves the pin on the second half.
3. A pin is clamped on read, not on edit, silently.
4. A target on a leg with no climb/descent is silently ignored.
5. The Skagerrak maritime boundary (Polaris CTA x2, Farris TMA, Bohus C,
   Koster, ACC Sectors 3-4) - needs a maritime dataset.
6. Halti cites the Finland-Sweden border.
7. 18 offshore HTZ/ADS are published as a circle radius.
8. 29 of 53 aerodromes publish reporting points graphically only;
   8a. a plan opening with circuits is judged/printed at the next fix.
10. The leg panel's insert action discards unapplied pins.
11. "Save & Recalculate" wording.
12. The fix-style preview background.
13. `verify-visual` reports the version badge on every bump.
14. The Menu skin reveals the empty `#slot-sidebar-top` on hover.

### Roadmap still open → §{Roadmap (the user's list, v16.28, extended v16.41 - NOT yet agreed in detail)}

- 18. Put the page script under the compiler (`src/page.js`). PLANNED and
  measured at v17.6 (strict: 1 210 errors, loose: 260), four stages, nothing
  moved yet; stage 2's DOM idiom is the author's call.
  → §{THE PLAN, MEASURED (v17.6) - staged, nothing built yet}
- 19. Split `test.js` for navigability (closes no quality gap). → §{19. SPLIT `test.js` (5 451 lines, 352 tests, 75 sections)}
- 21. Modern looks: three offered (Slate, Chart, Float); choosing is the
  author's call; Tier 3 not attempted. → §{THREE MODERN LOOKS (v17.2, roadmap item 21)}
- OPTIONAL: the ±30 min ATS amber label for TAKE-OFFS too (v17.8 does
  landings only; the author: "no need ... yet, but it could be saved as an
  optional item later"). The 3 000 fpm descent cap is settled.
  → §{SETTLED AFTER v17.9: THE 3 000 FPM CAP STANDS, AND TAKE-OFFS ARE PARKED}
- AD 1.1's PPR rule (non-commercial VFR outside hours) - whether the closed
  finding should mention it is the author's call. → §{AN OPEN QUESTION FOR THE AUTHOR, FOUND ON THE WAY AND NOT ACTED ON}

### Settled by the author - do not relitigate → §{Settled by the author in AUDIT.md - do not relitigate}

Times are LOCAL; route files are TRUSTED; no hardcoded odd values; taxi
fuel belongs to a departure; a dialog disables every keybinding but Escape
and its own. `AUDIT.md` holds the v16.41 audit with the author's answers.

## Safety posture

A red integrity banner (`runIntegrityCheck`) validates all rendered
numbers each recalc (NaN/coords/altitudes/wind vs TAS/GS bounds/fuel).
The help guide opens on first run and leads with a PIC-responsibility
notice. Keep both intact. A 3-page company justification document exists
(Methodology_and_Safety_Notes.pdf, reportlab). When features are removed
for data-quality reasons, that reasoning belongs in the guide and is
worth a line in that document.
