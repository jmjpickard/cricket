import Phaser from 'phaser';
import type { InputController } from './InputController';

const DPAD_RADIUS = 90;
const BUTTON_RADIUS = 60;

/**
 * On-screen analog D-pad (bottom-left) and SWING / BLOCK / NUDGE buttons
 * (bottom-right). Designed for thumbs in portrait. Direction vector is
 * normalised to [-1, 1] on each axis.
 */
export function attachTouch(scene: Phaser.Scene, controller: InputController): () => void {
  const W = scene.scale.width;
  const H = scene.scale.height;

  const dpadCx = 110;
  const dpadCy = H - 130;

  const dpadBase = scene.add
    .circle(dpadCx, dpadCy, DPAD_RADIUS, 0xffffff, 0.15)
    .setScrollFactor(0)
    .setDepth(1000);
  const dpadStick = scene.add
    .circle(dpadCx, dpadCy, 36, 0xffffff, 0.5)
    .setScrollFactor(0)
    .setDepth(1001);

  let dpadPointerId: number | null = null;

  dpadBase.setInteractive(
    new Phaser.Geom.Circle(DPAD_RADIUS, DPAD_RADIUS, DPAD_RADIUS),
    Phaser.Geom.Circle.Contains,
  );

  scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
    const dx = pointer.x - dpadCx;
    const dy = pointer.y - dpadCy;
    if (Math.hypot(dx, dy) <= DPAD_RADIUS + 20 && pointer.x < W / 2) {
      dpadPointerId = pointer.id;
      updateDpad(pointer.x, pointer.y);
    }
  });

  scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
    if (pointer.id === dpadPointerId) updateDpad(pointer.x, pointer.y);
  });

  scene.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
    if (pointer.id === dpadPointerId) {
      dpadPointerId = null;
      dpadStick.setPosition(dpadCx, dpadCy);
      controller.setDirection({ x: 0, y: 0 });
    }
  });

  function updateDpad(px: number, py: number) {
    const dx = px - dpadCx;
    const dy = py - dpadCy;
    const len = Math.min(Math.hypot(dx, dy), DPAD_RADIUS);
    const angle = Math.atan2(dy, dx);
    const sx = Math.cos(angle) * len;
    const sy = Math.sin(angle) * len;
    dpadStick.setPosition(dpadCx + sx, dpadCy + sy);
    controller.setDirection({ x: sx / DPAD_RADIUS, y: sy / DPAD_RADIUS });
  }

  // SWING button (bottom-right, large)
  const swingBtn = scene.add
    .circle(W - 110, H - 130, BUTTON_RADIUS, 0xff4444, 0.7)
    .setScrollFactor(0)
    .setDepth(1000)
    .setInteractive({ useHandCursor: true });
  scene.add
    .text(W - 110, H - 130, 'SWING', { fontSize: '18px', color: '#fff' })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(1001);
  swingBtn.on('pointerdown', () => controller.emit('swing'));

  // LOFT toggle (above swing) — held = loft on
  const loftBtn = scene.add
    .circle(W - 110, H - 250, 36, 0xffaa00, 0.6)
    .setScrollFactor(0)
    .setDepth(1000)
    .setInteractive({ useHandCursor: true });
  scene.add
    .text(W - 110, H - 250, 'LOFT', { fontSize: '14px', color: '#000' })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(1001);
  loftBtn.on('pointerdown', () => controller.setLoft(true));
  loftBtn.on('pointerup', () => controller.setLoft(false));
  loftBtn.on('pointerout', () => controller.setLoft(false));

  // BLOCK / NUDGE — used when Leach is on strike. Hidden by default; toggled
  // via scene events.
  const blockBtn = scene.add
    .circle(W - 200, H - 130, 44, 0x44aaff, 0.6)
    .setScrollFactor(0)
    .setDepth(1000)
    .setInteractive({ useHandCursor: true })
    .setVisible(false);
  const blockText = scene.add
    .text(W - 200, H - 130, 'BLOCK', { fontSize: '14px', color: '#fff' })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(1001)
    .setVisible(false);
  blockBtn.on('pointerdown', () => controller.emit('block'));

  const nudgeBtn = scene.add
    .circle(W - 200, H - 230, 44, 0x44ddaa, 0.6)
    .setScrollFactor(0)
    .setDepth(1000)
    .setInteractive({ useHandCursor: true })
    .setVisible(false);
  const nudgeText = scene.add
    .text(W - 200, H - 230, 'NUDGE', { fontSize: '14px', color: '#000' })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(1001)
    .setVisible(false);
  nudgeBtn.on('pointerdown', () => controller.emit('nudge'));

  const onLeachMode = (active: boolean) => {
    swingBtn.setVisible(!active);
    loftBtn.setVisible(!active);
    blockBtn.setVisible(active);
    blockText.setVisible(active);
    nudgeBtn.setVisible(active);
    nudgeText.setVisible(active);
  };
  scene.events.on('leachMode', onLeachMode);

  return () => {
    scene.events.off('leachMode', onLeachMode);
  };
}
