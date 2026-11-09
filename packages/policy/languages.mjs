// Language profiles: everything that differs between "Portuguese (Brazil) first", "English first", and so on, as data.
// The policy (policy.mjs), the profile builder (config.mjs) and the subtitles addon (packages/subs) read these objects and
// contain no language-specific text of their own. Pure data and two lookups; runs in Node, in the browser and in a Worker.
//
// Fields
//   id, name        route/option id (also the Filmhub Subs URL segment) and the English display name
//   quality         'curated': keywords, sources and subtitle tokens were chosen for this language.
//                   'basic': only AIOStreams' own language detection (no keyword list, no extra sources).
//   audio           AIOStreams audio language names that count as "my language", preferred first. Must be names from
//                   AIOSTREAMS_LANGUAGES (it validates the profile's preferredLanguages).
//   keywords        file-name words that show the language when the file's audio tracks were not probed. Only words the
//                   AIOStreams parser does not already detect belong here (it knows vff, vf2, truefrench, latino, ita, ger...).
//   dualKeywords    file-name words that, together with "my language", mark a release with several audio tracks.
//   subtitles       AIOStreams subtitle language names preferred for "embedded subtitles in my language".
//   exclude         releases of a regional variant of the language that would be mislabelled "Original":
//                   { keywords, unless } drops releases with those words unless they also carry one of the `unless` words.
//   unknownIsMine   untagged releases (AIOStreams reports language 'Unknown') count as my language when the title's original
//                   language is this one or unknown. English only: most English releases carry no language tag.
//   originalFromQuery  the "original" group is the title's own original language when that is not this one, instead of "anything
//                   that is not my language". English only: otherwise an English title would fill the original slots with dubs.
//   torrentio       extra Torrentio sources for this language (providers that exist in Torrentio, or its `language=` priority).
//   labels          the texts shown on each stream: my-language audio, several audio tracks incl. mine, and other audio.
//   tag             short name used inside the generated rules' comments (the pt-BR rules keep their historical `PT-BR`).
//   subs            Filmhub Subs: OpenSubtitles v3 codes (first one with results wins) and the file-name classifier tokens.
//                   `dub` words mean "this file has my language's audio"; `alone` requires no other language word next to it;
//                   `dual` makes a DUAL release count as mine (`bare`: also when it names no other language).
//                   `other` replaces the default list of foreign-language words used by `alone` and `bare`.

/** Language names AIOStreams v2.37.0 knows (packages/core/src/utils/language-list.ts), without its pseudo languages. */
export const AIOSTREAMS_LANGUAGES = ['English', 'Japanese', 'Chinese', 'Russian', 'Arabic', 'Portuguese', 'Portuguese (Brazil)', 'Spanish',
  'French', 'German', 'Italian', 'Korean', 'Hindi', 'Bengali', 'Punjabi', 'Marathi', 'Gujarati', 'Tamil', 'Telugu', 'Kannada', 'Malayalam',
  'Thai', 'Vietnamese', 'Indonesian', 'Turkish', 'Hebrew', 'Persian', 'Ukrainian', 'Greek', 'Lithuanian', 'Latvian', 'Estonian', 'Polish',
  'Czech', 'Slovak', 'Hungarian', 'Romanian', 'Bulgarian', 'Serbian', 'Croatian', 'Slovenian', 'Dutch', 'Danish', 'Finnish', 'Swedish',
  'Norwegian', 'Malay', 'Latino'];
/** Pseudo languages AIOStreams also accepts in preferred-language lists. */
export const AIOSTREAMS_PSEUDO_LANGUAGES = ['Dual Audio', 'Dubbed', 'Multi', 'Original', 'Unknown'];

export const DEFAULT_LANGUAGE = 'pt-BR';

