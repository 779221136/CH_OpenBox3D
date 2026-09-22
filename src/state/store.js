// 全局状态：单一 store（setState 式更新 + 订阅），字段与原型一致
import { useSyncExternalStore } from 'react';
import { MATS } from '../dieline/templates.js';
import { geomOf } from '../dieline/geom.js';
import { heroPanelOf, placeHeroPresets } from '../dieline/hero.js';
import { legacyAppearance, paperPreset, filmPreset } from '../render3d/presets.js';
import { scenePreset, rigToStorePatch } from '../render3d/rig.js';

const qp = new URLSearchParams(location.search);
const legacy3d = legacyAppearance(qp.get('mat3d') || 'sbs');
const initialPaper = qp.get('paper') || legacy3d[0], initialFilm = qp.get('film') || legacy3d[1];
const paper0 = paperPreset(initialPaper), film0 = filmPreset(initialFilm);
const rig0 = scenePreset(qp.get('studio') || 'lab-default'); // 默认场景即内置 lab-default（原「候选21」红棚参数固化）；旧 id neutral/high-key/dark-craft 仍兼容
const initial = {
  view: qp.get('view') || 'structure', tpl: qp.get('tpl') || 'rte', L: 80, W: 40, H: 120, matId: 'sbs350', bleed: 3, glue: 14,
  custom: null,
  show: { bleed: true, safe: true, dims: true, labels: true },
  k: 2.2, tx: 160, ty: 200,
  fold: qp.has('fold') ? +qp.get('fold') : 24, foldFromQuery: qp.has('fold'), mat3d: qp.get('mat3d') || 'sbs', paper3d: initialPaper, film3d: initialFilm,
  surfaceRoughness: paper0.roughness, grainStrength: paper0.grainStrength, grainScale: paper0.grainMm,
  filmClearcoat3d: film0.clearcoat, filmClearcoatRoughness3d: film0.clearcoatRoughness, filmRoughnessFactor3d: film0.roughnessFactor, filmSheen3d: film0.sheen,
  foilMetalness3d: 1, foilRoughness3d: 0.22, foilColor3d: '#ffdb91', silverColor3d: '#faf7f2', holoColor3d: '#edf1f6', iridescence3d: 0, paperTint3d: '', holoSpan3d: qp.has('holoSpan') ? +qp.get('holoSpan') : 0.5, holoRainbow3d: qp.has('holoRainbow') ? +qp.get('holoRainbow') : 0, uvClearcoat3d: 1, uvRoughness3d: 0.05, glossRoughness3d: 0.08,
  embSharpness3d: 0.85, embNormalStrength3d: 1.2, embDisplacementStrength3d: 0.35,
  fx: { foil: qp.get('foil') !== '0', suv: qp.get('suv') === '1', gloss: qp.get('gloss') !== '0', emb: qp.has('emb') }, spin: qp.get('spin') === '1',
  check: qp.get('check') || 'art',
  ...rigToStorePatch(rig0),
  cameraProjection3d: qp.get('projection') === 'orthographic' ? 'orthographic' : rig0.camera.projection,
  environment3d: qp.get('hdri') || rig0.environment.source, stage3d: qp.get('stage') || rig0.stage,
  expo3d: qp.has('expo') ? +qp.get('expo') : rig0.tone.exposure,
  editMode: false, ovr: {}, typeOvr: {}, selSeg: null,
  pdfMode: 'cmyk',
  projectThumbnail: '',
  fitNonce: 0,
  embDepth: 0.3, embDir: 'up', embBoost: qp.get('embBoost') === '1',
  uiCrop: false,
  sel: null, seq: 1,
  layers: [] // 默认不带预设图层，设计页从空白开始（?heroTest/?embTest/?surfaceTest 调试场景仍注入测试图层）
};

