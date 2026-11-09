import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePortugueseEpisodes } from '../portuguese-episodes.mjs';

test('normalizes explicit Portuguese season and episode tokens, preserving episode identity', () => {
  for (const episode of [1, 2, 9, 12]) {
    assert.equal(normalizePortugueseEpisodes(`Apenas um Show - Temp 01 - Epi ${String(episode).padStart(2, '0')}.mkv`),
      `Apenas um Show - S01E${String(episode).padStart(2, '0')}.mkv`);
  }
  assert.equal(normalizePortugueseEpisodes('Série/Temporada 6/Episódio 9.mp4'), 'Série/S06E09.mp4');
  assert.equal(normalizePortugueseEpisodes('Série/Temp 01/Série - Temp 01 - Epi 09.mkv'), 'Série/S01/Série - S01E09.mkv');
});

test('does not invent a season or alter ordinary titles, years, or existing episode notation', () => {
  for (const name of ['Movie.Temp.2020.mkv', 'Regular.Show.S06E09.mkv', 'The.Temperature.2010.mkv', 'Episode.Name.mkv']) {
    assert.equal(normalizePortugueseEpisodes(name), name);
  }
  assert.equal(normalizePortugueseEpisodes('Série - Epi 09.mkv'), 'Série - E09.mkv');
});

test('normalization is idempotent and accepts only strings', () => {
  const name = 'Série - Temporada 2 - Episódio 1.mp4';
  assert.equal(normalizePortugueseEpisodes(normalizePortugueseEpisodes(name)), normalizePortugueseEpisodes(name));
  assert.throws(() => normalizePortugueseEpisodes(null), TypeError);
});

test('recognizes the season number written before the word (so strict matching rejects other seasons)', () => {
  assert.equal(normalizePortugueseEpisodes('Apenas um Show - 2 temp - Dublado pt-br'), 'Apenas um Show - S02 - Dublado pt-br');
  assert.equal(normalizePortugueseEpisodes('Apenas um Show - 1a Temporada - Dublado Portugues BR - HD'), 'Apenas um Show - S01 - Dublado Portugues BR - HD');
  assert.equal(normalizePortugueseEpisodes('Série 3ª Temporada Completa'), 'Série S03 Completa');
  assert.equal(normalizePortugueseEpisodes('Apenas Um Show 2 Temporada TrueHD 720p Dublado'), 'Apenas Um Show S02 TrueHD 720p Dublado');
  for (const name of ['Filme 2 Temperaturas.mkv', 'Movie.2010.Temp.mkv']) assert.equal(normalizePortugueseEpisodes(name), name);
});

test('recognizes SS.EE and leading SS-EE episode files used by dubbed Regular Show packs', () => {
  assert.equal(normalizePortugueseEpisodes('Regular.Show.03.12-by-Rogerio_ruts.avi'), 'Regular.Show.S03E12-by-Rogerio_ruts.avi');
  assert.equal(normalizePortugueseEpisodes('04-20 Nome do Episódio - HD 720p.mkv'), 'S04E20 Nome do Episódio - HD 720p.mkv');
  assert.equal(normalizePortugueseEpisodes('Pack 4 Temporada/05-30 Encontro - HD.mkv'), 'Pack S04/S05E30 Encontro - HD.mkv');
  for (const name of ['Movie.2019.03.15.1080p.mkv', 'Movie.2012.DD.5.1.mkv', 'Film.1080p.DTS-HD.MA.7.1.mkv', 'Show.03.12.2019.mkv',
    'Movie.Title.2010.mkv', 'Some Movie 10-15 Things.mkv', 'Regular.Show.S03E12.mkv']) {
    assert.equal(normalizePortugueseEpisodes(name), name, name);
  }
});

test('nomes reais da 1ª temporada da biblioteca (Temp NN - Epi NN - título) viram SxxEyy distintos, sem repetir E01', () => {
  const real = ['A Força', 'Apenas Arrumem as Cadeiras', 'Ingressos para um Show Cafeinado', 'Socos Mortais', 'Bolo de Graça', 'O Churrasco',
    'Queijo Quente de Luxo', 'Vão Embora Unicórnios', 'Passando um Trote', 'Don', 'O Corpo de Rigby', 'Mordecai e os Rigbys'];
  const out = real.map((title, i) => normalizePortugueseEpisodes(`Temp 01 - Epi ${String(i + 1).padStart(2, '0')} - ${title}.mkv`));
  assert.deepEqual(out.map(n => n.slice(0, 6)), real.map((_, i) => `S01E${String(i + 1).padStart(2, '0')}`));
  assert.equal(new Set(out.map(n => n.slice(0, 6))).size, 12);
  assert.equal(out[9], 'S01E10 - Don.mkv');
});
