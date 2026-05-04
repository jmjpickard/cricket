import { handleLeaderboardRoute } from './routes';

export interface Env {
  LEADERBOARD: KVNamespace;
  MAX_RUNS: string;
  MAX_BALLS: string;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      return new Response('not found', { status: 404, headers: CORS });
    }
    try {
      const res = await handleLeaderboardRoute(request, env, url);
      const headers = new Headers(res.headers);
      for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
      return new Response(res.body, { status: res.status, headers });
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), {
        status: 500,
        headers: { 'content-type': 'application/json', ...CORS },
      });
    }
  },
};
