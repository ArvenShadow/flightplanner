#!/usr/bin/env node
/**
 * Lock the hosted build: site/ (plaintext) -> site-locked/ (ciphertext).
 * `npm run lock`, and the Pages workflow deploys site-locked/.
 *
 * WHY THIS EXISTS, AND WHAT IT DOES NOT DO.
 *
 * GitHub Pages on a personal account has no access control - authenticated
 * visitors are a GitHub Enterprise Cloud feature - so the only thing that can
 * gate the deployed URL is the artifact itself. This encrypts it: the deployed
 * files contain no app, only AES-256-GCM ciphertext, so a visitor without the
 * passphrase has nothing to read rather than something merely hidden.
 *
 * IT DOES NOT PROTECT THE SOURCE. The repository is public: src/, data/aip.js
 * and the whole planner are one click away on GitHub, and anyone can run it
 * locally. This gates the deployed URL and nothing else, and that limit is
 * stated here, in CLAUDE.md and in the app's guide rather than left to be
 * discovered. Making the repo private needs GitHub Pro for Pages; the author's
 * call at v16.78 was to keep it public for now.
 *
 * THE PASSPHRASE IS NEVER IN THE REPOSITORY OR THE ARTIFACT.
 *   local builds : .site-password (gitignored), or SITE_PASSWORD in the env
 *   CI           : the SITE_PASSWORD repository secret, which GitHub stores
 *                  encrypted and only the owner can read or set
 * The artifact carries the salt, the iteration count and the ciphertext. A
 * salt is public by design. NO PASSWORD HASH IS STORED AT ALL: the GCM
 * authentication tag is what fails on a wrong key, so there is nothing in the
 * artifact to attack except the payload, which an attacker would have to
 * attack anyway.
 *
 * THE ITERATION COUNT IS MEASURED, NOT COPIED. PBKDF2-SHA256 in Chromium runs
 * at ~154 ns an iteration (measured: 310k in 49 ms, 600k in 94 ms, 1.2M in
 * 185 ms, 2.4M in 369 ms). The derivation runs ONCE PER BROWSER - the derived
 * key is cached, not the passphrase - so the budget is a one-time unlock
 * rather than a per-load cost. 2 000 000 lands at ~310 ms on that laptop and
 * perhaps a second or so on a phone, which is 3.3x the OWASP floor for this
 * KDF while staying comfortable on the slowest device this project targets.
 *
 * AND THE ITERATION COUNT IS NOT THE THING THAT MAKES THIS SAFE. An attacker
 * holding the ciphertext can brute-force offline at their own pace, so the
 * strength is the passphrase's entropy first and the KDF second. That is why
 * this tool REFUSES a weak passphrase instead of quietly locking the site
 * behind something guessable - a lock that reports success on "1234" is the
 * plausible wrong answer this project exists to refuse.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { webcrypto as wc } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  ITERATIONS, PARTS, readPassphrase, fillTemplate, relinkWorker, scriptBlocks
} from './lock-rules.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROOT, 'site');
const OUT = join(ROOT, 'site-locked');
const TEMPLATE = join(ROOT, 'src', 'unlock.html');
const PW_FILE = join(ROOT, '.site-password');

const fail = (msg) => { console.error('LOCK FAILED: ' + msg); process.exit(1); };

/** Bytes -> base64, and back. Node has Buffer; the browser half does it by hand. */
const b64 = (bytes) => Buffer.from(bytes).toString('base64');

async function deriveKey(pass, salt) {
  const base = await wc.subtle.importKey(
    'raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return wc.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
}

/** iv (12 bytes) || ciphertext+tag. A FRESH IV PER PAYLOAD, which is not
 *  optional: GCM reusing an IV under one key leaks the XOR of the plaintexts
 *  and breaks the authentication outright. */
async function seal(key, text) {
  const iv = wc.getRandomValues(new Uint8Array(12));
  const ct = await wc.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
  return Buffer.concat([Buffer.from(iv), Buffer.from(ct)]);
}

// ---------------------------------------------------------------------------

const pwFile = existsSync(PW_FILE) ? readFileSync(PW_FILE, 'utf8') : null;
const got = readPassphrase(process.env.SITE_PASSWORD, pwFile);
if (!got.ok) fail(got.why);

if (!existsSync(join(SITE, 'index.html'))) {
  fail('site/ has no index.html - run `npm run build` (or `npm test`) first.');
}

const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const plain = {};
for (const p of PARTS) {
  const f = join(SITE, p.from);
  if (!existsSync(f)) fail(`site/${p.from} is missing - the plaintext build is incomplete.`);
  plain[p.as] = readFileSync(f, 'utf8');
}

// THE LOCKED BUILD MUST BE THE BUILD THAT WAS TESTED. site/ is generated by
// tools/build.mjs, which refuses to write unless the ship checklist passes -
// so locking a stale site/ would deploy an artifact no test ever saw.
const stamped = plain.body.match(/const APP_VERSION = '([^']+)'/);
if (!stamped) fail('site/index.html carries no APP_VERSION - is this really the build?');
if (!version.startsWith(stamped[1] + '.')) {
  fail(`site/ is v${stamped[1]} but package.json is v${version}. Rebuild before locking.`);
}

