# C182 Flight Planner - project history

The full record moved out of CLAUDE.md at v17.5: every measurement, every bug
found on the way, every mutation run and the reasoning behind each decision.
It was MOVED, not rewritten - the text below is what CLAUDE.md said.

**CLAUDE.md is the current truth.** It lists the rules and every decision still
in force, each pointing at its section here as `→ §{heading}`. Read the section
before changing the feature it describes. Where this file and CLAUDE.md
disagree, CLAUDE.md wins: several entries here were later superseded, and the
entry that superseded them says so.

## THE PAPER ROUNDS TO THE NEAREST, BOTH WAYS (v17.10) - THIS REVERSES v17.9's ROUND-UP

The author, on the v17.9 printout: *"what the hell why is it rounding 1.1gal up
to 2? Round it to the nearest whole number, both up and down. Same for
distance"* - and, to be exact about the second half: *"same for distance meant
also round up and down for distance"*.

- **WHY v17.9 WENT UP.** The request it was built from said *"Round it in a way
  that makes sure that the rounded fuel used NEVER becomes less than ACTUAL fuel
  used"* and *"not obnoxiously higher"*. The only rounding to a whole number that
  is never below the actual is the ceiling, and on a short leg the ceiling is
  most of a gallon above - 1.1 printed 2. That was a faithful reading of the
  first sentence, and it was the wrong trade for the pilot copying the sheet.
- **`paperFuel` IS NOW `Math.round`, floor 1**: half rounds up, everything else
  to the nearest (1.1 -> 1, 1.5 -> 2, 2.04 -> 2). A leg burning under 1 still
  prints 1, from the original request ("regardless if its 0.4 or 0.7"). It still
  rounds the UNROUNDED burn, so a 1.46 shown on screen as 1.5 prints 1.
- **DISTANCE WAS ALREADY THE NEAREST**, both ways (`paperDist`, 12.4 -> 12,
  12.5 -> 13), with the "never 0" floor of 0.5 the first request asked for. It is
  unchanged; the suite now says so explicitly.
- **WHAT THIS GIVES UP, stated rather than left to be found.** The paper can now
  show a leg burning up to half a unit LESS than the plan, and the EST fuel
  remaining - which follows the printed Acc column so start - acc = remaining on
  the sheet - can read up to half a unit a leg MORE than the plan's own figure.
  The screen, Mass & Balance and the fuel tracker keep the exact figures, and the
  red banner judges those, so no check is weakened; it is the paper that is now a
  rounded copy rather than a conservative one.
- The property sweep was turned round to match: every value within half a unit,
  whole, and BOTH directions must actually occur (a one-sided rule - the v17.9
  one - fails it).
- **SETTLED BY THE AUTHOR, asked straight after**: whether EST remaining should
  follow the rounded column (and so read up to half a unit a leg above the plan)
  or stay exact. *"The paper should only use the rounded values."* It follows
  the rounded column, as built - the sheet is one consistent rounded copy.

## A ROUNDED PAPER, A LANDING ALTITUDE KEPT, AND THE CORNERS REBUILT (v17.9)

One feature and two bugs from the author, in one message.

### THE PRINTED OFP ROUNDS FOR COPYING, AND NEVER DOWN (v17.9)

*"In the printed OFP, i want the intermediate distances and fuel consumption
rounded to the nearest whole number for easy copying and reading. If a leg uses
less than 1 gal of fuel, it shall show 1 regardless if its 0.4 or 0.7 ... Round
it in a way that makes sure that the rounded fuel used NEVER becomes less than
ACTUAL fuel used. Distances should also be rounded to nearest whole, never 0,
but lowest may be 0.5NM ... the rounding is only for show ... Accumulated fuel
and distance will just use the rounded intermediate values."*

- **`paperRoundSectors`** (`src/lib/ofpform.js`, pure) runs on a COPY of
  `ofpPrintModel` when the print is built. Nothing else moves: the screen, Mass
  & Balance and the fuel tracker keep the exact figures.
- **FUEL IS ROUNDED UP FROM THE UNROUNDED BURN.** The rows now carry
  `legBurnRaw` (and `distRaw`) beside the tenth the screen shows, because
  rounding the TENTH up is not safe: 2.04 shows as 2.0, and up from that is 2 -
  less than the leg burns. `paperFuel` = the next whole unit at or above the
  actual, floor 1, so the margin is under one unit a leg. A 5 000-value sweep in
  the suite asserts both halves on every value.
- **DISTANCE** (`paperDist`): nearest whole, floor 0.5 - a 0.3 NM leg prints 0.5.
- **THE ACC COLUMNS AND THE TOTAL LINE ADD UP WHAT IS PRINTED** (ACC still counts
  the flight, the Total line the sector - v16.85). A touch & go's ground burn,
  which has no row (`prefixBurnRaw`), is rounded up the same way and counted, so
  no fuel the plan counts is missing from the paper's sums.
- **EST FUEL REMAINING FALLS BY THE SAME SURPLUS**, so on one sheet start - acc
  = remaining, and the paper never shows more fuel left than the plan. The
  surplus restarts at a refuel, where the tanks hold a stated figure again.
- `verify:ofp`'s "widest ACC Dist" check matched `NNN.N` and found only a
  remaining-fuel figure once the column went whole; it now reads the ACC Dist
  column BY POSITION (a bare pattern would have matched the PL altitudes - it
  briefly reported "8600").

### A TOUCH & GO WITH CIRCUITS KEEPS ITS LANDING ALTITUDE (v17.9)

*"if I have planned to do touch n go with pattern, the altitude at the arrival
is also set to the cruise altitude and not the landing altitude. Its only when a
single touch&go is selected that the destination altitude remains the landing
elevation."*

`levelFromIndices` (v16.73) excluded "the last waypoint" as the destination. A
touch & go with circuits is logged as the aerodrome THEN a PATTERN entry, so the
last waypoint was the circuit and the aerodrome before it was levelled like any
other fix. `destinationIndex` (legs.js) is the last waypoint that is not a
circuit, and any waypoint carrying a `stop` is never levelled from upstream -
it is a landing at its field elevation wherever it is. The dialog's hint ("ENTC
keeps its own") names the real destination too.

### THE CORNERS FOLLOW THE DRAG, AND A DROP THAT CANNOT BE FLOWN CHANGES NOTHING (v17.9)

*"We should work on the TOC, TOD logic. I want it fixed to be seamless and
smooth ... Dragging a TOD further back should create a BOD automatically AND
also simultaneously calculated. Same with dragging a TOC, i want the BOC to
immediately follow the TOC around so it doesnt respawn whenever i place the TOC
somewhere or BOC somewhere. A TOC and TOD cannot cross paths, that just drops
whichever moved back to its previous position with an alert that the action
cannot be performed. And same warning if a climb leg and descent leg would
intersect, notifying the highest altitude the climb leg can reach before needing
to descend (this assumes 500fpm but the needed fpm descend will also be shown
and can be selected as target descent rate for that specific leg). I want the
symbols to have a little more area the mouse can grab."*

**THIS SUPERSEDES PART OF v16.75.** "It fits, or the leg goes back to the corner
the POH puts there" was the "respawn" the author describes: a refused drop
cleared the leg's target, so the corner jumped to the natural place rather than
staying where the pilot had it.

- **ONE DECISION, TWO CALLERS.** `profileDropDecision` turns a drop position
  into a candidate plan and classifies it: `ok`, `clamp` (a LIMIT - a TOC
  earlier than the POH can climb stops at the earliest it reaches, v16.75's rule
  kept), `cross` (the candidate makes a descent short because a climb blocks it -
  exactly a TOC and a TOD crossing), or `refused`. The drag runs it every frame
  (`cheap`: one flight's schedule, no integrity pass, no conflict search) and
  draws every OTHER corner of the flight where the drop will put it, plus a
  readout; the drop runs it once more in full. So what is drawn during the drag
  is what the drop does - asserted to the 1e-9 degree for the BOC.
- **`cross` AND `refused` CHANGE NOTHING.** The plan is left exactly as it was
  before the drag - not the natural corner. A test gives the leg a REAL previous
  target first, because with none "as it was" and "natural" are the same plan
  and a regression would pass; mutating the drop to clear the target fails it by
  name.
- **THE CONFLICT DIALOG** gives the climb's ceiling and the rate, both from
  `descentConflict` (legs.js, pure), each FOUND ON TRIAL SCHEDULES: the ceiling
  is the highest 100 ft at which the descent still fits at the leg's rate
  (asserted: it fits, +100 ft does not), and the rate is the lowest 50 fpm step
  that fits as planned (asserted: it fits, -50 does not). "Use N fpm for the
  descent to X" commits the drop AND the rate as one undo step, after re-checking
  the plan did not change while the dialog was open (rule 7).
- **A DESCENT RATE PER LEG**: `rodFpm` on the fix the descent ends at
  (`descentRateFpm`, 100-3000 fpm, else the profile's - 500 by default, the
  author's "assumes 500fpm"). ONLY THE RATE CHANGES: the descent is still flown
  at the profile's descent TAS and fuel flow, so it is shorter in time and
  distance and nothing is invented about the aircraft. It is set by the dialog's
  button or in the leg panel ("Descend to it at", blank = the profile's), passes
  the sanitiser only inside the range, and travels in route files.
- **THE SAME WARNING FOR AN ALTITUDE**: an edit that newly makes a climb run
  into a descent opens the same dialog after the edit - the altitude is kept as
  typed (v16.77) and the rate is offered. The leg panel shows the figures with a
  "Use N fpm" button whenever its leg's descent is blocked by a climb.
- **A TOD WHOSE DESCENT ENDS ON A LATER LEG** moves that descent's end by the
  distance the top moved (the descent keeps its length) - the engine now records
  `descTargetIdx`, so the target lands on the right fix rather than on the TOD
  leg's own.
- **A 32 px INVISIBLE GRAB DISC** under each tick and ring (`.prof-hit`).
  Measured in Chromium: a mouse-down 12 px off a 3 px tick drags it.
- `sweep:drag` answers the new dialog ("keep it as it was") and adds an
  invariant: while it is up, the plan is byte-identical to before the drop.
  **280 real mouse drags over 11 plans, 19 refused as conflicts, 0 problems.**
  `verify:leg` passes unchanged.

### SETTLED AFTER v17.9: THE 3 000 FPM CAP STANDS, AND TAKE-OFFS ARE PARKED

Two questions put to the author after v17.9, answered:

- **THE DESCENT RATE CAP (`DESCENT_FPM_MAX = 3000`) STAYS** - *"3000fpm cap is
  fine."* The conflict dialog may offer a steep rate on a short final leg (1 650
  fpm was measured on a 3.6 NM one); it is offered, never applied unasked.
- **THE ±30 MIN ATS LABEL STAYS LANDINGS-ONLY FOR NOW** - *"there is no need to
  add the takeoff warning yet, but it could be saved as an optional item
  later."* Building it is one line in `buildAtsHoursChecks` (`kind === 'landing'`
  -> also `'takeoff'`), plus a test; it is on the open list in CLAUDE.md.

## A LANDING WITHIN 30 MIN OF ATS CLOSING GETS AN AMBER LABEL (v17.8)

The author: *"Make a small warning label if an aerodrome is closed +-30min of
my ETA."* (Asked right after a username-and-PIN login was discussed and
dropped: on a static host a PIN can be brute-forced offline and nothing can log
or revoke a login, so the honest options were Cloudflare Access or a server of
our own. The author: *"scratch the idea."* Nothing was built.)

- **`atsMarginAt(h, ms)`** in `src/lib/opshours.js` (pure): for an ETA at which
  ATS is decided OPEN, the nearest closed minute on each side within
  `ATS_ETA_MARGIN_MIN` (30, the author's figure). Each of the 2 x 30 minutes is
  asked of `atsOpenAt` itself - the schedule has minute resolution, so that is
  exact, and the season, the UTC day and the INCLUSIVE closing edge come from
  the one reader rather than a second copy of its rules. So an ETA 30 min before
  a 1500Z closure is not warned about (1500 is still open), 29 min is.
- **NOTHING IS SAID THAT IS NOT DECIDED.** Closed AT the ETA is already the red
  banner's finding (v17.0), so it does not get this label as well. H24, "no
  ATS", on request and undecoded text give nothing, and a side that runs into
  an undecidable minute stops there.
- **LANDINGS ONLY, as asked** - the ETA is the estimate that drifts; the ETD is
  the pilot's to set. Every landing counts: the destination and every touch &
  go or full stop. Take-offs are one line to add if the author wants them.
- **AMBER, NEVER THE BANNER.** The landing is legal as planned. It shows as a
  line under that landing's row on the ATS hours card ("ENDU ATS closes 2330
  local (2130Z), 18 min after your ETA - inside your ±30 min margin") and as a
  chip in the sector's header ("ENDU ATS closes 18 min after ETA"). The chip
  holders are drawn with the headers and filled once the checks exist, because
  a flight's times do not exist until its tables have been worked. The colour
  is the weather card's "outdated" amber, so one colour means "check this" on
  the plan pane.
- Tested to the minute (1440Z on a 1500Z closure = 20 min; 0710Z on a 0700Z
  opening = 10 min; the 30/29 min edge; both edges of a 30-min opening; summer
  vs winter figures), and on the page: the label and the chip appear for a
  2112Z landing on ENDU's 2130Z Sunday closure, stay off the banner, and give
  way to the banner's finding once the landing is after the closure. Seen in
  Chromium under Europe/Oslo.

## FIVE REQUESTS FROM THE AUTHOR, ONE VERSION (v17.6)

Asked together: *"I want the flight defaults tab changed..."*, *"the Airport
METAR/TAF fetch button should be more prominent and centralized when there is
no data"*, *"There is no way to deselect it and remove the highlight"*, *"Draw a
little runway with the correct markers and draw the distances over the runway"*
(with a screenshot of an EFB-style landing card) and *"Whenever an UNDO or REDO
is performed, a text-box should appear explaining which action was undone or
redone."* Also in this version: the plan for roadmap item 18 (measured, nothing
moved - see that item) and two CLAUDE.md corrections (below).

### FLIGHT DEFAULTS HOLD NO DEPARTURE ELEVATION AND NO WIND (v17.6)

The author: *"No departure altitude as thats automatically set upon choosing a
departure airport, wind dir and wind speed does not need to be there, all new
waypoints automatically have 000/00 preselected and the wind fetcher will update
the waypoints accordingly."*

- `#def-dep-elev`, `#def-wdir` and `#def-wspd` are gone, with every read and
  write of them (the undo snapshot's `PLAN_FIELDS` among them). The
  departure elevation still comes from the departure aerodrome
  (`addAnchorWaypoint`, v16.54) and is still editable in each plan's header -
  the header input was always the per-plan authority; the removed field only
  mirrored plan 1.
- A new waypoint is born at `NEW_WP_WIND` (000/00) in all three places one is
  born: a map click, a published fix, and the first fix of a new sector.
- **Apply Bulk no longer writes a wind.** With no wind field it could only have
  written 000/00 - over a fetched forecast. It sets cruise altitude and OAT and
  its dialog says the winds are not changed.
- Where a new plan has nothing to continue from it departs at 0 ft until an
  aerodrome is chosen: the removed field's own starting value, not an invented
  elevation (the "no house default" rule of v16.44 stands).
- The "never assume calm wind" rule (v16.20) is not reversed: it governs a wind
  that is MISSING (a fetch that returned nothing is NaN and named on the
  banner). 000/00 on a new fix is a value the pilot can see in the wind column
  and that the fetch replaces - the author's decision, and the guide says it.
- The page's quoted handler count moved 153 -> 151 across the version (four
  handlers left with the fields, the Deselect button and the big Fetch button
  added two); the L3 test caught each step.

### EVERY UNDO AND REDO SAYS WHICH STEP IT TOOK (v17.6)

The toast already named the step - but only from the Undo/Redo BUTTONS. The
keyboard path calls `undoLast(true)`, and `quiet` suppressed everything, so the
Ctrl+Z a pilot actually uses was the one that said nothing. Now `#undo-notice`
(bottom centre, one box REWRITTEN per step so holding the key does not stack a
toast per press) shows "Undone: <label>" / "Redone: <label>" and how many steps
remain; `quiet` only silences "Nothing to undo" at the end of the stack, which
is what it was added for. The label is the one each step was pushed with - the
v16.49 rule that every `pushUndoState` names its step is what makes this
possible, and its test still guards it. The hide timer lives on the element so
the page's shared-global count (58) did not move.

### A SELECTION CAN BE PUT DOWN (v17.6)

Escape already cleared it (keys.js, "clear the selection"), which nothing on
screen said. Now four ways, all through one `clearWaypointSelection()`: a
second click on the selected waypoint, Escape, a **✕ Deselect <n>. <name>**
control in the map stack that exists only while something is selected, and in
View Mode a click on the empty map (View Mode adds nothing there, so the click
is free). A selection whose waypoint no longer exists is dropped on the next
redraw instead of dangling.

### THE WEATHER CARD IS ITS FETCH BUTTON UNTIL IT HAS WEATHER (v17.6)

Before the first fetch the M&B weather card said "Not fetched yet" beside a
small corner button. Now its body is one large centred **Fetch METAR & TAF**
naming the fields it will ask for (the same list `fetchMetarTaf` builds), and
the corner button appears only once there is weather to refresh. The fetch
status ("Fetching...", or why it failed) is mirrored into the card, because the
status line lives on the flight-plan pane and the pilot pressed the button on
this one; the big button follows the plan pane's disabled state during a fetch
and is re-enabled after a failure.

### THE DISTANCES ARE DRAWN ON A RUNWAY (v17.6)

`src/lib/rwydiagram.js` (a new pure module: in the standalone-run guard, the
WHERE-TO-EDIT index and the bundle) draws each take-off and landing check as an
SVG, replacing the v16.96 usage bar. The figure line stays and stays the
authority; the drawing carries no number the text does not.

- **THE STRIP IS THE DECLARED DISTANCE, not the physical runway.** The AIP gives
  length, width and TORA / TODA / LDA per end, but not where on the surface each
  declared distance begins (ENDU 10: 2 995 m of surface, TORA 2 443, LDA 2 001),
  so placing them would be a guess. The strip is TODA (take-off) or LDA
  (landing), and the POH distance and the factored requirement are measured
  along it to one scale from the start of the run; a requirement past the end
  runs off it in red and says "N m short".
- **THE MARKINGS WERE VERIFIED BEFORE ONE WAS DRAWN**, against the text of EASA
  CS ADR-DSN (read from ENAC's published comparison of Chapter L, which quotes
  the CS verbatim): L.535 threshold stripes starting 6 m in, counted by runway
  WIDTH - 18 m: 4, 23 m: 6, 30 m: 8, 45 m: 12, 60 m: 16; L.525 the designation
  at every threshold, read from the approach; L.530 the centre line, stripe at
  least 30 m and at least the gap, stripe plus gap 50-75 m (drawn 30 + 20).
  Markings are for a paved runway (L.530 (a)).
- **WHAT THE TABLE DOES NOT COVER IS NOT INVENTED.** The dataset has 30, 40, 45
  and 60 m runways; ENRO 13/31 is 40 m, which L.535 gives no count for, so it
  gets no stripes and a caption saying why. ENAS 12/30 is gravel: drawn plain,
  no paint, "Unpaved (GRAVEL)". A missing wind is "---/--, not known", never
  000/00.
- Width and markings are ENLARGED (a 30 m stripe on a 2 400 m strip is three
  pixels at card size); widths keep their proportions to each other (0.8 px/m).
  The card's intro and the guide say both.
- The wind box shows the wind the figure was worked with, split into head/tail
  and cross; arrows are relative to the drawn strip (run left to right, so a
  headwind blows from the right and a cross "from the left" blows down); a
  tailwind is red and labelled, a VRB wind says it was priced as a tail.
- Checked in Chromium at sidebar width, light and dark, and on five synthetic
  cases (overrun, 40 m, gravel, VRB at 60 m, unknown wind at 18 m).

### THE WIND BOX HAS ROOM BELOW ITS LAST LINE (v17.7)

The author, with two screenshots (VRB/02 and 280/10, dark mode): *"the bottom
text is just a bit too close to the edge of the box which doesnt look right."*
The box was a fixed 84 units high and ended ONE unit under the last baseline,
against about nine above the first line. It is now sized from its last line
(`LAST_BASELINE` + `BOX_PAD`, the same padding as the top), still stretching to
the runway's bars when the strip is wide, and the drawing's own height grows to
hold it. A test measures the padding above and below for every last-line
wording (head / TAILWIND / VRB = tail) at every stripe-table width, and would
have failed on the old box.

### TWO CORRECTIONS TO CLAUDE.md (v17.6)

- "140 tests pass at v16.2" and "the 4 100-line page script" were both years
  stale (700+ and ~8 800). The test count is no longer pinned - the L3 lesson.
- **THE eAIP IS NOT REPUBLISHED EVERY 28 DAYS.** At the start of this session
  Claude suggested an AIRAC re-import because 2026-10-01 is an AIRAC date; the
  author: *"The AIP only updates if there is a change in it. So it does not
  follow AIRAC 28 day cycles."* This file already said so (v16.29: "an eAIP
  edition is republished per AIP AMDT, not per 28-day cycle"), but CLAUDE.md did
  not, and the suggestion was made from CLAUDE.md. It does now. (For the record:
  on 2026-09-29 the index was 155 and no 2026-10-01 edition existed under it.)

## The permission wording came out, and CLAUDE.md was split (v17.5)

The author: *"you can remove that 'explicit non-commercial permission' completely
from both the program and the claude.MD. I am doing this on my own responsibility
and it is a private project for me only."* - and, on credit: *"Credit goes where
credit is due, of course."* So every attribution line still names Avinor AS
(and Kartverket, MET Norway, Open-Meteo), while the "used with permission,
non-commercial" wording is gone from the app, the dataset, the build tools, the
README and CLAUDE.md. Tests require the credit and guard the removal: putting the
old wording back in the airspace attribution fails one by name.

The data files were edited in place (attribution strings, and the report's
`permission` field); the build tools now write the same strings, so a re-import
reproduces them.

In the same version CLAUDE.md was cut from ~74 000 words to ~5 300: the long
form moved here verbatim, and CLAUDE.md points at each section. Every conversation
turn re-read the whole file, which is what made it worth doing.

For the record, the section it replaced, as it read at v17.4:

> The AIP airspace data comes from Avinor's eAIP, which is **copyright Avinor
> AS**: GEN 0.1 states that any use outside copyright law is inadmissible
> without permission. **The user HOLDS that permission, conditional on the
> software not being used commercially.**
>
> That condition is now a constraint on the project, not a footnote:
>
> - The planner MUST NOT be commercialised while `data/aip.js` ships with it.
>   If commercial use is ever wanted, the AIP dataset comes out first.
> - The attribution and the non-commercial condition are stated in the dataset
>   itself, in `tools/build-aip.mjs`, and in the app (guide + attribution line).
>   A test asserts the dataset carries them.
> - This is a PERMISSION, not an open licence. It does not transfer to anyone
>   who forks the repo, and it cannot be widened by assumption. Kartverket
>   (topo tiles, and the national-border WFS if that is ever wired in) is
>   separately NLOD; MET Norway is NLOD 2.0. Do not conflate the three.

## Architecture (deliberate, do not "modernize")

### v16.45 (user decision, premise changed AGAIN): there is now ONE delivery, `site/`. The single-file `dist/C182_FlightPlanner.html` is GONE

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

### v16.14 (superseded at v16.45 - the single-file half is gone; kept for the history of why `site/` exists at all): the planner is now HOSTED as well

The user asked for GitHub Pages plus the ability to
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
### The single-file artifact and the v16.8 build, Phase 1 extraction

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
    decision, not unfinished work: it is one web of 58 shared mutable
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
### User data and PROFILE_KEYS (v16.18; the registration rule relaxed at v16.93-v16.95)

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
  identifies a PERSON or a PLACE. (v16.34 added `fixesOn`, a boolean layer
  toggle.)
  - **THE "MACHINE" HALF OF THAT RULE WAS RELAXED BY THE AUTHOR AT v16.93**,
    in these words: *"Aircraft registrations and their data can be stored.
    Theres no privacy issue there. Crew manifest is not required to input the
    weights. PIC and PAX names are only written on the printed sheet."* So a
    REGISTRATION may travel in an export once the M&B tab exists (Phase C);
    a crew name, a licence number, a person's weight tied to a name, and a
    place still may not. The v16.41 rule that the printed form's Reg box stays
    empty rested on the planner not knowing which tail is flown - a premise
    that expires the moment a tail is selectable, and the two tests encoding
    it are to be updated deliberately in Phase C, not left to fail.
  - **v16.95 DID THAT, AND TOOK THE PERMISSION NARROWER THAN GIVEN.** The Reg
    box now prints the selected tail, and the test says why it changed. But
    "may travel in an export" was a permission, not a request, and the M&B
    inputs are NOT exported: they are stored under their own key
    (`c182_mb_prefs`), outside PROFILE_KEYS. The seat weights are the reason -
    they carry no name, but they are a fact about who was aboard, and a route
    file is for sharing a ROUTE. Exporting the registration alone is a one-line
    change if the author wants it; it was not done on assumption.

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

## Domain decisions - the full entries

### Geodesy (v16.9, superseded the spherical model)

exact WGS-84
geodesics via GeographicLib (`geographiclib-geodesic`, Karney's
reference algorithm) in `src/lib/geodesy.js`. The old spherical law of
cosines was inside its audited <0.5%, but biased ONE way - short:
-0.33% ENDU-ENTC, -0.37% ENDU-ENEV, -0.41% ENTC-ENKR. On the user's
ENDU-ENSK-ENLK-ENEV-ENDU mission it under-reported 1.13 NM (0.37%),
i.e. under-planned fuel. Tracks moved <=0.02 deg. Bundling a library
only became possible once the build existed (v16.8). Note a degree of
latitude is now 60.2 NM at 60N, not the spherical 60.0 - the tests
assert the ellipsoidal values deliberately.

### Winds aloft

Open-Meteo (api.open-meteo.com), pressure levels
1000–600 hPa, u/v vector averaging, 3 samples per leg, model selector
incl. COMPARE3 spread report. CC BY attribution required. MET Nordic
(api.met.no) was verified to have NO pressure-level data — rejected.

