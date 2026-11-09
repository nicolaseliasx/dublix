import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeCollection, isFilmhubStreams, isFilmhubSubs, OPENSUBTITLES_ID } from './collection.mjs';

const d = (id, name, transportUrl, extra = {}) => ({ transportUrl, manifest: { id, name, version: '1.0.0', resources: ['stream'], types: ['movie'] }, flags: {}, ...extra });
const cinemeta = d('com.linvo.cinemeta', 'Cinemeta', 'https://v3-cinemeta.strem.io/manifest.json', { flags: { official: true, protected: true } });
const localFiles = d('org.stremio.local', 'Local Files', 'http://127.0.0.1:11470/local-addon/manifest.json', { flags: { official: true } });
const opensubs = d(OPENSUBTITLES_ID, 'OpenSubtitles v3', 'https://opensubtitles-v3.strem.io/manifest.json');
const torrentio = d('com.stremio.torrentio.addon', 'Torrentio', 'https://torrentio.strem.fun/manifest.json');
const oldFilmhub = d('com.aiostreams.viren070', 'Filmhub', 'https://aio.example/stremio/old-uuid/old-pw/manifest.json');
const newFilmhub = d('com.aiostreams.viren070', 'Filmhub', 'https://aio.example/stremio/new-uuid/new-pw/manifest.json');
const subs = d('filmhub.subs', 'Filmhub Subs', 'https://filmhub.example/subs/manifest.json');

test('identifies Filmhub streams by name and AIOStreams path, and the subs addon by id', () => {
  assert.equal(isFilmhubStreams(oldFilmhub), true);
  assert.equal(isFilmhubStreams(d('com.aiostreams.viren070', 'AIOStreams', 'https://aio.example/stremio/u/p/manifest.json')), false);
  assert.equal(isFilmhubStreams(torrentio), false);
  assert.equal(isFilmhubSubs(subs), true);
});

test('fresh install puts Filmhub right after Cinemeta and keeps every other addon untouched and in order', () => {
  const { addons, changes } = mergeCollection([cinemeta, torrentio, opensubs, localFiles], { streams: newFilmhub });
  assert.deepEqual(addons.map((a) => a.manifest.name), ['Cinemeta', 'Filmhub', 'Torrentio', 'OpenSubtitles v3', 'Local Files']);
  assert.equal(addons[2], torrentio);
  assert.deepEqual(changes, [{ action: 'add', name: 'Filmhub' }]);
});

test('reinstall replaces the old Filmhub in place instead of duplicating it', () => {
  const { addons, changes } = mergeCollection([cinemeta, torrentio, oldFilmhub, localFiles], { streams: newFilmhub });
  assert.deepEqual(addons.map((a) => a.transportUrl), [cinemeta.transportUrl, torrentio.transportUrl, newFilmhub.transportUrl, localFiles.transportUrl]);
  assert.deepEqual(changes, [{ action: 'replace', name: 'Filmhub' }]);
});

test('smart subtitles replace OpenSubtitles v3 in place (both together would subtitle dubbed files)', () => {
  const { addons, changes } = mergeCollection([cinemeta, opensubs, torrentio], { streams: newFilmhub, subs, replaceOpenSubtitles: true });
  assert.deepEqual(addons.map((a) => a.manifest.name), ['Cinemeta', 'Filmhub', 'Filmhub Subs', 'Torrentio']);
  assert.deepEqual(changes, [{ action: 'add', name: 'Filmhub' }, { action: 'replace', name: 'OpenSubtitles v3', with: 'Filmhub Subs' }]);
});

test('subtitles without OpenSubtitles installed are appended; keeping OpenSubtitles leaves it in place', () => {
  assert.deepEqual(mergeCollection([cinemeta], { streams: newFilmhub, subs }).addons.map((a) => a.manifest.name), ['Cinemeta', 'Filmhub', 'Filmhub Subs']);
  const kept = mergeCollection([cinemeta, opensubs], { streams: newFilmhub, subs, replaceOpenSubtitles: false }).addons;
  assert.deepEqual(kept.map((a) => a.manifest.name), ['Cinemeta', 'Filmhub', 'OpenSubtitles v3', 'Filmhub Subs']);
});

