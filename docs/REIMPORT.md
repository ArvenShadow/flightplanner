# Re-importing the AIP (a new Avinor eAIP edition)

Everything the planner knows about airspace, aerodromes, reporting points,
runways, ATS hours and the approach charts is imported from Avinor **when the
app is built** and committed to this repository. Nothing updates by itself: not
the app in the browser, not the deploy. This is the procedure for bringing in a
new edition by hand. It was written while doing the 2026-09-03 -> 2026-11-26
re-import (v17.26), so every command here is one that ran.

Avinor publishes a new edition only when an amendment changes something.
Editions fall on AIRAC dates, but not on every one - a cycle date passing does
not mean there is a new edition.

## 0. Is there a new edition?

```
node -e "fetch('https://aim-prod.avinor.no/no/AIP',{redirect:'manual'}).then(r=>console.log(r.headers.get('location')))"
grep -o '"editionLabel":"[^"]*"' data/aip.js | head -1
```

The first prints the index Avinor currently serves (`/no/AIP/View/Index/156`);
the number goes up with each edition. The second prints what the app carries.
Step 2 below prints the live edition's label and effective date outright.

## 1. What you need

- **Node 20.19+ or 22.12+**, then `npm install`.
- **GDAL** (`gdalinfo`, `gdal_translate`, `gdalwarp`, `gdaltransform`) and
  **Poppler** (`pdftoppm`) - for the chart images only (step 3).
  Ubuntu/Debian: `sudo apt-get update && sudo apt-get install -y gdal-bin poppler-utils`.
  macOS: `brew install gdal poppler`. GDAL 3.8.4 was used for v17.26.
- **Internet access** to `aim-prod.avinor.no`.
- Start from a clean, up-to-date `main` on a new branch.

Pages and PDFs are cached in `.aip-cache/` (not committed), so a step can be
re-run without fetching again. Delete that folder to force a fresh download.

## 2. The four steps, IN THIS ORDER

The order matters and the tools enforce most of it: step 3 reads what step 2
cached, step 4 reads what 2 and 3 prepared, and step 5 refuses to run until
step 4 has moved the dataset to the new edition.

| # | Command | What it does | Time |
|---|---------|--------------|------|
| 2 | `npm run build:vac` | Reads the reporting points from each chart's printed coordinate table. Writes `tools/prepared/vac-points.json` and `vac-report.json`. | ~1 min |
| 3 | `npm run build:vac-raster` | Places and renders each approach chart. Writes `data/vac/*.webp`, `data/vac-index.js`, `tools/prepared/vac-charts.json`, `data/vac-raster-report.json`. | ~12 min |
| 4 | `npm run build:aip` | Airspace, aerodromes, runways, frequencies. Writes `data/aip.js`, `data/aip-report.json`, `data/vac-source-verification-<edition>.json`. | ~1 min |
| 5 | `npm run build:hours` | ATS opening hours. Writes `tools/prepared/ats-hours.json` and the `ats` field of `data/aip.js`. | seconds |

Step 4 prints `WARNING: ... the hours are LEFT OFF. Run npm run build:hours
after this.` the first time. That is expected; step 5 fixes it. **Run step 5
again after every re-run of step 4**, because step 4 rewrites `data/aip.js`.

`npm run build:border` (the national border from Kartverket) is not part of
this. Re-run it only if the border data itself changes.

Then tidy up:

```
npm run prune:vac              # lists chart images the manifest no longer names
npm run prune:vac -- --apply   # deletes them
git rm data/vac-source-verification-<OLD edition>.json
```

## 3. Review what changed - do not skip this

The import refuses what it cannot place or decode instead of guessing, so each
step ends with a summary. Read all four. What "normal" looked like at
2026-11-26:

- **build:vac** - `53 aerodromes, 24 with points, 243 points`, `refused points: 0`.
  The line `coordinates inside the chart's own graticule: 233/244 (1 chart(s)
  print no graticule)` is the Bodø problem described below.
- **build:vac-raster** - one line per chart, then `49 chart(s) prepared, 0
  refused`. A refused chart is **not drawn**; it is not an error to fix by
  loosening a limit. Look at the reason and at the PDF.
