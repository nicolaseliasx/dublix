import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { libraryTitleAliases, localizedTitleMetadata } from '../library-title-aliases.mjs';
import { patchLibraryMatching } from '../patch-library.mjs';

const metadata = () => ({ titles: ['Regular Show'], imdbId: 'tt1710308' });
const parsedId = () => ({ type: 'imdbId', value: 'tt1710308', mediaType: 'series', season: '5', episode: '1' });

test('adds only the known localized title for the verified IMDb, without changing shared metadata', () => {
  const meta = metadata(); const before = structuredClone(meta);
  assert.deepEqual(libraryTitleAliases(meta, parsedId()), ['Regular Show', 'Apenas um Show']);
  assert.deepEqual(meta, before);
  const mappedId = { type: 'tmdbId', value: 31132, mediaType: 'series' };
  assert.deepEqual(libraryTitleAliases(meta, mappedId), ['Regular Show', 'Apenas um Show']);
  const already = { ...meta, titles: ['Regular Show', 'Apenas um Show'] };
  assert.equal(libraryTitleAliases(already, parsedId()), already.titles);
});

test('unrelated, conflicting, missing IDs and movies never receive an alias', () => {
  for (const [meta, id] of [
    [{ titles: ['Regular Show'] }, { type: 'tmdbId', value: 1, mediaType: 'series' }],
    [{ ...metadata(), imdbId: 'tt0000001' }, parsedId()],
    [metadata(), { ...parsedId(), value: 'tt0000001' }],
    [metadata(), { ...parsedId(), mediaType: 'movie' }],
    [{ titles: ['Another Show'], imdbId: 'tt0000001' }, { ...parsedId(), value: 'tt0000001' }],
  ]) assert.equal(libraryTitleAliases(meta, id), meta.titles);
});

test('general matching receives typed title aliases without changing shared metadata or other identities', () => {
  const meta = { titles: [{ title: 'Regular Show', language: 'en' }], imdbId: 'tt1710308', year: 2010 };
  const before = structuredClone(meta);
  assert.deepEqual(localizedTitleMetadata(meta, parsedId()).titles, [...meta.titles, { title: 'Apenas um Show', language: 'pt' }, { title: 'U.S.M.' }]);
  assert.deepEqual(meta, before);
  const result = localizedTitleMetadata(meta, parsedId());
  assert.equal(localizedTitleMetadata(result, parsedId()), result);
  assert.equal(localizedTitleMetadata(meta, { ...parsedId(), value: 'tt0000001' }), meta);
  assert.equal(localizedTitleMetadata(meta, undefined), meta);
  assert.equal(localizedTitleMetadata(undefined, parsedId()), undefined);
});

const source = 'export function isItemMatch(itemName, metadata, parsedId, cleanedTitles = metadata.titles.map((title) => cleanTitle(title))) {\n    const parsed = parseTorrentTitleCached(itemName);\n    return strictSeasonEpisodeCheck(parsed, parsedId, cleanedTitles);\n}\n';
const hash = value => createHash('sha256').update(value).digest('hex');
test('patches only the verified library seam and recalculates cached titles without replacing strict matching', () => {
  const patched = patchLibraryMatching(source, hash(source));
  assert.match(patched, /import.*libraryTitleAliases/);
  assert.match(patched, /libraryTitleAliases\(metadata, parsedId\)/);
  assert.match(patched, /cleanedTitles = titles.map/);
  assert.match(patched, /return strictSeasonEpisodeCheck\(parsed, parsedId, cleanedTitles\)/);
});

test('refuses changed upstream artifacts and ambiguous or missing library seams', () => {
  assert.throws(() => patchLibraryMatching(source, '0'.repeat(64)), /hash/);
  for (const text of [source+source, 'unrelated source']) {
    assert.throws(() => patchLibraryMatching(text, hash(text)), /seam/);
  }
});
