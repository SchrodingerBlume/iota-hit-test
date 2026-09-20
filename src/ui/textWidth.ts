// 量一段文字按某个输入框的字排出来有多宽：body 上挂一个隐藏的 span，抄输入框的字体设置进去量。
// 不用 canvas——canvas 拿不到还没在页面上用过的 webfont，中文按替代字体量出来窄一截，框里五个字只露三个
let probe: HTMLSpanElement | null = null;
export function textWidth(like: HTMLElement, text: string): number {
  if (!probe) {
    probe = document.createElement('span');
    probe.setAttribute('aria-hidden', 'true');
    Object.assign(probe.style, { position: 'fixed', left: '0', top: '0', visibility: 'hidden', whiteSpace: 'pre', pointerEvents: 'none', zIndex: '-1' });
    document.body.appendChild(probe);
  }
  const cs = getComputedStyle(like);
  Object.assign(probe.style, { font: cs.font, letterSpacing: cs.letterSpacing, fontFeatureSettings: cs.fontFeatureSettings, fontKerning: cs.fontKerning, textTransform: cs.textTransform });
  probe.textContent = text;
  return probe.getBoundingClientRect().width;
}

/** webfont 晚到一步：字体装好后按它重量一次（不然按替代字体量出来的宽就定死了） */
import { useEffect, useState } from 'react';
export function useFontsTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const on = () => setTick((n) => n + 1);
    document.fonts?.addEventListener('loadingdone', on);
    return () => document.fonts?.removeEventListener('loadingdone', on);
  }, []);
  return tick;
}
