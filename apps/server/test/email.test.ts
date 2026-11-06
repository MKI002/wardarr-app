// E-mail notifications: settings validation, the message that is built and
// a real SMTP conversation with a tiny local server. Addresses are invented.
import { createServer, type Server } from 'node:net';
import type { Signal } from '@wardarr/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sendMail } from '../src/notifications/mailer.js';
import { buildMail, type OutgoingMail } from '../src/notifications/senders.js';
import { DEFAULT_EVENTS } from '../src/notifications/service.js';
import { FAKE_KEY, createTestApp, fakeState, setupAdmin } from './helpers.js';

const SIGNAL: Signal = {
  origin: 'service',
  instance: { id: '', name: '', adapter: 'fake' },
  kind: 'health',
  source: 'IndexerLongTermStatusCheck',
  level: 'warning',
  message: 'Indexers unavailable due to failures for more than 6 hours: ExampleIndexer (Prowlarr)',
};

const CONFIG = {
  host: 'mail.example.test',
  port: '587',
  security: 'starttls',
  username: 'wardarr',
  from: 'wardarr@example.test',
  to: 'one@example.test; two@example.test',
};

describe('e-mail channels', () => {
  let mails: OutgoingMail[];
  let t: Awaited<ReturnType<typeof createTestApp>>;
  let headers: Record<string, string>;

  beforeEach(async () => {
    mails = [];
    t = await createTestApp({
      publicUrl: 'https://wardarr.example.test',
      notificationOptions: { graceMs: 0, retryMs: 1, sendMail: async (m) => void mails.push(m) },
    });
    headers = await setupAdmin(t);
  });
  afterEach(async () => t.close());

  const create = (config: Record<string, unknown>, secret: Record<string, unknown> = {}) =>
    t.app.inject({
      method: 'POST',
      url: '/api/notifications',
      headers,
      payload: {
        name: 'Mail',
        kind: 'email',
        config,
        secret,
        events: { issueOpened: 'warning', issueResolved: false, requestPending: false },
      },
    });

  it('is offered with its fields and keeps the password write-only', async () => {
    const kinds = (await t.app.inject({ method: 'GET', url: '/api/notifications', headers })).json().kinds;
    expect(kinds.find((k: { kind: string }) => k.kind === 'email')).toEqual({
      kind: 'email',
      fields: ['host', 'port', 'security', 'username', 'from', 'to'],
      secrets: ['password'],
    });
    const res = await create(CONFIG, { password: 'example-mail-password' });
    expect(res.statusCode).toBe(201);
    expect(JSON.stringify(res.json())).not.toContain('example-mail-password');
    expect(res.json().config).toMatchObject({ port: 587, to: 'one@example.test, two@example.test' });
    expect(res.json().secrets).toEqual({ password: { isSet: true } });
  });

  it('rejects bad addresses and blocked hosts', async () => {
    expect((await create({ ...CONFIG, to: 'not an address' })).statusCode).toBe(400);
    expect((await create({ ...CONFIG, from: 'nobody' })).statusCode).toBe(400);
    expect((await create({ ...CONFIG, host: 'mail.example.test/evil' })).statusCode).toBe(400);
    const blocked = await create({ ...CONFIG, host: 'metadata.google.internal' });
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().error).toBe('invalidUrl');
  });

  it('mails a new issue with a link', async () => {
    await create(CONFIG, { password: 'example-mail-password' });
    fakeState.down = false;
    fakeState.signals = [SIGNAL];
    const inst = await t.app.inject({
      method: 'POST',
      url: '/api/instances',
      headers,
      payload: {
        adapter: 'fake',
        name: 'Fake Sonarr',
        baseUrl: 'http://fake.example.test',
        fields: { apiKey: FAKE_KEY },
      },
    });
    await t.runtime.poll(inst.json().id);
    await new Promise((r) => setTimeout(r, 20));
    expect(mails).toHaveLength(1);
    const [mail] = mails;
    expect(mail).toMatchObject({
      host: 'mail.example.test',
      port: 587,
      security: 'starttls',
      auth: { user: 'wardarr', pass: 'example-mail-password' },
    });
    expect(mail!.message.from).toBe('Wardarr <wardarr@example.test>');
    expect(mail!.message.to).toBe('one@example.test, two@example.test');
    expect(mail!.message.subject).toContain('ExampleIndexer');
    expect(mail!.message.text).toContain('https://wardarr.example.test/issues?focus=');
    fakeState.signals = [];
  });

  it('only announces new issues by default', () => {
    expect(DEFAULT_EVENTS).toEqual({ issueOpened: 'warning', issueResolved: false, requestPending: false });
  });
});

