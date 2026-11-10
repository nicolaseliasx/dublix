import test from 'node:test';
import assert from 'node:assert/strict';
import { applyNextPolicy } from './policy.mjs';

const rule = (expression) => ({ expression, enabled: true });
const base = () => ({
  services: [{ id: 'torbox', credentials: { apiKey: 'untouched' } }],
  presets: [{ type: 'torrentio', enabled: true, options: { timeout: 12000 } }, { type: 'comet', options: { timeout: 7000 } }],
  catalogModifications: [{ id: 'catalog' }],
  deduplicator: { enabled: true, keys: ['infoHash'] },
  seasonEpisodeMatching: { enabled: true, strict: true },
  excludedStreamExpressions: [
    rule('/*Filmhub: enforce device compatibility*/ encode(streams, "AV1")'),
    rule("/*Filmhub: pin PT-BR and original audio*/ pin(streams, 'top')"),
    rule('/*Tamtaro filter*/ keyword(streams, "filename", "CAM")'),
  ],
  includedStreamExpressions: [rule('/*Tamtaro include*/ streams')],
  requiredStreamExpressions: [rule('/*Tamtaro required*/ streams')],
  preferredStreamExpressions: [rule('/*Filmhub: prefer verified Brazilian Portuguese*/ streams'), rule('/*Tamtaro preferred*/ streams')],
  sortCriteria: { global: [{ key: 'resolution', direction: 'desc' }], cached: [{ key: 'quality', direction: 'desc' }], uncached: [] },
  resultLimits: { global: 40, addon: 3 },
  formatter: { id: 'custom', definitions: { custom: { name: 'Tamtaro {stream.resolution}', description: 'Existing {stream.title}' } } },
  cacheAndPlay: { enabled: true, streamTypes: ['usenet'] },
  precacheNextEpisode: true,
  precacheSelector: 'streams',
  alwaysPrecache: true,
});

test('clones config, preserves Tamtaro matching and filters, removes legacy claims and caps presets', () => {
  const input = base();
  const before = structuredClone(input);
  const result = applyNextPolicy(input, { anime: false });
  assert.deepEqual(input, before);
  assert.notStrictEqual(result, input);
  assert.deepEqual(result.services, before.services);
  assert.deepEqual(result.catalogModifications, before.catalogModifications);
  assert.deepEqual(result.deduplicator, before.deduplicator);
  assert.deepEqual(result.seasonEpisodeMatching, before.seasonEpisodeMatching);
  assert.deepEqual(result.includedStreamExpressions, before.includedStreamExpressions);
  assert.ok(result.excludedStreamExpressions.some(x => x.expression.includes('device compatibility')));
  assert.ok(result.excludedStreamExpressions.some(x => x.expression.includes('Tamtaro filter')));
  assert.ok(!JSON.stringify(result).includes('prefer verified Brazilian Portuguese'));
  assert.ok(!JSON.stringify(result).includes('pin PT-BR and original audio'));
  assert.equal(result.resultLimits.global, 9);
  assert.equal(result.resultLimits.addon, 3);
  assert.equal(result.presets[0].options.timeout, 8000);
  assert.equal(result.presets[1].options.timeout, 7000);
  assert.deepEqual(result.cacheAndPlay, { enabled: true, streamTypes: ['usenet', 'torrent'] });
  assert.equal(result.precacheNextEpisode, false);
  assert.equal(result.precacheSelector, undefined);
  assert.equal(result.alwaysPrecache, false);
});

test('reapplication is idempotent, including anime switch', () => {
  const once = applyNextPolicy(base(), { anime: true });
  assert.deepEqual(applyNextPolicy(once, { anime: true }), once);
  const movie = applyNextPolicy(once, { anime: false });
  assert.equal(movie.requiredStreamExpressions.length, 1);
  assert.ok(movie.formatter.definitions.custom.description.endsWith('"||""]}Existing {stream.title}'));
  assert.equal(movie.formatter.definitions.custom.description.split('Dual áudio').length, 2);
});

test('PT-BR rules also match releases tagged only as Portuguese (PT-PT is excluded elsewhere)', () => {
  const result = applyNextPolicy(base(), { anime: false });
  const own = [...result.preferredStreamExpressions, ...result.excludedStreamExpressions]
    .filter(x => x.expression.includes('PT-BR') || x.expression.includes('faixas 4K 1080p 720p'));
  assert.ok(own.length >= 2);
  for (const rule of own) assert.match(rule.expression, /language\(streams, 'Portuguese'\)/);
});

