// Pick'em Room — app logic (phone-first, shared live state).
import { scoreLine, bookSelfScore, RULES, HOW_TO_PLAY } from './scoring.js?v=202609282352';
import { TEAMS, T, ALL, DIVS, WEEK_KEYS, weekLabel, weekShort, nextWeekKey, prevWeekKey, fetchCurrent, fetchWeek, fetchBook, clearCache, records, recStr, standingsOrder } from './nfl.js?v=202609282352';
import { createStore } from './store.js?v=202609282352';
import { FIREBASE_CONFIG } from './firebase-config.js?v=202609282352';

/* ================= state ================= */
const S = { store: null, uid: null, config: null, players: {}, lines: {}, book: {}, overrides: {}, games: {}, current: { key: null, year: null }, week: null, viewWeek: null, me: null, myLines: {}, screen: 'home', ready: false, netErr: null, cmpWho: null, showAllRanks: false, rankMode: 'div', bookTried: new Set() };
const PENS = ['var(--blue)', 'var(--green)', 'var(--purple)', 'var(--orange)'];
const HFA = 2;
const ORD = n => n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : n + 'th';
const BOOST = { 1: 1.5, 2: .75, 3: .25, 30: -.25, 31: -.75, 32: -1.5 };
const rating = rank => (16.5 - rank) * 0.5 + (BOOST[rank] || 0);

/* ================= helpers ================= */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num1 = x => (Math.round(x * 10) / 10).toString();
const roundHalf = x => Math.round(x * 2) / 2;
const nowISO = () => new Date().toISOString();
const fmtKick = d => new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(d));
const fmtKickFull = d => new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(d));
const fmtDay = d => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(d));
const fmtDate = d => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(d));
function lum(hex) { const c = hex.replace('#', ''); const r = parseInt(c.slice(0, 2), 16) / 255, g = parseInt(c.slice(2, 4), 16) / 255, b = parseInt(c.slice(4, 6), 16) / 255; return .2126 * r + .7152 * g + .0722 * b; }
const chip = a => `<span class="chip" style="--c:${T[a].color};color:${lum(T[a].color) > .5 ? '#141a17' : '#fff'}">${a}</span>`;
function flash(msg) { const f = $('flash'); f.textContent = msg; f.classList.add('show'); clearTimeout(flash.t); flash.t = setTimeout(() => f.classList.remove('show'), 2200); }
function lineText(g, line) { if (line == null) return '—'; if (line === 0) return 'PK'; return line < 0 ? `${g.home} −${num1(-line)}` : `${g.away} −${num1(line)}`; }
const lineFromFP = (fav, pts) => { if (pts == null || pts === '') return null; const p = Math.abs(parseFloat(pts)); if (isNaN(p)) return null; if (p === 0) return 0; return fav === 'home' ? -p : fav === 'away' ? p : null; };
const started = g => g.state !== 'pre' || Date.parse(g.date) < Date.now();
const reopened = wk => !!(S.config && S.config.reopened && S.config.reopened[wk]);
const locked = g => started(g) && !reopened(g.wk);
const allGames = () => Object.values(S.games).flat();
const gamesOf = wk => S.games[wk] || [];
function resultOf(g) { const o = S.overrides[g.id]; if (o && o.homeScore != null && o.awayScore != null) return { homeScore: Number(o.homeScore), awayScore: Number(o.awayScore), final: true, corrected: true }; if (g.state === 'post' && g.homeScore != null) return { homeScore: g.homeScore, awayScore: g.awayScore, final: true, corrected: false }; return null; }
function closeOf(g) { const o = S.overrides[g.id]; if (o && o.close != null) return Number(o.close); const b = S.book[g.id]; return b && b.close != null ? Number(b.close) : null; }
const activePlayers = () => Object.values(S.players).filter(p => p.active !== false).sort((a, b) => (a.joinedAt || '').localeCompare(b.joinedAt || ''));
const others = () => activePlayers().filter(p => p.id !== S.uid);
const isCommish = () => !!(S.config && S.config.commissionerUid === S.uid);
const penOf = uid => uid === S.uid ? 'var(--red)' : PENS[Math.max(0, others().findIndex(p => p.id === uid)) % PENS.length];
const nameOf = uid => uid === S.uid ? 'You' : (S.players[uid] && S.players[uid].name) || 'Someone';
const linesDoc = (uid, wk) => uid === S.uid ? S.myLines[wk] : S.lines[`${uid}_${wk}`];
function lineOf(uid, wk, g) { const d = linesDoc(uid, wk); const s = d && d.games && d.games[g.id]; return s ? lineFromFP(s.fav, s.pts) : null; }
function noteOf(uid, wk, g) { const d = linesDoc(uid, wk); const s = d && d.games && d.games[g.id]; return s && s.note ? s.note : ''; }
const myLine = g => lineOf(S.uid, g.wk, g);
function scoreFor(uid, g) { const r = resultOf(g); const c = closeOf(g); if (!r || c == null) return null; return scoreLine(lineOf(uid, g.wk, g), c, r.homeScore, r.awayScore); }
const canSeeOthers = g => myLine(g) != null || started(g);

/* ================= boot ================= */
let renderQueued = false, pendingRender = false;
function scheduleRender() { if (renderQueued) return; renderQueued = true; setTimeout(() => { renderQueued = false; const a = document.activeElement; if (a && a.matches('input,textarea') && a.closest('#main')) { pendingRender = true; return; } render(); }, 0); }   // a timer, not requestAnimationFrame: background tabs pause animation frames but still get live updates
document.addEventListener('focusout', () => { if (pendingRender) { pendingRender = false; setTimeout(render, 60); } });

async function boot() {
  const dev = new URLSearchParams(location.search).has('dev');
  try { S.store = await createStore({ firebaseConfig: FIREBASE_CONFIG, dev }); }
  catch (e) { console.error(e); $('main').innerHTML = `<div class="sheet"><p class="h2">The room couldn't connect.</p><p class="hint" style="margin-top:6px">${esc(e.message || e)}. Check your connection and reload; if it keeps happening, tell the commissioner.</p></div>`; return; }
  S.uid = S.store.uid; if (dev) window.__S = S;
  S.store.subscribeDoc('config', 'app', d => { S.config = d; afterData(); });
  S.store.subscribe('players', docs => { S.players = {}; for (const d of docs) S.players[d.id] = d; S.playersLoaded = true; adoptMe(); afterData(); });
  S.store.subscribe('lines', docs => { S.lines = {}; for (const d of docs) S.lines[d.id] = d; adoptMyLines(); afterData(); });
  S.store.subscribe('book', docs => { S.book = {}; for (const d of docs) S.book[d.id] = d; afterData(); });
  S.store.subscribe('overrides', docs => { S.overrides = {}; for (const d of docs) S.overrides[d.id] = d; afterData(); });
  try {
    const cur = await fetchCurrent(); S.current = { key: cur.key, year: cur.year }; S.games[cur.key] = cur.events.sort((x, y) => x.date.localeCompare(y.date));
    await settleWeek();
  } catch (e) { console.warn('ESPN unavailable', e); S.netErr = 'Could not reach the NFL schedule feed. Showing what was cached.'; S.current = { key: '1', year: new Date().getFullYear() }; S.week = S.current.key; }
  S.viewWeek = S.week;
  S.ready = true;
  window.addEventListener('hashchange', route); route();
  loadSeasonInBackground();
}
async function settleWeek() {
  // effective current week: commissioner override, else ESPN's week; if that week is completely final, move to the next one
  let key = (S.config && S.config.weekOverride) || S.current.key;
  const gs = await ensureGames(key);
  // the room works on the week that still has lines to set: once a week is down to its last game (or none), move on
  if (!(S.config && S.config.weekOverride) && gs.length && gs.filter(g => !started(g)).length <= 1 && nextWeekKey(key)) { const nk = nextWeekKey(key); const ng = await ensureGames(nk); if (ng.length) key = nk; }
  S.week = key;
  const prev = prevWeekKey(key); if (prev) ensureGames(prev).then(scheduleRender);
}
async function ensureGames(wk) { if (S.games[wk]) return S.games[wk]; try { const gs = await fetchWeek(S.current.year || new Date().getFullYear(), wk); S.games[wk] = gs; return gs; } catch (e) { console.warn('week fetch failed', wk, e); S.games[wk] = S.games[wk] || []; return S.games[wk]; } }
async function loadSeasonInBackground() {
  for (const wk of WEEK_KEYS) { if (!S.games[wk]) { await ensureGames(wk); } }
  scheduleRender(); fetchBooks();
  setInterval(async () => { const keys = [prevWeekKey(S.week), S.week, S.viewWeek].filter(Boolean); for (const k of new Set(keys)) { try { S.games[k] = await fetchWeek(S.current.year, k, 60e3); } catch (e) { /* ignore */ } } fetchBooks(); scheduleRender(); }, 90e3);
}
async function fetchBooks() {
  // the book's closing line: fetched only after kickoff, written once for everyone
  const keys = new Set([prevWeekKey(S.week), S.week, S.viewWeek].filter(Boolean));
  for (const k of keys) for (const g of gamesOf(k)) {
    if (!started(g) || S.book[g.id] || S.bookTried.has(g.id)) continue; S.bookTried.add(g.id);
    try { const b = await fetchBook(g.id); if (b && b.close != null) { await S.store.set('book', g.id, { close: b.close, open: b.open, at: nowISO() }); } else S.bookTried.delete(g.id); } catch (e) { S.bookTried.delete(g.id); }
  }
}
function afterData() { if (S.ready) { if (S.config && S.config.weekOverride && S.config.weekOverride !== S.week) settleWeek().then(scheduleRender); scheduleRender(); } }

