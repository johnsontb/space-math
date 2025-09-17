// Space Math Adventure — core logic
// No external libs; all interactions are clicks/taps.

(function () {
  // Global low-graphics toggle (mutable via settings)
  let LOW_GFX = true;
  // Starfield background with warp effect
  const Starfield = (() => {
    const canvas = document.getElementById('bg-canvas');
    const ctx = canvas.getContext('2d');
    // Offscreen buffers for post-processing
    const buf = document.createElement('canvas');
    const bctx = buf.getContext('2d');
    const layer = document.createElement('canvas'); // stars layer
    const lctx = layer.getContext('2d');

    // Optional image assets (nebula textures, lens flare) loaded from assets/images
    const IMG_CANDIDATES = [
      // Add or rename as needed; these will be tried in order
      'assets/images/nebula-1.jpg',
      'assets/images/nebula-2.jpg',
      'assets/images/nebula-3.jpg',
      'assets/images/nebula-1.png',
      'assets/images/nebula-2.png',
      'assets/images/nebula-3.png',
      'assets/images/galaxy-1.jpg',
      'assets/images/galaxy-2.jpg',
    ];
    const FLARE_CANDIDATES = [
      'assets/images/flare.png',
      'assets/images/lensflare.png',
    ];
    let nebulaImgs = [];
    let flareImg = null;

    let stars = [];
    let width = 0, height = 0, cx = 0, cy = 0;
    let dpr = 1;
    let fov = 220; // slightly reduced perspective for low gfx
    let baseSpeed = 0.02; // depth units per frame (slightly faster for coverage)
    let speedMult = 1;
    let targetSpeedMult = 1;
    let warpTimer = 0;
    let rafId;
    let roll = 0; // slight camera roll
    let rollSpeed = 0.0016;
    let nebulaAngle = 0;
    const blobs = buildNebulaBlobs();

    function resize() {
      // Keep DPR at 1 for lower GPU/CPU work in low mode
      dpr = LOW_GFX ? 1 : Math.min(2, window.devicePixelRatio || 1);
      width = window.innerWidth; height = window.innerHeight;
      cx = width / 2; cy = height / 2;
      for (const c of [canvas, buf, layer]) {
        c.width = Math.floor(width * dpr);
        c.height = Math.floor(height * dpr);
        c.style.width = width + 'px';
        c.style.height = height + 'px';
      }
      for (const c of [ctx, bctx, lctx]) c.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Ensure enough density to cover the full viewport
      const targetCount = LOW_GFX
        ? Math.min(600, Math.max(220, Math.floor((width * height) / 9000)))
        : Math.min(2400, Math.floor((width * height) / 900));
      rebuild(targetCount);
    }

    function randRange(a, b) { return a + Math.random() * (b - a); }

    function newStar() {
      // Full-viewport distribution with radial expansion
      return {
        x: randRange(-cx, cx),
        y: randRange(-cy, cy),
        // Randomize depth so some stars are already near edges
        z: randRange(0.05, 1.3),
        px: null, py: null,
        hue: randRange(210, 260) + randRange(-12, 12),
      };
    }

    function rebuild(n) {
      const old = stars;
      stars = [];
      for (let i = 0; i < n; i++) stars.push(i < old.length ? old[i] : newStar());
    }

    function recycle(s) {
      // Reappear anywhere with a fresh depth so coverage spans the whole view
      s.x = randRange(-cx, cx);
      s.y = randRange(-cy, cy);
      s.z = randRange(0.05, 1.0);
      s.px = s.py = null;
    }

    function project(sx, sy, z) {
      // rotate by small roll
      const cr = Math.cos(roll), sr = Math.sin(roll);
      const rx = sx * cr - sy * sr;
      const ry = sx * sr + sy * cr;
      const scale = fov / (fov + (1 - z) * fov);
      return [cx + rx * scale, cy + ry * scale];
    }

    function drawNebula() {
      // Lightweight: just draw a few big planet-like gradients (no images)
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      const a = LOW_GFX ? 0.05 : 0.08;
      const planets = [
        { color: '#66c2ff', radius: 0.42, size: 0.36, offset: 0.2, spin: 0.08 },
        { color: '#ffd166', radius: 0.25, size: 0.22, offset: 2.1, spin: -0.06 },
        { color: '#a0ffcf', radius: 0.55, size: 0.28, offset: 4.0, spin: 0.04 },
      ];
      for (const p of planets) {
        const ang = nebulaAngle * p.spin;
        const bx = cx + Math.cos(ang + p.offset) * p.radius * width;
        const by = cy + Math.sin(ang + p.offset) * p.radius * height;
        const r = Math.max(width, height) * p.size;
        const g = ctx.createRadialGradient(bx - r*0.25, by - r*0.25, r * 0.1, bx, by, r);
        g.addColorStop(0, `${p.color}${alphaHex(a * 2)}`);
        g.addColorStop(1, `${p.color}00`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }

    function alphaHex(a) {
      const n = Math.max(0, Math.min(255, Math.round(a * 255)));
      return n.toString(16).padStart(2, '0');
    }

    function drawStars() {
      lctx.clearRect(0, 0, width, height);
      lctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        // Move outward by increasing z (projection expands with z)
        s.z += baseSpeed * speedMult;
        if (s.z >= 1.5) { recycle(s); continue; }
        const [sx, sy] = project(s.x, s.y, s.z);
        // Brighten slightly as stars move outward
        const brightness = Math.max(0.25, 0.45 + s.z * 0.35);
        if (LOW_GFX) {
          // Make low-gfx stars more visible over video: slightly larger + tiny trail
          const size = Math.min(3.0, Math.max(1.4, 0.9 + s.z * 1.2));
          lctx.fillStyle = `rgba(240,245,255,${Math.min(1, brightness + 0.2)})`;
          lctx.fillRect(sx, sy, size, size);
          if (s.px != null && s.py != null) {
            lctx.strokeStyle = `rgba(240,245,255,${Math.min(0.8, 0.25 + brightness * 0.4)})`;
            lctx.lineWidth = Math.max(0.7, size * 0.5);
            lctx.beginPath();
            lctx.moveTo(sx, sy);
            lctx.lineTo(s.px, s.py);
            lctx.stroke();
          }
        } else {
          // Punchier hyperspace streaks in high-gfx mode
          const speedBoost = Math.min(2.2, 1.0 + (speedMult - 1) * 0.9);
          const lw = Math.max(0.9, Math.min(3.5, s.z * (1.2 + speedBoost * 0.9)));
          lctx.strokeStyle = `hsla(${s.hue}, 90%, ${70 * brightness}%, 0.95)`;
          lctx.lineWidth = lw;
          if (s.px != null && s.py != null) {
            lctx.beginPath();
            lctx.moveTo(sx, sy);
            // Extend trail length with speed and distance from center
            const distBoost = 0.4 + s.z * 0.8;
            let trail = 0.9 + speedMult * 0.9 + distBoost;
            trail = Math.min(4.5, trail);
            const tx = sx + (sx - s.px) * trail;
            const ty = sy + (sy - s.py) * trail;
            lctx.lineTo(tx, ty);
            lctx.stroke();
          } else {
            lctx.fillStyle = `rgba(235,240,255,${Math.min(1, brightness + 0.1)})`;
            lctx.fillRect(sx, sy, 1.4, 1.4);
          }
        }
        s.px = sx; s.py = sy;
      }
    }

    function postProcess() {
      // base draw
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, width, height);
      // Lightweight drawing path
      drawNebula();
      ctx.drawImage(layer, 0, 0, width, height);

      if (!LOW_GFX) {
        // The fancy post effects only in high mode
        ctx.globalCompositeOperation = 'lighter';
        const shift = Math.min(5, 0.5 + (speedMult - 1) * 1.0);
        ctx.save();
        ctx.filter = 'hue-rotate(24deg) saturate(1.2)';
        ctx.globalAlpha = 0.15;
        ctx.drawImage(layer, shift, 0, width, height);
        ctx.restore();
        ctx.save();
        ctx.filter = 'hue-rotate(-24deg) saturate(1.2)';
        ctx.globalAlpha = 0.15;
        ctx.drawImage(layer, -shift, 0, width, height);
        ctx.restore();

        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = Math.max(0, Math.min(0.22, (speedMult - 1) * 0.04));
        const scale = 1 + Math.min(0.08, (speedMult - 1) * 0.015);
        ctx.translate(cx, cy);
        ctx.scale(scale, scale);
        ctx.translate(-cx, -cy);
        ctx.drawImage(buf, 0, 0, width, height);
        ctx.restore();

        if (speedMult > 1.8) {
          const bloom = ctx.createRadialGradient(cx, cy, 10, cx, cy, Math.max(width, height) * 0.4);
          const a = Math.min(0.35, (speedMult - 1) * 0.04);
          bloom.addColorStop(0, `rgba(255,255,255,${0.15 + a})`);
          bloom.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = bloom;
          ctx.beginPath(); ctx.arc(cx, cy, Math.max(width, height) * 0.5, 0, Math.PI * 2); ctx.fill();
          if (flareImg) {
            ctx.save();
            const s = 0.7 + Math.min(1.2, (speedMult - 1) * 0.15);
            const size = Math.max(width, height) * 0.6 * s;
            ctx.globalAlpha = Math.min(0.6, 0.25 + (speedMult - 1) * 0.08);
            ctx.translate(cx, cy);
            ctx.rotate(nebulaAngle * 0.2);
            ctx.drawImage(flareImg, -size / 2, -size / 2, size, size);
            ctx.restore();
          }
        }
      }

      // vignette
      const vg = ctx.createRadialGradient(cx, cy, Math.max(width, height) * 0.2, cx, cy, Math.max(width, height) * 0.92);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.35)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, width, height);

      // capture to buffer for next frame smear
      bctx.clearRect(0, 0, width, height);
      bctx.drawImage(canvas, 0, 0, width, height);
    }

    function buildNebulaBlobs() {
      // Hex colors without alpha; use alphaHex when filling
      return [
        { color: '#ff88cc', radius: 0.45, size: 0.85, offset: 0.2, spin: 0.35 },
        { color: '#88aaff', radius: 0.52, size: 0.8, offset: 2.1, spin: -0.3 },
        { color: '#ffd1a1', radius: 0.48, size: 0.75, offset: 4.0, spin: 0.22 },
      ];
    }

    let frameGate = 0;
    function tick() {
      // Ease speed multiplier toward target
      speedMult += (targetSpeedMult - speedMult) * 0.08;
      if (warpTimer > 0) warpTimer--;
      if (warpTimer === 0 && targetSpeedMult > 1) targetSpeedMult = 1;
      roll += rollSpeed * (0.6 + (speedMult - 1) * 0.15);
      nebulaAngle += 0.001 * (0.6 + (speedMult - 1) * 0.2);

      // Throttle work in low mode: render every other frame
      if (!LOW_GFX || (frameGate = 1 - frameGate)) {
        drawStars();
        postProcess();
      }

      rafId = requestAnimationFrame(tick);
    }

    function warp(durationMs = 1000, intensity = 10) {
      targetSpeedMult = intensity;
      warpTimer = Math.round(durationMs / (1000 / 60));
    }

    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        cancelAnimationFrame(rafId);
        rafId = null;
      } else if (!rafId) {
        rafId = requestAnimationFrame(tick);
      }
    });
    resize();
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(tick);

    // Best-effort load of images; ignore failures
    (function loadAssets() {
      if (LOW_GFX) return; // Skip image loading in low graphics mode
      const tryLoad = (src, cb) => {
        const img = new Image();
        img.onload = () => cb(img);
        img.onerror = () => cb(null);
        img.src = src;
      };
      IMG_CANDIDATES.forEach(p => tryLoad(p, (img) => { if (img) nebulaImgs.push(img); }));
      for (const p of FLARE_CANDIDATES) {
        tryLoad(p, (img) => { if (!flareImg && img) flareImg = img; });
      }
    })();

    return { warp };
  })();

  const FX = (() => {
    const canvas = document.getElementById('fx-canvas');
    const ctx = canvas.getContext('2d');
    let particles = [];
    let rafId = null;

    function resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = null;
        // clear to avoid leaving ghost confetti
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      } else if (particles.length && !rafId) {
        loop();
      }
    });
    resize();

    function spawnConfetti(x, y, opts = {}) {
      const colors = ['#ffd166', '#73ffd2', '#a0c4ff', '#ffadad', '#fdffb6', '#caffbf'];
      const count = opts.count || (LOW_GFX ? 30 : 80);
      const spread = opts.spread || Math.PI / 2; // radians
      const gravity = opts.gravity || 0.35;
      const power = opts.power || (LOW_GFX ? 6 : 9);
      for (let i = 0; i < count; i++) {
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * spread * 2;
        const speed = power * (0.4 + Math.random() * 0.8);
        particles.push({
          x, y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          g: gravity * (0.8 + Math.random() * 0.4),
          life: 120 + Math.random() * 40,
          color: colors[(Math.random() * colors.length) | 0],
          size: 3 + Math.random() * 4,
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 0.3,
        });
      }
      loop();
    }

    function loop() {
      if (rafId) return; // already running
      const step = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        particles = particles.filter(p => p.life > 0);
        for (const p of particles) {
          p.vy += p.g;
          p.x += p.vx;
          p.y += p.vy;
          p.rot += p.vr;
          p.life--;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.globalAlpha = Math.max(0, Math.min(1, p.life / 140));
          ctx.fillRect(-p.size, -p.size * 0.5, p.size * 2, p.size);
          ctx.restore();
        }
        if (particles.length === 0) {
          cancelAnimationFrame(rafId);
          rafId = null;
          return;
        }
        rafId = requestAnimationFrame(step);
      };
      rafId = requestAnimationFrame(step);
    }

    function poofAt(x, y) {
      const el = document.createElement('div');
      el.className = 'poof';
      el.style.left = `${x - 5}px`;
      el.style.top = `${y - 5}px`;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 520);
    }

    return { confetti: spawnConfetti, poofAt };
  })();

  // Simple sound via WebAudio (no assets)
  const Bleep = (() => {
    let ac;
    function ctx() {
      if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
      return ac;
    }
    function tone(freq, t = 0.1, type = 'sine', gain = 0.04) {
      const a = ctx();
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.value = gain;
      o.connect(g).connect(a.destination);
      o.start();
      g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + t);
      o.stop(a.currentTime + t + 0.02);
    }
    return {
      correct() { tone(660, 0.12, 'triangle', 0.05); setTimeout(() => tone(880, 0.09, 'triangle', 0.05), 90); },
      wrong() { tone(180, 0.14, 'sawtooth', 0.04); },
      click() { tone(420, 0.06, 'square', 0.02); },
    };
  })();

  // Progress & Levels
  const STORAGE_KEY = 'space-math-progress-v1';
  const SETTINGS_KEY = 'space-math-settings-v1';
  const MAX_STARS = 3;

  const Levels = [
    { id: 1, name: 'Level 1', emoji: '🪐', desc: 'Make 10 and tiny sums', gen: genMake10(), orbColor: '#6ec8ff' },
    { id: 2, name: 'Level 2', emoji: '🌙', desc: 'Add/Sub within 20', gen: genWithin(20), orbColor: '#f9b65b' },
    { id: 3, name: 'Level 3', emoji: '🌟', desc: 'Under 30, no carry/borrow', gen: genNoCarryUnder(30), orbColor: '#ffd56b' },
    { id: 4, name: 'Level 4', emoji: '☄️', desc: 'Under 30 with regrouping', gen: genWithCarryUnder(30), orbColor: '#9ef1a6' },
    { id: 5, name: 'Level 5', emoji: '🌌', desc: 'Bigger numbers & regrouping', gen: genWithCarry(0.5), orbColor: '#c89bff' },
    { id: 6, name: 'Level 6', emoji: '🛰️', desc: 'Mixed practice challenge', gen: genWithCarry(1.0), orbColor: '#ff8fba' },
  ];

  function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

  const KID_NAMES = ['Mia', 'Max', 'Leo', 'Ava', 'Nia', 'Noah', 'Zoe', 'Oli'];
  const WORD_ITEMS = [
    { singular: 'star', plural: 'stars' },
    { singular: 'rocket', plural: 'rockets' },
    { singular: 'coin', plural: 'coins' },
    { singular: 'book', plural: 'books' },
    { singular: 'shell', plural: 'shells' },
  ];

  function pluralize(count, item) {
    return count === 1 ? item.singular : item.plural;
  }

  function buildWordProblem(max = 10) {
    const limit = Math.max(3, Math.min(10, max));
    const item = pick(WORD_ITEMS);
    const name = pick(KID_NAMES);
    let friend = pick(KID_NAMES);
    while (friend === name) friend = pick(KID_NAMES);
    const useAddition = Math.random() < 0.55;

    if (useAddition) {
      const a = randomInt(1, Math.max(2, Math.min(limit - 1, 6)));
      const b = randomInt(1, Math.max(1, Math.min(limit - a, 5)));
      const total = a + b;
      const prompt = `${name} has ${a} ${pluralize(a, item)}. ${name} gets ${b} more ${pluralize(b, item)}. How many ${pluralize(total, item)} does ${name} have now?`;
      return {
        a, b,
        op: '+',
        ans: total,
        type: 'mc',
        prompt,
        choices: [total, Math.max(0, total - 1), total + 1, Math.max(0, total - 2)].slice(0, 4),
      };
    }

    const start = randomInt(4, Math.max(5, limit));
    const give = randomInt(1, Math.min(4, start - 1));
    const left = start - give;
    const prompt = `${name} has ${start} ${pluralize(start, item)}. ${name} gives ${give} ${pluralize(give, item)} to ${friend}. How many ${pluralize(left, item)} does ${name} have left?`;
    return {
      a: start,
      b: give,
      op: '−',
      ans: left,
      type: 'mc',
      prompt,
      choices: [left, Math.max(0, left + 1), Math.max(0, left - 1), Math.max(0, left + 2)].slice(0, 4),
    };
  }

  // Generators
  function genWithin(max) {
    return () => {
      if (Math.random() < 0.25) {
        return buildWordProblem(max);
      }
      const add = Math.random() < 0.5;
      if (add) {
        let a = 0;
        let b = 0;
        for (let i = 0; i < 12; i++) {
          a = randomInt(0, max);
          b = randomInt(0, max);
          if (a + b <= max && (a !== 0 || b !== 0)) break;
        }
        if (a + b > max) b = Math.max(0, max - a);
        const ans = a + b;
        if (Math.random() < 0.3) {
          return {
            a,
            b,
            op: '+',
            ans,
            type: 'input',
            prompt: `${a} + ${b} = ___`,
            inputPlaceholder: 'Type the answer',
          };
        }
        return { a, b, op: '+', ans, type: 'mc', prompt: `What is ${a} + ${b}?` };
      } else {
        const a = randomInt(0, max);
        const b = randomInt(0, a);
        const ans = a - b;
        const askMissing = a > b && Math.random() < 0.2;
        if (askMissing) {
          const prompt = `${a} - ___ = ${ans}`;
          return {
            a,
            b,
            op: '−',
            ans: b,
            type: 'input',
            prompt,
            inputPlaceholder: 'Type the missing number',
          };
        }
        if (Math.random() < 0.25) {
          return {
            a,
            b,
            op: '−',
            ans,
            type: 'input',
            prompt: `${a} - ${b} = ___`,
            inputPlaceholder: 'Type the answer',
          };
        }
        return { a, b, op: '−', ans, type: 'mc', prompt: `What is ${a} - ${b}?` };
      }
    };
  }

  function genNoCarryUnder(max = 30) {
    const additionPool = [];
    const subtractionPool = [];
    for (let a = 10; a <= max; a++) {
      for (let b = 1; b <= max; b++) {
        const sum = a + b;
        if (sum <= max && (a % 10) + (b % 10) < 10) {
          additionPool.push({ a, b, sum });
        }
      }
      for (let b = 1; b <= a; b++) {
        if ((a % 10) >= (b % 10)) {
          subtractionPool.push({ a, b, diff: a - b });
        }
      }
    }

    return () => {
      if (Math.random() < 0.2) {
        return buildWordProblem(Math.min(max, 12));
      }
      const useAdd = additionPool.length && (subtractionPool.length === 0 || Math.random() < 0.55);
      if (useAdd) {
        const pickAdd = additionPool[(Math.random() * additionPool.length) | 0];
        if (Math.random() < 0.35) {
          return {
            a: pickAdd.a,
            b: pickAdd.b,
            op: '+',
            ans: pickAdd.sum,
            type: 'input',
            prompt: `${pickAdd.a} + ${pickAdd.b} = ___`,
            inputPlaceholder: 'Type the answer',
          };
        }
        return {
          a: pickAdd.a,
          b: pickAdd.b,
          op: '+',
          ans: pickAdd.sum,
          type: 'mc',
          prompt: `What is ${pickAdd.a} + ${pickAdd.b}?`,
        };
      }
      const pickSub = subtractionPool[(Math.random() * subtractionPool.length) | 0];
      const askMissing = Math.random() < 0.3;
      if (askMissing) {
        return {
          a: pickSub.a,
          b: pickSub.b,
          op: '−',
          ans: pickSub.b,
          type: 'input',
          prompt: `${pickSub.a} - ___ = ${pickSub.diff}`,
          inputPlaceholder: 'Type the missing number',
          inputAriaLabel: 'Fill in the missing number',
        };
      }
      if (Math.random() < 0.35) {
        return {
          a: pickSub.a,
          b: pickSub.b,
          op: '−',
          ans: pickSub.diff,
          type: 'input',
          prompt: `${pickSub.a} - ${pickSub.b} = ___`,
          inputPlaceholder: 'Type the answer',
        };
      }
      return {
        a: pickSub.a,
        b: pickSub.b,
        op: '−',
        ans: pickSub.diff,
        type: 'mc',
        prompt: `What is ${pickSub.a} - ${pickSub.b}?`,
      };
    };
  }

  function genWithCarryUnder(max = 30) {
    const additionPool = [];
    const subtractionPool = [];
    for (let a = 10; a <= max; a++) {
      for (let b = 1; b <= max; b++) {
        const sum = a + b;
        if (sum <= max && (a % 10) + (b % 10) >= 10) {
          additionPool.push({ a, b, sum });
        }
      }
      for (let b = 1; b <= a; b++) {
        if ((a % 10) < (b % 10)) {
          subtractionPool.push({ a, b, diff: a - b });
        }
      }
    }

    return () => {
      if (Math.random() < 0.15) {
        return buildWordProblem(Math.min(max, 15));
      }
      const useAdd = additionPool.length && (subtractionPool.length === 0 || Math.random() < 0.6);
      if (useAdd && additionPool.length) {
        const pickAdd = additionPool[(Math.random() * additionPool.length) | 0];
        const prompt = `${pickAdd.a} + ${pickAdd.b} = ___`;
        if (Math.random() < 0.45) {
          return {
            a: pickAdd.a,
            b: pickAdd.b,
            op: '+',
            ans: pickAdd.sum,
            type: 'input',
            prompt,
            inputPlaceholder: 'Type the answer',
          };
        }
        if (Math.random() < 0.4) {
          const blankFirst = Math.random() < 0.5;
          const missing = blankFirst ? pickAdd.a : pickAdd.b;
          const shown = blankFirst ? pickAdd.b : pickAdd.a;
          return {
            a: pickAdd.a,
            b: pickAdd.b,
            op: '+',
            ans: missing,
            type: 'input',
            prompt: blankFirst ? `___ + ${shown} = ${pickAdd.sum}` : `${shown} + ___ = ${pickAdd.sum}`,
            inputPlaceholder: 'Type the missing number',
            inputAriaLabel: 'Fill in the missing number',
          };
        }
        return {
          a: pickAdd.a,
          b: pickAdd.b,
          op: '+',
          ans: pickAdd.sum,
          type: 'mc',
          prompt: `What is ${pickAdd.a} + ${pickAdd.b}?`,
        };
      }

      if (subtractionPool.length) {
        const pickSub = subtractionPool[(Math.random() * subtractionPool.length) | 0];
        if (Math.random() < 0.4) {
          return {
            a: pickSub.a,
            b: pickSub.b,
            op: '−',
            ans: pickSub.diff,
            type: 'input',
            prompt: `${pickSub.a} - ${pickSub.b} = ___`,
            inputPlaceholder: 'Type the answer',
          };
        }
        return {
          a: pickSub.a,
          b: pickSub.b,
          op: '−',
          ans: pickSub.diff,
          type: 'mc',
          prompt: `What is ${pickSub.a} - ${pickSub.b}?`,
        };
      }

      // Fallback to simple within-max addition if pools empty
      return genWithin(max)();
    };
  }

  function genNoCarry() {
    return () => {
      const add = Math.random() < 0.5;
      if (add) {
        // a + b, no carry in ones: (a%10 + b%10) < 10
        let a, b;
        while (true) {
          a = randomInt(10, 99); b = randomInt(10, 99);
          if ((a % 10) + (b % 10) < 10 && a + b < 100) break;
        }
        return { a, b, op: '+', ans: a + b };
      } else {
        // a - b, no borrow in ones: (a%10) >= (b%10), ensure a >= b
        let a, b;
        while (true) {
          a = randomInt(10, 99); b = randomInt(10, a);
          if ((a % 10) >= (b % 10)) break;
        }
        return { a, b, op: '−', ans: a - b };
      }
    };
  }

  // Level 1: Mostly addition pairs that make 10, with some not-10 sums mixed in
  function genMake10() {
    // Core "make 10" pairs (both orders), but 20% of the time generate a sum != 10
    const basePairs = [
      [0,10],[1,9],[2,8],[3,7],[4,6],[5,5],[6,4],[7,3],[8,2],[9,1],[10,0]
    ];
    let order = shuffle(basePairs.slice());
    let idx = 0;
    function shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
    function nextMake10() {
      if (idx >= order.length) { idx = 0; order = shuffle(order); }
      const [a, b] = order[idx++];
      return { a, b };
    }
    function nextNot10() {
      // Find a small addition that does not equal 10
      let a = 0, b = 0;
      do {
        a = randomInt(0, 10);
        b = randomInt(0, 10 - a);
      } while (a + b === 10);
      return { a, b };
    }
    return () => {
      const useMake10 = Math.random() < 0.8; // majority are 10
      const pair = useMake10 ? nextMake10() : nextNot10();
      const sum = pair.a + pair.b;
      const askMissingPiece = useMake10 && Math.random() < 0.6;

      if (askMissingPiece) {
        const blankFirst = Math.random() < 0.5;
        const missing = blankFirst ? pair.a : pair.b;
        const shown = blankFirst ? pair.b : pair.a;
        const prompt = blankFirst
          ? `___ + ${shown} = ${sum}`
          : `${shown} + ___ = ${sum}`;
        return {
          a: pair.a,
          b: pair.b,
          op: '+',
          ans: missing,
          type: 'input',
          prompt,
          inputPlaceholder: 'Type the missing number',
          inputAriaLabel: 'Fill in the missing number',
        };
      }

      const useInput = Math.random() < 0.4;
      if (useInput) {
        return {
          a: pair.a,
          b: pair.b,
          op: '+',
          ans: sum,
          type: 'input',
          prompt: `${pair.a} + ${pair.b} = ___`,
          inputPlaceholder: 'Type the answer',
        };
      }

      return {
        a: pair.a,
        b: pair.b,
        op: '+',
        ans: sum,
        type: 'mc',
        prompt: `What is ${pair.a} + ${pair.b}?`,
      };
    };
  }

  function genWithCarry(hardness = 0.5) {
    return () => {
      const add = Math.random() < 0.5;
      if (add) {
        // Chance to require carry in ones
        let a, b;
        const wantCarry = Math.random() < hardness;
        while (true) {
          a = randomInt(10, 99); b = randomInt(10, 99);
          const carry = (a % 10) + (b % 10) >= 10;
          if (wantCarry ? carry : !carry) {
            if (a + b < 100) break; // keep within 2-digit result for simplicity
          }
        }
        return { a, b, op: '+', ans: a + b };
      } else {
        let a, b;
        const wantBorrow = Math.random() < hardness;
        while (true) {
          a = randomInt(10, 99); b = randomInt(10, a);
          const borrow = (a % 10) < (b % 10);
          if (wantBorrow ? borrow : !borrow) break;
        }
        return { a, b, op: '−', ans: a - b };
      }
    };
  }

  // Progress storage
  function loadProgress() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return { highestLevelUnlocked: 1, levels: {} };
  }
  function saveProgress(p) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        // Backfill defaults for older saves
        if (!parsed || typeof parsed !== 'object') return { videoEnabled: true, theme: 'retro', gfx: 'low' };
        if (!('videoEnabled' in parsed)) parsed.videoEnabled = true;
        if (!('theme' in parsed)) parsed.theme = 'retro';
        if (!('gfx' in parsed)) parsed.gfx = 'low';
        return parsed;
      }
    } catch {}
    return { videoEnabled: true, theme: 'retro', gfx: 'low' };
  }
  function saveSettings(s) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  }

  const state = {
    levelIndex: 0,
    progress: loadProgress(),
    settings: loadSettings(),
    questionStart: 0,
    currentQuestion: null,
    buttons: [],
    lastLevelIndex: 0,
    levelProgress: 0,
  };

  // DOM refs
  const promptEl = document.getElementById('prompt');
  const answersEl = document.getElementById('answers');
  const problemEl = document.querySelector('.problem');
  const levelNumEl = document.getElementById('level-number');
  const accuracyEl = document.getElementById('accuracy');
  const speedEl = document.getElementById('speed');
  const starBarEl = document.getElementById('star-bar');
  const charEl = document.getElementById('character');
  const planetTrackEl = document.getElementById('planet-track');

  const btnPrev = document.getElementById('btn-prev');
  const btnNext = document.getElementById('btn-next');
  const btnReset = document.getElementById('btn-reset');
  const btnMap = document.getElementById('btn-level-map');
  const btnTheme = document.getElementById('btn-theme');
  const btnGfx = document.getElementById('btn-gfx');
  const btnVideo = document.getElementById('btn-video');
  const videoEl = document.getElementById('bg-video');
  const bodyEl = document.body;
  const mapEl = document.getElementById('level-map');
  const levelListEl = document.getElementById('level-list');
  const closeMapEl = document.getElementById('close-map');
  const meterEl = document.getElementById('trench-meter');
  const meterSegs = meterEl ? Array.from(meterEl.querySelectorAll('.seg')) : [];
  const swTargetsEl = document.getElementById('sw-targets');
  const swVectorEl = document.getElementById('sw-vector');
  const swShieldEl = document.getElementById('sw-shield');

  // Background video toggle
  function applyVideoSetting(enabled) {
    if (!videoEl) return;
    if (enabled) {
      videoEl.hidden = false;
      const p = videoEl.play?.();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } else {
      try { videoEl.pause?.(); } catch {}
      videoEl.hidden = true;
    }
    if (btnVideo) {
      btnVideo.setAttribute('aria-pressed', String(enabled));
      btnVideo.textContent = `🎞️ Video: ${enabled ? 'On' : 'Off'}`;
    }
  }

  // Theme toggle (retro vs classic)
  function applyThemeSetting(theme) {
    const isRetro = theme === 'retro';
    if (isRetro) bodyEl.classList.add('retro'); else bodyEl.classList.remove('retro');
    if (btnTheme) {
      btnTheme.setAttribute('aria-pressed', String(isRetro));
      btnTheme.textContent = `🎨 Theme: ${isRetro ? 'Retro' : 'Classic'}`;
    }
  }

  // Graphics quality toggle (low/high)
  function applyGraphicsSetting(mode) {
    const isHigh = mode === 'high';
    LOW_GFX = !isHigh;
    if (btnGfx) {
      btnGfx.setAttribute('aria-pressed', String(isHigh));
      btnGfx.textContent = `🖥️ Gfx: ${isHigh ? 'High' : 'Low'}`;
    }
    // Recompute star buffers and counts
    window.dispatchEvent(new Event('resize'));
  }

  // Initialize star bar
  function renderStarsBar(stars = 0) {
    starBarEl.innerHTML = '';
    for (let i = 0; i < MAX_STARS; i++) {
      const s = document.createElement('div');
      s.className = 'star' + (i < stars ? ' on' : '');
      starBarEl.appendChild(s);
    }
  }

  function renderPlanetTrack() {
    if (!planetTrackEl) return;
    planetTrackEl.innerHTML = '';
    Levels.forEach((lvl, idx) => {
      const unlocked = state.progress.highestLevelUnlocked >= lvl.id;
      const completed = state.progress.highestLevelUnlocked > lvl.id;
      const node = document.createElement('button');
      node.className = 'planet-node';
      node.type = 'button';
      node.style.setProperty('--node-accent', lvl.orbColor || '#6ec8ff');
      node.style.setProperty('--node-index', String(idx));
      if (!unlocked) {
        node.classList.add('locked');
        node.disabled = true;
        node.setAttribute('aria-label', `${lvl.name} (locked)`);
      } else {
        node.setAttribute('aria-label', `${lvl.name}: ${lvl.desc}`);
      }
      if (completed) node.classList.add('completed');
      if (idx === state.levelIndex) {
        node.classList.add('current');
        node.setAttribute('aria-current', 'true');
      }
      node.innerHTML = `
        <span class="planet-node__screen">
          <span class="planet-node__grid" aria-hidden="true"></span>
          <span class="planet-node__vector" aria-hidden="true"></span>
          <span class="planet-node__icon" aria-hidden="true">${lvl.emoji}</span>
          <span class="planet-node__pulse" aria-hidden="true"></span>
        </span>
        <span class="planet-node__label">${lvl.name}</span>
      `;
      if (unlocked && idx !== state.levelIndex) {
        node.addEventListener('click', () => switchLevel(idx));
      }
      planetTrackEl.appendChild(node);
    });
  }

  function getLevelStats(idx) {
    const id = Levels[idx].id;
    const rec = state.progress.levels[id] || { attempts: 0, correct: 0, totalTimeMs: 0, bestStars: 0 };
    state.progress.levels[id] = rec; // ensure
    return rec;
  }

  function calcStars(acc, avgMs) {
    if (acc >= 0.9 && avgMs <= 4000) return 3;
    if (acc >= 0.8 && avgMs <= 6000) return 2;
    if (acc >= 0.7 && avgMs <= 9000) return 1;
    return 0;
  }

  const LEVEL_GOAL = 10;

  function renderProgress() {
    if (!meterEl) return;
    const val = Math.max(0, Math.min(LEVEL_GOAL, state.levelProgress || 0));
    meterEl.setAttribute('aria-valuenow', String(val));
    meterSegs.forEach((seg, i) => seg.classList.toggle('on', i < val));
    if (swTargetsEl) swTargetsEl.textContent = `${val}/${LEVEL_GOAL}`;
    // Fun readouts: gently vary vector/shield for flavor
    if (swVectorEl) swVectorEl.textContent = (0.5 + Math.random() * 0.5).toFixed(2);
    if (swShieldEl) swShieldEl.textContent = `${Math.round(70 + Math.random()*30)}%`;
  }

  function updateHUD() {
    const stats = getLevelStats(state.levelIndex);
    const acc = stats.attempts ? stats.correct / stats.attempts : 0;
    const avg = stats.attempts ? stats.totalTimeMs / stats.attempts : 0;
    accuracyEl.textContent = `Accuracy: ${Math.round(acc * 100)}%`;
    speedEl.textContent = `Avg Time: ${stats.attempts ? (avg / 1000).toFixed(1) + 's' : '—'}`;
    renderStarsBar(stats.bestStars || 0);
    levelNumEl.textContent = (state.levelIndex + 1).toString();
    renderProgress();
    renderPlanetTrack();
  }

  function switchLevel(newIndex, opts = {}) {
    if (newIndex < 0 || newIndex >= Levels.length) return;
    const unlocked = state.progress.highestLevelUnlocked >= Levels[newIndex].id;
    if (!unlocked && !opts.force) return;
    const changed = newIndex !== state.levelIndex;
    state.levelIndex = newIndex;
    if (opts.closeMap && mapEl) mapEl.hidden = true;
    if (changed) {
      if (!opts.silent) Bleep.click();
      startRound();
    } else if (opts.refresh) {
      startRound();
    }
  }

  function advanceToNextLevel(auto = false) {
    const next = Math.min(Levels.length - 1, state.levelIndex + 1);
    const unlocked = state.progress.highestLevelUnlocked >= Levels[next].id;
    if (next !== state.levelIndex && unlocked) {
      switchLevel(next, { silent: auto });
    } else {
      state.levelProgress = 0;
      renderProgress();
      setTimeout(startRound, 250);
    }
  }

  function unlockNextIfEligible() {
    const idx = state.levelIndex;
    const id = Levels[idx].id;
    const stats = state.progress.levels[id];
    const acc = stats.attempts ? stats.correct / stats.attempts : 0;
    const avg = stats.attempts ? stats.totalTimeMs / stats.attempts : 99999;
    const stars = calcStars(acc, avg);
    if (stars > (stats.bestStars || 0)) {
      stats.bestStars = stars;
      saveProgress(state.progress);
    }
    const nextLevel = idx + 2; // human id of next
    const isEarly = id <= 3; // make early levels shorter/easier to unlock
    const starThreshold = isEarly ? 1 : 2;
    const fallbackEasy = isEarly && stats.attempts >= 6 && acc >= 0.6; // short attempt path
    if ((stars >= starThreshold || fallbackEasy) && state.progress.highestLevelUnlocked < nextLevel && nextLevel <= Levels.length) {
      state.progress.highestLevelUnlocked = nextLevel;
      saveProgress(state.progress);
    }
  }

  function renderMap() {
    levelListEl.innerHTML = '';
    Levels.forEach((lvl, i) => {
      const card = document.createElement('button');
      const unlocked = state.progress.highestLevelUnlocked >= lvl.id;
      card.className = 'level-card' + (unlocked ? '' : ' locked');
      card.disabled = !unlocked;
      card.innerHTML = `
        <div class="big">${lvl.emoji}</div>
        <div>${lvl.name}</div>
        <div class="desc" style="opacity:.8;font-size:12px;margin:4px 0 6px">${lvl.desc}</div>
        <div class="stars-mini">
          ${Array.from({length: MAX_STARS}).map((_,j)=>`<div class="star${(getLevelStats(i).bestStars||0)>j?' on':''}"></div>`).join('')}
        </div>
      `;
      card.addEventListener('click', () => {
        switchLevel(i, { closeMap: true });
      });
      levelListEl.appendChild(card);
    });
  }

  function startRound() {
    // Reset per-level progress if level changed
    if (state.lastLevelIndex !== state.levelIndex) {
      state.levelProgress = 0;
      state.lastLevelIndex = state.levelIndex;
      renderProgress();
    }
    updateHUD();
    answersEl.innerHTML = '';
    const gen = Levels[state.levelIndex].gen;
    const q = gen();
    state.currentQuestion = q;
    const defaultPrompt = typeof q.a === 'number' && typeof q.b === 'number' && q.op
      ? `${q.a} ${q.op} ${q.b} = ?`
      : 'Solve the puzzle';
    if (q.promptHtml) {
      promptEl.innerHTML = q.promptHtml;
    } else if (q.prompt) {
      promptEl.textContent = q.prompt;
    } else {
      promptEl.textContent = defaultPrompt;
    }
    const questionType = q.type === 'input' ? 'input' : 'mc';
    if (questionType === 'input') {
      state.buttons = createInputAnswer(q.ans, q);
    } else {
      state.buttons = createChoices(q.ans, q);
    }
    state.questionStart = performance.now();
  }

  function createChoices(correct, q) {
    // 3–4 options; ensure unique and plausible distractors
    const desiredCount = Math.random() < 0.2 ? 3 : 4;
    const baseSpan = Math.abs(q && typeof q.a === 'number' ? q.a : correct) + Math.abs(q && typeof q.b === 'number' ? q.b : 0);
    const span = Math.max(2, Math.ceil(baseSpan || correct || 2));

    let arr;
    if (Array.isArray(q.choices) && q.choices.length) {
      const set = new Set();
      q.choices.forEach((val) => {
        const num = Number(val);
        if (!Number.isNaN(num)) set.add(num);
      });
      set.add(correct);
      arr = Array.from(set);
    } else {
      const opts = new Set([correct]);
      while (opts.size < desiredCount) {
        let delta = randomInt(-Math.max(1, Math.floor(span / 3)), Math.max(2, Math.floor(span / 2)));
        if (delta === 0) delta = 1;
        let cand = correct + delta;
        if (cand < 0) cand = Math.abs(cand); // keep non-negative for kid-friendliness
        opts.add(cand);
      }
      arr = Array.from(opts);
    }

    while (arr.length < desiredCount) {
      let delta = randomInt(-Math.max(1, Math.floor(span / 3)), Math.max(2, Math.floor(span / 2)));
      if (delta === 0) delta = 1;
      let cand = correct + delta;
      if (cand < 0) cand = Math.abs(cand);
      if (!arr.includes(cand)) arr.push(cand);
    }

    for (let i = arr.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [arr[i], arr[j]] = [arr[j], arr[i]]; }
    const buttons = arr.map((val) => {
      const btn = document.createElement('button');
      btn.className = 'answer-btn';
      btn.textContent = String(val);
      btn.setAttribute('aria-label', `Answer ${val}`);
      btn.addEventListener('click', (ev) => onAnswer(btn, val, ev));
      answersEl.appendChild(btn);
      return btn;
    });
    return buttons;
  }

  function onAnswer(anchorEl, value, ev) {
    const q = state.currentQuestion;
    if (!q) return;
    const duration = performance.now() - state.questionStart;
    const stats = getLevelStats(state.levelIndex);
    stats.attempts += 1;
    stats.totalTimeMs += duration;
    const rect = anchorEl ? anchorEl.getBoundingClientRect() : answersEl.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    if (value === q.ans) {
      stats.correct += 1;
      // Increment mission meter
      state.levelProgress = Math.min(LEVEL_GOAL, (state.levelProgress || 0) + 1);
      renderProgress();
      if (anchorEl) anchorEl.classList.add('correct');
      charEl.classList.add('cheer');
      setTimeout(() => charEl.classList.remove('cheer'), 720);
      Bleep.correct();
      // Trigger space warp on correct answer
      Starfield.warp(800, 8);
      // Throttle confetti to avoid overlap build-up
      if (!onAnswer._lastConfetti || performance.now() - onAnswer._lastConfetti > 250) {
        onAnswer._lastConfetti = performance.now();
        FX.confetti(centerX, centerY, { count:  LOW_GFX ? 24 : 80, power: LOW_GFX ? 6 : 9 });
      }
      unlockNextIfEligible();
      saveProgress(state.progress);
      if (state.levelProgress >= LEVEL_GOAL) {
        setTimeout(() => advanceToNextLevel(true), 700);
      } else {
        setTimeout(startRound, 550);
      }
    } else {
      if (anchorEl) anchorEl.classList.add('wrong');
      Bleep.wrong();
      if (problemEl) { problemEl.classList.add('hit'); setTimeout(() => problemEl.classList.remove('hit'), 520); }
      if (ev && typeof ev.clientX === 'number') {
        FX.poofAt(ev.clientX, ev.clientY);
      } else {
        FX.poofAt(centerX, centerY);
      }
      if (anchorEl) setTimeout(() => anchorEl.classList.remove('wrong'), 350);
    }
    updateHUD();
  }

  function createInputAnswer(correct, q) {
    const input = document.createElement('input');
    input.type = 'number';
    input.inputMode = 'numeric';
    input.className = 'answer-input';
    const inputLabel = q && q.inputAriaLabel ? q.inputAriaLabel : 'Type your answer';
    const placeholder = q && q.inputPlaceholder ? q.inputPlaceholder : 'Type answer';
    input.setAttribute('aria-label', inputLabel);
    input.placeholder = placeholder;
    input.min = '0';

    const btn = document.createElement('button');
    btn.className = 'answer-btn';
    btn.textContent = q && q.submitLabel ? q.submitLabel : 'Submit';
    btn.setAttribute('aria-label', q && q.submitAriaLabel ? q.submitAriaLabel : 'Submit answer');

    const submit = (ev) => {
      const val = Number(input.value);
      if (Number.isNaN(val) || input.value === '') {
        // gentle nudge
        input.focus();
        input.classList.add('wrong');
        if (problemEl) { problemEl.classList.add('hit'); setTimeout(() => problemEl.classList.remove('hit'), 520); }
        setTimeout(() => input.classList.remove('wrong'), 250);
        return;
      }
      onAnswer(btn, val, ev);
    };

    btn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit(e);
    });

    answersEl.appendChild(input);
    answersEl.appendChild(btn);
    setTimeout(() => input.focus(), 10);
    return [btn];
  }

  // Navigation
  btnPrev.addEventListener('click', () => {
    const prev = Math.max(0, state.levelIndex - 1);
    if (prev !== state.levelIndex) switchLevel(prev);
  });
  btnNext.addEventListener('click', () => {
    const next = Math.min(Levels.length - 1, state.levelIndex + 1);
    if (next !== state.levelIndex) switchLevel(next);
  });
  if (btnGfx) {
    btnGfx.addEventListener('click', () => {
      const nextMode = (state.settings.gfx === 'high') ? 'low' : 'high';
      state.settings.gfx = nextMode;
      saveSettings(state.settings);
      applyGraphicsSetting(nextMode);
      Bleep.click();
    });
    // Apply initial graphics mode from saved settings
    applyGraphicsSetting(state.settings.gfx || 'low');
  } else {
    // Safety: apply mode even if button missing
    applyGraphicsSetting(state.settings.gfx || 'low');
  }
  if (btnTheme) {
    btnTheme.addEventListener('click', () => {
      const nextTheme = state.settings.theme === 'retro' ? 'classic' : 'retro';
      state.settings.theme = nextTheme;
      saveSettings(state.settings);
      applyThemeSetting(nextTheme);
      Bleep.click();
    });
    // Apply initial theme based on saved settings
    applyThemeSetting(state.settings.theme || 'retro');
  } else {
    // Ensure body reflects settings even without button (safety)
    applyThemeSetting(state.settings.theme || 'retro');
  }
  if (btnVideo) {
    btnVideo.addEventListener('click', () => {
      const enabled = !state.settings.videoEnabled;
      state.settings.videoEnabled = enabled;
      saveSettings(state.settings);
      applyVideoSetting(enabled);
      Bleep.click();
    });
    // Apply initial state
    applyVideoSetting(state.settings.videoEnabled);
  }
  btnReset.addEventListener('click', () => {
    if (confirm('Reset all progress?')) {
      state.progress = { highestLevelUnlocked: 1, levels: {} };
      saveProgress(state.progress);
      state.levelIndex = 0;
      Bleep.click();
      startRound();
    }
  });
  btnMap.addEventListener('click', () => { renderMap(); mapEl.hidden = false; Bleep.click(); });
  closeMapEl.addEventListener('click', () => { mapEl.hidden = true; Bleep.click(); });

  // Disable keyboard interactions by preventing focus outline via click only flow
  document.addEventListener('keydown', (e) => {
    // Allow Escape to close map, nothing else required for play
    if (e.key === 'Escape' && !mapEl.hidden) { mapEl.hidden = true; }
  });

  // Parallax for character: mouse/touch + device tilt
  (function setupCharacterParallax() {
    if (!charEl) return;
    let targetX = 0, targetY = 0;
    let curX = 0, curY = 0;
    const maxX = 80; // px horizontal range (more noticeable)
    const maxY = 48; // px vertical range (more noticeable)
    const ease = 0.12; // smoothing factor
    let mouseNX = 0, mouseNY = 0; // -1..1 from pointer
    let tiltNX = 0, tiltNY = 0;   // -1..1 from device tilt

    function onMove(e) {
      const cw = window.innerWidth || 1;
      const ch = window.innerHeight || 1;
      const cx = (('touches' in e && e.touches[0]?.clientX) || e.clientX || 0);
      const cy = (('touches' in e && e.touches[0]?.clientY) || e.clientY || 0);
      mouseNX = (cx / cw) * 2 - 1; // -1..1
      mouseNY = (cy / ch) * 2 - 1; // -1..1
      // Blend mouse and tilt, tilt has lighter weight
      const nx = Math.max(-1, Math.min(1, mouseNX + tiltNX * 0.6));
      const ny = Math.max(-1, Math.min(1, mouseNY + tiltNY * 0.6));
      targetX = nx * maxX;
      targetY = ny * maxY;
    }
    function onTilt(e) {
      // gamma: left/right (-90..90), beta: front/back (-180..180)
      const g = (typeof e.gamma === 'number') ? e.gamma : 0;
      const b = (typeof e.beta === 'number') ? e.beta : 0;
      // Normalize and clamp; invert beta so forward tilt moves up
      tiltNX = Math.max(-1, Math.min(1, g / 30));
      tiltNY = Math.max(-1, Math.min(1, -b / 60));
      // Recompute target with current mouse values
      const nx = Math.max(-1, Math.min(1, mouseNX + tiltNX * 0.6));
      const ny = Math.max(-1, Math.min(1, mouseNY + tiltNY * 0.6));
      targetX = nx * maxX;
      targetY = ny * maxY;
    }
    function tick() {
      curX += (targetX - curX) * ease;
      curY += (targetY - curY) * ease;
      charEl.style.setProperty('--char-offset-x', curX.toFixed(2) + 'px');
      charEl.style.setProperty('--char-offset-y', curY.toFixed(2) + 'px');
      requestAnimationFrame(tick);
    }
    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('deviceorientation', onTilt);
    // Start loop
    requestAnimationFrame(tick);
  })();

  // Kick off
  startRound();
})();
