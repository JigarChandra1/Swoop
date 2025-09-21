/*
  Swoop — Headless Simulation
  - Two non-reactive bots play to a target score
  - Configurable rounds and target score
  - Records ~10 key metrics per run and prints a summary

  Usage:
    node src/sim/simulate.js --rounds=100 --target=5 --seed=42
*/

// --- Core board constants & helpers (copied from UI logic) ---
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

function checkpoints(L) {
  const out = [2];
  if (L >= 6) out.push(4);
  out.push(L - 1);
  return [...new Set(out)].filter((x) => x >= 1 && x < L);
}

function deterrents(L, sum) {
  if (L <= 3) return [];
  const det = [3, L - 2];
  if ((sum === 6 || sum === 8) && L >= 5) det.push(5);
  const cps = checkpoints(L);
  return [...new Set(det)].filter((x) => x >= 1 && x <= L && !cps.includes(x));
}

const oddSlope = { 3: +1, 5: -1, 7: -1, 9: -1, 11: +1 };

// Geometric Board Layout (documentation)
// Geometry spaces (1..11) per lane can be gaps; movement steps are only on real tiles.
// TILE_MAP is the source of truth for tile types by space; helper functions map between steps and spaces.
// Swoops space‑match across adjacent lanes; pushes snap‑down into gaps and transfer baskets to the pusher.
// Geometry map (11-step grid per lane)
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
  const L = LANES[r].L; if(L<=1) return 1;
  return 1 + Math.round((step-1)*(MAX_STEP-1)/(L-1));
}
function tileTypeAt(r, step){
  const gs = Math.max(1, Math.min(MAX_STEP, mapStepToGrid(r, step)));
  return TILE_MAP[r][gs-1] || 'Gap';
}
function tileExistsAt(r, step){ return tileTypeAt(r, step) !== 'Gap'; }
function tileTypeAtSpace(r, space){
  const gs = Math.max(1, Math.min(MAX_STEP, space));
  return TILE_MAP[r][gs-1] || 'Gap';
}
function snapDownSpace(r, space){
  let sp = Math.max(1, Math.min(MAX_STEP, space));
  while (sp >= 1 && tileTypeAtSpace(r, sp) === 'Gap') sp--;
  return sp;
}

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



// --- RNG with optional seed for reproducibility ---
function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(seed) {
  if (seed === undefined || seed === null) return Math.random;
  const s = typeof seed === 'number' ? seed >>> 0 : hashStr(seed);
  return mulberry32(s);
}

function hashStr(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 4;
const PLAYER_PROFILES = [
  { key: 'monkeys', name: 'Bot Monkeys', badge: '🐒', piece: '🐒', active: '🐵' },
  { key: 'seagulls', name: 'Bot Seagulls', badge: '🕊️', piece: '🕊️', active: '🦅' },
  { key: 'crabs', name: 'Bot Crabs', badge: '🦀', piece: '🦀', active: '🦀' },
  { key: 'turtles', name: 'Bot Turtles', badge: '🐢', piece: '🐢', active: '🐢' }
];

function normalizePlayerCount(count) {
  const n = Number(count);
  if (!Number.isFinite(n)) return MIN_PLAYERS;
  return Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, Math.round(n)));
}

function buildPlayers(count) {
  const clamped = normalizePlayerCount(count);
  return PLAYER_PROFILES.slice(0, clamped).map((profile, idx) => ({
    id: idx,
    profile: profile.key,
    name: profile.name,
    badgeIcon: profile.badge,
    pieceIcon: profile.piece,
    activeIcon: profile.active,
    score: 0,
    swoopTokens: idx === clamped - 1 ? 1 : 0,
    pieces: [],
  }));
}

function enforceTokenPolicy(players, _count) {
  players.forEach((pl) => {
    const val = Number(pl.swoopTokens ?? 0);
    pl.swoopTokens = Math.max(0, Math.min(2, Number.isNaN(val) ? 0 : val));
  });
}

function nextSeatIndex(current, count) {
  return (current + 1) % count;
}

// --- Game state helpers ---
function initialGame(playerCount = MIN_PLAYERS) {
  const count = normalizePlayerCount(playerCount);
  const players = buildPlayers(count);
  enforceTokenPolicy(players, count);
  return {
    playerCount: count,
    players,
    current: 0,
    baskets: LANES.map((l) => l.basket),
    moveHistory: [], // Track all moves for analysis
    transferSource: null,
    transferTargets: null
  };
}

function occupied(game, r, step) {
  // Shared-lane occupancy across both players
  for (const pl of game.players) {
    if (pl.pieces.some((pc) => pc.r === r && pc.step === step)) return true;
  }
  return false;
}

function pieceOnLane(pl, r) {
  return pl.pieces.find((p) => p.r === r) || null;
}

function activeCount(pl) {
  return pl.pieces.filter((p) => p.active).length;
}

function ensurePieceForSum(game, pl, sum) {
  const r = LANES.findIndex((x) => x.sum === sum);
  if (r < 0) return null;

  // Get all pieces on this route
  const piecesOnRoute = pl.pieces.filter((p) => p.r === r);

  if (piecesOnRoute.length > 0) {
    // Get all viable pieces (active pieces that can move + inactive pieces that can be activated and move)
    const viablePieces = [];

    // Check active pieces that can move
    const activePieces = piecesOnRoute.filter(p => p.active);
    for (const pc of activePieces) {
      const L = LANES[pc.r].L;
      if (pc.step === L) {
        // Top step pieces can always be "activated" (even if already active)
        viablePieces.push(pc);
      } else {
        const targets = moveTargets(game, pc);
        if (targets.length > 0) {
          viablePieces.push(pc);
        }
      }
    }

    // Check inactive pieces that can be activated (if under the 2-piece limit)
    if (activeCount(pl) < 2) {
      const inactivePieces = piecesOnRoute.filter(p => !p.active);
      for (const pc of inactivePieces) {
        const L = LANES[pc.r].L;
        if (pc.step === L) {
          // Top step pieces can always be activated
          viablePieces.push(pc);
        } else {
          const targets = moveTargets(game, pc);
          if (targets.length > 0) {
            viablePieces.push(pc);
          }
        }
      }
    }

    // If multiple viable pieces, choose using heuristic
    if (viablePieces.length > 1) {
      return chooseBestPiece(viablePieces);
    } else if (viablePieces.length === 1) {
      const pc = viablePieces[0];
      const L = LANES[pc.r].L;

      if (pc.step === L) {
        return ensureTopStepPiece(game, pl, pc);
      }

      // Activate if not already active
      if (!pc.active && activeCount(pl) < 2) {
        pc.active = true;
        // Log piece activation
        game.moveHistory.push({
          type: 'activate',
          player: game.current,
          piece: { r: pc.r, step: pc.step },
          turn: game.moveHistory.filter(m => m.type === 'turn_start').length
        });
      }
      return pc;
    }

    // No viable pieces
    return null;
  }

  // No pieces on route - try to spawn a new piece
  if (pl.pieces.length >= 5 || activeCount(pl) >= 2) return null;
  if (occupied(game, r, 1)) return null;
  const pc = { r, step: 1, carrying: false, active: true };
  pl.pieces.push(pc);
  // Log piece spawn
  game.moveHistory.push({
    type: 'spawn',
    player: game.current,
    piece: { r: pc.r, step: pc.step },
    sum: sum,
    turn: game.moveHistory.filter(m => m.type === 'turn_start').length
  });
  return pc;
}

// Choose the best piece from multiple viable options using heuristic
function chooseBestPiece(viablePieces) {
  // Prioritize pieces that are already active
  const activePieces = viablePieces.filter(p => p.active);
  if (activePieces.length > 0) {
    // Among active pieces, prefer those closer to the top (higher step)
    activePieces.sort((a, b) => b.step - a.step);
    return activePieces[0];
  }

  // If no active pieces, choose inactive piece closest to top
  viablePieces.sort((a, b) => b.step - a.step);
  return viablePieces[0];
}

// Handle pieces at top step with multiple options
function ensureTopStepPiece(game, pl, pc) {
  // First, try to activate if not already active
  if (!pc.active && activeCount(pl) < 2) {
    pc.active = true;
    // Log piece activation
    game.moveHistory.push({
      type: 'activate',
      player: game.current,
      piece: { r: pc.r, step: pc.step },
      turn: game.moveHistory.filter(m => m.type === 'turn_start').length
    });
  }
  return pc;
}



function canMoveOnSum(game, pl, sum) {
  const r = LANES.findIndex((x) => x.sum === sum);
  if (r < 0) return false;

  // Get all pieces on this route
  const piecesOnRoute = pl.pieces.filter((p) => p.r === r);

  if (piecesOnRoute.length > 0) {
    // Check if any piece on this route can move
    // First check active pieces, then inactive pieces
    const activePieces = piecesOnRoute.filter(p => p.active);
    const inactivePieces = piecesOnRoute.filter(p => !p.active);

    // Check active pieces first - they can move if not blocked
    for (const pc of activePieces) {
      const L = LANES[pc.r].L;
      if (pc.step === L) {
        const targets = moveTargets(game, pc);
        if (targets.length > 0) return true;
        if (canTopStepActivate(game, pl, pc)) return true;
      } else {
        const targets = moveTargets(game, pc);
        if (targets.length > 0) return true;
      }
    }

    // Check inactive pieces - they can move if they can be activated first
    if (activeCount(pl) < 2) {
      for (const pc of inactivePieces) {
        const L = LANES[pc.r].L;
        if (pc.step === L) {
          const targets = moveTargets(game, pc);
          if (targets.length > 0) return true;
          if (canTopStepActivate(game, pl, pc)) return true;
        } else {
          const targets = moveTargets(game, pc);
          if (targets.length > 0) return true;
        }
      }
    }

    return false;
  } else {
    // No pieces on route - check if we can spawn a new piece
    return pl.pieces.length < 5 && !occupied(game, r, 1) && activeCount(pl) < 2;
  }
}

// Check if a piece at top step can be activated
function canTopStepActivate(game, pl, pc) {
  return !pc.active && activeCount(pl) < 2;
}

// Check if a piece at top step can move down (especially useful when carrying)
function canTopStepMoveDown(game, pc) {
  const L = LANES[pc.r].L;
  if (pc.step !== L) return false;
  const downStep = L - 1;
  return downStep >= 1; // Push model allows moving into occupied
}

// Check if a piece at top step can do a free swoop to adjacent lanes
function canTopStepFreeSwoop(game, pc) {
  if (pc.step !== LANES[pc.r].L) return false;
  return potentialTopStepSwoops(game, pc).length > 0;
}

// Get potential swoop targets for a piece at top step (free swoop)
function potentialTopStepSwoops(game, pc) {
  const targets = [];
  const r = pc.r;
  const L = LANES[r].L;

  if (pc.step !== L) return targets; // Only for pieces at top step

  for (const dr of [-1, +1]) {
    const r2 = r + dr;
    if (r2 < 0 || r2 >= LANES.length) continue;

    // For top step free swoop, piece can go to top step of adjacent lanes
    const step2 = LANES[r2].L;
    if (tileExistsAt(r2, step2)) targets.push({ r: r2, step: step2 });
  }
  return targets;
}

// Get potential move destinations for a piece (up, down, and sideways if at top step)
function moveTargets(game, pc) {
  const targets = [];
  const L = LANES[pc.r].L;

  // Up
  const up = pc.step + 1;
  if (up <= L && tileExistsAt(pc.r, up)) {
    targets.push({ r: pc.r, step: up });
  }

  // Down
  const down = pc.step - 1;
  if (down >= 1 && tileExistsAt(pc.r, down)) {
    targets.push({ r: pc.r, step: down });
  }

  // Sideways from top step
  if (pc.step === L) {
    for (const dr of [-1, +1]) {
      const r2 = pc.r + dr;
      if (r2 < 0 || r2 >= LANES.length) continue;
      const step2 = LANES[r2].L;
      if (tileExistsAt(r2, step2)) targets.push({ r: r2, step: step2 });
    }
  }
  return targets;
}

function afterMovePickup(game, pc) {
  const lane = LANES[pc.r];
  const L = lane.L;
  if (lane.basket && game.baskets[pc.r] && pc.step === L && !pc.carrying) {
    pc.carrying = true;
    game.baskets[pc.r] = false;
    return true;
  }
  return false;
}

