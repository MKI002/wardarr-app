// SSRF protection for instance URLs.
//
// Wardarr must reach services on the local network, so private ranges and
// loopback are allowed. Link-local ranges, cloud metadata endpoints and
// unspecified or multicast addresses are blocked. The check runs on the URL
// when an instance is saved and again on every connection after DNS
// resolution, so a DNS change cannot bypass it.
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { BlockList, isIP } from 'node:net';

const blocked = new BlockList();
// IPv4
blocked.addSubnet('0.0.0.0', 8, 'ipv4'); // "this network", unspecified
blocked.addSubnet('169.254.0.0', 16, 'ipv4'); // link-local, includes 169.254.169.254 // privacy-allow
blocked.addSubnet('224.0.0.0', 4, 'ipv4'); // multicast // privacy-allow
blocked.addSubnet('240.0.0.0', 4, 'ipv4'); // reserved, includes broadcast // privacy-allow
blocked.addAddress('100.100.100.200', 'ipv4'); // Alibaba Cloud metadata // privacy-allow
blocked.addAddress('192.0.0.192', 'ipv4'); // Oracle Cloud metadata // privacy-allow
// IPv6
blocked.addAddress('::', 'ipv6'); // unspecified
blocked.addSubnet('fe80::', 10, 'ipv6'); // link-local
blocked.addSubnet('ff00::', 8, 'ipv6'); // multicast
blocked.addAddress('fd00:ec2::254', 'ipv6'); // AWS metadata over IPv6

const BLOCKED_HOSTNAMES = new Set([
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'instance-data.ec2.internal',
]);

export type UrlCheck =
  | { ok: true; url: URL }
  | { ok: false; reason: 'invalidUrl' | 'protocol' | 'credentialsInUrl' | 'blockedHost' | 'blockedAddress' };

/** Extracts an embedded IPv4 address from IPv4-mapped or -compatible IPv6. */
function embeddedIpv4(ip: string): string | null {
  const m = ip.toLowerCase().match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (m?.[1]) return m[1];
  const hex = ip.toLowerCase().match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex?.[1] && hex[2]) {
    const a = parseInt(hex[1], 16);
    const b = parseInt(hex[2], 16);
    return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
  }
  return null;
}

export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 0) return true;
  if (family === 4) return blocked.check(ip, 'ipv4');
  const v4 = embeddedIpv4(ip);
  if (v4) return blocked.check(v4, 'ipv4');
  return blocked.check(ip, 'ipv6');
}

function stripBrackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

/** Static checks of a URL before any connection is made. */
export function checkUrl(raw: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'invalidUrl' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'protocol' };
  if (url.username || url.password) return { ok: false, reason: 'credentialsInUrl' };
  const host = stripBrackets(url.hostname).toLowerCase().replace(/\.$/, '');
  if (BLOCKED_HOSTNAMES.has(host)) return { ok: false, reason: 'blockedHost' };
  if (isIP(host) && isBlockedAddress(host)) return { ok: false, reason: 'blockedAddress' };
  return { ok: true, url };
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/**
 * A `dns.lookup` replacement for socket connections that rejects blocked
 * addresses after resolution. Used by the HTTP client's connection pool.
 */
export function guardedLookup(hostname: string, options: object, callback: LookupCallback): void {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (BLOCKED_HOSTNAMES.has(host)) {
    callback(Object.assign(new Error('blocked host'), { code: 'EWARDARR_BLOCKED' }), '', 0);
    return;
  }
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 0);
    const list = (addresses as LookupAddress[]).filter((a) => !isBlockedAddress(a.address));
    if (list.length === 0) {
      callback(Object.assign(new Error('blocked address'), { code: 'EWARDARR_BLOCKED' }), '', 0);
      return;
    }
    if ((options as { all?: boolean }).all) callback(null, list);
    else callback(null, list[0]!.address, list[0]!.family);
  });
}
