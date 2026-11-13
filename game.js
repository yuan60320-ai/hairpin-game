'use strict';
// core.js 提供: norm, angDiff, countOf, coverOf, isFree, buildPins, solve, generateLevel

const $ = id => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;
const CX = W / 2, CY = 300;
const GATE = 270; // 270° 为屏幕正上方的缺口
const TRAY_Y = H - 28;
const SLOT = 30;
const PALETTE = ['#e0557a', '#4f9dd8', '#5fb878', '#f2b544', '#9a6fd6', '#e0803a'];
const MATS = {
  gold:    ['#fff3c4', '#d9a441', '#7a5415'],
  silver:  ['#ffffff', '#bcc5cd', '#5d6670'],
  jade:    ['#e8fff5', '#7fc7a4', '#2f6b55'],
  lacquer: ['#ffe3d4', '#b5482e', '#5c1c10'],
  pearl:   ['#ffffff', '#efe7da', '#9d9182'],
};
const THEMES = {
  ink:    { a: '#fffaf0', b: '#e6d6b8', deco: 'rgba(160,130,90,0.16)', ring: '#b98a4e', hi: '#f3dca6', tray: 'rgba(120,90,50,0.18)', slot: 'rgba(120,90,50,0.3)', text: '#5b4d43' },
  spring: { a: '#fff6fa', b: '#f0cfdd', deco: 'rgba(214,120,150,0.22)', ring: '#b07a5a', hi: '#f7d9e6', tray: 'rgba(170,80,110,0.14)', slot: 'rgba(170,80,110,0.3)', text: '#6a4256' },
  night:  { a: '#34445f', b: '#111a27', deco: 'rgba(140,170,220,0.18)', ring: '#8c6d3f', hi: '#d9c08a', tray: 'rgba(200,220,255,0.12)', slot: 'rgba(200,220,255,0.3)', text: '#e8edf5' },
};

// 固定种子的装饰花瓣，保证每次刷新背景一致
const decor = (() => {
  let s = 7;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: 14 }, () => ({ x: r() * W, y: r() * H, r: 6 + r() * 10, sp: 0.3 + r() * 0.6, ph: r() * 6.28 }));
})();

let colorVals = PALETTE.slice();
let pins = [], tray = [], ringAngle = 0, cap = 7;
let won = false, failed = false, planKey = '';
let flying = [], merges = [], particles = [], auto = null, solution = [];
let track = null, recording = null, recStart = 0, playTimers = [];
let dot = null, lastNow = 0;
const drag = { active: false, moved: false, lastA: 0, sx: 0, sy: 0 };

let audioCtx = null, bgmNodes = null;

const settings = () => ({
  material: $('material').value,
  head: $('headShape').value,
  length: +$('pinLength').value,
  width: +$('pinWidth').value,
  ringR: +$('ringRadius').value,
  tol: +$('gateTol').value,
  extractMs: +$('extractMs').value,
  solveSpeed: +$('solveSpeed').value,
  ringSpeed: +$('ringSpeed').value,
  theme: THEMES[$('theme').value],
  effects: $('effects').checked,
});

const cover = () => coverOf(+$('gap').value);
const layoutKey = () => ['colorCount', 'pinsPerColor', 'layers', 'trayCap', 'gap', 'offset'].map(id => $(id).value).join('|');
const msg = t => { $('status').textContent = t; };
const ringPins = () => pins.filter(p => p.state === 'ring');
const worldAngle = p => norm(p.angle + ringAngle);
const dirOf = deg => [Math.cos(deg * Math.PI / 180), Math.sin(deg * Math.PI / 180)];
const trayPos = (i, n = cap) => ({ x: CX + (i - (n - 1) / 2) * SLOT, y: TRAY_Y });

function headPos(p) {
  const s = settings();
  const [dx, dy] = dirOf(worldAngle(p));
  const r = s.ringR - 6 + s.length;
  return { x: CX + dx * r, y: CY + dy * r };
}

function canExtract(p) {
  return !flying.length && p.state === 'ring' && isFree(ringPins(), p, cover())
    && (tray.length < cap || countOf(tray, p.kind) === 2);
}

// ---------- 音效（WebAudio 合成，无外部音频文件） ----------
const SFX = {
  pick:  [[660, 0.06, 'triangle']],
  land:  [[520, 0.05, 'sine'], [660, 0.07, 'sine']],
  tick:  [[180, 0.04, 'square']],
  match: [[660, 0.1, 'sine'], [880, 0.1, 'sine'], [1180, 0.22, 'sine']],
  win:   [[523, 0.14, 'sine'], [659, 0.14, 'sine'], [784, 0.14, 'sine'], [1047, 0.4, 'sine']],
  fail:  [[330, 0.16, 'sawtooth'], [220, 0.36, 'sawtooth']],
};

