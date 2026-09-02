# C182 Flight Planner - deep audit (v16.41.0, read-only pass)

Audit of `main` at 6df8b67 on 2026-09-02. Nothing was edited; every "confirmed"
finding was reproduced by running the code (scripts lived in a scratchpad, not the
repo). Nothing on CLAUDE.md's DEFERRED list is re-reported, and nothing here proposes
reversing a settled decision. Severity key: **critical** = a wrong number a pilot could
copy onto the OFP or a wrong legal time; **high** = data loss, stuck UI, silent failure;
**medium/low** = everything else; **qol** = quality of life.

Confidence: **[run]** = confirmed by executing it; **[read]** = read-only reasoning.

---

## 0. Pre-existing state (Phase 0 baseline)

| Check | Result |
|---|---|
| `npm install` (Node 22.22.2, npm 10.9.7) | ok. **Side effect:** rewrites `package-lock.json` (committed lock says `"version": "16.33.0"`, package.json is 16.41.0) - the tree is dirty after every install. See L2. |
| `npm run typecheck` (`tsc --noEmit`) | 0 errors |
| `npm test` (typecheck + build + jsdom suite) | `RESULT: ALL CHECKS PASSED` - 377 PASS lines, 0 FAIL. Rebuilt `dist/` is byte-identical to the committed one. |
| Test-run noise | Two `Error: Not implemented: navigation (except hash changes)` stack traces from jsdom (an `<a>` click in the version badge / export path). Not failures, but they read like one. |
| Playwright | The `playwright` npm package is not a dependency; installed with `npm install --no-save playwright` (1.62.1). Chromium binary present at `/opt/pw-browsers/chromium`. |
| `verify-hosted.mjs` | **passes** (needs `node tools/serve.mjs` running on 8182 first - the header says so) |
| `verify-airspace-hover.mjs` | passes (19 checks) |
| `verify-fixes.mjs` | passes (48 checks) |
| `verify-leg-panel.mjs` | passes (37 checks) |
| `verify-ofp-print.mjs` | passes (25 checks) |
| `verify-visual.mjs` | passes against the previous commit's `dist/` (pixels and computed styles identical, both themes) |

Nothing is failing before this audit. Note the user's brief said "four" verify scripts;
there are six.

---

## 1. Architecture map (scaffolding, not findings)

**Deliveries.** `tools/build.mjs` reads `src/index.html`, inlines `src/styles.css` at
`@STYLES` (line 12), `data/aip.js` at `@AIPDATA` (800) and the esbuild IIFE of
`src/main.js` at `@BUNDLE` (801), and writes `dist/C182_FlightPlanner.html` (file://,
no worker) plus `site/{index.html,app.js,sw.js,.nojekyll}` (Pages / LAN, worker
registered only on a secure context). Build **fails** on: missing markers, unparsable
bundle/page/worker (`node --check`), duplicate `id="..."` anywhere in the HTML,
APP_VERSION vs package.json (major.minor only), a literal `</script` in bundle or data,
missing `sw.__APP_VERSION__ || 'dev'` token. It only **warns** when `data/aip.js` is
missing. `dist/` is written BEFORE the site-side checks run (build.mjs:174 vs 179-201).
"Exactly one `<style>` block" is a test (test.js:5077), not a build check.

**Page script** (`src/index.html` 802-4915, classic script). 32 top-level `let`
bindings (CLAUDE.md says 24), the load-bearing ones: `flights`, `activeFlightIndex`,
`markers/profileMarkers/polylines/hitLines` (rebuilt by `refreshMap`), `undoStack/
redoStack` (push in `pushUndoState`, pop in `undoLast/redoLast`), `lineDrag/
lineDragEndedAt` (the press-drag-release state machine), `legPanel`, `legStartTimes`,
`ofpPrintModel` (captured during `renderAllFlightTables`), `aircraftProfile` (injected
into performance.js by reference), `airspaceLayers`, `fixLayers`, `loadedRouteRef`.
76 inline `on*=` handlers in static HTML plus 25 emitted from templates (CLAUDE.md says
61); all 59 referenced function names resolve.

