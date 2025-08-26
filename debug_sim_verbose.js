#!/usr/bin/env node

// Debug script with verbose logging
const fs = require('fs');

// Copy the simulation code but add debug logging
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
  out.push(L); // Last step is always a checkpointer
  return [...new Set(out)].filter((x) => x >= 1 && x <= L);
}

function initialGame() {
  return {
    players: [
      { name: 'Bot1', side: 'L', score: 0, pieces: [] },
      { name: 'Bot2', side: 'R', score: 0, pieces: [] },
    ],
    current: 0,
    baskets: LANES.map((l) => l.basket),
    moveHistory: [],
  };
}

function makeRng(seed) {
  if (seed === undefined || seed === null) return Math.random;
  const s = typeof seed === 'number' ? seed >>> 0 : hashStr(seed);
  return mulberry32(s);
}

function hashStr(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function r6(rng) {
  return 1 + Math.floor(rng() * 6);
}

function roll3(rng) {
  const d = [r6(rng), r6(rng), r6(rng)];
  const pairs = [
    { i: 0, j: 1, sum: d[0] + d[1] },
    { i: 0, j: 2, sum: d[0] + d[2] },
    { i: 1, j: 2, sum: d[1] + d[2] },
  ];
  return { d, pairs };
}

// Simple test
console.log('Testing basic functions...');
const rng = makeRng(42);
console.log('RNG created');
const game = initialGame();
console.log('Game initialized:', JSON.stringify(game, null, 2));
const roll = roll3(rng);
console.log('Roll result:', roll);

// Test game termination condition
console.log('Testing termination condition...');
console.log('Player 0 score:', game.players[0].score, 'Target: 3');
console.log('Player 1 score:', game.players[1].score, 'Target: 3');
console.log('Should continue?', game.players[0].score < 3 && game.players[1].score < 3);

// Test score increment
game.players[0].score = 3;
console.log('After setting score to 3:');
console.log('Should continue?', game.players[0].score < 3 && game.players[1].score < 3);
console.log('Winner:', game.players[0].score >= 3 ? 0 : 1);
