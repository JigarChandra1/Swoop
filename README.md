# Swoop
A 2 player push-your-luck board game.

## Multiplayer Backend (In‑Memory)

A simple Node.js backend is included to allow multiple players to join the same game via a numeric room code. The server keeps state in memory for now, with an easy path to swap to SQLite/local storage later.

### Run the backend

- Install deps (once): `npm install`
- Start server: `npm run server`
- Default port: `4000` (override with `PORT=5000 npm run server`)

Allow CORS by origin with `CORS_ORIGIN`, otherwise `*`.

### API summary

- POST `/api/rooms`
  - Create a new room. Returns `{ code, version, state, room }`.

- POST `/api/rooms/:code/join`
  - Body: `{ name, preferredSide: 0|1 }`
  - Join room (assigns side 0 or 1 if available; else spectator). Returns `{ playerId, token, side, version, state, room }`.

- GET `/api/rooms/:code/state?since=:version`
  - Fetch current state. If `since` equals current version, returns `{ unchanged: true, version }`.

- POST `/api/rooms/:code/state`
  - Body: `{ playerId, token, baseVersion, state }`
  - Optimistic concurrency: updates state iff `baseVersion === current version`.
  - Turn enforcement: only the seated player whose turn it is may update; during `tailwind*` modes, the opponent may update. Spectators cannot update.
  - Player names are derived from seat assignments; icons are preserved server‑side.
  - Returns `{ ok: true, version }`, or `409 { error: 'version_conflict'|'not_your_turn', version, state }`.

- GET `/api/rooms/:code/stream`
  - Server‑Sent Events stream that emits `sync` events with `{ code, version }` when state changes.

Notes:
- The server is the source of truth for the game snapshot, but rule enforcement is intentionally minimal for now.
- Version is bumped for state updates and for seat/name changes when players join.

### Frontend helper (optional)

`src/net/multiplayer.js` provides tiny helpers:

- `createRoom()`
- `joinRoom(code, { name, preferredSide })`
- `getState(code, since)`
- `pushState(code, { playerId, token, baseVersion, state })`
- `subscribe(code, onSync)` — SSE; call returned function to unsubscribe

You can set the backend base URL via `VITE_SW_BACKEND_URL` (e.g. `http://localhost:4000`).

### Suggested integration

- Add a simple UI to create/join a room (enter code + name).
- When joined, load snapshot: `const { version, state } = await getState(code)` then hydrate `setState(state)`.
- Subscribe to updates: `unsubscribe = subscribe(code, ({ version }) => getState(code, version).then(...) )`.
- On local state changes that represent a completed move/turn, call `pushState(code, { playerId, token, baseVersion: version, state })` and update your tracked `version` on success.

### Using the built-in UI

- A small Multiplayer bar appears at the top of the app.
- Enter your name and either:
  - Join an existing room by entering its 6-digit code, or
  - Click Create to make a new room and auto-join.
- While connected, the client auto-syncs via SSE and pushes state changes with optimistic concurrency.

Dev tip: run both servers

- Terminal 1: `PORT=4000 npm run server`
- Terminal 2: `npm run dev`

Notes:
- During dev, Vite proxies `'/api'` to `http://localhost:4000` automatically.
- The client also auto-detects `http://localhost:4000` when running on `localhost:5173`.
- You can still override with `VITE_SW_BACKEND_URL` if you prefer.

## React Implementation

The game logic is implemented in React and bundled with [Vite](https://vitejs.dev/).
Tailwind CSS is processed via PostCSS for a production-ready build.

## Development

Install dependencies (requires Node.js):

```
npm install
```

Start a development server:

```
npm run dev
```

Run the placeholder test script:

```
npm test
```

## Simulation Mode

A headless simulator runs two non-reactive bots against each other for a configurable number of games (rounds). It reports ~10 key metrics.

Run with defaults (100 rounds to target score 5):

```
npm run simulate
```

Configure rounds, target score, and an optional seed:

```
npm run simulate -- --rounds=1000 --target=5 --seed=42
```

Bot strategies:
- Bot 1: Prefers highest odd sums (11 > 9 > 7 > 5 > 3), then highest overall; banks when it delivered in the turn or after ~3 actions.
- Bot 2: Mixed; tends to favor even/high sums for baskets about half the time, otherwise highest sums; banks if delivered, after ~4 actions, or occasionally at random.

Notes and future considerations for bots (non-reactive for now):
- Adaptive banking by risk of bust and deterrent exposure.
- Lane congestion and blocker awareness in pair selection.
- Opponent threat modeling and tailwind optimization (both sides).
- Basket scarcity awareness and prioritization of safe returns.
- Heuristics for when to Swoop vs Move under odd-lane slope.
- Managing active-piece cap (max 2) strategically across lanes.
- Endgame targeting when one point away from victory.



## Geometric Board Layout (dev notes)

The board is modeled at two layers:
- Geometry spaces: fixed 11 slots (1..11) per lane with possible gaps; used for visual alignment and cross‑lane Swoop space‑matching.
- Movement steps: only real tiles (Normal/Checkpoint/Deterrent/Start/Final) — pieces can only stand here.

A per‑lane TILE_MAP defines the tile type at each geometric space. Helpers map between step↔space and test tile existence. Regular token Swoops match the current piece’s geometric space on the adjacent lane (stepForSpace). When a push (from Move or Swoop) would land a piece on a Gap, it snaps down (toward home) to the nearest lower movement step (or is removed if none). If a pushed piece is carrying, its basket transfers to the pusher.

See implementations in:
- Pass & Play HTML: `main.html` (TILE_MAP, tile helpers, push chain)
- React: `src/App.jsx` (TILE_MAP, space‑matching Swoops, push chain)
- Simulator: `src/sim/simulate.js` (same logic for headless runs)
