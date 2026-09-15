// 三栏布局的偏好：左栏收起、编辑 / 分栏 / 预览三种模式、编辑与预览的分配比例（拖分隔条）。都记在本机。
import { useCallback, useEffect, useRef, useState } from 'react';

type Mode = 'editor' | 'split' | 'preview';
const KEY = 'iota4web-layout';
const NAV_W = 200;
const SPLIT_W = 6;

function load(): { navOpen: boolean; mode: Mode; ratio: number } {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? '{}'); return { navOpen: v.navOpen ?? true, mode: v.mode ?? 'split', ratio: Math.min(0.8, Math.max(0.2, v.ratio ?? 0.54)) }; }
  catch { return { navOpen: true, mode: 'split', ratio: 0.54 }; }
}

export function useLayoutPrefs() {
  const [prefs, setPrefs] = useState(load);
  const mainRef = useRef<HTMLDivElement>(null);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* */ } }, [prefs]);

  const startDrag = useCallback((e: React.PointerEvent) => {
    const el = mainRef.current;
    if (!el) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const left = rect.left + (prefs.navOpen ? NAV_W : 0);
    const width = rect.width - (prefs.navOpen ? NAV_W : 0) - SPLIT_W;
    document.body.classList.add('is-resizing');
    const move = (ev: PointerEvent) => {
      const r = Math.min(0.8, Math.max(0.2, (ev.clientX - left) / width));
      setPrefs((p) => ({ ...p, ratio: r }));
    };
    const up = () => { document.body.classList.remove('is-resizing'); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [prefs.navOpen]);

  const nav = prefs.navOpen ? `${NAV_W}px` : '0px';
  const gridColumns = prefs.mode === 'split'
    ? `${nav} minmax(360px, ${prefs.ratio}fr) ${SPLIT_W}px minmax(320px, ${1 - prefs.ratio}fr)`
    : `${nav} minmax(0, 1fr)`;

  return {
    navOpen: prefs.navOpen, setNavOpen: (v: boolean) => setPrefs((p) => ({ ...p, navOpen: v })),
    mode: prefs.mode, setMode: (m: Mode) => setPrefs((p) => ({ ...p, mode: m })),
    ratio: prefs.ratio, startDrag, mainRef, gridColumns,
  };
}
