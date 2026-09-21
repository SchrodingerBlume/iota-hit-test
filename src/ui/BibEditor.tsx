// 文献条目的可视化录入：左边条目列表（搜索、按类型筛），右边逐字段的表单。
// 参考文献页与成果页共用；成果页多两种自造类型和「附注」字段。
// 原始 BibTeX 照样进出：导入文件、导出文件、以及一个能直接改的源码抽屉。
import { useMemo, useRef, useState } from 'react';
import type { BibEntry } from '../bib/bibtex';
import { parseBibtex, generateBibtex, newEntryId, splitNames, joinNames, suggestKey } from '../bib/bibtex';
import { TYPES, ACHIEVEMENT_TYPES, ACHIEVEMENT_TYPE_KEYS, ANNOTE_FIELD, typeDef, type FieldDef, type TypeDef } from '../bib/schema';
import { Plus, Trash2, Copy, Search, Upload, Download, Code2, Wand2, Check, FolderPlus, Folder, CloudDownload } from 'lucide-react';
import { ZoteroDialog, entriesFromText } from './ZoteroDialog';
import { mergeEntries } from '../bib/csl';
import { FoldIcon } from './Fold';
import { t as tx } from '../i18n';

interface Props {
  entries: BibEntry[];
  onChange: (e: BibEntry[]) => void;
  /** 成果页：类型少一些、多附注 */
  mode: 'references' | 'achievements';
  /** 正文里被引用过的 key（列表上打个标） */
  citedKeys?: Set<string>;
  fileName: string;
}

const previewOf = (e: BibEntry) => {
  const a = splitNames(e.fields.author ?? e.fields.editor ?? '');
  const who = a.length ? (a.length > 3 ? tx("{{v0}}, 等", { v0: a.slice(0, 3).join(', ') }) : a.join(', ')) : '';
  const year = (e.fields.year ?? e.fields.date ?? '').slice(0, 4);
  return { who, year, title: e.fields.title ?? tx("（无题名）"), mark: typeDef(e.type, ACHIEVEMENT_TYPES).mark };
};

/** 列表按分组归堆：有名字的组按名排，没分组的垫底 */
function groupedList(items: BibEntry[]): [string, BibEntry[]][] {
  const m = new Map<string, BibEntry[]>();
  for (const e of items) { const g = e.group?.trim() ?? ''; if (!m.has(g)) m.set(g, []); m.get(g)!.push(e); }
  return [...m.entries()].sort((a, b) => (a[0] === '' ? 1 : b[0] === '' ? -1 : a[0].localeCompare(b[0], 'zh')));
}

