// FROZEN copy of the pre-language-profile module, kept only so golden.test.mjs can prove the pt-BR output never changes. Do not edit.
// Dublix T4 policy for an already resolved AIOStreams/Tamtaro configuration.
// Pure transformation: no profile access, network calls, downloads, or credential writes.
// SEL reference: https://github.com/Viren070/AIOStreams/blob/main/packages/docs/content/docs/reference/stream-expressions.mdx
// Schema: https://github.com/Viren070/AIOStreams/blob/main/packages/core/src/db/schemas.ts
export const SLOW_PLAYBACK_MARK = 'Filmhub playback: slow reported';
const MARK = 'Filmhub Next T4';
const LEGACY = ['Filmhub: pin PT-BR and original audio', 'Filmhub: prefer verified Brazilian Portuguese', 'Filmhub: prefer original audio'];
// Probed tracks only exist for inspected files (pilot/audio-verifier.mjs or StremThru
// media info). The formatter cannot read audioTracks of unprobed streams (it
// renders an error), so a zero-score ranked expression carries the fact instead.
// Labels describe only the audio a file has: Dual (PT-BR + another track), PT-BR, or the original audio.
// Probed tracks only exist for inspected files (pilot/audio-verifier.mjs or StremThru media info); the formatter cannot read
// audioTracks of unprobed streams (it renders an error), so zero-score ranked expressions carry the fact instead.
const PT_LANGS = 'lang=Portuguese|Portuguese (Brazil)';
const DUAL_MARK = 'Filmhub Next T4: áudio Dual';
const PTBR_MARK = 'Filmhub Next T4: áudio PT-BR';
const ORIGINAL_MARK = 'Filmhub Next T4: áudio original';
// Superseded marks (pre 04/11/2026): removed on re-apply, never emitted.
const LEGACY_RANKED = ['Filmhub Next T4: PT verificado', 'Filmhub Next T4: PT disponível'];
const LEGACY_PREFIXES = [
  '{stream.rseMatched::~Filmhub Next T4: PT verificado["✓ PT verificado (trilha)\n"||""]}',
  '{stream.rseMatched::~Filmhub Next T4: PT disponível["⚠ PT disponível (trocar áudio)\n"||""]}',
  '{stream.seMatched::~Filmhub Next T4: PT-BR provável["PT-BR provável (áudio não verificado)"||"Original provável / idioma não confirmado (áudio não verificado)"]}\n',
];
const LABEL_PREFIX = `{stream.rseMatched::~${DUAL_MARK}["Dual áudio\n"||""]}{stream.rseMatched::~${PTBR_MARK}["PT-BR\n"||""]}{stream.rseMatched::~${ORIGINAL_MARK}["Original\n"||""]}`;

// Plain 'Portuguese' is ambiguous; it counts as probable PT-BR only because the
// profile keeps a separate exclusion for European Portuguese (pt-pt) releases.
// A filename is only a hint. Once the file's tracks have been probed, a PT-BR
// filename must not overrule an audio list containing only Japanese/English.
const pt = "merge(language(streams, 'Portuguese (Brazil)'), language(streams, 'Portuguese'), keyword(negate(audioTrack(mediaInfoQuality(streams, 'probe'), 'lang', '!lang=Unknown'), streams), 'all', 'pt-br', 'ptbr', 'brazilian', 'brasileiro', 'brasileira', 'dublado', 'dublada', 'dublagem'))";
const original = "originalLanguage ? language(streams, originalLanguage) : []";
const byResolution = (value) => `merge(resolution(${value}, '2160p'), resolution(${value}, '1440p'), resolution(${value}, '1080p'), ${value})`;
// SEL negate(X, Y) = Y without X, so negate(negate(A, B), B) is the intersection of A and B.
const both = (a, b) => `negate(negate(${a}, ${b}), ${b})`;
const ptTrack = `audioTrack(streams, '${PT_LANGS}')`;
const dualExpr = `merge(${both(`audioTrack(streams, '!${PT_LANGS}')`, ptTrack)}, ${both("keyword(streams, 'all', 'dual', 'multi')", pt)})`;
const LABEL_RANKED = [
  [DUAL_MARK, dualExpr],
  [PTBR_MARK, `negate(${dualExpr}, ${pt})`],
  [ORIGINAL_MARK, `negate(${pt}, streams)`],
].map(([mark, body]) => ({ enabled: true, score: 0, expression: `/*${mark}*/ ${body}` }));
// Per-resolution caps alone still yielded 12–15 results through SD/unknown
// resolutions. Keep the ordinary list short; one reserved dub can be extra.
// Per resolution (4K, 1080p, 720p): 2 PT-BR (dual counts) + 1 original. Nothing below 720p.
const TIERS = ['2160p', '1080p', '720p'];
const PT_SLOTS = 2;
const ORIGINAL_SLOTS = 1;
export const SERVICE_IDS = ['realdebrid', 'alldebrid', 'premiumize', 'debridlink', 'offcloud', 'torbox', 'easynews'];
export const POLICY_LIMITS = { tiers: [...TIERS], maxSlots: 3 };

