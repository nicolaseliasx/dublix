// Filmhub Subs: Stremio subtitles addon that follows the audio of the chosen stream, for any language of packages/policy/languages.mjs.
// Stremio sends the chosen file's name (behaviorHints.filename). A file with the language's own audio (dubbed, dual) gets no subtitles
// (so nothing is auto-selected); any other file gets only that language's subtitles, taken from OpenSubtitles v3. It replaces
// OpenSubtitles v3 in the Stremio account: while both are installed, dubbed files would still be offered subtitles.
// Routes: /manifest.json and /subtitles/... are Brazilian Portuguese (the addon already installed in accounts keeps working);
// /<language id>/manifest.json and /<language id>/subtitles/... serve any other language, each with its own addon id and name.
// Pure module: runs in Node (packages/subs/server.mjs) and in a Cloudflare Worker (functions/subs).
import { DEFAULT_LANGUAGE, getLanguage, hasLanguage } from '../policy/languages.mjs';

export const UPSTREAM = 'https://opensubtitles-v3.strem.io';
export const MANIFEST = {
  id: 'filmhub.subs', version: '1.0.0', name: 'Filmhub Subs',
  description: 'Brazilian Portuguese subtitles only when the chosen audio is not Portuguese; dubbed and dual-audio files get none.',
  resources: ['subtitles'], types: ['movie', 'series'], idPrefixes: ['tt'], catalogs: [],
};
/** The manifest of one language. pt-BR is MANIFEST (same id and name as before languages existed); the others get their own. */
export function manifestFor(languageId = DEFAULT_LANGUAGE) {
  const language = getLanguage(languageId);
  if (language.id === DEFAULT_LANGUAGE) return MANIFEST;
  const { name } = language.subs;
  return {
    ...MANIFEST, id: `${MANIFEST.id}.${language.id}`, name: `${MANIFEST.name} ${language.name}`,
    description: language.subs.dub
      ? `${name} subtitles only when the chosen audio is not ${name}; files with ${name} audio get none.`
      : `${name} subtitles from OpenSubtitles v3 on every file (this language has no audio detection from file names).`,
  };
}

// Mirrors what the stream list calls "my language" from the file name alone (packages/policy also uses probed tracks, which a
// subtitle request cannot see). The profile's subs.dub words always count. For pt-BR: "Dual" counts as a Brazilian dual only with
// no sign of other languages (Brazilian releases write a bare DUAL) or with an explicit PT token (DUAL.PT.ENG). "MULTi" alone is a
// French-style multi-language tag, and "Dual Audio" is the anime convention (Japanese + English), so both stay original.
// "Dual-DoVi" is two-layer Dolby Vision, not audio. "PT" alone is ambiguous (Portugal) and PT-PT is not a Brazilian dub.
// English has no dub words of its own: ENGLISH/ENG counts only when no other language is named next to it, and an untagged file
// is not assumed English (a Japanese original usually carries no tag either), so it is offered subtitles.
const token = words => new RegExp(`(^|[^a-z0-9])(${words})([^a-z0-9]|$)`, 'i');
const DUAL = token('dual');
const NOT_AUDIO_DUAL = /dual[ ._-]?(audio|dovi|dv|layer|vision)/i;
const OTHER_LANGUAGE = 'jap|jpn|japanese|eng|english|fre|french|vff|vf2|vfq|vfi|truefrench|ger|german|spa|spanish|ita|italian|rus|russian|hin|hindi|kor|korean';
const matchers = new Map();
function matchersFor(language) {
  if (!matchers.has(language.id)) {
    const { dub, dual, other = OTHER_LANGUAGE } = language.subs;
    matchers.set(language.id, { dub: dub && token(dub), dual: dual && token(dual.token), other: token(other) });
  }
  return matchers.get(language.id);
}
/** 'dub' when the file name shows the language's own audio, otherwise 'original'. */
export function classifyAudio(filename, languageId = DEFAULT_LANGUAGE) {
  const language = getLanguage(languageId);
  if (typeof filename !== 'string' || !filename || !language.subs.dub) return 'original';
  const { dub, dual, other } = matchersFor(language);
  if (dub.test(filename) && !(language.subs.alone && other.test(filename))) return 'dub';
  if (dual && DUAL.test(filename) && !NOT_AUDIO_DUAL.test(filename) && (dual.test(filename) || (language.subs.dual.bare && !other.test(filename)))) return 'dub';
  return 'original';
}

