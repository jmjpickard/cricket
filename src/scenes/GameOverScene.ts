import Phaser from 'phaser';
import type { MatchState } from '../game/types';
import type { MatchOutcome } from '../game/matchState';
import { fetchNonce, submitScore } from '../net/leaderboardClient';

type Data = {
  outcome: MatchOutcome;
  state: MatchState;
  seed: number;
};

export class GameOverScene extends Phaser.Scene {
  private payload!: Data;

  constructor() {
    super('GameOver');
  }

  init(data: Data) {
    this.payload = data;
  }

  create() {
    const W = this.scale.width;
    const H = this.scale.height;

    this.cameras.main.setBackgroundColor(this.payload.outcome === 'won' ? '#0e4d0e' : '#3d0a0a');

    const headline = this.payload.outcome === 'won' ? 'WHAT A WIN!' : 'SO CLOSE.';
    this.add
      .text(W / 2, H * 0.2, headline, {
        fontFamily: 'monospace',
        fontSize: '40px',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    const subline =
      this.payload.outcome === 'won'
        ? `Stokes ${this.payload.state.stokesRuns}* · ${this.payload.state.ballsRemaining} balls to spare`
        : `${this.payload.state.score}/${this.payload.state.wicketsLost} — ${
            this.payload.state.target - this.payload.state.score
          } runs short`;
    this.add
      .text(W / 2, H * 0.3, subline, {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#ffd84d',
        align: 'center',
      })
      .setOrigin(0.5);

    if (this.payload.outcome === 'won') {
      this.renderSubmitForm();
    }

    const playAgain = this.add
      .rectangle(W / 2, H * 0.85, 220, 60, 0xffffff, 0.2)
      .setInteractive({ useHandCursor: true });
    this.add
      .text(W / 2, H * 0.85, 'PLAY AGAIN', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#ffffff',
      })
      .setOrigin(0.5);
    playAgain.on('pointerdown', () => this.scene.start('Menu'));
  }

  private renderSubmitForm() {
    const W = this.scale.width;
    const H = this.scale.height;

    this.add
      .text(W / 2, H * 0.45, 'Enter your name (12 chars max):', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#cccccc',
      })
      .setOrigin(0.5);

    const inputEl = document.createElement('input');
    inputEl.type = 'text';
    inputEl.maxLength = 12;
    inputEl.placeholder = 'STOKES';
    inputEl.style.cssText = `
      position: fixed;
      left: 50%;
      top: ${H * 0.5}px;
      transform: translate(-50%, -50%);
      font-family: monospace;
      font-size: 20px;
      padding: 8px 12px;
      text-align: center;
      width: 200px;
      z-index: 9999;
    `;
    document.body.appendChild(inputEl);
    this.events.once('shutdown', () => inputEl.remove());

    const submitBtn = this.add
      .rectangle(W / 2, H * 0.62, 200, 50, 0xff4444, 0.9)
      .setInteractive({ useHandCursor: true });
    const submitText = this.add
      .text(W / 2, H * 0.62, 'SUBMIT', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    let submitting = false;
    submitBtn.on('pointerdown', async () => {
      if (submitting) return;
      const name = (inputEl.value || 'STOKES').slice(0, 12).toUpperCase();
      submitting = true;
      submitText.setText('SENDING…');
      try {
        const nonce = await fetchNonce();
        const ok = await submitScore({
          name,
          ballsToSpare: this.payload.state.ballsRemaining,
          runsScored: this.payload.state.stokesRuns,
          nonce,
        });
        submitText.setText(ok ? 'SUBMITTED' : 'FAILED');
      } catch {
        submitText.setText('OFFLINE');
      } finally {
        inputEl.remove();
      }
    });
  }
}
