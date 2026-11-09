import test from 'node:test';
import assert from 'node:assert/strict';
import { repairedStreamTitle } from '../stream-title.mjs';

const folderTitle = name => name.split(' - ')[0];
const stream = (title, folderName) => ({ parsedFile: { title }, folderName, filename: 'x.mkv' });

test('usa o título do torrent quando o nome do arquivo só tem marcador de episódio (caso Cosmos/Comando)', () => {
  const folder = 'Cosmos A Spacetime Odyssey - 1ª Temporada (2014) BDRip 720p Dublado - WWW.WOLVERDONFILMES.COM';
  for (const bad of ['1x01 - -By JefePsb - WOLVERDONFILMES.COM', '01x05 Algum Nome', '1X01', 'E05 - Titulo', 'Ep 12', 'Episódio 3', 'Capítulo 7']) {
    assert.equal(repairedStreamTitle(stream(bad, folder), folderTitle), 'Cosmos A Spacetime Odyssey', bad);
  }
});

test('não altera títulos reais, nem sem pasta, nem sem título', () => {
  const folder = 'Outro Nome - 1ª Temporada';
  for (const real of ['Regular Show', '24', '1883', 'Elementary', 'The 100', 'Ex Machina', 'Eureka']) {
    assert.equal(repairedStreamTitle(stream(real, folder), folderTitle), real, real);
  }
  assert.equal(repairedStreamTitle(stream('1x01 - lixo', undefined), folderTitle), '1x01 - lixo');
  assert.equal(repairedStreamTitle(stream(undefined, folder), folderTitle), undefined);
  assert.equal(repairedStreamTitle({ folderName: folder }, folderTitle), undefined);
});

test('se o título da pasta não puder ser lido, mantém o original', () => {
  assert.equal(repairedStreamTitle(stream('1x01 lixo', 'pasta'), () => undefined), '1x01 lixo');
  assert.equal(repairedStreamTitle(stream('1x01 lixo', 'pasta'), () => ''), '1x01 lixo');
  assert.equal(repairedStreamTitle(stream('1x01 lixo', 'pasta'), () => { throw new Error('boom'); }), '1x01 lixo');
});
