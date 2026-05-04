export type ScoreSubmission = {
  name: string;
  ballsToSpare: number;
  runsScored: number;
  nonce: string;
};

export type ScoreEntry = {
  name: string;
  ballsToSpare: number;
  runsScored: number;
  ts: number;
};

export type ValidationOk = { ok: true; value: ScoreSubmission };
export type ValidationErr = { ok: false; error: string };

const NAME_RE = /^[A-Z0-9 _-]{1,12}$/;

export function validateScore(
  raw: unknown,
  limits: { maxRuns: number; maxBalls: number },
): ValidationOk | ValidationErr {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'body must be object' };
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === 'string' ? r.name.toUpperCase().trim() : '';
  if (!NAME_RE.test(name)) return { ok: false, error: 'invalid name' };

  const ballsToSpare = Number(r.ballsToSpare);
  const runsScored = Number(r.runsScored);
  const nonce = typeof r.nonce === 'string' ? r.nonce : '';

  if (!Number.isInteger(ballsToSpare) || ballsToSpare < 0 || ballsToSpare > limits.maxBalls) {
    return { ok: false, error: 'invalid ballsToSpare' };
  }
  if (!Number.isInteger(runsScored) || runsScored < 0 || runsScored > limits.maxRuns) {
    return { ok: false, error: 'invalid runsScored' };
  }
  if (nonce.length < 8) return { ok: false, error: 'invalid nonce' };

  return { ok: true, value: { name, ballsToSpare, runsScored, nonce } };
}

/**
 * Key encodes ballsToSpare descending so KV `list` returns near-sorted.
 * Format: `score:<inv-balls-zero-padded>:<ts>:<rand>`
 */
export function buildScoreKey(entry: ScoreEntry): string {
  const inv = String(99999 - entry.ballsToSpare).padStart(5, '0');
  const rand = Math.random().toString(36).slice(2, 8);
  return `score:${inv}:${entry.ts}:${rand}`;
}

export function parseScoreKey(
  key: string,
): { ballsToSpare: number; key: string } | null {
  const parts = key.split(':');
  if (parts.length < 4 || parts[0] !== 'score') return null;
  const inv = Number(parts[1]);
  if (!Number.isFinite(inv)) return null;
  return { ballsToSpare: 99999 - inv, key };
}