function ensureAudio() {
  if (audioCtx) return audioCtx;
  const C = window.AudioContext || window.webkitAudioContext;
  if (!C) return null;
  audioCtx = new C();
  return audioCtx;
}

function sfx(name) {
  if (!$('sfxOn').checked) return;
  const ac = ensureAudio();
  if (!ac) return;
  const vol = +$('sfxVol').value / 100 * 0.18;
  let t = ac.currentTime;
  for (const [freq, dur, wave] of SFX[name]) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = wave;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ac.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
    t += dur * 0.8;
  }
}

function setBgm(on) {
  const ac = ensureAudio();
  if (!ac) return;
  if (on && !bgmNodes) {
    const master = ac.createGain();
    master.gain.value = +$('sfxVol').value / 100 * 0.05;
    const notes = [196, 294, 392].map(f => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine'; o.frequency.value = f; g.gain.value = 0.5;
      o.connect(g).connect(master);
      o.start();
      return o;
    });
    master.connect(ac.destination);
    bgmNodes = { master, notes };
  } else if (!on && bgmNodes) {
    bgmNodes.notes.forEach(o => o.stop());
    bgmNodes.master.disconnect();
    bgmNodes = null;
  }
}

// ---------- 粒子与合成动画 ----------
function burst(x, y, color, n) {
  if (!settings().effects) return;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = 60 + Math.random() * 140;
    particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, life: 0.6 + Math.random() * 0.4, max: 1, color, r: 1.5 + Math.random() * 2.5 });
  }
}

function updateEffects(dt) {
  for (const p of particles) {
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 260 * dt; p.life -= dt;
  }
  particles = particles.filter(p => p.life > 0);
  for (const m of merges) m.age += dt;
  merges = merges.filter(m => m.age < m.dur);
}

// 三支同色合成：先把三支飞向中心，再闪光散开
function startMerge(kind, fromSlots) {
  merges.push({ kind, from: fromSlots, age: 0, dur: 1.0, burst: false });
}

