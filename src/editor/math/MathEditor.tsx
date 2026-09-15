// 可视化公式编辑：源码框 + 实时预览 + 符号面板。行间公式与行内公式共用。
// 面板上点一下把模板插到光标处，□ 是占位，Tab 跳到下一个占位。
import { useEffect, useRef, useState } from 'react';
import { MathPreview, katexHtml } from './MathPreview';
import { PALETTE, insertTemplate, nextHole } from './palette';
import { LayoutGrid, ChevronUp } from 'lucide-react';

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

export function MathEditor({ value, mode, display, onChange, onMode, autoFocus, compact, onEnter }: Props) {
  const ta = useRef<HTMLTextAreaElement>(null);
  // 新建的（空的）公式把面板摊开；已有的收起，点图标再开
  const [palette, setPalette] = useState(!value.trim());
  const [group, setGroup] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const pendingSel = useRef<[number, number] | null>(null);

  useEffect(() => {
    if (pendingSel.current && ta.current) {
      const [s, e] = pendingSel.current;
      ta.current.focus();
      ta.current.setSelectionRange(s, e);
      pendingSel.current = null;
    }
  }, [value]);

  const insert = (tpl: string) => {
    const el = ta.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const r = insertTemplate(value, start, end, tpl);
    pendingSel.current = [r.start, r.end];
    onChange(r.text);
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      const el = e.currentTarget;
      const hole = nextHole(value, el.selectionEnd);
      if (hole) { e.preventDefault(); el.setSelectionRange(hole[0], hole[1]); }
    } else if (e.key === 'Enter' && !e.shiftKey && (compact || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onEnter?.();
    }
  };

  return (
    <div className={`math-editor ${compact ? 'is-compact' : ''}`}>
      <div className="math-preview-box">
        <MathPreview src={forPreview(value, mode)} mode={mode} display={display} onError={setError} empty={<span className="muted">在下面写公式，或从面板里点</span>} />
      </div>
      <div className="math-src-row">
        <textarea
          ref={ta}
          className="eq-src"
          rows={Math.max(compact ? 1 : 2, Math.min(6, value.split('\n').length))}
          value={value}
          autoFocus={autoFocus}
          spellCheck={false}
          placeholder={mode === 'latex' ? '\\frac{a}{b} = c' : 'phi = D_"p"^2/150 psi^3/(1 - psi)^2'}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKey}
        />
        <span className="seg" title="公式语法">
          <button type="button" className={mode === 'typst' ? 'on' : ''} onClick={() => onMode('typst')}>Typst</button>
          <button type="button" className={mode === 'latex' ? 'on' : ''} onClick={() => onMode('latex')}>LaTeX</button>
        </span>
        <button type="button" className={`btn btn-xs btn-icon ${palette ? 'on' : ''}`} title="符号面板" onClick={() => setPalette((p) => !p)}>{palette ? <ChevronUp /> : <LayoutGrid />}</button>
      </div>
      {error && <div className="math-error">{error}</div>}
      {palette && (
        <div className="math-palette">
          <div className="math-palette-tabs">
            {PALETTE.map((g, i) => <button key={g.name} type="button" className={i === group ? 'on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => setGroup(i)}>{g.name}</button>)}
          </div>
          <div className="math-palette-grid">
            {PALETTE[group].items.map((it, i) => (
              <button key={i} type="button" className="math-key" title={it.title ?? (mode === 'typst' ? it.typst : it.latex)} onMouseDown={(e) => e.preventDefault()} onClick={() => insert(mode === 'typst' ? it.typst : it.latex)}
                dangerouslySetInnerHTML={{ __html: katexHtml(it.show, false).html }} />
            ))}
          </div>
          <div className="muted math-palette-hint">□ 是占位，Tab 跳到下一个；选中一段再点结构会把它填进去</div>
        </div>
      )}
    </div>
  );
}
