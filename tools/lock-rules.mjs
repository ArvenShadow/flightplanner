/**
 * The pure rules behind the locked build (v16.78) - no I/O, no crypto, no
 * top-level await, no side effects on import.
 *
 * SPLIT OUT FOR THE SAME REASON tools/aip-fields.mjs is: the runner
 * (tools/lock-site.mjs) reads files, derives a key and writes an artifact, so
 * requiring IT from the suite would run a build. These three functions are the
 * decisions worth testing without any of that - which passphrases are refused,
 * whether the gate page's metadata really landed, and whether the service
 * worker was re-pointed at the files that actually exist.
 *
 * The last one is not cosmetic: cache.addAll is atomic, so a worker still
 * precaching app.js in a build that only has app.enc caches NOTHING, and the
 * app silently stops working offline while looking perfect online. That is the
 * v16.45 trap, and it is why relinkWorker throws rather than warns.
 */

/** PBKDF2-SHA256 rounds. The measurement behind this number is in
 *  tools/lock-site.mjs; it lives here so the gate, the runner and the tests
 *  cannot disagree about it. */
export const ITERATIONS = 2_000_000;

/** Refused below this. Not copied from a policy document: it is the length at
 *  which a four-word passphrase - the thing actually recommended - fits, and
 *  short of which the KDF stops mattering because a wordlist gets there first. */
export const MIN_LENGTH = 12;

/** Rejected whatever their length: these are what gets tried first. */
export const OBVIOUS = [
  'password', 'passphrase', 'flightplanner', 'flight planner', 'c182',
  'letmein', 'changeme', 'qwerty', '123456', 'secret', 'admin'
];

/**
 * The payloads, in the order the browser must run them.
 *
 * `replaces` is the src= attribute in the plaintext page whose script element
 * the decrypted code is substituted into. THAT is what keeps the load ORDER
 * identical to an unlocked load, which the v16.45 entry says is load-bearing:
 * the bundle is a classic script whose functions the page's inline on*=
 * handlers need as globals, and the page script's top level calls into it.
 */
export const PARTS = [
  { as: 'aip', file: 'aip.enc', from: 'aip.js', replaces: 'aip.js' },
  { as: 'app', file: 'app.enc', from: 'app.js', replaces: 'app.js' },
  { as: 'body', file: 'body.enc', from: 'index.html', replaces: null }
];

/**
 * Read the passphrase, and refuse the ones that would make this theatre.
 *
 * AN ATTACKER HOLDS THE CIPHERTEXT, so they guess offline at their own pace:
 * the strength here is the passphrase's entropy first and the iteration count
 * a distant second. A locker that reported success on "1234" would be the
 * plausible wrong answer this project exists to refuse, so this refuses
 * instead - and says which rule was broken, never just "invalid".
 *
 * @param {string|undefined} envValue SITE_PASSWORD, if set
 * @param {string|null} fileValue contents of .site-password, if it exists
 * @returns {{ok: true, pass: string}|{ok: false, why: string}}
 */
export function readPassphrase(envValue, fileValue) {
  const raw = (envValue && envValue.length ? envValue : (fileValue || ''));
  // ONE trailing newline is stripped and no more: a file written by an editor
  // ends in one, and a passphrase whose real last character is a newline is
  // not a passphrase anyone can type twice.
  const pass = raw.replace(/\r?\n$/, '');
  if (!pass) {
    return { ok: false, why:
      'no passphrase. Put one in .site-password (gitignored) or set SITE_PASSWORD.' };
  }
  if (pass.trim() !== pass) {
    return { ok: false, why:
      'the passphrase has leading or trailing whitespace, which nobody will type ' +
      'the same way twice.' };
  }
  if (pass.length < MIN_LENGTH) {
    return { ok: false, why:
      `the passphrase is ${pass.length} characters; ${MIN_LENGTH} is the minimum. ` +
      'An attacker gets the ciphertext, so they can guess offline as fast as their ' +
      'hardware allows - no iteration count rescues a short one. Four ordinary ' +
      'words are both easier to type and far stronger than a mangled single word.' };
  }
  if (OBVIOUS.some((o) => pass.toLowerCase().includes(o))) {
    return { ok: false, why:
      'the passphrase contains one of the strings that get tried first ' +
      `(${OBVIOUS.join(', ')}). Pick something that is not about this project.` };
  }
  return { ok: true, pass };
}

/**
 * Substitute the lock metadata into the gate page template.
 *
 * The marker is the whole assignment, not the bare name @LOCKMETA: the
 * template's own header comment explains the substitution, so testing for the
 * name failed on correct output. What must not survive is the assignment that
 * would leave META null - a gate that asks for a passphrase and can never
 * accept one.
 *
 * @param {string} template @param {{salt: string, iterations: number}} meta
 */
export function fillTemplate(template, meta) {
  const MARK = '/* @LOCKMETA */ null';
  if (!template.includes(MARK)) throw new Error('src/unlock.html has no @LOCKMETA marker');
  const out = template.replace(MARK, JSON.stringify(meta));
  if (out.includes(MARK)) throw new Error('the @LOCKMETA marker was not replaced');
  const back = out.match(/var META = (\{.*?\});/);
  if (!back) throw new Error('the substituted metadata is not readable back out');
  const parsed = JSON.parse(back[1]);
  if (parsed.salt !== meta.salt || parsed.iterations !== meta.iterations) {
    throw new Error('the substituted metadata does not match what was asked for');
  }
  return out;
}

/**
 * Point the service worker's precache list at the locked filenames.
 * @param {string} sw @param {string[]} assets
 */
export function relinkWorker(sw, assets) {
  const RE = /const SHELL_ASSETS = \[[^\]]*\];/;
  if (!RE.test(sw)) throw new Error('sw.js has no SHELL_ASSETS array to relink');
  const out = sw.replace(RE, `const SHELL_ASSETS = [${assets.map((a) => `'${a}'`).join(', ')}];`);
  if (out === sw) throw new Error('the SHELL_ASSETS array was not replaced');
  if (/'\.\/(app|aip)\.js'/.test(out)) {
    throw new Error('the worker still precaches a plaintext asset');
  }
  return out;
}

/**
 * Extract the gate page's script blocks THE WAY THE HTML PARSER SEES THEM.
 *
 * This exists because of a real bug: the first unlock.html carried a literal
 * closing script tag inside a JS COMMENT that was explaining such a tag is
 * harmless in the app payload. The parser does not read comments - it ended
 * the script element there, so the gate threw a SyntaxError, rendered the rest
 * of its own source as text, and unlocked nothing. Every string check passed;
 * only the browser caught it.
 *
 * NOTE WHAT THE COUNT DOES AND DOES NOT CATCH. A stray closing tag yields ONE
 * block that stops mid-statement, not two - there is no second opening tag -
 * so counting would have missed the original bug. Running the parser over the
 * block is what catches truncation; the count guards a genuinely added second
 * script element. Both are asserted, for different reasons.
 *
 * @param {string} html @returns {string[]}
 */
export function scriptBlocks(html) {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
}