function resolveOptions({ tiers = TIERS, ptSlots = PT_SLOTS, originalSlots = ORIGINAL_SLOTS, excludeServices = ['realdebrid'], cachedOnly = true }) {
  const slot = (v) => Number.isInteger(v) && v >= 0 && v <= POLICY_LIMITS.maxSlots;
  if (!Array.isArray(tiers) || !tiers.length || new Set(tiers).size !== tiers.length || tiers.some((t) => !TIERS.includes(t))) {
    throw new TypeError(`tiers must be a non-empty subset of ${TIERS.join(', ')}`);
  }
  if (!slot(ptSlots) || !slot(originalSlots) || ptSlots + originalSlots === 0) {
    throw new TypeError(`ptSlots and originalSlots must be integers 0..${POLICY_LIMITS.maxSlots}, not both 0`);
  }
  if (!Array.isArray(excludeServices) || excludeServices.some((s) => !SERVICE_IDS.includes(s))) {
    throw new TypeError(`excludeServices must list ids from ${SERVICE_IDS.join(', ')}`);
  }
  if (typeof cachedOnly !== 'boolean') throw new TypeError('cachedOnly must be a boolean');
  // Keep the configured order of quality: 4K first.
  return { tiers: TIERS.filter((t) => tiers.includes(t)), ptSlots, originalSlots, excludeServices, cachedOnly };
}
const expression = (name, body) => ({ expression: `/*${MARK}: ${name}*/ ${body}`, enabled: true });
const COMPATIBILITY_MARK = 'Filmhub: enforce device compatibility';
const probed = "mediaInfoQuality(streams, 'probe')";
const compatibleAudio = `audioTrack(${probed}, 'codec=aac|ac3|eac3|mp3')`;
const compatiblePt = `audioTrack(${probed}, 'lang=Portuguese|Portuguese (Brazil)', 'codec=aac|ac3|eac3|mp3')`;
const playableAudio = `merge(${compatiblePt}, negate(language(${probed}, 'Portuguese', 'Portuguese (Brazil)'), ${compatibleAudio}))`;
const compatibility = `/*${COMPATIBILITY_MARK}*/ merge(encode(streams, 'AV1'), negate(${playableAudio}, audioTag(streams, 'TrueHD', 'DTS:X', 'DTS-ES', 'DTS-HD MA', 'DTS-HD', 'DTS')), visualTag(streams, 'DV Only'))`;

function withoutOwnedOrLegacy(rules) {
  return (rules ?? []).filter((entry) => {
    const source = entry?.expression ?? '';
    return !source.includes(MARK) && !LEGACY.some((label) => source.includes(label));
  });
}

function firstCriteria(criteria, wanted) {
  return [wanted, ...(criteria ?? []).filter((item) => item?.key !== wanted.key)];
}

