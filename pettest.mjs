// 宠物逻辑自检：用假 DOM 跑 index.html 里的走动动画，验证移动/转身/停顿/边界（无需网络）
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const els = new Map();
function el(id) {
  if (!els.has(id)) {
    els.set(id, {
      id, textContent: '', innerHTML: '', title: '', dataset: {}, style: {},
      offsetWidth: id === 'pet' ? 38 : 0,
      classList: {
        _s: new Set(),
        add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
        toggle(c, v) { v ? this._s.add(c) : this._s.delete(c); },
        contains(c) { return this._s.has(c); },
      },
      attrs: {},
      setAttribute(k, v) { this.attrs[k] = v; },
      getAttribute(k) { return this.attrs[k]; },
      addEventListener() {},
    });
  }
  return els.get(id);
}
const sandbox = {
  console, Date, Math,
  document: {
    getElementById: (id) => el(id),
    querySelectorAll: () => [],
    body: { addEventListener() {}, setAttribute() {}, getAttribute() { return null; } },
    documentElement: { clientWidth: 384 },
  },
  window: {
    widget: {
      onData: () => {}, onPinned: () => {}, onMode: () => {}, onOpenConfig: () => {},
      onPet: (cb) => { sandbox.__petCb = cb; }, act: () => {},
    },
  },
  setTimeout: () => 0, clearTimeout: () => {},
  setInterval: () => 0, clearInterval: () => {},
  requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
};
sandbox.globalThis = sandbox;

const html = fs.readFileSync(path.join(ROOT, 'widget', 'index.html'), 'utf8');
const code = html.split('<script>')[1].split('</script>')[0];
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

const petFrame = sandbox.petFrame;
if (typeof petFrame !== 'function') throw new Error('petFrame 未定义');

// 开启宠物（主进程通过 onPet 下发）
sandbox.__petCb(true);

const petEl = el('pet');
const imgEl = el('petImg');

// 60fps 仿真 30 秒
const xs = [];
let dirFlips = 0, idleFrames = 0, lastDir = null;
const FPS = 60;
const STEP = 1000 / FPS;
for (let i = 0; i <= 30 * FPS; i++) {
  const ts = i * STEP;
  petFrame(ts);
  const tr = petEl.style.transform || '';
  const m = tr.match(/translate3d\(([-\d.]+)px/);
  const x = m ? Number(m[1]) : NaN;
  const dir = tr.includes('scaleX(-1)') ? -1 : 1;
  if (lastDir !== null && dir !== lastDir) dirFlips++;
  lastDir = dir;
  if (imgEl.classList.contains('idle')) idleFrames++;
  xs.push(x);
}

const min = Math.min(...xs), max = Math.max(...xs);
const moved = max - min;
const uniq = new Set(xs.map((v) => v.toFixed(2))).size;

const checks = {
  '位置随时间变化（非静止）': uniq > 50 && moved > 200,
  '到达左右边界后转身（≥2 次）': dirFlips >= 2,
  '不越过活动区边界': xs.every((v) => v >= 9.9 && v <= 324.1),
  '有随机停顿时长（idle 帧>0）': idleFrames > 0,
  '停顿时收起步态浮动（.idle 类）': idleFrames > 0 && imgEl.classList.contains('idle') !== undefined,
  '边界范围符合规格(min≈10,max≈324)': min <= 11 && max >= 323,
};

const out = {
  frames: xs.length,
  xMin: +min.toFixed(2), xMax: +max.toFixed(2), travelled: +moved.toFixed(1),
  uniquePositions: uniq, directionFlips: dirFlips, idleFrames,
  idleSeconds: +(idleFrames / FPS).toFixed(2),
  checks,
  pass: Object.values(checks).every(Boolean),
};
console.log(JSON.stringify(out, null, 2));
if (!out.pass) process.exitCode = 1;
