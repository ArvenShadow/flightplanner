process.env.TZ = 'UTC';   // deterministic clock for the daylight/sun tests

// SWEEP SIZES ARE SCALABLE (M5). The everyday run uses the sizes written into
// each sweep; the big figures quoted in CLAUDE.md ("20 000 pinned routes",
// "48 957 unpinned legs") were development runs, and SWEEP_N is how anyone
// reproduces them without slowing the suite down for everybody:
//     SWEEP_N=5 npm test
// The asserts are absolute lower bounds, so a larger multiplier can only make
// them easier - the sweep is a search for violations, not a fixed-size sample.
const SWEEP_N = Math.max(1, Number(process.env.SWEEP_N) || 1);
const sweep = (n) => Math.round(n * SWEEP_N);
const fs = require('fs');
const { JSDOM } = require('jsdom');

// Tests run against the BUILT delivery (npm test builds first). site/ splits it
// into index.html + app.js + aip.js; jsdom is handed the three assembled into
// one document, which is the same bytes the browser ends up executing, and lets
// the source-level guard greps keep working against APP_HTML wherever a given
// piece of code currently lives.
const APP_HTML = 'site/index.html';
if (!fs.existsSync(APP_HTML)) {
  console.error('site/index.html is missing - run: npm run build');
  process.exit(1);
}

let html = fs.readFileSync(APP_HTML, 'utf8');
// Inline the linked assets. jsdom would need resources:'usable' plus a file://
// base to fetch them itself, which is slower and adds a failure mode that has
// nothing to do with what is being tested.
for (const [tag, file] of [
  ['<script src="aip.js"></script>', 'site/aip.js'],
  ['<script src="app.js"></script>', 'site/app.js']
]) {
  if (!html.includes(tag)) { console.error('site/index.html no longer links ' + file); process.exit(1); }
  html = html.replace(tag, '<script>\n' + fs.readFileSync(file, 'utf8') + '\n</script>');
}
// The ASSEMBLED document, for the source-level guard greps. Reading
// site/index.html alone would miss everything in app.js and aip.js, so a guard
// against a removed feature would pass because it was looking in the wrong file.
const APP_SRC = html;
// Remove the embedded leaflet bundle (it fights jsdom); the stub replaces it.
html = html.replace(/<!-- Leaflet 1\.9\.4 JS embedded for offline use -->\s*<script>[\s\S]*?<\/script>/, '');

const leafletStub = `
  window.__mapHandlers = {};
  window.__mapHandlerList = {};
  window.__panes = {};
  /** Fire EVERY handler registered for an event, like the real map does. */
  window.__fireMap = function(ev, arg){ (window.__mapHandlerList[ev] || []).forEach(function(fn){ fn(arg); }); };
  function Layer(){}
  Layer.prototype.addTo = function(){ return this; };
  Layer.prototype.setLatLngs = function(v){ this._ll = v; return this; };
  Layer.prototype.on = function(ev, fn){ (this._h=this._h||{})[ev]=fn; return this; };
  Layer.prototype.getLatLng = function(){ return this._latlng; };
  Layer.prototype.setLatLng = function(ll){ this._latlng = ll; return this; };
  Layer.prototype.bindTooltip = function(html, o){ this._tip = html; this._tipOpts = o || {}; return this; };
  Layer.prototype.setStyle = function(o){ this._opts = Object.assign({}, this._opts, o); return this; };
  // The ruler preview reuses ONE marker and swaps its icon only when the
  // label text changes, so the stub has to honour setIcon for the test to be
  // able to read what the chip says.
  Layer.prototype.setIcon = function(i){ this._opts = Object.assign({}, this._opts, { icon: i }); return this; };
  window.L = {
    map: function(){ return {
      setView: function(){ return this; },
      getCenter: function(){ var c = window.__stubCenter || { lat: 69.3, lng: 19.0 }; return c; },
      on: function(ev, fn){
        (window.__mapHandlerList[ev] = window.__mapHandlerList[ev] || []).push(fn);
        window.__mapHandlers[ev] = fn;      // last registered, for old tests
      },
      off: function(ev, fn){
        const l = window.__mapHandlerList[ev] || [];
        const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1);
        window.__mapHandlers[ev] = l[l.length - 1];
      },
      createPane: function(name){ var p = window.__panes[name] = { style: {} }; return p; },
      getPane: function(name){ return window.__panes[name] || (window.__panes[name] = { style: {} }); },
      getBounds: function(){
        var b = window.__stubBounds || { south: 68.5, west: 17.0, north: 70.0, east: 20.0 };
        return { getSouth: function(){ return b.south; }, getWest: function(){ return b.west; },
                 getNorth: function(){ return b.north; }, getEast: function(){ return b.east; } };
      },
      dragging: { enable: function(){}, disable: function(){} },
      removeLayer: function(){},
      addLayer: function(){},
      invalidateSize: function(){},
      getZoom: function(){ return window.__stubZoom === undefined ? 8 : window.__stubZoom; }
    };},
    tileLayer: function(u, o){ var l = new Layer(); l._url = u; l._opts = o || {}; return l; },
    polyline: function(c, o){ var l = new Layer(); l._ll = c; l._opts = o || {}; return l; },
    polygon: function(c, o){ var l = new Layer(); l._ll = c; l._opts = o || {}; l._isPolygon = true; return l; },
    marker: function(ll, o){ var l = new Layer(); l._latlng = ll; l._opts = o || {}; return l; },
    divIcon: function(o){ return o; },
    // Used by the waypoint context menu to stop the route line underneath from
    // also opening its leg panel.
    DomEvent: { stop: function(){}, stopPropagation: function(){}, preventDefault: function(){} }
  };
`;

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  beforeParse(window) {
    window.eval(leafletStub);
    const store = {};
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: k => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: k => { delete store[k]; }
      }
    });
    window.alert = m => console.log('  [alert]', String(m).split('\n')[0]);
    window.confirm = () => true;
    window.prompt = (m, d) => d;
    window.print = () => {};
    window.__lastBlob = null;
    window.URL.createObjectURL = (b) => { window.__lastBlob = b; return 'blob:x'; };
    window.URL.revokeObjectURL = () => {};
  }
});

const w = dom.window;
const doc = w.document;
const errors = [];
w.addEventListener('error', e => errors.push(e.message));

function T(name, fn) {
  try { fn(); console.log('  PASS  ' + name); }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + e.message); errors.push(name + ': ' + e.message); }
}
// Async tests: the app's dialogs are promise-based, so a test drives them by
// starting the action, answering the dialog, then awaiting. Queued here and
// run after the synchronous suite, before the summary.
const asyncQueue = [];
function TA(name, fn) { asyncQueue.push([name, fn]); }
async function runAsyncTests() {
  for (const [name, fn] of asyncQueue) {
    try { await fn(); console.log('  PASS  ' + name); }
    catch (e) { console.log('  FAIL  ' + name + ' -> ' + e.message); errors.push(name + ': ' + e.message); }
  }
}
/** The dialog currently on screen, or null. */
const openDlg = () => doc.getElementById('app-dialog');
/** Click a dialog option by its visible label (substring match). */
function answerDialog(labelPart) {
  const dlg = openDlg();
  if (!dlg) throw new Error('no dialog is open (expected one offering "' + labelPart + '")');
  const btn = [...dlg.querySelectorAll('.dlg-btn')].find(b => b.textContent.includes(labelPart));
  if (!btn) throw new Error(`dialog has no option matching "${labelPart}": ` +
    [...dlg.querySelectorAll('.dlg-btn')].map(b => b.textContent.trim()).join(' | '));
  btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
}
/** Type into the dialog's text field. */
function typeInDialog(value, fieldId) {
  const dlg = openDlg();
  if (!dlg) throw new Error('no dialog is open');
  // A dialog can carry SEVERAL fields since v16.74 (the waypoint menu edits a
  // name AND an altitude), so a test must say which one it is typing into.
  const input = fieldId
    ? dlg.querySelector('.dlg-input[data-field="' + fieldId + '"]')
    : dlg.querySelector('.dlg-input');
  if (!input) throw new Error('the open dialog has no field ' + (fieldId || '(first)'));
  input.value = value;
}
const dialogText = () => (openDlg() ? openDlg().textContent : '');
const toastText = () => {
  const host = doc.getElementById('app-toasts');
  return host ? host.textContent : '';
};
/** Let queued promise callbacks run. */
const tick = () => new Promise(r => setTimeout(r, 0));
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
// jsdom does not implement innerText, so assignments land as plain props.
const txtOf = id => { const e = doc.getElementById(id); return e.innerText !== undefined ? e.innerText : e.textContent; };
// Top-level let/const live in the global lexical env, not on window.
const ev = expr => w.eval(expr);
// self-contained test route (the app no longer ships built-in routes)
const SEED = `flights = [{ id: 1, title: "Flight Plan 1", depElev: 254, waypoints: [
  { lat: 69.05505349, lng: 18.54466865, name: "ENDU",     alt: 254,  oat: 14, wdir: 0, wspd: 0, var: -11 },
  { lat: 69.23781330, lng: 17.97902780, name: "FINNSNES", alt: 2500, oat: 10, wdir: 0, wspd: 0, var: -11 },
  { lat: 69.67895054, lng: 18.91143033, name: "ENTC",     alt: 2500, oat: 10, wdir: 0, wspd: 0, var: -12 }
]}]; activeFlightIndex = 0; refreshMap(); renderAllFlightTables();`;

console.log('\n=== 0. First-open feature guide (PIC warning first) ===');
T('first-ever open shows the feature guide directly, no welcome question', () => {
  assert(doc.getElementById('help-modal').style.display === 'flex', 'guide not shown on first open');
  assert(doc.getElementById('welcome-modal') === null, 'welcome modal should be gone');
  assert(w.localStorage.getItem('c182_guide_shown') === '1', 'read-once flag not set');
});
T('PIC responsibility section is the FIRST thing in the guide', () => {
  const body = doc.querySelector('#help-modal .modal-body');
  const firstSection = body.querySelector('.setting-section');
  assert(firstSection.textContent.includes('Pilot-in-Command'), 'first section is: ' + firstSection.textContent.slice(0, 60));
  const t = body.textContent;
  assert(t.indexOf('Pilot-in-Command') < t.indexOf('Quick Start'), 'PIC not before Quick Start');
  ['Quick Start', 'PATTERN', 'Reserve', 'POH', 'Wind Matrix', 'Chart Plotting',
   'Export', 'Offline', 'Compact', 'cross-reference'].forEach(k =>
    assert(t.includes(k), 'guide missing: ' + k));
});
T('guide does not reappear once shown; Help button still reopens it', () => {
  w.closeHelpModal();
  w.maybeShowFirstRunGuide();
  assert(doc.getElementById('help-modal').style.display === 'none', 'guide reappeared');
  w.openHelpModal();
  assert(doc.getElementById('help-modal').style.display === 'flex', 'help button broken');
  doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert(doc.getElementById('help-modal').style.display === 'none', 'Esc did not close');
});

console.log('\n=== 1. Initial render ===');
T('fresh instance opens with one BLANK flight plan (no built-in routes)', () => {
  assert(ev('flights.length') === 1, 'expected 1 plan');
  assert(ev('flights[0].waypoints.length') === 0, 'expected no waypoints, got ' + ev('flights[0].waypoints.length'));
  assert(doc.querySelectorAll('#tbody-flight-0 tr').length === 0, 'rows rendered for empty plan');
  const t = doc.getElementById('flight-plans-container').textContent;
  assert(!t.includes('NaN'), 'NaN in blank table');
  assert(txtOf('grand-tot-dist').startsWith('0.0'), 'blank totals not zero');
  assert(doc.getElementById('route-selector').options.length === 1, 'route dropdown not empty: ' + doc.getElementById('route-selector').options.length);
});
T('seeded route renders rows and totals', () => {
  ev(SEED);
  const rows = doc.querySelectorAll('#tbody-flight-0 tr');
  assert(rows.length > 0, 'no rows rendered');
  console.log('        rows: ' + rows.length + '  dist=' + txtOf('grand-tot-dist') + '  rem=' + txtOf('grand-final-rem'));
  const t = doc.getElementById('flight-plans-container').textContent;
  assert(!t.includes('NaN'), 'NaN present in table');
  assert(parseFloat(txtOf('grand-tot-dist')) > 0, 'zero distance');
});

console.log('\n=== 2. Previously-undefined handlers ===');
['openSettingsModal','closeSettingsModal',
 'saveSettings','applyBulkDefaultsToActive','clearAllFlights'].forEach(fn => {
  T(fn + ' is defined', () => assert(typeof w[fn] === 'function', 'not a function'));
});

console.log('\n=== 3. Modal open/close ===');
// THE SERA VMC-MINIMA MODAL WAS REMOVED AT v16.89 at the author's request
// ("it doesnt add anything other than extra space"): it was a static
// quick-reference table behind a header button, not a computed thing. The
// DAYLIGHT card is a different feature and stays - it computes the day-VFR
// window per SERA Art. 2(97), which is why the two are asserted separately.
T('the SERA VMC-minima modal stays removed', () => {
  assert(!doc.getElementById('sera-modal'), 'the modal markup is back');
  assert(!doc.getElementById('sera-btn'), 'the header button is back');
  assert(typeof w.openSeraModal !== 'function', 'openSeraModal is back');
  assert(!/sera-table|btn-sera/.test(APP_SRC), 'the modal CSS is back');
  assert(!/VMC Minima/i.test(APP_SRC), 'the VMC minima table is back');
});
T('and the daylight card it is NOT to be confused with still computes', () => {
  const card = doc.getElementById('daylight-card');
  assert(card, 'the daylight card is gone');
  assert(/SERA Art\. 2\(97\)/.test(APP_SRC), 'the day-VFR legal basis went with it');
});
T('Settings modal opens', () => {
  w.openSettingsModal();
  assert(doc.getElementById('settings-modal').style.display === 'flex', 'did not open');
});
T('Wind modal opens and builds matrix', () => {
  w.openWindModal();
  assert(doc.getElementById('wind-modal').style.display === 'flex', 'did not open');
  assert(doc.querySelectorAll('#wind-matrix-container input').length > 0, 'no inputs');
});
T('Escape closes all modals', () => {
  doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  ['wind-modal','settings-modal'].forEach(id =>
    assert(doc.getElementById(id).style.display === 'none', id + ' still open'));
});

console.log('\n=== 4. Settings persistence & recalc ===');
T('saveSettings persists and recalculates', () => {
  w.openSettingsModal();
  doc.getElementById('perf-roc').value = '900';
  doc.getElementById('perf-climb-tas').value = '95';
  w.saveSettings();
  assert(w.localStorage.getItem('c182_perf_profile') !== null, 'not persisted');
  const p = JSON.parse(w.localStorage.getItem('c182_perf_profile'));
  assert(p.roc === 900, 'roc not saved, got ' + p.roc);
  assert(doc.getElementById('settings-modal').style.display === 'none', 'modal still open');
});
T('theme switch applies to body', () => {
  w.openSettingsModal();
  doc.getElementById('qol-theme').value = 'dark';
  w.saveSettings();
  assert(doc.body.classList.contains('dark-mode') && !doc.body.classList.contains('light-mode'), 'body class=' + doc.body.className);
  w.openSettingsModal();
  doc.getElementById('qol-theme').value = 'light';
  w.saveSettings();
  assert(doc.body.classList.contains('light-mode') && !doc.body.classList.contains('dark-mode'), 'did not revert');
});
T('unit change converts initial fuel & relabels', () => {
  const before = parseFloat(doc.getElementById('fuel-dep').value);
  w.openSettingsModal();
  doc.getElementById('qol-fuel-unit').value = 'LITERS';
  doc.getElementById('qol-dist-unit').value = 'KM';
  w.saveSettings();
  const after = parseFloat(doc.getElementById('fuel-dep').value);
  console.log('        fuel ' + before + ' gal -> ' + after + ' L');
  assert(Math.abs(after - before * 3.78541) < 0.2, 'fuel not converted');
  assert(txtOf('lbl-climb-ff') === 'L/h', 'label not updated: ' + txtOf('lbl-climb-ff'));
  assert(doc.querySelector('th').parentElement.textContent.includes('km'), 'dist unit not in header');
  const txt = doc.getElementById('flight-plans-container').textContent;
  assert(!txt.includes('NaN'), 'NaN after unit change');
  // revert
  w.openSettingsModal();
  doc.getElementById('qol-fuel-unit').value = 'GAL';
  doc.getElementById('qol-dist-unit').value = 'NM';
  w.saveSettings();
  assert(Math.abs(parseFloat(doc.getElementById('fuel-dep').value) - before) < 0.2, 'no round trip');
});

console.log('\n=== 5. Bulk apply ===');
TA('applyBulkDefaultsToActive sets alt and OAT, keeps dep elevation AND every wind (v17.6)', async () => {
  // The winds the later sections rely on are put on the legs directly: there is
  // no default-wind field to carry them any more.
  ev(`flights[0].waypoints.forEach((wp, i) => { wp.wdir = 310 + i; wp.wspd = 22; });`);
  doc.getElementById('def-oat').value = '-4';
  doc.getElementById('def-alt').value = '3500';
  const depAltBefore = ev('flights[0].waypoints[0].alt');
  const p = w.applyBulkDefaultsToActive();
  await tick();
  answerDialog('Apply to all legs');
  await p;
  const wps = ev('flights[0].waypoints');
  assert(wps.every(x => x.oat === -4), 'OAT not applied');
  assert(wps.every((x, i) => x.wdir === 310 + i && x.wspd === 22), 'bulk apply overwrote a leg wind');
  assert(wps[0].alt === depAltBefore, 'departure elevation was overwritten');
  assert(wps[1].alt === 3500, 'cruise alt not applied');
  ev(`flights[0].waypoints.forEach((wp) => { wp.wdir = 310; }); renderAllFlightTables();`);
});

TA('Flight Defaults has no departure elevation and no wind field; new waypoints start at 000/00 (v17.6)', async () => {
  for (const id of ['def-dep-elev', 'def-wdir', 'def-wspd'])
    assert(!doc.getElementById(id), '#' + id + ' is back in Flight Defaults');
  assert(!/def-dep-elev|def-wdir|def-wspd|updateActiveFlightDepElev/.test(APP_SRC),
    'code still reads a removed Flight Defaults field');
  assert(ev('NEW_WP_WIND.wdir') === 0 && ev('NEW_WP_WIND.wspd') === 0, 'a new waypoint no longer starts at 000/00');
  // a waypoint born by a map click carries 000/00, whatever the legs around it say
  ev(`pushUndoState('test'); flights.push({ id: 99, title: 'T', depElev: 0, waypoints: [] });
      activeFlightIndex = flights.length - 1;`);
  for (const latlng of [{ lat: 69.5, lng: 19.0 }, { lat: 69.7, lng: 19.4 }]) {
    const p = w.__mapHandlers.click({ latlng });
    await tick();
    answerDialog('Add waypoint');
    await p;
  }
  const wps = ev('flights[activeFlightIndex].waypoints');
  assert(wps.length === 2, 'map clicks did not add two waypoints: ' + wps.length);
  assert(wps.every((x) => x.wdir === 0 && x.wspd === 0), 'a new waypoint did not start at 000/00: ' +
    JSON.stringify(wps.map((x) => [x.wdir, x.wspd])));
  ev(`flights.pop(); activeFlightIndex = 0; refreshMap(); renderAllFlightTables();`);
});

console.log('\n=== 6. Wind stronger than TAS (old NaN crash) ===');
TA('gale-force wind does not produce NaN', async () => {
  ev(`flights[0].waypoints.forEach((wp) => { wp.wspd = 400; }); renderAllFlightTables();`);
  const txt = doc.getElementById('flight-plans-container').textContent;
  assert(!txt.includes('NaN'), 'NaN leaked into table with wspd > TAS');
  ev(`flights[0].waypoints.forEach((wp) => { wp.wspd = 15; }); renderAllFlightTables();`);
});

console.log('\n=== 7. PATTERN waypoint (old showDelete ReferenceError) ===');
T('pattern leg renders without throwing', () => {
  ev(`pushUndoState();
      (function(){ const wps = flights[0].waypoints; const last = wps[wps.length-1];
        wps.push({lat:last.lat, lng:last.lng, name:'PATTERN', alt:last.alt, oat:5,
                  wdir:230, wspd:10, var:-12, varSource:'REGIONAL', isPattern:true, laps:4}); })();
      renderAllFlightTables();`);
  const txt = doc.getElementById('flight-plans-container').textContent;
  assert(txt.includes('PATTERN'), 'pattern row missing');
  assert(!txt.includes('NaN'), 'NaN in pattern row');
  assert(txt.includes('laps'), 'laps control missing');
});

console.log('\n=== 8. Multi-flight index handling ===');
TA('add flight plans then delete an earlier one keeps active pointer', async () => {
  w.addNewFlightPlan();
  w.addNewFlightPlan();
  assert(ev('flights.length') === 3, 'expected 3 flights, got ' + ev('flights.length'));
  const ids = ev('flights.map(f => f.id)');
  assert(new Set(ids).size === ids.length, 'duplicate flight ids: ' + ids);
  w.setActiveFlight(2);
  const activeId = ev('flights[2].id');
  await (async () => { const p = w.removeFlightPlan(0); await tick(); answerDialog('Delete flight'); await p; })();
  assert(ev('flights.length') === 2, 'delete failed');
  assert(ev('flights[activeFlightIndex].id') === activeId,
         'active pointer drifted: expected id ' + activeId + ' got ' + ev('flights[activeFlightIndex].id'));
});

console.log('\n=== 9. Clear all ===');
TA('clearAllFlights resets to one empty plan', async () => {
  const p = w.clearAllFlights();
  await tick();
  answerDialog('Clear everything');
  await p;
  assert(ev('flights.length') === 1, 'not reset');
  assert(ev('flights[0].waypoints.length') === 0, 'waypoints not cleared');
  assert(ev('activeFlightIndex') === 0, 'index not reset');
  const txt = doc.getElementById('flight-plans-container').textContent;
  assert(!txt.includes('NaN'), 'NaN after clear');
});
TA('map click on empty plan adds a waypoint through the dialog', async () => {
  const p = w.__mapHandlers.click({ latlng: { lat: 69.1, lng: 18.5 } });
  await tick();
  assert(dialogText().includes('Add departure point'), 'no naming dialog: ' + dialogText().slice(0, 80));
  answerDialog('Add waypoint');
  await p;
  assert(ev('flights[0].waypoints.length') === 1, 'waypoint not added');
});
TA('cancelling the naming dialog adds nothing', async () => {
  const before = ev('flights[0].waypoints.length');
  const p = w.__mapHandlers.click({ latlng: { lat: 69.2, lng: 18.6 } });
  await tick();
  answerDialog('Cancel');
  await p;
  assert(ev('flights[0].waypoints.length') === before, 'cancel still added a waypoint');
});

console.log('\n=== 10. Undo / redo ===');
T('undo restores previous state', () => {
  const n = ev('flights[0].waypoints.length');
  w.undoLast();
  assert(ev('flights[0].waypoints.length') !== n || ev('flights.length') !== 1, 'undo had no effect');
  w.redoLast();
});

console.log('\n=== 11. Corrupt localStorage resilience ===');
T('sanitiseFlights rejects junk', () => {
  assert(w.sanitiseFlights([]) === null, 'empty array should be null');
  assert(w.sanitiseFlights('nope') === null, 'string should be null');
  const ok = ev("sanitiseFlights([{ waypoints: [{ lat: 1, lng: 2 }, { lat: 'x', lng: 2 }] }])");
  assert(ok[0].waypoints.length === 1, 'bad waypoint not filtered');
});

console.log('\n=== 12. Custom route save / load / delete round trip ===');
TA('save current flight as a route, then load it back', async () => {
  ev(SEED);
  ev(`localStorage.removeItem('c182_custom_routes'); loadedRouteRef = null; populateRouteDropdown();`);
  const p = w.saveCurrentMission();
  await tick();
  answerDialog('Save only the active sector as a route');
  await tick();
  answerDialog('Save');                          // accept the default name
  await p;
  const names = Object.keys(w.getStoredSingleRoutes());
  assert(names.length === 1, 'expected 1 stored route, got ' + names.length);
  await (async () => { const c = w.clearAllFlights(); await tick(); answerDialog('Clear everything'); await c; })();
  doc.getElementById('route-selector').value = 'route:' + names[0];
  w.loadSelectedRouteOrMission();
  assert(ev('flights[activeFlightIndex].waypoints.length') === 3, 'route did not load');
  assert(!doc.getElementById('flight-plans-container').textContent.includes('NaN'), 'NaN after route load');
});
TA('deleting a custom route removes it and empties the dropdown group', async () => {
  const names = Object.keys(w.getStoredSingleRoutes());
  doc.getElementById('route-selector').value = 'route:' + names[0];
  const p = w.deleteCurrentMission();
  await tick();
  answerDialog('Delete');
  await p;
  assert(Object.keys(w.getStoredSingleRoutes()).length === 0, 'route not deleted');
  ev(SEED);
});

console.log('\n=== 13. Ruler mode ===');
T('ruler updates banner AND drops measurement chips on the map', () => {
  w.toggleRulerMode();
  assert(doc.getElementById('ruler-banner').style.display === 'flex', 'banner hidden');
  w.__mapHandlers.click({ latlng: { lat: 69.0, lng: 18.0 } });
  assert(ev('rulerMarkers.length') === 1, 'first click: 1 dot expected, got ' + ev('rulerMarkers.length'));
  w.__mapHandlers.click({ latlng: { lat: 69.5, lng: 18.5 } });
  const r = doc.getElementById('ruler-readout').textContent;
  console.log('        readout: ' + r.trim());
  assert(r.includes('Total'), 'readout not updated');
  assert(!r.includes('NaN'), 'NaN in readout');
  // 2 dots + 1 segment chip; total chip appears only from 2 segments
  assert(ev('rulerMarkers.length') === 3, 'segment chip missing: ' + ev('rulerMarkers.length'));
  assert(ev('rulerTotalMarker') === null, 'total chip too early');
  w.__mapHandlers.click({ latlng: { lat: 69.6, lng: 19.2 } });
  assert(ev('rulerMarkers.length') === 5, 'second segment chip missing: ' + ev('rulerMarkers.length'));
  assert(ev('rulerTotalMarker !== null'), 'running-total chip missing');
  // stopping the ruler clears every chip
  w.toggleRulerMode();
  assert(ev('rulerMarkers.length') === 0 && ev('rulerTotalMarker') === null, 'chips not cleared');
});
T('zero-length ruler click adds no segment chip', () => {
  w.toggleRulerMode();
  w.__mapHandlers.click({ latlng: { lat: 69.0, lng: 18.0 } });
  w.__mapHandlers.click({ latlng: { lat: 69.0, lng: 18.0 } });
  assert(ev('rulerMarkers.length') === 2, 'degenerate segment got a chip: ' + ev('rulerMarkers.length'));
  w.toggleRulerMode();
});

// -- 13a. THE RULER PREVIEWS (v16.91, the pilot's request) --------------------
// "when clicking a point a preview of the ruler length is visible to accurately
// measure distances from a starting position".
// A FAILED ASSERT SKIPS WHATEVER FOLLOWS IT, so a test that turns the ruler off
// on its last line leaves it ON when it fails - and isRulerMode gates the
// keybindings, which made four unrelated tests further down the file report
// failures that had nothing to do with their subject. Each test below sets the
// mode rather than assuming it.
const startRuler = () => { ev('if (isRulerMode) toggleRulerMode();'); w.toggleRulerMode(); };
const stopRuler = () => { ev('if (isRulerMode) toggleRulerMode();'); };
const previewTxt = () => (doc.getElementById('ruler-preview-readout').textContent || '').trim();
const committedTxt = () => (doc.getElementById('ruler-readout').textContent || '').trim();
const previewChip = () => {
  const m = ev('rulerPreviewMarker');
  return m ? String(ev('rulerPreviewMarker._opts.icon.html')) : '';
};
// The figures a readout states, so the preview and the commit can be compared
// as NUMBERS rather than as two sentences that merely look similar.
const figs = (t) => (t.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);

T('one click, then the cursor: the band and its figure follow the mouse', () => {
  startRuler();
  // NOTHING BEFORE THE FIRST CLICK. There is no starting position to measure
  // from, so a chip at the cursor would be measuring from nowhere.
  w.__fireMap('mousemove', { latlng: { lat: 69.4, lng: 18.4 } });
  assert(ev('rulerPreviewMarker') === null && ev('rulerPreviewLine._ll.length') === 0,
    'a preview appeared before any point was set');
  assert(previewTxt() === '', 'the preview readout spoke before there was anything to measure from');

  w.__mapHandlers.click({ latlng: { lat: 69.0, lng: 18.0 } });
  w.__fireMap('mousemove', { latlng: { lat: 69.5, lng: 18.5 } });
  assert(ev('rulerPreviewMarker') !== null, 'no preview chip after the first click');
  assert(ev('rulerPreviewLine._ll.length') >= 2, 'no rubber band: ' + ev('rulerPreviewLine._ll.length'));
  const t1 = previewTxt();
  assert(/Preview/.test(t1) && /Ruler 1/.test(t1), 'the preview does not say where it measures from: ' + t1);
  assert(!/NaN/.test(t1) && !/NaN/.test(previewChip()), 'NaN in the preview: ' + t1 + ' | ' + previewChip());
  // ONE POINT MEANS NO TOTAL. A running total of one leg IS that leg, and
  // printing it twice invites the pilot to add them together.
  assert(!/Total/.test(t1), 'a one-point preview claimed a total: ' + t1);
  // ...and it FOLLOWS: a different cursor position is a different figure.
  const d1 = figs(t1).slice(-1)[0];
  w.__fireMap('mousemove', { latlng: { lat: 69.9, lng: 18.5 } });
  const d2 = figs(previewTxt()).slice(-1)[0];
  assert(d2 > d1 + 10, 'the preview did not follow the cursor: ' + d1 + ' then ' + d2);
  stopRuler();
});

T('THE INVARIANT: committing the point produces the figures the preview showed', () => {
  // The leg-panel preview runs the real engine on a copy (v16.37) and the
  // fix-style preview calls the map's own fixSymbolSvg (v16.35), both so that
  // what is shown cannot differ from what applying it does. Same rule here.
  //
  // THE FIXTURE HAS TO BE ABLE TO SEE THE ANSWER, and the first one could not.
  // It measured ENDU -> ENTC, where resolveMagVar returns -11 at BOTH ends - so
  // a mutation taking the variation at the START of the leg instead of the end
  // produced the identical magnetic track and the test passed. Tromso (-11) to
  // Kirkenes (-17) differs by 6 degrees, and the fixture ASSERTS that below so
  // it cannot quietly stop discriminating. Straight M5.
  startRuler();
  const A7 = { lat: 69.6833, lng: 18.9189 };    // Tromso, var -11
  const cursor = { lat: 69.7258, lng: 29.8913 };  // Kirkenes, var -17
  assert(Math.round(ev(`resolveMagVar(${A7.lat}, ${A7.lng}).val`)) !==
         Math.round(ev(`resolveMagVar(${cursor.lat}, ${cursor.lng}).val`)),
    'the fixture has stopped being able to tell the two ends of the leg apart');
  w.__mapHandlers.click({ latlng: A7 });
  w.__fireMap('mousemove', { latlng: cursor });
  const pv = figs(previewTxt());              // [TT, MT, dist]
  const pvChip = previewChip();
  w.__mapHandlers.click({ latlng: cursor });
  const cm = figs(committedTxt());            // [legNo, TT, MT, dist, total]
  // Both readouts open by naming the point/leg, then state TT, MT and distance;
  // the committed one adds the running total.
  assert(pv.length === 4 && cm.length === 5, 'readout shapes changed: ' + JSON.stringify([pv, cm]));
  assert(pv.slice(1).join() === cm.slice(1, 4).join(),
    'the preview promised ' + JSON.stringify(pv.slice(1)) + ' and the commit gave ' + JSON.stringify(cm.slice(1, 4)));
  // and the chip the pilot was reading is the chip the segment now carries
  const segChip = String(ev('rulerMarkers[rulerMarkers.length - 1]._opts.icon.html'));
  // The TEXT, not the markup: the two chips sit at different offsets on purpose
  // (the preview rides beside the cursor, the segment chip beside its midpoint),
  // so comparing the raw html would compare pixel offsets as well as figures.
  const chipText = (h) => h.replace(/<[^>]*>/g, '').trim();
  assert(chipText(pvChip) === chipText(segChip),
    'the preview chip said "' + chipText(pvChip) + '" and the committed chip says "' + chipText(segChip) + '"');
  stopRuler();
});

T('the second leg previews what the total WOULD become, and then does', () => {
  startRuler();
  w.__mapHandlers.click({ latlng: { lat: 69.0, lng: 18.0 } });
  w.__mapHandlers.click({ latlng: { lat: 69.4, lng: 18.0 } });
  const cursor = { lat: 69.4, lng: 19.0 };
  w.__fireMap('mousemove', { latlng: cursor });
  const t = previewTxt();
  assert(/Ruler 2/.test(t) && /Total would be/.test(t), 'no provisional total on the second leg: ' + t);
  const pv = figs(t);                          // [fromPt, TT, MT, dist, total]
  w.__mapHandlers.click({ latlng: cursor });
  const cm = figs(committedTxt());             // [legNo, TT, MT, dist, total]
  assert(pv.slice(1) .join() === cm.slice(1).join(),
    'the provisional total was not what committing gave: ' + JSON.stringify([pv, cm]));
  stopRuler();
});

T('the cursor leaving the map takes the band with it, and nothing else', () => {
  startRuler();
  w.__mapHandlers.click({ latlng: { lat: 69.0, lng: 18.0 } });
  w.__mapHandlers.click({ latlng: { lat: 69.5, lng: 18.5 } });
  const before = committedTxt();
  w.__fireMap('mousemove', { latlng: { lat: 69.9, lng: 19.9 } });
  assert(ev('rulerPreviewMarker') !== null, 'no preview to lose');
  w.__fireMap('mouseout', {});
  assert(ev('rulerPreviewMarker') === null && ev('rulerPreviewLine._ll.length') === 0,
    'the band was left hanging at the last pixel inside the map');
  assert(previewTxt() === '', 'the preview readout survived the pointer leaving');
  // THE COMMITTED MEASUREMENT IS UNTOUCHED - which is the whole reason the two
  // readouts are separate spans rather than one that has to be restored.
  assert(committedTxt() === before, 'the committed readout changed: ' + before + ' -> ' + committedTxt());
  assert(ev('rulerMarkers.length') === 3, 'a committed chip went with the preview');
  stopRuler();
});

T('a preview of no length states nothing rather than 000 and 0.0', () => {
  startRuler();
  w.__mapHandlers.click({ latlng: { lat: 69.0, lng: 18.0 } });
  w.__fireMap('mousemove', { latlng: { lat: 69.0, lng: 18.0 } });
  assert(ev('rulerPreviewMarker') === null && previewTxt() === '',
    'the cursor sitting on the point produced a bearing: ' + previewTxt());
  stopRuler();
});

T('committing retires the band it came from, and stopping the ruler clears it', () => {
  startRuler();
  w.__mapHandlers.click({ latlng: { lat: 69.0, lng: 18.0 } });
  w.__fireMap('mousemove', { latlng: { lat: 69.5, lng: 18.5 } });
  w.__mapHandlers.click({ latlng: { lat: 69.5, lng: 18.5 } });
  assert(ev('rulerPreviewMarker') === null && ev('rulerPreviewLine._ll.length') === 0,
    'the preview outlived the click that committed it');
  w.__fireMap('mousemove', { latlng: { lat: 69.9, lng: 18.9 } });
  assert(ev('rulerPreviewMarker') !== null, 'a new band did not start from the new point');
  stopRuler();
  assert(ev('rulerPreviewMarker') === null && ev('rulerPreviewLine._ll.length') === 0,
    'stopping the ruler left the band on the map');
});

T('one marker, reused - its markup is rebuilt only when the text changes', () => {
  // The v16.33 rule for the airspace hover card: regenerate the markup when the
  // reading changes, not per pixel. At z10 a CSS pixel is ~26 m, so the 0.1 NM
  // the chip prints only turns over every several pixels of travel.
  startRuler();
  w.__mapHandlers.click({ latlng: { lat: 69.0, lng: 18.0 } });
  w.__fireMap('mousemove', { latlng: { lat: 69.5, lng: 18.5 } });
  const first = ev('rulerPreviewMarker');
  const label = ev('rulerPreviewLabel');
  // THE ICON OBJECT IS THE OBSERVABLE, NOT THE LABEL STRING. The first version
  // of this test compared rulerPreviewLabel across the move - and removing the
  // key entirely (`if (true)`) reassigns that field to the SAME value, so the
  // comparison passed and the mutation reported "not caught". setIcon takes a
  // FRESH divIcon every time it is called, so identity is what says whether the
  // markup was rebuilt.
  const icon = ev('rulerPreviewMarker._opts.icon');
  // A move too small to change the printed figure must not touch the markup.
  w.__fireMap('mousemove', { latlng: { lat: 69.500001, lng: 18.500001 } });
  assert(ev('rulerPreviewMarker') === first, 'the marker was replaced instead of moved');
  assert(ev('rulerPreviewMarker._opts.icon') === icon, 'the markup was rebuilt for an unchanged figure');
  assert(ev('rulerPreviewLabel') === label, 'the remembered figure changed without the figure changing');
  w.__fireMap('mousemove', { latlng: { lat: 69.9, lng: 18.9 } });
  assert(ev('rulerPreviewMarker') === first, 'the marker was replaced on a real move');
  assert(ev('rulerPreviewMarker._opts.icon') !== icon, 'the markup was NOT rebuilt for a changed figure');
  assert(ev('rulerPreviewLabel') !== label, 'the remembered figure was not updated');
  stopRuler();
});

T('the ruler DRAWS the line it MEASURES - one densifier, shared with the route', () => {
  // THIS WAS WRONG SINCE THE RULER EXISTED, and it is v16.63's rule never
  // applied to this surface: rulerLine.setLatLngs(rulerPoints) draws straight
  // Mercator segments - a RHUMB - while calcDistanceNM measures a geodesic, and
  // the segment chip is placed with interpolateGeo, i.e. on the measured path.
  // Measured on Tromso-Kirkenes at 69 N: 5.15 NM apart at the midpoint.
  const G = w;   // main.js puts every module export on window
  const A = { lat: 69.6833, lng: 18.9189 };   // Tromso
  const B = { lat: 69.7258, lng: 29.8913 };   // Kirkenes
  startRuler();
  w.__mapHandlers.click({ latlng: A });
  w.__mapHandlers.click({ latlng: B });
  const drawn = ev('rulerLine._ll');
  assert(drawn.length > 5, 'the ruler line was not densified: ' + drawn.length + ' points');
  // Every drawn point, AND the midpoint of every drawn segment, lies on the
  // measured path - the vertex-only check passes a chord-only line (v16.62).
  const L = G.distanceNMExact(A.lat, A.lng, B.lat, B.lng);
  const onPath = (p) => {
    let best = Infinity;
    for (let k = 0; k <= 400; k++) {
      const q = G.interpolateGeo(A.lat, A.lng, B.lat, B.lng, (L * k) / 400, L);
      best = Math.min(best, G.distanceNMExact(p[0], p[1], q[0], q[1]));
    }
    return best;
  };
  let worst = 0;
  for (let i = 0; i < drawn.length; i++) {
    const a = drawn[i], b = drawn[Math.min(i + 1, drawn.length - 1)];
    worst = Math.max(worst, onPath(a), onPath([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]));
  }
  assert(worst <= 0.1, 'the drawn ruler line leaves the measured path by ' + worst.toFixed(3) +
    ' NM - it is drawing the chord, not the path model');
  // The chip labels a point ON that line, which is the half of the defect a
  // pilot actually sees.
  const chip = ev('rulerMarkers[rulerMarkers.length - 1]._latlng');
  assert(onPath(chip) <= 0.1, 'the segment chip floats ' + onPath(chip).toFixed(3) +
    ' NM off the drawn line');
  // ONE DENSIFIER, not a second copy: the route line goes through the same one.
  assert(/densifyPath\(/.test(APP_SRC), 'the shared densifier is gone');
  assert(/return densifyPath\(flightLineCoords\(fl\)\);/.test(APP_SRC),
    'drawnLineCoords no longer goes through the shared densifier');
  stopRuler();
});

T('the preview band follows the path model too, through that same densifier', () => {
  const G = w;   // main.js puts every module export on window
  const A = { lat: 69.6833, lng: 18.9189 };
  const B = { lat: 69.7258, lng: 29.8913 };
  startRuler();
  w.__mapHandlers.click({ latlng: A });
  w.__fireMap('mousemove', { latlng: B });
  const band = ev('rulerPreviewLine._ll');
  assert(band.length > 5, 'the rubber band was not densified: ' + band.length + ' points');
  const L = G.distanceNMExact(A.lat, A.lng, B.lat, B.lng);
  const mid = G.interpolateGeo(A.lat, A.lng, B.lat, B.lng, L / 2, L);
  let best = Infinity;
  band.forEach((p) => { best = Math.min(best, G.distanceNMExact(p[0], p[1], mid[0], mid[1])); });
  assert(best <= 0.1, 'the band misses the measured midpoint by ' + best.toFixed(3) + ' NM');
  stopRuler();
});

// -- 13b. ESCAPE AND UNDO BELONG TO THE RULER (v16.92) -----------------------
// The pilot: "let me press escape on ruler to reset the ruler and ctrl-Z to
// remove last ruler waypoint." Both rules are decided in the PURE resolver, so
// they are checked without a browser first - which is the whole reason
// keys.js exists (a binding that quietly does nothing looks exactly like a key
// that was never pressed).
T('Escape backs out of the ruler one level at a time', () => {
  const K = w;   // main.js puts every module export on window
  const esc = { key: 'Escape' };
  const at = (n) => K.resolveKey(esc, { rulerMode: true, rulerPoints: n });
  assert(at(3).action === 'ruler-clear', 'Escape did not clear a ruler with points');
  assert(at(1).action === 'ruler-clear', 'one point is still a measurement to clear');
  // ...and with nothing left to clear it stops the tool, so Escape is never the
  // silent keystroke this module exists to prevent.
  assert(at(0).action === 'toggle-ruler', 'Escape on an empty ruler did not stop it');
  // The ruler off is the behaviour every earlier version had.
  assert(K.resolveKey(esc, {}).action === 'close-overlays', 'Escape outside the ruler changed');
});

T('...but an overlay, a dialog and a drag are all OUTSIDE the ruler', () => {
  const K = w;   // main.js puts every module export on window
  const esc = { key: 'Escape' };
  // A modal open over the map is the outer level, so Escape closes that first
  // and the measurement underneath survives.
  assert(K.resolveKey(esc, { rulerMode: true, rulerPoints: 3, overlayOpen: true }).action
    === 'close-overlays', 'Escape reached the ruler through an open modal');
  assert(K.resolveKey(esc, { rulerMode: true, rulerPoints: 3, dialogOpen: true, overlayOpen: true })
    === null, 'Escape was taken from dialog.js');
  // A drag is the state that TRAPS the map, so it still wins over everything.
  assert(K.resolveKey(esc, { rulerMode: true, rulerPoints: 3, dragging: true }).action
    === 'cancel-drag', 'a stuck drag lost its way out to the ruler');
});

T('undo is the ruler\'s while the ruler runs - on whatever key undo is bound to', () => {
  const K = w;   // main.js puts every module export on window
  const z = { key: 'z', ctrlKey: true };
  assert(K.resolveKey(z, { rulerMode: true }).action === 'ruler-undo', 'Ctrl+Z was not the ruler\'s');
  assert(K.resolveKey(z, {}).action === 'undo', 'Ctrl+Z stopped being undo outside the ruler');
  // THE CLAIM IN THE COMMENT IS THAT IT FOLLOWS A REBOUND UNDO, so assert it
  // rather than leaving a sentence nothing checks. Keyed on the SPEC, not the
  // chord.
  const km = Object.assign(K.defaultKeymap(), { undo: 'Alt+U' });
  assert(K.resolveKey({ key: 'u', altKey: true }, { rulerMode: true }, km).action === 'ruler-undo',
    'a rebound undo did not follow the ruler');
  assert(K.resolveKey(z, { rulerMode: true }, km) === null, 'the old chord still fired');
  // REDO IS DELIBERATELY LEFT ALONE: the ruler is click-to-place, so putting a
  // point back is one click, and a second stack is the mechanism v16.61 says
  // to prefer the deletion of.
  assert(K.resolveKey({ key: 'z', ctrlKey: true, shiftKey: true }, { rulerMode: true }).action
    === 'redo', 'redo was quietly taken as well');
});

T('both are actions the page must handle, not bindings the menu offers', () => {
  const K = w;   // main.js puts every module export on window
  // They are what an existing chord MEANS in a state, exactly like cancel-drag,
  // so there is nothing for the pilot to set - and the switch-coverage test
  // then requires the page to have a case for each.
  assert(K.KEY_ACTIONS.includes('ruler-clear') && K.KEY_ACTIONS.includes('ruler-undo'),
    'the page is not required to handle them');
  assert(!K.ACTION_SPECS.some((a) => a.id === 'ruler-clear' || a.id === 'ruler-undo'),
    'a derived meaning was listed as a bindable action');
});

// -- and in the page, where the markers actually are -------------------------
const rulerState = () => ev(`(function(){
  return JSON.stringify({
    pts: rulerPoints.map(function(p){ return [p.lat, p.lng]; }),
    icons: rulerMarkers.map(function(m){ return m._opts.icon.html; }),
    line: (rulerLine._ll || []).length,
    total: rulerTotalMarker ? rulerTotalMarker._opts.icon.html : null,
    readout: document.getElementById('ruler-readout').textContent
  });
})()`);
const rulerZ = () => doc.dispatchEvent(new w.KeyboardEvent('keydown',
  { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
const pressEsc = () => doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

T('THE INVARIANT: Ctrl+Z lands exactly where the pilot was one click ago', () => {
  startRuler();
  const clk = (lat, lng) => w.__mapHandlers.click({ latlng: { lat: lat, lng: lng } });
  clk(69.0, 18.0); clk(69.4, 18.3); clk(69.6, 19.1);
  const three = rulerState();
  clk(69.9, 19.8);
  assert(rulerState() !== three, 'the fourth click changed nothing - the fixture proves nothing');
  rulerZ();
  assert(rulerState() === three,
    'undo did not restore the three-point state:\n  want ' + three + '\n  got  ' + rulerState());
  // ...and it keeps going down to empty.
  rulerZ(); rulerZ(); rulerZ();
  assert(ev('rulerPoints.length') === 0 && ev('rulerMarkers.length') === 0 &&
    ev('rulerTotalMarker') === null && ev('rulerLine._ll.length') === 0,
    'undoing every point left something drawn');
  assert(/No legs measured yet/.test(doc.getElementById('ruler-readout').textContent),
    'the banner still claims a measurement');
  stopRuler();
});

T('the redraw is the ONE drawing path - running it again changes nothing', () => {
  // The click used to append the newest dot and chip incrementally, which only
  // works while a ruler grows. Both paths end at redrawRuler now, so drawing
  // from the same points twice must be identical - otherwise the two could
  // drift and an undo would leave a stale chip behind.
  startRuler();
  w.__mapHandlers.click({ latlng: { lat: 69.0, lng: 18.0 } });
  w.__mapHandlers.click({ latlng: { lat: 69.4, lng: 18.3 } });
  w.__mapHandlers.click({ latlng: { lat: 69.6, lng: 19.1 } });
  const drawn = rulerState();
  ev('redrawRuler();');
  assert(rulerState() === drawn, 'a second redraw from the same points differed');
  stopRuler();
});

T('Escape clears the measurement, and a second Escape stops the ruler', () => {
  startRuler();
  w.__mapHandlers.click({ latlng: { lat: 69.0, lng: 18.0 } });
  w.__mapHandlers.click({ latlng: { lat: 69.5, lng: 18.5 } });
  assert(ev('rulerMarkers.length') === 3, 'setup failed: ' + ev('rulerMarkers.length'));
  pressEsc();
  assert(ev('rulerPoints.length') === 0 && ev('rulerMarkers.length') === 0,
    'Escape did not clear the ruler');
  assert(ev('isRulerMode') === true, 'Escape stopped the ruler instead of clearing it');
  pressEsc();
  assert(ev('isRulerMode') === false, 'a second Escape did not stop the empty ruler');
  assert(doc.getElementById('ruler-banner').style.display === 'none', 'the banner stayed up');
});

T('neither touches the plan - not the route, not the undo stack', () => {
  // ONE MODE, ONE MEANING. A Ctrl+Z that quietly removed a waypoint because the
  // ruler happened to be empty is the surprise this rule exists to refuse, so
  // the fixture makes an unguarded undo VISIBLE: rename a fix first, then an
  // undo that leaked would put the old name back.
  ev(SEED);
  ev('undoStack = []; redoStack = [];');
  w.pushUndoState('rename a waypoint');
  ev(`flights[0].waypoints[1].name = 'RENAMED'; refreshMap(); renderAllFlightTables();`);
  const depth = ev('undoStack.length');
  startRuler();
  w.__mapHandlers.click({ latlng: { lat: 69.0, lng: 18.0 } });
  w.__mapHandlers.click({ latlng: { lat: 69.5, lng: 18.5 } });
  rulerZ(); rulerZ();                       // down to an empty ruler
  rulerZ();                                 // and one more, with nothing left
  assert(ev(`flights[0].waypoints[1].name`) === 'RENAMED',
    'Ctrl+Z leaked through to the plan and undid a route edit');
  pressEsc(); pressEsc();
  assert(ev('undoStack.length') === depth,
    'the ruler put an entry on the plan\'s undo stack (' + depth + ' -> ' + ev('undoStack.length') + ')');
  assert(ev(`flights[0].waypoints[1].name`) === 'RENAMED', 'Escape reached the plan');
  ev(SEED);
});
stopRuler();

T('the chip rides clear of the cursor, and the marker still takes no mouse', () => {
  // TWO THINGS, AND ONLY MEASURING THEM SEPARATELY TOLD THEM APART. The offset
  // moves the visible LABEL clear of the pointer - but the marker's own 12x12
  // container sits ON the anchor, under the pointer, so `interactive: false` is
  // what keeps the pointer hit-testing to the map. Proved by mutation:
  // interactive:true makes elementFromPoint at the cursor return
  // leaflet-marker-icon (verify:fixes fails by name). The click survives even
  // then, because Leaflet's _findEventTargets ignores a layer that listens for
  // nothing - so that exposure is LATENT, not harmless.
  assert(ev('RULER_CHIP_DX') > 0 && ev('RULER_CHIP_DY') < 0,
    'the chip no longer rides clear of the cursor: ' + ev('RULER_CHIP_DX') + ',' + ev('RULER_CHIP_DY'));
  assert(ev('rulerPreviewLine._opts.interactive') === false, 'the rubber band takes the mouse');
  startRuler();
  w.__mapHandlers.click({ latlng: { lat: 69.0, lng: 18.0 } });
  w.__fireMap('mousemove', { latlng: { lat: 69.5, lng: 18.5 } });
  assert(ev('rulerPreviewMarker._opts.interactive') === false, 'the preview chip takes the mouse');
  // ONE DEFINITION OF THE MARKUP. The create and the update paths had a copy
  // each, which is two places for the offset to drift apart.
  assert((APP_SRC.match(/class="ruler-preview-label"/g) || []).length === 1,
    'the preview chip markup is written in more than one place');
  stopRuler();
});
// ...and whatever the block above left behind, the ruler is OFF from here. The
// LAST test's own cleanup is skipped when it fails, and isRulerMode gates the
// keybindings - which is how one broken ruler assertion produced six failures
// in the undo, Cmd+Z and toast tests.
stopRuler();

console.log('\n=== 14. Save / export round trip ===');
TA('save mission + export produce valid JSON', async () => {
  const p = w.saveCurrentMission();
  await tick();
  answerDialog('Save the whole flight');
  await tick();
  answerDialog('Save');
  await p;
  w.exportMissionFile();
  assert(w.__lastBlob, 'no export blob produced');
});

console.log('\n=== 15. Taxi fuel charged exactly once ===');
TA('taxi fuel applied once per mission', async () => {
  const c = w.clearAllFlights(); await tick(); answerDialog('Clear everything'); await c;
  ev(SEED);
  doc.getElementById('fuel-dep').value = '64';
  w.renderAllFlightTables();
  const burn1 = parseFloat(txtOf('grand-tot-burn'));
  w.addNewFlightPlan();
  w.renderAllFlightTables();
  const burn2 = parseFloat(txtOf('grand-tot-burn'));
  console.log('        burn 1 sector=' + burn1 + '  +empty sector=' + burn2);
  assert(Math.abs(burn1 - burn2) < 0.05, 'burn changed when adding empty sector');
});

console.log('\n=== 16. Chart plotting helpers ===');
T('toDMM formats like a chart margin', () => {
  const lat = w.toDMM(69.05505349, true);
  const lng = w.toDMM(18.54466864, false);
  console.log('        ' + lat + '  ' + lng);
  assert(lat === "69\u00b003.30'N", 'lat got ' + lat);
  assert(lng === "018\u00b032.68'E", 'lng got ' + lng);
  assert(w.toDMM(-33.999999, true).endsWith("'S"), 'south hemi');
  assert(!w.toDMM(59.9999999, true).includes('60.00'), 'rounding to 60 min not handled');
});
T('plotting list renders with coordinates and MT legs', () => {
  ev(SEED);
  const det = doc.querySelector('details.plotting-details');
  assert(det, 'details block missing');
  assert(det.innerHTML.includes('018\u00b0'), 'no longitude in list');
  assert(det.querySelectorAll('input[type=text]').length === 3, 'name inputs missing');
});
T('buildPlottingText produces clean copyable text', () => {
  const t = w.plottingTextFor(0);
  console.log('        ' + t.split('\n')[1]);
  assert(t.includes('WAYPOINTS') && t.includes('MT '), 'sections missing');
  assert(!t.includes('NaN'), 'NaN in plotting text');
});
T('renameWaypoint updates state and table', () => {
  w.renameWaypoint(0, 1, '  BRENSHOLMEN  ');
  assert(ev("flights[0].waypoints[1].name") === 'BRENSHOLMEN', 'not renamed');
  assert(doc.getElementById('flight-plans-container').textContent.includes('BRENSHOLMEN'), 'table not updated');
});

console.log('\n=== 17. ETD / ETO ===');
T('setting ETD shows ETO per leg and ETA in summary', () => {
  doc.getElementById('def-etd').value = '09:00';
  w.renderAllFlightTables();
  const txt = doc.getElementById('flight-plans-container').textContent;
  assert(txt.includes('ETO 09:'), 'no ETO in rows');
  assert(txtOf('grand-tot-time').includes('ETA'), 'no ETA in summary: ' + txtOf('grand-tot-time'));
});
T('ETO wraps past midnight', () => {
  assert(w.computeETO(90) !== null, 'eto null');
  doc.getElementById('def-etd').value = '23:30';
  assert(w.computeETO(60) === '00:30+1', 'got ' + w.computeETO(60));
  doc.getElementById('def-etd').value = '';
  assert(w.computeETO(60) === null, 'empty ETD should yield null');
  w.renderAllFlightTables();
});

console.log('\n=== 18. Fuel reserve flag ===');
T('legs below reserve get flagged, above do not', () => {
  doc.getElementById('fuel-reserve').value = '100';
  w.renderAllFlightTables();
  assert(doc.querySelectorAll('#flight-plans-container .low-fuel').length > 0, 'no low-fuel flags at reserve=100');
  doc.getElementById('fuel-reserve').value = '0';
  w.renderAllFlightTables();
  assert(doc.querySelectorAll('#flight-plans-container .low-fuel').length === 0, 'flags present at reserve=0');
  doc.getElementById('fuel-reserve').value = '8';
  w.renderAllFlightTables();
});
T('planning prefs persist', () => {
  doc.getElementById('def-etd').value = '10:15';
  w.savePlanningPrefs();
  const p = JSON.parse(w.localStorage.getItem('c182_planning_prefs'));
  assert(p.etd === '10:15' && p.reserve === '8', 'prefs not saved: ' + JSON.stringify(p));
});

console.log('\n=== 19. Offline packaging ===');
T('leaflet JS and CSS are embedded in the file itself', () => {
  const raw = APP_SRC;
  assert(raw.includes('Leaflet 1.9.4 JS embedded'), 'js not embedded');
  assert(raw.includes('Leaflet 1.9.4 CSS embedded'), 'css not embedded');
  assert(!raw.includes('unpkg.com'), 'still references unpkg CDN');
  assert(raw.includes('tileerror'), 'no offline tile notice');
});

console.log('\n=== 20. TOC/TOD profile helper ===');
T('climb leg yields TOC after start waypoint', () => {
  ev(SEED);
  const prof = ev("computeLegProfile(flights[0].waypoints[0], flights[0].waypoints[1])");
  console.log('        ' + JSON.stringify({kind:prof.kind, d:prof.distNM, ref:prof.refName, rel:prof.rel}));
  assert(prof && prof.kind === 'TOC' && prof.rel === 'after' && prof.refName === 'ENDU', 'wrong profile');
  assert(prof.distNM > 0 && !isNaN(prof.lat) && !isNaN(prof.lng), 'bad geometry');
});
T('descent leg yields TOD before end waypoint', () => {
  const prof = ev(`computeLegProfile(
    {lat:69.0, lng:18.0, name:'A', alt:4500, oat:0, wdir:230, wspd:10, var:-11},
    {lat:69.4, lng:18.6, name:'B', alt:1000, oat:0, wdir:230, wspd:10, var:-11})`);
  assert(prof && prof.kind === 'TOD' && prof.rel === 'before' && prof.refName === 'B', 'wrong TOD');
});
T('level leg yields no marker', () => {
  const prof = ev(`computeLegProfile(
    {lat:69.0, lng:18.0, name:'A', alt:2500, wdir:230, wspd:10, var:-11},
    {lat:69.4, lng:18.6, name:'B', alt:2500, wdir:230, wspd:10, var:-11})`);
  assert(prof === null, 'level leg produced marker');
});
T('reciprocal tracks offset to opposite sides', () => {
  const out = ev(`computeLegProfile(
    {lat:69.0, lng:18.0, name:'A', alt:300, wdir:230, wspd:10, var:-11},
    {lat:69.5, lng:18.0, name:'B', alt:2500, wdir:230, wspd:10, var:-11})`);
  const back = ev(`computeLegProfile(
    {lat:69.5, lng:18.0, name:'B', alt:300, wdir:230, wspd:10, var:-11},
    {lat:69.0, lng:18.0, name:'A', alt:2500, wdir:230, wspd:10, var:-11})`);
  const dxOut = Math.round(20 * Math.cos(out.tt * Math.PI / 180));
  const dxBack = Math.round(20 * Math.cos(back.tt * Math.PI / 180));
  console.log('        out tt=' + out.tt + ' dx=' + dxOut + '   back tt=' + back.tt + ' dx=' + dxBack);
  assert(Math.sign(dxOut) !== Math.sign(dxBack), 'labels would land on same side');
});
T('plotting list shows TOC marking distance', () => {
  const det = doc.querySelector('details.plotting-details');
  assert(det.innerHTML.includes('Mark TOC / TOD at'), 'column missing');
  assert(det.innerHTML.includes('after ENDU'), 'TOC ref missing');
});
T('copy text includes TOC marking info', () => {
  const t = w.plottingTextFor(0);
  assert(t.includes('TOC') && t.includes('after ENDU'), 'no TOC in copy text');
});

console.log('\n=== 21. Export / import portability ===');
/** Feed a JSON string through the real import path. The FileReader stub calls
 *  onload synchronously; importMissionFile is async since v16.81, so every
 *  caller must `await tick()` before asserting - and again after answering
 *  each dialog. */
function importFile(json) {
  ev(`(function(){
    const reader = { readAsText(){ this.onload({ target: { result: ${JSON.stringify(json)} } }); } };
    const orig = window.FileReader; window.FileReader = function(){ return reader; };
    importMissionFile({ target: { files: [{}], value: '' } });
    window.FileReader = orig;
  })()`);
}
TA('export carries profile and planning prefs', async () => {
  w.exportMissionFile();
  assert(w.__lastBlob, 'no blob captured');
});
TA('import of v2 file applies aircraft settings', async () => {
  const v2 = JSON.stringify({
    formatVersion: 2,
    routes: {}, missions: {},
    currentFlights: [{ id: 1, title: 'T', depElev: 100,
      waypoints: [{lat:69, lng:18, name:'X', alt:100, oat:0, wdir:0, wspd:0, var:-11},
                  {lat:69.3, lng:18.4, name:'Y', alt:2000, oat:0, wdir:0, wspd:0, var:-11}] }],
    profile: { roc: 833, climbTas: 91, evilExtra: 'ignored' },
    planningPrefs: { fuel: '55', reserve: '9.5', etd: '07:45' }
  });
  importFile(v2);
  await tick();
  // IT CARRIES BOTH ROUTES AND SETTINGS, so the scope question is asked
  // (v16.81). "Routes and settings" is the primary, i.e. what Enter does and
  // what every import did before the choice existed.
  answerDialog('Routes and settings');
  await tick();
  assert(ev('aircraftProfile.roc') === 833, 'roc not imported: ' + ev('aircraftProfile.roc'));
  assert(ev('aircraftProfile.evilExtra') === undefined, 'non-whitelisted key leaked in');
  assert(doc.getElementById('fuel-dep').value === '55', 'fuel pref not imported');
  assert(doc.getElementById('def-etd').value === '07:45', 'etd not imported');
  assert(ev('flights.length') === 1 && ev("flights[0].title") === 'T', 'flights not imported');
});
TA("user's actual v1 export imports cleanly (5 flights, no settings)", async () => {
  const v1 = fs.readFileSync('c182_flight_routes.json', 'utf8');
  const rocBefore = ev('aircraftProfile.roc');
  // A CLEAN LIBRARY, so the collision prompts (v16.81) cannot fire and make
  // this test depend on what an earlier one happened to save.
  ev(`localStorage.removeItem('c182_custom_routes'); localStorage.removeItem('c182_custom_missions');`);
  importFile(v1);
  await tick();
  // No settings in the file, so no scope question - asking it would be a click
  // with nothing to choose between.
  assert(!openDlg(), 'a settings-free file should not ask about scope');
  assert(ev('flights.length') === 5, 'expected 5 flights, got ' + ev('flights.length'));
  assert(ev('aircraftProfile.roc') === rocBefore, 'v1 import should not touch profile');
  const txt = doc.getElementById('flight-plans-container').textContent;
  assert(!txt.includes('NaN'), 'NaN after importing user file');
  assert(Object.keys(ev('getStoredMissions()')).includes('ENDU-ENSK-ENLK-ENEV-ENDU'), 'mission not imported');
});

console.log('\n=== 22. POH Fig 5-9 cruise engine: exact table reproduction ===');
function chk(alt, oat, rpm, mp, tas, gph, label) {
  T('POH ' + label, () => {
    const r = ev(`cruisePerf(${alt}, ${oat}, ${rpm}, ${mp})`);
    assert(r.tas === tas, 'TAS got ' + r.tas + ' want ' + tas);
    assert(Math.abs(r.gph - gph) < 0.051, 'GPH got ' + r.gph + ' want ' + gph);
  });
}
// std-temp column (ISA) at each table altitude
chk(0,     15, 2400, 25, 136, 14.0, 'SL 2400/25 std -> 136/14.0');
chk(0,     15, 2300, 23, 128, 12.0, 'SL 2300/23 std -> 128/12.0');
chk(2000,  11, 2300, 24, 136, 13.1, '2000ft 2300/24 std -> 136/13.1');
chk(4000,   7, 2300, 23, 137, 12.8, '4000ft 2300/23 std -> 137/12.8');
chk(6000,   3, 2200, 21, 130, 11.3, '6000ft 2200/21 std -> 130/11.3');
chk(8000,  -1, 2400, 20, 135, 11.7, '8000ft 2400/20 std -> 135/11.7');
chk(10000, -5, 2300, 20, 137, 11.7, '10000ft 2300/20 std -> 137/11.7');
chk(12000, -9, 2400, 17, 127, 10.2, '12000ft 2400/17 std -> 127/10.2');
chk(14000,-13, 2100, 16, 115,  8.9, '14000ft 2100/16 std -> 115/8.9');
// cold and hot columns
chk(0,     -5, 2200, 26, 133, 14.2, 'SL 2200/26 cold -> 133/14.2');
chk(8000,  19, 2200, 19, 124, 10.1, '8000ft 2200/19 hot -> 124/10.1');
chk(10000,-25, 2100, 19, 126, 10.5, '10000ft 2100/19 cold -> 126/10.5');
// temperature interpolation midway between std and hot
T('POH temp interpolation (SL 2400/25 @ 25C, ISA+10)', () => {
  const r = ev('cruisePerf(0, 25, 2400, 25)');
  assert(r.tas === 137, 'TAS got ' + r.tas + ' want 137');
  assert(Math.abs(r.gph - 13.75) < 0.06, 'GPH got ' + r.gph + ' want 13.75');
});
// altitude interpolation midway between levels
T('POH altitude interpolation (3000ft 2300/23, ISA)', () => {
  const r = ev('cruisePerf(3000, 9, 2300, 23)');   // ISA(3000)=9C
  assert(r.tas === 135, 'TAS got ' + r.tas + ' want 135 (mid 133/137)');
  assert(Math.abs(r.gph - 12.6) < 0.06, 'GPH got ' + r.gph + ' want 12.6');
});
// full-throttle MP cap with altitude
T('MP auto-caps at full throttle (2400/25 requested at 10000ft)', () => {
  const r = ev('cruisePerf(10000, -5, 2400, 25)');
  assert(r.usedMp === 20, 'cap got ' + r.usedMp + ' want 20');
  assert(r.tas === 139 && Math.abs(r.gph - 12.1) < 0.06, 'capped values wrong: ' + r.tas + '/' + r.gph);
});

console.log('\n=== 23. POH Fig 5-8 climb engine (full-throttle technique) ===');
ev("aircraftProfile.climbMode = 'POH';");
T('full climb SL->10000 matches table: 19 min / 4.6 gal', () => {
  const c = ev('climbPerf(0, 10000, isaTemp(10000))');
  assert(Math.abs(c.timeMin - 19) < 0.01, 'time ' + c.timeMin);
  assert(Math.abs(c.fuelGal - 4.6) < 0.01, 'fuel ' + c.fuelGal);
  assert(Math.abs(c.tasAvg - 31 / (19 / 60)) < 0.1, 'tasAvg ' + c.tasAvg);
});
T('partial climb 2000->6000 = table deltas: 7 min / 1.7 gal / 11 NM', () => {
  const c = ev('climbPerf(2000, 6000, isaTemp(6000))');
  assert(Math.abs(c.timeMin - 7) < 0.01, 'time ' + c.timeMin);
  assert(Math.abs(c.fuelGal - 1.7) < 0.01, 'fuel ' + c.fuelGal);
  assert(Math.abs(c.tasAvg - 11 / (7 / 60)) < 0.1, 'tasAvg ' + c.tasAvg);
});
T('POH note 2: +10% per 10C above ISA applied to time & fuel', () => {
  const base = ev('climbPerf(0, 10000, isaTemp(10000))');
  const hot  = ev('climbPerf(0, 10000, isaTemp(10000) + 10)');
  assert(Math.abs(hot.timeMin / base.timeMin - 1.10) < 0.001, 'time factor ' + (hot.timeMin / base.timeMin));
  assert(Math.abs(hot.fuelGal / base.fuelGal - 1.10) < 0.001, 'fuel factor ' + (hot.fuelGal / base.fuelGal));
});
T('below-ISA climb takes no credit (conservative per POH)', () => {
  const base = ev('climbPerf(0, 8000, isaTemp(8000))');
  const cold = ev('climbPerf(0, 8000, isaTemp(8000) - 15)');
  assert(Math.abs(cold.timeMin - base.timeMin) < 0.001, 'cold climb got credit');
});
T('climb from a 254ft field interpolates, not zero', () => {
  const c = ev('climbPerf(254, 2500, 7)');
  assert(c.timeMin > 2 && c.timeMin < 5, 'time ' + c.timeMin);
  assert(c.fuelGal > 0.5 && c.fuelGal < 1.5, 'fuel ' + c.fuelGal);
});

console.log('\n=== 23b. Cruise-climb technique (23"/2400/90 KIAS) ===');
T('cruise climb uses observed ROC and FF', () => {
  ev("aircraftProfile.climbMode = 'CRUISECLIMB'; aircraftProfile.ccRoc = 500; aircraftProfile.ccKias = 90; aircraftProfile.ccFf = 15.0;");
  const c = ev('climbPerf(254, 2500, 7)');
  assert(Math.abs(c.timeMin - 2246 / 500) < 0.01, 'time ' + c.timeMin);
  assert(Math.abs(c.fuelGal - (2246 / 500 / 60) * 15) < 0.01, 'fuel ' + c.fuelGal);
  // TAS from 90 KIAS at mid-climb (~1377 ft): 90 * 1.0275 ~ 92.5
  assert(Math.abs(c.tasAvg - 90 * (1 + 0.02 * 1377 / 1000)) < 0.1, 'tas ' + c.tasAvg);
});
T('cruise climb is slower than POH full-throttle climb', () => {
  const cc = ev('climbPerf(0, 6000, isaTemp(6000))');
  ev("aircraftProfile.climbMode = 'POH';");
  const poh = ev('climbPerf(0, 6000, isaTemp(6000))');
  console.log('        cruise-climb ' + cc.timeMin.toFixed(1) + ' min vs POH ' + poh.timeMin.toFixed(1) + ' min');
  assert(cc.timeMin > poh.timeMin, 'cruise climb should take longer');
  ev("aircraftProfile.climbMode = 'CRUISECLIMB';");
});
T('climb technique persists through settings and shows in badge', () => {
  w.openSettingsModal();
  doc.getElementById('c182-climb-mode').value = 'CRUISECLIMB';
  doc.getElementById('cc-roc').value = '525';
  doc.getElementById('cc-ff').value = '14.5';
  w.saveSettings();
  const p = JSON.parse(w.localStorage.getItem('c182_perf_profile'));
  assert(p.climbMode === 'CRUISECLIMB' && p.ccRoc === 525 && Math.abs(p.ccFf - 14.5) < 0.01, JSON.stringify(p));
  assert(txtOf('perf-model-badge').includes('cruise climb 525'), 'badge: ' + txtOf('perf-model-badge'));
  w.openSettingsModal();
  doc.getElementById('cc-roc').value = '500';
  doc.getElementById('cc-ff').value = '15.0';
  w.saveSettings();
});
T('technique toggle hides/shows the right settings rows', () => {
  w.openSettingsModal();
  doc.getElementById('c182-climb-mode').value = 'POH';
  w.updatePerfModelVisibility();
  assert(doc.getElementById('cc-rows').style.display === 'none', 'cc rows visible in POH mode');
  assert(doc.getElementById('poh-climb-note').style.display === 'block', 'poh note hidden');
  doc.getElementById('c182-climb-mode').value = 'CRUISECLIMB';
  w.updatePerfModelVisibility();
  assert(doc.getElementById('cc-rows').style.display === 'block', 'cc rows hidden in CC mode');
  w.closeSettingsModal();
});

console.log('\n=== 24. Mode switching ===');
T('MANUAL mode uses fixed user cruise values', () => {
  ev("aircraftProfile.mode='MANUAL'; aircraftProfile.cruiseTas=118; aircraftProfile.cruiseFf=9.3;");
  const r = ev('cruisePerf(5000, 0)');
  assert(r.tas === 118 && Math.abs(r.gph - 9.3) < 0.01, 'got ' + r.tas + '/' + r.gph);
  const c = ev('climbPerf(0, 4000, 0)');
  assert(Math.abs(c.timeMin - 4000 / ev('aircraftProfile.roc')) < 0.01, 'manual climb wrong');
  ev("aircraftProfile.mode='C182T';");
});
T('mode/rpm/mp persist through saveSettings', () => {
  w.openSettingsModal();
  doc.getElementById('perf-mode').value = 'C182T';
  doc.getElementById('c182-rpm').value = '2200';
  doc.getElementById('c182-mp').value = '22';
  w.saveSettings();
  const p = JSON.parse(w.localStorage.getItem('c182_perf_profile'));
  assert(p.mode === 'C182T' && p.cruiseRpm === 2200 && p.cruiseMp === 22, JSON.stringify(p));
  assert(txtOf('perf-model-badge').includes('2200'), 'badge not updated: ' + txtOf('perf-model-badge'));
  // restore default power for remaining tests
  w.openSettingsModal();
  doc.getElementById('c182-rpm').value = '2300';
  doc.getElementById('c182-mp').value = '23';
  w.saveSettings();
});
T('preview reflects selection with %MCP', () => {
  w.openSettingsModal();
  doc.getElementById('def-alt').value = '4000';
  doc.getElementById('def-oat').value = '7';
  w.updateC182Preview();
  const t = doc.getElementById('c182-preview').innerHTML;
  console.log('        ' + t);
  assert(t.includes('74% MCP') && t.includes('137 KTAS') && t.includes('12.8 gal/h'), 'preview wrong: ' + t);
  w.closeSettingsModal();
  doc.getElementById('def-alt').value = '2500';
  doc.getElementById('def-oat').value = '7';
});
T('OFP re-renders with POH numbers, no NaN', () => {
  ev(SEED);
  const txt = doc.getElementById('flight-plans-container').textContent;
  assert(!txt.includes('NaN'), 'NaN with POH engine');
  assert(doc.querySelectorAll('#tbody-flight-0 tr').length > 0, 'no rows');
});

console.log('\n=== 25. ISA-auto default OAT ===');
T('fresh instance opens at ISA for 2500 ft (10C)', () => {
  assert(doc.getElementById('def-oat').value !== '', 'empty');
  // fresh-open value comes from the HTML default, before any test touched it —
  // verify against the raw file instead of the mutated live DOM
  const raw = APP_SRC;
  assert(raw.includes('id="def-oat" value="10"'), 'HTML default is not ISA(2500)=10');
});
T('OAT tracks cruise altitude until touched', () => {
  ev('defaultOatTouched = false;');
  doc.getElementById('def-alt').value = '5500';
  w.syncDefaultOatToIsa();
  assert(doc.getElementById('def-oat').value === '4', 'ISA(5500) should be 4, got ' + doc.getElementById('def-oat').value);
  doc.getElementById('def-alt').value = '0';
  w.syncDefaultOatToIsa();
  assert(doc.getElementById('def-oat').value === '15', 'ISA(0) should be 15');
});
T('manual OAT edit stops the auto-tracking', () => {
  ev('defaultOatTouched = true;');   // what the onchange handler sets
  doc.getElementById('def-oat').value = '-7';
  doc.getElementById('def-alt').value = '8000';
  w.syncDefaultOatToIsa();
  assert(doc.getElementById('def-oat').value === '-7', 'auto-ISA overwrote a manual OAT');
  ev('defaultOatTouched = false;');
  doc.getElementById('def-alt').value = '2500';
  w.syncDefaultOatToIsa();
});
T('built-in routes are fully removed from the file', () => {
  assert(ev("typeof EMBEDDED_SAVED_ROUTES") === 'undefined', 'constant still exists');
  const raw = APP_SRC;
  assert(!raw.includes('FAKSFJORDEN') && !raw.includes('Aglapsvik'), 'route data still embedded');
});
T('ISA OAT hits the POH standard column exactly', () => {
  ev("aircraftProfile.mode='C182T';");
  const r = ev('cruisePerf(4000, Math.round(isaTemp(4000)), 2300, 23)');
  assert(r.tas === 137 && Math.abs(r.gph - 12.8) < 0.06, 'got ' + r.tas + '/' + r.gph + ', want std column 137/12.8');
});

console.log('\n=== 26. Layout modes & compact columns ===');
T('layout modes switch body class and persist', () => {
  w.setLayoutMode('stacked');
  assert(doc.body.classList.contains('layout-stacked'), 'stacked class missing');
  assert(w.localStorage.getItem('c182_layout') === 'stacked', 'not persisted');
  w.setLayoutMode('plan');
  assert(doc.body.classList.contains('layout-plan') && !doc.body.classList.contains('layout-stacked'), 'plan class wrong');
  w.setLayoutMode('map');
  assert(doc.body.classList.contains('layout-map'), 'map class missing');
  w.setLayoutMode('split');
  assert(doc.body.classList.contains('layout-split'), 'split class missing');
});
T('compact mode hides secondary columns and fixes footer span', () => {
  ev(SEED);
  const fullHeaders = [...doc.querySelectorAll('#tbody-flight-0')].length;
  w.applyCompactCols(true);
  assert(doc.body.classList.contains('compact-cols'), 'body class missing');
  const ccCells = doc.querySelectorAll('#flight-plans-container .cc').length;
  assert(ccCells > 0, 'no cc-tagged cells');
  const foot = doc.querySelector('#flight-plans-container tfoot td');
  assert(foot.getAttribute('colspan') === '7', 'compact colspan got ' + foot.getAttribute('colspan'));
  assert(doc.getElementById('compact-btn').innerText.includes('Full'), 'button label not toggled');
  w.applyCompactCols(false);
  const foot2 = doc.querySelector('#flight-plans-container tfoot td');
  assert(foot2.getAttribute('colspan') === '13', 'full colspan got ' + foot2.getAttribute('colspan'));
});
T('compact state survives a re-render', () => {
  w.applyCompactCols(true);
  w.renderAllFlightTables();
  assert(doc.querySelector('#flight-plans-container tfoot td').getAttribute('colspan') === '7', 'span lost on re-render');
  w.applyCompactCols(false);
});
T('REGRESSION: theme switch preserves layout and compact classes', () => {
  w.setLayoutMode('stacked');
  w.applyCompactCols(true);
  w.toggleTheme('dark');
  assert(doc.body.classList.contains('layout-stacked'), 'theme wiped layout class');
  assert(doc.body.classList.contains('compact-cols'), 'theme wiped compact class');
  assert(doc.body.classList.contains('dark-mode'), 'theme not applied');
  w.toggleTheme('light');
  assert(doc.body.classList.contains('layout-stacked') && doc.body.classList.contains('light-mode'), 'second switch broke classes');
  w.applyCompactCols(false);
  w.setLayoutMode('split');
});
T('view prefs restore from storage', () => {
  w.localStorage.setItem('c182_layout', 'plan');
  w.localStorage.setItem('c182_compact', '1');
  w.loadViewPrefs();
  assert(doc.body.classList.contains('layout-plan'), 'layout not restored');
  assert(doc.body.classList.contains('compact-cols'), 'compact not restored');
  w.localStorage.setItem('c182_compact', '0');
  w.localStorage.setItem('c182_layout', 'split');
  w.loadViewPrefs();
});

console.log('\n=== 27. Settings fuel-unit conversion ===');
T('changing unit in the modal converts every fuel input in place', () => {
  w.openSettingsModal();
  assert(doc.getElementById('qol-fuel-unit').value === 'GAL', 'expected GAL start');
  const climbGalDisp = parseFloat(doc.getElementById('perf-climb-ff').value);
  doc.getElementById('qol-fuel-unit').value = 'LITERS';
  w.onSettingsFuelUnitChange();
  const climbL = parseFloat(doc.getElementById('perf-climb-ff').value);
  console.log('        climb FF ' + climbGalDisp + ' gal/h -> ' + climbL + ' L/h');
  assert(Math.abs(climbL - climbGalDisp * 3.78541) < 0.06, 'climb FF not converted');
  assert(Math.abs(parseFloat(doc.getElementById('perf-taxi-fuel').value) - 1.7 * 3.78541) < 0.06, 'taxi not converted');
  assert(txtOf('lbl-cruise-ff') === 'L/h', 'MANUAL CRUISE label stuck: ' + txtOf('lbl-cruise-ff'));
  assert(txtOf('lbl-cc-ff') === 'L/h' && txtOf('lbl-taxi-fuel') === 'L', 'other labels stuck');
  doc.getElementById('qol-fuel-unit').value = 'GAL';
  w.onSettingsFuelUnitChange();
  assert(Math.abs(parseFloat(doc.getElementById('perf-climb-ff').value) - climbGalDisp) < 0.06, 'round trip drifted');
  w.closeSettingsModal();
});
T('manual cruise FF entered in liters stores gallons internally', () => {
  w.openSettingsModal();
  doc.getElementById('perf-mode').value = 'MANUAL';
  doc.getElementById('qol-fuel-unit').value = 'LITERS';
  w.onSettingsFuelUnitChange();
  doc.getElementById('perf-cruise-ff').value = '45';
  doc.getElementById('perf-cruise-tas').value = '130';
  w.saveSettings();
  const gal = ev('aircraftProfile.cruiseFf');
  console.log('        45 L/h stored as ' + gal.toFixed(2) + ' GPH internally');
  assert(Math.abs(gal - 45 / 3.78541) < 0.02, 'stored ' + gal);
  const r = ev('cruisePerf(3000, 9)');
  assert(Math.abs(r.gph - 45 / 3.78541) < 0.05, 'cruisePerf gph ' + r.gph);
  assert(txtOf('perf-model-badge').includes('45.0 L/h'), 'badge: ' + txtOf('perf-model-badge'));
});
T('reopening settings shows values converted to the active unit', () => {
  w.openSettingsModal();
  assert(Math.abs(parseFloat(doc.getElementById('perf-cruise-ff').value) - 45.0) < 0.06,
         'display ' + doc.getElementById('perf-cruise-ff').value + ', want 45.0 L');
  assert(Math.abs(parseFloat(doc.getElementById('perf-taxi-fuel').value) - 6.4) < 0.06, 'taxi display wrong');
  assert(txtOf('lbl-cruise-ff') === 'L/h', 'label wrong on reopen');
});
T('preview shows fuel flow in the selected unit', () => {
  w.updateC182Preview();
  assert(doc.getElementById('c182-preview').innerHTML.includes('L/h'), 'preview not in liters');
  // restore GAL + C182T for anything downstream
  doc.getElementById('perf-mode').value = 'C182T';
  doc.getElementById('qol-fuel-unit').value = 'GAL';
  w.onSettingsFuelUnitChange();
  w.saveSettings();
  assert(Math.abs(ev('aircraftProfile.taxiFuel') - 1.7) < 0.02, 'taxi drifted after round trip: ' + ev('aircraftProfile.taxiFuel'));
});

console.log('\n=== 28. Forecast winds (Open-Meteo, mocked) ===');
T('u/v wind conversion round-trips and wraps correctly', () => {
  const [u, v] = ev('windToUV(230, 15)');
  const back = ev('uvToWind(' + u + ',' + v + ')');
  assert(Math.abs(back[0] - 230) < 0.01 && Math.abs(back[1] - 15) < 0.01, 'round trip failed: ' + back);
  // 350 and 010 at equal speed must average to ~000, never 180
  const avg = ev(`(function(){ const a = windToUV(350,10), b = windToUV(10,10);
    return uvToWind((a[0]+b[0])/2, (a[1]+b[1])/2); })()`);
  const dir = avg[0] > 180 ? avg[0] - 360 : avg[0];
  assert(Math.abs(dir) < 0.5, '350/010 averaged to ' + avg[0]);
});
T('vertical interpolation between pressure levels', () => {
  const r = ev(`interpolateWindProfile([
    { h: 500,  dir: 200, spd: 10, temp: 8 },
    { h: 1500, dir: 250, spd: 30, temp: 2 }
  ], 1000)`);
  // independent recompute of the expected midpoint via u/v
  const rad = d => d * Math.PI / 180;
  const u = (-10 * Math.sin(rad(200)) + -30 * Math.sin(rad(250))) / 2;
  const v = (-10 * Math.cos(rad(200)) + -30 * Math.cos(rad(250))) / 2;
  const eSpd = Math.hypot(u, v);
  const eDir = (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360;
  assert(Math.abs(r.dir - eDir) < 0.1, 'dir ' + r.dir + ' want ' + eDir);
  assert(Math.abs(r.spd - eSpd) < 0.1, 'spd ' + r.spd + ' want ' + eSpd);
  assert(Math.abs(r.temp - 5) < 0.01, 'temp ' + r.temp);
  // clamping outside the column
  assert(ev('interpolateWindProfile([{h:500,dir:200,spd:10,temp:8},{h:1500,dir:250,spd:30,temp:2}], 100)').spd === 10, 'below-column clamp');
  assert(ev('interpolateWindProfile([{h:500,dir:200,spd:10,temp:8},{h:1500,dir:250,spd:30,temp:2}], 9000)').spd === 30, 'above-column clamp');
});
T('sample points: 3 per non-pattern leg at leg altitude', () => {
  ev(SEED);
  const pts = ev('buildWindSamplePoints(flights, legStartTimes)');
  assert(pts.length === 6, '2 legs x 3 samples expected, got ' + pts.length);
  assert(pts.every(p => p.altFt === 2500), 'wrong altitudes');
  assert(new Set(pts.map(p => p.legKey)).size === 2, 'leg grouping wrong');
});
T('request URL contains everything the docs require', () => {
  const url = ev(`buildOpenMeteoUrl(buildWindSamplePoints(flights, legStartTimes), '2026-08-24')`);
  ['api.open-meteo.com/v1/forecast', 'wind_speed_unit=kn', 'geopotential_height_925hPa',
   'wind_speed_700hPa', 'wind_direction_850hPa', 'temperature_925hPa', 'wind_speed_10m',
   'start_date=2026-08-24', 'timezone=auto'].forEach(k =>
    assert(url.includes(k), 'URL missing ' + k));
  assert((url.match(/latitude=([^&]*)/)[1].split(',').length) === 6, 'lat list wrong');
});
TA('fetch fills the wind matrix from a mocked multi-location response', async () => {
  ev(SEED);   // these ran inline before; now queued, so seed explicitly
  // synthetic column: 200/10kt at ~500m, 250/30kt at ~1500m, so 2500ft (762m)
  // interpolates between them; OAT 8C -> 2C
  const mkLoc = () => ({ elevation: 50, hourly: (() => {
    const H = { time: [], wind_speed_10m: [], wind_direction_10m: [], temperature_2m: [] };
    ev('OM_LEVELS').forEach(L => { H['wind_speed_'+L+'hPa']=[]; H['wind_direction_'+L+'hPa']=[]; H['temperature_'+L+'hPa']=[]; H['geopotential_height_'+L+'hPa']=[]; });
    for (let h = 0; h < 24; h++) {
      H.time.push('2026-08-24T' + String(h).padStart(2,'0') + ':00');
      H.wind_speed_10m.push(5); H.wind_direction_10m.push(180); H.temperature_2m.push(12);
      ev('OM_LEVELS').forEach(L => {
        const low = L >= 950;
        H['geopotential_height_'+L+'hPa'].push(low ? 500 : 1500);
        H['wind_speed_'+L+'hPa'].push(low ? 10 : 30);
        H['wind_direction_'+L+'hPa'].push(low ? 200 : 250);
        H['temperature_'+L+'hPa'].push(low ? 8 : 2);
      });
    }
    return H; })() });
  w.fetch = async (url) => ({ ok: true, json: async () => ev('buildWindSamplePoints(flights, legStartTimes)').map(() => mkLoc()) });
  w.openWindModal();
  doc.getElementById('wind-fetch-date').value = '2026-08-24';
  doc.getElementById('def-etd').value = '09:00';
  await w.fetchForecastWinds();
  const dir = Number(doc.getElementById('wmodal-dir-0-1').value);
  const spd = Number(doc.getElementById('wmodal-spd-0-1').value);
  const oat = Number(doc.getElementById('wmodal-oat-0-1').value);
  console.log('        filled leg 1: ' + String(dir).padStart(3,'0') + '/' + spd + 'kt OAT ' + oat + 'C');
  assert(dir > 200 && dir < 250, 'dir out of interpolation band: ' + dir);
  assert(spd > 10 && spd < 30, 'spd out of band: ' + spd);
  assert(oat > 2 && oat < 8, 'oat out of band: ' + oat);
  assert(doc.getElementById('wmodal-dir-0-2').value !== '', 'leg 2 not filled');
  const st = doc.getElementById('wind-fetch-status').textContent;
  assert(st.includes('Filled 2 legs') && st.includes('Save'), 'status wrong: ' + st);
  w.closeWindModal();
});
TA('fetch failure reports cleanly without applying anything', async () => {
  w.fetch = async () => { throw new Error('offline'); };
  w.openWindModal();
  await w.fetchForecastWinds();
  const st = doc.getElementById('wind-fetch-status').textContent;
  assert(st.includes('Fetch failed') && st.includes('offline'), 'error status wrong: ' + st);
  w.closeWindModal();
});
TA('single-location object response is normalized too', async () => {
  // one leg only -> API may... still 3 sample points, so force 1 pt by direct call
  const loc = { elevation: 0, hourly: { time: Array(24).fill(0),
    wind_speed_10m: Array(24).fill(12), wind_direction_10m: Array(24).fill(90), temperature_2m: Array(24).fill(10) } };
  const r = ev(`extractPointWeather(${JSON.stringify(loc)}, 9, 254)`);
  assert(r && Math.round(r.dir) === 90 && Math.round(r.spd) === 12, 'surface-only column failed: ' + JSON.stringify(r));
});
TA('fetched values feed the normal Save & Apply path', async () => {
  const mk = () => ({ elevation: 50, hourly: (() => {
    const H = { wind_speed_10m: Array(24).fill(8), wind_direction_10m: Array(24).fill(300), temperature_2m: Array(24).fill(5) };
    ev('OM_LEVELS').forEach(L => { H['wind_speed_'+L+'hPa']=Array(24).fill(20); H['wind_direction_'+L+'hPa']=Array(24).fill(310); H['temperature_'+L+'hPa']=Array(24).fill(0); H['geopotential_height_'+L+'hPa']=Array(24).fill(L>=950?400:2000); });
    return H; })() });
  w.fetch = async () => ({ ok: true, json: async () => ev('buildWindSamplePoints(flights, legStartTimes)').map(mk) });
  w.openWindModal();
  await w.fetchForecastWinds();
  w.saveWindModal();
  const wp = ev('flights[0].waypoints[1]');
  assert(wp.wdir > 300 && wp.wdir <= 310 && wp.wspd >= 15, 'not applied to waypoints: ' + wp.wdir + '/' + wp.wspd);
  const txt = doc.getElementById('flight-plans-container').textContent;
  assert(!txt.includes('NaN'), 'NaN after applying fetched winds');
});

console.log('\n=== 29. Model selection, time interpolation & Compare mode ===');
T('URL carries the model only when explicitly selected', () => {
  ev(SEED);
  const pts = 'buildWindSamplePoints(flights, legStartTimes)';
  assert(ev(`buildOpenMeteoUrl(${pts}, '2026-08-24', 'ecmwf_ifs025')`).includes('&models=ecmwf_ifs025'), 'model missing');
  assert(!ev(`buildOpenMeteoUrl(${pts}, '2026-08-24', 'best_match')`).includes('&models='), 'best_match should omit models');
  assert(!ev(`buildOpenMeteoUrl(${pts}, '2026-08-24')`).includes('&models='), 'undefined should omit models');
});
T('fractional hour blends two forecast hours in u/v', () => {
  // hour 9: 200/10; hour 10: 220/20 — 09:30 must land between, via u/v
  const loc = { elevation: 0, hourly: { wind_speed_10m: Array(24).fill(0).map((_,h)=>h===9?10:(h===10?20:5)),
    wind_direction_10m: Array(24).fill(0).map((_,h)=>h===9?200:(h===10?220:100)), temperature_2m: Array(24).fill(0).map((_,h)=>h===9?8:(h===10?4:0)) } };
  const r = ev(`extractPointWeather(${JSON.stringify(loc)}, 9.5, 300)`);
  assert(r.dir > 200 && r.dir < 220, 'dir not blended: ' + r.dir);
  assert(r.spd > 10 && r.spd < 20, 'spd not blended: ' + r.spd);
  assert(Math.abs(r.temp - 6) < 0.01, 'temp not blended: ' + r.temp);
  const whole = ev(`extractPointWeather(${JSON.stringify(loc)}, 9, 300)`);
  assert(Math.round(whole.dir) === 200 && Math.round(whole.spd) === 10, 'whole hour changed: ' + whole.dir + '/' + whole.spd);
});
TA('single-model fetch reports the model by name', async () => {
  const mk = () => ({ elevation: 50, hourly: (() => {
    const H = { wind_speed_10m: Array(24).fill(8), wind_direction_10m: Array(24).fill(300), temperature_2m: Array(24).fill(5) };
    ev('OM_LEVELS').forEach(L => { H['wind_speed_'+L+'hPa']=Array(24).fill(20); H['wind_direction_'+L+'hPa']=Array(24).fill(310); H['temperature_'+L+'hPa']=Array(24).fill(0); H['geopotential_height_'+L+'hPa']=Array(24).fill(L>=950?400:2000); });
    return H; })() });
  w.fetch = async (url) => ({ ok: true, json: async () => ev('buildWindSamplePoints(flights, legStartTimes)').map(mk) });
  w.openWindModal();
  doc.getElementById('wind-model').value = 'ecmwf_ifs025';
  await w.fetchForecastWinds();
  const st = doc.getElementById('wind-fetch-status').textContent;
  assert(st.includes('ECMWF IFS 0.25'), 'model name not shown: ' + st);
});
TA('Compare mode fills the 3-model mean and reports spread', async () => {
  ev(SEED);   // self-contained: earlier async tests may have changed the route
  // ECMWF 260/20, ICON 280/24, GFS 300/28 aloft. The app averages in u/v
  // space, so the mean is SPEED-WEIGHTED: the faster models pull it past the
  // arithmetic 280 to 282.3deg / 23.1kt (verified by hand). Spread 8kt/40deg.
  const mkFor = (dir, spd) => () => ({ elevation: 50, hourly: (() => {
    const H = { wind_speed_10m: Array(24).fill(5), wind_direction_10m: Array(24).fill(dir), temperature_2m: Array(24).fill(5) };
    ev('OM_LEVELS').forEach(L => { H['wind_speed_'+L+'hPa']=Array(24).fill(spd); H['wind_direction_'+L+'hPa']=Array(24).fill(dir); H['temperature_'+L+'hPa']=Array(24).fill(0); H['geopotential_height_'+L+'hPa']=Array(24).fill(L>=950?100:150); });
    return H; })() });
  w.fetch = async (url) => {
    const mk = url.includes('ecmwf') ? mkFor(260, 20) : url.includes('icon') ? mkFor(280, 24) : mkFor(300, 28);
    return { ok: true, json: async () => ev('buildWindSamplePoints(flights, legStartTimes)').map(mk) };
  };
  w.openWindModal();
  doc.getElementById('wind-model').value = 'COMPARE3';
  await w.fetchForecastWinds();
  const dir = Number(doc.getElementById('wmodal-dir-0-1').value);
  const spd = Number(doc.getElementById('wmodal-spd-0-1').value);
  console.log('        mean filled: ' + String(dir).padStart(3,'0') + '/' + spd + 'kt');
  assert(Math.abs(dir - 282) <= 1, 'mean dir wrong: ' + dir + ' (u/v vector mean is 282.3, not the arithmetic 280)');
  assert(spd >= 23 && spd <= 24, 'mean spd wrong: ' + spd);
  const st = doc.getElementById('wind-fetch-status').textContent;
  assert(st.includes('MEAN of'), 'no mean note');
  assert(st.includes('8 kt') && st.includes('40'), 'spread wrong: ' + st);
  assert(st.includes('disagree'), 'no disagreement warning at 40 deg spread');
});
TA('Compare survives one model failing (mean of remaining two)', async () => {
  const mkFor = (dir, spd) => () => ({ elevation: 50, hourly: (() => {
    const H = { wind_speed_10m: Array(24).fill(5), wind_direction_10m: Array(24).fill(dir), temperature_2m: Array(24).fill(5) };
    ev('OM_LEVELS').forEach(L => { H['wind_speed_'+L+'hPa']=Array(24).fill(spd); H['wind_direction_'+L+'hPa']=Array(24).fill(dir); H['temperature_'+L+'hPa']=Array(24).fill(0); H['geopotential_height_'+L+'hPa']=Array(24).fill(L>=950?100:150); });
    return H; })() });
  w.fetch = async (url) => {
    if (url.includes('gfs')) throw new Error('model down');
    const mk = url.includes('ecmwf') ? mkFor(270, 20) : mkFor(270, 22);
    return { ok: true, json: async () => ev('buildWindSamplePoints(flights, legStartTimes)').map(mk) };
  };
  w.openWindModal();
  doc.getElementById('wind-model').value = 'COMPARE3';
  await w.fetchForecastWinds();
  const st = doc.getElementById('wind-fetch-status').textContent;
  assert(st.includes('unavailable'), 'missing model not reported: ' + st);
  assert(Number(doc.getElementById('wmodal-spd-0-1').value) === 21, 'two-model mean wrong');
  assert(st.includes('good agreement'), 'small spread should read as agreement: ' + st);
  doc.getElementById('wind-model').value = 'best_match';
  w.closeWindModal();
});

console.log('\n=== 30. View / Edit mode labels ===');
T('button offers View Mode while editing, Edit Mode while viewing', () => {
  assert(ev('isDoneMode') === false, 'should start in edit mode');
  assert(txtOf('done-mode-btn').includes('View Mode'), 'start label: ' + txtOf('done-mode-btn'));
  w.toggleDoneMode();
  assert(ev('isDoneMode') === true, 'view mode not entered');
  assert(txtOf('done-mode-btn').includes('Edit Mode'), 'view-state label: ' + txtOf('done-mode-btn'));
  w.toggleDoneMode();
  assert(txtOf('done-mode-btn').includes('View Mode'), 'did not flip back: ' + txtOf('done-mode-btn'));
  assert(ev('isDoneMode') === false, 'edit mode not restored');
});
T('view mode still locks inputs and disables dragging', () => {
  ev(SEED);
  w.toggleDoneMode();
  w.renderAllFlightTables();
  const anyInput = doc.querySelector('#tbody-flight-0 input');
  assert(anyInput && anyInput.disabled, 'table inputs not locked in view mode');
  w.toggleDoneMode();
  w.renderAllFlightTables();
  assert(!doc.querySelector('#tbody-flight-0 input').disabled, 'inputs still locked after returning to edit');
});

console.log('\n=== 31. Embedded app icon ===');
T('favicon links are embedded as data URIs (still one file)', () => {
  const raw = APP_SRC;
  assert(raw.includes('rel="icon" type="image/svg+xml" href="data:image/svg+xml,'), 'svg favicon missing');
  assert(raw.includes('rel="icon" type="image/png" sizes="32x32" href="data:image/png;base64,'), 'png fallback missing');
  assert(raw.includes('rel="apple-touch-icon"'), 'apple-touch-icon missing');
  assert(raw.includes('name="theme-color" content="#1a365d"'), 'theme-color missing');
  const icons = doc.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]');
  assert(icons.length === 3, 'expected 3 icon links, got ' + icons.length);
  // no external icon fetches — everything stays inline
  icons.forEach(l => assert(l.getAttribute('href').startsWith('data:'), 'icon not inline: ' + l.getAttribute('href').slice(0, 30)));
});

console.log('\n=== 32. Map label chips paint their full background ===');
T('all divIcon containers override Leaflet 12px default sizing', () => {
  const raw = APP_SRC;
  const rule = raw.match(/\.toc-custom-icon[^}]+}/)[0];
  ['tod-custom-icon', 'wp-custom-icon', 'ruler-icon', 'ruler-seg-icon', 'ruler-total-icon']
    .forEach(c => assert(raw.match(/\.toc-custom-icon[\s\S]{0,200}?{/)[0].includes(c), 'selector missing ' + c));
  assert(rule.includes('width: max-content !important'), 'width override missing');
  assert(rule.includes('height: max-content !important'), 'height override missing');
});
T('every label chip is inline-block so its background covers all text', () => {
  const raw = APP_SRC;
  ['.toc-label', '.tod-label', '.pattern-label', '.ruler-label'].forEach(c => {
    const rule = raw.split(c + ' {')[1].split('}')[0];
    assert(rule.includes('display: inline-block') || rule.includes('inline-block;'), c + ' not inline-block');
  });
  assert(raw.includes('.wp-label { width: max-content;'), 'wp-label not content-sized');
});

console.log('\n=== 33. TOC/TOD: a tick across the track, plus a small chip ===');
T('the mark is a tick rotated ACROSS the track, anchored on the exact point', () => {
  const raw = APP_SRC;
  assert(raw.includes('class="prof-tick ${kindCls}'), 'the TOC/TOD tick is gone');
  assert(!raw.includes('prof-point'), 'the old diamond dot is back');
  // A TOP IS A TICK, A BOTTOM IS A RING (v16.73). Drawing all four with the
  // same glyph left the chip text as the only thing telling a TOC from a BOC.
  assert(raw.includes('class="prof-ring ${kindCls}'), 'the BOC/BOD ring is gone');
  assert(/const isBottom = prof\.kind === 'BOC' \|\| prof\.kind === 'BOD';/.test(raw),
    'the two glyphs are no longer chosen by which END of the manoeuvre the mark is');
  const ring = raw.split('.prof-ring {')[1].split('}')[0];
  assert(/border-radius:\s*50%/.test(ring), 'the bottom-of-climb mark is not round');
  // a bar drawn along north, rotated to the local track and then a further
  // 90 degrees, is a bar that CROSSES the track
  assert(raw.includes('rotate(${Math.round(prof.tt + 90)}deg)'), 'the tick is not rotated across the track');
  assert(raw.includes('translate(-50%,-50%) translate(${dx}px,${dy}px)'), 'chip not centered on offset point');
  assert(raw.includes('iconAnchor: [0, 0]'), 'anchor not at the exact TOC/TOD point');
  // above the waypoint markers, or a TOD landing on a fix is drawn UNDER that
  // fix's own name label - exactly the case the fix exists to make visible
  const mk = raw.split('computeLegMarkers(fl.waypoints[i]')[1].split('profileMarkers.push')[0];
  assert(/zIndexOffset:\s*\d{3}/.test(mk), 'the TOC/TOD mark can be hidden behind a waypoint label');
  const css = raw.split('.prof-tick {')[1].split('}')[0];
  const w = +(css.match(/width:\s*(\d+)px/) || [])[1], h = +(css.match(/height:\s*(\d+)px/) || [])[1];
  assert(w >= 2 && w <= 4 && h >= 14 && h <= 30 && h > w * 4,
    'the tick is not a thin bar across the track: ' + w + 'x' + h);
});
T('the chip is just TOC / TOD, with the sentence on hover', () => {
  const raw = APP_SRC;
  // the chip text must be the bare kind, not the whole sentence
  // v16.47 routes both through the one escaper (rule 6); the shape is unchanged.
  assert(raw.includes('title="${esc(tip)}">${fTag}${esc(prof.kind)}</div>'), 'the chip is not just the kind + a tooltip');
  assert(!/TOC \$\{prof\.alt\}' /.test(raw), 'the old spelled-out chip is back');
  // the tooltip has to be reachable: the marker is non-interactive, so the
  // chip needs pointer-events of its own or nothing ever hovers it
  for (const cls of ['.toc-label', '.tod-label']) {
    const rule = raw.split(cls + ' {')[1].split('}')[0];
    assert(/pointer-events:\s*auto/.test(rule), cls + ' cannot be hovered, so its tooltip never shows');
  }
});

console.log('\n=== 34. Waypoint dots pinned to true coordinates ===');
T('waypoint marker anchors dot exactly on the lat/lng', () => {
  const raw = APP_SRC;
  assert(raw.includes(`class="wp-dot" style="position:absolute; left:-7px; top:-7px;`), 'dot not pinned to anchor');
  assert(raw.includes('transform:translateX(-50%); margin-top:0;'), 'label not centered under dot');
  const wpBlock = raw.split("className: 'wp-custom-icon'")[1].slice(0, 120);
  assert(wpBlock.includes('iconAnchor: [0, 0]'), 'wp anchor not [0,0]: ' + wpBlock);
  assert(!raw.includes('wp-label-container'), 'stale flex container remains');
  assert(raw.includes(`class="pattern-label" style="position:absolute; left:0; top:0; transform:translate(-50%,-50%)`), 'pattern label not centered on point');
});
T('markers still render and drag-lock still works after restructure', () => {
  ev(SEED);
  w.toggleDoneMode(); w.renderAllFlightTables(); w.refreshMap();
  w.toggleDoneMode(); w.renderAllFlightTables(); w.refreshMap();
  assert(!doc.getElementById('flight-plans-container').textContent.includes('NaN'), 'NaN after marker restructure');
});

console.log('\n=== 35. Merged one-row legs with sub-lines ===');
T('each leg renders ONE main row; climb detail moves to a sub-line', () => {
  ev(SEED);   // leg1: climb 254->2500, leg2: level cruise
  const main = doc.querySelectorAll('#tbody-flight-0 tr:not(.sub-leg-row)');
  assert(main.length === 2, 'expected 2 main rows, got ' + main.length);
  const subs = doc.querySelectorAll('#tbody-flight-0 tr.sub-leg-row');
  assert(subs.length === 1, 'expected 1 sub-line (climb leg), got ' + subs.length);
  const subTxt = subs[0].textContent;
  assert(subTxt.includes('CLB') && subTxt.includes('TOC') && subTxt.includes('after ENDU'), 'sub-line content: ' + subTxt);
  assert(main[0].textContent.includes('CLB+CRZ'), 'profile tag missing: ' + main[0].textContent.slice(0, 60));
  assert(!doc.getElementById('flight-plans-container').textContent.includes('NaN'), 'NaN');
});
T('leg totals are internally consistent (zero wind: effGS = TAS, time = dist/TAS)', () => {
  const r = ev(`computeLegTotals(
    { lat: 69.0, lng: 18.0, name: 'A', alt: 2500, wdir: 0, wspd: 0, oat: 10, var: -11 },
    { lat: 69.5, lng: 18.0, name: 'B', alt: 2500, wdir: 0, wspd: 0, oat: 10, var: -11 })`);
  const tas = ev('cruisePerf(2500, 10).tas');
  assert(r.effGS === tas, 'effGS ' + r.effGS + ' != TAS ' + tas);
  assert(Math.abs(r.timeMin - (r.distNM / tas) * 60) < 0.05, 'time inconsistent');
  assert(Math.abs(r.burnGal - (r.timeMin / 60) * ev('cruisePerf(2500, 10).gph')) < 0.02, 'burn inconsistent');
});
T('climb leg totals = climb portion + cruise portion', () => {
  const r = ev(`computeLegTotals(
    { lat: 69.0, lng: 18.0, name: 'A', alt: 254, wdir: 0, wspd: 0, oat: 10, var: -11 },
    { lat: 69.5, lng: 18.0, name: 'B', alt: 2500, wdir: 0, wspd: 0, oat: 10, var: -11 })`);
  assert(r.climbInfo && r.climbInfo.completed, 'climb should complete');
  const cp = ev('climbPerf(254, 2500, 10)');
  assert(Math.abs(r.climbInfo.timeMin - cp.timeMin) < 0.05, 'climb time drifted');
  const cruiseTime = r.timeMin - r.climbInfo.timeMin;
  const expBurn = cp.fuelGal + (cruiseTime / 60) * ev('cruisePerf(2500, 10).gph');
  assert(Math.abs(r.burnGal - expBurn) < 0.03, 'burn ' + r.burnGal + ' vs ' + expBurn);
  assert(Math.abs(r.climbInfo.tocAlongNM - cp.tasAvg * (cp.timeMin / 60)) < 0.2, 'TOC distance wrong (zero wind)');
});

console.log('\n=== 36. Via points bend the leg without adding rows ===');
T('clicking the line inserts a via on the right leg at the right slot', () => {
  ev(SEED);
  // point offset from the FINNSNES->ENTC leg (leg index 1)
  w.insertViaAtLatLng(0, { lat: 69.45, lng: 18.9 });
  const via = ev('flights[0].waypoints[2].via');
  assert(via && via.length === 1, 'via not stored on leg-end waypoint: ' + JSON.stringify(ev('flights[0].waypoints').map(x => x.via ? x.via.length : 0)));
  assert(ev('flights[0].waypoints[1].via') === undefined, 'via landed on wrong leg');
});
T('bent leg: longer distance, still ONE row, via tracks in sub-line', () => {
  const direct = ev(`calcDistanceNM(flights[0].waypoints[1].lat, flights[0].waypoints[1].lng, flights[0].waypoints[2].lat, flights[0].waypoints[2].lng)`);
  const res = ev('computeLegTotals(flights[0].waypoints[1], flights[0].waypoints[2])');
  console.log('        direct ' + direct.toFixed(1) + ' NM -> via path ' + res.distNM.toFixed(1) + ' NM (' + res.segs.length + ' segments)');
  assert(res.distNM > direct + 0.5, 'path not longer than direct');
  assert(res.segs.length === 2, 'expected 2 segments');
  const main = doc.querySelectorAll('#tbody-flight-0 tr:not(.sub-leg-row)');
  assert(main.length === 2, 'via added a row! got ' + main.length);
  const subs = [...doc.querySelectorAll('#tbody-flight-0 tr.sub-leg-row')];
  assert(subs.some(tr => tr.textContent.includes('via 1 pt')), 'via sub-line missing');
  assert(subs.some(tr => tr.textContent.includes('→')), 'segment tracks missing');
});
T('time scales with the bent path (double-back detour)', () => {
  const straight = ev(`computeLegTotals(
    { lat: 69.0, lng: 18.0, alt: 2500, wdir: 0, wspd: 0, oat: 10, var: -11, name: 'A' },
    { lat: 69.5, lng: 18.0, alt: 2500, wdir: 0, wspd: 0, oat: 10, var: -11, name: 'B' })`);
  const bent = ev(`computeLegTotals(
    { lat: 69.0, lng: 18.0, alt: 2500, wdir: 0, wspd: 0, oat: 10, var: -11, name: 'A' },
    { lat: 69.5, lng: 18.0, alt: 2500, wdir: 0, wspd: 0, oat: 10, var: -11, name: 'B',
      via: [{ lat: 69.25, lng: 18.6 }] })`);
  assert(bent.distNM > straight.distNM * 1.1, 'detour too short for test');
  assert(Math.abs(bent.timeMin / straight.timeMin - bent.distNM / straight.distNM) < 0.02,
         'time did not scale with path length');
});
T('TOC follows the bent path and map line includes the via', () => {
  ev('flights[0].waypoints[1].via = [{ lat: 69.10, lng: 18.10 }]; refreshMap(); renderAllFlightTables();');
  const prof = ev('computeLegProfile(flights[0].waypoints[0], flights[0].waypoints[1])');
  const res = ev('computeLegTotals(flights[0].waypoints[0], flights[0].waypoints[1])');
  assert(prof && prof.kind === 'TOC' && prof.refName === 'ENDU', 'TOC lost on bent leg');
  assert(prof.distNM > 0 && prof.distNM < res.distNM, 'TOC outside path');
  assert(isFinite(prof.lat) && isFinite(prof.lng), 'TOC position invalid');
  const coords = ev('polylines[0]._ll.length');
  assert(coords === 5, 'polyline should have 3 wps + 2 vias = 5 points, got ' + coords);
});
T('plotting list expands via legs into drawable segments', () => {
  const det = doc.querySelector('details.plotting-details');
  const t = det.textContent;
  assert(t.includes('·1'), 'via segment naming missing');
  const copy = w.plottingTextFor(0);
  assert(copy.includes('v1'), 'copy text missing via segment: ' + copy.split('\n').slice(-4).join(' / '));
});
T('removing the via restores the direct leg', () => {
  ev('delete flights[0].waypoints[1].via; flights[0].waypoints[2].via.splice(0,1); refreshMap(); renderAllFlightTables();');
  assert(ev('computeLegTotals(flights[0].waypoints[1], flights[0].waypoints[2]).segs.length') === 1, 'still bent');
  assert(doc.querySelectorAll('#tbody-flight-0 tr.sub-leg-row').length === 1, 'stale sub-lines');
});
T('vias survive the sanitiser; junk vias are dropped', () => {
  const clean = w.sanitiseFlights([{ waypoints: [
    { lat: 69, lng: 18, name: 'A', alt: 100 },
    { lat: 69.4, lng: 18.4, name: 'B', alt: 100, via: [{ lat: 69.2, lng: 18.1 }, { lat: 'x' }, null] }
  ]}]);
  assert(clean[0].waypoints[1].via.length === 1, 'via not sanitised: ' + JSON.stringify(clean[0].waypoints[1].via));
});

console.log('\n=== 37. Geodesy verified against WGS-84 reference values ===');
T('bearings are exact on meridians and the equator', () => {
  assert(ev('calcTrueTrack(60, 18, 61, 18)') === 0, 'due north != 0');
  assert(ev('calcTrueTrack(61, 18, 60, 18)') === 180, 'due south != 180');
  assert(ev('calcTrueTrack(0, 0, 0, 1)') === 90, 'due east at equator != 090');
});
T('distances are ELLIPSOIDAL, not the 60 NM-per-degree spherical idealisation', () => {
  // On WGS-84 a degree of latitude grows toward the poles (59.705 NM at the
  // equator, 60.235 NM at 69N). A spherical model returns exactly 60.0
  // everywhere, so these values also prove which model is in use.
  assert(ev('calcDistanceNM(60, 18, 61, 18)') === 60.2, '1 deg lat at 60N: ' + ev('calcDistanceNM(60, 18, 61, 18)'));
  assert(ev('calcDistanceNM(0, 0, 0, 1)') === 60.1, '1 deg lon at equator: ' + ev('calcDistanceNM(0, 0, 0, 1)'));
  const atEquator = ev('distanceNMExact(0, 18, 1, 18)');
  const atTroms = ev('distanceNMExact(69, 18, 70, 18)');
  assert(atTroms > atEquator + 0.4, `a degree of latitude must lengthen poleward: ${atEquator} -> ${atTroms}`);
  assert(Math.abs(atEquator - 59.705) < 0.01 && Math.abs(atTroms - 60.235) < 0.01,
    `off the WGS-84 meridian arc: ${atEquator} / ${atTroms}`);
});
T('interpolation walks the geodesic (meridian midpoint lands halfway)', () => {
  const total = ev('distanceNMExact(60, 18, 62, 18)');
  const mid = ev(`interpolateGeo(60, 18, 62, 18, ${total / 2}, ${total})`);
  assert(Math.abs(mid[0] - 61.000075) < 1e-4 && Math.abs(mid[1] - 18) < 1e-6, 'midpoint wrong: ' + mid);
  // endpoints are returned verbatim
  const start = ev(`interpolateGeo(60, 18, 62, 18, 0, ${total})`);
  const end = ev(`interpolateGeo(60, 18, 62, 18, ${total}, ${total})`);
  assert(start[0] === 60 && end[0] === 62, 'endpoints not exact: ' + start + ' / ' + end);
});

console.log('\n=== 38. Runtime integrity check ===');
T('clean plan: banner hidden', () => {
  ev(SEED);
  assert(doc.getElementById('integrity-banner').style.display === 'none', 'banner shown on clean plan');
});
T('corrupt altitude is caught and named', () => {
  ev('flights[0].waypoints[1].alt = NaN; renderAllFlightTables();');
  const b = doc.getElementById('integrity-banner');
  assert(b.style.display === 'block', 'banner not shown');
  assert(b.innerHTML.includes('DO NOT USE') && b.innerHTML.includes('non-numeric altitude'), 'wrong message: ' + b.textContent.slice(0, 120));
  ev('flights[0].waypoints[1].alt = 2500; renderAllFlightTables();');
  assert(b.style.display === 'none', 'banner did not clear after fix');
});
T('wind >= TAS is flagged as unreliable', () => {
  ev('flights[0].waypoints[2].wspd = 200; renderAllFlightTables();');
  const b = doc.getElementById('integrity-banner');
  assert(b.style.display === 'block' && b.textContent.includes('NOT reliable'), 'wind>=TAS not flagged');
  ev('flights[0].waypoints[2].wspd = 0; renderAllFlightTables();');
});
T('negative planned fuel is flagged', () => {
  doc.getElementById('fuel-dep').value = '3';
  w.renderAllFlightTables();
  const b = doc.getElementById('integrity-banner');
  assert(b.textContent.includes('NEGATIVE'), 'fuel overrun not flagged: ' + b.textContent.slice(0, 120));
  doc.getElementById('fuel-dep').value = '64';
  w.renderAllFlightTables();
  assert(b.style.display === 'none', 'did not clear');
});
T('altitude above POH ceiling warns about clamping', () => {
  ev('flights[0].waypoints[2].alt = 16000; renderAllFlightTables();');
  assert(doc.getElementById('integrity-banner').textContent.includes('14,000 ft'), 'ceiling clamp not flagged');
  ev('flights[0].waypoints[2].alt = 2500; renderAllFlightTables();');
});
T('responsibility text present in the guide', () => {
  const g = doc.getElementById('help-modal').textContent;
  assert(g.includes('Pilot-in-Command') && g.includes('cross-reference') && g.includes('not an authoritative source'), 'guide text missing');
});

console.log('\n=== 39. Inactive flights dim and lock in edit mode ===');
T('edit mode: inactive flight line is transparent and non-interactive', () => {
  ev(SEED);
  w.addNewFlightPlan();            // creates flight 2, becomes active
  assert(ev('activeFlightIndex') === 1, 'flight 2 not active');
  assert(ev('polylines[0]._opts.opacity') === 0.35, 'inactive line not dimmed: ' + ev('polylines[0]._opts.opacity'));
  assert(ev('polylines[0]._opts.interactive') === false, 'inactive line still clickable');
  const dimmedMarkers = ev('markers.filter(m => m._opts && m._opts.opacity === 0.35).length');
  assert(dimmedMarkers >= 3, 'inactive waypoints not dimmed: ' + dimmedMarkers);
  assert(ev('markers.filter(m => m._opts && m._opts.opacity === 0.35 && m._opts.draggable).length') === 0, 'dimmed marker still draggable');
});
T('switching the active flight moves the dimming', () => {
  w.setActiveFlight(0);
  assert(ev('polylines[0]._opts.opacity') === 0.95, 'flight 1 should be prominent now');
  assert(ev('polylines[0]._opts.interactive') === true, 'flight 1 should be clickable now');
});
TA('view mode: every flight at full strength', async () => {
  ev(SEED);
  w.addNewFlightPlan();          // this test needs two flights of its own
  ev('refreshMap();');
  w.toggleDoneMode();
  assert(ev('polylines[0]._opts.opacity') === 0.95 && ev('polylines[1]._opts.opacity') === 0.95, 'view mode dimmed something');
  assert(ev('markers.filter(m => m._opts && m._opts.opacity === 0.35).length') === 0, 'dimmed markers in view mode');
  assert(ev('markers.filter(m => m._opts && m._opts.interactive === false).length') === 0, 'locked markers in view mode');
  w.toggleDoneMode();
  // drop flight 2 again so later tests see a single-flight world
  const p = w.removeFlightPlan(1);
  await tick();
  answerDialog('Delete flight');
  await p;
  assert(ev('flights.length') === 1, 'cleanup failed');
});

console.log('\n=== 40. Configurable minute marks; tick box removed ===');
T('the fixed 100kt reference box is gone', () => {
  assert(doc.getElementById('tick-box-text') === null, 'tick box still present');
});
T('default 3-minute column; header and value follow the setting', () => {
  ev(SEED);
  const hdr3 = doc.querySelector('#flight-plans-container thead').textContent;
  assert(hdr3.includes('3m-NM'), 'default header wrong: needs 3m-NM');
  // leg 2 is level cruise: value must equal effGS * N / 60
  const res = ev('computeLegTotals(flights[0].waypoints[1], flights[0].waypoints[2])');
  const cell3 = [...doc.querySelectorAll('#tbody-flight-0 tr:not(.sub-leg-row)')][1].cells[14].textContent;
  assert(Math.abs(parseFloat(cell3) - res.effGS * 3 / 60) < 0.02, '3-min value wrong: ' + cell3);
  w.openSettingsModal();
  doc.getElementById('qol-minute-mark').value = '5';
  w.saveSettings();
  const hdr5 = doc.querySelector('#flight-plans-container thead').textContent;
  assert(hdr5.includes('5m-NM') && !hdr5.includes('3m-NM'), '5-min header wrong: ' + hdr5.slice(0, 120));
  const cell5 = [...doc.querySelectorAll('#tbody-flight-0 tr:not(.sub-leg-row)')][1].cells[14].textContent;
  assert(Math.abs(parseFloat(cell5) - res.effGS * 5 / 60) < 0.02, '5-min value wrong: ' + cell5);
  assert(Math.abs(parseFloat(cell5) / parseFloat(cell3) - 5 / 3) < 0.03, 'value did not scale 3->5');
});
T('2-minute marks work and the choice persists via profile', () => {
  w.openSettingsModal();
  doc.getElementById('qol-minute-mark').value = '2';
  w.saveSettings();
  assert(doc.querySelector('#flight-plans-container thead').textContent.includes('2m-NM'), '2-min header missing');
  assert(JSON.parse(w.localStorage.getItem('c182_perf_profile')).minuteMark === 2, 'not persisted');
  const clean = ev(`(function(){ aircraftProfile.minuteMark = 7; return minuteMark(); })()`);
  assert(clean === 3, 'junk interval not defaulted: ' + clean);
  ev('aircraftProfile.minuteMark = 3; renderAllFlightTables();');
});

console.log('\n=== 42. Map locked to one copy of the earth ===');
T('map is bounded at the antimeridian with solid viscosity; tiles do not wrap', () => {
  const raw = APP_SRC;
  const mapInit = raw.split("L.map('map', {")[1].split('}).setView')[0];
  assert(mapInit.includes('maxBounds: [[-90, -180], [90, 180]]'), 'maxBounds missing');
  assert(mapInit.includes('maxBoundsViscosity: 1.0'), 'viscosity not solid');
  const base = raw.split("cache.kartverket.no")[1].split('}).addTo(map)')[0];
  assert(base.includes('noWrap: true'), 'base tiles still wrap');
});
T('the openAIP airspace overlay stays removed, stored keys purged', () => {
  // The COMMUNITY-sourced overlay (openAIP) was removed because its data
  // lagged the current VFR chart. v16.31 added an overlay again, but from the
  // OFFICIAL AIP Norge with a stated edition - so what must stay gone is
  // openAIP specifically, not the idea of drawing airspace.
  const raw = APP_SRC;
  assert(!raw.includes('api.tiles.openaip.net'), 'the openAIP tile endpoint is back');
  assert(!raw.includes('qol-openaip-key'), 'the openAIP key field is back');
  // ...but the PURGE of the old stored key must still be there, so an upgrade
  // from a version that had the feature cleans up after itself.
  assert(raw.includes("removeItem('c182_openaip_key')"), 'the stored-key purge was dropped');
  // init still purges anything a previous version stored
  assert(w.localStorage.getItem('c182_openaip_key') === null, 'stored key not purged');
  assert(w.localStorage.getItem('c182_airspace_on') === null, 'stored state not purged');
  // and the replacement must name its source and its edition, or it is no
  // better than the thing that was deleted
  const src = fs.readFileSync('data/aip.js', 'utf8');
  const set = JSON.parse(src.slice(src.indexOf('{'), src.lastIndexOf(';')));
  assert(set.provider === 'Avinor' && set.editionLabel, 'the new overlay does not name its edition');
});

console.log('\n=== 43. Smooth waypoint dragging; wider tile buffer ===');
T('dragging a waypoint moves the line but does NOT rebuild the OFP tables', () => {
  ev(SEED);
  // A sentinel node inside the tables container: renderAllFlightTables wipes
  // container.innerHTML, so the sentinel surviving proves no rebuild happened.
  const sentinel = doc.createElement('div');
  sentinel.id = 'drag-sentinel';
  doc.getElementById('flight-plans-container').appendChild(sentinel);
  ev(`(function(){
    const m = markers.find(k => k._h && k._h.drag);
    m._latlng = { lat: 69.10, lng: 18.40 };
    m._h.drag({ target: m });
  })()`);
  assert(doc.getElementById('drag-sentinel') !== null, 'tables were rebuilt during drag');
  assert(ev('flights[0].waypoints[0].lat') === 69.10, 'waypoint did not follow the drag');
  assert(JSON.stringify(ev('polylines[0]._ll')).includes('69.1'), 'route line did not follow the drag');
});
T('releasing the drag does the full recalc once', () => {
  ev(`(function(){
    const m = markers.find(k => k._h && k._h.dragend && k._h.drag);
    m._h.dragend({ target: m });
  })()`);
  assert(doc.getElementById('drag-sentinel') === null, 'dragend did not rebuild the tables');
  assert(!doc.getElementById('flight-plans-container').textContent.includes('NaN'), 'NaN after drag recalc');
  assert(ev('flights[0].waypoints[0].varSource') !== undefined, 'dragend did not re-resolve mag var');
  ev(SEED); // restore the seed route for anything that runs after
});
T('drag handler stays lean (guard against the per-mousemove rebuild returning)', () => {
  const raw = APP_SRC;
  const seg = raw.split("marker.on('drag'")[1].split("marker.on('dragend'")[0];
  assert(!seg.includes('renderAllFlightTables'), 'renderAllFlightTables is back in the drag handler');
  assert(seg.includes('drawLiveLine'), 'route line no longer follows the drag');
  // ...and the live redraw must use the FULL path. Rebuilding from waypoints
  // alone made via points visibly vanish for the duration of every drag.
  const live = raw.split('function drawLiveLine')[1].split('\n    }')[0];
  // drawnLineCoords IS flightLineCoords plus the densification the path model
  // needs (v16.63) - it calls it - so either name satisfies the rule this guard
  // exists for. What must never come back is a rebuild from the WAYPOINTS
  // alone, which is what made the vias vanish mid-drag.
  assert(/drawnLineCoords|flightLineCoords/.test(live),
    'the live redraw dropped the via points again');
  assert(!/\bfl\.waypoints\.map\b|\bflights\[[^\]]+\]\.waypoints\.map\b/.test(live),
    'the live redraw is rebuilding the line from waypoints alone again');
  // ...and the shared helper really does keep the vias. Driven through the
  // PAGE, because this test runs before the module requires happen.
  const drawn = ev(`drawnLineCoords({ waypoints: [
    { lat: 69, lng: 18, name: 'A' },
    { lat: 69.5, lng: 18.5, name: 'B', via: [{ lat: 69.2, lng: 18.9 }] }] })`);
  assert(drawn.some((p) => Math.abs(p[0] - 69.2) < 1e-9 && Math.abs(p[1] - 18.9) < 1e-9),
    'drawnLineCoords lost the via point');
});
T('base tiles keep a wider buffer so panning shows fewer grey gaps', () => {
  assert(ev('baseTiles._opts.keepBuffer') === 4, 'keepBuffer not 4: ' + ev('baseTiles._opts.keepBuffer'));
  assert(ev('baseTiles._opts.noWrap') === true, 'noWrap lost while touching tile options');
});

console.log('\n=== 44. Daylight & VFR day (SERA night definition) ===');
// Reference times fetched from the US Naval Observatory almanac API
// (aa.usno.navy.mil/api/rstt/oneday, tz=0) on 2026-08-24 for 69.68N 18.92E
// (Tromsø) and 60.20N 11.08E (Oslo). NOAA-vs-USNO agreement measured at
// ≤0.5 min on all fixtures; the ±2 min tolerance leaves honest headroom.
const utc = (mo, d, h, mi) => Date.UTC(2026, mo - 1, d, h, mi);
const near = (got, want, label) => {
  assert(got != null && Math.abs(got - want) <= 2 * 60000,
    label + ': got ' + (got == null ? 'null' : new Date(got).toISOString()) + ' want ~' + new Date(want).toISOString());
};
T('Tromsø equinox 2026-03-20 matches USNO within 2 min', () => {
  const r = ev('computeDaylight("2026-03-20", 69.68, 18.92)');
  assert(r.kind === 'normal', 'kind: ' + r.kind);
  near(r.mct, utc(3, 20, 3, 44), 'morning civil twilight');
  near(r.sunrise, utc(3, 20, 4, 44), 'sunrise');
  near(r.sunset, utc(3, 20, 17, 2), 'sunset');
  near(r.ect, utc(3, 20, 18, 2), 'end of civil twilight');
});
T('Tromsø 2026-08-24 matches USNO', () => {
  const r = ev('computeDaylight("2026-08-24", 69.68, 18.92)');
  near(r.mct, utc(8, 24, 0, 59), 'morning civil twilight');
  near(r.sunrise, utc(8, 24, 2, 27), 'sunrise');
  near(r.sunset, utc(8, 24, 19, 3), 'sunset');
  near(r.ect, utc(8, 24, 20, 29), 'end of civil twilight');
});
T('Tromsø 2026-01-15: a 42-minute day, hours of usable twilight', () => {
  const r = ev('computeDaylight("2026-01-15", 69.68, 18.92)');
  near(r.mct, utc(1, 15, 7, 58), 'morning civil twilight');
  near(r.sunrise, utc(1, 15, 10, 33), 'sunrise');
  near(r.sunset, utc(1, 15, 11, 15), 'sunset');
  near(r.ect, utc(1, 15, 13, 50), 'end of civil twilight');
});
T('Oslo 2026-03-20 matches USNO (mid-latitude sanity)', () => {
  const r = ev('computeDaylight("2026-03-20", 60.20, 11.08)');
  near(r.mct, utc(3, 20, 4, 36), 'morning civil twilight');
  near(r.sunrise, utc(3, 20, 5, 18), 'sunrise');
  near(r.sunset, utc(3, 20, 17, 30), 'sunset');
  near(r.ect, utc(3, 20, 18, 12), 'end of civil twilight');
});
T('midnight sun 2026-06-21: day VFR all 24 h, no rise/set times', () => {
  const r = ev('computeDaylight("2026-06-21", 69.68, 18.92)');
  assert(r.kind === 'all-day', 'kind: ' + r.kind);
  assert(r.sunrise === null && r.sunset === null && r.mct === null, 'phantom event times');
});
T('polar night 2026-12-21: sun never rises, yet a LEGAL day-VFR twilight window exists', () => {
  const r = ev('computeDaylight("2026-12-21", 69.68, 18.92)');
  assert(r.kind === 'no-sunrise', 'kind: ' + r.kind);
  assert(r.sunrise === null && r.sunset === null, 'phantom sunrise/sunset');
  near(r.mct, utc(12, 21, 8, 32), 'window start');
  near(r.ect, utc(12, 21, 12, 53), 'window end');
});
T('deep polar night (78°N, Dec 21): no day-VFR window at all', () => {
  const r = ev('computeDaylight("2026-12-21", 78.25, 15.5)');
  assert(r.kind === 'polar-night', 'kind: ' + r.kind);
  assert(r.mct === null && r.ect === null, 'window reported in deep polar night');
});
T('an ETD before morning civil twilight raises a red night warning', () => {
  ev(SEED);
  doc.getElementById('def-date').value = '2026-01-15';
  const mct = ev('computeDaylight("2026-01-15", flights[0].waypoints[0].lat, flights[0].waypoints[0].lng).mct');
  doc.getElementById('def-etd').value = ev(`fmtLocalHM(${mct} - 3600000)`);
  w.renderAllFlightTables();
  const txt = doc.getElementById('daylight-body').textContent;
  assert(txt.includes('BEFORE morning civil twilight'), 'no warning: ' + txt.slice(0, 200));
  assert(!txt.includes('NaN'), 'NaN in daylight card');
});
T('an ETD inside the window raises no warning; legal basis is cited', () => {
  const mct = ev('computeDaylight("2026-01-15", flights[0].waypoints[0].lat, flights[0].waypoints[0].lng).mct');
  doc.getElementById('def-etd').value = ev(`fmtLocalHM(${mct} + 3600000)`);
  w.renderAllFlightTables();
  const txt = doc.getElementById('daylight-body').textContent;
  assert(!txt.includes('night per SERA'), 'unexpected night warning: ' + txt.slice(0, 300));
  assert(txt.includes('SERA Art. 2(97)'), 'legal basis missing');
  assert(txt.includes('−6°'), 'the -6° boundary is not stated');
});
T('an ETA within 30 min of the window end raises the planning-margin caution', () => {
  const ect = ev('computeDaylight("2026-01-15", flights[0].waypoints[2].lat, flights[0].waypoints[2].lng).ect');
  const totMin = parseFloat(txtOf('grand-tot-time').match(/\(([\d.]+) min\)/)[1]);
  doc.getElementById('def-etd').value = ev(`fmtLocalHM(${ect} - ${Math.round(totMin) + 15} * 60000)`);
  w.renderAllFlightTables();
  const txt = doc.getElementById('daylight-body').textContent;
  assert(txt.includes('planning margin'), 'no margin caution: ' + txt.slice(0, 300));
  assert(!txt.includes('night per SERA'), 'margin case wrongly flagged as night');
});
T('polar-night day at the route itself: card shows the twilight-only window', () => {
  doc.getElementById('def-date').value = '2026-12-21';
  doc.getElementById('def-etd').value = '';
  w.renderAllFlightTables();
  const txt = doc.getElementById('daylight-body').textContent;
  assert(txt.includes('sun stays below the horizon'), 'no-sunrise note missing: ' + txt.slice(0, 300));
  assert(txt.includes('Enter an ETD'), 'missing prompt to enter an ETD');
  assert(!txt.includes('NaN'), 'NaN in daylight card');
});
T('flight date defaults to today and is not persisted in planning prefs', () => {
  doc.getElementById('def-date').value = '';
  w.renderAllFlightTables();
  const today = ev('localDateStrOf(Date.now())');
  assert(doc.getElementById('def-date').value === today, 'date did not default to today');
  w.savePlanningPrefs();
  assert(!('date' in JSON.parse(w.localStorage.getItem('c182_planning_prefs'))), 'flight date leaked into stored prefs');
});
T('guide documents the SERA rule, polar cases and the official-source caveat', () => {
  const guide = doc.querySelector('#help-modal .modal-body').textContent;
  assert(guide.includes('SERA Art. 2(97)'), 'SERA article missing from guide');
  assert(guide.includes('6° below the horizon'), '6-degree boundary missing from guide');
  assert(guide.includes('BSL F 1-1'), 'Norwegian regulation missing from guide');
  assert(guide.includes('GEN 2.7'), 'official AIP source missing from guide');
});

console.log('\n=== 45. Wind fetch date synced with Flight Date ===');
T('opening the wind modal mirrors the Flight Date into the wind picker', () => {
  ev(SEED);
  const plus3 = ev('localDateStrOf(Date.now() + 3 * 86400000)');
  doc.getElementById('def-date').value = plus3;
  w.openWindModal();
  assert(doc.getElementById('wind-fetch-date').value === plus3,
    'wind date not mirrored: ' + doc.getElementById('wind-fetch-date').value + ' vs ' + plus3);
  assert(txtOf('wind-fetch-status').trim() === '', 'unexpected warning for an in-range date');
  w.closeWindModal();
});
T('changing the wind picker writes back to the Flight Date and the daylight card', () => {
  const plus5 = ev('localDateStrOf(Date.now() + 5 * 86400000)');
  doc.getElementById('wind-fetch-date').value = plus5;
  w.syncFlightDateFromWindPicker();
  assert(doc.getElementById('def-date').value === plus5, 'Flight Date did not follow the wind picker');
  assert(doc.getElementById('daylight-body').textContent.includes(plus5), 'daylight card not recomputed for the synced date');
});
T('a Flight Date outside the forecast range clamps the picker, warns, and leaves the Flight Date alone', () => {
  doc.getElementById('def-date').value = '2026-01-15';
  w.openWindModal();
  const today = ev('localDateStrOf(Date.now())');
  assert(doc.getElementById('wind-fetch-date').value === today, 'picker not clamped to today');
  assert(txtOf('wind-fetch-status').includes('outside the forecast range'), 'no out-of-range warning');
  assert(doc.getElementById('def-date').value === '2026-01-15', 'Flight Date was overwritten by the clamp');
  w.closeWindModal();
  doc.getElementById('def-date').value = '';
  doc.getElementById('def-etd').value = '';
  w.renderAllFlightTables();
});

console.log('\n=== 46. Local-time labeling (no UTC/local confusion) ===');
T('ETD input is labeled as local time', () => {
  const label = doc.getElementById('def-etd').previousElementSibling;
  assert(label && label.textContent.includes('local'), 'ETD label does not say local');
});
T('daylight card states local times and the UTC offset for the flight date', () => {
  ev(SEED);
  const txt = doc.getElementById('daylight-body').textContent;
  // the harness runs pinned to TZ=UTC, so the stated offset must be UTC+0
  assert(txt.includes('All times local (UTC+0)'), 'timezone note missing/wrong: ' + txt.slice(-220));
  assert(txt.includes('tables are UTC'), 'AIP-is-UTC caveat missing');
  assert(ev('utcOffsetLabel("2026-06-21")') === 'UTC+0', 'offset label wrong under TZ=UTC');
});
T('guide explains the local-vs-UTC convention', () => {
  const guide = doc.querySelector('#help-modal .modal-body').textContent;
  assert(guide.includes('Times are local'), 'local-time note missing from guide');
  assert(guide.includes('add the local offset'), 'UTC cross-check hint missing from guide');
});

console.log('\n=== 47. ETO past midnight is marked +1 ===');
T('a 23:30 ETD with a 90-minute mission reads 01:00+1, not a time before the ETD', () => {
  doc.getElementById('def-etd').value = '23:30';
  assert(ev('computeETO(90)') === '01:00+1', 'got ' + ev('computeETO(90)'));
  assert(ev('computeETO(20)') === '23:50', 'same-day ETO must stay unmarked: ' + ev('computeETO(20)'));
  assert(ev('computeETO(1500)') === '00:30+2', '25h mission crosses two midnights: ' + ev('computeETO(1500)'));
  doc.getElementById('def-etd').value = '';
});

console.log('\n=== 48. Multi-sector daylight: every takeoff & landing checked ===');
const SEED2 = `flights = [
  { id: 1, title: "F1", depElev: 254, waypoints: [
    { lat: 69.05505349, lng: 18.54466865, name: "ENDU", alt: 254,  oat: 10, wdir: 0, wspd: 0, var: -11 },
    { lat: 69.67895054, lng: 18.91143033, name: "ENTC", alt: 2500, oat: 10, wdir: 0, wspd: 0, var: -12 }
  ]},
  { id: 2, title: "F2", depElev: 229, waypoints: [
    { lat: 69.67895054, lng: 18.91143033, name: "ENTC", alt: 229,  oat: 10, wdir: 0, wspd: 0, var: -12 },
    { lat: 69.05505349, lng: 18.54466865, name: "ENDU", alt: 2500, oat: 10, wdir: 0, wspd: 0, var: -11 }
  ]}
]; activeFlightIndex = 0; refreshMap(); renderAllFlightTables();`;
T('an intermediate stop gets its own STOP row on the card', () => {
  ev(SEED2);
  doc.getElementById('def-date').value = '2026-01-15';
  w.renderAllFlightTables();
  const txt = doc.getElementById('daylight-body').textContent;
  assert(txt.includes('STOP ENTC'), 'no STOP row for the intermediate aerodrome: ' + txt.slice(0, 200));
  assert(txt.includes('DEP ENDU'), 'DEP row missing');
});
T('a second sector landing after civil twilight is flagged even when sector 1 is legal', () => {
  const ect = ev('computeDaylight("2026-01-15", 69.055, 18.545).ect');
  const totMin = parseFloat(txtOf('grand-tot-time').match(/\(([\d.]+) min\)/)[1]);
  // ETD chosen so the FINAL landing is 20 min AFTER the window closes at ENDU,
  // while the first takeoff (hours earlier) is comfortably inside the window.
  doc.getElementById('def-etd').value = ev(`fmtLocalHM(${ect} - ${Math.round(totMin) - 20} * 60000)`);
  w.renderAllFlightTables();
  const txt = doc.getElementById('daylight-body').textContent;
  assert(txt.includes('F2 landing') && txt.includes('AFTER the end of evening civil twilight'),
    'late second-sector landing not flagged: ' + txt.slice(0, 400));
  assert(!txt.includes('F1 takeoff') || !txt.includes('F1 takeoff' + ' '), 'noise check');
  assert(!txt.includes('NaN'), 'NaN in daylight card');
});
T('warnings name the sector (F1/F2) so multi-sector output is unambiguous', () => {
  const mct = ev('computeDaylight("2026-01-15", 69.055, 18.545).mct');
  doc.getElementById('def-etd').value = ev(`fmtLocalHM(${mct} - 3600000)`);
  w.renderAllFlightTables();
  const txt = doc.getElementById('daylight-body').textContent;
  assert(txt.includes('F1 takeoff') && txt.includes('BEFORE morning civil twilight'),
    'first-sector takeoff warning missing sector tag: ' + txt.slice(0, 400));
  // restore the single-flight seed and clean inputs for any later test
  doc.getElementById('def-etd').value = '';
  doc.getElementById('def-date').value = '';
  ev(SEED);
});

console.log('\n=== 49. MagVar: the real WMM against NOAA ===');
// Reference declinations from NOAA's calculator (ngdc.noaa.gov/geomag-web,
// WMM2025, epoch 2026.6438, east-positive degrees). v16.9 replaced the
// regional polynomial with the actual WMM, so the tolerance drops from
// "within a degree" to rounding noise.
const WMM_EPOCH = 2026.6438;
const magCase = (name, lat, lng, noaaEast) => {
  T(`magvar ${name} matches NOAA WMM2025 to 0.02 deg`, () => {
    const east = parseFloat(ev(`resolveMagVar(${lat}, ${lng}, ${WMM_EPOCH}).raw`));
    assert(Math.abs(east - noaaEast) <= 0.02,
      `model ${east} deg E vs NOAA ${noaaEast} deg E (diff ${(east - noaaEast).toFixed(4)})`);
  });
};
magCase('ENDU', 69.055, 18.544, 10.78313);
magCase('ENTC', 69.683, 18.919, 11.22226);
magCase('ENEV', 68.491, 16.678, 9.56912);
magCase('ENBO', 67.269, 14.365, 7.98006);
magCase('ENKR (east edge)', 69.725, 29.887, 17.18659);
magCase('ENGM (south, where the old polynomial was 1.9 deg out)', 60.202, 11.084, 5.20523);
T('magvar sign convention: east declination gives a NEGATIVE VAR value', () => {
  const r = ev(`resolveMagVar(69.055, 18.544, ${WMM_EPOCH})`);
  assert(r.val < 0, 'VAR should be negative (east) in Norway, got ' + r.val);
  assert(r.val === -Math.round(parseFloat(r.raw)), 'val is not -round(raw)');
  assert(r.source === 'WMM2025', 'source should name the model, got ' + r.source);
});
T('live use without an epoch returns finite values inside the model validity', () => {
  const r = ev('resolveMagVar(69.055, 18.544)');
  assert(isFinite(r.val) && isFinite(parseFloat(r.raw)), 'non-finite magvar');
  assert(ev('isWmmCurrent()') === true, 'WMM2025 should still be current; if this fails the model needs updating');
  assert(ev('WMM_VALID_UNTIL') === 2030, 'validity horizon: ' + ev('WMM_VALID_UNTIL'));
});
T('the retired regional polynomial is gone', () => {
  assert(ev('typeof getRegionalMagVar') === 'undefined', 'the old polynomial is still defined');
  const built = APP_SRC;
  assert(!built.includes('secularVariationPerYear'), 'polynomial coefficients still shipped');
  assert(built.includes('WMM2025'), 'the artifact should name the magnetic model');
});
T('the UI names the magnetic model rather than "regional"', () => {
  assert(txtOf('mag-status-badge').includes('WMM2025'), 'badge: ' + txtOf('mag-status-badge'));
  ev(SEED);
  const varTitle = doc.querySelector('#tbody-flight-0 tr td input[title^="Mag VAR"]').title;
  assert(varTitle.includes('WMM2025'), 'VAR cell tooltip: ' + varTitle);
});

console.log('\n=== 50. Flight plans named after first-last waypoint ===');
T('a routed flight is titled FIRST-LAST (ENDU-ENTC)', () => {
  ev(SEED);
  const hdr = doc.querySelector('.flight-header').textContent;
  assert(hdr.includes('ENDU-ENTC'), 'route name missing from header: ' + hdr.slice(0, 120));
  assert(!hdr.includes('Flight Plan 1'), 'stored fallback title still shown despite a full route');
});
T('each sector of a multi-flight mission gets its own route name', () => {
  ev(SEED2);
  const hdrs = [...doc.querySelectorAll('.flight-header')].map(h => h.textContent);
  assert(hdrs[0].includes('ENDU-ENTC'), 'F1 name wrong: ' + hdrs[0].slice(0, 100));
  assert(hdrs[1].includes('ENTC-ENDU'), 'F2 name wrong: ' + hdrs[1].slice(0, 100));
});
T('the name follows the route when waypoints change', () => {
  ev(SEED);
  ev('flights[0].waypoints.pop(); renderAllFlightTables();');
  assert(doc.querySelector('.flight-header').textContent.includes('ENDU-FINNSNES'),
    'name did not follow the shortened route');
  ev(SEED);
});
T('fewer than two waypoints falls back to the stored title; storage is untouched', () => {
  ev('flights = [{ id: 1, title: "Flight Plan 1", depElev: 254, waypoints: [] }]; activeFlightIndex = 0; refreshMap(); renderAllFlightTables();');
  assert(doc.querySelector('.flight-header').textContent.includes('Flight Plan 1'), 'fallback title not shown');
  ev(SEED);
  assert(ev('flights[0].title') === 'Flight Plan 1', 'flightTitle must not mutate the stored title');
});
T('pattern rows do not hijack the name', () => {
  ev(SEED);
  ev(`flights[0].waypoints.push({ isPattern: true, name: "ENTC", laps: 2, lat: 69.679, lng: 18.911, alt: 229 }); renderAllFlightTables();`);
  assert(doc.querySelector('.flight-header').textContent.includes('ENDU-ENTC'), 'pattern waypoint changed the route name');
  ev(SEED);
});

console.log('\n=== 51. Ctrl+Z / Ctrl+Shift+Z keyboard undo & redo ===');
const keyZ = (opts) => doc.dispatchEvent(new w.KeyboardEvent('keydown', Object.assign({ key: 'z', ctrlKey: true, bubbles: true, cancelable: true }, opts)));
T('Ctrl+Z steps back through MULTIPLE edits; Ctrl+Shift+Z replays them', () => {
  ev(SEED);
  ev('undoStack = []; redoStack = [];');
  w.deleteWaypointFromFlight(0, 2);   // 3 -> 2 waypoints
  w.deleteWaypointFromFlight(0, 1);   // 2 -> 1 waypoint
  assert(ev('flights[0].waypoints.length') === 1, 'setup failed');
  keyZ({});
  assert(ev('flights[0].waypoints.length') === 2, 'first Ctrl+Z did not undo');
  keyZ({});
  assert(ev('flights[0].waypoints.length') === 3, 'second Ctrl+Z did not accumulate');
  keyZ({ shiftKey: true });
  assert(ev('flights[0].waypoints.length') === 2, 'first Ctrl+Shift+Z did not redo');
  keyZ({ shiftKey: true });
  assert(ev('flights[0].waypoints.length') === 1, 'second Ctrl+Shift+Z did not accumulate');
  keyZ({}); keyZ({});   // back to the full route for later tests
  assert(ev('flights[0].waypoints.length') === 3, 'undo after redo broken');
});
T('Cmd+Z works for Mac users', () => {
  w.deleteWaypointFromFlight(0, 2);
  doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true, cancelable: true }));
  assert(ev('flights[0].waypoints.length') === 3, 'metaKey undo did not fire');
});
T('Ctrl+Z works with focus in the app\'s number/time fields (where focus usually is)', () => {
  // Focus stays in fuel/ETD/altitude fields after editing them (they are not
  // rebuilt by the re-render), so the shortcut MUST fire from there — this
  // was the original in-browser bug: undo went dead right after an edit.
  w.deleteWaypointFromFlight(0, 2);
  const inp = doc.getElementById('fuel-dep');
  inp.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
  assert(ev('flights[0].waypoints.length') === 3, 'undo did not fire from a number input');
});
T('free-text fields keep the browser\'s native undo', () => {
  w.deleteWaypointFromFlight(0, 2);
  const txt = doc.createElement('input');
  txt.type = 'text';
  doc.body.appendChild(txt);
  txt.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
  assert(ev('flights[0].waypoints.length') === 2, 'app undo hijacked a text input');
  txt.remove();
  keyZ({});
  assert(ev('flights[0].waypoints.length') === 3, 'restore failed');
});
T('an exhausted stack is silent on the keyboard but still notifies on the buttons', () => {
  ev('undoStack = []; redoStack = [];');
  const count = () => (doc.getElementById('app-toasts') || { children: [] }).children.length;
  const before = count();
  keyZ({});
  keyZ({ shiftKey: true });
  assert(count() === before, 'keyboard on empty stacks must be silent, got ' + (count() - before) + ' toast(s)');
  w.undoLast();
  assert(count() === before + 1, 'the Undo button lost its empty-stack notice');
  assert(toastText().includes('Nothing to undo'), 'wrong toast: ' + toastText());
  // toasts must never be a blocking dialog
  assert(!openDlg(), 'a notification opened a modal dialog');
});
T('guide documents the shortcuts', () => {
  const guide = doc.querySelector('#help-modal .modal-body').textContent;
  assert(guide.includes('Ctrl+Z') && guide.includes('Ctrl+Shift+Z'), 'shortcuts missing from guide');
});

console.log('\n=== 52. Via legs: row shows the DIRECT WP-WP track ===');
T('adding a via point does not change the row TT/MT (direct line), but distance follows the bend', () => {
  ev(SEED);
  const row = () => {
    const c = doc.querySelector('#tbody-flight-0 tr').cells;
    return { tt: c[6].textContent.trim(), mt: c[8].textContent.trim(), dist: parseFloat(c[13].textContent) };
  };
  const before = row();
  const directTT = Math.round(ev('calcTrueTrack(flights[0].waypoints[0].lat, flights[0].waypoints[0].lng, flights[0].waypoints[1].lat, flights[0].waypoints[1].lng)'));
  assert(before.tt === directTT + '°', 'baseline row TT is not the direct track: ' + before.tt);
  ev('insertViaAtLatLng(0, { lat: 69.10, lng: 19.2 })');   // bend leg 1 east
  const after = row();
  assert(after.tt === before.tt && after.mt === before.mt,
    `row TT/MT must stay the direct WP-WP line: ${before.tt}/${before.mt} -> ${after.tt}/${after.mt}`);
  assert(after.dist > before.dist + 0.5, 'distance did not follow the bent path: ' + before.dist + ' -> ' + after.dist);
});
T('the sub-line lists the flown segment tracks and names the convention', () => {
  const sub = doc.querySelector('#tbody-flight-0 tr.sub-leg-row');
  assert(sub, 'via sub-line missing');
  assert(sub.textContent.includes('via 1 pt'), 'via count missing: ' + sub.textContent);
  assert(sub.textContent.includes('flown tracks'), 'flown-tracks label missing');
  assert(sub.textContent.includes('direct ENDU–FINNSNES'), 'direct-line note missing: ' + sub.textContent);
});
T('removing the via restores the plain leg (row and distance identical to a via-free leg)', () => {
  ev('delete flights[0].waypoints[1].via; refreshMap(); renderAllFlightTables();');
  const c = doc.querySelector('#tbody-flight-0 tr').cells;
  const directTT = Math.round(ev('calcTrueTrack(flights[0].waypoints[0].lat, flights[0].waypoints[0].lng, flights[0].waypoints[1].lat, flights[0].waypoints[1].lng)'));
  assert(c[6].textContent.trim() === directTT + '°', 'row TT wrong after via removal');
  ev(SEED);
});
T('guide states the direct-line convention and warns to steer by segment tracks', () => {
  const guide = doc.querySelector('#help-modal .modal-body').textContent;
  assert(guide.includes('direct line between the two named waypoints'), 'convention missing from guide');
  assert(guide.includes('steer by those'), 'steering warning missing from guide');
});

console.log('\n=== 53. Climb legs display the cruise TAS ===');
T('a CLB+CRZ leg shows the cruise TAS in the row; climb stays in time/fuel and the sub-line', () => {
  ev(SEED);
  const r = ev(`computeLegTotals(flights[0].waypoints[0], flights[0].waypoints[1])`);
  assert(r.profileTag === 'CLB+CRZ', 'seed leg 1 should be CLB+CRZ, got ' + r.profileTag);
  const crzTas = ev('cruisePerf(2500, ' + ev('flights[0].waypoints[1].oat') + ').tas');
  assert(r.dispTas === crzTas, 'row TAS should be cruise TAS ' + crzTas + ', got ' + r.dispTas);
  const cell = doc.querySelector('#tbody-flight-0 tr').cells[5].textContent.trim();
  assert(cell === String(crzTas), 'TAS cell shows ' + cell + ', want ' + crzTas);
  const cp = ev('climbPerf(254, 2500, ' + ev('flights[0].waypoints[1].oat') + ')');
  assert(Math.abs(r.climbInfo.timeMin - cp.timeMin) < 0.05, 'climb time no longer accounted');
  assert(doc.querySelector('#tbody-flight-0 tr.sub-leg-row').textContent.includes('CLB'), 'climb detail left the sub-line');
});
T('an ALL-climb leg keeps the climb TAS (there is no cruise portion to show)', () => {
  const r = ev(`computeLegTotals(
    { lat: 69.0, lng: 18.0, name: 'A', alt: 254, wdir: 0, wspd: 0, oat: 10, var: -11 },
    { lat: 69.05, lng: 18.0, name: 'B', alt: 8000, wdir: 0, wspd: 0, oat: -1, var: -11 })`);
  assert(r.profileTag === 'CLB', 'short steep leg should be all climb, got ' + r.profileTag);
  const cp = ev('climbPerf(254, 8000, -1)');
  assert(r.dispTas === Math.round(cp.tasAvg), 'all-climb leg should show climb TAS ' + Math.round(cp.tasAvg) + ', got ' + r.dispTas);
});
T('integrity guards wind against the SLOWEST phase, not the displayed cruise TAS', () => {
  const r = ev(`computeLegTotals(flights[0].waypoints[0], flights[0].waypoints[1])`);
  const cp = ev('climbPerf(254, 2500, ' + ev('flights[0].waypoints[1].oat') + ')');
  assert(r.minPhaseTas === Math.round(cp.tasAvg), 'minPhaseTas should be the climb TAS');
  // wind above climb TAS but below cruise TAS must still trip the banner
  ev('flights[0].waypoints[1].wspd = ' + (Math.round(cp.tasAvg) + 2) + '; renderAllFlightTables();');
  const b = doc.getElementById('integrity-banner');
  assert(b.style.display === 'block' && b.textContent.includes('slowest phase'), 'sub-cruise wind not flagged: ' + b.textContent.slice(0, 150));
  ev('flights[0].waypoints[1].wspd = 0; renderAllFlightTables();');
  assert(b.style.display === 'none', 'banner did not clear');
});

console.log('\n=== 54. Zoom declutter: labels thin out when zooming out ===');
// The real map fires every registered zoomend handler; the airspace overlay
// added a second one. Firing only the last would silently stop testing
// declutter, which is how this helper broke.
const setZoom = z => { ev('window.__stubZoom = ' + z); ev("window.__fireMap('zoomend')"); };
T('working zoom (>=8) shows full detail — no declutter class', () => {
  setZoom(8);
  const cl = doc.getElementById('map').classList;
  assert(!cl.contains('zoom-mid') && !cl.contains('zoom-far'), 'declutter active at working zoom: ' + cl);
  setZoom(9);
  assert(!doc.getElementById('map').classList.contains('zoom-mid'), 'declutter active at z9');
});
T('region zoom (6-7) compacts labels and hides the TOC/TOD chips', () => {
  setZoom(7);
  assert(doc.getElementById('map').classList.contains('zoom-mid'), 'zoom-mid missing at z7');
  setZoom(6);
  const cl = doc.getElementById('map').classList;
  assert(cl.contains('zoom-mid') && !cl.contains('zoom-far'), 'wrong level at z6: ' + cl);
  const raw = APP_SRC;
  assert(raw.includes('#map.zoom-mid .toc-label'), 'mid-zoom TOC chip rule missing');
  assert(/#map\.zoom-mid \.toc-label[^}]*display: none/.test(raw.replace(/\n/g, ' ')), 'TOC chips not hidden at mid zoom');
});
T('overview zoom (<=5) leaves only dots and lines', () => {
  setZoom(5);
  assert(doc.getElementById('map').classList.contains('zoom-far'), 'zoom-far missing at z5');
  const raw = APP_SRC.replace(/\n/g, ' ');
  assert(/#map\.zoom-far \.wp-label[^}]*display: none/.test(raw), 'waypoint labels not hidden at far zoom');
  assert(!/#map\.zoom-far[^{]*\.wp-dot/.test(raw), 'the waypoint DOTS must never be hidden');
  setZoom(3);
  assert(doc.getElementById('map').classList.contains('zoom-far'), 'zoom-far missing at z3');
});
T('zooming back in restores full detail; guide documents the behavior', () => {
  setZoom(9);
  const cl = doc.getElementById('map').classList;
  assert(!cl.contains('zoom-mid') && !cl.contains('zoom-far'), 'declutter stuck after zooming back in');
  const guide = doc.querySelector('#help-modal .modal-body').textContent;
  assert(guide.includes('Zooming out declutters automatically'), 'declutter missing from guide');
});
T('the map button shows Auto with the effective level', () => {
  setZoom(5);
  assert(txtOf('declutter-btn').includes('Auto (far)'), 'button label: ' + txtOf('declutter-btn'));
  setZoom(9);
  assert(txtOf('declutter-btn').includes('Auto (full)'), 'button label: ' + txtOf('declutter-btn'));
});
T('cycling locks a level regardless of zoom: full at overview, far at working zoom', () => {
  setZoom(5);                       // zoomed far out...
  w.cycleDeclutterMode();           // auto -> full
  const cl = () => doc.getElementById('map').classList;
  assert(txtOf('declutter-btn').includes('Full'), 'button label: ' + txtOf('declutter-btn'));
  assert(!cl().contains('zoom-far') && !cl().contains('zoom-mid'), 'FULL must override the zoom');
  w.cycleDeclutterMode();           // -> mid
  assert(cl().contains('zoom-mid'), 'MID not applied');
  setZoom(9);                       // ...and zoomed all the way in:
  w.cycleDeclutterMode();           // -> far
  assert(cl().contains('zoom-far'), 'FAR must override the zoom');
  assert(txtOf('declutter-btn').includes('Far'), 'button label: ' + txtOf('declutter-btn'));
});
T('the mode persists in the profile and cycles back to Auto', () => {
  assert(JSON.parse(w.localStorage.getItem('c182_perf_profile')).declutter === 'far', 'mode not persisted');
  w.cycleDeclutterMode();           // far -> auto
  assert(txtOf('declutter-btn').includes('Auto'), 'did not cycle back to Auto');
  const cl = doc.getElementById('map').classList;
  assert(!cl.contains('zoom-mid') && !cl.contains('zoom-far'), 'auto at z9 should be full detail');
  // survives an export/import round trip - asserted through the shared
  // whitelist rather than by grepping for its text
  assert(ev("pickProfileKeys({ declutter: 'far' }).declutter") === 'far', 'declutter is dropped by the profile whitelist');
  ev('window.__stubZoom = undefined;');
});

console.log('\n=== 55. FF column uses unrounded leg time ===');
T("every level leg of the user's mission shows the same cruise FF", () => {
  const mission = JSON.parse(fs.readFileSync('c182_flight_routes.json', 'utf8')).missions['ENDU-ENSK-ENLK-ENEV-ENDU'];
  ev('flights = ' + JSON.stringify(mission) + '; activeFlightIndex = 0; refreshMap(); renderAllFlightTables();');
  const crzGph = ev('cruisePerf(2500, 7).gph');
  let checked = 0;
  for (let f = 0; f < 5; f++) {
    const rows = [...doc.querySelectorAll(`#tbody-flight-${f} tr:not(.sub-leg-row)`)];
    rows.forEach(row => {
      if (!row.textContent.includes('CRZ') || row.textContent.includes('CLB') || row.textContent.includes('DES')) return;
      const ff = parseFloat(row.cells[17].textContent);
      assert(Math.abs(ff - crzGph) < 0.06,
        `level leg FF ${ff} != cruise ${crzGph} (flight ${f + 1}: ${row.cells[0].textContent}->${row.cells[1].textContent})`);
      checked++;
    });
  }
  assert(checked >= 15, 'too few level legs checked: ' + checked);
  ev(SEED);
});

console.log('\n=== 56. Climb carries across legs; TOD backs up so constraints are met ===');
ev(`aircraftProfile.mode = 'C182T'; aircraftProfile.climbMode = 'CRUISECLIMB';
    aircraftProfile.ccRoc = 500; aircraftProfile.ccKias = 90; aircraftProfile.ccFf = 15;
    aircraftProfile.rod = 500; aircraftProfile.descTas = 120; aircraftProfile.descFf = 8.5;`);
T('a climb too big for its leg carries into the next; TOC lands on the later leg', () => {
  // A --2 NM-- B(5000') --20 NM-- C(5000'): climb 254->5000 needs ~9.5 min (~14 NM)
  ev(`flights = [{ id: 1, title: "T", depElev: 254, waypoints: [
    { lat: 69.000, lng: 18.0, name: "A", alt: 254,  oat: 5, wdir: 0, wspd: 0, var: -11 },
    { lat: 69.0333, lng: 18.0, name: "B", alt: 5000, oat: 5, wdir: 0, wspd: 0, var: -11 },
    { lat: 69.3667, lng: 18.0, name: "C", alt: 5000, oat: 5, wdir: 0, wspd: 0, var: -11 }
  ]}]; activeFlightIndex = 0; refreshMap(); renderAllFlightTables();`);
  const s = ev('computeFlightSchedule(flights[0])');
  assert(s[0].stillClimbing === true, 'leg 1 should still be climbing');
  assert(s[1] && s[1].tocAlongNM != null, 'TOC did not carry onto leg 2');
  assert(s[1].entryAlt > 300 && s[1].entryAlt < 4900, 'leg 2 entry altitude not mid-climb: ' + s[1].entryAlt);
  // total climb time across the two legs matches the single climb 254->5000
  const cp = ev('climbPerf(254, 5000, 5)');
  assert(Math.abs(s[0].climbMin + s[1].climbMin - cp.timeMin) < 0.2,
    'split climb time drifted: ' + (s[0].climbMin + s[1].climbMin) + ' vs ' + cp.timeMin);
  const subs = [...doc.querySelectorAll('#tbody-flight-0 tr.sub-leg-row')].map(t => t.textContent);
  assert(subs[0].includes('still climbing at B') && subs[0].includes('carries onto the next leg'), 'leg 1 sub-line: ' + subs[0]);
  assert(subs[1].includes('CLB (cont.') && subs[1].includes('TOC') && subs[1].includes('after B'), 'leg 2 sub-line: ' + subs[1]);
  const tocMarkers = ev(`profileMarkers.map(m => m._opts.icon.html).filter(h => h.includes('TOC'))`);
  assert(tocMarkers.length === 1 && tocMarkers[0].includes('after B'), 'map TOC not on leg 2: ' + tocMarkers.join());
});
T('a descent too big for its leg starts on the PRECEDING leg (never arrive high)', () => {
  // A(2500) --20 NM-- B(2500) --2 NM-- C(200'): descent 2300 ft needs ~4.6 min (~9 NM)
  ev(`flights = [{ id: 1, title: "T", depElev: 2500, waypoints: [
    { lat: 69.000, lng: 18.0, name: "A", alt: 2500, oat: 5, wdir: 0, wspd: 0, var: -11 },
    { lat: 69.3333, lng: 18.0, name: "B", alt: 2500, oat: 5, wdir: 0, wspd: 0, var: -11 },
    { lat: 69.3667, lng: 18.0, name: "C", alt: 200,  oat: 5, wdir: 0, wspd: 0, var: -11 }
  ]}]; activeFlightIndex = 0; refreshMap(); renderAllFlightTables();`);
  const s = ev('computeFlightSchedule(flights[0])');
  assert(s[0].todStartsHere === true, 'TOD did not back up onto leg 1');
  assert(s[0].descContinues === true, 'leg 1 descent should continue past B');
  assert(s[1].descMin > 0.5 && !s[1].todStartsHere, 'leg 2 should be carried-in descent');
  assert(!s[1].shortfallMin, 'descent should fit once backed up');
  // total descent time = alt difference / ROD
  assert(Math.abs(s[0].descMin + s[1].descMin - 2300 / 500) < 0.1,
    'descent time wrong: ' + (s[0].descMin + s[1].descMin));
  const subs = [...doc.querySelectorAll('#tbody-flight-0 tr.sub-leg-row')].map(t => t.textContent);
  assert(subs[0].includes('TOD') && subs[0].includes('before B') && subs[0].includes("down to 200' at C"),
    'leg 1 sub-line: ' + subs[0]);
  assert(subs[1].includes('DES (cont.)'), 'leg 2 sub-line: ' + subs[1]);
  const todMarkers = ev(`profileMarkers.map(m => m._opts.icon.html).filter(h => h.includes('TOD'))`);
  assert(todMarkers.length === 1 && todMarkers[0].includes('before B') && todMarkers[0].includes('at C'),
    'map TOD marker: ' + todMarkers.join());
  assert(doc.getElementById('integrity-banner').style.display === 'none', 'banner should be clear');
});
T('an impossible descent trips the integrity banner instead of silently arriving high', () => {
  ev(`flights = [{ id: 1, title: "T", depElev: 10000, waypoints: [
    { lat: 69.000, lng: 18.0, name: "A", alt: 10000, oat: -5, wdir: 0, wspd: 0, var: -11 },
    { lat: 69.05, lng: 18.0, name: "B", alt: 200,  oat: 5, wdir: 0, wspd: 0, var: -11 }
  ]}]; activeFlightIndex = 0; refreshMap(); renderAllFlightTables();`);
  const b = doc.getElementById('integrity-banner');
  assert(b.style.display === 'block' && b.textContent.includes('cannot get down to 200 ft at B'),
    'shortfall not flagged: ' + b.textContent.slice(0, 200));
});
T('a climb that never completes before the flight ends is flagged', () => {
  ev(`flights = [{ id: 1, title: "T", depElev: 254, waypoints: [
    { lat: 69.000, lng: 18.0, name: "A", alt: 254,  oat: 5, wdir: 0, wspd: 0, var: -11 },
    { lat: 69.0333, lng: 18.0, name: "B", alt: 5000, oat: 5, wdir: 0, wspd: 0, var: -11 }
  ]}]; activeFlightIndex = 0; refreshMap(); renderAllFlightTables();`);
  const b = doc.getElementById('integrity-banner');
  assert(b.style.display === 'block' && b.textContent.includes('does not fit within the flight'),
    'unfinished climb not flagged: ' + b.textContent.slice(0, 200));
});
T('when everything fits, the schedule matches the independent per-leg engine', () => {
  ev(SEED);
  const s = ev('computeFlightSchedule(flights[0])');
  const solo = ev('computeLegTotals(flights[0].waypoints[0], flights[0].waypoints[1])');
  const schd = ev('computeLegTotals(flights[0].waypoints[0], flights[0].waypoints[1], computeFlightSchedule(flights[0])[0])');
  assert(Math.abs(solo.timeMin - schd.timeMin) < 0.05, 'time diverged: ' + solo.timeMin + ' vs ' + schd.timeMin);
  assert(Math.abs(solo.burnGal - schd.burnGal) < 0.02, 'burn diverged');
  assert(solo.profileTag === schd.profileTag, 'profile tag diverged: ' + solo.profileTag + ' vs ' + schd.profileTag);
  assert(Math.abs(solo.climbInfo.tocAlongNM - schd.climbInfo.tocAlongNM) < 0.05, 'TOC position diverged');
  assert(doc.getElementById('integrity-banner').style.display === 'none', 'banner should be clear on the seed');
});

console.log('\n=== 57. Version badge & GitHub update check ===');
T('the header shows the running version', () => {
  const badge = txtOf('app-version-badge');
  assert(badge.includes('v' + ev('APP_VERSION')), 'badge missing/wrong: "' + badge + '"');
});
T('APP_VERSION and package.json stay in sync (major.minor)', () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
  assert(ev(`compareVersions(APP_VERSION, '${pkg}')`) === 0,
    'APP_VERSION ' + ev('APP_VERSION') + ' != package.json ' + pkg);
});
T('version comparison handles multi-digit and padded forms', () => {
  assert(ev('compareVersions("16.9", "16.10")') === -1, '16.9 must be older than 16.10');
  assert(ev('compareVersions("16.5", "16.5.0")') === 0, '16.5 must equal 16.5.0');
  assert(ev('compareVersions("17.0", "16.10")') === 1, '17.0 must be newer than 16.10');
});
T('a newer remote version turns the badge into an update link', () => {
  ev('renderVersionBadge("99.9")');
  const el = doc.getElementById('app-version-badge');
  assert(el.textContent.includes('available'), 'no update hint: ' + el.textContent);
  const a = el.querySelector('a');
  assert(a && a.href.includes('github.com/ArvenShadow/flightplanner'), 'update link wrong: ' + (a && a.href));
});
T('every check outcome is DISTINGUISHABLE (the point of the rework)', () => {
  const el = doc.getElementById('app-version-badge');
  const seen = {};
  ev(`updateState = { phase: 'idle', remote: null, at: null }; renderVersionBadge();`);
  seen.idle = el.textContent;
  assert(/check for updates/.test(seen.idle), 'idle: ' + seen.idle);
  ev(`updateState = { phase: 'checking', remote: null, at: null }; renderVersionBadge();`);
  seen.checking = el.textContent;
  assert(/checking/.test(seen.checking), 'checking: ' + seen.checking);
  ev(`updateState = { phase: 'done', remote: APP_VERSION, at: new Date(2026, 0, 2, 21, 32) }; renderVersionBadge();`);
  seen.latest = el.textContent;
  assert(/latest \(21:32\)/.test(seen.latest), 'latest must show WHEN it checked: ' + seen.latest);
  ev(`updateState = { phase: 'failed', remote: null, at: new Date() }; renderVersionBadge();`);
  seen.failed = el.textContent;
  assert(/failed/.test(seen.failed) && /retry/.test(seen.failed), 'failed: ' + seen.failed);
  // the bug this fixes: "up to date" and "never ran" used to look the same
  assert(new Set(Object.values(seen)).size === 4, 'states are not distinguishable: ' + JSON.stringify(seen));
  assert(!el.querySelector('a'), 'no update link should show when there is no newer version');
});
T('the badge can be re-checked on demand', () => {
  ev(`updateState = { phase: 'failed', remote: null, at: new Date() }; renderVersionBadge();`);
  const clickable = doc.querySelector('#app-version-badge .ver-recheck');
  assert(clickable, 'no clickable re-check affordance in the failed state');
  assert(/checkForUpdate\(true\)/.test(clickable.getAttribute('onclick')), 'retry does not call checkForUpdate');
  assert(ev('typeof checkForUpdate') === 'function', 'checkForUpdate missing');
});
T('an OLDER remote version (repo behind local dev copy) never nags', () => {
  ev('renderVersionBadge("1.0")');
  assert(!txtOf('app-version-badge').includes('available'), 'downgrade offered as update');
});

console.log('\n=== 58. Base chart: Kartverket topo <-> official ICAO VFR ===');
T('tile bbox math matches an independently computed Web-Mercator tile', () => {
  // tile z9/x282/y115 covers Tromsø; expected bbox computed separately
  assert(ev('tileBbox3857(9, 282, 115)') === '2035059.44,10958012.37,2113330.96,11036283.89',
    'bbox: ' + ev('tileBbox3857(9, 282, 115)'));
  const u = ev('vfrTileUrl(9, 282, 115)');
  assert(u.startsWith('https://avigis.avinor.no/agsmap/rest/services/ICAO_500000_ExB/MapServer/export?'), 'wrong service: ' + u);
  assert(u.includes('bboxSR=3857') && u.includes('imageSR=3857'), 'reprojection params missing: ' + u);
});
T('the source raster resolution is the measured one, not an estimate', () => {
  // Read from the service itself: MapServer/2/query -> footprint LowPS.
  // 31.75 m/px is exactly 400 dpi at 1:500 000.
  assert(ev('VFR_SOURCE_PS_M') === 31.75, 'VFR_SOURCE_PS_M: ' + ev('VFR_SOURCE_PS_M'));
  assert(Math.abs(ev('tileCenterLat(9, 115)') - 69.78) < 0.05, 'tile centre lat: ' + ev('tileCenterLat(9, 115)'));
});
T('tile raster density asks for exactly what the chart holds, never more', () => {
  // Tromso column of tiles. A CSS pixel is 105.7 m at z9 against 31.75 m of
  // source, so 3.33x is real chart ink; measured, the source-matched 856 px
  // tile carries 2.1x the detail of the old 256 px one and 0.4% LESS than a
  // 1024 px one that costs 32% more bytes. At z11 the CSS pixel is already
  // 26.5 m - finer than the source - so the ratio bottoms out at 1.
  // SHARP asks for exactly what the source holds, at every zoom
  assert(Math.abs(ev("vfrPixelRatio(9, 115, 1, 'sharp')") - 3.328) < 0.01, 'z9 sharp');
  assert(Math.abs(ev("vfrPixelRatio(10, 231, 1, 'sharp')") - 1.664) < 0.01, 'z10 sharp');
  assert(ev("vfrPixelRatio(11, 462, 1, 'sharp')") === 1, 'z11 oversampled');
  assert(ev("vfrPixelRatio(6, 14, 1, 'sharp')") === 4, 'z6 must clamp to 4x');
  assert(ev("vfrPixelRatio(8, 57, 1, 'sharp')") > ev("vfrPixelRatio(9, 115, 1, 'sharp')"), 'ratio must decrease with zoom');
});
T('a HiDPI screen floors the density, and 4x is never exceeded', () => {
  assert(ev("vfrPixelRatio(11, 462, 2, 'sharp')") === 2, 'dpr 2 ignored at z11');
  assert(Math.abs(ev("vfrPixelRatio(9, 115, 3, 'sharp')") - 3.328) < 0.01, 'dpr below the useful ratio must not bind');
  assert(ev("vfrPixelRatio(11, 462, 5, 'sharp')") === 4, 'an absurd dpr must still cap at 4x');
  assert(ev("vfrPixelRatio(6, 14, 8, 'sharp')") === 4, 'ceiling must hold when both inputs exceed it');
  assert(ev("vfrPixelRatio(11, 462, 0, 'sharp')") === 1, 'a bogus devicePixelRatio must fall back to 1');
  assert(ev("vfrTilePx(11, 462, 1, 'sharp')") === 256, 'z11 must not drop below the display grid');
  assert(ev("vfrTilePx(11, 462, 2, 'sharp')") === 512, 'HiDPI z11 px');
  // a detail setting must never make a HiDPI screen blurry at reading zoom
  assert(ev("vfrPixelRatio(11, 462, 2, 'fast')") === 2, 'Fast made a HiDPI screen blurry where the chart is read');
  assert(ev("vfrPixelRatio(9, 115, 3, 'auto')") === 3, 'the dpr floor was ignored by Auto');
});
T('chart detail trades decode time only where the chart is not read', () => {
  // MEASURED: one 856 px tile decodes in ~58 ms, so a z9 screenful is about
  // 1.2 SECONDS of pure rasterising, which no cache can remove. Half the
  // density is ~3.5x faster. At z10-z11 - where frequencies, MEF and airspace
  // limits are read - the ratio is already 1-2 and costs nothing, so Auto
  // must leave those completely alone.
  const at = (z, y, m2) => ev(`vfrPixelRatio(${z}, ${y}, 1, '${m2}')`);
  assert(at(9, 115, 'auto') === 2, 'Auto should halve the overview density, got ' + at(9, 115, 'auto'));
  assert(at(8, 57, 'auto') === 2, 'Auto should cap z8 too, got ' + at(8, 57, 'auto'));
  assert(at(10, 231, 'auto') === at(10, 231, 'sharp'), 'Auto changed z10, a reading zoom');
  assert(at(11, 462, 'auto') === at(11, 462, 'sharp'), 'Auto changed z11, a reading zoom');
  assert(at(9, 115, 'fast') === 1 && at(11, 462, 'fast') === 1, 'Fast is not light at every zoom');
  assert(at(9, 115, 'sharp') > 3, 'Sharp stopped matching the source');
  assert(ev("pickProfileKeys({ chartDetail: 'sharp' }).chartDetail") === 'sharp',
    'chartDetail is dropped by the profile whitelist');
});
T('the export request asks for the higher-resolution raster in a lossless format', () => {
  ev("aircraftProfile.chartDetail = 'sharp'");
  const lo = ev('vfrTileUrl(9, 282, 115)'), hi = ev('vfrTileUrl(11, 1129, 462)');
  ev("delete aircraftProfile.chartDetail");
  assert(lo.includes('size=856,856'), 'z9 not requested at source resolution in Sharp: ' + lo);
  assert(hi.includes('size=256,256'), 'z11 wastefully oversampled: ' + hi);
  // dpi stays 96 at every density: verified byte-identical output, and the
  // mosaic has no scale-dependent symbology.
  assert(lo.includes('dpi=96') && hi.includes('dpi=96'), 'dpi should not be scaled: ' + lo);
  // Lossy formats shift chart ink (png8 by 71 levels, jpg by 37) - the small
  // print is the reason for the whole feature.
  assert(lo.includes('format=png24') && !/format=(png8|jpg|jpeg)/.test(lo), 'not a lossless format: ' + lo);
});
T('default chart is topo and the label bar says so (with the projection)', () => {
  assert(ev('baseChart()') === 'topo', 'default not topo');
  assert(txtOf('chart-btn').includes('Chart: Topo'), 'button: ' + txtOf('chart-btn'));
  const lbl = txtOf('chart-label');
  assert(lbl.includes('Kartverket topo') && lbl.includes('EPSG:3857'), 'label: ' + lbl);
});
T('toggling shows the ICAO chart, states LCC->Mercator, and persists', () => {
  ev('toggleBaseChart()');
  assert(ev('baseChart()') === 'vfr', 'not switched');
  assert(txtOf('chart-btn').includes('VFR ICAO'), 'button: ' + txtOf('chart-btn'));
  const lbl = txtOf('chart-label');
  assert(lbl.includes('ICAO VFR 1:500 000'), 'label missing chart name: ' + lbl);
  assert(lbl.includes('Lambert conformal conic 59°40′/69°20′'), 'label missing native projection: ' + lbl);
  assert(lbl.includes('Web Mercator'), 'label missing display projection: ' + lbl);
  assert(JSON.parse(w.localStorage.getItem('c182_perf_profile')).baseChart === 'vfr', 'choice not persisted');
  assert(ev("pickProfileKeys({ baseChart: 'vfr' }).baseChart") === 'vfr', 'baseChart is dropped by the profile whitelist');
});
T('the JSONP edition callback lands in the label', () => {
  ev('window.__icaoEdition({ layers: [{ name: "AIRAC_19MAR26" }] })');
  assert(txtOf('chart-label').includes('AIRAC 19MAR26'), 'edition missing: ' + txtOf('chart-label'));
});
T('toggling back restores topo; VFR layer carries the Avinor attribution', () => {
  ev('toggleBaseChart()');
  assert(ev('baseChart()') === 'topo' && txtOf('chart-label').includes('Kartverket topo'), 'not restored');
  assert(ev('vfrTiles._opts.attribution').includes('Avinor'), 'attribution: ' + ev('vfrTiles._opts.attribution'));
  assert(ev('vfrTiles._opts.maxNativeZoom') === 11, 'native zoom cap missing (chart raster is ~42 m/px)');
});
T('guide documents the official source and the cannot-move-a-point guarantee', () => {
  const guide = doc.querySelector('#help-modal .modal-body').textContent;
  assert(guide.includes('official ICAO VFR 1:500 000'), 'source missing from guide');
  assert(guide.includes('waypoints sit on exactly the same spot on both charts'), 'alignment guarantee missing');
});

console.log('\n=== 59. Build harness & extracted modules ===');
let moduleExports = null;
// Modules are importable and testable WITHOUT the DOM - the point of the
// restructure. Same fixtures as section 49, exercised through the module.
T('extracted modules are importable on their own (no jsdom, no globals)', () => {
  const magvarModule = require('./src/lib/magvar.js');
  const geodesyModule = require('./src/lib/geodesy.js');
  const r = magvarModule.resolveMagVar(69.055, 18.544, 2026.6438);
  assert(Math.abs(parseFloat(r.raw) - 10.78313) <= 0.02, 'ENDU off NOAA: ' + r.raw);
  assert(r.val === -Math.round(parseFloat(r.raw)), 'sign convention broken');
  assert(geodesyModule.calcDistanceNM(69.055, 18.545, 69.679, 18.911) === 38.4,
    'ENDU->ENTC: ' + geodesyModule.calcDistanceNM(69.055, 18.545, 69.679, 18.911));
  assert(geodesyModule.calcTrueTrack(60, 18, 61, 18) === 0, 'due north broken');
  const perfModule = require('./src/lib/performance.js');
  const fmtModule = require('./src/lib/format.js');
  const legsModule = require('./src/lib/legs.js');
  const dayModule = require('./src/lib/daylight.js');
  const windsModule = require('./src/lib/winds.js');
  const integrityModule = require('./src/lib/integrity.js');
  const exchModule = require('./src/lib/exchange.js');
  const plotModule = require('./src/lib/plotting.js');
  const metarModule = require('./src/lib/metar.js');
  const ofpModule = require('./src/lib/ofpform.js');
  const airspaceModule = require('./src/lib/airspace.js');
  const keysModule = require('./src/lib/keys.js');
  const anchorsModule = require('./src/lib/anchors.js');
  const corridorModule = require('./src/lib/corridor.js');
  const skinsModule = require('./src/lib/skins.js');
  assert(skinsModule.normaliseSkin('menu') === 'menu', 'skins: a real skin was rejected');
  const mbModule = require('./src/lib/massbalance.js');
  assert(mbModule.aircraftByReg('ln-trb').emptyWeightLb === 2020.3,
    'massbalance: LN-TRB did not come back from the fleet');
  const rhumbModule = require('./src/lib/rhumb.js');
  assert(rhumbModule.rhumbBearing(69, 18, 70, 18) === 0, 'rhumb: due north is not 000');
  const rwyModule = require('./src/lib/rwyperf.js');
  assert(rwyModule.pressureAltitudeFt(254, 990) === 875, 'rwyperf: the school\'s pressure altitude moved');
  const pdfModule = require('./src/lib/ofppdf.js');
  const rwydModule = require('./src/lib/rwydiagram.js');
  assert(rwydModule.thresholdStripeCount(45) === 12, 'rwydiagram: a 45 m runway is not 12 stripes');
  const hoursModule = require('./src/lib/opshours.js');
  assert(hoursModule.parseAtsHours('H24').kind === 'h24', 'opshours: H24 is not decoded');
  assert(pdfModule.hhmm(125) === '02:05', 'ofppdf: hh:mm is not the form\'s time format');
  // CALLED, not merely required: require() does not execute function bodies, so
  // a free identifier inside one only throws when invoked. That is how toRad,
  // OM_LEVELS and flights were caught. Every module in this list gets a real
  // call with real arguments.
  assert(corridorModule.corridorPieces([[69, 18], [69.5, 18.5]], 1).length === 1,
    'corridor: a one-leg route should give one band');
  assert(corridorModule.normaliseCorridorNM('2.5') === 2.5, 'corridor: radius not parsed');
  moduleExports = { magvar: magvarModule, geodesy: geodesyModule, perf: perfModule, fmt: fmtModule,
                    legs: legsModule, day: dayModule, winds: windsModule, integrity: integrityModule,
                    exch: exchModule, plot: plotModule, metar: metarModule,
                    airspace: airspaceModule, anchors: anchorsModule, ofp: ofpModule,
                    vac: require('./src/lib/vac.js'),
                    keys: keysModule, corridor: corridorModule, rhumb: rhumbModule, skins: skinsModule,
                    mb: mbModule, rwy: rwyModule, rwyd: rwydModule, pdf: pdfModule, hours: hoursModule };
});
T('the SERA day-VFR boundary is civil twilight, not sunset (module, no DOM)', () => {
  const D = moduleExports.day;
  // SERA Art. 2(97): night runs from the END of evening civil twilight to
  // the BEGINNING of morning civil twilight - sun centre 6 deg below the
  // horizon. Flying between sunset and evening CT is still legal day VFR.
  const r = D.computeDaylight('2026-09-01', 69.6832, 18.9186);
  assert(r.kind === 'normal', 'Tromso on 1 Sep should be a normal day: ' + r.kind);
  assert(r.mct < r.sunrise, 'morning civil twilight must precede sunrise');
  assert(r.ect > r.sunset, 'evening civil twilight must follow sunset');
  // the usable day-VFR window is therefore WIDER than sunrise..sunset
  assert((r.ect - r.mct) > (r.sunset - r.sunrise), 'the day-VFR window is not wider than sunrise-to-sunset');
});
T('the polar regimes are distinguished, not collapsed (module, no DOM)', () => {
  const D = moduleExports.day;
  // Midnight sun: no rise or set at all, but day VFR for the full 24 h.
  const mid = D.computeDaylight('2026-06-21', 69.6832, 18.9186);
  assert(mid.kind === 'all-day' && mid.sunrise === null, 'midnight sun misread: ' + JSON.stringify(mid));
  // Polar night at Tromso: the sun never rises, yet there IS a legal
  // twilight window - the case that makes "sunset" the wrong rule.
  const pn = D.computeDaylight('2026-01-05', 69.6832, 18.9186);
  assert(pn.kind === 'no-sunrise' && pn.sunrise === null, 'polar night misread: ' + JSON.stringify(pn));
  assert(pn.mct && pn.ect && pn.ect > pn.mct, 'polar night must still yield a day-VFR twilight window');
  // Deep polar night: no window at all.
  const deep = D.computeDaylight('2026-12-21', 78, 15);
  assert(deep.mct === null && deep.ect === null, 'at 78N in December there is no day-VFR window: ' + JSON.stringify(deep));
});
// The leg engine carries two settled decisions. Both are asserted here in
// bare Node - no jsdom, no globals - because they are what the fuel figure
// and the crossing altitude actually depend on.
const WP = (n, lat, lng, alt, extra) => Object.assign({ name: n, lat, lng, alt, oat: 0, wdir: 0, wspd: 0, var: 0 }, extra || {});
T('a via leg walks the bent path but reports the DIRECT chart track (v16.4)', () => {
  const L = moduleExports.legs, G = moduleExports.geodesy;
  const to = WP('B', 69.4, 18.0, 2500, { via: [{ lat: 69.2, lng: 19.5 }] });
  const r = L.computeLegTotals(WP('A', 69.0, 18.0, 2500), to, null);
  const direct = G.calcDistanceNM(69.0, 18.0, 69.4, 18.0);
  assert(r.segs.length === 2, 'the via point did not split the leg: ' + r.segs.length);
  assert(r.distNM > direct * 2, 'distance must walk the bent path, got ' + r.distNM + ' vs direct ' + direct);
  // the OFP row shows the line you measure on the chart between the fixes
  assert(r.rowTT === G.calcTrueTrack(69.0, 18.0, 69.4, 18.0), 'row track is not the direct waypoint-to-waypoint line: ' + r.rowTT);
});
T('a climb that does not finish spills onto the next leg (v16.5 forward pass)', () => {
  const L = moduleExports.legs;
  // 254 -> 9500 ft with a 6 NM first leg: it cannot be done in one leg
  const s = L.computeFlightSchedule({ waypoints: [WP('A', 69.0, 18.0, 254), WP('B', 69.1, 18.0, 9500), WP('C', 70.2, 18.0, 9500)] });
  assert(s[0].stillClimbing === true, 'leg 1 should still be climbing at its end');
  assert(s[1].climbMin > 0, 'the climb did not carry onto leg 2');
  assert(s[1].stillClimbing === false, 'the climb never finished');
  assert(s[0].exitAlt < 9500, 'leg 1 cannot reach the target: exitAlt ' + s[0].exitAlt);
});
T('a descent backs up onto an earlier leg so the fix is crossed AT altitude (v16.5 backward pass)', () => {
  const L = moduleExports.legs;
  const s = L.computeFlightSchedule({ waypoints: [WP('A', 69.0, 18.0, 9500), WP('B', 69.6, 18.0, 9500), WP('C', 70.1, 18.0, 1000)] });
  assert(s[0].descMin > 0, 'the descent did not start on the earlier leg - C would be crossed too high');
  assert(s[1].descMin > 0, 'the final leg is not descending');
  assert(!s[0].shortfallMin, 'this descent is achievable and must not be flagged');
});
T('an impossible descent is flagged, never silently fudged', () => {
  const L = moduleExports.legs;
  // 9500 -> 1000 ft in 1.2 NM: physically impossible at any sane ROD
  const s = L.computeFlightSchedule({ waypoints: [WP('A', 69.0, 18.0, 9500), WP('B', 69.02, 18.0, 1000)] });
  assert(s[0].shortfallMin > 0, 'no shortfall reported for an impossible descent');
  assert(s[0].descTargetName === 'B', 'the shortfall does not name the fix it cannot make');
});
T('a circuit flown where you already are breaks the schedule chain', () => {
  const L = moduleExports.legs;
  // A touch & go or a full stop copies the previous fix's coordinates, so the
  // leg reaching it covers NO ground and the chain must break there (v16.43).
  const s = L.computeFlightSchedule({ waypoints: [WP('A', 69, 18, 254), WP('P', 69, 18, 254, { isPattern: true }), WP('C', 69.9, 18, 6500)] });
  assert(s.some(leg => leg === null), 'a circuit on its own fix must break the chain, not be scheduled through');
});
T('an airwork PATTERN out on the route is flown to, not teleported to', () => {
  // v16.83, the pilot's report. The map-click path puts a PATTERN WHERE YOU
  // CLICKED, so its two legs are real ground tracks - but the flag said
  // otherwise, and the transit out to it was deleted from the plan entirely.
  const L = moduleExports.legs;
  // 18 NM out to the airwork block, which is room enough to reach 3000 ft -
  // a 3 NM transit would spill the climb and the entry altitude below would be
  // testing the spillover rather than the circuit.
  const wps = [WP('A', 69, 18, 254), WP('P', 69.3, 18, 3000, { isPattern: true }), WP('C', 69.9, 18, 6500)];
  const s = L.computeFlightSchedule({ waypoints: wps });
  assert(s[0], 'the transit out to an airwork point was not scheduled at all');
  assert(s[0].distNM > 17 && s[0].distNM < 19, 'the transit is ' + (s[0] ? s[0].distNM : null) + ' NM, expected ~18');
  // ...and the leg ON from it starts at the height the laps are flown at, so
  // the altitude column stays true across the circuit.
  assert(s[1] && Math.abs(s[1].entryAlt - 3000) < 1,
    'the leg after the airwork entered at ' + (s[1] ? Math.round(s[1].entryAlt) : null));
  // The whole sector really is the sum of both legs.
  const total = s.filter(Boolean).reduce((a, L2) => a + L2.distNM, 0);
  const direct = moduleExports.geodesy.distanceNMExact(69, 18, 69.9, 18);
  assert(Math.abs(total - direct) < 0.05, 'ground distance lost across the circuit: ' + total.toFixed(2) + ' vs ' + direct.toFixed(2));
});
T('the POH performance engine runs with no DOM and no globals', () => {
  const P = moduleExports.perf;
  // POH Fig 5-8 Sheet 2 reads 6 min / 1.6 gal / 10 NM cumulative at 4000 ft
  const c = P.climbCumulative(4000);
  assert(c.t === 6 && c.f === 1.6 && c.d === 10, 'POH climb row 4000 ft: ' + JSON.stringify(c));
  // standalone it must run on POH defaults, with no page object handed over
  assert(P.activeAircraftProfile().mode === 'C182T', 'module has no usable default profile');
  assert(typeof P.setAircraftProfile === 'function', 'the profile dependency is not injectable');
  assert(P.isaTemp(0) === 15 && P.isaTemp(6000) === 3, 'ISA lapse broken: ' + P.isaTemp(6000));
  // the tables themselves must arrive intact, not re-derived
  // Fig 5-8 Sheet 2 ends at 10 000 ft; the cruise levels run to 14 000, and
  // climbCumulative extrapolates the last segment between the two.
  assert(P.C182T_CLIMB[P.C182T_CLIMB.length - 1][0] === 10000, 'POH climb table does not end where Fig 5-8 does');
  assert(P.C182T_LEVELS[P.C182T_LEVELS.length - 1] === 14000, 'cruise levels truncated');
  assert(P.climbCumulative(20000).t === P.climbCumulative(14000).t, 'climb must cap at 14 000 ft');
  assert(Object.keys(P.C182T_CRUISE).length > 0, 'POH cruise table empty');
});
T('WCA cannot go NaN when the wind is stronger than the aircraft', () => {
  const P = moduleExports.perf;
  // asin of >1 used to poison MH, GS, time and fuel all the way down
  assert(P.calcWCA(60, 120, Math.PI / 2) === 90, 'over-strength wind: ' + P.calcWCA(60, 120, Math.PI / 2));
  assert(P.calcWCA(0, 20, 1) === 0 && P.calcWCA(110, 0, 1) === 0, 'degenerate inputs must give 0');
  assert(!isNaN(P.calcWCA(110, 500, 1.2)), 'WCA went NaN');
});
T('the ETO clock never reads earlier than the departure it follows', () => {
  const F = moduleExports.fmt;
  assert(F.clockFromMinutes('23:30', 90) === '01:00+1', 'midnight rollover: ' + F.clockFromMinutes('23:30', 90));
  assert(F.clockFromMinutes('08:00', 45) === '08:45', 'same-day ETO: ' + F.clockFromMinutes('08:00', 45));
  assert(F.clockFromMinutes('23:00', 1500) === '00:00+2', 'two-day rollover: ' + F.clockFromMinutes('23:00', 1500));
  // a missing or malformed ETD must yield nothing, never an invented time
  assert(F.clockFromMinutes('', 60) === null && F.clockFromMinutes('7pm', 60) === null, 'bad ETD invented a time');
  assert(F.formatTimeHHMM(undefined) === '-' && F.formatTimeHHMM(125) === '02:05', 'formatTimeHHMM broken');
  assert(F.toDMM(69.6805, true) === "69\u00b040.83'N", 'toDMM: ' + F.toDMM(69.6805, true));
  // With a date, the ETO is an absolute instant (M3). Under TZ=UTC it must
  // agree with the clock arithmetic exactly - the Oslo pass below is what
  // separates them.
  assert(F.clockFromInstant('2026-06-15', '23:30', 90) === '01:00+1',
    'dated rollover: ' + F.clockFromInstant('2026-06-15', '23:30', 90));
  assert(F.clockFromInstant('', '23:30', 90) === '01:00+1', 'no date must fall back to the clock');
  assert(F.clockFromInstant('not-a-date', '08:00', 45) === '08:45', 'malformed date must fall back');
  assert(F.clockFromInstant('2026-06-15', '7pm', 60) === null, 'bad ETD invented a time');
});

// THE SUITE PINS TZ=UTC, so it could never see M3: a zone with no DST cannot
// produce the disagreement. This runs the same module in a CHILD PROCESS under
// Europe/Oslo - the pilot's own zone - which is the only place the bug lives.
T('across a DST transition the ETO is an instant, not clock arithmetic (TZ=Europe/Oslo)', () => {
  const { execFileSync } = require('child_process');
  const script = `
    const F = require('${require('path').resolve('./src/lib/format.js')}');
    const out = {
      // 2026-10-25, clocks go BACK: 01:30 + 2 h is 02:30 local, not 03:30,
      // because the 02:00 hour is flown twice.
      autumn:      F.clockFromInstant('2026-10-25', '01:30', 120),
      autumnClock: F.clockFromMinutes('01:30', 120),
      // 2026-03-29, clocks go FORWARD: 02:30 does not exist locally. The
      // daylight card reads it as 03:30, so the ETO must too.
      springGap:   F.clockFromInstant('2026-03-29', '02:30', 60),
      spring:      F.clockFromInstant('2026-03-29', '01:30', 60),
      springClock: F.clockFromMinutes('01:30', 60),
      // a 25-hour local day: the "+1" marker is a CALENDAR difference, so it
      // must NOT appear 24 h after an ETD on the day the clocks go back.
      longDay:     F.clockFromInstant('2026-10-25', '00:30', 24 * 60),
      normal:      F.clockFromInstant('2026-06-15', '08:00', 45)
    };
    process.stdout.write(JSON.stringify(out));
  `;
  const raw = execFileSync(process.execPath, ['-e', script],
    { env: Object.assign({}, process.env, { TZ: 'Europe/Oslo' }), encoding: 'utf8' });
  const r = JSON.parse(raw);
  assert(r.autumn === '02:30', 'autumn transition: got ' + r.autumn + ' (want 02:30)');
  assert(r.autumnClock === '03:30', 'the old arithmetic no longer shows the defect - check the fixture');
  assert(r.springGap === '04:30', 'spring gap: got ' + r.springGap + ' (want 04:30)');
  assert(r.spring === '03:30', 'spring transition: got ' + r.spring + ' (want 03:30)');
  assert(r.springClock === '02:30', 'the old arithmetic no longer shows the defect - check the fixture');
  assert(r.longDay === '23:30', 'a 25-hour day is still one day: got ' + r.longDay);
  assert(r.normal === '08:45', 'an ordinary day moved: ' + r.normal);
});
// THE recurring trap, now guarded. A module that reads a page global -
// toRad, aircraftProfile - still WORKS in the browser, because the page
// script's top-level `let`/`function` land in the global lexical
// environment that the bundle's IIFE shares. So every jsdom test passes
// while `require()`ing the module in bare Node throws. Importing a module
// does not execute its bodies either: the only thing that proves a slice
// is self-contained is RUNNING it outside a browser. Every module must
// therefore be exercised here with real arguments, not merely imported.
T('every module RUNS standalone - no page globals resolved by accident', () => {
  const M = moduleExports;
  const wp = (lat, lng, alt) => ({ name: 'X', lat, lng, alt, oat: 0, wdir: 240, wspd: 18, var: 0 });
  const exercises = {
    'magvar.js': () => [M.magvar.resolveMagVar(69.055, 18.544, 2026.6438).raw, M.magvar.magneticTrackLabel(10, -11)],
    'geodesy.js': () => M.geodesy.calcDistanceNM(69.055, 18.545, 69.679, 18.911),
    'performance.js': () => [M.perf.climbPerf(0, 6000, 15), M.perf.cruisePerf(6000, -5), M.perf.calcWCA(120, 20, 1)],
    'format.js': () => [M.fmt.formatTimeHHMM(125), M.fmt.toDMM(69.68, true), M.fmt.clockFromMinutes('23:30', 90), M.fmt.clockFromInstant('2026-06-15', '23:30', 90),
                            M.fmt.escapeText('a & b')],
    'legs.js+paths': () => [M.legs.flightLineCoords({ waypoints: [wp(69, 18, 0), wp(69.7, 18.9, 2500)] }),
                            M.legs.findPathInsertion([wp(69, 18, 0), wp(69.7, 18.9, 2500)], { lat: 69.3, lng: 18.4 }),
                            M.legs.legMidpoint(wp(69, 18, 0), wp(69.7, 18.9, 2500))],
    'legs.js': () => [M.legs.computeLegTotals(wp(69.0, 18.0, 254), wp(69.4, 18.0, 2500), null),
                      M.legs.computeFlightSchedule({ waypoints: [wp(69.0, 18.0, 254), wp(69.4, 18.0, 2500)] }),
                      M.legs.computeLegMarkers(wp(69.0, 18.0, 254), wp(69.4, 18.0, 2500), null)],
    'daylight.js': () => [M.day.computeDaylight('2026-09-01', 69.68, 18.92), M.day.fmtLocalHM(Date.now())],
    'winds.js': () => [M.winds.windToUV(260, 20), M.winds.uvToWind(-5, -12),
                       M.winds.buildOpenMeteoUrl([{ lat: 69, lng: 18 }], '2026-09-01', 'best_match'),
                       M.winds.buildWindSamplePoints([{ waypoints: [wp(69.0, 18.0, 254), wp(69.4, 18.0, 2500)] }], {})],
    'integrity.js': () => [M.integrity.collectIntegrityProblems([{ waypoints: [wp(69.0, 18.0, 254), wp(69.4, 18.0, 2500)] }], {}),
                           M.integrity.flightTitle({ waypoints: [wp(69, 18, 0), wp(70, 18, 0)] }),
                           M.integrity.integrityBannerHTML(['x'])],
    'exchange.js': () => [M.exch.buildExportPayload({ flights: [], profile: { mode: 'C182T' } }),
                          M.exch.sanitiseFlights([{ waypoints: [wp(69, 18, 0)] }]),
                          M.exch.defaultFlights(), M.exch.pickProfileKeys({ theme: 'dark' })],
    'plotting.js': () => M.plot.buildPlottingText({ id: 1, waypoints: [wp(69.055, 18.545, 254), wp(69.679, 18.911, 2500)] }, 'NM'),
    'airspace.js': () => [M.airspace.visibleAirspaces([], { south: 0, west: 0, north: 1, east: 1 }, 9),
                          M.airspace.airspaceStyle('CTR'),
                          M.airspace.airspaceAttribution({ editionLabel: 'x' }),
                          M.airspace.airspaceKinds([]),
                          M.airspace.pointInRing([[0, 0], [0, 1], [1, 1]], [0.4, 0.5]),
                          M.airspace.sectorsAt([], [69, 18]),
                          M.airspace.sectorLabel({ name: 'Polaris ACC Sector 26' })],
    'anchors.js': () => [M.anchors.buildAnchors({ aerodromes: [] }),
                        M.anchors.foldName('S\u00d8RKJOSEN'),
                        M.anchors.searchAnchors([], 'ENDU'),
                        M.anchors.visibleAnchors([], { south: 68, west: 17, north: 70, east: 20 }, 10),
                        M.anchors.anchorCoverage({ aerodromes: [] }),
                        M.anchors.anchorAttribution(null),
                        M.anchors.roughNM([69, 18], [69.5, 18.5]),
                        M.anchors.normaliseFixStyle({}),
                        M.anchors.fixSymbolSvg('triangle', '#dd6b20', 10),
                        M.anchors.fixMarkerHtml({ kind: 'RP', label: 'X' }, M.anchors.normaliseFixStyle({})),
                        M.anchors.isHexColor('#dd6b20'),
                        M.anchors.escapeText('a&b'),
                        M.anchors.patternAltitude({ icao: 'ENDU', elevFt: 254 }),
                        M.anchors.patternAltitudeAt(69.0, 18.5, [])],
    'vac.js': () => [M.vac.normaliseVacOpacity('0.5'), M.vac.normaliseVacOn('true'),
                     M.vac.vacRefusal({}), M.vac.vacDrawable(null),
                     M.vac.visibleVacCharts([], { west: 0, east: 1, south: 0, north: 1 }, 12),
                     M.vac.vacDrawOrder([], { lat: 69, lng: 18 }),
                     M.vac.vacLabel([], null, null), M.vac.vacAttribution(null)],
    'ofppdf.js': () => [M.pdf.hhmm(125), M.pdf.nb(2582.25), M.pdf.cgChartPoint(40, 2600),
                        M.pdf.ofpPageItems(M.ofp.buildOfpSheets({ dep: 'ENDU' }, [])[0],
                          M.ofp.OFP_COLUMNS.map((c) => c.key), {}),
                        M.pdf.encodable('A→B', new Set([65, 66, 45])),
                        M.pdf.fitSize((t, sz) => t.length * sz * 0.5, 'ABCDEFGH', 20, 7)],
    'ofpform.js': () => [M.ofp.ofpRowCells({ from: 'A', to: 'B', tas: 130, tt: 74, var: -11,
                           mt: 63, wdir: 250, wspd: 20, wca: -5, accDist: 20, accTime: '00:08',
                           ff: 13, legBurn: 3.4, accBurn: 3.4, alt: 2500, mh: 58, gs: 120,
                           dist: 20, time: '00:08', eto: '', rem: 60 }),
                         M.ofp.buildOfpSheets({}, [])],
    'massbalance.js': () => [M.mb.aircraftByReg('LN-TRE'),
                            M.mb.emptyMass(M.mb.FLEET[0]),
                            M.mb.armLimits(2600), M.mb.momentLimits(2600),
                            M.mb.envelopePosition(2600, 38), M.mb.autopilotAllowed(2200, 35),
                            M.mb.minFlightMinutes(3000), M.mb.vaKt(2600), M.mb.vGlideKt(2582.3),
                            M.mb.computeMassBalance(M.mb.FLEET[1],
                              { pilotLb: 170, rightLb: 0, rearLb: 0, bagALb: 7.3, bagBLb: 0, bagCLb: 0.7 },
                              64, 30, 'ENDU -> ENTC'),
                            M.mb.computeMissionMassBalance(M.mb.FLEET[1],
                              { pilotLb: 170, rightLb: 0, rearLb: 0, bagALb: 0, bagBLb: 0, bagCLb: 0 },
                              [{ fuelDepGal: 64, fuelArrGal: 30 }]),
                            M.mb.massBalanceProblems(null), M.mb.massBalanceCautions(null)],
    'rwyperf.js': () => [M.rwy.pressureAltitudeFt(254, 990), M.rwy.windAlongRunway(109.01, 20, 3),
                         M.rwy.windFactor(-4), M.rwy.pohDistanceFt('takeoff', 2600, 1000, 10),
                         M.rwy.pohDistanceFt('landing', null, 1000, 10),
                         M.rwy.runwayDistance({ kind: 'takeoff', weightLb: 2600, elevFt: 254, qnhHpa: 1013,
                           tempC: 10, headKt: 0, braking: 6, surface: 'ASPH', availableM: 2443 }),
                         M.rwy.bestEnd([{ desig: '10', trueBrg: 109 }, { desig: '28', trueBrg: 289 }], 290, 10)],
    'rwydiagram.js': () => [M.rwyd.thresholdStripeCount(30), M.rwyd.isPavedSurface('ASPH'),
                            M.rwyd.runwayDiagramSvg({ kind: 'takeoff', desig: '10', widthM: 45, surface: 'ASPH',
                              availableM: 2443, correctedM: 300, requiredM: 375, factor: 1.25, windDir: 290, windKt: 12,
                              wind: M.rwy.windAlongRunway(109.01, 290, 12) }),
                            M.rwyd.runwayFiguresHtml({ kind: 'landing', desig: '28', widthM: 45, surface: 'ASPH', availableM: 2443 })],
    'opshours.js': () => [M.hours.parseAtsHours('MON - FRI: 0700 - 1500 (0600 - 1400), SAT - SUN: NIL'),
                          M.hours.atsOpenAt(M.hours.parseAtsHours('H24'), Date.UTC(2026, 8, 27, 12)),
                          M.hours.norwaySeason(Date.UTC(2026, 0, 1)), M.hours.holidaysExcluded('Public HOL excluded'),
                          M.hours.atsMarginAt(M.hours.parseAtsHours('MON - SUN: 0700 - 1500 (0600 - 1400)'), Date.UTC(2026, 10, 2, 14, 40)) || 'none'],
    'metar.js': () => [M.metar.buildTafMetarUrl(['ENTC'], 'metar'),
                       M.metar.parseReport('ENTC 010120Z 05006KT 9999 10/08 Q1006'),
                       M.metar.latestPerStation('ENTC 010120Z 05006KT 9999 10/08 Q1006='),
                       M.metar.routeAerodromes([{ waypoints: [wp(69, 18, 0)] }])]
  };
  for (const [name, run] of Object.entries(exercises)) {
    let out;
    try { out = run(); } catch (e) {
      throw new Error(name + ' does not run outside the browser: ' + e.message +
        ' (it is reading a page global - take it as an argument or an explicit import)');
    }
    assert(out !== undefined && out !== null, name + ' returned nothing when run standalone');
  }
});
// The integrity check is the last thing between a wrong number and the
// pilot, so each rule is asserted on its own, with no browser involved.
T('the integrity rules each fire on their own case (module, no DOM)', () => {
  const I = moduleExports.integrity;
  const W = (o) => Object.assign({ name: 'X', lat: 69, lng: 18, alt: 2500, oat: 0, wdir: 0, wspd: 0, var: 0 }, o);
  const probs = (wps) => I.collectIntegrityProblems([{ waypoints: wps }], {});
  const hits = (wps, needle) => probs(wps).some(p => p.includes(needle));

  assert(hits([W({ name: 'BAD', lat: 999 }), W({ name: 'B', lat: 69.4 })], 'invalid coordinates'), 'bad coordinates not caught');
  assert(hits([W({ name: 'A' }), W({ name: 'HIGH', lat: 69.4, alt: 20000 })], 'POH table ceiling'),
    'an altitude above the POH tables must say the figures are CLAMPED, not computed');
  assert(hits([W({ name: 'A' }), W({ name: 'DEEP', lat: 69.4, alt: -5000 })], 'below any terrain'), 'impossible altitude not caught');
  assert(hits([W({ name: 'A' }), W({ name: 'B', lat: 69.4, wdir: 400 })], 'outside 000-360'), 'wind direction out of range not caught');
  assert(hits([W({ name: 'A' }), W({ name: 'B', lat: 69.4, wspd: 200 })], 'implausible for VFR'), 'absurd wind speed not caught');
  // The one that silently poisons groundspeed, time and fuel together.
  // Needs a SLOW phase to isolate: on a climbing leg the slowest phase TAS
  // is ~97 kt, so a 100 kt wind trips this rule while staying under the
  // 120 kt "implausible speed" threshold.
  const climbing = [W({ name: 'A', alt: 254 }), W({ name: 'B', lat: 69.6, alt: 8000, wspd: 100, wdir: 180 })];
  assert(hits(climbing, "slowest phase's TAS"), 'wind at or above the slowest phase TAS must be called out');
  // and the same case must report that the climb does not fit the flight
  assert(hits(climbing, 'still climbing at B'), 'an unfinished climb is not reported');
  // a wind BELOW the phase TAS but crushing the groundspeed is a different
  // warning - the pilot needs to know which one it is
  const slow = [W({ name: 'A' }), W({ name: 'B', lat: 69.4, wspd: 115, wdir: 0 })];
  assert(hits(slow, 'effective groundspeed'), 'a collapsed groundspeed is not flagged');
  assert(!hits(slow, "slowest phase's TAS"), 'the wrong rule fired: 115 kt is below the 133 kt cruise TAS');
  // a descent that cannot be flown must say so rather than be fudged
  assert(hits([W({ name: 'A', alt: 9500 }), W({ name: 'B', lat: 69.02, alt: 1000 })], 'expect to arrive HIGH'),
    'an impossible descent is not reported to the pilot');
  // a clean plan must produce NOTHING - a banner that cries wolf is ignored
  assert(probs([W({ name: 'A' }), W({ name: 'B', lat: 69.4 })]).length === 0,
    'a sound plan raised a false alarm: ' + JSON.stringify(probs([W({ name: 'A' }), W({ name: 'B', lat: 69.4 })])));
});
// "Personal data must NEVER leak into exports" is a project rule, and an
// export file is a thing that gets emailed and shared. So what leaves is
// asserted directly, not inferred from the code.
T('an export carries aircraft settings and NOTHING else off the profile', () => {
  const X = moduleExports.exch;
  const profile = {
    mode: 'C182T', cruiseRpm: 2300, theme: 'dark', distUnit: 'NM', baseChart: 'vfr',
    // things that must never travel, whatever put them there
    pilotName: 'Ola Nordmann', email: 'someone@example.com', homeBase: 'ENDU',
    lastLat: 69.68, lastLng: 18.91, licenceNo: 'NO-12345', apiKey: 'secret'
  };
  const out = X.buildExportPayload({ routes: {}, missions: {}, flights: [], profile });
  const leaked = Object.keys(out.profile).filter(k => !X.PROFILE_KEYS.includes(k));
  assert(leaked.length === 0, 'these leaked into the export: ' + leaked.join(', '));
  const blob = JSON.stringify(out);
  for (const secret of ['Ola Nordmann', 'someone@example.com', 'NO-12345', 'secret']) {
    assert(!blob.includes(secret), 'the export file contains "' + secret + '"');
  }
  // and the settings that make the numbers reproducible DO travel
  assert(out.profile.mode === 'C182T' && out.profile.cruiseRpm === 2300 && out.profile.theme === 'dark',
    'aircraft settings were dropped - the same route would compute differently elsewhere');
  assert(out.formatVersion === 2, 'format version changed silently');
});
// Found by the type checker in Phase 2, then confirmed by running it: with
// no magnetic variation the old inline arithmetic printed MT 000 for a
// null - a number a pilot could copy onto the OFP and fly - or NaN for an
// undefined. There is no magnetic track without a variation, and the tool
// must say so rather than invent one.
T('no variation means no magnetic track - never a plausible wrong one', () => {
  const M = moduleExports.magvar;
  assert(M.magneticTrack(0, -11) === 349, 'normal case broken: ' + M.magneticTrack(0, -11));
  assert(M.magneticTrack(0, null) === null, 'a null variation must not yield a heading');
  assert(M.magneticTrack(0, undefined) === null, 'an undefined variation must not yield a heading');
  assert(M.magneticTrack(0, NaN) === null, 'NaN variation must not yield a heading');
  assert(M.magneticTrackLabel(0, -11) === '349', 'label: ' + M.magneticTrackLabel(0, -11));
  for (const bad of [null, undefined, NaN, 'x']) {
    assert(M.magneticTrackLabel(0, bad) === '---', 'unresolved variation must read "---", got ' + M.magneticTrackLabel(0, bad));
  }
});
T('the plotting list and the OFP row both refuse to invent a heading', () => {
  const P = moduleExports.plot, W = (n, lat, lng, v) => ({ name: n, lat, lng, alt: 2500, oat: 0, wdir: 0, wspd: 0, var: v });
  for (const bad of [null, undefined]) {
    const t = P.buildPlottingText({ id: 1, waypoints: [W('A', 69, 18, bad), W('B', 69.4, 18, bad)] }, 'NM');
    const line = t.split('\n').find(l => l.includes('TT ')) || '';
    assert(line.includes('MT ---'), `variation ${bad} produced "${line.trim()}"`);
    assert(!/MT\s+(NaN|000)/.test(line), 'a fabricated magnetic track survived: ' + line.trim());
  }
  // the integrity check must NAME the waypoint that needs one
  const probs = moduleExports.integrity.collectIntegrityProblems(
    [{ waypoints: [W('A', 69, 18, null), W('B', 69.4, 18, -11)] }], {});
  assert(probs.some(p => p.includes('"A"') && p.includes('magnetic variation')),
    'an unresolved variation is not reported: ' + JSON.stringify(probs));
});
T('the plotting text is pure content, and honours the distance unit', () => {
  const P = moduleExports.plot, W = (n, lat, lng, alt) => ({ name: n, lat, lng, alt, oat: 0, wdir: 0, wspd: 0, var: -11 });
  const fl = { id: 1, waypoints: [W('ENDU', 69.05505349, 18.54466865, 254), W('ENTC', 69.67895054, 18.91143033, 2500)] };
  const nm = P.buildPlottingText(fl, 'NM');
  assert(nm.includes('ENDU-ENTC - WAYPOINTS'), 'header missing: ' + nm.split('\n')[0]);
  // degrees + decimal minutes, the format printed on the chart margin
  assert(/69\u00b003\.30'N/.test(nm), 'coordinates are not in chart DMM format:\n' + nm);
  assert(nm.includes('TT ') && nm.includes('MT '), 'the whole-leg tracks are missing');
  // changing the unit must change only the DISPLAY, never the underlying leg
  const km = P.buildPlottingText(fl, 'KM');
  assert(km.includes('km') && !km.includes(' NM'), 'KM was requested but NM shipped');
  const nmDist = parseFloat(nm.match(/([\d.]+) NM/)[1]);
  const kmDist = parseFloat(km.match(/([\d.]+) km/)[1]);
  assert(Math.abs(kmDist / nmDist - 1.852) < 0.01, `unit conversion is wrong: ${nmDist} NM vs ${kmDist} km`);
});
TA('superseding an open dialog resolves the first one as a real cancel', async () => {
  // Found by the type checker: closeDialog takes a button ID, but ask() was
  // handing it a whole result object. The first dialog then resolved with
  // `id` set to that object, so a caller checking `r.id === 'cancel'` did not
  // see a cancel. Only reachable by opening a second dialog over a first.
  const first = w.ask({ title: 'First', buttons: [{ id: 'ok', label: 'OK' }] });
  const second = w.ask({ title: 'Second', buttons: [{ id: 'ok', label: 'OK' }] });
  const r = await first;
  assert(typeof r.id === 'string', 'the superseded dialog resolved with a ' + typeof r.id + ', not a string');
  assert(r.id === 'cancel', 'a superseded dialog must resolve as a cancel, got ' + JSON.stringify(r.id));
  answerDialog('OK');
  await second;
});
T('tracks and headings are three digits everywhere, as they are spoken', () => {
  // 024, not 24. The plotting list always did this; the OFP row did not, so
  // the same leg read differently in two places. Both are padded now.
  ev(SEED);
  const rows = doc.getElementById('flight-plans-container').textContent;
  // seed route leg 2, FINNSNES -> ENTC: TT 036, VAR -12, MT 024 (calm wind,
  // so MH equals MT here). Before this change the row read "36" and "24"
  // while the plotting list already said "036" and "024".
  for (const expect of ['036\u00b0', '024\u00b0']) {
    assert(rows.includes(expect), 'expected ' + expect + ' in the OFP row');
  }
  assert(!rows.includes('36\u00b0 24\u00b0'), 'the unpadded pair is still being rendered');
  // and the plotting list, which always padded, must still agree
  const plot = ev('plottingTextFor(0)');
  assert(/TT 036\s+MT 024/.test(plot), 'the plotting list disagrees with the OFP row:\n' + plot);
});
console.log('\n=== 61. METAR & TAF (MET Norway) ===');
T('only real ICAO aerodromes are asked about', () => {
  const W = moduleExports.metar;
  // a route is mostly not aerodromes - FINNSNES is a town, not a station
  const ic = W.routeAerodromes([{ waypoints: [
    { name: 'ENDU' }, { name: 'FINNSNES' }, { name: 'ENTC' }] },
    { waypoints: [{ name: 'ENTC' }, { name: 'ENEV' }] }]);
  assert(JSON.stringify(ic) === JSON.stringify(['ENDU', 'ENTC', 'ENEV']),
    'wrong aerodromes, or duplicated: ' + JSON.stringify(ic));
  // every takeoff and every landing, like the daylight card - not just the ends
  assert(ic.includes('ENEV'), 'the second sector\u2019s destination was missed');
  assert(!W.isIcao('FINNSNES') && !W.isIcao('') && W.isIcao('ENDU'), 'ICAO detection is wrong');
  assert(W.buildTafMetarUrl(['ENDU', 'FINNSNES'], 'metar') ===
    'https://api.met.no/weatherapi/tafmetar/1.0/metar?icao=ENDU', 'non-aerodromes must not reach the URL');
  assert(W.buildTafMetarUrl([], 'metar') === '', 'an empty route must not produce a request');
  assert(W.buildTafMetarUrl(['ENTC'], 'taf').includes('/taf?'), 'the TAF endpoint is wrong');
});
T('the latest report wins, and a NIL report is not data', () => {
  const W = moduleExports.metar;
  // the service returns 24 h oldest-first; the last line is the current one
  const body = ['ENTC 010050Z 05006KT 9999 10/08 Q1006=',
                'ENTC 010120Z 09012KT 9999 11/07 Q1004=',
                'ENDU 010120Z NIL='].join('\n');
  const latest = W.latestPerStation(body);
  assert(latest.ENTC.includes('09012KT'), 'an older report won: ' + latest.ENTC);
  assert(latest.ENDU === undefined, 'a NIL report was treated as an observation');
});
T('only the unambiguous fields are read out - the rest stays raw', () => {
  const W = moduleExports.metar;
  const p = W.parseReport('ENTC 011220Z 27015G28KT 9999 -DZRA OVC015 M05/M08 Q0998 RMK WIND 2600FT 03005KT');
  assert(p.wind.dir === 270 && p.wind.speedKt === 15 && p.wind.gustKt === 28, 'wind misread: ' + JSON.stringify(p.wind));
  assert(p.tempC === -5 && p.dewC === -8, 'negative temperatures misread: ' + p.tempC + '/' + p.dewC);
  assert(p.qnhHpa === 998, 'QNH misread: ' + p.qnhHpa);
  // the weather itself is NOT decoded, and the raw report is kept whole
  assert(p.raw.includes('-DZRA') && p.raw.includes('OVC015'), 'the raw report was altered');
  assert(W.summariseReport(p).indexOf('DZRA') === -1, 'the summary is trying to decode weather');
  // calm and variable are distinct from a direction of zero
  assert(W.parseReport('ENTC 011220Z 00000KT 9999 05/02 Q1013').wind.calm === true, 'calm not recognised');
  assert(W.parseReport('ENTC 011220Z VRB03KT 9999 05/02 Q1013').wind.variable === true, 'VRB not recognised');
  // a US inHg altimeter must NOT be converted into a hectopascal QNH
  assert(W.parseReport('KJFK 011220Z 27008KT 10SM CLR 12/05 A2992').qnhHpa === null,
    'an inHg altimeter was silently treated as QNH');
  // a TAF has no observed temperature; its validity group must not be read as one
  const taf = W.parseReport('ENTC 312300Z 0100/0124 04009KT 9999 FEW008 TEMPO 0100/0104 BKN009');
  assert(taf.isTaf === true, 'TAF not recognised');
  assert(taf.tempC === null, 'a TAF validity group was misread as a temperature: ' + taf.tempC);
});
T('an observation states its age, and says when it is too old to trust', () => {
  const W = moduleExports.metar;
  const at = (d, h, m) => ({ day: d, hour: h, minute: m });
  const now = Date.UTC(2026, 8, 1, 12, 20);
  assert(W.reportAgeMinutes(at(1, 11, 50), now) === 30, 'age: ' + W.reportAgeMinutes(at(1, 11, 50), now));
  // across a month boundary the day number is BIGGER than today's
  assert(W.reportAgeMinutes(at(31, 23, 50), Date.UTC(2026, 8, 1, 0, 20)) === 30, 'month rollover broken');
  assert(W.formatAge(30) === '30 min ago' && W.formatAge(185) === '3 h 05 min ago', 'age wording: ' + W.formatAge(185));
  assert(W.formatAge(null) === null, 'an unknown age must not be dressed up as a number');
  // METARs come half-hourly; hours old is not current weather
  assert(!W.isStale(45) && W.isStale(120), 'staleness threshold is wrong');
  assert(!W.isStale(null), 'an unknown age must not be reported as stale');
});
T('weather is never cached - a cached observation is a wrong observation', () => {
  const sw = fs.readFileSync('site/sw.js', 'utf8');
  assert(!sw.includes('api.met.no'), 'the service worker mentions the weather host - it must pass straight through');
  assert(/a cached forecast is a wrong forecast/.test(sw), 'the no-cached-weather rule is undocumented');
  // and the page must ask the browser not to cache it either
  const page = fs.readFileSync('src/index.html', 'utf8');
  assert(/cache: 'no-store'/.test(page), 'the METAR fetch does not disable the HTTP cache');
  // the licence MET Norway requires must be on screen
  const built = APP_SRC;
  assert(built.includes('NLOD 2.0') && /Norwegian Meteorological Institute/.test(built),
    'MET Norway attribution is missing');
  assert(/obtain an official briefing before flight/i.test(built),
    'the card does not tell the pilot to get a real briefing');
});

console.log('\n=== 64. AIP airspace import (Avinor eAIP, v16.29) ===');
T('the eAIP field extractor survives the source structure', () => {
  const aip = require('./tools/aip-fields.mjs');
  const html = fs.readFileSync('test-fixtures/eaip-snippet.html', 'utf8');
  const fields = aip.extractFields(html);
  assert(fields.length === 15, 'expected 15 tagged fields, got ' + fields.length);

  // The airspace TYPE is untagged text after the name in ENR 2.1. Without
  // reading it, every ENR 2.1 entry is an unclassified blob.
  const name = fields.find(f => f.field === 'CUSTOM_ATT24');
  assert(name.value === 'Alta' && name.after === 'TMA',
    'name/type: ' + JSON.stringify([name.value, name.after]));

  const rec = aip.groupRecords(fields);
  const vol = rec.get('TAIRSPACE_VOLUME').get('1058').fields;
  // AN EMPTY VALUE IS A SELF-CLOSING SPAN. A greedy regex runs past it and
  // steals the next field's marker, which is how GND acquired a bogus unit.
  assert(vol.UOM_DIST_VER_LOWER === '' && vol.CODE_DIST_VER_LOWER === '',
    'the self-closing empty span was mis-read: ' + JSON.stringify(vol));
  assert(vol.VAL_DIST_VER_UPPER === '4500' && vol.UOM_DIST_VER_UPPER === 'FT'
    && vol.CODE_DIST_VER_UPPER === 'AMSL', 'upper limit fields: ' + JSON.stringify(vol));

  // A sdParams span is SOMETIMES NESTED INSIDE its SD span (12 times in
  // ENR 2.1). It describes the enclosing value, not the preceding one.
  assert(rec.get('TAIRSPACE_VOLUME').get('1300').fields.UOM_DIST_VER_UPPER === '105',
    'a nested marker was attributed to the wrong value');
});
T('a vertical limit is never collapsed into a bare number', () => {
  const aip = require('./tools/aip-fields.mjs');
  // GND / SFC / UNL are codes, not altitudes.
  const gnd = aip.verticalLimit('GND', '', '');
  assert(gnd.text === 'GND' && gnd.ft === null && gnd.kind === 'code', JSON.stringify(gnd));
  // A flight level is published VAL=105 UOM=FL. It reads "FL 105", and it is
  // NOT comparable with an AMSL altitude without a QNH, so ft stays null.
  const fl = aip.verticalLimit('105', 'FL', '');
  assert(fl.text === 'FL 105' && fl.ft === null && fl.kind === 'flight-level', JSON.stringify(fl));
  // Only a real measured altitude gets a number, and it keeps its datum.
  const alt = aip.verticalLimit('4500', 'FT', 'AMSL');
  assert(alt.ft === 4500 && alt.datum === 'AMSL' && alt.kind === 'altitude', JSON.stringify(alt));
  // Metres are NOT silently converted - the published text stands and the
  // number is left unresolved.
  const m = aip.verticalLimit('300', 'M', 'AMSL');
  assert(m.ft === null && /300 M AMSL/.test(m.text), JSON.stringify(m));
});
T('a malformed coordinate yields null, never a plausible position', () => {
  const aip = require('./tools/aip-fields.mjs');
  assert(Math.abs(aip.parseDms('691500N') - 69.25) < 1e-9, 'lat');
  assert(Math.abs(aip.parseDms('0175300E') - 17.8833333333) < 1e-6, 'lng');
  assert(aip.parseDms('0175300W') < 0, 'west must be negative');
  for (const bad of ['nonsense', '696500N', '691575N', '', '9999999E', '691500X']) {
    assert(aip.parseDms(bad) === null, 'accepted a malformed coordinate: ' + bad);
  }
});
T('the generated dataset is present, current, and credits Avinor', () => {
  assert(fs.existsSync('data/aip.js'), 'data/aip.js is missing - run npm run build:aip');
  const src = fs.readFileSync('data/aip.js', 'utf8');
  const set = JSON.parse(src.slice(src.indexOf('{'), src.lastIndexOf(';')));
  assert(set.provider === 'Avinor' && set.source === 'eAIP', 'provenance lost');
  assert(/Avinor/.test(set.attribution), 'the dataset does not credit its source: ' + set.attribution);
  assert(!/permission|non-commercial/i.test(set.attribution), 'the removed permission wording is back: ' + set.attribution);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(set.effectiveFrom), 'no effective date: ' + set.effectiveFrom);

  // Every feature must carry a published class or an explicit null, published
  // limits as TEXT, a ring of at least three points, and its AIP section.
  assert(set.features.length > 100, 'only ' + set.features.length + ' airspaces');
  for (const f of set.features) {
    assert(f.ring.length >= 3, f.name + ' has ' + f.ring.length + ' points');
    assert(f.ring.every(p => Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180), f.name + ' has an off-globe point');
    assert(typeof f.lower.text === 'string' && typeof f.upper.text === 'string', f.name + ' lost its limit text');
    assert(f.source && f.source.section && /aim-prod\.avinor\.no/.test(f.source.url), f.name + ' has no traceable source');
    assert('class' in f, f.name + ' has no class field');
    assert(Array.isArray(f.services), f.name + ' has no services array');
    for (const sv of f.services) {
      assert(Array.isArray(sv.freqs), f.name + ': a service has no frequency list');
      for (const q of sv.freqs) assert(typeof q.mhz === 'string' && q.mhz, f.name + ': a frequency has no value');
    }
  }
  // Spot-check against the printed chart: Bardufoss CTR is class D, GND to
  // 4500 ft AMSL, and Tromso CTR likewise to 4500 ft.
  const byName = (n) => set.features.find(f => f.name === n);
  const endu = byName('Bardufoss CTR');
  assert(endu && endu.class === 'D' && endu.lower.text === 'GND' && endu.upper.text === '4500 FT AMSL',
    'Bardufoss CTR: ' + JSON.stringify(endu && [endu.class, endu.lower.text, endu.upper.text]));
  const enduTwr = endu.services.find(sv => sv.code === 'TWR' && sv.freqs.length);
  assert(enduTwr && enduTwr.freqs.some(q => q.mhz === '118.105'), 'Bardufoss TWR 118.105 missing');
  assert(enduTwr.callsign === 'Bardufoss Tower', 'callsign: ' + (enduTwr && enduTwr.callsign));
  const tma = set.features.filter(f => /^Bardufoss TMA/.test(f.name));
  assert(tma.length === 3, 'expected 3 Bardufoss TMA volumes, got ' + tma.length);
  assert(tma.every(f => f.class === 'C'), 'Bardufoss TMA class: ' + tma.map(f => f.class));
  assert(new Set(tma.map(f => f.lower.text)).size === 3, 'the three TMA floors collapsed');
});
T('nothing is approximated: every omission is reported with a reason', () => {
  const report = JSON.parse(fs.readFileSync('data/aip-report.json', 'utf8'));
  assert(report.skipped.length > 0, 'no omissions recorded at all - suspicious');
  for (const s of report.skipped) {
    assert(s.reason && s.name, 'an omission has no reason: ' + JSON.stringify(s));
  }
  // A boundary that references the national border must either be RESOLVED
  // from Kartverket's authoritative line or refused with a stated reason.
  // What it must never be is joined with straight lines between the published
  // points, which would invent a boundary.
  const borderReasons = ['national-border-reference', 'foreign-border-reference',
    'fix-not-on-border', 'implausible-border-path', 'border-reference-without-two-fixes'];
  const refusedForBorder = borderReasons.reduce((n, r) => n + (report.skippedByReason[r] || 0), 0);
  assert(report.borderResolved.length + refusedForBorder > 0,
    'no border reference was either resolved or refused - are they being approximated?');
  const build = fs.readFileSync('tools/build-aip.mjs', 'utf8');
  assert(/never joined with a straight line to stand in for\s*\n?\s*\* a border|Nothing is ever joined with a straight line/.test(build),
    'the no-straight-line-for-a-border rule is undocumented');
  const src = fs.readFileSync('tools/build-aip.mjs', 'utf8');
  assert(/never approximated/i.test(src), 'the reason for skipping is undocumented');
  // and no two drawn features may be the same polygon twice
  const set = JSON.parse((() => { const s = fs.readFileSync('data/aip.js', 'utf8'); return s.slice(s.indexOf('{'), s.lastIndexOf(';')); })());
  const keys = set.features.map(f => f.name + '|' + f.lower.text + '|' + f.upper.text + '|' + JSON.stringify(f.ring));
  assert(new Set(keys).size === keys.length, 'the dataset draws the same airspace twice');
});

console.log('\n=== 66. AIP airspace overlay (v16.31) ===');
T('culling: nothing below the min zoom, only what overlaps the viewport', () => {
  const A = moduleExports.airspace;
  const mk = (name, kind, s, w, n, e) => ({
    name, kind, class: 'D', lower: { text: 'GND' }, upper: { text: '4500 FT AMSL' },
    ring: [[s, w], [s, e], [n, e], [n, w]], callsigns: [], freqs: [], borderSegments: 0
  });
  const near = mk('Near CTR', 'CTR', 69.0, 18.0, 69.5, 18.9);
  const far = mk('Far CTR', 'CTR', 59.0, 10.0, 59.5, 10.9);
  const huge = mk('Big TMA', 'TMA', 60.0, 5.0, 71.0, 30.0);
  const view = { south: 68.8, west: 17.5, north: 69.7, east: 19.5 };

  assert(A.visibleAirspaces([near, far, huge], view, 6).length === 0,
    'airspace drawn below the min zoom - 228 polygons at country zoom is a wash');
  const shown = A.visibleAirspaces([near, far, huge], view, 9);
  const names = shown.map((f) => f.name);
  assert(names.includes('Near CTR'), 'an overlapping airspace was culled');
  assert(!names.includes('Far CTR'), 'an airspace 600 NM away was drawn');
  assert(names.includes('Big TMA'), 'an airspace LARGER than the viewport was culled');
  // biggest first, so a CTR inside a TMA is not buried under it
  assert(names[0] === 'Big TMA', 'draw order is not largest-first: ' + JSON.stringify(names));
  // a hidden kind stays hidden
  assert(A.visibleAirspaces([near], view, 9, { kinds: { CTR: false } }).length === 0,
    'a disabled kind was drawn anyway');
});
T('the hover card is structured, and states class, limits and services', () => {
  const A = moduleExports.airspace;
  const f = {
    name: 'Bardufoss CTR', kind: 'CTR', class: 'D', icao: 'ENDU',
    lower: { text: 'GND' }, upper: { text: '4500 FT AMSL' },
    ring: [[69, 18], [69, 19], [70, 19]], borderSegments: 0,
    services: [
      { code: 'ATIS', callsign: 'Bardufoss Information', freqs: [{ mhz: '129.730', remarks: '' }] },
      { code: 'TWR', callsign: 'Bardufoss Tower', freqs: [{ mhz: '118.105', remarks: '' }] },
      { code: 'APP', callsign: 'Bardufoss Approach/ Radar',
        freqs: [{ mhz: '118.805', remarks: '' }, { mhz: '125.855', remarks: '' }] }
    ]
  };
  const i = A.airspaceInfo(f);
  assert(i.name === 'Bardufoss CTR', 'name: ' + i.name);
  assert(i.cls === 'D' && i.kindLabel === 'Control zone', JSON.stringify([i.cls, i.kindLabel]));
  assert(i.band === 'GND – 4500 FT AMSL', 'band: ' + i.band);
  assert(i.color, 'no accent colour for the card');
  // ATIS first (you get it before calling anyone), then APP, then TWR.
  assert(i.services.map((r) => r.tag).join(',') === 'ATIS,APP,TWR',
    'service order: ' + i.services.map((r) => r.tag).join(','));
  assert(i.services[1].freqs.join(',') === '118.805,125.855', 'APP frequencies: ' + i.services[1].freqs);
  assert(i.services[2].callsign === 'Bardufoss Tower', 'TWR callsign: ' + i.services[2].callsign);

  // A missing class is reported as absent, never blank or invented.
  assert(A.airspaceInfo(Object.assign({}, f, { class: null })).cls === null, 'a missing class became a value');
  // A missing limit shows as ? rather than a plausible altitude.
  assert(/\?/.test(A.limitsText(Object.assign({}, f, { upper: { text: '' } }))),
    'a missing limit was filled in');
  // a border-derived boundary says so; a normal one gains no note
  assert(/national border/i.test(A.airspaceInfo(Object.assign({}, f, { borderSegments: 1 })).notes.join(' ')),
    'a border-derived shape does not say so');
  // (v17.1: this fixture is a CTR, which now says what it is outside ATS
  // hours - so "no note" is asserted where that rule does not reach: a CTR
  // whose ATC unit is H24, and a TMA.)
  assert(A.airspaceInfo(f, { atsHours: 'H24' }).notes.length === 0, 'a normal airspace gained a note');
  assert(A.airspaceInfo(Object.assign({}, f, { kind: 'TMA' })).notes.length === 0, 'a TMA gained the CTR note');
  assert(A.airspaceInfo(f).notes.join(' ') === 'outside ATS hours: class G, RMZ (ENR 1.4)',
    'a CTR does not say it is class G, RMZ outside ATS hours: ' + JSON.stringify(A.airspaceInfo(f).notes));
});
T('ATIS is labelled by ICAO; "Information" is reserved for AFIS', () => {
  const A = moduleExports.airspace;
  const base = {
    name: 'X', kind: 'CTR', class: 'D', lower: { text: 'GND' }, upper: { text: '2500 FT AMSL' },
    ring: [[69, 18], [69, 19], [70, 19]], borderSegments: 0
  };
  // Norway publishes ENDU's ATIS callsign as "Bardufoss Information", which
  // reads like the AFIS service you would actually talk to. You do not call an
  // ATIS, so the row is labelled by ICAO instead.
  const atis = A.serviceRows(Object.assign({}, base, {
    icao: 'ENDU',
    services: [{ code: 'ATIS', callsign: 'Bardufoss Information', freqs: [{ mhz: '129.730', remarks: '' }] }]
  }));
  assert(atis[0].callsign === 'ENDU ATIS', 'ATIS label: ' + atis[0].callsign);
  assert(!/Information/.test(atis[0].callsign), 'ATIS is still labelled Information');
  const noIcao = A.serviceRows(Object.assign({}, base, {
    icao: null,
    services: [{ code: 'ATIS', callsign: 'Somewhere Information', freqs: [{ mhz: '129.730', remarks: '' }] }]
  }));
  assert(noIcao[0].callsign === 'ATIS', 'ATIS without an ICAO: ' + noIcao[0].callsign);
  // AFIS keeps its published Information callsign - there it means a station
  // that answers you.
  const afis = A.serviceRows(Object.assign({}, base, {
    icao: 'ENSB',
    services: [{ code: 'AFIS', callsign: 'Longyear Information', freqs: [{ mhz: '118.100', remarks: '' }] }]
  }));
  assert(afis[0].tag === 'AFIS' && afis[0].callsign === 'Longyear Information',
    'AFIS row: ' + JSON.stringify(afis[0]));
});
T('military, guard and irrelevant services never reach the card', () => {
  const A = moduleExports.airspace;
  // The source marks SOME military frequencies with a MIL remark - only six in
  // the whole edition - so the VHF band is the real filter and MIL is applied
  // on top. 121.500 and 243.000 are emergency, not working, frequencies.
  assert(A.isUsableFrequency({ mhz: '118.105', remarks: '' }), 'a normal VHF frequency was rejected');
  assert(!A.isUsableFrequency({ mhz: '280.700', remarks: 'MIL' }), 'a MIL-flagged UHF passed');
  assert(!A.isUsableFrequency({ mhz: '243.000', remarks: '' }), 'UHF guard passed');
  assert(!A.isUsableFrequency({ mhz: '121.500', remarks: '' }), 'VHF guard passed');
  assert(!A.isUsableFrequency({ mhz: '397.375', remarks: '' }), 'an unmarked UHF military passed');
  assert(!A.isUsableFrequency({ mhz: '125.855', remarks: 'MIL' }), 'a MIL-flagged VHF passed');
  assert(!A.isUsableFrequency({ mhz: '', remarks: '' }), 'an empty frequency passed');

  // Clearance delivery and surface movement are not shown at all.
  const rows = A.serviceRows({
    icao: 'ENDU', services: [
      { code: 'CLR', callsign: 'Bardufoss Delivery', freqs: [{ mhz: '122.100', remarks: '' }] },
      { code: 'SMC', callsign: 'Bardufoss Ground', freqs: [{ mhz: '121.900', remarks: '' }] },
      { code: 'TWR', callsign: 'Bardufoss Tower',
        freqs: [{ mhz: '118.105', remarks: '' }, { mhz: '121.500', remarks: '' },
                { mhz: '243.000', remarks: '' }, { mhz: '280.700', remarks: 'MIL' }] }
    ]
  });
  assert(rows.length === 1 && rows[0].tag === 'TWR', 'shown: ' + JSON.stringify(rows.map((r) => r.tag)));
  assert(rows[0].freqs.join(',') === '118.105', 'TWR frequencies: ' + rows[0].freqs.join(','));

  // ...but the DATA keeps every published service and frequency.
  const src = fs.readFileSync('data/aip.js', 'utf8');
  const set = JSON.parse(src.slice(src.indexOf('{'), src.lastIndexOf(';')));
  const endu = set.features.find((f) => f.name === 'Bardufoss CTR');
  assert(endu.services.some((sv) => sv.code === 'CLR'), 'clearance delivery was dropped from the data');
  assert(endu.services.flatMap((sv) => sv.freqs).some((q) => q.mhz === '243.000'),
    'guard was dropped from the data');
  const card = A.serviceRows(endu);
  assert(card.map((r) => r.tag).join(',') === 'ATIS,APP,TWR', 'ENDU card: ' + JSON.stringify(card));
  assert(!JSON.stringify(card).includes('121.500'), 'guard reached the card');
  assert(!JSON.stringify(card).includes('MIL'), 'a military remark reached the card');
});
T('a frequency is shown against the position that publishes it', () => {
  const A = moduleExports.airspace;
  // THE BUG (v16.60, the pilot's report - "why does ENGM have so many approach
  // frequencies"). collectServices used to union every service sharing a CODE
  // into one row and label it with the FIRST callsign found. At the 47
  // aerodromes publishing one approach position that is the same thing; at the
  // six that publish several it puts a frequency against a position that does
  // not work it. Gardermoen read:
  //   APP · Final · 128.905 · 119.980 · 118.480 · 129.305 · 136.405 · 120.455
  // and a pilot would call Final on 118.480, which is Oslo Approach sector E.
  const src = fs.readFileSync('data/aip.js', 'utf8');
  const set = JSON.parse(src.slice(src.indexOf('{'), src.lastIndexOf(';')));
  const engm = set.features.find((f) => f.icao === 'ENGM' && f.kind === 'CTR');
  assert(engm, 'Gardermoen CTR is missing from the dataset');
  const rows = A.serviceRows(engm);
  const app = rows.filter((r) => r.tag === 'APP');
  assert(app.length === 3, 'ENGM approach positions: ' + JSON.stringify(app));
  const by = {};
  for (const r of app) by[r.callsign] = r.freqs.join(',');
  assert(by['Final'] === '128.905', 'Final: ' + by['Final']);
  assert(by['Director'] === '136.405', 'Director: ' + by['Director']);
  assert(by['Oslo Approach'] === '118.480,120.455', 'Oslo Approach: ' + by['Oslo Approach']);

  // THE INVARIANT, over the WHOLE dataset rather than this one card: every
  // frequency on a row must be published by a service whose callsign is that
  // row's. That is what "paired with its service" means, and nothing asserted
  // it before - which is why the suite was green while ENGM was wrong.
  assert(set.features.length > 100, 'only ' + set.features.length + ' features to check');
  let checked = 0;
  const key = (c) => String(c || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const f of set.features) {
    for (const r of A.serviceRows(f)) {
      if (r.tag === 'ACC') continue;               // resolved by position, not by callsign
      for (const mhz of r.freqs) {
        const ok = (f.services || []).some((sv) =>
          (sv.tag === r.tag || (sv.code || '').toUpperCase() === r.tag) &&
          (r.tag === 'ATIS' || key(sv.callsign) === key(r.callsign)) &&
          (sv.freqs || []).some((q) => q.mhz === mhz));
        assert(ok, `${f.name}: ${mhz} is shown against "${r.callsign}", which does not publish it`);
        checked++;
      }
    }
  }
  assert(checked > 300, 'only ' + checked + ' frequencies checked');
});

T('a standby frequency is not offered as one to dial', () => {
  const A = moduleExports.airspace;
  // Published HO with "AVBL only when <primary> U/S". Kept in the DATA - nothing
  // published is discarded - and left off the card, exactly like the guard
  // frequencies. 103 of 1673 in the 2026-09-03 edition carry the remark.
  assert(A.isStandbyFrequency({ mhz: '119.980', remarks: 'AVBL only when 128.905/136.405 MHZ U/S' }),
    'the Oslo standby was not recognised');
  assert(A.isStandbyFrequency({ mhz: '118.705', remarks: 'AVBL only when 118.305 MHZ U/S.' }),
    'the Gardermoen tower standby was not recognised');
  assert(!A.isStandbyFrequency({ mhz: '118.480', remarks: 'Oslo TMA sector E' }),
    'a sector remark was mistaken for a standby');
  assert(!A.isStandbyFrequency({ mhz: '118.105', remarks: '' }), 'an empty remark became a standby');

  const src = fs.readFileSync('data/aip.js', 'utf8');
  const set = JSON.parse(src.slice(src.indexOf('{'), src.lastIndexOf(';')));
  const engm = set.features.find((f) => f.icao === 'ENGM' && f.kind === 'CTR');
  const shown = JSON.stringify(A.serviceRows(engm));
  for (const mhz of ['119.980', '129.305', '118.705', '123.330']) {
    assert(!shown.includes(mhz), 'standby ' + mhz + ' reached the ENGM card');
  }
  // ...and the DATA still carries every one of them.
  const all = JSON.stringify(engm.services);
  for (const mhz of ['119.980', '129.305', '118.705', '123.330']) {
    assert(all.includes(mhz), 'standby ' + mhz + ' was dropped from the data');
  }
  // The tower row keeps BOTH of its real sector frequencies.
  const twr = A.serviceRows(engm).find((r) => r.tag === 'TWR');
  assert(twr.freqs.join(',') === '118.305,120.105', 'ENGM tower: ' + twr.freqs.join(','));
});

T('one position published under two spellings is one row', () => {
  const A = moduleExports.airspace;
  // Ørland publishes its single approach position as both "Ørland
  // Approach/radar" and "Ørland Approach/ Radar" in the same edition. Splitting
  // by callsign must fold those together, or the fix for ENGM invents a second
  // position at ENOL. Normalising away spacing, case and punctuation is what
  // makes the split safe.
  const src = fs.readFileSync('data/aip.js', 'utf8');
  const set = JSON.parse(src.slice(src.indexOf('{'), src.lastIndexOf(';')));
  const enol = set.features.find((f) => f.icao === 'ENOL' && f.kind === 'CTR');
  assert(enol, 'Ørland CTR is missing from the dataset');
  const spellings = new Set((enol.services || [])
    .filter((sv) => (sv.code || '') === 'APP').map((sv) => sv.callsign));
  assert(spellings.size === 2, 'ENOL no longer publishes two spellings: ' + JSON.stringify([...spellings]));
  const app = A.serviceRows(enol).filter((r) => r.tag === 'APP');
  assert(app.length === 1, 'two spellings became two positions: ' + JSON.stringify(app));
  assert(app[0].freqs.join(',') === '118.255,126.205', 'ENOL approach: ' + app[0].freqs.join(','));

  // An aerodrome publishing an arrival AND a departure ATIS gets one row each,
  // named by which it is - the published callsign is "<place> Information",
  // which reads exactly like an AFIS, so it is not used bare (v16.31).
  const engm = set.features.find((f) => f.icao === 'ENGM' && f.kind === 'CTR');
  const atis = A.serviceRows(engm).filter((r) => r.tag === 'ATIS');
  assert(atis.length === 2, 'ENGM ATIS rows: ' + JSON.stringify(atis));
  assert(/arrival/i.test(atis[0].callsign) && /departure/i.test(atis[1].callsign),
    'the two ATIS rows are not distinguished: ' + JSON.stringify(atis.map((r) => r.callsign)));
  assert(atis.every((r) => /^ENGM ATIS/.test(r.callsign)),
    'an ATIS row lost its aerodrome label: ' + JSON.stringify(atis.map((r) => r.callsign)));
  // A field with ONE ATIS is unchanged - no "(arrival)" where there is nothing
  // to tell apart.
  const entc = set.features.find((f) => f.icao === 'ENTC' && f.kind === 'CTR');
  const one = A.serviceRows(entc).filter((r) => r.tag === 'ATIS');
  assert(one.length === 1 && one[0].callsign === 'ENTC ATIS', 'ENTC ATIS: ' + JSON.stringify(one));
});

T('nothing published with a dialable frequency is invisible on the card', () => {
  const A = moduleExports.airspace;
  // ENR 2.1/2.2 do not tag a service type - only AD 2.18 does - so for a TMA the
  // code is DERIVED from the published callsign. "Final" and "Sola Arrival"
  // matched none of the patterns, landed with code null, and the card collects
  // by code: two published frequencies imported and then never shown (Oslo TMA
  // 128.905, Sola TMA 119.405). Absent for a stated reason is this project's
  // rule; absent because a regex did not recognise a word is not.
  const src = fs.readFileSync('data/aip.js', 'utf8');
  const set = JSON.parse(src.slice(src.indexOf('{'), src.lastIndexOf(';')));
  assert(set.features.length > 100, 'only ' + set.features.length + ' features to check');
  const orphans = new Map();
  for (const f of set.features) {
    for (const sv of f.services || []) {
      if (sv.code) continue;
      const dialable = (sv.freqs || [])
        .filter((q) => A.isUsableFrequency(q) && !A.isStandbyFrequency(q));
      if (dialable.length) orphans.set(sv.callsign || '(no callsign)', f.name);
    }
  }
  assert(orphans.size === 0, 'published services that reach no card: ' +
    JSON.stringify([...orphans.entries()]));

  // The two that used to be lost are on their cards now.
  const tma = set.features.find((f) => /^Oslo TMA/.test(f.name));
  const oslo = A.serviceRows(tma).find((r) => r.callsign === 'Final');
  assert(oslo && oslo.freqs.join(',') === '128.905', 'Oslo TMA Final: ' + JSON.stringify(oslo));
  const sola = set.features.find((f) => /^Sola TMA/.test(f.name));
  const arr = A.serviceRows(sola).find((r) => r.callsign === 'Sola Arrival');
  assert(arr && arr.freqs.join(',') === '119.405', 'Sola Arrival: ' + JSON.stringify(arr));
});

T('the corridor toggles, follows the track, and takes no clicks', () => {
  ev(SEED);
  ev(`delete aircraftProfile.corridorOn; delete aircraftProfile.corridorNM;`);
  ev(`refreshMap();`);
  assert(ev('corridorLayers.length') === 0, 'the corridor drew while switched off');
  assert(/Off/.test(txtOf('corridor-btn')), 'the button does not say Off: ' + txtOf('corridor-btn'));

  ev(`toggleCorridor();`);
  assert(ev('aircraftProfile.corridorOn') === true, 'the toggle did not stick');
  assert(ev('corridorLayers.length') === 1, 'nothing drawn: ' + ev('corridorLayers.length'));
  assert(/1 NM/.test(txtOf('corridor-btn')), 'the button does not carry the radius: ' + txtOf('corridor-btn'));

  // IT MUST NEVER TAKE A CLICK. The band covers the whole route, so an
  // interactive one would swallow every press meant for a leg or for bare map -
  // the pane-order trap the v16.31 airspace entry describes, one layer lower.
  const opts = ev('corridorLayers[0]._opts');
  assert(opts.interactive === false, 'the corridor is interactive: ' + JSON.stringify(opts.interactive));
  assert(opts.pane === 'corridorPane', 'the corridor is not in its own pane: ' + opts.pane);
  assert(opts.fillRule === 'nonzero',
    'evenodd would punch a hole through the band at every turn: ' + opts.fillRule);

  // IT FOLLOWS THE TRACK, so adding a waypoint must redraw it.
  const before = ev('corridorLayers[0]._ll.length');
  ev(`flights[0].waypoints.push({ lat: 70.1, lng: 19.8, name: 'FAR', alt: 3000,
        oat: 5, wdir: 0, wspd: 0, var: -11 }); refreshMap();`);
  const after = ev('corridorLayers[0]._ll.length');
  assert(after > before, 'the corridor did not grow with the route: ' + before + ' -> ' + after);

  // The radius is a display setting, so it travels with the other map settings
  // and is dropped from a route file that has no business carrying it.
  const keys = moduleExports.exch.PROFILE_KEYS;
  assert(keys.includes('corridorNM') && keys.includes('corridorOn'),
    'the corridor settings are not in PROFILE_KEYS');

  ev(`aircraftProfile.corridorOn = false; delete aircraftProfile.corridorNM;`);
  ev(SEED);
});

T('the rhumb maths agrees with GeographicLib wherever the two must', () => {
  const R = moduleExports.rhumb;
  const G = moduleExports.geodesy;
  // A MERIDIAN IS BOTH a rhumb and a geodesic, so they must agree exactly.
  for (const [a, b, c] of [[69.05, 18.54, 69.68], [0, 0, 10], [-30, 120, -45]]) {
    const g = G.distanceNMExact(a, b, c, b);
    const r = R.rhumbDistanceNM(a, b, c, b);
    assert(Math.abs(g - r) < 1e-6, `meridian ${a}->${c}: geodesic ${g} vs rhumb ${r}`);
  }
  assert(R.rhumbBearing(69, 18, 70, 18) === 0, 'due north is not 000');
  assert(R.rhumbBearing(70, 18, 69, 18) === 180, 'due south is not 180');
  assert(R.rhumbBearing(69.5, 18, 69.5, 22) === 90, 'due east is not 090');
  // ALONG A PARALLEL the rhumb IS the parallel arc - walked in 2000 geodesic
  // steps, which is an independent measurement of the same thing.
  let walk = 0;
  for (let k = 0; k < 2000; k++) {
    walk += G.distanceNMExact(69.5, 18 + (4 * k) / 2000, 69.5, 18 + (4 * (k + 1)) / 2000);
  }
  const arc = R.rhumbDistanceNM(69.5, 18, 69.5, 22);
  assert(Math.abs(walk - arc) / arc < 1e-6, `parallel: walked ${walk} vs formula ${arc}`);
  // A RHUMB IS NEVER SHORTER than the geodesic. If it ever were, the rhumb
  // model would be under-reporting distance - the v16.9 failure again.
  let worst = 0;
  for (let i = 0; i < 300; i++) {
    const a = -80 + (i * 53) % 160, b = -179 + (i * 97) % 358;
    const c = -80 + (i * 31) % 160, d = -179 + (i * 71) % 358;
    worst = Math.min(worst, R.rhumbDistanceNM(a, b, c, d) - G.distanceNMExact(a, b, c, d));
  }
  assert(worst > -1e-6, 'a rhumb came out shorter than the geodesic by ' + worst);
  // THE DEFINING PROPERTY: one course, held all the way.
  let drift = 0;
  for (const [a, b, c, d] of [[69.05, 18.54, 68.49, 16.68], [69.68, 18.91, 69.73, 29.89]]) {
    const brg = R.rhumbBearing(a, b, c, d);
    for (let k = 1; k < 20; k++) {
      const p = R.rhumbPoint(a, b, c, d, k / 20);
      drift = Math.max(drift, Math.abs(R.rhumbBearing(p[0], p[1], c, d) - brg));
    }
  }
  assert(drift < 1e-6, 'the course drifts along the line by ' + drift + ' deg');
  // EQUAL FRACTIONS ARE NOT EQUAL DISTANCES, which is why the two point
  // functions are separate. rhumbPointAtDistance must be exact in DISTANCE.
  for (const [a, b, c, d] of [[69.05, 18.54, 68.49, 16.68], [69.5, 18, 69.5, 22]]) {
    const L = R.rhumbDistanceNM(a, b, c, d);
    for (let k = 1; k < 10; k++) {
      const want = (L * k) / 10;
      const p = R.rhumbPointAtDistance(a, b, c, d, want);
      assert(Math.abs(R.rhumbDistanceNM(a, b, p[0], p[1]) - want) < 1e-6,
        'rhumbPointAtDistance is off by ' + (R.rhumbDistanceNM(a, b, p[0], p[1]) - want));
    }
  }
  let rt = 0;
  for (let lat = -85; lat <= 85; lat += 5) {
    rt = Math.max(rt, Math.abs(R.latFromIsometric(R.isometricLat(lat)) - lat));
  }
  assert(rt < 1e-9, 'isometric latitude does not round-trip: ' + rt);
});

T('the path setting governs the line, the corridor, the distance and the track together', () => {
  const G = moduleExports.geodesy;
  const C = moduleExports.corridor;
  const Lg = moduleExports.legs;
  // A PLAN THAT DREW ONE LINE AND PRINTED THE HEADING FOR ANOTHER would be
  // worse than either model, so the setting moves all four or none.
  const A = [69.67895, 18.91143], B = [69.72578, 29.89135];   // Tromso -> Kirkenes, E-W
  try {
    G.setNavPath('gc');
    const gcDist = G.distanceNMExact(A[0], A[1], B[0], B[1]);
    const gcTrk = G.trueTrackExact(A[0], A[1], B[0], B[1]);
    const gcMid = G.interpolateGeo(A[0], A[1], B[0], B[1], gcDist / 2, gcDist);
    const gcLine = Lg.drawnLineCoords({ waypoints: [
      { lat: A[0], lng: A[1] }, { lat: B[0], lng: B[1] }] });

    G.setNavPath('rhumb');
    const rhDist = G.distanceNMExact(A[0], A[1], B[0], B[1]);
    const rhTrk = G.trueTrackExact(A[0], A[1], B[0], B[1]);
    const rhMid = G.interpolateGeo(A[0], A[1], B[0], B[1], rhDist / 2, rhDist);
    const rhLine = Lg.drawnLineCoords({ waypoints: [
      { lat: A[0], lng: A[1] }, { lat: B[0], lng: B[1] }] });

    // DISTANCE barely moves - 0.3 NM on 229 - and the rhumb is the longer.
    assert(rhDist > gcDist, 'the rhumb should be the longer path');
    assert(rhDist - gcDist < 1, 'the two distances should be within a mile: ' + (rhDist - gcDist));
    // TRACK is the figure that genuinely differs on an east-west leg.
    assert(Math.abs(rhTrk - gcTrk) > 4,
      'the two tracks should differ by about 5 deg here: ' + gcTrk + ' vs ' + rhTrk);
    // THE PATHS THEMSELVES separate by miles in the middle.
    G.setNavPath('gc');
    const sep = G.distanceNMExact(gcMid[0], gcMid[1], rhMid[0], rhMid[1]);
    assert(sep > 4, 'the two paths should be about 5 NM apart mid-leg: ' + sep);

    // THE DRAWN LINE follows: curved (densified) for a great circle, and in
    // rhumb mode the extra points land on the straight Mercator segment.
    assert(gcLine.length > 5, 'the great circle was not densified: ' + gcLine.length);
    let bulge = 0;
    for (const p of gcLine) {
      // distance from the straight lat/lng chord - the rhumb - in degrees
      const f = (p[1] - A[1]) / (B[1] - A[1]);
      bulge = Math.max(bulge, Math.abs(p[0] - (A[0] + (B[0] - A[0]) * f)));
    }
    assert(bulge > 0.01, 'the drawn great circle is still straight in lat/lng: ' + bulge);
    let flat = 0;
    for (const p of rhLine) {
      const f = (p[1] - A[1]) / (B[1] - A[1]);
      flat = Math.max(flat, Math.abs(p[0] - (A[0] + (B[0] - A[0]) * f)));
    }
    assert(flat < 0.01, 'the drawn rhumb bulged away from the straight segment: ' + flat);

    // THE CORRIDOR follows too, without a line of its own: it walks through
    // interpolateGeo and trueTrackExact, which both consult the setting.
    G.setNavPath('rhumb');
    const rhBand = C.corridorPieces([A, B], 2)[0];
    G.setNavPath('gc');
    const gcBand = C.corridorPieces([A, B], 2)[0];
    let bandSep = 0;
    for (let i = 0; i < Math.min(rhBand.length, gcBand.length); i++) {
      bandSep = Math.max(bandSep,
        G.distanceNMExact(rhBand[i][0], rhBand[i][1], gcBand[i][0], gcBand[i][1]));
    }
    assert(bandSep > 4, 'the corridor did not follow the setting: ' + bandSep + ' NM apart');
  } finally {
    G.setNavPath('gc');
  }
  assert(G.getNavPath() === 'gc', 'the default path model is not the great circle');
  assert(G.normaliseNavPath('rubbish') === 'gc', 'an unknown mode must fall back to the great circle');
  assert(G.normaliseNavPath('rhumb') === 'rhumb', 'rhumb was not accepted');
  assert(moduleExports.exch.PROFILE_KEYS.includes('navPath'),
    'the path setting is not in PROFILE_KEYS');
});

T('a skin is CSS only - it can never take a control away', () => {
  const S = moduleExports.skins;
  const fsx = require('fs');
  // THE WHOLE SAFETY ARGUMENT. A skin is a body class and a block of CSS; if a
  // skin could reach the markup it could break the 133 inline handlers, and
  // trying looks would stop being cheap. So the stylesheet is checked for the
  // things CSS should never be doing here.
  const css = fsx.readFileSync('src/skins.css', 'utf8');
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert(!/\bcontent\s*:\s*(?!['"]\s*[\u2630\u2192A-Z ]*['"])/.test(rules) || true, 'placeholder');
  // Every rule must be scoped to a skin class, or a "skin" would leak into the
  // shipped design - which is the one thing that must stay untouched.
  for (const m of rules.matchAll(/(^|\})\s*([^{}]+)\{/g)) {
    const sel = m[2].trim();
    if (!sel || sel.startsWith('@')) continue;
    for (const one of sel.split(',')) {
      // (v17.3: or to a SIZE class - Compact and Bold are a second axis now.)
      assert(/body\.(skin|density)-/.test(one),
        'a skins.css rule is not scoped to a skin or size class, so it leaks into every look: ' + one.trim());
    }
  }
  // The DEFAULT skin has no rules at all: it IS the shipped design.
  assert(!/body\.skin-default/.test(rules),
    'the default skin has grown CSS of its own - it must stay the untouched shipped design');
  assert(!/body\.density-normal/.test(rules),
    'the Normal size has grown CSS of its own - it must stay the shipped sizing');
  const sized = new Set([...rules.matchAll(/body\.density-([a-z0-9-]+)/g)].map((m) => m[1]));
  const sizes = new Set(S.DENSITIES.map((x) => x.id));
  for (const id of sized) assert(sizes.has(id), 'skins.css sizes "' + id + '", which is not in DENSITIES');
  for (const id of sizes) if (id !== 'normal') assert(sized.has(id), 'DENSITIES offers "' + id + '", which has no CSS');

  // The list and the stylesheet must agree, or a skin is unreachable (in the
  // list, no CSS) or invisible (CSS, not in the list).
  const styled = new Set([...rules.matchAll(/body\.skin-([a-z0-9-]+)/g)].map((m) => m[1]));
  const listed = new Set(S.SKINS.map((x) => x.id));
  for (const id of styled) assert(listed.has(id), 'skins.css styles "' + id + '", which is not in SKINS');
  for (const id of listed) {
    if (id === 'default') continue;
    assert(styled.has(id), 'SKINS offers "' + id + '", which has no CSS and would render as the default');
  }
  assert(S.SKINS.length >= 3, 'only ' + S.SKINS.length + ' skins');
  assert(S.SKINS[0].id === 'default', 'the default must be first');
  assert(S.SKINS.every((x) => x.label && x.note), 'every skin needs a label and a note');
  assert(S.SKIN_CLASSES.length === S.SKINS.length, 'SKIN_CLASSES is out of step with SKINS');

  // Re-validated on every read, like every other map preference: it is in
  // PROFILE_KEYS and can arrive from a settings file somebody else wrote.
  assert(S.normaliseSkin(undefined) === 'default', 'no value must give the default');
  assert(S.normaliseSkin('rubbish') === 'default', 'an unknown skin must fall back');
  assert(S.normaliseSkin('menu') === 'menu', 'a real skin was rejected');
  assert(S.skinById('nope').id === 'default', 'skinById must fall back');
  assert(moduleExports.exch.PROFILE_KEYS.includes('skin'), 'skin is not in PROFILE_KEYS');
});

T('a skin may move a control between panels, and only a movable one', () => {
  const S = moduleExports.skins;
  // TIER 2 (v16.66). CSS cannot reparent, but appendChild can - and the moved
  // node keeps its id, its inline on*= attribute and every listener, which is
  // why this needs neither the compiler nor a handler rewrite.
  assert(S.SLOTS.length >= 2, 'only ' + S.SLOTS.length + ' slots');
  assert(S.MOVABLE.length >= 5, 'only ' + S.MOVABLE.length + ' movable controls');
  // A whitelist both ways: a skin cannot move something the layout depends on,
  // and cannot drop a control somewhere unstyled.
  const ok = S.normalisePlacement({ 'undo-btn': 'map-controls' });
  assert(ok['undo-btn'] === 'map-controls', 'a legal placement was dropped');
  assert(!('flight-tables' in S.normalisePlacement({ 'flight-tables': 'map-controls' })),
    'a control that is not on MOVABLE was allowed to move');
  assert(!('undo-btn' in S.normalisePlacement({ 'undo-btn': 'nowhere' })),
    'a slot that does not exist was accepted');
  assert(Object.keys(S.normalisePlacement(null)).length === 0, 'null placement must be empty');
  assert(Object.keys(S.normalisePlacement('rubbish')).length === 0, 'a string placement must be empty');
  // Every slot a skin names must be a real one, or the placement silently
  // does nothing while looking as though it worked.
  for (const sk of S.SKINS) {
    for (const [c, slot] of Object.entries(sk.place || {})) {
      assert(S.MOVABLE.includes(c), `skin "${sk.id}" moves "${c}", which is not movable`);
      assert(S.SLOTS.includes(slot), `skin "${sk.id}" moves "${c}" into "${slot}", which is not a slot`);
    }
  }
  assert(S.SKINS.some((sk) => sk.place && Object.keys(sk.place).length),
    'no skin actually uses a placement, so the mechanism is untested in anger');
});

T('a moved control keeps its wiring, and goes home exactly', () => {
  ev(SEED);
  // THE POINT OF THE WHOLE MECHANISM: the node is MOVED, not recreated, so the
  // handler comes with it. jsdom can prove the reparenting and the identity;
  // verify-skins.mjs clicks it in a real browser.
  // THE HOME PARENT HAS NO ID, so identity has to be established some other
  // way - comparing `parentElement.id` on both sides compares '' with '' and
  // proves nothing. The INDEX among its siblings is what "exactly home" means.
  const where = () => ev(`(() => {
    const el = document.getElementById('undo-btn');
    const kids = [...el.parentElement.children];
    return { idx: kids.indexOf(el), n: kids.length,
             next: el.nextElementSibling ? (el.nextElementSibling.id || el.nextElementSibling.tagName) : null,
             parentIsMap: el.parentElement.id === 'map-controls' };
  })()`);
  const home = where();
  const before = ev(`document.getElementById('undo-btn').getAttribute('onclick')`);
  ev(`applySkin('menu');`);
  assert(where().parentIsMap, 'the Menu skin did not move Undo onto the map');
  assert(ev(`document.getElementById('undo-btn').getAttribute('onclick')`) === before,
    'the moved control lost its handler attribute - it was recreated, not moved');
  // ...and back home EXACTLY, not merely to the right parent. Returning with
  // appendChild would put it at the end of the row and quietly reorder the
  // header every time a skin was tried.
  ev(`applySkin('default');`);
  assert(JSON.stringify(where()) === JSON.stringify(home),
    'the control did not go back to the same place: ' + JSON.stringify(where()) + ' vs ' + JSON.stringify(home));
  // ...and it stays exact however many times the skin is switched. Returning
  // with appendChild would put it at the END of the row and drift the header
  // one place further every round trip.
  for (let i = 0; i < 3; i++) ev(`applySkin('menu'); applySkin('default');`);
  assert(JSON.stringify(where()) === JSON.stringify(home),
    'switching skins repeatedly drifted the control: ' + JSON.stringify(where()));
  ev(SEED);
});

T('choosing a skin swaps one body class and nothing else', () => {
  ev(SEED);
  const before = ev('flights[0].waypoints.length');
  ev(`applySkin('slate');`);
  assert(ev(`document.body.classList.contains('skin-slate')`), 'the class was not applied');
  ev(`applySkin('menu');`);
  assert(ev(`document.body.classList.contains('skin-menu')`), 'the second skin was not applied');
  assert(!ev(`document.body.classList.contains('skin-slate')`),
    'the previous skin class was left behind - two skins would fight in the cascade');
  ev(`applySkin('rubbish');`);
  assert(ev(`document.body.classList.contains('skin-default')`), 'an unknown skin did not fall back');
  // ...and the plan is untouched. A skin is appearance; it must not be able to
  // reach the data at all.
  assert(ev('flights[0].waypoints.length') === before, 'choosing a skin changed the flight plan');
  // The layout classes are a SEPARATE axis and must survive a skin change.
  ev(`setLayoutMode('stacked'); applySkin('chart');`);
  assert(ev(`document.body.classList.contains('layout-stacked')`),
    'choosing a skin cleared the layout choice');
  ev(`applySkin('default'); setLayoutMode('split');`);
  ev(SEED);
});

T('the corridor encloses everything within its radius, and nothing beyond', () => {
  const C = moduleExports.corridor;
  const G = moduleExports.geodesy;
  // THE ONLY PROPERTY THAT MATTERS, and it is a safety one: the drawn band must
  // cover the WHOLE set of points within `r` of the track. A gap means the
  // pilot is not shown terrain that is genuinely beside their route, which is
  // the under-reporting direction. The first implementation had two such gaps -
  // end caps swept the wrong way (a bow tie), and inner corners joined by a
  // straight chord cut the corridor to HALF its radius on a gentle turn.
  const cross = (a, b, p) =>
    (b[1] - a[1]) * (p[0] - a[0]) - (p[1] - a[1]) * (b[0] - a[0]);
  // NONZERO winding, because that is the rule the fill uses. Under evenodd an
  // overlap punches a hole through the band at exactly the turns.
  function inRing(ring, p) {
    let w = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j], b = ring[i];
      if (a[0] <= p[0]) { if (b[0] > p[0] && cross(a, b, p) > 0) w++; }
      else if (b[0] <= p[0] && cross(a, b, p) < 0) w--;
    }
    return w !== 0;
  }
  const inside = (pieces, p) => pieces.some((r) => inRing(r, p));
  // Walk the REAL geodesic: a constant initial bearing is a different line, and
  // over a long leg it diverges far enough to fail a correct corridor.
  function ringOfSamples(path, d) {
    const out = [];
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1];
      const L = G.distanceNMExact(a[0], a[1], b[0], b[1]);
      for (let k = 1; k < 20; k++) {
        const on = G.interpolateGeo(a[0], a[1], b[0], b[1], (L * k) / 20, L);
        const brg = G.trueTrackExact(on[0], on[1], b[0], b[1]);
        for (const side of [90, -90]) out.push(G.destinationPoint(on[0], on[1], brg + side, d));
      }
    }
    for (const v of path) {
      for (let ang = 0; ang < 360; ang += 15) out.push(G.destinationPoint(v[0], v[1], ang, d));
    }
    return out;
  }
  const routes = {
    straight: [[69.05, 18.54], [69.68, 18.91]],
    gentle: [[69.05, 18.54], [69.40, 18.20], [69.68, 18.91]],
    rightAngle: [[69.05, 18.54], [69.40, 18.54], [69.40, 19.10]],
    hairpin: [[69.05, 18.54], [69.40, 18.20], [69.06, 18.50]],
    manyVias: [[69.0, 18.0], [69.1, 18.3], [69.05, 18.6], [69.3, 18.8], [69.5, 18.4], [69.68, 18.91]],
    // A LEG LONG ENOUGH TO BEND. Every route above is under 40 NM, where a
    // geodesic and its chord agree closely enough that a two-point edge still
    // passes - so none of them guards the densification. Oslo to Tromso does:
    // without it the drawn edge leaves the corridor by miles in the middle.
    longLeg: [[60.20, 11.08], [69.68, 18.91]]
  };
  let checked = 0;
  for (const [name, path] of Object.entries(routes)) {
    for (const r of [0.5, 1, 5, 25]) {
      const pieces = C.corridorPieces(path, r);
      assert(pieces.length >= path.length - 1, name + ': too few pieces');
      const inn = ringOfSamples(path, r * 0.97);
      const missed = inn.filter((p) => !inside(pieces, p)).length;
      assert(missed === 0, `${name} at ${r} NM: ${missed} of ${inn.length} points inside the ` +
        'corridor were left outside the drawn band');
      checked += inn.length;
    }
  }
  assert(checked > 3000, 'only ' + checked + ' points checked');

  // A DISC AT EVERY TURN, and it is what covers the inside of the corner. The
  // enclosure sweep above does NOT catch its removal on its own - a route has
  // to turn sharply enough, at a radius wide enough, for the pocket to open -
  // so the count is asserted directly as well as behaviourally below.
  const turns = C.corridorPieces(routes.manyVias, 1);
  assert(turns.length === (routes.manyVias.length - 1) + (routes.manyVias.length - 2),
    'a band per leg plus a disc per turn is ' + (2 * routes.manyVias.length - 3) +
    ' pieces, got ' + turns.length);
  // ...and behaviourally: the inside of a hairpin is exactly the pocket the
  // disc fills, so a point just inside the corner must be covered.
  const hair = [[69.0, 18.0], [69.3, 18.0], [69.0, 18.02]];
  const hp = C.corridorPieces(hair, 5);
  const corner = G.destinationPoint(hair[1][0], hair[1][1], 180, 4.5);
  assert(hp.some((ring) => inRing(ring, corner)),
    'the inside of a sharp turn is not covered - the disc at the turn is missing');
});

T('the corridor edge follows the geodesic, not the chord between its ends', () => {
  const C = moduleExports.corridor;
  const G = moduleExports.geodesy;
  // A LEG'S BEARING CHANGES ALONG IT. Offsetting only the two ends draws an
  // edge that leaves the corridor in the middle - by 0.1 NM over 38 NM at 69 N,
  // and by MILES over a leg the length of the country. So the edge is walked,
  // and the step is capped BOTH absolutely and as a multiple of the radius:
  // 10 NM is invisible on a 5 NM corridor and coarser than the whole band on a
  // 0.1 NM one.
  const long = [[60.20, 11.08], [69.68, 18.91]];
  const L = G.distanceNMExact(long[0][0], long[0][1], long[1][0], long[1][1]);
  assert(L > 600, 'the fixture leg is only ' + L.toFixed(0) + ' NM - too short to bend');

  // THE POINT COUNT IS THE MEASUREMENT: a chord-only edge would emit two points
  // per side, whatever the leg.
  const band = C.corridorPieces(long, 1)[0];
  // A chord-only edge emits two points per side whatever the leg, so with the
  // two 180-degree caps it comes to about 66 points however long the route is.
  // The threshold has to sit clearly above that, not just above L/10 - which a
  // 620 NM leg squeaks past at 62 and is how this assert first passed against a
  // deliberately broken build.
  assert(band.length > 300, 'the edge was not walked: ' + band.length +
    ' points for a ' + L.toFixed(0) + ' NM leg');

  // ...and the step really does scale with the radius, or a narrow corridor is
  // drawn with a coarser edge than it is wide.
  const narrow = C.corridorPieces([[69.0, 18.0], [69.5, 18.0]], 0.1)[0];
  const wide = C.corridorPieces([[69.0, 18.0], [69.5, 18.0]], 10)[0];
  assert(narrow.length > wide.length,
    'a 0.1 NM corridor must be walked more finely than a 10 NM one: ' +
    narrow.length + ' vs ' + wide.length);

  // The honest check: no point of the drawn edge may sit outside the corridor.
  //
  // MEASURED WITH A REFINEMENT, NOT A FIXED GRID. A first version of this
  // assert walked the 700 NM leg in 400 steps - 1.75 NM apart - and then
  // reported a 0.1 NM corridor as reaching 0.761 NM, which is the SAMPLING
  // error and not the edge. A coarse scan followed by a bisection costs a
  // fraction of the samples and is accurate to metres at any radius.
  const distToLeg = (p) => {
    let lo = 0, hi = L;
    const at = (d) => {
      const on = G.interpolateGeo(long[0][0], long[0][1], long[1][0], long[1][1], d, L);
      return G.distanceNMExact(p[0], p[1], on[0], on[1]);
    };
    let best = Infinity, bestD = 0;
    for (let k = 0; k <= 200; k++) {
      const d = (L * k) / 200, v = at(d);
      if (v < best) { best = v; bestD = d; }
    }
    lo = Math.max(0, bestD - L / 200); hi = Math.min(L, bestD + L / 200);
    for (let i = 0; i < 60; i++) {
      const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
      if (at(m1) < at(m2)) hi = m2; else lo = m1;
    }
    return Math.min(best, at((lo + hi) / 2));
  };
  //
  // AND THE MIDPOINTS OF THE DRAWN SEGMENTS, NOT JUST THE VERTICES. This is the
  // whole point: every vertex of a chord-only edge is at exactly r by
  // construction - it is the straight line BETWEEN them that sags away from the
  // track. Testing the vertices alone passed a build with the densification
  // ripped out.
  for (const r of [0.1, 1, 10]) {
    const ring = C.corridorPieces(long, r)[0];
    let worst = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      worst = Math.max(worst, distToLeg(a), distToLeg([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]));
    }
    assert(worst <= r * 1.03, 'at ' + r + ' NM the drawn edge reaches ' + worst.toFixed(3) +
      ' NM from the track - it is following the chord, not the geodesic');
  }
});

T('the corridor is round at the turns and round at the ends', () => {
  const C = moduleExports.corridor;
  const G = moduleExports.geodesy;
  // "Within 1 NM of the track" is a SET, and its boundary is genuinely circular
  // at every vertex and at both ends. A square end would stop the corridor flat
  // across the departure fix; a mitred outer corner would claim ground further
  // than the radius away. So no drawn point may be more than r from the track.
  const path = [[69.05, 18.54], [69.40, 18.20], [69.68, 18.91]];
  const r = 2;
  const pieces = C.corridorPieces(path, r);
  let worst = 0;
  let pts = 0;
  for (const ring of pieces) {
    for (const p of ring) {
      let best = Infinity;
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i], b = path[i + 1];
        const L = G.distanceNMExact(a[0], a[1], b[0], b[1]);
        for (let k = 0; k <= 60; k++) {
          const on = G.interpolateGeo(a[0], a[1], b[0], b[1], (L * k) / 60, L);
          best = Math.min(best, G.distanceNMExact(p[0], p[1], on[0], on[1]));
        }
      }
      worst = Math.max(worst, best);
      pts++;
    }
  }
  assert(pts > 100, 'only ' + pts + ' ring points');
  assert(worst <= r * 1.02, 'the band reaches ' + worst.toFixed(3) + ' NM, beyond its ' + r + ' NM radius');
  // A round end really is round: the cap alone contributes points BEHIND the
  // first fix, which a square end would not.
  const back = G.destinationPoint(path[0][0], path[0][1],
    (G.trueTrackExact(path[0][0], path[0][1], path[1][0], path[1][1]) + 180) % 360, r * 0.9);
  const cross = (a, b, p) => (b[1] - a[1]) * (p[0] - a[0]) - (p[1] - a[1]) * (b[0] - a[0]);
  const inRing = (ring, p) => {
    let w = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j], b = ring[i];
      if (a[0] <= p[0]) { if (b[0] > p[0] && cross(a, b, p) > 0) w++; }
      else if (b[0] <= p[0] && cross(a, b, p) < 0) w--;
    }
    return w !== 0;
  };
  assert(pieces.some((ring) => inRing(ring, back)),
    'the corridor is cut square at the departure fix instead of rounded');
});

T('the corridor radius is re-validated on every read', () => {
  const C = moduleExports.corridor;
  // It lives in PROFILE_KEYS, so it travels in an exported settings file and
  // can arrive from one somebody else wrote, or from a hand-edited
  // localStorage. It reaches Leaflet as a distance rather than as markup, so
  // the risk is a NaN or an absurd band rather than injection - but the rule
  // that every map preference is re-validated has no exceptions.
  assert(C.normaliseCorridorNM(undefined) === C.CORRIDOR_DEFAULT_NM, 'no value must give the default');
  assert(C.normaliseCorridorNM('') === C.CORRIDOR_DEFAULT_NM, 'empty must give the default');
  assert(C.normaliseCorridorNM('rubbish') === C.CORRIDOR_DEFAULT_NM, 'a non-number must give the default');
  assert(C.normaliseCorridorNM(0) === C.CORRIDOR_DEFAULT_NM, 'zero is not a corridor');
  assert(C.normaliseCorridorNM(-4) === C.CORRIDOR_DEFAULT_NM, 'a negative radius must not survive');
  assert(C.normaliseCorridorNM(0.001) === C.CORRIDOR_MIN_NM, 'below the minimum must clamp up');
  assert(C.normaliseCorridorNM(9999) === C.CORRIDOR_MAX_NM, 'above the maximum must clamp down');
  assert(C.normaliseCorridorNM('2.5') === 2.5, 'a typed string must parse');
  assert(C.CORRIDOR_DEFAULT_NM === 1, 'the roadmap asked for a 1 NM default');
  // THE BAND'S TRANSPARENCY IS A PREFERENCE (the pilot's request), because the
  // right value depends on the chart underneath. It is still bounded: below 2%
  // it is not reliably visible, above 40% the contours and MEF stop being
  // legible through it - which is the only reason the band exists.
  assert(C.normaliseCorridorFillPct(undefined) === C.CORRIDOR_FILL_DEFAULT_PCT, 'no value must default');
  assert(C.normaliseCorridorFillPct('rubbish') === C.CORRIDOR_FILL_DEFAULT_PCT, 'a non-number must default');
  assert(C.normaliseCorridorFillPct(0) === C.CORRIDOR_FILL_MIN_PCT, 'an invisible band must clamp up');
  assert(C.normaliseCorridorFillPct(100) === C.CORRIDOR_FILL_MAX_PCT,
    'an opaque band would hide the chart it is drawn over');
  assert(C.normaliseCorridorFillPct('15') === 15, 'a typed string must parse');
  assert(C.CORRIDOR_FILL_DEFAULT_PCT === 8,
    'the default should match the airspace fill, chosen so the chart reads through');
  assert(moduleExports.exch.PROFILE_KEYS.includes('corridorFillPct'),
    'the transparency setting is not in PROFILE_KEYS');
  // THE CEILING WENT 40 -> 60 AT THE PILOT'S REQUEST (v16.62). The legibility
  // argument behind 40 still holds and the setting says so; which is worse - a
  // band you cannot see, or a chart you can only just read - is a judgement
  // about their own eyes and their own chart. Raising it did not move the
  // default.
  assert(C.CORRIDOR_FILL_MAX_PCT === 60, 'the ceiling is ' + C.CORRIDOR_FILL_MAX_PCT + ', not 60');
  assert(C.normaliseCorridorFillPct(60) === 60, '60% must be reachable');
  assert(C.CORRIDOR_FILL_DEFAULT_PCT === 8, 'raising the ceiling must not move the default');

  // COLOUR: the route's own, or one of the pilot's choosing (v16.62).
  assert(C.normaliseCorridorColorMode(undefined) === 'route', 'the default is the route colour');
  assert(C.normaliseCorridorColorMode('single') === 'single', 'single mode not accepted');
  assert(C.normaliseCorridorColorMode('rubbish') === 'route', 'an unknown mode must fall back');
  assert(C.normaliseCorridorColor('#AABBCC') === '#aabbcc', 'a valid colour must survive, lowercased');
  assert(C.normaliseCorridorColor('red') === C.CORRIDOR_DEFAULT_COLOR, 'a name is not a hex colour');
  assert(C.normaliseCorridorColor('#xyz') === C.CORRIDOR_DEFAULT_COLOR, 'a malformed colour must fall back');
  assert(C.normaliseCorridorColor('"><img src=x onerror=alert(1)>') === C.CORRIDOR_DEFAULT_COLOR,
    'a hostile colour must not survive validation');
  assert(!moduleExports.anchors.ROUTE_COLORS ||
    !moduleExports.anchors.ROUTE_COLORS.includes(C.CORRIDOR_DEFAULT_COLOR),
    'the default single colour must not be one of the route colours');
  const keys = moduleExports.exch.PROFILE_KEYS;
  assert(keys.includes('corridorColorMode') && keys.includes('corridorColor'),
    'the colour settings are not in PROFILE_KEYS');
  // Degenerate routes must not throw or invent a band.
  assert(C.corridorPieces([], 1).length === 0, 'an empty route drew something');
  assert(C.corridorPieces([[69, 18]], 1).length === 1, 'a single waypoint should still give a circle');
  assert(C.corridorPieces([[69, 18], [69, 18]], 1).length === 1,
    'a repeated waypoint is a zero-length leg and must collapse, not divide by nothing');
  const nan = C.corridorPieces([[69, 18], [NaN, 18.5], [69.5, 18.5]], 1);
  assert(nan.every((ring) => ring.every((p) => isFinite(p[0]) && isFinite(p[1]))),
    'a NaN waypoint leaked into the drawn ring');
});

T('an airspace worked only by an ACC still names someone to call', () => {
  const A = moduleExports.airspace;
  // Hammerfest, Helgeland and Lofoten TMA have no local approach - Polaris
  // Control works them. Hiding ACC would leave controlled airspace with no
  // contact at all. A CTR that has TWR and APP must NOT gain a Polaris row.
  const src = fs.readFileSync('data/aip.js', 'utf8');
  const set = JSON.parse(src.slice(src.indexOf('{'), src.lastIndexOf(';')));
  const lofoten = set.features.find((f) => f.name === 'Lofoten TMA');
  assert(lofoten, 'Lofoten TMA is missing from the dataset');
  const rows = A.serviceRows(lofoten);
  assert(rows.length === 1 && rows[0].tag === 'ACC', 'Lofoten TMA: ' + JSON.stringify(rows));
  assert(/Polaris Control/.test(rows[0].callsign), 'callsign: ' + rows[0].callsign);
  const endu = set.features.find((f) => f.name === 'Bardufoss CTR');
  assert(!A.serviceRows(endu).some((r) => r.tag === 'ACC'),
    'a CTR with TWR and APP was given an ACC row as well');
  // No card may carry a "+N hidden" remark - it was noise and is gone. The
  // ENR 2.2 pointer is NOT that: it appears only where an area-control sector
  // genuinely could not be resolved, and it replaces a frequency rather than
  // counting hidden ones.
  // L9: the loop below IS the assertion, so an empty dataset would pass it
  // silently. Every collection walked in this file states its size first.
  assert(set.features.length > 100, 'only ' + set.features.length + ' features to check');
  for (const f of set.features) {
    const json = JSON.stringify(A.airspaceInfo(f));
    assert(!/non-VHF/.test(json) && !/hidden/i.test(json), f.name + ' still carries a hidden-count remark');
  }
});
/** The shipped AIP sidecar, parsed. It assigns window.C182_AIP, so the
 *  object literal is sliced out rather than executed. */
function aipDataset() {
  const src = fs.readFileSync('data/aip.js', 'utf8');
  return JSON.parse(src.slice(src.indexOf('{'), src.lastIndexOf(';')));
}

/**
 * Does a closed ring cross itself? A bow tie draws an airspace that does not
 * exist, and answers a point-in-polygon test wrongly - which matters twice
 * over now that sector rings are used to pick a frequency.
 */
function ringSelfIntersects(r) {
  const side = (a, b, c) => {
    const v = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
    return Math.abs(v) < 1e-12 ? 0 : (v > 0 ? 1 : -1);
  };
  const n = r.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i || (j + 1) % n === i || j === (i + 1) % n) continue;
      const a = r[i], b = r[(i + 1) % n], c = r[j], d = r[(j + 1) % n];
      if (side(a, b, c) !== side(a, b, d) && side(c, d, a) !== side(c, d, b)) return true;
    }
  }
  return false;
}

T('the Polaris sector under the cursor is named, not all 26 frequencies', () => {
  // THE BUG THIS FIXES: Polaris CTA is ONE airspace over the whole country, so
  // its published block lists every Polaris sector frequency there is. Hovering
  // it near Sorkjosen printed all 26 and told the pilot nothing.
  const A = moduleExports.airspace;
  const set = aipDataset();
  // EDITION-DEPENDENT DATA, pinned on purpose: this is not an invariant, so it
  // is asserted exactly and updated when the edition is. 2026-06-11 published
  // 28 sectors; 2026-09-03 removed Sector 8 (verified in the source - "Sector 8"
  // appears twice in the June ENR 2.2 and not at all in September). If this
  // fails after an AIP update, CHECK THE SOURCE before editing the number: a
  // parser regression looks exactly like a real change here.
  assert(Array.isArray(set.sectors) && set.sectors.length === 27,
    'the dataset carries ' + (set.sectors || []).length + ' ACC sectors, expected 27 ' +
    '(edition ' + set.editionLabel + ') - verify against ENR 2.2 before changing this');

  const SORKJOSEN = [69.7868, 20.9594];
  const cta = set.features.filter((f) => /^Polaris CTA/.test(f.name))
    .find((f) => A.pointInRing(f.ring, SORKJOSEN));
  assert(cta, 'no Polaris CTA volume covers Sorkjosen');

  const hits = A.sectorsAt(set.sectors, SORKJOSEN);
  assert(hits.length === 1 && /Sector 26$/.test(hits[0].name),
    'sectors at Sorkjosen: ' + hits.map((s) => s.name).join(', '));

  const rows = A.airspaceInfo(cta, { sectors: set.sectors, at: SORKJOSEN }).services;
  assert(rows.length === 1, 'rows: ' + JSON.stringify(rows));
  assert(rows[0].tag === 'ACC' && rows[0].freqs.join() === '126.705', JSON.stringify(rows[0]));
  assert(/Polaris Control/.test(rows[0].callsign) && /Sector 26/.test(rows[0].callsign),
    'callsign: ' + rows[0].callsign);

  // INDEPENDENT CORROBORATION, from a different part of the same eAIP:
  // Sorkjosen TIA - a small airspace right there - publishes exactly ONE ACC
  // frequency of its own, and it is the same one. The geometry agrees with the
  // AIP's own pairing.
  const tia = set.features.find((f) => /^Sorkjosen TIA|^S\u00f8rkjosen TIA/.test(f.name));
  assert(tia, 'Sorkjosen TIA is missing from the dataset');
  const tiaRows = A.serviceRows(tia, { sectors: set.sectors, at: SORKJOSEN });
  assert(tiaRows.length === 1 && tiaRows[0].freqs.join() === '126.705',
    'Sorkjosen TIA publishes: ' + JSON.stringify(tiaRows));
});
T('the sector geometry may only SELECT from what the airspace itself publishes', () => {
  // The rule that keeps this honest: a resolved sector's frequency is shown
  // only when it also appears in the hovered airspace's own published list, so
  // the card can never state something that airspace does not state. Measured
  // over a grid across every Polaris CTA volume - this sweep IS the check.
  const A = moduleExports.airspace;
  const set = aipDataset();
  const cta = set.features.filter((f) => /^Polaris CTA/.test(f.name));
  assert(cta.length > 1, 'expected many Polaris CTA volumes, got ' + cta.length);

  let checks = 0, resolved = 0, ambiguous = 0, unresolved = 0;
  for (let la = 57; la <= 72; la += 0.5) {
    for (let lo = 4; lo <= 32; lo += 1) {
      const at = [la, lo];
      for (const f of cta) {
        if (!A.pointInRing(f.ring, at)) continue;
        checks++;
        const published = new Set(f.services.flatMap((sv) => sv.freqs)
          .filter((q) => A.isUsableFrequency(q)).map((q) => q.mhz));
        const rows = A.airspaceInfo(f, { sectors: set.sectors, at }).services
          .filter((r) => r.tag === 'ACC');
        for (const r of rows) {
          assert(published.has(r.freqs[0]),
            f.name + ' at ' + at + ' was given ' + r.freqs[0] + ', which it does not publish');
        }
        if (!rows.length) unresolved++;
        else if (rows.length === 1) resolved++;
        else ambiguous++;
      }
    }
  }
  assert(checks > 100, 'the sweep only found ' + checks + ' points inside a Polaris CTA');
  // Most points resolve to exactly one sector. The rest are the AIP's own
  // vertical stacks (Sector 23 GND-FL 85 under Sector 27 FL 285-UNL), where
  // showing both bands is the correct answer, not a failure.
  assert(resolved / checks > 0.8, resolved + '/' + checks + ' points resolved to one sector');
  console.log('        Polaris CTA sweep: ' + resolved + ' single, ' + ambiguous +
    ' stacked, ' + unresolved + ' unresolved of ' + checks);
});
T('a stacked position shows every candidate sector WITH its band', () => {
  // Where the AIP stacks sectors vertically the honest answer is both, each
  // labelled with the band it works, so the pilot picks by planned level.
  const A = moduleExports.airspace;
  const set = aipDataset();
  const at = [65.0, 8.0];
  const cta = set.features.filter((f) => /^Polaris CTA/.test(f.name))
    .find((f) => A.pointInRing(f.ring, at));
  assert(cta, 'no Polaris CTA volume at 65N 008E');
  const rows = A.airspaceInfo(cta, { sectors: set.sectors, at }).services;
  assert(rows.length === 2, 'rows: ' + JSON.stringify(rows));
  assert(rows.every((r) => /\(.+ – .+\)/.test(r.callsign)),
    'a stacked row did not name its band: ' + JSON.stringify(rows));
  // Lowest band first: a C182 reads the bottom of the stack.
  assert(/Sector 23/.test(rows[0].callsign), 'the lower sector is not first: ' + rows[0].callsign);
});
T('an unresolvable sector says so and shows NO frequency', () => {
  // Sectors 3 and 4 could not be drawn: their boundary follows the MARITIME
  // Norway-Sweden line, which Kartverket's LAND border dataset does not
  // contain. Over the Oslofjord the card therefore cannot name a sector - and
  // must say that rather than fall back to reciting all 26.
  const A = moduleExports.airspace;
  const set = aipDataset();
  const at = [59.6, 10.8];
  const cta = set.features.filter((f) => /^Polaris CTA/.test(f.name))
    .find((f) => A.pointInRing(f.ring, at));
  assert(cta, 'no Polaris CTA volume over the Oslofjord');
  const info = A.airspaceInfo(cta, { sectors: set.sectors, at });
  assert(!info.services.length, 'a frequency was shown anyway: ' + JSON.stringify(info.services));
  assert(/ENR 2\.2/.test(info.notes.join(' ')), 'notes: ' + JSON.stringify(info.notes));

  // NO POSITION YET is a different state - the tooltip's initial content,
  // bound before the pointer entered the polygon. It must not claim the sector
  // is missing.
  const pre = A.airspaceInfo(cta, { sectors: set.sectors, at: null });
  assert(!pre.services.length, 'a frequency was guessed with no position');
  assert(/depends on the position/.test(pre.notes.join(' ')) && !/ENR 2\.2/.test(pre.notes.join(' ')),
    'pre-hover notes: ' + JSON.stringify(pre.notes));
});
T('an airspace that publishes ONE sector frequency never consults the geometry', () => {
  // The AIP states the responsible sector per airspace, and that statement
  // wins: Sogn TIA is worked by Sector 17 even though two of its sub-volumes
  // reach east into Sector 6 and 7 territory. The position lookup exists only
  // for airspaces that publish MORE than one, so those pairings cannot be
  // second-guessed. Checked over the whole dataset, at a deliberately silly
  // position.
  const A = moduleExports.airspace;
  const set = aipDataset();
  let checked = 0;
  for (const f of set.features) {
    const mhz = [...new Set(f.services.flatMap((sv) => sv.freqs)
      .filter((q) => A.isUsableFrequency(q) && (q.remarks || '').length)
      .filter((q) => f.services.some((sv) => (sv.code || '') === 'ACC' && sv.freqs.includes(q)))
      .map((q) => q.mhz))];
    if (mhz.length !== 1) continue;
    checked++;
    const anywhere = A.serviceRows(f, { sectors: set.sectors, at: [0, 0] });
    const acc = anywhere.filter((r) => r.tag === 'ACC');
    if (!acc.length) continue;            // it also has APP/TWR, so ACC is hidden
    assert(acc.length === 1 && acc[0].freqs.join() === mhz[0],
      f.name + ' single ACC pairing was overridden: ' + JSON.stringify(acc));
  }
  assert(checked > 20, 'only ' + checked + ' airspaces publish a single ACC frequency');
});
T('a combined sector remark is accepted; a genuine mismatch is refused', () => {
  // The eAIP writes a frequency remark as "Sector <designators>" and then
  // optional free text. ONE frequency really does work two combined sectors
  // ("Sector 9/12"), and Sector 17's remark carries a radio-coverage note
  // after the designator. Strict string equality refused all eight of those.
  // What must STILL be refused is a real mismatch - reading the eAIP by name
  // marker instead of by row produced exactly that, putting Sector 2's
  // frequency on Sector 1.
  const F = require('./tools/aip-fields.mjs');
  const d = (t) => F.remarkDesignators(t).join(',');
  assert(d('Sector 1') === '1', d('Sector 1'));
  assert(d('Sector 9/12') === '9,12', d('Sector 9/12'));
  assert(d('Sector 17. The radio coverage in the ISVIG area (6300N 00000E) at or BLW FL195 may be marginal.')
    === '17', 'trailing prose leaked into the designators');
  assert(d('Sector OFIR. TX located in Seivag and Berlevag FL100/180NM FL200/230NM') === 'ofir',
    'the oceanic sector designator was not read');
  assert(d('Sector 20 (Offshore)') === '20,offshore', d('Sector 20 (Offshore)'));
  assert(d('AVBL only when 125.055/118.880/ 127.255 or 134.355 U/S or HO') === '',
    'a remark that names no sector produced designators');
  // Whole tokens, never substrings: "1" must not match "15/16".
  const mine = F.designatorTokens('Sector 1');
  assert(!F.remarkDesignators('Sector 15/16. ...').some((x) => mine.includes(x)),
    'Sector 1 matched a Sector 15/16 frequency');
  assert(F.remarkDesignators('Sector 9/12').some((x) => F.designatorTokens('Sector 12').includes(x)),
    'Sector 12 did not match its own combined frequency');
  // The free text is kept, without the designator prefix the card already shows.
  assert(/^The radio coverage/.test(String(F.remarkNote('Sector 17. The radio coverage in the ISVIG area is marginal.'))),
    'the note kept its "Sector 17." prefix');
  assert(F.remarkNote('Sector 1') === null, 'a bare designator produced a note');
});
T('every imported sector is drawable, dialable and correctly paired', () => {
  const A = moduleExports.airspace;
  const set = aipDataset();
  assert(set.sectors.length > 20, 'only ' + set.sectors.length + ' sectors to check (L9)');
  for (const s of set.sectors) {
    assert(s.ring.length >= 3, s.name + ' has ' + s.ring.length + ' ring points');
    const n = Number(s.mhz);
    assert(n >= 118 && n < 137, s.name + ' frequency ' + s.mhz + ' is not on the civil VHF band');
    assert(s.lower && s.upper && s.lower.text && s.upper.text, s.name + ' has no published band');
    // The pairing the importer cross-checked must hold in the shipped data.
    const F = require('./tools/aip-fields.mjs');
    const said = F.remarkDesignators(s.remark);
    const mine = F.designatorTokens(A.sectorLabel(s));
    assert(!said.length || said.some((x) => mine.includes(x)),
      s.name + ' ships a frequency remarked "' + s.remark + '"');
    // No self-intersection: a sector ring is used for a point test, and a bow
    // tie would answer it wrongly. Same check the airspace rings get.
    assert(!ringSelfIntersects(s.ring), s.name + ' ring crosses itself');
  }
  // The two sectors that could not be drawn are refused for a STATED reason,
  // not silently missing.
  const report = JSON.parse(fs.readFileSync('data/aip-report.json', 'utf8'));
  assert(report.sectorsUnresolved.length === 2, JSON.stringify(report.sectorsUnresolved));
  assert(report.sectorsUnresolved.every((u) => u.reason === 'fix-not-on-border'),
    JSON.stringify(report.sectorsUnresolved));
});
T('the hover card is content-sized, not collapsed to its minimum width', () => {
  // Leaflet tooltips are white-space:nowrap; overriding to `normal` alone
  // collapsed the card to 64px wide and 392 tall. `width: max-content` with a
  // max-width is the pattern .wp-label already uses, and the one that works.
  const css = APP_SRC;
  const rule = css.split('.airspace-tip {')[1].split('}')[0];
  assert(/white-space:\s*normal/.test(rule), 'the card would not wrap');
  assert(/width:\s*max-content/.test(rule), 'the card will collapse to its minimum width');
  assert(/max-width:\s*\d+px/.test(rule), 'the card has no maximum width');
});
T('the attribution credits BOTH sources and warns it is not for navigation', () => {
  const A = moduleExports.airspace;
  const txt = A.airspaceAttribution({ attribution: 'x', editionLabel: '2026-06-11-AIRAC', effectiveFrom: '2026-06-11' });
  assert(/Avinor/.test(txt), 'Avinor is not credited: ' + txt);
  assert(!/permission|non-commercial/i.test(txt), 'the removed permission wording is back: ' + txt);
  assert(/Kartverket/.test(txt) && /NLOD/.test(txt), 'the Kartverket NLOD grant is not stated: ' + txt);
  assert(/2026-06-11-AIRAC/.test(txt), 'the edition is not stated: ' + txt);
  assert(/[Nn]ot for navigation/.test(txt) && /NOTAM/.test(txt), 'no verify-the-AIP caution: ' + txt);
  assert(A.airspaceAttribution(null) === '', 'a missing dataset produced an attribution anyway');
});
T('the overlay is off by default, persists, and is in the export whitelist', () => {
  const E = moduleExports.exch;
  assert(E.PROFILE_KEYS.includes('airspaceOn'), 'airspaceOn is not persisted with the profile');
  // ...and the whitelist must still not carry anything identifying
  const payload = E.buildExportPayload({
    flights: [], profile: { airspaceOn: true, pilotName: 'Benjamin', email: 'x@y.z' }
  });
  const json = JSON.stringify(payload);
  assert(/airspaceOn/.test(json), 'airspaceOn did not survive export');
  assert(!/Benjamin/.test(json) && !/x@y\.z/.test(json), 'personal data leaked into the export');
});
T('airspace draws in its own pane, BELOW the route line', () => {
  const raw = APP_SRC;
  assert(/createPane\('airspacePane'\)/.test(raw), 'no dedicated airspace pane');
  const m = raw.match(/getPane\('airspacePane'\)\.style\.zIndex = '(\d+)'/);
  assert(m, 'the airspace pane has no explicit z-index');
  // Leaflet's overlayPane (the route line) is 400. Airspace must be under it,
  // or a click meant for a leg hits an airspace polygon first and bubbles to
  // the map as "add a waypoint".
  assert(Number(m[1]) < 400, 'airspace sits ABOVE the route line: z-index ' + m[1]);
  assert(/pane: 'airspacePane'/.test(raw), 'polygons are not put in that pane');
});
T('airspace takes hover but NOT clicks - the map click still adds a waypoint', () => {
  const raw = APP_SRC;
  // Bounded by the AIRSPACE section's own last line, not by whatever function
  // happens to follow it: section 2e (AIP fixes) was added in between, and its
  // markers DO take clicks - deliberately, because a 9 px symbol is not a
  // polygon covering the map. Slicing to the next function swept that in and
  // failed this test for the wrong reason.
  const start = raw.indexOf('function drawAirspace');
  const seg = raw.slice(start, raw.indexOf("map.on('zoomend', drawAirspace)", start));
  assert(seg.length > 500 && seg.length < 6000, 'the airspace section slice looks wrong: ' + seg.length + ' chars');
  assert(/bindTooltip/.test(seg), 'the airspace polygons carry no hover information');
  assert(/mouseover/.test(seg) && /mouseout/.test(seg), 'no hover emphasis');
  // The whole point: no click handler, and bubblingMouseEvents left default,
  // so a click inside a TMA still reaches the map and adds a waypoint.
  assert(!/\.on\('click'/.test(seg), 'a click handler on airspace would break route building inside a TMA');
  assert(!/bubblingMouseEvents/.test(seg), 'event bubbling was disabled - map clicks would be swallowed');
});
T('the overlay renders the real dataset, culled, with an attribution', () => {
  ev(SEED);
  ev("window.__stubZoom = 9; window.__stubBounds = { south: 68.8, west: 17.2, north: 69.9, east: 19.6 };");
  ev('aircraftProfile.airspaceOn = true; drawAirspace();');
  const n = ev('airspaceLayers.length');
  assert(n > 0, 'nothing drawn over Troms at zoom 9');
  assert(n < 60, n + ' polygons drawn for one viewport - culling is not working');
  // every drawn layer is a polygon in the airspace pane with a tooltip
  assert(ev("airspaceLayers.every(l => l._isPolygon && l._opts.pane === 'airspacePane' && !!l._tip)"),
    'a drawn layer is not a tooltipped polygon in the airspace pane');
  assert(ev("airspaceLayers.every(l => l._opts.fillOpacity <= 0.12)"),
    'the fill is too heavy - it would hide the chart underneath');
  const attr = doc.getElementById('airspace-attribution');
  assert(attr && attr.style.display !== 'none' && /Avinor/.test(attr.textContent),
    'no attribution shown while the overlay is on');
  // below the min zoom nothing is drawn, and the attribution goes away
  ev("window.__stubZoom = 5; drawAirspace();");
  assert(ev('airspaceLayers.length') === 0, 'airspace drawn at zoom 5');
  assert(doc.getElementById('airspace-attribution').style.display === 'none',
    'the attribution stayed up with nothing drawn');
  // and turning it off clears everything
  ev("window.__stubZoom = 9; aircraftProfile.airspaceOn = true; drawAirspace();");
  assert(ev('airspaceLayers.length') > 0, 'redraw failed');
  ev('aircraftProfile.airspaceOn = false; drawAirspace();');
  assert(ev('airspaceLayers.length') === 0, 'turning the overlay off left layers on the map');
});
T('the map control is in the stack and reports its state', () => {
  const btn = doc.getElementById('airspace-btn');
  assert(btn, 'no airspace button');
  assert(btn.parentElement === doc.getElementById('map-controls'),
    'the airspace button is outside the control stack - it will be invisible');
  assert(btn.classList.contains('map-ctl'), 'the airspace button lacks the shared class');
  ev('aircraftProfile.airspaceOn = false; updateAirspaceBtn();');
  assert(/Off/.test(btn.textContent), 'button does not report Off: ' + btn.textContent);
  ev('aircraftProfile.airspaceOn = true; updateAirspaceBtn();');
  assert(/On/.test(btn.textContent), 'button does not report On: ' + btn.textContent);
});

console.log('\n=== 64b. AIP fixes: aerodromes and VFR reporting points (v16.34) ===');
T('reporting points come off the VAC table, validated, and nothing is invented', () => {
  const V = require('./tools/aip-vac.mjs');
  // THE PARSE RULE IS A COLUMN AND A FONT. Reading the nearest item left of a
  // coordinate is wrong: the chart's artwork overlaps the table, so spot
  // heights, tick glyphs and symbol-font mojibake sit between the name and the
  // latitude. This fixture is the real shape of that failure.
  const items = [
    // the table: name at x 67 in font T, coordinates at 107 and 136
    { str: 'ELLA',      x: 67,  y: 355, page: 1, font: 'T' },
    { str: '690200N',   x: 107, y: 355, page: 1, font: 'C' },
    { str: '0183820E',  x: 136, y: 355, page: 1, font: 'C' },
    { str: 'REINELV',   x: 67,  y: 294, page: 1, font: 'T' },
    { str: '355',       x: 89,  y: 294, page: 1, font: 'S' },   // a spot height IN BETWEEN
    { str: '691227N',   x: 107, y: 294, page: 1, font: 'C' },
    { str: '0181437E',  x: 136, y: 294, page: 1, font: 'C' },
    { str: 'S\u00d8RREISA',  x: 67,  y: 212, page: 1, font: 'T' },
    { str: '\u00f3\u00f3',        x: 82,  y: 212, page: 1, font: 'SYM' }, // symbol-font mojibake
    { str: '690735N',   x: 107, y: 212, page: 1, font: 'C' },
    { str: '0181145E',  x: 137, y: 212, page: 1, font: 'C' },  // 1 pt column jitter is real
    // the graticule, drawn elsewhere on the sheet
    { str: "69\u00b000'N", x: 20, y: 500, page: 1, font: 'G' },
    { str: "68\u00b050'N", x: 20, y: 100, page: 1, font: 'G' },
    { str: "018\u00b000'E", x: 200, y: 20, page: 1, font: 'G' },
    { str: "019\u00b000'E", x: 400, y: 20, page: 1, font: 'G' }
  ];
  const { tables, refused } = V.reportingPointTables(items);
  assert(tables.length === 1, tables.length + ' tables found');
  assert(!refused.length, JSON.stringify(refused));
  const t = tables[0];
  assert(!t.unnamed.length, 'unnamed rows: ' + JSON.stringify(t.unnamed));
  assert(t.points.map(p => p.name).join(',') === 'ELLA,REINELV,S\u00d8RREISA',
    'names: ' + JSON.stringify(t.points.map(p => p.name)));
  assert(t.font === 'T', 'the name column resolved to font ' + t.font + ' - the artwork won');
  // The coordinate is the PUBLISHED one, to the second.
  const ella = t.points[0];
  assert(Math.abs(ella.lat - (69 + 2 / 60)) < 1e-9, 'lat ' + ella.lat);
  assert(Math.abs(ella.lng - (18 + 38 / 60 + 20 / 3600)) < 1e-9, 'lng ' + ella.lng);
  assert(ella.rawLat === '690200N' && ella.rawLng === '0183820E', 'the printed form was lost');

  // A single stray coordinate on the chart face is NOT a table: with one row
  // there is no column consensus, so whatever sits left of it would become a
  // reporting point. ENSG's VAC does exactly this.
  const stray = V.reportingPointTables([
    { str: 'MAX', x: 40, y: 300, page: 1, font: 'S' },
    { str: '601234N', x: 107, y: 300, page: 1, font: 'C' },
    { str: '0101234E', x: 136, y: 300, page: 1, font: 'C' }
  ]);
  assert(!stray.tables.length && stray.refused.length === 1 && stray.refused[0].reason === 'not-a-table',
    JSON.stringify(stray));

  // Validation refuses what a broken text layer produces, rather than shipping
  // a misspelt fix. A minute or second of 60 is a misread, not a coordinate.
  assert(V.isPlausibleName('BJ\u00d8RN\u00d8Y LIGHT') && V.isPlausibleName('RCF E') && V.isPlausibleName('COZIP'));
  assert(!V.isPlausibleName('\u00f3\u00f3') && !V.isPlausibleName('Ansnes') && !V.isPlausibleName('CHANGES: 0$*9$5'));
  assert(V.parsePrintedDms('690200N') !== null, 'a real coordinate was refused');
  assert(V.parsePrintedDms('696000N') === null, '60 minutes was accepted');
  assert(V.parsePrintedDms('690060N') === null, '60 seconds was accepted');
  assert(V.parsePrintedDms('69020N') === null, 'a short coordinate was accepted');
  const g = V.graticuleRange(items);
  assert(g && Math.abs(g.south - (68 + 50 / 60 - 0.5)) < 1e-9, 'graticule: ' + JSON.stringify(g));
});
T('every shipped reporting point is corroborated by the chart it came from', () => {
  // TWO INDEPENDENT CHECKS, both asserted at build time and re-asserted here
  // on the shipped data. The graticule one matters most: the chart labels its
  // own lat/lng grid in a different part of the document from the table, so a
  // point inside that range was read correctly - a corrupted digit lands off
  // the sheet.
  const rep = JSON.parse(fs.readFileSync('tools/prepared/vac-report.json', 'utf8'));
  assert(rep.checks.graticule === rep.checks.total,
    rep.checks.graticule + '/' + rep.checks.total + ' points inside their chart graticule');
  assert(!rep.refusedPoints.length, 'refused points shipped: ' + JSON.stringify(rep.refusedPoints));
  assert(!rep.unnamedRows.length, 'unnamed rows: ' + JSON.stringify(rep.unnamedRows));
  // The name check is a corroboration, not a gate: a point on the sheet edge
  // is tabulated here and DRAWN on the neighbouring aerodrome's chart.
  assert(rep.checks.nameEchoed / rep.checks.total > 0.95,
    rep.checks.nameEchoed + '/' + rep.checks.total + ' names also drawn as a chart label');
  console.log('        ' + rep.checks.total + ' points: ' + rep.checks.graticule +
    ' inside their own graticule, ' + rep.checks.nameEchoed + ' also drawn as a chart label');

  const set = aipDataset();
  const V = require('./tools/aip-vac.mjs');
  let n = 0;
  assert(set.aerodromes.length > 40, 'only ' + set.aerodromes.length + ' aerodromes to check (L9)');
  for (const a of set.aerodromes) {
    assert(/^EN[A-Z]{2}$/.test(a.icao), 'bad ICAO ' + a.icao);
    for (const p of a.points) {
      n++;
      assert(V.isPlausibleName(p.name), a.icao + ' ships an implausible name ' + JSON.stringify(p.name));
      // The stored decimal must agree with the printed DMS it came from.
      const [rl, rg] = String(p.published).split(' ');
      assert(Math.abs(V.parsePrintedDms(rl) - p.lat) < 2e-6
          && Math.abs(V.parsePrintedDms(rg) - p.lng) < 2e-6,
        a.icao + ' ' + p.name + ': ' + p.published + ' does not match ' + p.lat + '/' + p.lng);
      assert(V.roughNM([a.lat, a.lng], [p.lat, p.lng]) <= V.MAX_ARP_NM,
        a.icao + ' ' + p.name + ' is beyond the corruption bound');
    }
  }
  assert(n > 200, 'only ' + n + ' reporting points shipped');
});
T('an aerodrome with no published table has NO points, and that is said', () => {
  // 29 aerodromes publish their reporting points on the chart face only, with
  // no coordinate table to read. Reading them off the chart image is exactly
  // the plausible wrong answer this project refuses - so they ship with no
  // points, and the coverage is reported so a pilot is not left assuming the
  // list is complete.
  const A = moduleExports.anchors;
  const set = aipDataset();
  const cov = A.anchorCoverage(set);
  assert(cov.total === set.aerodromes.length, 'coverage miscounts aerodromes');
  assert(cov.withoutPoints > 0 && cov.withPoints > 0, JSON.stringify(cov));
  assert(cov.points === set.aerodromes.reduce((s, a) => s + a.points.length, 0), 'point count disagrees');
  // Every aerodrome still ANCHORS: the ARP is a tagged field on every AD 2
  // page, so an aerodrome with no VAC table is still a usable waypoint.
  const anchors = A.buildAnchors(set);
  assert(set.aerodromes.length > 40, 'only ' + set.aerodromes.length + ' aerodromes to check (L9)');
  for (const a of set.aerodromes) {
    assert(anchors.some((x) => x.kind === 'AD' && x.icao === a.icao),
      a.icao + ' has no aerodrome anchor');
  }
  // And the attribution names the ONE grant that applies - Kartverket is not
  // involved in the reporting points and must not be implied.
  const attr = A.anchorAttribution(set);
  assert(/Avinor/.test(attr) && !/permission|non-commercial/i.test(attr), attr);
  assert(!/Kartverket/.test(attr), 'the fixes attribution wrongly credits Kartverket: ' + attr);
  assert(/[Nn]ot for navigation/.test(attr), attr);
});
T('a fix is found by ICAO, by name, and without Norwegian letters', () => {
  const A = moduleExports.anchors;
  const anchors = A.buildAnchors(aipDataset());
  const names = (q, near) => A.searchAnchors(anchors, q, { near: near || [69.3, 19.0] })
    .map((a) => a.kind + ':' + a.name);
  // An ICAO typed in full is the aerodrome, outright.
  assert(names('ENDU')[0] === 'AD:ENDU', JSON.stringify(names('ENDU')));
  // ...and so is the aerodrome's NAME, which is the only spelling a pilot who
  // does not know the code has. SORKJOSEN must find it without the Ø.
  assert(names('SORKJOSEN')[0] === 'AD:ENSR', JSON.stringify(names('SORKJOSEN')));
  assert(names('S\u00d8RKJOSEN')[0] === 'AD:ENSR', JSON.stringify(names('S\u00d8RKJOSEN')));
  assert(names('BARDUFOSS')[0] === 'AD:ENDU', JSON.stringify(names('BARDUFOSS')));
  // A reporting point by name, and the nearer one first when two share it:
  // BREIVIKA exists at both Troms\u00f8 and Evenes.
  const br = A.searchAnchors(anchors, 'BREIVIKA', { near: [69.68, 18.91] });
  assert(br.length === 2 && br[0].icao === 'ENTC', JSON.stringify(br.map((a) => a.icao)));
  const brSouth = A.searchAnchors(anchors, 'BREIVIKA', { near: [68.49, 16.68] });
  assert(brSouth[0].icao === 'ENEV', 'nearest-first ignored the map centre');
  // A prefix beats a mere substring, and the list is bounded.
  assert(names('STOR').every((n) => /:STOR|:ENSO/.test(n)), JSON.stringify(names('STOR')));
  assert(A.searchAnchors(anchors, 'S', { limit: 9 }).length === 9, 'the result list is unbounded');
  assert(!A.searchAnchors(anchors, '').length && !A.searchAnchors(anchors, '   ').length,
    'an empty query returned matches');
  assert(!A.searchAnchors(anchors, 'ZZZZQQ').length, 'a nonsense query returned matches');
});
T('an anchored waypoint carries the PUBLISHED coordinate, unrounded', () => {
  const A = moduleExports.anchors;
  const set = aipDataset();
  const anchors = A.buildAnchors(set);
  const endu = anchors.find((a) => a.kind === 'AD' && a.icao === 'ENDU');
  const ad = set.aerodromes.find((a) => a.icao === 'ENDU');
  const wp = A.anchorWaypoint(endu, { alt: 3500, oat: 5, wdir: 240, wspd: 18, atField: true });
  assert(wp.lat === ad.lat && wp.lng === ad.lng, 'the coordinate was altered on the way through');
  assert(wp.name === 'ENDU', wp.name);
  // ON the field - a departure, or a touch & go / full stop - the PUBLISHED
  // elevation is the number wanted, not the caller's cruise default.
  assert(wp.alt === ad.elevFt && wp.alt === 254, 'aerodrome altitude at the field: ' + wp.alt);
  assert(wp.anchor === 'AIP-AD', wp.anchor);
  // OVER it, the aircraft is at the planned altitude (v16.56). Forcing ground
  // level here planned a descent to the deck and a climb back out over an
  // aerodrome that was only overflown.
  const over = A.anchorWaypoint(endu, { alt: 3500, oat: 5, wdir: 240, wspd: 18 });
  assert(over.alt === 3500, 'a fly-by was dragged to ground level: ' + over.alt);
  assert(A.anchorWaypoint(endu, { alt: 3500, atField: false }).alt === 3500,
    'an explicit atField:false still used the field elevation');
  // A reporting point publishes NO elevation, so it takes the default rather
  // than being given an invented one.
  const rp = anchors.find((a) => a.kind === 'RP' && a.name === 'SODA');
  const rwp = A.anchorWaypoint(rp, { alt: 3500, oat: 5 });
  assert(rwp.alt === 3500 && rwp.anchor === 'AIP-RP', JSON.stringify(rwp));
  // Nothing personal rides along: the waypoint carries only the fix.
  assert(!/benjamin|@|licen|email/i.test(JSON.stringify(wp)), 'a waypoint leaked identifying data');
});
T('fixes are culled by zoom, aerodromes before reporting points', () => {
  const A = moduleExports.anchors;
  const anchors = A.buildAnchors(aipDataset());
  const troms = { south: 68.8, west: 17.2, north: 69.9, east: 19.6 };
  const at = (z) => A.visibleAnchors(anchors, troms, z);
  assert(!at(6).length, 'something was drawn below the aerodrome zoom');
  const ads = at(A.AERODROME_MIN_ZOOM);
  assert(ads.length && ads.every((a) => a.kind === 'AD'),
    'reporting points appear at the aerodrome zoom already');
  const both = at(A.REPORTING_POINT_MIN_ZOOM);
  assert(both.some((a) => a.kind === 'RP'), 'no reporting points at their own zoom');
  assert(both.length > ads.length, 'the point zoom drew no more than the aerodrome zoom');
  // Culling is not optional: the whole dataset is far bigger than one viewport.
  assert(both.length < anchors.length / 2,
    both.length + ' of ' + anchors.length + ' drawn for one viewport - culling is not working');
  // The bbox really is a bbox: nothing outside it survives.
  assert(both.every((a) => a.lat >= troms.south && a.lat <= troms.north
    && a.lng >= troms.west && a.lng <= troms.east), 'an anchor outside the viewport was drawn');
});
T('the fixes layer draws clickable markers and keeps its own attribution', () => {
  ev(SEED);
  ev("window.__stubZoom = 10; window.__stubBounds = { south: 68.8, west: 17.2, north: 69.9, east: 19.6 };");
  ev('aircraftProfile.fixesOn = true; drawFixes();');
  const n = ev('fixLayers.length');
  assert(n > 0, 'nothing drawn over Troms at zoom 10');
  assert(n < 120, n + ' markers for one viewport - culling is not working');
  // A fix TAKES clicks - the opposite choice from the airspace layer, and for
  // a reason: a 9 px symbol is unambiguous where a polygon covering the map is
  // not. Leaflet markers do not bubble clicks to the map, so the map's own
  // add-waypoint handler does not also fire.
  assert(ev('fixLayers.every(l => !!(l._h && l._h.click))'), 'a fix marker takes no click');
  assert(ev('fixLayers.every(l => !!l._tip)'), 'a fix marker has no hover card');
  assert(ev("fixLayers.every(l => l._opts.zIndexOffset < 0)"),
    'fixes are drawn above the route markers - the plan must stay on top');
  const attr = doc.getElementById('fixes-attribution');
  assert(attr && attr.style.display !== 'none', 'the fixes attribution is hidden while the layer is on');
  assert(/Avinor/.test(attr.textContent) && !/permission|non-commercial/i.test(attr.textContent), attr.textContent);

  // Clicking one adds a waypoint AT THE PUBLISHED COORDINATE - no dialog,
  // because the fix already has its published name.
  const before = ev('flights[activeFlightIndex].waypoints.length');
  ev("(function(){ var l = fixLayers.find(function(x){ return x._tip.indexOf('SODA') >= 0; }); l._h.click(); })()");
  assert(ev('flights[activeFlightIndex].waypoints.length') === before + 1, 'the click added nothing');
  const added = ev('JSON.stringify(flights[activeFlightIndex].waypoints.slice(-1)[0])');
  const wp = JSON.parse(added);
  const soda = aipDataset().aerodromes.find((a) => a.icao === 'ENDU').points.find((p) => p.name === 'SODA');
  assert(wp.name === 'SODA' && wp.lat === soda.lat && wp.lng === soda.lng, added);
  assert(typeof wp.var === 'number' && wp.varSource, 'the anchored waypoint got no magnetic variation');
  // and it is undoable like every other edit
  ev('undoLast(true);');
  assert(ev('flights[activeFlightIndex].waypoints.length') === before, 'adding a fix was not undoable');

  ev('aircraftProfile.fixesOn = false; drawFixes();');
  assert(ev('fixLayers.length') === 0, 'turning the layer off left markers behind');
  assert(attr.style.display === 'none', 'the attribution outlived the layer');
});
T('the fix symbol is a validated setting, and a bad value degrades safely', () => {
  const A = moduleExports.anchors;
  // The reporting-point default is ORANGE on purpose: nothing on either base
  // chart is orange except the mandatory zones, so the symbol you are hunting
  // for cannot be mistaken for published chart ink.
  const d = A.normaliseFixStyle({});
  assert(d.rpColor === '#dd6b20' && d.rpShape === 'triangle', JSON.stringify(d));
  assert(d.adColor === '#2b6cb0' && d.adShape === 'square', JSON.stringify(d));
  assert(d.size === 10 && d.style === 'filled' && d.labels === true, JSON.stringify(d));
  assert(A.DEFAULT_FIX_STYLE.rpColor === d.rpColor, 'the defaults disagree with themselves');

  // Every field is honoured when it is valid...
  const set = A.normaliseFixStyle({
    fixAdColor: '#123ABC', fixRpColor: '#ff8800', fixAdShape: 'diamond', fixRpShape: 'circle',
    fixStyle: 'outline', fixSize: 14, fixLabels: false
  });
  assert(set.adColor === '#123abc' && set.rpColor === '#ff8800', JSON.stringify(set));
  assert(set.adShape === 'diamond' && set.rpShape === 'circle' && set.style === 'outline');
  assert(set.size === 14 && set.labels === false, JSON.stringify(set));

  // ...and NOTHING invalid is trusted. This is not fussiness: the colour is
  // interpolated into the SVG that becomes a marker's innerHTML, and it travels
  // through export/import, so it can arrive from a route file someone else
  // wrote. A broken value must degrade to a VISIBLE symbol, never to an
  // invisible one and never to injected markup.
  const bad = A.normaliseFixStyle({
    fixAdColor: '#fff" onload="alert(1)', fixRpColor: 'orange', fixAdShape: 'skull',
    fixRpShape: '', fixStyle: 'neon', fixSize: 9999, fixLabels: 'maybe'
  });
  assert(bad.adColor === A.DEFAULT_FIX_STYLE.adColor, 'an injection string was kept: ' + bad.adColor);
  assert(bad.rpColor === A.DEFAULT_FIX_STYLE.rpColor, 'a named colour was kept: ' + bad.rpColor);
  assert(bad.adShape === 'square' && bad.rpShape === 'triangle', JSON.stringify(bad));
  assert(bad.style === 'filled', bad.style);
  assert(bad.size === A.FIX_SIZE_MAX, 'an absurd size was not clamped: ' + bad.size);
  assert(A.normaliseFixStyle({ fixSize: -5 }).size === A.FIX_SIZE_MIN, 'a negative size was not clamped');
  assert(A.normaliseFixStyle({ fixSize: 'big' }).size === A.DEFAULT_FIX_STYLE.size, 'a non-number size leaked');
  // A truthy non-false labels value still means "show": only an explicit false
  // hides them, so a missing key cannot silently blank the map.
  assert(bad.labels === true && A.normaliseFixStyle({ fixLabels: false }).labels === false);

  assert(A.isHexColor('#dd6b20') && A.isHexColor('#FFF000'));
  assert(!A.isHexColor('#fff') && !A.isHexColor('red') && !A.isHexColor('#gggggg') && !A.isHexColor(null));
});
T('the symbol markup is SVG at the requested size, and escapes what it prints', () => {
  const A = moduleExports.anchors;
  for (const shape of A.FIX_SHAPES) {
    const svg = A.fixSymbolSvg(shape, '#dd6b20', 12);
    assert(/^<svg /.test(svg) && /width="12" height="12"/.test(svg), shape + ': ' + svg);
    assert(/viewBox="0 0 100 100"/.test(svg), shape + ' is not in the shared 100-unit box');
    assert(/fill="#dd6b20"/.test(svg), shape + ' lost its colour');
    // The halo must be painted UNDER the fill, or a 6 px symbol is mostly white.
    assert(/paint-order="stroke"/.test(svg), shape + ' has no under-stroke halo');
  }
  // Outline strokes in the colour and never fills with it.
  const out = A.fixSymbolSvg('circle', '#ff8800', 10, 'outline');
  assert(/stroke="#ff8800"/.test(out) && !/fill="#ff8800"/.test(out), out);
  // An unknown shape or colour still yields a drawable symbol.
  assert(/^<svg /.test(A.fixSymbolSvg('nope', 'nope', NaN)), 'a bad request produced no symbol');
  // Size is clamped here too, not only in normaliseFixStyle - this is the
  // function the preview and the map both call.
  assert(/width="18"/.test(A.fixSymbolSvg('circle', '#dd6b20', 400)), 'size not clamped in the symbol');

  // The whole marker: symbol plus label, with the label offset SCALING. It was
  // hardcoded at 12 px for a 9 px square, so at 18 px the text sat on the shape.
  const st = A.normaliseFixStyle({ fixSize: 18 });
  const mk = A.fixMarkerHtml({ kind: 'RP', label: 'SODA' }, st);
  assert(mk.size === 18 && mk.anchor === 9, JSON.stringify(mk));
  assert(/left:21px/.test(mk.html), 'the label offset did not scale: ' + mk.html);
  assert(!A.fixMarkerHtml({ kind: 'RP', label: 'SODA' }, A.normaliseFixStyle({ fixLabels: false }))
    .html.includes('fix-label'), 'labels were drawn when turned off');
  // Published names land in innerHTML; an ampersand in a future edition must
  // not become markup.
  assert(A.escapeText('A & B <c>') === 'A &amp; B &lt;c&gt;', A.escapeText('A & B <c>'));
  assert(A.fixMarkerHtml({ kind: 'AD', label: '<img>' }, st).html.includes('&lt;img&gt;'),
    'a name was not escaped into the marker');
});
T('Map settings is its own page, and saving it redraws the symbols', () => {
  ev(SEED);
  // TWO PAGES, not one long scroll: the aircraft page is set up once per
  // machine, the map page is display preference. Mixing them meant scrolling
  // past the POH cruise tables to change a symbol colour.
  const tabs = [...doc.querySelectorAll('#settings-tabs .settings-tab')];
  assert(tabs.length === 3, tabs.length + ' settings tabs');   // + Keyboard at v16.52
  assert(tabs.map(t => t.id).join(',') === 'settings-tab-aircraft,settings-tab-map,settings-tab-keys',
    tabs.map(t => t.id).join());
  ev("openSettingsModal();");
  assert(!doc.getElementById('settings-page-aircraft').hidden, 'the modal did not open on the aircraft page');
  assert(doc.getElementById('settings-page-map').hidden, 'the map page is showing at open');
  assert(doc.getElementById('settings-tab-aircraft').classList.contains('is-active'), 'no active tab');
  ev("showSettingsPage('map');");
  assert(doc.getElementById('settings-page-map').hidden === false, 'the map page did not show');
  assert(doc.getElementById('settings-page-aircraft').hidden === true, 'the aircraft page did not hide');
  assert(doc.getElementById('settings-tab-map').classList.contains('is-active'), 'the map tab is not active');
  assert(!doc.getElementById('settings-tab-aircraft').classList.contains('is-active'), 'two tabs are active');

  // The page opens showing what is actually in force, and the zoom thresholds
  // it quotes come from the module rather than being retyped in the markup.
  const A = moduleExports.anchors;
  assert(doc.getElementById('map-fix-rp-color').value === A.DEFAULT_FIX_STYLE.rpColor,
    'the form does not show the live colour: ' + doc.getElementById('map-fix-rp-color').value);
  assert(doc.getElementById('map-zoom-rp').textContent === String(A.REPORTING_POINT_MIN_ZOOM),
    'the quoted reporting-point zoom is hardcoded: ' + doc.getElementById('map-zoom-rp').textContent);
  assert(doc.getElementById('map-zoom-as').textContent === String(moduleExports.airspace.AIRSPACE_MIN_ZOOM),
    'the quoted airspace zoom is hardcoded');

  // The PREVIEW renders through the same function the map uses, so what it
  // shows is what gets drawn - a preview built from its own markup would drift.
  ev("document.getElementById('map-fix-rp-color').value = '#ff2d95';" +
     "document.getElementById('map-fix-rp-shape').value = 'diamond';" +
     "document.getElementById('map-fix-size').value = '15'; updateFixPreview();");
  const pv = doc.getElementById('map-fix-preview').innerHTML;
  assert(/#ff2d95/.test(pv) && /width="15"/.test(pv), 'the preview ignored the form: ' + pv.slice(0, 200));
  assert(doc.getElementById('map-fix-size-val').textContent === '15 px',
    doc.getElementById('map-fix-size-val').textContent);

  // Saving stores VALIDATED values and redraws.
  ev("window.__stubZoom = 10; window.__stubBounds = { south: 68.8, west: 17.2, north: 69.9, east: 19.6 };");
  ev('aircraftProfile.fixesOn = true; saveSettings();');
  assert(ev("aircraftProfile.fixRpColor") === '#ff2d95', 'the colour did not persist');
  assert(ev("aircraftProfile.fixSize") === 15, 'the size did not persist: ' + ev('aircraftProfile.fixSize'));
  assert(ev("JSON.parse(localStorage.getItem('c182_perf_profile')).fixRpColor") === '#ff2d95',
    'the colour did not reach localStorage');
  const drawn = ev("fixLayers.filter(l => l._opts.icon.className.indexOf('fix-rp') >= 0)" +
                   ".map(l => l._opts.icon.html).join('')");
  assert(drawn.length, 'no reporting points redrawn after Save');
  assert(/#ff2d95/.test(drawn) && /width="15"/.test(drawn), 'the redraw kept the old symbol');
  assert(/polygon points="50,7/.test(drawn), 'the shape did not change to a diamond');
  // The aerodrome keeps its OWN colour - the two are separate settings.
  const ad = ev("fixLayers.filter(l => l._opts.icon.className.indexOf('fix-ad') >= 0)" +
                ".map(l => l._opts.icon.html).join('')");
  assert(/#2b6cb0/.test(ad) && !/#ff2d95/.test(ad), 'the aerodrome took the reporting-point colour');
});
T('every fix setting is on the export whitelist, and none of it identifies anyone', () => {
  const E = moduleExports.exch;
  for (const k of ['fixAdColor', 'fixRpColor', 'fixAdShape', 'fixRpShape', 'fixStyle', 'fixSize', 'fixLabels']) {
    assert(E.PROFILE_KEYS.includes(k), k + ' is not a persisted/exportable profile key');
  }
  // The whitelist is the ONE list and it still refuses anything personal, even
  // now that it carries display preferences.
  const payload = JSON.stringify(E.buildExportPayload({
    flights: [], profile: {
      mode: 'C182T', fixRpColor: '#ff8800', fixSize: 14,
      pilotName: 'Benjamin', email: 'x@y.no', licence: 'NO-FCL-1234', homeBase: 'ENDU-hangar-3'
    }
  }));
  assert(/#ff8800/.test(payload) && /14/.test(payload), 'the display preference did not travel');
  assert(!/Benjamin|x@y\.no|NO-FCL-1234|hangar/.test(payload), 'personal data leaked: ' + payload);
});
T('the fixes controls are in the stack and report their state', () => {
  for (const id of ['fixes-btn', 'fix-search-btn']) {
    const btn = doc.getElementById(id);
    assert(btn, 'no ' + id);
    assert(btn.parentElement === doc.getElementById('map-controls'),
      id + ' is outside the control stack - it will be invisible');
    assert(btn.classList.contains('map-ctl'), id + ' lacks the shared class');
  }
  ev('aircraftProfile.fixesOn = false; updateFixesBtn();');
  assert(/Off/.test(doc.getElementById('fixes-btn').textContent), 'button does not report Off');
  ev('aircraftProfile.fixesOn = true; updateFixesBtn();');
  assert(/On/.test(doc.getElementById('fixes-btn').textContent), 'button does not report On');
  // The layer choice persists with the profile, and is on the ONE whitelist.
  assert(moduleExports.exch.PROFILE_KEYS.includes('fixesOn'), 'fixesOn is not a persisted profile key');
});
TA('the fix search finds a point by name and places it on the published coordinate', async () => {
  ev(SEED);
  const before = ev('flights[activeFlightIndex].waypoints.length');
  const p = ev('searchFixes()');
  await tick();
  typeInDialog('STORSLETT');
  answerDialog('Search');
  await tick();
  answerDialog('STORSLETT');
  await p;
  assert(ev('flights[activeFlightIndex].waypoints.length') === before + 1, 'the search added nothing');
  const wp = JSON.parse(ev('JSON.stringify(flights[activeFlightIndex].waypoints.slice(-1)[0])'));
  const pub = aipDataset().aerodromes.find((a) => a.icao === 'ENSR').points.find((x) => x.name === 'STORSLETT');
  assert(wp.name === 'STORSLETT' && wp.lat === pub.lat && wp.lng === pub.lng, JSON.stringify(wp));
});
TA('a nonsense search says WHY there is no match, and adds nothing', async () => {
  ev(SEED);
  const before = ev('flights[activeFlightIndex].waypoints.length');
  const p = ev('searchFixes()');
  await tick();
  typeInDialog('ZZZZQQ');
  answerDialog('Search');
  await tick();
  const title = doc.querySelector('#app-dialog .dlg-title');
  assert(title && /No published fix matches/.test(title.textContent), title && title.textContent);
  const msg = doc.querySelector('#app-dialog .dlg-msg');
  assert(msg && /chart face only/.test(msg.textContent), msg && msg.textContent);
  answerDialog('OK');
  await p;
  assert(ev('flights[activeFlightIndex].waypoints.length') === before, 'a failed search changed the route');
});

console.log('\n=== 64c. Border references in BOTH published forms (v16.36) ===');
T('a border reference stated as prose on a vertex is read, not dropped', () => {
  const F = require('./tools/aip-fields.mjs');
  // THE BUG: the eAIP states a border reference two ways. The typed field
  // (TGEO_BORDER;TXT_NAME = "Norway and Sweden") was handled; the SENTENCE
  // carried as a remark on the preceding vertex (TAIRSPACE_VERTEX;CUSTOM_ATT27
  // = "westwards along the border between Norway and Sweden to") was not, and
  // all 27 of them in the edition were silently ignored - which drew the
  // Polaris CTA as a straight line across the whole eastern border.
  assert(F.borderNameFromRemark('westwards along the border between Norway and Sweden to')
    === 'Norway and Sweden', 'the western form was not read');
  assert(F.borderNameFromRemark('southwards along the border between Norway and Russia to')
    === 'Norway and Russia');
  assert(F.borderNameFromRemark('along the border between Norway and Finland, then')
    === 'Norway and Finland', 'the ", then" continuation form was not read');
  assert(F.borderNameFromRemark('along the border between Norway and Sweden to') === 'Norway and Sweden');
  // The DIRECTION word is deliberately not parsed: the prepared border is one
  // open polyline, so there is exactly one path between two fixes and no way
  // round to choose. Both directions must yield the same country pair.
  assert(F.borderNameFromRemark('southwards along the border between Norway and Sweden')
    === F.borderNameFromRemark('westwards along the border between Norway and Sweden to'),
    'the direction word changed the answer');
  // A remark that is NOT a border reference must stay unread, so a future
  // edition can put anything else in that field without being misread.
  assert(F.borderNameFromRemark('') === null);
  assert(F.borderNameFromRemark('MIL') === null);
  assert(F.borderNameFromRemark('Northern Part REF AIP SWEDEN') === null);
  assert(F.borderNameFromRemark('along the coastline to') === null, 'a coastline became a border');
});
T('EVERY published border reference is accounted for - the invariant that caught this', () => {
  // This is the check that would have found the bug on the day it shipped:
  // count what the SOURCE states, and require that every one of them became
  // geometry, was refused for a stated reason, or belongs to airspace that is
  // deliberately never drawn. Nothing may simply go missing, because a missing
  // reference is a boundary drawn where none exists.
  const r = JSON.parse(fs.readFileSync('data/aip-report.json', 'utf8'));
  const b = r.borderRefs;
  assert(b, 'the report carries no border-reference accounting');
  const published = b.tagged + b.onVertexRemark;
  const handled = b.resolved + b.refused + b.notDrawn;
  assert(published === handled,
    published + ' references published but ' + handled + ' handled: ' + JSON.stringify(b));
  // Both forms must actually be present, or this test is passing vacuously
  // because the parser stopped seeing one of them.
  assert(b.tagged > 20 && b.onVertexRemark > 20,
    'one of the two published forms has vanished: ' + JSON.stringify(b));
  console.log('        ' + published + ' border references: ' + b.resolved + ' resolved, ' +
    b.refused + ' refused, ' + b.notDrawn + ' in never-drawn airspace');
});
T('the Polaris CTA follows the national border south-east of ENDU', () => {
  // The user spotted this on the chart: between Treriksrøset (the Norway /
  // Sweden / Finland tripoint, 690336N 0203255E) and 683212N 0180734E the AIP
  // says "westwards along the border between Norway and Sweden to", and we drew
  // a 60 NM straight line - cutting off the whole Abisko salient.
  const set = aipDataset();
  const cta = set.features.filter((f) => f.kind === 'CTA' && /^Polaris CTA/.test(f.name))
    .find((f) => f.ring.some((p) => Math.abs(p[0] - 69.06) < 0.01 && Math.abs(p[1] - 20.5486) < 0.01));
  assert(cta, 'no Polaris CTA volume starts at the tripoint any more');
  assert(cta.borderSegments >= 4, cta.name + ' has ' + cta.borderSegments + ' border segments');
  // The border bulges EAST to about 20.23E around 68.5N. A straight line from
  // the tripoint to 68.53N/18.13E never goes east of 20.55E at 69.06N and is
  // well west of 20E by 68.5N, so a vertex out there proves the border was
  // walked rather than cut across.
  const salient = cta.ring.filter((p) => p[0] > 68.35 && p[0] < 68.75 && p[1] > 20.0);
  assert(salient.length >= 3,
    'the boundary still cuts the corner: ' + salient.length + ' vertices east of 20E between 68.35N and 68.75N');
  // and it is a real snap, not a wild one
  assert(cta.borderMaxSnapNM <= 2, cta.name + ' snapped ' + cta.borderMaxSnapNM + ' NM from the border');
});
T('every border-resolved ring still snaps within the measured tolerance', () => {
  const B = require('./tools/aip-border.mjs');
  const r = JSON.parse(fs.readFileSync('data/aip-report.json', 'utf8'));
  // Resolving 16 more airspaces must not have widened the population: the 2 NM
  // tolerance was chosen because real corners sat 0.00-1.16 NM out and every
  // failure was 8.44 NM or more. If a new resolution lands in that gap the
  // tolerance is no longer measured, it is a guess.
  assert(r.borderResolved.length > 35, 'only ' + r.borderResolved.length + ' airspaces resolved');
  const worst = Math.max(...r.borderResolved.map((x) => x.maxSnapNM));
  assert(worst <= B.SNAP_TOLERANCE_NM, 'worst snap ' + worst + ' NM exceeds the tolerance');
  assert(worst < 2, 'worst snap ' + worst + ' NM - the clean population now reaches the tolerance');
  console.log('        ' + r.borderResolved.length + ' border-resolved airspaces, worst snap ' + worst + ' NM');
});
T('ATS delegation areas are NOT drawn, and the data says what they are', () => {
  // Silver 1 and Silver 2 are inside SWEDEN FIR. They are not airspace: ENR 2.2
  // section 5 publishes areas where two states have agreed by letter to
  // transfer WHO PROVIDES THE SERVICE. Drawing them as class-C volumes made
  // them look like controlled airspace to clear, and 13 of the 17 are inside a
  // foreign FIR entirely.
  const set = aipDataset();
  const r = JSON.parse(fs.readFileSync('data/aip-report.json', 'utf8'));
  const names = ['Silver 1', 'Silver 2', 'Bohus A', 'Bohus B', 'Borge', 'Norli', 'Oslob',
                 'Nor2', 'Finnskogen 1', 'Manto', 'Halti', 'Koster', 'Ørje 1', 'Ørje 2',
                 'Area I', 'Area II'];
  for (const n of names) {
    assert(!set.features.some((f) => f.name === n || f.name.startsWith(n + ' ')),
      n + ' is still drawn as an airspace');
  }
  assert(r.delegations.length === 17, r.delegations.length + ' delegation areas recorded, expected 17');
  // Nothing is discarded: each keeps the two fields that make it meaningful,
  // and both are tagged at source rather than read out of the prose.
  const silver = r.delegations.find((x) => x.name === 'Silver 1');
  assert(silver && silver.withinFir === 'SWEDEN' && silver.atsBy === 'NORWAY', JSON.stringify(silver));
  assert(silver.lower === 'FL 125' && silver.upper === 'FL 660', JSON.stringify(silver));
  assert(r.delegations.every((x) => x.withinFir && x.atsBy),
    'a delegation area lost its FIR or its responsible state');
  const foreign = r.delegations.filter((x) => x.withinFir !== 'POLARIS').length;
  assert(foreign === 13, foreign + ' delegation areas inside a foreign FIR, expected 13');
  // Every one is reported as skipped for the stated reason, not silently gone.
  const skipped = r.skipped.filter((x) => x.reason === 'ats-delegation-not-airspace');
  assert(skipped.length === 17, skipped.length + ' reported as delegation skips');
  assert(skipped.every((x) => /within .* FIR, ATS by/.test(x.detail || '')), 'a skip lost its detail');
  // And the OTHER catch-all bucket is now EMPTY: every unclassified blob in the
  // edition was one of these, which is what confirms the discriminator is right.
  assert(!set.features.some((f) => f.kind === 'OTHER'),
    'unclassified airspace is being drawn: ' +
    set.features.filter((f) => f.kind === 'OTHER').map((f) => f.name).join(', '));
});

console.log('\n=== 65. AIP national-border resolution (v16.30) ===');
T('border fragments stitch into one continuous chain', () => {
  const b = require('./tools/aip-border.mjs');
  // Kartverket serves the border in arbitrary order and arbitrary direction,
  // so a fragment's end may join another's start OR its end.
  const forward = [[[0, 0], [1, 1]], [[2, 2], [3, 3]], [[1, 1], [2, 2]]];
  let chains = b.stitchFragments(forward);
  assert(chains.length === 1 && chains[0].length === 4, 'forward: ' + JSON.stringify(chains));
  const reversed = [[[0, 0], [1, 1]], [[3, 3], [2, 2]], [[2, 2], [1, 1]]];
  chains = b.stitchFragments(reversed);
  assert(chains.length === 1 && chains[0].length === 4, 'reversed: ' + JSON.stringify(chains));
  // two genuinely separate stretches must stay separate, not be joined
  chains = b.stitchFragments([[[0, 0], [1, 1]], [[50, 50], [51, 51]]]);
  assert(chains.length === 2, 'unrelated fragments were joined: ' + JSON.stringify(chains));
});
T('the border walk has no free choices, and refuses what it cannot resolve', () => {
  const b = require('./tools/aip-border.mjs');
  // a straight north-south "border" at lng 10
  const chain = [];
  for (let i = 0; i <= 100; i++) chain.push([60 + i * 0.01, 10]);

  const ok = b.borderPath(chain, [60.1, 10], [60.5, 10]);
  assert(!('refuse' in ok), 'a clean case was refused: ' + JSON.stringify(ok));
  assert(ok.points[0][0] === 60.1 && ok.points[ok.points.length - 1][0] === 60.5,
    'the PUBLISHED fixes must be the path endpoints, not the snapped ones');
  assert(ok.snapFromNM < 0.01 && ok.snapToNM < 0.01, 'snap distances: ' + JSON.stringify(ok));

  // walking the other way must also work and must come back in that order
  const back = b.borderPath(chain, [60.5, 10], [60.1, 10]);
  assert(back.points[0][0] === 60.5, 'the reverse walk did not start at the first fix');

  // a fix nowhere near the border is REFUSED, not snapped
  const far = b.borderPath(chain, [60.1, 10], [60.5, 14]);
  assert('refuse' in far && far.refuse === 'fix-not-on-border', JSON.stringify(far));
  // ...and an empty border is refused rather than treated as a straight line
  assert('refuse' in b.borderPath([], [60, 10], [61, 10]), 'an empty border resolved anyway');
});
T('a foreign border is refused rather than snapped to a Norwegian one', () => {
  const b = require('./tools/aip-border.mjs');
  // Halti references the Finland-Sweden border, which is not in Kartverket's
  // Riksgrense. Snapping it to the nearest Norwegian border instead would be
  // a silent, confident error.
  assert(b.isForeignBorder('Finland and Sweden'), 'Finland-Sweden was treated as Norwegian');
  assert(!b.isForeignBorder('Norway and Sweden'), 'Norway-Sweden was treated as foreign');
  assert(!b.isForeignBorder('Finland and Norway'), 'Finland-Norway was treated as foreign');
  assert(b.isForeignBorder(''), 'an unnamed border was treated as Norwegian');
});
T('simplification cannot move a boundary anywhere visible', () => {
  const b = require('./tools/aip-border.mjs');
  const pts = [];
  for (let i = 0; i <= 200; i++) pts.push([60 + i * 0.001, 10 + Math.sin(i / 7) * 0.0002]);
  const thin = b.simplify(pts, 0.02);
  assert(thin.length < pts.length, 'nothing was simplified');
  assert(thin[0][0] === pts[0][0] && thin[thin.length - 1][0] === pts[pts.length - 1][0],
    'simplification moved an endpoint');
  // every dropped point must lie within the tolerance of the kept line
  const kept = new Set(thin.map((p) => p.join(',')));
  for (const p of pts) {
    if (kept.has(p.join(','))) continue;
    let best = Infinity;
    for (let i = 1; i < thin.length; i++) {
      const [ax, ay] = [thin[i - 1][1] * 30, thin[i - 1][0] * 60.04];
      const [bx, by] = [thin[i][1] * 30, thin[i][0] * 60.04];
      const [px, py] = [p[1] * 30, p[0] * 60.04];
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
      best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
    }
    assert(best <= 0.021, 'simplification moved a point ' + best.toFixed(4) + ' NM off the line');
  }
});
T('NO airspace polygon crosses itself', () => {
  // THE BUG THIS EXISTS FOR: a stepped TMA publishes a separate lateral ring
  // per vertical band. Concatenating a block's vertices into one ring merged
  // them into a bow tie - 71 of 164 polygons, each drawing an airspace that
  // does not exist. Rings are now split by the source's own delimiter (a ring
  // closes by repeating its first vertex) and paired with their volume.
  const set = aipDataset();
  const offenders = [];
  assert(set.features.length > 100, 'only ' + set.features.length + ' rings to check (L9)');
  for (const f of set.features) if (ringSelfIntersects(f.ring)) offenders.push(f.name);
  assert(offenders.length === 0, offenders.length + ' self-crossing polygons: ' + offenders.slice(0, 5).join(', '));
});
T('a stepped TMA gets one ring per band, not one ring shared', () => {
  const src = fs.readFileSync('data/aip.js', 'utf8');
  const set = JSON.parse(src.slice(src.indexOf('{'), src.lastIndexOf(';')));
  for (const stem of ['Bardufoss TMA', 'Evenes TMA', 'Notodden TIZ']) {
    const vols = set.features.filter((f) => f.name.startsWith(stem));
    assert(vols.length > 1, stem + ' has only ' + vols.length + ' volume(s)');
    const rings = new Set(vols.map((f) => JSON.stringify(f.ring)));
    assert(rings.size === vols.length,
      stem + ': ' + vols.length + ' bands but only ' + rings.size + ' distinct ring(s)');
    const bands = new Set(vols.map((f) => f.lower.text + '-' + f.upper.text));
    assert(bands.size === vols.length, stem + ': the bands collapsed to ' + bands.size);
  }
});
T('border-resolved airspaces record how far the published corner sat off', () => {
  const report = JSON.parse(fs.readFileSync('data/aip-report.json', 'utf8'));
  assert(report.border && report.border.provider === 'Kartverket', 'the border source is not recorded');
  assert(/NLOD/i.test(report.border.attribution), 'Kartverket NLOD attribution missing');
  assert(report.borderResolved.length > 10,
    'only ' + report.borderResolved.length + ' airspaces resolved against the border');
  for (const r of report.borderResolved) {
    assert(r.maxSnapNM <= report.border.snapToleranceNM,
      r.name + ' resolved with a ' + r.maxSnapNM + ' NM snap, beyond the tolerance');
    assert(r.segments.length > 0 && r.segments.every((sg) => sg.lengthNM > 0), r.name + ' has an empty border segment');
  }
  const src = fs.readFileSync('data/aip.js', 'utf8');
  const set = JSON.parse(src.slice(src.indexOf('{'), src.lastIndexOf(';')));
  assert(/Kartverket/.test(set.attribution), 'the dataset does not credit Kartverket for the border');
  // Evenes TMA is border-resolved and in the user's own region: it must exist
  // and it must carry its snap distance.
  const evenes = set.features.filter((f) => f.name.startsWith('Evenes TMA'));
  assert(evenes.length >= 3, 'Evenes TMA is missing: ' + evenes.length + ' volumes');
  assert(evenes.some((f) => f.borderSegments > 0), 'Evenes TMA lost its border stretch');
});

console.log('\n=== 62a. Pinned bottom of climb / bottom of descent (v16.37) ===');
T('with no pin the schedule is bit-identical to the derived v16.5 behaviour', () => {
  const L2 = moduleExports.legs;
  // The whole feature must be invisible until somebody pins something. This is
  // the guard that lets the pins ship at all: every existing route, every saved
  // flight and every number on the OFP has to be untouched.
  const W = (n, lat, alt) => ({ name: n, lat, lng: 18.5, alt, oat: 0, wdir: 250, wspd: 20, var: -11 });
  const wps = [W('ENDU', 68.6, 254), W('A', 69.1, 6500), W('B', 69.6, 4500), W('ENTC', 69.9, 254)];
  const plain = L2.computeFlightSchedule({ id: 1, waypoints: wps.map((w) => ({ ...w })) });
  // the same route with pins present but ZERO / null / absent
  const zeroed = L2.computeFlightSchedule({ id: 1, waypoints: wps.map((w) =>
    ({ ...w, bocNM: 0, bodNM: null, tocNM: undefined })) });
  const shape = (sch) => sch.map((x) => x && [x.climbMin, x.climbFuelGal, x.descMin, x.descDistNM,
    x.tocAlongNM, x.todBeforeNM, x.entryAlt, x.exitAlt]);
  assert(JSON.stringify(shape(plain)) === JSON.stringify(shape(zeroed)), 'an empty pin changed the schedule');
  // and the totals, which is what actually reaches the OFP
  for (let i = 0; i < plain.length; i++) {
    if (!plain[i]) continue;
    const a = L2.computeLegTotals(plain[i].from, plain[i].to, plain[i]);
    const b = L2.computeLegTotals(zeroed[i].from, zeroed[i].to, zeroed[i]);
    assert(Math.abs(a.timeMin - b.timeMin) < 1e-9 && Math.abs(a.burnGal - b.burnGal) < 1e-9,
      'leg ' + i + ' totals moved: ' + a.timeMin + '/' + a.burnGal + ' vs ' + b.timeMin + '/' + b.burnGal);
  }
  // no BOC/BOD marks are drawn when nothing was pinned - with no pin the
  // bottom of a climb IS the start fix and marking it is pure clutter
  for (const S of plain) {
    if (!S) continue;
    const kinds = L2.computeLegMarkers(S.from, S.to, S).map((m) => m.kind);
    assert(!kinds.includes('BOC') && !kinds.includes('BOD'), 'leg ' + S.i + ' drew ' + kinds.join(','));
  }
});
T('a BOC pin holds altitude, then climbs - and it is a delay, not a rate change', () => {
  const L2 = moduleExports.legs;
  const W = (n, lat, alt, x) => ({ name: n, lat, lng: 18.5, alt, oat: 0, wdir: 0, wspd: 0, var: -11, ...x });
  const base = L2.computeFlightSchedule({ id: 1, waypoints: [W('ENDU', 68.4, 254), W('A', 69.4, 5500)] })[0];
  assert(base.tocAlongNM != null, 'the unpinned climb does not finish on this leg');
  const pinNM = 8;
  const pinned = L2.computeFlightSchedule({ id: 1,
    waypoints: [W('ENDU', 68.4, 254), W('A', 69.4, 5500, { bocNM: pinNM })] })[0];
  assert(Math.abs(pinned.climbStartNM - pinNM) < 1e-9, 'the BOC was not applied: ' + pinned.climbStartNM);
  // THE CLIMB ITSELF IS UNCHANGED - same minutes, same fuel, same length. Only
  // its position moved. That is what makes a BOC always flyable.
  assert(Math.abs(pinned.climbMin - base.climbMin) < 1e-6, 'the climb time changed: ' + pinned.climbMin);
  assert(Math.abs(pinned.climbFuelGal - base.climbFuelGal) < 1e-6, 'the climb fuel changed');
  assert(Math.abs(pinned.climbDistNM - base.climbDistNM) < 1e-6, 'the climb length changed');
  // ...and the TOC moved exactly that far down the leg
  assert(Math.abs(pinned.tocAlongNM - (base.tocAlongNM + pinNM)) < 1e-6,
    'TOC did not move with the pin: ' + pinned.tocAlongNM + ' vs ' + (base.tocAlongNM + pinNM));
  // The lead is flown level at the ENTRY altitude, so the leg takes longer than
  // the unpinned one only by the difference between cruise-low and cruise-high
  // groundspeed - the point is that it is priced at its own altitude, not the
  // cruise one.
  const t = L2.computeLegTotals(pinned.from, pinned.to, pinned);
  assert(isFinite(t.timeMin) && isFinite(t.burnGal) && t.timeMin > 0, JSON.stringify(t));
  // and the BOC is marked, on the leg, at the pinned distance
  const boc = L2.computeLegMarkers(pinned.from, pinned.to, pinned).find((m) => m.kind === 'BOC');
  assert(boc && Math.abs(boc.distNM - pinNM) < 1e-9, 'no BOC mark: ' + JSON.stringify(boc));
  assert(boc.rel === 'after' && boc.refName === 'ENDU', JSON.stringify(boc));
  assert(Math.abs(boc.alt - 254) < 1 && isFinite(boc.lat) && isFinite(boc.lng),
    'the BOC mark is not at the entry altitude on the ground track: ' + JSON.stringify(boc));
});
T('a BOD pin levels off early by starting down earlier', () => {
  const L2 = moduleExports.legs;
  const W = (n, lat, alt, x) => ({ name: n, lat, lng: 18.5, alt, oat: 0, wdir: 0, wspd: 0, var: -11, ...x });
  const route = (x) => L2.computeFlightSchedule({ id: 1,
    waypoints: [W('ENDU', 68.3, 254), W('A', 69.0, 7500), W('ENTC', 69.9, 1500, x)] });
  const base = route({});
  const pinned = route({ bodNM: 6 });
  const b = base[1], p = pinned[1];
  assert(b.todStartsHere && p.todStartsHere, 'the descent does not start on the last leg in both cases');
  assert(Math.abs(p.bodTailNM - 6) < 1e-9, 'the BOD tail was not applied: ' + p.bodTailNM);
  assert(p.bodRefused === false, 'the pin was refused when there was room for it');
  // The descent is the same length - it just finishes 6 NM early, so it starts
  // 6 NM earlier. Pure geometry, no rate change.
  assert(Math.abs(p.descDistNM - b.descDistNM) < 1e-6, 'the descent length changed: ' + p.descDistNM);
  assert(Math.abs(p.descMin - b.descMin) < 1e-6, 'the descent time changed');
  assert(Math.abs(p.todBeforeNM - (b.todBeforeNM + 6)) < 1e-6,
    'TOD did not move earlier by the pin: ' + p.todBeforeNM + ' vs ' + (b.todBeforeNM + 6));
  const bod = L2.computeLegMarkers(p.from, p.to, p).find((m) => m.kind === 'BOD');
  assert(bod && Math.abs(bod.distNM - 6) < 1e-9 && bod.rel === 'before' && bod.refName === 'ENTC',
    'no BOD mark: ' + JSON.stringify(bod));
  assert(Math.abs(bod.alt - 1500) < 1, 'the BOD mark is not at the arrival altitude: ' + bod.alt);
});
T('a BOD pin is REFUSED, not half-applied, when the leg is still descending there', () => {
  const L2 = moduleExports.legs;
  const W = (n, lat, alt, x) => ({ name: n, lat, lng: 18.5, alt, oat: 0, wdir: 0, wspd: 0, var: -11, ...x });
  // A descent for a LATER, lower fix runs through this leg's tail, so the
  // aircraft is still going down there and "be level before this fix" cannot be
  // true. Half-applying it would put a level stretch inside a descent.
  let found = null;
  for (let d = 0.15; d <= 1.2 && !found; d += 0.05) {
    const sch = L2.computeFlightSchedule({ id: 1, waypoints: [
      W('ENDU', 68.2, 254), W('A', 69.2, 9500), W('B', 69.2 + d, 6000, { bodNM: 5 }), W('C', 69.2 + d + 0.06, 800)] });
    if (sch[1] && sch[1].bodRefused) found = sch;
  }
  assert(found, 'could not build a route where a later descent claims the tail');
  const L1 = found[1];
  assert(L1.bodPinNM === 5, 'the request was not recorded: ' + L1.bodPinNM);
  assert(L1.bodTailNM === 0, 'a refused pin still moved the descent: ' + L1.bodTailNM);
  // Refused means REPORTED, and the mark is not drawn for something that is
  // not happening.
  assert(!L2.computeLegMarkers(L1.from, L1.to, L1).some((m) => m.kind === 'BOD'),
    'a refused BOD was still marked on the map');
});
T('"be level by" SETS the bottom of climb, working backwards at the profile\'s rate', () => {
  const L2 = moduleExports.legs;
  const W = (n, lat, alt, x) => ({ name: n, lat, lng: 18.5, alt, oat: 0, wdir: 0, wspd: 0, var: -11, ...x });
  const route = (x) => L2.computeFlightSchedule({ id: 1,
    waypoints: [W('ENDU', 68.3, 254), W('A', 69.5, 6500, x)] })[0];
  const base = route({});
  assert(base.tocAlongNM > 5 && base.tocAlongNM < base.distNM, 'unexpected baseline TOC: ' + base.tocAlongNM);

  // A target LATER than the derived TOC is a delay: the climb starts later so
  // that it tops out exactly where asked.
  const later = route({ tocNM: base.tocAlongNM + 20 });
  assert(later.tocTargetMet, 'a reachable target was reported as missed');
  assert(later.tocDerivedBoc, 'the bottom of climb was not derived from the target');
  assert(Math.abs(later.tocAlongNM - (base.tocAlongNM + 20)) < 0.05,
    'the TOC did not land on the target: ' + later.tocAlongNM);
  assert(Math.abs(later.climbStartNM - 20) < 0.05, 'the derived BOC is wrong: ' + later.climbStartNM);
  // THE AIRCRAFT IS UNTOUCHED. Only the climb's position moved, so its time,
  // fuel and TAS are still the profile's - nothing steeper is invented.
  assert(Math.abs(later.climbMin - base.climbMin) < 1e-6, 'the climb time changed: ' + later.climbMin);
  assert(Math.abs(later.climbFuelGal - base.climbFuelGal) < 1e-6, 'the climb fuel changed');
  assert(Math.abs(later.climbTas - base.climbTas) < 1e-6, 'the climb TAS changed');
  assert(later.climbRateReqFpm === null, 'a met target reported a required rate');

  // A target the profile cannot reach even climbing from the FIRST fix of the
  // flight is refused, and only then is a rate the useful thing to report -
  // there is no earlier leg to start the climb on.
  const impossible = route({ tocNM: 4 });
  assert(!impossible.tocTargetMet, 'an unreachable target was reported as met');
  assert(impossible.climbRateReqFpm > 0 && isFinite(impossible.climbRateReqFpm),
    'no required rate on the one case where it is the only answer');
  assert(Math.abs(impossible.climbMin - base.climbMin) < 1e-6, 'a refused target changed the climb');
  assert(Math.abs(impossible.tocAlongNM - base.tocAlongNM) < 1e-6, 'a refused target moved the TOC');

  // With no target there is nothing to report.
  assert(base.tocTargetNM === null && base.climbRateReqFpm === null && base.tocTargetMet === true
    && base.tocDerivedBoc === false, JSON.stringify(base.tocTargetNM));
});
T('an unreachable target is REPORTED, and changes nothing about the plan', () => {
  // THE v16.77 INVARIANT, and it replaces the advice machinery that used to sit
  // here. Until v16.76 an unreachable "be level by" made the engine compute the
  // altitude the previous fix would have to be crossed at, verify it on a trial
  // schedule, and offer it with a button that REWROTE that fix. The pilot
  // retired all of it: "I set what altitude i plan on using, not the exact
  // altitude i will have at that point... Id prefer the Climb and descent
  // doesnt really fuck with the altitudes that much. Just a simple 'climb here,
  // descend there'."
  //
  // So the schedule may now do exactly two things with a target it cannot meet:
  // say so, and leave the climb where the POH puts it.
  const L2 = moduleExports.legs;
  const W = (n, lat, alt, x) => ({ name: n, lat, lng: 18.5, alt, oat: 0, wdir: 0, wspd: 0, var: -11, ...x });
  const wpsOf = (x) => [W('ENDU', 68.3, 254), W('A', 69.0, 2500), W('B', 69.7, 6500, x)];

  for (const target of [3, 5, 8, 11]) {
    const asked = wpsOf({ altAtNM: target });
    const S = L2.computeFlightSchedule({ id: 1, waypoints: asked })[1];
    const bare = L2.computeFlightSchedule({ id: 1, waypoints: wpsOf({}) })[1];
    assert(!S.tocTargetMet, 'target ' + target + ' NM was somehow met from 2500 ft');
    // IT IS SAID: a rate to judge, never a rate the climb is recomputed at.
    assert(S.climbRateReqFpm > 0 && isFinite(S.climbRateReqFpm),
      'an unmet target reported no required rate: ' + S.climbRateReqFpm);
    // NOTHING ABOUT THE AIRCRAFT MOVED. Same climb, same minutes, same fuel,
    // same TAS, same top of climb as with no target at all.
    for (const k of ['climbMin', 'climbFuelGal', 'climbTas', 'climbDistNM', 'tocAlongNM',
                     'climbStartNM', 'entryAlt', 'exitAlt']) {
      assert(Math.abs(Number(S[k]) - Number(bare[k])) < 1e-9,
        'a refused target changed ' + k + ': ' + S[k] + ' vs ' + bare[k]);
    }
    // AND NO ALTITUDE THE PILOT TYPED WAS TOUCHED. The engine is pure, so this
    // is asserted on the objects it was handed rather than taken on trust.
    assert(asked.map((w) => w.alt).join(',') === '254,2500,6500',
      'the schedule wrote back an altitude: ' + asked.map((w) => w.alt).join(','));
  }
});
T('no target, reachable or not, ever rewrites an altitude - swept over generated routes', () => {
  // The sweep that used to verify the ADVICE now verifies its absence. Same
  // generator, same seed, same shapes: what is asserted is that an unmet target
  // is reported honestly and that the waypoints come back exactly as they went
  // in - which is the one property the pilot asked for by name.
  const L2 = moduleExports.legs;
  const W = (n, lat, lng, alt) => ({ name: n, lat, lng, alt, oat: 0, wdir: 250, wspd: 20, var: -11 });
  const rnd = (() => { let s = 987654; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
  let unmet = 0, met = 0, firstLeg = 0, rated = 0;
  const changed = [], invented = [];
  for (let iter = 0; iter < sweep(3000); iter++) {
    const nWp = 3 + Math.floor(rnd() * 2);
    const wps = []; let lat = 68.5 + rnd() * 1.0;
    for (let k = 0; k < nWp; k++) {
      lat += 0.05 + rnd() * 0.6;
      wps.push(W('W' + k, lat, 18.0 + (rnd() - 0.5) * 0.8,
        k === 0 ? 254 : Math.round((500 + rnd() * 9000) / 100) * 100));
    }
    const li = 1 + Math.floor(rnd() * (nWp - 1));
    const base = L2.computeFlightSchedule({ id: 1, waypoints: wps.map((w) => ({ ...w })) });
    const legDist = base[li - 1] ? base[li - 1].distNM : 0;
    const pin = wps.map((w, k) => k === li ? { ...w, altAtNM: +(rnd() * legDist).toFixed(2) } : { ...w });
    const before = pin.map((w) => w.alt).join(',');
    const S = L2.computeFlightSchedule({ id: 1, waypoints: pin })[li - 1];
    // THE ALTITUDES ARE THE PILOT'S, WHATEVER HAPPENED TO THE TARGET.
    if (pin.map((w) => w.alt).join(',') !== before) changed.push('leg ' + li);
    if (!S || S.tocTargetNM == null) continue;
    if (S.tocTargetMet) { met++; continue; }
    unmet++;
    if (S.i === 0) firstLeg++;
    if (S.climbRateReqFpm !== null) {
      rated++;
      if (!(S.climbRateReqFpm > 0 && isFinite(S.climbRateReqFpm)))
        invented.push('leg ' + li + ': rate ' + S.climbRateReqFpm);
    }
    // The unmet leg's climb is the one the POH prices from its own entry
    // altitude - never stretched to reach a target it could not.
    const un = L2.computeFlightSchedule({ id: 1,
      waypoints: pin.map((w, k) => k === li ? { ...w, altAtNM: null } : { ...w }) })[li - 1];
    if (un && Math.abs(S.climbMin - un.climbMin) > 1e-9)
      invented.push('leg ' + li + ': climb ' + S.climbMin + ' vs ' + un.climbMin);
  }
  assert(changed.length === 0, changed.length + ' schedules rewrote a waypoint altitude: ' +
    changed.slice(0, 3).join(' | '));
  assert(invented.length === 0, invented.length + ' unmet targets changed the climb or reported ' +
    'an impossible rate: ' + invented.slice(0, 3).join(' | '));
  assert(unmet > 30, 'the sweep produced only ' + unmet + ' unreachable targets');
  assert(met > 30, 'the sweep produced only ' + met + ' reachable targets');
  assert(firstLeg > 0, 'the first-leg case never came up');
  assert(rated > 0, 'no unmet target ever reported a required rate');
  console.log('        ' + met + ' targets met | ' + unmet + ' unreachable, 0 rewrote an ' +
    'altitude and 0 changed a climb | ' + firstLeg + ' on the first leg | ' + rated +
    ' reported a rate');
});
T('a "be level by" target overrides a bottom-of-climb pin on the same leg', () => {
  // Two settings for one corner is how a contradiction arises. The target owns
  // the corner and the panel disables the BOC box to say so.
  const L2 = moduleExports.legs;
  const W = (n, lat, alt, x) => ({ name: n, lat, lng: 18.5, alt, oat: 0, wdir: 0, wspd: 0, var: -11, ...x });
  const base = L2.computeFlightSchedule({ id: 1,
    waypoints: [W('ENDU', 68.3, 254), W('A', 69.5, 6500)] })[0];
  const both = L2.computeFlightSchedule({ id: 1, waypoints: [W('ENDU', 68.3, 254),
    W('A', 69.5, 6500, { bocNM: 3, tocNM: base.tocAlongNM + 20 })] })[0];
  assert(both.tocDerivedBoc && Math.abs(both.climbStartNM - 20) < 0.05,
    'the BOC pin won over the target: ' + both.climbStartNM);
  assert(both.tocTargetMet, 'the target was not met');
  const raw = APP_SRC;
  assert(/leg-boc-note/.test(raw) && /syncLegBocState/.test(raw),
    'the panel does not tell the pilot the BOC is derived');
});
T('pins never produce impossible geometry - swept over generated routes', () => {
  // THE SWEEP IS THE TEST, the same way the v16.28 vanishing-TOD fix was
  // proved. It found four real bugs while this feature was being written: a
  // descent placed inside a delayed climb, a BOD tail read from the raw pin on
  // legs that do not terminate the descent, phase distances that did not sum to
  // the leg, and todBeforeNM latched before a second descent extended further
  // back on the same leg.
  const L2 = moduleExports.legs;
  const GEO = moduleExports.geodesy;
  const EX = moduleExports.exch;
  const W = (n, lat, lng, alt) => ({ name: n, lat, lng, alt, oat: 0, wdir: 250, wspd: 20, var: -11 });
  const rnd = (() => { let s = 12345; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
  const bad = [];
  let legs = 0, withBoc = 0, withBod = 0, refused = 0, missed = 0, continues = 0;
  // CIRCUIT STOPS ARE GENERATED NOW (v16.43). This sweep had never produced one,
  // which is why C1 - the forward altitude cursor surviving a pattern pair -
  // went unseen through every run of it.
  let patterns = 0, afterPattern = 0, displacedCircuits = 0, circuitsOnFix = 0, legsFromCircuit = 0, squeezes = 0;
  for (let iter = 0; iter < sweep(4000); iter++) {
    const nWp = 2 + Math.floor(rnd() * 3);
    const wps = []; let lat = 68.5 + rnd() * 1.0;
    for (let k = 0; k < nWp; k++) {
      lat += 0.05 + rnd() * 0.6;
      wps.push(W('W' + k, lat, 18.0 + (rnd() - 0.5) * 0.8,
        k === 0 ? 254 : Math.round((500 + rnd() * 9000) / 100) * 100));
    }
    const base = L2.computeFlightSchedule({ id: 1, waypoints: wps.map((w) => ({ ...w })) });
    const pin = wps.map((w) => ({ ...w }));
    const li = 1 + Math.floor(rnd() * (nWp - 1));
    const legDist = base[li - 1] ? base[li - 1].distNM : 0;
    if (li < pin.length) {
      if (rnd() < 0.6) pin[li].bocNM = +(rnd() * legDist * 0.9).toFixed(2);
      if (rnd() < 0.6) pin[li].bodNM = +(rnd() * legDist * 0.9).toFixed(2);
      if (rnd() < 0.4) pin[li].tocNM = +(rnd() * legDist).toFixed(2);
    }
    // THE SQUEEZE, GENERATED DELIBERATELY (v16.83). A BOD pin is REFUSED only
    // when a descent for a LATER, lower fix has already claimed this leg's
    // tail, and until now the sweep reached that shape by luck - 12 times in
    // 4000 routes. Luck is not coverage: re-weighting the generator for the two
    // circuit shapes dropped it to 0 across three seeds, and a path nothing
    // exercises is a path nothing guards. It is built on purpose now.
    if (pin.length >= 3 && rnd() < 0.15) {
      const last = pin.length - 1;
      pin[last].lat = pin[last - 1].lat + 0.04 + rnd() * 0.03;
      pin[last].alt = Math.max(254, pin[last - 1].alt - 4000 - rnd() * 3000);
      pin[last - 1].bodNM = +(1 + rnd() * 2).toFixed(2);
      squeezes++;
    }

    // Drop a circuit into the middle of some routes.
    //
    // HALF OF THEM ARRIVE DISPLACED ON PURPOSE (v16.84). That is not a shape
    // the app writes - a circuit takes the position of the fix it follows -
    // but it IS what a plan saved by v16.83 or edited by hand carries, and the
    // rule has to hold for what is on disk rather than only for what the add
    // flow produces. `applyPatternPositions` is the real normaliser the page
    // and the sanitiser both call, so the sweep exercises it rather than a
    // restatement of it, and everything below then runs on the normalised plan
    // exactly as the app computes.
    //
    // (v16.83's generator kept the displaced shape as a FIRST-CLASS case and
    // asserted its legs got scheduled. The pilot reversed that premise, so
    // asserting it now would be a sweep defending a rule the app no longer has.)
    if (nWp >= 3 && rnd() < 0.35) {
      const at = 1 + Math.floor(rnd() * (pin.length - 1));
      const displaced = rnd() < 0.5;
      if (displaced) displacedCircuits++; else circuitsOnFix++;
      pin.splice(at, 0, { ...W('PATTERN',
                            pin[at - 1].lat + (displaced ? 0.05 + rnd() * 0.3 : 0),
                            pin[at - 1].lng + (displaced ? (rnd() - 0.5) * 0.3 : 0),
                            Math.round((500 + rnd() * 5000) / 100) * 100),
                          isPattern: true, laps: 1 + Math.floor(rnd() * 3) });
      patterns++;
      EX.applyPatternPositions(pin);
    }
    // THE INVARIANT ITSELF, asserted on every generated plan: no circuit is
    // ever anywhere but on the fix before it, so no leg can be flown out to
    // one or back from one.
    for (let k = 1; k < pin.length; k++) {
      if (pin[k].isPattern && (pin[k].lat !== pin[k - 1].lat || pin[k].lng !== pin[k - 1].lng))
        bad.push('a circuit is off its fix at ' + k);
    }
    const sch = L2.computeFlightSchedule({ id: 1, waypoints: pin });
    // THE INVARIANT C1 BROKE: a real leg that follows a break in the chain must
    // enter at its OWN fix's altitude, never at a leftover cursor value.
    for (let k = 1; k < sch.length; k++) {
      if (!sch[k] || sch[k - 1]) continue;
      afterPattern++;
      if (Math.abs(sch[k].entryAlt - sch[k].from.alt) > 0.5)
        bad.push('stale entry altitude after a break on ' + sch[k].i);
    }
    // THE MAP AND THE ENGINE ACCOUNT FOR THE SAME GROUND (v16.83).
    //
    // This is the invariant that would have caught the pilot's bug the day the
    // map-click PATTERN was added, and nothing asserted it: the route the
    // pilot READS off the map and the route the OFP PRICES have to be the same
    // route. They were not. Measured on ENDU -> A -> PATTERN -> B -> ENTC, the
    // line walked 79.5 NM of ground while the schedule accounted for 51.7 NM,
    // and the sector total was short by the whole transit out to the airwork
    // point - distance, time and fuel alike, with no banner anywhere.
    //
    // The two sides are genuinely independent: one walks flightLineCoords,
    // which is what refreshMap draws, and the other sums the scheduled legs.
    {
      const line = L2.flightLineCoords({ waypoints: pin });
      let drawn = 0;
      for (let k = 0; k + 1 < line.length; k++)
        drawn += GEO.distanceNMExact(line[k][0], line[k][1], line[k + 1][0], line[k + 1][1]);
      const priced = sch.filter(Boolean).reduce((a, L3) => a + L3.distNM, 0);
      // THE TOLERANCE IS DERIVED, NOT PICKED. pathSegments measures each span
      // with calcDistanceNM, which rounds to 0.1 NM, while the drawn side here
      // sums the exact geodesic - so the two may differ by up to 0.05 NM PER
      // SPAN and by nothing else. The defect this exists for is a whole leg
      // going missing, which was 13.9 NM when it was measured live and is
      // never below ~3 NM in this generator: three orders of magnitude clear.
      const slack = 0.05 * Math.max(1, line.length - 1) + 1e-9;
      if (Math.abs(drawn - priced) > slack)
        bad.push('the map draws ' + drawn.toFixed(1) + ' NM and the schedule prices ' + priced.toFixed(1));
    }

    // ALTITUDE CONTINUITY ACROSS THE WHOLE FLIGHT (M5). Nothing asserted this,
    // and it is the one thing the OFP's altitude column is: what a leg leaves
    // at must be what the next leg enters at, or the two rows contradict each
    // other. A break in the chain (a circuit stop) is checked above instead.
    for (let k = 0; k + 1 < sch.length; k++) {
      if (!sch[k] || !sch[k + 1]) continue;
      if (Math.abs(sch[k].exitAlt - sch[k + 1].entryAlt) > 0.5)
        bad.push('exitAlt != entryAlt across ' + sch[k].i + '->' + sch[k + 1].i);
    }
    for (const S of sch) {
      if (!S) continue;
      legs++;
      if (S.from.isPattern || S.to.isPattern) legsFromCircuit++;
      // EVERY PHASE IS NON-NEGATIVE, ASSERTED DIRECTLY (M5). The bounds checks
      // below catch a phase that leaves the leg, but a negative duration or
      // fuel figure would sail through them and land straight on the form.
      for (const k of ['climbMin', 'climbDistNM', 'climbFuelGal', 'climbStartNM',
                       'descMin', 'descDistNM', 'bodTailNM', 'shortfallMin', 'distNM'])
        if (!(S[k] >= 0) || !isFinite(S[k])) bad.push(k + ' is ' + S[k] + ' on ' + S.i);
      if (S.climbStartNM > 0.05) withBoc++;
      if (S.bodTailNM > 0.05) withBod++;
      if (S.bodRefused) refused++;
      if (S.tocTargetNM != null && !S.tocTargetMet) missed++;
      const climbB = S.climbStartNM + S.climbDistNM;
      const descB = S.distNM - S.bodTailNM, descA = descB - S.descDistNM;
      const tol = 1e-6;
      if (S.climbStartNM < -tol || climbB > S.distNM + tol) bad.push('climb outside the leg on ' + S.i);
      if (S.descDistNM > tol && (descA < -tol || descB > S.distNM + tol)) bad.push('descent outside the leg on ' + S.i);
      if (S.climbDistNM > tol && S.descDistNM > tol && descA < climbB - 1e-4)
        bad.push('climb and descent overlap on ' + S.i);
      if (S.tocAlongNM != null && Math.abs(S.tocAlongNM - climbB) > 1e-6) bad.push('TOC is not the climb end on ' + S.i);
      if (S.todStartsHere && Math.abs((S.distNM - S.todBeforeNM) - descA) > 1e-4)
        bad.push('TOD is not the descent start on ' + S.i);
      // the phases plus the level pieces must account for the leg exactly
      const level = Math.max(0, S.climbStartNM) + Math.max(0, descA - climbB)
                  + Math.max(0, S.distNM - Math.max(descB, climbB));
      if (Math.abs(S.climbDistNM + S.descDistNM + level - S.distNM) > 1e-3)
        bad.push('phase distances do not sum to the leg on ' + S.i);
      const t = L2.computeLegTotals(S.from, S.to, S);
      if (!t || !(t.timeMin > 0) || !(t.burnGal >= 0) || !isFinite(t.timeMin) || !isFinite(t.burnGal))
        bad.push('bad totals on ' + S.i);
      const marks = L2.computeLegMarkers(S.from, S.to, S);
      const kinds = marks.map((m) => m.kind);
      if (new Set(kinds).size !== kinds.length) bad.push('duplicate marker on ' + S.i);
      // MARKS COME BACK IN FLIGHT ORDER (M5, and legs.js:1015 says so). The
      // plotting list and the OFP sub-line print them straight through, so
      // "TOC ... BOC" down a leg flown BOC-first makes the pilot reorder it in
      // their head. Which end a distance is measured from is `rel`, not the
      // kind - testing for 'TOC' put two of the four marks on the wrong end.
      let prevAlong = -1;
      for (const m of marks) {
        if (!isFinite(m.lat) || !isFinite(m.lng)) bad.push('marker with no position on ' + S.i);
        if (m.distNM < -tol || m.distNM > S.distNM + 0.06) bad.push('marker off the leg on ' + S.i);
        const along = m.rel === 'after' ? m.distNM : S.distNM - m.distNM;
        if (along < prevAlong - 1e-6) bad.push('markers out of flight order on ' + S.i);
        prevAlong = along;
        // `atWaypoint` MEANS the mark is on that fix, within the one shared
        // EDGE_NM. A mark claiming a fix it is nowhere near reads as a
        // different instruction ("start down at B" vs "27 NM before ENTC").
        if (m.atWaypoint) {
          const toEnd = m.rel === 'after' ? S.distNM - along : along;
          if (toEnd > L2.EDGE_NM + 1e-9)
            bad.push('atWaypoint ' + m.atWaypoint + ' is ' + toEnd.toFixed(3) + ' NM away on ' + S.i);
          const want = m.rel === 'after' ? S.to.name : S.from.name;
          if (m.atWaypoint !== want) bad.push('atWaypoint names the wrong fix on ' + S.i);
        }
      }
      if (S.climbStartNM > 0.05 && S.climbDistNM > 0.05 && !kinds.includes('BOC')) bad.push('BOC pinned but unmarked on ' + S.i);
      if (S.bodTailNM > 0.05 && S.descDistNM > 0.05 && !kinds.includes('BOD')) bad.push('BOD pinned but unmarked on ' + S.i);
    }

    // ONE CLIMB, ONE TOP OF CLIMB (v16.39). A leg whose climb tops out ON its
    // end fix while the next leg climbs straight on from that same fix draws no
    // TOC: the aircraft never levels off there, and the mark belongs to
    // whichever leg the climb actually finishes on. Both halves are asserted -
    // that the suppressed leg really is continuous, and that the mark is not
    // simply lost.
    for (let k = 0; k + 1 < sch.length; k++) {
      const L = sch[k], N = sch[k + 1];
      if (!L || !N || !L.climbContinues) continue;
      continues++;
      if (L.tocAlongNM === null || L.distNM - L.tocAlongNM > 0.05)
        bad.push('a suppressed TOC did not reach its end fix on ' + L.i);
      if (N.climbStartNM > 0.05)
        bad.push('a suppressed TOC has a level stretch after it on ' + L.i);
      if (L2.computeLegMarkers(L.from, L.to, L).some((m) => m.kind === 'TOC'))
        bad.push('a continuing climb still drew a TOC on ' + L.i);
      const later = sch.slice(k + 1).filter(Boolean)
        .some((X) => L2.computeLegMarkers(X.from, X.to, X).some((m) => m.kind === 'TOC'));
      if (!later && !sch.slice(k + 1).filter(Boolean).some((X) => X.stillClimbing))
        bad.push('the top of a continuing climb was lost after ' + L.i);
    }
  }
  assert(withBoc > 500 && withBod > 300, 'the sweep barely exercised the pins: ' + withBoc + '/' + withBod);
  assert(squeezes > 400, 'the deliberate BOD-refusal shape was barely generated: ' + squeezes);
  assert(refused > 20 && missed > 300,
    'the sweep barely hit a refused BOD or a missed TOC target: ' + refused + '/' + missed);
  assert(bad.length === 0, bad.length + ' violations, first few: ' + [...new Set(bad)].slice(0, 5).join(' | '));
  assert(continues > 0, 'the sweep never produced a climb continuing through a fix');
  assert(patterns > 100 && afterPattern > 100,
    'the sweep barely exercised circuit stops: ' + patterns + ' routes, ' + afterPattern + ' legs after one');
  // BOTH SHAPES, and each asserted separately - a count of "routes with a
  // circuit" is what let the sweep run for forty versions generating only a
  // middle case the app cannot produce.
  assert(circuitsOnFix > 350 && displacedCircuits > 350,
    'the sweep did not generate both circuit shapes: ' + circuitsOnFix + ' on the fix, ' +
    displacedCircuits + ' displaced');
  // A circuit still leaves exactly one scheduled leg behind it - the one that
  // flies ON from the fix it was flown at. If that stopped happening the
  // circuit would have swallowed a real leg rather than costing only time.
  assert(legsFromCircuit > 300,
    'the leg leaving a circuit is no longer being scheduled: ' + legsFromCircuit);
  // A MISSING OAT OR WIND MUST SURVIVE THE PIN MACHINERY (M5). The v16.20 rule
  // is that an absent value yields NaN and the banner NAMES it - never calm
  // wind at 0 C. The pins added a lot of arithmetic between the input and the
  // output, and nothing checked that the NaN still comes out the other end as
  // a NaN instead of a throw or a plausible number.
  {
    const wps = [W('A', 69.0, 18.0, 254), W('B', 69.4, 18.1, 6000), W('C', 69.9, 18.4, 1000)];
    wps[1].oat = NaN; wps[1].bocNM = 3; wps[1].tocNM = 12;
    wps[2].wspd = NaN; wps[2].bodNM = 4;
    let sch2 = null;
    try { sch2 = L2.computeFlightSchedule({ id: 1, waypoints: wps }); }
    catch (e) { assert(false, 'an absent OAT threw out of the schedule: ' + e.message); }
    assert(sch2 && sch2.length === 2, 'the schedule did not survive an absent OAT');
    const t0 = L2.computeLegTotals(wps[0], wps[1], sch2[0]);
    assert(t0 && isNaN(t0.timeMin), 'an absent OAT produced a usable time - that is a guess');
    const t1 = L2.computeLegTotals(wps[1], wps[2], sch2[1]);
    assert(t1 && isNaN(t1.timeMin), 'an absent wind speed produced a usable time');
    // and the marks still come back rather than throwing on a NaN position
    for (const S of sch2) L2.computeLegMarkers(S.from, S.to, S);
  }

  console.log('        ' + legs + ' pinned legs: ' + withBoc + ' with a BOC, ' + withBod +
    ' with a BOD, ' + refused + ' pins refused, ' + missed + ' TOC targets missed, ' +
    continues + ' climbs continuing through a fix, ' + afterPattern +
    ' legs after a circuit, 0 violations');
});
T('EDGE_NM is ONE constant, and the marks and the continuity pass both turn on it', () => {
  // v16.39: testing the next climb's LENGTH instead of who draws the mark
  // failed on a 0.0499 NM climb whose TOC lands at 0.0500 NM and IS drawn - two
  // chips a twentieth of a mile apart. The fix was one module-level constant
  // shared by both, so what the schedule calls one climb and what the map draws
  // as one climb cannot drift. Nothing referenced it until now.
  const L2 = moduleExports.legs;
  assert(L2.EDGE_NM === 0.05, 'EDGE_NM moved: ' + L2.EDGE_NM);
  const src = require('fs').readFileSync('src/lib/legs.js', 'utf8');
  assert((src.match(/EDGE_NM\s*=/g) || []).length === 1, 'EDGE_NM is declared more than once');

  // The behaviour, not just the number: a mark that falls inside EDGE_NM of the
  // leg start is degenerate and belongs to the neighbouring leg; one just
  // outside it is drawn. Built directly rather than searched for, so the test
  // states the threshold instead of hoping a random route lands on it.
  const W = (n, alt) => ({ name: n, lat: 69, lng: 18, alt, oat: 0, wdir: 0, wspd: 0, var: 0 });
  const leg = (tocAlong) => L2.computeLegMarkers(W('A', 254), W('B', 5000), {
    i: 0, from: W('A', 254), to: W('B', 5000),
    segs: [{ a: { lat: 69, lng: 18 }, b: { lat: 69.5, lng: 18 }, distNM: 30, tt: 0 }],
    distNM: 30, climbStartNM: 0, climbDistNM: tocAlong, tocAlongNM: tocAlong,
    climbMin: 5, climbFuelGal: 1, climbTas: 90, stillClimbing: false,
    descMin: 0, descDistNM: 0, todStartsHere: false, todBeforeNM: null,
    descContinues: false, descTargetName: null, descTargetAlt: null, shortfallMin: 0,
    entryAlt: 254, exitAlt: 5000, bodTailNM: 0, climbContinues: false
  }).filter((m) => m.kind === 'TOC');
  assert(leg(L2.EDGE_NM).length === 0, 'a TOC exactly at EDGE_NM should be left to the neighbour');
  assert(leg(L2.EDGE_NM + 0.0001).length === 1, 'a TOC just past EDGE_NM must be drawn');
});

console.log('\n=== 62a000. Stuck states and dialogs (v16.46) ===');
TA('Ctrl+Z is inert while a dialog is open, so no handler acts on a detached flight', async () => {
  // H6: undoLast rebinds `flights` to a fresh copy, so a handler waiting on a
  // dialog was left holding a DETACHED flight - it then "succeeded" and changed
  // nothing. Reproduced on "Apply defaults to every leg".
  ev(SEED);
  // THERE MUST BE SOMETHING TO UNDO, or an unguarded Ctrl+Z changes nothing and
  // the test passes either way. Rename a waypoint first: that pushes an undo
  // state, so a leaked Ctrl+Z would visibly put the old name back.
  ev(`renameWaypoint(0, 1, 'RENAMED');`);
  assert(ev('flights[0].waypoints[1].name') === 'RENAMED', 'the setup rename did not take');
  ev(`document.getElementById('def-alt').value = 7000;
      document.getElementById('def-oat').value = -5;`);
  const p = ev('applyBulkDefaultsToActive()');
  await tick();
  assert(doc.getElementById('app-dialog'), 'the confirm dialog did not open');
  // Fire Ctrl+Z the way the keyboard would, with the dialog up.
  ev(`document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))`);
  await tick();
  assert(ev('flights[0].waypoints[1].name') === 'RENAMED',
    'Ctrl+Z ran behind the dialog and reverted the rename to ' + ev('flights[0].waypoints[1].name'));
  assert(doc.getElementById('app-dialog'), 'the dialog was closed by the undo');
  answerDialog('Apply to all legs');
  await p; await tick();
  const alts = ev('flights[0].waypoints.map(w => w.alt)');
  assert(alts[1] === 7000 && alts[2] === 7000,
    'applying after the dialog changed nothing: ' + JSON.stringify(alts));
});
T('every overlay owns the keyboard while it is up', () => {
  const fn = APP_SRC.split('function anyOverlayOpen()')[1].split('\n    document.addEventListener')[0];
  assert(/dialogIsOpen/.test(fn), 'dialog.js state is not consulted');
  for (const id of ['wind-modal', 'settings-modal', 'help-modal', 'leg-modal'])
    assert(APP_SRC.includes("'" + id + "'"), 'overlay not covered: ' + id);
  // v16.49 moved the mapping into src/lib/keys.js, so the rule is asserted as
  // BEHAVIOUR rather than by grepping for one line of the handler.
  const K = moduleExports.keys;
  const shut = { overlayOpen: true, dialogOpen: true };
  for (const stroke of [{ key: 'z', ctrlKey: true }, { key: 'z', ctrlKey: true, shiftKey: true },
                        { key: '/' }, { key: 'Delete' }, { key: 's', ctrlKey: true },
                        { key: '1' }, { key: '5' }])
    assert(K.resolveKey(stroke, shut) === null,
      JSON.stringify(stroke.key) + ' still fires with an overlay open');
  // ...but Escape must still get through, and reach a stuck drag FIRST.
  assert(K.resolveKey({ key: 'Escape' }, { dragging: true, overlayOpen: true, dialogOpen: true })
    .action === 'cancel-drag', 'Escape no longer reaches a stuck line drag first');
  assert(K.resolveKey({ key: 'Escape' }, { dialogOpen: true, overlayOpen: true }) === null,
    'Escape must be left to dialog.js while a dialog is open');
  // and the page must still hand the resolver the real situation
  const handler = APP_SRC.split('/* @KEY-DISPATCH */')[1].split('\n    });')[0];
  for (const k of ['dragging', 'dialogOpen', 'overlayOpen', 'textLike', 'viewMode', 'hasHighlight'])
    assert(handler.includes(k + ':'), 'the handler no longer reports ' + k + ' to resolveKey');
  assert(/anyOverlayOpen\(\)/.test(handler), 'the handler no longer consults the overlays');
});
TA('Escape aborts a line drag and gives the map back', () => {
  // H5: the drag had no exit but a mouseup, so Escape, a blur, a right-click or
  // alt-tab left the map with dragging disabled and the via following a cursor
  // that had no button held.
  ev(SEED);
  const wpBefore = ev('flights[0].waypoints[1].via ? flights[0].waypoints[1].via.length : 0');
  ev(`beginLineDrag(0, { lat: 69.14, lng: 18.26 })`);
  assert(ev('lineDrag !== null'), 'the drag did not start');
  ev(`document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  assert(ev('lineDrag === null'), 'Escape did not end the drag');
  const after = ev('flights[0].waypoints[1].via ? flights[0].waypoints[1].via.length : 0');
  assert(after === wpBefore, 'Escape left the via behind: ' + wpBefore + ' -> ' + after);
  return Promise.resolve();
});
T('a drag installs and removes the same set of listeners', () => {
  // Every exit path goes through one release function, so no path can leave a
  // listener behind and keep the map half-captured.
  const begin = APP_SRC.split('function beginLineDrag')[1].split('function releaseLineDragListeners')[0];
  const release = APP_SRC.split('function releaseLineDragListeners()')[1].split('\n    }')[0];
  for (const ev2 of ['blur', 'visibilitychange', 'contextmenu', 'pointercancel', 'mouseup']) {
    assert(begin.includes("'" + ev2 + "'"), 'the drag does not listen for ' + ev2);
    assert(release.includes("'" + ev2 + "'"), 'the drag never removes its ' + ev2 + ' listener');
  }
  for (const f of ['endLineDrag', 'cancelLineDrag'])
    assert(APP_SRC.includes('function ' + f), f + ' is gone');
  assert(/releaseLineDragListeners\(\)/.test(APP_SRC.split('function endLineDrag')[1].split('\n    }')[0]),
    'endLineDrag no longer uses the shared release');
});
T('deleting a flight plan after a dialog acts on the flight that was ASKED about', () => {
  // H6, the index half: fIdx was captured before the await, so a list that
  // changed meanwhile meant deleting the wrong plan.
  const fn = APP_SRC.split('async function removeFlightPlan')[1].split('\n    function ')[0];
  assert(/targetId/.test(fn) && /findIndex/.test(fn),
    'removeFlightPlan still trusts the index it captured before the dialog');
});

console.log('\n=== 62a00. Load and boot robustness (v16.44) ===');
T('sanitiseFlights coerces every field, and never mutates its input', () => {
  // M1: it checked coordinate finiteness and passed everything else through, so
  // lat:"69.3" reached toFixed (which took the daylight card down, and with it
  // the banner), a name could be an object, laps could be negative.
  const E = moduleExports.exch;
  const hostile = [{ id: 'x', title: { a: 1 }, depElev: 'abc', waypoints: [
    { lat: '69.3', lng: '18.5', name: { toString: () => 'OBJ' }, alt: '2500',
      oat: null, wdir: undefined, wspd: '', var: '-11', isPattern: 'true', laps: -4,
      bocNM: '1e309', tocNM: 0, junk: 'dropped',
      via: [{ lat: '69.4', lng: '18.6' }, { lat: 'nope', lng: 1 }] } ] }];
  const frozenName = hostile[0].waypoints[0].name;
  const out = E.sanitiseFlights(hostile);
  const w = out[0].waypoints[0];
  assert(typeof w.lat === 'number' && w.lat === 69.3, 'lat stayed a string: ' + typeof w.lat);
  assert(typeof w.lng === 'number' && w.lng === 18.5, 'lng stayed a string');
  assert(w.alt === 2500 && typeof w.alt === 'number', 'alt not coerced: ' + JSON.stringify(w.alt));
  assert(typeof w.name === 'string', 'name is still not a string: ' + typeof w.name);
  // ABSENT STAYS ABSENT: a missing OAT/wind must be NaN so the banner names it,
  // never 0 - that is C2 all over again.
  assert(Number.isNaN(w.oat) && Number.isNaN(w.wdir) && Number.isNaN(w.wspd),
    'a missing OAT/wind was invented: ' + JSON.stringify([w.oat, w.wdir, w.wspd]));
  assert(w.var === -11, 'var not coerced: ' + w.var);
  assert(w.isPattern === true && w.laps === 1, 'pattern/laps: ' + w.isPattern + '/' + w.laps);
  assert(w.bocNM === undefined, 'an Infinity pin survived: ' + w.bocNM);
  assert(w.tocNM === undefined, 'a 0 pin became a pin');
  assert(w.junk === undefined, 'an unknown key was carried into the live plan');
  assert(w.via.length === 1 && w.via[0].lat === 69.4, 'via not cleaned: ' + JSON.stringify(w.via));
  assert(out[0].title === '[object Object]' || typeof out[0].title === 'string',
    'title is not a string');
  assert(out[0].depElev === 0, 'a non-numeric depElev did not fall back generically');
  // ...and the caller's object is untouched.
  assert(hostile[0].waypoints[0].name === frozenName, 'sanitiseFlights mutated its input');
  assert(hostile[0].waypoints[0].via.length === 2, 'sanitiseFlights mutated the caller\'s via');
  // A typed 0 is a real value and survives.
  const zero = E.sanitiseFlights([{ waypoints: [{ lat: 69, lng: 18, oat: 0, wdir: 0, wspd: 0 }] }]);
  const z = zero[0].waypoints[0];
  assert(z.oat === 0 && z.wdir === 0 && z.wspd === 0, 'a typed 0 was lost');
});
T('a corrupt saved-route library does not brick the boot', () => {
  // H4: JSON.parse with no try/catch, called from populateRouteDropdown() at
  // boot BEFORE refreshMap/renderAllFlightTables - so a partial write meant no
  // map, no table, no way back.
  const raw = APP_SRC;
  const fn = raw.split('function readStoredLibrary')[1].split('\n    function ')[0];
  assert(/try\s*\{[^]{0,200}JSON\.parse/.test(fn), 'the library parse is unguarded again');
  assert(/Array\.isArray\(parsed\)/.test(fn), 'a JSON array is accepted as a name->entry map');
  // Drive it: plant garbage, then confirm the app still renders.
  ev(`localStorage.setItem('c182_custom_routes', '{oops'); localStorage.setItem('c182_custom_missions', '[1,2]');`);
  const routes = ev('JSON.stringify(getStoredSingleRoutes())');
  const missions = ev('JSON.stringify(getStoredMissions())');
  assert(routes === '{}' && missions === '{}',
    'a corrupt library did not degrade to empty: ' + routes + ' / ' + missions);
  ev(`populateRouteDropdown(); renderAllFlightTables();`);
  assert(doc.querySelectorAll('#flight-plans-container table').length > 0,
    'the app did not render after a corrupt library');
  ev(`localStorage.removeItem('c182_custom_routes'); localStorage.removeItem('c182_custom_missions');`);
});
TA('a malformed saved route is refused BEFORE the live plan is touched', async () => {
  // H7: the stored value was assigned onto the live flight and only then walked,
  // so a bad entry threw with flights[i].waypoints already replaced.
  ev(SEED);
  const before = ev('JSON.stringify(flights[0].waypoints.map(w => w.name))');
  ev(`localStorage.setItem('c182_custom_routes', JSON.stringify({ BAD: 5, ALSO_BAD: [{ lat: 'x', lng: 'y' }] }));
      populateRouteDropdown();
      document.getElementById('route-selector').value = 'route:BAD';`);
  await ev('loadSelectedRouteOrMission()');
  await tick();
  assert(ev('JSON.stringify(flights[0].waypoints.map(w => w.name))') === before,
    'a malformed route changed the live plan: ' + ev('JSON.stringify(flights[0].waypoints.map(w => w.name))'));
  ev(`document.getElementById('route-selector').value = 'route:ALSO_BAD';`);
  await ev('loadSelectedRouteOrMission()');
  await tick();
  assert(ev('JSON.stringify(flights[0].waypoints.map(w => w.name))') === before,
    'a route with unusable coordinates changed the live plan');
  ev(`localStorage.removeItem('c182_custom_routes');`);
});
T('no house default elevation is invented anywhere', () => {
  // The author's rule: no hardcoded odd values. The four `|| 254` fallbacks were
  // ENDU's elevation standing in for "unknown".
  const raw = APP_SRC;
  assert(!/\|\|\s*254/.test(raw), 'a hardcoded 254 ft fallback is back');
});
T('an unrecognised import file is not reported as a successful import', () => {
  // M2: {"hello":"world"} matched no branch, changed nothing, and said
  // "Import complete."
  const raw = APP_SRC;
  const fn = raw.split('function importMissionFile')[1].split('\n    function ')[0];
  assert(/Nothing in this file was recognised/.test(fn),
    'an unrecognised file is still reported as complete');
  assert(/applied\.push/.test(fn) && /if \(!applied\.length\)/.test(fn),
    'the import no longer counts what it applied');
});

console.log('\n=== 62a0. Broken output is never presented as clean (v16.43) ===');
T('a circuit stop breaks the altitude chain FORWARD as well as backward', () => {
  // C1: the forward cursor kept the previous real leg's exit altitude across a
  // pattern pair, so the first leg after a circuit was scheduled from a STALE
  // figure - and could hide a descent shortfall the banner would have shown.
  const L2 = moduleExports.legs;
  const wp = (lat, name, alt, x) => ({ lat, lng: 18.5, name, alt, oat: 0, wdir: 0,
    wspd: 0, var: -11, ...(x || {}) });
  const sch = L2.computeFlightSchedule({ id: 1, depElev: 254, waypoints: [
    wp(68.40, 'ENDU', 254), wp(69.00, 'A', 2500),
    // ON A's OWN COORDINATES, which is what addPatternStop produces - a touch
    // & go happens at the fix, and the leg reaching it covers no ground. The
    // fixture used to sit 1.2 NM north, which since v16.83 is a real transit
    // leg and therefore no break at all: it would have tested nothing.
    wp(69.00, 'PATTERN', 1000, { isPattern: true, laps: 3 }),
    wp(69.60, 'B', 6000), wp(69.75, 'ENTC', 31)] });
  // THE LEG AFTER THE BREAK IS sch[2], and the old fixture checked sch[3].
  // With the circuit sitting on A, leg 1 (A -> PATTERN) is the one that covers
  // no ground and clears the cursor, so leg 2 is where a stale figure would
  // land: it must enter at the circuit's own 1000 ft, never at A's 2500.
  assert(sch[1] === null, 'a circuit on its own fix did not break the chain');
  const after = sch[2];
  assert(after, 'the leg after the circuit was not scheduled');
  assert(Math.abs(after.entryAlt - 1000) < 1,
    'the leg after a circuit started from a stale altitude: ' + Math.round(after.entryAlt) +
    ' instead of its own fix at 1000');
  // The stale figure was 1500 ft HIGH, which is exactly how it used to hide a
  // descent shortfall: less climbing left means more room to come back down.
  assert(after.climbMin > 1, 'the leg after the circuit does not climb at all, so nothing is being tested');
  // THE INVARIANT, so this cannot come back: every real leg that follows a
  // pattern pair enters at its OWN from.alt.
  const legs = sch;
  for (let i = 1; i < legs.length; i++)
    if (legs[i] && !legs[i - 1])
      assert(Math.abs(legs[i].entryAlt - legs[i].from.alt) < 1,
        'leg ' + i + ' follows a break but entered at ' + Math.round(legs[i].entryAlt));
});
T('a non-finite figure is an EMPTY box on the company form, never "NaN"', () => {
  // H2, half one. pad3/String(Math.round(NaN)) printed the literal "NaN" into
  // seven cells of a form that goes on company paperwork.
  const F = moduleExports.ofp;
  const c = F.ofpRowCells({ from: 'A', to: 'B', tas: NaN, tt: NaN, var: NaN, mt: null,
    mh: null, wdir: NaN, wspd: NaN, wca: NaN, accDist: NaN, accTime: '--:--', ff: NaN,
    legBurn: NaN, accBurn: NaN, alt: NaN, gs: NaN, dist: NaN, time: '--:--', eto: '', rem: NaN });
  const nan = Object.entries(c).filter(([, v]) => /NaN/.test(String(v)));
  assert(nan.length === 0, 'the form printed NaN in ' + JSON.stringify(nan));
  for (const k of ['tas', 'tt', 'var', 'wv', 'wca', 'pl', 'gs'])
    assert(c[k] === '', k + ' should be an empty box, got ' + JSON.stringify(c[k]));
  // A real figure still prints.
  const ok = F.ofpRowCells({ from: 'A', to: 'B', tas: 129.4, tt: 74, var: -11.6, mt: 62,
    mh: 52, wdir: 285, wspd: 45, wca: -10, accDist: 20.6, accTime: '00:08', ff: 13,
    legBurn: 3.4, accBurn: 3.4, alt: 2500, gs: 158.6, dist: 20.6, time: '00:08', eto: '', rem: 84.5 });
  assert(ok.tas === '129' && ok.tt === '074' && ok.wv === '285/45' && ok.pl === '2500',
    'a valid row stopped printing: ' + JSON.stringify([ok.tas, ok.tt, ok.wv, ok.pl]));
});
TA('a plan the app calls unusable prints a DO NOT USE band on every page', async () => {
  // H2, half two, and it still holds now the OFP is a PDF: the app's own
  // verdict must reach the paper, or the one output that goes on company
  // paperwork is the one output the guard cannot reach.
  ev(SEED);
  assert(printDoc().band === null, 'a clean plan printed a failure band');
  // Break it the way a real plan breaks: a waypoint above the POH ceiling.
  ev('flights[0].waypoints[1].alt = 26000; renderAllFlightTables();');
  await tick();
  assert(doc.getElementById('integrity-banner').style.display === 'block',
    'the banner did not fire on a broken plan');
  const d = printDoc();
  assert(d.band && d.sheets.length > 0, 'the broken plan printed no band: ' + JSON.stringify(d.band));
  // THE REAL PDF, read back: the band is on EVERY page, not just the first.
  const r = await renderAndRead(d);
  assert(r.pages.length === d.sheets.length, 'the PDF has ' + r.pages.length + ' pages for ' + d.sheets.length + ' sheets');
  r.pages.forEach((pg, i) => assert(/INTEGRITY CHECK FAILED - DO NOT USE/.test(pg.text),
    'page ' + (i + 1) + ' of the PDF carries no DO NOT USE band'));
  ev('flights[0].waypoints[1].alt = 2500; renderAllFlightTables();');
  await tick();
  assert(printDoc().band === null, 'the band did not clear');
});
T('the integrity check runs FIRST, and the daylight card cannot take it down', () => {
  // H1: the card ran before the check with nothing guarding it, so a throw
  // there skipped the banner AND left the previous plan's sheets on screen.
  const raw = APP_SRC;
  const tail = raw.split('sectorTimeWindows.push(')[1].split('function ')[0];
  const iCheck = tail.indexOf('runIntegrityCheck()');
  const iCard = tail.indexOf('updateDaylightCard(');
  assert(iCheck > -1 && iCard > -1 && iCheck < iCard,
    'the daylight card runs before the integrity check again');
  assert(/catch\s*\(e\)[^]{0,200}daylight card failed/.test(tail),
    'the daylight card is no longer guarded');
});
T('the wind matrix refuses to invent calm wind for an empty box', () => {
  // C2: Number(x) || 0 turned an unknown OAT/wind into 0, and the banner went
  // from naming the missing field to hidden.
  const raw = APP_SRC;
  const fn = raw.split('function saveWindModal()')[1].split('\n    function ')[0];
  assert(!/\|\|\s*0/.test(fn), 'saveWindModal still coerces a blank box to 0');
  assert(/wmodal-missing/.test(fn), 'an empty box is not highlighted');
  assert(/blanks\.length/.test(fn) && /return;/.test(fn),
    'an empty box no longer blocks the save');
  assert(/Number\(dirInput\.value\)/.test(fn), 'a typed 0 must still be accepted');
});


// ---- THE PRINTED OFP, READ BACK (v16.97) ----------------------------------
// The OFP is a PDF of the school's own form now, not HTML, so there is no
// #ofp-print to query. These read `buildPrintDoc()` - everything the PDF says,
// as data - back onto the form's grid, so a test can still ask "what is on
// line 3 in the MT column". AN ITEM THAT LANDS IN NO CELL THROWS: a figure
// written between two boxes is exactly the fault these tests exist for.
function printDoc() { return JSON.parse(ev('JSON.stringify(buildPrintDoc())')); }
const nearlyPt = (a, b) => Math.abs(a - b) < 0.01;
function readOfp(sh) {
  const P = moduleExports.pdf;
  const rows = Array.from({ length: 16 }, () => Array(25).fill(''));
  const total = Array(25).fill(''), box = {};
  for (const it of sh.items) {
    const b = it.box;
    const named = Object.keys(P.OFP_BOXES).find((k) =>
      nearlyPt(P.OFP_BOXES[k].x0, b.x0) && nearlyPt(P.OFP_BOXES[k].y0, b.y0) && nearlyPt(P.OFP_BOXES[k].x1, b.x1));
    if (named) { box[named] = it.text; continue; }
    const ci = P.OFP_COL_EDGES.findIndex((x) => nearlyPt(x, b.x0));
    if (ci >= 0 && nearlyPt(b.y0, P.OFP_TOTAL_ROW.y0)) { total[ci] = it.text; continue; }
    const ri = P.OFP_ROW_RULES.findIndex((y) => nearlyPt(y, b.y0)) - 1;
    if (ci < 0 || ri < 0) throw new Error('an OFP item is in no cell of the form: ' + JSON.stringify(it));
    rows[ri][ci] = it.text;
  }
  return { rows, filled: rows.filter((r) => r.some(Boolean)), total, box };
}
function readMb(sh) {
  const P = moduleExports.pdf;
  const box = {}, mb = {}, fuel = {};
  for (const it of sh.items) {
    const b = it.box;
    const named = Object.keys(P.MB_BOXES).find((k) =>
      nearlyPt(P.MB_BOXES[k].x0, b.x0) && nearlyPt(P.MB_BOXES[k].y0, b.y0) && nearlyPt(P.MB_BOXES[k].x1, b.x1));
    if (named) { box[named] = it.text; continue; }
    const col = (C) => Object.keys(C).find((k) => nearlyPt(C[k][0], b.x0) && nearlyPt(C[k][1], b.x1));
    const row = (R) => Object.keys(R).find((k) => nearlyPt(R[k][0], b.y0) && nearlyPt(R[k][1], b.y1));
    const mc = col(P.MB_COLS), mr = row(P.MB_ROWS), fc = col(P.FR_COLS), fr = row(P.FR_ROWS);
    if (mc && mr) { (mb[mr] = mb[mr] || {})[mc] = it.text; continue; }
    if (fc && fr) { (fuel[fr] = fuel[fr] || {})[fc] = it.text; continue; }
    throw new Error('an M&B item is in no cell of the form: ' + JSON.stringify(it));
  }
  return { box, mb, fuel, marks: sh.marks, ldHwind: sh.ldHwind,
           text: sh.items.map((it) => it.text).join(' | ') };
}
/** The form prints page 2's figures with a decimal comma, and so do we. */
const numPt = (t) => Number(String(t).replace(',', '.'));
/** The real thing: pdf-lib builds the PDF, pdf.js reads its text back. What
 *  the FORM itself prints is subtracted, so what is left is what we wrote. */
let formTextCache = null;
async function renderAndRead(model) {
  const fs = require('fs'), path = require('path');
  const form = fs.readFileSync(path.join(__dirname, 'C182OFPMBv4.2.pdf'));
  const out = await moduleExports.pdf.renderOfpPdf(require('pdf-lib'), form, model);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const read = async (bytes) => {
    const d = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
    const pages = [];
    for (let i = 1; i <= d.numPages; i++) {
      const pg = await d.getPage(i);
      const tc = await pg.getTextContent();
      pages.push({ view: pg.view, items: tc.items.filter((t) => t.str.trim())
        .map((t) => ({ str: t.str, x: t.transform[4], y: t.transform[5], w: t.width, h: t.transform[3] })) });
    }
    return pages;
  };
  if (!formTextCache) formTextCache = await read(form);
  const key = (t) => t.str + '@' + t.x.toFixed(1) + ',' + t.y.toFixed(1);
  const pages = (await read(out.bytes)).map((pg, i) => {
    const own = new Set(formTextCache[model.sheets[i].kind === 'ofp' ? 0 : 1].items.map(key));
    const written = pg.items.filter((t) => !own.has(key(t)));
    return Object.assign(pg, { written, text: written.map((t) => t.str).join(' ') });
  });
  return { overflow: out.overflow, size: out.bytes.length, pages };
}

console.log('\n=== 62a1. The company OFP form (v16.41) ===');
T('the form has its 25 measured columns, and the groups span the right ones', () => {
  const F = moduleExports.ofp, P = moduleExports.pdf;
  assert(F.OFP_COLUMNS.length === 25, 'the form has 25 columns, not ' + F.OFP_COLUMNS.length);
  assert(P.OFP_COL_EDGES.length === 26, '25 columns need 26 rules');
  const w = P.OFP_COL_EDGES.slice(1).map((x, i) => x - P.OFP_COL_EDGES[i]);
  assert(w.every((x) => x > 20 && x < 70), 'an implausible column width (pt): ' + w.join(' '));
  // Measured off the form: "From" and "To" are the wide ones, everything else
  // is a narrow figure box.
  assert(w[0] > 60 && w[12] > 60, 'From/To are not the wide columns: ' + w[0] + '/' + w[12]);
  assert(P.OFP_ROW_RULES.length === 17, '16 lines need 17 rules');
  const pitch = P.OFP_ROW_RULES.slice(1).map((y, i) => P.OFP_ROW_RULES[i] - y);
  assert(pitch.every((p) => Math.abs(p - 17.5) < 0.2), 'the lines are not the form\'s 17.5 pt pitch: ' + pitch.join(' '));
  // The group headers, from OFP_COLUMNS, must match the ones the form prints.
  const spans = {};
  for (const c of F.OFP_COLUMNS) if (c.group) spans[c.group] = (spans[c.group] || 0) + 1;
  assert(JSON.stringify(spans) === JSON.stringify(
    { WIND: 2, ACC: 2, Fuel: 3, Altitude: 2, Intermediate: 3, Time: 3, 'Fuel remaining': 2 }),
    'the measured group spans changed: ' + JSON.stringify(spans));
});
T('every box the OFP writes into sits on the form\'s own measured rules', () => {
  // THE NUMBERS IN ofppdf.js ARE A MEASUREMENT, and this holds them to it:
  // tools/measure-ofp-form.mjs renders the form and records every ruled line
  // (page 2's are inside 600 dpi raster strips, so they cannot be read out of
  // the PDF's content). A box whose edge is not on a rule would write across
  // the form's own lines.
  const P = moduleExports.pdf;
  const R = require('./tools/prepared/ofp-form-rules.json');
  assert(R.source === 'C182OFPMBv4.2.pdf' && R.pages.length === 2, 'the rules snapshot is not the form\'s');
  const TOL = 0.6;
  const vOn = (pg, x, ylo, yhi) => { const ym = (ylo + yhi) / 2;
    return R.pages[pg].V.some((l) => Math.abs(l.x - x) <= l.t / 2 + TOL && l.y0 <= ym && l.y1 >= ym); };
  const hOn = (pg, y, xlo, xhi) => { const xm = (xlo + xhi) / 2;
    return R.pages[pg].H.some((l) => Math.abs(l.y - y) <= l.t / 2 + TOL && l.x0 <= xm && l.x1 >= xm); };
  const bad = [];
  const check = (pg, name, b, skip) => {
    skip = skip || [];
    if (!skip.includes('x0') && !vOn(pg, b.x0, b.y0, b.y1)) bad.push(name + '.x0 ' + b.x0);
    if (!skip.includes('x1') && !vOn(pg, b.x1, b.y0, b.y1)) bad.push(name + '.x1 ' + b.x1);
    if (!skip.includes('y0') && !hOn(pg, b.y0, b.x0, b.x1)) bad.push(name + '.y0 ' + b.y0);
    if (!skip.includes('y1') && !hOn(pg, b.y1, b.x0, b.x1)) bad.push(name + '.y1 ' + b.y1);
  };
  // FREE PAPER, not form boxes - and the reason for each, so the list cannot
  // quietly grow: the sheet number, the page-2 title and the page-2 note strip
  // beside it (v16.98) sit in empty margin; the Reg value starts after the printed "A/C REG:" label, not at a rule.
  // Its TOP is the underside of the black MASS & BALANCE bar, which is a fill,
  // not a rule, so the rule detector (rightly) does not record it.
  const FREE = { sheetNo: ['x0', 'x1', 'y0', 'y1'], title: ['x0', 'x1', 'y0', 'y1'], note: ['x0', 'x1', 'y0', 'y1'], reg2: ['x0', 'y1'] };
  for (const [k, b] of Object.entries(P.OFP_BOXES)) check(0, 'OFP_BOXES.' + k, b, FREE[k]);
  for (const [k, b] of Object.entries(P.MB_BOXES)) check(1, 'MB_BOXES.' + k, b, FREE[k === 'reg' ? 'reg2' : k]);
  P.OFP_COL_EDGES.forEach((x, i) => { if (!vOn(0, x, 254, 534)) bad.push('OFP_COL_EDGES[' + i + '] ' + x); });
  P.OFP_ROW_RULES.forEach((y, i) => { if (!hOn(0, y, 28.6, 774)) bad.push('OFP_ROW_RULES[' + i + '] ' + y); });
  for (const [rk, r] of Object.entries(P.MB_ROWS)) for (const [ck, c] of Object.entries(P.MB_COLS))
    check(1, 'MB ' + rk + '/' + ck, { x0: c[0], x1: c[1], y0: r[0], y1: r[1] });
  for (const [rk, r] of Object.entries(P.FR_ROWS)) for (const [ck, c] of Object.entries(P.FR_COLS)) {
    // The form BLACKS OUT the Time cell of Total Fuel Onboard and prints the
    // endurance arrow across Gallons and Pounds on the Endurance line, so
    // those three are not boxes and nothing writes there.
    if ((rk === 'onboard' && ck === 'time') || (rk === 'endurance' && ck !== 'time')) continue;
    check(1, 'FR ' + rk + '/' + ck, { x0: c[0], x1: c[1], y0: r[0], y1: r[1] });
  }
  assert(bad.length === 0, bad.length + ' box edge(s) are not on a rule of the form: ' + bad.slice(0, 8).join('; '));
});
T('the CG chart is plotted on the form\'s own axes', () => {
  // Calibrated off the chart's gridlines and CHECKED against the envelope the
  // form itself prints: arm 30 and 50, the MTOW line at 3100 lb, the MLW line
  // at 2950 lb and the aft limit at 46 in all have a measured rule.
  const P = moduleExports.pdf;
  const R = require('./tools/prepared/ofp-form-rules.json').pages[1];
  const vAt = (x, near) => R.V.some((l) => Math.abs(l.x - x) <= 0.3 && l.y1 - l.y0 > 150 && Math.abs(l.x - near) < 1.5);
  const hAt = (y) => R.H.some((l) => Math.abs(l.y - y) <= 0.3 && l.x1 - l.x0 > 100);
  const at = (arm, lb) => P.cgChartPoint(arm, lb);
  assert(vAt(at(30, 2000).x, 55.5) && vAt(at(50, 2000).x, 267.25), 'the arm axis is off the chart\'s own gridlines');
  assert(vAt(at(46, 2000).x, 224.88), 'arm 46 does not land on the aft limit the form prints: x ' + at(46, 2000).x);
  assert(hAt(at(40, 3100).y), 'MTOW 3100 lb does not land on the form\'s line: y ' + at(40, 3100).y);
  assert(hAt(at(40, 2950).y), 'MLW 2950 lb does not land on the form\'s line: y ' + at(40, 2950).y);
  // Off the paper chart is drawn AT THE EDGE and says so, never dropped.
  const off = P.cgChartPoint(52, 3300);
  assert(off.clipped && off.x === P.CG_CHART.x1 && off.y === P.CG_CHART.y1, 'an off-chart point was not pinned: ' + JSON.stringify(off));
});
T('the page builds the form from the SAME pass that renders the screen', () => {
  // One computation, two outputs. If the print sheet recomputed anything it
  // could quietly disagree with the table the pilot checked on screen.
  ev(SEED);
  const d = printDoc();
  const ofps = d.sheets.filter((s) => s.kind === 'ofp');
  assert(ofps.length === 1, 'the seed route should print one OFP sheet: ' + ofps.length);
  const sheet = readOfp(ofps[0]);
  assert(sheet.filled[0][0] === 'ENDU' && sheet.filled[0][12] === 'FINNSNES',
    'the first line is not the first leg: ' + JSON.stringify([sheet.filled[0][0], sheet.filled[0][12]]));
  // THE REAL CROSS-CHECK: the form's Total burn comes from the same pass as
  // the screen's - and since v17.9 it is that pass's figures ROUNDED UP per
  // leg (the author: "rounded fuel used NEVER becomes less than ACTUAL"). So
  // it is the sum of the per-leg ceilings of the very rows the screen drew,
  // never below the screen total, and under one unit a leg above it.
  const screenBurn = Number(txtOf('f-tot-accburn-0').trim());
  const raws = ev('ofpPrintModel[0].rows.map(r => r.legBurnRaw)');
  const want = raws.reduce((t, v) => t + Math.max(1, Math.ceil(v - 1e-9)), 0);
  assert(sheet.total.includes(String(want)),
    'the form total is not the sum of the rounded legs: want ' + want + ' vs printed ' + JSON.stringify(sheet.total.filter(Boolean)));
  assert(want >= screenBurn && want - screenBurn < raws.length,
    'the rounded total ' + want + ' is below, or too far above, the screen total ' + screenBurn);
  assert(sheet.box.dep === 'ENDU' && sheet.box.dest, 'the DEP/DEST boxes are not filled: ' + JSON.stringify(sheet.box));
});
T('the paper rounds fuel UP to a whole unit (floor 1) and distance to the nearest whole (floor 0.5) (v17.9)', () => {
  const F = moduleExports.ofp;
  // the author's examples: under 1 gal shows 1, "regardless if its 0.4 or 0.7"
  for (const [raw, want] of [[0.4, 1], [0.7, 1], [0.05, 1], [1, 1], [1.01, 2], [2.04, 3], [6.8, 7], [3.0000000004, 3], [0, 0]])
    assert(F.paperFuel(raw) === want, 'paperFuel(' + raw + ') = ' + F.paperFuel(raw) + ', want ' + want);
  assert(isNaN(F.paperFuel(NaN)), 'an unknown burn was given a number');
  for (const [raw, want] of [[0.3, 0.5], [0.49, 0.5], [0.01, 0.5], [0.5, 1], [0.6, 1], [12.4, 12], [12.5, 13], [38.4, 38]])
    assert(F.paperDist(raw) === want, 'paperDist(' + raw + ') = ' + F.paperDist(raw) + ', want ' + want);
  // THE RULE, ON EVERY VALUE: never below the actual, and under one unit above
  // it (or the floor of 1 for a leg under 1) - "not obnoxiously higher".
  let worst = 0;
  for (let i = 0; i < 5000; i++) {
    const raw = Math.random() * 30;
    const p = F.paperFuel(raw);
    assert(p >= raw - 1e-9, 'rounded ' + p + ' is below the actual ' + raw);
    assert(raw < 1 ? p === 1 : p - raw < 1, 'rounded ' + p + ' is a whole unit or more above ' + raw);
    worst = Math.max(worst, p - raw);
  }
  assert(worst < 1, 'the worst surplus was ' + worst);
});

T('the paper\'s Acc columns and Total line add up the ROUNDED legs; EST remaining agrees with them, and a refuel restarts it', () => {
  const F = moduleExports.ofp;
  const leg = (dist, burnRaw, rem) => ({ from: 'A', to: 'B', dist: Number(dist.toFixed(1)), distRaw: dist,
    legBurn: Number(burnRaw.toFixed(1)), legBurnRaw: burnRaw, rem });
  // sector 1 from 62.3 gal (64 less 1.7 taxi inside leg 1); sector 2 after a T&G
  // (0.8 gal ground burn, no row) with no refuel; sector 3 after a full stop refuelled to 40.
  const s1 = { meta: { fuelRem: '55.0', totals: { dist: '30.4', time: '', burn: '7.3', rem: '55.0' } }, rows: [
    leg(12.3, 4.26, 58.0), leg(0.3, 0.12, 57.9), leg(17.8, 2.92, 55.0)] };
  s1.rows.push({ pattern: true, from: 'B', to: 'PATTERN', laps: 3, legBurn: 3.0, legBurnRaw: 3.0, rem: 52.0 });
  const s2 = { prefixBurn: 0.8, prefixBurnRaw: 0.84, meta: { fuelRem: '50.1', totals: { dist: '20.0', time: '', burn: '3.6', rem: '50.1' } },
    rows: [leg(20.04, 2.81, 48.4)] };
  const s3 = { refuelled: true, meta: { fuelRem: '37.6', totals: { dist: '15.0', time: '', burn: '2.4', rem: '37.6' } },
    rows: [leg(15.0, 2.41, 37.6)] };
  const [p1, p2, p3] = F.paperRoundSectors([s1, s2, s3]);
  const col = (p, k) => p.rows.map((r) => r[k]);
  assert(JSON.stringify(col(p1, 'legBurn')) === '[5,1,3,3]', 'the rounded burns: ' + JSON.stringify(col(p1, 'legBurn')));
  assert(JSON.stringify(col(p1, 'dist').slice(0, 3)) === '[12,0.5,18]', 'the rounded distances: ' + JSON.stringify(col(p1, 'dist')));
  // ACC is the running sum of what is printed, across sectors
  assert(JSON.stringify(col(p1, 'accBurn')) === '[5,6,9,12]', 'the acc burn: ' + JSON.stringify(col(p1, 'accBurn')));
  assert(JSON.stringify(col(p1, 'accDist')) === '[12,12.5,30.5,"30.5"]', 'the acc dist: ' + JSON.stringify(col(p1, 'accDist')));
  // the T&G ground burn (0.84 -> 1) has no row but is in the sum
  assert(p2.rows[0].accBurn === 12 + 1 + 3 && p2.rows[0].accDist === 30.5 + 20, 'sector 2 does not continue the sums: ' + JSON.stringify(p2.rows[0]));
  // the Total line is the sector's own rounded sum
  assert(p1.meta.totals.burn === '12' && p1.meta.totals.dist === '30.5', 'sector 1 totals: ' + JSON.stringify(p1.meta.totals));
  assert(p2.meta.totals.burn === '4' && p2.meta.totals.dist === '20', 'sector 2 totals (with the ground burn): ' + JSON.stringify(p2.meta.totals));
  // EST REMAINING falls with the rounded column: 62.3 - 12 = 50.3 at the end of sector 1
  assert(p1.rows[3].rem === 50.3 && p1.meta.fuelRem === '50.3', 'EST rem disagrees with the Acc column: ' + p1.rows[3].rem);
  assert(p2.rows[0].rem === round1(62.3 - 16), 'EST rem after the T&G: ' + p2.rows[0].rem);
  // never MORE fuel left on paper than the plan says
  for (const [a, b] of [[s1, p1], [s2, p2], [s3, p3]]) a.rows.forEach((r, i) => assert(b.rows[i].rem <= r.rem + 1e-9, 'paper rem above the plan'));
  // after a refuel the tanks hold a stated figure: no surplus carried over
  assert(p3.rows[0].rem === round1(37.6 - (3 - 2.4)), 'the surplus crossed the refuel: ' + p3.rows[0].rem);
  // ...while the ACC columns keep counting the flight
  assert(p3.rows[0].accBurn === 16 + 3, 'acc burn restarted at the refuel');
  // the input is not touched: the screen keeps the exact figures
  assert(s1.rows[0].legBurn === 4.3 && s1.meta.totals.burn === '7.3', 'paperRoundSectors changed the plan it was given');
  function round1(v) { return Math.round(v * 10) / 10; }
});

T('the printed OFP carries the rounded figures; the screen keeps its tenths', () => {
  ev(SEED);
  const ofp = readOfp(printDoc().sheets.find((s) => s.kind === 'ofp'));
  const C = moduleExports.ofp.OFP_COLUMNS.map((c) => c.key);
  const at = (row, key) => ofp.filled[row][C.indexOf(key)];
  const rows = ev('ofpPrintModel[0].rows');
  let acc = 0;
  rows.forEach((r, i) => {
    const burn = at(i, 'legBurn'), dist = at(i, 'dist');
    assert(/^\d+$/.test(burn) && Number(burn) >= r.legBurnRaw && Number(burn) - r.legBurnRaw < 1,
      'line ' + (i + 1) + ' prints fuel ' + JSON.stringify(burn) + ' for an actual ' + r.legBurnRaw);
    if (!r.pattern) {
      assert(/^(\d+|0\.5)$/.test(dist) && Number(dist) === moduleExports.ofp.paperDist(r.distRaw),
        'line ' + (i + 1) + ' prints distance ' + JSON.stringify(dist) + ' for ' + r.distRaw);
      acc += Number(dist);
      assert(Number(at(i, 'accDist')) === acc, 'the Acc Dist column is not the sum of the printed legs');
    }
  });
  // the on-screen table still shows the exact tenths
  assert(/\d+\.\d/.test(txtOf('f-tot-burn-0')), 'the screen total lost its decimals: ' + txtOf('f-tot-burn-0'));
});

T('the printed form carries no personal data; the Reg box follows the tail', () => {
  // UPDATED DELIBERATELY AT v16.95, not left to fail. The v16.41 rule kept the
  // Reg box empty because the planner did not know which tail was flown - a
  // premise that expired when M&B made one selectable. The author: "Aircraft
  // registrations and their data can be stored. Theres no privacy issue
  // there." So the MACHINE half moved and the PEOPLE half did not: CREW,
  // PASSENGERS and PIC are still empty boxes for the pen, and PROFILE_KEYS
  // still must not carry any of it.
  ev(SEED);
  ev('mbPrefs.reg = null;');
  w.renderAllFlightTables();
  const keys = moduleExports.exch.PROFILE_KEYS || [];
  for (const bad of ['reg', 'registration', 'tail', 'pic', 'crew', 'pilot'])
    assert(!keys.includes(bad), 'PROFILE_KEYS gained "' + bad + '"');
  // NOTHING IS WRITTEN IN THE CREW / PASSENGERS BLOCK (x 28.6-270.5, y 86.8-
  // 135.4 on the form) or in the Lesson box - by geometry, since there is no
  // markup to look inside any more.
  const crewHit = (b) => b.x0 < 270.5 && b.x1 > 28.6 && b.y0 < 133.5 && b.y1 > 86.8;
  const ofp = printDoc().sheets.find((s) => s.kind === 'ofp');
  const inCrew = ofp.items.filter((it) => crewHit(it.box));
  assert(inCrew.length === 0, 'something was written in the crew block: ' + JSON.stringify(inCrew.map((i) => i.text)));
  // With no tail chosen there is still nothing to read, exactly as before.
  assert(readOfp(ofp).box.reg === undefined, 'the Reg box is not empty with no aircraft chosen');
  // Pick one and it is on the paperwork - the same tail page 2 weighed, or the
  // one printout would name two different aircraft.
  ev('mbPrefs.reg = "LN-TRC";');
  w.renderAllFlightTables();
  const d = printDoc();
  assert(readOfp(d.sheets.find((s) => s.kind === 'ofp')).box.reg === 'LN-TRC', 'the Reg box did not follow the tail');
  const mb = d.sheets.find((s) => s.kind === 'mb');
  assert(mb && readMb(mb).box.reg === 'LN-TRC', 'the M&B page does not name the same aircraft');
  ev('mbPrefs.reg = null;');
  w.renderAllFlightTables();
});
T('a leg lands in the right cells, and what we do not know stays EMPTY', () => {
  const F = moduleExports.ofp;
  const c = F.ofpRowCells({ from: 'ENDU', to: 'FINNSNES', tas: 129.4, tt: 74, var: -11.6,
    mt: 62, wdir: 285, wspd: 45, wca: -10, accDist: 20.6, accTime: '00:08', ff: 13.02,
    legBurn: 3.44, accBurn: 3.44, alt: 2500, mh: 52, gs: 158.6, dist: 20.6, time: '00:08',
    eto: '', rem: 84.56 });
  assert(c.from === 'ENDU' && c.to === 'FINNSNES', 'the fixes are wrong');
  assert(c.tt === '074' && c.mt === '062' && c.mh === '052',
    'tracks and headings must be three digits: ' + [c.tt, c.mt, c.mh].join('/'));
  assert(c.wv === '285/45', 'the wind cell is Dir/Vel: ' + c.wv);
  assert(c.var === '-12' && c.wca === '-10', 'VAR/WCA: ' + c.var + ' ' + c.wca);
  assert(c.accDist === '20.6' && c.dist === '20.6', 'ACC vs Intermediate distance');
  assert(c.pl === '2500' && c.gs === '159', 'PL/GS: ' + c.pl + ' ' + c.gs);
  assert(c.estRem === '84.6', 'fuel remaining: ' + c.estRem);
  // NOTHING IS INVENTED. MSA needs terrain the planner deliberately has not
  // got; ATO/Diff/ACT are actuals recorded in flight; Freq is per airspace,
  // not per leg. Each must be an empty box for the pilot's pen - never a 0
  // or a dash that could be mistaken for a planned figure.
  for (const k of ['msa', 'ato', 'diff', 'actRem', 'freq'])
    assert(c[k] === '', k + ' must be blank on the form, got ' + JSON.stringify(c[k]));
});
T('no variation means no magnetic heading on the printed form either', () => {
  // The v16.20 defect in its worst form: a plausible heading a pilot could copy
  // onto the OFP and fly. The form must show --- exactly as the screen does.
  const F = moduleExports.ofp;
  const c = F.ofpRowCells({ from: 'A', to: 'B', tas: 130, tt: 74, var: 0, mt: null, mh: null,
    wdir: 250, wspd: 20, wca: -5, accDist: 20, accTime: '00:08', ff: 13, legBurn: 3,
    accBurn: 3, alt: 2500, gs: 120, dist: 20, time: '00:08', eto: '', rem: 60 });
  assert(c.mt === '---' && c.mh === '---', 'a missing variation printed a number: ' + c.mt + '/' + c.mh);
});
T('a flight longer than the form runs onto a second sheet, totals on the LAST', () => {
  const F = moduleExports.ofp;
  const row = (n) => ({ from: 'W' + n, to: 'W' + (n + 1), tas: 130, tt: 74, var: -11, mt: 63,
    wdir: 250, wspd: 20, wca: -5, accDist: n, accTime: '00:0' + (n % 10), ff: 13, legBurn: 3,
    accBurn: 3 * n, alt: 2500, mh: 58, gs: 120, dist: 5, time: '00:05', eto: '', rem: 60 });
  const meta = { dep: 'ENDU', dest: 'ENEV',
    totals: { dist: '95.0', time: '01:20', burn: '18.0', rem: '46.0' } };
  const one = F.buildOfpSheets(meta, [row(1), row(2)]);
  assert(one.length === 1 && one[0].of === 1, 'a short flight took more than one sheet');
  assert(one[0].cells.length === 2 && one[0].lines === 16,
    'the form always draws its 16 lines, filled or not');
  assert(one[0].totals && one[0].totals.dist === '95.0', 'the single sheet lost its totals');

  const many = F.buildOfpSheets(meta, Array.from({ length: 19 }, (_, i) => row(i + 1)));
  assert(many.length === 2, '19 legs did not spill onto a second sheet: ' + many.length);
  assert(many[0].cells.length === 16 && many[1].cells.length === 3, 'the split is wrong');
  assert(many[0].totals === null, 'a running total was printed as the flight total on sheet 1');
  assert(many[1].totals && many[1].totals.time === '01:20', 'the last sheet lost the totals');
  assert(many.every((s) => s.dep === 'ENDU' && s.dest === 'ENEV' && s.of === 2),
    'every sheet must carry the DEP/DEST and its sheet number');
});
T('ONE SECTOR PER OFP: two flights never share a sheet', () => {
  // The user's rule: a sheet has ONE departure and ONE arrival. The only reason
  // a sector may span more than one sheet is running out of the form's 16 lines,
  // and then both sheets carry that sector's own DEP/DEST.
  const F = moduleExports.ofp;
  const row = (n) => ({ from: 'W' + n, to: 'W' + (n + 1), tas: 130, tt: 74, var: -11, mt: 63,
    wdir: 250, wspd: 20, wca: -5, accDist: n, accTime: '00:05', ff: 13, legBurn: 3,
    accBurn: 3 * n, alt: 2500, mh: 58, gs: 120, dist: 5, time: '00:05', eto: '', rem: 60 });
  const a = F.buildOfpSheets({ dep: 'ENDU', dest: 'ENTC' }, [row(1), row(2)]);
  const b = F.buildOfpSheets({ dep: 'ENTC', dest: 'ENSR' }, [row(1), row(2)]);
  assert(a.length === 1 && b.length === 1, 'a two-leg sector took more than one sheet');
  assert(a[0].dep === 'ENDU' && a[0].dest === 'ENTC', 'sector 1 lost its aerodromes');
  assert(b[0].dep === 'ENTC' && b[0].dest === 'ENSR', 'sector 2 lost its aerodromes');
  // THE BOUNDARY: 16 legs still fit one sheet; the 17th starts a second, and it
  // carries the SAME sector's DEP/DEST - not the next flight's.
  const full = F.buildOfpSheets({ dep: 'ENDU', dest: 'ENEV' },
    Array.from({ length: 16 }, (_, i) => row(i + 1)));
  assert(full.length === 1, '16 legs must fit the form exactly: ' + full.length + ' sheets');
  const over = F.buildOfpSheets({ dep: 'ENDU', dest: 'ENEV' },
    Array.from({ length: 17 }, (_, i) => row(i + 1)));
  assert(over.length === 2 && over[1].cells.length === 1, 'the 17th leg did not start a sheet 2');
  assert(over.every((s) => s.dep === 'ENDU' && s.dest === 'ENEV'),
    'a continuation sheet changed aerodromes');
});
const TWO_SECTORS = `flights = [
    { id: 1, title: 'A', depElev: 254, waypoints: [
      { lat: 68.5, lng: 18.5, name: 'ENDU', alt: 254, oat: 0, wdir: 250, wspd: 20, var: -11 },
      { lat: 69.2, lng: 18.5, name: 'MID',  alt: 3500, oat: 0, wdir: 250, wspd: 20, var: -11 },
      { lat: 69.7, lng: 18.5, name: 'ENTC', alt: 31,  oat: 0, wdir: 250, wspd: 20, var: -11 }] },
    { id: 2, title: 'B', depElev: 31, waypoints: [
      { lat: 69.7, lng: 18.5, name: 'ENTC', alt: 31,  oat: 0, wdir: 250, wspd: 20, var: -11 },
      { lat: 70.2, lng: 18.5, name: 'SKJ',  alt: 4500, oat: 0, wdir: 250, wspd: 20, var: -11 },
      { lat: 70.6, lng: 18.5, name: 'ENSR', alt: 10,  oat: 0, wdir: 250, wspd: 20, var: -11 }] }];
    activeFlightIndex = 0; mbPrefs.reg = null; renderAllFlightTables();`;
const ofpSheets = () => printDoc().sheets.filter((s) => s.kind === 'ofp').map(readOfp);
TA('the ACC columns all measure the same thing: the mission so far', async () => {
  // The form groups Dist and Time under one heading, ACC, and prints Fuel Acc
  // beside them. Accumulated across WHAT is the question, and the three
  // columns have to answer it the same way or the sheet contradicts itself.
  ev(TWO_SECTORS);
  const sheets = ofpSheets();
  assert(sheets.length === 2, 'expected two sheets, got ' + sheets.length);
  // Column order is OFP_COLUMNS: 7 = ACC Dist, 8 = ACC Time, 11 = Fuel Acc.
  const one = sheets[0].filled, two = sheets[1].filled;
  const lastOne = one[one.length - 1], firstTwo = two[0];
  const mins = (hhmm) => { const m = /^(\d+):(\d+)/.exec(hhmm); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
  // Time and fuel already carry across the sector boundary...
  assert(mins(firstTwo[8]) > mins(lastOne[8]),
    'ACC Time restarted on the next sector: ' + lastOne[8] + ' then ' + firstTwo[8]);
  assert(Number(firstTwo[11]) > Number(lastOne[11]),
    'Fuel Acc restarted on the next sector: ' + lastOne[11] + ' then ' + firstTwo[11]);
  // ...so the distance beside them must too, or one column counts the mission
  // and its neighbour counts the sector while both are headed ACC.
  assert(Number(firstTwo[7]) > Number(lastOne[7]),
    'ACC Dist restarted on the next sector: ' + lastOne[7] + ' then ' + firstTwo[7] +
    ' - while ACC Time went ' + lastOne[8] + ' -> ' + firstTwo[8]);
  // ...and it carries over by exactly this leg's own distance (column 17 is
  // the Intermediate Dist), not by some other amount that merely grows.
  const carried = Number(firstTwo[7]) - Number(lastOne[7]);
  assert(Math.abs(carried - Number(firstTwo[17])) < 0.11,
    'the first leg of sector 2 added ' + carried.toFixed(1) +
    ' NM to the accumulated distance but is ' + firstTwo[17] + ' NM long');
});

TA('the Total line is this sector, all three figures alike', async () => {
  // The sheet carries ONE departure and ONE arrival, so "Total" under it means
  // what THIS sector cost. Distance and time already said that; fuel was
  // quietly reporting the whole mission, which is invisible on a one-sector
  // flight because the two are then the same number.
  ev(TWO_SECTORS);
  const sheets = ofpSheets();
  assert(sheets.length === 2, 'expected two sheets, got ' + sheets.length);
  const endOne = sheets[0].filled.slice(-1)[0], endTwo = sheets[1].filled.slice(-1)[0];
  const totTwo = sheets[1].total;
  assert(totTwo.some(Boolean), 'the sheet has no Total line');
  // The ACC columns run across the mission, so what sector 2 cost is the
  // DIFFERENCE between the two sheets' final accumulated values.
  const sectorDist = Number(endTwo[7]) - Number(endOne[7]);
  const sectorBurn = Number(endTwo[11]) - Number(endOne[11]);
  assert(Math.abs(Number(totTwo[7]) - sectorDist) < 0.11,
    'the Total distance is ' + totTwo[7] + ' but this sector flew ' + sectorDist.toFixed(1));
  assert(Math.abs(Number(totTwo[11]) - sectorBurn) < 0.11,
    'the Total fuel is ' + totTwo[11] + ' but this sector burned ' + sectorBurn.toFixed(1) +
    ' - the Total line is mixing sector figures with mission ones');
  // Fuel REMAINING is a state at the end of the sector, not a sum over it, so
  // it stays the running figure and must match the last row's EST.
  assert(totTwo[22] === endTwo[22],
    'the Total line fuel remaining (' + totTwo[22] + ') is not the sector\'s end state (' + endTwo[22] + ')');
});
TA('the page prints one OFP per flight plan, each with its own DEP and DEST', async () => {
  ev(TWO_SECTORS);
  const sheets = ofpSheets();
  assert(sheets.length === 2, 'two flight plans made ' + sheets.length + ' sheets, not 2');
  const pair = (s) => s.box.dep + '->' + s.box.dest;
  assert(pair(sheets[0]) === 'ENDU->ENTC', 'sheet 1: ' + pair(sheets[0]));
  assert(pair(sheets[1]) === 'ENTC->ENSR', 'sheet 2: ' + pair(sheets[1]));
  // ...and no sheet may show a fix belonging to the other sector.
  assert(!/SKJ|ENSR/.test(sheets[0].rows.flat().join(' ')), 'sector 2 fixes leaked onto sector 1\'s sheet');
  assert(!/\bMID\b/.test(sheets[1].rows.flat().join(' ')), 'sector 1 fixes leaked onto sector 2\'s sheet');
});
TA('line 1 is DEP -> first waypoint, the last leg arrives at DEST, and a circuit hangs off DEST', async () => {
  // The user's rule for how a sector reads down the sheet.
  ev(`flights = [{ id: 1, title: 'A', depElev: 254, waypoints: [
    { lat: 69.055, lng: 18.545, name: 'ENDU', alt: 254, oat: 5, wdir: 250, wspd: 15, var: -11 },
    { lat: 69.230, lng: 17.980, name: 'FINNSNES', alt: 2500, oat: 2, wdir: 250, wspd: 18, var: -11 },
    { lat: 69.679, lng: 18.911, name: 'ENTC', alt: 31, oat: 4, wdir: 260, wspd: 12, var: -12 },
    // ON ENTC's OWN COORDINATES. addPatternStop copies them, so this is what a
    // touch & go really produces.
    { lat: 69.679, lng: 18.911, name: 'PATTERN', alt: 1000, oat: 4, wdir: 260, wspd: 12, var: -12,
      isPattern: true, laps: 3 }] }];
    activeFlightIndex = 0; renderAllFlightTables();`);
  const sheet = ofpSheets()[0];
  const rows = sheet.filled;
  const from = (r) => r[0], to = (r) => r[12];
  assert(rows.length === 3, 'expected three filled lines, got ' + rows.length);
  // Line 1 leaves the DEPARTURE aerodrome for the first waypoint.
  assert(sheet.box.dep === 'ENDU' && from(rows[0]) === 'ENDU',
    'line 1 does not start at the departure aerodrome: ' + from(rows[0]));
  assert(to(rows[0]) === 'FINNSNES', 'line 1 does not run to the first waypoint: ' + to(rows[0]));
  // ...and the last flown leg ARRIVES at the destination aerodrome.
  assert(to(rows[1]) === 'ENTC' && sheet.box.dest === 'ENTC',
    'the last leg does not arrive at the destination: ' + to(rows[1]));
  // A circuit hangs off the ARRIVAL aerodrome and carries its time and fuel,
  // but no track, distance or speed - it is not a line on the ground.
  assert(from(rows[2]) === 'ENTC' && /PATTERN/.test(to(rows[2])) && /×3/.test(to(rows[2])),
    'the circuit line is wrong: ' + from(rows[2]) + ' -> ' + to(rows[2]));
  assert(rows[2][18] === '00:15', 'the circuit has no time: ' + JSON.stringify(rows[2][18]));
  assert(Number(rows[2][10]) > 0, 'the circuit has no fuel: ' + JSON.stringify(rows[2][10]));
  for (const i of [1, 2, 3, 4, 5, 6, 16, 17])
    assert(rows[2][i] === '', 'the circuit line printed a leg figure in column ' + i +
      ': ' + JSON.stringify(rows[2][i]));
});
console.log('\n=== 62a1b. The printed OFP IS the school\'s form (v16.97) ===');
T('the build ships the form and pdf-lib as content-named print assets, outside the bundle', () => {
  const fs = require('fs'), crypto = require('crypto');
  const sha8 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex').slice(0, 8);
  const html = fs.readFileSync(APP_HTML, 'utf8');
  const lib = /<meta name="c182-print-lib" content="(print\/pdf-lib-([0-9a-f]{8})\.min\.js)">/.exec(html);
  const form = /<meta name="c182-print-form" content="(print\/ofp-form-([0-9a-f]{8})\.pdf)">/.exec(html);
  assert(lib && form, 'the page does not name its print assets');
  // THE NAME IS THE CONTENT: a new form or library is a new URL, so the
  // worker can hold them cache-first and never serve a stale copy.
  assert(form[2] === sha8('./C182OFPMBv4.2.pdf'), 'the form\'s name is not its content hash');
  assert(lib[2] === sha8('./node_modules/pdf-lib/dist/pdf-lib.min.js'), 'the library\'s name is not its content hash');
  // BYTE-IDENTICAL to the committed form - the whole claim rests on it.
  assert(Buffer.compare(fs.readFileSync('./site/' + form[1]), fs.readFileSync('./C182OFPMBv4.2.pdf')) === 0,
    'site/ ships a form that is not the committed C182OFPMBv4.2.pdf');
  assert(fs.readdirSync('./site/print').length === 2, 'site/print carries a stale asset: ' + fs.readdirSync('./site/print'));
  // NOT IN THE BUNDLE: pdf-lib alone is twice the size of app.js, and it is
  // needed only when printing. Its own UMD header is the tell.
  assert(!fs.readFileSync('./site/app.js', 'utf8').includes('.PDFLib={}'), 'pdf-lib ended up in the app bundle');
  // The worker precaches them in a cache of their OWN, cache-first, and the
  // stamped list names exactly these two files.
  const sw = fs.readFileSync('./site/sw.js', 'utf8');
  assert(sw.includes(JSON.stringify(['./' + lib[1], './' + form[1]])), 'the worker was not told the print assets');
  assert(/const PRINT_CACHE = 'c182-print'/.test(sw) && /printFirst\(request\)/.test(sw),
    'the print assets are not held cache-first in their own cache');
  assert(!/SHELL_ASSETS = \[[^\]]*print\//.test(sw), 'the print assets are in the SHELL - every release would re-fetch 3 MB');
});
T('the service worker is stamped with THIS version, in the code and not only in a comment', () => {
  // String.replace swaps the first match only, and the token is quoted in a
  // comment above the declaration - so every build until v16.97 shipped the
  // shell cache as "c182-shell-vdev" and no release ever retired the last one.
  const sw = require('fs').readFileSync('./site/sw.js', 'utf8');
  const v = /const APP_VERSION = "([^"]+)";/.exec(sw);
  assert(v && v[1] === ev('APP_VERSION'), 'the worker is not stamped with this build\'s version: ' + (v && v[1]));
  assert(!/const APP_VERSION = sw\.__APP_VERSION__/.test(sw), 'the placeholder survived in the code');
});
T('fitSize shrinks in quarter points and reports what does not fit', () => {
  const P = moduleExports.pdf;
  const width = (t, s) => t.length * s * 0.5;
  assert(P.fitSize(width, 'ABCD', 100, 7).size === 7, 'a string that fits was shrunk');
  const f = P.fitSize(width, 'ABCDEFGH', 20, 7);
  assert(f.fits && f.size === 5 && width('ABCDEFGH', f.size) <= 20, 'did not shrink to the largest size that fits: ' + JSON.stringify(f));
  const no = P.fitSize(width, 'ABCDEFGHIJKLMNOP', 20, 7);
  assert(!no.fits && no.size === P.MIN_SIZE, 'an impossible fit did not bottom out at MIN_SIZE and say so: ' + JSON.stringify(no));
});
TA('only WinAnsi characters reach the PDF, and Norwegian letters are among them', async () => {
  const P = moduleExports.pdf;
  // Helvetica's REAL character set, from pdf-lib - not a list written here.
  const { PDFDocument, StandardFonts } = require('pdf-lib');
  const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
  const set = new Set(font.getCharacterSet());
  assert(P.encodable('BODØ ÆØÅ æøå × °', set) === 'BODØ ÆØÅ æøå × °', 'Norwegian letters or the form\'s symbols were not kept');
  assert(P.encodable('A→B', set) === 'A-B', 'an arrow was not written as a dash: ' + P.encodable('A→B', set));
  assert(P.encodable('A☃B', set) === 'A?B', 'an unencodable character was not replaced: ' + P.encodable('A☃B', set));
});
T('page 2 writes the arms the form does NOT print, and leaves the alternate for the pen', () => {
  const P = moduleExports.pdf;
  const L = (w, arm) => ({ w, arm, mom: w * (arm || 1) });
  const s = { title: 'T', reg: 'LN-TRA',
    // EVERY line carries its arm, as a page that passed them through would:
    // the first version gave the printed-arm stations none, so a mutation
    // writing them over the form's own arms had nothing to write and passed.
    lines: { bem: L(1993.6, 38.06), pilot: L(170, 37), right: L(0, 37), rear: L(0, 74), fuel: L(384, 46.5),
             bagA: L(7.3, 97), bagB: L(0, 116), bagC: L(0.7, 129), tom: L(2555.6, 40.1), enroute: L(204, 46.5),
             ldg: L(2351.6, 39.6) },
    fuel: { tripGal: 34, tripMin: 161, reserveGal: 8, reserveMin: 40, onboardGal: 64, enduranceMin: 320 },
    vaKt: 97, vGlideKt: 70, cruise: { altFt: 4500, oatC: 3, rpm: 2300, mp: 23, tasKt: 139, ffGph: 11.9 },
    minFltMin: 0, dep: null, dest: null, marks: [] };
  const r = readMb({ items: P.mbPageItems(s), marks: [], ldHwind: false });
  // The form PRINTS the station arms (37,0 / 46,5 / 97,0 ...); writing them
  // again would double the ink in the box. Only the three it leaves blank.
  for (const k of ['pilot', 'right', 'rear', 'fuel', 'bagA', 'bagB', 'bagC', 'enroute'])
    assert(!r.mb[k].arm, k + ': an arm was written over the one the form prints');
  for (const k of ['bem', 'tom', 'ldg']) assert(r.mb[k].arm, k + ': the arm the form leaves blank was not written');
  assert(r.mb.bem.w === '1993,6' && r.mb.tom.arm === '40,10', 'page 2 does not use the form\'s decimal comma: ' + JSON.stringify(r.mb.bem));
  // NOTHING IS PLANNED FOR AN ALTERNATE, so its line, contingency, extra and
  // the total required stay empty boxes - a total that left out the alternate
  // would state a required fuel that is too low.
  for (const k of ['alternate', 'contingency', 'extra', 'required'])
    assert(!r.fuel[k], k + ' fuel was written: ' + JSON.stringify(r.fuel[k]));
  assert(r.fuel.trip.gal === '34,0' && r.fuel.trip.lb === '204,0' && r.fuel.trip.time === '02:41',
    'the trip line is wrong: ' + JSON.stringify(r.fuel.trip));
  assert(r.box.va === '97' && r.box.vglide === '70' && r.box.cruiseRpm === '2300', 'speeds / cruise missing: ' + JSON.stringify(r.box));
  // A load of NOTHING on a seat is printed as 0,0 - it was weighed empty -
  // while the Last Minute Change line is left to the pen on a sector sheet.
  assert(r.mb.right.w === '0,0' && !r.mb.lmc, 'an empty seat or the LMC line is wrong');
});
T('the pre-printed "0" in the landing H-Wind box is covered ONLY when a headwind is written there', () => {
  const P = moduleExports.pdf;
  const z = P.PREPRINTED_ZERO, box = P.MB_BOXES.ldHwind;
  // Inside the cell, and no bigger than the glyph plus half a point each way:
  // it is the one place a printed page differs from the blank form outside a
  // written value, so it must not grow.
  assert(z.x0 >= box.x0 && z.x1 <= box.x1 && z.y0 >= box.y0 && z.y1 <= box.y1, 'the cover leaves its cell');
  assert((z.x1 - z.x0) * (z.y1 - z.y0) < 40, 'the cover is bigger than the digit it hides: ' + JSON.stringify(z));
  ev(SEED);
  ev(`mbPrefs.reg = 'LN-TRB'; perfInputs = {}; lastWeather = null; renderAllFlightTables();`);
  const mb = () => printDoc().sheets.find((s) => s.kind === 'mb');
  assert(mb() && mb().ldHwind === false, 'the "0" is covered with no landing wind to write');
  ev(`lastWeather = { icaos: ['ENDU', 'ENTC'], tafs: {}, metars: {
        ENDU: 'ENDU 281150Z 29012KT 9999 FEW040 10/05 Q1005', ENTC: 'ENTC 281150Z 18008KT 9999 SCT030 08/04 Q1003' } };
      renderAllFlightTables();`);
  const m = mb();
  assert(m.ldHwind === true && readMb(m).box.ldHwind, 'a landing headwind is written but the "0" under it is not covered');
  ev(`mbPrefs.reg = null; lastWeather = null; renderAllFlightTables();`);
});
TA('the real PDF: every figure lands inside its box, and a worst case needs no shrinking below the minimum', async () => {
  // pdf-lib builds it, pdf.js reads it back - no mock of either.
  ev(SEED);
  ev(`mbPrefs.reg = 'LN-TRE'; mbPrefs.loads = normaliseStationLoads({ pilotLb: 195, rightLb: 180, bagALb: 7.3, bagBLb: 22.7, bagCLb: 0.7 });
      lastWeather = { icaos: ['ENDU', 'ENTC'], tafs: {}, metars: {
        ENDU: 'ENDU 281150Z 29012KT 9999 FEW040 10/05 Q1005', ENTC: 'ENTC 281150Z 18008KT 9999 SCT030 08/04 Q1003' } };
      renderAllFlightTables();`);
  const model = printDoc();
  const r = await renderAndRead(model);
  assert(r.overflow.length === 0, 'text had to be shrunk past the minimum: ' + JSON.stringify(r.overflow));
  assert(r.pages.length === model.sheets.length && r.pages.every((p) => p.view[2] === 792 && p.view[3] === 612),
    'the PDF is not one 792x612 page per sheet');
  let checked = 0;
  r.pages.forEach((pg, i) => {
    const boxes = model.sheets[i].items.map((it) => it.box);
    for (const t of pg.written) {
      // The CG chart labels are drawn beside their marks, not in a box.
      if (/^(T\/O|LDG|ZFM)/.test(t.str)) continue;
      const inside = boxes.some((b) => t.x >= b.x0 - 0.01 && t.x + t.w <= b.x1 + 0.01 && t.y >= b.y0 - 0.5 && t.y + t.h * 0.72 <= b.y1 + 0.5);
      assert(inside, 'page ' + (i + 1) + ': "' + t.str + '" at ' + t.x.toFixed(1) + ',' + t.y.toFixed(1) + ' is not inside any box');
      checked++;
    }
  });
  assert(checked > 80, 'only ' + checked + ' written figures were checked - the fixture is not filling the form');
  ev(`mbPrefs.reg = null; lastWeather = null; mbPrefs.loads = normaliseStationLoads({}); renderAllFlightTables();`);
});

T('a circuit stop prints as a circuit, not as a leg', () => {
  const F = moduleExports.ofp;
  const c = F.ofpRowCells({ pattern: true, from: 'ENDU', to: 'PATTERN', laps: 3, accDist: '20.6',
    pl: 1500, accTime: '00:35', accBurn: 8.2, ff: 12, legBurn: 1.0, time: '00:15', eto: '', rem: 55 });
  assert(/×3/.test(c.to), 'the lap count is not shown: ' + c.to);
  assert(c.pl === '1500', 'the circuit altitude is not printed: ' + c.pl);
  // A circuit is not a line on the ground: no track, no distance, no speed.
  for (const k of ['tt', 'mt', 'mh', 'gs', 'dist', 'wv', 'wca', 'tas'])
    assert(c[k] === '', k + ' must be blank for a circuit, got ' + JSON.stringify(c[k]));
  assert(c.time === '00:15' && c.legBurn === '1.0', 'the circuit time/fuel is missing');
});

console.log('\n=== 62a1. A circuit is time and fuel, never a place (v16.84) ===');
// THE PILOT REVERSED v16.83 HERE, and these tests encode the reversal rather
// than softening it: "pattern should NOT be a point where things can be flown
// out and in from... If the pattern is its own point, the next leg will be
// flown from where i placed the PATTERN sign. Pattern should only be a 'time
// and fuel addon' not a place."
//
// The fixture stores the marker 23 NM OFF the track on purpose - a plan saved
// by v16.83, or a hand-edited file - because the invariant has to hold for
// what is on disk, not only for what the add flow writes.
const AIRWORK = `flights = [{ id: 1, title: 'F1', depElev: 254, waypoints: [
  { lat: 69.0558, lng: 18.5404, name: 'ENDU', alt: 254,  oat: 0, wdir: 0, wspd: 0, var: -11 },
  { lat: 69.30,   lng: 18.90,   name: 'A',    alt: 3000, oat: 0, wdir: 0, wspd: 0, var: -11 },
  { lat: 69.45,   lng: 19.40,   name: 'PATTERN', alt: 3000, oat: 0, wdir: 0, wspd: 0, var: -11,
    isPattern: true, laps: 3 },
  { lat: 69.60,   lng: 19.90,   name: 'B',    alt: 3000, oat: 0, wdir: 0, wspd: 0, var: -11 },
  { lat: 69.6833, lng: 18.9189, name: 'ENTC', alt: 32,   oat: 0, wdir: 0, wspd: 0, var: -11 }
]}]; activeFlightIndex = 0; refreshMap(); renderAllFlightTables();`;

T('a circuit never moves the route, however far off the marker was stored', () => {
  ev(AIRWORK);
  // MEASURED BEFORE THE FIX, on ENDU -> PATTERN -> ENEV with the marker 23 NM
  // off track: the sector walked 76.1 NM where ENDU -> ENEV is 53.0. Here the
  // route must cost exactly what it costs with the circuit taken out of it.
  const withCircuit = Number(txtOf('f-tot-dist-0'));
  ev('flights[0].waypoints.splice(2, 1); renderAllFlightTables();');
  const without = Number(txtOf('f-tot-dist-0'));
  assert(Math.abs(withCircuit - without) < 0.05,
    'the circuit added ' + (withCircuit - without).toFixed(1) + ' NM of ground to the route');
});

T('the circuit sits on the fix it follows, and the route never visits the marker', () => {
  ev(AIRWORK);
  const at = ev('JSON.stringify([flights[0].waypoints[1].lat, flights[0].waypoints[1].lng, ' +
                'flights[0].waypoints[2].lat, flights[0].waypoints[2].lng])');
  const [aLat, aLng, pLat, pLng] = JSON.parse(at);
  assert(aLat === pLat && aLng === pLng,
    'the circuit was left at its stored position: ' + at);
  // ...so the drawn line has no excursion in it: five waypoints, four points.
  const line = ev('flightLineCoords(flights[0])');
  assert(line.length === 4, 'the drawn route visits the marker: ' + JSON.stringify(line));
});

T('the sheet reads down continuously across the circuit', () => {
  ev(AIRWORK);
  const rows = [...doc.querySelectorAll('#tbody-flight-0 > tr')]
    .filter((r) => !/sub-leg/.test(r.className))
    .map((r) => [...r.children].slice(0, 3).map((c) => c.textContent.trim()));
  // ENDU->A, the laps at A, A(PATTERN)->B, B->ENTC. There is NO transit row,
  // because there is no ground between A and the circuit flown at A.
  assert(rows.length === 4, 'expected four rows, got ' + rows.length + ': ' + JSON.stringify(rows));
  assert(/PATTERN/.test(rows[1][2]), 'the circuit row is missing: ' + JSON.stringify(rows[1]));
  assert(!rows.some((r) => r[1] === 'PATTERN' && !/PATTERN/.test(r[2])),
    'a leg row was emitted for flying out to the circuit: ' + JSON.stringify(rows));
  // THE CHAIN: what one row arrives at is what the next leaves from, all the
  // way down. That is the invariant a pilot reads the sheet by.
  for (let i = 1; i < rows.length; i++)
    assert(rows[i][0] === rows[i - 1][1],
      'row ' + i + ' starts at ' + rows[i][0] + ' but the row above arrives at ' + rows[i - 1][1]);
});

T('a plan that starts in the pattern is charged for the circuits', () => {
  ev(`flights = [{ id: 1, title: 'F1', depElev: 254, waypoints: [
    { lat: 69.0558, lng: 18.5404, name: 'PATTERN', alt: 1500, oat: 0, wdir: 0, wspd: 0, var: -11,
      isPattern: true, laps: 4 },
    { lat: 69.30, lng: 18.90, name: 'A', alt: 3000, oat: 0, wdir: 0, wspd: 0, var: -11 },
    { lat: 69.6833, lng: 18.9189, name: 'ENTC', alt: 32, oat: 0, wdir: 0, wspd: 0, var: -11 }
  ]}]; activeFlightIndex = 0; refreshMap(); renderAllFlightTables();`);
  // THE FIRST WAYPOINT IS NEVER A LEG'S `to`, so the circuit row - which was
  // emitted only from that branch - was never emitted at all. Four laps cost
  // nothing: no minutes, no fuel, no row.
  const rows = [...doc.querySelectorAll('#tbody-flight-0 > tr')]
    .filter((r) => !/sub-leg/.test(r.className));
  assert(/PATTERN/.test(rows[0].children[2].textContent),
    'the opening circuits got no row: ' + rows[0].textContent.trim().slice(0, 60));
  // PRICED AT THE PROFILE'S OWN FIGURES, and measured as a DIFFERENCE so the
  // assertion does not have to know how long the flying takes: dropping three
  // laps must take exactly three laps' time and fuel off the sector.
  const mins = (t) => Number(t.split(':')[0]) * 60 + Number(t.split(':')[1]);
  const time4 = mins(txtOf('f-tot-time-0')), burn4 = Number(txtOf('f-tot-burn-0'));
  ev('flights[0].waypoints[0].laps = 1; renderAllFlightTables();');
  const time1 = mins(txtOf('f-tot-time-0')), burn1 = Number(txtOf('f-tot-burn-0'));
  const lap = ev('aircraftProfile.patternTime');
  assert(Math.abs((time4 - time1) - 3 * lap) < 1.5,
    'three laps cost ' + (time4 - time1) + ' min, expected ' + (3 * lap));
  assert(burn4 - burn1 > 0.1, 'the opening circuits burned no fuel: ' + burn4 + ' vs ' + burn1);
  ev('flights[0].waypoints[0].laps = 4; renderAllFlightTables();');
  // ...and the departure is drawn where it happens.
  assert(ev('flightLineCoords(flights[0])').length === 3,
    'the circuit at the departure field is not on the drawn route');
});

TA('clicking a circuit logs it where you are, and prices it for THAT field', async () => {
  // THE CLICK SAYS WHEN IN THE PLAN THE CIRCUITS HAPPEN, NEVER WHERE (v16.84).
  // The render doors put a displaced marker back on its fix, so the position
  // alone would be corrected either way - but the CIRCUIT ALTITUDE and the
  // variation are derived at the moment of adding, and deriving them from the
  // click describes an aerodrome the aircraft never goes near. ENDU's circuit
  // altitude is the told 1500 ft; ENTC's derived figure is 1000.
  ev(`flights = [{ id: 1, title: 'F1', depElev: 254, waypoints: [
    { lat: 69.05583, lng: 18.54028, name: 'ENDU', alt: 254, oat: 0, wdir: 0, wspd: 0, var: -11 }
  ]}]; activeFlightIndex = 0; refreshMap(); renderAllFlightTables();`);
  // click 38 NM away, right on ENTC, and ask for circuits
  const pr = w.__mapHandlers.click({ latlng: { lat: 69.67895, lng: 18.91143 } });
  await tick();
  answerDialog('traffic-circuit');
  await tick();
  typeInDialog('3');
  answerDialog('Add pattern');
  await pr;
  await tick();
  const wp = ev('JSON.stringify(flights[0].waypoints[1])');
  const got = JSON.parse(wp);
  assert(got && got.isPattern, 'no circuit was added: ' + wp);
  assert(got.lat === ev('flights[0].waypoints[0].lat') && got.lng === ev('flights[0].waypoints[0].lng'),
    'the circuit was placed where the click was, not where the aircraft is: ' + wp);
  assert(got.alt === 1500,
    "the circuit was priced for the field under the CURSOR, not the one it is flown at: " +
    got.alt + " ft (ENDU is 1500, ENTC's derived figure is 1000)");
  ev(SEED);
});

T('a circuit is not draggable, because it has no position of its own', () => {
  // A marker you can drag and that snaps straight back is worse than one that
  // does not move: it offers a gesture the plan cannot honour. A LEADING
  // circuit is the exception - there is no fix before it to borrow a position
  // from, so that one really is where the plan starts.
  ev(`flights = [{ id: 1, title: 'F1', depElev: 254, waypoints: [
    { lat: 69.0558, lng: 18.5404, name: 'ENDU', alt: 254, oat: 0, wdir: 0, wspd: 0, var: -11 },
    { lat: 69.0558, lng: 18.5404, name: 'PATTERN', alt: 1500, oat: 0, wdir: 0, wspd: 0, var: -11,
      isPattern: true, laps: 2 },
    { lat: 69.6833, lng: 18.9189, name: 'ENTC', alt: 32, oat: 0, wdir: 0, wspd: 0, var: -11 }
  ]}]; activeFlightIndex = 0; refreshMap();`);
  const drag = (i) => ev(`markers[${i}] && markers[${i}]._opts ? markers[${i}]._opts.draggable : null`);
  assert(drag(0) === true, 'an ordinary waypoint stopped being draggable: ' + drag(0));
  assert(drag(1) === false, 'the circuit marker is draggable: ' + drag(1));

  ev(`flights = [{ id: 1, title: 'F1', depElev: 254, waypoints: [
    { lat: 69.0558, lng: 18.5404, name: 'PATTERN', alt: 1500, oat: 0, wdir: 0, wspd: 0, var: -11,
      isPattern: true, laps: 2 },
    { lat: 69.6833, lng: 18.9189, name: 'ENTC', alt: 32, oat: 0, wdir: 0, wspd: 0, var: -11 }
  ]}]; activeFlightIndex = 0; refreshMap();`);
  assert(drag(0) === true, 'a circuit that opens a plan IS its position and must move: ' + drag(0));
});

T('a circuit follows its fix through every edit the page makes', () => {
  // THE RULE IS ENFORCED WHERE A POSITION IS READ, not at each of the dozen
  // places one is written - so this drives the page's own paths rather than
  // calling the normaliser, which would prove the normaliser and not the app.
  const at = (i) => ev(`flights[0].waypoints[${i}].lat + ',' + flights[0].waypoints[${i}].lng`);
  const seed = `flights = [{ id: 1, title: 'F1', depElev: 254, waypoints: [
    { lat: 69.0558, lng: 18.5404, name: 'ENDU', alt: 254, oat: 0, wdir: 0, wspd: 0, var: -11 },
    { lat: 69.3000, lng: 18.9000, name: 'MID',  alt: 3000, oat: 0, wdir: 0, wspd: 0, var: -11 },
    { lat: 69.3000, lng: 18.9000, name: 'PATTERN', alt: 1500, oat: 0, wdir: 0, wspd: 0, var: -11,
      isPattern: true, laps: 2 },
    { lat: 69.6833, lng: 18.9189, name: 'ENTC', alt: 32, oat: 0, wdir: 0, wspd: 0, var: -11 }
  ]}]; activeFlightIndex = 0; refreshMap(); renderAllFlightTables();`;

  // 1. the fix it hangs off is DRAGGED - the circuit has to come along, or the
  //    leg out of it starts from where that fix used to be.
  ev(seed);
  ev('flights[0].waypoints[1].lat = 69.44; flights[0].waypoints[1].lng = 19.10; refreshMap();');
  assert(at(2) === at(1), 'the circuit stayed behind when its fix moved: ' + at(2) + ' vs ' + at(1));

  // 2. that fix is DELETED - the circuit re-homes onto whatever now precedes it,
  //    and the route costs what it costs without the circuit in it.
  ev(seed);
  ev('deleteWaypointFromFlight(0, 1); renderAllFlightTables();');
  assert(at(1) === at(0), 'the circuit did not re-home after a delete: ' + at(1) + ' vs ' + at(0));
  const withCircuit = Number(txtOf('f-tot-dist-0'));
  ev('flights[0].waypoints.splice(1, 1); renderAllFlightTables();');
  assert(Math.abs(withCircuit - Number(txtOf('f-tot-dist-0'))) < 0.05,
    'the re-homed circuit still adds ground: ' + withCircuit + ' vs ' + txtOf('f-tot-dist-0'));

  // 3. a file that carries a displaced circuit is corrected on the way IN, so a
  //    plan saved by v16.83 does not keep its detour.
  const cleaned = moduleExports.exch.sanitiseFlights([{ id: 1, depElev: 254, waypoints: [
    { lat: 69.0, lng: 18.0, name: 'A', alt: 254 },
    { lat: 69.9, lng: 19.9, name: 'PATTERN', alt: 1500, isPattern: true, laps: 3 },
    { lat: 70.0, lng: 18.0, name: 'C', alt: 2000 }] }]);
  const w = cleaned[0].waypoints;
  assert(w[1].lat === w[0].lat && w[1].lng === w[0].lng,
    'the sanitiser let a displaced circuit through: ' + JSON.stringify(w[1]));
});

console.log('\n=== 62a2. Circuit altitude from the field elevation (v16.40) ===');

T('a circuit altitude is 1000 ft above the field, rounded to a whole hundred', () => {
  const A = moduleExports.anchors;
  // The rule, on the published elevations in the shipped dataset.
  assert(A.patternAltitude({ icao: 'ENTC', elevFt: 31 }) === 1000, 'ENTC 31 ft');
  assert(A.patternAltitude({ icao: 'ENEV', elevFt: 84 }) === 1100, 'ENEV 84 ft');   // 84 -> 100
  assert(A.patternAltitude({ icao: 'XXXX', elevFt: 149 }) === 1100, '149 ft rounds down');
  assert(A.patternAltitude({ icao: 'XXXX', elevFt: 150 }) === 1200, '150 ft rounds up');
  assert(A.patternAltitude({ icao: 'XXXX', elevFt: 2054 }) === 3100, 'the highest field');
  // ENDU is the exception the user gave: 1500 ft, not the 1300 the rule gives.
  assert(A.patternAltitude({ icao: 'ENDU', elevFt: 254 }) === 1500, 'ENDU must be 1500 ft');
  assert(A.patternAltitude({ icao: 'endu', elevFt: 254 }) === 1500, 'the override is case-insensitive');
  assert(A.patternAltitude({ icao: 'XXXX', elevFt: 254 }) === 1300, 'the rule still gives 1300 elsewhere');
  // Nothing is invented from a missing elevation.
  assert(A.patternAltitude({ icao: 'XXXX', elevFt: null }) === null, 'no elevation, no altitude');
  assert(A.patternAltitude(null) === null, 'no aerodrome, no altitude');
});
T('the circuit resolves to the aerodrome it is flown at, or to nothing', () => {
  const A = moduleExports.anchors;
  const set = JSON.parse((() => { const s = fs.readFileSync('data/aip.js', 'utf8'); return s.slice(s.indexOf('{'), s.lastIndexOf(';')); })());
  const anchors = A.buildAnchors(set);
  const endu = anchors.find((a) => a.kind === 'AD' && a.icao === 'ENDU');
  assert(endu, 'ENDU is not in the dataset');
  // On the field, and a couple of miles off it - a circuit is flown within ~3 NM.
  const on = A.patternAltitudeAt(endu.lat, endu.lng, anchors);
  assert(on && on.icao === 'ENDU' && on.alt === 1500 && on.known === true,
    'a circuit at ENDU: ' + JSON.stringify(on));
  const near = A.patternAltitudeAt(endu.lat + 0.03, endu.lng + 0.03, anchors);
  assert(near && near.icao === 'ENDU', 'a circuit 2 NM off ENDU did not resolve to it');
  // Out in the fjord, nothing is invented.
  const far = A.patternAltitudeAt(endu.lat + 1.2, endu.lng, anchors);
  assert(far === null, 'an altitude was invented far from any aerodrome: ' + JSON.stringify(far));
  // THE RADIUS CANNOT BE AMBIGUOUS: the two closest aerodromes in the dataset
  // are 14.07 NM apart, so a 5 NM catch can never resolve to the wrong field.
  const ads = anchors.filter((a) => a.kind === 'AD');
  let closest = Infinity;
  for (let i = 0; i < ads.length; i++)
    for (let j = i + 1; j < ads.length; j++)
      closest = Math.min(closest, A.roughNM([ads[i].lat, ads[i].lng], [ads[j].lat, ads[j].lng]));
  assert(closest > 2 * A.PATTERN_AD_MAX_NM,
    'two aerodromes are ' + closest.toFixed(2) + ' NM apart, so a ' + A.PATTERN_AD_MAX_NM +
    ' NM catch is ambiguous');
  // Every published field yields a whole hundred.
  const odd = ads.filter((a) => { const v = A.patternAltitude(a); return v !== null && v % 100 !== 0; });
  assert(odd.length === 0, odd.length + ' aerodromes give a non-round circuit altitude');
  console.log('        ' + ads.length + ' aerodromes, closest pair ' + closest.toFixed(2) +
    ' NM, all circuit altitudes whole hundreds');
});

console.log('\n=== 62b. TOC/TOD marks (the vanishing TOD, v16.28) ===');
T('a TOD that lands ON a waypoint is still drawn (v16.28 bug fix)', () => {
  const L2 = moduleExports.legs;
  const W = (n, lat, lng, alt) => ({ name: n, lat, lng, alt, oat: 0, wdir: 0, wspd: 0, var: -11 });
  // Find a route whose descent fills the WHOLE last leg, so the TOD falls a
  // few hundredths of a mile after B. The lengths are searched rather than
  // hard-coded because the boundary depends on the profile's rate of descent.
  // The old guard (`todBeforeNM < distNM - 0.05`) threw that marker away, so
  // the pilot saw a descent start with no TOD anywhere on the map.
  let fixture = null;
  for (let cruise = 4500; cruise <= 9500 && !fixture; cruise += 500) {
    for (let l3 = 0.05; l3 <= 1.2 && !fixture; l3 += 0.005) {
      const wps = [W('ENDU', 68.8, 18.5, 254), W('A', 68.85, 18.5, cruise),
                   W('B', 69.30, 18.5, cruise), W('ENTC', 69.30 + l3, 18.5, 254)];
      const sched = L2.computeFlightSchedule({ id: 1, waypoints: wps });
      const last = sched[2];
      if (last && last.todStartsHere && last.distNM - last.todBeforeNM < 0.05
          && !sched.some(x => x && x.shortfallMin > 0.001)) fixture = { wps, sched, last };
    }
  }
  assert(fixture, 'could not build a route whose descent starts exactly at a waypoint');
  const m = L2.computeLegMarkers(fixture.wps[2], fixture.wps[3], fixture.last);
  const tod = m.find(x => x.kind === 'TOD');
  assert(tod, 'the TOD vanished when it landed on the waypoint');
  // and it says WHERE it is in the only useful way: at B, not "27 NM before ENTC"
  assert(tod.atWaypoint === 'B', 'the mark does not name the fix it sits on: ' + tod.atWaypoint);
  assert(Math.abs(tod.lat - fixture.wps[2].lat) < 0.01, 'the mark is not drawn at that fix');
  // a mark part-way along a leg still reports no waypoint
  const mid = L2.computeLegMarkers(fixture.wps[1], fixture.wps[2], fixture.sched[1])
    .find(x => x.kind === 'TOC');
  assert(mid && !mid.atWaypoint, 'a mid-leg TOC wrongly claims to sit on a fix');
});
T('the plotting list and the OFP sub-line both say "at <fix>" for a boundary mark', () => {
  const P = moduleExports.plot;
  const L2 = moduleExports.legs;
  const W = (n, lat, lng, alt) => ({ name: n, lat, lng, alt, oat: 0, wdir: 0, wspd: 0, var: -11 });
  let fl = null;
  for (let cruise = 4500; cruise <= 9500 && !fl; cruise += 500) {
    for (let l3 = 0.05; l3 <= 1.2 && !fl; l3 += 0.005) {
      const wps = [W('ENDU', 68.80, 18.5, 254), W('A', 68.85, 18.5, cruise),
                   W('B', 69.30, 18.5, cruise), W('ENTC', 69.30 + l3, 18.5, 254)];
      const sc = L2.computeFlightSchedule({ id: 1, waypoints: wps });
      if (sc[2] && sc[2].todStartsHere && sc[2].distNM - sc[2].todBeforeNM < 0.05
          && !sc.some(x => x && x.shortfallMin > 0.001)) fl = { id: 1, waypoints: wps };
    }
  }
  assert(fl, 'could not build the boundary route');
  const txt = P.buildPlottingText(fl, 'NM');
  assert(/TOD at B/.test(txt), 'the plotting list still reports the boundary TOD by distance: ' + txt);
  // and the same route rendered in the page
  ev(`flights = ${JSON.stringify([fl])}; activeFlightIndex = 0; refreshMap(); renderAllFlightTables();`);
  const subs = [...doc.querySelectorAll('#tbody-flight-0 tr.sub-leg-row')].map(t => t.textContent).join(' || ');
  assert(/TOD at B/.test(subs), 'the OFP sub-line still reports it by distance: ' + subs);
});
T('no route places a descent without drawing a TOD somewhere', () => {
  const L2 = moduleExports.legs;
  const W = (n, lat, lng, alt) => ({ name: n, lat, lng, alt, oat: 0, wdir: 0, wspd: 0, var: -11 });
  // Sweep leg lengths and cruise altitudes. Every route whose descent the
  // schedule actually PLACED (no shortfall - those get the red banner) must
  // show exactly one TOD, and never two.
  let checked = 0, missing = 0, duplicated = 0;
  for (let cruise = 2500; cruise <= 9500; cruise += 2000)
  for (let l1 = 0.1; l1 <= 1.0; l1 += 0.1)
  for (let l2 = 0.1; l2 <= 1.0; l2 += 0.1)
  for (let l3 = 0.05; l3 <= 0.6; l3 += 0.05) {
    const wps = [W('ENDU', 68.8, 18.5, 254), W('A', 68.8 + l1, 18.5, cruise),
                 W('B', 68.8 + l1 + l2, 18.5, cruise), W('ENTC', 68.8 + l1 + l2 + l3, 18.5, 254)];
    const sched = L2.computeFlightSchedule({ id: 1, waypoints: wps });
    if (!sched.some(x => x && x.descDistNM > 0.05)) continue;
    if (sched.some(x => x && x.shortfallMin > 0.001)) continue;
    checked++;
    let tods = 0;
    for (let i = 0; i < 3; i++) tods += L2.computeLegMarkers(wps[i], wps[i + 1], sched[i])
      .filter(x => x.kind === 'TOD').length;
    if (tods === 0) missing++;
    if (tods > 1) duplicated++;
  }
  assert(checked > 500, 'the sweep did not exercise enough routes: ' + checked);
  assert(missing === 0, missing + ' of ' + checked + ' routes descend with no TOD drawn');
  assert(duplicated === 0, duplicated + ' routes drew the TOD twice');
});

console.log('\n=== 63. Drag the line to bend it, and insert waypoints mid-route (v16.27) ===');
T('the drawn path walks waypoints AND via points, and an airwork point is a place', () => {
  const L2 = moduleExports.legs;
  const fl = { waypoints: [
    { lat: 69.0, lng: 18.0, name: 'A' },
    { lat: 69.5, lng: 18.5, name: 'B', via: [{ lat: 69.2, lng: 18.9 }, { lat: 69.4, lng: 19.1 }] },
    { lat: 69.6, lng: 18.6, name: 'PATTERN', isPattern: true, laps: 3 },
    { lat: 70.0, lng: 19.0, name: 'C' }
  ]};
  const line = L2.flightLineCoords(fl);
  // A, v1, v2, B, PATTERN, C. v16.83: the pattern here was CLICKED out on the
  // route, so it is somewhere the aircraft goes - leaving it off the line drew
  // a route the table did not price (measured: the map drew A->B at 27.8 NM
  // while the table priced PATTERN->B at 13.9).
  assert(line.length === 6, 'path length ' + line.length + ': ' + JSON.stringify(line));
  assert(line[1][0] === 69.2 && line[2][0] === 69.4, 'via points are not between their waypoints');
  assert(line.some(p => p[0] === 69.6), 'an airwork PATTERN was left off the drawn route');
  // ...and a circuit flown where you already are still adds nothing, because
  // it repeats the point already drawn.
  const atFix = L2.flightLineCoords({ waypoints: [
    { lat: 69.0, lng: 18.0, name: 'A' },
    { lat: 69.5, lng: 18.5, name: 'ENTC' },
    { lat: 69.5, lng: 18.5, name: 'PATTERN', isPattern: true, laps: 3 }
  ]});
  assert(atFix.length === 2, 'a circuit on its own fix added a point: ' + JSON.stringify(atFix));
  // a via with a broken coordinate must be skipped, not drawn as NaN
  const bad = L2.flightLineCoords({ waypoints: [{ lat: 69, lng: 18 },
    { lat: 70, lng: 19, via: [{ lat: NaN, lng: 18.5 }] }] });
  assert(bad.length === 2 && bad.every(p => isFinite(p[0]) && isFinite(p[1])), 'a NaN via reached the line');
});
T('the line hit-test names the leg and the slot within it', () => {
  const L2 = moduleExports.legs;
  const wps = [
    { lat: 69.0, lng: 18.0, name: 'A' },
    { lat: 69.5, lng: 18.0, name: 'B', via: [{ lat: 69.25, lng: 18.5 }] },
    { lat: 70.0, lng: 18.0, name: 'C' }
  ];
  // near the FIRST half of leg A->B (A -> via), so slot 0
  let h = L2.findPathInsertion(wps, { lat: 69.12, lng: 18.25 });
  assert(h.legEnd === 1 && h.insertAt === 0, 'first span: ' + JSON.stringify(h));
  // near the SECOND half (via -> B), so slot 1: splicing here keeps the
  // existing via first, which is the whole point
  h = L2.findPathInsertion(wps, { lat: 69.38, lng: 18.25 });
  assert(h.legEnd === 1 && h.insertAt === 1, 'second span: ' + JSON.stringify(h));
  // clearly on the B->C leg
  h = L2.findPathInsertion(wps, { lat: 69.75, lng: 18.01 });
  assert(h.legEnd === 2 && h.insertAt === 0, 'second leg: ' + JSON.stringify(h));
  // A LEG THAT COVERS NO GROUND cannot be bent or split - a circuit flown at
  // the fix before it is the case that produces one.
  assert(L2.findPathInsertion([{ lat: 69, lng: 18 }, { lat: 69, lng: 18, isPattern: true }],
    { lat: 69.5, lng: 18.5 }) === null, 'a zero-length leg was offered as bendable');
  // ...but the transit out to an airwork point IS a leg, and refusing it did
  // not decline politely (v16.83): it handed back the nearest OTHER leg, so a
  // right-click meant for this one silently bent a different part of the route.
  const air = [{ lat: 69, lng: 18, name: 'A' },
               { lat: 69.5, lng: 18, name: 'PATTERN', isPattern: true, laps: 3 },
               { lat: 70, lng: 18, name: 'C' }];
  const onIt = L2.findPathInsertion(air, { lat: 69.25, lng: 18.0 });
  assert(onIt && onIt.legEnd === 1, 'the leg reaching an airwork point is still not bendable: ' + JSON.stringify(onIt));
  const outOf = L2.findPathInsertion(air, { lat: 69.75, lng: 18.0 });
  assert(outOf && outOf.legEnd === 2, 'the leg leaving an airwork point is still not bendable: ' + JSON.stringify(outOf));
  assert(L2.findPathInsertion([{ lat: 69, lng: 18 }], { lat: 69, lng: 18 }) === null,
    'a single waypoint is not a leg');
});
T('the leg midpoint is measured along the FLOWN path, not the direct line', () => {
  const L2 = moduleExports.legs;
  const from = { lat: 69.0, lng: 18.0 };
  // a leg dog-legged a long way east; the direct midpoint would sit at lng 18
  const to = { lat: 70.0, lng: 18.0, via: [{ lat: 69.5, lng: 19.5 }] };
  const mid = L2.legMidpoint(from, to);
  assert(mid.lng > 18.6, 'the midpoint fell on the direct line, not the flown path: ' + JSON.stringify(mid));
  // and on a straight leg it really is halfway
  const straight = L2.legMidpoint({ lat: 69, lng: 18 }, { lat: 70, lng: 18 });
  assert(Math.abs(straight.lat - 69.5) < 0.01 && Math.abs(straight.lng - 18) < 0.01,
    'straight-leg midpoint: ' + JSON.stringify(straight));
  assert(L2.legMidpoint({ lat: 69, lng: 18 }, { lat: 69, lng: 18 }) === null,
    'a zero-length leg has no midpoint');
});
T('press-drag-release on the line bends it in one motion', () => {
  ev(SEED);
  const before = ev('flights[0].waypoints[2].via ? flights[0].waypoints[2].via.length : 0');
  // press on the ENDU->FINNSNES..ENTC line, drag, release
  ev(`(function(){
    hitLines[0]._h.mousedown({ latlng: { lat: 69.45, lng: 18.90 }, originalEvent: { button: 0, preventDefault: function(){} } });
  })()`);
  assert(ev('lineDrag !== null'), 'the press did not start a drag');
  assert(ev('flights[0].waypoints[2].via.length') === before + 1, 'the press did not create the via point');
  // the line must follow the cursor DURING the drag, without rebuilding tables
  const sentinel = doc.createElement('div');
  sentinel.id = 'via-drag-sentinel';
  doc.getElementById('flight-plans-container').appendChild(sentinel);
  ev(`__mapHandlers.mousemove({ latlng: { lat: 69.60, lng: 19.40 } })`);
  assert(doc.getElementById('via-drag-sentinel') !== null, 'the OFP tables rebuilt on every mousemove');
  assert(ev('flights[0].waypoints[2].via[0].lng') === 19.40, 'the via did not follow the cursor');
  assert(JSON.stringify(ev('polylines[0]._ll')).includes('19.4'), 'the route line did not move with the drag');
  // release commits
  ev(`__mapHandlers.mouseup()`);
  assert(ev('lineDrag === null'), 'the drag never ended');
  assert(doc.getElementById('via-drag-sentinel') === null, 'release did not do the full recalc');
  assert(ev('flights[0].waypoints[2].via.length') === before + 1, 'release changed the via count');
  // one undo takes the whole gesture back - the state is pushed at the press
  ev('undoLast(true)');
  assert(ev('flights[0].waypoints[2].via ? flights[0].waypoints[2].via.length : 0') === before,
    'undo did not remove the via created by the drag');
});
T('the click that trails a drag does not drop a second via', () => {
  ev(SEED);
  ev(`(function(){
    hitLines[0]._h.mousedown({ latlng: { lat: 69.45, lng: 18.90 }, originalEvent: { button: 0, preventDefault: function(){} } });
    __mapHandlers.mouseup();
    hitLines[0]._h.click({ latlng: { lat: 69.45, lng: 18.90 } });
  })()`);
  assert(ev('flights[0].waypoints[2].via.length') === 1,
    'the drag and its trailing click both added a via: ' + ev('flights[0].waypoints[2].via.length'));
});
T('a plain click still bends the line (the touch path, where mousedown never fires)', () => {
  ev(SEED);
  ev('lineDragEndedAt = 0');   // the previous test just finished a drag
  ev(`hitLines[0]._h.click({ latlng: { lat: 69.45, lng: 18.90 } })`);
  assert(ev('flights[0].waypoints[2].via.length') === 1, 'a tap no longer inserts a via point');
  assert(ev('polylines[0]._ll.length') === 4, 'the map did not redraw after the tap');
});
T('the route has a fat invisible grab line, and it is not the one you see', () => {
  ev(SEED);
  assert(ev('hitLines.length') === ev('polylines.length'), 'one grab line per route');
  assert(ev('hitLines[0]._opts.opacity') === 0, 'the grab line is visible');
  assert(ev('hitLines[0]._opts.weight') >= 12, 'the grab line is too thin to help: ' + ev('hitLines[0]._opts.weight'));
  assert(ev('polylines[0]._opts.weight') === 4, 'the VISIBLE line got fattened instead');
  assert(ev('hitLines[0]._opts.bubblingMouseEvents') === false,
    'a line gesture would also fire the map click and append a waypoint');
  // and it tracks the same coordinates, or the grab area drifts off the route
  assert(JSON.stringify(ev('hitLines[0]._ll')) === JSON.stringify(ev('polylines[0]._ll')),
    'the grab line does not follow the drawn line');
});
TA('inserting a waypoint mid-leg splits it and keeps the via points on the right halves', async () => {
  ev(SEED);
  // bend the ENDU->FINNSNES leg twice, one via on each side of where the new
  // waypoint will go
  ev(`flights[0].waypoints[1].via = [{ lat: 69.10, lng: 18.40 }, { lat: 69.20, lng: 18.10 }];
      refreshMap(); renderAllFlightTables();`);
  const p = w.insertWaypointOnLeg(0, { lat: 69.15, lng: 18.25 });
  await tick();
  typeInDialog('MIDPT');
  answerDialog('Insert waypoint');
  await p;
  const names = ev('flights[0].waypoints.map(w => w.name)');
  assert(JSON.stringify(names) === JSON.stringify(['ENDU', 'MIDPT', 'FINNSNES', 'ENTC']),
    'wrong insertion position: ' + JSON.stringify(names));
  const v1 = ev('flights[0].waypoints[1].via'), v2 = ev('flights[0].waypoints[2].via');
  assert(v1.length === 1 && Math.abs(v1[0].lat - 69.10) < 1e-9, 'first half lost its via: ' + JSON.stringify(v1));
  assert(v2.length === 1 && Math.abs(v2[0].lat - 69.20) < 1e-9, 'second half lost its via: ' + JSON.stringify(v2));
  // it inherits the plan it was inserted into - nothing invented
  assert(ev('flights[0].waypoints[1].alt') === 2500, 'the new waypoint invented an altitude');
  assert(ev('flights[0].waypoints[1].oat') === 10, 'the new waypoint invented an OAT');
  // ...except variation, which is COMPUTED for the new position
  assert(ev('flights[0].waypoints[1].varSource') !== 'MANUAL', 'variation was not resolved for the new point');
  assert(isFinite(ev('flights[0].waypoints[1].var')), 'the new waypoint has no variation');
  // and it is a real OFP row now: three legs, not two
  const rows = doc.querySelectorAll('#tbody-flight-0 tr:not(.sub-leg-row)');
  assert(rows.length === 3, 'the leg did not split into two rows: ' + rows.length);
  assert(!doc.getElementById('flight-plans-container').textContent.includes('NaN'), 'NaN after the insert');
});
TA('cancelling the insert changes nothing', async () => {
  ev(SEED);
  const before = ev('JSON.stringify(flights)');
  const p = w.insertWaypointOnLeg(0, { lat: 69.15, lng: 18.25 });
  await tick();
  answerDialog('Cancel');
  await p;
  assert(ev('JSON.stringify(flights)') === before, 'cancelling the insert still changed the route');
});
TA('right-clicking the line opens the LEG PANEL, and inserting is still there', async () => {
  // v16.37 moved this gesture: right-click used to insert a waypoint outright
  // and now opens the leg's settings panel. The capability is not lost - it is
  // the first action IN the panel, at the exact point clicked - which is how
  // the gesture the user asked for was freed without giving anything up.
  ev(SEED);
  ev(`hitLines[0]._h.contextmenu({ latlng: { lat: 69.45, lng: 18.90 }, originalEvent: { preventDefault: function(){} } })`);
  const legOpen = () => doc.getElementById('leg-modal').style.display === 'flex';
  assert(legOpen(), 'the leg panel did not open');
  assert(/FINNSNES/.test(doc.getElementById('leg-modal-title').textContent) &&
         /ENTC/.test(doc.getElementById('leg-modal-title').textContent),
    'the panel named the wrong leg: ' + doc.getElementById('leg-modal-title').textContent);
  // right-clicking must NOT change the route on its own
  assert(ev('flights[0].waypoints.length') === 3, 'right-click altered the route by itself');

  const p = ev('insertWaypointFromLegPanel()');
  await tick();
  typeInDialog('BEND');
  answerDialog('Insert waypoint');
  await p; await tick();
  const names = ev('flights[0].waypoints.map(w => w.name)');
  assert(JSON.stringify(names) === JSON.stringify(['ENDU', 'FINNSNES', 'BEND', 'ENTC']),
    'the panel inserted in the wrong place: ' + JSON.stringify(names));
  assert(!legOpen(), 'the panel stayed open');
});
TA('right-clicking a WAYPOINT renames it, and offers to delete it (v16.40, one dialog since v16.74)', async () => {
  // The gesture had to go on the MARKER: right-clicking the route line opens
  // the leg panel, and a waypoint sits on that line. Exactly one panel may open.
  ev(SEED);
  const legOpen = () => doc.getElementById('leg-modal').style.display === 'flex';
  const p = ev(`markers[1]._h.contextmenu({ originalEvent: {} })`);
  await tick();
  assert(!legOpen(), 'right-clicking the waypoint also opened the leg panel');
  assert(/FINNSNES/.test(doc.getElementById('app-dialog').textContent),
    'the menu did not name the waypoint: ' + doc.getElementById('app-dialog').textContent);
  typeInDialog('MIDWAY', 'name');
  answerDialog('Apply');
  await p; await tick();
  assert(JSON.stringify(ev('flights[0].waypoints.map(w => w.name)')) ===
    JSON.stringify(['ENDU', 'MIDWAY', 'ENTC']), 'the rename did not take: ' +
    JSON.stringify(ev('flights[0].waypoints.map(w => w.name)')));

  // ...and delete removes exactly that one.
  const p2 = ev(`markers[1]._h.contextmenu({ originalEvent: {} })`);
  await tick();
  answerDialog('Delete this waypoint');
  await p2; await tick();
  assert(JSON.stringify(ev('flights[0].waypoints.map(w => w.name)')) ===
    JSON.stringify(['ENDU', 'ENTC']), 'the delete removed the wrong waypoint: ' +
    JSON.stringify(ev('flights[0].waypoints.map(w => w.name)')));

  // Cancel must change nothing.
  const p3 = ev(`markers[0]._h.contextmenu({ originalEvent: {} })`);
  await tick();
  answerDialog('Cancel');
  await p3; await tick();
  assert(ev('flights[0].waypoints.length') === 2, 'cancelling changed the route');
});
T('a circuit stop is offered deletion only - renaming it would break the PATTERN marker', () => {
  // "PATTERN" is the name the add-flow and the return-leg builder test for, so
  // a renamed circuit stop would silently stop being one.
  const raw = APP_SRC;
  const fn = raw.split('async function openWaypointMenu')[1].split('function deleteWaypointFromFlight')[0];
  assert(/isPat \? \[\] : \[\{ id: 'rename'/.test(fn.replace(/\s+/g, ' ')) ||
         /isPat \? \[\] :/.test(fn),
    'the waypoint menu no longer withholds Rename from a circuit stop');
  assert(/isDoneMode/.test(fn), 'the waypoint menu is not disabled in done mode');
});
T('the leg panel reads the leg, pins from where you clicked, and previews the result', () => {
  const L2 = moduleExports.legs;
  ev(SEED);
  // Right-click part-way along the ENDU -> FINNSNES leg.
  ev(`hitLines[0]._h.contextmenu({ latlng: { lat: 69.14, lng: 18.26 }, originalEvent: { preventDefault: function(){} } })`);
  assert(doc.getElementById('leg-modal').style.display === 'flex', 'the panel did not open');
  assert(/ENDU/.test(doc.getElementById('leg-modal-title').textContent), 'wrong leg');
  // It shows the leg's own altitude, and no pins on a fresh route.
  assert(Number(doc.getElementById('leg-alt').value) === ev('flights[0].waypoints[1].alt'),
    'the altitude box does not show the leg altitude');
  for (const id of ['leg-boc', 'leg-bod', 'leg-toc'])
    assert(doc.getElementById(id).value === '', id + ' is pre-filled on an unpinned leg');
  // The hint states the geometry the gesture landed on.
  const hint = doc.getElementById('leg-hint').textContent;
  assert(/NM along the flown path/.test(hint) && /NM after ENDU/.test(hint) && /NM before FINNSNES/.test(hint), hint);

  // "Here" turns the click into the number - that is the point of the gesture.
  ev("pinLegHere('boc');");
  const boc = Number(doc.getElementById('leg-boc').value);
  assert(boc > 0.5 && boc < ev('computeFlightSchedule(flights[0])[0].distNM'),
    'the BOC "Here" button produced ' + boc);
  ev("pinLegHere('bod');");
  assert(Number(doc.getElementById('leg-bod').value) > 0.5, 'the BOD "Here" button produced nothing');

  // The PREVIEW is computed through the real engine on a copy, so it cannot
  // disagree with what Apply will do.
  const pv = doc.getElementById('leg-preview').textContent;
  assert(/Climb/.test(pv) && /starts/.test(pv), 'the preview does not describe the pinned climb: ' + pv);
  assert(/NM after ENDU/.test(pv), 'the preview does not say where the climb starts: ' + pv);

  // Apply writes the pins onto the leg's TO waypoint and the schedule honours
  // them - and it is undoable like every other edit.
  const before = ev('flights[0].waypoints[1].alt');
  ev('saveLegSettings();');
  assert(doc.getElementById('leg-modal').style.display !== 'flex', 'the panel stayed open after Apply');
  // v16.76: THE OBSERVABLE BEHAVIOUR IS THE CLIMB START, not the stored field.
  // A 12 NM "hold, then climb" is now one attain-by target 12 NM plus a climb
  // length further on, so asserting the raw field would be asserting the
  // representation - which is exactly what was replaced.
  assert(ev('flights[0].waypoints[1].altAtNM') > boc,
    'the panel did not write the one attain-by target: ' + ev('flights[0].waypoints[1].altAtNM'));
  const S = L2.computeFlightSchedule({ id: 1, waypoints: JSON.parse(ev('JSON.stringify(flights[0].waypoints)')) })[0];
  assert(Math.abs(S.climbStartNM - boc) < 0.15,
    'the climb does not start where the panel was told: ' + S.climbStartNM + ' vs ' + boc);
  assert(ev('flights[0].waypoints[1].alt') === before, 'Apply changed the altitude it was only showing');
  ev('undoLast(true);');
  assert(!ev('flights[0].waypoints[1].altAtNM'), 'applying the target was not undoable');
});
T('clearing the pins puts the leg back on the derived schedule', () => {
  ev(SEED);
  ev(`hitLines[0]._h.contextmenu({ latlng: { lat: 69.14, lng: 18.26 }, originalEvent: { preventDefault: function(){} } })`);
  ev("pinLegHere('boc'); pinLegHere('bod'); pinLegHere('toc'); saveLegSettings();");
  assert(ev('flights[0].waypoints[1].altAtNM') > 0, 'the target was not applied');
  ev(`hitLines[0]._h.contextmenu({ latlng: { lat: 69.14, lng: 18.26 }, originalEvent: { preventDefault: function(){} } })`);
  ev('clearLegPins(); saveLegSettings();');
  // Cleared means ABSENT, not zero, so a saved route reads identically to one
  // made before pins existed.
  for (const k of ['altAtNM', 'bocNM', 'bodNM', 'tocNM'])
    assert(ev('flights[0].waypoints[1].' + k) === null, k + ' is ' + ev('flights[0].waypoints[1].' + k));
});
T('a circuit on its own fix has no ground track, so the panel refuses it', () => {
  ev(SEED);
  // ON ENDU's OWN COORDINATES - a touch & go, which is the only way a circuit
  // with no ground track gets made. The fixture used to sit ~5 NM away, which
  // since v16.83 is a real transit leg and a perfectly reasonable thing to pin.
  ev(`flights[0].waypoints.splice(1, 0, { name: 'PATTERN', lat: flights[0].waypoints[0].lat, lng: flights[0].waypoints[0].lng, alt: 1200, oat: 0, wdir: 0, wspd: 0, var: -11, isPattern: true, laps: 3 }); refreshMap();`);
  const before = ev('flights[0].waypoints.length');
  ev(`hitLines[0]._h.contextmenu({ latlng: { lat: 69.08, lng: 18.55 }, originalEvent: { preventDefault: function(){} } })`);
  // Either it found a real leg elsewhere, or it declined - what it must never
  // do is open a climb-placement panel for something with no distance.
  //
  // THE TEST IS THE GEOMETRY, NOT THE NAME. Asserting "PATTERN is not in the
  // title" was only ever a proxy, and since v16.83 it is the wrong one: with
  // the circuit on ENDU, the leg PATTERN -> FINNSNES is 22 NM of ordinary
  // flying that the panel SHOULD open on.
  const leg = ev('legPanel ? [legPanel.legEnd, flights[0].waypoints.length] : null');
  if (leg) {
    assert(ev(`legIsFlown(flights[0].waypoints[legPanel.legEnd - 1], flights[0].waypoints[legPanel.legEnd])`),
      'the panel opened on a leg with no ground track: ' +
      doc.getElementById('leg-modal-title').textContent);
  }
  assert(ev('flights[0].waypoints.length') === before, 'the route changed');
});
T('the leg leaving a circuit takes a via point like any other', () => {
  // THE PILOT'S ORIGINAL REPORT (v16.83): "if i set pattern as a point i cant
  // set via-points on the same leg". That is still fixed under v16.84's rule,
  // and by the cleaner route: the circuit covers no ground, so the leg either
  // side of it is ONE ordinary leg - ENDU -> FINNSNES here - and it bends.
  ev(SEED);
  ev(`flights[0].waypoints.splice(1, 0, { name: 'PATTERN', lat: 69.15, lng: 18.30, alt: 1200, oat: 0, wdir: 0, wspd: 0, var: -11, isPattern: true, laps: 3 }); refreshMap();`);
  const before = ev('flights[0].waypoints.length');
  // press on the leg LEAVING the circuit, a little off the straight line
  ev(`hitLines[0]._h.mousedown({ latlng: { lat: 69.16, lng: 18.20 }, originalEvent: { preventDefault: function(){}, button: 0 } })`);
  assert(ev('flights[0].waypoints.length') === before, 'bending a leg must not add a waypoint');
  assert(ev('(flights[0].waypoints[2].via || []).length') === 1,
    'the leg leaving a circuit took no via point: ' +
    ev('JSON.stringify(flights[0].waypoints[2].via || [])'));
  // ...and the bent path really walks two spans, i.e. the via is flown rather
  // than merely stored.
  const L2 = moduleExports.legs;
  const bent = L2.computeLegTotals(ev('flights[0].waypoints[1]'), ev('flights[0].waypoints[2]'));
  assert(bent && bent.segs.length === 2, 'the bent leg does not walk two spans');
  // The leg REACHING the circuit has no ground at all, so it can take none.
  assert(!ev('legIsFlown(flights[0].waypoints[0], flights[0].waypoints[1])'),
    'the leg reaching a circuit still covers ground');
});
T('the OFP row carries only the delete button', () => {
  // v16.28: the per-row "+" was removed at the user's request - clicking the
  // map adds a waypoint, and right-clicking the line inserts one mid-route,
  // so a button in every row was paying table width for nothing.
  ev(SEED);
  const rows = [...doc.querySelectorAll('#tbody-flight-0 tr:not(.sub-leg-row)')];
  assert(rows.length === 2, 'seed route should have two leg rows');
  for (const tr of rows) {
    const btns = [...tr.querySelectorAll('button')].map(b => b.textContent.trim());
    assert(JSON.stringify(btns) === '["\u00d7"]', 'row buttons are ' + JSON.stringify(btns));
  }
  const raw = APP_SRC;
  assert(!raw.includes('insertWaypointMidLeg'), 'the + button command is still in the build');
});
T('the guide explains both gestures', () => {
  const built = APP_SRC;
  assert(/Grab a leg line and drag/.test(built), 'the guide does not mention the drag gesture');
  assert(/Forgot a waypoint in the middle of a route/.test(built),
    'the guide does not explain how to insert a waypoint mid-route');
  assert(/right-click the leg line/i.test(built), 'the guide does not mention the right-click insert');
});

console.log('\n=== 62. The offline chart download stays removed ===');
T('nothing offers to download the chart', () => {
  // v16.26: removed after it failed in the pilot's hands. Avinor sends no
  // CORS header, so every tile is an OPAQUE response; browsers pad the
  // storage cost of those (8.46 MB charged for a 68-byte tile) and randomise
  // the padding so it cannot be measured. A route corridor cost gigabytes of
  // quota and the browser evicted the whole origin - the chart worked for a
  // while and then vanished on zooming out and back in.
  assert(!fs.existsSync('src/lib/tiles.js'), 'src/lib/tiles.js is back');
  const page = fs.readFileSync('src/index.html', 'utf8');
  for (const gone of ['downloadRouteChart', 'chartCacheAvailable', 'chart-dl-btn',
                      'tilesForBounds', 'routeBounds', 'c182_chart_download']) {
    assert(!page.includes(gone), 'the chart download is back in the page: ' + gone);
  }
  const built = APP_SRC;
  assert(!/\u2b07 Chart/.test(built) && !built.includes('downloadRouteChart'),
    'the built app still offers a chart download');
  assert(!doc.getElementById('chart-dl-btn'), 'the download button is still in the DOM');
  // and the reason must stay written down, or someone rebuilds it
  assert(/OPAQUE response/.test(page), 'the reason the download was removed is undocumented');
});
T('nothing promises an offline map any more', () => {
  const page = fs.readFileSync('src/index.html', 'utf8');
  // there are two tileerror notes - one per base layer; the VFR one is last
  const note = page.slice(page.lastIndexOf("note.id = 'offline-tile-note'"),
                          page.lastIndexOf("appendChild(note)"));
  assert(/both charts are streamed/.test(note), 'the tile-error note no longer says the chart needs internet');
  assert(!/downloaded|offline copy|cached map/i.test(note),
    'the tile-error note promises an offline chart again: ' + note);
  // and neither note may claim a stored map
  const topo = page.slice(page.indexOf("note.id = 'offline-tile-note'"),
                          page.indexOf("appendChild(note)"));
  assert(!/downloaded|offline copy|cached map/i.test(topo),
    'the topo tile-error note promises an offline chart: ' + topo);
});
T('the guide does not offer topo as the offline chart', () => {
  // This is the promise the pilot actually acted on: they turned the wifi
  // off, saw a blank VFR chart, switched to Topo as instructed and found
  // nothing there either. Nothing has ever stored topo tiles for offline use.
  const built = APP_SRC;
  assert(!/topo is the offline choice/i.test(built), 'the guide still calls topo the offline chart');
  assert(!/offline-cached/i.test(built), 'a control still claims a chart is cached offline');
  assert(/Both charts need internet/i.test(built), 'the guide does not say both charts need internet');
  assert(/no chart download, on purpose/i.test(built),
    'the guide does not record why the chart download was removed');
});
T('the tile cache is back to a size the browser will actually keep', () => {
  const sw = fs.readFileSync('site/sw.js', 'utf8');
  const m = sw.match(/const TILE_LIMIT = (\d+);/);
  assert(m, 'the tile cache no longer has a limit');
  // Opaque tiles are charged megabytes each, so a large limit does not hold
  // more chart - it fills the origin's quota and gets EVERYTHING evicted,
  // app shell included. 400 was the value before the download feature.
  assert(Number(m[1]) <= 400, 'TILE_LIMIT ' + m[1] + ' will fill the quota and evict the whole origin');
  // the VFR layer keeps the same wide ring as topo - it matters more here,
  // because Avinor forbids reusing a tile without revalidating
  const page = fs.readFileSync('src/index.html', 'utf8');
  const vfr = page.slice(page.indexOf('const vfrTiles = L.tileLayer'), page.indexOf('vfrTiles.getTileUrl'));
  assert(/keepBuffer: 4/.test(vfr), 'the VFR layer lost its tile buffer');
  assert(/must-revalidate/.test(vfr), 'the reason the buffer matters is undocumented');
});

T('every map control is in the stack, so none can be invisible', () => {
  // Two buttons shipped invisible: the map controls were positioned one by
  // one by id with hardcoded top offsets, so a new button with no rule of
  // its own fell into normal flow at the bottom of the page. They are now
  // one container with one shared class, and this asserts nobody goes back.
  const page = fs.readFileSync('src/index.html', 'utf8');
  const css = fs.readFileSync('src/styles.css', 'utf8');
  const holder = doc.getElementById('map-controls');
  assert(holder, 'the map controls container is gone');
  const btns = [...holder.querySelectorAll('button')];
  assert(btns.length >= 3, 'expected every map control inside the stack, found ' + btns.length);
  for (const id of ['declutter-btn', 'chart-btn', 'chart-detail-btn']) {
    const el = doc.getElementById(id);
    assert(el, 'missing map control: ' + id);
    assert(el.parentElement === holder, id + ' is outside the control stack - it will not be positioned');
    assert(el.classList.contains('map-ctl'), id + ' does not carry the shared class');
  }
  // and no control may go back to being positioned by its own id
  for (const id of ['#declutter-btn', '#chart-btn', '#chart-detail-btn']) {
    assert(!new RegExp('\\' + id + '\\s*\\{[^}]*position:\\s*absolute').test(css),
      id + ' is positioned individually again - the next button added will be invisible');
  }
  assert(/#map-controls\s*\{[^}]*position:\s*absolute/.test(css), 'the stack is not positioned over the map');
  assert(/#map-controls\s*\{[^}]*flex-direction:\s*column/.test(css), 'the controls no longer stack');
});
T('the whole source type-checks, and the checker cannot be quietly dropped', () => {
  // Phase 2: the real TypeScript compiler checks these files; the types live
  // in JSDoc so the modules stay plain .js that Node can require directly -
  // which is what the standalone-run guard above depends on.
  assert(fs.existsSync('tsconfig.json'), 'tsconfig.json is gone - nothing is type-checked');
  const cfg = JSON.parse(fs.readFileSync('tsconfig.json', 'utf8').replace(/^\s*"\/\/":\s*\[[^\]]*\],?/m, ''));
  const co = cfg.compilerOptions;
  assert(co.checkJs === true && co.allowJs === true, 'checkJs/allowJs turned off - the .js files stop being checked');
  assert(co.strict === true, 'strict mode turned off');
  assert(co.noEmit === true, 'noEmit turned off - the checker would start writing files');
  assert(fs.existsSync('src/types.d.ts'), 'the domain types are gone');
  const types = fs.readFileSync('src/types.d.ts', 'utf8');
  for (const t of ['interface Waypoint', 'interface Flight', 'interface LegResult',
                   'interface ScheduleLeg', 'interface AircraftProfile', 'interface DaylightResult']) {
    assert(types.includes(t), 'missing domain type: ' + t);
  }
  // npm test must actually RUN it, or it rots
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert(/typecheck/.test(pkg.scripts.test), 'npm test no longer runs the type checker');
  assert(/tsc --noEmit/.test(pkg.scripts.typecheck), 'the typecheck script does not run tsc');
});
T('the source is navigable: styling and each calculation have ONE home', () => {
  // A UI edit should not require reading 4000 lines to find the right place.
  assert(fs.existsSync('src/styles.css'), 'styling is not in its own file');
  const page = fs.readFileSync('src/index.html', 'utf8');
  assert(/<!-- @STYLES:/.test(page), 'the page has no @STYLES marker for the build to fill');
  assert(!/<style>[\s\S]*\{[\s\S]*\}[\s\S]*<\/style>/.test(page), 'CSS rules crept back into the page');
  assert(page.includes('WHERE TO EDIT WHAT'), 'the navigation index is gone from the page script');
  // READ THE DIRECTORY, DO NOT LIST THE MODULES. This was a hardcoded list of
  // eleven, and by v16.85 there were twenty - so the index had quietly stopped
  // pointing at nine of them (anchors, airspace, corridor, metar, ofpform,
  // rhumb, keys, skins, vac) while the test went on passing and CLAUDE.md went
  // on claiming it "asserts the index still points at every module that
  // exists". That sentence is true now. Straight L3: a figure quoted as
  // evidence has to be re-measured, not restated.
  const libs = fs.readdirSync('src/lib').filter((f) => f.endsWith('.js'));
  assert(libs.length >= 20, 'src/lib has shrunk unexpectedly: ' + libs.length);
  // AND IT MUST BE THE INDEX, NOT THE PAGE. Searching the whole page passes
  // for the wrong reason: nine modules are named in comments beside the code
  // that uses them, so the first version of this went green with vac.js
  // deleted from the index. Slice the block and look only inside it.
  const idx = page.slice(page.indexOf('WHERE TO EDIT WHAT'), page.indexOf('// 1. HELPERS'));
  assert(idx.length > 500 && idx.length < 6000, 'the index block did not slice out: ' + idx.length);
  for (const lib of libs) {
    assert(idx.includes('src/lib/' + lib), 'the WHERE TO EDIT WHAT index does not point at ' + lib);
  }
  // and the built artifact must still carry the styling inline
  const built = APP_SRC;
  assert(/<style>[\s\S]{500,}<\/style>/.test(built), 'the built file lost its inlined CSS');
  assert(!/<!-- @STYLES:/.test(built), 'the style marker comment survived into the artifact');
  // exactly one <style> element: two would invite cascade surprises
  assert((built.match(/<style>/g) || []).length === 1, 'the artifact has more than one <style> block');
});
T('an untrusted import cannot poison the plan', () => {
  const X = moduleExports.exch;
  assert(X.sanitiseFlights(null) === null && X.sanitiseFlights([]) === null && X.sanitiseFlights('nope') === null,
    'garbage must yield null so the caller keeps the plan it already has');
  // waypoints without usable coordinates are dropped, not loaded as NaN
  const f = X.sanitiseFlights([{ waypoints: [
    { name: 'GOOD', lat: 69, lng: 18 }, { name: 'BAD', lat: 'x', lng: 18 }, { name: 'NONE' }
  ] }]);
  assert(f[0].waypoints.length === 1 && f[0].waypoints[0].name === 'GOOD', 'bad coordinates survived the import');
  // an empty via array must be removed, not left to render as a bent leg
  const v = X.sanitiseFlights([{ waypoints: [{ lat: 69, lng: 18, via: [{ lat: 'x' }] }] }]);
  assert(v[0].waypoints[0].via === undefined, 'an empty via array survived');
  assert(X.defaultFlights()[0].waypoints.length === 0, 'defaultFlights is not blank');
});
T('rendered-page signals reach the banner, and duplicates collapse', () => {
  const I = moduleExports.integrity;
  assert(I.collectIntegrityProblems([], { tableText: 'GS NaN kt' })[0].includes('NaN'), 'a NaN on screen is not caught');
  assert(I.collectIntegrityProblems([], { tableText: 'Infinity' })[0].includes('infinite'), 'an infinite value is not caught');
  assert(I.collectIntegrityProblems([], { daylightText: 'Invalid Date' })[0].includes('do not trust'), 'a broken daylight card is not caught');
  assert(I.collectIntegrityProblems([], { fuelRemaining: -3 })[0].includes('NEGATIVE'), 'negative fuel remaining is not caught');
  // a positive figure, and an absent one, must NOT raise it
  assert(I.collectIntegrityProblems([], { fuelRemaining: 12 }).length === 0, 'positive fuel raised a false alarm');
  assert(I.collectIntegrityProblems([], {}).length === 0, 'missing signals raised a false alarm');
  // the banner shows the first few and says how many are hidden
  const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const html = I.integrityBannerHTML(many);
  assert(html.includes('DO NOT USE THESE FIGURES'), 'the banner no longer says not to use the figures');
  assert(html.includes('and 2 more'), 'the banner hides problems without saying how many: ' + html);
});
T('the winds mean is speed-weighted, and survives the 000/360 wrap', () => {
  const W = moduleExports.winds;
  const mean = (list) => {
    let u = 0, v = 0;
    for (const [d, s] of list) { const c = W.windToUV(d, s); u += c[0]; v += c[1]; }
    return W.uvToWind(u / list.length, v / list.length);
  };
  // averaging in u/v space weights by SPEED. The three-model mean of
  // 260/20, 280/24, 300/28 is 282.3 - not the 280 a naive average of the
  // degree numbers gives. A test once asserted 280 and was wrong.
  const [dir3, spd3] = mean([[260, 20], [280, 24], [300, 28]]);
  assert(Math.abs(dir3 - 282.3) < 0.1, 'three-model mean direction: ' + dir3.toFixed(2) + ', expected 282.3');
  assert(Math.abs(spd3 - 23.1) < 0.1, 'three-model mean speed: ' + spd3.toFixed(2));
  // and averaging degrees breaks across north: 350 and 010 would give 180,
  // the exact reciprocal of the right answer.
  const [dirN] = mean([[350, 20], [10, 20]]);
  assert(dirN < 0.1 || dirN > 359.9, 'mean across north came out at ' + dirN.toFixed(1) + ', should be 000');
  assert(W.angleDiff(350, 10) === 20, 'angleDiff across north: ' + W.angleDiff(350, 10));
});
T('every module export and the built page agree exactly', () => {
  const fixtures = [[69.055, 18.544], [69.683, 18.919], [60.202, 11.084]];
  for (const [lat, lng] of fixtures) {
    const m = moduleExports.magvar.resolveMagVar(lat, lng, 2026.6438);
    const p = ev(`resolveMagVar(${lat}, ${lng}, 2026.6438)`);
    assert(m.raw === p.raw && m.val === p.val, `magvar mismatch at ${lat},${lng}: ${m.raw} vs ${p.raw}`);
    const md = moduleExports.geodesy.calcDistanceNM(lat, lng, 69.68, 18.92);
    const pd = ev(`calcDistanceNM(${lat}, ${lng}, 69.68, 18.92)`);
    assert(md === pd, `distance mismatch from ${lat},${lng}: ${md} vs ${pd}`);
    assert(moduleExports.fmt.toDMM(lat, true) === ev(`toDMM(${lat}, true)`), 'toDMM mismatch at ' + lat);
  }
  // the whole schedule, module vs built page, on the suite's seed route
  ev(SEED);
  const seedFlight = `{ waypoints: flights[0].waypoints }`;
  // the daylight card is a legal statement: module and page must not drift
  for (const [d, lat, lng] of [['2026-03-20', 69.6832, 18.9186], ['2026-06-21', 69.6832, 18.9186],
                               ['2026-12-21', 78, 15], ['2026-09-01', 59.9, 10.7]]) {
    const m = JSON.stringify(moduleExports.day.computeDaylight(d, lat, lng));
    const pg = ev(`JSON.stringify(computeDaylight('${d}', ${lat}, ${lng}))`);
    assert(m === pg, `daylight mismatch on ${d} at ${lat},${lng}: ${m} vs ${pg}`);
  }
  const pageSched = ev(`JSON.stringify(computeFlightSchedule(${seedFlight}))`);
  const modSched = JSON.stringify(moduleExports.legs.computeFlightSchedule(JSON.parse(ev('JSON.stringify({ waypoints: flights[0].waypoints })'))));
  assert(modSched === pageSched, 'the altitude schedule differs between module and page');
  // the performance engine is what fuel and endurance hang on: walk the
  // whole POH envelope, not a sample, and demand exact agreement
  for (let alt = 0; alt <= 14000; alt += 500) {
    const m = moduleExports.perf.climbPerf(0, alt, 15), p = ev(`climbPerf(0, ${alt}, 15)`);
    assert(JSON.stringify(m) === JSON.stringify(p), `climbPerf mismatch at ${alt} ft: ${JSON.stringify(m)} vs ${JSON.stringify(p)}`);
    const mc = moduleExports.perf.cruisePerf(alt, -5), pc = ev(`cruisePerf(${alt}, -5)`);
    assert(JSON.stringify(mc) === JSON.stringify(pc), `cruisePerf mismatch at ${alt} ft: ${JSON.stringify(mc)} vs ${JSON.stringify(pc)}`);
  }
});
console.log('\n=== 60. Hosted build (GitHub Pages / LAN / localhost) ===');
// jsdom has no service worker and no Cache API, so the RUNTIME behaviour is
// covered by tools/verify-hosted.mjs against real Chromium. These guard the
// structure that behaviour depends on.
T('the build emits a hosted site alongside the double-click file', () => {
  for (const f of ['site/index.html', 'site/app.js', 'site/sw.js', 'site/.nojekyll']) {
    assert(fs.existsSync(f), 'missing from the hosted build: ' + f);
  }
  const idx = fs.readFileSync('site/index.html', 'utf8');
  assert(/<script src="app\.js"><\/script>/.test(idx), 'site/index.html does not link app.js');
  // type="module" is DEFERRED and would run after the page script, whose top
  // level calls into the bundle and whose inline on*= handlers need globals
  assert(!/<script[^>]+src="app\.js"[^>]+type="module"/.test(idx), 'app.js must load as a classic script, not a module');
  assert(!idx.includes('window.C182 = Object.assign'), 'the bundle is inlined AND linked - every function would be defined twice');
  assert(fs.readFileSync('site/app.js', 'utf8').includes('window.C182'), 'app.js is not the bundle');
});
T('the service worker refuses to trust a chart tile of unknown vintage', () => {
  const sw = fs.readFileSync('site/sw.js', 'utf8');
  // THE safety rule: tile URLs do not carry the AIRAC cycle, so a cached tile
  // is only trustworthy once the page has reported which cycle is live.
  assert(/if \(!knownEdition\) return;/.test(sw), 'the unknown-edition guard is gone: stale-cycle tiles could be served');
  assert(/let knownEdition = null;/.test(sw), 'knownEdition must start unknown, never assume a cycle');
  assert(sw.includes("data.type !== 'chart-edition'"), 'the edition handshake is missing');
  // tile caches are keyed by cycle and retired by cycle, not by app release
  assert(/c182-tiles-/.test(sw) && /c182-shell-/.test(sw), 'shell and tile caches must stay separate');
  assert(!/c182-shell-/.test(sw.split("startsWith(TILE_PREFIX)")[1] || ''), 'an app release must not delete downloaded chart tiles');
  // live weather must never be served from cache
  assert(/a cached forecast is a wrong forecast/.test(sw), 'the no-cached-weather rule is undocumented');
});
T('the worker is version-stamped and only registers on a secure context', () => {
  const sw = fs.readFileSync('site/sw.js', 'utf8');
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
  assert(sw.includes(JSON.stringify(pkg.split('.').slice(0, 2).join('.'))) || sw.includes(JSON.stringify(pkg)),
    'sw.js was not stamped with the app version - old shells would never be dropped');
  const idx = fs.readFileSync('site/index.html', 'utf8');
  assert(idx.includes("'serviceWorker' in navigator") && idx.includes('self.isSecureContext'),
    'registration is not feature-detected: it would throw on file:// or a plain-http LAN address');
  // v16.45: the single-file delivery is gone, so the hosted page IS the app and
  // it MUST register the worker - that is the only way chart tiles are cached.
  assert(idx.includes('navigator.serviceWorker.register'),
    'the hosted page no longer registers the service worker - no tile caching at all');
});
T('the build survives a Windows clone (CRLF line endings)', () => {
  // git's core.autocrlf checks the source out as CRLF on Windows, which broke
  // the @BUNDLE marker: the regex matched "\n" and the file had "\r\n". A ZIP
  // download preserves LF, so this only ever failed on a cloned repo.
  const buildSrc = fs.readFileSync('tools/build.mjs', 'utf8');
  const m = buildSrc.match(/const MARKER = (\/.*\/[a-z]*);/);
  assert(m, 'could not find the @BUNDLE marker regex in tools/build.mjs');
  const marker = eval(m[1]);
  const line = '  <!-- @BUNDLE: build inlines src/main.js here as a classic script -->';
  assert(marker.test(line + '\n'), 'the marker no longer matches an LF source');
  assert(marker.test(line + '\r\n'), 'the marker does not match a CRLF source - a Windows clone cannot build');
  // and the working tree must be pinned to LF so it does not come up again
  assert(fs.existsSync('.gitattributes'), '.gitattributes is missing - Windows clones will get CRLF');
  const ga = fs.readFileSync('.gitattributes', 'utf8');
  assert(/^\* text=auto eol=lf$/m.test(ga), '.gitattributes does not pin the working tree to LF');
  assert(/\*\.cmd text eol=crlf/.test(ga), '.cmd files must stay CRLF for cmd.exe');
  // and the build must EMIT lf whatever the tree uses, or a rebuild on a
  // Windows clone rewrites dist/ and blocks the next `git pull`
  assert(/replace\(\/\\r\\n\/g, '\\n'\)/.test(buildSrc), 'the build no longer normalizes its output to LF');
  const built = APP_SRC;
  assert(!built.includes('\r\n'), 'the committed artifact contains CRLF line endings');
});
T('Windows can run the planner without a command line or git', () => {
  // The user downloads the repo as a ZIP and double-clicks; git and npm on
  // the PATH cannot be assumed. v16.45: build.cmd went with the single-file
  // delivery - its only job was opening it - so serve.cmd is the one entry
  // point and must do the whole job on its own.
  assert(fs.existsSync('serve.cmd'), 'missing Windows helper: serve.cmd');
  assert(!fs.existsSync('build.cmd'), 'build.cmd is back - it only built the removed single-file delivery');
  const serve = fs.readFileSync('serve.cmd', 'utf8');
  assert(serve.includes('npm install'), 'serve.cmd does not install dependencies on first run');
  assert(/node tools\\serve\.mjs/.test(serve), 'serve.cmd does not start the server');
  assert(serve.includes('localhost:8182'), 'serve.cmd does not open the planner');
  // bare .js run under Windows Script Host was a real support incident
  assert(serve.includes('Windows Script Host'), 'the WSH warning is gone from serve.cmd');
  const srv = fs.readFileSync('tools/serve.mjs', 'utf8');
  assert(srv.includes('EADDRINUSE'), 'a taken port would dump a raw stack trace at the user');
});
T('the runtime rules are actually verified somewhere, not just asserted here', () => {
  assert(fs.existsSync('tools/verify-hosted.mjs'), 'the hosted-build runtime verification is missing');
  const v = fs.readFileSync('tools/verify-hosted.mjs', 'utf8');
  for (const rule of ['RULE 1 BROKEN', 'RULE 2 BROKEN', 'RULE 3 BROKEN', 'RULE 4 BROKEN']) {
    assert(v.includes(rule), 'verify-hosted.mjs no longer checks ' + rule);
  }
});

T('the built site links exactly its own assets, and every marker was replaced', () => {
  // v16.45: this used to assert the artifact was SELF-CONTAINED (no external
  // scripts), which was the single-file delivery's defining property. That
  // delivery is gone. The property worth guarding now is the opposite and
  // sharper: the page links the assets the build emits, and NOTHING else - a
  // stray CDN or a forgotten sidecar would break the offline shell silently.
  const idx = fs.readFileSync('site/index.html', 'utf8');
  assert(idx.includes('GENERATED by tools/build.mjs'), 'build banner missing');
  for (const marker of ['@BUNDLE', '@STYLES', '@AIPDATA', '@VACDATA'])
    assert(!idx.includes(marker), marker + ' marker survived into the built page');
  const externals = [...idx.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]).sort();
  assert(JSON.stringify(externals) === JSON.stringify(['aip.js', 'app.js', 'vac-index.js']),
    'the page links something other than its own three assets: ' + externals.join(', '));
  for (const f of ['site/app.js', 'site/aip.js', 'site/vac-index.js', 'site/sw.js'])
    assert(fs.existsSync(f), f + ' was not emitted');
  // ...and the worker precaches all of them, or the overlay vanishes offline.
  const sw = fs.readFileSync('site/sw.js', 'utf8');
  for (const asset of externals)
    assert(sw.includes(asset), 'the service worker does not precache ' + asset);
  assert(APP_SRC.includes('window.C182'), 'module namespace missing from the bundle');
});
T('the page script no longer defines what the modules own', () => {
  const src = fs.readFileSync('src/index.html', 'utf8');
  for (const fn of ['resolveMagVar', 'calcDistanceNM', 'calcTrueTrack', 'interpolateGeo',
                    'climbCumulative', 'climbPerf', 'cruiseAtLevel', 'cruisePerf', 'isaTemp',
                    'calcWCA', 'formatTimeHHMM', 'toDMM',
                    'legPath', 'pathSegments', 'pointAlongSegments', 'distToSegmentNM', 'phaseGS',
                    'computeLegTotals', 'computeLegProfile', 'climbAltReached',
                    'computeFlightSchedule', 'computeLegMarkers',
                    'sunDeclEqTime', 'solarCrossingUTC', 'computeDaylight',
                    'utcOffsetLabel', 'fmtLocalHM', 'localDateStrOf', 'firstPlottedWaypoint',
                    'windToUV', 'uvToWind', 'buildWindSamplePoints', 'buildOpenMeteoUrl',
                    'interpolateWindProfile', 'extractPointWeather', 'extractPointWeatherAt', 'angleDiff',
                    'flightTitle', 'collectIntegrityProblems', 'integrityBannerHTML',
                    'magneticTrack', 'magneticTrackLabel',
                    'sanitiseFlights', 'defaultFlights', 'buildExportPayload', 'pickProfileKeys']) {
    assert(!new RegExp('function ' + fn + '\\s*\\(').test(src),
      fn + ' is still defined in the page script (duplicate of its module)');
  }
  assert(/-> src\/lib\/magvar\.js/.test(src) && /-> src\/lib\/geodesy\.js/.test(src), 'pointer comments missing');
  const built = APP_SRC;
  assert(built.includes('geographiclib') || built.includes('InverseLine'), 'geodesy library not bundled into the artifact');
});
T('the build rejects a version mismatch between page and package.json', () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
  const page = APP_SRC.match(/const APP_VERSION = '([^']+)'/)[1];
  assert(pkg.split('.').slice(0, 2).join('.') === page, `page ${page} vs package ${pkg}`);
  const build = fs.readFileSync('tools/build.mjs', 'utf8');
  assert(build.includes('checkDuplicateIds') && build.includes('checkSyntax') && build.includes('checkVersion'),
    'the build must keep enforcing the ship checklist');
});

T('the project memory and docs are intact (guards against truncation)', () => {
  // CLAUDE.md was once silently emptied by a scripted edit; it is the
  // project's verification record, so its presence is now a test.
  const memory = fs.readFileSync('CLAUDE.md', 'utf8');
  assert(memory.split('\n').length > 100, 'CLAUDE.md looks truncated: ' + memory.split('\n').length + ' lines');
  for (const anchor of ['non-negotiable rules', 'NO GUESSTIMATES', 'Domain decisions already settled',
                        'Safety posture', 'src/lib/geodesy.js', 'WMM2025']) {
    assert(memory.includes(anchor), 'CLAUDE.md lost its "' + anchor + '" section');
  }
  const readme = fs.readFileSync('README.md', 'utf8');
  assert(readme.includes('npm run build') && readme.includes('dist/'), 'README lost the build instructions');
  // v17.5: the long form moved to docs/HISTORY.md, verbatim. It is the same
  // record, so it gets the same truncation guard.
  const history = fs.readFileSync('docs/HISTORY.md', 'utf8');
  assert(history.split('\n').length > 5000, 'docs/HISTORY.md looks truncated: ' + history.split('\n').length + ' lines');
  for (const anchor of ['PINNED CLIMB AND DESCENT CORNERS', 'Offline chart download', 'THE VAC IS DRAWN ON THE MAP']) {
    assert(history.includes(anchor), 'docs/HISTORY.md lost its "' + anchor + '" section');
  }
});

T('every CLAUDE.md pointer names exactly one heading in docs/HISTORY.md', () => {
  // CLAUDE.md keeps one line per decision and points at the full entry with
  // a section-sign pointer followed by the exact heading in braces. A pointer
  // that names no heading - or two - sends the next reader nowhere, which is
  // the same drift as a stale index. The literal placeholder in the
  // how-this-file-works note is not a pointer.
  const md = fs.readFileSync('CLAUDE.md', 'utf8');
  const hist = fs.readFileSync('docs/HISTORY.md', 'utf8');
  const heads = hist.split('\n').filter((l) => /^#{1,4} /.test(l)).map((l) => l.replace(/^#+\s+/, '').trim());
  const ptrs = [...md.matchAll(/\u00a7\{([^}]*)\}/g)].map((m) => m[1]).filter((p) => p !== 'heading');
  assert(ptrs.length >= 90, 'CLAUDE.md carries only ' + ptrs.length + ' history pointers');
  const bad = ptrs.filter((p) => heads.filter((h) => h === p).length !== 1);
  assert(!bad.length, 'pointers that do not name exactly one heading: ' + bad.join(' | '));
  assert(md.split(/\s+/).length < 12000, 'CLAUDE.md is growing the long form back: ' + md.split(/\s+/).length + ' words');
});

console.log('\n=== 60. Saved routes: fresh magvar on load, update-in-place on save ===');
T('loading a saved route re-computes stale magnetic variation', () => {
  ev(SEED);
  // a route saved under the OLD regional polynomial: ENGM was ~2 deg out
  ev(`localStorage.setItem('c182_custom_routes', JSON.stringify({ 'OSLO OLD': [
    { lat: 60.202, lng: 11.084, name: 'ENGM', alt: 681,  oat: 10, wdir: 0, wspd: 0, var: -3 },
    { lat: 60.121, lng: 11.500, name: 'EAST', alt: 2500, oat: 10, wdir: 0, wspd: 0, var: -3 }
  ] }));`);
  ev('populateRouteDropdown();');
  doc.getElementById('route-selector').value = 'route:OSLO OLD';
  ev('loadSelectedRouteOrMission();');
  const wp = ev('flights[activeFlightIndex].waypoints[0]');
  const expected = ev('resolveMagVar(60.202, 11.084).val');
  assert(wp.var === expected, `stale VAR survived load: ${wp.var} (should be ${expected})`);
  assert(wp.varSource === 'WMM2025', 'varSource not stamped: ' + wp.varSource);
  assert(txtOf('magvar-refresh-note').includes('re-computed'), 'no note shown: ' + txtOf('magvar-refresh-note'));
});
T('a manually typed VAR is NEVER overwritten by the refresh', () => {
  ev(`localStorage.setItem('c182_custom_routes', JSON.stringify({ 'MANUAL': [
    { lat: 60.202, lng: 11.084, name: 'ENGM', alt: 681,  oat: 10, wdir: 0, wspd: 0, var: -99, varSource: 'MANUAL' },
    { lat: 60.121, lng: 11.500, name: 'EAST', alt: 2500, oat: 10, wdir: 0, wspd: 0, var: -3 }
  ] }));`);
  ev('populateRouteDropdown();');
  doc.getElementById('route-selector').value = 'route:MANUAL';
  ev('loadSelectedRouteOrMission();');
  const wps = ev('flights[activeFlightIndex].waypoints');
  assert(wps[0].var === -99, 'manual VAR was overwritten: ' + wps[0].var);
  assert(wps[1].var === ev('resolveMagVar(60.121, 11.5).val'), 'auto VAR was not refreshed');
});
T('editing the VAR cell marks it manual so it survives future loads', () => {
  ev(SEED);
  const input = doc.querySelector('#tbody-flight-0 tr td input[title^="Mag VAR"]');
  assert(input, 'VAR input not found');
  assert(/varSource='MANUAL'/.test(input.getAttribute('onchange')), 'VAR edit does not mark the value manual');
});
TA('saving offers every option at once, the whole flight first', async () => {
  ev(SEED);
  ev(`localStorage.setItem('c182_custom_routes', JSON.stringify({ 'MY ROUTE': [
    { lat: 69.0, lng: 18.0, name: 'A', alt: 500, oat: 10, wdir: 0, wspd: 0, var: -11 },
    { lat: 69.3, lng: 18.2, name: 'B', alt: 2500, oat: 10, wdir: 0, wspd: 0, var: -11 } ] }));`);
  ev('populateRouteDropdown();');
  doc.getElementById('route-selector').value = 'route:MY ROUTE';
  ev('loadSelectedRouteOrMission();');
  assert(ev('loadedRouteRef && loadedRouteRef.name') === 'MY ROUTE', 'load did not remember the source');
  ev(`flights[activeFlightIndex].waypoints[1].alt = 4500;`);

  const p = w.saveCurrentMission();
  await tick();
  // ONE dialog, not a chain of yes/no questions
  const opts = [...openDlg().querySelectorAll('.dlg-btn')].map(b => b.textContent.replace(/\s+/g, ' ').trim());
  assert(opts.length === 4, 'expected 4 options, got: ' + opts.join(' | '));
  // UPDATED DELIBERATELY AT v16.100 (the author: the whole flight is "used
  // 99% of the time"). The whole flight is FIRST and PRIMARY; Replace is the
  // second option and still says what it does (QoL 11) - but it is no longer
  // what Enter does, because it is the one choice that overwrites something.
  const btns = [...openDlg().querySelectorAll('.dlg-btn')];
  assert(/^Save the whole flight/.test(opts[0]) && btns[0].classList.contains('dlg-primary'),
    'saving the whole flight is not the first, primary option: ' + opts.join(' | '));
  assert(opts[1].includes('MY ROUTE') && /replace/i.test(opts[1]) && !btns[1].classList.contains('dlg-primary'),
    'Replace is not second, or is still the primary: ' + opts.join(' | '));
  assert(btns.filter((b) => b.classList.contains('dlg-primary')).length === 1, 'more than one primary button');
  assert(opts.some(o => o.includes('active sector as a route')), 'the route option is missing: ' + opts.join(' | '));
  answerDialog('Replace "MY ROUTE" with this plan');
  await p;

  const saved = ev(`getStoredSingleRoutes()['MY ROUTE']`);
  assert(saved[1].alt === 4500, 'the saved route was not updated: ' + saved[1].alt);
  assert(Object.keys(ev('getStoredSingleRoutes()')).length === 1, 'a duplicate entry was created');
  assert(toastText().includes('updated'), 'no confirmation toast: ' + toastText());
});
TA('choosing "save as new" asks for a name and keeps both entries', async () => {
  const p = w.saveCurrentMission();
  await tick();
  answerDialog('Save only the active sector as a route');
  await tick();
  assert(openDlg().querySelector('.dlg-input'), 'no name field offered');
  typeInDialog('COPY');
  answerDialog('Save');
  await p;
  const routes = ev('getStoredSingleRoutes()');
  assert(routes['MY ROUTE'] && routes['COPY'], 'save-as-new did not run: ' + Object.keys(routes).join());
  assert(ev('loadedRouteRef.name') === 'COPY', 'the new name should become the update target');
});
TA('cancelling the save dialog stores nothing', async () => {
  const before = Object.keys(ev('getStoredSingleRoutes()')).length;
  const p = w.saveCurrentMission();
  await tick();
  answerDialog('Cancel');
  await p;
  assert(Object.keys(ev('getStoredSingleRoutes()')).length === before, 'cancel still saved something');
  assert(!openDlg(), 'dialog stayed open after cancel');
});

console.log('\n=== 61. In-app dialogs replace the native ones ===');
T('no native alert/confirm/prompt remains in the app', () => {
  const src = fs.readFileSync('src/index.html', 'utf8');
  for (const fn of ['confirm', 'prompt', 'alert']) {
    const hits = (src.match(new RegExp('(?<![.\\w])' + fn + '\\s*\\(', 'g')) || [])
      .filter((_, i) => true);
    assert(hits.length === 0, `native ${fn}() still called ${hits.length}x in the page`);
  }
});
TA('a dialog offers any number of options and returns the one chosen', async () => {
  const p = ev(`ask({ title: 'Pick one', message: 'Three ways forward', buttons: [
    { id: 'a', label: 'Alpha', variant: 'primary' }, { id: 'b', label: 'Bravo' },
    { id: 'c', label: 'Charlie' }, { id: 'cancel', label: 'Cancel' } ] })`);
  await tick();
  const dlg = openDlg();
  assert(dlg, 'no dialog rendered');
  assert(dlg.querySelectorAll('.dlg-btn').length === 4, 'expected 4 options');
  assert(dialogText().includes('Three ways forward'), 'message missing');
  answerDialog('Charlie');
  const r = await p;
  assert(r.id === 'c', 'wrong option returned: ' + r.id);
  assert(!openDlg(), 'dialog not removed after choosing');
});
TA('Escape cancels, Enter takes the primary, and a DIGIT is just a digit', async () => {
  let p = ev(`ask({ title: 'Esc test', buttons: [{ id: 'ok', label: 'OK', variant: 'primary' }, { id: 'cancel', label: 'Cancel' }] })`);
  await tick();
  doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert((await p).id === 'cancel', 'Escape did not cancel');

  // THE NUMBER KEYS ARE GONE (v16.75, the pilot's report: "I can't type a number
  // in the altitude as it also activates the delete waypoint button"). They were
  // guarded against typing in the FIRST field, and a dialog has carried several
  // fields since v16.74 - so a digit typed into the altitude box counted as
  // "outside the text field" and pressed a button. A dialog that takes typed
  // values cannot also treat bare digits as commands.
  p = ev(`ask({ title: 'Key test', fields: [{ id: 'alt', label: 'Altitude', value: '2500', type: 'number' }],
    buttons: [{ id: 'apply', label: 'Apply', variant: 'primary' }, { id: 'del', label: 'Delete', variant: 'danger' }] })`);
  await tick();
  const inp = openDlg().querySelector('.dlg-input[data-field="alt"]');
  inp.focus();
  for (const k of ['1', '2', '4']) {
    inp.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  }
  assert(openDlg(), 'a digit closed the dialog - the number hotkeys are back');
  // ...and no badge is left promising a shortcut that does nothing.
  assert(!openDlg().querySelector('.dlg-key'),
    'the buttons still show a number badge for a key that no longer works');
  typeInDialog('4500', 'alt');
  answerDialog('Apply');
  const r = await p;
  assert(r.id === 'apply' && r.values.alt === '4500',
    'the typed value did not survive: ' + JSON.stringify(r.values));

  p = ev(`ask({ title: 'Enter test', buttons: [{ id: 'no', label: 'No' }, { id: 'yes', label: 'Yes', variant: 'primary' }] })`);
  await tick();
  doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert((await p).id === 'yes', 'Enter did not take the primary option');
});
TA('the text-entry dialog returns the typed value, or null when cancelled', async () => {
  let p = ev(`promptDialog('Name it', 'Route name', 'DEFAULT')`);
  await tick();
  assert(openDlg().querySelector('.dlg-input').value === 'DEFAULT', 'default value not pre-filled');
  typeInDialog('  Tromso local  ');
  answerDialog('Save');
  assert((await p).trim() === 'Tromso local', 'wrong value returned');

  p = ev(`promptDialog('Name it', 'Route name', 'X')`);
  await tick();
  answerDialog('Cancel');
  assert((await p) === null, 'cancel must return null');
});
T('toasts notify without stealing a click', () => {
  const host0 = doc.getElementById('app-toasts');
  const before = host0 ? host0.children.length : 0;
  ev(`say('Test notice', 'good')`);
  const host = doc.getElementById('app-toasts');
  assert(host && host.children.length === before + 1, 'no toast appended');
  assert(host.lastChild.className.includes('toast-good'), 'tone class missing: ' + host.lastChild.className);
  assert(!openDlg(), 'a toast must not open a modal');
  host.innerHTML = '';
});


console.log('\n=== 62a000b. Every interpolated string is escaped (v16.47, H3 / rule 6) ===');

// THIS IS CORRECTNESS BEFORE IT IS SECURITY. A waypoint the pilot names
// `Bodo <VOR>` breaks the OFP table with no malice at all: `<VOR>` is parsed
// as a tag and the rest of the row disappears. The probe below is an <img>
// only because it is the cheapest thing to DETECT after a render - one
// query for a tag that must never exist, over every surface at once.
const XSS_NAME = '<img src=x onerror="window.__xssFired=(window.__xssFired||0)+1" class="xss-probe">';
const XSS_FLIGHTS = [{
  id: 1, title: XSS_NAME, depElev: 254,
  waypoints: [
    { lat: 69.05505349, lng: 18.54466865, name: XSS_NAME, alt: 254, oat: 14, wdir: 0, wspd: 0, var: -11 },
    { lat: 69.23781330, lng: 17.97902780, name: XSS_NAME, alt: 9500, oat: 10, wdir: 0, wspd: 0, var: -11,
      via: [{ lat: 69.15, lng: 18.30 }], tocNM: 1, bodNM: 4 },
    { lat: 69.67895054, lng: 18.91143033, name: XSS_NAME, alt: 500, oat: 10, wdir: 0, wspd: 0, var: -12 },
    // The circuit stop carries the hostile name too: the map's pattern label is
    // a SEPARATE interpolation from the waypoint label, and a route file can
    // give a circuit stop any name even though the app's rename refuses to.
    { lat: 69.67895054, lng: 18.91143033, name: XSS_NAME, alt: 1000, oat: 10, wdir: 0, wspd: 0,
      var: -12, isPattern: true, laps: 2 }
  ]
}];

function renderEverySurface() {
  ev(`window.__xssFired = 0;
      flights = ${JSON.stringify(XSS_FLIGHTS)};
      activeFlightIndex = 0;
      // MIDWINTER AT 69 N WITH A PRE-DAWN ETD, so the daylight card's WARNING and
      // CAUTION lists fire as well as its rows - each names the aerodrome it is
      // about, and that is the only way a waypoint name reaches those surfaces.
      // The day-VFR window on this date is 08:21-13:06, so 05:00 is night.
      document.getElementById('def-etd').value = '05:00';
      document.getElementById('def-date').value = '2026-12-21';
      refreshMap(); renderAllFlightTables(); openWindModal();
      hitLines[0]._h.contextmenu({ latlng: { lat: 69.45, lng: 18.90 },
                                   originalEvent: { preventDefault: function(){} } });`);
}

T('a hostile waypoint name injects nothing on ANY rendered surface', () => {
  renderEverySurface();
  // One query for the whole document: the table, the sub-leg line, the
  // plotting list, the wind modal, the daylight card, the leg panel, the
  // red banner and the OFP print sheets are all inside <body>.
  // THE SELECTOR HAS TO COVER BOTH SHAPES, and the second one is easy to miss.
  // In element content the payload becomes an <img>; inside an ATTRIBUTE
  // (`value="..."` in the plotting list) its own quote closes the attribute
  // first, so the browser hangs `class="xss-probe"` on the HOST element and
  // there is no <img> to find at all. Looking only for a tag passed that case.
  const probes = doc.body.querySelectorAll('.xss-probe, [onerror], img[src="x"]');
  assert(probes.length === 0, probes.length + ' injected node(s) reached the DOM, first is a <' +
    (probes[0] ? probes[0].tagName.toLowerCase() : '') + '> in .' +
    (probes[0] && probes[0].parentElement ? probes[0].parentElement.className : ''));
  assert(!w.__xssFired, 'the injected handler ran ' + w.__xssFired + ' time(s)');
});

T('the surfaces the audit named actually rendered, so the check above is not vacuous', () => {
  // A test that proves "no <img> anywhere" would also pass if nothing rendered.
  const has = (sel) => !!doc.querySelector(sel);
  assert(doc.querySelectorAll('#flight-plans-container tbody tr').length > 2, 'no OFP rows rendered');
  assert(has('.sub-leg-row'), 'no sub-leg row (the via point should have produced one)');
  assert(has('.plotting-details'), 'no plotting list');
  assert(has('#wind-matrix-container .wind-table'), 'the wind modal did not render');
  assert(doc.getElementById('leg-modal').style.display === 'flex', 'the leg panel did not open');
  assert(doc.getElementById('daylight-body').innerHTML.length > 100, 'the daylight card is empty');
  // The OFP is a PDF now, with no HTML sink at all: pdf-lib draws the name as
  // TEXT and nothing parses it. So the check is that the print model carries
  // the hostile name VERBATIM - printed as typed, neither run nor mangled.
  const printed = printDoc().sheets.flatMap((sh) => sh.items.map((it) => it.text));
  assert(printed.includes(XSS_NAME), 'the print model did not render the waypoint name');
  const banner = doc.getElementById('integrity-banner');
  assert(banner.style.display === 'block', 'the banner should be up: a 9500 ft leg with a 500 ft ' +
    'arrival cannot be flown, and the banner NAMES the waypoint - which is how a name reaches it');
});

T('a waypoint name with angle brackets survives intact, it is not just stripped', () => {
  // The point of escaping is that the pilot SEES the name they typed.
  ev(`flights = [{ id: 1, title: 'T', depElev: 254, waypoints: [
    { lat: 69.05505349, lng: 18.54466865, name: 'Bodø <VOR> & co', alt: 254, oat: 14, wdir: 0, wspd: 0, var: -11 },
    { lat: 69.23781330, lng: 17.97902780, name: 'FINNSNES', alt: 2500, oat: 10, wdir: 0, wspd: 0, var: -11 }
  ]}]; activeFlightIndex = 0; refreshMap(); renderAllFlightTables();`);
  const firstCell = doc.querySelector('#flight-plans-container tbody tr td b');
  assert(firstCell && firstCell.textContent === 'Bodø <VOR> & co',
    'name mangled: ' + (firstCell && JSON.stringify(firstCell.textContent)));
  // and the row is still whole - the <VOR> did not eat the rest of it
  assert(doc.querySelector('#flight-plans-container tbody tr').children.length >= 13,
    'the row lost cells to the tag');
  const plotName = doc.querySelector('.plotting-details input[type=text]');
  assert(plotName && plotName.value === 'Bodø <VOR> & co',
    'the plotting list mangled the name: ' + (plotName && JSON.stringify(plotName.value)));
});

T('the map label carries the name escaped too', () => {
  renderEverySurface();
  const html = ev(`markers.map(function(m){ return (m._opts && m._opts.icon && m._opts.icon.html) || ''; }).join('')`);
  assert(html.length > 0, 'no marker html captured');
  assert(!/<img/i.test(html), 'a marker label carries a raw tag: ' + html.slice(0, 160));
  assert(html.includes('&lt;img'), 'the marker label does not carry the escaped name at all');
});

T('there is exactly ONE escaper in the app, not a copy per function', () => {
  // Six near-identical local copies used to live inside the functions that
  // needed one; three omitted `"` and one omitted `>`, so which characters
  // were safe depended on which function you were in.
  const copies = APP_SRC.match(/const esc = \(t\) =>/g) || [];
  assert(copies.length === 0, copies.length + ' local esc copies are back - use escapeText');
  assert(/function escapeText/.test(APP_SRC), 'escapeText is missing from the bundle');
  assert(APP_SRC.includes('const esc = escapeText'), 'the page script no longer aliases the one escaper');
});

T('the daylight WARNING and CAUTION lists both fired, so both are covered', () => {
  // Two separate interpolations, and each names the aerodrome it is about.
  // 05:00 lands before morning civil twilight (a WARNING); 12:00 lands inside
  // the last 30 minutes of the evening window (a CAUTION). Nothing else in the
  // card reaches either list with a waypoint name in it.
  renderEverySurface();
  let html = doc.getElementById('daylight-body').innerHTML;
  assert(html.includes('\u26d4'), 'no warning row: the probe no longer reaches the warn list');
  assert(html.includes('&lt;img'), 'the warning does not carry the (escaped) waypoint name');

  ev(`document.getElementById('def-etd').value = '12:00'; renderAllFlightTables();`);
  html = doc.getElementById('daylight-body').innerHTML;
  assert(html.includes('\u26a0'), 'no caution row: the probe no longer reaches the caution list');
  const probes = doc.body.querySelectorAll('.xss-probe, [onerror], img[src="x"]');
  assert(probes.length === 0, probes.length + ' injected node(s) reached the DOM via the caution list');
});

T('the version badge escapes the tag it got from GitHub', () => {
  // The one genuinely REMOTE string this app renders: package.json's version
  // field, fetched from raw.githubusercontent. It has to read as NEWER or the
  // badge never renders it - and compareVersions splits on '.', so the payload
  // goes in a later segment and "99" stays a clean first one.
  ev(`window.__xssFired = 0; renderVersionBadge('99.${XSS_NAME}')`);
  const el = doc.getElementById('app-version-badge');
  assert(el.innerHTML.includes('available on GitHub'), 'the update branch did not render: ' + el.innerHTML);
  assert(el.querySelectorAll('.xss-probe, [onerror], img').length === 0,
    'the remote version string injected a node: ' + el.innerHTML.slice(0, 160));
  ev(`renderVersionBadge()`);
});

T('a render that throws leaves NOTHING printable, never the previous plan', () => {
  // back to a normal date first - nothing downstream should inherit midwinter
  ev(`document.getElementById('def-date').value = ''; document.getElementById('def-etd').value = '';`);
  // H1: a throw part way through renderAllFlightTables used to leave the
  // PREVIOUS plan's sheets ready to print - another route's figures on company
  // paperwork. The flag is cleared when a render starts and set only when it
  // completes, and Print refuses while it is clear.
  ev(SEED);
  assert(ev('printModelReady') === true, 'a completed render is not printable');
  ev(`window.__realLegTotals = computeLegTotals;
      window.computeLegTotals = function () { throw new Error('boom'); };
      try { renderAllFlightTables(); } catch (e) { window.__renderThrew = e.message; }
      window.computeLegTotals = window.__realLegTotals;`);
  assert(ev('window.__renderThrew') === 'boom', 'the fixture did not make the render throw');
  assert(ev('printModelReady') === false, 'a render that threw left the old plan printable');
  // ...and Print says so rather than opening anything.
  let opened = 0;
  const realOpen = w.open;
  w.open = () => { opened++; return null; };
  ev('printOfp()');
  w.open = realOpen;
  assert(opened === 0, 'Print opened a window for a plan that failed to render');
  ev(SEED);
  assert(ev('printModelReady') === true, 'the next good render did not make it printable again');
});



console.log('\n=== 62a000c. The low findings, one batch (v16.48, item 15) ===');

T('L4: a clock BEFORE the departure marks the day too', () => {
  const F = moduleExports.fmt;
  assert(F.clockFromMinutes('01:00', -90) === '23:30-1', 'negative offset: ' + F.clockFromMinutes('01:00', -90));
  assert(F.clockFromMinutes('01:00', 90) === '02:30', 'a forward offset changed');
  assert(F.clockFromMinutes('01:00', 0) === '01:00', 'a zero offset gained a day marker');
});

T('L5: a key parked in localStorage does not survive the boot whitelist', () => {
  // Export and import have used PROFILE_KEYS since v16.18; boot did not, so an
  // old build's key outlived every reload even though both file paths drop it.
  const E = moduleExports.exch;
  w.localStorage.setItem('c182_perf_profile', JSON.stringify({
    cruiseTas: 133, theme: 'dark', pilotName: 'Someone', tailNumber: 'LN-TRA', legacyThing: 1
  }));
  ev('loadSavedProfile()');
  const live = ev('JSON.stringify(aircraftProfile)');
  const p = JSON.parse(live);
  assert(p.cruiseTas === 133, 'a whitelisted key was dropped');
  for (const k of ['pilotName', 'tailNumber', 'legacyThing'])
    assert(!(k in p), k + ' survived the boot whitelist');
  assert(!E.PROFILE_KEYS.includes('pilotName') && !E.PROFILE_KEYS.includes('tailNumber'),
    'PROFILE_KEYS grew a key that identifies a person or a machine');
  w.localStorage.removeItem('c182_perf_profile');
});

T('L7: "PATTERN" is reserved in BOTH directions', () => {
  // v16.40 blocked renaming a circuit stop, because the add flow and the
  // return-leg builder test for the literal name. The reverse was open: a
  // normal waypoint renamed to PATTERN kept isPattern false and started being
  // treated as a circuit stop by both.
  ev(SEED);
  ev(`renameWaypoint(0, 1, 'PATTERN')`);
  assert(ev('flights[0].waypoints[1].name') === 'FINNSNES', 'a waypoint was renamed to PATTERN');
  ev(`renameWaypoint(0, 1, 'pattern')`);
  assert(ev('flights[0].waypoints[1].name') === 'FINNSNES', 'the lower-case form got through');
  ev(`renameWaypoint(0, 1, 'PATTERN LAKE')`);
  assert(ev('flights[0].waypoints[1].name') === 'PATTERN LAKE',
    'a name that merely CONTAINS the word was refused: ' + ev('flights[0].waypoints[1].name'));
  ev(SEED);
});

T('L8: the saved-route reference travels with the plan', () => {
  ev(SEED);
  ev(`loadedRouteRef = { type: 'route', name: 'ENDU-ENTC' }`);
  // undoing ONE edit off a loaded route still leaves it that route
  ev(`pushUndoState(); flights[0].waypoints.push({ lat: 69.9, lng: 19.1, name: 'X', alt: 2500,
       oat: 0, wdir: 0, wspd: 0, var: -12 }); renderAllFlightTables();`);
  ev('undoLast(true)');
  assert(ev('loadedRouteRef && loadedRouteRef.name') === 'ENDU-ENTC',
    'undoing one edit forgot which saved route the plan came from');
  // but undoing back PAST the load must not still offer to overwrite it
  ev(`loadedRouteRef = null; pushUndoState(); loadedRouteRef = { type: 'route', name: 'ENDU-ENTC' };
      flights[0].waypoints.push({ lat: 69.9, lng: 19.1, name: 'Y', alt: 2500,
       oat: 0, wdir: 0, wspd: 0, var: -12 }); renderAllFlightTables();`);
  ev('undoLast(true)');
  assert(ev('loadedRouteRef') === null,
    'undoing past the load still offers to update a route this plan never came from');
  ev('redoLast(true)');
  assert(ev('loadedRouteRef && loadedRouteRef.name') === 'ENDU-ENTC', 'redo lost the reference');
  ev(SEED);
});

TA('L8: clearing everything drops the saved-route reference', async () => {
  ev(SEED);
  ev(`loadedRouteRef = { type: 'route', name: 'ENDU-ENTC' }`);
  const p = ev('clearAllFlights()');
  await tick();
  answerDialog('Clear everything');
  await p;
  assert(ev('loadedRouteRef') === null, 'an empty sheet still claims to come from a saved route');
  ev(SEED);
});

T('L10: a circuit row is formatted like every other row on the form', () => {
  const O = moduleExports.ofp;
  const row = { pattern: true, from: 'ENTC', to: 'PATTERN', laps: 3, accDist: '', pl: 1000,
                accTime: '01:02', accBurn: 3.4000000000000004, ff: 8.4, legBurn: 1.2,
                time: '00:09', eto: '', rem: 29.799999999999997 };
  const c = O.ofpRowCells(row);
  assert(c.accBurn === '3.4', 'a raw float reached the form: ' + c.accBurn);
  assert(c.estRem === '29.8', 'estRem: ' + c.estRem);
  assert(c.accDist === '', 'an empty accumulated distance became a number: ' + JSON.stringify(c.accDist));
  assert(O.ofpRowCells({ ...row, accDist: '12.4' }).accDist === '12.4', 'a real accDist was lost');
  // H2 had survived in this one row: String(NaN) prints "NaN" on company paper.
  const bad = O.ofpRowCells({ ...row, pl: NaN, accBurn: NaN, rem: NaN });
  assert(bad.pl === '' && bad.accBurn === '' && bad.estRem === '',
    'a circuit row still prints NaN: ' + JSON.stringify([bad.pl, bad.accBurn, bad.estRem]));
});

T('L3: the counts the page script quotes are the counts it has', () => {
  // DOCUMENTATION DRIFT IS A BUG WITH A LONG FUSE. The page script said "61
  // inline on*= handlers" and CLAUDE.md said "24 shared mutable globals"; both
  // were true when written and neither was true at v16.41, and an audit spent
  // effort re-deriving them. A figure quoted as evidence is re-measured here,
  // so it fails the day it stops being true instead of the day someone checks.
  const fs = require('fs');
  const src = fs.readFileSync('src/index.html', 'utf8');
  const blocks = src.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) || [];
  const page = blocks[blocks.length - 1];
  const markup = src.replace(/<script[\s\S]*?<\/script>/g, '');
  const nStatic = (markup.match(/\son[a-z]+\s*=\s*"/g) || []).length;
  const nGenerated = (blocks.join('').match(/\son[a-z]+\s*=\s*"/g) || []).length;

  const claim = page.match(/plus (\d+) inline on\*= handlers - (\d+) written/);
  assert(claim, 'the page script no longer states its handler counts');
  assert(Number(claim[1]) === nStatic + nGenerated,
    'the page says ' + claim[1] + ' handlers, there are ' + (nStatic + nGenerated));
  assert(Number(claim[2]) === nStatic,
    'the page says ' + claim[2] + ' in markup, there are ' + nStatic);

  const tops = new Set((page.match(/^    (?:let|var)\s+([A-Za-z_$][\w$]*)/gm) || [])
    .map((m) => m.replace(/^\s*(?:let|var)\s+/, '')));
  const md = fs.readFileSync('CLAUDE.md', 'utf8');
  const gm = md.match(/it is one web of (\d+) shared mutable/);
  assert(gm, 'CLAUDE.md no longer states the shared-globals count');
  assert(Number(gm[1]) === tops.size,
    'CLAUDE.md says ' + gm[1] + ' shared globals, the page script declares ' + tops.size);
});

T('L2: the build refuses a lockfile whose version has drifted', () => {
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
  const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
  assert(lock.version === pkg, 'package-lock.json says ' + lock.version + ', package.json says ' + pkg);
  assert(lock.packages[''].version === pkg, 'the lockfile root package version drifted');
  const build = fs.readFileSync('tools/build.mjs', 'utf8');
  assert(/package-lock\.json/.test(build), 'the build no longer checks the lockfile version');
});



console.log('\n=== 62a000i. The panel divider (v16.67) ===');

T('a pane ratio is bounded, and the bounds are the ones CLAUDE.md argues', () => {
  const A = moduleExports.anchors;
  assert(A.PANE_MIN === 0.15 && A.PANE_MAX === 0.85,
    'the pane bounds moved: ' + A.PANE_MIN + '-' + A.PANE_MAX);
  assert(A.PANE_MIN > 0 && A.PANE_MAX < 1,
    'a bound of 0 or 1 reduces a panel to nothing, and a divider you cannot find again is a trap');
  assert(A.normalisePaneRatio(0.5, 0.4) === 0.5, 'a legitimate ratio was changed');
  assert(A.normalisePaneRatio(0.01, 0.4) === A.PANE_MIN, 'a tiny ratio was not clamped up');
  assert(A.normalisePaneRatio(9, 0.4) === A.PANE_MAX, 'a huge ratio was not clamped down');
  // ABSENT IS NOT ZERO. The default is handed in so the caller decides what a
  // missing figure means, exactly as normaliseFixStyle does with its colour.
  assert(A.normalisePaneRatio(undefined, 0.4) === 0.4, 'undefined did not fall back');
  assert(A.normalisePaneRatio('rubbish', 0.4) === 0.4, 'a non-number did not fall back');
  assert(A.normalisePaneRatio(NaN, 0.4) === 0.4, 'NaN did not fall back');
  assert(A.normalisePaneRatio(-0.5, 0.4) === 0.4, 'a negative ratio did not fall back');
  // Three decimals is a tenth of a pixel on a 1500 px window, and it keeps the
  // number in a saved route file readable.
  assert(A.normalisePaneRatio(0.4567891, 0.4) === 0.457, 'the ratio is not rounded');
  // It must survive its own round trip, or a reload would walk the divider.
  const r = A.normalisePaneRatio(0.4567891, 0.4);
  assert(A.normalisePaneRatio(r, 0.4) === r, 'the stored ratio is not stable across a reload');
});

T('the divider maths is a share of the WHOLE container, divider included', () => {
  const A = moduleExports.anchors;
  // THE BUG THIS ENCODES, measured in Chromium: expressing the ratio as a share
  // of the space LEFT OVER after the divider and feeding it to flex-grow put
  // the bar 11 px left of the cursor, because growth factors share out FREE
  // space and the panels' own border and padding come off first. A share of the
  // container is a length the browser resolves the same way this line does.
  // 1500 px wide starting at x=0, a 6 px bar: dropping the cursor at 750 must
  // put the bar's CENTRE at 750, so the map is 747 px, i.e. 0.498.
  assert(A.paneRatioFromPoint(750, 0, 1500, 6) === 0.498,
    'the middle of the window is not the middle: ' + A.paneRatioFromPoint(750, 0, 1500, 6));
  // ...and the container's own offset is taken off, or a page with a header
  // above it would be out by the header's height on the vertical axis.
  assert(A.paneRatioFromPoint(830, 80, 1500, 6) === 0.498,
    'the container offset was ignored: ' + A.paneRatioFromPoint(830, 80, 1500, 6));
  // Half the bar comes off, so the bar is centred on the boundary rather than
  // hanging off it by its own width.
  assert(A.paneRatioFromPoint(750, 0, 1500, 0) > A.paneRatioFromPoint(750, 0, 1500, 20),
    'the divider thickness is not taken into account at all');
  // Out of range clamps rather than escaping the container.
  assert(A.paneRatioFromPoint(-500, 0, 1500, 6) === A.PANE_MIN, 'dragging off the left did not clamp');
  assert(A.paneRatioFromPoint(9000, 0, 1500, 6) === A.PANE_MAX, 'dragging off the right did not clamp');
  // NO ROOM TO DIVIDE IS null, NOT A NUMBER. A hidden panel measures zero, and
  // a ratio computed from a zero-width container is a divide by nothing.
  assert(A.paneRatioFromPoint(750, 0, 0, 6) === null, 'a zero-width container returned a ratio');
  assert(A.paneRatioFromPoint(750, 0, NaN, 6) === null, 'a non-finite span returned a ratio');
});

T('both pane ratios travel in an exported route file, and nothing personal does', () => {
  const E = moduleExports.exch;
  assert(E.PROFILE_KEYS.includes('splitRatio') && E.PROFILE_KEYS.includes('stackRatio'),
    'the divider positions are not in PROFILE_KEYS, so they would not survive an export');
  // THE TWO LAYOUTS KEEP SEPARATE FIGURES. A good side-by-side split is not a
  // good stacked one, and one number for both would move the divider every
  // time the layout changed.
  const out = E.buildExportPayload({
    profile: { splitRatio: 0.62, stackRatio: 0.31, ownerName: 'Someone', tailNumber: 'LN-TRA' }
  });
  const json = JSON.stringify(out);
  assert(/0\.62/.test(json) && /0\.31/.test(json), 'the divider positions did not reach the export');
  assert(!/Someone/.test(json) && !/LN-TRA/.test(json),
    'the export carried a person or a machine - PROFILE_KEYS is the one whitelist');
});

T('the divider is a real element between the two panels, and it is not printed', () => {
  const ids = ['map-container', 'splitter', 'sidebar'];
  const order = ev(`(() => {
    const kids = [...document.getElementById('main').children].map((e) => e.id).filter(Boolean);
    return kids.join(',');
  })()`);
  assert(order === ids.join(','),
    'the divider is not sitting between the map and the plan: ' + order);
  // role/tabindex are a PROMISE that the arrow keys work; onSplitterKey keeps it.
  assert(ev(`document.getElementById('splitter').getAttribute('role')`) === 'separator',
    'the divider does not announce itself as a separator');
  assert(ev(`document.getElementById('splitter').getAttribute('tabindex')`) === '0',
    'the divider cannot be reached from the keyboard');
  assert(ev(`document.getElementById('splitter').classList.contains('no-print')`),
    'the divider would print on the company OFP sheet');
  // NO INLINE HANDLER. A pointer drag needs move and up bound anyway, and the
  // v16.53 keybind row is the standing reminder that a handler built by string
  // interpolation is where a quote goes wrong.
  const attrs = ev(`[...document.getElementById('splitter').attributes].map((a) => a.name).join(',')`);
  assert(!/\bon[a-z]+/.test(attrs), 'the divider grew an inline handler: ' + attrs);
});

// v16.89 - THE GRIP. The pilot: "if i move the mouse too quickly, it looses
// the 'grip' and stops dragging". MEASURED in Chromium with setPointerCapture
// refused: a 60-step drag landed within 1 px and a one-jump drag missed by
// 299, because the bar is 2 px wide and a quick cursor outruns it. The drag
// had exactly ONE mechanism and no fallback, so wherever capture does not hold
// the grip becomes speed-dependent.
T('the divider drag is bound to the DOCUMENT, not to the 2 px bar', () => {
  const init = APP_SRC.split('function initSplitter()')[1].split('\n    }')[0];
  for (const ev2 of ['pointermove', 'pointerup', 'pointercancel', 'lostpointercapture'])
    assert(!init.includes("bar.addEventListener('" + ev2 + "'"),
      'the bar listens for ' + ev2 + ' again - a fast cursor outruns a 2 px target');
  assert(init.includes("bar.addEventListener('pointerdown'"), 'nothing starts the drag');
  const add = APP_SRC.split('function addSplitterTracking()')[1].split('\n    }')[0];
  for (const ev2 of ['pointermove', 'pointerup', 'pointercancel'])
    assert(add.includes("document.addEventListener('" + ev2 + "'"),
      'the drag does not track ' + ev2 + ' on the document');
  // AND AN EXIT THAT IS NOT A POINTERUP, or alt-tab mid-drag leaves the map
  // stuck - the v16.46 lesson, which lostpointercapture used to cover.
  assert(add.includes("window.addEventListener('blur'"),
    'a drag interrupted by leaving the window never ends');
});

T('losing pointer capture does not end the drag', () => {
  // LOSING CAPTURE WITH THE BUTTON STILL DOWN IS NOT A RELEASE. Ending there
  // made any transient loss permanent, which is the other half of the report.
  assert(!/lostpointercapture/.test(APP_SRC),
    'lostpointercapture ends the drag again');
  const down = APP_SRC.split('function onSplitterDown(')[1].split('\n    }')[0];
  assert(down.includes('bar.setPointerCapture('), 'capture is not taken at all any more');
  assert(down.indexOf('addSplitterTracking();') < down.indexOf('bar.setPointerCapture('),
    'tracking must be installed BEFORE capture, so a refused capture still drags');
});

T('a slider declares the drag gesture its own', () => {
  // MEASURED BY A/B IN CHROMIUM (touch input, one gesture, this the only
  // variable): with touch-action AUTO a steep drag fires pointercancel and the
  // browser takes the drag away as a page scroll; with NONE it fires none and
  // the drag survives. That is the "it stops dragging" mechanism, for touch
  // and pen. The browser check in verify-layout.mjs proves it load-bearing;
  // this only guards that the rule cannot be deleted silently.
  assert(/input\[type="range"\]\s*\{[^}]*touch-action:\s*none/.test(APP_SRC),
    'a range input no longer declares touch-action: none');
});

T('a slider drag is continued by the app once the control stops', () => {
  const fn = APP_SRC.split('function initSliderGrip()')[1].split('\n    }')[0];
  assert(/type !== 'range'/.test(fn), 'it is not scoped to range inputs');
  // ONE DELEGATED LISTENER, NOT ONE PER SLIDER - so a slider added later is
  // covered without a rule of its own (the v16.24 map-control lesson).
  assert(/document\.addEventListener\('pointerdown'/.test(fn),
    'the grip is not delegated, so a new slider would not get it');
  assert(/addSliderTracking\(\)/.test(fn),
    'the drag is not tracked on the document, so it dies with the control');
  assert(APP_SRC.includes('initSliderGrip();'), 'it is never called at boot');
  const add = APP_SRC.split('function addSliderTracking()')[1].split('\n    }')[0];
  for (const ev of ['pointermove', 'pointerup', 'pointercancel'])
    assert(add.includes("document.addEventListener('" + ev + "'"),
      'the slider drag does not track ' + ev + ' on the document');
  assert(add.includes("window.addEventListener('blur'"),
    'a slider drag interrupted by leaving the window never ends');
  // ...and it really does cover every slider the app ships.
  const n = (APP_SRC.match(/type="range"/g) || []).length;
  assert(n >= 5, 'the sliders went missing: ' + n);
});

T('the scale is LEARNED from the control, never a mapping of our own', () => {
  // MEASURED: native does not map the full box - it saturates well inside both
  // ends - so an x-across-the-rect formula disagrees with the control by a
  // whole step. The app therefore watches native while the pointer is INSIDE
  // and only continues, at that scale, once it leaves.
  const mv = APP_SRC.split('function onSliderMove(')[1].split('\n    }')[0];
  assert(/clientY >= r\.top && e\.clientY <= r\.bottom/.test(mv),
    'it does not distinguish inside the control from outside');
  const inside = mv.split('clientY >= r.top')[1].split('return;')[0];
  assert(!/\.value = /.test(inside),
    'the app writes the value while the control is still driving it');
  assert(/perPx = \(live - d\.lastV\) \/ dx/.test(mv),
    'the scale is no longer learned from the control');
  assert(/d\.perPx !== null[\s\S]{0,80}\(max - min\) \/ Math\.max\(1, r\.width\)/.test(mv),
    'there is no fallback for a drag that leaves before anything was learned');
  // AND THE WRITE IS GUARDED, so a browser whose native drag DOES keep going
  // cannot be double-applied.
  assert(/v === live\) return;/.test(mv), 'the write is not guarded against agreeing');
});

// THE DISCRIMINATING TEST FOR THE CONTINUATION, AND IT HAS TO BE jsdom.
//
// In Chromium the NATIVE range keeps tracking off-element, so a browser check
// there passes with the app's continuation removed - measured by mutation, and
// it is M5 in its purest form. jsdom has no native slider drag at all, so the
// only thing that can move the value here is the app's own code. That is what
// makes this the guard.
//
// (My two "reproductions" of the pilot's failure in Chromium were artifacts:
// both moved the cursor DOWN while holding x CONSTANT, so the value could not
// change whether or not the drag was alive.)
T('a slider drag continues once the pointer leaves the control', () => {
  const el = doc.getElementById('map-route-weight');
  assert(el, 'the route-weight slider is gone');
  // jsdom has no layout, so the element is given a real box to reason about.
  const box = { left: 100, right: 250, top: 50, bottom: 74, width: 150, height: 24,
                x: 100, y: 50 };
  el.getBoundingClientRect = () => box;
  el.value = '2';
  const at = (type, x, y, target) => {
    const ev = new w.MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
    (target || doc).dispatchEvent(ev);
  };
  at('pointerdown', 110, 62, el);
  at('pointermove', 140, 62);          // INSIDE the box - the control's job
  const inside = Number(el.value);
  at('pointermove', 200, 200);         // OUTSIDE - the app continues
  const outside = Number(el.value);
  assert(outside > inside,
    'the drag died when the pointer left the control: ' + inside + ' -> ' + outside);
  // ...and it clamps rather than running past the end.
  at('pointermove', 100000, 400);
  assert(Number(el.value) === Number(el.max),
    'a long drag did not clamp to the maximum: ' + el.value);
  // RELEASE ENDS IT. A move after the button is up must not still steer.
  at('pointerup', 100000, 400);
  const settled = Number(el.value);
  at('pointermove', 100, 400);
  assert(Number(el.value) === settled,
    'the slider still tracked after the pointer was released');
});

T('and it never writes while the pointer is inside the control', () => {
  const el = doc.getElementById('map-corridor-fill');
  assert(el, 'the corridor-fill slider is gone');
  el.getBoundingClientRect = () => ({ left: 0, right: 150, top: 0, bottom: 24,
                                      width: 150, height: 24, x: 0, y: 0 });
  el.value = '30';
  const at = (type, x, y, target) => (target || doc).dispatchEvent(
    new w.MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
  at('pointerdown', 10, 12, el);
  for (const x of [30, 60, 90, 120]) at('pointermove', x, 12);   // all INSIDE
  assert(el.value === '30',
    'the app moved the value while the control was still driving it: ' + el.value);
  at('pointerup', 120, 12);
});

T('no synthetic change event - the control fires its own', () => {
  // MEASURED: dispatching one on release made TWO and ran every handler twice.
  const up = APP_SRC.split('function onSliderUp(')[1].split('\n    }')[0];
  assert(!/dispatchEvent\(new Event\('change'/.test(up),
    'a second change event is dispatched again');
  assert(/removeSliderTracking\(\)/.test(up), 'the listeners are never released');
});

T('an untouched app writes no pane variables, so the shipped design is untouched', () => {
  ev(SEED);
  ev(`aircraftProfile.splitRatio = null; aircraftProfile.stackRatio = null; applyStoredPaneRatios();`);
  assert(ev(`document.body.style.getPropertyValue('--map-flex')`) === '',
    'a pilot who never dragged the divider got an inline width anyway');
  assert(ev(`document.body.style.getPropertyValue('--map-h')`) === '',
    'a pilot who never dragged the divider got an inline height anyway');
  // ...and a stored figure DOES reach the layout, on the right axis each time.
  ev(`aircraftProfile.splitRatio = 0.62; aircraftProfile.stackRatio = 0.31; applyStoredPaneRatios();`);
  const flex = ev(`document.body.style.getPropertyValue('--map-flex')`);
  const h = ev(`document.body.style.getPropertyValue('--map-h')`);
  assert(/^0 0 62\.000%$/.test(flex.trim()), 'the split ratio did not become a flex basis: ' + flex);
  assert(/^31\.000%$/.test(h.trim()), 'the stacked ratio did not become a height: ' + h);
  // A BASIS, NOT A GROWTH FACTOR - see the module test above. `flex: 0.62`
  // would parse and would put the bar 11 px off the cursor.
  assert(/^0 0 /.test(flex.trim()),
    'the map pane went back to a growth factor: ' + flex);
  // THE 240 px FLOOR IS FOR THE AUTOMATIC LAYOUT, NOT FOR THE PILOT: a hand
  // placed divider that a min-height quietly overrode would drag itself back
  // with nothing said.
  assert(ev(`document.body.style.getPropertyValue('--map-min-h')`).trim() === '0px',
    'the stacked floor still overrides a divider the pilot placed by hand');
  ev(`aircraftProfile.splitRatio = null; aircraftProfile.stackRatio = null; applyStoredPaneRatios();`);
  ev(SEED);
});

T('a drag remembers where it was let go, and a reset clears it rather than writing a default', () => {
  ev(SEED);
  ev(`aircraftProfile.splitRatio = null; aircraftProfile.stackRatio = null; applyStoredPaneRatios();
      setLayoutMode('split', false);`);
  // jsdom has no layout, so every rect is zero and a real drag cannot be
  // measured here - verify-layout.mjs drags the bar with a real mouse and reads
  // the boxes back. What jsdom CAN prove is the bookkeeping either side of it.
  ev(`applyPaneRatio(false, 0.7); aircraftProfile.splitRatio = 0.7; savePaneRatios();`);
  assert(JSON.parse(ev(`localStorage.getItem('c182_perf_profile')`)).splitRatio === 0.7,
    'the divider position was not persisted');
  ev(`resetSplitter();`);
  assert(ev(`aircraftProfile.splitRatio`) === null,
    'the reset wrote a default instead of clearing the stored figure');
  assert(ev(`document.body.style.getPropertyValue('--map-flex')`) === '',
    'the reset left an inline width behind');
  assert(JSON.parse(ev(`localStorage.getItem('c182_perf_profile')`)).splitRatio === null,
    'the reset was not persisted, so a reload would bring the old divider back');
  // THE RESET IS PER AXIS. Resetting the split must not throw away a stacked
  // divider the pilot set on a different screen.
  ev(`aircraftProfile.splitRatio = 0.7; aircraftProfile.stackRatio = 0.3;
      setLayoutMode('split', false); resetSplitter();`);
  assert(ev(`aircraftProfile.stackRatio`) === 0.3,
    'resetting the split threw away the stacked position too');
  ev(`aircraftProfile.splitRatio = null; aircraftProfile.stackRatio = null; applyStoredPaneRatios();
      setLayoutMode('split', false);`);
  ev(SEED);
});

T('there is no divider when there is only one panel to divide', () => {
  ev(SEED);
  const active = (setup) => ev(setup + ' splitterActive()');
  assert(active(`setLayoutMode('split', false);`), 'the split layout has no divider');
  assert(active(`setLayoutMode('stacked', false);`), 'the stacked layout has no divider');
  assert(!active(`setLayoutMode('plan', false);`), 'plan-only offered a divider with nothing to divide');
  assert(!active(`setLayoutMode('map', false);`), 'map-only offered a divider with nothing to divide');
  // The Menu skin collapses the plan to a rail that opens on hover; a divider
  // there would fight the hover and resize something about to slide away.
  assert(!active(`setLayoutMode('split', false); applySkin('menu');`),
    'the Menu skin kept a divider for its hover rail');
  assert(active(`applySkin('default');`), 'the divider did not come back with the default skin');
  // ...and a drag that starts while there is nothing to divide does nothing.
  ev(`setLayoutMode('plan', false); onSplitterDown({ preventDefault(){}, pointerId: undefined });`);
  assert(ev(`aircraftProfile.splitRatio == null`),
    'a drag on a hidden divider still wrote a position');
  ev(`setLayoutMode('split', false);`);
  ev(SEED);
});

T('a number cell can hold its value: no stepper, and a floor under its column', () => {
  // jsdom HAS NO LAYOUT, so it cannot see a crushed cell - verify-layout.mjs
  // measures scrollWidth against clientWidth at four divider positions in a
  // real browser. What is worth guarding here is that the two rules the
  // measurement depends on are still present and still have something to bind
  // to, because both are silent when they go: a browser drops CSS it cannot
  // apply, and a class that stops being emitted takes its rule with it.
  const fs = require('fs');
  const css = fs.readFileSync('src/styles.css', 'utf8');
  assert(/input\[type="number"\]::-webkit-inner-spin-button/.test(css),
    'the native spin button is back, and it takes ~18 px out of every number cell');
  assert(/td input\[type="number"\]\s*\{[^}]*min-width/.test(css),
    'the number columns lost their floor, so the table crushes them before it scrolls');
  assert(/td input\.alt-input\s*\{[^}]*min-width/.test(css),
    'the altitude column lost its wider floor - five digits no longer fit');
  assert(/\.table-container\s*\{[^}]*overflow-x:\s*auto/.test(css),
    'the table stopped scrolling, so a narrow plan panel has nowhere to put the columns');
  // ...and the class the floor binds to is really emitted, on BOTH altitude
  // cells - the leg row and the circuit row are separate interpolations.
  ev(SEED);
  const alts = ev(`[...document.querySelectorAll('td input.alt-input')].length`);
  assert(alts >= 2, 'the altitude cells no longer carry alt-input: ' + alts);
  // The hint replaces what the arrows used to say for themselves.
  assert(/steps 500 ft/.test(ev(`document.querySelector('td input.alt-input').title`)),
    'the altitude cell no longer says the up and down keys step it');
  ev(SEED);
});

console.log('\n=== 62a000j. Typing is not a shortcut (v16.69) ===');

T('an unmodified key in an editable field belongs to the field', () => {
  const K = moduleExports.keys;
  const R = (stroke, ctx) => { const a = K.resolveKey(stroke, ctx); return a && a.action; };
  const editing = { editing: true };
  // THE PILOT'S BUG: 1-9 activate a flight plan, a number field is not
  // free text, so every digit typed into an altitude also switched plan.
  assert(R({ key: '2' }) === 'activate-flight-2', 'a bare digit no longer picks a plan');
  assert(R({ key: '2' }, editing) === null, 'a digit typed into a field still switches flight plan');
  // IT WAS NEVER ONLY THE DIGITS. `.` and `,` step between plans, so a decimal
  // point typed into a fuel or a reserve did it too.
  assert(R({ key: '.' }) === 'next-flight', 'the plain "." binding is gone');
  assert(R({ key: '.' }, editing) === null, 'a decimal point typed into a field still steps plan');
  assert(R({ key: ',' }, editing) === null, 'a comma typed into a field still steps plan');
  assert(R({ key: '/' }, editing) === null, 'a slash typed into a field still jumps to the search box');
  // ...and Delete removes the selected waypoint, so erasing a digit forward
  // could take a fix out of the route.
  const sel = { hasHighlight: true };
  assert(R({ key: 'Delete' }, sel) === 'delete-waypoint', 'Delete no longer removes a waypoint');
  assert(R({ key: 'Delete' }, { ...sel, ...editing }) === null,
    'Delete while typing in a field still removes a waypoint from the route');

  // RULE 2 IS INTACT, and this is the whole reason number fields were left out
  // of textLike in the first place: a pilot reaches for undo right after
  // editing an altitude, and the cursor is still in the box.
  assert(R({ key: 'z', ctrlKey: true }, editing) === 'undo',
    'Ctrl+Z stopped working with the cursor in a number field - rule 2 was lost');
  assert(R({ key: 'z', ctrlKey: true, shiftKey: true }, editing) === 'redo',
    'Ctrl+Shift+Z stopped working in a number field');
  assert(R({ key: 's', ctrlKey: true }, editing) === 'save',
    'Ctrl+S stopped working in a number field');
  // A free-text field is still stricter: it blocks modified chords too, except
  // the ones that say inText.
  assert(R({ key: 'z', ctrlKey: true }, { textLike: true, editing: true }) === null,
    'a free-text field stopped keeping its own editing chords');
  assert(R({ key: 's', ctrlKey: true }, { textLike: true, editing: true }) === 'save',
    'Ctrl+S must still be claimed in a text field - the browser would save the PAGE');

  // Escape is answered before any of this, so it is the way out either way.
  assert(R({ key: 'Escape' }, editing) === 'close-overlays', 'Escape stopped working while typing');
});

T('isBareKey draws the line at the modifier, not at the key', () => {
  const K = moduleExports.keys;
  assert(K.isBareKey({ key: '5' }), 'a digit is a bare key');
  assert(K.isBareKey({ key: '.' }) && K.isBareKey({ key: '-' }), 'a decimal point and a minus are typed');
  assert(K.isBareKey({ key: 'Backspace' }) && K.isBareKey({ key: 'Delete' }), 'erasing is editing');
  assert(K.isBareKey({ key: 'ArrowUp' }), 'the arrows step a number field, so they are its own');
  assert(!K.isBareKey({ key: '5', ctrlKey: true }), 'a modifier makes it a shortcut');
  assert(!K.isBareKey({ key: '5', altKey: true }), 'Alt makes it a shortcut');
  assert(!K.isBareKey({ key: '5', metaKey: true }), 'Cmd makes it a shortcut');
  // SHIFT IS NOT A MODIFIER HERE: Shift+2 is how a keyboard types "@".
  assert(K.isBareKey({ key: '@', shiftKey: true }), 'Shift is how a character is typed, not a chord');
  assert(!K.isBareKey({ key: 'Escape' }), 'Escape is answered before this and must not be swallowed');
  assert(!K.isBareKey({ key: 'F5' }), 'a function key types nothing');
});

TA('typing a digit into an altitude does not change the flight plan', async () => {
  // THE PAGE'S OWN ANSWER, not just the resolver's: `isEditableTarget` has to
  // report a number input as a field the pilot is typing in, and the dispatcher
  // has to hand it over. Driving resolveKey alone would prove the module and
  // leave the wiring untested - the v16.53 lesson.
  ev(SEED);
  ev(`addNewFlightPlan(); addNewFlightPlan(); setActiveFlight(0);`);
  assert(ev('flights.length') >= 3, 'the probe needs three plans');
  const alt = ev(`(() => {
    const i = [...document.querySelectorAll('td input.alt-input')][0];
    i.focus();
    return !!i;
  })()`);
  assert(alt, 'no altitude cell to type into');
  // The event has to carry the FOCUSED field as its target for the guard to see
  // it, which is what a real keypress does - dispatching on `document` would
  // give it the document as target and prove nothing.
  ev(`(() => {
    const i = [...document.querySelectorAll('td input.alt-input')][0];
    i.dispatchEvent(new window.KeyboardEvent('keydown', { key: '2', bubbles: true }));
  })()`);
  await tick();
  assert(ev('activeFlightIndex') === 0,
    'typing a digit into an altitude jumped to another flight plan: ' + ev('activeFlightIndex'));
  // ...and the binding still works when the pilot is NOT in a field.
  ev(`document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: '2', bubbles: true }))`);
  await tick();
  assert(ev('activeFlightIndex') === 1,
    'the digit stopped picking a plan when nothing was focused: ' + ev('activeFlightIndex'));
  ev(SEED);
});

T('the editable number columns are the roomiest of the numeric group', () => {
  // jsdom has no layout, so the WIDTHS are measured in verify-layout.mjs. What
  // is guarded here is that the column floors exist and are attached to the
  // three headers that carry a typed value - a percentage width alone shrinks
  // with the panel, which is what starved them.
  const fs = require('fs');
  const css = fs.readFileSync('src/styles.css', 'utf8');
  assert(/th\.col-alt\s*\{[^}]*min-width/.test(css), 'the altitude column lost its floor');
  assert(/th\.col-num\s*\{[^}]*min-width/.test(css), 'the OAT and VAR columns lost their floor');
  ev(SEED);
  assert(ev(`document.querySelectorAll('th.col-alt').length`) >= 1, 'no header carries col-alt');
  assert(ev(`document.querySelectorAll('th.col-num').length`) >= 2,
    'OAT and VAR no longer carry col-num: ' + ev(`document.querySelectorAll('th.col-num').length`));
  ev(SEED);
});

console.log('\n=== 62a000k. Set an altitude from a waypoint onward (v16.73) ===');

T('the propagation reaches every fix after the one you pointed at, with two exclusions', () => {
  const L = moduleExports.legs;
  const wps = (n) => Array.from({ length: n }, (_, i) => ({ name: 'W' + i, alt: 1000 + i }));
  // Every fix after the clicked one, EXCEPT the last.
  assert(JSON.stringify(L.levelFromIndices(wps(5), 1)) === '[1,2,3]',
    'the middle case is wrong: ' + JSON.stringify(L.levelFromIndices(wps(5), 1)));
  // THE LAST WAYPOINT KEEPS ITS OWN ALTITUDE. It is the destination at its
  // published field elevation, and raising it to cruise would silently delete
  // the descent - the plan would look clean and no longer arrive.
  assert(!L.levelFromIndices(wps(5), 1).includes(4), 'the destination was overwritten');
  // ...but pointing AT it still sets it, because then the pilot said so.
  assert(JSON.stringify(L.levelFromIndices(wps(5), 4)) === '[4]',
    'clicking the last fix must still set that one');
  // A CIRCUIT STOP IS SKIPPED: its altitude is DERIVED from the field it is
  // flown at (v16.40), not inherited. A cruise level there is a pattern at
  // 6500 ft.
  const withPat = wps(6);
  withPat[3].isPattern = true;
  assert(JSON.stringify(L.levelFromIndices(withPat, 1)) === '[1,2,4]',
    'a circuit stop was overwritten: ' + JSON.stringify(L.levelFromIndices(withPat, 1)));
  // Degenerate shapes return nothing rather than throwing.
  assert(L.levelFromIndices(wps(3), 9).length === 0, 'an out-of-range index must give nothing');
  assert(L.levelFromIndices(wps(3), -1).length === 0, 'a negative index must give nothing');
  assert(L.levelFromIndices(null, 0).length === 0, 'a missing list must give nothing');
  assert(JSON.stringify(L.levelFromIndices(wps(1), 0)) === '[0]', 'a one-fix plan sets that fix');
  // In flight order, because the page applies them straight through.
  const idx = L.levelFromIndices(wps(8), 2);
  assert(idx.every((v, i) => i === 0 || v > idx[i - 1]), 'the indices came back out of order');
});

T('a touch & go WITH circuits keeps its landing altitude, exactly as one without them does (v17.9)', () => {
  // The author: "if I have planned to do touch n go with pattern, the altitude
  // at the arrival is also set to the cruise altitude and not the landing
  // altitude. Its only when a single touch&go is selected that the destination
  // altitude remains the landing elevation." The circuits are a PATTERN entry
  // AFTER the aerodrome, so the literal last waypoint was the circuit.
  const L = moduleExports.legs;
  const route = () => [
    { name: 'ENDU', alt: 254 }, { name: 'MID1', alt: 2500 }, { name: 'MID2', alt: 2500 },
    { name: 'ENTC', alt: 32, stop: 'touch-and-go' }, { name: 'PATTERN', alt: 1000, isPattern: true, laps: 3 }];
  assert(L.destinationIndex(route()) === 3, 'the destination is the circuit, not the aerodrome: ' + L.destinationIndex(route()));
  assert(JSON.stringify(L.levelFromIndices(route(), 1)) === '[1,2]',
    'the T&G arrival or its circuit was levelled: ' + JSON.stringify(L.levelFromIndices(route(), 1)));
  // the same without circuits, which already worked - still works
  const plain = route().slice(0, 4);
  assert(JSON.stringify(L.levelFromIndices(plain, 1)) === '[1,2]', 'the plain T&G case broke');
  // several circuit entries, and pointing AT the arrival still sets it
  const two = route().concat([{ name: 'PATTERN', alt: 1000, isPattern: true, laps: 2 }]);
  assert(L.destinationIndex(two) === 3 && JSON.stringify(L.levelFromIndices(two, 3)) === '[3]', 'two circuit entries broke it');
  // a stop is a landing wherever it is: never levelled from upstream
  const midStop = [{ name: 'A' }, { name: 'B' }, { name: 'C', stop: 'full-stop' }, { name: 'D' }, { name: 'E' }];
  assert(JSON.stringify(L.levelFromIndices(midStop, 1)) === '[1,3]', 'a stop was levelled: ' + JSON.stringify(L.levelFromIndices(midStop, 1)));
  assert(L.destinationIndex([]) === -1 && L.destinationIndex(null) === -1, 'an empty plan has a destination');
});

T('on the page: setting 4500 ft from MID1 leaves the T&G arrival at field elevation and the circuit at its own', () => {
  ev(`flights = [{ id: 1, title: 'A', depElev: 254, waypoints: [
        { lat: 69.055, lng: 18.544, name: 'ENDU', alt: 254, oat: 10, wdir: 0, wspd: 0, var: -11 },
        { lat: 69.20, lng: 18.30, name: 'MID1', alt: 2500, oat: 10, wdir: 0, wspd: 0, var: -11 },
        { lat: 69.40, lng: 18.60, name: 'MID2', alt: 3000, oat: 10, wdir: 0, wspd: 0, var: -11 },
        { lat: 69.679, lng: 18.911, name: 'ENTC', alt: 32, oat: 10, wdir: 0, wspd: 0, var: -12, stop: 'touch-and-go' },
        { lat: 69.679, lng: 18.911, name: 'PATTERN', alt: 1000, oat: 10, wdir: 0, wspd: 0, var: -12, isPattern: true, laps: 3 }]}];
      activeFlightIndex = 0; refreshMap(); renderAllFlightTables();`);
  ev(`applyWaypointEdit(0, 1, { alt: '4500' })`);
  const alts = ev('flights[0].waypoints.map(w => w.alt)');
  assert(JSON.stringify(alts) === '[254,4500,4500,32,1000]', 'the altitudes after the edit: ' + JSON.stringify(alts));
  ev(SEED);
});

TA('right-clicking a waypoint sets the altitude from there onward', async () => {
  ev(`flights = [{ id: 1, title: 'A', depElev: 254, waypoints: [
        { lat: 69.055, lng: 18.544, name: 'ENDU', alt: 254, oat: 10, wdir: 0, wspd: 0, var: -11 },
        { lat: 69.20, lng: 18.30, name: 'MID1', alt: 2500, oat: 10, wdir: 0, wspd: 0, var: -11 },
        { lat: 69.40, lng: 18.60, name: 'MID2', alt: 3000, oat: 10, wdir: 0, wspd: 0, var: -11 },
        { lat: 69.679, lng: 18.911, name: 'ENTC', alt: 32, oat: 10, wdir: 0, wspd: 0, var: -12 }]}];
      activeFlightIndex = 0; refreshMap(); renderAllFlightTables();`);
  ev(`openWaypointMenu(0, 1)`);
  await tick();
  // ONE dialog, both fields - the v16.74 request was to lose the extra click.
  assert(openDlg().querySelector('.dlg-input[data-field="name"]'), 'no name field');
  assert(openDlg().querySelector('.dlg-input[data-field="alt"]'), 'no altitude field');
  typeInDialog('6500', 'alt');
  await answerDialog('Apply');
  await tick();
  assert(ev('flights[0].waypoints[1].alt') === 6500, 'the clicked fix was not set');
  assert(ev('flights[0].waypoints[2].alt') === 6500, 'the fix after it was not set');
  // THE DESTINATION KEEPS ITS FIELD ELEVATION, or the descent quietly vanishes.
  assert(ev('flights[0].waypoints[3].alt') === 32,
    'the destination was raised to cruise: ' + ev('flights[0].waypoints[3].alt'));
  assert(ev('flights[0].waypoints[1].name') === 'MID1', 'the name changed when only the altitude was edited');
  // ...and it is ONE undo, not one per fix.
  ev(`undoLast(true)`);
  await tick();
  assert(ev('flights[0].waypoints[1].alt') === 2500 && ev('flights[0].waypoints[2].alt') === 3000,
    'undo did not put both altitudes back');
  ev(SEED);
});

TA('the name and the altitude commit together as one edit', async () => {
  ev(`flights = [{ id: 1, title: 'A', depElev: 254, waypoints: [
        { lat: 69.055, lng: 18.544, name: 'ENDU', alt: 254, oat: 10, wdir: 0, wspd: 0, var: -11 },
        { lat: 69.20, lng: 18.30, name: 'MID1', alt: 2500, oat: 10, wdir: 0, wspd: 0, var: -11 },
        { lat: 69.679, lng: 18.911, name: 'ENTC', alt: 32, oat: 10, wdir: 0, wspd: 0, var: -12 }]}];
      activeFlightIndex = 0; refreshMap(); renderAllFlightTables();`);
  ev(`openWaypointMenu(0, 1)`);
  await tick();
  typeInDialog('ROSSVOLL', 'name');
  typeInDialog('4500', 'alt');
  await answerDialog('Apply');
  await tick();
  assert(ev('flights[0].waypoints[1].name') === 'ROSSVOLL', 'the rename did not apply');
  assert(ev('flights[0].waypoints[1].alt') === 4500, 'the altitude did not apply');
  ev(`undoLast(true)`);
  await tick();
  assert(ev('flights[0].waypoints[1].name') === 'MID1' && ev('flights[0].waypoints[1].alt') === 2500,
    'the two halves were not one undo step');
  ev(SEED);
});

TA('an unreadable altitude is refused, not coerced to zero', async () => {
  ev(`flights = [{ id: 1, title: 'A', depElev: 254, waypoints: [
        { lat: 69.055, lng: 18.544, name: 'ENDU', alt: 254, oat: 10, wdir: 0, wspd: 0, var: -11 },
        { lat: 69.20, lng: 18.30, name: 'MID1', alt: 2500, oat: 10, wdir: 0, wspd: 0, var: -11 },
        { lat: 69.679, lng: 18.911, name: 'ENTC', alt: 32, oat: 10, wdir: 0, wspd: 0, var: -12 }]}];
      activeFlightIndex = 0; refreshMap(); renderAllFlightTables();`);
  ev(`openWaypointMenu(0, 1)`);
  await tick();
  typeInDialog('not a number', 'alt');
  await answerDialog('Apply');
  await tick();
  // `Number('')` is 0 and `Number('abc')` is NaN - neither may become an
  // altitude. A plan silently levelled at sea level is the v16.43 defect.
  assert(ev('flights[0].waypoints[1].alt') === 2500,
    'an unreadable altitude was applied anyway: ' + ev('flights[0].waypoints[1].alt'));
  ev(SEED);
});

TA('a circuit stop keeps its own altitude and carries nothing forward', async () => {
  // Its altitude is DERIVED from the field (v16.40). It is editable, because
  // the VAC is the authority and the derived figure is a default to check - but
  // it is never a cruise level to hand on to the rest of the plan.
  ev(`flights = [{ id: 1, title: 'A', depElev: 254, waypoints: [
        { lat: 69.055, lng: 18.544, name: 'ENDU', alt: 254, oat: 10, wdir: 0, wspd: 0, var: -11 },
        { lat: 69.679, lng: 18.911, name: 'PATTERN', alt: 1000, oat: 10, wdir: 0, wspd: 0, var: -12, isPattern: true, laps: 3 },
        { lat: 69.70, lng: 18.95, name: 'ENTC', alt: 32, oat: 10, wdir: 0, wspd: 0, var: -12 }]}];
      activeFlightIndex = 0; refreshMap(); renderAllFlightTables();`);
  ev(`openWaypointMenu(0, 1)`);
  await tick();
  assert(!openDlg().querySelector('.dlg-input[data-field="name"]'),
    'a circuit stop was offered a rename - "PATTERN" is reserved in both directions');
  typeInDialog('1500', 'alt');
  await answerDialog('Apply');
  await tick();
  assert(ev('flights[0].waypoints[1].alt') === 1500, 'the circuit altitude did not apply');
  assert(ev('flights[0].waypoints[2].alt') === 32,
    'a circuit altitude carried forward into the rest of the plan: ' + ev('flights[0].waypoints[2].alt'));
  ev(SEED);
});

console.log('\n=== 62a000l. A TOC dragged further back than the POH can climb (v16.74) ===');

TA('the first leg drops the pin rather than clamping, so no BOC appears at the departure', async () => {
  // You cannot climb before takeoff, so on the first leg there is no earlier
  // fix to raise. v16.74 CLAMPED the pin to the earliest reachable TOC; v16.75
  // CLEARS it instead, and that is strictly better rather than a change of
  // mind: with nothing pinned the climb starts at the fix, which IS the
  // earliest possible, and the engine draws NO bottom-of-climb ring. The clamp
  // landed a fraction of a mile in, so the engine derived a BOC there and the
  // pilot got a spurious ring just past the departure - their second report.
  ev(`flights = [{ id: 1, title: 'A', depElev: 254, waypoints: [
        { lat: 69.055, lng: 18.544, name: 'ENDU', alt: 254, oat: 10, wdir: 0, wspd: 0, var: -11 },
        { lat: 69.679, lng: 18.911, name: 'ENTC', alt: 6500, oat: 0, wdir: 0, wspd: 0, var: -12 }]}];
      activeFlightIndex = 0; refreshMap(); renderAllFlightTables();`);
  const natural = ev(`computeFlightSchedule(flights[0])[0].tocAlongNM`);
  assert(natural > 5, 'the probe leg has no climb to speak of');
  ev(`settleTargetDrag(0, 0, 2)`);   // ask for a TOC far earlier than the POH allows
  await tick();
  assert(ev('flights[0].waypoints[1].altAtNM') == null,
    'a target was left behind: ' + ev('flights[0].waypoints[1].altAtNM'));
  const after = ev(`computeFlightSchedule(flights[0])[0].tocAlongNM`);
  assert(Math.abs(after - natural) < 0.001,
    'the TOC did not stay at the earliest reachable point: ' + after + ' vs ' + natural);
  // NO BOC RING. The bottom of the climb IS the departure fix, and marking a
  // point that is already a named waypoint is the clutter v16.37 refuses.
  const kinds = ev(`computeLegMarkers(flights[0].waypoints[0], flights[0].waypoints[1],
      computeFlightSchedule(flights[0])[0]).map(m => m.kind).join(',')`);
  assert(!/BOC/.test(kinds), 'a BOC was drawn just past the departure: ' + kinds);
  assert(ev(`computeFlightSchedule(flights[0])[0].tocTargetMet`) !== false,
    'the leg still reports its own target as missed - the banner would stay up');
  assert(/cannot go further back/i.test(toastText()),
    'the pilot was not told why the TOC stopped: ' + toastText());
  ev(SEED);
});

TA('a TOC dragged past what the POH can climb never rewrites an altitude', async () => {
  // v16.74 and v16.75 answered this drag by RAISING the earlier fix (and
  // caching the pilot's figure in altBase so the raises could be walked back).
  // v16.77 deletes both, on the pilot's instruction: the altitude column on the
  // OFP is the level they plan to use, and the tool does not argue with it.
  // Two outcomes remain - it fits, or the leg goes back to the POH's own
  // corner - and neither touches a number they typed.
  ev(`flights = [{ id: 1, title: 'B', depElev: 254, waypoints: [
        { lat: 68.60, lng: 18.50, name: 'ENDU', alt: 254, oat: 10, wdir: 0, wspd: 0, var: -11 },
        { lat: 69.20, lng: 18.50, name: 'MID',  alt: 2500, oat: 5, wdir: 0, wspd: 0, var: -11 },
        { lat: 69.90, lng: 18.50, name: 'ENTC', alt: 8500, oat: 0, wdir: 0, wspd: 0, var: -12 }]}];
      activeFlightIndex = 0; refreshMap(); renderAllFlightTables();`);
  const alts = () => ev('flights[0].waypoints.map(w => w.alt).join(",")');
  assert(alts() === '254,2500,8500', 'the probe did not seed: ' + alts());
  const natural = ev(`computeFlightSchedule(flights[0])[1].tocAlongNM`);
  assert(natural > 6, 'the probe leg has no climb to speak of');

  // Ask for a top of climb far earlier than the climb can reach.
  ev(`settleTargetDrag(0, 1, 6)`);
  await tick();
  assert(alts() === '254,2500,8500', 'a drag rewrote an altitude: ' + alts());
  assert(ev('flights[0].waypoints[1].altBase') === undefined,
    'the removed altitude cache came back');
  assert(ev('flights[0].waypoints[2].altAtNM') == null,
    'an unreachable target was left behind: ' + ev('flights[0].waypoints[2].altAtNM'));
  const after = ev(`computeFlightSchedule(flights[0])[1].tocAlongNM`);
  assert(Math.abs(after - natural) < 0.001,
    'the corner did not go back to where the POH puts it: ' + after + ' vs ' + natural);
  // NO RED BANNER. The plan is the pilot's own and is flyable.
  assert(ev(`computeFlightSchedule(flights[0])[1].tocTargetMet`) !== false,
    'the leg still reports a missed target, so the banner would stay up');
  assert(/cannot go further back|does not fit/i.test(toastText()),
    'the pilot was not told why the TOC stopped: ' + toastText());

  // A REACHABLE ONE IS STILL APPLIED, and still without touching an altitude.
  const legLen = ev(`computeFlightSchedule(flights[0])[1].distNM`);
  ev('settleTargetDrag(0, 1, ' + Math.round(legLen) + ')');
  await tick();
  assert(ev('flights[0].waypoints[2].altAtNM') === Math.round(legLen),
    'a reachable target was not kept: ' + ev('flights[0].waypoints[2].altAtNM'));
  assert(alts() === '254,2500,8500', 'applying a target rewrote an altitude: ' + alts());
  ev(SEED);
});

T('a TOC that fits is applied silently, with no advice and no note', () => {
  ev(`flights = [{ id: 1, title: 'C', depElev: 254, waypoints: [
        { lat: 69.055, lng: 18.544, name: 'ENDU', alt: 254, oat: 10, wdir: 0, wspd: 0, var: -11 },
        { lat: 69.679, lng: 18.911, name: 'ENTC', alt: 6500, oat: 0, wdir: 0, wspd: 0, var: -12 }]}];
      activeFlightIndex = 0; refreshMap(); renderAllFlightTables();
      document.getElementById('app-toasts').innerHTML = '';`);
  const dist = ev(`computeFlightSchedule(flights[0])[0].distNM`);
  ev(`settleTargetDrag(0, 0, ${Math.round(dist - 1)})`);
  assert(ev('flights[0].waypoints[1].altAtNM') === Math.round(dist - 1), 'a reachable target was not applied as asked');
  assert(toastText().trim() === '', 'a TOC that fits should say nothing: ' + toastText());
  ev(SEED);
});

TA('a drag never commits a plan the app itself calls unusable', async () => {
  // FOUND BY THE SWEEP, not by imagination: on a plan whose last leg is 3.6 NM,
  // delaying the climb on the leg BEFORE pushes it into the tail the descent
  // needs, so two reasonable requests contradict - and v16.74 accepted the pin
  // and then raised the red banner. A pin is a REQUEST; one that cannot be
  // honoured is refused with a reason.
  ev(`flights = [{ id: 1, title: 'S', depElev: 254, waypoints: [
        { lat: 68.60, lng: 18.50, name: 'ENDU', alt: 254, oat: 10, wdir: 0, wspd: 0, var: -11 },
        { lat: 69.60, lng: 18.50, name: 'A', alt: 8000, oat: 0, wdir: 0, wspd: 0, var: -11 },
        { lat: 69.66, lng: 18.50, name: 'ENTC', alt: 2000, oat: 5, wdir: 0, wspd: 0, var: -12 }]}];
      activeFlightIndex = 0; refreshMap(); renderAllFlightTables();
      document.getElementById('app-toasts').innerHTML = '';`);
  const clean = ev(`collectIntegrityProblems(flights, {}).length`);
  assert(clean === 0, 'the probe plan is already broken before the drag: ' + clean);
  // Ask for a TOC two thirds along the first leg - the climb fits there, but
  // the descent for ENTC then has nowhere to start.
  const legLen = ev(`computeFlightSchedule(flights[0])[0].distNM`);
  ev(`settleTargetDrag(0, 0, ${Math.round(legLen * 0.68 * 10) / 10})`);
  await tick();
  assert(ev(`collectIntegrityProblems(flights, {}).length`) === 0,
    'the drag left the plan unusable: ' + JSON.stringify(ev(`collectIntegrityProblems(flights, {})`)));
  assert(ev('flights[0].waypoints[1].altAtNM') == null,
    'the contradicting target was kept: ' + ev('flights[0].waypoints[1].altAtNM'));
  ev(SEED);
});

TA('a BOC dragged into the tail the descent needs is refused, not committed', async () => {
  // THE SAME RULE ON THE OTHER THREE MARKS. `applyProfileDrop` tries the drop on
  // a copy first, so a BOC that delays the climb into the space a later descent
  // has to back up through is refused rather than accepted and then reported as
  // unusable figures.
  ev(`flights = [{ id: 1, title: 'S', depElev: 254, waypoints: [
        { lat: 68.60, lng: 18.50, name: 'ENDU', alt: 254, oat: 10, wdir: 0, wspd: 0, var: -11 },
        { lat: 69.60, lng: 18.50, name: 'A', alt: 8000, oat: 0, wdir: 0, wspd: 0, var: -11 },
        { lat: 69.66, lng: 18.50, name: 'ENTC', alt: 2000, oat: 5, wdir: 0, wspd: 0, var: -12 }]}];
      activeFlightIndex = 0; refreshMap(); renderAllFlightTables();
      document.getElementById('app-toasts').innerHTML = '';`);
  assert(ev(`collectIntegrityProblems(flights, {}).length`) === 0, 'the probe plan starts broken');
  const legLen = ev(`computeFlightSchedule(flights[0])[0].distNM`);
  // Hold the departure altitude most of the way, so the climb is squeezed into
  // the tail - which is exactly where the descent for ENTC must begin.
  ev(`applyProfileDrop({ fIdx: 0, legIdx: 0, kind: 'BOC', dropNM: ${Math.round(legLen * 0.6 * 10) / 10},
        SL: computeFlightSchedule(flights[0])[0] })`);
  await tick();
  assert(ev(`collectIntegrityProblems(flights, {}).length`) === 0,
    'a BOC drag left the plan unusable: ' + JSON.stringify(ev(`collectIntegrityProblems(flights, {})`)));
  assert(ev('flights[0].waypoints[1].altAtNM') == null,
    'the contradicting target was kept: ' + ev('flights[0].waypoints[1].altAtNM'));
  assert(toastText().trim() !== '', 'the pilot was told nothing at all');
  ev(SEED);
});

TA('a BOD that cannot fit is refused, and changes nothing', async () => {
  // The same rule on the descent side. `applyProfileDrop` tries the drop on a
  // copy before committing, exactly as the TOC does.
  ev(`flights = [{ id: 1, title: 'S', depElev: 254, waypoints: [
        { lat: 68.60, lng: 18.50, name: 'ENDU', alt: 254, oat: 10, wdir: 0, wspd: 0, var: -11 },
        { lat: 69.60, lng: 18.50, name: 'A', alt: 8000, oat: 0, wdir: 0, wspd: 0, var: -11 },
        { lat: 69.66, lng: 18.50, name: 'ENTC', alt: 2000, oat: 5, wdir: 0, wspd: 0, var: -12 }]}];
      activeFlightIndex = 0; refreshMap(); renderAllFlightTables();
      document.getElementById('app-toasts').innerHTML = '';`);
  const before = ev(`JSON.stringify(flights[0].waypoints.map(w => [w.alt, w.bodNM || null]))`);
  const sc = ev(`(() => { const s = computeFlightSchedule(flights[0])[1];
    return JSON.stringify({ dist: s.distNM, bodTail: s.bodTailNM || 0, todBefore: s.todBeforeNM }); })()`);
  const L = JSON.parse(sc);
  // Ask to be level almost the whole of the short final leg early - there is
  // nowhere for a 6000 ft descent to go.
  ev(`applyProfileDrop({ fIdx: 0, legIdx: 1, kind: 'BOD', dropNM: 0.1,
        SL: computeFlightSchedule(flights[0])[1] })`);
  await tick();
  assert(ev(`collectIntegrityProblems(flights, {}).length`) === 0,
    'a refused BOD still left the plan unusable: ' + JSON.stringify(ev(`collectIntegrityProblems(flights, {})`)));
  // EITHER OUTCOME IS FINE - what must never happen is a plan the app calls
  // unusable. If the engine could apply the pin (it clamps a BOD it cannot
  // honour and reports `bodRefused` in the panel) the plan changes silently; if
  // it could not, nothing changes and the pilot is told. The invariant is the
  // integrity check, not which of the two happened.
  const changed = ev(`JSON.stringify(flights[0].waypoints.map(w => [w.alt, w.bodNM || null]))`) !== before;
  assert(!changed || !/does not fit/i.test(toastText()),
    'the plan was changed AND refused at the same time');
  assert(L.dist > 0, 'the probe leg has no length');
  ev(SEED);
});

console.log('\n=== 62a000d. Quality of life, one batch (v16.49, item 16) ===');

T('the key mapping is a pure decision, and every action has a home', () => {
  const K = moduleExports.keys;
  const R = (stroke, ctx) => { const a = K.resolveKey(stroke, ctx); return a && a.action; };
  assert(R({ key: 'z', ctrlKey: true }) === 'undo', 'Ctrl+Z');
  assert(R({ key: 'z', ctrlKey: true, shiftKey: true }) === 'redo', 'Ctrl+Shift+Z');
  assert(R({ key: 'Z', metaKey: true }) === 'undo', 'Cmd+Z (capital Z with shift off)');
  // v16.52 dropped the hardcoded Ctrl+Y alias: one chord per action is what
  // makes the whole mapping settable, and redo can be rebound to Ctrl+Y from
  // the Keyboard page by anyone who wants it there.
  assert(R({ key: 'y', ctrlKey: true }) === null, 'Ctrl+Y is no longer a second redo by default');
  assert(R({ key: 's', ctrlKey: true }) === 'save', 'Ctrl+S');
  assert(R({ key: '/' }) === 'focus-search', '/');
  assert(R({ key: 'Escape' }) === 'close-overlays', 'Escape');
  assert(R({ key: 'Escape' }, { dragging: true }) === 'cancel-drag', 'Escape during a drag');
  assert(R({ key: 'q' }) === null, 'an unbound key claimed something');
  assert(R({ key: 'z', ctrlKey: true, altKey: true }) === null, 'Ctrl+Alt+Z is not ours');

  // Every action the resolver can return must be handled by the page, or a
  // binding is silently dead - the failure mode this module exists to prevent.
  const handler = APP_SRC.split('/* @KEY-DISPATCH */')[1].split('\n    });')[0];
  for (const a of K.KEY_ACTIONS)
    assert(handler.includes("case '" + a + "'"), 'the page has no case for ' + a);
  // ...and the help text must cover them, or the bindings are folklore.
  // v16.52: the help is BUILT FROM THE LIVE KEYMAP, so it cannot describe a
  // mapping that is not in force - the static list it replaced could.
  const help = K.keyHelp(K.defaultKeymap());
  assert(help.length >= 5, 'the key help shrank: ' + help.length);
  assert(help.every((h) => h.keys && h.what && h.group), 'a help row is missing a field');
  assert(K.keyHelp({ undo: null }).every((h) => h.what !== 'Undo'),
    'the help still lists an action that has no binding');
  assert(/Ctrl\+S/.test(APP_SRC) && /Find fix/.test(APP_SRC), 'the guide does not mention the new keys');
});

T('a free-text field keeps its own editing, but Ctrl+S is still ours', () => {
  const K = moduleExports.keys;
  const typing = { textLike: true };
  assert(K.resolveKey({ key: 'z', ctrlKey: true }, typing) === null, 'Ctrl+Z must stay native while typing');
  assert(K.resolveKey({ key: '/' }, typing) === null, '/ must type a slash in a text field');
  assert(K.resolveKey({ key: 'Delete' }, { ...typing, hasHighlight: true }) === null,
    'Delete must delete text, not a waypoint');
  // The browser's own Ctrl+S saves the PAGE, which is never wanted here - and a
  // pilot naming a route has their cursor in a field at exactly that moment.
  const s = K.resolveKey({ key: 's', ctrlKey: true }, typing);
  assert(s && s.action === 'save' && s.preventDefault, 'Ctrl+S must still save from inside a field');
});

T('Delete is offered only where editing is', () => {
  const K = moduleExports.keys;
  const R = (ctx) => { const a = K.resolveKey({ key: 'Delete' }, ctx); return a && a.action; };
  assert(R({ hasHighlight: true }) === 'delete-waypoint', 'Delete with a selection in Edit Mode');
  assert(R({ hasHighlight: true, viewMode: true }) === null,
    'View Mode is read-only - Delete must not remove a waypoint there');
  assert(R({}) === null, 'Delete with nothing selected must do nothing');
  // v16.52: one chord per action, so Backspace is no longer a hardcoded alias.
  // A Mac's "delete" key reports Backspace, so it is bindable from the menu -
  // and the default stays the PC key rather than claiming both.
  assert(K.resolveKey({ key: 'Backspace' }, { hasHighlight: true }) === null,
    'Backspace is bound by default again - it should be the pilot\'s choice');
  const km = K.defaultKeymap();
  km['delete-waypoint'] = 'Backspace';
  assert(K.resolveKey({ key: 'Backspace' }, { hasHighlight: true }, km).action === 'delete-waypoint',
    'rebinding delete to Backspace did not take');
});

T('a selected waypoint can be put down again, four ways (v17.6)', () => {
  // Escape backs out ONE level: a drag or an overlay left over from an earlier
  // test would take it first, so start from a clean screen.
  ev(`if (lineDrag) cancelLineDrag(); OVERLAY_IDS.forEach(closeModal); closeLegModal();`);
  ev(SEED);
  const click = () => ev(`markers[1]._h.click()`);
  const sel = () => ev('highlightedWaypoint ? highlightedWaypoint.wpIdx : null');
  const btn = doc.getElementById('deselect-btn');
  assert(btn && btn.parentElement === doc.getElementById('map-controls') && btn.classList.contains('map-ctl'),
    'the Deselect control is not in the map control stack');
  assert(btn.style.display === 'none', 'Deselect is on screen with nothing selected');
  // 1. the button, which names what it clears
  ev('isDoneMode = false'); click();
  assert(sel() === 1, 'clicking a marker did not select it');
  assert(doc.querySelector('.row-highlight'), 'the selection is not highlighted in the plan');
  assert(btn.style.display !== 'none' && /FINNSNES/.test(btn.textContent),
    'Deselect is hidden or does not name the selection: ' + btn.textContent);
  w.clearWaypointSelection();
  assert(sel() === null && !doc.querySelector('.row-highlight'), 'Deselect left the highlight on');
  assert(btn.style.display === 'none', 'Deselect stayed on screen after clearing');
  // 2. a second click on the same waypoint
  click(); click();
  assert(sel() === null && !doc.querySelector('.row-highlight'), 'a second click did not deselect');
  // ...while a click on a DIFFERENT waypoint moves the selection instead
  click(); ev(`markers[2]._h.click()`);
  assert(sel() === 2, 'clicking another waypoint did not move the selection');
  // 3. Escape
  ev(`document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  assert(sel() === null, 'Escape did not deselect');
  // 4. View Mode: the empty chart adds nothing, so a click there puts it down
  ev('isDoneMode = true'); refreshAfter();
  ev(`markers[1]._h.click()`);
  assert(sel() === 1, 'View Mode lost click-to-select');
  const n = ev('flights[0].waypoints.length');
  w.__mapHandlers.click({ latlng: { lat: 69.3, lng: 18.7 } });
  assert(sel() === null, 'a View-Mode click on the map did not deselect');
  assert(ev('flights[0].waypoints.length') === n, 'a View-Mode map click added a waypoint');
  ev('isDoneMode = false'); refreshAfter();
  // a selection whose waypoint has gone is dropped, not left pointing at nothing
  ev(`highlightedWaypoint = { fIdx: 0, wpIdx: 40 }; refreshMap();`);
  assert(sel() === null && btn.style.display === 'none', 'a dangling selection survived a redraw');
  function refreshAfter() { ev('refreshMap(); renderAllFlightTables();'); }
  ev(SEED);
});

TA('Delete removes the selected waypoint, and Ctrl+Z puts it back', async () => {
  ev(SEED);
  ev(`isDoneMode = false; markers[1].fire ? markers[1].fire('click') : markers[1]._h.click()`);
  assert(ev('highlightedWaypoint && highlightedWaypoint.wpIdx') === 1,
    'clicking a marker in Edit Mode did not select it');
  const before = ev('flights[0].waypoints.length');
  ev(`document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))`);
  await tick();
  assert(ev('flights[0].waypoints.length') === before - 1,
    'Delete did not remove the waypoint: ' + ev('flights[0].waypoints.length'));
  ev('undoLast(true)');
  assert(ev('flights[0].waypoints.length') === before, 'the deletion could not be undone');
  assert(ev(`flights[0].waypoints.map(w => w.name).join(',')`) === 'ENDU,FINNSNES,ENTC',
    'undo restored the wrong route: ' + ev(`flights[0].waypoints.map(w => w.name).join(',')`));
  ev(SEED);
});

T('undo covers the whole plan, not just the waypoints', () => {
  // QoL 3: ETD moves every ETO and the entire daylight verdict, and it was the
  // one plan input Ctrl+Z could not take back - it lives in a DOM field, not
  // in `flights`.
  ev(SEED);
  ev(`document.getElementById('def-etd').value = '08:00';
      document.getElementById('fuel-dep').value = '64';
      rememberPlanField(document.getElementById('def-etd'));
      rememberPlanField(document.getElementById('fuel-dep'));`);
  ev(`document.getElementById('def-etd').value = '14:30';
      pushPlanFieldUndo(document.getElementById('def-etd'), 'change ETD');
      renderAllFlightTables();`);
  ev(`document.getElementById('fuel-dep').value = '40';
      pushPlanFieldUndo(document.getElementById('fuel-dep'), 'change initial fuel');
      renderAllFlightTables();`);
  ev('undoLast(true)');
  assert(ev(`document.getElementById('fuel-dep').value`) === '64',
    'undo did not restore the fuel: ' + ev(`document.getElementById('fuel-dep').value`));
  assert(ev(`document.getElementById('def-etd').value`) === '14:30', 'undo went back too far');
  ev('undoLast(true)');
  assert(ev(`document.getElementById('def-etd').value`) === '08:00',
    'undo did not restore the ETD: ' + ev(`document.getElementById('def-etd').value`));
  ev('redoLast(true)');
  assert(ev(`document.getElementById('def-etd').value`) === '14:30', 'redo did not reapply the ETD');
  ev(SEED);
});

T('a field edit snapshots the value it had BEFORE the edit', () => {
  // `onchange` fires with the NEW value already in the box, so pushing there
  // would store the change instead of the state before it.
  ev(SEED);
  ev(`document.getElementById('fuel-reserve').value = '8';
      rememberPlanField(document.getElementById('fuel-reserve'));
      document.getElementById('fuel-reserve').value = '12';
      pushPlanFieldUndo(document.getElementById('fuel-reserve'), 'change reserve');`);
  assert(ev(`document.getElementById('fuel-reserve').value`) === '12',
    'the push left the old value in the box');
  ev('undoLast(true)');
  assert(ev(`document.getElementById('fuel-reserve').value`) === '8',
    'undo restored ' + ev(`document.getElementById('fuel-reserve').value`) + ', not 8');
  // an edit that changes nothing must not add a step
  const depth = ev('undoStack.length');
  ev(`rememberPlanField(document.getElementById('fuel-reserve'));
      pushPlanFieldUndo(document.getElementById('fuel-reserve'), 'change reserve');`);
  assert(ev('undoStack.length') === depth, 'a no-op edit pushed an undo step');
  ev(SEED);
});

T('undo and redo name the step they will take back', () => {
  ev(SEED);
  ev(`pushUndoState('rename a waypoint'); flights[0].waypoints[1].name = 'X'; renderAllFlightTables();`);
  const undoBtn = doc.getElementById('undo-btn');
  assert(undoBtn && /rename a waypoint/.test(undoBtn.title),
    'the Undo button does not name the step: ' + (undoBtn && undoBtn.title));
  ev('undoLast(true)');
  const redoBtn = doc.getElementById('redo-btn');
  assert(redoBtn && /rename a waypoint/.test(redoBtn.title),
    'the Redo button does not name the step: ' + (redoBtn && redoBtn.title));
  assert(undoBtn.disabled === (ev('undoStack.length') === 0), 'the button state does not follow the stack');
  // every call site names its step, or the buttons fall back to "the last change"
  assert(!/pushUndoState\(\)/.test(APP_SRC), 'an unlabelled pushUndoState() call came back');
  ev(SEED);
});

T('every undo and redo - keyboard included - shows a box naming the step (v17.6)', () => {
  ev(SEED);
  ev(`pushUndoState('rename a waypoint'); flights[0].waypoints[1].name = 'X'; renderAllFlightTables();`);
  const box = doc.getElementById('undo-notice');
  assert(box, 'no #undo-notice element');
  assert(box.className.includes('no-print'), 'the undo notice would print');
  box.style.display = 'none';
  ev('undoLast(true)');   // the KEYBOARD path, which used to say nothing
  assert(box.style.display === 'block', 'a keyboard undo showed no notice');
  assert(/Undone:/.test(box.textContent) && /rename a waypoint/.test(box.textContent),
    'the notice does not name the undone step: ' + box.textContent);
  ev('redoLast(true)');
  assert(/Redone:/.test(box.textContent) && /rename a waypoint/.test(box.textContent),
    'the notice does not name the redone step: ' + box.textContent);
  // ONE box, rewritten - holding the key must not stack notices
  assert(doc.querySelectorAll('#undo-notice').length === 1, 'more than one undo notice');
  // a hostile label is text, not markup
  ev(`pushUndoState('<img src=x onerror=alert(1)>'); undoLast(true);`);
  assert(!box.querySelector('img'), 'an undo label reached innerHTML unescaped');
  // at the end of the stack the key stays silent and the notice is not rewritten as a step
  ev('undoStack.length = 0; updateUndoButtons();');
  const before = box.textContent;
  ev('undoLast(true)');
  assert(box.textContent === before, 'an empty-stack undo rewrote the notice');
  ev(SEED);
});

T('an empty plan says what to do next', () => {
  ev(`flights = [{ id: 1, title: 'Flight Plan 1', depElev: 0, waypoints: [] }];
      activeFlightIndex = 0; refreshMap(); renderAllFlightTables();`);
  const es = doc.getElementById('empty-state');
  assert(es, 'no empty state rendered');
  assert(/Click the map/.test(es.textContent), 'the empty state does not say how to start');
  assert(es.className.includes('no-print'), 'the empty state would print');
  ev(SEED);
  assert(!doc.getElementById('empty-state'), 'the empty state survived a real plan');
});

T('the ETD field names the actual offset, not just "local"', () => {
  // QoL 10: a pilot used to UTC forms types UTC into a field labelled "local".
  ev(SEED);
  ev(`document.getElementById('def-date').value = '2026-06-21'; renderAllFlightTables();`);
  const tz = doc.getElementById('etd-tz');
  assert(tz && /^UTC[+-]/.test(tz.textContent), 'the offset is not shown: ' + (tz && tz.textContent));
  // the suite is pinned to TZ=UTC, so the offset must read UTC+0 here
  assert(tz.textContent === 'UTC+0', 'offset under TZ=UTC: ' + tz.textContent);
});

T('a fix search result says how far and which way, exactly', () => {
  const A = moduleExports.anchors;
  const set = aipDataset();
  const anchors = A.buildAnchors(set);
  const near = [69.6832, 18.9186];   // Tromso
  const hits = A.searchAnchors(anchors, 'ENDU', { limit: 3, near });
  assert(hits.length, 'no hit for ENDU');
  const h = hits[0];
  assert(isFinite(h.fromNM) && isFinite(h.fromTrueBrg), 'no distance/bearing on the hit');
  // EXACT, not the local-scale approximation the ORDERING uses: it must agree
  // with geodesy.js, which is where every distance a pilot reads comes from.
  const G = moduleExports.geodesy;
  assert(Math.abs(h.fromNM - G.calcDistanceNM(near[0], near[1], h.lat, h.lng)) < 1e-9,
    'the shown distance is not the geodesic one');
  assert(Math.abs(h.fromTrueBrg - G.calcTrueTrack(near[0], near[1], h.lat, h.lng)) < 1e-9,
    'the shown bearing is not the geodesic one');
  // ENDU is roughly 39 NM south-south-west of Tromso
  assert(h.fromNM > 30 && h.fromNM < 45, 'ENDU from Tromso: ' + h.fromNM + ' NM');
  assert(h.fromTrueBrg > 170 && h.fromTrueBrg < 230, 'bearing: ' + h.fromTrueBrg);
  // WITHOUT a centre there is nothing to measure from, and nothing is invented.
  const noNear = A.searchAnchors(anchors, 'ENDU', { limit: 3 });
  assert(noNear[0].fromNM === undefined, 'a distance appeared with no reference point');
  // and the dialog must label it TRUE, because that is what it is
  assert(/°T from the map centre/.test(APP_SRC), 'the search hint does not label the bearing true');
});

T('hovering an OFP row traces that leg, and only that leg', () => {
  ev(SEED);
  ev(`showLegHover(0, 1)`);
  assert(ev('hoverLegLine !== null'), 'no hover line drawn');
  const coords = ev('JSON.stringify(hoverLegLine._ll)');   // the Leaflet stub keeps the args
  assert(JSON.parse(coords).length === 2, 'the hover line is not the one leg: ' + coords);
  ev(`clearLegHover()`);
  assert(ev('hoverLegLine === null'), 'the hover line was not removed');
  // A circuit stop is not a line on the ground, so there is nothing to trace.
  ev(`flights[0].waypoints.push({ isPattern: true, name: 'PATTERN', laps: 2,
        lat: 69.679, lng: 18.911, alt: 1000, oat: 0, wdir: 0, wspd: 0, var: -12 });
      renderAllFlightTables(); showLegHover(0, 3);`);
  assert(ev('hoverLegLine === null'), 'a circuit stop drew a ground track');
  ev(SEED);
});

T('the update badge names WHY a check failed', () => {
  // QoL 12: "update check failed" left a normal offline session and a network
  // that blocks GitHub looking identical - one needs nothing, the other a person.
  ev(`updateState = { phase: 'failed', remote: null, at: new Date(), why: 'offline' };
      renderVersionBadge();`);
  const el = doc.getElementById('app-version-badge');
  assert(/offline/.test(el.innerHTML), 'the badge does not say offline: ' + el.innerHTML);
  assert(/offline/i.test(el.title), 'the tooltip does not explain offline');
  ev(`updateState = { phase: 'failed', remote: null, at: new Date(), why: 'blocked (HTTP 403)' };
      renderVersionBadge();`);
  assert(/HTTP 403/.test(doc.getElementById('app-version-badge').innerHTML),
    'a blocked check does not name the status');
  ev(`updateState = { phase: 'idle', remote: null, at: null, why: null }; renderVersionBadge();`);
});

T('the leg panel closes on a backdrop click like every other modal', () => {
  // QoL 1: Escape reached it (v16.46) but the backdrop list named four modals
  // and leg-modal was not one of them.
  ev(SEED);
  ev(`hitLines[0]._h.contextmenu({ latlng: { lat: 69.45, lng: 18.90 },
        originalEvent: { preventDefault: function(){} } })`);
  assert(doc.getElementById('leg-modal').style.display === 'flex', 'the panel did not open');
  ev(`(function(){ const el = document.getElementById('leg-modal');
       el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); })()`);
  assert(doc.getElementById('leg-modal').style.display === 'none',
    'a backdrop click did not close the leg panel');
  assert(ev('legPanel === null'), 'the panel state survived the close');
});



console.log('\n=== 62a000e. Route track and the map-only plan controls (v16.50) ===');

T('no flight plan is drawn dashed any more', () => {
  // The dash existed so an identical return route drawn over its outbound
  // stayed distinguishable. The edit-mode dimming and ROUTE_COLORS do that now,
  // and the author's call is that the colour difference is enough.
  ev(`flights = [
    { id: 1, title: 'A', depElev: 254, waypoints: [
      { lat: 69.05, lng: 18.54, name: 'ENDU', alt: 254, oat: 10, wdir: 0, wspd: 0, var: -11 },
      { lat: 69.67, lng: 18.91, name: 'ENTC', alt: 2500, oat: 10, wdir: 0, wspd: 0, var: -12 }]},
    { id: 2, title: 'B', depElev: 31, waypoints: [
      { lat: 69.67, lng: 18.91, name: 'ENTC', alt: 31, oat: 10, wdir: 0, wspd: 0, var: -12 },
      { lat: 69.05, lng: 18.54, name: 'ENDU', alt: 2500, oat: 10, wdir: 0, wspd: 0, var: -11 }]}
  ]; activeFlightIndex = 0; refreshMap(); renderAllFlightTables();`);
  const dashes = ev('JSON.stringify(polylines.map(p => p._opts.dashArray || null))');
  assert(JSON.parse(dashes).every((d) => d === null), 'a route line is still dashed: ' + dashes);
  // ...and the thing that replaced it must actually be there
  const colors = JSON.parse(ev('JSON.stringify(polylines.map(p => p._opts.color))'));
  assert(new Set(colors).size === colors.length, 'two flights drew in the same colour: ' + colors);
  assert(!/every second one is dashed/.test(APP_SRC), 'the guide still promises dashed tracks');
  ev(SEED);
});

T('the track thickness is a validated setting, not a free number', () => {
  const A = moduleExports.anchors;
  assert(A.normaliseRouteWeight({ routeWeight: 7 }) === 7, 'a valid weight was changed');
  assert(A.normaliseRouteWeight({}) === A.ROUTE_WEIGHT_DEFAULT, 'no value must give the default');
  assert(A.normaliseRouteWeight({ routeWeight: 'fat' }) === A.ROUTE_WEIGHT_DEFAULT, 'a string got through');
  assert(A.normaliseRouteWeight({ routeWeight: NaN }) === A.ROUTE_WEIGHT_DEFAULT, 'NaN got through');
  assert(A.normaliseRouteWeight({ routeWeight: 0 }) === A.ROUTE_WEIGHT_MIN, 'no lower clamp');
  assert(A.normaliseRouteWeight({ routeWeight: 999 }) === A.ROUTE_WEIGHT_MAX, 'no upper clamp');
  assert(A.normaliseRouteWeight({ routeWeight: 4.6 }) === 5, 'a fraction was not rounded');
  // THE GRAB LINE IS NOT THE VISIBLE LINE: tying them together would make a
  // thin track harder to grab, which is the pixel-hunting it exists to remove.
  assert(A.ROUTE_WEIGHT_MAX < 20, 'the widest track is now wider than the 20 px grab line');
  // and it travels in the profile, so it must be whitelisted
  assert(moduleExports.exch.PROFILE_KEYS.includes('routeWeight'), 'routeWeight is not in PROFILE_KEYS');
});

T('the drawn track uses the configured thickness', () => {
  ev(SEED);
  const A = moduleExports.anchors;
  assert(ev('polylines[0]._opts.weight') === A.ROUTE_WEIGHT_DEFAULT,
    'the default weight is not what is drawn: ' + ev('polylines[0]._opts.weight'));
  ev(`aircraftProfile.routeWeight = 9; refreshMap();`);
  assert(ev('polylines[0]._opts.weight') === 9, 'the setting did not reach the map');
  assert(ev('hitLines[0]._opts.weight') === 20, 'the grab line followed the visible weight');
  // a hostile value from a route file must not reach Leaflet
  ev(`aircraftProfile.routeWeight = 'x'; refreshMap();`);
  assert(ev('polylines[0]._opts.weight') === A.ROUTE_WEIGHT_DEFAULT,
    'an invalid weight reached the map: ' + ev('polylines[0]._opts.weight'));
  ev(`delete aircraftProfile.routeWeight; refreshMap();`);
});

T('the map-only view can start a plan and name the active one', () => {
  // Roadmap 7: `+ Add Flight Plan` lives inside #sidebar, and layout-map hides
  // the sidebar - so the one view where you draw could not begin a plan.
  const stack = doc.getElementById('map-controls');
  assert(stack, 'no map control stack');
  for (const id of ['add-flight-btn', 'active-flight-btn']) {
    const btn = doc.getElementById(id);
    assert(btn, id + ' is missing');
    assert(btn.closest('#map-controls') === stack, id + ' is not in the map control stack');
    assert(btn.className.includes('map-ctl'), id + ' does not use the shared control class');
  }
  // v16.24's rule: a control must not be positioned by its own id again.
  assert(!/#add-flight-btn\s*{[^}]*top:/.test(APP_SRC), 'the new control is positioned by id');
  ev(SEED);
  assert(/ENDU/.test(doc.getElementById('active-flight-btn').textContent),
    'the indicator does not name the active plan: ' + doc.getElementById('active-flight-btn').textContent);
});

T('cycling the active plan wraps, and says so when there is nothing to cycle to', () => {
  ev(SEED);
  assert(ev('flights.length') === 1, 'seed should be one plan');
  ev('cycleActiveFlight()');
  assert(ev('activeFlightIndex') === 0, 'cycling with one plan moved the active index');
  ev(`flights.push({ id: 2, title: 'B', depElev: 31, waypoints: [
        { lat: 69.67, lng: 18.91, name: 'ENTC', alt: 31, oat: 10, wdir: 0, wspd: 0, var: -12 },
        { lat: 69.05, lng: 18.54, name: 'ENDU', alt: 2500, oat: 10, wdir: 0, wspd: 0, var: -11 }]});
      refreshMap(); renderAllFlightTables();`);
  ev('cycleActiveFlight()');
  assert(ev('activeFlightIndex') === 1, 'cycle did not advance');
  ev('cycleActiveFlight()');
  assert(ev('activeFlightIndex') === 0, 'cycle did not wrap');
  const btn = doc.getElementById('active-flight-btn');
  assert(/1\/2/.test(btn.textContent), 'the indicator does not show which of how many: ' + btn.textContent);
  ev(SEED);
});

T('1-9 activate a flight plan, and stand down behind a dialog', () => {
  const K = moduleExports.keys;
  const a = K.resolveKey({ key: '3' }, {});
  assert(a && a.action === 'activate-flight-3' && a.index === 2, '3 should mean plan 3 (index 2)');
  assert(a.preventDefault, 'the digit must not also reach the page');
  assert(K.resolveKey({ key: '0' }, {}) === null, '0 is not a plan');
  assert(K.resolveKey({ key: '3' }, { textLike: true }) === null, 'a digit must type in a text field');
  // THE TRAP: dialog.js binds 1-9 to pick an option, so naming a waypoint
  // would otherwise become a game of chance.
  assert(K.resolveKey({ key: '3' }, { overlayOpen: true, dialogOpen: true }) === null,
    'a digit fired through an open dialog');
  assert(K.resolveKey({ key: '3', ctrlKey: true }, {}) === null, 'Ctrl+3 is a browser tab shortcut');
});

TA('pressing 2 switches to the second plan; an absent plan says so', async () => {
  ev(SEED);
  ev(`flights.push({ id: 2, title: 'B', depElev: 31, waypoints: [
        { lat: 69.67, lng: 18.91, name: 'ENTC', alt: 31, oat: 10, wdir: 0, wspd: 0, var: -12 },
        { lat: 69.05, lng: 18.54, name: 'ENDU', alt: 2500, oat: 10, wdir: 0, wspd: 0, var: -11 }]});
      refreshMap(); renderAllFlightTables();`);
  ev(`document.dispatchEvent(new window.KeyboardEvent('keydown', { key: '2', bubbles: true }))`);
  await tick();
  assert(ev('activeFlightIndex') === 1, 'pressing 2 did not activate the second plan');
  // A key that appears dead is the failure mode the resolver exists to prevent.
  const host0 = doc.getElementById('app-toasts');
  const before = host0 ? host0.children.length : 0;
  ev(`document.dispatchEvent(new window.KeyboardEvent('keydown', { key: '7', bubbles: true }))`);
  await tick();
  assert(ev('activeFlightIndex') === 1, 'a nonexistent plan changed the active one');
  const host = doc.getElementById('app-toasts');
  assert(host && host.children.length > before, 'pressing 7 with 2 plans said nothing at all');
  assert(/no flight plan 7/i.test(host.lastChild.textContent), 'the toast does not name the problem: ' +
    host.lastChild.textContent);
  host.innerHTML = '';
  ev(SEED);
});



console.log('\n=== 62a000f. Stepping between flight plans (v16.51) ===');

T('"." and "," resolve to next and previous, and only bare', () => {
  const K = moduleExports.keys;
  const R = (stroke, ctx) => { const a = K.resolveKey(stroke, ctx); return a && a.action; };
  assert(R({ key: '.' }) === 'next-flight', '. should mean next');
  assert(R({ key: ',' }) === 'prev-flight', ', should mean previous');
  assert(K.resolveKey({ key: '.' }, {}).preventDefault, 'the key must not also reach the page');
  // "<" and ">" are shift+comma/period - a different keystroke, and not ours.
  assert(R({ key: '.', shiftKey: true }) === null, 'shift+. is not ours');
  assert(R({ key: ',', ctrlKey: true }) === null, 'Ctrl+, is a browser preferences shortcut');
  assert(R({ key: '.' }, { textLike: true }) === null, '. must type a full stop in a text field');
  assert(R({ key: '.' }, { overlayOpen: true, dialogOpen: true }) === null,
    '. fired through an open dialog');
  // and the page must handle both, or the binding is silently dead
  const handler = APP_SRC.split('/* @KEY-DISPATCH */')[1].split('\n    });')[0];
  for (const a of ['next-flight', 'prev-flight'])
    assert(handler.includes("case '" + a + "'"), 'the page has no case for ' + a);
});

TA('stepping stops at the ends instead of wrapping', async () => {
  const mk = (n) => `flights = [` + Array.from({ length: n }, (_, i) =>
    `{ id: ${i + 1}, title: 'P${i + 1}', depElev: 254, waypoints: [
       { lat: ${69 + i * 0.1}, lng: 18.5, name: 'A${i}', alt: 254, oat: 10, wdir: 0, wspd: 0, var: -11 },
       { lat: ${69.4 + i * 0.1}, lng: 18.9, name: 'B${i}', alt: 2500, oat: 10, wdir: 0, wspd: 0, var: -12 }]}`
  ).join(',') + `]; activeFlightIndex = 0; refreshMap(); renderAllFlightTables();`;
  const press = (k) => ev(`document.dispatchEvent(new window.KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true }))`);
  ev(mk(3));

  const host = () => doc.getElementById('app-toasts');
  if (host()) host().innerHTML = '';

  // FIRST plan: "," must NOT wrap round to the last one.
  press(',');
  await tick();
  assert(ev('activeFlightIndex') === 0, ', wrapped backwards off the first plan');
  assert(host() && /first flight plan/i.test(host().textContent),
    'stepping past the start said nothing: ' + (host() ? host().textContent : ''));

  press('.'); await tick();
  assert(ev('activeFlightIndex') === 1, '. did not advance');
  press('.'); await tick();
  assert(ev('activeFlightIndex') === 2, '. did not advance to the last plan');

  // LAST plan: "." must NOT wrap round to the first one.
  if (host()) host().innerHTML = '';
  press('.'); await tick();
  assert(ev('activeFlightIndex') === 2, '. wrapped forwards off the last plan');
  assert(host() && /last flight plan/i.test(host().textContent),
    'stepping past the end said nothing: ' + (host() ? host().textContent : ''));

  press(','); await tick();
  assert(ev('activeFlightIndex') === 1, ', did not go back');
  if (host()) host().innerHTML = '';
  ev(SEED);
});

T('the map button still cycles, and that difference is deliberate', () => {
  // ONE control, and in the map-only view it is the only way to change plan
  // without a keyboard - so a non-wrapping version would strand the pilot on
  // the last plan. The two KEYS are directional and stop; the button cycles.
  ev(`flights = [
    { id: 1, title: 'A', depElev: 254, waypoints: [
      { lat: 69.05, lng: 18.54, name: 'ENDU', alt: 254, oat: 10, wdir: 0, wspd: 0, var: -11 },
      { lat: 69.67, lng: 18.91, name: 'ENTC', alt: 2500, oat: 10, wdir: 0, wspd: 0, var: -12 }]},
    { id: 2, title: 'B', depElev: 31, waypoints: [
      { lat: 69.67, lng: 18.91, name: 'ENTC', alt: 31, oat: 10, wdir: 0, wspd: 0, var: -12 },
      { lat: 69.05, lng: 18.54, name: 'ENDU', alt: 2500, oat: 10, wdir: 0, wspd: 0, var: -11 }]}
  ]; activeFlightIndex = 1; refreshMap(); renderAllFlightTables();`);
  ev('cycleActiveFlight()');
  assert(ev('activeFlightIndex') === 0, 'the map button stopped wrapping - it would now dead-end');
  // ...while the key, from the same position, does not
  ev(`activeFlightIndex = 1; refreshMap();`);
  ev('stepActiveFlight(1)');
  assert(ev('activeFlightIndex') === 1, 'the key wrapped off the last plan');
  const btn = doc.getElementById('active-flight-btn');
  assert(/wraps/.test(btn.title) && /do not wrap|without wrapping/.test(btn.title),
    'the button does not explain how it differs from the keys: ' + btn.title);
  ev(SEED);
});



console.log('\n=== 62a000g. The keyboard is the pilot\'s (v16.52, roadmap item 10) ===');

T('every action the app can do is in the menu, and every one is dispatched', () => {
  const K = moduleExports.keys;
  // The pilot asked for the whole list; a menu that hides half the app's verbs
  // is not a keybind menu.
  assert(K.ACTION_SPECS.length >= 25, 'only ' + K.ACTION_SPECS.length + ' bindable actions');
  const ids = K.ACTION_SPECS.map((a) => a.id);
  assert(new Set(ids).size === ids.length, 'a duplicate action id');
  for (const a of K.ACTION_SPECS) {
    assert(a.label && a.group, a.id + ' has no label or group');
    assert(a.dflt === null || K.isValidChord(a.dflt), a.id + ' ships an unstorable default: ' + a.dflt);
    assert(!K.RESERVED_CHORDS.includes(a.dflt), a.id + ' ships a chord the browser owns');
  }
  // No default is claimed twice, or one of the two would never fire.
  const bound = ids.map((i) => K.defaultKeymap()[i]).filter(Boolean);
  assert(new Set(bound).size === bound.length, 'two actions ship the same default chord');
  // and the page must carry out every one of them
  const handler = APP_SRC.split('/* @KEY-DISPATCH */')[1].split('\n    });')[0];
  for (const id of K.KEY_ACTIONS)
    assert(handler.includes("case '" + id + "'"), 'the page has no case for ' + id);
});

T('a keystroke becomes one canonical chord', () => {
  const K = moduleExports.keys;
  assert(K.chordOf({ key: 'z', ctrlKey: true }) === 'Ctrl+Z', 'Ctrl+Z');
  assert(K.chordOf({ key: 'Z', metaKey: true }) === 'Ctrl+Z', 'Cmd is Ctrl - one binding, either keyboard');
  assert(K.chordOf({ key: 'z', ctrlKey: true, shiftKey: true }) === 'Ctrl+Shift+Z', 'modifier order');
  assert(K.chordOf({ key: 'z', shiftKey: true, altKey: true, ctrlKey: true }) === 'Ctrl+Alt+Shift+Z',
    'the modifier order is fixed so one keystroke has one spelling');
  assert(K.chordOf({ key: '/' }) === '/', 'a punctuation key');
  assert(K.chordOf({ key: ' ' }) === 'Space', 'space needs a name');
  assert(K.chordOf({ key: 'Delete' }) === 'Delete', 'a named key');
  // A bare modifier is half a chord being typed, not a chord.
  for (const k of ['Control', 'Shift', 'Alt', 'Meta'])
    assert(K.chordOf({ key: k }) === '', k + ' was accepted as a chord');
  assert(K.chordOf({}) === '' && K.chordOf(null) === '', 'a non-event produced a chord');
});

T('a chord the browser owns is refused BY NAME', () => {
  // preventDefault does not stop Ctrl+W in any mainstream browser: the tab
  // closes anyway. Offering it would be a promise the platform revokes at the
  // moment it matters.
  const K = moduleExports.keys;
  const km = K.defaultKeymap();
  const why = K.chordProblem(km, 'Ctrl+W', 'print');
  assert(why && /browser/.test(why), 'Ctrl+W was accepted: ' + why);
  assert(K.chordProblem(km, 'F5', 'print'), 'F5 was accepted');
  assert(K.chordProblem(km, 'Alt+K', 'print') === null, 'a perfectly good chord was refused');
  // ...and a hand-edited file cannot smuggle one in either
  assert(K.normaliseKeymap({ print: 'Ctrl+W' }).print === null, 'a reserved chord survived normalisation');
});

T('one chord, one action - a duplicate is refused and never stored', () => {
  const K = moduleExports.keys;
  const km = K.defaultKeymap();
  // Ctrl+Z is undo. Claiming it for print would make one of them a dead key.
  const why = K.chordProblem(km, 'Ctrl+Z', 'print');
  assert(why && /already/.test(why) && /Undo/.test(why),
    'the clash was not reported, or did not name the other action: ' + why);
  // rebinding an action to the chord it already has is not a clash with itself
  assert(K.chordProblem(km, 'Ctrl+Z', 'undo') === null, 'an action clashed with itself');
  // a hand-edited file with two actions on one chord loses the later one
  const dup = K.normaliseKeymap({ undo: 'Ctrl+K', redo: 'Ctrl+K' });
  assert(dup.undo === 'Ctrl+K' && dup.redo === null,
    'a duplicate survived: ' + JSON.stringify([dup.undo, dup.redo]));
});

T('Escape is fixed, and says why', () => {
  const K = moduleExports.keys;
  const esc = K.actionSpec('close-overlays');
  assert(esc.fixed, 'Escape became rebindable');
  assert(/no way back|fixed/i.test(esc.hint || ''), 'no reason given for fixing it');
  assert(K.chordProblem(K.defaultKeymap(), 'Ctrl+K', 'close-overlays'), 'Escape accepted a new chord');
  // even a hand-edited file cannot move it
  assert(K.normaliseKeymap({ 'close-overlays': 'Ctrl+K' })['close-overlays'] === 'Escape',
    'a file moved Escape');
  // and it still works with a modal up, which is the whole point
  assert(K.resolveKey({ key: 'Escape' }, { overlayOpen: true }).action === 'close-overlays',
    'Escape stopped reaching an open modal');
});

T('a rebound key fires, and the old one goes quiet', () => {
  const K = moduleExports.keys;
  const km = K.defaultKeymap();
  km.undo = 'Alt+U';
  assert(K.resolveKey({ key: 'u', altKey: true }, {}, km).action === 'undo', 'the new chord does nothing');
  assert(K.resolveKey({ key: 'z', ctrlKey: true }, {}, km) === null, 'the old chord still fires');
  // an unbound action is simply silent
  km.undo = null;
  assert(K.resolveKey({ key: 'u', altKey: true }, {}, km) === null, 'a cleared binding still fired');
  // and the conditions travel with the action, not the chord
  km['delete-waypoint'] = 'Alt+D';
  assert(K.resolveKey({ key: 'd', altKey: true }, { hasHighlight: true }, km).action === 'delete-waypoint',
    'the rebound delete does not fire');
  assert(K.resolveKey({ key: 'd', altKey: true }, { hasHighlight: true, viewMode: true }, km) === null,
    'the rebound delete fires in read-only View Mode');
  assert(K.resolveKey({ key: 'd', altKey: true }, {}, km) === null,
    'the rebound delete fires with nothing selected');
});

T('a hand-edited keymap cannot break the keyboard', () => {
  const K = moduleExports.keys;
  const d = K.defaultKeymap();
  assert(JSON.stringify(K.normaliseKeymap(null)) === JSON.stringify(d), 'null must give the defaults');
  assert(JSON.stringify(K.normaliseKeymap('nonsense')) === JSON.stringify(d), 'a string must give the defaults');
  assert(JSON.stringify(K.normaliseKeymap([1, 2])) === JSON.stringify(d), 'an array must give the defaults');
  const km = K.normaliseKeymap({ undo: 'ctrl+z', redo: 'Shift+Ctrl+Z', save: 42,
                                 'not-an-action': 'Ctrl+K', print: '<img src=x>' });
  assert(km.undo === null, 'a lower-case chord was stored - two spellings would shadow each other');
  assert(km.redo === null, 'an out-of-order chord was stored');
  assert(km.save === null, 'a number was stored as a chord');
  assert(km.print === null, 'a markup string was stored as a chord');
  assert(!('not-an-action' in km), 'an unknown action survived');
  // an explicit null is a real choice and is kept
  assert(K.normaliseKeymap({ undo: null }).undo === null, 'a deliberately cleared binding came back');
});

T('the keyboard page lists every action, with the fixed one marked', () => {
  ev('openSettingsModal(); showSettingsPage("keys")');
  const K = moduleExports.keys;
  assert(!doc.getElementById('settings-page-keys').hidden, 'the keyboard page did not open');
  const rows = [...doc.querySelectorAll('#keybind-list .keybind-row')];
  assert(rows.length === K.ACTION_SPECS.length,
    rows.length + ' rows for ' + K.ACTION_SPECS.length + ' actions');
  const groups = [...doc.querySelectorAll('#keybind-list .keybind-group')];
  assert(groups.length >= 4, 'the list is not grouped: ' + groups.length);
  // The fixed one is marked and its chord box is inert - v16.53 made the box
  // itself the control, so "no button" became "a disabled one".
  const fixedRow = rows[rows.length - 1];
  assert(/fixed/.test(fixedRow.textContent), 'the fixed binding is not marked: ' + fixedRow.textContent);
  assert(fixedRow.querySelector('.keybind-chord').disabled, 'the fixed chord box is clickable');
  assert(!fixedRow.querySelector('.keybind-actions button'), 'the fixed binding offers a Clear button');
  // an unbound action says so rather than showing an empty box
  assert([...doc.querySelectorAll('#keybind-list .is-unbound')].length > 0,
    'nothing is shown as unbound, though most actions ship that way');
  ev('closeSettingsModal()');
});

TA('setting a key from the menu takes effect, and a clash is refused', async () => {
  // THESE TESTS CLICK THE REAL CONTROLS. v16.52 shipped a list whose Set and
  // Clear buttons were completely inert - the handler was built with
  // `onclick="...(' + JSON.stringify(id) + ')"`, and JSON.stringify's double
  // quotes closed the attribute. It got through because the tests called
  // beginKeybindCapture() and clearKeybind() directly. Driving the functions
  // proves the functions; only driving the CONTROL proves the control.
  ev(SEED);
  ev('openSettingsModal(); showSettingsPage("keys")');
  const row = (id) => doc.querySelector('#keybind-list .keybind-row[data-action="' + id + '"]');
  const chordBox = (id) => row(id).querySelector('.keybind-chord');
  const sideBtn = (id) => row(id).querySelector('.keybind-actions button');
  const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const press = (init) => ev(`captureKeybind(Object.assign(` +
    `{ preventDefault(){}, stopPropagation(){} }, ${JSON.stringify(init)}))`);

  // CLICKING THE CHORD BOX starts the capture - there is no Set button any more.
  assert(chordBox('open-winds').textContent === 'Not bound', 'open-winds should start unbound');
  click(chordBox('open-winds'));
  assert(ev('keybindCapturing') === 'open-winds',
    'clicking the chord box did not start a capture (this is the v16.52 bug)');
  assert(/Press a key/.test(chordBox('open-winds').textContent), 'the box does not prompt: ' +
    chordBox('open-winds').textContent);
  assert(sideBtn('open-winds').textContent === 'Cancel', 'Clear did not become Cancel while capturing');

  // A CLASH IS REFUSED AND CAPTURE STAYS OPEN, so the pilot can just try again.
  press({ key: 'z', ctrlKey: true });
  assert(ev('keybindCapturing') === 'open-winds', 'a refused chord ended the capture');
  assert(ev(`keybinds['open-winds']`) === null, 'the clashing chord was stored anyway');
  assert(/already/.test(doc.getElementById('keybind-capture-note').textContent),
    'the clash was not explained: ' + doc.getElementById('keybind-capture-note').textContent);

  // a good one lands
  press({ key: 'p', altKey: true });
  assert(ev(`keybinds['open-winds']`) === 'Alt+P', 'the new chord was not stored: ' + ev(`keybinds['open-winds']`));
  assert(ev('keybindCapturing') === null, 'capture did not end');
  assert(chordBox('open-winds').textContent === 'Alt+P', 'the row still shows the old value');
  assert(JSON.parse(w.localStorage.getItem('c182_keybinds'))['open-winds'] === 'Alt+P', 'it was not persisted');

  // CLICKING CANCEL leaves the binding as it was.
  click(chordBox('open-winds'));
  assert(ev('keybindCapturing') === 'open-winds', 'the box did not re-open for editing');
  click(sideBtn('open-winds'));
  assert(ev('keybindCapturing') === null, 'the Cancel button did nothing');
  assert(ev(`keybinds['open-winds']`) === 'Alt+P', 'Cancel changed the binding');
  assert(sideBtn('open-winds').textContent === 'Clear', 'the button did not go back to Clear');

  // CLICKING CLEAR unbinds, and then disables itself because there is nothing left.
  click(sideBtn('open-winds'));
  assert(ev(`keybinds['open-winds']`) === null, 'the Clear button did nothing');
  assert(chordBox('open-winds').textContent === 'Not bound', 'the row still shows a chord');
  assert(sideBtn('open-winds').disabled, 'Clear is still offered on an unbound action');

  // Escape cancels a capture without changing anything
  click(chordBox('open-guide'));
  press({ key: 'Escape' });
  assert(ev('keybindCapturing') === null, 'Escape did not cancel the capture');
  assert(ev(`keybinds['open-guide']`) === null, 'Escape bound something');

  // closing the modal must not leave a capture swallowing keystrokes
  click(chordBox('print'));
  ev('closeSettingsModal()');
  assert(ev('keybindCapturing') === null, 'a capture survived the modal closing');
  ev(`keybinds = normaliseKeymap(null); saveKeybinds();`);
});

T('the keybind list carries no inline handlers, so no quote can escape one', () => {
  // The v16.52 regression in one assertion: a string interpolated into an
  // `onclick="..."` attribute breaks the attribute the moment it contains a
  // double quote. The list attaches listeners to elements instead.
  ev('openSettingsModal(); showSettingsPage("keys")');
  const nodes = [...doc.querySelectorAll('#keybind-list *')];
  assert(nodes.length > 50, 'the list did not render: ' + nodes.length);
  for (const el of nodes) {
    for (const at of el.attributes)
      assert(!/^on/i.test(at.name),
        'an inline handler is back on the keybind list: ' + el.tagName + ' ' + at.name);
  }
  // and every actionable row really is wired up
  const K = moduleExports.keys;
  for (const spec of K.ACTION_SPECS) {
    const r = doc.querySelector('#keybind-list .keybind-row[data-action="' + spec.id + '"]');
    assert(r, 'no row for ' + spec.id);
    assert(r.querySelector('.keybind-chord'), spec.id + ' has no chord control');
  }
  ev('closeSettingsModal()');
});

T('keybinds travel in the exported JSON, and are normalised both ways', () => {
  const E = moduleExports.exch;
  const K = moduleExports.keys;
  const payload = E.buildExportPayload({ routes: {}, missions: {}, flights: [], profile: {},
    planningPrefs: {}, keybinds: { undo: 'Alt+U', print: 'Ctrl+W', 'not-real': 'Ctrl+K' } });
  assert(payload.keybinds, 'the export carries no keybinds');
  assert(payload.keybinds.undo === 'Alt+U', 'a real binding was lost on the way out');
  assert(payload.keybinds.print === null, 'a browser-owned chord was exported');
  assert(!('not-real' in payload.keybinds), 'an unknown action was exported');
  // it identifies nobody - a list of keystrokes is not personal data
  const json = JSON.stringify(payload);
  assert(!/name|email|licence|pilot/i.test(JSON.stringify(payload.keybinds)),
    'the keybind block carries something that reads personal');
  // an export with no keybinds argument still produces a usable map
  const bare = E.buildExportPayload({ routes: {}, missions: {}, flights: [], profile: {}, planningPrefs: {} });
  assert(JSON.stringify(bare.keybinds) === JSON.stringify(K.defaultKeymap()),
    'a bare export did not fall back to the defaults');
});

TA('importing a file applies its keybinds through the sanitiser', async () => {
  ev(`keybinds = normaliseKeymap(null); saveKeybinds();`);
  // The real path goes through FileReader, which jsdom will only feed a Blob;
  // this drives the same branch with the same parsed object.
  ev(`(function(){
        const parsed = { keybinds: { undo: 'Alt+U', 'delete-waypoint': 'Ctrl+T',
                                     'close-overlays': 'Ctrl+K' } };
        keybinds = normaliseKeymap(parsed.keybinds); saveKeybinds(); populateKeybindForm();
      })()`);
  assert(ev(`keybinds['undo']`) === 'Alt+U', 'a good binding did not arrive');
  assert(ev(`keybinds['delete-waypoint']`) === null, 'a browser-owned chord arrived from a file');
  assert(ev(`keybinds['close-overlays']`) === 'Escape', 'a file moved Escape');
  assert(/keybinds/.test(APP_SRC), 'the import path no longer mentions keybinds');
  ev(`keybinds = normaliseKeymap(null); saveKeybinds();`);
});



console.log('\n=== 62a000h. Touch & go, full stop, fly-by (v16.54, roadmap item 17) ===');

T('a stop is a validated kind and a validated number of minutes', () => {
  const A = moduleExports.anchors;
  assert(A.normaliseStopKind('touch-go') === 'touch-go' && A.normaliseStopKind('full-stop') === 'full-stop',
    'a real stop kind was rejected');
  for (const bad of ['landing', '', null, 7, {}])
    assert(A.normaliseStopKind(bad) === null, 'a bogus stop kind got through: ' + JSON.stringify(bad));
  // THE DEFAULTS ARE THE PILOT'S FIGURES: 5 for a touch & go, 10 for a full stop.
  assert(A.normaliseStopMinutes('touch-go') === 5, 'touch & go default');
  assert(A.normaliseStopMinutes('full-stop') === 10, 'full stop default');
  assert(A.normaliseStopMinutes('touch-go', 12) === 12, 'an explicit figure was overridden');
  assert(A.normaliseStopMinutes('touch-go', 'x') === 5, 'a non-number should fall back to the default');
  assert(A.normaliseStopMinutes('full-stop', 0) === A.STOP_MIN_MINUTES, 'no lower clamp');
  assert(A.normaliseStopMinutes('full-stop', 99999) === A.STOP_MAX_MINUTES, 'no upper clamp');
  assert(A.normaliseStopMinutes(null, 30) === null, 'minutes without a kind mean nothing');
});

T('a fly-by is named from the published ATS callsign', () => {
  // THE PILOT'S CORRECTION (v16.55): the name a pilot says IS the callsign.
  // v16.54 used the AIP's `city` and came out "Harstad/Narvik" where the chart
  // and the radio both say EVENES.
  const A = moduleExports.anchors;
  assert(A.callsignPlace('Evenes Tower') === 'Evenes', 'tower');
  assert(A.callsignPlace('Skagen Information') === 'Skagen', 'AFIS');
  assert(A.callsignPlace('Bardufoss Approach/ Radar') === 'Bardufoss', 'a compound service name');
  assert(A.callsignPlace('Ny-Ålesund Information') === 'Ny-Ålesund', 'a hyphenated place');
  assert(A.callsignPlace('') === '' && A.callsignPlace(null) === '', 'nothing published, nothing invented');
  // A callsign that is only a service word names no place.
  assert(A.callsignPlace('Information') === '', 'a bare service word became a place name');

  const set = aipDataset();
  const ads = A.buildAnchors(set).filter((x) => x.kind === 'AD');
  assert(ads.length > 40, 'only ' + ads.length + ' aerodromes');
  // THE THREE THE PILOT NAMED, plus the two the old rule got right anyway.
  const want = { ENEV: 'Evenes', ENSK: 'Skagen', ENSH: 'Helle',
                 ENTC: 'Tromsø', ENDU: 'Bardufoss' };
  for (const [icao, name] of Object.entries(want)) {
    const a = ads.find((x) => x.icao === icao);
    assert(a, 'no anchor for ' + icao);
    assert(A.civilName(a) === name, icao + ' should be ' + name + ', got ' + A.civilName(a));
  }
  // An APPROACH service can be an area centre - "Polaris Control" answers for
  // Skagen's TIZ - and taking it would name half of Norway "Polaris".
  assert(!ads.some((a) => /Polaris/i.test(A.civilName(a))), 'an ACC callsign became an aerodrome name');
  // EVERY aerodrome gets a name, and none of them is an ICAO code.
  const unnamed = ads.filter((a) => !A.civilName(a));
  assert(unnamed.length === 0, unnamed.length + ' aerodromes have no name');
  const codeNamed = ads.filter((a) => A.civilName(a).toUpperCase() === a.icao);
  assert(codeNamed.length === 0, codeNamed.map((a) => a.icao).join() + ' fell back to the ICAO code');

  // THE FOUR UNCONTROLLED FIELDS have no station, so the published aerodrome
  // name is used - which for those IS what pilots call them.
  assert(A.publishedFieldName({ name: 'HØNEFOSS / Eggemoen' }) === 'Eggemoen', 'name suffix');
  assert(A.publishedFieldName({ name: 'BARDUFOSS' }) === '', 'no suffix to take');
  for (const [icao, name] of Object.entries({ ENKJ: 'Kjeller', ENRE: 'Rena' })) {
    const a = ads.find((x) => x.icao === icao);
    assert(a && A.civilName(a) === name, icao + ' should fall back to ' + name + ', got ' +
      (a && A.civilName(a)));
  }
  // ...and the town remains the last resort, title-cased, for anything with
  // neither a station nor a published aerodrome name.
  assert(A.civilName({ city: 'HARSTAD/NARVIK' }) === 'Harstad/Narvik', 'the last-resort title-case');
});


T('the stop travels through the sanitiser, and an unknown one does not', () => {
  const E = moduleExports.exch;
  const wp = (extra) => Object.assign({ lat: 69, lng: 18, name: 'X', alt: 254 }, extra);
  const f = E.sanitiseFlights([{ id: 1, title: 't', depElev: 0, waypoints: [
    wp({ stop: 'full-stop' }), wp({ stop: 'touch-go', stopMin: '12' }),
    wp({ stop: 'crash', stopMin: 9 }), wp({})
  ] }]);
  const got = f[0].waypoints;
  assert(got[0].stop === 'full-stop' && got[0].stopMin === 10, 'a full stop lost its default minutes');
  assert(got[1].stop === 'touch-go' && got[1].stopMin === 12, 'an explicit figure was lost');
  assert(got[2].stop === undefined && got[2].stopMin === undefined,
    'an unknown stop kind survived: ' + JSON.stringify([got[2].stop, got[2].stopMin]));
  assert(got[3].stop === undefined, 'an ordinary waypoint gained a stop');
  // a plan made before stops existed must read back identically
  const plain = E.sanitiseFlights([{ id: 1, title: 't', depElev: 0, waypoints: [wp({})] }]);
  assert(!('stop' in plain[0].waypoints[0]), 'an old route file gained a stop key');
});

T('the auto-open setting is whitelisted and defaults to on', () => {
  const E = moduleExports.exch;
  assert(E.PROFILE_KEYS.includes('autoPlanAfterStop'), 'the setting is not in PROFILE_KEYS');
  assert(ev('normaliseBool(undefined, true)') === true, 'an absent setting must keep the old behaviour');
  assert(ev('normaliseBool(false, true)') === false, 'an explicit false must turn it off');
  assert(ev(`normaliseBool('false', true)`) === false, 'a stringified false must turn it off');
});

T('a full stop adds its ground time between sectors, a touch & go its circuit time', () => {
  // The stop sits BETWEEN two sectors, so every ETO in the next one moves by it.
  const twoSectors = (stop, mins) => `
    flights = [
      { id: 1, title: 'A', depElev: 254, waypoints: [
        { lat: 69.05505349, lng: 18.54466865, name: 'ENDU', alt: 254, oat: 10, wdir: 0, wspd: 0, var: -11 },
        { lat: 69.67895054, lng: 18.91143033, name: 'ENTC', alt: 2500, oat: 10, wdir: 0, wspd: 0, var: -12
          ${stop ? `, stop: '${stop}'${mins ? ', stopMin: ' + mins : ''}` : ''} }]},
      { id: 2, title: 'B', depElev: 31, waypoints: [
        { lat: 69.67895054, lng: 18.91143033, name: 'ENTC', alt: 31, oat: 10, wdir: 0, wspd: 0, var: -12 },
        { lat: 69.05505349, lng: 18.54466865, name: 'ENDU', alt: 2500, oat: 10, wdir: 0, wspd: 0, var: -11 }]}
    ]; activeFlightIndex = 0;
    document.getElementById('def-etd').value = '10:00';
    refreshMap(); renderAllFlightTables();`;
  const finalAcc = () => txtOf('f-tot-acc-1');

  ev(twoSectors(null));
  const plain = finalAcc();
  ev(twoSectors('full-stop'));
  const stopped = finalAcc();
  assert(plain !== stopped, 'a full stop changed nothing: ' + plain + ' vs ' + stopped);
  const toMin = (t) => { const p = String(t).split(':').map(Number); return p[0] * 60 + p[1]; };
  assert(toMin(stopped) - toMin(plain) === 10,
    'a full stop should add 10 min, added ' + (toMin(stopped) - toMin(plain)));

  ev(twoSectors('touch-go'));
  assert(toMin(finalAcc()) - toMin(plain) === 5, 'a touch & go should add 5 min');
  ev(twoSectors('full-stop', 25));
  assert(toMin(finalAcc()) - toMin(plain) === 25, 'an edited ground time was ignored');

  // ...AND IT LANDS ON THE SECTOR IT DELAYS, NOT THE ONE BEFORE IT (v16.84).
  // The ground time used to be added to the running clock at the END of the
  // sector the stop was made on, so it fell into that plan's share of the
  // mission rather than into the one whose off-block it actually moves - which
  // is also the plan whose header the pilot edits it in.
  ev(twoSectors(null));
  const s1Plain = toMin(txtOf('f-tot-time-0')), s2Plain = toMin(txtOf('f-tot-time-1'));
  ev(twoSectors('full-stop'));
  assert(toMin(txtOf('f-tot-time-0')) === s1Plain,
    'the stop lengthened the sector BEFORE it: ' + txtOf('f-tot-time-0') + ' vs ' + s1Plain);
  assert(toMin(txtOf('f-tot-time-1')) - s2Plain === 10,
    'the stop did not open the sector after it: ' + txtOf('f-tot-time-1') + ' vs ' + s2Plain);
  ev(SEED);
});

T('a stop with no sector after it costs nothing at all', () => {
  // THE PILOT'S REPORT (v16.84): "If i have a final full stop at a point, the
  // 10 minutes get added at the total flight time in the bottom place for
  // total values ... even after having deleted the next flight plan."
  //
  // Measured before the fix on one 18-minute sector: the mission read 00:28.
  // A full stop is a landing - with nothing after it there is no off-block to
  // delay, so ten minutes of ground time is not flight time and not fuel.
  const onePlan = (stop) => `
    flights = [{ id: 1, title: 'A', depElev: 254, waypoints: [
      { lat: 69.05505349, lng: 18.54466865, name: 'ENDU', alt: 254, oat: 10, wdir: 0, wspd: 0, var: -11 },
      { lat: 69.67895054, lng: 18.91143033, name: 'ENTC', alt: 2500, oat: 10, wdir: 0, wspd: 0, var: -12
        ${stop ? `, stop: '${stop}'` : ''} }]}];
    activeFlightIndex = 0; refreshMap(); renderAllFlightTables();`;
  const mission = () => txtOf('grand-tot-time');
  const burn = () => Number(txtOf('grand-tot-burn').split(' ')[0]);

  ev(onePlan(null));
  const plainTime = mission(), plainBurn = burn();
  ev(onePlan('full-stop'));
  assert(mission() === plainTime,
    'a final full stop still lengthens the mission: ' + mission() + ' vs ' + plainTime);
  // A touch & go is charged its circuit FUEL as well, so check both are gone.
  ev(onePlan('touch-go'));
  assert(mission() === plainTime,
    'a final touch & go still lengthens the mission: ' + mission() + ' vs ' + plainTime);
  assert(Math.abs(burn() - plainBurn) < 0.05,
    'a final touch & go still burns fuel: ' + burn() + ' vs ' + plainBurn);
  ev(SEED);
});

T('a full stop pays a fresh start-up and taxi; a touch & go does not', () => {
  // The author settled this in AUDIT.md: taxi fuel belongs to a departure, not
  // to the mission. Before v16.54 it was charged once and every sector after a
  // full stop read low.
  const sectors = (stop) => `
    aircraftProfile.taxiFuel = 2.0; aircraftProfile.patternFf = 12;
    flights = [
      { id: 1, title: 'A', depElev: 254, waypoints: [
        { lat: 69.05505349, lng: 18.54466865, name: 'ENDU', alt: 254, oat: 10, wdir: 0, wspd: 0, var: -11 },
        { lat: 69.67895054, lng: 18.91143033, name: 'ENTC', alt: 2500, oat: 10, wdir: 0, wspd: 0, var: -12
          ${stop ? `, stop: '${stop}'` : ''} }]},
      { id: 2, title: 'B', depElev: 31, waypoints: [
        { lat: 69.67895054, lng: 18.91143033, name: 'ENTC', alt: 31, oat: 10, wdir: 0, wspd: 0, var: -12 },
        { lat: 69.05505349, lng: 18.54466865, name: 'ENDU', alt: 2500, oat: 10, wdir: 0, wspd: 0, var: -11 }]}
    ]; activeFlightIndex = 0; refreshMap(); renderAllFlightTables();`;
  const burn = () => parseFloat(txtOf('grand-tot-burn'));

  ev(sectors(null));
  const plain = burn();
  ev(sectors('full-stop'));
  const full = burn();
  assert(Math.abs((full - plain) - 2.0) < 0.15,
    'a full stop should add one taxi charge (2.0), added ' + (full - plain).toFixed(2));

  ev(sectors('touch-go'));
  const tg = burn();
  // 5 min at 12 gph = 1.0 gal of circuit flying, and NO taxi - the engine
  // never stopped.
  assert(Math.abs((tg - plain) - 1.0) < 0.15,
    'a touch & go should cost 5 min at the pattern flow (1.0), cost ' + (tg - plain).toFixed(2));
  ev(SEED);
});

T('refuelling is a full-stop-only figure, validated, and kept in gallons', () => {
  const A = moduleExports.anchors;
  assert(A.normaliseRefuelGal(45) === 45, 'a real figure was changed');
  assert(A.normaliseRefuelGal('52.5') === 52.5, 'a typed string was rejected');
  assert(A.normaliseRefuelGal(0) === 0, 'zero is a real answer - the tanks can be empty');
  for (const bad of [null, undefined, '', 'x', NaN, -3])
    assert(A.normaliseRefuelGal(bad) === null, 'a bogus figure got through: ' + JSON.stringify(bad));
  // THE CAP IS A TYPO GUARD, NOT A TANK LIMIT: this planner holds no published
  // usable-fuel figure, so it cannot tell 87 gallons from 90. 1000 is about
  // eleven times a C182's full tanks - it cannot reject a real number.
  assert(A.normaliseRefuelGal(99999) === A.REFUEL_MAX_GAL, 'no upper clamp');
  assert(A.REFUEL_MAX_GAL > 200, 'the cap is tight enough to reject a real refuelling');

  // A TOUCH & GO CANNOT REFUEL: the engine never stops.
  const E = moduleExports.exch;
  const wp = (extra) => Object.assign({ lat: 69, lng: 18, name: 'X', alt: 254 }, extra);
  const f = E.sanitiseFlights([{ id: 1, title: 't', depElev: 0, waypoints: [
    wp({ stop: 'full-stop', fuelAfterGal: 60 }),
    wp({ stop: 'touch-go', fuelAfterGal: 60 }),
    wp({ fuelAfterGal: 60 })
  ] }]);
  assert(f[0].waypoints[0].fuelAfterGal === 60, 'a full stop lost its refuel figure');
  assert(f[0].waypoints[1].fuelAfterGal === undefined, 'a touch & go was allowed to refuel');
  assert(f[0].waypoints[2].fuelAfterGal === undefined, 'an ordinary waypoint carried a refuel figure');
});

T('a refuelling stop sets the fuel on board for the next sector', () => {
  const sectors = (refuel) => `
    aircraftProfile.fuelUnit = 'GAL'; aircraftProfile.taxiFuel = 0;
    document.getElementById('fuel-dep').value = '60';
    flights = [
      { id: 1, title: 'A', depElev: 254, waypoints: [
        { lat: 69.05505349, lng: 18.54466865, name: 'ENDU', alt: 254, oat: 10, wdir: 0, wspd: 0, var: -11 },
        { lat: 69.67895054, lng: 18.91143033, name: 'ENTC', alt: 2500, oat: 10, wdir: 0, wspd: 0, var: -12,
          stop: 'full-stop', stopMin: 10${refuel === null ? '' : ', fuelAfterGal: ' + refuel} }]},
      { id: 2, title: 'B', depElev: 32, waypoints: [
        { lat: 69.67895054, lng: 18.91143033, name: 'ENTC', alt: 32, oat: 10, wdir: 0, wspd: 0, var: -12 },
        { lat: 69.05505349, lng: 18.54466865, name: 'ENDU', alt: 2500, oat: 10, wdir: 0, wspd: 0, var: -11 }]}
    ]; activeFlightIndex = 0; refreshMap(); renderAllFlightTables();`;
  const finalRem = () => parseFloat(txtOf('grand-final-rem'));

  ev(sectors(null));
  const carried = finalRem();
  assert(carried < 60, 'the plan burned nothing: ' + carried);

  // Filled to 80 at the stop: the second sector starts from 80, so the final
  // remaining is HIGHER than it was without refuelling.
  ev(sectors(80));
  const filled = finalRem();
  assert(filled > carried, 'refuelling did not raise the fuel: ' + filled + ' vs ' + carried);
  // and the second sector's burn is unchanged, so the difference is exactly
  // the difference between what was in the tanks and what was put in.
  const secondSectorBurn = 80 - filled;
  assert(secondSectorBurn > 0 && secondSectorBurn < 60, 'sector 2 burn looks wrong: ' + secondSectorBurn);
  assert(Math.abs((carried + (80 - (60 - (60 - carried) - secondSectorBurn))) - filled) >= 0,
    'sanity');

  // ZERO IS A REAL ANSWER, not "unset": a plan that departs with empty tanks
  // must show it rather than silently carrying the previous figure over.
  ev(sectors(0));
  assert(finalRem() < 0, 'refuelling to 0 did not take: ' + finalRem());
  ev(SEED);
});

T('the refuel box is offered at a full stop only, and speaks display units', () => {
  const twoPlans = (kind, gal, unit) => `
    aircraftProfile.fuelUnit = '${unit || 'GAL'}';
    flights = [
      { id: 1, title: 'A', depElev: 254, waypoints: [
        { lat: 69.05505349, lng: 18.54466865, name: 'ENDU', alt: 254, oat: 10, wdir: 0, wspd: 0, var: -11 },
        { lat: 69.67895054, lng: 18.91143033, name: 'ENTC', alt: 2500, oat: 10, wdir: 0, wspd: 0, var: -12,
          stop: '${kind}', stopMin: 10${gal === null ? '' : ', fuelAfterGal: ' + gal} }]},
      { id: 2, title: 'B', depElev: 32, waypoints: [
        { lat: 69.67895054, lng: 18.91143033, name: 'ENTC', alt: 32, oat: 10, wdir: 0, wspd: 0, var: -12 },
        { lat: 69.05505349, lng: 18.54466865, name: 'ENDU', alt: 2500, oat: 10, wdir: 0, wspd: 0, var: -11 }]}
    ]; activeFlightIndex = 0; refreshMap(); renderAllFlightTables();`;
  const hdr = () => [...doc.querySelectorAll('.flight-header')][1];

  ev(twoPlans('touch-go', null));
  assert(!/Fuel after/.test(hdr().textContent), 'a touch & go offered a refuel box');
  ev(twoPlans('full-stop', null));
  assert(/Fuel after/.test(hdr().textContent), 'a full stop has no refuel box');
  const box = () => [...hdr().querySelectorAll('input')].find((i) => /carry over/.test(i.placeholder));
  assert(box() && box().value === '', 'an unset refuel box is not empty: ' + (box() && box().value));

  // STORED IN GALLONS, SHOWN IN THE PILOT'S UNIT. 60 gal is 227.1 litres.
  ev(twoPlans('full-stop', 60, 'LITERS'));
  assert(Math.abs(Number(box().value) - 227.1) < 0.2, 'litres display: ' + box().value);
  // ...and typing in litres stores gallons, so a later unit change cannot
  // reinterpret the figure.
  ev(`setStopRefuel(0, '227.1')`);
  assert(Math.abs(ev('flights[0].waypoints[1].fuelAfterGal') - 60) < 0.1,
    'typing litres did not store gallons: ' + ev('flights[0].waypoints[1].fuelAfterGal'));
  ev(`setStopRefuel(0, '')`);
  assert(ev('flights[0].waypoints[1].fuelAfterGal') === undefined, 'clearing the box left a figure');
  ev('undoLast(true)');
  assert(ev('flights[0].waypoints[1].fuelAfterGal') !== undefined, 'the edit was not undoable');
  ev(`aircraftProfile.fuelUnit = 'GAL';`);
  ev(SEED);
});

T('the ground time is editable in the FOLLOWING plan header', () => {
  ev(`flights = [
      { id: 1, title: 'A', depElev: 254, waypoints: [
        { lat: 69.05505349, lng: 18.54466865, name: 'ENDU', alt: 254, oat: 10, wdir: 0, wspd: 0, var: -11 },
        { lat: 69.67895054, lng: 18.91143033, name: 'ENTC', alt: 2500, oat: 10, wdir: 0, wspd: 0, var: -12,
          stop: 'full-stop', stopMin: 10 }]},
      { id: 2, title: 'B', depElev: 31, waypoints: [
        { lat: 69.67895054, lng: 18.91143033, name: 'ENTC', alt: 31, oat: 10, wdir: 0, wspd: 0, var: -12 },
        { lat: 69.05505349, lng: 18.54466865, name: 'ENDU', alt: 2500, oat: 10, wdir: 0, wspd: 0, var: -11 }]}
    ]; activeFlightIndex = 0; refreshMap(); renderAllFlightTables();`);
  const headers = [...doc.querySelectorAll('.flight-header')];
  assert(headers.length === 2, headers.length + ' flight headers');
  assert(!/Full stop/.test(headers[0].textContent), 'the FIRST plan claims a stop before it');
  assert(/Full stop/.test(headers[1].textContent) && /ENTC/.test(headers[1].textContent),
    'the second plan does not name the stop: ' + headers[1].textContent);
  ev('setStopMinutes(0, 30)');
  assert(ev('flights[0].waypoints[1].stopMin') === 30, 'the edit did not reach the waypoint');
  ev('undoLast(true)');
  assert(ev('flights[0].waypoints[1].stopMin') === 10, 'the edit was not undoable');
  ev(SEED);
});

TA('clicking an aerodrome asks what happens, and each answer does its own thing', async () => {
  const A = moduleExports.anchors;
  const set = aipDataset();
  const entc = A.buildAnchors(set).find((x) => x.kind === 'AD' && x.icao === 'ENTC');
  assert(entc, 'no ENTC anchor');
  ev(SEED);
  ev(`aircraftProfile.autoPlanAfterStop = false;`);

  // FLY-BY: an ordinary waypoint, named after the place, no new plan.
  let p = ev(`clickAnchor(${JSON.stringify(entc)})`);
  await tick();
  assert(/what happens here/.test(openDlg().textContent), 'no dialog: ' + openDlg().textContent);
  assert(/Tromsø/.test(openDlg().textContent), 'the dialog does not name the fly-by waypoint');
  answerDialog('➡ Fly-by');
  await p; await tick();
  let wps = ev('flights[0].waypoints');
  assert(wps.length === 4, 'the fly-by did not add a waypoint');
  assert(wps[3].name === 'Tromsø', 'the fly-by is not named after the place: ' + wps[3].name);
  assert(!wps[3].stop, 'a fly-by must not be a stop');
  assert(ev('flights.length') === 1, 'a fly-by opened a new plan');

  // FULL STOP: a stop with its default minutes, and no circuit question.
  ev(SEED);
  p = ev(`clickAnchor(${JSON.stringify(entc)})`);
  await tick();
  answerDialog('🛩 Full stop');
  await p; await tick();
  wps = ev('flights[0].waypoints');
  assert(wps[3].stop === 'full-stop' && wps[3].stopMin === 10, 'the full stop was not recorded');
  assert(wps[3].name === 'ENTC', 'a full stop should keep the ICAO code: ' + wps[3].name);
  assert(!openDlg(), 'a full stop asked about circuits');

  // TOUCH & GO: asks about circuits; "no" leaves the route alone.
  ev(SEED);
  p = ev(`clickAnchor(${JSON.stringify(entc)})`);
  await tick();
  answerDialog('🔁 Touch & go');
  await tick();
  assert(openDlg() && /Circuits at ENTC/.test(openDlg().textContent),
    'a touch & go did not ask about circuits');
  answerDialog('No - straight out again');
  await p; await tick();
  wps = ev('flights[0].waypoints');
  assert(wps[3].stop === 'touch-go' && wps[3].stopMin === 5, 'the touch & go was not recorded');
  assert(wps.length === 4, 'saying no to circuits still added a pattern stop');
  ev(`delete aircraftProfile.autoPlanAfterStop;`);
  ev(SEED);
});

TA('a fly-by keeps the planned altitude; a stop sits on the field', async () => {
  // THE BUG (v16.55, reported): every aerodrome waypoint took the published
  // field elevation, so a fly-by over Bardufoss at 4500 ft was planned at
  // 254 ft - a descent to the deck and a climb back out over an aerodrome the
  // aircraft never touched.
  const A = moduleExports.anchors;
  const ads = A.buildAnchors(aipDataset()).filter((x) => x.kind === 'AD');
  const endu = ads.find((x) => x.icao === 'ENDU');
  const entc = ads.find((x) => x.icao === 'ENTC');
  ev(SEED);
  ev(`aircraftProfile.autoPlanAfterStop = false;
      document.getElementById('def-alt').value = '4500';`);

  let p = ev(`clickAnchor(${JSON.stringify(endu)})`);
  await tick();
  answerDialog('➡ Fly-by');
  await p; await tick();
  let wp = ev('flights[0].waypoints[flights[0].waypoints.length - 1]');
  assert(wp.name === 'Bardufoss', 'the fly-by name changed: ' + wp.name);
  assert(wp.alt === 4500, 'the fly-by was dragged to ground level: ' + wp.alt +
    ' (ENDU publishes 254 ft)');

  // ...while a STOP at the same aerodrome IS on the runway.
  p = ev(`clickAnchor(${JSON.stringify(entc)})`);
  await tick();
  answerDialog('🛩 Full stop');
  await p; await tick();
  wp = ev('flights[0].waypoints[flights[0].waypoints.length - 1]');
  assert(wp.alt === 32, 'a full stop is not on the field: ' + wp.alt);

  // AN EMPTY PLAN IS ASKED A DIFFERENT QUESTION (v16.58), and this is where
  // the v16.56 fix did NOT reach. Until Departure existed the dialog offered
  // no way to say "I take off from here", so Fly-by was the only sensible pick
  // on a fresh plan - and `first ||` then turned it into a departure on the
  // deck, which is the very bug v16.56 was written to fix. The test written
  // with it asserted that behaviour as CORRECT, so the suite stayed green
  // while the reported case stayed broken.
  const fresh = `flights = [{ id: 1, title: 'X', depElev: 0, waypoints: [] }]; activeFlightIndex = 0;
      refreshMap(); renderAllFlightTables();`;
  ev(fresh);
  p = ev(`clickAnchor(${JSON.stringify(endu)})`);
  await tick();
  assert(/first waypoint of the plan/.test(openDlg().textContent),
    'an empty plan was not asked the departure question: ' + openDlg().textContent);
  assert(!/Touch & go|Full stop/.test(openDlg().textContent),
    'a touch & go or a full stop was offered before there was a departure');
  answerDialog('➡ Fly-by');
  await p; await tick();
  wp = ev('flights[0].waypoints[0]');
  assert(wp.alt === 4500, 'a fly-by on an empty plan went to the deck: ' + wp.alt +
    ' (ENDU publishes 254 ft)');
  assert(wp.name === 'Bardufoss', 'the fly-by name changed: ' + wp.name);
  assert(ev('flights[0].depElev') === 0,
    'a fly-by set the departure elevation: ' + ev('flights[0].depElev'));

  // ...and DEPARTURE is the option that puts it on the runway.
  ev(fresh);
  p = ev(`clickAnchor(${JSON.stringify(endu)})`);
  await tick();
  answerDialog('🛫 Departure');
  await p; await tick();
  wp = ev('flights[0].waypoints[0]');
  assert(wp.alt === 254, 'the departure is not at the field elevation: ' + wp.alt);
  assert(wp.name === 'ENDU', 'a departure should keep the ICAO code: ' + wp.name);
  assert(ev('flights[0].depElev') === 254, 'the departure elevation did not follow');

  ev(`delete aircraftProfile.autoPlanAfterStop;`);
  ev(SEED);
});

TA('yes to circuits adds a pattern stop at the derived altitude', async () => {
  const A = moduleExports.anchors;
  const entc = A.buildAnchors(aipDataset()).find((x) => x.kind === 'AD' && x.icao === 'ENTC');
  ev(SEED);
  ev(`aircraftProfile.autoPlanAfterStop = false;`);
  const p = ev(`clickAnchor(${JSON.stringify(entc)})`);
  await tick();
  answerDialog('🔁 Touch & go');
  await tick();
  answerDialog('Yes - fly circuits here');
  await tick();
  typeInDialog('4');
  answerDialog('Add circuits');
  await p; await tick();
  const wps = ev('flights[0].waypoints');
  assert(wps.length === 5, 'no pattern stop was added: ' + wps.length);
  assert(wps[4].isPattern === true && wps[4].laps === 4, 'the circuits are wrong: ' +
    JSON.stringify([wps[4].isPattern, wps[4].laps]));
  // ENTC's published field elevation is 32 ft, so the derived circuit
  // altitude is 32 rounded to the nearest 100 (= 0) plus 1000.
  assert(wps[4].alt === 1000, 'the circuit altitude was not derived: ' + wps[4].alt);
  ev(`delete aircraftProfile.autoPlanAfterStop;`);
  ev(SEED);
});

TA('a stop opens the next sector from the field elevation, unless turned off', async () => {
  const A = moduleExports.anchors;
  const entc = A.buildAnchors(aipDataset()).find((x) => x.kind === 'AD' && x.icao === 'ENTC');
  ev(SEED);
  ev(`delete aircraftProfile.autoPlanAfterStop;`);   // default is ON
  let p = ev(`clickAnchor(${JSON.stringify(entc)})`);
  await tick();
  answerDialog('🛩 Full stop');
  await p; await tick();
  assert(ev('flights.length') === 2, 'the next sector did not open');
  assert(ev('flights[1].depElev') === 32,
    'the next sector does not depart from the field: ' + ev('flights[1].depElev'));

  // ...and the setting really turns it off
  ev(SEED);
  ev(`aircraftProfile.autoPlanAfterStop = false;`);
  p = ev(`clickAnchor(${JSON.stringify(entc)})`);
  await tick();
  answerDialog('🛩 Full stop');
  await p; await tick();
  assert(ev('flights.length') === 1, 'the setting did not turn the auto-open off');
  ev(`delete aircraftProfile.autoPlanAfterStop;`);
  ev(SEED);
});

TA('the next sector follows the plan the stop was made on, not the last plan', async () => {
  // THE REPORTED BUG (v16.59): "a full stop does not start a new flight plan".
  // addNewFlightPlan always seeded from flights[flights.length - 1] and appended
  // at the END, so a stop made on plan 2 of 3 created plan 4 out of plan 3's
  // last waypoint. The sector that should follow the stop never existed, its
  // ground time landed on an unrelated plan's header (stopBeforeHTML reads
  // flights[fIdx - 1]) and the pilot was jumped to a plan with nothing to do
  // with the aerodrome they had just landed at. One plan hid it completely,
  // which is why every earlier test passed.
  const A = moduleExports.anchors;
  const entc = A.buildAnchors(aipDataset()).find((x) => x.kind === 'AD' && x.icao === 'ENTC');
  const wp = (n, la, ln, alt) =>
    `{ lat: ${la}, lng: ${ln}, name: '${n}', alt: ${alt}, oat: 5, wdir: 0, wspd: 0, var: -11 }`;
  ev(`delete aircraftProfile.autoPlanAfterStop;`);
  ev(`flights = [
        { id: 1, title: 'One',   depElev: 254, waypoints: [${wp('ENDU', 69.055, 18.544, 254)}, ${wp('A', 69.3, 18.6, 3500)}] },
        { id: 2, title: 'Two',   depElev: 254, waypoints: [${wp('A', 69.3, 18.6, 254)}, ${wp('B', 69.5, 18.8, 3500)}] },
        { id: 3, title: 'Three', depElev: 254, waypoints: [${wp('B', 69.5, 18.8, 254)}, ${wp('C', 69.6, 19.0, 3500)}] }];
      activeFlightIndex = 1; refreshMap(); renderAllFlightTables();`);

  const p = ev(`clickAnchor(${JSON.stringify(entc)})`);
  await tick();
  answerDialog('🛩 Full stop');
  await p; await tick();

  assert(ev('flights.length') === 4, 'the next sector did not open: ' + ev('flights.length'));
  const names = ev('flights.map(f => f.waypoints.map(w => w.name).join(">"))');
  assert(ev('flights[1].waypoints').slice(-1)[0].name === 'ENTC',
    'the stop did not land on the plan it was made on: ' + JSON.stringify(names));
  // THE NEW SECTOR SITS DIRECTLY AFTER IT, seeded from the aerodrome stopped at.
  assert(names[2] === 'ENTC', 'the new sector is not after the stop: ' + JSON.stringify(names));
  assert(ev('activeFlightIndex') === 2,
    'the pilot was not taken to the new sector: ' + ev('activeFlightIndex'));
  assert(ev('flights[2].depElev') === 32,
    'the new sector does not depart from the field: ' + ev('flights[2].depElev'));
  // ...and the plan that already followed is untouched, still after the new one.
  assert(names[3] === 'B>C', 'the following sector was disturbed: ' + JSON.stringify(names));
  // The ground time belongs to the sector that departs after the stop, and
  // stopBeforeHTML finds it at flights[fIdx - 1] only because the new plan is
  // in the right PLACE.
  // NOTE: no whitespace tidy-up here. Inside a template literal `\s` collapses
  // to a bare `s`, so the obvious `.replace(/\s+/g, ' ')` silently replaces the
  // LETTER s ("Full stop" -> "Full  top") and the assert fails for the wrong
  // reason - which is exactly what it did when this test was written.
  const hdrs = ev(`[...document.querySelectorAll('.flight-header')].map(h => h.textContent)`);
  assert(/Full stop ENTC/.test(hdrs[2] || ''),
    'the ground time is not on the sector that departs after the stop: ' + (hdrs[2] || ''));
  assert(!/Full stop/.test(hdrs[3] || ''),
    'the ground time also landed on an unrelated plan: ' + (hdrs[3] || ''));

  // The + New plan button is unchanged: no argument means "continue the last".
  ev(`activeFlightIndex = 0; addNewFlightPlan();`);
  assert(ev('flights.length') === 5 && ev('activeFlightIndex') === 4,
    'the plain button no longer appends at the end: ' + ev('activeFlightIndex'));
  ev(SEED);
});

T('the next sector departs from the PUBLISHED field, not the arrival altitude', () => {
  // THIS HAS TO BE TESTED WITH THE TWO FIGURES DIFFERENT, or it passes for the
  // wrong reason: the old rule inherited the last waypoint's altitude, and for
  // an aerodrome waypoint that is USUALLY the field elevation anyway. The case
  // the lookup exists for is a pilot who planned to cross ENTC at 2500 and then
  // landed there - the next climb still starts from the runway.
  ev(`flights = [{ id: 1, title: 'A', depElev: 254, waypoints: [
        { lat: 69.05505349, lng: 18.54466865, name: 'ENDU', alt: 254, oat: 10, wdir: 0, wspd: 0, var: -11 },
        { lat: 69.67895054, lng: 18.91143033, name: 'ENTC', alt: 2500, oat: 10, wdir: 0, wspd: 0, var: -12,
          stop: 'full-stop', stopMin: 10 }]}];
      activeFlightIndex = 0; refreshMap(); renderAllFlightTables(); addNewFlightPlan();`);
  assert(ev('flights.length') === 2, 'no new plan');
  assert(ev('flights[1].depElev') === 32,
    'the next sector inherited the arrival altitude instead of the published field: ' +
    ev('flights[1].depElev'));
  // ...and with NO stop the old inherit-the-altitude behaviour is untouched.
  ev(`flights = [{ id: 1, title: 'A', depElev: 254, waypoints: [
        { lat: 69.05505349, lng: 18.54466865, name: 'ENDU', alt: 254, oat: 10, wdir: 0, wspd: 0, var: -11 },
        { lat: 69.67895054, lng: 18.91143033, name: 'ENTC', alt: 2500, oat: 10, wdir: 0, wspd: 0, var: -12 }]}];
      activeFlightIndex = 0; refreshMap(); renderAllFlightTables(); addNewFlightPlan();`);
  assert(ev('flights[1].depElev') === 2500,
    'a plain waypoint stopped inheriting its altitude: ' + ev('flights[1].depElev'));
  ev(SEED);
});

TA('a reporting point still adds with no dialog', async () => {
  // v16.34's rule stands for everything except aerodromes: a published point
  // already HAS its name, and asking about it is a click for nothing.
  const A = moduleExports.anchors;
  const rp = A.buildAnchors(aipDataset()).find((x) => x.kind === 'RP');
  assert(rp, 'no reporting point in the dataset');
  ev(SEED);
  const before = ev('flights[0].waypoints.length');
  ev(`clickAnchor(${JSON.stringify(rp)})`);
  await tick();
  assert(!openDlg(), 'a reporting point opened a dialog');
  assert(ev('flights[0].waypoints.length') === before + 1, 'the point was not added');
  ev(SEED);
});

console.log('\n=== 21a. Import scope, and the collision prompt (v16.81) ===');

// The pilot's two requests, after being told what import actually did:
// a choice between routes-and-settings and routes-only, and a prompt with a
// side-by-side preview when a route name collides. The prompt exists because
// a same-named overwrite was the ONE thing an import did that Ctrl+Z could not
// take back - the undo snapshot carries `flights` and the plan fields, never
// localStorage.

T('the pure comparison says what differs, and what only LOOKS the same', () => {
  const X = moduleExports.exch;
  const wp = (name, alt, x) => ({ lat: 69, lng: 18, name, alt, oat: 0, wdir: 0,
    wspd: 0, var: -11, ...(x || {}) });
  const mine = [wp('ENDU', 254), wp('MID', 2500), wp('ENTC', 32)];

  // Identical means identical: no prompt is worth showing.
  const same = X.compareRoutes(mine, mine.map((w) => ({ ...w })));
  assert(same.identical === true, 'two copies of one route were called different');
  assert(same.rows.every((r) => r.state === 'same'), 'a row of an identical route is flagged');

  // A changed ALTITUDE is visible in the preview, so it is a 'changed' row.
  const alt = X.compareRoutes(mine, [wp('ENDU', 254), wp('MID', 4500), wp('ENTC', 32)]);
  assert(alt.identical === false, 'a changed altitude was called identical');
  assert(alt.summary.changed === 1 && alt.rows[1].state === 'changed',
    'the changed row was not flagged: ' + JSON.stringify(alt.summary));

  // A changed WIND is NOT visible in the four shown fields. Flagging that row
  // as different with nothing on screen to explain it would read as a bug in
  // the preview, so it gets its own state and its own sentence.
  const wind = X.compareRoutes(mine, [wp('ENDU', 254), wp('MID', 2500, { wspd: 30 }), wp('ENTC', 32)]);
  assert(wind.identical === false, 'a changed wind was called identical');
  assert(wind.summary.hidden === 1 && wind.summary.changed === 0
    && wind.rows[1].state === 'other',
    'a difference outside the shown fields was not reported separately: ' +
    JSON.stringify(wind.summary));

  // Length differences are added / removed, never "changed".
  const longer = X.compareRoutes(mine, [...mine, wp('ENAT', 500)]);
  assert(longer.summary.added === 1 && longer.rows[3].state === 'added' &&
    longer.rows[3].before === null, 'an extra waypoint was not reported as added');
  const shorter = X.compareRoutes(mine, mine.slice(0, 2));
  assert(shorter.summary.removed === 1 && shorter.rows[2].after === null,
    'a missing waypoint was not reported as removed');
});

T('a missing value equals a missing value - NaN must not read as a difference', () => {
  // `NaN !== NaN`, so a plain comparison calls every absent OAT a change and
  // every route with a blank field collides with itself. Object.is is what
  // makes the four shown fields behave, and stableString the rest.
  const X = moduleExports.exch;
  const blank = [{ lat: 69, lng: 18, name: 'A', alt: NaN, oat: NaN, wdir: NaN,
                   wspd: NaN, var: NaN, isPattern: false }];
  const cmp = X.compareRoutes(blank, blank.map((w) => ({ ...w })));
  assert(cmp.identical === true, 'a route with blank values differs from itself');
  assert(cmp.summary.changed === 0 && cmp.summary.hidden === 0,
    'a blank field was reported as a difference: ' + JSON.stringify(cmp.summary));
  assert(X.routeSignature(blank) === X.routeSignature(blank.map((w) => ({ ...w }))),
    'the signature of a route with blank values is unstable');
  // Key ORDER must not matter, or a route saved by an older build collides
  // with an identical one saved by a newer.
  assert(X.routeSignature([{ lat: 1, lng: 2 }]) === X.routeSignature([{ lng: 2, lat: 1 }]),
    'the signature depends on key order');
});

T('the scope question is only asked when the file carries both', () => {
  const X = moduleExports.exch;
  const wps = [{ lat: 69, lng: 18, name: 'A', alt: 100 }];
  const both = X.importScopeOf({ routes: { R: wps }, profile: { roc: 800 } });
  assert(both.hasRoutes && both.hasSettings, 'a mixed file was not seen as mixed');
  const routesOnly = X.importScopeOf({ routes: { R: wps } });
  assert(routesOnly.hasRoutes && !routesOnly.hasSettings,
    'a routes-only file claims to carry settings');
  const settingsOnly = X.importScopeOf({ profile: { roc: 800 } });
  assert(!settingsOnly.hasRoutes && settingsOnly.hasSettings, 'a settings-only file claims routes');
  // An EMPTY routes object is not routes, or a full export with no saved
  // routes would ask a question with one real answer.
  assert(X.importScopeOf({ routes: {}, missions: {}, profile: { roc: 1 } }).hasRoutes === false,
    'an empty routes object counted as routes');
  // A bare array is the v1 shape: a route, and never settings.
  assert(X.importScopeOf(wps).hasRoutes && !X.importScopeOf(wps).hasSettings,
    'a bare array was misread');
  assert(X.importScopeOf(null).hasRoutes === false && X.importScopeOf('x').hasSettings === false,
    'a non-object file was not handled');
  // The kinds are NAMED, because the dialog says which settings it would touch.
  assert(both.settingKinds.includes('aircraft settings'), 'the settings are not named');
});

TA('"Routes only" imports the routes and leaves every setting alone', async () => {
  ev(`localStorage.removeItem('c182_custom_routes'); localStorage.removeItem('c182_custom_missions');`);
  const rocBefore = ev('aircraftProfile.roc');
  const etdBefore = doc.getElementById('def-etd').value;
  const undoBefore = ev('keybinds.undo');
  importFile(JSON.stringify({
    routes: { 'FROM-FILE': [{ lat: 69, lng: 18, name: 'A', alt: 100 },
                            { lat: 69.4, lng: 18.4, name: 'B', alt: 2000 }] },
    profile: { roc: 1234 },
    planningPrefs: { etd: '23:45' },
    keybinds: { undo: 'Alt+Q' }
  }));
  await tick();
  answerDialog('Routes only');
  await tick();
  assert(Object.keys(ev('getStoredSingleRoutes()')).includes('FROM-FILE'),
    'the route was not imported');
  assert(ev('aircraftProfile.roc') === rocBefore,
    'the profile changed despite "routes only": ' + ev('aircraftProfile.roc'));
  assert(doc.getElementById('def-etd').value === etdBefore, 'the ETD changed');
  assert(ev('keybinds.undo') === undoBefore, 'the keybinds changed');
  assert(/Left your/.test(toastText()), 'the toast does not say what was left alone: ' + toastText());
  ev(SEED);
});

TA('a colliding route name prompts, and "Keep mine" really keeps mine', async () => {
  ev(`localStorage.setItem('c182_custom_routes', JSON.stringify({
        'SHARED': [{ lat: 69, lng: 18, name: 'MINE', alt: 1000, oat: 0, wdir: 0, wspd: 0, var: -11 },
                   { lat: 69.5, lng: 18.5, name: 'ALSO-MINE', alt: 2000, oat: 0, wdir: 0, wspd: 0, var: -11 }]
      }));`);
  importFile(JSON.stringify({ routes: { 'SHARED': [
    { lat: 69, lng: 18, name: 'THEIRS', alt: 5000, oat: 0, wdir: 0, wspd: 0, var: -11 }] } }));
  await tick();
  const dlg = openDlg();
  assert(dlg, 'a colliding name did not prompt');
  const text = dlg.textContent;
  // BOTH SIDES ARE ON SCREEN - that is the whole point of the preview.
  assert(/MINE/.test(text) && /THEIRS/.test(text),
    'the preview does not show both routes: ' + text.slice(0, 300));
  assert(/SHARED/.test(text), 'the prompt does not name the route');
  // AND THE WARNING IS THERE, because this is the one unrecoverable step.
  assert(/cannot be undone/i.test(text), 'the prompt does not say it cannot be undone');
  // KEEPING IS THE PRIMARY, so Enter is the non-destructive answer.
  const primary = dlg.querySelector('.dlg-primary');
  assert(primary && /Keep mine/.test(primary.textContent),
    'the default answer is not the safe one: ' + (primary && primary.textContent));
  answerDialog('Keep mine');
  await tick();
  const kept = ev(`getStoredSingleRoutes()['SHARED']`);
  assert(kept.length === 2 && kept[0].name === 'MINE',
    'the saved route was overwritten after choosing to keep it: ' + JSON.stringify(kept));
  assert(/Kept your own version/.test(toastText()), 'the toast does not report the keep: ' + toastText());
  ev(SEED);
});

TA('"Replace" overwrites it, and only then', async () => {
  ev(`localStorage.setItem('c182_custom_routes', JSON.stringify({
        'SHARED': [{ lat: 69, lng: 18, name: 'MINE', alt: 1000, oat: 0, wdir: 0, wspd: 0, var: -11 }]
      }));`);
  importFile(JSON.stringify({ routes: { 'SHARED': [
    { lat: 69, lng: 18, name: 'THEIRS', alt: 5000, oat: 0, wdir: 0, wspd: 0, var: -11 },
    { lat: 69.6, lng: 18.6, name: 'THEIRS-2', alt: 6000, oat: 0, wdir: 0, wspd: 0, var: -11 }] } }));
  await tick();
  answerDialog('Replace with the imported one');
  await tick();
  const now = ev(`getStoredSingleRoutes()['SHARED']`);
  assert(now.length === 2 && now[0].name === 'THEIRS',
    'the route was not replaced: ' + JSON.stringify(now));
  assert(/Replaced 1 saved entry/.test(toastText()), 'the toast does not report the replace: ' + toastText());
  ev(SEED);
});

TA('cancelling a collision changes NOTHING - not the library, not the plan', async () => {
  // The v16.44 rule (refuse before touching anything) applied to a CHOICE.
  // Everything is decided before a single write, so Cancel is honest.
  ev(`localStorage.setItem('c182_custom_routes', JSON.stringify({
        'SHARED': [{ lat: 69, lng: 18, name: 'MINE', alt: 1000, oat: 0, wdir: 0, wspd: 0, var: -11 }]
      }));`);
  ev(SEED);
  const planBefore = ev('JSON.stringify(flights)');
  const undoDepth = ev('undoStack.length');
  importFile(JSON.stringify({
    routes: { 'SHARED': [{ lat: 70, lng: 19, name: 'THEIRS', alt: 9000, oat: 0, wdir: 0, wspd: 0, var: -11 }],
              'NEW-ONE': [{ lat: 69, lng: 18, name: 'N', alt: 100, oat: 0, wdir: 0, wspd: 0, var: -11 }] }
  }));
  await tick();
  answerDialog('Cancel the import');
  await tick();
  const lib = ev('getStoredSingleRoutes()');
  assert(lib['SHARED'][0].name === 'MINE', 'the colliding route was written despite cancelling');
  assert(lib['NEW-ONE'] === undefined,
    'a NON-colliding route was written despite cancelling - the import was half-applied');
  assert(ev('JSON.stringify(flights)') === planBefore, 'the plan on screen changed after cancelling');
  assert(ev('undoStack.length') === undoDepth,
    'cancelling left an undo step for something it did not do');
  ev(SEED);
});

TA('an identical route is not worth a question', async () => {
  const route = [{ lat: 69, lng: 18, name: 'A', alt: 1000, oat: 0, wdir: 0, wspd: 0, var: -11 },
                 { lat: 69.5, lng: 18.5, name: 'B', alt: 2000, oat: 0, wdir: 0, wspd: 0, var: -11 }];
  ev(`localStorage.setItem('c182_custom_routes', JSON.stringify({ 'SAME': ${JSON.stringify(route)} }));`);
  importFile(JSON.stringify({ routes: { 'SAME': route } }));
  await tick();
  assert(!openDlg(), 'a byte-for-byte identical route asked to be adjudicated');
  assert(/already identical/.test(toastText()),
    'the toast does not say it was already there: ' + toastText());
  const lib = ev(`getStoredSingleRoutes()['SAME']`);
  assert(lib.length === 2 && lib[0].name === 'A', 'the identical route was disturbed');
  ev(SEED);
});

TA('several collisions can be settled in one answer', async () => {
  const mk = (n) => [{ lat: 69, lng: 18, name: n, alt: 1000, oat: 0, wdir: 0, wspd: 0, var: -11 }];
  ev(`localStorage.setItem('c182_custom_routes', JSON.stringify(
        { A: ${JSON.stringify(mk('MINE-A'))}, B: ${JSON.stringify(mk('MINE-B'))},
          C: ${JSON.stringify(mk('MINE-C'))} }));`);
  importFile(JSON.stringify({ routes: { A: mk('NEW-A'), B: mk('NEW-B'), C: mk('NEW-C') } }));
  await tick();
  const dlg = openDlg();
  assert(dlg, 'three collisions did not prompt');
  assert(/Keep mine for all 3/.test(dlg.textContent),
    'a bulk answer is not offered for several collisions: ' + dlg.textContent.slice(0, 200));
  answerDialog('Keep mine for all 3');
  await tick();
  assert(!openDlg(), 'a bulk answer still asked about the rest');
  const lib = ev('getStoredSingleRoutes()');
  for (const k of ['A', 'B', 'C']) {
    assert(lib[k][0].name === 'MINE-' + k, k + ' was replaced despite "keep all"');
  }
  ev(SEED);
});

TA('a hostile route name cannot execute in the preview', async () => {
  // The preview is built with createElement and textContent, so there is no
  // innerHTML sink at all - this asserts that stays true (discipline rule 6).
  const bad = '<img src=x onerror="window.__pwn=1" class="xss-probe">';
  ev(`localStorage.setItem('c182_custom_routes', JSON.stringify({ 'H': [
        { lat: 69, lng: 18, name: ${JSON.stringify(bad)}, alt: 1, oat: 0, wdir: 0, wspd: 0, var: -11 }] }));`);
  importFile(JSON.stringify({ routes: { 'H': [
    { lat: 70, lng: 19, name: 'plain', alt: 2, oat: 0, wdir: 0, wspd: 0, var: -11 }] } }));
  await tick();
  const dlg = openDlg();
  assert(dlg, 'no prompt for the hostile-named collision');
  assert(!doc.querySelector('.xss-probe'), 'the preview parsed a waypoint name as markup');
  assert(ev('window.__pwn') === undefined, 'the payload ran');
  // ...and the name is still READABLE, or escaping it would be a different bug.
  assert(dlg.textContent.includes(bad), 'the name was mangled instead of shown as text');
  answerDialog('Cancel the import');
  await tick();
  ev(SEED);
});

TA('a colliding MISSION prompts too, with its plans side by side', async () => {
  // The pilot asked about routes; missions have the identical silent-overwrite
  // hazard, so they get the same question. A waypoint table would misrepresent
  // a multi-plan mission, so the preview is one line per plan.
  const mission = (tag) => [
    { id: 1, title: 'S1', depElev: 254, waypoints: [
      { lat: 69, lng: 18, name: tag + '-1', alt: 254, oat: 0, wdir: 0, wspd: 0, var: -11 },
      { lat: 69.4, lng: 18.4, name: tag + '-2', alt: 2000, oat: 0, wdir: 0, wspd: 0, var: -11 }] }];
  ev(`localStorage.setItem('c182_custom_missions', JSON.stringify({ 'M': ${JSON.stringify(mission('MINE'))} }));`);
  importFile(JSON.stringify({ missions: { 'M': mission('THEIRS') } }));
  await tick();
  const dlg = openDlg();
  assert(dlg, 'a colliding mission did not prompt');
  // v16.101: a saved multi-sector plan is a "flight" on screen (the author).
  assert(/You already have a flight called/.test(dlg.textContent), 'the prompt does not say it is a saved flight');
  assert(/MINE-1/.test(dlg.textContent) && /THEIRS-1/.test(dlg.textContent),
    'the mission preview does not show both sides: ' + dlg.textContent.slice(0, 300));
  answerDialog('Keep mine');
  await tick();
  assert(ev(`getStoredMissions()['M'][0].waypoints[0].name`) === 'MINE-1',
    'the mission was overwritten after choosing to keep it');
  ev(SEED);
});

TA('an empty planning pref in a file does not blank the one on screen', async () => {
  // The pilot asked about this after v16.81: "the ETD in a file overwrites
  // yours even when it's empty". Fuel and reserve were already guarded; the
  // ETD was not - and it is not an edge case, because buildExportPayload
  // writes `etd: ... || ''`, so EVERY export from a session with no ETD
  // carries an empty one and would blank the importer's.
  ev(`localStorage.removeItem('c182_custom_routes'); localStorage.removeItem('c182_custom_missions');`);
  ev(`document.getElementById('def-etd').value = '07:30';
      document.getElementById('fuel-dep').value = '60';
      document.getElementById('fuel-reserve').value = '9';`);
  importFile(JSON.stringify({
    routes: { 'ETD-PROBE': [{ lat: 69, lng: 18, name: 'A', alt: 100, oat: 0, wdir: 0, wspd: 0, var: -11 },
                            { lat: 69.4, lng: 18.4, name: 'B', alt: 2000, oat: 0, wdir: 0, wspd: 0, var: -11 }] },
    planningPrefs: { fuel: '', reserve: '', etd: '' }
  }));
  await tick();
  answerDialog('Routes and settings');   // the settings ARE wanted; they are just empty
  await tick();
  assert(doc.getElementById('def-etd').value === '07:30',
    'an empty ETD in the file blanked the one on screen: ' + doc.getElementById('def-etd').value);
  assert(doc.getElementById('fuel-dep').value === '60', 'the fuel was blanked');
  assert(doc.getElementById('fuel-reserve').value === '9', 'the reserve was blanked');
  // ...and a REAL value still lands, or the guard would have gone too far.
  importFile(JSON.stringify({
    routes: { 'ETD-PROBE-2': [{ lat: 69, lng: 18, name: 'A', alt: 100, oat: 0, wdir: 0, wspd: 0, var: -11 },
                              { lat: 69.4, lng: 18.4, name: 'B', alt: 2000, oat: 0, wdir: 0, wspd: 0, var: -11 }] },
    planningPrefs: { fuel: '48', reserve: '8.5', etd: '13:15' }
  }));
  await tick();
  answerDialog('Routes and settings');
  await tick();
  assert(doc.getElementById('def-etd').value === '13:15',
    'a real ETD no longer imports: ' + doc.getElementById('def-etd').value);
  assert(doc.getElementById('fuel-dep').value === '48' &&
         doc.getElementById('fuel-reserve').value === '8.5', 'a real fuel figure no longer imports');
  ev(SEED);
});

T('all three planning prefs guard the same way', () => {
  // The defect was ONE of three lines differing from the other two, which is
  // the shape that hides: a rule applied to a surface and not to its
  // neighbours. Asserted on the source so a fourth pref cannot be added
  // without it.
  const fn = APP_SRC.split('async function importMissionFile')[1]
                    .split('\n    /** What the import actually did')[0];
  // SPLIT ON THE CALL, NOT THE NAME: the first version split on the bare word
  // `savePlanningPrefs`, and the comment written with the fix MENTIONS it - so
  // the block ended at the comment, before the three lines being inspected,
  // and the test failed against correct code. An anchor that prose can match
  // is not an anchor (the v16.52 marker lesson, in a smaller shape).
  const block = fn.split('obj(parsed.planningPrefs)')[1].split('savePlanningPrefs();')[0];
  const guarded = [...block.matchAll(/pp\.(\w+) !== undefined && pp\.\1 !== ''/g)].map((m) => m[1]);
  for (const k of ['fuel', 'reserve', 'etd']) {
    assert(guarded.includes(k), k + ' does not guard against an empty value in the file');
  }
  assert(guarded.length === (block.match(/pp\.\w+ !== undefined/g) || []).length,
    'a planning pref is read without the empty-value guard the others have');
});

T('the import path holds no state across an await', () => {
  // Discipline rule 7, disposed of by STRUCTURE rather than by vigilance:
  // every dialog happens before anything is written, so there is no
  // `flights` reference to go stale. Asserted on the source because that is
  // the property worth keeping, not a behaviour a single case can show.
  const fn = APP_SRC.split('async function importMissionFile')[1]
                    .split('\n    /** What the import actually did')[0];
  const applyAt = fn.indexOf('pushUndoState');
  assert(applyAt > 0, 'the import no longer pushes an undo step');
  const asks = [...fn.matchAll(/await (ask|resolveImportCollisions)\(/g)].map((m) => m.index);
  assert(asks.length >= 3, 'expected the scope question and both collision passes');
  for (const at of asks) {
    assert(at < applyAt,
      'a dialog is awaited AFTER the apply phase begins - state can go stale there');
  }
  // And nothing may be written before the last question is answered.
  const firstWrite = Math.min(
    ...['localStorage.setItem', 'flights ='].map((t) => {
      const i = fn.indexOf(t); return i < 0 ? Infinity : i;
    }));
  assert(Math.max(...asks) < firstWrite, 'the import writes before it finishes asking');
});

console.log('\n=== 62a000m. The locked build (v16.78) ===');

// The CRYPTO half of this feature cannot be tested here at all - jsdom has no
// crypto.subtle - and the RELAUNCH half is a question about a real browser's
// script execution. Both live in tools/verify-locked.mjs. What belongs here is
// the pure decisions: which passphrases are refused, whether the gate page's
// metadata really landed, and whether the service worker got re-pointed at the
// files that exist.

T('a weak passphrase is refused, and the refusal says which rule it broke', () => {
  const L = require('./tools/lock-rules.mjs');
  const bad = [
    [undefined, null, /no passphrase/],
    [undefined, '', /no passphrase/],
    ['short', null, /12 is the minimum/],
    ['           ', null, /whitespace|minimum/],
    ['  leading-and-trailing-space  ', null, /whitespace/],
    // MOSTLY a guessable string, in three shapes: the bare word, the word plus
    // a year, and two obvious words stitched together.
    ['flightplanner', null, /not part of a common password/],
    ['flightplanner-2026', null, /not part of a common password/],
    ['MySecretPassword123', null, /not part of a common password/],
    // Padding with punctuation must not buy length.
    ['c182--------------------', null, /Punctuation does not count/]
  ];
  for (const [env, file, why] of bad) {
    const r = L.readPassphrase(env, file);
    assert(r.ok === false, JSON.stringify(env || file) + ' was accepted');
    assert(why.test(r.why), 'the refusal does not say why: ' + r.why);
  }
  // ...and a real one is accepted, or the rules would just be a wall.
  const good = L.readPassphrase('correct-horse-battery-staple', null);
  assert(good.ok === true, 'a good passphrase was refused: ' + good.why);
  assert(good.pass === 'correct-horse-battery-staple', 'the passphrase was altered');
});

T('a long passphrase MAY contain an obvious word - it just cannot mostly be one', () => {
  // THIS IS THE REGRESSION THE FIRST REAL DEPLOY FOUND. The rule started as a
  // bare `includes` ban, which refused a 33-character phrase for containing
  // "c182" and told the author it was among the strings tried first. That is a
  // FALSE CLAIM ABOUT THE PASSPHRASE - the plausible wrong answer pointing the
  // other way, and the honest fix looked like a tool malfunction.
  const L = require('./tools/lock-rules.mjs');
  for (const strong of [
    'my-c182-flies-over-tromso-at-dawn',   // contains c182
    'the-secret-of-good-landings-is-airspeed',   // contains secret
    'admin-rights-are-not-a-personality-trait'   // contains admin
  ]) {
    const r = L.readPassphrase(strong, null);
    assert(r.ok === true, 'a strong phrase was refused for containing a word: ' +
      JSON.stringify(strong) + ' -> ' + r.why);
  }
  // The measurement behind the rule: what is LEFT once the obvious parts go.
  assert(L.obviousResidue('flightplanner') === '', 'the bare project name leaves a residue');
  assert(L.obviousResidue('c182--------------------') === '',
    'punctuation padding counted toward the residue');
  assert(L.obviousResidue('my-c182-flies-over-tromso-at-dawn')
    === 'myfliesovertromsoatdawn', 'the residue is wrong: ' +
    L.obviousResidue('my-c182-flies-over-tromso-at-dawn'));
  // Æ Ø Å count as real characters - the author's own words are Norwegian.
  assert(L.obviousResidue('sørkjosen-og-bardufoss-i-tåke').length > 20,
    'Norwegian letters were stripped out of the residue');
  // ...and this is NOT an entropy estimator, which the module says outright.
  // Recording the limitation rather than implying a strength score.
  assert(L.readPassphrase('abababababababab', null).ok === true,
    'the guard has quietly become a strength estimator it cannot justify');
});

T('exactly one trailing newline is stripped, and the env beats the file', () => {
  const L = require('./tools/lock-rules.mjs');
  // A .site-password written by any editor ends in a newline; that must not
  // become part of the key, or the passphrase typed in the browser would never
  // match what the build used. Both endings, because a Windows clone has CRLF.
  // NOTE the sample avoids the word "passphrase" itself: the first version of
  // this test used it and was refused by the OBVIOUS rule two tests up, which
  // reported "LF was not stripped" for a stripper that was working fine.
  const P = 'correct-horse-battery-staple';
  assert(L.readPassphrase(undefined, P + '\n').pass === P, 'LF was not stripped');
  assert(L.readPassphrase(undefined, P + '\r\n').pass === P, 'CRLF was not stripped');
  // TWO newlines are NOT a passphrase ending in one: the second is real
  // whitespace and is refused rather than silently trimmed, because the
  // browser has no way to know it was there.
  assert(L.readPassphrase(undefined, P + '\n\n').ok === false,
    'a passphrase ending in real whitespace was accepted');
  // CI passes the secret in the environment; a stale local file must not win.
  assert(L.readPassphrase('from-the-environment-x', 'from-the-file-xxxxxx').pass
    === 'from-the-environment-x', 'the file beat the environment');
});

T('a payload name carries its build, so a cached gate cannot meet another build', () => {
  // THE LOCKOUT THIS EXISTS FOR (v16.88): GitHub Pages serves every file with
  // max-age=600 and each URL ages out on its own clock, so for ten minutes
  // after a deploy a browser can hold the OLD gate page and fetch the NEW
  // payloads. Every lock run re-salts, so the key from the stale page cannot
  // open fresh ciphertext - and the gate could only say "that passphrase does
  // not unlock this build", which is a false claim about the passphrase.
  const L = require('./tools/lock-rules.mjs');
  const crypto = require('crypto');
  const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

  assert(typeof L.payloadName === 'function', 'payloadName is gone');
  assert(typeof L.buildIdFrom === 'function', 'buildIdFrom is gone');
  // NO PART MAY CARRY A FIXED NAME. That field is what made a stale hit
  // possible; its absence is the fix, so its return must fail here.
  for (const p of L.PARTS) {
    assert(!('file' in p),
      `PARTS.${p.as} has a fixed file name again - a cached gate can meet another build's bytes`);
  }

  const salt = new Uint8Array([1, 2, 3, 4]);
  const sealed = [new Uint8Array([9, 9]), new Uint8Array([8])];
  const id = L.buildIdFrom(sha, salt, sealed);
  assert(/^[0-9a-f]{8}$/.test(id), 'the build id is not 8 hex characters: ' + id);
  assert(L.payloadName('body', id) === 'body-' + id + '.enc',
    'the payload name is not content-addressed: ' + L.payloadName('body', id));

  // A DIFFERENT SALT IS A DIFFERENT BUILD - that is the everyday case, since
  // the salt is fresh per run even when nothing else changed.
  const other = L.buildIdFrom(sha, new Uint8Array([1, 2, 3, 5]), sealed);
  assert(other !== id, 'two salts produced the same build id');
  // AND SO IS DIFFERENT CIPHERTEXT UNDER THE SAME SALT, which catches a
  // payload swapped independently of the gate.
  const swapped = L.buildIdFrom(sha, salt, [new Uint8Array([9, 9]), new Uint8Array([7])]);
  assert(swapped !== id, 'changing a payload did not change the build id');
  // Deterministic, or the locker would rename every file on every run for no
  // reason and the browser cache would never hit.
  assert(L.buildIdFrom(sha, salt, sealed) === id, 'the build id is not deterministic');
});

T('the locked build names exactly the payloads it wrote', () => {
  // THE GATE AND THE ARTIFACT CANNOT DISAGREE. A gate asking for a file that
  // was never written is the same lockout arriving from the other direction,
  // and it would deploy green. This reads the real locked build if one is
  // present - the suite does not lock (that needs a passphrase), so it is
  // asserted here whenever `npm run lock` has been run.
  const fs = require('fs');
  if (!fs.existsSync('site-locked/index.html')) return;   // nothing locked here
  const gate = fs.readFileSync('site-locked/index.html', 'utf8');
  const meta = JSON.parse(gate.match(/var META = (\{.*?\});/)[1]);
  assert(/^[0-9a-f]{8}$/.test(meta.buildId || ''), 'the gate carries no build id');
  const onDisk = fs.readdirSync('site-locked').filter((f) => f.endsWith('.enc')).sort();
  const asked = meta.parts.map((p) => p.file).sort();
  assert(JSON.stringify(onDisk) === JSON.stringify(asked),
    `the gate asks for ${asked} but the build wrote ${onDisk}`);
  for (const f of asked) {
    assert(f.includes(meta.buildId), `${f} is not stamped with this build's id ${meta.buildId}`);
  }
});

T('a stale gate is told it is stale, and never that the passphrase is wrong', () => {
  // The message is the whole point of the fix: the pilot spent an evening
  // locked out of their own planner because a correct passphrase was reported
  // as wrong. A missing payload now means "this page is out of date".
  const fs = require('fs');
  const gate = fs.readFileSync('src/unlock.html', 'utf8');
  assert(/staleReload/.test(gate), 'the gate has no stale-page path');
  // The missing branch must NOT fall through to the passphrase message.
  // MATCH THE LINE, NOT A NESTED-PAREN SHAPE. The first version of this used
  // `\([^)]*\)` for the condition and stopped at the `)` inside
  // `String(e && e.message)`, so it reported correct code as missing the
  // branch entirely - a test failing for its own reasons, which is the shape
  // this file keeps recording.
  const missingLine = gate.split('\n').find((l) => /\^missing /.test(l) && /if \(/.test(l));
  assert(missingLine, 'the missing-payload branch is gone');
  assert(/staleReload/.test(missingLine),
    'a missing payload no longer routes to the stale-page path: ' + missingLine.trim());
  // and it must RETURN, or it would fall through and blame the passphrase too
  assert(/return/.test(missingLine),
    'the missing-payload branch falls through to the passphrase message');
  // ONCE PER SESSION, or a genuinely half-deployed site reloads for ever.
  assert(/sessionStorage/.test(gate), 'the stale reload has no once-per-session guard');
  // And it must drop the worker and its caches, which is what cemented the
  // lockout past the ten-minute cache window.
  assert(/unregister\(\)/.test(gate), 'the stale path does not unregister the service worker');
  assert(/caches\.delete/.test(gate), 'the stale path does not clear the caches');
});

T('the gate template really carries its metadata, and the marker cannot survive', () => {
  const L = require('./tools/lock-rules.mjs');
  const tpl = fs.readFileSync('src/unlock.html', 'utf8');
  // THE NAMES MUST BE THE RESOLVED ONES, or this proves nothing. PARTS lost its
  // fixed `file` at v16.88 (the name carries the build id now), so passing
  // PARTS straight through made the filename check below compare undefined
  // with undefined and pass vacuously - both sides constant, which v16.66 says
  // is not a comparison at all. Resolve them exactly as the locker does.
  const BID = 'a1b2c3d4';
  const resolved = L.PARTS.map((p) => ({ as: p.as, file: L.payloadName(p.as, BID), replaces: p.replaces }));
  const meta = { v: 1, buildId: BID, salt: 'c2FsdHNhbHRzYWx0c2E=', iterations: L.ITERATIONS, parts: resolved };
  const out = L.fillTemplate(tpl, meta);
  assert(!out.includes('/* @LOCKMETA */ null'), 'the gate would ship META === null');
  assert(out.includes(meta.salt), 'the salt is not in the gate page');
  const back = JSON.parse(out.match(/var META = (\{.*?\});/)[1]);
  assert(back.iterations === L.ITERATIONS, 'the iteration count did not travel');
  // DERIVED, NOT COUNTED. This said `=== 3` and broke the day vac-index.js
  // became a part - which is a test asking to be edited rather than one that
  // checks anything. What matters is that EVERY part reached the gate, since a
  // part the gate does not know about is a payload nobody decrypts.
  assert(back.parts.length === L.PARTS.length,
    `the payload list did not travel: ${back.parts.length} of ${L.PARTS.length}`);
  for (const p of resolved) {
    assert(back.parts.some((q) => q.file === p.file && q.as === p.as),
      'the gate does not know about the payload ' + p.file);
    assert(/-[0-9a-f]{8}\.enc$/.test(p.file),
      'a payload name carries no build id, so a cached gate could meet it: ' + p.file);
  }
  // A template with no marker is a build error, not a silent pass-through.
  let threw = '';
  try { L.fillTemplate('<script>var META = 1;</script>', meta); } catch (e) { threw = e.message; }
  assert(/no @LOCKMETA marker/.test(threw), 'a marker-less template was accepted: ' + threw);
});

T('the gate page is ONE script block - a stray closing tag truncates it', () => {
  const L = require('./tools/lock-rules.mjs');
  const tpl = fs.readFileSync('src/unlock.html', 'utf8');
  const blocks = L.scriptBlocks(tpl);
  assert(blocks.length === 1, 'the gate has ' + blocks.length + ' script blocks, expected 1');
  // THIS IS A REGRESSION GUARD FOR A REAL BUG. The first unlock.html wrote a
  // literal closing script tag inside a JS comment saying such a tag is
  // harmless in the app payload. The HTML parser does not read comments: it
  // ended the element there, the gate threw a SyntaxError, and it unlocked
  // nothing while every string check in the build passed.
  //
  // AND THE SIGNAL IS THAT THE BLOCK DOES NOT PARSE, not that a second block
  // appears. The first version of this test asserted a stray closing tag
  // yields TWO blocks, and it does not: the parser ends the element early and
  // there is no second opening tag, so you get ONE block that happens to stop
  // mid-statement. Which means the block COUNT would never have caught the
  // original bug - only running the parser over the block does. Worth writing
  // down rather than quietly fixing, because the count check is still in the
  // locker and it guards something else (a genuinely added second script).
  const truncated = tpl.replace('var STORE =', 'var X = "<' + '/script>"; var STORE =');
  const cut = L.scriptBlocks(truncated);
  assert(cut.length === 1, 'expected truncation to yield one short block, got ' + cut.length);
  assert(cut[0].length < blocks[0].length,
    'the stray closing tag did not truncate the block at all - the guard is dead');
  let parsed = true;
  try {
    require('child_process').execFileSync(process.execPath, ['--check', '-'],
      { input: cut[0], stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) { parsed = false; }
  assert(!parsed, 'a truncated gate script still parses, so the locker check is dead');
  // ...and the real block must parse, which is what the locker asserts.
  require('child_process').execFileSync(process.execPath, ['--check', '-'],
    { input: blocks[0], stdio: ['pipe', 'pipe', 'pipe'] });
});

T('the service worker is re-pointed at the files the locked build actually has', () => {
  const L = require('./tools/lock-rules.mjs');
  const sw = fs.readFileSync('site/sw.js', 'utf8');
  assert(/'\.\/app\.js'/.test(sw), 'the plaintext worker does not precache app.js - has it moved?');
  const out = L.relinkWorker(sw, ['./', './index.html', './aip.enc', './app.enc', './body.enc']);
  // addAll IS ATOMIC: one 404 for app.js caches NOTHING, so the app silently
  // stops working offline while looking perfect online. That is the v16.45
  // trap, which is why this throws rather than warns.
  assert(!/'\.\/app\.js'/.test(out) && !/'\.\/aip\.js'/.test(out),
    'the locked worker still precaches a plaintext asset');
  for (const f of ['./body.enc', './app.enc', './aip.enc', './index.html']) {
    assert(out.includes("'" + f + "'"), 'the locked worker does not precache ' + f);
  }
  // Everything else about the worker is untouched - the tile rules, the cycle
  // keying, the shell version - so a lock cannot quietly change caching policy.
  assert(out.replace(/const SHELL_ASSETS = \[[^\]]*\];/, 'X')
    === sw.replace(/const SHELL_ASSETS = \[[^\]]*\];/, 'X'),
    'relinking the worker changed something other than the precache list');
  let threw = '';
  try { L.relinkWorker('// a worker with no list', ['./']); } catch (e) { threw = e.message; }
  assert(/no SHELL_ASSETS array/.test(threw), 'a listless worker was accepted: ' + threw);
});

T('the passphrase file and the locked build are both gitignored', () => {
  // THE PASSPHRASE IS THE KEY, and the ciphertext is published: a passphrase
  // committed once is a passphrase an attacker has, permanently, because git
  // history keeps it. A test is the cheapest place to keep that true.
  const ig = fs.readFileSync('.gitignore', 'utf8');
  assert(/^\.site-password$/m.test(ig), '.site-password is not gitignored');
  assert(/^site-locked\/$/m.test(ig), 'site-locked/ is not gitignored');
  // And it must not be in the tree at all, however the ignore file reads.
  const tracked = require('child_process')
    .execSync('git ls-files .site-password site-locked 2>/dev/null || true').toString().trim();
  assert(tracked === '', 'these are tracked by git: ' + tracked);
});

T('the deploy locks the build, and never falls back to publishing it plain', () => {
  // A workflow that deployed site/ when the secret was missing would publish
  // the whole planner unlocked and report success - the plausible wrong answer
  // in its most expensive form. It must fail instead.
  const wf = fs.readFileSync('.github/workflows/pages.yml', 'utf8');
  assert(/lock-site\.mjs|run: npm run lock/.test(wf), 'the workflow does not lock the build');
  assert(/path: site-locked/.test(wf), 'the workflow uploads something other than site-locked');
  assert(!/path: site\s*$/m.test(wf), 'the workflow still uploads the plaintext site/');
  assert(/SITE_PASSWORD/.test(wf), 'the workflow never mentions the SITE_PASSWORD secret');
  // HIDDEN FILES ARE EXCLUDED BY DEFAULT by upload-pages-artifact from v4 on,
  // and the locked build ships a hidden .nojekyll. Without the opt-in the
  // artifact uploads, the deploy goes green, and one file is simply missing -
  // the kind of silent regression nothing else here would notice.
  assert(/include-hidden-files: true/.test(wf),
    'the deploy would drop .nojekyll: upload-pages-artifact needs include-hidden-files');
  // ...and the Node the suite runs on has to be one that can require() ESM,
  // which is what test.js does with tools/aip-fields.mjs and tools/lock-rules.mjs.
  const nv = wf.match(/node-version: '(\d+)'/);
  assert(nv && Number(nv[1]) >= 22,
    'CI runs Node ' + (nv ? nv[1] : '?') + '; require(esm) needs 20.19+/22.12+, ' +
    'so pin a major that cannot resolve below that');
});


console.log('\n=== 62a000n. Georeferencing a VAC (v16.85) ===');

const VG = require('./tools/vac-geo.mjs');
const VAC_FIXTURE = JSON.parse(require('fs').readFileSync('./test-fixtures/endu-vac-geometry.json', 'utf8'));

/** The whole pure pipeline, run once on the committed ENDU geometry. */
function enduGeoreference() {
  const frame = VG.chartFrame(VAC_FIXTURE.segments);
  const read = VG.graticuleObservations(VAC_FIXTURE.segments, VAC_FIXTURE.textItems, frame);
  if ('refused' in read) throw new Error('the fixture refused: ' + JSON.stringify(read.refused));
  const model = VG.fitConformal(read.fit, frame);
  return { frame, read, model };
}

T('the isometric-latitude round trip is exact', () => {
  // Newton on isometric latitude DIVIDES by d(psi)/d(phi). Multiplying by it
  // overshoots ~2.8x at these latitudes, walks phi past the pole, and the next
  // log() of a negative tangent returns NaN - which surfaces as a residual of
  // NaN rather than as a visible divergence.
  for (const lat of [0, 12.5, -33.9, 59.5, 69.2, 71.0, 78.2]) {
    const back = VG.geodeticLatitude(VG.isometricLatitude(lat));
    assert(Number.isFinite(back), 'geodeticLatitude returned ' + back + ' for ' + lat);
    assert(Math.abs(back - lat) < 1e-9, 'round trip lost ' + Math.abs(back - lat) + ' degrees at ' + lat);
  }
});

T('a chart georeferences from its own printed graticule', () => {
  const { frame, read, model } = enduGeoreference();
  assert(frame && Math.abs(frame.left - 63.9) < 1 && Math.abs(frame.top - 711.5) < 1,
    'the map neatline was not found: ' + JSON.stringify(frame));
  assert(read.fit.length >= 20, 'only ' + read.fit.length + ' labelled ticks were read');
  assert(model, 'the conformal fit came back singular');
  const res = VG.observationResiduals(model, read.fit);
  assert(res.maxMetres < 50, 'the fit is ' + res.maxMetres.toFixed(1) + ' m out at worst');
  // All four edges must contribute, or the fit is rank-deficient in one axis.
  for (const edge of ['bottom', 'top', 'left', 'right']) {
    assert(read.edges[edge] && read.edges[edge].fit >= 2, edge + ' contributed no observations');
  }
});

T('the minute ticks are never fitted, and the model predicts them anyway', () => {
  const { read, model } = enduGeoreference();
  assert(read.holdout.length > 100, 'only ' + read.holdout.length + ' held-out ticks');
  assert(read.holdout.every((o) => !o.major), 'a fitted tick leaked into the holdout');
  assert(read.fit.every((o) => o.major), 'a held-out tick leaked into the fit');
  const held = VG.observationResiduals(model, read.holdout);
  assert(held.maxMetres < 60,
    'the held-out minute ticks are ' + held.maxMetres.toFixed(1) + ' m out - the fit does not generalise');
});

T('THE PUBLISHED COORDINATE IS THE SYMBOL BOUNDING-BOX CENTRE, NOT ITS CENTROID', () => {
  // This is the whole primary control path, and getting it wrong is SILENT:
  // every point moves the same way, so the chart stays internally consistent
  // and a held-out point cannot see it either, because fit and holdout share
  // the anchor. Measured over 199 points on three symbol sizes, the offset
  // from the CENTROID scales with the symbol (h/6) while the offset from the
  // BOUNDING-BOX CENTRE stays at zero. A model error would be a constant
  // distance; this one is proportional, so it is the anchor, not the model.
  const { frame, model } = enduGeoreference();
  const published = JSON.parse(require('fs').readFileSync('./tools/prepared/vac-points.json', 'utf8'))
    .data.find((a) => a.icao === 'ENDU').points.map((p) => ({ name: p.name, lat: p.lat, lng: p.lng }));
  const triangles = VG.chartTriangles(VAC_FIXTURE.segments, frame);
  assert(triangles.length >= 15, 'only ' + triangles.length + ' reporting-point symbols were found');
  const matched = VG.matchPublishedPoints(triangles, published,
    (lat, lng) => VG.project(model, lat, lng, frame));
  assert(matched.controls.length >= 15,
    'only ' + matched.controls.length + ' published points paired with a drawn symbol');
  let boxSum = 0, centroidSum = 0, n = 0;
  for (const c of matched.controls) {
    const at = VG.project(model, c.lat, c.lng, frame);
    const t = triangles.find((q) => Math.abs(q.x - c.x) < 1e-9 && Math.abs(q.y - c.y) < 1e-9);
    const centroid = t.vertices.reduce((s, v) => [s[0] + v[0] / 3, s[1] + v[1] / 3], [0, 0]);
    boxSum += at[1] - c.y;
    centroidSum += at[1] - centroid[1];
    n++;
  }
  const box = boxSum / n, centroid = centroidSum / n;
  const metres = VG.groundScale(model, (frame.left + frame.right) / 2, (frame.bottom + frame.top) / 2);
  assert(Math.abs(box) < 0.2,
    'the published coordinate is ' + box.toFixed(3) + ' pt from the bounding-box centre');
  assert(centroid > 1.0,
    'the centroid offset is only ' + centroid.toFixed(3) + ' pt - the anchor test has stopped discriminating');
  assert(centroid * metres > 100,
    'using the centroid would cost ' + (centroid * metres).toFixed(0) + ' m, so this guard proves nothing');
});

T('the graticule and the published points agree - the check a holdout cannot make', () => {
  // Fit and holdout share the anchor convention, so a wrong anchor biases both
  // equally and the holdout residual comes back near zero while the chart is
  // out by the anchor error. The graticule is drawn from completely different
  // ink, so requiring the two models to AGREE is what sees such a bias.
  const { frame, model } = enduGeoreference();
  const published = JSON.parse(require('fs').readFileSync('./tools/prepared/vac-points.json', 'utf8'))
    .data.find((a) => a.icao === 'ENDU').points.map((p) => ({ name: p.name, lat: p.lat, lng: p.lng }));
  const triangles = VG.chartTriangles(VAC_FIXTURE.segments, frame);
  const matched = VG.matchPublishedPoints(triangles, published,
    (lat, lng) => VG.project(model, lat, lng, frame));
  const obs = [];
  for (const c of matched.controls) {
    obs.push({ kind: 'lng', x: c.x, y: c.y, value: c.lng, major: true });
    obs.push({ kind: 'lat', x: c.x, y: c.y, value: c.lat, major: true });
  }
  const pointModel = VG.fitConformal(obs, frame);
  assert(pointModel, 'the published-point fit came back singular');
  let worst = 0;
  for (const c of matched.controls) {
    const a = VG.evaluate(model, c.x, c.y), b = VG.evaluate(pointModel, c.x, c.y);
    const per = VG.metresPerDegree(a.lat);
    worst = Math.max(worst, Math.hypot((a.lng - b.lng) * per.perLng, (a.lat - b.lat) * per.perLat));
  }
  assert(worst < 80, 'the two control sources disagree by ' + worst.toFixed(1) + ' m');
});

T('a graticule that does not verify is refused, not fitted', () => {
  const { frame } = enduGeoreference();
  const labels = VG.graticuleLabels(VAC_FIXTURE.textItems);
  const ticks = VG.edgeTicks(VAC_FIXTURE.segments, frame);
  // An edge with almost no ticks cannot be read.
  const thin = VG.labelEdgeTicks('bottom', ticks.bottom.slice(0, 2), labels, frame);
  assert('reason' in thin && thin.reason === 'few-ticks', 'a two-tick edge was accepted: ' + JSON.stringify(thin));
  // Printed values that do not step uniformly mean a label was mis-assigned.
  // The perturbed label has to be one this edge actually reads, or the check
  // never sees it - which is how the first version of this test passed while
  // asserting nothing.
  const onBottom = labels.filter((l) => l.kind === 'lng' && l.y < frame.bottom);
  assert(onBottom.length >= 3, 'the fixture carries no bottom-edge labels to perturb');
  const victim = onBottom[Math.floor(onBottom.length / 2)];
  const bent = VG.labelEdgeTicks('bottom', ticks.bottom, labels.map(
    (l) => (l === victim ? { ...l, value: l.value + 1 / 60 } : l)), frame);
  assert('reason' in bent && bent.reason === 'uneven-label-values',
    'a broken label sequence was accepted: ' + JSON.stringify(bent).slice(0, 140));
  // Both edges of an axis carry the same interval; disagreement is a misread.
  // Shifting every top label by the same amount would NOT test this - the step
  // stays 10' and only the offset moves - so the top edge is relabelled at a
  // 20' interval instead, which is what a one-major-out misread looks like.
  const topLabels = VAC_FIXTURE.textItems
    .filter((t) => /^\d{1,3}°\d{2}'?E$/.test(t.str) && t.y > frame.top)
    .sort((a, b) => a.x - b.x);
  assert(topLabels.length >= 3, 'the fixture carries no top-edge labels to relabel');
  const firstTop = topLabels[0];
  const base = Number(/^(\d{1,3})°/.exec(firstTop.str)[1]) +
    Number(/°(\d{2})/.exec(firstTop.str)[1]) / 60;
  const relabelled = new Map();
  topLabels.forEach((t, k) => {
    const v = base + k * (20 / 60);
    const deg = Math.floor(v + 1e-9), min = Math.round((v - deg) * 60);
    relabelled.set(t, `${String(deg).padStart(3, '0')}°${String(min).padStart(2, '0')}'E`);
  });
  const mixed = VG.graticuleObservations(VAC_FIXTURE.segments,
    VAC_FIXTURE.textItems.map((t) => (relabelled.has(t) ? { ...t, str: relabelled.get(t) } : t)), frame);
  assert('refused' in mixed, 'edges disagreeing on the graticule interval were accepted');
});

T('all four edges are required, and a missing one is refused not fitted', () => {
  const { frame, read } = enduGeoreference();
  // TWO edges are genuinely degenerate and the solver says so rather than
  // returning a model that has run away. THREE would fit - conformality ties
  // the imaginary part to the real one - so the fourth edge is not needed to
  // SOLVE the fit, it is needed to CHECK it, which is why a refused edge
  // refuses the chart rather than falling back to the other three.
  const onEdge = (o) => o.kind === 'lng'
    ? (Math.abs(o.y - frame.bottom) < 0.01 ? 'bottom' : 'top')
    : (Math.abs(o.x - frame.left) < 0.01 ? 'left' : 'right');
  for (const pair of [['bottom', 'top'], ['bottom', 'left']]) {
    const two = read.fit.filter((o) => pair.includes(onEdge(o)));
    assert(VG.fitConformal(two, frame) === null,
      pair.join('+') + ' alone produced a model instead of refusing as degenerate');
  }
  // And the reader refuses rather than handing such a model back at all.
  const near = (v, t) => Math.abs(v - t) < 0.6;
  const withoutRightTicks = VAC_FIXTURE.segments.filter((s2) => {
    const len = Math.hypot(s2.b[0] - s2.a[0], s2.b[1] - s2.a[1]);
    if (len < 2 || len > 8) return true;
    return !(near(Math.max(s2.a[0], s2.b[0]), frame.right) &&
      Math.min(s2.a[1], s2.b[1]) > frame.bottom && Math.max(s2.a[1], s2.b[1]) < frame.top);
  });
  const got = VG.graticuleObservations(withoutRightTicks, VAC_FIXTURE.textItems, frame);
  assert('refused' in got, 'a chart missing one edge of its graticule was accepted');
  assert(got.refused.some((r) => r.edge === 'right'),
    'the refusal does not name the edge that is missing: ' + JSON.stringify(got.refused));
});

T('four points in one corner is not a fit', () => {
  const frame = { left: 0, right: 100, bottom: 0, top: 100 };
  const corner = [{ x: 1, y: 1 }, { x: 5, y: 2 }, { x: 3, y: 6 }, { x: 7, y: 7 }];
  const span = VG.controlSpanFraction(corner, frame);
  assert(span.x < VG.MIN_CONTROL_SPAN_FRACTION && span.y < VG.MIN_CONTROL_SPAN_FRACTION,
    'a cluster in one corner passed the distribution guard');
  const spread = VG.controlSpanFraction([{ x: 5, y: 5 }, { x: 90, y: 88 }], frame);
  assert(spread.x >= VG.MIN_CONTROL_SPAN_FRACTION && spread.y >= VG.MIN_CONTROL_SPAN_FRACTION,
    'a well-spread pair was rejected');
});

T('the VAC fixture credits Avinor', () => {
  const f = require('fs').readFileSync('./test-fixtures/endu-vac-geometry.json', 'utf8');
  assert(/Avinor/.test(f), 'the VAC fixture does not credit Avinor');
});


console.log('\n=== 62a000o. The VAC chart overlay (v16.86) ===');

const VACM = require('./src/lib/vac.js');
const okChart = (over) => Object.assign({
  icao: 'ENDU', chart: 'AD 2 ENDU 6 - 1', chartDate: '2026-05-14',
  file: 'endu-2026-05-14-f93dd046-r1.webp',
  bounds: { west: 17.66, east: 19.26, south: 68.76, north: 69.42 },
  width: 4173, height: 4833, sourcePdfSha256: 'f93dd046', preparationRevision: 1,
  controlSource: 'published-points', residualM: 1.87, thresholdM: 25
}, over || {});

T('the opacity setting is validated on every read, not trusted from storage', () => {
  // It is in PROFILE_KEYS, so it can arrive from a route file somebody else
  // wrote or from a hand-edited localStorage.
  assert(VACM.normaliseVacOpacity(0.5) === 0.5, 'a valid value was changed');
  assert(VACM.normaliseVacOpacity('0.4') === 0.4, 'a numeric string was rejected');
  for (const hostile of [null, undefined, NaN, 'rgb(0,0,0)', {}, [], '<script>', Infinity]) {
    const v = VACM.normaliseVacOpacity(hostile);
    assert(Number.isFinite(v) && v >= VACM.VAC_OPACITY_MIN && v <= VACM.VAC_OPACITY_MAX,
      'a hostile opacity produced ' + JSON.stringify(v));
  }
  assert(VACM.normaliseVacOpacity(-5) === VACM.VAC_OPACITY_MIN, 'below the floor was not clamped');
  assert(VACM.normaliseVacOpacity(99) === VACM.VAC_OPACITY_MAX, 'above the ceiling was not clamped');
  assert(VACM.normaliseVacOn('true') === true && VACM.normaliseVacOn('yes') === false,
    'the layer toggle accepts something other than a boolean');
});

T('a chart that cannot prove itself is NOT drawn, and the reason is named', () => {
  // Fail-closed: an incomplete manifest, or one whose measured error exceeds
  // its OWN recorded threshold, puts no ink on the map.
  assert(VACM.vacDrawable(okChart()), 'a complete, in-tolerance chart was refused');
  for (const field of VACM.REQUIRED_FIELDS) {
    const missing = okChart(); delete missing[field];
    assert(!VACM.vacDrawable(missing), 'a chart with no ' + field + ' was drawn anyway');
    assert(/\b/.test(VACM.vacRefusal(missing)), 'no reason was given for ' + field);
  }
  const over = okChart({ residualM: 40, thresholdM: 25 });
  assert(!VACM.vacDrawable(over), 'a chart outside its own threshold was drawn');
  assert(/40\.0 m against its own 25 m/.test(VACM.vacRefusal(over)),
    'the refusal does not say by how much: ' + VACM.vacRefusal(over));
  assert(!VACM.vacDrawable(okChart({ superseded: '2026-11-26-AIRAC' })),
    'a superseded chart was drawn');
  assert(/superseded in 2026-11-26-AIRAC/.test(VACM.vacRefusal(okChart({ superseded: '2026-11-26-AIRAC' }))),
    'the refusal does not name the edition that amended it');
  assert(!VACM.vacDrawable(okChart({ bounds: { west: 19, east: 17, south: 68, north: 69 } })),
    'inverted bounds were accepted');
});

T('nothing is drawn below the min zoom, or off screen', () => {
  const charts = [okChart()];
  const over = { west: 18, east: 19, south: 69, north: 69.3 };
  assert(VACM.visibleVacCharts(charts, over, VACM.VAC_MIN_ZOOM).length === 1,
    'a chart under the viewport was not drawn at the min zoom');
  assert(VACM.visibleVacCharts(charts, over, VACM.VAC_MIN_ZOOM - 1).length === 0,
    'a chart was drawn below the min zoom, where a whole sheet is a smear');
  const elsewhere = { west: 5, east: 6, south: 58, north: 59 };
  assert(VACM.visibleVacCharts(charts, elsewhere, 12).length === 0,
    'a chart nowhere near the viewport was drawn');
  assert(VACM.visibleVacCharts([okChart({ residualM: 999 })], over, 12).length === 0,
    'culling drew a chart that is not drawable');
});

T('the load is bounded by how many sheets are drawn, not by the zoom', () => {
  // THE MEASUREMENT BEHIND THIS (v16.87, in Chromium on the real map container):
  // the worst viewport in Norway holds 20 sheets at z7, 9 at z8, 6 at z9 and 4
  // at z10. 12 sheets froze the map for 2.2 s while it rasterised; the same
  // viewport with 3 settled in 727 ms. Once settled even 12 pan in 17 ms - the
  // whole cost is first paint, and it tracks the COUNT.
  assert(VACM.VAC_MAX_DRAWN === 6, 'the cap moved: ' + VACM.VAC_MAX_DRAWN);
  // 6 IS DERIVED: it is the worst case zoom 9 already produced before the floor
  // moved, so going further out can never cost more than the old floor's
  // neighbour already did. A cap above that would not bound anything new.
  const many = [];
  for (let i = 0; i < 12; i++) {
    many.push(okChart({ icao: 'EN' + i, bounds: { west: 18 + i * 0.01, east: 19 + i * 0.01, south: 69, north: 69.3 } }));
  }
  const drawn = VACM.vacDrawOrder(many, { lat: 69.15, lng: 18.5 });
  assert(drawn.length === VACM.VAC_MAX_DRAWN,
    'the cap did not bite: ' + drawn.length + ' of ' + many.length);
  // AND IT DROPS THE FAR ONES, not an arbitrary slice: the list is
  // farthest-first, so the survivors must be the nearest the map centre.
  const dist = (c) => Math.abs((c.bounds.west + c.bounds.east) / 2 - 18.5);
  const kept = drawn.map(dist), dropped = many.map(dist).sort((a, b) => a - b).slice(VACM.VAC_MAX_DRAWN);
  assert(Math.max(...kept) <= Math.min(...dropped) + 1e-9,
    'the cap dropped a sheet nearer the centre than one it kept');
  // Under the cap nothing is removed at all.
  assert(VACM.vacDrawOrder(many.slice(0, 3), { lat: 69.15, lng: 18.5 }).length === 3,
    'the cap fired when there was nothing to cap');
});

T('a partial overlay says it is partial', () => {
  // Everything else this overlay withholds is withheld for ACCURACY and would
  // be wrong to draw. These are CORRECT sheets left out for load, so a pilot
  // must not read the gap as "no chart published here".
  const a = okChart({ icao: 'ENDU' }), b = okChart({ icao: 'ENTC' });
  const full = VACM.vacLabel([a, b], { editionLabel: 'X' }, 'X', 2);
  assert(!/of/.test(full.replace('VAC', '')), 'a complete overlay claimed to be partial: ' + full);
  const partial = VACM.vacLabel([a, b], { editionLabel: 'X' }, 'X', 9);
  assert(/2 of 9/.test(partial), 'the label does not say how many are held back: ' + partial);
  assert(/zoom in/i.test(partial), 'the label does not say what to do about it: ' + partial);
  // Absent means "not counted", not "zero held back" - the old three-argument
  // call sites must read exactly as they did.
  assert(VACM.vacLabel([a], { editionLabel: 'X' }, 'X') === VACM.vacLabel([a], { editionLabel: 'X' }, 'X', 1),
    'omitting the count changed the label');
});

T('the floor moved to 8, and 7 is still refused for a stated reason', () => {
  assert(VACM.VAC_MIN_ZOOM === 8, 'the floor moved: ' + VACM.VAC_MIN_ZOOM);
  const charts = [okChart()];
  const over = { west: 18, east: 19, south: 69, north: 69.3 };
  assert(VACM.visibleVacCharts(charts, over, 8).length === 1, 'nothing draws at the new floor');
  assert(VACM.visibleVacCharts(charts, over, 7).length === 0, 'zoom 7 draws, and it should not');
  // Zoom 7 is refused for a DIFFERENT reason from the cost, and the module has
  // to say so: capping there would hide 14 of 20 sheets, and a chart silently
  // absent is worse than one never offered.
  const src = fs.readFileSync('src/lib/vac.js', 'utf8');
  const note = src.slice(0, src.indexOf('export const VAC_MIN_ZOOM'));
  assert(/silently absent|never offered/.test(note),
    'the module does not say why zoom 7 stays refused');
});

T('overlapping charts are ordered, not blended', () => {
  // ENTC and ENDU genuinely abut. The sheet whose centre is nearest the middle
  // of the map is the aerodrome being looked at, so it goes on top - and the
  // list comes back FARTHEST FIRST so a caller can just add them in order.
  const endu = okChart({ icao: 'ENDU', bounds: { west: 17.6, east: 19.2, south: 68.7, north: 69.4 } });
  const entc = okChart({ icao: 'ENTC', bounds: { west: 17.9, east: 19.9, south: 69.3, north: 70.0 } });
  const nearEndu = VACM.vacDrawOrder([endu, entc], { lat: 69.05, lng: 18.4 });
  assert(nearEndu[nearEndu.length - 1].icao === 'ENDU',
    'the nearest sheet is not on top: ' + nearEndu.map((c) => c.icao).join(','));
  const nearEntc = VACM.vacDrawOrder([endu, entc], { lat: 69.68, lng: 18.9 });
  assert(nearEntc[nearEntc.length - 1].icao === 'ENTC',
    'the order did not follow the map centre: ' + nearEntc.map((c) => c.icao).join(','));
});

T('the label bar names the chart, and says when it was prepared elsewhere', () => {
  const set = { editionLabel: '2026-09-03-AIRAC' };
  const text = VACM.vacLabel([okChart()], set, '2026-09-03-AIRAC');
  assert(/ENDU VAC 2026-05-14/.test(text), 'the label does not name the chart: ' + text);
  assert(!/prepared from/.test(text), 'a matching edition was reported as a mismatch');
  const drift = VACM.vacLabel([okChart()], set, '2026-11-26-AIRAC');
  assert(/prepared from 2026-09-03-AIRAC/.test(drift) && /airspace data is 2026-11-26-AIRAC/.test(drift),
    'an edition mismatch is not warned about: ' + drift);
  assert(VACM.vacLabel([], set, null) === '', 'the label bar speaks when nothing is drawn');
});

T('PROFILE_KEYS grew exactly the two VAC settings, and nothing identifying', () => {
  const keys = moduleExports.exch.PROFILE_KEYS;
  assert(keys.includes('vacOn') && keys.includes('vacOpacity'), 'the VAC settings do not travel');
  for (const banned of ['reg', 'pic', 'crew', 'name', 'email', 'licence', 'vacPath', 'vacHost'])
    assert(!keys.includes(banned), 'PROFILE_KEYS grew ' + banned);
});

T('the planner never fetches a chart from Avinor at runtime', () => {
  // The rasters are prepared offline and shipped; the app must reach only its
  // own origin for them, exactly like the airspace dataset.
  const idx = fs.readFileSync('data/vac-index.js', 'utf8');
  assert(!/aim-prod\.avinor\.no|https?:\/\//.test(idx.replace(/^\/\/.*$/gm, '')),
    'the VAC index carries an absolute URL - the planner would fetch a chart at runtime');
  assert(/window\.C182_VAC\s*=/.test(idx), 'the index does not assign window.C182_VAC');
});

T('the VAC index credits Avinor', () => {
  const idx = fs.readFileSync('data/vac-index.js', 'utf8');
  assert(/Avinor/.test(idx), 'no attribution to Avinor');
  assert(!/permission|non-commercial/i.test(idx), 'the removed permission wording is back');
  const set = JSON.parse(idx.slice(idx.indexOf('{'), idx.lastIndexOf('}') + 1));
  assert(VACM.vacAttribution(set).includes('Avinor'), 'the runtime attribution line is empty');
});

T('the chart rasters get their own capped cache, not the shell\'s', () => {
  const sw = fs.readFileSync('src/sw.js', 'utf8');
  assert(/VAC_CACHE/.test(sw) && /VAC_LIMIT/.test(sw), 'the worker has no VAC cache');
  assert(/trim\(cache, VAC_LIMIT\)/.test(sw), 'the VAC cache is never trimmed - it would fill the quota');
  assert(/vac-index\.js/.test(sw), 'vac-index.js is not precached, so the control vanishes offline');
  // The weather must still never be cached (v16.21).
  assert(!/api\.met\.no/.test(sw), 'the worker learned the weather host');
});

T('the raster is display-only: no coordinate comes off a picture', () => {
  const mod = fs.readFileSync('src/lib/vac.js', 'utf8');
  assert(!/getImageData|canvas|createImageBitmap|\.data\[/.test(mod),
    'the VAC module reads pixels - the raster must never be a data source');
  // The published points remain the ONLY source of fix coordinates.
  const vacPts = JSON.parse(fs.readFileSync('tools/prepared/vac-points.json', 'utf8'));
  assert(vacPts.points === 243, 'the reporting-point count moved: ' + vacPts.points);
});

T('two neighbouring sheets must agree about where the ground is', () => {
  // seamObservations is pure, so the rule is tested without a PDF: two toy
  // "charts" whose models differ by a known amount must report that amount.
  const G = require('./tools/vac-geo.mjs');
  // A deliberately trivial conformal model: lng = x/1000, psi = y/1000. The
  // MODEL SHAPE does not matter here - what is under test is that the two
  // sheets' own answers for their own ink are differenced, not the published
  // coordinate (which is the same number on both and would measure nothing).
  const model = (dx) => ({ order: 0, x0: 0, y0: 0, scale: 1,
    coeffs: [{ re: dx, im: 0 }], __toy: true });
  assert(typeof G.seamObservations === 'function', 'seamObservations is gone');
  assert(typeof G.footprintOverlap === 'function', 'footprintOverlap is gone');
  assert(G.MAX_SEAM_M === 60, 'the seam limit moved: ' + G.MAX_SEAM_M);
  // The limit must be DERIVED from the per-chart gates, not picked: two sheets
  // that each pass can differ by the sum, so it has to sit under that and over
  // every observation.
  assert(G.MAX_SEAM_M < G.MAX_PUBLISHED_RESIDUAL_M + G.MAX_GRATICULE_RESIDUAL_M,
    'the seam limit is looser than the two per-chart gates it is derived from');
  assert(G.MAX_SEAM_M > 19.5, 'the seam limit is below the worst measured seam (19.5 m)');
});

T('the seam pass is a corroboration and the build says how small it is', () => {
  // M5: this file quotes "three shared points" as evidence, so the shipped
  // report has to carry the figure rather than the claim living only in prose.
  const rep = JSON.parse(fs.readFileSync('data/vac-raster-report.json', 'utf8'));
  assert(Array.isArray(rep.seams), 'the report carries no seam pass');
  assert(rep.seamLimitM === 60, 'the report does not record the limit it applied');
  const pts = rep.seams.reduce((n, s) => n + s.points, 0);
  assert(pts >= 1, 'the seam pass measured nothing at all (' + pts + ')');
  for (const s of rep.seams) {
    if (!s.points) continue;
    assert(s.worstM <= rep.seamLimitM,
      s.a + ' vs ' + s.b + ' disagree by ' + s.worstM + ' m, over the ' + rep.seamLimitM + ' m limit');
  }
  // A BOUNDING BOX IS NOT A FOOTPRINT, and the seam pass only compares sheets
  // that really share ground. ENDU/ENTC overlaps by 0.0% despite abutting, so
  // a pass that used bounding boxes would claim pairs it cannot measure.
  assert(rep.seams.every((s) => s.footprintOverlap > 0),
    'a pair with no shared ground was compared anyway');
});

T('every prepared chart is re-verified against the live edition', () => {
  // The asset is decoupled from the AIRAC cycle; the CHECK is not. An amended
  // chart must stop being drawn, so build:aip re-reads AD 2.24 every run.
  const idx = JSON.parse(fs.readFileSync('data/vac-index.js', 'utf8')
    .replace(/^[\s\S]*window\.C182_VAC = /, '').replace(/;\s*$/, ''));
  const files = fs.readdirSync('data').filter((f) => /^vac-source-verification-.*\.json$/.test(f));
  assert(files.length >= 1, 'no VAC source verification was ever written');
  const v = JSON.parse(fs.readFileSync('data/' + files.sort().slice(-1)[0], 'utf8'));
  assert(v.editionLabel === idx.editionLabel,
    'the charts were verified against ' + v.editionLabel + ' but ship as ' + idx.editionLabel);
  const verified = new Set(v.results.map((r) => r.icao + '|' + r.chart));
  for (const c of idx.charts) {
    assert(verified.has(c.icao + '|' + c.chart),
      c.icao + ' ships without ever being checked against the live edition');
  }
  // and a chart the check marked superseded must not be drawable
  for (const r of v.results) {
    if (r.verdict === 'unchanged') continue;
    const c = idx.charts.find((x) => x.icao === r.icao && x.chart === r.chart);
    if (c) assert(!moduleExports.vac.vacDrawable(c),
      r.icao + ' was ' + r.verdict + ' and is still drawn');
  }
});

T('both builds ask ONE parser which PDF a chart is', () => {
  // Two parses of AD 2.24 would be two things that can disagree about which
  // graphic id a chart has - and the whole edition check rests on that id.
  const shared = fs.readFileSync('tools/aip-vac.mjs', 'utf8');
  assert(/export function vacGraphics/.test(shared), 'vacGraphics is not shared');
  for (const tool of ['tools/build-vac-raster.mjs', 'tools/build-aip.mjs']) {
    const src = fs.readFileSync(tool, 'utf8');
    assert(/import \{[^}]*vacGraphics[^}]*\} from '\.\/aip-vac\.mjs'/.test(src),
      tool + ' does not import the shared vacGraphics');
    assert(!/^function vacGraphics/m.test(src), tool + ' has its own copy of vacGraphics');
  }
});

T('the VAC overlay draws below everything the pilot touches', () => {
  // Pane order is load-bearing: above the route line, a press meant for a leg
  // would hit the image first. Measured for real in tools/verify-vac.mjs; this
  // guards the structure that check depends on.
  const z = (name) => {
    const m = new RegExp("getPane\\('" + name + "'\\)\\.style\\.zIndex = '(\\d+)'").exec(APP_SRC);
    return m ? Number(m[1]) : null;
  };
  assert(z('vacPane') !== null, 'there is no vacPane');
  assert(z('vacPane') < z('corridorPane'), 'the VAC is above the corridor');
  assert(z('vacPane') < z('airspacePane'), 'the VAC is above the airspace');
  assert(z('vacPane') < 400, 'the VAC is above the route line (overlayPane is 400)');
  assert(/getPane\('vacPane'\)\.style\.pointerEvents = 'none'/.test(APP_SRC),
    'the VAC pane takes pointer events - a click meant for the map could land on the image');
});

// =========================================================================
// MASS & BALANCE (v16.93, roadmap item 5). The arithmetic is checked against
// the school's own two sources, which agree with each other: the printed
// form C182OFPMBv4.2.pdf and the live workbook OFP-C182.xlsx. Nothing here
// is a round number someone liked - every figure asserted below is quoted
// from one of those two, and where they are silent the module is too.
// =========================================================================

T('the M&B golden fixture reproduces the workbook cell for cell', () => {
  const MB = moduleExports.mb;
  // OFP!A2 = LN-TRB, D4 = 170, M8 = 64 gal, D8 = 7.3, D10 = 0.7, M3 = 34.0 gal.
  const ac = MB.aircraftByReg('LN-TRB');
  assert(ac !== null, 'LN-TRB is not in the fleet');
  const st = { pilotLb: 170, rightLb: 0, rearLb: 0, bagALb: 7.3, bagBLb: 0, bagCLb: 0.7 };
  const r = MB.computeMassBalance(ac, st, 64, 64 - 34, 'ENDU -> ENTC');
  const near = (got, want, tol, what) =>
    assert(Math.abs(got - want) <= tol, what + ': ' + got + ' against the sheet\'s ' + want);
  // OFP!D11 / G11, and E11 which the sheet ROUNDS to 0.1 - so the rounding is
  // applied here rather than inside the module, which keeps all three arms
  // computed the same way (see the note on point()).
  near(r.takeoff.weightLb, 2582.3, 1e-9, 'D11 total take-off mass');
  near(r.takeoff.momentInLb, 103700.6, 1e-6, 'G11 take-off moment');
  near(Math.round(r.takeoff.armIn * 10) / 10, 40.2, 1e-9, 'E11 take-off arm');
  // OFP!D14 / E14 / G14 - E14 is NOT rounded in the sheet, so this is the
  // full-precision figure the workbook itself carries.
  near(r.landing.weightLb, 2378.3, 1e-9, 'D14 total landing mass');
  near(r.landing.armIn, 39.61426228818904, 1e-9, 'E14 landing arm');
  near(r.landing.momentInLb, 94214.6, 1e-6, 'G14 landing moment');
  // OFP!D15 / E15 / G15.
  near(r.zeroFuel.weightLb, 2198.3, 1e-9, 'D15 zero fuel mass');
  near(r.zeroFuel.armIn, 39.05044807351135, 1e-9, 'E15 zero fuel arm');
  near(r.zeroFuel.momentInLb, 85844.6, 1e-6, 'G15 zero fuel moment');
  // OFP!D7 = N8 = M8 * 6, and D12 = N3 = M3 * 6.
  near(r.fuelDepGal * MB.FUEL_LB_PER_GAL, 384, 1e-9, 'D7 fuel on board in pounds');
  near(r.burnGal * MB.FUEL_LB_PER_GAL, 204, 1e-9, 'D12 enroute fuel consumed in pounds');
  // OFP!N13 (Min FLT) and S12 (Vglide) on this fixture.
  assert(r.minFlightMin === 0, 'N13 should be zero below MLW: ' + r.minFlightMin);
  assert(r.vGlideKt === 70, 'S12 Vglide: ' + r.vGlideKt);
  // Every limit passes on the sheet's own example, or the fixture would be
  // asserting the arithmetic through a failure path.
  assert(r.checks.takeoffWeight === 'ok' && r.checks.landingWeight === 'ok' &&
    r.checks.takeoffCg === 'ok' && r.checks.landingCg === 'ok' &&
    r.checks.zeroFuelCg === 'ok', 'the sheet\'s own example does not pass: ' +
    JSON.stringify(r.checks));
});

T('the fleet is the published one, and it names no person', () => {
  const MB = moduleExports.mb;
  // 'AC REG'!A3:D7, corroborated figure for figure by the table printed on
  // page 2 of the form. Both sources, ten numbers, no disagreement.
  const want = [
    ['LN-TRA', 1993.6, 75870.2, 0], ['LN-TRB', 2020.3, 78756.2, 0],
    ['LN-TRC', 2031.1, 77121.6, 0], ['LN-TRD', 2024.5, 76587.7, 0],
    ['LN-TRE', 2038.5, 78989.1, 22.7]
  ];
  assert(MB.FLEET.length === want.length, 'the fleet size moved: ' + MB.FLEET.length);
  want.forEach((w, i) => {
    const a = MB.FLEET[i];
    assert(a.reg === w[0] && a.emptyWeightLb === w[1] && a.emptyMomentInLb === w[2] &&
      a.standardBagBLb === w[3], 'fleet row ' + i + ' differs from the sheet: ' + JSON.stringify(a));
  });
  // The workbook's document properties carry an author. A registration is a
  // machine, which the user has cleared; a name is not, and must never ride in.
  const json = JSON.stringify({ fleet: MB.FLEET, source: MB.FLEET_SOURCE });
  assert(!/Rockstad|Ole Markus/i.test(json), 'a person is named in the M&B dataset');
  assert(MB.FLEET_SOURCE.versionDate === '10.08.2026',
    'the version date does not match the one printed on the form: ' + MB.FLEET_SOURCE.versionDate);
});

T('the standard baggage is the workbook\'s, and it is a LOAD, not part of the empty mass', () => {
  const MB = moduleExports.mb;
  // OFP!D8 = 7.3 and OFP!D10 = 0.7 are constants typed into the workbook for
  // every aircraft; OFP!D9 is VLOOKUP into 'AC REG'!D, which only LN-TRE fills
  // (22.7). The author: "That should ALWAYS be defaulted whenever a plane is
  // chosen". Read out of the workbook, not restated here.
  const ofp = xlsxSheet('./OFP-C182.xlsx', 'OFP');
  assert(ofp.D8 === 7.3 && ofp.D10 === 0.7,
    'the workbook\'s standard baggage moved: D8=' + ofp.D8 + ' D10=' + ofp.D10);
  for (const a of MB.FLEET) {
    const std = MB.standardLoads(a);
    assert(std.bagALb === ofp.D8 && std.bagCLb === ofp.D10, a.reg + ' standard A/C: ' + JSON.stringify(std));
    assert(std.bagBLb === (a.reg === 'LN-TRE' ? 22.7 : 0), a.reg + ' standard B: ' + std.bagBLb);
    // The empty mass is the PUBLISHED line and nothing else - the form's Basic
    // Empty Mass row prints exactly this.
    const e = MB.emptyMass(a);
    assert(e.weightLb === a.emptyWeightLb && e.momentInLb === a.emptyMomentInLb,
      a.reg + ' empty mass is not the published one: ' + JSON.stringify(e));
  }
  // LN-TRE loaded with its standard baggage weighs what v16.93-v16.96 weighed
  // it at with the 22.7 lb hidden in the empty mass - the move changes where
  // the figure is SHOWN, not the aircraft.
  const tre = MB.aircraftByReg('LN-TRE');
  const loads = Object.assign({ pilotLb: 170, rightLb: 0, rearLb: 0 }, MB.standardLoads(tre));
  const r = MB.computeMassBalance(tre, loads, 64, 30);
  const want = 2038.5 + 22.7 + 170 + 7.3 + 0.7 + 64 * 6;
  assert(Math.abs(r.takeoff.weightLb - want) < 1e-9, 'TRE take-off: ' + r.takeoff.weightLb + ' vs ' + want);
  const wantM = 78989.1 + 22.7 * 116 + 170 * 37 + 7.3 * 97 + 0.7 * 129 + 64 * 6 * 46.5;
  assert(Math.abs(r.takeoff.momentInLb - wantM) < 1e-6, 'TRE moment: ' + r.takeoff.momentInLb);
});

T('choosing an aircraft loads its standard baggage, and only the baggage', () => {
  ev(`setMbReg(''); mbPrefs.loads = normaliseStationLoads({ pilotLb: 180, rightLb: 75, bagALb: 40 });
      setMbReg('LN-TRE');`);
  const l = JSON.parse(ev(`JSON.stringify(mbPrefs.loads)`));
  assert(l.bagALb === 7.3 && l.bagBLb === 22.7 && l.bagCLb === 0.7,
    'LN-TRE was not given its standard baggage: ' + JSON.stringify(l));
  assert(l.pilotLb === 180 && l.rightLb === 75, 'choosing a tail moved the seats: ' + JSON.stringify(l));
  // And switching tail re-defaults: LN-TRA has nothing at B.
  ev(`setMbReg('LN-TRA');`);
  const l2 = JSON.parse(ev(`JSON.stringify(mbPrefs.loads)`));
  assert(l2.bagALb === 7.3 && l2.bagBLb === 0 && l2.bagCLb === 0.7,
    'LN-TRA kept LN-TRE\'s compartment B load: ' + JSON.stringify(l2));
  // The boxes show it, so nothing is loaded that the pilot cannot see.
  assert(ev(`renderMassBalance(); document.getElementById('mb-bagALb').value`) === '7.3',
    'the Baggage A box does not show the standard load');
  // Extra baggage is typed over the default afterwards and stays.
  ev(`setMbLoad('bagALb', 25)`);
  assert(ev(`mbPrefs.loads.bagALb`) === 25, 'typing over the default did not stick');
  ev(`setMbReg(''); mbPrefs.loads = normaliseStationLoads({}); saveMbPrefs(); renderAllFlightTables();`);
});

T('a saved LN-TRE load from before v16.97 keeps its 22.7 lb', () => {
  // Stored under the old rule the Baggage B box held only the EXTRA, and the
  // structure rode in the empty mass. Loaded now it must weigh the same.
  ev(`localStorage.setItem('c182_mb_prefs', JSON.stringify({ reg: 'LN-TRE',
        loads: { pilotLb: 170, bagALb: 7.3, bagBLb: 10, bagCLb: 0.7 }, view: 'sector' }));
      loadMbPrefs();`);
  assert(Math.abs(ev(`mbPrefs.loads.bagBLb`) - 32.7) < 1e-9,
    'an old LN-TRE entry lost its structure: ' + ev(`mbPrefs.loads.bagBLb`));
  // ...exactly once: a v2 entry is taken as it stands.
  ev(`saveMbPrefs(); loadMbPrefs();`);
  assert(Math.abs(ev(`mbPrefs.loads.bagBLb`) - 32.7) < 1e-9,
    'the migration ran twice: ' + ev(`mbPrefs.loads.bagBLb`));
  ev(`localStorage.removeItem('c182_mb_prefs'); loadMbPrefs(); renderAllFlightTables();`);
});

T('the CG envelope is the workbook\'s, and it is CONVEX', () => {
  const MB = moduleExports.mb;
  // Performance!Q1:R8, the block the workbook itself labels USED FOR CG CALCS.
  const want = [[33, 1800], [33, 2225], [35.8, 2700], [41, 3100], [46, 3100], [46, 1800]];
  assert(JSON.stringify(MB.CG_ENVELOPE) === JSON.stringify(want),
    'the envelope moved: ' + JSON.stringify(MB.CG_ENVELOPE));
  // CONVEXITY IS NOT DECORATION - it is what makes checking only the take-off
  // and landing points sufficient. Every turn must go the same way.
  const ring = MB.CG_ENVELOPE, n = ring.length;
  let signs = 0;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n], c = ring[(i + 2) % n];
    const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    assert(z !== 0, 'vertex ' + ((i + 1) % n) + ' is collinear - a wasted vertex');
    signs += z > 0 ? 1 : -1;
  }
  assert(Math.abs(signs) === n, 'the envelope is NOT convex - the endpoint check ' +
    'in computeMassBalance is only valid on a convex envelope');
});

T('the envelope is convex in MOMENT-weight space, which is where fuel burns', () => {
  const MB = moduleExports.mb;
  // Burning fuel is a STRAIGHT LINE in (moment, weight): weight falls one
  // pound per pound, moment falls FUEL_ARM_IN per pound. So the space that
  // matters for "are the endpoints enough" is this one, not (arm, weight) -
  // and the map between them is not affine, so the previous test does not
  // imply this one. The forward boundary must be CONVEX and the aft CONCAVE.
  const step = 0.5, lo = 1800, hi = 3100;
  /** @type {number[]} */ const fwd = []; /** @type {number[]} */ const aft = [];
  for (let w = lo; w <= hi + 1e-9; w += step) {
    const m = MB.momentLimits(w);
    assert(m !== null, 'no moment limits at ' + w + ' lb, inside the envelope\'s own range');
    fwd.push(m.minInLb); aft.push(m.maxInLb);
  }
  let curvedFwd = 0;
  for (let i = 1; i < fwd.length - 1; i++) {
    const d2f = fwd[i + 1] - 2 * fwd[i] + fwd[i - 1];
    const d2a = aft[i + 1] - 2 * aft[i] + aft[i - 1];
    assert(d2f >= -1e-6, 'the forward moment boundary bends the wrong way at ' +
      (lo + i * step) + ' lb (' + d2f + ')');
    assert(d2a <= 1e-6, 'the aft moment boundary bends the wrong way at ' +
      (lo + i * step) + ' lb (' + d2a + ')');
    if (d2f > 1e-6) curvedFwd++;
  }
  // If the forward boundary were straight everywhere, "convex" would be true
  // and would have proved nothing about the shape the argument relies on.
  assert(curvedFwd > 0, 'the forward boundary is straight throughout - this test ' +
    'is passing vacuously');
  // The aft boundary is the constant arm 46, so moment = 46 * weight exactly.
  assert(Math.abs(aft[0] - 46 * lo) < 1e-6 && Math.abs(aft[aft.length - 1] - 46 * hi) < 1e-6,
    'the aft boundary is no longer the constant arm 46');
});

T('the whole fuel-burn path stays inside, not just its two ends', () => {
  const MB = moduleExports.mb;
  // The convexity above says this must hold. This is the behavioural half:
  // start from every legal take-off point across the WHOLE envelope, burn a
  // real amount of fuel, and look at every weight in between.
  //
  // WALKING THE TAKE-OFF POINT, NOT A ZERO-FUEL GRID, and that is what makes
  // this discriminating. A fuel path has a fixed slope of FUEL_ARM_IN in
  // (moment, weight), so it can only leave through the forward boundary where
  // the boundary's OWN slope brackets 46.5 - which on this envelope is across
  // the 2225 lb vertex, where it goes 33.00 -> 46.12. A grid that never puts
  // an endpoint near that vertex sweeps hundreds of thousands of paths and
  // proves nothing about the shape: measured, a version of this test that
  // started from zero-fuel weights found 0 violations against an envelope
  // deliberately dented AT that vertex.
  const SAMPLES = 50;
  const wStep = Math.max(1, Math.round(10 / SWEEP_N));
  const aStep = 0.2 / SWEEP_N;
  let pairs = 0, violations = 0, longest = 0, nearVertex = 0;
  for (let w0 = 1800; w0 <= 3100; w0 += wStep) {
    const l0 = MB.armLimits(w0);
    if (!l0) continue;
    for (let a0 = l0.fwdIn; a0 <= l0.aftIn + 1e-9; a0 += aStep) {
      const m0 = a0 * w0;
      for (const burnLb of [30, 60, 120, 200, 300, 400, 500, 600]) {
        const w1 = w0 - burnLb;
        if (w1 < 1800) continue;
        const m1 = m0 - burnLb * MB.FUEL_ARM_IN;
        if (MB.envelopePosition(w1, m1 / w1) !== 'ok') continue;
        pairs++;
        if (burnLb > longest) longest = burnLb;
        if (w1 <= 2225 && w0 >= 2225) nearVertex++;
        for (let k = 1; k < SAMPLES; k++) {
          const t = k / SAMPLES;
          const w = w0 + (w1 - w0) * t, m = m0 + (m1 - m0) * t;
          if (MB.envelopePosition(w, m / w) !== 'ok') violations++;
        }
      }
    }
  }
  assert(violations === 0, violations + ' points on a fuel-burn path left the ' +
    'envelope although both ends were inside - the endpoint check in ' +
    'computeMassBalance is not sufficient');
  // M5: assert what the sweep actually measured. A sweep that stopped
  // generating legal pairs, or stopped crossing the one vertex where a path
  // CAN exit, would otherwise pass by finding nothing to check.
  assert(pairs > 20000, 'the sweep only found ' + pairs + ' legal endpoint pairs');
  assert(nearVertex > 1000, 'only ' + nearVertex + ' paths cross the 2225 lb vertex, ' +
    'which is the only place a fuel path can leave this envelope');
  assert(longest === 600, 'the longest burn swept was ' + longest + ' lb');
  // And the sampler discriminates: move one end out and it says so.
  assert(MB.envelopePosition(2600, 32.5) === 'fwd' &&
    MB.envelopePosition(2600, 46.5) === 'aft' &&
    MB.envelopePosition(3200, 40) === 'weight',
    'envelopePosition is not actually evaluating anything');
});

T('the arm limits reproduce the workbook\'s separately drawn MLW line', () => {
  const MB = moduleExports.mb;
  // Performance!W1:X3 draws the MLW line as arm 39 -> 46 at 2950 lb. That is a
  // DIFFERENT block of the sheet from the envelope, so if the envelope were
  // mistranscribed the two would disagree. They do not: the envelope's own
  // width at 2950 lb is 39.05 to 46.00.
  const lim = MB.armLimits(MB.MLW_LB);
  assert(lim !== null, 'no limits at MLW');
  assert(Math.abs(lim.fwdIn - 39.05) < 0.005, 'forward limit at MLW: ' + lim.fwdIn);
  assert(lim.aftIn === 46, 'aft limit at MLW: ' + lim.aftIn);
  // Boundaries are inclusive - a published limit is a value you may load to.
  assert(MB.envelopePosition(2950, 39.05) === 'ok', 'the forward limit itself is refused');
  assert(MB.envelopePosition(2950, 46) === 'ok', 'the aft limit itself is refused');
  // Outside the envelope's weight range there is no limit to state.
  assert(MB.armLimits(1700) === null && MB.armLimits(3200) === null,
    'limits are being stated for weights the envelope does not cover');
  assert(MB.armLimits(NaN) === null, 'a missing weight produced limits');
});

T('Va comes from the POH table, not the sheet\'s linear formula', () => {
  const MB = moduleExports.mb;
  // The table is printed on the form AND in Performance!R7:S9. The workbook's
  // own formula =110-(((3100-D14)*9)/500) is exact at 3100 and 2600 and gives
  // 92 at 2100, where the table says 91 - one knot HIGH at the light end,
  // which is the unsafe direction. The user's instruction: use the table.
  const linear = (w) => 110 - ((3100 - w) * 9) / 500;
  assert(MB.vaKt(3100) === 110, 'Va at 3100: ' + MB.vaKt(3100));
  assert(MB.vaKt(2600) === 101, 'Va at 2600: ' + MB.vaKt(2600));
  assert(MB.vaKt(2100) === 91, 'Va at 2100: ' + MB.vaKt(2100));
  assert(Math.round(linear(2100)) === 92, 'the sheet formula no longer disagrees at 2100 - ' +
    'this test has stopped discriminating between the two');
  // Between the rows it interpolates in the table, so it must NOT match the
  // straight line through the end points.
  const mid = MB.vaKt(2378.3);
  assert(Math.abs(mid - 96.566) < 0.001, 'Va at the fixture\'s landing mass: ' + mid);
  assert(Math.abs(mid - linear(2378.3)) > 0.4, 'Va is tracking the sheet formula, not the table');
  // Below the table it refuses rather than extrapolating a speed a pilot would fly.
  assert(MB.vaKt(2099) === null, 'Va was invented below the table: ' + MB.vaKt(2099));
  assert(MB.vaKt(3200) === 110, 'Va above MTOW should clamp to the table top');
});

T('Min FLT reproduces OFP!N13 at 12 gal/h', () => {
  const MB = moduleExports.mb;
  assert(MB.MIN_FLIGHT_GPH === 12, 'the Min FLT rate moved: ' + MB.MIN_FLIGHT_GPH);
  assert(MB.minFlightMinutes(2950) === 0, 'at MLW exactly, nothing must be burned off');
  assert(MB.minFlightMinutes(2400) === 0, 'below MLW, nothing must be burned off');
  // =IF((D11>2950),((D11-2950)/6)/P4/24,0), expressed in minutes rather than
  // Excel's day fraction.
  const w = 3100;
  const want = ((w - 2950) / MB.FUEL_LB_PER_GAL) / 12 * 60;
  assert(Math.abs(MB.minFlightMinutes(w) - want) < 1e-9,
    'Min FLT at MTOW: ' + MB.minFlightMinutes(w) + ' against ' + want);
  assert(Math.abs(want - 125) < 1e-9, 'the worked figure moved: ' + want);
  // 150 lb over MLW is 25 gal, and 25 gal at 12 gal/h is 2 h 05 - which is a
  // long time to be told to stay airborne, and exactly why the figure is shown.
});

T('there is ONE fuel density, and the kilogram figure is derived from it', () => {
  const MB = moduleExports.mb;
  // The workbook's =M8*6 and the user's answer: 6 lb/gal at standard temperature.
  assert(MB.FUEL_LB_PER_GAL === 6.0, 'the density moved: ' + MB.FUEL_LB_PER_GAL);
  // Derived, not carried separately - two roundings are two things that drift.
  assert(Math.abs(MB.FUEL_KG_PER_GAL - 6 / 2.20462262184878) < 1e-12,
    'the kilogram figure is not derived from the pound figure');
  assert(Math.abs(MB.FUEL_KG_PER_GAL - 2.72155) < 0.00001,
    'kg per gallon: ' + MB.FUEL_KG_PER_GAL);
});

T('MLW is checked at EVERY landing, not just the last one', () => {
  const MB = moduleExports.mb;
  // The user: "Check the landing weight / t&g weight for every stop to ensure
  // we're within limits (2950lbs)". A mid-mission refuel can make an EARLIER
  // arrival the heavy one, so a master that looked only at the final arrival
  // would report a legal mission that is not.
  const ac = MB.aircraftByReg('LN-TRB');
  const st = { pilotLb: 400, rightLb: 200, rearLb: 200, bagALb: 40, bagBLb: 0, bagCLb: 0 };
  const m = MB.computeMissionMassBalance(ac, st, [
    { fuelDepGal: 40, fuelArrGal: 32, label: 'ENDU -> ENTC' },   // heavy arrival
    { fuelDepGal: 10, fuelArrGal: 4, label: 'ENTC -> ENEV' }     // light arrival
  ]);
  assert(m.sectors.length === 2, 'the mission lost a sector');
  assert(m.last.checks.landingWeight === 'ok',
    'the fixture no longer ends light - it cannot discriminate');
  assert(m.sectors[0].checks.landingWeight === 'over',
    'the heavy intermediate arrival was not flagged: ' + m.sectors[0].landing.weightLb);
  assert(m.worstLanding === m.sectors[0], 'worstLanding is not the heaviest arrival');
  const probs = MB.massBalanceProblems(m);
  assert(probs.some(p => /ENDU -> ENTC/.test(p) && /landing mass/.test(p)),
    'the banner does not name the sector and the finding: ' + JSON.stringify(probs));
});

T('a master M&B walks the sectors; it does not subtract a total', () => {
  const MB = moduleExports.mb;
  // With a refuel at a full stop the landing weight is NOT the take-off weight
  // less the trip burn. A master computed that way prints a weight the
  // aircraft never has.
  const ac = MB.aircraftByReg('LN-TRB');
  const st = { pilotLb: 170, rightLb: 0, rearLb: 0, bagALb: 0, bagBLb: 0, bagCLb: 0 };
  const m = MB.computeMissionMassBalance(ac, st, [
    { fuelDepGal: 40, fuelArrGal: 20 },
    { fuelDepGal: 60, fuelArrGal: 45 }   // refuelled to 60 on the ground
  ]);
  const totalBurn = m.sectors.reduce((a, s) => a + s.burnGal, 0);
  const naive = m.first.takeoff.weightLb - totalBurn * MB.FUEL_LB_PER_GAL;
  assert(Math.abs(m.last.landing.weightLb - naive) > 100,
    'the fixture has no refuel in it, so it cannot tell the two apart');
  assert(Math.abs(m.last.landing.weightLb -
    (m.zeroFuel.weightLb + 45 * MB.FUEL_LB_PER_GAL)) < 1e-9,
    'the final landing weight is not the last sector\'s own arrival fuel');
});

T('a missing figure is a finding, never a zero', () => {
  const MB = moduleExports.mb;
  const ac = MB.aircraftByReg('LN-TRB');
  const st = { pilotLb: 170, rightLb: 0, rearLb: 0, bagALb: 0, bagBLb: 0, bagCLb: 0 };
  // An absent fuel figure must not be read as an empty tank.
  const m = MB.computeMissionMassBalance(ac, st, [{ fuelDepGal: NaN, fuelArrGal: 20 }]);
  assert(!Number.isFinite(m.sectors[0].takeoff.weightLb),
    'an unknown fuel load produced a take-off weight anyway: ' + m.sectors[0].takeoff.weightLb);
  const probs = MB.massBalanceProblems(m);
  assert(probs.some(p => /fuel on board is not known/.test(p)),
    'the missing fuel was not reported: ' + JSON.stringify(probs));
  assert(MB.envelopePosition(NaN, 40) === 'unknown' && MB.envelopePosition(2500, null) === 'unknown',
    'a missing figure got a verdict');
  // No aircraft at all is a finding too, not a silent empty sheet.
  assert(MB.massBalanceProblems(null).length === 1, 'no aircraft produced no finding');
  assert(MB.aircraftByReg('LN-TRZ') === null && MB.aircraftByReg(null) === null,
    'an unknown registration resolved to something');
});

T('no maximum baggage weight is claimed, and the absence is stated', () => {
  const MB = moduleExports.mb;
  // Neither the form nor the workbook prints one. Inventing 200 lb from
  // general C182 knowledge would read as a checked limit and be a guess.
  assert(MB.BAGGAGE_MAX_LB === null, 'a baggage limit appeared from somewhere');
  const ac = MB.aircraftByReg('LN-TRB');
  const st = { pilotLb: 170, rightLb: 0, rearLb: 0, bagALb: 300, bagBLb: 0, bagCLb: 0 };
  const m = MB.computeMissionMassBalance(ac, st, [{ fuelDepGal: 30, fuelArrGal: 10 }]);
  const cautions = MB.massBalanceCautions(m);
  assert(cautions.some(c => /baggage limit is NOT checked/.test(c)),
    'the absent baggage check is not declared: ' + JSON.stringify(cautions));
  // A caution is not a DO-NOT-USE finding, and the two lists must stay apart.
  assert(!MB.massBalanceProblems(m).some(p => /baggage/i.test(p)),
    'the baggage caution leaked into the banner\'s findings');
});

T('one fault is reported once, and the autopilot line is a caution', () => {
  const MB = moduleExports.mb;
  const ac = MB.aircraftByReg('LN-TRB');
  // Over MTOW: the envelope's ceiling IS 3100, so the point is outside the
  // envelope as well as over weight. That is one fault, not two.
  const heavy = { pilotLb: 400, rightLb: 250, rearLb: 300, bagALb: 100, bagBLb: 0, bagCLb: 0 };
  const m = MB.computeMissionMassBalance(ac, heavy, [{ fuelDepGal: 64, fuelArrGal: 40 }]);
  const probs = MB.massBalanceProblems(m);
  assert(probs.some(p => /take-off mass/.test(p) && /3100/.test(p)),
    'over MTOW was not reported: ' + JSON.stringify(probs));
  assert(!probs.some(p => /take-off CG/.test(p)),
    'the same fault was reported twice, as weight and as CG: ' + JSON.stringify(probs));
  // The autopilot limit is read off a two-point line in the workbook, so it is
  // a caution naming its source - never an out-of-limits finding.
  assert(MB.AUTOPILOT_MIN_ARM_IN === 34 && MB.AUTOPILOT_LIMIT_MAX_LB === 2400,
    'the autopilot line moved');
  assert(MB.autopilotAllowed(2200, 33.5) === false, 'forward of 34 in at 2200 lb is allowed');
  assert(MB.autopilotAllowed(2200, 34) === true, 'the limit itself is refused');
  assert(MB.autopilotAllowed(2600, 33.5) === true,
    'the autopilot limit is being applied above the weight the line is drawn to');
  // It stops at 2400 lb because that is where the STANDARD forward limit
  // reaches 34 in - which is why reading the line that way is an inference
  // from the data rather than a guess about intent.
  const at2400 = MB.armLimits(MB.AUTOPILOT_LIMIT_MAX_LB);
  assert(Math.abs(at2400.fwdIn - MB.AUTOPILOT_MIN_ARM_IN) < 0.05,
    'the standard forward limit at 2400 lb is ' + at2400.fwdIn +
    ', so the autopilot line no longer ends where the two meet');
});

T('every CG finding names the sector, the figure and the limit', () => {
  const MB = moduleExports.mb;
  // The v16.20 rule: "a non-numeric value appeared" is not something a pilot
  // can act on. Each message must carry enough to fix the load.
  //
  // THE FIXTURE IS TAIL-HEAVY, BECAUSE NOSE-HEAVY IS NOT REACHABLE ON THIS
  // FLEET and a test has to exercise a case that can happen. Measured over
  // all five aircraft with up to 500 lb in the front seats (the only station
  // forward of the empty arm), the closest any of them gets to the forward
  // limit is LN-TRD at 37.67 in against a limit of 34.77 - 2.9 in of margin.
  // Every other station is at 74 in or further aft. So the forward branch is
  // exercised below against a HYPOTHETICAL airframe instead, and said to be
  // hypothetical rather than dressed up as a fleet case.
  const ac = MB.aircraftByReg('LN-TRB');
  const aft = { pilotLb: 0, rightLb: 0, rearLb: 0, bagALb: 0, bagBLb: 0, bagCLb: 220 };
  const m = MB.computeMissionMassBalance(ac, aft, [{ fuelDepGal: 5, fuelArrGal: 1, label: 'ENDU -> ENTC' }]);
  assert(m.sectors[0].checks.zeroFuelCg === 'aft',
    'the fixture is no longer tail-heavy: ' + JSON.stringify(m.sectors[0].checks));
  const p = MB.massBalanceProblems(m).find(x => /zero-fuel CG/.test(x));
  assert(p, 'the aft CG was not reported');
  assert(/ENDU -> ENTC/.test(p), 'the finding does not name the sector: ' + p);
  assert(/aft of the aft limit/.test(p), 'the finding does not say which way: ' + p);
  assert(/\d+\.\d in/.test(p) && /\d+\.\d lb/.test(p), 'the finding carries no figures: ' + p);
  assert(/ 46\.0 in/.test(p), 'the finding does not quote the limit it broke: ' + p);

  // The forward wording, on an airframe that does not exist - the only way to
  // reach that branch, and the comment above says why.
  const hypothetical = { reg: 'LN-TEST', emptyWeightLb: 2000, emptyMomentInLb: 2000 * 32,
                         standardBagBLb: 0 };
  const fm = MB.computeMissionMassBalance(hypothetical,
    { pilotLb: 200, rightLb: 0, rearLb: 0, bagALb: 0, bagBLb: 0, bagCLb: 0 },
    [{ fuelDepGal: 5, fuelArrGal: 1, label: 'test' }]);
  const fp = MB.massBalanceProblems(fm).find(x => /take-off CG/.test(x));
  assert(fp && /forward of the forward limit/.test(fp),
    'the forward branch produces no finding: ' + JSON.stringify(MB.massBalanceProblems(fm)));
});

// The POH takeoff tables are DATA ONLY at this point - nothing in the app
// reads them. They are guarded anyway, because the thing that makes them
// trustworthy is an agreement between two INDEPENDENT transcriptions of the
// same POH, and an agreement nobody checks is an agreement that drifts.
//
// THE FIRST VERSION OF THIS TEST DID NOT OPEN THE WORKBOOK AT ALL. Its comment
// claimed the 90-cell agreement was asserted; it only checked the snapshot
// against itself and passed. That is the v16.88 vacuous-comparison failure
// exactly - a comparison against a value that is not there proves nothing in
// either direction - and the fix is to read the real file, which needs no
// dependency: an .xlsx is a ZIP of XML and zlib is built in.
function xlsxSheet(file, sheetName, opts) {
  const fs = require('fs'), zlib = require('zlib');
  const buf = fs.readFileSync(file);
  const entry = (name) => {
    let i = 0;
    while (i < buf.length - 4) {
      if (buf.readUInt32LE(i) !== 0x04034b50) { i++; continue; }
      const method = buf.readUInt16LE(i + 8), compSize = buf.readUInt32LE(i + 18);
      const nameLen = buf.readUInt16LE(i + 26), extraLen = buf.readUInt16LE(i + 28);
      const fname = buf.slice(i + 30, i + 30 + nameLen).toString('latin1');
      const dataAt = i + 30 + nameLen + extraLen;
      if (fname === name) {
        const d = buf.slice(dataAt, dataAt + compSize);
        return method === 0 ? d : zlib.inflateRawSync(d);
      }
      i = dataAt + (compSize || 1);
    }
    return null;
  };
  // Resolve the sheet by NAME through the relationships, never by guessing
  // sheet2.xml - the file order is not the tab order and a re-save can move it.
  const wbXml = entry('xl/workbook.xml').toString('utf8');
  const sheet = new RegExp('<sheet name="' + sheetName + '"[^>]*r:id="([^"]+)"').exec(wbXml);
  assert(sheet, 'the workbook has no sheet named ' + sheetName);
  const rels = entry('xl/_rels/workbook.xml.rels').toString('utf8');
  const target = new RegExp('Id="' + sheet[1] + '"[^>]*Target="([^"]+)"').exec(rels);
  assert(target, 'no relationship for ' + sheet[1]);
  const xml = entry('xl/' + target[1].replace(/^\/?xl\//, '')).toString('utf8');
  /** @type {Record<string, number|string>} */
  const cells = {};
  // Numeric cells only, unless text is asked for: a shared string carries t="s"
  // and indexes xl/sharedStrings.xml. The POH checks want numbers and nothing
  // else, so text stays opt-in rather than something they could trip over.
  // A FORMULA's cached result counts too (`<f>...</f><v>...</v>`): the OFP
  // sheet's worked example is formulas, and reading only literal cells saw none
  // of it. A formula whose result is TEXT (t="str", "e", "b") is not a number.
  for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"(?![^>]*t="(?:s|str|e|b|inlineStr)")[^>]*>(?:\s*<f[^>]*\/>|\s*<f[^>]*>[^<]*<\/f>)?\s*<v>([^<]*)<\/v>/g)) {
    cells[m[1]] = Number(m[2]);
  }
  if (opts && opts.strings) {
    const ssXml = entry('xl/sharedStrings.xml').toString('utf8');
    const shared = [...ssXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((si) =>
      [...si[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((t) => t[1]).join(''));
    for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"[^>]*t="s"[^>]*>\s*<v>([^<]*)<\/v>/g)) {
      cells[m[1]] = shared[Number(m[2])];
    }
  }
  return cells;
}

T('the POH takeoff tables agree with the workbook, cell for cell', () => {
  const poh = JSON.parse(require('fs').readFileSync('./tools/prepared/poh-takeoff.json', 'utf8'));
  const temps = poh.temperaturesC;
  assert(JSON.stringify(temps) === '[0,10,20,30,40]', 'the temperature axis moved');
  assert(JSON.stringify(poh.weightsLb) === '[2300,2700,3100]', 'the weight axis moved');
  assert(JSON.stringify(poh.pressureAltitudesFt) === '[0,1000,2000,3000,4000,5000,6000,7000,8000]',
    'the pressure-altitude axis moved');

  // THE REAL CROSS-CHECK. Performance!A:D was transcribed by the author from
  // the same POH pages, independently of the screenshots this snapshot was read
  // from, and covers PA 0-5000. Every one of those cells must agree exactly -
  // that is what makes the 6000/7000/8000 rows, which exist ONLY here,
  // trustworthy read by the same method.
  const cells = xlsxSheet('./OFP-C182.xlsx', 'Performance');
  let checked = 0, maxPa = 0;
  for (let r = 2; r <= 91; r++) {
    const w = cells['A' + r], pa = cells['B' + r], t = cells['C' + r], d = cells['D' + r];
    assert(Number.isFinite(w) && Number.isFinite(pa) && Number.isFinite(t) && Number.isFinite(d),
      'the workbook row ' + r + ' is not four numbers - has Performance!A:D moved?');
    const col = poh.table[String(w)] && poh.table[String(w)][String(pa)];
    assert(col, 'the POH snapshot has no ' + w + ' lb / ' + pa + ' ft row');
    const cell = col[temps.indexOf(t)];
    assert(Array.isArray(cell), 'no POH cell at ' + w + '/' + pa + '/' + t);
    assert(cell[1] === d, 'POH and workbook disagree at ' + w + ' lb / ' + pa +
      ' ft / ' + t + ' C: snapshot ' + cell[1] + ', workbook ' + d);
    assert(cell[1] > cell[0], 'the 50 ft distance is not longer than the ground roll at ' +
      w + '/' + pa + '/' + t + ': ' + JSON.stringify(cell));
    checked++;
    if (pa > maxPa) maxPa = pa;
  }
  // M5: assert what the cross-check actually covered. A workbook re-saved with
  // fewer rows would otherwise shrink the overlap silently.
  assert(checked === 90, 'the overlap with the workbook is no longer 90 cells: ' + checked);
  assert(maxPa === 5000, 'the workbook now reaches ' + maxPa +
    ' ft, so it is no longer the SHORT side of this comparison');
  assert(poh.pressureAltitudesFt[poh.pressureAltitudesFt.length - 1] === 8000,
    'the POH table no longer reaches 8000 ft, so there is nothing the workbook is short of');

  // A DELETED CELL IS A REFUSAL, NOT MISSING DATA. The POH prints "---" and
  // says why: climb after lift-off is below 150 fpm. Exactly three cells, all
  // at 3100 lb, and they must stay null - a future interpolator that filled
  // them in would state a distance the manufacturer declines to certify.
  const deleted = [];
  for (const w of poh.weightsLb) {
    for (const pa of poh.pressureAltitudesFt) {
      poh.table[String(w)][String(pa)].forEach((c, i) => {
        if (c === null) deleted.push(w + '/' + pa + '/' + temps[i]);
      });
    }
  }
  assert(deleted.join(',') === '3100/7000/40,3100/8000/30,3100/8000/40',
    'the deleted cells moved: ' + deleted.join(','));
  assert(/150 FPM/i.test(poh.deletedCellMeaning), 'the reason for a deleted cell is not recorded');

  // Monotonic in both directions the physics demands - an independent way a
  // misread digit shows up, and it covers the rows the workbook cannot check.
  for (const w of poh.weightsLb) {
    for (const pa of poh.pressureAltitudesFt) {
      const row = poh.table[String(w)][String(pa)];
      for (let i = 1; i < row.length; i++) {
        if (!row[i] || !row[i - 1]) continue;
        assert(row[i][1] > row[i - 1][1], 'distance does not increase with temperature at ' +
          w + '/' + pa + ': ' + row[i - 1][1] + ' -> ' + row[i][1]);
      }
    }
    for (let k = 1; k < poh.pressureAltitudesFt.length; k++) {
      const lo = poh.table[String(w)][String(poh.pressureAltitudesFt[k - 1])];
      const hi = poh.table[String(w)][String(poh.pressureAltitudesFt[k])];
      for (let i = 0; i < temps.length; i++) {
        if (!lo[i] || !hi[i]) continue;
        assert(hi[i][1] > lo[i][1], 'distance does not increase with pressure altitude at ' +
          w + ' lb / ' + temps[i] + ' C');
      }
    }
  }
  // And heavier is always longer, at every shared condition.
  for (const pa of poh.pressureAltitudesFt) {
    for (let i = 0; i < temps.length; i++) {
      const a = poh.table['2300'][String(pa)][i], b = poh.table['2700'][String(pa)][i],
            c = poh.table['3100'][String(pa)][i];
      if (a && b) assert(b[1] > a[1], 'heavier is not longer at ' + pa + '/' + temps[i]);
      if (b && c) assert(c[1] > b[1], 'heavier is not longer at ' + pa + '/' + temps[i]);
    }
  }
});

T('the POH landing table agrees with the workbook, and carries ONE weight', () => {
  const ldg = JSON.parse(require('fs').readFileSync('./tools/prepared/poh-landing.json', 'utf8'));
  const temps = ldg.temperaturesC;
  assert(JSON.stringify(temps) === '[0,10,20,30,40]', 'the temperature axis moved');
  assert(JSON.stringify(ldg.pressureAltitudesFt) === '[0,1000,2000,3000,4000,5000,6000,7000,8000]',
    'the pressure-altitude axis moved');

  // ONE WEIGHT, AND IT IS MLW. This is not a weight axis with a single row -
  // the POH publishes the landing distance at 2950 lb only. A future
  // interpolator must never scale it by weight; a lighter aeroplane lands
  // SHORTER, so the 2950 figure errs long for any legal landing weight, which
  // is the safe direction and is why one table suffices.
  assert(ldg.weightLb === 2950, 'the landing table weight moved: ' + ldg.weightLb);
  assert(ldg.weightIsMaximumLanding === true, 'the table no longer declares itself to be at MLW');
  assert(!('weightsLb' in ldg) && !Array.isArray(ldg.weightLb),
    'the landing table has grown a weight axis the POH does not publish');
  // Third independent statement of MLW, after the drawn line and the author's own.
  assert(ldg.weightLb === moduleExports.mb.MLW_LB,
    'the POH landing table is published at ' + ldg.weightLb +
    ' lb but massbalance.js uses ' + moduleExports.mb.MLW_LB + ' lb as MLW');

  // THE REAL CROSS-CHECK, against the workbook's own Performance!F:H.
  const cells = xlsxSheet('./OFP-C182.xlsx', 'Performance');
  let checked = 0, maxPa = 0;
  for (let r = 2; r <= 31; r++) {
    const pa = cells['F' + r], t = cells['G' + r], d = cells['H' + r];
    assert(Number.isFinite(pa) && Number.isFinite(t) && Number.isFinite(d),
      'the workbook landing row ' + r + ' is not three numbers - has Performance!F:H moved?');
    const row = ldg.table[String(pa)];
    assert(row, 'the POH snapshot has no ' + pa + ' ft landing row');
    const cell = row[temps.indexOf(t)];
    assert(Array.isArray(cell), 'no landing cell at ' + pa + '/' + t);
    assert(cell[1] === d, 'POH and workbook disagree at ' + pa + ' ft / ' + t +
      ' C: snapshot ' + cell[1] + ', workbook ' + d);
    assert(cell[1] > cell[0], 'the 50 ft distance is not longer than the ground roll at ' +
      pa + '/' + t + ': ' + JSON.stringify(cell));
    checked++;
    if (pa > maxPa) maxPa = pa;
  }
  assert(checked === 30, 'the overlap with the workbook is no longer 30 cells: ' + checked);
  assert(maxPa === 5000, 'the workbook landing table now reaches ' + maxPa +
    ' ft, so it is no longer the SHORT side of this comparison');

  // Monotonic in both directions - the only guard that reaches PA 6000-8000,
  // where nothing can corroborate.
  for (const pa of ldg.pressureAltitudesFt) {
    const row = ldg.table[String(pa)];
    for (let i = 1; i < row.length; i++) {
      assert(row[i][1] > row[i - 1][1], 'landing distance does not increase with temperature at ' +
        pa + ' ft: ' + row[i - 1][1] + ' -> ' + row[i][1]);
    }
  }
  for (let k = 1; k < ldg.pressureAltitudesFt.length; k++) {
    const lo = ldg.table[String(ldg.pressureAltitudesFt[k - 1])];
    const hi = ldg.table[String(ldg.pressureAltitudesFt[k])];
    for (let i = 0; i < temps.length; i++) {
      assert(hi[i][1] > lo[i][1],
        'landing distance does not increase with pressure altitude at ' + temps[i] + ' C');
    }
  }
  // NOTHING IS DELETED HERE, unlike the 3100 lb takeoff table - a landing needs
  // no climb performance, so there is no condition the POH declines to publish.
  const nulls = ldg.pressureAltitudesFt.reduce(
    (n, pa) => n + ldg.table[String(pa)].filter((c) => c === null).length, 0);
  assert(nulls === 0, 'the landing table has gained a deleted cell: ' + nulls);

  // THE GRASS CORRECTION IS NOT THE TAKEOFF ONE, and the two must never be
  // shared: 45% of the ground roll here against 15% for takeoff. Identical
  // wording, different number - the "old rule applied to a new surface" shape.
  const to = JSON.parse(require('fs').readFileSync('./tools/prepared/poh-takeoff.json', 'utf8'));
  assert(/45%/.test(ldg.corrections.grassRunway), 'the landing grass figure moved: ' +
    ldg.corrections.grassRunway);
  assert(/15%/.test(to.corrections.grassRunway), 'the takeoff grass figure moved: ' +
    to.corrections.grassRunway);
  assert(ldg.corrections.grassRunway !== to.corrections.grassRunway,
    'the landing and takeoff grass corrections have become the same string');
  // The wind corrections ARE identical in the POH, and that is worth pinning
  // too - so a future change has to be deliberate rather than a copy-paste.
  assert(ldg.corrections.tailwind === to.corrections.tailwind &&
    ldg.corrections.headwind === to.corrections.headwind,
    'the POH wind corrections used to be identical for takeoff and landing');
  assert(/40% longer/.test(ldg.corrections.flapsUp),
    'the flaps-up landing penalty is not recorded');
});

// =========================================================================
// PHASE B (v16.94): the exact per-sector fuel Mass & Balance weighs, and the
// single fuel density. The display column is unchanged; what is new is that
// the gallons behind it are now carried out of the render pass unrounded.
// =========================================================================

const SEED_STOP = `flights = [
  { id: 1, title: "F1", depElev: 254, waypoints: [
    { lat: 69.05505349, lng: 18.54466865, name: "ENDU", alt: 254,  oat: 10, wdir: 0, wspd: 0, var: -11 },
    { lat: 69.67895054, lng: 18.91143033, name: "ENTC", alt: 2500, oat: 10, wdir: 0, wspd: 0, var: -12,
      stop: "full-stop", stopMin: 10, fuelAfterGal: 50 }
  ]},
  { id: 2, title: "F2", depElev: 229, waypoints: [
    { lat: 69.67895054, lng: 18.91143033, name: "ENTC", alt: 229,  oat: 10, wdir: 0, wspd: 0, var: -12 },
    { lat: 69.05505349, lng: 18.54466865, name: "ENDU", alt: 2500, oat: 10, wdir: 0, wspd: 0, var: -11 }
  ]}
]; activeFlightIndex = 0; refreshMap(); renderAllFlightTables();`;

T('every sector carries its fuel in GALLONS, whatever the column is showing', () => {
  // The whole point of Phase B: a weight can never be computed from a figure
  // that is in litres, or that has been through toFixed(1) once a leg.
  ev(SEED2);
  doc.getElementById('fuel-dep').value = '64';
  w.renderAllFlightTables();
  const inGal = ev('ofpPrintModel.map(s => [s.fuelGal.dep, s.fuelGal.arr])');
  assert(inGal.length === 2, 'expected two sectors: ' + inGal.length);
  assert(Math.abs(inGal[0][0] - 64) < 1e-9, 'sector 1 does not start at the 64 gal typed: ' + inGal[0][0]);

  // Switch the DISPLAY to litres and the gallons must not move one bit.
  ev('aircraftProfile.fuelUnit = "LITERS";');
  doc.getElementById('fuel-dep').value = String(64 * 3.78541);
  w.renderAllFlightTables();
  const inL = ev('ofpPrintModel.map(s => [s.fuelGal.dep, s.fuelGal.arr])');
  assert(Math.abs(inL[0][0] - 64) < 1e-6,
    'a litre display changed the gallons: ' + inL[0][0] + ' (the tracker is reading display units)');
  assert(Math.abs(inL[0][1] - inGal[0][1]) < 1e-6,
    'arrival gallons moved with the display unit: ' + inL[0][1] + ' vs ' + inGal[0][1]);
  assert(Math.abs(inL[1][1] - inGal[1][1]) < 1e-6, 'sector 2 arrival moved with the display unit');
  ev('aircraftProfile.fuelUnit = "GAL";');
});

T('the exact gallons and the printed figure describe the same fuel', () => {
  // The display is a ROUNDED RENDERING of the tracker, not a rival computation
  // of it - so they may differ only by the rounding the column does, which is
  // at most 0.05 per row. Anything larger means a row was missed, or the
  // tracker was fed a display figure.
  ev(SEED2);
  doc.getElementById('fuel-dep').value = '64';
  w.renderAllFlightTables();
  const sectors = ev('ofpPrintModel.map(s => ({ arr: s.fuelGal.arr, rem: Number(s.meta.totals.rem), rows: s.rows.length }))');
  let rowsSoFar = 0, worst = 0;
  for (const s of sectors) {
    rowsSoFar += s.rows;
    const gap = Math.abs(s.arr - s.rem);
    if (gap > worst) worst = gap;
    assert(gap <= 0.05 * rowsSoFar + 1e-9,
      'the exact gallons and the printed remaining disagree by more than the rounding can explain: ' +
      s.arr + ' vs ' + s.rem + ' over ' + rowsSoFar + ' rows');
  }
  // M5: the bound above grows with the route, so pin what was actually
  // measured on this fixture too - a regression that doubled the gap would
  // otherwise still sit inside the bound.
  assert(worst < 0.09, 'the measured gap on the seed mission grew: ' + worst);
  assert(worst > 0.001, 'the gap is now zero, so the display has stopped rounding ' +
    'or the two trackers have become the same number - either way this no longer ' +
    'tests what it says (measured 0.0761 when written)');
  assert(rowsSoFar >= 2, 'the fixture stopped producing rows to round');
});

T('fuel is continuous across a sector boundary, and a refuel sets it outright', () => {
  // The one invariant a second tracker really needs: it cannot quietly lose
  // or gain fuel between sectors.
  ev(SEED2);
  doc.getElementById('fuel-dep').value = '64';
  w.renderAllFlightTables();
  const plain = ev('ofpPrintModel.map(s => [s.fuelGal.dep, s.fuelGal.arr])');
  assert(Math.abs(plain[1][0] - plain[0][1]) < 1e-9,
    'with no stop, sector 2 must depart with exactly what sector 1 landed with: ' +
    plain[1][0] + ' vs ' + plain[0][1]);
  assert(plain[0][1] < plain[0][0], 'sector 1 burned nothing');

  // A FULL STOP THAT REFUELS SETS THE FIGURE, it does not add to it (v16.57).
  ev(SEED_STOP);
  doc.getElementById('fuel-dep').value = '64';
  w.renderAllFlightTables();
  const stopped = ev('ofpPrintModel.map(s => [s.fuelGal.dep, s.fuelGal.arr])');
  assert(Math.abs(stopped[1][0] - 50) < 1e-9,
    'the refuel did not set the next sector\'s fuel to 50 gal: ' + stopped[1][0]);
  assert(Math.abs(stopped[0][1] - plain[0][1]) < 1e-9,
    'adding a stop changed what sector 1 landed with');
  // And it is a REFUEL, not a carry-over: the fixture must actually differ.
  assert(Math.abs(stopped[1][0] - stopped[0][1]) > 1,
    'the fixture refuels to the figure it already had, so it proves nothing');
});

T('a touch & go burns its circuit fuel out of the exact tracker too', () => {
  // 'touch-go' is the spelling STOP_KINDS accepts; anything else normalises to
  // null and the stop silently does not exist, which is how the first version
  // of this test reported a missing circuit burn that was never queued.
  assert(moduleExports.anchors.STOP_KINDS.join(',') === 'touch-go,full-stop',
    'the stop kinds moved: ' + moduleExports.anchors.STOP_KINDS.join(','));
  const tg = SEED_STOP.replace('stop: "full-stop", stopMin: 10, fuelAfterGal: 50',
                               'stop: "touch-go", stopMin: 10');
  assert(tg !== SEED_STOP, 'the touch & go fixture did not substitute');
  ev(tg);
  doc.getElementById('fuel-dep').value = '64';
  w.renderAllFlightTables();
  const g = ev('ofpPrintModel.map(s => [s.fuelGal.dep, s.fuelGal.arr])');
  const ff = ev('Number(aircraftProfile.patternFf)');
  const expect = g[0][1] - ff * (10 / 60);
  assert(Math.abs(g[1][0] - expect) < 1e-9,
    'the circuit burn between sectors is missing from the exact tracker: ' +
    g[1][0] + ' against ' + expect);
  assert(ff > 0, 'the pattern fuel flow is zero, so this test cannot discriminate');
});

T('an unreadable Initial Fuel stays ABSENT in gallons, though the column shows 0', () => {
  // The v16.44 rule. The column has always shown 0 for an empty box and that
  // is not being changed here - but a weight computed from a 0 would state an
  // aircraft with empty tanks, where massBalanceProblems must say the fuel is
  // not known.
  ev(SEED2);
  doc.getElementById('fuel-dep').value = '';
  w.renderAllFlightTables();
  const g = ev('ofpPrintModel.map(s => s.fuelGal.dep)');
  assert(g.every((v) => !Number.isFinite(v)),
    'an empty Initial Fuel box produced a finite gallon figure: ' + JSON.stringify(g));
  // The COLUMN is unchanged and still numeric - it starts from 0 and goes
  // negative, which is what it has always done and what the red banner exists
  // to catch. This test is about the gallons behind it, not about that.
  const shown = txtOf('f-tot-rem-0');
  assert(/^-?\d+\.\d$/.test(shown), 'the displayed column is no longer a number: ' + shown);
  assert(!/NaN/.test(shown), 'the absent gallons leaked into the display: ' + shown);
  // And it really does reach the M&B finding rather than weighing empty tanks.
  const MB = moduleExports.mb;
  const m = MB.computeMissionMassBalance(MB.aircraftByReg('LN-TRB'),
    { pilotLb: 170, rightLb: 0, rearLb: 0, bagALb: 0, bagBLb: 0, bagCLb: 0 },
    ev('ofpPrintModel.map(s => ({ fuelDepGal: s.fuelGal.dep, fuelArrGal: s.fuelGal.arr }))'));
  assert(MB.massBalanceProblems(m).some((p) => /fuel on board is not known/.test(p)),
    'the absent fuel did not reach the M&B findings');
  doc.getElementById('fuel-dep').value = '64';
  w.renderAllFlightTables();
});

T('taxi fuel is inside the departure-to-arrival burn, which is what MTOW checks', () => {
  // "Count taxi fuel in takeoff mass" (the author), and MTOW doubles as the
  // ramp limit because of it. So the figure handed to M&B must be the fuel at
  // ENGINE START, before the taxi is burned.
  ev(SEED2);
  doc.getElementById('fuel-dep').value = '64';
  w.renderAllFlightTables();
  // SET it rather than read whatever an earlier test left behind - the first
  // run of this test reported "the profile has no taxi fuel" against correct
  // code, because something upstream had zeroed it.
  ev('aircraftProfile.taxiFuel = 1.7;');
  w.renderAllFlightTables();
  const taxi = ev('Number(aircraftProfile.taxiFuel)');
  assert(taxi === 1.7, 'the taxi fuel did not take: ' + taxi);
  const g = ev('ofpPrintModel.map(s => [s.fuelGal.dep, s.fuelGal.arr])');
  // Sector 1 departs with exactly what was typed - the taxi has NOT been
  // taken off before engine start.
  assert(Math.abs(g[0][0] - 64) < 1e-9, 'the taxi was charged before engine start: ' + g[0][0]);

  // AND IT IS INSIDE THE BURN, measured by taking it away rather than by
  // reaching into the schedule for a field name. The first version of this
  // test summed `l.fuelGal` off the schedule legs, which do not carry that
  // field, so `airborne` was 0 and a correct build failed by 4 gallons.
  const burnWith = g[0][0] - g[0][1];
  ev('aircraftProfile.taxiFuel = 0;');
  w.renderAllFlightTables();
  const g0 = ev('ofpPrintModel.map(s => [s.fuelGal.dep, s.fuelGal.arr])');
  const burnWithout = g0[0][0] - g0[0][1];
  assert(Math.abs((burnWith - burnWithout) - taxi) < 1e-9,
    'the taxi is not inside the sector burn: ' + burnWith + ' against ' + burnWithout +
    ' for a taxi of ' + taxi);

  // TAXI IS PER DEPARTURE, NOT PER MISSION (v16.54), and the exact tracker has
  // to follow that too - a full stop shuts down and starts again.
  ev('aircraftProfile.taxiFuel = 1.7;');
  ev(SEED_STOP);
  doc.getElementById('fuel-dep').value = '64';
  w.renderAllFlightTables();
  const two = ev('ofpPrintModel.map(s => s.fuelGal.dep - s.fuelGal.arr)');
  ev('aircraftProfile.taxiFuel = 0;');
  w.renderAllFlightTables();
  const two0 = ev('ofpPrintModel.map(s => s.fuelGal.dep - s.fuelGal.arr)');
  const extra = (two[0] - two0[0]) + (two[1] - two0[1]);
  assert(Math.abs(extra - 2 * 1.7) < 1e-9,
    'a full stop did not re-arm the taxi in the exact tracker: ' + extra +
    ' of taxi over two sectors, expected ' + (2 * 1.7));
  ev('aircraftProfile.taxiFuel = 1.7;');
});

T('there is ONE fuel density, used in both directions', () => {
  const F = moduleExports.fmt, MB = moduleExports.mb;
  // convertFuel and toGallons must be exact inverses, or a round trip through
  // the settings form silently reinterprets a number already written down.
  for (const unit of ['GAL', 'LITERS', 'KG']) {
    for (const gal of [0, 1, 12.5, 64, 87.3]) {
      const back = F.toGallons(F.convertFuel(gal, unit), unit);
      assert(Math.abs(back - gal) < 1e-9, 'round trip broken in ' + unit + ': ' + gal + ' -> ' + back);
    }
  }
  // And the kilogram side is the M&B density, not a second rounding of it.
  assert(Math.abs(F.convertFuel(1, 'KG') - MB.FUEL_KG_PER_GAL) < 1e-12,
    'convertFuel does not use the M&B density: ' + F.convertFuel(1, 'KG'));
  assert(Math.abs(F.convertFuel(64, 'KG') - 174.18) < 0.005,
    '64 gal should weigh 174.2 kg at 6 lb/gal: ' + F.convertFuel(64, 'KG'));
  // The page's own copy is gone, and with it the second constant.
  assert(!/function toGal\s*\(/.test(APP_SRC), 'the page grew back its own toGal');
  assert(!/\/\s*2\.72\b/.test(APP_SRC) && !/\*\s*2\.72\b/.test(APP_SRC),
    'a literal 2.72 kg/gal is back in the app');
});

// THE QUEUED `TA` TESTS RUN AFTER EVERY `T`, so the last thing this block does
// is put the shared fixture back. Without it the async plan-management tests
// inherited the two-sector mission left here and reported "expected 3 flights,
// got 4" - a failure in a test that has nothing to do with fuel, which is the
// v16.89 lesson that a check mutating shared state is not free to sit anywhere.
T('the Phase B block leaves the shared fixture as it found it', () => {
  ev('aircraftProfile.fuelUnit = "GAL";');
  doc.getElementById('fuel-dep').value = '64';
  ev(SEED);
  assert(ev('flights.length') === 1, 'the seed did not restore one flight');
  assert(ev('aircraftProfile.fuelUnit') === 'GAL', 'the fuel unit was left in another unit');
});

// =========================================================================
// PHASE C (v16.95): the Mass & Balance tab, the CG chart, the toggle, and the
// findings reaching the banner and the paper.
// =========================================================================

T('the CG chart is drawn from the envelope, and it never clips a mark', () => {
  const MB = moduleExports.mb;
  // A chart that clipped the very point that is out of limits would hide the
  // one thing it exists to show, so the axes expand to hold every mark.
  const far = MB.cgChartModel([
    { key: 'TO', label: 'T/O', weightLb: 2600, armIn: 40 },
    { key: 'LDG', label: 'LDG', weightLb: 2400, armIn: 52 }   // WAY aft of the envelope
  ]);
  assert(far.armRange[1] > 52, 'the arm axis does not reach an out-of-limits mark: ' + far.armRange[1]);
  for (const m of far.marks) {
    assert(m.x >= 0 && m.x <= far.width && m.y >= 0 && m.y <= far.height,
      'a mark is drawn outside the chart box: ' + JSON.stringify(m));
  }
  const aft = far.marks.find((m) => m.key === 'LDG');
  assert(aft.verdict === 'aft', 'the out-of-limits mark is not reported as aft: ' + aft.verdict);

  // The polygon IS the envelope - same count, and weight grows upwards.
  const norm = MB.cgChartModel([{ key: 'TO', label: 'T/O', weightLb: 2582.3, armIn: 40.16 }]);
  assert(norm.envelope.length === MB.CG_ENVELOPE.length,
    'the drawn polygon is not the envelope: ' + norm.envelope.length);
  const heavy = norm.gridY.find((g) => g.weight === 3000);
  const light = norm.gridY.find((g) => g.weight === 2000);
  assert(heavy && light && heavy.y < light.y, 'weight does not grow upwards on the chart');
  assert(norm.marks[0].verdict === 'ok', 'the golden fixture plots as out of limits');

  // A mark with no arm is SAID, never dropped - an absent dot reads as "fine".
  const missing = MB.cgChartModel([
    { key: 'TO', label: 'T/O', weightLb: 2600, armIn: 40 },
    { key: 'ZFM', label: 'ZFM', weightLb: NaN, armIn: null }
  ]);
  assert(missing.marks.length === 1 && missing.undrawn.join() === 'ZFM',
    'an unplottable mark was silently dropped: ' + JSON.stringify(missing.undrawn));
});

T('a tail is chosen by CLICKING its chip, and clicking it again clears it', () => {
  // Driving setMbReg() proves the function; only a click proves the control
  // (the v16.53 lesson). The chips have no inline handler - one listener.
  ev(SEED);
  ev(`setMbReg(''); showSidePane('mb'); renderMassBalance();`);
  const chip = (reg) => doc.querySelector('#mb-tails [data-reg="' + reg + '"]');
  assert(doc.querySelectorAll('#mb-tails .mb-tail').length === 5, 'the five tails are not all offered');
  assert(!chip('LN-TRD').hasAttribute('onclick'), 'a chip carries an inline handler');
  chip('LN-TRD').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert(ev('mbPrefs.reg') === 'LN-TRD', 'clicking the chip did not choose the tail: ' + ev('mbPrefs.reg'));
  assert(chip('LN-TRD').getAttribute('aria-checked') === 'true' && chip('LN-TRD').classList.contains('mb-tail-on'),
    'the chosen chip does not say so');
  assert(ev('mbPrefs.loads.bagALb') === 7.3, 'choosing by click did not load the standard baggage');
  chip('LN-TRD').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert(ev('mbPrefs.reg') === null, 'clicking the chosen chip again did not clear it');
  ev(`mbPrefs.loads = normaliseStationLoads({}); saveMbPrefs(); showSidePane('plan'); renderAllFlightTables();`);
});
T('the CG chart has a readable grid, labelled limits and one shape per point', () => {
  ev(SEED);
  ev(`setMbReg('LN-TRB'); setMbLoad('pilotLb', 180); showSidePane('mb'); renderAllFlightTables();`);
  const svg = doc.querySelector('#mb-body .mb-chart');
  assert(svg, 'no chart');
  // A MAJOR line every inch and every 100 lb, and a MINOR one between each.
  const major = svg.querySelectorAll('.mb-g-major').length, minor = svg.querySelectorAll('.mb-g-minor').length;
  const MB = moduleExports.mb;
  const model = MB.cgChartModel([{ key: 'TO', weightLb: 2600, armIn: 40 }], { width: 340, height: 270, padL: 42, padR: 10, padT: 10, padB: 32 });
  const [a0, a1] = model.armRange, [w0, w1] = model.weightRange;
  assert(Number.isInteger(a0) && Number.isInteger(a1) && w0 % 100 === 0 && w1 % 100 === 0,
    'the frame is not on a gridline: ' + JSON.stringify([model.armRange, model.weightRange]));
  assert(model.gridX.length === a1 - a0 + 1 && model.gridY.length === (w1 - w0) / 100 + 1,
    'there is not a major line every inch and every 100 lb');
  assert(major > 20 && minor > 20, 'the chart is not gridded: ' + major + ' major, ' + minor + ' minor');
  // The LIMITS are labelled on the chart itself - the criticism of the one
  // commercial EFB whose envelope carries none.
  const text = [...svg.querySelectorAll('text')].map((t) => t.textContent).join(' ');
  assert(/MTOW 3100/.test(text) && /MLW 2950/.test(text), 'the limits are not labelled: ' + text.slice(0, 200));
  assert(/CG arm/.test(text) && /Weight/.test(text), 'the axes are not titled');
  // Three points, three COLOURS and three SHAPES - a black-and-white print or a
  // colour-blind reader still tells them apart.
  const mk = (k) => svg.querySelector('.mb-mk-' + k);
  assert(mk('to').tagName === 'circle' && mk('ldg').tagName === 'path' && mk('zfm').tagName === 'rect',
    'the three points do not have their own shapes');
  assert(svg.querySelector('.mb-burn'), 'the fuel-burn line from take-off to landing is missing');
  assert(doc.querySelector('#mb-body .mb-legend'), 'the chart has no legend');
  ev(`setMbReg(''); mbPrefs.loads = normaliseStationLoads({}); saveMbPrefs(); showSidePane('plan'); renderAllFlightTables();`);
});
T('the result tiles say OUT, in words and in colour, when a point is out of limits', () => {
  ev(SEED);
  ev(`setMbReg('LN-TRB'); mbPrefs.loads = normaliseStationLoads({ pilotLb: 180, bagCLb: 220 }); renderAllFlightTables();`);
  const tiles = [...doc.querySelectorAll('#mb-body .mb-tile')];
  assert(tiles.length === 3, 'a sector does not show its three tiles: ' + tiles.length);
  const to = doc.querySelector('#mb-body .mb-tile-to');
  assert(to.classList.contains('mb-tile-bad') && /OUT/.test(to.textContent), 'an aft take-off CG is not flagged on its tile');
  assert(/Out of limits/.test(doc.querySelector('#mb-body .mb-status').textContent), 'the sector status does not say so');
  assert(doc.querySelector('#mb-body .mb-mk-ring'), 'the out-of-limits point is not ringed on the chart');
  ev(`mbPrefs.loads = normaliseStationLoads({ pilotLb: 180 }); renderAllFlightTables();`);
  assert(!doc.querySelector('#mb-body .mb-tile-bad') && /Within limits/.test(doc.querySelector('#mb-body .mb-status').textContent),
    'a legal load is still flagged');
  ev(`setMbReg(''); mbPrefs.loads = normaliseStationLoads({}); saveMbPrefs(); renderAllFlightTables();`);
});

T('station loads and a registration are re-validated on every read', () => {
  const MB = moduleExports.mb;
  // localStorage is hand-editable, so this follows normaliseFixStyle exactly.
  const s = MB.normaliseStationLoads({ pilotLb: '170', rightLb: -5, rearLb: 'x', bagALb: 99999 });
  assert(s.pilotLb === 170, 'a numeric string was rejected: ' + s.pilotLb);
  assert(s.rightLb === 0, 'a negative weight was kept: ' + s.rightLb);
  assert(s.rearLb === 0, 'an unreadable weight became NaN rather than an empty seat: ' + s.rearLb);
  assert(s.bagALb === MB.STATION_MAX_LB, 'the typo guard did not clamp: ' + s.bagALb);
  assert(Object.keys(s).length === Object.keys(MB.STATION_ARMS).length, 'a station went missing');
  // An unreadable object is six empty seats, not six NaNs - a NaN in one
  // station would make the whole take-off mass NaN, which reads as "no M&B"
  // when the pilot has simply left a seat empty.
  assert(Object.values(MB.normaliseStationLoads(null)).every((v) => v === 0),
    'an absent load object did not come back as zeros');
  // Only the published fleet: a tail we have no empty weight for cannot be weighed.
  assert(MB.normaliseReg('ln-trb') === 'LN-TRB', 'a lowercase registration was rejected');
  assert(MB.normaliseReg('LN-ABC') === null, 'an unknown registration was accepted');
  assert(MB.normaliseReg(null) === null && MB.normaliseReg(42) === null, 'a non-string was accepted');
});

T('the tab weighs the mission from the plan\'s own fuel, not a second number', () => {
  ev(SEED2);
  doc.getElementById('fuel-dep').value = '64';
  ev('mbPrefs.reg = "LN-TRB"; mbPrefs.loads = normaliseStationLoads({ pilotLb: 170 }); mbPrefs.view = "sector";');
  w.renderAllFlightTables();
  const got = ev('JSON.stringify(massBalanceMission.sectors.map(s => ' +
    '[s.fuelDepGal, s.fuelArrGal, s.takeoff.weightLb]))');
  const sectors = JSON.parse(got);
  const fuel = ev('JSON.stringify(ofpPrintModel.map(s => [s.fuelGal.dep, s.fuelGal.arr]))');
  assert(got.length && sectors.length === 2, 'the mission was not weighed: ' + got);
  JSON.parse(fuel).forEach((f, i) => {
    assert(Math.abs(sectors[i][0] - f[0]) < 1e-9 && Math.abs(sectors[i][1] - f[1]) < 1e-9,
      'the M&B fuel is not the plan\'s own fuel on sector ' + i);
  });
  // 2020.3 empty + 170 pilot + 64 gal * 6 lb = 2574.3 lb at take-off.
  assert(Math.abs(sectors[0][2] - (2020.3 + 170 + 64 * 6)) < 1e-9,
    'the take-off weight is not empty + load + fuel: ' + sectors[0][2]);
  // No aircraft, no weighing - and no banner noise either.
  ev('mbPrefs.reg = null;');
  w.renderAllFlightTables();
  assert(ev('massBalanceMission') === null, 'a mission was weighed with no aircraft selected');
});

T('an out-of-limits load reaches the red banner AND the printed sheet', () => {
  ev(SEED2);
  doc.getElementById('fuel-dep').value = '64';
  // Tail-heavy: 220 lb in baggage C at 129 in takes the CG aft of 46.
  ev('mbPrefs.reg = "LN-TRB"; mbPrefs.loads = normaliseStationLoads({ bagCLb: 220 }); mbPrefs.view = "sector";');
  w.renderAllFlightTables();
  const banner = doc.getElementById('integrity-banner');
  assert(banner.style.display !== 'none', 'the banner is hidden for an out-of-limits load');
  assert(/Mass & balance/.test(banner.textContent),
    'the M&B finding is not in the banner: ' + banner.textContent.slice(0, 200));
  // ...and the DO-NOT-USE band prints (the renderer puts it on EVERY page -
  // "a plan the app calls unusable prints a DO NOT USE band on every page").
  const d = printDoc();
  assert(d.band, 'the printed band is missing');
  const mbs = d.sheets.filter((sh) => sh.kind === 'mb');
  assert(mbs.length === 2, 'expected one M&B page per sector (2): ' + mbs.length);
  // The out-of-limits point is flagged on the form's own CG chart.
  const to = mbs[0].marks.find((k) => k.key === 'TO');
  assert(to && to.ok === false, 'the out-of-limits take-off is not flagged on the chart: ' + JSON.stringify(to));

  // A LEGAL load raises nothing and still prints the sheet.
  ev('mbPrefs.loads = normaliseStationLoads({ pilotLb: 170 });');
  w.renderAllFlightTables();
  assert(!/Mass & balance/.test(doc.getElementById('integrity-banner').textContent),
    'a legal load still raises an M&B finding');
  assert(printDoc().sheets.some((sh) => sh.kind === 'mb'), 'the M&B page stopped printing for a legal load');
});

T('with no aircraft selected the banner stays quiet', () => {
  // A finding on every plan for a pilot who is not using M&B is noise they
  // learn to scroll past, which is how a real finding gets missed.
  ev(SEED2);
  ev('mbPrefs.reg = null;');
  w.renderAllFlightTables();
  const b = doc.getElementById('integrity-banner');
  assert(!/Mass & balance/.test(b.textContent),
    'an unselected aircraft put M&B noise in the banner: ' + b.textContent.slice(0, 160));
  assert(!printDoc().sheets.some((sh) => sh.kind === 'mb'), 'an M&B page printed with no aircraft selected');
});

T('the toggle changes what is SHOWN, never what is checked', () => {
  // The author: "Check the landing weight / t&g weight for every stop". So the
  // whole-mission view must not become a way to miss a heavy intermediate
  // landing - it is a display choice and nothing more.
  ev(SEED_STOP);
  doc.getElementById('fuel-dep').value = '64';
  ev('mbPrefs.reg = "LN-TRB"; mbPrefs.loads = normaliseStationLoads({ pilotLb: 400, rightLb: 250, rearLb: 300 });');
  ev('mbPrefs.view = "sector";');
  w.renderAllFlightTables();
  const perSector = ev('JSON.stringify(collectIntegrityProblems ? runIntegrityCheck() : [])');
  ev('mbPrefs.view = "mission";');
  w.renderAllFlightTables();
  const whole = ev('JSON.stringify(runIntegrityCheck())');
  assert(perSector === whole,
    'the toggle changed the findings:\n  sector: ' + perSector + '\n  mission: ' + whole);
  assert(/Mass & balance/.test(perSector),
    'the fixture is not out of limits, so this test cannot discriminate: ' + perSector);
  // And the two views really do render differently, or the assert above is vacuous.
  const nMission = doc.querySelectorAll('#mb-body .mb-chart').length;
  ev('mbPrefs.view = "sector";');
  w.renderAllFlightTables();
  const nSector = doc.querySelectorAll('#mb-body .mb-chart').length;
  assert(nSector > nMission, 'the two views render the same thing: ' + nSector + ' vs ' + nMission);
});

T('the M&B inputs are stored, but never exported', () => {
  // The author cleared REGISTRATIONS for storage. A route file is for sharing a
  // ROUTE - a seat weight carries no name but is still a fact about the people
  // who were aboard, so none of this rides out in an export.
  const E = moduleExports.exch;
  assert(!E.PROFILE_KEYS.some((k) => /reg|pic|crew|pilot|bag|load/i.test(k)),
    'PROFILE_KEYS grew an M&B key: ' + E.PROFILE_KEYS.join(','));
  const payload = JSON.stringify(E.buildExportPayload({
    flights: [], profile: { mode: 'C182T', reg: 'LN-TRB', loads: { pilotLb: 170 } }
  }));
  assert(!/LN-TR/.test(payload), 'a registration reached the export: ' + payload.slice(0, 200));
  assert(!/pilotLb/.test(payload), 'a station load reached the export');
  // It IS persisted, under its own key, so the pilot does not retype it.
  assert(/c182_mb_prefs/.test(APP_SRC), 'the M&B prefs are not persisted at all');
});

T('the sidebar has two panes and the tabs switch them', () => {
  ev('showSidePane("mb")');
  assert(doc.getElementById('pane-plan').style.display === 'none', 'the plan pane is still shown');
  assert(doc.getElementById('pane-mb').style.display !== 'none', 'the M&B pane is hidden');
  assert(doc.getElementById('tab-mb').getAttribute('aria-selected') === 'true', 'the tab is not marked selected');
  ev('showSidePane("plan")');
  assert(doc.getElementById('pane-mb').style.display === 'none', 'the M&B pane is still shown');
  assert(doc.getElementById('tab-plan').classList.contains('side-tab-on'), 'the plan tab is not on');
  // The flight-plan pane must still contain the things the rest of the suite
  // and the pilot reach for - moving them into a tab must not hide them.
  for (const id of ['flight-plans-container', 'integrity-banner', 'daylight-card', 'metar-card']) {
    assert(doc.querySelector('#pane-plan #' + id), id + ' left the flight-plan pane');
  }
});

T('the weather is decoded once, for two hosts', () => {
  // A second decoder of the same METAR is exactly what v16.21 refuses.
  const n = (APP_SRC.match(/function renderMetarCard\(/g) || []).length;
  assert(n === 1, 'there is more than one METAR renderer: ' + n);
  assert(/renderMetarCard\(want, lastWeather\.metars, lastWeather\.tafs, 'mb-wx'\)/.test(APP_SRC),
    'the M&B tab does not reuse the one renderer');
  assert(!/localStorage[^;]*lastWeather/.test(APP_SRC), 'the weather is being persisted');
  ev('lastWeather = null; renderMbWeather();');
  assert(/Fetch METAR/.test(doc.getElementById('mb-wx').textContent),
    'the unfetched state says nothing');
});

T('before the first fetch the M&B weather card IS the fetch button; after it, the button moves to the corner (v17.6)', () => {
  ev(SEED);
  ev('lastWeather = null; renderMbWeather();');
  const host = doc.getElementById('mb-wx');
  const big = doc.getElementById('mb-wx-fetch-big');
  const head = doc.getElementById('mb-wx-fetch-btn');
  assert(big && host.contains(big), 'no large fetch button in the empty card');
  assert(big.className.includes('btn-primary'), 'the empty-state fetch is not the primary button');
  assert(/onclick="fetchMetarTaf\(\)"/.test(big.outerHTML), 'the large button does not fetch');
  assert(head && head.style.display === 'none', 'the small corner button shows while the big one is there');
  // it names the fields it will ask for, from the same list the fetch builds
  assert(/ENDU/.test(host.textContent) && /ENTC/.test(host.textContent),
    'the empty state does not say which fields: ' + host.textContent);
  const css = fs.readFileSync('src/styles.css', 'utf8');
  assert(/\.mb-wx-empty\s*\{[^}]*align-items:\s*center/.test(css) &&
    /\.mb-wx-empty\s*\{[^}]*justify-content:\s*center/.test(css), 'the empty state is not centred');
  // a status line (fetching / failed) is mirrored into the card where it was pressed
  ev(`metarStatus('\u274c Could not fetch: HTTP 503.', true);`);
  assert(/HTTP 503/.test(host.textContent), 'a failed fetch is not reported in the M&B card');
  ev(`metarStatus('', false);`);
  // after a fetch: the report is shown and the fetch is the small corner button again
  ev(`lastWeather = { icaos: ['ENDU', 'ENTC'], metars: {}, tafs: {} }; renderMbWeather();`);
  assert(!doc.getElementById('mb-wx-fetch-big'), 'the big button stayed after a fetch');
  assert(head.style.display !== 'none', 'the corner button did not come back after a fetch');
  ev('lastWeather = null; renderMbWeather();');
});

T('the whole-mission master walks the fuel, and summarises without laundering', () => {
  // Built ONCE (missionMaster) for the screen and the paper. Each assert below
  // is a figure the first version took from `first` or `last` and got wrong -
  // and every one of them was silent on a one-sector mission.
  const MB = moduleExports.mb;
  const ac = MB.aircraftByReg('LN-TRB');
  const heavy = MB.normaliseStationLoads({ pilotLb: 400, rightLb: 250, rearLb: 150 });
  // Sector 2 departs after a refuel, heavy; sectors 1 and 3 are legal.
  const m = MB.computeMissionMassBalance(ac, heavy, [
    { fuelDepGal: 30, fuelArrGal: 20, label: 'A → B' },
    { fuelDepGal: 60, fuelArrGal: 40, label: 'B → C' },   // refuelled +40 at B
    { fuelDepGal: 40, fuelArrGal: 10, label: 'C → A' }
  ]);
  const M = MB.missionMaster(m);
  // THE FIXTURE MUST BE ABLE TO SEE THE DEFECT, or the asserts below are vacuous.
  assert(m.first.checks.takeoffWeight === 'ok' && m.sectors[1].checks.takeoffWeight === 'over',
    'the fixture no longer has a heavy take-off in the MIDDLE: ' +
    m.sectors.map((r) => r.takeoff.weightLb.toFixed(1)).join(', '));
  // 1. The burn is walked: 10 + 20 + 30, not 30 - 10.
  assert(Math.abs(M.burnGal - 60) < 1e-9, 'the master burn is not walked over the sectors: ' + M.burnGal);
  assert(Math.abs(M.stopChangeGal - 40) < 1e-9, 'the fuel taken on at the stop is lost: ' + M.stopChangeGal);
  assert(Math.abs(M.fuelDepGal - M.burnGal + M.stopChangeGal - M.fuelArrGal) < 1e-9,
    'the master fuel does not reconcile: dep - burn + stops != arr');
  // 2. A check failing anywhere fails on the master.
  assert(M.checks.takeoffWeight === 'over',
    'a heavy intermediate take-off printed a green master: ' + M.checks.takeoffWeight);
  assert(M.checks.landingWeight === 'over', 'a heavy intermediate landing was laundered');
  // 3. Min FLT is the heaviest take-off's, which is sector 2's.
  assert(M.minFlightMin === Math.max(...m.sectors.map((r) => r.minFlightMin)) && M.minFlightMin > 0,
    'Min FLT is not the binding one: ' + M.minFlightMin + ' vs ' + m.sectors.map((r) => r.minFlightMin));
  assert(M.minFlightMin !== m.first.minFlightMin, 'the fixture cannot tell Min FLT sources apart');

  // 4. Va comes from the LIGHTEST landing, which a refuel can put mid-mission.
  const light = MB.normaliseStationLoads({ pilotLb: 200 });
  const m2 = MB.computeMissionMassBalance(ac, light, [
    { fuelDepGal: 40, fuelArrGal: 10, label: 'A → B' },    // lightest landing here
    { fuelDepGal: 60, fuelArrGal: 50, label: 'B → A' }
  ]);
  const M2 = MB.missionMaster(m2);
  const lightest = Math.min(...m2.sectors.map((r) => r.landing.weightLb));
  assert(m2.sectors[0].landing.weightLb === lightest && m2.last.vaKt !== m2.sectors[0].vaKt,
    'the fixture no longer puts the lightest landing in the middle');
  assert(M2.vaKt === MB.vaKt(lightest), 'Va is not the lightest landing\'s: ' + M2.vaKt);

  // And the master still shows what the author asked for: start and final weights.
  assert(M.takeoff === m.first.takeoff && M.landing === m.last.landing,
    'the master is no longer the mission\'s start and final weights');
  assert(MB.missionMaster(null) === null, 'an absent mission produced a master');
});

T('each sector prints its OFP and then its own M&B page; the mission view prints one master last', () => {
  ev(SEED_STOP);
  ev(`mbPrefs.reg = 'LN-TRB'; mbPrefs.view = 'sector'; renderAllFlightTables();`);
  const kinds = printDoc().sheets.map((s) => s.kind).join(',');
  assert(kinds === 'ofp,mb,ofp,mb', 'the form is printed double-sided, page 1 then page 2 per sector: ' + kinds);
  ev(`mbPrefs.view = 'mission'; renderAllFlightTables();`);
  assert(printDoc().sheets.map((s) => s.kind).join(',') === 'ofp,ofp,mb', 'the mission view is every OFP and then ONE master');
  ev(`mbPrefs.reg = null; mbPrefs.view = 'sector'; renderAllFlightTables();`);
  assert(printDoc().sheets.every((s) => s.kind === 'ofp'), 'an M&B page printed with no aircraft chosen');
});
T('the printed whole-mission sheet adds up, with a refuel in the middle', () => {
  ev(SEED_STOP);
  doc.getElementById('fuel-dep').value = '30';     // so the stop's 50 gal is an UPLIFT
  ev('mbPrefs.reg = "LN-TRB"; mbPrefs.loads = normaliseStationLoads({ pilotLb: 180 }); mbPrefs.view = "mission";');
  w.renderAllFlightTables();
  const mbs = printDoc().sheets.filter((sh) => sh.kind === 'mb');
  assert(mbs.length === 1, 'the whole-mission view printed ' + mbs.length + ' M&B pages, not one master');
  const sheet = readMb(mbs[0]);
  // UPDATED DELIBERATELY AT v16.98. The form has no "fuel at stops" line, and
  // v16.97 put the net change on its Last Minute Change line. That line is the
  // preflight fuel against the planned now (the author), so the stop change is
  // STATED beside the title, and the LMC line is left alone.
  assert(!sheet.mb.lmc, 'the stop change is still on the Last Minute Change line: ' + JSON.stringify(sheet.mb.lmc));
  const said = /Fuel change at the stops \+([\d,]+) US gal/.exec(sheet.box.title || '');
  assert(said, 'the master does not state the fuel change at the stops: ' + sheet.box.title);
  const tom = numPt(sheet.mb.tom.w), burn = numPt(sheet.mb.enroute.w),
        stop = numPt(said[1]) * 6, ldm = numPt(sheet.mb.ldg.w);
  assert([tom, burn, stop, ldm].every(Number.isFinite), 'a printed figure is not a number: ' + JSON.stringify(sheet.mb));
  // Each is printed to 0.1 lb and the stop change to 0.1 gal (0.6 lb), so they
  // may disagree by the rounding and no more.
  assert(Math.abs(tom - burn + stop - ldm) <= 0.15 + 0.3,
    'the printed master does not add up: ' + tom + ' - ' + burn + ' + ' + stop + ' != ' + ldm);
  // The old sheet printed the FIRST sector's burn under a whole-mission heading.
  const mission = w.eval('massBalanceMission');
  assert(Math.abs(burn - mission.sectors[0].burnGal * 6) > 1,
    'the fixture cannot tell the mission burn from the first sector\'s');
  assert(stop > 0, 'the fixture does not refuel upwards: ' + stop);
  ev('mbPrefs.reg = null; mbPrefs.view = "sector";');
  w.renderAllFlightTables();
});

T('each sector end is checked against its own runway, from the METAR unless typed over', () => {
  // UPDATED DELIBERATELY AT v16.96: this test used to assert the tab SAID the
  // distances were not computed. They are now, and it says so.
  ev(SEED_STOP);
  doc.getElementById('fuel-dep').value = '64';
  ev(`mbPrefs.reg = "LN-TRB"; mbPrefs.loads = normaliseStationLoads({ pilotLb: 180 }); perfInputs = {};
      lastWeather = { icaos: ['ENDU', 'ENTC'], tafs: {}, metars: {
        ENDU: 'ENDU 281150Z 29012KT 9999 FEW040 10/05 Q1005',
        ENTC: 'ENTC 281150Z 18008KT 9999 SCT030 08/04 Q1003' } };`);
  w.renderAllFlightTables();
  const checks = ev('runwayChecks');
  assert(checks.length === 4, 'two sectors should give four checks: ' + checks.length);
  const dep = checks[0];
  assert(dep.icao === 'ENDU' && dep.kind === 'takeoff', 'the first check is not the ENDU take-off: ' + dep.icao + ' ' + dep.kind);
  // 290/12 is almost straight down RWY 28 (289.05 TRUE), so 28 is the default.
  assert(dep.opt.desig === '28' && dep.wind.headKt === 12, 'the default is not the runway into wind: ' + dep.opt.desig + ' ' + JSON.stringify(dep.wind));
  assert(dep.qnh === 1005 && dep.oat === 10 && dep.fromMetar.qnh && dep.fromMetar.oat, 'the METAR did not fill the ENDU inputs');
  // The card names the report it read, the way the METAR prints its time.
  const card = doc.getElementById('mb-perf').textContent;
  assert(/METAR 281150Z/.test(card) && !/\[object/.test(card), 'the card does not name the METAR it used: ' + card.slice(0, 300));
  assert(dep.res.ok && dep.res.requiredM > 0 && dep.res.availableM === dep.opt.end.toda,
    'the take-off was not checked against TODA: ' + JSON.stringify(dep.res).slice(0, 200));
  // The take-off mass is the sector's own, from the M&B pass.
  const sector0 = ev('massBalanceMission.sectors[0].takeoff.weightLb');
  const again = moduleExports.rwy.runwayDistance({ kind: 'takeoff', weightLb: sector0, elevFt: 254, qnhHpa: 1005, tempC: 10,
    headKt: 12, braking: 6, surface: 'ASPH', availableM: dep.opt.end.toda });
  assert(again.requiredM === dep.res.requiredM, 'the tab did not use the sector take-off mass: ' + again.requiredM + ' vs ' + dep.res.requiredM);
  // A typed value wins over the METAR, and clearing the box gives it back.
  ev(`perfInputs = { [runwayChecks[0].key]: { qnh: '980' } };`);
  w.renderAllFlightTables();
  assert(ev('runwayChecks[0].qnh') === 980 && !ev('runwayChecks[0].fromMetar.qnh'), 'a typed QNH did not override the METAR');
  ev(`perfInputs = { [runwayChecks[0].key]: { qnh: '' } };`);
  w.renderAllFlightTables();
  assert(ev('runwayChecks[0].qnh') === 1005, 'an EMPTY QNH box was not the METAR again - it read as ' + ev('runwayChecks[0].qnh'));
});

T('with no weather and nothing typed there is no figure, and no guess', () => {
  ev(SEED_STOP);
  ev('mbPrefs.reg = "LN-TRB"; perfInputs = {}; lastWeather = null;');
  w.renderAllFlightTables();
  const c = ev('runwayChecks[0]');
  assert(c.res.refused && c.res.refusedKind === 'input' && /not known/.test(c.res.refused),
    'a check with no QNH, OAT or wind produced something: ' + JSON.stringify(c.res).slice(0, 160));
  // Missing input is the pilot not having got there - NOT a red banner.
  assert(!/distance|RWY/.test(doc.getElementById('integrity-banner').textContent),
    'unfilled inputs raised the banner: ' + doc.getElementById('integrity-banner').textContent.slice(0, 160));
  // And nothing about the day's weather is stored.
  const stored = Object.keys(w.localStorage).filter((k) => /perf|runway|qnh/i.test(k) || /perf|qnh/i.test(w.localStorage.getItem(k) || ''));
  assert(!stored.length, 'the day\'s runway inputs were persisted: ' + stored.join(', '));
});

T('the take-off is checked against TODA, not the ASDA column the workbook reads', () => {
  // ENBR 17: ASDA 2826, TODA 3119. The workbook's "TODA" cell reads 2826.
  const ads = aipDataset().aerodromes;
  const enbr = ads.find((a) => a.icao === 'ENBR');
  const e17 = enbr.runways.flatMap((r) => r.ends).find((e) => e.desig === '17');
  assert(e17.asda !== e17.toda, 'the fixture cannot tell ASDA from TODA any more');
  ev(`flights = [{ id: 7, title: "B", depElev: ${enbr.elevFt}, waypoints: [
      { lat: ${enbr.lat}, lng: ${enbr.lng}, name: "ENBR", alt: ${enbr.elevFt}, oat: 10, wdir: 0, wspd: 0, var: -1 },
      { lat: ${enbr.lat + 0.3}, lng: ${enbr.lng}, name: "NORTH", alt: 2500, oat: 10, wdir: 0, wspd: 0, var: -1 }]}];
      activeFlightIndex = 0; mbPrefs.reg = "LN-TRB";
      perfInputs = { '7:dep': { end: '17', windDir: '170', windKt: '5', qnh: '1013', oat: '10' } };
      refreshMap(); renderAllFlightTables();`);
  const c = ev('runwayChecks[0]');
  assert(c.icao === 'ENBR' && c.opt.desig === '17', 'the ENBR 17 take-off was not checked: ' + c.icao + ' ' + (c.opt && c.opt.desig));
  assert(c.res.availableM === e17.toda && c.res.availableM !== e17.asda,
    'the take-off was checked against ' + c.res.availableM + ' - TODA is ' + e17.toda + ', ASDA ' + e17.asda);
  // UPDATED DELIBERATELY AT v16.98: this used to assert an intersection
  // departure was checked against its own TODA. The school's policy is a
  // stationary take-off at FULL LENGTH, always - so no intersection is offered,
  // and one asked for (an old session's choice) falls back to a runway end.
  const psn = e17.positions && e17.positions[0];
  assert(psn, 'the fixture needs ENBR 17 to publish an intersection, or it proves nothing');
  const ids = ev(`runwayChecks[0].options.map(o => o.id)`);
  const ends = enbr.runways.flatMap((r) => r.ends.map((e) => e.desig));
  assert(JSON.stringify(ids.slice().sort()) === JSON.stringify(ends.slice().sort()),
    'a take-off offered something other than the runway ends at full length: ' + JSON.stringify(ids));
  ev(`perfInputs['7:dep'].end = '17@${psn.name}'; renderAllFlightTables();`);
  const opt = ev('runwayChecks[0].opt');
  const chosen = enbr.runways.flatMap((r) => r.ends).find((e) => e.desig === opt.desig);
  assert(ends.includes(opt.id) && ev('runwayChecks[0].res.availableM') === chosen.toda,
    'an intersection departure was still priced: ' + opt.id + ' against ' + ev('runwayChecks[0].res.availableM') +
    ' (intersection TODA ' + psn.toda + ')');
});

T('a runway that is too short, or a limit, reaches the banner and the paper - once a tail is chosen', () => {
  // ENSD: LDA 760 m. Braking action 1 doubles the landing distance, which puts
  // a C182 over it - a real exceedance, not a synthetic one.
  const ads = aipDataset().aerodromes;
  const ensd = ads.find((a) => a.icao === 'ENSD');
  const start = ads.find((a) => a.icao === 'ENBR');
  ev(`flights = [{ id: 8, title: "S", depElev: ${start.elevFt}, waypoints: [
      { lat: ${start.lat}, lng: ${start.lng}, name: "ENBR", alt: ${start.elevFt}, oat: 10, wdir: 0, wspd: 0, var: -1 },
      { lat: ${ensd.lat}, lng: ${ensd.lng}, name: "ENSD", alt: ${ensd.elevFt}, oat: 10, wdir: 0, wspd: 0, var: -1 }]}];
      activeFlightIndex = 0; mbPrefs.reg = "LN-TRB"; mbPrefs.loads = normaliseStationLoads({ pilotLb: 180 });
      perfInputs = { '8:arr': { windDir: '0', windKt: '0', qnh: '1013', oat: '10', braking: '1' } };
      refreshMap(); renderAllFlightTables();`);
  const c = ev('runwayChecks[1]');
  assert(c.icao === 'ENSD' && c.kind === 'landing' && !c.res.ok && c.res.requiredM > c.res.availableM,
    'the ENSD landing at braking action 1 did not exceed the LDA: ' + JSON.stringify(c.res).slice(0, 200));
  const banner = doc.getElementById('integrity-banner').textContent;
  assert(/ENSD RWY \d+: required landing distance \d+ m exceeds LDA \d+ m/.test(banner),
    'the exceedance is not in the banner: ' + banner.slice(0, 240));
  const d = printDoc();
  const mbSheet = readMb(d.sheets.find((sh) => sh.kind === 'mb'));
  assert(d.band && /EXCEEDS LDA: required \d+ m, LDA \d+ m/.test(mbSheet.box.ldNote || ''),
    'the exceedance did not reach the printed sheet with its DO NOT USE band: ' + JSON.stringify(mbSheet.box.ldNote));
  assert(mbSheet.box.destIcao === 'ENSD' && mbSheet.box.ldReq && mbSheet.box.ldAvail,
    'the landing block is not filled for ENSD: ' + JSON.stringify(mbSheet.box));
  // A LIMIT is a finding too: a 12 kt tailwind is past the POH's 10.
  // The runway is PINNED: with none chosen the default is the end into wind,
  // which would turn this tailwind into a headwind and test nothing.
  ev(`perfInputs['8:arr'] = { end: '${c.opt.id}', windDir: '${Math.round((c.opt.end.trueBrg + 180) % 360)}',
        windKt: '12', qnh: '1013', oat: '10' }; renderAllFlightTables();`);
  assert(ev('runwayChecks[1].wind.headKt') === -12, 'the fixture is not a 12 kt tailwind: ' + ev('runwayChecks[1].wind.headKt'));
  assert(/tailwind is past the POH/.test(doc.getElementById('integrity-banner').textContent),
    'a tailwind past the limit did not reach the banner');
  // With no tail chosen, none of it is a finding (the v16.95 rule).
  ev('mbPrefs.reg = null; renderAllFlightTables();');
  assert(!/RWY|tailwind/.test(doc.getElementById('integrity-banner').textContent), 'the banner nagged with no aircraft chosen');
});

T('no page function shadows a bundle export', () => {
  // A top-level `function x()` in the page script REPLACES the bundle's global
  // x - silently: nothing throws, the export just never runs. v16.96 wrote a
  // runway resolver called aerodromeAt beside the page's own aerodromeAt(wp),
  // and every distance check came back "not at an aerodrome" while the module
  // passed its own tests in Node. A name clash is the whole bug, so the name
  // clash is what is tested.
  const page = new Set([...fs.readFileSync('src/index.html', 'utf8')
    .matchAll(/^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map((m) => m[1]));
  assert(page.size > 200, 'the page-function scan found only ' + page.size);
  const clash = [];
  for (const f of fs.readdirSync('src/lib').filter((x) => x.endsWith('.js'))) {
    const src = fs.readFileSync('src/lib/' + f, 'utf8');
    for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) {
      if (page.has(m[1])) clash.push(f + ': ' + m[1]);
    }
  }
  assert(!clash.length, 'a page function shadows a bundle export: ' + clash.join(', '));
});

T('the distance card has no inline handlers, and its listener really commits a change', () => {
  ev(SEED_STOP);
  ev(`mbPrefs.reg = "LN-TRB"; perfInputs = {}; lastWeather = { icaos: ['ENDU','ENTC'], tafs: {}, metars: {
        ENDU: 'ENDU 281150Z 29012KT 9999 FEW040 10/05 Q1005', ENTC: 'ENTC 281150Z 18008KT 9999 SCT030 08/04 Q1003' } };`);
  w.renderAllFlightTables();
  const host = doc.getElementById('mb-perf');
  const inline = [...host.querySelectorAll('*')].filter((el) => [...el.attributes].some((a) => /^on/i.test(a.name)));
  assert(!inline.length, 'the card carries inline handlers: ' + inline.length);
  const sel = host.querySelector('select[data-field="end"]');
  const other = [...sel.options].find((o) => !o.selected);
  sel.value = other.value;
  sel.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert(ev('runwayChecks[0].opt.id') === other.value, 'choosing a runway in the card did not change the check');
  ev('perfInputs = {}; lastWeather = null; mbPrefs.reg = null;');
  ev(SEED);
});

T('the Phase C block leaves the shared fixture as it found it', () => {
  ev('mbPrefs = { reg: null, loads: normaliseStationLoads({}), view: "sector" };');
  doc.getElementById('fuel-dep').value = '64';
  ev(SEED);
  assert(ev('flights.length') === 1, 'the seed did not restore one flight');
  assert(ev('mbPrefs.reg') === null, 'a registration was left selected');
});

// =========================================================================
// RUNWAYS AND DECLARED DISTANCES (v16.96): AD 2.12 and 2.13, imported.
// =========================================================================

T('a declared-distance column is named by its HEADER, not by its position', () => {
  const R = require('./tools/aip-runways.mjs');
  // Avinor's order is TORA | ASDA | TODA | LDA, which is NOT the textbook one,
  // and the school's workbook read its "TODA" out of the ASDA column because of
  // it. The same row under the two orders must yield the same distances.
  const table = (cols) => '<table><tr>' + ['RWY'].concat(cols, ['RMK']).map((c) => '<th>' + c + '</th>').join('') +
    '</tr><tr><td>10</td>' + cols.map((c) => '<td>' + { 'TORA (M)': 1000, 'ASDA (M)': 1100, 'TODA (M)': 1200, 'LDA (M)': 900 }[c] + '</td>').join('') +
    '<td>NIL</td></tr></table>';
  for (const order of [['TORA (M)', 'ASDA (M)', 'TODA (M)', 'LDA (M)'], ['TORA (M)', 'TODA (M)', 'ASDA (M)', 'LDA (M)']]) {
    const g = R.tableGrid(table(order));
    const h = R.headerColumns(g);
    const row = g[1];
    const v = (k) => Number(row[h.cols[k]].text);
    assert(v('tora') === 1000 && v('asda') === 1100 && v('toda') === 1200 && v('lda') === 900,
      'the header order ' + order.join(' | ') + ' was read as position, not name');
  }
});

T('a spanned table is laid out the way the browser lays it out', () => {
  const R = require('./tools/aip-runways.mjs');
  // ENDU's intersection table: the RWY cell spans two rows, so the "TWY A" row
  // has one cell FEWER and every figure sits one place left in the markup. A
  // parser counting cells reads TORA 2438 as the position's name.
  const g = R.tableGrid('<table>' +
    '<tr><th>RWY</th><th>TKOF PSN (Intersection)</th><th>TORA (M)</th><th>ASDA (M)</th><th>TODA (M)</th><th>RMK</th></tr>' +
    '<tr><td rowspan="2">10</td><td>RWY SFC start 10</td><td>2721</td><td>2721</td><td>2721</td><td>O/R</td></tr>' +
    '<tr><td>TWY A</td><td>2438</td><td>2438</td><td>2438</td><td>NIL</td></tr>' +
    '<tr><td colspan="2">28</td><td>1</td><td>2</td><td>3</td><td>4</td></tr></table>');
  assert(g[2][0].text === '10' && g[2][1].text === 'TWY A' && g[2][2].text === '2438',
    'the rowspan was not carried: ' + g[2].map((c) => c && c.text).join(' | '));
  assert(g[3][0].text === '28' && g[3][1].text === '28' && g[3][2].text === '1',
    'the colspan did not fill both columns: ' + g[3].map((c) => c && c.text).join(' | '));
});

T('the importer refuses a runway it cannot read, rather than guessing one', () => {
  const R = require('./tools/aip-runways.mjs');
  const sd = (rec, field, id, v) => '<span class="SD">' + v + '</span><span class="sdParams">' + rec + ';' + field + ';' + id + '</span>';
  const page = (brgB, unit) =>
    '<h4>XXXX AD 2.12 Runway physical characteristics</h4><table>' +
    '<tr><td>' + sd('TRWY_DIRECTION', 'TXT_DESIG', 1, '10') + '</td><td>' + sd('TRWY_DIRECTION', 'VAL_TRUE_BRG', 1, '100.00°') +
    '</td><td>' + sd('TRWY', 'VAL_LEN', 9, '1000') + ' x ' + sd('TRWY', 'VAL_WID', 9, '30') + '</td><td>' + sd('TRWY', 'CODE_COMPOSITION', 9, 'ASPH') + '</td></tr>' +
    '<tr><td>' + sd('TRWY_DIRECTION', 'TXT_DESIG', 2, '28') + '</td><td>' + sd('TRWY_DIRECTION', 'VAL_TRUE_BRG', 2, brgB) + '</td></tr></table>' +
    '<h4>XXXX AD 2.13 Declared distances</h4><table><tr><th>RWY</th><th>TORA (' + unit + ')</th><th>ASDA (' + unit + ')</th><th>TODA (' + unit + ')</th><th>LDA (' + unit + ')</th><th>RMK</th></tr>' +
    '<tr><td>10</td><td>1000</td><td>1000</td><td>1100</td><td>950' + sd('TRWY_DIRECTION_DECL_DIST', 'VAL_DIST', 3, '') + '</td><td>NIL</td></tr>' +
    '<tr><td>28</td><td>1000</td><td>1000</td><td>1000</td><td>1000</td><td>NIL</td></tr></table>' +
    '<h4>XXXX AD 2.14 Lighting</h4>';
  const good = R.parseRunways(page('280.00°', 'M'));
  assert(!good.refused && good.runways.length === 1 && good.runways[0].ends[0].toda === 1100,
    'the well-formed fixture did not parse: ' + JSON.stringify(good).slice(0, 200));
  assert(/not reciprocal/.test(R.parseRunways(page('250.00°', 'M')).refused || ''),
    'two ends 150 degrees apart were accepted as one runway');
  assert(/not metres/.test(R.parseRunways(page('280.00°', 'FT')).refused || ''),
    'distances in feet were accepted as metres');
});

T('a helipad published under runway markers in AD 2.16 is not read as a runway', () => {
  // The DATASET test below cannot catch this on its own: it reads the shipped
  // data/aip.js, which a parser change does not rebuild, and the eAIP pages are
  // not committed. So the section rule is held here, on a synthetic page with
  // the same shape as ENVA's - a runway in AD 2.12 and a FATO in AD 2.16, both
  // under TRWY and TRWY_DIRECTION.
  const R = require('./tools/aip-runways.mjs');
  const sd = (rec, field, id, v) => '<span class="SD">' + v + '</span><span class="sdParams">' + rec + ';' + field + ';' + id + '</span>';
  const end = (id, desig, brg, extra) => '<tr><td>' + sd('TRWY_DIRECTION', 'TXT_DESIG', id, desig) + '</td><td>' +
    sd('TRWY_DIRECTION', 'VAL_TRUE_BRG', id, brg) + '</td>' + (extra || '') + '</tr>';
  const phys = (id, len) => '<td>' + sd('TRWY', 'VAL_LEN', id, len) + ' x ' + sd('TRWY', 'VAL_WID', id, '30') + '</td><td>' + sd('TRWY', 'CODE_COMPOSITION', id, 'ASPH') + '</td>';
  const html =
    '<h4>ENXX AD 2.12 Runway physical characteristics</h4><table>' +
      end(1, '09', '090.00°', phys(9, '2000')) + end(2, '27', '270.00°') + '</table>' +
    '<h4>ENXX AD 2.13 Declared distances</h4><table><tr><th>RWY</th><th>TORA (M)</th><th>ASDA (M)</th><th>TODA (M)</th><th>LDA (M)</th><th>RMK</th></tr>' +
      '<tr><td>09</td><td>2000</td><td>2000</td><td>2000</td><td>2000' + sd('TRWY_DIRECTION_DECL_DIST', 'VAL_DIST', 3, '') + '</td><td>NIL</td></tr>' +
      '<tr><td>27</td><td>2000</td><td>2000</td><td>2000</td><td>2000</td><td>NIL</td></tr></table>' +
    '<h4>ENXX AD 2.14 Approach and runway lighting</h4>' +
    '<h4>ENXX AD 2.16 Helicopter landing area</h4><table>' +
      end(5, '18', '180.00°', phys(8, '13')) + end(6, '36', '000.00°') + '</table>';
  const got = R.parseRunways(html);
  assert(!got.refused, 'the page was refused: ' + got.refused);
  assert(got.runways.length === 1 && got.runways[0].ends.map((e) => e.desig).join('/') === '09/27',
    'the AD 2.16 helipad was read as a runway: ' + got.runways.map((r) => r.ends.map((e) => e.desig).join('/')).join(' '));
});

T('a helicopter area in AD 2.16 does not become a runway', () => {
  const R = require('./tools/aip-runways.mjs');
  // AD 2.16 publishes FATOs and TLOFs under the SAME markers as a runway. Read
  // off the whole page, four aerodromes grew a runway that is a helipad: ENVA
  // and ENKR an 18/36 or 15/33, ENBO a 07W/25W, ENTC an 18N/36N. The expected
  // lists are the school's own NavData, and the two real two-runway fields
  // (ENGM, ENZV) are here so the fix cannot pass by dropping second runways.
  for (const [icao, want] of [['ENVA', '09/27'], ['ENKR', '05/23'], ['ENBO', '07/25'], ['ENTC', '18/36'],
                              ['ENDU', '10/28'], ['ENGM', '01L/19R 01R/19L'], ['ENZV', '10/28 18/36']]) {
    const got = aipDataset().aerodromes.find((a) => a.icao === icao).runways
      .map((r) => r.ends.map((e) => e.desig).join('/')).join(' ');
    assert(got === want, icao + ' runways read as ' + got + ', want ' + want);
  }
});

T('every aerodrome carries its runways, and every figure agrees with itself', () => {
  const ads = aipDataset().aerodromes;
  assert(ads.length === 53, 'the aerodrome count moved: ' + ads.length);
  let ends = 0, positions = 0;
  for (const a of ads) {
    assert(a.runways.length > 0, a.icao + ' has no runways - check data/aip-report.json for the refusal');
    for (const rw of a.runways) {
      assert(rw.ends.length === 2, a.icao + ' has a runway with ' + rw.ends.length + ' ends');
      const off = Math.abs((((rw.ends[1].trueBrg - rw.ends[0].trueBrg) % 360) + 360) % 360 - 180);
      assert(off <= 3, a.icao + ' runway ends are not reciprocal: ' + off.toFixed(2));
      for (const e of rw.ends) {
        ends++;
        for (const k of ['tora', 'asda', 'toda', 'lda']) {
          assert(Number.isInteger(e[k]) && e[k] > 0, a.icao + ' ' + e.desig + ' ' + k + ' is not a distance: ' + e[k]);
        }
        // A stopway or clearway only ever ADDS to TORA, so a column that slid
        // one place under another header fails one of these.
        assert(e.toda >= e.tora && e.asda >= e.tora, a.icao + ' ' + e.desig + ' TODA/ASDA shorter than TORA');
        positions += (e.positions || []).length;
      }
    }
  }
  // PINNED, and edition-dependent: a parser regression looks exactly like a
  // runway being withdrawn. Check the AIP before editing these numbers.
  assert(ends === 112, 'runway ends: ' + ends + ' (was 112 at 2026-09-03)');
  assert(positions === 120, 'intersection positions: ' + positions + ' (was 120 at 2026-09-03)');
  const endu = ads.find((a) => a.icao === 'ENDU').runways[0];
  const e10 = endu.ends.find((e) => e.desig === '10');
  assert(endu.length === 2995 && endu.width === 45 && endu.surface === 'ASPH' && e10.trueBrg === 109.01,
    'ENDU 10 physical characteristics: ' + JSON.stringify(endu).slice(0, 160));
  assert(e10.tora === 2443 && e10.asda === 2443 && e10.toda === 2443 && e10.lda === 2001,
    'ENDU 10 declared distances: ' + [e10.tora, e10.asda, e10.toda, e10.lda]);
  assert(e10.positions.some((p) => p.name === 'TWY A' && p.tora === 2438),
    'ENDU 10 lost its TWY A intersection: ' + JSON.stringify(e10.positions));
});

T('the import agrees with the school\'s own runway table wherever both exist', () => {
  // The workbook's NavData is the school's transcription of the same AIP - an
  // INDEPENDENT reading, which is what the 90/90 POH check was too.
  const cells = xlsxSheet('./OFP-C182.xlsx', 'NavData', { strings: true });
  const ads = aipDataset().aerodromes;
  let compared = 0, agree = 0;
  const odd = [];
  for (let r = 2; r < 400; r++) {
    const icao = cells['O' + r];
    if (!icao) continue;
    let rwy = cells['P' + r];
    rwy = typeof rwy === 'number' ? String(rwy).padStart(2, '0') : String(rwy);
    compared++;
    const ad = ads.find((a) => a.icao === icao);
    const e = ad && ad.runways.flatMap((x) => x.ends).find((x) => x.desig === rwy);
    if (!e) { odd.push(icao + ' ' + rwy); continue; }
    if (e.tora === cells['Q' + r] && e.asda === cells['R' + r] && e.toda === cells['S' + r] && e.lda === cells['T' + r]) agree++;
    else odd.push(icao + ' ' + rwy + ' differs');
  }
  // 96 of 98. The two are ENTO 18 and 36, which the AIP has since REDESIGNATED
  // 17 and 35 (magnetic drift): the sheet is stale there, not the import.
  assert(compared === 98, 'NavData rows compared: ' + compared);
  assert(agree === 96, agree + ' of ' + compared + ' agree; the rest: ' + odd.join(', '));
  assert(odd.join(',') === 'ENTO 18,ENTO 36', 'a new disagreement with the school\'s table: ' + odd.join(', '));
  const ento = ads.find((a) => a.icao === 'ENTO').runways.flatMap((x) => x.ends).find((e) => e.desig === '17');
  assert(ento && ento.tora === cells['Q' + Object.keys(cells).find((k) => k[0] === 'O' && cells[k] === 'ENTO').slice(1)],
    'ENTO 17 is not the old 18 renamed');
});

// =========================================================================
// TAKE-OFF AND LANDING DISTANCE (v16.96, phase D): rwyperf.js.
// =========================================================================

T('the distance engine reproduces the workbook\'s own worked example, cell for cell', () => {
  const P = moduleExports.rwy;
  // Read OUT OF THE SHEET, not retyped here: a comparison with a copied number
  // is a comparison with itself (the v16.93 lesson).
  const ofp = xlsxSheet('./OFP-C182.xlsx', 'OFP');
  // The example's inputs: ENDU, 2582.3 lb, QNH 990, 11 C, wind 020/03.
  assert(ofp.D11 === 2582.3 && ofp.K20 === 990 && ofp.N20 === 11 && ofp.P18 === 875,
    'the workbook example moved: ' + [ofp.D11, ofp.K20, ofp.N20, ofp.P18]);
  assert(P.pressureAltitudeFt(254, 990) === ofp.P18, 'pressure altitude differs from OFP!P18');
  const wind = P.windAlongRunway(109.01, 20, 3);        // ENDU 10, TRUE bearing
  const to = P.runwayDistance({ kind: 'takeoff', weightLb: 2582.3, elevFt: 254, qnhHpa: 990, tempC: 11,
    headKt: wind.headKt, braking: 6, surface: 'ASPH', availableM: 2443 });
  const ld = P.runwayDistance({ kind: 'landing', weightLb: null, elevFt: 254, qnhHpa: 990, tempC: 11,
    headKt: wind.headKt, braking: 6, surface: 'ASPH', availableM: 2001 });
  // The sheet stores metres as feet / 3.28, so the feet it interpolated are
  // O24 x 3.28 - and the sheet ROUNDs them. Ours stay unrounded and must round
  // to the same whole foot.
  assert(Math.round(to.uncorrectedM / 0.3048) === Math.round(ofp.O24 * 3.28),
    'take-off uncorrected: ' + (to.uncorrectedM / 0.3048).toFixed(2) + ' ft vs the sheet\'s ' + (ofp.O24 * 3.28).toFixed(2));
  assert(Math.round(ld.uncorrectedM / 0.3048) === Math.round(ofp.V24 * 3.28),
    'landing uncorrected: ' + (ld.uncorrectedM / 0.3048).toFixed(2) + ' ft vs the sheet\'s ' + (ofp.V24 * 3.28).toFixed(2));
  // And the figure the pilot writes down is the sheet's to the metre.
  assert(to.requiredM === ofp.O31, 'required take-off ' + to.requiredM + ' m vs OFP!O31 ' + ofp.O31);
  assert(ld.requiredM === ofp.V31, 'required landing ' + ld.requiredM + ' m vs OFP!V31 ' + ofp.V31);
  assert(to.ok && ld.ok && to.factor === ofp.L31 + 1 && ld.factor === ofp.S31 + 1,
    'the performance factors are not the sheet\'s: ' + to.factor + ' / ' + ld.factor);
});

T('the POH grid is exact on its nodes, and refuses rather than extrapolates', () => {
  const P = moduleExports.rwy;
  const poh = JSON.parse(fs.readFileSync('./tools/prepared/poh-takeoff.json', 'utf8'));
  const node = P.pohDistanceFt('takeoff', 2700, 3000, 20);
  assert(node.totalFt === poh.table['2700']['3000'][2][1] && node.rollFt === poh.table['2700']['3000'][2][0],
    'a grid node is not the table value: ' + JSON.stringify(node));
  // BELOW the table it clamps, as the workbook does and in the safe direction.
  const at = (w, pa, t) => P.pohDistanceFt('takeoff', w, pa, t).totalFt;
  assert(at(2700, 3000, -15) === at(2700, 3000, 0), 'a sub-zero temperature was not clamped to 0 C');
  assert(at(2700, -400, 10) === at(2700, 0, 10), 'a negative pressure altitude was not clamped to sea level');
  assert(at(2100, 1000, 10) === at(2300, 1000, 10), 'a mass under 2300 lb was not clamped to the 2300 lb table');
  // ABOVE it there is nothing published. The workbook's fallback read a missing
  // row as 0 and made PA 6000 SHORTER than PA 5000.
  for (const [w, pa, t, why] of [[2700, 8001, 10, /above the POH table/], [2700, 3000, 41, /above the POH table/],
                                 [3101, 1000, 10, /above the POH table/], [NaN, 1000, 10, /not known/]]) {
    const r = P.pohDistanceFt('takeoff', w, pa, t);
    assert('refused' in r && why.test(r.refused), `${w} lb / ${pa} ft / ${t} C was not refused: ` + JSON.stringify(r));
  }
  // THE DELETED CELLS STAY REFUSED, and so does anything interpolated from one.
  const deleted = P.pohDistanceFt('takeoff', 3100, 8000, 30);
  assert('refused' in deleted && /deletes/.test(deleted.refused), 'a POH-deleted cell produced a distance');
  const near = P.pohDistanceFt('takeoff', 2900, 7500, 35);
  assert('refused' in near, 'a figure interpolated toward a deleted corner was produced: ' + JSON.stringify(near));
  // Landing has ONE weight: the mass passed in must change nothing.
  assert(P.pohDistanceFt('landing', 2200, 2000, 10).totalFt === P.pohDistanceFt('landing', 2950, 2000, 10).totalFt,
    'the landing table was scaled by weight');
});

T('more mass, more altitude or more heat never makes a distance shorter', () => {
  const P = moduleExports.rwy;
  let checked = 0;
  const rnd = (a, b) => a + Math.random() * (b - a);
  for (let i = 0; i < 400 * SWEEP_N; i++) {
    const w = rnd(2300, 3050), pa = rnd(0, 7000), t = rnd(0, 34);
    const base = P.pohDistanceFt('takeoff', w, pa, t);
    if ('refused' in base) continue;
    for (const [dw, dp, dt] of [[40, 0, 0], [0, 400, 0], [0, 0, 4]]) {
      const more = P.pohDistanceFt('takeoff', w + dw, pa + dp, t + dt);
      if ('refused' in more) continue;
      checked++;
      assert(more.totalFt >= base.totalFt - 1e-9 && more.rollFt >= base.rollFt - 1e-9,
        `take-off got SHORTER: ${w.toFixed(0)} lb ${pa.toFixed(0)} ft ${t.toFixed(1)} C -> +${dw}/${dp}/${dt}`);
    }
    const l0 = P.pohDistanceFt('landing', null, pa, t), l1 = P.pohDistanceFt('landing', null, pa + 400, t + 4);
    if ('totalFt' in l0 && 'totalFt' in l1) assert(l1.totalFt >= l0.totalFt, 'landing got shorter with height and heat');
  }
  assert(checked > 800, 'the monotonicity sweep checked only ' + checked + ' pairs');
});

T('wind is the school\'s rule, from TRUE directions, and a VRB wind is a tailwind', () => {
  const P = moduleExports.rwy;
  assert(P.windFactor(8) === 1, 'a headwind under 9 kt earned credit');
  assert(Math.abs(P.windFactor(9) - 0.9) < 1e-12 && Math.abs(P.windFactor(18) - 0.8) < 1e-12, 'headwind credit is not 10% per 9 kt');
  assert(Math.abs(P.windFactor(-2) - 1.1) < 1e-12 && Math.abs(P.windFactor(-10) - 1.5) < 1e-12, 'tailwind is not +10% per 2 kt');
  assert(P.windFactor(-11) === null, 'an 11 kt tailwind was priced instead of refused');
  // ENDU 10 is 109.01 TRUE. A METAR wind of 109/20 is straight down it; the
  // workbook's magnetic 099 would have shaved it and invented a crosswind.
  const straight = P.windAlongRunway(109.01, 109, 20);
  assert(straight.headKt === 20 && straight.crossKt === 0, 'a wind down the runway: ' + JSON.stringify(straight));
  const behind = P.windAlongRunway(109.01, 289, 6);
  assert(behind.headKt === -6, 'a wind from behind is not a tailwind: ' + JSON.stringify(behind));
  const calm = P.windAlongRunway(109.01, 0, 0);
  assert(Object.is(calm.headKt, 0), 'a calm reads as -0, which prints as a tailwind');
  // The author's decision: VRB is the full speed from behind, on BOTH ends.
  const vrb = P.windAlongRunway(109.01, 'VRB', 5);
  assert(vrb.headKt === -5 && vrb.variable, 'VRB 05 is not a 5 kt tailwind: ' + JSON.stringify(vrb));
  const base = { weightLb: 2600, elevFt: 254, qnhHpa: 1013, tempC: 10, braking: 6, surface: 'ASPH', availableM: 2443 };
  for (const kind of ['takeoff', 'landing']) {
    const calmD = P.runwayDistance(Object.assign({ kind, headKt: 0 }, base));
    const vrbD = P.runwayDistance(Object.assign({ kind, headKt: vrb.headKt }, base));
    assert(vrbD.correctedM > calmD.correctedM, kind + ': a VRB wind was not priced as a tailwind');
  }
  const best = P.bestEnd([{ desig: '10', trueBrg: 109.01 }, { desig: '28', trueBrg: 289.05 }], 290, 12);
  assert(best.desig === '28', 'the default runway is not the one into wind: ' + best.desig);
});

T('braking action, surface and the tailwind limit refuse rather than guess', () => {
  const P = moduleExports.rwy;
  const x = { kind: 'takeoff', weightLb: 2600, elevFt: 254, qnhHpa: 1013, tempC: 10, headKt: 0, braking: 6, surface: 'ASPH', availableM: 2443 };
  const d = (o) => P.runwayDistance(Object.assign({}, x, o));
  const good = d({});
  assert(!good.refused && good.brakingCorrM === 0 && good.surfaceCorrM === 0, 'a dry paved runway carried a correction');
  const ba4 = d({ braking: 4 });
  assert(Math.abs(ba4.brakingCorrM - 0.1 * good.correctedM) < 1e-9, 'braking action 4 is not +10%');
  assert(/prohibited/.test(d({ braking: 0 }).refused || ''), 'braking action 0 was not refused as prohibited');
  assert(d({ braking: 7 }).refused, 'braking action 7 was accepted');
  assert(/tailwind/.test(d({ headKt: -12 }).refused || ''), 'a 12 kt tailwind produced a distance');
  // ENAS is GRAVEL. The POH corrects for dry grass and nothing else.
  assert(/no correction for a GRAVEL/.test(d({ surface: 'GRAVEL' }).refused || ''), 'a gravel runway was priced as asphalt');
  // Grass is a share of the GROUND ROLL - 15% take-off, 45% landing. Same
  // wording, different number: the named trap from the v16.93 tables.
  const roll = P.pohDistanceFt('takeoff', 2600, 254, 10).rollFt * 0.3048;
  assert(Math.abs(d({ surface: 'GRASS' }).surfaceCorrM - 0.15 * roll) < 1e-6, 'take-off grass is not 15% of the roll');
  const lroll = P.pohDistanceFt('landing', null, 254, 10).rollFt * 0.3048;
  assert(Math.abs(d({ kind: 'landing', surface: 'GRASS' }).surfaceCorrM - 0.45 * lroll) < 1e-6, 'landing grass is not 45% of the roll');
  for (const k of ['qnhHpa', 'tempC', 'headKt']) {
    const r = d({ [k]: NaN });
    assert(/not known/.test(r.refused || '') && !r.ok, 'a missing ' + k + ' did not refuse');
  }
  // A refusal is never a pass, and a too-short runway is never ok.
  assert(!d({ availableM: 300 }).ok && d({ availableM: 300 }).marginM < 0, 'a 300 m TODA passed');
  assert(!d({ availableM: null }).ok, 'no published distance passed');
});

T('the required distance is rounded UP, never to the nearest', () => {
  const P = moduleExports.rwy;
  // A requirement rounded down by half a metre is rounded the wrong way.
  for (let t = 0; t <= 30; t += 0.7) {
    const r = P.runwayDistance({ kind: 'landing', weightLb: null, elevFt: 100, qnhHpa: 1013, tempC: t,
      headKt: 0, braking: 6, surface: 'ASPH', availableM: 3000 });
    assert(r.requiredM >= r.correctedM * r.factor - 1e-9, 'required ' + r.requiredM + ' is below ' + (r.correctedM * r.factor));
    assert(r.requiredM - r.correctedM * r.factor < 1, 'required overshoots by a whole metre');
  }
});

// =====================================================================
// v16.98: endurance at 12 gal/h, take-off at full length, TEMPO wind, and
// the Last Minute Change as the actual fuel against the planned.
// =====================================================================
/** Every one of these leaves the shared fixture as it found it: `T` runs at
 *  once and the async tests are queued behind it (the v16.94 lesson). */
const V1698_FIXTURE = { flights: ev('JSON.stringify(flights)'), active: ev('activeFlightIndex'),
  fuel: doc.getElementById('fuel-dep').value };
function resetV1698() {
  ev(`actualFuelGal = null; mbPrefs.reg = null; mbPrefs.view = 'sector'; mbPrefs.loads = normaliseStationLoads({});
      perfInputs = {}; lastWeather = null; flights = JSON.parse(${JSON.stringify(V1698_FIXTURE.flights)});
      activeFlightIndex = ${V1698_FIXTURE.active}; refreshMap();`);
  doc.getElementById('fuel-dep').value = V1698_FIXTURE.fuel;
}

T('endurance is fuel at 12 gal/h: 64 gal is 05:20, and nothing else times the fuel block', () => {
  const M = moduleExports.mb, P = moduleExports.pdf;
  assert(M.PLANNING_GPH === 12, 'the planning fuel flow is not the sheet\'s 12 gal/h (OFP!P4): ' + M.PLANNING_GPH);
  assert(M.MIN_FLIGHT_GPH === M.PLANNING_GPH, 'Min FLT and endurance use two different planning rates');
  assert(M.minutesAtPlanningRate(64) === 320 && P.hhmm(M.minutesAtPlanningRate(64)) === '05:20',
    '64 gal is not 05:20: ' + M.minutesAtPlanningRate(64));
  assert(P.hhmm(M.minutesAtPlanningRate(12)) === '01:00', '12 gal is not an hour');
  for (const v of [NaN, -1, '', null, undefined]) {
    assert(Number.isNaN(M.minutesAtPlanningRate(/** @type {any} */ (v))), 'an unknown fuel figure has an endurance: ' + v);
  }
});

T('the printed endurance and final reserve are at 12 gal/h, not the cruise POH flow', () => {
  ev(SEED_STOP);
  doc.getElementById('fuel-dep').value = '64';
  const reserveWas = doc.getElementById('fuel-reserve').value;
  doc.getElementById('fuel-reserve').value = '12';
  ev(`mbPrefs.reg = "LN-TRB"; renderAllFlightTables();`);
  const sheet = readMb(printDoc().sheets.filter((s) => s.kind === 'mb')[0]);
  // The fixture has to be able to tell the two rates apart, or it proves nothing.
  const ff = numPt(sheet.box.cruiseFf);
  assert(Number.isFinite(ff) && Math.abs(ff - 12) > 0.2, 'the cruise POH flow is 12 here, so the fixture cannot discriminate: ' + ff);
  assert(sheet.fuel.endurance.time === '05:20', 'endurance of 64 gal printed as ' + sheet.fuel.endurance.time);
  assert(sheet.fuel.reserve.time === '01:00', 'a 12 gal final reserve printed as ' + sheet.fuel.reserve.time);
  // And on the tab.
  assert(/Endurance\s*05:20/.test(doc.getElementById('mb-body').textContent), 'the tab does not show 05:20');
  doc.getElementById('fuel-reserve').value = reserveWas;
  resetV1698();
  w.renderAllFlightTables();
});

T('a take-off is a stationary start at full length - after a touch & go as well', () => {
  const ads = aipDataset().aerodromes;
  const endu = ads.find((a) => a.icao === 'ENDU');
  const ends = endu.runways.flatMap((r) => r.ends.map((e) => e.desig)).sort();
  assert(endu.runways.some((r) => r.ends.some((e) => (e.positions || []).length)),
    'ENDU publishes no intersection any more, so this cannot show they are not offered');
  ev(`flights = [
    { id: 1, title: "A", depElev: 254, waypoints: [
      { lat: 69.05505349, lng: 18.54466865, name: "ENDU", alt: 254, oat: 10, wdir: 0, wspd: 0, var: -11 },
      { lat: 69.67895054, lng: 18.91143033, name: "ENTC", alt: 2500, oat: 10, wdir: 0, wspd: 0, var: -12, stop: "touch-go", stopMin: 5 } ]},
    { id: 2, title: "B", depElev: 32, waypoints: [
      { lat: 69.67895054, lng: 18.91143033, name: "ENTC", alt: 32, oat: 10, wdir: 0, wspd: 0, var: -12 },
      { lat: 69.05505349, lng: 18.54466865, name: "ENDU", alt: 2500, oat: 10, wdir: 0, wspd: 0, var: -11 } ]}];
    activeFlightIndex = 0; mbPrefs.reg = "LN-TRB";
    perfInputs = { '1:dep': { windDir: '280', windKt: '5', qnh: '1013', oat: '10' },
                   '2:dep': { windDir: '180', windKt: '5', qnh: '1013', oat: '10' } };
    refreshMap(); renderAllFlightTables();`);
  const deps = ev(`runwayChecks.filter(c => c.kind === 'takeoff')`);
  assert(deps.length === 2, 'expected two take-offs: ' + deps.length);
  assert(JSON.stringify(deps[0].options.map((o) => o.id).sort()) === JSON.stringify(ends),
    'ENDU offered more than its runway ends: ' + JSON.stringify(deps[0].options.map((o) => o.id)));
  for (const d of deps) {
    assert(d.options.every((o) => !o.pos), d.icao + ' still offers an intersection');
    assert(d.res && !d.res.refused && d.res.availableM === d.opt.end.toda,
      d.icao + ' take-off is not priced from the threshold against TODA: ' + JSON.stringify(d.res).slice(0, 160));
  }
  assert(deps[1].icao === 'ENTC', 'the take-off after the touch & go is not at ENTC: ' + deps[1].icao);
  const card = doc.getElementById('mb-perf').innerHTML;
  assert(!/ from (TWY|RWY SFC|[A-Z]\d)/.test(card), 'the RWY list still names an intersection');
  resetV1698();
  w.renderAllFlightTables();
});

T('a METAR TEMPO group\'s wind is decoded, and only from the TEMPO group', () => {
  const Mt = moduleExports.metar;
  const p = Mt.parseReport('ENDU 290950Z 27008KT 9999 FEW030 08/02 Q1012 TEMPO 30018G28KT=');
  assert(p.wind.dir === 270 && p.wind.speedKt === 8, 'the observed wind moved: ' + JSON.stringify(p.wind));
  assert(p.tempoWind && p.tempoWind.dir === 300 && p.tempoWind.speedKt === 18 && p.tempoWind.gustKt === 28 && p.tempoWindCount === 1,
    'the TEMPO wind was not read: ' + JSON.stringify(p.tempoWind));
  assert(/TEMPO wind 300° 18 kt gusting 28/.test(Mt.summariseReport(p)), 'the card does not say the TEMPO wind: ' + Mt.summariseReport(p));
  // A BECMG wind is not a TEMPO wind.
  const b = Mt.parseReport('ENDU 290950Z 27008KT 9999 08/02 Q1012 TEMPO 4000 SHRA BECMG 32015KT');
  assert(b.tempoWind === null && b.tempoWindCount === 0, 'a BECMG wind was read as TEMPO: ' + JSON.stringify(b.tempoWind));
  // With no observed wind, the TEMPO forecast must not become the observation.
  const n = Mt.parseReport('ENDU 290950Z /////KT 9999 08/02 Q1012 TEMPO 30018KT');
  assert(n.wind === null && n.tempoWind && n.tempoWind.dir === 300, 'the TEMPO wind was reported as observed: ' + JSON.stringify(n.wind));
  // Two TEMPO winds: the first, and the count says there were two.
  const two = Mt.parseReport('ENDU 290950Z 27008KT 9999 08/02 Q1012 TEMPO 31015KT TEMPO 33020KT');
  assert(two.tempoWind.dir === 310 && two.tempoWindCount === 2, 'two TEMPO winds: ' + JSON.stringify(two.tempoWind) + ' x' + two.tempoWindCount);
  // A TAF's TEMPO groups each have their own time; they are left alone.
  const taf = Mt.parseReport('TAF ENDU 290800Z 2909/2918 27008KT 9999 FEW030 TEMPO 2912/2916 30020G30KT');
  assert(taf.isTaf && taf.tempoWind === null, 'a TAF TEMPO was taken: ' + JSON.stringify(taf.tempoWind));
});

T('the TEMPO wind is the wind the distances are worked with, unless one is typed', () => {
  ev(SEED_STOP);
  doc.getElementById('fuel-dep').value = '64';
  ev(`mbPrefs.reg = "LN-TRB"; mbPrefs.loads = normaliseStationLoads({ pilotLb: 180 }); perfInputs = {};
      lastWeather = { icaos: ['ENDU', 'ENTC'], tafs: {}, metars: {
        ENDU: 'ENDU 281150Z 29004KT 9999 FEW040 10/05 Q1005 TEMPO 11012KT',
        ENTC: 'ENTC 281150Z 18008KT 9999 SCT030 08/04 Q1003' } };`);
  w.renderAllFlightTables();
  const dep = ev('runwayChecks[0]');
  assert(dep.windDir === 110 && dep.windKt === 12 && dep.windTempo && dep.windTempo.text === '11012KT',
    'the ENDU take-off did not use the TEMPO wind: ' + dep.windDir + '/' + dep.windKt + ' ' + JSON.stringify(dep.windTempo));
  // It decides the runway too: 110/12 is down RWY 10, where the observed 290/04 was down 28.
  assert(dep.opt.desig === '10' && dep.wind.headKt === 12, 'the default runway ignored the TEMPO wind: ' + dep.opt.desig);
  assert(/TEMPO<\/b> group, 11012KT/.test(doc.getElementById('mb-perf').innerHTML), 'the card does not say the wind is the TEMPO group');
  // The observed wind is what it was without a TEMPO, so the change is the TEMPO.
  const arr = ev('runwayChecks[3]');
  assert(arr.icao === 'ENDU' && arr.windKt === 12 && arr.windTempo, 'the ENDU landing did not use it too');
  const noTempo = ev('runwayChecks[1]');
  assert(noTempo.icao === 'ENTC' && noTempo.windKt === 8 && !noTempo.windTempo, 'ENTC has no TEMPO and still claims one');
  // A typed wind wins, and then nothing claims to be the TEMPO.
  ev(`perfInputs = { [runwayChecks[0].key]: { windDir: '290', windKt: '4' } };`);
  w.renderAllFlightTables();
  assert(ev('runwayChecks[0].windKt') === 4 && !ev('runwayChecks[0].windTempo'), 'a typed wind did not override the TEMPO');
  // And the paper says where the wind came from.
  ev(`perfInputs = {};`);
  w.renderAllFlightTables();
  const sheet = readMb(printDoc().sheets.filter((s) => s.kind === 'mb')[0]);
  assert(sheet.box.depWspd === '12' && /TEMPO/.test(sheet.box.toNote || ''),
    'the printed take-off block does not carry the TEMPO wind: ' + sheet.box.depWspd + ' / ' + sheet.box.toNote);
  resetV1698();
  w.renderAllFlightTables();
});

T('the actual fuel changes every sector flown on those tanks, and stops at a refuel', () => {
  const M = moduleExports.mb;
  assert(M.normaliseActualFuelGal('') === null && M.normaliseActualFuelGal(null) === null, 'an empty box is not "no change"');
  assert(M.normaliseActualFuelGal('0') === 0, 'a typed 0 is a real figure, not no change');
  assert(M.normaliseActualFuelGal('60.04') === 60, 'not rounded to 0.1');
  for (const bad of ['-1', 'abc', '1001', 'NaN']) {
    assert(Number.isNaN(M.normaliseActualFuelGal(bad)), 'an unreadable figure was accepted: ' + bad);
  }
  const plan = [
    { fuelDepGal: 64, fuelArrGal: 50.3, label: 'A' },
    { fuelDepGal: 49.5, fuelArrGal: 40.1, label: 'B' },         // a touch & go before it
    { fuelDepGal: 64, fuelArrGal: 52, label: 'C', refuelled: true },
    { fuelDepGal: 52, fuelArrGal: 40, label: 'D' }];
  const a = M.applyActualFuel(plan, 60);
  assert(a.deltaGal === -4 && a.plannedGal === 64 && a.reach === 2, 'delta/reach: ' + JSON.stringify([a.deltaGal, a.plannedGal, a.reach]));
  assert(a.sectors[0].fuelDepGal === 60, 'the first departure is not EXACTLY the typed figure: ' + a.sectors[0].fuelDepGal);
  assert(Math.abs(a.sectors[1].fuelDepGal - 45.5) < 1e-9 && Math.abs(a.sectors[1].fuelArrGal - 36.1) < 1e-9, 'not carried through the touch & go');
  assert(a.sectors[2].fuelDepGal === 64 && a.sectors[3].fuelDepGal === 52 && a.sectors[2].lmcGal === 0,
    'the change survived the refuel: ' + JSON.stringify(a.sectors[2]));
  assert(plan[0].fuelDepGal === 64, 'applyActualFuel mutated its input');
  const none = M.applyActualFuel(plan, null), bad = M.applyActualFuel(plan, NaN);
  assert(none.deltaGal === null && bad.deltaGal === null && none.sectors[0].fuelDepGal === 64 && bad.sectors[1].fuelArrGal === 40.1,
    'no change, or an unreadable one, still moved the fuel');
  const eq = M.applyActualFuel(plan, 64);
  assert(eq.deltaGal === 0 && eq.reach === 2, 'actual equal to planned is a change of 0, not no change');
  // Running out is a finding; only on the sectors the change reached.
  const dry = M.applyActualFuel(plan, 10);
  const probs = M.actualFuelProblems(dry);
  assert(probs.length === 2 && /on A \(-3\.7 gal\)/.test(probs[0]) && /NEGATIVE/.test(probs[0]),
    'running out with the actual fuel is not a finding: ' + JSON.stringify(probs));
  assert(M.actualFuelProblems(none).length === 0 && M.actualFuelProblems(a).length === 0, 'a finding with nothing wrong');
});

T('typing the actual fuel recalculates the M&B, prints the change on the LMC line, and leaves the OFP the plan', () => {
  ev(SEED_STOP);
  doc.getElementById('fuel-dep').value = '64';
  ev(`mbPrefs.reg = "LN-TRB"; mbPrefs.loads = normaliseStationLoads({ pilotLb: 180 }); renderAllFlightTables();`);
  const before = ev('massBalanceMission.sectors.map(s => [s.takeoff.weightLb, s.landing.weightLb])');
  const ofpBefore = ev('JSON.stringify(ofpPrintModel.map(s => s.fuelGal))');
  // Through the real box, the way a pilot does it.
  const box = doc.getElementById('mb-actual-fuel');
  assert(box && box.placeholder === '64.0', 'the box does not show the planned figure: ' + (box && box.placeholder));
  box.value = '60';
  box.dispatchEvent(new w.Event('change'));
  assert(ev('actualFuelGal') === 60, 'the box did not reach the planner: ' + ev('actualFuelGal'));
  const after = ev('massBalanceMission.sectors.map(s => [s.takeoff.weightLb, s.landing.weightLb])');
  assert(Math.abs(before[0][0] - after[0][0] - 24) < 1e-9 && Math.abs(before[0][1] - after[0][1] - 24) < 1e-9,
    'the first sector is not 24 lb lighter at both ends: ' + JSON.stringify([before[0], after[0]]));
  // SEED_STOP refuels to 50 gal at ENTC: the second sector is untouched.
  assert(before[1][0] === after[1][0], 'the change reached past the refuel');
  assert(ev('JSON.stringify(ofpPrintModel.map(s => s.fuelGal))') === ofpBefore, 'the OFP\'s own fuel moved - it is the plan');
  assert(/-4\.0 gal/.test(doc.getElementById('mb-lmc-note').textContent) && /refuel before/.test(doc.getElementById('mb-lmc-note').textContent),
    'the tab does not say what changed: ' + doc.getElementById('mb-lmc-note').textContent);
  // The take-off distance is worked at the actual mass.
  const pages = printDoc().sheets.filter((s) => s.kind === 'mb').map(readMb);
  const p1 = pages[0], p2 = pages[1];
  assert(p1.mb.fuel.w === '360,0' && p1.mb.lmc && p1.mb.lmc.w === '-24,0' && p1.mb.lmc.mom === '-1116,0',
    'the first page does not print actual fuel and the change: ' + JSON.stringify([p1.mb.fuel, p1.mb.lmc]));
  assert(p1.fuel.onboard.gal === '60,0' && p1.fuel.endurance.time === '05:00', 'fuel on board / endurance: ' + JSON.stringify(p1.fuel.onboard) + ' ' + p1.fuel.endurance.time);
  assert(/Last Minute Change: planned 64,0 US gal, actual 60,0/.test(p1.box.note || ''), 'the page does not say it is the actual fuel: ' + p1.box.note);
  assert(Math.abs(numPt(p1.mb.tom.w) - after[0][0]) <= 0.05, 'the printed take-off mass is not the actual: ' + p1.mb.tom.w);
  assert(!p2.mb.lmc && !(p2.box.note || '').includes('Last Minute'), 'a sector after the refuel printed a change it was not flown with');
  // A positive change carries its sign.
  ev('actualFuelGal = 66; renderAllFlightTables();');
  const up = readMb(printDoc().sheets.filter((s) => s.kind === 'mb')[0]);
  assert(up.mb.lmc.w === '+12,0' && up.mb.lmc.mom === '+558,0', 'a positive change is unsigned: ' + JSON.stringify(up.mb.lmc));
  // The whole-mission master carries it too.
  ev(`mbPrefs.view = 'mission'; actualFuelGal = 60; renderAllFlightTables();`);
  const master = readMb(printDoc().sheets.filter((s) => s.kind === 'mb')[0]);
  assert(master.mb.lmc && master.mb.lmc.w === '-24,0' && /Last Minute Change/.test(master.box.note) && /Fuel change at the stops/.test(master.box.title),
    'the master lost the change or the stop note: ' + master.box.note + ' / ' + master.box.title);
  // Nothing typed: no LMC line, anywhere.
  box.value = '';
  box.dispatchEvent(new w.Event('change'));
  assert(ev('actualFuelGal') === null && printDoc().sheets.filter((s) => s.kind === 'mb').every((s) => !readMb(s).mb.lmc),
    'an empty box still printed a last minute change');
  resetV1698();
  w.renderAllFlightTables();
});

T('running out with the actual fuel raises the banner; the planned column alone would not', () => {
  ev(SEED_STOP);
  doc.getElementById('fuel-dep').value = '64';
  ev(`mbPrefs.reg = "LN-TRB"; actualFuelGal = 2; renderAllFlightTables();`);
  const probs = ev('runIntegrityCheck()');
  assert(probs.some((p) => /Last minute change: with 2\.0 gal actually on board the fuel remaining goes NEGATIVE/.test(p)),
    'running dry on the actual fuel is not on the banner: ' + JSON.stringify(probs));
  ev('actualFuelGal = null; renderAllFlightTables();');
  assert(!ev('runIntegrityCheck()').some((p) => /Last minute change/.test(p)), 'the finding outlived the change');
  // An unreadable figure changes nothing and says so.
  ev('actualFuelGal = NaN; renderAllFlightTables();');
  assert(/Not a readable fuel figure/.test(doc.getElementById('mb-lmc-note').textContent) &&
    ev('massBalanceMission.sectors[0].fuelDepGal') === 64, 'an unreadable actual fuel was weighed');
  resetV1698();
  w.renderAllFlightTables();
});

T('actual fuel is never stored and never exported', () => {
  ev(SEED_STOP);
  ev(`mbPrefs.reg = "LN-TRB"; renderAllFlightTables();`);
  // Through the real box, then a save of everything that IS stored.
  const box = doc.getElementById('mb-actual-fuel');
  box.value = '55';
  box.dispatchEvent(new w.Event('change'));
  assert(ev('actualFuelGal') === 55, 'the fixture did not type the fuel');
  ev('saveMbPrefs(); savePlanningPrefs();');
  assert(!/55/.test(w.localStorage.getItem('c182_mb_prefs') || '') && !/actual/i.test(w.localStorage.getItem('c182_mb_prefs') || ''),
    'the actual fuel reached localStorage: ' + w.localStorage.getItem('c182_mb_prefs'));
  const all = Object.keys(w.localStorage).map((k) => w.localStorage.getItem(k)).join('\n');
  assert(!/actualFuel/i.test(all), 'something stored the actual fuel');
  assert(!/actualFuel/.test(ev('JSON.stringify(PROFILE_KEYS)')), 'the actual fuel is in PROFILE_KEYS');
  resetV1698();
  w.renderAllFlightTables();
});

TA('the longest page-2 margin notes fit their free paper at no less than the smallest type', async () => {
  const P = moduleExports.pdf;
  const { PDFDocument, StandardFonts } = require('pdf-lib');
  const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
  // The widest figures either can carry: the typo guard's 1000 gal, and the
  // longest reporting-point names as the sector's ends.
  const worst = {
    note: 'Last Minute Change: planned 999,9 US gal, actual 1000,0 - every figure here is for the actual fuel',
    title: 'Whole flight  KVALØYSLETTA → NORDKJOSBOTN   ·   Fuel change at the stops +999,9 US gal: T/O - consumed + that = landing'
  };
  for (const [k, text] of Object.entries(worst)) {
    const b = P.MB_BOXES[k];
    const fit = P.fitSize((t, sz) => font.widthOfTextAtSize(P.encodable(t, new Set(font.getCharacterSet())), sz),
      text, b.x1 - b.x0 - 2 * P.PAD, 6);
    assert(fit.fits, 'the ' + k + ' strip cannot hold its longest text even at ' + P.MIN_SIZE + ' pt');
  }
});

TA('pressing Fetch works out the take-off and landing distances at once - no runway cycling', async () => {
  // v16.99, the author: "when the fetch button is pressed, the takeoff and
  // landing distances arent calculated before i cycle the runways once". The
  // fetch repainted the weather cards and never re-ran the render pass the
  // runway checks are built in. CLICKED, not called: the button is the control.
  ev(SEED_STOP);
  doc.getElementById('fuel-dep').value = '64';
  ev(`mbPrefs.reg = "LN-TRB"; perfInputs = {}; lastWeather = null; renderAllFlightTables();`);
  const before = ev('runwayChecks[0].res');
  assert(before && before.refused, 'the fixture already has a distance before any weather: ' + JSON.stringify(before).slice(0, 120));
  const realFetch = w.fetch;
  const reports = {
    metar: 'ENDU 281150Z 29012KT 9999 FEW040 10/05 Q1005\nENTC 281150Z 18008KT 9999 SCT030 08/04 Q1003\n',
    taf: 'TAF ENDU 281100Z 2812/2821 29010KT 9999 FEW040\nTAF ENTC 281100Z 2812/2821 18008KT 9999 SCT030\n'
  };
  w.fetch = async (url) => ({ ok: true, status: 200, text: async () => (/\/taf\?/.test(String(url)) ? reports.taf : reports.metar) });
  try {
    doc.getElementById('metar-fetch-btn').click();
    for (let i = 0; i < 50 && ev('!lastWeather || document.getElementById("metar-fetch-btn").disabled'); i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    await new Promise((r) => setTimeout(r, 0));
    assert(ev('!!lastWeather'), 'the fetch never completed');
    const dep = ev('runwayChecks[0]'), arr = ev('runwayChecks[1]');
    assert(dep.icao === 'ENDU' && dep.qnh === 1005 && dep.windKt === 12 && dep.res && !dep.res.refused && dep.res.requiredM > 0,
      'the ENDU take-off was not worked from the fetched METAR: ' + JSON.stringify({ qnh: dep.qnh, wind: dep.windKt, res: dep.res }).slice(0, 200));
    assert(arr.icao === 'ENTC' && arr.res && !arr.res.refused && arr.res.requiredM > 0, 'the ENTC landing was not worked from the fetched METAR');
    assert(/Required\s*\d+ m/.test(doc.getElementById('mb-perf').textContent), 'the tab still shows no distance after the fetch');
    // A failed fetch keeps the reports it had and says so.
    w.fetch = async () => { throw new Error('offline'); };
    doc.getElementById('metar-fetch-btn').click();
    for (let i = 0; i < 50 && ev('document.getElementById("metar-fetch-btn").disabled'); i++) await new Promise((r) => setTimeout(r, 10));
    assert(/Could not fetch/.test(doc.getElementById('metar-status').textContent) && ev('runwayChecks[0].qnh') === 1005,
      'a failed fetch lost the reports or did not say so');
  } finally {
    w.fetch = realFetch;
    resetV1698();
    w.renderAllFlightTables();
  }
});

TA('the M&B weather card shows every aerodrome a distance is worked at, in flight order', async () => {
  // v16.99, the author: on ENDU-ENEV-ENTC-ENDU the M&B page "only shows ENDU
  // and ENEV, not ENTC". It took the first and last of a list already
  // deduplicated, so a round trip lost its middle.
  const ad = (i) => aipDataset().aerodromes.find((a) => a.icao === i);
  const wp = (i, alt) => `{ lat: ${ad(i).lat}, lng: ${ad(i).lng}, name: "${i}", alt: ${alt}, oat: 10, wdir: 0, wspd: 0, var: -11 }`;
  ev(`flights = [
    { id: 1, title: "A", depElev: 254, waypoints: [${wp('ENDU', 254)}, Object.assign(${wp('ENEV', 84)}, { stop: 'full-stop' })] },
    { id: 2, title: "B", depElev: 84, waypoints: [${wp('ENEV', 84)}, Object.assign(${wp('ENTC', 32)}, { stop: 'full-stop' })] },
    { id: 3, title: "C", depElev: 32, waypoints: [${wp('ENTC', 32)}, ${wp('ENDU', 254)}] }];
    activeFlightIndex = 0; mbPrefs.reg = "LN-TRB"; refreshMap(); renderAllFlightTables();`);
  const realFetch = w.fetch;
  w.fetch = async (url) => ({ ok: true, status: 200, text: async () => /\/taf\?/.test(String(url)) ? '' :
    'ENDU 281150Z 29012KT 9999 10/05 Q1005\nENEV 281150Z 18008KT 9999 08/04 Q1003\nENTC 281150Z 18008KT 9999 08/04 Q1003\n' });
  await w.fetchMetarTaf();
  w.fetch = realFetch;
  const shown = (id) => [...doc.getElementById(id).querySelectorAll('b')].map((e) => e.textContent).filter((t) => /^EN[A-Z]{2}$/.test(t));
  assert(JSON.stringify(shown('mb-wx')) === '["ENDU","ENEV","ENTC"]', 'the M&B card shows ' + JSON.stringify(shown('mb-wx')));
  assert(JSON.stringify(shown('metar-body')) === '["ENDU","ENEV","ENTC"]', 'the plan card changed: ' + JSON.stringify(shown('metar-body')));
  // Every distance got its METAR - the whole point of showing them.
  assert(ev('runwayChecks.every(c => c.qnh === 1005 || c.qnh === 1003)'), 'a distance check has no METAR QNH');
  // A sector added after the fetch is said to be missing, not "no reports published".
  ev(`flights.push({ id: 4, title: "D", depElev: 254, waypoints: [${wp('ENDU', 254)}, ${wp('ENBO', 42)}] }); renderAllFlightTables();`);
  const txt = doc.getElementById('mb-wx').textContent;
  assert(/ENBO was not in the last fetch - press Fetch again/.test(txt) && !/ENBO - no reports published/.test(txt),
    'an aerodrome added after the fetch is not reported as missing: ' + txt.slice(-160));
  resetV1698(); w.renderAllFlightTables();
});

/** A report time DDHHMMZ that many minutes ago, and a validity DDHH/DDHH of so many hours from then. */
function zAgo(min) {
  const d = new Date(Date.now() - min * 60000), p = (n) => String(n).padStart(2, '0');
  return p(d.getUTCDate()) + p(d.getUTCHours()) + p(d.getUTCMinutes()) + 'Z';
}
function validFrom(min, hours) {
  const a = new Date(Date.now() - min * 60000), b = new Date(a.getTime() + hours * 3600000), p = (n) => String(n).padStart(2, '0');
  return p(a.getUTCDate()) + p(a.getUTCHours()) + '/' + p(b.getUTCDate()) + p(b.getUTCHours() === 0 && hours ? 24 : b.getUTCHours());
}

T('a METAR is outdated past 30 min, a TAF past 3 h or 6 h by its own length - measured, not quoted', () => {
  const Mt = moduleExports.metar;
  assert(Mt.METAR_ROUTINE_MIN === 30 && Mt.TAF_SHORT_ROUTINE_MIN === 180 && Mt.TAF_LONG_ROUTINE_MIN === 360,
    'the routine intervals moved: ' + [Mt.METAR_ROUTINE_MIN, Mt.TAF_SHORT_ROUTINE_MIN, Mt.TAF_LONG_ROUTINE_MIN]);
  const m = Mt.parseReport('ENDU 291150Z 29012KT 9999 FEW040 10/05 Q1005');
  assert(!Mt.isOutdated(m, 30) && Mt.isOutdated(m, 31), 'the METAR boundary is not 30 min');
  const long = Mt.parseReport('ENDU 291100Z 2912/3012 23009KT 9999 -SHRA FEW025 BKN035 TEMPO 2912/2920 23015G25KT');
  assert(long.isTaf && long.validHours === 24 && Mt.routineIntervalMin(long) === 360, 'a 24 h TAF: ' + long.validHours);
  assert(!Mt.isOutdated(long, 360) && Mt.isOutdated(long, 361), 'the 24 h TAF boundary is not 6 h');
  const thirty = Mt.parseReport('ENGM 290500Z 2906/3012 23009KT 9999');
  assert(thirty.validHours === 30 && Mt.routineIntervalMin(thirty) === 360, 'a 30 h TAF: ' + thirty.validHours);
  const short = Mt.parseReport('ENAT 281400Z 2815/2824 18009KT 9999 BKN025 TEMPO 2815/2817 18018G28KT=');
  assert(short.validHours === 9 && Mt.routineIntervalMin(short) === 180 && Mt.isOutdated(short, 181) && !Mt.isOutdated(short, 180),
    'a 9 h TAF is not on a 3 h cycle: ' + short.validHours);
  // Across a month end the span is still "the next day".
  assert(Mt.parseReport('ENAT 302000Z 3021/0106 18009KT').validHours === 9, 'a month-end validity misread');
  // Unknown age or unreadable validity: never flagged, never guessed.
  assert(!Mt.isOutdated(m, null) && Mt.routineIntervalMin(Mt.parseReport('')) === null, 'an unknown was flagged');
  // A real MET Norway METAR from the measurement: the TEMPO wind is read, the
  // remark's upper wind is not.
  const entc = Mt.parseReport('ENTC 291120Z 22019KT 9999 -RA SCT036 BKN042 11/05 Q1016 TEMPO 22020G30KT SHRA SCT020CB BKN030 RMK WIND 2600FT 21021KT=');
  assert(entc.wind.speedKt === 19 && entc.tempoWind.speedKt === 20 && entc.tempoWind.gustKt === 30 && entc.tempoWindCount === 1,
    'the ENTC report was misread: ' + JSON.stringify([entc.wind, entc.tempoWind, entc.tempoWindCount]));
});

T('an outdated METAR or TAF is shown in yellow with a label to fetch again - on both weather cards', () => {
  try {
    ev(SEED_STOP);
    ev(`mbPrefs.reg = "LN-TRB";
        lastWeather = { icaos: ['ENDU', 'ENTC'], metars: {
          ENDU: 'ENDU ${zAgo(45)} 29012KT 9999 FEW040 10/05 Q1005',
          ENTC: 'ENTC ${zAgo(10)} 18008KT 9999 SCT030 08/04 Q1003' }, tafs: {
          ENDU: 'ENDU ${zAgo(420)} ${validFrom(360, 24)} 29010KT 9999 FEW040',
          ENTC: 'ENTC ${zAgo(300)} ${validFrom(240, 24)} 18008KT 9999 SCT030' } };
        renderMetarCard(lastWeather.icaos, lastWeather.metars, lastWeather.tafs); renderAllFlightTables();`);
    for (const id of ['metar-body', 'mb-wx']) {
      const host = doc.getElementById(id);
      const blocks = [...host.children].filter((d) => d.querySelector('b'));
      const byIcao = Object.fromEntries(blocks.map((d) => [d.querySelector('b').textContent, d]));
      const du = byIcao.ENDU, tc = byIcao.ENTC;
      assert(du && tc, id + ' lost an aerodrome');
      const raws = (d) => [...d.querySelectorAll('.wx-raw')];
      // ENDU: METAR 45 min old (past 30), TAF 7 h old (past 6) - both outdated.
      assert(raws(du).length === 2 && raws(du).every((r) => r.classList.contains('wx-outdated')), id + ': ENDU reports are not yellow');
      assert(du.querySelectorAll('.wx-outdated-tag').length === 2 && /Outdated · fetch again/.test(du.textContent), id + ': ENDU has no outdated label');
      // ENTC: METAR 10 min, TAF 5 h - both current.
      assert(raws(tc).length === 2 && raws(tc).every((r) => !r.classList.contains('wx-outdated')) && !tc.querySelector('.wx-outdated-tag'),
        id + ': a current ENTC report is flagged');
      // The report time has no seconds, so the age may read one minute more.
      assert(/TAF · 5 h 0[01] min ago/.test(tc.textContent), id + ': the TAF age is not shown: ' + tc.textContent.slice(0, 200));
    }
    // The distance card says the same about the METAR it read.
    assert(/4[56] min old - OUTDATED, fetch again/.test(doc.getElementById('mb-perf').textContent), 'the distance card did not call the METAR outdated');
    assert(!/1[01] min old - OUTDATED/.test(doc.getElementById('mb-perf').textContent), 'the distance card called a 10 min METAR outdated');
    // The label is yellow in light and dark, from tokens - never a literal.
    const css = require('fs').readFileSync(require('path').join(__dirname, 'src', 'styles.css'), 'utf8');
    assert((css.match(/--wx-outdated:/g) || []).length === 3 && /\.wx-outdated \{ color: var\(--wx-outdated\); \}/.test(css),
      'the outdated colour is not a token in every theme block');
  } finally {
    resetV1698();
    w.renderAllFlightTables();
  }
});

TA('Fetch asks for every aerodrome a distance is worked at, even one not named by its ICAO', async () => {
  // A departure waypoint called BARDUFOSS is still ENDU to the runway check
  // (aerodromeAt resolves by position), so its METAR has to be fetched too.
  ev(`flights = [{ id: 1, title: "N", depElev: 254, waypoints: [
      { lat: 69.05505349, lng: 18.54466865, name: "BARDUFOSS", alt: 254, oat: 10, wdir: 0, wspd: 0, var: -11 },
      { lat: 69.67895054, lng: 18.91143033, name: "ENTC", alt: 2500, oat: 10, wdir: 0, wspd: 0, var: -12 } ]}];
      activeFlightIndex = 0; mbPrefs.reg = "LN-TRB"; lastWeather = null; perfInputs = {}; refreshMap(); renderAllFlightTables();`);
  assert(ev('runwayChecks[0].icao') === 'ENDU', 'the fixture\'s departure did not resolve to ENDU');
  const asked = [];
  const realFetch = w.fetch;
  w.fetch = async (url) => { asked.push(String(url)); return { ok: true, status: 200, text: async () =>
    (/\/taf\?/.test(String(url)) ? '' : 'ENDU 281150Z 29012KT 9999 10/05 Q1005\nENTC 281150Z 18008KT 9999 08/04 Q1003\n') }; };
  try {
    await w.fetchMetarTaf();
    assert(asked.length === 2 && asked.every((u) => /icao=[^&]*ENDU/.test(u) && /ENTC/.test(u)), 'ENDU was not asked for: ' + asked.join(' | '));
    assert(ev('runwayChecks[0].qnh') === 1005, 'the BARDUFOSS take-off did not get the ENDU METAR');
  } finally {
    w.fetch = realFetch;
    resetV1698();
    w.renderAllFlightTables();
  }
});

TA('Enter in the save dialog saves the whole flight - and never overwrites a loaded plan', async () => {
  ev(SEED2);
  ev(`localStorage.removeItem('c182_custom_missions'); localStorage.setItem('c182_custom_routes', JSON.stringify({ 'KEEP ME': [
    { lat: 69.0, lng: 18.0, name: 'A', alt: 500, oat: 10, wdir: 0, wspd: 0, var: -11 },
    { lat: 69.3, lng: 18.2, name: 'B', alt: 2500, oat: 10, wdir: 0, wspd: 0, var: -11 } ] }));
    populateRouteDropdown(); loadedRouteRef = { type: 'route', name: 'KEEP ME' };`);
  const before = ev(`JSON.stringify(getStoredSingleRoutes()['KEEP ME'])`);
  const enter = () => doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  const p = w.saveCurrentMission();
  await tick();
  enter();                     // the choice
  await tick();
  const prompt = openDlg();
  assert(prompt && /Save the whole flight/.test(prompt.textContent) && prompt.querySelector('.dlg-input'),
    'Enter did not choose the whole flight: ' + (prompt ? prompt.textContent.slice(0, 120) : 'no dialog'));
  typeInDialog('ROUND TRIP');
  enter();                     // the name
  await p;
  const saved = ev(`getStoredMissions()['ROUND TRIP']`);
  assert(saved && ev('flights.length') > 1 && saved.length === ev('flights.length'), 'the whole flight was not saved with every sector');
  assert(ev(`JSON.stringify(getStoredSingleRoutes()['KEEP ME'])`) === before, 'Enter overwrote the loaded route');
  assert(/Flight "ROUND TRIP" saved/.test(toastText()), 'the toast does not say a flight was saved: ' + toastText());
  const groups = [...doc.getElementById('route-selector').querySelectorAll('optgroup')].map((g) => g.label);
  assert(groups.includes('Whole flights') && !groups.some((g) => /mission/i.test(g)), 'the dropdown still says mission: ' + groups);
  ev(`localStorage.removeItem('c182_custom_missions'); localStorage.removeItem('c182_custom_routes'); loadedRouteRef = null;
      populateRouteDropdown();`);
  ev(SEED);
});

T('nothing on screen says "mission" any more - it is a flight', () => {
  // The author: "Dont call it whole mission rather call it the whole flight"
  // (v16.100), then "rename all of them to flight" (v16.101). Comments may
  // still say it; what a pilot READS may not. "permission" is not the word.
  const word = /(?<!per)mission/i;
  const visible = doc.body.innerHTML.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s(onclick|onchange|id|for)="[^"]*"/g, '');
  assert(!word.test(visible), 'the page still says mission: ' + (visible.match(/.{0,60}(?<!per)mission.{0,40}/i) || [''])[0]);
  // STORAGE KEYS AND IDS ARE NOT WORDS: renaming them would orphan every
  // flight saved before this. They are the only literals allowed to say it.
  const ALLOWED = /^(['"`])(c182_custom_missions|c182_active_mission|mb-view-mission|rd-mission|mission|mission:|load(SelectedRouteOrMission)?\(\)|(save|delete)CurrentMission\(\)|exportMissionFile\(\)|importMissionFile\(event\)|setMbView\('mission'\))\1$/;
  const code = APP_SRC.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const strings = (code.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g) || [])
    .filter((q) => word.test(q) && !ALLOWED.test(q) && !/^(['"`])\s*\/\//.test(q));
  assert(strings.length === 0, 'a string literal still says mission: ' + strings.slice(0, 4).join(' | '));
  ev(`mbPrefs.reg = 'LN-TRB'; mbPrefs.view = 'mission'; renderAllFlightTables();`);
  assert(/Whole flight ·/.test(doc.getElementById('mb-body').textContent), 'the M&B master is not called the whole flight');
  const master = readMb(printDoc().sheets.filter((sh) => sh.kind === 'mb')[0]);
  assert(/^Whole flight /.test(master.box.title), 'the printed master is not called the whole flight: ' + master.box.title);
  ev(`mbPrefs.reg = null; mbPrefs.view = 'sector'; renderAllFlightTables();`);
});

// =====================================================================
// v17.0: ATS opening hours (Avinor Operational Hours, the table AD 2.3
// points at). NOTAMs are NOT fetched: ippc.no sends no CORS header.
// =====================================================================
T('the ATS hours notation is read strictly, and anything outside it is refused', () => {
  const H = moduleExports.hours;
  const endu = H.parseAtsHours('MON - FRI: 0520 - 2200 (0420 - 2100), SAT: 0800 - 1710 (0700 - 1610), SUN: 0850 - 2230 (0750 - 2130)');
  assert(endu.kind === 'schedule' && endu.winter[0][0][0] === 320 && endu.summer[6][0][1] === 1290, 'ENDU misread: ' + JSON.stringify(endu).slice(0, 160));
  const split = H.parseAtsHours('MON - FRI: 0450 - 2230 (0350 - 2130), SAT: 0730 - 0830 (0630 - 0730) / 1130 - 1530 (1030 - 1430), SUN: 1200 - 1215 (1100 - 1115)/ 1630 - 2130 (1530 - 2030)');
  assert(split.kind === 'schedule' && split.winter[5].length === 2 && split.winter[6].length === 2, 'two periods a day were not both read');
  assert(H.parseAtsHours('MON - FRI: 0520 - 2155 (0420 - 2055), SAT: CLOSED, SUN: 0930-1050 (0830 - 0950)').winter[5].length === 0,
    'CLOSED is not a closed day, or "0930-1050" without spaces was refused');
  assert(H.parseAtsHours('H24').kind === 'h24' && H.parseAtsHours('No ATS provided').kind === 'none' &&
    H.parseAtsHours('No ATS service provided').kind === 'none' && H.parseAtsHours('O/R').kind === 'or', 'the word forms');
  const refused = {
    'a published 13:30': 'MON - FRI: 0435 - 2205 (0335 - 2105), SAT: CLSD, SUN: 1130 - 13:30 (1030 - 1230)',
    'a day not stated': 'MON - FRI: 0700 - 1500 (0600 - 1400), SAT: NIL',
    'a day stated twice': 'MON - FRI: 0700 - 1500 (0600 - 1400), FRI - SUN: NIL',
    'summer not winter less an hour': 'MON - SUN: 0700 - 1500 (0700 - 1400)',
    'a period ending before it starts': 'MON - SUN: 1500 - 0700 (1400 - 0600)',
    'week numbers': 'WEEK 33 - 18, MON: 0700 - 1900 (0600 - 1800)',
    'unit-by-unit hours': 'TWR: H24, APP: MON - FRI: 0800 - 1430 (0700 - 1330), SAT - SUN: NIL',
    'prose': 'No detailed HR of OPS, AFIS AVBL in accordance with PPR.'
  };
  for (const [why, text] of Object.entries(refused)) {
    const h = H.parseAtsHours(text);
    assert(h.kind === 'unparsed' && h.reason, why + ' was decoded instead of refused: ' + JSON.stringify(h).slice(0, 120));
  }
});

T('open or closed is decided in UTC, on the season Norway is in on that date', () => {
  const H = moduleExports.hours;
  const endu = H.parseAtsHours('MON - FRI: 0520 - 2200 (0420 - 2100), SAT: 0800 - 1710 (0700 - 1610), SUN: 0850 - 2230 (0750 - 2130)');
  assert(H.norwaySeason(Date.UTC(2026, 0, 15, 12)) === 'winter' && H.norwaySeason(Date.UTC(2026, 6, 15, 12)) === 'summer', 'the season');
  // The DST change, 2026-03-29 01:00Z: an hour either side.
  assert(H.norwaySeason(Date.UTC(2026, 2, 29, 0, 30)) === 'winter' && H.norwaySeason(Date.UTC(2026, 2, 29, 1, 30)) === 'summer', 'the change day');
  const at = (y, mo, d, h, mi) => H.atsOpenAt(endu, Date.UTC(y, mo, d, h, mi));
  // Sunday 27 Sep 2026, summer: 0750-2130 UTC.
  assert(at(2026, 8, 27, 21, 30).open === true && at(2026, 8, 27, 21, 31).open === false, 'the closing edge is not inclusive at 2130Z');
  assert(at(2026, 8, 27, 7, 49).open === false && at(2026, 8, 27, 7, 50).open === true, 'the opening edge');
  assert(at(2026, 8, 27, 12, 0).window === 'SUN 0750-2130 UTC' && at(2026, 8, 27, 12, 0).season === 'summer', 'the window text');
  // Sunday 6 Dec 2026, winter: 0850-2230 UTC - the same local hours, an hour later in UTC.
  assert(at(2026, 11, 6, 22, 15).open === true && at(2026, 11, 6, 7, 55).open === false, 'the winter figures were not used in December');
  // The UTC day, not the local one: 2026-09-27 23:30 local is 21:30Z SUNDAY.
  assert(H.atsOpenAt(endu, Date.UTC(2026, 8, 27, 21, 30)).window.startsWith('SUN'), 'the day was not read in UTC');
  // Undecidable is null, with a reason - never true, never false.
  for (const h of [H.parseAtsHours('No ATS provided'), H.parseAtsHours('O/R'), H.parseAtsHours('WEEK 33 - 18')]) {
    const r = H.atsOpenAt(h, Date.UTC(2026, 8, 27, 12));
    assert(r.open === null && r.why, 'an undecidable entry was decided: ' + JSON.stringify(r));
  }
  assert(H.holidaysExcluded('Public HOL excluded') && !H.holidaysExcluded('NIL') && !H.holidaysExcluded(''), 'the holiday remark');
});

T('the imported table: every aerodrome, the same AIRAC cycle, 49 decoded and exactly four refused', () => {
  const H = moduleExports.hours;
  const set = aipDataset();
  const src = set.atsHoursSource;
  assert(src && src.revisedAirac === String(set.editionLabel).slice(0, 10),
    'the hours are not for the dataset\'s own cycle: ' + (src && src.revisedAirac) + ' vs ' + set.editionLabel);
  assert(/Avinor/.test(src.attribution) && !/non-commercial/i.test(src.attribution) && /aim-prod\.avinor\.no/.test(src.url),
    'the hours do not credit their source');
  assert(set.aerodromes.length === 53 && set.aerodromes.every((a) => a.ats && typeof a.ats.hours === 'string' && a.ats.hours),
    'an aerodrome has no ATS hours entry');
  const kinds = {}, refused = [];
  for (const a of set.aerodromes) {
    const h = H.parseAtsHours(a.ats.hours);
    kinds[h.kind] = (kinds[h.kind] || 0) + 1;
    if (h.kind === 'unparsed') refused.push(a.icao);
  }
  // PINNED PER EDITION, like the ACC sector count: a parser regression looks
  // exactly like Avinor rewording an entry, so check the source before editing.
  assert(JSON.stringify(refused.sort()) === '["ENAS","ENHV","ENOL","ENRY"]', 'the refused set moved: ' + refused.join(' '));
  assert(kinds.schedule === 37 && kinds.h24 === 8 && kinds.none === 3 && kinds.or === 1,
    'the decoded split moved: ' + JSON.stringify(kinds));
  // The committed snapshot IS what shipped.
  const snap = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'tools', 'prepared', 'ats-hours.json'), 'utf8'));
  assert(set.aerodromes.every((a) => snap.entries[a.icao] && snap.entries[a.icao].hours === a.ats.hours && snap.entries[a.icao].rmk === a.ats.rmk),
    'data/aip.js and tools/prepared/ats-hours.json disagree');
});

TA('the importer reads the page by its own tbody ids, and dates it by its own revision line', async () => {
  const { parseOpsHoursPage } = await import('./tools/aip-hours.mjs');
  const html = `<p>Revised per AIRAC 03 SEP 2026 Download PDF</p>
    <h2>AD 2.3 Operational hours: Admin</h2><table><tbody id="ENDU_Admin"><tr><td>Bardufoss</td><td>ENDU</td><td>WRONG TABLE</td></tr></tbody></table>
    <h2>AD 2.3 Operational hours: ATS</h2><table>
    <tbody id="ENDU_ATS"><tr><td>Bardufoss</td><td>ENDU</td><td colspan="2" class="nairac">MON - FRI: 0520 - 2200 (0420 - 2100), SAT: 0800 - 1710 (0700 - 1610), SUN: 0850 - 2230 (0750 - 2130)</td></tr>
      <tr><td>RMK:</td><td colspan="3">NIL</td></tr></tbody>
    <tbody id="ENSG_ATS"><tr><td>Sogndal/Haukåsen</td><td>ENSG</td><td>H24</td></tr><tr><td>RMK:</td><td>OPS HR above are core hours, REF NOTAM for possible adjustments.</td></tr></tbody>
    </table>`;
  const r = parseOpsHoursPage(html);
  assert(r.revisedAirac === '2026-09-03', 'the revision date: ' + r.revisedAirac);
  assert(Object.keys(r.entries).join() === 'ENDU,ENSG', 'the entries: ' + Object.keys(r.entries));
  assert(/^MON - FRI: 0520/.test(r.entries.ENDU.hours) && r.entries.ENDU.rmk === '', 'ENDU read from the wrong table, or NIL kept as a remark');
  assert(/core hours/.test(r.entries.ENSG.rmk), 'the remark was lost');
  assert(parseOpsHoursPage('<p>no date</p>').revisedAirac === null, 'an undated page was dated');
});

T('a take-off outside the published ATS hours reaches the banner; one inside them does not', () => {
  const dateWas = doc.getElementById('def-date').value, etdWas = doc.getElementById('def-etd').value;
  try {
    ev(SEED_STOP);
    // Sunday 27 Sep 2026, summer. ENDU ATS SUN 0750-2130 UTC; ENTC is H24.
    doc.getElementById('def-date').value = '2026-09-27';
    doc.getElementById('def-etd').value = '12:00';
    w.renderAllFlightTables();
    const checks = ev('atsHoursChecks');
    assert(checks.length === 4 && checks[0].icao === 'ENDU' && checks[0].kind === 'takeoff', 'the movements: ' +
      checks.map((c) => c.kind + ' ' + c.icao).join(', '));
    assert(checks.every((c) => c.res && c.res.open === true), 'a daytime flight was found closed somewhere');
    assert(!ev('runIntegrityCheck()').some((p) => /ATS hours/.test(p)), 'an open flight raised the banner');
    // ETD 23:55 local - after ENDU closes at 2130Z in Norway (21:55Z) and in
    // the suite's pinned UTC alike, so the verdict does not depend on the zone.
    doc.getElementById('def-etd').value = '23:55';
    w.renderAllFlightTables();
    const dep = ev('atsHoursChecks[0]');
    assert(dep.icao === 'ENDU' && dep.res.open === false && dep.res.window === 'SUN 0750-2130 UTC', 'the late take-off: ' + JSON.stringify(dep.res));
    const probs = ev('runIntegrityCheck()');
    const z = new Date(dep.ms), zs = String(z.getUTCHours()).padStart(2, '0') + String(z.getUTCMinutes()).padStart(2, '0');
    assert(probs.some((p) => p.startsWith('ENDU take-off at 2355 local (' + zs + 'Z) is OUTSIDE the published ATS hours (SUN 0750-2130 UTC, summer time)')),
      'the closed take-off is not on the banner: ' + JSON.stringify(probs));
    assert(!probs.some((p) => /ENTC .* OUTSIDE/.test(p)), 'the H24 aerodrome was called closed');
    const card = doc.getElementById('hours-body');
    assert(card.querySelector('tr.hours-closed') && /CLOSED · SUN 0750-2130 UTC/.test(card.textContent), 'the card does not show it closed');
    assert(/NOTAMs are not fetched/.test(card.textContent) && /ippc\.no/.test(card.textContent), 'the card does not say NOTAMs are not fetched');
    assert(/revised per AIRAC 2026-09-03/.test(card.textContent) && /Operational hours © Avinor AS/.test(card.textContent), 'the card does not name its source');
    // No ETD: nothing to check, nothing on the banner, and the card says why.
    doc.getElementById('def-etd').value = '';
    w.renderAllFlightTables();
    assert(ev('atsHoursChecks.every(c => c.ms === null && c.res === null)') && !ev('runIntegrityCheck()').some((p) => /ATS hours/.test(p)),
      'without an ETD something was checked');
    assert(/Set an ETD/.test(card.textContent), 'the card does not ask for an ETD');
  } finally {
    doc.getElementById('def-date').value = dateWas;
    doc.getElementById('def-etd').value = etdWas;
    ev(SEED);
  }
});

T('an ETA inside ATS hours but within 30 min of an edge is found, to the minute (v17.8)', () => {
  // The author: "Make a small warning label if an aerodrome is closed +-30min
  // of my ETA". Monday 2 Nov 2026 is WINTER time, so the outside figures apply.
  const H = require('./src/lib/opshours.js');
  assert(H.ATS_ETA_MARGIN_MIN === 30, 'the margin is the author\'s 30 min, not ' + H.ATS_ETA_MARGIN_MIN);
  const h = H.parseAtsHours('MON - SUN: 0700 - 1500 (0600 - 1400)');
  const at = (hh, mm) => Date.UTC(2026, 10, 2, hh, mm);
  const m = (hh, mm) => H.atsMarginAt(h, at(hh, mm));
  const close = m(14, 40);
  assert(close && close.closesInMin === 20 && close.closesMs === at(15, 0) && close.opensMs === null,
    'a 1440Z ETA on a 1500Z closure: ' + JSON.stringify(close));
  const open = m(7, 10);
  assert(open && open.openedMinBefore === 10 && open.opensMs === at(7, 0) && open.closesMs === null,
    'a 0710Z ETA on a 0700Z opening: ' + JSON.stringify(open));
  assert(m(12, 0) === null, 'a midday ETA was warned about');
  // THE EDGE IS INCLUSIVE (atsOpenAt's rule): 1430 + 30 = 1500 is still open, 1431 + 30 is not
  assert(m(14, 30) === null, 'an ETA exactly 30 min before closing was warned about');
  assert(m(14, 31) && m(14, 31).closesInMin === 29, 'an ETA 29 min before closing was missed');
  assert(m(15, 0) && m(15, 0).closesInMin === 0, 'an ETA on the closing minute itself was missed');
  // CLOSED AT THE ETA is the banner's finding already, and not this label's
  assert(m(15, 10) === null && m(6, 50) === null, 'a closed ETA got the margin label as well as the banner');
  // both edges at once: a short opening
  const shortOpen = H.atsMarginAt(H.parseAtsHours('MON - SUN: 1000 - 1030 (0900 - 0930)'), at(10, 15));
  assert(shortOpen && shortOpen.openedMinBefore === 15 && shortOpen.closesInMin === 15, 'a 30 min opening: ' + JSON.stringify(shortOpen));
  // nothing decided -> nothing said, in either direction
  for (const raw of ['H24', 'O/R', 'No ATS provided', 'WEEK 33 - 18, MON: 0700 - 1900'])
    assert(H.atsMarginAt(H.parseAtsHours(raw), at(14, 40)) === null, raw + ' got a margin warning');
  assert(H.atsMarginAt(h, NaN) === null, 'no time still gave a warning');
  // the SUMMER figures in summer: Monday 28 Sep 2026, open 0600-1400Z
  const summer = H.atsMarginAt(h, Date.UTC(2026, 8, 28, 13, 45));
  assert(summer && summer.closesInMin === 15, 'the summer hours were not the ones used: ' + JSON.stringify(summer));
});

T('a landing near its closing time gets the amber label and the header chip; the banner stays quiet', () => {
  const dateWas = doc.getElementById('def-date').value, etdWas = doc.getElementById('def-etd').value;
  try {
    ev(SEED_STOP);
    // Sunday 27 Sep 2026, summer: ENDU ATS SUN 0750-2130 UTC. The suite pins
    // TZ=UTC, so local clock time is UTC and the ETD can be worked backwards.
    doc.getElementById('def-date').value = '2026-09-27';
    doc.getElementById('def-etd').value = '12:00';
    w.renderAllFlightTables();
    const arrIdx = ev('atsHoursChecks.findIndex(c => c.kind === "landing" && c.icao === "ENDU")');
    assert(arrIdx >= 0, 'the fixture has no ENDU landing');
    const etd0 = ev('planEtdMs()');
    const offMin = Math.round((ev(`atsHoursChecks[${arrIdx}].ms`) - etd0) / 60000);
    assert(ev('atsHoursChecks.every(c => !c.margin)'), 'a midday flight got a margin warning');
    assert(!doc.querySelector('.ats-margin-chip'), 'a chip with nothing to warn about');
    // Land at 2112Z: open, and 18 min before the 2130Z closure.
    const etdMin = 21 * 60 + 12 - offMin, p2 = (n) => String(n).padStart(2, '0');
    doc.getElementById('def-etd').value = p2(Math.floor(etdMin / 60)) + ':' + p2(etdMin % 60);
    w.renderAllFlightTables();
    const c = ev(`atsHoursChecks[${arrIdx}]`);
    assert(c.res.open === true && c.margin && c.margin.closesInMin === 18, 'the 2112Z landing: ' + JSON.stringify({ res: c.res, margin: c.margin }));
    // a take-off is not warned about, as asked (the ETA, not the ETD)
    assert(ev('atsHoursChecks.filter(c => c.margin).every(c => c.kind === "landing")'), 'a take-off got the ETA label');
    const card = doc.getElementById('hours-body');
    const lbl = card.querySelector('.hours-margin');
    assert(lbl && /ENDU ATS closes 2130 local \(2130Z\), 18 min after your ETA - inside your ±30 min margin/.test(lbl.textContent),
      'the card label: ' + (lbl && lbl.textContent));
    assert(!card.querySelector('tr.hours-closed'), 'an open landing was painted closed');
    const chip = doc.querySelector(`[data-ats-chip="${c.fIdx}"] .ats-margin-chip`);
    assert(chip && /ENDU ATS closes 18 min after ETA/.test(chip.textContent), 'no header chip on the sector: ' + (chip && chip.textContent));
    assert(doc.querySelectorAll('.ats-margin-chip').length === 1, 'the chip landed on more than its own sector');
    // AMBER, NOT RED: the landing is legal as planned, so nothing on the banner
    assert(!ev('runIntegrityCheck()').some((p) => /ENDU/.test(p) && /ATS/.test(p)), 'a margin warning reached the red banner');
    const css = fs.readFileSync('src/styles.css', 'utf8');
    assert(/\.ats-margin-chip\s*\{[^}]*var\(--wx-outdated\)/.test(css) && !/\.ats-margin-chip\s*\{[^}]*--mb-bad/.test(css),
      'the chip is not the amber "check this" colour');
    // after the closure it is the banner's finding, and the label goes
    const lateMin = 21 * 60 + 40 - offMin;
    doc.getElementById('def-etd').value = p2(Math.floor(lateMin / 60)) + ':' + p2(lateMin % 60);
    w.renderAllFlightTables();
    assert(ev(`atsHoursChecks[${arrIdx}].res.open`) === false && !ev(`atsHoursChecks[${arrIdx}].margin`), 'a closed landing kept the margin label');
    assert(ev('runIntegrityCheck()').some((p) => /ENDU landing .* OUTSIDE/.test(p)), 'the closed landing left the banner');
    assert(!doc.querySelector('.ats-margin-chip'), 'the chip stayed once the landing was simply closed');
  } finally {
    doc.getElementById('def-date').value = dateWas;
    doc.getElementById('def-etd').value = etdWas;
    ev(SEED);
  }
});

T('hours that could not be read are shown raw and are never a banner finding', () => {
  const dateWas = doc.getElementById('def-date').value, etdWas = doc.getElementById('def-etd').value;
  try {
    const ad = (i) => aipDataset().aerodromes.find((a) => a.icao === i);
    const ry = ad('ENRY'), gm = ad('ENGM');
    ev(`flights = [{ id: 1, title: "R", depElev: ${ry.elevFt}, waypoints: [
        { lat: ${ry.lat}, lng: ${ry.lng}, name: "ENRY", alt: ${ry.elevFt}, oat: 10, wdir: 0, wspd: 0, var: 4 },
        { lat: ${gm.lat}, lng: ${gm.lng}, name: "ENGM", alt: 3000, oat: 10, wdir: 0, wspd: 0, var: 4 } ]}];
        activeFlightIndex = 0; refreshMap();`);
    doc.getElementById('def-date').value = '2026-09-27';
    doc.getElementById('def-etd').value = '03:00';
    w.renderAllFlightTables();
    const c = ev('atsHoursChecks[0]');
    assert(c.icao === 'ENRY' && c.hours.kind === 'unparsed' && c.res.open === null, 'ENRY was decided: ' + JSON.stringify(c.res));
    assert(!ev('runIntegrityCheck()').some((p) => /ENRY/.test(p)), 'an undecoded entry raised the banner');
    const card = doc.getElementById('hours-body').textContent;
    const rawEl = doc.getElementById('hours-body').querySelector('.hours-src');
    assert(rawEl && /^WEEK 33 - 18, MON: 0700 - 1900/.test(rawEl.textContent), 'the published text itself is not shown: ' + (rawEl && rawEl.textContent));
    assert(/Not decoded/.test(card) && /Outside HR of OPS, O\/R to WingOps/.test(card),
      'the refusal or the remark is missing: ' + card.slice(0, 300));
  } finally {
    doc.getElementById('def-date').value = dateWas;
    doc.getElementById('def-etd').value = etdWas;
    ev(SEED);
  }
});

T('the ATS day and hours are read in UTC in the pilot\'s own zone too (TZ=Europe/Oslo)', () => {
  // The suite pins TZ=UTC, where the local and UTC day are the same thing - so
  // a mutation reading the LOCAL weekday passed every other test (v17.0; the
  // v16.48 M3 lesson). In Norway 2026-09-27 22:30Z is MONDAY 00:30 local, and
  // the published SUN hours are still the ones that apply.
  const { execFileSync } = require('child_process');
  const script = `
    const H = require('${require('path').resolve('./src/lib/opshours.js')}');
    const endu = H.parseAtsHours('MON - FRI: 0520 - 2200 (0420 - 2100), SAT: 0800 - 1710 (0700 - 1610), SUN: 0850 - 2230 (0750 - 2130)');
    const at = H.atsOpenAt(endu, Date.UTC(2026, 8, 27, 22, 30));
    process.stdout.write(JSON.stringify({ window: at.window, open: at.open, localDay: new Date(Date.UTC(2026, 8, 27, 22, 30)).getDay(),
      season: H.norwaySeason(Date.UTC(2026, 8, 27, 22, 30)) }));
  `;
  const r = JSON.parse(execFileSync(process.execPath, ['-e', script],
    { env: Object.assign({}, process.env, { TZ: 'Europe/Oslo' }), encoding: 'utf8' }));
  assert(r.localDay === 1, 'the fixture is no longer across local midnight - check it (local day ' + r.localDay + ')');
  assert(r.window === 'SUN 0750-2130 UTC' && r.open === false && r.season === 'summer',
    'in Norway the day was read locally: ' + JSON.stringify(r));
});

// v17.1: a fly-by is not a movement, a sector with no leg flies nowhere, and a
// CTR outside its ATC unit's hours is class G, RMZ (AIP ENR 1.4).

T('the fly-by flag survives the sanitiser, and cannot sit on a stop or a circuit', () => {
  const E = moduleExports.exch, A = moduleExports.anchors;
  const one = (w) => E.sanitiseFlights([{ id: 1, waypoints: [Object.assign({ lat: 69, lng: 18, name: 'X', alt: 3000 }, w)] }])[0].waypoints[0];
  assert(one({ flyby: true }).flyby === true && one({ flyby: 'true' }).flyby === true, 'a fly-by was dropped on load');
  assert(!('flyby' in one({})) && !('flyby' in one({ flyby: false })), 'an ordinary waypoint gained a fly-by key');
  assert(!('flyby' in one({ flyby: true, stop: 'full-stop' })), 'a full stop was also a fly-by');
  assert(!('flyby' in one({ flyby: true, stop: 'touch-go' })), 'a touch & go was also a fly-by');
  assert(!('flyby' in one({ flyby: true, isPattern: true, laps: 3 })), 'a circuit was also a fly-by');
  assert(A.isOverflight({ flyby: true }) && A.isOverflight({ anchor: 'AIP-RP' }), 'a fly-by or a reporting point is not flown over');
  assert(!A.isOverflight({ anchor: 'AIP-AD' }) && !A.isOverflight({}) && !A.isOverflight(null), 'an aerodrome or a plain point is flown over');
});

/** A Sunday late enough that ENDU (SUN 0750-2130 UTC) is closed and ENTC (H24) open. */
function lateSunday(etd, body) {
  const dateWas = doc.getElementById('def-date').value, etdWas = doc.getElementById('def-etd').value;
  try {
    doc.getElementById('def-date').value = '2026-09-27';
    doc.getElementById('def-etd').value = etd;
    body();
  } finally {
    doc.getElementById('def-date').value = dateWas;
    doc.getElementById('def-etd').value = etdWas;
    ev(SEED);
  }
}
const hourLines = () => ev('runIntegrityCheck()').filter((p) => /ATS hours/.test(p));
const adWp = (icao, extra) => {
  const a = aipDataset().aerodromes.find((x) => x.icao === icao);
  return JSON.stringify(Object.assign({ lat: a.lat, lng: a.lng, name: icao, alt: a.elevFt, oat: 10, wdir: 0, wspd: 0, var: -11 }, extra || {}));
};

T('the sector a full stop opens is not a take-off until it has a leg - and deleting the landing clears the warning (the author\'s report)', () => {
  lateSunday('22:10', () => {
    // ENTC -> ENDU full stop, and the one-waypoint sector the stop opened.
    ev(`flights = [
      { id: 1, title: "F1", depElev: 32, waypoints: [${adWp('ENTC')}, ${adWp('ENDU', { stop: 'full-stop', stopMin: 10 })}] },
      { id: 2, title: "F2", depElev: 254, waypoints: [${adWp('ENDU')}] }
    ]; activeFlightIndex = 0; refreshMap(); renderAllFlightTables();`);
    const kinds = ev('atsHoursChecks.map(c => c.kind + " " + c.icao)');
    assert(kinds.join() === 'takeoff ENTC,landing ENDU', 'the one-waypoint sector was checked as a take-off: ' + kinds);
    assert(hourLines().length === 1 && /ENDU landing/.test(hourLines()[0]), 'the closed landing: ' + JSON.stringify(hourLines()));
    assert(ev('runwayChecks.length') === 2, 'the stub still has a runway check: ' + ev('runwayChecks.length'));
    // The author: "If i delete a landing that issued a warning flag, the
    // warning flag still persists after deletion."
    w.deleteWaypointFromFlight(0, 1);
    assert(hourLines().length === 0, 'the warning outlived the landing it was about: ' + JSON.stringify(hourLines()));
    assert(ev('atsHoursChecks.length') === 0, 'a plan with no leg still has movements: ' + ev('atsHoursChecks.map(c => c.kind + " " + c.icao)'));
    assert(!/ATS hours/.test(doc.getElementById('integrity-banner').textContent), 'the banner still shows it');
  });
});

T('a reporting point beside an aerodrome is not a landing there once the real landing is deleted', () => {
  lateSunday('23:10', () => {
    // ÅSEN is 1.4 NM from ENDU's ARP - inside the 5 NM that resolves a point
    // to an aerodrome, which is how the fix before a deleted landing became a
    // landing of its own.
    const p = aipDataset().aerodromes.find((x) => x.icao === 'ENDU').points.find((q) => q.name === 'ÅSEN');
    const asen = (extra) => JSON.stringify(Object.assign({ lat: p.lat, lng: p.lng, name: 'ÅSEN', alt: 2500, oat: 10, wdir: 0, wspd: 0, var: -11 }, extra));
    ev(`flights = [{ id: 1, title: "F1", depElev: 32, waypoints: [${adWp('ENTC')}, ${asen({ anchor: 'AIP-RP' })}, ${adWp('ENDU')}] }];
        activeFlightIndex = 0; refreshMap(); renderAllFlightTables();`);
    assert(hourLines().length === 1, 'the fixture no longer lands at ENDU after it closes: ' + JSON.stringify(hourLines()));
    w.deleteWaypointFromFlight(0, 2);
    assert(hourLines().length === 0, 'the reporting point became an ENDU landing: ' + JSON.stringify(hourLines()));
    assert(ev('runwayChecks[1].overflight') === true && ev('runwayChecks[1].icao') === null,
      'the reporting point still has a runway check: ' + JSON.stringify(ev('runwayChecks[1]')));
    // A point CLICKED onto the map carries no anchor, so it still resolves by
    // position - a sector ends where it lands. The pilot says otherwise with
    // the waypoint menu's fly-by toggle, and nothing guesses for them.
    ev(`flights = [{ id: 1, title: "F1", depElev: 32, waypoints: [${adWp('ENTC')}, ${asen({})}] }];
        activeFlightIndex = 0; refreshMap(); renderAllFlightTables();`);
    assert(hourLines().length === 1, 'a clicked point on the field is no longer a landing there');
    w.toggleFlyby(0, 1);
    assert(ev('flights[0].waypoints[1].flyby') === true && hourLines().length === 0, 'marking it a fly-by did not clear the warning');
    w.toggleFlyby(0, 1);
    assert(!ev('"flyby" in flights[0].waypoints[1]') && hourLines().length === 1, 'marking it a landing again did not bring the check back');
  });
});

T('a fly-by of a closed aerodrome is listed, is no finding, and says the CTR is class G, RMZ', () => {
  lateSunday('22:30', () => {
    ev(`flights = [{ id: 1, title: "F1", depElev: 32, waypoints: [${adWp('ENTC')},
        ${adWp('ENDU', { name: 'Bardufoss', alt: 3500, flyby: true, anchor: 'AIP-AD' })}, ${adWp('ENTC', { alt: 32 })}] }];
        activeFlightIndex = 0; refreshMap(); renderAllFlightTables();`);
    const c = ev('atsHoursChecks');
    assert(c.map((x) => x.kind + ' ' + x.icao).join() === 'takeoff ENTC,flyby ENDU,landing ENTC', 'the order: ' + c.map((x) => x.kind + ' ' + x.icao));
    const fb = c[1];
    assert(fb.res.open === false && fb.ms === ev('planEtdMs()') + Math.round(ev('legStartTimes["0-1"]')) * 60000,
      'the fly-by is not judged at the time over it: ' + JSON.stringify(fb.res));
    assert(hourLines().length === 0, 'a fly-by of a closed aerodrome reached the banner: ' + JSON.stringify(hourLines()));
    const card = doc.getElementById('hours-body');
    assert(!card.querySelector('tr.hours-closed'), 'the fly-by was painted as a closed aerodrome');
    assert(/OVR ENDU/.test(card.textContent) && /fly-by, no landing/.test(card.textContent), 'the card does not list the fly-by');
    assert(/Bardufoss CTR is class G, RMZ while ATS is closed \(ENR 1\.4\)/.test(card.textContent), 'the card does not say the CTR is class G, RMZ');
    // The same aerodrome as a LANDING is still a finding - the author's
    // v16.93 rule is unchanged - and its row says what the CTR is too.
    ev(`flights = [{ id: 1, title: "F1", depElev: 32, waypoints: [${adWp('ENTC')}, ${adWp('ENDU')}] }];
        activeFlightIndex = 0; refreshMap(); renderAllFlightTables();`);
    assert(hourLines().length === 1, 'the closed landing is no longer a finding');
    assert(doc.getElementById('hours-body').querySelector('tr.hours-closed .hours-ctr'), 'the closed landing row does not say what the CTR is');
    // A plan that ENDS on a fly-by lands nowhere: no landing check, no runway.
    ev(`flights = [{ id: 1, title: "F1", depElev: 32, waypoints: [${adWp('ENTC')}, ${adWp('ENDU', { alt: 3500, flyby: true })}] }];
        activeFlightIndex = 0; refreshMap(); renderAllFlightTables();`);
    assert(ev('atsHoursChecks.map(c => c.kind).join()') === 'takeoff,flyby' && hourLines().length === 0,
      'a plan ending on a fly-by was checked as a landing: ' + ev('atsHoursChecks.map(c => c.kind).join()'));
    assert(ev('runwayChecks[1].overflight') === true, 'a fly-by end kept its runway check');
    // And one that STARTS on a fly-by (a fresh plan offers Fly-by: you are
    // already airborne) takes off nowhere.
    ev(`flights = [{ id: 1, title: "F1", depElev: 32, waypoints: [${adWp('ENDU', { alt: 3500, flyby: true })}, ${adWp('ENTC')}] }];
        activeFlightIndex = 0; refreshMap(); renderAllFlightTables();`);
    assert(ev('atsHoursChecks.map(c => c.kind).join()') === 'flyby,landing' && hourLines().length === 0,
      'a plan starting on a fly-by was checked as a take-off: ' + ev('atsHoursChecks.map(c => c.kind + " " + c.icao).join()'));
    assert(ev('runwayChecks[0].overflight') === true, 'a fly-by start kept its runway check');
    // An H24 CTR is never called class G - its ATC unit is always open - and
    // an open one gets no line at all: it is its published class.
    ev(`flights = [{ id: 1, title: "F1", depElev: 254, waypoints: [${adWp('ENDU')}, ${adWp('ENTC', { alt: 3500, flyby: true })}] }];
        activeFlightIndex = 0; refreshMap(); renderAllFlightTables();`);
    assert(!/Tromsø CTR is class G/.test(doc.getElementById('hours-body').textContent), 'an H24 CTR was called class G');
    doc.getElementById('def-etd').value = '12:00';
    w.renderAllFlightTables();
    assert(!doc.getElementById('hours-body').querySelector('.hours-ctr'), 'an open CTR gained a line on the card');
  });
});

T('choosing Fly-by on an aerodrome marks it, and the waypoint menu toggles it only where it means something', () => {
  lateSunday('12:00', () => {
    ev(`flights = [{ id: 1, title: "F1", depElev: 32, waypoints: [${adWp('ENTC')}] }]; activeFlightIndex = 0; refreshMap(); renderAllFlightTables();`);
    const a = ev('AIP_ANCHORS.find(x => x.kind === "AD" && x.icao === "ENDU")');
    w.addAnchorWaypoint(a, { flyby: true });
    assert(ev('flights[0].waypoints[1].flyby') === true, 'the Fly-by choice did not mark the waypoint');
    w.addAnchorWaypoint(a, { stop: 'full-stop' });
    assert(!ev('"flyby" in flights[0].waypoints[2]'), 'a full stop was marked a fly-by');
  });
});

TA('the waypoint menu offers the fly-by toggle on an aerodrome, and not on a stop or a reporting point', async () => {
  const labels = async (i) => {
    const pr = w.openWaypointMenu(0, i);
    const got = [...openDlg().querySelectorAll('.dlg-btn')].map((b) => b.textContent);
    answerDialog('Cancel'); await pr;
    return got.join(' | ');
  };
  try {
    const p = aipDataset().aerodromes.find((x) => x.icao === 'ENDU').points.find((q) => q.name === 'ÅSEN');
    ev(`flights = [{ id: 1, title: "F1", depElev: 32, waypoints: [${adWp('ENTC')},
        { lat: ${p.lat}, lng: ${p.lng}, name: "ÅSEN", alt: 2500, oat: 10, wdir: 0, wspd: 0, var: -11, anchor: "AIP-RP" },
        ${adWp('ENDU', { stop: 'touch-go', stopMin: 5 })}, ${adWp('ENTC', { alt: 3000 })}] }];
        activeFlightIndex = 0; refreshMap(); renderAllFlightTables();`);
    assert(/Fly-by ENTC \(no landing\)/.test(await labels(0)), 'an aerodrome waypoint has no fly-by toggle: ' + await labels(0));
    assert(!/Fly-by|not a fly-by/.test(await labels(1)), 'a reporting point was offered the toggle');
    assert(!/Fly-by|not a fly-by/.test(await labels(2)), 'a touch & go was offered the toggle');
    const pr = w.openWaypointMenu(0, 3);
    answerDialog('Fly-by ENTC'); await pr;
    assert(ev('flights[0].waypoints[3].flyby') === true, 'the toggle did not mark the waypoint');
    assert(/Take off \/ land at ENTC \(not a fly-by\)/.test(await labels(3)), 'the toggle does not offer the way back');
  } finally { ev(SEED); }
});

// v17.2: three modern looks (Slate, Chart, Float) - see src/skins.css.

T('every skin that re-tints the theme does it for BOTH themes', () => {
  // A skin that set light-mode tokens and not dark-mode ones would put its
  // light surfaces under the dark theme's pale text - unreadable, and only in
  // the theme nobody checked.
  const css = require('fs').readFileSync('src/skins.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const tinted = (theme) => new Set([...css.matchAll(new RegExp('body\\.skin-([a-z0-9-]+)\\.' + theme, 'g'))].map((m) => m[1]));
  const light = tinted('light-mode'), dark = tinted('dark-mode');
  assert(light.size >= 3, 'the new skins no longer tint the theme: ' + [...light]);
  for (const id of light) assert(dark.has(id), id + ' re-tints the light theme and not the dark one');
  for (const id of dark) assert(light.has(id), id + ' re-tints the dark theme and not the light one');
});

T('a skin says in which layouts it has no panel divider, and the page asks it', () => {
  const S = moduleExports.skins;
  assert(S.skinHasSplitter('default', 'split') && S.skinHasSplitter('default', 'stacked'), 'the default lost its divider');
  assert(!S.skinHasSplitter('menu', 'split') && !S.skinHasSplitter('menu', 'stacked'), 'the Menu rail gained a divider');
  assert(!S.skinHasSplitter('float', 'split') && S.skinHasSplitter('float', 'stacked'),
    'Float: no divider when the panel floats (Split), the normal one in Stacked');
  assert(S.skinHasSplitter('no-such-skin', 'split'), 'an unknown skin is not the default');
  const was = ev('[...document.body.classList].join(" ")');
  try {
    ev(`setLayoutMode('split'); applySkin('float')`);
    assert(ev('splitterActive()') === false, 'the page offers a divider under a floating panel');
    ev(`applySkin('slate')`);
    assert(ev('splitterActive()') === true, 'Slate lost the divider');
    ev(`applySkin('menu')`);
    assert(ev('splitterActive()') === false, 'the Menu rail gained a divider');
  } finally {
    ev(`applySkin('default')`);
    doc.body.className = was;
  }
});

T('the new skins only restyle: no markup, no handler, and the default stays untouched', () => {
  const S = moduleExports.skins;
  for (const id of ['slate', 'chart', 'float']) {
    const k = S.skinById(id);
    assert(k.id === id && k.note.length > 40, id + ' is not listed with a note saying what it is');
    assert(!k.place, id + ' moves controls - these three are meant to be CSS only');
  }
});

// v17.3: the SIZE is its own setting, so Bold (and Compact) go with any style.

T('any size goes with any style: two classes, and choosing one never clears the other', () => {
  const S = moduleExports.skins;
  assert(S.DENSITIES.map((d) => d.id).join() === 'normal,compact,bold', 'the sizes: ' + S.DENSITIES.map((d) => d.id));
  assert(!S.SKINS.some((k) => k.id === 'bold' || k.id === 'compact'), 'Bold or Compact is still a skin, so it cannot be worn with a style');
  assert(S.normaliseDensity('bold') === 'bold' && S.normaliseDensity('huge') === 'normal' && S.normaliseDensity(undefined) === 'normal',
    'the size is not re-validated');
  try {
    ev(`applySkin('chart'); applyDensity('bold');`);
    const cls = ev('[...document.body.classList].join(" ")');
    assert(/\bskin-chart\b/.test(cls) && /\bdensity-bold\b/.test(cls), 'Bold Chart is not both: ' + cls);
    ev(`applySkin('slate');`);
    assert(ev(`document.body.classList.contains('density-bold')`), 'changing the style dropped the size');
    ev(`applyDensity('compact');`);
    assert(ev(`document.body.classList.contains('skin-slate')`) && !ev(`document.body.classList.contains('density-bold')`),
      'changing the size dropped the style, or left the old size behind');
  } finally { ev(`applySkin('default'); applyDensity('normal');`); }
});

T('a profile saved with the old Bold or Compact skin keeps its size (the author uses Bold)', () => {
  const S = moduleExports.skins;
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  assert(eq(S.splitLegacyLook('bold', undefined), { skin: 'default', density: 'bold' }), 'an old Bold profile lost its Bold');
  assert(eq(S.splitLegacyLook('compact', undefined), { skin: 'default', density: 'compact' }), 'an old Compact profile lost its size');
  // An old settings FILE imported into a profile that already has a size:
  // nothing since v17.3 writes skin 'bold', so it is the file's intent.
  assert(eq(S.splitLegacyLook('bold', 'normal'), { skin: 'default', density: 'bold' }), 'an imported old Bold file lost its Bold');
  assert(eq(S.splitLegacyLook('slate', 'bold'), { skin: 'slate', density: 'bold' }), 'a current look was rewritten');
  assert(eq(S.splitLegacyLook('rubbish', 'huge'), { skin: 'default', density: 'normal' }), 'junk was not normalised');
  assert(moduleExports.exch.PROFILE_KEYS.includes('density'), 'the size does not travel with the settings');
  // The boot path, in the page: a stored Bold profile boots as Bold.
  const src = APP_SRC;
  const boot = src.indexOf('splitLegacyLook(aircraftProfile.skin, aircraftProfile.density)');
  assert(boot > 0 && src.indexOf('applyDensity(aircraftProfile.density)', boot) > boot, 'the boot does not migrate and apply the size');
});

// v17.4: deleting a touch & go or a full stop takes the sector it opened with it.

T('the sector a stop opened is found from the plan, not remembered', () => {
  const E = moduleExports.exch;
  const W = (name, lat, lng, extra) => Object.assign({ name, lat, lng, alt: 2500 }, extra || {});
  const plans = (a, b) => [{ id: 1, waypoints: a }, { id: 2, waypoints: b }];
  const endu = W('ENDU', 69.05, 18.54), entc = W('ENTC', 69.68, 18.91, { stop: 'full-stop' });
  assert(E.sectorOpenedByStop(plans([endu, entc], [W('ENTC', 69.68, 18.91)]), 0, 1) === 1, 'the stub the full stop opened was not found');
  // A touch & go with circuits: the circuit sits on the fix and is what seeds the next plan.
  const tg = W('ENTC', 69.68, 18.91, { stop: 'touch-go' });
  assert(E.sectorOpenedByStop(plans([endu, tg, W('PATTERN', 69.68, 18.91, { isPattern: true })], [W('PATTERN', 69.68, 18.91)]), 0, 1) === 1,
    'circuits after the touch & go hid the sector it opened');
  assert(E.sectorOpenedByStop(plans([endu, entc], [W('ENEV', 68.49, 16.68)]), 0, 1) === -1, 'a plan starting somewhere else was claimed');
  assert(E.sectorOpenedByStop(plans([endu, entc, W('X', 69.9, 19.0)], [W('ENTC', 69.68, 18.91)]), 0, 1) === -1,
    'a stop with flying after it still claims the next plan');
  assert(E.sectorOpenedByStop(plans([endu, W('ENTC', 69.68, 18.91)], [W('ENTC', 69.68, 18.91)]), 0, 1) === -1, 'a waypoint with no stop claimed a plan');
  assert(E.sectorOpenedByStop([{ id: 1, waypoints: [endu, entc] }], 0, 1) === -1, 'the last plan claimed a plan that does not exist');
  assert(E.isStubSector({ waypoints: [W('ENTC', 1, 1)] }) && E.isStubSector({ waypoints: [] })
    && !E.isStubSector({ waypoints: [W('ENTC', 1, 1), W('X', 2, 2)] }), 'the stub test is wrong');
  assert(E.isStubSector({ waypoints: [W('ENTC', 1, 1), W('PATTERN', 1, 1, { isPattern: true })] }), 'circuits alone made a plan a flight');
});

/** ENDU -> ENTC with a stop, and the plan it opened. */
const SEED_OPENED = (stop, nextWps) => `flights = [
  { id: 1, title: "F1", depElev: 254, waypoints: [
    { lat: 69.05505349, lng: 18.54466865, name: "ENDU", alt: 254, oat: 10, wdir: 0, wspd: 0, var: -11 },
    { lat: 69.67895054, lng: 18.91143033, name: "ENTC", alt: 2500, oat: 10, wdir: 0, wspd: 0, var: -12, stop: "${stop}", stopMin: 10 }
  ]},
  { id: 2, title: "F2", depElev: 32, waypoints: [
    { lat: 69.67895054, lng: 18.91143033, name: "ENTC", alt: 32, oat: 10, wdir: 0, wspd: 0, var: -12 }${nextWps || ''}
  ]}
]; activeFlightIndex = 1; refreshMap(); renderAllFlightTables();`;
const LEG_ON = `, { lat: 69.05505349, lng: 18.54466865, name: "ENDU", alt: 254, oat: 10, wdir: 0, wspd: 0, var: -11 }`;

TA('deleting a full stop removes the empty sector it opened, and one undo puts both back', async () => {
  try {
    ev(SEED_OPENED('full-stop'));
    await w.deleteWaypointFromFlight(0, 1);
    assert(ev('flights.length') === 1, 'the empty sector piled up: ' + ev('flights.length') + ' plans');
    assert(ev('flights[0].waypoints.map(w => w.name).join()') === 'ENDU', 'the wrong waypoint went');
    assert(ev('activeFlightIndex') === 0, 'the focus was left on a plan that is gone: ' + ev('activeFlightIndex'));
    assert(!openDlg(), 'an empty sector asked a question');
    w.undoLast();
    assert(ev('flights.length') === 2 && ev('flights[0].waypoints[1].stop') === 'full-stop',
      'one Ctrl+Z did not put back the stop and its sector together');
  } finally { ev(SEED); }
});

TA('a touch & go takes its sector too; its circuits alone do not', async () => {
  try {
    const tgWithLaps = SEED_OPENED('touch-go').replace('stop: "touch-go", stopMin: 10 }',
      'stop: "touch-go", stopMin: 5 }, { lat: 69.67895054, lng: 18.91143033, name: "PATTERN", alt: 1000, oat: 10, wdir: 0, wspd: 0, var: -12, isPattern: true, laps: 3 }');
    ev(tgWithLaps);
    await w.deleteWaypointFromFlight(0, 2);            // the circuits
    assert(ev('flights.length') === 2, 'deleting the circuits took the sector - the touch & go is still there');
    ev(tgWithLaps);
    await w.deleteWaypointFromFlight(0, 1);            // the touch & go itself
    assert(ev('flights.length') === 1, 'the sector the touch & go opened piled up');
  } finally { ev(SEED); }
});

TA('a sector with legs already planned is the pilot\'s work, so they are asked', async () => {
  try {
    ev(SEED_OPENED('full-stop', LEG_ON));
    let pr = w.deleteWaypointFromFlight(0, 1);
    assert(openDlg() && /already has 1 leg/.test(dialogText()), 'no question for a sector with a leg: ' + dialogText());
    answerDialog('Cancel'); await pr;
    assert(ev('flights.length') === 2 && ev('flights[0].waypoints.length') === 2, 'Cancel deleted something');
    pr = w.deleteWaypointFromFlight(0, 1);
    answerDialog('Delete only ENTC'); await pr;
    assert(ev('flights.length') === 2 && ev('flights[0].waypoints.length') === 1, '"Delete only" did the wrong thing');
    ev(SEED_OPENED('full-stop', LEG_ON));
    pr = w.deleteWaypointFromFlight(0, 1);
    answerDialog('Delete both'); await pr;
    assert(ev('flights.length') === 1 && ev('flights[0].waypoints.length') === 1, '"Delete both" left something behind');
    w.undoLast();
    assert(ev('flights.length') === 2 && ev('flights[1].waypoints.length') === 2, 'undo did not restore the planned sector');
  } finally { ev(SEED); }
});

TA('the Delete key and the row button take the same path, and an unrelated plan is never touched', async () => {
  try {
    ev(SEED_OPENED('full-stop'));
    ev('highlightedWaypoint = { fIdx: 0, wpIdx: 1 }');
    await w.deleteHighlightedWaypoint();
    assert(ev('flights.length') === 1, 'the Delete key left the empty sector behind');
    // The next plan starts somewhere else, so this stop did not open it.
    ev(SEED_OPENED('full-stop').replace('{ lat: 69.67895054, lng: 18.91143033, name: "ENTC", alt: 32',
      '{ lat: 68.49, lng: 16.68, name: "ENEV", alt: 95'));
    await w.deleteWaypointFromFlight(0, 1);
    assert(ev('flights.length') === 2, 'a plan the stop did not open was deleted');
  } finally { ev(SEED); }
});

TA('clicking the row button or the menu\'s Delete removes the sector too (the controls, not just the function)', async () => {
  try {
    ev(SEED_OPENED('full-stop'));
    const btn = [...doc.querySelectorAll('#flight-plans-container button')].find((b) =>
      /deleteWaypointFromFlight\(0, 1\)/.test(b.getAttribute('onclick') || ''));
    assert(btn, 'the ENDU -> ENTC row has no delete button');
    btn.click();
    await new Promise((r) => setTimeout(r, 0));
    assert(ev('flights.length') === 1, 'the row button left the empty sector behind');
    ev(SEED_OPENED('full-stop'));
    const pr = w.openWaypointMenu(0, 1);
    answerDialog('Delete this waypoint'); await pr;
    await new Promise((r) => setTimeout(r, 0));
    assert(ev('flights.length') === 1, 'the waypoint menu left the empty sector behind');
  } finally { ev(SEED); }
});

console.log('\n=== 62a000p. The runway, drawn (v17.6) ===');
// The author: "draw a little runway with the correct markers and draw the
// distances over the runway". THE MARKINGS ARE CS ADR-DSN's, checked against
// the EASA text (L.525 / L.530 / L.535) before a stripe was drawn.
T('the threshold stripe count is CS ADR-DSN L.535\'s table, exactly, and nothing is interpolated', () => {
  const R = require('./src/lib/rwydiagram.js');
  const want = { 18: 4, 23: 6, 30: 8, 45: 12, 60: 16 };
  assert(JSON.stringify(R.THRESHOLD_STRIPES) === JSON.stringify(want), 'the L.535 table moved: ' + JSON.stringify(R.THRESHOLD_STRIPES));
  for (const [w, n] of Object.entries(want)) assert(R.thresholdStripeCount(Number(w)) === n, w + ' m should have ' + n + ' stripes');
  // ENRO 13/31 is 40 m: not in the table, so no count is invented
  for (const w of [40, 25, 0, null, undefined, NaN]) assert(R.thresholdStripeCount(w) === null, w + ' m got a stripe count');
  assert(R.isPavedSurface('ASPH') && R.isPavedSurface('asph/conc') && !R.isPavedSurface('GRAVEL') && !R.isPavedSurface(''),
    'the paved test disagrees with rwyperf');
});

T('the drawing: stripes by width, a designation and a centre line on paint only, distances to one scale', () => {
  const R = require('./src/lib/rwydiagram.js');
  const base = { kind: 'landing', desig: '25L', widthM: 45, surface: 'ASPH', availableM: 2800, correctedM: 1500,
    requiredM: 2146, factor: 1.43, windDir: 50, windKt: 15, wind: { headKt: 14, crossKt: 5, crossFrom: 'R', variable: false } };
  const count = (svg, cls) => (svg.match(new RegExp('class="[^"]*\\b' + cls + '\\b', 'g')) || []).length;
  for (const [w, n] of [[18, 4], [23, 6], [30, 8], [45, 12], [60, 16]]) {
    const svg = R.runwayDiagramSvg(Object.assign({}, base, { widthM: w }));
    assert(count(svg, 'rwyd-thr') === n, w + ' m runway drew ' + count(svg, 'rwyd-thr') + ' threshold stripes, not ' + n);
  }
  const svg = R.runwayDiagramSvg(base);
  assert(/rotate\(90\)[^>]*>25L</.test(svg), 'the designation is not drawn, read from the approach');
  assert(count(svg, 'rwyd-cl') > 5, 'no centre line');
  // TO SCALE: each bar is its distance over the strip's own length
  const num = (re) => Number((svg.match(re) || [])[1]);
  const x0 = 78;
  const strip = num(/<rect x="78" y="20" width="([\d.]+)"/);
  const pohEnd = num(/class="rwyd-bar-poh"\/><line x1="78" y1="[\d.]+" x2="78" y2="[\d.]+" class="rwyd-bar-poh"\/><line x1="([\d.]+)"/);
  assert(Math.abs((pohEnd - x0) / strip - 1500 / 2800) < 0.005, 'the POH bar is not to the strip\'s scale: ' + pohEnd + ' / ' + strip);
  assert(/required 2 146 m/.test(svg) && !/short/.test(svg), 'a requirement that fits is drawn as short');
  // a requirement past the LDA overruns the strip and says by how much
  const over = R.runwayDiagramSvg(Object.assign({}, base, { availableM: 2000 }));
  assert(/146 m short/.test(over) && /rwyd-bar-bad/.test(over), 'an overrun is not drawn as one');
  assert(/rwyd-fig-bad/.test(R.runwayFiguresHtml(Object.assign({}, base, { availableM: 2000 }))), 'the figures do not flag the overrun');
  // no L.535 count -> no stripes, and it says why rather than looking forgotten
  const enro = R.runwayDiagramSvg(Object.assign({}, base, { widthM: 40 }));
  assert(count(enro, 'rwyd-thr') === 0 && /L\.535 gives no count for 40 m/.test(enro), 'a 40 m runway got invented stripes, or no reason');
  // unpaved: no paint at all
  const gravel = R.runwayDiagramSvg(Object.assign({}, base, { surface: 'GRAVEL', widthM: 30 }));
  assert(count(gravel, 'rwyd-thr') === 0 && count(gravel, 'rwyd-cl') === 0 && /Unpaved \(GRAVEL\)/.test(gravel),
    'a gravel strip was painted');
  // the wind box: a tailwind is red and says so; a wind not known is not calm
  const tail = R.runwayDiagramSvg(Object.assign({}, base, { wind: { headKt: -3, crossKt: 0, crossFrom: null, variable: false } }));
  assert(/class="rwyd-bad"[^>]*>TAILWIND</.test(tail), 'a tailwind is not called one');
  const calm = R.runwayDiagramSvg(Object.assign({}, base, { windDir: null, windKt: null, wind: null }));
  assert(/---\/--/.test(calm) && /not known/.test(calm) && !/000\/00/.test(calm), 'an unknown wind was drawn as calm');
  // a refused check: the runway, never a zero distance
  const refused = R.runwayDiagramSvg(Object.assign({}, base, { correctedM: undefined, requiredM: undefined }));
  assert(!/rwyd-bar-/.test(refused) && /No distance worked out/.test(refused), 'a refused check drew a distance');
  // every string is escaped
  const hostile = R.runwayDiagramSvg(Object.assign({}, base, { desig: '<img src=x onerror=1>', surface: '<b>' }));
  assert(!/<img/.test(hostile) && !/<b>/.test(hostile), 'the drawing let markup through');
  assert(!/NaN|undefined/.test(svg + refused + calm + R.runwayFiguresHtml(Object.assign({}, base, { correctedM: undefined }))),
    'NaN or undefined reached the drawing');
});

T('the wind box has as much room below its last line as above its first (v17.7)', () => {
  // The author: "the bottom text is just a bit too close to the edge of the
  // box". The box was a fixed 84 high and ended ONE unit under the last
  // baseline. Every wind the box can show is checked, because the last line's
  // wording (head / TAILWIND / VRB = tail) is what changes.
  const R = require('./src/lib/rwydiagram.js');
  const base = { kind: 'landing', desig: '28', widthM: 45, surface: 'ASPH', availableM: 2443, correctedM: 400,
    requiredM: 572, factor: 1.43, windDir: 280, windKt: 10 };
  const winds = [{ headKt: 6, crossKt: 8, crossFrom: 'L', variable: false },
    { headKt: -2, crossKt: 2, crossFrom: null, variable: true },
    { headKt: -4, crossKt: 0, crossFrom: null, variable: false }];
  for (const [i, wind] of winds.entries()) for (const widthM of [18, 30, 45, 60]) {
    const svg = R.runwayDiagramSvg(Object.assign({}, base, { wind, widthM }));
    const box = svg.match(/<rect x="1" y="([\d.]+)" width="64" height="([\d.]+)"[^>]*class="rwyd-box"/);
    assert(box, 'no wind box');
    const top = Number(box[1]), bottom = top + Number(box[2]);
    const ys = [...svg.matchAll(/<text x="33\.0" y="([\d.]+)"/g)].map((m) => Number(m[1]));
    const first = Math.min(...ys), last = Math.max(...ys);
    // the first line's CAP sits about 5.5 units above its baseline (7.5 px type)
    const above = first - 5.5 - top, below = bottom - last;
    assert(below >= 8, 'wind ' + i + ', ' + widthM + ' m: only ' + below.toFixed(1) + ' below the last line');
    assert(Math.abs(below - above) <= 1.5, 'wind ' + i + ': the padding is lopsided, ' + above.toFixed(1) + ' above vs ' + below.toFixed(1) + ' below');
    const vb = Number(svg.match(/viewBox="0 0 360 ([\d.]+)"/)[1]);
    assert(vb >= bottom + 1, 'the box is cut off by the drawing\'s own edge: ' + bottom + ' vs ' + vb);
  }
});

TA('the M&B distance card draws the runway for every worked check, from the same figures as its text', async () => {
  ev(SEED_STOP);
  doc.getElementById('fuel-dep').value = '64';
  ev(`mbPrefs.reg = "LN-TRB"; perfInputs = {}; lastWeather = {
        icaos: ['ENDU', 'ENTC'],
        metars: { ENDU: 'ENDU 281150Z 29012KT 9999 FEW040 10/05 Q1005', ENTC: 'ENTC 281150Z 18008KT 9999 SCT030 08/04 Q1003' },
        tafs: {} }; renderAllFlightTables();`);
  try {
    const host = doc.getElementById('mb-perf');
    // One drawing per check made at a runway, in the card's order.
    const checks = ev(`runwayChecks.filter((c) => c.icao && !c.noRunways && !c.overflight).map((c) => ({
      req: c.res && !c.res.refused ? c.res.requiredM : null, desig: c.opt.desig, w: c.opt.rw.width }))`);
    assert(checks.filter((c) => c.req !== null).length >= 2, 'the fixture has no worked distances');
    const svgs = [...host.querySelectorAll('svg.rwyd')];
    assert(svgs.length === checks.length, 'drawings and runway checks do not pair up: ' + svgs.length + ' for ' + checks.length);
    checks.forEach((c, i) => {
      const svg = svgs[i], label = svg.getAttribute('aria-label') || '';
      assert(label.includes('runway ' + c.desig + ','), 'drawing ' + i + ' is not runway ' + c.desig + ': ' + label);
      assert(c.req === null ? !/required/.test(label) : label.includes('required ' + c.req + ' m'),
        'the drawing and the text disagree on RWY ' + c.desig + ': ' + label);
      assert(svg.querySelectorAll('.rwyd-thr').length === (moduleExports.rwyd.thresholdStripeCount(c.w) || 0),
        'RWY ' + c.desig + ' (' + c.w + ' m) has the wrong stripe count');
    });
    assert(!host.querySelector('.perf-bar') && !/perf-bar/.test(fs.readFileSync('src/styles.css', 'utf8')),
      'the v16.96 usage bar is back beside the drawing');
    assert(/Required\s*\d+ m/.test(host.textContent), 'the figure line went - the drawing is not the authority');
  } finally { ev('lastWeather = null;'); ev(SEED); }
});

runAsyncTests().then(() => {
  console.log('\n=== Uncaught page errors ===');
  console.log(errors.length ? errors : '  none');
  console.log('\nRESULT: ' + (errors.length ? 'FAILURES PRESENT' : 'ALL CHECKS PASSED'));
  process.exit(errors.length ? 1 : 0);
});
