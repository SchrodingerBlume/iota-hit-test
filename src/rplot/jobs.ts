import { create } from 'zustand';
import { getEditor, getEditorMeta } from '../editor/registry';
import { useStore, type RichKey } from '../model/store';
import type { RichDoc } from '../model/types';
import { pendingRPlotOf, rPlotDataFiles, type PendingRPlot, type RPlotDraft } from './files';
import { createRPlot, isRPlotRendering, saveRPlot, type RenderedRPlot } from './render';

export interface RPlotTarget { docId: string; key: RichKey; uid: string }
export interface RPlotJob {
  id: string; docId: string; draft: RPlotDraft; createdAt: number; startedAt?: number;
  phase: 'queued' | 'running' | 'ready' | 'completed' | 'error' | 'cancelled';
  status: string; error?: string; result?: RenderedRPlot; target?: RPlotTarget;
}
export const useRPlotJobs = create<{ jobs: Record<string, RPlotJob> }>(() => ({ jobs: {} }));
const controllers = new Map<string, AbortController>();
const applying = new Set<string>();
let pumping = false;
const setJob = (id: string, patch: Partial<RPlotJob>) => useRPlotJobs.setState((s) => s.jobs[id] ? { jobs: { ...s.jobs, [id]: { ...s.jobs[id], ...patch } } } : s);
const getJob = (id: string) => useRPlotJobs.getState().jobs[id];

function targetNode(job: RPlotJob) {
  const target = job.target;
  if (!target || useStore.getState().doc.id !== target.docId) return null;
  const editor = getEditor(target.key);
  const editorDoc = getEditorMeta(target.key)?.docId;
  if (editor && !editor.isDestroyed && (!editorDoc || editorDoc === target.docId)) {
    let found: { node: any; pos: number; editor: typeof editor } | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'figure' && node.attrs.uid === target.uid && pendingRPlotOf(node.attrs.rPlotTask)?.id === job.id) { found = { node, pos, editor }; return false; }
    });
    return found;
  }
  const walk = (node: any): any => {
    if (node.type === 'figure' && node.attrs?.uid === target.uid && pendingRPlotOf(node.attrs.rPlotTask)?.id === job.id) return { node };
    for (const child of node.content ?? []) { const found = walk(child); if (found) return found; }
    return null;
  };
  return walk(useStore.getState().doc[target.key]);
}

/** 每次按 uid 查找节点，不使用绘图开始时的段号或位置；自动回填不移动光标。 */
function patchTarget(job: RPlotJob, attrs: Record<string, unknown>): boolean {
  const found = targetNode(job);
  if (!found || !job.target) return false;
  if (found.editor) {
    found.editor.view.dispatch(found.editor.state.tr.setNodeMarkup(found.pos, undefined, { ...found.node.attrs, ...attrs }).setMeta('addToHistory', false));
  } else {
    const uid = job.target.uid;
    const replace = (n: any): any => n.type === 'figure' && n.attrs?.uid === uid
      ? { ...n, attrs: { ...n.attrs, ...attrs } }
      : n.content ? { ...n, content: n.content.map(replace) } : n;
    useStore.getState().setRich(job.target.key, replace(useStore.getState().doc[job.target.key]) as RichDoc);
  }
  return true;
}

function saveState(job: RPlotJob, state: PendingRPlot['state'], error?: string) {
  patchTarget(job, { rPlotTask: JSON.stringify({ id: job.id, state, createdAt: job.createdAt, draft: job.draft, ...(error ? { error } : {}) } satisfies PendingRPlot) });
}

async function applyResult(id: string) {
  const job = getJob(id);
  if (!job?.target || job.phase !== 'ready' || !job.result || applying.has(id) || useStore.getState().doc.id !== job.docId) return;
  applying.add(id);
  try {
    if (!targetNode(job)) { setJob(id, { phase: 'cancelled', status: '占位符已删除，结果未插入', result: undefined }); return; }
    const attrs = await saveRPlot(job.result, job.docId, job.draft.width);
    if (getJob(id)?.phase !== 'ready') return;
    if (useStore.getState().doc.id !== job.docId) return;
    const current = targetNode(job);
    if (!current) { setJob(id, { phase: 'cancelled', status: '占位符已删除，结果未插入', result: undefined }); return; }
    patchTarget(job, { ...attrs, width: current.node.attrs.width ?? job.draft.width, rPlotTask: '' });
    setJob(id, { phase: 'completed', status: 'R 图已生成并放入原位置' });
  } catch (e) {
    // 切换了工程时先保留结果，回到原工程后再放进去。
    if (useStore.getState().doc.id !== job.docId) return;
    setJob(id, { phase: 'error', error: (e as Error).message, status: 'R 图回填失败' });
    saveState(job, 'failed', (e as Error).message);
  } finally { applying.delete(id); }
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    for (;;) {
      const job = Object.values(useRPlotJobs.getState().jobs).find((j) => j.phase === 'queued');
      if (!job) break;
      if (isRPlotRendering()) { setJob(job.id, { status: '等待另一个 R 绘图任务结束…' }); await new Promise((r) => setTimeout(r, 250)); continue; }
      const controller = new AbortController(); controllers.set(job.id, controller);
      setJob(job.id, { phase: 'running', startedAt: Date.now(), status: '正在准备 R 绘图…' });
      try {
        const d = job.draft;
        const result = await createRPlot(d.code, { width: d.width / 2.54, height: d.height / 2.54, pointsize: d.fontMode === 'auto' ? undefined : d.pointsize, seed: d.seed,
          files: rPlotDataFiles(d.dataFiles), timeout: d.timeout, signal: controller.signal,
          progress: (status) => { if (getJob(job.id)?.phase === 'running') setJob(job.id, { status }); },
        });
        if (getJob(job.id)?.phase !== 'running') continue;
        setJob(job.id, { result, phase: 'ready', status: '绘图完成' });
        await applyResult(job.id);
      } catch (e) {
        if (controller.signal.aborted || !getJob(job.id)) continue;
        setJob(job.id, { phase: 'error', error: (e as Error).message, status: 'R 绘图失败' });
        saveState(getJob(job.id)!, 'failed', (e as Error).message);
      } finally { controllers.delete(job.id); }
    }
  } finally { pumping = false; }
}

