# 🎱 Gravity Maze
Tilt the phone to roll the ball. 50 levels. Works offline. Refuses to rotate.

## Install on iPhone (baby steps)
1. Go to github.com → sign in → tap **+** → **New repository**.
2. Name it `gravity-maze`, set it to **Public**, tap **Create repository**.
3. Tap **uploading an existing file** and drag in EVERYTHING from this folder
   (`index.html`, `app.js`, `manifest.json`, `sw.js`, `README.md`, and the `icons` folder). Tap **Commit changes**.
4. Repo **Settings** → **Pages** → Source: **Deploy from a branch** → Branch: **main** / **(root)** → **Save**.
5. Wait ~1 minute. Your link: `https://YOUR-USERNAME.github.io/gravity-maze/`
6. On iPhone, open that link in **Safari** → **Share** button → **Add to Home Screen** → **Add**.
7. Open it from the Home Screen, tap Play, tap **Enable Tilt** → **Allow**.
8. Pro tip: Control Center → turn on **Portrait Orientation Lock** 🔒.

After the first open, it works in Airplane Mode.

## Updating later
Upload the changed files, then bump `CACHE` in `sw.js` (e.g. `gravity-maze-v2`) so phones grab the new version.
