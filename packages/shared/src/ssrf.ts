/**
 * SSRF protection for user-supplied monitor URLs (guide Phase 7).
 *
 * Without this, anyone who can create a monitor can make the worker issue
 * requests to the server's own network: the cloud metadata service at
 * 169.254.169.254, an admin panel on 10.0.0.5, the database on localhost.
 *
 * Node-only (it resolves DNS), so it is exposed as '@pulsewatch/shared/ssrf'
 * rather than through the browser-safe root entry.
 *
 * Defence is layered:
 *   1. The API checks the URL when a monitor is saved, for a clear error.
 *   2. The worker checks again before every request, because DNS changes.
 *   3. The worker's connection resolves hosts through `createGuardedLookup`,
 *      which checks the address actually being connected to. That closes the
 *      DNS-rebinding gap between "checked" and "connected" that 1 and 2 leave.
 */
import dns from 'node:dns';
import type { LookupFunction } from 'node:net';

export class BlockedTargetError extends Error {
  readonly code = 'ERR_SSRF_BLOCKED';
  constructor(message: string) {
    super(message);
    this.name = 'BlockedTargetError';
  }
}

// ---------------------------------------------------------------------------
// Address parsing. Strict on purpose: the WHATWG URL parser has already
// normalized decimal, octal and hex IPv4 forms ('http://2130706433/',
// 'http://0x7f.1/') into dotted decimal before this code sees them, and DNS
// results are canonical, so anything unusual here is a reason to refuse.
// ---------------------------------------------------------------------------

export function parseIPv4(s: string): number[] | null {
  const parts = s.split('.');
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    bytes.push(n);
  }
  return bytes;
}

/** Returns the 16 bytes of an IPv6 address, or null if it is not one. */
export function parseIPv6(input: string): number[] | null {
  let s = input.toLowerCase();
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  if (!s.includes(':')) return null;

  // An embedded dotted IPv4 tail ('::ffff:127.0.0.1') stands in for two groups.
  let v4Tail: number[] | null = null;
  const lastColon = s.lastIndexOf(':');
  if (s.slice(lastColon + 1).includes('.')) {
    v4Tail = parseIPv4(s.slice(lastColon + 1));
    if (!v4Tail) return null;
    s = `${s.slice(0, lastColon + 1)}0:0`;
  }

  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];

  let groups: string[];
  if (halves.length === 1) {
    if (head.length !== 8) return null;
    groups = head;
  } else {
    const fill = 8 - head.length - tail.length;
    if (fill < 1) return null;
    groups = [...head, ...Array<string>(fill).fill('0'), ...tail];
  }

  const bytes: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    const n = parseInt(g, 16);
    bytes.push(n >> 8, n & 0xff);
  }
  if (v4Tail) bytes.splice(12, 4, ...v4Tail);
  return bytes;
}

function ipv4ToInt(b: number[]): number {
  return ((b[0]! << 24) >>> 0) + (b[1]! << 16) + (b[2]! << 8) + b[3]!;
}

/** [network, prefix length, why it is blocked] */
const BLOCKED_V4: [string, number, string][] = [
  ['0.0.0.0', 8, '"this network"'],
  ['10.0.0.0', 8, 'private network'],
  ['100.64.0.0', 10, 'carrier-grade NAT'],
  ['127.0.0.0', 8, 'loopback'],
  ['169.254.0.0', 16, 'link-local, including the cloud metadata service'],
  ['172.16.0.0', 12, 'private network'],
  ['192.0.0.0', 24, 'IETF protocol assignments'],
  ['192.168.0.0', 16, 'private network'],
  ['198.18.0.0', 15, 'benchmarking'],
  ['224.0.0.0', 4, 'multicast'],
  ['240.0.0.0', 4, 'reserved'],
];

function blockedV4(bytes: number[]): string | null {
  const ip = ipv4ToInt(bytes);
  for (const [net, bits, why] of BLOCKED_V4) {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    if ((ip & mask) >>> 0 === (ipv4ToInt(parseIPv4(net)!) & mask) >>> 0) return why;
  }
  return null;
}