**Mutators of `flights`:** `undoLast`, `redoLast`, `clearAllFlights`,
`loadSelectedRouteOrMission`, `importMissionFile`, boot (4901) rebind it; `addNewFlightPlan`,
`removeFlightPlan`, the map click handler, `insertWaypointOnLeg`, `addAnchorWaypoint`,
`deleteWaypointFromFlight`, `renameWaypoint`, `saveLegSettings`, `saveWindModal`,
`applyBulkDefaultsToActive`, marker/via drags and five inline row handlers mutate it.
Every one of those pushes undo except `endLineDrag` (covered by the push at via
creation) and the planning-prefs inputs (ETD/fuel), which are not undoable.

**Render pipeline.** `renderAllFlightTables()` -> per flight `computeFlightSchedule` ->
`computeLegTotals(from,to,sched[i])` per leg -> rows + `printRows` -> then, in order,
`updateDaylightCard` (3941), `renderOfpPrintSheets` (3942), `runIntegrityCheck` (3943).

**Data flow.** `data/aip.js` assigns `window.C182_AIP` -> page reads it once (2872) ->
`buildAnchors()` (anchors.js) and `visibleAirspaces()/airspaceInfo()` (airspace.js) ->
`drawAirspace()` polygons in a pane at z 380 with sticky tooltips (hover, no click) and
`drawFixes()` divIcon markers (click adds a waypoint). Redrawn on moveend/zoomend.

**localStorage** (no schema version anywhere): `c182_perf_profile` (whole profile,
`Object.assign`ed back with NO whitelist), `c182_active_mission` (Flight[], sanitised on
boot), `c182_custom_routes` ({name: Waypoint[]}, **parsed without try/catch**),
`c182_custom_missions` ({name: Flight[]}, same), `c182_planning_prefs` ({fuel, reserve,
etd} strings), `c182_layout`, `c182_compact`, `c182_guide_shown`; `c182_openaip_key` and
`c182_airspace_on` are purged.

**Service worker protocol.** One message, page -> worker: `{type:'chart-edition',
edition}` posted from the JSONP callback `window.__icaoEdition` (1345-1362) once per page
load, only if `navigator.serviceWorker.controller` exists. Worker never replies. Worker:
`knownEdition` module state; `fetch` intercepts only `avigis.avinor.no/**/export` (cache
`c182-tiles-<edition>`, TILE_LIMIT 400) when the edition is known, and same-origin GETs
(network-first shell cache `c182-shell-v<ver>`). Weather hosts are never touched.
`install` calls `skipWaiting()` on success AND failure; `activate` deletes old shells and
`clients.claim()`s.

**Schedule engine** (`legs.js:649-962`). Forward pass keeps a running `alt` cursor;
pattern pairs and zero-length legs leave `legs[i] = null`. Pins live on the TO waypoint
(`bocNM`, `bodNM`, `tocNM`) and are read only inside the climb gate (`target > alt+1`,
line 708) except `bodPinNM`. Backward pass places descents, refuses a BOD when a later
descent runs through, settles `todBeforeNM` in one pass, then the `climbContinues` pass
and the advice trial. `computeLegTotals` prices three level pieces at their own altitude.

---

## 2. Findings

### CRITICAL

