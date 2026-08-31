/**
 * In-app dialogs, replacing window.alert / confirm / prompt.
 *
 * The native dialogs were limited to OK/Cancel, could not be styled, and
 * blocked the whole browser - so a genuine three-way choice ("update the
 * saved route / save as new route / save as new mission") had to be asked
 * as two chained yes-no questions. These are promise-based, take any
 * number of options, and are keyboard-driven:
 *
 *   Enter    the default option        Esc      cancel
 *   1..9     pick that option directly Tab      move between options
 *
 * Notifications do not steal a click at all: say() shows a toast that
 * fades by itself.
 *
 * Everything is plain DOM (no <dialog>) so it behaves identically in
 * Chromium and in the jsdom test harness.
 */

let openDialog = null;

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  if (props.style) node.style.cssText = props.style;
  for (const c of children) node.appendChild(c);
  return node;
}

/** Is a dialog currently on screen? (the Escape handler defers to it) */
export function dialogIsOpen() {
  return openDialog !== null;
}

/** Programmatically resolve the open dialog - used by tests and Escape. */
export function closeDialog(result) {
  if (openDialog) openDialog(result);
}

/**
 * Ask a question with any number of options.
 *
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} [opts.message]      plain text; newlines become breaks
 * @param {Array}  opts.buttons        [{ id, label, variant?, hint? }]
 *                                     variant: primary | danger | ghost
 * @param {object} [opts.input]        { label, value, placeholder } -> adds a text field
 * @param {string} [opts.cancelId]     id returned on Esc / backdrop (default 'cancel')
 * @returns {Promise<{id: string, value: string|null}>}
 */
export function ask(opts) {
  const { title, message, buttons = [], input = null, cancelId = 'cancel' } = opts;
  if (openDialog) closeDialog({ id: cancelId, value: null });

  const backdrop = el('div', { className: 'dlg-backdrop', id: 'app-dialog' });
  const box = el('div', { className: 'dlg' });
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.appendChild(el('div', { className: 'dlg-title', textContent: title }));

  if (message) {
    const body = el('div', { className: 'dlg-msg' });
    String(message).split('\n').forEach((line, i) => {
      if (i) body.appendChild(el('br'));
      body.appendChild(document.createTextNode(line));
    });
    box.appendChild(body);
  }

  let field = null;
  if (input) {
    const wrap = el('div', { className: 'dlg-field' });
    if (input.label) wrap.appendChild(el('label', { textContent: input.label }));
    field = el('input', { type: 'text', value: input.value || '', placeholder: input.placeholder || '' });
    field.className = 'dlg-input';
    wrap.appendChild(field);
    box.appendChild(wrap);
  }

  const row = el('div', { className: 'dlg-buttons' });
  const nodes = buttons.map((b, i) => {
    const btn = el('button', {
      className: 'dlg-btn dlg-' + (b.variant || 'ghost'),
      type: 'button'
    });
    btn.appendChild(el('span', { className: 'dlg-key', textContent: String(i + 1) }));
    btn.appendChild(document.createTextNode(' ' + b.label));
    if (b.hint) btn.appendChild(el('small', { className: 'dlg-hint', textContent: b.hint }));
    btn.addEventListener('click', () => finish(b.id));
    row.appendChild(btn);
    return btn;
  });
  box.appendChild(row);
  backdrop.appendChild(box);

  let settle;
  const promise = new Promise(resolve => { settle = resolve; });

  function finish(id) {
    if (!openDialog) return;
    const value = field ? field.value : null;
    document.removeEventListener('keydown', onKey, true);
    if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    openDialog = null;
    settle({ id, value });
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(cancelId); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const def = buttons.findIndex(b => b.variant === 'primary' || b.variant === 'danger');
      finish(buttons[def >= 0 ? def : 0] ? buttons[def >= 0 ? def : 0].id : cancelId);
      return;
    }
    // number keys pick an option, but not while typing in the text field
    if (/^[1-9]$/.test(e.key) && (!field || document.activeElement !== field)) {
      const idx = Number(e.key) - 1;
      if (buttons[idx]) { e.preventDefault(); finish(buttons[idx].id); }
    }
  }

  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) finish(cancelId); });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(backdrop);
  openDialog = finish;

  // focus the text field if there is one, else the default button
  const focusTarget = field || nodes.find((_, i) => buttons[i].variant === 'primary' || buttons[i].variant === 'danger') || nodes[0];
  if (focusTarget && focusTarget.focus) {
    try { focusTarget.focus(); if (field && field.select) field.select(); } catch (e) {}
  }
  return promise;
}

/** Yes/no question. Resolves true only for the confirming option. */
export async function confirmDialog(title, message, opts = {}) {
  const r = await ask({
    title,
    message,
    buttons: [
      { id: 'ok', label: opts.okLabel || 'OK', variant: opts.danger ? 'danger' : 'primary' },
      { id: 'cancel', label: opts.cancelLabel || 'Cancel', variant: 'ghost' }
    ]
  });
  return r.id === 'ok';
}

/** Text entry. Resolves the string, or null if cancelled. */
export async function promptDialog(title, label, value = '', opts = {}) {
  const r = await ask({
    title,
    message: opts.message,
    input: { label, value, placeholder: opts.placeholder },
    buttons: [
      { id: 'ok', label: opts.okLabel || 'Save', variant: 'primary' },
      { id: 'cancel', label: 'Cancel', variant: 'ghost' }
    ]
  });
  return r.id === 'ok' ? (r.value === null ? '' : r.value) : null;
}

/**
 * Non-blocking notification. Replaces alert(): it costs no click, which
 * matters for the messages the app shows after every save or import.
 * tone: info | good | warn | bad
 */
export function say(message, tone = 'info', ms = 5000) {
  let host = document.getElementById('app-toasts');
  if (!host) {
    host = el('div', { id: 'app-toasts', className: 'no-print' });
    document.body.appendChild(host);
  }
  const toast = el('div', { className: 'toast toast-' + tone });
  String(message).split('\n').forEach((line, i) => {
    if (i) toast.appendChild(el('br'));
    toast.appendChild(document.createTextNode(line));
  });
  toast.addEventListener('click', () => { if (toast.parentNode) toast.parentNode.removeChild(toast); });
  host.appendChild(toast);
  const timer = setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, ms);
  toast.__timer = timer;
  return toast;
}
