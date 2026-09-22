import { describe, expect, it } from 'vitest';
import {
  FINGERPRINT_UPSERT_SQL,
  fingerprint,
  normalize,
  upsertFingerprint,
  type RawQueryClient,
} from './fingerprint.js';

describe('normalize — individual patterns', () => {
  it('replaces UUIDs', () => {
    expect(normalize('request 8f14e45f-ceea-467f-a4a0-3b2f1c6a9d10 failed')).toBe(
      'request <uuid> failed',
    );
  });

  it('replaces ISO timestamps with and without milliseconds or zone', () => {
    expect(normalize('at 2026-09-21T10:15:32Z')).toBe('at <ts>');
    expect(normalize('at 2026-09-21T10:15:32.123Z')).toBe('at <ts>');
    expect(normalize('at 2026-09-21T10:15:32+05:30')).toBe('at <ts>');
    expect(normalize('at 2026-09-21 10:15:32')).toBe('at <ts>');
  });

  it('replaces URLs including their query strings', () => {
    expect(normalize('GET https://api.example.com/v1/pay?id=8812 failed')).toBe(
      'get <url> failed',
    );
  });

  it('replaces email addresses', () => {
    expect(normalize('could not notify ops.team+alerts@example.co.uk')).toBe(
      'could not notify <email>',
    );
  });

  it('replaces IPv4 addresses but keeps the port as a number token', () => {
    expect(normalize('connecting to 10.0.3.17:5432')).toBe('connecting to <ip>:<num>');
  });

  it('replaces hex values in both 0x and bare long forms', () => {
    expect(normalize('at offset 0xdeadbeef')).toBe('at offset <hex>');
    // 16+ bare hex characters, e.g. a trace id
    expect(normalize('trace a3f9c2b18e7d45c6a0b1d')).toBe('trace <hex>');
  });

  it('replaces remaining bare numbers last', () => {
    expect(normalize('pool exhausted: 20/20 connections, waited 4200ms')).toBe(
      'pool exhausted: <num>/<num> connections, waited <num>ms',
    );
  });

  it('lowercases and collapses whitespace', () => {
    expect(normalize('  ERROR   Connection    Reset  ')).toBe('error connection reset');
  });

  it('leaves a message with no variable parts alone apart from casing', () => {
    expect(normalize('Connection pool exhausted')).toBe('connection pool exhausted');
  });

  it('handles an empty message without throwing', () => {
    expect(normalize('')).toBe('');
  });
});

describe('normalize — rule ordering', () => {
  it('replaces a UUID before the generic number rule can shred it', () => {
    // If \d+ ran first, this would become a mess of <num> fragments.
    const out = normalize('id 1b4e28ba-2fa1-11d2-883f-0016d3cca427');
    expect(out).toBe('id <uuid>');
    expect(out).not.toContain('<num>');
  });

  it('replaces a timestamp as one token rather than as numbers', () => {
    const out = normalize('2026-09-21T10:15:32Z ERROR something broke');
    expect(out).toBe('<ts> error something broke');
    expect(out).not.toContain('<num>');
  });

  it('replaces a URL whole, not its embedded numbers and dots', () => {
    const out = normalize('upstream https://sms.example.com/send?id=8812 returned 502');
    expect(out).toBe('upstream <url> returned <num>');
  });

  it('keeps an IP as one token rather than four numbers', () => {
    expect(normalize('ECONNREFUSED 10.0.2.44')).toBe('econnrefused <ip>');
  });
});

describe('normalize — the guide section 7.3 worked example', () => {
  const a =
    '2026-09-21T10:15:32Z ERROR Timeout after 5000ms connecting to 10.0.3.17:5432 (request 8f14e45f-ceea-467f-a4a0-3b2f1c6a9d10)';
  const b =
    '2026-09-24T03:01:09Z ERROR Timeout after 3000ms connecting to 10.0.3.22:5432 (request 1b4e28ba-2fa1-11d2-883f-0016d3cca427)';

  it('normalizes both to the documented form', () => {
    expect(normalize(a)).toBe(
      '<ts> error timeout after <num>ms connecting to <ip>:<num> (request <uuid>)',
    );
  });

  it('makes the two messages identical', () => {
    expect(normalize(a)).toBe(normalize(b));
  });
});