function drawMerge(m) {
  const t = m.age / m.dur;
  const cx = CX, cy = TRAY_Y - 6;
  const pull = Math.min(1, t / 0.45);
  const e = pull * pull;
  for (const f of m.from) {
    const x = f.x + (cx - f.x) * e, y = f.y + (cy - f.y) * e;
    drawPin(settings(), colorVals[m.kind], x, y + 10, x, y - 8, 0.42 * (1 - 0.6 * e));
  }
  if (t >= 0.45 && !m.burst) {
    m.burst = true;
    burst(cx, cy, colorVals[m.kind], 26);
    sfx('match');
  }
  if (t >= 0.45) {
    const k = (t - 0.45) / 0.55;
    ctx.globalAlpha = 1 - k;
    ctx.strokeStyle = '#fff4b8';
    ctx.lineWidth = 4 * (1 - k) + 1;
    ctx.beginPath(); ctx.arc(cx, cy, 10 + 70 * k, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

// ---------- 游戏流程 ----------
function newGame() {
  stopPlayback();
  const cfg = {
    colorCount: +$('colorCount').value,
    pinsPerColor: +$('pinsPerColor').value,
    layers: +$('layers').value,
    trayCap: +$('trayCap').value,
    gap: +$('gap').value,
    offset: +$('offset').value,
  };
  const lv = generateLevel(cfg);
  if (!lv) { msg('当前参数无法生成可解关卡，请调整后重试'); return; }
  pins = lv.pins;
  solution = lv.plan;
  tray = [];
  cap = cfg.trayCap;
  ringAngle = 0;
  flying = [];
  merges = [];
  particles = [];
  auto = null;
  won = false;
  failed = false;
  planKey = layoutKey();
  msg('新关卡已生成，拖动圆环，把簪子转到顶部缺口后点击抽出');
}

function startFlight(p) {
  const h = headPos(p);
  p.state = 'flying';
  flying.push({ p, x: h.x, y: h.y, a: worldAngle(p), t0: performance.now(), dur: settings().extractMs, idx: tray.length });
  sfx('pick');
}

function finishFlight(f) {
  pins = pins.filter(q => q !== f.p);
  const before = tray.length;
  tray.push(f.p.kind);
  sfx('land');
  const pt = trayPos(before);
  burst(pt.x, pt.y, colorVals[f.p.kind], 8);
  if (countOf(tray, f.p.kind) === 3) {
    const slots = tray.map((k, i) => ({ k, i })).filter(x => x.k === f.p.kind).map(x => trayPos(x.i));
    tray = tray.filter(k => k !== f.p.kind);
    startMerge(f.p.kind, slots);
    msg('三支同色合成消除！');
  }
  if (!pins.length) { won = true; auto = null; sfx('win'); msg('恭喜通关！'); return; }
  const possible = ringPins().some(p => isFree(ringPins(), p, cover()) && (tray.length < cap || countOf(tray, p.kind) === 2));
  if (!possible) { failed = true; auto = null; sfx('fail'); msg('收纳槽已满且无法配对，本局失败，请新关卡'); }
}

function updateFlights(now) {
  const done = flying.filter(f => now - f.t0 >= f.dur);
  flying = flying.filter(f => now - f.t0 < f.dur);
  for (const f of done) finishFlight(f);
}

function tapGate() {
  if (won || failed || auto) return;
  const tol = settings().tol;
  let best = null, bestD = Infinity;
  for (const p of ringPins()) {
    const d = angDiff(worldAngle(p), GATE);
    if (d <= tol && d < bestD && canExtract(p)) { best = p; bestD = d; }
  }
  if (best) startFlight(best);
  else { sfx('tick'); msg('请把簪子转到顶部缺口再点击'); }
}

function handle(type, x, y) {
  const px = x * W, py = y * H;
  const a = Math.atan2(py - CY, px - CX) * 180 / Math.PI;
  if (type === 'down') {
    ensureAudio();
    drag.active = true; drag.moved = false; drag.lastA = a; drag.sx = px; drag.sy = py;
  } else if (type === 'move' && drag.active) {
    let d = a - drag.lastA;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    if (!auto) ringAngle = norm(ringAngle + d);
    drag.lastA = a;
    if (Math.hypot(px - drag.sx, py - drag.sy) > 6) drag.moved = true;
  } else if (type === 'up' && drag.active) {
    drag.active = false;
    if (!drag.moved) tapGate();
  }
}

function emit(type, pt) {
  if (recording) recording.push({ t: Math.round(performance.now() - recStart), type, x: +pt.x.toFixed(4), y: +pt.y.toFixed(4) });
  handle(type, pt.x, pt.y);
}

function normPoint(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
}

canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); emit('down', normPoint(e)); });
canvas.addEventListener('pointermove', e => { if (drag.active) emit('move', normPoint(e)); });
canvas.addEventListener('pointerup', e => emit('up', normPoint(e)));
canvas.addEventListener('pointercancel', e => emit('up', normPoint(e)));

// ---------- 自动解牌 ----------
function startAuto() {
  if (won || failed) return;
  if (!pins.length) { msg('请先新建关卡'); return; }
  stopPlayback();
  if (layoutKey() !== planKey) {
    msg('布局参数已修改，已按新参数重新生成关卡');
    newGame();
  }
  auto = { plan: null, idx: 0, replans: 0 };
  msg('自动解牌中');
}

function autoStep(dt, st) {
  if (won || failed) { auto = null; return; }
  if (flying.length) return;
  if (!auto.plan) {
    auto.plan = solve(ringPins(), cap, cover(), tray);
    auto.idx = 0;
    if (!auto.plan) { auto = null; msg('当前状态无解，请新建关卡'); return; }
  }
  while (auto.idx < auto.plan.length && !pins.some(p => p.id === auto.plan[auto.idx])) auto.idx++;
  if (auto.idx >= auto.plan.length) { auto = null; return; }
  const p = pins.find(q => q.id === auto.plan[auto.idx]);
  let d = norm(GATE - worldAngle(p)); if (d > 180) d -= 360;
  const step = st.solveSpeed * dt;
  if (Math.abs(d) <= Math.max(0.3, step)) {
    ringAngle = norm(ringAngle + d);
    if (canExtract(p)) { startFlight(p); auto.idx++; }
    else {
      auto.replans++;
      auto.plan = null;
      if (auto.replans > 5) { auto = null; msg('自动解牌多次被阻塞，请新建关卡'); }
    }
  } else {
    ringAngle = norm(ringAngle + Math.sign(d) * step);
  }
}

function stopPlayback() {
  playTimers.forEach(clearTimeout);
  playTimers = [];
  auto = null;
}

// ---------- 手指轨迹 ----------
function playFinger() {
  if (!track || !track.length) { msg('请先上传或录制手指轨迹'); return; }
  stopPlayback();
  for (const ev of track) {
    playTimers.push(setTimeout(() => { showDot(ev.x, ev.y); handle(ev.type, ev.x, ev.y); }, ev.t));
  }
  const end = Math.max(...track.map(e => e.t)) + 200;
  playTimers.push(setTimeout(() => msg('手指轨迹回放完成'), end));
  msg('正在回放手指轨迹');
}

