#!/usr/bin/env node
// Local denylist guard.
//
// Reads a list of forbidden terms from the file named in WARDARR_DENYLIST.
// That file must live outside the repository and is never printed, copied or
// committed. A hit aborts the hook and reports only where it happened.
//
// File format: one term per line, matched case-insensitively as a substring.
// Lines starting with `#` are comments. Lines starting with `re:` are
// JavaScript regular expressions (case-insensitive).
//
// Usage:
//   denylist-check.mjs --staged            staged diff and staged file paths
//   denylist-check.mjs --commit-msg <file> a commit message file
//   denylist-check.mjs --unpushed          commits not on any remote yet
//   denylist-check.mjs --all               every tracked file and all history metadata
import { readFileSync } from 'node:fs';
import {
  UNPUSHED,
  fail,
  git,
  isInside,
  parseAddedLines,
  readText,
  repoRoot,
  safeRealpath,
  stagedFiles,
  trackedFiles,
} from './lib.mjs';

function loadMatchers() {
  const listPath = process.env.WARDARR_DENYLIST;
  if (!listPath) {
    if (process.env.WARDARR_DENYLIST_REQUIRED === '1') {
      fail(['denylist: WARDARR_DENYLIST is not set but WARDARR_DENYLIST_REQUIRED=1.']);
    }
    process.stderr.write('denylist: WARDARR_DENYLIST is not set, skipping. See docs/privacy-guard.md.\n');
    process.exit(0);
  }
  const real = safeRealpath(listPath);
  if (isInside(real, safeRealpath(repoRoot()))) {
    fail([
      'denylist: the denylist file must live outside the repository. Move it and update WARDARR_DENYLIST.',
    ]);
  }
  let content;
  try {
    content = readFileSync(real, 'utf8');
  } catch {
    fail(['denylist: the file named in WARDARR_DENYLIST cannot be read.']);
  }
  const matchers = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('re:')) {
      try {
        const re = new RegExp(line.slice(3), 'i');
        matchers.push((s) => re.test(s));
      } catch {
        fail(['denylist: the denylist contains an invalid regular expression.']);
      }
    } else {
      const term = line.toLowerCase();
      matchers.push((s) => s.toLowerCase().includes(term));
    }
  }
  return matchers;
}

const matchers = loadMatchers();
const hits = [];
const matches = (s) => typeof s === 'string' && s.length > 0 && matchers.some((m) => m(s));

/** Reports a hit on a path without printing the path if the path itself matches. */
function where(file, line, ordinal) {
  if (matches(file)) return `a file path (entry #${ordinal} of the checked list)`;
  return line > 0 ? `${file}:${line}` : file;
}

function checkPaths(files, label) {
  files.forEach((f, i) => {
    if (matches(f)) hits.push(`${label}: file path of entry #${i + 1} matches the denylist`);
  });
}

function checkAddedLines(diff, label) {
  const files = [];
  for (const entry of parseAddedLines(diff)) {
    if (!files.includes(entry.file)) files.push(entry.file);
    if (!entry.binary && matches(entry.text)) {
      hits.push(`${label}: ${where(entry.file, entry.line, files.indexOf(entry.file) + 1)}`);
    }
  }
}

function checkCommit(sha) {
  const short = sha.slice(0, 10);
  const meta = git(['log', '-1', '--format=%an%n%ae%n%cn%n%ce', sha]);
  if (matches(meta)) hits.push(`commit ${short}: author or committer matches the denylist`);
  const message = git(['log', '-1', '--format=%B', sha]);
  if (matches(message)) hits.push(`commit ${short}: commit message matches the denylist`);
  const files = git(['show', '--name-only', '--format=', '-z', sha]).split('\0').filter(Boolean);
  checkPaths(files, `commit ${short}`);
  checkAddedLines(git(['show', '-U0', '--format=', '--no-color', sha]), `commit ${short}`);
}

const mode = process.argv[2];
switch (mode) {
  case '--staged': {
    checkPaths(stagedFiles(), 'staged');
    checkAddedLines(git(['diff', '--cached', '-U0', '--no-color']), 'staged');
    const ident = git(['var', 'GIT_AUTHOR_IDENT']) + git(['var', 'GIT_COMMITTER_IDENT']);
    if (matches(ident)) hits.push('staged: the configured author or committer identity matches the denylist');
    break;
  }
  case '--commit-msg': {
    const file = process.argv[3];
    if (!file) fail(['denylist: --commit-msg needs the message file path']);
    if (matches(readFileSync(file, 'utf8'))) hits.push('commit message matches the denylist');
    break;
  }
  case '--unpushed': {
    const shas = git(['rev-list', ...UNPUSHED])
      .split('\n')
      .filter(Boolean);
    for (const sha of shas) checkCommit(sha);
    break;
  }
  case '--all': {
    const files = trackedFiles();
    checkPaths(files, 'tree');
    files.forEach((file, i) => {
      const text = readText(file);
      if (text === null) return;
      text.split('\n').forEach((line, idx) => {
        if (matches(line)) hits.push(`tree: ${where(file, idx + 1, i + 1)}`);
      });
    });
    const meta = git(['log', '--all', '--format=%H%x00%an%x00%ae%x00%cn%x00%ce%x00%B%x00%x01']);
    for (const record of meta.split('\x01')) {
      const [sha, ...rest] = record.trim().split('\0');
      if (sha && matches(rest.join('\n')))
        hits.push(`commit ${sha.slice(0, 10)}: metadata or message matches the denylist`);
    }
    break;
  }
  default:
    fail(['usage: denylist-check.mjs --staged | --commit-msg <file> | --unpushed | --all']);
}

if (hits.length > 0) {
  fail([
    `denylist: ${hits.length} hit(s). The matching terms are not shown on purpose.`,
    ...hits.map((h) => `  - ${h}`),
    'Remove the data, then try again. Do not add the term to the repository.',
  ]);
}
