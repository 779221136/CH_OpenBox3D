import assert from 'node:assert/strict';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BoxEngine } from '../src/render3d/engine.js';
import { RenderSceneController } from '../src/workflow/renderScene.js';

const assertTransform = (actual, expected) => {
  for (const key of ['position', 'quaternion', 'scale']) actual[key].forEach((value, i) => assert.ok(Math.abs(value - expected[key][i]) < 1e-8, `${key}[${i}]`));
};

// 使用正式 Folder 和控制器，无浏览器/伪造业务实现；仅略过 WebGL 和画布烘焙。
const engine = Object.create(BoxEngine.prototype);
Object.assign(engine, {
  T: THREE, ready: true, props: { tpl: 'rte', l: 80, w: 40, h: 120, t: 0.45, fold: 100 },
  scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(35, 4 / 3, 1, 9000),
  el: { clientWidth: 800, clientHeight: 600 }, renderer: { setSize() {}, domElement: Object.assign(new EventTarget(), { style: {} }) },
  faceMat: new THREE.MeshPhysicalMaterial(), coreMat: new THREE.MeshStandardMaterial()
});
engine.controls = new OrbitControls(engine.camera);
engine.camera.position.set(200, 200, 350); engine.controls.target.set(0, 50, 0); engine.controls.update();
engine.build(); engine.applyFold();
const custom = engine.createModel({ tpl: 'custom', fold: 100, sbb: [0, 0, 80, 50], custom: { panels: [{ panelId: 'base', pts: [[0, 0], [80, 0], [80, 50], [0, 50]] }], hinges: [] } });
assert.ok(!new THREE.Box3().setFromObject(custom.root, true).isEmpty(), '异形刀模复用 CustomFolder');
custom.dispose();
const texture = engine.faceMat.map = new THREE.Texture();
const project = { meta: { name: 'A' }, box: { l: 80 }, design: { layers: [] } };
let loads = 0;
const controller = new RenderSceneController(engine, {
  project,
  resolveProject: async doc => { loads++; if (doc.fail || doc.appearance?.fail) throw new Error('bad project'); return { ...engine.props, l: doc.box.l, surfaceRoughness: doc.appearance?.roughness }; }
});
const first = controller.mainId;
assert.equal(controller.selectedId, null, '初始场景须点击模型后再出现工具栏');
assert.equal(controller.transformControls.object, undefined);
assert.equal(controller.bounds.visible, false);
controller.select(first);
assert.equal(controller.mainId, first);
const firstRoot = controller.selected().resource.root;
engine.update({ ...engine.props, bakeKey: 'store update', l: 999 });
assert.equal(controller.selected().resource.root, firstRoot, 'store 更新不能隐式替换选中包装');
assert.equal(engine._bt, undefined);
assert.equal(controller.transformControls.object, firstRoot);
controller.setTransformMode('rotate'); assert.equal(controller.transformControls.mode, 'rotate');
const firstCamera = controller.captureCamera();
assert.equal(controller.setTransform({ position: [10, 20, 30], rotation: [0.4, 0.8, 0.2], scale: [2, 1, 0.7] }), true);
assert.deepEqual(controller.list()[0].transform.position, [10, 20, 30]);
assert.throws(() => controller.setTransform({ scale: [1, 0, 1] }), /大于零/);
assert.throws(() => controller.setTransform({ position: [Infinity, 0, 0] }), /有限数字/);

const second = await controller.duplicate();
assert.equal(controller.list().length, 2); assert.equal(loads, 0, '复制应复用烘焙像素，不重新加载工程');
const duplicateRoot = controller.selected().resource.root;
const sourceMeshes = [], duplicateMeshes = [];
firstRoot.traverse(o => { if (o.isMesh) sourceMeshes.push(o); });
duplicateRoot.traverse(o => { if (o.isMesh) duplicateMeshes.push(o); });
assert.equal(sourceMeshes.length, duplicateMeshes.length);
assert.notEqual(sourceMeshes[0].geometry, duplicateMeshes[0].geometry);
const materialOf = mesh => Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
assert.notEqual(materialOf(sourceMeshes[0]), materialOf(duplicateMeshes[0]));
assert.notEqual(materialOf(sourceMeshes[0]).map, materialOf(duplicateMeshes[0]).map);
assert.equal(materialOf(duplicateMeshes[0]).map.source, texture.source);
assert.deepEqual(controller.list()[0].transform.position, [10, 20, 30], '复制不可移动原模型');

