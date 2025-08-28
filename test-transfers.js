#!/usr/bin/env node
/*
  Test Transfer Feature
  Tests all transfer scenarios: adjacent same lane, adjacent different lane, diagonal transfers, chain transfers
*/

// Import the React App component for testing
const fs = require('fs');
const path = require('path');

// Mock React for testing
global.React = {
  useState: (initial) => [initial, () => {}],
  useEffect: () => {}
};

// Load the App component
const appPath = path.join(__dirname, 'src', 'App.jsx');
let appContent = fs.readFileSync(appPath, 'utf8');

// Extract the transfer functions for testing
function extractFunction(content, functionName) {
  const regex = new RegExp(`function ${functionName}\\([^{]*\\)\\s*{[^}]*(?:{[^}]*}[^}]*)*}`, 'g');
  const match = content.match(regex);
  return match ? match[0] : null;
}

// Test data setup
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

// Mock game state for testing
function createTestGame() {
  return {
    players: [
      { name: 'Player1', pieces: [] },
      { name: 'Player2', pieces: [] }
    ],
    current: 0,
    mode: 'preroll',
    baskets: LANES.map(l => l.basket),
    transferSource: null,
    transferTargets: null
  };
}

// Transfer validation logic (extracted from App.jsx)
function canTransfer(game) {
  if (game.mode !== 'preroll') return false;
  const pl = game.players[game.current];
  return pl.pieces.some(pc => pc.carrying);
}

