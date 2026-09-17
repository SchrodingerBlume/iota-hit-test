// 我的文档界面：左边新建（起名、选类型、空白或样例），右边最近使用的卡片。
import { useRef, useState } from 'react';
import { useStore, type ProjectMeta } from '../model/store';
import { AXES, defaultSettings } from '../model/options';
import type { Settings } from '../model/types';
import { FilePlus2, FolderOpen, Copy, Trash2, Pencil, Check, X, Sparkles, FileText, Clock, ArrowLeft } from 'lucide-react';
import { t as tx } from '../i18n';

const label = (s: Settings, key: keyof Settings) => AXES.find((a) => a.key === key)?.choices.find((c) => c.value === s[key])?.label ?? String(s[key]);

function fmtTime(iso: string) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return tx("刚刚");
  if (diff < 3_600_000) return tx("{{v0}} 分钟前", { v0: Math.round(diff / 60_000) });
  if (diff < 86_400_000) return tx("{{v0}} 小时前", { v0: Math.round(diff / 3_600_000) });
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' });
}

function ProjectCard({ p, active }: { p: ProjectMeta; active: boolean }) {
  const { openProject, renameProject, deleteProject, duplicateProject } = useStore();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(p.name);
  const s = p.settings;
  const tags = [label(s, 'degreeLevel'), label(s, 'stage'), s.campus === 'shenzhen' ? tx("深圳") : tx("本部"), s.form === 'practice' ? (s.degreeLevel === 'bachelor' ? tx("毕业设计") : tx("实践成果")) : '', s.category === 'hass' ? tx("人文社科") : '', s.lang === 'en' ? 'English' : ''].filter(Boolean);
  return (
    <div className={`proj ${active ? 'is-active' : ''}`}>
      <div className="proj-head">
        {editing ? (
          <span className="row" style={{ flex: 1 }}>
            <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.nativeEvent.isComposing || e.keyCode === 229) return; if (e.key === 'Enter') { void renameProject(p.id, name); setEditing(false); } if (e.key === 'Escape') setEditing(false); }} />
            <button type="button" className="btn btn-xs btn-icon" title={tx("确定")} onClick={() => { void renameProject(p.id, name); setEditing(false); }}><Check /></button>
            <button type="button" className="btn btn-xs btn-icon" title={tx("取消")} onClick={() => { setName(p.name); setEditing(false); }}><X /></button>
          </span>
        ) : (
          <button type="button" className="proj-name" onClick={() => void openProject(p.id)} title={tx("打开")}>{p.name}</button>
        )}
        {active && !editing && <span className="proj-badge">{tx("当前")}</span>}
      </div>
      <div className="proj-tags">{tags.map((t) => <span key={t} className="tag">{t}</span>)}</div>
      <div className="proj-meta muted"><Clock />{fmtTime(p.updatedAt)} {' '}{tx("修改")}</div>
      <div className="proj-actions">
        <button type="button" className="btn btn-xs btn-primary" onClick={() => void openProject(p.id)}><FolderOpen />{tx("打开")}</button>
        <button type="button" className="btn btn-xs btn-ghost" onClick={() => { setName(p.name); setEditing(true); }}><Pencil />{tx("重命名")}</button>
        <button type="button" className="btn btn-xs btn-ghost" onClick={() => void duplicateProject(p.id)}><Copy />{tx("复制")}</button>
        <button type="button" className="btn btn-xs btn-ghost btn-danger" onClick={() => { if (confirm(tx("删除「{{name}}」？文档及其图片将被永久删除。", { name: p.name }))) void deleteProject(p.id); }}><Trash2 />{tx("删除")}</button>
      </div>
    </div>
  );
}

export function ProjectsView() {
  const { projects, doc, createProject, setView, loaded } = useStore();
  const [name, setName] = useState('');
  const [settings, setSettings] = useState<Settings>(() => defaultSettings());
  const [template, setTemplate] = useState<'blank' | 'sample'>('blank');
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const canBack = loaded && projects.some((p) => p.id === doc.id);

  const onCreate = async () => {
    if (!loaded || creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    try { await createProject({ name, settings, template }); } finally { creatingRef.current = false; setCreating(false); }
  };

  return (
    <div className={`projects work-inner ${projects.length ? '' : 'is-empty'}`}>
      <div className="projects-head">
        <div>
          <h2>{tx("我的文档")}</h2>
          <p className="lead">{tx("文档保存在当前浏览器中。跨设备使用或长期保存时，请下载副本。")}</p>
        </div>
        {canBack && <button type="button" className="btn" onClick={() => setView('editor')}><ArrowLeft />{tx("回到「")}{doc.name}」</button>}
      </div>
      <div className="projects-grid">
        <div className="card new-proj">
          <h3><FilePlus2 />{tx("新建文档")}</h3>
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
          <div className="field-label" style={{ marginTop: 4 }}>{tx("模板")}</div>
          <div className="tpl-row">
            <label className={`tpl ${template === 'blank' ? 'on' : ''}`}>
              <input type="radio" name="tpl" checked={template === 'blank'} onChange={() => setTemplate('blank')} />
              <FileText /><span><b>{tx("空白文档")}</b></span>
            </label>
            <label className={`tpl ${template === 'sample' ? 'on' : ''}`}>
              <input type="radio" name="tpl" checked={template === 'sample'} onChange={() => setTemplate('sample')} />
              <Sparkles /><span><b>{tx("示例论文")}</b><small>{tx("含正文、图表和公式示例")}</small></span>
            </label>
          </div>
          <button type="button" className="btn btn-primary" disabled={creating || !loaded} onClick={() => void onCreate()}><FilePlus2 />{creating ? tx("正在创建…") : tx("创建")}</button>
        </div>
        {projects.length > 0 && <div className="proj-list">
          <h3 className="proj-list-title">{tx("最近使用")}{' '}<span className="muted">{projects.length}</span></h3>
          {projects.map((p) => <ProjectCard key={p.id} p={p} active={p.id === doc.id && loaded} />)}
        </div>}
      </div>
      <footer className="projects-foot muted">
        {tx("排版引擎是基于 Typst 修改的非官方版本。")}<a href={`${import.meta.env.BASE_URL}licenses.txt`} target="_blank" rel="noopener">{tx("开源许可与声明")}</a>
      </footer>
    </div>
  );
}
