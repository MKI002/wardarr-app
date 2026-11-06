// Where the TRaSH Guides JSON comes from. By default Wardarr reads the
// official repository on GitHub: one API call finds the latest commit, a
// second lists its files, and only files whose content changed are
// downloaded. A local checkout can be used instead (WARDARR_TRASH_DIR), for
// installations without internet access.
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { TRASH_PRODUCTS, type TrashProduct } from '@wardarr/core';

export const DEFAULT_REPO = 'TRaSH-Guides/Guides';
export const DEFAULT_BRANCH = 'master';
export const REPO_PATTERN = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
export const BRANCH_PATTERN = /^[A-Za-z0-9._/-]{1,100}$/;

/** Folder names Wardarr stores files under, by metadata.json key. */
const FOLDERS: Record<string, string> = {
  custom_formats: 'cf',
  custom_format_groups: 'cf-groups',
  quality_profiles: 'quality-profiles',
  quality_profile_groups: 'quality-profile-groups',
  qualities: 'quality-size',
  naming: 'naming',
  conflicts: '',
};

/** Paths used when metadata.json is missing or unreadable. */
const DEFAULT_PATHS = (product: TrashProduct): Record<string, string[]> => ({
  custom_formats: [`docs/json/${product}/cf`],
  custom_format_groups: [`docs/json/${product}/cf-groups`],
  quality_profiles: [`docs/json/${product}/quality-profiles`],
  quality_profile_groups: [`docs/json/${product}/quality-profile-groups`],
  qualities: [`docs/json/${product}/quality-size`],
  naming: [`docs/json/${product}/naming`],
  conflicts: [`docs/json/${product}/conflicts.json`],
});

export interface RemoteFile {
  /** Path in the source repository. */
  sourcePath: string;
  /** Path Wardarr stores it under: `radarr/cf/x.json`. */
  path: string;
  sha: string;
}

export interface GuideListing {
  /** Commit id or content hash of the guide version. */
  version: string;
  /** Commit date, when known. */
  date: string | null;
  files: RemoteFile[];
}

export interface GuideSource {
  readonly label: string;
  list(): Promise<GuideListing>;
  read(file: RemoteFile, version: string): Promise<unknown>;
}

type Metadata = { json_paths?: Partial<Record<TrashProduct, Record<string, string[]>>> };

/** Maps source paths to stored paths, using the folders of metadata.json. */
export function mapFiles(meta: Metadata | null, all: Array<{ path: string; sha: string }>): RemoteFile[] {
  const out: RemoteFile[] = [];
  for (const product of TRASH_PRODUCTS) {
    const paths = meta?.json_paths?.[product] ?? DEFAULT_PATHS(product);
    for (const [key, dirs] of Object.entries(paths)) {
      const folder = FOLDERS[key];
      if (folder === undefined) continue;
      for (const dir of dirs ?? []) {
        for (const f of all) {
          if (!f.path.endsWith('.json')) continue;
          if (folder === '') {
            if (f.path === dir)
              out.push({ sourcePath: f.path, path: `${product}/conflicts.json`, sha: f.sha });
          } else if (path.posix.dirname(f.path) === dir) {
            out.push({
              sourcePath: f.path,
              path: `${product}/${folder}/${path.posix.basename(f.path)}`,
              sha: f.sha,
            });
          }
        }
      }
    }
  }
  return out;
}

export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export class GitHubSource implements GuideSource {
  readonly label: string;

  constructor(
    private readonly repo: string,
    private readonly branch: string,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
    private readonly timeoutMs = 20_000,
  ) {
    if (!REPO_PATTERN.test(repo) || !BRANCH_PATTERN.test(branch)) throw new Error('invalid repository');
    this.label = `github:${repo}@${branch}`;
  }

  private async getJson(url: string): Promise<unknown> {
    const res = await this.fetchImpl(url, {
      headers: { accept: 'application/json', 'user-agent': 'Wardarr' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async list(): Promise<GuideListing> {
    const api = `https://api.github.com/repos/${this.repo}`;
    const commit = (await this.getJson(`${api}/commits/${encodeURIComponent(this.branch)}`)) as {
      sha?: string;
      commit?: { committer?: { date?: string } };
    };
    if (!commit.sha || !/^[0-9a-f]{40}$/.test(commit.sha)) throw new Error('no commit');
    const tree = (await this.getJson(`${api}/git/trees/${commit.sha}?recursive=1`)) as {
      tree?: Array<{ path: string; type: string; sha: string }>;
    };
    const blobs = (tree.tree ?? []).filter((t) => t.type === 'blob');
    let meta: Metadata | null = null;
    if (blobs.some((b) => b.path === 'metadata.json')) {
      meta = (await this.getJson(this.rawUrl(commit.sha, 'metadata.json')).catch(
        () => null,
      )) as Metadata | null;
    }
    return {
      version: commit.sha,
      date: commit.commit?.committer?.date ?? null,
      files: mapFiles(meta, blobs),
    };
  }

  private rawUrl(version: string, file: string): string {
    return `https://raw.githubusercontent.com/${this.repo}/${version}/${file.split('/').map(encodeURIComponent).join('/')}`;
  }

  read(file: RemoteFile, version: string): Promise<unknown> {
    return this.getJson(this.rawUrl(version, file.sourcePath));
  }
}

/** A local checkout of the guides (or a folder with the same layout). */
export class DirectorySource implements GuideSource {
  readonly label: string;

  constructor(private readonly root: string) {
    this.label = 'directory';
  }

  private async walk(dir: string, rel = ''): Promise<string[]> {
    const out: string[] = [];
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const e of entries) {
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) out.push(...(await this.walk(path.join(dir, e.name), relPath)));
      else if (e.isFile() && e.name.endsWith('.json')) out.push(relPath);
    }
    return out;
  }

  async list(): Promise<GuideListing> {
    const files = await this.walk(path.join(this.root, 'docs'), 'docs');
    const all: Array<{ path: string; sha: string }> = [];
    for (const f of files) {
      const content = await readFile(path.join(this.root, f));
      all.push({ path: f, sha: createHash('sha1').update(content).digest('hex') });
    }
    const meta = await readFile(path.join(this.root, 'metadata.json'), 'utf8')
      .then((text) => JSON.parse(text) as Metadata)
      .catch(() => null);
    const mapped = mapFiles(meta, all);
    const version = createHash('sha1')
      .update(mapped.map((f) => `${f.path}:${f.sha}`).join('\n'))
      .digest('hex');
    return { version, date: null, files: mapped };
  }

  async read(file: RemoteFile): Promise<unknown> {
    return JSON.parse(await readFile(path.join(this.root, file.sourcePath), 'utf8'));
  }
}
