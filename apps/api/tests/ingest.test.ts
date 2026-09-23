/**
 * API keys and the ingest endpoint: hashing, one-time disclosure, revocation,
 * and deduplication by fingerprint.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { api, bearer, makeService, makeUser, prisma, resetDb } from './helpers.js';

let admin: string;
let serviceId: number;
let key: string;
let keyId: number;

const report = (body: object, apiKey: string | null = key) => {
  const req = api().post('/api/ingest/errors');
  if (apiKey) req.set('X-Api-Key', apiKey);
  return req.send(body);
};

beforeEach(async () => {
  await resetDb();
  admin = (await makeUser('admin')).token;
  serviceId = (await makeService('notifications')).id;
  const created = await api().post(`/api/services/${serviceId}/api-keys`).set(bearer(admin));
  key = created.body.key;
  keyId = created.body.id;
});

describe('API keys', () => {
  it('discloses the full key exactly once, at creation', async () => {
    expect(key).toMatch(/^pw_live_[0-9a-f]{48}$/);
    const listed = await api().get(`/api/services/${serviceId}/api-keys`).set(bearer(admin));
    expect(listed.body[0]).not.toHaveProperty('key');
    expect(JSON.stringify(listed.body)).not.toContain(key);
  });

  it('stores only a SHA-256 hash and a short prefix, never the key itself', async () => {
    const row = await prisma.apiKey.findUniqueOrThrow({ where: { id: keyId } });
    expect(row.keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.keyHash).not.toContain(key.slice(8));
    expect(key.startsWith(row.prefix)).toBe(true);
    expect(row.prefix.length).toBeLessThan(key.length / 2);
  });
});

describe('POST /api/ingest/errors — authentication', () => {
  it('requires a key', async () => {
    const res = await report({ errorType: 'X', message: 'y' }, null);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('MISSING_API_KEY');
  });

  it('rejects an unknown key', async () => {
    const res = await report({ errorType: 'X', message: 'y' }, 'pw_live_deadbeef');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_API_KEY');
  });

  it('rejects a revoked key with the same answer as an unknown one', async () => {
    await api().delete(`/api/services/${serviceId}/api-keys/${keyId}`).set(bearer(admin));
    const revoked = await report({ errorType: 'X', message: 'y' });
    const unknown = await report({ errorType: 'X', message: 'y' }, 'pw_live_nope');
    expect(revoked.status).toBe(401);
    expect(revoked.body).toEqual(unknown.body);
  });

  it('does not accept a JWT in place of a key', async () => {
    const res = await api()
      .post('/api/ingest/errors')
      .set(bearer(admin))
      .send({ errorType: 'X', message: 'y' });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/ingest/errors — deduplication', () => {
  const first = {
    errorType: 'DB_TIMEOUT',
    message: 'Timeout after 5000ms connecting to 10.0.9.11:5432',
    severity: 'SEV2',
  };
  const sameProblem = { ...first, message: 'Timeout after 3000ms connecting to 10.0.9.57:5432' };

  it('opens an incident on the first report, against the key\'s own service', async () => {
    const res = await report(first);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ created: true, occurrences: 1 });

    const incident = await prisma.incident.findUniqueOrThrow({ where: { id: res.body.incidentId } });
    expect(incident).toMatchObject({ serviceId, source: 'api', severity: 'SEV2', status: 'open' });
  });

  it('attaches the same problem with different numbers to the open incident', async () => {
    const a = await report(first);
    const b = await report(sameProblem);

    expect(b.status).toBe(200);
    expect(b.body).toMatchObject({ incidentId: a.body.incidentId, created: false, occurrences: 2 });
    expect(await prisma.incident.count()).toBe(1);

    const events = await prisma.incidentEvent.findMany({
      where: { incidentId: a.body.incidentId },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.map((e) => e.type)).toEqual(['opened', 'comment']);
    expect(events[1]!.message).toMatch(/^Seen again via ingest API/);
  });

  it('opens a separate incident for a genuinely different error', async () => {
    const a = await report(first);
    const b = await report({ errorType: 'QUEUE_BACKLOG', message: 'queue depth 91000' });
    expect(b.status).toBe(201);
    expect(b.body.incidentId).not.toBe(a.body.incidentId);
  });

  it('opens a new incident once the previous one is resolved', async () => {
    const a = await report(first);
    await prisma.incident.update({
      where: { id: a.body.incidentId },
      data: { status: 'resolved', resolvedAt: new Date() },
    });
    const b = await report(sameProblem);
    expect(b.status).toBe(201);
    expect(b.body.incidentId).not.toBe(a.body.incidentId);
    expect(b.body.occurrences).toBe(2); // the fingerprint still remembers
  });

  it('validates the report', async () => {
    const res = await report({ message: 'no type' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
