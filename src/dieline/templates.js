// 盒型库与参数化刀版生成 —— 移植自原型（genTuck/genMailer/genTray/genSleeve）
// 纯函数风格：f(params, board) → 线段/填充/标注集合，几何一律以 mm 为基本单位

export const MATS = [
  { id: 'art200', name: '薄铜版纸 200g', t: 0.22, bleed: 3, paper: 'art-paper', note: '轻薄彩盒/裱纸' },
  { id: 'sbs350', name: '白卡 350g', t: 0.45, bleed: 3, paper: 'coated-white', note: '折叠纸盒' },
  { id: 'sbs400', name: '白卡 400g', t: 0.5, bleed: 3, paper: 'coated-white', note: '折叠纸盒' },
  { id: 'art300', name: '铜版纸 300g', t: 0.35, bleed: 3, paper: 'art-paper', note: '裱糊/卡盒' },
  { id: 'kraft350', name: '牛皮纸 350g', t: 0.42, bleed: 3, paper: 'kraft-natural', note: '素面环保' },
  // ponytail: 瓦楞预览复用牛皮面纸和实际厚度；需要切口特写时再扩展波浪纸芯。
  { id: 'fluteF', name: 'F 楞微瓦', t: 0.8, bleed: 5, paper: 'kraft-natural', note: '精品瓦楞' },
  { id: 'fluteE', name: 'E 楞瓦楞', t: 1.5, bleed: 5, paper: 'kraft-natural', note: '飞机盒常用' },
  { id: 'fluteB', name: 'B 楞瓦楞', t: 3.0, bleed: 5, paper: 'kraft-natural', note: '电商外箱' }
];

export const TPLS = [
  { id: 'rte', code: 'RTE', name: '反插盒', sub: '折叠纸盒' },
  { id: 'ste', code: 'STE', name: '直插盒', sub: '折叠纸盒' },
  { id: 'mailer', code: 'MLR', name: '飞机盒', sub: '瓦楞 · 免胶' },
  { id: 'lidbase', code: 'TDG', name: '天地盖', sub: '两片式' },
  { id: 'drawer', code: 'DRW', name: '抽屉盒', sub: '内盒 + 套筒' },
  { id: 'cyl', code: 'CYL', name: '圆柱盒', sub: '卷筒 · 24 棱' },
  { id: 'hex', code: 'HEX', name: '六边形盒', sub: '六棱筒' }
];

export const templateNameOf = s => s.tpl === 'custom' ? (s.custom?.name || '自定义 DXF') : (TPLS.find(x => x.id === s.tpl) || TPLS[0]).name;

// 正 N 边形盖的几何参数：apothem / 外接圆半径 / 盖高
export function discBbox(N, len) {
  const a = len / (2 * Math.tan(Math.PI / N));
  const Rp = len / (2 * Math.sin(Math.PI / N));
  return { a, Rp, h: a + Rp };
}

