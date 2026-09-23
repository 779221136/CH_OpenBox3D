import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDxf, decodeDxf } from '../src/dieline/dxf.js';
import { prepareCustom } from '../src/dieline/custom.js';
import { geomOf } from '../src/dieline/geom.js';
import { chooseProjectFile, makeProject, projectStateOf } from '../src/projects/projects.js';
import { containerAt, clipPtsOf, containerOfLayer, bindLayersToContainers, reflowLayersToContainers } from '../src/design/containers.js';
import { drawLayer, warnsOf, dpiOf } from '../src/design/layers.js';
import { pageBoxes } from '../src/export/pdf.js';
import * as THREE from 'three';
import { CustomFolder } from '../src/render3d/customFold.js';

const entity = (type, ...pairs) => [0, type, ...pairs];
const dxf = (entities, units = 4, tables = [], blocks = []) => [0, 'SECTION', 2, 'HEADER', 9, '$INSUNITS', 70, units, 0, 'ENDSEC', 0, 'SECTION', 2, 'TABLES', ...tables, 0, 'ENDSEC', 0, 'SECTION', 2, 'BLOCKS', ...blocks.flat(), 0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES', ...entities.flat(), 0, 'ENDSEC', 0, 'EOF'].join('\n') + '\n';
const line = (color, x, y, x2, y2) => entity('LINE', 62, color, 10, x, 20, y, 11, x2, 21, y2);
const rect = (x, y, w, h) => entity('LWPOLYLINE', 62, 1, 90, 4, 70, 1, 10, x, 20, y, 10, x + w, 20, y, 10, x + w, 20, y + h, 10, x, 20, y + h);
const twoFaces = dxf([rect(10, 20, 40, 20), line(3, 30, 20, 30, 40)]);
const custom = prepareCustom({ ...parseDxf(twoFaces), name: '回归测试盒' });
assert.equal(custom.panels.length, 2);
assert.equal(custom.hinges.length, 1);
const state = { tpl: 'custom', custom, L: 60, W: 60, H: 60, matId: 'art200', bleed: 3, glue: 14, ovr: {}, typeOvr: {}, layers: [], seq: 1, fx: {}, embDir: 'up' };
const g = geomOf(state, 0.22);
assert.deepEqual(g.sbb, [0, 0, 40, 20]);
assert.ok(Math.abs(g.cutLen - 120) < 1e-6);
assert.ok(Math.abs(g.creaseLen - 20) < 1e-6);
assert.equal(pageBoxes(state, g).Wmm, 46);
assert.throws(() => pageBoxes(state, { sbb: [0, 0, 10000, 10000] }), /容量/);
assert.deepEqual(geomOf(state, 1.5).sbb, g.sbb, 'DXF dimensions must not gain template paper compensation.');
const inch = prepareCustom(parseDxf(dxf([rect(0, 0, 2, 1)], 1)));
assert.ok(Math.abs(geomOf({ ...state, custom: inch }, 0.22).sbb[2] - 50.8) < 1e-6);
const cm = parseDxf(dxf([rect(0, 0, 2, 1)], 0), { unitScale: 10 });
assert.ok(cm.warnings.length, 'Unitless drawings must disclose the chosen scale.');
assert.equal(geomOf({ ...state, custom: prepareCustom(cm) }, 0.22).sbb[2], 20);

const arc = parseDxf(dxf([line(1, 0, 0, 0, 20), entity('ARC', 62, 1, 10, 0, 20, 10, 40, 10, 50, 270, 51, 90)]));
assert.ok(arc.segs[1].pts.length > 4);
assert.equal(prepareCustom(arc).panels.length, 1);
const bulge = entity('LWPOLYLINE', 62, 1, 90, 2, 70, 1, 10, 0, 20, 0, 42, 1, 10, 20, 20, 0, 42, 0);
assert.ok(parseDxf(dxf([bulge])).segs[0].pts.length > 4, 'Bulge must form a sampled arc, not a straight chord.');
const legacy = dxf([entity('POLYLINE', 62, 1, 70, 1), entity('VERTEX', 10, 0, 20, 0), entity('VERTEX', 10, 20, 20, 0), entity('VERTEX', 10, 20, 20, 10), entity('VERTEX', 10, 0, 20, 10), entity('SEQEND')]);
assert.equal(prepareCustom(parseDxf(legacy)).panels.length, 1);
const layered = dxf([entity('LINE', 8, 'crease', 10, 0, 20, 0, 11, 10, 21, 0)], 4, entity('LAYER', 2, 'crease', 62, 3));
assert.equal(parseDxf(layered).segs[0].t, 'crease');
const block = [entity('BLOCK', 2, 'crease-block', 10, 2, 20, 3), line(0, 2, 3, 3, 3), entity('ENDBLK')];
const inserted = parseDxf(dxf([entity('INSERT', 2, 'crease-block', 62, 3, 10, 10, 20, 20, 41, 2, 42, 3, 50, 90)], 4, [], block));
assert.equal(inserted.segs[0].t, 'crease');
assert.deepEqual(inserted.segs[0].pts, [[0, 2], [0, 0]], 'Block base point, scale, rotation and BYBLOCK must all apply.');
assert.equal(parseDxf(dxf([entity('LINE', 62, 3, 420, 0xe60012, 10, 0, 20, 0, 11, 10, 21, 0)])).segs[0].t, 'cut', 'Truecolor takes precedence over ACI.');
assert.throws(() => parseDxf(dxf([entity('ELLIPSE', 62, 1)])), /ELLIPSE/);
assert.throws(() => parseDxf('AutoCAD Binary DXF\r\n'), /[Bb]inary|二进制/);
assert.throws(() => prepareCustom(parseDxf(dxf([line(1, 0, 0, 10, 0)]))), /闭合/);
assert.throws(() => prepareCustom({ version: 1, segs: [{ t: 'cut', pts: [[NaN, 0], [1, 0]] }] }), /坐标/);

const holed = prepareCustom(parseDxf(dxf([rect(0, 0, 40, 20), rect(5, 5, 4, 4)])));
assert.equal(holed.panels.length, 1);
assert.equal(holed.panels[0].holes.length, 1);
assert.equal(containerAt(holed, [7, 13]), null, 'Cut-outs must not accept artwork after the DXF Y-axis conversion.');
let rings = 0, rule;
const canvas = { save() {}, restore() {}, beginPath() {}, moveTo() { rings++; }, lineTo() {}, closePath() {}, clip(r) { rule = r; }, fillRect() {} };
drawLayer(canvas, { kind: 'shape', x: 0, y: 0, w: 40, h: 20 }, 1, undefined, clipPtsOf(holed.panels, { panelId: holed.root }));
assert.equal(rings, 2); assert.equal(rule, 'evenodd', 'Artwork clipping must exclude the hole in PDF and 3D atlas.');

const sheetLayer = { id: 1, kind: 'image', scope: 'sheet', x: 0, y: 0, w: 40, h: 20, visible: true, finish: 'none' };
const rotatedSheet = { ...sheetLayer, x: 10, y: -10, w: 20, h: 40, rot: 90 };
assert.ok(!warnsOf(rotatedSheet, [], g.sbb).some(w => w.startsWith('超出版面')), 'A quarter-turned fitted sheet must not report unrotated bounds.');
assert.ok(warnsOf({ ...rotatedSheet, x: 12 }, [], g.sbb).some(w => w.startsWith('超出版面')));
assert.equal(dpiOf({ ...sheetLayer, pxw: 1200, w: 50.8, crop: [0.25, 0, 0.5, 1] }), 300, 'DPI must use pixels remaining after alpha trimming/cropping.');
assert.equal(containerOfLayer(g, sheetLayer), null);
assert.equal(bindLayersToContainers([sheetLayer], g)[0], sheetLayer, 'Whole-sheet artwork must remain unbound after import.');
assert.equal(clipPtsOf(g.panels, sheetLayer).holes.length, 1, 'Whole-sheet artwork must cover both sides of a crease.');
rings = 0; rule = undefined;
drawLayer(canvas, { ...sheetLayer, kind: 'shape' }, 1, undefined, clipPtsOf(holed.panels, sheetLayer));
assert.equal(rings, 2); assert.equal(rule, 'evenodd', 'Whole-sheet artwork must retain cut-out holes in print and 3D.');
const scaledSheet = reflowLayersToContainers([sheetLayer], g, { ...g, sbb: [10, 20, 90, 60] })[0];
assert.deepEqual([scaledSheet.x, scaledSheet.y, scaledSheet.w, scaledSheet.h, scaledSheet.panelId], [10, 20, 80, 40, undefined]);
const sheetRestored = await projectStateOf(JSON.parse(JSON.stringify(makeProject({ ...state, layers: [sheetLayer] }))));
assert.equal(sheetRestored.layers[0].scope, 'sheet');
assert.equal(containerOfLayer(g, sheetRestored.layers[0]), null);
assert.ok(containerOfLayer(g, { ...sheetLayer, scope: undefined }), 'Ordinary artwork must still bind to a single panel.');

custom.angles[custom.hinges[0].id] = -65;
const project = JSON.parse(JSON.stringify(makeProject(state, { name: 'DXF roundtrip' })));
assert.equal(project.box.custom.panels, undefined, 'Only source geometry and settings need persistence.');
const restored = await projectStateOf(project);
assert.deepEqual(restored.custom.segs, custom.segs);
assert.deepEqual(restored.custom.angles, custom.angles);
assert.deepEqual(restored.custom.panels, custom.panels);
assert.equal(geomOf(restored, 0.22).cutPath, g.cutPath);

// A picker must stay attached until success, cancellation or failure, then leave no hidden input behind.
const originalDocument = globalThis.document, pickerNodes = new Set();
let picker, clickError = false;
globalThis.document = {
  body: { appendChild(node) { pickerNodes.add(node); } },
  createElement(tag) {
    assert.equal(tag, 'input');
    return picker = {
      remove() { pickerNodes.delete(this); },
      click() { assert.ok(pickerNodes.has(this), 'Project input must be attached before opening.'); if (clickError) throw new Error('picker unavailable'); }
    };
  }
};
try {
  let result = chooseProjectFile();
  picker.files = [{ name: 'test.boxproj', text: async () => JSON.stringify(project) }];
  await picker.onchange();
  assert.deepEqual((await result).box, project.box);
  assert.equal(pickerNodes.size, 0);
  result = chooseProjectFile(); picker.oncancel();
  assert.equal(await result, null); assert.equal(pickerNodes.size, 0);
  result = chooseProjectFile(); picker.files = []; await picker.onchange();
  assert.equal(await result, null); assert.equal(pickerNodes.size, 0);
  result = chooseProjectFile();
  picker.files = [{ text: async () => '{}' }]; await picker.onchange();
  await assert.rejects(result, /工程文件/); assert.equal(pickerNodes.size, 0);
  clickError = true;
  await assert.rejects(chooseProjectFile(), /picker unavailable/); assert.equal(pickerNodes.size, 0);
} finally {
  if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
}

if (process.argv[2]) {
  const filename = process.argv[2], bytes = readFileSync(filename);
  const sample = prepareCustom({ ...parseDxf(decodeDxf(bytes), { unitScale: 1 }), name: filename.split('/').at(-1) });
  const sampleG = geomOf({ ...state, custom: sample }, 0.22);
  const area = pts => Math.abs(pts.reduce((a, p, i) => { const q = pts[(i + 1) % pts.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
  const netArea = regions => regions.reduce((a, p) => a + area(p.pts) - (p.holes || []).reduce((sum, hole) => sum + area(hole), 0), 0);
  assert.ok(Math.abs(netArea(sample.panels) - netArea(sample.contours)) < 0.01, 'Folding panels must preserve material area and cut-outs.');
  if (filename.endsWith('展示盒 刀模.dxf')) {
    assert.deepEqual([sampleG.cutN, sampleG.creaseN, sample.panels.length, sample.hinges.length], [6, 23, 20, 18]);
    assert.equal(sample.contours.reduce((n, c) => n + c.holes.length, 0), 3);
  }
  const mat = new THREE.MeshBasicMaterial(), folder = new CustomFolder(THREE, sampleG.sbb);
  const root = folder.build(sample, 0.22, mat, mat);
  for (const fold of [0, 50, 100]) {
    folder.applyFold(sample, fold);
    const box = new THREE.Box3().setFromObject(root);
    assert.ok([...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite));
    assert.equal(folder.meshes.size, sample.panels.length);
  }
  const saved = await projectStateOf(JSON.parse(JSON.stringify(makeProject({ ...state, custom: sample }))));
  assert.equal(saved.custom.panels.length, sample.panels.length);
  assert.equal(saved.custom.hinges.length, sample.hinges.length);
  console.log(JSON.stringify({ file: filename, cut: sampleG.cutN, crease: sampleG.creaseN, panels: sample.panels.length, hinges: sample.hinges.length, mm: sampleG.sbb, warnings: sample.warnings }, null, 2));
  root.traverse(o => o.geometry?.dispose()); mat.dispose();
}
console.log('DXF checks passed: entities, colors, mm units, curves, topology, holes, project roundtrip and invalid input.');
