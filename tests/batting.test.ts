import { describe, expect, it } from 'vitest';
import { classifyTiming, resolveShot, resolveLeachAction } from '../src/game/batting';
import { BOWLERS } from '../src/game/bowling';

const constantRng = (v: number) => () => v;

describe('classifyTiming', () => {
  it('returns perfect within half-window', () => {
    expect(classifyTiming(0, 80)).toBe('perfect');
    expect(classifyTiming(30, 80)).toBe('perfect');
    expect(classifyTiming(-30, 80)).toBe('perfect');
  });

  it('returns good outside perfect but within 1.5x', () => {
    expect(classifyTiming(60, 80)).toBe('good');
    expect(classifyTiming(-100, 80)).toBe('good');
  });

  it('returns okay further out', () => {
    expect(classifyTiming(180, 80)).toBe('okay');
  });

  it('returns early/late beyond 3x', () => {
    expect(classifyTiming(-300, 80)).toBe('early');
    expect(classifyTiming(300, 80)).toBe('late');
  });
});

describe('resolveShot', () => {
  const bowler = BOWLERS.cummins;

  it('perfect non-lofted = boundary 4', () => {
    const r = resolveShot(
      bowler,
      { timingDeltaMs: 0, zone: 'cover', lofted: false, noSwing: false },
      constantRng(0.5),
    );
    expect(r.runs).toBe(4);
    expect(r.isBoundary).toBe(true);
    expect(r.isSix).toBe(false);
  });

  it('okay timing populates intendedRuns = runs', () => {
    const r = resolveShot(
      bowler,
      { timingDeltaMs: 180, zone: 'cover', lofted: false, noSwing: false },
      constantRng(0.5),
    );
    expect(r.runs).toBe(1);
    expect(r.intendedRuns).toBe(1);
  });

  it('good timing intendedRuns matches runs (2 or 3)', () => {
    const r = resolveShot(
      bowler,
      { timingDeltaMs: 80, zone: 'cover', lofted: false, noSwing: false },
      constantRng(0.5),
    );
    expect([2, 3]).toContain(r.runs);
    expect(r.intendedRuns).toBe(r.runs);
  });

  it('perfect lofted to good zone = six', () => {
    const r = resolveShot(
      bowler,
      { timingDeltaMs: 0, zone: 'straight', lofted: true, noSwing: false },
      constantRng(0.99),
    );
    expect(r.runs).toBe(6);
    expect(r.isSix).toBe(true);
  });

  it('no swing with rng below stumps chance = bowled', () => {
    const r = resolveShot(
      bowler,
      { timingDeltaMs: 0, zone: null, lofted: false, noSwing: true },
      constantRng(0),
    );
    expect(r.isWicket).toBe(true);
    expect(r.dismissal).toBe('bowled');
  });

  it('early swing with rng below edge chance = caught', () => {
    const r = resolveShot(
      bowler,
      { timingDeltaMs: -300, zone: 'cover', lofted: false, noSwing: false },
      constantRng(0),
    );
    expect(r.isWicket).toBe(true);
    expect(r.dismissal).toBe('caught');
  });
});

describe('resolveLeachAction', () => {
  it('block returns dot ball with high rng', () => {
    const r = resolveLeachAction(BOWLERS.lyon, 'block', constantRng(0.99));
    expect(r.runs).toBe(0);
    expect(r.isWicket).toBe(false);
  });

  it('block can be dismissal at low rng', () => {
    const r = resolveLeachAction(BOWLERS.lyon, 'block', constantRng(0.01));
    expect(r.isWicket).toBe(true);
  });

  it('nudge in middle band returns 1 run', () => {
    const r = resolveLeachAction(BOWLERS.lyon, 'nudge', constantRng(0.3));
    expect(r.runs).toBe(1);
  });
});
