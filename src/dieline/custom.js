// DXF 的线网只用于推导面板；原始毫米刀线保持不变，继续用于二维和印刷输出。
import { pointInPolygon } from '../design/containers.js';

// Near-coincident CAD vertices share a topology node within 0.02 mm. Source coordinates are never rewritten.
const EPS = 0.02;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const area = pts => pts.reduce((s, p, i) => s + cross(p, pts[(i + 1) % pts.length]), 0) / 2;
const along = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const projection = (p, a, b) => { const v = sub(b, a), w = sub(p, a); return (v[0] * w[0] + v[1] * w[1]) / (v[0] ** 2 + v[1] ** 2); };
const insidePoint = pts => {
  // Positive rings have their interior to the left of each directed edge.
  const i = pts.reduce((best, p, j) => distance(p, pts[(j + 1) % pts.length]) > distance(pts[best], pts[(best + 1) % pts.length]) ? j : best, 0);
  const a = pts[i], b = pts[(i + 1) % pts.length], d = distance(a, b), m = along(a, b, 0.5);
  return [m[0] - (b[1] - a[1]) / d * 0.001, m[1] + (b[0] - a[0]) / d * 0.001];
};

function graphOf(lines) {
  const splits = lines.map(() => [0, 1]);
  // ponytail: pairwise intersections are capped at 3,000 edges; use a spatial index for larger CAD drawings.
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {
    const { a, b } = lines[i], { a: c, b: d } = lines[j], u = sub(b, a), v = sub(d, c), det = cross(u, v);
    if (Math.abs(det) > 1e-9) {
      const t = cross(sub(c, a), v) / det, q = cross(sub(c, a), u) / det;
      if (t >= 0 && t <= 1 && q >= 0 && q <= 1) { splits[i].push(t); splits[j].push(q); }
    }
    // Also join almost coincident DXF endpoints and split overlapping collinear lines.
    for (const [p, k, start, end] of [[a, j, c, d], [b, j, c, d], [c, i, a, b], [d, i, a, b]]) {
      const t = projection(p, start, end);
      if (t >= 0 && t <= 1 && distance(p, along(start, end, t)) <= EPS) splits[k].push(t);
    }
  }
  const pts = [], buckets = new Map(), edges = [], unique = new Map();
  const node = p => {
    const x = Math.floor(p[0] / EPS), y = Math.floor(p[1] / EPS);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const id of buckets.get(`${x + dx},${y + dy}`) || []) if (distance(pts[id], p) <= EPS) return id;
    }
    if (pts.length >= 8000) throw new Error('DXF 相交节点过多；请简化刀模后导入。');
    const id = pts.length, key = `${x},${y}`; pts.push(p);
    if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(id); return id;
  };
  lines.forEach((line, i) => {
    const ts = splits[i].sort((a, b) => a - b);
    for (let k = 1; k < ts.length; k++) {
      const a = node(along(line.a, line.b, ts[k - 1])), b = node(along(line.a, line.b, ts[k]));
      if (a === b) continue;
      const key = a < b ? `${a},${b}` : `${b},${a}`, old = unique.get(key);
      if (old != null) { if (line.t === 'cut') edges[old].t = 'cut'; continue; }
      if (edges.length >= 12000) throw new Error('DXF 相交线网过密；请简化刀模后导入。');
      unique.set(key, edges.length); edges.push({ a, b, t: line.t });
    }
  });
  return { pts, edges };
}

function facesOf(graph, onlyCut = false) {
  const { pts, edges } = graph, adj = pts.map(() => []);
  edges.forEach((e, id) => { if (!onlyCut || e.t === 'cut') { adj[e.a].push({ v: e.b, id }); adj[e.b].push({ v: e.a, id }); } });
  // Bridges are open slits, not material boundaries. Keep them in the original drawing.
  const seen = new Map(), low = new Map(), bridges = new Set(); let tick = 0;
  pts.forEach((_, start) => {
    if (seen.has(start)) return;
    seen.set(start, ++tick); low.set(start, tick);
    const stack = [{ u: start, parent: -1, parentNode: -1, next: 0 }];
    while (stack.length) {
      const frame = stack.at(-1), { u, parent, parentNode } = frame;
      if (frame.next === adj[u].length) {
        stack.pop();
        if (parentNode !== -1) { low.set(parentNode, Math.min(low.get(parentNode), low.get(u))); if (low.get(u) > seen.get(parentNode)) bridges.add(parent); }
        continue;
      }
      const { v, id } = adj[u][frame.next++]; if (id === parent) continue;
      if (seen.has(v)) low.set(u, Math.min(low.get(u), seen.get(v)));
      else { seen.set(v, ++tick); low.set(v, tick); stack.push({ u: v, parent: id, parentNode: u, next: 0 }); }
    }
  });
  adj.forEach((items, u) => {
    adj[u] = items.filter(e => !bridges.has(e.id)).sort((a, b) => Math.atan2(pts[a.v][1] - pts[u][1], pts[a.v][0] - pts[u][0]) - Math.atan2(pts[b.v][1] - pts[u][1], pts[b.v][0] - pts[u][0]));
  });
  const used = new Set(), faces = [];
  adj.forEach((items, start) => items.forEach(first => {
    if (used.has(`${start},${first.v}`)) return;
    let u = start, v = first.v; const ring = [], edgeIds = [];
    for (let step = 0; step <= edges.length * 2; step++) {
      const key = `${u},${v}`; if (used.has(key)) break; used.add(key); ring.push(u);
      const list = adj[v], back = list.findIndex(e => e.v === u), prev = adj[u].find(e => e.v === v); edgeIds.push(prev.id);
      const next = list[(back + list.length - 1) % list.length].v; u = v; v = next;
      if (u === start && v === first.v) break;
    }
    const polygon = ring.map(id => pts[id]), size = area(polygon);
    if (size > EPS * EPS) faces.push({ pts: polygon, size, edgeIds });
  }));
  return { faces, bridges };
}

