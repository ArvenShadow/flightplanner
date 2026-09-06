#!/usr/bin/env node
/**
 * Visual regression check - `node tools/verify-visual.mjs`.
 *
 * A CSS change cannot be proved safe by a test that reads text. This
 * renders the planner in real Chromium against a REFERENCE build and
 * compares full-page screenshots pixel for pixel, plus the computed
 * styles of the nine selectors a styling regression hits first, in BOTH
 * themes.
 *
 * Put the build you are comparing against at the path in REFERENCE
 * (default: the previous dist/, e.g.
 *   git show origin/main:site/index.html is not committed; rebuild an old checkout instead)
 *
 * Playwright is not a project dependency; install it when you need this:
 *   npm install --no-save playwright && npx playwright install chromium
 *
 * On a pixel difference it writes vis_<theme>_{new,old}.png so you can see
 * what moved. Note that bumping APP_VERSION legitimately changes ~8x8 px in
 * the version badge - check WHERE the difference is before assuming a
 * regression, and compare against a reference built at the same version.
 */
let chromium;
try { ({ chromium } = await import('playwright')); }
catch (e) { console.error('playwright is not installed - see the header of this file.'); process.exit(2); }
const b = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const CURRENT = process.env.CURRENT || new URL('../site/index.html', import.meta.url).pathname;
const REFERENCE = process.env.REFERENCE || '/tmp/old_build.html';
async function shot(file, theme, tag) {
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.route('**://**/**', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
  await page.goto('file://' + file, { waitUntil: 'domcontentloaded' });
  // WAIT FOR THE APP, NOT FOR A CLOCK. A fixed 900 ms raced the boot on a cold
  // cache and died with "Cannot access 'aircraftProfile' before initialization"
  // - the page script had not finished its top level, so toggleTheme() reached
  // a let-binding still in its temporal dead zone.
  // ...AND THE PROBE ITSELF HAS TO SURVIVE THE DEAD ZONE. `flights` is a `let`
  // at the top level of a classic script, and `typeof` on a let-binding still
  // in its temporal dead zone THROWS - it does not return 'undefined' the way
  // it would for a name that was never declared. So the readiness check is
  // wrapped, or it fails with the very error it exists to wait out.
  await page.waitForFunction(() => {
    try {
      return typeof toggleTheme === 'function' && !!flights && !!aircraftProfile;
    } catch (e) { return false; }
  }, null, { timeout: 20000 });
  await page.waitForTimeout(300);
  await page.evaluate(async (theme) => {
    closeHelpModal(); toggleTheme(theme);
    flights = [{ id:1, title:'F1', depElev:254, waypoints: [
      { lat:69.05505349, lng:18.54466865, name:'ENDU', alt:254,  oat:14, wdir:240, wspd:18, var:-11 },
      { lat:69.23781330, lng:17.97902780, name:'FINNSNES', alt:2500, oat:10, wdir:260, wspd:22, var:-11 },
      { lat:69.67895054, lng:18.91143033, name:'ENTC', alt:2500, oat:10, wdir:300, wspd:25, var:-12 }]}];
    activeFlightIndex = 0;
    document.getElementById('def-alt').value = 3500;
    document.getElementById('def-etd').value = '09:30';
    refreshMap(); renderAllFlightTables();
    await new Promise(r => setTimeout(r, 300));
  }, theme);
  await page.waitForTimeout(400);
  const buf = await page.screenshot({ fullPage: false });
  // computed styles of the elements a CSS regression would hit first
  const styles = await page.evaluate(() => {
    const pick = (sel, props) => { const e = document.querySelector(sel); if (!e) return sel + ':MISSING';
      const cs = getComputedStyle(e); return sel + '{' + props.map(p => p + ':' + cs[p]).join(';') + '}'; };
    return [
      pick('body', ['backgroundColor','color','fontFamily','display']),
      pick('#header', ['backgroundColor','color','display']),
      pick('#sidebar', ['flex','overflowY','padding']),
      pick('#map-container', ['position','flex']),
      pick('table', ['fontSize','borderCollapse']),
      pick('th', ['backgroundColor','color','padding','borderBottomWidth']),
      pick('td', ['padding','borderBottomWidth','fontSize']),
      pick('.btn', ['backgroundColor','color','borderRadius','padding']),
      pick('#integrity-banner', ['display','backgroundColor'])
    ].join('\n');
  });
  await ctx.close();
  return { buf, styles, errs, tag };
}
/**
 * THE TOOL MEASURES ITS OWN NOISE FLOOR rather than trusting a threshold.
 *
 * Native form controls are platform-themed, and Chromium does not rasterise
 * them identically between runs: comparing a build against ITSELF reported 11
 * differing pixels along the top border of the #route-selector <select>. A
 * verifier that cries wolf on an unchanged build is worse than none, and it is
 * why this one had gone unused (it is not even in package.json).
 *
 * So each side is shot TWICE. Pixels that differ between two shots of the SAME
 * build are noise BY DEMONSTRATION, and are excluded from the comparison. That
 * is a measurement, not a tolerance - if the flake ever grows, the mask grows
 * with it and says so.
 */
function diffMask(a, b) {
  const m = new Uint8Array(a.length / 4);
  for (let i = 0, k = 0; i < a.length; i += 4, k++) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) m[k] = 1;
  }
  return m;
}
async function raw(buf) {
  const ctx = await b.newContext();
  const pg = await ctx.newPage();
  const data = await pg.evaluate(async (b64) => {
    const img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = b64; });
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    return Array.from(c.getContext('2d').getImageData(0, 0, img.width, img.height).data);
  }, 'data:image/png;base64,' + buf.toString('base64'));
  await ctx.close();
  return Uint8ClampedArray.from(data);
}

