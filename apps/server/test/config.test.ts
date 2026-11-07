import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('treats blank values from a container template as not set', () => {
    const config = loadConfig({
      WARDARR_DATA_DIR: '/data',
      WARDARR_PUBLIC_URL: '',
      WARDARR_BACKUP_DIR: '',
      WARDARR_SECRET_KEY: ' ',
      WARDARR_TRUST_PROXY: '',
      WARDARR_LOG_LEVEL: '',
      WARDARR_PORT: '',
    });
    expect(config.publicUrl).toBeUndefined();
    expect(config.backupDir).toBe(path.resolve('/data/backups'));
    expect(config.secretKey).toBeUndefined();
    expect(config.trustProxy).toBe(false);
    expect(config.logLevel).toBe('info');
    expect(config.port).toBe(8484);
  });

  it('still rejects an address that is not http or https', () => {
    expect(() => loadConfig({ WARDARR_PUBLIC_URL: 'ftp://example.com' })).toThrow();
  });

  it('drops a trailing slash from the public address', () => {
    expect(loadConfig({ WARDARR_PUBLIC_URL: 'https://wardarr.example.com/' }).publicUrl).toBe(
      'https://wardarr.example.com',
    );
  });
});