if (qp.get('heroTest') === '1') initial.layers = [
  { id: 1, kind: 'text', x: 0, y: 0, content: '↑', font: 'Noto Sans SC', size: 13, weight: 700, color: '#d8342a', finish: 'none', visible: true, heroPreset: { cx: 0.5, cy: 0.2, size: 13, fitChars: 3 } },
  { id: 2, kind: 'text', x: 0, y: 0, content: 'L', font: 'JetBrains Mono', size: 10, weight: 700, color: '#1c6ee0', finish: 'none', visible: true, heroPreset: { cx: 0.22, cy: 0.52, size: 10, fitChars: 3 } },
  { id: 3, kind: 'text', x: 0, y: 0, content: 'R', font: 'JetBrains Mono', size: 10, weight: 700, color: '#2e8b57', finish: 'none', visible: true, heroPreset: { cx: 0.78, cy: 0.52, size: 10, fitChars: 3 } },
  { id: 4, kind: 'text', x: 0, y: 0, content: '07', font: 'JetBrains Mono', size: 8, weight: 700, color: '#211d18', finish: 'none', visible: true, heroPreset: { cx: 0.5, cy: 0.84, size: 8, fitChars: 4 } }
];
if (qp.get('embTest') === '1') {
  initial.layers = [
    { id: 1, kind: 'shape', x: 0, y: 0, w: 1, h: 1, content: '击凸底层', finish: 'emboss', embDir: 'up', visible: true, heroPreset: { x: 0.18, y: 0.25, w: 0.52, h: 0.44 } },
    { id: 2, kind: 'shape', x: 0, y: 0, w: 1, h: 1, content: '击凹顶层', finish: 'emboss', embDir: 'down', visible: true, heroPreset: { x: 0.46, y: 0.43, w: 0.36, h: 0.36 } }
  ];
  initial.fx = { ...initial.fx, emb: true }; initial.sel = 2; initial.seq = 3;
}
if (qp.get('surfaceTest') === 'uv') {
  initial.layers = [
    { id: 1, kind: 'text', x: 0, y: 0, content: 'LOCAL UV', font: 'JetBrains Mono', size: 7, weight: 700, color: '#403b36', finish: 'none', visible: true, heroPreset: { cx: 0.5, cy: 0.25, size: 7, fitChars: 10 } },
    { id: 2, kind: 'shape', x: 0, y: 0, w: 1, h: 1, content: '普通印刷对照', color: '#8c8378', finish: 'none', visible: true, heroPreset: { x: 0.16, y: 0.43, w: 0.28, h: 0.24 } },
    { id: 3, kind: 'shape', x: 0, y: 0, w: 1, h: 1, content: '局部UV', color: '#8c8378', finish: 'uv', visible: true, heroPreset: { x: 0.56, y: 0.43, w: 0.28, h: 0.24 } }
  ];
  initial.fx = { ...initial.fx, foil: false, suv: true }; initial.sel = 3; initial.seq = 4;
}
// ?holoTest=1：正面大半版镭射 + 局部镭射块，回归幻彩色谱用
if (qp.get('holoTest') === '1') {
  initial.layers = [
    { id: 1, kind: 'shape', x: 0, y: 0, w: 1, h: 1, content: '镭射整版', color: '#c8c2b8', finish: 'holo', visible: true, heroPreset: { x: 0.08, y: 0.08, w: 0.84, h: 0.6 } },
    { id: 2, kind: 'shape', x: 0, y: 0, w: 1, h: 1, content: '镭射局部', color: '#c8c2b8', finish: 'holo', visible: true, heroPreset: { x: 0.3, y: 0.74, w: 0.4, h: 0.18 } }
  ];
  initial.iridescence3d = 0.85; initial.sel = 1; initial.seq = 3;
}
// ?key= 兼容：旧链接用扁平 keyAngle 指定主光方位，v2 改写 lightsSpec3d 中 key 灯的 azimuth
if (qp.has('key')) {
  const kv = +qp.get('key');
  try {
    const ls = JSON.parse(initial.lightsSpec3d);
    const key = ls.find(x => x.id === 'key') || ls.find(x => x.shadow) || ls.find(x => x.type === 'directional');
    if (Number.isFinite(kv) && key) { key.azimuth = kv; initial.lightsSpec3d = JSON.stringify(ls); }
  } catch (_) { /* lightsSpec3d 损坏则忽略兼容参数 */ }
}
initial.layers = placeHeroPresets(initial.layers, heroPanelOf(geomOf(initial, MATS[0].t)));

let state = initial;
const listeners = new Set();
const cloneInitial = () => structuredClone(initial);

// 设计图层撤销/重做：仅跟踪 layers/seq 引用快照（图层对象一律不可变更新，快照零拷贝）。
// 连续编辑（拖拽/滑杆）按「距上次入栈 >400ms 才新入一帧」节流，入栈内容 = 变更前快照；
// reset（导入工程/重置示例盒）清空历史。
const HIST_MAX = 60, HIST_GAP = 400;
let histPast = [], histFuture = [], histLast = 0;
const frame = () => ({ layers: state.layers, seq: state.seq });

export const store = {
  get: () => state,
  set(patch) {
    const p = typeof patch === 'function' ? patch(state) : patch;
    if (!p) return;
    if (Object.prototype.hasOwnProperty.call(p, 'layers')) {
      const now = Date.now();
      if (now - histLast > HIST_GAP) { histPast.push(frame()); if (histPast.length > HIST_MAX) histPast.shift(); }
      histLast = now;
      histFuture = [];
    }
    state = { ...state, ...p };
    listeners.forEach(l => l());
  },
  undo() {
    if (!histPast.length) return;
    histFuture.push(frame());
    const f = histPast.pop();
    histLast = 0; // 撤销后的再次编辑强制新入一帧
    state = { ...state, layers: f.layers, seq: f.seq, sel: f.layers.some(l => l.id === state.sel) ? state.sel : null };
    listeners.forEach(l => l());
  },
  redo() {
    if (!histFuture.length) return;
    histPast.push(frame());
    const f = histFuture.pop();
    histLast = 0;
    state = { ...state, layers: f.layers, seq: f.seq, sel: f.layers.some(l => l.id === state.sel) ? state.sel : null };
    listeners.forEach(l => l());
  },
  histDepth: () => [histPast.length, histFuture.length],
  reset(patch = {}) {
    histPast = []; histFuture = []; histLast = 0;
    state = { ...cloneInitial(), ...patch };
    listeners.forEach(l => l());
  },
  subscribe(l) { listeners.add(l); return () => listeners.delete(l); },
  mat() { return MATS.find(m => m.id === state.matId) || MATS[0]; }
};

export function useStore() {
  return useSyncExternalStore(store.subscribe, store.get);
}
