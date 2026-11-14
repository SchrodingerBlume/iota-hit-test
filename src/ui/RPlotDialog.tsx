import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Input, Spinner } from '@fluentui/react-components';
import type { Editor } from '@tiptap/core';
import { useStore, type RichKey } from '../model/store';
import { pendingRPlotOf, rPlotOf, type RPlotDraft } from '../rplot/files';
import { saveRPlot } from '../rplot/render';
import { attachRPlotJob, cancelRPlotJob, pendingFigureAttrs, releaseRPlotPreview, startRPlotJob, useRPlotJobs } from '../rplot/jobs';
import { RPlotPending } from './RPlotPending';
import { RPlotDownloadProgress } from './RPlotDownloadProgress';
import { t } from '../i18n';

const EXAMPLES = {
  scatter: `plot(mtcars$wt, mtcars$mpg, pch = 19, col = "#166183",
     xlab = "Weight (1000 lbs)", ylab = "Miles per gallon")
abline(lm(mpg ~ wt, data = mtcars), col = "#d55e00", lwd = 2)`,
  curve: `x <- seq(0, 2 * pi, length.out = 200)
plot(x, sin(x), type = "l", lwd = 2, col = "#166183",
     xlab = "x", ylab = "f(x)", ylim = c(-1, 1))
lines(x, cos(x), lwd = 2, lty = 2, col = "#d55e00")
legend("topright", c("sin(x)", "cos(x)"),
       col = c("#166183", "#d55e00"), lty = c(1, 2), bty = "n")`,
  ggplot: `library(ggplot2)
ggplot(mtcars, aes(wt, mpg, colour = factor(cyl))) +
  geom_point(size = 2) +
  labs(x = "Weight (1000 lbs)", y = "Miles per gallon", colour = "Cylinders") +
  theme_classic(base_family = "TeX Gyre Termes")`,
};

