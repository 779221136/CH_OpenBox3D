// 设计容器：面板命中、旧图层归属、参数变化重映射。容器几何始终来自 geomOf。
import { bboxOf } from './layers.js';

export const bboxOfPts = pts => pts.reduce((b, p) => [
  Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])
], [Infinity, Infinity, -Infinity, -Infinity]);

export function pointInPolygon(pt, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if (((a[1] > pt[1]) !== (b[1] > pt[1]))
      && pt[0] < (b[0] - a[0]) * (pt[1] - a[1]) / ((b[1] - a[1]) || 1e-12) + a[0]) inside = !inside;
  }
  return inside;
}

export const heroContainerOf = g => (g.panels || []).find(p => p.role === 'hero' && p.surface === 'outside') || null;
export const containerById = (g, id) => id == null ? null : (g.panels || []).find(p => p.panelId === id) || null;
export const clipPtsOf = (panels, layer) => {
  const panel = layer && layer.panelId != null ? (panels || []).find(p => p.panelId === layer.panelId) : null;
  return panel?.holes?.length ? panel : panel ? panel.pts : null;
};

export function containerAt(g, pt) {
  return (g.panels || []).filter(p => pointInPolygon(pt, p.pts) && !(p.holes || []).some(hole => pointInPolygon(pt, hole)))
    .sort((a, b) => {
      const aa = bboxOfPts(a.pts), bb = bboxOfPts(b.pts);
      return (aa[2] - aa[0]) * (aa[3] - aa[1]) - (bb[2] - bb[0]) * (bb[3] - bb[1]);
    })[0] || null;
}

export function containerOfLayer(g, layer) {
  const bound = containerById(g, layer.panelId);
  if (bound) return bound;
  const b = bboxOf(layer), hit = containerAt(g, [b[0] + b[2] / 2, b[1] + b[3] / 2]);
  return hit || heroContainerOf(g);
}

export function bindLayerToContainer(layer, g) {
  const panel = containerOfLayer(g, layer);
  return panel && layer.panelId !== panel.panelId ? { ...layer, panelId: panel.panelId } : layer;
}

export const bindLayersToContainers = (layers, g) => layers.map(l => bindLayerToContainer(l, g));

const round = v => Math.round(v * 1000) / 1000;
const panelBox = panel => bboxOfPts(panel.pts);

// 保留图层在旧容器内的相对中心；尺寸统一缩放，避免盒型参数变化时破坏宽高比。
export function reflowLayersToContainers(layers, oldG, nextG) {
  const nextHero = heroContainerOf(nextG);
  return layers.map(raw => {
    const layer = bindLayerToContainer(raw, oldG);
    const from = containerOfLayer(oldG, layer);
    const to = containerById(nextG, from && from.panelId) || nextHero;
    if (!from || !to) return layer;
    const a = panelBox(from), b = panelBox(to);
    const aw = Math.max(1e-6, a[2] - a[0]), ah = Math.max(1e-6, a[3] - a[1]);
    const bw = Math.max(1e-6, b[2] - b[0]), bh = Math.max(1e-6, b[3] - b[1]);
    const lb = bboxOf(layer), nx = (lb[0] + lb[2] / 2 - a[0]) / aw, ny = (lb[1] + lb[3] / 2 - a[1]) / ah;
    const cx = b[0] + nx * bw, cy = b[1] + ny * bh, scale = Math.min(bw / aw, bh / ah);
    if (layer.kind === 'text') {
      return {
        ...layer, panelId: to.panelId, x: round(cx),
        y: round(cy + (layer.size || 5) * scale * 0.345),
        size: round(Math.max(1.5, (layer.size || 5) * scale)), heroPreset: undefined
      };
    }
    const w = Math.max(2, layer.w * scale), h = Math.max(1, layer.h * scale);
    return { ...layer, panelId: to.panelId, x: round(cx - w / 2), y: round(cy - h / 2), w: round(w), h: round(h), heroPreset: undefined };
  });
}