### Airspace overlay

built on openAIP tiles, then REMOVED at the
user's request because community data lagged the current VFR chart.
Verified there is no official alternative yet (Avinor AIXM downloads
are only "planned"). Do not re-add without an official, current source.
Init code purges old localStorage keys `c182_openaip_key` /
`c182_airspace_on`; tests guard the feature's absence.

### Terrain/elevation

Kartverket høydedata API exists and is open
(ws.geonorge.no/hoydedata/v1/punkt), but the user DECLINED elevation
features. Chart contours + MEF remain the terrain reference.

### Map

locked to a single world copy (maxBounds ±180°, viscosity 1,
noWrap on tiles). Kartverket tile URL is WMTS webmercator cache.

### Mass & Balance

WAS out of scope — the user kept M&B in their Excel
OFP. SUPERSEDED TWICE: at v16.28 it became roadmap item 5, and at **v16.93
the pure engine is BUILT** — see "MASS & BALANCE, THE OTHER HALF OF THE
FORM" above. `OFP-C182.xlsx` is committed and is the authoritative source,
corroborated figure for figure by the printed form. POH take-off and landing
distance against the AIP's TODA/LDA is BUILT at v16.96 (phase D, below).
A fuel-REQUIREMENT check is still not built.

### Daylight / VFR day (v16.3)

legal basis verified — SERA Art. 2(97)
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

### MagVar (v16.9, the real WMM)

`src/lib/magvar.js` uses the actual
World Magnetic Model (`magvar` package, WMM2025 coefficients, valid
2025-2030), replacing the regional polynomial. Measured against NOAA
at epoch 2026.6438: <=0.005 deg error everywhere, versus the
polynomial's 0.59-0.72 deg in Troms and -1.94 deg at ENGM. VAR feeds
MH directly, so this is the heading actually flown. The polynomial's
"refit around 2029-2030" debt is retired; instead `isWmmCurrent()`
exists and a test asserts it, so the suite FAILS when WMM2025 expires
in 2030 and the package needs updating. NOAA fixtures stay in test.js
with a 0.02 deg tolerance. VAR cells remain editable.

### Via-leg row semantics (v16.4, user decision)

on a leg with via
points the OFP row's TT/MT/WCA/MH show the DIRECT waypoint-to-waypoint
line (the chart measurement between the named fixes); the flown
per-segment tracks live in the ↳ sub-line and the plotting list, and
the guide says to steer by those. Distance/time/fuel/GS always walk
the bent path. Do not switch the row back to first-segment track.

### PINNED CLIMB AND DESCENT CORNERS (v16.37, roadmap item 1)

the pilot can
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

### Flight altitude schedule (v16.5, user decision)

legs are NOT
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

### Base chart switch (v16.7, verified Aug 2026)

the map toggles
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

### VFR chart resolution (v16.12, measured against the service)

the
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

### METAR & TAF (v16.21)

MET Norway,
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

### Map controls stack themselves (v16.24)

the ⬇ Chart and 🔍 Detail
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

### Chart detail setting (v16.23)

the thing that actually made the VFR
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

### Offline chart download: BUILT v16.22-v16.25, REMOVED v16.26. Do not rebuild it

A button pre-fetched the route corridor into the
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

### Route editing gestures (v16.27, QoL)

bending a leg was two gestures -
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

### TOC / TOD marks (v16.28, bug fix + the user's preference)

they are
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

### The per-row "+" insert button (v16.27) was REMOVED at v16.28

on the
user's request - clicking the map adds a waypoint and right-clicking the
line inserts one mid-route, so a button in every OFP row was paying table
width for nothing. `legMidpoint` stays in legs.js (tested, cheap) in case
a positioned insert is wanted again. The right-click gesture and the
leg-splitting rules are unchanged.

### AIP airspace (v16.29, roadmap item 4 — the DATA half is built)

