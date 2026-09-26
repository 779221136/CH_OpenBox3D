import React, { useEffect, useId, useRef, useState } from 'react';
import { deletePlan, getPlan, listPlans } from './savedPlans.js';
import './plans.css';

export function PlanLibrary({ kind, title, onClose, onChoose }) {
  const dialog = useRef(null), alive = useRef(false), titleId = useId();
  const [plans, setPlans] = useState([]), [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(''), [error, setError] = useState('');
  const [deleting, setDeleting] = useState('');
  const heading = title || (kind === 'render' ? '我的渲染方案' : '我的设计方案');
  useEffect(() => {
    const node = dialog.current;
    alive.current = true;
    node.showModal();
    return () => { alive.current = false; node.close(); };
  }, []);
  useEffect(() => {
    let current = true;
    setLoading(true); setError(''); setPlans([]); setDeleting('');
    listPlans(kind).then(rows => { if (current) setPlans(rows); })
      .catch(e => { if (current) setError(e.message); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [kind]);
  const open = async id => {
    setBusy(id); setError('');
    try {
      const plan = await getPlan(id);
      if (!plan) throw new Error('该方案已被删除，请重新打开方案库。');
      if (alive.current) await onChoose(plan);
    } catch (e) { if (alive.current) setError(e.message || '打开方案失败，请重试。'); }
    finally { if (alive.current) setBusy(''); }
  };
  const remove = async id => {
    setBusy(id); setError('');
    try {
      await deletePlan(id);
      if (alive.current) { setPlans(rows => rows.filter(plan => plan.id !== id)); setDeleting(''); }
    } catch (e) { if (alive.current) setError(e.message || '删除方案失败，请重试。'); }
    finally { if (alive.current) setBusy(''); }
  };
  const visible = plans.filter(plan => plan.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <dialog ref={dialog} className="workflow-plan-dialog" aria-labelledby={titleId} onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <div className="workflow-plan-library" aria-busy={loading || !!busy}>
      <header className="workflow-plan-header"><div><h2 id={titleId}>{heading}</h2><p>{plans.length} 个方案 · 保存在当前浏览器</p></div>
        <input type="search" aria-label={`搜索${heading}`} placeholder={`搜索${heading}`} value={query} onChange={e => setQuery(e.target.value)} />
        <button className="workflow-plan-close" onClick={onClose} disabled={!!busy} aria-label="关闭方案库">×</button>
      </header>
      {error && <p className="workflow-plan-error" role="alert">{error}</p>}
      {loading ? <p className="workflow-plan-empty" role="status">正在读取方案…</p> : visible.length === 0
        ? <p className="workflow-plan-empty">{query ? '没有找到匹配的方案。' : `暂无${kind === 'render' ? '渲染' : '设计'}方案。在对应画布点击“保存工程”后，方案会出现在这里。`}</p>
        : <div className="workflow-plan-grid">{visible.map(plan => <article key={plan.id} className="workflow-plan-card">
          <button className="workflow-plan-preview" disabled={!!busy} onClick={() => open(plan.id)} aria-label={`打开 ${plan.name}`}>
            {plan.thumbnail ? <img src={plan.thumbnail} alt={plan.name} loading="lazy" /> : <span>◇<small>暂无预览</small></span>}
          </button>
          <div className="workflow-plan-info"><h3 title={plan.name}>{plan.name}</h3><time dateTime={plan.updatedAt}>{new Date(plan.updatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</time>
            <div className="workflow-plan-actions">{deleting === plan.id ? <><span>删除此方案？</span><button disabled={!!busy} onClick={() => setDeleting('')}>取消</button><button className="workflow-plan-delete" disabled={!!busy} onClick={() => remove(plan.id)}>确认删除</button></>
              : <><button className="workflow-plan-open" disabled={!!busy} onClick={() => open(plan.id)}>{busy === plan.id ? '处理中…' : '打开方案'}</button><button disabled={!!busy} onClick={() => setDeleting(plan.id)}>删除</button></>}</div>
          </div>
        </article>)}</div>}
    </div>
  </dialog>;
}
