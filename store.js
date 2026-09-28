// Pick'em Room — shared storage. One interface, two backends:
//   FirebaseStore: Firestore + anonymous sign-in (the real thing; every phone sees the same data live).
//   LocalStore:    a stand-in for development (?dev=1): the same data model in localStorage, with each browser
//                  tab acting as a different player and BroadcastChannel making tabs update each other live.
//
// Collections (all documents are plain JSON):
//   config/app        { commissionerUid, weekOverride, reopened: {wk:true}, updatedAt }
//   players/{uid}     { name, joinedAt, active, order[32], orderUpdatedAt, updatedAt, linked }
//   lines/{uid}_{wk}  { uid, wk, games: {gameId: {fav:'home'|'away', pts:'3.5', note}}, rankSnapshot[32], updatedAt }
//   book/{gameId}     { close, open, at }          written once by whichever client first sees the close
//   overrides/{gameId}{ homeScore, awayScore, close, note, at }   commissioner corrections

const COLLS = ['config', 'players', 'lines', 'book', 'overrides'];

export async function createStore({ firebaseConfig, dev }) {
  if (dev || !firebaseConfig) return new LocalStore();
  const s = new FirebaseStore(firebaseConfig);
  await s.init();
  return s;
}

/* ---------------- development stand-in ---------------- */
class LocalStore {
  constructor() {
    this.isDev = true;
    this.uid = sessionStorage.getItem('pickem.dev.uid') || ('dev_' + Math.random().toString(36).slice(2, 10));
    sessionStorage.setItem('pickem.dev.uid', this.uid);
    this.subs = []; this.chan = ('BroadcastChannel' in window) ? new BroadcastChannel('pickem.dev') : null;
    if (this.chan) this.chan.onmessage = () => this._notify();
    window.addEventListener('storage', e => { if (e.key === 'pickem.dev.db') this._notify(); });
  }
  _db() { try { return JSON.parse(localStorage.getItem('pickem.dev.db')) || {}; } catch (e) { return {}; } }
  _save(db) { localStorage.setItem('pickem.dev.db', JSON.stringify(db)); if (this.chan) this.chan.postMessage('change'); this._notify(); }
  _notify() { const db = this._db(); for (const s of this.subs) s.cb(Object.entries(db[s.coll] || {}).map(([id, d]) => ({ id, ...d }))); }
  subscribe(coll, cb) { const s = { coll, cb }; this.subs.push(s); setTimeout(() => this._notify(), 0); return () => { this.subs = this.subs.filter(x => x !== s); }; }
  subscribeDoc(coll, id, cb) { return this.subscribe(coll, docs => cb(docs.find(d => d.id === id) || null)); }
  async get(coll, id) { const d = (this._db()[coll] || {})[id]; return d ? { id, ...d } : null; }
  async set(coll, id, data) { const db = this._db(); (db[coll] = db[coll] || {})[id] = strip(data); this._save(db); }
  async update(coll, id, patch) { const db = this._db(); const c = db[coll] = db[coll] || {}; c[id] = { ...(c[id] || {}), ...strip(patch) }; this._save(db); }
  async remove(coll, id) { const db = this._db(); if (db[coll]) delete db[coll][id]; this._save(db); }
  async linkGoogle() { throw new Error('Not available in dev mode'); }
  resetAll() { localStorage.removeItem('pickem.dev.db'); if (this.chan) this.chan.postMessage('change'); this._notify(); }
}
function strip(o) { return JSON.parse(JSON.stringify(o)); }

/* ---------------- Firebase ---------------- */
class FirebaseStore {
  constructor(config) { this.isDev = false; this.config = config; this.uid = null; }
  async init() {
    const V = '10.14.1';
    const [{ initializeApp }, auth, fs] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
      import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`),
    ]);
    this.A = auth; this.F = fs;
    const app = initializeApp(this.config);
    this.auth = auth.getAuth(app); this.db = fs.getFirestore(app);
    const user = await new Promise((resolve, reject) => {
      const stop = auth.onAuthStateChanged(this.auth, u => { if (u) { stop(); resolve(u); } }, reject);
      auth.signInAnonymously(this.auth).catch(reject);
    });
    this.uid = user.uid; this.isAnonymous = user.isAnonymous;
  }
  subscribe(coll, cb, onError) {
    const { collection, onSnapshot } = this.F;
    return onSnapshot(collection(this.db, coll), snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))), err => { console.warn('subscribe', coll, err); if (onError) onError(err); });
  }
  /** One document, live. Used for config/app, whose rules are per-document (a collection listen would be refused). */
  subscribeDoc(coll, id, cb, onError) {
    const { doc, onSnapshot } = this.F;
    return onSnapshot(doc(this.db, coll, id), snap => cb(snap.exists() ? { id: snap.id, ...snap.data() } : null), err => { console.warn('subscribeDoc', coll, id, err); if (onError) onError(err); });
  }
  async get(coll, id) { const { doc, getDoc } = this.F; const s = await getDoc(doc(this.db, coll, id)); return s.exists() ? { id: s.id, ...s.data() } : null; }
  async set(coll, id, data) { const { doc, setDoc } = this.F; await setDoc(doc(this.db, coll, id), strip(data)); }
  async update(coll, id, patch) { const { doc, setDoc } = this.F; await setDoc(doc(this.db, coll, id), strip(patch), { merge: true }); }
  async remove(coll, id) { const { doc, deleteDoc } = this.F; await deleteDoc(doc(this.db, coll, id)); }
  /** Link this device's anonymous player to a Google account so it can be used on other devices. */
  async linkGoogle() {
    const { GoogleAuthProvider, linkWithPopup, signInWithCredential } = this.A;
    const provider = new GoogleAuthProvider();
    try { await linkWithPopup(this.auth.currentUser, provider); return { linked: true, sameUser: true }; }
    catch (e) {
      if (e && e.code === 'auth/credential-already-in-use') {
        const cred = GoogleAuthProvider.credentialFromError(e);
        await signInWithCredential(this.auth, cred);
        return { linked: true, sameUser: false };
      }
      throw e;
    }
  }
}

export { COLLS };
