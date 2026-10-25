# VaultLedger — Ledger & Dataset Studio

Double-entry ledger project, rebuilt with a black-and-white interface, an interactive 3D landing page, and a real CSV analysis backend.

## Run it (no `npm install` needed)
1. Install **Node.js 20 or newer** (https://nodejs.org).
2. Unzip, open a terminal in the unzipped `vl` folder.
3. `node server/index.js`   (or `npm start`)
4. Open **http://localhost:4000**

The backend uses only Node built-ins; the frontend is plain ES modules (no build step). three.js and the Manrope font load from public CDNs in your browser, so you need internet for the 3D scene; without it a CSS fallback is shown and everything else still works.

Optional settings: copy `.env.example` to `server/.env` (PORT, MAX_UPLOAD_MB, MAX_ROWS, SESSION_SECRET).
Sample CSVs are in `server/sample-data` (regenerate with `npm run generate:csv`).

## Using the app
1. **Landing** – double-click the chrome form (or click *Enter VaultLedger*).
2. **Login** – any username (2+ chars), a valid email, and the demo password **`Vault1027`** (shown on the page). Wrong passwords are rejected; retry as often as you like. *This is a demonstration check, not production authentication.*
3. **Upload** – drag & drop or browse for a `.csv`. The server parses and analyses it; progress follows the server's real stages.
4. **Dashboard** – Overview, Data Quality, Statistics, Explore (distribution / compare / relationship / trend). Results are stored server-side by analysis id, so they survive page changes and refreshes. Uploading a new file replaces them.

## Tests
With the server running: `npm test` — 19 HTTP checks (login rules, upload validation, exact row/column/missing/duplicate/mean values, malformed/empty/binary files, second dataset isolation).

## Layout
- `server/index.js` API + static hosting · `server/analyze.js` CSV parser & analysis engine
- `client/` index.html, style.css, `js/app.js` (pages), `js/scene.js` (3D), `js/charts.js` (SVG charts)
- `legacy/` the original MySQL ledger backend (`index.js`, schema, docker-compose, tests) — kept, not wired into this UI (needs MySQL + npm packages).

## Troubleshooting
- *Cannot reach the server* → start it with `node server/index.js`.
- *Port in use* → `PORT=4100 node server/index.js`.
- *Analysis expired* → results are kept in your OS temp folder for 24 h; just upload again.
- Blank 3D area → your browser blocked WebGL or the CDN; the fallback shape still works for navigation.
