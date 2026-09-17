// 三栏布局的偏好：左栏收起、编辑 / 分栏 / 预览三种模式、编辑与预览的分配比例（拖分隔条）。都记在本机。
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMedia, COMPACT, PORTRAIT } from './useMedia';

type Mode = 'editor' | 'split' | 'preview';
const KEY = 'iota4web-layout';
const NAV_W = 216;
const SPLIT_W = 6;

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
    document.body.classList.add('is-resizing');
    const move = (ev: PointerEvent) => {
      const r = Math.min(0.8, Math.max(0.2, stacked ? (ev.clientY - top) / height : (ev.clientX - left) / width));
      setPrefs((p) => ({ ...p, ratio: r }));
    };
    const up = () => { document.body.classList.remove('is-resizing'); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [prefs.navOpen, compact, stacked]);

  // 左栏收起时它是 display:none，网格里没有这个孩子，列表里也不能给它留位
  const nav = prefs.navOpen && !compact ? `${NAV_W}px ` : '';
  const gridColumns = stacked
    ? 'minmax(0, 1fr)'
    : prefs.mode === 'split'
      ? `${nav}minmax(${compact ? 0 : 360}px, ${prefs.ratio}fr) ${SPLIT_W}px minmax(${compact ? 0 : 320}px, ${1 - prefs.ratio}fr)`
      : `${nav}minmax(0, 1fr)`;
  const gridRows = stacked ? `minmax(0, ${prefs.ratio}fr) ${SPLIT_W}px minmax(0, ${1 - prefs.ratio}fr)` : undefined;

  return {
    navOpen: compact ? drawer : prefs.navOpen,
    setNavOpen: (v: boolean) => { if (compact) setDrawer(v); else setPrefs((p) => ({ ...p, navOpen: v })); },
    mode: prefs.mode, setMode: (m: Mode) => setPrefs((p) => ({ ...p, mode: m })),
    ratio: prefs.ratio, startDrag, mainRef, gridColumns, gridRows, compact, stacked,
  };
}