controller.setLocked(true);
assert.equal(controller.transformControls.object, undefined);
const lockedTransform = controller.list()[1].transform;
assert.equal(controller.setTransform({ position: [0, 0, 0] }), false);
assert.equal(controller.drop(), false); assert.equal(controller.remove(), false);
assert.equal(await controller.replace({ ...project, box: { l: 25 } }), false);
assert.deepEqual(controller.list()[1].transform, lockedTransform);
controller.setHidden(true); assert.equal(duplicateRoot.visible, false); assert.equal(controller.bounds.visible, false);
const hiddenCopy = await controller.duplicate();
assert.equal(controller.list().find(model => model.id === hiddenCopy).hidden, false);
assert.equal(controller.selected().resource.root.visible, true, '隐藏模型的副本应可见，与记录一致');
controller.remove();
controller.select(second); controller.setHidden(false); controller.setLocked(false);
controller.drop();
assert.ok(Math.abs(new THREE.Box3().setFromObject(duplicateRoot, true).min.y) < 1e-7, '落地应按旋转缩放后的真实最低点');
const oldTransform = controller.list()[1].transform;
await controller.replace({ ...project, meta: { name: 'B' }, box: { l: 30 } });
assertTransform(controller.list()[1].transform, oldTransform);
assert.deepEqual(controller.captureCamera(), firstCamera, '换包装不应改变相机');
assert.equal(controller.list()[0].project.meta.name, 'A');
const positions = controller.list().map(model => model.transform);
controller.frame(); assert.deepEqual(controller.list().map(model => model.transform), positions, '适配不应重排模型');
controller.select(first); controller.setMain(false); assert.equal(controller.mainId, null);
controller.select(second); controller.setMain(true); assert.equal(controller.mainId, second);

