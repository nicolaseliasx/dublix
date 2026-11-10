// Shared helpers for the tools in this folder: manifest address handling (with masking), title lists, small utilities.
import { chmod, open, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const TITLE_ID = /^tt\d{1,10}(:\d{1,4}:\d{1,4})?$/;
export const DEFAULT_CASES = fileURLToPath(new URL('./cases.json', import.meta.url));
export const MANIFEST_HINT = 'Set DUBLIX_MANIFEST_URL to your addon manifest address (https://<host>/stremio/<id>/<password>/manifest.json).';

/** Origin and path of a manifest URL. The error never echoes the input, which can carry credentials. */
export function parseManifestUrl(raw) {
  let url;
  try { url = new URL(String(raw)); } catch { url = null; }
  if (!url || !['http:', 'https:'].includes(url.protocol) || !url.pathname.endsWith('/manifest.json')) {
    throw new Error('Not a valid manifest URL (expected http(s)://<host>/.../manifest.json).');
  }
  return { origin: url.origin, path: url.pathname };
}

const KEPT = new Set(['', 'stremio', 'manifest.json']);
/** The manifest address with every credential segment and the query replaced by ***. */
export function maskManifestUrl(raw) {
  const { origin, path } = parseManifestUrl(raw);
  return origin + path.split('/').map(s => (KEPT.has(s) ? s : '***')).join('/');
}

/** A function that strips the manifest URL, its path and every credential segment from any text. */
export function makeRedactor(rawManifest) {
  let secrets = [];
  try {
    const { path } = parseManifestUrl(rawManifest);
    secrets = [String(rawManifest), path, ...path.split('/').filter(s => !KEPT.has(s)), new URL(rawManifest).search.slice(1)];
  } catch { /* no manifest: nothing to hide */ }
  secrets = [...new Set(secrets.filter(Boolean))].sort((a, b) => b.length - a.length);
  return text => secrets.reduce((out, secret) => out.split(secret).join('***'), String(text));
}

export const streamListUrl = (origin, manifestPath, { type, id }) =>
  origin.replace(/\/$/, '') + manifestPath.replace(/manifest\.json$/, `stream/${type}/${id}.json`);

/** "tt0133093,tt0903747:1:2" to typed titles (an id with season and episode is a series). */
export function parseTitles(text) {
  return String(text).split(',').map(s => s.trim()).filter(Boolean).map(id => {
    if (!TITLE_ID.test(id)) throw new Error(`Invalid title id: ${id.slice(0, 24)} (use tt1234567 or tt1234567:season:episode).`);
    return { id, type: id.includes(':') ? 'series' : 'movie' };
  });
}

/** The bundled list (tools/cases.json) or a file shaped { "cases": [{ "id", "type", "group"? }] }. */
export async function loadCases(file = DEFAULT_CASES) {
  const cases = JSON.parse(await readFile(file, 'utf8'))?.cases;
  if (!Array.isArray(cases) || !cases.length) throw new Error('Cases file needs a non-empty "cases" array.');
  return cases.map(c => {
    if (!TITLE_ID.test(String(c?.id)) || c.type !== (c.id.includes(':') ? 'series' : 'movie')) throw new Error(`Invalid case: ${String(c?.id).slice(0, 24)} (movie ids have no colon, series ids are tt:season:episode).`);
    return { id: c.id, type: c.type, group: typeof c.group === 'string' ? c.group : 'custom' };
  });
}

export async function limitedMap(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) { const i = cursor++; results[i] = await fn(items[i], i); }
  }));
  return results;
}

/** Nearest-rank percentile of an ascending list; null when empty. */
export const percentile = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p / 100) - 1)] : null);

/** Writes a JSON report that must not exist yet (never overwrites), readable by the owner only. */
export async function writeReport(path, data) {
  let file;
  try { file = await open(path, 'wx', 0o600); } catch (error) {
    throw new Error(error.code === 'EEXIST' ? 'Output file already exists; choose another path.' : 'Cannot create the output file.');
  }
  try { await file.writeFile(`${JSON.stringify(data, null, 2)}\n`); await file.sync(); } finally { await file.close(); }
  await chmod(path, 0o600);
}

/** Error text for the terminal: argument-parser errors (which can echo a pasted URL) become a fixed hint; the rest is redacted. */
export const safeMessage = (error, redact = text => text) =>
  (String(error?.code).startsWith('ERR_PARSE_ARGS') ? 'Invalid arguments (see --help).' : redact(error?.message ?? 'Unexpected error.'));
