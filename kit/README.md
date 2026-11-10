# Dublix self-host kit

Runs your own Dublix instance: AIOStreams v2.37.0 with the Dublix patches, Dublix Subs and a small gateway that exposes only what Stremio and the setup site need.

What you get over a public instance:

- **Brazilian season packs matched correctly** ("2 temp", "1ª Temporada", "Temp 01 - Epi 03", `SS.EE`), and file names like `1x01 - By Group` repaired (`compat/`). These patches are written for Portuguese (Brazil). They also happen to fix Spanish "Temporada N", "Temp N", "Nª Temporada" and "Episodio N" names; they do nothing for French, German, Italian or other season words ("Saison", "Staffel", "Stagione"...), "Cap." or "2da Temporada". They are harmless for those languages and the rest of the kit (instance, subtitles) works for every language.
- **Your own instance**: your debrid key and profile stay on your machine.
- **Smart subtitles** served by your server, for every language: `/subs/manifest.json` is Brazilian Portuguese, `/subs/<language id>/manifest.json` (for example `/subs/es-419/manifest.json`) the others. The subtitles container mounts the whole `packages/` folder because it reads the language profiles from `packages/policy`.

Verified audio (inspecting real audio tracks to drop files whose name promises Portuguese) is not in the kit yet.

Check your instance with the scripts in [tools/](../tools/README.md): `verify-gateway` (what the gateway exposes), `stream-smoke` (stream lists and, opt-in, playback) and `benchmark` (latency and list stability).

## Requirements

- Docker with Compose.
- An HTTPS address for the server, such as a Cloudflare Tunnel hostname. The setup site and Stremio on your TV both need HTTPS.

## Install

```sh
git clone https://github.com/nicolaseliasx/dublix && cd dublix/kit
cp .env.example .env
sed -i "s/^SECRET_KEY=$/SECRET_KEY=$(openssl rand -hex 32)/" .env
# edit BASE_URL (your HTTPS address) and point your tunnel at http://127.0.0.1:8080
docker compose up -d --build
curl -s http://127.0.0.1:8080/api/v1/status
node ../tools/verify-gateway.mjs   # optional: checks what the gateway exposes
```

Then open the Dublix setup site, choose **My own server**, enter your `BASE_URL`, and install.

## Exposure

The gateway (port `FILMHUB_PORT`, default 8080) serves:

| Path | Purpose |
| --- | --- |
| `/stremio/*` (except `/stremio/configure`) | Your Dublix addon for Stremio |
| `/api/v1/debrid/*`, `/static/*` | Playback redirects to your debrid service |
| `POST /api/v1/user`, `GET /api/v1/status` | Profile creation from the setup site (CORS for `FILMHUB_SITE_ORIGIN` only) |
| `/subs/*` | Dublix Subs (all languages) |

Everything else answers 404, including the AIOStreams configure pages.

Anyone who can reach the gateway can create a profile on your instance: that is how the setup site installs from the browser. The kit limits what such a profile can do:

- `ALLOW_PRIVATE_URLS=false`: the instance never connects to private, loopback or link-local addresses, so a profile cannot reach your home network.
- Regex filters and synced expression lists are limited to the lists the Dublix profile uses (`REGEX_FILTER_ACCESS=trusted`, `SEL_SYNC_ACCESS=trusted` with explicit allow-lists in `compose.yaml`).
- Profile creation is rate limited at the gateway (10 per minute, burst 5). Behind a tunnel all visitors share this limit.

Do not put the hostname behind a login page (such as Cloudflare Access): Stremio on your TV cannot pass it.

## Notes

- If a future base profile syncs a new list, add its URL to the allow-lists in `compose.yaml`; otherwise the instance refuses the profile.
- After editing `gateway/`, recreate it: `docker compose up -d --force-recreate gateway` (a reload keeps the old file).
- The patches check the hash of the AIOStreams files they modify and fail the build if upstream changed; a new AIOStreams version needs a reviewed kit release.
- Run the patch tests with `node --test compat/test/` from this folder.
