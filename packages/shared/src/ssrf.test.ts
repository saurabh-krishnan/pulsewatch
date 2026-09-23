import { describe, expect, it } from 'vitest';
import {
  BlockedTargetError,
  blockedRangeFor,
  checkMonitorUrl,
  createGuardedLookup,
  isIpLiteral,
  normalizeHost,
  parseIPv4,
  parseIPv6,
  type Resolver,
  type TargetPolicy,
} from './ssrf.js';

const STRICT: TargetPolicy = { allowPrivate: false };

/** A resolver that answers from a table, so no test depends on real DNS. */
function fakeDns(table: Record<string, string[]>): Resolver {
  return async (host) => {
    const hit = table[host];
    if (!hit) throw Object.assign(new Error(`ENOTFOUND ${host}`), { code: 'ENOTFOUND' });
    return hit;
  };
}

const blocked = async (url: string, resolve: Resolver = fakeDns({})) =>
  (await checkMonitorUrl(url, STRICT, resolve)).ok === false;

describe('parseIPv4', () => {
  it('parses dotted decimal', () => {
    expect(parseIPv4('10.0.3.17')).toEqual([10, 0, 3, 17]);
  });

  it('rejects anything that is not exactly four octets in range', () => {
    expect(parseIPv4('256.0.0.1')).toBeNull();
    expect(parseIPv4('10.0.3')).toBeNull();
    expect(parseIPv4('10.0.3.17.5')).toBeNull();
    expect(parseIPv4('example.com')).toBeNull();
    expect(parseIPv4('')).toBeNull();
  });
});

describe('parseIPv6', () => {
  it('expands compressed forms', () => {
    expect(parseIPv6('::1')).toEqual([...Array(15).fill(0), 1]);
    expect(parseIPv6('::')).toEqual(Array(16).fill(0));
    expect(parseIPv6('fe80::1')!.slice(0, 2)).toEqual([0xfe, 0x80]);
  });

  it('accepts brackets and zone ids', () => {
    expect(parseIPv6('[::1]')).toEqual(parseIPv6('::1'));
    expect(parseIPv6('fe80::1%eth0')).toEqual(parseIPv6('fe80::1'));
  });

  it('reads an embedded dotted IPv4 tail', () => {
    expect(parseIPv6('::ffff:127.0.0.1')!.slice(10)).toEqual([0xff, 0xff, 127, 0, 0, 1]);
  });

  it('parses a full eight-group address', () => {
    expect(parseIPv6('2001:db8:0:0:0:0:0:1')).toHaveLength(16);
  });

  it('rejects malformed input', () => {
    expect(parseIPv6('1::2::3')).toBeNull(); // two '::'
    expect(parseIPv6('1:2:3')).toBeNull(); // too few groups, no '::'
    expect(parseIPv6('gggg::1')).toBeNull();
    expect(parseIPv6('1:2:3:4:5:6:7:8::')).toBeNull(); // '::' with nothing to fill
    expect(parseIPv6('::ffff:300.0.0.1')).toBeNull();
    expect(parseIPv6('10.0.0.1')).toBeNull();
  });
});

describe('blockedRangeFor — every range the guide names', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['127.255.255.254', 'loopback'],
    ['10.0.0.1', 'private network'],
    ['10.255.255.255', 'private network'],
    ['172.16.0.1', 'private network'],
    ['172.31.255.255', 'private network'],
    ['192.168.1.1', 'private network'],
    ['169.254.169.254', 'link-local, including the cloud metadata service'],
  ])('blocks %s (%s)', (ip, why) => {
    expect(blockedRangeFor(ip)).toBe(why);
  });

  it('respects the exact edges of 172.16.0.0/12', () => {
    expect(blockedRangeFor('172.15.255.255')).toBeNull();
    expect(blockedRangeFor('172.32.0.0')).toBeNull();
  });
});

describe('blockedRangeFor — ranges beyond the guide', () => {
  it.each([
    ['0.0.0.0'],
    ['100.64.0.1'],
    ['192.0.0.8'],
    ['198.18.0.1'],
    ['224.0.0.1'],
    ['255.255.255.255'],
  ])('blocks %s', (ip) => {
    expect(blockedRangeFor(ip)).not.toBeNull();
  });

  it.each([['8.8.8.8'], ['1.1.1.1'], ['93.184.216.34'], ['100.63.255.255']])(
    'allows the public address %s',
    (ip) => {
      expect(blockedRangeFor(ip)).toBeNull();
    },
  );
});