const showDot = (x, y) => { dot = { x: x * W, y: y * H, t: performance.now() }; };

function toggleRecord() {
  const btn = $('recordBtn');
  if (!recording) {
    recording = [];
    recStart = performance.now();
    btn.textContent = '■ 停止录制';
    msg('录制中：在画面上拖动或点击');
  } else {
    track = recording;
    recording = null;
    btn.textContent = '● 开始录制';
    msg(`已录制 ${track.length} 个触点事件`);
  }
}

function exportRec() {
  if (!track || !track.length) { msg('没有可导出的轨迹'); return; }
  const url = URL.createObjectURL(new Blob([JSON.stringify(track, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'hairpin-finger-path.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 800);
}

function loadFingerFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const list = Array.isArray(data) ? data : data.steps;
      const ok = Array.isArray(list) && list.length && list.every(e =>
        Number.isFinite(e.t) && Number.isFinite(e.x) && Number.isFinite(e.y) &&
        ['down', 'move', 'up'].includes(e.type));
      if (!ok) throw new Error('bad');
      track = list.map(e => ({ t: Math.max(0, e.t), type: e.type, x: Math.max(0, Math.min(1, e.x)), y: Math.max(0, Math.min(1, e.y)) }));
      msg(`已导入 ${track.length} 个手指触点事件`);
    } catch (err) {
      msg('轨迹文件格式无效：需要 [{t,type,x,y}] 数组');
    }
  };
  reader.readAsText(file);
}

// ---------- 绘制 ----------
function drawPin(st, color, bx, by, hx, hy, s) {
  const mat = MATS[st.material];
  const w = Math.max(1, st.width * s);
  const a = Math.atan2(hy - by, hx - bx);
  const ox = -Math.sin(a) * w * 0.25, oy = Math.cos(a) * w * 0.25;
  ctx.lineCap = 'round';
  ctx.strokeStyle = mat[2];
  ctx.lineWidth = w + 1.5 * s;
  ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(hx, hy); ctx.stroke();
  ctx.strokeStyle = mat[1];
  ctx.lineWidth = w;
  ctx.stroke();
  ctx.strokeStyle = mat[0];
  ctx.lineWidth = Math.max(1, w * 0.3);
  ctx.beginPath(); ctx.moveTo(bx + ox, by + oy); ctx.lineTo(hx + ox, hy + oy); ctx.stroke();

  const size = st.width * 2.6 * s + 6 * s;
  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(a + Math.PI / 2);
  ctx.fillStyle = color;
  ctx.strokeStyle = mat[2];
  ctx.lineWidth = Math.max(1, 1.2 * s);
  if (st.head === 'ball') {
    ctx.beginPath(); ctx.arc(0, 0, size * 0.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath(); ctx.arc(-size * 0.2, -size * 0.2, size * 0.18, 0, Math.PI * 2); ctx.fill();
  } else if (st.head === 'drop') {
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.9);
    ctx.bezierCurveTo(size * 0.7, -size * 0.2, size * 0.6, size * 0.6, 0, size * 0.6);
    ctx.bezierCurveTo(-size * 0.6, size * 0.6, -size * 0.7, -size * 0.2, 0, -size * 0.9);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  } else {
    for (let i = 0; i < 5; i++) {
      ctx.save();
      ctx.rotate((i - 2) * 0.5);
      ctx.beginPath();
      ctx.ellipse(0, -size * 0.5, size * 0.3, size * 0.52, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = mat[0];
    ctx.beginPath(); ctx.arc(0, 0, size * 0.22, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawBackground(now, th) {
  const g = ctx.createRadialGradient(CX, CY - 40, 40, CX, CY, 340);
  g.addColorStop(0, th.a);
  g.addColorStop(1, th.b);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = th.deco;
  for (const d of decor) {
    const sway = Math.sin(now / 1000 * d.sp + d.ph) * 10;
    ctx.beginPath();
    ctx.ellipse(d.x + sway, (d.y + now / 60 * d.sp) % H, d.r, d.r * 0.55, d.ph, 0, Math.PI * 2);
    ctx.fill();
  }
}

function draw(now) {
  const st = settings();
  const th = st.theme;
  ctx.clearRect(0, 0, W, H);
  drawBackground(now, th);

  ctx.beginPath(); ctx.arc(CX, CY, st.ringR, 0, Math.PI * 2);
  ctx.strokeStyle = th.ring; ctx.lineWidth = 12; ctx.stroke();
  ctx.beginPath(); ctx.arc(CX, CY, st.ringR, 0, Math.PI * 2);
  ctx.strokeStyle = th.hi; ctx.lineWidth = 4; ctx.stroke();

  const gy = CY - st.ringR;
  ctx.fillStyle = '#c0392b';
  ctx.beginPath(); ctx.moveTo(CX - 9, gy - 22); ctx.lineTo(CX + 9, gy - 22); ctx.lineTo(CX, gy - 8);
  ctx.closePath(); ctx.fill();

  const r0 = st.ringR - 6;
  ringPins().slice().sort((a, b) => a.layer - b.layer).forEach(p => {
    const [dx, dy] = dirOf(worldAngle(p));
    const h = headPos(p);
    drawPin(st, colorVals[p.kind], CX + dx * r0, CY + dy * r0, h.x, h.y, 1);
  });

  for (const f of flying) {
    const t = Math.min(1, (now - f.t0) / f.dur);
    const e = 1 - Math.pow(1 - t, 3);
    const tp = trayPos(f.idx);
    const hx = f.x + (tp.x - f.x) * e, hy = f.y + (tp.y - f.y) * e;
    let d = norm(90 - f.a); if (d > 180) d -= 360;
    const ang = f.a + d * e;
    const s = 1 - 0.45 * e;
    const [dx, dy] = dirOf(ang);
    drawPin(st, colorVals[f.p.kind], hx - dx * st.length * s, hy - dy * st.length * s, hx, hy, s);
  }

  const tw = cap * SLOT + 12;
  ctx.fillStyle = th.tray;
  ctx.fillRect(CX - tw / 2, TRAY_Y - 22, tw, 44);
  for (let i = 0; i < cap; i++) {
    const tp = trayPos(i);
    if (i < tray.length) {
      drawPin(st, colorVals[tray[i]], tp.x, tp.y + 10, tp.x, tp.y - 8, 0.42);
    } else {
      ctx.strokeStyle = th.slot;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.arc(tp.x, tp.y, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  for (const m of merges) drawMerge(m);

  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  if (dot) {
    const age = performance.now() - dot.t;
    if (age < 450) {
      ctx.globalAlpha = 1 - age / 450;
      ctx.font = '30px sans-serif';
      ctx.fillText('👆', dot.x - 8, dot.y + 10);
      ctx.globalAlpha = 1;
    } else dot = null;
  }
}

function frame(now) {
  const dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0;
  lastNow = now;
  const st = settings();
  if (!auto && !drag.active && st.ringSpeed > 0 && !won && !failed) {
    ringAngle = norm(ringAngle + st.ringSpeed * dt);
  }
  if (auto) autoStep(dt, st);
  updateFlights(now);
  updateEffects(dt);
  draw(now);
  requestAnimationFrame(frame);
}

// ---------- 控件 ----------
function renderColors() {
  const box = $('colors');
  const n = +$('colorCount').value;
  box.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const input = document.createElement('input');
    input.type = 'color';
    input.value = colorVals[i];
    input.title = `颜色 ${i + 1}`;
    input.addEventListener('input', e => { colorVals[i] = e.target.value; });
    box.append(input);
  }
}

function bindSlider(id, outId) {
  const el = $(id), out = $(outId);
  const sync = () => { out.textContent = el.value; };
  el.addEventListener('input', sync);
  sync();
}

['colorCount', 'layers', 'trayCap', 'gap', 'offset', 'pinLength', 'pinWidth', 'ringRadius', 'ringSpeed', 'gateTol', 'extractMs', 'solveSpeed', 'sfxVol']
  .forEach(id => bindSlider(id, id + 'Out'));
$('colorCount').addEventListener('input', renderColors);
$('bgmOn').addEventListener('change', e => setBgm(e.target.checked));
$('sfxVol').addEventListener('input', () => { if (bgmNodes) bgmNodes.master.gain.value = +$('sfxVol').value / 100 * 0.05; });
$('newGame').addEventListener('click', newGame);
$('autoSolve').addEventListener('click', startAuto);
$('stopAuto').addEventListener('click', () => { stopPlayback(); msg('已停止自动'); });
$('playFinger').addEventListener('click', playFinger);
$('recordBtn').addEventListener('click', toggleRecord);
$('exportRec').addEventListener('click', exportRec);
$('fingerFile').addEventListener('change', e => { if (e.target.files[0]) loadFingerFile(e.target.files[0]); e.target.value = ''; });
document.querySelector('label[for="fingerFile"]').addEventListener('click', () => $('fingerFile').click());

renderColors();
newGame();
requestAnimationFrame(frame);
