import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, type Section } from '../model/store';
import type { ThesisDoc } from '../model/types';
import { startCompiler, requestCompile, exportPdf, useCompileState } from '../compiler/client';
import { serializeProject } from '../typst/serialize';
import { collectRefTargets } from '../typst/pmToTypst';
import { computeNumbering } from '../typst/numbering';
import { docVersion } from '../editor/versions';
import { resolvePage } from '../model/pages';
import { EditorEnvContext, type EditorEnv } from '../editor/env';
import { imageBytes, putImage, safeImageName, imageDimensions, clearImageCache } from '../editor/imageCache';
import { ProjectsView } from './ProjectsView';
import { useFontState } from '../fonts/userFonts';
import { SettingsPanel } from './SettingsPanel';
import { InfoPanel } from './InfoPanel';
import { AbstractPanel, NomenclaturePanel, RichSection, BibPanel, DefensePanel, PagesPanel } from './panels';
import { Preview } from './Preview';
import { useTheme } from './theme';
import { FileDown, Save, FolderOpen, MoreHorizontal, FileText, FilePlus2, Info, Sun, Moon, SlidersHorizontal, BookText, PenLine, Library, LayoutGrid, PanelLeftClose, PanelLeftOpen, PanelLeft, Columns2, PanelRight } from 'lucide-react';
import { useLayoutPrefs } from './layout';

const NAV: { key: Section; label: string; group: string; k?: string }[] = [
  { key: 'settings', label: '论文设置', group: '设置' },
  { key: 'info', label: '元信息', group: '设置' },
  { key: 'pages', label: '页面开关', group: '设置' },
  { key: 'abstract', label: '摘要', group: '前置' },
  { key: 'nomenclature', label: '符号与缩略语', group: '前置' },
  { key: 'body', label: '正文', group: '主体' },
  { key: 'conclusion', label: '结论', group: '主体' },
  { key: 'bibliography', label: '参考文献', group: '后置' },
  { key: 'appendix', label: '附录', group: '后置' },
  { key: 'achievements', label: '成果', group: '后置' },
  { key: 'defense', label: '答辩', group: '后置' },
  { key: 'acknowledgement', label: '致谢', group: '后置' },
  { key: 'resume', label: '个人简历', group: '后置' },
];

/** 文档一变就（防抖后）重新生成 Typst 并交给 worker */
function useAutoCompile(doc: ThesisDoc, loaded: boolean) {
  const status = useCompileState((s) => s.status);
  const fontsVersion = useCompileState((s) => s.fontsVersion);
  const sent = useRef(new Map<string, number>());
  const lastProject = useRef<string | null>(null);
  useEffect(() => {
    if (!loaded || status !== 'ready') return;
    const t = window.setTimeout(async () => {
      const project = serializeProject(doc);
      // 换了项目：图片名字空间变了，worker 里映射的旧图全撤掉，重新发
      let stale: string[] = [];
      if (lastProject.current !== doc.id) {
        stale = [...sent.current.keys()];
        sent.current.clear();
        clearImageCache();
        lastProject.current = doc.id;
      }
      const images: { name: string; data: ArrayBuffer }[] = [];
      for (const name of project.images) {
        if (sent.current.has(name)) continue;
        const buf = await imageBytes(name);
        if (!buf) continue;
        images.push({ name, data: buf.slice(0) });
        sent.current.set(name, buf.byteLength);
      }
      const removeImages = [...new Set([...stale, ...[...sent.current.keys()].filter((n) => !project.images.includes(n))])].filter((n) => !images.some((i) => i.name === n));
      for (const n of removeImages) sent.current.delete(n);
      requestCompile({ main: project.main, files: project.files, images, removeImages, segments: project.segments, version: docVersion() });
    }, 130);
    return () => window.clearTimeout(t);
  }, [doc, loaded, status, fontsVersion]);
  return sent;
}

