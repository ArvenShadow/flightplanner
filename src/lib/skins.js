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

/**
 * TIER 2 - MOVING A CONTROL BETWEEN PANELS (v16.66).
 *
 * CSS places a box inside its own container and no further, so a skin cannot
 * lift a button out of the sidebar and put it in the header. This was written
 * up as needing roadmap 18 (handlers bound in code); that was WRONG, and the
 * reason is worth keeping: `appendChild` MOVES A LIVE NODE, and the node keeps
 * its id, its inline `on*=` attribute and every listener already attached. So a
 * skin can reparent real controls at runtime without touching the markup, the
 * handlers, or the compiler.
 *
 * WHAT KEEPS IT SAFE:
 *   - only ids on MOVABLE are movable, so a skin cannot relocate a table cell
 *     or something the layout depends on;
 *   - only ids in SLOTS can receive, so nothing lands somewhere unstyled;
 *   - the page remembers each node's original parent AND next sibling, so
 *     leaving a skin puts it back exactly, not merely somewhere in the parent;
 *   - `verify-skins.mjs` already asserts every skin keeps the whole inventory
 *     of controls, and now also that a MOVED control still works.
 */

/** Containers a skin may move a control INTO. Each is an existing part of the
 *  shell that already knows how to lay out controls. */
export const SLOTS = ['map-controls', 'slot-header', 'slot-sidebar-top'];

/** Controls a skin may move. Deliberately a whitelist of top-level actions -
 *  the buttons a pilot presses, not the inputs a calculation reads. */
export const MOVABLE = [
  'undo-btn', 'redo-btn', 'settings-btn', 'guide-btn', 'wind-btn', 'sera-btn',
  'ruler-btn', 'done-mode-btn', 'compact-btn', 'print-btn'
];

/**
 * A skin's placement map, with everything it does not recognise dropped.
 *
 * Re-validated on every read for the same reason every other preference is: a
 * skin can arrive from an exported settings file, and an unknown id would
 * silently do nothing while looking as though it had worked.
 *
 * @param {unknown} raw
 * @returns {Record<string, string>}
 */
export function normalisePlacement(raw) {
  /** @type {Record<string, string>} */
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [control, slot] of Object.entries(/** @type {Record<string, unknown>} */ (raw))) {
    if (MOVABLE.includes(control) && typeof slot === 'string' && SLOTS.includes(slot)) {
      out[control] = slot;
    }
  }
  return out;
}

/** @typedef {{ id: string, label: string, note: string, place?: Record<string, string>,
 *              noSplitterIn?: string[] }} Skin
 *  `noSplitterIn`: the layouts in which this skin has no panel divider, because
 *  its panels are not side by side there (v17.2). */

/**
 * The default is FIRST and has no CSS of its own on purpose: it is the shipped
 * design, and every restyling change has to leave it pixel-identical.
 *
 * @type {Skin[]}
 */
export const SKINS = [
  { id: 'default', label: 'Default',
    note: 'The shipped design - map beside the plan.' },
  { id: 'menu', label: 'Menu',
    note: 'The plan collapses to a narrow rail and opens when you reach for it, so the map has the whole window. Undo, redo and Settings move onto the map, where they are still one click away.',
    // TIER 2 IN ANGER: with the plan collapsed, the three actions a pilot
    // reaches for most would be behind a hover. They are MOVED - the same
    // buttons, the same handlers, a different parent.
    place: { 'undo-btn': 'map-controls', 'redo-btn': 'map-controls', 'settings-btn': 'map-controls' },
    // The plan is a hover rail in every layout, so it is never beside the map.
    noSplitterIn: ['split', 'stacked'] },
  // v17.2: three modern looks, one per question - colour and buttons, a
  // palette borrowed from the chart, and a layout. See skins.css.
  { id: 'slate', label: 'Slate',
    note: 'A neutral, modern look: light surfaces, grey buttons and one indigo accent kept for the main action, so red only ever means delete.' },
  { id: 'chart', label: 'Chart',
    note: 'The ICAO 1:500 000 chart’s own colours: paper, chart blue and aerodrome magenta, squared corners and serif headings. Dark mode is a night-reading chart.' },
  { id: 'float', label: 'Float',
    note: 'The map fills the window and the plan floats over it as a frosted panel (Split view only; Stacked keeps its normal layout). Slate’s colours and buttons.',
    // The panel is not beside the map in Split, so there is nothing to drag.
    noSplitterIn: ['split'] }
];

/** Every class this module can put on <body>, so the page can clear them all
 *  before adding one - the same shape as the layout-* switcher.
 *  @type {string[]} */
export const SKIN_CLASSES = SKINS.map((s) => 'skin-' + s.id);

/**
 * SIZE IS ITS OWN SETTING, NOT A SKIN (v17.3, the author: "I would like the
 * bold option to be available to the different colour styles").
 *
 * Compact and Bold were skins until v17.2, and a body carries ONE skin class -
 * so Bold could not be worn with Slate, Chart or Float. They change how BIG
 * things are, not how they LOOK, so they are a second axis: a `density-<id>`
 * body class beside the `skin-<id>` one, and any size goes with any style.
 *
 * `normal` is the shipped sizing and, like the default skin, has NO CSS.
 *
 * @type {{id: string, label: string, note: string}[]}
 */
export const DENSITIES = [
  { id: 'normal', label: 'Normal', note: 'The shipped sizes.' },
  { id: 'compact', label: 'Compact',
    note: 'Smaller type, tighter padding and shorter rows - for a 13" laptop, where the constraint is vertical space.' },
  { id: 'bold', label: 'Bold',
    note: 'Larger hit targets and bigger type - for a touchscreen, or reading at arm’s length.' }
];

/** @type {string[]} */
export const DENSITY_CLASSES = DENSITIES.map((d) => 'density-' + d.id);

/**
 * The size a profile asks for, re-validated on every read (it travels in an
 * exported settings file, exactly like the skin).
 * @param {unknown} v
 * @returns {string}
 */
export function normaliseDensity(v) {
  return typeof v === 'string' && DENSITIES.some((d) => d.id === v) ? v : 'normal';
}

/**
 * A profile saved before v17.3 may say `skin: 'bold'` or `skin: 'compact'`.
 * Those are sizes now, so they become that size on the default style - the
 * pilot who chose Bold keeps Bold, rather than having it silently fall back to
 * the default because the id stopped being a skin.
 *
 * IT WINS OVER A SIZE ALREADY SET, and that is deliberate: nothing written
 * since v17.3 can say `skin: 'bold'`, so the value is always an OLD statement
 * of intent - most often a settings file exported before the split and
 * imported into a profile that already has `density: 'normal'`. Letting the
 * existing size win there would quietly drop the Bold the file asked for.
 *
 * @param {unknown} skin @param {unknown} density
 * @returns {{skin: string, density: string}}
 */
export function splitLegacyLook(skin, density) {
  if (skin === 'bold' || skin === 'compact') return { skin: 'default', density: skin };
  return { skin: normaliseSkin(skin), density: normaliseDensity(density) };
}

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

/**
 * Does this skin have a panel divider in this layout? (v17.2) One question the
 * page asks, rather than a class name tested per skin in the page script.
 * @param {string} skinId @param {string} layout 'split' | 'stacked' | 'plan' | 'map'
 */
export function skinHasSplitter(skinId, layout) {
  const s = skinById(skinId);
  return !(s.noSplitterIn || []).includes(layout);
}

/** @param {string} id @returns {Skin} */
export function skinById(id) {
  const want = normaliseSkin(id);
  const found = SKINS.find((s) => s.id === want);
  return found || SKINS[0];
}
