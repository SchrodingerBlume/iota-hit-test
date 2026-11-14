import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Input, Spinner } from '@fluentui/react-components';
import type { Editor } from '@tiptap/core';
import { useStore, type RichKey } from '../model/store';
import { pendingRPlotOf, rPlotOf, rPlotHeight, type RPlotDraft } from '../rplot/files';
import { saveRPlot } from '../rplot/render';
import { attachRPlotJob, cancelRPlotJob, pendingFigureAttrs, releaseRPlotPreview, startRPlotJob, useRPlotJobs } from '../rplot/jobs';
import { RPlotPending } from './RPlotPending';
import { RPlotDownloadProgress } from './RPlotDownloadProgress';
import { t } from '../i18n';
import { parseLength } from '../model/length';
import { RCodeEditor } from './RCodeEditor';
import { prepareRLanguageService, stopRLanguageService, useRLanguageService } from '../rplot/languageService';

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
  const displayWidth = parseLength(initial?.width, 'cm', ['cm', 'mm', 'in', 'pt']);
  const displayCm = displayWidth ? displayWidth.value * ({ cm: 1, mm: .1, in: 2.54, pt: 2.54 / 72 } as Record<string, number>)[displayWidth.unit] : undefined;
  const [width, setWidth] = useState(pending?.draft.width ?? displayCm ?? (saved ? Math.round(saved.width * 254) / 100 : 14));
  const [height, setHeight] = useState(pending?.draft.height ?? (saved ? Math.round(saved.height / saved.width * (displayCm ?? saved.width * 2.54) * 100) / 100 : 9));
  const [pointsize, setPointsize] = useState(pending?.draft.pointsize ?? saved?.pointsize ?? 10.5);
  const [fontMode, setFontMode] = useState<'auto' | 'manual'>(pending ? pending.draft.fontMode ?? 'manual' : saved ? saved.fontMode ?? 'manual' : 'auto');
  const [languageEnabled, setLanguageEnabled] = useState(() => { try { return localStorage.getItem('iota-r-lsp-enabled') === '1'; } catch { return false; } });
  const language = useRLanguageService();
  const toggleLanguage = () => {
    const enabled = !languageEnabled; setLanguageEnabled(enabled);
    try { localStorage.setItem('iota-r-lsp-enabled', enabled ? '1' : '0'); } catch { /* 本次窗口仍可使用 */ }
    if (!enabled) stopRLanguageService();
  };
  useEffect(() => { if (languageEnabled) void prepareRLanguageService().catch(() => {}); }, [languageEnabled]);
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
  const key = JSON.stringify([code, width, height, fontMode, pointsize, seed, files.map((f) => [f.name, f.size, f.lastModified])]);
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
    return { code, width, height, pointsize, fontMode, seed, caption, captionEn, label, ...(dataFiles.length ? { dataFiles } : {}) };
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
      onApply({ ...attrs, caption, captionEn, label }); onClose();
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
            <label>{t('默认字号')}<select aria-label={t('R 字号模式')} value={fontMode} disabled={busy} onChange={(e) => setFontMode(e.target.value as 'auto' | 'manual')}><option value="auto">{t('自动（五号优先）')}</option><option value="manual">{t('指定默认 pt')}</option></select></label>
            {fontMode === 'manual' && <label>{t('字号（pt）')}<Input aria-label={t('R 手动字号（pt）')} type="number" min={4} max={72} step={0.1} value={String(pointsize)} onChange={(_, d) => setPointsize(Number(d.value))} disabled={busy} /></label>}
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
          <div className="rplot-language-tools"><span className="muted">{t('R 语法高亮 · Tab 缩进 · 括号匹配 · Ctrl+Space 补全')}</span><Button size="small" disabled={busy && !languageEnabled} onClick={toggleLanguage}>{languageEnabled ? t('关闭 R LSP') : t('下载并启用 R LSP')}</Button>{languageEnabled && language.phase === 'error' && <Button size="small" onClick={() => void prepareRLanguageService().catch(() => {})}>{t('重试语言服务')}</Button>}</div>
          {languageEnabled && <div className="rplot-language-status" role="status">{language.phase === 'loading' && <Spinner size="extra-tiny" />}<span>{language.status || t('正在准备可选 R 语言服务…')}</span>{language.error && <span className="rplot-error">{language.error}</span>}</div>}
          <RPlotDownloadProgress />
          <div className="rplot-work">
            <RCodeEditor value={code} disabled={busy} onChange={setCode} languageEnabled={languageEnabled} />
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
          <p className="field-hint">{t('自动先用五号 10.5pt，检测到文字拥挤才依次尝试小五 9pt、六号 7.5pt；代码中显式指定的字号不取整。画布宽度应等于最终图宽，改图宽请重新排图。')}</p>
          {result?.plot.fontReport && <p className="field-hint">{result.plot.fontMode === 'auto' ? t('自动默认字号：{{size}}pt（显式字号保持原值）', { size: result.plot.pointsize }) : t('默认字号：{{size}}pt；代码中的单独字号优先', { size: result.plot.pointsize })}{!!result.plot.fontReport.sizes?.length && t('；R 文字字号：{{sizes}}pt', { sizes: result.plot.fontReport.sizes.slice(0, 12).join(' / ') + (result.plot.fontReport.sizes.length > 12 ? ' …' : '') })}{!!(result.plot.fontReport.overlaps || result.plot.fontReport.clipped) && t('；仍检测到部分标签重叠或裁切，请调整布局、标签或图宽。')}</p>}
          {result?.plot.crop && <p className="field-hint">{t('已自动去掉上下空白，输出高度 {{height}}cm；图宽和文字大小不变。', { height: (rPlotHeight(result.plot) * 2.54).toFixed(2) })}</p>}
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
