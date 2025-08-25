import { useState } from 'react';

// Encapsulates all mutable game state and related actions. Components
// interact with this hook via the returned API so App can remain a thin
// coordinator.
export default function useGameState() {
  const [dice, setDice] = useState([1, 1, 1]);
  const [selectedPair, setSelectedPair] = useState(null);
  const [pieces, setPieces] = useState([]); // {id, r, step}
  const [lanes] = useState([
    { sum: 2, L: 3 },
    { sum: 3, L: 4 },
    { sum: 4, L: 5 },
    { sum: 5, L: 6 },
    { sum: 6, L: 7 },
    { sum: 7, L: 8 },
    { sum: 8, L: 7 },
    { sum: 9, L: 6 },
    { sum: 10, L: 5 },
    { sum: 11, L: 4 },
    { sum: 12, L: 3 },
  ]);

  const rollDice = () => {
    const next = Array.from({ length: 3 }, () => Math.floor(Math.random() * 6) + 1);
    setDice(next);
    setSelectedPair(null);
  };

  const selectPair = pair => {
    setSelectedPair(pair);
  };

  const move = () => {
    if (!selectedPair) return;
    const sum = selectedPair[0] + selectedPair[1];
    const laneIndex = lanes.findIndex(l => l.sum === sum);
    if (laneIndex === -1) return;
    const existing = pieces.find(p => p.r === laneIndex);
    if (existing) {
      setPieces(pieces.map(p => (p.r === laneIndex ? { ...p, step: p.step + 1 } : p)));
    } else {
      setPieces([...pieces, { id: Date.now(), r: laneIndex, step: 1 }]);
    }
    setSelectedPair(null);
  };

  const swoop = () => {
    if (!selectedPair) return;
    // Placeholder for future swoop behavior.
    setSelectedPair(null);
  };

  const bank = () => {
    // Placeholder for future bank behavior.
    setSelectedPair(null);
  };

  const resetPieces = () => {
    setPieces([]);
  };

  return {
    dice,
    selectedPair,
    pieces,
    lanes,
    rollDice,
    selectPair,
    move,
    swoop,
    bank,
    resetPieces,
  };
}

