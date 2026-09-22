import { Vector4 } from 'three';
import { calcBSplinePoint } from 'three/addons/curves/NURBSUtils.js';

const MAX_BYTES = 20 * 1024 * 1024, MAX_POINTS = 100000, MAX_ENTITIES = 20000, TOLERANCE = 0.05;
const UNITS = { 1: ['英寸', 25.4], 2: ['英尺', 304.8], 3: ['英里', 1609344], 4: ['毫米', 1], 5: ['厘米', 10], 6: ['米', 1000], 7: ['千米', 1000000], 8: ['微英寸', 0.0000254], 9: ['密耳', 0.0254], 10: ['码', 914.4], 11: ['埃', 0.0000001], 12: ['纳米', 0.000001], 13: ['微米', 0.001], 14: ['分米', 100], 15: ['十米', 10000], 16: ['百米', 100000], 17: ['吉米', 1e12], 18: ['天文单位', 1.495978707e14], 19: ['光年', 9.4607304725808e18], 20: ['秒差距', 3.085677581491367e19], 21: ['美制测量英尺', 1200000 / 3937] };
const fail = message => { throw new Error(message); };
const val = (e, code, fallback) => e.p.find(p => p[0] === code)?.[1] ?? fallback;
const number = (value, fallback) => {
  if (value == null) { if (fallback != null) return fallback; fail('缺少必需的数值坐标。'); }
  const n = Number(value);
  if (String(value).trim() === '' || !Number.isFinite(n)) fail('包含无效数值。');
  return n;
};
const num = (e, code, fallback) => number(val(e, code), fallback);
const all = (e, code) => e.p.filter(p => p[0] === code).map(p => number(p[1]));
const point = (e, code = 10) => [num(e, code), num(e, code + 10)];
const transform = (m, p) => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
const multiply = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
const distance = (p, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], q = dx * dx + dy * dy;
  const t = q ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / q)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};

export function decodeDxf(buffer) {
  if (buffer.byteLength > MAX_BYTES) fail('DXF 文件超过 20 MB，请只导出需要的刀模。');
  const bytes = new Uint8Array(buffer), probe = new TextDecoder('windows-1252').decode(bytes);
  if (probe.startsWith('AutoCAD Binary DXF')) fail('暂不支持二进制 DXF，请另存为文本 DXF。');
  const version = probe.match(/\$ACADVER\s*\r?\n\s*1\s*\r?\n\s*AC(\d+)/)?.[1];
  const codepage = probe.match(/\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*([^\r\n]+)/)?.[1]?.trim();
  const encodings = { ANSI_936: 'gbk', ANSI_950: 'big5', ANSI_932: 'shift_jis', ANSI_949: 'euc-kr', ANSI_1252: 'windows-1252', ANSI_1251: 'windows-1251', ANSI_1250: 'windows-1250' };
  const encoding = Number(version) >= 1021 ? 'utf-8' : encodings[codepage] || 'utf-8';
  try { return new TextDecoder(encoding, { fatal: true }).decode(bytes); }
  catch { fail(`无法按 ${encoding} 解码 DXF，请另存为 AutoCAD 2007 或更新的 UTF-8 文本 DXF。`); }
}

function records(pairs) {
  const out = [];
  for (const p of pairs) {
    if (p[0] === 0) out.push({ type: p[1].toUpperCase(), p: [] });
    else if (out.length) out[out.length - 1].p.push(p);
  }
  return out;
}

function polylines(list) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e.type === 'POLYLINE') {
      e.vertices = [];
      while (list[i + 1]?.type === 'VERTEX') e.vertices.push(list[++i]);
      if (list[++i]?.type !== 'SEQEND') fail('POLYLINE 缺少 SEQEND 结束标记。');
    }
    out.push(e);
  }
  return out;
}

