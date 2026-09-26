import React, { useEffect, useRef, useState } from 'react';
import { store } from '../state/store.js';
import { BoxPreview, boxPreviewPropsOf } from '../render3d/BoxPreview.jsx';
import { MATS, templateNameOf } from '../dieline/templates.js';
import { makeProject, projectStateOf } from '../projects/projects.js';
import { materialToStorePatch } from '../render3d/materialPresets.js';
import { SCENE_PRESETS, scenePreset, rigToStorePatch } from '../render3d/rig.js';
import { STAGES } from '../render3d/stage.js';
import { PAPER_PRESETS, FILM_PRESETS, paperPreset, filmPreset } from '../render3d/presets.js';
import { captureRenderPng, pngDimensions, waitForRender } from './renderImage.js';
import { RenderSceneController } from './renderScene.js';
import { PlanLibrary } from './PlanLibrary.jsx';
import { listViews, saveView, deleteView } from './savedPlans.js';
import './render.css';

const RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16'];
const MODES = [['rotate', '旋转视角'], ['pan', '平移视角']];

function TransformNumber({ label, value, onCommit, min }) {
  const [draft, setDraft] = useState(null);
  const commit = () => { const n = Number(draft); if (draft !== null && draft.trim() && Number.isFinite(n) && (min == null || n >= min)) onCommit(n); setDraft(null); };
  return <input aria-label={label} type="number" step="0.1" min={min} value={draft ?? +value.toFixed(2)} onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') setDraft(null); }} />;
}

