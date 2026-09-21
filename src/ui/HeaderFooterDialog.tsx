// 页眉和页脚：Word「页面设置 → 版式」那张卡 + 页眉文字。全走模板的接口——layout.header / footer 四个键
// （shown / from-edge / style / border）按整篇、前置、正文、后置四层落，页眉的字走 overrides 的 header 桶。
// 每个能改的值都带「自动」：自动 = 跟模板按档定，填过的值留着，取消自动就回来
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions, Button, Input, Dropdown, Option, TabList, Tab } from '@fluentui/react-components';
import { useStore } from '../model/store';
import type { Settings, HFLevel, HFRecord, HFField, HFBorder, HeaderFooterSettings, HeaderTermKey } from '../model/types';
import { ZIHAO, INLINE_FONTS } from '../model/zihao';
import { LengthInput } from './LengthInput';
import type { SegChoice } from './TriSwitch';
import { t as tx } from '../i18n';
import { termDefault } from '../typst/hfTerms';

export const useHFDialog = create<{ open: boolean; part: 'header' | 'footer'; show: (part: 'header' | 'footer') => void; close: () => void }>((set) => ({
  open: false, part: 'header', show: (part) => set({ open: true, part }), close: () => set({ open: false }),
}));

const LEVELS: { key: HFLevel; label: string; hint: string }[] = [
  { key: 'doc', label: tx("整篇"), hint: tx("文档级，各段承它") },
  { key: 'frontmatter', label: tx("前置"), hint: tx("摘要、目录这些页") },
  { key: 'mainmatter', label: tx("正文"), hint: tx("各章与附录") },
  { key: 'backmatter', label: tx("后置"), hint: tx("参考文献、致谢这些页；不写就承正文的") },
];
const TERMS: { key: HeaderTermKey; label: string; hint: string }[] = [
  { key: 'header-university', label: tx("校名"), hint: tx("页眉开头那几个字，各档都印") },
  { key: 'header-document-type', label: tx("文种"), hint: tx("终稿：「硕士学位论文」这一截（带学位）") },
  { key: 'header-degree', label: tx("学位"), hint: tx("文种里的学位字样") },
  { key: 'header-report-title', label: tx("表单名"), hint: tx("报告：「硕士学位论文开题报告」这一截") },
  { key: 'header-stage', label: tx("阶段"), hint: tx("深圳研究生报告：「中期报告」这一截") },
];
const caret = <i className="rb-caret" />;
const DD = { minWidth: 0, width: 132 } as const;
const SHOWN: SegChoice<boolean>[] = [{ value: false, label: tx("不排"), tone: 'off' }, { value: true, label: tx("排"), tone: 'on' }];

/** 模板按档的默认，给「自动」那一档做提示 */
interface Note { shownAuto: boolean; shown: string; fromEdge: string; asianFont: string; size: string; lineSpacing: string; border: string }
function autoNote(s: Settings, part: 'header' | 'footer'): Note {
  const final = s.stage === 'final';
  const sz = s.campus === 'shenzhen';
  if (part === 'header') {
    return {
      shownAuto: final || sz,
      shown: final ? tx("终稿按规范排页眉") : sz ? tx("深圳报告排页眉") : tx("指南：报告不要设置页眉"),
      fromEdge: final ? '3cm' : sz ? (s.degreeLevel === 'bachelor' ? '2.4cm + 12pt' : '3cm / 1.8cm') : '0cm',
      asianFont: tx("宋体"), size: tx("小五"), lineSpacing: tx("单倍"),
      border: final ? tx("细粗双线 2.25pt，距正文 1pt") : sz ? tx("细粗双线 3pt") : tx("无"),
    };
  }
  return { shownAuto: true, shown: tx("各档都排页码"), fromEdge: final ? '2.3cm' : '1.75cm', asianFont: '', size: tx("小五"), lineSpacing: tx("单倍"), border: tx("无") };
}

function AutoRow({ label, hint, auto, onAuto, note, children }: { label: string; hint?: string; auto: boolean; onAuto: (v: boolean) => void; note?: string; children: React.ReactNode }) {
  return (
    <div className="hf-row">
      <span className="hf-lab" title={hint}>{label}</span>
      <button type="button" className={`hf-auto ${auto ? 'on' : ''}`} onClick={() => onAuto(!auto)} title={tx("自动：跟模板按档定；取消自动后填的值留着，再点回来不会丢")}>{tx("自动")}</button>
      <div className="hf-ctl">
        <span className={`hf-inner ${auto ? 'is-auto' : ''}`}>{children}</span>
        {note && auto && <span className="hf-note muted">{tx("模板：{{v}}", { v: note })}</span>}
      </div>
    </div>
  );
}

const field = <T,>(f: HFField<T> | undefined, fallback: T): HFField<T> => f ?? { auto: true, value: fallback };

