import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyAudio, pickSubtitles, createHandler, route, manifestFor, MANIFEST } from './subs.mjs';
import { getLanguage, languageList } from '../policy/languages.mjs';

test('classifyAudio (pt-BR): nomes dublados/dual/multi contam como dublagem BR; o resto é original', () => {
  const dubbed = ['Movie.2020.1080p.Dublado.mkv', 'Movie.2020.PT-BR.1080p.mkv', 'Movie.2020.ptbr.mkv', 'Filme.Dublada.720p.mkv',
    'Movie.2020.Brazilian.mkv', 'Movie.2020.Dublagem.Brasileira.mkv', 'Severance.S02E07.1080p.WEB-DL.DUAL-C76.mkv',
    'Movie.2020.MULTi.PT-BR.1080p.mkv', 'Movie.2020.DUAL.PT.ENG.1080p.mkv', 'Ruptura S02E07 WEB-DL 1080p x264 DUAL 5.1.mkv'];
  for (const name of dubbed) assert.equal(classifyAudio(name), 'dub', name);
  const original = ['Severance.S02E07.2160p.ATVP.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX.mkv', 'S02E07.mkv', 'Movie.2020.1080p.BluRay.x264-GRP.mkv',
    'Duality.2020.1080p.mkv', 'Mult.Movie.mkv', 'Dualist.2020.mkv', '', undefined,
    // MULTi sem sinal de PT (release francês etc.) e "Dual Audio" de anime (japonês + inglês) são original: a lista também os mostra como Original.
    'Forrest.Gump.1994.MULTi.1080p.BluRay.x264-GRP.mkv', 'Severance.S02E07.MULTI.2160p.mkv', 'Movie.2020.MULTi.VFF.1080p.mkv', 'Movie.2020.TRUEFRENCH.MULTi.mkv',
    'Anime.S01E01.Dual.Audio.1080p.mkv', 'Anime.S01E01.DUAL-AUDIO.1080p.mkv', 'Show.S01E01.DUAL.JAP.ENG.1080p.mkv', 'Movie.Dual.Audio.1080p.mkv',
    // "Dual" de Dolby Vision (duas camadas) não é áudio
    'Severance.S02E07.2160p.ATVP.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX.Dual-DoVi.mkv', 'Movie.2160p.Dual-Layer.mkv'];
  for (const name of original) assert.equal(classifyAudio(name), 'original', String(name));
});

test('classifyAudio: "PT" isolado só conta com a marca de idioma ao lado de outro token de áudio', () => {
  assert.equal(classifyAudio('Movie.2020.1080p.PT.mkv'), 'original', 'PT sozinho é ambíguo (pode ser Portugal)');
  assert.equal(classifyAudio('Movie.2020.PT-PT.1080p.mkv'), 'original', 'português europeu não é dublagem BR');
});

const sub = (id, lang, extra = {}) => ({ id, url: `https://example.test/${id}`, lang, ...extra });

test('pickSubtitles (pt-BR): só pob, depois por como reserva; hash e release parecida primeiro; no máximo 5', () => {
  const upstream = [sub('1', 'eng'), sub('2', 'pob', { releaseGroup: 'OTHER', m: 'i' }), sub('3', 'pob', { releaseGroup: 'FLUX', m: 'i' }),
    sub('4', 'pob', { m: 'h' }), sub('5', 'spa'), sub('6', 'por')];
  const out = pickSubtitles(upstream, 'Show.S01E01.2160p.WEB-DL.H.265-FLUX.mkv', ['pob', 'por']);
  assert.deepEqual(out.map(s => s.id), ['4', '3', '2']);
  assert.ok(out.every(s => s.lang === 'pob'));
  const onlyPor = pickSubtitles([sub('1', 'eng'), sub('6', 'por')], 'x.mkv', ['pob', 'por']);
  assert.deepEqual(onlyPor.map(s => s.id), ['6']);
  assert.deepEqual(pickSubtitles([sub('1', 'eng')], 'x.mkv', ['pob', 'por']), []);
  const many = Array.from({ length: 9 }, (_, i) => sub(String(i), 'pob'));
  assert.equal(pickSubtitles(many, 'x.mkv', ['pob', 'por']).length, 5);
});

