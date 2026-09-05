/**
 * Keyboard bindings as a pure decision - src/lib/keys.js (v16.49)
 *
 * WHY THIS IS A MODULE AND NOT AN `if` LADDER IN THE PAGE. Every other rule in
 * this project is checked without a browser; the keyboard was the exception,
 * and it is the one surface where a wrong answer is silent - a binding that
 * quietly does nothing, or fires when it should not, looks exactly like a key
 * that was never pressed. `resolveKey` takes a plain description of the
 * keystroke and of what is on screen, and returns WHAT SHOULD HAPPEN. The page
 * does it. So the whole mapping is testable, including the cases that only
 * arise when a dialog is up or the cursor is in a field.
 *
 * TWO RULES CONSTRAIN EVERYTHING HERE, and both were learned the hard way:
 *
 * 1. AN OVERLAY OWNS THE KEYBOARD WHILE IT IS UP (v16.46, the author's rule:
 *    "only escape and relevant key bindings on dialog popups, all other
 *    keybindings disabled during popup"). Ctrl+Z used to fire straight through
 *    a confirm dialog, leaving the handler awaiting it holding a DETACHED
 *    flight. dialog.js also binds 1-9 to pick an option, so any future digit
 *    shortcut needs this same guard.
 *
 * 2. "INERT IN EVERY INPUT" IS TOO BLUNT (v16.11). The app's number, date and
 *    select fields commit on change and KEEP focus afterwards - they are not
 *    rebuilt by the re-render - so exempting all inputs made Ctrl+Z silently
 *    dead right after editing fuel, an ETD or an altitude, which is exactly
 *    when a pilot reaches for undo. Only fields with real free-text editing
 *    keep their native behaviour, and the caller decides that with `textLike`.
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
 * @property {boolean} [viewMode]     the read-only "View Mode" is on
 * @property {boolean} [hasHighlight] a waypoint is selected
 */

/**
 * @typedef {object} KeyAction
 * @property {string} action        what the page should do
 * @property {boolean} preventDefault whether the browser's own handling must be stopped
 * @property {number} [index]        0-based target, for actions that address one thing
 */

/** Every action `resolveKey` can return. The page has a case for each. */
export const KEY_ACTIONS = [
  'cancel-drag',      // Escape during a line drag: put the via back and give the map back
  'close-overlays',   // Escape: close the modals and clear any selection
  'undo', 'redo',
  'save',             // Ctrl/Cmd+S: the save-plan dialog
  'focus-search',     // "/": find a published fix
  'delete-waypoint',  // Delete/Backspace on the selected waypoint
  'activate-flight'   // 1-9: make that flight plan the active one
];

/** A one-line description of each binding, for the guide and the ? overlay.
 *  Kept here so the help text cannot drift from the mapping it describes. */
export const KEY_HELP = [
  { keys: 'Ctrl+Z / Ctrl+Shift+Z', what: 'Undo / redo the last change to the route' },
  { keys: 'Ctrl+S', what: 'Save the plan as a route or mission' },
  { keys: '/', what: 'Find a published aerodrome or reporting point' },
  { keys: 'Delete', what: 'Remove the selected waypoint (click one on the map to select it)' },
  { keys: '1 - 9', what: 'Make that flight plan the active one' },
  { keys: 'Esc', what: 'Close a dialog, abandon a line drag, or clear the selection' }
];

/**
 * @param {KeyStroke} ev
 * @param {KeyContext} [ctx]
 * @returns {KeyAction|null} null when the keystroke is not ours
 */
export function resolveKey(ev, ctx) {
  const c = ctx || {};
  const key = ev && ev.key ? String(ev.key) : '';
  if (!key) return null;
  const mod = !!(ev.ctrlKey || ev.metaKey);

  if (key === 'Escape') {
    // THE DRAG COMES FIRST, and it comes before the dialog check on purpose:
    // it is the state that traps the map (dragging disabled, the via following
    // a button-less cursor), so Escape must reach it even with a modal somehow
    // open on top of it.
    if (c.dragging) return { action: 'cancel-drag', preventDefault: false };
    if (c.dialogOpen) return null;          // dialog.js owns its own Escape
    return { action: 'close-overlays', preventDefault: false };
  }

  // Rule 1: nothing else passes while an overlay is up.
  if (c.overlayOpen) return null;

  // Ctrl+S is claimed even inside a text field: the browser's own Ctrl+S saves
  // the PAGE, which is never what is wanted here, and a pilot naming a route
  // has their cursor in a field at exactly the moment they want to save.
  if (mod && !ev.altKey && key.toLowerCase() === 's') {
    return { action: 'save', preventDefault: true };
  }

  // Rule 2: free-text fields keep their native editing from here down.
  if (c.textLike) return null;

  if (mod && !ev.altKey && key.toLowerCase() === 'z') {
    return { action: ev.shiftKey ? 'redo' : 'undo', preventDefault: true };
  }
  // Ctrl+Y is the other redo half the world uses; Cmd+Y is a Mac browser
  // shortcut for History, so it is deliberately NOT claimed.
  if (ev.ctrlKey && !ev.metaKey && !ev.altKey && key.toLowerCase() === 'y') {
    return { action: 'redo', preventDefault: true };
  }

  if (key === '/' && !mod && !ev.altKey) {
    return { action: 'focus-search', preventDefault: true };
  }

  // DELETING IS OFFERED ONLY WHERE EDITING IS. "View Mode" is locked and
  // read-only by its own definition, so a Delete key there would contradict the
  // mode rather than serve it - the AUDIT.md entry that asked for this binding
  // read `highlightedWaypoint` (which only existed in View Mode) and did not
  // weigh that. v16.49 gives Edit Mode a selection instead, and Delete acts on
  // that; the right-click menu remains the other way to remove a waypoint.
  if ((key === 'Delete' || key === 'Backspace') && !mod && !ev.altKey) {
    if (c.viewMode || !c.hasHighlight) return null;
    return { action: 'delete-waypoint', preventDefault: true };
  }

  // 1-9 ACTIVATE A FLIGHT PLAN (roadmap 9). THE TRAP WAS ALREADY IN THE
  // CODEBASE: dialog.js binds these same digits to pick a dialog option, and
  // `ask()` is used everywhere - so without the overlay guard above, naming a
  // waypoint would have become a game of chance. That guard has existed since
  // v16.46 and this binding sits below it, which is the whole reason this is
  // cheap now. The index is returned rather than acted on, so the page decides
  // what an out-of-range number means.
  if (/^[1-9]$/.test(key) && !mod && !ev.altKey && !ev.shiftKey) {
    return { action: 'activate-flight', index: Number(key) - 1, preventDefault: true };
  }

  return null;
}
