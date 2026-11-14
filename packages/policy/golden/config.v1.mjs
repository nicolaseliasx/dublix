// FROZEN copy of the pre-language-profile module, kept only so golden.test.mjs can prove the pt-BR output never changes. Do not edit.
// Builds a public Dublix AIOStreams config: a sanitized base (no credentials, no owner-only rules)
// plus the viewer's debrid services and list options. Pure; runs in Node and in the browser.
import { applyNextPolicy, SERVICE_IDS } from './policy.v1.mjs';

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
  Object.assign(cfg, { services: [], tmdbApiKey: '', tvdbApiKey: '', addonName: 'Dublix', trusted: false });
  delete cfg.uuid;
  const leaks = findSecrets(cfg);
  if (leaks.length) throw new Error(`base still carries secrets at ${leaks.join(', ')}`);
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
 * @param o { services: [{id, credentials}], tiers?, ptSlots?, originalSlots?, cachedOnly?, anime?, tmdbApiKey? }
 */
export function buildFilmhubConfig(base, { services, tmdbApiKey = '', anime = false, ...policy } = {}) {
  if (findSecrets(base).length) throw new Error('base config carries secrets; run sanitizeBase first');
  const chosen = validServices(services);
  const ids = chosen.map((s) => s.id);
  const cfg = structuredClone(base);
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
  return applyNextPolicy(cfg, { anime, excludeServices: [], ...policy });
}
