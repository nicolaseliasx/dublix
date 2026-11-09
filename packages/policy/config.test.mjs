import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeBase, buildFilmhubConfig, findSecrets, DEBRID } from './config.mjs';

const uuid = '12345678-1234-4123-8123-123456789abc';
const owner = () => ({
  addonName: 'Filmhub Streams', trusted: false, tmdbApiKey: 'a'.repeat(32), tvdbApiKey: 'tv',
  services: [{ id: 'torbox', enabled: true, credentials: { apiKey: 'secret-torbox-key' } }],
  presets: [
    { type: 'library', instanceId: 'ae7', enabled: true, options: { name: 'Library', services: ['torbox'] } },
    { type: 'torrentio', instanceId: 'filmhub-ptbr', enabled: true, options: { name: 'PT', services: [] } },
    { type: 'zilean', instanceId: `pilot-zilean-${uuid}`, enabled: true, options: { name: 'Filmhub Zilean', services: ['torbox'] } },
    { type: 'comet', instanceId: `pilot-comet-${uuid}`, enabled: true, options: { name: 'Comet Pilot', services: [] } },
    { type: 'custom', instanceId: `pilot-brasil-rd-${uuid}`, enabled: true, options: { name: 'Filmhub Brasil RD', manifestUrl: 'https://x.example/KEY/manifest.json' } },
    { type: 'custom', instanceId: `pilot-brazuca-${uuid}`, enabled: true, options: { name: 'Filmhub Brazuca', manifestUrl: 'https://b.example/manifest.json' } },
  ],
  titleMatching: { enabled: true, addons: ['filmhub-ptbr', `pilot-zilean-${uuid}`, `pilot-brasil-rd-${uuid}`, `pilot-comet-${uuid}`] },
  serviceWrap: { enabled: true, presets: ['filmhub-ptbr', `pilot-comet-${uuid}`, `pilot-brazuca-${uuid}`], services: ['torbox'] },
  catalogModifications: [{ id: 'ae74bd7.aiostreams::library.torbox', type: 'library' }, { id: 'tmdb.top', type: 'movie' }],
  excludedStreamExpressions: [
    { expression: '/*Filmhub: reject European Portuguese releases*/ streams', enabled: true },
    { expression: "/*Filmhub playback: slow reported*/ pin(keyword(streams, 'filename', \"Some.File.mkv\"), 'bottom')", enabled: true },
  ],
  preferredStreamExpressions: [], requiredStreamExpressions: [],
  rankedStreamExpressions: [{ expression: "/*Filmhub playback: audio labels inverted*/ keyword(streams, 'filename', \"Fight.Club.mkv\")", score: 0, enabled: true }],
  sortCriteria: {}, resultLimits: {},
  formatter: { id: 'custom', definitions: { custom: { name: 'n', description: 'A{stream.rseMatched::~Filmhub playback: audio labels inverted["⚠ swapped\n"||""]}B' } } },
});

test('sanitizeBase strips credentials, custom manifests, owner-only rules and pilot ids', () => {
  const base = sanitizeBase(owner());
  const text = JSON.stringify(base);
  assert.deepEqual(base.services, []);
  assert.equal(base.tmdbApiKey, '');
  assert.equal(base.tvdbApiKey, '');
  assert.ok(!base.presets.some((p) => p.type === 'custom'));
  assert.doesNotMatch(text, /pilot|secret-torbox-key|Brazuca|Brasil RD|Filmhub playback|Fight\.Club|Some\.File/);
  assert.equal(base.formatter.definitions.custom.description, 'AB');
  assert.deepEqual(base.titleMatching.addons, ['filmhub-ptbr', 'filmhub-zilean', 'filmhub-comet']);
  assert.deepEqual(base.serviceWrap.presets, ['filmhub-ptbr', 'filmhub-comet']);
  assert.deepEqual(base.serviceWrap.services, [DEBRID]);
  assert.deepEqual(base.presets.find((p) => p.type === 'zilean').options.services, [DEBRID]);
  assert.deepEqual(base.presets.find((p) => p.type === 'comet').options.name, 'Comet');
  assert.deepEqual(base.catalogModifications.map((c) => c.id), ['tmdb.top']);
  assert.equal(base.addonName, 'Filmhub');
  assert.deepEqual(findSecrets(base), []);
});

test('findSecrets also flags secret-like keys in any case, emails, private hosts and unknown URL hosts', () => {
  const cases = {
    '.addonPassword': { addonPassword: 'x' }, '.authKey': { authKey: 'x' }, '.apikey': { apikey: 'x' },
    '.proxy.credentials': { proxy: { credentials: 'u:p' } }, '.options.url': { options: { url: 'https://streams.example.org/z' } },
    '.healthChecks.0.url': { healthChecks: [{ url: 'http://192.168.1.5/health' }] }, '.note': { note: 'mail someone@example.com' },
    '.local': { local: 'http://localhost:3000/manifest.json' },
  };
  for (const [path, value] of Object.entries(cases)) assert.deepEqual(findSecrets(value), [path], path);
  // Public sources the base profile legitimately uses stay allowed; keyword lists are not secrets.
  assert.deepEqual(findSecrets({ url: 'https://torrentio.strem.fun/providers=comando/manifest.json', requiredKeywords: ['dublado'],
    sync: ['https://raw.githubusercontent.com/Vidhin05/Releases-Regex/main/English/regexes.json', 'https://git.tamtaro.de/for-nour-RSE.json'],
    health: 'https://uptime.ibbylabs.dev/v1/health/torbox', expression: "keyword(streams, 'all', 'dublado')",
    sortCriteria: { global: [{ key: 'resolution', direction: 'desc' }] } }), []);
});

