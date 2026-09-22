import { describe, expect, it } from 'vitest';
import { MIN_SCORE, scoreIncident, successRate, type ScoreInput } from './scoring.js';

const NOTHING: ScoreInput = {
  sameFingerprint: false,
  similarity: 0,
  sameService: false,
  sameErrorType: false,
  sharedTag: false,
  resolvedDaysAgo: null,
};

const score = (over: Partial<ScoreInput>) => scoreIncident({ ...NOTHING, ...over });

describe('scoreIncident — individual signals', () => {
  it('scores nothing when no signal matches', () => {
    expect(score({})).toEqual({ score: 0, reasons: [] });
  });

  it('weights an exact fingerprint match highest', () => {
    expect(score({ sameFingerprint: true }).score).toBe(50);
  });

  it('scales text similarity up to 25 points', () => {
    expect(score({ similarity: 1 }).score).toBe(25);
    expect(score({ similarity: 0.5 }).score).toBe(13); // 12.5, rounded
  });

  it('weights same service, same error type and a shared tag', () => {
    expect(score({ sameService: true }).score).toBe(15);
    expect(score({ sameErrorType: true }).score).toBe(10);
    expect(score({ sharedTag: true }).score).toBe(5);
  });

  it('adds the recency bonus only inside the 30 day window', () => {
    expect(score({ resolvedDaysAgo: 0 }).score).toBe(5);
    expect(score({ resolvedDaysAgo: 30 }).score).toBe(5);
    expect(score({ resolvedDaysAgo: 31 }).score).toBe(0);
    expect(score({ resolvedDaysAgo: null }).score).toBe(0);
  });
});

describe('scoreIncident — the guide section 7.4 worked examples', () => {
  it('scores an exact recent repeat on the same service at 100', () => {
    // same fingerprint 50 + full text match 25 + same service 15 + same type 10
    const r = score({
      sameFingerprint: true,
      similarity: 1,
      sameService: true,
      sameErrorType: true,
      resolvedDaysAgo: null,
    });
    expect(r.score).toBe(100);
  });

  it('scores a 0.72-similar error on the same service with the same type at 43', () => {
    // 25 * 0.72 = 18, + 15 + 10
    const r = score({ similarity: 0.72, sameService: true, sameErrorType: true });
    expect(r.score).toBe(43);
  });

  it('adds 5 more when tags overlap', () => {
    const withoutTag = score({ sameFingerprint: true, similarity: 1, sameService: true, sameErrorType: true });
    const withTag = score({
      sameFingerprint: true,
      similarity: 1,
      sameService: true,
      sameErrorType: true,
      sharedTag: true,
    });
    expect(withTag.score - withoutTag.score).toBe(5);
  });
});

describe('scoreIncident — reasons', () => {
  it('explains every signal that contributed', () => {
    const r = score({ sameFingerprint: true, sameService: true, sameErrorType: true });
    expect(r.reasons).toEqual(['same fingerprint', 'same service', 'same error type']);
  });

  it('reports the text match as a percentage', () => {
    expect(score({ similarity: 0.72 }).reasons).toContain('72% text match');
  });

  it('never claims a signal that did not contribute', () => {
    expect(score({ sameService: true }).reasons).toEqual(['same service']);
  });
});

describe('scoreIncident — the MIN_SCORE cutoff', () => {
  it('keeps same-service plus same-type out without any text evidence', () => {
    // 15 + 10 = 25. Deliberately below the cutoff: "same service, same kind of
    // error" describes half the history of a busy service and is not a memory.
    expect(score({ sameService: true, sameErrorType: true }).score).toBe(25);
    expect(score({ sameService: true, sameErrorType: true }).score).toBeLessThan(MIN_SCORE);
  });

  it('lets the same pair through once the text starts to agree', () => {
    // 25 * 0.2 = 5 -> 30 exactly, the first point at which it surfaces.
    expect(score({ sameService: true, sameErrorType: true, similarity: 0.2 }).score).toBe(
      MIN_SCORE,
    );
  });

  it('always surfaces an exact fingerprint match, on any service', () => {
    expect(score({ sameFingerprint: true }).score).toBeGreaterThanOrEqual(MIN_SCORE);
  });

  it('keeps a weak text-only match out', () => {
    // 0.35 similarity alone is 9 points: noise, not memory.
    expect(score({ similarity: 0.35 }).score).toBeLessThan(MIN_SCORE);
  });

  it('keeps same-service-alone out, since every incident on a busy service would match', () => {
    expect(score({ sameService: true }).score).toBeLessThan(MIN_SCORE);
  });
});

describe('successRate — Laplace smoothing', () => {
  it('prefers 9 of 10 over 1 of 1, which is the whole point', () => {
    const oneOfOne = successRate(1, 1);
    const nineOfTen = successRate(9, 10);
    expect(oneOfOne).toBeCloseTo(2 / 3, 5);
    expect(nineOfTen).toBeCloseTo(10 / 12, 5);
    expect(nineOfTen).toBeGreaterThan(oneOfOne);
  });

  it('gives an untried runbook a neutral 50% rather than 0 or 100', () => {
    expect(successRate(0, 0)).toBe(0.5);
  });

  it('matches the guide example of 4 worked out of 5 tried', () => {
    expect(successRate(4, 5)).toBeCloseTo(5 / 7, 5);
    expect(Math.round(successRate(4, 5) * 100)).toBe(71);
  });

  it('never reaches certainty in either direction', () => {
    expect(successRate(100, 100)).toBeLessThan(1);
    expect(successRate(0, 100)).toBeGreaterThan(0);
  });

  it('rises with more successes and falls with more failures', () => {
    expect(successRate(5, 5)).toBeGreaterThan(successRate(4, 5));
    expect(successRate(4, 10)).toBeLessThan(successRate(4, 5));
  });
});
