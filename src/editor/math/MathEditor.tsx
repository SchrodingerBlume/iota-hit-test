// 公式编辑：行间公式与行内公式共用。
//
// LaTeX 档（默认）是所见即所得的——公式本身就是编辑区（MathLive）：光标在分式、上下标里
// 进出，打 `/` 成分式、`^` 上标、`alpha` 变 α，Tab 跳到下一个空位；要看源码点「源码」，
// 屏幕键盘给平板与不记命令的人。Typst 档是源码 + 实时预览（页面里的 wasm 引擎编一个小片段，
// 与正文同一套字体）。符号面板两档通用：点一下把结构插到光标处，□ 是占位。
import { useCallback, useEffect, useRef, useState } from 'react';
import { MathfieldElement } from 'mathlive';
import 'mathlive/fonts.css';
import { MathPreview, katexHtml } from './MathPreview';
import { PALETTE, insertTemplate, nextHole } from './palette';
import { LayoutGrid, ChevronUp, Keyboard, Code2 } from 'lucide-react';
import { t as tx } from '../../i18n';

// 字体已随 fonts.css 打进站内；别再去网上找。菜单、音效都关掉
MathfieldElement.fontsDirectory = null;
MathfieldElement.soundsDirectory = null;

interface Props {
  value: string;
  mode: 'typst' | 'latex';
  display: boolean;
  onChange: (v: string) => void;
  onMode: (m: 'typst' | 'latex') => void;
  autoFocus?: boolean;
  /** 行内的弹出框里紧凑些 */
  compact?: boolean;
  onEnter?: () => void;
}

/** 预览时把占位画成空心方框 */
export const forPreview = (src: string, mode: 'typst' | 'latex') => src.replace(/□/g, mode === 'typst' ? ' square.stroked ' : '\\square ');

/** 存的是 □，MathLive 认 \placeholder{} */
const toField = (s: string) => s.replace(/□/g, '\\placeholder{}');
const fromField = (s: string) => s.replace(/\\placeholder(?:\[[^\]]*\])?\{[^{}]*\}/g, '□');

