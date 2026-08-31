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
const MARKER = /^[ \t]*<!-- @BUNDLE:.*-->[ \t]*\n/m;

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
  const srcHtml = readFileSync(SRC_HTML, 'utf8');
  if (!MARKER.test(srcHtml)) fail('src/index.html has no @BUNDLE marker');

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

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_HTML, html);

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

  const sw = readFileSync(SW_SRC, 'utf8').replace('self.__APP_VERSION__ || \'dev\'', JSON.stringify(version));
  checkSyntax(sw, 'service worker (src/sw.js)');
  mkdirSync(SITE_DIR, { recursive: true });
  writeFileSync(join(SITE_DIR, 'index.html'), siteHtml);
  writeFileSync(join(SITE_DIR, 'app.js'), code);
  writeFileSync(join(SITE_DIR, 'sw.js'), sw);
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
