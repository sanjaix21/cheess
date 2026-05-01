const ws = new WebSocket("ws://localhost:8000/engine");

let sfReady = false;
let sfQueue = [];       // pending analysis tasks
let sfCallback = null;  // function waiting for current result

// ── Connection ────────────────────────────────────────────────────────
ws.onopen = () => {
  ws.send("uci");
};

ws.onmessage = (e) => {
  const msg = e.data;

  // Stockfish confirmed UCI mode
  if (msg === "uciok") {
    ws.send("isready");
    return;
  }

  // Stockfish is ready to analyze
  if (msg === "readyok") {
    sfReady = true;
    console.log("Stockfish ready");
    processQueue();
    return;
  }

  // Collect eval info lines
  if (sfCallback && msg.startsWith("info depth")) {
    const depthMatch = msg.match(/depth (\d+)/);
    const cpMatch    = msg.match(/ cp (-?\d+)/);
    const mateMatch  = msg.match(/score mate (-?\d+)/);
    const pvMatch    = msg.match(/ pv (.+)/);

    // Only save info at depth 15+ (good enough, not too slow)
    if (depthMatch && parseInt(depthMatch[1]) >= 15) {
      sfCallback.lastInfo = {
        cp:   cpMatch   ? parseInt(cpMatch[1])   : null,
        mate: mateMatch ? parseInt(mateMatch[1]) : null,
        pv:   pvMatch   ? pvMatch[1].trim().split(" ") : []
      };
    }
  }

  // Stockfish finished — fire the callback
  if (sfCallback && msg.startsWith("bestmove")) {
    const bestMove = msg.split(" ")[1];
    sfCallback(bestMove, sfCallback.lastInfo);
    sfCallback = null;
    processQueue(); // start next task if any
  }
};

ws.onerror = () => console.error("WebSocket error — is the backend running?");
ws.onclose = () => console.warn("WebSocket closed");

// ── Queue ─────────────────────────────────────────────────────────────
function processQueue() {
  if (!sfReady || sfCallback || sfQueue.length === 0) return;

  const task = sfQueue.shift();
  sfCallback = task.cb;
  sfCallback.lastInfo = null;

  ws.send("position fen " + task.fen);
  ws.send("go depth " + task.depth);
}

// ── Public API ────────────────────────────────────────────────────────

// Call this to analyze a position
// cb(bestMove, info) fires when done
function analyzePosition(fen, depth, cb) {
  sfQueue.push({ fen, depth: depth || 15, cb });
  processQueue();
}

// Analyze every position in a game and return all evals
// positions = array of FEN strings (before each move + final)
// onProgress(done, total) optional
function analyzeGame(positions, onProgress) {
  return new Promise((resolve) => {
    const evals = new Array(positions.length);
    let completed = 0;

    positions.forEach((fen, idx) => {
      analyzePosition(fen, 15, (bestMove, info) => {
        evals[idx] = {
          bestMove,
          cp:   info ? info.cp   : null,
          mate: info ? info.mate : null,
          pv:   info ? info.pv   : []
        };

        completed++;
        if (onProgress) onProgress(completed, positions.length);
        if (completed === positions.length) resolve(evals);
      });
    });
  });
}
