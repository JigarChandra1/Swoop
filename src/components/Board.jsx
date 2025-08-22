import React from 'react';

// Board is responsible for rendering the lanes and pieces. It receives
// the static lane configuration and the list of pieces from App via
// props. When a cell is clicked it emits the lane and step coordinates
// back to the parent so App can decide what to do.
export default function Board({ lanes, pieces, onCellClick }) {
  return (
    <div className="board space-y-2">
      {lanes.map((lane, r) => (
        <div key={lane.sum} className="flex gap-1" data-lane={lane.sum}>
          {Array.from({ length: lane.L }).map((_, idx) => {
            const step = idx + 1;
            const piece = pieces.find(p => p.r === r && p.step === step);
            return (
              <div
                key={step}
                className="w-8 h-8 bg-gray-200 rounded flex items-center justify-center cursor-pointer"
                onClick={() => onCellClick && onCellClick(r, step)}
              >
                {piece ? <span>{piece.icon || '•'}</span> : null}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

