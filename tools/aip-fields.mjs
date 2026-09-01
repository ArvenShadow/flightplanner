/**
 * eAIP field extractor - tools/aip-fields.mjs
 *
 * WHAT THE SOURCE ACTUALLY IS (verified against the live pages, Sep 2026,
 * edition 2026-06-11-AIRAC / AIP AMDT 04/2026):
 *
 * Avinor's eAIP is generated from their AIP database and it carries the
 * DATABASE FIELD NAMES in the HTML, in hidden spans:
 *
 *   <span class="SD" id="ID_4484756">4500</span>
 *   <span class="sdParams" style="display: none;">TAIRSPACE_VOLUME;VAL_DIST_VER_UPPER;1058</span>
 *
 * The visible value sits in a `span.SD`; the `span.sdParams` immediately
 * after it names the record type, the field, and a numeric record id. The
 * vocabulary is AIXM-derived (TAIRSPACE_VERTEX;GEO_LAT, TFREQUENCY;VAL_FREQ_TRANS,
 * TAIRSPACE_LAYER_CLASS;CODE_CLASS ...).
 *
 * THIS IS WHY WE DO NOT PARSE PROSE. Every value we need is individually
 * identified at source, so nothing has to be inferred from English wording:
 * a vertical limit arrives as three separate fields (VAL / UOM / CODE), a
 * frequency arrives with its unit, and an airspace class arrives as a code.
 * A parser that read the sentence instead would be guessing, and guessing is
 * what this project does not do.
 *
 * THREE STRUCTURAL FACTS, each of which broke a simpler first attempt and
 * each of which is now covered by a test:
 *
 *  1. AN EMPTY VALUE IS A SELF-CLOSING SPAN: `<span class="SD" id="X"/>`.
 *     A regex looking for `>...</span>` runs straight past it and captures
 *     the NEXT field's marker as part of this field's value. Empty is
 *     meaningful, too: GND as a lower limit has no UOM and no CODE, which is
 *     precisely how a code-only limit is distinguished from a measured one.
 *  2. A `sdParams` SPAN IS SOMETIMES NESTED INSIDE ITS `SD` SPAN rather than
 *     following it (12 occurrences in ENR 2.1). A flat "previous sibling"
 *     walk mis-assigns those, so the scan has to be nesting-aware.
 *  3. VALUES MAY CONTAIN INLINE MARKUP (`<br/>`), so a value is the span's
 *     TEXT, with any nested sdParams text removed.
 *
 * Pure: no network, no DOM, no dependencies. Node and the test suite both
 * call it directly.
 */

/** One extracted field. */
/**
 * @typedef {object} AipField
 * @property {string} record  e.g. 'TAIRSPACE_VOLUME'
 * @property {string} field   e.g. 'VAL_DIST_VER_UPPER'
 * @property {string} id      the source record id, e.g. '1058'
 * @property {string} value   the published value, trimmed ('' when absent)
 * @property {string} after   plain text following the marker: ENR 2.1 states
 *                            an airspace's TYPE here, untagged
 * @property {number} order   document order, so vertices keep their sequence
 */

/**
 * @typedef {object} SpanNode
 * @property {string|null} cls
 * @property {string} inner
 * @property {number} parent index into the node list, -1 at top level
 * @property {number} start
 * @property {number} end
 */

const SPAN_OPEN = /<span\b([^>]*)>/gi;

/** Strip tags and decode the handful of entities the eAIP actually emits.
 *  @param {string} html @returns {string} */
function plainText(html) {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (/** @type {string} */ _, /** @type {string} */ d) => String.fromCharCode(Number(d)))
    .replace(/\s+/g, ' ')
    .trim();
}

/** @param {string} attrs @returns {string|null} */
function classOf(attrs) {
  const m = attrs.match(/class="([^"]*)"/i);
  return m ? m[1].trim() : null;
}

/**
 * Parse the span tree of one eAIP page.
 *
 * Returns a flat list of nodes in document order, each carrying its own
 * inner HTML and its parent index, which is all the assignment rules below
 * need. Written as an explicit scan rather than a regex because rule 1 and
 * rule 2 above are both nesting facts.
 *
 * @param {string} html
 * @returns {SpanNode[]}
 */
