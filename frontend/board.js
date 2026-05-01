// ── STATE ─────────────────────────────────────────────────────────────
let board = null;
let game  = new Chess();
let moveHistory     = [];
let analysisResults = [];
let currentMoveIndex = -1;
let flipped = false;
let currentUsername = '';

// Live mode
let liveBoard     = null;
let liveGame      = new Chess();
let liveMoves     = [];
let liveBestMove  = null;
let liveThinking  = false;
let liveFlipped   = false;

// ── SCREEN / STEP NAV ────────────────────────────────────────────────
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach((b, i) => {
    b.classList.toggle('active', ['home','analyze','live'][i] === name);
  });
  document.getElementById('screen-' + name).classList.add('active');

  if (name === 'live') initLiveBoard();
}

function showStep(name) {
  document.querySelectorAll('#screen-analyze .step').forEach(s => s.classList.remove('active'));
  document.getElementById('step-' + name).classList.add('active');
}

// ── ANALYZE: LOAD GAMES ──────────────────────────────────────────────
async function loadGames() {
  const username = document.getElementById('username-input').value.trim();
  if (!username) return;
  currentUsername = username;

  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth() + 1;

  const errEl = document.getElementById('search-error');
  errEl.textContent = 'Loading…';

  try {
    let res  = await fetch(`http://localhost:8000/games/${username}/${year}/${month}`);
    let data = await res.json();
    let games = data.games || [];

    // fallback: last month
    if (games.length === 0) {
      const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      res  = await fetch(`http://localhost:8000/games/${username}/${lm.getFullYear()}/${lm.getMonth() + 1}`);
      data = await res.json();
      games = data.games || [];
    }

    if (games.length === 0) {
      errEl.textContent = 'No games found.';
      return;
    }
    errEl.textContent = '';
    renderGameList(games.reverse().slice(0, 20), username);
    showStep('games');
  } catch {
    errEl.textContent = 'Error — is the backend running?';
  }
}

function renderGameList(games, username) {
  document.getElementById('games-title').textContent = `Games for ${username}`;
  const container = document.getElementById('games-container');
  container.innerHTML = '';
  const lc = username.toLowerCase();

  games.forEach(g => {
    const isWhite = g.white.username.toLowerCase() === lc;
    const me  = isWhite ? g.white : g.black;
    const opp = isWhite ? g.black : g.white;
    const res = me.result === 'win' ? 'win' : me.result === 'lose' ? 'loss' : 'draw';
    const label = res === 'win' ? '1-0' : res === 'loss' ? '0-1' : '½-½';
    const date = new Date(g.end_time * 1000).toLocaleDateString();
    const tc   = formatTC(g.time_control);

    const card = document.createElement('div');
    card.className = 'game-card';
    card.innerHTML = `
      <div class="gc-left">
        <div class="gc-players">${me.username} <span class="gc-rating">${me.rating}</span> vs ${opp.username} <span class="gc-rating">${opp.rating}</span></div>
        <div class="gc-meta">${tc} · ${date}</div>
      </div>
      <div class="gc-result result-${res}">${label}</div>
    `;
    card.onclick = () => openGame(g, username);
    container.appendChild(card);
  });
}

function formatTC(tc) {
  if (!tc) return '?';
  const base = parseInt(tc.split('+')[0]);
  if (base >= 600) return '🐢 Classical';
  if (base >= 180) return '⏱ Rapid';
  if (base >= 60)  return '⚡ Blitz';
  return '🔥 Bullet';
}

