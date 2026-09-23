/**
 * Who can do what. Every write is gated, and the gate is on the server: the UI
 * hiding a button is a convenience, never the control.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { api, bearer, makeService, makeUser, resetDb, VALID_MONITOR } from './helpers.js';

let admin: string;
let engineer: string;
let viewer: string;
let serviceId: number;

beforeEach(async () => {
  await resetDb();
  admin = (await makeUser('admin')).token;
  engineer = (await makeUser('engineer')).token;
  viewer = (await makeUser('viewer')).token;
  serviceId = (await makeService('payments-api')).id;
});

describe('unauthenticated requests', () => {
  it.each([
    ['get', '/api/services'],
    ['get', '/api/incidents'],
    ['get', '/api/runbooks'],
    ['get', '/api/search?q=pool'],
    ['get', '/api/stats/overview'],
    ['post', '/api/services'],
    ['post', '/api/incidents'],
  ] as const)('%s %s -> 401', async (method, path) => {
    const res = await api()[method](path).send({});
    expect(res.status).toBe(401);
  });

  it('can still reach the two deliberately public routes', async () => {
    expect((await api().get('/api/health')).status).toBe(200);
    expect((await api().get('/api/public/status')).status).toBe(200);
  });
});

describe('viewer: read-only', () => {
  it('can read', async () => {
    for (const path of ['/api/services', '/api/incidents', '/api/runbooks', '/api/stats/overview']) {
      expect((await api().get(path).set(bearer(viewer))).status).toBe(200);
    }
  });

  it.each([
    ['post', '/api/services', { name: 'nope' }],
    ['post', '/api/incidents', { serviceId: 1, title: 'nope nope' }],
    ['post', '/api/runbooks', { title: 'nope', bodyMd: 'x' }],
  ] as const)('cannot %s %s', async (method, path, body) => {
    const res = await api()[method](path).set(bearer(viewer)).send(body);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('cannot acknowledge an incident', async () => {
    const created = await api()
      .post('/api/incidents')
      .set(bearer(engineer))
      .send({ serviceId, title: 'Something broke' });
    const res = await api()
      .post(`/api/incidents/${created.body.id}/acknowledge`)
      .set(bearer(viewer));
    expect(res.status).toBe(403);
  });
});

describe('engineer: handles incidents, not infrastructure', () => {
  it('can open incidents and write runbooks', async () => {
    const incident = await api()
      .post('/api/incidents')
      .set(bearer(engineer))
      .send({ serviceId, title: 'Checkout failing' });
    expect(incident.status).toBe(201);

    const runbook = await api()
      .post('/api/runbooks')
      .set(bearer(engineer))
      .send({ title: 'Restart the pool', bodyMd: '# Steps' });
    expect(runbook.status).toBe(201);
  });

  it('cannot create services, monitors or API keys', async () => {
    expect(
      (await api().post('/api/services').set(bearer(engineer)).send({ name: 'nope' })).status,
    ).toBe(403);
    expect(
      (
        await api()
          .post(`/api/services/${serviceId}/monitors`)
          .set(bearer(engineer))
          .send(VALID_MONITOR)
      ).status,
    ).toBe(403);
    expect(
      (await api().post(`/api/services/${serviceId}/api-keys`).set(bearer(engineer))).status,
    ).toBe(403);
  });

  it('cannot delete a runbook', async () => {
    const runbook = await api()
      .post('/api/runbooks')
      .set(bearer(engineer))
      .send({ title: 'Mine', bodyMd: 'x' });
    const res = await api().delete(`/api/runbooks/${runbook.body.id}`).set(bearer(engineer));
    expect(res.status).toBe(403);
  });
});

describe('admin', () => {
  it('can create services, monitors and API keys', async () => {
    const svc = await api().post('/api/services').set(bearer(admin)).send({ name: 'search-api' });
    expect(svc.status).toBe(201);

    const monitor = await api()
      .post(`/api/services/${svc.body.id}/monitors`)
      .set(bearer(admin))
      .send(VALID_MONITOR);
    expect(monitor.status).toBe(201);

    const key = await api().post(`/api/services/${svc.body.id}/api-keys`).set(bearer(admin));
    expect(key.status).toBe(201);
  });
});
