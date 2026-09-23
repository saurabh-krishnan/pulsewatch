import { describe, expect, it } from 'vitest';
import { buildPostmortem, formatDuration, type PostmortemInput } from './postmortem.js';

const BASE: PostmortemInput = {
  id: 42,
  title: 'payments-api health check failing',
  serviceName: 'payments-api',
  severity: 'SEV2',
  source: 'monitor',
  errorType: 'DB_TIMEOUT',
  openedAt: '2026-09-21T10:15:00.000Z',
  acknowledgedAt: '2026-09-21T10:17:00.000Z',
  resolvedAt: '2026-09-21T10:38:00.000Z',
  resolutionNote: 'Restarted the DB connection pool',
  seenBefore: 1,
  commits: [],
  events: [
    {
      type: 'opened',
      message: '3 failed checks (Timeout after 5000ms)',
      createdAt: '2026-09-21T10:15:00.000Z',
      userName: null,
    },
    { type: 'alert_sent', message: 'Sent to Discord', createdAt: '2026-09-21T10:15:00.000Z', userName: null },
    { type: 'acknowledged', message: null, createdAt: '2026-09-21T10:17:00.000Z', userName: 'Riya' },
    {
      type: 'runbook_used',
      message: 'Restart DB pool — fixed it',
      createdAt: '2026-09-21T10:21:00.000Z',
      userName: 'Riya',
    },
    { type: 'resolved', message: null, createdAt: '2026-09-21T10:38:00.000Z', userName: 'Riya' },
  ],
};

describe('formatDuration', () => {
  it('reports minutes under an hour', () => {
    expect(formatDuration('2026-09-21T10:15:00Z', '2026-09-21T10:38:00Z')).toBe('23 min');
  });

  it('reports hours and minutes beyond an hour', () => {
    expect(formatDuration('2026-09-21T10:00:00Z', '2026-09-21T12:34:00Z')).toBe('2h 34m');
  });

  it('reports sub-minute outages honestly rather than as 0 min', () => {
    expect(formatDuration('2026-09-21T10:00:00Z', '2026-09-21T10:00:20Z')).toBe('under a minute');
  });

  it('says ongoing when there is no end', () => {
    expect(formatDuration('2026-09-21T10:00:00Z', null)).toBe('ongoing');
  });
});

describe('buildPostmortem', () => {
  it('produces the header the guide describes', () => {
    const md = buildPostmortem(BASE);
    expect(md).toContain('# Postmortem: INC-42 payments-api health check failing');
    expect(md).toContain('**Severity:** SEV2');
    expect(md).toContain('**Duration:** 23 min');
    expect(md).toContain('**Detected by:** monitor');
  });

  it('renders every timeline event with its time and actor', () => {
    const md = buildPostmortem(BASE);
    expect(md).toContain('- 10:15 Opened: 3 failed checks (Timeout after 5000ms)');
    expect(md).toContain('- 10:15 Alert sent: Sent to Discord');
    expect(md).toContain('- 10:17 Acknowledged (Riya)');
    expect(md).toContain('- 10:21 Runbook used (Riya): Restart DB pool — fixed it');
    expect(md).toContain('- 10:38 Resolved (Riya)');
  });

  it('carries the resolution note into the Resolution section', () => {
    expect(buildPostmortem(BASE)).toContain('Restarted the DB connection pool');
  });

  it('leaves judgement calls blank rather than guessing', () => {
    const md = buildPostmortem(BASE);
    expect(md).toContain('## Root cause\n\n_(fill in)_');
    expect(md).toContain('## What went well / what went badly');
    expect(md).toContain('- [ ] _(fill in)_');
  });

  it('flags a repeat so the postmortem asks the right question', () => {
    const md = buildPostmortem({ ...BASE, seenBefore: 4 });
    expect(md).toContain('seen **4 times**');
    expect(md).toContain('symptom');
  });

  it('says nothing about repeats for a first occurrence', () => {
    expect(buildPostmortem({ ...BASE, seenBefore: 1 })).not.toContain('times**');
  });

  it('includes linked commits when there are any', () => {
    const md = buildPostmortem({
      ...BASE,
      commits: [
        { kind: 'fixed_by', repo: 'acme/payments-api', commitSha: '9f2c1ab3de45', prUrl: null },
        {
          kind: 'caused_by',
          repo: 'acme/payments-api',
          commitSha: null,
          prUrl: 'https://github.com/acme/payments-api/pull/1',
        },
      ],
    });
    expect(md).toContain('## Code');
    expect(md).toContain('Fixed by: `acme/payments-api@9f2c1ab3de`');
    expect(md).toContain('Caused by: `acme/payments-api`');
    expect(md).toContain('https://github.com/acme/payments-api/pull/1');
  });

  it('omits the Code section entirely when nothing is linked', () => {
    expect(buildPostmortem(BASE)).not.toContain('## Code');
  });

  it('handles an unresolved incident', () => {
    const md = buildPostmortem({ ...BASE, resolvedAt: null, resolutionNote: null });
    expect(md).toContain('**Duration:** ongoing');
    expect(md).toContain('## Resolution\n\n_(fill in)_');
  });

  it('handles an incident with no events without producing a broken document', () => {
    const md = buildPostmortem({ ...BASE, events: [] });
    expect(md).toContain('_No timeline events recorded._');
    expect(md).toContain('## Action items');
  });

  it('flattens multi-line event messages so the list stays a list', () => {
    const md = buildPostmortem({
      ...BASE,
      events: [
        { type: 'comment', message: 'line one\nline two', createdAt: BASE.openedAt, userName: 'Riya' },
      ],
    });
    expect(md).toContain('- 10:15 Comment (Riya): line one line two');
  });
});
