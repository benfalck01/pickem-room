# Pick'em Room (hosted version)

A season-long game between friends: rank the teams, set your own line on every NFL game, and score against
the real result and the Vegas closing line. Phone-first, shared and live, no accounts.

- `index.html`, `app.js` — the app (vanilla JS modules, no build step)
- `scoring.js` — the scoring rules (also rendered in the app's How to Play card)
- `nfl.js` — ESPN feeds: schedule, current week, scores, DraftKings closing lines
- `store.js` — storage: Firestore (real) or a local stand-in (`?dev=1`, each browser tab is a player)
- `firebase-config.js` — paste the Firebase web config here
- `firestore.rules` — security rules to paste into the Firebase console

## One-time setup (about five minutes)

1. Go to https://console.firebase.google.com and sign in with Google. **Create a project** named `pickem-room`.
   Turn Google Analytics off. Create.
2. Left menu **Build → Firestore Database → Create database**. Pick a US location. Start in **production mode**. Enable.
3. In Firestore, open the **Rules** tab, replace everything with the contents of `firestore.rules`, and **Publish**.
4. Left menu **Build → Authentication → Get started → Sign-in method**. Enable **Anonymous**. Optionally enable **Google**
   too (lets a player pick up their room on a second phone).
5. **Authentication → Settings → Authorized domains → Add domain**: the GitHub Pages host, e.g. `benfalck01.github.io`.
6. Gear icon → **Project settings → Your apps → Web (</>)**. Nickname `pickem-room`, no Firebase Hosting, Register.
   Copy the `firebaseConfig = { ... }` block into `firebase-config.js` (it is meant to be public).

Then push this folder to a public GitHub repo with Pages enabled (root or `/site`). The link is the game.

## Who is the commissioner?

The first person to open the room and join. The commissioner sees a Commissioner screen (Home → Commissioner) with:
current-week override, reopen/lock a week, rename/drop/restore players, fix a score or closing line, season backup.

## Local development

Serve the folder with any static server and open `index.html?dev=1`. Each browser tab is a different player; tabs
update each other live. The Commissioner screen has a "Reset dev data" button.