test('choosing no subtitles removes a previous Filmhub Subs and nothing else', () => {
  const { addons, changes } = mergeCollection([cinemeta, oldFilmhub, subs, torrentio], { streams: newFilmhub, subs: null });
  assert.deepEqual(addons.map((a) => a.manifest.name), ['Cinemeta', 'Filmhub', 'Torrentio']);
  assert.deepEqual(changes, [{ action: 'replace', name: 'Filmhub' }, { action: 'remove', name: 'Filmhub Subs' }]);
});

test('every dropped duplicate is reported in changes (the review must show all removals)', () => {
  const { changes } = mergeCollection([cinemeta, oldFilmhub, oldFilmhub, opensubs, opensubs, subs, subs], { streams: newFilmhub, subs, replaceOpenSubtitles: true });
  assert.deepEqual(changes, [
    { action: 'replace', name: 'Filmhub' }, { action: 'remove', name: 'Filmhub' },
    { action: 'replace', name: 'OpenSubtitles v3', with: 'Filmhub Subs' }, { action: 'remove', name: 'OpenSubtitles v3' },
    { action: 'remove', name: 'Filmhub Subs' }, { action: 'remove', name: 'Filmhub Subs' },
  ]);
});

test('duplicated Filmhub entries collapse to one; Cinemeta missing means Filmhub goes first', () => {
  const { addons } = mergeCollection([oldFilmhub, torrentio, oldFilmhub], { streams: newFilmhub });
  assert.deepEqual(addons.map((a) => a.transportUrl), [newFilmhub.transportUrl, torrentio.transportUrl]);
  assert.deepEqual(mergeCollection([torrentio], { streams: newFilmhub }).addons[0], newFilmhub);
});

test('does not mutate the input and refuses a malformed descriptor', () => {
  const input = [cinemeta, torrentio];
  const snapshot = JSON.stringify(input);
  mergeCollection(input, { streams: newFilmhub, subs });
  assert.equal(JSON.stringify(input), snapshot);
  assert.throws(() => mergeCollection(input, { streams: { transportUrl: 'x' } }), TypeError);
  assert.throws(() => mergeCollection('nope', { streams: newFilmhub }), TypeError);
});

test('every Filmhub Subs variant (one per language) is recognised, nothing that merely looks similar', () => {
  const es = d('filmhub.subs.es-419', 'Filmhub Subs Spanish (Latin America)', 'https://filmhub.example/subs/es-419/manifest.json');
  assert.equal(isFilmhubSubs(es), true);
  for (const id of ['filmhub.subs-es', 'filmhub.subsx', 'filmhub.substitle', 'x.filmhub.subs', 'filmhub.subs.']) {
    assert.equal(isFilmhubSubs(d(id, 'Other', 'https://x.example/manifest.json')), false, id);
  }
});

test('choosing another language replaces the installed Filmhub Subs in place and reports it', () => {
  const es = d('filmhub.subs.es-419', 'Filmhub Subs Spanish (Latin America)', 'https://filmhub.example/subs/es-419/manifest.json');
  const fr = d('filmhub.subs.fr', 'Filmhub Subs French', 'https://filmhub.example/subs/fr/manifest.json');
  const { addons, changes } = mergeCollection([cinemeta, oldFilmhub, subs, torrentio], { streams: newFilmhub, subs: es });
  assert.deepEqual(addons.map((a) => a.manifest.name), ['Cinemeta', 'Filmhub', 'Filmhub Subs Spanish (Latin America)', 'Torrentio']);
  assert.deepEqual(changes, [{ action: 'replace', name: 'Filmhub' }, { action: 'replace', name: 'Filmhub Subs', with: 'Filmhub Subs Spanish (Latin America)' }]);
  // Variants of two languages in one account collapse to the chosen one; switching back to pt-BR works the same way.
  const twice = mergeCollection([cinemeta, es, fr, opensubs], { streams: newFilmhub, subs });
  assert.deepEqual(twice.addons.map((a) => a.manifest.id), ['com.linvo.cinemeta', 'com.aiostreams.viren070', 'filmhub.subs']);
  assert.deepEqual(twice.changes.map((c) => c.action), ['add', 'replace', 'remove', 'remove']);
  // No subtitles chosen: every variant goes.
  assert.deepEqual(mergeCollection([cinemeta, fr], { streams: newFilmhub, subs: null }).addons.map((a) => a.manifest.id), ['com.linvo.cinemeta', 'com.aiostreams.viren070']);
});
