import type { Bowler, BowlerId } from './types';

export const BOWLERS: Record<BowlerId, Bowler> = {
  hazlewood: {
    id: 'hazlewood',
    name: 'Hazlewood',
    travelMs: 720,
    perfectWindowMs: 90,
    stumpsChance: 0.55,
    style: 'pace',
  },
  cummins: {
    id: 'cummins',
    name: 'Cummins',
    travelMs: 620,
    perfectWindowMs: 70,
    stumpsChance: 0.6,
    style: 'pace',
  },
  pattinson: {
    id: 'pattinson',
    name: 'Pattinson',
    travelMs: 670,
    perfectWindowMs: 80,
    stumpsChance: 0.5,
    style: 'pace',
  },
  lyon: {
    id: 'lyon',
    name: 'Lyon',
    travelMs: 880,
    perfectWindowMs: 75,
    stumpsChance: 0.65,
    style: 'spin',
  },
};

/**
 * Pick a bowler for the next over. Hazlewood early, Cummins/Lyon late
 * to mirror the real Headingley finish.
 */
export function selectBowler(ballsRemaining: number, totalBalls: number): BowlerId {
  const fraction = ballsRemaining / totalBalls;
  if (fraction > 0.7) return 'hazlewood';
  if (fraction > 0.45) return 'pattinson';
  if (fraction > 0.2) return 'lyon';
  return 'cummins';
}
