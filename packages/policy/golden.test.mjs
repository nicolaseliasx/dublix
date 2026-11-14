// Golden test: with the default pt-BR language the output must stay byte-identical to the module as it was before language profiles
// existed (frozen in golden/). Compared as JSON text, so key order counts too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyNextPolicy } from './policy.mjs';
import { buildDublixConfig } from './config.mjs';
import { applyNextPolicy as frozenApply } from './golden/policy.v1.mjs';
import { buildFilmhubConfig as frozenBuild } from './golden/config.v1.mjs';

const base = JSON.parse(readFileSync(new URL('./base-config.json', import.meta.url), 'utf8'));
const torbox = [{ id: 'torbox', credentials: { apiKey: 'fake-key' } }];
const both = [{ id: 'realdebrid', credentials: { apiKey: 'fake-rd' } }, { id: 'easynews', credentials: { username: 'u', password: 'p' } }];
const OPTION_SETS = {
  defaults: { services: torbox },
  anime: { services: torbox, anime: true },
  'one tier, 1+2': { services: torbox, tiers: ['1080p'], ptSlots: 1, originalSlots: 2 },
  'no original slots': { services: torbox, originalSlots: 0 },
  'no language slots': { services: torbox, ptSlots: 0, originalSlots: 3 },
  'uncached allowed': { services: torbox, cachedOnly: false },
  'TMDB key': { services: torbox, tmdbApiKey: 'tmdb-fake', anime: true },
  'two services': { services: both, tiers: ['2160p', '720p'], ptSlots: 3, originalSlots: 1 },
};
// One deliberate change since the freeze: the formatter hides the internal audio marks from the matched-rule line (policy.test.mjs
// covers it). They are stripped here so every other byte is still compared with the frozen modules.
const HIDDEN = ['Dual', 'PT-BR', 'original'].map((x) => `'Filmhub Next T4: áudio ${x}',`).join('');
const text = (value) => JSON.stringify(value, null, 1).split(HIDDEN).join('');

for (const [name, options] of Object.entries(OPTION_SETS)) {
  test(`golden pt-BR: buildDublixConfig(${name}) is unchanged`, () => {
    assert.equal(text(buildDublixConfig(base, options)), text(frozenBuild(base, options)));
    assert.equal(text(buildDublixConfig(base, { ...options, language: 'pt-BR' })), text(frozenBuild(base, options)), 'explicit pt-BR equals the default');
  });
}

test('golden pt-BR: applyNextPolicy on the base profile is unchanged for movies and anime', () => {
  for (const anime of [false, true]) {
    for (const extra of [{}, { excludeServices: [] }, { tiers: ['720p'], ptSlots: 3, originalSlots: 0, cachedOnly: false }]) {
      assert.equal(text(applyNextPolicy(base, { anime, ...extra })), text(frozenApply(base, { anime, ...extra })));
    }
  }
});
