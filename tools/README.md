# Tools

Checks you can run against your own Dublix instance (the [self-host kit](../kit/README.md), or any AIOStreams addon with the Dublix profile). Plain Node 20+, no dependencies, no secrets in the repository: every input comes from a flag or an environment variable, and output never contains your keys or the full manifest URL (credential segments print as `***`).

| Tool | What it checks | Touches your debrid account? |
| --- | --- | --- |
| `verify-gateway.mjs` | The kit gateway exposes only the addon, playback redirects, the setup site's profile API and Dublix Subs, and blocks the rest. | No. Never creates a profile. |
| `stream-smoke.mjs` | The stream list of a few titles is not empty and the first option has a link. | No by default. `--playback` is opt-in, see below. |
| `benchmark.mjs` | Latency (p50/p95), titles with options and list-size stability over 46 titles, cold and warm. | No (stream lookups only). |

All three print `--help`, exit 0 when everything passes and 1 otherwise.

## Inputs

| Variable | Used by | Meaning |
| --- | --- | --- |
| `DUBLIX_MANIFEST_URL` | all (optional for `verify-gateway`) | Your addon manifest address, `https://<host>/stremio/<id>/<password>/manifest.json`. It contains credentials: prefer the variable over `--manifest`, which shows up in the process list. |
| `DUBLIX_BASE_URL` | `verify-gateway` | Gateway to test. Default: the manifest's host, else `http://127.0.0.1:8080` (the kit default). |
| `FILMHUB_SITE_ORIGIN` | `verify-gateway` | The setup site origin allowed to create profiles. Default: the kit's default. |

```sh
export DUBLIX_MANIFEST_URL='https://dublix.example.com/stremio/<id>/<password>/manifest.json'
node tools/verify-gateway.mjs --base http://127.0.0.1:8080
node tools/stream-smoke.mjs --titles tt0133093,tt0903747:1:1
node tools/benchmark.mjs --output baseline.json
```

## `verify-gateway.mjs`

Asserts the behaviour of `kit/gateway/default.conf.template`: `/` and the AIOStreams configure pages answer 404, the internal search API is hidden, `/api/v1/status` answers, the profile API allows only `FILMHUB_SITE_ORIGIN` (CORS preflight) and rejects GET, the playback and static routes reach AIOStreams, Dublix Subs serves its manifests (read from `packages/subs`) and gives a dubbed file no subtitles, and the subs and status routes refuse writes. With a manifest it also checks the manifest and one stream list.

It tells "blocked by the gateway" from "404 from AIOStreams" by the default nginx error page, so it assumes the stock gateway. The profile rate limit is not tested.

## `stream-smoke.mjs`

Requests the stream list of each title (default: the first 10 of `cases.json`; `--titles` or `--cases` to choose) and fails on a request error, an empty list or a first option without a link. A first link on another host than the manifest is a warning: it usually means `BASE_URL` is wrong.

`--playback` also resolves the first option and reads a few MiB with an HTTP Range request, checking for HTTP 206, a video type, no gateway "downloading" placeholder and throughput of at least `--ratio` times the file bitrate (when the list shows it). **Side effect:** playing an option makes your debrid service add that torrent to your account, exactly as pressing play does. The tool does not remove anything (that would be debrid-specific); it checks only 3 titles unless you pass `--limit`, and you can clean up in your debrid dashboard.

## `benchmark.mjs`

Runs the stream lookups of `cases.json` (46 stable IMDb ids: films, series, anime, Brazilian cinema, translation-sensitive titles, season-pack episodes) twice with limited concurrency, and reports per-pass latency, how many titles returned options (by group) and whether the list size matched between the two passes. "Cold" and "warm" only mean request order. Audio and playback are not verified; `--output` writes a JSON report to a new file (mode 600, never overwritten).

## Not included

Verified audio (inspecting the real audio tracks of cached options) is not a tool yet: it needs a prober (ffprobe) and a debrid-specific way to resolve and clean up files, so it cannot be a safe, dependency-free script.
