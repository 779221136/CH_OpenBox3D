import React, { useEffect, useRef, useState } from 'react';
import { setCustomFoldAngle } from '../ui/DxfImport.jsx';

export function FoldCanvas({ g, custom, selectedHingeId, onSelect }) {
  const svg = useRef(null), drag = useRef(null);
  const [zoom, setZoom] = useState(1), [pan, setPan] = useState([0, 0]);
  const w = g.sbb[2] - g.sbb[0], h = g.sbb[3] - g.sbb[1], pad = Math.max(w, h) * 0.065;
  const vw = (w + pad * 2) / zoom, vh = (h + pad * 2) / zoom;
  const x = (g.sbb[0] + g.sbb[2] - vw) / 2 + pan[0], y = (g.sbb[1] + g.sbb[3] - vh) / 2 + pan[1];
  const fs = Math.max(w, h) / 85;
  const fit = () => { setZoom(1); setPan([0, 0]); };
  useEffect(fit, [g.sbb.join(',')]);
  useEffect(() => {
    const el = svg.current;
    const wheel = e => { e.preventDefault(); setZoom(z => Math.max(0.4, Math.min(5, z * Math.exp(-e.deltaY * 0.0015)))); };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);
  const point = e => new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.current.getScreenCTM().inverse());
  const endDrag = e => { if (svg.current.hasPointerCapture(e.pointerId)) svg.current.releasePointerCapture(e.pointerId); drag.current = null; };
  return <section className="workflow-dieline" aria-label="平面刀模折线设置">
    <svg ref={svg} aria-label="可选择折线的 DXF 刀模" viewBox={[x, y, vw, vh].join(' ')}
      onPointerDown={e => { if (e.button !== 0) return; drag.current = point(e); svg.current.setPointerCapture(e.pointerId); }}
      onPointerMove={e => { if (!drag.current) return; const p = point(e), dx = drag.current.x - p.x, dy = drag.current.y - p.y; setPan(old => [old[0] + dx, old[1] + dy]); }}
      onPointerUp={endDrag} onPointerCancel={endDrag}>
      <path d={g.fillPath} fill="#fff" fillRule="evenodd" />
      <path d={g.cutPath} fill="none" stroke="#343b44" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      <path d={g.creasePath} fill="none" stroke="#e75959" strokeDasharray="3 3" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      {(custom?.hinges || []).map((hinge, i) => {
        const [a, b] = hinge.edge, mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        const selected = selectedHingeId === hinge.id, angle = custom.angles?.[hinge.id] ?? hinge.angle ?? 90;
        return <g key={hinge.id} role="button" tabIndex="0" aria-label={'选择折线 ' + (i + 1)} aria-pressed={selected}
          className="workflow-hinge" data-hinge-id={hinge.id} onPointerDown={e => e.stopPropagation()}
          onClick={() => onSelect(hinge.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(hinge.id); } }}>
          <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="transparent" strokeWidth="16" vectorEffect="non-scaling-stroke" />
          <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={selected ? '#fa7b22' : '#e75959'} strokeWidth={selected ? 3 : 1} strokeDasharray={selected ? undefined : '3 3'} vectorEffect="non-scaling-stroke" />
          <text x={mx} y={my - fs * 0.5} textAnchor="middle" fontSize={fs} fill={selected ? '#de6410' : '#d95757'}>{angle}°</text>
          {selected && <rect x={mx - fs * 1.6} y={my - fs * 1.8} width={fs * 3.2} height={fs * 1.7} rx={fs * 0.3} fill="#fa7b22" />}
          {selected && <text x={mx} y={my - fs * 0.5} textAnchor="middle" fontSize={fs} fill="#fff">{angle}°</text>}
        </g>;
      })}
    </svg>
    <div className="workflow-canvas-tools">
      <span><i className="workflow-cut-key" />切线</span><span><i className="workflow-crease-key" />折线</span>
      <button aria-label="刀模缩小" onClick={() => setZoom(z => Math.max(0.4, z / 1.2))}>−</button>
      <span>{Math.round(zoom * 100)}%</span>
      <button aria-label="刀模放大" onClick={() => setZoom(z => Math.min(5, z * 1.2))}>＋</button>
      <button onClick={fit}>适配刀模</button>
    </div>
    {selectedHingeId && <div className="workflow-angle-quick" onPointerDown={e => e.stopPropagation()}>
      <label>所选折线角度 <input aria-label="所选折线角度" type="number" min="-180" max="180" step="1"
        value={custom.angles?.[selectedHingeId] ?? custom.hinges.find(h => h.id === selectedHingeId)?.angle ?? 90}
        onChange={e => setCustomFoldAngle(selectedHingeId, e.target.value)} /> °</label>
    </div>}
  </section>;
}
