/**
 * Runways and declared distances from an eAIP AD 2 page (AD 2.12 and 2.13).
 * Pure: HTML in, data out. `tools/build-aip.mjs` does the fetching.
 *
 * TWO SECTIONS, TWO DIFFERENT KINDS OF SOURCE, and the difference is the
 * whole design:
 *
 *  - AD 2.12 (physical characteristics) is TAGGED like the airspace. Each value
 *    arrives under its database field name - `TRWY_DIRECTION;VAL_TRUE_BRG`,
 *    `TRWY;VAL_LEN`, `TRWY;CODE_COMPOSITION` - so nothing is inferred.
 *
 *  - AD 2.13 (declared distances) is only HALF tagged. Every figure is a
 *    `TRWY_DIRECTION_DECL_DIST;VAL_DIST`, but WHICH distance it is - TORA,
 *    ASDA, TODA or LDA - is not in the marker. It is the table COLUMN, and the
 *    column is named only by the table's own header row. So the header is
 *    read, per table, and a figure is only ever assigned by the header above
 *    it. Two traps make that non-negotiable:
 *
 *    1. THE ORDER IS NOT ICAO's. Avinor publishes TORA | ASDA | TODA | LDA;
 *       the textbook order is TORA | TODA | ASDA | LDA. Assuming the textbook
 *       swaps TODA and ASDA silently - and the school's own workbook made
 *       exactly that slip, labelling a cell "TODA" that reads the ASDA column.
 *    2. THE TABLES USE ROWSPAN AND COLSPAN (20 of 53 aerodromes, measured). In
 *       the intersection table the RWY cell spans its positions, so the second
 *       row has one cell fewer and every column shifts left. A row walk that
 *       counts cells would read a TORA as an intersection name. The grid below
 *       places every cell where the browser would.
 *
 * WHAT IS REFUSED, NEVER GUESSED: an aerodrome whose runway ends do not pair
 * up with reciprocal bearings, whose declared-distance rows do not match its
 * runway ends one for one, whose figures are not whole metres, or whose
 * distances contradict each other (TORA longer than the runway, TODA shorter
 * than TORA). It is returned with a reason, so the build can report it, and it
 * carries no runways - a performance check against a misread distance is the
 * plausible wrong answer this project refuses.
 */
import { extractFields } from './aip-fields.mjs';

/** Two ends of one runway point opposite ways. 3 degrees is generous: the
 *  published true bearings of a straight runway differ from 180 by the
 *  meridian convergence over its length, a few hundredths of a degree here. */
export const RECIPROCAL_TOLERANCE_DEG = 3;

const DIST_KEYS = ['tora', 'asda', 'toda', 'lda'];

/**
 * @typedef {object} TakeoffPosition
 * @property {string} name  e.g. 'TWY A'
 * @property {number|null} tora @property {number|null} asda @property {number|null} toda
 * @property {string|null} remark
 */
/**
 * One runway END. The distances arrive from AD 2.13 after AD 2.12 made it.
 * @typedef {object} RunwayEnd
 * @property {string} desig
 * @property {number} trueBrg
 * @property {number|null} [tora] @property {number|null} [asda]
 * @property {number|null} [toda] @property {number|null} [lda]
 * @property {string|null} [remark]
 * @property {TakeoffPosition[]} [positions]
 */

/** Every match of a global regex, without String.prototype.matchAll - this
 *  project targets ES2019, where it does not exist.
 *  @param {string} s @param {RegExp} re @returns {RegExpExecArray[]} */
function allMatches(s, re) {
  /** @type {RegExpExecArray[]} */
  const out = [];
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  for (let m = g.exec(s); m; m = g.exec(s)) { out.push(m); if (m[0] === '') g.lastIndex++; }
  return out;
}

