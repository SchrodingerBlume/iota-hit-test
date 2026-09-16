// 媒体查询做成 hook：紧凑（手机 / 窄平板）、竖屏、矮屏三种判断布局用
import { useEffect, useState } from 'react';

export function useMedia(query: string): boolean {
  const get = () => (typeof window !== 'undefined' && 'matchMedia' in window ? window.matchMedia(query).matches : false);
  const [m, setM] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const fn = () => setM(mq.matches);
    fn();
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, [query]);
  return m;
}
/** 窄屏（手机、竖着的平板）：单栏或上下叠，左栏变抽屉 */
export const COMPACT = '(max-width: 900px)';
export const PORTRAIT = '(orientation: portrait)';
/** 矮屏（手机横屏）：功能区默认收起，省高度 */
export const SHORT = '(max-height: 520px)';
