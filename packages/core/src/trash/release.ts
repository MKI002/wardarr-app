// Release test: which custom formats match a release name and which score
// it gets in a profile. The instance parses the name itself, so the result
// matches what Sonarr or Radarr would decide.
import type { ArrParseResult, ArrQualityProfile } from './types.js';

export interface ReleaseScore {
  formats: Array<{ id: number; name: string; score: number }>;
  total: number;
  /** The release reaches the profile's minimum score. */
  accepted: boolean;
  /** The release reaches the cutoff score, so no further upgrades. */
  meetsCutoff: boolean;
}

export function releaseScore(parsed: ArrParseResult, profile: ArrQualityProfile): ReleaseScore {
  const scores = new Map(profile.formatItems.map((f) => [f.format, f.score]));
  const formats = parsed.customFormats
    .map((f) => ({ id: f.id, name: f.name, score: scores.get(f.id) ?? 0 }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const total = formats.reduce((sum, f) => sum + f.score, 0);
  return {
    formats,
    total,
    accepted: total >= (profile.minFormatScore ?? 0),
    meetsCutoff: total >= (profile.cutoffFormatScore ?? 0),
  };
}