export function prepareCustom(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.segs) || !data.segs.length || data.segs.length > 3000) throw new Error('自定义刀模数据无效（需要 version: 1 和有效线条）。');
  let pointCount = 0;
  const lines = [];
  for (const sg of data.segs) {
    if (!sg || !['cut', 'crease'].includes(sg.t) || !Array.isArray(sg.pts) || sg.pts.length < 2) throw new Error('DXF 刀线或压痕数据无效。');
    pointCount += sg.pts.length;
    if (pointCount > 8000) throw new Error('DXF 采样点超过 8,000；请简化刀模后导入。');
    for (const p of sg.pts) if (!Array.isArray(p) || p.length !== 2 || !p.every(v => Number.isFinite(v) && Math.abs(v) <= 1e6)) throw new Error('DXF 存在无效或超出范围的毫米坐标。');
    const simple = [];
    for (const p of sg.pts) {
      if (simple.length && distance(simple.at(-1), p) < 1e-6) continue;
      while (simple.length > 1) {
        const a = simple.at(-2), b = simple.at(-1), ab = sub(b, a), bp = sub(p, b);
        if (Math.abs(cross(ab, bp)) > 1e-7 * Math.max(1, distance(a, b), distance(b, p)) || ab[0] * bp[0] + ab[1] * bp[1] < 0) break;
        simple.pop();
      }
      simple.push(p);
    }
    for (let i = 1; i < simple.length; i++) if (distance(simple[i - 1], simple[i]) >= 1e-6) lines.push({ a: [...simple[i - 1]], b: [...simple[i]], t: sg.t });
  }
  if (lines.length > 3000) throw new Error('DXF 线网超过 3,000 段；请简化刀模后导入。');
  const rawWarnings = data.sourceWarnings || data.warnings || [];
  if (!Array.isArray(rawWarnings)) throw new Error('自定义刀模提示信息格式无效。');
  const sourceWarnings = rawWarnings.filter(w => typeof w === 'string').slice(0, 100).map(w => w.slice(0, 500));
  const warnings = [...sourceWarnings];
  let extensions = 0;
  // Real drawings can leave short relief gaps at crease ends. Extend topology only, never the exported knife lines.
  for (const line of lines.filter(l => l.t === 'crease')) for (const end of ['a', 'b']) {
    const p = line[end], other = line[end === 'a' ? 'b' : 'a'];
    if (lines.some(l => l !== line && (() => { const t = projection(p, l.a, l.b); return t >= 0 && t <= 1 && distance(p, along(l.a, l.b, t)) <= EPS; })())) continue;
    const dir = sub(p, other), len = distance(p, other); let best = null, gap = 1.1;
    for (const l of lines) {
      if (l === line) continue;
      const v = sub(l.b, l.a), det = cross(dir, v); if (Math.abs(det) < 1e-9) continue;
      const t = cross(sub(l.a, p), v) / det, u = cross(sub(l.a, p), dir) / det;
      if (t > 0 && t * len <= gap && u >= 0 && u <= 1) { gap = t * len; best = along(p, [p[0] + dir[0], p[1] + dir[1]], t); }
    }
    if (best) { line[end] = best; extensions++; }
  }
  if (extensions) warnings.push(`为识别折叠面板，${extensions} 个压痕端点在 1.1 mm 内延伸连接；原始导出线条未改变。`);
  const graph = graphOf(lines), cutGraph = facesOf(graph, true), cutFaces = cutGraph.faces;
  if (cutGraph.bridges.size) warnings.push('图中含开放切口；原线条保留，3D 仅在切口分隔出面板时分开折叠。');
  if (!cutFaces.length) throw new Error('红色切线未形成闭合外轮廓，无法生成盒型面板。');
  const material = pt => cutFaces.reduce((n, f) => n + Number(pointInPolygon(pt, f.pts)), 0) % 2 === 1;
  const contours = cutFaces.filter(f => material(insidePoint(f.pts))).map(f => ({ pts: f.pts, holes: [] }));
  for (const hole of cutFaces.filter(f => !material(insidePoint(f.pts)))) {
    const owner = contours.filter(c => pointInPolygon(insidePoint(hole.pts), c.pts)).sort((a, b) => area(a.pts) - area(b.pts))[0];
    if (owner) owner.holes.push(hole.pts);
  }
  const all = facesOf(graph), faces = all.faces.filter(f => material(insidePoint(f.pts)));
  if (!faces.length || faces.length > 200) throw new Error('DXF 无法识别有效面板，或面板数量超过 200。');
  const panels = faces.map((f, i) => ({ panelId: `dxf-panel-${i + 1}`, pts: f.pts, role: 'design', surface: 'outside', holes: [] }));
  // Isolated inner contours are holes; connected holes already form part of a panel boundary.
  for (const hole of cutFaces.filter(f => !material(insidePoint(f.pts)))) {
    const p = insidePoint(hole.pts), candidates = panels.filter(panel => pointInPolygon(p, panel.pts));
    const owner = candidates.sort((a, b) => area(a.pts) - area(b.pts))[0];
    if (owner && hole.pts.every(q => pointInPolygon(q, owner.pts))) owner.holes.push(hole.pts);
  }
  const owners = new Map();
  faces.forEach((f, i) => f.edgeIds.forEach(id => { if (!owners.has(id)) owners.set(id, []); owners.get(id).push(i); }));
  const shared = new Map();
  for (const [id, ids] of owners) if (ids.length === 2 && graph.edges[id].t === 'crease') {
    const key = [...ids].sort((a, b) => a - b).join(','); if (!shared.has(key)) shared.set(key, []); shared.get(key).push(id);
  }
  const hinges = [];
  for (const [key, ids] of shared) {
    const [ia, ib] = key.split(',').map(Number), endpoints = ids.flatMap(id => [graph.pts[graph.edges[id].a], graph.pts[graph.edges[id].b]]);
    let p = endpoints[0], q = endpoints.reduce((far, v) => distance(v, p) > distance(far, p) ? v : far, p);
    p = endpoints.reduce((far, v) => distance(v, q) > distance(far, q) ? v : far, p);
    if (endpoints.some(v => Math.abs(cross(sub(q, p), sub(v, p))) / distance(p, q) > EPS)) { warnings.push(`面板 ${ia + 1} / ${ib + 1} 间存在弯曲压痕，保留平面，不自动折叠。`); continue; }
    hinges.push({ id: `dxf-hinge-${hinges.length + 1}`, a: panels[ia].panelId, b: panels[ib].panelId, edge: [p, q], angle: 90 });
  }
  let root = panels.find(p => p.panelId === data.root)?.panelId || panels[faces.reduce((big, f, i) => f.size > faces[big].size ? i : big, 0)].panelId;
  panels.find(p => p.panelId === root).role = 'hero'; panels.find(p => p.panelId === root).up = 'front';
  const angles = {};
  for (const h of hinges) if (data.angles && Object.hasOwn(data.angles, h.id)) {
    const angle = data.angles[h.id]; if (!Number.isFinite(angle) || Math.abs(angle) > 180) throw new Error('自定义折叠角度必须位于 -180° 至 180°。'); angles[h.id] = angle;
  }
  const reached = new Set(), tree = [], roots = [root, ...panels.map(p => p.panelId).filter(id => id !== root)];
  let components = 0;
  for (const id of roots) {
    if (reached.has(id)) continue; components++; reached.add(id); const queue = [id];
    for (const current of queue) for (const h of hinges) {
      const next = h.a === current ? h.b : h.b === current ? h.a : null;
      if (next && !reached.has(next)) { reached.add(next); queue.push(next); tree.push(h); }
    }
  }
  if (tree.length < hinges.length) warnings.push('压痕连接含闭环；3D 使用无环折叠顺序，闭环接缝不做碰撞或闭合求解。');
  if (components > 1) warnings.push(`识别到 ${components} 个独立片件；3D 分别预览，不自动装配。`);
  const openCreases = [...all.bridges].filter(id => graph.edges[id].t === 'crease').length;
  if (openCreases) warnings.push(`${openCreases} 段压痕未分隔出相邻面板，已保留线条，不参与 3D 折叠。`);
  warnings.push('DXF 不包含山折/谷折及目标角度；默认 90°，请在自定义折叠设置中校正。');
  return { version: 1, name: typeof data.name === 'string' ? data.name.slice(0, 80) : '自定义 DXF', sourceUnits: typeof data.sourceUnits === 'string' ? data.sourceUnits.slice(0, 40) : '毫米', segs: data.segs, sourceWarnings, warnings: [...new Set(warnings)], panels, contours, hinges: tree, root, angles };
}