export function startRPlotJob(draft: RPlotDraft, docId: string): string {
  if (!draft.code.trim()) throw new Error('请先输入 R 绘图代码');
  if (![draft.width, draft.height].every((n) => Number.isFinite(n) && n >= 2.54 && n <= 50.8) || !Number.isFinite(draft.pointsize) || draft.pointsize < 4 || draft.pointsize > 72) throw new Error('画布宽高需在 2.54–50.8 cm 之间，字号需在 4–72 pt 之间');
  if (!Number.isInteger(draft.seed) || draft.seed < 0 || draft.seed > 2147483647) throw new Error('随机种子需为 0–2147483647 的整数');
  if (draft.timeout !== undefined && (!Number.isFinite(draft.timeout) || draft.timeout <= 0)) throw new Error('R 绘图运行时限需为正数');
  const id = crypto.randomUUID();
  useRPlotJobs.setState((s) => ({ jobs: { ...s.jobs, [id]: { id, docId, draft, phase: 'queued', createdAt: Date.now(), status: '已加入后台绘图队列…' } } }));
  void pump();
  return id;
}

export function pendingFigureAttrs(id: string, draft: RPlotDraft, initial: Record<string, unknown> = {}) {
  return { ...initial, uid: initial.uid || `rplot-${crypto.randomUUID()}`, width: initial.width ?? draft.width,
    caption: draft.caption, captionEn: draft.captionEn, label: draft.label,
    rPlotTask: JSON.stringify({ id, state: 'pending', createdAt: getJob(id)?.createdAt ?? Date.now(), draft } satisfies PendingRPlot),
  };
}

export function attachRPlotJob(id: string, target: RPlotTarget) {
  const job = getJob(id);
  if (!job || job.docId !== target.docId) throw new Error('后台绘图任务与当前工程不一致');
  setJob(id, { target });
  if (job.phase === 'ready') void applyResult(id);
  else if (job.phase === 'error') saveState(getJob(id)!, 'failed', job.error);
  else if (job.phase === 'cancelled') saveState(getJob(id)!, 'cancelled');
}

export function cancelRPlotJob(id: string) {
  const job = getJob(id);
  if (!job || job.phase === 'completed') return;
  setJob(id, { phase: 'cancelled', status: 'R 绘图已取消' });
  controllers.get(id)?.abort();
  saveState(job, 'cancelled');
}

export function releaseRPlotPreview(id: string) {
  const job = getJob(id); if (!job || job.target) return;
  cancelRPlotJob(id);
  useRPlotJobs.setState((s) => { const jobs = { ...s.jobs }; delete jobs[id]; return { jobs }; });
}

export function waitRPlotJob(id: string, signal?: AbortSignal, progress: (s: string) => void = () => {}): Promise<RPlotJob> {
  return new Promise((resolve, reject) => {
    let off = () => {};
    const cleanup = () => { off(); signal?.removeEventListener('abort', abort); };
    const abort = () => { cancelRPlotJob(id); cleanup(); reject(new Error('R 绘图已取消')); };
    const check = () => {
      const job = getJob(id);
      if (!job) { cleanup(); reject(new Error('R 绘图任务不存在')); return; }
      progress(job.status);
      if (job.phase === 'completed' || (job.phase === 'ready' && useStore.getState().doc.id !== job.docId)) { cleanup(); resolve(job); }
      else if (job.phase === 'error' || job.phase === 'cancelled') { cleanup(); reject(new Error(job.error ?? job.status)); }
    };
    off = useRPlotJobs.subscribe(check);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort(); else check();
  });
}

export function retryRPlotJob(pending: PendingRPlot, target: RPlotTarget) {
  cancelRPlotJob(pending.id);
  const id = startRPlotJob(pending.draft, target.docId);
  const replacement = getJob(id)!;
  // 先换占位节点的任务令牌，旧任务的迟到结果不能覆盖它。
  patchTarget({ ...replacement, id: pending.id, target }, { rPlotTask: JSON.stringify({ ...pending, id, state: 'pending', createdAt: replacement.createdAt, error: undefined }) });
  attachRPlotJob(id, target);
  return id;
}

// 切回原工程时再放入已完成的图，不写入正在编辑的另一个工程。
let previousDoc = '';
useStore.subscribe((s) => {
  if (s.doc.id === previousDoc) return;
  previousDoc = s.doc.id;
  queueMicrotask(() => { for (const job of Object.values(useRPlotJobs.getState().jobs)) if (job.phase === 'ready' && job.target?.docId === s.doc.id) void applyResult(job.id); });
});
