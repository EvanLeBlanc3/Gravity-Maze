/* Gravity Maze — tilt the phone to roll the ball. 50 levels. Offline PWA. */
(() => {
'use strict';
const $ = s => document.querySelector(s);
const LEVELS = 50;
const TIERS = [
  { name: 'Rookie Roll',   color: '#38e8ff', floor: ['#16233b', '#0f1829'] },
  { name: 'Pit Panic',     color: '#ff6b6b', floor: ['#2a1a24', '#170f16'] },
  { name: 'Loop-de-Loop',  color: '#b98cff', floor: ['#1f1a3a', '#120f24'] },
  { name: 'Ice Rink',      color: '#9ff3ff', floor: ['#1b3446', '#0e1d29'] },
  { name: 'Lights Out',    color: '#ffd23f', floor: ['#1a1a1a', '#0b0b0b'] },
];
const WIN_LINES = ['Hole in One!', 'Sploosh! Nailed it.', 'Gravity: 1, Maze: 0', 'Ball has entered the chat.', 'Rolling in the deep!', 'Sir Isaac would be proud.', 'Smooth operator.', 'Get in the hole! 🏌️'];
const TRAP_LINES = ['Plop! 🕳️', 'Ball went to the shadow realm', 'Oops. Back to start!', 'That hole was a liar', 'Yeet-ed into the void', 'Gravity said "no"'];

/* ---------- Save data ---------- */
let save;
try { save = JSON.parse(localStorage.getItem('gm_save')) || {}; } catch { save = {}; }
save.unlocked ??= 1; save.best ??= {}; save.stars ??= {};
save.sound ??= true; save.autoCal ??= true; save.sens ??= 1; save.invert ??= false;
const persist = () => localStorage.setItem('gm_save', JSON.stringify(save));

/* ---------- Screens ---------- */
const screens = ['home', 'levels', 'how', 'settings', 'game'];
function show(id) { screens.forEach(s => $('#' + s).classList.toggle('show', s === id)); if (id === 'levels') buildGrid(); if (id === 'home') homeStat(); }
document.querySelectorAll('[data-back]').forEach(b => b.onclick = () => { sfx.click(); show('home'); });
const totalStars = () => Object.values(save.stars).reduce((a, b) => a + b, 0);
function homeStat() { $('#homeStat').textContent = `Levels unlocked: ${Math.min(save.unlocked, LEVELS)}/${LEVELS} · ★ ${totalStars()}/${LEVELS * 3}`; }

/* ---------- Audio (WebAudio, no files needed) ---------- */
let ac = null, rollGain = null, rollFilter = null;
function audioInit() {
  if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
  try {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    const len = ac.sampleRate * 2, buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
    let last = 0; for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
    const src = ac.createBufferSource(); src.buffer = buf; src.loop = true;
    rollFilter = ac.createBiquadFilter(); rollFilter.type = 'lowpass'; rollFilter.frequency.value = 400;
    rollGain = ac.createGain(); rollGain.gain.value = 0;
    src.connect(rollFilter).connect(rollGain).connect(ac.destination); src.start();
  } catch (e) { ac = null; }
}
function tone(freq, dur, type = 'sine', vol = 0.2, slideTo = null, delay = 0) {
  if (!ac || !save.sound) return;
  const t = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + 0.02);
}
const sfx = {
  click: () => tone(660, 0.06, 'square', 0.06),
  clack: v => tone(180 + Math.random() * 60, 0.05, 'triangle', Math.min(0.35, v * 0.05)),
  beep: hi => tone(hi ? 1046 : 523, 0.18, 'square', 0.12),
  plop: () => { tone(500, 0.45, 'sine', 0.35, 60); tone(90, 0.3, 'triangle', 0.2, 40, 0.15); },
  win: () => [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.25, 'triangle', 0.18, null, i * 0.08)),
  star: i => tone(880 + i * 220, 0.2, 'sine', 0.2),
};
function setRoll(speed) {
  if (!rollGain) return;
  const v = save.sound ? Math.min(0.5, speed * 0.05) : 0;
  rollGain.gain.setTargetAtTime(v, ac.currentTime, 0.05);
  rollFilter.frequency.setTargetAtTime(250 + speed * 90, ac.currentTime, 0.05);
}

