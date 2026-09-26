import assert from 'node:assert/strict';
import { makeProject, projectStateOf } from '../src/projects/projects.js';
import { savePlan, listPlans, getPlan, deletePlan, saveView, listViews, deleteView } from '../src/workflow/savedPlans.js';

// Small transactional stub: the browser check covers IndexedDB itself; this check covers our record contract.
const tables = { plans: new Map(), views: new Map() };
let failWrite = false;
globalThis.indexedDB = { open: () => {
  const request = {};
  request.result = { close() {}, transaction(name, mode) {
    const rows = new Map(structuredClone([...tables[name]]));
    let pending = 0, aborted = false;
    const tx = { abort() { aborted = true; queueMicrotask(() => tx.onabort?.()); } };
    const operation = fn => {
      const req = {}; pending++;
      queueMicrotask(() => {
        if (aborted) return;
        try { req.result = structuredClone(fn()); req.onsuccess?.(); }
        catch (error) { tx.error = error; tx.abort(); }
        pending--;
        queueMicrotask(() => {
          if (pending || aborted) return;
          if (mode === 'readwrite') tables[name] = rows;
          tx.oncomplete?.();
        });
      });
      return req;
    };
    tx.objectStore = () => ({
      get: id => operation(() => rows.get(id)),
      getAll: () => operation(() => [...rows.values()]),
      index: () => ({ getAll: kind => operation(() => [...rows.values()].filter(row => row.kind === kind)) }),
      put: row => operation(() => {
        if (failWrite) { failWrite = false; throw new DOMException('full', 'QuotaExceededError'); }
        rows.set(row.id, structuredClone(row)); return row.id;
      }),
      delete: id => operation(() => rows.delete(id))
    });
    return tx;
  } };
  queueMicrotask(() => request.onsuccess?.());
  return request;
} };

const state = {
  tpl: 'rte', L: 80, W: 40, H: 120, matId: 'sbs350', bleed: 3, glue: 14, ovr: {}, typeOvr: {},
  layers: [{ id: 1, kind: 'text', x: 20, y: 30, content: '中文设计', size: 6, visible: true, heroPreset: undefined }],
  seq: 2, fx: { foil: true }, embDir: 'up', filmClearcoatRoughness3d: 0.5
};
const project = makeProject(state, { name: '原始工程' });
const thumbnail = 'data:image/png;base64,YWJj';
const saved = await savePlan({ kind: 'design', name: ' 测试方案 ', thumbnail, project });
assert.equal(saved.name, '测试方案');
assert.equal((await listPlans('design')).length, 1);
assert.equal((await listPlans('render')).length, 0);
assert.deepEqual((await projectStateOf((await getPlan(saved.id)).project)).layers, JSON.parse(JSON.stringify(state.layers)));
project.design.layers[0].content = '外部修改';
saved.project.design.layers[0].content = '返回对象修改';
assert.equal((await getPlan(saved.id)).project.design.layers[0].content, '中文设计', 'Saving must detach state and return objects from persisted records.');

const old = tables.plans.get(saved.id);
old.createdAt = '2020-01-01T00:00:00.000Z';
const updated = await savePlan({ ...old, name: '再次保存' });
assert.equal(updated.createdAt, old.createdAt);
assert.equal((await listPlans('design')).length, 1, 'Saving an existing id must update it.');
await assert.rejects(savePlan({ ...updated, kind: 'render' }), /不同类型/);
failWrite = true;
await assert.rejects(savePlan({ ...updated, name: '不应写入' }), /空间不足/);
assert.equal((await getPlan(updated.id)).name, '再次保存', 'A failed transaction must leave the original intact.');

const scene = { camera: { position: [0, 10, 20], target: [0, 0, 0] }, models: [{ visible: true, scale: [1, 1, 1] }] };
const imageSource = 'data:image/png;base64,' + 'A'.repeat(6 * 1024 * 1024);
const imageProject = makeProject({ ...state, seq: 3, layers: [...state.layers, { id: 2, kind: 'image', x: 0, y: 0, w: 20, h: 20, imgSrc: imageSource, img: { browserOnly: true } }] });
const render = await savePlan({ kind: 'render', name: '渲染方案', project: imageProject, renderScene: scene });
assert.deepEqual((await getPlan(render.id)).renderScene, scene);
assert.equal((await getPlan(render.id)).project.design.layers[1].imgSrc, imageSource, 'Images above the localStorage limit must stay intact.');
assert.equal('img' in render.project.design.layers[1], false, 'makeProject must remove live browser image objects.');
const view = await saveView({ name: '正面', camera: scene.camera, thumbnail });
assert.deepEqual((await listViews())[0].camera, scene.camera);
await deleteView(view.id); assert.deepEqual(await listViews(), []);

const cycle = {}; cycle.self = cycle;
for (const renderScene of [cycle, { invalid: NaN }, { invalid: () => 1 }, { invalid: new Map() }, { invalid: [undefined] }]) {
  await assert.rejects(savePlan({ kind: 'render', name: '无效数据', project, renderScene }), /方案/);
}
await assert.rejects(savePlan({ kind: 'design', name: '错误图片', thumbnail: 'javascript:alert(1)', project }), /缩略图无效/);
await assert.rejects(savePlan({ kind: 'design', name: '错误工程', project: {} }), /工程数据无效/);
tables.plans.get(saved.id).project.schema = 'corrupt';
await assert.rejects(getPlan(saved.id), /工程数据无效/);
await assert.rejects(listPlans('design'), /工程数据无效/);
await deletePlan(saved.id); assert.equal(await getPlan(saved.id), null);
await deletePlan(render.id); assert.deepEqual(await listPlans('render'), []);
delete globalThis.indexedDB;
await assert.rejects(listPlans('design'), /不支持本地方案库/);
console.log('Saved-plan checks passed: project round trip, detached snapshots, typed lists, atomic updates/failures, view snapshots, corrupt records, JSON validation.');