/** @param {string} s */
function decode(s) {
  return s
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

/** A cell's visible text: the hidden field markers and all tags removed.
 *  @param {string} html */
export function cellText(html) {
  return decode(String(html || '')
    .replace(/<span class="sdParams"[^>]*>[\s\S]*?<\/span>/g, '')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}

/**
 * A table as the browser lays it out: `grid[row][col]` is the cell occupying
 * that slot, with rowspan and colspan honoured. The SAME cell object fills
 * every slot it spans, so a spanned RWY cell answers for every row under it.
 *
 * @param {string} tableHtml
 * @returns {Array<Array<{html:string, text:string}>>}
 */
export function tableGrid(tableHtml) {
  const rows = String(tableHtml).match(/<tr[\s\S]*?<\/tr>/g) || [];
  /** @type {Array<Array<{html:string, text:string}>>} */
  const grid = [];
  /** @type {Array<{cell:{html:string,text:string}, left:number}|undefined>} */
  const carry = [];
  for (const r of rows) {
    /** @type {Array<{html:string, text:string}>} */
    const row = [];
    let col = 0;
    const fill = () => {
      for (let c = carry[col]; c && c.left > 0; c = carry[col]) {
        row[col] = c.cell; c.left--; col++;
      }
    };
    for (const m of allMatches(r, /<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/g)) {
      fill();
      const attrs = m[1];
      const cs = Math.max(1, Number((attrs.match(/colspan="(\d+)"/) || [])[1] || 1));
      const rs = Math.max(1, Number((attrs.match(/rowspan="(\d+)"/) || [])[1] || 1));
      const cell = { html: m[2], text: cellText(m[2]) };
      for (let k = 0; k < cs; k++) {
        row[col + k] = cell;
        if (rs > 1) carry[col + k] = { cell, left: rs - 1 };
      }
      col += cs;
    }
    fill();
    grid.push(row);
  }
  return grid;
}

/**
 * One AD 2 section of the page, from its own heading to the next section's.
 *
 * READ BY SECTION, NEVER BY SCANNING THE PAGE. AD 2.16 (helicopter landing
 * area) publishes its FATOs and TLOFs under the SAME `TRWY` and
 * `TRWY_DIRECTION` markers as a runway - a 13 x 13 m pad at ENVA, 238 x 23 m at
 * ENKR - so a whole-page scan turns a helipad into a second runway. Measured:
 * four aerodromes grouped wrongly that way before this existed.
 *
 * @param {string} html
 * @param {string} num   e.g. '2.12'
 * @returns {string|null}
 */
export function sectionHtml(html, num) {
  const heads = allMatches(String(html), /<h(\d)[^>]*>([\s\S]*?)<\/h\1>/g);
  const re = new RegExp('\\bAD ' + num.replace('.', '\\.') + '\\b');
  const i = heads.findIndex((m) => re.test(cellText(m[2])));
  if (i < 0) return null;
  const start = heads[i].index || 0;
  const next = heads.slice(i + 1).find((m) => /\bAD 2\.\d+\b/.test(cellText(m[2])));
  return String(html).slice(start, next ? next.index : undefined);
}

/** Every `<table>` on the page that holds a declared-distance figure.
 *  @param {string} html */
function declaredDistanceTables(html) {
  const out = [];
  const seen = new Set();
  let pos = 0;
  for (;;) {
    const i = html.indexOf('TRWY_DIRECTION_DECL_DIST', pos);
    if (i < 0) break;
    const t0 = html.lastIndexOf('<table', i);
    const t1 = html.indexOf('</table>', i);
    pos = t1 < 0 ? html.length : t1;
    if (t0 < 0 || t1 < 0 || seen.has(t0)) continue;
    seen.add(t0);
    out.push(html.slice(t0, t1));
  }
  return out;
}

/**
 * Which column is which, read from the header row. Returns null when the table
 * has no TORA/LDA header at all (the two heliports publish their FATO
 * distances as prose instead).
 *
 * @param {Array<Array<{text:string}>>} grid
 */
export function headerColumns(grid) {
  for (let r = 0; r < grid.length; r++) {
    const texts = grid[r].map((c) => (c ? c.text : ''));
    if (!texts.some((t) => /^TORA\b/.test(t))) continue;
    /** @type {Record<string, number>} */
    const cols = {};
    /** @type {Record<string, string>} */
    const units = {};
    texts.forEach((t, c) => {
      /** @type {[string, RegExp][]} */
      const keys = [['rwy', /^RWY$/], ['psn', /^TKOF PSN/], ['tora', /^TORA\b/], ['asda', /^ASDA\b/],
        ['toda', /^TODA\b/], ['lda', /^LDA\b/], ['rmk', /^RMK\b/]];
      for (const [k, re] of keys) {
        if (re.test(t) && !(k in cols)) {
          cols[k] = c;
          const u = t.match(/\(([A-Z]+)\)/);
          if (u) units[k] = u[1];
        }
      }
    });
    return { headerRow: r, cols, units };
  }
  return null;
}

/** '2443' -> 2443, 'NIL' / '' -> null, anything else -> undefined (refuse).
 *  @param {string} text */
function distance(text) {
  const t = String(text || '').trim();
  if (/^\d+$/.test(t)) return Number(t);
  if (t === '' || t === 'NIL' || t === '-') return null;
  return undefined;
}

/** The English remark of a cell, if it is tagged; otherwise its text.
 *  @param {{html:string, text:string}|undefined} cell */
function remarkOf(cell) {
  if (!cell) return null;
  const en = extractFields(cell.html).find((f) => f.record === 'TRWY_DIRECTION_DECL_DIST' && f.field === 'CUSTOM_ATT27');
  const t = en ? en.value : cell.text;
  return !t || t === 'NIL' ? null : t;
}

/**
 * The runway ENDS from AD 2.12, grouped into runways by the physical rows the
 * page lays them out in: the row that carries a runway's length also carries
 * its first end, and the next end's row follows it.
 *
 * @param {import('./aip-fields.mjs').AipField[]} fields
 */
export function physicalRunways(fields) {
  /** @type {Map<number, {dirs: Array<{id:string, desig:string|null, trueBrg:number}>, len?:string, wid?:string, surface?:string}>} */
  const rows = new Map();
  const at = (/** @type {number} */ r) => {
    let e = rows.get(r);
    if (!e) { e = { dirs: [] }; rows.set(r, e); }
    return e;
  };
  for (const f of fields) {
    if (f.record === 'TRWY_DIRECTION' && f.field === 'VAL_TRUE_BRG') {
      at(f.row).dirs.push({ id: f.id, desig: null, trueBrg: parseFloat(f.value) });
    } else if (f.record === 'TRWY' && f.field === 'VAL_LEN') at(f.row).len = f.value;
    else if (f.record === 'TRWY' && f.field === 'VAL_WID') at(f.row).wid = f.value;
    else if (f.record === 'TRWY' && f.field === 'CODE_COMPOSITION') at(f.row).surface = f.value;
  }
  // The designator is the TXT_DESIG of the SAME end in the SAME row.
  for (const f of fields) {
    if (f.record !== 'TRWY_DIRECTION' || f.field !== 'TXT_DESIG') continue;
    const e = rows.get(f.row);
    const d = e && e.dirs.find((x) => x.id === f.id);
    if (d && d.desig === null) d.desig = f.value.trim();
  }
  /** @type {Array<{length:number, width:number, surface:string, ends:RunwayEnd[]}>} */
  const runways = [];
  /** @type {string[]} */
  const problems = [];
  for (const r of [...rows.keys()].sort((a, b) => a - b)) {
    const e = rows.get(r);
    if (!e || !e.dirs.length) continue;
    if (e.len !== undefined) {
      runways.push({ length: Number(e.len), width: Number(e.wid), surface: String(e.surface || '').trim(), ends: [] });
    }
    const cur = runways[runways.length - 1];
    if (!cur) { problems.push('a runway end is published before any runway'); continue; }
    for (const d of e.dirs) {
      if (!d.desig) problems.push('a runway end has no designator');
      cur.ends.push({ desig: String(d.desig), trueBrg: d.trueBrg });
    }
  }
  return { runways, problems };
}

/**
 * @param {string} html the AD 2 page
 * @returns {{runways: any[], refused: string|null, heliport: boolean}}
 */
export function parseRunways(html) {
  const page = String(html || '');
  const ad212 = sectionHtml(page, '2.12');
  const ad213 = sectionHtml(page, '2.13');
  const { runways, problems } = physicalRunways(extractFields(ad212 || ''));
  const source = ad213 || '';
  const refuse = (/** @type {string} */ why) => ({ runways: [], refused: why, heliport: false });
  if (!runways.length) {
    // A page with a FATO table and no runway is a heliport; say which it is.
    const heliport = /Declared distances FATO/.test(page);
    return { runways: [], refused: heliport ? null : 'no runway published in AD 2.12', heliport };
  }
  if (problems.length) return refuse(problems[0]);

  for (const rw of runways) {
    if (!(rw.length > 0) || !(rw.width > 0)) return refuse('a runway has no published length or width');
    if (rw.ends.length !== 2) return refuse(`runway ${rw.ends.map((e) => e.desig).join('/')} has ${rw.ends.length} end(s), not 2`);
    const [a, b] = rw.ends;
    if (!(a.trueBrg >= 0 && a.trueBrg <= 360 && b.trueBrg >= 0 && b.trueBrg <= 360)) {
      return refuse(`runway ${a.desig}/${b.desig} has an unreadable true bearing`);
    }
    const off = Math.abs((((b.trueBrg - a.trueBrg) % 360) + 360) % 360 - 180);
    if (off > RECIPROCAL_TOLERANCE_DEG) {
      return refuse(`runway ${a.desig}/${b.desig}: bearings ${a.trueBrg} and ${b.trueBrg} are not reciprocal`);
    }
  }

  /** @type {Map<string, RunwayEnd>} */
  const ends = new Map();
  for (const rw of runways) for (const e of rw.ends) {
    if (ends.has(e.desig)) return refuse(`runway end ${e.desig} is published twice`);
    ends.set(e.desig, e);
  }

  let mainFound = false;
  for (const t of declaredDistanceTables(source)) {
    const grid = tableGrid(t);
    const h = headerColumns(grid);
    if (!h) continue;                       // the heliport FATO prose
    for (const k of DIST_KEYS) {
      if (!(k in h.cols)) {
        // The intersection table legitimately has no LDA: you do not land from
        // a take-off position. Any other missing column is a layout we do not
        // know, and guessing its order is the ASDA/TODA trap.
        if (k === 'lda' && 'psn' in h.cols) continue;
        return refuse(`a declared-distance table has no ${k.toUpperCase()} column`);
      }
      if (h.units[k] !== 'M') return refuse(`${k.toUpperCase()} is published in ${h.units[k] || 'no unit'}, not metres`);
    }
    if (!('rwy' in h.cols)) return refuse('a declared-distance table has no RWY column');
    const isPositions = 'psn' in h.cols;
    if (!isPositions) mainFound = true;

    for (let r = h.headerRow + 1; r < grid.length; r++) {
      const row = grid[r];
      const cell = (/** @type {string} */ k) => row[h.cols[k]];
      const texts = row.map((c) => (c ? c.text : ''));
      // The column-number row the eAIP prints under every header (1 | 2 | 3 ...).
      // With spans the numbers repeat or skip, so it is recognised as a row of
      // nothing but small integers: a real row always carries a distance of
      // hundreds of metres, or a NIL remark.
      if (texts.every((t) => t === '' || (/^\d{1,2}$/.test(t) && Number(t) <= 20))) continue;
      const desig = cell('rwy') ? cell('rwy').text : '';
      if (!desig) continue;
      const end = ends.get(desig);
      if (!end) return refuse(`declared distances name RWY ${desig}, which AD 2.12 does not publish`);
      /** @type {Record<string, number|null>} */
      const d = {};
      for (const k of DIST_KEYS) {
        if (!(k in h.cols)) { d[k] = null; continue; }
        const v = distance(cell(k) ? cell(k).text : '');
        if (v === undefined) return refuse(`RWY ${desig} ${k.toUpperCase()} reads ${JSON.stringify(cell(k).text)}, not a distance`);
        d[k] = v;
      }
      if (isPositions) {
        const name = cell('psn') ? cell('psn').text : '';
        if (!name) return refuse(`RWY ${desig}: a take-off position has no name`);
        (end.positions = end.positions || []).push({
          name, tora: d.tora, asda: d.asda, toda: d.toda, remark: remarkOf(cell('rmk'))
        });
      } else {
        if (end.tora !== undefined) return refuse(`RWY ${desig} has two rows of declared distances`);
        Object.assign(end, d, { remark: remarkOf(cell('rmk')) });
      }
    }
  }
  if (!mainFound) return refuse('no declared-distance table');

  for (const rw of runways) for (const e of rw.ends) {
    if (e.tora === undefined) return refuse(`RWY ${e.desig} has no declared distances`);
    // THE FIGURES MUST AGREE WITH EACH OTHER, which is a cheap check that a
    // column was not shifted: a shifted TODA lands under ASDA or LDA and one of
    // these fails. A stopway or clearway only ever ADDS to TORA.
    //
    // TORA IS NOT CHECKED AGAINST THE RUNWAY LENGTH, and that was measured: the
    // length in AD 2.12 is threshold to threshold, and a runway whose SURFACE
    // runs on past its thresholds declares more. ENAS: 808 m runway, TORA
    // 868 m - 30 m of surface beyond each end, which its own coordinates show.
    const bad =
      (e.tora != null && e.toda != null && e.toda < e.tora) ? `TODA ${e.toda} m is shorter than TORA ${e.tora} m` :
      (e.tora != null && e.asda != null && e.asda < e.tora) ? `ASDA ${e.asda} m is shorter than TORA ${e.tora} m` : null;
    if (bad) return refuse(`RWY ${e.desig}: ${bad}`);
    for (const p of e.positions || []) {
      if (p.toda !== null && p.tora !== null && p.toda < p.tora) {
        return refuse(`RWY ${e.desig} from ${p.name}: TODA shorter than TORA`);
      }
    }
  }
  return { runways, refused: null, heliport: false };
}
