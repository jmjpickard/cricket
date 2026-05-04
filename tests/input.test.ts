import { describe, expect, it } from 'vitest';
import { directionToZone } from '../src/input/InputController';

describe('directionToZone', () => {
  it('returns null for tiny vectors', () => {
    expect(directionToZone({ x: 0.05, y: 0 })).toBeNull();
  });

  it('maps up (-y) to straight', () => {
    expect(directionToZone({ x: 0, y: -1 })).toBe('straight');
  });

  it('maps right (+x) to cover', () => {
    expect(directionToZone({ x: 1, y: 0 })).toBe('cover');
  });

  it('maps down-left to fineLeg (behind square on leg side)', () => {
    expect(directionToZone({ x: -0.7, y: 0.7 })).toBe('fineLeg');
  });

  it('maps up-left to midwicket (forward of square on leg side)', () => {
    expect(directionToZone({ x: -0.7, y: -0.7 })).toBe('midwicket');
  });
});
