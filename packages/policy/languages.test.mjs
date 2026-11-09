import test from 'node:test';
import assert from 'node:assert/strict';
import { AIOSTREAMS_LANGUAGES, AIOSTREAMS_PSEUDO_LANGUAGES, DEFAULT_LANGUAGE, getLanguage, hasLanguage, languageList, preferredLanguages, preferredSubtitles } from './languages.mjs';

const CURATED = ['pt-BR', 'en', 'es-419', 'es-ES', 'fr', 'it', 'de'];
// Torrentio providers and `language=` keys, from torrentio-scraper (addon/crates/addon/src/domain/filter.rs and languages.rs).
const TORRENTIO_PROVIDERS = ['yts', 'eztv', 'rarbg', '1337x', 'thepiratebay', 'kickasstorrents', 'torrentgalaxy', 'magnetdl', 'horriblesubs', 'nyaasi',
  'tokyotosho', 'anidex', 'nekobt', 'rutor', 'rutracker', 'comando', 'bludv', 'micoleaodublado', 'torrent9', 'ilcorsaronero', 'mejortorrent', 'wolfmax4k',
  'cinecalidad', 'besttorrents'];
const TORRENTIO_LANGUAGES = ['japanese', 'russian', 'italian', 'portuguese', 'spanish', 'latino', 'korean', 'chinese', 'taiwanese', 'french', 'german', 'dutch',
  'hindi', 'telugu', 'tamil', 'polish', 'lithuanian', 'latvian', 'estonian', 'czech', 'slovakian', 'slovenian', 'hungarian', 'romanian', 'bulgarian', 'serbian',
  'croatian', 'ukrainian', 'greek', 'danish', 'finnish', 'swedish', 'norwegian', 'turkish', 'arabic', 'persian', 'hebrew', 'vietnamese', 'indonesian', 'malay', 'thai'];
const all = () => languageList().map((l) => getLanguage(l.id));
// These strings end up inside single-quoted SEL arguments, a /* comment */ or a formatter ["text"||""] branch.
const UNSAFE = /['"\\\[\]{}|]|\*\/|\/\*|\n/;

test('the default is pt-BR and the curated profiles come first, in a fixed order', () => {
  assert.equal(DEFAULT_LANGUAGE, 'pt-BR');
  const list = languageList();
  assert.deepEqual(list.slice(0, CURATED.length).map((l) => l.id), CURATED);
  assert.ok(list.slice(0, CURATED.length).every((l) => l.quality === 'curated'));
  assert.ok(list.slice(CURATED.length).every((l) => l.quality === 'basic'));
  assert.equal(new Set(list.map((l) => l.id)).size, list.length, 'ids are unique');
  assert.equal(getLanguage().id, 'pt-BR');
  assert.equal(hasLanguage('es-419'), true);
  assert.equal(hasLanguage('xx'), false);
  assert.equal(hasLanguage(undefined), false);
  assert.throws(() => getLanguage('xx'), TypeError);
  assert.throws(() => getLanguage({}), TypeError);
});

test('every AIOStreams language can be chosen (curated or basic)', () => {
  const covered = new Set(all().flatMap((l) => l.audio));
  for (const name of AIOSTREAMS_LANGUAGES) assert.ok(covered.has(name), `${name} has no profile`);
  assert.ok(getLanguage('ja').quality === 'basic' && getLanguage('ja').keywords.length === 0 && getLanguage('ja').torrentio.length === 0);
});

test('ids are safe in a URL path segment and names come from AIOStreams', () => {
  for (const l of all()) {
    assert.match(l.id, /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,3})?$/, l.id);
    for (const name of [...l.audio, ...l.subtitles, ...preferredLanguages(l), ...preferredSubtitles(l)]) {
      assert.ok(AIOSTREAMS_LANGUAGES.includes(name) || AIOSTREAMS_PSEUDO_LANGUAGES.includes(name), `${l.id}: ${name}`);
    }
    assert.ok(l.audio.length > 0 && l.subtitles.length > 0, l.id);
  }
});

test('texts that go into expressions and the formatter cannot break their syntax', () => {
  for (const l of all()) {
    const texts = [...l.audio, ...l.subtitles, ...l.keywords, ...l.dualKeywords, ...Object.values(l.labels), l.tag,
      ...(l.exclude ? [...l.exclude.keywords, ...l.exclude.unless] : []),
      ...l.torrentio.flatMap((t) => [t.id, t.language, ...(t.providers ?? [])].filter(Boolean))];
    for (const text of texts) assert.doesNotMatch(text, UNSAFE, `${l.id}: ${text}`);
    for (const label of Object.values(l.labels)) assert.ok(label.length > 0 && label.length <= 20, `${l.id}: ${label}`);
  }
});

test('Torrentio sources only use providers and language keys that exist', () => {
  for (const l of all()) for (const t of l.torrentio) {
    for (const provider of t.providers ?? []) assert.ok(TORRENTIO_PROVIDERS.includes(provider), `${l.id}: ${provider}`);
    if (t.language) assert.ok(TORRENTIO_LANGUAGES.includes(t.language), `${l.id}: ${t.language}`);
    assert.ok(t.language || t.providers?.length, `${t.id} selects nothing`);
    assert.ok(t.mediaTypes.length > 0 && t.mediaTypes.every((m) => ['movie', 'series'].includes(m)));
  }
  assert.equal(new Set(all().flatMap((l) => l.torrentio.map((t) => t.id))).size, all().flatMap((l) => l.torrentio).length, 'preset ids are unique');
  // The proven Brazilian sources stay as they are.
  assert.deepEqual(getLanguage('pt-BR').torrentio.map((t) => t.providers?.[0] ?? t.language), ['portuguese', 'micoleaodublado', 'comando']);
});

test('subtitle codes are OpenSubtitles three-letter codes; the classifier tokens are plain words', () => {
  for (const l of all()) {
    assert.ok(l.subs.codes.length > 0 && l.subs.codes.every((c) => /^[a-z]{3}$/.test(c)), l.id);
    if (l.subs.dub) assert.match(l.subs.dub, /^[a-z0-9\-?\[\]|ñ]+$/i, l.id);
  }
  assert.deepEqual(getLanguage('pt-BR').subs.codes, ['pob', 'por']);
  assert.deepEqual(getLanguage('en').subs.codes, ['eng']);
});

test('curated profiles define the regional-variant rules the task calls for', () => {
  assert.ok(getLanguage('pt-BR').exclude.keywords.includes('pt-pt'));
  assert.ok(getLanguage('fr').exclude.keywords.includes('vfq'), 'VFQ is the Québec dub');
  assert.ok(getLanguage('fr').keywords.includes('multi'), 'MULTi means French audio in French release naming');
  assert.ok(getLanguage('es-419').exclude.keywords.includes('castellano') && getLanguage('es-ES').exclude.keywords.includes('latino'));
  assert.ok(getLanguage('de').dualKeywords.includes('german dl'));
  assert.equal(getLanguage('en').unknownIsMine, true);
});

test('Spanish: "Dual-Lat" releases are Latin American (seen as Castilian on real streams, 2026-11-08)', () => {
  const lat = getLanguage('es-419');
  const es = getLanguage('es-ES');
  assert.ok(lat.keywords.includes('dual-lat'), 'es-419 counts Dual-Lat as its own');
  assert.ok(es.exclude.keywords.includes('dual-lat'), 'es-ES drops Dual-Lat-only releases');
  assert.ok(es.exclude.unless.includes('lat-cast'), 'es-ES keeps Lat-Cast releases, which carry Castilian too');
});