- **build:aip** - `212 airspace volumes`, `ACC sectors: 27 usable, 2 not`,
  `53 aerodromes, 243 reporting points`, `runways: 112 ends at 53 aerodromes,
  120 intersection take-off positions`, and the border line `67 published ->
  51 resolved, 11 refused, 5 in airspace that is never drawn`. `vac charts: 49
  prepared ..., 49 still current` - anything not "still current" is a chart
  Avinor amended after step 3, so run step 3 again.
- **build:hours** - `53 aerodromes, revised per AIRAC <the new date>`, and four
  aerodromes "shown raw, not decoded" (ENAS, ENHV, ENOL, ENRY). More than that
  means Avinor changed the notation somewhere; the raw text is still shown in
  the app, it just is not checked against the plan.

Then compare the dataset with the previous one. `git diff --stat` shows which
files moved; for `data/aip.js` (one long line) compare record by record. Two
rules learned the hard way:

- **Compare as a multiset, not by name.** Many volumes share a name and a band
  ("Polaris CTA (FL 115 - FL 660)" a dozen times). Pairing by name invents
  changes.
- **Ignore the edition label and index number inside links** when comparing,
  or every record looks changed.

A number that moved is either a real change in the AIP or a parser fault, and
they look the same. **Open the source page and check before accepting it.**
The cached page is `.aip-cache/<edition>-EN-AD-2.<ICAO>.html`.

## 4. Version, tests, ship

1. Bump the version: `APP_VERSION` in `src/index.html`, `version` in
   `package.json`, and the two `version` lines at the top of
   `package-lock.json`. A data-only change still gets a new version.
2. `npm test`. Some tests pin edition-dependent figures **on purpose**, and
   will fail when the edition really changed them. Each failure message says
   what it expected. Check the source, then update the number - never loosen
   the test. The ones that have moved so far:
   - the ACC sector count (`expected 27`);
   - runway ends and intersection positions (`112`, `120`);
   - the ATS hours revision date on the hours card (`revised per AIRAC ...`);
   - the raw hours text of an undecoded aerodrome (ENRY);
   - the Gardermoen tower frequencies;
   - the charts with no readable graticule (`ENBO`, 11 points);
   - the charts whose latitude was established rather than read (`ENBO`), and
     the prepared/refused chart counts (`49`, none).
3. With a browser available: `npm install --no-save playwright`, then
   `npm run verify:vac` and `npm run verify:fixes`.
4. Write what changed in `docs/HISTORY.md`, update the line in `CLAUDE.md`,
   commit (the new `data/vac/*.webp` files included), push, open a pull
   request. Merging to `main` deploys.

## 5. Things that have gone wrong, and what they were

- **A withdrawn value came through as garbage (2026-11-26).** The eAIP marks a
  deleted value by changing the value's `class` to `AmdtDeletedAIRAC` and
  leaving its hidden marker behind. The importer gave that marker the previous
  value, and Gardermoen Tower got a frequency of "MHZ". Fixed in
  `tools/aip-fields.mjs`; `data/aip-report.json` now counts these
  (`withdrawnMarkers`, 41 at 2026-11-26) and a test refuses any non-numeric
  frequency. If Avinor changes its change-markup again, this is where to look.
- **A chart whose latitude labels are not text (Bodø, 2026-11-26).** The new
  Bodø chart looks like the others on screen, but inside the PDF its sideways
  latitude labels are drawn as shapes, not stored as text (0 rotated text items
  against Bardufoss's 90; checked with two PDF readers). v17.26 refused it.
  Since v17.27 the import handles exactly this case: it finds the one-minute
  ticks on the left and right edges by their even spacing, then tries every
  possible value for the lowest tick and keeps the chart only if **exactly
  one** passes all the usual checks against the published reporting points.
  The raster line then reads `published-points ... cross NN m` like any other,
  and the record carries `graticule.inferredLatitude`. It needs a sheet with a
  coordinate table; one without stays refused. A test pins which charts were
  placed this way (`ENBO`) - if another appears, look at it before accepting.
- **The chart step wrote the wrong source link (2026-11-26).** The eAIP index
  number was written into `build-vac-raster.mjs` (`Index/155`). It is now
  discovered like the other steps do, and a test checks every chart's link
  names the current edition.
- **A frequency with no unit is prose, not a frequency** (v16.42) - de-icing
  and handling frequencies in free text. Dropped by the importer.
- **Polaris ACC Sector 8 was withdrawn** (2026-09-03) - a real change that
  looked exactly like a parser regression. Hence the pinned sector count.

The full reasoning for each of these is in `docs/HISTORY.md`.
