import Phaser from 'phaser';
import { fetchLeaderboard, type LeaderboardEntry } from '../net/leaderboardClient';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create() {
    const W = this.scale.width;
    const H = this.scale.height;

    this.cameras.main.setBackgroundColor('#0a3d0a');

    this.add
      .text(W / 2, H * 0.18, 'STOKES AT HEADINGLEY', {
        fontFamily: 'monospace',
        fontSize: '36px',
        color: '#ffffff',
        align: 'center',
      })
      .setOrigin(0.5);

    this.add
      .text(W / 2, H * 0.24, 'Ashes 2019 — Chase 359', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#ffd84d',
      })
      .setOrigin(0.5);

    this.add
      .text(
        W / 2,
        H * 0.34,
        '286/9 · 73 to win · Leach at the other end\n\nDirection + timing.\nTap SWING when the ball arrives.\nLOFT for sixes (risky).',
        {
          fontFamily: 'monospace',
          fontSize: '15px',
          color: '#dddddd',
          align: 'center',
        },
      )
      .setOrigin(0.5);

    const startBtn = this.add
      .rectangle(W / 2, H * 0.55, 220, 60, 0xff4444, 0.9)
      .setInteractive({ useHandCursor: true });
    this.add
      .text(W / 2, H * 0.55, 'START', {
        fontFamily: 'monospace',
        fontSize: '24px',
        color: '#ffffff',
      })
      .setOrigin(0.5);
    startBtn.on('pointerdown', () => this.scene.start('Match'));

    this.add
      .text(W / 2, H * 0.66, 'TOP CHASES', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#ffd84d',
      })
      .setOrigin(0.5);

    const lbText = this.add
      .text(W / 2, H * 0.72, 'loading…', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#cccccc',
        align: 'center',
      })
      .setOrigin(0.5, 0);

    void this.loadLeaderboard(lbText);
  }

  private async loadLeaderboard(target: Phaser.GameObjects.Text) {
    try {
      const entries = await fetchLeaderboard(5);
      target.setText(formatLeaderboard(entries));
    } catch {
      target.setText('(offline)');
    }
  }
}

function formatLeaderboard(entries: LeaderboardEntry[]): string {
  if (entries.length === 0) return '(no scores yet)';
  return entries
    .map((e, i) => `${i + 1}. ${e.name.padEnd(12)} ${e.ballsToSpare}b spare`)
    .join('\n');
}