// ── ANALYZE: OPEN GAME ───────────────────────────────────────────────
async function openGame(gameData, username) {
  const lc = username.toLowerCase();
  const isWhite = gameData.white.username.toLowerCase() === lc;

  game = new Chess();
  game.load_pgn(gameData.pgn);
  moveHistory      = game.history({ verbose: true });
  analysisResults  = [];
  currentMoveIndex = -1;

  // Init board (draggable for review)
  if (board) board.destroy();
  board = Chessboard('board', {
    draggable: true,
    position: 'start',
    pieceTheme: 'https://lichess1.org/assets/piece/cburnett/{piece}.svg',
    onDragStart: (src, piece) => false, // read-only during analysis nav
  });

  // Player bars
  const topColor = flipped ? 'white' : 'black';
  const botColor = flipped ? 'black' : 'white';
  document.getElementById('top-name').textContent   = gameData[topColor].username;
  document.getElementById('top-rating').textContent = gameData[topColor].rating;
  document.getElementById('bot-name').textContent   = gameData[botColor].username;
  document.getElementById('bot-rating').textContent = gameData[botColor].rating;
  document.getElementById('top-acc').textContent = '';
  document.getElementById('bot-acc').textContent = '';
  document.getElementById('accuracy-box').style.display = 'none';

  showStep('board');
  switchTab('info');
  goFirst();

  // Analyze
  const positions = buildPositions();
  document.getElementById('engine-line').textContent = 'Analyzing…';

  const evals = await analyzeGame(positions, (done, total) => {
    document.getElementById('engine-line').textContent = `Analyzing… ${done}/${total}`;
  });

  moveHistory.forEach((mv, i) => {
    const cpBefore = toCp(evals[i]);
    const cpAfter  = toCp(evals[i + 1]);
    const isWhiteTurn = mv.color === 'w';
    analysisResults[i] = {
      move:        mv,
      cpBefore,
      cpAfter,
      loss:        isWhiteTurn ? cpBefore - cpAfter : cpAfter - cpBefore,
      classification: classifyMove(cpBefore, cpAfter, isWhiteTurn),
      bestMove:    evals[i].bestMove,
      bestMoveSan: uciToSan(positions[i], evals[i].bestMove),
    };
  });

  renderMovesList();
  renderMistakesList();
  renderAccuracy(gameData, isWhite);
  goTo(moveHistory.length - 1);
}

// ── HELPERS ───────────────────────────────────────────────────────────
function buildPositions() {
  const g = new Chess();
  const out = [g.fen()];
  moveHistory.forEach(mv => { g.move(mv.san); out.push(g.fen()); });
  return out;
}

function toCp(e) {
  if (!e) return 0;
  if (e.mate !== null && e.mate !== undefined) return e.mate > 0 ? 3000 : -3000;
  return e.cp || 0;
}

function uciToSan(fen, uci) {
  if (!uci || uci === '(none)') return null;
  try {
    const g = new Chess(fen);
    const m = g.move({ from: uci.slice(0,2), to: uci.slice(2,4), promotion: uci[4] });
    return m ? m.san : null;
  } catch { return null; }
}

const MOVE_COLORS = {
  best:       '#97c27e',
  good:       '#b8d68a',
  inaccuracy: '#f4c542',
  mistake:    '#e8833a',
  blunder:    '#e05252',
};

// ── MOVES LIST ────────────────────────────────────────────────────────
function renderMovesList() {
  const container = document.getElementById('moves-list');
  container.innerHTML = '';

  for (let i = 0; i < moveHistory.length; i += 2) {
    const row = document.createElement('div');
    row.className = 'move-row';

    const num = document.createElement('span');
    num.className   = 'move-num';
    num.textContent = Math.floor(i / 2) + 1 + '.';
    row.appendChild(num);

    [i, i + 1].forEach(idx => {
      if (idx >= moveHistory.length) return;
      const res  = analysisResults[idx];
      const col  = res ? (MOVE_COLORS[res.classification] || '#ccc') : '#ccc';
      const cell = document.createElement('span');
      cell.className   = 'move-cell';
      cell.id          = `move-${idx}`;
      cell.textContent = moveHistory[idx].san;
      cell.style.color = col;
      cell.onclick = () => goTo(idx);
      row.appendChild(cell);
    });

    container.appendChild(row);
  }
}

function renderMistakesList() {
  const container = document.getElementById('mistakes-list');
  container.innerHTML = '';
  const bad = analysisResults.filter(r => ['inaccuracy','mistake','blunder'].includes(r.classification));

  if (bad.length === 0) {
    container.innerHTML = '<p class="sub" style="padding:12px">No major mistakes — great game!</p>';
    return;
  }

  bad.forEach(r => {
    const idx  = moveHistory.indexOf(r.move);
    const num  = Math.floor(idx / 2) + 1;
    const side = r.move.color === 'w' ? 'White' : 'Black';
    const col  = MOVE_COLORS[r.classification];

    const card = document.createElement('div');
    card.className = 'mistake-card';
    card.innerHTML = `
      <div class="mc-header">
        <span style="color:${col};font-weight:700">${r.classification.toUpperCase()}</span>
        <span class="sub">${side}, move ${num}</span>
      </div>
      <div class="mc-body">
        <span>Played: <b>${r.move.san}</b></span>
        <span>Best: <b style="color:#97c27e">${r.bestMoveSan || '—'}</b></span>
        <span class="sub">−${Math.max(0, Math.round(r.loss))} cp</span>
      </div>
    `;
    card.onclick = () => goTo(idx);
    container.appendChild(card);
  });
}

