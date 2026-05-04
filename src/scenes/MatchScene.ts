import Phaser from 'phaser';
import { BOWLERS, planDelivery, type DeliveryPlan } from '../game/bowling';
import {
  resolveShot,
  resolveLeachAction,
  resolveRunOutcome,
  type SwingInput,
  type RunDecision,
} from '../game/batting';
import { applyBall, createInitialState, getOutcome, runsNeeded } from '../game/matchState';
import type { MatchState, ShotResult, ShotZone } from '../game/types';
import { createRng, randomSeed } from '../game/rng';
import { InputController } from '../input/InputController';
import { attachKeyboard } from '../input/KeyboardInput';
import { attachTouch } from '../input/TouchInput';

type Phase =
  | 'idle'
  | 'runup'
  | 'preBounce'
  | 'postBounce'
  | 'shotAnimation'
  | 'runDecision'
  | 'resolved'
  | 'overBanner';

const RUN_DECISION_MS = 1200;
const OVER_BANNER_MS = 1400;
const SAFE_FIELDER_DISTANCE_PX = 220;

// Direction vector per zone (matches InputController angle table). +x right, +y down.
// Batter is at the bottom of the pitch, so 'straight' (toward the bowler) is -y.
const ZONE_DIR: Record<ShotZone, { x: number; y: number }> = {
  cover: { x: 1, y: 0 },
  point: { x: 0.7, y: 0.7 },
  thirdMan: { x: 0, y: 1 },
  fineLeg: { x: -0.7, y: 0.7 },
  square: { x: -1, y: 0 },
  midwicket: { x: -0.7, y: -0.7 },
  straight: { x: 0, y: -1 },
  midOn: { x: 0.7, y: -0.7 },
};

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
  private boundaryRadiusPx = 360;

  // Visuals
  private ball!: Phaser.GameObjects.Image;
  private batter!: Phaser.GameObjects.Image;
  private nonStriker!: Phaser.GameObjects.Image;
  private bowlerSprite!: Phaser.GameObjects.Image;
  private hudTop!: Phaser.GameObjects.Text;
  private hudBottom!: Phaser.GameObjects.Text;
  private feedbackText!: Phaser.GameObjects.Text;
  private bounceMarker!: Phaser.GameObjects.Graphics;
  private timingRing!: Phaser.GameObjects.Graphics;
  private overBanner!: Phaser.GameObjects.Container;

  private fielderSprites: Phaser.GameObjects.Image[] = [];
  private fielderHomes: { x: number; y: number }[] = [];

  private phase: Phase = 'idle';
  private delivery!: DeliveryPlan;
  private ballReleaseTime = 0;
  private ballBounceTime = 0;
  private ballArrivalTime = 0;
  private bounceFlashed = false;

  // Pending result + run-decision state
  private pendingResult: ShotResult | null = null;
  private pendingFielderDistance = 0;
  private runDecisionEndTime = 0;

  constructor() {
    super('Match');
  }

  create() {
    const W = this.scale.width;
    const H = this.scale.height;
    this.boundaryRadiusPx = Math.min(W * 0.45, H * 0.4);

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
    this.ball = this.add.image(this.pitchX, this.pitchTopY, 'ball').setVisible(false).setDepth(50);

    // Bounce target marker (drawn under the ball, above the pitch)
    this.bounceMarker = this.add.graphics().setDepth(20).setVisible(false);

    // Timing ring (drawn around the batter, above the pitch)
    this.timingRing = this.add.graphics().setDepth(40).setVisible(false);

    // Fielders (simple ring, persistent sprites we can animate)
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

    // End-of-over banner (hidden by default)
    this.overBanner = this.makeOverBanner(W, H);

    this.controller = new InputController();
    this.detachKeyboard = attachKeyboard(this, this.controller);
    this.detachTouch = attachTouch(this, this.controller);

    this.controller.on((event) => this.onInput(event));

    this.updateHud();
    this.scheduleNextBall(900);
  }

  override update(time: number) {
    if (this.phase === 'preBounce') {
      const t = (time - this.ballReleaseTime) / this.delivery.preBounceMs;
      const clamped = Math.min(1, Math.max(0, t));
      const x = this.delivery.releasePx.x + clamped * (this.delivery.bouncePx.x - this.delivery.releasePx.x);
      const y = this.delivery.releasePx.y + clamped * (this.delivery.bouncePx.y - this.delivery.releasePx.y);
      // Slight scale-up to mimic ball "growing" as it approaches
      const scale = 1 + clamped * 0.3;
      this.ball.setPosition(x, y).setScale(scale);
      if (t >= 1) this.enterPostBounce(time);
      return;
    }

    if (this.phase === 'postBounce') {
      const t = (time - this.ballBounceTime) / this.delivery.postBounceMs;
      const clamped = Math.min(1, Math.max(0, t));
      const x = this.delivery.bouncePx.x + clamped * (this.delivery.arrivalPx.x - this.delivery.bouncePx.x);
      const y = this.delivery.bouncePx.y + clamped * (this.delivery.arrivalPx.y - this.delivery.bouncePx.y);
      const scale = 1.3 + clamped * 0.2;
      this.ball.setPosition(x, y).setScale(scale);

      this.drawTimingRing(time);

      if (t > 1.05) {
        this.resolveNoSwing();
      }
      return;
    }

    if (this.phase === 'runDecision' && time >= this.runDecisionEndTime) {
      this.completeRunDecision('stay');
    }
  }

  shutdown() {
    this.detachKeyboard?.();
    this.detachTouch?.();
  }

  private onInput(event: 'swing' | 'block' | 'nudge' | 'run' | 'stay') {
    if (this.phase === 'runDecision' && (event === 'run' || event === 'stay')) {
      this.completeRunDecision(event === 'run' ? 'go' : 'stay');
      return;
    }

    const isLeach = this.state.onStrike === 'leach';
    if (this.phase !== 'postBounce') return;

    if (isLeach) {
      if (event === 'block' || event === 'nudge') {
        const result = resolveLeachAction(BOWLERS[this.state.bowler], event, this.rng);
        this.beginShotAnimation(result);
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
    this.beginShotAnimation(result);
  }

  private resolveNoSwing() {
    if (this.phase !== 'postBounce') return;
    const isLeach = this.state.onStrike === 'leach';
    if (isLeach) {
      // If Leach didn't pick block/nudge, treat as cautious block
      const result = resolveLeachAction(BOWLERS[this.state.bowler], 'block', this.rng);
      this.beginShotAnimation(result);
      return;
    }
    const result = resolveShot(
      BOWLERS[this.state.bowler],
      { timingDeltaMs: 0, zone: null, lofted: false, noSwing: true },
      this.rng,
    );
    this.beginShotAnimation(result);
  }

  /**
   * After contact: tween the ball to its target on the field, send a fielder
   * to intercept, and (for non-boundary, non-wicket, non-dot results) open
   * the GO/STAY run decision window.
   */
  private beginShotAnimation(result: ShotResult) {
    this.phase = 'shotAnimation';
    this.timingRing.setVisible(false);
    this.bounceMarker.setVisible(false);
    this.pendingResult = result;

    const target = this.shotTargetPoint(result);
    const distance = Math.hypot(target.x - this.batter.x, target.y - this.batter.y);
    const animMs = Math.min(1200, 500 + distance * 1.1);

    // Stop any ball motion from the flight phases
    this.tweens.killTweensOf(this.ball);

    this.tweens.add({
      targets: this.ball,
      x: target.x,
      y: target.y,
      scale: 1,
      duration: animMs,
      ease: 'Sine.easeOut',
      onComplete: () => this.onShotAnimationComplete(),
    });

    // Pick & dispatch fielder
    const fielderIdx = this.nearestFielder(target);
    const home = this.fielderHomes[fielderIdx]!;
    this.pendingFielderDistance = Math.hypot(home.x - target.x, home.y - target.y);
    this.dispatchFielder(fielderIdx, target, animMs, result);
  }

  private onShotAnimationComplete() {
    const result = this.pendingResult;
    if (!result) return;

    if (result.isBoundary) {
      this.applyResult(result);
      return;
    }
    if (result.isWicket) {
      this.applyResult(result);
      return;
    }
    const intended = result.intendedRuns ?? result.runs ?? 0;
    if (intended <= 0) {
      this.applyResult(result);
      return;
    }
    this.openRunDecision(intended);
  }

  private openRunDecision(intendedRuns: number) {
    this.phase = 'runDecision';
    this.runDecisionEndTime = this.time.now + RUN_DECISION_MS;
    this.events.emit('runDecisionMode', true);
    this.feedbackText
      .setText(`RUN ${intendedRuns}? — X to GO / Z to STAY`)
      .setColor('#ffffff')
      .setAlpha(1);
  }

  private completeRunDecision(decision: RunDecision) {
    if (this.phase !== 'runDecision') return;
    this.phase = 'resolved';
    this.events.emit('runDecisionMode', false);
    this.feedbackText.setAlpha(0);

    const baseResult = this.pendingResult;
    if (!baseResult) return;
    const intended = baseResult.intendedRuns ?? baseResult.runs ?? 0;

    const outcome = resolveRunOutcome(
      intended,
      this.pendingFielderDistance,
      SAFE_FIELDER_DISTANCE_PX,
      decision,
      this.rng,
    );

    let finalResult: ShotResult;
    if (outcome.runOut) {
      finalResult = {
        ...baseResult,
        runs: 0,
        isWicket: true,
        dismissal: 'runOut',
      };
    } else {
      finalResult = { ...baseResult, runs: outcome.runs };
    }
    this.applyResult(finalResult);
  }

  private applyResult(result: ShotResult) {
    this.phase = 'resolved';
    this.pendingResult = null;
    this.events.emit('runDecisionMode', false);
    this.ball.setVisible(false);
    this.showFeedback(result);

    const prev = this.state;
    this.state = applyBall(prev, result);
    this.updateHud();
    this.events.emit('leachMode', this.state.onStrike === 'leach');

    const matchOutcome = getOutcome(this.state);
    if (matchOutcome !== 'inProgress') {
      this.time.delayedCall(800, () => {
        this.scene.start('GameOver', {
          outcome: matchOutcome,
          state: this.state,
          seed: this.seed,
        });
      });
      return;
    }

    const isOverEnd = prev.ballsBowled % 6 !== 0 && this.state.ballsBowled % 6 === 0;
    if (isOverEnd) {
      this.showOverBanner();
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
    this.bounceFlashed = false;

    this.delivery = planDelivery(
      bowler,
      { pitchTopY: this.pitchTopY, pitchBottomY: this.pitchBottomY, pitchX: this.pitchX },
      this.rng,
    );

    // Tint bowler sprite per bowler
    this.bowlerSprite.setTint(bowler.tintColor);

    // Show predicted bounce marker during run-up
    this.drawBounceMarker(bowler.tintColor, bowler.style === 'spin');
    this.bounceMarker.setAlpha(0).setVisible(true);
    this.tweens.add({
      targets: this.bounceMarker,
      alpha: 1,
      duration: this.delivery.runUpMs * 0.7,
    });

    // Run-up: slide bowler to crease, with bob (yoyo y).
    this.tweens.add({
      targets: this.bowlerSprite,
      y: this.pitchTopY - 18,
      duration: this.delivery.runUpMs,
      ease: 'Sine.easeIn',
      onComplete: () => {
        this.phase = 'preBounce';
        this.ballReleaseTime = this.time.now;
        this.ballBounceTime = this.ballReleaseTime + this.delivery.preBounceMs;
        this.ballArrivalTime = this.ballBounceTime + this.delivery.postBounceMs;
        this.ball
          .setPosition(this.delivery.releasePx.x, this.delivery.releasePx.y)
          .setScale(1)
          .setVisible(true);
        this.bowlerSprite.setY(this.pitchTopY - 60);
      },
    });

    // Subtle bob during run-up (separate tween on a clone of the sprite — simpler: scale yoyo)
    this.tweens.add({
      targets: this.bowlerSprite,
      scale: 1.08,
      duration: Math.max(120, this.delivery.runUpMs / 4),
      yoyo: true,
      repeat: 2,
    });
  }

  private enterPostBounce(time: number) {
    this.phase = 'postBounce';
    this.ballBounceTime = time;
    this.ballArrivalTime = time + this.delivery.postBounceMs;

    // Bounce "thock": scale-yoyo flash on the marker
    this.tweens.killTweensOf(this.bounceMarker);
    this.bounceMarker.setAlpha(1);
    this.tweens.add({
      targets: this.bounceMarker,
      alpha: 0,
      duration: 250,
    });

    this.bounceFlashed = true;
  }

  private drawBounceMarker(color: number, spin: boolean) {
    const g = this.bounceMarker;
    g.clear();
    const { x, y } = this.delivery.bouncePx;
    g.lineStyle(3, color, 0.9);
    g.strokeCircle(x, y, 14);
    g.lineStyle(2, color, 0.5);
    g.strokeCircle(x, y, 22);
    // Direction-of-break arrow for spin
    if (spin) {
      const dx = this.delivery.arrivalPx.x - x;
      const sign = dx >= 0 ? 1 : -1;
      g.lineStyle(3, color, 0.9);
      g.beginPath();
      g.moveTo(x, y + 18);
      g.lineTo(x + sign * 30, y + 18);
      g.lineTo(x + sign * 22, y + 12);
      g.moveTo(x + sign * 30, y + 18);
      g.lineTo(x + sign * 22, y + 24);
      g.strokePath();
    }
  }

  private drawTimingRing(time: number) {
    const bowler = BOWLERS[this.state.bowler];
    const remaining = this.ballArrivalTime - time;
    const totalWindow = bowler.perfectWindowMs * 3;
    const t = Math.min(1, Math.max(0, remaining / totalWindow));
    const maxR = 60;
    const outerR = Math.max(0, t * maxR);
    const perfectR = (bowler.perfectWindowMs / 2 / totalWindow) * maxR;

    let color = 0xff5555;
    if (outerR <= perfectR) color = 0x55ff55;
    else if (outerR <= perfectR * 3) color = 0xffd84d;

    const g = this.timingRing;
    g.clear();
    g.setVisible(true);
    g.lineStyle(3, color, 0.9);
    g.strokeCircle(this.batter.x, this.batter.y, outerR);
    g.lineStyle(2, 0x55ff55, 0.6);
    g.strokeCircle(this.batter.x, this.batter.y, perfectR);
  }

  private shotTargetPoint(result: ShotResult): { x: number; y: number } {
    const bx = this.batter.x;
    const by = this.batter.y;
    const dir = result.zone ? ZONE_DIR[result.zone] : { x: 0, y: -1 };
    const len = Math.hypot(dir.x, dir.y) || 1;
    const ux = dir.x / len;
    const uy = dir.y / len;

    if (result.isBoundary) {
      // Six clears the rope; four reaches it
      const dist = result.isSix ? this.boundaryRadiusPx + 60 : this.boundaryRadiusPx;
      return { x: bx + ux * dist, y: by + uy * dist };
    }

    if (result.isWicket && result.dismissal === 'caught') {
      // target the nearest fielder along the chosen line
      const probe = { x: bx + ux * this.boundaryRadiusPx * 0.8, y: by + uy * this.boundaryRadiusPx * 0.8 };
      const idx = this.nearestFielder(probe);
      const home = this.fielderHomes[idx]!;
      return { x: home.x, y: home.y };
    }

    const intended = result.intendedRuns ?? result.runs ?? 0;
    const fracByRuns: Record<number, number> = { 0: 0.18, 1: 0.4, 2: 0.6, 3: 0.78 };
    const frac = fracByRuns[intended] ?? 0.3;
    return {
      x: bx + ux * this.boundaryRadiusPx * frac,
      y: by + uy * this.boundaryRadiusPx * frac,
    };
  }

  private nearestFielder(point: { x: number; y: number }): number {
    let best = 0;
    let bestD = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.fielderHomes.length; i++) {
      const f = this.fielderHomes[i];
      if (!f) continue;
      const d = Math.hypot(f.x - point.x, f.y - point.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  private dispatchFielder(
    idx: number,
    target: { x: number; y: number },
    animMs: number,
    result: ShotResult,
  ) {
    if (result.isBoundary) return; // ball goes past, no fielder intercept

    const sprite = this.fielderSprites[idx];
    const home = this.fielderHomes[idx];
    if (!sprite || !home) return;

    this.tweens.killTweensOf(sprite);
    this.tweens.add({
      targets: sprite,
      x: target.x,
      y: target.y,
      duration: animMs,
      ease: 'Sine.easeOut',
      onComplete: () => {
        sprite.setTint(0xffffff);
        this.tweens.add({
          targets: sprite,
          scale: 1.25,
          duration: 120,
          yoyo: true,
        });
        this.tweens.add({
          targets: sprite,
          x: home.x,
          y: home.y,
          duration: 700,
          delay: 200,
          ease: 'Sine.easeIn',
          onComplete: () => sprite.clearTint(),
        });
      },
    });
    sprite.setTint(0xffeeaa);
  }

  private updateHud() {
    const need = runsNeeded(this.state);
    const balls = this.state.ballsRemaining;
    const wickets = 10 - this.state.wicketsLost;
    const ballInOver = (this.state.ballsBowled % 6) + 1;
    this.hudTop.setText(
      `NEED ${need}  ·  ${balls}b LEFT  ·  ${wickets}w IN HAND  ·  BALL ${ballInOver}/6`,
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

  private makeOverBanner(W: number, H: number): Phaser.GameObjects.Container {
    const bg = this.add.rectangle(0, 0, W * 0.85, 140, 0x000000, 0.8).setStrokeStyle(3, 0xffffff);
    const line1 = this.add.text(0, -28, '', {
      fontFamily: 'monospace',
      fontSize: '26px',
      color: '#ffffff',
      align: 'center',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    const line2 = this.add.text(0, 22, '', {
      fontFamily: 'monospace',
      fontSize: '20px',
      color: '#ffd84d',
      align: 'center',
    }).setOrigin(0.5);
    const c = this.add.container(W / 2, H / 2, [bg, line1, line2]);
    c.setDepth(3000).setVisible(false);
    (c as Phaser.GameObjects.Container & { _line1: Phaser.GameObjects.Text; _line2: Phaser.GameObjects.Text; _bg: Phaser.GameObjects.Rectangle })._line1 = line1;
    (c as Phaser.GameObjects.Container & { _line1: Phaser.GameObjects.Text; _line2: Phaser.GameObjects.Text; _bg: Phaser.GameObjects.Rectangle })._line2 = line2;
    (c as Phaser.GameObjects.Container & { _line1: Phaser.GameObjects.Text; _line2: Phaser.GameObjects.Text; _bg: Phaser.GameObjects.Rectangle })._bg = bg;
    return c;
  }

  private showOverBanner() {
    this.phase = 'overBanner';
    const overNum = this.state.ballsBowled / 6;
    const next = BOWLERS[this.state.bowler];
    const banner = this.overBanner as Phaser.GameObjects.Container & {
      _line1: Phaser.GameObjects.Text;
      _line2: Phaser.GameObjects.Text;
      _bg: Phaser.GameObjects.Rectangle;
    };
    banner._line1.setText(`END OF OVER ${overNum}`);
    banner._line2.setText(`NEXT: ${next.name.toUpperCase()} (${next.style})`);
    banner._bg.setFillStyle(next.tintColor, 0.25).setStrokeStyle(3, next.tintColor);
    banner.setVisible(true).setAlpha(0).setScale(0.85);
    this.tweens.add({
      targets: banner,
      alpha: 1,
      scale: 1,
      duration: 220,
      ease: 'Back.easeOut',
    });
    this.time.delayedCall(OVER_BANNER_MS, () => {
      this.tweens.add({
        targets: banner,
        alpha: 0,
        duration: 220,
        onComplete: () => {
          banner.setVisible(false);
          this.scheduleNextBall(300);
        },
      });
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
      const sprite = this.add.image(p.x, p.y, 'fielder').setDepth(30);
      this.fielderSprites.push(sprite);
      this.fielderHomes.push({ x: p.x, y: p.y });
    }
  }
}
