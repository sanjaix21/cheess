// convert stockfish eval to centipawns

function normalizeCp(cp, isWhiteTurn) {
  return isWhiteTurn ? cp : -cp;
}

// classify a single move
function classifyMove(
  cpBefore, cpAfter, isWhiteTurn) {
  const before = normalizeCp(cpBefore, isWhiteTurn);
  const after = normalizeCp(cpAfter, isWhiteTurn);
  const loss = before - after;

  if (loss <= 0) return 'best';
  if (loss <= 20) return 'good';
  if (loss <= 50) return 'inaccuracy';
  if (loss <= 100) return 'mistake';
  return 'blunder';
}

// Calculate accuracy
function calculateAccuracy(moves) {
  const totalLoss = moves.reduce((sum, m) => {
    const before = normalizeCp(m.cpBefore, isWhiteTurn);
    const after = normalizeCp(m.cpAfter, isWhiteTurn);
    return sum + Math.max(0, before - after);
  }, 0);

  const avgLoss = totalLoss/moves.length;

  return Math.round(
    Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.4354 * avgLoss) - 3.1669))
  );
}




