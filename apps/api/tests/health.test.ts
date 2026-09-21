import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

describe('GET /api/health', () => {
  it('reports API and database status', async () => {
    const res = await request(createApp()).get('/api/health');
    // 503 when the database is not running; the shape is the same either way.
    expect([200, 503]).toContain(res.status);
    expect(res.body).toMatchObject({
      status: expect.stringMatching(/^(ok|degraded)$/),
      database: expect.stringMatching(/^(up|down)$/),
    });
  });

  it('returns a structured error for unknown routes', async () => {
    const res = await request(createApp()).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
