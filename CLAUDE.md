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

- ONE self-contained HTML file: `C182_FlightPlanner.html` (~400 KB).
  Vanilla JS, Leaflet from CDN, Kartverket topo tiles. No build step, no
  framework, no server. The file IS the product and the complete state;
  users double-click it, it works offline except live-data features.
- The user explicitly evaluated alternatives (React/desktop/server) and
  chose to keep this architecture. Capability limits so far were always
  data/licensing walls, never the file format.
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

- `npm install` then `npm test`. Requires Node 18+.
- test.js stubs Leaflet (captures polyline/marker/tileLayer args) and
  loads the HTML via jsdom. jsdom quirk: innerText is undefined until
  set, and does not coerce numbers — app code writes String(v); tests
  use the txtOf() helper.
- Seed route: ENDU → FINNSNES → ENTC (leg 1 climb 254→2500 ft).
- `c182_flight_routes.json` is a test fixture (import/export round-trip).

## Domain decisions already settled (do not relitigate silently)

- **Geodesy**: spherical law of cosines + initial bearing + slerp,
  audited <0.5% vs WGS-84 over planning distances. Good enough; do not
  swap for "more accurate" libs without the user asking.
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
- **Mass & Balance / OFP port**: a full port of the school's Excel OFP
  (M&B, fuel req, POH takeoff/landing interpolation, NavData for 53
  aerodromes) was built as v17 and then ROLLED BACK — the user prefers
  keeping M&B in Excel. The port code exists only in the old claude.ai
  chat; v16.2 contains none of it. If ever revived, note: the user's
  Excel has one verified typo — takeoff table 2300 lb / 4000 ft / 40 °C
  must be 1270 ft (POH Fig 5-6 Sheet 3), their sheet had 1165.
- **Not planned** (verified dead ends): NOTAM (no reliable free API),
  georeferenced VFR charts (licensing), traffic (needs receivers),
  auto-METAR from aviationweather.gov (browser CORS never verified).

## Roadmap items the user approved but hasn't ordered yet

- Sunrise/sunset & civil twilight warnings (pure math; valuable at 69°N,
  handles polar night / midnight sun).
- Crosswind calculator per runway.
- Alternate/diversion fuel planning (ICAO-style trip+alt+reserve).
- METAR/TAF display via api.met.no — VERIFY endpoint + browser CORS first.

## Safety posture

A red integrity banner (`runIntegrityCheck`) validates all rendered
numbers each recalc (NaN/coords/altitudes/wind vs TAS/GS bounds/fuel).
The help guide opens on first run and leads with a PIC-responsibility
notice. Keep both intact. A 3-page company justification document exists
(Methodology_and_Safety_Notes.pdf, reportlab). When features are removed
for data-quality reasons, that reasoning belongs in the guide and is
worth a line in that document.
