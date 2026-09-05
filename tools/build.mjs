#!/usr/bin/env node
/**
 * Build: src/ -> site/   (the only delivery, since v16.45)
 *
 * site/ is the hosted build - GitHub Pages, or a static server on the LAN via
 * `npm run serve`. It emits four files:
 *
 *   index.html   the page, with styles inlined at @STYLES
 *   app.js       the module bundle (esbuild), linked at @BUNDLE
 *   aip.js       the AIP dataset, linked at @AIPDATA
 *   sw.js        the service worker, stamped with the app version
 *
 * WHY THE SINGLE-FILE BUILD IS GONE (v16.45, the author's decision). There used
 * to be a second delivery, dist/C182_FlightPlanner.html - one self-contained
 * file opened by double-clicking. Its stated purpose was a fallback on a machine
 * that had never seen the app. In practice it was never used, and it was not
 * even the better offline option: a file:// page cannot register a service
 * worker, so it could not cache a single chart tile, while the hosted copy can.
 * Keeping it also forced the dataset to be INLINED, because file:// forbids
 * fetch() - 366 KB, 42% of the page, re-downloaded on every app release even
 * though AIRAC data changes on its own 28-day schedule.
 *
 * THE BUNDLE IS STILL A CLASSIC SCRIPT (esbuild --format=iife), and that is NOT
 * left over from file://. The page script is a classic script whose top level
 * calls into the bundle and whose inline on*= handlers need its functions as
 * globals; a type="module" script is DEFERRED, so it would run AFTER the page
 * script - too late. site/ can move to a real module graph only once the page
 * script is extracted and the handlers are bound in code.
 *
 * The build also enforces the project's ship checklist, so a broken artifact
 * can never reach site/:
 *   - the bundle and the page script must both parse
 *   - no duplicate DOM ids
 *   - APP_VERSION must match package.json
 *   - every marker must actually have been replaced
 *
 *   node tools/build.mjs [--watch]
 */
import { build as esbuild } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_HTML = join(ROOT, 'src', 'index.html');
const ENTRY = join(ROOT, 'src', 'main.js');
const SITE_DIR = join(ROOT, 'site');
const SW_SRC = join(ROOT, 'src', 'sw.js');
const CSS_SRC = join(ROOT, 'src', 'styles.css');
// Styling lives in src/styles.css so it can be edited on its own; it is
// inlined back into <style> for BOTH deliveries, so what ships is exactly
// what shipped when the CSS sat in the page - no extra request, no FOUC.
const STYLE_MARKER = /^([ \t]*)<!-- @STYLES:.*?-->[ \t]*\r?\n/m;
// \r? because a Windows clone checks the source out with CRLF endings
// (git's core.autocrlf). A ZIP download does not, which is why this only
// ever failed on a cloned repo.
const MARKER = /^[ \t]*<!-- @BUNDLE:.*?-->[ \t]*\r?\n/m;
// The AIP airspace dataset. It is INLINED into both deliveries rather than
// loaded with <script src>: a file:// page can neither fetch() it nor load it
// as a module, and keeping one code path means the hosted service worker needs
// no extra shell asset to make the overlay work offline.
const AIP_MARKER = /^([ \t]*)<!-- @AIPDATA:.*?-->[ \t]*\r?\n/m;
const AIP_DATA = 'data/aip.js';

const fail = (msg) => { console.error('BUILD FAILED: ' + msg); process.exit(1); };
// Service-worker registration for the hosted build. Feature-detected on
// purpose: on a plain-http LAN address (hosting off a laptop over wifi or
// a phone hotspot) the browser refuses to register one, and on file:// the
// API is absent entirely. The planner must work in all three cases - the
// worker only ever adds offline chart caching.
const SW_REGISTRATION = `    (function () {
      if (!('serviceWorker' in navigator) || !self.isSecureContext) return;
      navigator.serviceWorker.register('sw.js').catch(function () { /* offline caching is optional */ });
    })();
`;


async function bundle() {
  const result = await esbuild({
    entryPoints: [ENTRY],
    bundle: true,
    format: 'iife',          // classic script: required for file:// pages
    target: 'es2019',
    charset: 'utf8',
    legalComments: 'inline',
    write: false,
    logLevel: 'warning'
  });
  return result.outputFiles[0].text;
}

function scriptBlocks(html) {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
}

