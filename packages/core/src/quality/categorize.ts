// Sorts custom formats into kinds (language, audio, video codec, HDR, ...).
// People name their formats in many ways: "Language: German" in a hand-made
// set, "German DL" or "TrueHD ATMOS" from the TRaSH Guides. A prefix before a
// colon wins; otherwise the conditions and keywords in the name decide.
import type { FormatCategory } from './types.js';

const PREFIXES: Array<[RegExp, FormatCategory]> = [
  [/^(audio|sound|ton)$/, 'audio'],
  [/^(codec|video|video codec|encode)$/, 'video'],
  [/^(hdr|dv|dynamic range)$/, 'hdr'],
  [/^(lang|language|languages|sprache|audio language)$/, 'language'],
  [/^(source|sources|quelle|streaming|service)$/, 'source'],
  [/^(reject|rejects|unwanted|block|blocked|avoid|bad|ban)$/, 'unwanted'],
  [/^(sub|subs|subtitle|subtitles|untertitel)$/, 'subtitles'],
  [/^(group|groups|release group|tier|tiers)$/, 'group'],
];

/** Short names of streaming services, matched as the whole name. */
const SERVICES =
  /^(amzn|nf|atvp|dsnp|hmax|max|hulu|pcok|pmtp|crav|stan|it|ma|nlz|vdl|cr|funi|hidive|hbo|sho|roku|aubc|bcore|crit|ds4k|play|ip|all4|my5|now|ovid|qibi|red|tving|vrv|wavve|jfflix|dscp)$/;

const B = '(?:^|[^a-z0-9])';
const E = '(?:[^a-z0-9]|$)';
const word = (alternatives: string) => new RegExp(`${B}(?:${alternatives})${E}`);

const KEYWORDS: Array<[RegExp, FormatCategory]> = [
  [word('repack\\d?|proper|rerip|real'), 'fix'],
  [word('subs?|subbed|subtitles?|untertitel|vostfr|hardsubs?|softsubs?'), 'subtitles'],
  [word('hdr\\d*\\+?|hdr10\\+?|hdr10plus|dv|dovi|dolby ?vision|hlg|pq|sdr'), 'hdr'],
  [
    word(
      'atmos|dts(?:-?hd(?: ?ma)?|-?x|:x|-?es)?|truehd|true ?hd|aac|e?-?ac-?3|ddp?\\+?|dd\\+|flac|l?pcm|opus|mp3|lossless|audio|surround|[257]\\.[01]',
    ),
    'audio',
  ],
  [word('x26[45]|h\\.?26[45]|hevc|avc|av1|vp9|xvid|divx|10[ -]?bit|codec|mpeg-?2|vc-?1'), 'video'],
  [word('tiers?|groups?|hq|lq|scene|internal'), 'group'],
  [word('remux|blu-?ray|bd|web-?dl|web-?rip|web|hdtv|dvd|imax|streaming|source'), 'source'],
  [
    word(
      'german|english|french|spanish|italian|japanese|korean|chinese|dutch|nordic|polish|russian|hindi|portuguese|swedish|danish|norwegian|finnish|turkish|dual(?:[ -]?(?:audio|language))?|multi|original|language|deutsch|vo|vf|vff',
    ),
    'language',
  ],
];

const ONLY: Array<[string, FormatCategory]> = [
  ['LanguageSpecification', 'language'],
  ['ReleaseGroupSpecification', 'group'],
  ['SourceSpecification', 'source'],
];

/**
 * The kind of a custom format. `bestScore` is the highest score the format
 * has in any quality profile: a format that only ever costs points is
 * "unwanted" unless its name says otherwise.
 */
export function categorizeFormat(name: string, specs: string[], bestScore: number): FormatCategory {
  const lower = name.toLowerCase().trim();
  const colon = lower.indexOf(':');
  if (colon > 0) {
    const prefix = lower.slice(0, colon).trim();
    for (const [re, category] of PREFIXES) if (re.test(prefix)) return category;
  }
  if (bestScore <= 0) return 'unwanted';
  if (SERVICES.test(lower)) return 'source';
  if (specs.length > 0)
    for (const [impl, category] of ONLY) if (specs.every((s) => s === impl)) return category;
  for (const [re, category] of KEYWORDS) if (re.test(lower)) return category;
  return 'other';
}
