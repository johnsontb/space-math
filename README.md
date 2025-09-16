Space Math Adventure

Overview
- Purpose: A lightweight, kid‑friendly arithmetic game with a playful space theme.
- Core: Simple addition/subtraction practice with levels that ramp difficulty.
- Visuals: Canvas starfield background and confetti effects. A low‑graphics mode is enabled by default for older machines.
- Persistence: Progress and per‑level stats are stored in `localStorage`.

Project Structure
- `index.html`: App shell and DOM structure.
- `styles.css`: Visual styling for HUD, problems, buttons, and overlays.
- `app.js`: Game logic, rendering (background + FX), levels, and progress.
- `assets/`: Optional images. Not required in low‑graphics mode.

Quick Start (Local)
- Start a server in the project directory:
  - Python 3: `python3 -m http.server 8000 --bind 0.0.0.0`
  - PHP: `php -S 0.0.0.0:8000`
  - Ruby: `ruby -run -e httpd . -p 8000 --host 0.0.0.0`
- Open locally: `http://localhost:8000`.

Share on Your LAN
- Find your Mac’s IP:
  - Wi‑Fi: `ipconfig getifaddr en0`
  - Ethernet: `ipconfig getifaddr en1`
- On another device on the same network, open: `http://YOUR_IP:8000`.
- If macOS asks to allow incoming connections, click Allow.

Deployment
- GitHub Pages
  - Push this folder to a GitHub repo.
  - In repo settings → Pages, set Source: “Deploy from a branch”, Branch: `main` (root).
  - Access your site at `https://<user>.github.io/<repo>/`.
- Netlify
  - Drag‑and‑drop the folder onto app.netlify.com or connect the repo. Build command: none. Publish directory: root.
- Vercel
  - Import the repo in vercel.com. Framework preset: “Other”. Output directory: root.

Build Process
- This project is “buildless” (plain HTML/CSS/JS). No bundler is required.
- Optional Node dev server (if you prefer `npm start`):
  1) `npm init -y`
  2) `npm i -D http-server`
  3) Add to `package.json` scripts: `{ "start": "http-server -p 8000 -a 0.0.0.0" }`
  4) Run: `npm start`

Code Tour
- Background Renderer: Starfield and simple planet gradients
  - `app.js`: Starfield module handles star positions, projection, and drawing layers.
  - Low‑graphics mode reduces DPR, star count, effects, and frame rate.
- Effects: Confetti and click “poof”
  - `FX.confetti(x, y, { count, power })` emits celebratory particles on correct answers.
- Sounds: WebAudio tones
  - `Bleep.correct()`, `Bleep.wrong()`, `Bleep.click()` generate short cues.
- Levels and Generators
  - `Levels` array defines name/emoji/description and a `gen()` function per level.
  - Included generators:
    - `genMake10()`: Mostly “make 10” addition pairs with occasional non‑10 sums; mixes multiple choice and input answer types.
    - `genWithin(max)`: Addition/subtraction within a max value.
    - `genNoCarry()`: Two‑digit addition/subtraction avoiding carry/borrow.
    - `genWithCarry(hardness)`: Two‑digit operations with controlled carry/borrow frequency.
- Progress and Unlocking
  - Saved under `localStorage` key `space-math-progress-v1`.
  - Unlock logic considers accuracy and average time; early levels unlock faster.

Configuration & Tuning
- Low‑Graphics Mode
  - Toggle at the top of `app.js`: `const LOW_GFX = true`.
  - True = optimized for older devices (recommended). False = enable extra visuals.
- Level 1 Mix Ratio
  - In `genMake10()`, adjust the ratio of sums that equal 10 vs. not equal 10 by changing `const useMake10 = Math.random() < 0.8`.
- Question Types
  - Both multiple‑choice and input are supported. Adjust ratio in `genMake10()` by changing `Math.random() < 0.5` for `type` selection.
- Stars and Unlock Thresholds
  - `calcStars(acc, avgMs)` controls star assignment from accuracy and speed.
  - `unlockNextIfEligible()` controls when the next level unlocks. Early levels use a lower threshold and a fallback based on attempts and accuracy.
- Reset Progress
  - Click the Reset button in the HUD, or clear `localStorage` entry `space-math-progress-v1` in your browser dev tools.

Maintenance Notes
- Assets: Image loading is optional and skipped in low‑graphics mode. 404s will not break the app.
- Stats Key: If you make breaking changes to progress format, bump `STORAGE_KEY` in `app.js` to avoid old data issues.
- Accessibility: The prompt is live‑region updated; answers are buttons or an input + submit. Keep color contrast high in CSS.
- Browser Support: Modern evergreen browsers. Tested without polyfills.

Troubleshooting
- “Running is slow on older laptops”
  - Keep `LOW_GFX = true` (default). You can also hide the canvases via CSS for ultra‑low mode.
- “Other device can’t connect”
  - Ensure both devices share the same network, not guest/VPN. Check macOS firewall prompts and allow incoming connections for your server.

License
- No license included. Add one if you plan to open source or share broadly.

