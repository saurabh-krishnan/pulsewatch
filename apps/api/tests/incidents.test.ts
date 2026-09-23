/**
 * The incident lifecycle end to end, against a real database, including the
 * incident-memory endpoints (pg_trgm similarity, Laplace-smoothed suggestions)
 * that unit tests can only reach with stubs.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { api, bearer, makeService, makeUser, prisma, resetDb } from './helpers.js';

let engineer: string;
let serviceId: number;

beforeEach(async () => {
  await resetDb();
  engineer = (await makeUser('engineer')).token;
  serviceId = (await makeService('payments-api')).id;
});

async function openIncident(description = 'connection pool exhausted: 20/20 in use, waited 4200ms') {
  const res = await api()
    .post('/api/incidents')
    .set(bearer(engineer))
    .send({
      serviceId,
      title: 'payments-api database timeouts',
      description,
      severity: 'SEV2',
      errorType: 'DB_TIMEOUT',
    });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

const timeline = async (id: number) =>
  (await api().get(`/api/incidents/${id}`).set(bearer(engineer))).body.events.map(
    (e: { type: string }) => e.type,
  );

describe('incident lifecycle', () => {
  it('opens with an "opened" event and a fingerprint', async () => {
    const id = await openIncident();
    const detail = await api().get(`/api/incidents/${id}`).set(bearer(engineer));
    expect(detail.body).toMatchObject({ status: 'open', source: 'manual', severity: 'SEV2' });
    expect(await timeline(id)).toEqual(['opened']);

    const row = await prisma.incident.findUniqueOrThrow({ where: { id } });
    expect(row.fingerprintId).not.toBeNull();
  });

  it('acknowledges once, and refuses to acknowledge twice', async () => {
    const id = await openIncident();
    const first = await api().post(`/api/incidents/${id}/acknowledge`).set(bearer(engineer));
    expect(first.status).toBe(200);
    expect(first.body.acknowledgedAt).not.toBeNull();

    const second = await api().post(`/api/incidents/${id}/acknowledge`).set(bearer(engineer));
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ALREADY_ACKNOWLEDGED');
  });

  it('logs a severity change with the before and after', async () => {
    const id = await openIncident();
    await api().patch(`/api/incidents/${id}`).set(bearer(engineer)).send({ severity: 'SEV1' });
    const events = await prisma.incidentEvent.findMany({ where: { incidentId: id } });
    expect(events.find((e) => e.type === 'severity_changed')?.message).toBe('SEV2 → SEV1');
  });

  it('records which runbooks were tried and whether they worked', async () => {
    const worked = await prisma.runbook.create({ data: { title: 'Restart pool', bodyMd: 'x' } });
    const failed = await prisma.runbook.create({ data: { title: 'Scale out', bodyMd: 'x' } });
    const unsure = await prisma.runbook.create({ data: { title: 'Clear cache', bodyMd: 'x' } });
    const id = await openIncident();

    const res = await api()
      .post(`/api/incidents/${id}/resolve`)
      .set(bearer(engineer))
      .send({
        note: 'Pool restart fixed it',
        runbooks: [
          { runbookId: worked.id, worked: true },
          { runbookId: failed.id, worked: false },
          { runbookId: unsure.id },
          { runbookId: 99999, worked: true }, // no such runbook: ignored, not a 500
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'resolved', resolutionNote: 'Pool restart fixed it' });

    const outcomes = await prisma.incidentRunbook.findMany({
      where: { incidentId: id },
      orderBy: { runbookId: 'asc' },
    });
    expect(outcomes.map((o) => [o.runbookId, o.worked])).toEqual([
      [worked.id, true],
      [failed.id, false],
      [unsure.id, null],
    ]);
    expect(await timeline(id)).toEqual([
      'opened',
      'runbook_used',
      'runbook_used',
      'runbook_used',
      'resolved',
    ]);
  });

  it('refuses to resolve twice or acknowledge after resolving', async () => {
    const id = await openIncident();
    await api().post(`/api/incidents/${id}/resolve`).set(bearer(engineer)).send({});

    const again = await api().post(`/api/incidents/${id}/resolve`).set(bearer(engineer)).send({});
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_RESOLVED');

    const ack = await api().post(`/api/incidents/${id}/acknowledge`).set(bearer(engineer));
    expect(ack.status).toBe(409);
  });

  it('still accepts comments after resolution, for the postmortem conversation', async () => {
    const id = await openIncident();
    await api().post(`/api/incidents/${id}/resolve`).set(bearer(engineer)).send({});
    const res = await api()
      .post(`/api/incidents/${id}/comments`)
      .set(bearer(engineer))
      .send({ message: 'Postmortem on Friday' });
    expect(res.status).toBe(201);
    expect((await timeline(id)).at(-1)).toBe('comment');
  });

  it('rejects an empty comment', async () => {
    const id = await openIncident();
    const res = await api()
      .post(`/api/incidents/${id}/comments`)
      .set(bearer(engineer))
      .send({ message: '   ' });
    expect(res.status).toBe(400);
  });

  it('404s for an incident that does not exist', async () => {
    const res = await api().post('/api/incidents/424242/acknowledge').set(bearer(engineer));
    expect(res.status).toBe(404);
  });

  it('filters the list by status', async () => {
    const a = await openIncident();
    await openIncident('something else entirely');
    await api().post(`/api/incidents/${a}/resolve`).set(bearer(engineer)).send({});

    const open = await api().get('/api/incidents?status=open').set(bearer(engineer));
    expect(open.body).toHaveLength(1);
    const resolved = await api().get('/api/incidents?status=resolved').set(bearer(engineer));
    expect(resolved.body.map((i: { id: number }) => i.id)).toEqual([a]);
  });

  it('builds a postmortem from the timeline', async () => {
    const id = await openIncident();
    await api().post(`/api/incidents/${id}/acknowledge`).set(bearer(engineer));
    await api()
      .post(`/api/incidents/${id}/resolve`)
      .set(bearer(engineer))
      .send({ note: 'Restarted the pool' });

    const res = await api().get(`/api/incidents/${id}/postmortem`).set(bearer(engineer));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/markdown/);
    expect(res.text).toContain(`# Postmortem: INC-${id} payments-api database timeouts`);
    expect(res.text).toMatch(/Acknowledged \(engineer \d+\)/);
    expect(res.text).toContain('Restarted the pool');
  });
});

describe('incident memory against a real database', () => {
  it('finds a past incident with the same failure and different numbers', async () => {
    const past = await openIncident('connection pool exhausted: 20/20 in use, waited 4200ms');
    await api().post(`/api/incidents/${past}/resolve`).set(bearer(engineer)).send({});

    const now = await openIncident('connection pool exhausted: 50/50 in use, waited 900ms');
    const res = await api().get(`/api/incidents/${now}/similar`).set(bearer(engineer));

    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ id: past });
    expect(res.body[0].reasons).toContain('same fingerprint');
    expect(res.body[0].score).toBeGreaterThanOrEqual(100);
  });

  it('does not match an open incident, only resolved history', async () => {
    const stillOpen = await openIncident();
    const now = await openIncident();
    const res = await api().get(`/api/incidents/${now}/similar`).set(bearer(engineer));
    expect(res.body.map((s: { id: number }) => s.id)).not.toContain(stillOpen);
  });

  it('suggests the runbook that fixed it, Laplace-smoothed', async () => {
    const runbook = await prisma.runbook.create({ data: { title: 'Restart pool', bodyMd: 'x' } });
    for (const worked of [true, true, false]) {
      const id = await openIncident();
      await api()
        .post(`/api/incidents/${id}/resolve`)
        .set(bearer(engineer))
        .send({ runbooks: [{ runbookId: runbook.id, worked }] });
    }

    const now = await openIncident();
    const res = await api().get(`/api/incidents/${now}/suggestions`).set(bearer(engineer));
    expect(res.body).toEqual([
      {
        runbookId: runbook.id,
        title: 'Restart pool',
        timesTried: 3,
        timesWorked: 2,
        successRate: 3 / 5, // (2 + 1) / (3 + 2)
      },
    ]);
  });
});
