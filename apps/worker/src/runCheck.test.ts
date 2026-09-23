/**
 * runCheck against a real HTTP server on an ephemeral port. No mocks: this is
 * the actual socket path, including the guarded lookup.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { BlockedTargetError } from '@pulsewatch/shared/ssrf';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classifyError, runCheck, sendRequest, type CheckTarget } from './checker.js';

const DEV = { allowPrivate: true };
const STRICT = { allowPrivate: false };

let server: http.Server;
let base: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/ok') return res.writeHead(200).end('ok');
    if (req.url === '/down') return res.writeHead(503, 'Service Unavailable').end();
    if (req.url === '/slow') return setTimeout(() => res.writeHead(200).end(), 2000);
    if (req.url === '/redirect-to-metadata') {
      return res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }).end();
    }
    return res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  // Drop the /slow request that the timeout test walked away from.
  server.closeAllConnections();
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

const target = (path: string, over: Partial<CheckTarget> = {}): CheckTarget => ({
  url: `${base}${path}`,
  method: 'GET',
  timeoutMs: 1000,
  expectedStatus: 200,
  ...over,
});

describe('runCheck — the normal request path', () => {
  it('reports success with the status and a timing', async () => {
    const r = await runCheck(target('/ok'), DEV);
    expect(r).toMatchObject({ success: true, statusCode: 200, errorType: null, errorMessage: null });
    expect(r.responseTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('reports a 5xx with its reason phrase', async () => {
    const r = await runCheck(target('/down'), DEV);
    expect(r).toMatchObject({
      success: false,
      statusCode: 503,
      errorType: 'HTTP_5XX',
      errorMessage: 'HTTP 503 Service Unavailable',
    });
  });

  it('times out on the configured budget', async () => {
    const r = await runCheck(target('/slow', { timeoutMs: 200 }), DEV);
    expect(r.errorType).toBe('TIMEOUT');
    expect(r.errorMessage).toMatch(/^Timeout after 200ms connecting to localhost:\d+$/);
    expect(r.responseTimeMs).toBeLessThan(1500);
  });

  it('reports a refused connection', async () => {
    // Bind a port and release it, so nothing is listening there.
    const probe = http.createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const port = (probe.address() as AddressInfo).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    const r = await runCheck(
      { url: `http://127.0.0.1:${port}/`, method: 'GET', timeoutMs: 1000, expectedStatus: 200 },
      DEV,
    );
    expect(r.errorType).toBe('CONNECTION_REFUSED');
    expect(r.errorMessage).toBe(`ECONNREFUSED 127.0.0.1:${port}`);
  });

  it('does not follow redirects, so a public URL cannot bounce the worker inward', async () => {
    const r = await runCheck(target('/redirect-to-metadata'), DEV);
    expect(r.statusCode).toBe(302);
    expect(r.errorType).toBe('UNEXPECTED_STATUS');
  });
});

describe('runCheck — the SSRF policy is enforced', () => {
  it('refuses a loopback literal before connecting', async () => {
    const port = new URL(base).port;
    const r = await runCheck({ ...target('/ok'), url: `http://127.0.0.1:${port}/ok` }, STRICT);
    expect(r).toMatchObject({ success: false, statusCode: null, errorType: 'BLOCKED_TARGET' });
    expect(r.errorMessage).toMatch(/^Blocked by SSRF policy: 127\.0\.0\.1 is a loopback address$/);
  });

  it('refuses a reserved name that would resolve to loopback', async () => {
    const r = await runCheck(target('/ok'), STRICT);
    expect(r.errorType).toBe('BLOCKED_TARGET');
    expect(r.errorMessage).toMatch(/localhost is a reserved local hostname/);
  });

  it('refuses the cloud metadata address', async () => {
    const r = await runCheck(
      { url: 'http://169.254.169.254/latest/meta-data/', method: 'GET', timeoutMs: 500, expectedStatus: 200 },
      STRICT,
    );
    expect(r.errorType).toBe('BLOCKED_TARGET');
    expect(r.errorMessage).toMatch(/metadata/);
  });

  it('reaches the same server once that host is explicitly allow-listed', async () => {
    const r = await runCheck(target('/ok'), { allowPrivate: false, allowHosts: ['localhost'] });
    expect(r.success).toBe(true);
  });
});

describe('sendRequest — the connect-time guard, with no pre-check in front of it', () => {
  // runCheck's pre-check refuses these first, which would hide a bug in the
  // wiring. Calling sendRequest directly proves the socket itself goes through
  // the guarded lookup -- the part that stops DNS rebinding.
  it('refuses to connect when the hostname resolves to a blocked address', async () => {
    await expect(
      sendRequest(target('/ok'), STRICT, new AbortController().signal),
    ).rejects.toBeInstanceOf(BlockedTargetError);
  });

  it('connects through the same hook when policy allows it', async () => {
    await expect(
      sendRequest(target('/ok'), DEV, new AbortController().signal),
    ).resolves.toEqual({ status: 200, statusText: 'OK' });
  });

  it('classifies the connect-time refusal as BLOCKED_TARGET, not a network error', async () => {
    const err = await sendRequest(target('/ok'), STRICT, new AbortController().signal).catch(
      (e: unknown) => e,
    );
    expect(classifyError(err, target('/ok')).errorType).toBe('BLOCKED_TARGET');
  });
});