describe('blockedRangeFor — IPv6', () => {
  it.each([
    ['::1', 'loopback'],
    ['::', 'unspecified address'],
    ['fe80::1', 'link-local'],
    ['fc00::1', 'unique local address'],
    ['fd12:3456::1', 'unique local address'],
    ['fec0::1', 'site-local'],
    ['ff02::1', 'multicast'],
  ])('blocks %s (%s)', (ip, why) => {
    expect(blockedRangeFor(ip)).toBe(why);
  });

  it('judges IPv4-mapped addresses by the IPv4 inside them', () => {
    expect(blockedRangeFor('::ffff:127.0.0.1')).toBe('loopback');
    // The same address as the URL parser normalizes it, in hex:
    expect(blockedRangeFor('::ffff:7f00:1')).toBe('loopback');
    expect(blockedRangeFor('::ffff:a9fe:a9fe')).toMatch(/metadata/);
    expect(blockedRangeFor('::ffff:8.8.8.8')).toBeNull();
  });

  it('sees through NAT64, 6to4 and the old IPv4-compatible form', () => {
    expect(blockedRangeFor('64:ff9b::a00:1')).toBe('private network'); // 10.0.0.1
    expect(blockedRangeFor('2002:7f00:1::')).toBe('loopback'); // 127.0.0.1
    expect(blockedRangeFor('::10.0.0.1')).toBe('private network');
  });

  it('allows ordinary global IPv6', () => {
    expect(blockedRangeFor('2606:4700:4700::1111')).toBeNull();
  });

  it('returns null for things that are not addresses at all', () => {
    expect(blockedRangeFor('example.com')).toBeNull();
  });
});

describe('checkMonitorUrl — literal addresses and reserved names', () => {
  it.each([
    'http://127.0.0.1/health',
    'http://10.0.0.5:8080/admin',
    'http://172.20.1.1/',
    'http://192.168.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://[::ffff:169.254.169.254]/',
    'http://localhost:4000/api/health',
    'http://LOCALHOST/',
    'http://localhost./', // trailing dot is the same host
    'http://api.localhost/',
    'http://metadata.google.internal/computeMetadata/v1/',
  ])('blocks %s', async (url) => {
    expect(await blocked(url)).toBe(true);
  });

  it('explains why', async () => {
    const r = await checkMonitorUrl('http://169.254.169.254/', STRICT);
    expect(r).toEqual({
      ok: false,
      reason: '169.254.169.254 is a link-local, including the cloud metadata service address',
    });
  });
});

describe('checkMonitorUrl — encoding tricks the URL parser normalizes', () => {
  // Each of these is 127.0.0.1 in disguise. They work because new URL()
  // canonicalizes the host to dotted decimal before the check runs.
  it.each([
    ['decimal', 'http://2130706433/'],
    ['hex', 'http://0x7f000001/'],
    ['octal', 'http://0177.0.0.1/'],
    ['short form', 'http://127.1/'],
    ['mixed', 'http://0x7f.0.0.1/'],
  ])('blocks the %s form of 127.0.0.1', async (_name, url) => {
    expect(await blocked(url)).toBe(true);
  });

  it('blocks the metadata address hidden behind a username', async () => {
    const r = await checkMonitorUrl('http://trusted.example.com@169.254.169.254/', STRICT);
    expect(r.ok).toBe(false);
  });
});

describe('checkMonitorUrl — DNS', () => {
  it('allows a hostname that resolves publicly', async () => {
    const dns = fakeDns({ 'api.example.com': ['93.184.216.34'] });
    expect(await checkMonitorUrl('https://api.example.com/health', STRICT, dns)).toEqual({
      ok: true,
    });
  });

  it('blocks a hostname that resolves to a private address', async () => {
    const dns = fakeDns({ 'sneaky.example.com': ['10.0.0.7'] });
    const r = await checkMonitorUrl('http://sneaky.example.com/', STRICT, dns);
    expect(r).toEqual({
      ok: false,
      reason: 'sneaky.example.com resolves to 10.0.0.7 (private network)',
    });
  });

  it('blocks if ANY resolved address is private, not just the first', async () => {
    const dns = fakeDns({ 'mixed.example.com': ['93.184.216.34', '127.0.0.1'] });
    expect(await blocked('http://mixed.example.com/', dns)).toBe(true);
  });

  it('blocks a public name pointing at IPv6 loopback', async () => {
    const dns = fakeDns({ 'v6.example.com': ['::1'] });
    expect(await blocked('http://v6.example.com/', dns)).toBe(true);
  });

  it('allows a name that does not resolve yet; the worker re-checks at connect time', async () => {
    expect(await checkMonitorUrl('http://not-yet.example.test/', STRICT, fakeDns({}))).toEqual({
      ok: true,
    });
  });
});