test('findSecrets flags credential fields and long tokens anywhere', () => {
  assert.deepEqual(findSecrets({ services: [{ credentials: { apiKey: 'k' } }] }), ['.services.0.credentials.apiKey']);
  assert.deepEqual(findSecrets({ a: { b: 'x'.repeat(10) + 'Ab1'.repeat(10) } }), ['.a.b']);
  assert.deepEqual(findSecrets({ url: `https://h/${uuid}/manifest.json` }), ['.url']);
  assert.deepEqual(findSecrets({ expression: "keyword(streams, 'all', 'dublado')" }), []);
});

const opts = (o = {}) => ({ services: [{ id: 'realdebrid', credentials: { apiKey: 'rd-key' } }], ...o });

test('buildFilmhubConfig fills the chosen debrid services everywhere the base marks them', () => {
  const cfg = buildFilmhubConfig(sanitizeBase(owner()), opts({
    services: [{ id: 'realdebrid', credentials: { apiKey: 'rd' } }, { id: 'easynews', credentials: { username: 'u', password: 'p' } }],
  }));
  assert.deepEqual(cfg.services.map((s) => [s.id, s.enabled]), [['realdebrid', true], ['easynews', true]]);
  assert.deepEqual(cfg.serviceWrap.services, ['realdebrid', 'easynews']);
  assert.deepEqual(cfg.presets.find((p) => p.type === 'zilean').options.services, ['realdebrid', 'easynews']);
  // The library only lists debrid clouds; Easynews has none.
  assert.deepEqual(cfg.presets.find((p) => p.type === 'library').options.services, ['realdebrid']);
  assert.doesNotMatch(JSON.stringify(cfg), new RegExp(DEBRID.replace(/[$]/g, '\\$')));
});

test('buildFilmhubConfig applies the Filmhub policy without excluding any chosen service', () => {
  const cfg = buildFilmhubConfig(sanitizeBase(owner()), opts({ tiers: ['1080p'], ptSlots: 1, originalSlots: 1 }));
  assert.equal(cfg.resultLimits.global, 2);
  const exprs = cfg.excludedStreamExpressions.map((e) => e.expression).join('\n');
  assert.doesNotMatch(exprs, /service\(streams/);
  assert.match(exprs, /faixa 1080p PT-BR/);
});

test('buildFilmhubConfig disables the library when no debrid cloud is chosen, and sets TMDB only when given', () => {
  const only = buildFilmhubConfig(sanitizeBase(owner()), opts({ services: [{ id: 'easynews', credentials: { username: 'u', password: 'p' } }] }));
  assert.equal(only.presets.find((p) => p.type === 'library').enabled, false);
  assert.equal(only.tmdbApiKey, '');
  assert.equal(buildFilmhubConfig(sanitizeBase(owner()), opts({ tmdbApiKey: ' abc ' })).tmdbApiKey, 'abc');
});

test('without a TMDB key the TMDB-only features are switched off (instances reject them otherwise)', () => {
  const withMatching = { ...sanitizeBase(owner()), titleMatching: { enabled: true, addons: [] }, yearMatching: { enabled: true },
    digitalReleaseFilter: { enabled: true }, bitrate: { useMetadataRuntime: true, other: 1 } };
  const off = buildFilmhubConfig(withMatching, opts());
  assert.deepEqual(off.bitrate, { useMetadataRuntime: false, other: 1 });
  assert.equal(off.titleMatching.enabled, false);
  assert.equal(off.yearMatching.enabled, false);
  assert.equal(off.digitalReleaseFilter.enabled, false);
  const on = buildFilmhubConfig(withMatching, opts({ tmdbApiKey: 'k' }));
  assert.equal(on.titleMatching.enabled, true);
  assert.equal(on.yearMatching.enabled, true);
  assert.equal(on.digitalReleaseFilter.enabled, true);
});

test('buildFilmhubConfig rejects missing or malformed credentials and unknown services', () => {
  const base = sanitizeBase(owner());
  for (const services of [[], [{ id: 'nope', credentials: { apiKey: 'k' } }], [{ id: 'torbox', credentials: {} }],
    [{ id: 'torbox', credentials: { apiKey: '  ' } }], [{ id: 'easynews', credentials: { apiKey: 'k' } }],
    [{ id: 'torbox', credentials: { apiKey: 'a' } }, { id: 'torbox', credentials: { apiKey: 'b' } }]]) {
    assert.throws(() => buildFilmhubConfig(base, { services }), TypeError, JSON.stringify(services));
  }
});

test('buildFilmhubConfig refuses a base that still carries secrets', () => {
  assert.throws(() => buildFilmhubConfig(owner(), opts()), /secrets/);
});
