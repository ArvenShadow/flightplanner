/**
 * Keyboard bindings as a pure decision - src/lib/keys.js
 *
 * WHY THIS IS A MODULE AND NOT AN `if` LADDER IN THE PAGE (v16.49). Every other
 * rule in this project is checked without a browser; the keyboard was the
 * exception, and it is the one surface where a wrong answer is SILENT - a
 * binding that quietly does nothing, or fires when it should not, looks exactly
 * like a key that was never pressed. `resolveKey` takes a plain description of
 * the keystroke and of what is on screen, and returns WHAT SHOULD HAPPEN. The
 * page does it. So the whole mapping is testable, including the cases that only
 * arise when a dialog is up or the cursor is in a field.
 *
 * v16.52 MADE THE MAPPING THE PILOT'S, NOT MINE (roadmap item 10). It used to
 * be a chain of `if`s; it is now a TABLE - a keymap from chord to action, with
 * each action's conditions declared beside it. That is what makes it settable
 * from a menu, and it also means a new binding cannot be added without saying
 * where it may fire.
 *
 * THREE RULES CONSTRAIN EVERYTHING HERE, and all three were learned the hard way:
 *
 * 1. AN OVERLAY OWNS THE KEYBOARD WHILE IT IS UP (v16.46, the author's rule:
 *    "only escape and relevant key bindings on dialog popups, all other
 *    keybindings disabled during popup"). Ctrl+Z used to fire straight through
 *    a confirm dialog, leaving the handler awaiting it holding a DETACHED
 *    flight. dialog.js also binds 1-9 to pick an option, which is exactly why
 *    the flight-plan digits need this guard.
 *
 * 2. "INERT IN EVERY INPUT" IS TOO BLUNT (v16.11). The app's number, date and
 *    select fields commit on change and KEEP focus afterwards - they are not
 *    rebuilt by the re-render - so exempting all inputs made Ctrl+Z silently
 *    dead right after editing fuel, an ETD or an altitude, which is exactly
 *    when a pilot reaches for undo. Only fields with real free-text editing
 *    keep their native behaviour, and the caller decides that with `textLike`.
 *
 * 2b. BUT AN UNMODIFIED KEY IN AN EDITABLE FIELD IS TYPING, NOT A SHORTCUT
 *    (v16.69, the pilot's report: "the numbers keys change between flightplans
 *    when trying to type a number"). Rule 2 was drawn one notch too wide. A
 *    number field is not free text, so `textLike` is false there - and 1-9 are
 *    bound to the flight plans, so every digit typed into an altitude ALSO
 *    switched plan. It was never only the digits: `.` and `,` are bound to the
 *    next and previous plan, so a decimal point typed into a fuel or a reserve
 *    did it too, and Delete is bound to removing the selected waypoint, so
 *    erasing a digit forward could remove a fix from the route.
 *    THE LINE IS THE MODIFIER, and it keeps everything rule 2 was protecting:
 *    Ctrl+Z carries one, so undo still works with the cursor in an altitude,
 *    which is the whole reason number fields were left out of `textLike`. A
 *    BARE key does not, so it belongs to the field the pilot is typing in.
 *    `editing` is true for every field that takes typed keys; `textLike`
 *    remains the stricter free-text test and still blocks modified chords.
 *
 * 3. A BINDING THE BROWSER OWNS IS A PROMISE THE PLATFORM REVOKES. Ctrl+W,
 *    Ctrl+T, Ctrl+N and friends cannot be stopped with preventDefault in any
 *    mainstream browser - the tab closes anyway. Offering them in the menu
 *    would be the plausible-wrong-answer this project refuses, so they are
 *    refused BY NAME with the reason. See RESERVED_CHORDS.
 *
 * Nothing here reads the DOM or the event object's methods; the page passes a
 * description in and applies the answer.
 */

/**
 * @typedef {object} KeyStroke
 * @property {string} key       the event's `key`
 * @property {boolean} [ctrlKey]
 * @property {boolean} [metaKey]
 * @property {boolean} [shiftKey]
 * @property {boolean} [altKey]
 */

/**
 * @typedef {object} KeyContext
 * @property {boolean} [dragging]     a route-line drag is in progress
 * @property {boolean} [dialogOpen]   dialog.js has something on screen
 * @property {boolean} [overlayOpen]  any overlay at all (includes dialogOpen)
 * @property {boolean} [textLike]     focus is in a free-text field
 * @property {boolean} [editing]      focus is in ANY field that takes typed keys
 * @property {boolean} [viewMode]     the read-only "View Mode" is on
 * @property {boolean} [hasHighlight] a waypoint is selected
 */

