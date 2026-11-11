# Optional debrid validation — 2026-11-10

The P2P flow was checked against the previous code at `50e649f` and AIOStreams v2.37.0. The public instance used was Midnight (For the Weebs). The Stremio account API was mocked throughout; no real account's addon collection was changed.

| Check | Result |
| --- | --- |
| Existing debrid profiles | 1,008 generated configs were byte-identical to the previous code: 48 languages × 7 services × 3 option sets. |
| Unit tests and build | 161 tests passed; static build passed. |
| Existing browser flow with real public AIOStreams | Installation with two debrid services, backup, restore, language changes, subtitles, mobile layout and account merge passed. Credentials used in this test were dummy values; this checks installation, not debrid playback. |
| Optional-debrid browser flow with real public AIOStreams | Warning cancel/accept, removing the last service, installation without credentials, adding a service again and cache-preference restoration passed. |
| Real AIOStreams with controlled torrent metadata | Two PT-BR plus one original per quality; language-only mode; exact resolution → language → seeds ordering passed. |
| Local count-based benchmark | 46/46 responses were nonempty in two passes, with no request errors; counts matched in 36/46 cases. This is not proof of playable P2P results: the general benchmark also counts diagnostic streams. |
| Strict public P2P corpus check | Actual torrent hashes were returned for 33/46 titles in the first pass, with no request errors. Two empty cases (The Dark Knight and Chernobyl) returned 8 and 7 torrents on a fresh query. Naruto remained empty, including when querying Torrentio directly. Availability and list counts vary; full corpus coverage is not established. |
| P2P movie sample (`tt0133093`) | Downloaded a partial 1080p dual-audio result through aria2; ffmpeg decoded ten video frames (1920×800) and three seconds of Portuguese audio. About 16 MiB downloaded; about 13 seconds until the tested video header was available. |
| P2P episode sample (`tt0460681:4:1`) | Downloaded a partial 720p dual-audio result through aria2; ffmpeg decoded ten video frames (1280×720) and three seconds of Portuguese audio. About 72 MiB downloaded; about 25 seconds until the tested video header was available. |

Only Torrentio presets are enabled without debrid. Zilean requires a service; another public endpoint returned 404 for a P2P manifest and prevented profile creation. Presets and output with debrid remain unchanged.

Run the repeatable browser and instance checks described in [CONTRIBUTING.md](../CONTRIBUTING.md). The browser test accepts `E2E_AIO` to create the profile on a real AIOStreams instead of mocking profile creation. `tools/benchmark.mjs` checks the title corpus through `DUBLIX_MANIFEST_URL`; it does not download video.

Playback probes used existing aria2, ffprobe and ffmpeg executables, with partial downloads limited to a temporary directory. They establish that the returned torrents contained decodable video and Portuguese audio. They do not establish uninterrupted playback of an entire film or compatibility with a particular TV. P2P availability, startup time and throughput depend on peers; the warning remains visible in the setup flow.

## Post-fix review — 2026-11-10

Reviewed `50e649f..2eea2b2`, including an independent read-only review; no blocking defect was found. Revalidated an isolated archive of `2eea2b2`, without unrelated working-tree changes:

- All 161 unit tests, static build and whitespace checks passed. The 1,008-case debrid comparison remained byte-identical to `50e649f`.
- The production browser flow passed through the real Pages proxy and public AIOStreams: two services, backup/restore, language/subtitle changes and preservation of unrelated addons. Stremio account writes remained mocked and service credentials were dummy values.
- Optional-debrid installation passed with real public AIOStreams. Warning cancel/accept, review invalidation, re-adding services and cache-preference restoration passed.
- Desktop and mobile screenshots were inspected. The standard text-only recommendation remained compact, without horizontal overflow or decorative SVGs. The regression also passed with the older stylesheet deliberately substituted to simulate stale CSS.
- A disposable AIOStreams v2.37.0 passed controlled torrent ordering, per-quality limits and language-only filtering. Live searches returned eight movie torrents and four episode torrents for the samples above.
- Production HTML, CSS, JavaScript and profile-builder assets matched the tested build byte for byte.

This revalidation did not repeat media downloads, continuous playback, a physical TV test or the self-host gateway end-to-end suite. Earlier partial playback evidence remains limited as described above. The production browser check excludes the pre-existing optional Cloudflare analytics beacon CSP diagnostic; application checks passed without errors. The oversized icon was a visual validation failure in the intermediate design, removed in `2eea2b2`; no further product-code change was needed after this review.