/** Return a cloned AIOStreams config. `anime` selects the anime/drawing policy for this candidate. */
export function applyNextPolicy(config, { anime, ...options } = {}) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new TypeError('config must be an object');
  if (typeof anime !== 'boolean') throw new TypeError('anime must be a boolean');
  const { tiers: TIERS, ptSlots: PT_SLOTS, originalSlots: ORIGINAL_SLOTS, excludeServices, cachedOnly } = resolveOptions(options);
  const PER_RESOLUTION = PT_SLOTS + ORIGINAL_SLOTS;
  const LIMIT = TIERS.length * PER_RESOLUTION;
  const next = structuredClone(config);
  const playbackPins = (next.excludedStreamExpressions ?? []).filter(x => x.expression?.includes(SLOW_PLAYBACK_MARK));

  next.excludedStreamExpressions = withoutOwnedOrLegacy(next.excludedStreamExpressions).map(entry =>
    entry?.expression?.includes(COMPATIBILITY_MARK) ? { ...entry, expression: compatibility } : entry)
    .filter(x => !x.expression?.includes(SLOW_PLAYBACK_MARK));
  next.preferredStreamExpressions = withoutOwnedOrLegacy(next.preferredStreamExpressions);
  next.requiredStreamExpressions = withoutOwnedOrLegacy(next.requiredStreamExpressions);

  // Cartoons (metadata genre Animation) follow the anime contract even when AIOStreams does not flag them as anime (e.g. Regular Show).
  // The pilot serves regular titles and anime through one profile. A policy
  // installed with anime:false must still apply the anime language contract
  // when AIOStreams identifies an anime request (including IMDb-mapped ones).
  // The pilot plays through TorBox only; Real-Debrid links (e.g. from the
  // Brasil RD addon) cannot be resolved for this owner and only clutter the list.
  // Public profiles pass excludeServices: [] (or the services the viewer cannot play).
  if (excludeServices.length === 1 && excludeServices[0] === 'realdebrid') {
    next.excludedStreamExpressions.push(expression('sem Real-Debrid', "service(streams, 'realdebrid')"));
  } else if (excludeServices.length) {
    next.excludedStreamExpressions.push(expression('serviços excluídos', `service(streams, ${excludeServices.map((s) => `'${s}'`).join(', ')})`));
  }

  next.excludedStreamExpressions.push(expression('anime idioma por consulta',
    `isAnime or 'Animation' in genres ? (count(${pt}) > 0 ? negate(${pt}, streams) : (originalLanguage ? negate(language(streams, originalLanguage), streams) : [])) : []`));

  // Per resolution tier keep the best PT_SLOTS cached PT-BR (dual-audio files count) and ORIGINAL_SLOTS cached originals; drop the
  // rest. SEL runs after sorting, so slices follow the sorted order. Files demoted below (Hi10P, 1 TB packs, tiny episode clips)
  // are only taken when a tier has nothing better. Slots are not filled from other tiers. Streams below 720p go, unless nothing
  // reaches 720p. With cached results present, uncached ones go too, except one pending PT-BR download when no cached PT-BR exists
  // (it skips the limiter and sits last). AIOStreams rejects any expression over 3000 characters (the profile PUT fails), so every
  // rule stays small: one rule per tier and group. Rules run in order and each sees only the streams the earlier ones left.
  const bad = `merge(visualTag(encode(streams, 'AVC'), '10bit'), folderSize(streams, '1TB'), queryType == 'series' ? size(streams, '1B', '100MB') : [])`;
  const surplus = (set, tier, count) => {
    const good = `negate(${bad}, ${set})`;
    return `negate(slice(merge(resolution(${good}, '${tier}'), resolution(negate(${good}, ${set}), '${tier}')), 0, ${count}), resolution(${set}, '${tier}'))`;
  };
  const cachedPt = `cached(${pt})`;
  const cachedOriginal = `cached(negate(${pt}, streams))`;
  const pendingPt = `slice(uncached(${pt}), 0, 1)`;
  const noCachedPt = `count(${cachedPt}) == 0`;
  next.excludedStreamExpressions.push(expression('reserva PT-BR não cacheado',
    `${noCachedPt} ? pin(passthrough(${pendingPt}, 'limit'), 'bottom') : []`));
  if (cachedOnly) {
    next.excludedStreamExpressions.push(expression('só cacheados',
      `count(cached(streams)) > 0 ? negate(${noCachedPt} ? ${pendingPt} : [], uncached(streams)) : []`));
  }
  const reachable = `merge(${TIERS.map(t => `resolution(streams, '${t}')`).join(', ')})`;
  next.excludedStreamExpressions.push(expression('abaixo de 720p',
    `count(${reachable}) > 0 ? negate(${reachable}, streams) : []`));
  for (const tier of TIERS) {
    next.excludedStreamExpressions.push(expression(`faixa ${tier} PT-BR`, surplus(cachedPt, tier, PT_SLOTS)));
    next.excludedStreamExpressions.push(expression(`faixa ${tier} original`, surplus(cachedOriginal, tier, ORIGINAL_SLOTS)));
  }
  // The global sort is cached, resolution desc, size ASC. A 64 MB "extras" clip at the best resolution therefore beat the real
  // episode (Supernatural S4). Demote regular-series files under 100 MB to the bottom (the existing per-resolution cap may then
  // drop them, which is fine for a clip). '1B' keeps unknown sizes (0) out of it, and anime is left alone because small HEVC
  // anime encodes are legitimate.
  next.excludedStreamExpressions.push(expression('arquivos minúsculos',
    "queryType == 'series' ? pin(size(streams, '1B', '100MB'), 'bottom') : []"));
  // LG webOS does not decode H.264 10-bit (Hi10P); keep such files as a last resort instead of excluding them.
  next.excludedStreamExpressions.push(expression('Hi10P', "pin(visualTag(encode(streams, 'AVC'), '10bit'), 'bottom')"));
  // A library torrent that is a single huge archive (e.g. a 798 GB .zip listed as a 2.39 TB pack) is cached and ranks first but plays
  // "no matching file". No real season pack reaches 1 TB: keep such folders as a last resort instead of excluding them.
  next.excludedStreamExpressions.push(expression('pacote gigante', "pin(folderSize(streams, '1TB'), 'bottom')"));
  next.preferredStreamExpressions.unshift(
    expression('original provável', byResolution(original)));
  next.preferredStreamExpressions.unshift(
    expression('PT-BR provável', byResolution(pt)));
  // PT-BR (including dual audio) sorts ahead of the original inside each resolution.

  if (anime) {
    // When originalLanguage is absent, SEL cannot prove which result has the
    // original audio. Retain candidates and label the uncertainty in formatter.
    next.requiredStreamExpressions.push(expression('anime idioma',
      `count(${pt}) > 0 ? ${pt} : (originalLanguage ? language(streams, originalLanguage) : streams)`));
  }

  next.sortCriteria ??= {};
  const withoutMatched = (criteria) => (criteria ?? []).filter((item) => item?.key !== 'streamExpressionMatched');
  const compactWithinResolution = criteria => [
    { key: 'resolution', direction: 'desc' }, { key: 'streamExpressionMatched', direction: 'desc' },
    { key: 'quality', direction: 'desc' }, { key: 'size', direction: 'asc' },
    ...withoutMatched(criteria).filter(item => !['resolution', 'quality', 'size'].includes(item?.key)),
  ];
  next.sortCriteria.global = compactWithinResolution(next.sortCriteria.global);
  next.sortCriteria.global = firstCriteria(next.sortCriteria.global, { key: 'cached', direction: 'desc' });
  for (const group of ['cached', 'uncached']) {
    next.sortCriteria[group] = compactWithinResolution(next.sortCriteria[group]);
  }

  // The owner's TorBox library holds deliberately added Brazilian packs named by
  // their Portuguese title ("Apenas um Show"), which exact title matching against
  // the original title rejects. Season/episode matching still applies to them.
  // Brazilian season packs carry the year of the season ("Sobrenatural 2008" for S4), but the template compares it with the series
  // premiere (2005) and drops them. Per-season release years still reject remakes and years before the premiere.
  if (next.yearMatching) next.yearMatching = { ...next.yearMatching, useInitialAirDate: false };
  if (next.titleMatching?.enabled) {
    next.titleMatching.addons = (next.presets ?? [])
      .filter(p => p?.enabled !== false && p?.type !== 'library' && p?.instanceId)
      .map(p => p.instanceId);
  }
  next.resultLimits ??= {};
  next.resultLimits.global = LIMIT;
  // Many 4K releases would otherwise push every 1080p fallback past the limit.
  next.resultLimits.resolution = PER_RESOLUTION;
  for (const preset of next.presets ?? []) {
    if (Number.isFinite(preset?.options?.timeout) && preset.options.timeout > 8000) {
      preset.options.timeout = 8000;
    }
  }
  next.cacheAndPlay ??= {};
  next.cacheAndPlay.enabled = true;
  next.cacheAndPlay.streamTypes = [...new Set([...(next.cacheAndPlay.streamTypes ?? []), 'torrent'])];
  // Failover targets later releases; for a clicked uncached dub that meant a
  // cached (often English) release won the race. Its ~30 s deadline also aborts
  // cache-and-play, and AIOStreams 2.37 deletes the just-added torrent on abort
  // (stremthru removeDownloadOnAbort). Disabled so the chosen download stays.
  if (next.failover) Object.assign(next.failover, { enabled: false, onlySameReleaseFailover: true });
  next.precacheNextEpisode = false;
  if ('alwaysPrecache' in next) next.alwaysPrecache = false;
  delete next.precacheSelector;
  delete next.precacheCondition;

  if (anime) {
    if (next.formatter?.id !== 'custom' || typeof next.formatter.definitions?.custom?.description !== 'string') {
      throw new TypeError('anime policy requires an existing custom formatter description');
    }
  }
  const description = next.formatter?.definitions?.custom?.description;
  if (typeof description === 'string') {
    const originalDescription = [LABEL_PREFIX, ...LEGACY_PREFIXES].reduce((text, prefix) => text.replace(prefix, ''), description);
    next.formatter.definitions.custom.description = LABEL_PREFIX + originalDescription;
  }
  const ownedRanked = [DUAL_MARK, PTBR_MARK, ORIGINAL_MARK, ...LEGACY_RANKED];
  next.rankedStreamExpressions = [...(next.rankedStreamExpressions ?? []).filter(x => !ownedRanked.some(mark => x?.expression?.includes(mark))), ...LABEL_RANKED.map(x => ({ ...x }))];
  next.excludedStreamExpressions.push(...playbackPins);
  return next;
}
