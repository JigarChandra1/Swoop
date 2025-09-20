// Test script to verify the fix for multiple pieces on same route
// This tests the scenario from swoop_state_17.json where a player should be able to move
// the active piece when there's another inactive piece on the same route

// Import the simulate.js functions (simplified for testing)
const LANES = [
  { sum: 2, L: 3, basket: true },
  { sum: 3, L: 5, basket: false },
  { sum: 4, L: 6, basket: true },
  { sum: 5, L: 8, basket: false },
  { sum: 6, L: 10, basket: true },
  { sum: 7, L: 12, basket: false },
  { sum: 8, L: 11, basket: true },
  { sum: 9, L: 9, basket: false },
  { sum: 10, L: 7, basket: true },
  { sum: 11, L: 4, basket: false },
  { sum: 12, L: 2, basket: true }
];

function occupied(game, r, step) {
  for (const pl of game.players) {
    if (pl.pieces.some((pc) => pc.r === r && pc.step === step)) return true;
  }
  return false;
}

function activeCount(pl) {
  return pl.pieces.filter((p) => p.active).length;
}

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
  // Simplified - just return false for this test
  return false;
}

// Updated canMoveOnSum function with the fix
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
      
      // Special case: piece at top step has multiple options
      if (pc.step === L) {
        if (canTopStepActivate(game, pl, pc) || canTopStepMoveDown(game, pc) || canTopStepFreeSwoop(game, pc)) {
          return true;
        }
      } else {
        // Normal movement check
        const dir = pc.carrying ? -1 : +1;
        const ns = pc.step + dir;
        if (ns >= 1 && ns <= L && !occupied(game, pc.r, ns)) {
          return true;
        }
      }
    }
    
    // Check inactive pieces - they can move if they can be activated first
    if (activeCount(pl) < 2) {
      for (const pc of inactivePieces) {
        const L = LANES[pc.r].L;
        
        // Special case: piece at top step has multiple options
        if (pc.step === L) {
          if (canTopStepActivate(game, pl, pc) || canTopStepMoveDown(game, pc) || canTopStepFreeSwoop(game, pc)) {
            return true;
          }
        } else {
          // Normal movement check (after potential activation)
          const dir = pc.carrying ? -1 : +1;
          const ns = pc.step + dir;
          if (ns >= 1 && ns <= L && !occupied(game, pc.r, ns)) {
            return true;
          }
        }
      }
    }
    
    return false;
  } else {
    // No pieces on route - check if we can spawn a new piece
    return pl.pieces.length < 5 && !occupied(game, r, 1) && activeCount(pl) < 2;
  }
}

// Test the scenario from swoop_state_17.json
function testMultiplePiecesScenario() {
  console.log('Testing multiple pieces on same route scenario...');
  
  // Recreate the game state from swoop_state_17.json
  const game = {
    players: [
      {
        name: "Monkeys",
        pieces: [
          {
            r: 5,  // Route with sum 7
            step: 4,
            carrying: false,
            active: false
          },
          {
            r: 5,  // Same route with sum 7
            step: 5,
            carrying: false,
            active: true  // This piece should be able to move
          },
          {
            r: 3,
            step: 1,
            carrying: false,
            active: true
          }
        ]
      },
      {
        name: "Seagulls",
        pieces: [
          {
            r: 5,
            step: 4,
            carrying: false,
            active: false
          },
          {
            r: 3,
            step: 5,
            carrying: false,
            active: false
          }
        ]
      }
    ],
    current: 0
  };
  
  const player = game.players[0];
  const sum = 7; // The sum that was rolled
  
  console.log('Player pieces on route 5 (sum 7):');
  const piecesOnRoute5 = player.pieces.filter(p => p.r === 5);
  piecesOnRoute5.forEach((pc, i) => {
    console.log(`  Piece ${i + 1}: step ${pc.step}, active: ${pc.active}`);
  });
  
  // Test the old logic (would fail)
  console.log('\nTesting with old logic (pieceOnLane returns first piece):');
  const firstPiece = player.pieces.find(p => p.r === 5); // This returns the inactive piece at step 4
  console.log(`First piece found: step ${firstPiece.step}, active: ${firstPiece.active}`);
  const oldLogicResult = firstPiece.active || activeCount(player) < 2;
  console.log(`Old logic would allow move: ${oldLogicResult}`);
  
  // Test the new logic (should succeed)
  console.log('\nTesting with new logic (checks all pieces):');
  const newLogicResult = canMoveOnSum(game, player, sum);
  console.log(`New logic allows move: ${newLogicResult}`);
  
  // Verify the fix works
  if (newLogicResult && !oldLogicResult) {
    console.log('\n✅ SUCCESS: Fix works! The active piece can now move even when there\'s an inactive piece on the same route.');
  } else if (newLogicResult && oldLogicResult) {
    console.log('\n⚠️  Both old and new logic work - this scenario might not demonstrate the issue.');
  } else {
    console.log('\n❌ FAILURE: The fix did not resolve the issue.');
  }
  
  return newLogicResult;
}

