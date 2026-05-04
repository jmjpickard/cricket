import { describe, expect, it } from 'vitest';
import { validateScore, buildScoreKey, parseScoreKey } from '../worker/src/score';

const limits = { maxRuns: 73, maxBalls: 96 };

describe('validateScore', () => {
  it('accepts a valid submission', () => {
    const r = validateScore(
      { name: 'STOKES', ballsToSpare: 5, runsScored: 73, nonce: 'abcdefghi' },
      limits,
    );
    expect(r.ok).toBe(true);
  });

  it('rejects invalid name', () => {
    const r = validateScore(
      { name: '', ballsToSpare: 5, runsScored: 73, nonce: 'abcdefghi' },
      limits,
    );
    expect(r.ok).toBe(false);
  });

  it('rejects out-of-range runs', () => {
    const r = validateScore(
      { name: 'STOKES', ballsToSpare: 5, runsScored: 99999, nonce: 'abcdefghi' },
      limits,
    );
    expect(r.ok).toBe(false);
  });

  it('rejects negative balls', () => {
    const r = validateScore(
      { name: 'STOKES', ballsToSpare: -1, runsScored: 1, nonce: 'abcdefghi' },
      limits,
    );
    expect(r.ok).toBe(false);
  });

  it('rejects short nonce', () => {
    const r = validateScore(
      { name: 'STOKES', ballsToSpare: 5, runsScored: 73, nonce: 'x' },
      limits,
    );
    expect(r.ok).toBe(false);
  });
});

describe('buildScoreKey / parseScoreKey', () => {
  it('round-trips ballsToSpare', () => {
    const entry = { name: 'A', ballsToSpare: 7, runsScored: 73, ts: 1234 };
    const key = buildScoreKey(entry);
    const parsed = parseScoreKey(key);
    expect(parsed?.ballsToSpare).toBe(7);
  });

  it('higher ballsToSpare sorts first by string compare', () => {
    const high = buildScoreKey({ name: 'A', ballsToSpare: 50, runsScored: 73, ts: 1 });
    const low = buildScoreKey({ name: 'B', ballsToSpare: 5, runsScored: 73, ts: 2 });
    expect(high < low).toBe(true);
  });

  it('returns null for malformed keys', () => {
    expect(parseScoreKey('garbage')).toBeNull();
    expect(parseScoreKey('score:nope')).toBeNull();
  });
});
