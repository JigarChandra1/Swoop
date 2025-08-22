import React from 'react';

// TailwindOptions demonstrates how styling choices can be exposed from
// React. The component receives a callback which allows the parent to
// respond to a "reset" action that might be useful during development.
export default function TailwindOptions({ onReset }) {
  return (
    <div className="text-sm text-gray-500">
      <button
        className="underline"
        type="button"
        onClick={() => onReset && onReset()}
      >
        Reset Pieces
      </button>
    </div>
  );
}

