import Phaser from 'phaser';
import { BOWLERS } from '../game/bowling';
import { resolveShot, resolveLeachAction, type SwingInput } from '../game/batting';
import { applyBall, createInitialState, getOutcome, runsNeeded } from '../game/matchState';
import type { MatchState, ShotResult } from '../game/types';
import { createRng, randomSeed } from '../game/rng';
import { InputController } from '../input/InputController';
import { attachKeyboard } from '../input/KeyboardInput';
import { attachTouch } from '../input/TouchInput';

type Phase = 'idle' | 'runup' | 'flight' | 'resolved';

export class MatchScene extends Phaser.Scene {
  private state!: MatchState;
  private controller!: InputController;
  private detachKeyboard?: () => void;
  private detachTouch?: () => void;
  private rng!: () => number;
  private seed!: number;

  // Pitch geometry (top-down portrait)
  private pitchTopY = 200;
  private pitchBottomY = 1000;
  private pitchX = 360;

  // Visuals
  private ball!: Phaser.GameObjects.Image;
  private batter!: Phaser.GameObjects.Image;
  private nonStriker!: Phaser.GameObjects.Image;
  private bowlerSprite!: Phaser.GameObjects.Image;
  private hudTop!: Phaser.GameObjects.Text;
  private hudBottom!: Phaser.GameObjects.Text;
  private feedbackText!: Phaser.GameObjects.Text;

  private phase: Phase = 'idle';
  private ballReleaseTime = 0;
  private ballArrivalTime = 0;

  constructor() {
    super('Match');
  }

  create() {
    const W = this.scale.width;
    const H = this.scale.height;

    this.cameras.main.setBackgroundColor('#1a6b1a');
    this.drawOval(W, H);

    this.state = createInitialState();
    this.seed = randomSeed();
    this.rng = createRng(this.seed);

    // Pitch
    this.add
      .image(this.pitchX, (this.pitchTopY + this.pitchBottomY) / 2, 'pitch')
      .setDisplaySize(80, this.pitchBottomY - this.pitchTopY);

    // Stumps
    this.add.image(this.pitchX, this.pitchTopY - 8, 'stumps');
    this.add.image(this.pitchX, this.pitchBottomY + 8, 'stumps');

    // Sprites
    this.batter = this.add.image(this.pitchX - 20, this.pitchBottomY - 10, 'batter');
    this.nonStriker = this.add.image(this.pitchX + 20, this.pitchTopY + 10, 'leach');
    this.bowlerSprite = this.add.image(this.pitchX, this.pitchTopY - 60, 'bowler');
    this.ball = this.add.image(this.pitchX, this.pitchTopY, 'ball').setVisible(false);

    // Fielders (simple ring)
    this.drawFielders(W, H);

    // HUD
    this.hudTop = this.add
      .text(W / 2, 30, '', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#ffffff',
        align: 'center',
      })
      .setOrigin(0.5, 0);

