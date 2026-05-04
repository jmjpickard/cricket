import Phaser from 'phaser';
import type { InputController } from './InputController';

const DPAD_RADIUS = 90;
const BUTTON_RADIUS = 60;

/**
 * On-screen analog D-pad (bottom-left), SWING / BLOCK / NUDGE buttons
 * (bottom-right) and a persistent RUN button (above SWING) that the
 * batter can tap any time the ball is in play to take another run.
 */
export function attachTouch(scene: Phaser.Scene, controller: InputController): () => void {
  const W = scene.scale.width;
  const H = scene.scale.height;

  const dpadCx = 110;
  const dpadCy = H - 130;

  scene.add
    .circle(dpadCx, dpadCy, DPAD_RADIUS, 0xffffff, 0.15)
    .setScrollFactor(0)
    .setDepth(1000);
  const dpadStick = scene.add
    .circle(dpadCx, dpadCy, 36, 0xffffff, 0.5)
    .setScrollFactor(0)
    .setDepth(1001);

  let dpadPointerId: number | null = null;

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
    .circle(W - 110, H - 130, BUTTON_RADIUS, 0xff4444, 0.75)
    .setScrollFactor(0)
    .setDepth(1000)
    .setInteractive({ useHandCursor: true });
  const swingText = scene.add
    .text(W - 110, H - 130, 'SWING', { fontSize: '18px', color: '#fff', fontStyle: 'bold' })
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
  const loftText = scene.add
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
    .circle(W - 220, H - 130, 44, 0x44aaff, 0.6)
    .setScrollFactor(0)
    .setDepth(1000)
    .setInteractive({ useHandCursor: true })
    .setVisible(false);
  const blockText = scene.add
    .text(W - 220, H - 130, 'BLOCK', { fontSize: '14px', color: '#fff' })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(1001)
    .setVisible(false);
  blockBtn.on('pointerdown', () => controller.emit('block'));

  const nudgeBtn = scene.add
    .circle(W - 220, H - 240, 44, 0x44ddaa, 0.6)
    .setScrollFactor(0)
    .setDepth(1000)
    .setInteractive({ useHandCursor: true })
    .setVisible(false);
  const nudgeText = scene.add
    .text(W - 220, H - 240, 'NUDGE', { fontSize: '14px', color: '#000' })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(1001)
    .setVisible(false);
  nudgeBtn.on('pointerdown', () => controller.emit('nudge'));

  // Persistent RUN button — visible the whole match, but only tappable while
  // the ball is in play (the scene listens & the controller logic ignores
  // presses outside that window). Sits to the LEFT of SWING so a single thumb
  // can hit either.
  const runBtn = scene.add
    .circle(W - 240, H - 130, BUTTON_RADIUS, 0x44ddaa, 0.85)
    .setScrollFactor(0)
    .setDepth(1010)
    .setInteractive({ useHandCursor: true });
  const runText = scene.add
    .text(W - 240, H - 130, 'RUN', { fontSize: '22px', color: '#003322', fontStyle: 'bold' })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(1011);
  runBtn.on('pointerdown', () => controller.emit('run'));

  // NEXT OVER button — full-screen modal action; visible only during the
  // end-of-over modal phase.
  const nextOverBtn = scene.add
    .rectangle(W / 2, H * 0.62, 280, 80, 0xff4444, 0.95)
    .setScrollFactor(0)
    .setDepth(3010)
    .setInteractive({ useHandCursor: true })
    .setVisible(false);
  const nextOverText = scene.add
    .text(W / 2, H * 0.62, 'NEXT OVER', { fontSize: '26px', color: '#ffffff', fontStyle: 'bold' })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(3011)
    .setVisible(false);
  nextOverBtn.on('pointerdown', () => controller.emit('nextOver'));

  let leachActive = false;
  let runArmed = false;
  let nextOverActive = false;

  const refreshButtons = () => {
    const showLeachBatting = leachActive && !nextOverActive;
    const showStokesBatting = !leachActive && !nextOverActive;
    swingBtn.setVisible(showStokesBatting);
    swingText.setVisible(showStokesBatting);
    loftBtn.setVisible(showStokesBatting);
    loftText.setVisible(showStokesBatting);
    blockBtn.setVisible(showLeachBatting);
    blockText.setVisible(showLeachBatting);
    nudgeBtn.setVisible(showLeachBatting);
    nudgeText.setVisible(showLeachBatting);

    // RUN is always present but dimmed when not armed.
    const runVisible = !nextOverActive;
    runBtn.setVisible(runVisible);
    runText.setVisible(runVisible);
    runBtn.setFillStyle(0x44ddaa, runArmed ? 0.95 : 0.35);
    runText.setColor(runArmed ? '#003322' : '#114433');

    nextOverBtn.setVisible(nextOverActive);
    nextOverText.setVisible(nextOverActive);
  };

  const onLeachMode = (active: boolean) => {
    leachActive = active;
    refreshButtons();
  };
  const onRunArmed = (armed: boolean) => {
    runArmed = armed;
    refreshButtons();
  };
  const onNextOver = (active: boolean) => {
    nextOverActive = active;
    refreshButtons();
  };
  scene.events.on('leachMode', onLeachMode);
  scene.events.on('runArmed', onRunArmed);
  scene.events.on('nextOverModal', onNextOver);

  refreshButtons();

  return () => {
    scene.events.off('leachMode', onLeachMode);
    scene.events.off('runArmed', onRunArmed);
    scene.events.off('nextOverModal', onNextOver);
  };
}
