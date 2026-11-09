// Builds a public Filmhub AIOStreams config: a sanitized base (no credentials, no owner-only rules)
// plus the viewer's debrid services and list options. Pure; runs in Node and in the browser.
import { applyNextPolicy, SERVICE_IDS } from './policy.mjs';
import { DEFAULT_LANGUAGE, getLanguage, preferredLanguages, preferredSubtitles, realAudio } from './languages.mjs';

/** Placeholder written by sanitizeBase wherever the owner's base used its debrid service. */
export const DEBRID = '$debrid';
const OWNER_SERVICES = ['torbox'];
// Debrid clouds the AIOStreams library builtin can list (Easynews is usenet search, no cloud library).
const LIBRARY_SERVICES = SERVICE_IDS.filter((id) => id !== 'easynews');
const OWNER_ONLY = 'Filmhub playback:';
const PILOT_ID = /^pilot-(.+)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const TOKEN = /(?<![A-Za-z0-9])(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}/;
// Field names that hold credentials, in any case and with any prefix (tmdbApiKey, addonPassword, authKey, proxy.credentials).
// Anchored at the end so list fields such as requiredKeywords are not mistaken for keys.
// A bare "key" is a sort/criteria field name (sortCriteria[].key), not a credential.
const SECRET_KEY = /(api_?key|auth_?key|password|passwd|token|secret|credentials?|username|auth)$/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
// Every URL in the public base must point at one of these public sources.
const PUBLIC_HOSTS = ['torrentio.strem.fun', 'raw.githubusercontent.com', 'git.tamtaro.de', 'uptime.ibbylabs.dev', 'github.com'];
const URL_IN_TEXT = /\bhttps?:\/\/[^\s"'<>)\]]+/gi;
const unknownHost = (text) => (text.match(URL_IN_TEXT) ?? []).some((u) => {
  try { return !PUBLIC_HOSTS.includes(new URL(u).hostname.toLowerCase()); } catch { return true; }
});
const EXPRESSION_LISTS = ['excludedStreamExpressions', 'preferredStreamExpressions', 'requiredStreamExpressions',
  'includedStreamExpressions', 'rankedStreamExpressions'];

/** Paths of values that look like credentials: non-empty secret fields, long mixed tokens, or UUIDs. */
export function findSecrets(value, path = '', key = '') {
  if (typeof value === 'string') {
    if (!value) return [];
    return SECRET_KEY.test(key) || TOKEN.test(value) || UUID.test(value) || EMAIL.test(value) || unknownHost(value) ? [path] : [];
  }
  if (Array.isArray(value)) return value.flatMap((v, i) => findSecrets(v, `${path}.${i}`, key));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => findSecrets(v, `${path}.${k}`, k));
  return [];
}

const swap = (list, ids) => (list ?? []).flatMap((s) => (s === DEBRID ? ids : [s]));
const withDebrid = (list) => (list?.some((s) => OWNER_SERVICES.includes(s)) ? [DEBRID, ...list.filter((s) => !OWNER_SERVICES.includes(s))] : list);