// 卷筒盒（圆柱 24 棱 / 六边形 6 棱）：筒身 N 段 + 糊口 + 两个正 N 边形盖
export function genTube(c, s, t, N, wSeg) {
  const bh = s.H + t, bodyW = N * wSeg, g = 12;
  const { a, Rp, h } = discBbox(N, wSeg);
  const heroSpan = N === 24 ? 6 : 1, heroIndex = N === 24 ? Math.floor((N - heroSpan) / 2) : Math.floor(N / 2), body = c.rect(0, 0, bodyW, bh);
  c.fill(body);
  if (N === 24) c.region(body, { panelId: 'tube-body', role: 'hero', surface: 'outside', up: 'top', heroRegion: [heroIndex / N, 0, heroSpan / N, 1], heroBox: [heroIndex * wSeg, 0, (heroIndex + heroSpan) * wSeg, bh] });
  else for (let i = 0; i < N; i++) c.region(c.rect(i * wSeg, 0, wSeg, bh), { panelId: i === heroIndex ? 'tube-body' : `tube-face-${i}`, role: i === heroIndex ? 'hero' : 'design', surface: 'outside', up: 'top', ...(i === heroIndex ? { heroRegion: [heroIndex / N, 0, 1 / N, 1], heroBox: [heroIndex * wSeg, 0, (heroIndex + 1) * wSeg, bh] } : {}) });
  c.label(bodyW / 2, bh / 2, '筒身'); c.safeR(0, 0, bodyW, bh);
  const gp = [[0, 0], [-g, 4], [-g, bh - 4], [0, bh]];
  c.fill(gp); c.cut(gp); c.label(-g / 2, bh / 2, '糊口', 2.8);
  c.crease([[0, 0], [0, bh]]);
  for (let k = 1; k < N; k++) c.crease([[k * wSeg, 0], [k * wSeg, bh]]);
  c.cut([[bodyW, 0], [bodyW, bh]]);
  // 顶/底盖：附著边为压痕，凸弧为切线
  for (const d of [{ y0: 0, sgn: -1, nm: '顶盖' }, { y0: bh, sgn: 1, nm: '底盖' }]) {
    const cx = wSeg / 2, cy = d.y0 + d.sgn * a, e = 2 * Math.PI / N, base = Math.atan2(-d.sgn * a, -wSeg / 2);
    const pts = [];
    for (let k = 0; k < N; k++) pts.push([cx + Rp * Math.cos(base + k * e), cy + Rp * Math.sin(base + k * e)]);
    c.fill(pts);
    c.region(pts, { panelId: d.sgn < 0 ? 'tube-top' : 'tube-bottom', surface: 'outside', up: 'top' });
    c.cut(pts.concat([pts[0]]));
    c.crease([[0, d.y0], [wSeg, d.y0]]);
    c.label(cx, d.y0 + d.sgn * a * 0.55, d.nm, 2.6);
  }
  c.dimH(-g, bodyW, bh + h + 9, '' + c.fmt(bodyW + g));
  c.dimV(0, bh, bodyW + 8, '' + c.fmt(bh));
  c.dimH(0, wSeg, -(h + 8), '' + c.fmt(wSeg) + ' /段');
}

// 直插/反插盒：横向四板 + 糊口 + 两端插舌/防尘翼
export function genTuck(c, s, t, reverse) {
  const L = s.L, W = s.W, H = s.H, glue = s.glue, bh = H + t;
  const cols = [W + t, L + t, W + t, L + 2 * t];
  const xs = [0]; cols.forEach(w => xs.push(xs[xs.length - 1] + w));
  const names = ['侧面', '正面', '侧面', '背面'], panelIds = ['side-left', 'front', 'side-right', 'back'];
  for (let i = 0; i < 4; i++) { const pts = c.rect(xs[i], 0, cols[i], bh); c.fill(pts); c.region(pts, { panelId: panelIds[i], role: i === 1 ? 'hero' : 'design', surface: 'outside', up: 'top' }); c.label(xs[i] + cols[i] / 2, bh / 2, names[i]); c.safeR(xs[i], 0, cols[i], bh); }
  const gp = [[0, 0], [-glue, 5], [-glue, bh - 5], [0, bh]];
  c.fill(gp); c.cut(gp); c.label(-glue / 2, bh / 2, '糊口', 2.8);
  c.crease([[0, 0], [0, bh]]);
  for (let i = 1; i < 4; i++) c.crease([[xs[i], 0], [xs[i], bh]]);
  c.cut([[xs[4], 0], [xs[4], bh]]);
  const lidH = W + t, tk = Math.min(16, W * 0.55), dh = Math.min(W * 0.75, 32);
  // 盖的挂接列：rte 顶盖挂背面、底盖挂正面（2026-08-12 对调，与 box3d-app 同步）；ste 两盖仍同挂正面
  const ends = [{ yb: 0, sgn: -1, lid: reverse ? 3 : 1, panelId: 'top' }, { yb: bh, sgn: 1, lid: 1, panelId: 'bottom' }];
  for (const e of ends) for (let i = 0; i < 4; i++) {
    const x0 = xs[i], x1 = xs[i + 1];
    if (i === e.lid) {
      flapLid(c, x0, x1, e.yb, e.sgn, lidH, tk);
      const y1 = e.yb + e.sgn * lidH;
      c.region([[x0, e.yb], [x0, y1], [x1, y1], [x1, e.yb]], { panelId: e.panelId, surface: 'outside', up: 'top' });
    }
    else if (i % 2 === 0) flapDust(c, x0, x1, e.yb, e.sgn, dh);
    else c.cut([[x0, e.yb], [x1, e.yb]]);
  }
  const topY = -(lidH + tk) - 7, botY = bh + lidH + tk + 9;
  for (let i = 0; i < 4; i++) c.dimH(xs[i], xs[i + 1], topY, '' + c.fmt(cols[i]));
  c.dimH(-glue, xs[4], botY, '' + c.fmt(xs[4] + glue));
  c.dimV(0, bh, xs[4] + 8, '' + c.fmt(bh));
}

