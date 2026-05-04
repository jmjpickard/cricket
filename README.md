# Stokes at Headingley

A 2D arcade cricket game where you are Ben Stokes coming in at **286/9**
needing **73 to win** the third Ashes Test at Headingley, 2019. Top-down
Pac-Man-style oval, Stick-Cricket-style direction + timing batting,
mobile-first, deployed to Cloudflare.

- **Engine:** Phaser 3 + TypeScript (Vite)
- **Hosting:** Cloudflare Pages (game) + Cloudflare Worker + Workers KV (leaderboard)
- **CI/CD:** GitHub Actions → Wrangler

## Running locally

```bash
npm install
npm run dev          # game on http://localhost:5173
npm run worker:dev   # API on http://localhost:8787 (proxied via Vite)
```

Open the dev server on a phone over LAN with `npm run dev -- --host`.

## Tests / typecheck / build

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

## Controls

**Touch (primary):**
- D-pad (bottom-left): pick a shot zone (8-way).
- LOFT (top-right small): hold for a lofted shot — sixes when timed perfectly,
  but more risk of being caught.
- SWING (bottom-right large): tap when the ball arrives.
- When Leach is on strike: **BLOCK** / **NUDGE** replace SWING.

**Keyboard (free fallback):**
- Arrows: shot direction
- SPACE: swing
- L (hold): loft modifier
- B / N: block / nudge (when Leach is on strike)

## Match scenario

- Target **359**. Start at **286/9**, last pair, 16 overs (96 balls) remaining.
- Stokes is on strike. Bowler rotates Hazlewood → Pattinson → Lyon → Cummins
  as the chase deepens.
- Win = reach 359. Lose = lose your wicket or run out of balls.

## Deploying

The deploy workflow runs on every push to `main`:

1. Worker (`worker/`) → `wrangler deploy`
2. Static game (`dist/`) → `wrangler pages deploy`

You need the following GitHub repo secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

You also need to create:

- A Cloudflare Pages project named `stokes-headingley`.
- A KV namespace; copy its `id` and `preview_id` into `worker/wrangler.toml`.

PR previews run via `.github/workflows/preview.yml` and produce a
preview URL on Cloudflare Pages, scoped to the PR's branch name.

## Project layout

```
src/                Phaser game (TS)
  scenes/           Boot, Menu, Match, GameOver
  game/             Pure logic: matchState, batting, bowling, rng, types
  input/            Abstract InputController + Touch / Keyboard adapters
  net/              Leaderboard HTTP client
worker/             Cloudflare Worker source + wrangler.toml
tests/              Vitest unit tests for pure logic + Worker validation
.github/workflows/  CI, deploy, preview
```

## Notes on IP / assets

Sprites are procedurally generated coloured circles — there are no real
player likenesses, kits, audio samples, or branded logos. "Stokes",
"Leach", and the Australian bowlers' names are factual references to the
2019 Headingley Test only. Replace the placeholder textures in
`src/scenes/BootScene.ts` with real (rights-cleared) art when ready.