/**
 * @typedef {object} KeyAction
 * @property {string} action        what the page should do
 * @property {boolean} preventDefault whether the browser's own handling must be stopped
 * @property {number} [index]        0-based target, for actions that address one thing
 */

/**
 * @typedef {object} ActionSpec
 * @property {string} id
 * @property {string} group      how the settings menu files it
 * @property {string} label      what the pilot sees
 * @property {string} [hint]     one line of explanation where it earns one
 * @property {string|null} dflt  the default chord, or null for "not bound out of the box"
 * @property {boolean} [fixed]   not rebindable, with a stated reason in `hint`
 * @property {boolean} [inText]  fires even with the cursor in a free-text field
 * @property {boolean} [needsEdit]      refused in the read-only View Mode
 * @property {boolean} [needsSelection] refused with no waypoint selected
 * @property {number} [index]    0-based argument handed to the page
 */

/**
 * EVERY ACTION THAT COULD WARRANT A KEY, whether or not one is bound to it -
 * the pilot asked for the whole list in the menu, and a menu that hides half
 * the app's verbs is not a keybind menu.
 *
 * MOST OF THEM SHIP UNBOUND, and that is deliberate. Inventing a dozen
 * shortcuts nobody asked for fills the keyboard with guesses and takes chords
 * away from the pilot. The defaults are exactly the bindings that already
 * existed; everything else is listed, described, and left for them to claim.
 */
export const ACTION_SPECS = /** @type {ActionSpec[]} */ ([
  // --- the plan -----------------------------------------------------------
  { id: 'undo', group: 'Editing', label: 'Undo', dflt: 'Ctrl+Z' },
  { id: 'redo', group: 'Editing', label: 'Redo', dflt: 'Ctrl+Shift+Z' },
  { id: 'delete-waypoint', group: 'Editing', label: 'Delete the selected waypoint',
    hint: 'Click a waypoint on the map to select it. Edit Mode only - View Mode is read-only.',
    dflt: 'Delete', needsEdit: true, needsSelection: true },
  { id: 'new-flight-plan', group: 'Editing', label: 'Start a new flight plan', dflt: null },
  { id: 'toggle-view-mode', group: 'Editing', label: 'Switch between Edit and View Mode', dflt: null },

  // --- finding things -----------------------------------------------------
  { id: 'focus-search', group: 'Finding', label: 'Find a published fix', dflt: '/' },
  { id: 'toggle-ruler', group: 'Finding', label: 'Ruler mode on / off', dflt: null },

  // --- flight plans -------------------------------------------------------
  { id: 'prev-flight', group: 'Flight plans', label: 'Previous flight plan',
    hint: 'Stops at the first plan rather than wrapping.', dflt: ',' },
  { id: 'next-flight', group: 'Flight plans', label: 'Next flight plan',
    hint: 'Stops at the last plan rather than wrapping.', dflt: '.' },
  ...Array.from({ length: 9 }, (_, i) => ({
    id: 'activate-flight-' + (i + 1), group: 'Flight plans',
    label: 'Activate flight plan ' + (i + 1), dflt: String(i + 1), index: i
  })),

  // --- the map ------------------------------------------------------------
  { id: 'toggle-airspace', group: 'Map', label: 'Airspace overlay on / off', dflt: null },
  { id: 'toggle-fixes', group: 'Map', label: 'AIP fixes on / off', dflt: null },
  { id: 'toggle-chart', group: 'Map', label: 'Switch base chart (topo / VFR)', dflt: null },
  { id: 'cycle-chart-detail', group: 'Map', label: 'Cycle chart detail', dflt: null },
  { id: 'cycle-declutter', group: 'Map', label: 'Cycle map label declutter', dflt: null },
  { id: 'cycle-layout', group: 'Map', label: 'Cycle the screen layout', dflt: null },

  // --- windows and output -------------------------------------------------
  { id: 'save', group: 'Plan & output', label: 'Save the plan',
    hint: 'Claimed even inside a text field: the browser’s own Ctrl+S saves the web page, ' +
      'and you are usually naming a route when you want this.',
    dflt: 'Ctrl+S', inText: true },
  { id: 'open-winds', group: 'Plan & output', label: 'Open the wind matrix', dflt: null },
  { id: 'open-settings', group: 'Plan & output', label: 'Open Settings', dflt: null },
  { id: 'open-guide', group: 'Plan & output', label: 'Open the Feature Guide', dflt: null },
  { id: 'print', group: 'Plan & output', label: 'Print / preview the OFP', dflt: null },

  // --- and the one that is not yours to move ------------------------------
  { id: 'close-overlays', group: 'Always', label: 'Close a dialog, abandon a drag, clear the selection',
    hint: 'Escape is fixed. It is the way out of a dialog and out of a stuck line drag, so ' +
      'rebinding it could leave you with no way back.',
    dflt: 'Escape', fixed: true }
]);

