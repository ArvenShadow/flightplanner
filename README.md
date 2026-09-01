# C182 Flight Planner (v16.37)

VFR flight planner for the Cessna 182T — ground planning only.

**No git, no Node, nothing to install:** open the hosted URL. That is the
whole story for everyday use — it is always the current version, and after
the first visit the planner itself works offline.

**Three ways to run it**, from the same source:

| | how | app works offline |
|---|---|---|
| Hosted | the GitHub Pages URL | yes — service worker |
| Local server | `npm run serve`, then `http://localhost:8182` | yes — localhost is a secure context |
| Same, from a phone | `npm run serve`, then `http://<your-ip>:8182` over wifi or a hotspot | no — see below |
| Double-click | open `dist/C182_FlightPlanner.html` | yes — it is one self-contained file |

Browsers only allow a service worker on a **secure context** — HTTPS or
`localhost`. A plain-http LAN address is not one, so the phone/tablet case
runs the planner fine but reloads the app from the server each time. Nothing
breaks; the registration is feature-detected.

The double-click file remains the fallback that needs no server, no install
and no network. On Windows, `build.cmd` rebuilds it and opens it in one go.

**The MAP always needs internet.** Waypoints, tracks, distances, headings,
fuel and times all work with no connection, but both base charts are streamed
and neither can be relied on offline. There is no chart download, and that is
a settled decision: Avinor sends no CORS header, so a chart tile is an opaque
response, and browsers charge megabytes of storage quota for one whatever its
real size — a route's worth filled the quota and got the browser to evict
everything for the site. The service worker keeps a small tile cache so
panning is smoother, and that is all it is for.

Cached chart tiles are keyed to the **AIRAC edition**, and the worker refuses
to serve a tile from cache until the page has told it which cycle is live — a
chart from a superseded cycle is a safety problem, not a stale asset.

## Airspace overlay

The **⬢ Airspace** button on the map draws the published airspace — CTR, TIZ,
TMA, TIA, CTA and the mandatory zones. Hover any of them for a card with its
ICAO class, published vertical limits, and one row per service you would
actually use: **ATIS, Approach, Tower**, or **Information** at an AFIS field.
Nothing draws below zoom 7, because at country zoom 227 polygons bury the
chart. Clicking still adds a waypoint, so route building inside a TMA is
unaffected.

The card lists only dialable frequencies: no clearance delivery or ground, no
military channels (both the flagged ones and everything outside 118–137 MHz),
and never 121.500. An airspace worked only by an area control centre still
shows that frequency, or there would be nobody to call. Every published
service and frequency stays in the data regardless.

**Polaris CTA names the sector your cursor is in.** It is one airspace over the
whole country, so the AIP lists all 26 Polaris sector frequencies against it —
reciting them tells you nothing. ENR 2.2 publishes each sector as its own
volume, so the card looks up which one you are over, and only ever shows a
frequency the hovered airspace itself also publishes. Where the AIP stacks
sectors vertically you get one row per sector, labelled with the band it works.
Where a sector cannot be drawn — Sectors 3 and 4 follow the *maritime*
Norway–Sweden boundary — the card says so and shows nothing rather than
guessing.

Limits are shown exactly as published: GND, UNL and flight levels stay as they
are, and a flight level is never converted to an altitude. **A planning aid —
verify against the current AIP and NOTAM.**

## AIP fixes: aerodromes and reporting points

The **⌖ Fixes** button draws the published **aerodromes** (from zoom 7) and
**VFR reporting points** (from zoom 9). **Click one and it becomes a waypoint
at its published coordinate** — no dialog, because the fix already has its
published name — so a leg to SØRREISA is drawn to the point the chart states
rather than to wherever you managed to click. An aerodrome brings its published
field elevation with it, and as the first waypoint it sets the flight's
departure elevation. **🔎 Find fix** searches by name or ICAO; the Norwegian
letters are optional (SORKJOSEN finds SØRKJOSEN) and matches are ordered by
strength, then by distance from the middle of your map.

Reporting points come from the **coordinate table printed on each aerodrome's
Visual Approach Chart**, read from the PDF's text layer at build time
(`npm run build:vac`). 243 points at 24 aerodromes.

**Settings → Map** sets how they are drawn: shape, colour, size, filled or
outline, and whether names are shown, with a live preview. Reporting points
default to **orange** — nothing on either base chart is orange except the
mandatory zones, so the symbol you are hunting for cannot be mistaken for
published chart ink.

The settings modal is two pages: **Aircraft & Units**, which you set up once
per machine, and **Map**, which is pure display preference. The layer toggles,
base chart and chart detail stay on the map itself, beside what they change.

**29 of the 53 aerodromes publish their points on the chart face only**, with
no table to read. Those aerodromes still anchor on their ARP but carry **no
points**, and the coverage is reported rather than quietly implied — nothing is
taken off a chart image. Every coordinate that does ship is checked against the
chart's *own* printed lat/long graticule first, and a name that fails to decode
is refused rather than shipped misspelt. The chart raster is not georeferenced,
so there is no VAC overlay.

## Airspace data

`data/aip.js` holds 212 Norwegian airspace volumes — CTR, TMA, TIZ, TIA, CTA
and the offshore zones — plus the 28 Polaris ACC sectors and 53 aerodromes with
their 243 VFR reporting points, all with their published class, vertical
limits, callsigns and frequencies, imported from the **official Avinor eAIP**
by `npm run build:aip`. The import runs at build time only: the planner never
contacts Avinor, never parses eAIP HTML and never opens a PDF.

