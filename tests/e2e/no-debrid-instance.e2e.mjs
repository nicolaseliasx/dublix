// Run against a disposable AIOStreams with ALLOW_PRIVATE_URLS=true; never a user's instance.
// The fixture serves torrent metadata only. No media is downloaded or played.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import { buildDublixConfig } from '../../packages/policy/config.mjs';

const AIO = process.env.E2E_AIO ?? 'http://127.0.0.1:18391';
const host = process.env.E2E_FIXTURE_HOST ?? '172.17.0.1';
const base = JSON.parse(readFileSync(new URL('../../packages/policy/base-config.json', import.meta.url)));
const options = { services: [], tiers: ['1080p', '720p'], ptSlots: 2, originalSlots: 1 };
const streams = [];
const expected = [];
for (const resolution of options.tiers) {
  for (const [language, seeds] of [['DUAL.PT-BR', [10, 200, 300]], ['English', [20, 1000]]]) {
    for (const seed of seeds) {
      // The original and 720p candidates deliberately have more seeds than the preferred PT-BR/1080p ones.
      const seeders = seed + (resolution === '720p' ? 2000 : 0);
      const filename = `The.Matrix.1999.${resolution}.BluRay.x264.AAC.${language}-Group${seeders}.mkv`;
      const infoHash = (streams.length + 1).toString(16).padStart(40, '0');
      streams.push({ infoHash, fileIdx: 0, name: `Fixture\n${resolution}`, title: `${filename}\n👤 ${seeders} 💾 1 GB`,
        behaviorHints: { filename, videoSize: (seed + 10) * 50 * 1024 ** 2 } });
      if (seed >= 100) expected.push(infoHash);
    }
  }
}
const fixture = createServer((req, res) => {
  const payload = req.url.endsWith('manifest.json')
    ? { id: 'dublix.p2p.fixture', name: 'P2P Fixture', version: '1.0.0', resources: ['stream'], types: ['movie', 'series'], catalogs: [] }
    : { streams };
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
});
fixture.listen(0, host);
await once(fixture, 'listening');

async function create(config) {
  const res = await fetch(`${AIO}/api/v1/user`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ config, password: 'dublix-p2p-test-password-only' }), signal: AbortSignal.timeout(60000) });
  const data = await res.json();
  assert.ok(data.success, `AIOStreams accepts the profile: ${JSON.stringify(data.error)}`);
  return `${AIO}/stremio/${data.data.uuid}/${data.data.encryptedPassword}`;
}
async function query(profile, type, id) {
  const res = await fetch(`${profile}/stream/${type}/${id}.json`, { signal: AbortSignal.timeout(90000) });
  assert.equal(res.status, 200);
  const data = await res.json();
  return (data.streams ?? []).filter((s) => s.infoHash);
}
try {
  const config = buildDublixConfig(base, options);
  config.presets = [{ type: 'custom', instanceId: 'p2p-fixture', enabled: true, options: {
    name: 'P2P Fixture', manifestUrl: `http://${host}:${fixture.address().port}/manifest.json`, timeout: 5000,
  } }];
  const profile = await create(config);
  const result = await query(profile, 'movie', 'tt0133093');
  assert.deepEqual(result.map((s) => s.infoHash).sort(), expected.sort(), '2 PT + 1 original per tier, highest seeds retained');
  assert.deepEqual(result.map((s) => s.infoHash), [3, 2, 5, 8, 7, 10].map((n) => n.toString(16).padStart(40, '0')),
    'quality then language take priority over seeds; seeds order candidates within each language and quality');
  assert.ok(result.every((s) => !s.url), 'raw torrents reach Stremio without a debrid URL');
  console.log(`ok: real AIOStreams returns ${result.length} fixture P2P streams with language/quality limits and seed ordering`);
  const only = await create(buildFixtureConfig({ ...options, languageOnly: true }));
  const dubbed = await query(only, 'movie', 'tt0133093');
  assert.equal(dubbed.length, 4);
  assert.ok(dubbed.every((s) => streams.find((f) => f.infoHash === s.infoHash).behaviorHints.filename.includes('PT-BR')));
  console.log('ok: only-my-language keeps 2 PT-BR torrents per tier');
  if (process.argv.includes('--live')) {
    const liveProfile = await create(buildDublixConfig(base, { services: [] }));
    for (const [type, id] of [['movie', 'tt0133093'], ['series', 'tt0460681:4:1']]) {
      const start = Date.now();
      const live = await query(liveProfile, type, id);
      assert.ok(live.length > 0, `live P2P results for ${id}`);
      console.log(`ok: live ${type} search: ${live.length} P2P streams in ${((Date.now() - start) / 1000).toFixed(1)}s`);
    }
  }
} finally {
  fixture.closeAllConnections();
  await new Promise((resolve) => fixture.close(resolve));
}

function buildFixtureConfig(opts) {
  const config = buildDublixConfig(base, opts);
  config.presets = [{ type: 'custom', instanceId: 'p2p-fixture', enabled: true, options: {
    name: 'P2P Fixture', manifestUrl: `http://${host}:${fixture.address().port}/manifest.json`, timeout: 5000,
  } }];
  return config;
}
