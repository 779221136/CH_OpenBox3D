import { Color, Vector2, Vector4 } from 'three';

export function pngDimensions(ratio, size) {
  const [w, h] = String(ratio).split(':').map(Number);
  if (!['1:1', '4:3', '3:4', '16:9', '9:16'].includes(ratio) || ![1024, 2048, 4096, 8192].includes(size)) throw new Error('请选择有效的画面比例和分辨率。');
  return { width: Math.round(size * w / Math.max(w, h)), height: Math.round(size * h / Math.max(w, h)) };
}

export async function waitForRender(engine) {
  if (!engine) throw new Error('3D 尚未就绪，请稍后重试。');
  let timeout;
  try {
    await Promise.race([
      (async () => {
        for (let i = 0; !engine.ready && !engine._disposed && i < 150; i++) await new Promise(resolve => setTimeout(resolve, 100));
        if (!engine.ready || engine._disposed) throw new Error('3D 初始化未完成，请重新进入渲染页面。');
        // 当前引擎对模型修改防抖 600 ms；导出前让最后一次更新完成，保留用户构图。
        await new Promise(resolve => setTimeout(resolve, 650));
        const images = (engine.props.layers || []).filter(l => l.visible !== false && l.kind === 'image');
        if (images.some(l => l.imgSrc && !l.img)) throw new Error('有设计图片未加载成功，请返回设计页面重新导入。');
        const results = await Promise.all([
          engine.studio?.environmentReady,
          engine.stageGround?.userData.ready,
          globalThis.document?.fonts?.ready,
          ...images.map(l => l.img?.decode ? l.img.decode() : undefined)
        ]);
        if (results[0] === false) throw new Error('影棚环境加载失败，请切换场景后重试。');
        if (results[1] === false) throw new Error('地面贴图加载失败，请切换地面后重试。');
        if (engine._disposed) throw new Error('渲染页面已关闭。');
      })(),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('等待渲染资源超时，请检查场景贴图后重试。')), 20000); })
    ]);
  } finally { clearTimeout(timeout); }
}

// 同步截图后立即恢复预览，避免异步编码期间改变共享画布。
export function captureRenderPng(engine, { width, height, transparent = false }) {
  if (![width, height].every(v => Number.isInteger(v) && v > 0 && v <= 8192)) throw new Error('导出尺寸须为 1–8192 像素。');
  if (!engine?.ready || engine._disposed) throw new Error('3D 尚未就绪。');
  const { renderer, scene, camera } = engine;
  const gl = renderer.getContext();
  if (gl.isContextLost()) throw new Error('3D 显示已中断，请重新进入渲染页面。');
  // 8K 分块绘制，避免一次申请整张 WebGL 缓冲区；相机偏移保留完整画面的构图。
  const tiled = width > 4096 || height > 4096, tileSize = tiled ? 2048 : Math.max(width, height);
  const maxBuffer = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), maxViewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
  if (Math.min(width, tileSize) > Math.min(maxBuffer, maxViewport[0]) || Math.min(height, tileSize) > Math.min(maxBuffer, maxViewport[1])) throw new Error('当前设备不支持此渲染尺寸，请选择较低分辨率。');
  const size = renderer.getSize(new Vector2()), ratio = renderer.getPixelRatio();
  const viewport = renderer.getViewport(new Vector4()), scissor = renderer.getScissor(new Vector4()), scissorTest = renderer.getScissorTest();
  const clearColor = renderer.getClearColor(new Color()), clearAlpha = renderer.getClearAlpha(), background = scene.background;
  const ground = engine.stageGround, groundVisible = ground?.visible;
  const helpersVisible = engine.renderScene?.helpersVisible;
  const shotCamera = camera.clone();
  if (shotCamera.isOrthographicCamera) {
    const halfH = (shotCamera.top - shotCamera.bottom) / 2, centerX = (shotCamera.left + shotCamera.right) / 2;
    shotCamera.left = centerX - halfH * width / height; shotCamera.right = centerX + halfH * width / height;
  } else shotCamera.aspect = width / height;
  shotCamera.updateProjectionMatrix();
  const output = tiled ? document.createElement('canvas') : renderer.domElement;
  try {
    let context;
    if (tiled) {
      output.width = width; output.height = height; context = output.getContext('2d');
      if (!context) throw new Error('无法创建完整图片，请释放内存或选择较低分辨率后重试。');
    }
    engine.renderScene?.setHelpersVisible(false);
    renderer.setPixelRatio(1); renderer.setScissorTest(false);
    if (transparent) { scene.background = null; renderer.setClearAlpha(0); if (ground) ground.visible = false; }
    for (let y = 0; y < height; y += tileSize) for (let x = 0; x < width; x += tileSize) {
      const w = Math.min(tileSize, width - x), h = Math.min(tileSize, height - y);
      if (tiled) shotCamera.setViewOffset(width, height, x, y, w, h);
      renderer.setSize(w, h, false);
      // 浏览器可能因显存不足缩小缓冲区；不能将截断的结果当成完整图片。
      if (gl.isContextLost() || gl.drawingBufferWidth !== w || gl.drawingBufferHeight !== h) throw new Error('无法分配完整渲染画布，请选择较低分辨率后重试。');
      renderer.render(scene, shotCamera);
      if (gl.isContextLost()) throw new Error('渲染时显存不足或 3D 显示中断，请重新进入渲染页面并选择较低分辨率。');
      context?.drawImage(renderer.domElement, x, y);
    }
    const png = output.toDataURL('image/png');
    if (!png.startsWith('data:image/png;')) throw new Error('PNG 编码失败，请重试。');
    return png;
  } finally {
    if (tiled) { output.width = 0; output.height = 0; }
    engine.renderScene?.setHelpersVisible(helpersVisible);
    scene.background = background;
    if (ground) ground.visible = groundVisible;
    renderer.setClearColor(clearColor, clearAlpha);
    renderer.setPixelRatio(ratio); renderer.setSize(size.x, size.y, false);
    renderer.setViewport(viewport); renderer.setScissor(scissor); renderer.setScissorTest(scissorTest);
    renderer.render(scene, camera);
  }
}
