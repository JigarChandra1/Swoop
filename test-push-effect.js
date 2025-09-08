// This file will contain tests for the push effect functionality.

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

function tileTypeAtSpace(r, space){
  const gs = Math.max(1, Math.min(MAX_STEP, space));
  return TILE_MAP[r][gs-1] || 'Gap';
}
function snapDownSpace(r, space){
  let sp = Math.max(1, Math.min(MAX_STEP, space));
  while(sp >= 1 && tileTypeAtSpace(r, sp) === 'Gap') sp--;
  return sp;
}

function afterMovePickup(pc, newGame){
  const lane=LANES[pc.r]; const L=lane.L;
  if(lane.basket && newGame.baskets[pc.r] && pc.step===L && !pc.carrying){
    pc.carrying=true;
    newGame.baskets[pc.r]=false;
    return true;
  }
  return false;
}

function applyPushChain(origin, dest, newGame, pusher, _isSwoop = false){
  // Geometric push: compute vector in space coordinates
  const originSpace = mapStepToGrid(origin.r, origin.step);
  const destSpace   = mapStepToGrid(dest.r, dest.step);
  const dSpace = destSpace - originSpace;
  const dr = dest.r - origin.r;
  if(dr===0 && dSpace===0) return;
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
    const pl = newGame.players[occPi];
    pl.pieces = pl.pieces.filter(p=>p!==occPc);
    return;
  }
  let targetSpace = destSpace + dSpace;
  targetSpace = Math.max(1, Math.min(MAX_STEP, targetSpace));
  let landedSpace = tileTypeAtSpace(r2, targetSpace) === 'Gap' ? snapDownSpace(r2, targetSpace) : targetSpace;
  if(landedSpace < 1){
    const pl = newGame.players[occPi];
    pl.pieces = pl.pieces.filter(p=>p!==occPc);
    return;
  }
  const s2 = (function stepForSpace(r, space){
    const L = LANES[r].L;
    for(let s=1; s<=L; s++){ if(mapStepToGrid(r, s)===landedSpace && tileExistsAt(r,s)) return s; }
    let best=null, min=Infinity; for(let s=1; s<=L; s++){ if(tileExistsAt(r,s)){ const d=Math.abs(mapStepToGrid(r,s)-landedSpace); if(d<min){min=d; best=s;} } }
    return best;
  })(r2, landedSpace);
  applyPushChain(dest, {r:r2, step:s2}, newGame, occPc);
  occPc.r = r2; occPc.step = s2;
}

function performMoveWithPush(pc, target, newGame, isSwoop = false){
  const origin = {r: pc.r, step: pc.step};
  applyPushChain(origin, target, newGame, pc, isSwoop);
  pc.r = target.r; pc.step = target.step;
  afterMovePickup(pc, newGame);
}

function createTestGame() {
  return {
    players: [
      {name:'P1', pieceIcon:'A', activeIcon:'a', score:0, swoopTokens:0, pieces:[]},
      {name:'P2', pieceIcon:'B', activeIcon:'b', score:0, swoopTokens:0, pieces:[]}
    ],
    current: 0,
    baskets: LANES.map(l=>l.basket)
  };
}

function assert(condition, message) {
  if (!condition) {
    console.error('Assertion failed:', message);
    return false;
  }
  console.log('✓', message);
  return true;
}

// Helper: find a snap-down scenario for swoop push where same-step in next lane is a Gap
function findSnapDownScenario() {
  for (let r = 0; r < LANES.length - 2; r++) {
    const L = LANES[r].L;
    for (let s = 2; s < L; s++) { // avoid step 1 and top step for clarity
      const destR = r + 1; // occupant lane
      const pushToR = destR + 1; // where occupant will be pushed on swoop (dr=+1)
      if (pushToR >= LANES.length) continue;
      // Use spaces to determine if the landing is a gap
      const originSpace = mapStepToGrid(r, s);
      const destSpace = mapStepToGrid(destR, s);
      const dSpace = destSpace - originSpace; // swoop keeps same space here
      const targetSpace = destSpace + dSpace; // equals destSpace
      if (tileTypeAtSpace(pushToR, targetSpace) === 'Gap') {
        const snappedSpace = snapDownSpace(pushToR, targetSpace);
        if (snappedSpace >= 1) {
          // Convert snapped space into a step for expectation display
          const snappedStep = (function(r, space){
            const L = LANES[r].L; let best=null,min=Infinity; for(let st=1; st<=L; st++){ const sp=mapStepToGrid(r,st); if(sp===space) return st; const d=Math.abs(sp-space); if(d<min){min=d; best=st;} } return best; })(pushToR, snappedSpace);
          return { origin: {r, s}, dest: {r: destR, s}, pushTo: {r: pushToR, s}, snapped: snappedStep };
        }
      }
    }
  }
  return null;
}

