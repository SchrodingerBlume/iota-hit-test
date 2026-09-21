// 布局的偏好：左栏收起、编辑 / 分栏 / 预览三种模式、编辑与预览的分配比例、Agent 那列的宽（都是拖分隔条定的）。记在本机。
// 三块（编辑、预览、Agent）宽屏上是并排的列，两条分隔条各拖各的；窄屏上三选二（或只看一块），竖屏上下叠、横屏左右分。
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useMedia, COMPACT, PORTRAIT } from './useMedia';
import { useAgent } from '../ai/state';
import { useAgentWindow } from './agentWindow';

/** agent：窄屏上只看 Agent（宽屏当 editor） */
type Mode = 'editor' | 'split' | 'preview' | 'agent';
export type Pane = 'editor' | 'preview' | 'agent';
const KEY = 'iota4web-layout';
const NAV_W = 200;
const SPLIT_W = 4;
const AGENT_W = 380;
const AGENT_MIN = 280;
const WORK_MIN = 360;
const PREVIEW_MIN = 320;

// 两栏按比例分：fr 的系数写成整数、不写成 0.2fr / 0.8fr——一栏碰到 minmax 的下限退成定宽后，
// 剩下那栏的 fr 之和不到 1，网格按规范把 1fr 当成整段剩余空间、只分给它 0.8 份，右边空出一截

function load(): { navOpen: boolean; mode: Mode; ratio: number; agentW: number } {
  // 手机上下叠着的分栏两边都不够用，没选过的默认只看编辑
  const mode: Mode = window.matchMedia(COMPACT).matches ? 'editor' : 'split';
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? '{}'); return { navOpen: v.navOpen ?? true, mode: v.mode ?? mode, ratio: Math.min(0.8, Math.max(0.2, v.ratio ?? 0.54)), agentW: Math.max(AGENT_MIN, v.agentW ?? AGENT_W) }; }
  catch { return { navOpen: true, mode, ratio: 0.54, agentW: AGENT_W }; }
}

/** 这会儿摆出来的是哪几块（按 DOM 顺序：编辑、预览、Agent）。窄屏上 Agent 开着就顶掉分栏里的预览，最多两块 */
function shownPanes(mode: Mode, agentOpen: boolean, compact: boolean, agentDocked: boolean): Pane[] {
  if (compact) {
    if (agentOpen) return mode === 'preview' ? ['preview', 'agent'] : mode === 'agent' ? ['agent'] : ['editor', 'agent'];
    return mode === 'split' ? ['editor', 'preview'] : mode === 'preview' ? ['preview'] : ['editor'];
  }
  const main: Pane[] = mode === 'split' ? ['editor', 'preview'] : mode === 'preview' ? ['preview'] : ['editor'];
  return agentOpen && agentDocked ? [...main, 'agent'] : main;
}

