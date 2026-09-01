#!/usr/bin/env node
/**
 * Prepare Norway's national border - `npm run build:border`.
 *
 * SOURCE AND LICENCE. Kartverket (the Norwegian Mapping Authority) publishes
 * the administrative-units dataset under NLOD - the Norwegian Licence for Open
 * Government Data - and its `app:Grense` features carry an
 * `app:avgrensningstype` of Riksgrense (national border), Fylkesgrense
 * (county) or Kommunegrense (municipality). We take only Riksgrense.
 *
 * This is a SEPARATE grant from the Avinor AIP permission. Kartverket is
 * NLOD, which is open; the AIP is used by permission and non-commercially.
 * Do not conflate them - the airspace dataset depends on both, and each keeps
 * its own attribution.
 *
 * WHY IT IS A SEPARATE, COMMITTED STEP. The output makes the airspace build
 * reproducible and auditable: `tools/build-aip.mjs` reads this snapshot rather
 * than hitting Kartverket, so re-running the importer cannot silently change
 * a published boundary because a WFS moved underneath it. Re-run this only
 * deliberately, and the retrieval date in the file says when.
 *
 * Verified Sep 2026: 329 fragments, 18 763 points, stitching into exactly ONE
 * chain of 18 435 points. If a future run produces more than one chain the
 * border has gaps and the run FAILS rather than resolving airspace against a
 * broken line.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { stitchFragments, simplify } from './aip-border.mjs';

const WFS = 'https://wfs.geonorge.no/skwms1/wfs.administrative_enheter';
const NS = 'https://skjema.geonorge.no/SOSI/produktspesifikasjon/AdmEnheter/20240101';
const OUT = 'tools/prepared/norway-border.json';
const UA = 'C182FlightPlanner-BorderPreparer/1.0';

/** Only the national border, filtered server-side so we never hold the
 *  county and municipality lines at all. */
const FILTER = `<fes:Filter xmlns:fes="http://www.opengis.net/fes/2.0" xmlns:app="${NS}">` +
  '<fes:PropertyIsEqualTo><fes:ValueReference>app:avgrensningstype</fes:ValueReference>' +
  '<fes:Literal>Riksgrense</fes:Literal></fes:PropertyIsEqualTo></fes:Filter>';

async function main() {
  const url = new URL(WFS);
  url.search = new URLSearchParams({
    service: 'WFS', version: '2.0.0', request: 'GetFeature',
    typeNames: 'app:Grense', srsName: 'EPSG:4326', FILTER
  }).toString();

  const res = await fetch(url, {
    headers: { accept: 'application/gml+xml,application/xml,text/xml', 'user-agent': UA }
  });
  if (!res.ok) throw new Error(`Kartverket WFS -> HTTP ${res.status} ${res.statusText}`);
  const retrievedAtUtc = new Date().toISOString();
  const xml = await res.text();

  // Refuse to proceed if the filter did not hold: a response containing county
  // or municipality lines would put the wrong boundary into an airspace.
  const kinds = [...new Set([...xml.matchAll(/<app:avgrensningstype>([^<]*)</g)].map(m => m[1]))];
  if (kinds.length !== 1 || kinds[0] !== 'Riksgrense') {
    throw new Error('the WFS filter did not hold - got boundary types: ' + JSON.stringify(kinds));
  }

  /** @type {[number, number][][]} */
  const fragments = [];
  for (const m of xml.matchAll(/<gml:posList>([^<]*)<\/gml:posList>/g)) {
    const n = m[1].trim().split(/\s+/).map(Number);
    if (n.some((v) => !isFinite(v)) || n.length % 2) {
      throw new Error('a border fragment has a malformed coordinate list');
    }
    /** @type {[number, number][]} */
    const pts = [];
    // EPSG:4326 requested in the short form: this service returns lon lat.
    // Verified against known Norwegian coordinates - 9.86 59.22 is Telemark,
    // not somewhere off Somalia.
    for (let i = 0; i < n.length; i += 2) pts.push([n[i + 1], n[i]]);
    fragments.push(pts);
  }
  if (!fragments.length) throw new Error('no border geometry in the response');

  const chains = stitchFragments(fragments);
  const totalPoints = fragments.reduce((s, f) => s + f.length, 0);
  if (chains.length !== 1) {
    throw new Error(`the border did not stitch into one continuous line: ${chains.length} chains ` +
      `of ${chains.map((c) => c.length).join(', ')} points. Resolving airspace against a broken ` +
      `border would produce a boundary that does not exist.`);
  }

  const chain = chains[0];
  const lat = chain.map((p) => p[0]), lng = chain.map((p) => p[1]);
  const dataset = {
    schema: 1,
    provider: 'Kartverket',
    datasetName: 'Administrative enheter - Riksgrense',
    attribution: 'National border © Kartverket, NLOD (Norwegian Licence for Open Government Data)',
    sourceUrl: url.toString(),
    retrievedAtUtc,
    crs: 'EPSG:4326',
    fragments: fragments.length,
    sourcePoints: totalPoints,
    points: chain.length,
    bbox: { south: Math.min(...lat), north: Math.max(...lat), west: Math.min(...lng), east: Math.max(...lng) },
    line: chain.map((p) => [Number(p[0].toFixed(7)), Number(p[1].toFixed(7))])
  };

  await mkdir('tools/prepared', { recursive: true });
  await writeFile(OUT, JSON.stringify(dataset) + '\n', 'utf8');
  console.log(`${OUT}: ${fragments.length} fragments -> 1 chain, ${chain.length} points`);
  console.log(`  bbox lat ${dataset.bbox.south.toFixed(3)}..${dataset.bbox.north.toFixed(3)}` +
    `  lng ${dataset.bbox.west.toFixed(3)}..${dataset.bbox.east.toFixed(3)}`);
  const thinned = simplify(chain, 0.02);
  console.log(`  (at the 0.02 NM render tolerance the same line is ${thinned.length} points)`);
}

main().catch((err) => { console.error(String(err.message || err)); process.exitCode = 1; });
