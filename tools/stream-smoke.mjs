#!/usr/bin/env node
// Stream smoke test for a Dublix / AIOStreams addon: asks the manifest for the stream list of a few titles and checks it.
// Default is read-only toward your debrid account: it only requests stream lists. With --playback it also resolves the FIRST
// option of each title and reads a few MiB through the gateway, which makes your debrid service add that torrent to your
// account (same as pressing play). This tool never removes anything from your account.
// Output keeps ids, counts, statuses and numbers only: no stream links, redirect targets, file names, keys or manifest path.
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { loadCases, makeRedactor, safeMessage, maskManifestUrl, MANIFEST_HINT, parseManifestUrl, parseTitles, streamListUrl, writeReport } from './lib.mjs';

const MiB = 1024 * 1024;
const DEFAULT_BYTES = 8 * MiB;
const DEFAULT_RATIO = 1.5;

export const HELP = `Usage: node tools/stream-smoke.mjs [options]

Checks the stream list of a few titles through your addon manifest. Read-only unless --playback is given.

Input (environment):
  DUBLIX_MANIFEST_URL   Your addon manifest address (https://<host>/stremio/<id>/<password>/manifest.json). It contains
                        credentials: prefer the variable over --manifest, which shows up in the process list.

Options:
  --manifest <url>      Same as DUBLIX_MANIFEST_URL.
  --titles <ids>        Comma-separated IMDb ids (tt0133093 or tt0903747:1:1). Default: the first titles of tools/cases.json.
  --cases <file>        Use another cases file ({ "cases": [{ "id", "type" }] }).
  --limit <n>           Titles to check (default 10; 3 with --playback).
  --max-streams <n>     Fail when a list has more than n options.
  --timeout <seconds>   Per-request timeout (default 60).
  --playback            Also resolve the first option and read a Range of the video. SIDE EFFECT: your debrid service may
                        add that torrent to your account. Nothing is removed afterwards; clean up in your debrid dashboard.
  --bytes <n>           Bytes to read per title with --playback (default ${DEFAULT_BYTES}, min ${MiB}).
  --ratio <x>           Required throughput as a multiple of the file bitrate (default ${DEFAULT_RATIO}).
  --json                Print the report as JSON instead of text.
  --output <file>       Also write the JSON report to a new file (mode 600, never overwrites).
  -h, --help            Show this help.

Exit code: 0 when every title passes, 1 otherwise (or on bad input).
Each title fails when: the request fails, the list is empty or the first option has no link; with --playback also when the answer is not HTTP 206, not a video, the gateway "downloading" placeholder, or slower than ratio x bitrate.
A first link on a host other than the manifest host is reported as a warning (check BASE_URL), not a failure.`;

