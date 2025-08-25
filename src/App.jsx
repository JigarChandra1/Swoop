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
    setGame({...game, rolled:{d,pairs}, selectedPair:null, mode:'rolled', message:`${game.players[game.current].name}: select a pair.`});
  }

  function selectPair(i){
    if(game.mode!=='rolled') return;
    const pair = game.rolled.pairs[i];
    setGame({...game, selectedPair:pair, mode:'pairChosen', message:`${game.players[game.current].name}: Move or Swoop.`});
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

  function afterMovePickup(pc){
    const lane=LANES[pc.r]; const L=lane.L;
    if(lane.basket && game.baskets[pc.r] && pc.step===L && !pc.carrying){
      pc.carrying=true;
      const baskets=[...game.baskets]; baskets[pc.r]=false;
      setGame({...game, baskets, message:`${game.players[game.current].name} picked up a basket!`});
      return true;
    }
    return false;
  }

  function useMove(){
    if(!(game.mode==='pairChosen' && game.selectedPair)) return;
    const pl=game.players[game.current]; const sum=game.selectedPair.sum;
    if(!canMoveOnSum(pl,sum)) return;
    const before=pl.pieces.length;
    const pc=ensurePieceForSum(pl,sum); if(!pc) return;
    if(pl.pieces.length>before){
      // spawned new piece at step 1
    }else{
      const L=LANES[pc.r].L; const dir=pc.carrying?-1:+1; const ns=pc.step+dir;
      if(ns<1 || ns> L || occupied(pc.r, pc.side, ns)) return;
      pc.step=ns; afterMovePickup(pc);
    }
    setGame({...game, rolled:null, selectedPair:null, mode:'preroll', message:`${pl.name}: Roll or Bank.`});
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
    const actives=pl.pieces.filter(p=>p.active);
    if(actives.length===0) return;
    setGame({...game, mode:'chooseSwoop'});
  }

  function chooseSwoopPiece(pc){
    const dests=potentialSwoops(pc);
    setGame({...game, mode:'pickSwoopDest', swoopSource:pc, swoopTargets:dests});
  }

  function finalizeSwoop(pc,target){
    pc.r=target.r; pc.step=target.step;
    setGame({...game, rolled:null, selectedPair:null, mode:'tailwind', swoopSource:null, swoopTargets:null, message:`Tailwind: opponent may advance or spawn.`});
  }

  function tailwindAdvance(piece){
    const opp=game.players[1-game.current];
    const L=LANES[piece.r].L; const dir=piece.carrying?-1:+1; const ns=piece.step+dir;
    if(ns>=1 && ns<=L && !occupied(piece.r, piece.side, ns)) piece.step=ns;
    finishTailwind();
  }
  function tailwindSpawn(r){
    const opp=game.players[1-game.current];
    const side=(1-game.current===0)?'L':'R';
    opp.pieces.push({r, side, step:1, carrying:false, active:false});
    finishTailwind();
  }
  function finishTailwind(){
    setGame({...game, mode:'preroll', message:`${game.players[game.current].name}: Roll or Bank.`});
  }

  function resolveDeterrents(pl){
    pl.pieces=pl.pieces.filter(pc=>{
      const L=LANES[pc.r].L; const sum=LANES[pc.r].sum; const dets=deterrents(L,sum); const onDet=dets.includes(pc.step);
      if(onDet){ if(pc.carrying && LANES[pc.r].basket){ const baskets=[...game.baskets]; baskets[pc.r]=true; game.baskets=baskets; } return false; }
      return true;
    });
  }

  function bank(){
    if(game.mode!=='preroll') return;
    const pl=game.players[game.current];
    const kept=[]; let delivered=0; const baskets=[...game.baskets];
    for(const pc of pl.pieces){
      const L=LANES[pc.r].L; const cps=checkpoints(L);
      if(pc.step===L && LANES[pc.r].basket && baskets[pc.r] && !pc.carrying){ pc.carrying=true; baskets[pc.r]=false; }
      if(pc.carrying){ kept.push(pc); if(pc.step===1){ delivered++; } }
      else{
        let dest=null; for(const c of cps){ if(c<=pc.step) dest=c; }
        if(dest!==null){ pc.step=dest; kept.push(pc); }
      }
    }
    pl.pieces=kept.filter(pc=>!(pc.carrying && pc.step===1));
    pl.score += delivered;
    resolveDeterrents(pl);
    pl.pieces.forEach(p=>p.active=false);
    const newState={...game, baskets, current:1-game.current, mode:'preroll', rolled:null, selectedPair:null, message:`${game.players[1-game.current].name}, roll the dice!`};
    setGame(newState);
  }

  function bust(){
    const pl=game.players[game.current];
    const kept=[]; const baskets=[...game.baskets];
    for(const pc of pl.pieces){
      if(!pc.active){ kept.push(pc); continue; }
      const L=LANES[pc.r].L; const sum=LANES[pc.r].sum; const cps=checkpoints(L); const dets=deterrents(L,sum);
      const onDet=dets.includes(pc.step); if(onDet){ if(pc.carrying && LANES[pc.r].basket) baskets[pc.r]=true; continue; }
      if(cps.includes(pc.step)){ kept.push(pc); continue; }
      let dest=null;
      if(pc.carrying){ for(const c of cps){ if(c>=pc.step){ dest=c; break; } } }
      else { for(const c of cps){ if(c<=pc.step) dest=c; } }
      if(dest===null){ if(pc.carrying && LANES[pc.r].basket) baskets[pc.r]=true; }
      else { pc.step=dest; kept.push(pc); }
    }
    pl.pieces=kept; resolveDeterrents(pl); pl.pieces.forEach(p=>p.active=false);
    const newState={...game, baskets, current:1-game.current, mode:'preroll', rolled:null, selectedPair:null, message:`${game.players[1-game.current].name}, roll the dice!`};
    setGame(newState);
  }

  function bankOrBust(){
    if(game.mode==='preroll') bank();
    else if((game.mode==='rolled' || game.mode==='pairChosen') && !anyActionThisRoll()) bust();
  }

  function anyActionThisRoll(){
    return existsAnyMoveThisRoll() || canSwoopThisRoll();
  }
  function existsAnyMoveThisRoll(){
    if(!game.rolled) return false;
    const pl=game.players[game.current];
    for(const pr of game.rolled.pairs){ if(canMoveOnSum(pl, pr.sum)) return true; }
    return false;
  }
  function canSwoopThisRoll(){
    if(!(game.mode==='pairChosen' && game.selectedPair)) return false;
    const pl=game.players[game.current];
    const actives=pl.pieces.filter(p=>p.active);
    for(const pc of actives){ if(potentialSwoops(pc).length>0) return true; }
    return false;
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

  function renderCell(r, side, step){
    const occ=pieceAt(r,side,step);
    const lane=LANES[r];
    const isCp=checkpoints(lane.L).includes(step);
    const isDet=deterrents(lane.L,lane.sum).includes(step);
    let cls="w-8 h-8 border flex items-center justify-center";
    if(isCp) cls+=" bg-green-200";
    else if(isDet) cls+=" bg-red-200";
    else cls+=" bg-gray-200";
    if(occ){
      const pl=game.players[occ.pi];
      const icon=(occ.pi===game.current && occ.pc.active)?pl.activeIcon:pl.pieceIcon;
      return <td className={cls}>{icon}{occ.pc.carrying?"↩":''}</td>;
    }
    return <td className={cls}>{step}</td>;
  }

  function renderRow(r){
    const lane=LANES[r];
    const cells=[];
    cells.push(<td key="labelL" className="px-1 font-bold">{lane.sum}</td>);
    for(let k=1;k<=lane.L;k++) cells.push(<React.Fragment key={'L'+k}>{renderCell(r,'L',k)}</React.Fragment>);
    const centerCls="w-8 h-8 border flex items-center justify-center bg-yellow-200";
    const basket = game.baskets[r] && lane.basket ? '🧺' : '';
    cells.push(<td key="center" className={centerCls}>{basket}</td>);
    for(let k=lane.L;k>=1;k--) cells.push(<React.Fragment key={'R'+k}>{renderCell(r,'R',k)}</React.Fragment>);
    cells.push(<td key="labelR" className="px-1 font-bold">{lane.sum}</td>);
    return <tr key={lane.sum}>{cells}</tr>;
  }

  const pl=game.players[game.current];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Swoop</h1>
      <div className="flex space-x-4">
        <div>Monkeys: {game.players[0].score}</div>
        <div>Seagulls: {game.players[1].score}</div>
      </div>
      <div className="overflow-auto">
        <table className="border-collapse"><tbody>
          {LANES.map((_,r)=>renderRow(r))}
        </tbody></table>
      </div>
      <div className="flex space-x-2">
        <button className="px-2 py-1 bg-blue-500 text-white" onClick={roll} disabled={game.mode!=='preroll'}>Roll</button>
        <button className="px-2 py-1 bg-green-500 text-white" onClick={useMove} disabled={!(game.mode==='pairChosen' && game.selectedPair && canMoveOnSum(pl, game.selectedPair.sum))}>Move</button>
        <button className="px-2 py-1 bg-purple-500 text-white" onClick={useSwoop} disabled={!canSwoopThisRoll()}>Swoop</button>
        <button className="px-2 py-1 bg-gray-700 text-white" onClick={bankOrBust}>{game.mode==='preroll'?'Bank':'End Turn'}</button>
      </div>
      {game.rolled && (
        <div className="flex space-x-2 items-center">
          {game.rolled.d.map((v,i)=>(<div key={i} className="w-8 h-8 border flex items-center justify-center">{v}</div>))}
          <div className="flex space-x-1">
            {game.rolled.pairs.map((p,i)=>(
              <div key={i} onClick={()=>selectPair(i)} className={(game.selectedPair&&game.selectedPair.i===p.i&&game.selectedPair.j===p.j?'bg-yellow-300 ':'')+"px-1 cursor-pointer"}>{game.rolled.d[p.i]}+{game.rolled.d[p.j]}={p.sum}</div>
            ))}
          </div>
        </div>
      )}
      {game.mode==='chooseSwoop' && (
        <div className="space-x-2">
          {pl.pieces.filter(p=>p.active).map((pc,idx)=>(
            <button key={idx} className="px-2 py-1 bg-purple-400" onClick={()=>chooseSwoopPiece(pc)}>
              {pl.pieceIcon} lane {LANES[pc.r].sum}
            </button>
          ))}
        </div>
      )}
      {game.mode==='pickSwoopDest' && (
        <div className="space-x-2">
          {game.swoopTargets.map((t,idx)=>(
            <button key={idx} className="px-2 py-1 bg-purple-300" onClick={()=>finalizeSwoop(game.swoopSource,t)}>
              to lane {LANES[t.r].sum} step {t.step}
            </button>
          ))}
        </div>
      )}
      {game.mode==='tailwind' && (
        <TailwindOptions game={game} finish={finishTailwind} advance={tailwindAdvance} spawn={tailwindSpawn}/>
      )}
      <div className="mt-2">{game.message}</div>
    </div>
  );
}

function TailwindOptions({game, finish, advance, spawn}){
  const opp=game.players[1-game.current];
  const side=(1-game.current===0?'L':'R');
  const options=[];
  if(opp.pieces.length>0){
    opp.pieces.forEach((pc,idx)=>{
      options.push(<button key={'m'+idx} className="px-2 py-1 bg-orange-300" onClick={()=>advance(pc)}>Move {LANES[pc.r].sum}</button>);
    });
  }
  if(opp.pieces.length<5){
    for(let r=0;r<LANES.length;r++){
      if(!occupiedTailwind(game,r,side))
        options.push(<button key={'s'+r} className="px-2 py-1 bg-orange-200" onClick={()=>spawn(r)}>Spawn {LANES[r].sum}</button>);
    }
  }
  if(options.length===0) return <div>No tailwind action available. <button className="px-2 py-1 bg-orange-300" onClick={finish}>Continue</button></div>;
  return <div className="space-x-2">{options}</div>;
}
function occupiedTailwind(game,r,side){
  for(const pl of game.players){ if(pl.pieces.some(pc=>pc.r===r && pc.side===side && pc.step===1)) return true; }
  return false;
}
