import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

const clone = value => JSON.parse(JSON.stringify(value));
const vector = (value, length = 3) => Array.isArray(value) && value.length === length && value.every(Number.isFinite);
const transformOf = root => ({ position: root.position.toArray(), quaternion: root.quaternion.toArray(), rotation: root.rotation.toArray().slice(0, 3), scale: root.scale.toArray() });

function cancelAppearance(model) {
  clearTimeout(model.appearanceTimer);
  model.appearanceVersion = (model.appearanceVersion || 0) + 1;
  model.loadVersion = (model.loadVersion || 0) + 1;
  model.appearanceResolve?.(); model.appearanceResolve = null;
  model.flushAppearance = null; model.appearanceJob = null; model.appearanceError = null;
}

function applyTransform(root, value = {}) {
  for (const key of ['position', 'rotation', 'scale']) if (value[key] !== undefined && !vector(value[key])) throw new Error('模型变换须为三个有限数字。');
  if (value.quaternion !== undefined && (!vector(value.quaternion, 4) || Math.hypot(...value.quaternion) < 1e-8)) throw new Error('模型旋转数据无效。');
  if (value.scale?.some(v => v <= 0)) throw new Error('模型缩放须大于零。');
  if (value.position) root.position.fromArray(value.position);
  if (value.rotation) root.rotation.set(...value.rotation);
  if (value.quaternion) root.quaternion.fromArray(value.quaternion).normalize();
  if (value.scale) root.scale.fromArray(value.scale);
  root.updateWorldMatrix(true, true);
}

function cloneResource(source) {
  const root = source.root.clone(true), geometries = new Map(), materials = new Map(), textures = new Map();
  root.traverse(object => {
    if (object.geometry) {
      if (!geometries.has(object.geometry)) geometries.set(object.geometry, object.geometry.clone());
      object.geometry = geometries.get(object.geometry);
    }
    const materialOf = material => {
      if (!materials.has(material)) {
        const copy = material.clone();
        for (const [key, texture] of Object.entries(copy)) if (texture?.isTexture) {
          if (!textures.has(texture)) textures.set(texture, texture.clone());
          copy[key] = textures.get(texture);
        }
        materials.set(material, copy);
      }
      return materials.get(material);
    };
    if (object.material) object.material = Array.isArray(object.material) ? object.material.map(materialOf) : materialOf(object.material);
  });
  // 复制共享只读图集像素；修改包装时整体替换资源，纹理/材质/几何的释放互不影响。
  return { root, props: source.props, dispose() {
    root.removeFromParent();
    for (const geometry of geometries.values()) geometry.dispose();
    for (const material of materials.values()) material.dispose();
    for (const texture of textures.values()) texture.dispose();
  } };
}

