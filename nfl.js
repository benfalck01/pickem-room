// Pick'em Room — NFL data from ESPN's public feeds (schedule, scores, current week, DraftKings closing lines).
// Runs in the browser (hosted outside the artifact sandbox, so cross-origin fetch works; ESPN sends CORS *).
// Per-viewer cache in localStorage is only a speed-up; game state lives in the shared database.

const SB = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
const CORE = 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events';
const CACHE = 'pickem.nfl.cache.v1';

export const TEAMS = [
  ['BUF','Buffalo Bills','Bills','AFC','East','#00338d'],['MIA','Miami Dolphins','Dolphins','AFC','East','#008e97'],['NE','New England Patriots','Patriots','AFC','East','#002244'],['NYJ','New York Jets','Jets','AFC','East','#125740'],
  ['BAL','Baltimore Ravens','Ravens','AFC','North','#241773'],['CIN','Cincinnati Bengals','Bengals','AFC','North','#fb4f14'],['CLE','Cleveland Browns','Browns','AFC','North','#ff3c00'],['PIT','Pittsburgh Steelers','Steelers','AFC','North','#ffb612'],
  ['HOU','Houston Texans','Texans','AFC','South','#03202f'],['IND','Indianapolis Colts','Colts','AFC','South','#002c5f'],['JAX','Jacksonville Jaguars','Jaguars','AFC','South','#006778'],['TEN','Tennessee Titans','Titans','AFC','South','#4b92db'],
  ['DEN','Denver Broncos','Broncos','AFC','West','#fb4f14'],['KC','Kansas City Chiefs','Chiefs','AFC','West','#e31837'],['LV','Las Vegas Raiders','Raiders','AFC','West','#a5acaf'],['LAC','Los Angeles Chargers','Chargers','AFC','West','#0080c6'],
  ['DAL','Dallas Cowboys','Cowboys','NFC','East','#041e42'],['NYG','New York Giants','Giants','NFC','East','#0b2265'],['PHI','Philadelphia Eagles','Eagles','NFC','East','#004c54'],['WSH','Washington Commanders','Commanders','NFC','East','#5a1414'],
  ['CHI','Chicago Bears','Bears','NFC','North','#c83803'],['DET','Detroit Lions','Lions','NFC','North','#0076b6'],['GB','Green Bay Packers','Packers','NFC','North','#203731'],['MIN','Minnesota Vikings','Vikings','NFC','North','#4f2683'],
  ['ATL','Atlanta Falcons','Falcons','NFC','South','#a71930'],['CAR','Carolina Panthers','Panthers','NFC','South','#0085ca'],['NO','New Orleans Saints','Saints','NFC','South','#d3bc8d'],['TB','Tampa Bay Buccaneers','Buccaneers','NFC','South','#d50a0a'],
  ['ARI','Arizona Cardinals','Cardinals','NFC','West','#97233f'],['LAR','Los Angeles Rams','Rams','NFC','West','#ffd100'],['SF','San Francisco 49ers','49ers','NFC','West','#aa0000'],['SEA','Seattle Seahawks','Seahawks','NFC','West','#69be28'],
].map(([abbr, name, short, conf, div, color]) => ({ abbr, name, short, conf, div: `${conf} ${div}`, divShort: `${conf} ${div[0]}`, color }));
export const T = Object.fromEntries(TEAMS.map(t => [t.abbr, t]));
export const ALL = TEAMS.map(t => t.abbr);
export const DIVS = ['AFC East', 'AFC North', 'AFC South', 'AFC West', 'NFC East', 'NFC North', 'NFC South', 'NFC West'];

// Week keys: "1".."18" regular season; "p1" Wild Card, "p2" Divisional, "p3" Conference, "p5" Super Bowl (ESPN postseason week 4 is the Pro Bowl).
export const WEEK_KEYS = [...Array.from({ length: 18 }, (_, i) => String(i + 1)), 'p1', 'p2', 'p3', 'p5'];
export const weekLabel = k => k === 'p1' ? 'Wild Card' : k === 'p2' ? 'Divisional round' : k === 'p3' ? 'Conference championships' : k === 'p5' ? 'Super Bowl' : `Week ${k}`;
export const weekShort = k => k === 'p1' ? 'WC' : k === 'p2' ? 'DIV' : k === 'p3' ? 'CONF' : k === 'p5' ? 'SB' : `Wk ${k}`;
const weekParams = k => k.startsWith('p') ? { seasontype: 3, week: Number(k.slice(1)) } : { seasontype: 2, week: Number(k) };
export const nextWeekKey = k => { const i = WEEK_KEYS.indexOf(k); return i >= 0 && i < WEEK_KEYS.length - 1 ? WEEK_KEYS[i + 1] : null; };
export const prevWeekKey = k => { const i = WEEK_KEYS.indexOf(k); return i > 0 ? WEEK_KEYS[i - 1] : null; };

