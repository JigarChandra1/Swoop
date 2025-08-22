import React from 'react';

// DiceRoll renders the individual dice values and allows the user to
// choose a pair. Rolling is handled by the parent via the onRoll prop.
export default function DiceRoll({ dice, selectedPair, onSelectPair }) {
  const pairs = [];
  for (let i = 0; i < dice.length; i++) {
    for (let j = i + 1; j < dice.length; j++) {
      pairs.push([dice[i], dice[j]]);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        {dice.map((d, i) => (
          <div key={i} className="die w-8 h-8 bg-black text-white rounded flex items-center justify-center">
            {d}
          </div>
        ))}
      </div>
      <div className="flex gap-2 flex-wrap">
        {pairs.map((p, idx) => {
          const sum = p[0] + p[1];
          const isSel = selectedPair && selectedPair[0] === p[0] && selectedPair[1] === p[1];
          return (
            <button
              key={idx}
              className={`pair px-2 py-1 border rounded ${isSel ? 'bg-blue-500 text-white' : ''}`}
              onClick={() => onSelectPair && onSelectPair(p)}
            >
              {p[0]} + {p[1]} = {sum}
            </button>
          );
        })}
      </div>
    </div>
  );
}

