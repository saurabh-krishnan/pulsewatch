/**
 * The HTTP check itself (guide 7.2).
 *
 * Turns a request into a clean, stable result. "Clean" matters more than it
 * looks: these error messages are what Phase 4 fingerprints, so they must
 * describe the failure the same way every time, with the variable parts
 * (timeouts, hosts, ports) in predictable positions.
 *
 * Uses node:http rather than fetch because http.request accepts a `lookup`
 * hook, and that hook is where the SSRF policy is enforced against the address
 * actually being connected to (see @pulsewatch/shared/ssrf).
 */
import http from 'node:http';
import https from 'node:https';
import type { ErrorType } from '@pulsewatch/shared';
import {
  BlockedTargetError,
  checkMonitorUrl,
  createGuardedLookup,
  type TargetPolicy,
} from '@pulsewatch/shared/ssrf';

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

/** Node puts the OS-level failure in `err.code`, or in `err.cause.code` for fetch. */
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
export function classifyError(
  err: unknown,
  target: CheckTarget,
): {
  errorType: ErrorType;
  errorMessage: string;
} {
  if (err instanceof BlockedTargetError || causeCode(err) === 'ERR_SSRF_BLOCKED') {
    return {
      errorType: 'BLOCKED_TARGET',
      errorMessage: `Blocked by SSRF policy: ${(err as Error).message}`,
    };
  }

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

/**
 * One request. Redirects are deliberately not followed: a public URL that
 * answers 302 Location: http://169.254.169.254/ must not be a way around the
 * SSRF policy, and a monitor should report the redirect rather than hide it.
 */
export function sendRequest(
  target: CheckTarget,
  policy: TargetPolicy,
  signal: AbortSignal,
): Promise<{ status: number; statusText: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(target.url);
    const transport = url.protocol === 'https:' ? https : http;

    const req = transport.request(
      url,
      {
        method: target.method,
        signal,
        lookup: createGuardedLookup(policy),
        // No connection pooling, deliberately. Node's global agent keeps sockets
        // alive by default, and a reused socket skips DNS entirely -- so the
        // guarded lookup above would never run. It would also make the monitor
        // lie: a warm socket hides DNS, TCP and TLS time, and a server that has
        // stopped accepting new connections still looks healthy over an old one.
        agent: false,
        headers: { 'user-agent': 'PulseWatch/1.0 (+uptime monitor)', connection: 'close' },
      },
      (res) => {
        // Drain the body so the socket is released; the content is not needed.
        res.resume();
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, statusText: res.statusMessage ?? '' }),
        );
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end();
  });
}

export async function runCheck(target: CheckTarget, policy: TargetPolicy): Promise<CheckOutcome> {
  const startedAt = performance.now();
  const elapsed = () => Math.round(performance.now() - startedAt);

  // Fast, clear refusal for literals and reserved names. Hostnames are checked
  // again by the guarded lookup at connect time, which is the real enforcement.
  const pre = await checkMonitorUrl(target.url, policy);
  if (!pre.ok) {
    return {
      success: false,
      statusCode: null,
      responseTimeMs: elapsed(),
      errorType: 'BLOCKED_TARGET',
      errorMessage: `Blocked by SSRF policy: ${pre.reason}`,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), target.timeoutMs);

  try {
    const { status, statusText } = await sendRequest(target, policy, controller.signal);
    const problem = classifyStatus(status, statusText, target.expectedStatus);
    return {
      success: problem === null,
      statusCode: status,
      responseTimeMs: elapsed(),
      errorMessage: problem?.errorMessage ?? null,
      errorType: problem?.errorType ?? null,
    };
  } catch (err) {
    const { errorType, errorMessage } = classifyError(err, target);
    return { success: false, statusCode: null, responseTimeMs: elapsed(), errorMessage, errorType };
  } finally {
    clearTimeout(timer);
  }
}
