import Phaser from 'phaser';
import { BOWLERS, planDelivery, type DeliveryPlan } from '../game/bowling';
import {
  resolveShot,
  resolveLeachAction,
  type SwingInput,
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
  | 'ballInPlay'
  | 'resolved'
  | 'overModal';

// Pacing knobs — bumped for "more time between balls / longer to read bounce".
const BALL_TRAVEL_MULTIPLIER = 1.45;
const BETWEEN_BALLS_MS = 1600;
const BETWEEN_BALLS_AFTER_OVER_MS = 600;
const LEG_RUN_MS = 950;
const FIELDER_RETURN_MS = 1200;

// Field & camera
const BOUNDARY_RADIUS_PX = 900;
const WORLD_PAD = 80;

// Bat swing
const BAT_HOLD_OFFSET = 14;
const BAT_BACKLIFT_RAD = -0.85;
const BAT_FOLLOW_THROUGH_OFFSET = 0.6;

// Direction vector per zone (matches InputController angle table). +x right, +y down.
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

type RunState = {
  legActive: boolean;
  legProgress: number;
  legStartTime: number;
  // direction the striker is travelling: 'up' = toward bowler end, 'down' = back to batter end.
  legDirection: 'up' | 'down';
  legsCompleted: number;
  legsAttempted: number;
  pendingLeg: boolean;
  // Whether the ball has been "fielded" — once fielded, every additional run is greedy.
  ballFielded: boolean;
  // Time at which the ball returns to the stumps (run-out check).
  ballAtStumpsTime: number;
};

export class MatchScene extends Phaser.Scene {
  private state!: MatchState;
  private controller!: InputController;
  private detachKeyboard?: () => void;
  private detachTouch?: () => void;
  private rng!: () => number;
  private seed!: number;

  // Pitch geometry (top-down portrait)
  private pitchTopY = 320;
  private pitchBottomY = 1080;
  private pitchX = 360;

  // Camera
  private viewW = 720;
  private viewH = 1280;
  private cameraDefaultX = 360;
  private cameraDefaultY = 640;

  // Visuals
  private ball!: Phaser.GameObjects.Image;
  private batter!: Phaser.GameObjects.Image;
  private nonStriker!: Phaser.GameObjects.Image;
  private bowlerSprite!: Phaser.GameObjects.Image;
  private bat!: Phaser.GameObjects.Image;
  private hudTop!: Phaser.GameObjects.Text;
  private hudBottom!: Phaser.GameObjects.Text;
  private feedbackText!: Phaser.GameObjects.Text;
  private runIndicator!: Phaser.GameObjects.Text;
  private bounceMarker!: Phaser.GameObjects.Graphics;
  private timingRing!: Phaser.GameObjects.Graphics;
  private overModal!: Phaser.GameObjects.Container;

  private fielderSprites: Phaser.GameObjects.Image[] = [];
  private fielderHomes: { x: number; y: number }[] = [];

  private phase: Phase = 'idle';
  private delivery!: DeliveryPlan;
  private ballReleaseTime = 0;
  private ballBounceTime = 0;
  private ballArrivalTime = 0;

  // Pending result + run-decision state
  private pendingResult: ShotResult | null = null;
  private run!: RunState;
  private ballInPlayDeadline = 0;
  private cachedFielderDistance = 0;

  // End-of-over snapshot (for modal stats)
  private overSnapshot: {
    overNum: number;
    runsThisOver: number;
    wicketsThisOver: number;
    balls: string[];
  } = { overNum: 0, runsThisOver: 0, wicketsThisOver: 0, balls: [] };

  constructor() {
    super('Match');
  }

  create() {
    this.viewW = this.scale.width;
    this.viewH = this.scale.height;

    // Camera bounds: centred on the pitch, well wider than the viewport so the
    // ball can travel "off-screen" and we can pan to follow it.
    const fieldHalf = BOUNDARY_RADIUS_PX + WORLD_PAD;
    const cx = this.pitchX;
    const cy = (this.pitchTopY + this.pitchBottomY) / 2;
    this.cameras.main.setBounds(cx - fieldHalf, cy - fieldHalf, fieldHalf * 2, fieldHalf * 2);

    // Keep batter visible by default: centre the camera with the batter in
    // the lower third of the screen.
    this.cameraDefaultX = this.pitchX;
    this.cameraDefaultY = this.pitchBottomY - this.viewH * 0.35;
    this.cameras.main.centerOn(this.cameraDefaultX, this.cameraDefaultY);

    this.cameras.main.setBackgroundColor('#0a4a0a');
    this.drawOval();

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
    this.batter = this.add
      .image(this.pitchX - 22, this.pitchBottomY - 10, 'batter')
      .setDepth(40);
    this.nonStriker = this.add
      .image(this.pitchX + 22, this.pitchTopY + 10, 'leach')
      .setDepth(40);
    this.bowlerSprite = this.add.image(this.pitchX, this.pitchTopY - 60, 'bowler').setDepth(40);

    // Bat: handle anchored at the batter's hand (origin near base of sprite).
    this.bat = this.add
      .image(this.batter.x + BAT_HOLD_OFFSET, this.batter.y, 'bat')
      .setOrigin(0.5, 1)
      .setDepth(45);
    this.bat.setRotation(BAT_BACKLIFT_RAD);

    this.ball = this.add.image(this.pitchX, this.pitchTopY, 'ball').setVisible(false).setDepth(50);

    this.bounceMarker = this.add.graphics().setDepth(20).setVisible(false);
    this.timingRing = this.add.graphics().setDepth(40).setVisible(false);

    this.drawFielders();

    // HUD (fixed to camera)
    this.hudTop = this.add
      .text(this.viewW / 2, 30, '', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#ffffff',
        align: 'center',
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(2000);

    this.hudBottom = this.add
      .text(this.viewW / 2, 70, '', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#ffd84d',
        align: 'center',
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(2000);

    this.feedbackText = this.add
      .text(this.viewW / 2, this.viewH / 2 - 80, '', {
        fontFamily: 'monospace',
        fontSize: '36px',
        color: '#ffffff',
        align: 'center',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(2100);

    this.runIndicator = this.add
      .text(this.viewW - 30, 110, '', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#44ddaa',
        align: 'right',
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(2000);

    // End-of-over modal (hidden by default)
    this.overModal = this.makeOverModal();

    this.controller = new InputController();
    this.detachKeyboard = attachKeyboard(this, this.controller);
    this.detachTouch = attachTouch(this, this.controller);

    this.controller.on((event) => this.onInput(event));

    this.resetRunState();
    this.updateHud();
    this.events.emit('runArmed', false);
    this.scheduleNextBall(BETWEEN_BALLS_MS);
  }

  override update(time: number) {
    if (this.phase === 'preBounce') {
      const t = (time - this.ballReleaseTime) / this.delivery.preBounceMs;
      const clamped = Math.min(1, Math.max(0, t));
      const x = this.delivery.releasePx.x + clamped * (this.delivery.bouncePx.x - this.delivery.releasePx.x);
      const y = this.delivery.releasePx.y + clamped * (this.delivery.bouncePx.y - this.delivery.releasePx.y);
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

    if (this.phase === 'ballInPlay') {
      // Keep the bat anchored to the striker while they run between creases.
      this.bat.setPosition(this.batter.x + BAT_HOLD_OFFSET, this.batter.y);
      this.updateRunLeg(time);
      if (time >= this.ballInPlayDeadline) {
        this.finalizeBallInPlay(false);
      }
      return;
    }
  }

  shutdown() {
    this.detachKeyboard?.();
    this.detachTouch?.();
  }

  private resetRunState() {
    this.run = {
      legActive: false,
      legProgress: 0,
      legStartTime: 0,
      legDirection: 'up',
      legsCompleted: 0,
      legsAttempted: 0,
      pendingLeg: false,
      ballFielded: false,
      ballAtStumpsTime: Number.POSITIVE_INFINITY,
    };
  }

  private onInput(event: 'swing' | 'block' | 'nudge' | 'run' | 'stay' | 'nextOver') {
    if (event === 'nextOver') {
      if (this.phase === 'overModal') this.dismissOverModal();
      return;
    }

    if (event === 'run') {
      if (this.phase === 'ballInPlay' && this.canTakeAnotherRun()) {
        this.requestRun();
      }
      return;
    }

    if (event === 'stay') return; // STAY is implicit now: don't press RUN.

    const isLeach = this.state.onStrike === 'leach';
    if (this.phase !== 'postBounce') return;

    if (isLeach) {
      if (event === 'block' || event === 'nudge') {
        const result = resolveLeachAction(BOWLERS[this.state.bowler], event, this.rng);
        this.beginShotAnimation(result, event === 'nudge');
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
    this.animateBatSwing(result.zone);
    this.beginShotAnimation(result, true);
  }

  private resolveNoSwing() {
    if (this.phase !== 'postBounce') return;
    const isLeach = this.state.onStrike === 'leach';
    if (isLeach) {
      const result = resolveLeachAction(BOWLERS[this.state.bowler], 'block', this.rng);
      this.beginShotAnimation(result, false);
      return;
    }
    const result = resolveShot(
      BOWLERS[this.state.bowler],
      { timingDeltaMs: 0, zone: null, lofted: false, noSwing: true },
      this.rng,
    );
    this.beginShotAnimation(result, false);
  }

  /**
   * Animate the bat through a swing arc in the chosen direction. The bat
   * stays at backlift between deliveries, snaps through `zoneAngle` and
   * settles at follow-through. The ball-physics outcome is computed by
   * `resolveShot` separately; this is purely a visual reaction.
   */
  private animateBatSwing(zone: ShotZone | null) {
    const dir = zone ? ZONE_DIR[zone] : { x: 0, y: -1 };
    const len = Math.hypot(dir.x, dir.y) || 1;
    const ux = dir.x / len;
    const uy = dir.y / len;
    const zoneAngle = Math.atan2(ux, -uy); // bat sprite points up at rotation 0
    const followAngle = zoneAngle + BAT_FOLLOW_THROUGH_OFFSET;

    this.tweens.killTweensOf(this.bat);
    this.bat.setRotation(zoneAngle - 1.4); // brief backswing
    this.tweens.add({
      targets: this.bat,
      rotation: followAngle,
      duration: 200,
      ease: 'Quart.easeOut',
      onComplete: () => {
        this.tweens.add({
          targets: this.bat,
          rotation: BAT_BACKLIFT_RAD,
          duration: 380,
          ease: 'Sine.easeInOut',
          delay: 200,
        });
      },
    });
  }

  /**
   * Triggered the moment the bat connects (or fails to). Tweens the ball to
   * its target on the field, dispatches the nearest fielder, and opens the
   * "ball-in-play" run loop. STOKES & LEACH stay where they are until the
   * player taps RUN.
   */
  private beginShotAnimation(result: ShotResult, contact: boolean) {
    this.phase = 'ballInPlay';
    this.timingRing.setVisible(false);
    this.bounceMarker.setVisible(false);
    this.pendingResult = result;
    this.resetRunState();
    // Default to "no auto-finalize" — branches below set this when needed.
    this.ballInPlayDeadline = Number.POSITIVE_INFINITY;

    const target = this.shotTargetPoint(result);
    const distance = Math.hypot(target.x - this.batter.x, target.y - this.batter.y);
    // Slow shots down a bit so the player has time to read & decide on a run.
    const animMs = Math.min(2200, 700 + distance * 1.4);

    this.tweens.killTweensOf(this.ball);
    if (!contact && (result.isWicket && result.dismissal === 'bowled')) {
      // Bowled: ball continues to the stumps behind the batter.
      this.tweens.add({
        targets: this.ball,
        x: this.pitchX,
        y: this.pitchBottomY + 8,
        scale: 1,
        duration: 240,
        ease: 'Sine.easeIn',
        onComplete: () => this.finalizeBallInPlay(true),
      });
      return;
    }

    this.tweens.add({
      targets: this.ball,
      x: target.x,
      y: target.y,
      scale: 1,
      duration: animMs,
      ease: 'Sine.easeOut',
      onComplete: () => this.onBallReachedTarget(),
    });

    // Pan the camera halfway toward where the ball is going so the runners
    // (still on the pitch) stay visible alongside the fielders / boundary.
    // Zoom out slightly to widen the view of the field.
    const camTargetX = (this.batter.x + target.x) / 2;
    const camTargetY = (this.batter.y + target.y) / 2;
    this.tweens.add({
      targets: this.cameras.main,
      scrollX: camTargetX - this.viewW / 2,
      scrollY: camTargetY - this.viewH / 2,
      zoom: 0.82,
      duration: Math.min(900, animMs * 0.7),
      ease: 'Sine.easeOut',
    });

    // Pick & dispatch fielder
    let fielderArrivalMs = animMs;
    if (!result.isBoundary && !(result.isWicket && result.dismissal === 'bowled')) {
      const fielderIdx = this.nearestFielder(target);
      const home = this.fielderHomes[fielderIdx]!;
      this.cachedFielderDistance = Math.hypot(home.x - target.x, home.y - target.y);
      fielderArrivalMs = this.dispatchFielder(fielderIdx, target, animMs, result);
    } else {
      this.cachedFielderDistance = 9999;
    }

    // Set timing for run-out: when the ball is "back at the stumps".
    this.run.ballAtStumpsTime = this.time.now + fielderArrivalMs + FIELDER_RETURN_MS;
    this.ballInPlayDeadline = this.time.now + fielderArrivalMs + FIELDER_RETURN_MS + 400;

    // Boundaries auto-resolve, no manual running.
    if (result.isBoundary) {
      this.events.emit('runArmed', false);
      this.runIndicator.setText('');
      this.time.delayedCall(animMs + 200, () => this.finalizeBallInPlay(true));
      return;
    }

    // Wicket (caught/bowled/lbw): no running.
    if (result.isWicket) {
      this.events.emit('runArmed', false);
      this.runIndicator.setText('');
      this.time.delayedCall(animMs + 200, () => this.finalizeBallInPlay(true));
      return;
    }

    // Otherwise — open the run loop.
    this.events.emit('runArmed', true);
    this.runIndicator
      .setText(`RUNS: 0   Tap RUN to take one`)
      .setColor('#44ddaa');
  }

  private onBallReachedTarget() {
    this.run.ballFielded = true;
    // Don't drop the run armed flag immediately — the player can still steal a
    // single while the throw comes in. The deadline handles the cutoff.
  }

  private canTakeAnotherRun(): boolean {
    if (!this.pendingResult) return false;
    if (this.pendingResult.isBoundary || this.pendingResult.isWicket) return false;
    // Allow tapping during a leg to queue another, OR while idle at the crease.
    return true;
  }

  private requestRun() {
    if (this.run.legActive) {
      this.run.pendingLeg = true;
      return;
    }
    this.startLeg();
  }

  private startLeg() {
    this.run.legActive = true;
    this.run.pendingLeg = false;
    this.run.legProgress = 0;
    this.run.legStartTime = this.time.now;
    this.run.legsAttempted += 1;

    // Direction alternates on each leg.
    const fromBottom = this.run.legsCompleted % 2 === 0;
    this.run.legDirection = fromBottom ? 'up' : 'down';

    const strikerStartY = fromBottom ? this.pitchBottomY - 10 : this.pitchTopY + 10;
    const strikerEndY = fromBottom ? this.pitchTopY + 10 : this.pitchBottomY - 10;
    const nonStrikerStartY = fromBottom ? this.pitchTopY + 10 : this.pitchBottomY - 10;
    const nonStrikerEndY = fromBottom ? this.pitchBottomY - 10 : this.pitchTopY + 10;

    // The two batters cross. Use slight x offsets so they pass without
    // overlapping.
    const strikerLaneX = this.pitchX - 22;
    const nonStrikerLaneX = this.pitchX + 22;

    this.batter.setPosition(strikerLaneX, strikerStartY);
    this.nonStriker.setPosition(nonStrikerLaneX, nonStrikerStartY);

    this.tweens.killTweensOf(this.batter);
    this.tweens.killTweensOf(this.nonStriker);

    this.tweens.add({
      targets: this.batter,
      y: strikerEndY,
      duration: LEG_RUN_MS,
      ease: 'Sine.easeInOut',
    });
    this.tweens.add({
      targets: this.nonStriker,
      y: nonStrikerEndY,
      duration: LEG_RUN_MS,
      ease: 'Sine.easeInOut',
      onComplete: () => this.onLegComplete(),
    });

    this.runIndicator.setText(`RUNS: ${this.run.legsCompleted}…  RUNNING`);
  }

  private onLegComplete() {
    this.run.legsCompleted += 1;
    this.run.legActive = false;
    this.run.legProgress = 1;

    const remaining = Math.max(0, this.run.ballAtStumpsTime - this.time.now);
    this.runIndicator.setText(
      `RUNS: ${this.run.legsCompleted}   Tap RUN again or wait (${(remaining / 1000).toFixed(1)}s)`,
    );

    if (this.run.pendingLeg && this.canTakeAnotherRun()) {
      this.startLeg();
    }
  }

  private updateRunLeg(time: number) {
    if (!this.run.legActive) return;
    const t = (time - this.run.legStartTime) / LEG_RUN_MS;
    this.run.legProgress = Math.min(1, Math.max(0, t));
    const remaining = Math.max(0, this.run.ballAtStumpsTime - time);
    this.runIndicator.setText(
      `RUNS: ${this.run.legsCompleted}…  RUNNING  (${(remaining / 1000).toFixed(1)}s)`,
    );
  }

  /**
   * End the current ball-in-play window. Compute final runs / run-outs based
   * on legs completed vs. legs attempted vs. intended runs.
   *
   * `force` is set when we end early because the ball was a wicket/boundary
   * (no running needed) — in that case we trust the upstream `pendingResult`.
   */
  private finalizeBallInPlay(force: boolean) {
    if (this.phase !== 'ballInPlay') return;
    const baseResult = this.pendingResult;
    if (!baseResult) {
      this.phase = 'resolved';
      return;
    }

    this.events.emit('runArmed', false);
    this.tweens.killTweensOf(this.cameras.main);
    this.tweens.add({
      targets: this.cameras.main,
      scrollX: this.cameraDefaultX - this.viewW / 2,
      scrollY: this.cameraDefaultY - this.viewH / 2,
      zoom: 1,
      duration: 500,
      ease: 'Sine.easeInOut',
    });

    let finalResult = baseResult;

    if (force || baseResult.isBoundary || baseResult.isWicket) {
      // Already determined upstream — keep the result as-is.
    } else {
      const intended = baseResult.intendedRuns ?? 0;
      const attempted = this.run.legsAttempted;
      let completed = this.run.legsCompleted;
      const midLeg = this.run.legActive;
      const progress = this.run.legProgress;
      let runOut = false;

      // Cancel any in-flight running tweens — we're resolving now.
      this.tweens.killTweensOf(this.batter);
      this.tweens.killTweensOf(this.nonStriker);

      if (midLeg) {
        // Diving for the line: more than 70% across counts as completed.
        if (progress >= 0.7) {
          completed += 1;
        } else {
          runOut = true;
        }
      }

      // Greedy bonus risk: every leg beyond `intended` adds ~20% extra
      // chance of run-out, modelling the fielder's improved throw window.
      if (!runOut && completed > intended) {
        const extraRisk = Math.min(0.55, (completed - intended) * 0.22);
        if (this.rng() < extraRisk) {
          runOut = true;
          completed = Math.max(0, completed - 1);
        }
      }

      if (runOut) {
        finalResult = {
          ...baseResult,
          runs: completed,
          isWicket: true,
          dismissal: 'runOut',
        };
      } else {
        finalResult = {
          ...baseResult,
          runs: attempted === 0 ? 0 : completed,
        };
      }
    }

    this.applyResult(finalResult);
  }

  private applyResult(result: ShotResult) {
    this.phase = 'resolved';
    this.pendingResult = null;
    this.runIndicator.setText('');
    this.events.emit('runArmed', false);
    this.ball.setVisible(false);
    this.showFeedback(result);

    const prev = this.state;
    this.state = applyBall(prev, result);

    // Track over snapshot
    this.overSnapshot.runsThisOver += result.runs;
    if (result.isWicket) this.overSnapshot.wicketsThisOver += 1;
    this.overSnapshot.balls.push(this.ballLabel(result));

    this.updateHud();
    this.snapBattersToCreases();
    this.events.emit('leachMode', this.state.onStrike === 'leach');

    const matchOutcome = getOutcome(this.state);
    if (matchOutcome !== 'inProgress') {
      this.time.delayedCall(900, () => {
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
      this.showOverModal();
      return;
    }
    this.scheduleNextBall(BETWEEN_BALLS_MS);
  }

  private ballLabel(r: ShotResult): string {
    if (r.isWicket) return 'W';
    if (r.isSix) return '6';
    if (r.isBoundary) return '4';
    return `${r.runs}`;
  }

  private snapBattersToCreases() {
    if (this.state.onStrike === 'stokes') {
      this.batter
        .setTexture('batter')
        .setPosition(this.pitchX - 22, this.pitchBottomY - 10);
      this.nonStriker
        .setTexture('leach')
        .setPosition(this.pitchX + 22, this.pitchTopY + 10);
    } else {
      this.batter
        .setTexture('leach')
        .setPosition(this.pitchX - 22, this.pitchBottomY - 10);
      this.nonStriker
        .setTexture('batter')
        .setPosition(this.pitchX + 22, this.pitchTopY + 10);
    }
    // Bat back at the new striker's hand
    this.bat
      .setPosition(this.batter.x + BAT_HOLD_OFFSET, this.batter.y)
      .setRotation(BAT_BACKLIFT_RAD);
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

    const plan = planDelivery(
      bowler,
      { pitchTopY: this.pitchTopY, pitchBottomY: this.pitchBottomY, pitchX: this.pitchX },
      this.rng,
    );
    // Pacing: stretch travel times so the player has time to read the bounce.
    this.delivery = {
      ...plan,
      preBounceMs: Math.round(plan.preBounceMs * BALL_TRAVEL_MULTIPLIER),
      postBounceMs: Math.round(plan.postBounceMs * BALL_TRAVEL_MULTIPLIER),
    };

    this.bowlerSprite.setTint(bowler.tintColor);

    // Show predicted bounce marker during run-up — and keep it visible while
    // the ball is in flight so the player can read length.
    this.drawBounceMarker(bowler.tintColor, bowler.style === 'spin');
    this.bounceMarker.setAlpha(0).setVisible(true);
    this.tweens.add({
      targets: this.bounceMarker,
      alpha: 1,
      duration: this.delivery.runUpMs * 0.7,
    });

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

    // Bounce flash on the marker (kept visible the whole post-bounce phase).
    this.tweens.killTweensOf(this.bounceMarker);
    this.bounceMarker.setAlpha(1);
    this.tweens.add({
      targets: this.bounceMarker,
      alpha: 0.4,
      duration: 250,
    });
  }

  private drawBounceMarker(color: number, spin: boolean) {
    const g = this.bounceMarker;
    g.clear();
    const { x, y } = this.delivery.bouncePx;
    g.lineStyle(3, color, 0.9);
    g.strokeCircle(x, y, 14);
    g.lineStyle(2, color, 0.5);
    g.strokeCircle(x, y, 22);
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
      const dist = result.isSix ? BOUNDARY_RADIUS_PX + 80 : BOUNDARY_RADIUS_PX;
      return { x: bx + ux * dist, y: by + uy * dist };
    }

    if (result.isWicket && result.dismissal === 'caught') {
      const probe = { x: bx + ux * BOUNDARY_RADIUS_PX * 0.7, y: by + uy * BOUNDARY_RADIUS_PX * 0.7 };
      const idx = this.nearestFielder(probe);
      const home = this.fielderHomes[idx]!;
      return { x: home.x, y: home.y };
    }

    const intended = result.intendedRuns ?? result.runs ?? 0;
    const fracByRuns: Record<number, number> = { 0: 0.18, 1: 0.42, 2: 0.62, 3: 0.8 };
    const frac = fracByRuns[intended] ?? 0.3;
    return {
      x: bx + ux * BOUNDARY_RADIUS_PX * frac,
      y: by + uy * BOUNDARY_RADIUS_PX * frac,
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
  ): number {
    if (result.isBoundary) return animMs;

    const sprite = this.fielderSprites[idx];
    const home = this.fielderHomes[idx];
    if (!sprite || !home) return animMs;

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
          duration: FIELDER_RETURN_MS,
          delay: 200,
          ease: 'Sine.easeIn',
          onComplete: () => sprite.clearTint(),
        });
      },
    });
    sprite.setTint(0xffeeaa);
    return animMs;
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
      delay: 500,
    });
  }

  private makeOverModal(): Phaser.GameObjects.Container {
    const W = this.viewW;
    const H = this.viewH;
    const overlay = this.add.rectangle(0, 0, W * 2, H * 2, 0x000000, 0.7);
    const panel = this.add
      .rectangle(0, 0, W * 0.85, H * 0.45, 0x103a18, 0.95)
      .setStrokeStyle(3, 0xffffff);
    const title = this.add
      .text(0, -H * 0.18, '', {
        fontFamily: 'monospace',
        fontSize: '30px',
        color: '#ffffff',
        align: 'center',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    const summary = this.add
      .text(0, -H * 0.06, '', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#ffd84d',
        align: 'center',
        lineSpacing: 6,
      })
      .setOrigin(0.5);
    const nextBowler = this.add
      .text(0, H * 0.06, '', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#ffffff',
        align: 'center',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    const c = this.add.container(W / 2, H / 2, [overlay, panel, title, summary, nextBowler]);
    c.setScrollFactor(0).setDepth(3000).setVisible(false);
    (c as Phaser.GameObjects.Container & {
      _title: Phaser.GameObjects.Text;
      _summary: Phaser.GameObjects.Text;
      _nextBowler: Phaser.GameObjects.Text;
      _panel: Phaser.GameObjects.Rectangle;
    })._title = title;
    (c as Phaser.GameObjects.Container & {
      _title: Phaser.GameObjects.Text;
      _summary: Phaser.GameObjects.Text;
      _nextBowler: Phaser.GameObjects.Text;
      _panel: Phaser.GameObjects.Rectangle;
    })._summary = summary;
    (c as Phaser.GameObjects.Container & {
      _title: Phaser.GameObjects.Text;
      _summary: Phaser.GameObjects.Text;
      _nextBowler: Phaser.GameObjects.Text;
      _panel: Phaser.GameObjects.Rectangle;
    })._nextBowler = nextBowler;
    (c as Phaser.GameObjects.Container & {
      _title: Phaser.GameObjects.Text;
      _summary: Phaser.GameObjects.Text;
      _nextBowler: Phaser.GameObjects.Text;
      _panel: Phaser.GameObjects.Rectangle;
    })._panel = panel;
    return c;
  }

  private showOverModal() {
    this.phase = 'overModal';
    const overNum = this.state.ballsBowled / 6;
    const next = BOWLERS[this.state.bowler];
    const balls = this.overSnapshot.balls.join(' · ');
    const need = runsNeeded(this.state);

    const banner = this.overModal as Phaser.GameObjects.Container & {
      _title: Phaser.GameObjects.Text;
      _summary: Phaser.GameObjects.Text;
      _nextBowler: Phaser.GameObjects.Text;
      _panel: Phaser.GameObjects.Rectangle;
    };
    banner._title.setText(`END OF OVER ${overNum}`);
    banner._summary.setText(
      `${this.overSnapshot.runsThisOver} runs, ${this.overSnapshot.wicketsThisOver}w\n` +
        `[ ${balls || '–'} ]\n` +
        `NEED ${need} from ${this.state.ballsRemaining} balls`,
    );
    banner._nextBowler
      .setText(`NEXT: ${next.name.toUpperCase()} (${next.style})`)
      .setColor(`#${next.tintColor.toString(16).padStart(6, '0')}`);
    banner._panel.setStrokeStyle(3, next.tintColor);
    banner.setVisible(true).setAlpha(0).setScale(0.92);
    this.tweens.add({
      targets: banner,
      alpha: 1,
      scale: 1,
      duration: 240,
      ease: 'Back.easeOut',
    });
    this.events.emit('nextOverModal', true);
  }

  private dismissOverModal() {
    if (this.phase !== 'overModal') return;
    const banner = this.overModal;
    this.tweens.add({
      targets: banner,
      alpha: 0,
      duration: 200,
      onComplete: () => {
        banner.setVisible(false);
        this.events.emit('nextOverModal', false);
        // Reset over snapshot for the next over.
        this.overSnapshot = {
          overNum: this.overSnapshot.overNum + 1,
          runsThisOver: 0,
          wicketsThisOver: 0,
          balls: [],
        };
        this.scheduleNextBall(BETWEEN_BALLS_AFTER_OVER_MS);
      },
    });
  }

  private drawOval() {
    const g = this.add.graphics();
    g.setDepth(0);
    const cx = this.pitchX;
    const cy = (this.pitchTopY + this.pitchBottomY) / 2;
    g.fillStyle(0x2e8b2e, 1);
    g.fillCircle(cx, cy, BOUNDARY_RADIUS_PX);
    g.lineStyle(5, 0xffffff, 0.55);
    g.strokeCircle(cx, cy, BOUNDARY_RADIUS_PX);
    // 30-yard ring
    g.lineStyle(2, 0xffffff, 0.25);
    g.strokeCircle(cx, cy, BOUNDARY_RADIUS_PX * 0.55);
  }

  private drawFielders() {
    const cx = this.pitchX;
    const cy = (this.pitchTopY + this.pitchBottomY) / 2;
    // Place 9 outfielders on a ring around the wicket so they cover all
    // shot zones; distance is just inside the boundary.
    const ringR = BOUNDARY_RADIUS_PX * 0.72;
    const innerR = BOUNDARY_RADIUS_PX * 0.32;
    const angles = [
      -Math.PI / 2,
      -Math.PI / 2 + (Math.PI / 4),
      -Math.PI / 2 + (Math.PI / 2),
      -Math.PI / 2 + (3 * Math.PI / 4),
      Math.PI / 2,
      Math.PI / 2 + (Math.PI / 4),
      Math.PI / 2 + (Math.PI / 2),
      Math.PI / 2 + (3 * Math.PI / 4),
      0,
    ];
    for (const a of angles) {
      const r = Math.abs(Math.cos(a)) > 0.95 || Math.abs(Math.sin(a)) > 0.95 ? ringR : innerR + (ringR - innerR) * 0.6;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      const sprite = this.add.image(x, y, 'fielder').setDepth(30);
      this.fielderSprites.push(sprite);
      this.fielderHomes.push({ x, y });
    }
  }
}
