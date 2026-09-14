// 其余的节：摘要、符号与缩略语、正文类富文本、参考文献、成果、答辩、页面开关。
import { useMemo } from 'react';
import { useStore, type RichKey } from '../model/store';
import type { Abbreviation, SymbolEntry, DefensePerson, Pages } from '../model/types';
import { RichEditor } from '../editor/RichEditor';
import { parseBibKeys } from '../editor/env';

export function RichSection({ title, lead, richKey, headings, blocks, placeholder }: { title: string; lead?: string; richKey: RichKey; headings: boolean; blocks?: boolean; placeholder?: string }) {
  const value = useStore((s) => s.doc[richKey]);
  const setRich = useStore((s) => s.setRich);
  return (
    <>
      <h2>{title}</h2>
      {lead && <p className="lead">{lead}</p>}
      <RichEditor instanceKey={richKey} value={value} onChange={(v) => setRich(richKey, v)} headings={headings} blocks={blocks ?? true} placeholder={placeholder} />
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
      </div>
      <div className="card">
        <h3>缩略语</h3>
        <ListTable<Abbreviation> rows={abbreviations} onChange={setAbbreviations} blank={() => ({ key: '', long: '', longEn: '' })}
          cols={[{ key: 'key', label: '缩写', placeholder: 'FEM', mono: true }, { key: 'long', label: '中文全称', placeholder: '有限元方法' }, { key: 'longEn', label: '英文全称', placeholder: 'Finite Element Method' }]} />
      </div>
      <div className="card">
        <h3>物理量符号</h3>
        <ListTable<SymbolEntry> rows={symbols} onChange={setSymbols} blank={() => ({ symbol: '', meaning: '' })}
          cols={[{ key: 'symbol', label: '符号（Typst 数学写法）', placeholder: 'eta', mono: true }, { key: 'meaning', label: '含义与单位', placeholder: '气体动力黏度，Pa·s' }]} />
      </div>
    </>
  );
}

export function BibPanel({ which }: { which: 'bibliography' | 'achievements' }) {
  const text = useStore((s) => s.doc[which]);
  const pages = useStore((s) => s.doc.pages);
  const { setBibliography, setAchievements, setPages } = useStore();
  const keys = useMemo(() => parseBibKeys(text), [text]);
  const isBib = which === 'bibliography';
  return (
    <>
      <h2>{isBib ? '参考文献' : '攻读学位期间取得的成果'}</h2>
      <p className="lead">
        {isBib
          ? '粘贴 BibTeX。条目由 omni-gb7714 按 GB/T 7714 排，只被引用过的才列出（full: true 时全列）。正文里用工具栏「[1]」引用。'
          : '一份专用的 BibTeX：本人的论文（@article）、专利（@patent）、项目与获奖（@project / @award），按类型分三组；页码后的章节序号、收录情况写在 annote 字段。'}
      </p>
      {!isBib && (
        <div className="card">
          <label className="toggle"><button type="button" className={`sw ${pages.achievements ? 'on' : ''}`} onClick={() => setPages({ achievements: !pages.achievements })} /> <span className="t-lab">排这一页</span><span className="t-hint">研究生终稿才有；本科没有这一项</span></label>
        </div>
      )}
      <div className="card">
        <textarea className="mono input" value={text} spellCheck={false} placeholder={isBib ? '@article{key,\n  author = {…},\n  title = {…},\n  …\n}' : '@article{mypaper1,\n  author = {…},\n  annote = {对应第 3 章；SCI 收录},\n}'} onChange={(e) => (isBib ? setBibliography : setAchievements)(e.target.value)} />
        <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
          {keys.length ? <>识别到 {keys.length} 条：{keys.map((k) => <code key={k.key} style={{ marginRight: 8 }}>{k.key}</code>)}</> : '还没有条目'}
        </div>
      </div>
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