/** Actions the page must handle. `cancel-drag` is not in the table above
 *  because it is not a binding: it is what Escape means while dragging. */
export const KEY_ACTIONS = ACTION_SPECS.map((a) => a.id).concat(['cancel-drag']);

/** @param {string} id @returns {ActionSpec|undefined} */
export function actionSpec(id) { return ACTION_SPECS.find((a) => a.id === id); }

// ---- chords ------------------------------------------------------------
//
// A chord is a canonical string: "Ctrl+Shift+Z", "Alt+K", "/", "Delete", ".".
// Modifier order is fixed (Ctrl, Alt, Shift) so two spellings of the same
// keystroke cannot both sit in the map and shadow each other.
//
// "Ctrl" MEANS CTRL OR COMMAND. The planner has always treated them alike, a
// Mac keyboard has no Ctrl in the place a PC does, and one binding that works
// on both beats two rows that differ by platform. The menu says so.

/** Chords the browser keeps for itself. preventDefault does NOT stop these, so
 *  binding one would be a promise the platform revokes at the moment it
 *  matters - the exact failure this project refuses to ship. */
export const RESERVED_CHORDS = [
  'Ctrl+W', 'Ctrl+Shift+W', 'Ctrl+T', 'Ctrl+Shift+T', 'Ctrl+N', 'Ctrl+Shift+N',
  'Ctrl+Q', 'Ctrl+Tab', 'Ctrl+Shift+Tab', 'F5', 'Ctrl+F5', 'F11', 'F12',
  'Alt+F4', 'Ctrl+Shift+I', 'Ctrl+Shift+J'
];

