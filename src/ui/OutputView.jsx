// 输出视图：项目摘要 / 导出前校验 / 工艺分版清单 / 生产文件
import React from 'react';
import { store, useStore } from '../state/store.js';
import { geomOf, creaseSegsOf } from '../dieline/geom.js';
import { templateNameOf } from '../dieline/templates.js';
import { warnsOf, FIN_NAMES, layerNameOf, dpiOf } from '../design/layers.js';
import { embDirOf } from '../design/emboss.js';
import { exportPDF } from '../export/pdf.js';
import { exportSeparations } from '../export/separations.js';
import { ST, KV, btnSt } from './widgets.jsx';

export function OutputView() {
  const s = useStore();
  const m = store.mat();
  const g = geomOf(s, m.t);
  const fmt = v => Math.round(v * 10) / 10;
  const sw = g.sbb[2] - g.sbb[0], sh = g.sbb[3] - g.sbb[1];
  const tplName = templateNameOf(s);
  const typeOvrCount = Object.keys(s.typeOvr).length;
  const creaseSegs = creaseSegsOf(g);
  const missingImages = s.layers.filter(l => l.visible && l.kind === 'image' && !l.img);
  const loadedImages = s.layers.filter(l => l.visible && l.kind === 'image' && l.img);
  const lowDpiImages = loadedImages.filter(l => dpiOf(l) < 300);
  const checksArr = [
    { label: '页面按毫米 1:1 生成，并写入 TrimBox / BleedBox', dot: '#3f9e5f' },
    { label: 'CutContour / Crease 以专色叠印输出', dot: '#3f9e5f' },
    { label: '出血 ' + s.bleed + ' mm ' + (s.bleed >= m.bleed ? '≥' : '<') + ' 材质建议 ' + m.bleed + ' mm（' + m.note + '）', dot: s.bleed >= m.bleed ? '#3f9e5f' : '#d05a2a' },
    { label: missingImages.length ? '有 ' + missingImages.length + ' 个图片资源尚未加载，专业净稿/工艺分版将阻止导出' : '图片资源均已加载', dot: missingImages.length ? '#d05a2a' : '#3f9e5f' },
    { label: lowDpiImages.length ? '有 ' + lowDpiImages.length + ' 个图片图层低于 300 dpi' : loadedImages.length ? '已加载图片均达到 300 dpi' : '暂无已加载图片可检查 DPI', dot: lowDpiImages.length ? '#d05a2a' : loadedImages.length ? '#3f9e5f' : '#9a8f7e' },
    { label: '轮廓闭合、自交、孤立线段与最小刀距：本版本未自动检测，交付前须由印厂/RIP 预检', dot: '#9a8f7e' }
  ];
  const designWarnRows = s.layers.flatMap(l => warnsOf(l, creaseSegs, g.sbb).map(w => ({ label: '图层「' + layerNameOf(l) + '」：' + w, dot: '#d05a2a' })));
  const outChecks = checksArr.concat(designWarnRows, s.tpl === 'custom' ? s.custom.warnings.map(label => ({ label, dot: '#d05a2a' })) : []);
  const outSummary = [
    { k: '盒型', v: tplName }, { k: s.tpl === 'custom' ? '来源' : '内尺寸', v: s.tpl === 'custom' ? 'DXF · ' + s.custom.sourceUnits : s.L + ' × ' + s.W + ' × ' + s.H + ' mm' },
    { k: '材质', v: m.name + ' · t=' + m.t }, { k: '出血', v: s.bleed + ' mm' },
    { k: '展开尺寸', v: fmt(sw) + ' × ' + fmt(sh) + ' mm' },
    { k: '刀线', v: g.cutN + ' 切 · ' + g.creaseN + ' 压 · 线型调整 ' + typeOvrCount },
    { k: '设计图层', v: s.layers.length + ' 层' }
  ];
  const outFins = ['foil', 'silver', 'uv', 'gloss', 'holo'].map(f => ({ k: FIN_NAMES[f] + '版', v: s.layers.filter(l => l.finish === f).map(layerNameOf).join('、') || '—' }))
    .concat(['up', 'down'].map(dir => ({ k: (dir === 'up' ? '击凸' : '击凹') + '版', v: s.layers.filter(l => l.finish === 'emboss' && embDirOf(l, s.embDir) === dir).map(layerNameOf).join('、') || '—' })))
    .concat([{ k: '四色印刷', v: s.layers.filter(l => l.finish === 'none').length + ' 层' }]);
  const card = { background: '#fdfcf7', border: '1px solid #ded5c4', borderRadius: 10, padding: '18px 20px' };
  const runExport = async fn => { try { await fn(); } catch (e) { alert(e.message || String(e)); } };

  return (
    <div style={{ flex: 1, overflowY: 'auto', background: '#f0ebe0' }}>
      <div style={{ maxWidth: 900, margin: '24px auto', padding: '0 20px 30px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, alignItems: 'start' }}>
        <div style={card}><ST>项目摘要</ST>{outSummary.map(r => (
          <div key={r.k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '5px 0', fontSize: 12.5, borderBottom: '1px dashed #eee7d8' }}>
            <span style={{ color: '#6d6557', whiteSpace: 'nowrap' }}>{r.k}</span>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", color: '#211d18', textAlign: 'right' }}>{r.v}</span>
          </div>))}
        </div>
        <div style={card}>
          <ST>导出前校验</ST>
          {outChecks.map(c => (
            <div key={c.label} style={{ display: 'flex', gap: 9, alignItems: 'baseline', padding: '4px 0', fontSize: 12.5, color: '#3d3830', lineHeight: 1.5 }}>
              <span style={{ width: 7, height: 7, borderRadius: 99, background: c.dot, flex: 'none', transform: 'translateY(-1px)' }} />{c.label}
            </div>))}
        </div>
        <div style={card}><ST>工艺分版清单（来自设计页图层）</ST>{outFins.map(f => (
          <div key={f.k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '5px 0', fontSize: 12.5, borderBottom: '1px dashed #eee7d8' }}>
            <span style={{ color: '#6d6557', whiteSpace: 'nowrap' }}>{f.k}</span>
            <span style={{ color: '#211d18', textAlign: 'right' }}>{f.v}</span>
          </div>))}
        </div>
        <div style={card}>
          <ST>生产文件</ST>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 10, fontSize: 12, color: '#3d3830', alignItems: 'center' }}>
            <span style={{ color: '#8a8071', fontSize: 11 }}>印刷 PDF：</span>
            {[['cmyk', '生产稿 · CMYK+专色'], ['professional', '专业净稿 · CMYK'], ['rgb', '评审稿 · RGB']].map(op => (
              <label key={op[0]} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                <input type="radio" name="pdfmode" checked={s.pdfMode === op[0]} onChange={() => store.set({ pdfMode: op[0] })} style={{ accentColor: '#9a5b1f' }} />{op[1]}
              </label>
            ))}
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            <button onClick={() => runExport(() => exportPDF(s, m, s.pdfMode))} style={{ ...btnSt, padding: '9px 0', border: '1px solid #9a5b1f', fontSize: 13, fontWeight: 700, color: '#9a5b1f' }}>导出印刷 PDF（1:1 · 刀线专色叠印 · 出血）</button>
            <button onClick={() => runExport(() => exportSeparations(s, m))} style={{ ...btnSt, padding: '9px 0', border: '1px solid #9a5b1f', fontSize: 13, fontWeight: 700, color: '#9a5b1f' }}>工艺分版 PDF（烫金/UV/亮面/压纹）</button>
          </div>
          <div style={{ marginTop: 12, fontSize: 11, lineHeight: 1.65, color: '#8a8071' }}>专业净稿：仅保留普通四色图层，未设计区域为纯白，不写页内说明；烫金/UV/亮面/压纹/镭射请另导工艺分版。生产稿保留既有工艺预览与可视说明以兼容旧流程。两种 CMYK 均为 300dpi 朴素转换、无 ICC，不宣称 PDF/X，色彩以印厂打样为准。工艺分版：300dpi DeviceGray 无损 PDF（黑 = 工艺覆盖区，灰虚线 = 刀线参考）。镭射（幻彩）随角度变色无法以 CMYK 表达，数据层只交付覆盖区域：局部用 HOLO-FOIL 镭射版烫印，满版则属镭射膜/镭射卡材料选择；彩色镭射 = 换彩色镭射箔或镭射上叠印半透明油墨（3D 预览对应「镭射底色」参数），分版数据不变。</div>
        </div>
      </div>
    </div>
  );
}
