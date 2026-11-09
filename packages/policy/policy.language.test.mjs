import test from 'node:test';
import assert from 'node:assert/strict';
import { applyNextPolicy, POLICY_LIMITS } from './policy.mjs';
import { getLanguage, languageList } from './languages.mjs';

const base = () => ({
  services: [{ id: 'torbox', credentials: { apiKey: 'x' } }],
  presets: [{ type: 'torrentio', instanceId: 't', enabled: true, options: { timeout: 5000 } }],
  excludedStreamExpressions: [{ expression: '/*Filmhub: enforce device compatibility*/ encode(streams, "AV1")', enabled: true }],
  preferredStreamExpressions: [], requiredStreamExpressions: [], rankedStreamExpressions: [],
  sortCriteria: {}, resultLimits: {},
  formatter: { id: 'custom', definitions: { custom: { name: 'n', description: 'Existing {stream.title}' } } },
});
const ids = languageList().map((l) => l.id);
const rules = (cfg, key = 'excludedStreamExpressions') => cfg[key].map((e) => e.expression);
const named = (cfg, name) => cfg.excludedStreamExpressions.filter((e) => e.expression.startsWith(`/*Filmhub Next T4: ${name}*/`));
const exprs = (cfg) => ['excludedStreamExpressions', 'preferredStreamExpressions', 'requiredStreamExpressions', 'rankedStreamExpressions'].flatMap((k) => cfg[k] ?? []).map((e) => e.expression);

test('the language option picks the profile; an unknown language is rejected', () => {
  assert.throws(() => applyNextPolicy(base(), { anime: false, language: 'xx' }), TypeError);
  assert.equal(JSON.stringify(applyNextPolicy(base(), { anime: false })), JSON.stringify(applyNextPolicy(base(), { anime: false, language: 'pt-BR' })));
});

test('every profile produces rules that name its own audio and nothing Portuguese (except pt-BR)', () => {
  for (const id of ids) for (const anime of [false, true]) {
    const l = getLanguage(id);
    const out = applyNextPolicy(base(), { anime, language: id });
    const text = JSON.stringify(out);
    assert.ok(text.includes(`language(streams, '${l.audio[0]}')`), id);
    assert.ok(named(out, `faixa 1080p ${l.tag}`).length === 1, id);
    if (!['pt-BR', 'pt-PT'].includes(id)) assert.doesNotMatch(text, /Portuguese|PT-BR|dublado|pt-br/, id);
    const description = out.formatter.definitions.custom.description;
    assert.ok(description.startsWith(`{stream.rseMatched::~Filmhub Next T4: áudio Dual["${l.labels.dual}\n"||""]}`), id);
    assert.ok(description.includes(`["${l.labels.dubbed}\n"||""]}`) && description.includes(`["${l.labels.original}\n"||""]}`), id);
    assert.ok(description.endsWith('Existing {stream.title}'), id);
  }
});

test('switching language on an already configured profile replaces every label and rule (pt-BR -> es-419 -> pt-BR)', () => {
  const pt = applyNextPolicy(base(), { anime: true });
  const es = applyNextPolicy(pt, { anime: true, language: 'es-419' });
  assert.doesNotMatch(JSON.stringify(es), /Portuguese|PT-BR|Dual áudio/);
  assert.equal(es.formatter.definitions.custom.description.split('Doble audio').length, 2);
  assert.equal(JSON.stringify(applyNextPolicy(es, { anime: true })), JSON.stringify(pt));
  for (const id of ids) {
    const once = applyNextPolicy(base(), { anime: false, language: id });
    assert.equal(JSON.stringify(applyNextPolicy(once, { anime: false, language: id })), JSON.stringify(once), `${id} is idempotent`);
  }
});