// Test with the exact saved game state
function testSavedGameState() {
  console.log('\n' + '='.repeat(60));
  console.log('Testing with exact saved game state from swoop_state_17.json...');

  // Load the exact state from the saved game
  const savedState = {
    "version": "v5.3",
    "players": [
      {
        "name": "Monkeys",
        "pieceIcon": "🐒",
        "activeIcon": "🐵",
        "score": 0,
        "pieces": [
          {
            "r": 5,
            "step": 4,
            "carrying": false,
            "active": false
          },
          {
            "r": 5,
            "step": 5,
            "carrying": false,
            "active": true
          },
          {
            "r": 3,
            "step": 1,
            "carrying": false,
            "active": true
          }
        ]
      },
      {
        "name": "Seagulls",
        "pieceIcon": "🕊️",
        "activeIcon": "🦅",
        "score": 0,
        "pieces": [
          {
            "r": 5,
            "step": 4,
            "carrying": false,
            "active": false
          },
          {
            "r": 3,
            "step": 5,
            "carrying": false,
            "active": false
          }
        ]
      }
    ],
    "current": 0,
    "selectedPair": {
      "i": 0,
      "j": 2,
      "sum": 7
    }
  };

  const player = savedState.players[0];
  const selectedSum = savedState.selectedPair.sum;

  console.log(`Current player: ${player.name}`);
  console.log(`Selected sum: ${selectedSum}`);
  console.log(`Active pieces count: ${activeCount(player)}`);

  // Show all pieces on route 5 (sum 7)
  console.log('\nPieces on route 5 (sum 7):');
  const route5Pieces = player.pieces.filter(p => p.r === 5);
  route5Pieces.forEach((pc, i) => {
    console.log(`  ${player.name} piece ${i + 1}: step ${pc.step}, active: ${pc.active}, carrying: ${pc.carrying}`);
  });

  // Test if the active piece at step 5 can move to step 6
  const activePiece = route5Pieces.find(p => p.active);
  if (activePiece) {
    const L = LANES[5].L; // Route 5 has L = 12
    const dir = activePiece.carrying ? -1 : +1;
    const nextStep = activePiece.step + dir;
    const canMoveDirectly = nextStep >= 1 && nextStep <= L && !occupied(savedState, activePiece.r, nextStep);

    console.log(`\nActive piece at step ${activePiece.step}:`);
    console.log(`  Next step would be: ${nextStep}`);
    console.log(`  Route length (L): ${L}`);
    console.log(`  Is next step occupied: ${occupied(savedState, activePiece.r, nextStep)}`);
    console.log(`  Can move directly: ${canMoveDirectly}`);
  }

  // Test the canMoveOnSum function
  const canMove = canMoveOnSum(savedState, player, selectedSum);
  console.log(`\ncanMoveOnSum result: ${canMove}`);

  if (canMove) {
    console.log('✅ SUCCESS: Player can move on sum 7 (the active piece at step 5 can advance to step 6)');
  } else {
    console.log('❌ FAILURE: Player cannot move on sum 7');
  }

  return canMove;
}

// Run both tests
const test1Result = testMultiplePiecesScenario();
const test2Result = testSavedGameState();

console.log('\n' + '='.repeat(60));
console.log('SUMMARY:');
console.log(`Test 1 (Basic scenario): ${test1Result ? 'PASS' : 'FAIL'}`);
console.log(`Test 2 (Saved game state): ${test2Result ? 'PASS' : 'FAIL'}`);

if (test1Result && test2Result) {
  console.log('🎉 ALL TESTS PASSED! The fix successfully handles multiple pieces on the same route.');
} else {
  console.log('⚠️  Some tests failed. The fix may need further adjustment.');
}