/** Turn the owner's live config into the public base. Throws if anything secret-looking survives. */
export function sanitizeBase(ownerConfig) {
  const cfg = structuredClone(ownerConfig);
  const removed = new Set(cfg.presets.filter((p) => p.type === 'custom').map((p) => p.instanceId));
  const rename = new Map();
  cfg.presets = cfg.presets.filter((p) => !removed.has(p.instanceId)).map((p) => {
    const m = p.instanceId?.match(PILOT_ID);
    if (m) rename.set(p.instanceId, `filmhub-${m[1]}`);
    const options = { ...p.options, name: p.options?.name?.replace(/ Pilot$/, '') };
    if (Array.isArray(options.services)) options.services = withDebrid(options.services);
    return { ...p, instanceId: rename.get(p.instanceId) ?? p.instanceId, options };
  });
  const ids = (list) => (list ?? []).filter((id) => !removed.has(id)).map((id) => rename.get(id) ?? id);
  if (cfg.titleMatching) cfg.titleMatching.addons = ids(cfg.titleMatching.addons);
  if (cfg.serviceWrap) cfg.serviceWrap = { ...cfg.serviceWrap, presets: ids(cfg.serviceWrap.presets), services: withDebrid(cfg.serviceWrap.services) };
  // Library catalogs are keyed by the owner's service; AIOStreams recreates them per viewer.
  cfg.catalogModifications = (cfg.catalogModifications ?? []).filter((c) => c.type !== 'library');
  for (const k of EXPRESSION_LISTS) if (cfg[k]) cfg[k] = cfg[k].filter((e) => !e.expression?.includes(OWNER_ONLY));
  const custom = cfg.formatter?.definitions?.custom;
  if (typeof custom?.description === 'string') {
    custom.description = custom.description.replace(/\{stream\.rseMatched::~Filmhub playback:[^[]*\["[\s\S]*?"\|\|""\]\}/g, '');
  }
  Object.assign(cfg, { services: [], tmdbApiKey: '', tvdbApiKey: '', addonName: 'Filmhub', trusted: false });
  delete cfg.uuid;
  const leaks = findSecrets(cfg);
  if (leaks.length) throw new Error(`base still carries secrets at ${leaks.join(', ')}`);
  return cfg;
}

// ---------- language ----------
// base-config.json is the pt-BR rendering of everything language-specific, so building pt-BR changes nothing in it
// (config.language.test.mjs proves the pt-BR profile data reproduces those parts). Any other language swaps them.
const BASE_TORRENTIO = ['filmhub-regular-show-ptbr', 'filmhub-ptbr', 'filmhub-ptbr-verified'];
const BASE_REGIONAL = 'Filmhub: reject European Portuguese releases';
const BASE_SUBTITLES = 'Filmhub: prefer embedded PT-BR subtitles for non-Portuguese audio';
const BASE_GROUPS = '/*PT-BR Group*/';
const TORRENTIO_URL = 'https://torrentio.strem.fun';
const quoted = (words) => words.map((w) => `'${w}'`).join(', ');

/** A Torrentio preset in the shape of the base profile: a list of providers, or Torrentio's `language=` priority. */
export const torrentioPreset = ({ id, name, providers = [], language, mediaTypes }) => ({
  type: 'torrentio', instanceId: id, enabled: true,
  options: {
    name, timeout: 8000, resources: ['stream'], providers, useMultipleInstances: false,
    url: language ? `${TORRENTIO_URL}/language=${language}/manifest.json` : TORRENTIO_URL, services: [], mediaTypes,
  },
  category: 'P2P',
});

/** Bodies of the two base rules that name a language: drop regional variants, prefer embedded subtitles on other audio. */
export function localizedRules(language) {
  const { keywords, unless } = language.exclude ?? {};
  const keyword = (list) => `keyword(streams, 'all', ${quoted(list)})`;
  return {
    excluded: language.exclude ? (unless.length ? `negate(${keyword(unless)}, ${keyword(keywords)})` : keyword(keywords)) : null,
    preferred: `subtitle(negate(language(streams, ${quoted(realAudio(language))}), streams), ${quoted(language.subtitles)})`,
  };
}

// Replace the entries matching `old` by `fresh`, at the position of the first one (appended when none matched).
function replaceIds(list, old, fresh) {
  const at = list.findIndex((id) => old.includes(id));
  const rest = list.filter((id) => !old.includes(id));
  rest.splice(at < 0 ? rest.length : at, 0, ...fresh);
  return rest;
}

/** Swap the pt-BR parts of the base (sources, language lists, regional rule, subtitle rule, PT-BR groups) for the language's. */
export function localizeBase(base, language) {
  if (language.id === DEFAULT_LANGUAGE) return base;
  const cfg = base;
  const fresh = language.torrentio.map(torrentioPreset);
  const at = cfg.presets.findIndex((p) => BASE_TORRENTIO.includes(p.instanceId));
  cfg.presets = cfg.presets.filter((p) => !BASE_TORRENTIO.includes(p.instanceId));
  cfg.presets.splice(at < 0 ? cfg.presets.length : at, 0, ...fresh);
  const freshIds = fresh.map((p) => p.instanceId);
  if (cfg.titleMatching) cfg.titleMatching.addons = replaceIds(cfg.titleMatching.addons ?? [], BASE_TORRENTIO, freshIds);
  if (cfg.serviceWrap) cfg.serviceWrap.presets = replaceIds(cfg.serviceWrap.presets ?? [], BASE_TORRENTIO, freshIds);
  cfg.preferredLanguages = preferredLanguages(language);
  cfg.preferredSubtitles = preferredSubtitles(language);
  const rules = localizedRules(language);
  const swap = (list, mark, expression) => (list ?? []).flatMap((e) => (!e.expression?.includes(mark) ? [e] : expression ? [{ ...e, expression }] : []));
  cfg.excludedStreamExpressions = swap(cfg.excludedStreamExpressions, BASE_REGIONAL, rules.excluded && `/*Filmhub: reject ${language.name} regional variants*/ ${rules.excluded}`);
  cfg.preferredStreamExpressions = swap(cfg.preferredStreamExpressions, BASE_SUBTITLES, `/*Filmhub: prefer embedded ${language.name} subtitles for other audio*/ ${rules.preferred}`);
  cfg.rankedStreamExpressions = swap(cfg.rankedStreamExpressions, BASE_GROUPS, null);
  return cfg;
}

function validServices(services) {
  if (!Array.isArray(services) || !services.length) throw new TypeError('choose at least one debrid service');
  const seen = new Set();
  return services.map(({ id, credentials = {} }) => {
    if (!SERVICE_IDS.includes(id) || seen.has(id)) throw new TypeError(`unknown or repeated service: ${id}`);
    seen.add(id);
    const need = id === 'easynews' ? ['username', 'password'] : ['apiKey'];
    const clean = Object.fromEntries(need.map((k) => [k, typeof credentials[k] === 'string' ? credentials[k].trim() : '']));
    if (need.some((k) => !clean[k])) throw new TypeError(`${id} needs ${need.join(' and ')}`);
    return { id, enabled: true, credentials: clean };
  });
}

/**
 * @param base sanitized base (sanitizeBase output, shipped as base-config.json)
 * @param o { services: [{id, credentials}], tiers?, ptSlots?, originalSlots?, cachedOnly?, anime?, tmdbApiKey?,
 *   language? (a languages.mjs id, default pt-BR), languageOnly? (only that language, no original-audio options) }
 */
export function buildFilmhubConfig(base, { services, tmdbApiKey = '', anime = false, language = DEFAULT_LANGUAGE, ...policy } = {}) {
  if (findSecrets(base).length) throw new Error('base config carries secrets; run sanitizeBase first');
  const chosen = validServices(services);
  const ids = chosen.map((s) => s.id);
  const profile = getLanguage(language);
  const cfg = localizeBase(structuredClone(base), profile);
  cfg.services = chosen;
  for (const p of cfg.presets) {
    if (!Array.isArray(p.options?.services)) continue;
    p.options.services = swap(p.options.services, ids);
    if (p.type === 'library') {
      p.options.services = p.options.services.filter((s) => LIBRARY_SERVICES.includes(s));
      if (!p.options.services.length) p.enabled = false;
    }
  }
  if (cfg.serviceWrap) cfg.serviceWrap.services = swap(cfg.serviceWrap.services, ids);
  cfg.tmdbApiKey = typeof tmdbApiKey === 'string' ? tmdbApiKey.trim() : '';
  // AIOStreams refuses title/year matching and the digital release filter without TMDB access,
  // and public instances ship without a TMDB key: switch them off instead of failing the install.
  if (!cfg.tmdbApiKey) {
    for (const k of ['titleMatching', 'yearMatching', 'digitalReleaseFilter']) if (cfg[k]) cfg[k] = { ...cfg[k], enabled: false };
    if (cfg.bitrate?.useMetadataRuntime) cfg.bitrate = { ...cfg.bitrate, useMetadataRuntime: false };
  }
  return applyNextPolicy(cfg, { anime, language, excludeServices: [], ...policy });
}
