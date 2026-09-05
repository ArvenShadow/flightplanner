#!/usr/bin/env node
/**
 * Build the AIP airspace dataset - `npm run build:aip`.
 *
 * PERMISSION. Avinor's eAIP is copyright Avinor AS and its GEN 0.1 states
 * that any use outside copyright law is inadmissible without permission. The
 * project owner HOLDS that permission from Avinor, conditional on the
 * software not being used commercially. That condition is a project-level
 * constraint now, not a footnote: it is recorded in CLAUDE.md, stated in the
 * generated dataset, and shown in the app's guide and attribution line. If
 * this planner is ever commercialised, this dataset must be removed first.
 *
 * WHAT IT DOES. Fetches the current eAIP edition once, at BUILD time, and
 * emits a normalized sidecar. The browser never contacts Avinor and never
 * parses eAIP HTML - the same rule the winds and weather features follow for
 * a different reason. Pages are cached under .aip-cache/ so a re-run needs
 * no network and a parser change can be re-tested offline.
 *
 * WHY A SIDECAR AND NOT JSON: ES modules and fetch() are both blocked on a
 * file:// page, so bulk data ships as `data/*.js` assigning to a global. That
 * is the same constraint that forced the classic-script bundle.
 *
 * WHAT IT REFUSES TO DO. An airspace whose published boundary references the
 * national border, or a coastline, or an arc, is SKIPPED and named in the
 * report. It is never approximated with straight lines between the published
 * points - that would draw a boundary that does not exist, in a tool whose
 * whole purpose is to be right. Resolving border references needs
 * Kartverket's official boundary (their WFS publishes it under NLOD); until
 * that is wired in, those airspaces are absent and the report says so.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { extractFields, parseDms, verticalLimit, remarkDesignators, remarkNote, designatorTokens,
         borderNameFromRemark } from './aip-fields.mjs';
import { borderPath, isForeignBorder, SNAP_TOLERANCE_NM } from './aip-border.mjs';

const CACHE = '.aip-cache';
const OUT_DATA = 'data/aip.js';
const OUT_REPORT = 'data/aip-report.json';
const BORDER_FILE = 'tools/prepared/norway-border.json';
const VAC_FILE = 'tools/prepared/vac-points.json';
const ROOT = 'https://aim-prod.avinor.no';
const UA = 'C182FlightPlanner-AipImporter/1.0 (ground planning; permission held)';

/** Follow /no/AIP to whichever index Avinor currently publishes, rather than
 *  hardcoding one: a hardcoded index silently serves a superseded edition. */
