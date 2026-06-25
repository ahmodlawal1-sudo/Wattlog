# Wattlog

All-in-one home power log — grid uptime, generator fuel cost, and prepaid meter tracking, built for the Pi ecosystem.

## Run locally (optional, to test before deploying)

```bash
npm install
npm run dev
```

Opens at `http://localhost:3000`.

## Deploy to Vercel (recommended — gives you the HTTPS URL the Pi Developer Portal needs)

1. **Push this folder to a new GitHub repo**
   ```bash
   git init
   git add .
   git commit -m "Wattlog v1"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/wattlog.git
   git push -u origin main
   ```

2. **Import into Vercel**
   - Go to vercel.com → log in with GitHub
   - Click "Add New Project" → select your `wattlog` repo
   - Framework preset: Vite (should auto-detect)
   - Click Deploy

3. **Get your URL**
   - Vercel gives you something like `https://wattlog.vercel.app`
   - This is a production URL. For the Pi Developer Portal's "Development URL" field during sandbox testing, you have two options:
     - Use this same Vercel URL (simplest — works fine for early testing)
     - Or deploy a separate branch/preview URL for dev vs. production later

4. **Paste the URL into the Pi Developer Portal**
   - Back in the "Configure Development URL" screen you showed
   - Paste your Vercel URL (e.g. `https://wattlog.vercel.app`)
   - Submit

5. **Test inside Pi Browser**
   - Pi Browser will load your app from that URL inside its sandbox
   - The Pi SDK script tag is already included in `index.html` and initializes in sandbox mode

## Going from sandbox to mainnet later

In `src/EnergyTracker.jsx`, find:
```js
window.Pi.init({ version: "2.0", sandbox: true });
```
Change `sandbox: true` to `sandbox: false` only when Pi approves your app for mainnet — not before.

## Project structure

```
wattlog-app/
├── index.html          # Entry HTML, loads Pi SDK + fonts
├── package.json
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
└── src/
    ├── main.jsx         # React mount point
    ├── index.css        # Tailwind base
    └── EnergyTracker.jsx # The app itself
```