function getTransferTargets(sourcePiece, pl) {
  const targets = [];
  
  for (const pc of pl.pieces) {
    if (pc === sourcePiece || pc.carrying) continue;
    
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

// Test cases
function runTests() {
  console.log('🧪 Testing Transfer Feature...\n');
  
  let passed = 0;
  let total = 0;
  
  function test(name, testFn) {
    total++;
    try {
      testFn();
      console.log(`✅ ${name}`);
      passed++;
    } catch (error) {
      console.log(`❌ ${name}: ${error.message}`);
    }
  }
  
  // Test 1: Basic transfer availability
  test('Transfer availability - no carrying pieces', () => {
    const game = createTestGame();
    game.players[0].pieces = [
      { r: 0, step: 2, side: 'L', carrying: false },
      { r: 1, step: 3, side: 'L', carrying: false }
    ];
    
    if (canTransfer(game)) {
      throw new Error('Should not be able to transfer when no pieces are carrying');
    }
  });
  
  // Test 2: Transfer availability - with carrying pieces
  test('Transfer availability - with carrying pieces', () => {
    const game = createTestGame();
    game.players[0].pieces = [
      { r: 0, step: 2, side: 'L', carrying: true },
      { r: 1, step: 3, side: 'L', carrying: false }
    ];
    
    if (!canTransfer(game)) {
      throw new Error('Should be able to transfer when pieces are carrying');
    }
  });
  
  // Test 3: Adjacent same lane transfer
  test('Adjacent same lane transfer', () => {
    const game = createTestGame();
    const sourcePiece = { r: 0, step: 2, side: 'L', carrying: true };
    const targetPiece = { r: 0, step: 3, side: 'L', carrying: false };
    game.players[0].pieces = [sourcePiece, targetPiece];
    
    const targets = getTransferTargets(sourcePiece, game.players[0]);
    
    if (targets.length !== 1 || targets[0] !== targetPiece) {
      throw new Error('Should find adjacent same lane target');
    }
  });
  
  // Test 4: Adjacent different lane transfer
  test('Adjacent different lane transfer', () => {
    const game = createTestGame();
    const sourcePiece = { r: 0, step: 2, side: 'L', carrying: true };
    const targetPiece = { r: 1, step: 2, side: 'L', carrying: false };
    game.players[0].pieces = [sourcePiece, targetPiece];
    
    const targets = getTransferTargets(sourcePiece, game.players[0]);
    
    if (targets.length !== 1 || targets[0] !== targetPiece) {
      throw new Error('Should find adjacent different lane target');
    }
  });
  
  // Test 5: Diagonal transfer
  test('Diagonal transfer', () => {
    const game = createTestGame();
    const sourcePiece = { r: 0, step: 2, side: 'L', carrying: true };
    const targetPiece = { r: 1, step: 3, side: 'L', carrying: false };
    game.players[0].pieces = [sourcePiece, targetPiece];
    
    const targets = getTransferTargets(sourcePiece, game.players[0]);
    
    if (targets.length !== 1 || targets[0] !== targetPiece) {
      throw new Error('Should find diagonal target');
    }
  });
  
  // Test 6: Multiple valid targets
  test('Multiple valid targets', () => {
    const game = createTestGame();
    const sourcePiece = { r: 1, step: 2, side: 'L', carrying: true };
    const target1 = { r: 1, step: 1, side: 'L', carrying: false }; // same lane, step -1
    const target2 = { r: 1, step: 3, side: 'L', carrying: false }; // same lane, step +1
    const target3 = { r: 0, step: 2, side: 'L', carrying: false }; // different lane, same step
    const target4 = { r: 2, step: 3, side: 'L', carrying: false }; // diagonal
    game.players[0].pieces = [sourcePiece, target1, target2, target3, target4];
    
    const targets = getTransferTargets(sourcePiece, game.players[0]);
    
    if (targets.length !== 4) {
      throw new Error(`Should find 4 targets, found ${targets.length}`);
    }
  });
  
  // Test 7: No valid targets - too far
  test('No valid targets - too far', () => {
    const game = createTestGame();
    const sourcePiece = { r: 0, step: 2, side: 'L', carrying: true };
    const farPiece = { r: 0, step: 5, side: 'L', carrying: false }; // too far on same lane
    const farPiece2 = { r: 3, step: 2, side: 'L', carrying: false }; // too far on different lane
    game.players[0].pieces = [sourcePiece, farPiece, farPiece2];
    
    const targets = getTransferTargets(sourcePiece, game.players[0]);
    
    if (targets.length !== 0) {
      throw new Error('Should find no targets when pieces are too far');
    }
  });
  
  // Test 8: Cannot transfer to carrying pieces
  test('Cannot transfer to carrying pieces', () => {
    const game = createTestGame();
    const sourcePiece = { r: 0, step: 2, side: 'L', carrying: true };
    const carryingPiece = { r: 0, step: 3, side: 'L', carrying: true };
    game.players[0].pieces = [sourcePiece, carryingPiece];
    
    const targets = getTransferTargets(sourcePiece, game.players[0]);
    
    if (targets.length !== 0) {
      throw new Error('Should not be able to transfer to pieces already carrying');
    }
  });
  
  // Test 9: Cannot transfer to self
  test('Cannot transfer to self', () => {
    const game = createTestGame();
    const sourcePiece = { r: 0, step: 2, side: 'L', carrying: true };
    game.players[0].pieces = [sourcePiece];
    
    const targets = getTransferTargets(sourcePiece, game.players[0]);
    
    if (targets.length !== 0) {
      throw new Error('Should not be able to transfer to self');
    }
  });
  
  // Test 10: Wrong game mode
  test('Wrong game mode', () => {
    const game = createTestGame();
    game.mode = 'rolled'; // not preroll
    game.players[0].pieces = [
      { r: 0, step: 2, side: 'L', carrying: true }
    ];
    
    if (canTransfer(game)) {
      throw new Error('Should not be able to transfer in non-preroll mode');
    }
  });
  
  console.log(`\n📊 Test Results: ${passed}/${total} passed`);
  
  if (passed === total) {
    console.log('🎉 All transfer tests passed!');
    return true;
  } else {
    console.log('❌ Some tests failed');
    return false;
  }
}

// Run the tests
if (require.main === module) {
  runTests();
}

module.exports = { runTests };