/* ================= my data (local-authoritative, written with a debounce) ================= */
let adoptedMe = false; const adoptedWeeks = new Set();
function adoptMe() { const d = S.players[S.uid]; if (!d) return; if (!S.me || !adoptedMe || (d.updatedAt || '') > (S.me.updatedAt || '')) { if (!S.me || (d.updatedAt || '') >= (S.me.updatedAt || '')) S.me = { ...d }; adoptedMe = true; } }
function adoptMyLines() { for (const [id, d] of Object.entries(S.lines)) { if (d.uid !== S.uid) continue; const wk = d.wk; const mine = S.myLines[wk]; if (!mine || !adoptedWeeks.has(wk) || (d.updatedAt || '') > (mine.updatedAt || '')) { if (!mine || (d.updatedAt || '') >= (mine.updatedAt || '')) S.myLines[wk] = { ...d, games: { ...(d.games || {}) } }; adoptedWeeks.add(wk); } } }
const WQ = {};
function queueWrite(key, fn) { const q = WQ[key] || (WQ[key] = {}); q.fn = fn; q.dirty = true; clearTimeout(q.timer); q.timer = setTimeout(() => flushWrite(key), 500); }
async function flushWrite(key) { const q = WQ[key]; if (!q || q.inflight || !q.dirty) return; q.dirty = false; q.inflight = true; try { await q.fn(); } catch (e) { console.warn('write failed', key, e); flash('Could not save. Check your connection.'); q.dirty = true; setTimeout(() => flushWrite(key), 4000); } finally { q.inflight = false; if (q.dirty) flushWrite(key); } }
function saveMe(patch) { Object.assign(S.me, patch, { updatedAt: nowISO() }); const snap = { ...S.me }; delete snap.id; queueWrite('me', () => S.store.update('players', S.uid, snap)); }
function myLinesDoc(wk) { return S.myLines[wk] || (S.myLines[wk] = { uid: S.uid, wk, games: {}, rankSnapshot: null, updatedAt: null }); }
function saveLines(wk) { const d = myLinesDoc(wk); d.updatedAt = nowISO(); if (gamesOf(wk).some(g => !started(g))) d.rankSnapshot = S.me.order.slice(); const snap = { ...d }; delete snap.id; queueWrite('lines:' + wk, () => S.store.set('lines', `${S.uid}_${wk}`, snap)); }
function setLine(g, patch) { const d = myLinesDoc(g.wk); const s = d.games[g.id] || (d.games[g.id] = { fav: null, pts: null, note: '' }); Object.assign(s, patch); saveLines(g.wk); }

/* ================= ranking ops: bottom-up hierarchy ================= */
const order = () => S.me.order;
const groupTeams = pred => order().filter(a => pred(T[a]));
const rankOf = a => order().indexOf(a) + 1;
const divRankOf = a => groupTeams(t => t.div === T[a].div).indexOf(a) + 1;
const confRankOf = a => groupTeams(t => t.conf === T[a].conf).indexOf(a) + 1;
const holdPred = (a, scope) => scope === 'conf' ? (t => t.div === T[a].div) : scope === 'ov' ? (t => t.conf === T[a].conf) : null;
const holdWhere = scope => scope === 'conf' ? 'Divisions' : 'Conferences';
function clampMove(list, a, to, scope) { const pred = holdPred(a, scope); const i = list.indexOf(a); const rest = list.filter(x => x !== a); let min = 0, max = rest.length, above = null, below = null; if (pred) { for (let k = i - 1; k >= 0; k--) if (pred(T[list[k]])) { above = list[k]; min = rest.indexOf(above) + 1; break; } for (let k = i + 1; k < list.length; k++) if (pred(T[list[k]])) { below = list[k]; max = rest.indexOf(below); break; } } const idx = Math.max(min, Math.min(max, to)); return { rest, idx, holder: idx !== to ? (to < min ? above : below) : null }; }
const heldMsg = (a, holder, scope, up) => `${T[a].short} stays ${up ? 'below' : 'above'} ${T[holder].short}. Change that under ${holdWhere(scope)}.`;
function heldBy(list, i, dir, scope) { const pred = holdPred(list[i], scope); if (!pred) return null; const j = i + dir; if (j < 0 || j >= list.length) return null; return pred(T[list[j]]) ? list[j] : null; }
function commitOrder(next) { saveMe({ order: next, orderUpdatedAt: nowISO() }); const wk = S.week; if (gamesOf(wk).some(g => !started(g)) && S.myLines[wk]) saveLines(wk); render(); }
function moveOverall(a, to) { const r = clampMove(order(), a, to, 'ov'); if (r.holder) flash(heldMsg(a, r.holder, 'ov', to < r.idx)); const next = r.rest.slice(); next.splice(r.idx, 0, a); if (next.join() === order().join()) return; commitOrder(next); }
function moveInGroup(a, to, scope) { const pred = scope === 'div' ? (t => t.div === T[a].div) : (t => t.conf === T[a].conf); const list = groupTeams(pred); const r = clampMove(list, a, to, scope); if (r.holder) flash(heldMsg(a, r.holder, scope, to < r.idx)); const nl = r.rest.slice(); nl.splice(r.idx, 0, a); if (nl.join() === list.join()) return; const next = order().slice(); const slots = next.map((x, i) => pred(T[x]) ? i : -1).filter(i => i >= 0); nl.forEach((x, k) => { next[slots[k]] = x; }); commitOrder(next); }

/* ================= routing / shell ================= */
function route() { const h = (location.hash || '#home').slice(1); S.screen = ['home', 'rank', 'lines', 'compare', 'standings', 'commish'].includes(h) ? h : 'home'; render(); window.scrollTo(0, 0); }
function go(screen) { if (location.hash === '#' + screen) render(); else location.hash = screen; }
function renderShell() {
  $('wkchip').textContent = S.week ? weekLabel(S.week).toUpperCase() : '';
  const joined = !!S.players[S.uid];
  $('nav').hidden = !joined; $('mebtn').hidden = !joined;
  if (joined) $('mename').textContent = S.me ? S.me.name : '';
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.go === S.screen));
}
function render() {
  if (!S.ready) return;
  renderShell();
  const main = $('main');
  if (!S.playersLoaded) { main.innerHTML = `<div class="sheet"><p class="hint"><span class="spin"></span> Loading the room…</p></div>`; return; }   // never show Join to a returning player before we know who they are
  if (!S.players[S.uid]) { main.innerHTML = renderJoin(); return; }
  if (!S.me) adoptMe();
  const fn = { home: renderHome, rank: renderRank, lines: renderLines, compare: renderCompare, standings: renderStandings, commish: renderCommish }[S.screen] || renderHome;
  main.innerHTML = (S.netErr ? `<div class="warnbox" style="margin-bottom:10px">${esc(S.netErr)}</div>` : '') + fn();
}