function spanNodes(html) {
  /** @type {SpanNode[]} */
  const nodes = [];
  /** @type {{index: number, contentStart: number}[]} */
  const stack = [];
  let cursor = 0;

  while (cursor < html.length) {
    SPAN_OPEN.lastIndex = cursor;
    const open = SPAN_OPEN.exec(html);
    const close = html.indexOf('</span>', cursor);

    // Whichever comes first decides the next event.
    if (open && (close === -1 || open.index < close)) {
      const attrs = open[1] || '';
      const selfClosing = /\/\s*$/.test(attrs);
      const node = {
        cls: classOf(attrs),
        inner: '',
        parent: stack.length ? stack[stack.length - 1].index : -1,
        start: open.index,
        end: selfClosing ? SPAN_OPEN.lastIndex : -1
      };
      nodes.push(node);
      // A self-closing span has no content and never reaches the stack -
      // this is the empty-value case, and it must still produce a node.
      if (!selfClosing) {
        stack.push({ index: nodes.length - 1, contentStart: SPAN_OPEN.lastIndex });
      }
      cursor = SPAN_OPEN.lastIndex;
      continue;
    }

    if (close === -1) break;
    const top = stack.pop();
    if (top) {
      nodes[top.index].inner = html.slice(top.contentStart, close);
      nodes[top.index].end = close + '</span>'.length;
    }
    cursor = close + '</span>'.length;
  }

  // Anything still open at end of document closes at end of document.
  while (stack.length) {
    const top = stack.pop();
    if (top) { nodes[top.index].inner = html.slice(top.contentStart); nodes[top.index].end = html.length; }
  }
  return nodes;
}

/**
 * The plain text that FOLLOWS a marker span, up to the next span or the end
 * of the enclosing block. ENR 2.1 states an airspace's type this way -
 * untagged - where AD 2 tags it as TXT_LOCAL_TYPE, so reading it is the only
 * way to know an ENR 2.1 entry is a TMA rather than a CTA.
 * @param {string} html @param {number} end @returns {string}
 */
function trailingText(html, end) {
  if (!(end > 0)) return '';
  const rest = html.slice(end, end + 400);
  const stop = rest.search(/<span class="(?:SD|sdParams)"|<\/(?:strong|p|td|tr)>/i);
  return plainText(stop === -1 ? rest : rest.slice(0, stop));
}

/** The value a marker describes, with any nested marker text removed.
 *  @param {SpanNode|undefined} node @returns {string} */
function valueOf(node) {
  if (!node) return '';
  return plainText(node.inner.replace(/<span class="sdParams"[\s\S]*?<\/span>/gi, ' '));
}

/**
 * Extract every tagged field from one eAIP page, in document order.
 *
 * Assignment rules, in this order:
 *   - a `sdParams` NESTED inside a `SD` span describes that enclosing span;
 *   - otherwise it describes the nearest preceding `SD` span.
 *
 * @param {string} html one eAIP page
 * @returns {AipField[]}
 */
export function extractFields(html) {
  const source = String(html || '');
  const nodes = spanNodes(source);
  /** @type {AipField[]} */
  const out = [];
  let lastSd = -1;

  nodes.forEach((node, index) => {
    if (node.cls === 'SD') { lastSd = index; return; }
    if (node.cls !== 'sdParams') return;

    // rule 2: an enclosing SD span wins over the preceding one
    let owner = -1;
    for (let p = node.parent; p !== -1; p = nodes[p].parent) {
      if (nodes[p].cls === 'SD') { owner = p; break; }
    }
    if (owner === -1) owner = lastSd;

    const marker = plainText(node.inner);
    // One marker per span in this edition, but split defensively: a future
    // edition listing two in one span must not silently drop the second.
    for (const part of marker.split(/\s+(?=T[A-Z_0-9]+;)/)) {
      const m = part.match(/^([A-Z_0-9]+);([A-Z_0-9]+);(\S+)/);
      if (!m) continue;
      out.push({
        record: m[1], field: m[2], id: m[3],
        value: valueOf(nodes[owner]),
        after: trailingText(source, node.end),
        order: out.length
      });
    }
  });
  return out;
}

