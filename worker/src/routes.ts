import type { Env } from './index';
import {
  validateScore,
  buildScoreKey,
  parseScoreKey,
  type ScoreEntry,
  type ScoreSubmission,
} from './score';

const NONCE_TTL = 60 * 10; // 10 minutes
const RATE_LIMIT_WINDOW = 30; // 30 seconds between submissions per IP

export async function handleLeaderboardRoute(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  if (request.method === 'GET' && url.pathname === '/api/nonce') {
    return handleNonce(env);
  }
  if (request.method === 'GET' && url.pathname === '/api/leaderboard') {
    return handleLeaderboard(env, url);
  }
  if (request.method === 'POST' && url.pathname === '/api/score') {
    return handleSubmitScore(request, env);
  }
  return json({ error: 'not found' }, 404);
}

async function handleNonce(env: Env): Promise<Response> {
  const nonce = crypto.randomUUID();
  await env.LEADERBOARD.put(`nonce:${nonce}`, '1', { expirationTtl: NONCE_TTL });
  return json({ nonce });
}

async function handleLeaderboard(env: Env, url: URL): Promise<Response> {
  const top = Math.min(50, Math.max(1, Number(url.searchParams.get('top') ?? '10')));
  const list = await env.LEADERBOARD.list({ prefix: 'score:', limit: top });
  const entries: ScoreEntry[] = [];
  for (const key of list.keys) {
    const v = await env.LEADERBOARD.get(key.name);
    if (!v) continue;
    try {
      entries.push(JSON.parse(v) as ScoreEntry);
    } catch {
      // skip corrupt
    }
  }
  entries.sort((a, b) => b.ballsToSpare - a.ballsToSpare || b.runsScored - a.runsScored);
  return json(entries.slice(0, top));
}

async function handleSubmitScore(request: Request, env: Env): Promise<Response> {
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const rateKey = `rate:${ip}`;
  const recent = await env.LEADERBOARD.get(rateKey);
  if (recent) return json({ error: 'rate limited' }, 429);

  let body: ScoreSubmission;
  try {
    body = (await request.json()) as ScoreSubmission;
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  const maxRuns = Number(env.MAX_RUNS);
  const maxBalls = Number(env.MAX_BALLS);
  const validation = validateScore(body, { maxRuns, maxBalls });
  if (!validation.ok) return json({ error: validation.error }, 400);

  const nonceKey = `nonce:${body.nonce}`;
  const nonceExists = await env.LEADERBOARD.get(nonceKey);
  if (!nonceExists) return json({ error: 'invalid or expired nonce' }, 403);

  await env.LEADERBOARD.delete(nonceKey);
  await env.LEADERBOARD.put(rateKey, '1', { expirationTtl: RATE_LIMIT_WINDOW });

  const entry: ScoreEntry = {
    name: validation.value.name,
    ballsToSpare: validation.value.ballsToSpare,
    runsScored: validation.value.runsScored,
    ts: Date.now(),
  };
  const key = buildScoreKey(entry);
  await env.LEADERBOARD.put(key, JSON.stringify(entry));

  // Trim to top 100 to keep KV usage bounded
  await trimLeaderboard(env, 100);

  return json({ ok: true, entry });
}

async function trimLeaderboard(env: Env, keep: number) {
  const list = await env.LEADERBOARD.list({ prefix: 'score:', limit: 1000 });
  const parsed = list.keys
    .map((k) => parseScoreKey(k.name))
    .filter((p): p is { ballsToSpare: number; key: string } => p !== null);
  parsed.sort((a, b) => b.ballsToSpare - a.ballsToSpare);
  const toDelete = parsed.slice(keep);
  for (const p of toDelete) {
    await env.LEADERBOARD.delete(p.key);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
