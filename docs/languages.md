# Languages

A language profile is one object in [`packages/policy/languages.mjs`](../packages/policy/languages.mjs): the AIOStreams language names, file-name keywords, the regional variant to drop, Torrentio sources, the label texts, and the OpenSubtitles codes and file-name tokens of the subtitles addon. The policy, the profile builder and the subtitles addon read it and contain no language-specific text.

| Id | Language | Quality | Audio counted as "mine" | Extra sources | Labels (own / dual / other) | Subtitle codes |
| --- | --- | --- | --- | --- | --- | --- |
| `pt-BR` | Portuguese (Brazil), default | curated, measured | `Portuguese (Brazil)`, `Portuguese`; keywords pt-br, dublado, dublagem... ; European Portuguese dropped | Torrentio `micoleaodublado`, `comando`, `language=portuguese` | `PT-BR` / `Dual áudio` / `Original` | `pob`, `por` |
| `en` | English | curated | `English`, `Dual Audio`, `Multi`; untagged releases when the title is English or its language is unknown | none (default Torrentio) | `English` / `Dual audio` / `Original` | `eng` |
| `es-419` | Spanish (Latin America) | curated | `Latino`, keyword latam; Castilian-only releases dropped | `cinecalidad`, `language=latino` | `Latino` / `Doble audio` / `Original` | `spa` |
| `es-ES` | Spanish (Spain) | curated | `Spanish`, keyword castellano; Latino-only releases dropped | `mejortorrent`, `wolfmax4k`, `language=spanish` | `Castellano` / `Doble audio` / `Original` | `spa` |
| `fr` | French | curated | `French` (the AIOStreams parser reads VF, VFF, VFI, VF2, TRUEFRENCH, VFQ), keyword `multi` (MULTi means French audio in French release naming); VFQ (Québec) dropped unless also VFF/VF2/TRUEFRENCH; VOSTFR is not French audio | `torrent9`, `language=french` | `Français` / `Multi audio` / `Original` | `fre`, `fra` |
| `it` | Italian | curated | `Italian` (ITA), keywords italiano, doppiato | `ilcorsaronero`, `language=italian` | `Italiano` / `Doppio audio` / `Originale` | `ita` |
| `de` | German | curated | `German`, keywords deutsch, `German DL` (also marks a dual) | `language=german` (Torrentio has no German source) | `Deutsch` / `Dual Language` / `Original` | `ger`, `deu` |
| `ja`, `ko`, `zh`, `ru`, `ar`, `hi`, `nl`... | every other language AIOStreams v2.37.0 knows (41 more, including `pt-PT`) | **basic** | only AIOStreams' own language detection: no keyword list, no extra sources, no file-name dub detection | none | language name / `Dual audio` / `Original` | OpenSubtitles v3 codes |

Only Torrentio providers that exist were used (checked against the AIOStreams v2.37.0 preset and the torrentio-scraper provider list). No profile adds a synced regex or SEL list, so public instances accept every profile.

## Only my language

The setup site has an "Only <language>" switch (`languageOnly: true` in the profile builder). It sets the original-audio count to 0 and drops every release that is not in your language, so uncached originals and anime without a dub disappear too. Titles with no release in your language show nothing.

For English, "your language" means English audio: releases tagged English, dual-audio and multi releases, and untagged releases when the title is English or its original language is unknown (most English releases carry no language tag). The "original" group is the title's own language when it is not English (a Japanese anime, a Korean drama; untagged releases count there); English titles have no original group, and releases in other languages (foreign dubs) are dropped instead of filling the list. So English only for an English title is simply the best English releases.

The title's original language is read from TMDB/TVDB metadata (AIOStreams `originalLanguage`; IMDb and Trakt metadata do not carry it). Without a TMDB key on your profile, and on an instance with no metadata key of its own, it is empty: English then treats untagged releases as English, has no original group, and drops releases tagged with another language, Japanese anime originals included. The site says so next to the English choice. The other profiles only use the original language to rank the original option and for the anime fallback, so they work without it.

## Adding a language

1. Add an entry to `curated` in `languages.mjs` (copy a similar one): AIOStreams audio and subtitle names, only the keywords the AIOStreams parser misses, the regional variant if any, Torrentio providers that exist, labels, OpenSubtitles codes and file-name tokens.
2. `npm test`: `languages.test.mjs` checks the names against AIOStreams, the providers against Torrentio's list, that no text can break an expression, and the expression size limits for every language.
3. Create a profile on a local AIOStreams (see below) before shipping it.

Languages AIOStreams knows but that have no curated entry are already listed as basic; they need no code.

## Quality caveat

Only Portuguese (Brazil) was measured on real titles (102 titles, see below). The other profiles are built with the same method and pass the same structural checks (size limits; a real AIOStreams v2.37.0 accepts every profile built without a TMDB key; the instance validates a fake TMDB key before the expressions, so the TMDB-on shape could not be exercised there), but they have **not been tested on real streams**: keyword lists, sources and the English untagged-release rule are informed guesses. Basic languages depend entirely on AIOStreams' language detection. Subtitles: OpenSubtitles v3 returns one `spa` code for all Spanish, so Latin American and Spain Spanish subtitles are not told apart.

## Real-stream check (2026-11-08)

Ten profiles were run on 9–15 popular titles each against a stock AIOStreams v2.37.0 with a real debrid account (labels judged from file names and AIOStreams tags; no audio inspected). No profile returned an error, an empty list or a wrong title or episode at the top. Known issues:

- `es-ES` showed Latin American "Dual-Lat" releases as Castilian; fixed (`dual-lat` is now a Latino marker). In `es-419` those releases still do not appear; the cause is not yet known.
- `en` and `en-only` label some foreign-original releases as English (for example `RUSSIAN ENSUBS`, `JAPANESE`, foreign dubs), and some untagged files of non-English titles count as English.
- `es-ES` labels the Spanish original audio of Latin American films as `Castellano`.
- In every profile, `Original` means "not my language", so for a film made in another language it can include third-language dubs.

## Subtitles addon routes

`/subs/manifest.json` is Brazilian Portuguese with the same addon id as before (`filmhub.subs`), so existing installs keep working. Every other language is `/subs/<language id>/manifest.json` (id `filmhub.subs.<id>`, name `Dublix Subs <language>`), for example `/subs/es-419/manifest.json`. The site installs the one matching the chosen language and replaces any other Dublix Subs variant. A language without file-name dub tokens (basic) offers subtitles on every file.