function checkSyntax(code, label) {
  try {
    execFileSync(process.execPath, ['--check', '-'], { input: code, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    fail(label + ' does not parse:\n' + String(e.stderr || e.message).split('\n').slice(0, 6).join('\n'));
  }
}

function checkDuplicateIds(html) {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  const dupes = [...new Set(ids.filter((v, i, a) => a.indexOf(v) !== i))];
  if (dupes.length) fail('duplicate DOM ids: ' + dupes.join(', '));
}

function checkVersion(html) {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  const m = html.match(/const APP_VERSION = '([^']+)'/);
  if (!m) fail('APP_VERSION not found in the page');
  const norm = (v) => String(v).split('.').slice(0, 2).join('.');
  if (norm(m[1]) !== norm(pkg)) {
    fail(`APP_VERSION ${m[1]} does not match package.json ${pkg} - a release bumps both.`);
  }
  return m[1];
}

export async function runBuild({ quiet = false } = {}) {
  let srcHtml = readFileSync(SRC_HTML, 'utf8');
  if (!MARKER.test(srcHtml)) fail('src/index.html has no @BUNDLE marker');
  if (!STYLE_MARKER.test(srcHtml)) fail('src/index.html has no @STYLES marker');

  // THE DATASET IS A SIDECAR, NOT INLINED (v16.45). It used to be pasted into
  // the HTML because a file:// page cannot fetch() and the single-file delivery
  // had to carry everything. That delivery is gone, and inlining was costing
  // real money: aip.js is 366 KB, 42% of the page, and the shell and the data
  // change on completely different schedules - an app release re-downloaded
  // 366 KB of unchanged AIRAC data, and an AIRAC update re-downloaded the whole
  // shell. As its own file each is cached and revalidated on its own.
  if (!AIP_MARKER.test(srcHtml)) fail('src/index.html has no @AIPDATA marker');
  let aip = '';
  {
    const indent = srcHtml.match(AIP_MARKER)[1];
    try { aip = readFileSync(AIP_DATA, 'utf8'); }
    catch (err) {
      // Not fatal: the planner hides the airspace control when the dataset is
      // absent. Loud, though - shipping without it is a silent feature loss.
      console.warn(`WARNING: ${AIP_DATA} is missing - the airspace overlay will be unavailable. Run: npm run build:aip`);
      aip = 'window.C182_AIP = null;\n';
    }
    if (!/window\.C182_AIP\s*=/.test(aip)) fail(`${AIP_DATA} does not assign window.C182_AIP`);
    // Must load BEFORE the page script reads window.C182_AIP. Classic scripts
    // run in document order and the marker sits above @BUNDLE, so it does.
    srcHtml = srcHtml.replace(AIP_MARKER, indent + '<script src="aip.js"></script>\n');
    if (AIP_MARKER.test(srcHtml)) fail('the @AIPDATA marker was not replaced');
  }

  const css = readFileSync(CSS_SRC, 'utf8');
  if (/<\/style/i.test(css)) fail('styles.css contains a literal </style sequence');
  const styleIndent = srcHtml.match(STYLE_MARKER)[1];
  srcHtml = srcHtml.replace(STYLE_MARKER, styleIndent + '<style>\n' + css + styleIndent + '</style>\n');
  if (STYLE_MARKER.test(srcHtml)) fail('the @STYLES marker was not replaced');

  const code = await bundle();
  checkSyntax(code, 'bundle (src/main.js)');

  const banner = '  <!-- GENERATED by tools/build.mjs from src/ - do not edit this file; edit src/ and rebuild. -->\n';
  const version = checkVersion(srcHtml);

  // Always emit LF, whatever the working tree uses, so a Windows clone with
  // CRLF in the source does not produce a different artifact.
  const lf = (t) => t.replace(/\r\n/g, '\n');

  // ---- the hosted build, and the only one --------------------------------
  // Bundle split out to app.js, dataset to aip.js, service worker attached.
  const siteHtml = srcHtml.replace(MARKER,
    banner +
    '  <script src="app.js"></script>\n' +
    '  <script>\n' + SW_REGISTRATION + '  </script>\n');
  if (MARKER.test(siteHtml)) fail('marker was not replaced in the site build');
  const siteBlocks = scriptBlocks(siteHtml);
  checkSyntax(siteBlocks[siteBlocks.length - 1], 'site page script');
  checkDuplicateIds(siteHtml);
  // the hosted page must not carry the bundle inline as well - that would
  // define every function twice and silently double-register listeners
  if (siteHtml.includes('window.C182 = Object.assign')) fail('site/index.html has the bundle inlined as well as linked');

  // Stamp the worker with the app version so a release drops the old shell.
  // Fail LOUDLY if the placeholder moves: a silent miss here leaves every
  // visitor on a stale shell forever, and nothing else would notice.
  const swSrc = readFileSync(SW_SRC, 'utf8');
  const SW_VERSION_TOKEN = "sw.__APP_VERSION__ || 'dev'";
  if (!swSrc.includes(SW_VERSION_TOKEN)) {
    fail('src/sw.js no longer contains the version placeholder ' + SW_VERSION_TOKEN +
         ' - the worker would never be version-stamped and old shells would never be dropped.');
  }
  const sw = swSrc.replace(SW_VERSION_TOKEN, JSON.stringify(version));
  checkSyntax(sw, 'service worker (src/sw.js)');
  mkdirSync(SITE_DIR, { recursive: true });
  writeFileSync(join(SITE_DIR, 'index.html'), lf(siteHtml));
  writeFileSync(join(SITE_DIR, 'app.js'), lf(code));
  writeFileSync(join(SITE_DIR, 'aip.js'), lf(aip));
  writeFileSync(join(SITE_DIR, 'sw.js'), lf(sw));
  // Pages would otherwise run the upload through Jekyll, which skips files
  // and folders beginning with an underscore.
  writeFileSync(join(SITE_DIR, '.nojekyll'), '');

  if (!quiet) {
    console.log(`built site/  v${version}  index.html ${(siteHtml.length / 1024).toFixed(0)} KB ` +
      `+ app.js ${(code.length / 1024).toFixed(1)} KB + aip.js ${(aip.length / 1024).toFixed(0)} KB ` +
      `+ sw.js - checks passed`);
  }
  return join(SITE_DIR, 'index.html');
}

if (process.argv[1] && process.argv[1].endsWith('build.mjs')) {
  await runBuild();
  if (process.argv.includes('--watch')) {
    const { watch } = await import('node:fs');
    console.log('watching src/ ...');
    let t = null;
    for (const target of ['src', 'src/lib']) {
      watch(join(ROOT, target), () => {
        clearTimeout(t);
        t = setTimeout(() => runBuild().catch(e => console.error(e.message)), 120);
      });
    }
  }
}
