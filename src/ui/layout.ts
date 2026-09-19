// 三栏布局的偏好：左栏收起、编辑 / 分栏 / 预览三种模式、编辑与预览的分配比例（拖分隔条）。都记在本机。
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useMedia, COMPACT, PORTRAIT } from './useMedia';

type Mode = 'editor' | 'split' | 'preview';
const KEY = 'iota4web-layout';
const NAV_W = 200;
const SPLIT_W = 4;

function load(): { navOpen: boolean; mode: Mode; ratio: number } {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? '{}'); return { navOpen: v.navOpen ?? true, mode: v.mode ?? 'split', ratio: Math.min(0.8, Math.max(0.2, v.ratio ?? 0.54)) }; }
  catch { return { navOpen: true, mode: 'split', ratio: 0.54 }; }
}

export function useLayoutPrefs() {
  const [prefs, setPrefs] = useState(load);
  const mainRef = useRef<HTMLDivElement>(null);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* */ } }, [prefs]);
  // 窄屏（手机、竖着的平板）：左栏不占列、按需盖在上面；竖屏分栏改成上下叠，横屏仍左右分
  const compact = useMedia(COMPACT);
  const portrait = useMedia(PORTRAIT);
  const stacked = compact && portrait && prefs.mode === 'split';
  // 窄屏上的左栏是抽屉：开着的偏好不带过去，切回宽屏再按偏好
  const [drawer, setDrawer] = useState(false);
  useEffect(() => { if (!compact) setDrawer(false); }, [compact]);

  // 收放左栏不让浏览器逐帧重排三栏（编辑区和预览都很重，一动就掉帧）：布局一次到位，
  // 各栏从旧位置用 transform 滑到新位置，左栏本体浮起来滑出 / 滑进（功能区收起就是这么做的）
  const flip = useRef<{ open: boolean; lefts: [HTMLElement, number][] } | null>(null);
  const openNav = (v: boolean) => {
    const el = mainRef.current;
    if (el && !stacked) {
      const targets = [...el.querySelectorAll<HTMLElement>(':scope > .work > .work-inner, :scope > .splitter, :scope > .preview, :scope > .nav-toggle')];
      flip.current = { open: v, lefts: targets.map((t) => [t, t.getBoundingClientRect().left]) };
    }
    setPrefs((p) => ({ ...p, navOpen: v }));
  };
  useLayoutEffect(() => {
    const f = flip.current;
    flip.current = null;
    const el = mainRef.current;
    if (!f || !el) return;
    const opts: KeyframeAnimationOptions = { duration: 280, easing: 'cubic-bezier(0.22, 0.75, 0.2, 1)' };
    for (const [t, left] of f.lefts) {
      const dx = left - t.getBoundingClientRect().left;
      if (dx) t.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], opts);
    }
    const nav = el.querySelector<HTMLElement>(':scope > .nav');
    if (!nav) return;
    if (f.open) { nav.animate([{ transform: `translateX(${-NAV_W}px)` }, { transform: 'none' }], opts); return; }
    // 列已归零，左栏本体按原宽溢出来、压在编辑区上面滑走（不能 absolute：一出网格流后面几列就串位）
    Object.assign(nav.style, { width: `${NAV_W}px`, visibility: 'visible', zIndex: '7' });
    nav.animate([{ transform: 'none' }, { transform: `translateX(${-NAV_W}px)` }], opts).finished.then(() => { nav.style.cssText = ''; }, () => { nav.style.cssText = ''; });
  }, [prefs.navOpen]);

  const startDrag = useCallback((e: React.PointerEvent) => {
    const el = mainRef.current;
    if (!el) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const navW = compact || !prefs.navOpen ? 0 : NAV_W;
    const left = rect.left + navW;
    const width = rect.width - navW - SPLIT_W;
    const top = rect.top;
    const height = rect.height - SPLIT_W;
    let nextRatio = prefs.ratio;
    let raf = 0;
    document.body.classList.add(stacked ? 'is-resizing-row' : 'is-resizing');
    const paint = () => {
      raf = 0;
      if (stacked) {
        el.style.gridTemplateColumns = 'minmax(0, 1fr)';
        el.style.gridTemplateRows = `minmax(0, ${nextRatio}fr) ${SPLIT_W}px minmax(0, ${1 - nextRatio}fr)`;
      } else {
        const nav = compact ? '' : `${prefs.navOpen ? NAV_W : 0}px `;
        el.style.gridTemplateColumns = `${nav}minmax(${compact ? 0 : 360}px, ${nextRatio}fr) ${SPLIT_W}px minmax(${compact ? 0 : 320}px, ${1 - nextRatio}fr)`;
      }
    };
    const move = (ev: PointerEvent) => {
      nextRatio = Math.min(0.8, Math.max(0.2, stacked ? (ev.clientY - top) / height : (ev.clientX - left) / width));
      if (!raf) raf = requestAnimationFrame(paint);
    };
    const up = () => {
      if (raf) { cancelAnimationFrame(raf); paint(); }
      document.body.classList.remove('is-resizing', 'is-resizing-row');
      setPrefs((p) => ({ ...p, ratio: nextRatio }));
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }, [prefs.navOpen, prefs.ratio, compact, stacked]);

  // 宽屏上左栏收起是列宽归零（列还在，收放才能有过渡）；窄屏它是盖在上面的抽屉，不占列
  const nav = compact ? '' : `${prefs.navOpen ? NAV_W : 0}px `;
  const gridColumns = stacked
    ? 'minmax(0, 1fr)'
    : prefs.mode === 'split'
      ? `${nav}minmax(${compact ? 0 : 360}px, ${prefs.ratio}fr) ${SPLIT_W}px minmax(${compact ? 0 : 320}px, ${1 - prefs.ratio}fr)`
      : `${nav}minmax(0, 1fr)`;
  const gridRows = stacked ? `minmax(0, ${prefs.ratio}fr) ${SPLIT_W}px minmax(0, ${1 - prefs.ratio}fr)` : undefined;

  return {
    navOpen: compact ? drawer : prefs.navOpen,
    setNavOpen: (v: boolean) => { if (compact) setDrawer(v); else openNav(v); },
    mode: prefs.mode, setMode: (m: Mode) => setPrefs((p) => ({ ...p, mode: m })),
    ratio: prefs.ratio, startDrag, mainRef, gridColumns, gridRows, compact, stacked,
  };
}