export function RenderPage({ s, m, onBack, onOpenLibrary, apiRef, initialScene }) {
  const engineRef = useRef(null), stageRef = useRef(null), alive = useRef(true);
  const controllerRef = useRef(null), selectedRef = useRef(null);
  const [sourceProject] = useState(() => { const project = makeProject(s, { name: templateNameOf(s) }); project.scene.fold = s.fold; return { current: project }; });
  const [ratio, setRatio] = useState(RATIOS.includes(initialScene?.settings?.ratio) ? initialScene.settings.ratio : '1:1');
  const [resolution, setResolution] = useState(initialScene?.settings?.resolution === 2048 ? 2048 : 1024);
  const [background, setBackground] = useState(['scene', 'color', 'transparent'].includes(initialScene?.settings?.background) ? initialScene.settings.background : 'scene');
  const [mode, setMode] = useState('rotate'), [busy, setBusy] = useState(false), [error, setError] = useState(''), [lastPng, setLastPng] = useState(null);
  const [models, setModels] = useState([]), [selectedId, setSelectedId] = useState(null), [sceneReady, setSceneReady] = useState(false);
  const [transformMode, setTransformMode] = useState('translate'), [replacing, setReplacing] = useState(false), [views, setViews] = useState([]), [notice, setNotice] = useState('');
  const [assetPanel, setAssetPanel] = useState('scene'), [propertyTab, setPropertyTab] = useState('scene'), [sceneSearch, setSceneSearch] = useState('');
  const selected = models.find(model => model.id === selectedId);
  const [frameSize, setFrameSize] = useState({ width: 1, height: 1 });
  const dimensions = pngDimensions(ratio, resolution);
  const previewState = background === 'scene' ? s : { ...s, showEnvironmentBackground: false, backgroundMode3d: 'color', backgroundColor3d: background === 'transparent' ? '#ffffff' : s.backgroundColor3d, stage3d: background === 'transparent' ? 'none' : s.stage3d };
  const sync = () => {
    const controller = controllerRef.current; if (!controller || !alive.current) return;
    const entries = controller.list(); setModels(entries); setSelectedId(controller.selectedId);
    if (selectedRef.current !== controller.selectedId) {
      selectedRef.current = controller.selectedId;
      if (controller.selectedId) setPropertyTab('model');
      const appearance = entries.find(model => model.id === controller.selectedId)?.project.appearance;
      if (appearance) store.set({ ...materialToStorePatch(appearance.material), fx: appearance.fx, embDir: appearance.embDir });
    }
  };
  useEffect(() => {
    alive.current = true;
    const engine = engineRef.current;
    (async () => {
      try {
        await waitForRender(engine); if (!alive.current) return;
        const resolveProject = async project => {
          const patch = await projectStateOf(project);
          const fold = Number.isFinite(project.scene?.fold) ? Math.max(0, Math.min(100, project.scene.fold)) : 100;
          const state = { ...store.get(), ...patch, fold };
          if (state.layers.some(layer => layer.kind === 'image' && layer.imgSrc && !layer.img)) throw new Error('方案图片加载失败，请重新导入图片后保存。');
          return boxPreviewPropsOf(state, MATS.find(mat => mat.id === state.matId) || MATS[0]);
        };
        const controller = new RenderSceneController(engine, { project: sourceProject.current, resolveProject, onChange: sync });
        controllerRef.current = controller;
        if (initialScene?.models) {
          await controller.restore(initialScene);
          if (initialScene.sourceDesign && JSON.stringify(initialScene.sourceDesign) !== JSON.stringify({ box: sourceProject.current.box, design: sourceProject.current.design })) {
            controller.select(controller.mainId || controller.selectedId);
            const target = controller.selected();
            if (target) await controller.updateProject({ ...target.project, box: sourceProject.current.box, design: sourceProject.current.design });
          }
        }
        if (!alive.current) return;
        sync(); setSceneReady(true);
        setViews(await listViews());
      } catch (e) { if (alive.current) setError(e.message || String(e)); }
    })();
    return () => { alive.current = false; if (apiRef) apiRef.current = null; controllerRef.current?.dispose(); controllerRef.current = null; };
  }, []);
  const snapshot = () => ({ ...controllerRef.current.snapshot(), settings: { ratio, resolution, background }, sourceDesign: { box: sourceProject.current.box, design: sourceProject.current.design } });
  const capture = async () => {
    if (!controllerRef.current || !sceneReady || busy) throw new Error('3D 正在处理，请稍后保存。');
    await waitForRender(engineRef.current); await controllerRef.current.whenReady();
    if (!alive.current) throw new Error('渲染页面已关闭。');
    const size = pngDimensions(ratio, 1024), factor = 480 / Math.max(size.width, size.height);
    const thumbnail = captureRenderPng(engineRef.current, { width: Math.round(size.width * factor), height: Math.round(size.height * factor), transparent: background === 'transparent' });
    return { thumbnail, renderScene: snapshot() };
  };
  useEffect(() => { if (apiRef && sceneReady) apiRef.current = { snapshot, capture }; });
  const run = async action => {
    if (busy || !sceneReady) return;
    setBusy(true); setError('');
    try { await action(controllerRef.current); if (alive.current) sync(); }
    catch (e) { if (alive.current) setError(e.message || String(e)); }
    finally { if (alive.current) setBusy(false); }
  };
  const changeMaterial = patch => {
    store.set(patch);
    try { controllerRef.current?.updateAppearance(makeProject(store.get()).appearance); }
    catch (e) { setError(e.message || String(e)); }
  };
  const saveCurrentView = () => run(async controller => {
    await waitForRender(engineRef.current); await controller.whenReady();
    const size = pngDimensions(ratio, 1024), factor = 240 / Math.max(size.width, size.height);
    await saveView({ name: '视角 ' + (views.length + 1), camera: controller.captureCamera(), thumbnail: captureRenderPng(engineRef.current, { width: Math.round(size.width * factor), height: Math.round(size.height * factor) }) });
    setViews(await listViews()); setNotice('当前视角已自动保存');
  });
  const restoreView = view => run(controller => {
    controller.applyCamera(view.camera);
    store.set({ cameraProjection3d: engineRef.current.camera.isOrthographicCamera ? 'orthographic' : 'perspective', fov3d: engineRef.current.camera.fov || store.get().fov3d });
    setNotice('已恢复 · ' + view.name);
  });
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
      await controllerRef.current.whenReady();
      if (!alive.current || engineRef.current !== engine) return;
      const png = captureRenderPng(engine, { ...dimensions, transparent: background === 'transparent' });
      const name = (s.custom?.name || '盒型').replace(/[\\/:*?"<>|]/g, '_') + `_${dimensions.width}x${dimensions.height}.png`;
      const a = document.createElement('a'); a.href = png; a.download = name; a.click();
      setLastPng({ png, name, ...dimensions });
      setAssetPanel('mine');
    } catch (e) { if (alive.current) setError(e.message || '渲染失败，请重试。'); }
    finally { if (alive.current) setBusy(false); }
  };
  return <div className="workflow-render" aria-busy={busy}>
    <nav className="workflow-render-rail" aria-label="渲染资源分类">
      {[['scene', '场景', 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z'], ['material', '材质', 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 3v18 M5 6l14 12 M3 12h18'], ['mine', '我的', 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 21v-2a8 8 0 0 1 16 0v2']].map(([id, label, path]) => <button key={id} aria-pressed={assetPanel === id} onClick={() => setAssetPanel(id)}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"><path d={path} /></svg><span>{label}</span></button>)}
      <button className="workflow-render-back" disabled={busy} onClick={onBack}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m10 5-7 7 7 7 M3 12h18" /></svg><span>返回设计</span></button>
    </nav>
    <fieldset className="workflow-render-sidebar workflow-render-assets" disabled={busy}>
      <div className="workflow-render-heading"><strong>{assetPanel === 'scene' ? '场景库' : assetPanel === 'material' ? '材质库' : '我的资源'}</strong><span>{assetPanel === 'scene' ? 'SCENE' : assetPanel === 'material' ? 'MATERIAL' : 'MY LIBRARY'}</span></div>
      <section hidden={assetPanel !== 'scene'}>
        <label className="workflow-render-search"><input type="search" aria-label="搜索场景" placeholder="搜索影棚场景" value={sceneSearch} onChange={e => setSceneSearch(e.target.value)} /><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></svg></label>
        <h3>影棚场景 <span>{SCENE_PRESETS.length} 个预设</span></h3>
        <div className="workflow-render-scenes">
          {SCENE_PRESETS.filter(p => p.name.includes(sceneSearch.trim())).map(p => <button key={p.id} type="button" aria-pressed={s.studio3d === p.id} onClick={() => { store.set(rigToStorePatch(scenePreset(p.id))); setBackground('scene'); }}>
            <span className="workflow-render-swatch" style={{ background: `linear-gradient(150deg, ${p.environment.backgroundColor}, ${p.environment.dome?.colors?.[1] || '#c6c7c8'})` }}><svg aria-hidden="true" viewBox="0 0 120 100"><ellipse cx="65" cy="83" rx="34" ry="6" fill="#0002" /><path d="m34 29 29-12 27 14-29 13Z" fill="#fff" /><path d="m34 29 27 15v39L34 68Z" fill="#e2e4e6" /><path d="m61 44 29-13v39L61 83Z" fill="#b7bdc4" /></svg></span><span>{p.name}</span>
          </button>)}
        </div>
        {!SCENE_PRESETS.some(p => p.name.includes(sceneSearch.trim())) && <p role="status">没有匹配的场景。</p>}
      </section>
      <section hidden={assetPanel !== 'material'}><h3>纸张与覆膜</h3><p>{selected ? '当前模型 · ' + selected.project.meta.name : '点击画面中的模型后调整材质。'}</p>
        <label>纸张<select disabled={!selected || selected.locked} value={s.paper3d} onChange={e => { const p = paperPreset(e.target.value); changeMaterial({ paper3d: p.id, surfaceRoughness: p.roughness, grainStrength: p.grainStrength, grainScale: p.grainMm }); }}>{PAPER_PRESETS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>覆膜<select disabled={!selected || selected.locked} value={s.film3d} onChange={e => { const f = filmPreset(e.target.value); changeMaterial({ film3d: f.id, filmClearcoat3d: f.clearcoat, filmClearcoatRoughness3d: f.clearcoatRoughness, filmRoughnessFactor3d: f.roughnessFactor, filmSheen3d: f.sheen }); }}>{FILM_PRESETS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>表面粗糙度 <output>{Math.round(s.surfaceRoughness * 100)}%</output><input disabled={!selected || selected.locked} aria-label="渲染表面粗糙度" type="range" min="0" max="1" step="0.01" value={s.surfaceRoughness} onChange={e => changeMaterial({ surfaceRoughness: +e.target.value })} /></label>
      </section>
      <div hidden={assetPanel !== 'mine'}>
        <section><h3>我的方案</h3><div className="workflow-plan-links"><button onClick={() => onOpenLibrary('design')}>平面设计方案</button><button onClick={() => onOpenLibrary('render')}>渲染设计方案</button></div></section>
        <section><h3>我的视角</h3><button disabled={busy || !sceneReady} onClick={saveCurrentView}>＋ 保存当前视角</button><div className="workflow-saved-views">{views.map(view => <div key={view.id}><button aria-label={view.name} disabled={busy} onClick={() => restoreView(view)}><img src={view.thumbnail} alt={view.name} /><span>{view.name}</span></button><button className="workflow-view-delete" aria-label={'删除' + view.name} disabled={busy} onClick={() => run(async () => { await deleteView(view.id); setViews(await listViews()); })}>×</button></div>)}</div></section>
        <section><h3>本次渲染</h3>{lastPng ? <a className="workflow-render-result" href={lastPng.png} download={lastPng.name}><img src={lastPng.png} alt="最近生成的渲染图" /><span>再次下载 · {lastPng.width} × {lastPng.height}</span></a> : <p>点击「立即渲染」生成并下载 PNG。</p>}</section>
      </div>
    </fieldset>
    <main className="workflow-render-center">
      <div className="workflow-render-toolbar"><span>{s.custom?.name || templateNameOf(s)}</span><div role="group" aria-label="视角操作">{MODES.map(([id, name]) => <button key={id} disabled={busy} aria-pressed={mode === id} onClick={() => { engineRef.current?.setMode(id); setMode(id); }}>{name}</button>)}</div></div>
      <div ref={stageRef} className="workflow-render-stage">
        {selected && <div className="workflow-model-actions" role="toolbar" aria-label="选中模型操作">
          <button disabled={busy || selected.locked} onClick={() => run(c => c.setMain(!selected.main))}>{selected.main ? '取消主模' : '设为主模'}</button>
          {['translate', 'rotate', 'scale'].map((id, i) => <button key={id} disabled={busy || selected.locked || selected.hidden} aria-pressed={transformMode === id} onClick={() => { controllerRef.current.setTransformMode(id); setTransformMode(id); }}>{['移动', '旋转', '缩放'][i]}</button>)}
          <button disabled={busy || selected.locked} onClick={() => setReplacing(true)}>替换</button><button disabled={busy} onClick={() => run(c => c.duplicate())}>复制</button>
          <button disabled={busy} onClick={() => run(c => c.setLocked(!selected.locked))}>{selected.locked ? '解锁' : '锁定'}</button><button disabled={busy} onClick={() => run(c => c.setHidden(!selected.hidden))}>{selected.hidden ? '显示' : '隐藏'}</button>
          <button disabled={busy || selected.locked} onClick={() => run(c => c.drop())}>下落吸附</button><button disabled={busy || selected.locked} onClick={() => run(c => c.remove())}>删除</button>
        </div>}
        <div className="workflow-render-preview" style={frameSize}><BoxPreview s={previewState} m={m} engineRef={engineRef} />{busy && <div className="workflow-render-busy" role="status">正在处理模型与贴图…</div>}</div>
      </div>
      <div className="workflow-render-bottom">
        <div className="workflow-render-viewbar"><span role="status">{notice || `${dimensions.width} × ${dimensions.height} px${background === 'transparent' ? ' · 透明 PNG，白底预览' : ' · 实时预览'}`}</span><div role="group" aria-label="快捷视角">{[['front', '正视'], ['side', '侧视'], ['top', '顶视'], ['iso', '等轴']].map(([id, name]) => <button key={id} disabled={busy} onClick={() => engineRef.current?.setView(id)}>{name}</button>)}<button disabled={busy} onClick={() => controllerRef.current?.frame()}>适配</button></div></div>
        <div className="workflow-render-outputbar"><label>构图比例<select aria-label="构图比例" disabled={busy} value={ratio} onChange={e => setRatio(e.target.value)}>{RATIOS.map(r => <option key={r}>{r}</option>)}</select></label><div className="workflow-render-submit"><button className="workflow-render-primary" disabled={!sceneReady || busy} title="渲染并下载 PNG" onClick={download}>{busy ? '正在渲染…' : '立即渲染'}</button><select aria-label="渲染分辨率" disabled={busy} value={resolution} onChange={e => setResolution(+e.target.value)}><option value={1024}>1K</option><option value={2048}>2K</option></select></div></div>
        {error && <p className="workflow-render-error" role="alert">{error}</p>}
      </div>
    </main>
    <aside className="workflow-render-sidebar workflow-render-settings">
      <div className="workflow-render-tabs" role="group" aria-label="渲染属性分类">{[['scene', '场景'], ['model', '模型'], ['light', '光影']].map(([id, name]) => <button key={id} aria-pressed={propertyTab === id} onClick={() => setPropertyTab(id)}>{name}</button>)}</div>
      <fieldset className="workflow-render-properties" disabled={busy}>
        <section hidden={propertyTab !== 'scene'}><h3>场景属性</h3>
          <label>背景<select value={background} onChange={e => setBackground(e.target.value)}><option value="scene">场景背景</option><option value="color">纯色背景</option><option value="transparent">透明 PNG</option></select></label>
          {background === 'color' && <label className="workflow-render-color">背景颜色<input type="color" aria-label="渲染背景颜色" value={s.backgroundColor3d} onChange={e => store.set({ backgroundColor3d: e.target.value })} /></label>}
          <label>地面<select disabled={busy || background === 'transparent'} value={background === 'transparent' ? 'none' : s.stage3d} onChange={e => store.set({ stage3d: e.target.value })}>{STAGES.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label>镜头<select value={s.cameraProjection3d} onChange={e => store.set({ cameraProjection3d: e.target.value })}><option value="perspective">透视镜头</option><option value="orthographic">正交镜头</option></select></label>
        </section>
        <section hidden={propertyTab !== 'model'} className="workflow-scene-models"><h3>场景模型 · {models.length}</h3>{models.map(model => <button key={model.id} disabled={busy} aria-pressed={model.id === selectedId} onClick={() => controllerRef.current?.select(model.id)}>{model.main && <span>★ </span>}{model.project.meta.name}{model.locked && ' · 已锁定'}{model.hidden && ' · 已隐藏'}</button>)}{!models.length && <button disabled={!sceneReady || busy} onClick={() => setReplacing(true)}>添加已保存设计</button>}
          {selected ? <fieldset disabled={busy || selected.locked} className="workflow-model-values"><legend>模型位置与尺寸</legend><div className="workflow-model-axes"><span />{['X', 'Y', 'Z'].map(axis => <span key={axis}>{axis}</span>)}</div>{[['position', '位置 mm'], ['rotation', '旋转 °'], ['scale', '缩放']].map(([key, label]) => <div key={key}><span>{label}</span>{['X', 'Y', 'Z'].map((axis, i) => <TransformNumber key={axis} label={`模型${label} ${axis}`} min={key === 'scale' ? 0.01 : undefined} value={selected.transform[key][i] * (key === 'rotation' ? 180 / Math.PI : 1)} onCommit={value => run(c => { const vector = [...selected.transform[key]]; vector[i] = value * (key === 'rotation' ? Math.PI / 180 : 1); c.setTransform({ [key]: vector }); })} />)}</div>)}</fieldset> : models.length > 0 && <p>选择模型后调整位置、旋转和缩放。</p>}
        </section>
        <section hidden={propertyTab !== 'light'}><h3>光影属性</h3><p>当前影棚 · {scenePreset(s.studio3d).name}</p>
          <label>总亮度 <output>{Number(s.expo3d).toFixed(2)}</output><input aria-label="渲染亮度" type="range" min="0.3" max="2" step="0.01" value={s.expo3d} onChange={e => store.set({ expo3d: +e.target.value })} /></label>
          <label>阴影浓度 <output>{Math.round(s.shadowOpacity3d * 100)}%</output><input aria-label="渲染阴影浓度" type="range" min="0" max="0.6" step="0.01" value={s.shadowOpacity3d} onChange={e => store.set({ shadowOpacity3d: +e.target.value })} /></label>
        </section>
      </fieldset>
    </aside>
    {replacing && <PlanLibrary kind="design" title={models.length ? '替换为已保存的平面设计' : '添加已保存的平面设计'} onClose={() => setReplacing(false)} onChoose={async plan => { await controllerRef.current.replace(plan.project); selectedRef.current = null; sync(); setReplacing(false); }} />}
  </div>;
}