test('manifest: só o recurso de legendas', () => {
  assert.deepEqual(MANIFEST.resources, ['subtitles']);
  assert.ok(MANIFEST.types.includes('movie') && MANIFEST.types.includes('series'));
  assert.match(MANIFEST.id, /filmhub/);
});

const upstreamBody = { subtitles: [sub('1', 'eng'), sub('2', 'pob', { m: 'h' })] };
const makeHandler = (calls = []) => createHandler({
  fetchJson: async url => { calls.push(url); return upstreamBody; },
  now: () => 0,
});

test('handler: arquivo dublado/dual → lista vazia e sem chamar a fonte', async () => {
  const calls = [];
  const handle = makeHandler(calls);
  const r = await handle({ type: 'movie', id: 'tt0109830', extra: { filename: 'Movie.1994.Dublado.1080p.mkv' } });
  assert.deepEqual(r.subtitles, []);
  assert.equal(calls.length, 0);
});

test('handler: arquivo original → só PT-BR da fonte, repassando as dicas do arquivo', async () => {
  const calls = [];
  const handle = makeHandler(calls);
  const r = await handle({ type: 'series', id: 'tt11280740:2:7', extra: { filename: 'Show.S02E07.2160p.WEB-DL-FLUX.mkv', videoSize: '123', videoHash: 'abc' } });
  assert.deepEqual(r.subtitles.map(s => s.id), ['2']);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^https:\/\/opensubtitles-v3\.strem\.io\/subtitles\/series\/tt11280740:2:7\//);
  assert.match(calls[0], /videoHash=abc/);
  assert.match(calls[0], /videoSize=123/);
});

test('handler: sem nome do arquivo (cliente não informou) → trata como original', async () => {
  const r = await makeHandler()({ type: 'movie', id: 'tt1', extra: {} });
  assert.deepEqual(r.subtitles.map(s => s.id), ['2']);
});

test('handler: cache por título e arquivo; falha da fonte devolve vazio com cache curto, sem lançar', async () => {
  const calls = [];
  const handle = createHandler({ fetchJson: async url => { calls.push(url); return upstreamBody; }, now: () => 1000 });
  const args = { type: 'movie', id: 'tt1', extra: { filename: 'a.mkv' } };
  await handle(args); await handle(args);
  assert.equal(calls.length, 1);
  const failing = createHandler({ fetchJson: async () => { throw new Error('timeout'); }, now: () => 0 });
  const r = await failing(args);
  assert.deepEqual(r.subtitles, []);
  assert.ok(r.cacheMaxAge <= 300);
});

test('handler: rejeita id fora do padrão IMDb (nada de URL arbitrária)', async () => {
  const calls = [];
  const handle = makeHandler(calls);
  for (const id of ['../x', 'http://evil', 'tt1/../../a', 'kitsu:1']) {
    const r = await handle({ type: 'movie', id, extra: {} });
    assert.deepEqual(r.subtitles, [], id);
  }
  assert.equal(calls.length, 0);
});

test('route: manifest, subtitles path with encoded extras, and 404 (same routes for the Worker and Node)', async () => {
  const handle = makeHandler();
  const [mStatus, manifest] = await route('/manifest.json', handle);
  assert.equal(mStatus, 200);
  assert.equal(manifest.id, 'filmhub.subs');
  const extra = encodeURIComponent('filename=Show.S02E07.2160p-FLUX.mkv&videoSize=1');
  const [, ok] = await route(`/subtitles/series/tt11280740%3A2%3A7/${extra}.json`, handle);
  assert.deepEqual(ok.subtitles.map(s => s.id), ['2']);
  const [, dubbed] = await route(`/subtitles/movie/tt1/${encodeURIComponent('filename=Movie.Dublado.mkv')}.json`, handle);
  assert.deepEqual(dubbed.subtitles, []);
  const [, bare] = await route('/subtitles/movie/tt1.json', handle);
  assert.deepEqual(bare.subtitles.map(s => s.id), ['2']);
  assert.equal((await route('/outra-coisa', handle))[0], 404);
});

