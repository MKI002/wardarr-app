// File extensions the gatekeeper keeps out: normalising, presets, matching
// and reading the extensions out of the messages services write.

/** `.EXE ` -> `exe`. Returns null for anything that is not a plain extension. */
export function normalizeExtension(input: string): string | null {
  const ext = input
    .trim()
    .toLowerCase()
    .replace(/^\*?\.+/, '');
  return /^[a-z0-9][a-z0-9_-]{0,15}$/.test(ext) ? ext : null;
}

/** A comma, space or newline separated list as typed by a person. */
export function parseExtensionList(input: string): string[] {
  return uniqueExtensions(input.split(/[\s,;]+/));
}

/** Normalised, without duplicates, sorted. */
export function uniqueExtensions(list: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const item of list) {
    const ext = normalizeExtension(item);
    if (ext) out.add(ext);
  }
  return [...out].sort();
}

export interface ExtensionPreset {
  id: 'executables' | 'scripts' | 'archives' | 'images';
  extensions: readonly string[];
  /** Extensions that also turn up in real releases; the page warns before adding them. */
  caution?: boolean;
}

/** Ready-made lists. Names and help texts live in i18n (`gatekeeper.presets.<id>`). */
export const EXTENSION_PRESETS: readonly ExtensionPreset[] = [
  { id: 'executables', extensions: ['exe', 'com', 'scr', 'msi', 'pif', 'cpl', 'jar', 'app', 'apk'] },
  {
    id: 'scripts',
    extensions: ['bat', 'cmd', 'ps1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'hta', 'reg', 'lnk', 'url', 'sh'],
  },
  { id: 'archives', extensions: ['arj', 'lzh', 'zipx', 'ace', 'cab', 'uue'] },
  { id: 'images', extensions: ['iso', 'img', 'dmg', 'vhd', 'vhdx'], caution: true },
];

/** What Wardarr suggests when nothing is set yet: everything but disc images. */
export const DEFAULT_EXTENSIONS: readonly string[] = uniqueExtensions(
  EXTENSION_PRESETS.filter((p) => !p.caution).flatMap((p) => p.extensions),
);

/**
 * The fixed groups Sonarr v4 and Radarr check at import (FileExtensions.cs).
 * They can only be switched on per indexer, not edited.
 */
export const ARR_EXTENSION_GROUPS = {
  executables: ['bat', 'cmd', 'exe', 'sh'],
  dangerous: ['arj', 'lnk', 'lzh', 'ps1', 'scr', 'vbs', 'zipx'],
} as const satisfies Record<string, readonly string[]>;

export type ArrExtensionGroup = keyof typeof ARR_EXTENSION_GROUPS;

/** The groups an *arr app needs to switch on to cover some of `wanted`. */
export function arrGroupsFor(wanted: readonly string[]): ArrExtensionGroup[] {
  const set = new Set(wanted);
  return (Object.keys(ARR_EXTENSION_GROUPS) as ArrExtensionGroup[]).filter((g) =>
    ARR_EXTENSION_GROUPS[g].some((e) => set.has(e)),
  );
}

/** Extensions covered by the given groups. */
export function arrGroupExtensions(groups: readonly ArrExtensionGroup[]): string[] {
  return uniqueExtensions(groups.flatMap((g) => ARR_EXTENSION_GROUPS[g]));
}

/** The extension of a file name inside a download (`Show/x.EXE` -> `exe`). */
export function extensionOf(fileName: string): string | null {
  const base = fileName.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return null;
  return normalizeExtension(base.slice(dot + 1));
}

/** A qBittorrent style wildcard pattern (`*.exe`, `sample*`) as a regular expression. */
export function wildcardToRegExp(pattern: string): RegExp {
  const body = pattern
    .trim()
    .split('')
    .map((c) => (c === '*' ? '.*' : c === '?' ? '.' : c.replace(/[.+^${}()|[\]\\]/g, '\\$&')))
    .join('');
  return new RegExp(`^${body}$`, 'i');
}

/** The qBittorrent pattern for one extension. */
export const extensionPattern = (ext: string): string => `*.${ext}`;

/** The extension a qBittorrent pattern stands for, if it is a plain `*.ext`. */
export function patternExtension(pattern: string): string | null {
  const m = /^\*\.([^*?/\\]+)$/.exec(pattern.trim());
  return m ? normalizeExtension(m[1]!) : null;
}

/** Why a message says a download was kept out, if it says so. */
export type BlockReason = 'executable' | 'dangerous' | 'userDefined' | 'unwanted';

export interface BlockMessage {
  reason: BlockReason;
  extensions: string[];
}

const MESSAGE_RULES: Array<[RegExp, BlockReason]> = [
  [/found executable file/i, 'executable'],
  [/found potentially dangerous file/i, 'dangerous'],
  [/user defined rejected extension/i, 'userDefined'],
  [/unwanted extension/i, 'unwanted'],
];

/**
 * Reads messages like Sonarr's "Caution: Found executable file with
 * extension: '.exe'" or SABnzbd's "Aborted, unwanted extension detected".
 * Returns null for messages about anything else.
 */
export function parseBlockMessage(message: string | null | undefined): BlockMessage | null {
  if (!message) return null;
  const rule = MESSAGE_RULES.find(([re]) => re.test(message));
  if (!rule) return null;
  const extensions = uniqueExtensions(
    [...message.matchAll(/extension:?\s*'?\.?([A-Za-z0-9_-]{1,16})'?/gi)]
      .map((m) => m[1]!)
      .filter((e) => !/^detected$/i.test(e)),
  );
  return { reason: rule[1], extensions };
}
