import test from 'node:test';
import assert from 'node:assert/strict';
import { applyNextPolicy, POLICY_LIMITS } from './policy.mjs';

const base = () => ({
  services: [{ id: 'realdebrid', credentials: { apiKey: 'x' } }],
  presets: [{ type: 'torrentio', instanceId: 't', enabled: true, options: { timeout: 5000 } }],
  excludedStreamExpressions: [], preferredStreamExpressions: [], requiredStreamExpressions: [],
  sortCriteria: {}, resultLimits: {},
  formatter: { id: 'custom', definitions: { custom: { name: 'n', description: 'd' } } },
});
const names = (cfg) => cfg.excludedStreamExpressions.map((e) => e.expression.match(/^\/\*([^*]*)\*\//)?.[1]);

test('defaults keep the pilot list: 4K/1080p/720p, 2 PT-BR + 1 original, Real-Debrid excluded', () => {
  const out = applyNextPolicy(base(), { anime: false });
  assert.equal(out.resultLimits.global, 9);
  assert.equal(out.resultLimits.resolution, 3);
  assert.ok(names(out).includes('Filmhub Next T4: sem Real-Debrid'));
  assert.ok(names(out).includes('Filmhub Next T4: faixa 2160p PT-BR'));
});

test('custom tiers and slots shape the list and the per-tier rules', () => {
  const out = applyNextPolicy(base(), { anime: false, tiers: ['1080p', '720p'], ptSlots: 1, originalSlots: 2 });
  assert.equal(out.resultLimits.global, 6);
  assert.equal(out.resultLimits.resolution, 3);
  const n = names(out);
  assert.ok(!n.some((x) => x?.includes('2160p')));
  assert.ok(n.includes('Filmhub Next T4: faixa 1080p PT-BR'));
  assert.ok(n.includes('Filmhub Next T4: faixa 720p original'));
  const ptRule = out.excludedStreamExpressions.find((e) => e.expression.includes('faixa 1080p PT-BR'));
  assert.match(ptRule.expression, /, 0, 1\), resolution\(/);
  const origRule = out.excludedStreamExpressions.find((e) => e.expression.includes('faixa 1080p original'));
  assert.match(origRule.expression, /, 0, 2\), resolution\(/);
});

test('a zero-slot group drops every stream of that group in the tier', () => {
  const out = applyNextPolicy(base(), { anime: false, ptSlots: 2, originalSlots: 0 });
  assert.equal(out.resultLimits.resolution, 2);
  const origRule = out.excludedStreamExpressions.find((e) => e.expression.includes('faixa 1080p original'));
  assert.match(origRule.expression, /, 0, 0\), resolution\(/);
});

test('excludeServices replaces the pilot Real-Debrid exclusion; [] excludes nothing', () => {
  assert.ok(!names(applyNextPolicy(base(), { anime: false, excludeServices: [] })).some((x) => x?.includes('sem ')));
  const out = applyNextPolicy(base(), { anime: false, excludeServices: ['alldebrid'] });
  const rule = out.excludedStreamExpressions.find((e) => e.expression.includes('serviços excluídos'));
  assert.match(rule.expression, /service\(streams, 'alldebrid'\)/);
});

test('cachedOnly:false keeps uncached results (no "só cacheados" rule)', () => {
  assert.ok(!names(applyNextPolicy(base(), { anime: false, cachedOnly: false })).includes('Filmhub Next T4: só cacheados'));
  assert.ok(names(applyNextPolicy(base(), { anime: false })).includes('Filmhub Next T4: só cacheados'));
});

test('invalid options are rejected before producing a config', () => {
  for (const bad of [{ tiers: [] }, { tiers: ['480p'] }, { tiers: ['1080p', '1080p'] }, { ptSlots: 4 }, { originalSlots: -1 },
    { ptSlots: 0, originalSlots: 0 }, { ptSlots: 1.5 }, { excludeServices: ['nope'] }]) {
    assert.throws(() => applyNextPolicy(base(), { anime: false, ...bad }), TypeError, JSON.stringify(bad));
  }
});

test('every option combination stays within the AIOStreams expression limits', () => {
  const all = ['2160p', '1080p', '720p'];
  for (let pt = 0; pt <= POLICY_LIMITS.maxSlots; pt += 1) for (let og = 0; og <= POLICY_LIMITS.maxSlots; og += 1) {
    if (pt + og === 0) continue;
    const out = applyNextPolicy(base(), { anime: true, tiers: all, ptSlots: pt, originalSlots: og, excludeServices: ['realdebrid', 'alldebrid'] });
    const exprs = ['excludedStreamExpressions', 'preferredStreamExpressions', 'requiredStreamExpressions', 'rankedStreamExpressions']
      .flatMap((k) => out[k] ?? []).map((e) => e.expression);
    for (const e of exprs) assert.ok(e.length <= 3000, `${e.slice(0, 60)} = ${e.length}`);
    assert.ok(exprs.join('').length <= 50000);
  }
});