async function discoverEdition() {
  const res = await fetch(ROOT + '/no/AIP', { redirect: 'manual', headers: { 'user-agent': UA } });
  const loc = res.headers.get('location') || '';
  const m = loc.match(/\/View\/Index\/(\d+)/);
  if (!m) throw new Error('could not discover the current AIP index from ' + JSON.stringify(loc));
  const index = m[1];

  // The edition path is not in the redirect; probe the AIRAC path the index
  // page itself serves. AD 1.3 carries the effective date in a meta tag.
  const editions = [];
  for (const guess of editionCandidates()) {
    const url = `${ROOT}/no/AIP/View/Index/${index}/${guess}/html/eAIP/EN-AD-1.3-en-GB.html`;
    const probe = await fetch(url, { headers: { 'user-agent': UA } });
    if (probe.ok) { editions.push({ label: guess, url, html: await probe.text() }); break; }
  }
  if (!editions.length) throw new Error('no AIRAC edition path resolved under index ' + index);
  const found = editions[0];
  const eff = found.html.match(/effectiveDateStart"\s+content="([\d-]+)"/);
  const amdt = found.html.match(/AMDT[^A-Za-z0-9]{0,4}(\d{2}\/\d{4})/);
  return {
    index,
    editionLabel: found.label,
    effectiveFrom: eff ? eff[1] : null,
    revision: amdt ? 'AIP AMDT ' + amdt[1] : null,
    base: `${ROOT}/no/AIP/View/Index/${index}/${found.label}/html/eAIP`,
    indexUrl: found.url
  };
}

/** AIRAC dates are every 28 days. Walk backwards from today so the newest
 *  published edition is found first, and stop after a year. */
function editionCandidates() {
  const out = [];
  // 2026-06-11 is a known AIRAC effective date; the series steps by 28 days.
  const anchor = Date.UTC(2026, 5, 11);
  const now = Date.now();
  let k = Math.ceil((now - anchor) / (28 * 86400000)) + 1;
  for (; k >= -13; k--) {
    const d = new Date(anchor + k * 28 * 86400000);
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}-AIRAC`);
  }
  return out;
}

async function page(edition, name) {
  await mkdir(CACHE, { recursive: true });
  const file = join(CACHE, `${edition.editionLabel}-${name}.html`);
  const cached = await readFile(file, 'utf8').catch(() => null);
  if (cached) return cached;
  const url = `${edition.base}/${name}-en-GB.html`;
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const html = await res.text();
  await writeFile(file, html, 'utf8');
  return html;
}

/**
 * Split one page's field stream into airspace blocks, and each block into its
 * SUB-VOLUMES.
 *
 * THE GROUPING KEY IS THE TABLE ROW, not the name marker. ENR 2.1 states an
 * airspace's name in the FIRST cell of its row; ENR 2.2 states it in the LAST,
 * after the geometry, callsign and frequency. So "a block starts at the name"
 * shifted every ENR 2.2 sector's data by one row - Polaris ACC Sector 1 came
 * out holding Sector 2's frequency, which is exactly the kind of confident
 * wrong answer this project exists to avoid. Measured: no row in any page
 * names more than one airspace, so the row IS the airspace.
 *
 * WITHIN a row, a stepped airspace is several sub-volumes and EACH HAS ITS OWN
 * LATERAL RING as well as its own band and class:
 *
 *     <vertices of sub-volume 1>
 *     TAIRSPACE_VOLUME;...;1411      <- band of sub-volume 1
 *     TAIRSPACE_LAYER_CLASS;...      <- class of sub-volume 1
 *     <vertices of sub-volume 2>
 *     ...
 *
 * so the vertices accumulated since the previous volume belong to the volume
 * that closes them. Concatenating them merges separate areas into a bow tie.
 *
 * SERVICES: a row that names an airspace AND carries frequencies states that
 * airspace's own services (ENR 2.1 and 2.2). An AD 2 page keeps its airspace
 * in AD 2.17 and its communication in AD 2.18, different rows entirely, so
 * services from rows that name no airspace go into a page-level pool and are
 * used only for airspaces that have none of their own - at an aerodrome page
 * those ARE the aerodrome's services.
 *
 * The numeric record ids are pairing keys within a row, not identities across
 * the document - the same id can recur - so they are never used as feature ids.
 */
function airspaceBlocks(fields) {
  const names = fields.filter((f) => f.record === 'TAIRSPACE' && f.field === 'CUSTOM_ATT24');

  // WHICH SIDE OF ITS DATA DOES THE NAME SIT ON? Decided per entry, from the
  // entry's own row, because ENR 2.2 mixes both layouts: 'F' = name first
  // (ENR 2.1, AD 2, and most of ENR 2.2), 'L' = name last, which is exactly
  // the Polaris ACC Sector table. Measured on this edition: the L entries are
  // one contiguous run of 30 and each keeps ALL its data in its own row, so an
  // L block is that row and nothing else - which is also what stops an L claim
  // and the preceding F claim from overlapping.
  const firstVertexRow = new Map();
  for (const f of fields) {
    if (f.record === 'TAIRSPACE_VERTEX' && f.field === 'GEO_LAT' && !firstVertexRow.has(f.row)) {
      firstVertexRow.set(f.row, f.order);
    }
  }
  const entries = names.map((n) => {
    const v = firstVertexRow.get(n.row);
    return { name: n, side: (v !== undefined && v < n.order) ? 'L' : 'F' };
  });
  const lastRows = new Set(entries.filter((e) => e.side === 'L').map((e) => e.name.row));

  /** @type {any[]} */
  const blocks = [];
  const pageServices = [];

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    let own;
    if (e.side === 'L') {
      own = fields.filter((f) => f.row === e.name.row);
    } else {
      const next = entries[i + 1] ? entries[i + 1].name.order : Infinity;
      own = fields.filter((f) => f.order > e.name.order && f.order < next && !lastRows.has(f.row));
    }
    blocks.push(parseBlock(e.name, own));
  }

  // Rows that name no airspace at all: at an AD 2 page these are AD 2.18, the
  // aerodrome's communication table, which the AD 2.17 airspace row needs.
  const claimed = new Set();
  for (const e of entries) claimed.add(e.name.row);
  for (const e of entries.filter((x) => x.side === 'F')) {
    // an F block's span may cover unnamed rows; those are its own, not the pool
    const i = entries.indexOf(e);
    const next = entries[i + 1] ? entries[i + 1].name.order : Infinity;
    for (const f of fields) if (f.order > e.name.order && f.order < next) claimed.add(f.row);
  }
  const orphan = fields.filter((f) => !claimed.has(f.row));
  const pool = parseBlock(null, orphan);
  pageServices.push(...pool.services);

  return { blocks, pageServices };
}

/**
 * Parse one airspace's fields into sub-volumes and services.
 *
 * A stepped airspace is several sub-volumes and EACH HAS ITS OWN LATERAL RING
 * as well as its own band and class, stated as: vertices, volume, class,
 * vertices, volume, class... So the vertices accumulated since the previous
 * volume belong to the volume that closes them. Concatenating a block's
 * vertices into one ring merges separate areas into a bow tie.
 *
 * @param {any} nameField the TAIRSPACE;CUSTOM_ATT24 field, or null for the pool
 * @param {any[]} own the fields belonging to this entry, in document order
 */
function parseBlock(nameField, own) {
  const block = {
    name: nameField ? nameField.value : '',
    type: nameField ? (nameField.after || '').trim() : '',
    volumes: [], outline: [], services: [],
    // Set from the source's own TORG_AUTH marker - see the handler below.
    isDelegation: false, withinFir: '', atsBy: ''
  };
  let pending = [];
  let volume = null;
  let svc = null;

  for (const f of own) {
    if (f.record === 'TAIRSPACE' && f.field === 'TXT_LOCAL_TYPE') { block.type = f.value || block.type; continue; }
    if (f.record === 'TAIRSPACE' && f.field === 'CUSTOM_ATT24') { continue; }   // the name itself
    if (f.record === 'TGEO_BORDER' && f.field === 'TXT_NAME') {
      pending.push({ kind: 'border', name: f.value });
      block.outline.push(pending[pending.length - 1]);
      continue;
    }
    if (f.record === 'TAIRSPACE_VERTEX') {
      if (volume) volume = null;        // a vertex after a volume starts the next ring
      const last = pending[pending.length - 1];
      if (f.field === 'GEO_LAT') {
        pending.push({ kind: 'vertex', id: f.id, lat: f.value, lng: null });
        block.outline.push(pending[pending.length - 1]);
      } else if (f.field === 'GEO_LONG' && last && last.kind === 'vertex' && last.lng === null) {
        last.lng = f.value;
      } else if (f.field === 'CUSTOM_ATT27') {
        // THE SECOND FORM OF A BORDER REFERENCE, and it is not tagged as one:
        // the eAIP puts the whole sentence "westwards along the border between
        // Norway and Sweden to" in a REMARK ON THE PRECEDING VERTEX. It means
        // exactly what TGEO_BORDER;TXT_NAME means, and all 27 of them in this
        // edition were being dropped - which drew the Polaris CTA as a straight
        // line across the entire eastern border. See borderNameFromRemark.
        const name = borderNameFromRemark(f.value);
        if (name) {
          pending.push({ kind: 'border', name });
          block.outline.push(pending[pending.length - 1]);
        }
      }
      continue;
    }
    // ATS DELEGATION AREAS are marked by the source itself: a row that names an
    // organisation authority (TORG_AUTH) is stating which FIR the area lies
    // WITHIN and which country provides the service there. Measured: 17 rows in
    // the edition carry it, and they are exactly the 17 delegation areas of
    // ENR 2.2 section 5 - so this is the source's own discriminator, not a
    // guess from the name.
    if (f.record === 'TORG_AUTH') {
      if (f.field === 'TXT_NAME') {
        // The FIR comes first ("SWEDEN" followed by the untagged word "FIR"),
        // the responsible state second.
        if (/^FIR/.test(f.after || '') && !block.withinFir) block.withinFir = f.value;
        else if (!block.atsBy) block.atsBy = f.value;
      }
      block.isDelegation = true;
      continue;
    }
    if (f.record === 'TAIRSPACE_VOLUME') {
      if (!volume || volume.id !== f.id) {
        volume = { id: f.id, outline: pending, fields: {}, class: null };
        block.volumes.push(volume);
        pending = [];
      }
      volume.fields[f.field] = f.value;
      continue;
    }
    if (f.record === 'TAIRSPACE_LAYER_CLASS' && f.field === 'CODE_CLASS') {
      if (volume && volume.class === null) volume.class = f.value;
      continue;
    }

    // ---- ATS communication, kept AS SERVICES rather than a flat list ----
    // AD 2.18 tags the service (TSERVICE;CODE_TYPE); ENR 2.1 and 2.2 do not
    // and give only a callsign, which is self-describing, so the code is
    // derived from it there and left null if it matches nothing.
    if (f.record === 'TSERVICE' && f.field === 'CODE_TYPE') {
      svc = { code: f.value.toUpperCase(), callsign: null, freqs: [] };
      block.services.push(svc);
      continue;
    }
    if (f.record === 'TCALLSIGN_DETAIL' && f.field === 'CUSTOM_ATT7') {
      if (svc && svc.callsign === null && !svc.freqs.length) svc.callsign = f.value;
      else { svc = { code: null, callsign: f.value, freqs: [] }; block.services.push(svc); }
      continue;
    }
    if (f.record === 'TFREQUENCY') {
      if (!svc) { svc = { code: null, callsign: null, freqs: [] }; block.services.push(svc); }
      if (f.field === 'VAL_FREQ_TRANS') { svc.freqs.push({ id: f.id, mhz: f.value, unit: '', remarks: '' }); continue; }
      const q = svc.freqs.find((x) => x.id === f.id);
      if (!q) continue;
      if (f.field === 'UOM_FREQ') q.unit = f.value;
      // CUSTOM_ATT27 is the published remark: 'MIL' on a military channel, and
      // the SECTOR NAME on a Polaris Control frequency.
      else if (f.field === 'CUSTOM_ATT27') q.remarks = f.value;
      continue;
    }
  }
  // A FREQUENCY WITHOUT A PUBLISHED UNIT IS NOT AN ATS FREQUENCY (v16.42).
  //
  // AD 2.18's communication table states every frequency with its unit
  // (`TFREQUENCY;UOM_FREQ` = MHZ). Some PROSE paragraphs elsewhere on the page
  // also carry a tagged `VAL_FREQ_TRANS` - ground handling and de-icing
  // coordination - and those have no unit. Because frequencies are paired with
  // the preceding service in document order, every one of them was landing on
  // the last APPROACH service of the aerodrome, so the hover card told a pilot
  // that Kjevik Approach works 121.780 when that is Wideroe ground handling.
  //
  // MEASURED over the 2026-09-03 edition: 10 of 1683 frequencies have no unit,
  // and all 10 are prose - "Wideroe Ground Handling: 121.780", "De-icing FREQ
  // 121.780", "De-ice frequency for WGH 121.955", "DEICE COORDINATOR ... FREQ
  // 131.905". The split is clean, so the unit is the discriminator.
  for (const s of block.services) s.freqs = s.freqs.filter((q) => q.unit);
  return block;
}

/**
 * An ACC sector: its ring, its band, and the ONE frequency published for it.
 *
 * The sector's own row states its frequency with the sector name in the remark
 * (`118.830`, remark "Sector 1"), so the pairing comes from the source and is
 * cross-checked against the airspace name below - a mismatch is reported
 * rather than trusted, because an off-by-one here would put the wrong
 * frequency on the wrong piece of sky. That is not hypothetical: reading the
 * eAIP by name marker instead of by row produced exactly that error.
 *
 * @returns {boolean} true when the sector was usable and stored
 */
function collectSector(b, label, report) {
  const geom = ringOf(b.volumes.length ? b.volumes[0].outline : b.outline, label, report._border, report);
  if (geom.skip) {
    report.sectorsUnresolved.push({ name: label, reason: geom.skip, detail: geom.detail });
    return false;
  }
  const vol = b.volumes[0];
  const lower = vol ? verticalLimit(vol.fields.VAL_DIST_VER_LOWER, vol.fields.UOM_DIST_VER_LOWER, vol.fields.CODE_DIST_VER_LOWER)
                    : { text: '', ft: null, datum: null, kind: 'unknown' };
  const upper = vol ? verticalLimit(vol.fields.VAL_DIST_VER_UPPER, vol.fields.UOM_DIST_VER_UPPER, vol.fields.CODE_DIST_VER_UPPER)
                    : { text: '', ft: null, datum: null, kind: 'unknown' };

  const svc = b.services.find((sv) => sv.freqs.length) || null;
  const q = svc ? svc.freqs[0] : null;
  if (!q) { report.sectorsUnresolved.push({ name: label, reason: 'no-published-frequency' }); return false; }

  // The remark names the sector the frequency serves. It must agree with the
  // airspace it was found on, or the pairing is not trustworthy.
  const remark = String(q.remarks || '').trim();
  const nameTail = label.replace(/^.*ACC\s+/i, '').trim();      // "Sector 1"
  const said = remarkDesignators(remark);
  const mine = designatorTokens(nameTail);
  if (said.length && mine.length && !said.some((d) => mine.includes(d))) {
    report.sectorsUnresolved.push({
      name: label, reason: 'sector-frequency-mismatch',
      detail: `airspace "${nameTail}" carries a frequency remarked "${remark}"`
    });
    return false;
  }

  report.sectors.push({
    name: label,
    lower, upper,
    callsign: svc.callsign || null,
    mhz: q.mhz,
    remark,
    designators: said,
    note: remarkNote(remark),
    ring: geom.ring,
    borderSegments: geom.borderSegments || 0
  });
  return true;
}


/**
 * The published ring, with any national-border stretch expanded from
 * Kartverket's prepared boundary - or a reason it cannot be drawn.
 *
 * A border reference means "from the previous published fix, ALONG THIS
 * BORDER, to the next one". So the outline is walked in order: a vertex
 * contributes its point, a border item contributes the boundary between its
 * two neighbours. Nothing is ever joined with a straight line to stand in for
 * a border - if the border cannot be resolved the whole airspace is refused.
 */
function ringOf(outline, label, border, report) {
  const pts = [];
  /** @type {{name: string, snapFromNM: number, snapToNM: number, lengthNM: number}[]} */
  const resolved = [];
  // Every border reference this outline states. Needed for the accounting, and
  // it must be the WHOLE count rather than "the one that failed": refusing an
  // airspace returns immediately, so the references after the failing one are
  // never visited - Halti states two and only the first was ever seen. An
  // uncounted reference is precisely the bug this invariant exists to catch.
  const refsHere = (outline || []).filter((i) => i && i.kind === 'border').length;
  /** @param {string} skip @param {string} detail */
  const refuse = (skip, detail) => {
    if (report.borderRefs) report.borderRefs.refused += refsHere - resolved.length;
    return { skip, detail };
  };
  const push = (p) => {
    const prev = pts[pts.length - 1];
    if (prev && prev[0] === p[0] && prev[1] === p[1]) return;
    pts.push(p);
  };
  const at = (i) => {
    const item = outline[i];
    if (!item || item.kind !== 'vertex') return null;
    const lat = parseDms(item.lat), lng = parseDms(item.lng || '');
    if (lat === null || lng === null) return null;
    return [Number(lat.toFixed(6)), Number(lng.toFixed(6))];
  };

  for (let i = 0; i < outline.length; i++) {
    const item = outline[i];
    if (item.kind === 'vertex') {
      const p = at(i);
      if (!p) return refuse('unparsable-coordinate', `${item.lat} ${item.lng}`);
      push(p);
      continue;
    }
    // a border stretch between the fix before it and the fix after it
    const from = at(i - 1), to = at(i + 1);
    if (!from || !to) {
      return refuse('border-reference-without-two-fixes', item.name);
    }
    if (isForeignBorder(item.name)) {
      // Kartverket publishes NORWAY's border. A Finland-Sweden stretch is not
      // in it, and snapping to the nearest Norwegian border instead would be
      // a silent, confident error.
      return refuse('foreign-border-reference', `${item.name} is not in Norway's national-border dataset`);
    }
    if (!border) {
      return refuse('national-border-reference', `${item.name} (no prepared boundary - run npm run build:border)`);
    }
    const path = borderPath(border.line, from, to);
    if ('refuse' in path) {
      return refuse(path.refuse, `${item.name}: ${path.detail}`);
    }
    // borderPath returns from..to inclusive; `from` is already pushed and the
    // loop will push `to` when it reaches that vertex.
    for (const p of path.points.slice(1, -1)) push(p);
    resolved.push({ name: item.name, snapFromNM: path.snapFromNM, snapToNM: path.snapToNM, lengthNM: path.lengthNM });
  }

  if (pts.length > 1) {
    const a = pts[0], z = pts[pts.length - 1];
    if (a[0] === z[0] && a[1] === z[1]) pts.pop();
  }
  if (pts.length < 3) return refuse('insufficient-coordinates', pts.length + ' points');
  const maxSnap = resolved.length
    ? Math.max(...resolved.map((r) => Math.max(r.snapFromNM, r.snapToNM))) : 0;
  if (resolved.length) {
    report.borderResolved.push({ name: label, maxSnapNM: Number(maxSnap.toFixed(3)), segments: resolved });
    if (report.borderRefs) report.borderRefs.resolved += resolved.length;
  }
  return { ring: pts, borderSegments: resolved.length, maxSnapNM: Number(maxSnap.toFixed(3)) };
}