function RecordEditor({ part, rec, note, onChange }: { part: 'header' | 'footer'; rec: Partial<HFRecord>; note: Note; onChange: (r: Partial<HFRecord>) => void }) {
  const fromEdge = field(rec.fromEdge, part === 'header' ? '3cm' : '2.3cm');
  const asianFont = field(rec.asianFont, 'songti');
  const size = field(rec.size, 'xiaowu');
  const lineSpacing = field(rec.lineSpacing, 'single');
  const border = field<HFBorder | null>(rec.border, part === 'header' ? { style: 'thin-thick-small-gap', thickness: '2.25pt', fromText: '1pt' } : null);
  const shown = rec.shown ?? 'auto';
  const set = <K extends keyof HFRecord>(k: K, v: HFRecord[K]) => onChange({ ...rec, [k]: v });
  const LS = [['single', tx("单倍")], ['1.25', '1.25'], ['1.5', '1.5'], ['double', tx("2 倍")]] as const;
  const BS = [['none', tx("无")], ['single', tx("单线")], ['thin-thick-small-gap', tx("细粗双线")]] as const;
  const bstyle = border.value ? border.value.style : 'none';
  return (
    <div className="hf-card">
      <AutoRow label={tx("显示")} auto={shown === 'auto'} onAuto={(a) => set('shown', a ? 'auto' : note.shownAuto)} note={`${note.shownAuto ? tx("排") : tx("不排")}（${note.shown}）`}>
        <div className="seg hf-seg" role="radiogroup">
          {SHOWN.map((c) => <button key={String(c.value)} type="button" role="radio" aria-checked={shown === c.value} className={shown === c.value ? `on t-${c.tone}` : ''} disabled={shown === 'auto'} onClick={() => set('shown', c.value)}>{c.label}</button>)}
        </div>
      </AutoRow>
      <AutoRow label={tx("距边界")} hint={tx("Word 页面设置 → 版式 → 距边界")} auto={fromEdge.auto} onAuto={(a) => set('fromEdge', { ...fromEdge, auto: a })} note={note.fromEdge}>
        <LengthInput value={fromEdge.value} defaultUnit="cm" allowed={['cm', 'mm', 'pt']} allowEmpty={false} disabled={fromEdge.auto} onChange={(v) => v && set('fromEdge', { auto: false, value: v })} />
      </AutoRow>
      {part === 'header' && (
        <AutoRow label={tx("中文字体")} auto={asianFont.auto} onAuto={(a) => set('asianFont', { ...asianFont, auto: a })} note={note.asianFont}>
          <Dropdown size="small" expandIcon={caret} style={DD} disabled={asianFont.auto} value={INLINE_FONTS.find((f) => f.key === asianFont.value)?.label ?? asianFont.value} selectedOptions={[asianFont.value]} onOptionSelect={(_, d) => set('asianFont', { auto: false, value: d.optionValue! })}>
            {INLINE_FONTS.map((f) => <Option key={f.key} value={f.key} text={f.label}>{f.label}</Option>)}
          </Dropdown>
        </AutoRow>
      )}
      <AutoRow label={tx("字号")} auto={size.auto} onAuto={(a) => set('size', { ...size, auto: a })} note={note.size}>
        <Dropdown size="small" expandIcon={caret} style={DD} disabled={size.auto} value={ZIHAO.find((z) => z.key === size.value)?.label ?? size.value} selectedOptions={[size.value]} onOptionSelect={(_, d) => set('size', { auto: false, value: d.optionValue! })}>
          {ZIHAO.map((z) => <Option key={z.key} value={z.key} text={z.label}>{z.label}<span className="muted"> {z.pt}pt</span></Option>)}
        </Dropdown>
      </AutoRow>
      <AutoRow label={tx("行距")} auto={lineSpacing.auto} onAuto={(a) => set('lineSpacing', { ...lineSpacing, auto: a })} note={note.lineSpacing}>
        <Dropdown size="small" expandIcon={caret} style={DD} disabled={lineSpacing.auto} value={LS.find((x) => x[0] === lineSpacing.value)?.[1] ?? lineSpacing.value} selectedOptions={[lineSpacing.value]} onOptionSelect={(_, d) => set('lineSpacing', { auto: false, value: d.optionValue! })}>
          {LS.map(([v, l]) => <Option key={v} value={v} text={l}>{l}</Option>)}
        </Dropdown>
      </AutoRow>
      <AutoRow label={tx("横线")} hint={tx("那一段的下边框（边框和底纹：样式 / 宽度 / 距正文）")} auto={border.auto} onAuto={(a) => set('border', { ...border, auto: a })} note={note.border}>
        <span className="hf-inline">
          <Dropdown size="small" expandIcon={caret} style={DD} disabled={border.auto} value={BS.find((x) => x[0] === bstyle)?.[1] ?? bstyle} selectedOptions={[bstyle]} onOptionSelect={(_, d) => set('border', { auto: false, value: d.optionValue === 'none' ? null : { style: d.optionValue as HFBorder['style'], thickness: d.optionValue === 'single' ? '0.75pt' : '2.25pt', fromText: border.value?.fromText ?? '1pt' } })}>
            {BS.map(([v, l]) => <Option key={v} value={v} text={l}>{l}</Option>)}
          </Dropdown>
          {border.value && !border.auto && (<span className="hf-sub">
            <span className="muted">{tx("线粗")}</span>
            <LengthInput value={border.value.thickness} defaultUnit="pt" allowed={['pt']} allowEmpty={false} onChange={(v) => v && set('border', { auto: false, value: { ...border.value!, thickness: v } })} />
            <span className="muted">{tx("距正文")}</span>
            <LengthInput value={border.value.fromText} defaultUnit="pt" allowed={['pt']} allowEmpty={false} onChange={(v) => v && set('border', { auto: false, value: { ...border.value!, fromText: v } })} />
          </span>)}
        </span>
      </AutoRow>
    </div>
  );
}

