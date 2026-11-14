import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Input, Spinner } from '@fluentui/react-components';
import { useStore } from '../model/store';
import { rPlotOf } from '../rplot/files';
import { createRPlot, saveRPlot, type RenderedRPlot } from '../rplot/render';
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

export function RPlotDialog({ initial, preview, onApply, onClose }: { initial?: Record<string, unknown>; preview?: string | null; onApply: (attrs: Record<string, unknown>) => void; onClose: () => void }) {
  const saved = rPlotOf(initial?.rPlot);
  const [code, setCode] = useState(saved?.code ?? EXAMPLES.scatter);
  const [width, setWidth] = useState(saved ? Math.round(saved.width * 254) / 100 : 14);
  const [height, setHeight] = useState(saved ? Math.round(saved.height * 254) / 100 : 9);
  const [pointsize, setPointsize] = useState(saved?.pointsize ?? 11);
  const [seed, setSeed] = useState(saved?.seed ?? 1);
  const [caption, setCaption] = useState(String(initial?.caption ?? ''));
  const [captionEn, setCaptionEn] = useState(String(initial?.captionEn ?? ''));
  const [label, setLabel] = useState(String(initial?.label ?? ''));
  const [files, setFiles] = useState<File[]>(() => (saved?.dataFiles ?? []).map((f) => new File([Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0))], f.name)));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<RenderedRPlot | null>(null);
  const [resultKey, setResultKey] = useState('');
  const [url, setUrl] = useState<string | null>(preview ?? null);
  const [, tick] = useState(0);
  const started = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const [docId] = useState(() => useStore.getState().doc.id);
  const key = JSON.stringify([code, width, height, pointsize, seed, files.map((f) => [f.name, f.size, f.lastModified])]);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [busy]);
  useEffect(() => {
    if (!result) return;
    const value = URL.createObjectURL(result.png); setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [result]);
  const run = async () => {
    if (busy) return;
    controller.current = new AbortController(); started.current = Date.now();
    setBusy(true); setError(''); setStatus(t('正在启动 R 绘图…'));
    try {
      const data = await Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
      const plot = await createRPlot(code, { width: width / 2.54, height: height / 2.54, pointsize, seed, files: data, signal: controller.current.signal, progress: setStatus });
      setResult(plot); setResultKey(key); setStatus(t('绘图完成'));
    } catch (e) { setError((e as Error).message); setStatus(''); }
    finally { setBusy(false); controller.current = null; }
  };
  const apply = async () => {
    if (!result || key !== resultKey || busy) return;
    setBusy(true); setError('');
    try {
      const attrs = await saveRPlot(result, docId, width);
      onApply({ ...attrs, ...(initial?.width ? { width: initial.width } : {}), caption, captionEn, label }); onClose();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={(_, d) => { if (!d.open) onClose(); }}>
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
          <div className="rplot-work">
            <textarea className="rplot-code" aria-label={t('R 绘图代码')} spellCheck={false} value={code} disabled={busy} onChange={(e) => setCode(e.target.value)} />
            <div className="rplot-preview">{url ? <img src={url} alt={t('R 绘图预览')} /> : <span className="muted">{t('运行后在这里预览')}</span>}</div>
          </div>
          <div className="rplot-caption">
            <Input placeholder={t('图题')} aria-label={t('图题')} value={caption} onChange={(_, d) => setCaption(d.value)} />
            <Input placeholder={t('英文图题')} aria-label={t('英文图题')} value={captionEn} onChange={(_, d) => setCaptionEn(d.value)} />
            <Input placeholder="fig:example" aria-label={t('引用标签')} value={label} onChange={(_, d) => setLabel(d.value)} />
          </div>
          <p className="field-hint">{t('直接写 plot()、grid 或 ggplot2 代码，无需打开图形设备；数据文件从 /data/ 读取。')}<span className="muted"> webR 0.6.1 · cetzDevice 0.5.3.1</span></p>
          {!!status && <div className="rplot-status" role="status">{busy && <Spinner size="extra-tiny" />}{status}{busy ? `（${Math.round((Date.now() - started.current) / 1000)} 秒）` : ''}</div>}
          {error && <p className="rplot-error" role="alert">{error}</p>}
          {result?.stdout && <pre className="rplot-log">{result.stdout}</pre>}
          {result && key !== resultKey && <p className="field-hint">{t('代码或画布设置已修改，请重新运行后再插入。')}</p>}
        </DialogContent>
        <DialogActions>
          {busy ? <Button onClick={() => controller.current?.abort()}>{t('停止')}</Button> : <Button onClick={() => void run()}>{t('运行预览')}</Button>}
          <Button appearance="primary" disabled={busy || !result || key !== resultKey} onClick={() => void apply()}>{saved ? t('应用修改') : t('插入')}</Button>
          <Button onClick={onClose}>{t('取消')}</Button>
        </DialogActions>
      </DialogBody>
    </DialogSurface>
  </Dialog>;
}