function returnBasketToTop(game, r){
  if(!LANES[r].basket) return;
  game.baskets[r] = true;
}

function applyPushChain(game, origin, dest, pusher, _isSwoop = false){
  // Same-lane pushes use step delta; cross-lane pushes use geometric spaces
  const originSpace = mapStepToGrid(origin.r, origin.step);
  const destSpace   = mapStepToGrid(dest.r, dest.step);
  const dr = dest.r - origin.r;
  const dsSteps = dest.step - origin.step;
  const dSpace = destSpace - originSpace;
  if ((dr===0 && dsSteps===0) || (dr!==0 && dSpace===0)) return;
  // find occupant at dest
  let occPi=-1, occPc=null;
  for(let pi=0; pi<game.players.length; pi++){
    const pc = game.players[pi].pieces.find(p=>p.r===dest.r && p.step===dest.step);
    if(pc){ occPi=pi; occPc=pc; break; }
  }
  if(!occPc) return;
  const r2 = dest.r + dr;
  // Basket transfer on push
  if(occPc.carrying && pusher && !pusher.carrying){ pusher.carrying = true; occPc.carrying = false; }
  if(r2 < 0 || r2 >= LANES.length){
    const owner = game.players[occPi];
    owner.pieces = owner.pieces.filter(p=>p!==occPc);
    return;
  }
  let s2;
  if (dr === 0) {
    // Same-lane push: move by step delta; if it overflows lane bounds, remove pushed piece
    const L2 = LANES[r2].L;
    const candidate = dest.step + dsSteps;
    if (candidate < 1 || candidate > L2) {
      const owner = game.players[occPi];
      owner.pieces = owner.pieces.filter(p=>p!==occPc);
      return;
    }
    s2 = candidate;
  } else {
    // Compute target space for pushed piece
    let targetSpace = destSpace + dSpace;
    targetSpace = Math.max(1, Math.min(MAX_STEP, targetSpace));
    // If that space is a gap, snap down along spaces
    let landedSpace = tileTypeAtSpace(r2, targetSpace) === 'Gap' ? snapDownSpace(r2, targetSpace) : targetSpace;
    if(landedSpace < 1){
      const owner = game.players[occPi];
      owner.pieces = owner.pieces.filter(p=>p!==occPc);
      return;
    }
    s2 = stepForSpace(r2, landedSpace);
  }
  applyPushChain(game, dest, { r: r2, step: s2 }, occPc);
  occPc.r = r2; occPc.step = s2;
}

function performMoveWithPush(game, pc, target, isSwoop = false){
  const origin = { r: pc.r, step: pc.step };
  applyPushChain(game, origin, target, pc, isSwoop);
  pc.r = target.r; pc.step = target.step;
  afterMovePickup(game, pc);
}

function advanceOne(game, pc) {
  const L = LANES[pc.r].L;
  const dir = pc.carrying ? -1 : +1;
  const oldStep = pc.step;
  const ns = pc.step + dir;
  if (ns >= 1 && ns <= L) {
    performMoveWithPush(game, pc, { r: pc.r, step: ns });
    // Log piece movement
    game.moveHistory.push({
      type: 'move',
      player: game.current,
      piece: { r: pc.r, from: oldStep, to: ns },
      carrying: pc.carrying,
      turn: game.moveHistory.filter(m => m.type === 'turn_start').length
    });
    return true;
  }
  return false;
}

// Transfer functionality for simulation
function canTransfer(game, pl) {
  return pl.pieces.some(pc => pc.carrying);
}

function getTransferTargets(game, sourcePiece, pl) {
  const targets = [];

  for (const pc of pl.pieces) {
    if (pc === sourcePiece || pc.carrying) continue; // Can't transfer to self or carrying pieces

    const sameLane = pc.r === sourcePiece.r;
    const sameStep = pc.step === sourcePiece.step;
    const stepDiff = Math.abs(pc.step - sourcePiece.step);
    const laneDiff = Math.abs(pc.r - sourcePiece.r);

    // Adjacent on same lane (step ±1)
    if (sameLane && stepDiff === 1) {
      targets.push(pc);
    }
    // Adjacent on different lane (same step)
    else if (!sameLane && sameStep && laneDiff === 1) {
      targets.push(pc);
    }
    // Diagonally 1 step away on different lane
    else if (!sameLane && stepDiff === 1 && laneDiff === 1) {
      targets.push(pc);
    }
  }

  return targets;
}

function executeTransfer(game, sourcePiece, targetPiece) {
  sourcePiece.carrying = false;
  targetPiece.carrying = true;

  // Log transfer
  game.moveHistory.push({
    type: 'transfer',
    player: game.current,
    from: { r: sourcePiece.r, step: sourcePiece.step },
    to: { r: targetPiece.r, step: targetPiece.step },
    turn: game.moveHistory.filter(m => m.type === 'turn_start').length
  });

  return true;
}

// Move a piece down from top step (especially useful when carrying)
function moveTopStepDown(game, pc) {
  const L = LANES[pc.r].L;
  if (pc.step !== L) return false;

  const downStep = L - 1;
  if (downStep >= 1) {
    performMoveWithPush(game, pc, { r: pc.r, step: downStep });
    // Log the move down
    game.moveHistory.push({
      type: 'move_down',
      player: game.current,
      piece: { r: pc.r, to: downStep },
      carrying: pc.carrying,
      turn: game.moveHistory.filter(m => m.type === 'turn_start').length
    });
    return true;
  }
  return false;
}

// Perform a free swoop from top step to adjacent lane's top step
function performTopStepFreeSwoop(game, pc, target) {
  if (pc.step !== LANES[pc.r].L) return false;
  const old = { r: pc.r, step: pc.step };
  performMoveWithPush(game, pc, target);
  // Log the free swoop
  game.moveHistory.push({
    type: 'free_swoop',
    player: game.current,
    piece: { from: old, to: { r: pc.r, step: pc.step } },
    carrying: pc.carrying,
    turn: game.moveHistory.filter(m => m.type === 'turn_start').length
  });
  return true;
}

// Choose the best action for a piece at top step
function chooseTopStepAction(game, pc) {
  // Prefer move down if carrying (helps get home faster)
  if (pc.carrying && canTopStepMoveDown(game, pc)) {
    return 'move_down';
  }

  // Otherwise prefer free swoop if available
  if (canTopStepFreeSwoop(game, pc)) {
    return 'free_swoop';
  }

  // Default to just activation (no movement)
  return 'activate';
}

// Choose the best target for a top step free swoop
function chooseBestTopStepSwoopTarget(targets, pc) {
  if (targets.length === 0) return null;

  // If carrying, prefer lanes that help get home (even sums with baskets)
  if (pc.carrying) {
    const basketTargets = targets.filter(t => LANES[t.r].basket);
    if (basketTargets.length > 0) {
      return basketTargets[0];
    }
  }

  // Otherwise, prefer higher sum lanes (better positioning)
  targets.sort((a, b) => LANES[b.r].sum - LANES[a.r].sum);
  return targets[0];
}

function potentialSwoops(game, pc) {
  const targets = [];
  const r = pc.r;
  const L = LANES[r].L;
  const sum = LANES[r].sum;
  const atOddTop = sum % 2 === 1 && pc.step === L - 1;
  const atTopStep = pc.step === L;

  for (const dr of [-1, +1]) {
    const r2 = r + dr;
    if (r2 < 0 || r2 >= LANES.length) continue;
    let step2;

    if (atTopStep) {
      // Pieces at the top step can swoop to the top step of adjacent lanes
      step2 = LANES[r2].L;
    } else {
      // Use geometric space mapping for all other cases
      const space = mapStepToGrid(r, pc.step);
      step2 = stepForSpace(r2, space);
    }

    if (step2 && tileExistsAt(r2, step2)) {
      targets.push({ r: r2, step: step2 });
    }
  }
  return targets;
}

function eligibleSwoopPiecesForSum(game, pl, _sumIgnored) {
  // Skip spending tokens on carriers already home (step 1)
  return pl.pieces.filter((p) => p.active && !(p.carrying && p.step === 1));
}

function canSwoopWithSum(game, pl, _sumIgnored) {
  if (!(pl.swoopTokens > 0)) return false;
  for (const pc of pl.pieces) {
    if (!pc.active) continue;
    if (pc.carrying && pc.step === 1) continue;
    if (potentialSwoops(game, pc).length > 0) return true;
  }
  return false;
}

function anyMandatoryActionForSum(game, pl, sum) {
  return canMoveOnSum(game, pl, sum);
}

function anyActionForSum(game, pl, sum) {
  return canMoveOnSum(game, pl, sum) || canSwoopWithSum(game, pl, sum);
}

function resolveDeterrents(game, pl) {
  const kept = [];
  for (const pc of pl.pieces) {
    const onDet = (tileTypeAt(pc.r, pc.step) === 'Deterrent');
    if (onDet) { if (pc.carrying && LANES[pc.r].basket) game.baskets[pc.r] = true; continue; }
    kept.push(pc);
  }
  pl.pieces = kept;
}

function bank(game) {
  const pl = game.players[game.current];
  let delivered = 0;
  const kept = [];

  for (const pc of pl.pieces) {
    const L = LANES[pc.r].L;
    // Pick up at top if possible before sliding
    if (pc.step === L && LANES[pc.r].basket && game.baskets[pc.r] && !pc.carrying) {
      pc.carrying = true;
      game.baskets[pc.r] = false;
    }

    if (pc.carrying) {
      if (pc.step === 1) {
        delivered++;
      } else {
        kept.push(pc);
      }
    } else {
      let dest = null;
      for (let s = pc.step; s >= 1; s--) {
        if (tileTypeAt(pc.r, s) === 'Checkpoint') { dest = s; break; }
      }
      if (dest !== null) {
        pc.step = dest;
        kept.push(pc);
      }
    }
  }

  pl.pieces = kept;
  pl.score += delivered;
  resolveDeterrents(game, pl);
  pl.swoopTokens = Math.min(2, (pl.swoopTokens || 0) + 1);
  enforceTokenPolicy(game.players, game.playerCount);
  for (const p of pl.pieces) p.active = false;
  game.current = nextSeatIndex(game.current, game.playerCount);
  return delivered;
}

// --- Dice ---
function r6(rng) {
  return 1 + Math.floor(rng() * 6);
}

function roll4(rng) {
  const d = [r6(rng), r6(rng), r6(rng), r6(rng)];
  const pairs = [];
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      pairs.push({ i, j, sum: d[i] + d[j] });
    }
  }
  return { d, pairs };
}

// --- Pair probability model (4d6 pairings) ---
const PAIR_SUM_MIN = 2;
const PAIR_SUM_MAX = 12;
const PAIR_SUM_COUNT = PAIR_SUM_MAX + 1;
const PAIR_SUM_RANGE = PAIR_SUM_MAX - PAIR_SUM_MIN + 1;
const PAIR_MASK_SIZE = 1 << PAIR_SUM_RANGE;

const FOUR_DICE_PAIRINGS = [
  [[0, 1], [2, 3]],
  [[0, 2], [1, 3]],
  [[0, 3], [1, 2]],
];

function buildPairProbabilityStats() {
  const totalOutcomes = 6 ** 4;
  const hitCounts = Array(PAIR_SUM_COUNT).fill(0);
  const jointCounts = Array.from({ length: PAIR_SUM_COUNT }, () => Array(PAIR_SUM_COUNT).fill(0));
  const maskCounts = new Array(PAIR_MASK_SIZE).fill(0);

  for (let d0 = 1; d0 <= 6; d0++) {
    for (let d1 = 1; d1 <= 6; d1++) {
      for (let d2 = 1; d2 <= 6; d2++) {
        for (let d3 = 1; d3 <= 6; d3++) {
          const dice = [d0, d1, d2, d3];
          const sums = [];
          let mask = 0;
          for (let i = 0; i < 4; i++) {
            for (let j = i + 1; j < 4; j++) {
              const sum = dice[i] + dice[j];
              if (sum < PAIR_SUM_MIN || sum > PAIR_SUM_MAX) continue;
              sums.push(sum);
              const bit = 1 << (sum - PAIR_SUM_MIN);
              mask |= bit;
            }
          }
          // Track hit counts per unique sum in this roll
          const seen = new Set();
          for (const sum of sums) {
            if (seen.has(sum)) continue;
            seen.add(sum);
            hitCounts[sum]++;
          }
          maskCounts[mask]++;

          const jointSeen = new Set();
          for (const pairing of FOUR_DICE_PAIRINGS) {
            const [a0, a1] = pairing[0];
            const [b0, b1] = pairing[1];
            const sumA = dice[a0] + dice[a1];
            const sumB = dice[b0] + dice[b1];
            if (sumA < PAIR_SUM_MIN || sumA > PAIR_SUM_MAX) continue;
            if (sumB < PAIR_SUM_MIN || sumB > PAIR_SUM_MAX) continue;
            jointSeen.add(`${sumA},${sumB}`);
            jointSeen.add(`${sumB},${sumA}`);
          }
          jointSeen.forEach((key) => {
            const [sa, sb] = key.split(',').map(Number);
            jointCounts[sa][sb]++;
          });
        }
      }
    }
  }

  const hit = hitCounts.map((count) => count / totalOutcomes);
  const joint = jointCounts.map((row) => row.map((count) => count / totalOutcomes));
  return {
    total: totalOutcomes,
    hit,
    joint,
    maskCounts,
    probCache: new Map(),
  };
}

