/**
 * Similar-incident ranking (guide 7.4) and runbook success rates (guide 7.5).
 *
 * Candidate selection happens in SQL; the scoring lives here so it is easy to
 * test and tune without touching the database.
 */
export const WEIGHTS = {
  sameFingerprint: 50,
  textSimilarity: 25,
  sameService: 15,
  sameErrorType: 10,
  sharedTag: 5,
  recent: 5,
} as const;

export const MIN_SCORE = 30;
export const MAX_RESULTS = 5;
export const RECENCY_WINDOW_DAYS = 30;

export interface ScoreInput {
  sameFingerprint: boolean;
  /** pg_trgm similarity() of the normalized messages, 0..1 */
  similarity: number;
  sameService: boolean;
  sameErrorType: boolean;
  sharedTag: boolean;
  /** Days since the candidate incident was resolved. */
  resolvedDaysAgo: number | null;
}

export interface ScoreResult {
  score: number;
  /** Human-readable justification, e.g. "same fingerprint · same service". */
  reasons: string[];
}

export function scoreIncident(input: ScoreInput): ScoreResult {
  let score = 0;
  const reasons: string[] = [];

  if (input.sameFingerprint) {
    score += WEIGHTS.sameFingerprint;
    reasons.push('same fingerprint');
  }
  if (input.similarity > 0) {
    score += WEIGHTS.textSimilarity * input.similarity;
    reasons.push(`${Math.round(input.similarity * 100)}% text match`);
  }
  if (input.sameService) {
    score += WEIGHTS.sameService;
    reasons.push('same service');
  }
  if (input.sameErrorType) {
    score += WEIGHTS.sameErrorType;
    reasons.push('same error type');
  }
  if (input.sharedTag) {
    score += WEIGHTS.sharedTag;
    reasons.push('shared tag');
  }
  if (input.resolvedDaysAgo !== null && input.resolvedDaysAgo <= RECENCY_WINDOW_DAYS) {
    score += WEIGHTS.recent;
    reasons.push('recent');
  }

  return { score: Math.round(score), reasons };
}

/**
 * Laplace-smoothed success rate: (worked + 1) / (tried + 2).
 * Stops a 1-for-1 runbook from outranking a 9-for-10 one.
 */
export function successRate(timesWorked: number, timesTried: number): number {
  return (timesWorked + 1) / (timesTried + 2);
}