/** @param {KeyStroke} ev @returns {string} the canonical chord for a keystroke */
export function chordOf(ev) {
  if (!ev || !ev.key) return '';
  let key = String(ev.key);
  if (key === ' ') key = 'Space';
  // A bare modifier is not a chord - it is half of one being typed.
  if (['Control', 'Meta', 'Shift', 'Alt'].includes(key)) return '';
  // Single letters are upper-cased so "z" and "Z" are one binding; Shift is
  // carried in the modifier list instead of in the key name.
  if (key.length === 1) key = key.toUpperCase();
  const parts = [];
  if (ev.ctrlKey || ev.metaKey) parts.push('Ctrl');
  if (ev.altKey) parts.push('Alt');
  if (ev.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

/** Is this a chord we are willing to store? @param {any} c @returns {boolean} */
export function isValidChord(c) {
  if (typeof c !== 'string' || !c) return false;
  if (c.length > 40) return false;
  const parts = c.split('+');
  const key = parts.pop();
  if (!key) return false;
  const mods = new Set(parts);
  if (mods.size !== parts.length) return false;                 // "Ctrl+Ctrl+K"
  for (const m of parts) if (!['Ctrl', 'Alt', 'Shift'].includes(m)) return false;
  // Canonical order, so the same keystroke has exactly one spelling.
  const ordered = ['Ctrl', 'Alt', 'Shift'].filter((m) => mods.has(m)).join('+');
  if (ordered !== parts.join('+')) return false;
  if (key.length === 1) return key === key.toUpperCase();
  return /^[A-Za-z0-9]+$/.test(key);                            // Delete, Space, F2, Home...
}

/** Human-readable form for the menu. `mac` swaps Ctrl for the command key.
 *  @param {string|null} c @param {boolean} [mac] @returns {string} */
export function chordLabel(c, mac) {
  if (!c) return 'Not bound';
  return mac ? c.replace(/^Ctrl\+/, '⌘') : c;
}

// ---- the keymap --------------------------------------------------------

/** The bindings the app ships with. @returns {Record<string, string|null>} */
export function defaultKeymap() {
  /** @type {Record<string, string|null>} */
  const out = {};
  for (const a of ACTION_SPECS) out[a.id] = a.dflt;
  return out;
}

/**
 * Make an untrusted keymap safe: drop unknown actions, drop invalid or
 * reserved chords, force the fixed ones back, and drop a chord that is already
 * claimed EARLIER in the table.
 *
 * A DUPLICATE IS DROPPED RATHER THAN HONOURED, and that matters: two actions on
 * one chord means the second silently never fires, which is the exact
 * looks-like-a-dead-key failure this module exists to prevent. The menu refuses
 * a duplicate up front; this is the second line, for a hand-edited file.
 *
 * @param {any} raw @returns {Record<string, string|null>}
 */
export function normaliseKeymap(raw) {
  const out = defaultKeymap();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const taken = new Map();
  for (const a of ACTION_SPECS) {
    if (a.fixed) { if (a.dflt) taken.set(a.dflt, a.id); continue; }
    let c = Object.prototype.hasOwnProperty.call(raw, a.id) ? raw[a.id] : a.dflt;
    // An explicit null means "the pilot cleared this one", and is kept.
    if (c === null || c === undefined || c === '') { out[a.id] = null; continue; }
    if (!isValidChord(c) || RESERVED_CHORDS.includes(c) || taken.has(c)) c = null;
    out[a.id] = c;
    if (c) taken.set(c, a.id);
  }
  return out;
}

/** Which action owns a chord, or null. @param {Record<string, string|null>} km
 *  @param {string} chord @param {string} [ignoreId] @returns {string|null} */
export function chordOwner(km, chord, ignoreId) {
  for (const a of ACTION_SPECS) {
    if (a.id === ignoreId) continue;
    if (km[a.id] && km[a.id] === chord) return a.id;
  }
  return null;
}

/**
 * Why a chord cannot be assigned, or null when it can.
 * @param {Record<string, string|null>} km @param {string} chord @param {string} actionId
 * @returns {string|null}
 */
export function chordProblem(km, chord, actionId) {
  const spec = actionSpec(actionId);
  if (!spec) return 'That is not an action this app has.';
  if (spec.fixed) return spec.hint || 'This binding is fixed.';
  if (!isValidChord(chord)) return 'That keystroke cannot be stored as a shortcut.';
  if (RESERVED_CHORDS.includes(chord)) {
    return chord + ' belongs to the browser - it cannot be intercepted, so binding it ' +
      'would look like it worked and then not.';
  }
  const owner = chordOwner(km, chord, actionId);
  if (owner) {
    const o = actionSpec(owner);
    return chord + ' is already ' + ((o && o.label) || owner) +
      '. One chord, one action - otherwise whichever comes second never fires.';
  }
  return null;
}

/** Keys a focused field consumes itself when nothing is held down: a printable
 *  character, and the editing keys that move or erase around it. Escape is not
 *  here on purpose - it is answered before any of this, because it is the way
 *  out of a dialog and out of a stuck drag.
 *  @param {KeyStroke} ev */
export function isBareKey(ev) {
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return false;
  const k = ev.key;
  if (!k) return false;
  // A single character is a character the field will insert - digits, a decimal
  // point, a minus sign, a comma in a locale that uses one.
  if (k.length === 1) return true;
  return EDIT_KEYS.has(k);
}

/** @type {Set<string>} */
const EDIT_KEYS = new Set([
  'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  'Home', 'End', 'Tab', 'Enter'
]);

/**
 * @param {KeyStroke} ev
 * @param {KeyContext} [ctx]
 * @param {Record<string, string|null>} [keymap] defaults when absent
 * @returns {KeyAction|null} null when the keystroke is not ours
 */
export function resolveKey(ev, ctx, keymap) {
  const c = ctx || {};
  const km = keymap || defaultKeymap();
  const chord = chordOf(ev);
  if (!chord) return null;

  // ESCAPE IS ANSWERED BEFORE ANYTHING ELSE, and the drag comes before the
  // dialog check on purpose: a drag is the state that traps the map (dragging
  // disabled, the via following a button-less cursor), so Escape must reach it
  // even with a modal somehow open on top.
  if (chord === 'Escape') {
    if (c.dragging) return { action: 'cancel-drag', preventDefault: false };
    if (c.dialogOpen) return null;          // dialog.js owns its own Escape
    return { action: 'close-overlays', preventDefault: false };
  }

  // Rule 1: nothing else passes while an overlay is up.
  if (c.overlayOpen) return null;

  for (const spec of ACTION_SPECS) {
    if (spec.fixed || km[spec.id] !== chord) continue;
    // Rule 2: free-text fields keep their native editing, unless the action
    // says otherwise (only Ctrl+S does, and it says why).
    if (c.textLike && !spec.inText) return null;
    // Rule 2b: in ANY editable field, only a modified chord is a shortcut.
    if (c.editing && !spec.inText && isBareKey(ev)) return null;
    if (spec.needsEdit && c.viewMode) return null;
    if (spec.needsSelection && !c.hasHighlight) return null;
    /** @type {KeyAction} */
    const act = { action: spec.id, preventDefault: true };
    if (spec.index !== undefined) act.index = spec.index;
    return act;
  }
  return null;
}

/** One line per bound action, for the guide and the settings menu. Built from
 *  the live keymap so the help can never describe a mapping that is not in
 *  force. @param {Record<string, string|null>} [keymap] */
export function keyHelp(keymap) {
  const km = keymap || defaultKeymap();
  return ACTION_SPECS
    .filter((a) => km[a.id] || a.fixed)
    .map((a) => ({ keys: chordLabel(a.fixed ? a.dflt : km[a.id]), what: a.label, group: a.group }));
}