export function MathEditor({ value, mode, display, onChange, onMode, autoFocus, compact, onEnter }: Props) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const mf = useRef<MathfieldElement>(null);
  const box = useRef<HTMLDivElement>(null);
  // 新建的（空的）公式把面板摊开；已有的收起，点图标再开
  const [palette, setPalette] = useState(!value.trim());
  const [group, setGroup] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [kbd, setKbd] = useState(false);
  const pendingSel = useRef<[number, number] | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  // ── MathLive（LaTeX 档） ──────────────────────────────────────
  // 鼠标事件别漏给 ProseMirror：<math-field> 不是它认得的输入框，点上去它会当成
  // 「点了这个节点」——选中节点、拦掉默认的聚焦，接着敲的字就把整条公式替换掉了
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const stop = (e: Event) => { if ((e.target as HTMLElement)?.tagName === 'MATH-FIELD') e.stopPropagation(); };
    const types = ['mousedown', 'mouseup', 'click', 'dblclick', 'pointerdown', 'pointerup'];
    for (const t of types) el.addEventListener(t, stop);
    return () => { for (const t of types) el.removeEventListener(t, stop); };
  }, [mode]);
  useEffect(() => {
    const el = mf.current;
    if (!el || mode !== 'latex') return;
    el.mathVirtualKeyboardPolicy = 'manual';
    el.smartFence = true;
    el.smartMode = false;
    el.menuItems = [];
    el.value = toField(valueRef.current);
    const onInput = () => { const v = fromField(el.value); if (v !== valueRef.current) onChange(v); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey && (compact || e.metaKey || e.ctrlKey)) { e.preventDefault(); onEnter?.(); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onEnter?.(); }
    };
    const onBlur = () => { if (!kbd) return; window.mathVirtualKeyboard?.hide(); setKbd(false); };
    el.addEventListener('input', onInput);
    el.addEventListener('keydown', onKey);
    el.addEventListener('blur', onBlur);
    if (autoFocus) requestAnimationFrame(() => el.focus());
    return () => { el.removeEventListener('input', onInput); el.removeEventListener('keydown', onKey); el.removeEventListener('blur', onBlur); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);
  // 外面改了值（源码框里敲的、换了模式）：灌回去，但别打断正在编辑的
  useEffect(() => {
    const el = mf.current;
    if (!el || mode !== 'latex') return;
    if (fromField(el.value) !== value) el.value = toField(value);
  }, [value, mode]);
  useEffect(() => () => { if (kbd) window.mathVirtualKeyboard?.hide(); }, [kbd]);

  const toggleKeyboard = () => {
    const el = mf.current;
    if (!el) return;
    el.focus();
    const vk = window.mathVirtualKeyboard;
    if (!vk) return;
    if (kbd) { vk.hide(); setKbd(false); } else { vk.show(); setKbd(true); }
  };

  // ── Typst 档的源码框 ──────────────────────────────────────────
  useEffect(() => {
    if (pendingSel.current && ta.current) {
      const [s, e] = pendingSel.current;
      ta.current.focus();
      ta.current.setSelectionRange(s, e);
      pendingSel.current = null;
    }
  }, [value]);

  const insert = useCallback((item: { typst: string; latex: string }) => {
    if (mode === 'latex' && mf.current && !showSource) {
      // 第一个占位收当前选区，其余留空位；MathLive 的 #0 是选区、#? 是空位
      let first = true;
      const tpl = item.latex.replace(/□/g, () => { const r = first ? '#0' : '#?'; first = false; return r; });
      mf.current.insert(tpl, { focus: true, selectionMode: 'placeholder' } as any);
      return;
    }
    const el = ta.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const r = insertTemplate(value, start, end, mode === 'typst' ? item.typst : item.latex);
    pendingSel.current = [r.start, r.end];
    onChange(r.text);
  }, [mode, showSource, value, onChange]);

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onEnter?.(); return; }
    if (e.key === 'Tab') {
      const el = e.currentTarget;
      const hole = nextHole(value, el.selectionEnd);
      if (hole) { e.preventDefault(); el.setSelectionRange(hole[0], hole[1]); }
    } else if (e.key === 'Enter' && !e.shiftKey && (compact || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onEnter?.();
    }
  };

  const latex = mode === 'latex';
  const latexError = latex && value.trim() ? katexHtml(forPreview(value, 'latex'), display).error ?? null : null;

  return (
    <div className={`math-editor ${compact ? 'is-compact' : ''} ${latex ? 'is-latex' : 'is-typst'}`}>
      {latex ? (
        <div className="math-field-box" ref={box}>
          <math-field ref={mf as any} default-mode={display ? 'math' : 'inline-math'} style={{ fontSize: compact ? 18 : 22 }} />
          {!value.trim() && <span className="math-field-hint">{tx("输入公式：按")}{' '}<code>/</code> {' '}{tx("插入分式，按")}<code>^</code> {' '}{tx("输入上标，输入")}<code>alpha</code> {' '}{tx("得到 α；也可从符号面板选择。")}</span>}
        </div>
      ) : (
        <div className="math-preview-box">
          <MathPreview src={forPreview(value, mode)} mode={mode} display={display} onError={setError} empty={<span className="muted">{tx("输入公式，或从符号面板中选择")}</span>} />
        </div>
      )}
      {(!latex || showSource) && (
        <textarea
          ref={ta}
          className="eq-src"
          rows={Math.max(compact ? 1 : 2, Math.min(6, value.split('\n').length))}
          value={value}
          autoFocus={autoFocus && !latex}
          spellCheck={false}
          placeholder={latex ? '\\frac{a}{b} = c' : 'phi = D_"p"^2/150 psi^3/(1 - psi)^2'}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKey}
        />
      )}
      <div className="math-src-row">
        {/* 公式只走 LaTeX（模板侧 mitex）；老文档里 Typst 写法的公式还能编，这里只给一个改成 LaTeX 的口 */}
        {!latex && <span className="seg" title={tx("这条公式是 Typst 写法（老版本存的）；新公式一律 LaTeX")}>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onMode('latex')}>{tx("改成 LaTeX")}</button>
          <button type="button" className="on" onMouseDown={(e) => e.preventDefault()}>Typst</button>
        </span>}
        {latex && <button type="button" className={`btn btn-xs btn-icon ${showSource ? 'on' : ''}`} title={tx("查看或编辑 LaTeX 源代码")} onMouseDown={(e) => e.preventDefault()} onClick={() => setShowSource((s) => !s)}><Code2 /></button>}
        {latex && <button type="button" className={`btn btn-xs btn-icon ${kbd ? 'on' : ''}`} title={tx("屏幕数学键盘")} onMouseDown={(e) => e.preventDefault()} onClick={toggleKeyboard}><Keyboard /></button>}
        <span className="spacer" />
        {latex ? <span className="muted math-tip">{tx("Tab 跳到下一个空位 ·")}{' '}{compact ? tx("回车") : tx("⌘/Ctrl + 回车")}{tx("完成")}</span> : <span className="muted math-tip">{tx("□ 是占位，Tab 跳到下一个")}</span>}
        <button type="button" className={`btn btn-xs btn-icon ${palette ? 'on' : ''}`} title={tx("符号面板")} onMouseDown={(e) => e.preventDefault()} onClick={() => setPalette((p) => !p)}>{palette ? <ChevronUp /> : <LayoutGrid />}</button>
      </div>
      {(error || latexError) && <div className="math-error">{error ?? latexError}</div>}
      {palette && (
        <div className="math-palette">
          <div className="math-palette-tabs">
            {PALETTE.map((g, i) => <button key={g.name} type="button" className={i === group ? 'on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => setGroup(i)}>{g.name}</button>)}
          </div>
          <div className="math-palette-grid">
            {PALETTE[group].items.map((it, i) => (
              <button key={i} type="button" className="math-key" title={it.title ?? (mode === 'typst' ? it.typst : it.latex)} onMouseDown={(e) => e.preventDefault()} onClick={() => insert(it)}
                dangerouslySetInnerHTML={{ __html: katexHtml(it.show, false).html }} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
