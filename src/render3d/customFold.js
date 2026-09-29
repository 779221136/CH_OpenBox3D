// 自定义刀模：保留实际多边形，通过面板邻接树绕任意压痕旋转。
import * as THREE from 'three';

function centerOf(pts) {
  let twiceArea = 0, x = 0, y = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], cross = a[0] * b[1] - b[0] * a[1];
    twiceArea += cross; x += (a[0] + b[0]) * cross; y += (a[1] + b[1]) * cross;
  }
  if (Math.abs(twiceArea) < 1e-8) throw new Error('自定义面板面积为零。');
  return { x: x / (3 * twiceArea), y: y / (3 * twiceArea), area: Math.abs(twiceArea / 2) };
}

function trianglesOverlap(a, b) {
  const separated = (p, q) => p.some((v, i) => {
    const w = p[(i + 1) % 3], dx = w[0] - v[0], dy = w[1] - v[1];
    const project = r => dx * r[1] - dy * r[0];
    const pa = p.map(project), pb = q.map(project);
    return Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb)) <= 1e-6 * Math.hypot(dx, dy);
  });
  return !separated(a, b) && !separated(b, a);
}

export class CustomFolder {
  constructor(T, sbb, innerUV = [0.0002, 0.9998]) {
    this.sbb = sbb; this.innerUV = innerUV;
  }