/**
 * The service code implied by a published callsign, for the sections that do
 * not tag one (ENR 2.1 and 2.2).
 *
 * This reads a published NAME to pick a LABEL - it never invents a value. An
 * unrecognised callsign yields null and the card then shows the callsign
 * alone rather than guessing at a service.
 *
 * @param {string|null} callsign @returns {string|null}
 */
function codeFromCallsign(callsign) {
  const t = String(callsign || '');
  if (/\bApproach\b|\bRadar\b|\bDirector\b/i.test(t)) return 'APP';
  if (/\bTower\b/i.test(t)) return 'TWR';
  if (/\bInformation\b/i.test(t)) return 'AFIS';
  if (/\bControl\b/i.test(t)) return 'ACC';
  if (/\bRadio\b/i.test(t)) return 'RADIO';
  if (/\bTraffic\b/i.test(t)) return 'TFC';
  return null;
}

const KINDS = [
  [/\bTMA\b/i, 'TMA'], [/\bCTR\b/i, 'CTR'], [/\bTIZ\b/i, 'TIZ'],
  [/\bTIA\b/i, 'TIA'], [/\bCTA\b/i, 'CTA'], [/\bRMZ\b/i, 'RMZ'],
  [/\bTMZ\b/i, 'TMZ'], [/\bHTZ\b/i, 'HTZ'], [/\bADS\b/i, 'ADS'],
  [/\bACC\b|\bSector\b/i, 'ACC'], [/\bOCA\b/i, 'OCA'],
  [/\bFIR\b/i, 'FIR'], [/\bUIR\b/i, 'UIR']
];

