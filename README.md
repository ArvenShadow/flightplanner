# C182 Flight Planner (v16.7)

Single-file VFR flight planner for the Cessna 182T — ground planning only.
Open `C182_FlightPlanner.html` in any browser. That file is the entire app.

## Working on it with Claude Code

```bash
cd c182-planner
npm install        # jsdom, for the test suite
npm test           # must print RESULT: ALL CHECKS PASSED (220 tests)
claude             # start Claude Code here; it reads CLAUDE.md automatically
```

CLAUDE.md carries the project's history, verified decisions, editing
discipline, and roadmap — the distilled memory of the original
claude.ai development chats.

## Version control

The repo starts at v16.2 (tagged). Suggested flow: one branch per
feature, run `npm test` before every commit, tag shipped versions.

## Airspace data (data/ folder)

`data/airspace_*.js` are GENERATED from the official Avinor eAIP by
`node tools/scrape_eaip.js` (re-run once per 28-day AIRAC cycle, review
the diff, commit, bump the version). Keep the `data/` folder next to
`C182_FlightPlanner.html` — the airspace overlay reads it locally; the
planner works fine without it (overlay disabled with a note).
