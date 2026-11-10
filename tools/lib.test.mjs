import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseManifestUrl, maskManifestUrl, makeRedactor, streamListUrl, parseTitles, loadCases, limitedMap, percentile, writeReport } from './lib.mjs';

const MANIFEST = 'https://dublix.example.test/stremio/11111111-aaaa/SECRETPASS/manifest.json';

test('parseManifestUrl accepts a manifest address and rejects anything else without echoing it', () => {
  assert.deepEqual(parseManifestUrl(MANIFEST), { origin: 'https://dublix.example.test', path: '/stremio/11111111-aaaa/SECRETPASS/manifest.json' });
  for (const bad of ['', undefined, 'not a url', 'ftp://x.test/manifest.json', 'https://x.test/other.json']) {
    assert.throws(() => parseManifestUrl(bad), error => /manifest URL/.test(error.message) && !error.message.includes('other.json'));
  }
});

test('maskManifestUrl hides the credential segments and the query', () => {
  assert.equal(maskManifestUrl(`${MANIFEST}?k=KEY`), 'https://dublix.example.test/stremio/***/***/manifest.json');
});

test('makeRedactor removes the manifest URL, its path and each credential segment from any text', () => {
  const redact = makeRedactor(MANIFEST);
  const text = redact(`failed ${MANIFEST} then /stremio/11111111-aaaa/SECRETPASS/stream/movie/tt1.json and SECRETPASS`);
  assert.equal(/SECRETPASS|11111111-aaaa/.test(text), false);
  assert.match(text, /dublix\.example\.test|stremio/);
  assert.equal(makeRedactor(undefined)('plain'), 'plain');
});

test('streamListUrl builds the Stremio stream endpoint next to the manifest', () => {
  assert.equal(streamListUrl('https://h.test', '/stremio/u/p/manifest.json', { type: 'series', id: 'tt0903747:1:1' }), 'https://h.test/stremio/u/p/stream/series/tt0903747:1:1.json');
});

test('parseTitles turns ids into typed titles and rejects malformed ids', () => {
  assert.deepEqual(parseTitles('tt0133093, tt0903747:1:2'), [{ id: 'tt0133093', type: 'movie' }, { id: 'tt0903747:1:2', type: 'series' }]);
  assert.throws(() => parseTitles('tt1,bogus'), /title id/);
  assert.throws(() => parseTitles('tt0133093:1'), /title id/);
});

test('loadCases reads the bundled list and validates a custom file', async () => {
  const bundled = await loadCases();
  assert.ok(bundled.length >= 30);
  assert.ok(bundled.every(c => /^tt\d+/.test(c.id) && ['movie', 'series'].includes(c.type) && c.group));
  const dir = await mkdtemp(join(tmpdir(), 'dublix-tools-'));
  const file = join(dir, 'cases.json');
  await writeFile(file, JSON.stringify({ cases: [{ id: 'tt0133093', type: 'series' }] }));
  await assert.rejects(loadCases(file), /case/);
  await writeFile(file, JSON.stringify({ cases: [{ id: 'tt0133093', type: 'movie' }] }));
  assert.deepEqual(await loadCases(file), [{ id: 'tt0133093', type: 'movie', group: 'custom' }]);
});

test('limitedMap keeps order and never exceeds the concurrency limit', async () => {
  let running = 0; let peak = 0;
  const out = await limitedMap([1, 2, 3, 4, 5], 2, async n => { running++; peak = Math.max(peak, running); await new Promise(r => setTimeout(r, 5)); running--; return n * 2; });
  assert.deepEqual(out, [2, 4, 6, 8, 10]);
  assert.equal(peak, 2);
});

test('percentile uses the nearest rank and handles empty input', () => {
  assert.equal(percentile([10, 20, 30, 40], 50), 20);
  assert.equal(percentile([10, 20, 30, 40], 95), 40);
  assert.equal(percentile([], 50), null);
});

test('writeReport creates the file privately and never overwrites', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dublix-tools-'));
  const file = join(dir, 'report.json');
  await writeReport(file, { ok: true });
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { ok: true });
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  await assert.rejects(writeReport(file, { ok: false }), /already exists/);
});
