// 预览区直接编辑：盖在排版结果上的一层。
//
// 操作逻辑照 Word：点哪儿光标落哪儿，拖动选一段，双击选词、三击选段，直接打字、退格、
// 回车分段、方向键上下左右，⌘B/I/U 加粗强调下划线，⌘Z 撤销，复制粘贴，中文输入法照常。
// 真身仍是左侧的 ProseMirror 文档：这里的光标就是编辑器的选区，每一次击键都翻成编辑器
// 命令发过去，排版结果随即重排。字形表更新前，新敲的字先「暂印」在光标处。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { create } from 'zustand';
import type { Editor } from '@tiptap/core';
import { NodeSelection, Selection, TextSelection } from '@tiptap/pm/state';
import { useCompileState } from '../compiler/client';
import { useStore, type RichKey, type Section } from '../model/store';
import { focusInfo } from '../compiler/renderer';
import { getEditor, onRegistryChange, whenEditorReady } from '../editor/registry';
import { docVersion, mappingSince, toNewPos, toOldPos } from '../editor/versions';
import { useOpenRequest } from '../editor/openRequest';
import { useBlockMenu } from '../editor/BlockMenu';
import { useComments } from '../editor/comments';
import { buildIndex, caretRect, hitPos, hitTest, lineStep, selectionRects, paragraphMarks, EMPTY_INDEX, type CaretRect, type Glyph, type Hit, type Line } from './previewEdit';
import { t as tx } from '../i18n';
import { useInputState } from '../editor/inputState';

const KEY_SECTION: Record<RichKey, Section> = {
  body: 'body', appendix: 'appendix', conclusion: 'conclusion', acknowledgement: 'acknowledgement', resume: 'resume',
  abstractZh: 'abstract', abstractEn: 'abstract',
};

/** 预览编辑面的状态：眼下在编哪份富文本、输入焦点是不是在预览里 */
interface Surface {
  activeKey: RichKey | null;
  focused: boolean;
  /** 把焦点还给预览里的隐藏输入框（工具栏按钮按完调） */
  refocus: () => void;
  set: (p: Partial<Surface>) => void;
}
export const usePreviewSurface = create<Surface>((set) => ({ activeKey: null, focused: false, refocus: () => {}, set: (p) => set(p) }));

/** 显示编辑标记（Word 的 ¶）：只画在预览的覆盖层上，排版结果与 PDF 不受影响；记在本机 */
const MARKS_KEY = 'iota4web-show-marks';
export interface MarkKinds { paragraph: boolean; space: boolean; gutter: boolean }
interface MarksState extends MarkKinds { on: boolean; toggle: () => void; setKind: (k: keyof MarkKinds, v: boolean) => void }
const readMarks = (): Partial<MarksState> => { try { const v = localStorage.getItem(MARKS_KEY); if (v === '1' || v === '0') return { on: v === '1' }; return v ? JSON.parse(v) : {}; } catch { return {}; } };
const saveMarks = (s: MarksState) => { try { localStorage.setItem(MARKS_KEY, JSON.stringify({ on: s.on, paragraph: s.paragraph, space: s.space, gutter: s.gutter })); } catch { /* */ } };
export const usePreviewMarks = create<MarksState>((set, get) => ({
  on: false, paragraph: true, space: true, gutter: true, ...readMarks(),
  toggle: () => { set({ on: !get().on }); saveMarks(get()); },
  setKind: (k, v) => { set({ [k]: v } as Partial<MarksState>); saveMarks(get()); },
}));

interface PageGeom { left: number; top: number; scale: number; w: number; h: number }

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

