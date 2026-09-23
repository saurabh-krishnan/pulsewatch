/**
 * Rate limits. In a file of their own, because the limiter's counter lives in
 * the process: every test file gets a fresh module graph, so this is the only
 * file that spends login attempts on purpose.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { api, resetDb } from './helpers.js';

beforeEach(resetDb);

describe('login rate limit', () => {
  it('allows 10 attempts per window and refuses the 11th', async () => {
    const attempt = () =>
      api().post('/api/auth/login').send({ email: 'guess@pulsewatch.test', password: 'guess' });

    for (let i = 1; i <= 10; i++) {
      expect((await attempt()).status).toBe(401);
    }

    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    // Standard headers tell a well-behaved client when to come back.
    expect(blocked.headers['ratelimit-reset'] ?? blocked.headers['retry-after']).toBeDefined();
  });
});
