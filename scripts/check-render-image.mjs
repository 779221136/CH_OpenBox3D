import assert from 'node:assert/strict';
import { Color, PerspectiveCamera, OrthographicCamera, Vector2, Vector3, Vector4 } from 'three';
import { captureRenderPng, pngDimensions, waitForRender } from '../src/workflow/renderImage.js';

assert.deepEqual(pngDimensions('16:9', 2048), { width: 2048, height: 1152 });
assert.deepEqual(pngDimensions('3:4', 1024), { width: 768, height: 1024 });
assert.deepEqual(pngDimensions('16:9', 4096), { width: 4096, height: 2304 });
assert.deepEqual(pngDimensions('9:16', 8192), { width: 4608, height: 8192 });
assert.deepEqual(pngDimensions('1:1', 8192), { width: 8192, height: 8192 });
assert.throws(() => pngDimensions('0:1', 2048));
assert.throws(() => pngDimensions('1:1', 16384));
assert.throws(() => captureRenderPng(null, { width: 8193, height: 1 }), /1–8192/);

for (const orthographic of [false, true]) for (const width of [2048, 4096, 8192]) for (const transparent of [false, true]) for (const failure of ['', 'encode', 'buffer-limit', 'viewport-limit', 'truncated', 'context-lost']) {
  const height = width * 9 / 16, tiled = width > 4096, tileSize = tiled ? 2048 : width, preflightFailure = failure === 'buffer-limit' || failure === 'viewport-limit';
  const camera = orthographic ? new OrthographicCamera(-40, 40, 30, -30, 0.1, 1000) : new PerspectiveCamera(35, 4 / 3, 1, 1000);
  camera.position.set(3, 4, 5); camera.zoom = 1.4; camera.updateProjectionMatrix();
  const beforeCamera = camera.toJSON(), scene = { background: new Color('#ddccbb') }, background = scene.background;
  let size = new Vector2(800, 600), ratio = 2, alpha = 1, color = new Color('#ab1234'), viewport = new Vector4(0, 0, 800, 600), scissor = new Vector4(1, 2, 300, 400), scissorTest = true;
  const ground = { visible: true }, renders = [], tiles = [];
  const renderScene = { helpersVisible: true, setHelpersVisible(value) { this.helpersVisible = value; } };
  let lost = false;
  const gl = {
    MAX_RENDERBUFFER_SIZE: 'buffer', MAX_VIEWPORT_DIMS: 'viewport', isContextLost: () => lost,
    getParameter: p => p === 'buffer' ? (failure === 'buffer-limit' ? 1024 : 4096) : (failure === 'viewport-limit' ? [4096, 512] : [4096, 4096]),
    get drawingBufferWidth() { return failure === 'truncated' && size.x === tileSize ? tileSize / 2 : size.x * ratio; },
    get drawingBufferHeight() { return size.y * ratio; }
  };
  const renderer = {
    getContext: () => gl, getSize: v => v.copy(size), getPixelRatio: () => ratio,
    getViewport: v => v.copy(viewport), getScissor: v => v.copy(scissor), getScissorTest: () => scissorTest,
    getClearColor: v => v.copy(color), getClearAlpha: () => alpha,
    setClearAlpha: v => { alpha = v; }, setClearColor: (c, a) => { color.copy(c); alpha = a; },
    setPixelRatio: v => { ratio = v; }, setSize: (w, h) => { size.set(w, h); viewport.set(0, 0, w, h); },
    setViewport: v => { viewport.copy(v); }, setScissor: v => { scissor.copy(v); }, setScissorTest: v => { scissorTest = v; },
    render: (_, c) => { renders.push(c); if (failure === 'context-lost' && c !== camera) lost = true; },
    domElement: { toDataURL: type => { assert.equal(tiled, false, '8K must be encoded from the composed output canvas.'); return encode(type); } }
  };
  const encode = type => {
      assert.ok(!['buffer-limit', 'viewport-limit', 'truncated', 'context-lost'].includes(failure), 'Do not encode or download an incomplete canvas.');
      assert.equal(type, 'image/png'); assert.equal(renderScene.helpersVisible, false); assert.equal(ratio, 1);
      if (tiled) {
        assert.deepEqual([output.width, output.height], [width, height], 'Final PNG retains the requested 8K dimensions.');
        const expected = [];
        for (let y = 0; y < height; y += 2048) for (let x = 0; x < width; x += 2048) expected.push([x, y, Math.min(2048, width - x), Math.min(2048, height - y)]);
        assert.deepEqual(tiles, expected, 'Every tile, including the shorter bottom edge, covers its exact output region once.');
      } else assert.deepEqual(size.toArray(), [width, height]);
      assert.equal(scene.background, transparent ? null : background); assert.equal(alpha, transparent ? 0 : 1); assert.equal(ground.visible, !transparent); assert.equal(scissorTest, false);
      if (failure === 'encode') throw new Error('encode failure');
      return 'data:image/png;base64,test';
  };
  const output = { width: 0, height: 0, toDataURL: encode, getContext: type => {
    assert.equal(type, '2d');
    return { drawImage: (source, x, y) => {
      assert.equal(source, renderer.domElement); assert.ok(size.x <= 2048 && size.y <= 2048, '8K never requests a huge WebGL buffer.');
      const shot = renders.at(-1), view = shot.view;
      assert.deepEqual([view.fullWidth, view.fullHeight, view.offsetX, view.offsetY, view.width, view.height], [width, height, x, y, size.x, size.y]);
      const full = shot.clone(); full.clearViewOffset();
      const tileCorner = new Vector3(-1, 1, 0).applyMatrix4(shot.projectionMatrixInverse);
      const fullCorner = new Vector3(x / width * 2 - 1, 1 - y / height * 2, 0).applyMatrix4(full.projectionMatrixInverse);
      assert.ok(tileCorner.distanceTo(fullCorner) < 1e-8, 'Perspective and orthographic tiles preserve the full-frame projection without seams.');
      tiles.push([x, y, size.x, size.y]);
    } };
  } };
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: tag => { assert.equal(tag, 'canvas'); assert.equal(tiled, true); return output; } };
  const engine = { ready: true, renderer, scene, camera, stageGround: ground, renderScene };
  const errors = { encode: /encode failure/, 'buffer-limit': /不支持此渲染尺寸/, 'viewport-limit': /不支持此渲染尺寸/, truncated: /无法分配完整渲染画布/, 'context-lost': /显存不足或 3D 显示中断/ };
  try {
    if (failure) assert.throws(() => captureRenderPng(engine, { width, height, transparent }), errors[failure]);
    else assert.equal(captureRenderPng(engine, { width, height, transparent }), 'data:image/png;base64,test');
  } finally { if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument; }
  if (tiled) assert.deepEqual([output.width, output.height], [0, 0], 'Release the large temporary 2D canvas after success or failure.');
  assert.equal(renderScene.helpersVisible, true, 'Selection helpers must be restored even when PNG encoding fails.');
  assert.deepEqual(camera.toJSON(), beforeCamera, 'The preview camera and zoom must not change.');
  if (preflightFailure) assert.equal(renders.length, 0, 'Unsupported hardware must leave the preview untouched.');
  else assert.equal(renders.at(-1), camera, 'The restored preview is rendered again.');
  if (!preflightFailure && failure !== 'truncated') {
    if (orthographic) assert.ok(Math.abs((renders[0].right - renders[0].left) / (renders[0].top - renders[0].bottom) - width / height) < 1e-12);
    else assert.equal(renders[0].aspect, width / height);
  }
  assert.equal(scene.background, background); assert.equal(ground.visible, true); assert.equal(alpha, 1); assert.equal(color.getHexString(), 'ab1234');
  assert.deepEqual(size.toArray(), [800, 600]); assert.equal(ratio, 2); assert.equal(scissorTest, true);
  assert.deepEqual(viewport.toArray(), [0, 0, 800, 600]); assert.deepEqual(scissor.toArray(), [1, 2, 300, 400]);
}
await assert.rejects(waitForRender({ ready: true, props: {}, studio: { environmentReady: Promise.resolve(false) } }), /影棚环境加载失败/);
await assert.rejects(waitForRender({ ready: true, props: {}, stageGround: { userData: { ready: Promise.resolve(false) } } }), /地面贴图加载失败/);
let loaded = false;
await waitForRender({ ready: true, props: {}, stageGround: { userData: { ready: new Promise(resolve => setTimeout(() => { loaded = true; resolve(true); }, 700)) } } });
assert.equal(loaded, true, 'Export must wait for actual texture readiness.');
console.log('Render PNG checks passed: 1K/2K/4K/8K dimensions, tiled 8K projection/composition, cameras, transparency, hardware limits, allocation/context/encoding failures and preview restoration, asset readiness.');