const PAIR_PROB_STATS = buildPairProbabilityStats();

function sumsToMask(sums) {
  let mask = 0;
  for (const sum of sums) {
    if (sum < PAIR_SUM_MIN || sum > PAIR_SUM_MAX) continue;
    mask |= 1 << (sum - PAIR_SUM_MIN);
  }
  return mask;
}

function probabilityAnySums(sums) {
  const mask = sumsToMask(sums);
  if (mask === 0) return 0;
  const cached = PAIR_PROB_STATS.probCache.get(mask);
  if (cached !== undefined) return cached;
  let total = 0;
  const counts = PAIR_PROB_STATS.maskCounts;
  for (let idx = 1; idx < counts.length; idx++) {
    if ((idx & mask) !== 0) total += counts[idx];
  }
  const prob = total / PAIR_PROB_STATS.total;
  PAIR_PROB_STATS.probCache.set(mask, prob);
  return prob;
}

function probabilitySumHit(sum) {
  if (sum < PAIR_SUM_MIN || sum > PAIR_SUM_MAX) return 0;
  return PAIR_PROB_STATS.hit[sum];
}

function probabilityJoint(sumA, sumB) {
  if (sumA < PAIR_SUM_MIN || sumA > PAIR_SUM_MAX) return 0;
  if (sumB < PAIR_SUM_MIN || sumB > PAIR_SUM_MAX) return 0;
  return PAIR_PROB_STATS.joint[sumA][sumB];
}

function hasDisjointPair(roll, sumA, sumB) {
  const { pairs } = roll;
  for (let i = 0; i < pairs.length; i++) {
    const pa = pairs[i];
    if (pa.sum !== sumA) continue;
    for (let j = 0; j < pairs.length; j++) {
      const pb = pairs[j];
      if (pb.sum !== sumB) continue;
      if (pa.i === pb.i || pa.i === pb.j || pa.j === pb.i || pa.j === pb.j) continue;
      return true;
    }
  }
  return false;
}

// --- Bot policies ---
// Bot 1: prefers highest odd sums (11 > 9 > 7 > 5 > 3), else highest sum; banks when it delivered this turn or after 3 actions
function chooseActionBot1(ctx) {
  const { game, rng } = ctx;
  const pl = game.players[game.current];
  const { pairs } = ctx.roll;

  // Filter pairs with an available MOVE action (prefer using pairs for movement)
  const usable = pairs.filter((p) => canMoveOnSum(game, pl, p.sum));
  if (usable.length === 0) return { type: 'bust' };

  // Sort by: odd desc weight then sum desc
  usable.sort((a, b) => {
    const ao = a.sum % 2 === 1 ? 1 : 0;
    const bo = b.sum % 2 === 1 ? 1 : 0;
    if (ao !== bo) return bo - ao;
    return b.sum - a.sum;
  });

  const chosen = usable[0];

  // Prefer Move if possible on chosen odd, else Swoop
  if (canMoveOnSum(game, pl, chosen.sum)) return { type: 'move', sum: chosen.sum, pair: chosen };
  // Choose a swoop target that ends on a lane with higher odd sum if possible
  const pcs = eligibleSwoopPiecesForSum(game, pl, chosen.sum);
  for (const pc of pcs) {
    const targs = potentialSwoops(game, pc);
    if (targs.length) {
      // pick target by preferring odd lane with higher sum
      targs.sort((a, b) => {
        const la = LANES[a.r].sum;
        const lb = LANES[b.r].sum;
        const ao = la % 2 === 1 ? 1 : 0;
        const bo = lb % 2 === 1 ? 1 : 0;
        if (ao !== bo) return bo - ao;
        return lb - la;
      });
      return { type: 'swoop', sum: chosen.sum, pc, target: targs[0] };
    }
  }
  return { type: 'bust' };
}

// Bot 2: mixed — 50% prefer even-high (baskets), 50% prefer highest sum; randomize move/swoop if both
function chooseActionBot2(ctx) {
  const { game, rng } = ctx;
  const pl = game.players[game.current];
  const { pairs } = ctx.roll;

  const usable = pairs.filter((p) => canMoveOnSum(game, pl, p.sum));
  if (usable.length === 0) return { type: 'bust' };

  const preferEven = rng() < 0.5;
  usable.sort((a, b) => {
    if (preferEven) {
      const ae = a.sum % 2 === 0 ? 1 : 0;
      const be = b.sum % 2 === 0 ? 1 : 0;
      if (ae !== be) return be - ae;
    }
    return b.sum - a.sum;
  });

  const chosen = usable[0];
  const canMove = canMoveOnSum(game, pl, chosen.sum);
  const canSwoop = canSwoopWithSum(game, pl, chosen.sum);
  if (canMove && canSwoop) {
    if (rng() < 0.6) return { type: 'move', sum: chosen.sum, pair: chosen }; // slight tilt to move
    // pick random eligible swoop
    const pcs = eligibleSwoopPiecesForSum(game, pl, chosen.sum).filter((pc) => potentialSwoops(game, pc).length > 0);
    const pc = pcs[Math.floor(rng() * pcs.length)];
    const targs = potentialSwoops(game, pc);
    const target = targs[Math.floor(rng() * targs.length)];
    return { type: 'swoop', sum: chosen.sum, pc, target };
  }
  if (canMove) return { type: 'move', sum: chosen.sum, pair: chosen };
  if (canSwoop) {
    const pcs = eligibleSwoopPiecesForSum(game, pl, chosen.sum).filter((pc) => potentialSwoops(game, pc).length > 0);
    const pc = pcs[Math.floor(rng() * pcs.length)];
    const targs = potentialSwoops(game, pc);
    const target = targs[Math.floor(rng() * targs.length)];
    return { type: 'swoop', sum: chosen.sum, pc, target };
  }
  return { type: 'bust' };
}

// Banking heuristics (balanced for gameplay)
function shouldBankBot1(turnStats, game) {
  const pl = game.players[game.current];

  // Bank immediately if delivered this turn
  if (turnStats.deliveredThisTurn > 0) return true;

  // Bank if we have pieces carrying baskets at step 1 (ready to deliver)
  const readyToDeliver = pl.pieces.some(pc => pc.carrying && pc.step === 1);
  if (readyToDeliver) return true;

  // Bank if we have pieces carrying baskets and close to home (step <= 2)
  const carryingNearHome = pl.pieces.some(pc => pc.carrying && pc.step <= 2);
  if (carryingNearHome && turnStats.actionsThisTurn >= 1) return true;

  // Bank after 4 actions (less aggressive to allow more gameplay)
  if (turnStats.actionsThisTurn >= 4) return true;

  // Bank if we have 2 active pieces and have taken some actions
  if (activeCount(pl) >= 2 && turnStats.actionsThisTurn >= 2) return true;

  return false;
}

function shouldBankBot2(turnStats, rng, game) {
  const pl = game.players[game.current];

  // Bank immediately if delivered this turn
  if (turnStats.deliveredThisTurn > 0) return true;

  // Bank if we have pieces carrying baskets at step 1
  const readyToDeliver = pl.pieces.some(pc => pc.carrying && pc.step === 1);
  if (readyToDeliver) return true;

  // Bank if we have pieces carrying baskets and have taken actions
  const hasCarrying = pl.pieces.some(pc => pc.carrying);
  if (hasCarrying && turnStats.actionsThisTurn >= 2) return true;

  // Bank after 5 actions (more conservative than Bot1)
  if (turnStats.actionsThisTurn >= 5) return true;

  // 10% random bank pressure (reduced further)
  return rng() < 0.10;
}

