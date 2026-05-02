// convert stockfish eval to centipawns

function normalizeCp(cp, isWhiteTurn) {
  return isWhiteTurn ? cp : -cp;
}

// classify a single move
function classifyMove(cpBefore, cpAfter, isWhiteTurn) {
    const loss = isWhiteTurn ? cpBefore - cpAfter : cpAfter - cpBefore;
    
    // Win-probability based thresholds (simplified for CP)
    if (loss <= 10) return 'best';      // Top engine move or near-equal
    if (loss <= 30) return 'excellent'; // Very small error
    if (loss <= 75) return 'good';      // Solid move
    if (loss <= 150) return 'inaccuracy'; 
    if (loss <= 300) return 'mistake';
    return 'blunder';                   // Major evaluation drop
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




