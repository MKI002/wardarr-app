// Plain names for what a media file contains. Sonarr and Radarr report codecs
// and HDR types in their own spelling ("EAC3 Atmos", "DV HDR10Plus", "x265");
// these fold them into the few groups a chart can show.

export function videoGroup(codec: string | null): string {
  const c = (codec ?? '').toLowerCase();
  if (!c) return 'unknown';
  if (/265|hevc/.test(c)) return 'HEVC';
  if (/264|avc/.test(c)) return 'AVC';
  if (/av1/.test(c)) return 'AV1';
  if (/vp9/.test(c)) return 'VP9';
  if (/xvid|divx|mpeg-?4|mp4v/.test(c)) return 'MPEG-4';
  if (/mpeg-?2|mpeg2/.test(c)) return 'MPEG-2';
  if (/vc-?1|wmv/.test(c)) return 'VC-1';
  return codec!.trim();
}

export function hdrGroup(type: string | null): string {
  const t = (type ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t || t === 'sdr') return 'SDR';
  if (/\bdv\b|dovi|dolby/.test(t)) return 'Dolby Vision';
  if (/hdr10plus|hdr10\+/.test(t)) return 'HDR10+';
  if (/hdr10/.test(t)) return 'HDR10';
  if (/hlg/.test(t)) return 'HLG';
  if (/pq/.test(t)) return 'PQ';
  if (/hdr/.test(t)) return 'HDR';
  return type!.trim();
}

export function audioGroup(codec: string | null): string {
  const c = (codec ?? '').toLowerCase();
  if (!c) return 'unknown';
  const atmos = /atmos/.test(c);
  if (/truehd/.test(c)) return atmos ? 'TrueHD Atmos' : 'TrueHD';
  if (/dts[- ]?x/.test(c)) return 'DTS:X';
  if (/dts-?hd ?ma|dts-?ma/.test(c)) return 'DTS-HD MA';
  if (/dts/.test(c)) return 'DTS';
  if (/eac3|e-ac-3|ddp|dd\+/.test(c)) return atmos ? 'DD+ Atmos' : 'DD+';
  if (/ac-?3|dd\b/.test(c)) return 'DD';
  if (/aac/.test(c)) return 'AAC';
  if (/flac/.test(c)) return 'FLAC';
  if (/pcm/.test(c)) return 'PCM';
  if (/opus/.test(c)) return 'Opus';
  if (/mp3|mpeg audio/.test(c)) return 'MP3';
  return codec!.trim();
}

export function channelGroup(channels: number | null): string {
  if (channels === null || !Number.isFinite(channels) || channels <= 0) return 'unknown';
  if (channels >= 7) return '7.1';
  if (channels >= 5) return '5.1';
  if (channels >= 2) return '2.0';
  return '1.0';
}

export function resolutionGroup(resolution: number | null): string {
  if (!resolution) return 'unknown';
  if (resolution >= 2000) return '2160p';
  if (resolution >= 1000) return '1080p';
  if (resolution >= 700) return '720p';
  return 'SD';
}

export function sourceGroup(quality: string | null): string {
  const q = (quality ?? '').toLowerCase();
  if (!q) return 'unknown';
  if (/remux/.test(q)) return 'Remux';
  if (/bluray|br-?disk/.test(q)) return 'Blu-ray';
  if (/webdl|web-dl/.test(q)) return 'WEB-DL';
  if (/webrip|web-rip/.test(q)) return 'WEBRip';
  if (/web/.test(q)) return 'WEB';
  if (/hdtv|sdtv|tv/.test(q)) return 'TV';
  if (/dvd/.test(q)) return 'DVD';
  return 'other';
}

/** ISO 639-2 (bibliographic and terminology) to ISO 639-1, for the common ones. */
const ISO2: Record<string, string> = {
  eng: 'en',
  ger: 'de',
  deu: 'de',
  fre: 'fr',
  fra: 'fr',
  spa: 'es',
  ita: 'it',
  jpn: 'ja',
  kor: 'ko',
  chi: 'zh',
  zho: 'zh',
  rus: 'ru',
  por: 'pt',
  dut: 'nl',
  nld: 'nl',
  swe: 'sv',
  nor: 'no',
  nob: 'nb',
  nno: 'nn',
  dan: 'da',
  fin: 'fi',
  pol: 'pl',
  cze: 'cs',
  ces: 'cs',
  hun: 'hu',
  tur: 'tr',
  ara: 'ar',
  heb: 'he',
  hin: 'hi',
  tha: 'th',
  vie: 'vi',
  ukr: 'uk',
  gre: 'el',
  ell: 'el',
  rum: 'ro',
  ron: 'ro',
  ind: 'id',
  may: 'ms',
  msa: 'ms',
  ice: 'is',
  isl: 'is',
  hrv: 'hr',
  srp: 'sr',
  slo: 'sk',
  slk: 'sk',
  slv: 'sl',
  bul: 'bg',
  cat: 'ca',
  est: 'et',
  lav: 'lv',
  lit: 'lt',
  per: 'fa',
  fas: 'fa',
  tam: 'ta',
  tel: 'te',
  fil: 'fil',
  tgl: 'tl',
};

/**
 * Language codes from a media info string or list ("eng/ger", "English").
 * Codes become ISO 639-1 where one exists, so the page can name them in the
 * reader's language; unknown entries become `und`.
 */
export function languageCodes(value: unknown): string[] {
  const parts = Array.isArray(value)
    ? value.map(String)
    : typeof value === 'string'
      ? value.split(/[/,|]/)
      : [];
  const out = new Set<string>();
  for (const raw of parts) {
    const p = raw.trim().toLowerCase();
    if (!p) continue;
    if (/^[a-z]{2}$/.test(p)) out.add(p);
    else if (/^[a-z]{3}$/.test(p)) out.add(ISO2[p] ?? (p === 'und' || p === 'mis' ? 'und' : p));
    else out.add('und');
  }
  return [...out];
}
