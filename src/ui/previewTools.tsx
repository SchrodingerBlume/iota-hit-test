// 预览栏上的小件：页码（可跳页）、字数（点开是 Word 的「字数统计」）、缩放菜单（Word 的「缩放」对话框那几档）、
// 预览底色（默认 / 日间 / 夜间 / 护眼 / 羊皮纸）
import { useEffect, useMemo, useRef, useState, type ReactElement, type Ref } from 'react';
import { create } from 'zustand';
import { Popover, PopoverTrigger, PopoverSurface, Slider, Tooltip } from '@fluentui/react-components';
import { useStore, type RichKey } from '../model/store';
import { countWords } from '../model/wordCount';
import { t as tx } from '../i18n';

const RICH: RichKey[] = ['abstractZh', 'abstractEn', 'body', 'conclusion', 'appendix', 'acknowledgement', 'resume'];
const fmt = (n: number) => n.toLocaleString('en-US');

export function PageIndicator({ current, total, onJump }: { current: number; total: number; onJump: (page: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const start = () => { setVal(String(current)); setEditing(true); setTimeout(() => { input.current?.focus(); input.current?.select(); }, 0); };
  const commit = () => { setEditing(false); const n = parseInt(val, 10); if (n >= 1 && n <= total) onJump(n); };
  return (
    <span className="pv-pages">
      {tx("第")}{' '}
      {editing
        ? <input ref={input} className="pv-page-input" value={val} onChange={(e) => setVal(e.target.value.replace(/\D/g, ''))} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } else if (e.key === 'Escape') setEditing(false); }} style={{ width: `${Math.max(2, String(total).length + 1)}ch` }} />
        : <button type="button" className="pv-link" title={tx("点击跳到指定页")} onClick={start}>{current}</button>}
      {' '}{tx("页，共 {{n}} 页", { n: total })}
    </span>
  );
}

export function WordCountBadge({ pages }: { pages: number }) {
  const doc = useStore((s) => s.doc);
  const stats = useMemo(() => countWords(RICH.map((k) => doc[k]).filter(Boolean)), [doc]);
  const rows: [string, number][] = [
    [tx("页数"), pages], [tx("字数"), stats.words], [tx("字符数(不计空格)"), stats.charsNoSpace], [tx("字符数(计空格)"), stats.charsWithSpace],
    [tx("段落数"), stats.paragraphs], [tx("非中文单词"), stats.nonCjkWords], [tx("中文字符"), stats.cjk],
  ];
  return (
    <Popover positioning="below-start" trapFocus={false}>
      <PopoverTrigger disableButtonEnhancement>
        <button type="button" className="pv-link" title={tx("文档中的字数。单击可打开“字数统计”")}>{fmt(stats.words)} {tx("字")}</button>
      </PopoverTrigger>
      <PopoverSurface className="pv-pop">
        <div className="pv-pop-title">{tx("字数统计")}</div>
        <div className="pv-pop-sub">{tx("统计信息:")}</div>
        {rows.map(([k, v]) => <div key={k} className="pv-stat"><span>{k}</span><b>{fmt(v)}</b></div>)}
      </PopoverSurface>
    </Popover>
  );
}

