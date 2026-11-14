import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ORIGINAL_HASH = '5d96aafc46be62867aaf1453585ebe2db5897aa237348bd3e3fc3d64df2ef366';
const TARGET = '/app/packages/core/dist/builtins/library/matching.js';
const SEAM = '    const parsed = parseTorrentTitleCached(itemName);';

export function patchLibraryMatching(source, expectedHash = ORIGINAL_HASH) {
  if (createHash('sha256').update(source).digest('hex') !== expectedHash) {
    throw new Error('upstream library hash changed; review before rebuilding');
  }
  if (source.split(SEAM).length !== 2) throw new Error('upstream library seam is missing or ambiguous');
  return "import { libraryTitleAliases } from '/app/dublix/library-title-aliases.mjs';\n" + source.replace(SEAM,
    '    const titles = libraryTitleAliases(metadata, parsedId);\n' +
    '    if (titles !== metadata.titles) {\n' +
    '        metadata = { ...metadata, titles };\n' +
    '        cleanedTitles = titles.map((title) => cleanTitle(title));\n' +
    '    }\n' + SEAM);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] !== '--apply') throw new Error('usage: patch-library.mjs --apply');
  writeFileSync(TARGET, patchLibraryMatching(readFileSync(TARGET, 'utf8')));
}
