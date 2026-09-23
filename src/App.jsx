// 工作台外壳：顶栏、四工作区与状态栏；启动直接进工作台（无工程首页，工程为纯本地 .boxproj 文件）
import React, { useState } from 'react';
import { store, useStore } from './state/store.js';
import { geomOf, creaseSegsOf } from './dieline/geom.js';
import { templateNameOf } from './dieline/templates.js';
import { warnsOf } from './design/layers.js';
import { StructureView } from './ui/StructureView.jsx';
import { DesignView } from './ui/DesignView.jsx';
import { ThreeView } from './ui/ThreeView.jsx';
import { OutputView } from './ui/OutputView.jsx';
import { LogoCat } from './ui/widgets.jsx';
import { exportPDF } from './export/pdf.js';
import { asset } from './asset.js';
import { loadPresetBox } from './preset/presetBox.js';
import { chooseProjectFile, downloadProject, projectStateOf } from './projects/projects.js';

const REPO_URL = 'https://github.com/yuyou-dev/OpenBox3D';

// GitHub 八角猫标（顶栏源码入口）
function GithubMark({ size = 15, color = '#e8dfcc' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block' }}>
      <path fill={color} d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

export function App() {
  const s = useStore();
  const [iconOk, setIconOk] = useState(true);
  const m = store.mat();
  const g = geomOf(s, m.t);
  const fmt = v => Math.round(v * 10) / 10;
  const sw = g.sbb[2] - g.sbb[0], sh = g.sbb[3] - g.sbb[1];
  const tplName = templateNameOf(s);
  const creaseSegs = creaseSegsOf(g);
  const warnN = s.layers.reduce((a, l) => a + warnsOf(l, creaseSegs, g.sbb).length, 0);
  const customWarnN = s.tpl === 'custom' ? s.custom.warnings.length : 0;
  const okAll = warnN + customWarnN === 0;
  const tabs = [['structure', '结构'], ['design', '设计'], ['three', '3D'], ['output', '输出']];

  const importProject = async () => {
    try {
      const doc = await chooseProjectFile();
      if (!doc) return;
      store.reset(await projectStateOf(doc, 'design'));
    } catch (e) { window.alert(e.message); }
  };
  const exportProject = () => {
    const stamp = new Date().toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
    downloadProject(store.get(), { name: tplName + (s.tpl === 'custom' ? '' : ' ' + s.L + '×' + s.W + '×' + s.H) + ' ' + stamp });
  };
  const resetPreset = async () => {
    if (!window.confirm('重置为示例盒？当前未导出的修改将丢失。')) return;
    store.reset(await loadPresetBox());
  };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#f5f1e8', fontSize: 13 }}>
      <div style={{ height: 48, flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', background: '#211d18', color: '#f5f1e8', whiteSpace: 'nowrap', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          {iconOk
            ? <img src={asset('/brand/logo-header-gold.webp')} alt="" onError={() => setIconOk(false)} style={{ width: 26, height: 26, display: 'block' }} />
            : <LogoCat size={24} />}
          <b style={{ fontSize: 14, letterSpacing: '0.06em' }}>苏哇工作台</b>
          <span style={{ fontSize: 10.5, color: '#c8bda9', letterSpacing: '0.04em' }}>OpenBox3D</span>
        </div>
        <div style={{ display: 'flex', gap: 4, marginLeft: 5 }}>
          {tabs.map(tb => (
            <button key={tb[0]} onClick={() => store.set({ view: tb[0] })}
              style={{ padding: '7px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap', flex: 'none', background: s.view === tb[0] ? '#9a5b1f' : 'transparent', color: s.view === tb[0] ? '#fff' : '#cfc7b8', fontWeight: s.view === tb[0] ? 700 : 400 }}>{tb[1]}</button>
          ))}
          <a href={asset('/workflow.html')}
            style={{ padding: '7px 14px', borderRadius: 6, fontSize: 13, whiteSpace: 'nowrap', flex: 'none', color: '#cfc7b8', textDecoration: 'none' }}>3D私有刀模</a>
        </div>
        <div style={{ flex: 1 }} />
        <div title={(okAll ? '结构校验通过' : '警示 ' + (warnN + customWarnN) + ' 条（详见结构 / 输出）') + ' · 切线 ' + g.cutN + ' · 压痕 ' + g.creaseN}
          style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: okAll ? '#8fc79e' : '#f0b070', whiteSpace: 'nowrap', flex: 'none', minWidth: 0, overflow: 'hidden' }}>
          <div style={{ width: 7, height: 7, borderRadius: 99, background: okAll ? '#3f9e5f' : '#e08030', flex: 'none' }} />
          {okAll ? (s.tpl === 'custom' ? 'DXF 已导入' : '校验通过') : '警示 ' + (warnN + customWarnN)}
        </div>
        <button onClick={importProject} style={{ padding: '7px 12px', borderRadius: 6, border: '1px solid #6a6151', cursor: 'pointer', fontSize: 12, background: 'transparent', color: '#e8dfcc', whiteSpace: 'nowrap' }}>导入工程</button>
        <button onClick={exportProject} style={{ padding: '7px 12px', borderRadius: 6, border: '1px solid #6a6151', cursor: 'pointer', fontSize: 12, background: 'transparent', color: '#e8dfcc', whiteSpace: 'nowrap' }}>导出工程</button>
        <button onClick={resetPreset} title="恢复为内置示例盒" style={{ padding: '7px 12px', borderRadius: 6, border: '1px solid #6a6151', cursor: 'pointer', fontSize: 12, background: 'transparent', color: '#e8dfcc', whiteSpace: 'nowrap' }}>重置示例盒</button>
        <button onClick={async () => { try { await exportPDF(s, m, s.pdfMode); } catch (e) { alert(e.message || String(e)); } }} style={{ padding: '7px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 700, background: '#9a5b1f', color: '#fff', whiteSpace: 'nowrap', flex: 'none' }}>导出 PDF</button>
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer" title="GitHub 开源仓库" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', borderRadius: 6, border: '1px solid #6a6151', fontSize: 12, color: '#e8dfcc', textDecoration: 'none', whiteSpace: 'nowrap', flex: 'none' }}><GithubMark />GitHub</a>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {s.view === 'structure' && <StructureView />}
        {s.view === 'design' && <DesignView />}
        {s.view === 'three' && <ThreeView />}
        {s.view === 'output' && <OutputView />}
      </div>

      <div style={{ height: 26, flex: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '0 12px', background: '#efe9dc', borderTop: '1px solid #ded5c4', fontSize: 11, color: '#6d6557', fontFamily: "'JetBrains Mono',monospace", whiteSpace: 'nowrap', overflow: 'hidden', lineHeight: '26px' }}>
        <span>{tplName} · {m.name} t={m.t}</span>
        <span>展开 {fmt(sw)}×{fmt(sh)} mm</span>
        <span>出血 {s.bleed} mm</span>
        <div style={{ flex: 1 }} />
        <span>缩放 {Math.round((s.k || 1) * 100)}%</span>
        <span>单位 mm</span>
      </div>
    </div>
  );
}
