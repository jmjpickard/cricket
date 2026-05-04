import Phaser from 'phaser';

/**
 * Generates pixel-art-ish placeholder textures procedurally so the game runs
 * with zero binary assets in the repo. Real sprites can replace these later.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create() {
    this.makeCircle('ball', 8, 0xffffff);
    this.makeCircle('batter', 18, 0x1f4eff);
    this.makeCircle('leach', 18, 0x9aa3ff);
    this.makeCircle('bowler', 20, 0xffd84d);
    this.makeCircle('fielder', 16, 0xffe1a8);
    this.makeRect('pitch', 80, 320, 0xd2b16a);
    this.makeRect('stumps', 18, 6, 0xffffff);
    this.scene.start('Menu');
  }

  private makeCircle(key: string, radius: number, color: number) {
    const g = this.add.graphics();
    g.fillStyle(color, 1).fillCircle(radius, radius, radius);
    g.lineStyle(2, 0x000000, 0.4).strokeCircle(radius, radius, radius);
    g.generateTexture(key, radius * 2, radius * 2);
    g.destroy();
  }

  private makeRect(key: string, w: number, h: number, color: number) {
    const g = this.add.graphics();
    g.fillStyle(color, 1).fillRect(0, 0, w, h);
    g.generateTexture(key, w, h);
    g.destroy();
  }
}
