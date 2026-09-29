/**
 * The little runway on the take-off and landing card (v17.6, the author:
 * "draw a little runway with the correct markers and draw the distances over
 * the runway").
 *
 * WHAT IS TO SCALE AND WHAT IS NOT. The strip is the DECLARED distance the
 * check is made against - TODA for a take-off, LDA for a landing - and every
 * distance drawn over it (the POH figure and the factored requirement) is to
 * that one scale along its length. The runway's WIDTH, and the markings, are
 * enlarged so they can be seen at all: at card size a 30 m threshold stripe
 * on a 2 400 m runway is three pixels long. The picture never carries a
 * number the text beside it does not - the figures are the authority.
 *
 * WHY THE STRIP IS THE DECLARED DISTANCE AND NOT THE PHYSICAL RUNWAY. The AIP
 * gives the runway length and TORA / TODA / LDA per end, but not WHERE on the
 * surface each declared distance begins (ENDU 10: 2 995 m of surface, TORA
 * 2 443, LDA 2 001). Placing them would be a guess, so the strip IS the
 * distance available, starting where the run starts.
 *
 * THE MARKINGS ARE EASA's, verified against CS ADR-DSN (the aerodrome design
 * certification specification Norway applies), not drawn from memory:
 *  - L.535 threshold marking: longitudinal stripes starting 6 m from the
 *    threshold, the number set by the runway WIDTH - 18 m: 4, 23 m: 6,
 *    30 m: 8, 45 m: 12, 60 m: 16. A width not in that table (ENRO 13/31 is
 *    40 m) gets NO stripes rather than an invented count.
 *  - L.525 designation marking at every threshold, the two-digit number read
 *    from the direction of approach; drawn beyond the threshold stripes.
 *  - L.530 centre line: stripe at least 30 m and at least the gap, stripe
 *    plus gap 50 to 75 m. Drawn 30 + 20, enlarged in the same 3 : 2 ratio.
 *  - All of these are for a PAVED runway (L.530 (a)); an unpaved strip is
 *    drawn plain, with no paint (ENAS 12/30 is gravel).
 */
import { escapeText } from './format.js';
import { PAVED } from './rwyperf.js';

/** CS ADR-DSN.L.535 (b)(2): runway width (m) -> number of threshold stripes. */
export const THRESHOLD_STRIPES = Object.freeze({ 18: 4, 23: 6, 30: 8, 45: 12, 60: 16 });

/**
 * The number of threshold stripes for a runway width, or null where the table
 * does not give one. Never interpolated: a 40 m runway is not "about 10".
 * @param {number|null|undefined} widthM
 * @returns {number|null}
 */
export function thresholdStripeCount(widthM) {
  const w = Number(widthM);
  if (!Number.isFinite(w)) return null;
  const n = /** @type {Record<string, number>} */ (THRESHOLD_STRIPES)[String(w)];
  return n === undefined ? null : n;
}

/** Is this surface painted the way the diagram paints it?
 *  @param {string|null|undefined} surface AD 2.12 CODE_COMPOSITION */
export function isPavedSurface(surface) {
  return PAVED.test(String(surface || '').trim().toUpperCase());
}

/**
 * @typedef {object} RunwayDiagramInput
 * @property {'takeoff'|'landing'} kind
 * @property {string} desig            the runway end, e.g. "10" or "25L"
 * @property {number|null} widthM      AD 2.12
 * @property {string} surface          AD 2.12 CODE_COMPOSITION
 * @property {number|null} availableM  TODA (take-off) or LDA (landing)
 * @property {number} [correctedM]     the POH figure with every correction, before the factor
 * @property {number} [requiredM]      correctedM x factor, rounded up
 * @property {number} [factor]         1.25 / 1.43
 * @property {number|'VRB'|null} [windDir]  TRUE, as the check used it
 * @property {number|null} [windKt]
 * @property {{headKt:number, crossKt:number, crossFrom:'L'|'R'|null, variable:boolean}|null} [wind]
 */

