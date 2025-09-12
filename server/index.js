const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { createStore } = require('./storage');
let WebSocketServer;
try { WebSocketServer = require('ws').Server; } catch (_) { WebSocketServer = null; }
const socketsByRoom = new Map(); // code -> Set<WebSocket>

// Runtime cache with optional persistence (KV/file/memory)
// roomsCache: code -> { code, createdAt, lastActivity, version, state, players: Map, sseClients: Set }
const roomsCache = new Map();
const store = createStore();
const STORE_PREFIX = process.env.STORE_PREFIX || 'swoop';
const roomKey = (code) => `${STORE_PREFIX}:room:${code}`;
const indexKey = () => `${STORE_PREFIX}:rooms`;

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
  code = String(Math.floor(100000 + Math.random() * 900000));
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

async function saveRoomPersistent(room){
  const payload = {
    code: room.code,
    createdAt: room.createdAt,
    lastActivity: room.lastActivity,
    version: room.version,
    state: room.state,
    players: Array.from(room.players.values()),
  };
  try { await store.set(roomKey(room.code), payload); } catch(_) {}
  try { await store.sadd(indexKey(), room.code); } catch(_) {}
}

async function loadRoomPersistent(code){
  let raw = null;
  try { raw = await store.get(roomKey(code)); } catch(_) {}
  if (!raw) return null;
  let data = raw;
  if (typeof raw === 'string') {
    try { data = JSON.parse(raw); } catch(_) { return null; }
  }
  const room = {
    code: data.code,
    createdAt: data.createdAt,
    lastActivity: data.lastActivity,
    version: data.version,
    state: data.state,
    players: new Map(),
    sseClients: new Set(),
  };
  (data.players || []).forEach(p => room.players.set(p.id, p));
  roomsCache.set(code, room);
  return room;
}

async function getRoom(code){
  if (roomsCache.has(code)) return roomsCache.get(code);
  return await loadRoomPersistent(code);
}

async function createRoom(){
  let code;
  for (let i=0;i<5;i++){
    code = genRoomCode();
    const exists = await store.get(roomKey(code)).catch(() => null);
    if (!exists) break; else code = null;
  }
  if (!code) code = genRoomCode();
  const room = {
    code,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    version: 1,
    state: initialGame(),
    players: new Map(), // playerId -> { id, name, token, side }
    sseClients: new Set(),
  };
  roomsCache.set(code, room);
  await saveRoomPersistent(room);
  return room;
}

function getPublicRoom(room) {
  // Do not expose tokens
  const players = Array.from(room.players.values()).map((p) => ({ id: p.id, name: p.name, side: p.side, joinedAt: p.joinedAt }));
  return { code: room.code, version: room.version, createdAt: room.createdAt, lastActivity: room.lastActivity, players };
}

async function bumpVersion(room) {
  room.version += 1;
  room.lastActivity = Date.now();
  await saveRoomPersistent(room);
  // Broadcast to SSE listeners
  const payload = `event: sync\ndata: ${JSON.stringify({ code: room.code, version: room.version })}\n\n`;
  for (const res of room.sseClients) {
    try { res.write(payload); } catch (_) {}
  }
  // Broadcast to WebSocket listeners
  try {
    const set = socketsByRoom.get(room.code);
    if (set) {
      const msg = JSON.stringify({ type: 'sync', code: room.code, version: room.version });
      for (const ws of set) {
        try { if (ws.readyState === 1 /* OPEN */) ws.send(msg); } catch(_){}
      }
    }
  } catch(_){}
}

// --- Routes ---
app.get('/', async (_req, res) => {
  let count = 0; try { count = (await store.smembers(indexKey())).length; } catch(_) { count = roomsCache.size; }
  res.json({ ok: true, service: 'swoop-backend', rooms: count, storage: store.kind });
});

// Create a new room
app.post('/api/rooms', async (req, res) => {
  const room = await createRoom();
  res.status(201).json({ code: room.code, version: room.version, state: room.state, room: getPublicRoom(room) });
});

// Join a room with a name and optional preferred side (0|1)
app.post('/api/rooms/:code/join', async (req, res) => {
  const { code } = req.params;
  const room = await getRoom(code);
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
    await bumpVersion(room);
  }
  await saveRoomPersistent(room);
  res.status(201).json({ playerId: id, token, side, room: getPublicRoom(room), version: room.version, state: room.state });
});

// Get current room state (optionally delta check)
app.get('/api/rooms/:code/state', async (req, res) => {
  const { code } = req.params;
  const { since } = req.query;
  const room = await getRoom(code);
  if (!room) return res.status(404).json({ error: 'room_not_found' });
  const sinceNum = since ? Number(since) : null;
  if (sinceNum && sinceNum === room.version) {
    return res.status(200).json({ unchanged: true, version: room.version });
  }
  res.json({ code: room.code, version: room.version, state: room.state, room: getPublicRoom(room) });
});

// Push a new full snapshot state (optimistic concurrency via baseVersion)
app.post('/api/rooms/:code/state', async (req, res) => {
  const { code } = req.params;
  const { playerId, token, baseVersion, state } = req.body || {};
  const room = await getRoom(code);
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
  await bumpVersion(room);
  res.json({ ok: true, version: room.version });
});

// Server-Sent Events stream for room updates
app.get('/api/rooms/:code/stream', async (req, res) => {
  const { code } = req.params;
  const room = await getRoom(code);
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
app.get('/api/rooms', async (_req, res) => {
  let codes = [];
  try { codes = await store.smembers(indexKey()); } catch(_) {}
  const list = [];
  for (const code of codes) {
    const r = await getRoom(code);
    if (r) list.push(getPublicRoom(r));
  }
  for (const [code, r] of roomsCache) {
    if (!codes.includes(code)) list.push(getPublicRoom(r));
  }
  res.json({ count: list.length, rooms: list });
});

// Cleanup: prune rooms idle for > 24h
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [code, room] of roomsCache) {
    if (room.lastActivity < cutoff) roomsCache.delete(code);
  }
}, 60 * 60 * 1000);

if (require.main === module) {
  const http = require('http');
  const server = http.createServer(app);

  // --- WebSocket upgrade (local/long-lived servers only) ---
  const socketsByRoom = new Map(); // code -> Set<WebSocket>
  if (WebSocketServer) {
    const wss = new WebSocketServer({ noServer: true });
    function attachSocket(ws, code) {
      let set = socketsByRoom.get(code);
      if (!set) { set = new Set(); socketsByRoom.set(code, set); }
      set.add(ws);
      ws.on('close', () => { set.delete(ws); if (set.size === 0) socketsByRoom.delete(code); });
      // Send initial version ping
      (async () => {
        const r = await getRoom(code).catch(()=>null);
        const version = r?.version || 1;
        try { ws.send(JSON.stringify({ type: 'sync', code, version })); } catch(_){}
      })();
    }
    server.on('upgrade', async (req, socket, head) => {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const m = url.pathname.match(/^\/api\/rooms\/([0-9]{6})\/socket$/);
        if (!m) return socket.destroy();
        const code = m[1];
        const room = await getRoom(code);
        if (!room) return socket.destroy();
        wss.handleUpgrade(req, socket, head, (ws) => attachSocket(ws, code));
      } catch (_) { try { socket.destroy(); } catch(_){} }
    });
  }

  server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[swoop-backend] listening on http://localhost:${PORT}`);
  });
}

module.exports = { app };
