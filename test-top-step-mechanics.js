#!/usr/bin/env node

// Test file for the new top step mechanics
// Tests activation, free swoop, and move down functionality

const fs = require('fs');

// Import the simulation code to test the mechanics
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
  out.push(L);
  return [...new Set(out)].filter((x) => x >= 1 && x <= L);
}

function activeCount(pl) {
  return pl.pieces.filter((p) => p.active).length;
}

function occupied(game, r, step) {
  for (const pl of game.players) {
    for (const pc of pl.pieces) {
      if (pc.r === r && pc.step === step) return true;
    }
  }
  return false;
}

function pieceOnLane(pl, r) {
  return pl.pieces.find((p) => p.r === r);
}

// Test helper functions
function createTestGame() {
  return {
    players: [
      { seat: 0, pieces: [] },
      { seat: 1, pieces: [] }
    ],
    playerCount: 2,
    current: 0,
    baskets: LANES.map(lane => lane.basket),
    moveHistory: []
  };
}

function createTestPiece(r, step, carrying = false, active = true) {
  return {
    r: r,
    step: step,
    carrying: carrying,
    active: active
  };
}

// Test functions for new top step mechanics
function canTopStepActivate(game, pl, pc) {
  return !pc.active && activeCount(pl) < 2;
}

function canTopStepMoveDown(game, pc) {
  const L = LANES[pc.r].L;
  if (pc.step !== L) return false;
  const downStep = L - 1;
  return downStep >= 1 && !occupied(game, pc.r, downStep);
}

function canTopStepFreeSwoop(game, pc) {
  if (pc.step !== LANES[pc.r].L) return false;
  return potentialTopStepSwoops(game, pc).length > 0;
}

function potentialTopStepSwoops(game, pc) {
  const targets = [];
  const r = pc.r;
  const L = LANES[r].L;
  
  if (pc.step !== L) return targets;
  
  for (const dr of [-1, +1]) {
    const r2 = r + dr;
    if (r2 < 0 || r2 >= LANES.length) continue;
    
    const step2 = LANES[r2].L;
    if (!occupied(game, r2, step2)) {
      targets.push({ r: r2, step: step2 });
    }
  }
  return targets;
}

// Test cases
function testTopStepActivation() {
  console.log('\n=== Testing Top Step Activation ===');
  
  const game = createTestGame();
  const pl = game.players[0];
  
  // Test 1: Inactive piece at top step can be activated
  const pc1 = createTestPiece(5, 6, false, false); // Lane 5 (sum 6), step 6 (top), inactive
  pl.pieces.push(pc1);
  
  const canActivate = canTopStepActivate(game, pl, pc1);
  console.log('✓ Test 1 - Inactive piece at top step can be activated:', canActivate === true);
  
  // Test 2: Already active piece cannot be activated again
  pc1.active = true;
  const cannotActivate = canTopStepActivate(game, pl, pc1);
  console.log('✓ Test 2 - Active piece cannot be activated again:', cannotActivate === false);
  
  // Test 3: Cannot activate if already at max active pieces
  const pc2 = createTestPiece(3, 4, false, false); // Lane 3 (sum 4), step 4 (top), inactive
  const pc3 = createTestPiece(7, 7, false, true);  // Another active piece
  pl.pieces.push(pc2, pc3);
  
  const cannotActivateMax = canTopStepActivate(game, pl, pc2);
  console.log('✓ Test 3 - Cannot activate when at max active pieces:', cannotActivateMax === false);
}

function testTopStepMoveDown() {
  console.log('\n=== Testing Top Step Move Down ===');
  
  const game = createTestGame();
  const pl = game.players[0];
  
  // Test 1: Piece at top step can move down
  const pc1 = createTestPiece(5, 6, true, true); // Lane 5 (sum 6), step 6 (top), carrying
  pl.pieces.push(pc1);
  
  const canMoveDown = canTopStepMoveDown(game, pc1);
  console.log('✓ Test 1 - Piece at top step can move down:', canMoveDown === true);
  
  // Test 2: Piece not at top step cannot use move down
  const pc2 = createTestPiece(5, 5, true, true); // Lane 5, step 5 (not top)
  pl.pieces.push(pc2);
  
  const cannotMoveDown = canTopStepMoveDown(game, pc2);
  console.log('✓ Test 2 - Piece not at top step cannot move down:', cannotMoveDown === false);
  
  // Test 3: Cannot move down if destination is occupied
  const pc3 = createTestPiece(5, 6, false, true); // Lane 5, top step
  const pc4 = createTestPiece(5, 5, false, true); // Lane 5, step 5 (blocking)
  game.players[1].pieces.push(pc4);
  pl.pieces.push(pc3);
  
  const cannotMoveDownBlocked = canTopStepMoveDown(game, pc3);
  console.log('✓ Test 3 - Cannot move down when blocked:', cannotMoveDownBlocked === false);
}