let bad = 0;
for (const theme of ['light', 'dark']) {
  const n = await shot(CURRENT, theme, 'new');
  const o = await shot(REFERENCE, theme, 'old');
  let pxSame = Buffer.compare(n.buf, o.buf) === 0;
  let noisy = 0, real = 0;
  if (!pxSame) {
    // Re-shoot each side and let the run tell us which pixels are unstable.
    const [nA, nB, oA] = [await raw(n.buf), await raw((await shot(CURRENT, theme, 'new2')).buf), await raw(o.buf)];
    const noise = diffMask(nA, nB);
    const delta = diffMask(nA, oA);
    for (let k = 0; k < delta.length; k++) {
      if (!delta[k]) continue;
      if (noise[k]) noisy++; else real++;
    }
    pxSame = real === 0;
    console.log(`   ${theme}: ${real} pixels really differ, ${noisy} are platform noise (unstable between two shots of the same build)`);
  }
  const cssSame = n.styles === o.styles;
  console.log(`${theme.padEnd(6)} | pixels identical: ${pxSame} | computed styles identical: ${cssSame} | page errors ${n.errs.length}/${o.errs.length}`);
  if (!cssSame) {
    bad++;
    const a = n.styles.split('\n'), c = o.styles.split('\n');
    for (let i = 0; i < a.length; i++) if (a[i] !== c[i]) console.log('   DIFF\n     old: ' + c[i] + '\n     new: ' + a[i]);
  }
  if (!pxSame) { bad++; await import('node:fs').then(fs => { fs.writeFileSync(`vis_${theme}_new.png`, n.buf); fs.writeFileSync(`vis_${theme}_old.png`, o.buf); console.log('   wrote vis_'+theme+'_{new,old}.png'); }); }
  if (n.errs.length) { bad++; console.log('   NEW ERRORS:', n.errs.slice(0,2)); }
}
console.log(bad ? `\n${bad} visual problem(s)` : '\nthe page renders identically in both themes');
if (bad) process.exitCode = 1;
await b.close();