**Used with permission from Avinor AS, for non-commercial use only.** That is
a permission granted to this project, not an open licence — it does not travel
to a fork, and the planner must not be commercialised while this dataset ships
with it.

Where a published boundary **follows the national border**, the real border is
used: `npm run build:border` takes it from Kartverket's official
administrative-units WFS (`Riksgrense`, under **NLOD**) and
`tools/prepared/norway-border.json` is committed so the airspace build is
reproducible. Each resolved airspace records how far its published corner sat
from Kartverket's surveyed line, so the shape can be audited rather than
trusted.

Where the AIP says a boundary **follows the national border** it is drawn from
Kartverket's line — 51 stretches on 41 airspaces in this edition. The eAIP
states such a reference in two different ways (a typed `TGEO_BORDER` field, and
the same sentence carried as a remark on the preceding vertex); a build-time
invariant requires every published reference to end up resolved, refused for a
stated reason, or inside airspace that is deliberately never drawn, and **fails
the build** otherwise.

**ATS delegation areas are not drawn.** ENR 2.2 section 5 publishes areas where
two states have agreed to transfer *who provides the service* — not airspace.
Silver 1 and Silver 2 are inside SWEDEN FIR; 13 of the 17 lie in a foreign FIR.
They stay in the report with the FIR they sit within and the responsible state.

What still cannot be resolved is **absent rather than approximated**, and
`data/aip-report.json` names every one with the reason: offshore zones
published as a circle radius, the *maritime* stretch of the Norway–Sweden
boundary in the Skagerrak (a land border dataset does not contain it), and one
airspace citing the Finland–Sweden border, and Polaris ACC Sectors 3 and 4,
which follow that same maritime stretch. Drawing a straight line between the
published points would invent a boundary that does not exist.

**To work on it:** edit `src/`, then rebuild.

| want to change... | edit |
|---|---|
| how anything **looks** | `src/styles.css` — all 938 lines of it, one file |
| page layout, buttons, ids | the markup in `src/index.html` |
| a **calculation** | the matching `src/lib/*.js` — see the table below |
| map, tables, modals, storage | the script in `src/index.html` |

Every calculation that decides a number you would fly with lives in its own
module, with no DOM, and is tested in plain Node:

| module | owns |
|---|---|
| `performance.js` | POH climb & cruise tables, TAS, fuel flow, WCA |
| `geodesy.js` | WGS-84 distance and true track |
| `magvar.js` | magnetic variation (WMM2025) |
| `legs.js` | legs, via points, the drawn path and line hit-test, the climb/descent schedule, TOC/TOD and the pinned BOC/BOD |
| `daylight.js` | sunrise/sunset and the SERA day-VFR window |
| `winds.js` | winds-aloft vector maths and the Open-Meteo API shapes |
| `integrity.js` | the rules behind the red DO-NOT-USE banner |
| `exchange.js` | export/import, and the whitelist that keeps personal data out |
| `plotting.js` | the copyable chart plotting text |
| `airspace.js` | the airspace overlay: culling, colours, the hover card, the Polaris sector lookup |
| `anchors.js` | AIP fixes: aerodrome and reporting-point search, culling, and the waypoint one becomes |
| `metar.js` | METAR/TAF from MET Norway, and the little of it that is decoded |
| `format.js` | times, coordinates, unit conversion |
| `dialog.js` | in-app popups and toasts |

The script left in `src/index.html` is the part that talks to the browser —
map, tables, modals, localStorage. It opens with a **WHERE TO EDIT WHAT**
index. It stays in one file on purpose: it is a single web of shared state
plus 61 inline `on*=` handlers that need those functions as globals, so
splitting it would make an edit span more files, not fewer.

`tools/build.mjs` inlines the CSS and the bundled modules, and enforces the
ship checklist (both scripts parse, no duplicate DOM ids, APP_VERSION matches
package.json) before anything reaches `dist/`.

On Windows you can skip the command line entirely: `build.cmd` rebuilds the
double-click file, `serve.cmd` builds and serves the hosted version locally.
Both install dependencies on first run. Without git installed, "Download ZIP"
from the repo's Code button gets you the same files.

```bash
npm install        # esbuild + jsdom
npm run build      # src/ -> dist/C182_FlightPlanner.html
npm run watch      # rebuild on every save
npm run typecheck  # TypeScript checks every module (0 errors required)
npm test           # typecheck, build, then the suite against dist (360 tests)
npm run serve      # build + serve site/ on localhost and the LAN
npm run verify:hover           # Chromium check of the position-dependent
                               # Polaris sector frequency on the hover card
npm run verify:fixes           # Chromium check of the AIP fixes layer: every
                               # control measured on screen, one click = one
                               # waypoint on the published coordinate
npm run verify:leg             # Chromium check of the leg settings panel: the
                               # right-click gesture, the pins, and all four
                               # schedule marks measured against their own
                               # coordinates
node tools/verify-hosted.mjs   # Chromium check of the service-worker rules
node tools/verify-visual.mjs   # pixel + computed-style diff vs a reference build
                               # (all three need `npm install --no-save playwright`)
claude             # start Claude Code here; it reads CLAUDE.md automatically
```

`dist/` is committed on purpose: a plain download of the repo stays runnable
with zero tooling. The bundle is a **classic** script, not ES modules —
browsers block ES modules on `file://` pages, and staying double-clickable is
a hard requirement.

CLAUDE.md carries the project's history, verified decisions, editing
discipline, and roadmap — the distilled memory of the original
claude.ai development chats.

## Version control

The repo starts at v16.2 (tagged). Suggested flow: one branch per
feature, run `npm test` before every commit, tag shipped versions.
