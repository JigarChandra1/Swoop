#!/usr/bin/env node
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
  out.push(L); // Last step is always a checkpointer
  return [...new Set(out)].filter((x) => x >= 1 && x <= L);
}

function deterrents(L, sum) {
  if (L <= 3) return [];
  const det = [3, L - 2];
  if ((sum === 6 || sum === 8) && L >= 5) det.push(5);
  const cps = checkpoints(L);
  return [...new Set(det)].filter((x) => x >= 1 && x <= L && !cps.includes(x));
}

const oddSlope = { 3: +1, 5: -1, 7: -1, 9: -1, 11: +1 };

// Add missing deterrents function from main game
function deterrents(L, sum) {
  const det = [];
  if (L >= 4) det.push(3);
  if ((sum === 6 || sum === 8) && L >= 5) det.push(5);
  const cps = checkpoints(L);
  return [...new Set(det)].filter((x) => x >= 1 && x <= L && !cps.includes(x));
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

// --- Game state helpers ---
function initialGame() {
  return {
    players: [
      { name: 'Bot1', side: 'L', score: 0, pieces: [] },
      { name: 'Bot2', side: 'R', score: 0, pieces: [] },
    ],
    current: 0,
    baskets: LANES.map((l) => l.basket),
    moveHistory: [], // Track all moves for analysis
  };
}

function occupied(game, r, side, step) {
  for (const pl of game.players) {
    if (pl.pieces.some((pc) => pc.r === r && pc.side === side && pc.step === step)) return true;
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
  let pc = pieceOnLane(pl, r);
  const side = pl.side;
  if (pc) {
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
  if (pl.pieces.length >= 5 || activeCount(pl) >= 2) return null;
  if (occupied(game, r, side, 1)) return null;
  pc = { r, side, step: 1, carrying: false, active: true };
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

function canMoveOnSum(game, pl, sum) {
  const r = LANES.findIndex((x) => x.sum === sum);
  if (r < 0) return false;
  const pc = pieceOnLane(pl, r);
  if (pc) {
    const L = LANES[pc.r].L;
    const dir = pc.carrying ? -1 : +1;
    const ns = pc.step + dir;
    return ns >= 1 && ns <= L && !occupied(game, pc.r, pc.side, ns);
  } else {
    return pl.pieces.length < 5 && !occupied(game, r, pl.side, 1) && activeCount(pl) < 2;
  }
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

function advanceOne(game, pc) {
  const L = LANES[pc.r].L;
  const dir = pc.carrying ? -1 : +1;
  const oldStep = pc.step;
  const ns = pc.step + dir;
  if (ns >= 1 && ns <= L && !occupied(game, pc.r, pc.side, ns)) {
    pc.step = ns;
    afterMovePickup(game, pc);
    // Log piece movement
    game.moveHistory.push({
      type: 'move',
      player: game.current,
      piece: { r: pc.r, from: oldStep, to: pc.step },
      carrying: pc.carrying,
      turn: game.moveHistory.filter(m => m.type === 'turn_start').length
    });
    return true;
  }
  return false;
}

function potentialSwoops(game, pc) {
  const targets = [];
  const r = pc.r;
  const L = LANES[r].L;
  const sum = LANES[r].sum;
  const atOddTop = sum % 2 === 1 && pc.step === L - 1;
  for (const dr of [-1, +1]) {
    const r2 = r + dr;
    if (r2 < 0 || r2 >= LANES.length) continue;
    let step2 = pc.step;
    if (atOddTop) {
      step2 = Math.min(LANES[r2].L, Math.max(1, pc.step + oddSlope[sum]));
    }
    step2 = Math.min(LANES[r2].L, step2);
    if (!occupied(game, r2, pc.side, step2)) targets.push({ r: r2, step: step2 });
  }
  return targets;
}

function eligibleSwoopPiecesForSum(game, pl, sum) {
  const selectedLaneIndex = LANES.findIndex((lane) => lane.sum === sum);
  if (selectedLaneIndex < 0) return [];
  const adj = [selectedLaneIndex - 1, selectedLaneIndex + 1].filter((i) => i >= 0 && i < LANES.length);
  const adjSums = adj.map((i) => LANES[i].sum);
  return pl.pieces.filter((p) => p.active && adjSums.includes(LANES[p.r].sum));
}

function canSwoopWithSum(game, pl, sum) {
  for (const pc of eligibleSwoopPiecesForSum(game, pl, sum)) {
    if (potentialSwoops(game, pc).length > 0) return true;
  }
  return false;
}

function anyActionForSum(game, pl, sum) {
  return canMoveOnSum(game, pl, sum) || canSwoopWithSum(game, pl, sum);
}

function resolveDeterrents(game, pl) {
  const kept = [];
  for (const pc of pl.pieces) {
    const L = LANES[pc.r].L;
    const sum = LANES[pc.r].sum;
    const dets = deterrents(L, sum);
    const onDet = dets.includes(pc.step);
    if (onDet) {
      if (pc.carrying && LANES[pc.r].basket) game.baskets[pc.r] = true; // return basket
      continue; // removed
    }
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
    const cps = checkpoints(L);

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
      for (const c of cps) if (c <= pc.step) dest = c;
      if (dest !== null) {
        pc.step = dest;
        kept.push(pc);
      }
      // if dest is null, the piece falls off (removed)
    }
  }

  pl.pieces = kept;
  pl.score += delivered;
  resolveDeterrents(game, pl);
  for (const p of pl.pieces) p.active = false;
  game.current = 1 - game.current;
  return delivered;
}

// --- Tailwind: simple policy for the non-active player ---
function tailwind(game, metrics) {
  const opp = game.players[1 - game.current];
  const side = opp.side;

  // Try to advance a carrying piece toward home first
  const candidates = [...opp.pieces];
  for (const pc of candidates) {
    const L = LANES[pc.r].L;
    const dir = pc.carrying ? -1 : +1;
    const ns = pc.step + dir;
    if (ns >= 1 && ns <= L && !occupied(game, pc.r, pc.side, ns)) {
      pc.step = ns;
      afterMovePickup(game, pc);
      metrics.tailwindAdvances++;
      return true;
    }
  }

  // Otherwise, spawn if possible
  if (opp.pieces.length < 5) {
    for (let r = 0; r < LANES.length; r++) {
      if (!occupied(game, r, side, 1)) {
        opp.pieces.push({ r, side, step: 1, carrying: false, active: false });
        metrics.tailwindSpawns++;
        return true;
      }
    }
  }

  return false; // no-op
}

// --- Dice ---
function r6(rng) {
  return 1 + Math.floor(rng() * 6);
}

function roll3(rng) {
  const d = [r6(rng), r6(rng), r6(rng)];
  const pairs = [
    { i: 0, j: 1, sum: d[0] + d[1] },
    { i: 0, j: 2, sum: d[0] + d[2] },
    { i: 1, j: 2, sum: d[1] + d[2] },
  ];
  return { d, pairs };
}

// --- Bot policies ---
// Bot 1: prefers highest odd sums (11 > 9 > 7 > 5 > 3), else highest sum; banks when it delivered this turn or after 3 actions
function chooseActionBot1(ctx) {
  const { game, rng } = ctx;
  const pl = game.players[game.current];
  const { pairs } = ctx.roll;

  // Filter pairs with any available action
  const usable = pairs.filter((p) => anyActionForSum(game, pl, p.sum));
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
  if (canMoveOnSum(game, pl, chosen.sum)) return { type: 'move', sum: chosen.sum };
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

  const usable = pairs.filter((p) => anyActionForSum(game, pl, p.sum));
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
    if (rng() < 0.6) return { type: 'move', sum: chosen.sum }; // slight tilt to move
    // pick random eligible swoop
    const pcs = eligibleSwoopPiecesForSum(game, pl, chosen.sum).filter((pc) => potentialSwoops(game, pc).length > 0);
    const pc = pcs[Math.floor(rng() * pcs.length)];
    const targs = potentialSwoops(game, pc);
    const target = targs[Math.floor(rng() * targs.length)];
    return { type: 'swoop', sum: chosen.sum, pc, target };
  }
  if (canMove) return { type: 'move', sum: chosen.sum };
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

  // Pre-roll decision: may bank before rolling
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
    const roll = roll3(rng);
    metrics.rolls++;

    // Log dice roll
    game.moveHistory.push({
      type: 'roll',
      player: game.current,
      dice: roll.d,
      pairs: roll.pairs,
      turn: game.moveHistory.filter(m => m.type === 'turn_start').length
    });

    // Check if any pair can do anything at all
    const usable = roll.pairs.filter((p) => anyActionForSum(game, pl, p.sum));
    if (usable.length === 0) {
      // Bust
      // Apply bust consequences similar to bank minus sliding outward (we follow app behavior: skip slide, apply dets, deliveries, deactivate)
      const delivered = applyBust(game);
      turnStats.deliveredThisTurn += delivered;
      metrics.busts++;
      metrics.deliveries += delivered;
      metrics.turns++;
      metrics.turnsByPlayer[game.current]++;
      return;
    }

    const ctx = { game, rng, roll };
    const decision = bot.chooseAction(ctx);

    // Log decision
    game.moveHistory.push({
      type: 'decision',
      player: game.current,
      decision: decision,
      turn: game.moveHistory.filter(m => m.type === 'turn_start').length
    });

    if (decision.type === 'move') {
      // Ensure or move piece
      const pc = ensurePieceForSum(game, pl, decision.sum);
      if (!pc) {
        // If ensure failed (capacity), try next best: treat as no-op and proceed to next roll
        // In practice, this is rare given conditions
      } else {
        const had = pc.step;
        if (pieceOnLane(pl, pc.r) && pc.step === had) {
          // existing piece — advance once
          if (advanceOne(game, pc)) {
            turnStats.moves++;
            turnStats.actionsThisTurn++;
            if (pc.carrying && pc.step === 1) {
              // delivery realizes only on bank/bust; we count on event
            }
          }
        } else {
          // freshly ensured; counts as action in our accounting
          turnStats.moves++;
          turnStats.actionsThisTurn++;
        }
      }
    } else if (decision.type === 'swoop') {
      // Apply swoop
      const pc = decision.pc;
      if (pc) {
        const oldR = pc.r;
        const oldStep = pc.step;
        pc.r = decision.target.r;
        pc.step = decision.target.step;

        // Log swoop
        game.moveHistory.push({
          type: 'swoop',
          player: game.current,
          piece: { from: { r: oldR, step: oldStep }, to: { r: pc.r, step: pc.step } },
          sum: decision.sum,
          turn: game.moveHistory.filter(m => m.type === 'turn_start').length
        });

        turnStats.swoops++;
        turnStats.actionsThisTurn++;
        metrics.tailwindEvents++;
        // Tailwind immediate reaction by opponent
        tailwind(game, metrics);
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
    if (!pc.active) {
      kept.push(pc);
      continue;
    }

    const L = LANES[pc.r].L;
    const sum = LANES[pc.r].sum;
    const cps = checkpoints(L);
    const dets = deterrents(L, sum);
    const onDet = dets.includes(pc.step);

    if (onDet) {
      // Piece on deterrent is removed, basket returned if carrying
      if (pc.carrying && LANES[pc.r].basket) {
        game.baskets[pc.r] = true;
      }
      continue; // piece removed
    }

    if (cps.includes(pc.step)) {
      // Already on checkpoint, stays
      kept.push(pc);
      continue;
    }

    // Move to previous checkpoint
    let dest = null;
    if (pc.carrying) {
      // Carrying pieces move to next checkpoint forward
      for (const c of cps) {
        if (c >= pc.step) {
          dest = c;
          break;
        }
      }
    } else {
      // Non-carrying pieces move to previous checkpoint
      for (const c of cps) {
        if (c <= pc.step) dest = c;
      }
    }

    if (dest === null) {
      // No valid checkpoint, piece removed
      if (pc.carrying && LANES[pc.r].basket) {
        game.baskets[pc.r] = true;
      }
    } else {
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
  game.current = 1 - game.current;
  return delivered;
}

// --- One full game to target score ---
function playGame(targetScore, rng, bots, gameIndex = 0, maxTurns = 1000, verbose = false) {
  const game = initialGame();

  const metrics = {
    turns: 0,
    turnsByPlayer: [0, 0],
    rolls: 0,
    busts: 0,
    banks: 0,
    tailwindEvents: 0,
    tailwindAdvances: 0,
    tailwindSpawns: 0,
    deliveries: 0,
  };

  // Add game start metadata
  game.moveHistory.push({
    type: 'game_start',
    gameIndex: gameIndex,
    targetScore: targetScore,
    timestamp: new Date().toISOString()
  });

  let turnCount = 0;

  while (game.players[0].score < targetScore && game.players[1].score < targetScore && turnCount < maxTurns) {
    playTurn(game, bots, rng, metrics, targetScore);
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
      game.players[Math.floor(rng() * 2)].score = targetScore;
    } else {
      const leader = game.players[0].score > game.players[1].score ? 0 : 1;
      game.players[leader].score = targetScore;
    }
  }

  const winner = game.players[0].score >= targetScore ? 0 : 1;

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
function createBot(type, rng) {
  switch (type) {
    case 'aggressive':
      return {
        chooseAction: chooseActionBot1,
        shouldBank: (t, r, g) => shouldBankAggressive(t, g)
      };
    case 'balanced':
      return {
        chooseAction: chooseActionBot2,
        shouldBank: (t, r, g) => shouldBankBalanced(t, r, g)
      };
    case 'conservative':
      return {
        chooseAction: chooseActionConservative,
        shouldBank: (t, r, g) => shouldBankConservative(t, g)
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

  const usable = pairs.filter((p) => anyActionForSum(game, pl, p.sum));
  if (usable.length === 0) return { type: 'bust' };

  // Prefer highest sum (simple and safe)
  usable.sort((a, b) => b.sum - a.sum);
  const chosen = usable[0];

  // Prefer Move over Swoop (conservative)
  if (canMoveOnSum(game, pl, chosen.sum)) return { type: 'move', sum: chosen.sum };

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
  const rng = makeRng(seed);

  const bots = [
    createBot(botType1, rng),
    createBot(botType2, rng),
  ];

  const agg = {
    games: 0,
    wins: [0, 0],
    turns: 0,
    turnsByPlayer: [0, 0],
    rolls: 0,
    busts: 0,
    banks: 0,
    tailwindEvents: 0,
    tailwindAdvances: 0,
    tailwindSpawns: 0,
    deliveries: 0,
  };

  const allGameData = []; // Store detailed game data for report

  for (let i = 0; i < rounds; i++) {
    if (verbose && i % 10 === 0) {
      console.log(`Starting game ${i + 1}/${rounds}...`);
    }

    const { winner, metrics, game } = playGame(target, rng, bots, i, maxTurns, verbose);
    agg.games++;
    agg.wins[winner]++;
    agg.turns += metrics.turns;
    agg.turnsByPlayer[0] += metrics.turnsByPlayer[0];
    agg.turnsByPlayer[1] += metrics.turnsByPlayer[1];
    agg.rolls += metrics.rolls;
    agg.busts += metrics.busts;
    agg.banks += metrics.banks;
    agg.tailwindEvents += metrics.tailwindEvents;
    agg.tailwindAdvances += metrics.tailwindAdvances;
    agg.tailwindSpawns += metrics.tailwindSpawns;
    agg.deliveries += metrics.deliveries;

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
    wins_bot1: agg.wins[0],
    wins_bot2: agg.wins[1],
    win_rate_bot1: agg.wins[0] / agg.games,
    avg_turns_per_game: agg.turns / agg.games,
    avg_turns_bot1: agg.turnsByPlayer[0] / agg.games,
    avg_turns_bot2: agg.turnsByPlayer[1] / agg.games,
    avg_rolls_per_game: agg.rolls / agg.games,
    avg_busts_per_game: agg.busts / agg.games,
    avg_banks_per_game: agg.banks / agg.games,
    avg_tailwind_events_per_game: agg.tailwindEvents / agg.games,
    avg_tailwind_advances_per_game: agg.tailwindAdvances / agg.games,
    avg_tailwind_spawns_per_game: agg.tailwindSpawns / agg.games,
    avg_deliveries_per_game: agg.deliveries / agg.games,
    notes: [
      'Enhanced bots with improved banking strategies and complete game mechanics.',
      'Includes deterrents, proper bust handling, and comprehensive move tracking.',
      'Future improvements: adaptive banking, lane congestion awareness, opponent threat modeling.'
    ],
  };

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
  --target=N          Target score to win (default: 5)
  --seed=S            Random seed for reproducibility (default: random)
  --report            Generate detailed JSON report
  --report-file=FILE  Custom filename for report
  --bot1=TYPE         Bot 1 strategy: aggressive, balanced, conservative (default: aggressive)
  --bot2=TYPE         Bot 2 strategy: aggressive, balanced, conservative (default: balanced)
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

if (require.main === module) {
  const fs = require('fs');
  const path = require('path');

  const opts = parseArgs(process.argv);
  const result = runSimulation(opts);

  if (opts.saveReport) {
    const { summary, report } = result;

    // Generate filename if not provided
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = opts.reportFile || `swoop-simulation-report-${timestamp}.json`;

    // Ensure reports directory exists
    const reportsDir = path.join(process.cwd(), 'simulation-reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const filepath = path.join(reportsDir, filename);
    fs.writeFileSync(filepath, JSON.stringify(report, null, 2));

    console.log('=== SIMULATION SUMMARY ===');
    console.log(JSON.stringify(summary, null, 2));
    console.log(`\n=== DETAILED REPORT SAVED ===`);
    console.log(`Report saved to: ${filepath}`);
    console.log(`Total moves recorded: ${report.games.reduce((sum, game) => sum + game.moveHistory.length, 0)}`);
  } else {
    // Just print summary
    console.log(JSON.stringify(result, null, 2));
  }
}

module.exports = { runSimulation };