// New explicit test for the reported diagonal case (10→9 pushes to 8 and snaps to step 1)
function testReportedDiagonalCase(){
  const game = createTestGame();
  const lane10 = 8; // index for sum 10
  const lane9  = 7; // index for sum 9
  const lane8  = 6; // index for sum 8
  game.players[0].pieces.push({r:lane10, step:2, carrying:false, active:true, id:'P1'});
  game.players[1].pieces.push({r:lane9,  step:2, carrying:false, active:true, id:'P2'});
  const pusher = game.players[0].pieces[0];
  const pushed = game.players[1].pieces[0];
  performMoveWithPush(pusher, {r:lane9, step:2}, game, true); // diagonal swoop-like push vector
  const ok = assert(pushed.r === lane8 && pushed.step === 1, 'Reported case: pushed piece ends at lane 8, step 1');
  if(!ok){ console.log('Observed:', pushed); }
}

function runPushEffectTests() {
  console.log('\nRunning Push Effect Tests...');

  // Test Case 1: Top-step push clamps (no movement), pusher may pick up basket
  let game1 = createTestGame();
  game1.players[0].pieces.push({r:0, step:2, carrying:false, active:true, id:'P1-1'});
  game1.players[1].pieces.push({r:0, step:3, carrying:false, active:true, id:'P2-1'});

  console.log("--- Test Case 1: Before Push ---");
  console.log("P1 pieces:", game1.players[0].pieces);
  console.log("P2 pieces:", game1.players[1].pieces);

  let pusher1 = game1.players[0].pieces[0];
  performMoveWithPush(pusher1, {r:0, step:3}, game1);

  console.log("--- Test Case 1: After Push ---");
  console.log("P1 pieces:", game1.players[0].pieces);
  console.log("P2 pieces:", game1.players[1].pieces);

  assert(pusher1.r === 0 && pusher1.step === 3, 'Test 1.1: Pusher moves to target');
  assert(game1.players[1].pieces[0].r === 0 && game1.players[1].pieces[0].step === 3, 'Test 1.2: Occupant remains at clamped top step');
  assert(pusher1.carrying === true && game1.baskets[0] === false, 'Test 1.3: Pusher picked up basket at top step');

  // Test Case 2: Mid-lane push chain (no clamping)
  // Use lane 5 (index 5, L=8): positions 3->4->5, push from 3 into 4 should move 4->5 and 5->6
  let game2 = createTestGame();
  const r2 = 5; // L=8
  game2.players[0].pieces.push({r:r2, step:3, carrying:false, active:true, id:'P1-1'});
  game2.players[1].pieces.push({r:r2, step:4, carrying:false, active:true, id:'P2-1'});
  game2.players[1].pieces.push({r:r2, step:5, carrying:false, active:true, id:'P2-2'});

  let pusher2 = game2.players[0].pieces[0];
  performMoveWithPush(pusher2, {r:r2, step:4}, game2);

  const occA = game2.players[1].pieces.find(p=>p.id==='P2-1');
  const occB = game2.players[1].pieces.find(p=>p.id==='P2-2');
  assert(pusher2.r === r2 && pusher2.step === 4, 'Test 2.1: Pusher moves to target');
  assert(occA && occA.step === 5, 'Test 2.2: First occupant pushed forward');
  assert(occB && occB.step === 6, 'Test 2.3: Second occupant pushed forward in chain');

  // Test Case 3: Sideways at top step pushes occupant off-board (removal)
  // Move from lane 9 top step to lane 10 top step; occupant at lane 10 top should be removed (push beyond bounds)
  let game3 = createTestGame();
  const fromLane = 9; // index 9 has L=4
  const toLane = 10; // last lane index
  const L_to = LANES[toLane].L; // 3
  game3.players[0].pieces.push({r:fromLane, step:LANES[fromLane].L, carrying:false, active:true, id:'P1-1'});
  game3.players[1].pieces.push({r:toLane, step:L_to, carrying:false, active:true, id:'P2-1'});

  let pusher3 = game3.players[0].pieces[0];
  performMoveWithPush(pusher3, {r:toLane, step:L_to}, game3);

  assert(pusher3.r === toLane && pusher3.step === L_to, 'Test 3.1: Pusher moved sideways to adjacent top step');
  assert(game3.players[1].pieces.find(p=>p.id==='P2-1') === undefined, 'Test 3.2: Occupant removed after being pushed off-board');

  // Test Case 4: Basket Transfer on push
  let game4 = createTestGame();
  game4.players[0].pieces.push({r:r2, step:3, carrying:false, active:true, id:'P1-1'});
  game4.players[1].pieces.push({r:r2, step:4, carrying:true, active:true, id:'P2-1'});

  let pusher4 = game4.players[0].pieces[0];
  const pushed4Ref = game4.players[1].pieces.find(p => p.id === 'P2-1');
  performMoveWithPush(pusher4, {r:r2, step:4}, game4);

  assert(pusher4.carrying, 'Test 4.1: Pusher now carrying basket (transfer)');
  assert(!pushed4Ref.carrying, 'Test 4.2: Pushed piece no longer carrying');
  assert(pushed4Ref.r === r2 && pushed4Ref.step === 5, 'Test 4.3: Pushed piece moved away');

  // Test Case 5: Swoop Push keeps step, changes lane
  let game5 = createTestGame();
  game5.players[0].pieces.push({r:1, step:2, carrying:false, active:true, id:'P1-1'});
  game5.players[1].pieces.push({r:2, step:2, carrying:false, active:true, id:'P2-1'});

  let swooper5 = game5.players[0].pieces[0];
  const swooped5 = game5.players[1].pieces.find(p=>p.id==='P2-1');
  performMoveWithPush(swooper5, {r:2, step:2}, game5, true);

  assert(swooper5.r === 2 && swooper5.step === 2, 'Test 5.1: Swooper moves to target');
  assert(swooped5.r === 3 && swooped5.step === 2, 'Test 5.2: Swooped piece pushed to adjacent lane, same step');

  // Test Case 6: Swoop push into Gap causes snap-down
  const snap = findSnapDownScenario();
  if (snap) {
    let game6 = createTestGame();
    const { origin, dest, pushTo, snapped } = snap;
    // Place pusher at origin.r, origin.s; occupant at dest.r, dest.s
    game6.players[0].pieces.push({r:origin.r, step:origin.s, carrying:false, active:true, id:'P1-1'});
    game6.players[1].pieces.push({r:dest.r, step:dest.s, carrying:false, active:true, id:'P2-1'});
    const pusher6 = game6.players[0].pieces[0];
    const pushed6 = game6.players[1].pieces[0];

    performMoveWithPush(pusher6, {r:dest.r, step:dest.s}, game6, true); // swoop

    assert(pushed6.r === pushTo.r && pushed6.step === snapped, 'Test 6.1: Pushed piece snaps down to nearest valid step on gap');
  } else {
    console.log('Skipping Test 6: No snap-down scenario found with current TILE_MAP');
  }

  // Test Case 7: Explicit diagonal example from user report
  testReportedDiagonalCase();

  console.log('\nAll Push Effect Tests Completed.');
}

// Run the tests
if (typeof window !== 'undefined') {
  window.runPushEffectTests = runPushEffectTests;
  console.log('Test function available as window.runPushEffectTests()');
} else {
  runPushEffectTests();
}
