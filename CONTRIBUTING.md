# Contributing

Thanks for helping. Issues and pull requests are welcome, especially new language profiles and real-stream reports.

## Ground rules

- Write a failing test first, then the smallest change that makes it pass.
- Portuguese (Brazil) output must not change by accident: `packages/policy/golden.test.mjs` compares it with a frozen copy of the original code. Update the golden files only for an intended change, and say so in the pull request.
- Never commit credentials, manifest URLs, AuthKeys or personal data. `findSecrets` in `packages/policy/config.mjs` guards the base profile; run `npm test` before pushing.
- Addon names and anything else from a user's Stremio account are shown with `textContent`, never `innerHTML`.

## Tests

```sh
npm test          # unit tests: policy, languages, golden pt-BR, profile builder, merge, proxy, subs, kit patches, tools
```

Browser tests need `playwright-core`, Chromium, and a local AIOStreams on port 18391 (public-instance flow) or the kit on port 18395 (own-server flow):

```sh
docker run -d --rm --name dublix-validate -p 127.0.0.1:18391:3000 \
  -e SECRET_KEY=$(openssl rand -hex 32) -e BASE_URL=http://127.0.0.1:18391 \
  -e ALLOW_PRIVATE_URLS=false -e USER_CREATE_RATE_LIMIT_MAX_REQUESTS=100 \
  -e REGEX_FILTER_ACCESS=trusted -e SEL_SYNC_ACCESS=trusted \
  -e 'WHITELISTED_REGEX_PATTERNS_URLS=["https://git.tamtaro.de/Excluded-Regex.json","https://raw.githubusercontent.com/Vidhin05/Releases-Regex/main/English/regexes.json","https://git.tamtaro.de/for-nour-Regex.json"]' \
  -e 'WHITELISTED_SEL_URLS=["https://raw.githubusercontent.com/Vidhin05/Releases-Regex/main/English/expressions.json","https://git.tamtaro.de/for-nour-RSE.json"]' \
  ghcr.io/viren070/aiostreams:v2.37.0
npm i --no-save playwright-core
npm run dev &                                  # site on http://127.0.0.1:8788
npm run e2e
```

The Stremio API is mocked in the browser tests; they never touch a real account.

For the optional-debrid flow, run `node tests/e2e/no-debrid.e2e.mjs` against the preview site (`E2E_SITE` overrides the URL). It checks the last-service warning, cancel/confirm, installation without credentials, and adding a service again. `PLAYWRIGHT_MODULE` can point to an existing `playwright-core/index.mjs` without installing a dependency.

`node tests/e2e/no-debrid-instance.e2e.mjs` checks filtering through a **disposable** local AIOStreams, using synthetic torrent metadata and no media downloads. Start the container above with `ALLOW_PRIVATE_URLS=true` for this test only; the fixture binds to the Docker bridge (`E2E_FIXTURE_HOST`, default `172.17.0.1`). `E2E_AIO` defaults to `http://127.0.0.1:18391`. Add `--live` to also check movie and series searches through the real sources. These checks establish profile creation and stream results, not video playback; discard the test container afterward.

See the [optional-debrid validation report](./docs/no-debrid-validation.md) for the compatibility matrix, live source results and partial video/audio playback probes. Set `E2E_AIO` for `no-debrid.e2e.mjs` to check browser installation against a real AIOStreams too.

## Adding a language

See [docs/languages.md](docs/languages.md#adding-a-language). Before opening a pull request, create the profile on a local AIOStreams and check a few real titles.

## Updating the base profile

`packages/policy/base-config.json` is exported from a working AIOStreams profile:

```sh
node scripts/export-base.mjs < exported-config.json > packages/policy/base-config.json
```

The export strips debrid credentials, TMDB/TVDB keys, custom addon manifests (they can embed keys), owner-only rules and instance ids, and refuses to write anything that still looks like a secret. It is the pt-BR rendering of everything language-specific; `config.language.test.mjs` fails if the pt-BR profile data drifts from it.

## Deploying the site

Cloudflare Pages: build command `node scripts/build-site.mjs`, output directory `dist`, functions from `functions/` (automatic). No environment variables or secrets are needed. Add a rate-limiting rule for `/api/aio` and `/subs/*` in the Cloudflare dashboard.
