// 页面视图的编辑覆盖层。输入与选区写回 ProseMirror；字形映射更新前先显示临时文字。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { create } from 'zustand';
import type { Editor } from '@tiptap/core';
import { NodeSelection, Selection, TextSelection } from '@tiptap/pm/state';
import { useCompileState } from '../compiler/client';
import { useStore, type RichKey, type Section } from '../model/store';
import { sectionOfInfo } from '../model/info';
import { focusInfo, renderSnippetSvg } from '../compiler/renderer';
import { getEditor, onRegistryChange, whenEditorReady } from '../editor/registry';
import { docVersion, mappingBetween, mappingSince, toNewPos, toOldPos } from '../editor/versions';
import { useOpenRequest } from '../editor/openRequest';
import { useBlockMenu } from '../editor/BlockMenu';
import { isJumpModifier, openLink } from '../editor/jump';
import { useComments } from '../editor/comments';
import { buildIndex, mergeIndex, patchIndex, linesOfRange, caretRect, attrCaret, hitPos, hitTest, lineStep, selectionRects, paragraphMarks, EMPTY_INDEX, type CaretRect, type Glyph, type Hit, type Line } from './previewEdit';
import { t as tx } from '../i18n';
import { useInputState } from '../editor/inputState';
import { applyLineShift, restoreLineShift } from './previewShift';

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

/** 这一点底下有没有 typst.ts 画的链接：目录条目、图表引用、文献回跳是 handleTypstLocation(this, 页, x, y)，外链带 href */
type LinkHit = { page: number; x: number; y: number } | { href: string };
function linkAt(clientX: number, clientY: number): LinkHit | null {
  // elementsFromPoint 给的是命中的叶子（rect / use）与 svg 根，中间的 <a> 得自己往上找
  for (const hit of document.elementsFromPoint(clientX, clientY)) {
    const el = hit.closest('a');
    if (!el) continue;
    const m = /handleTypstLocation\(this,\s*(\d+),\s*([\d.]+),\s*([\d.]+)\)/.exec(el.getAttribute('onclick') ?? '');
    if (m) return { page: Number(m[1]), x: Number(m[2]), y: Number(m[3]) };
    const href = el.getAttribute('href') ?? el.getAttribute('xlink:href') ?? '';
    if (href && href !== '#') return { href };
  }
  return null;
}

