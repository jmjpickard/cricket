import type { Bowler, BowlerId } from './types';

export const BOWLERS: Record<BowlerId, Bowler> = {
  hazlewood: {
    id: 'hazlewood',
    name: 'Hazlewood',
    travelMs: 720,
    perfectWindowMs: 90,
    stumpsChance: 0.55,
    style: 'pace',
    runUpMs: 900,
    lengthFrac: { min: 0.55, max: 0.72 },
    lineOffsetPxRange: 18,
    postBounceLateralPx: 5,
    bouncePx: 12,
    tintColor: 0xffd84d,
  },
  cummins: {
    id: 'cummins',
    name: 'Cummins',
    travelMs: 620,
    perfectWindowMs: 70,
    stumpsChance: 0.6,
    style: 'pace',
    runUpMs: 700,
    lengthFrac: { min: 0.5, max: 0.7 },
    lineOffsetPxRange: 22,
    postBounceLateralPx: 4,
    bouncePx: 10,
    tintColor: 0xff9090,
  },
  pattinson: {
    id: 'pattinson',
    name: 'Pattinson',
    travelMs: 670,
    perfectWindowMs: 80,
    stumpsChance: 0.5,
    style: 'pace',
    runUpMs: 800,
    lengthFrac: { min: 0.42, max: 0.6 },
    lineOffsetPxRange: 26,
    postBounceLateralPx: 6,
    bouncePx: 14,
    tintColor: 0xffb060,
  },
  lyon: {
    id: 'lyon',
    name: 'Lyon',
    travelMs: 880,
    perfectWindowMs: 75,
    stumpsChance: 0.65,
    style: 'spin',
    runUpMs: 1100,
    lengthFrac: { min: 0.6, max: 0.82 },
    lineOffsetPxRange: 14,
    postBounceLateralPx: 38,
    bouncePx: 18,
    tintColor: 0x90e0ff,
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

export type PitchGeometry = {
  pitchTopY: number;
  pitchBottomY: number;
  pitchX: number;
};

export type DeliveryPlan = {
  releasePx: { x: number; y: number };
  bouncePx: { x: number; y: number };
  arrivalPx: { x: number; y: number };
  preBounceMs: number;
  postBounceMs: number;
  runUpMs: number;
  /** cosmetic visual bounce arc height */
  bounceArcPx: number;
};

/**
 * Generate a per-delivery trajectory plan from bowler attributes and a seeded RNG.
 * Pure: same (bowler, geometry, rng-state) always produces the same plan.
 *
 * RNG order per delivery: planDelivery → resolveShot → resolveRunOutcome.
 */
export function planDelivery(
  bowler: Bowler,
  geometry: PitchGeometry,
  rng: () => number,
): DeliveryPlan {
  const { pitchTopY, pitchBottomY, pitchX } = geometry;
  const pitchLen = pitchBottomY - pitchTopY;

  const lengthFrac =
    bowler.lengthFrac.min + rng() * (bowler.lengthFrac.max - bowler.lengthFrac.min);
  const lineOffset = (rng() * 2 - 1) * bowler.lineOffsetPxRange;
  const lateralSign = rng() < 0.5 ? -1 : 1;

  const bounceY = pitchTopY + lengthFrac * pitchLen;
  const bounceX = pitchX + lineOffset;

  const releasePx = { x: pitchX, y: pitchTopY };
  const arrivalPx = {
    x: bounceX + lateralSign * bowler.postBounceLateralPx,
    y: pitchBottomY - 20,
  };

  // Split travelMs proportionally to distance from release→bounce vs bounce→arrival.
  const preDist = Math.max(1, bounceY - pitchTopY);
  const postDist = Math.max(1, pitchBottomY - 20 - bounceY);
  const total = preDist + postDist;
  const preBounceMs = Math.round((preDist / total) * bowler.travelMs);
  const postBounceMs = bowler.travelMs - preBounceMs;

  return {
    releasePx,
    bouncePx: { x: bounceX, y: bounceY },
    arrivalPx,
    preBounceMs,
    postBounceMs,
    runUpMs: bowler.runUpMs,
    bounceArcPx: bowler.bouncePx,
  };
}
