// 本地历史（照 Typst Studio）：左边一列快照，选一份看它跟现在差在哪（按节：正文、摘要、结论……与元信息、设置、文献），能整份恢复
import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import { Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions, Button, Switch } from '@fluentui/react-components';
import { useStore } from '../model/store';
import type { ThesisDoc, RichDoc } from '../model/types';
import { listHistory, loadSnapshot, takeSnapshot, deleteSnapshot, clearHistory, historyEnabled, setHistoryEnabled, historyEvery, setHistoryEvery, describeEvery, HISTORY_EVERY_CHOICES, HISTORY_LABELS, type SnapshotMeta } from '../history/history';
import { lineDiff, countChanges } from '../history/diff';
import { toMarkdown } from '../editor/markdown';
import { generateBibtex } from '../bib/bibtex';
import { DiffView } from './DiffView';
import { t as tx } from '../i18n';

export const useHistoryDialog = create<{ open: boolean; set: (v: boolean) => void }>((set) => ({ open: false, set: (open) => set({ open }) }));

const fmt = (ts: number) => { const d = new Date(ts); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
const kb = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

/** 工程拆成能逐段对照的文字 */
function facets(doc: ThesisDoc): Record<string, string> {
  const rich = (d: RichDoc | undefined) => { try { return d ? toMarkdown(d) : ''; } catch { return JSON.stringify(d); } };
  const json = (v: unknown) => JSON.stringify(v ?? null, null, 1);
  return {
    [tx("正文")]: rich(doc.body), [tx("摘要")]: rich(doc.abstractZh), Abstract: rich(doc.abstractEn), [tx("结论")]: rich(doc.conclusion), [tx("附录")]: rich(doc.appendix), [tx("致谢")]: rich(doc.acknowledgement), [tx("简历")]: rich(doc.resume),
    [tx("论文信息")]: json(doc.info), [tx("设置")]: json({ settings: doc.settings, pages: doc.pages, openright: doc.openright }), [tx("参考文献")]: generateBibtex(doc.references ?? []), [tx("成果")]: generateBibtex(doc.achievementEntries ?? []),
    [tx("符号与缩略语")]: json({ abbreviations: doc.abbreviations, symbols: doc.symbols }), [tx("其他")]: json({ defense: doc.defense, declarationsOptions: doc.declarationsOptions, localInfo: doc.localInfo, images: doc.images }),
  };
}

export function HistoryDialog() {
  const open = useHistoryDialog((s) => s.open);
  const close = () => useHistoryDialog.getState().set(false);
  const doc = useStore((s) => s.doc);
  const [list, setList] = useState<SnapshotMeta[]>([]);
  const [enabled, setEnabled] = useState(historyEnabled());
  const [every, setEvery] = useState(historyEvery());
  const [customUnit, setCustomUnit] = useState<60 | 1>(every % 60 === 0 && every > 0 ? 60 : 1);
  const isPreset = HISTORY_EVERY_CHOICES.some((c) => c.value === every);
  const [custom, setCustom] = useState(!isPreset);
  const changeEvery = (v: number) => { setEvery(v); setHistoryEvery(v); };
  const [sel, setSel] = useState<string | null>(null);
  const [snap, setSnap] = useState<ThesisDoc | null>(null);
  const [facet, setFacet] = useState<string>('');
  const [busy, setBusy] = useState('');
  const refresh = async () => setList(await listHistory(doc.id));
  useEffect(() => { if (open) { void refresh(); setSel(null); setSnap(null); } }, [open, doc.id]);
  useEffect(() => { if (!sel) { setSnap(null); return; } let alive = true; void loadSnapshot(sel).then((d) => { if (alive) setSnap(d); }); return () => { alive = false; }; }, [sel]);
  const now = useMemo(() => (open ? facets(doc) : {}), [doc, open]);
  const then = useMemo(() => (snap ? facets(snap) : null), [snap]);
  const changed = useMemo(() => {
    if (!then) return [];
    return Object.keys(now).map((k) => ({ k, ...countChanges(lineDiff(then[k] ?? '', now[k] ?? '')) })).filter((x) => x.add || x.del);
  }, [now, then]);
  useEffect(() => { if (changed.length && !changed.some((c) => c.k === facet)) setFacet(changed[0].k); }, [changed, facet]);
  const manual = async () => { setBusy(tx("正在保存…")); const r = await takeSnapshot(doc, 'manual'); setBusy(r ? '' : tx("跟上一份一样，没存")); await refresh(); };
  const restore = async () => {
    if (!snap) return;
    if (!window.confirm(tx("把整份工程换成 {{time}} 那一份？现在这份会先存一份「恢复前」快照。", { time: fmt(snap.updatedAt ? Date.parse(snap.updatedAt) : Date.now()) }))) return;
    await takeSnapshot(doc, 'restore');
    useStore.getState().replaceDoc(snap);
    await refresh();
    close();
  };
  const cur = list.find((s) => s.key === sel);
  return (
    <Dialog open={open} onOpenChange={(_, d) => { if (!d.open) close(); }}>
      <DialogSurface className="hist-dialog">
        <DialogBody>
          <DialogTitle>{tx("本地历史")}</DialogTitle>
          <DialogContent>
            <div className="hist-bar">
              <Switch checked={enabled} label={tx("自动存")} onChange={(_, d) => { setEnabled(!!d.checked); setHistoryEnabled(!!d.checked); }} />
              <select className="hist-every" value={custom ? 'custom' : String(every)} disabled={!enabled} title={tx("多久自动存一份")} onChange={(e) => { if (e.target.value === 'custom') { setCustomUnit(every > 0 && every % 60 === 0 ? 60 : 1); setCustom(true); return; } setCustom(false); changeEvery(Number(e.target.value)); }}>
                {HISTORY_EVERY_CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                <option value="custom">{tx("自定义…")}</option>
              </select>
              {custom && (
                <span className="hist-custom">
                  {tx("每")} <input type="number" min={1} step={1} disabled={!enabled} value={Math.max(1, Math.round(every / customUnit)) || ''} onChange={(e) => { const n = Math.max(1, Math.round(Number(e.target.value) || 1)); changeEvery(n * customUnit); }} />
                  <select value={customUnit} disabled={!enabled} onChange={(e) => { const u = Number(e.target.value) as 60 | 1; const n = Math.max(1, Math.round(every / customUnit)); setCustomUnit(u); changeEvery(n * u); }}><option value={1}>{tx("秒")}</option><option value={60}>{tx("分钟")}</option></select>
                </span>
              )}
              <span className="muted">{enabled ? (every === 0 ? tx("改动停下 1 秒就存一份") : tx("{{every}}有改动就存一份", { every: describeEvery(every) })) : tx("只在手动、恢复前、Git 提交时存")}</span>
              <span className="spacer" />
              <span className="muted">{busy}</span>
              <Button size="small" onClick={() => void manual()}>{tx("现在存一份")}</Button>
              <Button size="small" appearance="subtle" disabled={!list.length} onClick={async () => { if (window.confirm(tx("清空这个工程的全部本地历史？"))) { await clearHistory(doc.id); await refresh(); setSel(null); } }}>{tx("清空")}</Button>
            </div>
            <div className="hist-grid">
              <ul className="hist-list">
                {!list.length && <li className="muted">{tx("还没有快照。有改动时按上面的节奏自动存，也可以现在存。")}</li>}
                {[...list].reverse().map((s) => (
                  <li key={s.key} className={s.key === sel ? 'on' : ''}>
                    <button type="button" onClick={() => setSel(s.key === sel ? null : s.key)}>
                      <b>{fmt(s.ts)}</b><span className={`hist-tag is-${s.label}`}>{HISTORY_LABELS[s.label]}</span><span className="muted">{kb(s.bytes)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="hist-detail">
                {!cur && <p className="muted">{tx("选一份快照，看它跟现在的差别。")}</p>}
                {cur && !snap && <p className="muted">{tx("正在读取…")}</p>}
                {cur && snap && (
                  <>
                    <div className="hist-actions">
                      <span>{tx("{{time}} 那一份 → 现在", { time: fmt(cur.ts) })}</span>
                      <span className="spacer" />
                      <Button size="small" appearance="primary" onClick={() => void restore()}>{tx("恢复到这一份")}</Button>
                      <Button size="small" appearance="subtle" onClick={async () => { await deleteSnapshot(cur.key); setSel(null); await refresh(); }}>{tx("删除快照")}</Button>
                    </div>
                    {!changed.length ? <p className="muted">{tx("跟现在一模一样。")}</p> : (
                      <>
                        <div className="hist-facets">
                          {changed.map((c) => <button key={c.k} type="button" className={`bib-group-chip ${facet === c.k ? 'on' : ''}`} onClick={() => setFacet(c.k)}>{c.k} <span className="diff-add">+{c.add}</span> <span className="diff-del">−{c.del}</span></button>)}
                        </div>
                        <DiffView before={then?.[facet] ?? ''} after={now[facet] ?? ''} />
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          </DialogContent>
          <DialogActions><Button appearance="secondary" onClick={close}>{tx("关闭")}</Button></DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
