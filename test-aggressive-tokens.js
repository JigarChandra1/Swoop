#!/usr/bin/env node

/**
 * Test to verify the aggressive token strategy for pusher bot with 2 swoop tokens
 * Expected behavior:
 * - 80% of the time: bot should target using both tokens (ending with 0 tokens)
 * - 20% of the time: bot should target using 1 token (ending with 1 token)
 */

const { createPusherBot, LANES, makeRng } = require('./src/bots/proBot.js');

console.log('🧪 Testing Aggressive Token Strategy (80/20 distribution)');
console.log('==========================================================\n');

// Create a test game state with a pusher bot that has 2 swoop tokens
function createTestGame() {
  return {
    playerCount: 2,
    current: 0,
    baskets: LANES.map(l => l.basket),
    rollMovesDone: 0,
    moveHistory: [],
    players: [
      {
        name: 'TestBot',
        score: 0,
        swoopTokens: 2,
        pieces: [
          { r: 5, step: 3, carrying: false, active: true }
        ]
      },
      {
        name: 'Opponent',
        score: 0,
        swoopTokens: 1,
        pieces: []
      }
    ]
  };
}

// Test the shouldBank decision multiple times to verify distribution
function testAggressiveTokenDistribution() {
  console.log('Test 1: Verifying 80/20 distribution of aggressive token targets\n');
  
  const trials = 1000;
  let targetBothTokens = 0;
  let targetOneToken = 0;
  
  for (let i = 0; i < trials; i++) {
    const seed = i;
    const rng = makeRng(seed);
    const bot = createPusherBot(rng);
    const game = createTestGame();

    // Add a turn_start to the move history so the turn ID is consistent
    game.moveHistory.push({ type: 'turn_start', player: 0 });

    // Simulate the first shouldBank call which initializes aggressiveTokenTarget
    const turnStats = {
      actionsThisTurn: 1,
      moves: 1,
      swoops: 0,
      busts: 0,
      deliveredThisTurn: 0,
      rolls: 1
    };

    // Ensure game.current is set correctly
    game.current = 0;

    // First call with 2 tokens - this initializes the target
    const shouldBankWith2 = bot.shouldBank(turnStats, rng, game);

    if (shouldBankWith2 === false) {
      // Bot wants to keep rolling with 2 tokens
      // Now check with 1 token (simulating after using one swoop)
      game.players[0].swoopTokens = 1;
      const shouldBankWith1 = bot.shouldBank(turnStats, rng, game);

      if (shouldBankWith1 === false) {
        // Still wants to keep rolling, so target is 0 (use both)
        targetBothTokens++;
      } else {
        // Banks with 1 token, so target is 1 (use one)
        targetOneToken++;
      }
    } else {
      // This shouldn't happen with 2 tokens in aggressive mode
      // but if it does, we'll skip this trial
    }
  }
  
  const percentBoth = (targetBothTokens / trials * 100).toFixed(1);
  const percentOne = (targetOneToken / trials * 100).toFixed(1);
  
  console.log(`Results from ${trials} trials:`);
  console.log(`  Target both tokens (0): ${targetBothTokens} (${percentBoth}%)`);
  console.log(`  Target one token (1):   ${targetOneToken} (${percentOne}%)`);
  console.log();
  
  // Verify the distribution is close to 80/20
  const expectedBoth = 0.8;
  const expectedOne = 0.2;
  const tolerance = 0.05; // 5% tolerance
  
  const actualBoth = targetBothTokens / trials;
  const actualOne = targetOneToken / trials;
  
  const bothInRange = Math.abs(actualBoth - expectedBoth) <= tolerance;
  const oneInRange = Math.abs(actualOne - expectedOne) <= tolerance;
  
  if (bothInRange && oneInRange) {
    console.log('✅ PASS: Distribution is within expected range (80% ± 5%, 20% ± 5%)');
    return true;
  } else {
    console.log('❌ FAIL: Distribution is outside expected range');
    console.log(`   Expected: 80% ± 5% for both tokens, 20% ± 5% for one token`);
    console.log(`   Actual: ${percentBoth}% for both tokens, ${percentOne}% for one token`);
    return false;
  }
}

