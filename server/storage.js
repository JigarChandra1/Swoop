const fs = require('fs');
const fsp = fs.promises;

function makeMemoryStore() {
  const db = new Map();
  return {
    kind: 'memory',
    async get(key) { return db.get(key) || null; },
    async set(key, val) { db.set(key, val); },
    async del(key) { db.delete(key); },
    async sadd(setKey, member) {
      const s = db.get(setKey) || new Set(); s.add(member); db.set(setKey, s);
    },
    async srem(setKey, member) {
      const s = db.get(setKey) || new Set(); s.delete(member); db.set(setKey, s);
    },
    async smembers(setKey) {
      const s = db.get(setKey) || new Set(); return Array.from(s);
    }
  };
}

function makeFileStore(filePath) {
  const path = filePath || (process.env.STORAGE_FILE || 'server-data/rooms.json');
  async function readAll() {
    try { await fsp.mkdir(require('path').dirname(path), { recursive: true }); } catch(_) {}
    try { const txt = await fsp.readFile(path, 'utf8'); return JSON.parse(txt); } catch(e) { return {}; }
  }
  async function writeAll(obj) {
    await fsp.writeFile(path, JSON.stringify(obj), 'utf8');
  }
  return {
    kind: 'file',
    async get(key) { const all = await readAll(); return all[key] || null; },
    async set(key, val) { const all = await readAll(); all[key] = val; await writeAll(all); },
    async del(key) { const all = await readAll(); delete all[key]; await writeAll(all); },
    async sadd(setKey, member) { const all = await readAll(); const s = new Set(all[setKey] || []); s.add(member); all[setKey] = Array.from(s); await writeAll(all); },
    async srem(setKey, member) { const all = await readAll(); const s = new Set(all[setKey] || []); s.delete(member); all[setKey] = Array.from(s); await writeAll(all); },
    async smembers(setKey) { const all = await readAll(); return all[setKey] || []; }
  };
}

function makeKvStore() {
  const base = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  const headers = { 'Authorization': `Bearer ${token}` };
  async function req(path) {
    const url = base.replace(/\/$/, '') + path;
    const res = await fetch(url, { headers });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || 'kv_error');
    return json;
  }
  return {
    kind: 'kv',
    async get(key) { const r = await req(`/get/${encodeURIComponent(key)}`); return r?.result ?? null; },
    async set(key, val) { const r = await req(`/set/${encodeURIComponent(key)}/${encodeURIComponent(typeof val === 'string' ? val : JSON.stringify(val))}`); return r; },
    async del(key) { return req(`/del/${encodeURIComponent(key)}`); },
    async sadd(setKey, member) { return req(`/sadd/${encodeURIComponent(setKey)}/${encodeURIComponent(member)}`); },
    async srem(setKey, member) { return req(`/srem/${encodeURIComponent(setKey)}/${encodeURIComponent(member)}`); },
    async smembers(setKey) { const r = await req(`/smembers/${encodeURIComponent(setKey)}`); return r?.result || []; }
  };
}

function createStore() {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    return makeKvStore();
  }
  if (process.env.STORAGE_FILE || process.env.NODE_ENV === 'development') {
    return makeFileStore();
  }
  return makeMemoryStore();
}

module.exports = { createStore };

