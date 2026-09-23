// 设计视图：图层列表 + 分层画布 + 属性面板（内容/变换/对齐/排版/尺寸/工艺/排列/警示）
import React, { useEffect, useRef } from 'react';
import { store, useStore } from '../state/store.js';
import { geomOf, creaseSegsOf } from '../dieline/geom.js';
import { heroPanelOf } from '../dieline/hero.js';
import { bboxOf, warnsOf, dpiOf, FIN, layerNameOf, randomImageName } from '../design/layers.js';
import { bboxOfPts, containerOfLayer } from '../design/containers.js';
import { embDirOf } from '../design/emboss.js';
import { uploadImage, imageFilesOf, readImageFile, imageLayerAt } from '../design/images.js';
import { fitSheetImage } from '../design/sheetFit.js';
import { SheetCanvas } from './SheetCanvas.jsx';
import { ST, Block, Note, inputSt, selectSt, btnSt } from './widgets.jsx';

export function DesignView({ allowSheetImage = false, preview = null }) {
  const s = useStore();
  const sheetInput = useRef(null);
  const m = store.mat();
  const g = geomOf(s, m.t);
  const hero = heroPanelOf(g);
  const creaseSegs = creaseSegsOf(g);
  const upd = patch => store.set(st => ({ layers: st.layers.map(l => l.id === st.sel ? { ...l, ...patch, heroPreset: undefined } : l) }));
  const sel = s.layers.find(l => l.id === s.sel);
  const selWarns = sel ? warnsOf(sel, creaseSegs, g.sbb) : [];
  const [histPastN, histFutureN] = store.histDepth(); // 撤销/重做栈深度（随 store 变更自动刷新）

  // 键盘：⌘Z 撤销 · ⌘⇧Z/⌃Y 重做 · 方向键微移 1mm（Shift=5mm）· Delete 删除 · ⌘D 复制 · Esc 取消选中
  useEffect(() => {
    const kd = e => {
      const st = store.get();
      if (st.view !== 'design') return;
      const tag = (document.activeElement || {}).tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) store.redo(); else store.undo(); return; }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); store.redo(); return; }
      if (st.sel == null) return;
      const l = st.layers.find(x => x.id === st.sel); if (!l) return;
      const step = e.shiftKey ? 5 : 1;
      const mv = (dx, dy) => { e.preventDefault(); if (!l.locked) store.set(s2 => ({ layers: s2.layers.map(x => x.id === s2.sel ? { ...x, x: x.x + dx, y: x.y + dy, heroPreset: undefined } : x) })); };
      if (e.key === 'ArrowLeft') mv(-step, 0);
      else if (e.key === 'ArrowRight') mv(step, 0);
      else if (e.key === 'ArrowUp') mv(0, -step);
      else if (e.key === 'ArrowDown') mv(0, step);
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); store.set(s2 => ({ layers: s2.layers.filter(x => x.id !== s2.sel), sel: null })); }
      else if ((e.metaKey || e.ctrlKey) && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); dupLayer(); }
      else if (e.key === 'Escape') store.set({ sel: null });
    };
    window.addEventListener('keydown', kd);
    return () => window.removeEventListener('keydown', kd);
  }, []);

  const dupLayer = () => store.set(st => {
    const l = st.layers.find(x => x.id === st.sel); if (!l) return null;
    const nl = { ...l, id: st.seq, locked: false, heroPreset: undefined }; // 原位置复制，不偏移
    return { layers: st.layers.concat([nl]), seq: st.seq + 1, sel: nl.id };
  });
  const addL = mk => store.set(st => {
    const nl = mk(st.seq, hero);
    const bound = nl.scope !== 'sheet' && nl.panelId == null && hero ? { ...nl, panelId: hero.panelId } : nl;
    return { layers: st.layers.concat([bound]), seq: st.seq + 1, sel: bound.id };
  });
  const moveL = d => store.set(st => {
    const i = st.layers.findIndex(l => l.id === st.sel); if (i < 0) return null;
    const j = i + d; if (j < 0 || j >= st.layers.length) return null;
    const ls = st.layers.slice(); const it = ls.splice(i, 1)[0]; ls.splice(j, 0, it);
    return { layers: ls };
  });
  const alignSel = ty => {
    if (!sel || sel.locked) return;
    const b = bboxOf(sel);
    const panel = containerOfLayer(g, sel);
    let pb = panel ? bboxOfPts(panel.pts) : null;
    if (!pb) pb = [g.sbb[0], g.sbb[1], g.sbb[2], g.sbb[3]];
    const m2 = 3;
    let tx = null, ty2 = null;
    if (ty === 'l') tx = pb[0] + m2; else if (ty === 'cx') tx = (pb[0] + pb[2]) / 2 - b[2] / 2; else if (ty === 'r') tx = pb[2] - m2 - b[2];
    if (ty === 't') ty2 = pb[1] + m2; else if (ty === 'cy') ty2 = (pb[1] + pb[3]) / 2 - b[3] / 2; else if (ty === 'b') ty2 = pb[3] - m2 - b[3];
    upd({ ...(tx != null ? { x: sel.x + (tx - b[0]) } : {}), ...(ty2 != null ? { y: sel.y + (ty2 - b[1]) } : {}) });
  };
  const numIn = fn => e => { const v = parseFloat(e.target.value); if (!isNaN(v)) fn(v); };
  const uploadSheet = async e => {
    const file = imageFilesOf(e.target.files)[0]; e.target.value = '';
    if (!file) return;
    try {
      const asset = await readImageFile(file);
      const fit = fitSheetImage(asset, geomOf(store.get(), store.mat().t));
      addL(id => {
        const name = randomImageName();
        return { id, kind: 'image', scope: 'sheet', name, content: name, finish: 'none', visible: true, ...asset, ...fit };
      });
    } catch (error) { alert(error.message || '图片读取失败，请使用 PNG、JPG 或 WebP 文件。'); }
  };
  const fitSelectedSheet = () => {
    if (!sel || sel.locked) return;
    try { upd(fitSheetImage(sel, g)); }
    catch (error) { alert(error.message || '图片匹配失败，请重新导入图片。'); }
  };
  const dropImages = async (files, point, panel) => {
    const imageFiles = imageFilesOf(files); if (!imageFiles.length || !panel) return;
    try {
      const assets = await Promise.all(imageFiles.map(readImageFile));
      store.set(st => {
        const added = assets.map((asset, i) => imageLayerAt(st.seq + i, asset, panel, [point[0] + i * 2, point[1] + i * 2]));
        return { layers: st.layers.concat(added), seq: st.seq + added.length, sel: added[added.length - 1].id };
      });
    } catch (_) { alert('图片读取失败，请使用 PNG、JPG 或 WebP 文件。'); }
  };

  return (<>
    <div style={{ width: 246, flex: 'none', background: '#faf7f0', borderRight: '1px solid #ded5c4', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      <Block>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 9 }}>
          <ST style={{ marginBottom: 0 }}>图层</ST>
          <div style={{ display: 'flex', gap: 5 }}>
            <button onClick={() => store.undo()} disabled={!histPastN} title="上一步（⌘Z / Ctrl+Z）" style={{ ...btnSt, padding: '3px 8px', fontSize: 11, opacity: histPastN ? 1 : 0.4, cursor: histPastN ? 'pointer' : 'default' }}>↶ 上一步</button>
            <button onClick={() => store.redo()} disabled={!histFutureN} title="下一步（⌘⇧Z / Ctrl+Shift+Z）" style={{ ...btnSt, padding: '3px 8px', fontSize: 11, opacity: histFutureN ? 1 : 0.4, cursor: histFutureN ? 'pointer' : 'default' }}>↷ 下一步</button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <button onClick={() => addL((id, hp) => ({ id, kind: 'text', x: hp.cx, y: hp.cy, content: '双击右栏编辑文字', font: 'Noto Sans SC', size: 6, weight: 400, color: '#211d18', finish: 'none', visible: true }))} style={{ ...btnSt, flex: 1, fontSize: 11.5 }}>+ 文字</button>
          <button onClick={() => uploadImage(addL)} style={{ ...btnSt, flex: 1, fontSize: 11.5 }}>+ 图片</button>
          <button onClick={() => addL((id, hp) => { const w = Math.min(30, hp.safeBox[2] - hp.safeBox[0]), h = Math.min(8, hp.safeBox[3] - hp.safeBox[1]); return { id, kind: 'shape', x: hp.cx - w / 2, y: hp.cy - h / 2, w, h, content: '色块', color: '#9a5b1f', finish: 'none', visible: true }; })} style={{ ...btnSt, flex: 1, fontSize: 11.5 }}>+ 色块</button>
        </div>
        {allowSheetImage && <>
          <input ref={sheetInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={uploadSheet} />
          <button onClick={() => sheetInput.current?.click()} style={{ ...btnSt, width: '100%', marginBottom: 10, fontSize: 11.5 }}>+ 整版图片</button>
        </>}
        <div style={{ display: 'grid', gap: 5 }}>
          {s.layers.slice().reverse().map(l => {
            const warn = warnsOf(l, creaseSegs, g.sbb).length > 0;
            return (
              <div key={l.id} data-layer-id={l.id} onClick={() => store.set({ sel: l.id })}
                title={layerNameOf(l)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, overflow: 'hidden', padding: '7px 9px', borderRadius: 6, cursor: 'pointer', border: '1px solid ' + (s.sel === l.id ? '#9a5b1f' : '#e7e0d4'), background: s.sel === l.id ? '#f7efe2' : '#fff' }}>
                <span onClick={e => { e.stopPropagation(); store.set(st => ({ layers: st.layers.map(x => x.id === l.id ? { ...x, visible: !x.visible } : x) })); }} title="显示/隐藏" style={{ width: 16, flex: 'none', textAlign: 'center', fontSize: 11, cursor: 'pointer', opacity: l.visible ? 1 : 0.25 }}>◉</span>
                <span onClick={e => { e.stopPropagation(); store.set(st => ({ layers: st.layers.map(x => x.id === l.id ? { ...x, locked: !x.locked } : x) })); }} title="锁定/解锁" style={{ width: 15, flex: 'none', textAlign: 'center', fontSize: 10, cursor: 'pointer', color: l.locked ? '#9a5b1f' : '#cfc4ab' }}>{l.locked ? '锁' : '·'}</span>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9.5, fontWeight: 700, color: '#8a8071', border: '1px solid #ded5c4', borderRadius: 3, padding: '1px 4px', flex: 'none' }}>{l.kind === 'text' ? 'T' : l.kind === 'image' ? '图' : '块'}</span>
                <span data-layer-name={layerNameOf(l)} style={{ flex: 1, minWidth: 0, fontSize: 12, color: '#211d18', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{layerNameOf(l)}</span>
                <span style={{ fontSize: 10, color: '#9a5b1f', flex: 'none' }}>{l.finish === 'emboss' ? '压纹' + (embDirOf(l, s.embDir) === 'up' ? '↑' : '↓') : (FIN[l.finish] || '')}</span>
                {warn && <span style={{ width: 7, height: 7, borderRadius: 99, background: '#d05a2a', flex: 'none' }} />}
              </div>
            );
          })}
        </div>
      </Block>
      <div style={{ padding: 14 }}>
        <Note><b style={{ color: '#211d18' }}>分层规则</b>　拖动图层移动位置；跨压痕线、越出安全区、低于 300dpi 时右栏红点警示。设为「烫金/局部UV/亮面/压纹」的图层会进入对应的独立工艺通道。</Note>
      </div>
    </div>

    <SheetCanvas view="design" g={g} onImageDrop={dropImages} />

    <div style={{ width: 258, flex: 'none', background: '#faf7f0', borderLeft: '1px solid #ded5c4', overflowY: 'auto' }}>
      {preview}
      {!sel && <div style={{ padding: '20px 14px', fontSize: 12, color: '#8a8071', lineHeight: 1.7 }}>未选中图层。点击画布中的元素或左侧图层列表进行编辑。</div>}
      {sel && (<>
        <Block>
          <ST>图层名称</ST>
          <input aria-label="图层名称" maxLength={32} value={typeof sel.name === 'string' ? sel.name : layerNameOf(sel)} onChange={e => upd({ name: e.target.value })} style={{ ...inputSt, fontFamily: 'inherit' }} />
        </Block>
        {sel.kind === 'text' && <Block><ST>文字内容</ST><input aria-label="文字内容" value={sel.content || ''} onChange={e => upd({ content: e.target.value })} style={{ ...inputSt, fontFamily: 'inherit' }} /></Block>}
        <Block>
          <ST>变换</ST>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 7, marginBottom: 10 }}>
            <div><div style={{ fontSize: 10.5, color: '#8a8071', marginBottom: 3 }}>X mm</div><input type="number" step="0.5" value={Math.round(sel.x * 10) / 10} onChange={numIn(v => upd({ x: v }))} style={inputSt} /></div>
            <div><div style={{ fontSize: 10.5, color: '#8a8071', marginBottom: 3 }}>Y mm</div><input type="number" step="0.5" value={Math.round(sel.y * 10) / 10} onChange={numIn(v => upd({ y: v }))} style={inputSt} /></div>
            <div><div style={{ fontSize: 10.5, color: '#8a8071', marginBottom: 3 }}>旋转 °</div><input type="number" step="1" value={sel.rot || 0} onChange={numIn(v => upd({ rot: ((v % 360) + 360) % 360 }))} style={inputSt} /></div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
            <div style={{ fontSize: 10.5, color: '#8a8071' }}>不透明度</div>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: '#9a5b1f' }}>{Math.round((sel.opacity == null ? 1 : sel.opacity) * 100)}%</div>
          </div>
          <input type="range" min="0" max="100" value={Math.round((sel.opacity == null ? 1 : sel.opacity) * 100)} onChange={numIn(v => upd({ opacity: Math.min(1, Math.max(0, v / 100)) }))} style={{ width: '100%', accentColor: '#9a5b1f', margin: 0 }} />
        </Block>
        <Block>
          <ST>对齐 · {sel.scope === 'sheet' ? '整版刀模' : '所在面板'}</ST>
          {allowSheetImage && sel.kind === 'image' && sel.scope === 'sheet' && <button onClick={fitSelectedSheet} disabled={sel.locked}
            title="按透明轮廓匹配大小和方向；普通图片按宽高比例适配" style={{ ...btnSt, width: '100%', marginBottom: 8 }}>自动匹配刀模</button>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 5 }}>
            {[['l', '⊢', '左对齐'], ['cx', '↔', '水平居中'], ['r', '⊣', '右对齐'], ['t', '⊤', '顶对齐'], ['cy', '↕', '垂直居中'], ['b', '⊥', '底对齐']].map(x => (
              <button key={x[0]} onClick={() => alignSel(x[0])} title={x[2]} style={{ ...btnSt, fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>{x[1]}</button>
            ))}
          </div>
        </Block>
        {sel.kind === 'text' && (
          <Block>
            <ST>排版</ST>
            <select value={sel.font} onChange={e => upd({ font: e.target.value })} style={{ ...selectSt, marginBottom: 8 }}>
              <option value="Noto Sans SC">思源黑体 Noto Sans SC</option>
              <option value="Noto Serif SC">思源宋体 Noto Serif SC</option>
              <option value="JetBrains Mono">JetBrains Mono</option>
            </select>
            <div style={{ display: 'flex', gap: 7, marginBottom: 10 }}>
              <div style={{ flex: 1 }}><div style={{ fontSize: 10.5, color: '#8a8071', marginBottom: 3 }}>字号 mm</div><input type="number" step="0.5" value={sel.size} onChange={numIn(v => upd({ size: Math.min(60, Math.max(1.5, v)) }))} style={inputSt} /></div>
              <div style={{ flex: 'none', display: 'flex', alignItems: 'flex-end' }}><button onClick={() => upd({ weight: sel.weight === 700 ? 400 : 700 })} style={{ padding: '7px 12px', borderRadius: 5, border: '1px solid #d8d0c2', cursor: 'pointer', fontSize: 12, fontWeight: 700, background: sel.weight === 700 ? '#211d18' : '#fff', color: sel.weight === 700 ? '#fff' : '#3d3830', whiteSpace: 'nowrap' }}>B 加粗</button></div>
            </div>
            <div style={{ display: 'flex', gap: 7 }}>
              {['#211d18', '#9a5b1f', '#C9A227', '#4a5d4e', '#fdfcf7'].map(c => (
                <div key={c} onClick={() => upd({ color: c })} style={{ width: 24, height: 24, borderRadius: 5, background: c, cursor: 'pointer', border: '2px solid ' + (sel.color === c ? '#9a5b1f' : '#ded5c4'), boxSizing: 'border-box' }} />
              ))}
            </div>
          </Block>
        )}
        {sel.kind !== 'text' && (
          <Block>
            <ST>尺寸 · mm</ST>
            <div style={{ display: 'flex', gap: 7 }}>
              <div style={{ flex: 1 }}><div style={{ fontSize: 10.5, color: '#8a8071', marginBottom: 3 }}>宽</div><input type="number" value={sel.w} onChange={numIn(v => upd({ w: Math.max(2, v) }))} style={inputSt} /></div>
              <div style={{ flex: 1 }}><div style={{ fontSize: 10.5, color: '#8a8071', marginBottom: 3 }}>高</div><input type="number" value={sel.h} onChange={numIn(v => upd({ h: Math.max(1, v) }))} style={inputSt} /></div>
              {sel.kind === 'image' && !sel.imgSrc && (
                <div style={{ flex: 1.2 }}><div style={{ fontSize: 10.5, color: '#8a8071', marginBottom: 3 }}>素材宽 px</div><input type="number" step="100" value={sel.pxw} onChange={numIn(v => upd({ pxw: Math.max(50, v) }))} style={inputSt} /></div>
              )}
            </div>
            {sel.kind === 'image' && sel.imgSrc && (
              <div style={{ marginTop: 8, fontSize: 10.5, color: dpiOf(sel) >= 300 ? '#8a8071' : '#c0492b', fontFamily: "'JetBrains Mono',monospace", display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>{sel.imgW}×{sel.imgH}px · {dpiOf(sel)} dpi{dpiOf(sel) < 300 ? ' · 不足 300' : ''}</span>
                <span onClick={() => uploadImage(addL, sel.id)} style={{ color: '#9a5b1f', cursor: 'pointer', textDecoration: 'underline' }}>替换</span>
                <span onClick={() => store.set(st => ({ uiCrop: !st.uiCrop }))} style={{ color: s.uiCrop ? '#fff' : '#9a5b1f', background: s.uiCrop ? '#9a5b1f' : 'transparent', borderRadius: 3, padding: '1px 5px', cursor: 'pointer', textDecoration: s.uiCrop ? 'none' : 'underline' }}>{s.uiCrop ? '裁剪中✓' : '裁剪'}</span>
              </div>
            )}
          </Block>
        )}
        <Block>
          <ST>工艺</ST>
          <select aria-label="图层工艺" value={sel.finish} onChange={e => { const finish = e.target.value; upd({ finish }); if (finish === 'gloss') store.set(st => ({ fx: { ...st.fx, gloss: true } })); if (finish === 'holo' && !store.get().iridescence3d) store.set({ iridescence3d: 0.85 }); }} style={selectSt}>
            <option value="none">无（四色印刷）</option>
            <option value="foil">烫金 · R 通道</option>
            <option value="silver">烫银 · R 通道</option>
            <option value="uv">局部 UV · G 通道</option>
            <option value="gloss">亮面 · 反光通道</option>
            <option value="emboss">压纹 · B 通道</option>
            <option value="holo">镭射 · 幻彩通道</option>
          </select>
          {sel.finish === 'emboss' && (
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button onClick={() => upd({ embDir: 'up' })} style={{ ...btnSt, flex: 1, background: embDirOf(sel, s.embDir) === 'up' ? '#9a5b1f' : '#fff', color: embDirOf(sel, s.embDir) === 'up' ? '#fff' : '#5c554a' }}>击凸 ↑</button>
              <button onClick={() => upd({ embDir: 'down' })} style={{ ...btnSt, flex: 1, background: embDirOf(sel, s.embDir) === 'down' ? '#9a5b1f' : '#fff', color: embDirOf(sel, s.embDir) === 'down' ? '#fff' : '#5c554a' }}>击凹 ↓</button>
            </div>
          )}
        </Block>
        <Block>
          <ST>排列</ST>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6, marginBottom: 8 }}>
            <button onClick={() => store.set(st => { const i = st.layers.findIndex(l => l.id === st.sel); if (i < 0) return null; const ls = st.layers.slice(); ls.push(ls.splice(i, 1)[0]); return { layers: ls }; })} style={{ ...btnSt, fontSize: 11.5 }}>置顶</button>
            <button onClick={() => moveL(1)} style={{ ...btnSt, fontSize: 11.5 }}>上移</button>
            <button onClick={() => moveL(-1)} style={{ ...btnSt, fontSize: 11.5 }}>下移</button>
            <button onClick={() => store.set(st => { const i = st.layers.findIndex(l => l.id === st.sel); if (i < 0) return null; const ls = st.layers.slice(); ls.unshift(ls.splice(i, 1)[0]); return { layers: ls }; })} style={{ ...btnSt, fontSize: 11.5 }}>置底</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
            <button onClick={dupLayer} style={{ ...btnSt, padding: '7px 0' }}>复制 ⌘D</button>
            <button onClick={() => upd({ locked: !sel.locked })} style={{ ...btnSt, padding: '7px 0', background: sel.locked ? '#211d18' : '#fff', color: sel.locked ? '#fff' : '#3d3830' }}>{sel.locked ? '已锁定' : '锁定'}</button>
            <button onClick={() => store.set(st => ({ layers: st.layers.filter(x => x.id !== st.sel), sel: null }))} style={{ ...btnSt, padding: '7px 0', border: '1px solid #e0b7a8', color: '#c0492b' }}>删除 ⌫</button>
          </div>
          <div style={{ marginTop: 10, fontSize: 10.5, lineHeight: 1.6, color: '#a59a85' }}>方向键微移 1mm（Shift=5mm）· 拖动时自动吸附容器边/中线 · 缩放默认等比（Shift 自由）· 旋转 Shift 吸附 15° · ⌘Z 撤销 / ⌘⇧Z 重做</div>
        </Block>
        {selWarns.length > 0 && (
          <div style={{ padding: 14 }}>
            <ST style={{ color: '#c0492b' }}>警示</ST>
            {selWarns.map(wn => (
              <div key={wn} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '4px 0', fontSize: 12, color: '#3d3830', lineHeight: 1.5 }}>
                <span style={{ width: 7, height: 7, borderRadius: 99, background: '#d05a2a', flex: 'none', transform: 'translateY(-1px)' }} />{wn}
              </div>
            ))}
          </div>
        )}
      </>)}
    </div>
  </>);
}
