export type BatterId = 'stokes' | 'leach';

export type BowlerId = 'hazlewood' | 'cummins' | 'lyon' | 'pattinson';

export type ShotZone =
  | 'straight'
  | 'cover'
  | 'point'
  | 'square'
  | 'fineLeg'
  | 'midwicket'
  | 'midOn'
  | 'thirdMan';

export type Timing = 'perfect' | 'good' | 'okay' | 'early' | 'late' | 'none';

export type ShotResult = {
  timing: Timing;
  runs: number;
  isBoundary: boolean;
  isSix: boolean;
  isWicket: boolean;
  dismissal?: 'bowled' | 'caught' | 'lbw' | 'runOut';
  zone: ShotZone | null;
  /** what the ShotResult would award if the player chooses to run (0–3). Not set for boundaries/wickets. */
  intendedRuns?: number;
};

export type Bowler = {
  id: BowlerId;
  name: string;
  /** ms between release and arrival at the batter */
  travelMs: number;
  /** width of the perfect timing window in ms */
  perfectWindowMs: number;
  /** chance the ball is on the stumps if missed (0..1) */
  stumpsChance: number;
  /** style affects which shots are highest-percentage */
  style: 'pace' | 'spin';
  /** ms for the bowler run-up animation */
  runUpMs: number;
  /** length band: fraction of pitch (0 = at bowler, 1 = at batter). Bounce point. */
  lengthFrac: { min: number; max: number };
  /** ± horizontal pixels of line variation at bounce */
  lineOffsetPxRange: number;
  /** sideways pixels the ball drifts after pitching (spin/seam tell) */
  postBounceLateralPx: number;
  /** cosmetic arc height in pixels at bounce */
  bouncePx: number;
  /** sprite tint colour */
  tintColor: number;
};

export type MatchState = {
  target: number;
  score: number;
  wicketsLost: number;
  ballsBowled: number;
  ballsRemaining: number;
  onStrike: BatterId;
  bowler: BowlerId;
  partnership: number;
  stokesRuns: number;
  leachRuns: number;
};
