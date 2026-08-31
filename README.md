# C182 Flight Planner (v16.9)

VFR flight planner for the Cessna 182T — ground planning only.

**To fly with it:** open `dist/C182_FlightPlanner.html` — one self-contained
file, no install, works offline (live winds/VFR chart need internet). On
Windows, `build.cmd` rebuilds it and opens it in one double-click.

**To work on it:** edit `src/`, then rebuild. `src/index.html` holds the page
(markup, CSS and the not-yet-extracted script); `src/lib/*.js` holds extracted
modules; `tools/build.mjs` bundles them as a classic script, inlines it, and
enforces the ship checklist (both scripts parse, no duplicate DOM ids,
APP_VERSION matches package.json) before anything reaches `dist/`.

```bash
npm install        # esbuild + jsdom
npm run build      # src/ -> dist/C182_FlightPlanner.html
npm run watch      # rebuild on every save
npm test           # builds, then runs the suite against dist (226 tests)
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