/** Airspace that is not a VFR planning consideration and is not drawn: the
 *  FIR is the whole country, an oceanic CTA is the whole sea, and an ACC
 *  sector is an en-route control division several flight levels above a
 *  C182. Drawing them buries the CTRs and TMAs that matter. */
const NOT_DRAWN = new Set(['FIR', 'UIR', 'OCA', 'ACC']);

/** The type is published as a tagged field in AD 2 and as untagged text in
 *  ENR 2.1, and for a few entries only the NAME carries it (POLARIS FIR).
 *  Read both. */
function kindOf(type, name) {
  const text = `${type || ''} ${name || ''}`;
  for (const [re, k] of KINDS) if (re.test(text)) return k;
  return (type || '').toUpperCase() || 'OTHER';
}

/**
 * Split an outline into closed rings.
 *
 * A PUBLISHED RING CLOSES BY REPEATING ITS OWN FIRST VERTEX - that repeat is
 * the source's own delimiter, not a heuristic. Verified across the whole
 * edition: for 143 of 144 airspace blocks, splitting on closure yields exactly
 * as many rings as the block has volumes.
 *
 * This is needed because AD 2.17 uses the OPPOSITE layout to ENR 2.1: it lists
 * every ring first and then every volume, so the per-volume association below
 * leaves all but the first volume with no vertices at all. Notodden TIZ is the
 * case that exposed it - 21 vertices and 3 volumes, which without this rule
 * became one ring crossing itself 35 times.
 *
 * @param {{kind: string, lat?: string, lng?: string|null, name?: string}[]} items
 * @returns {typeof items[]}
 */