/**
 * Group fields into records: record type -> record id -> field -> value.
 * Vertices need their order, so repeated fields keep a list as well.
 *
 * @param {AipField[]} fields
 * @returns {Map<string, Map<string, {fields: Record<string, string>, order: number}>>}
 */
export function groupRecords(fields) {
  const byType = new Map();
  for (const f of fields) {
    if (!byType.has(f.record)) byType.set(f.record, new Map());
    const byId = byType.get(f.record);
    if (!byId.has(f.id)) byId.set(f.id, { fields: {}, order: f.order });
    const rec = byId.get(f.id);
    // First value wins: a repeated field id is the same record re-stated
    // (the closing vertex of a ring repeats its opening one).
    if (!(f.field in rec.fields)) rec.fields[f.field] = f.value;
  }
  return byType;
}

/**
 * Compact published DMS -> decimal degrees. `691500N` / `0175300E`, with an
 * optional decimal on the seconds.
 *
 * Returns null rather than a number when the text is not a published
 * coordinate: a malformed coordinate must fail its feature, never become a
 * plausible position.
 *
 * @param {string} text
 * @returns {number|null}
 */
export function parseDms(text) {
  const m = String(text || '').trim().match(/^(\d{2,3})(\d{2})(\d{2}(?:\.\d+)?)([NSEW])$/);
  if (!m) return null;
  const deg = Number(m[1]), min = Number(m[2]), sec = Number(m[3]);
  if (min >= 60 || sec >= 60) return null;
  const value = deg + min / 60 + sec / 3600;
  const hemi = m[4];
  if ((hemi === 'N' || hemi === 'S') && value > 90) return null;
  if ((hemi === 'E' || hemi === 'W') && value > 180) return null;
  return (hemi === 'S' || hemi === 'W') ? -value : value;
}

/**
 * A published vertical limit, kept as its three source fields.
 *
 * NEVER collapsed to a single number. GND, UNL and a flight level are not
 * altitudes in feet AMSL, and a planner that pretends otherwise is exactly
 * the plausible wrong answer this project refuses. `text` is what the UI
 * shows; `ft`/`datum` are filled in only when the source really did publish
 * a measured altitude.
 *
 * @param {string} val @param {string} uom @param {string} code
 * @returns {{text: string, ft: number|null, datum: string|null, kind: string}}
 */
export function verticalLimit(val, uom, code) {
  const v = String(val || '').trim();
  const u = String(uom || '').trim();
  const c = String(code || '').trim();
  if (!v) return { text: '', ft: null, datum: null, kind: 'unknown' };

  // No unit and no datum -> the value is itself a code (GND, SFC, UNL) or a
  // flight level written in full.
  if (!u && !c) {
    const fl = v.match(/^FL\s*(\d{2,3})$/i);
    if (fl) return { text: 'FL ' + fl[1], ft: null, datum: null, kind: 'flight-level' };
    return { text: v.toUpperCase(), ft: null, datum: null, kind: 'code' };
  }
  const num = Number(v.replace(/\s/g, ''));
  // A flight level is published as VAL=85, UOM=FL. It is written FL 85, and
  // it is NOT an altitude in feet - the number is not comparable with an
  // AMSL figure without a QNH, so `ft` stays null.
  if (u.toUpperCase() === 'FL') {
    return { text: 'FL ' + v, ft: null, datum: null, kind: 'flight-level' };
  }
  const text = [v, u, c].filter(Boolean).join(' ');
  if (!isFinite(num)) return { text, ft: null, datum: null, kind: 'unresolved' };
  if (u.toUpperCase() !== 'FT') {
    // Metres appear in some sources. Do not convert silently - show the
    // published text and leave the number unresolved.
    return { text, ft: null, datum: c || null, kind: 'unresolved-unit' };
  }
  return { text, ft: num, datum: c || null, kind: 'altitude' };
}