export function PreviewEditLayer({ docRef, scrollRef, renderTick }: { docRef: RefObject<HTMLDivElement | null>; scrollRef: RefObject<HTMLDivElement | null>; renderTick: number }) {
  // 字形表跟着*画上去的*那一版走（renderTick），不跟编译回来的那一刻：产物落地到画进 DOM 有几十到几百毫秒，这段里
  // 按新表算光标 / 暂印 / 让位，画在旧字上就是一帧错乱
  const rendered = useMemo(() => { const s = useCompileState.getState(); return { glyphs: s.glyphs, segments: s.segments, mapVersion: s.mapVersion, focusGlyphs: s.focusGlyphs, focusSegments: s.focusSegments, focusMapVersion: s.focusMapVersion }; }, [renderTick]);
  const { glyphs, segments, mapVersion, focusGlyphs, focusSegments, focusMapVersion } = rendered;
  const fullIndex = useMemo(() => (glyphs ? buildIndex(glyphs, segments, mapVersion) : EMPTY_INDEX), [glyphs, segments, mapVersion]);
  const focusIndex = useMemo(() => (focusGlyphs ? buildIndex(focusGlyphs, focusSegments, focusMapVersion) : null), [focusGlyphs, focusSegments, focusMapVersion]);
  // 只编一章嵌进来的页数与它顶掉的母本页数不等时，字形表（按上次整编的页码）与展示层的页序错开一截
  const [focusMap, setFocusMap] = useState<{ start: number; baseCount: number; count: number } | null>(null);
  // 那一章有自己的字形表时并成一份，页码就是展示层的页序；没有时（字形表还没回来）按嵌入位置换算页序
  const merged = !!focusIndex && !!focusMap && focusIndex.version >= fullIndex.version;
  const baseIndex = useMemo(() => {
    if (!merged) return fullIndex;
    const maps = new Map<string, ReturnType<typeof mappingBetween>>();
    const mapPos = (key: string, pos: number, assoc: -1 | 1) => {
      let m = maps.get(key);
      if (m === undefined) { m = mappingBetween(key as RichKey, fullIndex.version, focusIndex!.version); maps.set(key, m); }
      return m ? m.map(pos, assoc) : null;
    };
    return mergeIndex(fullIndex, focusIndex!, focusMap!.start, focusMap!.baseCount, focusMap!.count, mapPos);
  }, [merged, fullIndex, focusIndex, focusMap]);
  // 打字即时回显：只编了这一段的字形表盖进索引，位置对到这一段原来的首行
  const para = useCompileState((s) => s.para);
  const paraIndex = useMemo(() => (para ? buildIndex(para.glyphs, para.segments, para.version) : null), [para]);
  const paraPatch = useMemo(() => {
    if (!para || !paraIndex || paraIndex.version < baseIndex.version || !paraIndex.count) return null;
    const m = mappingBetween(para.key as RichKey, baseIndex.version, para.version);
    if (!m) return null;
    const old = linesOfRange(baseIndex, para.key, para.from, para.to, (pos, assoc) => m.map(pos, assoc));
    if (!old.length) return null;
    const first = old[0].line;
    const onPage = old.filter((l) => l.line.page === first.page);
    const fresh = (paraIndex.pages[0] ?? []).slice().sort((a, b) => a.y - b.y);
    if (!fresh.length) return null;
    const dy = first.y - fresh[0].y;
    // 逐行盖：每行只盖这一段自己的字占到的那一截（首行前面可能是上一段的尾巴，末行后面可能是下一段的头）
    const cover = onPage.map((l) => ({ x0: l.x0, x1: l.x1, y0: l.line.y, y1: l.line.y + l.line.h }));
    const maps = new Map<string, ReturnType<typeof mappingBetween>>();
    const mapPos = (key: string, pos: number, assoc: -1 | 1) => {
      let mm = maps.get(key);
      if (mm === undefined) { mm = mappingBetween(key as RichKey, baseIndex.version, para.version); maps.set(key, mm); }
      return mm ? mm.map(pos, assoc) : null;
    };
    return { page: first.page, dy, cover, index: patchIndex(baseIndex, paraIndex, para.key, para.from, para.to, first.page, dy, mapPos) };
  }, [para, paraIndex, baseIndex]);
  const index = paraPatch ? paraPatch.index : baseIndex;
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
  // 就地改题注 / 脚注文字这类节点属性：节点在现在这一版里的位置、哪个属性、光标在值里第几个字
  const [attrEdit, setAttrEdit] = useState<{ key: RichKey; pos: number; attr: string; offset: number } | null>(null);
  /** 字形表追上来那一刻，刚才暂印的字淡出，与真字形交叉 */
  const [fading, setFading] = useState<{ key: RichKey; text: string } | null>(null);
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
    // 比例按 SVG 真正画出来的算：宽是小数，高（height: auto）却被浏览器取整到整像素——十几万单位高的
    // 卷子上差出万分之一，preserveAspectRatio 取两轴里小的那个，一百多页往下就漂十几 pt；
    // 捏合进行中舞台是 transform 缩放的，除回去（getScreenCTM 会把手势再算一遍）
    const gesture = parseFloat(doc.dataset.scale ?? '1') || 1;
    const rect = svg.getBoundingClientRect();
    const sx = rect.width / gesture / (vb.width || 1), sy = rect.height / gesture / (vb.height || 1);
    const scale = (Math.min(sx, sy) || parseFloat(svg.getAttribute('width') ?? '0') / (vb.width || 1));
    const ox = Math.max(0, (rect.width / gesture - vb.width * scale) / 2), oy = Math.max(0, (rect.height / gesture - vb.height * scale) / 2);
    const out: PageGeom[] = [];
    svg.querySelectorAll<SVGGElement>(':scope > g.typst-page').forEach((g, i) => {
      const w = parseFloat(g.getAttribute('data-page-width') ?? '0') || 1;
      const h = parseFloat(g.getAttribute('data-page-height') ?? '0') || 1;
      const x = parseFloat(g.getAttribute('data-layout-x') ?? '0');
      const y = parseFloat(g.getAttribute('data-layout-y') ?? '0');
      out[i] = { left: ox + (x - vb.x) * scale, top: oy + (y - vb.y) * scale, scale, w, h };
    });
    const f = doc.querySelector<HTMLElement>(':scope > .preview-doc');
    setFocusMap(f ? focusInfo(f) : null);
    setGeom(out);
  }, [docRef]);
  /** 字形表的页码 → 展示层的页序；那一章里多出来 / 少掉的页没有对应，-1 */
  const toDisplay = (p: number): number => {
    const f = focusMap;
    if (!f || merged) return p;
    if (p < f.start) return p;
    if (p < f.start + f.baseCount) return p - f.start < f.count ? p : -1;
    return p + f.count - f.baseCount;
  };
  // 打字即时回显的画面：这一段单独排出来的 SVG 贴到它原来的位置上，原来的行用纸色盖住；整编 / 只编一章追上来就撤
  useEffect(() => {
    const view = docRef.current?.querySelector<SVGSVGElement>(':scope > .preview-doc > svg.typst-doc');
    view?.querySelectorAll(':scope .para-live').forEach((e) => e.remove());
    if (!para || !paraPatch || !view) return;
    let alive = true;
    const NS = 'http://www.w3.org/2000/svg';
    renderSnippetSvg(para.artifact).then((svgStr) => {
      if (!alive) return;
      const src = new DOMParser().parseFromString(svgStr, 'image/svg+xml').documentElement;
      const pageG = view.querySelectorAll<SVGGElement>(':scope > g.typst-page')[toDisplay(paraPatch.page)];
      const srcPage = src.querySelector('g.typst-page');
      if (!pageG || !srcPage) return;
      let defs = view.querySelector(':scope > defs');
      if (!defs) { defs = document.createElementNS(NS, 'defs'); view.prepend(defs); }
      for (const d of src.querySelectorAll('defs > *')) { const id = d.getAttribute('id'); if (id && !document.getElementById(id)) defs.appendChild(document.importNode(d, true)); }
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('class', 'para-live');
      for (const { x0, x1, y0, y1 } of paraPatch.cover) {
        const cover = document.createElementNS(NS, 'rect');
        cover.setAttribute('x', String(x0 - 1)); cover.setAttribute('y', String(y0 - 1)); cover.setAttribute('width', String(x1 - x0 + 2)); cover.setAttribute('height', String(y1 - y0 + 2));
        cover.setAttribute('fill', 'var(--paper)');
        g.appendChild(cover);
      }
      const inner = document.createElementNS(NS, 'g');
      inner.setAttribute('transform', `translate(0, ${paraPatch.dy})`);
      for (const c of srcPage.children) inner.appendChild(document.importNode(c, true));
      g.appendChild(inner);
      pageG.appendChild(g);
    }).catch(() => { /* 片段画不出来就不画 */ });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [para, paraPatch, renderTick]);
  // 开发时给 Playwright 探针看的

  const toGlyphPage = (d: number): number => {
    const f = focusMap;
    if (!f || merged) return d;
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
  /** 尚未进入排版结果的文字：*从文档算，不靠记键*——字形表那一版的光标位置换到现在，到现在的光标之间就是这段
   *  时间里在这儿敲进去的字（中间退掉的自然不在里面；上一次编辑没排完就增删也照样对）。光标锚定在输入起点，
   *  覆盖文字的宽度由 overlay 补偿 */
  const pendingText = useMemo(() => {
    if (!editor || !activeKey || !sel || !sel.empty || !stale || composing !== null) return '';
    const oldHead = toOldPos(activeKey, index.version, sel.head, -1);
    if (oldHead === null) return '';
    const from = toNewPos(activeKey, index.version, oldHead, -1);
    if (from === null || from >= sel.head) return '';
    return editor.state.doc.textBetween(from, sel.head, undefined, '\uFFFC');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, activeKey, sel, stale, index, composing]);
  const pendingLen = pendingText.length;
  const caret = useMemo((): CaretRect | null => {
    if (!sel || !activeKey) return null;
    if (attrEdit && attrEdit.key === activeKey) { const old = oldPos(attrEdit.pos, 1); return old === null ? null : attrCaret(index, activeKey, old, attrEdit.attr, attrEdit.offset); }
    const head = sel.empty && pendingLen ? Math.max(0, sel.head - pendingLen) : sel.head;
    const p = oldPos(head, sel.head === sel.to ? -1 : 1);
    if (p === null) return null;
    return caretRect(index, activeKey, p, prefer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, activeKey, index, stale, pendingLen, attrEdit]);
  const rects = useMemo(() => {
    if (!sel || !activeKey || sel.empty || attrEdit) return [];
    const a = oldPos(sel.from, 1), b = oldPos(sel.to, -1);
    if (a === null || b === null) return [];
    return selectionRects(index, activeKey, a, b, caret ? { page: caret.page, y: caret.y } : prefer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, activeKey, index, caret, stale, attrEdit]);
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

  // 字形表跟上了（暂印的字没了）：刚才那段淡出，与真字形交叉
  const lastPending = useRef('');
  useEffect(() => {
    if (pendingText) { lastPending.current = pendingText; return; }
    if (lastPending.current && activeKey) { setFading({ key: activeKey, text: lastPending.current }); lastPending.current = ''; }
  }, [pendingText, activeKey]);
  useEffect(() => {
    if (!fading) return;
    const t = window.setTimeout(() => setFading(null), 220);
    return () => window.clearTimeout(t);
  }, [fading]);
  // 删除内容应在重排前隐藏：若旧字形映射到当前文档后已折叠为空，
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
  const lastSelKey = useRef('');
  const skipFollow = useRef(false);
  /** 点击落定前（等编辑器挂上、选区还是旧的）画出的光标不算数，别拿它盖掉点击处的 prefer */
  const clickPending = useRef(false);
  /** 选区动过、光标还没跟着重画（打字时光标停在原处等编译）：等它重画那一下要跟；用户自己一滚就作罢 */
  const followDue = useRef(false);
  const selfScroll = useRef(0);
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const onScroll = () => { if (performance.now() > selfScroll.current) followDue.current = false; };
    sc.addEventListener('scroll', onScroll, { passive: true });
    return () => sc.removeEventListener('scroll', onScroll);
  }, [scrollRef]);
  useEffect(() => {
    // 只在选区真动了才跟：编译回来字形表换了一份、光标只是重画到新位置，不算——用户可能已经滚去看别处了
    const sk = `${activeKey}:${sel?.from}:${sel?.to}:${docVersion()}`;
    if (sk !== lastSelKey.current) { lastSelKey.current = sk; followDue.current = true; }
    if (!caret) return;
    const k = `${caret.page}:${caret.x.toFixed(1)}:${caret.y.toFixed(1)}`;
    if (k === lastCaretKey.current) return;
    lastCaretKey.current = k;
    if (clickPending.current) return;
    prefer.current = { page: caret.page, y: caret.y };
    if (skipFollow.current) { skipFollow.current = false; followDue.current = false; return; }
    if (!followDue.current) return;
    followDue.current = false;
    const sc = scrollRef.current;
    const pt = pageTo(caret.page, caret.x, caret.y);
    if (!sc || !pt || !docRef.current) return;
    const top = docRef.current.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop + pt.top;
    const bottom = top + caret.h * pt.scale;
    if (top < sc.scrollTop + 20 || bottom > sc.scrollTop + sc.clientHeight - 20) {
      selfScroll.current = performance.now() + 800;
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
    ed.view.dispatch(ed.state.tr.insertText(text).scrollIntoView());
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

  // 属性值按路径读写（题注是 caption，表注是 notes.0.text 这种）；改完是一笔普通事务，能撤消
  const getPath = (o: any, path: string): unknown => path.split('.').reduce((a, k) => a?.[k], o);
  const setPath = (o: any, path: string, v: unknown): any => { const [k, ...rest] = path.split('.'); const c = Array.isArray(o) ? [...o] : { ...(o ?? {}) }; c[k] = rest.length ? setPath(o?.[k], rest.join('.'), v) : v; return c; };
  const attrValue = (ed: Editor): string | null => { if (!attrEdit) return null; const n = ed.state.doc.nodeAt(attrEdit.pos); const v = n ? getPath(n.attrs, attrEdit.attr) : null; return typeof v === 'string' ? v : null; };
  const attrWrite = (ed: Editor, value: string, offset: number) => {
    if (!attrEdit) return;
    const n = ed.state.doc.nodeAt(attrEdit.pos);
    if (!n) { setAttrEdit(null); return; }
    ed.view.dispatch(ed.state.tr.setNodeMarkup(attrEdit.pos, undefined, setPath(n.attrs, attrEdit.attr, value)));
    setAttrEdit({ ...attrEdit, offset });
  };
  const attrInsert = (ed: Editor, text: string) => { const v = attrValue(ed); if (v === null) return; const o = Math.min(attrEdit!.offset, v.length); attrWrite(ed, v.slice(0, o) + text + v.slice(o), o + text.length); };
  /** 属性值里光标前 / 后那个字素有几个码元 */
  const graphemeLen = (v: string, o: number, dir: -1 | 1) => { const side = dir < 0 ? v.slice(0, o) : v.slice(o); if (!side) return 0; const Seg = (Intl as any).Segmenter; if (!Seg) return 1; const segs = [...new Seg(undefined, { granularity: 'grapheme' }).segment(side)] as { segment: string }[]; return (dir < 0 ? segs[segs.length - 1] : segs[0])?.segment.length ?? 1; };
  const attrKey = (ed: Editor, k: string, shift: boolean): boolean => {
    const v = attrValue(ed);
    if (v === null) { setAttrEdit(null); return false; }
    const o = Math.min(attrEdit!.offset, v.length);
    if (k === 'ArrowLeft' || k === 'ArrowRight') { const d = k === 'ArrowLeft' ? -1 : 1; setAttrEdit({ ...attrEdit!, offset: Math.max(0, Math.min(v.length, o + d * graphemeLen(v, o, d))) }); return true; }
    if (k === 'Home') { setAttrEdit({ ...attrEdit!, offset: 0 }); return true; }
    if (k === 'End') { setAttrEdit({ ...attrEdit!, offset: v.length }); return true; }
    if (k === 'Backspace') { const n = graphemeLen(v, o, -1); if (n) attrWrite(ed, v.slice(0, o - n) + v.slice(o), o - n); return true; }
    if (k === 'Delete') { const n = graphemeLen(v, o, 1); if (n) attrWrite(ed, v.slice(0, o) + v.slice(o + n), o); return true; }
    if (k === 'Enter' || k === 'Tab' || k === 'ArrowUp' || k === 'ArrowDown') { void shift; return true; }
    return false;
  };

  /** 一个「属性」字形（题注、脚注文字、论文信息）：把对应的输入框打开、光标放到那个字 */
  const openAttr = async (g: Glyph, side: 'before' | 'after') => {
    const offset = Math.max(0, (side === 'before' ? g.from : g.to) - (g.kind === 'attr' ? g.seg.pmFrom : 0));
    if (g.kind === 'info') {
      const st = useStore.getState();
      st.setView('editor'); st.setSection(sectionOfInfo(g.seg.attr ?? ""));
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
  /** 滚到某页的某个点（typst.ts 链接给的页号从 1 数，坐标是那页里的 pt） */
  const scrollToPoint = (page: number, y: number) => {
    const sc = scrollRef.current, layer = layerRef.current;
    const g = geom[toDisplay(page - 1)];
    if (!sc || !layer || !g) return;
    const top = layer.getBoundingClientRect().top + g.top + y * g.scale - sc.getBoundingClientRect().top + sc.scrollTop;
    sc.scrollTo({ top: Math.max(0, top - 24), behavior: 'smooth' });
  };
  useEffect(() => {
    // typst.ts 给内部链接写的是 onclick="handleTypstLocation(...)"，这里定义它省得漏到它时报错
    (window as unknown as { handleTypstLocation?: unknown }).handleTypstLocation = (_el: unknown, page: number, _x: number, y: number) => scrollToPoint(page, y);
  });
  const follow = (l: LinkHit) => { if ('href' in l) openLink(l.href); else scrollToPoint(l.page, l.y); };
  const pointerDown = async (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // ⌘ / Ctrl + 点链接：目录条目跳到那一章、图表引用跳到图表、引文跳到文献表、外链新窗口打开
    if (isJumpModifier(e)) { const l = linkAt(e.clientX, e.clientY); if (l) { e.preventDefault(); follow(l); return; } }
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
      if (detail >= 2 || g.kind === 'info' || !g.seg.attr) { setAttrEdit(null); void openAttr(g, hit.side); return; }
      // 单击题注 / 脚注文字：就地改——节点选中（编辑区跟着），光标落在值里那个字
      const ed = await activate(g.key as RichKey);
      const pos = ed ? nowPos(g.key as RichKey, g.seg.pmFrom) : null;
      if (!ed || pos === null) return;
      setSelection(ed, pos, pos, true);
      setAttrEdit({ key: g.key as RichKey, pos, attr: g.seg.attr, offset: Math.max(0, (hit.side === 'before' ? g.from : g.to) - g.seg.pmFrom) });
      focusInput();
      return;
    }
    setAttrEdit(null);
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
    const mod = isJumpModifier(e);
    hoverRaf.current = requestAnimationFrame(() => {
      if (mod && linkAt(clientX, clientY)) { setCursor('cur-link'); return; }
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
   * 退格与删除。此层不使用 contenteditable，因此自行处理字素、单词和行级删除；
   * 合并段落和删除原子节点仍交给 ProseMirror 键位表。
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
    if (k === 'Escape') { setAttrEdit(null); inputRef.current?.blur(); return; }
    if (attrEdit && !mod && !e.altKey) { if (attrKey(ed, k, e.shiftKey)) { e.preventDefault(); return; } }
    if (attrEdit && mod && (k === 'z' || k === 'y')) { e.preventDefault(); if (k === 'y' || e.shiftKey) ed.commands.redo(); else ed.commands.undo(); return; }
    if (attrEdit && mod) { e.preventDefault(); return; }
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
    if (attrEdit) attrInsert(editor, text); else insertText(editor, text);
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
    if (text && editor && activeKey) { if (attrEdit) attrInsert(editor, text); else insertText(editor, text); }
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
  useEffect(() => { if (import.meta.env.DEV) (window as unknown as { __pv?: unknown }).__pv = { index, geom, focusMap, merged, caret, sel: sel && { from: sel.from, to: sel.to }, ver: docVersion(), hitAt, activeKey, editor: !!editor }; }, [index, geom, focusMap, merged, caret, sel]);
  const caretPx = caret ? pageTo(caret.page, caret.x, caret.y) : null;
  const caretH = caret && caretPx ? caret.h * caretPx.scale : 0;
  const fadingText = !pendingText && composing === null && fading && fading.key === activeKey ? fading.text : '';
  const overlayText = composing !== null ? composing : pendingText || fadingText;
  const overlayW = useMemo(() => (overlayText && caretH && !fadingText ? measureText(overlayText, caretH * 0.92) : 0), [overlayText, caretH, fadingText]);
  const caretLeft = caretPx ? caretPx.left + overlayW : 0;
  // 等重排那一会儿：光标后面同一行的字形就地让开暂印的那几个字，删掉的字形当场藏起来（藏不住的仍用纸色遮）
  const [hiddenGone, setHiddenGone] = useState<Set<(typeof gone)[number]>>(() => new Set());
  useLayoutEffect(() => {
    const view = docRef.current?.querySelector<SVGSVGElement>(':scope > .preview-doc > svg.typst-doc');
    const pageG = caret && view ? view.querySelectorAll<SVGGElement>(':scope > g.typst-page')[toDisplay(caret.page)] : null;
    if (!caret || !pageG || (!overlayW && !gone.length) || fadingText) { restoreLineShift(); setHiddenGone((h) => (h.size ? new Set() : h)); return; }
    const scale = caretPx?.scale || 1;
    const onLine = gone.filter((g) => g.page === caret.page && g.y + g.h > caret.y && g.y < caret.y + caret.h && g.x >= caret.x - 0.5);
    const hidden = applyLineShift(pageG, { caret, dx: overlayW / scale - onLine.reduce((w, g) => w + g.w, 0), hide: gone.filter((g) => g.page === caret.page) });
    setHiddenGone(hidden);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caret, overlayW, gone, fadingText, renderTick]);
  useEffect(() => () => restoreLineShift(), []);
  // 隐形输入框跟着光标走，但别跑出纸的右边、也别在光标算不出来时跳回 (0,0)——浏览器会把滚动容器
  // 卷过去追焦点里的输入框，整个预览就横着 / 竖着飞走了
  const inputPos = useRef({ left: 0, top: 0 });
  if (caretPx) {
    const g = geom[toDisplay(caret!.page)];
    const right = g ? g.left + g.w * g.scale - 4 : caretLeft;
    inputPos.current = { left: Math.min(caretLeft, right), top: caretPx.top };
  } else if (scrollRef.current && docRef.current) {
    const sc = scrollRef.current;
    const dtop = docRef.current.getBoundingClientRect().top - sc.getBoundingClientRect().top;
    inputPos.current = { left: sc.scrollLeft, top: Math.max(0, sc.scrollTop - dtop) };
  }

  return (
    <div ref={layerRef} data-active={activeKey ?? ''} data-focused={focused ? 1 : 0} className={`pv-layer ${cursor} ${focused ? 'is-focused' : ''}`} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerLeave={() => setCursor('')} onContextMenu={(e) => { void onContextMenu(e); }}>
      {rects.map((r, i) => { const p = pageTo(r.page, r.x, r.y); return p ? <div key={i} className="pv-sel" style={{ left: p.left, top: p.top, width: r.w * p.scale, height: r.h * p.scale }} /> : null; })}
      {gone.map((r, i) => { if (hiddenGone.has(r)) return null; const p = pageTo(r.page, r.x, r.y); return p ? <div key={`g${i}`} className="pv-gone" style={{ left: p.left, top: p.top, width: r.w * p.scale + 0.5, height: r.h * p.scale }} /> : null; })}
      {commentRects.map((c) => c.rects.map((r, i) => { const p = pageTo(r.page, r.x, r.y); return p ? <div key={`c${c.id}${i}`} className={`pv-comment ${activeComment === c.id ? 'is-active' : ''}`} style={{ left: p.left, top: p.top, width: r.w * p.scale, height: r.h * p.scale }} /> : null; }))}
      {marks.map((r, i) => { const p = pageTo(r.page, r.x, r.y); if (!p) return null; if (r.space) return <span key={`m${i}`} className="pv-mark is-space" style={{ left: p.left, top: p.top, width: (r.w ?? r.h * 0.3) * p.scale, height: r.h * p.scale, fontSize: r.h * p.scale * 0.8, lineHeight: `${r.h * p.scale}px` }}>·</span>; const gutter = r.noIndent && !r.blank; return <span key={`m${i}`} className={`pv-mark ${r.blank ? 'is-blank' : ''} ${gutter || (r.noIndent && r.blank) ? 'is-gutter' : ''}`} style={{ left: p.left - (r.noIndent ? r.h * p.scale * 1.2 : 0), top: p.top, height: r.h * p.scale, fontSize: r.h * p.scale * 0.8, lineHeight: `${r.h * p.scale}px` }}>{r.noIndent && !r.blank ? '⇤' : r.blank && r.noIndent ? '⇤¶' : '¶'}</span>; })}
      {caretPx && overlayText && (
        <span className={`pv-overlay ${composing !== null ? 'is-composing' : ''} ${fadingText ? 'is-fading' : ''}`} style={{ left: caretPx.left, top: caretPx.top, height: caretH, fontSize: caretH * 0.92, lineHeight: `${caretH}px` }}>{overlayText}</span>
      )}
      {caretPx && (sel?.empty !== false || attrEdit) && (
        <div className={`pv-caret ${focused ? '' : 'is-idle'}`} style={{ left: caretLeft, top: caretPx.top, height: caretH }} />
      )}
      <textarea
        key="preview-input"
        ref={inputRef}
        className="pv-input"
        style={{ left: inputPos.current.left, top: inputPos.current.top, height: Math.max(1, caretH) }}
        aria-label={tx("直接编辑页面")}
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
          setAttrEdit(null);
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
  canvas.font = `${px}px "TeX Gyre Termes", "Noto Serif CJK SC", "Times New Roman", serif`;
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