function splitRings(items) {
  const rings = [];
  let cur = [], first = null;
  for (const it of items) {
    if (it.kind !== 'vertex') { cur.push(it); continue; }
    const key = `${it.lat} ${it.lng}`;
    if (!cur.length) { first = key; cur.push(it); continue; }
    if (key === first) { rings.push(cur); cur = []; first = null; continue; }
    cur.push(it);
  }
  if (cur.length) rings.push(cur);
  return rings;
}

/** How many border references a block's own outline states, across every
 *  sub-volume plus the block-level list. Used only to keep the accounting
 *  honest for blocks that are never turned into geometry. */
function borderRefsIn(b) {
  const inOne = (/** @type {any[]} */ list) => (list || []).filter((i) => i && i.kind === 'border').length;
  const vols = (b.volumes || []).reduce((n, v) => n + inOne(v.outline), 0);
  return vols || inOne(b.outline);
}

function buildFeatures(blocks, source, report, border, pageServices) {
  const out = [];
  // The eAIP restates a few volumes verbatim. Drawing one twice double-darkens
  // the polygon and shows two airspaces where there is one.
  const seen = new Set();

  for (const b of blocks) {
    const kind = kindOf(b.type, b.name);
    const label = `${b.name} ${b.type}`.trim();

    // ATS DELEGATION AREAS ARE NOT AIRSPACE, and drawing them was wrong.
    //
    // ENR 2.2 section 5 publishes the areas where Norway and a neighbour have
    // agreed, by bilateral letter, to transfer WHO PROVIDES THE SERVICE - the
    // airspace itself is unchanged and is already drawn (or belongs to another
    // state). Ten of the seventeen sit INSIDE a foreign FIR: Silver 1 and
    // Silver 2 are in SWEDEN FIR, Halti and Manto in HELSINKI FIR, Area II in
    // SCOTTISH FIR. Drawing them as class-C volumes with a vertical band made
    // them look like controlled airspace a VFR pilot must clear, when they are
    // a statement about which unit answers - and mostly at FL 95 and above,
    // which a C182 never sees.
    //
    // They stay in the DATA (nothing is discarded) with the two fields that
    // make them meaningful, both tagged at source: which FIR the area lies
    // WITHIN, and which state is responsible for ATS inside it.
    if (b.isDelegation) {
      const geom = ringOf(b.volumes.length ? b.volumes[0].outline : b.outline, label, border, report);
      const vol = b.volumes[0];
      report.delegations.push({
        name: b.name,
        withinFir: b.withinFir || null,
        atsBy: b.atsBy || null,
        lower: vol ? verticalLimit(vol.fields.VAL_DIST_VER_LOWER, vol.fields.UOM_DIST_VER_LOWER, vol.fields.CODE_DIST_VER_LOWER).text : '',
        upper: vol ? verticalLimit(vol.fields.VAL_DIST_VER_UPPER, vol.fields.UOM_DIST_VER_UPPER, vol.fields.CODE_DIST_VER_UPPER).text : '',
        class: vol ? vol.class : null,
        drawable: !geom.skip,
        skip: geom.skip || null
      });
      report.skipped.push({
        name: label, kind, source,
        reason: 'ats-delegation-not-airspace',
        detail: `within ${b.withinFir || '?'} FIR, ATS by ${b.atsBy || '?'} - ENR 2.2 section 5`
      });
      continue;
    }

    if (NOT_DRAWN.has(kind)) {
      // ACC sectors are not DRAWN - they tile the whole country and would bury
      // everything - but their geometry is exactly what answers "which Polaris
      // frequency applies here". ENR 2.1 lists all eight sector frequencies
      // against Polaris CTA with no way to tell which is yours; the sector
      // polygon is the way to tell. Collected separately.
      if (kind === 'ACC' && collectSector(b, label, report)) {
        report.skipped.push({ name: label, kind, reason: 'kept-as-acc-sector', source });
      } else {
        // The FIR references the Russian, Finnish and Swedish borders and is
        // deliberately never drawn, so its references become geometry nowhere.
        // Counted so the published total still reconciles.
        report.borderRefs.notDrawn += borderRefsIn(b);
        report.skipped.push({ name: label, kind, reason: 'not-a-vfr-planning-airspace', source });
      }
      continue;
    }
    if (!b.volumes.length) {
      report.borderRefs.notDrawn += borderRefsIn(b);
      report.skipped.push({ name: label, kind, reason: 'no-published-vertical-limits', source });
      continue;
    }

    // AD 2.17 layout: every ring is listed before any volume, so the
    // per-volume walk gave volume 1 everything and the rest nothing. Recover
    // by splitting the block's outline on ring closure - but ONLY when a
    // volume really came back empty, so the ENR 2.1 layout (which states each
    // volume's own vertices, and is the document's own association) is never
    // second-guessed.
    if (b.volumes.length > 1 && b.volumes.some((v) => !v.outline.length)) {
      const rings = splitRings(b.outline);
      if (rings.length === b.volumes.length) {
        b.volumes.forEach((v, i) => { v.outline = rings[i]; });
      } else {
        report.skipped.push({
          name: label, kind, reason: 'rings-do-not-match-volumes',
          detail: `${rings.length} published ring(s) for ${b.volumes.length} volume(s) - not guessing which is which`,
          source
        });
        continue;
      }
    }

    // A row that names an airspace and carries frequencies states its own
    // services. An AD 2.17 airspace row carries none - the aerodrome's
    // communication is in AD 2.18, a different table - so it falls back to
    // the page pool, which at an aerodrome page IS that aerodrome's services.
    const rowServices = b.services.length ? b.services : (pageServices || []);
    const services = rowServices
      .map((sv) => ({
        code: sv.code || codeFromCallsign(sv.callsign),
        callsign: sv.callsign || null,
        freqs: sv.freqs.map((q) => ({
          mhz: String(q.mhz || '').trim(),
          unit: String(q.unit || '').trim(),
          remarks: String(q.remarks || '').trim()
        })).filter((q) => q.mhz)
      }))
      .filter((sv) => sv.freqs.length || sv.callsign);

    const multi = b.volumes.length > 1;

    for (const v of b.volumes) {
      const lower = verticalLimit(v.fields.VAL_DIST_VER_LOWER, v.fields.UOM_DIST_VER_LOWER, v.fields.CODE_DIST_VER_LOWER);
      const upper = verticalLimit(v.fields.VAL_DIST_VER_UPPER, v.fields.UOM_DIST_VER_UPPER, v.fields.CODE_DIST_VER_UPPER);
      if (!lower.text && !upper.text) { report.borderRefs.notDrawn += borderRefsIn({ volumes: [v] }); continue; }
      const band = [lower.text, upper.text].filter(Boolean).join(' - ');
      const name = label + (multi && band ? ` (${band})` : '');

      // EACH sub-volume has its own lateral ring.
      const geom = ringOf(v.outline, name, border, report);
      if (geom.skip) {
        report.skipped.push({ name, kind, reason: geom.skip, detail: geom.detail, source });
        continue;
      }

      const key = name + '|' + band + '|' + JSON.stringify(geom.ring);
      if (seen.has(key)) { report.duplicatesDropped = (report.duplicatesDropped || 0) + 1; continue; }
      seen.add(key);

      out.push({
        name,
        kind,
        class: v.class || null,
        lower, upper,
        ring: geom.ring,
        borderSegments: geom.borderSegments || 0,
        // How far the published corner sat from Kartverket's surveyed border.
        // Recorded so the shape can be audited instead of trusted.
        borderMaxSnapNM: geom.maxSnapNM || 0,
        services,
        // The ICAO of the AD 2 page this came from, where there is one. ENR 2.1
        // airspace spans aerodromes and has none.
        icao: source.icao || null,
        source
      });
    }
  }
  return out;
}

