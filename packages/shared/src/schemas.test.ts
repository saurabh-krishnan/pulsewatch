import { describe, expect, it } from 'vitest';
import {
  createMonitorSchema,
  createServiceSchema,
  ingestErrorSchema,
  linkCommitSchema,
  loginSchema,
  resolveIncidentSchema,
} from './schemas.js';

describe('linkCommitSchema', () => {
  const base = { kind: 'fixed_by' as const, repo: 'acme/payments-api' };

  it('accepts a commit SHA alone', () => {
    expect(linkCommitSchema.safeParse({ ...base, commitSha: '9f2c1ab' }).success).toBe(true);
  });

  it('accepts a PR URL alone', () => {
    expect(
      linkCommitSchema.safeParse({ ...base, prUrl: 'https://github.com/acme/x/pull/1' }).success,
    ).toBe(true);
  });

  it('rejects a link with neither, which would reference nothing', () => {
    const result = linkCommitSchema.safeParse(base);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]!.message).toMatch(/commit SHA, a PR URL, or both/);
    }
  });

  it('rejects empty strings as "provided"', () => {
    expect(linkCommitSchema.safeParse({ ...base, commitSha: '', prUrl: '' }).success).toBe(false);
  });

  it('rejects a PR URL that is not a URL', () => {
    expect(linkCommitSchema.safeParse({ ...base, prUrl: 'not-a-url' }).success).toBe(false);
  });
});

describe('createServiceSchema', () => {
  it('accepts an identifier-shaped name', () => {
    expect(createServiceSchema.safeParse({ name: 'payments-api' }).success).toBe(true);
  });

  it('rejects spaces and capitals, since the name is used like an identifier', () => {
    expect(createServiceSchema.safeParse({ name: 'Payments API' }).success).toBe(false);
  });

  it('defaults tags to empty and isPublic to true', () => {
    const parsed = createServiceSchema.parse({ name: 'svc' });
    expect(parsed.tags).toEqual([]);
    expect(parsed.isPublic).toBe(true);
  });
});

describe('createMonitorSchema', () => {
  const valid = {
    url: 'http://localhost:4100/health',
    intervalSeconds: 60,
    timeoutMs: 5000,
    expectedStatus: 200,
    failureThreshold: 3,
    recoveryThreshold: 2,
  };

  it('accepts a complete monitor', () => {
    expect(createMonitorSchema.safeParse(valid).success).toBe(true);
  });

  it('enforces the 30 second floor that the database also checks', () => {
    expect(createMonitorSchema.safeParse({ ...valid, intervalSeconds: 5 }).success).toBe(false);
  });

  it('coerces numeric strings, because form inputs give strings', () => {
    const parsed = createMonitorSchema.parse({ ...valid, intervalSeconds: '90' });
    expect(parsed.intervalSeconds).toBe(90);
  });

  it('requires an http(s) scheme', () => {
    // 'localhost:4100' satisfies z.url() on its own -- it parses as scheme
    // 'localhost:' with path '4100' -- so the scheme is checked explicitly.
    expect(createMonitorSchema.safeParse({ ...valid, url: 'localhost:4100' }).success).toBe(false);
    expect(createMonitorSchema.safeParse({ ...valid, url: 'ftp://example.com' }).success).toBe(
      false,
    );
    expect(
      createMonitorSchema.safeParse({ ...valid, url: 'https://example.com/health' }).success,
    ).toBe(true);
  });
});

describe('resolveIncidentSchema', () => {
  it('defaults to resolving with no runbook outcomes', () => {
    expect(resolveIncidentSchema.parse({})).toEqual({ runbooks: [] });
  });

  it('treats a missing outcome as "tried, unknown"', () => {
    const parsed = resolveIncidentSchema.parse({ runbooks: [{ runbookId: 3 }] });
    expect(parsed.runbooks[0]).toEqual({ runbookId: 3, worked: null });
  });

  it('keeps an explicit failure, which is the more valuable signal', () => {
    const parsed = resolveIncidentSchema.parse({ runbooks: [{ runbookId: 3, worked: false }] });
    expect(parsed.runbooks[0]!.worked).toBe(false);
  });
});

describe('ingestErrorSchema', () => {
  it('defaults severity to SEV3 so a minimal report still works', () => {
    const parsed = ingestErrorSchema.parse({ errorType: 'DB_TIMEOUT', message: 'boom' });
    expect(parsed.severity).toBe('SEV3');
  });

  it('requires both an error type and a message', () => {
    expect(ingestErrorSchema.safeParse({ message: 'boom' }).success).toBe(false);
    expect(ingestErrorSchema.safeParse({ errorType: 'X' }).success).toBe(false);
  });
});

describe('loginSchema', () => {
  it('normalizes the email so casing cannot create a second account', () => {
    expect(loginSchema.parse({ email: '  Ada@Example.COM ', password: 'x' }).email).toBe(
      'ada@example.com',
    );
  });
});
