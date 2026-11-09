import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildFilmhubConfig, findSecrets, localizeBase, localizedRules, torrentioPreset } from './config.mjs';
import { getLanguage, languageList, preferredLanguages, preferredSubtitles } from './languages.mjs';

const base = JSON.parse(readFileSync(new URL('./base-config.json', import.meta.url), 'utf8'));
const opts = (o = {}) => ({ services: [{ id: 'torbox', credentials: { apiKey: 'fake-torbox-key' } }], ...o });
const ids = languageList().map((l) => l.id);
const body = (rule) => rule.expression.replace(/^\/\*[^*]*\*\/ /, '');

test('base-config.json is the pt-BR rendering: the pt-BR profile data reproduces its language-specific parts exactly', () => {
  const l = getLanguage('pt-BR');
  const own = ['filmhub-regular-show-ptbr', 'filmhub-ptbr', 'filmhub-ptbr-verified'];
  assert.deepEqual(l.torrentio.map(torrentioPreset), own.map((id) => base.presets.find((p) => p.instanceId === id)));
  assert.equal(JSON.stringify(l.torrentio.map(torrentioPreset)), JSON.stringify(own.map((id) => base.presets.find((p) => p.instanceId === id))), 'key order too');
  assert.deepEqual(base.preferredLanguages, preferredLanguages(l));
  assert.deepEqual(base.preferredSubtitles, preferredSubtitles(l));
  const rules = localizedRules(l);
  assert.equal(rules.excluded, body(base.excludedStreamExpressions.find((e) => e.expression.includes('reject European Portuguese'))));
  assert.equal(rules.preferred, body(base.preferredStreamExpressions.find((e) => e.expression.includes('prefer embedded PT-BR subtitles'))));
});

test('pt-BR (explicit or default) leaves the base untouched', () => {
  assert.equal(JSON.stringify(localizeBase(structuredClone(base), getLanguage('pt-BR'))), JSON.stringify(base));
});

test('every language builds from the public base without secrets and with consistent preset ids', () => {
  for (const id of ids) {
    const local = localizeBase(structuredClone(base), getLanguage(id));
    assert.deepEqual(findSecrets(local), [], id);
    const presetIds = new Set(local.presets.map((p) => p.instanceId));
    for (const ref of [...local.titleMatching.addons, ...local.serviceWrap.presets]) assert.ok(presetIds.has(ref), `${id}: dangling ${ref}`);
    for (const t of getLanguage(id).torrentio) {
      assert.ok(presetIds.has(t.id) && local.serviceWrap.presets.includes(t.id) && local.titleMatching.addons.includes(t.id), `${id}: ${t.id}`);
    }
    assert.equal(new Set(local.presets.map((p) => p.instanceId)).size, local.presets.length, `${id}: unique ids`);
    for (const tmdbApiKey of ['', 'fake-tmdb-key']) {
      const cfg = buildFilmhubConfig(base, opts({ language: id, tmdbApiKey, anime: id === 'fr' }));
      assert.deepEqual(cfg.preferredLanguages, preferredLanguages(getLanguage(id)));
      assert.ok(cfg.resultLimits.global === 9, id);
    }
  }
});

