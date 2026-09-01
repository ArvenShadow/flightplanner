# C182 Flight Planner (v16.17)

VFR flight planner for the Cessna 182T — ground planning only.

**No git, no Node, nothing to install:** open the hosted URL. That is the
whole story for everyday use — it is always the current version, and after
the first visit it works offline.

**Three ways to run it**, from the same source:

| | how | offline chart tiles |
|---|---|---|
| Hosted | the GitHub Pages URL | yes — service worker |
| Local server | `npm run serve`, then `http://localhost:8182` | yes — localhost is a secure context |
| Same, from a phone | `npm run serve`, then `http://<your-ip>:8182` over wifi or a hotspot | no — see below |
| Double-click | open `dist/C182_FlightPlanner.html` | no — `file://` cannot register a worker |

Browsers only allow a service worker on a **secure context** — HTTPS or
`localhost`. A plain-http LAN address is not one, so the phone/tablet case
runs the planner fine but streams every chart tile live. Nothing breaks; the
registration is feature-detected.

The double-click file remains the fallback that needs no server, no install
and no network. On Windows, `build.cmd` rebuilds it and opens it in one go.

Cached chart tiles are keyed to the **AIRAC edition**, and the worker refuses
to serve a tile from cache until the page has told it which cycle is live — a
chart from a superseded cycle is a safety problem, not a stale asset.

**To work on it:** edit `src/`, then rebuild. `src/index.html` holds the page
(markup, CSS and the not-yet-extracted script); `src/lib/*.js` holds extracted
modules; `tools/build.mjs` bundles them as a classic script, inlines it, and
enforces the ship checklist (both scripts parse, no duplicate DOM ids,
APP_VERSION matches package.json) before anything reaches `dist/`.

On Windows you can skip the command line entirely: `build.cmd` rebuilds the
double-click file, `serve.cmd` builds and serves the hosted version locally.
Both install dependencies on first run. Without git installed, "Download ZIP"
from the repo's Code button gets you the same files.

```bash
npm install        # esbuild + jsdom
npm run build      # src/ -> dist/C182_FlightPlanner.html
npm run watch      # rebuild on every save
npm test           # builds, then runs the suite against dist (265 tests)
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