function flapLid(c, x0, x1, yb, sgn, lidH, tk) {
  const y1 = yb + sgn * lidH, y2 = yb + sgn * (lidH + tk);
  const a = x0, b = x1, sl = x0 + 5, sr = x1 - 5, r = 3.5; // 盖身侧边取直（2026-08 起方形盖，原 1mm 内收梯形已废）
  const pts = [[x0, yb], [a, y1], [sl, y1 + sgn * 2.5], [sl, y2 - sgn * r]]
    .concat(c.q([sl, y2 - sgn * r], [sl, y2], [sl + r, y2], 'tr').slice(1))
    .concat([[sr - r, y2]])
    .concat(c.q([sr - r, y2], [sr, y2], [sr, y2 - sgn * r], 'tr').slice(1))
    .concat([[sr, y1 + sgn * 2.5], [b, y1], [x1, yb]]);
  c.cut(pts); c.fill(pts);
  c.crease([[x0, yb], [x1, yb]]); c.crease([[a, y1], [b, y1]]);
}

function flapDust(c, x0, x1, yb, sgn, dh) {
  const pts = [[x0 + 1.5, yb], [x0 + 3.5, yb + sgn * (dh - 5)], [x0 + 9, yb + sgn * dh], [x1 - 9, yb + sgn * dh], [x1 - 3.5, yb + sgn * 5], [x1 - 1.5, yb]];
  c.cut(pts); c.fill(pts); c.crease([[x0 + 1.5, yb], [x1 - 1.5, yb]]);
  c.cut([[x0, yb], [x0 + 1.5, yb]]); c.cut([[x1 - 1.5, yb], [x1, yb]]);
}