// --- Single turn executor ---
function playTurn(game, bots, rng, metrics, targetScore) {
  const bot = bots[game.current];
  const pl = game.players[game.current];
  const turnStats = { actionsThisTurn: 0, moves: 0, swoops: 0, busts: 0, deliveredThisTurn: 0 };

  // Log turn start
  game.moveHistory.push({
    type: 'turn_start',
    player: game.current,
    turn: game.moveHistory.filter(m => m.type === 'turn_start').length + 1
  });

  // Pre-roll decision: may transfer, then bank, or roll
  const transferDecision = bot.shouldTransfer ? bot.shouldTransfer(turnStats, rng, game) : null;
  if (transferDecision) {
    executeTransfer(game, transferDecision.source, transferDecision.target);
    turnStats.actionsThisTurn++;
    metrics.transfers = (metrics.transfers || 0) + 1;
    // After transfer, check if should bank or continue
  }

  if (bot.shouldBank(turnStats, rng, game)) {
    const delivered = bank(game);
    turnStats.deliveredThisTurn += delivered;
    metrics.banks++;
    metrics.deliveries += delivered;
    metrics.turns++;
    metrics.turnsByPlayer[game.current]++;
    return;
  }

  // Loop rolling until bank or bust
  while (true) {
    const roll = roll4(rng);
    metrics.rolls++;

    // Log dice roll
    game.moveHistory.push({
      type: 'roll',
      player: game.current,
      dice: roll.d,
      pairs: roll.pairs,
      turn: game.moveHistory.filter(m => m.type === 'turn_start').length
    });

    // Check if any pair can MOVE at all (we prioritize pair-based moves); if none, consider swoop or bust
    const usable = roll.pairs.filter((p) => canMoveOnSum(game, pl, p.sum));
    if (usable.length === 0) {
      // If no move exists, try a token swoop; otherwise, Bust
      if (canSwoopWithSum(game, pl, 0)) {
        const pcs = eligibleSwoopPiecesForSum(game, pl, 0).filter((pc) => potentialSwoops(game, pc).length > 0);
        if (pcs.length > 0) {
          const pc = pcs[Math.floor(rng() * pcs.length)];
          const targs = potentialSwoops(game, pc);
          const target = targs[Math.floor(rng() * targs.length)];
          if (pl.swoopTokens > 0) pl.swoopTokens -= 1;
          const oldR = pc.r, oldStep = pc.step;
          performMoveWithPush(game, pc, target, true);
          game.moveHistory.push({ type: 'swoop', player: game.current, piece: { from: { r: oldR, step: oldStep }, to: { r: pc.r, step: pc.step } }, sum: 0, carrying: pc.carrying, turn: game.moveHistory.filter(m => m.type === 'turn_start').length });
          turnStats.swoops++; turnStats.actionsThisTurn++;
        } else {
          const delivered = applyBust(game);
          turnStats.deliveredThisTurn += delivered;
          metrics.busts++; metrics.deliveries += delivered; metrics.turns++; metrics.turnsByPlayer[game.current]++;
          return;
        }
      } else {
        const delivered = applyBust(game);
        turnStats.deliveredThisTurn += delivered;
        metrics.busts++; metrics.deliveries += delivered; metrics.turns++; metrics.turnsByPlayer[game.current]++;
        return;
      }
    }

    const ctx = { game, rng, roll, turnStats };
    const decision = bot.chooseAction(ctx);

    // Log decision
    game.moveHistory.push({
      type: 'decision',
      player: game.current,
      decision: decision,
      turn: game.moveHistory.filter(m => m.type === 'turn_start').length
    });

    if (decision.type === 'move') {
      const plan = decision.plan || null;
      if (plan) {
        ensurePieceForSum(game, pl, decision.sum);
        let pc = null;
        if (plan.spawn) {
          pc = pl.pieces[pl.pieces.length - 1];
          turnStats.moves++;
          turnStats.actionsThisTurn++;
          continue;
        }
        if (typeof plan.pieceIndex === 'number' && plan.pieceIndex < pl.pieces.length) {
          pc = pl.pieces[plan.pieceIndex];
        } else if (pl.pieces.length > 0) {
          pc = pl.pieces[pl.pieces.length - 1];
        }
        if (!pc) continue;

        if (plan.action === 'move' && plan.target) {
          const before = { r: pc.r, step: pc.step };
          performMoveWithPush(game, pc, plan.target);
          game.moveHistory.push({
            type: 'move',
            player: game.current,
            piece: { r: pc.r, from: before.step, to: pc.step },
            carrying: pc.carrying,
            turn: game.moveHistory.filter(m => m.type === 'turn_start').length
          });
          turnStats.moves++;
          turnStats.actionsThisTurn++;
          continue;
        }
        if (plan.action === 'move_down') {
          if (canTopStepMoveDown(game, pc) && moveTopStepDown(game, pc)) {
            turnStats.moves++;
            turnStats.actionsThisTurn++;
          }
          continue;
        }
        if (plan.action === 'top_swoop' && plan.target) {
          if (performTopStepFreeSwoop(game, pc, plan.target)) {
            turnStats.swoops++;
            turnStats.actionsThisTurn++;
          }
          continue;
        }
        // default activation
        turnStats.actionsThisTurn++;
        continue;
      }
      // Ensure or move piece
      const pc = ensurePieceForSum(game, pl, decision.sum);
      if (!pc) {
        // If ensure failed (capacity), try next best: treat as no-op and proceed to next roll
        // In practice, this is rare given conditions
      } else {
        const had = pc.step;
        const L = LANES[pc.r].L;

        // Special handling for pieces at top step
        if (pc.step === L && had === L) {
          // Piece was already at top step, choose best action
          const topStepAction = chooseTopStepAction(game, pc);
          if (topStepAction === 'move_down' && canTopStepMoveDown(game, pc)) {
            if (moveTopStepDown(game, pc)) {
              turnStats.moves++;
              turnStats.actionsThisTurn++;
            }
          } else if (topStepAction === 'free_swoop') {
            const targets = potentialTopStepSwoops(game, pc);
            if (targets.length > 0) {
              // Choose best target (prefer carrying pieces to move toward home)
              const target = chooseBestTopStepSwoopTarget(targets, pc);
              if (performTopStepFreeSwoop(game, pc, target)) {
                turnStats.swoops++;
                turnStats.actionsThisTurn++;
              }
            }
          }
          // If no special action taken, piece was just activated (handled in ensurePieceForSum)
        } else if (pieceOnLane(pl, pc.r) && pc.step === had) {
          // existing piece — choose up or down
          const opts = moveTargets(game, pc).filter(t => t.r === pc.r); // only up/down here
          let chosen = null;
          if (opts.length === 1) {
            chosen = opts[0];
          } else if (opts.length > 1) {
            // Heuristic: if carrying prefer down; else prefer up
            const up = opts.find(o => o.step === had + 1);
            const down = opts.find(o => o.step === had - 1);
            chosen = pc.carrying ? (down || up) : (up || down);
          }
          if (chosen) {
            const before = { r: pc.r, step: pc.step };
            performMoveWithPush(game, pc, chosen);
            game.moveHistory.push({
              type: 'move',
              player: game.current,
              piece: { r: pc.r, from: before.step, to: pc.step },
              carrying: pc.carrying,
              turn: game.moveHistory.filter(m => m.type === 'turn_start').length
            });
            turnStats.moves++;
            turnStats.actionsThisTurn++;
          }
        } else {
          // freshly ensured; counts as action in our accounting
          turnStats.moves++;
          turnStats.actionsThisTurn++;
        }
      }

      // Attempt a second move with the remaining two dice (if any)
      if (decision.pair && roll.d.length === 4) {
        const used = new Set([decision.pair.i, decision.pair.j]);
        const rem = [0,1,2,3].filter(k => !used.has(k));
        if (rem.length === 2) {
          const secondPair = { i: rem[0], j: rem[1], sum: roll.d[rem[0]] + roll.d[rem[1]] };
          if (canMoveOnSum(game, pl, secondPair.sum)) {
            // Mirror the move logic for the second pair
            const pc2 = ensurePieceForSum(game, pl, secondPair.sum);
            if (pc2) {
              const had2 = pc2.step;
              const L2 = LANES[pc2.r].L;
              if (pc2.step === L2 && had2 === L2) {
                const action2 = chooseTopStepAction(game, pc2);
                if (action2 === 'move_down' && canTopStepMoveDown(game, pc2)) {
                  if (moveTopStepDown(game, pc2)) {
                    turnStats.moves++; turnStats.actionsThisTurn++;
                  }
                } else if (action2 === 'free_swoop') {
                  const t2 = potentialTopStepSwoops(game, pc2);
                  if (t2.length > 0) {
                    const tgt2 = chooseBestTopStepSwoopTarget(t2, pc2);
                    if (performTopStepFreeSwoop(game, pc2, tgt2)) {
                      turnStats.swoops++; turnStats.actionsThisTurn++;
                    }
                  }
                }
              } else if (pieceOnLane(pl, pc2.r) && pc2.step === had2) {
                const opts2 = moveTargets(game, pc2).filter(t => t.r === pc2.r);
                let chosen2 = null;
                if (opts2.length === 1) chosen2 = opts2[0];
                else if (opts2.length > 1) {
                  const up2 = opts2.find(o => o.step === had2 + 1);
                  const down2 = opts2.find(o => o.step === had2 - 1);
                  chosen2 = pc2.carrying ? (down2 || up2) : (up2 || down2);
                }
                if (chosen2) {
                  const before2 = { r: pc2.r, step: pc2.step };
                  performMoveWithPush(game, pc2, chosen2);
                  game.moveHistory.push({ type: 'move', player: game.current, piece: { r: pc2.r, from: before2.step, to: pc2.step }, carrying: pc2.carrying, turn: game.moveHistory.filter(m => m.type === 'turn_start').length });
                  turnStats.moves++; turnStats.actionsThisTurn++;
                }
              } else {
                turnStats.moves++; turnStats.actionsThisTurn++;
              }
            }
          }
        }
      }
    } else if (decision.type === 'swoop') {
      // Apply swoop via token
      const plan = decision.plan || null;
      let pc = decision.pc;
      if (!pc && plan && typeof plan.pieceIndex === 'number') {
        pc = pl.pieces[plan.pieceIndex];
      }
      if (!pc && typeof decision.pcIndex === 'number') {
        pc = pl.pieces[decision.pcIndex];
      }
      if (pc) {
        const pl = game.players[game.current];
        if (pl.swoopTokens > 0) pl.swoopTokens -= 1;
        const oldR = pc.r;
        const oldStep = pc.step;
        const target = plan && plan.target ? plan.target : decision.target;
        if (!target) continue;
        performMoveWithPush(game, pc, target, true); // isSwoop = true

        // Log swoop
        game.moveHistory.push({
          type: 'swoop',
          player: game.current,
          piece: { from: { r: oldR, step: oldStep }, to: { r: pc.r, step: pc.step } },
          sum: decision.sum,
          carrying: pc.carrying,
          turn: game.moveHistory.filter(m => m.type === 'turn_start').length
        });

        turnStats.swoops++;
        turnStats.actionsThisTurn++;
      }
    } else if (decision.type === 'bust') {
      const delivered = applyBust(game);
      turnStats.deliveredThisTurn += delivered;
      metrics.busts++;
      metrics.deliveries += delivered;
      metrics.turns++;
      metrics.turnsByPlayer[game.current]++;
      return;
    }

    // Optional bank after action (pre-roll in rules, but for simulation we emulate pressure to stop now)
    if (bot.shouldBank(turnStats, rng, game)) {
      const delivered = bank(game);
      turnStats.deliveredThisTurn += delivered;
      metrics.banks++;
      metrics.deliveries += delivered;
      metrics.turns++;
      metrics.turnsByPlayer[game.current]++;
      return;
    }
  }
}

function applyBust(game) {
  const pl = game.players[game.current];
  // Log bust event
  game.moveHistory.push({
    type: 'bust',
    player: game.current,
    turn: game.moveHistory.filter(m => m.type === 'turn_start').length
  });

  // On bust, move active pieces to previous checkpoints (like main game)
  let delivered = 0;
  const kept = [];

  for (const pc of pl.pieces) {
    const lane = LANES[pc.r];
    const L = lane.L;
    const tile = tileTypeAt(pc.r, pc.step);

    if (tile === 'Deterrent') {
      if (pc.carrying && lane.basket) {
        game.baskets[pc.r] = true;
      }
      continue;
    }

    if (pc.carrying) {
      let dest = null;
      for (let s = pc.step; s <= L; s++) {
        if (tileTypeAt(pc.r, s) === 'Checkpoint') { dest = s; break; }
      }
      if (dest !== null) pc.step = dest;
      kept.push(pc);
      continue;
    }

    if (tile === 'Checkpoint') {
      kept.push(pc);
      continue;
    }

    let dest = null;
    for (let s = pc.step; s >= 1; s--) {
      if (tileTypeAt(pc.r, s) === 'Checkpoint') { dest = s; break; }
    }
    if (dest !== null) {
      pc.step = dest;
      kept.push(pc);
    }
  }

  // Check for deliveries at step 1
  for (const pc of kept) {
    if (pc.carrying && pc.step === 1) {
      delivered++;
      kept.splice(kept.indexOf(pc), 1);
    }
  }

  pl.pieces = kept;
  pl.score += delivered;
  resolveDeterrents(game, pl);
  for (const p of pl.pieces) p.active = false;
  enforceTokenPolicy(game.players, game.playerCount);
  game.current = nextSeatIndex(game.current, game.playerCount);
  return delivered;
}

// --- One full game to target score ---
function playGame(targetScore = 2, rng, bots, gameIndex = 0, maxTurns = 1000, verbose = false) {
  // Fixed target score of 2 baskets for victory
  const VICTORY_TARGET = 2;
  const game = initialGame();

  const metrics = {
    turns: 0,
    playerCount: game.players.length,
    turnsByPlayer: Array.from({ length: game.players.length }, () => 0),
    rolls: 0,
    busts: 0,
    banks: 0,
    deliveries: 0,
    transfers: 0,
  };

  // Add game start metadata
  game.moveHistory.push({
    type: 'game_start',
    gameIndex: gameIndex,
    targetScore: VICTORY_TARGET,
    timestamp: new Date().toISOString()
  });

  let turnCount = 0;

  while (game.players[0].score < VICTORY_TARGET && game.players[1].score < VICTORY_TARGET && turnCount < maxTurns) {
    playTurn(game, bots, rng, metrics, VICTORY_TARGET);
    turnCount++;

    if (verbose && turnCount % 100 === 0) {
      console.log(`Game ${gameIndex}: Turn ${turnCount}, Scores: ${game.players[0].score}-${game.players[1].score}`);
    }
  }

  if (turnCount >= maxTurns) {
    if (verbose) {
      console.warn(`Game ${gameIndex} reached maximum turn limit (${maxTurns}). Scores: ${game.players[0].score}-${game.players[1].score}`);
    }
    // Force end game - winner is player with higher score
    if (game.players[0].score === game.players[1].score) {
      // Tie - random winner
      game.players[Math.floor(rng() * 2)].score = VICTORY_TARGET;
    } else {
      const leader = game.players[0].score > game.players[1].score ? 0 : 1;
      game.players[leader].score = VICTORY_TARGET;
    }
  }

  const winner = game.players[0].score >= VICTORY_TARGET ? 0 : 1;

  // Add game end metadata
  game.moveHistory.push({
    type: 'game_end',
    winner: winner,
    finalScores: [game.players[0].score, game.players[1].score],
    totalTurns: metrics.turns,
    timestamp: new Date().toISOString()
  });

  return { winner, metrics, game };
}

