#!/usr/bin/env node
/**
 * Static server for the hosted build - `npm run serve`.
 *
 * Binds 0.0.0.0 so the planner is reachable three ways, which are NOT
 * equivalent and the banner says so:
 *
 *   http://localhost:8182      this machine. A secure context, so the
 *                              service worker registers and VFR chart
 *                              tiles are cached for offline use.
 *   http://<lan-ip>:8182       a phone or tablet on the same wifi, or on
 *                              this machine's hotspot. Plain http on a LAN
 *                              address is NOT a secure context: the browser
 *                              refuses the service worker, so the planner
 *                              works but caches no chart tiles.
 *   https://<user>.github.io/  the deployed copy, secure context.
 *
 * No dependencies on purpose: node tools/serve.mjs is all it takes.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROOT, 'site');
const PORT = Number(process.env.PORT) || 8182;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json'
};

function lanAddresses() {
  const out = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    // normalize() collapses ".." so a request cannot escape site/
    let rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    if (rel.endsWith('/') || rel === '\\' || rel === '/') rel = join(rel, 'index.html');
    const file = join(SITE, rel);
    if (!file.startsWith(SITE)) { res.writeHead(403).end('forbidden'); return; }

    const info = await stat(file).catch(() => null);
    if (!info || !info.isFile()) { res.writeHead(404).end('not found'); return; }

    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': body.length,
      // the shell must never be served stale while developing; the service
      // worker does the real caching, and it revalidates on every load
      'Cache-Control': 'no-cache',
      // needed for a service worker to control the whole site from /sw.js
      'Service-Worker-Allowed': '/'
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500).end('server error');
  }
});

const missing = await stat(join(SITE, 'index.html')).catch(() => null);
if (!missing) {
  console.error('site/ is not built yet - run `npm run build` first.');
  process.exit(1);
}

// A raw EADDRINUSE stack trace is useless to someone who double-clicked
// serve.cmd; say what happened and what to do about it.
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nPort ${PORT} is already in use.`);
    console.error('Either the planner is already serving in another window -');
    console.error(`try http://localhost:${PORT} first - or something else has the port.`);
    console.error(`To use a different one:  set PORT=9000  then run this again.\n`);
  } else if (err.code === 'EACCES') {
    console.error(`\nNot allowed to open port ${PORT}. Pick one above 1024, e.g. set PORT=9000\n`);
  } else {
    console.error('\nCould not start the server: ' + err.message + '\n');
  }
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  const lan = lanAddresses();
  console.log(`\nC182 Flight Planner - serving site/ on port ${PORT}\n`);
  console.log(`  this machine   http://localhost:${PORT}`);
  console.log('                 secure context: service worker ON, chart tiles cached offline\n');
  if (lan.length) {
    for (const ip of lan) console.log(`  phone / tablet http://${ip}:${PORT}`);
    console.log('                 plain http on a LAN address is not a secure context:');
    console.log('                 the planner works, but caches no chart tiles offline\n');
  } else {
    console.log('  (no external network interface found - localhost only)\n');
  }
  console.log('  Ctrl+C to stop.\n');
});
