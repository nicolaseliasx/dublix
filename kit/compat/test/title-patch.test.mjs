import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { patchTitleParser } from '../patch-title.mjs';
const source = "export function parseTorrentTitleCached(title) {\n    const name = stripRepostSuffixes(title);\n    return parseTorrentTitle(name);\n}\n";
const hash = value => createHash('sha256').update(value).digest('hex');

test('patches only the pinned parser seam and leaves parsing/selection logic intact', () => {
  const result = patchTitleParser(source, hash(source));
  assert.match(result, /import.*normalizePortugueseEpisodes/);
  assert.match(result, /stripRepostSuffixes\(normalizePortugueseEpisodes\(title\)\)/);
  assert.match(result, /return parseTorrentTitle\(name\)/);
});

test('refuses changed upstream artifacts and repeated or missing seams', () => {
  assert.throws(() => patchTitleParser(source, '0'.repeat(64)), /hash/);
  for (const text of [source + source, 'unrelated source']) {
    assert.throws(() => patchTitleParser(text, hash(text)), /seam/);
  }
});
