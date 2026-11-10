import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBitrateMbps, judgeList, judgePlayback, smokeTitle, summarize, run, HELP } from './stream-smoke.mjs';

const MiB = 1024 * 1024;
const ORIGIN = 'https://dublix.example.test';
const MANIFEST = `${ORIGIN}/stremio/uuid1/SECRETPASS/manifest.json`;
const streamList = (extra = {}) => ({ streams: [{ name: 'x', description: 'a\n20 GB · 19.6 ᴹᵇᵖˢ', url: `${ORIGIN}/api/v1/debrid/playback/SECRETTOKEN`, behaviorHints: { videoSize: 20e9 }, ...extra }, { name: 'y', url: 'https://other.test/2' }] });
const item = { id: 'tt1', type: 'movie' };

test('parseBitrateMbps reads the formatter bitrate in Mbps or Kbps, or null', () => {
  assert.equal(parseBitrateMbps('20 GB · 19.6 ᴹᵇᵖˢ'), 19.6);
  assert.equal(parseBitrateMbps('900 ᴷᵇᵖˢ'), 0.9);
  assert.equal(parseBitrateMbps('no rate'), null);
  assert.equal(parseBitrateMbps(undefined), null);
});

test('judgeList passes a non-empty list whose first option has a link, and names each failure', () => {
  assert.deepEqual(judgeList({ streams: 9, firstHasUrl: true }), { pass: true, failures: [] });
  assert.deepEqual(judgeList({ streams: 0 }).failures, ['no-streams']);
  assert.deepEqual(judgeList({ streams: 3, firstHasUrl: false }).failures, ['first-has-no-link']);
  assert.deepEqual(judgeList({ streams: 3, firstHasUrl: true }, { maxStreams: 2 }).failures, ['list-longer-than-2']);
});

test('judgePlayback needs 206, a video type and throughput above the ratio; unknown bitrate does not fail throughput', () => {
  const ok = { status: 206, contentType: 'video/x-matroska', mbps: 40, bitrateMbps: 19.6, kind: 'cdn' };
  assert.deepEqual(judgePlayback(ok, 1.5), { pass: true, failures: [], ratio: 40 / 19.6 });
  assert.deepEqual(judgePlayback({ ...ok, status: 200 }, 1.5).failures, ['status-not-206']);
  assert.deepEqual(judgePlayback({ ...ok, contentType: 'text/html' }, 1.5).failures, ['content-type-not-video']);
  assert.deepEqual(judgePlayback({ ...ok, mbps: 25 }, 1.5).failures, ['throughput-below-1.5x']);
  assert.equal(judgePlayback({ ...ok, bitrateMbps: null }, 1.5).pass, true);
  assert.deepEqual(judgePlayback({ ...ok, kind: 'placeholder' }, 1.5).failures, ['downloading-placeholder']);
});

test('smokeTitle without playback only fetches the list and never touches a stream link', async () => {
  const calls = [];
  const fetcher = async url => { calls.push(String(url)); return Response.json(streamList()); };
  const row = await smokeTitle({ fetcher, origin: ORIGIN, manifestPath: '/stremio/uuid1/SECRETPASS/manifest.json', item });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/stream\/movie\/tt1\.json$/);
  assert.equal(row.streams, 2);
  assert.equal(row.firstHasUrl, true);
  assert.equal(row.linkHost, 'same');
  assert.equal(row.verdict.pass, true);
  assert.equal(row.playback, undefined);
});

test('smokeTitle reports a link on another host as a warning and a missing link as a failure', async () => {
  const other = async () => Response.json(streamList({ url: 'https://elsewhere.test/x' }));
  const row = await smokeTitle({ fetcher: other, origin: ORIGIN, manifestPath: '/stremio/u/p/manifest.json', item });
  assert.equal(row.linkHost, 'different');
  assert.equal(row.verdict.pass, true);
  const none = async () => Response.json({ streams: [{ name: 'x', infoHash: 'abc' }] });
  const bare = await smokeTitle({ fetcher: none, origin: ORIGIN, manifestPath: '/stremio/u/p/manifest.json', item });
  assert.deepEqual(bare.verdict.failures, ['first-has-no-link']);
});

