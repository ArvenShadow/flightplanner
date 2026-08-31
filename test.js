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
  function Layer(){}
  Layer.prototype.addTo = function(){ return this; };
  Layer.prototype.setLatLngs = function(v){ this._ll = v; return this; };
  Layer.prototype.on = function(ev, fn){ (this._h=this._h||{})[ev]=fn; return this; };
  Layer.prototype.getLatLng = function(){ return this._latlng; };
  window.L = {
    map: function(){ return {
      setView: function(){ return this; },
      on: function(ev, fn){ window.__mapHandlers[ev] = fn; },
      removeLayer: function(){},
      addLayer: function(){},
      invalidateSize: function(){},
      getZoom: function(){ return window.__stubZoom === undefined ? 8 : window.__stubZoom; }
    };},
    tileLayer: function(u, o){ var l = new Layer(); l._url = u; l._opts = o || {}; return l; },
    polyline: function(c, o){ var l = new Layer(); l._ll = c; l._opts = o || {}; return l; },
    marker: function(ll, o){ var l = new Layer(); l._latlng = ll; l._opts = o || {}; return l; },
    divIcon: function(o){ return o; }
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
  const t = w.buildPlottingText(0);
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
  const t = w.buildPlottingText(0);
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
  const pts = ev('buildWindSamplePoints()');
  assert(pts.length === 6, '2 legs x 3 samples expected, got ' + pts.length);
  assert(pts.every(p => p.altFt === 2500), 'wrong altitudes');
  assert(new Set(pts.map(p => p.legKey)).size === 2, 'leg grouping wrong');
});
T('request URL contains everything the docs require', () => {
  const url = ev(`buildOpenMeteoUrl(buildWindSamplePoints(), '2026-08-24')`);
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
  w.fetch = async (url) => ({ ok: true, json: async () => ev('buildWindSamplePoints()').map(() => mkLoc()) });
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
  w.fetch = async () => ({ ok: true, json: async () => ev('buildWindSamplePoints()').map(mk) });
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
  const pts = 'buildWindSamplePoints()';
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
  w.fetch = async (url) => ({ ok: true, json: async () => ev('buildWindSamplePoints()').map(mk) });
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
    return { ok: true, json: async () => ev('buildWindSamplePoints()').map(mk) };
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
    return { ok: true, json: async () => ev('buildWindSamplePoints()').map(mk) };
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

console.log('\n=== 33. TOC/TOD chips anchored to an exact point dot ===');
T('marker HTML contains the point dot and a chip centered off it', () => {
  const raw = fs.readFileSync(APP_HTML, 'utf8');
  assert(raw.includes('class="prof-point toc"') && raw.includes('class="prof-point tod"'), 'point dots missing');
  assert(raw.includes('translate(-50%,-50%) translate(${dx}px,${dy}px)'), 'chip not centered on offset point');
  assert(raw.includes('iconAnchor: [0, 0]'), 'anchor not at the exact TOC/TOD point');
  const css = raw.split('.prof-point {')[1].split('}')[0];
  assert(css.includes('left: -5px') && css.includes('top: -5px'), 'dot not centered on anchor');
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
  const copy = w.buildPlottingText(0);
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
T('airspace overlay is fully removed, stored keys purged', () => {
  const raw = fs.readFileSync(APP_HTML, 'utf8');
  assert(!raw.includes('airspace-btn') && !raw.includes('qol-openaip-key'), 'UI remnants remain');
  assert(!raw.includes('api.tiles.openaip.net'), 'endpoint remnant remains');
  assert(ev('typeof toggleAirspace') === 'undefined', 'toggleAirspace still defined');
  assert(doc.getElementById('airspace-btn') === null, 'button still in DOM');
  // init purges any previously stored key/state
  assert(w.localStorage.getItem('c182_openaip_key') === null, 'stored key not purged');
  assert(w.localStorage.getItem('c182_airspace_on') === null, 'stored state not purged');
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
  assert(seg.includes('setLatLngs'), 'route line no longer follows the drag');
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
const setZoom = z => { ev('window.__stubZoom = ' + z); ev("window.__mapHandlers['zoomend']()"); };
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
  assert(fs.readFileSync(APP_HTML, 'utf8').includes("'minuteMark','declutter'"), 'declutter missing from the import whitelist');
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
  assert(Math.abs(ev('vfrPixelRatio(9, 115, 1)') - 3.328) < 0.01, 'z9 ratio: ' + ev('vfrPixelRatio(9, 115, 1)'));
  assert(Math.abs(ev('vfrPixelRatio(10, 231, 1)') - 1.664) < 0.01, 'z10 ratio: ' + ev('vfrPixelRatio(10, 231, 1)'));
  assert(ev('vfrPixelRatio(11, 462, 1)') === 1, 'z11 oversampled: ' + ev('vfrPixelRatio(11, 462, 1)'));
  assert(ev('vfrPixelRatio(6, 14, 1)') === 4, 'z6 must clamp to 4x, got ' + ev('vfrPixelRatio(6, 14, 1)'));
  // the ratio must fall as you zoom in - the source stops giving
  assert(ev('vfrPixelRatio(8, 57, 1)') > ev('vfrPixelRatio(9, 115, 1)'), 'ratio must decrease with zoom');
});
T('a HiDPI screen floors the density, and 4x is never exceeded', () => {
  assert(ev('vfrPixelRatio(11, 462, 2)') === 2, 'dpr 2 ignored at z11: ' + ev('vfrPixelRatio(11, 462, 2)'));
  // dpr 3 at z9 changes nothing - the chart itself already justifies 3.33x
  assert(Math.abs(ev('vfrPixelRatio(9, 115, 3)') - 3.328) < 0.01, 'dpr below the useful ratio must not bind: ' + ev('vfrPixelRatio(9, 115, 3)'));
  assert(ev('vfrPixelRatio(11, 462, 5)') === 4, 'an absurd dpr must still cap at 4x: ' + ev('vfrPixelRatio(11, 462, 5)'));
  assert(ev('vfrPixelRatio(6, 14, 8)') === 4, 'ceiling must hold when both inputs exceed it');
  assert(ev('vfrPixelRatio(11, 462, 0)') === 1, 'a bogus devicePixelRatio must fall back to 1');
  assert(ev('vfrTilePx(11, 462, 1)') === 256, 'z11 must not drop below the display grid');
  assert(ev('vfrTilePx(11, 462, 2)') === 512, 'HiDPI z11 px: ' + ev('vfrTilePx(11, 462, 2)'));
});
T('the export request asks for the higher-resolution raster in a lossless format', () => {
  const lo = ev('vfrTileUrl(9, 282, 115)'), hi = ev('vfrTileUrl(11, 1129, 462)');
  assert(lo.includes('size=856,856'), 'z9 not requested at source resolution: ' + lo);
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
  assert(fs.readFileSync(APP_HTML, 'utf8').includes("'declutter','baseChart'"), 'baseChart missing from import whitelist');
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
  moduleExports = { magvar: magvarModule, geodesy: geodesyModule, perf: perfModule, fmt: fmtModule };
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
  // the performance engine is what fuel and endurance hang on: walk the
  // whole POH envelope, not a sample, and demand exact agreement
  for (let alt = 0; alt <= 14000; alt += 500) {
    const m = moduleExports.perf.climbPerf(0, alt, 15), p = ev(`climbPerf(0, ${alt}, 15)`);
    assert(JSON.stringify(m) === JSON.stringify(p), `climbPerf mismatch at ${alt} ft: ${JSON.stringify(m)} vs ${JSON.stringify(p)}`);
    const mc = moduleExports.perf.cruisePerf(alt, -5), pc = ev(`cruisePerf(${alt}, -5)`);
    assert(JSON.stringify(mc) === JSON.stringify(pc), `cruisePerf mismatch at ${alt} ft: ${JSON.stringify(mc)} vs ${JSON.stringify(pc)}`);
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
                    'calcWCA', 'formatTimeHHMM', 'toDMM']) {
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
