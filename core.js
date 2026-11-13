'use strict';
// 间隙 gap(0~12°)：同层簪子之间的角度空隙，越大外层簪子遮挡的内层越少
// 错位 offset(0~20°)：每个上层相对底层的随机旋转偏移，形成错落感
// 层数 layers：簪子分成几层叠放，越高的层越先被取出

const norm = a => ((a % 360) + 360) % 360;
const angDiff = (a, b) => {
  const d = Math.abs(norm(a) - norm(b));
  return Math.min(d, 360 - d);
};
const countOf = (arr, kind) => arr.reduce((n, x) => n + (x === kind ? 1 : 0), 0);

function coverOf(gap) {
  return Math.max(2, 14 - gap);
}

// 上层簪子在 cover 角度内会遮住下层簪子
function isFree(ringPins, p, cover) {
  return !ringPins.some(q => q.layer > p.layer && angDiff(q.angle, p.angle) < cover);
}

function buildPins({ colorCount, pinsPerColor, layers, offset }) {
  const total = colorCount * pinsPerColor;
  const base = Math.ceil(total / layers);
  const pins = [];
  let id = 0;
  for (let layer = 0; layer < layers; layer++) {
    const n = Math.min(base, total - pins.length);
    if (n <= 0) break;
    const step = 360 / n;
    const phase = Math.random() * 360;
    const shift = layer === 0 ? 0 : (Math.random() * 2 - 1) * offset;
    for (let i = 0; i < n; i++) {
      pins.push({ id: id++, layer, angle: norm(phase + shift + i * step), kind: 0, state: 'ring' });
    }
  }
  const kinds = [];
  for (let k = 0; k < colorCount; k++) for (let j = 0; j < pinsPerColor; j++) kinds.push(k);
  for (let i = kinds.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
  }
  pins.forEach((p, i) => { p.kind = kinds[i]; });
  return pins;
}

// 随机贪心求解：返回按顺序抽出的 pin id 列表，无解返回 null
function solve(ringPins, cap, cover, initTray = []) {
  for (let attempt = 0; attempt < 120; attempt++) {
    const left = ringPins.map(p => ({ ...p }));
    const tray = [...initTray];
    const plan = [];
    let stuck = false;
    while (left.length) {
      const ready = left.filter(p => isFree(left, p, cover) && (tray.length < cap || countOf(tray, p.kind) === 2));
      if (!ready.length) { stuck = true; break; }
      const inTray = ready.filter(p => countOf(tray, p.kind) > 0);
      const pool = inTray.length ? inTray : ready;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      left.splice(left.indexOf(pick), 1);
      plan.push(pick.id);
      tray.push(pick.kind);
      if (countOf(tray, pick.kind) === 3) {
        for (let i = tray.length - 1; i >= 0; i--) if (tray[i] === pick.kind) tray.splice(i, 1);
      }
    }
    if (!stuck) return plan;
  }
  return null;
}

// 只返回已验证可解的牌阵，附带解法顺序
function generateLevel(cfg) {
  const cover = coverOf(cfg.gap);
  for (let i = 0; i < 40; i++) {
    const pins = buildPins(cfg);
    const plan = solve(pins, cfg.trayCap, cover);
    if (plan) return { pins, plan };
  }
  return null;
}
