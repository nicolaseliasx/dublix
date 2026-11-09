// Non-destructive merge of the Filmhub addons into a Stremio addon collection.
// Only Filmhub's own entries (and, on request, OpenSubtitles v3) are touched; everything else keeps its content and order.
export const OPENSUBTITLES_ID = 'org.stremio.opensubtitlesv3';
export const SUBS_ID = 'filmhub.subs';
const CINEMETA_ID = 'com.linvo.cinemeta';

const valid = (a) => a && typeof a.transportUrl === 'string' && a.manifest && typeof a.manifest.id === 'string';
export const isFilmhubStreams = (a) => valid(a) && a.manifest.name === 'Filmhub' && /\/stremio\/[^/]+\/[^/]+\/manifest\.json$/.test(a.transportUrl);
// Filmhub Subs has one addon per language: `filmhub.subs` (pt-BR) and `filmhub.subs.<language id>`.
const SUBS_VARIANT = /^filmhub\.subs(\.[A-Za-z0-9-]+)?$/;
export const isFilmhubSubs = (a) => valid(a) && SUBS_VARIANT.test(a.manifest.id);

/**
 * @param current addons from addonCollectionGet
 * @param o { streams: descriptor, subs?: descriptor|null, replaceOpenSubtitles?: boolean }
 * @returns { addons, changes } — changes is a human summary for the review step.
 */
export function mergeCollection(current, { streams, subs = null, replaceOpenSubtitles = true } = {}) {
  if (!Array.isArray(current)) throw new TypeError('collection must be an array');
  if (!valid(streams) || (subs !== null && !valid(subs))) throw new TypeError('addon descriptor needs transportUrl and manifest.id');
  const changes = [];
  const addons = [];
  let streamsPlaced = false;
  let subsPlaced = false;
  for (const addon of current) {
    // Every entry dropped here is reported, so the review shows all removals (duplicates included).
    if (isFilmhubStreams(addon)) {
      if (!streamsPlaced) { addons.push(streams); changes.push({ action: 'replace', name: 'Filmhub' }); streamsPlaced = true; }
      else changes.push({ action: 'remove', name: 'Filmhub' });
      continue;
    }
    if (isFilmhubSubs(addon)) {
      const name = addon.manifest.name ?? addon.manifest.id;
      if (subs && !subsPlaced) {
        addons.push(subs);
        changes.push({ action: 'replace', name, ...(subs.manifest.name !== name && { with: subs.manifest.name }) });
        subsPlaced = true;
      } else changes.push({ action: 'remove', name });
      continue;
    }
    if (subs && replaceOpenSubtitles && addon.manifest?.id === OPENSUBTITLES_ID) {
      if (!subsPlaced) { addons.push(subs); changes.push({ action: 'replace', name: addon.manifest.name, with: subs.manifest.name }); subsPlaced = true; }
      else changes.push({ action: 'remove', name: addon.manifest.name });
      continue;
    }
    addons.push(addon);
  }
  if (!streamsPlaced) {
    const cinemeta = addons.findIndex((a) => a.manifest?.id === CINEMETA_ID);
    addons.splice(cinemeta + 1, 0, streams);
    changes.unshift({ action: 'add', name: 'Filmhub' });
  }
  if (subs && !subsPlaced) {
    const after = addons.indexOf(streams);
    const lastSubs = addons.reduce((at, a, i) => (a.manifest?.id === OPENSUBTITLES_ID ? i : at), -1);
    addons.splice(Math.max(after, lastSubs) + 1, 0, subs);
    changes.push({ action: 'add', name: subs.manifest.name });
  }
  return { addons, changes };
}
