import { describe, expect, it } from 'vitest';
import {
  applyBall,
  createInitialState,
  getOutcome,
  runsNeeded,
  TARGET,
  TOTAL_BALLS,
  STARTING_SCORE,
  STARTING_WICKETS,
} from '../src/game/matchState';
import type { ShotResult } from '../src/game/types';

const dot: ShotResult = {
  timing: 'okay',
  runs: 0,
  isBoundary: false,
  isSix: false,
  isWicket: false,
  zone: null,
};

const four: ShotResult = {
  ...dot,
  timing: 'perfect',
  runs: 4,
  isBoundary: true,
};

const single: ShotResult = { ...dot, runs: 1 };

const wicket: ShotResult = {
  ...dot,
  isWicket: true,
  dismissal: 'caught',
};

describe('createInitialState', () => {
  it('starts at 286/9 needing 73', () => {
    const s = createInitialState();
    expect(s.score).toBe(STARTING_SCORE);
    expect(s.wicketsLost).toBe(STARTING_WICKETS);
    expect(runsNeeded(s)).toBe(TARGET - STARTING_SCORE);
    expect(s.ballsRemaining).toBe(TOTAL_BALLS);
    expect(s.onStrike).toBe('stokes');
  });
});

describe('applyBall', () => {
  it('adds runs for boundary and does not rotate strike on 4', () => {
    const s = createInitialState();
    const next = applyBall(s, four);
    expect(next.score).toBe(s.score + 4);
    expect(next.onStrike).toBe('stokes');
    expect(next.stokesRuns).toBe(4);
  });

  it('rotates strike on a single', () => {
    const s = createInitialState();
    const next = applyBall(s, single);
    expect(next.onStrike).toBe('leach');
  });

  it('rotates strike at end of over even on dots', () => {
    let s = createInitialState();
    for (let i = 0; i < 6; i++) s = applyBall(s, dot);
    expect(s.ballsBowled).toBe(6);
    expect(s.onStrike).toBe('leach');
  });

  it('records a wicket and zeroes partnership', () => {
    const s = { ...createInitialState(), partnership: 50 };
    const next = applyBall(s, wicket);
    expect(next.wicketsLost).toBe(STARTING_WICKETS + 1);
    expect(next.partnership).toBe(0);
  });
});

describe('getOutcome', () => {
  it('won when score reaches target', () => {
    const s = { ...createInitialState(), score: TARGET };
    expect(getOutcome(s)).toBe('won');
  });

  it('lost when 10th wicket falls', () => {
    const s = { ...createInitialState(), wicketsLost: 10 };
    expect(getOutcome(s)).toBe('lost');
  });

  it('lost when balls run out short', () => {
    const s = { ...createInitialState(), ballsRemaining: 0, score: 300 };
    expect(getOutcome(s)).toBe('lost');
  });

  it('inProgress otherwise', () => {
    expect(getOutcome(createInitialState())).toBe('inProgress');
  });
});
