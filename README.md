# Swoop
A 2–4 player push-your-luck board game.

- Supports Monkeys, Seagulls, Crabs, and Turtles (2–4 seats).
- Every player gains up to 1 swoop token on Bank (capped at 2).

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
  - Body: `{ name, preferredSeat: 0-3 }`
  - Join room (assigns side 0 or 1 if available; else spectator). Returns `{ playerId, token, seat, version, state, room }`.

- GET `/api/rooms/:code/state?since=:version`
  - Fetch current state. If `since` equals current version, returns `{ unchanged: true, version }`.

- POST `/api/rooms/:code/state`
  - Body: `{ playerId, token, baseVersion, state }`
  - Optimistic concurrency: updates state iff `baseVersion === current version`.
  - Turn enforcement: only the seated player whose turn it is may update. Spectators cannot update.
  - Player names are derived from seat assignments; icons are preserved server‑side.
  - Returns `{ ok: true, version }`, or `409 { error: 'version_conflict'|'not_your_turn', version, state }`.

WebSocket

- Connect to `ws(s):///api/rooms/:code/socket` to receive realtime `{ type:'sync', code, version }` messages on state changes.
  - Local/dev server supports WebSockets.
  - On Vercel Node Functions, native WebSockets are not supported; the client automatically polls every ~2s.

Notes:
- The server is the source of truth for the game snapshot, but rule enforcement is intentionally minimal for now.
- Version is bumped for state updates and for seat/name changes when players join.
- Realtime uses WebSockets locally; on Vercel, the client falls back to polling.
- Storage: by default the server keeps room state in memory; when available it persists to a store (see below).

### Frontend helper (optional)

`src/net/multiplayer.js` provides tiny helpers:

- `createRoom()`
- `joinRoom(code, { name, preferredSeat })`
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
- The 🔄 New button now prompts for the desired player count (2–4) before starting fresh.
- While connected, the client auto-syncs via SSE and pushes state changes with optimistic concurrency.

Dev tip: run both servers

- Terminal 1: `PORT=4000 npm run server`
- Terminal 2: `npm run dev`

Notes:
- During dev, Vite proxies `'/api'` to `http://localhost:4000` automatically.
- The client also auto-detects `http://localhost:4000` when running on `localhost:5173`.
- You can still override with `VITE_SW_BACKEND_URL` if you prefer.

### Deploying Frontend on GitHub Pages

GitHub Pages is static hosting; it cannot run the Node backend. You can still deploy the React app there, and point it at a backend deployed elsewhere (Render/Railway/Fly/Cloudflare/Vercel, etc.).

- Backend: deploy `server/index.js` to your host of choice (e.g. `https://swoop.yourdomain.com`). Set `CORS_ORIGIN` to your Pages URL (e.g. `https://<user>.github.io`).
- Frontend build: the deploy workflow accepts a secret `SWOOP_BACKEND_URL` and injects it as `VITE_SW_BACKEND_URL` at build time. Set the repository secret to your backend URL.
- Runtime override (no rebuild): the app also reads `window.SW_BACKEND_URL`. You can set it by visiting your Pages link with a `?backend=` query once, for example:
  - `https://<user>.github.io/Swoop/?backend=https://swoop.yourdomain.com`
  The value is stored in `localStorage` and used on subsequent visits.

### Deploying on Vercel (frontend + API)

Vercel can host the static frontend and the API as serverless functions in one project.

- Frontend: built with Vite to `dist` (Vercel auto-detects). Base path is `/` by default.
- API: a single function at `api/[...path].js` wraps the Express app via `serverless-http`, serving all `/api/*` endpoints.

Steps:

1) Push this repo to a new Vercel project. No special settings needed; Vercel will run `npm install` and `npm run build` and publish `dist`.
2) Environment vars (optional):
   - `CORS_ORIGIN` (only needed if you serve the API cross-origin; same-origin on Vercel does not need CORS).
   - `VITE_BASE_PATH` (default `/`).
3) Limitations on Vercel serverless (for now):
   - API state is in-memory per serverless instance. It may reset on cold starts and is not shared across concurrent instances. For reliability, migrate to SQLite or a managed store.
   - SSE is not guaranteed on Node serverless; the client automatically falls back to polling if SSE is unavailable.

### Persistent storage (Vercel KV / local file / memory)

The backend now supports pluggable storage via environment detection:

- Vercel KV (Upstash Redis) — set both env vars:
  - `KV_REST_API_URL`
  - `KV_REST_API_TOKEN`
  When present, rooms are stored under keys `swoop:room:<code>` and an index set `swoop:rooms`.

- Local file (for `npm run server`) — optional:
  - Set `STORAGE_FILE=server-data/rooms.json` (default used in development). The server will create/update the JSON file.

- Memory (fallback) — no env vars required.

You can override the key prefix with `STORE_PREFIX`.


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
- Opponent threat modeling and smarter swoop usage.
- Basket scarcity awareness and prioritization of safe returns.
- Heuristics for when to Swoop vs Move under odd-lane slope.
- Managing active-piece cap (max 2) strategically across lanes.
- Endgame targeting when one point away from victory.

## AAA Board Skin (visuals‑only)

An optional AAA‑style skin is available for the main board (no rule changes; presentation only). It adds:

- Fullscreen river background and dam/beach flourishes
- Re‑skinned tiles (safe, checkpoint, danger/whirlpool)
- Token‑style monkey/seagull pieces and basket icon
- Subtle connectors between tiles that can be swooped across
- Compact overlay HUD; multiplayer bar hidden by default

Enable it by appending `?skin=aaa` to the URL, e.g.:

```
http://localhost:5173/?skin=aaa
```

The choice is stored in `localStorage` under `SWOOP_SKIN`; remove it or load without the query to revert.

Asset note: The skin references images in `RnD/` for now. For production, copy/optimize them into `public/assets/aaa/` and adjust URLs if needed.



## Geometric Board Layout (dev notes)

The board is modeled at two layers:
- Geometry spaces: fixed 11 slots (1..11) per lane with possible gaps; used for visual alignment and cross‑lane Swoop space‑matching.
- Movement steps: only real tiles (Normal/Checkpoint/Deterrent/Start/Final) — pieces can only stand here.

A per‑lane TILE_MAP defines the tile type at each geometric space. Helpers map between step↔space and test tile existence. Regular token Swoops match the current piece’s geometric space on the adjacent lane (stepForSpace). When a push (from Move or Swoop) would land a piece on a Gap, it snaps down (toward home) to the nearest lower movement step (or is removed if none). If a pushed piece is carrying, its basket transfers to the pusher.

See implementations in:
- Pass & Play HTML: `main.html` (TILE_MAP, tile helpers, push chain)
- React: `src/App.jsx` (TILE_MAP, space‑matching Swoops, push chain)
- Simulator: `src/sim/simulate.js` (same logic for headless runs)