export class RenderSceneController {
  constructor(engine, { project, resolveProject, onChange = () => {} } = {}) {
    if (!engine?.ready || engine.renderScene) throw new Error('渲染画布尚未就绪或已连接方案。');
    this.engine = engine; this.resolveProject = resolveProject; this.onChange = onChange;
    this.models = new Map(); this.selectedId = null; this.mainId = null; this.mode = 'translate'; this.helpersVisible = true;
    this._restoreVersion = 0; this._disposed = false;
    clearTimeout(engine._bt); clearTimeout(engine._at); engine._fitGoal = null;
    const id = THREE.MathUtils.generateUUID();
    if (project && engine.boxRoot) {
      const resource = engine.createModel(engine.props, true);
      this.models.set(id, { id, project: clone(project), resource, locked: false, hidden: false });
      engine.scene.add(resource.root); this.mainId = id;
    }
    engine.renderScene = this;
    this.bounds = new THREE.Box3Helper(new THREE.Box3(), '#ff7a20');
    this.bounds.material.depthTest = false; this.bounds.material.toneMapped = false; this.bounds.renderOrder = 1000;
    this.bounds.userData.renderHelper = true; engine.scene.add(this.bounds);
    const element = engine.renderer?.domElement;
    if (element) {
      this.transformControls = new TransformControls(engine.camera, element);
      const helper = this.transformControls.getHelper(); helper.userData.renderHelper = true; engine.scene.add(helper);
      this.transformControls.addEventListener('dragging-changed', event => {
        engine.controls.enabled = !event.value;
        engine._fitGoal = null;
        if (!event.value) this.changed();
      });
      this.transformControls.addEventListener('objectChange', () => {
        const root = this.selected()?.resource.root;
        if (root && this.mode === 'scale') root.scale.set(Math.max(0.001, root.scale.x), Math.max(0.001, root.scale.y), Math.max(0.001, root.scale.z));
        this.updateHelpers();
      });
      this._down = event => {
        if (event.button !== 0) return;
        this._click = { x: event.clientX, y: event.clientY, transforming: this.transformControls.dragging || !!this.transformControls.axis };
      };
      this._up = event => {
        const start = this._click; this._click = null;
        if (!start || start.transforming || event.button !== 0 || Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 4) return;
        const rect = element.getBoundingClientRect();
        const ndc = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
        this.select(this.pick(ndc));
      };
      element.addEventListener('pointerdown', this._down);
      element.addEventListener('pointerup', this._up);
      this._cancel = () => { this._click = null; };
      element.addEventListener('pointercancel', this._cancel);
    }
    this.syncSelection();
  }

  list() {
    return [...this.models.values()].map(model => ({
      id: model.id, project: model.project, locked: model.locked, hidden: model.hidden,
      main: model.id === this.mainId, transform: transformOf(model.resource.root)
    }));
  }

  changed() { this.syncSelection(); this.onChange(); }
  selected() { return this.models.get(this.selectedId); }
  select(id) { this.selectedId = this.models.has(id) ? id : null; this.changed(); }
  setMain(main = true) { if (this.selected()) { this.mainId = main ? this.selectedId : this.mainId === this.selectedId ? null : this.mainId; this.changed(); } }
  setLocked(locked) { const model = this.selected(); if (model) { model.locked = !!locked; this.changed(); } }
  setHidden(hidden) { const model = this.selected(); if (model) { model.hidden = !!hidden; model.resource.root.visible = !hidden; this.changed(); } }

  setTransformMode(mode) {
    if (!['translate', 'rotate', 'scale'].includes(mode)) throw new Error('未知模型操作模式。');
    this.mode = mode; this.transformControls?.setMode(mode); this.changed();
  }

  setTransform(transform) {
    const model = this.selected();
    if (!model || model.locked) return false;
    applyTransform(model.resource.root, transform); this.changed(); return true;
  }

  syncSelection() {
    const model = this.selected();
    this.transformControls?.detach();
    if (model && !model.hidden && !model.locked && this.helpersVisible) {
      this.transformControls?.attach(model.resource.root); this.transformControls?.setMode(this.mode);
    }
    this.updateHelpers();
  }

  updateHelpers() {
    const model = this.selected();
    this.bounds.visible = !!(this.helpersVisible && model && !model.hidden);
    if (this.bounds.visible) this.bounds.box.setFromObject(model.resource.root);
  }

  setHelpersVisible(visible) { this.helpersVisible = !!visible; this.syncSelection(); }

