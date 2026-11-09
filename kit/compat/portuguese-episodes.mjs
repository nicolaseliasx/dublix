// Normalize only explicit Portuguese season/episode tokens before the upstream
// parser sees them. Never infer an episode from file order or an arbitrary number.
export function normalizePortugueseEpisodes(value) {
  if (typeof value !== 'string') throw new TypeError('filename must be a string');
  const season = /\b(?:temporada|temp)[ ._-]*(\d{1,2})\b(?:[ ._/\\-]*(?:epis[oó]dio|epi|ep)[ ._-]*(\d{1,3})\b)?/giu;
  // Number before the word ("2 temp", "1a Temporada", "3ª temporada"). Without
  // it a season-2 pack has no season at all and strict matching lets it
  // through for a season-1 request.
  const seasonFirst = /\b(\d{1,2})(?:a|ª|º|o)?[ ._-]*(?:temporada|temp)\b/giu;
  return value.replace(season, (_match, s, e) => `S${s.padStart(2, '0')}${e ? `E${e.padStart(2, '0')}` : ''}`)
    .replace(seasonFirst, (_match, s) => `S${s.padStart(2, '0')}`)
    .replace(/\b(?:epis[oó]dio|epi)[ ._-]*(\d{1,3})\b/giu, (_match, e) => `E${e.padStart(2, '0')}`)
    // "Title.03.12-…": exactly two-digit pairs after a dotted word, never after a
    // year ("2019.03.15") nor followed by another number ("03.12.2019", "5.1").
    .replace(/(?<=(?:^|[^\d])\.)(\d{2})\.(\d{2})(?!\d|\.\d)/gu, (_match, s, e) => `S${s}E${e}`)
    // "04-20 Name.mkv": only at the start of a file or folder name.
    .replace(/(^|[\/\\])(\d{2})-(\d{2})(?=[ ._])/gu, (_match, sep, s, e) => `${sep}S${s}E${e}`);
}
