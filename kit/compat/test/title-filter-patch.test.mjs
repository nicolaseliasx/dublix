import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { patchTitleFilter } from '../patch-title-filter.mjs';

const source = 'const requestedMetadata = await context.getMetadata();\nlet streamTitle = stream.parsedFile?.title;\nreturn performStrictTitleAndEpisodeMatch(requestedMetadata);\n';
const hash = value => createHash('sha256').update(value).digest('hex');
test('injects identity-bound title metadata without replacing strict matching', () => {
  const result = patchTitleFilter(source, hash(source));
  assert.match(result, /localizedTitleMetadata\(await context.getMetadata\(\), context.parsedId\)/);
  assert.match(result, /return performStrictTitleAndEpisodeMatch\(requestedMetadata\)/);
});
test('repara o título do stream pelo nome do torrent sem trocar o resto da correspondência', () => {
  const result = patchTitleFilter(source, hash(source));
  assert.match(result, /import \{ repairedStreamTitle \} from '\/app\/filmhub\/stream-title\.mjs';/);
  assert.match(result, /let streamTitle = repairedStreamTitle\(stream, /);
  assert.equal(result.includes('let streamTitle = stream.parsedFile?.title;'), false);
});
test('rejects changed upstream code and missing, duplicate or already-patched seams', () => {
  assert.throws(() => patchTitleFilter(source, '0'.repeat(64)), /hash/);
  const onlyFirst = 'const requestedMetadata = await context.getMetadata();\n', onlySecond = 'let streamTitle = stream.parsedFile?.title;\n';
  for (const invalid of [source+source, 'unrelated code', patchTitleFilter(source, hash(source)), onlyFirst, onlySecond]) {
    assert.throws(() => patchTitleFilter(invalid, hash(invalid)), /seam/);
  }
});
