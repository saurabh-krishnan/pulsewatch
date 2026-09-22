import { describe, expect, it } from 'vitest';
import { classifyError, classifyStatus, type CheckTarget } from './checker.js';

const target: CheckTarget = {
  url: 'http://localhost:4100/health',
  method: 'GET',
  timeoutMs: 5000,
  expectedStatus: 200,
};

describe('classifyStatus', () => {
  it('returns null when the status is the expected one', () => {
    expect(classifyStatus(200, 'OK', 200)).toBeNull();
  });

  it('classifies 5xx', () => {
    expect(classifyStatus(503, 'Service Unavailable', 200)).toEqual({
      errorType: 'HTTP_5XX',
      errorMessage: 'HTTP 503 Service Unavailable',
    });
  });

  it('classifies 4xx separately from 5xx', () => {
    expect(classifyStatus(404, 'Not Found', 200)?.errorType).toBe('HTTP_4XX');
  });

  it('treats an unexpected non-error status as its own case', () => {
    const r = classifyStatus(302, 'Found', 200);
    expect(r?.errorType).toBe('UNEXPECTED_STATUS');
    expect(r?.errorMessage).toBe('Expected HTTP 200, got 302 Found');
  });

  it('honours a non-200 expectation', () => {
    expect(classifyStatus(204, 'No Content', 204)).toBeNull();
    expect(classifyStatus(200, 'OK', 204)?.errorType).toBe('UNEXPECTED_STATUS');
  });

  it('copes with an empty statusText', () => {
    expect(classifyStatus(503, '', 200)?.errorMessage).toBe('HTTP 503');
  });
});

describe('classifyError', () => {
  it('classifies an abort as a timeout, naming the configured budget', () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    expect(classifyError(err, target)).toEqual({
      errorType: 'TIMEOUT',
      errorMessage: 'Timeout after 5000ms connecting to localhost:4100',
    });
  });

  it('reads the OS code out of err.cause', () => {
    const err = new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    expect(classifyError(err, target)).toEqual({
      errorType: 'CONNECTION_REFUSED',
      errorMessage: 'ECONNREFUSED localhost:4100',
    });
  });

  it('classifies DNS failures', () => {
    const err = new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
    const r = classifyError(err, { ...target, url: 'https://nope.example.com/health' });
    expect(r.errorType).toBe('DNS_FAILURE');
    expect(r.errorMessage).toContain('nope.example.com');
  });

  it('classifies TLS failures', () => {
    const err = new TypeError('fetch failed', { cause: { code: 'CERT_HAS_EXPIRED' } });
    expect(classifyError(err, target).errorType).toBe('TLS_ERROR');
  });

  it('falls back to UNKNOWN rather than throwing', () => {
    expect(classifyError(new Error('something odd'), target).errorType).toBe('UNKNOWN');
    expect(classifyError('not even an error', target).errorType).toBe('UNKNOWN');
  });

  it('produces messages with stable wording and only the values varying', () => {
    // Phase 4 normalises these to one fingerprint; that only works if the
    // wording never changes and the variable parts stay in fixed positions.
    const TEMPLATE = /^Timeout after \d+ms connecting to \S+$/;
    const abort = () => Object.assign(new Error(''), { name: 'AbortError' });

    const a = classifyError(abort(), target);
    const b = classifyError(abort(), {
      ...target,
      timeoutMs: 3000,
      url: 'http://10.0.3.17:5432/health',
    });

    expect(a.errorMessage).toMatch(TEMPLATE);
    expect(b.errorMessage).toMatch(TEMPLATE);
    expect(a.errorMessage).toBe('Timeout after 5000ms connecting to localhost:4100');
    expect(b.errorMessage).toBe('Timeout after 3000ms connecting to 10.0.3.17:5432');
  });
});