function renderAccuracy(gameData, isWhite) {
  const whiteMoves = analysisResults.filter(r => r.move.color === 'w');
  const blackMoves = analysisResults.filter(r => r.move.color === 'b');
  const wa = calcAccuracy(whiteMoves);
  const ba = calcAccuracy(blackMoves);

  document.getElementById('acc-white-name').textContent = gameData.white.username;
  document.getElementById('acc-black-name').textContent = gameData.black.username;
  document.getElementById('acc-white-val').textContent  = wa + '%';
  document.getElementById('acc-black-val').textContent  = ba + '%';
  document.getElementById('acc-bar-white').style.width  = wa + '%';
  document.getElementById('acc-bar-black').style.width  = ba + '%';
  document.getElementById('acc-bar-white').style.background = accColor(wa);
  document.getElementById('acc-bar-black').style.background = accColor(ba);

  const topColor = flipped ? 'white' : 'black';
  const botColor = flipped ? 'black' : 'white';
  document.getElementById('top-acc').textContent = (topColor === 'white' ? wa : ba) + '%';
  document.getElementById('bot-acc').textContent = (botColor === 'white' ? wa : ba) + '%';
  document.getElementById('accuracy-box').style.display = 'block';
}

function accColor(acc) {
  if (acc >= 90) return '#97c27e';
  if (acc >= 75) return '#b8d68a';
  if (acc >= 60) return '#f4c542';
  if (acc >= 40) return '#e8833a';
  return '#e05252';
}

// ── NAVIGATION ────────────────────────────────────────────────────────
function goFirst() { goTo(-1); }
function goLast()  { goTo(moveHistory.length - 1); }
function goPrev()  { if (currentMoveIndex > -1) goTo(currentMoveIndex - 1); }
function goNext()  { if (currentMoveIndex < moveHistory.length - 1) goTo(currentMoveIndex + 1); }

function goTo(idx) {
  currentMoveIndex = idx;

  const g = new Chess();
  for (let i = 0; i <= idx; i++) g.move(moveHistory[i].san);
  board.position(g.fen(), false);

  // Clear highlights
  $('.square-55d63').removeClass('sq-from sq-to sq-blunder sq-mistake sq-inaccuracy sq-best sq-good sq-best-move');

  if (idx >= 0) {
    const mv  = moveHistory[idx];
    const res = analysisResults[idx];

    if (res) {
      const cls = res.classification;
      $(`.square-${mv.from}, .square-${mv.to}`).addClass(`sq-${cls}`);

      // Highlight best move in green if player didn't play it
      if (res.bestMoveSan && res.bestMove && cls !== 'best' && cls !== 'good') {
        const bm = res.bestMove;
        const bmFrom = bm.slice(0, 2);
        const bmTo   = bm.slice(2, 4);
        $(`.square-${bmFrom}, .square-${bmTo}`).addClass('sq-best-move');
      }
    }
  }

  // Active move cell
  document.querySelectorAll('.move-cell').forEach(el => el.classList.remove('move-active'));
  if (idx >= 0) {
    const cell = document.getElementById(`move-${idx}`);
    if (cell) { cell.classList.add('move-active'); cell.scrollIntoView({ block: 'nearest' }); }
  }

  updateEvalBar(idx);
  updateEngineLine(idx);
}

function flipBoard() {
  flipped = !flipped;
  board.flip();
}

// ── EVAL BAR ──────────────────────────────────────────────────────────
function updateEvalBar(idx) {
  let cp = 0;
  if (idx >= 0 && analysisResults[idx]) cp = analysisResults[idx].cpAfter;
  setEvalBar('eval-fill', 'eval-label-top', 'eval-label-bot', cp);
}

function setEvalBar(fillId, topId, botId, cp) {
  const pct  = Math.max(5, Math.min(95, 50 + 50 * (1 - 2 / (1 + Math.exp(-cp / 400)))));
  document.getElementById(fillId).style.height = (100 - pct) + '%';
  const abs = Math.abs(cp / 100).toFixed(1);
  if (cp > 0) {
    document.getElementById(topId).textContent = '+' + abs;
    document.getElementById(botId).textContent = '';
  } else if (cp < 0) {
    document.getElementById(topId).textContent = '';
    document.getElementById(botId).textContent = abs;
  } else {
    document.getElementById(topId).textContent = '0.0';
    document.getElementById(botId).textContent = '';
  }
}

