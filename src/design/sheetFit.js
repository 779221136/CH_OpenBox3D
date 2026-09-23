const validSize = (w, h) => Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0;
const validBox = b => Array.isArray(b) && b.length === 4 && b.every(Number.isFinite) && validSize(b[2] - b[0], b[3] - b[1]);
const checkMask = mask => {
  if (!mask || !Number.isInteger(mask.width) || !Number.isInteger(mask.height)
    || !validSize(mask.width, mask.height) || mask.alpha?.length !== mask.width * mask.height) {
    throw new Error('图片或刀模轮廓尺寸无效。');
  }
};

// Alpha grids are local image coordinates; sbb is the dieline's millimetre bounds.
export function matchSheetMask(source, target, sbb, crop = [0, 0, 1, 1]) {
  checkMask(source); checkMask(target);
  const iw = source.imageWidth ?? source.width, ih = source.imageHeight ?? source.height;
  if (!validBox(sbb) || !validSize(iw, ih)) throw new Error('图片或刀模尺寸无效。');
  if (!Array.isArray(crop) || crop.length !== 4 || !crop.every(Number.isFinite)
    || crop[0] < 0 || crop[1] < 0 || !validSize(crop[2], crop[3])
    || crop[0] + crop[2] > 1 + 1e-9 || crop[1] + crop[3] > 1 + 1e-9) {
    throw new Error('图片裁剪范围无效，请先重置裁剪。');
  }
  const sw = source.width, sh = source.height;
  let left = sw, top = sh, right = -1, bottom = -1;
  for (let y = Math.floor(crop[1] * sh); y < Math.min(sh, Math.ceil((crop[1] + crop[3]) * sh)); y++) {
    for (let x = Math.floor(crop[0] * sw); x < Math.min(sw, Math.ceil((crop[0] + crop[2]) * sw)); x++) {
      if (!source.alpha[y * sw + x]) continue;
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
  }
  if (right < left) throw new Error('图片裁剪区域完全透明，无法匹配刀模。');
  const x0 = Math.max(crop[0], left / sw), y0 = Math.max(crop[1], top / sh);
  const x1 = Math.min(crop[0] + crop[2], (right + 1) / sw), y1 = Math.min(crop[1] + crop[3], (bottom + 1) / sh);
  const trimmed = [x0, y0, x1 - x0, y1 - y0];
  let opaque = true;
  for (let y = top; opaque && y <= bottom; y++) for (let x = left; x <= right; x++) {
    if (!source.alpha[y * sw + x]) { opaque = false; break; }
  }
  if (!target.alpha.some(a => a > 0)) throw new Error('刀模没有可匹配的闭合轮廓。');
  const bw = sbb[2] - sbb[0], bh = sbb[3] - sbb[1], pw = iw * trimmed[2], ph = ih * trimmed[3];
  let best;
  // ponytail: bounded raster + four quarter-turns; arbitrary skew/rotation needs registration, not more fit heuristics.
  for (const rot of opaque ? [0, 90] : [0, 90, 180, 270]) {
    const scale = rot % 180 ? Math.min(bw / ph, bh / pw) : Math.min(bw / pw, bh / ph);
    const w = pw * scale, h = ph * scale;
    let score = scale;
    if (!opaque) {
      let intersection = 0, union = 0;
      for (let y = 0; y < target.height; y++) for (let x = 0; x < target.width; x++) {
        const dx = (x + 0.5) / target.width * bw - bw / 2, dy = (y + 0.5) / target.height * bh - bh / 2;
        const rx = rot === 0 ? dx : rot === 90 ? dy : rot === 180 ? -dx : -dy;
        const ry = rot === 0 ? dy : rot === 90 ? -dx : rot === 180 ? -dy : dx;
        const u = rx / w + 0.5, v = ry / h + 0.5;
        const sx = Math.min(sw - 1, Math.floor((trimmed[0] + u * trimmed[2]) * sw));
        const sy = Math.min(sh - 1, Math.floor((trimmed[1] + v * trimmed[3]) * sh));
        const a = u >= 0 && u < 1 && v >= 0 && v < 1 && source.alpha[sy * sw + sx] > 0;
        const b = target.alpha[y * target.width + x] > 0;
        if (a && b) intersection++;
        if (a || b) union++;
      }
      score = intersection / union;
    }
    if (!best || score > best.score + 1e-9) best = { score, x: (sbb[0] + sbb[2] - w) / 2, y: (sbb[1] + sbb[3] - h) / 2, w, h, rot, crop: trimmed };
  }
  const { score, ...pose } = best;
  return pose;
}

const alphaOf = canvas => {
  const rgba = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  const alpha = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];
  return { width: canvas.width, height: canvas.height, alpha };
};

export function fitSheetImage(asset, g) {
  const iw = asset?.img?.naturalWidth, ih = asset?.img?.naturalHeight;
  if (!validSize(iw, ih) || !validBox(g?.sbb)) throw new Error('图片尚未加载或刀模尺寸无效。');
  const source = document.createElement('canvas'), factor = Math.min(1, 2048 / Math.max(iw, ih));
  source.width = Math.max(1, Math.round(iw * factor)); source.height = Math.max(1, Math.round(ih * factor));
  source.getContext('2d').drawImage(asset.img, 0, 0, source.width, source.height);
  const [x0, y0, x1, y1] = g.sbb, bw = x1 - x0, bh = y1 - y0;
  const target = document.createElement('canvas'), size = 256 / Math.max(bw, bh);
  target.width = Math.max(1, Math.round(bw * size)); target.height = Math.max(1, Math.round(bh * size));
  const ctx = target.getContext('2d');
  ctx.scale(target.width / bw, target.height / bh); ctx.translate(-x0, -y0);
  ctx.fill(new Path2D(g.fillPath || ''), 'evenodd');
  return matchSheetMask({ ...alphaOf(source), imageWidth: iw, imageHeight: ih }, alphaOf(target), g.sbb, asset.crop);
}
