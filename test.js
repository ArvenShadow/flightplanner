process.env.TZ = 'UTC';   // deterministic clock for the daylight/sun tests
const fs = require('fs');
const { JSDOM } = require('jsdom');

// Tests run against the BUILT artifact (npm test builds first): it contains
// both the module bundle and the page script, so source-level guards keep
// working wherever a given piece of code currently lives.
const APP_HTML = 'dist/C182_FlightPlanner.html';
if (!fs.existsSync(APP_HTML)) {
  console.error('dist/C182_FlightPlanner.html is missing - run: npm run build');
  process.exit(1);
}

let html = fs.readFileSync(APP_HTML, 'utf8');
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
function typeInDialog(value) {
  const input = openDlg() && openDlg().querySelector('.dlg-input');
  if (!input) throw new Error('the open dialog has no text field');
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
['openSeraModal','closeSeraModal','openSettingsModal','closeSettingsModal',
 'saveSettings','applyBulkDefaultsToActive','clearAllFlights'].forEach(fn => {
  T(fn + ' is defined', () => assert(typeof w[fn] === 'function', 'not a function'));
});

console.log('\n=== 3. Modal open/close ===');
T('SERA modal opens', () => {
  w.openSeraModal();
  assert(doc.getElementById('sera-modal').style.display === 'flex', 'did not open');
});
T('SERA modal closes', () => {
  w.closeSeraModal();
  assert(doc.getElementById('sera-modal').style.display === 'none', 'did not close');
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
  ['sera-modal','wind-modal','settings-modal'].forEach(id =>
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
TA('applyBulkDefaultsToActive sets winds, keeps dep elevation', async () => {
  doc.getElementById('def-wdir').value = '310';
  doc.getElementById('def-wspd').value = '22';
  doc.getElementById('def-oat').value = '-4';
  doc.getElementById('def-alt').value = '3500';
  const depAltBefore = ev('flights[0].waypoints[0].alt');
  const p = w.applyBulkDefaultsToActive();
  await tick();
  answerDialog('Apply to all legs');
  await p;
  const wps = ev('flights[0].waypoints');
  assert(wps.every(x => x.wdir === 310 && x.wspd === 22 && x.oat === -4), 'winds not applied');
  assert(wps[0].alt === depAltBefore, 'departure elevation was overwritten');
  assert(wps[1].alt === 3500, 'cruise alt not applied');
});

console.log('\n=== 6. Wind stronger than TAS (old NaN crash) ===');
TA('gale-force wind does not produce NaN', async () => {
  doc.getElementById('def-wspd').value = '400';
  await (async () => { const p = w.applyBulkDefaultsToActive(); await tick(); answerDialog('Apply to all legs'); await p; })();
  const txt = doc.getElementById('flight-plans-container').textContent;
  assert(!txt.includes('NaN'), 'NaN leaked into table with wspd > TAS');
  doc.getElementById('def-wspd').value = '15';
  const q = w.applyBulkDefaultsToActive(); await tick(); answerDialog('Apply to all legs'); await q;
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
  answerDialog('Save active flight as a new route');
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

console.log('\n=== 14. Save / export round trip ===');
TA('save mission + export produce valid JSON', async () => {
  const p = w.saveCurrentMission();
  await tick();
  answerDialog('Save the whole mission as new');
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
  const raw = fs.readFileSync(APP_HTML, 'utf8');
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
TA('export carries profile and planning prefs', async () => {
  w.exportMissionFile();
  assert(w.__lastBlob, 'no blob captured');
});
T('import of v2 file applies aircraft settings', () => {
  const v2 = JSON.stringify({
    formatVersion: 2,
    routes: {}, missions: {},
    currentFlights: [{ id: 1, title: 'T', depElev: 100,
      waypoints: [{lat:69, lng:18, name:'X', alt:100, oat:0, wdir:0, wspd:0, var:-11},
                  {lat:69.3, lng:18.4, name:'Y', alt:2000, oat:0, wdir:0, wspd:0, var:-11}] }],
    profile: { roc: 833, climbTas: 91, evilExtra: 'ignored' },
    planningPrefs: { fuel: '55', reserve: '9.5', etd: '07:45' }
  });
  ev(`(function(){
    const reader = { readAsText(){ this.onload({ target: { result: ${JSON.stringify(v2)} } }); } };
    const orig = window.FileReader; window.FileReader = function(){ return reader; };
    importMissionFile({ target: { files: [{}], value: '' } });
    window.FileReader = orig;
  })()`);
  assert(ev('aircraftProfile.roc') === 833, 'roc not imported: ' + ev('aircraftProfile.roc'));
  assert(ev('aircraftProfile.evilExtra') === undefined, 'non-whitelisted key leaked in');
  assert(doc.getElementById('fuel-dep').value === '55', 'fuel pref not imported');
  assert(doc.getElementById('def-etd').value === '07:45', 'etd not imported');
  assert(ev('flights.length') === 1 && ev("flights[0].title") === 'T', 'flights not imported');
});
T("user's actual v1 export imports cleanly (5 flights, no settings)", () => {
  const v1 = fs.readFileSync('c182_flight_routes.json', 'utf8');
  const rocBefore = ev('aircraftProfile.roc');
  ev(`(function(){
    const reader = { readAsText(){ this.onload({ target: { result: ${JSON.stringify(v1)} } }); } };
    const orig = window.FileReader; window.FileReader = function(){ return reader; };
    importMissionFile({ target: { files: [{}], value: '' } });
    window.FileReader = orig;
  })()`);
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
  const raw = fs.readFileSync(APP_HTML, 'utf8');
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
  const raw = fs.readFileSync(APP_HTML, 'utf8');
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
  const raw = fs.readFileSync(APP_HTML, 'utf8');
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
  const raw = fs.readFileSync(APP_HTML, 'utf8');
  const rule = raw.match(/\.toc-custom-icon[^}]+}/)[0];
  ['tod-custom-icon', 'wp-custom-icon', 'ruler-icon', 'ruler-seg-icon', 'ruler-total-icon']
    .forEach(c => assert(raw.match(/\.toc-custom-icon[\s\S]{0,200}?{/)[0].includes(c), 'selector missing ' + c));
  assert(rule.includes('width: max-content !important'), 'width override missing');
  assert(rule.includes('height: max-content !important'), 'height override missing');
});
T('every label chip is inline-block so its background covers all text', () => {
  const raw = fs.readFileSync(APP_HTML, 'utf8');
  ['.toc-label', '.tod-label', '.pattern-label', '.ruler-label'].forEach(c => {
    const rule = raw.split(c + ' {')[1].split('}')[0];
    assert(rule.includes('display: inline-block') || rule.includes('inline-block;'), c + ' not inline-block');
  });
  assert(raw.includes('.wp-label { width: max-content;'), 'wp-label not content-sized');
});

console.log('\n=== 33. TOC/TOD: a tick across the track, plus a small chip ===');
T('the mark is a tick rotated ACROSS the track, anchored on the exact point', () => {
  const raw = fs.readFileSync(APP_HTML, 'utf8');
  assert(raw.includes('class="prof-tick ${kindCls}"'), 'the TOC/TOD tick is gone');
  assert(!raw.includes('prof-point'), 'the old diamond dot is back');
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
  const raw = fs.readFileSync(APP_HTML, 'utf8');
  // the chip text must be the bare kind, not the whole sentence
  assert(raw.includes('title="${tip}">${fTag}${prof.kind}</div>'), 'the chip is not just the kind + a tooltip');
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
  const raw = fs.readFileSync(APP_HTML, 'utf8');
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
  const raw = fs.readFileSync(APP_HTML, 'utf8');
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
  const raw = fs.readFileSync(APP_HTML, 'utf8');
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
  const raw = fs.readFileSync(APP_HTML, 'utf8');
  const seg = raw.split("marker.on('drag'")[1].split("marker.on('dragend'")[0];
  assert(!seg.includes('renderAllFlightTables'), 'renderAllFlightTables is back in the drag handler');
  assert(seg.includes('drawLiveLine'), 'route line no longer follows the drag');
  // ...and the live redraw must use the FULL path. Rebuilding from waypoints
  // alone made via points visibly vanish for the duration of every drag.
  const live = raw.split('function drawLiveLine')[1].split('\n    }')[0];
  assert(live.includes('flightLineCoords'), 'the live redraw dropped the via points again');
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
  const built = fs.readFileSync(APP_HTML, 'utf8');
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
  const raw = fs.readFileSync(APP_HTML, 'utf8');
  assert(raw.includes('#map.zoom-mid .toc-label'), 'mid-zoom TOC chip rule missing');
  assert(/#map\.zoom-mid \.toc-label[^}]*display: none/.test(raw.replace(/\n/g, ' ')), 'TOC chips not hidden at mid zoom');
});
T('overview zoom (<=5) leaves only dots and lines', () => {
  setZoom(5);
  assert(doc.getElementById('map').classList.contains('zoom-far'), 'zoom-far missing at z5');
  const raw = fs.readFileSync(APP_HTML, 'utf8').replace(/\n/g, ' ');
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
  const anchorsModule = require('./src/lib/anchors.js');
  moduleExports = { magvar: magvarModule, geodesy: geodesyModule, perf: perfModule, fmt: fmtModule,
                    legs: legsModule, day: dayModule, winds: windsModule, integrity: integrityModule,
                    exch: exchModule, plot: plotModule, metar: metarModule,
                    airspace: airspaceModule, anchors: anchorsModule, ofp: ofpModule };
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
T('a pattern stop breaks the schedule chain', () => {
  const L = moduleExports.legs;
  const s = L.computeFlightSchedule({ waypoints: [WP('A', 69, 18, 254), WP('P', 69.05, 18, 254, { isPattern: true }), WP('C', 69.9, 18, 6500)] });
  assert(s.some(leg => leg === null), 'a pattern leg must break the chain, not be scheduled through');
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
    'format.js': () => [M.fmt.formatTimeHHMM(125), M.fmt.toDMM(69.68, true), M.fmt.clockFromMinutes('23:30', 90)],
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
    'ofpform.js': () => [M.ofp.columnWidthsPct(), M.ofp.groupSpans(),
                         M.ofp.ofpRowCells({ from: 'A', to: 'B', tas: 130, tt: 74, var: -11,
                           mt: 63, wdir: 250, wspd: 20, wca: -5, accDist: 20, accTime: '00:08',
                           ff: 13, legBurn: 3.4, accBurn: 3.4, alt: 2500, mh: 58, gs: 120,
                           dist: 20, time: '00:08', eto: '', rem: 60 }),
                         M.ofp.buildOfpSheets({}, [])],
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
  const built = fs.readFileSync(APP_HTML, 'utf8');
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
T('the generated dataset is present, current, and states its permission', () => {
  assert(fs.existsSync('data/aip.js'), 'data/aip.js is missing - run npm run build:aip');
  const src = fs.readFileSync('data/aip.js', 'utf8');
  const set = JSON.parse(src.slice(src.indexOf('{'), src.lastIndexOf(';')));
  assert(set.provider === 'Avinor' && set.source === 'eAIP', 'provenance lost');
  assert(/permission/i.test(set.attribution) && /non-commercial/i.test(set.attribution),
    'the dataset does not carry the permission it depends on: ' + set.attribution);
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
  assert(A.airspaceInfo(f).notes.length === 0, 'a normal airspace gained a note');
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
  const css = fs.readFileSync(APP_HTML, 'utf8');
  const rule = css.split('.airspace-tip {')[1].split('}')[0];
  assert(/white-space:\s*normal/.test(rule), 'the card would not wrap');
  assert(/width:\s*max-content/.test(rule), 'the card will collapse to its minimum width');
  assert(/max-width:\s*\d+px/.test(rule), 'the card has no maximum width');
});
T('the attribution names BOTH grants and warns it is not for navigation', () => {
  const A = moduleExports.airspace;
  const txt = A.airspaceAttribution({ attribution: 'x', editionLabel: '2026-06-11-AIRAC', effectiveFrom: '2026-06-11' });
  assert(/Avinor/.test(txt) && /permission/i.test(txt) && /non-commercial/i.test(txt),
    'the Avinor permission is not stated: ' + txt);
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
  const raw = fs.readFileSync(APP_HTML, 'utf8');
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
  const raw = fs.readFileSync(APP_HTML, 'utf8');
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
  for (const a of set.aerodromes) {
    assert(anchors.some((x) => x.kind === 'AD' && x.icao === a.icao),
      a.icao + ' has no aerodrome anchor');
  }
  // And the attribution names the ONE grant that applies - Kartverket is not
  // involved in the reporting points and must not be implied.
  const attr = A.anchorAttribution(set);
  assert(/Avinor/.test(attr) && /non-commercial/i.test(attr), attr);
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
  const wp = A.anchorWaypoint(endu, { alt: 3500, oat: 5, wdir: 240, wspd: 18 });
  assert(wp.lat === ad.lat && wp.lng === ad.lng, 'the coordinate was altered on the way through');
  assert(wp.name === 'ENDU', wp.name);
  // An AERODROME anchor uses its PUBLISHED elevation, not the caller's default
  // altitude: that is the number a departure or arrival waypoint needs.
  assert(wp.alt === ad.elevFt && wp.alt === 254, 'aerodrome altitude: ' + wp.alt);
  assert(wp.anchor === 'AIP-AD', wp.anchor);
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
  assert(/Avinor/.test(attr.textContent) && /non-commercial/i.test(attr.textContent), attr.textContent);

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
  assert(tabs.length === 2, tabs.length + ' settings tabs');
  assert(tabs.map(t => t.id).join(',') === 'settings-tab-aircraft,settings-tab-map', tabs.map(t => t.id).join());
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
  assert(impossible.tocNeedsEntryAlt === null,
    'the first leg was told to raise a fix that does not exist: ' + impossible.tocNeedsEntryAlt);
  assert(impossible.climbRateReqFpm > 0 && isFinite(impossible.climbRateReqFpm),
    'no required rate on the one case where it is the only answer');
  assert(Math.abs(impossible.climbMin - base.climbMin) < 1e-6, 'a refused target changed the climb');
  assert(Math.abs(impossible.tocAlongNM - base.tocAlongNM) < 1e-6, 'a refused target moved the TOC');

  // With no target there is nothing to report.
  assert(base.tocTargetNM === null && base.climbRateReqFpm === null && base.tocTargetMet === true
    && base.tocDerivedBoc === false && base.tocNeedsEntryAlt === null, JSON.stringify(base.tocTargetNM));
});
T('when the climb will not fit, the ALTITUDE the previous fix needs is computed - and it works', () => {
  // THE USER'S POINT, and it is the right design: rather than reporting a rate
  // nobody can fly, work out what crossing the previous fix higher would take.
  // That keeps the altitude column the single source of truth for what is flown
  // where, instead of the schedule quietly doing something the column denies.
  const L2 = moduleExports.legs;
  const W = (n, lat, alt, x) => ({ name: n, lat, lng: 18.5, alt, oat: 0, wdir: 0, wspd: 0, var: -11, ...x });
  const route = (aAlt, x) => L2.computeFlightSchedule({ id: 1,
    waypoints: [W('ENDU', 68.3, 254), W('A', 69.0, aAlt), W('B', 69.7, 6500, x)] });

  for (const target of [3, 5, 8, 11]) {
    const asked = route(2500, { tocNM: target })[1];
    assert(!asked.tocTargetMet, 'target ' + target + ' NM was somehow met from 2500 ft');
    assert(asked.tocNeedsEntryAlt > 2500 && asked.tocNeedsEntryAlt <= 6500,
      'implausible advice for ' + target + ' NM: ' + asked.tocNeedsEntryAlt);
    // A WHOLE HUNDRED FEET (v16.40, the user's request) - a pilot writes and
    // flies round altitudes. It rounds UP, never to the nearest: the figure is
    // a MINIMUM, so the nearest hundred is below it half the time and taking
    // that advice would miss the very target it was computed to meet.
    assert(asked.tocNeedsEntryAlt % 100 === 0,
      'the advice is not a whole hundred feet: ' + asked.tocNeedsEntryAlt);
    // TAKING THE ADVICE MUST WORK. It did not at first: the required altitude
    // was bisected against a time budget computed at the ORIGINAL climb TAS,
    // but a higher entry altitude raises the TAS and so shortens the time
    // available - the recommendation missed by 0.11 NM. Both sides move
    // together now, which is why entryAltForClimbBy takes a callback.
    const after = route(asked.tocNeedsEntryAlt, { tocNM: target })[1];
    assert(after.tocTargetMet,
      'taking the advice (' + asked.tocNeedsEntryAlt + ' ft) still missed the ' + target + ' NM target: ' +
      'TOC at ' + after.tocAlongNM.toFixed(3));
    assert(Math.abs(after.tocAlongNM - target) < 0.05,
      'the TOC did not land on the target after taking the advice: ' + after.tocAlongNM);
    // ...and so must rounding it UP to the next hundred BY HAND. The panel no
    // longer does that itself (v16.39): the figure is a crossing altitude passed
    // in a climb, not a level to be flown, and rounding it up puts a short level
    // sliver back at the fix. It must still be safe when a pilot does it.
    const rounded = Math.ceil(asked.tocNeedsEntryAlt / 100) * 100;
    const afterRound = route(rounded, { tocNM: target })[1];
    assert(afterRound.tocTargetMet, 'rounding up to ' + rounded + ' ft missed the target');

    // AND IT MUST BE ONE CLIMB (v16.39, the user's correction). Raising the fix
    // alone tops the earlier leg out early and holds the new altitude to the
    // fix, so the pilot gets two climbs with a level stretch between them. The
    // advice therefore also delays the earlier leg's climb to end ON the fix.
    const both = L2.computeFlightSchedule({ id: 1, waypoints: [W('ENDU', 68.3, 254),
      W('A', 69.0, asked.tocNeedsEntryAlt, { tocNM: asked.tocAdviceLevelByNM }),
      W('B', 69.7, 6500, { tocNM: target })] });
    const lead = both[0], climb = both[1];
    assert(asked.tocAdviceLevelByNM !== null && asked.tocAdviceClimbFromNM !== null,
      'the advice did not say where the earlier climb begins');
    assert(Math.abs(lead.climbStartNM - asked.tocAdviceClimbFromNM) < 0.05,
      'the offer described a climb start the plan does not produce: ' +
      asked.tocAdviceClimbFromNM + ' vs ' + lead.climbStartNM);
    assert(lead.distNM - (lead.climbStartNM + lead.climbDistNM) < 0.05,
      'the earlier leg still levels off before the fix: ' +
      (lead.distNM - (lead.climbStartNM + lead.climbDistNM)).toFixed(3) + ' NM');
    assert(climb.climbStartNM < 0.05,
      'the climb does not resume at the fix: ' + climb.climbStartNM.toFixed(3) + ' NM');
    // AT OR BEFORE the deadline, not exactly on it (v16.40). The crossing
    // altitude is rounded UP to a whole hundred, so the aircraft arrives at the
    // fix slightly higher than the minimum and tops out slightly sooner than
    // asked. "Be level BY" is a deadline; early is safe, and it is what keeps
    // the climb continuous instead of levelling off for seconds at the fix.
    assert(climb.tocTargetMet && climb.tocAlongNM > 0 && climb.tocAlongNM <= target + 0.05,
      'the continuous climb did not top out at or before the target: ' + climb.tocAlongNM);
    assert(climb.tocContinuation === true, 'the climb was not treated as handed over');
    // ONE climb means ONE top of climb on the map.
    assert(lead.climbContinues === true, 'the earlier leg did not report a continuing climb');
    const marks = L2.computeLegMarkers(both[0].from, both[0].to, lead)
      .concat(L2.computeLegMarkers(both[1].from, both[1].to, climb));
    const tocs = marks.filter((m) => m.kind === 'TOC');
    assert(tocs.length === 1 && tocs[0].distNM <= target + 0.05,
      'a continuous climb drew ' + tocs.length + ' tops of climb: ' +
      marks.map((m) => m.kind + '@' + m.distNM.toFixed(1)).join(', '));
  }

  // The advice is the MINIMUM: one hundred feet lower must NOT be enough, or it
  // is not the answer to "what does this need".
  const asked5 = route(2500, { tocNM: 5 })[1];
  const tooLow = route(asked5.tocNeedsEntryAlt - 100, { tocNM: 5 })[1];
  assert(!tooLow.tocTargetMet, 'the advice is not the minimum - 100 ft lower also worked');
});
T('advice is only offered if it actually WORKS', () => {
  // The per-leg figure alone is not enough: raising a fix also changes the leg
  // BEFORE it, and if those earlier legs cannot climb that high by then the
  // target is missed all over again. Measured over 20 000 generated routes, the
  // unverified figure was wrong 382 times in 947 - so every candidate is tried
  // on a copy of the flight and dropped unless the target is really met.
  const L2 = moduleExports.legs;
  const W = (n, lat, lng, alt) => ({ name: n, lat, lng, alt, oat: 0, wdir: 250, wspd: 20, var: -11 });
  const rnd = (() => { let s = 987654; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
  let given = 0, works = 0, noneHelps = 0, firstLeg = 0, continuous = 0, noEarlierClimb = 0, absorbed = 0;
  const splitClimb = [], doubleToc = [];
  for (let iter = 0; iter < 3000; iter++) {
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
    const pin = wps.map((w, k) => k === li ? { ...w, tocNM: +(rnd() * legDist).toFixed(2) } : { ...w });
    const S = L2.computeFlightSchedule({ id: 1, waypoints: pin })[li - 1];
    if (!S || S.tocTargetNM == null || S.tocTargetMet) continue;
    if (S.tocNeedsEntryAlt === null) { if (S.i === 0) firstLeg++; else if (S.tocNoAltHelps) noneHelps++; continue; }
    given++;
    // APPLIED EXACTLY AS THE PANEL APPLIES IT (v16.39): the crossing altitude
    // AND the "be level by" pin that delays the earlier leg's climb so the two
    // halves are one continuous climb through the fix.
    const fixed = pin.map((w, k) => k === S.i
      ? { ...w, alt: S.tocNeedsEntryAlt, tocNM: S.tocAdviceLevelByNM }
      : { ...w });
    const T2 = L2.computeFlightSchedule({ id: 1, waypoints: fixed });
    const again = T2[S.i], lead = T2[S.i - 1];
    if (again && again.tocTargetMet) works++;
    // The climb must be CONTINUOUS through the raised fix, or the pilot is back
    // to two climbs with a level stretch between them - which is the whole bug.
    if (again && again.tocTargetMet && lead) {
      const gapBefore = lead.distNM - (lead.climbStartNM + lead.climbDistNM);
      if (lead.climbDistNM <= 0.05) noEarlierClimb++;   // it DESCENDS into the fix
      // Rounding up to a whole hundred can reach the leg's OWN target altitude,
      // and then there is no climb left here at all: the whole climb finishes
      // on the earlier leg, which draws the top. One climb, not a split.
      else if (again.climbDistNM <= 0.05 && gapBefore < 0.05) absorbed++;
      else if (gapBefore < 0.05 && again.climbStartNM < 0.05 && lead.climbContinues) continuous++;
      else splitClimb.push('leg ' + S.i + ': gap ' + gapBefore.toFixed(3) +
        ' before / ' + again.climbStartNM.toFixed(3) + ' after, continues ' + lead.climbContinues);
      // ONE climb draws ONE top of climb - counted over the WHOLE flight,
      // because a climb continuing through more than one fix lands its mark on
      // a later leg than the two being compared here.
      const tocs = T2.filter(Boolean)
        .flatMap((X) => L2.computeLegMarkers(X.from, X.to, X))
        .filter((m) => m.kind === 'TOC');
      const climbing = T2.filter(Boolean).filter((X) => X.climbDistNM > 0.05).length;
      if (climbing > 0 && tocs.length === 0 && !T2.filter(Boolean).some((X) => X.stillClimbing))
        doubleToc.push('leg ' + S.i + ': a climb with no TOC anywhere');
      if (tocs.length > climbing)
        doubleToc.push('leg ' + S.i + ': ' + tocs.length + ' TOC marks for ' + climbing + ' climbing legs');
    }
  }
  assert(given > 30, 'the sweep produced only ' + given + ' pieces of advice');
  assert(works === given, works + ' of ' + given + ' suggestions actually satisfied the target');
  assert(splitClimb.length === 0, splitClimb.length + ' of ' + given +
    ' suggestions still split the climb in two: ' + splitClimb.slice(0, 3).join(' | '));
  assert(doubleToc.length === 0, doubleToc.length + ' continuous climbs drew two tops of climb: ' +
    doubleToc.slice(0, 3).join(' | '));
  // ...and the honest third state must occur: sometimes NO altitude helps.
  assert(noneHelps > 0, 'the "no altitude helps" case never came up, so it is untested');
  assert(firstLeg > 0, 'the first-leg refusal never came up');
  assert(continuous > 20 && noEarlierClimb > 0 && absorbed > 0,
    'the sweep did not exercise all three shapes: ' + continuous + ' continuous / ' +
    noEarlierClimb + ' descending / ' + absorbed + ' absorbed');
  console.log('        ' + given + ' suggestions, all verified | ' + continuous +
    ' one continuous climb | ' + noEarlierClimb + ' descend into the fix | ' + absorbed +
    ' climb absorbed by the earlier leg | ' + noneHelps + ' where no altitude helps | ' +
    firstLeg + ' first-leg refusals');
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
  const raw = fs.readFileSync(APP_HTML, 'utf8');
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
  const W = (n, lat, lng, alt) => ({ name: n, lat, lng, alt, oat: 0, wdir: 250, wspd: 20, var: -11 });
  const rnd = (() => { let s = 12345; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
  const bad = [];
  let legs = 0, withBoc = 0, withBod = 0, refused = 0, missed = 0, continues = 0;
  for (let iter = 0; iter < 4000; iter++) {
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
    const sch = L2.computeFlightSchedule({ id: 1, waypoints: pin });
    for (const S of sch) {
      if (!S) continue;
      legs++;
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
      for (const m of marks) {
        if (!isFinite(m.lat) || !isFinite(m.lng)) bad.push('marker with no position on ' + S.i);
        if (m.distNM < -tol || m.distNM > S.distNM + 0.06) bad.push('marker off the leg on ' + S.i);
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
  assert(refused > 0 && missed > 0, 'the sweep never hit a refused BOD or a missed TOC target');
  assert(bad.length === 0, bad.length + ' violations, first few: ' + [...new Set(bad)].slice(0, 5).join(' | '));
  assert(continues > 0, 'the sweep never produced a climb continuing through a fix');
  console.log('        ' + legs + ' pinned legs: ' + withBoc + ' with a BOC, ' + withBod +
    ' with a BOD, ' + refused + ' pins refused, ' + missed + ' TOC targets missed, ' +
    continues + ' climbs continuing through a fix, 0 violations');
});

console.log('\n=== 62a1. The company OFP form (v16.41) ===');
T('the form has its 25 measured columns, and the groups span the right ones', () => {
  const F = moduleExports.ofp;
  assert(F.OFP_COLUMNS.length === 25, 'the form has 25 columns, not ' + F.OFP_COLUMNS.length);
  assert(F.COLUMN_EDGES_PCT.length === 26, '25 columns need 26 rules');
  const w = F.columnWidthsPct();
  assert(Math.abs(w.reduce((a, b) => a + b, 0) - 100) < 1e-9, 'the widths do not sum to 100%');
  assert(w.every((x) => x > 2 && x < 10), 'an implausible column width: ' + w.join(' '));
  // Measured off the form: "From" and "To" are the wide ones, everything else
  // is a narrow figure box.
  assert(w[0] > 8 && w[12] > 8, 'From/To are not the wide columns: ' + w[0] + '/' + w[12]);
  // The group headers must tile the row exactly, or the two header rows
  // drift apart and the printed sheet stops lining up with the paper.
  const spans = F.groupSpans();
  assert(spans.reduce((a, g) => a + g.span, 0) === 25,
    'the group row does not cover all 25 columns');
  const named = Object.fromEntries(spans.filter((g) => g.label).map((g) => [g.label, g.span]));
  assert(JSON.stringify(named) === JSON.stringify(
    { WIND: 2, ACC: 2, Fuel: 3, Altitude: 2, Intermediate: 3, Time: 3, 'Fuel remaining': 2 }),
    'the measured group spans changed: ' + JSON.stringify(named));
});
T('the page builds the form from the SAME pass that renders the screen', () => {
  // One computation, two outputs. If the print sheet recomputed anything it
  // could quietly disagree with the table the pilot checked on screen.
  ev(SEED);
  const host = doc.getElementById('ofp-print');
  assert(host, 'the print container is missing');
  const rows = host.querySelectorAll('.ofp-grid tbody tr');
  assert(rows.length === 16, 'the form did not draw its 16 lines: ' + rows.length);
  const cells = [...rows[0].children].map((td) => td.textContent.trim());
  assert(cells.length === 25, 'a printed row is not 25 cells: ' + cells.length);
  assert(/ENDU/.test(cells[0]) && cells[12] === 'FINNSNES',
    'the first line is not the first leg: ' + JSON.stringify([cells[0], cells[12]]));
  // THE REAL CROSS-CHECK: the figure the screen shows as the sector total and
  // the figure the form prints on its Total line are the same number, because
  // they come from the same pass. Comparing them is what stops the printed
  // sheet drifting from the table the pilot actually checked.
  const screenBurn = txtOf('f-tot-accburn-0').trim();
  const totalCells = [...host.querySelectorAll('.ofp-total')][0].children;
  const printBurn = [...totalCells].map((td) => td.textContent.trim()).filter(Boolean);
  assert(screenBurn && printBurn.includes(screenBurn),
    'the form total does not match the screen total: screen ' + JSON.stringify(screenBurn) +
    ' vs printed ' + JSON.stringify(printBurn));
  assert(host.textContent.includes('Operational flightplan'), 'the form title is missing');
  assert(/DEP/.test(host.textContent) && /Off block/.test(host.textContent),
    'the DEP/DEST block is missing');
});
T('the printed form carries no personal data, and no registration', () => {
  // The form has CREW, PASSENGERS, PIC and Reg boxes. The planner holds none of
  // that: crew are people and a tail number identifies a machine, so both stay
  // empty boxes for the pen. PROFILE_KEYS must never grow to carry either.
  ev(SEED);
  const host = doc.getElementById('ofp-print');
  const crew = host.querySelector('.ofp-crew');
  assert(crew, 'the crew block is missing from the form');
  const filled = [...crew.querySelectorAll('td')].map((td) => td.textContent.trim())
    .filter((t) => t && t !== 'PIC:');
  assert(filled.length === 0, 'the crew block was filled in: ' + JSON.stringify(filled));
  const keys = moduleExports.exch.PROFILE_KEYS || [];
  for (const bad of ['reg', 'registration', 'tail', 'pic', 'crew', 'pilot'])
    assert(!keys.includes(bad), 'PROFILE_KEYS gained "' + bad + '"');
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
TA('the page prints one OFP per flight plan, each with its own DEP and DEST', async () => {
  // Built end to end: three sectors, the third long enough to need two sheets.
  ev(`flights = [
    { id: 1, title: 'A', depElev: 254, waypoints: [
      { lat: 68.5, lng: 18.5, name: 'ENDU', alt: 254, oat: 0, wdir: 250, wspd: 20, var: -11 },
      { lat: 69.2, lng: 18.5, name: 'MID',  alt: 3500, oat: 0, wdir: 250, wspd: 20, var: -11 },
      { lat: 69.7, lng: 18.5, name: 'ENTC', alt: 31,  oat: 0, wdir: 250, wspd: 20, var: -11 }] },
    { id: 2, title: 'B', depElev: 31, waypoints: [
      { lat: 69.7, lng: 18.5, name: 'ENTC', alt: 31,  oat: 0, wdir: 250, wspd: 20, var: -11 },
      { lat: 70.2, lng: 18.5, name: 'SKJ',  alt: 4500, oat: 0, wdir: 250, wspd: 20, var: -11 },
      { lat: 70.6, lng: 18.5, name: 'ENSR', alt: 10,  oat: 0, wdir: 250, wspd: 20, var: -11 }] }];
    activeFlightIndex = 0; renderAllFlightTables();`);
  const sheets = [...doc.querySelectorAll('#ofp-print .ofp-sheet')];
  assert(sheets.length === 2, 'two flight plans made ' + sheets.length + ' sheets, not 2');
  const pair = (s) => { const td = s.querySelectorAll('.ofp-depdest td');
                        return td[0].textContent + '->' + td[3].textContent; };
  assert(pair(sheets[0]) === 'ENDU->ENTC', 'sheet 1: ' + pair(sheets[0]));
  assert(pair(sheets[1]) === 'ENTC->ENSR', 'sheet 2: ' + pair(sheets[1]));
  // ...and no sheet may show a fix belonging to the other sector.
  assert(!/SKJ|ENSR/.test(sheets[0].querySelector('.ofp-grid').textContent),
    'sector 2 fixes leaked onto sector 1\'s sheet');
  assert(!/\bMID\b/.test(sheets[1].querySelector('.ofp-grid').textContent),
    'sector 1 fixes leaked onto sector 2\'s sheet');
});
TA('line 1 is DEP -> first waypoint, the last leg arrives at DEST, and a circuit hangs off DEST', async () => {
  // The user's rule for how a sector reads down the sheet.
  ev(`flights = [{ id: 1, title: 'A', depElev: 254, waypoints: [
    { lat: 69.055, lng: 18.545, name: 'ENDU', alt: 254, oat: 5, wdir: 250, wspd: 15, var: -11 },
    { lat: 69.230, lng: 17.980, name: 'FINNSNES', alt: 2500, oat: 2, wdir: 250, wspd: 18, var: -11 },
    { lat: 69.679, lng: 18.911, name: 'ENTC', alt: 31, oat: 4, wdir: 260, wspd: 12, var: -12 },
    { lat: 69.685, lng: 18.915, name: 'PATTERN', alt: 1000, oat: 4, wdir: 260, wspd: 12, var: -12,
      isPattern: true, laps: 3 }] }];
    activeFlightIndex = 0; renderAllFlightTables();`);
  const sheet = doc.querySelector('#ofp-print .ofp-sheet');
  const rows = [...sheet.querySelectorAll('.ofp-grid tbody tr')]
    .map((r) => [...r.children].map((c) => c.textContent.trim()))
    .filter((c) => c[0].replace(/^\d+/, '').trim());
  const from = (r) => r[0].replace(/^\d+/, '').trim(), to = (r) => r[12];
  assert(rows.length === 3, 'expected three filled lines, got ' + rows.length);
  // Line 1 leaves the DEPARTURE aerodrome for the first waypoint.
  const dd = sheet.querySelectorAll('.ofp-depdest td');
  assert(dd[0].textContent.trim() === 'ENDU' && from(rows[0]) === 'ENDU',
    'line 1 does not start at the departure aerodrome: ' + from(rows[0]));
  assert(to(rows[0]) === 'FINNSNES', 'line 1 does not run to the first waypoint: ' + to(rows[0]));
  // ...and the last flown leg ARRIVES at the destination aerodrome.
  assert(to(rows[1]) === 'ENTC' && dd[3].textContent.trim() === 'ENTC',
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
T('the drawn path walks waypoints AND via points, and skips patterns', () => {
  const L2 = moduleExports.legs;
  const fl = { waypoints: [
    { lat: 69.0, lng: 18.0, name: 'A' },
    { lat: 69.5, lng: 18.5, name: 'B', via: [{ lat: 69.2, lng: 18.9 }, { lat: 69.4, lng: 19.1 }] },
    { lat: 69.6, lng: 18.6, name: 'PATTERN', isPattern: true, laps: 3 },
    { lat: 70.0, lng: 19.0, name: 'C' }
  ]};
  const line = L2.flightLineCoords(fl);
  // A, v1, v2, B, C - the pattern is not a place on the ground
  assert(line.length === 5, 'path length ' + line.length + ': ' + JSON.stringify(line));
  assert(line[1][0] === 69.2 && line[2][0] === 69.4, 'via points are not between their waypoints');
  assert(!line.some(p => p[0] === 69.6), 'a PATTERN waypoint was drawn as a place on the ground');
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
  // a leg touching a PATTERN cannot be bent or split
  assert(L2.findPathInsertion([{ lat: 69, lng: 18 }, { lat: 70, lng: 19, isPattern: true }],
    { lat: 69.5, lng: 18.5 }) === null, 'a pattern leg was offered as bendable');
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
TA('right-clicking a WAYPOINT renames it, and offers to delete it (v16.40)', async () => {
  // The gesture had to go on the MARKER: right-clicking the route line opens
  // the leg panel, and a waypoint sits on that line. Exactly one panel may open.
  ev(SEED);
  const legOpen = () => doc.getElementById('leg-modal').style.display === 'flex';
  const p = ev(`markers[1]._h.contextmenu({ originalEvent: {} })`);
  await tick();
  assert(!legOpen(), 'right-clicking the waypoint also opened the leg panel');
  assert(/FINNSNES/.test(doc.getElementById('app-dialog').textContent),
    'the menu did not name the waypoint: ' + doc.getElementById('app-dialog').textContent);
  typeInDialog('MIDWAY');
  answerDialog('Rename');
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
  const raw = fs.readFileSync(APP_HTML, 'utf8');
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
  assert(Math.abs(ev('flights[0].waypoints[1].bocNM') - boc) < 1e-9,
    'the BOC did not reach the waypoint: ' + ev('flights[0].waypoints[1].bocNM'));
  const S = L2.computeFlightSchedule({ id: 1, waypoints: JSON.parse(ev('JSON.stringify(flights[0].waypoints)')) })[0];
  assert(Math.abs(S.climbStartNM - boc) < 1e-9, 'the schedule ignored the pin: ' + S.climbStartNM);
  assert(ev('flights[0].waypoints[1].alt') === before, 'Apply changed the altitude it was only showing');
  ev('undoLast(true);');
  assert(!ev('flights[0].waypoints[1].bocNM'), 'applying pins was not undoable');
});
T('clearing the pins puts the leg back on the derived schedule', () => {
  ev(SEED);
  ev(`hitLines[0]._h.contextmenu({ latlng: { lat: 69.14, lng: 18.26 }, originalEvent: { preventDefault: function(){} } })`);
  ev("pinLegHere('boc'); pinLegHere('bod'); pinLegHere('toc'); saveLegSettings();");
  assert(ev('flights[0].waypoints[1].bocNM') > 0, 'the pins were not applied');
  ev(`hitLines[0]._h.contextmenu({ latlng: { lat: 69.14, lng: 18.26 }, originalEvent: { preventDefault: function(){} } })`);
  ev('clearLegPins(); saveLegSettings();');
  // Cleared means ABSENT, not zero, so a saved route reads identically to one
  // made before pins existed.
  for (const k of ['bocNM', 'bodNM', 'tocNM'])
    assert(ev('flights[0].waypoints[1].' + k) === null, k + ' is ' + ev('flights[0].waypoints[1].' + k));
});
T('a pattern stop has no ground track, so the panel refuses it', () => {
  ev(SEED);
  ev(`flights[0].waypoints.splice(1, 0, { name: 'PATTERN', lat: 69.1, lng: 18.3, alt: 1200, oat: 0, wdir: 0, wspd: 0, var: -11, isPattern: true, laps: 3 }); refreshMap();`);
  const before = ev('flights[0].waypoints.length');
  ev(`hitLines[0]._h.contextmenu({ latlng: { lat: 69.08, lng: 18.55 }, originalEvent: { preventDefault: function(){} } })`);
  // Either it found a real leg elsewhere, or it declined - what it must never
  // do is open a climb-placement panel for something with no distance.
  const title = doc.getElementById('leg-modal-title').textContent;
  assert(!/PATTERN/.test(title), 'the panel opened on a pattern stop: ' + title);
  assert(ev('flights[0].waypoints.length') === before, 'the route changed');
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
  const raw = fs.readFileSync(APP_HTML, 'utf8');
  assert(!raw.includes('insertWaypointMidLeg'), 'the + button command is still in the build');
});
T('the guide explains both gestures', () => {
  const built = fs.readFileSync(APP_HTML, 'utf8');
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
  const built = fs.readFileSync(APP_HTML, 'utf8');
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
  const built = fs.readFileSync(APP_HTML, 'utf8');
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
  for (const lib of ['performance.js', 'legs.js', 'daylight.js', 'winds.js', 'integrity.js',
                     'exchange.js', 'plotting.js', 'format.js', 'geodesy.js', 'magvar.js', 'dialog.js']) {
    assert(page.includes('src/lib/' + lib), 'the index does not point at ' + lib);
    assert(fs.existsSync('src/lib/' + lib), 'missing module: ' + lib);
  }
  // and the built artifact must still carry the styling inline
  const built = fs.readFileSync(APP_HTML, 'utf8');
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
  // the double-click build must NOT try to register one
  assert(!fs.readFileSync(APP_HTML, 'utf8').includes("navigator.serviceWorker.register"),
    'the file:// artifact must not attempt service-worker registration');
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
  const built = fs.readFileSync(APP_HTML, 'utf8');
  assert(!built.includes('\r\n'), 'the committed artifact contains CRLF line endings');
});
T('Windows can run both deliveries without a command line or git', () => {
  // The user downloads the repo as a ZIP and double-clicks; git and npm on
  // the PATH cannot be assumed.
  for (const f of ['build.cmd', 'serve.cmd']) assert(fs.existsSync(f), 'missing Windows helper: ' + f);
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

T('the built artifact is generated, self-contained and double-clickable', () => {
  const built = fs.readFileSync(APP_HTML, 'utf8');
  assert(built.includes('GENERATED by tools/build.mjs'), 'build banner missing');
  assert(!built.includes('@BUNDLE'), 'bundle marker survived into the artifact');
  // no external script/link srcs: everything needed is inline (data/ sidecars
  // stay optional and are loaded lazily at runtime, not at parse time)
  const externals = [...built.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1]);
  assert(externals.length === 0, 'artifact loads external scripts: ' + externals.join(', '));
  assert(built.includes('window.C182'), 'module namespace missing from the bundle');
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
  const built = fs.readFileSync(APP_HTML, 'utf8');
  assert(built.includes('geographiclib') || built.includes('InverseLine'), 'geodesy library not bundled into the artifact');
});
T('the build rejects a version mismatch between page and package.json', () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
  const page = fs.readFileSync(APP_HTML, 'utf8').match(/const APP_VERSION = '([^']+)'/)[1];
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
TA('saving offers every option at once, update-in-place first', async () => {
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
  assert(opts[0].includes('Update "MY ROUTE"'), 'update-in-place is not the first option: ' + opts[0]);
  assert(opts.some(o => o.includes('new route')) && opts.some(o => o.includes('whole mission')),
    'save-as-new options missing: ' + opts.join(' | '));
  answerDialog('Update "MY ROUTE"');
  await p;

  const saved = ev(`getStoredSingleRoutes()['MY ROUTE']`);
  assert(saved[1].alt === 4500, 'the saved route was not updated: ' + saved[1].alt);
  assert(Object.keys(ev('getStoredSingleRoutes()')).length === 1, 'a duplicate entry was created');
  assert(toastText().includes('updated'), 'no confirmation toast: ' + toastText());
});
TA('choosing "save as new" asks for a name and keeps both entries', async () => {
  const p = w.saveCurrentMission();
  await tick();
  answerDialog('Save active flight as a new route');
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
TA('Escape cancels and the number keys pick options', async () => {
  let p = ev(`ask({ title: 'Esc test', buttons: [{ id: 'ok', label: 'OK', variant: 'primary' }, { id: 'cancel', label: 'Cancel' }] })`);
  await tick();
  doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert((await p).id === 'cancel', 'Escape did not cancel');

  p = ev(`ask({ title: 'Key test', buttons: [{ id: 'one', label: 'First' }, { id: 'two', label: 'Second' }] })`);
  await tick();
  doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: '2', bubbles: true, cancelable: true }));
  assert((await p).id === 'two', 'number key did not select the second option');

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

runAsyncTests().then(() => {
  console.log('\n=== Uncaught page errors ===');
  console.log(errors.length ? errors : '  none');
  console.log('\nRESULT: ' + (errors.length ? 'FAILURES PRESENT' : 'ALL CHECKS PASSED'));
  process.exit(errors.length ? 1 : 0);
});
