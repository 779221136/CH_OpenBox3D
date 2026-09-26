import React, { useEffect, useRef, useState } from 'react';
import { store, useStore } from '../state/store.js';
import { geomOf } from '../dieline/geom.js';
import { MATS, templateNameOf } from '../dieline/templates.js';
import { chooseProjectFile, downloadProject, makeProject, projectStateOf } from '../projects/projects.js';
import { exportPDF } from '../export/pdf.js';
import { BoxPreview } from '../render3d/BoxPreview.jsx';
import { DxfImport, CustomFoldControls } from '../ui/DxfImport.jsx';
import { DesignView } from '../ui/DesignView.jsx';
import { FoldCanvas } from './FoldCanvas.jsx';
import { RenderPage } from './RenderPage.jsx';
import { PlanLibrary } from './PlanLibrary.jsx';
import { savePlan } from './savedPlans.js';
import { designThumbnail } from './planThumbnail.js';
import './workflow.css';

const PAGES = ['knife', 'design', 'render'];

function FoldProgress({ s }) {
  const timer = useRef(null), [playing, setPlaying] = useState(false);
  const stop = () => { clearInterval(timer.current); timer.current = null; setPlaying(false); };
  useEffect(() => () => clearInterval(timer.current), []);
  const play = () => {
    stop(); setPlaying(true); store.set({ fold: 0 });
    const started = performance.now();
    timer.current = setInterval(() => { const value = Math.min(100, (performance.now() - started) / 30); store.set({ fold: value }); if (value === 100) stop(); }, 30);
  };
  return <div className="workflow-fold-progress">
    <button onClick={playing ? stop : play} aria-label={playing ? '停止折叠播放' : '播放折叠'}>{playing ? '暂停' : '▶'}</button>
    <button onClick={() => { stop(); store.set({ fold: 0 }); }}>展开</button>
    <input aria-label="折叠进度" type="range" min="0" max="100" value={s.fold} onChange={e => { stop(); store.set({ fold: +e.target.value }); }} />
    <button onClick={() => { stop(); store.set({ fold: 100 }); }}>闭合</button><output>{Math.round(s.fold)}%</output>
  </div>;
}

