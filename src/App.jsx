import React from 'react';
import { createRoom as mpCreateRoom, joinRoom as mpJoinRoom, getState as mpGetState, pushState as mpPushState, subscribe as mpSubscribe, saveCreds as mpSaveCreds, loadCreds as mpLoadCreds } from './net/multiplayer.js';
import { createBot as createBotByKey, createProBot, createPusherBot, makeRng } from './bots/proBot.js';
// Sound effects removed

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 4;

const PLAYER_PROFILES = [
  { key: 'monkeys', defaultName: 'Monkeys', badgeIcon: '🐒', pieceIcon: '🐒', activeIcon: '🐵' },
  { key: 'seagulls', defaultName: 'Seagulls', badgeIcon: '🕊️', pieceIcon: '🕊️', activeIcon: '🦅' },
  { key: 'crabs', defaultName: 'Crabs', badgeIcon: '🦀', pieceIcon: '🦀', activeIcon: '🦀' },
  { key: 'turtles', defaultName: 'Turtles', badgeIcon: '🐢', pieceIcon: '🐢', activeIcon: '🐢' }
];

const DEFAULT_BOT_TYPE = 'pro';
const BOT_TYPE_SEQUENCE = [DEFAULT_BOT_TYPE, 'pusher'];
const BOT_TYPE_LABEL = {
  pro: 'Pro',
  pusher: 'Pusher'
};

function normalizePlayerCount(count) {
  const n = Number(count);
  if (!Number.isFinite(n)) return MIN_PLAYERS;
  return Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, Math.round(n)));
}

function buildPlayers(playerCount, options = {}) {
  const count = normalizePlayerCount(playerCount);
  const profiles = PLAYER_PROFILES.slice(0, count);
  const { botSeats = [], botTypes = [] } = options;
  return profiles.map((profile, idx) => {
    const isBot = !!botSeats[idx];
    const botType = botTypes[idx] || (isBot ? DEFAULT_BOT_TYPE : null);
    return {
      id: idx,
      profile: profile.key,
      name: profile.defaultName,
      badgeIcon: profile.badgeIcon,
      pieceIcon: profile.pieceIcon,
      activeIcon: profile.activeIcon,
      score: 0,
      swoopTokens: idx === count - 1 ? 1 : 0,
      pieces: [],
      isBot,
      botType
    };
  });
}

function enforceTokenPolicy(players, _playerCount) {
  players.forEach((pl) => {
    const val = Number(pl.swoopTokens ?? 0);
    pl.swoopTokens = Math.max(0, Math.min(2, Number.isNaN(val) ? 0 : val));
  });
}

function nextSeatIndex(current, playerCount) {
  return (current + 1) % playerCount;
}

const LANES = [
  {sum:2, L:3, basket:true},
  {sum:3, L:4, basket:false},
  {sum:4, L:5, basket:true},
  {sum:5, L:6, basket:false},
  {sum:6, L:7, basket:true},
  {sum:7, L:8, basket:false},
  {sum:8, L:7, basket:true},
  {sum:9, L:6, basket:false},
  {sum:10, L:5, basket:true},
  {sum:11, L:4, basket:false},
  {sum:12, L:3, basket:true},
];

// Geometric Board Layout (documentation)
// Two layers:
// 1) Geometry "spaces" 1..11 per lane (may include gaps) used for alignment and space‑matching on Swoops.
// 2) Movement "steps" are only real tiles (Normal/Checkpoint/Deterrent/Start/Final). Pieces occupy steps.
//
// TILE_MAP encodes tile type per (lane r, space 1..11). Helpers:
//  - mapStepToGrid(r, step) → space (1..11) for a lane‑local movement step (1..L[r])
//  - tileTypeAt / tileExistsAt  → tile info at that mapped space
//  - stepForSpace(r, space) → best movement step for a given space (exact if possible; nearest valid otherwise)
// Swoops: regular token Swoops space‑match across adjacent lanes via stepForSpace.
// Push: if a pushed piece would land on a Gap, snap down to the nearest lower valid step; if none, remove.
const MAX_STEP = 11;
const TILE_MAP = [
  ['Start','Gap','Gap','Gap','Gap','Checkpoint','Gap','Gap','Gap','Gap','Final'],
  ['Start','Gap','Gap','Checkpoint','Gap','Gap','Gap','Checkpoint','Gap','Gap','Final'],
  ['Start','Gap','Gap','Checkpoint','Gap','Deterrent','Gap','Gap','Checkpoint','Gap','Final'],
  ['Start','Gap','Checkpoint','Gap','Deterrent','Gap','Checkpoint','Gap','Checkpoint','Gap','Final'],
  ['Start','Gap','Checkpoint','Deterrent','Gap','Checkpoint','Gap','Deterrent','Checkpoint','Gap','Final'],
  ['Start','Checkpoint','Gap','Deterrent','Checkpoint','Gap','Normal','Deterrent','Gap','Checkpoint','Final'],
  ['Start','Gap','Checkpoint','Deterrent','Gap','Checkpoint','Gap','Deterrent','Checkpoint','Gap','Final'],
  ['Start','Gap','Checkpoint','Gap','Deterrent','Gap','Checkpoint','Gap','Checkpoint','Gap','Final'],
  ['Start','Gap','Gap','Checkpoint','Gap','Deterrent','Gap','Gap','Checkpoint','Gap','Final'],
  ['Start','Gap','Gap','Checkpoint','Gap','Gap','Gap','Checkpoint','Gap','Gap','Final'],
  ['Start','Gap','Gap','Gap','Gap','Checkpoint','Gap','Gap','Gap','Gap','Final']
];
function mapStepToGrid(r, step){
  const L = LANES[r].L;
  if(L<=1) return 1;
  return 1 + Math.round((step-1)*(MAX_STEP-1)/(L-1));
}
function tileTypeAt(r, step){
  const gs = Math.max(1, Math.min(MAX_STEP, mapStepToGrid(r, step)));
  return TILE_MAP[r][gs-1] || 'Gap';
}
function tileExistsAt(r, step){ return tileTypeAt(r, step) !== 'Gap'; }

function stepForSpace(r, space) {
  // Find the best movement step for a given geometric space
  // First try to find an exact match
  const L = LANES[r].L;
  for (let step = 1; step <= L; step++) {
    if (mapStepToGrid(r, step) === space && tileExistsAt(r, step)) {
      return step;
    }
  }

  // If no exact match, find the nearest valid step
  let bestStep = null;
  let minDistance = Infinity;

  for (let step = 1; step <= L; step++) {
    if (tileExistsAt(r, step)) {
      const stepSpace = mapStepToGrid(r, step);
      const distance = Math.abs(stepSpace - space);
      if (distance < minDistance) {
        minDistance = distance;
        bestStep = step;
      }
    }
  }

  return bestStep;
}

function checkpoints(L){ const out=[2]; if(L>=6) out.push(4); out.push(L-1); out.push(L); return [...new Set(out)].filter(x=>x>=1&&x<=L); }
function deterrents(L,sum){ if(L<=3) return []; const det=[3,L-2]; if((sum===6||sum===8)&&L>=5) det.push(5); const cps=checkpoints(L); return [...new Set(det)].filter(x=>x>=1&&x<=L && !cps.includes(x)); }
const oddSlope={3:+1,5:-1,7:-1,9:-1,11:+1};

// Grid layout constants matching the original
const ROWS = LANES.length;
const COLS = 27;
const CENTER_COL = 13;
const LEFT_START_COL = 1;
const RIGHT_END_COL = COLS - 2;
const LEFT_SPAN = CENTER_COL - LEFT_START_COL - 1;
const RIGHT_SPAN = RIGHT_END_COL - CENTER_COL - 1;

function colForStep(side, step, L) {
  // Final step (step L) is always at the center column for both sides
  if (step === L) {
    return CENTER_COL;
  }

  if (side === 'L') {
    const rel = Math.round((LEFT_SPAN - 1) * (step - 1) / (L - 1));
    return LEFT_START_COL + rel;
  }
  const rel = Math.round((RIGHT_SPAN - 1) * (step - 1) / (L - 1));
  return RIGHT_END_COL - rel;
}

function initialGame(playerCount = MIN_PLAYERS, options = {}){
  const count = normalizePlayerCount(playerCount);
  const players = buildPlayers(count, options);
  enforceTokenPolicy(players, count);
  return {
    playerCount: count,
    players,
    current: 0,
    rolled: null,
    selectedPair: null,
    pendingAdvances: null,
    rollMovesDone: 0,
    mode: 'preroll',
    baskets: LANES.map(l=>l.basket),
    message: `${players[0].name}, roll the dice!`,
    transferSource: null,
    transferTargets: null,
    pieceChoices: null,
    selectedSum: null,
    previousMode: null,
    basketReturnLanes: null,
    basketsToReturn: 0,
    // Persisted event log (new): newest first
    events: []
  };
}

function r6(){ return 1+Math.floor(Math.random()*6); }

