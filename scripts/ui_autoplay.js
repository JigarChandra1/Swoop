#!/usr/bin/env node
/*
  UI Autoplay for Swoop
  - Opens http://localhost:5173/Swoop/main.html
  - Clicks real buttons/cells (no internal game code)
  - Uses simple human-like heuristics to pick actions
  - Logs each action and a lightweight snapshot to saved_games
*/

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const URL = process.env.SWOOP_URL || 'http://localhost:5173/Swoop/main.html';
const PORT = Number(process.env.SWOOP_PORT || 5173);

async function waitForOk(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
          res.resume();
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) resolve();
          else reject(new Error('Bad status ' + res.statusCode));
        });
        req.on('error', reject);
        req.setTimeout(2000, () => {
          req.destroy(new Error('timeout'));
          reject(new Error('timeout'));
        });
      });
      return true;
    } catch (_) {
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  return false;
}

async function ensureDevServer() {
  const ok = await waitForOk(URL, 3000);
  if (ok) return;
  // start vite dev server on fixed port
  spawn(process.platform === 'darwin' ? 'bash' : 'bash', [
    '-lc',
    `lsof -ti tcp:${PORT} | xargs -r kill -9 || true; nohup npm run dev -- --port ${PORT} >/tmp/swoop_vite.log 2>&1 &`
  ], { stdio: 'ignore', detached: true });
  const up = await waitForOk(URL, 20000);
  if (!up) throw new Error('Vite server not reachable; check /tmp/swoop_vite.log');
}

function nowIso() { return new Date().toISOString(); }

function summarizePlayers(state) {
  return state.players.map((p) => ({
    name: p.name,
    score: p.score,
    swoopTokens: p.swoopTokens || 0,
    pieces: p.pieces.map((x) => ({ r: x.r, step: x.step, carrying: !!x.carrying, active: !!x.active }))
  }));
}

