// Box3D 工程文件（.boxproj）：盒型/设计/正式材质/正式场景；纯本地文件导入导出，无服务端
import { storeToRig, rigToStorePatch } from '../render3d/rig.js';
import { normalizeMaterial, materialToStorePatch } from '../render3d/materialPresets.js';
import { asset } from '../asset.js';
import { prepareCustom } from '../dieline/custom.js';

export const PROJECT_SCHEMA = 'box3d-project';
export const PROJECT_VERSION = 1;

const BOX_FIELDS = ['tpl', 'L', 'W', 'H', 'matId', 'bleed', 'glue', 'ovr', 'typeOvr'];
const copyFields = (src, fields) => Object.fromEntries(fields.map(k => [k, structuredClone(src[k])]));
const cleanLayer = layer => {
  const out = { ...layer };
  delete out.img;
  return out;
};
const newId = () => crypto.randomUUID ? crypto.randomUUID() : 'project-' + Date.now().toString(36);
const now = () => new Date().toISOString();

export function makeProject(state, meta = {}) {
  const time = now();
  return {
    schema: PROJECT_SCHEMA,
    version: PROJECT_VERSION,
    meta: {
      id: meta.id || newId(),
      name: String(meta.name || '未命名包装工程').trim().slice(0, 60) || '未命名包装工程',
      createdAt: meta.createdAt || time,
      updatedAt: time,
      thumbnail: typeof state.projectThumbnail === 'string' && state.projectThumbnail.startsWith('data:image/')
        ? state.projectThumbnail
        : (typeof meta.thumbnail === 'string' ? meta.thumbnail : '')
    },
    box: {
      ...copyFields(state, BOX_FIELDS),
      ...(state.tpl === 'custom' ? { custom: copyFields(state.custom, ['version', 'name', 'sourceUnits', 'sourceWarnings', 'segs', 'root', 'angles']) } : {})
    },
    design: { layers: state.layers.map(cleanLayer), seq: state.seq },
    appearance: {
      material: normalizeMaterial(state),
      fx: structuredClone(state.fx),
      embDir: state.embDir
    },
    scene: storeToRig(state)
  };
}

function assertProject(doc) {
  if (!doc || doc.schema !== PROJECT_SCHEMA || doc.version !== PROJECT_VERSION || !doc.meta || !doc.box || !doc.design || !Array.isArray(doc.design.layers)) {
    throw new Error('不是有效的 Box3D 工程文件。');
  }
  return doc;
}

const imageOf = src => new Promise(resolve => {
  if (!src) return resolve(null);
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => resolve(null);
  img.src = src[0] === '/' ? asset(src) : src; // 站点绝对路径过 base 前缀（GitHub Pages 子路径）；data:/http(s): 原样
});

export async function projectStateOf(raw, view = 'design') {
  const doc = assertProject(raw);
  // Derived faces are rebuilt at the file boundary; imported JSON cannot inject renderer geometry.
  const custom = doc.box.tpl === 'custom' ? prepareCustom(doc.box.custom) : null;
  const layers = await Promise.all(doc.design.layers.map(async layer => {
    const clean = { ...layer };
    const img = await imageOf(clean.imgSrc);
    return img ? { ...clean, img } : clean;
  }));
  return {
    ...copyFields(doc.box, BOX_FIELDS),
    custom,
    layers,
    seq: doc.design.seq,
    ...materialToStorePatch(doc.appearance && doc.appearance.material),
    fx: doc.appearance && doc.appearance.fx ? structuredClone(doc.appearance.fx) : undefined,
    embDir: doc.appearance && doc.appearance.embDir || 'up',
    ...rigToStorePatch(doc.scene),
    view,
    sel: null,
    selSeg: null,
    editMode: false,
    uiCrop: false,
    foldFromQuery: false,
    projectThumbnail: typeof doc.meta.thumbnail === 'string' ? doc.meta.thumbnail : '',
    fitNonce: Date.now()
  };
}

export function downloadProject(state, meta) {
  const project = makeProject(state, meta);
  const a = document.createElement('a');
  const url = URL.createObjectURL(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }));
  a.href = url;
  a.download = project.meta.name.replace(/[\\/:*?"<>|]+/g, '-') + '.boxproj';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function chooseProjectFile() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.boxproj,application/json';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return resolve(null);
      try {
        const doc = assertProject(JSON.parse(await file.text()));
        doc.meta = { ...doc.meta, id: newId(), name: doc.meta.name || file.name.replace(/\.boxproj$/i, ''), createdAt: now(), updatedAt: now() };
        resolve(doc);
      } catch (e) { reject(e); }
    };
    input.click();
  });
}
