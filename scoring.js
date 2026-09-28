// Pick'em Room — the scoring engine. Locked 2026-09-28 with Ben.
// A "line" is stored in HOME terms: negative = home team favored (CLE -3 => -3 when CLE is home).
// Expected home margin = -line. The book's line is DraftKings' closing line, same convention.

export const RULES = [
  { key: 'nailed', name: 'Nailed it', pts: '+10', when: 'your line hits the final margin exactly' },
  { key: 'bull5', name: 'Bullseye', pts: '+5', when: 'within 3 points of the final margin' },
  { key: 'bull2', name: 'Close', pts: '+2', when: 'within 7 points of the final margin' },
  { key: 'num3', name: 'On the number', pts: '+3', when: 'within 1 point of the book’s closing line' },
  { key: 'num1', name: 'Near the number', pts: '+1', when: 'within 3 points of the closing line' },
  { key: 'beat5', name: 'Beat the book', pts: '+5', when: '3+ points off the closing line and closer to the final margin than the book' },
  { key: 'beat10', name: 'Beat the book big', pts: '+10', when: '7+ points off the closing line and closer than the book' },
  { key: 'lose2', name: 'Book wins', pts: '−2', when: '3+ points off the closing line and the book was closer' },
  { key: 'lose5', name: 'Book wins big', pts: '−5', when: '7+ points off the closing line and the book was closer' },
];

export const HOW_TO_PLAY = [
  'Each week, rank the 32 teams and set your own point spread (your "line") on every game before it kicks off.',
  'Set lines blind: no peeking at sportsbooks first. Your friends’ lines on a game unlock once you’ve set yours.',
  'When a game ends, your line is scored two ways: how close it was to the final margin, and how close it was to the book’s closing line.',
  'Disagree with the book by 3 or more points and you win big when you’re right (+5 or +10) and lose a little when you’re wrong (−2 or −5).',
  'Most points over the season wins. Tap any score to see exactly how it was calculated.',
];

/**
 * Score one line against a finished game.
 * @param {number|null} line   player's line, home terms
 * @param {number|null} close  book's closing line, home terms
 * @param {number} homeScore
 * @param {number} awayScore
 * @returns {null|{total:number, parts:Array<{key,name,pts,detail}>, eP:number, eV:number, d:number}}
 */
export function scoreLine(line, close, homeScore, awayScore) {
  if (line == null || close == null || homeScore == null || awayScore == null) return null;
  const M = -line, V = -close, A = homeScore - awayScore;
  const eP = Math.abs(M - A), eV = Math.abs(V - A), d = Math.abs(M - V);
  const parts = [];
  if (eP === 0) parts.push({ key: 'nailed', name: 'Nailed it', pts: 10, detail: 'your line hit the final margin exactly' });
  else if (eP <= 3) parts.push({ key: 'bull5', name: 'Bullseye', pts: 5, detail: `${fmt(eP)} off the final margin` });
  else if (eP <= 7) parts.push({ key: 'bull2', name: 'Close', pts: 2, detail: `${fmt(eP)} off the final margin` });
  if (d <= 1) parts.push({ key: 'num3', name: 'On the number', pts: 3, detail: `${fmt(d)} off the book’s close` });
  else if (d <= 3) parts.push({ key: 'num1', name: 'Near the number', pts: 1, detail: `${fmt(d)} off the book’s close` });
  if (d >= 3) {
    if (eP < eV) parts.push({ key: d >= 7 ? 'beat10' : 'beat5', name: d >= 7 ? 'Beat the book big' : 'Beat the book', pts: d >= 7 ? 10 : 5, detail: `${fmt(d)} off the close, and closer than the book (you ${fmt(eP)} off, book ${fmt(eV)} off)` });
    else if (eV < eP) parts.push({ key: d >= 7 ? 'lose5' : 'lose2', name: d >= 7 ? 'Book wins big' : 'Book wins', pts: d >= 7 ? -5 : -2, detail: `${fmt(d)} off the close, and the book was closer (book ${fmt(eV)} off, you ${fmt(eP)} off)` });
  }
  const total = parts.reduce((s, p) => s + p.pts, 0);
  return { total, parts, eP, eV, d };
}

/** What copying the book's closing line would have scored on the same game. */
export function bookSelfScore(close, homeScore, awayScore) {
  const s = scoreLine(close, close, homeScore, awayScore);
  return s ? s.total : null;
}

function fmt(x) { return (Math.round(x * 10) / 10).toString(); }
