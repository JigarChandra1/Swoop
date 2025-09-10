const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

// In-memory store. In future, swap for SQLite/local storage.
// rooms: code -> { code, createdAt, lastActivity, version, state, players: Map, sseClients: Set }
const rooms = new Map();

const app = express();
const PORT = process.env.PORT || 4000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: '1mb' }));

// Normalize Vercel function path (it often strips the /api prefix before invoking our handler)
app.use((req, _res, next) => {
  try {
    if (req.url && req.url.startsWith('/rooms')) {
      req.url = '/api' + req.url;
    }
  } catch (_) {}
  next();
});

// --- Helpers ---
function genId(bytes = 12) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function genRoomCode() {
  // 6 digit numeric code, avoid leading zero by range 100000-999999
  let code;
  do {
    code = String(Math.floor(100000 + Math.random() * 900000));
  } while (rooms.has(code));
  return code;
}

// Static board layout (mirrors src/App.jsx LANES for baskets)
const LANES = [
  { sum: 2, L: 3, basket: true },
  { sum: 3, L: 4, basket: false },
  { sum: 4, L: 5, basket: true },
  { sum: 5, L: 6, basket: false },
  { sum: 6, L: 7, basket: true },
  { sum: 7, L: 8, basket: false },
  { sum: 8, L: 7, basket: true },
  { sum: 9, L: 6, basket: false },
  { sum: 10, L: 5, basket: true },
  { sum: 11, L: 4, basket: false },
  { sum: 12, L: 3, basket: true },
];

function initialGame() {
  return {
    players: [
      { name: 'Player L', pieceIcon: '🐒', activeIcon: '🐵', score: 0, swoopTokens: 0, pieces: [] },
      { name: 'Player R', pieceIcon: '🕊️', activeIcon: '🦅', score: 0, swoopTokens: 1, pieces: [] },
    ],
    current: 0,
    rolled: null,
    selectedPair: null,
    pendingAdvances: null,
    rollMovesDone: 0,
    mode: 'preroll',
    baskets: LANES.map((l) => l.basket),
    message: 'Player L, roll the dice!',
    transferSource: null,
    transferTargets: null,
    pieceChoices: null,
    selectedSum: null,
    previousMode: null,
  };
}

function createRoom() {
  const code = genRoomCode();
  const room = {
    code,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    version: 1,
    state: initialGame(),
    players: new Map(), // playerId -> { id, name, token, side: 0|1|null, joinedAt }
    sseClients: new Set(),
  };
  rooms.set(code, room);
  return room;
}

function getPublicRoom(room) {
  // Do not expose tokens
  const players = Array.from(room.players.values()).map((p) => ({ id: p.id, name: p.name, side: p.side, joinedAt: p.joinedAt }));
  return { code: room.code, version: room.version, createdAt: room.createdAt, lastActivity: room.lastActivity, players };
}

function bumpVersion(room) {
  room.version += 1;
  room.lastActivity = Date.now();
  // Broadcast to SSE listeners
  const payload = `event: sync\ndata: ${JSON.stringify({ code: room.code, version: room.version })}\n\n`;
  for (const res of room.sseClients) {
    try { res.write(payload); } catch (_) {}
  }
}

// --- Routes ---
app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'swoop-backend', rooms: rooms.size });
});

// Create a new room
app.post('/api/rooms', (req, res) => {
  const room = createRoom();
  res.status(201).json({ code: room.code, version: room.version, state: room.state, room: getPublicRoom(room) });
});

// Join a room with a name and optional preferred side (0|1)
app.post('/api/rooms/:code/join', (req, res) => {
  const { code } = req.params;
  const room = rooms.get(code);
  if (!room) return res.status(404).json({ error: 'room_not_found' });
  const { name, preferredSide } = req.body || {};
  const id = genId(10);
  const token = genId(18);

  let side = null; // spectator by default if sides taken
  const takenSides = new Set(Array.from(room.players.values()).map((p) => p.side).filter((s) => s === 0 || s === 1));
  if (!takenSides.has(0) || !takenSides.has(1)) {
    // at least one seat is free
    if ((preferredSide === 0 || preferredSide === 1) && !takenSides.has(preferredSide)) {
      side = preferredSide;
    } else {
      side = takenSides.has(0) ? 1 : 0;
    }
  }

  const player = { id, name: name || `Player-${id.slice(0, 4)}`, token, side, joinedAt: Date.now() };
  room.players.set(id, player);

  // If seated, update visible name in state
  if (side === 0 || side === 1) {
    room.state.players[side].name = player.name;
    bumpVersion(room);
  }

  res.status(201).json({ playerId: id, token, side, room: getPublicRoom(room), version: room.version, state: room.state });
});

