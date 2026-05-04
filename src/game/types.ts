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