/** Bitrate printed by the profile formatter ("19.6 ᴹᵇᵖˢ" or "900 ᴷᵇᵖˢ") in Mbps; null when the option shows none. */
export function parseBitrateMbps(description) {
  const match = /([\d.]+)\s*([ᴹᴷ])ᵇᵖˢ/.exec(String(description ?? ''));
  const value = match ? Number(match[1]) / (match[2] === 'ᴷ' ? 1000 : 1) : NaN;
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function judgeList({ streams, firstHasUrl }, { maxStreams } = {}) {
  const failures = [];
  if (!streams) failures.push('no-streams');
  else if (!firstHasUrl) failures.push('first-has-no-link');
  if (maxStreams && streams > maxStreams) failures.push(`list-longer-than-${maxStreams}`);
  return { pass: failures.length === 0, failures };
}

export function judgePlayback({ status, contentType, mbps, bitrateMbps, kind }, ratio = DEFAULT_RATIO) {
  const failures = [];
  if (kind === 'placeholder') failures.push('downloading-placeholder');
  if (status !== 206) failures.push('status-not-206');
  if (!/^video\//i.test(contentType ?? '') && !/matroska|mp4|octet-stream/i.test(contentType ?? '')) failures.push('content-type-not-video');
  const measured = bitrateMbps ? mbps / bitrateMbps : null;
  if (measured !== null && measured < ratio) failures.push(`throughput-below-${ratio}x`);
  return { pass: failures.length === 0, failures, ratio: measured };
}

async function readUpTo(response, limit, budgetMs) {
  const started = performance.now();
  const reader = response.body?.getReader();
  if (!reader) return { bytes: 0, ms: 0 };
  let firstByteAt = null; let bytes = 0; let partial = false;
  while (bytes < limit) {
    const left = budgetMs - (performance.now() - started);
    if (left <= 0) { partial = true; break; }
    let timer;
    const next = await Promise.race([reader.read(), new Promise(r => { timer = setTimeout(() => r(null), left); })]);
    clearTimeout(timer);
    if (next === null) { partial = true; break; }
    if (next.done) break;
    if (firstByteAt === null) firstByteAt = performance.now();
    bytes += next.value.byteLength;
  }
  const end = performance.now();
  await reader.cancel().catch(() => {});
  return { bytes, ms: end - (firstByteAt ?? started), partial, firstByteMs: (firstByteAt ?? end) - started };
}

/** One Range read of a stream link, following one redirect by hand so a gateway placeholder can be recognised. */
async function readPlayback({ fetcher, origin, url, bytes, timeoutMs, readBudgetMs }) {
  const range = { Range: `bytes=0-${bytes - 1}` };
  const signal = () => AbortSignal.timeout(timeoutMs);
  let response = await fetcher(url, { headers: range, redirect: 'manual', signal: signal() });
  let kind = 'direct';
  if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
    const target = new URL(response.headers.get('location'), url);
    if (!/^https?:$/.test(target.protocol)) throw new Error('unsupported redirect');
    kind = target.host === new URL(origin).host && /\/static\//.test(target.pathname) ? 'placeholder' : 'cdn';
    await response.body?.cancel?.().catch(() => {});
    response = await fetcher(target.toString(), { headers: range, redirect: 'follow', signal: signal() });
  }
  const read = await readUpTo(response, bytes, readBudgetMs);
  const out = {
    status: response.status, contentType: (response.headers.get('content-type') ?? '').split(';')[0], kind, bytes: read.bytes,
    firstByteMs: Math.round(read.firstByteMs ?? 0), mbps: read.ms > 0 ? Number(((read.bytes * 8) / (read.ms / 1000) / 1e6).toFixed(2)) : 0,
  };
  if (read.partial) out.partial = true;
  return out;
}

/** Checks one title. Returns numbers and a verdict; never URLs. */
export async function smokeTitle({ fetcher = fetch, origin, manifestPath, item, playback = false, bytes = DEFAULT_BYTES, ratio = DEFAULT_RATIO, maxStreams, timeoutMs = 60000, readBudgetMs = 20000 }) {
  const row = { id: item.id, type: item.type };
  const fail = failure => ({ ...row, verdict: { pass: false, failures: [failure] } });
  const started = performance.now();
  let first;
  try {
    const response = await fetcher(streamListUrl(origin, manifestPath, item), { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return fail(`http-${response.status}`);
    let list;
    try { list = await response.json(); } catch { return fail('invalid-json'); }
    const streams = Array.isArray(list?.streams) ? list.streams : [];
    first = streams[0];
    row.streams = streams.length;
    row.listMs = Math.round(performance.now() - started);
    row.firstHasUrl = /^https?:\/\//.test(first?.url ?? '');
    row.linkHost = !row.firstHasUrl ? 'none' : new URL(first.url).host === new URL(origin).host ? 'same' : 'different';
    row.bitrateMbps = parseBitrateMbps(first?.description);
  } catch { return fail('request-failed'); }
  row.verdict = judgeList(row, { maxStreams });
  if (!playback || !row.verdict.pass) return row;
  try {
    const attempts = [await readPlayback({ fetcher, origin, url: first.url, bytes, timeoutMs, readBudgetMs })];
    let verdict = judgePlayback({ ...attempts[0], bitrateMbps: row.bitrateMbps }, ratio);
    // A cold CDN start is slow and noisy: when only throughput fails, measure once more and keep the better rate.
    if (!verdict.pass && verdict.failures.every(f => f.startsWith('throughput-below'))) {
      attempts.push(await readPlayback({ fetcher, origin, url: first.url, bytes, timeoutMs, readBudgetMs }));
      row.retried = true;
    }
    row.playback = attempts.reduce((a, b) => (b.mbps > a.mbps ? b : a));
    verdict = judgePlayback({ ...row.playback, bitrateMbps: row.bitrateMbps }, ratio);
    row.verdict = { pass: verdict.pass, failures: verdict.failures, ratio: verdict.ratio === null ? null : Number(verdict.ratio.toFixed(2)) };
  } catch { row.verdict = { pass: false, failures: ['playback-request-failed'] }; }
  return row;
}

export function summarize(rows) {
  const failed = rows.filter(r => !r.verdict.pass);
  const has = code => rows.filter(r => r.verdict.failures.includes(code)).length;
  return {
    titles: rows.length, pass: rows.length - failed.length, fail: failed.length, noStreams: has('no-streams'), requestFailed: has('request-failed'),
    linkHostDiffers: rows.filter(r => r.linkHost === 'different').length, failedIds: failed.map(r => r.id),
  };
}

function parse(argv) {
  const { values } = parseArgs({ args: argv, strict: true, allowPositionals: false, options: {
    manifest: { type: 'string' }, titles: { type: 'string' }, cases: { type: 'string' }, limit: { type: 'string' }, 'max-streams': { type: 'string' },
    timeout: { type: 'string' }, playback: { type: 'boolean' }, bytes: { type: 'string' }, ratio: { type: 'string' }, json: { type: 'boolean' },
    output: { type: 'string' }, help: { type: 'boolean', short: 'h' },
  } });
  return values;
}
const positive = (value, name, fallback) => {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number.`);
  return n;
};

export async function run(argv, env = process.env, { stdout = console.log, stderr = console.error, fetcher = fetch } = {}) {
  let redact = text => text;
  try {
    const o = parse(argv);
    if (o.help) { stdout(HELP); return 0; }
    const raw = o.manifest ?? env.DUBLIX_MANIFEST_URL;
    if (!raw) throw new Error(MANIFEST_HINT);
    redact = makeRedactor(raw);
    const { origin, path } = parseManifestUrl(raw);
    const playback = o.playback === true;
    const limit = Math.floor(positive(o.limit, '--limit', playback ? 3 : 10));
    const titles = (o.titles ? parseTitles(o.titles) : await loadCases(o.cases)).slice(0, limit);
    const options = { fetcher, origin, manifestPath: path, playback, bytes: Math.max(MiB, positive(o.bytes, '--bytes', DEFAULT_BYTES)),
      ratio: positive(o.ratio, '--ratio', DEFAULT_RATIO), maxStreams: o['max-streams'] && Math.floor(positive(o['max-streams'], '--max-streams')),
      timeoutMs: positive(o.timeout, '--timeout', 60) * 1000 };
    const rows = [];
    for (const item of titles) rows.push(await smokeTitle({ ...options, item }));
    const summary = summarize(rows);
    const report = { generatedAt: new Date().toISOString(), manifest: maskManifestUrl(raw), mode: playback ? 'playback' : 'list-only', summary, results: rows };
    if (o.output) await writeReport(resolve(o.output), report);
    if (o.json) stdout(JSON.stringify(report, null, 2));
    else {
      stdout(`Manifest: ${report.manifest}  (${report.mode})`);
      for (const r of rows) {
        const detail = r.verdict.pass ? `${r.streams} streams${r.playback ? `, ${r.playback.mbps} Mbps` : ''}${r.linkHost === 'different' ? ', warning: first link on another host' : ''}` : r.verdict.failures.join(', ');
        stdout(`${r.verdict.pass ? 'ok  ' : 'FAIL'} ${r.id} ${detail}`);
      }
      stdout(`${summary.pass}/${summary.titles} passed${summary.linkHostDiffers ? `; ${summary.linkHostDiffers} with the first link on another host (check BASE_URL)` : ''}`);
    }
    return summary.fail === 0 ? 0 : 1;
  } catch (error) {
    stderr(safeMessage(error, redact));
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run(process.argv.slice(2)).then(code => { process.exitCode = code; });
