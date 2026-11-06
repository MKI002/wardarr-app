// Sends notification e-mails over SMTP. The host is resolved here and
// checked like every other outgoing connection, then the connection goes to
// the checked address while TLS still verifies the certificate for the name.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { AdapterError } from '@wardarr/core';
import { createTransport } from 'nodemailer';
import { isBlockedAddress } from '../net/ssrf.js';
import type { OutgoingMail } from './senders.js';

async function resolveChecked(host: string): Promise<string> {
  const bare = host.replace(/^\[|\]$/g, '');
  if (isIP(bare)) {
    if (isBlockedAddress(bare)) throw new AdapterError('blocked', 'blocked address');
    return bare;
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(bare, { all: true });
  } catch {
    throw new AdapterError('unreachable', 'host not found');
  }
  const allowed = addresses.find((a) => !isBlockedAddress(a.address));
  if (!allowed) throw new AdapterError('blocked', 'blocked address');
  return allowed.address;
}

function classify(err: unknown): AdapterError {
  if (err instanceof AdapterError) return err;
  const code = (err as { code?: string }).code ?? '';
  const responseCode = (err as { responseCode?: number }).responseCode ?? 0;
  if (code === 'EAUTH' || responseCode === 535) return new AdapterError('unauthorized', 'SMTP login failed');
  if (code === 'ETIMEDOUT') return new AdapterError('timeout', 'SMTP timeout');
  if (code === 'ECONNECTION' || code === 'ESOCKET' || code === 'EDNS')
    return new AdapterError('unreachable', 'SMTP connection failed');
  return new AdapterError('badResponse', 'SMTP rejected the message');
}

export async function sendMail(out: OutgoingMail, timeoutMs = 10_000): Promise<void> {
  try {
    const address = await resolveChecked(out.host);
    const transport = createTransport({
      host: address,
      port: out.port,
      secure: out.security === 'tls',
      requireTLS: out.security === 'starttls',
      ignoreTLS: out.security === 'none',
      auth: out.auth ?? undefined,
      // Name used in EHLO; never the container's host name.
      name: 'localhost',
      tls: { servername: out.host.replace(/^\[|\]$/g, ''), minVersion: 'TLSv1.2' },
      connectionTimeout: timeoutMs,
      greetingTimeout: timeoutMs,
      socketTimeout: timeoutMs,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    try {
      await transport.sendMail(out.message);
    } finally {
      transport.close();
    }
  } catch (err) {
    throw classify(err);
  }
}
