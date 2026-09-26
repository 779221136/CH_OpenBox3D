import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// 通过项目自己的 JSX 编译器检查正式预览入口，无需启动浏览器/WebGL。
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { boxPreviewPropsOf } = await server.ssrLoadModule('/src/render3d/BoxPreview.jsx');
  const { MATS } = await server.ssrLoadModule('/src/dieline/templates.js');
  const { paperPreset } = await server.ssrLoadModule('/src/render3d/presets.js');
  const { parseDxf, decodeDxf } = await server.ssrLoadModule('/src/dieline/dxf.js');
  const { prepareCustom } = await server.ssrLoadModule('/src/dieline/custom.js');
  const custom = process.argv[2] ? prepareCustom(parseDxf(decodeDxf(readFileSync(process.argv[2])))) : null;
  const state = {
    tpl: custom ? 'custom' : 'rte', custom, L: 60, W: 60, H: 60, bleed: 3, glue: 14, fold: 100,
    layers: [{ kind: 'shape', x: 0, y: 0, w: 10, h: 10, color: '#ff0000' }], fx: {},
    paper3d: 'black-card', film3d: 'gloss', paperTint3d: '#ffffff', surfaceRoughness: 0.12,
    grainStrength: 0, grainScale: 3, filmClearcoat3d: 1, filmClearcoatRoughness3d: 0.045,
    filmRoughnessFactor3d: 0.42, filmSheen3d: 0.5, check: 'foil'
  };
  const before = structuredClone(state), expected = ['art-paper', 'coated-white', 'coated-white', 'art-paper', 'kraft-natural', 'kraft-natural', 'kraft-natural', 'kraft-natural'];
  let bounds;
  MATS.forEach((mat, i) => {
    const preview = boxPreviewPropsOf(state, mat, { hideArtwork: true }), paper = paperPreset(expected[i]);
    assert.equal(preview.paper, expected[i], mat.name + ' 必须显示对应的纸种');
    assert.equal(preview.t, mat.t);
    assert.deepEqual(preview.layers, []);
    assert.equal(preview.paperTint, '');
    assert.equal(preview.film, 'none');
    assert.equal(preview.filmClearcoat, 0);
    assert.equal(preview.filmRoughnessFactor, 1);
    assert.equal(preview.filmSheen, 0);
    assert.equal(preview.surfaceRoughness, paper.roughness);
    assert.equal(preview.grainStrength, paper.grainStrength);
    assert.equal(preview.grainScale, paper.grainMm);
    assert.equal(preview.check, 'art');
    assert.equal(JSON.parse(preview.bakeKey).paper, expected[i], '烘焙与材质使用同一纸种');
    if (custom && bounds) assert.deepEqual(preview.sbb, bounds, '切换纸厚不能缩放 DXF');
    bounds = preview.sbb;
    const design = boxPreviewPropsOf(state, mat);
    assert.equal(design.paper, 'black-card');
    assert.equal(design.film, 'gloss');
    assert.equal(design.paperTint, '#ffffff');
    assert.equal(design.check, 'foil');
    assert.equal(design.layers, state.layers);
  });
  assert.deepEqual(state, before, '刀模预览不得覆盖设计/渲染材质');
  console.log('Structure material checks passed: all 8 materials, thickness, bake keys, tint/film isolation and unchanged design settings.' + (custom ? ` DXF: ${custom.panels.length} panels / ${custom.hinges.length} hinges.` : ''));
} finally {
  await server.close();
}