    this.hudBottom = this.add
      .text(W / 2, 70, '', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#ffd84d',
        align: 'center',
      })
      .setOrigin(0.5, 0);

    this.feedbackText = this.add
      .text(W / 2, H / 2 - 40, '', {
        fontFamily: 'monospace',
        fontSize: '32px',
        color: '#ffffff',
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(2000);

    this.controller = new InputController();
    this.detachKeyboard = attachKeyboard(this, this.controller);
    this.detachTouch = attachTouch(this, this.controller);

    this.controller.on((event) => this.onInput(event));

    this.updateHud();
    this.scheduleNextBall(900);
  }

  override update(time: number) {
    if (this.phase === 'flight') {
      const t = (time - this.ballReleaseTime) / (this.ballArrivalTime - this.ballReleaseTime);
      const clamped = Math.min(1, Math.max(0, t));
      const y = this.pitchTopY + clamped * (this.pitchBottomY - this.pitchTopY - 20);
      this.ball.setPosition(this.pitchX, y);

      // Past the batter without contact — "no swing" outcome
      if (t > 1.05) {
        this.resolveNoSwing();
      }
    }
  }

  shutdown() {
    this.detachKeyboard?.();
    this.detachTouch?.();
  }

  private onInput(event: 'swing' | 'block' | 'nudge') {
    const isLeach = this.state.onStrike === 'leach';
    if (this.phase !== 'flight') return;

    if (isLeach) {
      if (event === 'block' || event === 'nudge') {
        const result = resolveLeachAction(BOWLERS[this.state.bowler], event, this.rng);
        this.applyResult(result);
      }
      return;
    }

    if (event !== 'swing') return;
    const now = this.time.now;
    const expectedArrival = this.ballArrivalTime;
    const deltaMs = now - expectedArrival;
    const swing: SwingInput = {
      timingDeltaMs: deltaMs,
      zone: this.controller.getZone(),
      lofted: this.controller.getState().loftHeld,
      noSwing: false,
    };
    const result = resolveShot(BOWLERS[this.state.bowler], swing, this.rng);
    this.applyResult(result);
  }

  private resolveNoSwing() {
    if (this.phase !== 'flight') return;
    const isLeach = this.state.onStrike === 'leach';
    if (isLeach) {
      // If Leach didn't pick block/nudge, treat as cautious block
      const result = resolveLeachAction(BOWLERS[this.state.bowler], 'block', this.rng);
      this.applyResult(result);
      return;
    }
    const result = resolveShot(
      BOWLERS[this.state.bowler],
      { timingDeltaMs: 0, zone: null, lofted: false, noSwing: true },
      this.rng,
    );
    this.applyResult(result);
  }

  private applyResult(result: ShotResult) {
    this.phase = 'resolved';
    this.ball.setVisible(false);
    this.showFeedback(result);
    this.state = applyBall(this.state, result);
    this.updateHud();
    this.events.emit('leachMode', this.state.onStrike === 'leach');

    const outcome = getOutcome(this.state);
    if (outcome !== 'inProgress') {
      this.time.delayedCall(800, () => {
        this.scene.start('GameOver', {
          outcome,
          state: this.state,
          seed: this.seed,
        });
      });
      return;
    }

    this.scheduleNextBall(900);
  }

  private scheduleNextBall(delayMs: number) {
    this.phase = 'idle';
    this.events.emit('leachMode', this.state.onStrike === 'leach');

    this.time.delayedCall(delayMs, () => {
      this.startDelivery();
    });
  }

  private startDelivery() {
    const bowler = BOWLERS[this.state.bowler];
    this.phase = 'runup';

    // Run-up animation
    this.tweens.add({
      targets: this.bowlerSprite,
      y: this.pitchTopY - 20,
      duration: 500,
      ease: 'Sine.easeIn',
      onComplete: () => {
        this.phase = 'flight';
        this.ballReleaseTime = this.time.now;
        this.ballArrivalTime = this.ballReleaseTime + bowler.travelMs;
        this.ball.setPosition(this.pitchX, this.pitchTopY).setVisible(true);
        this.bowlerSprite.setY(this.pitchTopY - 60);
      },
    });
  }

  private updateHud() {
    const need = runsNeeded(this.state);
    const balls = this.state.ballsRemaining;
    const wickets = 10 - this.state.wicketsLost;
    this.hudTop.setText(
      `NEED ${need}  ·  ${balls}b LEFT  ·  ${wickets}w IN HAND`,
    );
    this.hudBottom.setText(
      `STOKES ${this.state.stokesRuns}*   LEACH ${this.state.leachRuns}*   bowling: ${
        BOWLERS[this.state.bowler].name
      }   on strike: ${this.state.onStrike.toUpperCase()}`,
    );

    // Swap batter sprites depending on who's on strike
    if (this.state.onStrike === 'stokes') {
      this.batter.setTexture('batter').setPosition(this.pitchX - 20, this.pitchBottomY - 10);
      this.nonStriker.setTexture('leach').setPosition(this.pitchX + 20, this.pitchTopY + 10);
    } else {
      this.batter.setTexture('leach').setPosition(this.pitchX - 20, this.pitchBottomY - 10);
      this.nonStriker.setTexture('batter').setPosition(this.pitchX + 20, this.pitchTopY + 10);
    }
  }

  private showFeedback(result: ShotResult) {
    let msg = '';
    let color = '#ffffff';
    if (result.isWicket) {
      msg = `OUT! ${result.dismissal?.toUpperCase() ?? ''}`;
      color = '#ff4444';
    } else if (result.isSix) {
      msg = 'SIX!';
      color = '#ffd84d';
    } else if (result.isBoundary) {
      msg = 'FOUR!';
      color = '#ffd84d';
    } else if (result.runs > 0) {
      msg = `${result.runs}`;
      color = '#ffffff';
    } else {
      msg = '·';
      color = '#888888';
    }
    this.feedbackText.setText(msg).setColor(color).setAlpha(1);
    this.tweens.add({
      targets: this.feedbackText,
      alpha: 0,
      duration: 700,
      delay: 300,
    });
  }

  private drawOval(W: number, H: number) {
    const g = this.add.graphics();
    g.fillStyle(0x2e8b2e, 1);
    g.fillEllipse(W / 2, H / 2, W * 0.95, H * 0.85);
    // Boundary rope
    g.lineStyle(4, 0xffffff, 0.5);
    g.strokeEllipse(W / 2, H / 2, W * 0.95, H * 0.85);
    // 30-yard circle
    g.lineStyle(2, 0xffffff, 0.25);
    g.strokeEllipse(W / 2, H / 2, W * 0.55, H * 0.5);
  }

  private drawFielders(W: number, H: number) {
    const positions: { x: number; y: number }[] = [
      { x: W / 2, y: H * 0.2 },
      { x: W * 0.18, y: H * 0.25 },
      { x: W * 0.82, y: H * 0.25 },
      { x: W * 0.12, y: H * 0.5 },
      { x: W * 0.88, y: H * 0.5 },
      { x: W / 2 + 100, y: H * 0.4 },
      { x: W / 2 - 100, y: H * 0.4 },
      { x: W * 0.25, y: H * 0.75 },
      { x: W * 0.75, y: H * 0.75 },
    ];
    for (const p of positions) {
      this.add.image(p.x, p.y, 'fielder');
    }
  }
}
