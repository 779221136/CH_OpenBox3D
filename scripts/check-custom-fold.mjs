import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CustomFolder } from '../src/render3d/customFold.js';
import { BoxEngine } from '../src/render3d/engine.js';

const custom = {
  root: 'base',
  panels: [
    { panelId: 'base', pts: [[0, 0], [20, 0], [20, 20], [0, 20]], holes: [[[5, 5], [9, 5], [9, 9], [5, 9]]] },
    { panelId: 'side', pts: [[20, 0], [40, -10], [40, 20], [20, 20]] },
    { panelId: 'flap', pts: [[20, 0], [40, -10], [35, -20], [15, -10]] },
    { panelId: 'loose', pts: [[60, 0], [65, 0], [65, 5], [60, 5]] }
  ],
  hinges: [
    { id: 'vertical', a: 'base', b: 'side', edge: [[20, 0], [20, 20]], angle: 90 },
    { id: 'diagonal', a: 'side', b: 'flap', edge: [[20, 0], [40, -10]], angle: 100 }
  ],
  angles: {}
};
const sbb = [0, -20, 65, 20], innerUV = [0.01, 0.99], t = 0.45;
const material = new THREE.MeshBasicMaterial();
const folder = new CustomFolder(THREE, sbb, innerUV);
const root = folder.build(custom, t, material, material);
assert.equal(folder.nodes.length, 2);
assert.equal(folder.maxDepth, 2);
assert.equal(folder.meshes.size, 4, 'Unconnected panels must remain visible.');
const localPoint = ([x, y]) => new THREE.Vector3(x - folder.origin[0], folder.origin[1] - y, 0);
const worldPoint = (id, p) => localPoint(p).applyMatrix4(folder.meshes.get(id).matrixWorld);
const close = (a, b) => assert.ok(a.distanceTo(b) < 1e-7, `${a.toArray()} != ${b.toArray()}`);
for (const fold of [0, 25, 50, 80, 100, 0]) {
  folder.applyFold(custom, fold);
  for (const hinge of custom.hinges) for (const p of hinge.edge) close(worldPoint(hinge.a, p), worldPoint(hinge.b, p));
  const bounds = new THREE.Box3().setFromObject(root, true);
  assert.ok(Math.abs(bounds.min.y - 0.5) < 1e-7, 'Paper must touch its ground clearance without floating.');
}
folder.applyFold(custom, 100);
const sideCenter = () => worldPoint('side', [30, 10]).y - worldPoint('base', [20, 10]).y;
assert.ok(sideCenter() < 0, 'Positive angle must fold toward the back of the printed surface.');
custom.angles.vertical = -90;
folder.applyFold(custom, 100);
assert.ok(sideCenter() > 0, 'A negative angle must reverse the fold.');
custom.angles.vertical = 0;
folder.applyFold(custom, 100);
assert.ok(Math.abs(sideCenter()) < 1e-7, 'Zero angle must keep the panel flat.');

