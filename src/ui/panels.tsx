// 其余的节：摘要、符号与缩略语、正文类富文本、参考文献、成果、答辩、页面开关。
import { useMemo } from 'react';
import { useStore, type RichKey } from '../model/store';
import { PAGE_DEFS, resolvePage } from '../model/pages';
import { TriSeg, ON_OFF } from './TriSwitch';
import type { Abbreviation, SymbolEntry, DefensePerson, Pages } from '../model/types';
import { RichEditor } from '../editor/RichEditor';
import { BibEditor } from './BibEditor';
import { MathPreview } from '../editor/math/MathPreview';
import { MathEditor } from '../editor/math/MathEditor';
import { useState } from 'react';

export function RichSection({ title, lead, richKey, headings, blocks, placeholder }: { title: string; lead?: string; richKey: RichKey; headings: boolean; blocks?: boolean; placeholder?: string }) {
  const part = richKey === 'body' ? 'body' : richKey === 'appendix' ? 'appendix' : 'other';
  const value = useStore((s) => s.doc[richKey]);
  const setRich = useStore((s) => s.setRich);
  return (
    <>
      <h2>{title}</h2>
      {lead && <p className="lead">{lead}</p>}
      <RichEditor instanceKey={richKey} value={value} onChange={(v) => setRich(richKey, v)} headings={headings} blocks={blocks ?? true} placeholder={placeholder} part={part} richKey={richKey} />
    </>
  );
}

/** 某一页排不排：三态，auto 照指南 */
export function PageSwitch({ pageKey }: { pageKey: keyof Pages }) {
  const doc = useStore((s) => s.doc);
  const setPages = useStore((s) => s.setPages);
  const def = PAGE_DEFS.find((d) => d.key === pageKey)!;
  const r = resolvePage(doc, pageKey);
  return <TriSeg label={def.label} hint={def.hint} choices={ON_OFF} value={r.isAuto ? 'auto' : r.value} auto={r.auto} onChange={(v) => setPages({ [pageKey]: v } as any)} />;
}