// 飞机盒：一片成型免胶，侧耳折入
export function genMailer(c, s, t) {
  const L = s.L, W = s.W, H = s.H, Lc = L + 2 * t;
  const tk = Math.min(H * 0.7, 28), Wl = W + 3 * t, Hb = H + t, Wb = W + t, Hf = H, Sw = H + t;
  const y1 = Wl, y2 = y1 + Hb, y3 = y2 + Wb, y4 = y3 + Hf;
  const rows = [[0, y1, '盖（外面）', 'mailer-lid'], [y1, y2, '背面', 'mailer-back'], [y2, y3, '底面', 'mailer-bottom'], [y3, y4, '正面', 'mailer-front']];
  for (let i = 0; i < rows.length; i++) { const rr = rows[i], pts = c.rect(0, rr[0], Lc, rr[1] - rr[0]); c.fill(pts); c.region(pts, { panelId: rr[3], role: i === 0 ? 'hero' : 'design', surface: 'outside', up: 'top' }); c.label(Lc / 2, (rr[0] + rr[1]) / 2, rr[2]); c.safeR(0, rr[0], Lc, rr[1] - rr[0]); }
  const rt = 5;
  const tp = [[4, 0], [4, -tk + rt]].concat(c.q([4, -tk + rt], [4, -tk], [4 + rt, -tk], 'tr').slice(1)).concat([[Lc - 4 - rt, -tk]]).concat(c.q([Lc - 4 - rt, -tk], [Lc - 4, -tk], [Lc - 4, -tk + rt], 'tr').slice(1)).concat([[Lc - 4, 0]]);
  c.cut(tp); c.fill(tp); c.crease([[4, 0], [Lc - 4, 0]]); c.cut([[0, 0], [4, 0]]); c.cut([[Lc - 4, 0], [Lc, 0]]);
  c.crease([[0, y1], [Lc, y1]]); c.crease([[0, y2], [Lc, y2]]); c.crease([[0, y3], [Lc, y3]]);
  c.cut([[0, y4], [Lc, y4]]); c.cut([[0, y3], [0, y4]]); c.cut([[Lc, y3], [Lc, y4]]);
  c.cut([[0, y1], [0, y2]]); c.cut([[Lc, y1], [Lc, y2]]);
  const dw = Math.min(H * 0.8, 26);
  const dl = [[0, 2], [-dw + 5, 4.5], [-dw, 11], [-dw, y1 - 10], [-5, y1 - 3.5], [0, y1 - 2]];
  const mir = pts => pts.map(p => [Lc - p[0], p[1]]);
  c.cut(dl); c.fill(dl); c.crease([[0, 2], [0, y1 - 2]]); c.cut([[0, 0], [0, 2]]); c.cut([[0, y1 - 2], [0, y1]]);
  c.cut(mir(dl)); c.fill(mir(dl)); c.crease([[Lc, 2], [Lc, y1 - 2]]); c.cut([[Lc, 0], [Lc, 2]]); c.cut([[Lc, y1 - 2], [Lc, y1]]);
  const wallL = c.rect(-Sw, y2, Sw, Wb);
  c.fill(wallL); c.region(wallL, { panelId: 'mailer-wall-left', surface: 'outside', up: 'top' }); c.label(-Sw / 2, y2 + Wb / 2, '侧墙', 3.2);
  c.crease([[0, y2], [0, y3]]);
  c.cut([[-Sw, y2], [0, y2]]); c.cut([[-Sw, y2], [-Sw, y3]]);
  c.cut([[-Sw, y3], [-Sw + 1, y3]]); c.cut([[-1, y3], [0, y3]]); c.crease([[-Sw + 1, y3], [-1, y3]]);
  const eh = Math.min(Hf - 1, Sw * 0.95), re = 6;
  const ear = [[-Sw + 1, y3], [-Sw + 1, y3 + eh - re]].concat(c.q([-Sw + 1, y3 + eh - re], [-Sw + 1, y3 + eh], [-Sw + 1 + re, y3 + eh], 'tr').slice(1)).concat([[-4, y3 + eh]]).concat(c.q([-4, y3 + eh], [-1, y3 + eh], [-1, y3 + eh - 3], 'tr').slice(1)).concat([[-1, y3]]);
  c.cut(ear); c.fill(ear);
  const wallR = c.rect(Lc, y2, Sw, Wb);
  c.fill(wallR); c.region(wallR, { panelId: 'mailer-wall-right', surface: 'outside', up: 'top' }); c.label(Lc + Sw / 2, y2 + Wb / 2, '侧墙', 3.2);
  c.crease([[Lc, y2], [Lc, y3]]);
  c.cut([[Lc, y2], [Lc + Sw, y2]]); c.cut([[Lc + Sw, y2], [Lc + Sw, y3]]);
  c.cut([[Lc + Sw - 1, y3], [Lc + Sw, y3]]); c.cut([[Lc, y3], [Lc + 1, y3]]); c.crease([[Lc + 1, y3], [Lc + Sw - 1, y3]]);
  c.cut(mir(ear)); c.fill(mir(ear));
  c.dimH(0, Lc, -tk - 7, '' + c.fmt(Lc));
  c.dimH(-Sw, Lc + Sw, y4 + 10, '' + c.fmt(Lc + 2 * Sw));
  c.dimV(-tk, y4, Lc + Sw + 8, '' + c.fmt(y4 + tk));
}

