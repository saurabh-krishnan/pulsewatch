import { describe, expect, it } from 'vitest';
import { nextState, type MonitorState } from './stateMachine.js';

const START: MonitorState = { status: 'unknown', failures: 0, successes: 0 };

describe('nextState', () => {
  it('goes UP on the first success', () => {
    const { state, action } = nextState(START, true);
    expect(state.status).toBe('up');
    expect(action).toBeNull();
  });

  it('opens an incident only after the failure threshold', () => {
    let s = START;
    expect(nextState(s, false).action).toBeNull();
    s = nextState(s, false).state;
    expect(nextState(s, false).action).toBeNull();
    s = nextState(s, false).state;
    const third = nextState(s, false);
    expect(third.state.status).toBe('down');
    expect(third.action).toBe('open_incident');
  });

  it('runs the guide 11 example sequence end to end', () => {
    const inputs = [true, false, false, true, false, false, false, false, true, false, true, true];
    const actions: (string | null)[] = [];
    let s = START;
    for (const ok of inputs) {
      const r = nextState(s, ok);
      s = r.state;
      actions.push(r.action);
    }
    expect(actions.filter(Boolean)).toEqual(['open_incident', 'resolve_incident']);
    expect(s.status).toBe('up');
  });
});
