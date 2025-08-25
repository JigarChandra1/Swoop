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

function checkpoints(L){ const out=[2]; if(L>=6) out.push(4); out.push(L-1); return [...new Set(out)].filter(x=>x>=1&&x<=L); }
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
      {name:'Monkeys', pieceIcon:'🐒', activeIcon:'🐵', score:0, pieces:[]},
      {name:'Seagulls', pieceIcon:'🕊️', activeIcon:'🦅', score:0, pieces:[]}
    ],
    current:0,
    rolled:null,
    selectedPair:null,
    mode:'preroll',
    baskets: LANES.map(l=>l.basket),
    message:'Monkeys, roll the dice!'
  };
}

function r6(){ return 1+Math.floor(Math.random()*6); }

export default function App(){
  const [game,setGame] = React.useState(initialGame);
  const [toast, setToast] = React.useState(null);
  const [showLoadModal, setShowLoadModal] = React.useState(false);
  const [loadText, setLoadText] = React.useState('');

  function showToast(message) {
    setToast(message);
    setTimeout(() => setToast(null), 1500);
  }

  function existsAnyMoveThisRoll(){
    if(!game.rolled) return false;
    const pl=game.players[game.current];
    // Check if any of the available pairs can be used for a move
    for(const pr of game.rolled.pairs){
      if(canMoveOnSum(pl, pr.sum)) return true;
    }
    return false;
  }

  function canSwoopThisRoll(){
    if(!(game.mode==='pairChosen' && game.selectedPair)) return false;
    const pl=game.players[game.current];
    const selectedSum = game.selectedPair.sum;
    const selectedLaneIndex = LANES.findIndex(lane => lane.sum === selectedSum);

    // Only pieces on lanes adjacent to the selected sum can swoop
    const adjacentLaneIndices = [selectedLaneIndex - 1, selectedLaneIndex + 1].filter(idx => idx >= 0 && idx < LANES.length);
    const adjacentSums = adjacentLaneIndices.map(idx => LANES[idx].sum);

    const eligiblePieces = pl.pieces.filter(p => p.active && adjacentSums.includes(LANES[p.r].sum));
    for(const pc of eligiblePieces){ if(potentialSwoops(pc).length>0) return true; }
    return false;
  }

  function anyActionThisRoll(){
    // For rolled mode (no pair selected yet), check if any pair can move
    if(game.mode === 'rolled') {
      return existsAnyMoveThisRoll();
    }
    // For pairChosen mode, check if the selected pair can move or swoop
    return existsAnyMoveThisRoll() || canSwoopThisRoll();
  }

  function occupied(r,side,step){
    for(const pl of game.players){
      if(pl.pieces.some(pc=>pc.r===r && pc.side===side && pc.step===step)) return true;
    }
    return false;
  }
  function pieceOnLane(pl,r){ return pl.pieces.find(p=>p.r===r); }
  function activeCount(pl){ return pl.pieces.filter(p=>p.active).length; }

  function roll(){
    if(game.mode!=='preroll') return;
    const d=[r6(),r6(),r6()];
    const pairs=[[0,1],[0,2],[1,2]].map(([i,j])=>({i,j,sum:d[i]+d[j]}));
    const newGame = {...game, rolled:{d,pairs}, selectedPair:null, mode:'rolled'};

    // Check if any pair can be used for movement
    const pl = game.players[game.current];
    let hasAnyMove = false;
    for(const pr of pairs) {
      if(canMoveOnSum(pl, pr.sum)) {
        hasAnyMove = true;
        break;
      }
    }

    if(!hasAnyMove){
      newGame.message = `${game.players[game.current].name} rolled ${d.join(' ')} — select a pair to Swoop or End Turn (Busted).`;
    } else {
      newGame.message = `${game.players[game.current].name}: select a pair, then Move or Swoop.`;
    }

    setGame(newGame);
  }

  function selectPair(i){
    if(game.mode!=='rolled' && game.mode!=='pairChosen') return;
    const pair = game.rolled.pairs[i];
    const newGame = {...game, selectedPair:pair, mode:'pairChosen'};

    const canMove = canMoveOnSum(game.players[game.current], pair.sum);
    const canSwoop = canSwoopThisRoll();

    if(canMove && canSwoop) {
      newGame.message = `${game.players[game.current].name}: Move or Swoop.`;
    } else if(canMove) {
      newGame.message = `${game.players[game.current].name}: Move.`;
    } else if(canSwoop) {
      newGame.message = `${game.players[game.current].name}: Swoop or End Turn (Busted).`;
    } else {
      newGame.message = `${game.players[game.current].name}: End Turn (Busted).`;
    }

    setGame(newGame);
  }

  function canMoveOnSum(pl,sum){
    const r=LANES.findIndex(x=>x.sum===sum); if(r<0) return false;
    const pc = pieceOnLane(pl,r);
    if(pc){
      const L=LANES[r].L; const dir = pc.carrying?-1:+1; const ns=pc.step+dir;
      return ns>=1 && ns<=L && !occupied(pc.r, pc.side, ns);
    } else {
      const side=(pl===game.players[0])?'L':'R';
      return (pl.pieces.length<5 && !occupied(r, side, 1) && activeCount(pl)<2);
    }
  }

  function ensurePieceForSum(pl,sum){
    const r=LANES.findIndex(x=>x.sum===sum);
    let pc = pieceOnLane(pl,r);
    const side=(pl===game.players[0])?'L':'R';
    if(pc){
      if(!pc.active && activeCount(pl)<2) pc.active=true;
      return pc;
    }
    if(pl.pieces.length>=5 || activeCount(pl)>=2) return null;
    if(occupied(r,side,1)) return null;
    pc={r, side, step:1, carrying:false, active:true};
    pl.pieces.push(pc);
    return pc;
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

  function useMove(){
    if(!(game.mode==='pairChosen' && game.selectedPair)) return;
    const newGame = {...game};
    const pl=newGame.players[newGame.current];
    const sum=newGame.selectedPair.sum;
    if(!canMoveOnSum(pl,sum)) return;

    const before=pl.pieces.length;
    const pc=ensurePieceForSum(pl,sum);
    if(!pc) return;

    if(pl.pieces.length>before){
      // spawned new piece at step 1
    }else{
      const L=LANES[pc.r].L;
      const dir=pc.carrying?-1:+1;
      const ns=pc.step+dir;
      if(ns<1 || ns> L || occupied(pc.r, pc.side, ns)) return;
      pc.step=ns;
      afterMovePickup(pc, newGame);
    }

    newGame.rolled=null;
    newGame.selectedPair=null;
    newGame.mode='preroll';
    newGame.message=`${pl.name}: Roll or Bank.`;
    setGame(newGame);
  }

  function potentialSwoops(pc){
    const targets=[]; const r=pc.r; const L=LANES[r].L; const sum=LANES[r].sum;
    const atOddTop=(sum%2===1)&&(pc.step===L-1);
    for(const dr of [-1,+1]){
      const r2=r+dr; if(r2<0||r2>=LANES.length) continue;
      let step2=pc.step;
      if(atOddTop){ step2=Math.min(LANES[r2].L, Math.max(1, pc.step+oddSlope[sum])); }
      step2=Math.min(LANES[r2].L, step2);
      if(!occupied(r2, pc.side, step2)) targets.push({r:r2, step:step2});
    }
    return targets;
  }

  function useSwoop(){
    if(!(game.mode==='pairChosen' && game.selectedPair)) return;
    const pl=game.players[game.current];
    const selectedSum = game.selectedPair.sum;
    const selectedLaneIndex = LANES.findIndex(lane => lane.sum === selectedSum);

    // Only pieces on lanes adjacent to the selected sum can swoop
    const adjacentLaneIndices = [selectedLaneIndex - 1, selectedLaneIndex + 1].filter(idx => idx >= 0 && idx < LANES.length);
    const adjacentSums = adjacentLaneIndices.map(idx => LANES[idx].sum);

    const eligiblePieces = pl.pieces.filter(p => p.active && adjacentSums.includes(LANES[p.r].sum));
    if(eligiblePieces.length===0) return;

    const newGame = {...game, mode:'chooseSwoop'};
    newGame.message = `${pl.name}: click an active piece to Swoop.`;
    setGame(newGame);
  }

  function chooseSwoopPiece(pc){
    const dests=potentialSwoops(pc);
    const newGame = {...game, mode:'pickSwoopDest', swoopSource:pc, swoopTargets:dests};
    newGame.message = `${game.players[game.current].name}: click destination for Swoop.`;
    setGame(newGame);
  }

  function finalizeSwoop(pc,target){
    const newGame = {...game};
    pc.r=target.r; pc.step=target.step;
    newGame.rolled=null;
    newGame.selectedPair=null;
    newGame.swoopSource=null;
    newGame.swoopTargets=null;

    // Check if tailwind has any actions available
    if (hasTailwindActions(newGame)) {
      newGame.mode='tailwind';
      newGame.message=`Tailwind: ${newGame.players[1-newGame.current].name} click a piece to advance or a base to spawn.`;
    } else {
      // Skip tailwind if no actions available
      newGame.mode='preroll';
      newGame.message=`${newGame.players[newGame.current].name}: Roll or Bank.`;
    }

    setGame(newGame);
  }

  function handleTileClick(r, side, step, occ) {
    if (game.mode === 'chooseSwoop') {
      // Click on a piece to select it for swooping
      if (occ && occ.pi === game.current && occ.pc.active) {
        chooseSwoopPiece(occ.pc);
      }
    } else if (game.mode === 'pickSwoopDest') {
      // Click on a destination tile for swooping
      const target = game.swoopTargets.find(t => t.r === r && t.step === step);
      if (target && game.swoopSource && game.swoopSource.side === side) {
        finalizeSwoop(game.swoopSource, target);
      }
    } else if (game.mode === 'tailwind') {
      // Tailwind actions
      const opp = game.players[1 - game.current];
      const oppSide = (1 - game.current === 0) ? 'L' : 'R';

      if (side === oppSide) {
        if (occ && opp.pieces.includes(occ.pc)) {
          // Click on opponent piece to advance it
          tailwindAdvance(occ.pc);
        } else if (step === 1 && opp.pieces.length < 5 && !occupied(r, side, 1)) {
          // Click on empty step 1 to spawn
          tailwindSpawn(r);
        }
      }
    }
  }

  function tailwindAdvance(piece){
    const newGame = {...game};
    const L=LANES[piece.r].L;
    const dir=piece.carrying?-1:+1;
    const ns=piece.step+dir;
    if(ns>=1 && ns<=L && !occupied(piece.r, piece.side, ns)) {
      piece.step=ns;
      afterMovePickup(piece, newGame);
    }
    finishTailwind(newGame);
  }

  function tailwindSpawn(r){
    const newGame = {...game};
    const opp=newGame.players[1-newGame.current];
    const side=(1-newGame.current===0)?'L':'R';
    opp.pieces.push({r, side, step:1, carrying:false, active:false});
    finishTailwind(newGame);
  }

  function finishTailwind(newGame = null){
    const gameState = newGame || {...game};
    gameState.mode='preroll';
    gameState.message=`${gameState.players[gameState.current].name}: Roll or Bank.`;
    setGame(gameState);
  }

  // Check if tailwind has any available actions
  function hasTailwindActions(gameState = game) {
    const opp = gameState.players[1 - gameState.current];
    const oppSide = (1 - gameState.current === 0) ? 'L' : 'R';

    // Check if any opponent pieces can advance
    for (const pc of opp.pieces) {
      const L = LANES[pc.r].L;
      const dir = pc.carrying ? -1 : +1;
      const ns = pc.step + dir;
      if (ns >= 1 && ns <= L && !occupiedInGame(gameState, pc.r, pc.side, ns)) {
        return true;
      }
    }

    // Check if can spawn (if has < 5 pieces and any step 1 is free)
    if (opp.pieces.length < 5) {
      for (let r = 0; r < LANES.length; r++) {
        if (!occupiedInGame(gameState, r, oppSide, 1)) {
          return true;
        }
      }
    }

    return false;
  }

  function occupiedInGame(gameState, r, side, step) {
    for (const pl of gameState.players) {
      if (pl.pieces.some(pc => pc.r === r && pc.side === side && pc.step === step)) {
        return true;
      }
    }
    return false;
  }

  function resolveDeterrents(pl, newGame){
    pl.pieces=pl.pieces.filter(pc=>{
      const L=LANES[pc.r].L;
      const sum=LANES[pc.r].sum;
      const dets=deterrents(L,sum);
      const onDet=dets.includes(pc.step);
      if(onDet){
        if(pc.carrying && LANES[pc.r].basket){
          newGame.baskets[pc.r]=true;
        }
        return false;
      }
      return true;
    });
  }

  function bank(){
    if(game.mode!=='preroll') return;
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
        let dest=null;
        for(const c of cps){
          if(c<=pc.step) dest=c;
        }
        if(dest!==null){
          pc.step=dest;
          kept.push(pc);
        }
      }
    }

    pl.pieces=kept;
    pl.score += delivered;
    if(delivered > 0) {
      showToast(`${pl.name} delivered ${delivered}.`);
    }
    resolveDeterrents(pl, newGame);
    pl.pieces.forEach(p=>p.active=false);

    newGame.current=1-newGame.current;
    newGame.mode='preroll';
    newGame.rolled=null;
    newGame.selectedPair=null;
    newGame.message=`${newGame.players[newGame.current].name}, roll the dice!`;
    setGame(newGame);
  }

  function bust(){
    const newGame = {...game, baskets: [...game.baskets]};
    const pl=newGame.players[newGame.current];
    const kept=[];

    for(const pc of pl.pieces){
      if(!pc.active){
        kept.push(pc);
        continue;
      }

      const L=LANES[pc.r].L;
      const sum=LANES[pc.r].sum;
      const cps=checkpoints(L);
      const dets=deterrents(L,sum);
      const onDet=dets.includes(pc.step);

      if(onDet){
        if(pc.carrying && LANES[pc.r].basket) newGame.baskets[pc.r]=true;
        continue;
      }

      if(cps.includes(pc.step)){
        kept.push(pc);
        continue;
      }

      let dest=null;
      if(pc.carrying){
        for(const c of cps){
          if(c>=pc.step){
            dest=c;
            break;
          }
        }
      } else {
        for(const c of cps){
          if(c<=pc.step) dest=c;
        }
      }

      if(dest===null){
        if(pc.carrying && LANES[pc.r].basket) newGame.baskets[pc.r]=true;
      } else {
        pc.step=dest;
        kept.push(pc);
      }
    }

    pl.pieces=kept;
    resolveDeterrents(pl, newGame);
    pl.pieces.forEach(p=>p.active=false);

    newGame.current=1-newGame.current;
    newGame.mode='preroll';
    newGame.rolled=null;
    newGame.selectedPair=null;
    newGame.message=`${newGame.players[newGame.current].name}, roll the dice!`;
    setGame(newGame);
  }

  function bankOrBust(){
    if(game.mode==='preroll') bank();
    else if((game.mode==='rolled' || game.mode==='pairChosen') && !anyActionThisRoll()) bust();
  }

  function newGame(){
    setGame(initialGame());
  }

  // Save/Load functionality
  function getState(){
    return {
      version: 'v5.2',
      players: game.players.map(p=>({
        name: p.name,
        pieceIcon: p.pieceIcon,
        activeIcon: p.activeIcon,
        score: p.score,
        pieces: p.pieces.map(x=>({...x}))
      })),
      current: game.current,
      mode: game.mode,
      rolled: game.rolled ? {d:[...game.rolled.d], pairs:[...game.rolled.pairs]} : null,
      selectedPair: game.selectedPair ? {...game.selectedPair} : null,
      baskets: [...game.baskets],
      message: game.message
    };
  }

  function setState(state){
    try{
      const newGame = {
        players: [
          {
            name: 'Monkeys',
            pieceIcon: '🐒',
            activeIcon: '🐵',
            score: state.players[0].score,
            pieces: state.players[0].pieces || []
          },
          {
            name: 'Seagulls',
            pieceIcon: '🕊️',
            activeIcon: '🦅',
            score: state.players[1].score,
            pieces: state.players[1].pieces || []
          }
        ],
        current: (state.current===0 || state.current===1) ? state.current : 0,
        mode: state.mode || 'preroll',
        rolled: state.rolled ? {d:[...state.rolled.d], pairs:[...state.rolled.pairs]} : null,
        selectedPair: state.selectedPair || null,
        baskets: state.baskets || LANES.map(l=>l.basket),
        message: state.message || `${state.players[state.current || 0].name}, roll the dice!`
      };
      setGame(newGame);
      showToast('Game loaded successfully!');
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
    localStorage.setItem('SWOOP_STATE_V52', JSON.stringify(getState()));
    showToast('Saved to browser.');
  }

  function quickLoad(){
    const txt = localStorage.getItem('SWOOP_STATE_V52');
    if(!txt){
      showToast('No quick save found.');
      return;
    }
    loadFromText(txt);
  }



  /* Rendering helpers */
  function pieceAt(r, side, step){
    for(let pi=0; pi<game.players.length; pi++){
      const pl=game.players[pi];
      const pc=pl.pieces.find(p=>p.r===r && p.side===side && p.step===step);
      if(pc) return {pi, pc};
    }
    return null;
  }

  function getCellClasses(r, side, step) {
    const lane = LANES[r];
    const isCp = checkpoints(lane.L).includes(step);
    const isDet = deterrents(lane.L, lane.sum).includes(step);

    let classes = "mobile-cell swoop-tile";

    if (isCp) {
      classes += " swoop-cp"; // checkpoint color
    } else if (isDet) {
      classes += " swoop-det"; // deterrent color
    }

    // Add highlighting for interactive tiles
    if (shouldHighlightTile(r, side, step)) {
      classes += " swoop-highlight";
    }

    return classes;
  }

  function shouldHighlightTile(r, side, step) {
    // Highlight eligible pieces for swoop selection
    if (game.mode === 'chooseSwoop' && game.selectedPair) {
      const selectedSum = game.selectedPair.sum;
      const selectedLaneIndex = LANES.findIndex(lane => lane.sum === selectedSum);
      const adjacentLaneIndices = [selectedLaneIndex - 1, selectedLaneIndex + 1].filter(idx => idx >= 0 && idx < LANES.length);
      const adjacentSums = adjacentLaneIndices.map(idx => LANES[idx].sum);

      const pl = game.players[game.current];
      const piece = pl.pieces.find(p => p.r === r && p.side === side && p.step === step && p.active);
      return piece && adjacentSums.includes(LANES[r].sum);
    }

    // Highlight swoop destinations
    if (game.mode === 'pickSwoopDest' && game.swoopTargets) {
      return game.swoopTargets.some(t => t.r === r && t.step === step) &&
             game.swoopSource && game.swoopSource.side === side;
    }

    // Highlight tailwind options
    if (game.mode === 'tailwind') {
      const opp = game.players[1 - game.current];
      const oppSide = (1 - game.current === 0) ? 'L' : 'R';

      // Highlight opponent pieces that can advance
      if (side === oppSide) {
        const piece = opp.pieces.find(p => p.r === r && p.side === side && p.step === step);
        if (piece) {
          const L = LANES[r].L;
          const dir = piece.carrying ? -1 : +1;
          const ns = piece.step + dir;
          return ns >= 1 && ns <= L && !occupied(r, side, ns);
        }

        // Highlight spawn positions (step 1) if opponent has < 5 pieces
        if (step === 1 && opp.pieces.length < 5 && !occupied(r, side, 1)) {
          return true;
        }
      }
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

    // Center column (baskets)
    if (c === CENTER_COL) {
      const centerClasses = "mobile-cell swoop-tile swoop-center";
      const basket = game.baskets[r] && lane.basket ? '🧺' : '';
      return (
        <div key={`${r}-${c}`} className={centerClasses}>
          {basket}
        </div>
      );
    }

    // Check if this column position corresponds to a game step
    let side = null;
    let step = null;

    // Check left side
    for (let k = 1; k <= lane.L; k++) {
      if (colForStep('L', k, lane.L) === c) {
        side = 'L';
        step = k;
        break;
      }
    }

    // Check right side if not found on left
    if (!side) {
      for (let k = 1; k <= lane.L; k++) {
        if (colForStep('R', k, lane.L) === c) {
          side = 'R';
          step = k;
          break;
        }
      }
    }

    // If this is a valid game position
    if (side && step) {
      const occ = pieceAt(r, side, step);
      const classes = getCellClasses(r, side, step);
      const isHighlighted = shouldHighlightTile(r, side, step);

      return (
        <div
          key={`${r}-${c}`}
          className={classes}
          onClick={isHighlighted ? () => handleTileClick(r, side, step, occ) : undefined}
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
            </div>
            <div className={`mobile-score ${game.current === 1 ? 'active-player' : ''}`}>
              <span>🕊️</span>
              <span>{game.players[1].score}</span>
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
              disabled={game.mode !== 'preroll'}
            >
              🎲 Roll
            </button>
            <button
              className="mobile-button"
              onClick={useMove}
              disabled={!(game.mode === 'pairChosen' && game.selectedPair && canMoveOnSum(pl, game.selectedPair.sum))}
            >
              ➡️ Move
            </button>
            <button
              className="mobile-button"
              onClick={useSwoop}
              disabled={!canSwoopThisRoll()}
            >
              🔄 Swoop
            </button>
            <button
              className="mobile-button"
              onClick={bankOrBust}
              disabled={(() => {
                if (game.mode === 'preroll') return false;
                if (game.mode === 'rolled' || game.mode === 'pairChosen') {
                  return anyActionThisRoll();
                }
                return true;
              })()}
            >
              {(() => {
                if (game.mode === 'preroll') return '🏦 Bank';
                if (game.mode === 'rolled' || game.mode === 'pairChosen') {
                  return anyActionThisRoll() ? '❌ Must Use' : '💥 Bust';
                }
                return '🏦 Bank';
              })()}
            </button>
          </div>

          {/* Dice and Pairs - Mobile Layout */}
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
                {game.rolled.pairs.map((p, i) => (
                  <div
                    key={i}
                    onClick={() => selectPair(i)}
                    className={`mobile-pair ${
                      game.selectedPair && game.selectedPair.i === p.i && game.selectedPair.j === p.j
                        ? 'selected'
                        : ''
                    }`}
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
              <div>Roll 3 dice → Pick pair → Move/Swoop</div>
            </div>
          </div>

          {/* Secondary Controls */}
          <div className="mobile-secondary-controls">
            <button className="mobile-button-small" onClick={newGame}>🔄 New</button>
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


