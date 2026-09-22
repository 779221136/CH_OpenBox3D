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
// 导入将 fold 重置为 0 时，150 ms 防抖重建之前仍可能持有旧的内置 Folder。
assert.doesNotThrow(() => BoxEngine.prototype.applyFold.call({
  folder: { applyFold() {} }, pieces: [], props: { tpl: 'custom' }, num: () => 0, studio: {}
}));
root.traverse(o => o.geometry?.dispose()); material.dispose();
console.log('Custom fold checks passed: shared arbitrary hinges, signed angles, forest, ground clearance, holes and atlas UV.');
