// 我的文档界面：左边新建（起名、选类型、空白或样例），右边最近使用的卡片。
import { useRef, useState } from 'react';
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
            <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.nativeEvent.isComposing || e.keyCode === 229) return; if (e.key === 'Enter') { void renameProject(p.id, name); setEditing(false); } if (e.key === 'Escape') setEditing(false); }} />
            <button type="button" className="btn btn-xs btn-icon" title="确定" onClick={() => { void renameProject(p.id, name); setEditing(false); }}><Check /></button>
            <button type="button" className="btn btn-xs btn-icon" title="取消" onClick={() => { setName(p.name); setEditing(false); }}><X /></button>
          </span>
        ) : (
          <button type="button" className="proj-name" onClick={() => void openProject(p.id)} title="打开">{p.name}</button>
        )}
        {active && !editing && <span className="proj-badge">当前</span>}
      </div>
      <div className="proj-tags">{tags.map((t) => <span key={t} className="tag">{t}</span>)}</div>
      <div className="proj-meta muted"><Clock />{fmtTime(p.updatedAt)} 修改</div>
      <div className="proj-actions">
        <button type="button" className="btn btn-xs btn-primary" onClick={() => void openProject(p.id)}><FolderOpen />打开</button>
        <button type="button" className="btn btn-xs btn-ghost" onClick={() => { setName(p.name); setEditing(true); }}><Pencil />重命名</button>
        <button type="button" className="btn btn-xs btn-ghost" onClick={() => void duplicateProject(p.id)}><Copy />复制</button>
        <button type="button" className="btn btn-xs btn-ghost btn-danger" onClick={() => { if (confirm(`删除「${p.name}」？文档及其图片将被永久删除。`)) void deleteProject(p.id); }}><Trash2 />删除</button>
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
    <div className="projects work-inner">
      <div className="projects-head">
        <div>
          <h2>我的文档</h2>
          <p className="lead">文档自动保存在此浏览器中。备份或换设备时，请下载副本。</p>
        </div>
        {canBack && <button type="button" className="btn" onClick={() => setView('editor')}><ArrowLeft />回到「{doc.name}」</button>}
      </div>
      <div className="projects-grid">
        <div className="card new-proj">
          <h3><FilePlus2 />新建文档</h3>
          <label className="field">
            <span className="field-label">文档名称</span>
            <input autoFocus value={name} placeholder="例如：张三的硕士学位论文" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.nativeEvent.isComposing || e.keyCode === 229) return; if (e.key === 'Enter') void onCreate(); }} />
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
          <div className="field-label" style={{ marginTop: 4 }}>模板</div>
          <div className="tpl-row">
            <label className={`tpl ${template === 'blank' ? 'on' : ''}`}>
              <input type="radio" name="tpl" checked={template === 'blank'} onChange={() => setTemplate('blank')} />
              <FileText /><span><b>空白文档</b></span>
            </label>
            <label className={`tpl ${template === 'sample' ? 'on' : ''}`}>
              <input type="radio" name="tpl" checked={template === 'sample'} onChange={() => setTemplate('sample')} />
              <Sparkles /><span><b>示例论文</b><small>含正文、图表和公式示例</small></span>
            </label>
          </div>
          <button type="button" className="btn btn-primary" disabled={creating || !loaded} onClick={() => void onCreate()}><FilePlus2 />{creating ? '正在创建…' : '创建'}</button>
        </div>
        <div className="proj-list">
          <h3 className="proj-list-title">最近使用 <span className="muted">{projects.length}</span></h3>
          {!projects.length && <div className="muted">暂无文档。</div>}
          {projects.map((p) => <ProjectCard key={p.id} p={p} active={p.id === doc.id && loaded} />)}
        </div>
      </div>
    </div>
  );
}
