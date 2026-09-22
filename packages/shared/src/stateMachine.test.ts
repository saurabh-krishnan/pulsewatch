import { describe, expect, it } from 'vitest';
import { nextState, type Action, type MonitorState } from './stateMachine.js';

const START: MonitorState = { status: 'unknown', failures: 0, successes: 0 };

/** Feeds a sequence of check outcomes through the machine. */
function run(inputs: boolean[], failThreshold = 3, recoverThreshold = 2) {
  let state = START;
  const actions: Action[] = [];
  for (const ok of inputs) {
    const r = nextState(state, ok, failThreshold, recoverThreshold);
    state = r.state;
    actions.push(r.action);
  }
  return { state, actions, fired: actions.filter(Boolean) };
}

describe('nextState — from unknown', () => {
  it('goes UP on the first success without firing an action', () => {
    const { state, action } = nextState(START, true);
    expect(state).toEqual({ status: 'up', failures: 0, successes: 1 });
    expect(action).toBeNull();
  });

  it('can go straight to DOWN from unknown once the threshold is met', () => {
    const { state, fired } = run([false, false, false]);
    expect(state.status).toBe('down');
    expect(fired).toEqual(['open_incident']);
  });
});

describe('nextState — failure threshold', () => {
  it('does not open an incident before the threshold', () => {
    const { state, fired } = run([true, false, false]);
    expect(state.status).toBe('up');
    expect(state.failures).toBe(2);
    expect(fired).toEqual([]);
  });

  it('opens exactly one incident at the threshold', () => {
    const { fired } = run([true, false, false, false]);
    expect(fired).toEqual(['open_incident']);
  });

  it('does not re-open while already down, however long the outage lasts', () => {
    const { state, fired } = run([false, false, false, false, false, false, false]);
    expect(state.status).toBe('down');
    expect(fired).toEqual(['open_incident']);
  });

  it('a single success resets the failure count', () => {
    // Two failures, a success, then two more failures must NOT reach three.
    const { state, fired } = run([false, false, true, false, false]);
    expect(state.status).toBe('up');
    expect(state.failures).toBe(2);
    expect(fired).toEqual([]);
  });

  it('respects a custom failure threshold', () => {
    expect(run([false], 1).fired).toEqual(['open_incident']);
    expect(run([false, false, false, false], 5).fired).toEqual([]);
  });
});

describe('nextState — recovery threshold', () => {
  it('stays down until enough consecutive successes', () => {
    const { state, fired } = run([false, false, false, true]);
    expect(state.status).toBe('down');
    expect(state.successes).toBe(1);
    expect(fired).toEqual(['open_incident']);
  });

  it('resolves on the second consecutive success', () => {
    const { state, fired } = run([false, false, false, true, true]);
    expect(state.status).toBe('up');
    expect(fired).toEqual(['open_incident', 'resolve_incident']);
  });

  it('a failure during recovery resets the success count', () => {
    // down, one success, a failure, then one success must not resolve.
    const { state, fired } = run([false, false, false, true, false, true]);
    expect(state.status).toBe('down');
    expect(state.successes).toBe(1);
    expect(fired).toEqual(['open_incident']);
  });

  it('respects a custom recovery threshold', () => {
    expect(run([false, false, false, true], 3, 1).fired).toEqual([
      'open_incident',
      'resolve_incident',
    ]);
  });
});

describe('nextState — invariants', () => {
  it('never reports failures and successes at the same time', () => {
    let state = START;
    for (const ok of [true, false, true, true, false, false, false, true, true, false]) {
      state = nextState(state, ok).state;
      expect(Math.min(state.failures, state.successes)).toBe(0);
    }
  });

  it('is pure: the input state is never mutated', () => {
    const input: MonitorState = { status: 'up', failures: 1, successes: 0 };
    const snapshot = { ...input };
    nextState(input, false);
    expect(input).toEqual(snapshot);
  });

  it('runs the guide section 11 example sequence end to end', () => {
    // ✓ ✗ ✗ ✓ ✗ ✗ ✗ ✗ ✓ ✗ ✓ ✓
    const inputs = [true, false, false, true, false, false, false, false, true, false, true, true];
    const { state, actions } = run(inputs);

    // The incident opens on the 7th check and resolves on the 12th.
    expect(actions[6]).toBe('open_incident');
    expect(actions[11]).toBe('resolve_incident');
    expect(actions.filter(Boolean)).toEqual(['open_incident', 'resolve_incident']);
    expect(state.status).toBe('up');
  });
});