export function useLayoutPrefs() {
  const [prefs, setPrefs] = useState(load);
  const mainRef = useRef<HTMLDivElement>(null);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* */ } }, [prefs]);
  // 窄屏（手机、竖着的平板）：左栏不占列、按需盖在上面；竖屏分栏改成上下叠，横屏仍左右分
  const compact = useMedia(COMPACT);
  const portrait = useMedia(PORTRAIT);
  const agentOpen = useAgent((s) => s.open);
  const agentFloat = useAgentWindow((s) => s.float);
  // Agent 占一列得放得下：左栏 200 + 编辑 360 + 预览 320 + 面板 280（各自的下限）；放不下就盖在上面（浮成小窗的不占列）
  const agentFits = useMedia(prefs.mode === 'split' ? '(min-width: 1180px)' : '(min-width: 860px)');
  const agentDocked = !compact && !agentFloat && agentFits;
  const shown = shownPanes(prefs.mode, agentOpen, compact, agentDocked);
  const stacked = compact && portrait && shown.length === 2;
  // 窄屏使用临时导航抽屉，不覆盖宽屏下的导航窗格偏好。
  const [drawer, setDrawer] = useState(false);
  useEffect(() => { if (!compact) setDrawer(false); }, [compact]);

  // 收放左栏不让浏览器逐帧重排三栏（编辑区和预览都很重，一动就掉帧）：布局一次到位，
  // 各栏从旧位置用 transform 滑到新位置，左栏本体浮起来滑出 / 滑进（功能区收起就是这么做的）
  const flip = useRef<{ open: boolean; lefts: [HTMLElement, number][] } | null>(null);
  const openNav = (v: boolean) => {
    const el = mainRef.current;
    if (el && !stacked) {
      const targets = [...el.querySelectorAll<HTMLElement>(':scope > .work .work-inner, :scope > .splitter, :scope > .preview, :scope > .agent-pane, :scope > .nav-toggle')];
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

  // 窗口宽：Agent 那列是定宽，窗口缩小了得让它，别把前面两块挤出下限
  const [vw, setVw] = useState(() => window.innerWidth);
  useEffect(() => { const on = () => setVw(window.innerWidth); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on); }, []);
  /** 各块的列（或行）：按 DOM 顺序摆出来的块之间各一条分隔条；头两块按 ratio 分，Agent 那列定宽 */
  const tracks = useCallback((ratio: number, agentW: number, rows: boolean) => {
    const out: string[] = [];
    if (!compact && !rows) out.push(`${prefs.navOpen ? NAV_W : 0}px`);
    const main = shown.filter((p) => p !== 'agent');
    const min = (p: Pane) => (compact ? 0 : p === 'editor' ? WORK_MIN : PREVIEW_MIN);
    agentW = Math.min(agentW, Math.max(AGENT_MIN, vw - (prefs.navOpen ? NAV_W : 0) - main.reduce((a, p) => a + min(p), 0) - SPLIT_W * main.length));
    if (main.length === 2) out.push(`minmax(${min(main[0])}px, ${Math.round(ratio * 100)}fr)`, `${SPLIT_W}px`, `minmax(${min(main[1])}px, ${Math.round((1 - ratio) * 100)}fr)`);
    else if (main.length === 1) out.push(shown.includes('agent') && compact ? `minmax(0, ${Math.round(ratio * 100)}fr)` : 'minmax(0, 1fr)');
    if (shown.includes('agent')) {
      if (main.length) out.push(`${SPLIT_W}px`);
      out.push(!main.length ? 'minmax(0, 1fr)' : compact ? `minmax(0, ${Math.round((1 - ratio) * 100)}fr)` : `${agentW}px`);
    }
    return out.join(' ');
  }, [compact, prefs.navOpen, shown.join(), vw]);

  /** 拖分隔条：which = main 是头两块之间的，agent 是 Agent 那列左边的 */
  const startDrag = useCallback((e: React.PointerEvent, which: 'main' | 'agent' = 'main') => {
    const el = mainRef.current;
    if (!el) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const navW = compact || !prefs.navOpen ? 0 : NAV_W;
    let nextRatio = prefs.ratio;
    let nextAgentW = prefs.agentW;
    // 头两块合起来占的那段：整宽减去左栏、它们之间的分隔条、Agent 那列（宽屏上定宽）
    const agentPart = which === 'main' && shown.includes('agent') && !compact ? prefs.agentW + SPLIT_W : 0;
    const left = rect.left + navW;
    const width = rect.width - navW - SPLIT_W - agentPart;
    const top = rect.top;
    const height = rect.height - SPLIT_W;
    let raf = 0;
    document.body.classList.add(stacked ? 'is-resizing-row' : 'is-resizing');
    const paint = () => {
      raf = 0;
      if (stacked) { el.style.gridTemplateColumns = 'minmax(0, 1fr)'; el.style.gridTemplateRows = tracks(nextRatio, nextAgentW, true); }
      else el.style.gridTemplateColumns = tracks(nextRatio, nextAgentW, false);
    };
    const move = (ev: PointerEvent) => {
      if (which === 'agent') nextAgentW = Math.round(Math.min(Math.max(AGENT_MIN, rect.right - ev.clientX), rect.width * 0.6));
      else nextRatio = Math.min(0.8, Math.max(0.2, stacked ? (ev.clientY - top) / height : (ev.clientX - left) / width));
      if (!raf) raf = requestAnimationFrame(paint);
    };
    const up = () => {
      if (raf) { cancelAnimationFrame(raf); paint(); }
      document.body.classList.remove('is-resizing', 'is-resizing-row');
      setPrefs((p) => ({ ...p, ratio: nextRatio, agentW: nextAgentW }));
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }, [prefs.navOpen, prefs.ratio, prefs.agentW, compact, stacked, tracks]);

  const gridColumns = stacked ? 'minmax(0, 1fr)' : tracks(prefs.ratio, prefs.agentW, false);
  const gridRows = stacked ? tracks(prefs.ratio, prefs.agentW, true) : undefined;

  const setMode = (m: Mode) => setPrefs((p) => ({ ...p, mode: m }));
  /** 窄屏底栏上的三颗开关：最多亮两颗，编辑与预览互为替补，Agent 是第三块 */
  const togglePane = (pane: Pane) => {
    const on = shown.includes(pane);
    if (pane === 'agent') {
      useAgent.getState().setOpen(!on);
      if (on && prefs.mode === 'agent') setMode('editor');
      return;
    }
    const other: Pane = pane === 'editor' ? 'preview' : 'editor';
    if (on) {
      if (shown.length === 1) return;
      setMode(shown.includes('agent') ? 'agent' : other);
    } else {
      setMode(shown.includes('agent') || shown.length === 0 ? pane : 'split');
    }
  };

  return {
    navOpen: compact ? drawer : prefs.navOpen,
    setNavOpen: (v: boolean) => { if (compact) setDrawer(v); else openNav(v); },
    /** 宽屏上没有「只看 Agent」这档，当成编辑 */
    mode: (compact ? prefs.mode : prefs.mode === 'agent' ? 'editor' : prefs.mode) as 'editor' | 'split' | 'preview' | 'agent',
    setMode, shown, togglePane,
    ratio: prefs.ratio, startDrag, mainRef, gridColumns, gridRows, compact, stacked, agentDocked, agentFloat: !compact && agentFloat,
  };
}