// Test that the bot keeps rolling when it has more tokens than the target
function testKeepRollingBehavior() {
  console.log('\nTest 2: Verifying bot keeps rolling until target is reached\n');

  // Test case 1: Bot with seed that produces target=0 (use both tokens)
  {
    // Seed 100 produces target=0 based on our earlier debug output
    const seed = 100;
    const rng = makeRng(seed);
    const bot = createPusherBot(rng);
    const game = createTestGame();
    game.current = 0;
    const turnStats = { actionsThisTurn: 1, moves: 1, swoops: 0, busts: 0, deliveredThisTurn: 0, rolls: 1 };

    // Bot has 2 tokens, target should be 0 - should NOT bank
    const shouldBank1 = bot.shouldBank(turnStats, rng, game);
    console.log(`  Case 1: Bot has 2 tokens, target is 0`);
    console.log(`    shouldBank = ${shouldBank1} (expected: false)`);

    if (shouldBank1 === false) {
      console.log('    ✅ PASS: Bot keeps rolling');
    } else {
      console.log('    ❌ FAIL: Bot should keep rolling');
      return false;
    }

    // Simulate using one token (now has 1 token)
    game.players[0].swoopTokens = 1;
    const shouldBank2 = bot.shouldBank(turnStats, rng, game);
    console.log(`  Case 2: Bot has 1 token, target is 0`);
    console.log(`    shouldBank = ${shouldBank2} (expected: false)`);

    if (shouldBank2 === false) {
      console.log('    ✅ PASS: Bot keeps rolling');
    } else {
      console.log('    ❌ FAIL: Bot should keep rolling');
      return false;
    }

    // Simulate using second token (now has 0 tokens)
    game.players[0].swoopTokens = 0;
    const shouldBank3 = bot.shouldBank(turnStats, rng, game);
    console.log(`  Case 3: Bot has 0 tokens, target is 0`);
    console.log(`    shouldBank = ${shouldBank3} (expected: true)`);

    if (shouldBank3 === true) {
      console.log('    ✅ PASS: Bot banks after reaching target');
    } else {
      console.log('    ❌ FAIL: Bot should bank after reaching target');
      return false;
    }
  }

  // Test case 2: Bot with seed that produces target=1 (use one token)
  {
    // Seed 42 produces target=1 based on our earlier debug output
    const seed = 42;
    const rng = makeRng(seed);
    const bot = createPusherBot(rng);
    const game = createTestGame();
    game.current = 0;
    const turnStats = { actionsThisTurn: 1, moves: 1, swoops: 0, busts: 0, deliveredThisTurn: 0, rolls: 1 };

    // Bot has 2 tokens, target should be 1 - should NOT bank
    const shouldBank1 = bot.shouldBank(turnStats, rng, game);
    console.log(`\n  Case 4: Bot has 2 tokens, target is 1`);
    console.log(`    shouldBank = ${shouldBank1} (expected: false)`);

    if (shouldBank1 === false) {
      console.log('    ✅ PASS: Bot keeps rolling');
    } else {
      console.log('    ❌ FAIL: Bot should keep rolling');
      return false;
    }

    // Simulate using one token (now has 1 token)
    game.players[0].swoopTokens = 1;
    const shouldBank2 = bot.shouldBank(turnStats, rng, game);
    console.log(`  Case 5: Bot has 1 token, target is 1`);
    console.log(`    shouldBank = ${shouldBank2} (expected: true)`);

    if (shouldBank2 === true) {
      console.log('    ✅ PASS: Bot banks after reaching target');
    } else {
      console.log('    ❌ FAIL: Bot should bank after reaching target');
      return false;
    }
  }

  console.log('\n✅ PASS: All keep rolling behavior tests passed');
  return true;
}

// Run all tests
function runTests() {
  let allPassed = true;
  
  allPassed = testAggressiveTokenDistribution() && allPassed;
  allPassed = testKeepRollingBehavior() && allPassed;
  
  console.log('\n' + '='.repeat(60));
  if (allPassed) {
    console.log('✅ ALL TESTS PASSED');
    process.exit(0);
  } else {
    console.log('❌ SOME TESTS FAILED');
    process.exit(1);
  }
}

runTests();

