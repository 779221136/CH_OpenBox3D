// 工艺分版导出（P0 基线）：每个工艺一个单色 1:1 PDF（黑=该工艺覆盖区），供制版直接使用
import { geomOf } from '../dieline/geom.js';
import { drawLayer } from '../design/layers.js';
import { composeEmbossChannels } from '../design/emboss.js';
import { clipPtsOf } from '../design/containers.js';
import { writePdf, pageBoxes, zlib, pdfTextStream } from './pdf.js';

export async function exportSeparations(s, mat) {
  await document.fonts.ready;
  const missing = s.layers.filter(l => l.visible && l.finish && l.finish !== 'none' && l.kind === 'image' && !l.img);
  if (missing.length) throw new Error('工艺分版未导出：存在 ' + missing.length + ' 个尚未加载的工艺图片图层。');
  const g = geomOf(s, mat.t);
  const { b, ox, oy, Wmm, Hmm, k, Wpt, Hpt, trim, trimRect } = pageBoxes(s, g);
  const S = 300 / 25.4;
  const emboss = composeEmbossChannels({ layers: s.layers.filter(l => l.visible && l.finish === 'emboss'), panels: g.panels, W: Math.round(Wmm * S), H: Math.round(Hmm * S), S, ox, oy, fallbackDir: s.embDir });
  const PROCS = [
    { key: 'foil', match: l => l.finish === 'foil' || l.finish === 'silver', label: 'HOT-FOIL', cn: '烫金版' },
    { key: 'uv', match: l => l.finish === 'uv', label: 'SPOT-UV', cn: 'UV版' },
    { key: 'gloss', match: l => l.finish === 'gloss', label: 'SPOT-GLOSS', cn: '亮面版' },
    { key: 'holo', match: l => l.finish === 'holo', label: 'HOLO-FOIL', cn: '镭射版' },
    { key: 'emboss-up', mask: emboss.up, exists: emboss.hasUp, label: 'EMBOSS UP ' + s.embDepth + 'MM', cn: '击凸版' },
    { key: 'emboss-down', mask: emboss.down, exists: emboss.hasDown, label: 'EMBOSS DOWN ' + s.embDepth + 'MM', cn: '击凹版' }
  ];
  const base = s.tpl === 'custom' ? 'DXF_' + (Wmm - 2 * b).toFixed(1) + 'x' + (Hmm - 2 * b).toFixed(1) : s.tpl + '_' + s.L + 'x' + s.W + 'x' + s.H;
  let made = 0;
  for (const proc of PROCS) {
    const ls = proc.match ? s.layers.filter(l => l.visible && proc.match(l)) : [];
    if (proc.mask ? !proc.exists : !ls.length) continue;
    made++;
    const cv = document.createElement('canvas');
    cv.width = Math.round(Wmm * S); cv.height = Math.round(Hmm * S);
    const c = cv.getContext('2d');
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, cv.width, cv.height);
    if (proc.mask) { c.globalCompositeOperation = 'difference'; c.drawImage(proc.mask, 0, 0); c.globalCompositeOperation = 'source-over'; }
    else { c.save(); c.translate(-ox * S, -oy * S); for (const l of ls) drawLayer(c, l, S, '#000000', clipPtsOf(g.panels, l)); c.restore(); }
    const rgba = c.getImageData(0, 0, cv.width, cv.height).data, gray = new Uint8Array(cv.width * cv.height);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j++) gray[j] = Math.round(rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114);
    const packed = await zlib(gray);
    const imgObj = { bin: packed, pre: '<< /Type /XObject /Subtype /Image /Width ' + cv.width + ' /Height ' + cv.height + ' /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ' + packed.length + ' >>\nstream\n', post: '\nendstream' };
    const PX = v => ((v - ox) * k).toFixed(2), PY = v => (Hpt - (v - oy) * k).toFixed(2);
    const outline = g.segs.filter(sg => sg.t === 'cut').map(sg =>
      sg.pts.map((p, i) => PX(p[0]) + ' ' + PY(p[1]) + (i ? ' l' : ' m')).join(' ') + ' S').join('\n');
    const content = 'q ' + Wpt.toFixed(2) + ' 0 0 ' + Hpt.toFixed(2) + ' 0 0 cm /Im0 Do Q\n'
      + '0.35 w 0.6 0.6 0.6 RG [1.5 1.5] 0 d\n' + outline + '\n[] 0 d\n'
      + '0.35 w 0.55 0.55 0.55 RG [2 2] 0 d ' + trimRect + ' re S [] 0 d\n'
      + 'BT /F1 7 Tf 0 0 0 rg 6 ' + (Hpt - 11).toFixed(2) + ' Td (' + proc.label + ' PLATE  ' + base + '  1:1  BLACK = PROCESS AREA) Tj ET';
    writePdf([
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + Wpt.toFixed(2) + ' ' + Hpt.toFixed(2) + '] /TrimBox [' + trim + '] /BleedBox [0 0 ' + Wpt.toFixed(2) + ' ' + Hpt.toFixed(2) + '] /CropBox [0 0 ' + Wpt.toFixed(2) + ' ' + Hpt.toFixed(2) + '] /Resources << /XObject << /Im0 4 0 R >> /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
      imgObj,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      pdfTextStream(content)
    ], base + '_' + proc.key + '_plate.pdf');
  }
  if (!made) alert('没有可分版的工艺图层：请先在「设计」页为图层指定烫金/UV/亮面/压纹/镭射工艺。');
}
