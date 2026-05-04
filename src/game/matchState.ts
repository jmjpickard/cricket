import type { MatchState, ShotResult } from './types';
import { selectBowler } from './bowling';

export const TARGET = 359;
export const STARTING_SCORE = 286;
export const STARTING_WICKETS = 9;
export const TOTAL_BALLS = 96; // 16 overs

export function createInitialState(): MatchState {
  return {
    target: TARGET,
    score: STARTING_SCORE,
    wicketsLost: STARTING_WICKETS,
    ballsBowled: 0,
    ballsRemaining: TOTAL_BALLS,
    onStrike: 'stokes',
    bowler: selectBowler(TOTAL_BALLS, TOTAL_BALLS),
    partnership: 0,
    stokesRuns: 0,
    leachRuns: 0,
  };
}

export type MatchOutcome = 'won' | 'lost' | 'inProgress';

export function getOutcome(state: MatchState): MatchOutcome {
  if (state.score >= state.target) return 'won';
  if (state.wicketsLost >= 10) return 'lost';
  if (state.ballsRemaining <= 0) return 'lost';
  return 'inProgress';
}

/**
 * Apply a shot result to the match state. Pure: returns a new state.
 * - Updates scores per batter and partnership
 * - Rotates strike on odd runs
 * - Rotates strike at end of over (every 6 balls)
 * - Rotates bowler when difficulty band changes
 */
export function applyBall(state: MatchState, result: ShotResult): MatchState {
  const next: MatchState = { ...state };
  next.ballsBowled = state.ballsBowled + 1;
  next.ballsRemaining = Math.max(0, state.ballsRemaining - 1);

  if (result.isWicket) {
    next.wicketsLost = state.wicketsLost + 1;
    next.partnership = 0;
    return next;
  }

  next.score = state.score + result.runs;
  next.partnership = state.partnership + result.runs;
  if (state.onStrike === 'stokes') {
    next.stokesRuns = state.stokesRuns + result.runs;
  } else {
    next.leachRuns = state.leachRuns + result.runs;
  }

  // Rotate strike on odd runs (sixes don't rotate; fours don't either)
  if (result.runs % 2 === 1 && !result.isBoundary) {
    next.onStrike = state.onStrike === 'stokes' ? 'leach' : 'stokes';
  }

  // End of over: rotate strike
  if (next.ballsBowled % 6 === 0) {
    next.onStrike = next.onStrike === 'stokes' ? 'leach' : 'stokes';
    next.bowler = selectBowler(next.ballsRemaining, TOTAL_BALLS);
  }

  return next;
}

export function runsNeeded(state: MatchState): number {
  return Math.max(0, state.target - state.score);
}