describe('the mail itself', () => {
  it('escapes HTML and skips the login without a user name', () => {
    const mail = buildMail(
      { host: 'mail.example.test', port: 25, security: 'none', from: 'a@example.test', to: 'b@example.test' },
      {},
      { event: 'test', level: 'info', title: '<b>Example</b>', body: 'one\ntwo & three', url: null, at: '' },
    );
    expect(mail.auth).toBeNull();
    expect(mail.message.html).toContain('&lt;b&gt;Example&lt;/b&gt;');
    expect(mail.message.html).toContain('two &amp; three');
    expect(mail.message.html).not.toContain('<b>');
  });
});

describe('SMTP', () => {
  let server: Server;
  let port: number;
  let received: string;
  let rejectLogin: boolean;

  beforeEach(async () => {
    received = '';
    rejectLogin = false;
    server = createServer((socket) => {
      let inData = false;
      let buffer = '';
      socket.write('220 mail.example.test ESMTP\r\n');
      socket.on('data', (chunk) => {
        buffer += chunk.toString();
        let i: number;
        while ((i = buffer.indexOf('\r\n')) >= 0) {
          const line = buffer.slice(0, i);
          buffer = buffer.slice(i + 2);
          if (inData) {
            if (line === '.') {
              inData = false;
              socket.write('250 queued\r\n');
            } else received += `${line}\n`;
            continue;
          }
          const cmd = line.slice(0, 4).toUpperCase();
          if (cmd === 'EHLO') socket.write('250-mail.example.test\r\n250 AUTH PLAIN\r\n');
          else if (cmd === 'AUTH') socket.write(rejectLogin ? '535 nope\r\n' : '235 ok\r\n');
          else if (cmd === 'DATA') {
            inData = true;
            socket.write('354 go\r\n');
          } else if (cmd === 'QUIT') socket.end('221 bye\r\n');
          else socket.write('250 ok\r\n');
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as { port: number }).port;
  });
  afterEach(() => new Promise<void>((r) => server.close(() => r())));

  const out = (auth: OutgoingMail['auth']): OutgoingMail =>
    buildMail(
      {
        host: '127.0.0.1',
        port,
        security: 'none',
        username: auth?.user,
        from: 'a@example.test',
        to: 'b@example.test',
      },
      { password: auth?.pass },
      { event: 'test', level: 'ok', title: 'Example subject', body: 'Example body', url: null, at: '' },
    );

  it('delivers a message', async () => {
    await sendMail(out({ user: 'wardarr', pass: 'example-mail-password' }), 2000);
    expect(received).toContain('Subject: Example subject');
    expect(received).toContain('Example body');
    expect(received).not.toContain('example-mail-password');
  });

  it('reports a rejected login as unauthorized', async () => {
    rejectLogin = true;
    await expect(sendMail(out({ user: 'wardarr', pass: 'wrong' }), 2000)).rejects.toMatchObject({
      kind: 'unauthorized',
    });
  });

  it('refuses blocked addresses before connecting', async () => {
    const mail = out(null);
    await expect(sendMail({ ...mail, host: '[fe80::1]' }, 2000)).rejects.toMatchObject({ kind: 'blocked' });
  });
});