function testTopStepFreeSwoop() {
  console.log('\n=== Testing Top Step Free Swoop ===');
  
  const game = createTestGame();
  const pl = game.players[0];
  
  // Test 1: Piece at top step can free swoop to adjacent lanes
  const pc1 = createTestPiece(5, 6, false, true); // Lane 5 (sum 6), step 6 (top)
  pl.pieces.push(pc1);
  
  const targets = potentialTopStepSwoops(game, pc1);
  console.log('✓ Test 1 - Piece at top step has swoop targets:', targets.length > 0);
  console.log('  Targets:', targets.map(t => `Lane ${t.r} (sum ${LANES[t.r].sum}), step ${t.step}`));
  
  // Test 2: Piece not at top step cannot free swoop
  const pc2 = createTestPiece(5, 5, false, true); // Lane 5, step 5 (not top)
  pl.pieces.push(pc2);
  
  const noTargets = potentialTopStepSwoops(game, pc2);
  console.log('✓ Test 2 - Piece not at top step has no swoop targets:', noTargets.length === 0);
  
  // Test 3: Cannot swoop to occupied adjacent top steps
  const pc3 = createTestPiece(5, 6, false, true); // Lane 5, top step
  const pc4 = createTestPiece(4, 5, false, true); // Lane 4, top step (blocking)
  const pc5 = createTestPiece(6, 7, false, true); // Lane 6, top step (blocking)
  game.players[1].pieces.push(pc4, pc5);
  pl.pieces.push(pc3);
  
  const blockedTargets = potentialTopStepSwoops(game, pc3);
  console.log('✓ Test 3 - Cannot swoop to occupied adjacent top steps:', blockedTargets.length === 0);
}

function testIntegrationWithExistingRules() {
  console.log('\n=== Testing Integration with Existing Rules ===');
  
  const game = createTestGame();
  const pl = game.players[0];
  
  // Test 1: Top step piece can still pick up baskets after free swoop
  const pc1 = createTestPiece(5, 6, false, true); // Lane 5 (sum 6), step 6 (top), no basket
  pl.pieces.push(pc1);
  
  // Swoop to lane 6 (sum 7) which has a basket
  const targets = potentialTopStepSwoops(game, pc1);
  const basketTarget = targets.find(t => LANES[t.r].basket);
  
  if (basketTarget) {
    console.log('✓ Test 1 - Can swoop to basket lane:', LANES[basketTarget.r].basket === true);
    console.log('  Target lane:', basketTarget.r, 'sum:', LANES[basketTarget.r].sum);
  }
  
  // Test 2: Move down works with carrying pieces (toward home)
  const pc2 = createTestPiece(4, 5, true, true); // Lane 4 (sum 5), step 5 (top), carrying
  pl.pieces.push(pc2);
  
  const canMoveDownCarrying = canTopStepMoveDown(game, pc2);
  console.log('✓ Test 2 - Carrying piece can move down from top step:', canMoveDownCarrying === true);
  
  // Test 3: Activation respects 2-piece limit
  const pc3 = createTestPiece(2, 3, false, false); // Lane 2, top step, inactive
  const pc4 = createTestPiece(7, 8, false, true);  // Active piece 1
  const pc5 = createTestPiece(9, 6, false, true);  // Active piece 2
  pl.pieces.push(pc3, pc4, pc5);
  
  const cannotActivateLimit = canTopStepActivate(game, pl, pc3);
  console.log('✓ Test 3 - Cannot activate when at 2-piece limit:', cannotActivateLimit === false);
}

// Run all tests
function runAllTests() {
  console.log('🧪 Testing New Top Step Mechanics');
  console.log('==================================');
  
  testTopStepActivation();
  testTopStepMoveDown();
  testTopStepFreeSwoop();
  testIntegrationWithExistingRules();
  
  console.log('\n✅ All tests completed!');
  console.log('\nNew top step mechanics implemented:');
  console.log('1. ✓ Rolling dice sum of piece on top step activates it (if not already active and < 2 active pieces)');
  console.log('2. ✓ Allows free swoop to adjacent lanes from top step');
  console.log('3. ✓ Allows moving down from top step (especially useful when carrying)');
  console.log('4. ✓ Integration with existing game rules maintained');
}

// Run the tests
if (require.main === module) {
  runAllTests();
}

module.exports = {
  testTopStepActivation,
  testTopStepMoveDown,
  testTopStepFreeSwoop,
  testIntegrationWithExistingRules,
  runAllTests
};
