// Some Brazilian indexers (e.g. Comando via Torrentio) name the file only "1x01 - -By Group - SITE.mkv". The file name wins
// when AIOStreams merges file and torrent names, so the stream "title" becomes that marker and exact title matching drops
// a correct release. Only a title that starts with an episode marker is replaced, by the title parsed from the torrent name;
// season, episode, year and the requested-title comparison are untouched.
const EPISODE_MARKER = /^\s*(?:\d{1,2}\s*x\s*\d{1,3}|e(?:p(?:is[oó]dio)?)?\.?\s*\d{1,3}|cap[ií]tulo\s*\d+)(?![\p{L}\d])/iu;

export function repairedStreamTitle(stream, folderTitle) {
  const title = stream?.parsedFile?.title;
  if (!title || !stream.folderName || !EPISODE_MARKER.test(title)) return title;
  try {
    const fromFolder = folderTitle(stream.folderName);
    return typeof fromFolder === 'string' && fromFolder.trim() ? fromFolder : title;
  } catch {
    return title;
  }
}
