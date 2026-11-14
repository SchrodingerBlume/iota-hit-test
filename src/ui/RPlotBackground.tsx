import { useEffect, useState } from 'react';
import { useCompileState } from '../compiler/client';
import { useStore } from '../model/store';
import { useRPlotLoad } from '../rplot/assets';
import { cancelRPlotJob, useRPlotJobs } from '../rplot/jobs';
import { t } from '../i18n';
import { useRPackageLoad } from '../rplot/packages';
import { RPlotDownloadProgress } from './RPlotDownloadProgress';

/** 首份正文已排出来、界面空闲后才开始下载 R；全程不占住编辑器或弹模态窗口。 */
export function RPlotBackground() {
  const load = useRPlotLoad();
  const editorReady = useCompileState((s) => s.status === 'ready' && s.compileCount > 0 && !s.compiling);
  const editing = useStore((s) => s.loaded && s.view === 'editor');
  const jobs = useRPlotJobs((s) => s.jobs);
  const packages = useRPackageLoad();
  const [open, setOpen] = useState(false);
  const [showReady, setShowReady] = useState(false);
  const warm = () => { void import('../rplot/runtime').then((m) => m.prepareRPlotRuntime()).catch(() => {}); };
  useEffect(() => {
    if (!editorReady || !editing || load.phase !== 'idle') return;
    let idle = 0;
    const timer = window.setTimeout(() => {
      if (window.requestIdleCallback) idle = window.requestIdleCallback(warm, { timeout: 4000 });
      else warm();
    }, 1500);
    return () => { clearTimeout(timer); if (idle) window.cancelIdleCallback(idle); };
  }, [editorReady, editing, load.phase]);
  useEffect(() => {
    if (load.phase !== 'ready') return;
    setShowReady(true);
    const timer = setTimeout(() => setShowReady(false), 4000);
    return () => clearTimeout(timer);
  }, [load.phase]);
  const active = Object.values(jobs).filter((j) => j.target && ['queued', 'running', 'ready'].includes(j.phase));
  const downloading = ['downloading', 'initializing'].includes(load.phase);
  if (!downloading && !packages.active && load.phase !== 'error' && !active.length && !showReady) return null;
  return <aside className={`rplot-background ${open ? 'is-open' : ''}`} aria-label={t('R 绘图后台任务')}>
    <button type="button" className="rplot-background-head" onClick={() => setOpen(!open)} aria-expanded={open}>
      <span className={`rplot-background-orb ${downloading || packages.active || active.length ? 'is-busy' : ''}`} aria-hidden="true">R</span>
      <span>{packages.active ? t('正在安装 R 包：{{name}}', { name: packages.name }) : active.length ? t('{{n}} 个后台绘图任务', { n: active.length }) : load.phase === 'ready' ? t('R 绘图已就绪') : load.status}</span>
      {downloading && <small>{load.done}/{load.total} · {(load.bytes / 1048576).toFixed(1)} MB</small>}
    </button>
    {open && <div className="rplot-background-body">
      {(downloading || packages.active) && <div className="rplot-background-download"><RPlotDownloadProgress /><small>{t('组件在后台准备，可以继续编辑。')}</small></div>}
      {load.phase === 'error' && <div className="rplot-background-error"><span>{load.error}</span><button type="button" onClick={warm}>{t('重试下载')}</button></div>}
      {active.map((job) => <div className="rplot-background-job" key={job.id}>
        <strong>{job.draft.caption || t('R 绘图')}</strong><span>{job.status}</span>
        <button type="button" onClick={() => cancelRPlotJob(job.id)}>{t('取消生成')}</button>
      </div>)}
      {!downloading && load.phase === 'ready' && !active.length && <span>{t('R 组件已准备好，打开绘图窗口即可使用。')}</span>}
    </div>}
  </aside>;
}
