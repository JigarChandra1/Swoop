#!/usr/bin/env node
// Play one headless Swoop game using the simulator and write all moves to JSON.
// Usage: node scripts/play_one_game.js [--seed=XYZ] [--bot1=aggressive] [--bot2=aggressive]

const fs = require('fs');
const path = require('path');
const { runSimulation } = require('../src/sim/simulate.js');

function parseArgs(argv){
  const opts = { seed: Date.now().toString(), bot1: 'aggressive', bot2: 'aggressive' };
  for(const a of argv.slice(2)){
    const [k,v] = a.split('=');
    if(k==='--seed') opts.seed = isNaN(Number(v)) ? v : Number(v);
    else if(k==='--bot1') opts.bot1 = v;
    else if(k==='--bot2') opts.bot2 = v;
  }
  return opts;
}

(function main(){
  const { seed, bot1, bot2 } = parseArgs(process.argv);
  const { summary, report } = runSimulation({
    rounds: 1,
    target: 2, // fixed in simulator
    seed,
    saveReport: true,
    botType1: bot1,
    botType2: bot2,
    maxTurns: 1000,
    verbose: false
  });

  const game = report.games[0];

  const out = {
    metadata: {
      generated_at: new Date().toISOString(),
      seed,
      bot1,
      bot2,
      finalScores: game.finalScores,
      winner: game.winner
    },
    moveHistory: game.moveHistory
  };

  // Ensure saved_games exists
  const outDir = path.join(process.cwd(), 'saved_games');
  if(!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g,'-');
  const outFile = path.join(outDir, `swoop_moves_${ts}.json`);
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2));

  console.log(outFile);
})();