const MAX_SUBTITLES = 5;
const MAX_FILENAME = 300;
/** Subtitles in the first of `codes` (OpenSubtitles three-letter codes) that has any; the best matches to the file first. */
export function pickSubtitles(subtitles, filename = '', codes = []) {
  const list = Array.isArray(subtitles) ? subtitles : [];
  const pool = codes.map(code => list.filter(s => s?.lang === code)).find(found => found.length) ?? [];
  const name = String(filename).toLowerCase();
  const score = s => (s.m === 'h' ? 2 : 0) + (s.releaseGroup && name.includes(String(s.releaseGroup).toLowerCase()) ? 1 : 0);
  return pool.map((s, index) => ({ s, index })).sort((a, b) => score(b.s) - score(a.s) || a.index - b.index).slice(0, MAX_SUBTITLES).map(x => x.s);
}

const ID = /^tt\d{1,10}(:\d{1,4}:\d{1,4})?$/;
const TTL = 6 * 3600 * 1000;
const EMPTY = { subtitles: [] };

export function createHandler({ fetchJson, now = Date.now, base = UPSTREAM } = {}) {
  const cache = new Map();
  return async function handle({ type, id, extra = {}, language = DEFAULT_LANGUAGE }) {
    if (!['movie', 'series'].includes(type) || !ID.test(String(id)) || !hasLanguage(language)) return EMPTY;
    // Real file names stay well under this; longer ones only inflate the cache and the upstream quota.
    if (String(extra.filename ?? '').length > MAX_FILENAME) return EMPTY;
    if (classifyAudio(extra.filename, language) === 'dub') return { subtitles: [], cacheMaxAge: 3600 };
    const key = [language, type, id, extra.filename ?? '', String(extra.videoHash ?? '').slice(0, 64), String(extra.videoSize ?? '').slice(0, 20)].join('|');
    const hit = cache.get(key);
    if (hit && now() - hit.at < TTL) return hit.value;
    const hints = new URLSearchParams(Object.entries(extra).filter(([k, v]) => ['videoHash', 'videoSize', 'filename'].includes(k) && v));
    const query = hints.toString();
    try {
      const body = await fetchJson(`${base}/subtitles/${type}/${id}${query ? `/${query}` : ''}.json`);
      const value = { subtitles: pickSubtitles(body?.subtitles, extra.filename, getLanguage(language).subs.codes), cacheMaxAge: 6 * 3600 };
      cache.set(key, { at: now(), value });
      if (cache.size > 2000) cache.delete(cache.keys().next().value);
      return value;
    } catch {
      return { subtitles: [], cacheMaxAge: 60 };
    }
  };
}


/** Route a Stremio subtitles request path (without the /subs prefix). Returns [status, body]. */
export async function route(path, handle) {
  let language = DEFAULT_LANGUAGE;
  const prefixed = /^\/([^/]+)(\/.*)$/.exec(path);
  if (prefixed && hasLanguage(prefixed[1])) { language = prefixed[1]; path = prefixed[2]; }
  if (path === '/manifest.json') return [200, manifestFor(language)];
  const match = /^\/subtitles\/([a-z]+)\/([^/]+?)(?:\/([^/]*))?\.json$/.exec(path);
  if (!match) return [404, { error: 'not found' }];
  const [, type, rawId, rawExtra = ''] = match;
  try {
    const extra = Object.fromEntries(new URLSearchParams(decodeURIComponent(rawExtra)));
    return [200, await handle({ type, id: decodeURIComponent(rawId), extra, language })];
  } catch {
    return [200, EMPTY];
  }
}

export const httpJson = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`upstream ${response.status}`);
  return response.json();
};