export function PreviewEditLayer({ docRef, scrollRef, renderTick }: { docRef: RefObject<HTMLDivElement | null>; scrollRef: RefObject<HTMLDivElement | null>; renderTick: number }) {
  const glyphs = useCompileState((s) => s.glyphs);
  const segments = useCompileState((s) => s.segments);
  const mapVersion = useCompileState((s) => s.mapVersion);
  const index = useMemo(() => (glyphs ? buildIndex(glyphs, segments, mapVersion) : EMPTY_INDEX), [glyphs, segments, mapVersion]);
  const marksOn = usePreviewMarks((s) => s.on);
  const mkP = usePreviewMarks((s) => s.paragraph), mkS = usePreviewMarks((s) => s.space), mkG = usePreviewMarks((s) => s.gutter);
  const marks = useMemo(() => (marksOn ? paragraphMarks(index, segments, { paragraph: mkP, space: mkS, gutter: mkG }) : []), [marksOn, index, segments, mkP, mkS, mkG]);

  const activeKey = usePreviewSurface((s) => s.activeKey);
  const focused = usePreviewSurface((s) => s.focused);
  const setSurface = usePreviewSurface((s) => s.set);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [, bump] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  /** 上次点击 / 光标所在的页与纵坐标：同一段字印了几处时挑这附近的 */
  const prefer = useRef<{ page: number; y: number } | null>(null);
  /** 上下方向键记住的横坐标 */
  const goalX = useRef<number | null>(null);
  const [cursor, setCursor] = useState('');
  const compositionActive = useRef(false);
  const compositionCommit = useRef<string | null>(null);
  const [composing, setComposing] = useState<string | null>(null);
  const [pending, setPending] = useState<{ key: RichKey; version: number; text: string; fading?: boolean } | null>(null);
  const [geom, setGeom] = useState<PageGeom[]>([]);
  /** 自己数连击：pointerdown 的 detail 恒为 0，双击选词、三击选段得靠这个 */
  const clicks = useRef({ t: 0, x: 0, y: 0, n: 0 });

  // 眼下这份富文本的编辑器；换节 / 重建时跟着换
  useEffect(() => {
    const pickEditor = () => setEditor(activeKey ? getEditor(activeKey) ?? null : null);
    pickEditor();
    return onRegistryChange(pickEditor);
  }, [activeKey]);
  // 编辑器每一笔事务都重画（选区变了、内容变了）
  useEffect(() => {
    if (!editor) return;
    const tick = () => bump((t) => t + 1);
    editor.on('transaction', tick);
    editor.on('selectionUpdate', tick);
    return () => { editor.off('transaction', tick); editor.off('selectionUpdate', tick); };
  }, [editor]);
  useEffect(() => { setSurface({ refocus: () => inputRef.current?.focus({ preventScroll: true }) }); }, [setSurface]);

  // 每页在图层里的位置与比例：重画、缩放、改宽都重算
  const measure = useCallback(() => {
    const doc = docRef.current;
    if (!doc) return;
    const svg = doc.querySelector<SVGSVGElement>('svg.typst-doc');
    if (!svg) return;
    const vb = svg.viewBox.baseVal;
    // clientWidth 是整数：几十页往下累积就差出一行，要小数宽；捏合进行中舞台是 transform 缩放的，除回去
    const gesture = parseFloat(doc.dataset.scale ?? '1') || 1;
    const scale = (svg.getBoundingClientRect().width / gesture || parseFloat(svg.getAttribute('width') ?? '0')) / (vb.width || 1);
    const out: PageGeom[] = [];
    // 用版面坐标换算到覆盖层坐标。getScreenCTM 会把手势缩放再算一遍，导致缩放时光标漂移。
    svg.querySelectorAll<SVGGElement>(':scope > g.typst-page').forEach((g, i) => {
      const w = parseFloat(g.getAttribute('data-page-width') ?? '0') || 1;
      const h = parseFloat(g.getAttribute('data-page-height') ?? '0') || 1;
      const x = parseFloat(g.getAttribute('data-layout-x') ?? '0');
      const y = parseFloat(g.getAttribute('data-layout-y') ?? '0');
      out[i] = { left: (x - vb.x) * scale, top: (y - vb.y) * scale, scale, w, h };
    });
    // 只编一章嵌进来的页数与它顶掉的母本页数不等时，字形表（按上次整编的页码）与展示层的页序错开一截
    const f = doc.querySelector<HTMLElement>(':scope > .preview-doc');
    setFocusMap(f ? focusInfo(f) : null);
    setGeom(out);
  }, [docRef]);
  const [focusMap, setFocusMap] = useState<{ start: number; baseCount: number; count: number } | null>(null);
  /** 字形表的页码 → 展示层的页序；那一章里多出来 / 少掉的页没有对应，-1 */
  const toDisplay = (p: number): number => {
    const f = focusMap;
    if (!f) return p;
    if (p < f.start) return p;
    if (p < f.start + f.baseCount) return p - f.start < f.count ? p : -1;
    return p + f.count - f.baseCount;
  };
  const toGlyphPage = (d: number): number => {
    const f = focusMap;
    if (!f) return d;
    if (d < f.start) return d;
    if (d < f.start + f.count) return Math.min(d, f.start + f.baseCount - 1);
    return d - (f.count - f.baseCount);
  };
  useLayoutEffect(() => { measure(); }, [measure, renderTick]);
  useEffect(() => {
    const doc = docRef.current;
    if (!doc) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(doc);
    return () => ro.disconnect();
  }, [docRef, measure]);

  // ── 选区 → 画光标与高亮 ─────────────────────────────────────
  const sel = editor && activeKey ? editor.state.selection : null;
  const pageTo = (p: number, x: number, y: number) => { const g = geom[toDisplay(p)]; return g ? { left: g.left + x * g.scale, top: g.top + y * g.scale, scale: g.scale } : null; };
  const stale = index.version !== docVersion();
  const oldPos = (pos: number, assoc: -1 | 1) => (activeKey ? (stale ? toOldPos(activeKey, index.version, pos, assoc) : pos) : null);
  const caret = useMemo((): CaretRect | null => {
    if (!sel || !activeKey) return null;
    const p = oldPos(sel.head, sel.head === sel.to ? -1 : 1);
    if (p === null) return null;
    return caretRect(index, activeKey, p, prefer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, activeKey, index, stale]);
  const rects = useMemo(() => {
    if (!sel || !activeKey || sel.empty) return [];
    const a = oldPos(sel.from, 1), b = oldPos(sel.to, -1);
    if (a === null || b === null) return [];
    return selectionRects(index, activeKey, a, b, caret ? { page: caret.page, y: caret.y } : prefer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, activeKey, index, caret, stale]);
  // 批注圈的范围：预览里淡黄底（与编辑区同色），当前那条深一点
  const activeComment = useComments((s) => s.active);
  const commentRects = useMemo(() => {
    if (!editor || !activeKey) return [] as { id: string; rects: ReturnType<typeof selectionRects> }[];
    const ranges: { id: string; from: number; to: number }[] = [];
    editor.state.doc.descendants((n, pos) => {
      if (!n.isText) return true;
      const m = n.marks.find((mk) => mk.type.name === 'comment');
      if (!m) return false;
      const last = ranges[ranges.length - 1];
      if (last && last.id === m.attrs.commentId && last.to === pos) last.to = pos + n.nodeSize; else ranges.push({ id: m.attrs.commentId, from: pos, to: pos + n.nodeSize });
      return false;
    });
    return ranges.map((r) => { const a = oldPos(r.from, 1), b = oldPos(r.to, -1); return { id: r.id, rects: a === null || b === null ? [] : selectionRects(index, activeKey, a, b, null) }; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, activeKey, index, stale, sel]);

  // 字形表跟上了：暂印的字淡出，与真字形交叉
  useEffect(() => {
    if (!pending || pending.fading || index.version < pending.version) return;
    setPending({ ...pending, fading: true });
    const t = window.setTimeout(() => setPending((p) => (p && p.fading ? null : p)), 220);
    return () => window.clearTimeout(t);
  }, [index.version, pending]);
  // 删掉的字在重排前就该消失（Word 是当场没的）：编译那一版里的字形，映射到现在的位置若已塌成空，
  // 就盖一块纸色把它遮掉
  const gone = useMemo(() => {
    if (!stale || !activeKey) return [] as { page: number; x: number; y: number; w: number; h: number }[];
    const m = mappingSince(activeKey, index.version);
    const arr = index.byKey.get(activeKey);
    if (!m || !arr) return [];
    // 只看被改动过的那几段（按 from 二分定位），长文档几十万字形逐个映射一遍要几百毫秒
    const ranges: [number, number][] = [];
    for (let i = 0; i < m.maps.length; i++) {
      const back = m.slice(0, i).invert();
      m.maps[i].forEach((oldStart, oldEnd) => { if (oldEnd > oldStart) ranges.push([back.map(oldStart, -1), back.map(oldEnd, 1)]); });
    }
    const out: { page: number; x: number; y: number; w: number; h: number }[] = [];
    const seen = new Set<Glyph>();
    for (const [a, b] of ranges) {
      let lo = 0, hi = arr.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid].from < a - 1) lo = mid + 1; else hi = mid; }
      for (let i = lo; i < arr.length && arr[i].from <= b + 1; i++) {
        const g = arr[i];
        if (seen.has(g) || g.kind !== 'text' || g.from === g.to) continue;
        seen.add(g);
        if (m.map(g.to, -1) <= m.map(g.from, 1)) out.push({ page: g.page, x: g.x, y: g.y, w: g.w, h: g.h });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stale, activeKey, index, docVersion()]);
  // 光标跑出视野就滚过去（Word：视野跟着光标走）。刚切到某份富文本时它的选区还是旧的，
  // 那一下不跟，等点击把选区放好再说
  const lastCaretKey = useRef('');
  const skipFollow = useRef(false);
  /** 点击落定前（等编辑器挂上、选区还是旧的）画出的光标不算数，别拿它盖掉点击处的 prefer */
  const clickPending = useRef(false);
  useEffect(() => {
    if (!caret) return;
    const k = `${caret.page}:${caret.x.toFixed(1)}:${caret.y.toFixed(1)}`;
    if (k === lastCaretKey.current) return;
    lastCaretKey.current = k;
    if (clickPending.current) return;
    prefer.current = { page: caret.page, y: caret.y };
    if (skipFollow.current) { skipFollow.current = false; return; }
    const sc = scrollRef.current;
    const pt = pageTo(caret.page, caret.x, caret.y);
    if (!sc || !pt || !docRef.current) return;
    const top = docRef.current.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop + pt.top;
    const bottom = top + caret.h * pt.scale;
    if (top < sc.scrollTop + 20 || bottom > sc.scrollTop + sc.clientHeight - 20) {
      sc.scrollTo({ top: top - sc.clientHeight * 0.4, behavior: 'smooth' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caret]);

  // ── 编辑器操作 ──────────────────────────────────────────────
  /** 切到这份富文本（可能要先换节，等编辑器挂上来） */
  const activate = useCallback(async (key: RichKey): Promise<Editor | null> => {
    const st = useStore.getState();
    if (st.section !== KEY_SECTION[key]) { st.setView('editor'); st.setSection(KEY_SECTION[key]); }
    if (usePreviewSurface.getState().activeKey !== key) skipFollow.current = true;
    setSurface({ activeKey: key });
    const ed = await whenEditorReady(key);
    if (ed) setEditor(ed);
    return ed;
  }, [setSurface]);

  const setSelection = (ed: Editor, from: number, to = from, node = false) => {
    const doc = ed.state.doc;
    const clamp = (p: number) => Math.max(0, Math.min(doc.content.size, p));
    let s: Selection;
    try { s = node ? NodeSelection.create(doc, clamp(from)) : TextSelection.between(doc.resolve(clamp(from)), doc.resolve(clamp(to))); }
    catch { s = Selection.near(doc.resolve(clamp(from))); }
    ed.view.dispatch(ed.state.tr.setSelection(s).scrollIntoView());
  };
  /** 把键盘事件原样交给 ProseMirror 的键位表（回车分段、退格并段、Tab 缩进列表……） */
  const dispatchKey = (ed: Editor, e: { key: string; code?: string; shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => {
    const ev = new KeyboardEvent('keydown', { key: e.key, code: e.code, shiftKey: !!e.shiftKey, altKey: !!e.altKey, ctrlKey: !!e.ctrlKey, metaKey: !!e.metaKey, bubbles: true, cancelable: true });
    ed.view.dom.dispatchEvent(ev);
    return ev.defaultPrevented;
  };
  const insertText = (ed: Editor, text: string) => {
    const key = activeKey!;
    ed.view.dispatch(ed.state.tr.insertText(text).scrollIntoView());
    setPending((p) => ({ key, version: docVersion(), text: p && p.key === key && index.version < p.version ? p.text + text : text }));
  };

  /** 点击命中的字形 → 现在这一版里的位置 */
  const nowPos = (key: RichKey, p: number, assoc: -1 | 1 = 1) => (stale ? toNewPos(key, index.version, p, assoc) : p);

  /** 页内坐标（pt） */
  const toPage = (clientX: number, clientY: number): { page: number; x: number; y: number } | null => {
    const layer = layerRef.current;
    if (!layer) return null;
    const base = layer.getBoundingClientRect();
    const lx = clientX - base.left, ly = clientY - base.top;
    for (let i = 0; i < geom.length; i++) {
      const g = geom[i];
      if (!g) continue;
      if (ly >= g.top - 6 && ly <= g.top + g.h * g.scale + 6) return { page: toGlyphPage(i), x: (lx - g.left) / g.scale, y: (ly - g.top) / g.scale };
    }
    return null;
  };
  const hitAt = (clientX: number, clientY: number): Hit | null => {
    const p = toPage(clientX, clientY);
    return p ? hitTest(index, p.page, p.x, p.y) : null;
  };

  const focusInput = () => inputRef.current?.focus({ preventScroll: true });

  /** 一个「属性」字形（题注、脚注文字、论文信息）：把对应的输入框打开、光标放到那个字 */
  const openAttr = async (g: Glyph, side: 'before' | 'after') => {
    const offset = side === 'before' ? g.from : g.to;
    if (g.kind === 'info') {
      const st = useStore.getState();
      st.setView('editor'); st.setSection('info');
      setTimeout(() => {
        const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-info="${g.seg.attr}"]`);
        if (!el) return;
        el.focus();
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        try { el.setSelectionRange(offset, offset); } catch { /* 标签式输入没有 range */ }
      }, 80);
      return;
    }
    const ed = await activate(g.key as RichKey);
    if (!ed) return;
    const pos = nowPos(g.key as RichKey, g.seg.pmFrom);
    if (pos === null) return;
    setSelection(ed, pos, pos, true);
    useOpenRequest.getState().request({ key: g.key as RichKey, pos, attr: g.seg.attr, offset });
  };

  /** 右键：落到那一段 / 那条标题，弹块级菜单（编辑区那份同一个） */
  const onContextMenu = async (e: React.MouseEvent<HTMLDivElement>) => {
    const hit = hitAt(e.clientX, e.clientY);
    if (!hit) return;
    e.preventDefault();
    const g = hit.glyph;
    if (g.kind === 'info' || g.kind === 'attr') return;
    const key = g.key as RichKey;
    const ed = await activate(key);
    if (!ed) return;
    const pos = nowPos(key, g.kind === 'node' ? g.from : hitPos(hit), hit.side === 'before' ? 1 : -1);
    if (pos === null) return;
    const $p = ed.state.doc.resolve(Math.min(pos, ed.state.doc.content.size));
    for (let d = $p.depth; d >= 1; d--) {
      const n = $p.node(d);
      if (n.type.name === 'paragraph' || n.type.name === 'heading') {
        if (ed.state.selection.empty) setSelection(ed, pos, pos);
        prefer.current = { page: g.page, y: g.y };
        useBlockMenu.getState().open({ key, pos: $p.before(d), x: e.clientX, y: e.clientY });
        return;
      }
    }
  };

  const onPointerDown = async (e: React.PointerEvent<HTMLDivElement>) => {
    clickPending.current = true;
    try { await pointerDown(e); } finally { requestAnimationFrame(() => { clickPending.current = false; }); }
  };
  const pointerDown = async (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const hit = hitAt(e.clientX, e.clientY);
    if (!hit) return;
    e.preventDefault();
    const now = performance.now();
    const c = clicks.current;
    c.n = now - c.t < 450 && Math.abs(e.clientX - c.x) < 5 && Math.abs(e.clientY - c.y) < 5 ? c.n + 1 : 1;
    c.t = now; c.x = e.clientX; c.y = e.clientY;
    const detail = c.n;
    const g = hit.glyph;
    prefer.current = { page: g.page, y: g.y };
    goalX.current = null;
    if (g.kind === 'info' || g.kind === 'attr') {
      if (detail >= 2 || g.kind === 'info') void openAttr(g, hit.side);
      else {
        const ed = await activate(g.key as RichKey);
        const pos = ed ? nowPos(g.key as RichKey, g.seg.pmFrom) : null;
        if (ed && pos !== null) setSelection(ed, pos, pos, true);
        focusInput();
      }
      return;
    }
    const ed = await activate(g.key as RichKey);
    if (!ed) return;
    const key = g.key as RichKey;
    if (g.kind === 'node') {
      const pos = nowPos(key, g.from);
      if (pos === null) return;
      setSelection(ed, pos, pos, true);
      if (detail >= 2) useOpenRequest.getState().request({ key, pos });
      focusInput();
      return;
    }
    const pos = nowPos(key, hitPos(hit), hit.side === 'before' ? 1 : -1);
    if (pos === null) return;
    const cur = ed.state.selection;
    if (detail === 2) { const r = wordRange(ed, pos); setSelection(ed, r.from, r.to); ed.chain().focus().scrollIntoView().run(); return; }
    if (detail >= 3) { const $p = ed.state.doc.resolve(pos); setSelection(ed, $p.start(), $p.end()); focusInput(); return; }
    const anchor = e.shiftKey ? cur.anchor : pos;
    setSelection(ed, anchor, pos);
    focusInput();
    // 拖动选区
    const layer = layerRef.current;
    if (!layer) return;
    layer.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const h = hitAt(ev.clientX, ev.clientY);
      if (!h || h.glyph.key !== key || h.glyph.kind !== 'text') return;
      const p = nowPos(key, hitPos(h), h.side === 'before' ? 1 : -1);
      if (p === null) return;
      if (p !== ed.state.selection.head) setSelection(ed, anchor, p);
    };
    const up = () => { layer.removeEventListener('pointermove', move); layer.removeEventListener('pointerup', up); layer.removeEventListener('pointercancel', up); try { layer.releasePointerCapture(e.pointerId); } catch { /* 已释放 */ } };
    layer.addEventListener('pointermove', move);
    layer.addEventListener('pointerup', up);
    layer.addEventListener('pointercancel', up);
  };

  const hoverRaf = useRef(0);
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons) return;
    const { clientX, clientY } = e;
    cancelAnimationFrame(hoverRaf.current);
    hoverRaf.current = requestAnimationFrame(() => {
      const hit = hitAt(clientX, clientY);
      const next = !hit ? '' : hit.glyph.kind === 'text' || hit.glyph.kind === 'info' || hit.glyph.kind === 'attr' ? 'cur-text' : 'cur-pointer';
      setCursor((c) => (c === next ? c : next));
    });
  };

  // ── 键盘 ────────────────────────────────────────────────────
  const moveH = (ed: Editor, dir: -1 | 1, extend: boolean, word: boolean) => {
    const { doc, selection } = ed.state;
    if (!extend && selection instanceof NodeSelection) { setSelection(ed, dir < 0 ? selection.from : selection.to); return; }
    if (!extend && !selection.empty) { setSelection(ed, dir < 0 ? selection.from : selection.to); return; }
    const head = selection.head;
    const $h = doc.resolve(head);
    const nb = dir > 0 ? $h.nodeAfter : $h.nodeBefore;
    if (!extend && nb?.isInline && nb.isAtom && !nb.isText) {
      const at = dir > 0 ? head : head - nb.nodeSize;
      const old = activeKey ? (stale ? toOldPos(activeKey, index.version, at, 1) : at) : null;
      const drawn = old !== null && !!index.byKey.get(activeKey!)?.some((g) => g.kind === 'node' && g.from === old);
      if (drawn) { setSelection(ed, at, undefined, true); return; }
      setSelection(ed, dir > 0 ? head + nb.nodeSize : head - nb.nodeSize); return;
    }
    let target: number;
    if (word) { const r = wordRange(ed, head + (dir > 0 ? 1 : -1), dir); target = dir > 0 ? r.to : r.from; }
    else target = head + dir;
    if (target < 0 || target > doc.content.size) return;
    const near = Selection.near(doc.resolve(target), dir);
    setSelection(ed, extend ? selection.anchor : near.head, near.head);
  };
  const moveV = (ed: Editor, dir: -1 | 1, extend: boolean) => {
    if (!caret || !activeKey) { dispatchKey(ed, { key: dir < 0 ? 'ArrowUp' : 'ArrowDown', shiftKey: extend }); return; }
    const x = goalX.current ?? caret.x;
    goalX.current = x;
    const hit = lineStep(index, caret.line, dir, x);
    if (!hit) return;
    const p = nowPos(activeKey, hitPos(hit), hit.side === 'before' ? 1 : -1);
    if (p === null) return;
    prefer.current = { page: hit.glyph.page, y: hit.glyph.y };
    setSelection(ed, extend ? ed.state.selection.anchor : p, p);
  };
  /**
   * 退格 / 删除。ProseMirror 的键位表只管并段、删节点，单个字的删除是交给浏览器的
   * contenteditable 做的——这儿没有浏览器帮忙，得自己删：按字素（合成字符、代理对算一个），
   * Alt 按词，⌘ 到行首 / 行尾；有选区就删选区；在段首 / 段尾、贴着原子节点时才交给键位表并段。
   */
  const deleteChar = (ed: Editor, dir: -1 | 1, unit: 'char' | 'word' | 'line') => {
    const { doc, selection } = ed.state;
    if (!selection.empty) { ed.view.dispatch(ed.state.tr.deleteSelection().scrollIntoView()); return; }
    const head = selection.head;
    const $h = doc.resolve(head);
    let target: number | null = null;
    if (unit === 'line' && caret && activeKey) {
      const gs = caret.line.glyphs.filter((g) => g.key === activeKey && g.kind === 'text');
      if (gs.length) { const g = dir < 0 ? gs[0] : gs[gs.length - 1]; target = nowPos(activeKey, dir < 0 ? g.from : g.to, dir < 0 ? 1 : -1); }
    } else if (unit === 'word') {
      const r = wordRange(ed, head + (dir > 0 ? 1 : -1), dir);
      target = dir < 0 ? r.from : r.to;
      if (target === head) target = head + dir;
    } else {
      // 字素：段落文字里，光标前 / 后那个字有几个码元
      const text = doc.textBetween($h.start(), $h.end(), undefined, '\uFFFC');
      const off = head - $h.start();
      const Seg = (Intl as any).Segmenter;
      const side = dir < 0 ? text.slice(0, off) : text.slice(off);
      let n = 1;
      if (Seg && side) {
        const segs = [...new Seg(undefined, { granularity: 'grapheme' }).segment(side)] as { segment: string }[];
        n = (dir < 0 ? segs[segs.length - 1] : segs[0])?.segment.length ?? 1;
      }
      const inBlock = dir < 0 ? off > 0 : off < text.length;
      if (inBlock) target = head + dir * n;
    }
    const nb = dir > 0 ? $h.nodeAfter : $h.nodeBefore;
    if (nb && !nb.isText && nb.isInline && unit === 'char') {
      ed.view.dispatch(ed.state.tr.delete(dir > 0 ? head : head - nb.nodeSize, dir > 0 ? head + nb.nodeSize : head).scrollIntoView());
      return;
    }
    if (target === null || (nb && !nb.isText && nb.isInline)) {
      // 段首、段尾、贴着公式引用这类原子节点：并段 / 删节点交给键位表
      dispatchKey(ed, { key: dir < 0 ? 'Backspace' : 'Delete', code: dir < 0 ? 'Backspace' : 'Delete' });
      return;
    }
    const from = Math.min(head, target), to = Math.max(head, target);
    if (from < $h.start() || to > $h.end()) { dispatchKey(ed, { key: dir < 0 ? 'Backspace' : 'Delete', code: dir < 0 ? 'Backspace' : 'Delete' }); return; }
    ed.view.dispatch(ed.state.tr.delete(from, to).scrollIntoView());
  };
  const lineEdge = (ed: Editor, edge: 'start' | 'end', extend: boolean) => {
    if (!caret || !activeKey) return;
    const gs = caret.line.glyphs.filter((g) => g.key === activeKey && g.kind === 'text');
    if (!gs.length) return;
    const g = edge === 'start' ? gs[0] : gs[gs.length - 1];
    const p = nowPos(activeKey, edge === 'start' ? g.from : g.to, edge === 'start' ? 1 : -1);
    if (p === null) return;
    setSelection(ed, extend ? ed.state.selection.anchor : p, p);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!editor || !activeKey) return;
    if (e.nativeEvent.isComposing || e.keyCode === 229 || composing !== null) return;
    const mod = isMac ? e.metaKey : e.ctrlKey;
    const ed = editor;
    const k = e.key;
    if (k !== 'ArrowUp' && k !== 'ArrowDown') goalX.current = null;
    if (k === 'Escape') { inputRef.current?.blur(); return; }
    if (k === 'Home' || (isMac && mod && k === 'ArrowLeft')) { e.preventDefault(); lineEdge(ed, 'start', e.shiftKey); return; }
    if (k === 'End' || (isMac && mod && k === 'ArrowRight')) { e.preventDefault(); lineEdge(ed, 'end', e.shiftKey); return; }
    if (k === 'ArrowLeft' || k === 'ArrowRight') { e.preventDefault(); moveH(ed, k === 'ArrowLeft' ? -1 : 1, e.shiftKey, e.altKey || (!isMac && e.ctrlKey)); return; }
    if (k === 'ArrowUp' || k === 'ArrowDown') { e.preventDefault(); moveV(ed, k === 'ArrowUp' ? -1 : 1, e.shiftKey); return; }
    if (k === 'PageUp' || k === 'PageDown') return; // 让滚动容器自己滚
    if (mod && (k === 'c' || k === 'x' || k === 'v')) return; // 交给 copy / cut / paste 事件
    if (mod && k === 'a') { e.preventDefault(); ed.commands.selectAll(); return; }
    if (mod && (k === 'f' || k === 'h')) { e.preventDefault(); void import('./Ribbon').then((m) => m.useFindBar.getState().set(true)); return; }
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) ed.commands.redo(); else ed.commands.undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); ed.commands.redo(); return; }
    if (mod && k === 'b') { e.preventDefault(); ed.commands.toggleBold(); return; }
    if (mod && k === 'i') { e.preventDefault(); ed.commands.toggleItalic(); return; }
    if (mod && k === 'u') { e.preventDefault(); ed.commands.toggleUnderline(); return; }
    if (k === 'Backspace' || k === 'Delete') {
      e.preventDefault();
      deleteChar(ed, k === 'Backspace' ? -1 : 1, e.altKey || (!isMac && e.ctrlKey) ? 'word' : isMac && mod ? 'line' : 'char');
      return;
    }
    if (k === 'Enter' || k === 'Tab') {
      e.preventDefault();
      if (k === 'Enter' && ed.state.selection instanceof NodeSelection) {
        const sel = ed.state.selection;
        if (sel.node.isBlock) { const tr = ed.state.tr.insert(sel.to, ed.state.schema.nodes.paragraph.create()); ed.view.dispatch(tr.setSelection(TextSelection.create(tr.doc, sel.to + 1)).scrollIntoView()); return; }
        ed.commands.setTextSelection(sel.to);
      }
      dispatchKey(ed, { key: k, code: k, shiftKey: e.shiftKey, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey });
      if (k === 'Enter') setPending(null);
      return;
    }
    // 其余可打印字符走 input 事件（输入法也从那儿来）
  };
  const onInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const ne = e.nativeEvent as InputEvent;
    if (compositionActive.current || ne.isComposing) return;
    // Some browsers emit one final input event after compositionend.
    if (compositionCommit.current !== null && (ne.data === compositionCommit.current || /Composition/i.test(ne.inputType ?? ''))) {
      compositionCommit.current = null;
      el.value = '';
      return;
    }
    compositionCommit.current = null;
    const text = el.value;
    el.value = '';
    if (!text || !editor || !activeKey) return;
    insertText(editor, text);
  };
  const onCompositionStart = () => {
    if (!compositionActive.current) {
      compositionActive.current = true;
      useInputState.getState().begin();
    }
    compositionCommit.current = null;
    setComposing('');
  };
  const onCompositionUpdate = (e: React.CompositionEvent<HTMLTextAreaElement>) => setComposing(e.data ?? '');
  const onCompositionEnd = (e: React.CompositionEvent<HTMLTextAreaElement>) => {
    const text = e.data ?? '';
    if (compositionActive.current) {
      compositionActive.current = false;
      useInputState.getState().end();
    }
    compositionCommit.current = text;
    window.setTimeout(() => { compositionCommit.current = null; }, 0);
    setComposing(null);
    if (inputRef.current) inputRef.current.value = '';
    if (text && editor && activeKey) insertText(editor, text);
  };
  useEffect(() => () => {
    if (compositionActive.current) {
      compositionActive.current = false;
      useInputState.getState().end();
    }
  }, []);
  const selectedText = (ed: Editor) => {
    const { from, to } = ed.state.selection;
    return ed.state.doc.textBetween(from, to, '\n', (n) => (n.type.name === 'mathInline' ? `$${n.attrs.src}$` : n.type.name === 'hardBreak' ? '\n' : ''));
  };
  const onCopy = (e: React.ClipboardEvent<HTMLTextAreaElement>, cut = false) => {
    if (!editor || editor.state.selection.empty) return;
    e.preventDefault();
    const slice = editor.state.selection.content();
    const ser = (editor.view as any).serializeForClipboard?.(slice) as { dom: HTMLElement; text: string } | undefined;
    e.clipboardData.setData('text/plain', ser?.text ?? selectedText(editor));
    if (ser) e.clipboardData.setData('text/html', ser.dom.innerHTML);
    if (cut) editor.view.dispatch(editor.state.tr.deleteSelection().scrollIntoView());
  };
  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!editor) return;
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    const view = editor.view as any;
    if (html && typeof view.pasteHTML === 'function') view.pasteHTML(html, e.nativeEvent);
    else if (text && typeof view.pasteText === 'function') view.pasteText(text, e.nativeEvent);
    else if (text) insertText(editor, text);
  };

  // ── 画 ──────────────────────────────────────────────────────
  const caretPx = caret ? pageTo(caret.page, caret.x, caret.y) : null;
  const caretH = caret && caretPx ? caret.h * caretPx.scale : 0;
  const pendingText = pending && pending.key === activeKey ? pending.text : '';
  const overlayText = composing !== null ? composing : pendingText;
  const overlayW = useMemo(() => (overlayText && caretH && !(composing === null && pending?.fading) ? measureText(overlayText, caretH * 0.92) : 0), [overlayText, caretH, composing, pending?.fading]);
  const caretLeft = caretPx ? caretPx.left + overlayW : 0;

  return (
    <div ref={layerRef} data-active={activeKey ?? ''} data-focused={focused ? 1 : 0} className={`pv-layer ${cursor} ${focused ? 'is-focused' : ''}`} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerLeave={() => setCursor('')} onContextMenu={(e) => { void onContextMenu(e); }}>
      {rects.map((r, i) => { const p = pageTo(r.page, r.x, r.y); return p ? <div key={i} className="pv-sel" style={{ left: p.left, top: p.top, width: r.w * p.scale, height: r.h * p.scale }} /> : null; })}
      {gone.map((r, i) => { const p = pageTo(r.page, r.x, r.y); return p ? <div key={`g${i}`} className="pv-gone" style={{ left: p.left, top: p.top, width: r.w * p.scale + 0.5, height: r.h * p.scale }} /> : null; })}
      {commentRects.map((c) => c.rects.map((r, i) => { const p = pageTo(r.page, r.x, r.y); return p ? <div key={`c${c.id}${i}`} className={`pv-comment ${activeComment === c.id ? 'is-active' : ''}`} style={{ left: p.left, top: p.top, width: r.w * p.scale, height: r.h * p.scale }} /> : null; }))}
      {marks.map((r, i) => { const p = pageTo(r.page, r.x, r.y); if (!p) return null; if (r.space) return <span key={`m${i}`} className="pv-mark is-space" style={{ left: p.left, top: p.top, width: (r.w ?? r.h * 0.3) * p.scale, height: r.h * p.scale, fontSize: r.h * p.scale * 0.8, lineHeight: `${r.h * p.scale}px` }}>·</span>; const gutter = r.noIndent && !r.blank; return <span key={`m${i}`} className={`pv-mark ${r.blank ? 'is-blank' : ''} ${gutter || (r.noIndent && r.blank) ? 'is-gutter' : ''}`} style={{ left: p.left - (r.noIndent ? r.h * p.scale * 1.2 : 0), top: p.top, height: r.h * p.scale, fontSize: r.h * p.scale * 0.8, lineHeight: `${r.h * p.scale}px` }}>{r.noIndent && !r.blank ? '⇤' : r.blank && r.noIndent ? '⇤¶' : '¶'}</span>; })}
      {caretPx && overlayText && (
        <span className={`pv-overlay ${composing !== null ? 'is-composing' : ''} ${composing === null && pending?.fading ? 'is-fading' : ''}`} style={{ left: caretPx.left, top: caretPx.top, height: caretH, fontSize: caretH * 0.92, lineHeight: `${caretH}px` }}>{overlayText}</span>
      )}
      {caretPx && sel?.empty !== false && (
        <div className={`pv-caret ${focused ? '' : 'is-idle'}`} style={{ left: caretLeft, top: caretPx.top, height: caretH }} />
      )}
      <textarea
        key="preview-input"
        ref={inputRef}
        className="pv-input"
        style={caretPx ? { left: caretLeft, top: caretPx.top, height: Math.max(1, caretH) } : { left: 0, top: 0 }}
        aria-label={tx("在预览里直接编辑")}
        autoCapitalize="off" autoCorrect="off" spellCheck={false} autoComplete="off"
        onFocus={() => setSurface({ focused: true })}
        onBlur={() => {
          if (compositionActive.current) {
            compositionActive.current = false;
            useInputState.getState().end();
          }
          compositionCommit.current = null;
          setSurface({ focused: false });
          setComposing(null);
        }}
        onKeyDown={onKeyDown}
        onInput={onInput}
        onCompositionStart={onCompositionStart}
        onCompositionUpdate={onCompositionUpdate}
        onCompositionEnd={onCompositionEnd}
        onCopy={(e) => onCopy(e)}
        onCut={(e) => onCopy(e, true)}
        onPaste={onPaste}
      />
    </div>
  );
}

// ── 小工具 ────────────────────────────────────────────────────

let canvas: CanvasRenderingContext2D | null = null;
function measureText(text: string, px: number): number {
  canvas ??= document.createElement('canvas').getContext('2d');
  if (!canvas) return text.length * px;
  canvas.font = `${px}px "Noto Serif CJK SC", "Times New Roman", serif`;
  return canvas.measureText(text).width;
}

/** 词的范围：Intl.Segmenter 分词（中文按词、英文按单词），没有就按字符类 */
function wordRange(ed: Editor, pos: number, dir: -1 | 1 = 1): { from: number; to: number } {
  const doc = ed.state.doc;
  const p = Math.max(0, Math.min(doc.content.size, pos));
  const $p = doc.resolve(p);
  if (!$p.parent.isTextblock) return { from: p, to: p };
  const start = $p.start();
  // 原子节点占一个字符，用占位符顶着，偏移才对得上
  const text = doc.textBetween(start, $p.end(), undefined, '￼');
  const off = p - start;
  const Seg = (Intl as any).Segmenter;
  if (Seg) {
    const segs = [...new Seg(undefined, { granularity: 'word' }).segment(text)] as { segment: string; index: number; isWordLike?: boolean }[];
    for (const s of segs) {
      const a = s.index, b = s.index + s.segment.length;
      if (off >= a && off < b) return { from: start + a, to: start + b };
      if (off === b && dir < 0) return { from: start + a, to: start + b };
    }
    return { from: p, to: p };
  }
  const cls = (c: string) => (/[\p{L}\p{N}_]/u.test(c) ? 'w' : /\s/.test(c) ? 's' : 'p');
  let a = off, b = off;
  const c0 = cls(text[Math.min(off, text.length - 1)] ?? ' ');
  while (a > 0 && cls(text[a - 1]) === c0) a--;
  while (b < text.length && cls(text[b]) === c0) b++;
  return { from: start + a, to: start + b };
}

export type { Line };
