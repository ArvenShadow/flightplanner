/**
 * The profile the Chromium verifiers were MEASURED on (v17.29).
 *
 * verify:layout and verify:leg assert pixel facts - a header height, where a
 * card sits on a 1280x720 screen, where a tick is under the cursor. Those were
 * measured on the app's starting look at the time: light, Default skin, Normal
 * size, topo chart, fixes and corridor off, a 4 px track, the 500 fpm cruise
 * climb. At v17.29 the author changed the starting values (dark, Slate, Bold,
 * ICAO chart, fixes and corridor on...), and every one of those facts moved
 * with them - not because anything broke, but because Bold is bigger on
 * purpose and a fix marker now sits where a click used to land on bare map.
 *
 * So the verifiers state the profile they are about instead of inheriting
 * whatever a fresh browser starts on. They test MECHANISMS; the defaults
 * themselves are tested in test.js. Written only when nothing is stored, so a
 * check that changes a setting and reloads still sees its own change.
 */
export const BASELINE_PROFILE = {
  theme: 'light', skin: 'default', density: 'normal', baseChart: 'topo', chartDetail: 'auto',
  fixesOn: false, corridorOn: false, routeWeight: 4, fixSize: 10,
  cruiseRpm: 2300, cruiseMp: 23, ccRoc: 500
};

/** @param {import('playwright').Page} page */
export async function pinBaseline(page) {
  await page.addInitScript((profile) => {
    try {
      if (localStorage.getItem('c182_perf_profile') === null) {
        localStorage.setItem('c182_perf_profile', JSON.stringify(profile));
      }
    } catch (e) { /* no storage: the app's own defaults apply */ }
  }, BASELINE_PROFILE);
}
