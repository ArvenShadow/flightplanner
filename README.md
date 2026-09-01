# C182 Flight Planner (v16.31)

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
TMA, TIA, CTA and the mandatory zones. Hover any of them for its ICAO class,
published vertical limits, station callsigns and VHF frequencies. Nothing draws
below zoom 7, because at country zoom 228 polygons bury the chart. Clicking
still adds a waypoint, so route building inside a TMA is unaffected.

Limits are shown exactly as published: GND, UNL and flight levels stay as they
are, and a flight level is never converted to an altitude. **A planning aid —
verify against the current AIP and NOTAM.**

## Airspace data

`data/aip.js` holds 140 Norwegian airspaces — CTR, TMA, TIZ, TIA, CTA and the
offshore zones — with their published class, vertical limits, callsigns and
frequencies, imported from the **official Avinor eAIP** by
`npm run build:aip`. The import runs at build time only: the planner never
contacts Avinor and never parses eAIP HTML.

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

What still cannot be resolved is **absent rather than approximated**, and
`data/aip-report.json` names every one with the reason: offshore zones
published as a circle radius, the *maritime* stretch of the Norway–Sweden
boundary in the Skagerrak (a land border dataset does not contain it), and one
airspace citing the Finland–Sweden border. Drawing a straight line between the
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
| `legs.js` | legs, via points, the drawn path and line hit-test, the climb/descent schedule, TOC/TOD |
| `daylight.js` | sunrise/sunset and the SERA day-VFR window |
| `winds.js` | winds-aloft vector maths and the Open-Meteo API shapes |
| `integrity.js` | the rules behind the red DO-NOT-USE banner |
| `exchange.js` | export/import, and the whitelist that keeps personal data out |
| `plotting.js` | the copyable chart plotting text |
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
npm test           # typecheck, build, then the suite against dist (286 tests)
npm run serve      # build + serve site/ on localhost and the LAN
node tools/verify-hosted.mjs   # Chromium check of the service-worker rules
                               # (needs `npm install --no-save playwright`)
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