const fmtM = (/** @type {number} */ n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const fin = (/** @type {any} */ n) => typeof n === 'number' && Number.isFinite(n);

/**
 * The runway, its markings, the wind box and the distances, as one SVG string
 * for the card. Every piece of text in it goes through the one escaper.
 * @param {RunwayDiagramInput} d
 * @returns {string}
 */
export function runwayDiagramSvg(d) {
  const W = 360;
  const X0 = 78;              // where the run starts
  const LEN = 266;            // pixels for the longest distance drawn
  const avail = fin(d.availableM) ? Number(d.availableM) : null;
  const req = fin(d.requiredM) ? Number(d.requiredM) : null;
  const poh = fin(d.correctedM) ? Number(d.correctedM) : null;
  const span = Math.max(avail || 0, req || 0, poh || 0, 1);
  const k = LEN / span;
  const width = fin(d.widthM) ? Number(d.widthM) : null;
  // Across the runway: 0.8 px per metre, so the widths keep their proportions
  // (a 30 m runway is two thirds of a 45 m one) but stay legible.
  const hPx = width ? Math.max(20, Math.min(52, width * 0.8)) : 32;
  const top = 20;
  const bot = top + hPx;
  const midY = top + hPx / 2;
  const paved = isPavedSurface(d.surface);
  const out = [];
  const t = (/** @type {number} */ x, /** @type {number} */ y, /** @type {string} */ s,
    /** @type {string} */ cls, /** @type {string} */ anchor = 'start') =>
    `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" class="${cls}" text-anchor="${anchor}">${escapeText(s)}</text>`;

  // --- the strip: the declared distance ------------------------------------
  const runPx = avail ? avail * k : LEN;
  out.push(`<rect x="${X0}" y="${top}" width="${runPx.toFixed(1)}" height="${hPx.toFixed(1)}" rx="1.5" ` +
    `class="${paved ? 'rwyd-paved' : 'rwyd-unpaved'}"/>`);

  let xAfterMarks = X0 + 4;
  /** Said under the drawing when a marking is left out ON PURPOSE, so a
   *  missing one never reads as forgotten. */
  let note = '';
  if (paved) {
    // THRESHOLD STRIPES (L.535): start 6 m in, reach to within 3 m of each
    // edge, a double gap on the centre line. Enlarged along the runway.
    const n = thresholdStripeCount(width);
    const start = X0 + Math.max(6 * k, 3);
    const len = Math.max(30 * k, 16);
    if (n) {
      const inner = hPx - 2 * Math.max(3 * 0.8, 2);   // within 3 m of each edge
      const slots = 2 * n;                              // n stripes, n-1 gaps, and one more unit for the double centre gap
      const unit = inner / slots;
      let y = top + (hPx - inner) / 2;
      for (let i = 0; i < n; i++) {
        out.push(`<rect x="${start.toFixed(1)}" y="${y.toFixed(2)}" width="${len.toFixed(1)}" ` +
          `height="${Math.max(unit, 0.8).toFixed(2)}" class="rwyd-paint rwyd-thr"/>`);
        y += 2 * unit;
        if (i === n / 2 - 1) y += unit;                 // the double spacing either side of the centre line
      }
      xAfterMarks = start + len;
    } else {
      note = width
        ? 'No threshold stripes: L.535 gives no count for ' + width + ' m width.'
        : 'No threshold stripes: the AIP gives no runway width.';
    }
    // DESIGNATION (L.525), read from the approach: the base of the figures
    // faces the threshold, so on a strip flown left to right they are turned
    // a quarter turn clockwise.
    const fs = Math.max(9, Math.min(15, hPx * 0.5));
    const dx = xAfterMarks + 4 + fs * 0.6;
    out.push(`<text x="0" y="0" class="rwyd-desig" text-anchor="middle" dominant-baseline="central" ` +
      `font-size="${fs.toFixed(1)}" transform="translate(${dx.toFixed(1)} ${midY.toFixed(1)}) rotate(90)">` +
      `${escapeText(d.desig)}</text>`);
    xAfterMarks = dx + fs * 0.7;
    // CENTRE LINE (L.530): 30 m stripe, 20 m gap, enlarged in that ratio, up to
    // a strip's length short of the far end.
    const dash = 9, gap = 6;
    const xEnd = X0 + runPx - 6;
    for (let x = xAfterMarks + 3; x + dash <= xEnd; x += dash + gap) {
      out.push(`<rect x="${x.toFixed(1)}" y="${(midY - 0.6).toFixed(1)}" width="${dash}" height="1.2" class="rwyd-paint rwyd-cl"/>`);
    }
  } else {
    // Unpaved: no paint to draw. The designation is still said, beside it.
    out.push(t(X0 + 6, midY + 4, d.desig, 'rwyd-desig-plain'));
    note = 'Unpaved (' + (String(d.surface || '').trim() || 'surface not published') + '): no painted markings.';
  }

  // --- what the strip is ----------------------------------------------------
  const availLbl = d.kind === 'takeoff' ? 'TODA' : 'LDA';
  out.push(t(X0 + runPx, top - 5, avail ? availLbl + ' ' + fmtM(avail) + ' m' : availLbl + ' not published',
    'rwyd-lbl', 'end'));
  out.push(`<line x1="${(X0 + runPx).toFixed(1)}" y1="${top - 2}" x2="${(X0 + runPx).toFixed(1)}" ` +
    `y2="${bot + 34}" class="rwyd-endline"/>`);

  // --- the distances, measured from the start of the run --------------------
  const bar = (/** @type {number} */ v, /** @type {number} */ y, /** @type {string} */ label, /** @type {string} */ cls) => {
    const x2 = X0 + v * k;
    out.push(`<line x1="${X0}" y1="${y}" x2="${x2.toFixed(1)}" y2="${y}" class="${cls}"/>`);
    out.push(`<line x1="${X0}" y1="${y - 3}" x2="${X0}" y2="${y + 3}" class="${cls}"/>`);
    out.push(`<line x1="${x2.toFixed(1)}" y1="${y - 3}" x2="${x2.toFixed(1)}" y2="${y + 3}" class="${cls}"/>`);
    const inside = x2 - X0 > 92;
    out.push(t(inside ? x2 - 3 : x2 + 4, y - 3.5, label, cls + '-txt', inside ? 'end' : 'start'));
  };
  const what = d.kind === 'takeoff' ? 'take-off' : 'landing';
  if (poh !== null && req !== null) {
    bar(poh, bot + 12, 'POH ' + what + ' ' + fmtM(poh) + ' m', 'rwyd-bar-poh');
    const over = avail !== null && req > avail;
    bar(req, bot + 30, '×' + (d.factor || '') + ' required ' + fmtM(req) + ' m' +
      (over ? ' — ' + fmtM(req - avail) + ' m short' : ''), over ? 'rwyd-bar-bad' : 'rwyd-bar-req');
  } else {
    out.push(t(X0, bot + 18, 'No distance worked out yet - see below.', 'rwyd-muted'));
  }

  // --- the wind, as the check used it --------------------------------------
  // THE BOX IS SIZED FROM ITS LAST LINE, with the same padding below it as
  // above the first (v17.6, the author: the bottom text sat "just a bit too
  // close to the edge"). It was a fixed 84 that ended one unit under the last
  // baseline.
  const BOX_TOP = 6, BOX_PAD = 9, LAST_BASELINE = 89;
  const boxBottom = Math.max(LAST_BASELINE + BOX_PAD, bot + 24);
  out.push(`<rect x="1" y="${BOX_TOP}" width="64" height="${boxBottom - BOX_TOP}" rx="4" class="rwyd-box"/>`);
  out.push(t(33, 20, 'WIND °T', 'rwyd-muted', 'middle'));
  const w = d.wind;
  const dirTxt = d.windDir === 'VRB' ? 'VRB'
    : (fin(d.windDir) ? String(Math.round(Number(d.windDir)) % 360 || 360).padStart(3, '0') : '---');
  const spdTxt = fin(d.windKt) ? String(Math.round(Number(d.windKt))).padStart(2, '0') : '--';
  out.push(t(33, 35, dirTxt + '/' + spdTxt, 'rwyd-strong', 'middle'));
  out.push(`<line x1="8" y1="42" x2="58" y2="42" class="rwyd-rule"/>`);
  if (w) {
    // The aircraft runs left to right, so a headwind blows from the right and
    // a crosswind "from the left" (looking along the runway) blows downward.
    const cross = w.crossKt ? (w.crossFrom === 'L' ? '↓ ' : (w.crossFrom === 'R' ? '↑ ' : '')) + w.crossKt + ' kt' : '0 kt';
    out.push(t(33, 56, cross, 'rwyd-txt', 'middle'));
    out.push(t(33, 65, w.crossKt && w.crossFrom ? 'cross, from ' + (w.crossFrom === 'L' ? 'L' : 'R') : 'cross', 'rwyd-muted', 'middle'));
    const tail = w.headKt < 0;
    out.push(t(33, 80, (tail ? '→ ' : '← ') + Math.abs(w.headKt) + ' kt', tail ? 'rwyd-bad' : 'rwyd-txt', 'middle'));
    out.push(t(33, LAST_BASELINE, w.variable ? 'VRB = tail' : (tail ? 'TAILWIND' : 'head'), tail ? 'rwyd-bad' : 'rwyd-muted', 'middle'));
  } else {
    out.push(t(33, 62, 'not known', 'rwyd-muted', 'middle'));
  }

  if (note) out.push(t(X0, bot + 46, note, 'rwyd-muted'));
  const H = Math.max(boxBottom + 2, bot + (note ? 50 : 40));
  const title = (d.kind === 'takeoff' ? 'Take-off' : 'Landing') + ' on runway ' + d.desig +
    (avail ? ', ' + availLbl + ' ' + Math.round(avail) + ' m' : '') +
    (req !== null ? ', required ' + Math.round(req) + ' m' : '');
  return `<svg class="rwyd" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeText(title)}" ` +
    `preserveAspectRatio="xMinYMin meet">${out.join('')}</svg>`;
}

/**
 * The three figures under the drawing, the way the school's sheet lists them.
 * @param {RunwayDiagramInput} d
 * @returns {string}
 */
export function runwayFiguresHtml(d) {
  const to = d.kind === 'takeoff';
  const cell = (/** @type {string} */ h, /** @type {any} */ v, /** @type {string} */ cls = '') =>
    `<div class="rwyd-fig ${cls}"><div class="rwyd-fig-h">${escapeText(h)}</div>` +
    `<div class="rwyd-fig-v">${fin(v) ? escapeText(String(Math.round(v))) : '---'}</div></div>`;
  const over = fin(d.requiredM) && fin(d.availableM) && Number(d.requiredM) > Number(d.availableM);
  return '<div class="rwyd-figs">' +
    cell((to ? 'TODA' : 'LDA') + ' (m)', d.availableM) +
    cell((to ? 'TO dist POH' : 'LDG dist POH') + ' (m)', d.correctedM) +
    cell('×' + (d.factor || '') + ' required (m)', d.requiredM, over ? 'rwyd-fig-bad' : 'rwyd-fig-req') +
    '</div>';
}
