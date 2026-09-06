/**
 * SKINS - the whole-shell looks the planner can wear (v16.65).
 *
 * A skin is a `body.skin-<id>` class and nothing else: the rules live in
 * src/skins.css, no markup moves, no handler is rewritten. That is what makes
 * trying a look cheap AND safe - see the header of that file for the line
 * between what a skin may and may not do.
 *
 * This module is the LIST, kept pure so the page, the tests and the browser
 * verifier all read the same one. A skin that is in the CSS but not here is
 * unreachable; one that is here but not in the CSS renders as the default,
 * which is why `verify-skins.mjs` checks the two agree.
 */

/** @typedef {{ id: string, label: string, note: string }} Skin */

/**
 * The default is FIRST and has no CSS of its own on purpose: it is the shipped
 * design, and every restyling change has to leave it pixel-identical.
 *
 * @type {Skin[]}
 */
export const SKINS = [
  { id: 'default', label: 'Default',
    note: 'The shipped design - map beside the plan.' },
  { id: 'topbar', label: 'Top bar',
    note: 'The plan becomes a band across the top, with the map filling the space below.' },
  { id: 'compact', label: 'Compact',
    note: 'The same arrangement with smaller type, tighter padding and shorter rows - for a 13" laptop, where the constraint is vertical space.' },
  { id: 'menu', label: 'Menu',
    note: 'The plan collapses to a narrow rail and opens when you reach for it, so the map has the whole window. Hover or tab into it.' },
  { id: 'bold', label: 'Bold',
    note: 'Larger hit targets, heavier borders and bigger type - for a touchscreen, or reading at arm’s length.' }
];

/** Every class this module can put on <body>, so the page can clear them all
 *  before adding one - the same shape as the layout-* switcher.
 *  @type {string[]} */
export const SKIN_CLASSES = SKINS.map((s) => 'skin-' + s.id);

/**
 * The skin a profile asks for, re-validated on every read.
 *
 * It is in PROFILE_KEYS, so it travels in an exported settings file and can
 * arrive from one somebody else wrote, or from a hand-edited localStorage. An
 * unknown id falls back to the shipped design rather than leaving the app with
 * a body class nothing styles.
 *
 * @param {unknown} v
 * @returns {string}
 */
export function normaliseSkin(v) {
  return typeof v === 'string' && SKINS.some((s) => s.id === v) ? v : 'default';
}

/** @param {string} id @returns {Skin} */
export function skinById(id) {
  const want = normaliseSkin(id);
  const found = SKINS.find((s) => s.id === want);
  return found || SKINS[0];
}