test('a non-Portuguese build carries nothing Portuguese or Brazilian, and the language rules replace the base ones in place', () => {
  for (const id of ids.filter((x) => !['pt-BR', 'pt-PT'].includes(x))) {
    const cfg = buildFilmhubConfig(base, opts({ language: id }));
    const text = JSON.stringify(cfg);
    assert.doesNotMatch(text, /Portuguese|PT-BR|pt-br|dublado|dublagem|micoleaodublado|comando|Sterzeck|bludv|Brazil/i, id);
    assert.ok(cfg.excludedStreamExpressions.some((e) => e.expression.includes('enforce device compatibility')), id);
  }
  const es = buildFilmhubConfig(base, opts({ language: 'es-419' }));
  const regional = es.excludedStreamExpressions.find((e) => e.expression.includes('regional variant'));
  assert.match(regional.expression, /negate\(keyword\(streams, 'all', 'latino', 'latam', 'dual-lat'\), keyword\(streams, 'all', 'castellano'/);
  assert.equal(es.excludedStreamExpressions.indexOf(regional), 1, 'same position as the European Portuguese rule');
  assert.match(es.preferredStreamExpressions.find((e) => e.expression.includes('embedded')).expression, /subtitle\(negate\(language\(streams, 'Latino'\), streams\), 'Latino', 'Spanish'\)/);
  assert.equal(buildFilmhubConfig(base, opts({ language: 'en' })).excludedStreamExpressions.some((e) => e.expression.includes('regional')), false, 'no variant rule for English');
  const fr = buildFilmhubConfig(base, opts({ language: 'fr' }));
  assert.match(fr.excludedStreamExpressions.find((e) => e.expression.includes('regional')).expression, /'vfq'/);
});

test('Torrentio presets: the language profile brings its own providers; English and basic languages keep the default Torrentio only', () => {
  const sources = (id) => buildFilmhubConfig(base, opts({ language: id })).presets.filter((p) => p.type === 'torrentio').map((p) => [p.instanceId, p.options.providers.join(), p.options.url]);
  assert.deepEqual(sources('en'), [['4ef', '', undefined]]);
  assert.deepEqual(sources('ja'), [['4ef', '', undefined]]);
  assert.deepEqual(sources('es-419'), [['4ef', '', undefined], ['filmhub-es419-language', '', 'https://torrentio.strem.fun/language=latino/manifest.json'], ['filmhub-es419', 'cinecalidad', 'https://torrentio.strem.fun']]);
  assert.deepEqual(sources('es-ES').map((s) => s[1]), ['', '', 'mejortorrent,wolfmax4k']);
  assert.deepEqual(sources('fr').map((s) => s[1]), ['', '', 'torrent9']);
  assert.deepEqual(sources('it').map((s) => s[1]), ['', '', 'ilcorsaronero']);
  assert.deepEqual(sources('de').map((s) => s[2]), [undefined, 'https://torrentio.strem.fun/language=german/manifest.json']);
  assert.deepEqual(sources('pt-BR').map((s) => s[1]), ['', '', 'micoleaodublado', 'comando']);
  const synced = (id) => JSON.stringify([buildFilmhubConfig(base, opts({ language: id })).syncedRankedRegexUrls, buildFilmhubConfig(base, opts({ language: id })).syncedRankedStreamExpressionUrls]);
  assert.equal(synced('es-419'), synced('pt-BR'), 'no new synced regex / SEL lists (public instances refuse unknown ones)');
});

test('buildFilmhubConfig passes language and languageOnly to the policy and rejects an unknown language', () => {
  const cfg = buildFilmhubConfig(base, opts({ language: 'it', languageOnly: true }));
  assert.equal(cfg.resultLimits.global, 6);
  assert.ok(cfg.excludedStreamExpressions.some((e) => e.expression.includes('só o idioma')));
  assert.throws(() => buildFilmhubConfig(base, opts({ language: 'xx' })), TypeError);
});

test('the real base profile stays within the AIOStreams expression limits (3000 each, 50000 total) for every language at the extremes', () => {
  const total = (cfg) => ['excludedStreamExpressions', 'preferredStreamExpressions', 'requiredStreamExpressions', 'includedStreamExpressions', 'rankedStreamExpressions']
    .flatMap((k) => cfg[k] ?? []).map((e) => e.expression);
  for (const id of ids) for (const anime of [false, true]) {
    for (const extra of [{ ptSlots: 3, originalSlots: 3 }, { ptSlots: 3, originalSlots: 0 }, { ptSlots: 1, originalSlots: 3 }, { languageOnly: true, ptSlots: 3 }, { cachedOnly: false, excludeServices: ['realdebrid', 'alldebrid'] }]) {
      const list = total(buildFilmhubConfig(base, opts({ language: id, anime, tiers: ['2160p', '1080p', '720p'], ...extra })));
      for (const e of list) assert.ok(e.length <= 3000, `${id}: ${e.slice(0, 70)} = ${e.length}`);
      assert.ok(list.reduce((sum, e) => sum + e.length, 0) <= 50000, id);
    }
  }
});
