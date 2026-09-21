// 我的文档：照 Word 的「开始」页排——上面一排模板卡（点了弹出新建对话框起名、选档），下面「最近使用」
// 一张可搜索、可排序的列表，每行悬停出操作；删除走对话框确认，重命名就地改
import { useMemo, useRef, useState } from 'react';
import { Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions, Button, Input, Menu, MenuTrigger, MenuPopover, MenuList, MenuItem, MenuItemRadio, MenuDivider, Tooltip } from '@fluentui/react-components';
import { Document20Regular, DocumentSparkle20Regular, FolderOpen20Regular, ArrowLeft20Regular, Search20Regular, MoreHorizontal20Regular, Rename20Regular, Copy20Regular, Delete20Regular, ArrowDownload20Regular, Open20Regular, ArrowSort20Regular, Pin20Regular, PinOff20Regular } from '@fluentui/react-icons';
import { useStore, type ProjectMeta } from '../model/store';
import { AXES, defaultSettings } from '../model/options';
import type { Settings } from '../model/types';
import { t as tx } from '../i18n';

const label = (s: Settings, key: keyof Settings) => AXES.find((a) => a.key === key)?.choices.find((c) => c.value === s[key])?.label ?? String(s[key]);

function fmtTime(iso: string) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return tx("刚刚");
  if (diff < 3_600_000) return tx("{{v0}} 分钟前", { v0: Math.round(diff / 60_000) });
  if (diff < 86_400_000) return tx("{{v0}} 小时前", { v0: Math.round(diff / 3_600_000) });
  if (diff < 7 * 86_400_000) return tx("{{v0}} 天前", { v0: Math.round(diff / 86_400_000) });
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' });
}

const tagsOf = (s: Settings) => [
  label(s, 'degreeLevel'), label(s, 'stage'), s.campus === 'shenzhen' ? tx("深圳") : tx("本部"),
  s.form === 'practice' ? (s.degreeLevel === 'bachelor' ? tx("毕业设计") : tx("实践成果")) : null, s.lang === 'en' ? 'EN' : null,
].filter(Boolean) as string[];

function download(name: string, data: BlobPart, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function ProjectRow({ p, active, pinned, onDelete }: { p: ProjectMeta; active: boolean; pinned: boolean; onDelete: (p: ProjectMeta) => void }) {
  const { openProject, renameProject, duplicateProject, exportProject, togglePin } = useStore();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(p.name);
  const commit = () => { const n = name.trim(); setEditing(false); if (n && n !== p.name) void renameProject(p.id, n); else setName(p.name); };
  const save = async () => { const r = await exportProject(p.id); if (r) download(`${r.name}.iota.json`, r.json, 'application/json'); };
  return (
    <div className={`proj-row ${active ? 'is-active' : ''}`} onDoubleClick={() => { if (!editing) void openProject(p.id); }}>
      <span className="proj-ico"><Document20Regular /></span>
      <div className="proj-main">
        {editing
          ? <input className="input proj-rename" autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.nativeEvent.isComposing || e.keyCode === 229) return; if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setName(p.name); setEditing(false); } }} />
          : <button type="button" className="proj-name" onClick={() => void openProject(p.id)}>{p.name}{active && <span className="proj-badge">{tx("当前")}</span>}</button>}
        <div className="proj-tags">{tagsOf(p.settings).map((t) => <span key={t} className="tag">{t}</span>)}{p.blocks > 0 && <span className="muted proj-size">{tx("正文 {{n}} 段", { n: p.blocks })}</span>}</div>
      </div>
      <span className="proj-time muted" title={new Date(p.updatedAt).toLocaleString('zh-CN')}>{fmtTime(p.updatedAt)}</span>
      <div className={`proj-actions ${pinned ? 'is-pinned' : ''}`}>
        <Tooltip content={pinned ? tx("取消固定") : tx("固定到列表顶上")} relationship="label" positioning="below">
          <Button size="small" appearance="subtle" className={`proj-pin ${pinned ? 'on' : ''}`} icon={pinned ? <PinOff20Regular /> : <Pin20Regular />} onClick={() => void togglePin(p.id)} />
        </Tooltip>
        <Button size="small" appearance="primary" className="proj-open" icon={<Open20Regular />} onClick={() => void openProject(p.id)}>{tx("打开")}</Button>
        <Menu positioning="below-end">
          <MenuTrigger disableButtonEnhancement>
            <Tooltip content={tx("更多操作")} relationship="label" positioning="below"><Button size="small" appearance="subtle" icon={<MoreHorizontal20Regular />} /></Tooltip>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem icon={<Open20Regular />} className="proj-open-item" onClick={() => void openProject(p.id)}>{tx("打开")}</MenuItem>
              <MenuItem icon={<Rename20Regular />} onClick={() => { setName(p.name); setEditing(true); }}>{tx("重命名")}</MenuItem>
              <MenuItem icon={<Copy20Regular />} onClick={() => void duplicateProject(p.id)}>{tx("创建副本")}</MenuItem>
              <MenuItem icon={<ArrowDownload20Regular />} onClick={() => void save()}>{tx("下载副本（.iota.json）")}</MenuItem>
              <MenuItem icon={pinned ? <PinOff20Regular /> : <Pin20Regular />} onClick={() => void togglePin(p.id)}>{pinned ? tx("取消固定") : tx("固定")}</MenuItem>
              <MenuDivider />
              <MenuItem icon={<Delete20Regular />} onClick={() => onDelete(p)}>{tx("删除")}</MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
      </div>
    </div>
  );
}

