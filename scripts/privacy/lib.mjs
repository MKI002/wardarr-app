// Shared helpers for the local privacy guards (denylist and artifact checks).
// These scripts never print the content of a match, only where it was found.
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync, existsSync } from 'node:fs';
import path from 'node:path';

export function git(args, opts = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });
}

export function repoRoot() {
  return git(['rev-parse', '--show-toplevel']).trim();
}

/** Revision spec for commits that exist locally but on no remote yet. */
export const UNPUSHED = ['--branches', '--not', '--remotes'];

export function fail(lines) {
  for (const line of lines) process.stderr.write(`${line}\n`);
  process.exit(1);
}

/**
 * Parses `git diff -U0` output into added lines with file and line number.
 * Binary files are reported with line 0 so callers can decide what to do.
 */
export function parseAddedLines(diff) {
  const out = [];
  let file = null;
  let lineNo = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) {
      const p = raw.slice(4);
      file = p === '/dev/null' ? null : p.replace(/^b\//, '');
      continue;
    }
    if (raw.startsWith('Binary files ')) {
      const m = raw.match(/ and b\/(.+) differ$/);
      if (m) out.push({ file: m[1], line: 0, text: '', binary: true });
      continue;
    }
    if (raw.startsWith('@@')) {
      const m = raw.match(/\+(\d+)/);
      lineNo = m ? Number(m[1]) : 0;
      continue;
    }
    if (file && raw.startsWith('+')) {
      out.push({ file, line: lineNo, text: raw.slice(1), binary: false });
      lineNo += 1;
    }
  }
  return out;
}

/** Files added or modified in the staged index. */
export function stagedFiles() {
  return git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']).split('\0').filter(Boolean);
}

/** Files touched by commits that are not on any remote yet. */
export function unpushedFiles() {
  const out = git(['log', '--name-only', '--diff-filter=ACMR', '--format=', '-z', ...UNPUSHED]);
  return [
    ...new Set(
      out
        .split('\0')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}

export function trackedFiles() {
  return git(['ls-files', '-z']).split('\0').filter(Boolean);
}

export function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function safeRealpath(p) {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

export function readText(file) {
  if (!existsSync(file)) return null;
  const buf = readFileSync(file);
  if (buf.includes(0)) return null;
  return buf.toString('utf8');
}