test('cache key is bounded and includes the hash and size hints; absurd filenames are not forwarded', async () => {
  const calls = [];
  const handle = createHandler({ fetchJson: async (u) => { calls.push(u); return { subtitles: [{ id: '1', lang: 'pob' }] }; } });
  await handle({ type: 'movie', id: 'tt1', extra: { filename: 'A.mkv', videoHash: 'h1' } });
  await handle({ type: 'movie', id: 'tt1', extra: { filename: 'A.mkv', videoHash: 'h2' } });
  assert.equal(calls.length, 2, 'different hash, different cache entry');
  const long = `${'x'.repeat(5000)}.mkv`;
  const r = await handle({ type: 'movie', id: 'tt1', extra: { filename: long } });
  assert.deepEqual(r.subtitles, []);
  assert.equal(calls.length, 2, 'oversized filename never reaches the upstream');
});

// ---------- languages ----------
test('classifyAudio per language: which file names carry the language\'s own audio', () => {
  const dub = {
    'es-419': ['Movie.2020.1080p.Latino.mkv', 'Movie.2020.LATAM.WEB-DL.mkv'],
    'es-ES': ['Movie.2020.1080p.Castellano.mkv', 'Movie.2020.SPANISH.1080p.mkv'],
    fr: ['Movie.2020.MULTi.VFF.1080p.mkv', 'Movie.2020.TRUEFRENCH.1080p.mkv', 'Movie.2020.FRENCH.1080p.mkv', 'Movie.2020.MULTi.1080p.mkv', 'Movie.2020.VF2.mkv', 'Movie.2020.VFQ.mkv'],
    it: ['Movie.2020.ITA.ENG.1080p.mkv', 'Movie.2020.iTALiAN.mkv'],
    de: ['Movie.2020.German.DL.1080p.mkv', 'Movie.2020.GERMAN.1080p.mkv'],
    en: ['Movie.2020.ENGLISH.1080p.mkv', 'Movie.2020.ENG.1080p.mkv'],
  };
  const original = {
    'es-419': ['Movie.2020.1080p.mkv', 'Movie.2020.Castellano.mkv'],
    fr: ['Movie.2020.VOSTFR.1080p.mkv', 'Movie.2020.1080p.BluRay.x264-GRP.mkv'],
    it: ['Movie.2020.1080p.mkv', 'Italia.2020.1080p.mkv'],
    de: ['Movie.2020.WEB-DL.1080p.mkv', 'Movie.2020.1080p.mkv'],
    // English: untagged files are not assumed English (a Japanese original usually has no tag either); a foreign word next to ENG wins.
    en: ['Movie.2020.1080p.mkv', 'Movie.2020.FRENCH.ENG.1080p.mkv', 'Show.S01E01.JAP.ENG.1080p.mkv', 'Engine.2020.1080p.mkv'],
    ja: ['Movie.2020.JAPANESE.1080p.mkv'],
  };
  for (const [id, names] of Object.entries(dub)) for (const name of names) assert.equal(classifyAudio(name, id), 'dub', `${id}: ${name}`);
  for (const [id, names] of Object.entries(original)) for (const name of names) assert.equal(classifyAudio(name, id), 'original', `${id}: ${name}`);
  assert.equal(classifyAudio('Movie.Dublado.mkv', 'fr'), 'original', 'another language\'s dub words do not count');
  assert.equal(classifyAudio('Movie.Dublado.mkv', 'ja'), 'original', 'basic languages have no file-name detection');
  assert.throws(() => classifyAudio('x.mkv', 'xx'), TypeError);
});

test('pickSubtitles uses the language\'s codes in order, first code with results', () => {
  const list = [sub('1', 'spa'), sub('2', 'fre', { m: 'h' }), sub('3', 'fra'), sub('4', 'eng'), sub('5', 'nld')];
  assert.deepEqual(pickSubtitles(list, 'x.mkv', getLanguage('es-419').subs.codes).map((s) => s.id), ['1']);
  assert.deepEqual(pickSubtitles(list, 'x.mkv', getLanguage('fr').subs.codes).map((s) => s.id), ['2'], 'fre before fra');
  assert.deepEqual(pickSubtitles(list, 'x.mkv', getLanguage('nl').subs.codes).map((s) => s.id), ['5']);
  assert.deepEqual(pickSubtitles(list, 'x.mkv', ['jpn']), []);
  assert.deepEqual(pickSubtitles(null, 'x.mkv', ['eng']), []);
});

