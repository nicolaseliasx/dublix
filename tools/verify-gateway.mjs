#!/usr/bin/env node
// Checks that a running Dublix self-host kit gateway (kit/gateway/default.conf.template) exposes only what it should:
// the Stremio addon, playback redirects, the setup site's profile API (with CORS for one origin) and Dublix Subs; and that
// the AIOStreams configure pages, the internal API and everything else are blocked.
// Read-only: GET and OPTIONS, plus POST only to two paths where the gateway must refuse it (/api/v1/status, /subs/manifest.json).
// It never creates a profile (no POST to /api/v1/user) and never plays anything.
// Output never contains the manifest path (it carries your credentials).
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { MANIFEST as SUBS_MANIFEST, manifestFor } from '../packages/subs/subs.mjs';
import { makeRedactor, MANIFEST_HINT, parseManifestUrl, safeMessage } from './lib.mjs';

export const DEFAULT_BASE = 'http://127.0.0.1:8080';
export const DEFAULT_SITE_ORIGIN = 'https://dublix.stremio.ncls.cc';
/** A file name Dublix Subs treats as dubbed (checked in the unit test), so it must be answered with no subtitles. */
export const DUBBED_FILE = 'Movie.Dublado.mkv';
const HEAD_BYTES = 16384;

export const HELP = `Usage: node tools/verify-gateway.mjs [options]

Checks that your self-host kit gateway exposes only what Stremio and the Dublix setup site need. Read-only: it never creates a
profile and never plays anything. It assumes the stock gateway of kit/gateway (nginx): blocked paths must answer 404 with the
default nginx error page, which is how it tells a gateway block from a 404 coming from AIOStreams.

Input (environment or flags):
  DUBLIX_BASE_URL        Gateway address to test (default: the host of the manifest URL, else ${DEFAULT_BASE}).
  DUBLIX_MANIFEST_URL    Your addon manifest address (optional). With it, the manifest and a stream list are checked too; without
                         it those checks are skipped. It contains credentials: prefer the variable over --manifest.
  DUBLIX_SITE_ORIGIN    The setup site origin allowed to create profiles (default ${DEFAULT_SITE_ORIGIN}, the kit's default).

Options:
  --base <url>           Same as DUBLIX_BASE_URL.
  --manifest <url>       Same as DUBLIX_MANIFEST_URL.
  --site-origin <url>    Same as DUBLIX_SITE_ORIGIN.
  --timeout <seconds>    Per-request timeout (default 30).
  -h, --help             Show this help.

Exit code: 0 when every check passes (skipped checks do not fail), 1 otherwise (or on bad input).
Not checked: the profile creation rate limit (it would need many requests) and anything behind your tunnel or CDN.`;

const gatewayBlock = r => r.status === 404 && /<center>nginx<\/center>/i.test(r.text);
const forwarded = r => r.status < 500 && !gatewayBlock(r);
const json = r => { try { return JSON.parse(r.text); } catch { return null; } };
const blocked = (name, path) => ({ name, path, judge: gatewayBlock });
// nginx answers a bare location prefix with a 301 to the same path plus a slash: nothing is exposed.
const bare = (name, path) => ({ name, path, judge: r => gatewayBlock(r) || r.status === 301 });