/* ================= screens ================= */
function renderJoin() {
  const typed = $('joinname') ? $('joinname').value : '';   // keep a half-typed name if the screen re-renders
  return `<div class="sheet join"><p class="eyebrow">Welcome</p><h1 class="h1">Pick'em Room</h1>
  <p style="margin:10px 0 6px">A season-long game between friends: rank the teams, set your own line on every game, and score against the real result and the Vegas closing line.</p>
  <ol style="padding-left:20px;margin:8px 0 14px;display:grid;gap:6px">${HOW_TO_PLAY.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
  <div class="onboard"><label class="hint" for="joinname">What should we call you?</label><input type="text" id="joinname" placeholder="Your first name" maxlength="24" autocomplete="given-name" value="${esc(typed)}"><button class="btn red wide" data-act="join">Join the room</button><p class="hint">No account needed. Your name and lines are saved to this phone; you can add Google sign-in later to use another device.</p></div></div>`;
}

function weekPicker(wk) { const p = prevWeekKey(wk), n = nextWeekKey(wk); return `<div class="wkpick"><button data-act="wk" data-wk="${p || ''}" ${p ? '' : 'disabled'} aria-label="Previous week">‹</button><b>${weekLabel(wk)}</b><button data-act="wk" data-wk="${n || ''}" ${n ? '' : 'disabled'} aria-label="Next week">›</button>${wk !== S.week ? `<button class="mini" data-act="wk" data-wk="${S.week}">this week</button>` : ''}</div>`; }
function weekRange(gs) { return gs.length ? `${fmtDay(gs[0].date)} – ${fmtDay(gs[gs.length - 1].date)}` : ''; }
function weekTotals(wk) { // per player: pts, scored games, lines set
  const out = {}; for (const p of activePlayers()) out[p.id] = { pts: 0, n: 0, set: 0, bench: 0 };
  for (const g of gamesOf(wk)) for (const p of activePlayers()) { if (lineOf(p.id, wk, g) != null) out[p.id].set++; const sc = scoreFor(p.id, g); if (sc) { out[p.id].pts += sc.total; out[p.id].n++; const r = resultOf(g); out[p.id].bench += bookSelfScore(closeOf(g), r.homeScore, r.awayScore) || 0; } }
  return out;
}
function weekWinners(wk) { const t = weekTotals(wk); const scored = Object.entries(t).filter(([, v]) => v.n > 0); if (!scored.length) return []; const best = Math.max(...scored.map(([, v]) => v.pts)); return scored.filter(([, v]) => v.pts === best).map(([id]) => id); }
function season() {
  const out = {}; for (const p of activePlayers()) out[p.id] = { pts: 0, n: 0, set: 0, won: 0, bench: 0 };
  for (const wk of WEEK_KEYS) { if (!gamesOf(wk).length) continue; const t = weekTotals(wk); const w = weekWinners(wk); for (const id in t) { if (!out[id]) continue; out[id].pts += t[id].pts; out[id].n += t[id].n; out[id].set += t[id].set; out[id].bench += t[id].bench; if (w.includes(id) && w.length === 1) out[id].won++; } }
  const rows = Object.entries(out).map(([id, v]) => ({ id, ...v })).sort((a, b) => b.pts - a.pts || b.n - a.n);
  let rank = 0, prev = null; rows.forEach((r, i) => { if (r.pts !== prev) { rank = i + 1; prev = r.pts; } r.rank = rank; r.tied = rows.filter(x => x.pts === r.pts).length > 1; });
  return rows;
}

