import React, { useEffect, useRef, useState } from 'react';
import { store } from '../state/store.js';
import { BoxPreview } from '../render3d/BoxPreview.jsx';
import { SCENE_PRESETS, scenePreset, rigToStorePatch } from '../render3d/rig.js';
import { STAGES } from '../render3d/stage.js';
import { PAPER_PRESETS, FILM_PRESETS, paperPreset, filmPreset } from '../render3d/presets.js';
import { captureRenderPng, pngDimensions, waitForRender } from './renderImage.js';
import './render.css';

const RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16'];
const MODES = [['rotate', '旋转视角'], ['pan', '平移视角'], ['move', '移动盒子'], ['turn', '旋转盒子']];

export function RenderPage({ s, m, onBack }) {
  const engineRef = useRef(null), stageRef = useRef(null), alive = useRef(true);
  const [ratio, setRatio] = useState('1:1'), [resolution, setResolution] = useState(1024), [background, setBackground] = useState('scene');
  const [mode, setMode] = useState('rotate'), [busy, setBusy] = useState(false), [error, setError] = useState(''), [lastPng, setLastPng] = useState(null);
  const [frameSize, setFrameSize] = useState({ width: 1, height: 1 });
  const dimensions = pngDimensions(ratio, resolution);
  const previewState = background === 'scene' ? s : { ...s, showEnvironmentBackground: false, backgroundMode3d: 'color', backgroundColor3d: background === 'transparent' ? '#ffffff' : s.backgroundColor3d, stage3d: background === 'transparent' ? 'none' : s.stage3d };
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const node = stageRef.current, aspect = dimensions.width / dimensions.height;
    const fit = () => { const w = Math.max(1, node.clientWidth - 40), h = Math.max(1, node.clientHeight - 40), width = Math.min(w, h * aspect); setFrameSize({ width, height: width / aspect }); };
    fit(); const observer = new ResizeObserver(fit); observer.observe(node); return () => observer.disconnect();
  }, [ratio, dimensions.width, dimensions.height]);
  const download = async () => {
    if (busy) return;
    setBusy(true); setError('');
    const engine = engineRef.current;
    try {
      await waitForRender(engine);
      if (!alive.current || engineRef.current !== engine) return;
      const png = captureRenderPng(engine, { ...dimensions, transparent: background === 'transparent' });
      const name = (s.custom?.name || '盒型').replace(/[\\/:*?"<>|]/g, '_') + `_${dimensions.width}x${dimensions.height}.png`;
      const a = document.createElement('a'); a.href = png; a.download = name; a.click();
      setLastPng({ png, name, ...dimensions });
    } catch (e) { if (alive.current) setError(e.message || '渲染失败，请重试。'); }
    finally { if (alive.current) setBusy(false); }
  };
  return <div className="workflow-render" aria-busy={busy}>
    <fieldset className="workflow-render-sidebar" disabled={busy}>
      <div className="workflow-render-heading"><strong>影棚与材质</strong><span>SCENE</span></div>
      <section><h3>影棚场景</h3><div className="workflow-render-scenes">
        {SCENE_PRESETS.map(p => <button key={p.id} type="button" className={s.studio3d === p.id ? 'selected' : ''} aria-pressed={s.studio3d === p.id} onClick={() => { store.set(rigToStorePatch(scenePreset(p.id))); setBackground('scene'); }}>
          <span className="workflow-render-swatch" style={{ background: `linear-gradient(145deg, ${(p.environment.dome?.bg || [p.environment.backgroundColor, '#6b6b73']).join(',')})` }}><span>◇</span></span>{p.name}
        </button>)}
      </div></section>
      <section><h3>纸张与覆膜</h3>
        <label>纸张<select value={s.paper3d} onChange={e => { const p = paperPreset(e.target.value); store.set({ paper3d: p.id, surfaceRoughness: p.roughness, grainStrength: p.grainStrength, grainScale: p.grainMm }); }}>{PAPER_PRESETS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>覆膜<select value={s.film3d} onChange={e => { const f = filmPreset(e.target.value); store.set({ film3d: f.id, filmClearcoat3d: f.clearcoat, filmClearcoatRoughness3d: f.clearcoatRoughness, filmRoughnessFactor3d: f.roughnessFactor, filmSheen3d: f.sheen }); }}>{FILM_PRESETS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>表面粗糙度 <output>{Math.round(s.surfaceRoughness * 100)}%</output><input aria-label="渲染表面粗糙度" type="range" min="0" max="1" step="0.01" value={s.surfaceRoughness} onChange={e => store.set({ surfaceRoughness: +e.target.value })} /></label>
      </section>
    </fieldset>
    <main className="workflow-render-center">
      <div className="workflow-render-toolbar"><button disabled={busy} onClick={onBack}>← 返回设计</button><div role="group" aria-label="模型操作">{MODES.map(([id, name]) => <button key={id} disabled={busy} aria-pressed={mode === id} className={mode === id ? 'selected' : ''} onClick={() => { engineRef.current?.setMode(id); setMode(id); }}>{name}</button>)}</div></div>
      <div ref={stageRef} className="workflow-render-stage">
        <div className="workflow-render-preview" style={frameSize}><BoxPreview s={previewState} m={m} engineRef={engineRef} />{busy && <div className="workflow-render-busy" role="status">正在准备贴图并渲染 PNG…</div>}</div>
      </div>
      <div className="workflow-render-bottom"><span>{dimensions.width} × {dimensions.height} px{background === 'transparent' ? ' · 透明 PNG，白底预览' : ' · 实时预览'}</span><div role="group" aria-label="快捷视角">{[['front', '正视'], ['side', '侧视'], ['top', '顶视'], ['iso', '等轴']].map(([id, name]) => <button key={id} disabled={busy} onClick={() => engineRef.current?.setView(id)}>{name}</button>)}<button disabled={busy} onClick={() => engineRef.current?.frame()}>适配</button></div></div>
    </main>
    <fieldset className="workflow-render-sidebar workflow-render-settings" disabled={busy}>
      <div className="workflow-render-heading"><strong>渲染设置</strong><span>OUTPUT</span></div>
      <section><h3>画面</h3>
        <label>宽高比例<select value={ratio} onChange={e => setRatio(e.target.value)}>{RATIOS.map(r => <option key={r}>{r}</option>)}</select></label>
        <label>分辨率<select value={resolution} onChange={e => setResolution(+e.target.value)}><option value={1024}>1024 px · 标准</option><option value={2048}>2048 px · 高清</option></select></label>
        <p>分辨率为画面最长边，导出保持当前构图。</p>
        <label>镜头<select value={s.cameraProjection3d} onChange={e => store.set({ cameraProjection3d: e.target.value })}><option value="perspective">透视镜头</option><option value="orthographic">正交镜头</option></select></label>
      </section>
      <section><h3>背景与光照</h3>
        <label>背景<select value={background} onChange={e => setBackground(e.target.value)}><option value="scene">场景背景</option><option value="color">纯色背景</option><option value="transparent">透明 PNG</option></select></label>
        {background === 'color' && <label className="workflow-render-color">背景颜色<input type="color" aria-label="渲染背景颜色" value={s.backgroundColor3d} onChange={e => store.set({ backgroundColor3d: e.target.value })} /></label>}
        <label>地面<select disabled={busy || background === 'transparent'} value={background === 'transparent' ? 'none' : s.stage3d} onChange={e => store.set({ stage3d: e.target.value })}>{STAGES.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>亮度 <output>{Number(s.expo3d).toFixed(2)}</output><input aria-label="渲染亮度" type="range" min="0.3" max="2" step="0.01" value={s.expo3d} onChange={e => store.set({ expo3d: +e.target.value })} /></label>
        <label>阴影浓度 <output>{Math.round(s.shadowOpacity3d * 100)}%</output><input aria-label="渲染阴影浓度" type="range" min="0" max="0.6" step="0.01" value={s.shadowOpacity3d} onChange={e => store.set({ shadowOpacity3d: +e.target.value })} /></label>
      </section>
      <section className="workflow-render-export"><button className="workflow-render-primary" onClick={download}>{busy ? '正在渲染…' : '渲染并下载 PNG'}</button><p>使用当前模型、设计和材质生成图片。</p>
        {error && <p className="workflow-render-error" role="alert">{error}</p>}
        {lastPng && <a className="workflow-render-result" href={lastPng.png} download={lastPng.name}><img src={lastPng.png} alt="最近生成的渲染图" /><span>再次下载 · {lastPng.width} × {lastPng.height}</span></a>}
      </section>
    </fieldset>
  </div>;
}