/* ---------- Seeded RNG + level config ---------- */
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function levelConfig(n) {
  const tier = Math.min(4, Math.floor((n - 1) / 10));
  const k = (n - 1) % 10; // 0..9 within tier
  const cols = [5, 6, 7, 8, 9][tier] + Math.floor(k / 2.5);      // grows within tier
  const rows = Math.round(cols * 1.5);
  return {
    n, tier, cols, rows,
    traps: tier === 0 ? 0 : tier === 1 ? 2 + k : tier === 2 ? 3 + Math.floor(k / 2) : tier === 3 ? 2 + Math.floor(k / 2) : 4 + Math.floor(k / 1.5),
    braid: tier === 2 ? 0.12 : tier >= 3 ? 0.06 : 0,
    friction: tier === 3 ? 0.25 : 1.6,
    dark: tier === 4,
    light: tier === 4 ? 2.9 - k * 0.09 : 0,
  };
}

/* ---------- Maze generation ---------- */
const DIRS = [[0, -1, 0, 2], [1, 0, 1, 3], [0, 1, 2, 0], [-1, 0, 3, 1]]; // dx,dy,wall,opposite (N,E,S,W)
function genMaze(cfg) {
  const R = mulberry32(cfg.n * 7919 + 1337);
  const { cols, rows } = cfg;
  const cells = []; for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) cells.push({ x, y, w: [1, 1, 1, 1], v: 0 });
  const at = (x, y) => cells[y * cols + x];
  const inb = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows;
  const sx = Math.floor(R() * cols), sy = rows - 1; // start on bottom row
  const stack = [at(sx, sy)]; at(sx, sy).v = 1;
  while (stack.length) {
    const c = stack[stack.length - 1];
    const opts = DIRS.filter(([dx, dy]) => inb(c.x + dx, c.y + dy) && !at(c.x + dx, c.y + dy).v);
    if (!opts.length) { stack.pop(); continue; }
    const [dx, dy, a, b] = opts[Math.floor(R() * opts.length)];
    const nb = at(c.x + dx, c.y + dy); c.w[a] = 0; nb.w[b] = 0; nb.v = 1; stack.push(nb);
  }
  if (cfg.braid) for (const c of cells) if (R() < cfg.braid) {
    const [dx, dy, a, b] = DIRS[1 + Math.floor(R() * 2)];
    if (inb(c.x + dx, c.y + dy)) { c.w[a] = 0; at(c.x + dx, c.y + dy).w[b] = 0; }
  }
  // BFS from start
  const dist = new Array(cells.length).fill(-1), prev = new Array(cells.length).fill(-1);
  const q = [sy * cols + sx]; dist[q[0]] = 0;
  while (q.length) { const i = q.shift(), c = cells[i];
    DIRS.forEach(([dx, dy, a]) => { if (!c.w[a]) { const j = (c.y + dy) * cols + c.x + dx; if (dist[j] < 0) { dist[j] = dist[i] + 1; prev[j] = i; q.push(j); } } });
  }
  // goal = farthest cell (preferring the top half for drama)
  let gi = 0; dist.forEach((d, i) => { const bonus = cells[i].y < rows / 2 ? 0.5 : 0; if (d + bonus > dist[gi] + (cells[gi].y < rows / 2 ? 0.5 : 0)) gi = i; });
  const onPath = new Set(); for (let i = gi; i >= 0; i = prev[i]) onPath.add(i);
  // traps: off-path cells, prefer ones touching the path (so you roll right past them)
  const near = [], far = [];
  cells.forEach((c, i) => {
    if (onPath.has(i) || dist[i] < 2) return;
    const touches = DIRS.some(([dx, dy, a]) => !c.w[a] && onPath.has((c.y + dy) * cols + c.x + dx));
    (touches ? near : far).push(i);
  });
  const shuffle = arr => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
  const pool = shuffle(near).concat(shuffle(far));
  const traps = pool.slice(0, cfg.traps).map(i => ({ x: cells[i].x + 0.5, y: cells[i].y + 0.5 }));
  // build wall rectangles in cell units
  const h = 0.07, walls = [];
  for (const c of cells) {
    if (c.w[0]) walls.push([c.x - h, c.y - h, c.x + 1 + h, c.y + h]);
    if (c.w[3]) walls.push([c.x - h, c.y - h, c.x + h, c.y + 1 + h]);
    if (c.y === rows - 1 && c.w[2]) walls.push([c.x - h, rows - h, c.x + 1 + h, rows + h]);
    if (c.x === cols - 1 && c.w[1]) walls.push([cols - h, c.y - h, cols + h, c.y + 1 + h]);
  }
  // spatial buckets per cell for fast collision
  const buckets = cells.map(() => []);
  walls.forEach((w, wi) => {
    for (let y = Math.max(0, Math.floor(w[1]) - 1); y <= Math.min(rows - 1, Math.floor(w[3]) + 1); y++)
      for (let x = Math.max(0, Math.floor(w[0]) - 1); x <= Math.min(cols - 1, Math.floor(w[2]) + 1); x++) buckets[y * cols + x].push(wi);
  });
  return { cols, rows, walls, buckets, traps, start: { x: sx + 0.5, y: sy + 0.5 }, goal: { x: cells[gi].x + 0.5, y: cells[gi].y + 0.5 }, pathLen: dist[gi] };
}

