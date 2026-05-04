export type LeaderboardEntry = {
  name: string;
  ballsToSpare: number;
  runsScored: number;
  ts: number;
};

export type ScoreSubmission = {
  name: string;
  ballsToSpare: number;
  runsScored: number;
  nonce: string;
};

const API_BASE = '/api';

export async function fetchNonce(): Promise<string> {
  const res = await fetch(`${API_BASE}/nonce`);
  if (!res.ok) throw new Error(`nonce: ${res.status}`);
  const data = (await res.json()) as { nonce: string };
  return data.nonce;
}

export async function fetchLeaderboard(top = 10): Promise<LeaderboardEntry[]> {
  const res = await fetch(`${API_BASE}/leaderboard?top=${top}`);
  if (!res.ok) return [];
  return (await res.json()) as LeaderboardEntry[];
}

export async function submitScore(payload: ScoreSubmission): Promise<boolean> {
  const res = await fetch(`${API_BASE}/score`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.ok;
}
