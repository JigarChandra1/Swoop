#!/usr/bin/env node

// Simple debug script to test simulation
const { runSimulation } = require('./src/sim/simulate.js');

console.log('Starting debug simulation...');

try {
  const result = runSimulation({ rounds: 1, target: 3, seed: 42 });
  console.log('Simulation completed successfully:');
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error('Simulation failed with error:', error);
  console.error('Stack trace:', error.stack);
}
