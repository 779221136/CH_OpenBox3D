import assert from 'node:assert/strict';
import { Color, PerspectiveCamera, OrthographicCamera, Vector2, Vector4 } from 'three';
import { captureRenderPng, pngDimensions, waitForRender } from '../src/workflow/renderImage.js';

assert.deepEqual(pngDimensions('16:9', 2048), { width: 2048, height: 1152 });
assert.deepEqual(pngDimensions('3:4', 1024), { width: 768, height: 1024 });
assert.throws(() => pngDimensions('0:1', 2048));
assert.throws(() => pngDimensions('1:1', 8192));

for (const orthographic of [false, true]) for (const fail of [false, true]) {
  const camera = orthographic ? new OrthographicCamera(-40, 40, 30, -30, 0.1, 1000) : new PerspectiveCamera(35, 4 / 3, 1, 1000);
  camera.position.set(3, 4, 5); camera.zoom = 1.4; camera.updateProjectionMatrix();
  const beforeCamera = camera.toJSON(), scene = { background: new Color('#ddccbb') }, background = scene.background;
  let size = new Vector2(800, 600), ratio = 2, alpha = 1, color = new Color('#ab1234'), viewport = new Vector4(0, 0, 800, 600), scissor = new Vector4(1, 2, 300, 400), scissorTest = true;
  const ground = { visible: true }, renders = [];
  const renderer = {
    getContext: () => ({ isContextLost: () => false }), getSize: v => v.copy(size), getPixelRatio: () => ratio,
    getViewport: v => v.copy(viewport), getScissor: v => v.copy(scissor), getScissorTest: () => scissorTest,
    getClearColor: v => v.copy(color), getClearAlpha: () => alpha,
    setClearAlpha: v => { alpha = v; }, setClearColor: (c, a) => { color.copy(c); alpha = a; },
    setPixelRatio: v => { ratio = v; }, setSize: (w, h) => { size.set(w, h); viewport.set(0, 0, w, h); },
    setViewport: v => { viewport.copy(v); }, setScissor: v => { scissor.copy(v); }, setScissorTest: v => { scissorTest = v; },
    render: (_, c) => { renders.push(c); },
    domElement: { toDataURL: type => {
      assert.equal(type, 'image/png'); assert.deepEqual(size.toArray(), [2048, 1152]); assert.equal(ratio, 1);
      assert.equal(scene.background, null); assert.equal(alpha, 0); assert.equal(ground.visible, false); assert.equal(scissorTest, false);
      if (fail) throw new Error('encode failure');
      return 'data:image/png;base64,test';
    } }
  };
  const engine = { ready: true, renderer, scene, camera, stageGround: ground };
  if (fail) assert.throws(() => captureRenderPng(engine, { width: 2048, height: 1152, transparent: true }), /encode failure/);
  else assert.equal(captureRenderPng(engine, { width: 2048, height: 1152, transparent: true }), 'data:image/png;base64,test');
  assert.deepEqual(camera.toJSON(), beforeCamera, 'The preview camera and zoom must not change.');
  assert.equal(renders.at(-1), camera, 'The restored preview is rendered again.');
  if (orthographic) assert.ok(Math.abs((renders[0].right - renders[0].left) / (renders[0].top - renders[0].bottom) - 2048 / 1152) < 1e-12);
  else assert.equal(renders[0].aspect, 2048 / 1152);
  assert.equal(scene.background, background); assert.equal(ground.visible, true); assert.equal(alpha, 1); assert.equal(color.getHexString(), 'ab1234');
  assert.deepEqual(size.toArray(), [800, 600]); assert.equal(ratio, 2); assert.equal(scissorTest, true);
  assert.deepEqual(viewport.toArray(), [0, 0, 800, 600]); assert.deepEqual(scissor.toArray(), [1, 2, 300, 400]);
}
await assert.rejects(waitForRender({ ready: true, props: {}, studio: { environmentReady: Promise.resolve(false) } }), /影棚环境加载失败/);
await assert.rejects(waitForRender({ ready: true, props: {}, stageGround: { userData: { ready: Promise.resolve(false) } } }), /地面贴图加载失败/);
let loaded = false;
await waitForRender({ ready: true, props: {}, stageGround: { userData: { ready: new Promise(resolve => setTimeout(() => { loaded = true; resolve(true); }, 700)) } } });
assert.equal(loaded, true, 'Export must wait for actual texture readiness.');
console.log('Render PNG checks passed: dimensions, perspective/orthographic cameras, transparent background, restore on failure, asset readiness.');
