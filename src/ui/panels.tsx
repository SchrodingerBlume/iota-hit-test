// 其余的节：摘要、符号与缩略语、正文类富文本、参考文献、成果、答辩、页面设置。
import { useMemo } from 'react';
import { useStore, type RichKey } from '../model/store';
import { PAGE_DEFS, resolvePage } from '../model/pages';
import { TriSeg, ON_OFF, SettingSwitch } from './TriSwitch';
import type { Abbreviation, SymbolEntry, DefensePerson, Pages, OpenrightKey, ThesisDoc } from '../model/types';
import { RichEditor } from '../editor/RichEditor';
import { BibEditor } from './BibEditor';
import { MathPreview } from '../editor/math/MathPreview';
import { MathEditor } from '../editor/math/MathEditor';
import { useState } from 'react';
import { indexPositions, type PMNode } from '../typst/pmToTypst';
import { getEditor, whenEditorReady } from '../editor/registry';
import { useOpenRequest } from '../editor/openRequest';
import { t as tx } from '../i18n';

// ── 索引词登记：正文里 #idx[词] 标的都在这儿列着，改名、删除、跳过去 ──
const IDX_KEYS: RichKey[] = ['abstractZh', 'abstractEn', 'body', 'conclusion', 'appendix', 'acknowledgement', 'resume'];
const SECTION_OF: Record<RichKey, string> = { abstractZh: 'abstract', abstractEn: 'abstract', body: 'body', conclusion: 'conclusion', appendix: 'appendix', acknowledgement: 'acknowledgement', resume: 'resume' };
const KEY_LABEL: Record<RichKey, string> = { abstractZh: tx("中文摘要"), abstractEn: tx("英文摘要"), body: tx("正文"), conclusion: tx("结论"), appendix: tx("附录"), acknowledgement: tx("致谢"), resume: tx("简历") };
interface IdxHit { key: RichKey; pos: number; text: string; context: string }

function collectIdx(doc: Record<RichKey, PMNode>): IdxHit[] {
  const out: IdxHit[] = [];
  for (const key of IDX_KEYS) {
    const d = doc[key];
    if (!d) continue;
    const posOf = indexPositions(d);
    const walk = (n: PMNode, para: PMNode | null) => {
      if (n.type === 'idx') {
        const text = String(n.attrs?.text ?? '');
        const ctx = para ? (para.content ?? []).map((c) => (c.type === 'text' ? c.text ?? '' : c.type === 'idx' ? `【${c.attrs?.text ?? ''}】` : '')).join('') : '';
        out.push({ key, pos: posOf.get(n) ?? 0, text, context: ctx.length > 60 ? `${ctx.slice(0, 60)}…` : ctx });
        return;
      }
      for (const c of n.content ?? []) walk(c, n.type === 'paragraph' || n.type === 'heading' ? n : para);
    };
    walk(d, null);
  }
  return out;
}

/** 把某份富文本里的 idx 节点改一遍（改名 / 拆成普通文字） */
function mapIdx(d: PMNode, fn: (n: PMNode) => PMNode | PMNode[] | null): PMNode {
  const walk = (n: PMNode): PMNode => {
    if (!n.content) return n;
    const content: PMNode[] = [];
    for (const c of n.content) {
      if (c.type === 'idx') { const r = fn(c); if (r === null) continue; if (Array.isArray(r)) content.push(...r); else content.push(r); }
      else content.push(walk(c));
    }
    return { ...n, content };
  };
  return walk(d);
}