140
drawable airspaces (53 TMA volumes, 33 TIZ, 19 CTR, 17 TIA, 6 ADS, 5 CTA,
2 RMZ/TMZ, 2 HTZ, 1 RMZ) with class, published vertical limits, callsigns
and frequencies, from the official Avinor eAIP (see "Data sources and
credit" at the top). The planner OVERLAY is not built yet; this
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
  Do NOT read coordinates off a chart image. STILL TRUE AT v16.86, and it is
  the reason the VAC overlay may DISPLAY a raster and may never read one: the
  symbols that build locates FIT the sheet and never publish a position.

### National-border resolution (v16.30)

22 airspaces whose published
boundary follows the national border are now DRAWN, from Kartverket's
official line rather than a straight-line guess. Dataset: 140 -> 228
volumes.
- SOURCE: Kartverket's administrative-units WFS
  (`wfs.geonorge.no/skwms1/wfs.administrative_enheter`, `app:Grense`
  filtered server-side to `avgrensningstype = Riksgrense`), under **NLOD**.
  That is a SEPARATE source from the Avinor AIP - the airspace dataset
  now depends on both, and each keeps its own attribution.
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

### A BORDER REFERENCE IS PUBLISHED TWO WAYS, AND ONE OF THEM WAS BEING DROPPED (v16.36 bug fix, user-spotted)

The user looked at the ICAO chart
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

### ATS DELEGATION AREAS ARE NOT AIRSPACE (v16.36, user-spotted)

The user
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

### STEPPED AIRSPACE: EACH BAND HAS ITS OWN RING (v16.30 bug fix)

This was
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

### AIP FIXES: AERODROMES AND REPORTING POINTS (v16.34, roadmap item 3 — BUILT)

53 aerodromes and 243 VFR reporting points, clickable on the map
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
- THE CHART RASTER CARRIES NO GEOREFERENCE - still true, the PDFs have no
  GeoPDF markers (/Measure, /GPTS, /Viewport all absent). **THE CONCLUSION
  DRAWN FROM IT ("so a VAC overlay remains out of reach") WAS SUPERSEDED AT
  v16.86**: a sheet with no georeference can still be georeferenced from its
  OWN INK, which is what the conformal fit does. See "THE VAC IS DRAWN ON THE
  MAP" below. This entry remains the coordinate TABLE only, and that split is
  the point - the table is DATA, the raster is DISPLAY.
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

### MAP SETTINGS, AND THE FIX SYMBOL AS A PREFERENCE (v16.35, user request)

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

### Airspace OVERLAY (v16.31, roadmap item 4 COMPLETE)

`src/lib/airspace.js`
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

### A ROW IS A POSITION, NOT A SERVICE CODE (v16.60, the pilot's question: "why does ENGM have so many approach frequencies?")

`collectServices` unioned
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

### ACC SECTORS: THE RIGHT POLARIS FREQUENCY, BY POSITION (v16.33)

Hovering
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

### Not planned

(verified dead ends): ~~NOTAM (no reliable free API)~~ -
**REOPENED at v16.93: the author named a source, `ippc.no`** (Avinor's
pre-flight planning centre). That is a changed premise, not a changed mind -
the old entry said no reliable free API had been FOUND, and a named one has
to be checked rather than dismissed. **ANSWERED at v17.0: no.** ippc.no
serves NOTAMs over session-bound DWR calls with no CORS header, so a browser
page cannot read them - see "ATS OPENING HOURS BUILT, NOTAMs REFUSED".
georeferenced 1:500 000 ICAO charts (licensing - and note this is a DIFFERENT
product from the VAC under different terms; the VAC overlay shipped at v16.86
as AIP Norge data), traffic (needs receivers).
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
8a. **A PATTERN waypoint is skipped when the daylight card picks the departure
   and destination, and when the printed form fills its DEP/DEST boxes.**
   (Narrower since v16.84: a circuit now sits ON the fix it follows, so the only
   case left is a plan that OPENS with one, where there is no earlier fix to
   name and the card falls through to the next.) So a
   plan that opens with circuits is judged for day VFR at the next fix instead
   (measured: the card named A where the aircraft took off from ENDU, 16 NM
   away - well under a minute of sun, but the wrong place). Including it would
   put the literal word "PATTERN" in the DEP box and on the card, because the
   add flow forces that name and v16.48's L7 rule makes it the marker that
   MAKES a waypoint a circuit. Needs the naming settled first - see v16.83.

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
14. **THE MENU SKIN REVEALS THE EMPTY `#slot-sidebar-top`** (found at v16.95).
    `#sidebar:hover > * { display: revert }` out-specifies
    `#slot-sidebar-top:empty { display: none }`, so on hover a 0-height slot
    takes a flex gap and everything in the rail sits 10 px lower (6 on a short
    window). Pre-existing since v16.66 - v16.94's first card is exactly as far
    down - and the same `revert` trap v16.95 fixed for the panes and the tabs.
    One more rule of the same shape; left out to keep Phase C to its scope.

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
   AIP Norge and it names its edition.
5. **PHASES A-C DONE (v16.93-v16.95) - Mass & Balance from the Excel sheet.**
   Phase A the pure engine and fleet, Phase B the exact per-sector gallons and
   one fuel density, Phase C the tab, the CG chart, the sector/mission toggle
   and findings on the banner AND the paper. See "MASS & BALANCE, THE OTHER
   HALF OF THE FORM" and "PHASE C" below it.
   **PHASE D DONE at v16.96**: runways and declared distances imported from AD
   2.12/2.13, and take-off/landing distance worked the school's way against
   TODA and LDA. See "PHASE D" below.
6. **DONE at v16.95** - the OFP half at v16.41, the M&B half with item 5's
   Phase C. **At v16.97 both pages became the form's OWN PDF with the figures
   written on** - page 2's grid measured off its raster strips, 0 differing
   pixels on a blank sheet. See "THE PRINTOUT IS THE SCHOOL'S FORM".

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

### 21. MODERN LOOKS (v17.2, the author: "check out modern website and GUI designs and suggest some styles... experimenting with different colour matching, different button styles and layout configurations")

**FIRST ROUND DONE at v17.2**: three skins, Slate, Chart and Float. See
"THREE MODERN LOOKS" under the SKINS section. They are OFFERS to try, not a
redesign: the default is pixel-identical, and choosing between them (or asking
for a mix) is the author's call. Tier 3 (reordering the OFP columns) is still
not attempted.

### 20. AERODROME OPENING HOURS, AND NOTAMs (v16.93, the author's request)

**v17.0: THE HOURS ARE BUILT; THE NOTAMs ARE REFUSED, AND BOTH VERDICTS WERE
MEASURED.** See "ATS OPENING HOURS" below. What follows is the plan as written
at v16.93, kept because every question it asked got a measured answer.

*"Opening hours for all aerodromes fetched from the AIS, and NOTAMs fetched
from ippc.no. If a closed airport is in the flight plan, a warning shall be
issued."*

NOTHING IS BUILT AND NOTHING IS VERIFIED. What follows is the shape of the
work and, more importantly, the question that decides whether each half can
exist at all - because this is the surface where this project has already
refused two features (openAIP, aviationweather.gov) and removed a third (the
offline chart download).

- **THE TWO HALVES ARE NOT THE SAME PROBLEM, and they should be scoped apart.**
  - **OPENING HOURS look cheap and may need no new source.** AD 2.3
    "Operational hours" is a section of every AD 2 page, and `build-aip.mjs`
    ALREADY fetches all 53 of those pages for the airspace and the ARPs. If the
    hours arrive as tagged `class="SD"` fields the way everything else on those
    pages does, this is an importer change and a dataset column - no runtime
    fetch, no CORS, works offline, and it ships with the AIRAC snapshot like the
    rest. **CHECK THAT FIRST**, against a cached AD 2 page, before designing
    anything: if the hours are untagged PROSE ("HJ", "MON-FRI 0600-2100, other
    times O/R"), then reading them is sentence-parsing, which is precisely what
    the v16.29 entry says the importer must never do.
  - **NOTAMs ARE LIVE DATA AND CANNOT BE CACHED**, exactly like the weather: a
    stale NOTAM is a wrong NOTAM. So they are a runtime fetch, and **the whole
    question is whether a BROWSER may make it.** `api.met.no` works because it
    sends `access-control-allow-origin: *`; `aviationweather.gov` was rejected
    twice for sending none. Check `ippc.no` for a CORS header, an
    unauthenticated endpoint, and its licence terms BEFORE any UI is drawn -
    and if it needs a login or sends no CORS header, say so and build nothing.
    A NOTAM feature that silently fails is worse than no NOTAM feature.
- **A CLOSED AERODROME IS AN INTEGRITY FINDING**, which is where it belongs:
  `collectIntegrityProblems` already names the waypoint at fault, the banner
  already reaches the printed sheet (v16.43), and a closed destination is
  exactly "do not use these figures". It should name the aerodrome and the hours
  it is closed, never just "an aerodrome is closed".
- **THE ETO IS WHAT DECIDES IT, not the calendar day.** The daylight card
  already computes every takeoff and landing at its own aerodrome on its own
  date (v16.3); opening hours have to be judged the same way, against the
  arrival time at THAT aerodrome, or a plan landing at 2305 reads as legal
  because the field was open at 0900.
- **"HJ" AND "O/R" ARE NOT CLOCK TIMES.** Sunrise-to-sunset (HJ) is computable
  from `daylight.js` and is therefore honest; "on request" is a phone call, and
  the only correct rendering of it is to say so rather than to guess a window.
  Whatever cannot be resolved must be REPORTED as unresolved, per the rule the
  AIP importer already follows.

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

#### THE PLAN, MEASURED (v17.6) - staged, nothing built yet

Written before any code moves, from a measurement rather than the estimate
above: the page script (the last `<script>` of `src/index.html`) was extracted
to a scratch `page.js` and run through the project's own `tsc`, with
`src/types.d.ts` and a generated declaration of every bundle export as a global
(336 names, from the `import * as` lines of `src/main.js`), `L` and `PDFLib`
declared `any`.

**What the checker says today (8 762 lines):**

| mode | errors | what they are |
|---|---|---|
| `checkJs`, `strict: false` | **260** | 241 TS2339 (`.value` / `.checked` / `.disabled` on a plain `HTMLElement`), 19 others |
| `checkJs`, `strict: true` (the modules' standard) | **1 210** | 430 TS2339, 333 implicit-any parameters, 146 implicit-any variables, 208 possibly-null, 28 untyped index, 21 assignability, the rest small |
| `noUnusedLocals` on top | +3 | `distUnit`, `tasRef`, `mk` - genuinely dead locals. Page GLOBALS are not flagged (a classic script's top level is global), so the functions reached only from inline `on*=` handlers are safe |

The 19 non-DOM errors in loose mode were read one by one: JSDoc that is
narrower than the call (`normaliseStopMinutes(kind)` relies on its second
parameter defaulting, so its `@param` wants `[min]`; a dialog button type that
makes `hint` required), not runtime bugs. The value of the exercise is in the
STRICT half - the 208 possibly-null sites are exactly the H1 shape (a lookup
that throws when an element is missing) - and in keeping new code checked.

**Stage 0 - move, change nothing (one version).**
- `src/page.js` holds the script; `src/index.html` keeps `<!-- @PAGE: ... -->`
  where it was, and `tools/build.mjs` inlines it the way it already inlines
  `@STYLES`, `@AIPDATA` and `@BUNDLE`, failing when the marker is left over.
- PROOF OF "NOTHING CHANGED": the built `site/index.html` is byte-identical
  before and after the move. Build both in the same commit and compare hashes;
  that is the whole acceptance test for this stage.
- The suite: 10 tests read `src/index.html` directly with `readFileSync`
  (lines 3291-12876 at v17.6) and some of them mean the SCRIPT - each is
  re-pointed to `src/page.js` or to `APP_SRC`, one by one, never by a blanket
  replace (four guards once went green for the wrong reason exactly that way).
  The L3 count test (handlers, globals) and the WHERE-TO-EDIT index test move
  with the script. CLAUDE.md's editing discipline step 2 becomes
  `node --check src/page.js`.

**Stage 1 - declare the globals truthfully.** `tools/build.mjs` writes
`src/page-globals.d.ts` from the bundle's real exports (so the page sees each
bundle function with its REAL signature, not `any`), and a test fails when the
file is stale. `L` stays `any` unless the author accepts `@types/leaflet` as a
dev dependency - a decision, not a default.

**Stage 2 - loose checking on, 260 -> 0.** A second config
(`tsconfig.page.json`, `checkJs`, `strict: false`) joins `npm run typecheck`.
The 241 DOM errors are one idiom: `document.getElementById('x').value`. Two
ways to clear them, and choosing is the author's call because it changes how
the page reads: a JSDoc cast at each site (`/** @type {HTMLInputElement} */`,
the idiom the modules already use), or one typed helper (`inputById(id)`). The
test that says the checker cannot be quietly dropped is extended to this file.

**Stage 3 - strict, as a ratchet, one WHERE-TO-EDIT section per version.**
`noImplicitAny` first (JSDoc on the ~480 untyped parameters and variables),
then `strictNullChecks` (the 208 null sites - each is a real question, "what if
this element is not there?", and the answer is sometimes a bug). A committed
error count that a test only lets go DOWN keeps the work from sliding back.
Only when it reaches 0 does `page.js` join the main `tsconfig.json`, at the
modules' standard.

**Not in this item:** `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes` (above) are measured on the MODULES separately -
turning them on across the page at the same time would bury the signal.

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

**SUPERSEDED AT v16.97: the printout is now the form's own PDF with the figures
written on (src/lib/ofppdf.js) - see "THE PRINTOUT IS THE SCHOOL'S FORM". What
follows is the HTML reproduction it replaced; the blank-on-purpose decisions and
the one-sector-per-sheet rule still hold, the geometry and print CSS do not.**

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
- **CREW, PASSENGERS and PIC STAY EMPTY, and that is the privacy rule, not
  laziness.** Crew are people. A test asserts the crew block prints empty and
  that PROFILE_KEYS has not grown a reg/pic/crew key.
  - **Reg WAS in this list until v16.95**, on the premise that the planner did
    not know which tail was flown. M&B made one selectable and the author
    cleared registrations outright, so the box now prints the selected tail -
    and it would be an inconsistency on ONE printout not to, because page 2
    names the aircraft it weighed. **AND THE BOX HAD NEVER BEEN WIRED**: the
    sheet model carried `reg` all along while the markup hardcoded an empty
    cell, so setting it changed nothing until the test that asserted it failed.
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

## MASS & BALANCE, THE OTHER HALF OF THE FORM (v16.93, roadmap item 5 - PHASE A)

**THIS SUPERSEDES "Mass & Balance: WAS out of scope".** That entry said M&B
stayed in the user's Excel sheet; v16.28 already downgraded it to "roadmap item
5, nothing built, needs the real sheet and the POH arms and limits in hand
first". Both halves of that precondition are now met: `OFP-C182.xlsx` is
committed beside `C182OFPMBv4.2.pdf`, and the planner already computes the one
number the spreadsheet cannot get for itself - the fuel actually burned on each
sector.

**PHASE A IS THE PURE MODULE AND NOTHING ELSE.** `src/lib/massbalance.js`, the
fleet, the types and 18 tests. No UI, no wiring, no fuel capture: the app still
shows no M&B. Phases B (per-sector fuel capture) and C (the tab, the envelope
SVG, the banner) follow.

### TWO SOURCES, AND THEY AGREE - which is what makes this importable at all

Every constant is in BOTH the printed form and the live workbook, independently:
the station arms (37 / 37 / 74 / 46.5 / 97 / 116 / 129 in), all TEN fleet
figures for LN-TRA..LN-TRE, and the Va table (3100->110, 2600->101, 2100->91).
The form carries `Version date 10.08.2026`, which is what `FLEET_SOURCE`
records - the WORKBOOK states no revision date anywhere, and its document
`modified` property is just when it was uploaded, so using that would have been
a provenance figure that means nothing.

- **THE GOLDEN FIXTURE REPRODUCES THE WORKBOOK CELL FOR CELL**, including the
  digits Excel itself carries: take-off 2582.3 lb / 40.2 in / 103700.6,
  landing 2378.3 / **39.61426228818904** / 94214.6, zero-fuel 2198.3 /
  **39.05044807351135** / 85844.6.
- **AND AN INDEPENDENT CROSS-CHECK FELL OUT OF IT.** `Performance!W1:X3` draws
  the MLW line as arm 39 -> 46 at 2950 lb, in a different block of the sheet
  from the envelope. The envelope's own width at 2950 is **39.05 to 46.00**. A
  mistranscribed vertex would have shown up here; it did not.
- **THE ARM IS NEVER ROUNDED IN THE MODULE, and that departs from the sheet on
  purpose.** `OFP!E11` rounds the take-off arm to 0.1 in while `E14` and `E15`
  leave landing and zero-fuel at full precision. Rounding one of three
  identical calculations is an inconsistency, not a rule, so all three are
  exact and the DISPLAY rounds - which still prints every figure the sheet
  prints.

### CHECKING THE TWO ENDS IS ENOUGH, AND IT IS A PROOF - BUT THE SWEEP THAT "PROVED" IT WAS BLIND

Burning fuel is a STRAIGHT LINE in (moment, weight): weight falls a pound per
pound, moment falls 46.5 per pound. The envelope is CONVEX in that same space -
forward slopes **33.00 -> 46.12 -> 51.72 -> 70.90 -> 81.30**, non-decreasing
across both joins, and the aft boundary is the straight `moment = 46 * weight`.
A segment between two points of a convex set stays inside, so two legal
endpoints mean a legal path and there is no interior case to search for.

- **THE FIRST VERSION OF THE PATH SWEEP COULD NOT SEE A NON-CONVEX ENVELOPE.**
  Mutated with a dent at the 2700 lb vertex it reported **0 violations over
  407 824 paths** - looking exactly like a guard confirming correct code.
- **THE REASON IS ARITHMETIC, NOT COVERAGE.** A fuel path's slope is fixed at
  46.5, so it can only leave through the forward boundary where the boundary's
  OWN slope brackets 46.5 - which on this envelope is across the **2225 lb
  vertex** (33.00 -> 46.12) and nowhere else. The sweep started from a
  zero-fuel grid and never put an endpoint there.
- Rewritten to walk the TAKE-OFF point across the whole envelope it sweeps
  41 293 paths, 10 637 of them crossing that vertex, and a dent AT 2225 now
  fails it by name with **3199 violating points**.
- **SO NEITHER CHECK CARRIES THIS ALONE**, and the file should not pretend one
  does: the convexity assertion catches the 2700 dent, the path sweep catches
  the 2225 one, and both are mutated. This is M5 in its subtlest form - the
  sweep was not looser than its measurement, it was measuring in a place where
  the defect provably cannot appear.

### THE FIGURES THAT ARE NOT THE SHEET'S, EACH FOR A STATED REASON

- **Va COMES FROM THE POH TABLE, INTERPOLATED, NOT FROM `=110-(((3100-D14)*9)/500)`.**
  That formula is exact at 3100 and 2600 and gives **92 kt at 2100 where the
  table in the same workbook says 91** - one knot HIGH at the light end, which
  is the unsafe direction. The user's instruction was to use the table.
  - Va is read at the **landing** mass, as the sheet does, and that is right
    rather than incidental: Va falls with weight, so the lightest moment of the
    flight is the one that binds all of it.
  - **NULL BELOW 2100 lb rather than extrapolated.** That is below every
    aircraft's empty weight plus a pilot, so it is close to unreachable - and
    an invented Va is a speed a pilot writes on the form and flies to.
- **Vglide HAS NO POH TABLE BEHIND IT.** The form prints a `V GLIDE` box with
  nothing in it and the workbook fills it with a straight line. Reproduced and
  labelled the school's figure; it must never be presented as a POH value.
- **NO MAXIMUM BAGGAGE WEIGHT IS PUBLISHED IN EITHER SOURCE**, so none is
  checked. `BAGGAGE_MAX_LB` is `null` and a caution says the check is not
  performed. Reaching for the C182's usual 200 lb would read as a checked limit
  and be a guess - the exact plausible wrong answer this project refuses.
- **THE AUTOPILOT LIMIT IS AN INFERENCE, AND THE DATA ARGUES FOR IT.**
  `Performance!T1:U3` is a two-point line labelled `autopilot`: arm 34 at
  1800 lb and at 2400 lb. It stops at 2400 because **the standard forward limit
  reaches 34.03 in there** - the line is drawn exactly as far as it constrains
  anything. Shipped as a CAUTION naming its source, never as an out-of-limits
  finding, and it wants confirming against the autopilot supplement.
- **(SUPERSEDED at v16.97 - it is a default Baggage B LOAD now, visible and
  editable; see "THE STANDARD BAGGAGE IS A LOAD".) LN-TRE's 22.7 lb IS AIRFRAME, NOT BAGGAGE.** The user: "LNTRE is the only
  A/C where compartment B is not included in the total mass/arm". So it is
  added at the compartment B arm before any load, and an unloaded LN-TRE still
  carries it. The workbook adds it into the same cell the pilot types extra
  baggage into; here the two are kept apart, because one is a property of the
  machine and one is what got loaded.

### A FORWARD CG VIOLATION IS NOT REACHABLE ON THIS FLEET

Measured across all five aircraft with up to 500 lb in the front seats - the
only station forward of the empty arm - the closest any of them gets to the
forward limit is **LN-TRD at 37.67 in against a limit of 34.77, i.e. 2.9 in of
margin**. Every other station is at 74 in or further aft and the empty arms are
38.98-39.60.

So the forward branch is exercised against a HYPOTHETICAL airframe and the test
SAYS it is hypothetical. The alternative - a fixture quietly labelled LN-TRB
that cannot occur - is the v16.58 failure where a test asserted the broken case
as correct.

### MLW AT EVERY LANDING, AND A MASTER THAT WALKS

The user: "Check the landing weight / t&g weight for every stop". A mid-mission
refuel can make an EARLIER arrival the heavy one, so `worstLanding` is the
heaviest arrival anywhere, not the final one - and `computeMissionMassBalance`
takes `first` and `last` from the sector results themselves. Subtracting a
total burn from the ramp weight would print a weight the aircraft never has the
moment anyone refuels.

Taxi fuel is in the TAKE-OFF mass (the user's instruction), which is why
`MTOW_LB` doubling as the ramp limit is their explicit answer and not an
assumption: "Assume MTOW is max ramp".

### ONE FUEL DENSITY, AND PHASE B HAS TO FINISH THE JOB

`FUEL_LB_PER_GAL = 6.0` and `FUEL_KG_PER_GAL` is DERIVED from it. The app's
existing `convertFuel`/`toGal` still carry a separate `2.72` kg/gal against the
derived 2.72155 - 0.057% apart. Measured: unifying them moves **578 of 900**
tenth-gallon values by one 0.1 kg display step (64 gal 174.1 -> 174.2). Storage
is in gallons so nothing saved changes, but it is a visible change and it
belongs in Phase B with the fuel capture, not smuggled in here.

### PHASE B (v16.94): THE EXACT GALLONS, AND ONE FUEL DENSITY

Two things, and the second one found more than it was sent for.

**THE FUEL COLUMN IS UNCHANGED.** What is new is that the gallons behind it
now leave the render pass unrounded, on `ofpPrintModel[i].fuelGal = {dep, arr}` -
`dep` is what is on board at that sector's ENGINE START, `arr` what remains at
its arrival fix. Phase C reads those; nothing else does yet.

- **IT IS A SECOND TRACKER, AND THAT NEEDED ARGUING** against v16.61's "prefer
  the deletion to the second mechanism". It survives because the display is a
  ROUNDED RENDERING of it rather than a rival computation: both subtract the
  same per-row gallon figure (`legBurnGal`, `patternBurnGal`,
  `pendingStop.burnGal`), and two tests hold them together - the gap may never
  exceed what the rounding can explain (0.05 a row), and fuel must be
  CONTINUOUS across every sector boundary (`dep(k) === arr(k-1)`, adjusted by
  the stop). Measured on the two-sector seed: the gap is **0.0761 gal**, and a
  test pins that it stays in the rounding regime rather than drifting to the
  bound.
- **DERIVING THE DISPLAY FROM THE EXACT TRACKER WAS CONSIDERED AND DECLINED**,
  which would have deleted the second mechanism outright. The column is
  `F - sum(round(burn_i))` and deriving it would make it `round(F - sum(burn_i))` -
  a different number by up to 0.05 a leg, i.e. exactly the 0.0761 measured
  above. That is a visible change to the fuel column, and Phase B was asked for
  the M&B figures, not for the pilot's fuel column to move.
- **ABSENT STAYS ABSENT, AND `isNaN` COULD NEVER SEE IT.** `Number('') === 0`,
  so an empty Initial Fuel box is indistinguishable from a typed zero unless
  the RAW STRING is read - which it now is. The column still shows 0.0 for an
  empty box (it always has, and that is not being changed); the M&B figure
  stays `NaN`, so `massBalanceProblems` says "the fuel on board is not known"
  instead of weighing an aircraft with empty tanks. A typed 0 remains a real
  answer (v16.57).
- **TAXI IS INSIDE THE BURN, AND `dep` IS BEFORE IT.** "Count taxi fuel in
  takeoff mass" is the author's instruction and is why MTOW doubles as the ramp
  limit. Asserted by TAKING IT AWAY - the sector burn with taxi 1.7 minus the
  same sector at 0 must be exactly 1.7 - and a full stop re-arms it, so a
  two-sector mission carries 3.4. A leading circuit is also charged after
  `dep`, which is right: the laps are flown after start-up.

### THERE WERE THREE COPIES OF THE FUEL DENSITY, NOT TWO

The plan said "unify `convertFuel` and `toGal`". A grep for `toGal` found one
of them. The test written to assert no literal `2.72` survives **failed on its
first run** and named the third:

1. `convertFuel` in `format.js` (`* 2.72`),
2. the page's own `toGal` (`/ 2.72`),
3. **`setStopRefuel`** - the `⛽ Fuel after` box, converting a typed refuel back
   to gallons with its own inline `/ 2.72` and `/ 3.78541`,
4. **the unit switch** that rewrites Initial Fuel and Reserve when the pilot
   changes display units - a fourth inline copy of the same pair.

So a density changed in one place would have made the settings form silently
reinterpret a figure already written down. `toGallons` in `format.js` is now the
one exact inverse, all four sites call it, and a test asserts the round trip is
exact in every unit.

- **THE IMPORT GOES `format.js -> massbalance.js`**, and the direction is
  argued: a density is a POH/M&B fact, not a formatting one, and
  `massbalance.js` imports nothing so there is no cycle.
- **MEASURED COST**: 578 of the 901 tenth-gallon values between 0 and 90 gal
  move by one 0.1 kg display step (64 gal 174.1 -> 174.2, 87 gal 236.6 ->
  236.8), worst case 0.2 kg. **Nothing stored changes** - every fuel figure in
  this project is held in gallons - so it is a display change only, and it
  moves those displays towards the sheet the school actually uses. Litres are
  untouched.

**SEVEN MUTATIONS, ALL CAUGHT BY NAME, NONE ONLY IN `tsc`**: the leg burn never
reaching the tracker (3 tests), the refuel not reaching it (1), the inter-sector
circuit burn skipped (1), the tracker fed the ROUNDED DISPLAY figure instead of
gallons (3, one reporting `48.6 vs 59.9` under a litre display), `dep` captured
at the END of the sector (4), an empty box coerced to zero gallons (1), and
`convertFuel` back on its own 2.72 (1, reporting `round trip broken in KG`).

**AND THE FIRST ATTEMPT AT ONE OF THEM APPLIED AND CHANGED NOTHING** - again.
`const x = v` mutated to `let x = v; x = v` is a textual edit that assigns the
same value at the same point, so it reported `FAIL=0` and read exactly like a
guard that does not fire. The mutation that bites writes `dep: runningFuelGal`
into the push, which really does capture it at the wrong moment. Asserting that
the EDIT landed is not enough; the edit has to change the BEHAVIOUR.

**AND THE BLOCK PUTS THE SHARED FIXTURE BACK.** `T` runs immediately and `TA`
is queued to the end, so a `T` written at the bottom of the file still runs
BEFORE every async test - and these left a two-sector mission behind, which made
an unrelated plan-management test report `expected 3 flights, got 4`. That is
the v16.89 lesson (a check that mutates shared state is not free to sit
anywhere) arriving through the runner rather than through the browser.

### THE PERFORMANCE TABLES: THE WORKBOOK IS SHORT OF THE POH, NOT THE OTHER WAY ROUND

`OFP!O34` reads "TO/LDG dist limitations: Max pressure alt 5000ft, Max temp
40°C", and `CALC_TOD` is not merely undefined above 5000 ft but DANGEROUSLY
wrong: 3100 lb / 20 C gives 2595 ft at PA 5000 and **1730 ft at PA 6000** - the
required distance FALLS as conditions worsen, because the `FILTER` fallback of
8000 is not a row in the workbook's table so its distance reads 0.

**AND THE REASON IT IS NOT A ROW IS A TRANSCRIPTION GAP, WHICH IS THE OPPOSITE
OF WHAT THIS FILE FIRST SAID.** The entry used to read "the sheet declares the
boundary", which was true of the sheet and false of the aircraft: the author
supplied the printed POH pages (Figure 5-6 sheets 1-3) and **the POH tabulates
PA 0-8000 ft**. The workbook carries 0-5000. The 40 °C ceiling IS the POH's;
the 5000 ft one is the workbook's own.

- **TRANSCRIBED AND CROSS-CHECKED, NOT OCR'd AND HOPED FOR.**
  `tools/prepared/poh-takeoff.json` holds all three weights (2300 / 2700 /
  3100 lb) at PA 0-8000 and 0-40 °C, each cell a ground roll and a total to
  clear 50 ft. The workbook's `Performance!A:D` independently carries **90** of
  those cells, transcribed by the author from the same POH - and all **90 of 90
  agree exactly**. That agreement is what makes the PA 6000/7000/8000 rows,
  which exist ONLY in the snapshot, trustworthy read by the same method, and a
  test asserts it so neither side can drift.
- **THREE CELLS ARE DELETED IN THE POH AND MUST STAY REFUSED.** At 3100 lb:
  7000 ft/40 °C, 8000 ft/30 °C and 8000 ft/40 °C print `---`, and the POH says
  why - "climb performance after lift-off is less than 150 FPM at takeoff
  speed". They are `null`, not missing, and an interpolator that filled them in
  would state a distance the manufacturer declines to certify. The test pins
  exactly which three they are.
- **THE WORKBOOK'S WIND RULES REPRODUCE THE POH's NOTES**, checked rather than
  assumed: "+10% per 2 kt of tailwind, up to 10 kt" is the sheet's
  `(|W|/2)*0.1` with its `LIMIT` past -10, and "decrease 10% for each 9 knots
  headwind" is its "no corr. < 9kts". Grass is +15% of the GROUND ROLL, which
  is why the snapshot keeps both columns rather than only the 50 ft figure.
- **THE LANDING TABLE ARRIVED TOO, AND IT IS A DIFFERENT SHAPE.**
  `tools/prepared/poh-landing.json`, PA 0-8000 at 0-40 °C - so the workbook is
  short of the POH on BOTH tables by exactly the same three rows, which was
  guessed and is now measured. `Performance!F:H` independently carries 30 of
  those cells and **all 30 of 30 agree**.
  - **ONE WEIGHT, AND IT IS MLW.** The POH publishes the landing distance at
    2950 lb only - it is NOT a weight axis with a single row, and a future
    interpolator must never scale it. The author said so outright ("note there
    is only 1 weight which is the MLW"), and the reasoning is worth keeping:
    a lighter aeroplane lands SHORTER, so the 2950 lb figure errs long for any
    legal landing weight, which is the safe direction and is presumably why one
    table suffices. The TAKEOFF tables do carry three weights, so a shared
    interpolator that assumed a weight axis here would silently invent one.
  - **A THIRD INDEPENDENT STATEMENT OF MLW.** 2950 lb is what
    `Performance!W1:X3` draws as the MLW line, what the author stated, and what
    this page is titled. A test asserts the snapshot's weight equals
    `massbalance.js`'s `MLW_LB`, so the two cannot drift apart.
  - **THE GRASS CORRECTION IS 45% ON LANDING AND 15% ON TAKEOFF** - near-identical
    wording, different number, which is this file's first named failure shape
    waiting to happen. The corrections live with their own table, a test asserts
    the two strings differ, and a fourth asserts the WIND corrections are
    identical, so that sameness is deliberate rather than a copy-paste. Landing
    also carries a flaps-up penalty (+10 KIAS approach, +40% distance) that
    takeoff has no equivalent of.
  - **NOTHING IS DELETED HERE**, unlike the 3100 lb takeoff table: a landing
    needs no climb performance, so there is no condition the POH declines to
    publish. Asserted, so a null appearing later is a finding rather than noise.
  - FOUR MUTATIONS, ALL CAUGHT BY NAME: a wrong digit inside the overlap (the
    workbook), one outside it at PA 7000 (monotonicity), the weight moved off
    MLW, and the takeoff grass figure copy-pasted onto landing.
- **DATA ONLY: NOTHING READS THE SNAPSHOT.** It is committed now because the
  source was a set of screenshots and the cross-check is cheap once and
  expensive to redo. The consumer is Phase D, which is neither built nor
  approved.

**THE FIRST VERSION OF THAT TEST NEVER OPENED THE WORKBOOK.** Its comment said
the 90-cell agreement was asserted; it compared the snapshot with itself and
passed. That is the v16.88 vacuous-comparison failure verbatim - *a comparison
against a value that is not there proves nothing in either direction* - and it
got written because the suite had no way to read an `.xlsx` and I let the
comment stand in for the check. It needs no dependency: an `.xlsx` is a ZIP of
XML and `zlib` is built in, so `xlsxSheet()` resolves the sheet BY NAME through
the workbook relationships (never by guessing `sheet2.xml`, which is file order
rather than tab order) and reads the numeric cells directly.

**THREE MUTATIONS, ALL CAUGHT BY NAME, AND EACH THROUGH A DIFFERENT GUARD** -
which is the point, because the three guards cover different parts of the table:
a misread digit INSIDE the overlap (`snapshot 1990, workbook 1890`) is caught by
the workbook; one OUTSIDE it at PA 7000, where nothing can corroborate, is
caught by monotonicity in pressure altitude; and a deleted cell filled in with a
plausible number is caught by the pinned list of exactly which three are refused.

**AND THE FIRST ATTEMPT AT ALL THREE SILENTLY DID NOTHING.** The snapshot is
pretty-printed JSON, so `sed 's/\[980,1890\]/.../'` matched no text and every
run came back `FAIL=0` - looking exactly like three guards that do not fire, an
hour after this file recorded that same trap in the v16.93 entry below. The
mutations now edit the PARSED JSON and assert the value actually changed before
the suite is believed.

### NO PERSON IS NAMED, AND A TEST GREPS FOR IT

The workbook's document properties carry an author. A registration identifies a
MACHINE, which the user has explicitly cleared ("Aircraft registrations and
their data can be stored. Theres no privacy issue there"), and that is where it
stops. The crew block on the printed form stays a box for a pen.

### SEVEN MUTATIONS, ALL CAUGHT BY NAME, NONE ONLY IN `tsc`

Envelope dented at 2700 (4 tests) and at 2225 (4, including the rewritten
sweep); Va from the sheet's formula (1, reporting `Va at 2100: 92`); the fixed
extra at the baggage A arm (1); `worstLanding` as the last sector (1); an absent
figure coerced to 0 (1); and the arm rounded inside `point()` (1, reporting the
landing arm as 39.6).

**AND ONE "MUTATION" NEVER APPLIED, REPORTING `FAIL=0`** - a `sed` expression
whose `||` broke the substitution. A mutation that does not land looks exactly
like a guard that does not fire, which is the `grep | head` lesson from v16.62
in a new costume: assert the edit was made before believing the run.

### PHASE C (v16.95): THE TAB, THE CHART, AND THE PAPER

The author's words: *"a user-friendly tab separate from the flight plan tab for
inputting weights, registration, etc. It will show the values, the CG-limit
chart (with correct values), fuel, metar/taf for departure/arrival with takeoff
and landing distances"*, and *"a single toggle option to have m&b sheet
calculated for EVERY plan ... AND the option for the M&B sheet to only show the
W&B and fuel planning for the whole plan"*.

The sidebar has two panes now, `✈ Flight plan` and `⚖ Mass & Balance`
(`showSidePane`, section 2h of the page). Everything that was in the sidebar
is the plan pane, unmoved. The engine is still `massbalance.js`; the tab is a
shell around it.

- **THE FUEL IS THE PLAN'S, NEVER A SECOND NUMBER.** `buildMassBalanceMission`
  reads `ofpPrintModel[i].fuelGal` - the unrounded gallons Phase B captured - so
  the sheet cannot disagree with the fuel column beside it. Mutated to re-round
  them to 0.1 first, a test fails by name.
- **FINDINGS REACH THE BANNER AND THE PAPER**, through the SAME list
  (`collectIntegrityProblems` concatenates `massBalanceProblems`), so an
  out-of-limits load raises the red banner and prints the DO NOT USE band on the
  M&B page as well as the OFP - there is no second place for a finding to live.
- **ONLY ONCE A TAIL IS CHOSEN.** With no registration there is nothing to be
  wrong about, and a banner on every plan reading "no aircraft selected" is
  noise a pilot learns to scroll past, which is how a real finding gets missed.
  Mutated to always check, EIGHT unrelated tests fail - every clean-plan test in
  the suite - which is the noise, measured.
- **THE TOGGLE CHANGES WHAT IS SHOWN, NEVER WHAT IS CHECKED.** "Check the
  landing weight / t&g weight for every stop" is the author's rule, so the
  whole-mission view cannot become a way to miss a heavy intermediate landing.
  The test compares the findings in both views, and first asserts its fixture IS
  out of limits - otherwise equal-and-empty would pass.
- **THE M&B INPUTS ARE STORED BUT NOT EXPORTED** - see the PROFILE_KEYS entry.
- **THE CG CHART NEVER CLIPS A MARK.** `cgChartModel` (pure) draws the envelope,
  the autopilot line and the MLW line, and its axes EXPAND to hold every point:
  a chart that clipped the one point that is out of limits would hide the only
  thing it exists to show.
- **WEATHER IS DECODED ONCE, FOR TWO HOSTS.** `renderMetarCard` takes a host
  id, and the last fetch is kept in memory only (`lastWeather`, never
  persisted - a cached METAR is a wrong METAR), so the tab shows the same
  decoded reports as the plan card without a second fetch or a second decoder.
- **(SUPERSEDED at v16.96 - phase D built them.) THE DISTANCES ARE NOT BUILT, AND THE TAB SAYS SO.** The author asked for
  them here. The POH tables are committed; reading them needs a per-runway
  pressure altitude, wind component, surface and TODA/LDA, and the AIP importer
  reads no runway data. A tab with no distances and no word about it reads as
  "no limitation", so a card says they are not computed and points at the POH.
  **IT NAMES NO FIGURE NUMBER FOR THE LANDING TABLE**, because the page as
  supplied carries only its title - I wrote "5-12" from memory first, and the
  snapshot does not say so. A test guards both halves.

#### THE WHOLE-MISSION MASTER WAS WRONG FOUR WAYS, AND ALL FOUR WERE SILENT ON ONE SECTOR

The first version assembled the master from `first` and `last` in the page.
Found while writing this entry, not by a test - none covered it:

1. **THE BURN** was `first.dep - last.arr` on screen, and the FIRST SECTOR'S
   burn on paper, under a heading that said "whole mission". So the printed
   take-off minus consumed did not equal the printed landing, and with an uplift
   the screen could print a NEGATIVE consumption.
2. **THE CHECKS** were the first take-off's and the last landing's, so a heavy
   take-off after a mid-mission refuel could print a green master while the
   banner was red.
3. **Va** came from the last landing. Va falls with weight and the LIGHTEST
   landing binds it (the v16.93 rule), which a refuel can move mid-mission.
4. **Min FLT** came from the first take-off, where the heaviest one binds.

`missionMaster(m)` in the engine builds it ONCE, for the screen and the paper
alike, and `computeMissionMassBalance` now WALKS the fuel into two figures:
`consumedGal` (burned in the sectors, taxi included) and `stopChangeGal` (the
NET change at the stops). It is net on purpose: a refuel is entered as the fuel
AFTER, so the split between uplift and circuit minutes is not something the plan
states, and inventing one would be a guess. `dep - consumed + stopChange === arr`
exactly, and the printed master carries a `Fuel change at stops` row so the page
adds up. It is the v16.93 "a master walks, it does not subtract" rule, which the
ENGINE followed for weights and the PAGE broke for fuel - this file's first
named failure shape again.

#### THE TAB STRIP COST THE FOLD, AND THE FIRST FIX HID A SECOND REGRESSION

- **`verify:layout` CAUGHT IT**: the strip put the daylight card at 425 px into
  424 visible at 1280x720, undoing v16.49's QoL 4. A smaller strip in the
  short-window block got it to 416 - and that 416 was a LIE, because:
- **THE PANE WRAPPER HAD COLLAPSED THE CARD SPACING.** `#sidebar` spaces its
  cards with a flex `gap`; inside `#pane-plan` they were no longer its children,
  so they went from 14 px apart to 4. That silently SAVED space, which is why
  the fold check passed. `verify:visual` is what showed it: 317 k pixels
  differed, and a pure-shift test failed (222 k still differ at the best
  offset), so it was a REFLOW rather than a move. Card positions against v16.94
  then named it.
- **`display: contents` ON THE PANES** gives the old box tree back, so the
  sidebar's own gap reaches every card in every skin with no second copy of the
  number. Measured against v16.94 in all four skins at 1500x950 and 1280x720:
  card gaps and heights IDENTICAL. The panes carry no ARIA role, so there is no
  semantics for `contents` to drop.
- **THAT PUT THE CARD BACK OVER THE FOLD (440/424)**, and the strip is now
  ATTACHED rather than floating - flush to the sidebar top and 1 px over the
  first card's border, which is what the styling always meant (the active tab's
  bottom border is card-coloured, only its top corners round). Its margins are
  `var(--sb-pad)` / `var(--sb-gap)`, which `#sidebar` and every skin now spacing
  itself BY, so the attachment is exact in each without restating a pixel.
  Result: **420 px into 424**. v16.94 had 410; ten pixels is what the strip
  costs, and 4 px of slack is what is left.
- **A SHORT-WINDOW RULE MUST SIT BELOW WHAT IT OVERRIDES** - the v16.49 `.card`
  trap. Proved rather than asserted: the same rule placed in the earlier media
  block reproduces 425/424 exactly.
- **THE MENU SKIN'S `display: revert` BROKE BOTH NEW ELEMENTS**, because
  `revert` is the BROWSER'S default and not the stylesheet's. Measured with the
  fix removed: card gaps 488/82/69 -> 458/72/59, and the tabs shrank to 90 and
  119 px of a 538 px strip instead of 267 each. My comment first said the tabs
  "stacked vertically"; measuring showed they stay on one row as inline buttons
  and only the width is lost, and the comment says that now.
- **FINAL PIXELS vs v16.94**, identical in light and dark: 58 px in an 8x8 box at
  x 300-307, y 19-26 (the version badge, nit 13); the MAP 0 px; the sidebar below
  the strip 0 px once shifted 16 px. The tab strip itself is the only new ink.

#### THE REG BOX HAD NEVER BEEN WIRED

Filling Reg from the selected tail (see the OFP-form entry) changed nothing at
first: the sheet model has carried `reg` since v16.41 while the markup
hardcoded `<td></td>`. The updated privacy test is what failed. A value that
has never been anything but empty is a value nobody ever checked reaches the
page. `verify:ofp` now measures it in its box: `LN-TRA`, 119 px in 119.

#### `verify:ofp` HAD A CHECK WHOSE PREMISE EXPIRED

"The Mass & Balance side is left out, not half-built" kept PASSING - because a
fresh browser has no tail chosen, so no M&B page prints. A check that passes
for an expired reason is the v16.56 failure. It is replaced by both directions
(absent with no tail, present with one), the DO NOT USE band on every M&B sheet
of a broken plan, and the cell-fit and page-width measurements that are the
reason this verifier exists - including the whole-mission sheet with a refuel,
whose stop row is the longest label on the page: 0 cells overflow, 1400 in 1400.

#### FIFTEEN MUTATIONS, ALL CAUGHT BY NAME, NONE ONLY IN `tsc`

Chart axes not expanding (1); loads trusted (1); an unknown tail accepted (1);
fuel re-rounded (1); findings off the banner (2, one of them the fixture's own
discrimination guard); the banner nagging with no tail (8); the mission view
narrowing the checks (1); the reg and loads in PROFILE_KEYS (3); the Reg box
ignoring the tail (1); master burn as dep minus arr (2, printing
`consumed -85.4`); master checks from the first sector (1); Va from the last
landing (1); Min FLT from the first take-off (1); the printed burn as dep minus
arr (1); the stop row omitted (1). Plus three CSS mutations against the real
browser: the short-window strip rule removed, and moved above the base rules -
both reproduce `425 px into 424` exactly - and the Menu reveal fix removed,
which reproduces the collapsed gaps and the shrunken tabs quoted above.

**MY OWN MUTATION HARNESS REPORTED THE FIRST ONE AS NOT CAUGHT.** It grepped
`^FAIL`, and a failing test prints `  FAIL  ` indented. The guard had fired; the
harness could not see it. Probing the mutated function directly before
believing "not caught" is what exposed it - the v16.93 lesson that a mutation
run has to be checked for having measured anything, applied to the measuring.

### PHASE D (v16.96): RUNWAYS FROM THE AIP, AND THE DISTANCE AGAINST THEM

The author: *"import the runway distances from the AIP and add them to the
importer, and doing phase D"*. Two parts, and each has a pure module.

#### THE IMPORT (`tools/aip-runways.mjs`, wired into `build-aip.mjs`)

Every aerodrome record in `data/aip.js` now carries `runways`: length × width
and surface from AD 2.12, each end's TRUE bearing, TORA/ASDA/TODA/LDA from AD
2.13, and the intersection take-off positions. Measured at 2026-09-03: **53 of
53 aerodromes, 112 runway ends, 120 positions, 0 refused.** Read off the AD 2
pages the airspace build already fetches - no new request.

- **AD 2.12 IS TAGGED; AD 2.13 IS HALF TAGGED.** Every declared distance is a
  `TRWY_DIRECTION_DECL_DIST;VAL_DIST`, but WHICH distance it is lives only in
  the table column. So each table's own header names its columns, and nothing
  is assigned by position. Two measured reasons:
  1. **AVINOR'S ORDER IS TORA | ASDA | TODA | LDA**, not the textbook TORA |
     TODA | ASDA | LDA. Assuming the textbook swaps TODA and ASDA silently -
     and the school's own workbook did exactly that (see below).
  2. **ROWSPAN AND COLSPAN, at 20 of 53 aerodromes.** In the intersection
     table the RWY cell spans its positions, so the next row has one cell fewer
     and every figure shifts left. `tableGrid` lays the table out the way the
     browser does.
- **READ BY SECTION, NEVER BY SCANNING THE PAGE.** AD 2.16 (helicopter landing
  area) publishes FATOs and TLOFs under the SAME `TRWY`/`TRWY_DIRECTION`
  markers. A whole-page scan made helipads into runways at four aerodromes
  (ENVA, ENKR, ENBO's 07W/25W, ENTC's 18N/36N).
- **THE CHECKS ARE THE ONES THAT ARE PHYSICALLY NECESSARY.** Each runway has
  two ends with reciprocal true bearings (±3°); TODA ≥ TORA and ASDA ≥ TORA,
  which a column that slid under the wrong header fails. **TORA ≤ runway
  length was tried and is FALSE**: AD 2.12's length is threshold to threshold,
  and ENAS declares TORA 868 m on an 808 m runway because the surface runs
  30 m past each threshold. My first reciprocal formula was also wrong
  (reported 180.04° as 179.96° off) - it refused every aerodrome, which is the
  failure mode that is at least loud.
- **THE INDEPENDENT CROSS-CHECK**: the workbook's `NavData` is the school's own
  transcription of the same AIP. **96 of 98 runway ends agree in all four
  distances**; the two are ENTO 18/36, which the AIP has since REDESIGNATED
  17/35 (identical TORA/ASDA/TODA, LDA 2449 → 2450). The sheet is stale there.
- **THE DATASET TESTS CANNOT SEE A PARSER CHANGE**, found by mutation: they read
  the shipped `data/aip.js`, which a parser edit does not rebuild, and the eAIP
  page cache is not committed. So every structural rule (header mapping, spans,
  sections, bearings, units) is ALSO held by a synthetic page in `test.js`.
  Mutating the section rule passed until that test existed.

#### THE ENGINE (`src/lib/rwyperf.js`)

**THE METHOD IS THE SCHOOL'S, CELL BY CELL** (`CALC_TOD`, `CALC_LDG`,
OFP!J24:V32). Trilinear interpolation over the POH grid, the 50 ft TOTAL, wind
correction, braking action (6/5 ×1, 4 ×1.1, 3 ×1.2, 2 ×1.5, 1 ×2, 0 prohibited),
then ×1.25 take-off and ×1.43 landing. PA = elevation + 27 × (1013 − QNH).
Headwind earns nothing under 9 kt, then 10% per 9 kt; tailwind +10% per 2 kt to
10 kt. **It reproduces the workbook's worked example read out of the sheet:
1052 / 1365 ft uncorrected, 401 / 595 m required** (OFP!O31, V31).

The tables are imported straight from `tools/prepared/poh-*.json`
(`import ... with { type: 'json' }`), so the cross-checked snapshot IS what the
app uses - no second copy. Verified to work in bare-Node `require()`, esbuild
and `tsc` before relying on it.

**FIVE DEPARTURES FROM THE WORKBOOK, each because it is wrong there or the
author decided:**

1. **THE RUNWAY DIRECTION IS TRUE.** METAR wind is TRUE (Annex 3). NavData's
   headings are MAGNETIC (ENDU 10 → 099 where the AIP says 109.01 true), and the
   sheet subtracts one from the other, so its components are off by the local
   variation - 10-16° across Northern Norway.
2. **THE TAKE-OFF IS CHECKED AGAINST TODA** (the author's choice). The sheet's
   cell is LABELLED TODA and reads the ASDA column - the textbook-order trap
   again. Equal at ENDU; ENBR 17 is 2826 vs 3119.
3. **A VRB WIND IS A TAILWIND ON BOTH ENDS** (the author's choice). The sheet
   gives take-off no correction and landing the full speed from behind.
4. **ABOVE THE TABLE IS REFUSED**, never extrapolated - the sheet's fallback made
   PA 6000 shorter than PA 5000. Below it clamps to the lowest row, which the
   sheet also does and which errs long. A POH-DELETED cell, and anything
   interpolated from one, is refused.
5. **THE REQUIRED FIGURE ROUNDS UP**, not to the nearest. It is a requirement.

**THREE KINDS OF "NO FIGURE", AND ONLY ONE IS A FINDING.** `refusedKind`: a
LIMIT (tailwind past 10 kt, above the table, deleted cell, braking 0) goes to
the red banner; an INPUT not yet given does not - that is the pilot not having
got there; a SURFACE the POH does not correct is stated and not a finding (ENAS
is GRAVEL - the POH corrects for dry grass only, 15% take-off and 45% landing
of the GROUND ROLL; no grass runway exists in this edition).

#### THE TAB, THE BANNER, THE PAPER

- Every sector's departure and arrival is resolved to an aerodrome by the
  PAGE's existing `aerodromeAt(wp)` - the one a full stop already uses (5 NM,
  nearest ARP) - and checked against the runway end the pilot picks. The
  default is the end into wind. ~~A take-off can pick any published
  intersection, which carries its own TODA~~ - REMOVED at v16.98: the school
  takes off at full length, always, including after a touch & go.
- **INPUTS ARE SESSION-ONLY.** Wind, QNH, OAT, braking and the runway choice are
  the day's; a QNH remembered from yesterday is a wrong QNH (the v16.3 date
  rule). They prefill from the fetched METAR - labelled with the report's time
  and AGE, and "NOT CURRENT" past 90 minutes - and any box can be typed over.
  An EMPTY box means "use the METAR", never 0: a blank QNH read as 0 hPa is a
  27 000 ft aerodrome, and mutating that fails a test by name.
- The card's wind field says it wants TRUE, because a tower or ATIS wind is
  magnetic.
- Findings reach the banner and the printed M&B sheet, once a tail is chosen
  (the v16.95 rule). Each printed sheet carries a distance table for its own
  sector, or every sector on the whole-mission sheet; a figure that was not
  computed prints as a sentence saying why, never as a blank. `verify:ofp`
  measures a computed row with the longest position name ("RWY SFC start 10"):
  0 cells overflow. (Since v16.98 no position name is written - see there.)

#### A PAGE FUNCTION SILENTLY SHADOWED MY EXPORT

The module exported `aerodromeAt(lat, lng, aerodromes)`. The page script
already had `function aerodromeAt(wp)`, and a page-level function declaration
REPLACES the bundle's global of the same name - nothing throws, the export just
never runs. Every check came back "not at a published aerodrome" while the
module passed its own tests in Node. The duplicate is deleted (one resolver, not
two) and **a test now requires that no page function shares a name with any
bundle export**: there were none before this, so it can demand zero. Its first
mutation died in `tsc` (an untyped parameter) and proved nothing; the second,
typed, fails by name.

#### THE GUIDE HAD BEEN WRONG SINCE v16.95

It still said "the Mass & Balance side of the form is not reproduced yet". Phase
C shipped without updating it. It now describes the M&B page, the distance
method, all four deliberate departures a pilot would notice, and what is not
stored.

#### MUTATIONS, ALL CAUGHT BY NAME, NONE ONLY IN `tsc`

Importer: whole page instead of the section; columns by position; rowspan not
carried; reciprocal check off (4). Engine: extrapolate above the table; headwind
credit under 9 kt; VRB as calm; round to nearest; a deleted cell read as 0 (5).
Wiring: take-off against ASDA (reports `2826 - TODA is 3119`); distances off
the banner; an empty box read as 0; the banner with no tail; the distances left
off the paper (5). Plus the shadowing guard (1).

## THE PRINTOUT IS THE SCHOOL'S FORM, AND THE TAB LOOKS LIKE ITS PAGE 2 (v16.97)

The author, on v16.96: *"The printed OFP HAS to be IDENTICAL to the
C182OFPMBv4.2.pdf!!! Not a single pixel should differ, that goes for the flight
plan sheet as well!"*, *"the standard baggage weights in the aircrafts should
always be present (7.3 lbs in comp A, 0.7 lbs in comp C and LNTRE has 22.7 lbs
in comp B)"*, and *"make it have a modernized resemblance of the MB sheet. The
CG graph needs to look better, it has to have a grid..."* - plus a pointer to
`1ntray/flight_planner` for comparison, and the procedural one: **ALWAYS check
main before opening a PR** (PR #100 had merged before phase D was pushed; phase
D was rebased onto main and goes out with this in a new PR).

### THE FORM IS NOT REDRAWN - IT IS EMBEDDED

**THIS SUPERSEDES "The company OFP form as the print output (v16.41)"** and the
v16.95 `mbPrintHTML` page. Those rebuilt the form in HTML from measured column
widths; however well measured, a copy is a copy. The friend's planner showed the
way: it fills the official blank PDF with **pdf-lib**. `src/lib/ofppdf.js` now
embeds both pages of `C182OFPMBv4.2.pdf` UNCHANGED (one form XObject per page,
drawn at identity on every sheet) and writes the figures on top.

- **PROVED BY PIXELS, the only way the claim can be proved.** `verify:ofp`
  renders with pdf.js at 150 dpi: a sheet with nothing written on it differs
  from the form by **0 pixels on both pages** (also 0 at 300 dpi, measured by
  hand), and on a worst-case plan (19 legs, the longest reporting-point names,
  ACC Dist past 1000 NM, both aerodrome and distance blocks filled) **every
  changed pixel lies inside a box the planner wrote into** - 228 146 changed,
  0 outside. The form's page is **US Letter landscape, 792 x 612 pt** (its own
  MediaBox, not A4 as v16.41 assumed), and the PDF keeps it.
- **ONE DELIBERATE DIFFERENCE, AND IT IS NOT FORM ARTWORK.** The form has a stray
  "0" printed in the landing H-Wind box - a value left by the workbook it was
  printed from. It is covered (the glyph's box plus half a point, inside the
  cell) ONLY when a landing headwind is written there. `PREPRINTED_ZERO`; a test
  pins its size and its condition.
- **THE GEOMETRY IS MEASURED, AND A TEST HOLDS IT TO THE MEASUREMENT.** Page 1's
  rules are vector paths; page 2 is six 600 dpi raster strips with text over
  them, so no rule is in the content stream. `tools/measure-ofp-form.mjs`
  renders both pages at 4x in Chromium and detects runs of ink, writing
  `tools/prepared/ofp-form-rules.json` (committed, like the border). A test
  requires every box edge in `ofppdf.js` to sit on one of those rules; the only
  exceptions are named with their reason (two free-paper labels, and the Reg box,
  which starts after its printed label and under a filled bar).
  - **MY FIRST RULE DETECTOR LOST TWO RULES**, and the reason is worth keeping:
    the merge of adjacent pixel runs assigned the run's extent in VISITING order,
    producing rules of zero and negative thickness that a `t > 0` filter then
    dropped - the ALT/OAT separator and a dest-block edge. min/max fixed it.
  - **THE CG CHART IS PLOTTED ON THE FORM'S OWN AXES.** Calibrated off its
    gridlines (x = 55.45 + 10.59·(arm−30), y = 66.80 + 0.13179·(lb−1800)) and
    checked against the envelope the form prints: arm 46 lands on the aft-limit
    rule at 224.88, 3100 lb on the MTOW rule at 238.13, 2950 lb on the MLW rule
    at 218.38. A point off the paper chart is pinned to its edge and says so.
- **FIGURES SHRINK TO FIT, NEVER CLIP** - the friend's rule: 7 pt down in
  quarter points to 4.5 pt, and anything still too wide is REPORTED (a toast
  names it) rather than silently truncated. The worst case needs none.
- **PAGE 2 USES THE FORM'S DECIMAL COMMA** ("46,5" is printed; "2582.3" beside
  it would read as another convention). Page 1 keeps the screen's strings (the
  v16.41 one-computation rule), and the form prints no figures of its own there.
- **WHAT PAGE 2 LEAVES FOR THE PEN**, each for a reason: alternate, contingency
  and extra fuel and so **the total required** (no alternate is planned; a total
  without it would state a requirement that is too low), MSA and MDA (no
  terrain), max crosswind (no published figure here), runway state, the minima
  tables, the signatures, and the station arms the form already prints (only the
  empty, take-off and landing arms are written). Trip fuel is the sector's burn
  incl. taxi; final reserve and endurance are timed at ~~the cruise level's POH
  fuel flow~~ 12 gal/h since v16.98 (OFP!P4, the author); D. Alt is the workbook's own formula (`densityAltitudeFt`, OFP!P19).
- **THE WHOLE-MISSION MASTER ADDS UP ON PAPER**: the form has no "fuel at stops"
  line, so the net change ~~goes on its **Last Minute Change** line~~ is stated
  beside the title (v16.98: the LMC line is the preflight fuel against the
  planned, and nothing else). T/O − consumed + that = landing, asserted from the page.
- **THE ORDER IS THE PAPER'S**: a sector's OFP sheet(s) then its M&B page, as the
  double-sided form is used; the mission view prints every OFP then one master.

### PRINTING IS A PDF IN A NEW TAB

`Print / preview OFP` (and **Ctrl+P**, bound by default because the browser's
Ctrl+P used to print the OFP) opens the PDF in a new tab - opened synchronously
inside the click and filled when ready, or a blocked popup falls back to a
download. The browser's own File > Print shows only `#print-note`, a line saying
where the OFP is, so nothing that could be mistaken for company paperwork prints
from the app screen. `verify:ofp` clicks the real button and reads the PDF out
of the new tab.

- **THE BANNER STILL REACHES THE PAPER (v16.43)**: a black DO NOT USE band in the
  empty top margin of every page, asserted on the real PDF with pdf.js.
- **A RENDER THAT THREW PRINTS NOTHING (H1)**: `printModelReady` is cleared when
  a render starts and set only at its very end (after every card that can add a
  finding), and Print refuses while it is clear.
- **THE PRINT ASSETS ARE NOT THE SHELL.** pdf-lib is 525 KB minified, twice
  app.js, and the form is 2.6 MB of raster strips; both are needed only when
  printing. So they are separate files named by content hash
  (`print/pdf-lib-<sha8>.min.js`, `print/ofp-form-<sha8>.pdf`), announced to the
  page in two `<meta>` tags and to the worker by a stamped token, precached into
  their own cache-first `c182-print` cache (not fatal if it fails) and retired
  by name. An app release re-downloads neither; a new form is a new URL. The
  module takes pdf-lib as an ARGUMENT (the v16.16 rule), so Node tests run the
  real library.
- **THE LOCKED DEPLOY COPIES THEM IN PLAINTEXT**, the VAC argument again: the
  form is in this public repo and pdf-lib is on npm. The workflow requires
  exactly the two, a real PDF and a real pdf-lib header, and no app identifier
  in either.

### AND THE WORKER HAD NEVER BEEN VERSION-STAMPED (found wiring the print cache)

`verify:hosted` printed the shell cache as **`c182-shell-vdev`** - and so did the
v16.96 reference build. The build stamped `sw.__APP_VERSION__ || 'dev'` with
`String.replace`, which swaps the FIRST match only, and that literal is quoted in
the comment at the top of `sw.js` that explains the stamp. So the comment was
stamped and the code never was: every build shared one shell cache name, and no
release ever retired the previous shell (network-first kept content fresh, which
is why nothing looked wrong). The build now replaces every occurrence and FAILS
unless the declaration itself reads `const APP_VERSION = "<version>";`, and a
test reads the built worker. It is the "a check the wrong line satisfies is no
check" lesson - the placeholder-present test had been passing on the comment.

**THE MUTATIONS, 12, ALL CAUGHT BY NAME, NONE IN `tsc`**: baggage not defaulted
(2), the old entry not migrated (1), B counted in the empty mass (1), an arm
written over a printed one (1 - and it ESCAPED at first, because the fixture gave
those stations no arm to write; it carries them now), the band not drawn (1, on
the real PDF), the "0" always covered (1), printable before the render completes
(1), no shrink-to-fit (1), alternate fuel written (1), the chart's minor grid
dropped (1), a column edge moved 2 pt (1, by the rules snapshot), and M&B pages
after all OFPs (1).

### THE STANDARD BAGGAGE IS A LOAD, NOT PART OF THE EMPTY MASS

**THIS SUPERSEDES "LN-TRE's 22.7 lb IS AIRFRAME, NOT BAGGAGE" (v16.93).** The
workbook confirms the author: `OFP!D8 = 7.3`, `OFP!D10 = 0.7` (constants on every
aircraft) and `OFP!D9 = VLOOKUP(... 'AC REG'!D)`, which only LN-TRE fills
(22.7). They are the Baggage A/B/C cells themselves. `standardLoads(aircraft)`
returns them; **choosing a tail sets the three baggage lines to them** (seats are
untouched - who is aboard is not the machine's business); anything more is typed
over them, as the workbook's own note says to. `emptyMass` is now the published
line and nothing else, so the printed Basic Empty Mass matches the form's.
- **A SAVED LN-TRE LOAD KEEPS ITS 22.7 lb.** Before this the B box held only the
  extra; an entry with no `v: 2` gets 22.7 added to B once, so the weighed
  aircraft does not change by a pound. A test loads an old-shape entry twice.

### THE TAB (a modern resemblance of page 2)

Tail chips (five, one click; the chosen one clicked again clears it) over a
loading table that IS the form's table - its stations, order and arms - down to
the zero-fuel mass. Per sector: a status pill, three tiles (T/O, LDG, ZFM - the
number big, what it is measured against beside it, a weight gauge against
MTOW/MLW and a dot on the CG window), chips for fuel, burn, V<sub>A</sub>,
V<sub>GLIDE</sub> and Min FLT, and the chart.

- **THE CHART IS GRIDDED AND LABELLED** (the author's request, and the one
  criticism reviews make of Garmin Pilot's envelope): a major line every inch and
  100 lb, a minor every half inch and 50 lb, the frame on a gridline, MTOW and
  MLW labelled on their lines, axes titled, the fuel-burn line from take-off to
  landing drawn. **Three points, three colours AND three shapes** (T/O circle,
  LDG triangle, ZFM square), the same on the tiles, the legend and the printed
  form (`MARK_STYLE`), so a black-and-white print or a colour-blind reader still
  tells them apart. Out of limits is ringed in red, as ForeFlight marks it.
- Every colour is a `--mb-*` token defined for light and dark; figures use
  tabular numerals so columns line up.

### THE COMPARISON WITH 1ntray/flight_planner, and what was taken

Taken: filling the official PDF with pdf-lib at measured coordinates, and
shrink-to-fit type. Already here in another form: fail-closed performance
(`refusedKind`), the minimum-flight time, a versioned local store. Not taken:
their M&B has no CG envelope at all (only MTOM/MLM/baggage), and their nomogram
digitisation is specific to the Z242L AFM - the C182 POH is tabulated, so
interpolation of the table is the authoritative method here.

## ATS OPENING HOURS BUILT, NOTAMs REFUSED (v17.0, roadmap item 20)

The author: *"Lets do the ATS opening hours and NOTAMs"*. The v16.93 plan said
to answer two questions before drawing anything. Both were answered by
measurement, and they came out opposite ways.

### THE HOURS ARE NOT IN THE eAIP - AD 2.3 POINTS ELSEWHERE

Checked on the cached AD 2 pages first, as the plan said: **49 of 53 AD 2.3
"ATS" rows read "REF AIS Portal www.avinor.no/ais"**, 4 read NIL, and only ENVA
states anything itself ("H24"). No hours are tagged anywhere. So "read AD 2.3
from the pages we already fetch" was a dead end, and saying so first saved a
parser for data that does not exist.

The portal's own "Operational hours" link is **aim-prod.avinor.no/no/
OperationalHours** - Avinor's publication, on the same AIM host as the eAIP,
stating "Revised per AIRAC 03 SEP 2026". That is what is imported.

- **ONE `<tbody id="<ICAO>_ATS">` PER AERODROME**, so rows are identified by the
  source's own ids, never by position (tools/aip-hours.mjs, pure).
- **THE TEXT IS STORED, NOT A DECODED SCHEDULE**: `aerodrome.ats = {hours,
  rmk}` in data/aip.js, and `src/lib/opshours.js` is the one reader, used by the
  planner and by the importer's report alike.
- **tools/build-hours.mjs** (`npm run build:hours`) writes the committed
  snapshot `tools/prepared/ats-hours.json` and patches ONLY the `ats` field of
  data/aip.js - asserted: everything else in the file is identical in content
  - and REFUSES unless the hours are revised for the dataset's own AIRAC cycle.
  `build-aip.mjs` attaches the snapshot on a future run under the same rule, and
  leaves the hours off with a warning when the cycles differ: a September AIP
  with October hours is two editions in one file.

### THE NOTATION IS READ STRICTLY, AND THE CROSS-CHECK IS THE SOURCE'S OWN

`DAYS: HHMM - HHMM (HHMM - HHMM) [/ ...]`, with `H24`, `No ATS provided`, `O/R`
and `NIL|CLSD|CLOSED` for a day. The figure outside the brackets is UTC with
reference to WINTER time, inside it SUMMER time - the page says so.

- **ALL 132 PAIRS IN THE TABLE ARE EXACTLY AN HOUR APART**, measured, so that is
  REQUIRED per period: a pair that is not means the text was not read the way it
  was written, and the aerodrome is refused rather than half-decoded. Every day
  must be stated exactly once too - a day the text does not mention is not a
  day the aerodrome is closed.
- **49 DECODED, 4 REFUSED AND SHOWN RAW, pinned per edition** like the ACC
  sector count: ENRY (hours by week number), ENOL (separate TWR and APP hours),
  ENAS (prose), ENHV (a published "13:30"). 37 schedules, 8 H24, 3 no ATS, 1 on
  request.
- **THE SEASON IS NORWAY'S CLOCK ON THAT INSTANT**, read from the platform's own
  Europe/Oslo rules (`norwaySeason`), not a last-Sunday rule written here. **THE
  DAY IS THE UTC DAY**, because the published times are UTC.
  - **AND THE SUITE COULD NOT SEE THE DAY.** It pins TZ=UTC, where the local and
    UTC weekday are the same, so a mutation reading the LOCAL day passed every
    test. A child process under Europe/Oslo now reads 2026-09-27 22:30Z (Monday
    00:30 local) and requires Sunday's hours. The v16.48 M3 lesson, again.

### THE CHECK

Every take-off and landing - each sector's ends, resolved by POSITION with the
runway checks' own `aerodromeAt`, at the daylight card's own instants (ETD on
the flight date plus `sectorTimeWindows`). A fly-by is not a movement there.

- **ONLY A DECODED "CLOSED" IS A BANNER FINDING** ("ENDU take-off at 2355 local
  (2155Z) is OUTSIDE the published ATS hours (SUN 0750-2130 UTC, summer
  time)"), which is the author's "a warning shall be issued". No ATS, on
  request, and refused text are SAID on the card: calling them closed would be a
  guess, and calling them open a worse one.
- **WITHOUT AN ETD NOTHING IS CHECKED**, and the card asks for one.
- **THE PUBLISHED TEXT AND ITS REMARK ARE ALWAYS SHOWN** - "OPS HR above are
  core hours, REF NOTAM for possible adjustments" is the line a pilot most needs
  to read - and a "Public HOL excluded" remark says so, because the planner does
  not know which dates are Norwegian public holidays and will not guess.

### NOTAMs: REFUSED, FOR THE REASON THIS PROJECT HAS REFUSED TWO SOURCES BEFORE

ippc.no was checked exactly as the plan said: CORS, authentication, API.

- **IT IS A SESSION WEB APP, NOT AN API**: JSP pages with a JSESSIONID, and the
  NOTAMs load through DWR (Direct Web Remoting) - `NotamInterface.getNotams`,
  POSTed to `/ippc/dwr/call/plaincall/...`, answering with JAVASCRIPT, and
  registered beside the site's login classes (`FplUserInfo`).
- **THE ANSWER CARRIES NO `Access-Control-Allow-Origin`** - checked on the page,
  on a preflight and on the DWR POST itself. A page on GitHub Pages is forbidden
  by the browser from reading it. That is aviationweather.gov's verdict (v16.21)
  on a different host.
- **A PROXY IS NOT A WORKAROUND HERE**: GitHub Pages serves static files, and a
  stale NOTAM is a wrong NOTAM, so it cannot be imported at build time either.
- So NOTHING is fetched, and the hours card says in words that NOTAMs are not
  fetched and to check ippc.no before flight. A NOTAM feature that silently
  fails is worse than none (the v16.93 rule).

### TEN MUTATIONS, ALL CAUGHT BY NAME, NONE ONLY IN `tsc`

The closing edge exclusive (1); the seasons swapped (2); the LOCAL day instead
of UTC (1 - escaped until the Europe/Oslo child process existed); no
summer-an-hour-earlier check (1); a missing day read as closed (1); undecodable
treated as closed (2); a closed take-off off the banner (1); the importer
reading the Admin table (1); the raw text not shown (1 - and the first version
of that test passed with the mutation, because the refusal REASON quotes the
same text; it reads the text's own element now); the arrival never checked (1).

## DELETING A STOP DELETES THE SECTOR IT OPENED (v17.4)

The author: *"whenever a waypoint that created a new flight plan (landing, t&g)
is deleted, make sure the subsequent flightplan is also deleted so that empty
flight plans wont pile up while editing the flight"*.

- **THE SECTOR IS FOUND, NOT REMEMBERED.** `sectorOpenedByStop` (exchange.js,
  pure) finds it from the plan: a stop opens the next plan DIRECTLY AFTER its
  own (`addNewFlightPlan(afterIdx)`, v16.59) and seeds its departure with the
  stop's own coordinates, or its circuit's, which sit on the same fix (v16.84).
  So it is the NEXT plan, starting EXACTLY on the stop, and only while the stop
  still ends its plan (only circuits after it). A plan added by hand somewhere
  else, or a stop with flying after it, is not reached. Storing a link would
  have been a second record of the same relation, and one more field for
  undo, import and the sanitiser to keep true.
- **AN EMPTY SECTOR GOES SILENTLY; A PLANNED ONE IS ASKED ABOUT.** "Empty" is
  `isStubSector`, the v17.1 test (at most one non-circuit waypoint). A sector
  where the pilot has already planned legs is their work, so they get **Delete
  both** / **Delete only <stop>** / Cancel. **Delete both** is the primary
  because it is what was asked for, and it is recoverable: either way the whole
  gesture is ONE undo step. That is the difference from v16.81's import
  collision, where the destructive answer was NOT the primary: that write could
  not be undone.
- **RULE 7 AFTER THE QUESTION**: both plans are found again by id, and the
  delete is refused if the waypoint at that index is no longer the one that was
  asked about.
- **DELETING ONLY THE CIRCUITS AFTER A TOUCH & GO LEAVES THE SECTOR ALONE**,
  because the touch & go that opened it is still there.
- **EVERY DELETE PATH IS THE SAME FUNCTION**: the row's x button, the right-click
  menu and the Delete key all go through `deleteWaypointFromFlight`, which is
  async now and returns what it removed, so the Delete key's own toast is not
  said twice. Tests CLICK the row button and answer the real menu (the v16.53
  rule), and `verify:fixes` does it in Chromium after a real Full stop click,
  then presses a real Ctrl+Z.
- **SIX MUTATIONS, ALL CAUGHT BY NAME, NONE ONLY IN `tsc`**: stubs not deleted,
  a planned sector deleted with no question, any next plan claimed, flying after
  the stop ignored, circuits counted as a leg, and the focus left on the
  deleted plan. Two of those ended the run early - one left a dialog open,
  one crashed the render - which the harness reports as `NO RESULT` rather than
  a pass.

## A FLY-BY IS NOT A MOVEMENT, AND A CLOSED CTR IS CLASS G RMZ (v17.1)

The author, on v17.0: *"remember that flyby of an aerodrome does not count as
landing and should therefore not issue warning when flying over the aerodrome.
When a CTR is outside operating hours, it is defined as class G RMZ. If i delete
a landing that issued a warning flag, the warning flag still persists after
deletion."*

### THE PERSISTING WARNING WAS TWO BUGS, BOTH REPRODUCED BEFORE ANYTHING CHANGED

1. **A SECTOR WITH NO LEG WAS A TAKE-OFF.** A full stop opens the next sector
   with its departure already in it, one waypoint and nowhere to go, and
   `depAt` was set for `real.length >= 1`. So the stub was checked as a take-off
   at the landing's own instant. Measured: ENTC -> ENDU full stop on a Sunday at
   22:10 raised TWO lines, the landing and the stub's take-off. Deleting the
   landing left `ENDU take-off at 2210 ... OUTSIDE`, which is exactly the
   reported symptom. `depAt` now needs a leg, same as `arrAt` always did. The
   runway checks read the same field, so the stub's phantom distance check went
   with it.
2. **THE FIX BEFORE A DELETED LANDING BECAME A LANDING OF ITS OWN.** The ends
   resolve to an aerodrome by position (`aerodromeAt`, 5 NM), and **56 of the
   243 reporting points are within 5 NM of their own ARP** (measured; ÅSEN is
   1.4 NM from ENDU). Delete ENDU after ÅSEN, and ÅSEN was the ENDU landing,
   warning included.

### WHAT IS FLOWN OVER, AND ONLY WHAT IS STATED

`isOverflight(wp)` (anchors.js) is exactly two published facts: `flyby: true`,
or `anchor: 'AIP-RP'` (a reporting point is a published place that is NOT the
aerodrome). An end flown over is no take-off and no landing, for the opening
hours and the runway distance alike (`depAt.over` / `arrAt.over`).

- **A CLICKED POINT STILL RESOLVES BY POSITION.** A sector ends where it lands,
  and a point put on the field by hand is on it. No distance threshold was
  invented to tell "on the runway" from "a mile out"; the waypoint menu offers
  **Fly-by (no landing)** / **Take off / land here** on any non-stop, non-circuit
  waypoint on an aerodrome instead, which is also how a fly-by added BEFORE the
  flag existed is corrected. No migration guesses it from the name or the
  altitude.
- **THE FLAG IS STORED, AND IT CANNOT SIT ON A STOP OR A CIRCUIT.** A touch & go
  and a full stop ARE landings; the sanitiser drops `flyby` beside either, so a
  hand-edited file cannot make one both.
- **A FLY-BY IS STILL LISTED (`OVR` on the card) AND NEVER REACHES THE BANNER.**
  It is judged at the time over it (the start of the leg that leaves it, from
  `legStartTimes`), because what the airspace is then is worth knowing.

### A CTR OUTSIDE ITS ATC UNIT'S HOURS IS CLASS G, RMZ - VERIFIED IN ENR 1.4

AD 2.17 says only "Hours of applicability REF AIS Portal". **ENR 1.4 section 1**
(2026-09-03, fetched to check) states it: the Class G paragraph ends *"The
following airspaces are classified as RMZ: TIA, TIZ, CTR outside the opening
hours of the ATC unit, Ekofisk and Tampen HTZ"*, and Note 2 repeats it with the
requirement: *"Pilots shall maintain continuous air-ground voice communication
watch and establish two-way communication, as necessary, on the appropriate
communication channel in RMZ."* That the CTR is then class **G** follows from
where ENR 1.4 lists it (inside the Class G paragraph) and is what the author
stated; ENR 2.1 says it in so many words for Salen CTR.

- The hours card says `<CTR> is class G, RMZ while ATS is closed (ENR 1.4)` on
  every row where ATS is closed, and nothing while it is open. The first
  version also wrote `<CTR> is class D` on open rows; `verify:visual` showed it
  adding a line to every row of the seed plan, and a line on every row buries
  the one that matters. A closed LANDING is still a banner finding. The author's v16.93 rule is unchanged, and a
  closed aerodrome is not the same thing as closed airspace.
- The CTR hover card carries `outside ATS hours: class G, RMZ (ENR 1.4)`,
  except where the aerodrome's ATS is published H24 (ENTC, ENEV...), where the
  rule never applies. `airspaceInfo` takes the hours text as `opts.atsHours`.
- **NO FREQUENCY IS NAMED FOR THE RMZ.** "The appropriate communication channel"
  is per aerodrome (ENDU's AD 2.18 says Polaris 126.455 outside TWR/APP hours),
  and picking one generically would be a guess.

### AN OPEN QUESTION FOR THE AUTHOR, FOUND ON THE WAY AND NOT ACTED ON

**AD 1.1 section 1.2** lets Avinor aerodromes be USED outside published hours,
0600-2200 (0500-2100) UTC, for non-commercial VFR-by-day flights at MTOM 2730 kg or
less, with PPR through myppr.no at least an hour before, except at a listed set
of aerodromes. A C182 is well inside that. So a "closed" landing on the banner
may be one the school is allowed to make. It is still flagged, because the
author asked for that and PPR is a step the pilot has to take. Whether the
finding should say so is the author's call.

### MUTATIONS, ALL CAUGHT BY NAME, NONE ONLY IN `tsc`

The stub as a take-off; a reporting point not flown over; the sanitiser
dropping the flag, or allowing it on a stop; a fly-by on the banner; the
overflight ignored at either end of the hours check and in the runway check;
Fly-by not setting the flag; the closed CTR keeping its class; the hover note
on an H24 CTR, or missing; the menu toggle on a stop or a reporting point; the
fly-by timed at the sector start; the fly-by painted as closed.

- **ONE ESCAPED AT FIRST**: ignoring `over` at the TAKE-OFF end passed, because
  no test started a plan on a fly-by. One does now.
- **AND THREE "ESCAPES" WERE THE HARNESS.** A re-run in a copy of the tree that
  was missing the version bump failed the BUILD, ran no test, and reported
  `FAIL=0` three times. It looked exactly like three guards that do not fire. The
  harness now says `NO RESULT` when the run has no RESULT line: the v16.75
  lesson, *a suite that exits with no RESULT line has not passed*, applied to
  the mutation run itself.
- **`verify:locked` HAD BEEN FAILING SINCE v17.0.** It asserted the version badge
  matched `/16\./`, a premise that expired with the major version. It reads
  `package.json` now.

## "THE WHOLE FLIGHT", AND IT IS WHAT SAVE DOES FIRST (v16.100)

The author: *"Dont call it whole mission rather call it the whole flight. Also
when saving the flight, have the save whole flight as the top and prioritized
choice as thats whats used 99% of the time."*

- **THE SAVE DIALOG LEADS WITH "Save the whole flight"**, and it is the one
  primary button, so Enter does it. `Replace "<name>"` moved to second place and
  is no longer the primary. That is a safety fix as much as a preference:
  whenever a saved plan had been loaded, Replace WAS the primary, so Enter
  after loading used to OVERWRITE the saved entry - and it is the one option in
  the dialog that destroys something (QoL 11). A test presses Enter twice
  (choice, then name) with a route loaded and requires the route byte-identical.
- **"Save active flight as a new route" became "Save only the active sector as
  a route"**, because with "the whole flight" meaning every sector, "active
  flight" would have meant two different things in one dialog.
- **WHAT A PILOT READS SAYS "flight"; WHAT IS STORED DOES NOT CHANGE.** The
  dropdown group ("Whole flights"), its placeholder, the name prompt, the
  toast, the delete confirmation, the Save/Delete tooltips, the M&B toggle, the
  tab's master card, the printed master's title and the guide. The storage key
  `c182_custom_missions`, the `mission:` option prefix, `mbPrefs.view ===
  'mission'` and the function names are untouched, so every flight saved before
  this still loads. A test requires no visible text and no string literal in
  the app to say "whole mission".
- ~~NOT RENAMED, AND IT IS A CHOICE: other prose that says "mission" in
  passing~~ - **v16.101 renamed ALL of it** on the author's answer ("yes rename
  all of them to flight"): the totals card ("Whole-Flight Totals (All
  Sectors)"), the add-plan tooltip, the delete/clear dialogs, the Undo step,
  the import prompts and toast, the damaged-library message, three engine
  messages (integrity, M&B, exchange) and the guide - which also corrected a
  stale line saying taxi fuel is "charged once per mission" (it has been per
  departure since v16.54). The guard is now "no visible text and no string
  literal says mission", with an explicit allow-list of the storage keys, ids
  and function names that must not change, comment lines skipped, and
  "permission" not counted as the word. Restoring the old card title fails it
  by name.
- Three mutations, each caught by name: Replace made primary again, the whole
  flight not first, the M&B toggle back to "Whole mission".

## THE WEATHER FEEDS THE DISTANCES, AND SAYS WHEN IT IS OLD (v16.99)

Three reports from the author, the same afternoon v16.98 merged.

### PRESSING FETCH NEVER RE-RAN THE PLAN (a v16.96 bug)

*"when the fetch button is pressed, the takeoff and landing distances arent
calculated before i cycle the runways once."* `fetchMetarTaf` repainted the two
weather cards and nothing else. The runway checks are built inside
`renderAllFlightTables`, so the wind/QNH/OAT prefills, the distances, the banner
and the printed sheet all kept the figures from BEFORE the fetch. Cycling a
runway fired the card's change listener, which renders, and that is why it
"fixed" itself. A successful fetch now ends with one render, OUTSIDE the `try`:
a render problem is not a failed fetch and must not be reported as one.

- **NOTHING IN THE SUITE HAD EVER DRIVEN A FETCH.** Every weather test assigned
  `lastWeather` by hand, which is exactly the path that renders. The new test
  CLICKS the real button against a stubbed `fetch` (the v16.53 rule: driving
  the function proves the function).
- **MY OWN STUB MATCHED THE WRONG URL FIRST.** `/taf/` is inside `tafmetar`, so
  both requests got the TAF body and every station read "no reports published".
  It matches `/\/taf\?/` now. A stub that answers everything the same way
  proves nothing about which request was which.

### THE M&B WEATHER CARD TOOK THE FIRST AND LAST OF A DEDUPLICATED LIST

*"for my (ENDU-ENEV-ENTC-ENDU) flight plan only shows ENDU and ENEV, not ENTC
in the M&B page"*. `routeAerodromes` deduplicates, so a round trip's return to
ENDU is gone before the card takes "first and last" - and every intermediate
stop but one falls out. Which one survives depends on how the sectors are laid
out (reproduced as ENDU + ENTC on a three-full-stop layout; the author's showed
ENDU + ENEV): the same cause either way.

- **THE CARD NOW SHOWS WHAT THE DISTANCE CARD BELOW IT CHECKS**: every
  `runwayChecks` aerodrome, in flight order, from the same array, so the two
  cannot disagree about which fields count. The daylight card's own first/last
  rule is unrelated and unchanged.
- **FETCH ASKS FOR THOSE AERODROMES TOO.** The route list comes from waypoint
  NAMES; the runway checks resolve by POSITION (`aerodromeAt`). A departure
  waypoint named "BARDUFOSS" was ENDU to the distance and never got its METAR.
- **"NOT IN THE LAST FETCH" IS NOT "NO REPORTS PUBLISHED".** An aerodrome added
  after the fetch is said to be missing, in its own words, because the card's
  existing phrase is what it says about a station that files nothing.

### OUTDATED IS PAST THE REPORT'S OWN ROUTINE INTERVAL - MEASURED

*"when a METAR or TAF is outdated (they should update every 30 minutes, and 6
hours respectively, check local rules) the metar / taf could be displayed in
yellow text with a little label"*. Checked, and the local rule is not one
number, so it was measured:

- **AIP Norge GEN 3.5 section 3** lists each station's observation interval -
  41 of 62 half-hourly, 16 hourly, several by time of day (ENDU `H, h` with the
  half-hourly window footnoted as 0330-1630), a few in prose ("parts of night")
  - and publishes NO TAF issue schedule. The table is untagged, and reading
  footnoted prose would be the sentence-parsing the importer refuses.
- **MET Norway's own last 24 h, 2026-09-29, eight stations** (ENDU ENTC ENEV
  ENAT ENGM ENBO ENNA ENSR): METAR every **30 min at all eight** - including
  ENAT, which GEN 3.5 lists as hourly, so practice is the author's figure. TAF
  by its OWN LENGTH: the 24/30 h TAFs every **6 h**, the 9 h TAFs (ENAT, ENSR)
  every **3 h**; the shorter gaps are amendments. That is ICAO Annex 3's split
  at 12 h of validity.
- `routineIntervalMin(p)` reads it off each report (`validHours` is parsed from
  the TAF's first DDHH/DDHH, the next day across a month end); `isOutdated` is
  "older than that". A TAF whose validity cannot be read is never flagged -
  null, not a guess.
- The raw text turns yellow (`--wx-outdated`, a token in all three theme
  blocks, `#a16207` on white so it can be read) with an **"Outdated · fetch
  again"** label on both weather cards. The TAF now shows its age too; it never
  did. The distance card used 90 min for "NOT CURRENT" and now uses the same
  30 - the first named failure shape, an old rule not moved with a new one.
- **THE REPORT IS STILL SHOWN IN FULL.** Outdated means a newer one is due, not
  that this one is wrong; it is still the last report there is.
- **THE AGE ASSERTS ALLOW ONE MINUTE.** A report time has no seconds, so a
  report made "10 min ago" reads 11 half the time. The first version asserted
  the exact text, flaked under the mutation run, and - because it failed before
  its reset - cascaded into an unrelated plan-count test. It reads 10-or-11 now
  and resets in a `finally`.

### ELEVEN MUTATIONS, ALL CAUGHT BY NAME, NONE ONLY IN `tsc`

No re-render after Fetch (3, the first reproducing the author's symptom:
`qnh null, wind null`); the card back to first-and-last (1, `["ENDU","ENTC"]`);
the missing aerodrome not reported (1); position-resolved aerodromes not
fetched (1); METAR outdated at 90 min (2); every TAF on a 6 h cycle (1); the
boundary inclusive (1); a month-end validity misread (1); the raw text not
yellow (1); a TAF never flagged (1); the distance card back at 90 min (1 - which
the flaky age assert had MASKED on the first run: it failed before reaching the
distance-card check, so the mutation looked caught for the wrong reason).

## FOUR CORRECTIONS TO PAGE 2, FROM THE PERSON WHO FLIES IT (v16.98)

The author, on the merged v16.97: *"check the endurance calculations and make
sure it always uses 12GPH. 64GAL should give endurance of 05:20"*, *"Our policy
is to always use the full length of the runway for takeoffs"* and then *"the
OFP should always show the takeoff distance for a stationary takeoff even if its
a touch and go!"*, *"If there is a TEMPO group for wind in the METAR, then that
should be the wind applied in the calculations"*, and *"last minute changes are
only for changing the amount of fuel actually on board at preflight VS the
preplanned fuel. Say i planned with 64GAL and actual fuel is 60, then i can type
in 60GAL actual and it will do recalculations."*

### ENDURANCE AND RESERVE TIME ARE AT THE SHEET'S ONE PLANNING RATE

`PLANNING_GPH = 12` (massbalance.js) is `OFP!P4`, and the workbook times BOTH
from it: endurance `O9 = (M8/P4)/24`, final reserve `M6 = (O6*24)*P4`. v16.97
timed them at the cruise level's POH fuel flow, which put 64 gal at ~05:23 at
4500 ft and moved with the cruise level - a second fuel flow on a page the
school works with one. `MIN_FLIGHT_GPH` is now DEFINED as `PLANNING_GPH`
(`OFP!N13` divides by the same cell), so there is one 12 and not two.
`minutesAtPlanningRate(64) === 320`. The per-leg burn on the OFP is untouched:
that is the POH's, per leg, answering a different question. The tab gained an
Endurance chip; the test first asserts the fixture's cruise POH flow is NOT 12,
or 05:20 would prove nothing.

### A TAKE-OFF IS A STATIONARY START AT FULL LENGTH - ALWAYS

v16.96 offered every published intersection with its own TODA. The school's
policy is the full length, so `buildRunwayChecks` offers the runway ends and
nothing else, for a take-off as for a landing, and **that holds after a touch &
go** - the author's second message settled the one ambiguity ("not including
T&G" read either way until then). The intersections are STILL IMPORTED
(`data/aip.js`, 120 positions, and the importer tests unchanged); they are
simply not a take-off this planner plans. An old session's `'17@TWY A'` choice
falls back to an end.

### THE TEMPO WIND WINS, AND THE OBSERVED WIND COMES FROM THE BODY ONLY

`parseReport` reads `tempoWind` from a METAR's TEMPO trend (the first, with
`tempoWindCount` so the card can say "the first of 2"), and the runway checks
use it over the observed wind; a typed wind still wins over both. The card and
the printed take-off/landing note say the wind is the TEMPO group's, because a
distance worked on a forecast gust group must not read as the observation.

- **A TAF IS LEFT ALONE.** Its TEMPO groups each carry their own validity
  period, and which applies is a question of time the decoder cannot answer.
- **BECMG IS NOT TEMPO**, and a TEMPO group ends at the next trend group - a
  test puts a BECMG wind right after a TEMPO group with none.
- **FOUND ON THE WAY, A LATENT WRONG NUMBER**: the observed wind was the FIRST
  wind anywhere in the line. Identical while the body carries one; with
  `/////KT` in the body the TEMPO forecast would have been reported as the
  observation. The body is now cut at the first `TEMPO|BECMG|NOSIG|RMK|FM|PROB`.

### THE LAST MINUTE CHANGE IS THE ACTUAL FUEL, AND NOTHING ELSE

A session-only `Actual fuel on board at preflight` box on the M&B tab (US gal;
empty = no change, and never stored - it is today's fuel, the QNH rule).
`applyActualFuel` (pure) shifts the plan's fuel by `actual - planned`:

- **FROM THE FIRST ENGINE START UNTIL A REFUEL.** Every sector flown on those
  tanks departs and arrives with the same difference; a full stop that refuels
  to a stated figure ends it (`refuelled` now rides on `ofpPrintModel`). A touch
  & go or an un-refuelled full stop carries it on. The first departure is set to
  the typed figure EXACTLY, so 64 - 4 cannot print as 59.99999.
- **EVERYTHING ON PAGE 2 IS THE ACTUAL** - the Fuel line, both masses, the CG
  chart, fuel on board, endurance, and the take-off distance (worked at the
  actual mass) - because "it will do recalculations" is the point of typing it.
  The LMC line prints the difference WITH ITS SIGN (`-24,0` / `+75,0`, moment at
  the fuel arm), and a new free-paper note strip in the top margin
  (`MB_BOXES.note`, x 462-774 beside the title - the margin is empty down to
  the tables' 581.75, measured off the rules snapshot) says "every figure here
  is for the actual fuel", so the line is not added a second time.
  - **THIS IS A DECISION, AND THE OTHER READING WAS WEIGHED.** The form's row
    order (TOM, enroute, LMC, landing) also supports the airline-loadsheet
    reading: print the PLANNED take-off and fold the LMC into the landing only.
    That would print a take-off mass nobody flies and put a TO mark on the chart
    that disagrees with the TOM line, which is the worse failure for a limit
    check. Flipping it is local to `printMbSheet` if the author prefers it.
- **THE OFP's FUEL COLUMN STAYS THE PLAN**, because the plan is what the change
  is measured against, and the tab says so.
- **RUNNING DRY ON THE ACTUAL FUEL IS A BANNER FINDING** (`actualFuelProblems`).
  The OFP's own negative-fuel rule reads the planned column, which the change
  does not touch - so without it a pilot typing 20 gal for a 34 gal trip got a
  recalculated sheet and no warning. Landing below the final reserve is SAID on
  the tab, not flagged, which is the rule the plan's own column already follows.
- **AN UNREADABLE FIGURE IS REFUSED, NOT CLAMPED** (`normaliseActualFuelGal`):
  a clamped typo is a plausible wrong fuel load weighed as though it were right.
  That differs from the refuel box, which clamps, and on purpose.

**THE WHOLE-MISSION STOP CHANGE MOVED OFF THE LMC LINE.** v16.97 parked the net
fuel change at the stops there because the form has no line for it; it is
stated beside the title now ("Fuel change at the stops +25,8 US gal: T/O -
consumed + that = landing"), and the test that the master adds up reads it from
there. **NOT IN THE NOTE STRIP, AND THAT WAS MEASURED**: the first version put
both sentences in the strip, and at their widest figures they need 347.6 pt at
the smallest type against 309.6. A test now fits the widest text of both boxes
with pdf-lib's own Helvetica metrics.

### `verify:ofp` HAD BEEN READING pdf.js's FIRST RENDER, AND IT IS SOMETIMES WRONG

Growing the worst-case fixture (a TEMPO wind, an actual fuel) made the "a blank
sheet IS the form" check fail 2 runs in 5 - with 1289, 324 and 30 pixels at
different places on page 1, which no line of this change draws on. Main passed
5 of 5 in the same browser, and the OLD verifier passed 5 of 5 against the NEW
build, so the artifact was sound and the fixture was the trigger. Instrumented:
in a failing run the FORM rendered twice differed from ITSELF by 324 px, and its
second render matched our blank sheet exactly (0). The first pdf.js render of a
freshly opened document is the defect (a font-load race is the likely cause),
and a heavier page before it widens the window.

- **A PAGE IS READ ONLY ONCE TWO CONSECUTIVE RENDERS AGREE**, up to five, and a
  page that never settles FAILS by name. Measured and waited out, not tolerated
  with a threshold - the v16.64 verify-visual rule. 8 of 8 clean afterwards.
- **STILL DISCRIMINATING, PROVED BY MUTATION**: covering the pre-printed "0"
  unconditionally fails it at 94 px on page 2.
- **THE "0 DIFFERING PIXELS" CLAIM OF v16.97 STANDS**; it was measured on runs
  that happened to render cleanly first time, and it is now measured on renders
  that are known to have settled.

### NINETEEN MUTATIONS, ALL CAUGHT BY NAME, NONE ONLY IN `tsc`

Endurance back on the cruise POH flow (2 tests, printing `05:07`); the planning
rate 11 (4); intersections offered again (2, listing `10@TWY A`); TEMPO ignored
in the checks (1); the observed wind read from the whole line (1); a TAF TEMPO
taken (1); BECMG not ending a TEMPO group (1); the actual fuel not applied (2);
the change carried through a refuel (2 - and ESCAPED at first, dying only in
`tsc` on a `boolean === 'never'` comparison, the v16.63 trap; rewritten so it
typechecks); the first departure as planned + delta (2); an unreadable actual
clamped instead of refused (1); the LMC line not printed (1); the change
unsigned (1); the stop change back on the LMC line (2); the stop change not
stated (2); running dry not on the banner (1); the actual fuel stored (2); and
the refuel flag never set (1).

**AND THE STORAGE TEST WAS VACUOUS BEFORE THE MUTATION RAN.** It assigned the
global directly, so a mutation that stored the figure in the box's own handler
could not reach it. It types into the real box now.

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

## ESCAPE AND UNDO BELONG TO THE RULER WHILE IT IS RUNNING (v16.92)

The pilot: *"Please let me press escape on ruler to reset the ruler and ctrl-Z
to remove last ruler waypoint."*

### ESCAPE BACKS OUT ONE LEVEL AT A TIME, WHICH IS WHAT IT ALREADY MEANT

- Points on the ruler -> **clear the measurement**. Nothing left to clear ->
  **stop the ruler**. That second half is DERIVED rather than invented: it is
  what Escape does everywhere else in this app, and it is what keeps the key
  from being the silent keystroke `keys.js` exists to prevent - there is always
  an outcome to see.
- **AN OVERLAY IS STILL THE OUTER LEVEL.** A modal open over the map closes
  first and the measurement underneath survives; `dialog.js` still owns its own
  Escape; and a line drag still wins over everything, because a drag is the
  state that TRAPS the map (v16.46). All four orderings are asserted.

### UNDO IS KEYED ON THE ACTION, NOT ON Ctrl+Z

While the ruler runs, whatever chord is bound to **undo** removes the last ruler
point. It is matched on `spec.id === 'undo'`, so a pilot who rebound undo to
Alt+U gets this on Alt+U - **asserted, rather than left as a sentence in a
comment**, because a mutation keying it on the literal chord otherwise passes.

- **WITH NO POINTS IT SAYS SO, and does NOT fall through to the plan's undo.**
  One mode, one meaning: a Ctrl+Z that quietly removed a waypoint because the
  ruler happened to be empty is exactly the surprise this project refuses. You
  cannot edit the route while the ruler owns the map's clicks anyway, so there
  is nothing new to undo, and stopping the ruler is one keystroke away.
- **NEITHER TOUCHES THE PLAN'S UNDO STACK**, and that is a decision rather than
  an omission: the ruler writes nothing to `flights`, so an entry for it would
  undo nothing and cost the pilot a second Ctrl+Z to reach a real edit.
- **REDO IS DELIBERATELY LEFT ALONE.** The ruler is click-to-place, so putting a
  point back is one click on the map - it already HAS a redo, and it is the
  mouse. A second stack for a transient measuring tool is the mechanism v16.61
  says to prefer the deletion of. Stated in the guide rather than left as an
  asymmetry to discover.
- `ruler-clear` and `ruler-undo` join `cancel-drag` as actions the page must
  handle but the menu does not OFFER: they are not bindings, they are what an
  existing chord MEANS in a state. A test asserts they are in `KEY_ACTIONS` and
  NOT in `ACTION_SPECS`, and the existing switch-coverage guard then requires the
  page to have a case for each.

### THE DRAWING HAD TO STOP BEING INCREMENTAL FIRST

The click path appended the newest dot and the newest chip, which is fine while
a ruler only ever GROWS - and Ctrl+Z makes it shrink. An undo that removed
markers with its own copy of that drawing logic would be a **second mechanism**
that can drift from the first, which is the v16.27 `flightLineCoords` rule.

`redrawRuler()` rebuilds everything from `rulerPoints`, and BOTH the click and
the undo end there. Two invariants hold it down, and the second is the one that
matters:

1. **Drawing the same points twice is identical** - so a stale chip cannot
   survive a redraw.
2. **Undoing a point lands exactly where the pilot was one click ago**, compared
   as a whole state: the points, every marker's markup, the drawn line's point
   count, the total chip and the banner text. **The fixture asserts the fourth
   click CHANGED that state first**, or the comparison would pass against a
   snapshot of nothing happening.

The marker ORDER is the one the incremental version produced (dot, then that
segment's chip), so nothing downstream sees a different array.

### THE MENU SAYS BOTH, BECAUSE THE MENU IS WHERE A PILOT LOOKS

`close-overlays` now reads *"Close a dialog, abandon a drag, clear the ruler,
clear the selection"* and its hint spells out the one-level-at-a-time order;
`undo` gained a hint saying what it does while the ruler runs and that rebinding
moves it. A behaviour that only the source knows about is folklore.

### SEVEN MUTATIONS, ALL CAUGHT BY NAME, NONE ONLY IN `tsc`

Escape not reaching the ruler (2 tests); Escape clearing but never stopping the
empty ruler (2); Escape reaching the ruler THROUGH an open modal (1); undo
falling through to the plan (3, one of them reporting `Ctrl+Z leaked through to
the plan and undid a route edit`); the ruler undo keyed on the literal `Ctrl+Z`
so a rebound undo stops following (1); the undo popping a point without
redrawing - the stale-chip failure (1, and it is the whole-state invariant that
catches it); and the ruler pushing the plan's undo stack (1, `1 -> 3`).

### AND THE BROWSER CHECK IS THE HALF jsdom CANNOT SEE

`verify:fixes` presses a REAL Ctrl+Z and a REAL Escape after real mouse clicks
and counts the ink in the DOM: `3 dots / 2 chips / 1 total` -> `2 / 1 / 0` on
undo -> `0 / 0 / 0` on Escape with the banner still up -> banner gone on the
second Escape. That is what would fail silently if `redrawRuler` ever stopped
REMOVING layers rather than just rebuilding the array.

**TWO OF ITS CHECK MESSAGES READ BACKWARDS AT FIRST.** `check(cond, msg)` prints
the message on a PASS too, so "Ctrl+Z stopped the ruler instead of removing a
point" said the opposite of what had just been proved. A message that describes
the failure is a message that lies on every green run.

## THE RULER PREVIEWS, AND MEASURING IT FOUND THE RULER DRAWING THE WRONG LINE (v16.91)

The pilot: *"Make the ruler function as a preview, when clicking a point a
preview of the ruler length is visible to accurately measure distances from a
starting position"* - and, about the sliders of v16.90, *"works somewhat but
still buggy so whatever"*, which is where that thread stops.

### THE FEATURE: A BAND FROM THE LAST POINT TO THE CURSOR

After the first click a dashed band follows the mouse, with a chip carrying the
magnetic track and the distance and - from the second point on - what the
running total WOULD become. Nothing is committed until the click, so a distance
can be read off and abandoned without leaving a mark on the chart.

- **THE PREVIEW IS THE SAME ARITHMETIC AS THE COMMIT, NOT A CHEAPER ONE.** It
  calls `calcDistanceNM`, `calcTrueTrack` and `resolveMagVar` on the same two
  points the click would, which is the rule the leg panel's preview follows by
  running the real engine on a copy (v16.37) and the fix-style preview follows
  by calling the map's own `fixSymbolSvg` (v16.35). A test drives the mouse,
  reads the chip, clicks, and requires the committed chip to carry the same
  text; `verify:fixes` does it again in Chromium. A mutation that takes the
  variation at the START of the leg instead of the end fails it by name.
- **TWO READOUTS IN THE BANNER, NOT ONE.** A preview that overwrote the
  committed text would have to remember it and put it back - a second copy of a
  figure, which is where this project's drift always starts. Separate spans mean
  there is nothing to restore and no way for the two to disagree, and a test
  asserts the committed text is byte-identical across a preview appearing and
  going away.
- **ONE MARKER, REUSED, ITS MARKUP REBUILT ONLY WHEN THE TEXT CHANGES** - the
  v16.33 rule for the airspace hover card, which is keyed on the resolved sector
  so it regenerates when the cursor crosses a boundary rather than per pixel. At
  z10 a CSS pixel is ~26 m, so the 0.1 NM the chip prints turns over every
  several pixels of travel.
- **A PREVIEW OF NO LENGTH STATES NOTHING.** The cursor sitting on the point it
  measures from would otherwise print `000°M · 0.0 NM`, which reads as an
  answer. So does the cursor leaving the map: the band goes with it rather than
  hanging at the last pixel inside the container, which is the v16.46 rule about
  a gesture needing an exit that does not depend on one event arriving.
- **THE CHIP CHECK IS THE PROJECTION, NOT THE MARKUP.** `verify:fixes` turns the
  cursor's own container point into a coordinate with Leaflet's
  `containerPointToLatLng` and requires the chip to state the distance to THAT -
  because "accurately measure distances from a starting position" is a claim
  about where the pointer is, and jsdom has neither a projection nor a cursor.
- **THE PREVIEW CHIP SURVIVES MID DECLUTTER AND GOES AT FAR**, argued rather
  than copied from the other ruler chips: the declutter exists because
  fixed-pixel labels PILE INTO A HEAP as the map shrinks, and there is exactly
  ONE preview chip, transient, under the cursor. Mid zoom (z6-7) is also where
  the longest distances get measured. FAR is explicitly "dots and route lines
  only", and nothing is lost there either - the banner carries the figures at
  every zoom.
- **IT NEEDS A MOUSE, and the guide says so.** `mousemove` does not fire for a
  tap, so on a touch screen there is no cursor to follow and the committed
  measurement is unchanged. Stated rather than left to be discovered.
- **THE MAP FIRES `mousemove` CONSTANTLY, IN AND OUT OF RULER MODE**, and
  `setLatLngs` redraws a path even when it is already empty - so the handler
  clears nothing unless a band is actually up. The marker and the band are set
  and cleared together, so the marker answers for both.

### TWO BROWSER MUTATIONS ESCAPED, AND ONE OF THEM CORRECTED ME TWICE

- **`interactive: true` ON THE PREVIEW MARKER CHANGED NOTHING** the first time,
  and my explanation for that was wrong. I wrote that the chip rides
  `RULER_CHIP_DX/DY` = +14, -28 px clear of the pointer, so the pointer can
  never be inside it - which is true of the **visible label** and false of the
  **marker**. The marker's own 12x12 container sits ON the anchor,
  i.e. directly under the cursor, and only the label is transformed away.
  - **MEASURED, once the check hit-tested AT THE CURSOR**: with
    `interactive: true`, `elementFromPoint` at the pointer returns
    `leaflet-marker-icon` instead of the map. It fails by name now, so the flag
    is load-bearing and not the decoration the first account made it.
  - **WHY THE CLICK SURVIVED ANYWAY, read out of the bundled Leaflet rather
    than assumed**: `_findEventTargets` only accepts a layer that
    `listens(type, true)`, and falls back to `[map]` when none does. Nothing
    binds `click` to this marker, so the map still gets it. **The exposure is
    LATENT, not harmless** - it bites the day anything binds a handler there,
    which is exactly the sort of thing a later change does.
  - So the first version of the check - "the click still committed a point" -
    could not see it, and the check that does is the one that asks the browser
    what is under the pointer. `verify:fixes` now asserts that, plus that not
    one pixel of the drawn chip takes the mouse (hit-tested at the chip's
    centre, which no mouse gesture can reach because the chip is repositioned by
    the very move that would approach it).
  - The jsdom test's title said "the preview is non-interactive, so it cannot
    eat the click that commits it" - the right flag, the wrong cause. Rewritten.
  - **THE SHAPE IS v16.55 AND v16.89 AGAIN**: a statement that was true of the
    one thing I looked at (the label's box) and false of the thing that mattered
    (the container's). Measure the object the platform hit-tests, not the one
    you can see.
- **ADDING `.ruler-preview-icon` TO THE `max-content` OVERRIDE DID NOTHING, SO IT
  CAME OUT.** Measured both ways in Chromium: the container goes 92x21 -> 12x12
  while **the label stays 92x21 and paints in full** (overflow is visible), the
  container's background is transparent either way - `className` REPLACES
  Leaflet's own `leaflet-div-icon`, which is the class that carries the white box
  and border - and `elementFromPoint` returns the map at the cursor and at the
  chip in both states. v16.70's rule: prefer the deletion to a safeguard that
  cannot be shown to do anything.
  - And putting that comment INSIDE the selector list (it spans two lines) broke
    a test that slices 200 characters from `.toc-custom-icon` to the opening
    brace. Valid CSS, wrong place; it sits above the block now.
- The markup had been written TWICE - once to create the marker, once to update
  it - which is two places for the offset to drift apart. `rulerPreviewIcon()`
  is the one definition, and a test counts the occurrences.

**VERIFIED BY PIXELS, because a CSS change is (v16.19).** Against v16.90 in real
Chromium: **57 pixels differ and every one of them is in an 8x8 box at
x 300-307, y 19-26** - the version badge, identical in light and dark, with
computed styles identical. That is deferred nit 13 and nothing else; no chip
this feature adds is drawn until the ruler is running.

### AND THE RULER HAD BEEN DRAWING A DIFFERENT LINE FROM THE ONE IT MEASURED

Measuring the preview's own band against the path model is what exposed it, and
it is this file's first named failure shape exactly: **AN OLD RULE NOT APPLIED
TO A NEW SURFACE**, except the surface was older than the rule.

- `rulerLine.setLatLngs(rulerPoints)` hands Leaflet the clicked points raw, and
  Leaflet joins points with straight lines in Web Mercator - which IS a rhumb.
  Meanwhile `calcDistanceNM` and `calcTrueTrack` follow the v16.63 path setting,
  so in the default great-circle mode the ruler **drew a rhumb and measured a
  geodesic**.
- **MEASURED on Tromso-Kirkenes at 69 N: 5.15 NM apart at the midpoint** - the
  same figure v16.63 measured for the route line, which is no coincidence, it is
  the same leg and the same two models.
- The half a pilot actually SEES is the chip: it is placed with
  `interpolateGeo`, i.e. on the MEASURED path, so on a long ruler leg the
  segment chip floated 5.15 NM off the line it labelled.
- **THE FIX IS TO SHARE THE DENSIFIER, NOT TO WRITE A SECOND ONE.**
  `drawnLineCoords` was `flightLineCoords` plus a densification loop; the loop is
  now `densifyPath(pts)` and `drawnLineCoords` is one line. The committed ruler
  line, the preview band and the route line all go through it, so there is no
  second place for the drawn line and the measured line to diverge. v16.63's
  entry says "ONE DENSIFIER FOR BOTH MODES"; it is now also one densifier for
  every drawn line.
- The test walks the drawn polyline AND the midpoint of every drawn segment
  against the measured path, because **every vertex of a chord-only line is on
  the path by construction** - it is the straight line between them that sags.
  That is the v16.62 lesson, and testing the vertices alone would have passed the
  broken build.

### THE TEST FILE'S OWN CASCADE, worth recording because it lied about four other features

A failed `assert` skips whatever follows it - so a ruler test that turns the mode
off on its LAST line leaves it ON when it fails. `isRulerMode` gates the
keybindings, so one broken ruler assertion produced six failures in the undo,
Cmd+Z, number-field and toast tests, none of which had anything to do with the
ruler. The block sets the mode at the START of each test now
(`startRuler()`/`stopRuler()`) instead of assuming what the previous one left.

**AND ONE NEW CHECK FAILED A WORKING BUILD.** "The band follows the cursor" was
written as a distance moving by more than 1 NM, and reported `72.3 NM -> 71.5`.
The two probe points share an x, the leg is nearly east-west, and how much 113 px
of vertical travel is worth is decided by the LAYOUT rather than by the feature -
the track had moved 10 degrees, which was the real signal. Re-deriving the
expected distance at the new pointer position needs no threshold at all. Straight
M5: assert the thing that justified the check.

### EIGHT jsdom MUTATIONS, ALL CAUGHT BY NAME, NONE ONLY IN `tsc`

The preview emptied (8 tests), the clear dropped from the committing click (1),
the `mouseout` exit removed (1, reporting the band left hanging), the
zero-length guard removed (1, reporting `180°T / 170°M  0.0 NM`), the committed
line un-densified (1) and the band un-densified (1) - plus two that escaped on
the first run and are the interesting ones:

- **THE INVARIANT'S FIXTURE COULD NOT SEE THE ANSWER.** Taking the variation at
  the START of the leg instead of the end changed nothing, because the test
  measured ENDU -> ENTC and `resolveMagVar` returns **-11 at both ends**. Tromso
  (-11) to Kirkenes (-17) differs by 6 degrees, and the fixture now ASSERTS the
  two ends disagree so it cannot quietly stop discriminating. M5 again.
- **THE LABEL KEY WAS NOT OBSERVABLE, ONLY ITS VALUE.** Removing the key
  (`if (true)`) reassigns `rulerPreviewLabel` to the SAME string, so comparing
  that field passed. `setIcon` takes a FRESH `divIcon` every call, so the icon
  object's IDENTITY is what says whether the markup was rebuilt.

`rulerPreviewLine`, `rulerPreviewMarker` and `rulerPreviewLabel` are new
top-level globals, so the page's stated count went 42 -> 45 - and the L3 test
caught that on the first run, again.

## THE CONTROL STOPS AT ITS OWN EDGE, SO THE APP CARRIES THE DRAG (v16.90)

The pilot on the deployed v16.89: *"the divider works fine now and is properly
anchored, but the sliders are still losing track when the mouse moves away from
the slider"* - and earlier, the gesture itself: *"my mouse moved downwards while
dragging and at the moment the mouse stopped touching the slider, it stopped."*

### v16.89's ANSWER WAS WRONG, AND THREE MEASUREMENTS SAY WHY

Pointer capture cannot fix this:

1. **IT IS GRANTED AND NOT HONOURED.** `gotpointercapture` fires on the input,
   and `hasPointerCapture` then reads **false on every subsequent move**.
2. **THAT IS NOT THE DRIVER.** `pointerId` is 1 on the pointerdown and 1 on
   every move, so the reading means what it says - checked precisely because
   this session had already built on three probe artifacts.
3. **THE EVENTS ARRIVE ANYWAY AND THE VALUE STILL FREEZES.** `e.target` is the
   input even 120 px below it, so they ARE being routed there. **Chrome's native
   range updates its value only while the pointer is inside its own bounds**,
   and no capture changes that.

So the app has to move the value itself.

### THE SCALE IS LEARNED FROM THE CONTROL, NEVER INVENTED

The one thing a replacement must not do is disagree with the control while the
control is still driving. **MEASURED: native does not map the full box** - it
saturates well inside both ends, so an x-across-the-rect formula is out by a
whole step in places (measured 1 step at three of nine probe positions).

Deriving the true track from that meant arithmetic on arithmetic - the
saturation points include half a step of rounding - and that constant chain is
exactly what had already gone wrong four times here. So no mapping is derived
at all:

- while the pointer is **inside** the box the control owns the value and the app
  only WATCHES, recording how many units it moved per pixel;
- when the pointer **leaves**, the drag continues from that anchor at that
  scale. No jump at the handover, and no second mapping to drift.
- A drag that leaves before anything could be learned falls back to the box
  width - and that fallback is the only place an invented number survives.
- The write is guarded on `v === live`, so a browser whose native drag DOES
  keep going cannot be double-applied.

**AND THE SYNTHETIC `change` CAME BACK OUT.** The first version dispatched one
on release; measured, the control fires its own even for a value the app wrote,
so every handler ran **twice**. v16.61's rule - prefer the deletion to the
second mechanism.

### I NEVER REPRODUCED THE PILOT'S FAILURE, AND TWO PROBES SAID I HAD

This is the fourth probe artifact in one sitting and the most embarrassing,
because it was written into CLAUDE.md as a reproduction:

- **BOTH "REPRODUCTIONS" HELD x CONSTANT WHILE MOVING DOWN**
  (`mouse.move(x + w*0.6, y + 40*i)`). A range's value is a function of x, so it
  could not change whether the drag was alive or dead. The frozen value proved
  nothing.
- The v16.89 probe before them had the same shape in reverse: it drove the value
  to its **maximum** before leaving the track, so again there was nothing left to
  observe.
- **THE MUTATION IS WHAT EXPOSED IT.** Disabling the continuation entirely left
  the browser check green - 5 -> 9 off-track - which can only mean Chromium's own
  control tracks off-element here. A check that passes with the feature removed
  is not a check, and this one had been written to sound like proof.

**SO THE GUARD IS IN jsdom, WHERE THERE IS NO NATIVE SLIDER DRAG TO STAND IN.**
Synthetic pointerdown on the element, a move inside the box, then a move
outside: only the app's own code can move the value there. Removing the
continuation fails it by name with the pilot's symptom (`2 -> 2`) and 0
`error TS` lines. It also asserts the clamp, that a release really ends the
drag, and - on a second slider - that the app writes NOTHING while the pointer
is inside the control.

The Chromium check is kept and **says in its own comment that it does not
discriminate**. What it proves is that the app has not broken the native control
and that the gesture commits exactly once.

### WHAT IS STILL NOT PROVEN HERE

There is no browser on this machine where a slider drag dies at the control's
edge, so nothing here demonstrates the fix against the pilot's actual failure -
only that it implements the behaviour they described and cannot interfere where
native already works. The divider is the encouraging precedent: the same
document-level approach, and they report it fixed.

`sliderDrag` is a new top-level global, so the page's stated count went 41 -> 42
- and the L3 test caught that on the first run rather than letting it drift.

## THE DRAG IS ANCHORED TO THE MOUSE, NOT TO THE THING UNDER IT (v16.89)

The pilot: *"when i try to click and drag the split between map and plan... if i
move the mouse too quickly, it looses the 'grip' and stops dragging. Please make
sure the drag is forcibly held for as long as the mouse button is held. Same
goes for all the sliders."*

### NEITHER SYMPTOM REPRODUCED, SO THE CONDITION HAD TO BE FOUND FIRST

Driven in Chromium the divider held at every speed and both sliders tracked
300 px off-axis. That is the v16.71 lesson pointing at me: a fix shipped against
a symptom never reproduced is a fix measured on the wrong machine. So the
question became *what has to be true for the report to happen*.

**IT IS THAT THE DRAG HAD EXACTLY ONE MECHANISM.** `pointermove` and `pointerup`
were bound to the BAR, and the drag rode entirely on `setPointerCapture`
retargeting them there. Refuse that one call - which is what a browser or a
pointing device that does not honour it does - and the behaviour splits by
SPEED, because the bar is 2 px wide:

| drag | with capture | capture refused |
|---|---|---|
| 60 steps | within 1 px | within 1 px |
| 4 steps | within 1 px | **299 px off** |
| one jump | within 1 px | **299 px off** |

A slow cursor stays on the bar the bar is chasing; a quick one outruns it and
the events go to whatever is underneath. That IS the pilot's sentence, and it
needed no browser of theirs to find - only the discipline of asking which single
thing the feature depends on.

### THE FIX IS TWO DELETIONS AND ONE ADDITION

- `pointermove` / `pointerup` / `pointercancel` are bound to the **document**
  for the length of the drag. With capture they arrive retargeted to the bar and
  bubble there anyway; without it they arrive from under the cursor. Both paths
  end at the same listener, so the grip cannot depend on which one the browser
  gives.
- **THE BAR'S OWN MOVE AND UP LISTENERS ARE GONE**, not kept as a second path
  (v16.61: prefer the deletion to the second mechanism).
- **LOSING CAPTURE NO LONGER ENDS THE DRAG.** `lostpointercapture` was wired to
  the end-of-drag handler, so any transient loss - with the button still down -
  was permanent. `window blur` replaces it as the exit that is not a pointerup,
  which is the v16.46 rule about a drag needing a way out that does not depend
  on one event arriving.
- Capture is still TAKEN, and still first-class: it is what stops the gesture
  becoming a map gesture the moment it crosses into the chart. It is simply no
  longer what the drag rests on. A test asserts the tracking is installed BEFORE
  the capture call, so a refused capture still drags.

### THE SLIDERS: ONE MEASURED CAUSE, AND ONE STILL UNFOUND

The author answered the missing question - **Chrome and Brave**, which are the
same engine the mouse probe had already declared healthy. That is what forced
the right question: if the ENGINE is not the difference, the INPUT is.

**IT IS, AND AN A/B ISOLATES IT.** One gesture, one element, `touch-action`
forced each way and nothing else changed:

| touch-action | steep drag off the track | outcome |
|---|---|---|
| `auto` | **pointercancel x3** | the browser calls it a page scroll and TAKES THE DRAG AWAY |
| `none` | **pointercancel x0** | the drag survives |

So `input[type="range"] { touch-action: none; }` ships, and it is the same
decision `#splitter` already made for the same reason. The cost is stated in the
rule: you can no longer scroll the page by starting the gesture ON a slider,
which is the right trade for a control whose whole purpose is being dragged.

- **THE HONEST LIMIT, AND IT MATTERS**: `touch-action` governs TOUCH and PEN
  only. A MOUSE drag on Chromium was measured to hold at every speed and 350 px
  off the track. So if the report is from a mouse rather than a touchscreen,
  **this is not its cause and the cause is still unfound** - which is why the
  next step is a console read-out from the author's own browser naming the
  event that ends their drag: the v16.71 play that settled a four-round chase
  in one round.
- **MY FIRST TOUCH "REPRODUCTION" WAS THE PROBE, NOT THE APP.** It drove the
  touch points 250-400 px BELOW a slider sitting at y=647 in an 800 px
  viewport - off screen - and read the resulting dead drag as the bug. Worse,
  the fix then appeared not to work for the same reason, which nearly got a
  correct rule thrown away. Dragging UPWARDS, entirely on screen, is what
  produced the real comparison. The fixture is the bug, again, and the browser
  check now asserts its own probe stays inside the viewport.
- **VALUE-TRACKING PROVES NOTHING HERE, so it is not what is asserted.**
  Chromium's own slider stops following a steep touch gesture whether or not it
  was cancelled, so the check measures the CANCELLATION. Forcing `auto` back in
  the same run reproduces it (x2), which is what makes the rule load-bearing
  rather than merely present.

### AND THEN THE READ-OUT ARRIVED AND CORRECTED ME (v16.89, same sitting)

The console line from the author's own Chrome, with the reproduction in their
words - *"my mouse moved downwards while dragging and at the moment the mouse
stopped touching the slider, it stopped"*:

    id=vac-opacity | pointerType=mouse | touch-action=auto
    captured at press=false | value 80 -> 90 | pointermove count=37 | ms=1311
    events: pointerup:mouse

**IT IS A MOUSE, SO THE `touch-action` RULE ABOVE IS NOT THEIR CAUSE** - which
the entry had already said would be the case, and here it is.

**AND THE MECHANISM IS THE ONE I HAD JUST DISMISSED.** The 37 `pointermove`
events were counted ON THE ELEMENT. They stop when the cursor leaves it, and the
event list carries NO `pointercancel` and NO `lostpointercapture` - so nothing
took the drag away. **It simply stopped being delivered, which is what happens
when there is no pointer capture.** Their Chrome does not give the native range
one; the Chromium I measure in does, which is exactly why a mouse drag survived
350 px off-track here and dies the moment it leaves the track there.

`initSliderGrip` - one delegated `pointerdown` listener capturing the pointer
to any range input, one listener rather than one per slider (the v16.24 lesson)
- **IS THEREFORE THE FIX FOR THE REPORT, not the belt-and-braces this entry
called it two hours earlier.** The sentence it replaces read *"still a no-op in
Chromium for a mouse ... nothing asserts that it fixes anything"*, and both
halves were TRUE OF THE BROWSER I MEASURE IN and FALSE OF THEIRS.

- **THAT IS THE v16.55 SHAPE EXACTLY**: "no single field gives every colloquial
  name" was true of the two fields I looked at and false of the dataset. Here,
  "a native range already captures the pointer" was true of Chromium 1194 and
  false of the author's Chrome. **ONE BROWSER IS NOT THE PLATFORM**, and
  "measured" has to name WHERE.
- **WHAT SAVED IT WAS SHIPPING IT ANYWAY AND SAYING IT WAS UNPROVEN.** The
  v16.70 precedent (do not ship a safeguard that cannot be shown to do
  anything) would have deleted it. The line it turns on is whether the
  candidate ADDRESSES A REPRODUCED MECHANISM or merely sounds prudent: v16.70's
  `size` attribute was measured against the actual failure and did not fix it;
  this one could not be measured here at all, which is a different state and
  deserves shipping-with-a-caveat rather than deletion.
- **THE VERSION THAT MATTERS IS WHAT IS DEPLOYED.** `touch-action=auto` in the
  read-out is how we know they were on v16.88 - the fix was written but not
  merged. A report against a build that does not contain the fix is not a report
  that the fix failed, and reading the version out of the diagnostic is what
  distinguished the two.
- STILL NOT CLAIMED AS PROVEN HERE, and that has not changed: there is no
  browser on this machine where the capture demonstrably changes the outcome, so
  no check asserts that it does. What IS asserted is that the app takes the
  capture and has not broken the native drag. The proof is the author's own
  next drag on the deployed build.

- **ONE SHARP EDGE WAS FOUND AND DELIBERATELY NOT CHANGED**:
  `syncVacOpacityControls` writes the value back into the slider being dragged.
  It does not break the drag in Chromium, so changing it would be an unprovable
  fix in the same sitting. Recorded, not shipped.

### THE SERA VMC-MINIMA MODAL IS GONE (the author: "it doesnt add anything other than extra space")

A header button opening a static quick-reference table of SERA.5001 visibility
and distance-from-cloud minima. It computed nothing and restated what the AIP
states, so it was header space and an overlay id for a table.

**THE DAYLIGHT CARD IS A DIFFERENT FEATURE AND STAYS**, and the two are asserted
separately so the removal cannot be read as taking the day-VFR work with it: the
card COMPUTES the legal day-VFR window per SERA Art. 2(97), which is the v16.3
feature, and `daylight.js` is untouched. A test guards that the modal stays
removed AND that the card still computes - discipline rule 3, both directions.

The removal took three inline handlers with it, so the page's own stated handler
count went 136 -> 133; the L3 test re-measures it, which is how that was caught
rather than left to drift.

**VERIFIED BY PIXELS, which is the standing rule for a CSS change (v16.19).**
Against v16.88 in real Chromium: 7 669 pixels differ and EVERY ONE of them is
in the header band - bbox x 300-959, y 19-62, 23 rows - which is the button and
the shift of the ones beside it. Nothing in the map, the sidebar, the table or
the cards moved, the figure is identical in light and dark, and computed styles
are identical. A COUNT ALONE COULD NOT HAVE SAID THAT: it takes the bounding
box to tell a removed button from a layout that shifted.

### TWO COMMENTS TRIPPED THEIR OWN GUARDS

- Writing `lostpointercapture` in the comment EXPLAINING its removal failed the
  test that greps for it. The v16.46 note says it exactly: a comment can trip a
  source-level guard, and the answer is to reword rather than weaken the guard.
- A new test compared `indexOf('addSplitterTracking()')` against
  `indexOf('setPointerCapture')` and failed CORRECT code, because the comment
  above the call names the function too. It anchors on `bar.setPointerCapture(`
  now. An anchor that prose can match is not an anchor - the v16.82 lesson in a
  smaller shape.

### AND THE NEW BROWSER CHECK BROKE THE ONE AFTER IT

Dropped into the middle of the splitter sequence, the grip checks moved the
divider that the next check measures ("the divider is where it was left after a
reload"), which then failed on correct code. They run LAST now. A check that
mutates shared state is not free to sit anywhere.

### FOUR MUTATIONS

Bar-only listeners restored (1 test + 2 browser checks, the browser ones
reporting `asked 838, got 838` -> `got 598`: the divider does not move at all,
which is the pilot's symptom); the capture-lost end-of-drag restored (1 test);
the `touch-action` rule deleted (1 test + 2 browser checks, reporting
`touch-action: auto` and `pointercancel x1`); and the slider grip removed -
**not caught, by construction**, for the reason above. None died only in `tsc`.

## A CACHED GATE LOCKED THE PILOT OUT OF THEIR OWN SITE (v16.88)

The pilot, the morning after v16.87 deployed: *"im not allowed into the
flightplanner anymore, password isnt working"* - and then, decisively,
*"private worked"*. The passphrase was right the whole time. An incognito
window had no cache; the everyday profile did.

### THE MECHANISM, MEASURED RATHER THAN GUESSED

GitHub Pages sends **`cache-control: max-age=600`** on every file. Each URL
ages out on its OWN clock, so for ten minutes after a deploy a browser can hold
the OLD `index.html` while fetching the NEW payloads. And **every lock run
re-salts** - proved by locking twice with one passphrase and reading the salts
back: `d0fOUjsOnu5Q9hVso189rg==` against `aLqo6NjEhqEBdGenuIMEQQ==`, different
ciphertext. So the key derived from the stale page cannot open fresh ciphertext,
the GCM tag fails, and the gate said the one thing that was false:
**"That passphrase does not unlock this build."**

**REPRODUCED EXACTLY** before anything was changed: build A's gate + build B's
payloads + the CORRECT passphrase -> that message.

**AND IT CEMENTED ITSELF.** The service worker's `shellFirst` calls `fetch()`,
which goes THROUGH the HTTP cache - so it could pull the stale gate and
`cache.put` it, outliving the 600 s window entirely. That is why clearing site
data was the only way back in and why a hard reload was not enough.

### THE FIX IS THIS PROJECT'S OWN RULE, UNAPPLIED TO THIS SURFACE

`data/vac/` has shipped content-addressed filenames since v16.86
(`endu-2026-05-14-f93dd046-r1.webp`) for exactly this reason. The lock's
payloads were `body.enc`, `app.enc`, `aip.enc`, `vac.enc` - **fixed names, so
two builds' ciphertext occupy the same URLs and a cache can serve a mixture of
them.** They now carry a build id derived from the salt and the sealed bytes
(`buildIdFrom`, SHA-256, first 8 hex), so **a gate can only ever name payloads
it was built with**: the mismatch becomes a 404 instead of a wrong-passphrase
verdict. Straight *AN OLD RULE NOT APPLIED TO A NEW SURFACE*.

**THE 404 IS THEN HEALED, NOT JUST REPORTED.** `staleReload` unregisters the
service worker, drops its caches, forgets the stored key and reloads - which is
precisely what the pilot would otherwise be told to do in devtools.

- **`location.reload()` REVALIDATES, AND THAT HAD TO BE MEASURED** or the heal
  would be a promise the platform revokes. Against a fixture serving Pages'
  own `max-age=600`, the reload arrives as `cache-control: max-age=0` with the
  ETag, reaches the server inside the window, and gets the fresh gate. Measured
  end to end: booted, map up, no page errors.
- **ONCE PER SESSION.** If the payloads really are absent - a half-finished
  deploy - reloading for ever is worse than saying so. The second time it says
  the page is out of date and stops.

### THREE FIXTURES AND ONE ASSERT WERE WRONG BEFORE ANY CODE WAS

- **THE FIRST HEAL FIXTURE WAS A STATIC DIRECTORY**, which serves the stale
  gate for ever - so the reload met the same stale page, the loop guard
  correctly stopped, and a WORKING heal reported `booted: false`. The fixture
  is the bug, again.
- **THE SECOND SENT NO `cache-control` AT ALL**, so the browser had nothing
  cached and the reload could not demonstrate anything. A cache fixture that
  does not cache is not the situation.
- **THE GATE-METADATA TEST WAS VACUOUS.** `PARTS` lost its `file` field in this
  change, and the test compared `q.file === p.file` - `undefined === undefined`
  on both sides. It passed throughout. Same shape as the v16.66 finding where
  both sides read `''`: *a comparison against a value that cannot be there
  proves nothing in either direction.*
- **`navs <= 3` PASSED WITH THE LOOP GUARD REMOVED.** The promise is ONE
  self-heal per session, so the assert is `navs === 2`. M5 by name, caught only
  because the mutation was run.

### THE CI GUARD CANNOT LIST THE NAMES ANY MORE, SO IT COUNTS THEM

The workflow's leak check used to name each payload. Names now change every
run - which is the entire point - so it requires exactly four `.enc` files,
greps every one of them plus the gate for the app's identifiers, and then
**reads the payload names OUT OF THE GATE and requires each to exist**. A gate
asking for a file that was never written is the same lockout arriving from the
other direction, and it would otherwise ship green.

`verify:locked` reads the names from `META` for the same reason, and its new
section serves 404s for the payloads and asserts the gate does not blame the
passphrase, refreshes itself once, and then says what is wrong.

### THREE MUTATIONS, ALL CAUGHT BY NAME, NONE ONLY IN `tsc`

Fixed payload names (2 tests, 0 `error TS`), the stale branch routed back to
the passphrase message (3 browser checks, reproducing the pilot's exact
sentence), and the once-per-session guard removed (2 browser checks, one of
which only bites since the assert was tightened).

### WHAT THIS DOES NOT FIX, AND IT WAS SAID RATHER THAN GUESSED

Whether the `SITE_PASSWORD` secret was ever changed cannot be determined -
GitHub stores it encrypted and will not show it back, which is the property
that makes it the right place for it. The lockout is explained completely
without that, and the passphrase was never asked for.

## THE FLOOR IS THE SHEET COUNT, NOT THE ZOOM (v16.87)

The pilot: *"I would like it to show VAC further out than zoom 10 please, and
when clicking Show VAC on the screen, make the opacity slider pop up under it
for convenience."*

### THE OLD FLOOR'S REASON WAS HALF RIGHT, AND THE HALF THAT MATTERED WAS WRONG

v16.86 refused anything below zoom 10 on two grounds: the sheet is a smear that
far out, and the downscaling is wasted decode. The legibility half is a
judgement about their own eyes and their own chart - theirs to make, exactly
like the v16.62 corridor ceiling. **The COST half was measured and turned out
not to be about zoom at all.**

MEASURED in Chromium, using Leaflet's own bounds on the REAL map container:

| zoom | worst-case sheets in view, anywhere in Norway |
|---|---|
| 7 | 20 |
| 8 | 9 |
| 9 | 6 |
| 10 | 4 (the shipped floor) |
| 11 | 3 |

And the cost follows that column, not the zoom: **12 sheets froze the map for
2.2 s** while it rasterised; the same viewport with 3 settled in **727 ms**.
**Once settled, even 12 sheets pan in 17 ms** - the whole cost is first paint.

So the floor moves to **8** and `VAC_MAX_DRAWN` bounds the load. **6 is DERIVED,
not picked**: it is exactly the worst case zoom 9 already produced, so going
further out can never cost more than the old floor's own neighbour already did.

**ZOOM 7 STAYS REFUSED, AND NOT FOR COST** - the cap would bound it just as
well. Capping there would hide **14 of 20** sheets, and a chart that is silently
absent is worse than one that was never offered. That is the same rule the
fail-closed gate turns on, pointed at a different cause.

**A PARTIAL OVERLAY SAYS IT IS PARTIAL.** Everything else this overlay withholds
is withheld for ACCURACY and would be wrong to draw; these are CORRECT sheets
left out for load, so the label bar reads `6 of 10 on screen, nearest first` and
a pilot cannot read the gap as "no chart published at that aerodrome".

### THREE OF MY OWN MEASUREMENTS WERE WRONG BEFORE ONE WAS RIGHT

Worth recording, because each looked authoritative and each would have set a
constant on a false premise:

1. **`img.decode()` MEASURED NOTHING.** 1 chart 1235 ms, 9 charts 1193 ms - flat,
   because decoding is off-thread and `decode()` resolves when the image is
   decodable rather than when it is rasterised. `performance.memory` was flat at
   10 MB for the same reason: image memory is not JS heap.
2. **THE FIRST PAN MEASUREMENT CONFLATED FIRST PAINT WITH STEADY STATE.** It
   reported 705 ms at z7 and 17 ms for the same 12 sheets a run later; the
   difference was that the second run waited for the images to settle. I was one
   step from adding a cap on the strength of a number that did not mean what I
   thought. The honest measure is *how long until a pan is fast again*.
3. **AN OFFLINE GRID SCAN OVERSTATED EVERY COUNT** because it assumed the whole
   window. The map container is **597x874** in the split layout, not 1500x950,
   so z8's worst was 9 and not the 13 I had computed. Leaflet's own `getBounds`
   is the only authority for what is on screen.

### THE OPACITY IS WHERE THE CHART IS

A slider under the `▦ VAC` button, appearing with the layer and going away with
it. The value a pilot is hunting for is found by sliding it and LOOKING at the
chart, so reaching Settings, sliding, and coming back was the wrong shape.

- **ONE WRITE POINT, because there are now two controls for one number.**
  `setVacOpacity` is the only thing that assigns `vacOpacity`; both sliders call
  it and it refreshes both. This project has been bitten by a second rendering
  of one value drifting from the first (v16.35, which is why the fix preview
  calls the map's own `fixSymbolSvg`).
- **HIDDEN WHILE THE LAYER IS OFF.** A slider for something that is not drawn
  adjusts nothing the pilot can see.
- It is inside `#map-controls`, so like every control since v16.24 it needs no
  CSS of its own to be on screen.

### AND THE BROWSER CHECK FOR IT PASSED A BROKEN BUILD

`verify:vac` drags the MAP slider and asserts the Settings one follows. A
mutation making the SETTINGS slider write the value itself - the exact drift
`setVacOpacity` exists to prevent - **passed untouched**, because the check only
ever drove one of the pair. It drives both directions now, and the same mutation
fails by name (`the map slider followed IT (20 vs 70)`).

**THE SAME SHAPE AS v16.66**, where both sides of a comparison read `''` and the
check passed while a control was three places adrift. One direction of a
two-way binding is not a test of the binding.

### A CONTROL HIDDEN ON PURPOSE IS NOT THE v16.22 FAILURE

`verify:fixes` asserts every map control has a real box on screen, and the new
slider starts hidden - so it failed a correct build. The guard was right to fire
and wrong to fail: v16.22's bug was a control that was DISPLAYED and sat at
y=900 on a 900 px viewport, not one the app had deliberately removed from the
layout.

Hidden controls are no longer measured, but **the SET of them is asserted**, or
this would quietly excuse a button that vanished by accident. Proved by giving
`corridor-btn` a `display:none` - it fails by name
(`[corridor-btn,vac-opacity-ctl]`).

### FOUR MUTATIONS, ALL CAUGHT BY NAME, NONE ONLY IN `tsc`

The cap as `Infinity` (1 test), the slice disabled while the constant stayed
6 (1 test + 2 browser checks - the mechanism, not just the number), the settings
slider bypassing the one write point (2 browser checks, after the check was
fixed to drive both directions), and a control hidden by accident (1 browser
check).

## THE VAC IS DRAWN ON THE MAP, AND A SHEET THAT CANNOT BE PLACED IS NOT DRAWN (v16.86)

`▦ VAC` puts each aerodrome's own Visual Approach Chart on the map in place, at
its published position, from zoom 10 up (**8 since v16.87 - see the entry above
for why that floor was the wrong thing to be measuring**). 49 charts, one lossless WebP each in
`data/vac/`, listed in `data/vac-index.js`. Nothing is fetched from Avinor at
runtime.

**THIS SUPERSEDES THREE RECORDED DECISIONS, and each for a different reason:**

- *"THE CHART RASTER IS STILL NOT GEOREFERENCED"* (v16.34) said a VAC overlay
  was out of reach because the PDFs carry no GeoPDF markers. The premise is
  still TRUE - `/Measure`, `/GPTS` and `/Viewport` are absent across the
  edition - and the conclusion was wrong. A sheet with no georeference can
  still be georeferenced FROM ITS OWN INK, which is what this does.
- *"georeferenced VFR charts (licensing)"* under Not planned applies to the
  1:500 000 ICAO tiles, which are a different product under different terms.
  The VAC is AIP Norge, the same source as the rest of the AIP data.
- *"Do NOT read coordinates off a chart image"* (v16.34) is UNCHANGED AS A DATA
  RULE and must stay that way. The raster is DISPLAYED, never read. The 243
  reporting points still come from the printed coordinate TABLE; the symbols
  this build locates are used to FIT the sheet and never to publish a position.
  `src/lib/vac.js` touches no pixel and a test asserts it.

### THE MODEL IS CONFORMAL, AND THAT IS WHY THE EDGES DETERMINE THE MIDDLE

A four-corner image overlay is not close. MEASURED over ENDU: Web Mercator plus
corner bounds leaves **409 m rms / 790 m worst**, and the best named projection
with an affine fit still leaves **43 m** - at 69 N that is a quarter of a
nautical mile of chart ink in the wrong place.

Any conformal projection of the ellipsoid is a HOLOMORPHIC function of
`longitude + i·(isometric latitude)`, so the inverse page→coordinate map is
fitted as a complex polynomial: real part longitude, imaginary part isometric
latitude, **both linear in the coefficients, so it is one least-squares solve**.
Order 2 reaches **0.069 pt**, and order 3 gains 3% while order 4 gains nothing -
because 0.069 pt IS the sheet's own drafting precision (tick positions are
snapped to a 0.24 pt grid whose standard deviation is 0.069 pt). The model has
hit the chart's own quantisation and no further order can help.

**THE POINT OF CONFORMALITY IS THAT THE GRATICULE ONLY EVER OBSERVES THE
BOUNDARY.** A polynomial in `x + iy` cannot produce a shape that is not a
projection, so fitting the edges constrains the interior. A general 2-D
polynomial would not.

**AND I HAD THE REASON FOR THE FOURTH EDGE WRONG, then measured it.** I wrote
that all four edges were needed for RANK. They are not: two edges really are
degenerate and the solver refuses them, but **three edges fit fine and reproduce
the fourth to 25.9 m** - the Cauchy-Riemann relations tie the imaginary part to
the real one, so longitude on two lines plus latitude on one nearly determines
the model. The fourth edge is needed to CHECK, not to solve: it is what lets the
two edges of each axis be compared, which is the test that catches labels read
one major out. A chart missing a usable edge is REFUSED, never fitted on three.

### THE ANCHOR IS THE BOUNDING-BOX CENTRE, AND THE PROOF IS THAT THE ERROR SCALES

Published points are the PRIMARY control where the sheet prints a table (the
addendum's order, and the right one: the table is the AIP's own statement at
full precision). Each tabled point is also drawn as a filled triangle - so which
point OF THE TRIANGLE is the published coordinate decides everything, and
getting it wrong is SILENT: every point moves the same way, so the chart stays
internally consistent and still lines up with itself.

- It is the **bounding-box centre**, not the centroid. For a triangle the
  centroid sits h/6 below it, which on these sheets is ~1.3 pt = **~170 m**.
- MEASURED over 199 matched points at three symbol sizes: the offset from the
  CENTROID grows with the symbol (1.329 / 1.367 / 1.409 pt at perimeter 25.9 /
  28.1 / 30.6, tracking the geometric h/6 prediction of 1.246 / 1.350 / 1.473),
  while the offset from the BOUNDING-BOX CENTRE stays at zero (0.086 / 0.021 /
  -0.060 pt).
- **THAT SCALING IS THE WHOLE PROOF.** An error in the fitted MODEL would be a
  constant distance, independent of how big the symbol happens to be drawn. An
  error in the ANCHOR is proportional to the symbol. It is proportional.

**A HOLDOUT CANNOT SEE THIS, WHICH IS WHY THERE IS A SECOND GATE.** Fit points
and held-out points share the anchor convention, so a wrong anchor biases both
equally and the holdout comes back clean while the sheet is 170 m out. The
graticule is drawn from completely different ink, so requiring the two
independently fitted models to AGREE is the one check that sees a shared
assumption. Measured with the correct anchor: p50 24 m, worst 45 m, against an
80 m limit; with the centroid it is ~180 m.

### FAIL-CLOSED, AND THE GATE IS IN THE RUNTIME AS WELL AS THE BUILD

Every chart must pass its own holdout - **25 m** on published points, **50 m**
on the graticule - and the cross-check above. The measured residual and the
limit it was held to TRAVEL WITH EACH CHART in the index, and `vacRefusal`
re-checks them in the browser before anything is painted, so a hand-edited or
half-written index cannot put ink on the map either. Measured over the 49
charts: worst holdout 22.4 m, p50 1.1 m on published points and 11.9 m on the
graticule; 17 charts fit from published points and 32 from the graticule.

### THE SEAM CHECK IS A CORROBORATION AND IT SAYS SO - THE POPULATION IS THREE

Where two sheets cover the same ground they must agree about where it is, and
the only feature locatable on BOTH sheets is a published reporting-point symbol:
each chart is asked where ITS OWN ink for that point sits, using its own model,
and the two answers are differenced. Comparing the published COORDINATE would
measure nothing - it is the same number on both sheets.

**MEASURING IT FIRST IS WHAT SHOWED HOW LITTLE THERE IS TO MEASURE.** Of 18
pairs whose WGS-84 BOUNDING BOXES overlap, most do not overlap in COVERAGE at
all: a warped sheet's bbox is the envelope of a ROTATED QUAD, so two sheets that
merely abut share a bbox corner and no ground. **ENDU/ENTC - the pair that looks
most obviously adjacent, and the one the brief named - measures 0.0%.** Real
overlaps exist (ENBR's two sheets 94.7%, ENAL/ENOV 19.4%, ENHD/ENZV 16.6%), but
where they do the neighbour usually draws no symbol at the point. 13 points fall
inside both frames and **3 carry a symbol on both: 0.6, 11.4 and 19.5 m.**

So the limit is **derived, not picked**: each sheet is already held to 25 or
50 m, so two that both pass may legitimately differ by the sum. 60 m is 3x above
every observation and below that worst case. **It is not what holds the feature
up** - the per-chart holdout and the cross-check are - and the entry says so
rather than letting three data points look like a gate.

### THE ASSET IS DECOUPLED FROM THE EDITION; THE CHECK IS NOT

A VAC is amended per AIP AMDT, not per 28-day cycle, so re-preparing 49 rasters
every cycle would be churn - most are byte-identical. But an amended chart must
stop being drawn AT ONCE, because a superseded approach chart is exactly the
quietly-wrong answer this project refuses. So `npm run build:aip` re-verifies
every prepared chart against the live edition's own AD 2.24 table on every run,
writes `data/vac-source-verification-<edition>.json`, and stamps `superseded` on
the shipped index - after which `vacRefusal` will not draw it.

**THE AD 2.24 GRAPHIC ID IS THE TEST AND IT COSTS NOTHING**: those pages are
fetched for the airspace anyway, and Avinor gives an amended chart a new id.
The SHA-256 in the manifest stays the stronger statement about the FILE; this is
the statement about the REFERENCE. `vacGraphics` MOVED into `tools/aip-vac.mjs`
so both builds ask the same parser which PDF a chart is - two parses would be
two things that can disagree.

### 600 DPI AND LOSSLESS, BOTH BY MEASUREMENT

The addendum proposed 1200 dpi as a starting point and said to measure. Measured:
600 dpi is **1:1 at zoom 12**, caps the smallest print at 18.2 px, decodes in
880 ms and costs 3.7 MB; 1200 dpi costs **2246 ms** of decode and **323 MB** of
RGBA for detail no zoom reads. That is the v16.23 lesson - decode, not network,
is what makes a chart feel slow.

Lossy WebP at q92 shifts chart ink by **128 levels** at 600 dpi. png8 and jpg
are already BANNED here for shifting it 71 and 37, and the small print is the
entire point of the feature, so lossless it is.

**THE GDAL TRANSFORM WAS ALSO MEASURED, AND IT OVERTURNED THE ADDENDUM'S `-tps`:**
order 1 reproduces the fitted model to 158 m, order 2 to 1.16 m, **order 3 to
0.003 m**, and TPS to 7.08 m. `-order 3`. And the warp is not trusted to
reproduce the model - 49 OFF-GRID probes are pushed through GDAL's own transform
and compared, and a chart is refused above 1 m.

### Z-ORDER, AND WHICH HALF OF THE CLICK-THROUGH IS LOAD-BEARING

`vacPane` at z-index **360**: below the corridor (370), the airspace (380), the
route line and its 20 px grab line in `overlayPane` (400) and the fix markers
(600). It is chart paper - above the base tiles, below everything the pilot
touches.

**MEASURED BY MUTATION, and the obvious answer was wrong.** Two things keep the
raster out of the pointer's way, and they are not equal: with the pane set to
`pointer-events: auto` EVERY click-through check still passes, because Leaflet
leaves a non-interactive image layer inert on its own. So `interactive: false`
is the mechanism and **the pane rule is the backstop** for whatever a later
change adds to that pane. `verify:vac` flips the pane and re-measures, so the
comment cannot drift from the code. Setting `interactive: true` puts the image
straight under the cursor and fails by name.

### THE LOCKED DELIVERY NEEDED THE MANIFEST ENCRYPTED AND THE RASTERS NOT

`vac-index.js` is a separate `<script src>`, so until it became a `PART` the
decrypted page kept a link to a file `site-locked/` does not have: it 404s,
`window.C182_VAC` is undefined, `updateVacBtn` HIDES the control, and the whole
overlay is **missing from the deployed copy with nothing on screen saying so**.
It is app data exactly as `aip.js` is, and it is encrypted as a `vac` payload
(named `vac.enc` until v16.88 made the payload names content-addressed).

**THE RASTERS ARE COPIED IN PLAINTEXT, AND THAT IS ARGUED RATHER THAN ASSUMED.**
Encrypting them would be v16.78's own theatre argument pointed at a new asset:
**the repository is PUBLIC**, so every one of those WebPs is already served from
it, and ciphertext on the Pages copy would gate a file anybody can fetch from
the repo one click away. It would also cost the one code path - an `<img>` cannot
take ciphertext, so the overlay would need a decrypt-to-blob route existing ONLY
in the locked build. What the CI guard checks instead is that they really are
PICTURES: every file greps as a WebP, and a `.webp` that read as JavaScript would
mean something other than a chart was written there.

**SETTLED BY THE AUTHOR at v17.5**: the charts sit in a public repository and
that is their call, on their own responsibility (see "Data sources and credit").

`verify:locked` asks the deployed build directly - manifest decrypted, charts
passing the gate, and one raster actually fetching 200. Removing the part fails
it three ways by name.

### jsdom CANNOT ANSWER ANY OF THE QUESTIONS THIS FEATURE RAISES

`tools/verify-vac.mjs` (38 checks, real Chromium, offline) measures the pane
z-indexes as COMPUTED, clicks a reporting point THROUGH the drawn sheet and
requires exactly one waypoint on the published coordinate with no dialog, drags
the route line under it and requires a via with the waypoint count unchanged,
hovers the airspace through it, and projects 20 published fixes against the
overlay's own rendered box (within 0.81 px, ~11 m).

**TWO OF ITS OWN CHECKS WERE THE BUG, AND BOTH ARE THIS FILE'S NAMED FAILURES:**

- The airspace hover reported that the chart had swallowed the card. It had
  not: I took the polygon's BOUNDING-BOX CENTRE as a point to hover, and at
  zoom 12 the enclosing TMA's bbox centre is **24 000 px off screen**, so
  `elementFromPoint` returned null and nothing was hovered. It scans the
  visible map and PROVES an airspace path is under the point before using it.
- The drag check ran at **ZOOM 9, where the overlay is deliberately not drawn**
  - `fitBounds` on two reporting points landed wherever they happened to be
  apart - so it "passed" having proved click-through under nothing at all.
  Worse, it was written as `zoom >= 10 ? drawn > 0 : true`, a check that
  excuses itself. Straight M5. The view is SET now, the chart being drawn is
  REQUIRED, and the grab point is derived by walking the chord until the
  browser says the route hit-line is on top (the v16.83 rule: a hardcoded
  coordinate is an unchecked assertion about the layout, and when it is wrong
  the failure ACCUSES THE FEATURE).

### AND THE NAVIGATION INDEX HAD QUIETLY STOPPED POINTING AT HALF THE MODULES

Adding `vac.js` to `WHERE TO EDIT WHAT` found that the test guarding it carried
a HARDCODED LIST OF ELEVEN while `src/lib/` holds twenty - so anchors, airspace,
corridor, metar, ofpform, rhumb, keys, skins and vac had never been in the
index, the test passed throughout, and this file went on claiming it "asserts
the index still points at every module that exists". It reads the directory now,
so that sentence is true.

**AND THE FIRST VERSION OF THE FIX PASSED FOR THE WRONG REASON.** It searched
the whole PAGE, and nine of those modules are named in comments beside the code
that uses them - so deleting `vac.js` from the index changed nothing and the
mutation reported "not caught". It slices the index block and looks only inside
it; the same deletion now fails by name.

## THE ACC COLUMNS COUNT THE MISSION; THE TOTAL LINE COUNTS THE SECTOR (v16.85)

The pilot: *"make sure the accumulated distance carries over to the next OFP on
the printOFP page."*

**MEASURED on a two-sector mission before touching anything**: the second
sheet's ACC Dist restarted at **30.1 NM** while the ACC Time beside it read
**00:49**. Two columns printed under the same `ACC` heading, one counting the
sector and one counting the mission.

The cause was one declaration in the wrong scope. `runningAccTime` and
`runningAccBurn` are declared outside the flights loop, so they carry; the
distance was a `sectorAccDist` declared *inside* it and reset every sector. It
was also a duplicate - it incremented by exactly the same `dist` as
`sectorDist` on the line above - so this is a replacement, not an addition, and
v16.61's rule applies: prefer the deletion to the second mechanism.

Now `72.3 -> 126.5` across the boundary, beside ACC Time `00:34 -> 01:00` and
Fuel Acc `6.9 -> 12.3`.

### AND MEASURING IT FOUND A WRONG NUMBER ON THE PAPERWORK

The Total line at the foot of a sheet was `dist: sectorDist`, `time:
sectorTime`, **`burn: runningAccBurn`** - two sector figures and one mission
figure on the same line. On a one-sector flight those are the same number,
which is exactly why it had never shown. Measured on the two-sector fixture,
sheet 2's Total line read **54.2 NM / 00:26 / 12.3 gal** where that sector had
burned **5.4**.

**THE SHEET CARRIES ONE DEP AND ONE DEST, SO "TOTAL" MEANS THAT SECTOR.** All
three figures are the sector's now. `rem` deliberately stays the running
figure: fuel remaining is a STATE at the end of the sector, not a sum over it,
and a test asserts it still matches the last row's EST.

So the two rows answer different questions on purpose, and the guide now says
so: the ACC columns run to the end of the mission, the Total line is this
sector.

### THE WORST CASE WAS NOT WORST ANY MORE

Accumulating over the mission makes ACC Dist the one figure on the form with no
bound short of the flight itself, and `verify:ofp` existed to prove a value
FITS its printed cell. Its 19-leg fixture only reached three digits, so the
cell that now has to hold four was never measured. The longitude zigzag is
widened to about 64 NM a leg: the sheet reaches **1215.8 NM**, and **0 of 394
filled cells overflow**. A check fails if the fixture ever stops reaching four
digits - the M5 trap, where a fixture quietly stops exercising what it claims.

**TWO MUTATIONS, BOTH CAUGHT BY NAME, NEITHER ONLY IN `tsc`**: resetting the
accumulator per sector reports the pilot's own symptom (`72.3 then 30.1 - while
ACC Time went 00:34 -> 00:49`) and fails a second test with a NEGATIVE sector
distance; restoring the mission burn on the Total line reports `12.3 but this
sector burned 5.4`.

## A CIRCUIT IS TIME AND FUEL, NEVER A PLACE (v16.84) - THIS REVERSES v16.83

The pilot, three days after v16.83 shipped: *"pattern should NOT be a point
where things can be flown out and in from. If i start a flight from ENDU in
pattern, i want to be able to fly pattern at ENDU and after pattern continue my
flight plan from ENDU to ENEV for instance. If the pattern is its own point, the
next leg will be flown from where i placed the PATTERN sign. Pattern should only
be a 'time and fuel addon' not a place."*

**READ THE v16.83 SECTION BELOW AS HISTORY, NOT AS THE RULE.** Its diagnosis was
right - the pattern's position was used as the START of the next leg and never
as the END of the previous one, and the transit fell down the gap. Its FIX chose
the wrong side of that asymmetry: it made the marker real at both ends, which
priced the detour honestly and gave the pilot a detour they never wanted.

Measured on `ENDU -> PATTERN -> ENEV` with the marker dropped 23 NM off track:
the sector walked **76.1 NM** where ENDU -> ENEV is **53.0**.

### ONE INVARIANT, AND EVERYTHING ELSE FALLS OUT OF IT

*A PATTERN waypoint sits at the position of the waypoint it follows, always.*

- the leg REACHING a circuit then covers no ground, so it has no row, no
  schedule leg, and breaks the altitude chain exactly as v16.43 requires;
- the leg LEAVING one runs from the fix you were already at, so a circuit at
  ENDU is followed by **ENDU -> ENEV** - and that leg takes **via points** like
  any other, which is the thing v16.83 was originally asked for. It is fixed
  here by the cleaner route: there is one leg to bend instead of two.
- **A LEADING CIRCUIT KEEPS ITS OWN POSITION.** There is no waypoint before it
  to borrow one from and it IS where the plan starts.

`applyPatternPositions` (exchange.js) is the rule. **v16.83's machinery is kept
and does the right thing once positions are snapped** - `legIsFlown`, the
circuit row, the leading-circuit charge, the map-vs-engine sweep invariant all
stand unchanged. The reversal is one normaliser, not a rewrite.

### ENFORCED WHERE A POSITION IS READ, NOT WHERE ONE IS WRITTEN

There are a dozen writers - the add flow, a drag, a delete, an insert, a rename
to PATTERN, an import, a route load - and a normaliser that has to be remembered
at each of them is this file's first named failure shape waiting to happen. So
it runs at the three places a position is READ (`refreshMap`,
`renderAllFlightTables`, `drawLiveLine`, via one `syncPatternPositions`) plus
`sanitiseFlights` for the load door. Dragging the fix a circuit hangs off takes
the circuit with it; deleting that fix re-homes the circuit onto whatever now
precedes it; a plan saved by v16.83 is corrected on the way in.

**THE ADD FLOW SNAPS ANYWAY, AND THAT IS NOT REDUNDANT.** The render doors fix
the POSITION, but the circuit altitude and the variation are derived at the
moment of adding - so deriving them from the click describes an aerodrome the
aircraft never goes near. Clicking 38 NM away at ENTC while sitting at ENDU must
give ENDU's told 1500 ft, not ENTC's derived 1000. A mutation proves it: with
the snap removed the test reports `1000 ft` by name. The toast says out loud
where the circuits were logged, because a control that silently ignores where
you clicked is worse than one that explains itself.

**A CIRCUIT IS NOT DRAGGABLE** (except a leading one, which is its own
position). A marker you can drag that snaps straight back offers a gesture the
plan cannot honour.

### THE SWEEP GENERATES THE DISPLACED SHAPE ON PURPOSE

Half the generated circuits arrive off-fix - not a shape the app writes, but
exactly what a v16.83 file or a hand-edit carries - and the sweep runs the REAL
`applyPatternPositions` over them, then asserts on every plan that no circuit is
anywhere but on its fix. So it exercises the normaliser rather than a
restatement of it, and everything downstream computes what the app computes.
v16.83's generator kept the displaced shape as a first-class case and asserted
its legs got scheduled; keeping that would be a sweep defending a rule the app
no longer has.

### SEVEN MUTATIONS: SIX CAUGHT BY NAME, ONE PROVED REDUNDANT AND DELETED

Emptying the normaliser (5 tests + 492 sweep violations), stopping the render
doors syncing (4), letting the sanitiser through (1), the add flow using the
click (1, reporting the wrong circuit altitude), and making circuits draggable
(1). None died only in `tsc`. The seventh is the stop-time guard below.

## THE GROUND TIME BELONGS TO THE SECTOR IT DELAYS (v16.84)

The pilot: *"If i have a final full stop at a point, the 10 minutes get added at
the total flight time in the bottom place for total values ... even after having
deleted the next flight plan. I dont mind it adding a new flight plan for me to
delete, but the 10 minutes should be a part of the new flight plan, not added to
the old time."*

Measured on one 18-minute sector ending in a full stop: the mission read
**00:28**. The ground time was added to the running clock at the END of the
sector the stop was made on, so it fell into that plan's share of the mission
rather than into the one whose off-block it actually moves - which is also the
plan whose header the pilot edits it in (v16.54 said so and the code did the
other thing).

- It is QUEUED now and applied at the START of the next sector, before
  `sectorStartMin` is taken, because the delay is exactly what moves that
  sector's off-block. Its minutes open that plan's total; its circuit fuel, its
  refuel and its taxi re-arm go with them.
- **A STOP WITH NO SECTOR AFTER IT COSTS NOTHING.** A full stop is a landing:
  with nothing to delay, ten minutes of ground time is not flight time and not
  fuel. Add a sector and the figures appear on it.
- **THE QUEUE IS WHAT MAKES THAT TRUE, AND THE EXPLICIT GUARD WAS DELETED.**
  The first version also tested `fIdx + 1 < flights.length`. Mutating that away
  changed no figure and failed no test - a stop queued on the last sector is
  never applied because there is no iteration left to apply it. Two mechanisms
  for one job, one of them invisible: v16.61's rule says prefer the deletion,
  so the redundant test is gone and the mutation that DOES bite (re-adding the
  end-of-sector charge) reports the pilot's own symptom, `00:29 vs 00:19`.

## A PATTERN IS A PLACE, AND THE FLIGHT OUT TO IT IS REAL (v16.83 - REVERSED at v16.84, see above)

The pilot: *"Sometimes i want to do airwork during a route or start the plan in
pattern. If i set pattern as a point (which is fine btw, i dont mind writing
pattern to do airwork) i cant set via-points on the same leg."*

The via points were the symptom. **Measuring before touching anything found that
the plan underneath them was wrong**, and by a lot.

### WHAT WAS MEASURED, ON `ENDU -> A -> PATTERN -> B -> ENTC`

| | before | true |
|---|---|---|
| sector distance | **51.7 NM** | 65.6 NM |
| the leg A -> PATTERN | charged **nothing** - no distance, no time, no fuel | 13.9 NM |
| what the map drew | A -> B, 27.8 NM | A -> PATTERN -> B |
| what the table priced for that stretch | PATTERN -> B, 13.9 NM | |
| red banner | **none** | |

A right-click meant for either of the pattern's legs did not decline politely
either: `findPathInsertion` skipped them and **handed back the nearest OTHER
leg** - 5.6 NM away - so the gesture silently bent a different part of the
route. That is what "i cant set via-points" looks like from the cockpit.

And **a plan that STARTS with circuits was charged nothing at all**: the circuit
row was emitted from the `to.isPattern` branch, and the first waypoint is never
anybody's `to`. Four laps at ENDU before departure cost 0 minutes and 0 gallons.

### THE CAUSE IS THIS FILE'S OWN FIRST NAMED FAILURE SHAPE

**An old rule whose PRECONDITION a new surface silently broke.** `from.isPattern
|| to.isPattern` meant "this leg covers no ground", and that was TRUE while the
only way to make a circuit was `addPatternStop` - which COPIES the previous
waypoint's coordinates. The map-click path never had that property: it puts the
PATTERN where you clicked. From then on the pattern's position was used as the
START of the next leg and never as the END of the previous one, and the transit
fell down the gap between the two.

### THE FIX IS TO DERIVE IT, NOT TO DECLARE IT

`legIsFlown(from, to)` is `pathSegments(from, to).length > 0`, and
`pathSegments` already drops any span under 0.01 NM. So:

- a circuit flown **where you already are** (touch & go, full stop) has no
  segments - no line, no row of its own, no schedule leg, chain broken exactly
  as v16.43 requires;
- an **airwork point out on the route** has segments, so both its legs are
  ordinary flying: distance, track, climb or descent, wind sampling, integrity
  checks, plotting list, TOC/TOD marks, **and via points**.

One test, one source, and it cannot disagree with what the engine walks - the
v16.76 lesson (*the corners are derived*) applied to the ground track.

**NOTHING ABOUT AN AERODROME CIRCUIT CHANGES**, and that is checked rather than
assumed: `addPatternStop` copies the coordinates exactly, so the transit leg is
degenerate and every existing plan computes what it always did.

### THE OFP GREW A ROW, AND THE CHAIN READS DOWN THE SHEET

    ENDU    -> A          16.6 NM      the leg
    A       -> PATTERN    13.9 NM      the transit out to the airwork  (NEW)
    PATTERN -> PATTERN    3 laps       the circuit, at the point
    PATTERN -> B          13.9 NM
    B       -> ENTC       21.2 NM

The circuit row's first cell is now **where the laps are flown**, not the fix
before them, so `to` of each row is `from` of the next all the way down - which
is how a pilot reads the sheet, and a test asserts it. `emitCircuitRow` is a
function precisely because it is no longer one-per-leg: it is also called before
the loop for a plan that opens with circuits.

### A CIRCUIT ATTACHED TO A FIX IS NOT DRAGGABLE; AN AIRWORK BLOCK IS

Dragging a touch & go off its aerodrome would silently turn a landing into a
cross-country detour and strand the stop and refuel figures, which read the fix
before it. A PATTERN the pilot clicked already stands alone, and a place you
cannot nudge would be the one position in the app that is not editable.
`patternPinned` is the same derived test.

### WHAT IS DELIBERATELY NOT CHANGED, AND IT IS A KNOWN LIMIT

**The daylight card and the form's DEP/DEST box still skip PATTERN waypoints.**
So a plan that starts with circuits at ENDU is still judged for day VFR at the
NEXT fix, and the DEP box still names it. That is pre-existing and it is the
lesser of two wrong answers while the add-flow forces the name to the literal
"PATTERN": a card reading *"Departure PATTERN"* is not an improvement. The sun's
position over 16 NM moves by well under a minute, so the legality verdict is
unaffected - it is the LABEL that has no good value. Fixing it properly means
letting an airwork point keep its own name, which collides with the v16.48 L7
rule that "PATTERN" is the reserved marker in both directions. On the deferred
list, not silently absorbed.

### SIX MUTATIONS, ALL CAUGHT BY NAME, NONE ONLY IN `tsc`

Skipping patterns in `flightLineCoords` (3 tests), refusing them in the hit-test
(2), breaking the chain on the flag again (3), dropping `alt = null` from the
degenerate leg - the v16.43 regression - (2, reporting the original 2500 ft
stale figure), emitting the circuit instead of the transit (2, reporting the
original **51.7 vs 65.6 NM**), and no row for an opening circuit (1). The
browser check fails three ways on the hit-test mutation, one of them printing
`Leg ENDU -> ENTC` for a right-click on the AIRWORK -> ENTC leg: the pilot's
report, reproduced.

### THE INVARIANT THAT WOULD HAVE CAUGHT IT ON DAY ONE

*The route the pilot READS off the map and the route the OFP PRICES are the same
route.* The sweep now walks `flightLineCoords` and sums the scheduled legs, and
requires them equal. **The tolerance is derived, not picked**: `pathSegments`
measures each span with `calcDistanceNM`, which rounds to 0.1 NM, so the two
sides may differ by 0.05 NM PER SPAN and by nothing else - three orders of
magnitude below the 13.9 NM leg this exists to catch.

### THE SWEEP HAD BEEN GENERATING A SHAPE THAT EXISTS NOWHERE

It offset every circuit **0.6 NM** from the fix before it - neither of the two
shapes the app can produce. So for forty versions it swept the middle case and
neither real one. It now generates both, and asserts each count separately: a
tally of "routes with a circuit" is what let this hide.

**AND FIXING THAT KNOCKED OUT AN UNRELATED PATH, WHICH IS THE INTERESTING PART.**
`bodRefused` - a BOD pin refused because a later, lower fix has already claimed
the leg's tail - was being reached by LUCK, 12 times in 4000 routes. Re-weighting
the generator dropped it to **0 across three seeds**. Luck is not coverage, and a
path nothing exercises is a path nothing guards, so the squeeze shape (a low fix
close behind a high one, with a BOD pin on it) is now BUILT on purpose: 513 per
run, 48 refusals. The directed construction was verified to still produce
`bodRefused` before the sweep was changed, so the coverage is real and not a
threshold moved to fit.

### AND ONE FAILING CHECK WAS THE CHECK'S OWN ARITHMETIC (found chasing v16.83)

`verify:fixes` reported **"a click on bare map still asks for a waypoint name
([])"** - on v16.83 and, when stashed, identically on v16.82, so not from this
work. It was not the app: it was `page.mouse.click(700, 450)`, a literal written
at v16.34 when 1400x900 laid out SPLIT and that was the middle of the map. Two
later changes moved the ground under it and nothing re-checked:

- **v16.49's layout auto-pick** made this viewport STACKED, so the map is only
  **1400x378** and y=450 is 4 px PAST its bottom edge;
- **v16.67 gave the divider a grab area** - `#splitter::after`, `inset: -6px 0`
  in the stacked layout - spanning the **full width** at y=448-462.

So the click landed on the divider. `elementFromPoint(700, 450)` returns
`DIV|no-print|splitter`, one probe, and that was the whole diagnosis.

- **A HARDCODED COORDINATE IS AN UNCHECKED ASSERTION ABOUT THE LAYOUT**, and the
  failure it produces ACCUSES THE FEATURE. "Bare map no longer adds a waypoint"
  was a true statement about the click it made and a false one about the app -
  the expensive kind of wrong, and the reason this sat failing unnoticed.
- THE POINT IS DERIVED NOW, and the check **proves it is bare map BEFORE it
  clicks**: it walks in from the map's own centre until `elementFromPoint`
  resolves to something inside `#map` that is not the splitter, a control, a
  marker or the overlay pane, and fails by name if no such point exists. It
  picked (700, **265**) - the old literal was right about x and 185 px wrong
  about y. It is the only hardcoded click left in any verifier; `verify:layout`'s
  three all derive their y from the bar's own rect.
- **BOTH HALVES PROVED BY MUTATION.** Restoring the literal reproduces the
  original `([])` failure, so the derivation is what fixed it. And widening
  `#splitter::after` to `inset: -400px 0` - an overlay that really does eat the
  map - makes the finder return `found: false` naming `splitter`, so the new
  check still fails on a genuine regression of this shape rather than hunting
  around until something works.
- **THE 6 px GRAB BAND IS NOT A BUG AND STAYS.** It is v16.67's stated
  trade-off, the same one the 20 px invisible route hit-line makes: a 2 px bar
  is not a 2 px target. It costs 6 px of the map's bottom edge (stacked) or
  right edge (split), at the panel boundary, and that is the price of the bar
  being findable at all.

**A VERIFIER THAT THROWS LOSES EVERY CHECK BELOW IT**, and the mutation found
that too. With no waypoint added, `waypoints.slice(-1)[0]` is undefined and
reading `.name` threw out of the script at line 115 - so ONE broken thing
reported itself as a verifier that "did not run", taking ~40 checks with it.
It returns nulls and lets the checks FAIL now: the mutated run reaches 21 checks
instead of 8 before Playwright stops it with `#splitter intercepts pointer
events`, which names the cause exactly. Same family as the v16.75 lesson that a
suite exiting 0 with no RESULT line has not passed.

**NO VERSION BUMP FOR THIS.** `src/` is untouched, so the shipped artifact is
byte-identical to v16.83, and numbering two identical builds differently is the
same documentation-versus-artifact drift discipline rule 5 warns about, pointing
the other way.

### FIVE FIXTURES WERE ASSERTING THE EXPIRED PREMISE

Five existing tests failed, and every one of them placed its PATTERN a little
OFF the fix - 0.37 NM, 1.2 NM, 5 NM - which is not a shape `addPatternStop` can
make. Each was moved onto the fix's own coordinates, where the rule it was
written for still holds exactly, rather than having its assertion weakened. Two
of them were testing nothing once moved (`sch[3]` was not the leg after the
break; "PATTERN is not in the title" was a proxy for "the leg has ground") and
now assert the thing itself.

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
  the bundle and the dataset become the `body`, `app` and `aip` payloads (fixed
  names until v16.88; content-addressed since - see the entry above), and
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

### SIZE IS ITS OWN SETTING: BOLD AND COMPACT GO WITH ANY STYLE (v17.3)

The author: *"I would like the bold option to be available to the different
colour styles."* A body carries ONE `skin-*` class, so while Bold was a skin it
could never be worn with Slate, Chart or Float. Compact and Bold change how BIG
things are, not how they LOOK, so they became a second axis: `DENSITIES`
(normal / compact / bold) in skins.js, a `density-*` body class beside the
skin's, `density` in PROFILE_KEYS, and a **Size** select under the style in
Settings -> Map -> Look. The style list is now Default, Menu, Slate, Chart and Float.

- **THE CSS IS LAYERED BY SOURCE ORDER**, because a size rule and a style rule
  have the same specificity (`body.x .btn`):
  1. **SHAPE** (radius, edge weight) comes BEFORE every style, so a style with
     its own shape wins. Bold Chart keeps its squared corners.
  2. **SIZE** (padding, type, targets) comes AFTER every style and wins
     everywhere. A big target is big whatever colour it is.
  Both halves were proved by mutation: shape moved after the styles gives Chart
  8 px corners; size moved before them leaves Bold Slate one pixel taller than
  Slate. `verify:skins` measures both, for every style.
- **`.btn` HAS `transition: 0.1s` ON EVERY PROPERTY**, so a style read straight
  after switching returns the previous combination mid-animation. The first
  version of that check reported Chart with Slate's corners and Default as not
  growing in Bold. It waits out the transition now.
- **BOLD ON THE DEFAULT STYLE IS THE OLD BOLD SKIN, PIXEL FOR PIXEL**. It was
  compared against a v17.2 build in light and dark: computed styles identical,
  and the only differing pixels (1 for Bold, up to 11 for Compact, varying run to run) are the
  `<select>` rendering noise that also differs between two shots of the old
  build.
- **THE AUTHOR USES BOLD, SO THE MIGRATION IS NOT OPTIONAL.** A stored
  `skin: 'bold'` would otherwise normalise to the default style and silently
  lose the size. `splitLegacyLook` turns it into Default + Bold at boot, and it
  wins even over a size already set. Nothing since v17.3 writes `skin: 'bold'`,
  so the value is always an old statement, most often a settings file exported
  before the split and imported into a profile that already says `normal`.
- **EVERY COMBINATION IS CHECKED**: `verify:skins` runs 5 styles x 3 sizes at
  two window sizes, and `verify:layout`'s number-cell check (the v16.71 Bold
  failure) runs all 15. Menu is measured OPEN, by hovering the rail with the
  mouse. `focus()` cannot open it, because the cells are `display: none` until
  it opens.
- One more inline handler (the Size select): the page's stated count went 152 -> 153,
  and the L3 test caught it.

### THREE MODERN LOOKS (v17.2, roadmap item 21)

Each one answers a DIFFERENT part of the request, so they can be compared
rather than blended:

| skin | answers | modelled on |
|---|---|---|
| **Slate** | colour and buttons | the neutral "modern tool" look - Linear, Vercel Geist, GitHub Primer, Radix |
| **Chart** | colour and type | the ICAO 1:500 000 chart itself - paper, chart blue, aerodrome magenta |
| **Float** | layout | map-first apps - Google Maps, Mapbox Studio, ForeFlight, SkyDemon |

- **THE ONE RULE ALL THREE FOLLOW: COLOUR MEANS SOMETHING.** The shipped
  toolbar gives every button its own hue, so colour says nothing and the red of
  Delete competes with six other loud colours. Here buttons are neutral, the one
  primary action per group (Save, Print) carries the accent, danger stays red,
  and a STATE (View Mode's amber "back to Edit") keeps its warning colour.
  "Add a sector" is a dashed outline, the modern "add another" affordance,
  rather than a full-width slab of accent.
- **EVERY SKIN THAT TINTS ONE THEME TINTS BOTH**, and a test holds it: light
  tokens without dark ones would put light surfaces under the dark theme's pale
  text. Chart's dark theme is a night-reading chart (navy paper, cream ink).
- **`!important` IS THERE BECAUSE OF THE MARKUP, NOT TASTE.** The header's
  outline buttons carry `style="color:white"`, which out-ranks any stylesheet
  rule without it, and a skin may not edit markup.
- **CHART'S SERIF IS A SYSTEM STACK** (Iowan, Palatino, Georgia): the planner is
  offline-capable and loads no web fonts.
- **FLOAT FLOATS ONLY IN SPLIT.** In Stacked the panel would have to be a bottom
  sheet under the map's control stack, which has nothing to stop it reaching
  down into the sheet, so Stacked keeps its normal flow. The panel width is ONE
  custom property (`--sk-panel`, `min(920px, 60vw)`; 920 px is what the OFP
  table needs to show every column without scrolling), and the control stack,
  the licence attribution and the offline-tiles notice are all moved clear of
  it. The first draft was 54vw, and the Rem column scrolled out of sight; the
  notice centred on the whole window and covered the panel's tabs. Both were
  found by looking at screenshots, which is why they exist.
  - **WHAT THE MAP DOES NOT KNOW**: Leaflet sizes itself to the whole window, so
    "fit the route" can leave part of it under the panel. One pan fixes it.
    Teaching `fitBounds` a right-hand padding is the next step if Float is kept.
  - **THE DIVIDER IS A QUESTION THE SKIN ANSWERS** (`noSplitterIn`,
    `skinHasSplitter`), replacing a `skin-menu` class test in the page. Menu has
    none in any layout, and Float has none in Split.
- **`verify:skins` HAD A HARDCODED LIST OF FOUR SKINS**, so all three new ones
  would have shipped with none of its checks run on them - the v16.86 index
  drift again. It reads `SKINS` from the module now, and gained Float's own
  checks: the map takes the whole width, the panel sits over it, nothing on the
  map is under the panel, and there is no divider. Seven mutations (panel not
  floating, controls or attribution under it, the divider back, the skin's
  divider answer ignored or emptied, the dark tokens missing) are all caught by
  name. The first attempt at one died only in `tsc` and was rewritten.
- **THE DEFAULT IS UNTOUCHED**: `verify:visual` against main shows 54 px, all
  inside the 7x8 version badge, in light and in dark.

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
