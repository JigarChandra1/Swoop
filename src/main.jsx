import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.jsx';
import './index.css';
import './aaa-board/aaa.css';

// AAA skin is the default; override with ?skin=classic (stored in localStorage)
try {
  const params = new URLSearchParams(window.location.search);
  let skin = params.get('skin');
  if (skin) {
    localStorage.setItem('SWOOP_SKIN', skin);
  } else {
    skin = localStorage.getItem('SWOOP_SKIN');
  }
  if (!skin) {
    skin = 'aaa';
    localStorage.setItem('SWOOP_SKIN', skin);
  }
  document.body.classList.toggle('skin-aaa', skin === 'aaa');
} catch (_) {}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Register the PWA service worker immediately so assets are cached on first load.
registerSW({ immediate: true });