// --- Bot Strategy Factory ---
const PRO_WEIGHTS = {
  SCORE_WEIGHT: 1200,
  TOKEN_WEIGHT: 90,
  TOKEN_RESERVE_VALUE: 35,
  DELIVERY_READY_BONUS: 450,
  CARRY_BASE: 540,
  CARRY_DISTANCE_WEIGHT: 30,
  OUTWARD_PROGRESS_WEIGHT: 45,
  EVEN_LANE_BONUS: 40,
  CHECKPOINT_SAFETY_BONUS: 28,
  DETERRENT_PENALTY: 220,
  ACTIVE_HAZARD_PENALTY: 75,
  OPPONENT_SCALE: 0.65,
  BASKET_CONTROL_WEIGHT: 50,
  PUSH_REMOVAL_BONUS: 120,
  PUSH_STEP_ADVANTAGE: 25,
  TOKEN_FUTURE_VALUE: 55,
  READY_PICKUP_BONUS: 110,
  READY_SWEEP_WINDOW: 2,
  ODD_TOP_IDLE_PENALTY: 80,
};

const PRO_SEARCH = {
  DEPTH: 1,
  ROLL_SAMPLES: 24,
  BANK_SAMPLES: 36,
  SWOOP_TOKEN_COST: 30,
  BANK_MARGIN: 35,
  TOKEN_MARGIN_STEP: 55,
  SINGLE_TOKEN_MARGIN_STEP: 20,
  CHECKPOINT_SWEEP_MARGIN: 25,
  NOISE: 0.25,
};

const PUSHER_WEIGHTS = {
  PROB_WEIGHT: 900,
  ACCESS_WEIGHT: 110,
  PRIMARY_BONUS: 160,
  SECONDARY_BONUS: 110,
  ANCHOR_BONUS: 90,
  JOINT_BONUS: 520,
  ADJACENT_SWOOP_BONUS: 260,
  TOKEN_VALUE: 80,
  TOKEN_LOW_PENALTY: 55,
  AGGRESSIVE_TOKEN_RELIEF: 45,
  CONTINUE_BONUS: 140,
  STALE_PENALTY: 160,
  HAZARD_PENALTY: 170,
  NEAR_TOP_BONUS: 85,
  CARRY_NEAR_HOME_BONUS: 220,
  RECENT_MATCH_BONUS: 95,
  RANDOM_NOISE: 55,
};

const PUSHER_SEARCH = {
  DEPTH: 1,
  BANK_SAMPLES: 28,
  BASE_MARGIN: 48,
  TOKEN_MARGIN_STEP: 30,
  LOW_TOKEN_MARGIN: 18,
  SHORT_RISK_MARGIN: -6,
  LONG_RISK_MARGIN: 22,
  AGGRESSIVE_MARGIN_SHIFT: -40,
  EARLY_LONG_SHIFT: -35,
};

const ANY_SUMS = Array.from({ length: PAIR_SUM_MAX - PAIR_SUM_MIN + 1 }, (_, idx) => idx + PAIR_SUM_MIN);

const PUSHER_MOTIF_DEFS = [
  { key: 'odd_corridor', priority: 0, primary: [4], secondary: [8, 9], horizon: [2, 3], risk: 'short', category: 'odd' },
  { key: 'five_nine', priority: 1, primary: [5], secondary: [9], horizon: [2, 3], risk: 'short', category: 'odd' },
  { key: 'four_six', priority: 2, primary: [4], secondary: [6], horizon: [1, 2], risk: 'medium' },
  { key: 'four_ten', priority: 3, primary: [4], secondary: [10], horizon: [1, 2], risk: 'medium' },
  { key: 'two_any', priority: 4, primary: [2], secondary: ANY_SUMS.filter((s) => s !== 2), horizon: [1, 2], risk: 'medium' },
  { key: 'three_any', priority: 5, primary: [3], secondary: ANY_SUMS.filter((s) => s !== 3), horizon: [1, 2], risk: 'medium' },
  { key: 'eleven_any', priority: 6, primary: [11], secondary: ANY_SUMS.filter((s) => s !== 11), horizon: [1, 2], risk: 'medium' },
  { key: 'twelve_any', priority: 7, primary: [12], secondary: ANY_SUMS.filter((s) => s !== 12), horizon: [1, 2], risk: 'medium' },
  { key: 'seven_anchor', priority: 8, primary: [7], secondary: [4, 5, 6, 8, 9, 10], horizon: [2, 5], risk: 'long', category: 'anchor' },
];

function expandMotifDefinition(def) {
  const all = Array.from(new Set([...def.primary, ...def.secondary])).filter((s) => s >= PAIR_SUM_MIN && s <= PAIR_SUM_MAX);
  const combos = [];
  def.primary.forEach((p) => {
    def.secondary.forEach((s) => {
      if (p === s) return;
      combos.push([p, s]);
    });
  });
  const hitProb = probabilityAnySums(all);
  const jointProb = combos.length
    ? combos.reduce((acc, [a, b]) => acc + probabilityJoint(a, b), 0) / combos.length
    : 0;
  const primaryProb = def.primary.length
    ? def.primary.reduce((acc, sum) => acc + probabilitySumHit(sum), 0) / def.primary.length
    : 0;
  return {
    ...def,
    allSums: all,
    combos,
    primarySet: new Set(def.primary),
    secondarySet: new Set(def.secondary),
    allSet: new Set(all),
    targetMask: sumsToMask(all),
    hitProb,
    jointProb,
    primaryProb,
  };
}

const PUSHER_MOTIFS = PUSHER_MOTIF_DEFS.map(expandMotifDefinition);

function cloneGameForSearch(game) {
  return {
    playerCount: game.playerCount,
    current: game.current,
    baskets: [...game.baskets],
    moveHistory: [],
    players: game.players.map((pl) => ({
      name: pl.name,
      score: pl.score,
      swoopTokens: pl.swoopTokens,
      pieces: pl.pieces.map((pc, idx) => ({ ...pc, _index: idx })),
    })),
  };
}

function evaluateState(game, seat) {
  const me = game.players[seat];
  const opponents = game.players.filter((_, idx) => idx !== seat);
  const maxOppScore = opponents.reduce((m, pl) => Math.max(m, pl.score), 0);
  let value = 0;

  value += (me.score - maxOppScore) * PRO_WEIGHTS.SCORE_WEIGHT;
  value += me.swoopTokens * PRO_WEIGHTS.TOKEN_WEIGHT;

  const myPieceValue = me.pieces.reduce((acc, pc) => acc + evaluatePiece(game, seat, pc, true), 0);
  const oppPieceValue = opponents.reduce((acc, pl) => acc + pl.pieces.reduce((pAcc, pc) => pAcc + evaluatePiece(game, seat, pc, false), 0), 0);
  value += myPieceValue;
  value -= oppPieceValue * PRO_WEIGHTS.OPPONENT_SCALE;

  // Encourage basket control on even lanes
  for (let r = 0; r < LANES.length; r++) {
    if (!LANES[r].basket) continue;
    if (!game.baskets[r]) {
      // Basket already taken – reward if we are carrying from this lane
      const myCarrier = me.pieces.find((pc) => pc.r === r && pc.carrying);
      const oppCarrier = opponents.some((pl) => pl.pieces.some((pc) => pc.r === r && pc.carrying));
      if (myCarrier) value += PRO_WEIGHTS.BASKET_CONTROL_WEIGHT;
      else if (oppCarrier) value -= PRO_WEIGHTS.BASKET_CONTROL_WEIGHT;
    } else {
      // Basket still available – reward proximity
      const myPiece = me.pieces.find((pc) => pc.r === r);
      if (myPiece) {
        const dist = Math.max(0, LANES[r].L - myPiece.step);
        value += (PRO_WEIGHTS.READY_PICKUP_BONUS - dist * PRO_WEIGHTS.OUTWARD_PROGRESS_WEIGHT * 0.5);
      }
    }
  }

  return value;
}

function evaluatePiece(game, seat, pc, isSelf) {
  const lane = LANES[pc.r];
  const tile = tileTypeAt(pc.r, pc.step);
  let val = 0;

  if (pc.carrying) {
    const distHome = pc.step - 1;
    val += PRO_WEIGHTS.CARRY_BASE - distHome * PRO_WEIGHTS.CARRY_DISTANCE_WEIGHT;
    if (pc.step === 1) val += PRO_WEIGHTS.DELIVERY_READY_BONUS;
  } else {
    const distTop = lane.L - pc.step;
    val += PRO_WEIGHTS.OUTWARD_PROGRESS_WEIGHT * (lane.L - distTop);
    if (lane.basket) val += (PRO_WEIGHTS.EVEN_LANE_BONUS * (1 + (lane.sum % 2 === 0 ? 1 : 0)) - distTop * PRO_WEIGHTS.OUTWARD_PROGRESS_WEIGHT);
    const nextCp = checkpoints(lane.L).find((c) => c > pc.step);
    if (typeof nextCp === 'number') {
      val += PRO_WEIGHTS.CHECKPOINT_SAFETY_BONUS * Math.max(0, 1 - (nextCp - pc.step) * 0.3);
    }
    if (!lane.basket && lane.sum % 2 === 1 && pc.step === lane.L) {
      val -= PRO_WEIGHTS.ODD_TOP_IDLE_PENALTY;
    }
  }

  if (tile === 'Deterrent') val -= PRO_WEIGHTS.DETERRENT_PENALTY;
  if (pc.active && tile !== 'Checkpoint' && tile !== 'Final') val -= PRO_WEIGHTS.ACTIVE_HAZARD_PENALTY * 0.5;

  if (!isSelf) val *= 0.8;
  return val;
}

function applyMovePlan(clone, plan, sum) {
  const seat = clone.current;
  const pl = clone.players[seat];
  clone.moveHistory = clone.moveHistory || [];
  const beforePieces = pl.pieces.length;
  ensurePieceForSum(clone, pl, sum);

  let pc = null;
  if (plan.spawn) {
    pc = pl.pieces[pl.pieces.length - 1];
  } else if (typeof plan.pieceIndex === 'number') {
    pc = pl.pieces[plan.pieceIndex];
  }

  if (!pc) return clone;

  if (plan.action === 'move' && plan.target) {
    performMoveWithPush(clone, pc, plan.target);
  } else if (plan.action === 'move_down') {
    const downStep = LANES[pc.r].L - 1;
    if (downStep >= 1) performMoveWithPush(clone, pc, { r: pc.r, step: downStep });
  } else if (plan.action === 'top_swoop' && plan.target) {
    performMoveWithPush(clone, pc, plan.target);
  }

  return clone;
}

function applySwoopPlan(clone, plan) {
  const seat = clone.current;
  const pl = clone.players[seat];
  clone.moveHistory = clone.moveHistory || [];

  if (pl.swoopTokens <= 0) return clone;
  if (typeof plan.pieceIndex !== 'number') return clone;
  const pc = pl.pieces[plan.pieceIndex];
  if (!pc) return clone;

  const targets = potentialSwoops(clone, pc);
  if (!targets.find((t) => t.r === plan.target.r && t.step === plan.target.step)) return clone;

  pl.swoopTokens -= 1;
  performMoveWithPush(clone, pc, plan.target, true);
  return clone;
}

function evaluateContinuation(clone, seat, depth, rng, samples) {
  if (depth <= 0) return evaluateState(clone, seat);
  const sampleCount = samples || PRO_SEARCH.ROLL_SAMPLES;
  let total = 0;
  for (let i = 0; i < sampleCount; i++) {
    const roll = roll4(rng);
    const value = evaluateRollOutcome(clone, seat, roll, depth - 1, rng);
    total += value;
  }
  return total / sampleCount;
}

function evaluateRollOutcome(baseGame, seat, roll, depth, rng) {
  const game = cloneGameForSearch(baseGame);
  game.current = seat;
  const candidates = generateMovePlans(game, roll, seat, depth, rng);
  const swoops = generateSwoopPlans(game, seat, depth, rng);
  const all = candidates.concat(swoops);
  if (all.length === 0) {
    const bustClone = cloneGameForSearch(game);
    applyBust(bustClone);
    bustClone.current = seat;
    return evaluateState(bustClone, seat);
  }
  let best = -Infinity;
  for (const cand of all) {
    if (cand.value > best) best = cand.value;
  }
  return best;
}

