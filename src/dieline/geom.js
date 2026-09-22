// 几何求值：刀版几何是全系统唯一权威数据。
// 2D 视图、3D 网格、PDF 导出全部由本函数派生；按参数 key 缓存。
// 手动编辑存为覆盖指令流（ovr 节点位移、typeOvr 线型切换），在模板求值结果上重放。
import { genTuck, genMailer, genTray, genSleeve, genTube } from './templates.js';

let _key = null, _val = null, _custom = null;

export function geomOf(s, t) {
  const key = [s.tpl, s.L, s.W, s.H, t, s.bleed, s.glue].join('|') + '|' + JSON.stringify(s.ovr || {}) + JSON.stringify(s.typeOvr || {});
  const custom = s.tpl === 'custom' ? s.custom : null;
  if (_key === key && _custom === custom) return _val;
  const r2 = v => Math.round(v * 100) / 100;
  const o = { segs: [], fills: [], panels: [], safes: [], labels: [], dims: [], arcRuns: [], sbb: [1e9, 1e9, -1e9, -1e9], vbb: [1e9, 1e9, -1e9, -1e9] };
  const tr = (pts, bb) => { for (const p of pts) { if (p[0] < bb[0]) bb[0] = p[0]; if (p[1] < bb[1]) bb[1] = p[1]; if (p[0] > bb[2]) bb[2] = p[0]; if (p[1] > bb[3]) bb[3] = p[1]; } };
  const cut = pts => { tr(pts, o.sbb); tr(pts, o.vbb); o.segs.push({ t: 'cut', pts }); };
  const crease = pts => { tr(pts, o.sbb); tr(pts, o.vbb); o.segs.push({ t: 'crease', pts }); };
  const fill = pts => { tr(pts, o.sbb); tr(pts, o.vbb); o.fills.push(pts); };
  // panel 用于“板件填充 + 可设计面”同时生成；region 仅登记可设计面，
  // 供已经由模板写入 fills 的主体板复用，避免为了补面板语义重复填充。
  const region = (pts, meta) => { tr(pts, o.sbb); tr(pts, o.vbb); o.panels.push({ role: 'design', surface: 'outside', ...meta, pts }); };
  const panel = (pts, meta) => { fill(pts); region(pts, meta); };
  const safeR = (x, y, w, h, m) => { m = m ?? Math.min(3, w / 4, h / 4); o.safes.push([x + m, y + m, w - 2 * m, h - 2 * m]); };
  const label = (x, y, name, fs) => o.labels.push({ x: r2(x), y: r2(y + 1.4), name, fs: fs || 4 });
  const dimH = (x1, x2, y, txt) => { o.dims.push({ gtf: 'translate(' + r2(x1) + ' ' + r2(y) + ')', len: r2(x2 - x1), mid: r2((x2 - x1) / 2), label: txt }); tr([[x1, y - 5], [x2, y + 3]], o.vbb); };
  const dimV = (y1, y2, x, txt) => { o.dims.push({ gtf: 'translate(' + r2(x) + ' ' + r2(y2) + ') rotate(-90)', len: r2(y2 - y1), mid: r2((y2 - y1) / 2), label: txt }); tr([[x - 5, y1], [x + 3, y2]], o.vbb); };
  // 二次贝塞尔采样；带 tag 的调用记录为圆弧段（arcRuns 圆弧元数据）
  const q = (p0, pc, p1, tag, n) => {
    n = n || 5; const out = [];
    for (let i = 0; i <= n; i++) { const u = i / n, a = (1 - u) * (1 - u), b = 2 * u * (1 - u), c2 = u * u; out.push([a * p0[0] + b * pc[0] + c2 * p1[0], a * p0[1] + b * pc[1] + c2 * p1[1]]); }
    if (tag) o.arcRuns.push({ pts: out, p0, pc, p1 });
    return out;
  };
  const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const fmt = v => Math.round(v * 10) / 10;
  const ctx = { cut, crease, fill, panel, region, safeR, label, dimH, dimV, q, rect, fmt };

  if (s.tpl === 'custom') {
    if (!s.custom?.panels?.length) throw new Error('请先在盒型库导入 DXF 文件。');
    s.custom.segs.forEach(sg => (sg.t === 'cut' ? cut : crease)(sg.pts.map(p => [...p])));
    s.custom.panels.forEach((p, i) => {
      region(p.pts, { ...p, role: p.panelId === s.custom.root ? 'hero' : 'design' });
      const bb = p.pts.reduce((b, q) => [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[0]), Math.max(b[3], q[1])], [Infinity, Infinity, -Infinity, -Infinity]);
      label(...(p.label || [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2]), '面 ' + (i + 1));
    });
    (s.custom.contours || s.custom.panels).forEach(p => { fill(p.pts); (p.holes || []).forEach(fill); });
    dimH(o.sbb[0], o.sbb[2], o.sbb[3] + 12, fmt(o.sbb[2] - o.sbb[0]));
    dimV(o.sbb[1], o.sbb[3], o.sbb[2] + 12, fmt(o.sbb[3] - o.sbb[1]));
  } else if (s.tpl === 'rte' || s.tpl === 'ste') genTuck(ctx, s, t, s.tpl === 'rte');
  else if (s.tpl === 'mailer') genMailer(ctx, s, t);
  else if (s.tpl === 'cyl') genTube(ctx, s, t, 24, Math.PI * s.L / 24);
  else if (s.tpl === 'hex') genTube(ctx, s, t, 6, s.W);
  else if (s.tpl === 'lidbase') {
    const w1 = genTray(ctx, s.L, s.W, s.H, 0, '底盒', { prefix: 'base', centerId: 'base-bottom' });
    genTray(ctx, s.L + 2 * t + 1, s.W + 2 * t + 1, Math.max(14, s.H * 0.45), w1 + 28, '盒盖（+1mm/边 放量）', { prefix: 'lid', centerId: 'lid-top', centerMeta: { role: 'hero', surface: 'outside', up: 'top' } });
  } else if (s.tpl === 'drawer') {
    const w1 = genTray(ctx, s.L, s.W, s.H, 0, '内盒（抽屉）', { prefix: 'drawer', centerId: 'drawer-bottom' });
    genSleeve(ctx, s, t, w1 + 28);
  }

  // 覆盖指令流重放：线型切换、节点位移（位移就地修改，保持点对象引用——arcRuns 圆弧还原依赖引用同一性）
  Object.entries(s.tpl === 'custom' ? {} : s.typeOvr || {}).forEach(pair => { const sg = o.segs[+pair[0]]; if (sg) sg.t = pair[1]; });
  Object.entries(s.tpl === 'custom' ? {} : s.ovr || {}).forEach(pair => {
    const ix = pair[0].split('-'), sg = o.segs[+ix[0]];
    if (sg && sg.pts[+ix[1]]) { const q2 = sg.pts[+ix[1]]; q2[0] += pair[1][0]; q2[1] += pair[1][1]; }
  });
  const toPath = ty => o.segs.filter(g => g.t === ty).map(g => 'M' + g.pts.map(p => r2(p[0]) + ' ' + r2(p[1])).join('L')).join(' ');
  o.cutPath = toPath('cut'); o.creasePath = toPath('crease');
  o.fillPath = o.fills.map(pts => 'M' + pts.map(p => r2(p[0]) + ' ' + r2(p[1])).join('L') + 'Z').join(' ');
  o.safePath = o.safes.map(r => 'M' + r2(r[0]) + ' ' + r2(r[1]) + 'h' + r2(r[2]) + 'v' + r2(r[3]) + 'h' + r2(-r[2]) + 'Z').join(' ');
  const len = ty => o.segs.filter(g => g.t === ty).reduce((a, g) => { let l = 0; for (let i = 0; i < g.pts.length - 1; i++) l += Math.hypot(g.pts[i + 1][0] - g.pts[i][0], g.pts[i + 1][1] - g.pts[i][1]); return a + l; }, 0);
  o.cutLen = len('cut'); o.creaseLen = len('crease');
  o.cutN = o.segs.filter(g => g.t === 'cut').length; o.creaseN = o.segs.filter(g => g.t === 'crease').length;
  _key = key; _custom = custom; _val = o; return o;
}

export function creaseSegsOf(g) {
  const out = [];
  g.segs.forEach(sg => { if (sg.t !== 'crease') return; for (let i = 0; i < sg.pts.length - 1; i++) out.push([sg.pts[i], sg.pts[i + 1]]); });
  return out;
}
