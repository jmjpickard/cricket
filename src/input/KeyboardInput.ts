import Phaser from 'phaser';
import type { InputController } from './InputController';

/**
 * Maps arrow keys → direction, SPACE → swing, L → loft modifier,
 * B → block (Leach mode), N → nudge (Leach mode), X → run, Z → stay.
 * Free fallback for desktop.
 */
export function attachKeyboard(
  scene: Phaser.Scene,
  controller: InputController,
): () => void {
  const keyboard = scene.input.keyboard;
  if (!keyboard) return () => {};

  const up = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.UP);
  const down = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN);
  const left = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT);
  const right = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT);
  const swing = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
  const loft = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.L);
  const block = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.B);
  const nudge = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.N);
  const runKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.X);
  const stayKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Z);

  const onUpdate = () => {
    const dir = {
      x: (right.isDown ? 1 : 0) - (left.isDown ? 1 : 0),
      y: (down.isDown ? 1 : 0) - (up.isDown ? 1 : 0),
    };
    controller.setDirection(dir);
    controller.setLoft(loft.isDown);
  };

  scene.events.on('update', onUpdate);

  const swingDown = () => controller.emit('swing');
  const blockDown = () => controller.emit('block');
  const nudgeDown = () => controller.emit('nudge');
  const runDown = () => controller.emit('run');
  const stayDown = () => controller.emit('stay');
  swing.on('down', swingDown);
  block.on('down', blockDown);
  nudge.on('down', nudgeDown);
  runKey.on('down', runDown);
  stayKey.on('down', stayDown);

  return () => {
    scene.events.off('update', onUpdate);
    swing.off('down', swingDown);
    block.off('down', blockDown);
    nudge.off('down', nudgeDown);
    runKey.off('down', runDown);
    stayKey.off('down', stayDown);
  };
}