test('smokeTitle with playback uses only the first option, follows the redirect with a Range and leaks no URL', async () => {
  const calls = [];
  const body = new Uint8Array(2 * MiB);
  const fetcher = async (url, init = {}) => {
    calls.push({ url: String(url), range: init.headers?.Range, redirect: init.redirect });
    if (String(url).endsWith('/stream/movie/tt1.json')) return Response.json(streamList());
    if (String(url).includes('/api/v1/debrid/playback/')) return new Response(null, { status: 307, headers: { location: 'https://cdn.example.test/file.mkv?sig=SECRET' } });
    return new Response(body, { status: 206, headers: { 'content-type': 'video/x-matroska' } });
  };
  const row = await smokeTitle({ fetcher, origin: ORIGIN, manifestPath: '/stremio/u/p/manifest.json', item, playback: true, bytes: 2 * MiB, ratio: 1.5 });
  assert.equal(row.playback.status, 206);
  assert.equal(row.playback.kind, 'cdn');
  assert.equal(row.bitrateMbps, 19.6);
  assert.equal(row.playback.bytes, 2 * MiB);
  assert.match(calls[1].range, /^bytes=0-\d+$/);
  assert.equal(calls[1].redirect, 'manual');
  assert.equal(calls.filter(c => c.url.includes('/playback/')).length, 1);
  assert.equal(/SECRET|cdn\.example/.test(JSON.stringify(row)), false);
});

test('smokeTitle flags the gateway "downloading" placeholder as a failure', async () => {
  const fetcher = async url => {
    if (String(url).endsWith('/stream/movie/tt1.json')) return Response.json(streamList());
    if (String(url).includes('/playback/')) return new Response(null, { status: 307, headers: { location: `${ORIGIN}/static/downloading.mp4` } });
    return new Response(new Uint8Array(1024), { status: 206, headers: { 'content-type': 'video/mp4' } });
  };
  const row = await smokeTitle({ fetcher, origin: ORIGIN, manifestPath: '/stremio/u/p/manifest.json', item, playback: true, bytes: 1024, ratio: 1.5 });
  assert.equal(row.playback.kind, 'placeholder');
  assert.equal(row.verdict.pass, false);
  assert.ok(row.verdict.failures.includes('downloading-placeholder'));
});

test('smokeTitle records network errors and HTTP errors without throwing', async () => {
  const boom = await smokeTitle({ fetcher: async () => { throw new Error(`down ${MANIFEST}`); }, origin: ORIGIN, manifestPath: '/m/manifest.json', item });
  assert.deepEqual(boom.verdict.failures, ['request-failed']);
  assert.equal(JSON.stringify(boom).includes('SECRETPASS'), false);
  const http = await smokeTitle({ fetcher: async () => new Response('x', { status: 503 }), origin: ORIGIN, manifestPath: '/m/manifest.json', item });
  assert.deepEqual(http.verdict.failures, ['http-503']);
});

test('summarize counts passes, failures, empty lists and warnings', () => {
  const rows = [
    { id: 'a', verdict: { pass: true, failures: [] }, linkHost: 'same' },
    { id: 'b', verdict: { pass: false, failures: ['no-streams'] } },
    { id: 'c', verdict: { pass: false, failures: ['request-failed'] } },
    { id: 'd', verdict: { pass: true, failures: [] }, linkHost: 'different' },
  ];
  assert.deepEqual(summarize(rows), { titles: 4, pass: 2, fail: 2, noStreams: 1, requestFailed: 1, linkHostDiffers: 1, failedIds: ['b', 'c'] });
});

test('run prints help, rejects a missing manifest and never prints the manifest URL or its credentials', async () => {
  const out = []; const err = [];
  const io = { stdout: s => out.push(s), stderr: s => err.push(s) };
  assert.equal(await run(['--help'], {}, io), 0);
  assert.match(out.join('\n'), /--playback/);
  assert.match(HELP, /DUBLIX_MANIFEST_URL/);
  assert.equal(await run([], {}, io), 1);
  assert.match(err.join('\n'), /DUBLIX_MANIFEST_URL/);
  out.length = 0; err.length = 0;
  const fetcher = async () => Response.json(streamList());
  const code = await run(['--titles', 'tt1234567'], { DUBLIX_MANIFEST_URL: MANIFEST }, { ...io, fetcher });
  assert.equal(code, 0);
  assert.equal(/SECRETPASS|uuid1/.test(out.join('\n') + err.join('\n')), false);
  assert.match(out.join('\n'), /\*\*\*/);
  const failing = await run(['--titles', 'tt1234567'], { DUBLIX_MANIFEST_URL: MANIFEST }, { ...io, fetcher: async () => Response.json({ streams: [] }) });
  assert.equal(failing, 1);
});
