/**
 * Bundle entry point.
 *
 * Modules extracted from the original single inline script live under
 * src/lib/. The build (tools/build.mjs) bundles this file as a CLASSIC
 * script and inlines it ABOVE the app's main script block, so the
 * remaining inline code can keep calling these functions by name while
 * the migration proceeds module by module.
 *
 * Why a classic-script bundle and not ES modules: a page opened from
 * file:// may not load ES modules (the browser blocks them as
 * cross-origin), but it may run classic scripts. Keeping the built
 * artifact double-clickable is a hard requirement.
 */
import * as magvar from './lib/magvar.js';
import * as geodesy from './lib/geodesy.js';
import * as dialog from './lib/dialog.js';
import * as performance from './lib/performance.js';
import * as format from './lib/format.js';
import * as legs from './lib/legs.js';
import * as daylight from './lib/daylight.js';
import * as winds from './lib/winds.js';

const api = { ...magvar, ...geodesy, ...dialog, ...performance, ...format, ...legs, ...daylight, ...winds };

// Named globals for the not-yet-migrated inline code and the test suite.
for (const [name, value] of Object.entries(api)) {
  window[name] = value;
}
// Namespaced access for new code.
window.C182 = Object.assign(window.C182 || {}, api);
