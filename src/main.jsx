import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
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

// Register the PWA service worker immediately so assets are cached on first load.
registerSW({ immediate: true });
