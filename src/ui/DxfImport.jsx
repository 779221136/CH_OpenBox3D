import React, { useRef, useState } from 'react';
import { store, useStore } from '../state/store.js';
import { decodeDxf, parseDxf } from '../dieline/dxf.js';
import { prepareCustom } from '../dieline/custom.js';
import { geomOf } from '../dieline/geom.js';
import { reflowLayersToContainers } from '../design/containers.js';
import { btnSt, selectSt } from './widgets.jsx';

export function DxfImport() {
  const s = useStore(), input = useRef(null);
  const [unit, setUnit] = useState('1'), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const select = custom => store.set(st => {
    const next = { ...st, tpl: 'custom', custom, ovr: {}, typeOvr: {} }, t = store.mat().t;
    return { tpl: 'custom', custom, ovr: {}, typeOvr: {}, selSeg: null, editMode: false,
      sel: null, fold: 0, foldFromQuery: true, projectThumbnail: '', fitNonce: st.fitNonce + 1,
      layers: reflowLayersToContainers(st.layers, geomOf(st, t), geomOf(next, t)) };
  });
  const importFile = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(''); setBusy(true);
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('DXF 文件超过 10 MB，请先精简刀模。');
      const parsed = parseDxf(decodeDxf(await file.arrayBuffer()), { unitScale: +unit });
      const custom = prepareCustom({ ...parsed, name: file.name.replace(/\.dxf$/i, '').slice(0, 80) });
      select(custom);
    } catch (err) { setError(err.message || String(err)); }
    finally { setBusy(false); }
  };
  return <div style={{ gridColumn: '1 / -1', border: '1px solid ' + (s.tpl === 'custom' ? '#9a5b1f' : '#e2dac9'), background: s.tpl === 'custom' ? '#f7efe2' : '#fff', borderRadius: 6, padding: 9 }}>
    <button style={{ ...btnSt, border: 0, padding: 0, background: 'transparent', textAlign: 'left', width: '100%', color: '#5c554a' }}
      onClick={() => s.custom ? select(s.custom) : input.current.click()} disabled={busy}>
      <b>DXF · 自定义盒型</b>
    </button>
    {s.custom && <div style={{ fontSize: 11, marginTop: 5, overflowWrap: 'anywhere' }}>{s.custom.name}</div>}
    <label style={{ display: 'block', fontSize: 10, color: '#8a8071', marginTop: 8 }}>文件未声明单位时使用
      <select aria-label="DXF 无单位时的单位" value={unit} onChange={e => setUnit(e.target.value)} style={{ ...selectSt, marginTop: 3 }}>
        <option value="1">毫米 mm</option><option value="10">厘米 cm</option><option value="1000">米 m</option><option value="25.4">英寸 inch</option>
      </select>
    </label>
    <input ref={input} type="file" accept=".dxf" aria-label="导入自定义 DXF 文件" onChange={importFile} hidden />
    <button disabled={busy} onClick={() => input.current.click()} style={{ ...btnSt, width: '100%', marginTop: 7 }}>{busy ? '正在转换…' : '导入 / 替换 DXF'}</button>
    <div style={{ fontSize: 10, color: '#8a8071', marginTop: 6 }}>红色切线 · 绿色压痕 · 自动转换为毫米</div>
    {error && <div role="alert" style={{ color: '#b33', fontSize: 11, marginTop: 7, whiteSpace: 'pre-wrap' }}>{error}</div>}
  </div>;
}

export function CustomFoldControls({ custom }) {
  const setAngle = (id, value) => {
    if (value === '') return;
    const angle = Number(value);
    if (Number.isFinite(angle)) store.set({ custom: { ...custom, angles: { ...custom.angles, [id]: Math.max(-180, Math.min(180, angle)) } } });
  };
  return <>
    <style>{`
      .dxf-fold-angle { appearance: none; -webkit-appearance: none; height: 16px; background: transparent; }
      .dxf-fold-angle::-webkit-slider-runnable-track { height: 3px; border-radius: 2px; background: linear-gradient(to right, #9a5b1f var(--angle-progress), #ded5c4 var(--angle-progress)); }
      .dxf-fold-angle::-webkit-slider-thumb { appearance: none; -webkit-appearance: none; width: 10px; height: 10px; margin-top: -3.5px; border: 0; border-radius: 50%; background: #9a5b1f; }
      .dxf-fold-angle::-moz-range-track { height: 3px; border-radius: 2px; background: #ded5c4; }
      .dxf-fold-angle::-moz-range-progress { height: 3px; border-radius: 2px; background: #9a5b1f; }
      .dxf-fold-angle::-moz-range-thumb { width: 10px; height: 10px; border: 0; border-radius: 50%; background: #9a5b1f; }
    `}</style>
    <div style={{ fontSize: 11, lineHeight: 1.6, color: '#8a8071', marginBottom: 8 }}>压痕默认内折 90°。DXF 不含折叠角度，请按实物调整；负数为反向折叠。预览不计算碰撞。</div>
    <label style={{ fontSize: 11 }}>固定面
      <select aria-label="DXF 固定面" value={custom.root} style={{ ...selectSt, margin: '4px 0 8px' }} onChange={e => store.set({ custom: { ...custom, root: e.target.value } })}>
        {custom.panels.map((p, i) => <option key={p.panelId} value={p.panelId}>面 {i + 1}</option>)}
      </select>
    </label>
    {custom.hinges.map((h, i) => <div key={h.id} style={{ display: 'grid', gridTemplateColumns: '68px minmax(0, 1fr) 52px', gap: 6, alignItems: 'center', fontSize: 11, marginBottom: 5 }}>
      <span>压痕 {i + 1}<small style={{ display: 'block', color: '#8a8071' }}>面 {custom.panels.findIndex(p => p.panelId === h.a) + 1} ↔ {custom.panels.findIndex(p => p.panelId === h.b) + 1} · °</small></span>
      <input className="dxf-fold-angle" aria-label={'压痕 ' + (i + 1) + ' 角度滑块'} type="range" min="-180" max="180" step="1" value={custom.angles?.[h.id] ?? h.angle ?? 90}
        style={{ width: '100%', minWidth: 0, margin: 0, '--angle-progress': ((custom.angles?.[h.id] ?? h.angle ?? 90) + 180) / 3.6 + '%' }} onChange={e => setAngle(h.id, e.target.value)} />
      <input aria-label={'压痕 ' + (i + 1) + ' 角度'} type="number" min="-180" max="180" step="1" value={custom.angles?.[h.id] ?? h.angle ?? 90}
        style={{ width: '100%', minWidth: 0, boxSizing: 'border-box', fontSize: 12, border: '1px solid #ded5c4', borderRadius: 4, padding: 4 }} onChange={e => setAngle(h.id, e.target.value)} />
    </div>)}
    {!custom.hinges.length && <div style={{ fontSize: 11 }}>没有可连接面板的直线压痕，当前为展开预览。</div>}
  </>;
}