function blockedV6(b: number[]): string | null {
  const zeroes = (from: number, to: number) => b.slice(from, to).every((x) => x === 0);

  if (zeroes(0, 16)) return 'unspecified address';
  if (zeroes(0, 15) && b[15] === 1) return 'loopback';

  // Addresses that carry an IPv4 address inside them are judged by that
  // IPv4 address, otherwise '::ffff:127.0.0.1' would walk straight past.
  if (zeroes(0, 10) && b[10] === 0xff && b[11] === 0xff) return blockedV4(b.slice(12));
  if (zeroes(0, 12)) return blockedV4(b.slice(12)); // deprecated IPv4-compatible
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && zeroes(4, 12)) {
    return blockedV4(b.slice(12)); // NAT64
  }
  if (b[0] === 0x20 && b[1] === 0x02) return blockedV4(b.slice(2, 6)); // 6to4

  if ((b[0]! & 0xfe) === 0xfc) return 'unique local address';
  if (b[0] === 0xfe && (b[1]! & 0xc0) === 0x80) return 'link-local';
  if (b[0] === 0xfe && (b[1]! & 0xc0) === 0xc0) return 'site-local';
  if (b[0] === 0xff) return 'multicast';
  return null;
}

/** Why an address is off-limits, or null if it is fine to connect to. */
export function blockedRangeFor(address: string): string | null {
  const v4 = parseIPv4(address);
  if (v4) return blockedV4(v4);
  const v6 = parseIPv6(address);
  if (v6) return blockedV6(v6);
  return null;
}

export function isIpLiteral(host: string): boolean {
  return parseIPv4(host) !== null || parseIPv6(host) !== null;
}

// ---------------------------------------------------------------------------
// URL policy
// ---------------------------------------------------------------------------

export interface TargetPolicy {
  /** Local development: let monitors reach localhost and private ranges. */
  allowPrivate: boolean;
  /** Exact hostnames exempt from the check, e.g. an internal demo target. */
  allowHosts?: string[];
}

export type TargetCheck = { ok: true } | { ok: false; reason: string };

export type Resolver = (host: string) => Promise<string[]>;

const RESERVED_NAMES = new Set(['localhost', 'metadata.google.internal']);

/** Lowercase, no brackets, no trailing dot: 'LOCALHOST.' and 'localhost' are one host. */
export function normalizeHost(hostname: string): string {
  let h = hostname.toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  while (h.endsWith('.')) h = h.slice(0, -1);
  return h;
}

const defaultResolver: Resolver = async (host) => {
  const results = await dns.promises.lookup(host, { all: true, verbatim: true });
  return results.map((r) => r.address);
};

export async function checkMonitorUrl(
  raw: string,
  policy: TargetPolicy,
  resolve: Resolver = defaultResolver,
): Promise<TargetCheck> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'not a valid URL' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'only http and https URLs can be monitored' };
  }

  // Credentials in the URL would be stored in plain text and printed in the
  // worker's logs, and 'http://trusted@169.254.169.254' is a classic disguise.
  if (url.username || url.password) {
    return { ok: false, reason: 'URLs with embedded credentials are not allowed' };
  }

  const host = normalizeHost(url.hostname);
  if (policy.allowHosts?.map(normalizeHost).includes(host)) return { ok: true };
  if (policy.allowPrivate) return { ok: true };

  if (RESERVED_NAMES.has(host) || host.endsWith('.localhost')) {
    return { ok: false, reason: `${host} is a reserved local hostname` };
  }

  if (isIpLiteral(host)) {
    const why = blockedRangeFor(host);
    return why ? { ok: false, reason: `${host} is a ${why} address` } : { ok: true };
  }

  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    // Not resolvable right now. Nothing can be reached through it today, and
    // the worker's guarded lookup re-checks whatever it resolves to later.
    return { ok: true };
  }

  for (const address of addresses) {
    const why = blockedRangeFor(address);
    if (why) return { ok: false, reason: `${host} resolves to ${address} (${why})` };
  }
  return { ok: true };
}

/**
 * A `lookup` for http.request / net.connect that refuses to hand back a
 * blocked address. Because it runs as the socket connects, a hostname that
 * resolved to a public address at check time and a private one a moment later
 * (DNS rebinding) is still caught.
 */
export function createGuardedLookup(policy: TargetPolicy): LookupFunction {
  const allowHosts = new Set((policy.allowHosts ?? []).map(normalizeHost));

  return ((hostname: string, options: dns.LookupOptions, callback: (...args: unknown[]) => void) => {
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err);

      const list = addresses as dns.LookupAddress[];
      if (!policy.allowPrivate && !allowHosts.has(normalizeHost(hostname))) {
        for (const a of list) {
          const why = blockedRangeFor(a.address);
          if (why) {
            return callback(
              new BlockedTargetError(`${hostname} resolved to ${a.address} (${why})`),
            );
          }
        }
      }

      if (options.all) return callback(null, list);
      const first = list[0];
      if (!first) return callback(new Error(`No address found for ${hostname}`));
      return callback(null, first.address, first.family);
    });
  }) as unknown as LookupFunction;
}
