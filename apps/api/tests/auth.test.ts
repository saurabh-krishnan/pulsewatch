import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, bearer, makeUser, prisma, resetDb } from './helpers.js';

beforeEach(resetDb);

describe('POST /api/auth/register', () => {
  const body = { name: 'Ada', email: 'ada@pulsewatch.test', password: 'correct-horse' };

  it('makes the first account an admin and later ones engineers', async () => {
    const first = await api().post('/api/auth/register').send(body);
    expect(first.status).toBe(201);
    expect(first.body.user.role).toBe('admin');
    expect(first.body.token).toEqual(expect.any(String));

    const second = await api()
      .post('/api/auth/register')
      .send({ ...body, email: 'eli@pulsewatch.test' });
    expect(second.body.user.role).toBe('engineer');
  });

  it('never returns the password hash', async () => {
    const res = await api().post('/api/auth/register').send(body);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|password_hash|\$2[aby]\$/);
  });

  it('stores a bcrypt hash, not the password', async () => {
    await api().post('/api/auth/register').send(body);
    const row = await prisma.user.findUniqueOrThrow({ where: { email: body.email } });
    expect(row.passwordHash).toMatch(/^\$2[aby]\$10\$/);
    expect(row.passwordHash).not.toContain(body.password);
  });

  it('refuses a duplicate email, whatever its casing', async () => {
    await api().post('/api/auth/register').send(body);
    const dup = await api()
      .post('/api/auth/register')
      .send({ ...body, email: 'ADA@PulseWatch.test' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('validates the body and says which field is wrong', async () => {
    const res = await api()
      .post('/api/auth/register')
      .send({ name: '', email: 'nope', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['name', 'email', 'password']));
  });
});

describe('POST /api/auth/login', () => {
  it('returns a token that works on /auth/me', async () => {
    const { user, password } = await makeUser('engineer');
    const login = await api().post('/api/auth/login').send({ email: user.email, password });
    expect(login.status).toBe(200);

    const me = await api().get('/api/auth/me').set(bearer(login.body.token));
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ id: user.id, email: user.email, role: 'engineer' });
  });

  it('accepts the email in any casing', async () => {
    const { user, password } = await makeUser('viewer');
    const res = await api()
      .post('/api/auth/login')
      .send({ email: user.email.toUpperCase(), password });
    expect(res.status).toBe(200);
  });

  it('gives an unknown email exactly the same answer as a wrong password', async () => {
    const { user } = await makeUser('engineer');
    const wrongPassword = await api()
      .post('/api/auth/login')
      .send({ email: user.email, password: 'not-it' });
    const unknownEmail = await api()
      .post('/api/auth/login')
      .send({ email: 'nobody@pulsewatch.test', password: 'not-it' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(unknownEmail.body).toEqual(wrongPassword.body);
  });

  it('still runs bcrypt for an unknown email, so timing does not reveal it', async () => {
    // The identical message above is not enough on its own: skipping bcrypt
    // for unknown emails made them answer ~50ms faster. This pins the fix.
    const compare = vi.spyOn(bcrypt, 'compare');
    await api()
      .post('/api/auth/login')
      .send({ email: 'nobody@pulsewatch.test', password: 'whatever' });
    expect(compare).toHaveBeenCalledTimes(1);
    compare.mockRestore();
  });
});

describe('GET /api/auth/me — token handling', () => {
  const secret = process.env.JWT_SECRET!;

  it('requires a token', async () => {
    const res = await api().get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a malformed token', async () => {
    const res = await api().get('/api/auth/me').set(bearer('not.a.jwt'));
    expect(res.status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const { user } = await makeUser('admin');
    const expired = jwt.sign(
      { sub: user.id, email: user.email, role: 'admin', exp: Math.floor(Date.now() / 1000) - 60 },
      secret,
    );
    const res = await api().get('/api/auth/me').set(bearer(expired));
    expect(res.status).toBe(401);
  });

  it('rejects a token signed with a different secret', async () => {
    const { user } = await makeUser('admin');
    const forged = jwt.sign({ sub: user.id, email: user.email, role: 'admin' }, 'attacker-secret');
    const res = await api().get('/api/auth/me').set(bearer(forged));
    expect(res.status).toBe(401);
  });

  it('rejects a token whose role was edited, because the signature no longer matches', async () => {
    const { token } = await makeUser('viewer');
    const [header, payload, signature] = token.split('.');
    const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString());
    const promoted = Buffer.from(JSON.stringify({ ...claims, role: 'admin' })).toString('base64url');

    const res = await api()
      .post('/api/services')
      .set(bearer(`${header}.${promoted}.${signature}`))
      .send({ name: 'escalated' });
    expect(res.status).toBe(401);
  });

  it('rejects the "none" algorithm', async () => {
    const { user } = await makeUser('admin');
    const unsigned = jwt.sign({ sub: user.id, email: user.email, role: 'admin' }, '', {
      algorithm: 'none',
    });
    const res = await api().get('/api/auth/me').set(bearer(unsigned));
    expect(res.status).toBe(401);
  });

  it('rejects a valid token for an account that no longer exists', async () => {
    const { user, token } = await makeUser('engineer');
    await prisma.user.delete({ where: { id: user.id } });
    const res = await api().get('/api/auth/me').set(bearer(token));
    expect(res.status).toBe(401);
  });
});