function generateMovePlans(game, roll, seat, depth, rng) {
  const pl = game.players[seat];
  const results = [];
  const uniqueSums = new Set(roll.pairs.map((p) => p.sum));
  for (const sum of uniqueSums) {
    if (!canMoveOnSum(game, pl, sum)) continue;
    const laneIndex = LANES.findIndex((lane) => lane.sum === sum);
    if (laneIndex < 0) continue;

    // Existing pieces on lane
    pl.pieces.forEach((pc, idx) => {
      if (pc.r !== laneIndex) return;
      const targets = moveTargets(game, pc).filter((t) => t.r === laneIndex);
      for (const target of targets) {
        const plan = { pieceIndex: idx, action: 'move', target };
        const clone = applyMovePlan(cloneGameForSearch(game), plan, sum);
        const val = evaluateContinuation(clone, seat, depth, rng);
        results.push({ type: 'move', sum, plan, value: val });
      }

      // Top step options
      if (pc.step === LANES[pc.r].L) {
        const downPlan = { pieceIndex: idx, action: 'move_down' };
        const downClone = applyMovePlan(cloneGameForSearch(game), downPlan, sum);
        const downVal = evaluateContinuation(downClone, seat, depth, rng);
        results.push({ type: 'move', sum, plan: downPlan, value: downVal });

        const swoopTargets = potentialTopStepSwoops(game, pc);
        for (const target of swoopTargets) {
          const plan = { pieceIndex: idx, action: 'top_swoop', target };
          const clone = applyMovePlan(cloneGameForSearch(game), plan, sum);
          const val = evaluateContinuation(clone, seat, depth, rng);
          results.push({ type: 'move', sum, plan, value: val });
        }
      }
    });

    // Spawn new piece if allowed
    if (pl.pieces.filter((pc) => pc.r === laneIndex).length === 0) {
      if (pl.pieces.length < 5 && activeCount(pl) < 2 && !occupied(game, laneIndex, 1)) {
        const plan = { spawn: true, pieceIndex: 'new', action: 'activate_only', lane: laneIndex };
        const clone = applyMovePlan(cloneGameForSearch(game), plan, sum);
        const val = evaluateContinuation(clone, seat, depth, rng);
        results.push({ type: 'move', sum, plan, value: val });
      }
    }
  }
  return results;
}

function generateSwoopPlans(game, seat, depth, rng) {
  const pl = game.players[seat];
  if (!pl || pl.swoopTokens <= 0) return [];
  const results = [];
  const tokenCostRaw = PRO_SEARCH.SWOOP_TOKEN_COST - (pl.swoopTokens >= 2 ? PRO_WEIGHTS.TOKEN_RESERVE_VALUE : 0);
  const tokenCost = Math.max(0, tokenCostRaw);
  pl.pieces.forEach((pc, idx) => {
    if (!pc.active) return;
    if (pc.carrying && pc.step === 1) return;
    const targets = potentialSwoops(game, pc);
    for (const target of targets) {
      const plan = { pieceIndex: idx, target };
      const clone = applySwoopPlan(cloneGameForSearch(game), plan);
      const val = evaluateContinuation(clone, seat, depth, rng) - tokenCost;
      results.push({ type: 'swoop', sum: 0, plan, value: val });
    }
  });
  return results;
}

function hasCheckpointSwoop(game, pl) {
  if (!pl || pl.swoopTokens <= 0) return false;
  return pl.pieces.some((pc) => {
    if (!pc.active) return false;
    const targets = potentialSwoops(game, pc);
    return targets.some((target) => tileTypeAt(target.r, target.step) === 'Checkpoint');
  });
}

function currentTurnId(game) {
  if (!game || !Array.isArray(game.moveHistory)) return 0;
  let count = 0;
  for (const move of game.moveHistory) {
    if (move && move.type === 'turn_start') count++;
  }
  return count;
}

function decidePusherAggression(game, seat, rng) {
  const me = game.players[seat];
  const opponents = game.players.filter((_, idx) => idx !== seat);
  const maxOppScore = opponents.reduce((acc, pl) => Math.max(acc, pl.score), 0);
  const base = 0.25;
  let tilt = base;
  if (me.score < maxOppScore) tilt += 0.18;
  if (me.score > maxOppScore) tilt -= 0.10;
  const totalScore = game.players.reduce((acc, pl) => acc + pl.score, 0);
  if (totalScore >= 4) tilt += 0.06;
  tilt = Math.max(0.05, Math.min(0.85, tilt));
  return rng() < tilt;
}

function evaluateMotifScore(game, seat, motif, aggressive) {
  const me = game.players[seat];
  const tokens = me.swoopTokens || 0;
  const opponents = game.players.filter((_, idx) => idx !== seat);
  const maxOppScore = opponents.reduce((acc, pl) => Math.max(acc, pl.score), 0);
  const totalScore = game.players.reduce((acc, pl) => acc + pl.score, 0);
  const earlyGame = totalScore <= 1;

  let score = motif.hitProb * PUSHER_WEIGHTS.PROB_WEIGHT;
  score += motif.primaryProb * (PUSHER_WEIGHTS.PRIMARY_BONUS * 0.4);
  score += motif.jointProb * (PUSHER_WEIGHTS.JOINT_BONUS * 0.25);

  let accessible = 0;
  for (const sum of motif.allSums) {
    if (canMoveOnSum(game, me, sum)) accessible += 1;
  }
  score += accessible * PUSHER_WEIGHTS.ACCESS_WEIGHT;

  if (motif.category === 'odd') score += 85;
  if (motif.category === 'anchor') score += 40;

  if (motif.risk === 'short') score += 65;
  if (motif.risk === 'medium') score += 25;
  if (motif.risk === 'long') score -= 25;

  if (tokens >= 2) score += PUSHER_WEIGHTS.TOKEN_VALUE * 0.9;
  if (tokens === 0) score -= PUSHER_WEIGHTS.TOKEN_LOW_PENALTY;

  if (motif.risk === 'long' && tokens === 0) score -= 120;
  if (motif.risk === 'long' && earlyGame) score -= 60;

  if (aggressive) {
    if (motif.risk !== 'short') score += 90;
    score += motif.hitProb * 120;
  }

  if (me.score < maxOppScore) score += 70;
  if (me.score - maxOppScore >= 1) score -= 35;

  for (const pc of me.pieces) {
    const lane = LANES[pc.r];
    const sum = lane.sum;
    if (!motif.allSet.has(sum)) continue;
    if (!pc.carrying && pc.step >= lane.L - 1) score += PUSHER_WEIGHTS.NEAR_TOP_BONUS;
    if (pc.carrying && pc.step <= 2) score += PUSHER_WEIGHTS.CARRY_NEAR_HOME_BONUS * 0.5;
    if (tileTypeAt(pc.r, pc.step) === 'Deterrent') score -= PUSHER_WEIGHTS.HAZARD_PENALTY;
  }

  score -= motif.priority * 12;
  return score;
}

function selectPusherMotif(game, seat, rng, aggressive) {
  let best = null;
  let bestScore = -Infinity;
  for (const motif of PUSHER_MOTIFS) {
    const score = evaluateMotifScore(game, seat, motif, aggressive);
    if (score > bestScore) {
      best = motif;
      bestScore = score;
    }
  }
  if (!best) return null;
  const [minH, maxH] = best.horizon;
  const span = Math.max(0, maxH - minH);
  const draw = span === 0 ? 0 : Math.floor(rng() * (span + 1));
  const maxAttempts = Math.max(minH, minH + draw);
  return {
    ...best,
    attempts: 0,
    rolls: 0,
    maxAttempts,
    selectedTurn: currentTurnId(game),
  };
}

function ensurePusherTurnState(state, game, rng) {
  const turnId = currentTurnId(game);
  if (state.turnId === turnId) return state.motif;
  state.turnId = turnId;
  state.rollsThisTurn = 0;
  state.recentSums = [];
  const seat = game.current;
  state.aggressive = decidePusherAggression(game, seat, rng);
  state.motif = selectPusherMotif(game, seat, rng, state.aggressive);
  return state.motif;
}

function resolvePlanPiece(game, seat, plan) {
  if (!plan || typeof plan.pieceIndex !== 'number') return null;
  const pl = game.players[seat];
  return pl.pieces[plan.pieceIndex] || null;
}

function inferPlanLaneSum(game, seat, candidate) {
  const { plan, sum, type } = candidate;
  if (plan && plan.action === 'top_swoop' && plan.target) return LANES[plan.target.r].sum;
  if (type === 'swoop' && plan && plan.target) return LANES[plan.target.r].sum;
  if (plan && plan.action === 'move' && plan.target) return LANES[plan.target.r].sum;
  if (plan && plan.spawn) return sum ?? null;
  if (typeof sum === 'number') return sum;
  const piece = resolvePlanPiece(game, seat, plan);
  if (piece) return LANES[piece.r].sum;
  return null;
}

function motifAlignmentScore(game, seat, candidate, motif, roll, turnStats, state) {
  if (!motif) return 0;
  const laneSum = inferPlanLaneSum(game, seat, candidate);
  if (laneSum === null) return 0;
  const me = game.players[seat];
  const tokens = me.swoopTokens || 0;
  const isPrimary = motif.primarySet.has(laneSum);
  const isSecondary = motif.secondarySet.has(laneSum);
  const withinWindow = motif.attempts < motif.maxAttempts;
  const stageFactor = withinWindow ? 1 : -0.6;
  let score = 0;

  if (motif.allSet.has(laneSum)) {
    score += motif.hitProb * PUSHER_WEIGHTS.PROB_WEIGHT * stageFactor * (isPrimary ? 1 : 0.65);
  }
  if (isPrimary) score += PUSHER_WEIGHTS.PRIMARY_BONUS * stageFactor;
  if (isSecondary) score += PUSHER_WEIGHTS.SECONDARY_BONUS * stageFactor;
  if (motif.category === 'anchor' && isPrimary) score += PUSHER_WEIGHTS.ANCHOR_BONUS;

  if (isPrimary || isSecondary) {
    let bestJoint = 0;
    for (const [a, b] of motif.combos) {
      if (a !== laneSum && b !== laneSum) continue;
      const other = a === laneSum ? b : a;
      if (hasDisjointPair(roll, laneSum, other)) {
        const jointProb = probabilityJoint(laneSum, other);
        if (jointProb > bestJoint) bestJoint = jointProb;
      }
    }
    if (bestJoint > 0) {
      score += bestJoint * PUSHER_WEIGHTS.JOINT_BONUS;
    }
  }

  const piece = resolvePlanPiece(game, seat, candidate.plan);
  if (piece) {
    const lane = LANES[piece.r];
    if (!piece.carrying && piece.step >= lane.L - 1) score += PUSHER_WEIGHTS.NEAR_TOP_BONUS;
    if (piece.carrying && piece.step <= 2) score += PUSHER_WEIGHTS.CARRY_NEAR_HOME_BONUS;
    if (tileTypeAt(piece.r, piece.step) === 'Deterrent') score -= PUSHER_WEIGHTS.HAZARD_PENALTY;
  }

  const recent = state.recentSums && state.recentSums[state.recentSums.length - 1];
  if (typeof recent === 'number' && Math.abs(recent - laneSum) <= 1) {
    score += PUSHER_WEIGHTS.RECENT_MATCH_BONUS;
  }

  if (candidate.type === 'swoop') {
    if ((turnStats?.actionsThisTurn || 0) >= 3 && typeof recent === 'number' && Math.abs(recent - laneSum) === 1) {
      score += PUSHER_WEIGHTS.ADJACENT_SWOOP_BONUS * (1 + motif.hitProb);
    }
    if (tokens <= 1) score -= PUSHER_WEIGHTS.TOKEN_LOW_PENALTY * 0.5;
    if (state.aggressive) score += PUSHER_WEIGHTS.AGGRESSIVE_TOKEN_RELIEF;
  }

  if (!withinWindow) score -= PUSHER_WEIGHTS.STALE_PENALTY;
  return score;
}

function scorePusherCandidate(game, seat, candidate, motif, roll, turnStats, state, rng) {
  let score = candidate.value;
  score += motifAlignmentScore(game, seat, candidate, motif, roll, turnStats, state);
  if (state.aggressive) score += 35;
  if (motif && motif.risk === 'long' && motif.attempts < motif.maxAttempts) score += PUSHER_WEIGHTS.CONTINUE_BONUS;
  score += (rng() - 0.5) * PUSHER_WEIGHTS.RANDOM_NOISE;
  return score;
}

