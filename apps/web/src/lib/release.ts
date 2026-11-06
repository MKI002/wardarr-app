// Turns a release name like "Show.Name.S02E01.1080p.WEB.H264-GRP" into
// something a person reads: title, episode and a few quality tags.

export interface ParsedRelease {
  title: string;
  episode?: string;
  year?: string;
  tags: string[];
}

const RESOLUTION = /^(2160p|1080p|720p|576p|480p|4k|uhd)$/i;
const SOURCE = /^(web|web-?dl|webrip|bluray|blu-ray|bdrip|brrip|hdtv|remux|dvdrip)$/i;
const CODEC = /^(h\.?264|h\.?265|x264|x265|hevc|av1|xvid)$/i;
const EPISODE = /^s(\d{1,2})(?:e(\d{1,3}))?$/i;
const YEAR = /^(19|20)\d{2}$/;

const TAG_NAMES: Record<string, string> = { '4k': '4K', uhd: '4K', '2160p': '4K' };

export function parseRelease(name: string): ParsedRelease {
  const clean = name.replace(/\.(mkv|mp4|avi|m4v|ts)$/i, '');
  // Drop a trailing release group ("-GRP").
  const tokens = clean
    .split(/[.\s_]+/)
    .map((t, i, all) => (i === all.length - 1 ? t.replace(/-[^-]+$/, '') : t));
  let end = tokens.findIndex(
    (t, i) =>
      i > 0 && (EPISODE.test(t) || YEAR.test(t) || RESOLUTION.test(t) || SOURCE.test(t) || CODEC.test(t)),
  );
  if (end < 0) end = tokens.length;
  const title = tokens.slice(0, end).join(' ').trim();
  if (!title || end === tokens.length) return { title: name, tags: [] };

  const out: ParsedRelease = { title, tags: [] };
  for (const t of tokens.slice(end)) {
    const ep = EPISODE.exec(t);
    if (ep && !out.episode) {
      const s = ep[1]!.padStart(2, '0');
      out.episode = ep[2] ? `S${s}E${ep[2].padStart(2, '0')}` : `S${s}`;
    } else if (YEAR.test(t) && !out.year) out.year = t;
    else if (RESOLUTION.test(t) || SOURCE.test(t) || CODEC.test(t)) {
      const tag = TAG_NAMES[t.toLowerCase()] ?? (RESOLUTION.test(t) ? t.toLowerCase() : t);
      if (!out.tags.includes(tag)) out.tags.push(tag);
    }
  }
  out.tags = out.tags.slice(0, 3);
  return out;
}