export function ProjectsView() {
  const { projects, pinned, doc, createProject, importProject, deleteProject, setView, loaded } = useStore();
  const canBack = loaded && projects.some((p) => p.id === doc.id);
  // 新建对话框
  const [tpl, setTpl] = useState<'blank' | 'sample' | null>(null);
  const [name, setName] = useState('');
  const [settings, setSettings] = useState<Settings>(() => defaultSettings());
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'time' | 'name'>('time');
  const [pendingDelete, setPendingDelete] = useState<ProjectMeta | null>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? projects.filter((p) => p.name.toLowerCase().includes(q)) : [...projects];
    return list.sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name, 'zh-CN') : b.updatedAt.localeCompare(a.updatedAt)));
  }, [projects, query, sort]);
  // 固定的照 Word 单独一组放在顶上，按固定的先后
  const pinnedRows = pinned.map((id) => shown.find((p) => p.id === id)).filter(Boolean) as ProjectMeta[];
  const recentRows = shown.filter((p) => !pinned.includes(p.id));

  const onOpenProject = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const raw = JSON.parse(await f.text());
        if (!raw || typeof raw !== 'object' || !raw.info || !raw.settings || raw.body?.type !== 'doc') {
          throw new Error(tx("请选择有效的 .iota.json 文档。"));
        }
        const imageData: Record<string, string> = raw.imageData ?? {};
        const images: { name: string; blob: Blob }[] = [];
        for (const [name, b64] of Object.entries(imageData)) {
          if (typeof b64 !== 'string') throw new Error(tx("文档中的图片数据无效。"));
          const bin = atob(b64);
          images.push({ name, blob: new Blob([Uint8Array.from(bin, (c) => c.charCodeAt(0))]) });
        }
        delete raw.imageData;
        await importProject(raw, images);
      } catch (error) {
        alert(tx("无法打开文档：{{v0}}", { v0: error instanceof Error ? error.message : tx("无法读取文件。") }));
      }
    };
    input.click();
  };
  const onCreate = async () => {
    if (!loaded || creatingRef.current || !tpl) return;
    creatingRef.current = true;
    setCreating(true);
    try { await createProject({ name, settings, template: tpl }); setTpl(null); setName(''); } finally { creatingRef.current = false; setCreating(false); }
  };

  return (
    <div className="projects work-inner">
      <div className="projects-inner">
        <div className="projects-head">
          <div>
            <h2>{tx("我的文档")}</h2>
            <p className="lead">{tx("文档保存在当前浏览器中。跨设备使用或长期保存时，请下载副本。")}</p>
          </div>
          <div className="projects-actions">
            <Button icon={<FolderOpen20Regular />} disabled={!loaded} onClick={onOpenProject}>{tx("打开文档…")}</Button>
            {canBack && <Button appearance="primary" icon={<ArrowLeft20Regular />} onClick={() => setView('editor')}>{tx("回到「{{name}}」", { name: doc.name })}</Button>}
          </div>
        </div>

        <section className="proj-section">
          <h3 className="proj-list-title">{tx("新建")}</h3>
          <div className="tpl-cards">
            <button type="button" className="tpl-card" disabled={!loaded} onClick={() => setTpl('blank')}>
              <span className="tpl-thumb"><Document20Regular /></span>
              <b>{tx("空白文档")}</b><small>{tx("从零开始写")}</small>
            </button>
            <button type="button" className="tpl-card" disabled={!loaded} onClick={() => setTpl('sample')}>
              <span className="tpl-thumb is-sample"><DocumentSparkle20Regular /></span>
              <b>{tx("示例论文")}</b><small>{tx("含正文、图表和公式示例")}</small>
            </button>
          </div>
        </section>

        <section className="proj-section">
          <div className="proj-list-head">
            <h3 className="proj-list-title">{tx("最近使用")} <span className="muted">{projects.length}</span></h3>
            <span className="spacer" />
            <Input size="small" className="proj-search" contentBefore={<Search20Regular />} placeholder={tx("搜索文档")} value={query} onChange={(_, d) => setQuery(d.value)} />
            <Menu checkedValues={{ sort: [sort] }} onCheckedValueChange={(_, d) => setSort(d.checkedItems[0] as 'time' | 'name')} positioning="below-end">
              <MenuTrigger disableButtonEnhancement>
                <Button size="small" appearance="subtle" icon={<ArrowSort20Regular />}>{sort === 'time' ? tx("按修改时间") : tx("按名称")}</Button>
              </MenuTrigger>
              <MenuPopover><MenuList>
                <MenuItemRadio name="sort" value="time">{tx("按修改时间")}</MenuItemRadio>
                <MenuItemRadio name="sort" value="name">{tx("按名称")}</MenuItemRadio>
              </MenuList></MenuPopover>
            </Menu>
          </div>
          <div className="proj-table">
            {pinnedRows.length > 0 && <div className="proj-group">{tx("已固定")}</div>}
            {pinnedRows.map((p) => <ProjectRow key={p.id} p={p} active={p.id === doc.id && loaded} pinned onDelete={setPendingDelete} />)}
            {pinnedRows.length > 0 && recentRows.length > 0 && <div className="proj-group">{tx("最近")}</div>}
            {recentRows.map((p) => <ProjectRow key={p.id} p={p} active={p.id === doc.id && loaded} pinned={false} onDelete={setPendingDelete} />)}
            {!projects.length && <div className="proj-empty muted">{tx("暂无文档。从上面的模板新建一个，或打开下载过的副本。")}</div>}
            {projects.length > 0 && !shown.length && <div className="proj-empty muted">{tx("没有匹配「{{q}}」的文档。", { q: query.trim() })}</div>}
          </div>
        </section>

        <footer className="projects-foot muted">
          {tx("排版引擎是基于 Typst 修改的非官方版本。")}<a href={`${import.meta.env.BASE_URL}licenses.txt`} target="_blank" rel="noopener">{tx("开源许可与声明")}</a>
        </footer>
      </div>

      <Dialog open={tpl !== null} onOpenChange={(_, d) => { if (!d.open) setTpl(null); }}>
        <DialogSurface className="new-proj-dialog">
          <DialogBody>
            <DialogTitle>{tpl === 'sample' ? tx("新建示例论文") : tx("新建空白文档")}</DialogTitle>
            <DialogContent>
              <label className="field">
                <span className="field-label">{tx("文档名称")}</span>
                <input autoFocus value={name} placeholder={tx("例如：张三的硕士学位论文")} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.nativeEvent.isComposing || e.keyCode === 229) return; if (e.key === 'Enter') void onCreate(); }} />
              </label>
              <div className="new-axes">
                {AXES.filter((a) => !a.applies || a.applies(settings)).map((a) => (
                  <label className="field" key={a.key}>
                    <span className="field-label">{a.label}</span>
                    <select value={settings[a.key] as string} onChange={(e) => setSettings({ ...settings, [a.key]: e.target.value })}>
                      {a.choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              <p className="field-hint muted">{tx("这些都能在「论文设置」里再改。")}</p>
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setTpl(null)}>{tx("取消")}</Button>
              <Button appearance="primary" disabled={creating || !loaded} onClick={() => void onCreate()}>{creating ? tx("正在创建…") : tx("创建")}</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <Dialog open={!!pendingDelete} onOpenChange={(_, d) => { if (!d.open) setPendingDelete(null); }}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{tx("删除文档")}</DialogTitle>
            <DialogContent>{tx("删除「{{name}}」？文档及其图片将被永久删除，且无法撤消。", { name: pendingDelete?.name ?? '' })}</DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setPendingDelete(null)}>{tx("取消")}</Button>
              <Button appearance="primary" className="btn-danger-fill" onClick={() => { const p = pendingDelete; setPendingDelete(null); if (p) void deleteProject(p.id); }}>{tx("删除")}</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
