#!/usr/bin/env node
// Checks files for data that must never reach the repository: image metadata,
// source maps, local paths and private hosts in lockfiles, real e-mail
// addresses, IPv4 addresses outside documentation ranges and home directories.
//
// Usage:
//   artifact-check.mjs --staged     staged files
//   artifact-check.mjs --unpushed   files touched by commits not on a remote yet
//   artifact-check.mjs --all        every tracked file (used in CI)
//
// A line may opt out of the IP and e-mail checks with the marker
// `privacy-allow` when a value is part of the logic (for example SSRF tests).
// The marker never silences path, source-map or image-metadata findings.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fail, readText, stagedFiles, trackedFiles, unpushedFiles } from './lib.mjs';

const IMAGE_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.heic',
  '.tif',
  '.tiff',
  '.ico',
  '.bmp',
]);
const LOCKFILES = new Set([
  'pnpm-lock.yaml',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'bun.lock',
]);
const ALLOWED_REGISTRY_HOSTS = new Set(['registry.npmjs.org', 'registry.yarnpkg.com', 'codeload.github.com']);
const ALLOWED_EMAIL_DOMAINS = [
  /(^|\.)example\.(com|org|net)$/i,
  /\.(example|test|invalid|localhost)$/i,
  /^users\.noreply\.github\.com$/i,
];
const ALLOWED_EMAILS = new Set(['git@github.com']);
const OPT_OUT = 'privacy-allow';

// Home directories of real users. Container users that are part of public
// images (node, runner) are not personal.
const HOME_PATH =
  /(?:\/home\/(?!node\b|runner\b)[A-Za-z0-9._-]+|\/Users\/(?!Shared\b)[A-Za-z0-9._-]+|[A-Za-z]:\\\\?Users\\\\?[A-Za-z0-9._-]+)/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const IPV4 = /(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\d.])/g;
const INLINE_SOURCEMAP = /sourceMappingURL=data:application\/json/;

// Image metadata tags that identify a person, device or place.
const SENSITIVE_TAGS = [
  /^GPS/i,
  /Artist$/i,
  /Author$/i,
  /Creator$/i,
  /By-line/i,
  /OwnerName$/i,
  /SerialNumber$/i,
  /HostComputer$/i,
  /DocumentName$/i,
  /UserComment$/i,
  /CameraOwner/i,
];

function ipAllowed(a, b, c, d) {
  const parts = [a, b, c, d].map(Number);
  if (parts.some((p) => p > 255)) return true; // not an IP (version string or similar)
  const [p1, p2, p3] = parts;
  if (p1 === 127 || p1 === 0) return true;
  if (parts.every((p) => p === 255)) return true;
  if (p1 === 192 && p2 === 0 && p3 === 2) return true; // TEST-NET-1
  if (p1 === 198 && p2 === 51 && p3 === 100) return true; // TEST-NET-2
  if (p1 === 203 && p2 === 0 && p3 === 113) return true; // TEST-NET-3
  return false;
}

function emailAllowed(email) {
  if (ALLOWED_EMAILS.has(email.toLowerCase())) return true;
  const domain = email.split('@')[1] ?? '';
  return ALLOWED_EMAIL_DOMAINS.some((re) => re.test(domain));
}

const findings = [];
const add = (file, line, reason) => findings.push(`${file}${line ? `:${line}` : ''}: ${reason}`);

function checkText(file, text) {
  const base = path.basename(file);
  const isLock = LOCKFILES.has(base);
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const n = i + 1;
    if (HOME_PATH.test(line)) add(file, n, 'local home directory path');
    if (INLINE_SOURCEMAP.test(line)) add(file, n, 'inline source map');
    if (!line.includes(OPT_OUT)) {
      for (const m of line.matchAll(EMAIL)) {
        if (!emailAllowed(m[0])) add(file, n, 'e-mail address outside example domains');
      }
      for (const m of line.matchAll(IPV4)) {
        if (!ipAllowed(m[1], m[2], m[3], m[4])) add(file, n, 'IPv4 address outside documentation ranges');
      }
    }
    if (isLock) {
      if (/\b(?:file|link):(?:\/|[A-Za-z]:)/.test(line)) add(file, n, 'absolute local path in lockfile');
      if (/git\+ssh:\/\//.test(line)) add(file, n, 'git+ssh URL in lockfile');
      for (const m of line.matchAll(/https?:\/\/([^/\s"']+)/g)) {
        if (!ALLOWED_REGISTRY_HOSTS.has(m[1].toLowerCase()))
          add(file, n, 'non-public registry host in lockfile');
      }
    }
  });
  if (file.endsWith('.svg')) {
    if (/sodipodi:docname|inkscape:export-filename|<dc:creator>/i.test(text))
      add(file, 0, 'editor metadata in SVG');
  }
}

let exiftoolChecked = false;
function checkImage(file) {
  if (!exiftoolChecked) {
    try {
      execFileSync('exiftool', ['-ver'], { stdio: 'ignore' });
    } catch {
      fail([
        'artifact-check: exiftool is required to check image metadata. Install it (see docs/privacy-guard.md).',
      ]);
    }
    exiftoolChecked = true;
  }
  let tags;
  try {
    const out = execFileSync('exiftool', ['-j', '-G1', '-a', '-u', file], { encoding: 'utf8' });
    tags = JSON.parse(out)[0] ?? {};
  } catch {
    add(file, 0, 'image metadata could not be read');
    return;
  }
  for (const [key, value] of Object.entries(tags)) {
    if (
      key === 'SourceFile' ||
      key.startsWith('System:') ||
      key.startsWith('File:') ||
      key.startsWith('ExifTool:')
    )
      continue;
    const tag = key.split(':').pop();
    const str = String(value);
    if (SENSITIVE_TAGS.some((re) => re.test(tag))) add(file, 0, `image metadata tag ${tag}`);
    else if (HOME_PATH.test(str)) add(file, 0, `local path in image metadata tag ${tag}`);
    else if ([...str.matchAll(EMAIL)].some((m) => !emailAllowed(m[0])))
      add(file, 0, `e-mail address in image metadata tag ${tag}`);
  }
}

const mode = process.argv[2];
let files;
if (mode === '--staged') files = stagedFiles();
else if (mode === '--unpushed') files = unpushedFiles();
else if (mode === '--all') files = trackedFiles();
else fail(['usage: artifact-check.mjs --staged | --unpushed | --all']);

for (const file of files) {
  if (!existsSync(file)) continue;
  const ext = path.extname(file).toLowerCase();
  if (ext === '.map') {
    add(file, 0, 'source map files must not be committed');
    continue;
  }
  if (IMAGE_EXT.has(ext)) {
    checkImage(file);
    continue;
  }
  const text = readText(file);
  if (text !== null) checkText(file, text);
}

if (findings.length > 0) {
  fail([`artifact-check: ${findings.length} finding(s):`, ...findings.map((f) => `  - ${f}`)]);
}