  build(custom, t, faceMat, coreMat) {
    this.setSelectedHinge(null);
    if (!custom?.panels?.length) throw new Error('自定义刀模没有可折叠面板。');
    const panels = new Map(), centers = new Map();
    for (const panel of custom.panels) {
      for (const ring of [panel.pts, ...(panel.holes || [])]) {
        if (!Array.isArray(ring) || ring.length < 3 || ring.some(p => !Array.isArray(p) || p.length < 2 || !p.slice(0, 2).every(Number.isFinite))) throw new Error('自定义面板坐标无效。');
      }
      if (panels.has(panel.panelId)) throw new Error('自定义面板标识重复。');
      panels.set(panel.panelId, panel); centers.set(panel.panelId, centerOf(panel.pts));
    }
    const ordered = [...panels.keys()].sort((a, b) => centers.get(b).area - centers.get(a).area);
    if (panels.has(custom.root)) ordered.splice(0, 0, ordered.splice(ordered.indexOf(custom.root), 1)[0]);
    const origin = centers.get(ordered[0]);
    this.origin = [origin.x, origin.y];
    const point = ([x, y]) => new THREE.Vector3(x - origin.x, origin.y - y, 0);
    const adjacency = new Map(ordered.map(id => [id, []]));
    for (const hinge of custom.hinges || []) {
      if (!panels.has(hinge.a) || !panels.has(hinge.b) || hinge.a === hinge.b || !Array.isArray(hinge.edge) || hinge.edge.length !== 2 || hinge.edge.some(p => !Array.isArray(p) || p.length < 2 || !p.slice(0, 2).every(Number.isFinite))) throw new Error('自定义压痕连接无效。');
      if (point(hinge.edge[0]).distanceTo(point(hinge.edge[1])) < 1e-8) throw new Error('自定义压痕长度为零。');
      adjacency.get(hinge.a).push(hinge); adjacency.get(hinge.b).push(hinge);
    }
    const sw = this.sbb[2] - this.sbb[0], sh = this.sbb[3] - this.sbb[1];
    if (!(sw > 0 && sh > 0 && Number.isFinite(sw + sh))) throw new Error('自定义刀模范围无效。');
    this.root = new THREE.Group();
    this.sheet = new THREE.Group(); this.sheet.rotation.x = -Math.PI / 2;
    this.root.add(this.sheet);
    this.nodes = []; this.meshes = new Map();
    const visited = new Set(), groups = new Map();
    for (const rootId of ordered) {
      if (visited.has(rootId)) continue;
      const rootGroup = new THREE.Group(); this.sheet.add(rootGroup); groups.set(rootId, rootGroup); visited.add(rootId);
      const queue = [{ id: rootId, depth: 0 }];
      for (let i = 0; i < queue.length; i++) {
        const { id, depth } = queue[i], parent = groups.get(id), panel = panels.get(id);
        const pathOf = (ring, Path) => {
          const path = new Path();
          ring.forEach((p, index) => { const v = point(p); if (index) path.lineTo(v.x, v.y); else path.moveTo(v.x, v.y); });
          path.closePath(); return path;
        };
        const shape = pathOf(panel.pts, THREE.Shape);
        shape.holes = (panel.holes || []).map(ring => pathOf(ring, THREE.Path));
        // ponytail: 异形面使用原三角剖分；需要精细压纹位移时再细分面板。
        const geo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, steps: 1 });
        const pos = geo.attributes.position, uv = geo.attributes.uv, caps = geo.groups[0];
        for (let j = 0; j < pos.count; j++) {
          if (j >= caps.start && j < caps.start + caps.count && Math.abs(pos.getZ(j) - t) < 1e-6) {
            uv.setXY(j, (pos.getX(j) + origin.x - this.sbb[0]) / sw, 1 - (origin.y - pos.getY(j) - this.sbb[1]) / sh);
          } else uv.setXY(j, this.innerUV[0], this.innerUV[1]);
        }
        uv.needsUpdate = true; geo.computeBoundingBox();
        const mesh = new THREE.Mesh(geo, [faceMat, coreMat]);
        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.userData.panel = { panelId: id, surface: 'outside', up: 'top' };
        parent.add(mesh); this.meshes.set(id, mesh);
        for (const hinge of adjacency.get(id)) {
          const childId = hinge.a === id ? hinge.b : hinge.a;
          if (visited.has(childId)) continue; // 拓扑分析已报告闭环，这里只使用生成树。
          visited.add(childId);
          const anchor = point(hinge.edge[0]), axis = point(hinge.edge[1]).sub(anchor).normalize();
          const c = centers.get(childId), offset = point([c.x, c.y]).sub(anchor);
          const side = Math.sign(axis.x * offset.y - axis.y * offset.x) || 1;
          const group = new THREE.Group(); group.matrixAutoUpdate = false; parent.add(group); groups.set(childId, group);
          this.nodes.push({ hinge, group, anchor, axis, side, depth: depth + 1 });
          queue.push({ id: childId, depth: depth + 1 });
        }
      }
    }
    this.layerOrder = [...this.meshes].sort(([a], [b]) => centers.get(b).area - centers.get(a).area).map(([, mesh]) => mesh);
    this.thickness = t;
    this.maxDepth = Math.max(1, ...this.nodes.map(n => n.depth));
    this.applyFold(custom, 0);
    return this.root;
  }

  setSelectedHinge(id) {
    if (id === this.selectedHingeId) return;
    if (this.hingeHighlight) {
      this.hingeHighlight.removeFromParent();
      this.hingeHighlight.geometry.dispose(); this.hingeHighlight.material.dispose();
      this.hingeHighlight = null;
    }
    this.selectedHingeId = null;
    const node = this.nodes?.find(n => n.hinge.id === id);
    if (!node) return;
    const points = node.hinge.edge.map(([x, y]) => new THREE.Vector3(x - this.origin[0], this.origin[1] - y, 0));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: '#ff7a20', depthTest: false, depthWrite: false, toneMapped: false }));
    line.renderOrder = 10; line.userData.hingeId = id;
    node.group.add(line); this.hingeHighlight = line; this.selectedHingeId = id;
  }

  separatePaperLayers(inverse) {
    const placed = [];
    const triangles = (surface, drop) => {
      surface.triangles ||= [];
      if (surface.triangles[drop]) return surface.triangles[drop];
      const { position } = surface.mesh.geometry.attributes, caps = surface.mesh.geometry.groups[0], out = [];
      for (let i = caps.start; i < caps.start + caps.count; i += 3) {
        if (Math.abs(position.getZ(i)) > 1e-6) continue;
        out.push([0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(position, i + k).applyMatrix4(surface.matrix).toArray().filter((_, axis) => axis !== drop)));
      }
      return surface.triangles[drop] = out;
    };
    // ponytail: only separate coincident, same-facing paper layers; intersecting folds still need a collision/assembly solver.
    for (const mesh of this.layerOrder) {
      const matrix = new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld);
      const normal = new THREE.Vector3(0, 0, 1).transformDirection(matrix), origin = new THREE.Vector3().setFromMatrixPosition(matrix);
      const surface = { mesh, matrix, normal, origin, bounds: mesh.geometry.boundingBox.clone().applyMatrix4(matrix), layer: 0 };
      const abs = normal.toArray().map(Math.abs), drop = abs.indexOf(Math.max(...abs));
      for (const other of placed) {
        if (normal.dot(other.normal) < 1 - 1e-8 || Math.abs(normal.dot(other.origin.clone().sub(origin))) > 1e-5 || !surface.bounds.clone().expandByScalar(1e-6).intersectsBox(other.bounds)) continue;
        if (triangles(surface, drop).some(a => triangles(other, drop).some(b => trianglesOverlap(a, b)))) surface.layer = Math.max(surface.layer, other.layer + 1);
      }
      mesh.position.z = surface.layer ? -surface.layer * this.thickness * 1.05 : 0;
      placed.push(surface);
    }
  }

  applyFold(custom, fold) {
    const k = THREE.MathUtils.clamp(fold / 100, 0, 1);
    for (const mesh of this.meshes.values()) mesh.position.z = 0;
    for (const n of this.nodes) {
      const angle = custom.angles?.[n.hinge.id] ?? n.hinge.angle ?? 90;
      if (!Number.isFinite(angle) || Math.abs(angle) > 180) throw new Error('折叠角度必须是 -180 到 180 度。');
      const u = THREE.MathUtils.clamp(k * this.maxDepth - (this.maxDepth - n.depth), 0, 1);
      const theta = -n.side * THREE.MathUtils.degToRad(angle) * u * u * (3 - 2 * u);
      n.group.matrix.makeRotationAxis(n.axis, theta);
      n.group.matrix.setPosition(n.anchor.clone().sub(n.anchor.clone().applyMatrix4(n.group.matrix)));
      n.group.matrixWorldNeedsUpdate = true;
    }
    // 在根坐标系计算最低点，整体抬高；不覆盖引擎的拖动/转盒位置。
    this.sheet.position.y = 0; this.root.updateWorldMatrix(true, true);
    const inverse = this.root.matrixWorld.clone().invert(), bounds = new THREE.Box3(), matrix = new THREE.Matrix4(), vertex = new THREE.Vector3();
    if (k > 0) { this.separatePaperLayers(inverse); this.root.updateWorldMatrix(true, true); }
    for (const mesh of this.meshes.values()) {
      matrix.multiplyMatrices(inverse, mesh.matrixWorld);
      const pos = mesh.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) bounds.expandByPoint(vertex.fromBufferAttribute(pos, i).applyMatrix4(matrix));
    }
    this.sheet.position.y = 0.5 - bounds.min.y;
    this.size = bounds.getSize(new THREE.Vector3());
    this.root.updateWorldMatrix(true, true);
  }
}