function renderHome() {
  const wk = S.week, gs = gamesOf(wk); const unstarted = gs.filter(g => !started(g)); const setCount = gs.filter(g => myLine(g) != null).length; const openCount = unstarted.filter(g => myLine(g) == null).length;
  const nextOpen = unstarted.find(g => myLine(g) == null) || unstarted[0]; const finals = gs.filter(g => resultOf(g)).length; const allFinal = gs.length && finals === gs.length;
  const t = weekTotals(wk); const me = t[S.uid] || { pts: 0, n: 0 };
  let task, cta;
  if (!gs.length) { task = 'No games found for this week yet.'; cta = ''; }
  else if (unstarted.length) {
    if (openCount) { task = `<div class="k">To do</div><div class="v">Set your lines · ${setCount} of ${gs.length} done</div><div class="hint">${nextOpen ? `Next kickoff ${fmtKickFull(nextOpen.date)}. Lines lock at each game's kickoff.` : ''}</div><div class="bar"><i style="width:${Math.round(100 * setCount / gs.length)}%"></i></div>`; cta = `<a class="btn red wide" href="#lines">Set your lines</a>`; }
    else { task = `<div class="k">To do</div><div class="v">All ${gs.length} lines set ✓</div><div class="hint">First kickoff ${fmtKickFull(unstarted[0].date)}. You can still change a line until its game kicks off.</div>`; cta = `<a class="btn ghost wide" href="#lines">Review lines</a>`; }
  } else if (allFinal) { task = `<div class="k">This week</div><div class="v">${weekLabel(wk)} is done · you scored ${me.pts} pts on ${me.n} games</div><div class="hint">${winnerText(wk)}</div>`; cta = `<a class="btn wide" href="#standings">See the scores</a>`; }
  else { task = `<div class="k">This week</div><div class="v">Games in progress · ${finals} of ${gs.length} final</div><div class="hint">Your lines are locked. Scores fill in as games end · ${me.pts} pts so far</div>`; cta = `<a class="btn ghost wide" href="#lines">Follow the week</a>`; }
  const oth = others(); const waiting = oth.map(p => ({ p, left: unstarted.filter(g => lineOf(p.id, wk, g) == null).length })).filter(x => x.left > 0);
  const friends = !oth.length ? `<div class="hint">Nobody else has joined yet. Send them this link.</div>` : unstarted.length ? (waiting.length ? `<div class="hint">Waiting on ${waiting.map(x => `${esc(x.p.name)} (${x.left} to go)`).join(', ')}</div>` : `<div class="hint">Everyone's lines are in.</div>`) : '';
  const firstKick = gs.length ? Date.parse(gs[0].date) : null; const stale = !S.me.orderUpdatedAt || (firstKick && Date.parse(S.me.orderUpdatedAt) < firstKick - 6 * 86400e3);
  const rankNudge = unstarted.length && stale ? `<div class="card soft"><div class="row" style="justify-content:space-between"><div><b>Rankings</b><div class="hint">${S.me.orderUpdatedAt ? 'Last updated ' + fmtDate(S.me.orderUpdatedAt) : 'Not ranked yet: the order is the current standings'}</div></div><a class="btn sm" href="#rank">Update rankings</a></div></div>` : '';
  const ss = season(); const mine = ss.find(r => r.id === S.uid); const prevWk = prevWeekKey(wk); const pt = prevWk ? weekTotals(prevWk)[S.uid] : null;
  const standing = `<div class="card"><div class="row" style="justify-content:space-between;align-items:flex-start"><div><div class="k" style="font:700 11px var(--fb);letter-spacing:.14em;text-transform:uppercase;color:var(--ink3)">Where you stand</div><div class="big red" style="margin-top:4px">${mine ? mine.pts : 0} <span style="font:600 14px var(--fb);color:var(--ink2)">pts</span></div><div class="hint">${mine && ss.length > 1 ? `${mine.tied ? 'T-' : ''}${ORD(mine.rank)} of ${ss.length}` : 'Only you so far'}${pt && pt.n ? ` · ${weekLabel(prevWk)}: ${pt.pts} pts${weekWinners(prevWk).includes(S.uid) ? ', won the week' : ''}` : ''}</div></div><a class="btn sm ghost" href="#standings">Standings</a></div></div>`;
  return `<div class="sheet"><p class="eyebrow">${weekRange(gs)} · ${S.current.key && S.current.key.startsWith('p') ? 'Playoffs' : 'Regular season'}</p><h1 class="h1">${weekLabel(wk)}</h1>
    <div class="stack" style="margin-top:12px"><div class="card"><div class="status">${task}</div>${cta ? `<div style="margin-top:10px">${cta}</div>` : ''}<div style="margin-top:8px">${friends}</div></div>${rankNudge}${standing}
    <div class="row hint" style="justify-content:space-between"><button class="lk" data-act="how">How to play &amp; scoring</button>${isCommish() ? '<a href="#commish" class="lk">Commissioner</a>' : ''}</div></div></div>`;
}
function winnerText(wk) { const w = weekWinners(wk); if (!w.length) return ''; if (w.length === 1) return `${w[0] === S.uid ? 'You took' : nameOf(w[0]) + ' took'} the week.`; return `Week tied between ${w.map(nameOf).join(' and ')}.`; }

function renderRank() {
  const R = records(allGames()); const wk = S.week;
  const arrow = (list, i, dir, scope, a) => { const j = i + dir; const edge = j < 0 || j >= list.length; const h = edge ? null : heldBy(list, i, dir, scope); return `<button data-act="${dir < 0 ? 'gup' : 'gdn'}" data-scope="${scope}" data-abbr="${a}" ${edge ? 'disabled' : ''} class="${h ? 'held' : ''}" title="${h ? esc(heldMsg(a, h, scope, dir < 0)) : (dir < 0 ? 'Up' : 'Down')}">${dir < 0 ? '▲' : '▼'}</button>`; };
  const row = (list, a, i, scope) => `<div class="trow" draggable="true" data-abbr="${a}" data-scope="${scope}"><span class="dr">${i + 1}</span>${chip(a)}<span class="nm"><b>${T[a].short}</b></span><span class="rec">${recStr(R[a])}</span><span class="ovr">#${rankOf(a)}</span><span class="btns">${arrow(list, i, -1, scope, a)}${arrow(list, i, 1, scope, a)}</span></div>`;
  let groups;
  if (S.rankMode === 'div') groups = `<div class="cols2">${['AFC', 'NFC'].map(conf => `<div>${DIVS.filter(d => d.startsWith(conf)).map(d => { const list = groupTeams(t => t.div === d); return `<div class="grpcard grp"><h3>${d}</h3>${list.map((a, i) => row(list, a, i, 'div')).join('')}</div>`; }).join('')}</div>`).join('')}</div>`;
  else if (S.rankMode === 'conf') groups = `<div class="cols2">${['AFC', 'NFC'].map(conf => { const list = groupTeams(t => t.conf === conf); return `<div class="grpcard grp"><h3>${conf}</h3>${list.map((a, i) => row(list, a, i, 'conf')).join('')}</div>`; }).join('')}</div>`;
  else { const list = order(); groups = `<div class="grpcard ov">${list.map((a, i) => { const up = heldBy(list, i, -1, 'ov'), dn = heldBy(list, i, 1, 'ov'); return `<div class="trow" draggable="true" data-abbr="${a}" data-scope="ov"><span class="rk">${i + 1}</span>${chip(a)}<span class="nm"><b>${T[a].short}</b><em>${T[a].divShort} ${ORD(divRankOf(a))} · ${T[a].conf} #${confRankOf(a)}</em></span><span class="rec">${recStr(R[a])}</span><span class="btns"><button data-act="up" data-abbr="${a}" ${i === 0 ? 'disabled' : ''} class="${up ? 'held' : ''}" title="${up ? esc(heldMsg(a, up, 'ov', true)) : 'Up'}">▲</button><button data-act="dn" data-abbr="${a}" ${i === 31 ? 'disabled' : ''} class="${dn ? 'held' : ''}" title="${dn ? esc(heldMsg(a, dn, 'ov', false)) : 'Down'}">▼</button></span></div>`; }).join('')}</div>`; }
  const step = { div: '1 of 3 · Order the four teams in each division.', conf: '2 of 3 · Interleave the divisions. A team can\'t pass a division-mate ranked above it.', ov: '3 of 3 · Merge the two conferences into your NFL 1–32. A team can\'t pass a conference-mate.' }[S.rankMode];
  return `<div class="sheet"><p class="eyebrow">Rankings · ${S.me.orderUpdatedAt ? 'updated ' + fmtDate(S.me.orderUpdatedAt) : 'not touched yet'}</p>
    <div class="row" style="justify-content:space-between;margin-bottom:8px"><div class="seg"><button data-act="rankmode" data-v="div" class="${S.rankMode === 'div' ? 'on' : ''}">Divisions</button><button data-act="rankmode" data-v="conf" class="${S.rankMode === 'conf' ? 'on' : ''}">Conferences</button><button data-act="rankmode" data-v="ov" class="${S.rankMode === 'ov' ? 'on' : ''}">NFL 1–32</button></div><button class="mini" data-act="seed" title="Start over from the current standings">reset to standings</button></div>
    <p class="hint" style="margin-bottom:10px">${step} Greyed arrows mean a lower level holds that spot.</p>${groups}
    <div class="row" style="margin-top:10px;justify-content:space-between"><span class="hint">Done? Your lines are next.</span><a class="btn sm red" href="#lines">Set lines</a></div></div>`;
}

function gameCard(g) {
  const wk = g.wk; const m = myLine(g); const lk = locked(g); const d = myLinesDoc(wk).games[g.id] || {}; const r = resultOf(g); const close = closeOf(g); const R = records(allGames());
  const team = (a, side) => `<div class="g-team">${chip(a)}<div><b>${T[a].short}</b><small>${recStr(R[a])} · #${rankOf(a)} NFL · ${T[a].divShort} ${ORD(divRankOf(a))}</small></div></div>`;
  const sugg = -roundHalf(rating(rankOf(g.home)) - rating(rankOf(g.away)) + (g.neutral ? 0 : HFA));
  const when = `<div class="g-when"><span>${fmtKick(g.date)}${g.tv ? ' · ' + esc(g.tv) : ''}${g.neutral ? ' · neutral site' : ''}</span>${r ? `<span class="fin">${g.away} ${r.awayScore} – ${g.home} ${r.homeScore}${r.corrected ? ' <small class="hint">corrected</small>' : ''}</span>` : lk ? '<span class="muted">locked</span>' : ''}</div>`;
  let mine;
  if (!lk) mine = `<div class="g-line"><button class="fav ${d.fav === 'away' ? 'on' : ''}" data-act="fav" data-side="away">${g.away}</button><button class="fav ${d.fav === 'home' ? 'on' : ''}" data-act="fav" data-side="home">${g.home}</button><input class="pts" type="text" inputmode="decimal" placeholder="pts" value="${esc(d.pts ?? '')}" data-act="pts" aria-label="points"><span class="readout ${m == null && d.pts ? 'warn' : ''}">${m != null ? lineText(g, m) : (d.pts ? '← pick the favorite' : '')}</span></div>
    <div class="g-hint"><span>From your ranks: <b class="mono">${lineText(g, sugg)}</b></span><button class="mini" data-act="usemodel">use</button><button class="mini" data-act="note">${d.note ? 'edit note' : 'add a note'}</button></div>${d.note !== undefined && (d.note || d.noteOpen) ? `<input class="note" type="text" placeholder="Why? (optional, your friends see it after they set theirs)" value="${esc(d.note || '')}" data-act="notetext">` : ''}`;
  else { const sc = scoreFor(S.uid, g); mine = `<div class="g-line"><span class="hint">Your line</span><b class="readout">${m == null ? '<span class="hid">no line</span>' : lineText(g, m)}</b>${close != null ? `<span class="hint">· Book close <b class="mono">${lineText(g, close)}</b></span>` : (r ? '<span class="hint">· waiting for the closing line</span>' : '')}</div>${d.note ? `<div class="hint" style="font-style:italic">${esc(d.note)}</div>` : ''}${sc ? `<div class="g-score">${scBadges(sc)}<button class="lk" data-act="breakdown" data-uid="${S.uid}">how?</button></div>` : ''}`; }
  return `<div class="game ${m != null ? 'set' : ''} ${lk ? 'locked' : ''}" data-id="${g.id}">${when}<div class="g-teams">${team(g.away)}<span class="at">@</span>${team(g.home)}</div>${mine}${othersHTML(g)}</div>`;
}
function othersHTML(g) {
  const oth = others(); if (!oth.length) return '<div class="g-others"></div>'; const vis = canSeeOthers(g); const lk = locked(g); const wk = g.wk;
  return `<div class="g-others">${oth.map(p => { const L = lineOf(p.id, wk, g); const note = vis ? noteOf(p.id, wk, g) : ''; const sc = lk ? scoreFor(p.id, g) : null; return `<div><span class="pen" style="--pc:${penOf(p.id)}"><i></i>${esc(p.name)}</span><span>${vis ? (L == null ? '<span class="hid">no line yet</span>' : `<b style="color:${penOf(p.id)}">${lineText(g, L)}</b>`) : `<span class="hid">${L == null ? 'no line yet' : 'hidden until you set yours'}</span>`}${sc ? ` <span class="pt total">${sc.total}</span><button class="lk" data-act="breakdown" data-uid="${p.id}" style="margin-left:6px">how?</button>` : ''}</span></div>${note ? `<div class="hint" style="font-style:italic;justify-content:flex-start">${esc(note)}</div>` : ''}`; }).join('')}</div>`;
}
/** Patch one game card in place (favorite, points, readout, progress) so a finger in a text box isn't disturbed. */
function refreshCard(g) {
  const card = document.querySelector(`.game[data-id="${g.id}"]`); if (!card) return render();
  const d = myLinesDoc(g.wk).games[g.id] || {}; const m = myLine(g);
  card.querySelectorAll('.fav').forEach(bt => bt.classList.toggle('on', bt.dataset.side === d.fav));
  const pts = card.querySelector('.pts'); if (pts && pts.value !== (d.pts ?? '') && document.activeElement !== pts) pts.value = d.pts ?? '';
  const ro = card.querySelector('.readout'); if (ro) { ro.textContent = m != null ? lineText(g, m) : (d.pts ? '← pick the favorite' : ''); ro.className = 'readout' + (m == null && d.pts ? ' warn' : ''); }
  card.classList.toggle('set', m != null);
  const gs = gamesOf(g.wk); const setCount = gs.filter(x => myLine(x) != null).length; const h = document.querySelector('.sheet .h2'); if (h) h.textContent = `${setCount} of ${gs.length} lines set`; const bar = document.querySelector('.sheet .bar i'); if (bar) bar.style.width = `${gs.length ? Math.round(100 * setCount / gs.length) : 0}%`;
  card.querySelectorAll('.g-others').forEach(el => { el.outerHTML = othersHTML(g); });
}
function scBadges(sc) { return sc.parts.map(p => `<span class="pt ${p.pts >= 5 && /bull|nailed/.test(p.key) ? 'bull' : p.pts > 0 && /beat/.test(p.key) ? 'beat' : p.pts < 0 ? 'lose' : ''}">${p.name} ${p.pts > 0 ? '+' : ''}${p.pts}</span>`).join('') + `<span class="pt total">${sc.total} pts</span>`; }
function renderLines() {
  const wk = S.viewWeek; const gs = gamesOf(wk); if (!S.games[wk]) ensureGames(wk).then(scheduleRender);
  const setCount = gs.filter(g => myLine(g) != null).length; const open = gs.filter(g => !locked(g) && myLine(g) == null).length;
  return `<div class="sheet">${weekPicker(wk)}<div class="row" style="justify-content:space-between;margin:10px 0 6px"><span class="h2">${setCount} of ${gs.length} lines set</span>${open ? `<button class="mini" data-act="nextopen">next open game (${open})</button>` : ''}</div><div class="bar" style="margin-bottom:12px"><i style="width:${gs.length ? Math.round(100 * setCount / gs.length) : 0}%"></i></div>
    <p class="hint" style="margin-bottom:10px">Tap the favorite, type the points, <b>Enter</b> moves to the next game. 0 = pick'em. No sportsbook lines here on purpose; set yours blind.</p>
    ${gs.length ? gs.map(gameCard).join('') : `<div class="empty">${S.games[wk] ? 'No games this week.' : 'Loading games…'}</div>`}</div>`;
}

function renderCompare() {
  const wk = S.viewWeek; const gs = gamesOf(wk); if (!S.games[wk]) ensureGames(wk).then(scheduleRender); const oth = others();
  if (!oth.length) return `<div class="sheet">${weekPicker(wk)}<div class="empty" style="margin-top:12px">Nobody else has joined yet. Once a friend opens the link and sets lines, you'll see them here, game by game.</div></div>`;
  if (!S.cmpWho || !oth.find(p => p.id === S.cmpWho)) S.cmpWho = oth[0].id; const p = S.players[S.cmpWho]; const pc = penOf(p.id);
  const who = oth.length > 1 ? `<label class="row">Compare with <select data-act="cmpwho">${oth.map(o => `<option value="${o.id}" ${o.id === S.cmpWho ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label>` : `<span class="pen" style="--pc:${pc}"><i></i><b>${esc(p.name)}</b></span>`;
  const rows = gs.map(g => { const m = myLine(g), L = lineOf(p.id, wk, g), vis = canSeeOthers(g); const gap = (m != null && L != null && vis) ? Math.abs(m - L) : null; const read = gap == null ? '' : gap === 0 ? 'same' : `you're ${num1(gap)} higher on ${m < L ? g.home : g.away}`; const r = resultOf(g);
    return `<tr class="${gap != null && gap >= 3 ? 'hlrow' : ''}"><td>${chip(g.away)} ${chip(g.home)}<div class="hint"><span class="lbl">${fmtKick(g.date)}${r ? ` · ${r.awayScore}–${r.homeScore}` : ''}</span></div></td><td class="line red">${m == null ? '<span class="hid">not set</span>' : lineText(g, m)}</td><td class="line" style="color:${pc}">${vis ? (L == null ? '<span class="hid">not set</span>' : lineText(g, L)) : `<span class="hid">${L == null ? 'not set' : 'hidden'}</span>`}</td><td class="num">${gap == null ? '<span class="hid">—</span>' : `<b class="mono">${num1(gap)}</b><div class="hint">${read}</div>`}</td></tr>`; }).join('');
  const theirs = validOrder(p.order); const diffs = order().map((a, i) => ({ a, i: i + 1, j: theirs.indexOf(a) + 1 })).map(x => ({ ...x, d: x.j - x.i })); const sorted = diffs.slice().sort((x, y) => Math.abs(y.d) - Math.abs(x.d) || x.i - y.i); const shown = S.showAllRanks ? sorted : sorted.slice(0, 8); const avg = (diffs.reduce((s, x) => s + Math.abs(x.d), 0) / 32).toFixed(1);
  return `<div class="sheet">${weekPicker(wk)}<div class="row" style="margin:10px 0">${who}</div>
    <p class="eyebrow">Lines</p><div class="tbl"><table class="t"><tr><th>Game</th><th>You</th><th>${esc(p.name)}</th><th class="num">Gap</th></tr>${rows || '<tr><td colspan="4" class="hint">Loading…</td></tr>'}</table></div>
    <p class="hint" style="margin:6px 0 14px">A friend's line shows once you've set yours on that game (or after kickoff). Rows with a 3+ point gap are highlighted.</p>
    <p class="eyebrow">Rankings · biggest disagreements</p><p class="hint" style="margin-bottom:6px">You differ by ${avg} spots per team on average.</p><div class="tbl"><table class="t"><tr><th>Team</th><th class="num">You</th><th class="num">${esc(p.name)}</th><th>Read</th></tr>${shown.map(x => `<tr class="${Math.abs(x.d) >= 5 ? 'hlrow' : ''}"><td>${chip(x.a)} <span class="lbl">${T[x.a].short}</span></td><td class="num line red">#${x.i}</td><td class="num line" style="color:${pc}">#${x.j}</td><td class="hint">${x.d === 0 ? 'agree' : x.d > 0 ? `you're higher by ${x.d}` : `${esc(p.name)} is higher by ${-x.d}`}</td></tr>`).join('')}</table></div>
    <div class="row" style="margin-top:8px"><button class="mini" data-act="allranks">${S.showAllRanks ? 'show top 8' : 'show all 32'}</button></div></div>`;
}
function validOrder(o) { const v = (o || []).filter((a, i, arr) => T[a] && arr.indexOf(a) === i); return v.length === 32 ? v : v.concat(ALL.filter(a => !v.includes(a))); }

function renderStandings() {
  const ss = season(); const wk = S.viewWeek; const gs = gamesOf(wk); if (!S.games[wk]) ensureGames(wk).then(scheduleRender); const ps = activePlayers(); const t = weekTotals(wk); const w = weekWinners(wk);
  const seasonTbl = `<div class="tbl"><table class="t"><tr><th>#</th><th>Player</th><th class="num">Points</th><th class="num">Games</th><th class="num">Weeks won</th></tr>${ss.map(r => `<tr class="${r.id === S.uid ? 'me' : ''}"><td class="mono">${r.tied ? 'T-' : ''}${r.rank}</td><td><span class="pen" style="--pc:${penOf(r.id)}"><i></i>${esc(r.id === S.uid ? S.me.name + ' (you)' : nameOf(r.id))}</span></td><td class="num line" style="color:${penOf(r.id)}">${r.pts}</td><td class="num">${r.n}</td><td class="num">${r.won}</td></tr>`).join('')}</table></div>`;
  const scoredGames = gs.filter(g => resultOf(g));
  const weekTbl = scoredGames.length ? `<div class="tbl"><table class="t"><tr><th>Game</th><th class="num">Final</th><th>Book close</th>${ps.map(p => `<th><span class="pen" style="--pc:${penOf(p.id)}"><i></i>${esc(p.id === S.uid ? 'You' : p.name)}</span></th>`).join('')}</tr>${scoredGames.map(g => { const r = resultOf(g); const c = closeOf(g); return `<tr><td>${chip(g.away)} ${chip(g.home)}</td><td class="num mono">${r.awayScore}–${r.homeScore}</td><td class="line muted">${c == null ? '<span class="hid">pending</span>' : lineText(g, c)}</td>${ps.map(p => { const L = lineOf(p.id, wk, g); const sc = scoreFor(p.id, g); return `<td class="tap" data-act="breakdown" data-gid="${g.id}" data-uid="${p.id}"><div class="line" style="color:${penOf(p.id)};font-size:14px">${L == null ? '<span class="hid">no line</span>' : lineText(g, L)}</div>${sc ? `<span class="pt total">${sc.total}</span>` : ''}</td>`; }).join('')}</tr>`; }).join('')}<tr><td><b>${weekLabel(wk)} total</b></td><td></td><td class="hint">copying the book →</td>${ps.map(p => `<td><span class="big" style="font-size:24px;color:${penOf(p.id)}">${t[p.id].pts}</span><div class="hint">${t[p.id].n} games · book ${t[p.id].bench}${w.includes(p.id) ? ' · <b>won</b>' : ''}</div></td>`).join('')}</tr></table></div><p class="hint" style="margin-top:6px">Tap any score to see how it was calculated. "Book" = what copying the closing line on the same games would have scored.</p>` : `<div class="empty">No finished games in ${weekLabel(wk)} yet.</div>`;
  return `<div class="sheet"><p class="eyebrow">Season</p>${seasonTbl}<p class="hint" style="margin:6px 0 16px">Total points wins. Ties stay tied.</p><div style="margin-bottom:10px">${weekPicker(wk)}</div>${weekTbl}</div>`;
}

function renderCommish() {
  if (!isCommish()) return `<div class="sheet"><p class="hint">Only the commissioner can see this.</p></div>`;
  const wk = S.viewWeek; const gs = gamesOf(wk); const ps = Object.values(S.players).sort((a, b) => (a.joinedAt || '').localeCompare(b.joinedAt || ''));
  const weekOpts = `<option value="">Automatic (ESPN says ${weekLabel(S.current.key)})</option>` + WEEK_KEYS.map(k => `<option value="${k}" ${S.config.weekOverride === k ? 'selected' : ''}>${weekLabel(k)}</option>`).join('');
  return `<div class="sheet"><p class="eyebrow">Commissioner</p><h1 class="h1" style="margin-bottom:10px">Controls</h1>
    <div class="stack">
    <div class="card"><b>Current week</b><div class="hint" style="margin-bottom:6px">The room follows ESPN's schedule automatically. Override only if it's wrong.</div><select data-act="weekoverride">${weekOpts}</select></div>
    <div class="card"><b>Players</b><div class="stack" style="margin-top:8px">${ps.map(p => `<div class="row" style="justify-content:space-between"><span><span class="pen" style="--pc:${penOf(p.id)}"><i></i><b>${esc(p.name)}</b></span> <span class="hint">${p.active === false ? 'dropped out' : 'active'} · joined ${p.joinedAt ? fmtDay(p.joinedAt) : '?'}${p.id === S.uid ? ' · you' : ''}</span></span><span class="row"><button class="mini" data-act="rename" data-uid="${p.id}">rename</button><button class="mini" data-act="toggleactive" data-uid="${p.id}">${p.active === false ? 'restore' : 'drop'}</button>${p.active === false && p.id !== S.uid ? `<button class="mini" data-act="removeplayer" data-uid="${p.id}" title="Delete this player and their lines for good">remove</button>` : ''}</span></div>`).join('')}</div><p class="hint" style="margin-top:8px">Dropped players keep their history but leave the standings; "remove" deletes a dropped player and their lines for good. A late joiner simply opens the link; they score from their first week.</p></div>
    <div class="card"><b>Fix a result or closing line</b><div style="margin:8px 0">${weekPicker(wk)}</div><div class="row hint" style="margin-bottom:6px">${reopened(wk) ? `<span class="okbox">${weekLabel(wk)} is reopened: everyone can edit lines after kickoff.</span>` : ''}<button class="mini" data-act="reopen">${reopened(wk) ? 'lock the week again' : 'reopen this week for edits'}</button></div>
      <div class="stack">${gs.map(g => { const o = S.overrides[g.id] || {}; const r = resultOf(g); const b = S.book[g.id]; return `<div class="row" style="justify-content:space-between;border-bottom:1px solid var(--rule);padding:6px 0"><span>${chip(g.away)} ${chip(g.home)} <span class="hint">${fmtKick(g.date)}${r ? ` · ${r.awayScore}–${r.homeScore}` : ''}${b ? ` · book ${lineText(g, b.close)}` : ''}</span></span><span class="row"><input type="number" style="width:64px" placeholder="${g.away}" value="${o.awayScore ?? ''}" data-fix="away" data-gid="${g.id}" aria-label="away score"><input type="number" style="width:64px" placeholder="${g.home}" value="${o.homeScore ?? ''}" data-fix="home" data-gid="${g.id}" aria-label="home score"><input type="text" inputmode="decimal" style="width:70px" placeholder="close" value="${o.close ?? ''}" data-fix="close" data-gid="${g.id}" title="closing line in home terms: negative = home favored" aria-label="closing line"><button class="mini" data-act="savefix" data-gid="${g.id}">save</button>${Object.keys(o).length ? `<button class="mini" data-act="clearfix" data-gid="${g.id}">clear</button>` : ''}</span></div>`; }).join('')}</div><p class="hint" style="margin-top:6px">Closing line is in home terms: −3 means the home team was favored by 3. Leave a box empty to keep ESPN's value.</p></div>
    <div class="card"><b>Data</b><div class="row" style="margin-top:8px"><button class="btn sm ghost" data-act="backup">Download season backup</button><button class="btn sm ghost" data-act="refresh">Refresh NFL data</button>${S.store.isDev ? '<button class="btn sm danger" data-act="devreset">Reset dev data</button>' : ''}</div><p class="hint" style="margin-top:6px">Backup = every player, line, closing line and correction as one JSON file.</p></div>
    </div></div>`;
}

/* ================= modals ================= */
function openModal(html) { $('modalbox').innerHTML = html; $('modal').hidden = false; }
function closeModal() { $('modal').hidden = true; }
function howModal() { const ex = scoreLine(-3.5, -3, 24, 17); return `<p class="eyebrow">How to play</p><h1 class="h1">Pick'em Room</h1><ol style="margin-top:10px">${HOW_TO_PLAY.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
  <p class="eyebrow" style="margin-top:16px">Scoring, per game</p><table class="rules">${RULES.map(r => `<tr><td class="p ${r.pts.startsWith('−') ? 'neg' : 'pos'}">${r.pts}</td><td><b>${r.name}</b><span class="hint">${esc(r.when)}</span></td></tr>`).join('')}</table>
  <p class="eyebrow" style="margin-top:16px">Example</p><p class="hint">You set CLE −3.5. The book closed at CLE −3. Cleveland won 24–17, a 7-point margin. Your line was 3.5 off the margin (Bullseye +5) and 0.5 off the close (On the number +3). You were only 0.5 off the book, so no Beat-the-book points. Total: <b>${ex.total}</b>.</p>
  <p class="eyebrow" style="margin-top:16px">Ranking rule</p><p class="hint">Rank inside each division first, then interleave the divisions in each conference, then merge the conferences into your NFL 1–32. A team can never jump a team ranked above it at a lower level, so your board always agrees with your divisions.</p>
  <div class="row" style="margin-top:14px"><button class="btn wide" data-act="closemodal">Got it</button></div>`; }
function breakdownModal(uid, g) { const sc = scoreFor(uid, g); const r = resultOf(g); const c = closeOf(g); const L = lineOf(uid, g.wk, g); if (!sc) return `<p class="hint">Not scored yet.</p><button class="btn wide" data-act="closemodal" style="margin-top:12px">Close</button>`;
  return `<p class="eyebrow">${uid === S.uid ? 'Your' : esc(nameOf(uid)) + "'s"} score · ${g.away} @ ${g.home}</p><div class="kv" style="margin:8px 0 12px"><b>Line</b><span class="mono">${lineText(g, L)}</span><b>Book close</b><span class="mono">${lineText(g, c)}</span><b>Final</b><span class="mono">${g.away} ${r.awayScore} – ${g.home} ${r.homeScore} (${r.homeScore > r.awayScore ? `${g.home} by ${r.homeScore - r.awayScore}` : r.homeScore < r.awayScore ? `${g.away} by ${r.awayScore - r.homeScore}` : 'tie'})</span><b>Your miss</b><span>${num1(sc.eP)} pts off the margin</span><b>Book's miss</b><span>${num1(sc.eV)} pts off the margin</span><b>You vs book</b><span>${num1(sc.d)} pts apart</span></div>
  <table class="rules">${sc.parts.length ? sc.parts.map(p => `<tr><td class="p ${p.pts < 0 ? 'neg' : 'pos'}">${p.pts > 0 ? '+' : ''}${p.pts}</td><td><b>${p.name}</b><span class="hint">${esc(p.detail)}</span></td></tr>`).join('') : '<tr><td class="p">0</td><td><span class="hint">More than 7 off the margin, more than 3 off the close, and no call against the book.</span></td></tr>'}<tr><td class="p"><b>${sc.total}</b></td><td><b>Total</b></td></tr></table><button class="btn wide" data-act="closemodal" style="margin-top:12px">Close</button>`; }
function meModal() { return `<p class="eyebrow">You</p><h1 class="h1">${esc(S.me.name)}</h1><div class="stack" style="margin-top:12px"><label>Name <input type="text" id="mename-in" value="${esc(S.me.name)}" maxlength="24"></label><button class="btn" data-act="savename">Save name</button>
  ${S.store.isDev ? '' : `<div class="card soft"><b>Use this on another phone</b><p class="hint" style="margin:4px 0 8px">Your player lives on this device. Add Google sign-in once, then sign in with Google on the other device to pick up the same player.</p><button class="btn sm ghost" data-act="linkgoogle">Add Google sign-in</button></div>`}
  ${isCommish() ? '<a class="btn ghost" href="#commish" data-act="closemodal">Commissioner controls</a>' : ''}<button class="btn ghost" data-act="closemodal">Close</button></div>`; }

/* ================= events ================= */
$('howbtn').addEventListener('click', () => openModal(howModal()));
$('mebtn').addEventListener('click', () => openModal(meModal()));
$('modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
$('nav').addEventListener('click', e => { const b = e.target.closest('button[data-go]'); if (b) go(b.dataset.go); });

document.body.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b || b.tagName === 'INPUT' || b.tagName === 'SELECT') return; const act = b.dataset.act;
  const card = b.closest('.game'); const g = card ? gamesOf(S.viewWeek).find(x => x.id === card.dataset.id) : (b.dataset.gid ? allGames().find(x => x.id === b.dataset.gid) : null);
  if (act === 'closemodal') { closeModal(); return; }
  if (act === 'how') { openModal(howModal()); return; }
  if (act === 'join') { const name = ($('joinname').value || '').trim().slice(0, 24); if (!name) { flash('Type your name first'); $('joinname').focus(); return; } b.disabled = true; try { await joinRoom(name); } catch (err) { console.error(err); flash('Could not join: ' + (err.message || err)); b.disabled = false; } return; }
  if (act === 'wk') { if (b.dataset.wk) { S.viewWeek = b.dataset.wk; render(); ensureGames(S.viewWeek).then(() => { scheduleRender(); fetchBooks(); }); } return; }
  if (act === 'rankmode') { S.rankMode = b.dataset.v; render(); return; }
  if (act === 'seed') { if (b.dataset.armed) { commitOrder(standingsOrder(allGames())); flash('Order reset to the standings'); } else { b.dataset.armed = '1'; b.textContent = 'replace my order with the standings? tap again'; setTimeout(() => { b.dataset.armed = ''; b.textContent = 'reset to standings'; }, 4000); } return; }
  if (act === 'up' || act === 'dn') { if (b.classList.contains('held')) { flash(b.title); return; } const a = b.dataset.abbr; moveOverall(a, order().indexOf(a) + (act === 'up' ? -1 : 1)); return; }
  if (act === 'gup' || act === 'gdn') { if (b.classList.contains('held')) { flash(b.title); return; } const a = b.dataset.abbr, scope = b.dataset.scope; const pred = scope === 'div' ? (t => t.div === T[a].div) : (t => t.conf === T[a].conf); const list = groupTeams(pred); moveInGroup(a, list.indexOf(a) + (act === 'gup' ? -1 : 1), scope); return; }
  if (act === 'nextopen') { const c = [...document.querySelectorAll('.game:not(.set):not(.locked)')][0]; if (c) { c.scrollIntoView({ behavior: 'smooth', block: 'center' }); const i = c.querySelector('.pts'); if (i) setTimeout(() => i.focus(), 350); } return; }
  if (act === 'allranks') { S.showAllRanks = !S.showAllRanks; render(); return; }
  if (act === 'breakdown' && g) { openModal(breakdownModal(b.dataset.uid || S.uid, g)); return; }
  if (act === 'savename') { const n = ($('mename-in').value || '').trim().slice(0, 24); if (n) { saveMe({ name: n }); closeModal(); render(); flash('Saved'); } return; }
  if (act === 'linkgoogle') { try { const r = await S.store.linkGoogle(); if (r.sameUser) { saveMe({ linked: true }); flash('Google sign-in added. Sign in with Google on your other phone to pick up this player.'); } else { flash('Signed in as your existing player. Reloading…'); setTimeout(() => location.reload(), 1200); } } catch (err) { flash('Could not add Google sign-in: ' + (err.code || err.message || err)); } return; }
  // commissioner
  if (act === 'reopen') { const rp = { ...(S.config.reopened || {}) }; if (rp[S.viewWeek]) delete rp[S.viewWeek]; else rp[S.viewWeek] = true; await S.store.update('config', 'app', { reopened: rp, updatedAt: nowISO() }); return; }
  if (act === 'rename') { const p = S.players[b.dataset.uid]; openModal(`<p class="eyebrow">Rename player</p><input type="text" id="rn-in" value="${esc(p.name)}" maxlength="24" style="width:100%;margin:8px 0"><button class="btn wide" data-act="rename-save" data-uid="${p.id}">Save</button>`); return; }
  if (act === 'rename-save') { const n = ($('rn-in').value || '').trim().slice(0, 24); if (n) { await S.store.update('players', b.dataset.uid, { name: n, updatedAt: nowISO() }); if (b.dataset.uid === S.uid) S.me.name = n; } closeModal(); return; }
  if (act === 'removeplayer') { const p = S.players[b.dataset.uid]; if (!p) return; if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = `remove ${p.name} for good? tap again`; setTimeout(() => { b.dataset.armed = ''; b.textContent = 'remove'; }, 4000); return; } for (const id of Object.keys(S.lines)) if (S.lines[id].uid === p.id) { try { await S.store.remove('lines', id); } catch (e) { /* ignore */ } } await S.store.remove('players', p.id); flash(`Removed ${p.name}`); return; }
  if (act === 'toggleactive') { const p = S.players[b.dataset.uid]; await S.store.update('players', p.id, { active: p.active === false, updatedAt: nowISO() }); if (p.id === S.uid) S.me.active = p.active === false; return; }
  if (act === 'savefix' && g) { const val = k => { const i = document.querySelector(`[data-fix="${k}"][data-gid="${g.id}"]`); const v = i && i.value.trim(); return v === '' ? null : Number(v); }; const o = { homeScore: val('home'), awayScore: val('away'), close: val('close'), at: nowISO() }; if ((o.homeScore == null) !== (o.awayScore == null)) { flash('Enter both scores, or neither'); return; } await S.store.set('overrides', g.id, o); flash('Saved'); return; }
  if (act === 'clearfix' && g) { await S.store.remove('overrides', g.id); flash('Cleared'); return; }
  if (act === 'backup') { const data = { exportedAt: nowISO(), config: S.config, players: S.players, lines: S.lines, book: S.book, overrides: S.overrides }; const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' })); a.download = `pickem-room-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000); return; }
  if (act === 'refresh') { clearCache(); location.reload(); return; }
  if (act === 'devreset') { S.store.resetAll(); location.reload(); return; }
  // game card actions
  if (g && !locked(g)) {
    if (act === 'fav') { const d = myLinesDoc(g.wk).games[g.id] || {}; setLine(g, { fav: d.fav === b.dataset.side ? null : b.dataset.side }); refreshCard(g); return; }
    if (act === 'usemodel') { const sugg = -roundHalf(rating(rankOf(g.home)) - rating(rankOf(g.away)) + (g.neutral ? 0 : HFA)); setLine(g, { fav: sugg < 0 ? 'home' : sugg > 0 ? 'away' : 'home', pts: String(Math.abs(sugg)) }); refreshCard(g); return; }
    if (act === 'note') { const d = myLinesDoc(g.wk).games[g.id] || (myLinesDoc(g.wk).games[g.id] = { fav: null, pts: null, note: '' }); d.noteOpen = true; render(); const i = document.querySelector(`.game[data-id="${g.id}"] .note`); if (i) i.focus(); return; }
  }
});
document.body.addEventListener('input', e => {
  const i = e.target; const act = i.dataset.act; if (!act) return; const card = i.closest('.game'); if (!card) return; const g = gamesOf(S.viewWeek).find(x => x.id === card.dataset.id); if (!g || locked(g)) return;
  if (act === 'pts') { setLine(g, { pts: i.value.trim() }); const m = myLine(g); const ro = card.querySelector('.readout'); if (ro) { ro.textContent = m != null ? lineText(g, m) : (i.value.trim() ? '← pick the favorite' : ''); ro.className = 'readout' + (m == null && i.value.trim() ? ' warn' : ''); } card.classList.toggle('set', m != null); }
  else if (act === 'notetext') { setLine(g, { note: i.value.slice(0, 140) }); }
});
document.body.addEventListener('change', e => { const i = e.target; if (i.dataset.act === 'cmpwho') { S.cmpWho = i.value; render(); } else if (i.dataset.act === 'weekoverride') { S.store.update('config', 'app', { weekOverride: i.value || null, updatedAt: nowISO() }).then(() => { settleWeek().then(render); }); } });
document.body.addEventListener('keydown', e => { if (e.key !== 'Enter' || !e.target.matches('input')) return; if (e.target.id === 'joinname') { e.preventDefault(); document.querySelector('[data-act="join"]').click(); return; } if (e.target.matches('.pts')) { e.preventDefault(); const all = [...document.querySelectorAll('.pts')]; const k = all.indexOf(e.target); if (k >= 0 && k < all.length - 1) { all[k + 1].focus(); all[k + 1].select(); all[k + 1].scrollIntoView({ block: 'center', behavior: 'smooth' }); return; } e.target.blur(); } });
/* drag & drop (rankings) */
let drag = null; const M = $('main');
M.addEventListener('dragstart', e => { const row = e.target.closest('.trow'); if (!row) return; drag = { abbr: row.dataset.abbr, scope: row.dataset.scope }; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', row.dataset.abbr); } catch (x) { /* ignore */ } row.classList.add('dragging'); });
M.addEventListener('dragover', e => { const row = e.target.closest('.trow'); if (!row || !drag || row.dataset.scope !== drag.scope) return; const a = T[drag.abbr], b = T[row.dataset.abbr]; if (drag.scope === 'div' && a.div !== b.div) return; if (drag.scope === 'conf' && a.conf !== b.conf) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; row.classList.add('over'); });
M.addEventListener('dragleave', e => { const row = e.target.closest('.trow'); if (row) row.classList.remove('over'); });
M.addEventListener('drop', e => { const row = e.target.closest('.trow'); if (!row || !drag) return; e.preventDefault(); const target = row.dataset.abbr, a = drag.abbr, scope = drag.scope; drag = null; if (target === a) return; const pred = scope === 'div' ? (t => t.div === T[a].div) : scope === 'conf' ? (t => t.conf === T[a].conf) : null; const list = pred ? groupTeams(pred) : order(); if (pred && !pred(T[target])) return; const to = list.indexOf(target); if (scope === 'ov') moveOverall(a, to); else moveInGroup(a, to, scope); });
M.addEventListener('dragend', () => { drag = null; document.querySelectorAll('.dragging,.over').forEach(x => x.classList.remove('dragging', 'over')); });

async function joinRoom(name) {
  if (S.players[S.uid]) { location.hash = 'home'; render(); return; }   // already a player on this device: never overwrite
  const now = nowISO(); const ord = allGames().length ? standingsOrder(allGames()) : ALL.slice();
  const doc = { name, joinedAt: now, active: true, order: ord, orderUpdatedAt: null, updatedAt: now, linked: false };
  await S.store.set('players', S.uid, doc);
  S.me = { id: S.uid, ...doc }; adoptedMe = true;
  if (!S.config) { try { await S.store.set('config', 'app', { commissionerUid: S.uid, weekOverride: null, reopened: {}, createdAt: now, updatedAt: now }); } catch (e) { /* someone else got there first */ } }
  location.hash = 'home'; render(); flash(`Welcome, ${name}!`);
}

boot();
