#!/usr/bin/env node

// Simple debug script to test one game
const { runSimulation } = require('./src/sim/simulate.js');

console.log('Starting simple debug simulation...');

try {
  console.log('Running 1 game to target 3...');
  const result = runSimulation({ rounds: 1, target: 3, seed: 42 });
  console.log('Simulation completed successfully:');
  console.log(`Games: ${result.games_played}`);
  console.log(`Winner: Bot${result.wins_bot1 > 0 ? '1' : '2'}`);
  console.log(`Avg turns: ${result.avg_turns_per_game}`);
  console.log(`Avg rolls: ${result.avg_rolls_per_game}`);
} catch (error) {
  console.error('Simulation failed with error:', error);
  console.error('Stack trace:', error.stack);
}
