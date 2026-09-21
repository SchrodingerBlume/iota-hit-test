// 进工程后第一次整编时预览区的占位：按文档的标题、章节、段落长短铺一份「影子论文」，一行行写出来、一页页摞起来。
// 进度条按估计的时长走（上次实测的，没有就按页数估）：1 − e^(−t/τ)，估准了到点 90%，估短了慢慢爬、不会满
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Loader2 } from 'lucide-react';
import { useStore } from '../model/store';
import type { RichDoc, ThesisDoc } from '../model/types';
import { t as tx } from '../i18n';

type Line = { k: 'title' } | { k: 'h'; text: string; level: number } | { k: 'p'; w: number } | { k: 'fig' };
/** 一页能放多少「格」：段落一行一格，标题、图表按高度折算 */
const PAGE = 26;
const SLOTS: Record<Line['k'], number> = { title: 5.5, h: 2.5, p: 1, fig: 5.5 };
const SECTIONS = ['abstractZh', 'abstractEn', 'body', 'conclusion', 'appendix', 'acknowledgement', 'resume'] as const;
const MS_KEY = 'iota4web-first-compile-ms';
/** 写一页用多久（与估计的时长无关：几百页的稿按估计走会一秒翻几十页，看不出在写） */
const PAGE_MS = 1200;

function pages(doc: ThesisDoc): Line[][] {
  const out: Line[][] = [[]];
  let used = 0;
  const push = (l: Line) => {
    const h = l.k === 'h' && l.level === 1 ? 3.5 : SLOTS[l.k];
    if (used + h > PAGE) { out.push([]); used = 0; }
    out[out.length - 1].push(l); used += h;
  };
  const text = (n: any): string => n.text ?? (n.content ?? []).map(text).join('');
  const walk = (n: any) => {
    if (n.type === 'heading') { const s = text(n).trim(); if (s) push({ k: 'h', text: s, level: n.attrs?.level ?? 1 }); return; }
    if (/figure|table|algorithm|equation|theorem/i.test(n.type ?? '')) { push({ k: 'fig' }); return; }
    if (n.type === 'paragraph') {
      const len = text(n).trim().length;
      if (!len) return;
      const rows = Math.min(8, Math.ceil(len / 38));
      for (let i = 1; i < rows; i++) push({ k: 'p', w: 100 });
      push({ k: 'p', w: rows === 1 ? Math.max(24, Math.min(100, len * 2.6)) : 30 + (len * 7) % 60 });
      return;
    }
    for (const k of n.content ?? []) walk(k);
  };
  push({ k: 'title' });
  for (const key of SECTIONS) for (const n of (doc[key] as RichDoc | undefined)?.content ?? []) walk(n);
  return out;
}

const readMs = (): Record<string, number> => { try { return JSON.parse(localStorage.getItem(MS_KEY) ?? '{}'); } catch { return {}; } };
const saveMs = (id: string, ms: number) => { try { localStorage.setItem(MS_KEY, JSON.stringify({ ...readMs(), [id]: Math.round(ms) })); } catch { /* */ } };

/** show 翻成 false 后淡出再卸掉；这一回等了多久记下来，下次进同一工程按它定节奏 */
export function FirstCompile({ show }: { show: boolean }) {
  const [mounted, setMounted] = useState(show);
  const t0 = useRef(0);
  const id = useStore((s) => s.doc.id);
  useEffect(() => {
    if (show) { setMounted(true); t0.current = performance.now(); return; }
    if (t0.current) { saveMs(id, performance.now() - t0.current); t0.current = 0; }
    const timer = window.setTimeout(() => setMounted(false), 600);
    return () => window.clearTimeout(timer);
  }, [show]);
  if (!mounted) return null;
  return <div className={`first-compile ${show ? '' : 'fc-out'}`} onTransitionEnd={(e) => e.target === e.currentTarget && !show && setMounted(false)}><Stage key={id} /></div>;
}

function Stage() {
  const doc = useStore((s) => s.doc);
  const script = useMemo(() => pages(doc), []);
  const total = script.length;
  // 影子页只铺正文那几节；封面、目录、参考文献那些按经验补
  const about = Math.round(total * 1.3) + 8;
  const est = useMemo(() => readMs()[doc.id] ?? 800 + total * 60, []);
  const t0 = useRef(performance.now());
  const [now, setNow] = useState(0);
  useEffect(() => { const timer = window.setInterval(() => setNow(performance.now() - t0.current), 100); return () => window.clearInterval(timer); }, []);
  const p = 1 - Math.exp(-now / est * Math.log(10));
  const page = Math.min(total, 1 + Math.floor(now / PAGE_MS));
  const title = doc.info.title.split('\n')[0] || doc.name;

  const sheet = (n: number, cls: string) => {
    const lines = script[n - 1];
    return (
      <div key={n} className={`fc-sheet ${cls}`} style={{ '--n': lines.length } as CSSProperties}>
        <div className="fc-body">
          {lines.map((l, i) => {
            const st = { '--i': i, ...(l.k === 'p' ? { '--w': `${l.w}%` } : {}) } as CSSProperties;
            if (l.k === 'title') return <div key={i} className="fc-line fc-title" style={st}><b>{title}</b><span>{doc.info.author}</span></div>;
            if (l.k === 'h') return <div key={i} className={`fc-line fc-h l${Math.min(3, l.level)}`} style={st}>{l.text}</div>;
            return <div key={i} className={`fc-line fc-${l.k}`} style={st} />;
          })}
        </div>
        <span className="fc-num">{n}</span>
      </div>
    );
  };
  return (
    <>
      <div className="boot fc-caption">
        <h3><Loader2 />{tx("初次排版中")}</h3>
        <div className="muted">{tx("第一次要把整篇排一遍，之后每次只重排改动的那一部分。")}</div>
        <div className="bar"><i style={{ width: `${Math.max(2, p * 100)}%` }} /></div>
        <div className="detail">{tx("约 {{n}} 页 · 已用 {{s}} 秒", { n: about, s: (now / 1000).toFixed(1) })}</div>
      </div>
      <div className="fc-stack">
        {Array.from({ length: Math.min(3, page - 1) }, (_, i) => <div key={`g${i}`} className={`fc-sheet fc-ghost g${i + 1}`} />)}
        {page > 1 && sheet(page - 1, 'fc-done')}
        {sheet(page, 'fc-cur')}
      </div>
    </>
  );
}