function download(name: string, data: BlobPart, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function App() {
  const { doc, section, loaded, view, setView, setSection, load, replaceDoc, setImages } = useStore();
  const compile = useCompileState();
  useAutoCompile(doc, loaded);
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [theme, setTheme] = useTheme();
  const { navOpen, setNavOpen, mode, setMode, ratio, startDrag, mainRef, gridColumns } = useLayoutPrefs();

  useEffect(() => {
    startCompiler();
    void (async () => {
      await load();
      // 上次自己选的字体文件：装回引擎（引擎没就绪会等它）
      void useFontState.getState().loadStored();
      if (useStore.getState().doc.settings.fontset !== 'webapp') void useFontState.getState().autoReadLocal();
    })();
  }, []);

  // 编辑器周边：文献、可引用对象、缩略语、图片
  const env = useMemo<EditorEnv>(() => ({
    bibKeys: doc.references.filter((r) => r.key.trim()).map((r) => ({ key: r.key, title: r.fields.title ?? '', group: r.group })),
    refTargets: (() => {
      const nb = computeNumbering(doc.body as any, doc.settings, 'body');
      const na = computeNumbering(doc.appendix as any, doc.settings, 'appendix');
      return [...collectRefTargets(doc.body).map((r) => ({ ...r, number: nb.get(r.label)?.number, ref: nb.get(r.label)?.ref })),
        ...collectRefTargets(doc.appendix).map((r) => ({ ...r, number: na.get(r.label)?.number, ref: na.get(r.label)?.ref }))];
    })(),
    abbrs: doc.abbreviations.filter((a) => a.key.trim()).map((a) => ({ key: a.key.trim(), long: a.long })),
    images: doc.images,
    addImage: async (file) => {
      const taken = new Set(useStore.getState().doc.images.map((i) => i.name));
      const name = safeImageName(file.name, taken);
      await putImage(name, file);
      const dim = await imageDimensions(file);
      setImages([...useStore.getState().doc.images, { name, mime: file.type, ...(dim ?? {}) }]);
      return { name, ...(dim ?? {}) };
    },
  }), [doc.references, doc.body, doc.appendix, doc.abbreviations, doc.images, doc.settings, setImages]);

  const onExportPdf = async () => {
    setBusy('正在导出 PDF…');
    try {
      const r = await exportPdf();
      if (r.pdf) download(`${doc.info.title.split('\n')[0] || '论文'}.pdf`, r.pdf, 'application/pdf');
      else alert('导出失败：' + r.diagnostics.map((d) => d.message).join('\n'));
    } finally { setBusy(null); }
  };
  const onSaveProject = async () => {
    // 工程 = JSON + 图片（base64），一个文件带走
    const images: Record<string, string> = {};
    for (const img of doc.images) {
      const buf = await imageBytes(img.name);
      if (buf) images[img.name] = btoa(String.fromCharCode(...new Uint8Array(buf)));
    }
    download(`${doc.info.title.split('\n')[0] || '论文'}.iota.json`, JSON.stringify({ ...doc, imageData: images }, null, 1), 'application/json');
  };
  const onOpenProject = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      const raw = JSON.parse(await f.text());
      const imageData: Record<string, string> = raw.imageData ?? {};
      delete raw.imageData;
      for (const [name, b64] of Object.entries(imageData)) {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        await putImage(name, new Blob([bytes]));
      }
      replaceDoc(raw);
    };
    input.click();
  };
  const onExportTypst = () => {
    const project = serializeProject(doc);
    download('main.typ', project.main, 'text/plain');
    for (const [name, text] of Object.entries(project.files)) download(name, text, 'text/plain');
  };
  const onNew = () => setView('projects');

  const panel = (() => {
    switch (section) {
      case 'settings': return <SettingsPanel />;
      case 'info': return <InfoPanel />;
      case 'pages': return <PagesPanel />;
      case 'abstract': return <AbstractPanel />;
      case 'nomenclature': return <NomenclaturePanel />;
      case 'body': return <RichSection title="正文" lead="H1 是章、H2 是节……章前自动分页、目录自动生成；右侧那一栏英文名给博士的双语目录与页眉用。" richKey="body" headings placeholder="= 绪论……" />;
      case 'conclusion': return <RichSection title="结论" lead="不带章号的一章，排在正文之后、参考文献之前。" richKey="conclusion" headings={false} />;
      case 'bibliography': return <BibPanel which="bibliography" />;
      case 'appendix': return <RichSection title="附录" lead="H1 是一个附录（附录 A / 附录 1），里面的图表公式跟着编成 A-1。" richKey="appendix" headings />;
      case 'achievements': return <BibPanel which="achievements" />;
      case 'defense': return <DefensePanel />;
      case 'acknowledgement': return <RichSection title="致谢" richKey="acknowledgement" headings={false} blocks={false} />;
      case 'resume': return <RichSection title="个人简历" lead="出生、本科、硕士、博士、获奖情况、工作经历，一段一段写。要排这一页记得在「页面开关」里打开。" richKey="resume" headings={false} blocks={false} />;
    }
  })();

  const dot = compile.status === 'error' ? 'err' : compile.status === 'booting' || compile.compiling ? 'busy' : 'ok';
  const statusText = compile.status === 'booting' ? '准备引擎…' : compile.status === 'error' ? '引擎故障' : compile.compiling ? '排版中…' : busy ?? '已排版';
  const GROUP_ICON: Record<string, React.ReactNode> = { 设置: <SlidersHorizontal />, 前置: <BookText />, 主体: <PenLine />, 后置: <Library /> };

  return (
    <EditorEnvContext.Provider value={env}>
      <div className="app">
        <header className="topbar">
          <button type="button" className="btn btn-ghost btn-icon" title={navOpen ? '收起左栏' : '展开左栏'} onClick={() => setNavOpen(!navOpen)}>{navOpen ? <PanelLeftClose /> : <PanelLeftOpen />}</button>
          <span className="brand">
            <span className="brand-mark" aria-hidden>ι</span>
            <span className="brand-text"><b>iota-hit</b><small>哈尔滨工业大学学位论文 · 在线编辑</small></span>
          </span>
          <button type="button" className={`btn btn-ghost proj-btn ${view === 'projects' ? 'on' : ''}`} title="项目管理" onClick={() => setView(view === 'projects' ? 'editor' : 'projects')}><LayoutGrid />{loaded ? doc.name : '项目'}</button>
          <span className="spacer" />
          <span className="seg layout-seg" title="布局">
            <button type="button" className={mode === 'editor' ? 'on' : ''} title="只看编辑" onClick={() => setMode('editor')}><PanelLeft /></button>
            <button type="button" className={mode === 'split' ? 'on' : ''} title="编辑 + 预览" onClick={() => setMode('split')}><Columns2 /></button>
            <button type="button" className={mode === 'preview' ? 'on' : ''} title="只看预览" onClick={() => setMode('preview')}><PanelRight /></button>
          </span>
          <span className="status"><i className={`dot ${dot}`} />{statusText}</span>
          <button type="button" className="btn btn-primary" disabled={compile.status !== 'ready' || !!busy} onClick={onExportPdf}><FileDown />导出 PDF</button>
          <button type="button" className="btn btn-ghost" onClick={onSaveProject}><Save />保存工程</button>
          <button type="button" className="btn btn-ghost" title="读入 .iota.json 文件，内容并入当前项目" onClick={onOpenProject}><FolderOpen />导入文件</button>
          <span className="menu">
            <button type="button" className="btn btn-ghost btn-icon" title="更多" onClick={() => setMenu((m) => !m)}><MoreHorizontal /></button>
            {menu && (
              <span className="menu-pop" onMouseLeave={() => setMenu(false)}>
                <button type="button" onClick={() => { setMenu(false); onExportTypst(); }}><FileText />导出 Typst 源码（main.typ + .bib）</button>
                <hr />
                <button type="button" onClick={() => { setMenu(false); onNew(); }}><FilePlus2 />新建项目…</button>
                <hr />
                <button type="button" onClick={() => { setMenu(false); alert('iota-hit 在线编辑器\n\n排版：iota-hit 0.1.0（hithesis 的 Typst 复刻）\n引擎：Typst 0.15.1，经 typst.ts 编成 wasm 在浏览器里运行\n字体：Noto Serif/Sans CJK SC、FandolKai、TeX Gyre Termes/Heros、DejaVu Sans Mono；也可读本机字体切到 Windows / macOS 档\n\n整站静态，没有服务器；工程与图片只存在这台浏览器里，记得定期「保存工程」。'); }}><Info />关于</button>
              </span>
            )}
          </span>
          <button type="button" className="btn btn-ghost btn-icon theme-btn" title={theme === 'dark' ? '切到浅色' : '切到深色'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun /> : <Moon />}</button>
        </header>
        {view === 'projects' ? <ProjectsView /> : (
        <div className={`main mode-${mode} ${navOpen ? '' : 'nav-closed'}`} ref={mainRef} style={{ gridTemplateColumns: gridColumns }}>
          <nav className="nav" hidden={!navOpen}>
            {['设置', '前置', '主体', '后置'].map((g) => (
              <div key={g}>
                <h4>{GROUP_ICON[g]}{g}</h4>
                {NAV.filter((n) => n.group === g).map((n) => {
                  const off = loaded && ((n.key === 'abstract' && !resolvePage(doc, 'abstract').value) || (n.key === 'nomenclature' && !resolvePage(doc, 'symbolsPage').value && !resolvePage(doc, 'abbreviationsPage').value) || (n.key === 'appendix' && !resolvePage(doc, 'appendix').value) || (n.key === 'achievements' && !resolvePage(doc, 'achievements').value) || (n.key === 'defense' && !resolvePage(doc, 'defense').value) || (n.key === 'resume' && !resolvePage(doc, 'resume').value));
                  return <button key={n.key} type="button" className={`${section === n.key ? 'on' : ''} ${off ? 'off' : ''}`} onClick={() => setSection(n.key)}>{n.label}{off && <span className="k">关</span>}</button>;
                })}
              </div>
            ))}
          </nav>
          <section className="work" hidden={mode === 'preview'}>
            {loaded ? <div className="work-inner" key={section}>{panel}</div> : <div className="muted">读取工程…</div>}
          </section>
          {mode === 'split' && <div className="splitter" title={`拖动调整比例（${Math.round(ratio * 100)}% : ${Math.round((1 - ratio) * 100)}%）`} onPointerDown={startDrag} />}
          <div className="preview-slot" hidden={mode === 'editor'}><Preview /></div>
        </div>
        )}
      </div>
    </EditorEnvContext.Provider>
  );
}