function registerPusherDecision(state, motif, laneSum) {
  if (Array.isArray(state.recentSums)) {
    if (typeof laneSum === 'number') {
      state.recentSums.push(laneSum);
      if (state.recentSums.length > 4) state.recentSums.shift();
    }
  }
  if (motif) {
    motif.attempts += 1;
    motif.rolls += 1;
  }
}

function chooseActionPusher(ctx, state) {
  const { game, roll, rng, turnStats } = ctx;
  const allowedSet = Array.isArray(ctx.allowedSums) && ctx.allowedSums.length ? new Set(ctx.allowedSums) : null;
  const seat = game.current;
  const localRng = state.rng || rng || Math.random;
  const motif = ensurePusherTurnState(state, game, localRng);
  if (motif) motif.rolls += 1;
  state.rollsThisTurn = (state.rollsThisTurn || 0) + 1;

  const depth = PUSHER_SEARCH.DEPTH;
  let movePlans = generateMovePlans(game, roll, seat, depth, localRng);
  if (allowedSet) {
    movePlans = movePlans.filter((cand) => allowedSet.has(cand.sum));
  }
  let swoopPlans = generateSwoopPlans(game, seat, depth, localRng);
  if (allowedSet) {
    // Allow swoops only if they respect forced sums when applicable (sum may be 0 for generic swoop)
    swoopPlans = swoopPlans.filter((cand) => cand.type === 'swoop' || allowedSet.has(cand.sum));
  }
  const candidates = movePlans.concat(swoopPlans);

  if (candidates.length === 0) {
    if (motif) motif.attempts += 1;
    return { type: 'bust' };
  }

  let best = null;
  let bestScore = -Infinity;
  for (const cand of candidates) {
    const score = scorePusherCandidate(game, seat, cand, motif, roll, turnStats, state, localRng);
    if (score > bestScore) {
      bestScore = score;
      best = cand;
    }
  }

  if (!best) {
    if (motif) motif.attempts += 1;
    return { type: 'bust' };
  }

  const laneSum = inferPlanLaneSum(game, seat, best);
  registerPusherDecision(state, motif, laneSum);

  if (best.type === 'swoop') {
    return {
      type: 'swoop',
      sum: best.sum,
      plan: best.plan,
      pcIndex: best.plan ? best.plan.pieceIndex : undefined,
      target: best.plan ? best.plan.target : undefined,
    };
  }

  return {
    type: 'move',
    sum: best.sum,
    plan: best.plan,
  };
}

function shouldBankPusher(turnStats, rng, game, state) {
  const seat = game.current;
  const localRng = state.rng || rng || Math.random;
  const motif = ensurePusherTurnState(state, game, localRng);
  const me = game.players[seat];
  const tokens = me.swoopTokens || 0;
  const opponents = game.players.filter((_, idx) => idx !== seat);
  const maxOppScore = opponents.reduce((acc, pl) => Math.max(acc, pl.score), 0);
  const totalScore = game.players.reduce((acc, pl) => acc + pl.score, 0);
  const earlyGame = totalScore <= 1;

  if (turnStats.deliveredThisTurn > 0) return true;
  if (me.pieces.some((pc) => pc.carrying && pc.step === 1)) return true;

  const carryingNearHome = me.pieces.some((pc) => pc.carrying && pc.step <= 2);
  if (carryingNearHome && turnStats.actionsThisTurn >= 1) {
    if (!(earlyGame && tokens === 0 && motif && motif.risk === 'long')) {
      return true;
    }
  }

  if (earlyGame && tokens === 0 && motif && motif.risk === 'long' && motif.attempts < motif.maxAttempts) {
    return false;
  }

  const { value: evBank } = simulateBankValue(game, seat);
  const samples = PUSHER_SEARCH.BANK_SAMPLES;
  let evContinueTotal = 0;
  for (let i = 0; i < samples; i++) {
    const futureRoll = roll4(rng);
    evContinueTotal += evaluateRollOutcome(game, seat, futureRoll, PUSHER_SEARCH.DEPTH, rng);
  }
  const evContinue = evContinueTotal / samples;

  let margin = PUSHER_SEARCH.BASE_MARGIN;
  if (tokens >= 2) margin -= PUSHER_SEARCH.TOKEN_MARGIN_STEP;
  if (tokens === 0) margin += PUSHER_SEARCH.LOW_TOKEN_MARGIN;
  if (motif) {
    if (motif.risk === 'short') margin += PUSHER_SEARCH.SHORT_RISK_MARGIN;
    if (motif.risk === 'long') margin += PUSHER_SEARCH.LONG_RISK_MARGIN;
    if (motif.attempts < motif.maxAttempts) margin -= 15;
  }
  if (state.aggressive) margin += PUSHER_SEARCH.AGGRESSIVE_MARGIN_SHIFT;
  if (earlyGame && tokens === 0 && motif && motif.risk === 'long') margin += PUSHER_SEARCH.EARLY_LONG_SHIFT;
  if (me.score < maxOppScore) margin -= 10;

  return evBank + margin >= evContinue;
}

function shouldTransferPusher(turnStats, rng, game, state) {
  const seat = game.current;
  const localRng = state.rng || rng || Math.random;
  const motif = ensurePusherTurnState(state, game, localRng);
  const me = game.players[seat];
  if (!canTransfer(game, me)) return null;

  let best = null;
  let bestScore = 0;
  for (const source of me.pieces) {
    if (!source.carrying) continue;
    const targets = getTransferTargets(game, source, me);
    for (const target of targets) {
      if (!target || target.carrying) continue;
      let score = 0;
      const stepGain = source.step - target.step;
      score += stepGain * 110;
      if (target.step === 1) score += 320;
      const laneSum = LANES[target.r].sum;
      if (motif && motif.allSet.has(laneSum)) score += 140;
      if (tileTypeAt(source.r, source.step) === 'Deterrent') score += 180;
      if (tileTypeAt(target.r, target.step) === 'Checkpoint') score += 60;
      if (score > bestScore) {
        bestScore = score;
        best = { source, target };
      }
    }
  }
  return best && bestScore > 0 ? best : null;
}

function chooseActionPro(ctx) {
  const { game, rng, roll } = ctx;
  const allowedSet = Array.isArray(ctx.allowedSums) && ctx.allowedSums.length ? new Set(ctx.allowedSums) : null;
  const seat = game.current;
  let movePlans = generateMovePlans(game, roll, seat, PRO_SEARCH.DEPTH, rng);
  if (allowedSet) {
    movePlans = movePlans.filter((cand) => allowedSet.has(cand.sum));
  }
  let swoopPlans = generateSwoopPlans(game, seat, PRO_SEARCH.DEPTH, rng);
  if (allowedSet) {
    // Always allow swoops; filtering here keeps API consistent if future variants use sum values
    swoopPlans = swoopPlans.filter((cand) => cand.type === 'swoop' || allowedSet.has(cand.sum));
  }
  const candidates = movePlans.concat(swoopPlans);

  if (candidates.length === 0) {
    return { type: 'bust' };
  }

  candidates.forEach((cand) => {
    cand.score = cand.value + (rng() - 0.5) * PRO_SEARCH.NOISE;
  });

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];

  if (best.type === 'swoop') {
    return { type: 'swoop', sum: best.sum, pcIndex: best.plan.pieceIndex, target: best.plan.target, plan: best.plan };
  }

  return { type: 'move', sum: best.sum, plan: best.plan };
}

function simulateBankValue(game, seat) {
  const clone = cloneGameForSearch(game);
  const delivered = bank(clone);
  clone.current = seat;
  // banking gives a token via bank(), already applied in clone
  return { value: evaluateState(clone, seat), delivered };
}

function shouldBankPro(turnStats, rng, game) {
  const seat = game.current;
  const me = game.players[seat];

  if (turnStats.deliveredThisTurn > 0) return true;
  if (me.pieces.some((pc) => pc.carrying && pc.step === 1)) return true;

  const { value: evBank } = simulateBankValue(game, seat);

  const samples = PRO_SEARCH.BANK_SAMPLES;
  let total = 0;
  for (let i = 0; i < samples; i++) {
    const roll = roll4(rng);
    const val = evaluateRollOutcome(game, seat, roll, PRO_SEARCH.DEPTH, rng);
    total += val;
  }
  const evContinue = total / samples;

  const tokens = me.swoopTokens || 0;
  let margin = PRO_SEARCH.BANK_MARGIN;
  if (tokens >= 2) margin -= PRO_SEARCH.TOKEN_MARGIN_STEP;
  else if (tokens === 1) margin -= PRO_SEARCH.SINGLE_TOKEN_MARGIN_STEP;
  if (hasCheckpointSwoop(game, me)) margin -= PRO_SEARCH.CHECKPOINT_SWEEP_MARGIN;

  // Extra risk-taking on first roll when at max tokens (2) - banking won't give more tokens
  if (turnStats.actionsThisTurn === 0 && tokens >= 2) {
    margin -= 30; // Additional 30 point reduction in banking margin for first roll with max tokens
  }

  return evBank + margin >= evContinue;
}

function shouldTransferPro(turnStats, rng, game) {
  const seat = game.current;
  const pl = game.players[seat];
  if (!canTransfer(game, pl)) return null;

  const carrying = pl.pieces
    .map((pc, idx) => ({ pc, idx }))
    .filter(({ pc }) => pc.carrying);

  for (const { pc, idx } of carrying) {
    const targets = getTransferTargets(game, pc, pl);
    const better = targets
      .map((target) => ({ target, idx: pl.pieces.indexOf(target) }))
      .filter(({ target }) => target.step < pc.step);
    if (better.length > 0) {
      better.sort((a, b) => a.target.step - b.target.step);
      return { source: pc, target: better[0].target };
    }
  }
  return null;
}

function createBot(type, rng) {
  switch (type) {
    case 'aggressive':
      return {
        chooseAction: chooseActionBot1,
        shouldBank: (t, r, g) => shouldBankAggressive(t, g),
        shouldTransfer: (t, r, g) => shouldTransferAggressive(t, r, g)
      };
    case 'pusher': {
      const state = {
        rng: rng || Math.random,
        turnId: null,
        motif: null,
        rollsThisTurn: 0,
        aggressive: false,
        recentSums: [],
      };
      return {
        chooseAction: (ctx) => chooseActionPusher(ctx, state),
        shouldBank: (t, r, g) => shouldBankPusher(t, r, g, state),
        shouldTransfer: (t, r, g) => shouldTransferPusher(t, r, g, state),
      };
    }
    case 'pro':
      return {
        chooseAction: chooseActionPro,
        shouldBank: (t, r, g) => shouldBankPro(t, r, g),
        shouldTransfer: (t, r, g) => shouldTransferPro(t, r, g)
      };
    case 'balanced':
      return {
        chooseAction: chooseActionBot2,
        shouldBank: (t, r, g) => shouldBankBalanced(t, r, g),
        shouldTransfer: (t, r, g) => shouldTransferBalanced(t, r, g)
      };
    case 'conservative':
      return {
        chooseAction: chooseActionConservative,
        shouldBank: (t, r, g) => shouldBankConservative(t, g),
        shouldTransfer: (t, r, g) => shouldTransferConservative(t, r, g)
      };
    default:
      return createBot('balanced', rng);
  }
}

// Renamed banking functions for clarity
function shouldBankAggressive(turnStats, game) {
  const pl = game.players[game.current];

  // Bank immediately if delivered this turn
  if (turnStats.deliveredThisTurn > 0) return true;

  // Bank if we have pieces carrying baskets at step 1 (ready to deliver)
  const readyToDeliver = pl.pieces.some(pc => pc.carrying && pc.step === 1);
  if (readyToDeliver) return true;

  // Bank after 3 actions (aggressive)
  if (turnStats.actionsThisTurn >= 3) return true;

  // Bank if we have 2 active pieces and have taken actions
  if (activeCount(pl) >= 2 && turnStats.actionsThisTurn >= 1) return true;

  return false;
}

// Transfer decision functions
function shouldTransferAggressive(turnStats, rng, game) {
  const pl = game.players[game.current];
  if (!canTransfer(game, pl)) return null;

  // Aggressive: Transfer to pieces closer to home (lower steps) if carrying
  const carryingPieces = pl.pieces.filter(pc => pc.carrying);
  for (const source of carryingPieces) {
    const targets = getTransferTargets(game, source, pl);
    // Prefer targets with lower step numbers (closer to home)
    const betterTargets = targets.filter(t => t.step < source.step);
    if (betterTargets.length > 0) {
      betterTargets.sort((a, b) => a.step - b.step);
      return { source, target: betterTargets[0] };
    }
  }
  return null;
}