const salt = wc.getRandomValues(new Uint8Array(16));
const t0 = Date.now();
const key = await deriveKey(got.pass, salt);
const kdfMs = Date.now() - t0;

const sealed = {};
for (const p of PARTS) sealed[p.as] = await seal(key, plain[p.as]);

// ---- THE CHECK THAT MATTERS: is it actually unreadable? -------------------
// Asserting "we called encrypt()" proves nothing about what got written. These
// are strings a reader of the artifact would look for, one per payload, and
// they must not appear as bytes anywhere in the output.
const MUST_NOT_APPEAR = [
  'computeFlightSchedule',   // the bundle
  'C182_AIP',                // the dataset
  'Operational flightplan',  // the printed OFP form, from the page
  'APP_VERSION'              // the page script
];
for (const p of PARTS) {
  const hay = sealed[p.as].toString('latin1');
  for (const needle of MUST_NOT_APPEAR) {
    if (hay.includes(needle)) fail(`${p.file} still contains the plaintext "${needle}"`);
  }
}

const meta = {
  v: 1,
  salt: b64(salt),
  iterations: ITERATIONS,
  parts: PARTS.map((p) => ({ as: p.as, file: p.file, replaces: p.replaces }))
};
const gate = fillTemplate(readFileSync(TEMPLATE, 'utf8'), meta);

for (const needle of MUST_NOT_APPEAR) {
  if (gate.includes(needle)) fail(`the gate page leaks the plaintext "${needle}"`);
}
if (gate.includes(got.pass)) fail('the gate page contains the passphrase itself');

// THE GATE'S OWN SCRIPT MUST PARSE, and this check earns its place: the first
// version of unlock.html carried a literal closing script tag inside a JS
// COMMENT explaining that such a tag is harmless in the app payload. The HTML
// parser does not read comments - it ended the script element there, so the
// gate threw a SyntaxError, rendered the rest of its source as text, and
// unlocked nothing. Every string check in the locker passed; only the browser
// caught it.
//
// IT IS THE PARSE THAT CATCHES THAT, NOT THE BLOCK COUNT. A stray closing tag
// does not produce a second block - there is no second opening tag - it
// produces ONE block that stops mid-statement, so counting would have missed
// the original bug entirely. The count is still worth asserting, for a
// genuinely added second script element; node --check, exactly as
// tools/build.mjs runs it over the page script, is what guards truncation.
const blocks = scriptBlocks(gate);
if (blocks.length !== 1) {
  fail(`the gate page has ${blocks.length} script blocks, expected exactly 1`);
}
try {
  execFileSync(process.execPath, ['--check', '-'],
    { input: blocks[0], stdio: ['pipe', 'pipe', 'pipe'] });
} catch (e) {
  fail('the gate page script does not parse:\n' +
    String(e.stderr || e.message).split('\n').slice(0, 6).join('\n'));
}
// META must be real in the OUTPUT, not just in the string we built: a gate
// whose metadata stayed null asks for a passphrase and can never accept one.
if (/var META = \/\* @LOCKMETA \*\/ null;/.test(gate)) fail('the gate page ships META === null');

const assets = ['./', './index.html', ...PARTS.map((p) => './' + p.file)];
const sw = relinkWorker(readFileSync(join(SITE, 'sw.js'), 'utf8'), assets);
if (/'\.\/(app|aip)\.js'/.test(sw)) fail('the worker still precaches a plaintext asset');

// EVERY CHECK ABOVE RUNS BEFORE ANY FILE EXISTS. Exiting 1 does not un-write
// a file, and a half-locked site-locked/ is an artifact CI would happily
// deploy - the M4 lesson from build-aip.mjs, applied here from the start.
if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

writeFileSync(join(OUT, 'index.html'), gate);
writeFileSync(join(OUT, 'sw.js'), sw);
for (const p of PARTS) writeFileSync(join(OUT, p.file), sealed[p.as]);
writeFileSync(join(OUT, '.nojekyll'), '');

const kb = (n) => (n / 1024).toFixed(0) + ' KB';
console.log(
  `locked site-locked/  v${version}  gate ${kb(gate.length)} + ` +
  PARTS.map((p) => p.file + ' ' + kb(sealed[p.as].length)).join(' + ') +
  `\n  PBKDF2-SHA256 x${ITERATIONS.toLocaleString('en-US')} derived in ${kdfMs} ms here ` +
  '(once per browser, not per load)' +
  '\n  the passphrase is NOT in this output; the repo is public, so the SOURCE is not gated'
);
