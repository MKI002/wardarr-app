import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkUrl, isBlockedAddress } from '../src/net/ssrf.js';
import { createSecretBox, loadOrCreateKey } from '../src/security/crypto.js';
import { redact, redactString } from '../src/security/redact.js';

describe('AES-256-GCM secret box', () => {
  const box = createSecretBox(randomBytes(32));

  it('round-trips', () => {
    expect(box.decrypt(box.encrypt('secret value', 'id-1'), 'id-1')).toBe('secret value');
  });

  it('binds ciphertext to its record', () => {
    expect(() => box.decrypt(box.encrypt('secret value', 'id-1'), 'id-2')).toThrow();
  });

  it('detects tampering', () => {
    const parts = box.encrypt('secret value', 'id-1').split(':');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => box.decrypt(parts.join(':'), 'id-1')).toThrow();
  });

  it('creates the key file with mode 0600 on first start', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'wardarr-key-'));
    const key = loadOrCreateKey(dir, undefined);
    expect(key).toHaveLength(32);
    expect(statSync(path.join(dir, 'secret.key')).mode & 0o777).toBe(0o600);
    expect(loadOrCreateKey(dir, undefined).equals(key)).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('accepts a key from the environment', () => {
    const hex = randomBytes(32).toString('hex');
    expect(loadOrCreateKey('/nonexistent', hex).toString('hex')).toBe(hex);
    expect(() => loadOrCreateKey('/nonexistent', 'too-short')).toThrow();
  });
});

describe('SSRF guard', () => {
  it.each([
    ['169.254.169.254', true], // privacy-allow
    ['169.254.10.1', true], // privacy-allow
    ['0.0.0.0', true],
    ['224.0.0.1', true], // privacy-allow
    ['fe80::1', true],
    ['fd00:ec2::254', true],
    ['::ffff:169.254.169.254', true], // privacy-allow
    ['::', true],
    ['127.0.0.1', false],
    ['10.1.2.3', false], // privacy-allow
    ['172.16.5.4', false], // privacy-allow
    ['192.168.178.2', false], // privacy-allow
    ['100.64.0.10', false], // privacy-allow
    ['fd12:3456::1', false],
    ['::1', false],
    ['203.0.113.7', false],
  ])('%s blocked=%s', (ip, blocked) => {
    expect(isBlockedAddress(ip)).toBe(blocked);
  });

  it('rejects non-http schemes, credentials in URLs and metadata hosts', () => {
    expect(checkUrl('gopher://example.com').ok).toBe(false);
    expect(checkUrl('http://a:b@example.com').ok).toBe(false);
    expect(checkUrl('http://metadata.google.internal').ok).toBe(false);
    expect(checkUrl('http://[::ffff:a9fe:a9fe]/').ok).toBe(false);
    expect(checkUrl('https://media.example.test:8920/jellyfin').ok).toBe(true);
  });
});

describe('redaction', () => {
  it('masks keys, URLs and user names', () => {
    const out = redact({
      apiKey: 'abc',
      nested: {
        password: 'p',
        username: 'someone',
        note: 'calling http://host.example.test:8989/api/v3?apikey=1234',
      },
      message: `key ${'a1'.repeat(16)} used`,
    }) as { apiKey: string; message: string; nested: Record<string, string> };
    expect(out.apiKey).toBe('[redacted]');
    expect(out.nested.password).toBe('[redacted]');
    expect(out.nested.username).toBe('[user]');
    expect(out.nested.note).not.toContain('host.example.test');
    expect(out.nested.note).not.toContain('1234');
    expect(out.message).toBe('key [key] used');
  });

  it('masks query secrets in plain strings', () => {
    expect(redactString('/api?apikey=secret&x=1')).toBe('/api?apikey=[redacted]&x=1');
  });
});