let baseArea = 0;
for (const [id, mesh] of folder.meshes) {
  const { position: pos, uv } = mesh.geometry.attributes, caps = mesh.geometry.groups[0];
  for (let i = caps.start; i < caps.start + caps.count; i++) {
    if (Math.abs(pos.getZ(i) - t) < 1e-6) {
      const x = pos.getX(i) + folder.origin[0], y = folder.origin[1] - pos.getY(i);
      assert.ok(Math.abs(uv.getX(i) - (x - sbb[0]) / (sbb[2] - sbb[0])) < 1e-7);
      assert.ok(Math.abs(uv.getY(i) - (1 - (y - sbb[1]) / (sbb[3] - sbb[1]))) < 1e-7);
      if (id === 'base' && i % 3 === 0) {
        const a = new THREE.Vector3().fromBufferAttribute(pos, i), b = new THREE.Vector3().fromBufferAttribute(pos, i + 1), c = new THREE.Vector3().fromBufferAttribute(pos, i + 2);
        baseArea += b.sub(a).cross(c.sub(a)).length() / 2;
      }
    } else {
      assert.ok(Math.abs(uv.getX(i) - innerUV[0]) < 1e-7);
      assert.ok(Math.abs(uv.getY(i) - innerUV[1]) < 1e-7);
    }
  }
}
assert.ok(Math.abs(baseArea - 384) < 1e-7, 'The hole must be absent from the cap triangles.');
assert.throws(() => folder.applyFold({ ...custom, angles: { vertical: NaN } }, 100), /角度/);
// 导入将 fold 重置为 0 时，防抖重建之前仍可能持有旧的内置 Folder。
assert.doesNotThrow(() => BoxEngine.prototype.applyFold.call({
  folder: { applyFold() {} }, pieces: [], props: { tpl: 'custom' }, num: () => 0, studio: {}
}));
for (const fixed of ['base', 'flap']) {
  const selectedFolder = new CustomFolder(THREE, sbb), data = { ...custom, root: fixed, angles: { vertical: -65, diagonal: 135 } };
  const selectedRoot = selectedFolder.build(data, t, material, material);
  for (const hinge of data.hinges) {
    selectedFolder.setSelectedHinge(hinge.id);
    const line = selectedFolder.hingeHighlight;
    assert.equal(line.userData.hingeId, hinge.id);
    for (const progress of [0, 50, 100]) {
      selectedFolder.applyFold(data, progress);
      hinge.edge.forEach(([x, y], i) => {
        const actual = new THREE.Vector3().fromBufferAttribute(line.geometry.attributes.position, i).applyMatrix4(line.matrixWorld);
        const expected = new THREE.Vector3(x - selectedFolder.origin[0], selectedFolder.origin[1] - y, 0).applyMatrix4(selectedFolder.meshes.get(hinge.a).matrixWorld);
        close(actual, expected);
      });
      const paperBounds = new THREE.Box3();
      for (const mesh of selectedFolder.meshes.values()) paperBounds.union(new THREE.Box3().setFromObject(mesh, true));
      const highlightedBounds = new THREE.Box3().setFromObject(selectedRoot, true);
      close(highlightedBounds.min, paperBounds.min); close(highlightedBounds.max, paperBounds.max);
    }
    let disposed = 0;
    line.geometry.addEventListener('dispose', () => disposed++); line.material.addEventListener('dispose', () => disposed++);
    selectedFolder.setSelectedHinge(null);
    assert.equal(disposed, 2, 'Deselection must release both highlight geometry and material.');
    assert.equal(line.parent, null); assert.equal(selectedFolder.hingeHighlight, null);
  }
  selectedFolder.setSelectedHinge('missing'); assert.equal(selectedFolder.hingeHighlight, null);
  selectedRoot.traverse(o => o.geometry?.dispose());
}
let selectedId;
const selectionOnly = { ready: true, props: {}, folder: { setSelectedHinge: id => { selectedId = id; } } };
BoxEngine.prototype.update.call(selectionOnly, { selectedHingeId: 'diagonal' });
assert.equal(selectedId, 'diagonal');
assert.ok(!selectionOnly._bt && !selectionOnly._at, 'Selection must not schedule geometry rebuilding or atlas baking.');

