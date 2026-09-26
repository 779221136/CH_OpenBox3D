import { geomOf } from '../dieline/geom.js';
import { drawLayer } from '../design/layers.js';
import { clipPtsOf } from '../design/containers.js';

// 与设计画布/PDF 共用图层绘制和毫米坐标，缩略图不包含选择框或视图缩放。
export async function designThumbnail(state, material) {
  await document.fonts?.ready;
  await Promise.all(state.layers.filter(l => l.visible !== false && l.kind === 'image').map(async l => {
    if (!l.img) throw new Error('有设计图片未加载，暂时无法保存方案。');
    await l.img.decode?.();
  }));
  const g = geomOf(state, material.t), [x0, y0, x1, y1] = g.sbb;
  const canvas = document.createElement('canvas');
  canvas.width = 480; canvas.height = 360;
  const ctx = canvas.getContext('2d'), scale = Math.min(448 / (x1 - x0), 328 / (y1 - y0));
  const tx = (480 - (x1 - x0) * scale) / 2 - x0 * scale, ty = (360 - (y1 - y0) * scale) / 2 - y0 * scale;
  ctx.fillStyle = '#f5f6f8'; ctx.fillRect(0, 0, 480, 360);
  ctx.save(); ctx.setTransform(scale, 0, 0, scale, tx, ty);
  const outline = new Path2D(g.fillPath);
  ctx.fillStyle = '#fffdf8'; ctx.fill(outline, 'evenodd'); ctx.clip(outline, 'evenodd');
  ctx.setTransform(1, 0, 0, 1, tx, ty);
  for (const layer of state.layers) if (layer.visible !== false) drawLayer(ctx, layer, scale, undefined, clipPtsOf(g.panels, layer));
  ctx.restore(); ctx.setTransform(scale, 0, 0, scale, tx, ty);
  ctx.lineWidth = 0.6 / scale; ctx.strokeStyle = '#bd8f85'; ctx.stroke(new Path2D(g.cutPath));
  ctx.strokeStyle = '#a0b5a5'; ctx.stroke(new Path2D(g.creasePath));
  return canvas.toDataURL('image/png');
}