export function IndexPanel() {
  const doc = useStore((s) => s.doc);
  const setRich = useStore((s) => s.setRich);
  const setSection = useStore((s) => s.setSection);
  const hits = useMemo(() => collectIdx(doc as any), [doc]);
  const terms = useMemo(() => {
    const m = new Map<string, IdxHit[]>();
    for (const h of hits) (m.get(h.text) ?? m.set(h.text, []).get(h.text)!).push(h);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh'));
  }, [hits]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const rename = (from: string, to: string) => {
    const t = to.trim();
    if (!t || t === from) { setEditing(null); return; }
    for (const key of IDX_KEYS) if (doc[key]) setRich(key, mapIdx(doc[key] as any, (n) => (n.attrs?.text === from ? { ...n, attrs: { ...n.attrs, text: t } } : n)) as any);
    setEditing(null);
  };
  const unregister = (term: string) => {
    // 删掉登记、留下正文里的字
    for (const key of IDX_KEYS) if (doc[key]) setRich(key, mapIdx(doc[key] as any, (n) => (n.attrs?.text === term ? (n.attrs?.text ? { type: 'text', text: String(n.attrs.text) } : null) : n)) as any);
  };
  const jump = async (h: IdxHit) => {
    setSection(SECTION_OF[h.key] as any);
    const ed = getEditor(h.key) ?? (await whenEditorReady(h.key));
    if (!ed) return;
    ed.chain().focus().setNodeSelection(Math.min(h.pos, ed.state.doc.content.size - 1)).scrollIntoView().run();
    useOpenRequest.getState().request({ key: h.key, pos: h.pos });
  };
  return (
    <>
      <h2>{tx("索引")}</h2>
      {!terms.length && <p className="muted">{tx("没有索引项。选择文字后，单击“引用”中的“标记条目”。")}</p>}
      {terms.length > 0 && (
        <table className="idx-table">
          <thead><tr><th>{tx("词")}</th><th>{tx("出现")}</th><th>{tx("位置")}</th><th /></tr></thead>
          <tbody>
            {terms.map(([term, list]) => (
              <tr key={term}>
                <td>
                  {editing === term
                    ? <input className="idx-rename" value={draft} autoFocus onChange={(e) => setDraft(e.target.value)} onBlur={() => rename(term, draft)} onKeyDown={(e) => { if (e.nativeEvent.isComposing || e.keyCode === 229) return; if (e.key === 'Enter') rename(term, draft); if (e.key === 'Escape') setEditing(null); }} />
                    : <button type="button" className="idx-term" title={tx("改名（全篇同名的一起改）")} onClick={() => { setEditing(term); setDraft(term); }}>{term || <em className="muted">{tx("（空）")}</em>}</button>}
                </td>
                <td className="muted">{list.length} {' '}{tx("处")}</td>
                <td>
                  <ul className="idx-hits">
                    {list.map((h, i) => <li key={i}><button type="button" className="idx-jump" title={tx("跳到这一处")} onClick={() => void jump(h)}>{KEY_LABEL[h.key]}</button><span className="muted"> {h.context}</span></li>)}
                  </ul>
                </td>
                <td><button type="button" className="btn btn-xs" onClick={() => unregister(term)}>{tx("取消标记")}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

export function RichSection({ title, lead, richKey, headings, blocks, placeholder, extra }: { title: string; lead?: string; richKey: RichKey; headings: boolean; blocks?: boolean; placeholder?: string; extra?: React.ReactNode }) {
  const part = richKey === 'body' ? 'body' : richKey === 'appendix' ? 'appendix' : 'other';
  const value = useStore((s) => s.doc[richKey]);
  const setRich = useStore((s) => s.setRich);
  return (
    <>
      <h2>{title}</h2>
      {lead && <p className="lead">{lead}</p>}
      {extra}
      <RichEditor instanceKey={richKey} value={value} onChange={(v) => setRich(richKey, v)} headings={headings} blocks={blocks ?? true} placeholder={placeholder} part={part} richKey={richKey} />
    </>
  );
}

/** 某一页页面设置：三态，auto 照指南 */
export function PageSwitch({ pageKey }: { pageKey: keyof Pages }) {
  const doc = useStore((s) => s.doc);
  const setPages = useStore((s) => s.setPages);
  const def = PAGE_DEFS.find((d) => d.key === pageKey)!;
  const r = resolvePage(doc, pageKey);
  return <TriSeg label={def.label} hint={def.hint} choices={[{ value: false, label: tx("不显示") }, { value: true, label: tx("显示") }]} value={r.isAuto ? 'auto' : r.value} auto={r.auto} onChange={(v) => setPages({ [pageKey]: v } as any)} />;
}

export function AbstractPanel() {
  const zh = useStore((s) => s.doc.abstractZh);
  const en = useStore((s) => s.doc.abstractEn);
  const setRich = useStore((s) => s.setRich);
  return (
    <>
      <h2>{tx("摘要")}</h2>
      <div className="card"><SettingSwitch k="abstractKeywordsAbove" /></div>
      <h3>{tx("中文摘要")}</h3>
      <RichEditor instanceKey="abstractZh" richKey="abstractZh" value={zh} onChange={(v) => setRich('abstractZh', v)} headings={false} blocks={false} placeholder={tx("中文摘要……")} />
      <h3 style={{ marginTop: 20 }}>Abstract</h3>
      <RichEditor instanceKey="abstractEn" richKey="abstractEn" value={en} onChange={(v) => setRich('abstractEn', v)} headings={false} blocks={false} placeholder="English abstract…" />
    </>
  );
}

export function NomenclaturePanel() {
  const abbreviations = useStore((s) => s.doc.abbreviations);
  const symbols = useStore((s) => s.doc.symbols);
  const opts = useStore((s) => s.doc.nomenclatureOptions);
  const doc = useStore((s) => s.doc);
  const setAbbreviations = useStore((s) => s.setAbbreviations);
  const setSymbols = useStore((s) => s.setSymbols);
  const setOpts = useStore((s) => s.setNomenclatureOptions);
  const both = resolvePage(doc, 'symbolsPage').value && resolvePage(doc, 'abbreviationsPage').value;
  const [advanced, setAdvanced] = useState(false);
  return (
    <>
      <h2>{tx("符号与缩略语")}</h2>
      <div className="card">
        <h3>{tx("缩略语")}</h3>
        <table className="tbl">
          <thead><tr><th style={{ width: 110 }}>{tx("缩写")}</th><th>{tx("中文全称")}</th><th>{tx("英文全称")}</th>{advanced && <><th style={{ width: 100 }}>{tx("显示文字")}</th><th style={{ width: 100 }}>{tx("复数")}</th><th style={{ width: 60 }}>{tx("加入索引")}</th></>}<th /></tr></thead>
          <tbody>
            {abbreviations.map((r, i) => {
              const set = (patch: Partial<Abbreviation>) => setAbbreviations(abbreviations.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              return (
                <tr key={i}>
                  <td><input style={{ fontFamily: 'var(--mono)' }} value={r.key} placeholder="FEM" onChange={(e) => set({ key: e.target.value.replace(/\s+/g, '') })} /></td>
                  <td><input value={r.long} placeholder={tx("有限元方法")} onChange={(e) => set({ long: e.target.value })} /></td>
                  <td><input value={r.longEn} placeholder="Finite Element Method" onChange={(e) => set({ longEn: e.target.value })} /></td>
                  {advanced && <>
                    <td><input value={r.short ?? ''} placeholder={r.key || tx("同键")} title={tx("印出来的缩写；空 = 与键相同")} onChange={(e) => set({ short: e.target.value })} /></td>
                    <td><input value={r.plural ?? ''} placeholder={(r.short || r.key) ? `${r.short || r.key}s` : tx("缩写+s")} title={tx("复数形式；空 = 缩写加 s")} onChange={(e) => set({ plural: e.target.value })} /></td>
                    <td style={{ textAlign: 'center' }}><select value={r.indexed === undefined ? '' : r.indexed ? 'yes' : 'no'} onChange={(e) => set({ indexed: e.target.value === '' ? undefined : e.target.value === 'yes' })} title={tx("这一条要不要登记进索引；空 = 跟「论文设置」里的开关")}><option value="">{tx("跟设置")}</option><option value="yes">{tx("是")}</option><option value="no">{tx("否")}</option></select></td>
                  </>}
                  <td><button type="button" className="del" title={tx("删除")} onClick={() => setAbbreviations(abbreviations.filter((_, j) => j !== i))}>✕</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 6 }}>
          <button type="button" className="btn btn-xs" onClick={() => setAbbreviations([...abbreviations, { key: '', long: '', longEn: '' }])}>{tx("＋ 添加一行")}</button>
          <button type="button" className="btn btn-xs btn-ghost" onClick={() => setAdvanced((a) => !a)}>{advanced ? tx("收起高级选项") : tx("高级选项")}</button>
        </div>
        <SettingSwitch k="abbreviationLinks" />
        <SettingSwitch k="abbreviationIndexed" />
      </div>
      <div className="card">
        <h3>{tx("物理量符号")}</h3>
        <SymbolTable rows={symbols} onChange={setSymbols} />
      </div>
      <div className="card">
        <h3>{tx("表格格式")}</h3>
        <TriSeg label={tx("排序方式")} hint={tx("hithesis 按缩写字母序；也可以照你登记的顺序")} choices={[{ value: 'alpha', label: tx("字母序") }, { value: 'declared', label: tx("添加顺序") }]} value={opts.sort ?? 'auto'} auto={{ value: 'alpha', reason: tx("hithesis 按缩写字母序（不分大小写）") }} onChange={(v) => setOpts({ sort: v as any })} />
        <TriSeg label={tx("显示范围")} hint={tx("只列正文里用过的，还是登记的全部缩略语")} choices={[{ value: 'used', label: tx("已使用的缩略语") }, { value: 'all', label: tx("全部缩略语") }]} value={opts.usedOnly ?? 'auto'} auto={{ value: 'used', reason: tx("只列正文里用过的（hithesis 同）") }} onChange={(v) => setOpts({ usedOnly: v as any })} />
        <TriSeg label={tx("显示标题行")} hint={tx("「符号 / 说明」「缩写 / 全称」那一行")} choices={ON_OFF} value={opts.header === 'auto' ? 'auto' : opts.header === 'on'} auto={{ value: false, reason: tx("跟模板：hithesis 与 thuthesis 都不印列头") }} onChange={(v) => setOpts({ header: v === 'auto' ? 'auto' : v ? 'on' : 'off' })} />
        <div className="triseg">
          <div className="triseg-lab" title={tx("说明列从左边多远起，两张表共用；留空按内容自动")}>{tx("说明列起点")}</div>
          <span className="row"><input className="input" style={{ width: 90 }} type="number" min={1} max={8} step={0.1} value={opts.hangingIndent} placeholder={tx("自动")} onChange={(e) => setOpts({ hangingIndent: e.target.value })} /><span className="muted">cm</span></span>
          <div className="triseg-note">{opts.hangingIndent ? tx("说明列从 {{hangingIndent}} cm 起", { hangingIndent: opts.hangingIndent }) : tx("自动适应符号和缩写的宽度")}</div>
        </div>
        {both && (
          <TriSeg label={tx("合并页的小标题")} hint={tx("一页两段时，「符号」「缩略语」两个小标题照哪一页的样子")} choices={[{ value: 'achievements', label: tx("照成果页") }, { value: 'declarations', label: tx("照声明页") }, { value: 'no-subheadings', label: tx("不印") }]} value={opts.form === 'auto' ? 'auto' : opts.form} auto={{ value: 'achievements', reason: tx("宋体小四加粗顶格（成果页的组名样式）") }} onChange={(v) => setOpts({ form: v as any })} />
        )}
      </div>
    </>
  );
}

/** 正文里引用过的 key（cite 节点） */
function collectCited(docs: any[]): Set<string> {
  const out = new Set<string>();
  const walk = (n: any) => {
    if (n?.type === 'cite') for (const k of String(n.attrs?.keys ?? '').split(/[,\s;]+/)) if (k) out.add(k);
    for (const c of n?.content ?? []) walk(c);
  };
  docs.forEach(walk);
  return out;
}

export function BibPanel({ which }: { which: 'bibliography' | 'achievements' }) {
  const references = useStore((s) => s.doc.references);
  const achievementEntries = useStore((s) => s.doc.achievementEntries);
  const body = useStore((s) => s.doc.body);
  const appendix = useStore((s) => s.doc.appendix);
  const setReferences = useStore((s) => s.setReferences);
  const setAchievementEntries = useStore((s) => s.setAchievementEntries);
  const isBib = which === 'bibliography';
  const cited = useMemo(() => collectCited([body, appendix]), [body, appendix]);
  return (
    <>
      <h2>{isBib ? tx("参考文献") : tx("攻读学位期间取得的成果")}</h2>
      {isBib
        ? <BibEditor mode="references" entries={references} onChange={setReferences} citedKeys={cited} fileName="refs.bib" />
        : <BibEditor mode="achievements" entries={achievementEntries} onChange={setAchievementEntries} fileName="achievements.bib" />}
    </>
  );
}

function PersonRow({ p, onChange }: { p: DefensePerson; onChange: (p: DefensePerson) => void }) {
  return (
    <div className="row" style={{ marginBottom: 6 }}>
      <input className="input" style={{ width: 110 }} value={p.name} placeholder={tx("姓名")} onChange={(e) => onChange({ ...p, name: e.target.value })} />
      <input className="input" style={{ width: 140 }} value={p.title} placeholder={tx("职称（是否博导）")} onChange={(e) => onChange({ ...p, title: e.target.value })} />
      <input className="input" style={{ width: 170 }} value={p.affiliation} placeholder={tx("工作单位")} onChange={(e) => onChange({ ...p, affiliation: e.target.value })} />
      <input className="input" style={{ width: 120 }} value={p.discipline} placeholder={tx("所在学科")} onChange={(e) => onChange({ ...p, discipline: e.target.value })} />
    </div>
  );
}

export function DefensePanel() {
  const defense = useStore((s) => s.doc.defense);
  const { setDefense } = useStore();
  const setList = (k: 'reviewers' | 'members', i: number, p: DefensePerson) => setDefense({ ...defense, [k]: defense[k].map((x, j) => (j === i ? p : x)) });
  const blank = { name: '', title: '', affiliation: '', discipline: '' };
  return (
    <>
      <h2>{tx("评阅人、答辩委员会与决议")}</h2>
      <div className="card">
        <h3>{tx("评阅人")}</h3>
        {defense.reviewers.map((p, i) => <PersonRow key={i} p={p} onChange={(x) => setList('reviewers', i, x)} />)}
        <button type="button" className="btn btn-xs" onClick={() => setDefense({ ...defense, reviewers: [...defense.reviewers, blank] })}>{tx("＋ 评阅人")}</button>
      </div>
      <div className="card">
        <h3>{tx("答辩委员会主席")}</h3>
        <PersonRow p={defense.chair} onChange={(x) => setDefense({ ...defense, chair: x })} />
        <h3 style={{ marginTop: 12 }}>{tx("委员")}</h3>
        {defense.members.map((p, i) => <PersonRow key={i} p={p} onChange={(x) => setList('members', i, x)} />)}
        <button type="button" className="btn btn-xs" onClick={() => setDefense({ ...defense, members: [...defense.members, blank] })}>{tx("＋ 委员")}</button>
        <h3 style={{ marginTop: 12 }}>{tx("秘书")}</h3>
        <PersonRow p={defense.secretary} onChange={(x) => setDefense({ ...defense, secretary: x })} />
      </div>
      <h3>{tx("答辩决议")}</h3>
      <RichEditor instanceKey="defense-resolution" value={defense.resolution} onChange={(v) => setDefense({ ...defense, resolution: v })} headings={false} blocks={false} placeholder={tx("答辩委员会听取了论文作者的报告，审阅了论文，经质询与讨论，认为……")} />
    </>
  );
}

const OPENRIGHT_OF: Partial<Record<keyof Pages, OpenrightKey>> = { abstract: 'abstract', symbolsPage: 'nomenclature', tableOfContents: 'tableOfContents', listOfFigures: 'listOfFigures', listOfTables: 'listOfTables', listOfEquations: 'listOfEquations', achievements: 'achievements', defense: 'defense', declarations: 'declarations', index: 'index', resume: 'resume' };

// 右手页起的四层：这一页自己 → 所在的段（前置 / 正文 / 后置） → 全篇总闸 → 模板按学位的表
// （openright-auto：博士只有内封 true，各段都 false）。auto 显示的就是往上找到的那一档
const MATTER_OF: Record<OpenrightKey, 'frontmatter' | 'mainmatter' | 'backmatter'> = {
  frontmatter: 'frontmatter', abstract: 'frontmatter', nomenclature: 'frontmatter', tableOfContents: 'frontmatter', listOfFigures: 'frontmatter', listOfTables: 'frontmatter', listOfEquations: 'frontmatter',
  mainmatter: 'mainmatter', conclusion: 'mainmatter',
  achievements: 'backmatter', defense: 'backmatter', declarations: 'backmatter', index: 'backmatter', acknowledgement: 'backmatter', resume: 'backmatter',
};
function openrightAuto(doc: ThesisDoc, orKey: OpenrightKey): { value: boolean; reason: string } {
  const matter = MATTER_OF[orKey];
  const m = orKey !== matter ? doc.openright?.[matter as OpenrightKey] : undefined;
  if (m === true || m === false) return { value: m, reason: tx("跟随所在部分的设定") };
  const gate = doc.settings.openright;
  if (gate === true || gate === false) return { value: gate, reason: tx("跟随全篇总闸（论文设置里的「右翻页」）") };
  return { value: false, reason: doc.settings.degreeLevel === 'doctor' ? tx("模板按学位：博士只内封右翻，各段都不跳") : tx("模板按学位：{{v0}}各段都不跳", { v0: doc.settings.degreeLevel === 'master' ? tx("硕士") : tx("本科") }) };
}

function OpenrightSwitch({ orKey, label, sub }: { orKey: OpenrightKey; label: string; sub?: boolean }) {
  const doc = useStore((s) => s.doc);
  const setOpenright = useStore((s) => s.setOpenright);
  const v = doc.openright?.[orKey] ?? 'auto';
  return <TriSeg className={sub ? 'is-sub' : ''} label={label} hint={tx("从右手页（奇数页）起，前面不够就补一张空白页；Auto 往上跟：所在部分 → 全篇总闸 → 模板按学位的表")} choices={ON_OFF} value={v} auto={openrightAuto(doc, orKey)} onChange={(x) => setOpenright({ [orKey]: x })} />;
}

export function PagesPanel() {
  return (
    <>
      <h2>{tx("页面设置")}</h2>
      <div className="card">
        <h3>{tx("右手页起")}</h3>
        <OpenrightSwitch orKey="frontmatter" label={tx("前置部分")} />
        <OpenrightSwitch orKey="mainmatter" label={tx("正文（各章）")} />
        <OpenrightSwitch orKey="conclusion" label={tx("结论")} />
        <OpenrightSwitch orKey="acknowledgement" label={tx("致谢")} />
      </div>
      {([tx("前置"), tx("后置")] as const).map((g) => (
        <div className="card" key={g}>
          <h3>{g}</h3>
          {PAGE_DEFS.filter((d) => d.group === g).map((d) => (
            <div key={d.key} className="page-row">
              <PageSwitch pageKey={d.key} />
              {OPENRIGHT_OF[d.key] && <OpenrightSwitch orKey={OPENRIGHT_OF[d.key]!} label={tx("右手页起")} sub />}
              {d.key === 'tableOfContents' && <SettingSwitch k="tocLang" className="is-sub" />}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

/** 物理量符号表：每行一个符号（Typst 或 LaTeX，带预览）+ 含义 */
function SymbolTable({ rows, onChange }: { rows: SymbolEntry[]; onChange: (r: SymbolEntry[]) => void }) {
  const [editing, setEditing] = useState<number | null>(null);
  const set = (i: number, patch: Partial<SymbolEntry>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <>
      <table className="tbl sym">
        <thead><tr><th style={{ width: 90 }}>{tx("预览")}</th><th>{tx("符号")}</th><th>{tx("含义与单位")}</th><th /></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="sym-preview"><button type="button" className="sym-btn" title={tx("点开可视化编辑")} onClick={() => setEditing(editing === i ? null : i)}><MathPreview src={r.symbol} mode={r.mode === 'latex' ? 'latex' : 'typst'} empty="…" /></button></td>
              <td>
                <span className="row" style={{ flexWrap: 'nowrap' }}>
                  <input style={{ fontFamily: 'var(--mono)' }} value={r.symbol} placeholder={r.mode === 'latex' ? '\\eta' : 'eta'} onChange={(e) => set(i, { symbol: e.target.value })} />
                  <span className="seg" title={tx("写法")} style={{ flex: 'none' }}>
                    <button type="button" className={r.mode === 'latex' ? 'on' : ''} onClick={() => set(i, { mode: 'latex' })}>L</button>
                    <button type="button" className={r.mode !== 'latex' ? 'on' : ''} onClick={() => set(i, { mode: 'typst' })}>T</button>
                  </span>
                </span>
              </td>
              <td><input value={r.meaning} placeholder={tx("气体动力黏度，Pa·s")} onChange={(e) => set(i, { meaning: e.target.value })} /></td>
              <td><button type="button" className="del" title={tx("删除")} onClick={() => { onChange(rows.filter((_, j) => j !== i)); setEditing(null); }}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing !== null && rows[editing] && (
        <div className="card" style={{ marginTop: 8 }}>
          <h3>{tx("编辑符号 · 第")}{' '}{editing + 1} {' '}{tx("行")}</h3>
          <MathEditor value={rows[editing].symbol} mode={rows[editing].mode === 'latex' ? 'latex' : 'typst'} display={false} onChange={(v) => set(editing, { symbol: v })} onMode={(m) => set(editing, { mode: m })} />
        </div>
      )}
      <button type="button" className="btn btn-xs" style={{ marginTop: 6 }} onClick={() => onChange([...rows, { symbol: '', mode: 'latex', meaning: '' }])}>{tx("＋ 添加一行")}</button>
    </>
  );
}