const curated = {
  'pt-BR': {
    name: 'Portuguese (Brazil)',
    audio: ['Portuguese (Brazil)', 'Portuguese'],
    keywords: ['pt-br', 'ptbr', 'brazilian', 'brasileiro', 'brasileira', 'dublado', 'dublada', 'dublagem'],
    dualKeywords: ['dual', 'multi'],
    subtitles: ['Portuguese (Brazil)'],
    // Plain 'Portuguese' is ambiguous; it counts as probable PT-BR only because releases marked European Portuguese are dropped.
    exclude: { keywords: ['pt-pt', 'pt_pt', 'portuguese portugal', 'português de portugal', 'portugues de portugal', 'european portuguese', 'portugal dub'], unless: [] },
    torrentio: [
      { id: 'filmhub-regular-show-ptbr', name: 'Filmhub Regular Show PT-BR', language: 'portuguese', mediaTypes: ['series'] },
      { id: 'filmhub-ptbr', name: 'Filmhub PT-BR Sources', providers: ['micoleaodublado'], mediaTypes: ['movie', 'series'] },
      { id: 'filmhub-ptbr-verified', name: 'Filmhub PT-BR Comando', providers: ['comando'], mediaTypes: ['movie', 'series'] },
    ],
    labels: { dubbed: 'PT-BR', dual: 'Dual áudio', original: 'Original' },
    subs: { name: 'Brazilian Portuguese', codes: ['pob', 'por'], dub: 'dublad[oa]|dublagem|pt-?br|brazilian|brasileir[oa]', dual: { token: 'pt', bare: true } },
  },
  en: {
    name: 'English',
    // 'Dual Audio' (anime: Japanese + English) and 'Multi' releases carry an English track.
    audio: ['English', 'Dual Audio', 'Multi'],
    keywords: [],
    dualKeywords: ['dual', 'multi'],
    subtitles: ['English'],
    exclude: null,
    unknownIsMine: true,
    originalFromQuery: true,
    torrentio: [],
    labels: { dubbed: 'English', dual: 'Dual audio', original: 'Original' },
    subs: { name: 'English', codes: ['eng'], dub: 'english|eng', alone: true,
      other: 'jap|jpn|japanese|fre|french|vff|vf2|vfq|vfi|truefrench|ger|german|deu|spa|spanish|latino|castellano|ita|italian|rus|russian|hin|hindi|kor|korean|chi|chinese|por|portuguese|dublado|ara|arabic|tur|turkish|pol|polish|multi' },
  },
  'es-419': {
    name: 'Spanish (Latin America)',
    // Only releases AIOStreams tags 'Latino'. Plain 'Spanish' is mostly Castilian in release names, so it is not counted.
    audio: ['Latino'],
    // "Dual-Lat" (Spanish Latino + original) is common in Latin American release names; AIOStreams tags it plain Spanish.
    keywords: ['latam', 'dual-lat'],
    dualKeywords: ['dual', 'multi'],
    subtitles: ['Latino', 'Spanish'],
    exclude: { keywords: ['castellano', 'espanol de espana', 'español de españa'], unless: ['latino', 'latam', 'dual-lat'] },
    torrentio: [
      { id: 'filmhub-es419-language', name: 'Filmhub Latino', language: 'latino', mediaTypes: ['series'] },
      { id: 'filmhub-es419', name: 'Filmhub Latino Sources', providers: ['cinecalidad'], mediaTypes: ['movie', 'series'] },
    ],
    labels: { dubbed: 'Latino', dual: 'Doble audio', original: 'Original' },
    subs: { name: 'Spanish', codes: ['spa'], dub: 'latino|latam|dual-lat' },
  },
  'es-ES': {
    name: 'Spanish (Spain)',
    audio: ['Spanish'],
    keywords: ['castellano'],
    dualKeywords: ['dual', 'multi'],
    subtitles: ['Spanish'],
    // Lat-Cast releases carry both Spanish dubs, so they stay.
    exclude: { keywords: ['latino', 'latam', 'dual-lat'], unless: ['castellano', 'lat-cast'] },
    torrentio: [
      { id: 'filmhub-eses-language', name: 'Filmhub Castellano', language: 'spanish', mediaTypes: ['series'] },
      { id: 'filmhub-eses', name: 'Filmhub Castellano Sources', providers: ['mejortorrent', 'wolfmax4k'], mediaTypes: ['movie', 'series'] },
    ],
    labels: { dubbed: 'Castellano', dual: 'Doble audio', original: 'Original' },
    subs: { name: 'Spanish', codes: ['spa'], dub: 'castellano|spanish|spa|espanol' },
  },
  fr: {
    name: 'French',
    // In French release naming MULTi means several audio tracks including French; the parser already reads VF, VFF, VFI, VF2,
    // TRUEFRENCH and VFQ as French. VOSTFR (original audio, French subtitles) is not French audio and never matches.
    audio: ['French'],
    keywords: ['multi'],
    dualKeywords: ['dual', 'multi'],
    subtitles: ['French'],
    // VFQ is the Québec dub.
    exclude: { keywords: ['vfq'], unless: ['vff', 'vf2', 'truefrench'] },
    torrentio: [
      { id: 'filmhub-fr-language', name: 'Filmhub French', language: 'french', mediaTypes: ['series'] },
      { id: 'filmhub-fr', name: 'Filmhub French Sources', providers: ['torrent9'], mediaTypes: ['movie', 'series'] },
    ],
    labels: { dubbed: 'Français', dual: 'Multi audio', original: 'Original' },
    subs: { name: 'French', codes: ['fre', 'fra'], dub: 'french|francais|vff|vf2|vfi|vfq|vf|truefrench|multi' },
  },
  it: {
    name: 'Italian',
    audio: ['Italian'],
    keywords: ['italiano', 'doppiato'],
    dualKeywords: ['dual', 'multi'],
    subtitles: ['Italian'],
    exclude: null,
    torrentio: [
      { id: 'filmhub-it-language', name: 'Filmhub Italian', language: 'italian', mediaTypes: ['series'] },
      { id: 'filmhub-it', name: 'Filmhub Italian Sources', providers: ['ilcorsaronero'], mediaTypes: ['movie', 'series'] },
    ],
    labels: { dubbed: 'Italiano', dual: 'Doppio audio', original: 'Originale' },
    subs: { name: 'Italian', codes: ['ita'], dub: 'ita|italian|italiano|doppiato' },
  },
  de: {
    name: 'German',
    // German releases write German.DL (dual language: German plus the original track). A bare DL is also WEB-DL, so only the pair counts.
    audio: ['German'],
    keywords: ['deutsch', 'german dl'],
    dualKeywords: ['dual', 'multi', 'german dl'],
    subtitles: ['German'],
    exclude: null,
    // Torrentio has no German-specific source: only its `language=german` priority.
    torrentio: [{ id: 'filmhub-de-language', name: 'Filmhub German', language: 'german', mediaTypes: ['series'] }],
    labels: { dubbed: 'Deutsch', dual: 'Dual Language', original: 'Original' },
    subs: { name: 'German', codes: ['ger', 'deu'], dub: 'german|deutsch|ger|deu' },
  },
};

