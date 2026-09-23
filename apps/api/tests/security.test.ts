/**
 * The HTTP-level hardening: security headers, CORS, how malformed input is
 * answered, and the public status page not leaking internals.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { api, bearer, makeMonitor, makeService, makeUser, prisma, resetDb } from './helpers.js';

beforeEach(resetDb);

describe('security headers (helmet)', () => {
  it('sets the standard protective headers', async () => {
    const res = await api().get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['strict-transport-security']).toMatch(/max-age=\d+/);
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('does not advertise the framework', async () => {
    const res = await api().get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('CORS', () => {
  it('allows the configured frontend origin', async () => {
    const res = await api().get('/api/health').set('Origin', 'http://localhost:5173');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('gives any other origin nothing to work with', async () => {
    const res = await api().get('/api/health').set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers a preflight only for the allowed origin', async () => {
    const ok = await api()
      .options('/api/services')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST');
    expect(ok.status).toBe(204);
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');

    const evil = await api()
      .options('/api/services')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('malformed input gets a 4xx, never a 500', () => {
  it('answers invalid JSON with 400', async () => {
    const res = await api()
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": "a@b.test", "password": ');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('answers an oversized body with 413', async () => {
    const res = await api()
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ email: 'a@b.test', password: 'x'.repeat(2 * 1024 * 1024) }));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('answers a non-numeric id with 400', async () => {
    const { token } = await makeUser('viewer');
    const res = await api().get('/api/incidents/abc').set(bearer(token));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PARAM');
  });

  it('answers an unknown filter value with 400', async () => {
    const { token } = await makeUser('viewer');
    const res = await api().get('/api/incidents?status=exploded').set(bearer(token));
    expect(res.status).toBe(400);
  });

  it('answers an unknown route with a structured 404', async () => {
    const res = await api().get('/api/definitely-not-a-route');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });
});

describe('search input is data, not SQL', () => {
  it('survives an injection attempt and leaves the table intact', async () => {
    const { token } = await makeUser('viewer');
    const svc = await makeService('payments-api');
    await prisma.incident.create({ data: { serviceId: svc.id, title: 'pool exhausted' } });

    for (const q of ["'; DROP TABLE incidents; --", "pool' OR '1'='1", 'pool & !timeout | (']) {
      const res = await api().get('/api/search').query({ q }).set(bearer(token));
      expect(res.status).toBe(200);
    }
    expect(await prisma.incident.count()).toBe(1);
  });
});

describe('GET /api/public/status', () => {
  it('needs no login and exposes nothing internal', async () => {
    const svc = await makeService('payments-api');
    await makeMonitor(svc.id, 'http://internal-host.example.test:8443/secret-health');
    await prisma.incident.create({
      data: { serviceId: svc.id, title: 'Leaky title', description: 'Error: secret stack trace' },
    });

    const res = await api().get('/api/public/status');
    expect(res.status).toBe(200);
    expect(res.body.services[0]).toMatchObject({ name: 'payments-api' });

    const body = JSON.stringify(res.body);
    expect(body).not.toContain('internal-host');
    expect(body).not.toContain('secret');
    expect(body).not.toContain('Leaky title');
  });

  it('leaves out services that are not marked public', async () => {
    await prisma.service.create({ data: { name: 'internal-tool', isPublic: false } });
    await makeService('payments-api');
    const res = await api().get('/api/public/status');
    expect(res.body.services.map((s: { name: string }) => s.name)).toEqual(['payments-api']);
  });

  it('always returns a full 90-day axis, even with no data', async () => {
    await makeService('payments-api');
    const res = await api().get('/api/public/status');
    expect(res.body.services[0].history).toHaveLength(90);
    expect(res.body.services[0].uptime90d).toBeNull();
  });
});