  pick(ndc) {
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, this.engine.camera);
    const roots = [...this.models.values()].filter(model => !model.hidden).map(model => model.resource.root);
    for (const root of roots) root.updateWorldMatrix(true, true);
    const hit = ray.intersectObjects(roots, true).find(result => result.object.isMesh);
    if (!hit) return null;
    for (const model of this.models.values()) {
      let object = hit.object;
      while (object) { if (object === model.resource.root) return model.id; object = object.parent; }
    }
    return null;
  }

  async resourceOf(project) {
    if (typeof this.resolveProject !== 'function') throw new Error('缺少包装方案加载器。');
    const props = await this.resolveProject(project);
    if (this._disposed) throw new Error('渲染页面已关闭。');
    const broken = (props.layers || []).some(layer => layer.visible !== false && layer.kind === 'image' && layer.imgSrc && !layer.img);
    if (broken) throw new Error('方案图片未能加载，请重新导入。');
    await globalThis.document?.fonts?.ready;
    if (this._disposed) throw new Error('渲染页面已关闭。');
    return this.engine.createModel(props);
  }

  async duplicate() {
    const source = this.selected(); if (!source) return null;
    await this.whenReady();
    if (this.models.get(source.id) !== source) return null;
    const project = clone(source.project), transform = transformOf(source.resource.root);
    const resource = cloneResource(source.resource);
    applyTransform(resource.root, transform); resource.root.visible = true;
    const bounds = new THREE.Box3().setFromObject(source.resource.root, true);
    resource.root.position.x += Math.max(10, bounds.max.x - bounds.min.x) * 1.15;
    const id = THREE.MathUtils.generateUUID();
    this.models.set(id, { id, project, resource, locked: false, hidden: false });
    this.engine.scene.add(resource.root); this.selectedId = id; this.changed(); return id;
  }

  async add(project) {
    const copy = clone(project), resource = await this.resourceOf(copy), id = THREE.MathUtils.generateUUID();
    const wasEmpty = !this.models.size;
    if (wasEmpty) this.mainId = id;
    this.models.set(id, { id, project: copy, resource, locked: false, hidden: false });
    this.engine.scene.add(resource.root); this.selectedId = id;
    if (wasEmpty) this.frame();
    this.changed(); return id;
  }

  async replace(project, id = this.selectedId, fromAppearance = false) {
    const model = this.models.get(id);
    if (!model) return this.models.size ? false : !!(await this.add(project));
    if (model.locked && !fromAppearance) return false;
    if (!fromAppearance) cancelAppearance(model);
    const version = model.loadVersion = (model.loadVersion || 0) + 1;
    const copy = clone(project), resource = await this.resourceOf(copy);
    if (this.models.get(model.id) !== model || model.loadVersion !== version || (model.locked && !fromAppearance)) { resource.dispose(); return false; }
    applyTransform(resource.root, transformOf(model.resource.root)); resource.root.visible = !model.hidden;
    model.resource.dispose(); model.resource = resource; model.project = copy;
    this.engine.scene.add(resource.root); this.changed(); return true;
  }

  updateProject(project) { return this.replace(project); }

  updateAppearance(appearance) {
    const model = this.selected(); if (!model || model.locked) return false;
    const project = { ...model.project, appearance: clone(appearance) };
    cancelAppearance(model); model.project = project;
    const version = model.appearanceVersion;
    model.appearanceJob = new Promise(resolve => {
      model.appearanceResolve = resolve;
      model.flushAppearance = () => {
        clearTimeout(model.appearanceTimer); model.flushAppearance = null;
        this.replace(project, model.id, true).catch(error => {
          if (model.appearanceVersion === version) model.appearanceError = error;
        }).finally(() => {
          resolve();
          if (model.appearanceVersion === version) { model.appearanceResolve = null; this.onChange(); }
        });
      };
      model.appearanceTimer = setTimeout(model.flushAppearance, 250);
    });
    this.changed(); return true;
  }

  async whenReady() {
    for (;;) {
      if (this._disposed) throw new Error('渲染页面已关闭。');
      const models = [...this.models.values()];
      for (const model of models) model.flushAppearance?.();
      const jobs = models.map(model => model.appearanceJob).filter(Boolean);
      await Promise.all(jobs);
      if (this._disposed) throw new Error('渲染页面已关闭。');
      if ([...this.models.values()].some(model => model.appearanceJob && !jobs.includes(model.appearanceJob))) continue;
      const error = [...this.models.values()].find(model => model.appearanceError)?.appearanceError;
      if (error) throw error;
      return;
    }
  }

  flush() { return this.whenReady(); }

  remove() {
    const model = this.selected(); if (!model || model.locked) return false;
    cancelAppearance(model);
    this.transformControls?.detach(); model.resource.dispose(); this.models.delete(model.id);
    if (this.mainId === model.id) this.mainId = null;
    this.selectedId = null; this.changed(); return true;
  }

  drop() {
    const model = this.selected(); if (!model || model.locked) return false;
    const box = new THREE.Box3().setFromObject(model.resource.root, true);
    if (!box.isEmpty()) model.resource.root.position.y -= box.min.y;
    this.changed(); return true;
  }

  frame() {
    const main = this.models.get(this.mainId);
    const models = main && !main.hidden ? [main] : [...this.models.values()].filter(model => !model.hidden);
    const box = new THREE.Box3(); for (const model of models) box.union(new THREE.Box3().setFromObject(model.resource.root, true));
    if (box.isEmpty()) return;
    const engine = this.engine, size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const camera = engine.camera, aspect = camera.aspect || (camera.right - camera.left) / (camera.top - camera.bottom) || 1;
    const height = Math.max(size.y, size.x / Math.min(1, aspect), size.z, 10) * 1.8;
    const radius = height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov || 35) / 2));
    const direction = camera.position.clone().sub(engine.controls.target).normalize();
    if (direction.lengthSq() < 0.1) direction.set(1, 0.7, 1).normalize();
    engine._fitGoal = null; engine._fitR = radius; engine._fitH = size.y;
    camera.position.copy(center).addScaledVector(direction, radius); engine.controls.target.copy(center);
    if (camera.isOrthographicCamera) { engine._orthoHeight = height; camera.zoom = 1; engine.syncOrthoFrustum(); }
    engine.controls.update();
  }

  captureCamera() { return this.engine.captureCamera(); }
  applyCamera(view) { this.engine.applyCamera(view); this.onChange(); }
  snapshot() { return clone({ models: this.list(), selectedId: this.selectedId, mainId: this.mainId, camera: this.captureCamera() }); }

  async restore(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.models) || snapshot.models.length > 100) throw new Error('渲染方案模型列表无效。');
    const version = ++this._restoreVersion, next = new Map();
    try {
      for (const entry of snapshot.models) {
        if (!entry || typeof entry.id !== 'string' || !entry.id || next.has(entry.id) || !entry.project || !entry.transform) throw new Error('渲染方案模型数据无效。');
        const resource = await this.resourceOf(entry.project);
        const model = { id: entry.id, project: clone(entry.project), resource, locked: !!entry.locked, hidden: !!entry.hidden };
        next.set(entry.id, model); applyTransform(resource.root, entry.transform); resource.root.visible = !model.hidden;
      }
      if (this._disposed || version !== this._restoreVersion) { for (const model of next.values()) model.resource.dispose(); return false; }
      if (snapshot.camera) this.engine.applyCamera(snapshot.camera);
    } catch (error) { for (const model of next.values()) model.resource.dispose(); throw error; }
    this.transformControls?.detach(); for (const model of this.models.values()) { cancelAppearance(model); model.resource.dispose(); }
    this.models = next; for (const model of next.values()) this.engine.scene.add(model.resource.root);
    this.mainId = next.has(snapshot.mainId) ? snapshot.mainId : null;
    this.selectedId = next.has(snapshot.selectedId) ? snapshot.selectedId : null;
    this.changed(); return true;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true; this._restoreVersion++;
    const element = this.engine.renderer?.domElement;
    if (element) { element.removeEventListener('pointerdown', this._down); element.removeEventListener('pointerup', this._up); element.removeEventListener('pointercancel', this._cancel); }
    this.transformControls?.detach(); this.transformControls?.getHelper().removeFromParent(); this.transformControls?.dispose();
    this.bounds.removeFromParent(); this.bounds.geometry.dispose(); this.bounds.material.dispose();
    for (const model of this.models.values()) { cancelAppearance(model); model.resource.dispose(); } this.models.clear();
    this.engine.controls.enabled = true;
    if (this.engine.renderScene === this) this.engine.renderScene = null;
  }
}