// Closed mailer: front/back wings and lid flap occupy the same plane as the right wall.
const rectangle = (panelId, x, y, w, h) => ({ panelId, pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] });
const stacked = {
  root: 'base', angles: {},
  panels: [rectangle('base', 0, 0, 20, 20), rectangle('wall', 20, 0, 5, 20), rectangle('front', 0, 20, 20, 5), rectangle('front-wing', 20, 20, 5, 5),
    rectangle('back', 0, -5, 20, 5), rectangle('back-wing', 20, -5, 5, 5), rectangle('lid', 0, -25, 20, 20), rectangle('lid-wing', 20, -25, 3, 20)],
  hinges: [
    { id: 'wall', a: 'base', b: 'wall', edge: [[20, 0], [20, 20]] },
    { id: 'front', a: 'base', b: 'front', edge: [[0, 20], [20, 20]] },
    { id: 'front-wing', a: 'front', b: 'front-wing', edge: [[20, 20], [20, 25]] },
    { id: 'back', a: 'base', b: 'back', edge: [[0, 0], [20, 0]] },
    { id: 'back-wing', a: 'back', b: 'back-wing', edge: [[20, -5], [20, 0]] },
    { id: 'lid', a: 'back', b: 'lid', edge: [[0, -5], [20, -5]] },
    { id: 'lid-wing', a: 'lid', b: 'lid-wing', edge: [[20, -25], [20, -5]] }
  ]
};
const layered = new CustomFolder(THREE, [0, -25, 25, 25]);
const layeredRoot = layered.build(stacked, t, material, material);
const uvBefore = [...layered.meshes].map(([id, mesh]) => [id, [...mesh.geometry.attributes.uv.array]]);
for (const progress of [100, 0, 55, 100, 100]) {
  layered.applyFold(stacked, progress);
  assert.equal(layered.meshes.get('wall').position.z, 0, 'The larger outside wall must retain its original plane.');
  if (progress === 0) for (const mesh of layered.meshes.values()) assert.equal(mesh.position.z, 0, 'Unfolding must remove every paper stacking offset.');
  if (progress === 100) {
    const lid = layered.meshes.get('lid-wing').position.z, wing = layered.meshes.get('front-wing').position.z;
    assert.ok(lid <= -t && wing <= lid - t, 'Overlapping lid/front wings must occupy distinct paper layers behind the wall.');
    assert.equal(layered.meshes.get('back-wing').position.z, wing, 'Disjoint front/back wings can share the same inner layer.');
    layered.setSelectedHinge('front-wing');
    layeredRoot.updateWorldMatrix(true, true);
    const hinge = layered.nodes.find(n => n.hinge.id === 'front-wing'), line = layered.hingeHighlight;
    hinge.hinge.edge.forEach(([x, y], i) => close(
      new THREE.Vector3().fromBufferAttribute(line.geometry.attributes.position, i).applyMatrix4(line.matrixWorld),
      new THREE.Vector3(x - layered.origin[0], layered.origin[1] - y, 0).applyMatrix4(hinge.group.matrixWorld)
    ));
  }
}
layered.applyFold({ ...stacked, angles: { 'front-wing': 0 } }, 100);
assert.equal(layered.meshes.get('front-wing').position.z, 0, 'Changing an overlapping flap to another plane must clear its previous offset.');
assert.deepEqual([...layered.meshes].map(([id, mesh]) => [id, [...mesh.geometry.attributes.uv.array]]), uvBefore, 'Paper separation must never change print coordinates.');
layered.setSelectedHinge(null); layeredRoot.traverse(o => o.geometry?.dispose());

const diagonalPoint = ([x, y]) => [(x - y) / Math.sqrt(2), (x + y) / Math.sqrt(2)];
const diagonalStack = { ...stacked, panels: stacked.panels.map(p => ({ ...p, pts: p.pts.map(diagonalPoint) })), hinges: stacked.hinges.map(h => ({ ...h, edge: h.edge.map(diagonalPoint) })) };
const diagonalLayers = new CustomFolder(THREE, [-40, -40, 40, 40]);
const diagonalRoot = diagonalLayers.build(diagonalStack, t, material, material);
diagonalLayers.applyFold(diagonalStack, 100);
assert.equal(diagonalLayers.meshes.get('wall').position.z, 0);
assert.ok(diagonalLayers.meshes.get('front-wing').position.z <= diagonalLayers.meshes.get('lid-wing').position.z - t, 'Oblique coplanar panels must use the same projection axes.');
diagonalRoot.traverse(o => o.geometry?.dispose());
const disjoint = { root: 'a', panels: [{ panelId: 'a', pts: [[0, 0], [10, 0], [0, 10]] }, { panelId: 'b', pts: [[10, 10], [2, 10], [10, 2]] }], hinges: [] };
const disjointFolder = new CustomFolder(THREE, [0, 0, 10, 10]), disjointRoot = disjointFolder.build(disjoint, t, material, material);
disjointFolder.applyFold(disjoint, 100);
assert.ok([...disjointFolder.meshes.values()].every(m => m.position.z === 0), 'Overlapping bounding boxes alone must not move disjoint paper shapes.');
disjointRoot.traverse(o => o.geometry?.dispose());
root.traverse(o => o.geometry?.dispose()); material.dispose();
console.log('Custom fold checks passed: hinges, signed angles, forest, ground clearance, holes, atlas UV, selected crease alignment and overlapping paper layers.');
