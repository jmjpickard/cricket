import type { ShotZone } from '../game/types';

export type Direction = { x: number; y: number };

export type InputState = {
  direction: Direction;
  loftHeld: boolean;
};

export type InputEvent = 'swing' | 'block' | 'nudge';

export type InputListener = (event: InputEvent) => void;

const ZONE_BY_ANGLE: { from: number; to: number; zone: ShotZone }[] = [
  { from: -22.5, to: 22.5, zone: 'cover' },
  { from: 22.5, to: 67.5, zone: 'point' },
  { from: 67.5, to: 112.5, zone: 'thirdMan' },
  { from: 112.5, to: 157.5, zone: 'fineLeg' },
  { from: 157.5, to: 180, zone: 'square' },
  { from: -180, to: -157.5, zone: 'square' },
  { from: -157.5, to: -112.5, zone: 'midwicket' },
  { from: -112.5, to: -67.5, zone: 'straight' },
  { from: -67.5, to: -22.5, zone: 'midOn' },
];

/**
 * Convert a direction vector into a cricket shot zone.
 * Vector is screen-space: +x right, +y down. Bowler bowls from top, batter
 * faces up, so "straight" = pushing up = -y.
 */
export function directionToZone(dir: Direction): ShotZone | null {
  if (Math.hypot(dir.x, dir.y) < 0.2) return null;
  const angleDeg = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
  for (const { from, to, zone } of ZONE_BY_ANGLE) {
    if (angleDeg >= from && angleDeg < to) return zone;
  }
  return 'straight';
}

export class InputController {
  private state: InputState = { direction: { x: 0, y: 0 }, loftHeld: false };
  private listeners = new Set<InputListener>();

  setDirection(dir: Direction) {
    this.state.direction = dir;
  }

  setLoft(loft: boolean) {
    this.state.loftHeld = loft;
  }

  emit(event: InputEvent) {
    for (const l of this.listeners) l(event);
  }

  on(listener: InputListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): InputState {
    return this.state;
  }

  getZone(): ShotZone | null {
    return directionToZone(this.state.direction);
  }
}