export function RPlotDialog({ initial, preview, onApply, onBackground, onClose }: { initial?: Record<string, unknown>; preview?: string | null; onApply: (attrs: Record<string, unknown>) => void; onBackground?: (draft: RPlotDraft, jobId: string) => void; onClose: () => void }) {
  const saved = rPlotOf(initial?.rPlot);
  const pending = pendingRPlotOf(initial?.rPlotTask);
  const [code, setCode] = useState(pending?.draft.code ?? saved?.code ?? EXAMPLES.scatter);
  const [width, setWidth] = useState(pending?.draft.width ?? (saved ? Math.round(saved.width * 254) / 100 : 14));
  const [height, setHeight] = useState(pending?.draft.height ?? (saved ? Math.round(saved.height * 254) / 100 : 9));
  const [pointsize, setPointsize] = useState(pending?.draft.pointsize ?? saved?.pointsize ?? 11);
  const [seed, setSeed] = useState(pending?.draft.seed ?? saved?.seed ?? 1);
  const [caption, setCaption] = useState(String(initial?.caption ?? ''));
  const [captionEn, setCaptionEn] = useState(String(initial?.captionEn ?? ''));
  const [label, setLabel] = useState(String(initial?.label ?? ''));
  const [files, setFiles] = useState<File[]>(() => (pending?.draft.dataFiles ?? saved?.dataFiles ?? []).map((f) => new File([Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0))], f.name)));
  const [preparing, setPreparing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [jobId, setJobId] = useState<string | null>(pending?.id ?? null);
  const job = useRPlotJobs((s) => jobId ? s.jobs[jobId] : undefined);
  const busy = preparing || applying || job?.phase === 'queued' || job?.phase === 'running';
  const status = preparing ? t('正在准备绘图数据…') : job?.status ?? '';
  const [error, setError] = useState('');
  const result = job?.result;
  const [url, setUrl] = useState<string | null>(preview ?? null);
  const jobRef = useRef(jobId);
  jobRef.current = jobId;
  const [docId] = useState(() => useStore.getState().doc.id);
  const key = JSON.stringify([code, width, height, pointsize, seed, files.map((f) => [f.name, f.size, f.lastModified])]);
  const [resultKey, setResultKey] = useState(key);
  // 已挂到占位节点的任务不受窗口卸载影响；未插入的预览退出时才释放。
  useEffect(() => () => { if (jobRef.current) releaseRPlotPreview(jobRef.current); }, []);
  useEffect(() => {
    if (!result) return;
    const value = URL.createObjectURL(result.png); setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [result]);
  const draft = async (): Promise<RPlotDraft> => {
    const dataFiles = await Promise.all(files.map(async (f) => {
      const bytes = new Uint8Array(await f.arrayBuffer()); let binary = '';
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return { name: f.name, data: btoa(binary) };
    }));
    return { code, width, height, pointsize, seed, caption, captionEn, label, ...(dataFiles.length ? { dataFiles } : {}) };
  };
  const start = async () => {
    const request = await draft();
    if (jobId && !job?.target) releaseRPlotPreview(jobId);
    const id = startRPlotJob(request, docId); setJobId(id); setResultKey(key);
    return { request, id };
  };
  const run = async () => {
    if (busy) return;
    setPreparing(true); setError('');
    try {
      await start();
    } catch (e) { setError((e as Error).message); }
    finally { setPreparing(false); }
  };
  const background = async () => {
    if (!onBackground || preparing || applying) return;
    setPreparing(true); setError('');
    try {
      const existing = job && !['error', 'cancelled'].includes(job.phase) && key === resultKey;
      const { request, id } = existing ? { request: { ...job.draft, caption, captionEn, label }, id: job.id } : await start();
      onBackground(request, id); onClose();
    } catch (e) { setError((e as Error).message); }
    finally { setPreparing(false); }
  };
  const close = () => {
    if (busy && onBackground) { void background(); return; }
    onClose();
  };
  const apply = async () => {
    if (!result || key !== resultKey || busy) return;
    if (job?.target) { onApply({ caption, captionEn, label }); onClose(); return; }
    setApplying(true); setError('');
    try {
      const attrs = await saveRPlot(result, docId, width);
      onApply({ ...attrs, ...(initial?.width ? { width: initial.width } : {}), caption, captionEn, label }); onClose();
    } catch (e) { setError((e as Error).message); }
    finally { setApplying(false); }
  };
  return <Dialog open onOpenChange={(_, d) => { if (!d.open) close(); }}>
    <DialogSurface className="rplot-dialog">
      <DialogBody>
        <DialogTitle>{saved ? t('编辑 R 绘图') : t('插入 R 绘图')}</DialogTitle>
        <DialogContent>
          <div className="rplot-options">
            <label>{t('宽度（cm）')}<Input type="number" min={2.54} max={50.8} value={String(width)} onChange={(_, d) => setWidth(Number(d.value))} disabled={busy} /></label>
            <label>{t('高度（cm）')}<Input type="number" min={2.54} max={50.8} value={String(height)} onChange={(_, d) => setHeight(Number(d.value))} disabled={busy} /></label>
            <label>{t('字号（pt）')}<Input type="number" min={4} max={72} value={String(pointsize)} onChange={(_, d) => setPointsize(Number(d.value))} disabled={busy} /></label>
            <label>{t('随机种子')}<Input type="number" value={String(seed)} onChange={(_, d) => setSeed(Number(d.value))} disabled={busy} /></label>
          </div>
          <div className="rplot-examples">
            <span className="muted">{t('示例：')}</span>
            <Button size="small" disabled={busy} onClick={() => setCode(EXAMPLES.scatter)}>{t('散点与回归')}</Button>
            <Button size="small" disabled={busy} onClick={() => setCode(EXAMPLES.curve)}>{t('函数曲线')}</Button>
            <Button size="small" disabled={busy} onClick={() => setCode(EXAMPLES.ggplot)}>ggplot2</Button>
            <label className="btn">{t('添加数据文件')}<input type="file" accept=".csv,.tsv,.txt,.json,.rds,.RData" hidden multiple disabled={busy} onChange={(e) => { const added = Array.from(e.target.files ?? []); setFiles([...files.filter((f) => !added.some((a) => a.name === f.name)), ...added]); }} /></label>
          </div>
          {!!files.length && <div className="rplot-files">{files.map((f) => <button type="button" key={f.name} disabled={busy} title={t('移除')} onClick={() => setFiles(files.filter((v) => v !== f))}>/data/{f.name} ×</button>)}</div>}
          <RPlotDownloadProgress />
          <div className="rplot-work">
            <textarea className="rplot-code" aria-label={t('R 绘图代码')} spellCheck={false} value={code} disabled={busy} onChange={(e) => setCode(e.target.value)} />
            <div className="rplot-preview">{job && ['queued', 'running', 'error', 'cancelled'].includes(job.phase)
              ? <RPlotPending pending={{ id: job.id, state: 'pending', createdAt: job.createdAt, draft: job.draft }} showDownload={false} />
              : url ? <img src={url} alt={t('R 绘图预览')} /> : <span className="muted">{t('运行后在这里预览')}</span>}</div>
          </div>
          <div className="rplot-caption">
            <Input placeholder={t('图题')} aria-label={t('图题')} value={caption} onChange={(_, d) => setCaption(d.value)} />
            <Input placeholder={t('英文图题')} aria-label={t('英文图题')} value={captionEn} onChange={(_, d) => setCaptionEn(d.value)} />
            <Input placeholder="fig:example" aria-label={t('引用标签')} value={label} onChange={(_, d) => setLabel(d.value)} />
          </div>
          <p className="field-hint">{t('直接写 plot()、grid 或 ggplot2 代码，无需打开图形设备；数据文件从 /data/ 读取。')}<span className="muted"> webR 0.6.1 · cetzDevice 0.5.3.1</span></p>
          {!!status && <div className="rplot-status" role="status">{busy && <Spinner size="extra-tiny" />}{status}</div>}
          {(error || job?.error) && <p className="rplot-error" role="alert">{error || job?.error}</p>}
          {result?.stdout && <pre className="rplot-log">{result.stdout}</pre>}
          {result && key !== resultKey && <p className="field-hint">{t('代码或画布设置已修改，请重新运行后再插入。')}</p>}
        </DialogContent>
        <DialogActions>
          {busy ? <Button disabled={!jobId || applying} onClick={() => { if (jobId) cancelRPlotJob(jobId); }}>{t('停止')}</Button> : <Button disabled={!code.trim()} onClick={() => void run()}>{t('运行预览')}</Button>}
          {busy && onBackground
            ? <Button appearance="primary" disabled={preparing || applying} onClick={() => void background()}>{t('后台生成，继续编辑')}</Button>
            : <Button appearance="primary" disabled={busy || !result || key !== resultKey} onClick={() => void apply()}>{job?.target ? t('关闭') : saved || pending ? t('应用修改') : t('插入')}</Button>}
          {!busy && onBackground && (!result || key !== resultKey) && <Button disabled={!code.trim()} onClick={() => void background()}>{t('后台生成并插入')}</Button>}
          <Button onClick={() => { if (jobId && busy) cancelRPlotJob(jobId); onClose(); }}>{busy ? t('取消生成') : t('取消')}</Button>
        </DialogActions>
      </DialogBody>
    </DialogSurface>
  </Dialog>;
}

/** 窗口打开时记录选区书签，并随事务映射；后台占位不会受其他任务回填导致的位置移动影响。 */
export function RPlotInsertDialog({ editor, richKey, onClose, onInserted }: { editor: Editor; richKey: RichKey; onClose: () => void; onInserted?: () => void }) {
  const [docId] = useState(() => useStore.getState().doc.id);
  const bookmark = useRef(editor.state.selection.getBookmark());
  useEffect(() => {
    const map = ({ transaction }: { transaction: Editor['state']['tr'] }) => { bookmark.current = bookmark.current.map(transaction.mapping); };
    editor.on('transaction', map);
    return () => { editor.off('transaction', map); };
  }, [editor]);
  const insert = (attrs: Record<string, unknown>) => {
    if (editor.isDestroyed || useStore.getState().doc.id !== docId) throw new Error('编辑器或工程已经切换，请重新打开 R 绘图窗口');
    const tr = editor.state.tr.setSelection(bookmark.current.resolve(editor.state.doc)).replaceSelectionWith(editor.schema.nodes.figure.create(attrs));
    editor.view.dispatch(tr.setMeta('undoLabel', '插入 R 绘图'));
    onInserted?.();
  };
  return <RPlotDialog onClose={onClose} onApply={insert} onBackground={(draft, id) => {
    const attrs = pendingFigureAttrs(id, draft);
    insert(attrs);
    attachRPlotJob(id, { docId, key: richKey, uid: String(attrs.uid) });
  }} />;
}
