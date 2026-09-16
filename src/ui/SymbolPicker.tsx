// 符号面板（像 tinymist 的符号视图）：Typst 的整张符号表（1200 多个，codex 的 sym.txt）按类别分组、
// 按名字 / LaTeX 命令 / 字搜索，点一下插进正文。正文里存的是字本身；每个字对应的 Typst 名与 LaTeX
// 命令记在 src/data/symbols.json，以后导出 Typst / LaTeX 按表换写法。
import { useMemo, useState } from 'react';
import { create } from 'zustand';
import { Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogTrigger, Button, Input, Tooltip } from '@fluentui/react-components';
import { Dismiss20Regular, Search20Regular } from '@fluentui/react-icons';
import SYMBOLS from '../data/symbols.json';

export interface SymbolEntry { n: string; c: string; l?: string; cls?: string; k: string }
export const SYMBOL_TABLE: SymbolEntry[] = SYMBOLS as SymbolEntry[];
/** 字 → 符号（导出 Typst / LaTeX 用；同一个字取第一条） */
export const SYMBOL_BY_CHAR: Map<string, SymbolEntry> = (() => { const m = new Map<string, SymbolEntry>(); for (const s of SYMBOL_TABLE) if (!m.has(s.c)) m.set(s.c, s); return m; })();

/** 面板里按这些类别排；剩下的归「其他」 */
const CATEGORIES: { key: string; label: string; match: (k: string) => boolean }[] = [
  { key: 'greek', label: '希腊字母', match: (k) => /Greek/.test(k) },
  { key: 'arith', label: '运算', match: (k) => /Arithmetic|Algebra|Calculus|Number theory/.test(k) },
  { key: 'rel', label: '关系', match: (k) => /Relations|Set theory|Logic/.test(k) },
  { key: 'arrow', label: '箭头', match: (k) => /Arrows/.test(k) },
  { key: 'delim', label: '括号', match: (k) => /Delimiters/.test(k) },
  { key: 'punct', label: '标点', match: (k) => /Punctuation|Accents|Spaces|Printable/.test(k) },
  { key: 'letter', label: '字母类', match: (k) => /Double-struck|letter-likes|Cyrillic/.test(k) },
  { key: 'geo', label: '几何形状', match: (k) => /Geometry|Shapes/.test(k) },
  { key: 'misc', label: '其他', match: (k) => /Miscell|Currency|Music|Astronomical|Game|Function|Keyboard|Technical|pull/.test(k) },
];
const catOf = (k: string) => CATEGORIES.find((c) => c.match(k))?.key ?? 'misc';
const SKIP = /^(Control|Spaces)$/;

interface State { open: boolean; setOpen: (v: boolean) => void }
export const useSymbolPicker = create<State>((set) => ({ open: false, setOpen: (open) => set({ open }) }));

/** 常用的一排：编辑器里最常打的 */
export const QUICK_SYMBOLS = ['—', '–', '·', '…', '「', '」', '『', '』', '《', '》', '〈', '〉', '【', '】', '×', '÷', '±', '≈', '≠', '≤', '≥', '∞', '°', '℃', 'µ', 'Ω', '‰', '′', '″', '²', '³', '½', '→', '←', '↔', '⇒', '√', '∑', '∫', '∂', '∇', 'α', 'β', 'γ', 'δ', 'ε', 'θ', 'λ', 'μ', 'π', 'ρ', 'σ', 'τ', 'φ', 'ω', 'Δ', 'Σ', 'Φ', 'Ψ', '©', '®', '™', '§', '¶', '€', '£', '¥'];

export function SymbolPicker({ onPick }: { onPick: (ch: string) => void }) {
  const open = useSymbolPicker((s) => s.open);
  const setOpen = useSymbolPicker((s) => s.setOpen);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('greek');
  const list = useMemo(() => {
    const all = SYMBOL_TABLE.filter((s) => !SKIP.test(s.k) && /\S/.test(s.c));
    const qq = q.trim().toLowerCase().replace(/^\\/, '');
    if (qq) {
      // 名字整个对上的排最前，其次名字以它开头的，再次别的
      const score = (s: SymbolEntry) => (s.n === qq || s.c === q.trim() ? 0 : s.n.startsWith(qq) ? 1 : (s.l && s.l.toLowerCase() === `\\${qq}`) ? 0 : 2);
      return all.filter((s) => s.n.includes(qq) || (s.l && s.l.toLowerCase().includes(qq)) || s.c === q.trim()).sort((x, y) => score(x) - score(y) || x.n.length - y.n.length).slice(0, 400);
    }
    return all.filter((s) => catOf(s.k) === cat);
  }, [q, cat]);
  if (!open) return null;
  return (
    <Dialog open onOpenChange={(_, d) => { if (!d.open) setOpen(false); }}>
      <DialogSurface className="style-dialog sym-dialog">
        <DialogBody>
          <DialogTitle action={<DialogTrigger action="close"><Button appearance="subtle" icon={<Dismiss20Regular />} /></DialogTrigger>}>符号</DialogTitle>
          <DialogContent>
            <Input contentBefore={<Search20Regular />} value={q} placeholder="按名字搜：alpha、arrow.r、\leq、≤…" onChange={(_, d) => setQ(d.value)} autoFocus style={{ width: '100%' }} />
            {!q.trim() && (
              <div className="sym-cats">
                {CATEGORIES.map((c) => <button key={c.key} type="button" className={`bib-group-chip ${cat === c.key ? 'on' : ''}`} onClick={() => setCat(c.key)}>{c.label}</button>)}
              </div>
            )}
            <div className="sym-grid">
              {list.map((s) => (
                <Tooltip key={s.n + s.c} content={`${s.c}  sym.${s.n}${s.l ? `  ·  ${s.l}` : ''}`} relationship="label" positioning="above" withArrow>
                  <button type="button" className="sym-cell" onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick(s.c); }}>{s.c}</button>
                </Tooltip>
              ))}
              {!list.length && <p className="muted" style={{ gridColumn: '1 / -1' }}>没有这个符号</p>}
            </div>
            <p className="muted style-hint" style={{ marginTop: 8 }}>共 {SYMBOL_TABLE.length} 个 Typst 符号（codex 表），{SYMBOL_TABLE.filter((s) => s.l).length} 个带 LaTeX 命令（unicode-math 表）。悬停看名字；插进正文的是字本身。</p>
          </DialogContent>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