// Get current room state (optionally delta check)
app.get('/api/rooms/:code/state', (req, res) => {
  const { code } = req.params;
  const { since } = req.query;
  const room = rooms.get(code);
  if (!room) return res.status(404).json({ error: 'room_not_found' });
  const sinceNum = since ? Number(since) : null;
  if (sinceNum && sinceNum === room.version) {
    return res.status(200).json({ unchanged: true, version: room.version });
  }
  res.json({ code: room.code, version: room.version, state: room.state, room: getPublicRoom(room) });
});

// Push a new full snapshot state (optimistic concurrency via baseVersion)
app.post('/api/rooms/:code/state', (req, res) => {
  const { code } = req.params;
  const { playerId, token, baseVersion, state } = req.body || {};
  const room = rooms.get(code);
  if (!room) return res.status(404).json({ error: 'room_not_found' });

  if (!playerId || !token) return res.status(400).json({ error: 'auth_required' });
  const player = room.players.get(playerId);
  if (!player || player.token !== token) return res.status(403).json({ error: 'forbidden' });

  if (typeof baseVersion !== 'number' || baseVersion !== room.version) {
    return res.status(409).json({ error: 'version_conflict', version: room.version, state: room.state });
  }

  // Enforce: only a seated player can update, and only the acting side for the current server state.
  if (!(player.side === 0 || player.side === 1)) {
    return res.status(403).json({ error: 'spectator_cannot_update' });
  }

  // Determine the acting side based on the server's current state (pre-update)
  const mode = room.state?.mode;
  const actingSide = (mode === 'tailwind' || mode === 'tailwindTopStepChoice' || mode === 'tailwindChooseSwoop')
    ? (1 - (room.state?.current ?? 0))
    : (room.state?.current ?? 0);

  if (player.side !== actingSide) {
    return res.status(409).json({ error: 'not_your_turn', version: room.version, state: room.state });
  }

  // Sanitize: lock player identities for seated sides and keep icons
  try {
    const next = { ...state };
    if (Array.isArray(next.players) && next.players.length >= 2 && Array.isArray(room.state?.players)) {
      const prev = room.state.players;
      const seat0 = Array.from(room.players.values()).find(p => p.side === 0);
      const seat1 = Array.from(room.players.values()).find(p => p.side === 1);
      next.players = [
        {
          ...next.players[0],
          name: seat0?.name || next.players[0]?.name || prev[0]?.name,
          pieceIcon: prev[0]?.pieceIcon,
          activeIcon: prev[0]?.activeIcon,
        },
        {
          ...next.players[1],
          name: seat1?.name || next.players[1]?.name || prev[1]?.name,
          pieceIcon: prev[1]?.pieceIcon,
          activeIcon: prev[1]?.activeIcon,
        },
      ];
    }
    room.state = next;
  } catch (_) {
    room.state = state; // fallback — but names/icons likely preserved
  }
  bumpVersion(room);
  res.json({ ok: true, version: room.version });
});

// Server-Sent Events stream for room updates
app.get('/api/rooms/:code/stream', (req, res) => {
  const { code } = req.params;
  const room = rooms.get(code);
  if (!room) return res.status(404).json({ error: 'room_not_found' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  // send initial ping with current version
  res.write(`event: sync\ndata: ${JSON.stringify({ code: room.code, version: room.version })}\n\n`);

  room.sseClients.add(res);
  req.on('close', () => {
    room.sseClients.delete(res);
  });
});

// Lightweight health + debug
app.get('/api/rooms', (_req, res) => {
  res.json({ count: rooms.size, rooms: Array.from(rooms.values()).map(getPublicRoom) });
});

// Cleanup: prune rooms idle for > 24h
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [code, room] of rooms) {
    if (room.lastActivity < cutoff) rooms.delete(code);
  }
}, 60 * 60 * 1000);

if (require.main === module) {
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[swoop-backend] listening on http://localhost:${PORT}`);
  });
}

module.exports = { app };
