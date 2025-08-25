import React from 'react';
import Board from './components/Board';
import DiceRoll from './components/DiceRoll';
import Controls from './components/Controls';
import TailwindOptions from './components/TailwindOptions';
import useGameState from './hooks/useGameState';

// The main application delegates game state to the custom useGameState
// hook while remaining the central coordinator for rendering and event
// wiring between child components.
export default function App() {
  const {
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
  } = useGameState();

  const handleCellClick = (r, step) => {
    // Placeholder interaction for board clicks
    console.log('cell', r, step);
  };

  return (
    <div className="p-4 space-y-4">
      <TailwindOptions onReset={resetPieces} />
      <Controls
        onRoll={rollDice}
        onMove={move}
        onSwoop={swoop}
        onBank={bank}
        moveDisabled={!selectedPair}
      />
      <DiceRoll
        dice={dice}
        selectedPair={selectedPair}
        onSelectPair={selectPair}
      />
      <Board
        lanes={lanes}
        pieces={pieces}
        onCellClick={handleCellClick}
      />
    </div>
  );
}