describe('checkMonitorUrl — other rules', () => {
  it('only allows http and https', async () => {
    for (const url of ['ftp://example.com/', 'file:///etc/passwd', 'gopher://example.com/']) {
      expect(await checkMonitorUrl(url, STRICT)).toEqual({
        ok: false,
        reason: 'only http and https URLs can be monitored',
      });
    }
  });

  it('rejects embedded credentials even when the host is fine', async () => {
    const dns = fakeDns({ 'api.example.com': ['93.184.216.34'] });
    const r = await checkMonitorUrl('https://user:secret@api.example.com/', STRICT, dns);
    expect(r).toEqual({ ok: false, reason: 'URLs with embedded credentials are not allowed' });
  });

  it('rejects garbage', async () => {
    expect(await checkMonitorUrl('not a url', STRICT)).toEqual({
      ok: false,
      reason: 'not a valid URL',
    });
  });

  it('lets everything through when private targets are allowed (local development)', async () => {
    const dev: TargetPolicy = { allowPrivate: true };
    expect(await checkMonitorUrl('http://localhost:4100/health', dev)).toEqual({ ok: true });
    expect(await checkMonitorUrl('http://169.254.169.254/', dev)).toEqual({ ok: true });
  });

  it('exempts exactly the allow-listed hosts and nothing else', async () => {
    const policy: TargetPolicy = { allowPrivate: false, allowHosts: ['Demo-Target.internal'] };
    const dns = fakeDns({ 'demo-target.internal': ['10.0.0.9'], 'other.internal': ['10.0.0.9'] });
    expect(await checkMonitorUrl('http://demo-target.internal/health', policy, dns)).toEqual({
      ok: true,
    });
    expect((await checkMonitorUrl('http://other.internal/health', policy, dns)).ok).toBe(false);
  });

  it('still refuses credentials for an allow-listed host', async () => {
    const policy: TargetPolicy = { allowPrivate: true, allowHosts: ['demo.internal'] };
    expect((await checkMonitorUrl('http://a:b@demo.internal/', policy)).ok).toBe(false);
  });
});

describe('normalizeHost and isIpLiteral', () => {
  it('normalizes case, brackets and trailing dots', () => {
    expect(normalizeHost('LOCALHOST.')).toBe('localhost');
    expect(normalizeHost('[::1]')).toBe('::1');
    expect(normalizeHost('Example.COM..')).toBe('example.com');
  });

  it('recognizes literals of both families', () => {
    expect(isIpLiteral('10.0.0.1')).toBe(true);
    expect(isIpLiteral('::1')).toBe(true);
    expect(isIpLiteral('example.com')).toBe(false);
  });
});

describe('createGuardedLookup — the connect-time check', () => {
  // 'localhost' resolves from the hosts file, so these run without a network.
  function lookupOnce(policy: TargetPolicy, all: boolean) {
    const lookup = createGuardedLookup(policy);
    return new Promise<{ err: unknown; result: unknown }>((resolve) => {
      (lookup as unknown as (...a: unknown[]) => void)(
        'localhost',
        { all },
        (err: unknown, address: unknown) => resolve({ err, result: address }),
      );
    });
  }

  it('refuses to hand back a loopback address under a strict policy', async () => {
    const { err } = await lookupOnce(STRICT, false);
    expect(err).toBeInstanceOf(BlockedTargetError);
    expect((err as BlockedTargetError).code).toBe('ERR_SSRF_BLOCKED');
  });

  it('refuses in all-addresses mode too, which newer Node versions use by default', async () => {
    const { err } = await lookupOnce(STRICT, true);
    expect(err).toBeInstanceOf(BlockedTargetError);
  });

  it('resolves normally when private targets are allowed', async () => {
    const single = await lookupOnce({ allowPrivate: true }, false);
    expect(single.err).toBeNull();
    expect(typeof single.result).toBe('string');

    const all = await lookupOnce({ allowPrivate: true }, true);
    expect(all.err).toBeNull();
    expect(Array.isArray(all.result)).toBe(true);
  });

  it('resolves an allow-listed host even under a strict policy', async () => {
    const { err } = await lookupOnce({ allowPrivate: false, allowHosts: ['localhost'] }, false);
    expect(err).toBeNull();
  });

  it('passes resolution failures through unchanged', async () => {
    const lookup = createGuardedLookup(STRICT);
    const err = await new Promise((resolve) => {
      (lookup as unknown as (...a: unknown[]) => void)(
        'does-not-exist.invalid',
        {},
        (e: unknown) => resolve(e),
      );
    });
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(BlockedTargetError);
  });
});