// Every other AIOStreams language: detection only. [AIOStreams name, id, OpenSubtitles v3 codes (first with results wins)].
// OpenSubtitles v3 mixes ISO 639-2/B and /T codes (fre, ger, cze next to nld, ron, ell): both forms are listed when they differ.
// Codes seen in real responses: ara bul cze dan ell eng est fin fre ger heb hrv hun ind ita jpn kor nld per pob pol por ron rus slo slv
// spa srp swe tur vie ben may mal zho zht. The rest follow ISO 639-2 and were not observed.
const basic = [
  ['Japanese', 'ja', ['jpn']], ['Chinese', 'zh', ['zho', 'zht', 'chi']], ['Russian', 'ru', ['rus']], ['Arabic', 'ar', ['ara']],
  ['Portuguese', 'pt-PT', ['por']], ['Korean', 'ko', ['kor']], ['Hindi', 'hi', ['hin']], ['Bengali', 'bn', ['ben']],
  ['Punjabi', 'pa', ['pan']], ['Marathi', 'mr', ['mar']], ['Gujarati', 'gu', ['guj']], ['Tamil', 'ta', ['tam']],
  ['Telugu', 'te', ['tel']], ['Kannada', 'kn', ['kan']], ['Malayalam', 'ml', ['mal']], ['Thai', 'th', ['tha']],
  ['Vietnamese', 'vi', ['vie']], ['Indonesian', 'id', ['ind']], ['Turkish', 'tr', ['tur']], ['Hebrew', 'he', ['heb']],
  ['Persian', 'fa', ['per', 'fas']], ['Ukrainian', 'uk', ['ukr']], ['Greek', 'el', ['ell', 'gre']], ['Lithuanian', 'lt', ['lit']],
  ['Latvian', 'lv', ['lav']], ['Estonian', 'et', ['est']], ['Polish', 'pl', ['pol']], ['Czech', 'cs', ['cze', 'ces']],
  ['Slovak', 'sk', ['slo', 'slk']], ['Hungarian', 'hu', ['hun']], ['Romanian', 'ro', ['ron', 'rum']], ['Bulgarian', 'bg', ['bul']],
  ['Serbian', 'sr', ['srp']], ['Croatian', 'hr', ['hrv']], ['Slovenian', 'sl', ['slv']], ['Dutch', 'nl', ['nld', 'dut']],
  ['Danish', 'da', ['dan']], ['Finnish', 'fi', ['fin']], ['Swedish', 'sv', ['swe']], ['Norwegian', 'no', ['nor']], ['Malay', 'ms', ['may', 'msa']],
];

