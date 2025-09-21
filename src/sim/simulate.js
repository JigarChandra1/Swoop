#!/usr/bin/env node
/*
  Thin CLI wrapper around the shared Pro bot engine.
  Keeps backwards-compatible commands for running simulations.
*/

const fs = require('fs');
const path = require('path');
const { runSimulation, parseArgs } = require('../bots/proBot.js');

if (require.main === module) {
  const opts = parseArgs(process.argv);
  const result = runSimulation(opts);

  if (opts.saveReport) {
    const { summary, report } = result;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = opts.reportFile || `swoop-simulation-report-${timestamp}.json`;
    const reportsDir = path.join(process.cwd(), 'simulation-reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }
    const filepath = path.join(reportsDir, filename);
    fs.writeFileSync(filepath, JSON.stringify(report, null, 2));
    console.log('=== SIMULATION SUMMARY ===');
    console.log(JSON.stringify(summary, null, 2));
    console.log(`\n=== DETAILED REPORT SAVED ===`);
    console.log(`Report saved to: ${filepath}`);
    console.log(`Total moves recorded: ${report.games.reduce((sum, game) => sum + game.moveHistory.length, 0)}`);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

module.exports = { runSimulation };
