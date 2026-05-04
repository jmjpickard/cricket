import { describe, expect, it } from 'vitest';
import { resolveRunOutcome } from '../src/game/batting';

const constantRng = (v: number) => () => v;

describe('resolveRunOutcome', () => {
  it('STAY always yields 0 runs and never run out', () => {
    const o = resolveRunOutcome(2, 50, 220, 'stay', constantRng(0));
    expect(o.runs).toBe(0);
    expect(o.runOut).toBe(false);
  });

  it('GO with intendedRuns 0 returns 0 runs, no run-out', () => {
    const o = resolveRunOutcome(0, 10, 220, 'go', constantRng(0));
    expect(o.runs).toBe(0);
    expect(o.runOut).toBe(false);
  });

  it('GO with fielder far away returns intended runs', () => {
    const o = resolveRunOutcome(2, 800, 220, 'go', constantRng(0));
    // closeness ≈ 0 → run-out chance ≈ 0
    expect(o.runs).toBe(2);
    expect(o.runOut).toBe(false);
  });

  it('GO greedy with close fielder triggers run-out at low rng', () => {
    const o = resolveRunOutcome(3, 0, 220, 'go', constantRng(0));
    expect(o.runOut).toBe(true);
    expect(o.runs).toBe(0);
  });

  it('GO single with close fielder is mostly safe at high rng', () => {
    const o = resolveRunOutcome(1, 0, 220, 'go', constantRng(0.99));
    expect(o.runOut).toBe(false);
    expect(o.runs).toBe(1);
  });
});
