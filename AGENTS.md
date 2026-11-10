# Dublix

- Read [CONTRIBUTING.md](./CONTRIBUTING.md) for TDD, browser checks and a disposable AIOStreams setup.
- `npm test` runs the unit suite; `npm run build` builds the static site in `dist/`.
- Optional-debrid regressions: `node tests/e2e/no-debrid.e2e.mjs` (browser, mocked accounts) and `node tests/e2e/no-debrid-instance.e2e.mjs --live` (disposable AIOStreams, stream metadata only).
- `services: []` selects P2P: allow the `p2p` stream type, disable service wrapping and every preset except Torrentio. Other public endpoints can require debrid or reject P2P manifests with 404, preventing profile creation. Skip cached-only/pending-download rules. Keep resolution and language ordering, then prefer more seeds within each group.
- Keep the debrid output unchanged; golden tests cover its existing contract. Never put test or real credentials in the base profile.
- Do not equate returned P2P hashes with validated playback: playback also requires seeds and a P2P-capable Stremio player.
