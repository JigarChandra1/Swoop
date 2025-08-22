import React, { useState } from 'react';
import Board from './components/Board';
import DiceRoll from './components/DiceRoll';
import Controls from './components/Controls';
import TailwindOptions from './components/TailwindOptions';

// The main application keeps all game state and passes data down to
// presentational components. Child components communicate actions
// through callback props which allows App to remain the single source
// of truth.
export default function App() {
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

  const handleSelectPair = pair => {
    setSelectedPair(pair);
  };

  const handleMove = () => {
    if (!selectedPair) return;
    const sum = selectedPair[0] + selectedPair[1];
    const laneIndex = lanes.findIndex(l => l.sum === sum);
    if (laneIndex === -1) return;
    const existing = pieces.find(p => p.r === laneIndex);
    if (existing) {
      setPieces(pieces.map(p => p.r === laneIndex ? { ...p, step: p.step + 1 } : p));
    } else {
      setPieces([...pieces, { id: Date.now(), r: laneIndex, step: 1 }]);
    }
    setSelectedPair(null);
  };

  const handleCellClick = (r, step) => {
    // Placeholder interaction for board clicks
    console.log('cell', r, step);
  };

  return (
    <div className="p-4 space-y-4">
      <TailwindOptions onReset={() => setPieces([])} />
      <Controls
        onRoll={rollDice}
        onMove={handleMove}
        moveDisabled={!selectedPair}
      />
      <DiceRoll
        dice={dice}
        selectedPair={selectedPair}
        onSelectPair={handleSelectPair}
      />
      <Board
        lanes={lanes}
        pieces={pieces}
        onCellClick={handleCellClick}
      />
    </div>
  );
}

