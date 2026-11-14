import { useEffect, useId, useState } from 'react';
import type { PendingRPlot } from '../rplot/files';
import { useRPlotJobs, type RPlotJob } from '../rplot/jobs';
import { RPlotDownloadProgress } from './RPlotDownloadProgress';
import { t } from '../i18n';

/** 编辑器占位和绘图窗口共用一套真实进度；动画仅作等待提示，不伪造绘图百分比。 */
export function RPlotPending({ pending, onInspect, onRetry, onCancel, showDownload = true }: { pending: PendingRPlot; onInspect?: () => void; onRetry?: () => void; onCancel?: () => void; showDownload?: boolean }) {
  const job = useRPlotJobs((s) => s.jobs[pending.id] as RPlotJob | undefined);
  const phase = job?.phase ?? (pending.state === 'pending' ? 'paused' : pending.state === 'failed' ? 'error' : 'cancelled');
  const active = ['queued', 'running', 'ready'].includes(phase);
  const [, tick] = useState(0);
  useEffect(() => { if (!active) return; const id = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(id); }, [active]);
  const grid = useId().replace(/:/g, '');
  const secs = Math.max(0, Math.floor((Date.now() - (job?.createdAt ?? pending.createdAt)) / 1000));
  const status = job?.status ?? (phase === 'paused' ? t('上次绘图任务已暂停，可继续生成') : phase === 'error' ? t('R 绘图失败') : t('R 绘图已取消'));
  return <div className={`rplot-pending is-${phase} ${active ? 'is-animating' : ''}`} style={{ aspectRatio: `${pending.draft.width} / ${pending.draft.height}` }} role="status" aria-label={status}>
    <div className="rplot-aurora" aria-hidden="true" />
    <svg className="rplot-motion" viewBox="0 0 480 280" aria-hidden="true">
      <defs><pattern id={grid} width="30" height="30" patternUnits="userSpaceOnUse"><path d="M 30 0 L 0 0 0 30" fill="none" className="rplot-grid-line" /></pattern></defs>
      <rect width="480" height="280" fill={`url(#${grid})`} />
      <path className="rplot-axis-line" d="M 48 38 V 220 H 435" />
      <path className="rplot-curve rplot-curve-shadow" d="M 48 195 C 103 195 104 115 159 142 S 243 188 279 106 S 370 130 435 55" />
      <path className="rplot-curve" d="M 48 195 C 103 195 104 115 159 142 S 243 188 279 106 S 370 130 435 55" />
      {[['48', '195'], ['159', '142'], ['279', '106'], ['435', '55']].map(([cx, cy], i) => <circle key={cx} className="rplot-motion-dot" cx={cx} cy={cy} r="4" style={{ animationDelay: `${i * 0.35}s` }} />)}
    </svg>
    <div className="rplot-scan" aria-hidden="true" />
    <div className="rplot-pending-content">
      <span className="rplot-engine-badge">R/Wasm <span>→</span> CeTZ</span>
      <strong>{phase === 'error' ? t('绘图没有完成') : phase === 'cancelled' ? t('已取消生成') : phase === 'paused' ? t('等待恢复绘图') : t('正在后台绘图')}</strong>
      <span className="rplot-pending-status">{status}</span>
      {active && <span className="rplot-pending-time">{t('已等待 {{s}} 秒，可以继续编辑', { s: secs })}</span>}
      {active && showDownload && <RPlotDownloadProgress />}
      {(job?.error || pending.error) && <span className="rplot-pending-error">{job?.error ?? pending.error}</span>}
      <div className="rplot-pending-actions">
        {onInspect && <button type="button" onClick={onInspect}>{t('查看代码与进度')}</button>}
        {onRetry && !active && <button type="button" onClick={onRetry}>{phase === 'paused' ? t('继续生成') : t('重新生成')}</button>}
        {onCancel && active && <button type="button" onClick={onCancel}>{t('取消生成')}</button>}
      </div>
    </div>
  </div>;
}