function shouldTransferBalanced(turnStats, rng, game) {
  const pl = game.players[game.current];
  if (!canTransfer(game, pl)) return null;

  // Balanced: Transfer occasionally to spread risk
  if (rng() > 0.3) return null; // 30% chance to consider transfer

  const carryingPieces = pl.pieces.filter(pc => pc.carrying);
  for (const source of carryingPieces) {
    const targets = getTransferTargets(game, source, pl);
    if (targets.length > 0) {
      // Choose random target
      const target = targets[Math.floor(rng() * targets.length)];
      return { source, target };
    }
  }
  return null;
}

function shouldTransferConservative(turnStats, rng, game) {
  const pl = game.players[game.current];
  if (!canTransfer(game, pl)) return null;

  // Conservative: Only transfer if piece is in danger (on high step)
  const carryingPieces = pl.pieces.filter(pc => pc.carrying);
  for (const source of carryingPieces) {
    const L = LANES[source.r].L;
    const sum = LANES[source.r].sum;
    const dets = deterrents(L, sum);

    // Transfer if carrying piece is close to a deterrent
    const nearDeterrent = dets.some(det => Math.abs(det - source.step) <= 2);
    if (nearDeterrent) {
      const targets = getTransferTargets(game, source, pl);
      const saferTargets = targets.filter(t => {
        const tL = LANES[t.r].L;
        const tSum = LANES[t.r].sum;
        const tDets = deterrents(tL, tSum);
        return !tDets.some(det => Math.abs(det - t.step) <= 2);
      });
      if (saferTargets.length > 0) {
        return { source, target: saferTargets[0] };
      }
    }
  }
  return null;
}

function shouldBankBalanced(turnStats, rng, game) {
  const pl = game.players[game.current];

  // Bank immediately if delivered this turn
  if (turnStats.deliveredThisTurn > 0) return true;

  // Bank if we have pieces carrying baskets at step 1
  const readyToDeliver = pl.pieces.some(pc => pc.carrying && pc.step === 1);
  if (readyToDeliver) return true;

  // Bank if we have pieces carrying baskets and close to home
  const carryingNearHome = pl.pieces.some(pc => pc.carrying && pc.step <= 2);
  if (carryingNearHome && turnStats.actionsThisTurn >= 1) return true;

  // Bank after 4 actions
  if (turnStats.actionsThisTurn >= 4) return true;

  // 10% random bank pressure
  return rng() < 0.10;
}

function shouldBankConservative(turnStats, game) {
  const pl = game.players[game.current];

  // Bank immediately if delivered this turn
  if (turnStats.deliveredThisTurn > 0) return true;

  // Bank if we have pieces carrying baskets at step 1
  const readyToDeliver = pl.pieces.some(pc => pc.carrying && pc.step === 1);
  if (readyToDeliver) return true;

  // Bank if we have any pieces carrying baskets
  const hasCarrying = pl.pieces.some(pc => pc.carrying);
  if (hasCarrying) return true;

  // Bank after 2 actions (very conservative)
  if (turnStats.actionsThisTurn >= 2) return true;

  return false;
}

// Conservative bot action choice
function chooseActionConservative(ctx) {
  const { game, rng } = ctx;
  const pl = game.players[game.current];
  const { pairs } = ctx.roll;

  const usable = pairs.filter((p) => canMoveOnSum(game, pl, p.sum));
  if (usable.length === 0) return { type: 'bust' };

  // Prefer highest sum (simple and safe)
  usable.sort((a, b) => b.sum - a.sum);
  const chosen = usable[0];

  // Prefer Move over Swoop (conservative)
  if (canMoveOnSum(game, pl, chosen.sum)) return { type: 'move', sum: chosen.sum, pair: chosen };

  // Only swoop if no move available
  const pcs = eligibleSwoopPiecesForSum(game, pl, chosen.sum);
  for (const pc of pcs) {
    const targs = potentialSwoops(game, pc);
    if (targs.length) {
      // Pick first available target (simple)
      return { type: 'swoop', sum: chosen.sum, pc, target: targs[0] };
    }
  }
  return { type: 'bust' };
}

// --- Run many rounds ---
function runSimulation({ rounds, target, seed, saveReport = false, botType1 = 'aggressive', botType2 = 'balanced', maxTurns = 1000, verbose = false }) {
  // Fixed target score of 2 baskets for victory
  const VICTORY_TARGET = 2;
  const rng = makeRng(seed);

  const bots = [
    createBot(botType1, rng),
    createBot(botType2, rng),
  ];

  const agg = {
    games: 0,
    wins: [],
    turns: 0,
    turnsByPlayer: [],
    rolls: 0,
    busts: 0,
    banks: 0,
    deliveries: 0,
    transfers: 0,
  };

  const allGameData = []; // Store detailed game data for report

  for (let i = 0; i < rounds; i++) {
    if (verbose && i % 10 === 0) {
      console.log(`Starting game ${i + 1}/${rounds}...`);
    }

    const { winner, metrics, game } = playGame(VICTORY_TARGET, rng, bots, i, maxTurns, verbose);
    agg.games++;
    if (agg.wins.length !== metrics.playerCount) {
      agg.wins = Array.from({ length: metrics.playerCount }, () => 0);
      agg.turnsByPlayer = Array.from({ length: metrics.playerCount }, () => 0);
    }
    agg.wins[winner]++;
    agg.turns += metrics.turns;
    for (let seat = 0; seat < metrics.turnsByPlayer.length; seat++) {
      agg.turnsByPlayer[seat] += metrics.turnsByPlayer[seat] || 0;
    }
    agg.rolls += metrics.rolls;
    agg.busts += metrics.busts;
    agg.banks += metrics.banks;
    agg.deliveries += metrics.deliveries;
    agg.transfers += metrics.transfers || 0;

    // Store game data for detailed report
    if (saveReport) {
      allGameData.push({
        gameIndex: i,
        winner: winner,
        finalScores: [game.players[0].score, game.players[1].score],
        metrics: metrics,
        moveHistory: game.moveHistory
      });
    }
  }

  // Derived metrics
  const summary = {
    games_played: agg.games,
    wins: agg.wins,
    win_rate_bot1: agg.wins[0] / agg.games,
    avg_turns_per_game: agg.turns / agg.games,
    avg_turns_per_player: agg.turnsByPlayer.map((t) => t / agg.games),
    avg_rolls_per_game: agg.rolls / agg.games,
    avg_busts_per_game: agg.busts / agg.games,
    avg_banks_per_game: agg.banks / agg.games,
    avg_deliveries_per_game: agg.deliveries / agg.games,
    notes: [
      'Tailwind reactions have been retired; bots now play without reactive phases.',
      'Simulation enforces the new swoop-token cap and last-seat token rule.',
      'Future improvements: adaptive banking, lane congestion awareness, opponent threat modeling.'
    ],
  };
  summary.wins_bot1 = summary.wins[0] ?? 0;
  summary.wins_bot2 = summary.wins[1] ?? 0;
  summary.avg_turns_bot1 = summary.avg_turns_per_player[0] ?? 0;
  summary.avg_turns_bot2 = summary.avg_turns_per_player[1] ?? 0;

  // Generate detailed report if requested
  if (saveReport) {
    const report = generateDetailedReport(summary, allGameData, { rounds, target, seed });
    return { summary, report };
  }

  return summary;
}

// --- Generate detailed JSON report ---
function generateDetailedReport(summary, allGameData, config) {
  const report = {
    metadata: {
      generated_at: new Date().toISOString(),
      simulation_config: config,
      total_games: allGameData.length,
      version: 'v1.0'
    },
    summary: summary,
    gameplay_analysis: analyzeGameplay(allGameData),
    games: allGameData
  };

  return report;
}

function analyzeGameplay(allGameData) {
  const analysis = {
    move_patterns: {},
    decision_patterns: {},
    turn_length_distribution: [],
    score_progression: [],
    common_sequences: []
  };

  // Analyze move patterns
  const moveTypes = {};
  const decisionTypes = {};
  const turnLengths = [];

  for (const game of allGameData) {
    let currentTurnLength = 0;
    let turnStarted = false;

    for (const move of game.moveHistory) {
      // Count move types
      if (moveTypes[move.type]) {
        moveTypes[move.type]++;
      } else {
        moveTypes[move.type] = 1;
      }

      // Track turn lengths
      if (move.type === 'turn_start') {
        if (turnStarted) {
          turnLengths.push(currentTurnLength);
        }
        currentTurnLength = 0;
        turnStarted = true;
      } else if (move.type === 'decision') {
        currentTurnLength++;
        // Count decision types
        const decType = move.decision.type;
        if (decisionTypes[decType]) {
          decisionTypes[decType]++;
        } else {
          decisionTypes[decType] = 1;
        }
      }
    }
    if (turnStarted) {
      turnLengths.push(currentTurnLength);
    }
  }

  analysis.move_patterns = moveTypes;
  analysis.decision_patterns = decisionTypes;
  analysis.turn_length_distribution = {
    min: Math.min(...turnLengths),
    max: Math.max(...turnLengths),
    avg: turnLengths.reduce((a, b) => a + b, 0) / turnLengths.length,
    distribution: turnLengths
  };

  return analysis;
}

// --- CLI ---
function parseArgs(argv) {
  const out = {
    rounds: 100,
    target: 5,
    seed: undefined,
    saveReport: false,
    reportFile: null,
    botType1: 'aggressive',
    botType2: 'balanced',
    maxTurns: 1000,
    verbose: false
  };

  for (const a of argv.slice(2)) {
    const [k, v] = a.split('=');
    if (k === '--rounds') out.rounds = Number(v);
    else if (k === '--target') out.target = Number(v);
    else if (k === '--seed') out.seed = isNaN(Number(v)) ? v : Number(v);
    else if (k === '--report') out.saveReport = true;
    else if (k === '--report-file') {
      out.saveReport = true;
      out.reportFile = v;
    }
    else if (k === '--bot1') out.botType1 = v;
    else if (k === '--bot2') out.botType2 = v;
    else if (k === '--max-turns') out.maxTurns = Number(v);
    else if (k === '--verbose') out.verbose = true;
    else if (k === '--help') {
      console.log(`
Swoop Simulation Tool

Usage: node src/sim/simulate.js [options]

Options:
  --rounds=N          Number of games to simulate (default: 100)
  --target=N          Target score to win (fixed at 2 baskets)
  --seed=S            Random seed for reproducibility (default: random)
  --report            Generate detailed JSON report
  --report-file=FILE  Custom filename for report
  --bot1=TYPE         Bot 1 strategy: aggressive, balanced, conservative, pro, pusher (default: aggressive)
  --bot2=TYPE         Bot 2 strategy: aggressive, balanced, conservative, pro, pusher (default: balanced)
  --max-turns=N       Maximum turns per game to prevent infinite loops (default: 1000)
  --verbose           Enable verbose logging
  --help              Show this help message

Examples:
  node src/sim/simulate.js --rounds=50 --target=3 --seed=42
  node src/sim/simulate.js --rounds=10 --report --bot1=conservative --bot2=aggressive
      `);
      process.exit(0);
    }
  }
  return out;
}

const createProBot = (rng) => createBot('pro', rng);
const createPusherBot = (rng) => createBot('pusher', rng);

const commonExports = {
  createBot,
  createProBot,
  createPusherBot,
  makeRng,
  roll4,
  LANES,
  MAX_STEP,
  TILE_MAP,
  mapStepToGrid,
  tileTypeAt,
  tileExistsAt,
  tileTypeAtSpace,
  snapDownSpace,
  stepForSpace,
  checkpoints,
  deterrents,
  PRO_SEARCH,
  PRO_WEIGHTS,
  runSimulation,
  parseArgs,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = commonExports;
}

export {
  createBot,
  createProBot,
  createPusherBot,
  makeRng,
  roll4,
  LANES,
  MAX_STEP,
  TILE_MAP,
  mapStepToGrid,
  tileTypeAt,
  tileExistsAt,
  tileTypeAtSpace,
  snapDownSpace,
  stepForSpace,
  checkpoints,
  deterrents,
  PRO_SEARCH,
  PRO_WEIGHTS,
  runSimulation,
  parseArgs,
};