test('failover never swaps the clicked release (keeps a chosen uncached dub)', () => {
  const input = { ...base(), failover: { enabled: true, parallel: 2, sameReleaseLimit: 2 } };
  const result = applyNextPolicy(input, { anime: false });
  assert.equal(result.failover.onlySameReleaseFailover, true);
  // Failover aborts (and deletes) an uncached torrent at its ~30 s deadline.
  assert.equal(result.failover.enabled, false);
  assert.equal(result.failover.sameReleaseLimit, 2);
  assert.equal(applyNextPolicy(base(), { anime: false }).failover, undefined);
});

test('title matching covers every source except the owner TorBox library', () => {
  const input = { ...base(), titleMatching: { enabled: true, mode: 'exact', addons: [] },
    presets: [{ type: 'library', instanceId: 'lib', enabled: true }, { type: 'torrentio', instanceId: 't1', enabled: true, options: {} },
      { type: 'comet', instanceId: 'c1', enabled: true, options: {} }, { type: 'zilean', instanceId: 'off', enabled: false, options: {} }] };
  const result = applyNextPolicy(input, { anime: false });
  assert.deepEqual(result.titleMatching.addons, ['t1', 'c1']);
  assert.equal(result.titleMatching.enabled, true);
});

test('drops Real-Debrid streams (no RD account; TorBox-only pilot), keeping other results of that addon', () => {
  const result = applyNextPolicy(base(), { anime: false });
  const rules = result.excludedStreamExpressions.filter(x => x.expression.includes('sem Real-Debrid'));
  assert.equal(rules.length, 1);
  assert.match(rules[0].expression, /service\(streams, 'realdebrid'\)$/);
  assert.equal(applyNextPolicy(result, { anime: false }).excludedStreamExpressions.filter(x => x.expression.includes('sem Real-Debrid')).length, 1);
});

