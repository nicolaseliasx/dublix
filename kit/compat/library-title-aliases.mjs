// Operator-verified title aliases keyed by identity, never learned from a
// download name. Used by the library and general title matchers.
const ALIASES = { tt1710308: ['Apenas um Show'] };

function seriesIdentity(metadata, parsedId) {
  if (parsedId?.mediaType !== 'series') return undefined;
  const ids = [metadata.imdbId, parsedId.type === 'imdbId' ? parsedId.value : undefined].filter(Boolean);
  return ids.length && ids.every(value => value === ids[0]) ? ids[0] : undefined;
}

export function libraryTitleAliases(metadata, parsedId) {
  const titles = metadata.titles;
  const identity = seriesIdentity(metadata, parsedId);
  const aliases = Object.hasOwn(ALIASES, identity) ? ALIASES[identity] : undefined;
  if (!aliases) return titles;
  const existing = new Set(titles.map(t => t.trim().toLowerCase()));
  const extra = aliases.filter(t => !existing.has(t.toLowerCase()));
  return extra.length ? [...titles, ...extra] : titles;
}

// General stream filtering uses title objects rather than the library's strings.
// Return a request-local copy; do not change the shared metadata cache.
export function localizedTitleMetadata(metadata, parsedId) {
  if (!metadata || !parsedId || !Array.isArray(metadata.titles) || !metadata.titles.every(t => typeof t?.title === 'string')) return metadata;
  const titles = metadata.titles.map(t => t.title);
  const aliases = libraryTitleAliases({ titles, imdbId: metadata.imdbId }, parsedId);
  const extra = aliases.slice(titles.length).map(title => ({ title, language: 'pt' }));
  // Filename abbreviation observed in the S2 provider. It identifies the show,
  // but carries no language tag and must never infer a spoken language.
  if (seriesIdentity(metadata, parsedId) === 'tt1710308' && !titles.some(t => t.toLowerCase() === 'u.s.m.')) extra.push({ title: 'U.S.M.' });
  return extra.length ? { ...metadata, titles: [...metadata.titles, ...extra] } : metadata;
}
