import { PROJECT_SCHEMA, PROJECT_VERSION } from '../projects/projects.js';
import { MATS, TPLS } from '../dieline/templates.js';

const DATABASE = 'openbox3d-saved-plans';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new Error(message); };
const idOf = id => typeof id === 'string' && id.trim() && id.length <= 128 ? id : fail('方案编号无效。');
const kindOf = kind => ['design', 'render'].includes(kind) ? kind : fail('方案类型无效。');
const newId = () => globalThis.crypto?.randomUUID?.() || `plan-${Date.now()}-${Math.random().toString(36).slice(2)}`;

// Undefined object fields are optional in makeProject; arrays and non-JSON values must never be silently changed.
function jsonCopy(value) {
  const seen = new Set();
  function check(item, depth = 0) {
    if (depth > 100) fail('方案数据层级过深，无法保存。');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (typeof item !== 'object' || seen.has(item)) fail('方案包含无法保存的数据，请重新打开工程后重试。');
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) fail('方案必须使用工程文件格式保存。');
    seen.add(item);
    if (Object.getOwnPropertySymbols(item).length) fail('方案包含无法保存的数据。');
    if (Array.isArray(item)) { for (const entry of item) check(entry, depth + 1); }
    else for (const entry of Object.values(item)) { if (entry !== undefined) check(entry, depth + 1); }
    seen.delete(item);
  }
  check(value);
  return JSON.parse(JSON.stringify(value));
}

function projectOf(value) {
  if (!object(value) || value.schema !== PROJECT_SCHEMA || value.version !== PROJECT_VERSION || !object(value.meta) || !object(value.box) || !object(value.design) || !Array.isArray(value.design.layers)) fail('方案工程数据无效，请重新保存。');
  if (![...TPLS.map(tpl => tpl.id), 'custom'].includes(value.box.tpl) || !MATS.some(mat => mat.id === value.box.matId) || !['L', 'W', 'H'].every(key => Number.isFinite(value.box[key]) && value.box[key] > 0) || !Number.isInteger(value.design.seq) || value.design.seq < 1) fail('方案工程数据不完整，请重新保存。');
  if (value.box.tpl === 'custom' && (!object(value.box.custom) || value.box.custom.version !== 1 || !Array.isArray(value.box.custom.segs) || !value.box.custom.segs.length)) fail('方案的自定义刀模数据无效。');
  if (!value.design.layers.every(layer => object(layer) && ['text', 'image', 'shape'].includes(layer.kind) && Number.isFinite(layer.x) && Number.isFinite(layer.y))) fail('方案的设计图层数据无效。');
  const ids = value.design.layers.map(layer => layer.id);
  if (new Set(ids).size !== ids.length || !ids.every(id => Number.isInteger(id) && id >= 1 && id < value.design.seq)) fail('方案的图层编号无效。');
  return value;
}

function thumbnailOf(value = '') {
  if (typeof value !== 'string' || (value && !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/.test(value))) fail('方案缩略图无效，请重新生成预览。');
  return value;
}

function recordOf(raw, view = false) {
  const value = jsonCopy(raw);
  if (!object(value) || !['createdAt', 'updatedAt'].every(key => typeof value[key] === 'string' && Number.isFinite(Date.parse(value[key])))) fail('本地方案记录已损坏，无法读取。');
  idOf(value.id);
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 60) fail('本地方案名称无效。');
  thumbnailOf(value.thumbnail);
  if (view) { if (!object(value.camera)) fail('保存的视角数据无效。'); }
  else {
    kindOf(value.kind); projectOf(value.project);
    if (value.renderScene !== undefined && !object(value.renderScene)) fail('渲染场景数据无效。');
  }
  return value;
}

const storageError = error => new Error(error?.name === 'QuotaExceededError'
  ? '浏览器存储空间不足，方案未保存。请导出工程备份并清理空间后重试。'
  : '本地方案库读写失败，请检查浏览器存储权限后重试。');

function transaction(storeName, mode, action) {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('当前浏览器不支持本地方案库，请使用支持 IndexedDB 的浏览器。')); return; }
    let request, blocked = false;
    try { request = indexedDB.open(DATABASE, 1); }
    catch (error) { reject(storageError(error)); return; }
    request.onupgradeneeded = () => {
      const db = request.result;
      const plans = db.createObjectStore('plans', { keyPath: 'id' });
      plans.createIndex('kind', 'kind');
      db.createObjectStore('views', { keyPath: 'id' });
    };
    request.onerror = () => reject(storageError(request.error));
    request.onblocked = () => { blocked = true; reject(new Error('方案库正在被其他页面使用，请关闭其他 OpenBox3D 页面后重试。')); };
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) { db.close(); return; }
      let tx, result, failure;
      try {
        tx = db.transaction(storeName, mode);
        tx.oncomplete = () => { db.close(); resolve(result); };
        tx.onerror = event => { failure ||= storageError(event.target?.error || tx.error); };
        tx.onabort = () => { db.close(); reject(failure || storageError(tx.error)); };
        const abort = error => { failure = error; tx.abort(); };
        action(tx.objectStore(storeName), value => { result = value; }, abort);
      } catch (error) { db.close(); if (tx) tx.abort(); reject(storageError(error)); }
    };
  });
}

function saveRecord(input, view) {
  if (!object(input)) fail('请输入有效的方案数据。');
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, 60) : '';
  if (!name) fail(view ? '请填写视角名称。' : '请填写方案名称。');
  const time = new Date().toISOString();
  const record = recordOf({
    id: input.id === undefined ? newId() : idOf(input.id), name,
    thumbnail: thumbnailOf(input.thumbnail), createdAt: time, updatedAt: time,
    ...(view ? { camera: input.camera } : {
      kind: kindOf(input.kind), project: projectOf(input.project),
      ...(input.renderScene === undefined ? {} : { renderScene: input.renderScene })
    })
  }, view);
  return transaction(view ? 'views' : 'plans', 'readwrite', (store, done, abort) => {
    const read = store.get(record.id);
    read.onsuccess = () => {
      try {
        if (read.result) {
          const previous = recordOf(read.result, view);
          if (!view && previous.kind !== record.kind) fail('无法覆盖不同类型的方案，请另存新方案。');
          record.createdAt = previous.createdAt;
        }
        store.put(record); done(record);
      } catch (error) { abort(error instanceof DOMException ? storageError(error) : error); }
    };
  });
}

export async function savePlan(input) { return saveRecord(input, false); }
export async function saveView(input) { return saveRecord(input, true); }

async function listRecords(view, kind) {
  const rows = await transaction(view ? 'views' : 'plans', 'readonly', (store, done) => {
    const request = view ? store.getAll() : store.index('kind').getAll(kindOf(kind));
    request.onsuccess = () => done(request.result);
  });
  return rows.map(row => recordOf(row, view)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function listPlans(kind) { kindOf(kind); return listRecords(false, kind); }
export async function listViews() { return listRecords(true); }

async function getRecord(id, view) {
  idOf(id);
  const row = await transaction(view ? 'views' : 'plans', 'readonly', (store, done) => {
    const request = store.get(id); request.onsuccess = () => done(request.result);
  });
  return row === undefined ? null : recordOf(row, view);
}
export async function getPlan(id) { return getRecord(id, false); }
export async function getView(id) { return getRecord(id, true); }

async function deleteRecord(id, view) {
  idOf(id);
  await transaction(view ? 'views' : 'plans', 'readwrite', store => store.delete(id));
}
export async function deletePlan(id) { return deleteRecord(id, false); }
export async function deleteView(id) { return deleteRecord(id, true); }
