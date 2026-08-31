## Running WardWatch locally

The app has two parts that run separately: a React/Vite frontend and a small Node/Express backend. The frontend works on its own with local mock data, but for the full experience (real-time triage scoring, live hospital ranking) run both.

### 1. Frontend(to be run in the root folder)

```bash
npm install --legacy-peer-deps
npm install lucide-react --legacy-peer-deps
npm install tailwindcss @tailwindcss/vite --legacy-peer-deps
npm run dev
```

Opens at `http://localhost:5173`. Requires `lucide-react` and Tailwind (`tailwindcss` + `@tailwindcss/vite`) — see `package.json` / `vite.config.js`.

### 2. Backend 

In a **separate terminal**, from the `server/` folder:

```bash
npm install --legacy-peer-deps
npm install react-router-dom --legacy-peer-deps
npm install firebase-admin --legacy-peer-deps
node backend_server.js
```

Runs at `http://localhost:4000`. Requires `mock_hospitals.json` to be present in the same folder as `backend_server.js`.

### How they connect

The frontend automatically checks whether the backend is reachable on load:

- **Backend running** → the header shows "backend online," and severity scoring, hospital ranking, inventory updates, and ambulance dispatch all go through real API calls to `localhost:4000`.
- **Backend not running** → the header shows "backend offline," and the app falls back to identical logic computed locally in the browser. Nothing breaks either way — this is intentional, so a demo never fails just because someone forgot to start the second terminal.

Both need to be running at the same time, in two separate terminal tabs, for the live-backend experience.

### Notes

- The backend's API base URL is hardcoded to `http://localhost:4000` in `App.jsx` (see the `API_BASE` constant near the top) — change that if you deploy the backend elsewhere.
- `backend_server.js` uses in-memory storage (`mock_hospitals.json` + an in-memory `requests` array) — restarting the backend resets all inventory changes and dispatch history. Swapping in Firebase is the next real step (see the commented-out lines at the top of the file).
