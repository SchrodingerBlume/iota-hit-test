// 其余的节：摘要、符号与缩略语、正文类富文本、参考文献、成果、答辩、页面开关。
import { useMemo } from 'react';
import { useStore, type RichKey } from '../model/store';
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
      <RichEditor instanceKey={richKey} value={value} onChange={(v) => setRich(richKey, v)} headings={headings} blocks={blocks ?? true} placeholder={placeholder} part={part} />
    </>
  );
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
      <RichEditor instanceKey="abstractZh" value={zh} onChange={(v) => setRich('abstractZh', v)} headings={false} blocks={false} placeholder="中文摘要……" />
      <h3 style={{ marginTop: 20 }}>Abstract</h3>
      <RichEditor instanceKey="abstractEn" value={en} onChange={(v) => setRich('abstractEn', v)} headings={false} blocks={false} placeholder="English abstract…" />
    </>
  );
}

function ListTable<T extends object>({ rows, cols, blank, onChange }: { rows: T[]; cols: { key: keyof T & string; label: string; placeholder?: string; mono?: boolean }[]; blank: () => T; onChange: (rows: T[]) => void }) {
  const set = (i: number, k: keyof T, v: string) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <>
      <table className="tbl">
        <thead><tr>{cols.map((c) => <th key={String(c.key)}>{c.label}</th>)}<th /></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {cols.map((c) => <td key={String(c.key)}><input style={c.mono ? { fontFamily: 'var(--mono)' } : undefined} value={String(r[c.key] ?? '')} placeholder={c.placeholder} onChange={(e) => set(i, c.key, e.target.value)} /></td>)}
              <td><button type="button" className="del" title="删除" onClick={() => onChange(rows.filter((_, j) => j !== i))}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="btn btn-xs" style={{ marginTop: 6 }} onClick={() => onChange([...rows, blank()])}>＋ 添加一行</button>
    </>
  );
}

export function NomenclaturePanel() {
  const abbreviations = useStore((s) => s.doc.abbreviations);
  const symbols = useStore((s) => s.doc.symbols);
  const pages = useStore((s) => s.doc.pages);
  const setAbbreviations = useStore((s) => s.setAbbreviations);
  const setSymbols = useStore((s) => s.setSymbols);
  const setPages = useStore((s) => s.setPages);
  return (
    <>
      <h2>符号与缩略语</h2>
      <p className="lead">物理量名称及符号表（规范 2.4 点名的前置表）与缩略语表。正文里用工具栏的「Ab」插入缩写，首次出现自动展开成「有限元方法（Finite Element Method，FEM）」。</p>
      <div className="card">
        <label className="toggle"><button type="button" className={`sw ${pages.nomenclature ? 'on' : ''}`} onClick={() => setPages({ nomenclature: !pages.nomenclature })} /> <span className="t-lab">排这一页</span><span className="t-hint">关掉则缩写照常展开，只是不印表</span></label>
        <label className="toggle"><button type="button" className={`sw ${pages.nomenclatureMerged !== false ? 'on' : ''}`} onClick={() => setPages({ nomenclatureMerged: !(pages.nomenclatureMerged !== false) })} /> <span className="t-lab">符号与缩略语合成一页</span><span className="t-hint">开：一页「符号及缩略语」两段；关：「物理量名称及符号表」「缩略语表」各一页</span></label>
      </div>
      <div className="card">
        <h3>缩略语</h3>
        <ListTable<Abbreviation> rows={abbreviations} onChange={setAbbreviations} blank={() => ({ key: '', long: '', longEn: '' })}
          cols={[{ key: 'key', label: '缩写', placeholder: 'FEM', mono: true }, { key: 'long', label: '中文全称', placeholder: '有限元方法' }, { key: 'longEn', label: '英文全称', placeholder: 'Finite Element Method' }]} />
      </div>
      <div className="card">
        <h3>物理量符号</h3>
        <SymbolTable rows={symbols} onChange={setSymbols} />
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
  const pages = useStore((s) => s.doc.pages);
  const setReferences = useStore((s) => s.setReferences);
  const setAchievementEntries = useStore((s) => s.setAchievementEntries);
  const setPages = useStore((s) => s.setPages);
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
      {!isBib && (
        <div className="card">
          <label className="toggle"><button type="button" className={`sw ${pages.achievements ? 'on' : ''}`} onClick={() => setPages({ achievements: !pages.achievements })} /> <span className="t-lab">排这一页</span><span className="t-hint">研究生终稿才有；本科没有这一项</span></label>
        </div>
      )}
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
  const pages = useStore((s) => s.doc.pages);
  const { setDefense, setPages } = useStore();
  const setList = (k: 'reviewers' | 'members', i: number, p: DefensePerson) => setDefense({ ...defense, [k]: defense[k].map((x, j) => (j === i ? p : x)) });
  const blank = { name: '', title: '', affiliation: '', discipline: '' };
  return (
    <>
      <h2>评阅人、答辩委员会与决议</h2>
      <p className="lead">新版研究生范例加的一页，博士有；一人一条记录，留空的行不排。</p>
      <div className="card">
        <label className="toggle"><button type="button" className={`sw ${pages.defense ? 'on' : ''}`} onClick={() => setPages({ defense: !pages.defense })} /> <span className="t-lab">排这一页</span></label>
      </div>
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

const PAGE_DEFS: { key: keyof Pages; label: string; hint: string }[] = [
  { key: 'declarations', label: '原创性声明与使用权限', hint: '终稿必有；报告档自动跳过' },
  { key: 'listOfFigures', label: '插图索引', hint: '规范里没有这一项，博士范例中英两份' },
  { key: 'listOfTables', label: '表格索引', hint: '' },
  { key: 'listOfEquations', label: '公式索引', hint: '' },
  { key: 'appendix', label: '附录', hint: '「附录」一节里写了内容才排' },
  { key: 'achievements', label: '攻读学位期间取得的成果', hint: '' },
  { key: 'defense', label: '评阅人、答辩委员会与决议', hint: '' },
  { key: 'index', label: '索引', hint: '规范 2.18 说可选；用工具栏「索」把词登记进去，一个都没标会是空页' },
  { key: 'resume', label: '个人简历', hint: '除全日制硕士生外均增列，排最末' },
];

export function PagesPanel() {
  const pages = useStore((s) => s.doc.pages);
  const setPages = useStore((s) => s.setPages);
  return (
    <>
      <h2>页面开关</h2>
      <p className="lead">封面、内封、摘要、目录、正文、结论、参考文献、致谢总是有；这里是可选的那几页。终稿专有的页在开题、中期档里由模板静默跳过。</p>
      <div className="card">
        {PAGE_DEFS.map((d) => (
          <label className="toggle" key={d.key}>
            <button type="button" className={`sw ${pages[d.key] ? 'on' : ''}`} onClick={() => setPages({ [d.key]: !pages[d.key] })} />
            <span className="t-lab">{d.label}</span>
            <span className="t-hint">{d.hint}</span>
          </label>
        ))}
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
                  <span className="seg" title="写法">
                    <button type="button" className={r.mode !== 'latex' ? 'on' : ''} onClick={() => set(i, { mode: 'typst' })}>T</button>
                    <button type="button" className={r.mode === 'latex' ? 'on' : ''} onClick={() => set(i, { mode: 'latex' })}>L</button>
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
      <button type="button" className="btn btn-xs" style={{ marginTop: 6 }} onClick={() => onChange([...rows, { symbol: '', mode: 'typst', meaning: '' }])}>＋ 添加一行</button>
    </>
  );
}