export default function App(){
  const [game,setGame] = React.useState(() => initialGame(MIN_PLAYERS));
  const [toast, setToast] = React.useState(null);
  const [showLoadModal, setShowLoadModal] = React.useState(false);
  const [loadText, setLoadText] = React.useState('');
  const [showCover, setShowCover] = React.useState(true);
  const [showNewGameModal, setShowNewGameModal] = React.useState(false);
  const [pendingPlayerCount, setPendingPlayerCount] = React.useState(game.playerCount);
  const [pendingBotSeats, setPendingBotSeats] = React.useState(() => {
    const seats = Array(MAX_PLAYERS).fill(false);
    game.players.forEach((p, idx) => { if (idx < seats.length) seats[idx] = !!p.isBot; });
    return seats;
  });
  const [pendingBotTypes, setPendingBotTypes] = React.useState(() => {
    const types = Array(MAX_PLAYERS).fill(null);
    game.players.forEach((p, idx) => {
      if (idx < types.length) types[idx] = p.botType || (p.isBot ? DEFAULT_BOT_TYPE : null);
    });
    return types;
  });
  // AAA skin support: grid + tile refs for connector overlay
  const gridRef = React.useRef(null);
  const tileRefs = React.useRef({});
  // Events are now stored in game state for persistence and MP sync
  const events = game?.events || [];
  const [isMobile, setIsMobile] = React.useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 768px)').matches;
  });
  const [logVisible, setLogVisible] = React.useState(() => {
    if (typeof window === 'undefined') return true;
    return !window.matchMedia('(max-width: 768px)').matches;
  });
  // Event log pagination (show 5 at a time)
  const [eventPage, setEventPage] = React.useState(0); // 0 = newest 0-4

  const MAX_EVENT_ROWS = 5;
  const MAX_EVENT_HISTORY = 20;

  function snapshotBotPreferences(players) {
    const seats = Array(MAX_PLAYERS).fill(false);
    const types = Array(MAX_PLAYERS).fill(null);
    players.forEach((p, idx) => {
      if (idx >= MAX_PLAYERS) return;
      seats[idx] = !!p.isBot;
      types[idx] = p.botType || (p.isBot ? DEFAULT_BOT_TYPE : null);
    });
    return { seats, types };
  }

  function formatCell(r, step) {
    const lane = LANES[r];
    if (!lane) return `r${r + 1}-s${step}`;
    return `${lane.sum} / ${step}`;
  }

  function findPieceOwner(gameState, piece) {
    for (let i = 0; i < gameState.players.length; i++) {
      if (gameState.players[i].pieces.includes(piece)) {
        return { player: gameState.players[i], seat: i, name: gameState.players[i].name };
      }
    }
    return null;
  }

  function recordEvent(message, playerName = null, targetGame = null) {
    const ts = new Date();
    const sourceGame = targetGame || game;
    let playerStats = '';

    if (playerName && sourceGame && Array.isArray(sourceGame.players)) {
      const player = sourceGame.players.find(p => p.name === playerName);
      if (player) {
        playerStats = `${player.swoopTokens || 0}🪙`;
      }
    }

    const entry = {
      id: `${ts.getTime()}-${Math.random().toString(16).slice(2)}`,
      message,
      playerStats
    };

    const injectEntry = (state) => {
      const prevEvents = Array.isArray(state?.events) ? state.events : [];
      return [entry, ...prevEvents].slice(0, MAX_EVENT_HISTORY);
    };

    if (targetGame) {
      targetGame.events = injectEntry(targetGame);
      return entry;
    }

    setGame(prev => ({ ...prev, events: injectEntry(prev) }));
    return entry;
  }

  // When the events list changes (newest first), reset to the newest page
  React.useEffect(() => {
    setEventPage(0);
  }, [events.length]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 768px)');
    const handleChange = () => setIsMobile(mq.matches);
    handleChange();
    mq.addEventListener('change', handleChange);
    return () => mq.removeEventListener('change', handleChange);
  }, []);

  // Multiplayer state
  const [mp, setMp] = React.useState({ connected:false, code:'', version:null, playerId:null, token:null, seat:null, joining:false, error:null });
  const [mpName, setMpName] = React.useState('');
  const [mpCodeInput, setMpCodeInput] = React.useState('');
  const [mpPreferredSeat, setMpPreferredSeat] = React.useState('');
  const [isOnline, setIsOnline] = React.useState(() => {
    if (typeof navigator === 'undefined') return true;
    return navigator.onLine ?? true;
  });
  const isOnlineRef = React.useRef(isOnline);
  const mpApplyingRef = React.useRef(false); // avoid push on remote apply
  const mpUnsubRef = React.useRef(null);
  const mpPushTimerRef = React.useRef(null);
  const mpVersionRef = React.useRef(null);
  const mpLastSnapshotRef = React.useRef(null); // last snapshot we synced with server (string)
  const mpPendingRemoteRef = React.useRef(null); // { state, version }
  const gameModeRef = React.useRef('preroll');
  React.useEffect(() => { gameModeRef.current = game.mode; }, [game.mode]);
  React.useEffect(() => { setPendingPlayerCount(game.playerCount); }, [game.playerCount]);
  React.useEffect(() => {
    const { seats, types } = snapshotBotPreferences(game.players);
    setPendingBotSeats(seats);
    setPendingBotTypes(types);
  }, [game.players]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  React.useEffect(() => {
    isOnlineRef.current = isOnline;
  }, [isOnline]);

  React.useEffect(() => {
    if (isOnline) {
      setMp(prev => {
        if (prev.error === 'Offline mode — multiplayer disabled') {
          return { ...prev, error: null };
        }
        return prev;
      });
    } else {
      showToast('Offline mode — multiplayer disabled');
    }
  }, [isOnline]);

  const botAgentsRef = React.useRef({});
  const botPlanRef = React.useRef(null);
  const botProcessingRef = React.useRef(false);
  const botLastSeatRef = React.useRef(game.current);
  const botLastRollRef = React.useRef(null);

  function seatLabel(seat) {
    if (!(seat >= 0 && seat < game.playerCount)) return 'Spectator';
    return game.players[seat]?.name || PLAYER_PROFILES[seat]?.defaultName || `Seat ${seat + 1}`;
  }

  // Audio initialization removed

  function mpCanAct() {
    if (!mp.connected) return true;
    if (!(mp.seat >= 0 && mp.seat < game.playerCount)) return false;
    return mp.seat === game.current;
  }

  // Undo history (stack of prior snapshots) and bookkeeping
  const historyRef = React.useRef([]); // array of snapshot objects from getState()
  const prevSnapshotRef = React.useRef(null); // JSON string of previous snapshot
  const isUndoingRef = React.useRef(false);

  // Auto Quick-Save + History capture: persist on any state change and push previous snapshot to history
  React.useEffect(() => {
    const currJson = JSON.stringify(getState());

    if (prevSnapshotRef.current === null) {
      // First render: set previous snapshot baseline
      prevSnapshotRef.current = currJson;
    } else {
      if (!isUndoingRef.current) {
        try {
          const prevObj = JSON.parse(prevSnapshotRef.current);
          historyRef.current.push(prevObj);
          if (historyRef.current.length > 100) historyRef.current.shift(); // cap history
        } catch (e) { /* ignore */ }
      } else {
        // Completed an undo action; clear flag
        isUndoingRef.current = false;
      }
      prevSnapshotRef.current = currJson;
    }

    try { localStorage.setItem('SWOOP_STATE_V61', currJson); } catch (e) {}
    // Multiplayer: debounce push of state when connected and not applying remote
    if (isOnline && mp.connected && mp.playerId && !mpApplyingRef.current) {
      // Always attempt to push; server enforces turn ownership based on its pre-update state.
      // Avoid pushing transient/choice UIs that aren't fully serializable
        const transientModes = new Set([
          'chooseMoveDest', 'choosePiece',
          'chooseSwoop', 'pickSwoopDest', 'chooseTopStepSwoop',
          'chooseTransferSource', 'chooseTransferTarget'
        ]);
      if (transientModes.has(game.mode)) {
        return; // wait for a stable state before syncing
      }
      // Skip if snapshot matches last synced
      if (mpLastSnapshotRef.current && mpLastSnapshotRef.current === currJson) {
        return;
      }
      if (mpPushTimerRef.current) clearTimeout(mpPushTimerRef.current);
      mpPushTimerRef.current = setTimeout(async () => {
        if (!isOnlineRef.current) return;
        try {
          const payload = { playerId: mp.playerId, token: mp.token, baseVersion: mp.version, state: JSON.parse(currJson) };
          const resp = await mpPushState(mp.code, payload);
          setMp(prev => ({ ...prev, version: resp.version }));
          // Mark snapshot as synced
          mpLastSnapshotRef.current = currJson;
        } catch (err) {
          if (err && err.status === 409) {
            // Version conflict: fetch latest and apply silently
            try {
              const fresh = await mpGetState(mp.code);
              if (!fresh.unchanged) {
                mpApplyingRef.current = true;
                setState(fresh.state, { silent: true });
                setMp(prev => ({ ...prev, version: fresh.version }));
                try { mpLastSnapshotRef.current = JSON.stringify(fresh.state); } catch(_){}
                mpApplyingRef.current = false;
              }
            } catch (_) {}
          } else if (err && (err.status === 403 || err.status === 404)) {
            setMp(prev => ({ ...prev, error: 'Disconnected from room', connected:false }));
            showToast('Disconnected from room.');
          }
        }
      }, 250);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, isOnline]);

  // Clean up push timer on unmount
  React.useEffect(() => () => { if (mpPushTimerRef.current) clearTimeout(mpPushTimerRef.current); }, []);

  // Subscribe to room version updates via SSE
  React.useEffect(() => {
    if (!mp.connected || !mp.code || !isOnline) return;
    if (mpUnsubRef.current) { try { mpUnsubRef.current(); } catch(_){} }
    const unsub = mpSubscribe(mp.code, async (data) => {
      if (!isOnlineRef.current) return;
      if (!data || typeof data.version !== 'number') return;
      // Fetch latest state if version moved forward
      try {
        const resp = await mpGetState(mp.code, mpVersionRef.current);
        if (!resp.unchanged) {
          // If we're in a transient UI, defer applying to avoid interrupting
      const transientModes = new Set([
        'chooseMoveDest', 'choosePiece',
        'chooseSwoop', 'pickSwoopDest', 'chooseTopStepSwoop',
        'chooseTransferSource', 'chooseTransferTarget'
      ]);
          if (transientModes.has(gameModeRef.current)) {
            mpPendingRemoteRef.current = { state: resp.state, version: resp.version };
          } else {
            mpApplyingRef.current = true;
            setState(resp.state, { silent: true });
            setMp(prev => ({ ...prev, version: resp.version }));
            try { mpLastSnapshotRef.current = JSON.stringify(resp.state); } catch(_){}
            mpApplyingRef.current = false;
          }
        }
      } catch(_){}
    });
    mpUnsubRef.current = unsub;
    return () => { try { unsub(); } catch(_){} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mp.connected, mp.code, isOnline]);

  // keep ref in sync with version
  React.useEffect(() => { mpVersionRef.current = mp.version; }, [mp.version]);

  // When leaving a transient mode, apply any deferred remote state
  React.useEffect(() => {
    const transientModes = new Set([
      'chooseMoveDest', 'choosePiece',
      'chooseSwoop', 'pickSwoopDest', 'chooseTopStepSwoop',
      'chooseTransferSource', 'chooseTransferTarget'
    ]);
    if (!transientModes.has(game.mode) && mpPendingRemoteRef.current) {
      const pending = mpPendingRemoteRef.current;
      mpPendingRemoteRef.current = null;
      mpApplyingRef.current = true;
      setState(pending.state, { silent: true });
      setMp(prev => ({ ...prev, version: pending.version }));
      try { mpLastSnapshotRef.current = JSON.stringify(pending.state); } catch(_){}
      mpApplyingRef.current = false;
    }
  }, [game.mode]);

  async function mpDoCreate() {
    if (!isOnline) {
      showToast('Multiplayer requires an internet connection.');
      setMp(prev => ({ ...prev, error: 'Offline mode — multiplayer disabled' }));
      return;
    }
    if (mp.joining) return;
    setMp(prev => ({ ...prev, joining: true, error:null }));
    try {
      const created = await mpCreateRoom();
      const code = created.code;
      // Immediately join the room
      const jr = await mpJoinRoom(code, { name: mpName || undefined, preferredSeat: 0 });
      mpSaveCreds(code, { playerId: jr.playerId, token: jr.token, name: jr.room?.players?.find(p=>p.id===jr.playerId)?.name, seat: jr.seat });
      mpApplyingRef.current = true;
      setState(jr.state, { silent: true });
      try { mpLastSnapshotRef.current = JSON.stringify(jr.state); } catch(_){}
      mpApplyingRef.current = false;
      setMp({ connected:true, code, version: jr.version, playerId: jr.playerId, token: jr.token, seat: jr.seat, joining:false, error:null });
      showToast(`Room ${code} ready!`);
    } catch (e) {
      console.error(e);
      setMp(prev => ({ ...prev, joining:false, error: 'Failed to create room' }));
      showToast('Failed to create room.');
    }
  }

  async function mpDoJoin() {
    if (!isOnline) {
      showToast('Multiplayer requires an internet connection.');
      setMp(prev => ({ ...prev, error: 'Offline mode — multiplayer disabled' }));
      return;
    }
    const code = (mpCodeInput || '').trim();
    if (!code) { showToast('Enter a room code'); return; }
    if (mp.joining) return;
    setMp(prev => ({ ...prev, joining: true, error:null }));
    try {
      const preferredSeat = mpPreferredSeat === '' ? undefined : Number(mpPreferredSeat);
      const jr = await mpJoinRoom(code, { name: mpName || undefined, preferredSeat });
      mpSaveCreds(code, { playerId: jr.playerId, token: jr.token, name: jr.room?.players?.find(p=>p.id===jr.playerId)?.name, seat: jr.seat });
      mpApplyingRef.current = true;
      setState(jr.state, { silent: true });
      try { mpLastSnapshotRef.current = JSON.stringify(jr.state); } catch(_){}
      mpApplyingRef.current = false;
      setMp({ connected:true, code, version: jr.version, playerId: jr.playerId, token: jr.token, seat: jr.seat, joining:false, error:null });
      showToast(`Joined room ${code}`);
    } catch (e) {
      console.error(e);
      setMp(prev => ({ ...prev, joining:false, error: 'Failed to join room' }));
      showToast('Failed to join room.');
    }
  }

  function mpDisconnect() {
    if (mpUnsubRef.current) { try { mpUnsubRef.current(); } catch(_){} mpUnsubRef.current = null; }
    setMp({ connected:false, code:'', version:null, playerId:null, token:null, seat:null, joining:false, error:null });
    mpLastSnapshotRef.current = null;
    showToast('Left room (local only)');
    setMpPreferredSeat('');
  }

  function initTurnStats(){
    return { actionsThisTurn: 0, moves: 0, swoops: 0, busts: 0, deliveredThisTurn: 0, rolls: 0 };
  }

  function instantiateBotForType(type, rng){
    const key = type || DEFAULT_BOT_TYPE;
    if(key === 'pusher') return createPusherBot(rng);
    if(key === DEFAULT_BOT_TYPE) return createProBot(rng);
    return createBotByKey(key, rng);
  }

  function ensureBotRuntime(seat){
    const player = game.players[seat];
    const desiredType = player?.botType || DEFAULT_BOT_TYPE;
    let runtime = botAgentsRef.current[seat];
    if(!runtime){
      const rng = makeRng((Date.now() + seat * 9973) >>> 0);
      runtime = {
        bot: instantiateBotForType(desiredType, rng),
        rng,
        turnStats: initTurnStats(),
        turnActive: false,
        startScore: 0,
        botType: desiredType
      };
      botAgentsRef.current[seat] = runtime;
      return runtime;
    }

    if(runtime.botType !== desiredType){
      runtime.bot = instantiateBotForType(desiredType, runtime.rng);
      runtime.turnStats = initTurnStats();
      runtime.turnActive = false;
      runtime.startScore = 0;
      runtime.botType = desiredType;
    } else if(!runtime.turnStats){
      runtime.turnStats = initTurnStats();
    }
    return runtime;
  }

  function resetBotRuntime(seat){
    const runtime = botAgentsRef.current[seat];
    if(runtime){
      runtime.turnActive = false;
      runtime.turnStats = initTurnStats();
      runtime.startScore = 0;
    }
  }

  function makeBotSnapshot(){
    return {
      playerCount: game.playerCount,
      current: game.current,
      mode: game.mode,
      rollMovesDone: game.rollMovesDone || 0,
      pendingAdvances: Array.isArray(game.pendingAdvances) ? [...game.pendingAdvances] : null,
      baskets: [...game.baskets],
      moveHistory: [],
      players: game.players.map(pl => ({
        score: pl.score,
        swoopTokens: pl.swoopTokens || 0,
        pieces: pl.pieces.map((pc, idx) => ({ ...pc, _index: idx }))
      }))
    };
  }

  function applyBotTransfer(runtime, turnStats){
    if(!runtime.bot.shouldTransfer) return false;
    const snapshot = makeBotSnapshot();
    const decision = runtime.bot.shouldTransfer(turnStats, runtime.rng, snapshot);
    if(!decision || !decision.source || !decision.target) return false;
    const seat = game.current;
    const pl = game.players[seat];
    if(!pl) return false;
    const sourceIdx = typeof decision.source._index === 'number' ? decision.source._index : pl.pieces.findIndex(p => p.carrying);
    const targetIdx = typeof decision.target._index === 'number' ? decision.target._index : pl.pieces.findIndex(p => !p.carrying && p.r === decision.target.r && p.step === decision.target.step);
    if(sourceIdx < 0 || targetIdx < 0) return false;
    const newGame = {...game};
    const actor = newGame.players[newGame.current];
    const sourcePiece = actor.pieces[sourceIdx];
    const targetPiece = actor.pieces[targetIdx];
    if(!sourcePiece || !sourcePiece.carrying || !targetPiece || targetPiece.carrying) return false;
    const fromCell = formatCell(sourcePiece.r, sourcePiece.step);
    const toCell = formatCell(targetPiece.r, targetPiece.step);
    sourcePiece.carrying = false;
    targetPiece.carrying = true;
    newGame.message = `${actor.name}: Roll or Bank.`;
    setGame(newGame);
    showToast('Basket transferred!');
    recordEvent(`${actor.name} transferred a basket from ${fromCell} to ${toCell}`, actor.name);
    runtime.turnStats.actionsThisTurn += 1;
    return true;
  }

  function applyBotBank(runtime, turnStats){
    const rollCount = turnStats.rolls || 0;
    const didAnything = rollCount > 0 || turnStats.actionsThisTurn > 0 || turnStats.moves > 0 || turnStats.swoops > 0;
    if(!didAnything) return false;
    const snapshot = makeBotSnapshot();
    if(runtime.bot.shouldBank(turnStats, runtime.rng, snapshot)){
      botPlanRef.current = null;
      bank();
      runtime.turnStats = initTurnStats();
      runtime.turnActive = false;
      return true;
    }
    return false;
  }

  function handleBotMoveDecision(runtime, decision){
    if(!decision || decision.type !== 'move') return false;
    const plan = decision.plan || {};
    const seat = game.current;
    const pl = game.players[seat];
    if(!pl) return false;
    let direction = 'up';
    let pieceIndex = typeof plan.pieceIndex === 'number' ? plan.pieceIndex : null;
    if(plan.spawn){
      direction = 'up';
    } else if(pieceIndex !== null){
      const piece = pl.pieces[pieceIndex];
      if(piece){
        if(plan.action === 'move_down'){
          direction = 'down';
        } else if(plan.action === 'top_swoop' && plan.target){
          direction = plan.target.r > piece.r ? 'right' : 'left';
        } else if(plan.action === 'move' && plan.target){
          if(plan.target.r === piece.r){
            direction = plan.target.step > piece.step ? 'up' : 'down';
          } else {
            direction = plan.target.r > piece.r ? 'right' : 'left';
          }
        } else if(plan.target && plan.target.r !== piece.r){
          direction = plan.target.r > piece.r ? 'right' : 'left';
        }
      }
    }
    botPlanRef.current = { seat, sum: decision.sum, plan, pieceIndex };
    quickMove(decision.sum, direction);
    runtime.turnStats.actionsThisTurn += 1;
    runtime.turnStats.moves += 1;
    return true;
  }

  function handleBotSwoopDecision(runtime, decision){
    if(!decision || decision.type !== 'swoop') return false;
    const seat = game.current;
    const pl = game.players[seat];
    if(!pl || (pl.swoopTokens || 0) <= 0) return false;
    if((game.rollMovesDone || 0) > 0) return false;
    const pieceIndex = typeof decision.pcIndex === 'number' ? decision.pcIndex : (decision.plan && typeof decision.plan.pieceIndex === 'number' ? decision.plan.pieceIndex : null);
    const target = decision.target || (decision.plan && decision.plan.target);
    if(pieceIndex === null || !target) return false;
    const newGame = {...game, baskets: [...game.baskets]};
    const actor = newGame.players[newGame.current];
    const piece = actor.pieces[pieceIndex];
    if(!piece) return false;
    if(actor.swoopTokens > 0) actor.swoopTokens = Math.max(0, (actor.swoopTokens || 0) - 1);
    performMoveWithPush(piece, target, newGame, true);
    newGame.rolled = null;
    newGame.selectedPair = null;
    newGame.pendingAdvances = null;
    newGame.mode = 'preroll';
    newGame.message = `${actor.name}: Roll or Bank.`;
    setGame(newGame);
    const destLabel = formatCell(target.r, target.step);
    showToast(`${actor.name} swooped to ${destLabel}.`);
    recordEvent(`${actor.name} spent a swoop token and swooped to ${destLabel}. Tokens left: ${actor.swoopTokens || 0}.`, actor.name);
    runtime.turnStats.actionsThisTurn += 1;
    runtime.turnStats.swoops += 1;
    botPlanRef.current = null;
    return true;
  }

  function handleBotChoosePiece(){
    if(!game.pieceChoices || game.pieceChoices.length === 0) return false;
    const plan = botPlanRef.current;
    const seat = game.current;
    let targetPiece = null;
    if(plan && plan.seat === seat && typeof plan.pieceIndex === 'number'){
      targetPiece = game.players[seat]?.pieces[plan.pieceIndex];
    }
    if(!targetPiece){
      targetPiece = game.pieceChoices[0];
    }
    if(targetPiece){
      selectPieceForMove(targetPiece);
      return true;
    }
    return false;
  }

  function handleBotChooseMoveDest(){
    const plan = botPlanRef.current;
    if(plan && plan.plan && plan.plan.target){
      const target = plan.plan.target;
      handleTileClick(target.r, target.step, null);
    } else if(game.moveTargets && game.moveTargets.length > 0){
      const target = game.moveTargets[0];
      handleTileClick(target.r, target.step, null);
    }
    botPlanRef.current = null;
    return true;
  }

  function shouldProcessBot(){
    if (showNewGameModal || showLoadModal) return false;
    if (mp.connected) return false;
    if (!mpCanAct()) return false;
    const player = game.players[game.current];
    if (!player || !player.isBot) return false;
    if (game.mode === 'gameOver') return false;
    return true;
  }

  function processBotStep(){
    if(botProcessingRef.current) return;
    if(!shouldProcessBot()) return;
    botProcessingRef.current = true;
    try {
      const seat = game.current;
      const player = game.players[seat];
      if(!player) return;
      const runtime = ensureBotRuntime(seat);
      if(!runtime.turnActive){
        runtime.turnActive = true;
        runtime.turnStats = initTurnStats();
        runtime.startScore = player.score;
      }
      const delivered = Math.max(0, player.score - runtime.startScore);
      runtime.turnStats.deliveredThisTurn = delivered;
      const turnStats = { ...runtime.turnStats, deliveredThisTurn: delivered };

      if(game.mode === 'preroll' && !game.rolled){
        if(applyBotTransfer(runtime, turnStats)) return;
        if(applyBotBank(runtime, turnStats)) return;
        botPlanRef.current = null;
        runtime.turnStats.rolls = (runtime.turnStats.rolls || 0) + 1;
        roll();
        return;
      }

      if(game.mode === 'rolled' || game.mode === 'pairChosen'){
        const dice = game.rolled?.d;
        if(!dice || dice.length !== 4){
          bust();
          runtime.turnStats.actionsThisTurn += 1;
          runtime.turnStats.busts += 1;
          runtime.turnActive = false;
          botPlanRef.current = null;
          return;
        }
        const pairs = [];
        for(let i=0;i<dice.length;i++){
          for(let j=i+1;j<dice.length;j++){
            pairs.push({ i, j, sum: dice[i] + dice[j] });
          }
        }
        const forcedSum = (game.mode === 'pairChosen' && game.pendingAdvances && game.pendingAdvances.length > 0)
          ? game.pendingAdvances[0]
          : null;
        const rollPairs = forcedSum === null ? pairs : pairs.filter(p => p.sum === forcedSum);
        const allowed = forcedSum === null ? allowedSumsForCurrentRoll() : [forcedSum];
        const snapshot = makeBotSnapshot();
        const decision = runtime.bot.chooseAction({ game: snapshot, rng: runtime.rng, roll: { d:[...dice], pairs: rollPairs }, allowedSums: allowed, turnStats: runtime.turnStats });
        if(decision.type === 'swoop'){
          if(handleBotSwoopDecision(runtime, decision)) return;
        } else if(decision.type === 'move'){
          if(handleBotMoveDecision(runtime, decision)) return;
        } else if(decision.type === 'bust'){
          botPlanRef.current = null;
          bust();
          runtime.turnStats.actionsThisTurn += 1;
          runtime.turnStats.busts += 1;
          runtime.turnActive = false;
          return;
        }
        // If we reach here no move executed; fall back to bust to avoid stalls
        botPlanRef.current = null;
        bust();
        runtime.turnStats.actionsThisTurn += 1;
        runtime.turnStats.busts += 1;
        runtime.turnActive = false;
        return;
      }

      if(game.mode === 'choosePiece'){
        if(handleBotChoosePiece()) return;
      }

      if(game.mode === 'chooseMoveDest'){
        if(handleBotChooseMoveDest()) return;
      }

      if(game.mode === 'pickSwoopDest'){
        const target = game.swoopTargets && game.swoopTargets[0];
        if(target && game.swoopSource){
          finalizeSwoop(game.swoopSource, target);
          return;
        }
      }

      if(game.mode === 'chooseTopStepSwoop'){
        const target = game.topStepTargets && game.topStepTargets[0];
        if(target){
          chooseTopStepSwoopTarget(target);
          return;
        }
      }

    } finally {
      botProcessingRef.current = false;
    }
  }

  function handleBotPlay(){
    processBotStep();
  }

  React.useEffect(() => {
    Object.keys(botAgentsRef.current).forEach(key => {
      const idx = Number(key);
      const pl = game.players[idx];
      if(!pl || !pl.isBot){
        delete botAgentsRef.current[idx];
      }
    });
  }, [game.players]);

  React.useEffect(() => {
    const prev = botLastSeatRef.current;
    if(prev !== game.current){
      resetBotRuntime(prev);
      botPlanRef.current = null;
      botLastSeatRef.current = game.current;
    }
  }, [game.current]);

  React.useEffect(() => {
    if (!game.rolled) {
      botLastRollRef.current = null;
      return;
    }
    const player = game.players[game.current];
    if (!player || !player.isBot) return;
    const dice = game.rolled.d;
    if (!Array.isArray(dice)) return;
    const key = `${game.current}:${dice.join('-')}`;
    if (botLastRollRef.current === key) return;
    botLastRollRef.current = key;
    showToast(`${player.name} rolled ${dice.join(' ')}`);
  }, [game.rolled, game.current, game.players]);

  function undo(){
    const hist = historyRef.current;
    if (!hist || hist.length === 0) { showToast('Nothing to undo.'); return; }
    const prev = hist.pop();
    // Prevent pushing to history during this state restore
    isUndoingRef.current = true;
    setState(prev, { silent: true });
    showToast('Undid last action.');
  }

  function showToast(message) {
    setToast(message);
    setTimeout(() => setToast(null), 1500);
  }

  function existsAnyMoveThisRoll(){
    if(!game.rolled) return false;
    const pl=game.players[game.current];
    // New: evaluate pairings — any pairing that enables at least one move?
    if (game.rolled.pairings && Array.isArray(game.rolled.pairings)) {
      for (const pairing of game.rolled.pairings) {
        const [a,b] = pairing;
        const canA = canMoveOnSum(pl, a.sum);
        const canB = canMoveOnSum(pl, b.sum);
        if (canA || canB) return true;
      }
      return false;
    }
    // Backward-compat if older state still has pairs
    if (game.rolled.pairs && Array.isArray(game.rolled.pairs)) {
      for(const pr of game.rolled.pairs){ if(canMoveOnSum(pl, pr.sum)) return true; }
    }
    return false;
  }

  function canSwoopNow(){
    const pl=game.players[game.current];
    if(!(pl.swoopTokens>0)) return false;
    for(const pc of pl.pieces){ if(pc.active && potentialSwoops(pc).length>0) return true; }
    return false;
  }

  function anyMandatoryActionThisRoll(){
    // In Can't Stop style, you must advance if a move is available in the current roll context
    if (game.mode === 'rolled' || game.mode === 'pairChosen') {
      // If a pairing is already selected and we have pending advances, the next playable advance is mandatory
      if (game.pendingAdvances && game.pendingAdvances.length > 0) {
        const pl=game.players[game.current];
        const nextSum = game.pendingAdvances[0];
        return canMoveOnSum(pl, nextSum);
      }
      // Otherwise, before choosing a pairing, if any pairing yields a playable move, action is mandatory
      return existsAnyMoveThisRoll();
    }
    return false;
  }

  function anyActionThisRoll(){
    // Any action includes advancing via a valid pairing or spending a Swoop token
    // NOTE: Used for UI hints only. During an active roll, banking is not allowed;
    // if no legal moves exist, the only outcome is Bust (even if a token Swoop is possible).
    if(game.mode === 'rolled') {
      return existsAnyMoveThisRoll() || canSwoopNow();
    }
    if(game.mode === 'pairChosen'){
      const pl=game.players[game.current];
      if (game.pendingAdvances && game.pendingAdvances.length>0) {
        const nextSum = game.pendingAdvances[0];
        return canMoveOnSum(pl, nextSum) || canSwoopNow();
      }
      return canSwoopNow();
    }
    return false;
  }

  // Transfer functionality
  function canTransfer(){
    // Allow transfers during any mode of the acting player's turn (except game over)
    if(game.mode === 'gameOver') return false;

    const pl = game.players[game.current];
    return pl.pieces.some(pc => pc.carrying);
  }

  function getTransferTargets(sourcePiece){
    const pl = game.players[game.current];
    const targets = [];

    for(const pc of pl.pieces){
      if(pc === sourcePiece || pc.carrying) continue; // Can't transfer to self or carrying pieces

      const sameLane = pc.r === sourcePiece.r;
      const sameStep = pc.step === sourcePiece.step;
      const stepDiff = Math.abs(pc.step - sourcePiece.step);
      const laneDiff = Math.abs(pc.r - sourcePiece.r);

      // Adjacent on same lane (step ±1)
      if(sameLane && stepDiff === 1){
        targets.push(pc);
      }
      // Adjacent on different lane (same step)
      else if(!sameLane && sameStep && laneDiff === 1){
        targets.push(pc);
      }
      // Diagonally 1 step away on different lane
      else if(!sameLane && stepDiff === 1 && laneDiff === 1){
        targets.push(pc);
      }
    }

    return targets;
  }

  function startTransfer(){
    if(!canTransfer()) return;
    const newGame = {...game, mode:'chooseTransferSource'};
    // Store the previous mode to return to after transfer
    newGame.previousMode = game.mode;
    newGame.message = `${game.players[game.current].name}: Click a piece carrying a basket to transfer from.`;
    setGame(newGame);
  }

  function selectTransferSource(piece){
    if(!piece.carrying) return;
    const targets = getTransferTargets(piece);
    if(targets.length === 0){
      showToast('No valid transfer targets for this piece.');
      return;
    }

    const newGame = {...game, mode:'chooseTransferTarget', transferSource:piece, transferTargets:targets};
    newGame.message = `${game.players[game.current].name}: Click a piece to transfer the basket to.`;
    setGame(newGame);
  }

  function executeTransfer(targetPiece){
    if(!game.transferSource || !targetPiece) return;

    const newGame = {...game};
    const sourcePiece = game.transferSource;
    const fromCell = formatCell(sourcePiece.r, sourcePiece.step);
    const toCell = formatCell(targetPiece.r, targetPiece.step);
    sourcePiece.carrying = false;
    targetPiece.carrying = true;

    showToast(`Basket transferred!`);
    recordEvent(
      `${newGame.players[newGame.current].name} transferred a basket from ${fromCell} to ${toCell}`,
      newGame.players[newGame.current].name,
      newGame
    );

    // Determine what mode to return to
    const previousMode = game.previousMode || 'preroll';
    const pl = newGame.players[newGame.current];

    // Return to the previous mode, preserving game state
    newGame.mode = previousMode;
    newGame.transferSource = null;
    newGame.transferTargets = null;
    newGame.previousMode = null;

    // Set appropriate message based on the mode we're returning to
    if(previousMode === 'preroll'){
      const hasMoreCarryingPieces = pl.pieces.some(pc => pc.carrying);
      if(hasMoreCarryingPieces){
        newGame.message = `${pl.name}: Roll, Bank, or Transfer again.`;
      } else {
        newGame.message = `${pl.name}: Roll or Bank.`;
      }
    } else if(previousMode === 'rolled'){
      newGame.message = `${pl.name}: Choose a pair to move or Bust.`;
    } else if(previousMode === 'pairChosen'){
      const canMove = canMoveOnSum(pl, newGame.selectedPair?.sum);
      const canSwoop = canSwoopNow();
      if(canMove && canSwoop) newGame.message = `${pl.name}: Move or spend a Swoop token.`;
      else if(canMove) newGame.message = `${pl.name}: Move.`;
      else if(canSwoop) newGame.message = `${pl.name}: Spend a Swoop token (optional) or End Turn (Busted).`;
      else newGame.message = `${pl.name}: End Turn (Busted).`;
    } else {
      // For other modes, use a generic message
      newGame.message = `${pl.name}: Continue your turn.`;
    }

    setGame(newGame);
  }

  function cancelTransfer(){
    const previousMode = game.previousMode || 'preroll';
    const newGame = {...game, mode: previousMode, transferSource:null, transferTargets:null, previousMode: null};

    // Set appropriate message based on the mode we're returning to
    const pl = game.players[game.current];
    if(previousMode === 'preroll'){
      const hasCarryingPieces = pl.pieces.some(pc => pc.carrying);
      if(hasCarryingPieces){
        newGame.message = `${pl.name}: Roll, Bank, or Transfer.`;
      } else {
        newGame.message = `${pl.name}: Roll or Bank.`;
      }
    } else if(previousMode === 'rolled'){
      newGame.message = `${pl.name}: Choose a pair to move or Bust.`;
    } else if(previousMode === 'pairChosen'){
      const canMove = canMoveOnSum(pl, newGame.selectedPair?.sum);
      const canSwoop = canSwoopNow();
      if(canMove && canSwoop) newGame.message = `${pl.name}: Move or spend a Swoop token.`;
      else if(canMove) newGame.message = `${pl.name}: Move.`;
      else if(canSwoop) newGame.message = `${pl.name}: Spend a Swoop token (optional) or End Turn (Busted).`;
      else newGame.message = `${pl.name}: End Turn (Busted).`;
    } else {
      newGame.message = `${pl.name}: Continue your turn.`;
    }

    setGame(newGame);
  }

  function occupied(r, step){
    // Shared-lane occupancy across both players
    for(const pl of game.players){
      if(pl.pieces.some(pc=>pc.r===r && pc.step===step)) return true;
    }
    return false;
  }
  function pieceOnLane(pl,r){ return pl.pieces.find(p=>p.r===r); }
  function activeCount(pl){ return pl.pieces.filter(p=>p.active).length; }

  function roll(){
    if(game.mode!=='preroll') return;
    const d=[r6(),r6(),r6(),r6()];
    // Build the 3 pairings of 4 dice: (0+1,2+3), (0+2,1+3), (0+3,1+2)
    const pairings = [
      [ {i:0,j:1,sum:d[0]+d[1]}, {i:2,j:3,sum:d[2]+d[3]} ],
      [ {i:0,j:2,sum:d[0]+d[2]}, {i:1,j:3,sum:d[1]+d[3]} ],
      [ {i:0,j:3,sum:d[0]+d[3]}, {i:1,j:2,sum:d[1]+d[2]} ],
    ];
    const newGame = {
      ...game,
      rolled:{d, pairings},
      selectedPair:null,
      pendingAdvances:null,
      rollMovesDone:0,
      mode:'rolled'
    };

    // Check if any pairing can be used for movement
    const pl = game.players[game.current];
    let hasAnyMove = false;
    for(const pairing of pairings) {
      const [a,b] = pairing;
      if (canMoveOnSum(pl, a.sum) || canMoveOnSum(pl, b.sum)) { hasAnyMove = true; break; }
    }

    const rollerName = game.players[game.current].name;
    if(!hasAnyMove){
      newGame.message = `${rollerName} rolled ${d.join(' ')} — no legal pairings. Spend a Swoop token or End Turn (Busted).`;
    } else {
      newGame.message = `${rollerName} rolled ${d.join(' ')} — choose a pairing (advance both if possible).`;
    }

    setGame(newGame);
    const roller = game.players[game.current];
    if (roller) {
      recordEvent(`${roller.name} rolled ${d.join(' ')}`, roller.name);
    }
  }

  // Assess whether a lane can be advanced on this roll and what activation cost it requires (0 if moving an active piece, 1 if it would need to activate/spawn one first)
  function moveCostForSum(pl, sum){
    const r = LANES.findIndex(x => x.sum === sum);
    if(r < 0) return { can:false, cost:Infinity };

    const piecesOnRoute = pl.pieces.filter(p => p.r === r);

    // Try active pieces first
    const activePieces = piecesOnRoute.filter(p => p.active);
    for(const pc of activePieces){
      const L = LANES[pc.r].L;
      if(pc.step === L){
        const targets = getMoveTargets(pc);
        if(targets.length > 0) return { can:true, cost:0 };
        if(canTopStepActivate(pl, pc)) return { can:true, cost:0 };
      } else {
        const targets = getMoveTargets(pc);
        if(targets.length > 0) return { can:true, cost:0 };
      }
    }

    // Then inactive pieces (requires activation)
    if(activeCount(pl) < 2){
      const inactivePieces = piecesOnRoute.filter(p => !p.active);
      for(const pc of inactivePieces){
        const L = LANES[pc.r].L;
        if(pc.step === L){
          const targets = getMoveTargets(pc);
          if(targets.length > 0) return { can:true, cost:1 };
          if(canTopStepActivate(pl, pc)) return { can:true, cost:1 };
        } else {
          const targets = getMoveTargets(pc);
          if(targets.length > 0) return { can:true, cost:1 };
        }
      }
    }

    // No pieces on route — consider spawning
    if(pl.pieces.length >= 5 || activeCount(pl) >= 2) return { can:false, cost:Infinity };
    if(occupied(r,1)) return { can:false, cost:Infinity };
    return { can:true, cost:1 };
  }

  // Build deduped roll options from current pairings, respecting the 2-active-piece cap.
  function computeRollOptions(){
    if(!game.rolled || !game.rolled.pairings) return [];
    const pl = game.players[game.current];
    const ac = activeCount(pl);
    const allowedActivations = Math.max(0, 2 - ac);

    const seen = new Set();
    const out = [];

    function describeWhySumBlocked(sum){
      const r = LANES.findIndex(x=>x.sum===sum);
      if(r < 0) return 'not a valid lane';
      const piecesOnRoute = pl.pieces.filter(p=>p.r===r);
      if(piecesOnRoute.length === 0){
        if(pl.pieces.length >= 5) return 'needs a new piece but you already have 5 pieces';
        if(activeCount(pl) >= 2) return 'needs a new piece but already 2 active pieces';
        if(occupied(r,1)) return 'step 1 is currently occupied';
        return 'needs a new piece on that lane';
      }
      // Some piece exists but nothing legal
      const activePieces = piecesOnRoute.filter(p=>p.active);
      if(activePieces.length>0){
        const anyTargets = activePieces.some(p=>getMoveTargets(p).length>0 || (p.step===LANES[p.r].L && canTopStepActivate(pl,p)));
        if(!anyTargets) return 'no legal moves from current positions';
      }
      const inactivePieces = piecesOnRoute.filter(p=>!p.active);
      if(inactivePieces.length>0 && activeCount(pl) >= 2) return 'requires activation but already 2 active pieces';
      return 'blocked on that lane';
    }

    for(const pairing of game.rolled.pairings){
      const [a,b] = pairing;
      const ca = moveCostForSum(pl, a.sum);
      const cb = moveCostForSum(pl, b.sum);

      const bothPossible = ca.can && cb.can && (ca.cost + cb.cost) <= allowedActivations;
      if(bothPossible){
        const s1 = Math.min(a.sum, b.sum); const s2 = Math.max(a.sum, b.sum);
        const key = `D:${s1}-${s2}`;
        if(!seen.has(key)){
          seen.add(key);
          out.push({ type:'double', sums:[s1,s2], label:`${s1} and ${s2}`, title:`${game.rolled.d[a.i]}+${game.rolled.d[a.j]} & ${game.rolled.d[b.i]}+${game.rolled.d[b.j]}` });
        }
      } else {
        // Add singles for any that are individually possible
        let pairCapReason = null;
        if(ca.can && cb.can && (ca.cost + cb.cost) > allowedActivations){
          pairCapReason = `Both together need ${ca.cost + cb.cost} activations; you have ${allowedActivations} (max 2 active pieces).`;
        }
        if(ca.can && ca.cost <= allowedActivations){
          const key = `S:${a.sum}`;
          if(!seen.has(key)){
            seen.add(key);
            const reason = pairCapReason || (!cb.can ? `Other sum ${b.sum} blocked: ${describeWhySumBlocked(b.sum)}` : null);
            out.push({ type:'single', sums:[a.sum], label:`only ${a.sum}`, title:`${game.rolled.d[a.i]}+${game.rolled.d[a.j]}`, reason });
          }
        }
        if(cb.can && cb.cost <= allowedActivations){
          const key = `S:${b.sum}`;
          if(!seen.has(key)){
            seen.add(key);
            const reason = pairCapReason || (!ca.can ? `Other sum ${a.sum} blocked: ${describeWhySumBlocked(a.sum)}` : null);
            out.push({ type:'single', sums:[b.sum], label:`only ${b.sum}`, title:`${game.rolled.d[b.i]}+${game.rolled.d[b.j]}`, reason });
          }
        }
      }
    }

    // Stable sort by label for consistent ordering
    out.sort((x,y) => {
      if(x.type!==y.type) return x.type==='double' ? -1 : 1; // doubles first
      return x.label.localeCompare(y.label);
    });
    return out;
  }

  // Build a user-facing label for a pairing per BGA style: "X and Y" or "only X"
  function pairingLabel(pairing){
    // Legacy helper (kept for backward compatibility when rendering legacy saves)
    const [a,b] = pairing;
    const pl = game.players[game.current];
    const ac = activeCount(pl);
    const allowedActivations = Math.max(0, 2 - ac);
    const ca = moveCostForSum(pl, a.sum);
    const cb = moveCostForSum(pl, b.sum);
    const bothPossible = ca.can && cb.can && (ca.cost + cb.cost) <= allowedActivations;
    if (bothPossible) return `${a.sum} and ${b.sum}`;
    if (ca.can && ca.cost <= allowedActivations) return `only ${a.sum}`;
    if (cb.can && cb.cost <= allowedActivations) return `only ${b.sum}`;
    return `no play`;
  }

  function selectPairing(i){
    // Choose one of the 3 pairings; enforce Can't Stop advance rules
    if(game.mode!=='rolled' && game.mode!=='pairChosen' && game.mode!=='chooseSwoop' && game.mode!=='pickSwoopDest') return;
    if(!game.rolled || !game.rolled.pairings) return;

    const pairing = game.rolled.pairings[i];
    const [a,b] = pairing;
    const pl = game.players[game.current];
    const ac = activeCount(pl);
    const allowedActivations = Math.max(0, 2 - ac);
    const ca = moveCostForSum(pl, a.sum);
    const cb = moveCostForSum(pl, b.sum);
    const canA = ca.can && ca.cost <= allowedActivations;
    const canB = cb.can && cb.cost <= allowedActivations;

    const pending = [];
    if (canA && canB && (ca.cost + cb.cost) <= allowedActivations) {
      pending.push(a.sum, b.sum);
    } else {
      if (canA) pending.push(a.sum);
      if (canB) pending.push(b.sum);
    }

    if (pending.length === 0) {
      showToast('No legal moves for that pairing.');
      return;
    }

    const newGame = {
      ...game,
      selectedPair: { sum: pending[0] },
      pendingAdvances: pending,
      mode:'pairChosen'
    };

    // Clear any swoop-related state when switching pairings
    newGame.swoopSource = null;
    newGame.swoopTargets = null;

    if (pending.length === 2) {
      newGame.message = `${pl.name}: Move ${pending[0]} then ${pending[1]}.`;
    } else {
      newGame.message = `${pl.name}: Only ${pending[0]} is possible — Move.`;
    }

    setGame(newGame);
  }

  // New: selecting a deduped roll option (single or double)
  function selectRollOption(option){
    if(game.mode!=='rolled' && game.mode!=='pairChosen') return;
    if(!game.rolled) return;

    const sums = option.sums || [];
    if(sums.length === 0) return;

    const newGame = {
      ...game,
      selectedPair: { sum: sums[0] },
      pendingAdvances: [...sums],
      mode:'pairChosen'
    };

    // Clear any swoop-related state when switching choices
    newGame.swoopSource = null;
    newGame.swoopTargets = null;

    if (sums.length === 2) newGame.message = `${game.players[game.current].name}: Move ${sums[0]} then ${sums[1]}.`;
    else newGame.message = `${game.players[game.current].name}: Only ${sums[0]} is possible — Move.`;

    setGame(newGame);
  }

  // Build list of allowed sums for current UI context
  function allowedSumsForCurrentRoll(){
    if(!game.rolled || !game.rolled.pairings) return [];
    // If a pairing has been chosen, only the currently selected sum is actionable
    if(game.mode === 'pairChosen' && game.pendingAdvances && game.selectedPair){
      return [game.selectedPair.sum];
    }
    const opts = computeRollOptions();
    const set = new Set();
    for(const opt of opts){ for(const s of (opt.sums||[])) set.add(s); }
    return Array.from(set).sort((a,b)=>a-b);
  }

  // Build the rows to render in the UI. When a pair has been chosen and a first
  // move has been taken, restrict to the forced second sum only (no other options).
  function computeUiMoveRows(){
    if(!game.rolled || !game.rolled.pairings) return [];
    if(game.mode === 'pairChosen' && game.pendingAdvances && game.selectedPair){
      return [{ type: 'single', sums: [game.selectedPair.sum], title: 'Forced move' }];
    }
    const baseOptions = computeRollOptions();
    if(!isMobile) return baseOptions;

    const rows = [];
    const singleBuffer = [];

    const bundleSingles = (first, second) => {
      const sumA = first?.sums?.[0];
      const sumB = second?.sums?.[0];
      if(sumA == null || sumB == null) return null;
      const details = [
        { sum: sumA, reason: first.reason || null, title: first.title || null },
        { sum: sumB, reason: second.reason || null, title: second.title || null }
      ];
      return {
        type: 'singlePair',
        variant: 'either',
        sums: [sumA, sumB],
        title: `Either ${sumA} or ${sumB}`,
        reason: `Choose either ${sumA} or ${sumB}.`,
        singleDetails: details
      };
    };

    const flushSingles = (force = false) => {
      while(singleBuffer.length >= 2){
        const combined = bundleSingles(singleBuffer.shift(), singleBuffer.shift());
        if(combined) rows.push(combined);
      }
      if(force && singleBuffer.length === 1){
        rows.push(singleBuffer.shift());
      }
    };

    for(const option of baseOptions){
      if(option.type === 'single'){
        singleBuffer.push(option);
        continue;
      }
      flushSingles(true);
      rows.push(option);
    }

    flushSingles(true);
    return rows;
  }

  // Prefer a double option when available; otherwise fall back to single option for the sum
  function pickAdvanceSequenceForSum(sum){
    if(!game.rolled || !game.rolled.pairings) return null;
    if(game.mode === 'pairChosen' && game.pendingAdvances && game.selectedPair && game.pendingAdvances.includes(sum)){
      return [...game.pendingAdvances];
    }
    const opts = computeRollOptions();
    const dbl = opts.find(o => o.type === 'double' && o.sums && o.sums.includes(sum));
    if(dbl){
      // If both sums are identical (e.g., 6 and 6), schedule the second move with the same sum
      if (Array.isArray(dbl.sums) && dbl.sums.length === 2) {
        const other = (dbl.sums[0] === sum) ? dbl.sums[1] : dbl.sums[0];
        return [sum, (other !== undefined ? other : sum)];
      }
      return [sum];
    }
    const sgl = opts.find(o => o.type === 'single' && o.sums && o.sums.includes(sum));
    if(sgl) return [sum];
    return null;
  }

  // Candidate generator for direct Up/Down actions on a given sum
  function directionalCandidatesForSum(pl, sum, dir){
    const r = LANES.findIndex(x => x.sum === sum);
    if(r < 0) return [];
    const out = [];
    const piecesOnRoute = pl.pieces.filter(p => p.r === r);

    // Existing pieces that could move in the requested direction
    for(const pc of piecesOnRoute){
      // Must be activatable within the 2-active-piece cap
      if(!pc.active && activeCount(pl) >= 2) continue;
      const targets = getMoveTargets(pc);
      const desiredStep = dir === 'up' ? (pc.step + 1) : (pc.step - 1);
      const t = targets.find(tg => tg.r === pc.r && tg.step === desiredStep);
      if(t){
        out.push({ pc, target: t, willActivate: !pc.active });
      }
    }

    // Spawning a new piece (only for Up): no piece on route yet and spawn is legal
    if(piecesOnRoute.length === 0 && dir === 'up'){
      if(pl.pieces.length < 5 && activeCount(pl) < 2 && !occupied(r, 1)){
        out.push({ spawn: true, r });
      }
    }
    return out;
  }

  // Candidate generator for direct Sideways actions on a given sum (left/right from top step)
  function sidewaysCandidatesForSum(pl, sum, side){
    const r = LANES.findIndex(x => x.sum === sum);
    if (r < 0) return [];
    const out = [];
    const piecesOnRoute = pl.pieces.filter(p => p.r === r);
    const dr = side === 'left' ? -1 : +1;
    const r2 = r + dr;
    if (r2 < 0 || r2 >= LANES.length) return out; // no adjacent lane

    for (const pc of piecesOnRoute){
      const L = LANES[pc.r].L;
      // Must be on top step to move sideways
      if (pc.step !== L) continue;
      // Respect activation cap if piece is inactive
      if (!pc.active && activeCount(pl) >= 2) continue;
      const targets = getMoveTargets(pc);
      const targetStep = LANES[r2].L;
      const t = targets.find(tg => tg.r === r2 && tg.step === targetStep);
      if (t){
        out.push({ pc, target: t, willActivate: !pc.active });
      }
    }
    return out;
  }

  // Direct, single-click move for a sum and direction (up/down/left/right). Sets pairing context and executes the move.
  function quickMove(sum, dir){
    if(game.mode !== 'rolled' && game.mode !== 'pairChosen') return;
    const seq = pickAdvanceSequenceForSum(sum);
    if(!seq) { showToast(`No legal move for ${sum}.`); return; }

    const newGame = { ...game };
    // Establish/refresh the pairing context
    newGame.selectedPair = { sum };
    newGame.pendingAdvances = [...seq];
    newGame.mode = 'pairChosen';
    newGame.message = seq.length === 2
      ? `${newGame.players[newGame.current].name}: Move ${seq[0]} then ${seq[1]}.`
      : `${newGame.players[newGame.current].name}: Only ${seq[0]} is possible — Move.`;

    const pl = newGame.players[newGame.current];
    let cands = [];
    if (dir === 'up' || dir === 'down') {
      cands = directionalCandidatesForSum(pl, sum, dir);
    } else if (dir === 'left' || dir === 'right') {
      cands = sidewaysCandidatesForSum(pl, sum, dir);
    }
    if(cands.length === 0){
      // Keep the selection (so player can pick a different action) but inform about direction unavailability
      setGame(newGame);
      let label = 'Sideways';
      if (dir === 'up') label = 'Up'; else if (dir === 'down') label = 'Down';
      else if (dir === 'left') label = 'Left'; else if (dir === 'right') label = 'Right';
      showToast(`No ${label} move on ${sum}.`);
      return;
    }

    // If more than one candidate piece, let the player choose which one, and auto-apply the requested direction after selection
    const nonSpawn = cands.filter(c => !c.spawn);
    if(nonSpawn.length > 1){
      newGame.mode = 'choosePiece';
      newGame.pieceChoices = nonSpawn.map(c => c.pc);
      newGame.selectedSum = sum;
      newGame.quickMoveDir = dir; // remember requested direction
      const dirLabel = (dir === 'up') ? 'Up' : (dir === 'down') ? 'Down' : (dir === 'left') ? 'Left' : 'Right';
      newGame.message = `${pl.name}: Choose piece to move ${dirLabel}.`;
      setGame(newGame);
      return;
    }

    // Single candidate path
    const c = cands[0];
    if(c.spawn){
      // Spawn new piece at step 1 (no immediate extra movement)
      ensurePieceForSum(pl, sum);
      setGame(finishPairActionAfterMove(newGame));
      return;
    }

    // Activate if needed (within cap) and perform the move
    if(c.willActivate && activeCount(pl) < 2){ c.pc.active = true; }
    performMoveWithPush(c.pc, c.target, newGame);
    setGame(finishPairActionAfterMove(newGame));
  }

  function canMoveOnSum(pl,sum){
    const r=LANES.findIndex(x=>x.sum===sum); if(r<0) return false;

    // Get all pieces on this route
    const piecesOnRoute = pl.pieces.filter(p => p.r === r);

    if(piecesOnRoute.length > 0){
      // Check if any piece on this route can move
      // First check active pieces, then inactive pieces
      const activePieces = piecesOnRoute.filter(p => p.active);
      const inactivePieces = piecesOnRoute.filter(p => !p.active);

      // Check active pieces first - they can move if not blocked
      for(const pc of activePieces){
        const L=LANES[pc.r].L;

        // At top step: can move down or sideways; also allow activation-only if otherwise blocked
        if(pc.step === L){
          const targets = getMoveTargets(pc);
          if(targets.length > 0) return true;
          if(canTopStepActivate(pl, pc)) return true;
        } else {
          // Anywhere else: can choose up or down
          const targets = getMoveTargets(pc);
          if(targets.length > 0) return true;
        }
      }

      // Check inactive pieces - they can move if they can be activated first
      if(activeCount(pl) < 2){
        for(const pc of inactivePieces){
          const L=LANES[pc.r].L;

          if(pc.step === L){
            const targets = getMoveTargets(pc);
            if(targets.length > 0) return true;
            if(canTopStepActivate(pl, pc)) return true;
          } else {
            const targets = getMoveTargets(pc);
            if(targets.length > 0) return true;
          }
        }
      }

      return false;
    } else {
      // No pieces on route - check if we can spawn a new piece
      return (pl.pieces.length<5 && !occupied(r, 1) && activeCount(pl)<2);
    }
  }

  // Check if a piece at top step can be activated
  function canTopStepActivate(pl, pc){
    return !pc.active && activeCount(pl) < 2;
  }

  // Check if a piece at top step can move down
  function canTopStepMoveDown(pc){
    const L = LANES[pc.r].L;
    if(pc.step !== L) return false;
    const downStep = L - 1;
    return downStep >= 1 && tileExistsAt(pc.r, downStep);
  }

  // Check if a piece at top step can do a free swoop
  function canTopStepFreeSwoop(pc){
    if(pc.step !== LANES[pc.r].L) return false;
    return potentialTopStepSwoops(pc).length > 0;
  }

  // Get potential swoop targets for a piece at top step
  function potentialTopStepSwoops(pc){
    const targets = [];
    const r = pc.r;
    const L = LANES[r].L;

    if(pc.step !== L) return targets;

    for(const dr of [-1, +1]){
      const r2 = r + dr;
      if(r2 < 0 || r2 >= LANES.length) continue;

      const step2 = LANES[r2].L;
      if(tileExistsAt(r2, step2)) targets.push({r: r2, step: step2});
    }
    return targets;
  }

  // Get potential move destinations for a piece (up, down, and sideways if at top step)
  function getMoveTargets(pc){
    const targets = [];
    const L = LANES[pc.r].L;

    // Up
    const up = pc.step + 1;
    if(up <= L && tileExistsAt(pc.r, up)){
      targets.push({r: pc.r, step: up});
    }

    // Down
    const down = pc.step - 1;
    if(down >= 1 && tileExistsAt(pc.r, down)){
      targets.push({r: pc.r, step: down});
    }

    // Sideways from top step
    if(pc.step === L){
      for(const dr of [-1, +1]){
        const r2 = pc.r + dr;
        if(r2 < 0 || r2 >= LANES.length) continue;
        const step2 = LANES[r2].L;
        if(tileExistsAt(r2, step2)) targets.push({r: r2, step: step2});
      }
    }
    return targets;
  }

  function ensurePieceForSum(pl,sum){
    const r=LANES.findIndex(x=>x.sum===sum);

    // Get all pieces on this route
    const piecesOnRoute = pl.pieces.filter(p => p.r === r);

    if(piecesOnRoute.length > 0){
      // Get all viable pieces (active pieces that can move + inactive pieces that can be activated and move)
      const viablePieces = [];

      // Check active pieces that can move
      const activePieces = piecesOnRoute.filter(p => p.active);
      for(const pc of activePieces){
        const L = LANES[pc.r].L;
        if(pc.step === L){
          // Top step pieces can always be "activated" (even if already active)
          viablePieces.push(pc);
        } else {
          const targets = getMoveTargets(pc);
          if(targets.length > 0){
            viablePieces.push(pc);
          }
        }
      }

      // Check inactive pieces that can be activated (if under the 2-piece limit)
      if(activeCount(pl) < 2){
        const inactivePieces = piecesOnRoute.filter(p => !p.active);
        for(const pc of inactivePieces){
          const L = LANES[pc.r].L;
          if(pc.step === L){
            // Top step pieces can always be activated
            viablePieces.push(pc);
          } else {
            const targets = getMoveTargets(pc);
            if(targets.length > 0){
              viablePieces.push(pc);
            }
          }
        }
      }

      // If multiple viable pieces, let player choose
      if(viablePieces.length > 1){
        return 'CHOOSE_PIECE'; // Special return value to trigger piece selection
      } else if(viablePieces.length === 1){
        const pc = viablePieces[0];
        const L = LANES[pc.r].L;

        if(pc.step === L){
          return ensureTopStepPiece(pl, pc);
        }

        // Activate if not already active
        if(!pc.active && activeCount(pl) < 2){
          pc.active = true;
        }
        return pc;
      }

      // No viable pieces
      return null;
    }

    // No pieces on route - try to spawn a new piece
    if(pl.pieces.length>=5 || activeCount(pl)>=2) return null;
    if(occupied(r,1)) return null;
    const pc={r, step:1, carrying:false, active:true};
    pl.pieces.push(pc);
    return pc;
  }

  // Get all viable pieces for a sum (used for piece selection UI)
  function getViablePiecesForSum(pl, sum){
    const r=LANES.findIndex(x=>x.sum===sum);
    if(r < 0) return [];

    const piecesOnRoute = pl.pieces.filter(p => p.r === r);
    const viablePieces = [];

    // Check active pieces that can move
    const activePieces = piecesOnRoute.filter(p => p.active);
    for(const pc of activePieces){
      const L = LANES[pc.r].L;
      if(pc.step === L){
        // Top step pieces can always be "activated" (even if already active)
        viablePieces.push(pc);
      } else {
        const targets = getMoveTargets(pc);
        if(targets.length > 0){
          viablePieces.push(pc);
        }
      }
    }

    // Check inactive pieces that can be activated (if under the 2-piece limit)
    if(activeCount(pl) < 2){
      const inactivePieces = piecesOnRoute.filter(p => !p.active);
      for(const pc of inactivePieces){
        const L = LANES[pc.r].L;
        if(pc.step === L){
          // Top step pieces can always be activated
          viablePieces.push(pc);
        } else {
          const targets = getMoveTargets(pc);
          if(targets.length > 0){
            viablePieces.push(pc);
          }
        }
      }
    }

    return viablePieces;
  }

  // Handle pieces at top step with multiple options
  function ensureTopStepPiece(pl, pc){
    // First, try to activate if not already active
    if(!pc.active && activeCount(pl) < 2){
      pc.active = true;
    }
    return pc;
  }

  // Choose the best action for a piece at top step
  function chooseTopStepAction(pc){
    // Prefer move down if carrying (helps get home faster)
    if(pc.carrying && canTopStepMoveDown(pc)){
      return 'move_down';
    }

    // Otherwise prefer free swoop if available
    if(canTopStepFreeSwoop(pc)){
      return 'free_swoop';
    }

    // Default to just activation (no movement)
    return 'activate';
  }

  // Choose the best target for a top step free swoop
  function chooseBestTopStepSwoopTarget(targets, pc){
    if(targets.length === 0) return null;

    // If carrying, prefer lanes that help get home (even sums with baskets)
    if(pc.carrying){
      const basketTargets = targets.filter(t => LANES[t.r].basket);
      if(basketTargets.length > 0){
        return basketTargets[0];
      }
    }

    // Otherwise, prefer higher sum lanes (better positioning)
    targets.sort((a, b) => LANES[b.r].sum - LANES[a.r].sum);
    return targets[0];
  }

  function afterMovePickup(pc, newGame){
    const lane=LANES[pc.r]; const L=lane.L;
    if(lane.basket && newGame.baskets[pc.r] && pc.step===L && !pc.carrying){
      pc.carrying=true;
      newGame.baskets[pc.r]=false;
      showToast('Picked up basket!');
      return true;
    }
    return false;
  }

  function returnBasketToTop(r, newGame){
    if(!LANES[r].basket) return;
    newGame.baskets[r] = true;
  }

  // Find all valid lanes where a basket can be returned when a carrying piece goes bust
  function getValidBasketReturnLanes(newGame){
    const validLanes = [];

    // Check all even-numbered lanes (lanes with basket capability)
    for(let r = 0; r < LANES.length; r++){
      const lane = LANES[r];
      if(!lane.basket) continue; // Only even-numbered lanes can receive baskets

      const L = lane.L; // Last step of this lane

      // Check if the last step has any pieces on it (from any player)
      let hasAnyPiece = false;
      for(const pl of newGame.players){
        if(pl.pieces.some(pc => pc.r === r && pc.step === L)){
          hasAnyPiece = true;
          break;
        }
      }

      if(hasAnyPiece){
        validLanes.push(r);
      }
    }

    return validLanes;
  }

  // Execute the basket return to a selected lane
  function executeBasketReturn(selectedLane){
    if(game.mode !== 'chooseBasketReturnLane' || !game.basketReturnLanes || game.basketsToReturn <= 0) return;

    const newGame = {...game, baskets: [...game.baskets]};

    // Return one basket to the selected lane
    newGame.baskets[selectedLane] = true;
    newGame.basketsToReturn -= 1;

    const pl = newGame.players[newGame.current];
    showToast(`Basket returned to lane ${LANES[selectedLane].sum}!`);
    recordEvent(
      `${pl.name} returned a basket to lane ${LANES[selectedLane].sum}`,
      pl.name,
      newGame
    );

    // If more baskets need to be returned, continue the selection process
    if(newGame.basketsToReturn > 0){
      const validLanes = getValidBasketReturnLanes(newGame);
      if(validLanes.length > 0){
        newGame.basketReturnLanes = validLanes;
        newGame.message = `${pl.name}: Choose lane for basket ${newGame.basketsToReturn > 1 ? `(${newGame.basketsToReturn} remaining)` : ''}`;
        setGame(newGame);
        return;
      } else {
        // No valid lanes left, baskets are lost
        newGame.basketsToReturn = 0;
        showToast('No valid lanes remaining for basket return!');
      }
    }

    // All baskets returned or no more valid lanes, continue with bust resolution
    newGame.mode = 'preroll';
    newGame.basketReturnLanes = null;
    newGame.basketsToReturn = 0;
    newGame.current = nextSeatIndex(newGame.current, newGame.playerCount);
    newGame.rolled = null;
    newGame.selectedPair = null;
    newGame.pendingAdvances = null;
    newGame.message = `${newGame.players[newGame.current].name}, roll the dice!`;
    setGame(newGame);
  }

  // Push-chain helpers: snap‑down + basket transfer are handled in applyPushChain
  // Space helpers for geometric pushes
  function tileTypeAtSpace(r, space){
    const gs = Math.max(1, Math.min(MAX_STEP, space));
    return TILE_MAP[r][gs-1] || 'Gap';
  }
  function snapDownSpace(r, space){
    let sp = Math.max(1, Math.min(MAX_STEP, space));
    while(sp >= 1 && tileTypeAtSpace(r, sp) === 'Gap') sp--;
    return sp;
  }
  function applyPushChain(origin, dest, newGame, pusher, isSwoop = false, rootPusher = pusher){
    const originSpace = mapStepToGrid(origin.r, origin.step);
    const destSpace   = mapStepToGrid(dest.r, dest.step);
    const dr = dest.r - origin.r;
    const dsSteps = dest.step - origin.step;
    const dSpace = destSpace - originSpace;
    if (dr===0 && dsSteps===0) return;

    let occPi = -1, occPc = null;
    for(let pi=0; pi<newGame.players.length; pi++){
      const pl = newGame.players[pi];
      const pc = pl.pieces.find(p=>p.r===dest.r && p.step===dest.step);
      if(pc){ occPi = pi; occPc = pc; break; }
    }
    if(!occPc) return;

    const rootInfo = rootPusher ? findPieceOwner(newGame, rootPusher) : null;
    const pushedOwner = occPi >= 0 ? newGame.players[occPi] : null;
    const pushedName = pushedOwner ? pushedOwner.name : 'Opponent';
    const fromCell = formatCell(dest.r, dest.step);

    const r2 = dest.r + dr;
    if(occPc.carrying && pusher && !pusher.carrying){
      pusher.carrying = true; occPc.carrying = false;
    }
    if(r2 < 0 || r2 >= LANES.length){
      if (rootInfo) {
        recordEvent(
          `${rootInfo.name} pushed ${pushedName}'s piece off the board from ${fromCell}`,
          rootInfo.name,
          newGame
        );
      }
      const pl = newGame.players[occPi];
      pl.pieces = pl.pieces.filter(p=>p!==occPc);
      return;
    }
    let s2;
    if (dr === 0) {
      const L2 = LANES[r2].L;
      const candidate = dest.step + dsSteps;
      if (candidate < 1 || candidate > L2) {
        if (rootInfo) {
          recordEvent(
            `${rootInfo.name} pushed ${pushedName}'s piece off the board from ${fromCell}`,
            rootInfo.name,
            newGame
          );
        }
        const pl = newGame.players[occPi];
        pl.pieces = pl.pieces.filter(p=>p!==occPc);
        return;
      }
      s2 = candidate;
    } else {
      let targetSpace = destSpace + dSpace;
      targetSpace = Math.max(1, Math.min(MAX_STEP, targetSpace));
      let landedSpace = tileTypeAtSpace(r2, targetSpace) === 'Gap' ? snapDownSpace(r2, targetSpace) : targetSpace;
      if(landedSpace < 1){
        if (rootInfo) {
          recordEvent(
            `${rootInfo.name} pushed ${pushedName}'s piece off the board from ${fromCell}`,
            rootInfo.name,
            newGame
          );
        }
        const pl = newGame.players[occPi];
        pl.pieces = pl.pieces.filter(p=>p!==occPc);
        return;
      }
      s2 = stepForSpace(r2, landedSpace);
    }

    applyPushChain(dest, {r:r2, step:s2}, newGame, occPc, isSwoop, rootPusher);
    const toCell = formatCell(r2, s2);
    occPc.r = r2; occPc.step = s2;
    afterMovePickup(occPc, newGame);
    if (pusher === rootPusher && rootInfo) {
      recordEvent(
        `${rootInfo.name} pushed ${pushedName}'s piece from ${fromCell} to ${toCell}`,
        rootInfo.name,
        newGame
      );
    }
  }

  function performMoveWithPush(pc, target, newGame, isSwoop = false){
    const origin = {r: pc.r, step: pc.step};
    applyPushChain(origin, target, newGame, pc, isSwoop, pc);
    pc.r = target.r; pc.step = target.step;
    afterMovePickup(pc, newGame);
    const ownerInfo = findPieceOwner(newGame, pc);
    if (ownerInfo && (origin.r !== target.r || origin.step !== target.step)) {
      const fromCell = formatCell(origin.r, origin.step);
      const toCell = formatCell(target.r, target.step);
      const verb = isSwoop ? 'swooped' : 'moved';
      recordEvent(
        `${ownerInfo.name} ${verb} from ${fromCell} to ${toCell}`,
        ownerInfo.name,
        newGame
      );
    }
  }

  function useMove(){
    if(!(game.mode==='pairChosen' && game.selectedPair)) return;
    const newGame = {...game};
    const pl=newGame.players[newGame.current];
    const sum=newGame.selectedPair.sum;
    if(!canMoveOnSum(pl,sum)) return;

    const before=pl.pieces.length;
    const pc=ensurePieceForSum(pl,sum);

    // Check if we need to let the player choose which piece to use
    if(pc === 'CHOOSE_PIECE'){
      const viablePieces = getViablePiecesForSum(pl, sum);
      const updatedGame = {
        ...newGame,
        mode: 'choosePiece',
        pieceChoices: viablePieces,
        selectedSum: sum
      };
      updatedGame.message = `${pl.name}: Choose which piece to activate/move.`;
      setGame(updatedGame);
      return;
    }

    if(!pc) return;

    if(pl.pieces.length>before){
      // spawned new piece at step 1
    }else{
      // General movement: allow up or down anywhere; if at top, also sideways
      const targets = getMoveTargets(pc);
      if(targets.length === 0){
        // No movement possible (maybe just activated)
      } else if(targets.length === 1){
        // Auto-apply single move
        const target = targets[0];
        performMoveWithPush(pc, target, newGame);
      } else {
        // Multiple choices — let user select destination (up/down/sideways)
        const updatedGame = {
          ...newGame,
          mode: 'chooseMoveDest',
          movePiece: pc,
          moveTargets: targets
        };
        updatedGame.message = `${pl.name}: Choose Up, Down, or Sideways.`;
        setGame(updatedGame);
        return;
      }
    }

    setGame(finishPairActionAfterMove(newGame));
  }

  function finishPairActionAfterMove(stateAfterMove){
    const ng = {...stateAfterMove};
    const pl = ng.players[ng.current];
    ng.rollMovesDone = (ng.rollMovesDone || 0) + 1;

    // Remove the completed advance (first in pendingAdvances)
    if (ng.pendingAdvances && ng.pendingAdvances.length > 0) {
      const done = ng.pendingAdvances.shift();
      // Proceed to next forced advance if it is still possible; otherwise end the roll
      if (ng.pendingAdvances.length > 0) {
        const nextSum = ng.pendingAdvances[0];
        if (canMoveOnSum(pl, nextSum)) {
          ng.selectedPair = { sum: nextSum };
          ng.mode = 'pairChosen';
          ng.message = `${pl.name}: Forced second move with ${nextSum}.`;
          return ng;
        }
      }
    }

    // End the roll
    ng.rolled = null;
    ng.selectedPair = null;
    ng.pendingAdvances = null;
    ng.mode = 'preroll';
    ng.rollMovesDone = 0;
    ng.message = `${pl.name}: Roll or Bank.`;
    return ng;
  }

  function chooseTopStepSwoopTarget(target){
    if(!(game.mode==='chooseTopStepSwoop' && game.topStepPiece && game.topStepTargets)) return;

    const newGame = {...game};
    const pc = game.topStepPiece;

    // Find the piece in the current player's pieces and update it
    const pl = newGame.players[newGame.current];
    const actualPiece = pl.pieces.find(p => p.r === pc.r && p.step === pc.step);

    if(actualPiece){
      performMoveWithPush(actualPiece, target, newGame, true);
      showToast(`Free swoop to lane ${LANES[target.r].sum}!`);
    }

    newGame.rolled=null;
    newGame.selectedPair=null;
    newGame.pendingAdvances=null;
    newGame.mode='preroll';
    newGame.topStepPiece=null;
    newGame.topStepTargets=null;
    newGame.message=`${pl.name}: Roll or Bank.`;
    setGame(newGame);
  }

  function potentialSwoops(pc){
    const targets=[]; const r=pc.r; const L=LANES[r].L; const sum=LANES[r].sum;
    const atOddTop=(sum%2===1)&&(pc.step===L-1);
    const atTopStep=pc.step===L;

    for(const dr of [-1,+1]){
      const r2=r+dr; if(r2<0||r2>=LANES.length) continue;
      let step2;

      if(atTopStep){
        // Pieces at the top step can swoop to the top step of adjacent lanes
        step2=LANES[r2].L;
      } else {
        // Use geometric space mapping for all other cases
        const space = mapStepToGrid(r, pc.step);
        step2 = stepForSpace(r2, space);
      }

      if(step2 && tileExistsAt(r2, step2)) targets.push({r:r2, step:step2});
    }
    return targets;
  }

  function useSwoop(){
    const pl=game.players[game.current];
    if(!(pl.swoopTokens>0)) return;
    // Any active piece eligible
    const eligiblePieces = pl.pieces.filter(p => p.active && potentialSwoops(p).length>0);
    if(eligiblePieces.length===0) return;
    const newGame = {...game, mode:'chooseSwoop'};
    newGame.previousMode = game.mode;
    newGame.message = `${pl.name}: spend a token — click an active piece to Swoop.`;
    setGame(newGame);
  }

  function chooseSwoopPiece(pc){
    const dests=potentialSwoops(pc);
    const newGame = {...game, mode:'pickSwoopDest', swoopSource:pc, swoopTargets:dests};
    newGame.message = `${game.players[game.current].name}: click destination for Swoop.`;
    setGame(newGame);
  }

  function finalizeSwoop(pc,target){
    const newGame = {...game, baskets: [...game.baskets]};
    // spend token
    const pl = newGame.players[newGame.current];
    if(pl.swoopTokens>0) pl.swoopTokens = Math.max(0, pl.swoopTokens - 1);
    performMoveWithPush(pc, target, newGame, true); // isSwoop = true
    const destLabel = formatCell(target.r, target.step);
    showToast(`Swooped to ${destLabel}.`);
    recordEvent(
      `${pl.name} spent a swoop token and swooped to ${destLabel}. Tokens left: ${pl.swoopTokens || 0}.`,
      pl.name,
      newGame
    );
    // Clear swoop selection state
    newGame.swoopSource = null;
    newGame.swoopTargets = null;
    newGame.previousMode = null;
    // Using a token completes the action for this roll — exit roll context
    newGame.rolled = null;
    newGame.selectedPair = null;
    newGame.pendingAdvances = null;
    newGame.mode = 'preroll';
    newGame.message = `${pl.name}: Roll or Bank.`;
    setGame(newGame);
  }

  function selectPieceForMove(selectedPiece){
    if(game.mode !== 'choosePiece' || !game.pieceChoices || !game.selectedSum) return;

    const newGame = {...game};
    const pl = newGame.players[newGame.current];
    const sum = game.selectedSum;

    // Find the actual piece in the player's pieces array
    const pc = pl.pieces.find(p => p.r === selectedPiece.r && p.step === selectedPiece.step);

    if(!pc) return;

    const L = LANES[pc.r].L;

    // Handle top step pieces
    if(pc.step === L){
      if(!pc.active && activeCount(pl) < 2){
        pc.active = true;
      }
      // Continue with normal flow for top step pieces
    } else {
      // Activate if not already active
      if(!pc.active && activeCount(pl) < 2){
        pc.active = true;
      }
    }

    // Clear piece selection state
    newGame.mode = 'pairChosen';
    newGame.pieceChoices = null;
    newGame.selectedSum = null;

    // Now proceed with movement logic
    const targets = getMoveTargets(pc);
    // If a quick direction is pending, try to auto-apply it
    if(newGame.quickMoveDir){
      let targetMatch = null;
      if (newGame.quickMoveDir === 'up' || newGame.quickMoveDir === 'down'){
        const desired = newGame.quickMoveDir === 'up' ? (pc.step + 1) : (pc.step - 1);
        targetMatch = targets.find(tg => tg.r === pc.r && tg.step === desired);
      } else if (newGame.quickMoveDir === 'left' || newGame.quickMoveDir === 'right'){
        const dr = newGame.quickMoveDir === 'left' ? -1 : +1;
        const r2 = pc.r + dr;
        if (r2 >= 0 && r2 < LANES.length){
          const step2 = LANES[r2].L;
          targetMatch = targets.find(tg => tg.r === r2 && tg.step === step2);
        }
      }
      if(targetMatch){
        performMoveWithPush(pc, targetMatch, newGame);
        newGame.quickMoveDir = null;
        setGame(finishPairActionAfterMove(newGame));
        return;
      }
      // If the desired direction isn't available, fall through to normal destination chooser
      newGame.quickMoveDir = null;
    }
    if(targets.length === 0){
      // No movement possible (maybe just activated)
      setGame(finishPairActionAfterMove(newGame));
    } else if(targets.length === 1){
      // Auto-apply single move
      const target = targets[0];
      pc.r = target.r;
      pc.step = target.step;
      afterMovePickup(pc, newGame);
      setGame(finishPairActionAfterMove(newGame));
    } else {
      // Multiple choices — let user select destination (up/down/sideways)
      newGame.mode = 'chooseMoveDest';
      newGame.movePiece = pc;
      newGame.moveTargets = targets;
      newGame.message = `${pl.name}: Choose Up, Down, or Sideways.`;
      setGame(newGame);
    }
  }

  function handleTileClick(r, step, occ) {
    // Prevent board interactions when not the acting side
    if (mp.connected && mp.seat !== game.current) return;
    if (game.mode === 'choosePiece') {
      // Click on a piece to select it for movement
      if (occ && occ.pi === game.current && game.pieceChoices) {
        const selectedPiece = game.pieceChoices.find(p => p.r === r && p.step === step);
        if (selectedPiece) {
          selectPieceForMove(selectedPiece);
        }
      }
    } else if (game.mode === 'chooseSwoop') {
      // Click on a piece to select it for swooping
      if (occ && occ.pi === game.current && occ.pc.active) {
        chooseSwoopPiece(occ.pc);
      }
    } else if (game.mode === 'pickSwoopDest') {
      // Click on a destination tile for swooping
      const target = game.swoopTargets.find(t => t.r === r && t.step === step);
      if (target && game.swoopSource) {
        finalizeSwoop(game.swoopSource, target);
      }
    } else if (game.mode === 'chooseTopStepSwoop') {
      // Click on a destination tile for top step free swooping
      const target = game.topStepTargets.find(t => t.r === r && t.step === step);
      if (target && game.topStepPiece) {
        chooseTopStepSwoopTarget(target);
      }
    } else if (game.mode === 'chooseMoveDest') {
      const target = game.moveTargets && game.moveTargets.find(t => t.r === r && t.step === step);
      if (target && game.movePiece) {
        const newGame = {...game, baskets: [...game.baskets]};
        const pl = newGame.players[newGame.current];
        const pc = newGame.movePiece;
        performMoveWithPush(pc, target, newGame);
        // clear move selection UI state
        newGame.movePiece = null;
        newGame.moveTargets = null;
        setGame(finishPairActionAfterMove(newGame));
      }
    } else if (game.mode === 'chooseTransferSource') {
      // Click on a piece carrying a basket to transfer from
      if (occ && occ.pi === game.current && occ.pc.carrying) {
        selectTransferSource(occ.pc);
      }
    } else if (game.mode === 'chooseTransferTarget') {
      // Click on a target piece to transfer basket to
      if (occ && occ.pi === game.current && game.transferTargets && game.transferTargets.includes(occ.pc)) {
        executeTransfer(occ.pc);
      }
    } else if (game.mode === 'chooseBasketReturnLane') {
      // Click on a lane's last step to return a basket there
      const lane = LANES[r];
      if (lane && lane.basket && step === lane.L && game.basketReturnLanes && game.basketReturnLanes.includes(r)) {
        executeBasketReturn(r);
      }
    }
  }

  function checkVictory(gameState) {
    const TARGET_SCORE = 2;
    for(let i = 0; i < gameState.players.length; i++){
      if(gameState.players[i].score >= TARGET_SCORE){
        return { winner: i, winnerName: gameState.players[i].name };
      }
    }
    return null;
  }

  function resolveDeterrents(pl, newGame){
    pl.pieces=pl.pieces.filter(pc=>{
      const onDet = (tileTypeAt(pc.r, pc.step) === 'Deterrent');
      if(onDet){
        if(pc.carrying && LANES[pc.r].basket){ newGame.baskets[pc.r]=true; }
        return false;
      }
      return true;
    });
  }

  function bank(){
    // Banking is only applied when not in the middle of a roll
    const newGame = {...game, baskets: [...game.baskets]};
    const pl=newGame.players[newGame.current];
    const kept=[];
    let delivered=0;

    for(const pc of pl.pieces){
      const L=LANES[pc.r].L;
      const cps=checkpoints(L);

      // If the piece is on a Deterrent at end of turn, it is removed (do this before any sliding)
      const onDetNow = (tileTypeAt(pc.r, pc.step) === 'Deterrent');
      if(onDetNow){
        if(pc.carrying && LANES[pc.r].basket){ newGame.baskets[pc.r]=true; }
        // Skip adding to kept — piece removed due to deterrent
        continue;
      }

      // Pick up basket at end if available
      if(pc.step===L && LANES[pc.r].basket && newGame.baskets[pc.r] && !pc.carrying){
        pc.carrying=true;
        newGame.baskets[pc.r]=false;
      }

      if(pc.carrying){
        if(pc.step===1){
          delivered++;
        } else {
          kept.push(pc);
        }
      } else {
        let dest=null;
        for(let s=pc.step; s>=1; s--){ if(tileTypeAt(pc.r, s)==='Checkpoint' || tileTypeAt(pc.r, s)==='Final'){ dest=s; break; } }
        if(dest!==null){ pc.step=dest; kept.push(pc); }
      }
    }

    pl.pieces=kept;
    pl.score += delivered;
    if(delivered > 0) {
      showToast(`${pl.name} delivered ${delivered}.`);
    }
    recordEvent(
      `${pl.name} banked${delivered > 0 ? ` and delivered ${delivered}` : ''}`,
      pl.name,
      newGame
    );
    resolveDeterrents(pl, newGame);
    // Earn a swoop token on Bank (not on Bust)
    pl.swoopTokens = Math.min(2, (pl.swoopTokens || 0) + 1);
    enforceTokenPolicy(newGame.players, newGame.playerCount);
    pl.pieces.forEach(p=>p.active=false);

    // Check for victory after delivery
    const victory = checkVictory(newGame);
    if(victory) {
      newGame.mode = 'gameOver';
      newGame.message = `🎉 ${victory.winnerName} wins with ${newGame.players[victory.winner].score} deliveries!`;
      setGame(newGame);
      return;
    }

    newGame.current = nextSeatIndex(newGame.current, newGame.playerCount);
    newGame.mode='preroll';
    newGame.rolled=null;
    newGame.selectedPair=null;
    newGame.pendingAdvances=null;
    newGame.message=`${newGame.players[newGame.current].name}, roll the dice!`;
    setGame(newGame);
  }

  function bust(){
    const newGame = {...game, baskets: [...game.baskets]};
    const pl=newGame.players[newGame.current];
    const kept=[];
    let basketsToReturn = 0; // Count baskets from removed carrying pieces

    for(const pc of pl.pieces){
      const onDet = (tileTypeAt(pc.r, pc.step) === 'Deterrent');
      if(onDet){
        if(pc.carrying && LANES[pc.r].basket) newGame.baskets[pc.r]=true;
        continue;
      }

      if(pc.carrying){
        let dest=null;
        for(let s=pc.step; s<=LANES[pc.r].L; s++){ if(tileTypeAt(pc.r, s)==='Checkpoint' || tileTypeAt(pc.r, s)==='Final'){ dest=s; break; } }
        if(dest!==null){
          pc.step=dest;
          kept.push(pc);
        } else {
          // No checkpoint ahead - piece is removed and basket needs to be returned
          basketsToReturn++;
        }
        continue;
      }

      if(tileTypeAt(pc.r, pc.step) === 'Checkpoint' || tileTypeAt(pc.r, pc.step) === 'Final'){
        kept.push(pc);
        continue;
      }

      let dest=null;
      for(let s=pc.step; s>=1; s--){ if(tileTypeAt(pc.r, s)==='Checkpoint' || tileTypeAt(pc.r, s)==='Final'){ dest=s; break; } }

      if(dest===null){
        // No checkpoint found: piece removed (carrying pieces are handled earlier)
      } else { pc.step=dest; kept.push(pc); }
    }

    pl.pieces=kept;
    resolveDeterrents(pl, newGame);
    pl.pieces.forEach(p=>p.active=false);
    recordEvent(`${pl.name} busted.`, pl.name, newGame);

    // Check for victory after bust (in case any deliveries occurred)
    const victory = checkVictory(newGame);
    if(victory) {
      newGame.mode = 'gameOver';
      newGame.message = `🎉 ${victory.winnerName} wins with ${newGame.players[victory.winner].score} deliveries!`;
      setGame(newGame);
      return;
    }

    enforceTokenPolicy(newGame.players, newGame.playerCount);

    // Handle basket returns if any baskets need to be returned
    if(basketsToReturn > 0){
      const validLanes = getValidBasketReturnLanes(newGame);
      if(validLanes.length > 0){
        newGame.mode = 'chooseBasketReturnLane';
        newGame.basketReturnLanes = validLanes;
        newGame.basketsToReturn = basketsToReturn;
        newGame.message = `${pl.name}: Choose lane for basket return${basketsToReturn > 1 ? ` (${basketsToReturn} baskets)` : ''}`;
        setGame(newGame);
        return;
      } else {
        // No valid lanes for basket return, baskets are lost
        showToast(`No valid lanes for basket return - ${basketsToReturn} basket${basketsToReturn > 1 ? 's' : ''} lost!`);
      }
    }

    // Continue to next player
    newGame.current = nextSeatIndex(newGame.current, newGame.playerCount);
    newGame.mode='preroll';
    newGame.rolled=null;
    newGame.selectedPair=null;
    newGame.pendingAdvances=null;
    newGame.message=`${newGame.players[newGame.current].name}, roll the dice!`;
    setGame(newGame);
  }

  function bankOrBust(){
    if(game.mode==='preroll') {
      bank();
    } else if(game.mode==='rolled' || game.mode==='pairChosen') {
      // During an active roll: if any legal move exists, banking is disallowed (button disabled).
      // If no legal moves exist, the turn ends in a Bust regardless of optional Swoop availability.
      if(anyMandatoryActionThisRoll()){
        return; // UI should have disabled this
      }
      bust();
    }
  }

  function togglePendingBotSeat(idx){
    setPendingBotSeats(prev => {
      const next = [...prev];
      const makeBot = !next[idx];
      next[idx] = makeBot;
      setPendingBotTypes(prevTypes => {
        const nextTypes = [...prevTypes];
        nextTypes[idx] = makeBot ? (prevTypes[idx] || DEFAULT_BOT_TYPE) : null;
        return nextTypes;
      });
      return next;
    });
  }

  function cyclePendingBotType(idx){
    if(!pendingBotSeats[idx]) return;
    setPendingBotTypes(prev => {
      const next = [...prev];
      const current = next[idx] || DEFAULT_BOT_TYPE;
      const order = BOT_TYPE_SEQUENCE;
      const currIndex = Math.max(0, order.indexOf(current));
      const nextType = order[(currIndex + 1) % order.length];
      next[idx] = nextType;
      return next;
    });
  }

  function openNewGameModal() {
    setPendingPlayerCount(game.playerCount);
    const { seats, types } = snapshotBotPreferences(game.players);
    setPendingBotSeats(seats);
    setPendingBotTypes(types);
    setShowNewGameModal(true);
  }

  function cancelNewGameModal() {
    setShowNewGameModal(false);
  }

  function confirmNewGame() {
    const count = normalizePlayerCount(pendingPlayerCount);
    const botSeats = pendingBotSeats.slice(0, count).map(Boolean);
    const botTypes = pendingBotTypes.slice(0, count).map((type, idx) => botSeats[idx] ? (type || DEFAULT_BOT_TYPE) : null);
    setGame(initialGame(count, { botSeats, botTypes }));
    setShowNewGameModal(false);
    showToast(`New ${count}-player game ready!`);
  }

  // Save/Load functionality
  function getState(){
    return {
      version: 'v6.1',
      playerCount: game.playerCount,
      players: game.players.map(p=>({
        name: p.name,
        profile: p.profile,
        pieceIcon: p.pieceIcon,
        activeIcon: p.activeIcon,
        badgeIcon: p.badgeIcon,
        score: p.score,
        swoopTokens: p.swoopTokens || 0,
        isBot: !!p.isBot,
        botType: p.botType || (p.isBot ? DEFAULT_BOT_TYPE : null),
        pieces: p.pieces.map(x=>({...x}))
      })),
      current: game.current,
      mode: game.mode,
      rolled: game.rolled ? (
        game.rolled.pairings ?
          { d:[...game.rolled.d], pairings: game.rolled.pairings.map(pair => pair.map(pp => ({...pp}))) } :
          { d:[...game.rolled.d], pairs: game.rolled.pairs ? [...game.rolled.pairs] : [] }
      ) : null,
      selectedPair: game.selectedPair ? {...game.selectedPair} : null,
      pendingAdvances: game.pendingAdvances ? [...game.pendingAdvances] : null,
      baskets: [...game.baskets],
      message: game.message,
      transferSource: game.transferSource ? {...game.transferSource} : null,
      transferTargets: game.transferTargets ? [...game.transferTargets] : null,
      basketReturnLanes: game.basketReturnLanes ? [...game.basketReturnLanes] : null,
      basketsToReturn: game.basketsToReturn || 0,
      events: Array.isArray(game.events) ? [...game.events] : []
    };
  }

function setState(state, options = {}){
  const silent = !!options.silent;
  try{
    const inferredCount = Array.isArray(state.players) ? state.players.length : MIN_PLAYERS;
    const playerCount = normalizePlayerCount(state.playerCount || inferredCount);
    const rawPlayers = Array.isArray(state.players) ? state.players : [];
    const botSeats = rawPlayers.map(p => !!(p && p.isBot));
    const botTypes = rawPlayers.map(p => (p && p.botType) || null);
    const basePlayers = buildPlayers(playerCount, { botSeats, botTypes });
    const players = basePlayers.map((base, idx) => {
      const raw = rawPlayers[idx] || {};
      const isBot = raw.isBot ?? base.isBot ?? false;
      const botType = raw.botType || base.botType || (isBot ? DEFAULT_BOT_TYPE : null);
      const normalizedBotType = botType || (isBot ? DEFAULT_BOT_TYPE : null);
      return {
        ...base,
        name: raw.name || base.name,
        profile: raw.profile || base.profile,
        pieceIcon: raw.pieceIcon || base.pieceIcon,
        activeIcon: raw.activeIcon || base.activeIcon,
        badgeIcon: raw.badgeIcon || base.badgeIcon,
        swoopTokens: raw.swoopTokens ?? base.swoopTokens,
        isBot,
        botType: normalizedBotType,
        pieces: Array.isArray(raw.pieces) ? raw.pieces.map(x => ({ ...x })) : []
      };
    });
    enforceTokenPolicy(players, playerCount);

    const currentRaw = Number.isInteger(state.current) ? state.current : 0;
    const current = ((currentRaw % playerCount) + playerCount) % playerCount;

    const rolled = state.rolled ? (
      state.rolled.pairings ?
        { d:[...state.rolled.d], pairings: state.rolled.pairings.map(pair => pair.map(pp => ({...pp}))) } :
        { d:[...state.rolled.d], pairs: state.rolled.pairs ? [...state.rolled.pairs] : [] }
    ) : null;

    const newGame = {
      playerCount,
      players,
      current,
      mode: state.mode || 'preroll',
      rolled,
      selectedPair: state.selectedPair || null,
      rollMovesDone: state.rollMovesDone || 0,
      pendingAdvances: Array.isArray(state.pendingAdvances) ? [...state.pendingAdvances] : null,
      baskets: Array.isArray(state.baskets) && state.baskets.length === LANES.length ? [...state.baskets] : LANES.map(l=>l.basket),
      message: state.message || `${(players[current] || players[0]).name}, roll the dice!`,
      transferSource: null,
      transferTargets: null,
      pieceChoices: null,
      selectedSum: null,
      movePiece: null,
      moveTargets: null,
      swoopSource: null,
      swoopTargets: null,
      topStepPiece: null,
      topStepTargets: null,
      quickMoveDir: null,
      previousMode: null,
      basketReturnLanes: state.basketReturnLanes || null,
      basketsToReturn: state.basketsToReturn || 0,
      events: Array.isArray(state.events) ? [...state.events] : []
    };

    setGame(newGame);
    if(!silent) showToast('Game loaded successfully!');
  }catch(e){
    console.error(e);
    showToast('Invalid save file.');
  }
}

  function saveToFile(){
    const blob = new Blob([JSON.stringify(getState(), null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href=url;
    a.download = 'swoop_state.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Game saved to file!');
  }

  function openLoadModal(){
    setLoadText('');
    setShowLoadModal(true);
  }

  function closeLoadModal(){
    setShowLoadModal(false);
  }

  function loadFromText(txt){
    try{
      const state = JSON.parse(txt);
      setState(state);
      closeLoadModal();
    }catch(e){
      console.error(e);
      showToast('Could not parse JSON.');
    }
  }

  function confirmLoad(){
    const txt = loadText.trim();
    if(txt) {
      loadFromText(txt);
    } else {
      showToast('Paste JSON or choose a file.');
    }
  }

  function handleFileLoad(event){
    const file = event.target.files && event.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = ()=> loadFromText(reader.result);
    reader.readAsText(file);
  }

  function quickSave(){
    localStorage.setItem('SWOOP_STATE_V61', JSON.stringify(getState()));
    showToast('Saved to browser.');
  }

  function quickLoad(){
    const txt = localStorage.getItem('SWOOP_STATE_V61') || localStorage.getItem('SWOOP_STATE_V60');
    if(!txt){
      showToast('No quick save found.');
      return;
    }
    loadFromText(txt);
  }



  /* Rendering helpers */
  function pieceAt(r, step){
    for(let pi=0; pi<game.players.length; pi++){
      const pl=game.players[pi];
      const pc=pl.pieces.find(p=>p.r===r && p.step===step);
      if(pc) return {pi, pc};
    }
    return null;
  }

  function getCellClasses(r, step) {
    const tt = tileTypeAt(r, step);
    const isCp = tt === 'Checkpoint';
    const isDet = tt === 'Deterrent';

    let classes = "mobile-cell swoop-tile";

    if (isCp) {
      classes += " swoop-cp"; // checkpoint color
    } else if (isDet) {
      classes += " swoop-det"; // deterrent color
    }

    // Add highlighting for interactive tiles
    if (shouldHighlightTile(r, step)) {
      classes += " swoop-highlight";
    }

    return classes;
  }

  function shouldHighlightTile(r, step) {
    // Disable highlights for non-acting clients (prevents click affordances)
    if (mp.connected && mp.seat !== game.current) return false;
    // Highlight pieces available for selection
    if (game.mode === 'choosePiece' && game.pieceChoices) {
      return game.pieceChoices.some(p => p.r === r && p.step === step);
    }

    // Highlight eligible pieces for token Swoop selection (not tied to selected pair)
    if (game.mode === 'chooseSwoop') {
      const pl = game.players[game.current];
      const piece = pl.pieces.find(p => p.r === r && p.step === step && p.active);
      return !!(piece && potentialSwoops(piece).length > 0);
    }

    // Highlight swoop destinations
    if (game.mode === 'pickSwoopDest' && game.swoopTargets) {
      return game.swoopTargets.some(t => t.r === r && t.step === step);
    }

    // Highlight top step swoop destinations
    if (game.mode === 'chooseTopStepSwoop' && game.topStepTargets && game.topStepPiece) {
      return game.topStepTargets.some(t => t.r === r && t.step === step);
    }

    // Highlight move destinations (up/down/sideways)
    if (game.mode === 'chooseMoveDest' && game.moveTargets && game.movePiece) {
      return game.moveTargets.some(t => t.r === r && t.step === step);
    }

    // Highlight pieces carrying baskets for transfer source selection
    if (game.mode === 'chooseTransferSource') {
      const pl = game.players[game.current];
      const piece = pl.pieces.find(p => p.r === r && p.step === step);
      return piece && piece.carrying;
    }

    // Highlight valid transfer targets
    if (game.mode === 'chooseTransferTarget' && game.transferTargets) {
      const pl = game.players[game.current];
      const piece = pl.pieces.find(p => p.r === r && p.step === step);
      return piece && game.transferTargets.includes(piece);
    }

    // Highlight valid basket return lanes (last step of even-numbered lanes with pieces)
    if (game.mode === 'chooseBasketReturnLane' && game.basketReturnLanes) {
      const lane = LANES[r];
      return lane && lane.basket && step === lane.L && game.basketReturnLanes.includes(r);
    }

    return false;
  }

  function renderGridCell(r, c) {
    const lane = LANES[r];

    // Left label
    if (c === 0) {
      return (
        <div key={`${r}-${c}`} className="mobile-cell mobile-label">
          {lane.sum}
        </div>
      );
    }

    // Right label
    if (c === COLS - 1) {
      return (
        <div key={`${r}-${c}`} className="mobile-cell mobile-label">
          {lane.sum}
        </div>
      );
    }

    // Center column (shared final step)
    if (c === CENTER_COL) {
      const L = lane.L;
      const step = L; // This is the final step
      const occ = pieceAt(r, step);

      // Determine classes via tile map
      const tt = tileTypeAt(r, step);
      const isCp = tt === 'Checkpoint';
      const isDet = tt === 'Deterrent';

      let classes = "mobile-cell swoop-tile swoop-center";
      if (isCp) classes += " swoop-cp";
      if (isDet) classes += " swoop-det";

      const highlighted = shouldHighlightTile(r, step);
      if (highlighted) classes += " swoop-highlight";

      return (
        <div
          key={`${r}-${c}`}
          className={classes}
          data-r={r}
          data-step={step}
          ref={(el) => { if (el) { tileRefs.current[`${r}-${step}`] = el; } }}
          onClick={highlighted ? () => handleTileClick(r, step, occ) : undefined}
        >
          {/* Step number */}
          <span className="mobile-step-number">{step}</span>

          {/* Basket if present */}
          {game.baskets[r] && lane.basket && (
            <div className="swoop-basket">🧺</div>
          )}
          {occ && (
            <div className={`swoop-piece ${occ.pi === game.current && occ.pc.active ? 'active' : ''} ${occ.pc.carrying ? 'carry' : ''}`} data-player={occ.pi}>
              <span>
                {occ.pi === game.current && occ.pc.active
                  ? game.players[occ.pi].activeIcon
                  : game.players[occ.pi].pieceIcon}
              </span>
              {occ.pc.carrying && (<span className="mobile-carry-indicator">↩</span>)}
              {occ.pi === game.current && occ.pc.active && (<div className="swoop-ring"></div>)}
            </div>
          )}
        </div>
      );
    }

    // Check if this column position corresponds to a game step
    let step = null;
    // Shared-lane cells only on left arc (final handled above)
    for (let k = 1; k < lane.L; k++) {
      if (colForStep('L', k, lane.L) === c) { step = k; break; }
    }

    // If this is a valid game position
    if (step) {
      const occ = pieceAt(r, step);
      const classes = getCellClasses(r, step);
      const isHighlighted = shouldHighlightTile(r, step);

      return (
        <div
          key={`${r}-${c}`}
          className={classes}
          data-r={r}
          data-step={step}
          ref={(el) => { if (el) { tileRefs.current[`${r}-${step}`] = el; } }}
          onClick={isHighlighted ? () => handleTileClick(r, step, occ) : undefined}
        >
          {/* Step number */}
          <span className="mobile-step-number">{step}</span>

          {/* Piece if present */}
          {occ && (
            <div className={`swoop-piece ${occ.pi === game.current && occ.pc.active ? 'active' : ''} ${occ.pc.carrying ? 'carry' : ''}`} data-player={occ.pi}>
              <span>
                {occ.pi === game.current && occ.pc.active
                  ? game.players[occ.pi].activeIcon
                  : game.players[occ.pi].pieceIcon}
              </span>
              {occ.pc.carrying && (
                <span className="mobile-carry-indicator">↩</span>
              )}
              {occ.pi === game.current && occ.pc.active && (
                <div className="swoop-ring"></div>
              )}
            </div>
          )}

          {/* Show slope indicator for odd-lane swoops */}
          {game.mode === 'pickSwoopDest' && game.swoopSource &&
           LANES[game.swoopSource.r].sum % 2 === 1 &&
           game.swoopSource.step === LANES[game.swoopSource.r].L - 1 &&
           game.swoopTargets && game.swoopTargets.some(t => t.r === r && t.step === step) && (
            <div className="absolute top-0 left-0 text-xs text-gray-700">
              {oddSlope[LANES[game.swoopSource.r].sum] === 1 ? '↑' : '↓'}
            </div>
          )}
        </div>
      );
    }

    // Empty cell
    return <div key={`${r}-${c}`} className="mobile-cell"></div>;
  }

  const pl=game.players[game.current];

  // AAA Connectors overlay using measured tile centers
  function ConnectorsOverlay() {
    const [overlay, setOverlay] = React.useState({ width: 0, height: 0, segments: [] });

    React.useEffect(() => {
      function compute() {
        const container = gridRef.current;
        if (!container) {
          setOverlay({ width: 0, height: 0, segments: [] });
          return;
        }
        const contRect = container.getBoundingClientRect();
        const infoCache = new Map();
        const tileInfo = (r, s) => {
          const key = `${r}-${s}`;
          if (infoCache.has(key)) return infoCache.get(key);
          const el = tileRefs.current[key];
          if (!el) return null;
          const b = el.getBoundingClientRect();
          const info = {
            cx: b.left + b.width / 2 - contRect.left,
            cy: b.top + b.height / 2 - contRect.top,
            rx: b.width / 2,
            ry: b.height / 2
          };
          infoCache.set(key, info);
          return info;
        };
        const segs = [];
        for (let r = 0; r < ROWS; r++) {
          const L = LANES[r].L;
          for (let s = 1; s <= L; s++) {
            if (!tileExistsAt(r, s)) continue;
            // Draw to both neighbors (r-1 and r+1) for a complete graph
            for (const dr of [-1, +1]) {
              const r2 = r + dr;
              if (r2 < 0 || r2 >= ROWS) continue;
              let s2;
              if (s === L) {
                s2 = LANES[r2].L;
              } else {
                const space = mapStepToGrid(r, s);
                s2 = stepForSpace(r2, space);
              }
              if (s2 && tileExistsAt(r2, s2)) {
                const a = tileInfo(r, s);
                const b = tileInfo(r2, s2);
                if (a && b) {
                  const dx = b.cx - a.cx;
                  const dy = b.cy - a.cy;
                  const dist = Math.hypot(dx, dy) || 1;
                  const normX = dx / dist;
                  const normY = dy / dist;
                  const baseA = Math.min(a.rx, a.ry);
                  const baseB = Math.min(b.rx, b.ry);
                  let insetA = baseA + Math.min(baseA * 0.45, 14);
                  let insetB = baseB + Math.min(baseB * 0.45, 14);
                  const maxTotal = Math.max(dist - 6, 0);
                  const desiredTotal = insetA + insetB;
                  if (desiredTotal > 0 && maxTotal < desiredTotal) {
                    const scale = maxTotal / desiredTotal;
                    insetA *= scale;
                    insetB *= scale;
                  }
                  const startX = a.cx + normX * insetA;
                  const startY = a.cy + normY * insetA;
                  const endX = b.cx - normX * insetB;
                  const endY = b.cy - normY * insetB;
                  segs.push({ x1: startX, y1: startY, x2: endX, y2: endY, key: `${r}-${s}->${r2}-${s2}` });
                }
              }
            }
          }
        }
        setOverlay({ width: contRect.width, height: contRect.height, segments: segs });
      }
      // Compute after layout paints to avoid partial refs on desktop
      const raf1 = requestAnimationFrame(() => {
        const raf2 = requestAnimationFrame(compute);
        // store to cleanup
        (compute)._raf2 = raf2;
      });
      window.addEventListener('resize', compute);
      return () => {
        window.removeEventListener('resize', compute);
        cancelAnimationFrame(raf1);
        if ((compute)._raf2) cancelAnimationFrame((compute)._raf2);
      };
      // Recompute when game state changes (safe, cheap)
    }, [game]);

    const width = Math.max(overlay.width, 1);
    const height = Math.max(overlay.height, 1);

    return (
      <svg
        className="aaa-connectors"
        style={{ width: '100%', height: '100%' }}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
      >
        {overlay.segments.map(l => (
          <line key={l.key} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
        ))}
      </svg>
    );
  }

  // AAA lane numbers next to the final column
  function FinalLaneLabels() {
    const [labels, setLabels] = React.useState([]);

    React.useEffect(() => {
      function compute() {
        const container = gridRef.current;
        if (!container) {
          setLabels([]);
          return;
        }
        const contRect = container.getBoundingClientRect();
        const items = [];
        for (let r = 0; r < ROWS; r++) {
          const finalStep = LANES[r].L;
          const el = tileRefs.current[`${r}-${finalStep}`];
          if (!el) continue;
          const rect = el.getBoundingClientRect();
          const offset = Math.min(rect.width * 0.3, 28);
          const rawLeft = rect.right - contRect.left + offset;
          const cappedLeft = Math.min(rawLeft, contRect.width - 44);
          const left = Math.max(cappedLeft, rect.right - contRect.left + 6);
          items.push({
            key: `final-${r}`,
            left,
            top: rect.top + rect.height / 2 - contRect.top,
            sum: LANES[r].sum
          });
        }
        setLabels(items);
      }
      const raf1 = requestAnimationFrame(() => {
        const raf2 = requestAnimationFrame(compute);
        (compute)._raf2 = raf2;
      });
      window.addEventListener('resize', compute);
      return () => {
        window.removeEventListener('resize', compute);
        cancelAnimationFrame(raf1);
        if ((compute)._raf2) cancelAnimationFrame((compute)._raf2);
      };
    }, [game]);

    if (!labels.length) return null;

    return (
      <div className="aaa-final-lane-labels">
        {labels.map(label => (
          <div
            key={label.key}
            className="aaa-final-lane-label"
            style={{ left: label.left, top: label.top }}
          >
            {label.sum}
          </div>
        ))}
      </div>
    );
  }

  // Derived paging values for event log (5 per page)
  const eventsStartIndex = Math.max(0, eventPage * MAX_EVENT_ROWS);
  const visibleEvents = events.slice(eventsStartIndex, eventsStartIndex + MAX_EVENT_ROWS);
  const canPrevEvents = eventsStartIndex + MAX_EVENT_ROWS < events.length;
  const canNextEvents = eventPage > 0;

  const currentPlayer = game.players[game.current];
  const isBotTurn = !!(currentPlayer && currentPlayer.isBot);
  const botActionReady = isBotTurn && shouldProcessBot();
  const mustMoveThisRoll = (game.mode === 'rolled' || game.mode === 'pairChosen') && anyMandatoryActionThisRoll();

  return (
    <div className="mobile-game-container" style={{background: 'var(--bg)'}}>
      {showCover && (
        <div
          className="aaa-intro-cover"
          onClick={() => setShowCover(false)}
          onTouchStart={() => setShowCover(false)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setShowCover(false);
            }
          }}
          aria-label="Enter game"
        >
          <img src="/RnD/cover4.png" alt="Swoop cover" aria-hidden="true" />
        </div>
      )}
      {/* Multiplayer Controls */}
      <div className="aaa-mp-bar" style={{ display:'flex', gap:8, alignItems:'center', padding:'6px 8px', background:'#111', color:'#eee', flexWrap:'wrap' }}>
        {!mp.connected ? (
          <>
            <span style={{opacity:0.85}}>Multiplayer:</span>
            <input
              value={mpName}
              onChange={(e)=>setMpName(e.target.value)}
              placeholder="Your name"
              style={{ padding:'6px 8px', borderRadius:6, border:'1px solid #333', background:'#181818', color:'#eee' }}
              disabled={!isOnline || mp.joining}
            />
            <input
              value={mpCodeInput}
              onChange={(e)=>setMpCodeInput(e.target.value)}
              placeholder="Room code (e.g. 123456)"
              style={{ padding:'6px 8px', borderRadius:6, border:'1px solid #333', background:'#181818', color:'#eee' }}
              disabled={!isOnline || mp.joining}
            />
            <select
              value={mpPreferredSeat}
              onChange={(e)=>setMpPreferredSeat(e.target.value)}
              style={{ padding:'6px 8px', borderRadius:6, border:'1px solid #333', background:'#181818', color:'#eee' }}
              disabled={!isOnline || mp.joining}
            >
              <option value="">Seat (auto)</option>
              {game.players.map((player, idx) => (
                <option key={player.profile || idx} value={idx}>{`${idx + 1}: ${player.name}`}</option>
              ))}
            </select>
            <button className="mobile-button" onClick={mpDoJoin} disabled={mp.joining || !isOnline}>Join</button>
            <button className="mobile-button" onClick={mpDoCreate} disabled={mp.joining || !isOnline}>Create</button>
            {!isOnline && (
              <span style={{color:'#fcd34d'}}>Offline mode — multiplayer disabled</span>
            )}
            {mp.error && <span style={{color:'#f88'}}>{mp.error}</span>}
          </>
        ) : (
          <>
            <span>Room: <b>{mp.code}</b></span>
            <span>Seat: {seatLabel(mp.seat)}</span>
            <span>Version: {mp.version}</span>
            <button className="mobile-button" onClick={mpDisconnect}>Disconnect</button>
          </>
        )}
      </div>
      {/* Mobile Header - Compact */}
      <div className="mobile-header">
        <div className="mobile-title">
          <h1>Swoop</h1>
          <div className="mobile-scores">
            {game.players.map((player, idx) => (
              <div key={player.profile || idx} className={`mobile-score ${game.current === idx ? 'active-player' : ''}`}>
                <span>{player.badgeIcon || PLAYER_PROFILES[idx]?.badgeIcon || `P${idx + 1}`}</span>
                <span>{player.score}</span>
                <span style={{marginLeft: 8}}>✈️ {player.swoopTokens || 0}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Status Message - Mobile */}
        <div className="mobile-status">
          {game.message}
        </div>
      </div>

      {/* Main Mobile Layout - Horizontal Split */}
      <div className="mobile-main-layout">
        {/* Left Side - Game Board */}
        <div className="mobile-board-container">
          <div className="swoop-board mobile-board">
            {/* AAA connectors and overlays */}
            {typeof document !== 'undefined' && document.body.classList.contains('skin-aaa') && (
              <>
                <ConnectorsOverlay />
                <FinalLaneLabels />
              </>
            )}
            {/* Game Board Grid */}
            <div
              className="mobile-grid"
              style={{
                gridTemplateColumns: `repeat(${COLS}, 1fr)`,
                gridAutoRows: '1fr'
              }}
              ref={gridRef}
            >
              {Array.from({ length: ROWS }, (_, r) =>
                Array.from({ length: COLS }, (_, c) => renderGridCell(r, c))
              )}
            </div>
          </div>
        </div>

        {/* Right Side - Controls and Info */}
        <div className="mobile-controls-container">
          {/* Primary Action Buttons (hidden for non-acting clients) */}
          {mpCanAct() && (
            <div className="mobile-primary-controls">
              {isBotTurn ? (
                <button
                  className="mobile-button primary active"
                  onClick={handleBotPlay}
                  disabled={!botActionReady}
                  title={botActionReady ? 'Advance bot turn' : 'Bot not ready'}
                >
                  ▶ Play
                </button>
              ) : (
                <>
                  {game.mode === 'preroll' && (
                    <button
                      className="mobile-button primary active"
                      onClick={roll}
                      disabled={game.mode !== 'preroll' || game.mode === 'gameOver' || !mpCanAct()}
                    >
                      🎲 Roll
                    </button>
                  )}
                  {/* Legacy Move button hidden; use per-sum ↑/↓ controls instead */}
                  {!mustMoveThisRoll && (
                    <button
                      className="mobile-button"
                      onClick={useSwoop}
                      disabled={game.mode === 'gameOver' || !mpCanAct() || !canSwoopNow()}
                    >
                      🔄 Swoop Token
                    </button>
                  )}
                  <button
                    className="mobile-button"
                    onClick={startTransfer}
                    disabled={game.mode === 'gameOver' || !mpCanAct() || !canTransfer()}
                  >
                    🔄 Transfer
                  </button>
                  <button
                    className="mobile-button"
                    onClick={bankOrBust}
                    disabled={(() => {
                      if (game.mode === 'gameOver') return true;
                      if (!mpCanAct()) return true;
                      if (game.mode === 'preroll') return false;
                      if (game.mode === 'rolled' || game.mode === 'pairChosen') {
                        return mustMoveThisRoll;
                      }
                      return true;
                    })()}
                  >
                    {(() => {
                      if (game.mode === 'preroll') return '🏦 Bank';
                      if (game.mode === 'rolled' || game.mode === 'pairChosen') {
                        if (mustMoveThisRoll) return '❌ Must Move';
                        // During a roll with no legal moves, only Bust is allowed
                        return '💥 Bust';
                      }
                      return '🏦 Bank';
                    })()}
                  </button>
                </>
              )}
            </div>
          )}

          {/* Transfer Cancel Button */}
          {mpCanAct() && (game.mode === 'chooseTransferSource' || game.mode === 'chooseTransferTarget') && (
            <div className="mobile-transfer-cancel">
              <button
                className="mobile-button"
                onClick={cancelTransfer}
              >
                ❌ Cancel Transfer
              </button>
            </div>
          )}

          {/* Dice and Pairings - Mobile Layout (Can't Stop style) */}
          {game.rolled && (
            <div className="mobile-dice-section">
              <div className="mobile-dice-container">
                {game.rolled.d.map((v, i) => (
                  <div key={i} className="mobile-die">{v}</div>
                ))}
              </div>
              <div className="mobile-pairs-container">
                {/* Show options grouped by pairing; each row renders both sums with their own ↑/↓ */}
                {game.rolled.pairings && computeUiMoveRows().map((opt, i) => {
                  const selected = !!(game.pendingAdvances && game.pendingAdvances.length>0 && game.selectedPair && opt.sums.includes(game.selectedPair.sum));
                  const pl = game.players[game.current];
                  return (
                    <div key={`${opt.type}:${opt.sums.join(',')}`} className={`mobile-pair ${selected ? 'selected' : ''}`} title={opt.title || ''}>
                      <div style={{ display:'flex', alignItems:'center', width:'100%', justifyContent:'space-between', columnGap:8, rowGap:7, flexWrap:'wrap' }}>
                        {opt.sums.map((sum, idx) => {
                          const upEnabled = directionalCandidatesForSum(pl, sum, 'up').length > 0;
                          const downEnabled = directionalCandidatesForSum(pl, sum, 'down').length > 0;
                          const leftEnabled = sidewaysCandidatesForSum(pl, sum, 'left').length > 0;
                          const rightEnabled = sidewaysCandidatesForSum(pl, sum, 'right').length > 0;
                          const columnMeta = opt.singleDetails && opt.singleDetails[idx];
                          const columnTitle = columnMeta?.reason
                            ? `${columnMeta.sum}: ${columnMeta.reason}`
                            : (columnMeta?.title || opt.title || '');
                          return (
                            <React.Fragment key={`sumcol-${sum}-${idx}`}>
                              <div
                                style={{ display:'flex', alignItems:'center', columnGap:5, rowGap:4, flexWrap:'wrap' }}
                                title={columnTitle || undefined}
                              >
                                <div className="pair-sum">{sum}</div>
                                {mpCanAct() && (
                                <div className="pair-actions" style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                                  <button
                                    className="mobile-button primary"
                                    disabled={!upEnabled || !mpCanAct()}
                                    onClick={() => quickMove(sum, 'up')}
                                    title={`Move ${sum} Up`}
                                  >↑</button>
                                  <button
                                    className="mobile-button ghost"
                                    disabled={!downEnabled || !mpCanAct()}
                                    onClick={() => quickMove(sum, 'down')}
                                    title={`Move ${sum} Down`}
                                  >↓</button>
                                  {/* Sideways arrows appear only when applicable (top-step free swoop). */}
                                  {leftEnabled && (
                                    <button
                                      className="mobile-button ghost"
                                      disabled={!mpCanAct()}
                                      onClick={() => quickMove(sum, 'left')}
                                      title={`Move ${sum} Sideways (Left)`}
                                    >←</button>
                                  )}
                                  {rightEnabled && (
                                    <button
                                      className="mobile-button ghost"
                                      disabled={!mpCanAct()}
                                      onClick={() => quickMove(sum, 'right')}
                                      title={`Move ${sum} Sideways (Right)`}
                                    >→</button>
                                  )}
                                </div>
                                )}
                              </div>
                              {opt.variant === 'either' && idx === 0 && opt.sums.length > 1 && (
                                <div className="pair-divider">or</div>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </div>
                      {opt.reason && (
                        <div className="pair-reason">{opt.reason}</div>
                      )}
                    </div>
                  );
                })}
                {!game.rolled.pairings && game.rolled.pairs && game.rolled.pairs.map((p, i) => (
                  <div key={i} className={`mobile-pair`} onClick={() => showToast('Legacy save: roll once to continue.') }>
                    <div className="pair-sum">{p.sum}</div>
                    <div className="pair-calc">{game.rolled.d[p.i]}+{game.rolled.d[p.j]}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* AAA: Status card replacing Quick Guide */}
          <div className="aaa-status">
            <div className="aaa-status-row">
              <div><strong>Player:</strong> {game.players[game.current].name}</div>
              <div><strong>✈️</strong> {game.players[game.current].swoopTokens || 0}</div>
            </div>
            <div className="aaa-status-row small">{game.message}</div>
            <div className="aaa-status-row" style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
              {game.players.map((player, idx) => (
                <div key={player.profile || idx} style={{ display:'flex', gap:4, alignItems:'center' }}>
                  <span>{player.badgeIcon || PLAYER_PROFILES[idx]?.badgeIcon || `P${idx + 1}`}</span>
                  <span>{player.score}</span>
                  <span>• ✈️ {player.swoopTokens || 0}</span>
                  {player.isBot ? <span>• 🤖</span> : null}
                </div>
              ))}
            </div>
            <div className="aaa-status-row">
              <button className="mobile-button-small" onClick={() => {
                const vis = !roomVisible; setRoomVisible(vis);
                try { document.body.classList.toggle('aaa-room-visible', vis); } catch(_){}
              }}>🔗 Room</button>
            </div>
          </div>

          {/* Secondary Controls */}
          <div className="mobile-secondary-controls">
            <button className="mobile-button-small" onClick={openNewGameModal}>🔄 New</button>
            <button className="mobile-button-small" onClick={undo}>↩️ Undo</button>
            <button className="mobile-button-small" onClick={saveToFile}>💾 Save</button>
            <button className="mobile-button-small" onClick={openLoadModal}>📁 Load</button>
            <button className="mobile-button-small" onClick={quickSave}>⚡ Quick Save</button>
            <button className="mobile-button-small" onClick={quickLoad}>⚡ Quick Load</button>
          </div>

          <div className="event-log-container">
            <div className="event-log-header">
              <span>Recent Events</span>
              <button
                className="mobile-button-small"
                onClick={() => setLogVisible(v => !v)}
              >
                {logVisible ? 'Hide' : 'Show'}
              </button>
            </div>
            {logVisible && (
              <div className="event-log-table">
                {events.length === 0 ? (
                  <div className="event-log-empty">No events yet.</div>
                ) : (
                  <>
                    <table>
                      <thead>
                        <tr>
                          <th style={{ width: '50px' }}>Tokens</th>
                          <th>Event</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleEvents.map(entry => (
                          <tr key={entry.id}>
                            <td>{entry.playerStats || ''}</td>
                            <td>{entry.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:6 }}>
                      <div style={{ fontSize:'0.8rem', opacity:0.8 }}>
                        Showing {Math.min(eventsStartIndex + 1, events.length)}–{Math.min(eventsStartIndex + visibleEvents.length, events.length)} of {events.length}
                      </div>
                      <div style={{ display:'flex', gap:6 }}>
                        <button
                          className="mobile-button-small"
                          disabled={!canPrevEvents}
                          onClick={() => setEventPage(p => p + 1)}
                          title="Older events"
                        >◀ Prev 5</button>
                        <button
                          className="mobile-button-small"
                          disabled={!canNextEvents}
                          onClick={() => setEventPage(p => Math.max(0, p - 1))}
                          title="Newer events"
                        >Next 5 ▶</button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile Toast Notification */}
      {toast && (
        <div className="mobile-toast">
          {toast}
        </div>
      )}

      {/* New Game Modal */}
      {showNewGameModal && (
        <div className="mobile-modal-overlay">
          <div className="mobile-modal">
            <h3 className="mobile-modal-title">Start New Game</h3>
            <p className="mobile-modal-text">Select number of players:</p>
            <div className="mobile-modal-buttons" style={{ display:'flex', gap:8, marginBottom:12 }}>
              {[2,3,4].map(count => (
                <button
                  key={count}
                  className={`mobile-button${count === pendingPlayerCount ? ' primary' : ''}`}
                  onClick={() => setPendingPlayerCount(count)}
                >
                  {count} Players
                </button>
              ))}
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:12 }}>
              {Array.from({ length: pendingPlayerCount }).map((_, idx) => {
                const profile = PLAYER_PROFILES[idx];
                const isBot = !!pendingBotSeats[idx];
                const botType = pendingBotTypes[idx] || DEFAULT_BOT_TYPE;
                const botTypeLabel = BOT_TYPE_LABEL[botType] || botType;
                return (
                  <div
                    key={`bot-seat-${idx}`}
                    style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12 }}
                  >
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <span style={{ fontSize:'1.1rem' }}>{profile?.badgeIcon || `P${idx + 1}`}</span>
                      <strong>{profile?.defaultName || `Player ${idx + 1}`}</strong>
                    </div>
                    <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                      <button
                        className={`mobile-button-small${isBot ? ' primary' : ''}`}
                        onClick={() => togglePendingBotSeat(idx)}
                      >
                        {isBot ? 'Bot' : 'Human'}
                      </button>
                      {isBot && (
                        <button
                          className="mobile-button-small"
                          onClick={() => cyclePendingBotType(idx)}
                          title="Cycle bot strategy"
                        >
                          {`Strategy: ${botTypeLabel}`}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mobile-modal-buttons">
              <button className="mobile-button-small" onClick={cancelNewGameModal}>Cancel</button>
              <button className="mobile-button primary" onClick={confirmNewGame}>Start</button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Load Modal */}
      {showLoadModal && (
        <div className="mobile-modal-overlay">
          <div className="mobile-modal">
            <h3 className="mobile-modal-title">Load Game</h3>
            <p className="mobile-modal-text">
              Paste saved JSON or choose file:
            </p>
            <textarea
              className="mobile-modal-textarea"
              placeholder='{"version":"v5.2",...}'
              value={loadText}
              onChange={(e) => setLoadText(e.target.value)}
            />
            <div className="mobile-modal-controls">
              <input
                type="file"
                accept="application/json"
                onChange={handleFileLoad}
                className="mobile-file-input"
              />
              <div className="mobile-modal-buttons">
                <button
                  className="mobile-button-small"
                  onClick={closeLoadModal}
                >
                  Cancel
                </button>
                <button
                  className="mobile-button primary"
                  onClick={confirmLoad}
                >
                  Load
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