function rgbOf(aci) {
  if (aci >= 1 && aci <= 9) return [null, [255, 0, 0], [255, 255, 0], [0, 255, 0], [0, 255, 255], [0, 0, 255], [255, 0, 255], [255, 255, 255], [128, 128, 128], [192, 192, 192]][aci];
  if (aci < 10 || aci > 249) return [128, 128, 128];
  const h = Math.floor((aci - 10) / 10) / 4, v = [255, 165, 127, 76, 38][Math.floor((aci % 10) / 2)], s = aci % 2 ? 0.5 : 1;
  const c = v * s, x = c * (1 - Math.abs(h % 2 - 1)), m = v - c;
  return [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h)].map(n => n + m);
}

function colorOf(e, layer, inherited) {
  const trueColor = val(e, 420);
  if (trueColor != null) {
    const n = number(trueColor);
    if (!Number.isInteger(n) || n < 0 || n > 0xffffff) fail('无效的 DXF 真彩色。');
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  }
  const aci = Math.abs(num(e, 62, 256));
  if (!Number.isInteger(aci) || aci > 256) fail('无效的 DXF 颜色索引。');
  if (aci === 0) return inherited || [255, 255, 255];
  if (aci === 256) return layer ? colorOf(layer, null, null) : [255, 255, 255];
  return rgbOf(aci);
}

function planar(e) {
  if (e.p.some(([c, v]) => ((c >= 30 && c <= 38) || c === 39) && Math.abs(number(v)) > 1e-8)) fail('包含非零 Z 坐标或厚度；请投影到 XY 平面并设 Z=0。');
  if (Math.abs(num(e, 210, 0)) > 1e-8 || Math.abs(num(e, 220, 0)) > 1e-8 || Math.abs(num(e, 230, 1) - 1) > 1e-8) fail('包含非 XY 平面的法向量；请在 CAD 中转换为 XY 平面。');
  if (num(e, 67, 0) !== 0) fail('包含图纸空间对象；请只导出模型空间刀模。');
  if (num(e, 60, 0) !== 0) fail('包含隐藏对象；请在 CAD 中清理或显示后重新导出。');
}

