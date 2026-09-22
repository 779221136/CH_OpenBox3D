// 3D 视图：折叠控制 / 基材覆膜 / 工艺样例 / 压纹参数 + PBR 参数与通道说明
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { store, useStore } from '../state/store.js';
import { templateNameOf } from '../dieline/templates.js';
import { CustomFoldControls } from './DxfImport.jsx';
import { embDirOf } from '../design/emboss.js';
import { BoxPreview, boxPreviewContextOf } from '../render3d/BoxPreview.jsx';
import { STAGES } from '../render3d/stage.js';
import { PAPER_PRESETS, FILM_PRESETS, paperPreset, filmPreset } from '../render3d/presets.js';
import { SCENE_PRESETS, scenePreset, rigToStorePatch } from '../render3d/rig.js';
import { ST, Block, Toggle, ToggleRow, Note, selectSt, btnSt, inputSt, captureThumb, Range, ColorRow } from './widgets.jsx';

export function ThreeView() {
  const s = useStore();
  const m = store.mat();
  const t = m.t;
  const pf = useRef(null);
  const engRef = useRef(null);
  const [foldPlaying, setFoldPlaying] = useState(false);
  const tplName = templateNameOf(s);
  const finCount = f => s.layers.filter(l => l.finish === f).length;
  const embCount = dir => s.layers.filter(l => l.finish === 'emboss' && embDirOf(l, s.embDir) === dir).length;
  const finSummary = '工艺图层：烫金×' + (finCount('foil') + finCount('silver')) + ' · UV×' + finCount('uv') + ' · 亮面×' + finCount('gloss') + ' · 镭射×' + finCount('holo') + ' · 凸×' + embCount('up') + ' · 凹×' + embCount('down') + '（来自设计页）';
  // 烘焙输入：整版包围盒 + 全部图层（图集覆盖所有面板，图层放在哪 3D 就显示在哪）
  const preview = boxPreviewContextOf(s, m);
  const coverKey = JSON.stringify({
    scene: [s.environment3d, s.stage3d, s.expo3d, s.lightsSpec3d, s.backgroundMode3d, s.backgroundColor3d],
    material: [s.paper3d, s.film3d, s.surfaceRoughness, s.grainStrength, s.grainScale, s.foilColor3d, s.silverColor3d, s.iridescence3d, s.holoSpan3d, s.holoRainbow3d, s.glossRoughness3d],
    camera: [s.cameraProjection3d, s.fov3d]
  });
  const clearFold = () => { clearInterval(pf.current); pf.current = null; };
  const stopFold = () => { clearFold(); setFoldPlaying(false); };
  const playFold = () => {
    clearFold(); setFoldPlaying(true); store.set({ fold: 0 });
    let v = 0;
    pf.current = setInterval(() => { v += 1.4; if (v >= 100) { v = 100; stopFold(); } store.set({ fold: v }); }, 28);
  };
  useLayoutEffect(() => { if (!s.foldFromQuery) playFold(); return clearFold; }, []);
  // 正式 3D 闭合态作为工程封面：复用当前 renderer，不创建隐藏的第二套 3D 场景
  useEffect(() => {
    if (s.fold < 99.5 || s.check !== 'art') return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const eng = engRef.current;
      if (!eng || !eng.ready || eng._disposed) return;
      if (eng.studio && eng.studio.environmentReady) await eng.studio.environmentReady;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (cancelled) return;
      const thumbnail = captureThumb(engRef, 420);
      if (thumbnail && thumbnail !== store.get().projectThumbnail) store.set({ projectThumbnail: thumbnail });
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [s.fold, s.check, preview.bakeKey, coverKey]);
  // 调试句柄：CDP 回归直查正式 3D 引擎（helper 不可见/转盒回正断言用）
  useEffect(() => { window.__threeEngine = engRef.current; return () => { if (window.__threeEngine === engRef.current) window.__threeEngine = null; }; }, []);
  const applyScenePreset = id => { store.set(rigToStorePatch(scenePreset(id))); };

  return (<>
    <div style={{ width: 246, flex: 'none', background: '#faf7f0', borderRight: '1px solid #ded5c4', overflowY: 'auto' }}>
      <Block>
        <ST>当前盒型</ST>
        <div style={{ background: '#f0ebe0', border: '1px solid #e2dac9', borderRadius: 6, padding: '9px 11px', fontSize: 11.5, lineHeight: 1.6, color: '#3d3830', fontFamily: "'JetBrains Mono',monospace" }}>
          {tplName} · {m.name} t={t}<br />{s.tpl === 'custom' ? 'DXF 毫米刀模' : `内尺寸 ${s.L} × ${s.W} × ${s.H}`}
        </div>
        <div style={{ fontSize: 10.5, color: '#8a8071', marginTop: 6 }}>尺寸与纸厚沿用「结构」页设置</div>
        <div style={{ fontSize: 10.5, color: '#9a5b1f', marginTop: 4 }}>{finSummary}</div>
      </Block>
      <Block>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <ST style={{ marginBottom: 0 }}>折叠进度</ST>
          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11.5, color: '#9a5b1f' }}>{Math.round(s.fold)}%</div>
        </div>
        <input type="range" min="0" max="100" value={s.fold} onPointerDown={stopFold} onKeyDown={stopFold} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) { stopFold(); store.set({ fold: v }); } }} style={{ width: '100%', accentColor: '#9a5b1f', margin: '0 0 10px' }} />
        <div style={{ display: 'flex', gap: 7 }}>
          <button onClick={playFold} style={{ ...btnSt, flex: 1, padding: '7px 0', border: 'none', fontWeight: 700, background: '#9a5b1f', color: '#fff' }}>▶ 播放折叠</button>
          <button onClick={() => { stopFold(); store.set({ fold: 0 }); }} style={{ ...btnSt, flex: 1, padding: '7px 0', color: '#5c554a' }}>展开</button>
        </div>
      </Block>
      {s.tpl === 'custom' && <Block><ST>自定义折叠</ST><CustomFoldControls custom={s.custom} /></Block>}
      <Block>
        <ST>纸张 / 覆膜</ST>
        <div style={{ fontSize: 10.5, color: '#8a8071', marginBottom: 3 }}>纸张</div>
        <select aria-label="纸张" value={s.paper3d} onChange={e => { const p = paperPreset(e.target.value); store.set({ paper3d: p.id, surfaceRoughness: p.roughness, grainStrength: p.grainStrength, grainScale: p.grainMm }); }} style={{ ...selectSt, marginBottom: 8 }}>
          {PAPER_PRESETS.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <div style={{ fontSize: 10.5, color: '#8a8071', marginBottom: 3 }}>覆膜</div>
        <select aria-label="覆膜" value={s.film3d} onChange={e => { const f = filmPreset(e.target.value); store.set({ film3d: f.id, filmClearcoat3d: f.clearcoat, filmClearcoatRoughness3d: f.clearcoatRoughness, filmRoughnessFactor3d: f.roughnessFactor, filmSheen3d: f.sheen }); }} style={{ ...selectSt, marginBottom: 9 }}>
          {FILM_PRESETS.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        {[["表面粗糙度", 'surfaceRoughness', 12, 100, Math.round(s.surfaceRoughness * 100)], ["纸纹强度", 'grainStrength', 0, 120, Math.round(s.grainStrength * 100)], ["颗粒尺度", 'grainScale', 3, 20, s.grainScale]].map(row => <div key={row[1]} style={{ marginTop: 7 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: '#8a8071', marginBottom: 3 }}><span>{row[0]}</span><span style={{ fontFamily: "'JetBrains Mono',monospace", color: '#9a5b1f' }}>{row[1] === 'grainScale' ? row[4] + 'mm' : row[4] + '%'}</span></div>
          <input aria-label={row[0]} type="range" min={row[2]} max={row[3]} value={row[4]} onChange={e => store.set({ [row[1]]: row[1] === 'grainScale' ? +e.target.value : +e.target.value / 100 })} style={{ width: '100%', accentColor: '#9a5b1f', margin: 0 }} />
        </div>)}
        <div style={{ fontSize: 10.5, color: '#a59a85', lineHeight: 1.55, marginTop: 8 }}>仅改变 3D 外观，不改变「结构」页纸厚与刀版补偿。</div>
      </Block>
      <Block>
        <ST style={{ marginBottom: 6 }}>工艺样例 · 检查</ST>
        {[['foil', '烫金层'], ['suv', '局部 UV 层'], ['gloss', '亮面层'], ['emb', '压纹层'], ['holo', '镭射层']].map(x => (
          <ToggleRow key={x[0]} label={x[1]} on={x[0] === 'gloss' || x[0] === 'holo' ? s.fx[x[0]] !== false : s.fx[x[0]]} onClick={() => store.set(st => ({ fx: { ...st.fx, [x[0]]: !(x[0] === 'gloss' || x[0] === 'holo' ? st.fx[x[0]] !== false : st.fx[x[0]]) } }))} />
        ))}
        <Range label="亮面粗糙度" value={s.glossRoughness3d} min={0.02} max={0.5} step={0.01} onChange={v => store.set({ glossRoughness3d: v })} />
        <div style={{ marginTop: 4, fontSize: 10, color: '#a59a85' }}>数值越低，亮面反光越集中、越清晰。</div>
        <Range label="镭射强度" value={s.iridescence3d} min={0} max={1} step={0.01} onChange={v => store.set({ iridescence3d: v })} />
        <Range label="镭射色彩跨度" value={s.holoSpan3d} min={0} max={1} step={0.01} onChange={v => store.set({ holoSpan3d: v })} />
        <Range label="镭射彩虹底纹" value={s.holoRainbow3d} min={0} max={1} step={0.01} onChange={v => store.set({ holoRainbow3d: v })} />
        <ColorRow label="镭射底色（素面=银白，改色=彩色镭射箔）" value={s.holoColor3d} onChange={v => store.set({ holoColor3d: v })} />
        <div style={{ marginTop: 4, fontSize: 10, color: '#a59a85' }}>镭射（幻彩）作用于镭射图层与箔层；随视角变化的彩虹干涉色。跨度越大色相扫掠越宽；彩虹底纹把全色谱渐变烘进纸面（素面镭射卡纸效果）。</div>
        <ToggleRow label="自动旋转" on={s.spin} onClick={() => store.set(st => ({ spin: !st.spin }))} />
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 10.5, color: '#8a8071', marginBottom: 3 }}>检查模式</div>
          <select value={s.check} onChange={e => store.set({ check: e.target.value })} style={selectSt}>
            <option value="art">彩稿（完整效果）</option>
            <option value="foil">烫金版 · R 通道</option>
            <option value="suv">局部 UV 版 · G 通道</option>
            <option value="gloss">亮面反光通道</option>
            <option value="holo">镭射版 · 幻彩通道</option>
            <option value="emb">压纹高度 · 白凸 / 黑凹</option>
            <option value="checker">UV 棋盘 · 20mm/格</option>
          </select>
        </div>
      </Block>
      <Block>
        <ST>影棚与地面</ST>
        <div style={{ fontSize: 10.5, color: '#8a8071', marginBottom: 3 }}>影棚效果</div>
        <select aria-label="影棚效果" value={s.studio3d} onChange={e => applyScenePreset(e.target.value)} style={{ ...selectSt, marginBottom: 8 }}>
          {SCENE_PRESETS.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <div style={{ fontSize: 10.5, color: '#8a8071', marginBottom: 3 }}>镜头投影</div>
        <select aria-label="镜头投影" value={s.cameraProjection3d || 'perspective'} onChange={e => store.set({ cameraProjection3d: e.target.value })} style={{ ...selectSt, marginBottom: 8 }}>
          <option value="perspective">透视镜头</option>
          <option value="orthographic">正交 · 等轴距</option>
        </select>
        <div style={{ fontSize: 10.5, color: '#8a8071', marginBottom: 3 }}>地面场景</div>
        <select value={s.stage3d} onChange={e => store.set({ stage3d: e.target.value })} style={{ ...selectSt, marginBottom: 8 }}>
          {STAGES.map(st => <option key={st.id} value={st.id}>{st.name}</option>)}
        </select>
        <div style={{ fontSize: 10.5, color: '#a59a85', lineHeight: 1.6 }}>影棚效果用于快速校样；地面场景可独立切换。技术参数仅在开发测试入口显示。</div>
      </Block>
      <Block>
        <ST>压纹参数</ST>
        <div style={{ fontSize: 10.5, color: '#8a8071', lineHeight: 1.6, marginBottom: 7 }}>下列方向仅作旧图层无 embDir 时的回退；新图层请在「设计」页单独设置。</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 9 }}>
          <button onClick={() => store.set({ embDir: 'up' })} style={{ ...btnSt, flex: 1, background: s.embDir === 'up' ? '#9a5b1f' : '#fff', color: s.embDir === 'up' ? '#fff' : '#5c554a' }}>击凸 ▲</button>
          <button onClick={() => store.set({ embDir: 'down' })} style={{ ...btnSt, flex: 1, background: s.embDir === 'down' ? '#9a5b1f' : '#fff', color: s.embDir === 'down' ? '#fff' : '#5c554a' }}>击凹 ▼</button>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 8 }}>
          <div style={{ flex: 1 }}><div style={{ fontSize: 10.5, color: '#8a8071', marginBottom: 3 }}>深度 mm</div><input type="number" step="0.05" min="0.05" max="1.5" value={s.embDepth} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) store.set({ embDepth: Math.min(1.5, Math.max(0.05, Math.round(v * 100) / 100)) }); }} style={inputSt} /></div>
          <div style={{ flex: 1.3, display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 6 }}>
            <span style={{ fontSize: 12, color: '#3d3830' }}>×3 预览增强</span>
            <Toggle on={s.embBoost} onClick={() => store.set(st => ({ embBoost: !st.embBoost }))} />
          </div>
        </div>
        <Range label="细节锐度" value={s.embSharpness3d} min={0} max={1} step={0.05} onChange={v => store.set({ embSharpness3d: v })} />
        <Range label="法线细节" value={s.embNormalStrength3d} min={0} max={3} step={0.05} onChange={v => store.set({ embNormalStrength3d: v })} />
        <Range label="几何位移" value={s.embDisplacementStrength3d} min={0} max={2} step={0.05} onChange={v => store.set({ embDisplacementStrength3d: v })} />
        <div style={{ marginTop: 9, fontSize: 10.5, lineHeight: 1.6, color: '#a59a85' }}>细密压纹建议：锐度 0.8–1、法线 1–2、位移 0–0.4；卡纸深度通常 0.15–0.4mm。生产分版保持原图，不受这些 3D 参数影响。</div>
      </Block>
      <div style={{ padding: 14 }}>
        <Note><b style={{ color: '#211d18' }}>UV 映射</b>　展开图与 3D 一比一映射；棋盘格 20mm/格，用于检查贴图密度与拉伸。工艺贴图按设计页图层位置烘焙。</Note>
      </div>
    </div>

    <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: 'radial-gradient(ellipse at 50% 38%, #efe9db 0%, #ddd4c0 65%, #cfc4ab 100%)' }}>
      <BoxPreview s={s} m={m} context={preview} fitFold={foldPlaying} engineRef={engRef} />
      <div style={{ position: 'absolute', left: 12, bottom: 12, background: 'rgba(250,247,240,0.92)', border: '1px solid #ded5c4', borderRadius: 6, padding: '6px 12px', fontSize: 11, color: '#5c554a', whiteSpace: 'nowrap' }} title="左上选择模式后左键拖拽；滚轮缩放；双击适配">滚轮缩放 · 双击适配</div>
    </div>
  </>);
}
