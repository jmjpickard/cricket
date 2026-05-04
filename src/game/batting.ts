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
    return {
      timing,
      runs: rng() < 0.4 ? 1 : 0,
      isBoundary: false,
      isSix: false,
      isWicket: false,
      zone: swing.zone,
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
    return {
      timing,
      runs: rng() < 0.4 ? 3 : 2,
      isBoundary: false,
      isSix: false,
      isWicket: false,
      zone: swing.zone,
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