async function main() {
  await ensureDevServer();

  // Ensure Playwright Chromium is installed (best-effort)
  // If already installed, this is fast; if not, will download once.
  // Skipped here to keep runtime lean; assume environment is prepared.

  const headless = process.env.HEADLESS === '0' ? false : true;
  const slowMoOpt = Number(process.env.SLOW_MO || process.env.SLOWMO || '0');
  const browser = await chromium.launch({ headless, slowMo: slowMoOpt > 0 ? slowMoOpt : undefined });
  const context = await browser.newContext();
  const page = await context.newPage();

  const log = [];
  function push(action) { log.push({ ts: nowIso(), ...action }); }

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#status');

  // Always start fresh
  await page.click('#newBtn');
  await page.waitForTimeout(200);

  let turnIndex = 1;
  let actionsThisTurn = 0;

  function statusText() { return page.locator('#status').textContent(); }

  async function getState() {
    // Access global lexical bindings present in main.html
    return page.evaluate(() => ({
      mode, current, players: JSON.parse(JSON.stringify(players)),
      rolled: rolled ? { d: [...rolled.d], pairs: [...rolled.pairs] } : null,
      selectedPair: selectedPair ? { ...selectedPair } : null,
      lanes: lanes.map(l => ({ sum: l.sum, L: l.L, basket: l.basket }))
    }));
  }

  const TURN_PAUSE = Number(process.env.TURN_PAUSE_MS || '1000');

  async function chooseBankIfGood(state) {
    const pl = state.players[state.current];
    const ready = pl.pieces.some(p => p.carrying && p.step === 1);
    if (ready) {
      push({ type: 'bank', reason: 'ready_to_deliver', player: pl.name, turn: turnIndex });
      await page.click('#bankBtn');
      actionsThisTurn = 0;
      turnIndex += 1;
      await page.waitForTimeout(TURN_PAUSE);
      return true;
    }
    if (actionsThisTurn >= 4) {
      push({ type: 'bank', reason: 'safety_after_4_actions', player: pl.name, turn: turnIndex });
      await page.click('#bankBtn');
      actionsThisTurn = 0;
      turnIndex += 1;
      await page.waitForTimeout(TURN_PAUSE);
      return true;
    }
    return false;
  }


  async function pickPairAndMove(state) {
    const pl = state.players[state.current];
    const pairs = state.rolled?.pairs || [];
    if (!pairs.length) return 'no_pairs';

    // Order: if no one is carrying, prefer even high sums; otherwise prefer odd high
    const someoneCarrying = pl.pieces.some(p => p.carrying);
    const ordered = [...pairs].map((p, idx) => ({ ...p, idx }))
      .sort((a, b) => {
        const wa = someoneCarrying ? (a.sum % 2 ? 2 : 1) : (a.sum % 2 ? 1 : 2);
        const wb = someoneCarrying ? (b.sum % 2 ? 2 : 1) : (b.sum % 2 ? 1 : 2);
        if (wa !== wb) return wb - wa;
        return b.sum - a.sum;
      });

    for (const cand of ordered) {
      const pairEl = page.locator(`#pairRow .pair`).nth(cand.idx);
      await pairEl.click();
      await page.waitForTimeout(50);
      const canMove = await page.evaluate(() => !document.getElementById('useMoveBtn').disabled);
      if (canMove) {
        push({ type: 'select_pair', sum: cand.sum, pairIndex: cand.idx, player: pl.name, turn: turnIndex });
        await page.click('#useMoveBtn');
        await page.waitForTimeout(50);

        // Now resolve any chooser UIs
        for (let k = 0; k < 40; k++) {
          const modeVal = await page.evaluate(() => mode);
          if (modeVal === 'preroll') break; // move auto-applied
          if (modeVal === 'choosePiece') {
            // choose a highlighted piece: prefer carrying, else highest step
            const state2 = await getState();
            const pl2 = state2.players[state2.current];
            // Map highlights to pieces
            const highlights = await page.$$eval('.cell.highlight', els => els.map(e => ({ r: +e.dataset.r, step: +e.dataset.step })));
            const scored = highlights.map(h => {
              const pc = pl2.pieces.find(p => p.r === h.r && p.step === h.step) || { step: h.step, carrying: false };
              return { ...h, carrying: !!pc.carrying, score: (pc.carrying ? 1000 : 0) + pc.step };
            }).sort((a, b) => b.score - a.score);
            const pick = scored[0];
            push({ type: 'choose_piece', r: pick.r, step: pick.step });
            await page.locator(`.cell.highlight[data-r="${pick.r}"][data-step="${pick.step}"]`).click();
          } else if (modeVal === 'chooseMoveDest') {
            // choose among destination highlights: prefer down if carrying else up/sideways to highest step
            const state3 = await getState();
            const sumLane = state3.lanes.findIndex(l => l.sum === state.selectedPair?.sum || cand.sum);
            // Identify the active piece on the lane
            const pl3 = state3.players[state3.current];
            const pc = pl3.pieces.find(p => p.r === sumLane && p.active);
            const carrying = pc ? pc.carrying : false;
            const targets = await page.$$eval('.cell.highlight', els => els.map(e => ({ r: +e.dataset.r, step: +e.dataset.step })));
            let pick;
            if (carrying) {
              // go closer to home: minimal step
              pick = targets.slice().sort((a, b) => a.step - b.step)[0];
            } else {
              // farther from home: maximal step; if multiple lanes, prefer even lane (basket)
              const withPref = targets.map(t => ({
                ...t,
                pref: (state3.lanes[t.r].basket ? 100 : 0) + t.step
              }));
              pick = withPref.sort((a, b) => b.pref - a.pref)[0];
            }
            push({ type: 'choose_move_dest', r: pick.r, step: pick.step, carrying });
            await page.locator(`.cell.highlight[data-r="${pick.r}"][data-step="${pick.step}"]`).click();
          } else {
            // no explicit choice; break soon
            await page.waitForTimeout(20);
          }
        }

        actionsThisTurn += 1;
        return 'moved';
      }
    }
    return 'no_move_pair';
  }

  async function trySwoopIfAvailable(state) {
    const canSwoop = await page.evaluate(() => !document.getElementById('useSwoopBtn').disabled);
    if (!canSwoop) return false;
    push({ type: 'use_swoop_token_start', player: state.players[state.current].name, turn: turnIndex });
    await page.click('#useSwoopBtn');
    await page.waitForTimeout(50);

    // click a highlighted active piece: prefer carrying
    const highlights = await page.$$eval('.cell.highlight', els => els.map(e => ({ r: +e.dataset.r, step: +e.dataset.step })));
    const st = await getState();
    const pl = st.players[st.current];
    const scored = highlights.map(h => {
      const pc = pl.pieces.find(p => p.r === h.r && p.step === h.step) || { carrying: false, step: h.step };
      return { ...h, carrying: !!pc.carrying, score: (pc.carrying ? 1000 : 0) + pc.step };
    }).sort((a, b) => b.score - a.score);
    const piecePick = scored[0];
    await page.locator(`.cell.highlight[data-r="${piecePick.r}"][data-step="${piecePick.step}"]`).click();
    await page.waitForTimeout(50);

    // choose destination: prefer basket lane
    const dests = await page.$$eval('.cell.highlight', els => els.map(e => ({ r: +e.dataset.r, step: +e.dataset.step })));
    const st2 = await getState();
    const destPick = dests.map(d => ({ ...d, pref: (st2.lanes[d.r].basket ? 100 : 0) + d.step }))
      .sort((a, b) => b.pref - a.pref)[0];
    await page.locator(`.cell.highlight[data-r="${destPick.r}"][data-step="${destPick.step}"]`).click();
    actionsThisTurn += 1;
    push({ type: 'use_swoop_token_finish', piece: piecePick, dest: destPick });
    return true;
  }

  async function bustedEndTurnIfNoAction() {
    const label = (await statusText()) || '';
    if (/Busted/.test(label)) {
      await page.click('#bankBtn');
      push({ type: 'bust' });
      actionsThisTurn = 0;
      turnIndex += 1;
      await page.waitForTimeout(TURN_PAUSE);
      return true;
    }
    return false;
  }

  // Main loop
  for (let guard = 0; guard < 2000; guard++) {
    const state = await getState();
    const s = (await statusText()) || '';
    if (/wins with/.test(s)) break; // game over

    if (state.mode === 'preroll') {
      if (await chooseBankIfGood(state)) continue;
      await page.click('#rollBtn');
      push({ type: 'roll', turn: turnIndex });
      await page.waitForTimeout(50);
      continue;
    }

    if (state.mode === 'rolled' || state.mode === 'pairChosen') {
      const state2 = await getState();
      const res = await pickPairAndMove(state2);
      if (res === 'moved') {
        // maybe bank after move
        const state3 = await getState();
        await chooseBankIfGood(state3);
        continue;
      }
      if (res === 'no_move_pair') {
        const state4 = await getState();
        const swooped = await trySwoopIfAvailable(state4);
        if (swooped) {
          const state5 = await getState();
          await chooseBankIfGood(state5);
          continue;
        }
        await bustedEndTurnIfNoAction();
        continue;
      }
    }

    // handle any chooser modes opportunistically
    await page.waitForTimeout(20);
  }

  // Save log
  const out = {
    metadata: {
      generated_at: nowIso(),
      url: URL
    },
    actions: log
  };

  const outDir = path.join(process.cwd(), 'saved_games');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const ts = nowIso().replace(/[:.]/g, '-');
  const file = path.join(outDir, `swoop_ui_autoplay_${ts}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(file);

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
