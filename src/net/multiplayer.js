// Minimal client for Swoop backend REST + SSE
// Configure base URL if server not on same origin. In dev, fall back to :4000.
function detectBase() {
  const env = (typeof import.meta !== 'undefined' && import.meta && import.meta.env) ? import.meta.env : {};
  const viaEnv = env?.VITE_SW_BACKEND_URL || (typeof window !== 'undefined' ? window.SW_BACKEND_URL : '');
  if (viaEnv) return viaEnv;
  if (typeof window !== 'undefined') {
    const { hostname, port } = window.location;
    if ((hostname === 'localhost' || hostname === '127.0.0.1') && (port === '5173' || port === '3000')) {
      // Dev default backend port
      return 'http://localhost:4000';
    }
  }
  // Use same-origin (works with Vite dev proxy)
  return '';
}

const BASE_URL = detectBase();

async function j(method, path, body) {
  const res = await fetch(BASE_URL + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'omit',
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json?.error || 'request_failed');
    err.status = res.status;
    err.payload = json;
    throw err;
  }
  return json;
}

export async function createRoom() {
  return j('POST', '/api/rooms');
}

export async function joinRoom(code, { name, preferredSide } = {}) {
  return j('POST', `/api/rooms/${code}/join`, { name, preferredSide });
}

export async function getState(code, since) {
  const qs = since ? `?since=${since}` : '';
  return j('GET', `/api/rooms/${code}/state${qs}`);
}

export async function pushState(code, { playerId, token, baseVersion, state }) {
  return j('POST', `/api/rooms/${code}/state`, { playerId, token, baseVersion, state });
}

export function subscribe(code, onSync) {
  let closed = false;
  let stopSSE = null;
  let stopPoll = null;

  function startPolling() {
    let timer = null;
    const tick = async () => {
      if (closed) return;
      try {
        const res = await getState(code); // full check; server returns unchanged if same version
        if (!res.unchanged) onSync?.({ code: res.code, version: res.version });
      } catch (_) { /* ignore */ }
      timer = setTimeout(tick, 2000);
    };
    tick();
    return () => { if (timer) clearTimeout(timer); };
  }

  // Always run a light polling loop as a safety net (handles serverless/SSE limits)
  stopPoll = startPolling();

  // Try EventSource in parallel (best-effort)
  try {
    const url = (BASE_URL ? BASE_URL : '') + `/api/rooms/${code}/stream`;
    const ev = new EventSource(url, { withCredentials: false });
    const handler = (e) => {
      try { const data = JSON.parse(e.data); onSync?.(data); } catch (_) {}
    };
    ev.addEventListener('sync', handler);
    stopSSE = () => { try { ev.close(); } catch (_) {} };
  } catch (_) {
    // Ignore — polling is already running
  }

  return () => {
    closed = true;
    if (typeof stopSSE === 'function') stopSSE();
    if (typeof stopPoll === 'function') stopPoll();
  };
}

// Simple helper to persist credentials per room
export function loadCreds(code) {
  try { return JSON.parse(localStorage.getItem(`SWOOP_CREDS_${code}`)); } catch (_) { return null; }
}
export function saveCreds(code, creds) {
  try { localStorage.setItem(`SWOOP_CREDS_${code}`, JSON.stringify(creds)); } catch (_) {}
}