/** 缩放菜单：Word「缩放」对话框的那几档 + 滑杆 + 百分比 */
export function ZoomMenu({ zoom, zoomTo, fitPage, labelRef, children }: { zoom: number; zoomTo: (z: number) => void; fitPage: () => void; labelRef?: Ref<HTMLSpanElement>; children?: ReactElement }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState('');
  useEffect(() => { if (open) setVal(String(Math.round(zoom * 100))); }, [open, zoom]);
  const pick = (z: number) => { zoomTo(z); setOpen(false); };
  const commit = () => { const n = parseInt(val, 10); if (n >= 30 && n <= 300) pick(n / 100); };
  const pct = Math.round(zoom * 100);
  return (
    <Popover open={open} onOpenChange={(_, d) => setOpen(d.open)} positioning="below-end" trapFocus={false}>
      <PopoverTrigger disableButtonEnhancement>
        {children ?? <button type="button" className="btn btn-xs pv-zoom-btn" title={tx("缩放")}><span ref={labelRef}>{pct}%</span></button>}
      </PopoverTrigger>
      <PopoverSurface className="pv-pop pv-zoom">
        <div className="pv-pop-title">{tx("缩放")}</div>
        <Slider min={30} max={300} step={5} value={pct} size="small" onChange={(_, d) => zoomTo(d.value / 100)} />
        <div className="pv-zoom-grid">
          {[200, 150, 125, 100, 75].map((p) => <button key={p} type="button" className={`pv-row ${pct === p ? 'on' : ''}`} onClick={() => pick(p / 100)}>{p}%</button>)}
          <button type="button" className={`pv-row ${pct === 100 ? 'on' : ''}`} onClick={() => pick(1)}>{tx("页宽")}</button>
          <button type="button" className="pv-row" onClick={() => { fitPage(); setOpen(false); }}>{tx("整页")}</button>
        </div>
        <div className="pv-zoom-pct">
          <span>{tx("百分比:")}</span>
          <input className="pv-page-input" value={val} onChange={(e) => setVal(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }} style={{ width: '4ch' }} />%
          <button type="button" className="btn btn-xs" onClick={commit}>{tx("确定")}</button>
        </div>
      </PopoverSurface>
    </Popover>
  );
}

export type PreviewBg = 'default' | 'day' | 'night' | 'eye' | 'parchment';
const BG_KEY = 'iota4web-preview-bg';
export const BG_OPTIONS: { mode: PreviewBg; label: () => string; swatch: string }[] = [
  { mode: 'default', label: () => tx("默认"), swatch: 'var(--preview-bg)' },
  { mode: 'day', label: () => tx("日间"), swatch: '#e0e0e0' },
  { mode: 'night', label: () => tx("夜间"), swatch: '#404040' },
  { mode: 'eye', label: () => tx("护眼"), swatch: '#c7edcc' },
  { mode: 'parchment', label: () => tx("羊皮纸"), swatch: '#f2e6d0' },
];
export const usePreviewBg = create<{ mode: PreviewBg; set: (m: PreviewBg) => void }>((set) => ({
  mode: (() => { try { const v = localStorage.getItem(BG_KEY); return BG_OPTIONS.some((o) => o.mode === v) ? (v as PreviewBg) : 'default'; } catch { return 'default'; } })(),
  set: (mode) => { try { localStorage.setItem(BG_KEY, mode); } catch { /* */ } set({ mode }); },
}));

export function BgMenu() {
  const mode = usePreviewBg((s) => s.mode);
  const set = usePreviewBg((s) => s.set);
  const [open, setOpen] = useState(false);
  const cur = BG_OPTIONS.find((o) => o.mode === mode) ?? BG_OPTIONS[0];
  return (
    <Popover open={open} onOpenChange={(_, d) => setOpen(d.open)} positioning="below-end" trapFocus={false}>
      <PopoverTrigger disableButtonEnhancement>
        <Tooltip content={tx("预览背景色")} relationship="label" positioning="below" withArrow>
          <button type="button" className="btn btn-xs btn-icon pv-bg-btn"><i className="pv-swatch" style={{ background: cur.swatch }} /></button>
        </Tooltip>
      </PopoverTrigger>
      <PopoverSurface className="pv-pop">
        {BG_OPTIONS.map((o) => (
          <button key={o.mode} type="button" className={`pv-row ${o.mode === mode ? 'on' : ''}`} onClick={() => { set(o.mode); setOpen(false); }}><i className="pv-swatch" style={{ background: o.swatch }} />{o.label()}</button>
        ))}
      </PopoverSurface>
    </Popover>
  );
}
