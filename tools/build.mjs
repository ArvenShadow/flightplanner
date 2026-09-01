#!/usr/bin/env node
/**
 * Build: src/ -> dist/C182_FlightPlanner.html  AND  src/ -> site/
 *
 * TWO deliveries of the SAME source, because they fail in different ways:
 *
 *   dist/C182_FlightPlanner.html - ONE self-contained file, opened by
 *     double-clicking. No server, no install, no network. This is the
 *     fallback that works on a machine that has never seen the app.
 *
 *   site/ - the hosted build (GitHub Pages, or a static server on the LAN).
 *     Same page, but the bundle is a separate app.js and a service worker
 *     is registered, which is the ONLY way to cache VFR chart tiles for
 *     offline use - a file:// page cannot register one.
 *
 * The bundle is emitted as a CLASSIC script (esbuild --format=iife) for
 * BOTH. For dist/ that is forced by file:// (browsers block ES modules
 * there). For site/ it is forced by the page itself: the page script is a
 * classic script whose top level calls into the bundle and whose 61 inline
 * on*= handlers need its functions as globals, and a type="module" script
 * is deferred - it would run AFTER the page script, too late. Once Phase 1
 * finishes extracting the page script and the handlers are bound in code,
 * site/ can switch to a real module graph.
 *
 * The bundle is emitted as a CLASSIC script (esbuild --format=iife) and
 * inlined at the @BUNDLE marker, above the app's main script block: a
 * page opened from file:// cannot load ES modules (the browser blocks
 * them cross-origin) but runs classic scripts fine. Verified in Chromium.
 *
 * The build also enforces the project's ship checklist, so a broken
 * artifact can never reach dist/:
 *   - the bundle and the page script must both parse
 *   - no duplicate DOM ids
 *   - APP_VERSION must match package.json
 *   - the marker must actually have been replaced
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
const OUT_DIR = join(ROOT, 'dist');
const OUT_HTML = join(OUT_DIR, 'C182_FlightPlanner.html');
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

  if (!AIP_MARKER.test(srcHtml)) fail('src/index.html has no @AIPDATA marker');
  {
    const indent = srcHtml.match(AIP_MARKER)[1];
    let aip = '';
    try { aip = readFileSync(AIP_DATA, 'utf8'); }
    catch (err) {
      // Not fatal: the planner hides the airspace control when the dataset is
      // absent. Loud, though - shipping without it is a silent feature loss.
      console.warn(`WARNING: ${AIP_DATA} is missing - the airspace overlay will be unavailable. Run: npm run build:aip`);
      aip = 'window.C182_AIP = null;\n';
    }
    if (/<\/script/i.test(aip)) fail(`${AIP_DATA} contains a literal </script sequence`);
    if (!/window\.C182_AIP\s*=/.test(aip)) fail(`${AIP_DATA} does not assign window.C182_AIP`);
    srcHtml = srcHtml.replace(AIP_MARKER, indent + '<script>\n' + aip + indent + '</script>\n');
    if (AIP_MARKER.test(srcHtml)) fail('the @AIPDATA marker was not replaced');
  }

  const css = readFileSync(CSS_SRC, 'utf8');
  if (/<\/style/i.test(css)) fail('styles.css contains a literal </style sequence');
  const styleIndent = srcHtml.match(STYLE_MARKER)[1];
  srcHtml = srcHtml.replace(STYLE_MARKER, styleIndent + '<style>\n' + css + styleIndent + '</style>\n');
  if (STYLE_MARKER.test(srcHtml)) fail('the @STYLES marker was not replaced');

  const code = await bundle();
  checkSyntax(code, 'bundle (src/main.js)');

  // The bundle is inserted verbatim; guard the one sequence that could
  // terminate the host <script> element early.
  if (/<\/script/i.test(code)) fail('bundle contains a literal </script sequence');

  const banner = '  <!-- GENERATED by tools/build.mjs from src/ - do not edit this file; edit src/ and rebuild. -->\n';
  const html = srcHtml.replace(MARKER, banner + '  <script>\n' + code + '  </script>\n');
  if (MARKER.test(html)) fail('marker was not replaced');

  const blocks = scriptBlocks(html);
  checkSyntax(blocks[blocks.length - 1], 'page script (src/index.html)');
  checkDuplicateIds(html);
  const version = checkVersion(html);

  // Always emit LF, whatever the working tree uses. A Windows clone has the
  // source checked out as CRLF, and without this the rebuilt dist/ would
  // differ from the committed one on every build - which then blocks the
  // next `git pull` with "local changes would be overwritten".
  const lf = (t) => t.replace(/\r\n/g, '\n');

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_HTML, lf(html));

  // ---- hosted build -------------------------------------------------
  // Same page, bundle split out to app.js and a service worker attached.
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
  writeFileSync(join(SITE_DIR, 'sw.js'), lf(sw));
  // Pages would otherwise run the upload through Jekyll, which skips files
  // and folders beginning with an underscore.
  writeFileSync(join(SITE_DIR, '.nojekyll'), '');

  if (!quiet) {
    console.log(`built dist/C182_FlightPlanner.html  v${version}  ` +
      `${(html.length / 1024).toFixed(0)} KB (bundle ${(code.length / 1024).toFixed(1)} KB, ` +
      `${blocks.length} script blocks) - checks passed`);
    console.log(`built site/  v${version}  index.html ${(siteHtml.length / 1024).toFixed(0)} KB ` +
      `+ app.js ${(code.length / 1024).toFixed(1)} KB + sw.js - checks passed`);
  }
  return OUT_HTML;
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