function readCache() { try { return JSON.parse(localStorage.getItem(CACHE)) || {}; } catch (e) { return {}; } }
function writeCache(c) { try { localStorage.setItem(CACHE, JSON.stringify(c)); } catch (e) { /* ignore */ } }

async function getJSON(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${r.status} for ${url}`);
  return r.json();
}

function parseEvent(ev, wk) {
  const c = ev.competitions[0];
  const h = c.competitors.find(x => x.homeAway === 'home'), a = c.competitors.find(x => x.homeAway === 'away');
  const st = (c.status && c.status.type) || {};
  return {
    id: String(ev.id), wk, date: c.date || ev.date, away: a.team.abbreviation, home: h.team.abbreviation,
    neutral: !!c.neutralSite, venue: c.venue ? c.venue.fullName : null, tv: (c.broadcasts || []).flatMap(b => b.names || []).join('/') || null,
    state: st.state || 'pre', detail: st.shortDetail || null,
    homeScore: h.score != null && st.state !== 'pre' ? Number(h.score) : null, awayScore: a.score != null && st.state !== 'pre' ? Number(a.score) : null,
  };
}

/** ESPN's idea of "now": {seasonType: 2|3, week: number, year}. */
export async function fetchCurrent() {
  const j = await getJSON(SB);
  const type = j.season && j.season.type, week = j.week && j.week.number;
  const key = type === 3 ? 'p' + week : String(week);
  return { key: WEEK_KEYS.includes(key) ? key : '1', year: j.season && j.season.year, events: (j.events || []).map(ev => parseEvent(ev, key)) };
}

/** Games for one week key. Cached: finished weeks stay cached; live/upcoming weeks refresh after `ttlMs`. */
export async function fetchWeek(year, key, ttlMs = 5 * 60e3) {
  const cache = readCache(); const hit = cache['w' + key];
  const now = Date.now();
  if (hit && (hit.final || now - hit.at < ttlMs)) return hit.games;
  const { seasontype, week } = weekParams(key);
  const j = await getJSON(`${SB}?dates=${year}&seasontype=${seasontype}&week=${week}`);
  const games = (j.events || []).map(ev => parseEvent(ev, key)).sort((x, y) => x.date.localeCompare(y.date));
  const final = games.length > 0 && games.every(g => g.state === 'post');
  cache['w' + key] = { at: now, final, games }; writeCache(cache);
  return games;
}

/** DraftKings open / current / closing spread for a game, HOME terms. `close` exists once the game has started. */
export async function fetchBook(gameId) {
  const j = await getJSON(`${CORE}/${gameId}/competitions/${gameId}/odds`);
  const items = j.items || [];
  const it = items.find(x => /draft\s*kings/i.test((x.provider && x.provider.name) || '')) || items[0];
  if (!it) return null;
  const ps = o => { const v = o && o.pointSpread && (o.pointSpread.american != null ? o.pointSpread.american : o.pointSpread.alternateDisplayValue); if (v == null) return null; const s = String(v).toUpperCase(); if (/EVEN|PK|PICK/.test(s)) return 0; const n = parseFloat(s); return isNaN(n) ? null : n; };
  const h = it.homeTeamOdds || {};
  let current = ps(h.current); if (current == null && typeof it.spread === 'number') current = it.spread;
  return { open: ps(h.open), current, close: ps(h.close), provider: (it.provider && it.provider.name) || null };
}

export function clearCache() { try { localStorage.removeItem(CACHE); } catch (e) { /* ignore */ } }

/** W-L-T and point differential from every finished game we know about. */
export function records(allGames) {
  const r = {}; for (const a of ALL) r[a] = { w: 0, l: 0, t: 0, pf: 0, pa: 0 };
  for (const g of allGames) {
    if (g.state !== 'post' || g.homeScore == null || g.awayScore == null) continue;
    const h = r[g.home], a = r[g.away]; if (!h || !a) continue;
    h.pf += g.homeScore; h.pa += g.awayScore; a.pf += g.awayScore; a.pa += g.homeScore;
    if (g.homeScore > g.awayScore) { h.w++; a.l++; } else if (g.homeScore < g.awayScore) { a.w++; h.l++; } else { h.t++; a.t++; }
  }
  return r;
}
export const recStr = r => r.t ? `${r.w}-${r.l}-${r.t}` : `${r.w}-${r.l}`;
export function standingsOrder(allGames) {
  const R = records(allGames); const pct = x => (x.w + .5 * x.t) / Math.max(1, x.w + x.l + x.t);
  return ALL.slice().sort((a, b) => pct(R[b]) - pct(R[a]) || (R[b].pf - R[b].pa) - (R[a].pf - R[a].pa) || a.localeCompare(b));
}
