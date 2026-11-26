#!/usr/bin/env node
/**
 * Remove chart images the manifest no longer names - `npm run prune:vac`.
 *
 * `npm run build:vac-raster` writes a NEW file whenever a chart's source PDF
 * changes (the name carries the chart date and the PDF's hash) and never
 * deletes the one it replaces, so after a re-import the superseded images are
 * still in data/vac/. They are not drawn - the planner only loads what
 * data/vac-index.js names - but they are 2-4 MB each and would be deployed.
 *
 * Deletes nothing unless run with --apply; without it, it only lists.
 */
import { readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const DIR = 'data/vac';
const index = await readFile('data/vac-index.js', 'utf8');
const stale = (await readdir(DIR)).filter((f) => !index.includes(f));
const apply = process.argv.includes('--apply');
for (const f of stale) {
  console.log((apply ? 'removed ' : 'stale   ') + join(DIR, f));
  if (apply) await rm(join(DIR, f));
}
console.log(stale.length + ' superseded chart image(s)' + (apply || !stale.length ? '' : ' - run again with --apply to delete them'));
