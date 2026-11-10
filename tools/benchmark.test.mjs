import test from 'node:test';
import assert from 'node:assert/strict';
import { measureTitle, runPass, summarizePass, compareRuns, byGroup, run, HELP } from './benchmark.mjs';

const ORIGIN = 'https://dublix.example.test';
const MANIFEST = `${ORIGIN}/stremio/uuid1/SECRETPASS/manifest.json`;
const PATH = '/stremio/uuid1/SECRETPASS/manifest.json';
const cases = [
  { id: 'tt1', type: 'movie', group: 'film' },
  { id: 'tt2:1:1', type: 'series', group: 'series' },
  { id: 'tt3', type: 'movie', group: 'film' },
];
const listFor = n => Response.json({ streams: Array.from({ length: n }, (_, i) => ({ name: `s${i}`, url: 'https://x.test/secret' })) });

test('measureTitle records count and latency, and classifies failures', async () => {
  const ok = await measureTitle({ fetcher: async () => listFor(4), origin: ORIGIN, manifestPath: PATH, item: cases[0], pass: 'cold' });
  assert.equal(ok.streamCount, 4);
  assert.equal(ok.found, true);
  assert.ok(Number.isInteger(ok.latencyMs));
  const empty = await measureTitle({ fetcher: async () => listFor(0), origin: ORIGIN, manifestPath: PATH, item: cases[0], pass: 'cold' });
  assert.equal(empty.found, false);
  assert.equal(empty.error, undefined);
  const http = await measureTitle({ fetcher: async () => new Response('x', { status: 500 }), origin: ORIGIN, manifestPath: PATH, item: cases[0], pass: 'cold' });
  assert.deepEqual([http.streamCount, http.error], [null, 'http-500']);
  const timeout = await measureTitle({ fetcher: async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); }, origin: ORIGIN, manifestPath: PATH, item: cases[0], pass: 'cold' });
  assert.equal(timeout.error, 'timeout');
  const failed = await measureTitle({ fetcher: async () => { throw new Error(MANIFEST); }, origin: ORIGIN, manifestPath: PATH, item: cases[0], pass: 'cold' });
  assert.equal(failed.error, 'request-failed');
  assert.equal(JSON.stringify(failed).includes('SECRETPASS'), false);
});

test('rows never carry stream links or names', async () => {
  const row = await measureTitle({ fetcher: async () => listFor(2), origin: ORIGIN, manifestPath: PATH, item: cases[0], pass: 'warm' });
  assert.equal(/x\.test|secret|s0/.test(JSON.stringify(row)), false);
});

test('runPass respects the concurrency limit and keeps case order', async () => {
  let running = 0; let peak = 0;
  const fetcher = async () => { running++; peak = Math.max(peak, running); await new Promise(r => setTimeout(r, 5)); running--; return listFor(1); };
  const rows = await runPass({ fetcher, origin: ORIGIN, manifestPath: PATH, cases, pass: 'cold', concurrency: 2 });
  assert.deepEqual(rows.map(r => r.id), ['tt1', 'tt2:1:1', 'tt3']);
  assert.equal(peak, 2);
});

test('summarizePass computes success, found and latency percentiles', () => {
  const rows = [
    { streamCount: 3, latencyMs: 100 }, { streamCount: 0, latencyMs: 300 }, { streamCount: null, latencyMs: 20000, error: 'timeout' }, { streamCount: 5, latencyMs: 200 },
  ];
  assert.deepEqual(summarizePass(rows), { requests: 4, success: 3, errors: 1, found: 2, empty: 1, p50LatencyMs: 200, p95LatencyMs: 20000 });
});

test('compareRuns flags titles whose count differs between the two passes', () => {
  const cold = [{ id: 'a', streamCount: 3 }, { id: 'b', streamCount: 2 }, { id: 'c', streamCount: null }];
  const warm = [{ id: 'a', streamCount: 3 }, { id: 'b', streamCount: 4 }, { id: 'c', streamCount: 1 }];
  assert.deepEqual(compareRuns(cold, warm), { comparable: 2, same: 1, differentIds: ['b'] });
});

test('byGroup counts titles with streams per group', () => {
  const rows = [{ group: 'film', streamCount: 3 }, { group: 'film', streamCount: 0 }, { group: 'anime', streamCount: 2 }, { group: 'anime', streamCount: null }];
  assert.deepEqual(byGroup(rows), { film: { titles: 2, found: 1 }, anime: { titles: 2, found: 1 } });
});

test('run prints help, needs a manifest, masks it and exits 1 on request errors or when nothing is found', async () => {
  const out = []; const err = [];
  const io = { stdout: s => out.push(s), stderr: s => err.push(s) };
  assert.equal(await run(['--help'], {}, io), 0);
  assert.match(HELP, /DUBLIX_MANIFEST_URL/);
  assert.equal(await run([], {}, io), 1);
  out.length = 0;
  const good = await run(['--titles', 'tt1234567,tt7654321'], { DUBLIX_MANIFEST_URL: MANIFEST }, { ...io, fetcher: async () => listFor(3) });
  assert.equal(good, 0);
  assert.equal(/SECRETPASS|uuid1/.test(out.join('\n') + err.join('\n')), false);
  const down = await run(['--titles', 'tt1234567'], { DUBLIX_MANIFEST_URL: MANIFEST }, { ...io, fetcher: async () => new Response('x', { status: 502 }) });
  assert.equal(down, 1);
  const none = await run(['--titles', 'tt1234567'], { DUBLIX_MANIFEST_URL: MANIFEST }, { ...io, fetcher: async () => listFor(0) });
  assert.equal(none, 1);
});