describe('fingerprint — messages that MUST match', () => {
  it('matches the same timeout with different durations, hosts and request ids', () => {
    expect(
      fingerprint('TIMEOUT', 'Timeout after 5000ms connecting to 10.0.3.17:5432'),
    ).toBe(fingerprint('TIMEOUT', 'Timeout after 3000ms connecting to 10.0.3.22:5432'));
  });

  it('matches the same 5xx from different URLs and ids', () => {
    expect(
      fingerprint('HTTP_5XX', 'HTTP 503 from https://api.example.com/v1/pay?id=8812'),
    ).toBe(fingerprint('HTTP_5XX', 'HTTP 503 from https://api.example.com/v1/pay?id=9931'));
  });

  it('matches the same pool exhaustion with different counts and waits', () => {
    expect(
      fingerprint('DB_TIMEOUT', 'connection pool exhausted: 20/20 connections in use, waited 4200ms'),
    ).toBe(
      fingerprint('DB_TIMEOUT', 'connection pool exhausted: 50/50 connections in use, waited 120ms'),
    );
  });

  it('ignores case and stray whitespace', () => {
    expect(fingerprint('UNKNOWN', 'Disk Usage At 97%')).toBe(
      fingerprint('UNKNOWN', '  disk   usage at 97%  '),
    );
  });
});

describe('fingerprint — messages that MUST NOT match', () => {
  it('separates different failures on the same service', () => {
    expect(fingerprint('TIMEOUT', 'Timeout after 5000ms connecting to 10.0.3.17:5432')).not.toBe(
      fingerprint('CONNECTION_REFUSED', 'ECONNREFUSED 10.0.3.17:5432'),
    );
  });

  it('separates the same text under a different error type', () => {
    const message = 'HTTP 503 Service Unavailable';
    expect(fingerprint('HTTP_5XX', message)).not.toBe(fingerprint('UNKNOWN', message));
  });

  it('separates genuinely different messages that share a shape', () => {
    expect(fingerprint('UNKNOWN', 'disk usage at 97% on /dev/sda1')).not.toBe(
      fingerprint('UNKNOWN', 'memory usage at 97% on /dev/sda1'),
    );
  });

  it('does not collapse everything: over-normalizing would be worse than under', () => {
    // Both contain only numbers as variable parts, but the words differ.
    expect(fingerprint('UNKNOWN', 'queue depth 500')).not.toBe(
      fingerprint('UNKNOWN', 'retry count 500'),
    );
  });
});

describe('upsertFingerprint', () => {
  /** Records what would have been sent to Postgres. */
  function stubClient(returns = [{ id: 7, occurrences: 3 }]) {
    const calls: { sql: string; values: unknown[] }[] = [];
    const db: RawQueryClient = {
      $queryRawUnsafe: async <T,>(sql: string, ...values: unknown[]) => {
        calls.push({ sql, values });
        return returns as T;
      },
    };
    return { db, calls };
  }

  it('stores the same normalized text that was hashed', async () => {
    // If these ever diverged, trigram search would compare against different
    // text than the hash grouped on, and near-matches would quietly go missing.
    const { db, calls } = stubClient();
    const message = 'Timeout after 5000ms connecting to 10.0.3.17:5432';
    await upsertFingerprint(db, 'TIMEOUT', message);

    const [hash, stored] = calls[0]!.values;
    expect(hash).toBe(fingerprint('TIMEOUT', message));
    expect(stored).toBe(normalize(message));
  });

  it('uses the upsert statement so concurrent sightings both count', async () => {
    const { db, calls } = stubClient();
    await upsertFingerprint(db, 'TIMEOUT', 'anything');
    expect(calls[0]!.sql).toBe(FINGERPRINT_UPSERT_SQL);
    expect(calls[0]!.sql).toContain('ON CONFLICT (hash) DO UPDATE');
    expect(calls[0]!.sql).toContain('occurrences = fingerprints.occurrences + 1');
  });

  it('returns the id and the running occurrence count', async () => {
    const { db } = stubClient([{ id: 42, occurrences: 9 }]);
    await expect(upsertFingerprint(db, 'TIMEOUT', 'anything')).resolves.toEqual({
      id: 42,
      occurrences: 9,
    });
  });
});

describe('fingerprint — properties', () => {
  it('is deterministic', () => {
    const f = () => fingerprint('TIMEOUT', 'Timeout after 5000ms');
    expect(f()).toBe(f());
  });

  it('returns a 64-character lowercase hex SHA-256 digest', () => {
    expect(fingerprint('TIMEOUT', 'anything')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('separates the type from the message so neither can forge the other', () => {
    // 'A|B' and 'A|' + 'B' must not be constructible from different splits.
    expect(fingerprint('HTTP', '500')).not.toBe(fingerprint('HTTP|500', ''));
  });
});
