import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import './aaa-board/aaa.css';

// Enable AAA skin via ?skin=aaa (persists in localStorage)
try {
  const params = new URLSearchParams(window.location.search);
  const skin = params.get('skin') || localStorage.getItem('SWOOP_SKIN');
  if (skin === 'aaa') {
    document.body.classList.add('skin-aaa');
    localStorage.setItem('SWOOP_SKIN', 'aaa');
  }
} catch (_) {}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
