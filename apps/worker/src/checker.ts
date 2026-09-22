/**
 * The HTTP check itself (guide 7.2).
 *
 * Turns a request into a clean, stable result. "Clean" matters more than it
 * looks: these error messages are what Phase 4 fingerprints, so they must
 * describe the failure the same way every time, with the variable parts
 * (timeouts, hosts, ports) in predictable positions.
 */
import type { ErrorType } from '@pulsewatch/shared';

export interface CheckTarget {
  url: string;
  method: string;
  timeoutMs: number;
  expectedStatus: number;
}

export interface CheckOutcome {
  success: boolean;
  statusCode: number | null;
  responseTimeMs: number;
  errorMessage: string | null;
  errorType: ErrorType | null;
}

/** Node puts the OS-level failure in `err.cause.code`. */
function causeCode(err: unknown): string | null {
  if (err && typeof err === 'object' && 'cause' in err) {
    const cause = (err as { cause?: unknown }).cause;
    if (cause && typeof cause === 'object' && 'code' in cause) {
      return String((cause as { code?: unknown }).code);
    }
  }
  if (err && typeof err === 'object' && 'code' in err) {
    return String((err as { code?: unknown }).code);
  }
  return null;
}

function hostPort(url: string): string {
  try {
    const u = new URL(url);
    return u.port ? `${u.hostname}:${u.port}` : u.hostname;
  } catch {
    return url;
  }
}

/**
 * Maps a thrown error to a stable type and message. Exported for unit tests:
 * this is the part that decides what Phase 4 will group on.
 */
export function classifyError(err: unknown, target: CheckTarget): {
  errorType: ErrorType;
  errorMessage: string;
} {
  if (err instanceof Error && err.name === 'AbortError') {
    return {
      errorType: 'TIMEOUT',
      errorMessage: `Timeout after ${target.timeoutMs}ms connecting to ${hostPort(target.url)}`,
    };
  }

  const code = causeCode(err);
  const where = hostPort(target.url);

  switch (code) {
    case 'ECONNREFUSED':
      return { errorType: 'CONNECTION_REFUSED', errorMessage: `ECONNREFUSED ${where}` };
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return { errorType: 'DNS_FAILURE', errorMessage: `DNS lookup failed for ${where} (${code})` };
    case 'ECONNRESET':
      return { errorType: 'CONNECTION_REFUSED', errorMessage: `ECONNRESET ${where}` };
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'CERT_HAS_EXPIRED':
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
      return { errorType: 'TLS_ERROR', errorMessage: `TLS error ${code} for ${where}` };
    default:
      break;
  }

  const detail = err instanceof Error ? err.message : String(err);
  return { errorType: 'UNKNOWN', errorMessage: `Request to ${where} failed: ${detail}` };
}

/** Classifies a response whose status is not the expected one. */
export function classifyStatus(
  status: number,
  statusText: string,
  expected: number,
): { errorType: ErrorType; errorMessage: string } | null {
  if (status === expected) return null;

  const text = statusText || '';
  if (status >= 500) {
    return { errorType: 'HTTP_5XX', errorMessage: `HTTP ${status} ${text}`.trim() };
  }
  if (status >= 400) {
    return { errorType: 'HTTP_4XX', errorMessage: `HTTP ${status} ${text}`.trim() };
  }
  return {
    errorType: 'UNEXPECTED_STATUS',
    errorMessage: `Expected HTTP ${expected}, got ${status} ${text}`.trim(),
  };
}

export async function runCheck(target: CheckTarget): Promise<CheckOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), target.timeoutMs);
  const startedAt = performance.now();

  try {
    const response = await fetch(target.url, {
      method: target.method,
      signal: controller.signal,
      redirect: 'manual',
      headers: { 'user-agent': 'PulseWatch/1.0 (+uptime monitor)' },
    });

    // Drain the body so the socket is released; the content is not needed.
    await response.arrayBuffer().catch(() => undefined);

    const responseTimeMs = Math.round(performance.now() - startedAt);
    const problem = classifyStatus(response.status, response.statusText, target.expectedStatus);

    return {
      success: problem === null,
      statusCode: response.status,
      responseTimeMs,
      errorMessage: problem?.errorMessage ?? null,
      errorType: problem?.errorType ?? null,
    };
  } catch (err) {
    const responseTimeMs = Math.round(performance.now() - startedAt);
    const { errorType, errorMessage } = classifyError(err, target);
    return { success: false, statusCode: null, responseTimeMs, errorMessage, errorType };
  } finally {
    clearTimeout(timer);
  }
}
