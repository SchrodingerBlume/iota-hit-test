import { useRPlotLoad } from '../rplot/assets';
import { useRPackageLoad } from '../rplot/packages';
import { t } from '../i18n';

const mb = (n: number) => (n / 1048576).toFixed(1);
/** 窗口、原位占位和右下角共用一份下载状态。解包阶段单独显示，避免“走到100%后卡住”。 */
export function RPlotDownloadProgress() {
  const assets = useRPlotLoad(), pkg = useRPackageLoad();
  const components = ['downloading', 'initializing'].includes(assets.phase);
  if (!components && !pkg.active) return null;
  const label = components ? assets.status : pkg.phase === 'index' ? t('正在读取 R/Wasm 包仓库索引…') : pkg.phase === 'install' ? t('已下载，正在解包安装…') : t('正在下载 R 扩展包…');
  const ratio = components ? (assets.phase === 'initializing' ? null : assets.done / Math.max(1, assets.total)) : pkg.phase === 'download' && pkg.total ? Math.min(1, pkg.bytes / pkg.total) : null;
  return <div className="rplot-download" role="status">
    <div className="rplot-download-label"><span className="rplot-download-orbit" aria-hidden="true" /><strong>{components ? 'R/Wasm · cetzDevice' : pkg.name}</strong><small>{components ? `${assets.done}/${assets.total}` : pkg.count ? `${pkg.step}/${pkg.count}` : ''}</small></div>
    <div className={`rplot-download-track ${ratio === null ? 'is-indeterminate' : ''}`}><span style={ratio === null ? undefined : { width: `${ratio * 100}%` }} /></div>
    <div className="rplot-download-detail"><span>{label}</span><span>{components ? `${mb(assets.bytes)} MB` : pkg.cached ? t('使用已缓存的安装包') : pkg.bytes ? `${mb(pkg.bytes)}${pkg.total ? ` / ${mb(pkg.total)}` : ''} MB` : ''}</span></div>
  </div>;
}