/** The checks for the stock kit gateway. `path` is relative to the base URL. */
export function buildChecks({ manifestPath, siteOrigin }) {
  const streamPath = manifestPath?.replace(/manifest\.json$/, 'stream/movie/tt0133093.json');
  const subsPath = `/subs/subtitles/movie/tt0109830/filename%3D${encodeURIComponent(DUBBED_FILE)}.json`;
  return [
    { name: 'root answers 404 from the gateway', path: '/', judge: gatewayBlock },
    { name: 'gateway does not announce its version', path: '/', judge: r => !/nginx\/\d/i.test(r.headers.get('server') ?? '') },
    blocked('AIOStreams configure page is hidden', '/stremio/configure'),
    blocked('per-profile configure page is hidden', '/stremio/00000000-0000-0000-0000-000000000000/placeholder/configure'),
    blocked('internal search API is hidden', '/api/v1/search?type=movie&id=tt0133093'),
    blocked('routes below /api/v1/user/ are hidden', '/api/v1/user/me'),
    bare('bare /stremio is hidden', '/stremio'),
    bare('bare /subs is hidden', '/subs'),
    { name: 'status endpoint answers', path: '/api/v1/status', judge: r => r.status === 200 },
    { name: 'status endpoint is read-only', method: 'POST', path: '/api/v1/status', judge: r => r.status === 405 },
    { name: 'profile API rejects GET', path: '/api/v1/user', judge: r => r.status === 405 },
    {
      name: 'profile API allows only the setup site origin', method: 'OPTIONS', path: '/api/v1/user',
      headers: { Origin: siteOrigin, 'Access-Control-Request-Method': 'POST' },
      judge: r => r.status === 204 && r.headers.get('access-control-allow-origin') === siteOrigin,
    },
    { name: 'debrid playback route reaches AIOStreams', path: '/api/v1/debrid/x', judge: forwarded },
    { name: 'static route reaches AIOStreams', path: '/static/downloading.mp4', judge: forwarded },
    { name: 'subs manifest (pt-BR)', path: '/subs/manifest.json', judge: r => r.status === 200 && json(r)?.id === SUBS_MANIFEST.id },
    { name: 'subs manifest (es-419)', path: '/subs/es-419/manifest.json', judge: r => r.status === 200 && json(r)?.id === manifestFor('es-419').id },
    { name: 'subs gives a dubbed file no subtitles', path: subsPath, judge: r => r.status === 200 && Array.isArray(json(r)?.subtitles) && json(r).subtitles.length === 0 },
    { name: 'subs is read-only', method: 'POST', path: '/subs/manifest.json', judge: r => r.status === 403 },
    { name: 'addon manifest answers', needsManifest: true, path: manifestPath, judge: r => r.status === 200 && typeof json(r)?.id === 'string' },
    { name: 'stream list answers', needsManifest: true, path: streamPath, judge: r => r.status === 200 && Array.isArray(json(r)?.streams) },
  ];
}

async function readHead(response) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks = []; let size = 0;
  while (size < HEAD_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); size += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  return new TextDecoder().decode(Buffer.concat(chunks)).slice(0, HEAD_BYTES);
}

export async function runChecks({ fetcher = fetch, base, manifestPath, siteOrigin = DEFAULT_SITE_ORIGIN, timeoutMs = 30000 }) {
  const results = [];
  for (const check of buildChecks({ manifestPath, siteOrigin })) {
    if (check.needsManifest && !check.path) { results.push({ name: check.name, skipped: true, pass: false, status: null }); continue; }
    let status = null; let pass = false;
    try {
      const response = await fetcher(base.replace(/\/$/, '') + check.path, { method: check.method ?? 'GET', headers: check.headers, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
      status = response.status;
      pass = Boolean(check.judge({ status, headers: response.headers, text: await readHead(response) }));
    } catch { status = 'error'; }
    results.push({ name: check.name, status, pass });
  }
  return results;
}

export async function run(argv, env = process.env, { stdout = console.log, stderr = console.error, fetcher = fetch } = {}) {
  let redact = text => text;
  try {
    const { values: o } = parseArgs({ args: argv, strict: true, allowPositionals: false, options: {
      base: { type: 'string' }, manifest: { type: 'string' }, 'site-origin': { type: 'string' }, timeout: { type: 'string' }, help: { type: 'boolean', short: 'h' },
    } });
    if (o.help) { stdout(HELP); return 0; }
    const rawManifest = o.manifest ?? env.DUBLIX_MANIFEST_URL;
    redact = makeRedactor(rawManifest);
    const manifest = rawManifest ? parseManifestUrl(rawManifest) : null;
    const base = o.base ?? env.DUBLIX_BASE_URL ?? manifest?.origin ?? DEFAULT_BASE;
    if (!/^https?:\/\/[^/]+\/?$/.test(base)) throw new Error('Base URL must look like http(s)://host[:port].');
    const siteOrigin = o['site-origin'] ?? env.DUBLIX_SITE_ORIGIN ?? DEFAULT_SITE_ORIGIN;
    const timeout = o.timeout === undefined ? 30 : Number(o.timeout);
    if (!(timeout > 0)) throw new Error('--timeout must be a positive number.');
    stdout(`Gateway: ${base.replace(/\/$/, '')}${manifest ? '' : `  (no manifest given: manifest checks skipped; ${MANIFEST_HINT})`}`);
    const results = await runChecks({ fetcher, base, manifestPath: manifest?.path, siteOrigin, timeoutMs: timeout * 1000 });
    for (const r of results) stdout(`${r.skipped ? 'skip' : r.pass ? 'ok  ' : 'FAIL'} ${r.name}${r.skipped ? '' : `: ${r.status}`}`);
    const failed = results.filter(r => !r.pass && !r.skipped).length;
    stdout(failed ? `${failed} check(s) failed` : `all ${results.filter(r => !r.skipped).length} checks passed`);
    return failed ? 1 : 0;
  } catch (error) {
    stderr(safeMessage(error, redact));
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run(process.argv.slice(2)).then(code => { process.exitCode = code; });