const view = { position: [500, 420, 340], target: [12, 25, -30], up: [0, 1, 0], projection: 'orthographic', fov: 42, zoom: 1.8, orthoHeight: 300 };
controller.applyCamera(view);
assert.equal(controller.transformControls.camera, engine.camera);
const restoredView = controller.captureCamera();
for (const key of ['zoom', 'fov', 'orthoHeight', 'projection']) assert.equal(restoredView[key], view[key]);
assert.ok(new THREE.Vector3(...restoredView.position).distanceTo(new THREE.Vector3(...view.position)) < 1e-8);
controller.setLocked(true); controller.setHidden(true);
const snapshot = controller.snapshot(); assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), snapshot);
controller.select(first); assert.equal(controller.remove(), true);
assert.equal(controller.list().length, 1);
await controller.restore(snapshot);
assert.equal(controller.list().length, 2); assert.equal(controller.mainId, second); assert.equal(controller.selectedId, second);
assert.equal(controller.list()[1].hidden, true); assert.equal(controller.list()[1].locked, true);
assertTransform(controller.list()[1].transform, snapshot.models[1].transform);
const before = controller.snapshot();
await assert.rejects(controller.restore({ ...snapshot, models: [{ ...snapshot.models[0], transform: { scale: [0, 1, 1] } }] }), /大于零/);
assert.deepEqual(controller.snapshot(), before, '失败恢复须保留现有场景');
await assert.rejects(controller.restore({ ...snapshot, models: [{ ...snapshot.models[0], project: { fail: true } }] }), /bad project/);
assert.deepEqual(controller.snapshot(), before);
controller.setHidden(false); controller.setLocked(false);
controller.select(first); controller.setTransform({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
const box = new THREE.Box3().setFromObject(controller.selected().resource.root, true);
const target = box.getCenter(new THREE.Vector3());
engine.switchCamera('perspective'); engine.camera.position.copy(target).add(new THREE.Vector3(0, 0, 500)); engine.controls.target.copy(target); engine.controls.update(); engine.camera.updateMatrixWorld();
assert.equal(controller.pick(new THREE.Vector2(0, 0)), first, '射线应选中模型');
controller.setHelpersVisible(false); assert.equal(controller.bounds.visible, false); assert.equal(controller.transformControls.object, undefined);
controller.setHelpersVisible(true); assert.equal(controller.bounds.visible, true);
const appearanceLoads = loads;
controller.updateAppearance({ roughness: 0.2 });
controller.updateAppearance({ roughness: 0.35 });
assert.equal(controller.snapshot().models.find(model => model.id === first).project.appearance.roughness, 0.35, '快照立即包含防抖期间的材质修改');
controller.setLocked(true); // 已接收的修改不能因为随后锁定而丢失。
controller.select(second); controller.updateAppearance({ roughness: 0.8 }); controller.select(null);
await controller.whenReady();
assert.equal(loads - appearanceLoads, 2, '每个模型合并连续材质更新');
assert.equal(controller.models.get(first).resource.props.surfaceRoughness, 0.35);
assert.equal(controller.models.get(second).resource.props.surfaceRoughness, 0.8);
assert.equal(controller.selectedId, null, '后台材质重建不改变选择');
controller.select(first); controller.setLocked(false); controller.setMain(true);
controller.select(second);
const unchangedB = structuredClone(controller.list().find(model => model.id === second));
const changedDesign = { ...controller.selected().project, box: { l: 95 }, design: { layers: [{ id: 1, kind: 'text', x: 12, y: 18, content: '更新的平面设计' }] } };
controller.select(controller.mainId);
const designTarget = controller.selected();
await controller.updateProject({ ...designTarget.project, box: changedDesign.box, design: changedDesign.design });
assert.deepEqual(controller.models.get(first).project.box, changedDesign.box);
assert.deepEqual(controller.models.get(first).project.design, changedDesign.design);
assert.equal(controller.models.get(first).project.appearance.roughness, 0.35, '从选中 B 的状态同步平面设计时须保留 A 的材质');
assert.equal(controller.models.get(first).resource.props.l, 95);
assert.equal(controller.models.get(first).resource.props.surfaceRoughness, 0.35, 'A 的实际模型须使用更新刀模和原有材质');
assert.deepEqual(controller.list().find(model => model.id === second), unchangedB, '同步 A 不得修改 B 的设计、材质或变换');
controller.select(second); controller.updateAppearance({ fail: true });
await assert.rejects(controller.flush(), /bad project/);
assert.equal(controller.snapshot().models.find(model => model.id === second).project.appearance.fail, true);
await assert.rejects(controller.whenReady(), /bad project/, '失败需保留给后续截图等待捕获');
controller.updateAppearance({ roughness: 0.9 }); await controller.whenReady();
assert.equal(controller.models.get(second).resource.props.surfaceRoughness, 0.9);
controller.updateAppearance({ roughness: 0.55 });
const scheduledAppearance = controller.selected().appearanceJob; controller.select(null); await scheduledAppearance;
assert.equal(controller.models.get(second).resource.props.surfaceRoughness, 0.55, '取消选择后计时器仍须重建原模型');
controller.select(second);
controller.updateAppearance({ roughness: 0.6 });
await controller.replace({ ...project, appearance: { roughness: 0.1 } }); await controller.whenReady();
assert.equal(controller.models.get(second).resource.props.surfaceRoughness, 0.1, '更换包装需取消旧材质计时器');
await controller.restore({ models: [], selectedId: null, mainId: null });
assert.equal(controller.list().length, 0); controller.frame(); engine.frame(); assert.equal(controller.drop(), false);
assert.equal(await controller.replace(project), true, '空场景替换入口须能够添加模型');
assert.equal(controller.list().length, 1); assert.equal(controller.selectedId, controller.mainId);
const addedMain = controller.mainId, added = await controller.add({ ...project, meta: { name: '追加包装' } });
assert.equal(controller.list().length, 2); assert.equal(controller.selectedId, added); assert.equal(controller.mainId, addedMain);
const helper = controller.transformControls.getHelper();
controller.updateAppearance({ roughness: 0.7 }); const closing = controller.whenReady();
controller.dispose(); await assert.rejects(closing, /已关闭/);
assert.equal(engine.renderScene, null); assert.equal(helper.parent, null);
console.log('render scene: real Folder clone/transform/lock/hide/drop/replace/frame/camera/raycast/restore/dispose passed');