async function main() {
  const edition = await discoverEdition();
  console.log(`edition ${edition.editionLabel}  index ${edition.index}  effective ${edition.effectiveFrom}  ${edition.revision || ''}`);

  /** The prepared Kartverket boundary. Absent is not fatal - the airspaces
   *  that need it are then reported as absent, exactly as before. */
  const border = await readFile(BORDER_FILE, 'utf8').then(JSON.parse).catch(() => null);
  if (border) {
    console.log(`border: ${border.points} points, ${border.provider}, retrieved ${border.retrievedAtUtc.slice(0, 10)}`);
  } else {
    console.log('border: NOT PREPARED - run `npm run build:border`; border-referenced airspaces will be omitted');
  }

  /**
   * The prepared aerodromes and their VFR reporting points.
   *
   * Same arrangement as the border: a COMMITTED snapshot, prepared by
   * `npm run build:vac`, so this build reads a fixed file rather than
   * downloading 48 chart PDFs and needing a PDF library. Absent is not fatal -
   * the dataset then ships with no anchors and the planner says so.
   *
   * Reporting points are NOT in the eAIP HTML at all (verified against ENDU's
   * full 189-marker vocabulary); they exist only on the VAC. See
   * tools/aip-vac.mjs for how they are read and what is refused.
   */
  const vac = await readFile(VAC_FILE, 'utf8').then(JSON.parse).catch(() => null);
  if (vac) {
    if (vac.editionLabel !== edition.editionLabel) {
      // A mismatch is not fatal, but it MUST be said: reporting points from a
      // superseded edition next to current airspace is exactly the kind of
      // quietly-stale mix this project refuses to ship silently.
      console.log(`vac: WARNING - prepared from edition ${vac.editionLabel}, ` +
        `airspace is ${edition.editionLabel}. Re-run \`npm run build:vac\`.`);
    }
    console.log(`vac: ${vac.points} reporting points at ${vac.aerodromesWithPoints} of ` +
      `${vac.aerodromes} aerodromes, retrieved ${String(vac.retrievedAtUtc).slice(0, 10)}`);
  } else {
    console.log('vac: NOT PREPARED - run `npm run build:vac`; the dataset will carry no aerodrome anchors');
  }

  const report = {
    delegations: [],
    /** Border references PUBLISHED, in both forms, versus what became geometry.
     *  tagged + onVertexRemark must equal resolved + refused, or a reference
     *  was dropped on the floor. */
    borderRefs: { tagged: 0, onVertexRemark: 0, resolved: 0, refused: 0, notDrawn: 0 },
    provider: 'Avinor', source: 'eAIP',
    editionLabel: edition.editionLabel,
    effectiveFrom: edition.effectiveFrom,
    revision: edition.revision,
    indexUrl: edition.indexUrl,
    retrievedAtUtc: new Date().toISOString(),
    permission: 'Used with permission from Avinor AS. Non-commercial use only.',
    border: border ? {
      provider: border.provider, attribution: border.attribution,
      retrievedAtUtc: border.retrievedAtUtc, points: border.points,
      snapToleranceNM: SNAP_TOLERANCE_NM
    } : null,
    counts: {}, skipped: [], borderResolved: [], pages: [],
    sectors: [], sectorsUnresolved: [],
    // ringOf needs the boundary; collectSector reaches it through the report
    // rather than threading another argument through buildFeatures.
    _border: border
  };

  const features = [];
  const pages = [
    ['EN-ENR-2.1', 'ENR 2.1'],
    ['EN-ENR-2.2', 'ENR 2.2']
  ];
  // AD 2.17 carries each aerodrome's own CTR / TIZ.
  const ad13 = await page(edition, 'EN-AD-1.3');
  const icaos = [...new Set((ad13.match(/\bEN[A-Z]{2}\b/g) || []))].sort();
  for (const icao of icaos) pages.push([`EN-AD-2.${icao}`, `AD 2.17 ${icao}`, icao]);

  for (const [file, label, icao] of pages) {
    let html;
    try { html = await page(edition, file); }
    catch (err) { report.pages.push({ page: label, error: String(err.message || err) }); continue; }
    const fields = extractFields(html);

    // COUNT EVERY BORDER REFERENCE THE SOURCE STATES, in both of its forms, so
    // the invariant below can be asserted: resolved + refused must equal what
    // was published. That invariant is what catches the v16.36 bug class - the
    // second form (a border sentence carried as a remark on the preceding
    // vertex) was silently dropped for 27 references, and every count in the
    // report still looked healthy because nothing knew to expect them.
    for (const f of fields) {
      if (f.record === 'TGEO_BORDER' && f.field === 'TXT_NAME') report.borderRefs.tagged++;
      else if (f.record === 'TAIRSPACE_VERTEX' && f.field === 'CUSTOM_ATT27'
               && borderNameFromRemark(f.value)) report.borderRefs.onVertexRemark++;
    }

    const { blocks, pageServices } = airspaceBlocks(fields);
    const url = `${edition.base}/${file}-en-GB.html`;
    const built = buildFeatures(blocks, { section: label, url, icao: icao || null }, report, border, pageServices);
    features.push(...built);
    report.pages.push({ page: label, blocks: blocks.length, features: built.length });
    process.stdout.write(`  ${label}: ${built.length} volume(s) from ${blocks.length} block(s)\n`);
  }

  const byKind = {};
  for (const f of features) byKind[f.kind] = (byKind[f.kind] || 0) + 1;
  report.counts = { features: features.length, byKind, skipped: report.skipped.length };

  const reasons = {};
  for (const s of report.skipped) reasons[s.reason] = (reasons[s.reason] || 0) + 1;
  report.skippedByReason = reasons;

  // ACC sectors ship alongside the airspace: not drawn, but used to answer
  // which area-control frequency applies at a given position.
  const sectors = report.sectors.map((x) => ({
    name: x.name, lower: x.lower, upper: x.upper,
    callsign: x.callsign, mhz: x.mhz, ring: x.ring, borderSegments: x.borderSegments
  }));

  const dataset = {
    schema: 1,
    provider: 'Avinor',
    source: 'eAIP',
    editionLabel: edition.editionLabel,
    effectiveFrom: edition.effectiveFrom,
    revision: edition.revision,
    attribution: 'Airspace data © Avinor eAIP, used with permission. Non-commercial use only.' +
      (border ? ' National border © Kartverket (NLOD).' : ''),
    features,
    sectors,
    /** Aerodromes as ANCHORS: the published ARP, elevation and variation, plus
     *  the VFR reporting points read off the VAC. This is what lets a pilot
     *  put a waypoint on a named fix at its published coordinate instead of
     *  clicking an approximate spot on the map. */
    aerodromes: vac ? vac.data : [],
    aerodromeSource: vac ? {
      source: vac.source, attribution: vac.attribution,
      editionLabel: vac.editionLabel, effectiveFrom: vac.effectiveFrom,
      points: vac.points, aerodromesWithPoints: vac.aerodromesWithPoints
    } : null
  };

  await mkdir('data', { recursive: true });
  // A classic-script sidecar: a file:// page can load this with <script src>,
  // which it cannot do with JSON.
  await writeFile(OUT_DATA,
    '// GENERATED by tools/build-aip.mjs - do not edit by hand.\n' +
    '// ' + dataset.attribution + '\n' +
    'window.C182_AIP = ' + JSON.stringify(dataset) + ';\n', 'utf8');
  await writeFile(OUT_REPORT, JSON.stringify(report, null, 2) + '\n', 'utf8');

  console.log(`\nwrote ${OUT_DATA}  ${features.length} airspace volumes`, byKind);
  console.log(`skipped ${report.skipped.length}:`, reasons);
  console.log(`border-resolved airspaces: ${report.borderResolved.length}`);
  console.log(`ACC sectors: ${sectors.length} usable, ${report.sectorsUnresolved.length} not`);
  console.log(`aerodrome anchors: ${dataset.aerodromes.length} aerodromes, ` +
    `${dataset.aerodromes.reduce((n, a) => n + a.points.length, 0)} reporting points`);
  console.log(`ATS delegation areas (not drawn): ${report.delegations.length}` +
    ` - ${report.delegations.filter((x) => x.withinFir && x.withinFir !== 'POLARIS').length} inside a foreign FIR`);
  const br = report.borderRefs;
  const published = br.tagged + br.onVertexRemark;
  const handled = br.resolved + br.refused + br.notDrawn;
  console.log(`border references: ${published} published (${br.tagged} tagged, ${br.onVertexRemark} on a vertex remark)` +
    ` -> ${br.resolved} resolved, ${br.refused} refused, ${br.notDrawn} in airspace that is never drawn`);
  if (handled !== published) {
    // NOT a warning. A reference the importer never saw is a boundary drawn as
    // a straight line where the AIP says it follows a border, which is exactly
    // the failure this project refuses to ship.
    throw new Error(`${published - handled} border reference(s) unaccounted for: ` +
      `published ${published}, handled ${handled}. A dropped reference draws a boundary that does not exist.`);
  }
  delete report._border;
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