export function WorkflowApp() {
  const s = useStore(), m = store.mat();
  const [ready, setReady] = useState(false), [page, setPage] = useState('knife');
  const [selectedHingeId, setSelectedHingeId] = useState(''), [designMode, setDesignMode] = useState('2d');
  const [error, setError] = useState(''), [exporting, setExporting] = useState(false);
  const [library, setLibrary] = useState(''), [saveForm, setSaveForm] = useState(null), [saving, setSaving] = useState(false), [notice, setNotice] = useState('');
  const [planMeta, setPlanMeta] = useState({ design: null, render: null });
  const [renderDraft, setRenderDraft] = useState(null), [renderVersion, setRenderVersion] = useState(0);
  const renderApi = useRef(null), saveDialog = useRef(null), pageRef = useRef('knife');
  const controls = useRef(null), engineRef = useRef(null);
  const custom = s.tpl === 'custom' ? s.custom : null;
  const g = ready ? geomOf(s, m.t) : null;
  const go = next => {
    if (next !== 'knife' && !ready) return;
    if (pageRef.current === 'render' && next !== 'render' && renderApi.current) setRenderDraft(renderApi.current.snapshot());
    pageRef.current = next; setPage(next); location.hash = next;
    store.set({ view: next === 'design' ? 'design' : next === 'render' ? 'three' : 'structure', foldFromQuery: true });
  };
  useEffect(() => {
    const navigate = () => {
      const next = location.hash.slice(1);
      const valid = PAGES.includes(next) && (ready || next === 'knife') ? next : 'knife';
      if (pageRef.current === 'render' && valid !== 'render' && renderApi.current) setRenderDraft(renderApi.current.snapshot());
      pageRef.current = valid; setPage(valid); store.set({ view: valid === 'design' ? 'design' : valid === 'render' ? 'three' : 'structure' });
    };
    navigate(); window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, [ready]);
  const imported = () => {
    setPlanMeta({ design: null, render: null }); setRenderDraft(null); setNotice('');
    setReady(true); setSelectedHingeId(''); setError(''); pageRef.current = 'knife'; setPage('knife'); location.hash = 'knife';
    store.set({ view: 'structure', fold: 100, foldFromQuery: true });
  };
  const selectHinge = id => {
    setSelectedHingeId(id);
    const input = controls.current?.querySelector(`[data-hinge-id="${id}"] input[type="number"]`);
    if (input) { input.scrollIntoView({ block: 'nearest' }); input.focus({ preventScroll: true }); input.select(); }
  };
  const importProject = async () => {
    try {
      const doc = await chooseProjectFile(); if (!doc) return;
      const patch = await projectStateOf(doc, 'design');
      store.reset({ ...patch, fold: 100, foldFromQuery: true });
      setReady(true); setSelectedHingeId(''); setError(''); setPlanMeta({ design: null, render: null }); setRenderDraft(null); setNotice(''); pageRef.current = 'design'; setPage('design'); location.hash = 'design';
    } catch (e) { setError(e.message || String(e)); }
  };
  useEffect(() => { if (saveForm) saveDialog.current?.showModal(); }, [!!saveForm]);
  const openSave = () => {
    setError('');
    const kind = page === 'render' ? 'render' : 'design', meta = planMeta[kind];
    setSaveForm({ kind, id: meta?.id, name: meta?.name || templateNameOf(store.get()) });
  };
  const save = async (asNew = false) => {
    if (saving || !saveForm) return;
    setSaving(true); setError('');
    try {
      const state = store.get(), kind = saveForm.kind;
      const capture = kind === 'render' ? await renderApi.current?.capture() : { thumbnail: await designThumbnail(state, store.mat()) };
      if (!capture) throw new Error('3D 尚未就绪，请稍后保存。');
      const project = makeProject({ ...state, projectThumbnail: capture.thumbnail }, { name: saveForm.name });
      const plan = await savePlan({ id: asNew ? undefined : saveForm.id, kind, name: project.meta.name, thumbnail: capture.thumbnail, project, renderScene: capture.renderScene });
      setPlanMeta(prev => ({ ...prev, [kind]: { id: plan.id, name: plan.name } }));
      if (kind === 'render') setRenderDraft(capture.renderScene);
      setSaveForm(null); setNotice('已保存到' + (kind === 'render' ? '渲染设计方案' : '平面设计方案') + ' · ' + plan.name);
    } catch (e) { setError(e.message || String(e)); }
    finally { setSaving(false); }
  };
  const openPlan = async plan => {
    const patch = await projectStateOf(plan.project, plan.kind === 'render' ? 'three' : 'design');
    store.reset({ ...patch, fold: 100, foldFromQuery: true });
    setPlanMeta({ design: plan.kind === 'design' ? { id: plan.id, name: plan.name } : null, render: plan.kind === 'render' ? { id: plan.id, name: plan.name } : null });
    setRenderDraft(plan.kind === 'render' ? plan.renderScene : null); setRenderVersion(v => v + 1);
    setReady(true); setSelectedHingeId(''); setError(''); setNotice('已打开 · ' + plan.name); setLibrary('');
    const next = plan.kind === 'render' ? 'render' : 'design'; pageRef.current = next; setPage(next); location.hash = next;
  };
  const exportProject = () => { try { downloadProject(store.get(), { name: planMeta.design?.name || templateNameOf(store.get()) }); } catch (e) { setError(e.message || String(e)); } };
  const pdf = async () => {
    setExporting(true); setError('');
    try { await exportPDF(store.get(), store.mat(), s.pdfMode); } catch (e) { setError(e.message || String(e)); }
    finally { setExporting(false); }
  };
  return <div className={'workflow-app workflow-page-' + page}>
    <header className="workflow-header">
      <a className="workflow-brand" href="./index.html" target="_blank" rel="noopener noreferrer"><span>▱</span><b>OpenBox3D</b><small>包装设计</small></a>
      <nav aria-label="包装设计流程">{PAGES.map((p, i) => <button key={p} className={page === p ? 'active' : ''} aria-current={page === p ? 'step' : undefined}
        disabled={p !== 'knife' && !ready} onClick={() => go(p)}><span>{i + 1}</span>{['刀模设置', '设计与预览', '渲染输出'][i]}</button>)}</nav>
      <div className="workflow-header-actions"><button onClick={() => setLibrary('design')}>平面设计方案</button><button onClick={() => setLibrary('render')}>渲染设计方案</button><button onClick={importProject}>导入工程</button><button onClick={exportProject} disabled={!ready}>导出工程</button><button onClick={openSave} disabled={!ready || saving}>保存工程</button></div>
    </header>
    {error && <div role="alert" className="workflow-error">{error}<button aria-label="关闭错误提示" onClick={() => setError('')}>×</button></div>}
    {page === 'knife' && <main className="workflow-knife">
      <section className="workflow-model" aria-label="刀模 3D 折叠预览">
        {ready ? <><div className="workflow-model-canvas"><BoxPreview s={s} m={m} hideArtwork selectedHingeId={selectedHingeId} engineRef={engineRef} /></div><FoldProgress s={s} /></>
          : <div className="workflow-empty"><span className="workflow-box-icon">▱</span><b>从一张刀模开始</b><p>导入 DXF 后，在这里预览折叠效果。</p></div>}
      </section>
      {ready ? <FoldCanvas g={g} custom={custom} selectedHingeId={selectedHingeId} onSelect={selectHinge} />
        : <section className="workflow-empty workflow-import-empty"><span className="workflow-step-tag">01 / 刀模设置</span><h1>将平面刀模，折成你的盒子</h1><p>导入红色切线、绿色压痕的 DXF 文件。<br />点击折线调整角度，然后创建设计画布。</p><div className="workflow-import-card"><DxfImport onImported={imported} /></div><small>文件在本机浏览器处理 · 不上传刀模</small></section>}
      <aside className="workflow-fold-settings" aria-label="折线角度设置">
        <div className="workflow-pane-title"><span>折叠设置</span><small>{custom ? custom.hinges.length + ' 条可折叠线' : '毫米 mm'}</small></div>
        <div className="workflow-settings-scroll">
          {ready && <div className="workflow-section"><DxfImport onImported={imported} /></div>}
          <div className="workflow-section"><label className="workflow-field">结构材质<select aria-label="结构材质" value={s.matId} onChange={e => store.set({ matId: e.target.value })}>{MATS.map(mat => <option key={mat.id} value={mat.id}>{mat.name} · {mat.t} mm</option>)}</select></label><small>纸厚 {m.t} mm · DXF 刀模尺寸保持原始毫米坐标</small></div>
          {custom ? <div className="workflow-section" ref={controls}><h2>折线角度</h2><CustomFoldControls custom={custom} selectedHingeId={selectedHingeId} onSelect={setSelectedHingeId} /></div>
            : <div className="workflow-section workflow-muted">{ready ? '当前为内置盒型，可直接创建设计。' : '导入后，点击刀模折线即可定位并调整角度。'}</div>}
          {custom?.warnings.length > 0 && <details className="workflow-section workflow-warnings"><summary>刀模提示 · {custom.warnings.length}</summary><ul>{custom.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></details>}
        </div>
        <div className="workflow-next"><button disabled={!ready} className="workflow-primary" onClick={() => { setDesignMode('2d'); go('design'); }}>创建画布 →</button><small>保留当前折叠角度，进入 2D 设计</small></div>
      </aside>
    </main>}
    {page === 'design' && ready && <main className="workflow-design">
      <div className="workflow-design-toolbar"><button onClick={() => go('knife')}>← 折线设置</button><strong>{templateNameOf(s)}</strong><div className="workflow-mode-switch"><button className={designMode === '2d' ? 'active' : ''} onClick={() => { setDesignMode('2d'); store.set(st => ({ fitNonce: st.fitNonce + 1 })); }}>2D 设计</button><button className={designMode === '3d' ? 'active' : ''} onClick={() => setDesignMode('3d')}>3D 预览</button></div><button onClick={pdf} disabled={exporting}>{exporting ? '正在导出…' : '导出 PDF'}</button><button className="workflow-primary" onClick={() => go('render')}>进入渲染 →</button></div>
      <div className="workflow-design-body">{designMode === '2d'
        ? <DesignView allowSheetImage preview={<section className="workflow-mini-preview" aria-label="设计实时 3D 预览"><BoxPreview s={s} m={m} /><button onClick={() => setDesignMode('3d')}>放大 3D ↗</button></section>} />
        : <section className="workflow-full-preview" aria-label="完整 3D 预览"><BoxPreview s={s} m={m} /><FoldProgress s={s} /></section>}
      </div>
    </main>}
    {page === 'render' && ready && <RenderPage key={renderVersion} s={s} m={m} onBack={() => go('design')} onOpenLibrary={setLibrary} apiRef={renderApi} initialScene={renderDraft} />}
    {library && <PlanLibrary kind={library} onClose={() => setLibrary('')} onChoose={openPlan} />}
    {saveForm && <dialog ref={saveDialog} className="workflow-save-dialog" aria-labelledby="save-plan-title" onCancel={e => { if (saving) e.preventDefault(); else setSaveForm(null); }}>
      <form onSubmit={e => { e.preventDefault(); save(); }}><h2 id="save-plan-title">保存{saveForm.kind === 'render' ? '渲染' : '平面'}设计方案</h2>
        <label>方案名称<input autoFocus required maxLength={60} value={saveForm.name} onChange={e => setSaveForm({ ...saveForm, name: e.target.value })} /></label><p>保存在本机浏览器，可从方案库重新打开。</p>
        {error && <p role="alert" className="workflow-save-error">{error}</p>}
        <div><button type="button" disabled={saving} onClick={() => setSaveForm(null)}>取消</button>{saveForm.id && <button type="button" disabled={saving} onClick={() => save(true)}>另存新方案</button>}<button className="workflow-primary" disabled={saving || !saveForm.name.trim()}>{saving ? '正在保存…' : saveForm.id ? '更新方案' : '保存方案'}</button></div>
      </form>
    </dialog>}
    <footer className="workflow-status"><span>{ready ? templateNameOf(s) : '未导入刀模'}</span>{g && <span>展开 {(g.sbb[2] - g.sbb[0]).toFixed(1)} × {(g.sbb[3] - g.sbb[1]).toFixed(1)} mm</span>}<span>本地处理</span><span className="workflow-status-end" role="status">{notice || (ready ? '方案保存在本机 · 可导出 .boxproj 工程' : '支持 DXF / .boxproj')}</span></footer>
  </div>;
}
