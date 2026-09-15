// 项目管理界面：左边新建（起名、选类型、空白或样例），右边已有项目的卡片。
import { useState } from 'react';
import { useStore, type ProjectMeta } from '../model/store';
import { AXES, defaultSettings } from '../model/options';
import type { Settings } from '../model/types';
import { FilePlus2, FolderOpen, Copy, Trash2, Pencil, Check, X, Sparkles, FileText, Clock, ArrowLeft } from 'lucide-react';

const label = (s: Settings, key: keyof Settings) => AXES.find((a) => a.key === key)?.choices.find((c) => c.value === s[key])?.label ?? String(s[key]);

function fmtTime(iso: string) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} 小时前`;
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' });
}

function ProjectCard({ p, active }: { p: ProjectMeta; active: boolean }) {
  const { openProject, renameProject, deleteProject, duplicateProject } = useStore();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(p.name);
  const s = p.settings;
  const tags = [label(s, 'degreeLevel'), label(s, 'stage'), s.campus === 'shenzhen' ? '深圳' : '本部', s.form === 'practice' ? (s.degreeLevel === 'bachelor' ? '毕业设计' : '实践成果') : '', s.category === 'hass' ? '人文社科' : '', s.lang === 'en' ? 'English' : ''].filter(Boolean);
  return (
    <div className={`proj ${active ? 'is-active' : ''}`}>
      <div className="proj-head">
        {editing ? (
          <span className="row" style={{ flex: 1 }}>
            <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { void renameProject(p.id, name); setEditing(false); } if (e.key === 'Escape') setEditing(false); }} />
            <button type="button" className="btn btn-xs btn-icon" title="确定" onClick={() => { void renameProject(p.id, name); setEditing(false); }}><Check /></button>
            <button type="button" className="btn btn-xs btn-icon" title="取消" onClick={() => { setName(p.name); setEditing(false); }}><X /></button>
          </span>
        ) : (
          <button type="button" className="proj-name" onClick={() => void openProject(p.id)} title="打开">{p.name}</button>
        )}
        {active && !editing && <span className="proj-badge">当前</span>}
      </div>
      <div className="proj-tags">{tags.map((t) => <span key={t} className="tag">{t}</span>)}</div>
      <div className="proj-meta muted"><Clock />{fmtTime(p.updatedAt)} · 正文 {p.blocks} 块</div>
      <div className="proj-actions">
        <button type="button" className="btn btn-xs btn-primary" onClick={() => void openProject(p.id)}><FolderOpen />打开</button>
        <button type="button" className="btn btn-xs btn-ghost" onClick={() => setEditing(true)}><Pencil />重命名</button>
        <button type="button" className="btn btn-xs btn-ghost" onClick={() => void duplicateProject(p.id)}><Copy />复制</button>
        <button type="button" className="btn btn-xs btn-ghost btn-danger" onClick={() => { if (confirm(`删除「${p.name}」？连同它的图片一起删，不可恢复。`)) void deleteProject(p.id); }}><Trash2 />删除</button>
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
  const canBack = loaded && projects.some((p) => p.id === doc.id);

  const onCreate = async () => {
    setCreating(true);
    try { await createProject({ name, settings, template }); } finally { setCreating(false); }
  };

  return (
    <div className="projects work-inner">
      <div className="projects-head">
        <div>
          <h2>项目</h2>
          <p className="lead">每个项目一篇论文（或一份报告），各自的图片、设置分开存在这台浏览器里。</p>
        </div>
        {canBack && <button type="button" className="btn" onClick={() => setView('editor')}><ArrowLeft />回到「{doc.name}」</button>}
      </div>
      <div className="projects-grid">
        <div className="card new-proj">
          <h3><FilePlus2 />新建项目</h3>
          <label className="field">
            <span className="field-label">项目名</span>
            <input autoFocus value={name} placeholder="例如：张三的硕士学位论文" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void onCreate(); }} />
          </label>
          <div className="new-axes">
            {AXES.map((a) => (
              <label className="field" key={a.key}>
                <span className="field-label">{a.label}</span>
                <select value={settings[a.key] as string} onChange={(e) => setSettings({ ...settings, [a.key]: e.target.value })}>
                  {a.choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div className="field-label" style={{ marginTop: 4 }}>从什么开始</div>
          <div className="tpl-row">
            <label className={`tpl ${template === 'blank' ? 'on' : ''}`}>
              <input type="radio" name="tpl" checked={template === 'blank'} onChange={() => setTemplate('blank')} />
              <FileText /><span><b>空白</b><small>只有骨架，元信息自己填</small></span>
            </label>
            <label className={`tpl ${template === 'sample' ? 'on' : ''}`}>
              <input type="radio" name="tpl" checked={template === 'sample'} onChange={() => setTemplate('sample')} />
              <Sparkles /><span><b>样例</b><small>带一章正文、图表公式引用，看着改</small></span>
            </label>
          </div>
          <p className="muted" style={{ fontSize: 12, margin: '8px 0 10px' }}>类型之后在「论文设置」里随时能改；这里只是起个头。</p>
          <button type="button" className="btn btn-primary" disabled={creating} onClick={() => void onCreate()}><FilePlus2 />{creating ? '正在创建…' : '创建并打开'}</button>
        </div>
        <div className="proj-list">
          <h3 className="proj-list-title">已有项目 <span className="muted">{projects.length}</span></h3>
          {!projects.length && <div className="muted">还没有项目，左边新建一个。</div>}
          {projects.map((p) => <ProjectCard key={p.id} p={p} active={p.id === doc.id && loaded} />)}
        </div>
      </div>
    </div>
  );
}
