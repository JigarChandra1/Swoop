import React from 'react';

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

function initialGame(){
  return {
    players:[
      {name:'Monkeys', pieceIcon:'🐒', activeIcon:'🐵', score:0, swoopTokens:0, pieces:[]},
      {name:'Seagulls', pieceIcon:'🕊️', activeIcon:'🦅', score:0, swoopTokens:1, pieces:[]}
    ],
    current:0,
    rolled:null,
    selectedPair:null,
    // For Can't Stop style: list of sums left to advance this roll
    pendingAdvances:null,
    rollMovesDone:0,
    mode:'preroll',
    baskets: LANES.map(l=>l.basket),
    message:'Monkeys, roll the dice!',
    transferSource: null,
    transferTargets: null,
    pieceChoices: null,
    selectedSum: null,
    previousMode: null
  };
}

function r6(){ return 1+Math.floor(Math.random()*6); }

export default function App(){
  const [game,setGame] = React.useState(initialGame);
  const [toast, setToast] = React.useState(null);
  const [showLoadModal, setShowLoadModal] = React.useState(false);
  const [loadText, setLoadText] = React.useState('');

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

    try { localStorage.setItem('SWOOP_STATE_V60', currJson); } catch (e) {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game]);

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
    // Allow transfers during any mode of the current player's turn (except game over and opponent's tailwind)
    if(game.mode === 'gameOver') return false;
    if(game.mode === 'tailwind') return false; // Opponent's turn

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
    game.transferSource.carrying = false;
    targetPiece.carrying = true;

    showToast(`Basket transferred!`);

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
      newGame.message = `${pl.name}: Choose a pair to move or Bank/Bust.`;
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
      newGame.message = `${pl.name}: Choose a pair to move or Bank/Bust.`;
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

    if(!hasAnyMove){
      newGame.message = `${game.players[game.current].name} rolled ${d.join(' ')} — no legal pairings. Spend a Swoop token or End Turn (Busted).`;
    } else {
      newGame.message = `${game.players[game.current].name}: choose a pairing (advance both if possible).`;
    }

    setGame(newGame);
  }

  // Build a user-facing label for a pairing per BGA style: "X and Y" or "only X"
  function pairingLabel(pairing){
    const [a,b] = pairing;
    const pl = game.players[game.current];
    const canA = canMoveOnSum(pl, a.sum);
    const canB = canMoveOnSum(pl, b.sum);
    if (canA && canB) return `${a.sum} and ${b.sum}`;
    if (canA && !canB) return `only ${a.sum}`;
    if (!canA && canB) return `only ${b.sum}`;
    return `no play`;
  }

  function selectPairing(i){
    // Choose one of the 3 pairings; enforce Can't Stop advance rules
    if(game.mode!=='rolled' && game.mode!=='pairChosen' && game.mode!=='chooseSwoop' && game.mode!=='pickSwoopDest') return;
    if(!game.rolled || !game.rolled.pairings) return;

    const pairing = game.rolled.pairings[i];
    const [a,b] = pairing;
    const pl = game.players[game.current];
    const canA = canMoveOnSum(pl, a.sum);
    const canB = canMoveOnSum(pl, b.sum);

    const pending = [];
    if (canA) pending.push(a.sum);
    if (canB) pending.push(b.sum);

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
  function applyPushChain(origin, dest, newGame, pusher, _isSwoop = false){
    // Compute push vector. Same-lane uses step delta; cross-lane uses geometric space delta.
    const originSpace = mapStepToGrid(origin.r, origin.step);
    const destSpace   = mapStepToGrid(dest.r, dest.step);
    const dr = dest.r - origin.r;
    const dsSteps = dest.step - origin.step;
    const dSpace = destSpace - originSpace;
    if((dr===0 && dsSteps===0) || (dr!==0 && dSpace===0)) return;
    // find occupant at dest
    let occPi = -1, occPc = null;
    for(let pi=0; pi<newGame.players.length; pi++){
      const pl = newGame.players[pi];
      const pc = pl.pieces.find(p=>p.r===dest.r && p.step===dest.step);
      if(pc){ occPi = pi; occPc = pc; break; }
    }
    if(!occPc) return;
    const r2 = dest.r + dr;
    if(occPc.carrying && pusher && !pusher.carrying){
      pusher.carrying = true; occPc.carrying = false;
    }
    if(r2 < 0 || r2 >= LANES.length){
      // remove
      const pl = newGame.players[occPi];
      pl.pieces = pl.pieces.filter(p=>p!==occPc);
      return;
    }
    let s2;
    if (dr === 0) {
      // Same-lane push: move by step delta; no gap snap-down needed
      const L2 = LANES[r2].L;
      s2 = Math.max(1, Math.min(L2, dest.step + dsSteps));
    } else {
      // Cross-lane push: use geometric spaces and snap-down on gap
      let targetSpace = destSpace + dSpace;
      targetSpace = Math.max(1, Math.min(MAX_STEP, targetSpace));
      let landedSpace = tileTypeAtSpace(r2, targetSpace) === 'Gap' ? snapDownSpace(r2, targetSpace) : targetSpace;
      if(landedSpace < 1){
        const pl = newGame.players[occPi];
        pl.pieces = pl.pieces.filter(p=>p!==occPc);
        return;
      }
      s2 = stepForSpace(r2, landedSpace);
    }
    applyPushChain(dest, {r:r2, step:s2}, newGame, occPc);
    occPc.r = r2; occPc.step = s2;
  }

  function performMoveWithPush(pc, target, newGame, isSwoop = false){
    const origin = {r: pc.r, step: pc.step};
    applyPushChain(origin, target, newGame, pc, isSwoop);
    pc.r = target.r; pc.step = target.step;
    afterMovePickup(pc, newGame);
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
      actualPiece.r = target.r;
      actualPiece.step = target.step;
      afterMovePickup(actualPiece, newGame);
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
    if(pl.swoopTokens>0) pl.swoopTokens -= 1;
    performMoveWithPush(pc, target, newGame, true); // isSwoop = true
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
    } else if (game.mode === 'tailwind') {
      // Tailwind actions
      const opp = game.players[1 - game.current];
      if (occ && opp.pieces.includes(occ.pc)) {
        // Click on opponent piece to advance it
        tailwindAdvance(occ.pc);
      } else if (step === 1 && opp.pieces.length < 5 && !occupied(r, 1)) {
        // Click on empty step 1 to spawn
        tailwindSpawn(r);
      }
    } else if (game.mode === 'tailwindChooseSwoop') {
      // Click on a destination tile for tailwind swoop
      const target = game.tailwindSwoopTargets && game.tailwindSwoopTargets.find(t => t.r === r && t.step === step);
      if (target && game.tailwindPiece) handleTailwindSwoopChoice(target);
    }
  }

  function tailwindAdvance(piece){
    const newGame = {...game};
    const opp = newGame.players[1 - newGame.current];
    const L=LANES[piece.r].L;
    const dir=piece.carrying?-1:+1;
    const ns=piece.step+dir;

    // Handle advancement beyond final step
    if (ns > L) {
      // Non-carrying piece at top step - give player choice between swoop and move down
      if (!piece.carrying && piece.step === L) {
        const canMoveDown = canTopStepMoveDown(piece);
        const canSwoop = canTopStepFreeSwoop(piece);

        if (canMoveDown || canSwoop) {
          // Set up choice mode for tailwind top step options
          const options = [];
          if (canMoveDown) options.push('move_down');
          if (canSwoop) options.push('swoop');

          newGame.mode = 'tailwindTopStepChoice';
          newGame.tailwindPiece = piece;
          newGame.tailwindOptions = options;
          newGame.message = `${opp.name}: Choose action for piece at top step - ${options.join(' or ')}.`;
          setGame(newGame);
          return;
        } else {
          // No options available, remove piece
          const index = opp.pieces.indexOf(piece);
          if (index > -1) opp.pieces.splice(index, 1);
        }
      } else if (!piece.carrying) {
        // Non-carrying piece advancing beyond final step - remove from board
        const index = opp.pieces.indexOf(piece);
        if (index > -1) opp.pieces.splice(index, 1);
      }
      // Carrying piece can't advance beyond final step (shouldn't happen)
    } else if (ns >= 1) {
      // Normal advancement within lane bounds (with push)
      performMoveWithPush(piece, {r: piece.r, step: ns}, newGame);
    }

    finishTailwind(newGame);
  }

  function tailwindSpawn(r){
    const newGame = {...game};
    const opp=newGame.players[1-newGame.current];
    opp.pieces.push({r, step:1, carrying:false, active:false});
    finishTailwind(newGame);
  }

  function finishTailwind(newGame = null){
    const gameState = newGame || {...game};
    gameState.mode='preroll';
    gameState.message=`${gameState.players[gameState.current].name}: Roll or Bank.`;
    setGame(gameState);
  }

  function handleTailwindTopStepChoice(action){
    if(game.mode !== 'tailwindTopStepChoice' || !game.tailwindPiece) return;

    const newGame = {...game};
    const piece = game.tailwindPiece;
    const opp = newGame.players[1 - newGame.current];

    // Find the actual piece in the opponent's pieces array
    const actualPiece = opp.pieces.find(p => p.r === piece.r && p.step === piece.step);

    if (!actualPiece) {
      finishTailwind(newGame);
      return;
    }

    if (action === 'move_down') {
      const L = LANES[actualPiece.r].L;
      const downStep = L - 1;
      if (downStep >= 1) {
        performMoveWithPush(actualPiece, {r: actualPiece.r, step: downStep}, newGame);
        showToast(`Moved down to step ${downStep}`);
      }
    } else if (action === 'swoop') {
      const targets = potentialTopStepSwoops(actualPiece);
      if (targets.length === 1) {
        // Auto-select single target
        const target = targets[0];
        performMoveWithPush(actualPiece, target, newGame);
        showToast(`Swooped to lane ${LANES[target.r].sum}!`);
      } else if (targets.length > 1) {
        // Let player choose swoop target
        newGame.mode = 'tailwindChooseSwoop';
        newGame.tailwindSwoopTargets = targets;
        newGame.message = `${opp.name}: Choose swoop destination.`;
        setGame(newGame);
        return;
      }
    }

    // Clear tailwind state and finish
    newGame.mode = null;
    newGame.tailwindPiece = null;
    newGame.tailwindOptions = null;
    newGame.tailwindSwoopTargets = null;
    finishTailwind(newGame);
  }

  function handleTailwindSwoopChoice(target){
    if(game.mode !== 'tailwindChooseSwoop' || !game.tailwindPiece) return;

    const newGame = {...game};
    const piece = game.tailwindPiece;
    const opp = newGame.players[1 - newGame.current];

    // Find the actual piece in the opponent's pieces array
    const actualPiece = opp.pieces.find(p => p.r === piece.r && p.step === piece.step);

    if (actualPiece) {
      performMoveWithPush(actualPiece, target, newGame);
      showToast(`Swooped to lane ${LANES[target.r].sum}!`);
    }

    // Clear tailwind state and finish
    newGame.mode = null;
    newGame.tailwindPiece = null;
    newGame.tailwindOptions = null;
    newGame.tailwindSwoopTargets = null;
    finishTailwind(newGame);
  }

  // Check if tailwind has any available actions
  function hasTailwindActions(gameState = game) {
    const opp = gameState.players[1 - gameState.current];

    // Check if any opponent pieces can advance
    for (const pc of opp.pieces) {
      const L = LANES[pc.r].L;
      const dir = pc.carrying ? -1 : +1;
      const ns = pc.step + dir;

      // Handle advancement beyond final step
      if (ns > L) {
        // Non-carrying piece can advance beyond final step (gets removed)
        if (!pc.carrying) return true;
        // Carrying piece can't advance beyond final step
        continue;
      }

      // Normal advancement within lane bounds
      if (ns >= 1) {
        return true;
      }
    }

    // Check if can spawn (if has < 5 pieces and any step 1 is free)
    if (opp.pieces.length < 5) {
      for (let r = 0; r < LANES.length; r++) {
        if (!occupiedInGame(gameState, r, 1)) {
          return true;
        }
      }
    }

    return false;
  }

  function occupiedInGame(gameState, r, step) {
    for (const pl of gameState.players) {
      if (pl.pieces.some(pc => pc.r === r && pc.step === step)) return true;
    }
    return false;
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
    // Allow banking at any time (including between first and optional second pair)
    const newGame = {...game, baskets: [...game.baskets]};
    const pl=newGame.players[newGame.current];
    const kept=[];
    let delivered=0;

    for(const pc of pl.pieces){
      const L=LANES[pc.r].L;
      const cps=checkpoints(L);

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
        // If on Final step, stay put; otherwise slide to previous checkpoint
        if(pc.step === L){
          kept.push(pc);
        } else {
          let dest=null;
          for(let s=pc.step; s>=1; s--){ if(tileTypeAt(pc.r, s)==='Checkpoint'){ dest=s; break; } }
          if(dest!==null){ pc.step=dest; kept.push(pc); }
          // If no checkpoint below, remove piece as before
        }
      }
    }

    pl.pieces=kept;
    pl.score += delivered;
    if(delivered > 0) {
      showToast(`${pl.name} delivered ${delivered}.`);
    }
    resolveDeterrents(pl, newGame);
    // Earn a swoop token on Bank (not on Bust)
    pl.swoopTokens = (pl.swoopTokens || 0) + 1;
    pl.pieces.forEach(p=>p.active=false);

    // Check for victory after delivery
    const victory = checkVictory(newGame);
    if(victory) {
      newGame.mode = 'gameOver';
      newGame.message = `🎉 ${victory.winnerName} wins with ${newGame.players[victory.winner].score} deliveries!`;
      setGame(newGame);
      return;
    }

    newGame.current=1-newGame.current;
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

    for(const pc of pl.pieces){
      const onDet = (tileTypeAt(pc.r, pc.step) === 'Deterrent');
      if(onDet){
        if(pc.carrying && LANES[pc.r].basket) newGame.baskets[pc.r]=true;
        continue;
      }

      // Treat Final step as a keep position too (do not slide off Final)
      if(tileTypeAt(pc.r, pc.step) === 'Checkpoint' || pc.step === LANES[pc.r].L){
        kept.push(pc);
        continue;
      }

      let dest=null;
      if(pc.carrying){
        for(let s=pc.step; s<=LANES[pc.r].L; s++){ if(tileTypeAt(pc.r, s)==='Checkpoint'){ dest=s; break; } }
      } else {
        for(let s=pc.step; s>=1; s--){ if(tileTypeAt(pc.r, s)==='Checkpoint'){ dest=s; break; } }
      }

      if(dest===null){
        if(pc.carrying && LANES[pc.r].basket) newGame.baskets[pc.r]=true;
        // No checkpoint found: piece removed (original behavior)
      } else { pc.step=dest; kept.push(pc); }
    }

    pl.pieces=kept;
    resolveDeterrents(pl, newGame);
    pl.pieces.forEach(p=>p.active=false);

    // Check for victory after bust (in case any deliveries occurred)
    const victory = checkVictory(newGame);
    if(victory) {
      newGame.mode = 'gameOver';
      newGame.message = `🎉 ${victory.winnerName} wins with ${newGame.players[victory.winner].score} deliveries!`;
      setGame(newGame);
      return;
    }

    newGame.current=1-newGame.current;
    newGame.mode='preroll';
    newGame.rolled=null;
    newGame.selectedPair=null;
    newGame.pendingAdvances=null;
    newGame.message=`${newGame.players[newGame.current].name}, roll the dice!`;
    setGame(newGame);
  }

  function bankOrBust(){
    if(game.mode==='preroll') bank();
    else if(game.mode==='rolled' || game.mode==='pairChosen') {
      if(anyMandatoryActionThisRoll()) {
        // Should not happen as button should be disabled, but just in case
        return;
      } else if(anyActionThisRoll()) {
        // Has optional actions (swoop), but player chooses to bank
        bank();
      } else {
        // No actions available, must bust
        bust();
      }
    }
  }

  function newGame(){
    setGame(initialGame());
  }

  // Save/Load functionality
  function getState(){
    return {
      version: 'v6.0',
      players: game.players.map(p=>({
        name: p.name,
        pieceIcon: p.pieceIcon,
        activeIcon: p.activeIcon,
        score: p.score,
        swoopTokens: p.swoopTokens || 0,
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
      transferTargets: game.transferTargets ? [...game.transferTargets] : null
    };
  }

function setState(state, options = {}){
  const silent = !!options.silent;
  try{
    const newGame = {
        players: [
          {
            name: 'Monkeys',
            pieceIcon: '🐒',
            activeIcon: '🐵',
            score: state.players[0].score,
            swoopTokens: (state.players[0].swoopTokens ?? 0),
            pieces: state.players[0].pieces || []
          },
          {
            name: 'Seagulls',
            pieceIcon: '🕊️',
            activeIcon: '🦅',
            score: state.players[1].score,
            swoopTokens: (state.players[1].swoopTokens ?? 0),
            pieces: state.players[1].pieces || []
          }
        ],
        current: (state.current===0 || state.current===1) ? state.current : 0,
        mode: state.mode || 'preroll',
        rolled: state.rolled ? (
          state.rolled.pairings ?
            { d:[...state.rolled.d], pairings: state.rolled.pairings.map(pair => pair.map(pp => ({...pp}))) } :
            { d:[...state.rolled.d], pairs: state.rolled.pairs ? [...state.rolled.pairs] : [] }
        ) : null,
        selectedPair: state.selectedPair || null,
        rollMovesDone: state.rollMovesDone || 0,
        pendingAdvances: state.pendingAdvances || null,
        baskets: state.baskets || LANES.map(l=>l.basket),
        message: state.message || `${state.players[state.current || 0].name}, roll the dice!`,
        transferSource: state.transferSource || null,
        transferTargets: state.transferTargets || null
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
    localStorage.setItem('SWOOP_STATE_V60', JSON.stringify(getState()));
    showToast('Saved to browser.');
  }

  function quickLoad(){
    const txt = localStorage.getItem('SWOOP_STATE_V60');
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

    // Highlight tailwind options
    if (game.mode === 'tailwind') {
      const opp = game.players[1 - game.current];
      const piece = opp.pieces.find(p => p.r === r && p.step === step);
      if (piece) {
        const L = LANES[r].L;
        const dir = piece.carrying ? -1 : +1;
        const ns = piece.step + dir;
        if (ns > L) return !piece.carrying;
        return ns >= 1; // push model allows
      }
      if (step === 1 && opp.pieces.length < 5 && !occupied(r, 1)) return true;
    }

    // Highlight tailwind swoop destinations
    if (game.mode === 'tailwindChooseSwoop' && game.tailwindSwoopTargets && game.tailwindPiece) {
      return game.tailwindSwoopTargets.some(t => t.r === r && t.step === step);
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
          onClick={highlighted ? () => handleTileClick(r, step, occ) : undefined}
        >
          {/* Step number */}
          <span className="mobile-step-number">{step}</span>

          {/* Basket if present */}
          {game.baskets[r] && lane.basket && (
            <div className="swoop-basket">🧺</div>
          )}
          {occ && (
            <div className={`swoop-piece ${occ.pi === game.current && occ.pc.active ? 'active' : ''} ${occ.pc.carrying ? 'carry' : ''}`}>
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
          onClick={isHighlighted ? () => handleTileClick(r, step, occ) : undefined}
        >
          {/* Step number */}
          <span className="mobile-step-number">{step}</span>

          {/* Piece if present */}
          {occ && (
            <div className={`swoop-piece ${occ.pi === game.current && occ.pc.active ? 'active' : ''} ${occ.pc.carrying ? 'carry' : ''}`}>
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

  return (
    <div className="mobile-game-container" style={{background: 'var(--bg)'}}>
      {/* Mobile Header - Compact */}
      <div className="mobile-header">
        <div className="mobile-title">
          <h1>Swoop</h1>
          <div className="mobile-scores">
            <div className={`mobile-score ${game.current === 0 ? 'active-player' : ''}`}>
              <span>🐒</span>
              <span>{game.players[0].score}</span>
              <span style={{marginLeft: 8}}>✈️ {game.players[0].swoopTokens||0}</span>
            </div>
            <div className={`mobile-score ${game.current === 1 ? 'active-player' : ''}`}>
              <span>🕊️</span>
              <span>{game.players[1].score}</span>
              <span style={{marginLeft: 8}}>✈️ {game.players[1].swoopTokens||0}</span>
            </div>
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
            {/* Game Board Grid */}
            <div
              className="mobile-grid"
              style={{
                gridTemplateColumns: `repeat(${COLS}, 1fr)`,
                gridAutoRows: '1fr'
              }}
            >
              {Array.from({ length: ROWS }, (_, r) =>
                Array.from({ length: COLS }, (_, c) => renderGridCell(r, c))
              )}
            </div>
          </div>
        </div>

        {/* Right Side - Controls and Info */}
        <div className="mobile-controls-container">
          {/* Primary Action Buttons */}
          <div className="mobile-primary-controls">
            <button
              className={`mobile-button primary ${game.mode === 'preroll' ? 'active' : ''}`}
              onClick={roll}
              disabled={game.mode !== 'preroll' || game.mode === 'gameOver'}
            >
              🎲 Roll
            </button>
            <button
              className="mobile-button"
              onClick={useMove}
              disabled={game.mode === 'gameOver' || !(game.mode === 'pairChosen' && game.selectedPair && canMoveOnSum(pl, game.selectedPair.sum))}
            >
              ➡️ Move
            </button>
            <button
              className="mobile-button"
              onClick={useSwoop}
              disabled={game.mode === 'gameOver' || !canSwoopNow()}
            >
              🔄 Swoop Token
            </button>
            <button
              className="mobile-button"
              onClick={startTransfer}
              disabled={game.mode === 'gameOver' || !canTransfer()}
            >
              🔄 Transfer
            </button>
            <button
              className="mobile-button"
              onClick={bankOrBust}
              disabled={(() => {
                if (game.mode === 'gameOver') return true;
                if (game.mode === 'preroll') return false;
                if (game.mode === 'rolled' || game.mode === 'pairChosen') {
                  return anyMandatoryActionThisRoll();
                }
                return true;
              })()}
            >
              {(() => {
                if (game.mode === 'preroll') return '🏦 Bank';
                if (game.mode === 'rolled' || game.mode === 'pairChosen') {
                  const mandatory = anyMandatoryActionThisRoll();
                  const any = anyActionThisRoll();
                  if (mandatory) return '❌ Must Move';
                  if (any) return '🏦 Bank';
                  return '💥 Bust';
                }
                return '🏦 Bank';
              })()}
            </button>
          </div>

          {/* Tailwind Choice Buttons */}
          {game.mode === 'tailwindTopStepChoice' && game.tailwindOptions && (
            <div className="mobile-tailwind-choice">
              <div className="mobile-choice-title">Choose action for top step piece:</div>
              <div className="mobile-choice-buttons">
                {game.tailwindOptions.includes('move_down') && (
                  <button
                    className="mobile-button primary"
                    onClick={() => handleTailwindTopStepChoice('move_down')}
                  >
                    ⬇️ Move Down
                  </button>
                )}
                {game.tailwindOptions.includes('swoop') && (
                  <button
                    className="mobile-button primary"
                    onClick={() => handleTailwindTopStepChoice('swoop')}
                  >
                    🔄 Swoop
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Transfer Cancel Button */}
          {(game.mode === 'chooseTransferSource' || game.mode === 'chooseTransferTarget') && (
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
                  <div key={i} className="mobile-die">
                    {v}
                  </div>
                ))}
              </div>
              <div className="mobile-pairs-container">
                {/* Prefer new pairings view; fallback to legacy pairs if present */}
                {game.rolled.pairings && game.rolled.pairings.map((pairing, i) => {
                  const [a,b] = pairing;
                  const label = pairingLabel(pairing);
                  const disabled = label === 'no play';
                  const selected = !!(game.pendingAdvances && game.pendingAdvances.length>0 && game.selectedPair && (game.selectedPair.sum===a.sum || game.selectedPair.sum===b.sum));
                  return (
                    <div
                      key={i}
                      onClick={() => !disabled && selectPairing(i)}
                      className={`mobile-pair ${selected ? 'selected' : ''} ${disabled ? 'disabled' : ''}`}
                      title={`${game.rolled.d[a.i]}+${game.rolled.d[a.j]} & ${game.rolled.d[b.i]}+${game.rolled.d[b.j]}`}
                    >
                      <div className="pair-sum">{label}</div>
                    </div>
                  );
                })}
                {!game.rolled.pairings && game.rolled.pairs && game.rolled.pairs.map((p, i) => (
                  <div
                    key={i}
                    onClick={() => showToast('Legacy save: roll once to continue.')}
                    className={`mobile-pair`}
                  >
                    <div className="pair-sum">{p.sum}</div>
                    <div className="pair-calc">{game.rolled.d[p.i]}+{game.rolled.d[p.j]}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Mobile Legend */}
          <div className="mobile-legend">
            <div className="legend-title">Quick Guide:</div>
            <div className="legend-items">
              <div>🧺 Basket • 🟡 Safe • 🟥 Danger</div>
              <div>🐒🐵 Monkeys • 🕊️🦅 Seagulls</div>
              <div>Roll 4 dice → Choose a pairing → Advance both if possible</div>
            </div>
          </div>

          {/* Secondary Controls */}
          <div className="mobile-secondary-controls">
            <button className="mobile-button-small" onClick={newGame}>🔄 New</button>
            <button className="mobile-button-small" onClick={undo}>↩️ Undo</button>
            <button className="mobile-button-small" onClick={saveToFile}>💾 Save</button>
            <button className="mobile-button-small" onClick={openLoadModal}>📁 Load</button>
            <button className="mobile-button-small" onClick={quickSave}>⚡ Quick Save</button>
            <button className="mobile-button-small" onClick={quickLoad}>⚡ Quick Load</button>
          </div>
        </div>
      </div>

      {/* Mobile Toast Notification */}
      {toast && (
        <div className="mobile-toast">
          {toast}
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