const LANGUAGES = new Map();
for (const [id, p] of Object.entries(curated)) LANGUAGES.set(id, { id, quality: 'curated', tag: id.toUpperCase(), ...p });
for (const [name, id, codes] of basic) {
  LANGUAGES.set(id, {
    id, name: id === 'pt-PT' ? 'Portuguese (Portugal)' : name, quality: 'basic', tag: id.toUpperCase(),
    audio: [name], keywords: [], dualKeywords: ['dual', 'multi'], subtitles: [name], exclude: null, torrentio: [],
    labels: { dubbed: id === 'pt-PT' ? 'Português' : name, dual: 'Dual audio', original: 'Original' },
    subs: { name: id === 'pt-PT' ? 'European Portuguese' : name, codes, dub: null },
  });
}

/** The profile for a language id ('pt-BR', 'en', 'es-419', ...). Throws on an unknown id. */
export function getLanguage(id = DEFAULT_LANGUAGE) {
  const language = LANGUAGES.get(id);
  if (!language) throw new TypeError(`unknown language: ${typeof id === 'string' ? id.slice(0, 20) : typeof id}`);
  return language;
}
export const hasLanguage = (id) => typeof id === 'string' && LANGUAGES.has(id);

/** Choices for a language selector: curated profiles first (in the order above), then the basic ones by name. */
export function languageList() {
  const all = [...LANGUAGES.values()].map(({ id, name, quality }) => ({ id, name, quality }));
  return [...all.filter((l) => l.quality === 'curated'), ...all.filter((l) => l.quality === 'basic').sort((a, b) => a.name.localeCompare(b.name))];
}

/** preferredLanguages / preferredSubtitles for the AIOStreams sort: my language first, then English and the generic tags. */
export const preferredLanguages = (l) => [...new Set([...l.audio, 'English', 'Dual Audio', 'Multi', 'Dubbed', 'Original', 'Unknown'])];
export const preferredSubtitles = (l) => [...new Set([...l.subtitles, 'English'])];

/** The audio language names a probed audio track can carry for this profile (no pseudo languages), sorted. */
export const realAudio = (l) => l.audio.filter((name) => !AIOSTREAMS_PSEUDO_LANGUAGES.includes(name)).sort();