test('rebaixa ao fim arquivos H.264 10 bits (Hi10P), sem excluir e sem tocar HEVC 10 bits', () => {
  for (const anime of [false, true]) {
    const result = applyNextPolicy(base(), { anime });
    const rules = result.excludedStreamExpressions.filter(x => x.expression.includes('Hi10P'));
    assert.equal(rules.length, 1, 'uma única regra');
    assert.equal(rules[0].enabled, true);
    assert.match(rules[0].expression, /^\/\*Filmhub Next T4: Hi10P\*\//);
    assert.match(rules[0].expression, /pin\(visualTag\(encode\(streams, 'AVC'\), '10bit'\), 'bottom'\)/);
  }
  const once = applyNextPolicy(base(), { anime: false });
  assert.deepEqual(applyNextPolicy(once, { anime: false }), once, 'idempotente');
});

test('rebaixa ao fim pacotes com pasta de 1 TB ou mais (zip gigante que não reproduz), sem excluir', () => {
  for (const anime of [false, true]) {
    const result = applyNextPolicy(base(), { anime });
    const rules = result.excludedStreamExpressions.filter(x => x.expression.includes('pacote gigante'));
    assert.equal(rules.length, 1, 'uma única regra');
    assert.equal(rules[0].enabled, true);
    assert.match(rules[0].expression, /^\/\*Filmhub Next T4: pacote gigante\*\//);
    assert.match(rules[0].expression, /pin\(folderSize\(streams, '1TB'\), 'bottom'\)$/);
  }
  const once = applyNextPolicy(base(), { anime: false });
  assert.deepEqual(applyNextPolicy(once, { anime: false }), once, 'idempotente');
});

test('rebaixa ao fim arquivos minúsculos de episódio (extras), só em séries comuns e sem punir tamanho desconhecido', () => {
  for (const anime of [false, true]) {
    const result = applyNextPolicy(base(), { anime });
    const rules = result.excludedStreamExpressions.filter(x => x.expression.includes('arquivos minúsculos'));
    assert.equal(rules.length, 1, 'uma única regra');
    assert.equal(rules[0].enabled, true);
    assert.match(rules[0].expression, /^\/\*Filmhub Next T4: arquivos minúsculos\*\//);
    assert.match(rules[0].expression, /queryType == 'series'/);
    assert.match(rules[0].expression, /pin\(size\(streams, '1B', '100MB'\), 'bottom'\)/);
    assert.equal(result.excludedStreamExpressions.some(x => /size\(streams, '?0/.test(x.expression)), false, 'tamanho 0/desconhecido nunca entra');
  }
  const once = applyNextPolicy(base(), { anime: false });
  assert.deepEqual(applyNextPolicy(once, { anime: false }), once, 'idempotente');
});

test('ano: compara com o ano de cada temporada, não só com a estreia (pacotes BR levam o ano da temporada)', () => {
  const yearMatching = { enabled: true, tolerance: 1, strict: true, strictTypes: ['movie'], useInitialAirDate: true, requestTypes: ['movie', 'series', 'anime'], addons: [] };
  const input = { ...base(), yearMatching };
  const before = structuredClone(input);
  const result = applyNextPolicy(input, { anime: false });
  assert.deepEqual(input, before, 'não muta a entrada');
  assert.deepEqual(result.yearMatching, { ...yearMatching, useInitialAirDate: false }, 'só useInitialAirDate muda');
  assert.equal(applyNextPolicy(result, { anime: true }).yearMatching.useInitialAirDate, false, 'idempotente e igual no anime');
  assert.equal('yearMatching' in applyNextPolicy(base(), { anime: false }), false, 'não cria casamento de ano que não existia');
  const off = applyNextPolicy({ ...base(), yearMatching: { ...yearMatching, enabled: false } }, { anime: false });
  assert.equal(off.yearMatching.enabled, false, 'não liga o que estava desligado');
});

test('anime keeps the language contract: PT-BR if present, otherwise the original language', () => {
  const result = applyNextPolicy(base(), { anime: true });
  const expression = result.requiredStreamExpressions.at(-1).expression;
  assert.match(expression, /count\(/);
  assert.match(expression, /originalLanguage\s*\?/);
  assert.match(expression, /language\(streams, originalLanguage\)/);
  assert.match(expression, /keyword\(/);
  assert.ok(result.formatter.definitions.custom.description.includes('Existing {stream.title}'));
});

test('list shape: 9 options, 3 per resolution (2 PT-BR + 1 original) over 4K, 1080p and 720p only', () => {
  const result = applyNextPolicy(base(), { anime: false });
  assert.equal(result.resultLimits.global, 9);
  assert.equal(result.resultLimits.resolution, 3);
  const rule = name => result.excludedStreamExpressions.filter(x => x.expression.startsWith(`/*Filmhub Next T4: ${name}*/`));
  for (const tier of ['2160p', '1080p', '720p']) {
    const [pt] = rule(`faixa ${tier} PT-BR`);
    const [original] = rule(`faixa ${tier} original`);
    assert.ok(pt && original, tier);
    assert.match(pt.expression, /, 0, 2\), resolution\(/, `${tier}: 2 PT-BR`);
    assert.match(original.expression, /, 0, 1\), resolution\(/, `${tier}: 1 original`);
    for (const r of [pt, original]) assert.equal((r.expression.match(/'(\d+p)'/g) ?? []).every(x => x === `'${tier}'`), true, 'uma faixa por regra');
  }
  const below = rule('abaixo de 720p');
  assert.equal(below.length, 1);
  assert.equal(below[0].expression.includes("'480p'"), false);
  assert.match(below[0].expression, /count\(.*\) > 0 \? negate\(/);
  assert.equal(rule('só cacheados').length, 1);
  assert.match(rule('reserva PT-BR não cacheado')[0].expression, /passthrough\(slice\(uncached\(.*\), 0, 1\), 'limit'\)/);
});

test('sorts cached first, then resolution, then PT-BR before original, then best quality, then smaller files', () => {
  const result = applyNextPolicy(base(), { anime: false });
  assert.deepEqual(result.sortCriteria.global.slice(0, 5).map(x => x.key), ['cached', 'resolution', 'streamExpressionMatched', 'quality', 'size']);
  assert.deepEqual(result.sortCriteria.global[2], { key: 'streamExpressionMatched', direction: 'desc' });
  assert.deepEqual(result.sortCriteria.global[3], { key: 'quality', direction: 'desc' });
  assert.deepEqual(result.sortCriteria.global[4], { key: 'size', direction: 'asc' });
  assert.deepEqual(result.sortCriteria.cached.slice(0, 4).map(x => x.key), ['resolution', 'streamExpressionMatched', 'quality', 'size']);
  assert.equal(result.sortCriteria.global.filter(x => x.key === 'quality').length, 1, 'quality aparece uma só vez');
  assert.match(result.preferredStreamExpressions[0].expression, /PT-BR provável/);
  assert.match(result.preferredStreamExpressions[1].expression, /originalLanguage/);
});

test('P2P uses seeds within each language/quality and limits candidates without reserving a debrid download', () => {
  const once = applyNextPolicy(base(), { anime: false, p2p: true });
  assert.deepEqual(applyNextPolicy(once, { anime: false, p2p: true }), once);
  const expressions = once.excludedStreamExpressions.map((r) => r.expression).join('\n');
  assert.doesNotMatch(expressions, /cached\(|passthrough\(/);
  assert.match(expressions, /faixa 1080p PT-BR/);
  assert.deepEqual(once.sortCriteria.global.slice(0, 3).map((c) => c.key), ['resolution', 'streamExpressionMatched', 'seeders']);
  assert.throws(() => applyNextPolicy(base(), { anime: false, p2p: 'yes' }), /p2p/);
});

test('audio labels: Dual / PT-BR / original as zero-score ranked expressions plus one description prefix, once', () => {
  for (const anime of [false, true]) {
    const twice = applyNextPolicy(applyNextPolicy(base(), { anime }), { anime });
    for (const mark of ['áudio Dual', 'áudio PT-BR', 'áudio original']) {
      const ranked = twice.rankedStreamExpressions.filter(x => x.expression.includes(mark));
      assert.equal(ranked.length, 1, mark);
      assert.equal(ranked[0].score, 0);
    }
    const description = twice.formatter.definitions.custom.description;
    assert.ok(description.startsWith('{stream.rseMatched::~Filmhub Next T4: áudio Dual["Dual áudio\n"||""]}'));
    assert.ok(description.includes('["PT-BR\n"||""]}'));
    assert.ok(description.includes('["Original\n"||""]}'));
    assert.ok(description.endsWith('Existing {stream.title}'));
    assert.equal(description.includes('trocar áudio'), false);
    assert.equal(description.includes('verificad'), false);
    assert.equal(JSON.stringify(twice).includes('PT disponível'), false);
    assert.equal(JSON.stringify(twice).includes('PT verificado'), false);
  }
});

test('re-applying drops the superseded PT verificado / PT disponível labels and the old anime prefix', () => {
  const old = base();
  old.rankedStreamExpressions = [rule('/*Filmhub Next T4: PT verificado*/ streams'), rule('/*Filmhub Next T4: PT disponível*/ streams'), rule('/*mine*/ streams')];
  old.formatter.definitions.custom.description = '{stream.rseMatched::~Filmhub Next T4: PT verificado["✓ PT verificado (trilha)\n"||""]}'
    + '{stream.rseMatched::~Filmhub Next T4: PT disponível["⚠ PT disponível (trocar áudio)\n"||""]}Existing {stream.title}';
  const result = applyNextPolicy(old, { anime: false });
  assert.equal(JSON.stringify(result).includes('PT disponível'), false);
  assert.equal(JSON.stringify(result).includes('PT verificado'), false);
  assert.ok(result.rankedStreamExpressions.some(x => x.expression.includes('/*mine*/')));
  assert.ok(result.formatter.definitions.custom.description.endsWith('Existing {stream.title}'));
});

test('cada expressão cabe no limite do AIOStreams (3000 caracteres; 50000 no total) ou a API recusa o perfil', () => {
  for (const anime of [false, true]) {
    const result = applyNextPolicy(base(), { anime });
    const all = ['excludedStreamExpressions', 'includedStreamExpressions', 'requiredStreamExpressions', 'preferredStreamExpressions', 'rankedStreamExpressions']
      .flatMap(key => result[key] ?? []);
    for (const entry of all) assert.ok(entry.expression.length <= 3000, `${entry.expression.slice(0, 60)}… tem ${entry.expression.length}`);
    assert.ok(all.reduce((sum, entry) => sum + entry.expression.length, 0) <= 50000);
    assert.ok(all.length <= 200);
  }
});

test('desenhos (gênero Animation) seguem a regra de idioma do anime mesmo sem a marca isAnime', () => {
  for (const anime of [false, true]) {
    const result = applyNextPolicy(base(), { anime });
    const rule = result.excludedStreamExpressions.find(x => x.expression.includes('anime idioma por consulta'));
    assert.match(rule.expression, /isAnime or 'Animation' in genres/);
  }
});