// 托盘（天地盖底/盖、抽屉盒内盒共用）
export function genTray(c, Lt, Wt, hh, ox, nm, panelConfig = {}) {
  const cx1 = ox + hh, cx2 = ox + hh + Lt, cy1 = hh, cy2 = hh + Wt;
  const TW = 2 * hh + Lt, TH = 2 * hh + Wt;
  const prefix = panelConfig.prefix || 'tray', center = c.rect(cx1, cy1, Lt, Wt);
  c.fill(center); c.region(center, { panelId: panelConfig.centerId || `${prefix}-bottom`, surface: 'outside', up: 'top', ...(panelConfig.centerMeta || {}) }); c.label(cx1 + Lt / 2, cy1 + Wt / 2, '底面'); c.safeR(cx1, cy1, Lt, Wt);
  const back = c.rect(cx1, 0, Lt, hh), front = c.rect(cx1, cy2, Lt, hh), left = c.rect(ox, cy1, hh, Wt), right = c.rect(cx2, cy1, hh, Wt);
  c.fill(back); c.region(back, { panelId: `${prefix}-back`, surface: 'outside', up: 'top' });
  c.fill(front); c.region(front, { panelId: `${prefix}-front`, surface: 'outside', up: 'top' });
  c.fill(left); c.region(left, { panelId: `${prefix}-left`, surface: 'outside', up: 'top' });
  c.fill(right); c.region(right, { panelId: `${prefix}-right`, surface: 'outside', up: 'top' });
  c.label(ox + TW / 2, -8, nm, 4.5);
  c.crease([[cx1, cy1], [cx2, cy1]]); c.crease([[cx1, cy2], [cx2, cy2]]);
  c.crease([[cx1, cy1], [cx1, cy2]]); c.crease([[cx2, cy1], [cx2, cy2]]);
  c.cut([[cx1, 0], [cx2, 0]]); c.cut([[cx1, cy2 + hh], [cx2, cy2 + hh]]);
  c.cut([[ox, cy1], [ox, cy2]]); c.cut([[ox + TW, cy1], [ox + TW, cy2]]);
  c.cut([[ox, cy1], [cx1, cy1]]); c.cut([[ox, cy2], [cx1, cy2]]);
  c.cut([[cx2, cy1], [ox + TW, cy1]]); c.cut([[cx2, cy2], [ox + TW, cy2]]);
  const earTL = [[cx1, 0.6], [ox + 3, 0.6], [ox + 0.8, 3.5], [ox + 0.8, hh - 0.6], [cx1, hh - 0.6]];
  const mirX = pts => pts.map(p => [2 * ox + TW - p[0], p[1]]);
  const mirY = pts => pts.map(p => [p[0], TH - p[1]]);
  for (const e of [earTL, mirX(earTL), mirY(earTL), mirX(mirY(earTL))]) {
    c.cut(e); c.fill(e);
    const xh = e[0][0], ya = Math.min(e[0][1], e[4][1]), yb2 = Math.max(e[0][1], e[4][1]);
    c.crease([[xh, ya], [xh, yb2]]);
    const yEdge = ya < hh ? 0 : TH;
    c.cut([[xh, yEdge], [xh, yEdge === 0 ? 0.6 : TH - 0.6]]);
    c.cut([[xh, yEdge === 0 ? hh - 0.6 : cy2 + 0.6], [xh, yEdge === 0 ? hh : cy2]]);
  }
  c.dimH(ox, ox + TW, TH + 9, '' + c.fmt(TW));
  c.dimV(0, TH, ox - 8, '' + c.fmt(TH));
  return TW;
}

// 抽屉盒套筒
export function genSleeve(c, s, t, ox) {
  const L = s.L, W = s.W, H = s.H, g = 12, band = L + 2;
  const cols = [H + 2 * t, W + 3 * t, H + 3 * t, W + 4 * t];
  const xs = [ox]; cols.forEach(w => xs.push(xs[xs.length - 1] + w));
  const names = ['侧面', '顶面', '侧面', '底面'], panelIds = ['sleeve-side-left', 'sleeve-top', 'sleeve-side-right', 'sleeve-bottom'];
  for (let i = 0; i < 4; i++) { const pts = c.rect(xs[i], 0, cols[i], band); c.fill(pts); c.region(pts, { panelId: panelIds[i], role: i === 1 ? 'hero' : 'design', surface: 'outside', up: 'left' }); c.label(xs[i] + cols[i] / 2, band / 2, names[i], 3.6); c.safeR(xs[i], 0, cols[i], band); }
  c.label(ox + (xs[4] - ox) / 2, -8, '套筒（外套）', 4.5);
  const gp = [[ox, 0], [ox - g, 4], [ox - g, band - 4], [ox, band]];
  c.fill(gp); c.cut(gp); c.crease([[ox, 0], [ox, band]]);
  for (let i = 1; i < 4; i++) c.crease([[xs[i], 0], [xs[i], band]]);
  c.cut([[xs[4], 0], [xs[4], band]]);
  c.cut([[ox, 0], [xs[4], 0]]); c.cut([[ox, band], [xs[4], band]]);
  c.dimH(ox - g, xs[4], band + 9, '' + c.fmt(xs[4] - ox + g));
  c.dimV(0, band, xs[4] + 8, '' + c.fmt(band));
}
