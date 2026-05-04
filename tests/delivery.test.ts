import { describe, expect, it } from 'vitest';
import { BOWLERS, planDelivery } from '../src/game/bowling';
import { createRng } from '../src/game/rng';

const geometry = { pitchTopY: 200, pitchBottomY: 1000, pitchX: 360 };

describe('planDelivery', () => {
  it('places bounce inside the bowler length band', () => {
    const rng = createRng(42);
    const lyon = BOWLERS.lyon;
    for (let i = 0; i < 20; i++) {
      const plan = planDelivery(lyon, geometry, rng);
      const frac = (plan.bouncePx.y - geometry.pitchTopY) / (geometry.pitchBottomY - geometry.pitchTopY);
      expect(frac).toBeGreaterThanOrEqual(lyon.lengthFrac.min - 1e-6);
      expect(frac).toBeLessThanOrEqual(lyon.lengthFrac.max + 1e-6);
    }
  });

  it('Lyon kicks sideways after the bounce (spin)', () => {
    const rng = createRng(7);
    const plan = planDelivery(BOWLERS.lyon, geometry, rng);
    const lateral = Math.abs(plan.arrivalPx.x - plan.bouncePx.x);
    expect(lateral).toBeGreaterThanOrEqual(BOWLERS.lyon.postBounceLateralPx);
  });

  it('Cummins barely deviates after bounce (pace)', () => {
    const rng = createRng(7);
    const plan = planDelivery(BOWLERS.cummins, geometry, rng);
    const lateral = Math.abs(plan.arrivalPx.x - plan.bouncePx.x);
    expect(lateral).toBeLessThanOrEqual(BOWLERS.cummins.postBounceLateralPx + 1e-6);
  });

  it('preBounce + postBounce = travelMs', () => {
    const rng = createRng(99);
    const plan = planDelivery(BOWLERS.hazlewood, geometry, rng);
    expect(plan.preBounceMs + plan.postBounceMs).toBe(BOWLERS.hazlewood.travelMs);
  });

  it('bounce x stays within line offset range of pitchX', () => {
    const rng = createRng(123);
    const cummins = BOWLERS.cummins;
    for (let i = 0; i < 20; i++) {
      const plan = planDelivery(cummins, geometry, rng);
      expect(Math.abs(plan.bouncePx.x - geometry.pitchX)).toBeLessThanOrEqual(cummins.lineOffsetPxRange);
    }
  });
});
