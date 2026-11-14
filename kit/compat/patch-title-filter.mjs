import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ORIGINAL_HASH = '02248d1f3d9caa02dbcb5915714452b4a1f6262a7a6f567a6caf6ef58a565606';
const TARGET = '/app/packages/core/dist/streams/filterer.js';
const SEAM = 'const requestedMetadata = await context.getMetadata();';
const TITLE_SEAM = 'let streamTitle = stream.parsedFile?.title;';

export function patchTitleFilter(source, expectedHash = ORIGINAL_HASH) {
  if (createHash('sha256').update(source).digest('hex') !== expectedHash) throw Error('upstream title filter hash changed; review before rebuilding');
  if (source.split(SEAM).length !== 2 || source.split(TITLE_SEAM).length !== 2) throw Error('upstream title filter seam is missing or ambiguous');
  return "import { localizedTitleMetadata } from '/app/dublix/library-title-aliases.mjs';\n" +
    "import { repairedStreamTitle } from '/app/dublix/stream-title.mjs';\n" +
    "import DublixFileParser from '/app/packages/core/dist/parser/file.js';\n" +
    source.replace(SEAM, 'const requestedMetadata = localizedTitleMetadata(await context.getMetadata(), context.parsedId);')
      .replace(TITLE_SEAM, 'let streamTitle = repairedStreamTitle(stream, (name) => DublixFileParser.parse(name)?.title);');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] !== '--apply') throw Error('usage: patch-title-filter.mjs --apply');
  writeFileSync(TARGET, patchTitleFilter(readFileSync(TARGET, 'utf8')));
}
