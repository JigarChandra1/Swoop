import React from 'react';

// Controls renders the action buttons for a turn. The component is
// dumb and simply invokes callbacks provided by App when a button is
// pressed. Whether a control is enabled is also determined by App via
// props.
export default function Controls({ onRoll, onMove, moveDisabled, onSwoop, onBank }) {
  return (
    <div className="flex gap-2 flex-wrap">
      <button className="px-3 py-2 bg-blue-500 text-white rounded" onClick={onRoll}>
        Roll 3 Dice
      </button>
      <button
        className="px-3 py-2 bg-gray-200 rounded"
        onClick={onMove}
        disabled={moveDisabled}
      >
        Use Pair → Move
      </button>
      <button
        className="px-3 py-2 bg-gray-200 rounded"
        onClick={onSwoop}
        disabled={moveDisabled}
      >
        Use Pair → Swoop
      </button>
      <button className="px-3 py-2 bg-gray-200 rounded" onClick={onBank}>
        Bank
      </button>
    </div>
  );
}