export function parseDxf(text, { unitScale = 1 } = {}) {
  if (typeof text !== 'string' || text.length > MAX_BYTES) fail('DXF 内容无效或超过 20 MB。');
  if (text.startsWith('AutoCAD Binary DXF') || text.includes('\0')) fail('暂不支持二进制 DXF，请另存为文本 DXF。');
  if (!Number.isFinite(unitScale) || unitScale <= 0) fail('单位比例必须是正数。');
  const lines = text.replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n');
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  if (lines.length % 2) fail('DXF 组码和值未成对，文件可能不完整。');
  const sections = new Map();
  let section = null, ended = false;
  for (let i = 0; i < lines.length; i += 2) {
    const code = Number(lines[i].trim()), value = lines[i + 1].trim();
    if (!/^\d+$/.test(lines[i].trim()) || !Number.isInteger(code) || code > 1071) fail(`第 ${i + 1} 行 DXF 组码无效。`);
    if (code === 0 && value === 'SECTION') {
      if (section || Number(lines[i + 2]?.trim()) !== 2) fail('DXF SECTION 结构无效。');
      section = lines[i + 3]?.trim(); i += 2;
      if (!section || sections.has(section)) fail('DXF 分区重复或缺少名称。');
      sections.set(section, []);
    } else if (code === 0 && value === 'ENDSEC') section = null;
    else if (code === 0 && value === 'EOF') { ended = true; break; }
    else if (section) sections.get(section).push([code, value]);
  }
  if (!ended || section || !sections.has('ENTITIES')) fail('DXF 缺少完整 ENTITIES 分区或 EOF 结束标记。');
  const header = sections.get('HEADER') || [];
  const unitIndex = header.findIndex(p => p[0] === 9 && p[1] === '$INSUNITS');
  const unitCode = unitIndex < 0 ? 0 : number(header[unitIndex + 1]?.[1]);
  if (unitCode && !UNITS[unitCode]) fail(`暂不支持 INSUNITS=${unitCode}，请在 CAD 中转为毫米后导出。`);
  const scale = unitCode ? UNITS[unitCode][1] : unitScale;
  const warnings = new Set(unitCode ? [] : [`DXF 未声明单位，按 1 图纸单位 = ${unitScale} mm 导入。`]);
  const layers = new Map(records(sections.get('TABLES') || []).filter(e => e.type === 'LAYER').map(e => [val(e, 2), e]));
  const blocks = new Map();
  let block;
  for (const e of records(sections.get('BLOCKS') || [])) {
    if (e.type === 'BLOCK') { block = { ...e, entities: [] }; blocks.set(val(e, 2), block); }
    else if (e.type === 'ENDBLK') { if (block) block.entities = polylines(block.entities); block = null; }
    else if (block) block.entities.push(e);
  }
  if (block) fail('DXF 块定义缺少 ENDBLK。');
  const segs = [], errors = new Map();
  let totalPoints = 0, entityCount = 0, sampledCurves = false;
  const append = (pts, p) => {
    if (!p.every(Number.isFinite) || p.some(n => Math.abs(n) > 1e9)) fail('坐标无效或超出允许范围；请检查图纸单位。');
    if (++totalPoints > MAX_POINTS) fail('DXF 曲线点数超过 100000，请简化图纸。');
    if (!pts.length || Math.hypot(p[0] - pts.at(-1)[0], p[1] - pts.at(-1)[1]) > 1e-9) pts.push(p);
  };
  const arc = (pts, m, center, radius, start, sweep) => {
    sampledCurves = true;
    if (!(radius > 0) || !Number.isFinite(radius)) fail('圆弧半径必须为正数。');
    const r = radius * Math.hypot(m[0], m[1], m[2], m[3]);
    const step = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - TOLERANCE / r)));
    const count = Math.max(1, Math.ceil(Math.abs(sweep) / Math.min(Math.PI / 4, step)));
    if (!Number.isFinite(count) || count > MAX_POINTS) fail('圆弧采样点数过多，请检查单位或简化图纸。');
    for (let i = 0; i <= count; i++) {
      const a = start + sweep * i / count;
      append(pts, transform(m, [center[0] + radius * Math.cos(a), center[1] + radius * Math.sin(a)]));
    }
  };
  const spline = (e, m, pts) => {
    sampledCurves = true;
    const degree = num(e, 71), knots = all(e, 40), xs = all(e, 10), ys = all(e, 20), weights = all(e, 41);
    if (![1, 2, 3].includes(degree)) fail('仅支持 1–3 次控制点 SPLINE；请转为三次样条或多段线。');
    if (xs.length < degree + 1 || xs.length !== ys.length || knots.length !== xs.length + degree + 1 || (weights.length && weights.length !== xs.length)) fail('SPLINE 控制点、权重或节点数量无效；拟合点样条请先转为控制点样条。');
    if (knots.some((n, i) => i && n < knots[i - 1]) || weights.some(n => n <= 0)) fail('SPLINE 节点必须递增，权重必须为正数。');
    if (num(e, 72, knots.length) !== knots.length || num(e, 73, xs.length) !== xs.length) fail('SPLINE 声明的节点或控制点数量与内容不符。');
    const start = knots[degree], end = knots[xs.length];
    if (!(end > start)) fail('SPLINE 有效参数范围为空。');
    const cps = xs.map((x, i) => new Vector4(x, ys[i], 0, weights[i] ?? 1));
    const at = u => calcBSplinePoint(degree, knots, cps, u);
    const project = p => transform(m, [p.x / p.w, p.y / p.w]);
    const subdivide = (controls, depth) => {
      if (controls.some(p => !Number.isFinite(p.w) || p.w <= 0)) fail('SPLINE 权重异常，无法安全采样。');
      const polygon = controls.map(project), a = polygon[0], b = polygon.at(-1);
      if (polygon.every(p => distance(p, a, b) <= TOLERANCE)) { append(pts, a); append(pts, b); return; }
      if (depth >= 24) fail('SPLINE 过于复杂，无法在 0.05 mm 公差内采样。');
      const left = [controls[0]], right = [controls.at(-1)];
      let row = controls;
      while (row.length > 1) { row = row.slice(0, -1).map((p, i) => p.clone().lerp(row[i + 1], 0.5)); left.push(row[0]); right.unshift(row.at(-1)); }
      subdivide(left, depth + 1); subdivide(right, depth + 1);
    };
    // Each knot span is a rational Bézier curve; its positive-weight control hull bounds sampling error.
    for (let i = degree; i < xs.length; i++) {
      const a = knots[i], b = knots[i + 1];
      if (b === a) continue;
      if (i > degree && knots.slice(i - degree, i + 1).every(k => k === a)) fail('不支持断开的 SPLINE，请拆分为独立曲线。');
      const p = at(a), q = at(b);
      let controls = [p, q];
      if (degree === 2) controls = [p, at((a + b) / 2).multiplyScalar(2).addScaledVector(p, -0.5).addScaledVector(q, -0.5), q];
      if (degree === 3) {
        const u = at(a + (b - a) / 3).multiplyScalar(27).addScaledVector(p, -8).sub(q);
        const v = at(a + 2 * (b - a) / 3).multiplyScalar(27).sub(p).addScaledVector(q, -8);
        controls = [p, u.clone().multiplyScalar(2).sub(v).multiplyScalar(1 / 18), v.clone().multiplyScalar(2).sub(u).multiplyScalar(1 / 18), q];
      }
      subdivide(controls, 0);
    }
    if (num(e, 70, 0) & 1) {
      if (Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]) > TOLERANCE) fail('闭合 SPLINE 的首尾不相接，请修复曲线后导入。');
      pts[pts.length - 1] = [...pts[0]];
    }
  };
  const visit = (list, m, inheritedColor, inheritedLayer, stack = []) => {
    for (const e of list) {
      if (++entityCount > MAX_ENTITIES) fail('展开后的 DXF 对象超过 20000，请简化刀模。');
      try {
        planar(e);
        const layerName = val(e, 8, '0') === '0' && inheritedLayer ? inheritedLayer : val(e, 8, '0');
        const layer = layers.get(layerName), color = colorOf(e, layer, inheritedColor);
        if (layer && (num(layer, 62, 7) < 0 || (num(layer, 70, 0) & 1))) warnings.add(`关闭或冻结的图层「${layerName}」也已导入，请核对。`);
        if (e.type === 'INSERT') {
          const name = val(e, 2), b = blocks.get(name);
          if (!b) fail(`找不到块「${name}」。`);
          if (stack.includes(name) || stack.length >= 16) fail('块存在循环引用或嵌套超过 16 层。');
          if (num(e, 70, 1) !== 1 || num(e, 71, 1) !== 1) fail('不支持阵列 INSERT，请炸开阵列块后导入。');
          if (num(b, 70, 0) & 12) fail('不支持外部引用块，请绑定或炸开后导入。');
          planar(b);
          const sx = num(e, 41, 1), sy = num(e, 42, 1), a = num(e, 50, 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), p = point(e), origin = point(b);
          if (!sx || !sy) fail('块的缩放比例不能为零。');
          const local = [c * sx, s * sx, -s * sy, c * sy, p[0], p[1]], offset = transform(local, [-origin[0], -origin[1]]);
          local[4] = offset[0]; local[5] = offset[1];
          visit(b.entities, multiply(m, local), color, layerName, [...stack, name]);
          continue;
        }
        if (!['LINE', 'LWPOLYLINE', 'POLYLINE', 'ARC', 'CIRCLE', 'SPLINE'].includes(e.type)) fail(`不支持对象 ${e.type}，请在 CAD 中删除标注/文字或炸开为线段、多段线、圆弧。`);
        const [r, g, b] = color;
        const t = r > 20 && r > g * 1.35 && r > b * 1.35 ? 'cut' : g > 20 && g > r * 1.35 && g > b * 1.2 ? 'crease' : null;
        if (!t) fail(`图层「${layerName}」含非红/绿线条；请将切线设红色、压痕设绿色（或修改所在图层颜色）。`);
        const pts = [];
        if (e.type === 'LINE') { append(pts, transform(m, point(e))); append(pts, transform(m, point(e, 11))); }
        else if (e.type === 'ARC' || e.type === 'CIRCLE') {
          const start = e.type === 'ARC' ? num(e, 50) * Math.PI / 180 : 0, finish = e.type === 'ARC' ? num(e, 51) * Math.PI / 180 : Math.PI * 2;
          const sweep = e.type === 'CIRCLE' ? Math.PI * 2 : ((finish - start) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
          if (!sweep) fail('ARC 起止角相同，请使用 CIRCLE 表示整圆。');
          arc(pts, m, point(e), num(e, 40), start, sweep);
          if (e.type === 'CIRCLE') pts[pts.length - 1] = [...pts[0]];
        } else if (e.type === 'SPLINE') spline(e, m, pts);
        else {
          const flags = num(e, 70, 0);
          if (!Number.isInteger(flags) || flags < 0 || (flags & ~129)) fail('不支持三维、网格或拟合 POLYLINE，请转为普通二维多段线。');
          if ([40, 41, 43].some(c => all(e, c).some(n => n !== 0))) fail('不支持带宽度的多段线，请将宽度设为零。');
          let vertices = e.vertices;
          if (!vertices) {
            vertices = [];
            for (const p of e.p) {
              if (p[0] === 10) vertices.push({ p: [p] });
              else if (vertices.length && [20, 40, 41, 42].includes(p[0])) vertices.at(-1).p.push(p);
            }
            if (num(e, 90, vertices.length) !== vertices.length) fail('LWPOLYLINE 顶点数量与声明不符。');
          }
          if (vertices.length < 2) fail('多段线少于两个顶点。');
          for (const v of vertices) {
            planar(v);
            if (num(v, 70, 0) !== 0 || num(v, 40, 0) || num(v, 41, 0)) fail('不支持拟合顶点或带宽度的 POLYLINE，请转为普通零宽二维多段线。');
          }
          const count = vertices.length - (flags & 1 ? 0 : 1);
          for (let i = 0; i < count; i++) {
            const a = point(vertices[i]), b = point(vertices[(i + 1) % vertices.length]), bulge = num(vertices[i], 42, 0);
            if (!bulge) { append(pts, transform(m, a)); append(pts, transform(m, b)); }
            else {
              const dx = b[0] - a[0], dy = b[1] - a[1], chord = Math.hypot(dx, dy);
              if (!chord) fail('带凸度的多段线含重合顶点。');
              const k = (1 - bulge * bulge) / (4 * bulge), center = [(a[0] + b[0]) / 2 - dy * k, (a[1] + b[1]) / 2 + dx * k];
              arc(pts, m, center, chord * (1 + bulge * bulge) / (4 * Math.abs(bulge)), Math.atan2(a[1] - center[1], a[0] - center[0]), 4 * Math.atan(bulge));
              pts[pts.length - 1] = transform(m, b);
            }
          }
        }
        if (pts.length < 2) fail('包含零长度线段，请清理后导入。');
        segs.push({ t, pts });
      } catch (error) {
        const message = error.message || String(error);
        errors.set(message, (errors.get(message) || 0) + 1);
      }
    }
  };
  visit(polylines(records(sections.get('ENTITIES'))), [scale, 0, 0, scale, 0, 0], null, null);
  if (errors.size) fail('DXF 未导入，避免丢失图形：\n' + [...errors].slice(0, 12).map(([message, count]) => `${message}（${count} 处）`).join('\n') + (errors.size > 12 ? '\n另有其他问题，请清理后重试。' : ''));
  if (!segs.length) fail('DXF 中没有可导入的刀模线条。');
  let minX = Infinity, maxY = -Infinity;
  for (const seg of segs) for (const [x, y] of seg.pts) { minX = Math.min(minX, x); maxY = Math.max(maxY, y); }
  for (const seg of segs) seg.pts = seg.pts.map(([x, y]) => [x - minX, maxY - y]);
  if (sampledCurves) warnings.add('圆弧/样条以不大于 0.05 mm 的弦误差转换为折线。');
  return { version: 1, segs, warnings: [...warnings], sourceUnits: unitCode ? UNITS[unitCode][0] : '未指定' };
}
