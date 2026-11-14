import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ORIGINAL_HASH = '51aae2d8283a1bdfaca461c39449aafe4a602ca17d4e96cfa7bcc0902f9adc41';
const TARGET = '/app/packages/core/dist/parser/title.js';
const SEAM = 'const name = stripRepostSuffixes(title);';

export function patchTitleParser(source, expectedHash = ORIGINAL_HASH) {
  if (createHash('sha256').update(source).digest('hex') !== expectedHash) {
    throw new Error('upstream parser hash changed; review before rebuilding');
  }
  if (source.split(SEAM).length !== 2) throw new Error('upstream parser seam is missing or ambiguous');
  return "import { normalizePortugueseEpisodes } from '/app/dublix/portuguese-episodes.mjs';\n" +
    source.replace(SEAM, 'const name = stripRepostSuffixes(normalizePortugueseEpisodes(title));');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] !== '--apply') throw new Error('usage: patch-title.mjs --apply');
  writeFileSync(TARGET, patchTitleParser(readFileSync(TARGET, 'utf8')));
}