/* ---------- Level select ---------- */
function buildGrid() {
  const g = $('#levelGrid'); g.innerHTML = '';
  for (let n = 1; n <= LEVELS; n++) {
    if ((n - 1) % 10 === 0) { const t = document.createElement('div'); t.className = 'tierLabel'; const tr = TIERS[(n - 1) / 10]; t.style.color = tr.color; t.textContent = `World ${(n - 1) / 10 + 1} · ${tr.name}`; g.appendChild(t); }
    const d = document.createElement('div'), st = save.stars[n] || 0, locked = n > save.unlocked;
    d.className = 'lv' + (locked ? ' locked' : '') + (st ? ' done' : '');
    d.innerHTML = locked ? '🔒' : `${n}<span class="st">${'★'.repeat(st)}${'☆'.repeat(3 - st)}</span>`;
    d.onclick = () => { if (locked) { tone(150, 0.15, 'sawtooth', 0.1); d.animate([{ transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(0)' }], 200); return; } sfx.click(); startLevel(n); };
    g.appendChild(d);
  }
  $('#starTotal').textContent = `★ ${totalStars()}`;
}

/* ---------- Tilt input ---------- */
const tilt = { b: 0, g: 0, b0: 0, g0: 0, has: false, allowed: false };
window.addEventListener('deviceorientation', e => {
  if (e.beta == null) return;
  tilt.b = e.beta; tilt.g = e.gamma; tilt.has = true;
});
function calibrate() { tilt.b0 = tilt.b; tilt.g0 = tilt.g; }
function needsPermission() { return typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function'; }
async function requestTilt() {
  audioInit();
  if (!needsPermission()) { tilt.allowed = true; return true; }
  try { const r = await DeviceOrientationEvent.requestPermission(); tilt.allowed = r === 'granted'; } catch { tilt.allowed = false; }
  return tilt.allowed;
}
// touch-joystick + keyboard fallback
const joy = { on: false, x0: 0, y0: 0, x: 0, y: 0 }, keys = {};
const cv = $('#cv');
cv.addEventListener('pointerdown', e => { joy.on = true; joy.x0 = joy.x = e.clientX; joy.y0 = joy.y = e.clientY; });
window.addEventListener('pointermove', e => { if (joy.on) { joy.x = e.clientX; joy.y = e.clientY; } });
window.addEventListener('pointerup', () => joy.on = false);
window.addEventListener('keydown', e => keys[e.key] = true);
window.addEventListener('keyup', e => keys[e.key] = false);

function getAccel() {
  const G = 34 * save.sens, lim = 40, rad = Math.PI / 180, inv = save.invert ? -1 : 1;
  let ax = 0, ay = 0;
  if (joy.on) { ax = Math.max(-1, Math.min(1, (joy.x - joy.x0) / 70)) * G * 0.64; ay = Math.max(-1, Math.min(1, (joy.y - joy.y0) / 70)) * G * 0.64; }
  else if (keys.ArrowLeft || keys.ArrowRight || keys.ArrowUp || keys.ArrowDown) { ax = ((keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0)) * G * 0.6; ay = ((keys.ArrowDown ? 1 : 0) - (keys.ArrowUp ? 1 : 0)) * G * 0.6; }
  else if (tilt.has) {
    const dg = Math.max(-lim, Math.min(lim, tilt.g - tilt.g0)), db = Math.max(-lim, Math.min(lim, tilt.b - tilt.b0));
    ax = Math.sin(dg * rad) * G * inv; ay = Math.sin(db * rad) * G * inv;
  }
  return [ax, ay];
}

/* ---------- Game state ---------- */
let L = null, cfg = null, ball = null, state = 'idle', t0 = 0, elapsed = 0, falls = 0, particles = [], mazeCanvas = null, view = {}, lastT = 0, wakeLock = null, sinkT = 0, sinkTarget = null, sinkKind = '';
const ctx = cv.getContext('2d');

async function startLevel(n) {
  audioInit();
  if (needsPermission() && !tilt.allowed && !save.noTilt) { pendingLevel = n; $('#mPerm').classList.add('show'); return; }
  cfg = levelConfig(n); L = genMaze(cfg);
  ball = { x: L.start.x, y: L.start.y, vx: 0, vy: 0, r: 0.27, rot: 0, s: 1 };
  falls = 0; elapsed = 0; particles = [];
  const tr = TIERS[cfg.tier];
  $('#hudMid').innerHTML = `Level ${n}<small style="color:${tr.color}">${tr.name}</small>`;
  $('#hudTime').textContent = '0.0s';
  ['#mWin', '#mPause'].forEach(m => $(m).classList.remove('show'));
  show('game'); resize();
  try { if ('wakeLock' in navigator && !wakeLock) wakeLock = await navigator.wakeLock.request('screen'); wakeLock?.addEventListener?.('release', () => wakeLock = null); } catch {}
  countdown();
}
let pendingLevel = 1;
$('#btnAllow').onclick = async () => { sfx.click(); const ok = await requestTilt(); $('#mPerm').classList.remove('show'); if (!ok) { save.noTilt = true; persist(); toast('No tilt? No problem — drag to steer!'); } startLevel(pendingLevel); };
$('#btnNoTilt').onclick = () => { sfx.click(); save.noTilt = true; persist(); $('#mPerm').classList.remove('show'); startLevel(pendingLevel); };

let cdTimer = null;
function countdown() {
  state = 'countdown'; clearInterval(cdTimer);
  const cd = $('#countdown'), num = $('#cdNum'); let c = 3;
  cd.classList.add('show'); num.textContent = c; sfx.beep(false);
  $('#cdTip').textContent = save.autoCal ? 'Hold your phone the way you\'ll play' : 'Get ready to roll!';
  cdTimer = setInterval(() => {
    c--;
    num.style.animation = 'none'; void num.offsetWidth; num.style.animation = '';
    if (c > 0) { num.textContent = c; sfx.beep(false); }
    else if (c === 0) { num.textContent = 'GO!'; sfx.beep(true); if (save.autoCal) calibrate(); state = 'play'; t0 = performance.now(); }
    else { clearInterval(cdTimer); cd.classList.remove('show'); }
  }, 650);
}

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 1300); }

/* ---------- Layout / pre-render ---------- */
function resize() {
  const dpr = Math.min(3, window.devicePixelRatio || 1), W = innerWidth, H = innerHeight;
  cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!L) return;
  const top = $('#hud').getBoundingClientRect().bottom + 10, pad = 12;
  const availW = W - pad * 2, availH = H - top - pad - 20;
  const s = Math.min(availW / (L.cols + 0.3), availH / (L.rows + 0.3));
  view = { s, ox: (W - L.cols * s) / 2, oy: top + (availH - L.rows * s) / 2, W, H, dpr };
  prerender();
}
window.addEventListener('resize', () => setTimeout(resize, 120));

function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function prerender() {
  const { s, W, H, dpr, ox, oy } = view, tr = TIERS[cfg.tier];
  mazeCanvas = document.createElement('canvas'); mazeCanvas.width = W * dpr; mazeCanvas.height = H * dpr;
  const c = mazeCanvas.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
  // background
  const bg = c.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, Math.max(W, H)); bg.addColorStop(0, '#111830'); bg.addColorStop(1, '#05070d'); c.fillStyle = bg; c.fillRect(0, 0, W, H);
  // board
  c.save(); c.shadowColor = 'rgba(0,0,0,.7)'; c.shadowBlur = 30; c.shadowOffsetY = 12;
  const fl = c.createLinearGradient(ox, oy, ox + L.cols * s, oy + L.rows * s); fl.addColorStop(0, tr.floor[0]); fl.addColorStop(1, tr.floor[1]);
  c.fillStyle = fl; rr(c, ox - s * 0.15, oy - s * 0.15, L.cols * s + s * 0.3, L.rows * s + s * 0.3, s * 0.3); c.fill(); c.restore();
  // floor grid dots / ice streaks
  c.save(); c.beginPath(); c.rect(ox, oy, L.cols * s, L.rows * s); c.clip();
  if (cfg.tier === 3) { c.strokeStyle = 'rgba(255,255,255,.07)'; c.lineWidth = 2; const R = mulberry32(cfg.n); for (let i = 0; i < 40; i++) { const x = ox + R() * L.cols * s, y = oy + R() * L.rows * s; c.beginPath(); c.moveTo(x, y); c.lineTo(x + 20 + R() * 40, y - 10 - R() * 20); c.stroke(); } }
  c.fillStyle = 'rgba(255,255,255,.05)';
  for (let y = 0; y < L.rows; y++) for (let x = 0; x < L.cols; x++) { c.beginPath(); c.arc(ox + (x + .5) * s, oy + (y + .5) * s, Math.max(1, s * 0.04), 0, 7); c.fill(); }
  c.restore();
  // start pad
  c.fillStyle = 'rgba(56,232,255,.12)'; c.beginPath(); c.arc(ox + L.start.x * s, oy + L.start.y * s, s * 0.38, 0, 7); c.fill();
  c.strokeStyle = 'rgba(56,232,255,.35)'; c.setLineDash([4, 4]); c.lineWidth = 1.5; c.stroke(); c.setLineDash([]);
  // traps (static part)
  for (const t of L.traps) {
    const x = ox + t.x * s, y = oy + t.y * s, r = s * 0.3;
    const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, '#000'); g.addColorStop(0.7, '#120006'); g.addColorStop(1, '#ff3b5c');
    c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
    c.strokeStyle = 'rgba(255,59,92,.6)'; c.lineWidth = 2; c.stroke();
  }
  // walls: shadow pass then body then highlight
  const wr = s * 0.06;
  c.save(); c.fillStyle = 'rgba(0,0,0,.45)';
  for (const w of L.walls) { rr(c, ox + w[0] * s + 3, oy + w[1] * s + 4, (w[2] - w[0]) * s, (w[3] - w[1]) * s, wr); c.fill(); }
  c.restore();
  for (const w of L.walls) {
    const x = ox + w[0] * s, y = oy + w[1] * s, ww = (w[2] - w[0]) * s, hh = (w[3] - w[1]) * s;
    const g = c.createLinearGradient(x, y, x + ww, y + hh); g.addColorStop(0, '#dfe8ff'); g.addColorStop(1, '#7f8db3');
    c.fillStyle = cfg.tier === 3 ? '#bff6ff' : g; rr(c, x, y, ww, hh, wr); c.fill();
  }
  c.globalAlpha = .55; c.fillStyle = tr.color;
  for (const w of L.walls) { const x = ox + w[0] * s, y = oy + w[1] * s, ww = (w[2] - w[0]) * s, hh = (w[3] - w[1]) * s; rr(c, x, y, ww, Math.min(hh, 2), 1); c.fill(); }
  c.globalAlpha = 1;
}

/* ---------- Physics ---------- */
function collide() {
  const r = ball.r, cx = Math.floor(ball.x), cy = Math.floor(ball.y);
  if (cx < 0 || cy < 0 || cx >= L.cols || cy >= L.rows) { ball.x = Math.max(r, Math.min(L.cols - r, ball.x)); ball.y = Math.max(r, Math.min(L.rows - r, ball.y)); return; }
  for (const wi of L.buckets[cy * L.cols + cx]) {
    const w = L.walls[wi];
    const px = Math.max(w[0], Math.min(ball.x, w[2])), py = Math.max(w[1], Math.min(ball.y, w[3]));
    let dx = ball.x - px, dy = ball.y - py, d2 = dx * dx + dy * dy;
    if (d2 >= r * r) continue;
    let nx, ny, pen;
    if (d2 > 1e-10) { const d = Math.sqrt(d2); nx = dx / d; ny = dy / d; pen = r - d; }
    else { // center inside the wall: push out along the shortest axis
      const l = ball.x - w[0], rt = w[2] - ball.x, t = ball.y - w[1], b = w[3] - ball.y, m = Math.min(l, rt, t, b);
      [nx, ny, pen] = m === l ? [-1, 0, l + r] : m === rt ? [1, 0, rt + r] : m === t ? [0, -1, t + r] : [0, 1, b + r];
    }
    ball.x += nx * pen; ball.y += ny * pen;
    const vn = ball.vx * nx + ball.vy * ny;
    if (vn < 0) {
      const bounce = cfg.tier === 3 ? 0.45 : 0.32;
      ball.vx -= (1 + bounce) * vn * nx; ball.vy -= (1 + bounce) * vn * ny;
      if (-vn > 1.5) { sfx.clack(-vn); for (let i = 0; i < 4; i++) spark(ball.x - nx * r, ball.y - ny * r, '#fff'); }
    }
  }
}
function spark(x, y, col) { particles.push({ x, y, vx: (Math.random() - .5) * 4, vy: (Math.random() - .5) * 4, life: 0.4 + Math.random() * 0.3, col, sz: 1 + Math.random() * 2 }); }

function update(dt) {
  if (state === 'sinking') {
    sinkT += dt; ball.s = Math.max(0, 1 - sinkT / 0.45);
    ball.x += (sinkTarget.x - ball.x) * Math.min(1, dt * 12); ball.y += (sinkTarget.y - ball.y) * Math.min(1, dt * 12);
    if (sinkT > 0.5) sinkKind === 'goal' ? winLevel() : respawn();
    return;
  }
  if (state !== 'play') { setRoll(0); return; }
  elapsed = (performance.now() - t0) / 1000;
  const [ax, ay] = getAccel();
  ball.vx += ax * dt; ball.vy += ay * dt;
  const f = Math.exp(-cfg.friction * dt); ball.vx *= f; ball.vy *= f;
  const sp = Math.hypot(ball.vx, ball.vy), MAX = 14; if (sp > MAX) { ball.vx *= MAX / sp; ball.vy *= MAX / sp; }
  const steps = Math.min(12, Math.max(1, Math.ceil(sp * dt / (ball.r * 0.4))));
  for (let i = 0; i < steps; i++) { ball.x += ball.vx * dt / steps; ball.y += ball.vy * dt / steps; collide(); }
  ball.rot += sp * dt / ball.r;
  setRoll(sp);
  if (sp > 4 && Math.random() < 0.5) spark(ball.x, ball.y, TIERS[cfg.tier].color);
  // goal & traps
  if (Math.hypot(ball.x - L.goal.x, ball.y - L.goal.y) < 0.24) return sink(L.goal, 'goal');
  for (const t of L.traps) if (Math.hypot(ball.x - t.x, ball.y - t.y) < 0.2) return sink(t, 'trap');
  // gentle pull toward holes when close (feels like a real lip)
  for (const h of [L.goal, ...L.traps]) { const dx = h.x - ball.x, dy = h.y - ball.y, d = Math.hypot(dx, dy); if (d < 0.38) { ball.vx += dx / d * 6 * dt; ball.vy += dy / d * 6 * dt; } }
}
function sink(target, kind) {
  state = 'sinking'; sinkT = 0; sinkTarget = target; sinkKind = kind; setRoll(0);
  if (kind === 'goal') { sfx.win(); for (let i = 0; i < 60; i++) spark(target.x, target.y, ['#38e8ff', '#ff4fd8', '#ffd23f', '#2fd38a'][i % 4]); }
  else { sfx.plop(); falls++; toast(TRAP_LINES[Math.floor(Math.random() * TRAP_LINES.length)]); }
}
function respawn() { ball.x = L.start.x; ball.y = L.start.y; ball.vx = ball.vy = 0; ball.s = 1; state = 'play'; }

function winLevel() {
  state = 'won';
  const n = cfg.n, par = L.pathLen * 0.55 + 2.5;
  const stars = elapsed <= par ? 3 : elapsed <= par * 1.8 ? 2 : 1;
  const prevBest = save.best[n];
  save.stars[n] = Math.max(save.stars[n] || 0, stars);
  if (!prevBest || elapsed < prevBest) save.best[n] = +elapsed.toFixed(2);
  save.unlocked = Math.max(save.unlocked, n + 1); persist();
  $('#winTitle').textContent = n === LEVELS ? '🏆 YOU BEAT GRAVITY!' : WIN_LINES[Math.floor(Math.random() * WIN_LINES.length)];
  const nb = !prevBest || elapsed < prevBest;
  $('#winInfo').innerHTML = `Time <b>${elapsed.toFixed(2)}s</b>${nb ? ' 🎉 new best!' : ` · best ${prevBest.toFixed(2)}s`}<br>3★ par: ${par.toFixed(1)}s · Trap falls: ${falls}`;
  $('#btnNext').style.display = n < LEVELS ? '' : 'none';
  const sp = $('#winStars').children; [...sp].forEach(e => e.classList.remove('on'));
  $('#mWin').classList.add('show');
  for (let i = 0; i < stars; i++) setTimeout(() => { sp[i].classList.add('on'); sfx.star(i); }, 300 + i * 280);
}

/* ---------- Render ---------- */
function draw(time) {
  const { s, ox, oy, W, H } = view;
  ctx.clearRect(0, 0, W, H);
  if (mazeCanvas) ctx.drawImage(mazeCanvas, 0, 0, W, H);
  const X = x => ox + x * s, Y = y => oy + y * s, tr = TIERS[cfg.tier];
  // animated trap shimmer
  for (const t of L.traps) { ctx.strokeStyle = `rgba(255,59,92,${0.25 + 0.25 * Math.sin(time / 300 + t.x)})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X(t.x), Y(t.y), s * (0.36 + 0.03 * Math.sin(time / 250 + t.y)), 0, 7); ctx.stroke(); }
  // goal: swirling portal
  const gx = X(L.goal.x), gy = Y(L.goal.y), gr = s * 0.32;
  const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr * 2.2); glow.addColorStop(0, 'rgba(47,211,138,.55)'); glow.addColorStop(1, 'rgba(47,211,138,0)');
  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(gx, gy, gr * 2.2, 0, 7); ctx.fill();
  const hole = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr); hole.addColorStop(0, '#000'); hole.addColorStop(.75, '#04150d'); hole.addColorStop(1, '#2fd38a');
  ctx.fillStyle = hole; ctx.beginPath(); ctx.arc(gx, gy, gr, 0, 7); ctx.fill();
  ctx.save(); ctx.translate(gx, gy); ctx.rotate(time / 400); ctx.strokeStyle = 'rgba(160,255,210,.7)'; ctx.lineWidth = 2;
  for (let i = 0; i < 3; i++) { ctx.rotate(Math.PI * 2 / 3); ctx.beginPath(); ctx.arc(0, 0, gr * 0.7, 0, 1.2); ctx.stroke(); } ctx.restore();
  // little flag
  ctx.strokeStyle = '#ddd'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(gx + gr * .6, gy); ctx.lineTo(gx + gr * .6, gy - s * .75); ctx.stroke();
  ctx.fillStyle = '#ff4fd8'; ctx.beginPath(); const wv = Math.sin(time / 150) * 3; ctx.moveTo(gx + gr * .6, gy - s * .75); ctx.lineTo(gx + gr * .6 + s * .35, gy - s * .64 + wv); ctx.lineTo(gx + gr * .6, gy - s * .52); ctx.fill();
  // particles
  for (const p of particles) { ctx.globalAlpha = Math.max(0, p.life * 2); ctx.fillStyle = p.col; ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), p.sz, 0, 7); ctx.fill(); }
  ctx.globalAlpha = 1;
  // ball
  const bx = X(ball.x), by = Y(ball.y), br = s * ball.r * ball.s;
  if (br > 0.3) {
    const [ax, ay] = getAccel(), sx = -ax * 0.06, sy = -ay * 0.06; // shadow leans opposite the tilt
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.beginPath(); ctx.ellipse(bx + 3 + sx, by + 5 + sy, br * 1.05, br * 0.9, 0, 0, 7); ctx.fill();
    const bg = ctx.createRadialGradient(bx - br * .4, by - br * .45, br * .1, bx, by, br);
    bg.addColorStop(0, '#ffffff'); bg.addColorStop(.25, '#dfe6f2'); bg.addColorStop(.7, '#7c88a2'); bg.addColorStop(1, '#2b3346');
    ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(bx, by, br, 0, 7); ctx.fill();
    // rolling stripe so you can see it spin
    ctx.save(); ctx.beginPath(); ctx.arc(bx, by, br, 0, 7); ctx.clip();
    const ang = Math.atan2(ball.vy, ball.vx), off = Math.sin(ball.rot) * br;
    ctx.translate(bx, by); ctx.rotate(ang + Math.PI / 2); ctx.strokeStyle = 'rgba(56,232,255,.35)'; ctx.lineWidth = br * .25;
    ctx.beginPath(); ctx.moveTo(-br, off); ctx.lineTo(br, off); ctx.stroke(); ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.beginPath(); ctx.arc(bx - br * .38, by - br * .4, br * .18, 0, 7); ctx.fill();
  }
  // lights out
  if (cfg.dark) {
    const lr = cfg.light * s;
    const g = ctx.createRadialGradient(bx, by, lr * 0.25, bx, by, lr);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.97)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // goal beacon still peeks through the dark
    const p = 0.5 + 0.5 * Math.sin(time / 300);
    ctx.fillStyle = `rgba(47,211,138,${0.35 + 0.4 * p})`; ctx.beginPath(); ctx.arc(gx, gy, s * 0.14, 0, 7); ctx.fill();
  }
  // joystick indicator
  if (joy.on) { ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(joy.x0, joy.y0, 70, 0, 7); ctx.stroke(); ctx.fillStyle = 'rgba(56,232,255,.4)'; const dx = Math.max(-70, Math.min(70, joy.x - joy.x0)), dy = Math.max(-70, Math.min(70, joy.y - joy.y0)); ctx.beginPath(); ctx.arc(joy.x0 + dx, joy.y0 + dy, 22, 0, 7); ctx.fill(); }
}

function loop(t) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.033, (t - lastT) / 1000 || 0); lastT = t;
  if (!$('#game').classList.contains('show') || !L) return;
  update(dt);
  for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= .92; p.vy *= .92; p.life -= dt; }
  particles = particles.filter(p => p.life > 0);
  if (state === 'play') $('#hudTime').textContent = elapsed.toFixed(1) + 's';
  draw(t);
}
requestAnimationFrame(loop);

/* ---------- Pause & buttons ---------- */
let pausedAt = 0;
function pause() { if (state !== 'play') return; state = 'paused'; pausedAt = performance.now(); setRoll(0); $('#mPause').classList.add('show'); }
function resume() { $('#mPause').classList.remove('show'); t0 += performance.now() - pausedAt; countdownResume(); }
function countdownResume() { state = 'play'; if (save.autoCal) calibrate(); }
$('#btnPause').onclick = () => { sfx.click(); pause(); };
$('#btnResume').onclick = () => { sfx.click(); resume(); };
$('#btnRestart').onclick = () => { sfx.click(); startLevel(cfg.n); };
$('#btnQuit').onclick = () => { sfx.click(); $('#mPause').classList.remove('show'); state = 'idle'; setRoll(0); show('levels'); };
$('#btnCal').onclick = () => { calibrate(); tone(1200, .1, 'sine', .15); toast('Calibrated! This is "flat" now 📐'); };
$('#btnNext').onclick = () => { sfx.click(); startLevel(Math.min(LEVELS, cfg.n + 1)); };
$('#btnRetry').onclick = () => { sfx.click(); startLevel(cfg.n); };
$('#btnWinLevels').onclick = () => { sfx.click(); $('#mWin').classList.remove('show'); state = 'idle'; show('levels'); };
document.addEventListener('visibilitychange', async () => {
  if (document.hidden) { pause(); setRoll(0); }
  else if (wakeLock === null && $('#game').classList.contains('show')) { try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {} }
});

// home
$('#btnPlay').onclick = () => { sfx.click(); audioInit(); const next = Math.min(save.unlocked, LEVELS); startLevel(next); };
$('#btnLevels').onclick = () => { audioInit(); sfx.click(); show('levels'); };
$('#btnHow').onclick = () => { audioInit(); sfx.click(); show('how'); };
$('#btnSettings').onclick = () => { audioInit(); sfx.click(); syncSettings(); show('settings'); };

// settings
function syncSettings() {
  $('#swSound').classList.toggle('on', save.sound); $('#swCal').classList.toggle('on', save.autoCal); $('#swInv').classList.toggle('on', save.invert);
  $('#sensVal').textContent = Math.round(save.sens * 100) + '%';
}
$('#swSound').parentElement.onclick = () => { save.sound = !save.sound; persist(); syncSettings(); sfx.click(); };
$('#swCal').parentElement.onclick = () => { save.autoCal = !save.autoCal; persist(); syncSettings(); sfx.click(); };
$('#swInv').parentElement.onclick = () => { save.invert = !save.invert; persist(); syncSettings(); sfx.click(); };
$('#sensDown').onclick = e => { e.stopPropagation(); save.sens = Math.max(0.4, +(save.sens - 0.1).toFixed(1)); persist(); syncSettings(); sfx.click(); };
$('#sensUp').onclick = e => { e.stopPropagation(); save.sens = Math.min(2, +(save.sens + 0.1).toFixed(1)); persist(); syncSettings(); sfx.click(); };
$('#btnReset').onclick = () => { if (confirm('Erase ALL progress? The ball will forget everything. 😢')) { save.unlocked = 1; save.best = {}; save.stars = {}; persist(); homeStat(); toast('Fresh start!'); } };

// stop iOS rubber-band / double-tap zoom
document.addEventListener('touchmove', e => { if (!e.target.closest('#levelGrid,.howto')) e.preventDefault(); }, { passive: false });
document.addEventListener('dblclick', e => e.preventDefault());
document.addEventListener('gesturestart', e => e.preventDefault());

// best-effort orientation lock (Android/installed PWAs); iOS uses the CSS overlay + Control Center lock
try { screen.orientation?.lock?.('portrait').catch(() => {}); } catch {}

// service worker for offline play
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));

homeStat();
})();