function download(name: string, text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function BibEditor({ entries, onChange, mode, citedKeys, fileName }: Props) {
  const [selected, setSelected] = useState<string | null>(entries[0]?.id ?? null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('');
  const [raw, setRaw] = useState<string | null>(null);
  const [rawError, setRawError] = useState<string | null>(null);
  const [showExtra, setShowExtra] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  /** 分组：条目上的 group 字段；这里另记一份空组（刚建还没条目的） */
  const [emptyGroups, setEmptyGroups] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const groups = useMemo(() => {
    const set = new Set<string>(emptyGroups);
    for (const e of entries) if (e.group?.trim()) set.add(e.group.trim());
    return [...set].sort((a, b) => a.localeCompare(b, 'zh'));
  }, [entries, emptyGroups]);
  const [groupFilter, setGroupFilter] = useState<string | null>(null);
  const newGroup = () => {
    const name = prompt(tx("输入分组名称，例如“第 2 章”“综述”或“待读”："))?.trim();
    if (!name) return;
    setEmptyGroups((g) => (g.includes(name) ? g : [...g, name]));
    setGroupFilter(name);
  };
  const renameGroup = (g: string) => {
    const name = prompt(tx("重命名分组："), g)?.trim();
    if (!name || name === g) return;
    onChange(entries.map((e) => (e.group === g ? { ...e, group: name } : e)));
    setEmptyGroups((s) => s.map((x) => (x === g ? name : x)));
    if (groupFilter === g) setGroupFilter(name);
  };
  const deleteGroup = (g: string) => {
    if (!confirm(tx("要取消分组“{{g}}”吗？其中的条目将保留并移至“未分组”。", { g: g }))) return;
    onChange(entries.map((e) => (e.group === g ? { ...e, group: undefined } : e)));
    setEmptyGroups((s) => s.filter((x) => x !== g));
    if (groupFilter === g) setGroupFilter(null);
  };
  const toggleCollapse = (g: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(g)) n.delete(g); else n.add(g); return n; });

  const types: TypeDef[] = mode === 'achievements'
    ? [...ACHIEVEMENT_TYPE_KEYS.map((k) => typeDef(k, ACHIEVEMENT_TYPES))]
    : TYPES;

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return entries.filter((e) => (!filter || typeDef(e.type, ACHIEVEMENT_TYPES).type === filter)
      && (groupFilter === null || (groupFilter === '' ? !e.group?.trim() : e.group?.trim() === groupFilter))
      && (!needle || [e.key, e.type, ...Object.values(e.fields)].some((v) => String(v).toLowerCase().includes(needle))));
  }, [entries, q, filter, groupFilter]);

  const current = entries.find((e) => e.id === selected) ?? null;
  const taken = new Set(entries.map((e) => e.key));

  const patch = (id: string, fn: (e: BibEntry) => BibEntry) => onChange(entries.map((e) => (e.id === id ? fn(e) : e)));
  const setField = (k: string, v: string) => current && patch(current.id, (e) => ({ ...e, fields: { ...e.fields, [k]: v } }));

  const add = (type: string) => {
    const e: BibEntry = { id: newEntryId(), key: '', type, fields: {}, group: groupFilter || undefined };
    e.key = suggestKey(e, taken);
    onChange([e, ...entries]);
    setSelected(e.id);
  };
  const remove = (id: string) => {
    const next = entries.filter((e) => e.id !== id);
    onChange(next);
    if (selected === id) setSelected(next[0]?.id ?? null);
  };
  const duplicate = (e: BibEntry) => {
    const copy = { ...e, id: newEntryId(), fields: { ...e.fields } };
    copy.key = suggestKey(copy, taken);
    onChange([copy, ...entries]);
    setSelected(copy.id);
  };
  const [zotero, setZotero] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  // .bib 与 Zotero 导出的 CSL JSON 都收；同 key（或同 Zotero 来源）的当作更新，其余追加
  const importFiles = async (files: File[]) => {
    const taken = new Set(entries.map((e) => e.key));
    const parsed: BibEntry[] = [];
    for (const f of files) { try { const got = entriesFromText(await f.text(), taken); for (const e of got) taken.add(e.key); parsed.push(...got); } catch { /* 不是文献文件 */ } }
    if (!parsed.length) { alert(tx("未从此文件中解析出任何条目")); return; }
    const r = mergeEntries(entries, parsed, groupFilter || undefined);
    onChange(r.entries);
    setSelected(r.entries.find((e) => e.key === parsed[0].key)?.id ?? parsed[0].id);
  };
  const applyRaw = () => {
    if (raw === null) return;
    try {
      const parsed = parseBibtex(raw);
      // 尽量保留原 id，好让选中项不跳
      const byKey = new Map(entries.map((e) => [e.key, e.id]));
      const groupOf = new Map(entries.map((e) => [e.key, e.group]));
      onChange(parsed.map((p) => ({ ...p, id: byKey.get(p.key) ?? p.id, group: p.group ?? groupOf.get(p.key) })));
      setRaw(null); setRawError(null);
    } catch (e) { setRawError(String((e as Error).message ?? e)); }
  };

  const def = current ? typeDef(current.type, ACHIEVEMENT_TYPES) : null;
  const known = new Set(def?.fields.map((f) => f.key) ?? []);
  if (mode === 'achievements') known.add('annote');
  const extraFields = current ? Object.keys(current.fields).filter((k) => !known.has(k)) : [];

  return (
    <div className={`bib ${dragOver ? 'is-drop' : ''}`} onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragOver(true); } }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false); }} onDrop={(e) => { if (!e.dataTransfer.files.length) return; e.preventDefault(); setDragOver(false); void importFiles(Array.from(e.dataTransfer.files)); }}>
      <ZoteroDialog open={zotero} onClose={() => setZotero(false)} entries={entries} onChange={onChange} />
      <aside className="bib-list">
        <div className="bib-tools">
          <span className="bib-search"><Search /><input value={q} placeholder={tx("搜索引用键、题名或作者…")} onChange={(e) => setQ(e.target.value)} /></span>
          <select className="bib-filter" value={filter} onChange={(e) => setFilter(e.target.value)} title={tx("按类型筛选")}>
            <option value="">{tx("全部类型")}</option>
            {types.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
          </select>
        </div>
        <div className="bib-add">
          <AddMenu types={types} onAdd={add} />
          <span className="join">
            <button type="button" className="btn btn-xs btn-icon" title={tx("导入 .bib 或 CSL JSON 文件")} onClick={() => fileInput.current?.click()}><Upload /></button>
            <button type="button" className="btn btn-xs btn-icon" title={tx("从 Zotero 导入（云端或导出的文件）")} onClick={() => setZotero(true)}><CloudDownload /></button>
            <button type="button" className="btn btn-xs btn-icon" title={groupFilter ? tx("导出分组“{{groupFilter}}”", { groupFilter: groupFilter }) : tx("导出 .bib 文件")} onClick={() => { const set = groupFilter === null ? entries : entries.filter((e) => (groupFilter === '' ? !e.group?.trim() : e.group?.trim() === groupFilter)); download(groupFilter ? fileName.replace(/\.bib$/, `-${groupFilter}.bib`) : fileName, generateBibtex(set, { withGroups: true })); }} disabled={!entries.length}><Download /></button>
            <button type="button" className={`btn btn-xs btn-icon ${raw !== null ? 'on' : ''}`} title={tx("编辑 BibTeX 源代码")} onClick={() => { setRaw(raw === null ? generateBibtex(entries, { withGroups: true }) : null); setRawError(null); }}><Code2 /></button>
          </span>
          <input ref={fileInput} type="file" accept=".bib,.json,text/plain,application/json" multiple hidden onChange={(e) => { if (e.target.files?.length) void importFiles(Array.from(e.target.files)); e.target.value = ''; }} />
        </div>
        <div className="bib-groups">
          <button type="button" className={`bib-group-chip ${groupFilter === null ? 'on' : ''}`} onClick={() => setGroupFilter(null)}>{tx("全部")}{' '}<span className="muted">{entries.length}</span></button>
          {groups.map((g) => (
            <button key={g} type="button" className={`bib-group-chip ${groupFilter === g ? 'on' : ''}`} onClick={() => setGroupFilter(g)} onDoubleClick={() => renameGroup(g)} title={tx("双击可重命名")}><Folder />{g} <span className="muted">{entries.filter((e) => e.group?.trim() === g).length}</span></button>
          ))}
          {entries.some((e) => !e.group?.trim()) && groups.length > 0 && <button type="button" className={`bib-group-chip ${groupFilter === '' ? 'on' : ''}`} onClick={() => setGroupFilter('')}>{tx("未分组")}{' '}<span className="muted">{entries.filter((e) => !e.group?.trim()).length}</span></button>}
          <button type="button" className="bib-group-chip is-add" title={tx("新建分组")} onClick={newGroup}><FolderPlus /></button>
          {groupFilter && <button type="button" className="bib-group-chip is-del" title={tx("取消分组")} onClick={() => deleteGroup(groupFilter)}><Trash2 /></button>}
        </div>
        <ul className="bib-items">
          {(groupFilter === null && groups.length ? groupedList(list) : [['', list] as [string, BibEntry[]]]).map(([g, items]) => (
            <li key={g || '__none'} className="bib-group-block">
              {groupFilter === null && groups.length > 0 && (
                <button type="button" className="bib-group-head" onClick={() => toggleCollapse(g)}>
                  <FoldIcon open={!collapsed.has(g)} />{g || tx("未分组")} <span className="muted">{items.length}</span>
                </button>
              )}
              {!collapsed.has(g) && (
                <ul>
                  {items.map((e) => {
                    const p = previewOf(e);
                    const cited = citedKeys?.has(e.key);
                    return (
                      <li key={e.id} className={`bib-item ${e.id === selected ? 'on' : ''}`} onClick={() => setSelected(e.id)}>
                        <span className="bib-mark">[{p.mark}]</span>
                        <span className="bib-item-body">
                          <span className="bib-title">{p.title}</span>
                          <span className="bib-sub muted">{[p.who, p.year].filter(Boolean).join(' · ')}<code>{e.key}</code>{cited && <span className="bib-cited" title={tx("已在正文中引用")}><Check /></span>}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          ))}
          {!list.length && <li className="muted bib-empty">{entries.length ? tx("未找到匹配的条目") : tx("尚无条目。请选择“添加”或导入 .bib 文件。")}</li>}
        </ul>
        <div className="muted bib-count">{entries.length} {' '}{tx("条")}{citedKeys ? tx(" · 已引用 {{length}}", { length: entries.filter((e) => citedKeys.has(e.key)).length }) : ''}</div>
      </aside>

      <section className="bib-form">
        {raw !== null ? (
          <div className="bib-raw">
            <div className="row" style={{ marginBottom: 8 }}>
              <b>{tx("BibTeX 源代码")}</b><span className="muted" style={{ fontSize: 12 }}>{tx("应用更改")}</span>
              <span className="spacer" style={{ flex: 1 }} />
              <button type="button" className="btn btn-xs" onClick={() => { setRaw(null); setRawError(null); }}>{tx("取消")}</button>
              <button type="button" className="btn btn-xs btn-primary" onClick={applyRaw}><Check />{tx("应用")}</button>
            </div>
            {rawError && <div className="diag err" style={{ padding: '6px 10px', marginBottom: 8 }}>{rawError}</div>}
            <textarea className="mono input bib-raw-text" value={raw} spellCheck={false} onChange={(e) => setRaw(e.target.value)} />
          </div>
        ) : !current || !def ? (
          <div className="bib-blank muted">{entries.length ? tx("请在左侧选择一个条目") : tx("请在左侧选择“添加”，或导入 .bib 文件")}</div>
        ) : (
          <div key={current.id} className="bib-fields work-inner">
            <div className="bib-head">
              <label className="field" style={{ flex: 1 }}>
                <span className="field-label">{tx("类型")}</span>
                <select value={def.type} onChange={(e) => patch(current.id, (x) => ({ ...x, type: e.target.value }))}>
                  {types.map((t) => <option key={t.type} value={t.type}>{t.label} [{t.mark}]</option>)}
                  {!types.some((t) => t.type === def.type) && <option value={def.type}>{def.type}</option>}
                </select>
              </label>
              <label className="field" style={{ flex: 1 }}>
                <span className="field-label">{tx("引用键")}</span>
                <span className="row" style={{ flexWrap: 'nowrap' }}>
                  <input className="mono-input" value={current.key} onChange={(e) => patch(current.id, (x) => ({ ...x, key: e.target.value.replace(/[^\w:.\-+/]/g, '') }))} />
                  <button type="button" className="btn btn-xs btn-icon" title={tx("按作者和年份重新生成引用键")} onClick={() => patch(current.id, (x) => ({ ...x, key: suggestKey(x, new Set(entries.filter((o) => o.id !== x.id).map((o) => o.key))) }))}><Wand2 /></button>
                </span>
                {entries.some((o) => o.id !== current.id && o.key === current.key) && <span className="field-hint" style={{ color: 'var(--danger)' }}>{tx("引用键与其他条目重复")}</span>}
              </label>
              <label className="field" style={{ flex: '0 0 150px' }}>
                <span className="field-label">{tx("分组")}</span>
                <select value={current.group ?? ''} onChange={(e) => patch(current.id, (x) => ({ ...x, group: e.target.value || undefined }))}>
                  <option value="">{tx("（不分组）")}</option>
                  {groups.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </label>
              <span className="join bib-actions" style={{ flex: 'none' }}>
                <button type="button" className="btn btn-xs btn-icon" title={tx("复制条目")} onClick={() => duplicate(current)}><Copy /></button>
                <button type="button" className="btn btn-xs btn-icon btn-danger" title={tx("删除")} onClick={() => remove(current.id)}><Trash2 /></button>
              </span>
            </div>
            <div className="bib-grid">
              {def.fields.map((f) => <FieldInput key={f.key} f={f} value={current.fields[f.key] ?? ''} onChange={(v) => setField(f.key, v)} />)}
              {mode === 'achievements' && <FieldInput f={ANNOTE_FIELD} value={current.fields.annote ?? ''} onChange={(v) => setField('annote', v)} />}
            </div>
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => setShowExtra((s) => !s)}><FoldIcon open={showExtra} />{tx("其他字段")}{extraFields.length ? `（${extraFields.length}）` : ''}</button>
            {showExtra && (
              <div className="bib-extra">
                {extraFields.map((k) => (
                  <label className="field" key={k}>
                    <span className="field-label"><code>{k}</code></span>
                    <span className="row" style={{ flexWrap: 'nowrap' }}>
                      <input value={current.fields[k]} onChange={(e) => setField(k, e.target.value)} />
                      <button type="button" className="btn btn-xs btn-icon" title={tx("删除此字段")} onClick={() => patch(current.id, (x) => { const fields = { ...x.fields }; delete fields[k]; return { ...x, fields }; })}><Trash2 /></button>
                    </span>
                  </label>
                ))}
                <ExtraAdder onAdd={(k) => setField(k, '')} />
                <p className="muted" style={{ fontSize: 12 }}>{tx("BibLaTeX 字段")}</p>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function FieldInput({ f, value, onChange }: { f: FieldDef; value: string; onChange: (v: string) => void }) {
  const wide = f.kind === 'names' || f.kind === 'long' || f.key === 'title' || f.key === 'booktitle' || f.key === 'url';
  return (
    <label className={`field ${wide ? 'wide' : ''}`}>
      <span className="field-label">{f.label}{f.required && <span className="req">*</span>}{f.kind === 'names' && <span className="muted"> {' '}{tx("· 每行一人")}</span>}</span>
      {f.kind === 'names'
        ? <textarea rows={Math.max(1, Math.min(6, splitNames(value).length || 1))} value={splitNames(value).join('\n')} placeholder={tx("张三\n李四\nSmith, John")} onChange={(e) => onChange(joinNames(e.target.value))} />
        : f.kind === 'long'
          ? <textarea rows={2} value={value} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />
          : <input value={value} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />}
      {f.hint && <span className="field-hint">{f.hint}</span>}
    </label>
  );
}

function AddMenu({ types, onAdd }: { types: TypeDef[]; onAdd: (t: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="menu">
      <button type="button" className="btn btn-xs btn-primary" onClick={() => setOpen((o) => !o)}><Plus />{tx("添加")}</button>
      {open && (
        <span className="menu-pop bib-add-menu" onMouseLeave={() => setOpen(false)}>
          {types.map((t) => <button key={t.type} type="button" onClick={() => { onAdd(t.type); setOpen(false); }}><span className="bib-mark">[{t.mark}]</span>{t.label}</button>)}
        </span>
      )}
    </span>
  );
}

function ExtraAdder({ onAdd }: { onAdd: (k: string) => void }) {
  const [k, setK] = useState('');
  return (
    <span className="row">
      <input className="input" style={{ width: 160 }} value={k} placeholder={tx("字段名，如 series")} onChange={(e) => setK(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))} onKeyDown={(e) => { if (e.nativeEvent.isComposing || e.keyCode === 229) return; if (e.key === 'Enter' && k) { onAdd(k); setK(''); } }} />
      <button type="button" className="btn btn-xs" disabled={!k} onClick={() => { onAdd(k); setK(''); }}><Plus />{tx("添加字段")}</button>
    </span>
  );
}