test('manifests: pt-BR keeps the installed id and name; every other language has its own id and name', () => {
  assert.deepEqual(manifestFor('pt-BR'), MANIFEST);
  assert.equal(MANIFEST.id, 'filmhub.subs');
  assert.equal(MANIFEST.name, 'Dublix Subs');
  const seen = new Set([MANIFEST.id]);
  const names = new Set([MANIFEST.name]);
  for (const { id } of languageList().filter((l) => l.id !== 'pt-BR')) {
    const m = manifestFor(id);
    assert.equal(m.id, `filmhub.subs.${id}`);
    assert.match(m.name, /^Dublix Subs /);
    assert.deepEqual(m.resources, ['subtitles']);
    assert.ok(!seen.has(m.id) && !names.has(m.name), id);
    seen.add(m.id); names.add(m.name);
  }
  assert.match(manifestFor('en').description, /^English subtitles only when the chosen audio is not English/);
  assert.match(manifestFor('ja').description, /every file/);
  assert.throws(() => manifestFor('xx'), TypeError);
});

test('route: /manifest.json is pt-BR; /<lang>/manifest.json and /<lang>/subtitles/... are that language; unknown languages are 404', async () => {
  const handle = createHandler({ fetchJson: async () => ({ subtitles: [sub('s', 'spa'), sub('p', 'pob'), sub('e', 'eng')] }), now: () => 0 });
  assert.equal((await route('/manifest.json', handle))[1].id, 'filmhub.subs');
  assert.equal((await route('/pt-BR/manifest.json', handle))[1].id, 'filmhub.subs');
  assert.equal((await route('/es-419/manifest.json', handle))[1].id, 'filmhub.subs.es-419');
  const extra = encodeURIComponent('filename=Show.S02E07.2160p-FLUX.mkv');
  assert.deepEqual((await route(`/subtitles/series/tt11280740%3A2%3A7/${extra}.json`, handle))[1].subtitles.map((s) => s.id), ['p']);
  assert.deepEqual((await route(`/es-419/subtitles/series/tt11280740%3A2%3A7/${extra}.json`, handle))[1].subtitles.map((s) => s.id), ['s']);
  assert.deepEqual((await route(`/en/subtitles/movie/tt1.json`, handle))[1].subtitles.map((s) => s.id), ['e']);
  const dubbed = encodeURIComponent('filename=Movie.Latino.mkv');
  assert.deepEqual((await route(`/es-419/subtitles/movie/tt1/${dubbed}.json`, handle))[1].subtitles, [], 'a Latino file gets no Spanish subtitles');
  assert.deepEqual((await route(`/subtitles/movie/tt1/${dubbed}.json`, handle))[1].subtitles.map((s) => s.id), ['p'], 'but it is original audio for pt-BR');
  for (const bad of ['/xx/manifest.json', '/es-419', '/es-419/', '/../manifest.json', '/ES-419/manifest.json', '/es-419/es-419/manifest.json', '/subtitles/manifest.json']) {
    assert.equal((await route(bad, handle))[0], 404, bad);
  }
});

test('the cache never mixes languages', async () => {
  const calls = [];
  const handle = createHandler({ fetchJson: async (u) => { calls.push(u); return { subtitles: [sub('s', 'spa'), sub('p', 'pob')] }; }, now: () => 0 });
  const args = { type: 'movie', id: 'tt1', extra: { filename: 'a.mkv' } };
  assert.deepEqual((await handle({ ...args, language: 'es-419' })).subtitles.map((s) => s.id), ['s']);
  assert.deepEqual((await handle({ ...args })).subtitles.map((s) => s.id), ['p']);
  assert.deepEqual((await handle({ ...args, language: 'es-419' })).subtitles.map((s) => s.id), ['s']);
  assert.deepEqual((await handle({ ...args, language: 'nope' })).subtitles, []);
});