export function AbstractPanel() {
  const zh = useStore((s) => s.doc.abstractZh);
  const en = useStore((s) => s.doc.abstractEn);
  const setRich = useStore((s) => s.setRich);
  return (
    <>
      <h2>摘要</h2>
      <p className="lead">关键词在「元信息」里填。缩略语在摘要里也会首次展开、正文开头再重置一次。</p>
      <h3>中文摘要</h3>
      <RichEditor instanceKey="abstractZh" richKey="abstractZh" value={zh} onChange={(v) => setRich('abstractZh', v)} headings={false} blocks={false} placeholder="中文摘要……" />
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
      <h2>符号与缩略语</h2>
      <p className="lead">物理量名称及符号表（规范 2.4 点名的前置表，可略）与缩略语表（hithesis 加的一页）。正文里用工具栏「Ab」插入缩写，首次出现自动展开成「有限元方法（Finite Element Method，FEM）」——不排表也照常展开。</p>
      <div className="card">
        <h3>排不排</h3>
        <PageSwitch pageKey="symbolsPage" />
        <PageSwitch pageKey="abbreviationsPage" />
        {both && <PageSwitch pageKey="nomenclatureMerged" />}
      </div>
      <div className="card">
        <h3>缩略语</h3>
        <table className="tbl">
          <thead><tr><th style={{ width: 110 }}>缩写（键）</th><th>中文全称</th><th>英文全称</th>{advanced && <><th style={{ width: 100 }}>印成</th><th style={{ width: 100 }}>复数</th><th style={{ width: 60 }}>进索引</th></>}<th /></tr></thead>
          <tbody>
            {abbreviations.map((r, i) => {
              const set = (patch: Partial<Abbreviation>) => setAbbreviations(abbreviations.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              return (
                <tr key={i}>
                  <td><input style={{ fontFamily: 'var(--mono)' }} value={r.key} placeholder="FEM" onChange={(e) => set({ key: e.target.value.replace(/\s+/g, '') })} /></td>
                  <td><input value={r.long} placeholder="有限元方法" onChange={(e) => set({ long: e.target.value })} /></td>
                  <td><input value={r.longEn} placeholder="Finite Element Method" onChange={(e) => set({ longEn: e.target.value })} /></td>
                  {advanced && <>
                    <td><input value={r.short ?? ''} placeholder={r.key || '同键'} title="印出来的缩写；空 = 与键相同" onChange={(e) => set({ short: e.target.value })} /></td>
                    <td><input value={r.plural ?? ''} placeholder={(r.short || r.key) ? `${r.short || r.key}s` : '缩写+s'} title="复数形式；空 = 缩写加 s" onChange={(e) => set({ plural: e.target.value })} /></td>
                    <td style={{ textAlign: 'center' }}><select value={r.indexed === undefined ? '' : r.indexed ? 'yes' : 'no'} onChange={(e) => set({ indexed: e.target.value === '' ? undefined : e.target.value === 'yes' })} title="这一条要不要登记进索引；空 = 跟「论文设置」里的开关"><option value="">跟设置</option><option value="yes">是</option><option value="no">否</option></select></td>
                  </>}
                  <td><button type="button" className="del" title="删除" onClick={() => setAbbreviations(abbreviations.filter((_, j) => j !== i))}>✕</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 6 }}>
          <button type="button" className="btn btn-xs" onClick={() => setAbbreviations([...abbreviations, { key: '', long: '', longEn: '' }])}>＋ 添加一行</button>
          <button type="button" className="btn btn-xs btn-ghost" onClick={() => setAdvanced((a) => !a)}>{advanced ? '收起' : '更多字段'}（印成什么、复数、进索引）</button>
        </div>
      </div>
      <div className="card">
        <h3>物理量符号</h3>
        <SymbolTable rows={symbols} onChange={setSymbols} />
      </div>
      <div className="card">
        <h3>表的排法</h3>
        <TriSeg label="缩略语的次序" hint="hithesis 按缩写字母序；也可以照你登记的顺序" choices={[{ value: 'alpha', label: '字母序' }, { value: 'declared', label: '照登记顺序' }]} value={opts.sort ?? 'auto'} auto={{ value: 'alpha', reason: 'hithesis 按缩写字母序（不分大小写）' }} onChange={(v) => setOpts({ sort: v as any })} />
        <TriSeg label="缩略语列哪些" hint="只列正文里用过的，还是登记的全列" choices={[{ value: 'used', label: '只列用过的' }, { value: 'all', label: '全列' }]} value={opts.usedOnly ?? 'auto'} auto={{ value: 'used', reason: '只列正文里用过的（hithesis 同）' }} onChange={(v) => setOpts({ usedOnly: v as any })} />
        <TriSeg label="列头" hint="「符号 / 说明」「缩写 / 全称」那一行" choices={ON_OFF} value={opts.header === 'auto' ? 'auto' : opts.header === 'on'} auto={{ value: false, reason: '跟模板：hithesis 与 thuthesis 都不印列头' }} onChange={(v) => setOpts({ header: v === 'auto' ? 'auto' : v ? 'on' : 'off' })} />
        <div className="triseg">
          <div className="triseg-lab" title="说明列从左边多远起，两张表共用；留空按内容自动">说明列起点</div>
          <span className="row"><input className="input" style={{ width: 90 }} type="number" min={1} max={8} step={0.1} value={opts.hangingIndent} placeholder="自动" onChange={(e) => setOpts({ hangingIndent: e.target.value })} /><span className="muted">cm</span></span>
          <div className="triseg-note">{opts.hangingIndent ? `说明列从 ${opts.hangingIndent} cm 起` : '自动 → 按最宽的符号 / 缩写定（hithesis 的 labelwidth）'}</div>
        </div>
        {both && (
          <TriSeg label="合并页的小标题" hint="一页两段时，「符号」「缩略语」两个小标题照哪一页的样子" choices={[{ value: 'achievements', label: '照成果页' }, { value: 'declarations', label: '照声明页' }, { value: 'no-subheadings', label: '不印' }]} value={opts.form === 'auto' ? 'auto' : opts.form} auto={{ value: 'achievements', reason: '宋体小四加粗顶格（成果页的组名样式）' }} onChange={(v) => setOpts({ form: v as any })} />
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
      <h2>{isBib ? '参考文献' : '攻读学位期间取得的成果'}</h2>
      <p className="lead">
        {isBib
          ? '像 Zotero 那样逐条填；条目由 omni-gb7714 按 GB/T 7714—2025 排，正文里用工具栏「引用」插入。也能导入 / 导出 .bib，或直接改源码。'
          : '本人的论文、专利、项目与获奖，按类型分三组排；收录情况、影响因子、对应章节写在「附注」里。也能导入 / 导出 .bib。'}
      </p>
      {!isBib && <div className="card"><PageSwitch pageKey="achievements" /></div>}
      {isBib
        ? <BibEditor mode="references" entries={references} onChange={setReferences} citedKeys={cited} fileName="refs.bib" />
        : <BibEditor mode="achievements" entries={achievementEntries} onChange={setAchievementEntries} fileName="achievements.bib" />}
    </>
  );
}

function PersonRow({ p, onChange }: { p: DefensePerson; onChange: (p: DefensePerson) => void }) {
  return (
    <div className="row" style={{ marginBottom: 6 }}>
      <input className="input" style={{ width: 110 }} value={p.name} placeholder="姓名" onChange={(e) => onChange({ ...p, name: e.target.value })} />
      <input className="input" style={{ width: 140 }} value={p.title} placeholder="职称（是否博导）" onChange={(e) => onChange({ ...p, title: e.target.value })} />
      <input className="input" style={{ width: 170 }} value={p.affiliation} placeholder="工作单位" onChange={(e) => onChange({ ...p, affiliation: e.target.value })} />
      <input className="input" style={{ width: 120 }} value={p.discipline} placeholder="所在学科" onChange={(e) => onChange({ ...p, discipline: e.target.value })} />
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
      <h2>评阅人、答辩委员会与决议</h2>
      <p className="lead">新版研究生范例加的一页，博士有；一人一条记录，留空的行不排。</p>
      <div className="card"><PageSwitch pageKey="defense" /></div>
      <div className="card">
        <h3>评阅人</h3>
        {defense.reviewers.map((p, i) => <PersonRow key={i} p={p} onChange={(x) => setList('reviewers', i, x)} />)}
        <button type="button" className="btn btn-xs" onClick={() => setDefense({ ...defense, reviewers: [...defense.reviewers, blank] })}>＋ 评阅人</button>
      </div>
      <div className="card">
        <h3>答辩委员会主席</h3>
        <PersonRow p={defense.chair} onChange={(x) => setDefense({ ...defense, chair: x })} />
        <h3 style={{ marginTop: 12 }}>委员</h3>
        {defense.members.map((p, i) => <PersonRow key={i} p={p} onChange={(x) => setList('members', i, x)} />)}
        <button type="button" className="btn btn-xs" onClick={() => setDefense({ ...defense, members: [...defense.members, blank] })}>＋ 委员</button>
        <h3 style={{ marginTop: 12 }}>秘书</h3>
        <PersonRow p={defense.secretary} onChange={(x) => setDefense({ ...defense, secretary: x })} />
      </div>
      <h3>答辩决议</h3>
      <RichEditor instanceKey="defense-resolution" value={defense.resolution} onChange={(v) => setDefense({ ...defense, resolution: v })} headings={false} blocks={false} placeholder="答辩委员会听取了论文作者的报告，审阅了论文，经质询与讨论，认为……" />
    </>
  );
}

export function PagesPanel() {
  return (
    <>
      <h2>页面开关</h2>
      <p className="lead">封面、内封、摘要、目录、正文、结论、参考文献、致谢总是有；这里是可选的那几页。自动档照两份指南与范例的说法：谁有这一页、谁没有，或者有没有内容。终稿专有的页在开题、中期档里由模板静默跳过。</p>
      <div className="card">
        {PAGE_DEFS.map((d) => <PageSwitch key={d.key} pageKey={d.key} />)}
      </div>
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
        <thead><tr><th style={{ width: 90 }}>预览</th><th>符号</th><th>含义与单位</th><th /></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="sym-preview"><button type="button" className="sym-btn" title="点开可视化编辑" onClick={() => setEditing(editing === i ? null : i)}><MathPreview src={r.symbol} mode={r.mode === 'latex' ? 'latex' : 'typst'} empty="…" /></button></td>
              <td>
                <span className="row" style={{ flexWrap: 'nowrap' }}>
                  <input style={{ fontFamily: 'var(--mono)' }} value={r.symbol} placeholder={r.mode === 'latex' ? '\\eta' : 'eta'} onChange={(e) => set(i, { symbol: e.target.value })} />
                  <span className="seg" title="写法" style={{ flex: 'none' }}>
                    <button type="button" className={r.mode === 'latex' ? 'on' : ''} onClick={() => set(i, { mode: 'latex' })}>L</button>
                    <button type="button" className={r.mode !== 'latex' ? 'on' : ''} onClick={() => set(i, { mode: 'typst' })}>T</button>
                  </span>
                </span>
              </td>
              <td><input value={r.meaning} placeholder="气体动力黏度，Pa·s" onChange={(e) => set(i, { meaning: e.target.value })} /></td>
              <td><button type="button" className="del" title="删除" onClick={() => { onChange(rows.filter((_, j) => j !== i)); setEditing(null); }}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing !== null && rows[editing] && (
        <div className="card" style={{ marginTop: 8 }}>
          <h3>编辑符号 · 第 {editing + 1} 行</h3>
          <MathEditor value={rows[editing].symbol} mode={rows[editing].mode === 'latex' ? 'latex' : 'typst'} display={false} onChange={(v) => set(editing, { symbol: v })} onMode={(m) => set(editing, { mode: m })} />
        </div>
      )}
      <button type="button" className="btn btn-xs" style={{ marginTop: 6 }} onClick={() => onChange([...rows, { symbol: '', mode: 'latex', meaning: '' }])}>＋ 添加一行</button>
    </>
  );
}
