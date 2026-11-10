# Optional debrid validation — 2026-11-10

The P2P flow was checked against the previous code at `50e649f` and AIOStreams v2.37.0. The public instance used was Midnight (For the Weebs). The Stremio account API was mocked throughout; no real account's addon collection was changed.

| Check | Result |
| --- | --- |
| Existing debrid profiles | 1,008 generated configs were byte-identical to the previous code: 48 languages × 7 services × 3 option sets. |
| Unit tests and build | 161 tests passed; static build passed. |
| Existing browser flow with real public AIOStreams | Installation with two debrid services, backup, restore, language changes, subtitles, mobile layout and account merge passed. Credentials used in this test were dummy values; this checks installation, not debrid playback. |
| Optional-debrid browser flow with real public AIOStreams | Warning cancel/accept, removing the last service, installation without credentials, adding a service again and cache-preference restoration passed. |
| Real AIOStreams with controlled torrent metadata | Two PT-BR plus one original per quality; language-only mode; exact resolution → language → seeds ordering passed. |
| Live P2P stream lookup | 46/46 titles had options in each of two passes, with no request errors. List counts matched in 36/46 cases; source results can change between requests. |
| P2P movie sample (`tt0133093`) | Downloaded a partial 1080p dual-audio result through aria2; ffmpeg decoded ten video frames (1920×800) and three seconds of Portuguese audio. About 16 MiB downloaded; about 13 seconds until the tested video header was available. |
| P2P episode sample (`tt0460681:4:1`) | Downloaded a partial 720p dual-audio result through aria2; ffmpeg decoded ten video frames (1280×720) and three seconds of Portuguese audio. About 72 MiB downloaded; about 25 seconds until the tested video header was available. |

Only Torrentio presets are enabled without debrid. Zilean requires a service; another public endpoint returned 404 for a P2P manifest and prevented profile creation. Presets and output with debrid remain unchanged.

Run the repeatable browser and instance checks described in [CONTRIBUTING.md](../CONTRIBUTING.md). The browser test accepts `E2E_AIO` to create the profile on a real AIOStreams instead of mocking profile creation. `tools/benchmark.mjs` checks the title corpus through `DUBLIX_MANIFEST_URL`; it does not download video.

Playback probes used existing aria2, ffprobe and ffmpeg executables, with partial downloads limited to a temporary directory. They establish that the returned torrents contained decodable video and Portuguese audio. They do not establish uninterrupted playback of an entire film or compatibility with a particular TV. P2P availability, startup time and throughput depend on peers; the warning remains visible in the setup flow.
