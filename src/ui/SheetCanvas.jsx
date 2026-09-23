// 2D 画布：结构/设计视图共用 —— SVG 主画布（mm 世界坐标）+ 缩放平移 + 全部拖拽交互
import React, { useRef, useEffect, useState } from 'react';
import { store, useStore } from '../state/store.js';
import { asset } from '../asset.js';
import { bboxOf } from '../design/layers.js';
import { bboxOfPts, containerAt, containerOfLayer, clipPtsOf } from '../design/containers.js';

export function SheetCanvas({ view, g, children, onImageDrop }) {
  const s = useStore();
  const elRef = useRef(null);
  const drag = useRef(null);          // {type:'pan'|'move'|'resize'|'rot', ...}
  const userMoved = useRef(false);
  const [snapG, setSnapG] = useState(null);
  const [dropPanel, setDropPanel] = useState(null);
  const k = s.k || 1;
  const editOn = s.editMode && view === 'structure';
  const sheetClip = s.layers.some(l => l.scope === 'sheet') ? clipPtsOf(g.panels, { scope: 'sheet' }) : null;
  const hasImageDrag = e => Array.from((e.dataTransfer && e.dataTransfer.items) || []).some(it => it.kind === 'file' && /^image\/(png|jpeg|webp)$/i.test(it.type));

  const mmPt = e => {
    const r = elRef.current.getBoundingClientRect();
    return [(e.clientX - r.left - s.tx) / s.k, (e.clientY - r.top - s.ty) / s.k];
  };
  const fit = () => {
    const el = elRef.current; if (!el) return;
    const r = el.getBoundingClientRect(); if (r.width < 50) return;
    const bb = g.vbb, pad = 44;
    const w = bb[2] - bb[0], h = bb[3] - bb[1];
    const k2 = Math.min((r.width - 2 * pad) / w, (r.height - 2 * pad) / h);
    store.set({ k: k2, tx: (r.width - k2 * w) / 2 - k2 * bb[0], ty: (r.height - k2 * h) / 2 - k2 * bb[1] });
  };
  // 挂载 / 几何变化时适配（用户未手动平移过）；fitNonce 强制适配
  useEffect(() => { const raf = requestAnimationFrame(() => { if (!userMoved.current) fit(); }); return () => cancelAnimationFrame(raf); }, [g]);
  useEffect(() => { if (s.fitNonce > 0) { userMoved.current = false; const raf = requestAnimationFrame(fit); return () => cancelAnimationFrame(raf); } }, [s.fitNonce]);
  // 滚轮缩放（非 passive）
  useEffect(() => {
    const el = elRef.current; if (!el) return;
    const onWheel = e => {
      e.preventDefault();
      const r = el.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      const st = store.get();
      const f = Math.exp(-e.deltaY * 0.0016), k2 = Math.min(40, Math.max(0.05, st.k * f)), rf = k2 / st.k;
      store.set({ k: k2, tx: mx - (mx - st.tx) * rf, ty: my - (my - st.ty) * rf });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  useEffect(() => {
    const el = elRef.current; if (!el) return;
    const ro = new ResizeObserver(() => { if (!userMoved.current) fit(); });
    ro.observe(el); return () => ro.disconnect();
  }, [g]);

  // —— 图层按下（设计视图）：选中 + 开始移动（带吸附） ——
  const onLayerDown = (e, l, b) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (s.sel !== l.id) store.set({ sel: l.id });
    if (l.locked) return;
    try { elRef.current.setPointerCapture(e.pointerId); } catch (_) { /* 浏览器不支持时沿用窗口内拖拽 */ }
    const vT = [], hT = [];
    (g.panels || []).forEach(panel => {
      const pb = bboxOfPts(panel.pts), x0 = pb[0], y0 = pb[1], x1 = pb[2], y1 = pb[3];
      vT.push(x0, (x0 + x1) / 2, x1); hT.push(y0, (y0 + y1) / 2, y1);
    });
    s.layers.forEach(o => { if (o.id === l.id || !o.visible) return; const ob = bboxOf(o); vT.push(ob[0], ob[0] + ob[2] / 2, ob[0] + ob[2]); hT.push(ob[1], ob[1] + ob[3] / 2, ob[1] + ob[3]); });
    drag.current = { type: 'move', id: l.id, sx: e.clientX, sy: e.clientY, ox: l.x, oy: l.y, snap: { v: vT, h: hT }, bl: b[0] - l.x, bt: b[1] - l.y, bw: b[2], bh: b[3] };
  };
  const onPointerDown = e => {
    if (e.button !== 0) return;
    userMoved.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { type: 'pan', x: e.clientX, y: e.clientY, tx: s.tx, ty: s.ty };
  };
  const onPointerMove = e => {
    const d = drag.current; if (!d) return;
    const kk = store.get().k;
    if (d.type === 'resize') {
      let dx = (e.clientX - d.sx) / kk, dy = (e.clientY - d.sy) / kk;
      const rr = (d.l0.rot || 0) * Math.PI / 180, co = Math.cos(rr), si = Math.sin(rr);
      const dxL = dx * co + dy * si, dyL = -dx * si + dy * co;
      if (d.cropMode) {
        // 裁剪：源图像素尺度不变，拖边调整显示区域与 crop 矩形
        store.set(st => ({
          layers: st.layers.map(l => {
            if (l.id !== d.id) return l;
            const cr = (d.l0.crop || [0, 0, 1, 1]).slice();
            const sx = d.l0.w / cr[2], sy = d.l0.h / cr[3];
            let x = d.l0.x, y = d.l0.y, w = d.l0.w, h = d.l0.h;
            if (d.mode.includes('e')) { w = Math.max(2, d.l0.w + dxL); cr[2] = w / sx; }
            if (d.mode.includes('w')) { x = d.l0.x + dxL; w = Math.max(2, d.l0.w - dxL); cr[0] += (d.l0.w - w) / sx; }
            if (d.mode.includes('s')) { h = Math.max(1, d.l0.h + dyL); cr[3] = h / sy; }
            if (d.mode.includes('n')) { y = d.l0.y + dyL; h = Math.max(1, d.l0.h - dyL); cr[1] += (d.l0.h - h) / sy; }
            if (d.mode.includes('w')) x = d.l0.x + (d.l0.w - w);
            if (d.mode.includes('n')) y = d.l0.y + (d.l0.h - h);
            cr[0] = Math.min(0.95, Math.max(0, cr[0])); cr[1] = Math.min(0.95, Math.max(0, cr[1]));
            cr[2] = Math.min(1 - cr[0], Math.max(0.05, cr[2])); cr[3] = Math.min(1 - cr[1], Math.max(0.05, cr[3]));
            return { ...l, x, y, w, h, crop: cr, heroPreset: undefined };
          })
        }));
        return;
      }
      store.set(st => ({
        layers: st.layers.map(l => {
          if (l.id !== d.id) return l;
          const b0 = d.b0;
          let x0 = b0[0], y0 = b0[1], x1 = b0[0] + b0[2], y1 = b0[1] + b0[3];
          if (d.mode.includes('e')) x1 += dxL;
          if (d.mode.includes('w')) x0 += dxL;
          if (d.mode.includes('s')) y1 += dyL;
          if (d.mode.includes('n')) y0 += dyL;
          let w = Math.max(0.1, x1 - x0), h = Math.max(0.1, y1 - y0);
          if (!e.shiftKey) {
            const fx = w / b0[2], fy = h / b0[3];
            const f = d.mode === 'n' || d.mode === 's' ? fy : d.mode === 'e' || d.mode === 'w' ? fx
              : Math.abs(fx - 1) >= Math.abs(fy - 1) ? fx : fy;
            w = Math.max(d.isText ? 0.2 : 2, b0[2] * f); h = Math.max(d.isText ? 0.2 : 1, b0[3] * f);
            if (d.mode.includes('w')) x0 = b0[0] + b0[2] - w; else if (d.mode.includes('e')) x0 = b0[0]; else x0 = b0[0] + (b0[2] - w) / 2;
            if (d.mode.includes('n')) y0 = b0[1] + b0[3] - h; else if (d.mode.includes('s')) y0 = b0[1]; else y0 = b0[1] + (b0[3] - h) / 2;
          } else {
            w = Math.max(d.isText ? 0.2 : 2, w); h = Math.max(d.isText ? 0.2 : 1, h);
            if (d.mode.includes('w')) x0 = b0[0] + b0[2] - w;
            if (d.mode.includes('n')) y0 = b0[1] + b0[3] - h;
          }
          if (d.isText) {
            const cx = x0 + w / 2, cy = y0 + h / 2;
            if (!e.shiftKey) {
              const f = w / b0[2], size = Math.min(80, Math.max(1.5, d.l0.size * f));
              return { ...l, x: cx, y: cy + size * 0.345, size, heroPreset: undefined };
            }
            const base = { ...d.l0, scaleX: 1, scaleY: 1 }, ub = bboxOf(base);
            const sx = Math.max(0.05, w / Math.max(0.1, ub[2])), sy = Math.max(0.05, h / Math.max(0.1, ub[3]));
            return { ...l, x: cx, y: cy + d.l0.size * 0.345, scaleX: sx, scaleY: sy, heroPreset: undefined };
          }
          return { ...l, x: x0, y: y0, w, h, heroPreset: undefined };
        })
      }));
      return;
    }
    if (d.type === 'rot') {
      const p = mmPt(e);
      const a = Math.atan2(p[1] - d.cy, p[0] - d.cx);
      let rot = d.r0 + (a - d.a0) * 180 / Math.PI;
      if (e.shiftKey) rot = Math.round(rot / 15) * 15;
      rot = Math.round(rot * 10) / 10;
      store.set(st => ({ layers: st.layers.map(l => l.id === d.id ? { ...l, rot, heroPreset: undefined } : l) }));
      return;
    }
    if (d.type === 'move') {
      let nx = d.ox + (e.clientX - d.sx) / kk, ny = d.oy + (e.clientY - d.sy) / kk;
      let gv = null, gh = null;
      if (d.snap && !e.altKey) {
        const thr = 6 / kk;
        const cands = [nx + d.bl, nx + d.bl + d.bw / 2, nx + d.bl + d.bw];
        let best = thr;
        d.snap.v.forEach(tv => cands.forEach((cd, ci) => { const df = Math.abs(cd - tv); if (df < best) { best = df; nx += tv - cd; gv = tv; } }));
        const candsY = [ny + d.bt, ny + d.bt + d.bh / 2, ny + d.bt + d.bh];
        let bestY = thr;
        d.snap.h.forEach(tv => candsY.forEach((cd, ci) => { const df = Math.abs(cd - tv); if (df < bestY) { bestY = df; ny += tv - cd; gh = tv; } }));
      }
      setSnapG(gv != null || gh != null ? { v: gv, h: gh } : null);
      store.set(st => ({ layers: st.layers.map(l => l.id === d.id ? { ...l, x: nx, y: ny, heroPreset: undefined } : l) }));
      return;
    }
    if (d.type === 'pan') store.set({ tx: d.tx + e.clientX - d.x, ty: d.ty + e.clientY - d.y });
  };
  const onPointerUp = e => {
    const d = drag.current;
    if (d && d.type === 'move' && e) {
      const hit = containerAt(g, mmPt(e));
      if (hit) store.set(st => ({ layers: st.layers.map(l => l.id === d.id && l.scope !== 'sheet' && l.panelId !== hit.panelId ? { ...l, panelId: hit.panelId } : l) }));
    }
    if (e) try { elRef.current.releasePointerCapture(e.pointerId); } catch (_) { /* 已释放或未捕获 */ }
    drag.current = null; setSnapG(null);
  };
  const onDragOver = e => {
    if (view !== 'design' || !onImageDrop || !hasImageDrag(e)) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
    setDropPanel(containerAt(g, mmPt(e)));
  };
  const onDragLeave = e => {
    if (!e.currentTarget.contains(e.relatedTarget)) setDropPanel(null);
  };
  const onDrop = e => {
    if (view !== 'design' || !onImageDrop || !hasImageDrag(e)) return;
    e.preventDefault();
    const panel = containerAt(g, mmPt(e));
    if (!panel) { setDropPanel(null); return; }
    const point = mmPt(e);
    setDropPanel(null);
    onImageDrop(e.dataTransfer.files, point, panel);
  };

  const updSel = patch => store.set(st => ({ layers: st.layers.map(l => l.id === st.sel ? { ...l, ...patch, heroPreset: undefined } : l) }));
  const sel = s.layers.find(l => l.id === s.sel);
  const selB = sel && sel.visible !== false && view === 'design' ? bboxOf(sel) : null;

  // —— 结构视图：线段类型选择 ——
  const renderLineEditor = () => {
    const els = [];
    g.segs.forEach((sg, si) => {
      const dstr = 'M' + sg.pts.map(p => p[0] + ' ' + p[1]).join('L');
      if (s.selSeg === si) els.push(<path key={'sel' + si} d={dstr} fill="none" stroke="#1c6ee0" strokeWidth={3} style={{ vectorEffect: 'non-scaling-stroke' }} />);
      els.push(<path key={'hit' + si} d={dstr} fill="none" stroke="rgba(0,0,0,0.001)" strokeWidth={9 / k} style={{ cursor: 'pointer' }} onClick={e => { e.stopPropagation(); store.set({ selSeg: si }); }} />);
    });
    return <g>{els}</g>;
  };

  // —— 设计视图：图层 ——
  const renderLayer = l => {
    const b = bboxOf(l);
    let fill = l.color || '#211d18', stroke = 'none';
    if (l.finish === 'foil') fill = 'url(#foilG)';
    else if (l.finish === 'silver') fill = 'url(#silvG)';
    else if (l.finish === 'holo') fill = 'url(#holoG)';
    else if (l.finish === 'emboss') { fill = 'rgba(33,29,24,0.12)'; stroke = 'rgba(33,29,24,0.4)'; }
    const cx = b[0] + b[2] / 2, cy = b[1] + b[3] / 2;
    const rotTf = 'rotate(' + (l.rot || 0) + ' ' + cx + ' ' + cy + ')';
    const textScaleTf = 'translate(' + cx + ' ' + cy + ') scale(' + (l.scaleX || 1) + ' ' + (l.scaleY || 1) + ') translate(' + (-cx) + ' ' + (-cy) + ')';
    const op = l.opacity == null ? 1 : l.opacity;
    const els = [];
    if (l.kind === 'image') {
      els.push(
        <g key={l.id} transform={rotTf} opacity={op}>
          <g onPointerDown={e => onLayerDown(e, l, b)} style={{ cursor: 'move' }}>
            {l.imgSrc
              ? (l.crop
                ? <svg x={l.x} y={l.y} width={l.w} height={l.h} viewBox={[l.crop[0] * 100, l.crop[1] * 100, l.crop[2] * 100, l.crop[3] * 100].join(' ')} preserveAspectRatio="none">
                  <image href={l.imgSrc[0] === '/' ? asset(l.imgSrc) : l.imgSrc} x={0} y={0} width={100} height={100} preserveAspectRatio="none" />
                </svg>
                : <image href={l.imgSrc[0] === '/' ? asset(l.imgSrc) : l.imgSrc} x={l.x} y={l.y} width={l.w} height={l.h} preserveAspectRatio="none" />)
              : (<>
                <rect x={l.x} y={l.y} width={l.w} height={l.h} fill="#efe9dc" stroke="#b3a88f" strokeWidth={0.4} strokeDasharray="2 1.4" />
                <line x1={l.x} y1={l.y} x2={l.x + l.w} y2={l.y + l.h} stroke="#cfc4ab" strokeWidth={0.3} />
                <line x1={l.x} y1={l.y + l.h} x2={l.x + l.w} y2={l.y} stroke="#cfc4ab" strokeWidth={0.3} />
              </>)}
          </g>
        </g>
      );
    } else if (l.kind === 'shape') {
      els.push(
        <g key={l.id} transform={rotTf} opacity={op}>
          <rect x={l.x} y={l.y} width={l.w} height={l.h} fill={fill} onPointerDown={e => onLayerDown(e, l, b)} style={{ cursor: 'move' }} />
        </g>
      );
    } else {
      els.push(
        <g key={l.id} transform={rotTf} opacity={op}>
          <g transform={textScaleTf}>
            <text x={l.x} y={l.y} fontSize={l.size} textAnchor="middle" fill={fill} stroke={stroke} strokeWidth={0.25}
              onPointerDown={e => onLayerDown(e, l, b)}
              style={{ fontFamily: "'" + (l.font || 'Noto Sans SC') + "',sans-serif", fontWeight: l.weight, cursor: 'move', userSelect: 'none' }}>{l.content}</text>
          </g>
        </g>
      );
    }
    if (l.finish === 'uv') els.push(<rect key={l.id + 'uv'} x={b[0] - 1} y={b[1] - 1} width={b[2] + 2} height={b[3] + 2} fill="none" stroke="#5a9bc4" strokeWidth={1} strokeDasharray="4 3" style={{ vectorEffect: 'non-scaling-stroke', pointerEvents: 'none' }} />);
    if (l.finish === 'gloss') els.push(<rect key={l.id + 'gloss'} x={b[0] - 1} y={b[1] - 1} width={b[2] + 2} height={b[3] + 2} fill="none" stroke="#28a7a1" strokeWidth={1} strokeDasharray="7 2 1 2" style={{ vectorEffect: 'non-scaling-stroke', pointerEvents: 'none' }} />);
    const panel = containerOfLayer(g, l);
    const clipId = l.scope === 'sheet' ? 'design-sheet' : panel ? 'design-panel-' + String(panel.panelId).replace(/[^a-zA-Z0-9_-]/g, '-') : '';
    return <g key={l.id} clipPath={clipId ? 'url(#' + clipId + ')' : undefined}>{els}</g>;
  };

  // —— 设计视图：选中框（8 手柄 + 旋转） ——
  const renderSelOverlay = () => {
    if (!selB || sel.locked) {
      return selB ? <rect x={selB[0]} y={selB[1]} width={selB[2]} height={selB[3]} fill="none" stroke="#9a5b1f" strokeWidth={1.4} strokeDasharray="2 2" style={{ vectorEffect: 'non-scaling-stroke', pointerEvents: 'none' }} /> : null;
    }
    const hs = 7 / k, rot = sel.rot || 0;
    const scx = selB[0] + selB[2] / 2, scy = selB[1] + selB[3] / 2;
    const modes = sel.kind === 'text' ? ['nw', 'ne', 'sw', 'se'] : ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
    const pos = mo => [mo.includes('w') ? selB[0] : mo.includes('e') ? selB[0] + selB[2] : scx, mo.includes('n') ? selB[1] : mo.includes('s') ? selB[1] + selB[3] : scy];
    const curs = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };
    const rp = [scx, selB[1] - 11 / k];
    return (
      <g transform={'rotate(' + rot + ' ' + scx + ' ' + scy + ')'}>
        <rect x={selB[0]} y={selB[1]} width={selB[2]} height={selB[3]} fill="none" stroke="#9a5b1f" strokeWidth={1.4} strokeDasharray="5 3" style={{ vectorEffect: 'non-scaling-stroke', pointerEvents: 'none' }} />
        {modes.map(mo => {
          const p = pos(mo);
          return <rect key={mo} x={p[0] - hs / 2} y={p[1] - hs / 2} width={hs} height={hs} fill="#fff" stroke="#9a5b1f" strokeWidth={1.2 / k} style={{ cursor: curs[mo] }}
            onPointerDown={e => { if (e.button !== 0) return; e.stopPropagation(); drag.current = { type: 'resize', id: sel.id, mode: mo, sx: e.clientX, sy: e.clientY, l0: { ...sel }, b0: selB, isText: sel.kind === 'text', cropMode: !!(s.uiCrop && sel.kind === 'image' && sel.imgSrc) }; }} />;
        })}
        <line x1={scx} y1={selB[1]} x2={rp[0]} y2={rp[1]} stroke="#9a5b1f" strokeWidth={1 / k} />
        <circle cx={rp[0]} cy={rp[1]} r={4.5 / k} fill="#9a5b1f" stroke="#fff" strokeWidth={1.2 / k} style={{ cursor: 'crosshair' }}
          onPointerDown={e => { if (e.button !== 0) return; e.stopPropagation(); const p = mmPt(e); drag.current = { type: 'rot', id: sel.id, cx: scx, cy: scy, a0: Math.atan2(p[1] - scy, p[0] - scx), r0: rot }; }} />
      </g>
    );
  };

  const zoomPct = Math.round(k * 100) + '%';
  return (
    <div ref={elRef} aria-label={view === 'design' ? '设计画布，可拖拽图片到盒面' : undefined} data-testid={view === 'design' ? 'design-drop-canvas' : undefined}
      style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#e7e0d0', userSelect: 'none', touchAction: 'none' }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}
      onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <svg width="100%" height="100%" style={{ display: 'block' }}>
        {view === 'design' && (
          <defs>
            {sheetClip && <clipPath id="design-sheet" clipPathUnits="userSpaceOnUse"><path clipRule="evenodd" d={[sheetClip.pts, ...sheetClip.holes].map(ring => 'M' + ring.map(p => p.join(' ')).join('L') + 'Z').join(' ')} /></clipPath>}
            <linearGradient id="foilG" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#E9CB6E" /><stop offset="0.5" stopColor="#B08A1E" /><stop offset="1" stopColor="#E3BE55" />
            </linearGradient>
            <linearGradient id="silvG" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#EDEDF2" /><stop offset="0.5" stopColor="#9A9AA4" /><stop offset="1" stopColor="#DCDCE2" />
            </linearGradient>
            <linearGradient id="holoG" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#f5c6d6" /><stop offset="0.25" stopColor="#c9c3f0" /><stop offset="0.5" stopColor="#b7dcf5" /><stop offset="0.75" stopColor="#c2f0dd" /><stop offset="1" stopColor="#f7ecc8" />
            </linearGradient>
            {(g.panels || []).map(panel => {
              const id = 'design-panel-' + String(panel.panelId).replace(/[^a-zA-Z0-9_-]/g, '-');
              return <clipPath key={panel.panelId} id={id} clipPathUnits="userSpaceOnUse"><path clipRule="evenodd" d={[panel.pts, ...(panel.holes || [])].map(ring => 'M' + ring.map(p => p.join(' ')).join('L') + 'Z').join(' ')} /></clipPath>;
            })}
          </defs>
        )}
        <g transform={'translate(' + s.tx + ' ' + s.ty + ') scale(' + k + ')'}>
          {view === 'structure' && (<>
            {s.show.bleed && s.bleed > 0 && <path d={g.fillPath} fill="none" stroke="rgba(154,91,31,0.22)" strokeWidth={s.bleed * 2} strokeLinejoin="round" strokeLinecap="round" />}
            <path d={g.fillPath} fillRule={s.tpl === 'custom' ? 'evenodd' : undefined} fill="#fdfcf7" stroke="none" />
            {s.show.safe && <path d={g.safePath} fill="none" stroke="#c9a227" strokeWidth={0.45} strokeDasharray="2.2 1.8" />}
            <path d={g.creasePath} fill="none" stroke="#2E7D46" strokeWidth={1.5} style={{ vectorEffect: 'non-scaling-stroke' }} />
            <path d={g.cutPath} fill="none" stroke="#C8102E" strokeWidth={1.6} style={{ vectorEffect: 'non-scaling-stroke' }} />
            {s.show.labels && <g>{g.labels.map((p, i) => <text key={i} x={p.x} y={p.y} fontSize={p.fs} textAnchor="middle" style={{ fill: '#a59a85', fontWeight: 500, userSelect: 'none' }}>{p.name}</text>)}</g>}
            {s.show.dims && <g>{g.dims.map((d, i) => (
              <g key={i} transform={d.gtf}>
                <line x1={0} y1={0} x2={d.len} y2={0} stroke="#8a8071" strokeWidth={1} style={{ vectorEffect: 'non-scaling-stroke' }} />
                <line x1={0} y1={-2.4} x2={0} y2={2.4} stroke="#8a8071" strokeWidth={1} style={{ vectorEffect: 'non-scaling-stroke' }} />
                <line x1={d.len} y1={-2.4} x2={d.len} y2={2.4} stroke="#8a8071" strokeWidth={1} style={{ vectorEffect: 'non-scaling-stroke' }} />
                <text x={d.mid} y={-2.2} fontSize={3.4} textAnchor="middle" style={{ fill: '#6d6557', fontFamily: "'JetBrains Mono',monospace", userSelect: 'none' }}>{d.label}</text>
              </g>))}</g>}
            {editOn && renderLineEditor()}
          </>)}
          {view === 'design' && (<>
            <path d={g.fillPath} fillRule={s.tpl === 'custom' ? 'evenodd' : undefined} fill="#fdfcf7" stroke="none" />
            <path d={g.safePath} fill="none" stroke="#ddd0ab" strokeWidth={0.4} strokeDasharray="2.2 1.8" />
            <path d={g.creasePath} fill="none" stroke="#a8c9ae" strokeWidth={1} style={{ vectorEffect: 'non-scaling-stroke' }} />
            <path d={g.cutPath} fill="none" stroke="#dfaeb2" strokeWidth={1} style={{ vectorEffect: 'non-scaling-stroke' }} />
            {dropPanel && <polygon points={dropPanel.pts.map(p => p[0] + ',' + p[1]).join(' ')} fill="rgba(40,167,161,0.18)" stroke="#28a7a1" strokeWidth={2} style={{ vectorEffect: 'non-scaling-stroke', pointerEvents: 'none' }} />}
            {s.layers.filter(l => l.visible).map(renderLayer)}
            {snapG && (
              <g>
                {snapG.v != null && <line x1={snapG.v} y1={g.sbb[1] - 15} x2={snapG.v} y2={g.sbb[3] + 15} stroke="#d6318c" strokeWidth={1} strokeDasharray="4 3" style={{ vectorEffect: 'non-scaling-stroke' }} />}
                {snapG.h != null && <line x1={g.sbb[0] - 15} y1={snapG.h} x2={g.sbb[2] + 15} y2={snapG.h} stroke="#d6318c" strokeWidth={1} strokeDasharray="4 3" style={{ vectorEffect: 'non-scaling-stroke' }} />}
              </g>
            )}
            {renderSelOverlay()}
          </>)}
        </g>
      </svg>
      {dropPanel && <div data-testid="image-drop-hint" style={{ position: 'absolute', left: '50%', top: 18, transform: 'translateX(-50%)', padding: '7px 12px', borderRadius: 6, background: '#211d18', color: '#fff', fontSize: 12, fontWeight: 700, boxShadow: '0 6px 18px rgba(33,29,24,0.22)', pointerEvents: 'none' }}>释放图片到当前盒面</div>}
      <div style={{ position: 'absolute', left: 12, bottom: 12, display: 'flex', gap: 10, background: 'rgba(250,247,240,0.92)', border: '1px solid #ded5c4', borderRadius: 6, padding: '6px 12px', fontSize: 11, color: '#5c554a', alignItems: 'center' }}>
        {view === 'structure' ? (<>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 14, height: 2, background: '#C8102E', display: 'inline-block' }} />切线</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 14, height: 2, background: '#2E7D46', display: 'inline-block' }} />压痕</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 14, height: 0, borderTop: '2px dashed #c9a227', display: 'inline-block' }} />安全区</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 14, height: 6, background: 'rgba(154,91,31,0.25)', display: 'inline-block' }} />出血带</span>
        </>) : (<>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 12, height: 8, background: 'linear-gradient(135deg,#E9CB6E,#B08A1E)', display: 'inline-block', borderRadius: 2 }} />烫金</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 12, height: 0, borderTop: '2px dashed #5a9bc4', display: 'inline-block' }} />局部UV</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 12, height: 8, background: 'linear-gradient(135deg,#f8ffff,#74d8d1,#fff)', border: '1px solid #28a7a1', display: 'inline-block', borderRadius: 2 }} />亮面</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 12, height: 8, background: 'rgba(33,29,24,0.12)', border: '1px solid rgba(33,29,24,0.35)', display: 'inline-block', borderRadius: 2 }} />压纹</span>
        </>)}
      </div>
      <div style={{ position: 'absolute', right: 12, bottom: 12, display: 'flex', gap: 4, background: 'rgba(250,247,240,0.92)', border: '1px solid #ded5c4', borderRadius: 6, padding: 4 }}>
        <button onClick={() => store.set(st => ({ k: Math.max(0.05, st.k / 1.25) }))} style={{ width: 26, height: 26, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 15, color: '#5c554a', borderRadius: 4 }}>−</button>
        <div style={{ minWidth: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: '#5c554a' }}>{zoomPct}</div>
        <button onClick={() => store.set(st => ({ k: Math.min(40, st.k * 1.25) }))} style={{ width: 26, height: 26, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 15, color: '#5c554a', borderRadius: 4 }}>+</button>
        <button onClick={() => { userMoved.current = false; fit(); }} title="适配视图" style={{ width: 26, height: 26, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 12, color: '#5c554a', borderRadius: 4 }}>⤢</button>
      </div>
      {children}
    </div>
  );
}