// ── ENGINE LINE ───────────────────────────────────────────────────────
function updateEngineLine(idx) {
  const el = document.getElementById('engine-line');
  if (idx < 0 || !analysisResults[idx]) { el.textContent = ''; return; }
  const r   = analysisResults[idx];
  const col = MOVE_COLORS[r.classification] || '#ccc';
  const cp  = (r.cpAfter / 100).toFixed(2);
  const ev  = r.cpAfter >= 0 ? '+' + cp : cp;
  el.innerHTML = `<span style="color:${col};font-weight:700">${r.classification.toUpperCase()}</span> · ${ev} · Best: <b style="color:#97c27e">${r.bestMoveSan || '—'}</b>`;
}

// ── TAB SWITCHING ─────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.ptab').forEach((t, i) => {
    t.classList.toggle('active', ['info','moves','mistakes'][i] === name);
  });
  document.getElementById('tab-info').style.display      = name === 'info'      ? 'block' : 'none';
  document.getElementById('tab-moves').style.display     = name === 'moves'     ? 'block' : 'none';
  document.getElementById('tab-mistakes').style.display  = name === 'mistakes'  ? 'block' : 'none';
}

// ── KEYBOARD ──────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  const active = document.querySelector('.screen.active');
  if (!active || active.id !== 'screen-analyze') return;
  if (document.activeElement.tagName === 'INPUT') return;
  if (e.key === 'ArrowLeft')  goPrev();
  if (e.key === 'ArrowRight') goNext();
  if (e.key === 'ArrowUp')    goFirst();
  if (e.key === 'ArrowDown')  goLast();
});

document.getElementById('username-input')
  .addEventListener('keydown', e => { if (e.key === 'Enter') loadGames(); });

// ── LIVE MODE ─────────────────────────────────────────────────────────
function initLiveBoard() {
  if (liveBoard) return;

  liveBoard = Chessboard('live-board', {
    draggable: true,
    position: 'start',
    pieceTheme: 'https://lichess1.org/assets/piece/cburnett/{piece}.svg',
    onDragStart: onLiveDragStart,
    onDrop: onLiveDrop,
    onSnapEnd: onLiveSnapEnd,
  });

  // Click-to-move
  let selectedSquare = null;

  $('#live-board').on('click', '.square-55d63', function() {
    const square = $(this).attr('data-square');
    const piece  = liveGame.get(square);

    // Nothing selected yet
    if (!selectedSquare) {
      if (!piece) return;
      // Must be current turn's piece
      if (piece.color !== liveGame.turn()) return;
      selectedSquare = square;
      $(this).css('border', '3px solid #6c63ff');
      return;
    }

    // Same square clicked — deselect
    if (selectedSquare === square) {
      selectedSquare = null;
      $('.square-55d63').css('border', '');
      return;
    }

    // Try the move
    const move = liveGame.move({
      from: selectedSquare,
      to: square,
      promotion: 'q'
    });

    $('.square-55d63').css('border', '');
    selectedSquare = null;

    if (!move) {
      // Maybe clicked another own piece — select that instead
      if (piece && piece.color === liveGame.turn()) {
        selectedSquare = square;
        $(this).css('border', '3px solid #6c63ff');
      }
      return;
    }

    liveBoard.position(liveGame.fen());
    handleLiveMove(move);
  });

  requestLiveBest();
}

function onLiveDragStart(source, piece) {
  if (liveGame.game_over()) return false;
  const turn = liveGame.turn();
  if ((turn === 'w' && piece.startsWith('b')) ||
      (turn === 'b' && piece.startsWith('w'))) return false;
  return true;
}

function onLiveDrop(source, target) {
  const move = liveGame.move({ from: source, to: target, promotion: 'q' });
  if (!move) return 'snapback';
  handleLiveMove(move);
}

function onLiveSnapEnd() {
  liveBoard.position(liveGame.fen());
}

function resetLive() {
  liveGame     = new Chess();
  liveMoves    = [];
  liveBestMove = null;
  liveThinking = false;
  if (liveBoard) liveBoard.position('start');
  document.getElementById('live-moves-list').innerHTML = '';
  document.getElementById('live-best').textContent = 'Waiting for engine…';
  document.getElementById('live-move-input').value = '';
  setEvalBar('live-eval-fill', 'live-eval-top', 'live-eval-bot', 0);
  requestLiveBest();
}