test('the dual / own-language / other-audio labels follow the profile (French: tracks, MULTi keyword; German: German DL)', () => {
  const fr = applyNextPolicy(base(), { anime: false, language: 'fr' });
  const dual = fr.rankedStreamExpressions.find((e) => e.expression.includes('áudio Dual')).expression;
  assert.match(dual, /audioTrack\(streams, '!lang=French'\), audioTrack\(streams, 'lang=French'\)/);
  assert.match(dual, /keyword\(streams, 'all', 'dual', 'multi'\)/);
  assert.match(JSON.stringify(fr), /'all', 'multi'\)/, 'MULTi counts as French audio');
  const de = applyNextPolicy(base(), { anime: false, language: 'de' });
  assert.match(JSON.stringify(de), /keyword\(streams, 'all', 'dual', 'multi', 'german dl'\)/);
});

test('a profile without keywords leaves the keyword() call out (SEL rejects it with no arguments)', () => {
  for (const id of ['ja', 'ko', 'nl']) {
    const text = rules(applyNextPolicy(base(), { anime: true, language: id })).join('\n');
    assert.doesNotMatch(text, /keyword\(negate\(audioTrack/, id);
    assert.doesNotMatch(text, /merge\(language\(streams, '[A-Za-z ]+'\)\)/, `${id}: a one-item merge is just the item`);
  }
});

test('English: untagged releases are English when the title is English or unknown; the original group is the title language otherwise', () => {
  const en = applyNextPolicy(base(), { anime: false, language: 'en' });
  const text = JSON.stringify(en);
  assert.match(text, /originalLanguage == '' or originalLanguage == 'English'\) \? language\(streams, 'Unknown'\) : \[\]/);
  assert.match(text, /originalLanguage and originalLanguage != 'English'/);
  assert.equal(named(en, 'outros idiomas').length, 1, 'foreign dubs are dropped, not left unlimited');
  assert.equal(named(applyNextPolicy(base(), { anime: false, language: 'es-419' }), 'outros idiomas').length, 0);
  assert.equal(named(applyNextPolicy(base(), { anime: false }), 'outros idiomas').length, 0);
});

test('languageOnly keeps only the chosen language, forces zero original slots and cannot be combined with zero language slots', () => {
  for (const id of ids) {
    const out = applyNextPolicy(base(), { anime: false, language: id, languageOnly: true });
    assert.equal(out.resultLimits.global, 6, id);
    assert.equal(out.resultLimits.resolution, 2, id);
    assert.equal(named(out, 'só o idioma').length, 1, id);
    assert.match(named(out, 'só o idioma')[0].expression, /^\/\*Filmhub Next T4: só o idioma\*\/ negate\(/);
    assert.equal(named(out, 'outros idiomas').length, 0, 'superseded');
    assert.match(named(out, `faixa 1080p original`)[0].expression, /, 0, 0\), resolution\(/);
  }
  assert.equal(named(applyNextPolicy(base(), { anime: false }), 'só o idioma').length, 0);
  assert.throws(() => applyNextPolicy(base(), { anime: false, languageOnly: true, ptSlots: 0 }), TypeError);
  assert.throws(() => applyNextPolicy(base(), { anime: false, languageOnly: 'yes' }), TypeError);
  const once = applyNextPolicy(base(), { anime: false, languageOnly: true });
  assert.equal(JSON.stringify(applyNextPolicy(once, { anime: false })), JSON.stringify(applyNextPolicy(base(), { anime: false })), 'turning it off restores the normal list');
});

test('every profile x slot combination x languageOnly stays within the AIOStreams expression limits', () => {
  for (const id of ids) for (const anime of [false, true]) for (let pt = 0; pt <= POLICY_LIMITS.maxSlots; pt += 1) for (let og = 0; og <= POLICY_LIMITS.maxSlots; og += 1) for (const languageOnly of [false, true]) {
    if (pt + og === 0 || (languageOnly && pt === 0)) continue;
    const out = applyNextPolicy(base(), { anime, language: id, tiers: ['2160p', '1080p', '720p'], ptSlots: pt, originalSlots: og, languageOnly, excludeServices: ['realdebrid', 'alldebrid'] });
    const list = exprs(out);
    for (const e of list) assert.ok(e.length <= 3000, `${id}: ${e.slice(0, 70)} = ${e.length}`);
    assert.ok(list.join('').length <= 50000, id);
    assert.ok(list.length <= 200);
  }
});