export function HeaderFooterDialog() {
  const { open, part, close } = useHFDialog();
  const settings = useStore((s) => s.doc.settings);
  const setSettings = useStore((s) => s.setSettings);
  const [level, setLevel] = useState<HFLevel>('doc');
  const [tab, setTab] = useState<'header' | 'footer' | 'text'>(part);
  useEffect(() => { if (open) setTab(part); }, [open, part]);
  const hf: HeaderFooterSettings = settings.headerFooter ?? {};
  const update = (next: HeaderFooterSettings) => setSettings({ headerFooter: next });
  const rec = (p: 'header' | 'footer'): Partial<HFRecord> => hf.levels?.[level]?.[p] ?? {};
  const setRec = (p: 'header' | 'footer', r: Partial<HFRecord>) => update({ ...hf, levels: { ...hf.levels, [level]: { ...hf.levels?.[level], [p]: r } } });
  const terms = hf.terms ?? {};
  const setTerm = (k: HeaderTermKey, f: HFField<string>) => update({ ...hf, terms: { ...terms, [k]: f } });
  const dirtyLevel = (l: HFLevel) => { const v = hf.levels?.[l]; return !!v && Object.values(v).some((r) => r && Object.entries(r).some(([k, x]) => (k === 'shown' ? x !== 'auto' && x !== undefined : x && !(x as HFField<unknown>).auto))); };
  return (
    <Dialog open={open} onOpenChange={(_, d) => { if (!d.open) close(); }}>
      <DialogSurface className="hf-dialog">
        <DialogBody>
          <DialogTitle>{tx("页眉和页脚")}</DialogTitle>
          <DialogContent>
            <TabList selectedValue={tab} onTabSelect={(_, d) => setTab(d.value as typeof tab)} size="small" className="hf-tabs">
              <Tab value="header">{tx("页眉")}</Tab>
              <Tab value="footer">{tx("页脚")}</Tab>
              <Tab value="text">{tx("页眉文字")}</Tab>
            </TabList>
            {tab !== 'text' ? (
              <>
                <div className="hf-scope">
                  <span className="hf-lab">{tx("作用于")}</span>
                  <div className="seg hf-seg" role="radiogroup">
                    {LEVELS.map((l) => <button key={l.key} type="button" className={level === l.key ? 'on' : ''} title={l.hint} onClick={() => setLevel(l.key)}>{l.label}{dirtyLevel(l.key) && <i className="hf-dot" />}</button>)}
                  </div>
                  <span className="hf-note muted">{LEVELS.find((l) => l.key === level)?.hint}{level !== 'doc' ? tx("；没改的项承上一层") : ''}</span>
                </div>
                <RecordEditor part={tab} rec={rec(tab)} note={autoNote(settings, tab)} onChange={(r) => setRec(tab, r)} />
                <p className="field-hint muted">{tab === 'footer' ? tx("页脚印页码，格式按规范：终稿「- n -」、前置罗马、正文起阿拉伯；能改的只有这几项。") : tx("封面与内封永远不出页眉页脚；页眉印什么按规范由模板定，改字到「页眉文字」。")}</p>
              </>
            ) : (
              <>
                <p className="field-hint muted">{tx("页眉印什么是规范定的：本科、硕士每页「校名 + 文种」，博士奇数页本章标题、偶数页「校名 + 文种」，报告「校名 + 表单名」。这里只改字，不改排法。")}</p>
                <div className="hf-card">
                  {TERMS.map((tm) => { const f = field(terms[tm.key], ''); const dft = termDefault(settings, tm.key); return (
                    <AutoRow key={tm.key} label={tm.label} hint={tm.hint} auto={f.auto} onAuto={(a) => setTerm(tm.key, { ...f, auto: a })} note={dft || tx("这一档用不上")}>
                      <Input size="small" className="hf-text" disabled={f.auto} value={f.value} placeholder={dft || tm.hint} onChange={(_, d) => setTerm(tm.key, { auto: false, value: d.value })} />
                    </AutoRow>
                  ); })}
                </div>
              </>
            )}
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={close}>{tx("关闭")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