function flipLiveBoard() {
  liveFlipped = !liveFlipped;
  if (liveBoard) liveBoard.flip();
  document.getElementById('live-top-label').textContent = liveFlipped ? 'White' : 'Black';
  document.getElementById('live-bot-label').textContent = liveFlipped ? 'Black' : 'White';
}

function requestLiveBest() {
  if (liveThinking || liveGame.game_over()) return;
  liveThinking = true;
  document.getElementById('live-best').textContent = 'Engine thinking…';

  analyzePosition(liveGame.fen(), 16, (bestMove, info) => {
    liveThinking = false;
    liveBestMove = bestMove;
    const san = uciToSan(liveGame.fen(), bestMove);
    const turn = liveGame.turn() === 'w' ? 'White' : 'Black';
    const cp   = info && info.cp !== null ? info.cp : null;
    const ev   = cp !== null ? (cp >= 0 ? '+' : '') + (cp / 100).toFixed(2) : '';

    document.getElementById('live-best').innerHTML =
      `<span class="live-turn">${turn} to move</span>` +
      `<span class="live-suggestion">Best: <b>${san || bestMove}</b></span>` +
      (ev ? `<span class="live-eval">${ev}</span>` : '');

    // Highlight best move squares
    $('.square-55d63').removeClass('sq-best-move');
    if (bestMove && bestMove !== '(none)') {
      $(`.square-${bestMove.slice(0,2)}, .square-${bestMove.slice(2,4)}`).addClass('sq-best-move');
    }

    if (cp !== null) setEvalBar('live-eval-fill', 'live-eval-top', 'live-eval-bot', cp);
    document.getElementById('live-move-input').focus();
  });
}

// Called from both drag-drop and text input

function handleLiveMove(move) {
  const bestSan = uciToSan(liveGame.fen(), liveBestMove);

  // Wait — move already made in liveGame if from drag, otherwise make it here
  const matched = move.san === bestSan;

  liveMoves.push({ turn: move.color === 'w' ? 'W' : 'B', best: bestSan || '?', actual: move.san, matched });
  liveBoard.position(liveGame.fen());
  renderLiveMoves();

  if (liveGame.game_over()) {
    document.getElementById('live-best').textContent = 'Game over!';
    return;
  }
  requestLiveBest();
}

function submitLiveMove() {
  const input  = document.getElementById('live-move-input');
  const rawVal = input.value.trim();
  const bestSan = uciToSan(liveGame.fen(), liveBestMove);

  const san = rawVal === '' ? bestSan : rawVal;
  if (!san) return;

  const move = liveGame.move(san, { sloppy: true });
  if (!move) {
    input.style.borderColor = '#e05252';
    setTimeout(() => input.style.borderColor = '', 800);
    return;
  }

  input.value = '';
  input.style.borderColor = '';
  handleLiveMove(move);
}

function undoLiveMove() {
  if (liveMoves.length === 0) return;

  liveGame.undo();
  liveMoves.pop();
  liveBoard.position(liveGame.fen());
  renderLiveMoves();

  // Force reset thinking state before requesting
  liveBestMove = null;
  liveThinking = false;  // ← this is the key fix
  sfQueue = [];           // ← clear any pending engine requests

  $('.square-55d63').removeClass('sq-best-move');
  document.getElementById('live-best').textContent = 'Engine thinking…';
  requestLiveBest();
}
function renderLiveMoves() {
  const container = document.getElementById('live-moves-list');
  container.innerHTML = '';

  for (let i = 0; i < liveMoves.length; i += 2) {
    const row = document.createElement('div');
    row.className = 'live-move-row';

    const num = document.createElement('span');
    num.className   = 'move-num';
    num.textContent = Math.floor(i / 2) + 1 + '.';
    row.appendChild(num);

    [i, i+1].forEach(idx => {
      if (idx >= liveMoves.length) return;
      const m = liveMoves[idx];
      const cell = document.createElement('div');
      cell.className = 'live-move-cell';
      cell.innerHTML = `
        <span class="lmc-best">${m.best}</span>
        <span class="lmc-actual" style="color:${m.matched ? '#97c27e' : '#e05252'}">${m.actual}</span>
        <span class="lmc-icon">${m.matched ? '✓' : '✗'}</span>
      `;
      row.appendChild(cell);
    });

    container.appendChild(row);
  }
  container.scrollTop = container.scrollHeight;
}

document.getElementById('live-move-input')
  .addEventListener('keydown', e => { if (e.key === 'Enter') submitLiveMove(); });
