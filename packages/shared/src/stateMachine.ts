/**
 * Monitor state machine (guide 7.1).
 *
 * UNKNOWN --(first success)--> UP --(N failures in a row)--> DOWN --(M successes)--> UP
 *
 * Pure function on purpose: no database, no network, so it is trivial to unit-test.
 */
export type Status = 'unknown' | 'up' | 'down';

export interface MonitorState {
  status: Status;
  failures: number;
  successes: number;
}

export type Action = 'open_incident' | 'resolve_incident' | null;

export function nextState(
  s: MonitorState,
  ok: boolean,
  failThreshold = 3,
  recoverThreshold = 2,
): { state: MonitorState; action: Action } {
  if (ok) {
    const successes = s.successes + 1;
    if (s.status === 'down') {
      return successes >= recoverThreshold
        ? { state: { status: 'up', failures: 0, successes }, action: 'resolve_incident' }
        : { state: { status: 'down', failures: 0, successes }, action: null };
    }
    return { state: { status: 'up', failures: 0, successes }, action: null };
  }

  const failures = s.failures + 1;
  if (s.status !== 'down' && failures >= failThreshold) {
    return { state: { status: 'down', failures, successes: 0 }, action: 'open_incident' };
  }
  return { state: { status: s.status, failures, successes: 0 }, action: null };
}