#### C1. A PATTERN stop mid-route does not restart the altitude chain - the leg after the circuit is scheduled from the altitude BEFORE it  [run]
**Where:** `src/lib/legs.js:654-660` (the `alt` cursor is only initialised when `null`;
the `continue` for a pattern pair leaves it holding the previous real leg's exit altitude).
**What:** CLAUDE.md says pattern stops "break the chain". They break the *descent* chain
(`if (!Lk) break`, 824) but the forward cursor is not reset, so for
`ENDU(254) -> A(2500) -> PATTERN -> B(6000) -> ENTC(31)` leg B->ENTC gets
`entryAlt 2500` instead of 6000. The leg PATTERN->B is `null` and is rendered by the
independent `computeLegTotals` path (correctly climbing 1500->6000), so the OFP shows the
aircraft arriving at B at 6000 ft and then starting the next leg from 2500 ft.
**Measured:** B->ENTC (13.7 NM): descent 9.9 NM / 4.9 min, 6.7 min, 1.06 gal, no warning.
Same leg scheduled from 6000 ft: descent fills the leg, 6.8 min, and a **5.1-minute
descent shortfall** (an unflyable arrival) that the banner would report. Random sweep of
6 000 routes with a circuit stop mid-route: 274 legs start from a stale altitude, 256 of
them with different time/fuel, and **56 hide a descent shortfall** the banner should show.
**Repro:** feed the five-waypoint route above to `computeFlightSchedule` and compare
`legs[3].entryAlt` (2500) with `wps[3].alt` (6000); or compare `computeLegTotals` of
leg 3 against the same leg scheduled alone.
**Proposed fix:** on a pattern pair, reset the cursor (`alt = null`) so the next real leg
starts from `from.alt` (which is what the independent PATTERN->B row already assumes), and
add the sweep invariant "the first real leg after a `null` leg has `entryAlt === from.alt`".
**Tests to change:** the pin sweep (test.js:4213-4308) never generates pattern waypoints;
add them, plus the invariant above. `=== PATTERN` tests exist for rendering, none for the
schedule after a circuit.

#### C2. "Save & Apply" in the wind matrix turns a blank OAT or wind into 0 - calm wind and 0 °C are invented and the red banner clears  [run]
**Where:** `src/index.html:2596-2601` (`Number(dirInput.value) || 0`, same for spd and
oat); the matrix prefill at 2540-2548 renders a NaN/undefined field as an empty box.
**What:** CLAUDE.md v16.20 records the rule: a waypoint with no OAT/wind must yield NaN
and a named banner entry, because "assuming calm wind would be a plausible wrong answer".
The wind modal violates it: a waypoint whose OAT/wind is missing (imported file, a route
saved before those fields existed, or a field cleared by hand) shows as three empty boxes;
pressing Save & Apply writes `oat 0, wdir 0, wspd 0`, the table computes with calm wind at
0 °C and the integrity banner goes from red to hidden. Confirmed in Chromium: banner
listed "has no temperature (OAT)"/"no wind" before, `{oat:0,wdir:0,wspd:0}` and
`display:none` after.
**Proposed fix:** leave a blank field alone (`if (dirInput.value.trim() === '') skip`), or
refuse to save while any box is empty and highlight it. Keep `Number(...)` for the typed 0.
**Tests to change:** test.js has wind-modal tests (search `wmodal-`); add one that opens
the modal on a waypoint with `oat: NaN` and asserts Save does not produce 0.

### HIGH

#### H1. A throw inside the daylight card silently skips the integrity banner AND the print sheets  [run]
**Where:** `src/index.html:3941-3943` (`updateDaylightCard(); renderOfpPrintSheets();
runIntegrityCheck();` in that order, no try/catch); trigger at 944
(`wp.lat.toFixed(4)`) when a coordinate is a string.
**What:** `sanitiseFlights` accepts `lat: "69.3"` (`isFinite('69.3')` is true, M1), so a
route file with string coordinates - a hand-edited JSON, or another tool's export - loads
and the OFP table renders normally (geodesy coerces). The daylight card then throws
`TypeError: wp.lat.toFixed is not a function`, and because it runs first, the banner is
never evaluated (stays hidden) and `#ofp-print` keeps the **previous plan's sheets**.
Confirmed: with a 16 000 ft waypoint (above the POH ceiling), banner `display:none`,
table shows the new fix, print host still shows the old route.
**Proposed fix:** run `runIntegrityCheck()` first or wrap the card and the sheets in
try/catch that adds a banner line ("the daylight card failed to render"); coerce lat/lng
to numbers in `sanitiseFlights` (M1).
**Tests to change:** add a jsdom test that plants a throwing daylight input and asserts
the banner still shows; integrity tests (`=== 7b2`) assume the card never throws.

#### H2. The red integrity banner is not printed with the company OFP form  [run]
**Where:** `src/styles.css:1092-1093` (`body > * { display:none !important }` then
`body > #ofp-print { display:block }`); `ofpform.js:151-153` (`String(Math.round(NaN))`
prints "NaN" in TAS/TT/WCA/GS/PL cells).
**What:** CLAUDE.md's Safety posture says the banner catches broken output "on screen OR
in print". Since v16.41 the print output IS the company form, and the blanket rule hides
the banner with everything else. Confirmed under `emulateMedia('print')` with a
non-numeric altitude: banner height 0 px, the sheet prints with `NaN` in the cells. A
plan the app itself has declared "DO NOT USE" prints as a clean company form.
**Proposed fix:** render a print-only strip inside `#ofp-print` when
`runIntegrityCheck()` returns problems (e.g. a diagonal "INTEGRITY CHECK FAILED - DO NOT
USE" band across each sheet), and have `ofpRowCells` blank non-finite values via `one()`
consistently rather than printing "NaN".
**Tests to change:** `tools/verify-ofp-print.mjs` (add a failing plan and assert the
strip is in the PDF); test.js `=== company OFP` tests assert no M&B text, not the banner.

#### H3. Waypoint and flight names reach `innerHTML` unescaped - a shared route file can run script  [run]
**Where:** `src/index.html:3954-3956` (`createRowHTML`, every leg row), 3818 (pattern
row), 3715 (`flightTitle` in the header), 2507/2536 (wind modal), 4274 (sub-leg row), 4441
(plotting list: only `"` is escaped, `&` and `<` are not), 3960/3963 (`varSource` into a
`title=` attribute), 3431 (leg-panel preview `S.to.name`).
**What:** `sanitiseFlights` never looks at `name`, `title` or `varSource`, and route load
does not call it at all (H7). Confirmed: a stored mission with
`name: '<img src=x onerror=...>'` ran the handler **13 times** on boot (5 injected
`<img>` in the table). Route files are explicitly meant to be emailed and shared, and the
METAR card, the OFP print sheet and the fix labels DO escape - so this is an inconsistency,
not a policy.
**Proposed fix:** one `esc()` helper (the OFP sheet's at 4303 is fine) applied to every
name/title interpolation; coerce `name` to a string in `sanitiseFlights`.
**Tests to change:** add to the exchange/import tests (`=== import`) a waypoint named
`<img src=x onerror=...>` and assert no `<img>` element exists in
`#flight-plans-container` after render.

#### H4. A corrupt `c182_custom_routes` or `c182_custom_missions` bricks the app at startup  [run]
**Where:** `src/index.html:4527-4534` (`JSON.parse` with no try/catch) called from
`populateRouteDropdown()` at boot (4883) BEFORE `refreshMap()`/`renderAllFlightTables()`
(4913-4914).
**What:** any malformed value (a partial write, a hostile import, a hand edit) throws out
of the top-level script: no map, no table, no guide, no way to recover from inside the app.
Confirmed: `SyntaxError` page error, 0 flight sections rendered. `c182_active_mission`
was hardened for exactly this in an earlier version; the other two keys were not.
**Proposed fix:** wrap both getters in try/catch returning `{}` (and `say()` that the
saved-route library could not be read), and validate each entry is an array when loading.
**Tests to change:** the boot-with-bad-storage test that exists for `c182_active_mission`
(search `"[]"` / `partially-written`) - extend to the two library keys.

#### H5. The line drag has no exit except a mouseup - Escape, losing focus, a right-click or a touch leaves the map stuck  [run]
**Where:** `src/index.html:1768-1808` (`beginLineDrag` disables `map.dragging` and binds
map `mousemove`/`mouseup` + document `mouseup`; `endLineDrag` is the only path back).
**What:** the document-level `keydown` (4164) handles Escape only for four modals, and
there are no `blur`, `visibilitychange`, `contextmenu`, `pointercancel` or `touch*`
handlers anywhere. Confirmed in Chromium: after mousedown+move on the hit-line then
Escape + window blur, `lineDrag` is still set, `map.dragging.enabled() === false`, and
moving the mouse with **no button pressed** keeps dragging the via. Re-entry is blocked by
the `|| lineDrag` guard (1770), so the map stays stuck until some later mouseup happens to
arrive. Alt-tabbing or a right-click mid-drag (native context menu eats the mouseup) are
the realistic triggers.
**Proposed fix:** end the drag on `keydown Escape` (revert the via via undo), `window
blur`, `visibilitychange`, `contextmenu`, `pointercancel`; consider pointer events so a
touch drag works at all.
**Tests to change:** the jsdom gesture tests (`=== v16.27`) drive `beginLineDrag`/
`endLineDrag`; add "Escape mid-drag re-enables map dragging". `verify-leg-panel.mjs`
already checks a left drag bends the line; add the abort case.

#### H6. Ctrl+Z works while a confirm dialog is open, and the confirmed action then acts on a detached flight and does nothing  [run]
**Where:** `src/index.html:4164-4184` (global Ctrl+Z exempts only text-like inputs; a
confirm dialog focuses a BUTTON); `dialog.js:124-136` (`onKey` stops propagation for
Escape only); stale captures at 4108 (`applyBulkDefaultsToActive`), 2014 (map click,
`activeFlight`), 2149 (`removeFlightPlan` `fIdx`), 4652 (`saveCurrentMission`), 2468
(`openWaypointMenu` indices).
**What:** `undoLast` rebinds `flights` to a fresh copy. Any handler that captured a flight
object before `await`ing a dialog then mutates the old object. Confirmed: open "Apply
defaults to every leg", press Ctrl+Z, press Enter -> undo ran behind the dialog (a rename
reverted), the dialog stayed open, and after "Apply to all legs" no altitude changed while
`pushUndoState()` still pushed a state. Dialogs with a text field are protected only by
accident (the input focus exemption). `removeFlightPlan` can delete the wrong flight by
index the same way.
**Proposed fix:** have `dialog.js` swallow Ctrl/Cmd+Z (and the app-level keydown ignore
keys while `openDialog` is set), and re-read `flights[activeFlightIndex]` after every
`await` instead of holding the reference.
**Tests to change:** dialog tests (`=== v16.11`) - add "Ctrl+Z is inert while a dialog is
open".

#### H7. Route load and route import bypass `sanitiseFlights`; a bad saved route corrupts the live plan half-way through the function  [run]
**Where:** `src/index.html:4615-4624` (route branch: `flights[i].waypoints = wps` raw),
4816-4827 and 4860-4861 (import: `parsed.current`, `parsed.routes[first]`, bare
waypoint array), 4820/4824/4861/4866 (`|| 254` - ENDU's elevation hardcoded as the
fallback depElev, so a sea-level aerodrome saved with `alt: 0` loads with 254 ft).
**What:** only missions, `currentFlights`, undo and the boot restore go through the
sanitiser. Confirmed: a saved route whose value is `5` (importable via
`Object.assign(customRoutes, parsed.routes)` with no shape check) throws
`TypeError: (fl.waypoints||[]).forEach is not a function` from `refreshMagVarOnLoad` -
AFTER `pushUndoState()` and AFTER `flights[i].waypoints = 5` was assigned, so the live
plan is broken until an undo or reload (`saveActiveState` did not run, so a reload
recovers). String coordinates and unvalidated names enter by the same door (H1, H3).
**Proposed fix:** route every path through `sanitiseFlights` (wrap a route as a one-flight
array), validate `parsed.routes[name]` is an array of waypoint-shaped objects before
storing it, and use the first waypoint's alt only when finite.
**Tests to change:** `=== import/export round-trip` - add a routes-only file with a
non-array value and a string-coordinate route.

### MEDIUM

#### M1. `sanitiseFlights` only checks coordinate finiteness, accepts string coordinates, and mutates its input  [run]
**Where:** `src/lib/exchange.js:68-88`.
**What:** `isFinite('69')` passes, so lat/lng may be strings (root of H1); `name` may be an
object (prints `[object Object]`), `alt`/`oat`/`wdir`/`wspd`/`var` any type (NaN is caught
by the banner, but see C2), `laps` negative, `isPattern` a string, `bocNM: '1e309'`
(becomes Infinity, then 0 by `pinNM`), `depElev: Infinity` survives, `title` any type;
`w.via` is reassigned/deleted on the caller's object. `__proto__` keys are handled safely
(confirmed no pollution).
**Proposed fix:** coerce lat/lng/alt/oat/wdir/wspd/var with `Number()` (leaving NaN where
absent so the banner still names the field), `String(name)`, `Boolean(isPattern)`,
`Math.max(1, laps|0)`, drop unknown keys or at least `anchor`-like objects, and build new
objects instead of mutating.
**Tests to change:** `=== exchange` tests feed only well-formed flights; add a hostile-
shape table.

#### M2. Importing a file with no recognised keys reports "Import complete."  [run]
**Where:** `src/index.html:4868`.
**What:** `{"hello":"world"}` matches no branch, nothing changes, and the pilot is told
the import succeeded (and that "the current performance profile is kept"). Silent no-op
dressed as success; the same happens for a file from a different tool.
**Proposed fix:** count what was applied (routes, missions, flights, profile, prefs) and
say "Nothing in this file was recognised" when the count is 0. (Also QoL 6.)
**Tests to change:** import tests - add the empty-object case.

#### M3. The ETO column and the daylight card disagree by an hour across a DST transition  [run]
**Where:** `src/lib/format.js:47-54` (`clockFromMinutes` is pure clock arithmetic) vs
`src/index.html:902-910` (the card builds absolute instants in the browser's local zone).
**What:** with `TZ=Europe/Oslo`, ETD 01:30 on 2026-10-25 plus 120 min: ETO column prints
`03:30`, the card (correctly, in absolute time) says landing `02:30`. On 2026-03-29 an ETD
typed as 02:30 (a non-existent local time) is read as 03:30 by the card while the ETO
column starts from 02:30. The legal-night check itself is right; the printed ETO is the
figure that is wrong. **Why not critical:** both transitions happen at 02:00-03:00 local,
which is deep SERA night in Norway on those dates, so a legal day-VFR flight cannot be
airborne across them. Still a wrong time on the form, and the suite pins `TZ=UTC` so it
can never see it.
**Proposed fix:** derive ETO from the same absolute instant the card uses
(`fmtLocalHM(etdMs + accMin*60000)`), or state on the form that ETO is ETD + elapsed.
**Tests to change:** run the clock tests under `Europe/Oslo` as well as UTC (a second
`process.env.TZ` pass or `Intl`-based formatting).

#### M4. `build-aip.mjs` writes `data/aip.js` and the report BEFORE the border reconciliation can throw  [read]
**Where:** `tools/build-aip.mjs:821-825` (writes) vs 836-846 (the `resolved + refused +
notDrawn == published` throw).
**What:** CLAUDE.md calls this invariant "a build error, not a warning". It exits 1, but
the dataset that violates it is already on disk and would be committed by a `git add -A`.
The same ordering puts `report._border` (the whole 18 435-point Kartverket line) into the
report: `delete report._border` is at 847, after the write - `data/aip-report.json` is
1 129 KB where its real content is 74 KB (L1).
**Proposed fix:** compute and check first, write last; move the `delete` above the write.
**Tests to change:** none exist for the tool's ordering; a small test could run
`main()` against a fixture with one dropped reference and assert no file is written.

#### M5. Invariants CLAUDE.md describes are not the ones test.js asserts  [read]
**Where:** test.js sweeps at 4119-4196 (3 000 routes, TOC pins only), 4213-4308 (4 000
routes, all pin combinations, no pattern waypoints, `oat: 0` everywhere), 4619-4645 (4 800
unpinned, TOD marks only); "no-pin == v16.5" is one route with pins set to 0/null/undefined
(3895-3924).
**What:** not asserted anywhere: `exitAlt(k) === entryAlt(k+1)` (my sweep: 0 breaks in
12 296 legs, so it holds, but nothing guards it); direct non-negativity of
`climbDistNM/descDistNM/descMin/shortfallMin` (indirect only); marker list in flight order
(`legs.js:1015`, never inspected); `EDGE_NM` shared (never referenced by a test);
`atWaypoint` for TOC/BOC/BOD; the pattern-chain restart (C1 would have been caught); the
NaN-OAT path under pins. CLAUDE.md's "20 000 pinned routes", "48 957 / 39 483 unpinned
legs" and the 305/302-suggestion tallies are measurements from development runs, not what
ships: the suite asserts `given > 30`, `continuous > 20`, `withBoc > 500`.
**Proposed fix:** add to sweep B: pattern waypoints; `entryAlt === from.alt` after a
`null` leg; explicit `>= 0` on every phase; `computeLegMarkers` order == along-leg
distance order; a NaN-OAT route whose totals are NaN but whose schedule does not throw.
Correct the CLAUDE.md figures to the shipped sizes or note they were offline runs.
**Tests to change:** test.js:4213-4308.

#### M6. Service-worker edition hand-off is one-shot; a worker update mid-session or a slow first registration leaves tiles uncached until reload  [read]
**Where:** `src/index.html:1351-1362` (posts once, only if a controller exists);
`src/sw.js:70-79` (`skipWaiting` on success and on failure), 81-91 (`clients.claim`);
no `controllerchange` listener anywhere.
**What:** the new worker starts with `knownEdition = null` and the page never re-posts,
so after an app release picked up mid-session every tile goes to the network (safe
direction, slow). On a first visit the JSONP usually returns before the worker controls
the page, so caching is off for that whole session. Separately, `skipWaiting()` in the
`catch` means a failed `addAll` (one 404 during a deploy) still activates the new worker,
whose `activate` deletes the old shell - the offline shell is lost, not kept.
**Proposed fix:** on `navigator.serviceWorker.addEventListener('controllerchange', ...)`
and on `ready`, re-post the known edition; do not `skipWaiting` when precache failed.
**Tests to change:** `tools/verify-hosted.mjs` - add "reload-free worker swap keeps
caching" and the failed-install case; test.js guards the worker's structure only.

### LOW

- **L1.** `data/aip-report.json` is 1 129 KB because `report._border` is deleted after
  the write (`build-aip.mjs:847` vs 825); 74 KB without it. [run]
- **L2.** `package-lock.json` records `16.33.0`; every `npm install` rewrites it to
  `16.41.0` and dirties the tree. Commit the regenerated lock. [run]
- **L3.** Documentation drift, one batch: page-script comment "61 inline on*= handlers"
  (index.html:826; 76 static + 25 generated), CLAUDE.md "24 shared mutable globals" (32),
  "the build asserts exactly one `<style>` block" (it is test.js:5077), the sweep sizes in
  M5, and several invariants described as build failures that are tests or per-block skips
  (ring self-intersection test.js:3850, empty `OTHER` 3773, 17/13 delegations 3757/3765,
  attribution strings 2713/3875, rings-vs-volumes is a `skip` reason). The boot comment
  "Airspace overlay was removed" (4908) is misleading now that an official overlay exists.
  Fixing the doc is cheap and stops the next audit re-finding it. [run]
- **L4.** `clockFromMinutes` emits `+N` only for `days > 0`; a negative offset prints a
  clock with no day marker (`format.js:53`). Latent - accMins is always forward. [run]
- **L5.** `loadSavedProfile` (index.html:1459-1462) `Object.assign`s the stored profile
  wholesale with no `pickProfileKeys`, so a key parked in localStorage by an older import
  survives every boot even though export/import whitelist it. `pickProfileKeys` copies
  values with no type check (`cruiseTas: "<b>"` passes; harmless today because every
  consumer coerces or falls back, and `normaliseFixStyle` guards the one HTML sink). [run]
- **L6.** `defaultOatTouched` (index.html:1687) is assigned ONLY from the inline
  attribute at line 92; it works because the page script is a top-level classic script.
  Wrapping the script would silently break `syncDefaultOatToIsa`. [read]
- **L7.** `renameWaypoint` (4392) lets a normal waypoint be renamed to "PATTERN" while
  `isPattern` stays false; `addNewFlightPlan` (2115) and the add flow test the literal
  name, so the return-leg builder treats it as a circuit stop. The circuit-stop rename is
  blocked (v16.40); the reverse is not. [read]
- **L8.** `loadedRouteRef` is not cleared by `undoLast`, `clearAllFlights` or a file
  import, so "Update 'X'" is offered for a plan that no longer came from X. [read]
- **L9.** Unguarded `for (const x of set.sectors / set.aerodromes / set.features)` loops
  hold the substantive asserts at test.js:3120, 3353, 2917, 2720 - vacuous if the
  collection is empty (test.js:2748 shows the guarded pattern). [read]
- **L10.** `ofpRowCells` formats a pattern row's `accBurn` raw (a 0 prints blank via
  `|| ''`) while leg rows go through `one()`; `pad3(NaN)` prints "NaN" where `one()` blanks
  - see H2. [run]

---

## 3. Addenda to the DEFERRED list (new information only, not re-reports)

- Deferred **4** (`tocNM` on a leg with no climb is silently ignored) applies equally to
  `bocNM` (read only at `legs.js:762`, inside the same climb gate) and to `bodNM` on a leg
  with no descent (the backward pass `continue`s at 810 before the pin is looked at, and
  `bodRefused` is never set). Sweep of 6 000 routes: 434 ignored TOC, 758 ignored BOC,
  3 221 ignored BOD pins. One fix covers all three.
- Deferred **1** (spilled descent misreports leg altitudes): my continuity sweep found 0
  cases of `exitAlt(k) != entryAlt(k+1)`, which confirms the item's own description - both
  fields hold the PLANNED altitude, so they agree with each other while disagreeing with
  what is flown. A future invariant should compare against the walked altitude, not the
  neighbouring leg.

---

## 4. Quality of life (desk planning; no new data, no calculation changes)

1. **Escape and backdrop-click should close the leg panel** - the keydown list
   (4166) names four modals and `leg-modal` is not one of them.
2. **Refuse to save the wind matrix with an empty box, and highlight it** (the safe half
   of C2): the form currently looks complete when it is not.
3. **Undo for ETD, fuel and reserve.** Changing ETD moves every ETO and the daylight
   verdict; it is the one plan input Ctrl+Z cannot take back.
4. **13" laptop layout.** At 1280x720 the map is 300 px tall and the daylight card sits
   below the fold (top at 826 px in a 720 px window). Default to the `map` or `stacked`
   layout under ~800 px height, or collapse the header.
5. **Empty state.** With no waypoints the OFP area is blank; one line "Click the map, or
   press 🔍 to search a published fix" would replace the guide for a returning user.
6. **Import summary** should say what changed ("2 routes and 1 mission added, profile
   applied") - see M2.
7. **Undo/redo labels**: the buttons and the toast could name the step ("Undo: delete
   MID") - a stack of JSON strings cannot, a stack of `{label, state}` could.
8. **Keyboard:** Ctrl+S to save the plan, `/` to focus fix search, Delete to remove the
   highlighted waypoint in view mode.
9. **Fix search results** could show distance and bearing from the map centre - the
   ranking already computes it.
10. **Timezone statement next to the ETD field**, not only in the card footer; a pilot
    used to UTC forms will type UTC there.
11. **"Update 'X'" in the save dialog** should disappear once the plan has diverged
    (see L8), or say "replace X with the current plan".
12. **The version badge's "update check failed"** could name the cause (offline vs blocked)
    - it already distinguishes them internally.
13. **Print preview link/button** that opens the browser print dialog with the form, so the
    pilot sees the sheet before paper (today the only route is Ctrl+P).
14. **Row hover on the OFP table highlights the leg on the map** (and vice versa) - the
    markers/rows already share `fIdx-i` indices.

---

## 5. Questions for the author

1. **ETD/ETO are the browser's local time.** The card says so, but the company OFP form is
   normally filled in UTC and AIP/METAR/TAF are UTC. Should the printed ETO be UTC (with
   the offset shown), or is local deliberate?
2. **Taxi fuel is applied once per MISSION** (index.html:3863-3865), not once per sector.
   Is a multi-sector day with an engine stop meant to carry taxi fuel only on the first
   line of the first sheet? The first leg's printed "Int" fuel also includes it.
3. **Does MET Norway's TAF feed ever prefix a line with `TAF` / `TAF AMD`?**
   `latestPerStation` drops any line not starting with a 4-letter ICAO, so such lines would
   vanish silently. I could not check the live feed (403 through the sandbox proxy); the
   fixture at test.js:2622 has no prefix.
4. **The `|| 254` fallbacks** (index.html:4820/4824/4861/4866) hardcode ENDU's elevation.
   Intentional for the school, or leftover from the seed route?
5. **Is a route file trusted input?** H3/H7 assume not (they are shared by email). If the
   answer is "yes, always our own files", H3 drops to medium and H7 to low.
6. **Pattern semantics (C1):** after a circuit, is the intended behaviour "resume from the
   next fix's planned altitude" (what the independent PATTERN->B row already assumes), or
   should the schedule model the circuit altitude explicitly?
7. **The sweep sizes in CLAUDE.md** (20 000 / 48 957 routes) vs the shipped 4 000 / 3 000
   - were they shrunk for suite runtime? If so, a `SWEEP_N` env var would let CI run the
   big ones nightly.
8. **`removeFlightPlan` after Ctrl+Z (H6)** - do you want dialogs to block ALL app
   shortcuts, or only undo/redo?
