#!/usr/bin/env node
// Benchmark of the stream list: asks your addon manifest for a fixed set of titles twice (cold and warm pass), then reports
// latency percentiles, how many titles returned options, and whether the list size is stable between the two passes.
// Read-only and light: it only requests stream lists, never plays anything and never touches your debrid account.
// The report keeps ids, counts and timings only: no stream links, names, hashes, keys or manifest path.
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { limitedMap, loadCases, makeRedactor, maskManifestUrl, MANIFEST_HINT, parseManifestUrl, parseTitles, percentile, safeMessage, streamListUrl, writeReport } from './lib.mjs';

export const HELP = `Usage: node tools/benchmark.mjs [options]

Measures how your stream list behaves over a set of titles (stream lookups only; nothing is played or added to your debrid account).

Input (environment):
  DUBLIX_MANIFEST_URL   Your addon manifest address (https://<host>/stremio/<id>/<password>/manifest.json). It contains
                        credentials: prefer the variable over --manifest, which shows up in the process list.

Options:
  --manifest <url>      Same as DUBLIX_MANIFEST_URL.
  --cases <file>        Cases file ({ "cases": [{ "id", "type", "group" }] }). Default: tools/cases.json (46 titles).
  --titles <ids>        Comma-separated IMDb ids instead of a cases file (tt0133093 or tt0903747:1:1).
  --limit <n>           Use only the first n titles.
  --concurrency <n>     Parallel requests (default 2).
  --timeout <seconds>   Per-request timeout (default 20).
  --json                Print the report as JSON instead of text.
  --output <file>       Also write the JSON report to a new file (mode 600, never overwrites).
  -h, --help            Show this help.

"cold" and "warm" only mean request order: the server cache state is not inferred. Counting a title as found means the list
had at least one option; audio and playback are not checked (see tools/stream-smoke.mjs for playback).
Exit code: 0 when requests succeed and at least one title has options, 1 otherwise (or on bad input).`;

/** One stream-list lookup: count and latency. */
export async function measureTitle({ fetcher = fetch, origin, manifestPath, item, pass, timeoutMs = 20000 }) {
  const row = { id: item.id, type: item.type, group: item.group, pass };
  const started = performance.now();
  const finish = extra => ({ ...row, latencyMs: Math.round(performance.now() - started), ...extra });
  try {
    const response = await fetcher(streamListUrl(origin, manifestPath, item), { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return finish({ streamCount: null, error: `http-${response.status}` });
    let body;
    try { body = await response.json(); } catch { return finish({ streamCount: null, error: 'invalid-json' }); }
    const count = Array.isArray(body?.streams) ? body.streams.length : 0;
    return finish({ streamCount: count, found: count > 0 });
  } catch (error) {
    return finish({ streamCount: null, error: error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'request-failed' });
  }
}

export const runPass = ({ cases, concurrency = 2, ...rest }) => limitedMap(cases, concurrency, item => measureTitle({ ...rest, item }));

export function summarizePass(rows) {
  const latencies = rows.map(r => r.latencyMs).sort((a, b) => a - b);
  const ok = rows.filter(r => r.streamCount !== null);
  return {
    requests: rows.length, success: ok.length, errors: rows.length - ok.length, found: ok.filter(r => r.streamCount > 0).length,
    empty: ok.filter(r => r.streamCount === 0).length, p50LatencyMs: percentile(latencies, 50), p95LatencyMs: percentile(latencies, 95),
  };
}

export function compareRuns(cold, warm) {
  const warmById = new Map(warm.map(r => [r.id, r]));
  const both = cold.filter(r => r.streamCount !== null && warmById.get(r.id)?.streamCount != null);
  const differentIds = both.filter(r => warmById.get(r.id).streamCount !== r.streamCount).map(r => r.id);
  return { comparable: both.length, same: both.length - differentIds.length, differentIds };
}

export function byGroup(rows) {
  const groups = {};
  for (const r of rows) {
    const g = (groups[r.group ?? 'custom'] ??= { titles: 0, found: 0 });
    g.titles++;
    if (r.streamCount > 0) g.found++;
  }
  return groups;
}

const count = (value, name, fallback) => {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} must be a positive integer.`);
  return n;
};

export async function run(argv, env = process.env, { stdout = console.log, stderr = console.error, fetcher = fetch } = {}) {
  let redact = text => text;
  try {
    const { values: o } = parseArgs({ args: argv, strict: true, allowPositionals: false, options: {
      manifest: { type: 'string' }, cases: { type: 'string' }, titles: { type: 'string' }, limit: { type: 'string' }, concurrency: { type: 'string' },
      timeout: { type: 'string' }, json: { type: 'boolean' }, output: { type: 'string' }, help: { type: 'boolean', short: 'h' },
    } });
    if (o.help) { stdout(HELP); return 0; }
    const raw = o.manifest ?? env.DUBLIX_MANIFEST_URL;
    if (!raw) throw new Error(MANIFEST_HINT);
    redact = makeRedactor(raw);
    const { origin, path } = parseManifestUrl(raw);
    const all = o.titles ? parseTitles(o.titles).map(t => ({ ...t, group: 'custom' })) : await loadCases(o.cases);
    const cases = all.slice(0, count(o.limit, '--limit', all.length));
    const options = { fetcher, origin, manifestPath: path, cases, concurrency: count(o.concurrency, '--concurrency', 2), timeoutMs: count(o.timeout, '--timeout', 20) * 1000 };
    const cold = await runPass({ ...options, pass: 'cold' });
    const warm = await runPass({ ...options, pass: 'warm' });
    const summary = { titles: cases.length, cold: summarizePass(cold), warm: summarizePass(warm), stability: compareRuns(cold, warm), groups: byGroup(cold) };
    const report = { generatedAt: new Date().toISOString(), manifest: maskManifestUrl(raw), concurrency: options.concurrency, timeoutMs: options.timeoutMs,
      note: 'Stream lookups only. Found means the list had at least one option; audio and playback are not verified.', summary, results: [...cold, ...warm] };
    if (o.output) await writeReport(resolve(o.output), report);
    if (o.json) stdout(JSON.stringify(report, null, 2));
    else {
      stdout(`Manifest: ${report.manifest}`);
      for (const name of ['cold', 'warm']) {
        const s = summary[name];
        stdout(`${name.padEnd(4)}: ${s.found}/${s.requests} titles with options, ${s.empty} empty, ${s.errors} errors, p50 ${s.p50LatencyMs} ms, p95 ${s.p95LatencyMs} ms`);
      }
      stdout(`stable list size between passes: ${summary.stability.same}/${summary.stability.comparable}`);
      for (const [group, g] of Object.entries(summary.groups)) stdout(`  ${group}: ${g.found}/${g.titles}`);
    }
    return summary.cold.errors + summary.warm.errors === 0 && summary.cold.found + summary.warm.found > 0 ? 0 : 1;
  } catch (error) {
    stderr(safeMessage(error, redact));
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run(process.argv.slice(2)).then(code => { process.exitCode = code; });
