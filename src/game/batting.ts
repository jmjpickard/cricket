import type { Bowler, ShotResult, ShotZone, Timing } from './types';

export type SwingInput = {
  /** ms between ball release and player tapping swing. negative = swung early. */
  timingDeltaMs: number;
  /** chosen direction. null = no direction held (defensive prod). */
  zone: ShotZone | null;
  /** true if player chose a lofted shot (boundary attempt over fielders). */
  lofted: boolean;
  /** true if player did not swing at all. */
  noSwing: boolean;
};

const ZONE_BOUNDARY_BIAS: Record<ShotZone, number> = {
  cover: 1.0,
  straight: 1.0,
  midwicket: 0.95,
  square: 0.9,
  point: 0.85,
  midOn: 0.8,
  fineLeg: 0.75,
  thirdMan: 0.7,
};

/**
 * Pure function: classify a swing against a bowled ball.
 * Returns runs, boundaries, and wicket outcomes. Deterministic given a
 * seeded RNG so the same inputs always produce the same result (replays).
 */
export function resolveShot(
  bowler: Bowler,
  swing: SwingInput,
  rng: () => number,
): ShotResult {
  if (swing.noSwing) {
    const beaten = rng() < bowler.stumpsChance;
    if (beaten) {
      return {
        timing: 'none',
        runs: 0,
        isBoundary: false,
        isSix: false,
        isWicket: true,
        dismissal: 'bowled',
        zone: null,
      };
    }
    return {
      timing: 'none',
      runs: 0,
      isBoundary: false,
      isSix: false,
      isWicket: false,
      zone: null,
    };
  }

  const timing = classifyTiming(swing.timingDeltaMs, bowler.perfectWindowMs);

  if (timing === 'early' || timing === 'late') {
    // mistimed: chance of edge → caught
    const edgeChance = timing === 'early' ? 0.25 : 0.18;
    if (rng() < edgeChance) {
      return {
        timing,
        runs: 0,
        isBoundary: false,
        isSix: false,
        isWicket: true,
        dismissal: 'caught',
        zone: swing.zone,
      };
    }
    const intended = rng() < 0.4 ? 1 : 0;
    return {
      timing,
      runs: intended,
      isBoundary: false,
      isSix: false,
      isWicket: false,
      zone: swing.zone,
      intendedRuns: intended,
    };
  }

  const zoneBias = swing.zone ? ZONE_BOUNDARY_BIAS[swing.zone] : 0.5;

  if (timing === 'perfect') {
    if (swing.lofted) {
      // perfect lofted = 6, with a small caught risk if zone is poorly chosen
      const caughtChance = (1 - zoneBias) * 0.15;
      if (rng() < caughtChance) {
        return {
          timing,
          runs: 0,
          isBoundary: false,
          isSix: false,
          isWicket: true,
          dismissal: 'caught',
          zone: swing.zone,
        };
      }
      return {
        timing,
        runs: 6,
        isBoundary: true,
        isSix: true,
        isWicket: false,
        zone: swing.zone,
      };
    }
    // perfect along the ground = 4
    return {
      timing,
      runs: 4,
      isBoundary: true,
      isSix: false,
      isWicket: false,
      zone: swing.zone,
    };
  }

  if (timing === 'good') {
    const intended = rng() < 0.4 ? 3 : 2;
    return {
      timing,
      runs: intended,
      isBoundary: false,
      isSix: false,
      isWicket: false,
      zone: swing.zone,
      intendedRuns: intended,
    };
  }

  // okay
  return {
    timing,
    runs: 1,
    isBoundary: false,
    isSix: false,
    isWicket: false,
    zone: swing.zone,
    intendedRuns: 1,
  };
}

export function classifyTiming(deltaMs: number, perfectWindowMs: number): Timing {
  const abs = Math.abs(deltaMs);
  if (abs <= perfectWindowMs / 2) return 'perfect';
  if (abs <= perfectWindowMs * 1.5) return 'good';
  if (abs <= perfectWindowMs * 3) return 'okay';
  return deltaMs < 0 ? 'early' : 'late';
}

export type LeachAction = 'block' | 'nudge';

/**
 * Leach faces simpler choices: block (safe) or nudge (try to rotate strike).
 * Captures the famous partnership tension without making the player learn
 * a second batter.
 */
export function resolveLeachAction(
  bowler: Bowler,
  action: LeachAction,
  rng: () => number,
): ShotResult {
  if (action === 'block') {
    if (rng() < 0.04) {
      return {
        timing: 'none',
        runs: 0,
        isBoundary: false,
        isSix: false,
        isWicket: true,
        dismissal: rng() < 0.5 ? 'lbw' : 'bowled',
        zone: null,
      };
    }
    return {
      timing: 'none',
      runs: 0,
      isBoundary: false,
      isSix: false,
      isWicket: false,
      zone: null,
    };
  }

  // nudge
  const r = rng();
  if (r < 0.1) {
    return {
      timing: 'none',
      runs: 0,
      isBoundary: false,
      isSix: false,
      isWicket: true,
      dismissal: 'caught',
      zone: null,
    };
  }
  if (r < 0.55) {
    return {
      timing: 'okay',
      runs: 1,
      isBoundary: false,
      isSix: false,
      isWicket: false,
      zone: null,
      intendedRuns: 1,
    };
  }
  return {
    timing: 'none',
    runs: 0,
    isBoundary: false,
    isSix: false,
    isWicket: false,
    zone: null,
  };
}

export type RunDecision = 'go' | 'stay';

export type RunOutcome = {
  runs: number;
  runOut: boolean;
};

/**
 * Decide actual runs scored given an intended run count and a run decision.
 *
 * - STAY → always 0 runs, never run out.
 * - GO  → take up to `intendedRuns`. Probability of run-out scales with how
 *         aggressively the player runs vs. how close the nearest fielder is
 *         to the predicted ball line. Greedy 2 with a close fielder ≈ 30%.
 *
 * `fielderDistancePx` = distance from the nearest fielder to the ball's
 * resting point. `safeDistancePx` is the threshold below which a single
 * starts to be risky (tunable per scene).
 *
 * Pure & deterministic given rng.
 */
export function resolveRunOutcome(
  intendedRuns: number,
  fielderDistancePx: number,
  safeDistancePx: number,
  decision: RunDecision,
  rng: () => number,
): RunOutcome {
  if (decision === 'stay' || intendedRuns <= 0) {
    return { runs: 0, runOut: false };
  }

  // Closer fielder = more pressure. closenessFactor ∈ [0, 1].
  const closeness = Math.max(0, Math.min(1, 1 - fielderDistancePx / safeDistancePx));
  // Each additional run ramps risk; first run is mostly safe unless fielder is right there.
  const greed = (intendedRuns - 1) * 0.18 + 0.04;
  const runOutChance = Math.min(0.65, closeness * (0.18 + greed));

  if (rng() < runOutChance) {
    return { runs: 0, runOut: true };
  }
  return { runs: intendedRuns, runOut: false };
}
