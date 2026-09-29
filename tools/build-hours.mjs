#!/usr/bin/env node
/**
 * Import the ATS operational hours for every aerodrome (v17.0).
 *
 *   npm run build:hours
 *
 * WHERE THEY COME FROM, AND WHY NOT THE eAIP: AD 2.3 of every AD 2 page is the
 * section for operational hours, and 49 of the 53 say only "REF AIS Portal
 * www.avinor.no/ais" (4 say NIL; only ENVA states "H24" itself). The portal's
 * "Operational hours" link is Avinor's own publication on the same AIM host as
 * the eAIP, revised per AIRAC, and that is what this reads.
 *
 * WHAT IT WRITES:
 *   - tools/prepared/ats-hours.json  the snapshot, committed - like the border
 *     and the VAC points, so `npm run build:aip` can attach it and a re-run
 *     cannot silently change a published hour;
 *   - data/aip.js                    each aerodrome gains `ats: {hours, rmk}`
 *     and the dataset gains `atsHoursSource`. NOTHING ELSE IN THE FILE IS
 *     TOUCHED: the airspace, runways and fixes are the AIP build's, and this
 *     tool refuses to write unless the hours were revised for the SAME AIRAC
 *     cycle the dataset is - a September AIP with October hours is two
 *     editions in one file.
 *
 * The published TEXT is stored, never a decoded schedule: src/lib/opshours.js
 * decodes it in the planner, so there is one reader of the notation. This tool
 * runs that reader too, and REPORTS what it refuses.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseOpsHoursPage } from './aip-hours.mjs';
import { parseAtsHours } from '../src/lib/opshours.js';

const ROOT = 'https://aim-prod.avinor.no';
const UA = 'C182FlightPlanner-AipImporter/1.0 (ground planning; permission held)';
const CACHE = '.aip-cache';
const SNAPSHOT = 'tools/prepared/ats-hours.json';
const DATA = 'data/aip.js';
const PREFIX = 'window.C182_AIP = ';

async function fetchPage() {
  // Follow /no/OperationalHours to whichever index Avinor currently serves,
  // rather than hardcoding one - the eAIP's rule (v16.29).
  const res = await fetch(ROOT + '/no/OperationalHours', { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error('Operational hours -> HTTP ' + res.status);
  const url = res.url;
  const m = url.match(/\/View\/Index\/(\d+)\//);
  const html = await res.text();
  await mkdir(CACHE, { recursive: true });
  await writeFile(join(CACHE, 'ops-hours-' + (m ? m[1] : 'x') + '.html'), html, 'utf8');
  return { url, html };
}

async function main() {
  const { url, html } = await fetchPage();
  const { revisedAirac, entries } = parseOpsHoursPage(html, 'ATS');
  const icaos = Object.keys(entries).sort();
  if (!revisedAirac) throw new Error('the page states no "Revised per AIRAC" date - refusing to import undated hours');
  if (icaos.length < 40) throw new Error('only ' + icaos.length + ' ATS entries read - the page layout has probably changed');

  const src = await readFile(DATA, 'utf8');
  const at = src.indexOf(PREFIX);
  if (at < 0) throw new Error(DATA + ' is not in the expected form');
  const json = src.slice(at + PREFIX.length).replace(/;\s*$/, '');
  const dataset = JSON.parse(json);
  const edition = String(dataset.editionLabel || '').slice(0, 10);
  if (edition !== revisedAirac) {
    throw new Error(`the hours are revised per AIRAC ${revisedAirac} but ${DATA} is the ${edition} edition. ` +
      'Run `npm run build:aip` for the same cycle first; two editions in one file is a wrong answer.');
  }

  const decoded = { schedule: 0, h24: 0, none: 0, or: 0, unparsed: 0 };
  /** @type {{icao: string, reason: string}[]} */
  const refused = [];
  for (const icao of icaos) {
    const h = parseAtsHours(entries[icao].hours);
    decoded[h.kind]++;
    if (h.kind === 'unparsed') refused.push({ icao, reason: h.reason });
  }
  const missing = dataset.aerodromes.map((/** @type {any} */ a) => a.icao).filter((/** @type {string} */ i) => !entries[i]);

  const source = {
    source: 'Avinor Operational Hours (AD 2.3), ATS table',
    url,
    revisedAirac,
    attribution: 'Operational hours © Avinor AS, used with permission. Non-commercial use only.'
  };
  await mkdir('tools/prepared', { recursive: true });
  await writeFile(SNAPSHOT, JSON.stringify({ ...source, entries }, null, 1) + '\n', 'utf8');

  for (const a of dataset.aerodromes) {
    const e = entries[a.icao];
    a.ats = e ? { hours: e.hours, rmk: e.rmk } : null;
  }
  // The same fields build-aip.mjs attaches, so the two writers cannot disagree.
  dataset.atsHoursSource = { source: source.source, url: source.url, revisedAirac, attribution: source.attribution };
  await writeFile(DATA, src.slice(0, at) + PREFIX + JSON.stringify(dataset) + ';\n', 'utf8');

  console.log(`ATS hours: ${icaos.length} aerodromes, revised per AIRAC ${revisedAirac} - decoded`, decoded);
  for (const r of refused) console.log(`  shown raw, not decoded: ${r.icao} - ${r.reason}`);
  if (missing.length) console.log(`  no entry in the hours table: ${missing.join(' ')}`);
  console.log(`wrote ${SNAPSHOT} and the ats field of ${DATA}`);
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
