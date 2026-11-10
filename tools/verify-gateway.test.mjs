import test from 'node:test';
import assert from 'node:assert/strict';
import { MANIFEST as SUBS_MANIFEST, manifestFor, classifyAudio } from '../packages/subs/subs.mjs';
import { buildChecks, runChecks, DUBBED_FILE, run, HELP } from './verify-gateway.mjs';

const SITE = 'https://site.example.test';
const MANIFEST_PATH = '/stremio/uuid1/SECRETPASS/manifest.json';
const NGINX_404 = '<html><head><title>404 Not Found</title></head><body><center><h1>404 Not Found</h1></center><hr><center>nginx</center></body></html>';

// A fake gateway that behaves like kit/gateway/default.conf.template.
function fakeGateway({ leak = [], site = SITE } = {}) {
  const seen = [];
  const fetcher = async (url, init = {}) => {
    const { pathname } = new URL(url);
    const method = init.method ?? 'GET';
    seen.push({ method, pathname });
    const cors = { 'access-control-allow-origin': site };
    const block = () => new Response(NGINX_404, { status: 404, headers: { server: 'nginx', 'content-type': 'text/html' } });
    if (leak.includes(pathname)) return Response.json({ leaked: true });
    // nginx answers a bare prefix with a redirect to the same path plus a slash.
    if (pathname === '/stremio' || pathname === '/subs') return new Response('', { status: 301, headers: { location: `http://gw.test${pathname}/` } });
    if (/^\/stremio\/(configure|[^/]+\/[^/]+\/configure)(\/|$)/.test(pathname)) return block();
    if (pathname === MANIFEST_PATH) return Response.json({ id: 'aiostreams', resources: ['stream'] });
    if (pathname.startsWith(MANIFEST_PATH.replace('manifest.json', 'stream/'))) return Response.json({ streams: [] });
    if (pathname.startsWith('/api/v1/debrid/')) return Response.json({ error: 'bad' }, { status: 400 });
    if (pathname.startsWith('/static/')) return new Response('video', { status: 200 });
    if (pathname === '/api/v1/status') return method === 'GET' ? Response.json({ status: 'ok' }, { headers: cors }) : new Response('', { status: 405 });
    if (pathname === '/api/v1/user') return method === 'OPTIONS' ? new Response(null, { status: 204, headers: cors }) : new Response('', { status: 405 });
    if (pathname.startsWith('/subs/')) {
      if (method !== 'GET') return new Response('', { status: 403 });
      if (pathname === '/subs/manifest.json') return Response.json(SUBS_MANIFEST);
      if (pathname === '/subs/es-419/manifest.json') return Response.json(manifestFor('es-419'));
      if (pathname.includes('/subtitles/')) return Response.json({ subtitles: [] });
    }
    return block();
  };
  return { fetcher, seen };
}
const names = results => Object.fromEntries(results.map(r => [r.name, r]));

test('the dubbed sample file really counts as dubbed for Dublix Subs', () => {
  assert.equal(classifyAudio(DUBBED_FILE, 'pt-BR'), 'dub');
});

test('a gateway that follows the kit config passes every check', async () => {
  const { fetcher } = fakeGateway();
  const results = await runChecks({ fetcher, base: 'http://gw.test', manifestPath: MANIFEST_PATH, siteOrigin: SITE });
  const failed = results.filter(r => !r.pass && !r.skipped);
  assert.deepEqual(failed.map(r => r.name), []);
  assert.ok(results.length >= 15);
});

test('without a manifest the manifest checks are skipped, not failed', async () => {
  const { fetcher } = fakeGateway();
  const results = await runChecks({ fetcher, base: 'http://gw.test', siteOrigin: SITE });
  const skipped = results.filter(r => r.skipped);
  assert.ok(skipped.length >= 2);
  assert.equal(results.filter(r => !r.pass && !r.skipped).length, 0);
});

test('exposing the configure page, the internal API or the root fails the matching check', async () => {
  for (const leak of ['/stremio/configure', '/api/v1/search', '/']) {
    const { fetcher } = fakeGateway({ leak: [leak] });
    const results = await runChecks({ fetcher, base: 'http://gw.test', manifestPath: MANIFEST_PATH, siteOrigin: SITE });
    assert.ok(results.some(r => !r.pass && !r.skipped), `leak of ${leak} must be caught`);
  }
});

test('a wrong CORS origin on the profile API fails', async () => {
  const { fetcher } = fakeGateway({ site: 'https://other.example.test' });
  const results = names(await runChecks({ fetcher, base: 'http://gw.test', siteOrigin: SITE }));
  assert.equal(results['profile API allows only the setup site origin'].pass, false);
});

test('an AIOStreams 404 behind the gateway does not count as a gateway block', async () => {
  const fetcher = async () => new Response('{"error":"not found"}', { status: 404 });
  const results = names(await runChecks({ fetcher, base: 'http://gw.test', siteOrigin: SITE }));
  assert.equal(results['root answers 404 from the gateway'].pass, false);
});

test('checks only use read-only requests: no profile is ever created', async () => {
  const { fetcher, seen } = fakeGateway();
  await runChecks({ fetcher, base: 'http://gw.test', manifestPath: MANIFEST_PATH, siteOrigin: SITE });
  assert.equal(seen.some(s => s.method === 'POST' && s.pathname === '/api/v1/user'), false);
  assert.equal(seen.some(s => s.method === 'DELETE' || s.method === 'PUT'), false);
});

test('buildChecks needs the manifest path only for the Stremio checks', () => {
  const withManifest = buildChecks({ manifestPath: MANIFEST_PATH, siteOrigin: SITE });
  assert.ok(withManifest.every(c => !c.needsManifest || c.path));
  assert.ok(buildChecks({ siteOrigin: SITE }).filter(c => c.needsManifest).length >= 2);
});

test('run prints help, masks credentials and exits 0 or 1', async () => {
  const out = []; const err = [];
  const io = { stdout: s => out.push(s), stderr: s => err.push(s) };
  assert.equal(await run(['--help'], {}, io), 0);
  assert.match(HELP, /DUBLIX_BASE_URL/);
  assert.match(HELP, /DUBLIX_MANIFEST_URL/);
  const { fetcher } = fakeGateway();
  const env = { DUBLIX_MANIFEST_URL: `http://gw.test${MANIFEST_PATH}`, FILMHUB_SITE_ORIGIN: SITE };
  assert.equal(await run([], env, { ...io, fetcher }), 0);
  assert.equal(/SECRETPASS|uuid1/.test(out.join('\n') + err.join('\n')), false);
  const leaky = fakeGateway({ leak: ['/'] });
  assert.equal(await run([], env, { ...io, fetcher: leaky.fetcher }), 1);
  assert.equal(await run(['--bogus'], env, io), 1);
});

test('a bare /stremio or /subs may redirect to its own slash path, but must not answer content', async () => {
  const ok = names(await runChecks({ fetcher: fakeGateway().fetcher, base: 'http://gw.test', siteOrigin: SITE }));
  assert.equal(ok['bare /stremio is hidden'].pass, true);
  assert.equal(ok['bare /subs is hidden'].pass, true);
  const leaky = names(await runChecks({ fetcher: fakeGateway({ leak: ['/stremio', '/subs'] }).fetcher, base: 'http://gw.test', siteOrigin: SITE }));
  assert.equal(leaky['bare /stremio is hidden'].pass, false);
  assert.equal(leaky['bare /subs is hidden'].pass, false);
});
