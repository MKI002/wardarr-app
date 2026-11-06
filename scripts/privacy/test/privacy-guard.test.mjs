// Tests for the denylist and artifact guards. Each test runs the scripts
// against a throwaway git repository in a temporary directory.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const denylistScript = path.resolve(here, '../denylist-check.mjs');
const artifactScript = path.resolve(here, '../artifact-check.mjs');
const SECRET_TERM = 'zebracorn-quartz';

let repo;
let outside;

function git(...args) {
  execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
}

function run(script, args, env = {}) {
  return spawnSync('node', [script, ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, WARDARR_DENYLIST: '', ...env },
  });
}

beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), 'wardarr-guard-repo-'));
  outside = mkdtempSync(path.join(tmpdir(), 'wardarr-guard-list-'));
  git('init', '-q');
  git('config', 'user.email', 'tester@example.com');
  git('config', 'user.name', 'Tester');
  writeFileSync(path.join(outside, 'denylist.txt'), `# comment\n${SECRET_TERM}\nre:mega[0-9]+lith\n`);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe('denylist-check', () => {
  const env = () => ({ WARDARR_DENYLIST: path.join(outside, 'denylist.txt') });

  it('blocks a staged line containing a denylisted term without printing it', () => {
    writeFileSync(path.join(repo, 'a.txt'), `hello\nsee ${SECRET_TERM.toUpperCase()} here\n`);
    git('add', 'a.txt');
    const res = run(denylistScript, ['--staged'], env());
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('a.txt:2');
    expect(res.stderr.toLowerCase()).not.toContain(SECRET_TERM);
  });

  it('supports regular expressions', () => {
    writeFileSync(path.join(repo, 'b.txt'), 'mega42lith\n');
    git('add', 'b.txt');
    expect(run(denylistScript, ['--staged'], env()).status).toBe(1);
  });

  it('does not print a file path that itself matches', () => {
    writeFileSync(path.join(repo, `${SECRET_TERM}.txt`), 'clean\n');
    git('add', '.');
    const res = run(denylistScript, ['--staged'], env());
    expect(res.status).toBe(1);
    expect(res.stderr.toLowerCase()).not.toContain(SECRET_TERM);
  });

  it('passes clean changes', () => {
    writeFileSync(path.join(repo, 'c.txt'), 'nothing to see\n');
    git('add', 'c.txt');
    expect(run(denylistScript, ['--staged'], env()).status).toBe(0);
  });

  it('checks commit messages', () => {
    const msg = path.join(outside, 'msg.txt');
    writeFileSync(msg, `fix: thing for ${SECRET_TERM}\n`);
    const res = run(denylistScript, ['--commit-msg', msg], env());
    expect(res.status).toBe(1);
    expect(res.stderr.toLowerCase()).not.toContain(SECRET_TERM);
  });

  it('checks unpushed commits including the author', () => {
    writeFileSync(path.join(repo, 'd.txt'), 'clean\n');
    git('add', 'd.txt');
    execFileSync('git', ['commit', '-q', '-m', 'add d'], {
      cwd: repo,
      env: { ...process.env, GIT_AUTHOR_NAME: SECRET_TERM, GIT_COMMITTER_NAME: 'x' },
    });
    const res = run(denylistScript, ['--unpushed'], env());
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('author or committer');
  });

  it('refuses a denylist inside the repository', () => {
    writeFileSync(path.join(repo, 'list.txt'), `${SECRET_TERM}\n`);
    const res = run(denylistScript, ['--staged'], { WARDARR_DENYLIST: path.join(repo, 'list.txt') });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('outside the repository');
  });

  it('skips with a warning when no denylist is configured', () => {
    const res = run(denylistScript, ['--staged']);
    expect(res.status).toBe(0);
    expect(res.stderr).toContain('not set');
  });
});

describe('artifact-check', () => {
  function stage(name, content) {
    spawnSync('git', ['rm', '-r', '-q', '--cached', '.'], { cwd: repo });
    writeFileSync(path.join(repo, name), content);
    git('add', name);
    return run(artifactScript, ['--staged']);
  }

  it('rejects source maps', () => {
    expect(stage('app.js.map', '{}').status).toBe(1);
  });

  it('rejects local home paths', () => {
    const res = stage('notes.md', 'built in /home/' + 'someone/projects\n');
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('home directory');
  });

  it('rejects real e-mail addresses but allows example domains', () => {
    expect(stage('a.md', 'contact: person@' + 'gmail.com\n').status).toBe(1);
    expect(stage('b.md', 'contact: alice@example.com\n').status).toBe(0);
  });

  it('rejects private IPv4 addresses unless marked', () => {
    expect(stage('a.ts', "const host = '10.1." + "2.3';\n").status).toBe(1);
    expect(stage('b.ts', "const host = '10.1." + "2.3'; // privacy-allow\n").status).toBe(0);
    expect(stage('c.ts', "const host = '192.0.2.10';\n").status).toBe(0);
  });

  it('rejects lockfiles with local paths and private registries', () => {
    expect(stage('pnpm-lock.yaml', 'resolution: {tarball: https://npm.corp.internal/x.tgz}\n').status).toBe(
      1,
    );
    expect(stage('package-lock.json', '"resolved": "file:/opt/pkgs/x.tgz"\n').status).toBe(1);
    expect(stage('yarn.lock', 'resolved "https://registry.yarnpkg.com/x/-/x-1.0.0.tgz"\n').status).toBe(0);
  });

  it('rejects SVG editor metadata', () => {
    expect(stage('logo.svg', '<svg sodipodi:docname="x.svg"></svg>\n').status).toBe(1);
  });
});
