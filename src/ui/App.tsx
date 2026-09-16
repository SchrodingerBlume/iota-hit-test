import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, type Section } from '../model/store';
import type { ThesisDoc } from '../model/types';
import { startCompiler, requestCompile, exportPdf, useCompileState } from '../compiler/client';
import { serializeProject } from '../typst/serialize';
import { BlockMenu } from '../editor/BlockMenu';
import { CommentsPane } from './CommentsPane';
import { Logo } from './Logo';
import { OutlinePane, useOutline } from './OutlinePane';
import { LinkDialogHost } from './LinkDialog';
import { useComments } from '../editor/comments';
import { collectRefTargets } from '../typst/pmToTypst';
import { computeNumbering } from '../typst/numbering';
import { docVersion } from '../editor/versions';
import { resolvePage } from '../model/pages';
import { EditorEnvContext, type EditorEnv } from '../editor/env';
import { imageBytes, putImage, safeImageName, imageDimensions } from '../editor/imageCache';
import { ProjectsView } from './ProjectsView';
import { FontRecovery } from './FontRecovery';
import { useFontState } from '../fonts/userFonts';
import { SettingsPanel } from './SettingsPanel';
import { InfoPanel } from './InfoPanel';
import { AbstractPanel, NomenclaturePanel, RichSection, BibPanel, DefensePanel, PagesPanel, IndexPanel } from './panels';
import { Preview } from './Preview';
import { useTheme, type ThemePref } from './theme';
import { useLayoutPrefs } from './layout';
import { Ribbon } from './Ribbon';
import { FluentProvider, Menu, MenuTrigger, MenuPopover, MenuList, MenuItem, MenuItemRadio, MenuDivider, Button, Tooltip, Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions } from '@fluentui/react-components';
import { Apps20Regular, DocumentAdd20Regular, Save20Regular, FolderOpen20Regular, DocumentPdf20Regular, Document20Regular, Info20Regular, WeatherSunny20Regular, WeatherMoon20Regular, Navigation20Regular } from '@fluentui/react-icons';
import { fluentLight, fluentDark } from './fluent';
import { SlidersHorizontal, BookText, PenLine, Library } from 'lucide-react';
import { t as tx } from '../i18n';

const NAV: { key: Section; label: string; group: string; k?: string }[] = [
  { key: 'info', label: tx("论文信息"), group: tx("设置") },
  { key: 'settings', label: tx("论文设置"), group: tx("设置") },
  { key: 'pages', label: tx("页面设置"), group: tx("设置") },
  { key: 'abstract', label: tx("摘要"), group: tx("前置") },
  { key: 'nomenclature', label: tx("符号与缩略语"), group: tx("前置") },
  { key: 'body', label: tx("正文"), group: tx("主体") },
  { key: 'conclusion', label: tx("结论"), group: tx("主体") },
  { key: 'bibliography', label: tx("参考文献"), group: tx("后置") },
  { key: 'appendix', label: tx("附录"), group: tx("后置") },
  { key: 'achievements', label: tx("成果"), group: tx("后置") },
  { key: 'defense', label: tx("答辩"), group: tx("后置") },
  { key: 'acknowledgement', label: tx("致谢"), group: tx("后置") },
  { key: 'resume', label: tx("个人简历"), group: tx("后置") },
  { key: 'index', label: tx("索引"), group: tx("后置") },
];

/** 文档一变就（防抖后）重新生成 Typst 并交给 worker */
function useAutoCompile(doc: ThesisDoc, loaded: boolean, refresh: number) {
  const status = useCompileState((s) => s.status);
  const fontsVersion = useCompileState((s) => s.fontsVersion);
  const sent = useRef(new Map<string, number>());
  const lastProject = useRef<string | null>(null);
  const lastRefresh = useRef(refresh);
  // 换断行引擎 / 网格这类全篇生效的设置，增量编译会留下旧版面的碎片，整个重来
  const engineKey = `${doc.settings.linebreaker}|${doc.settings.wordCompat}`;
  const lastEngine = useRef(engineKey);
  const restoring = useFontState((s) => s.restoring);
  useEffect(() => {
    if (!loaded || status !== 'ready') return;
    if (restoring && doc.settings.fontset !== 'webapp') return;
    let cancelled = false;
    const force = refresh !== lastRefresh.current || engineKey !== lastEngine.current;
    const t = window.setTimeout(async () => {
      const project = serializeProject(doc, { preview: true });
      // 换了项目：图片名字空间变了，worker 里映射的旧图全撤掉，重新发
      let stale: string[] = [];
      const nextSent = new Map(sent.current);
      if (lastProject.current !== doc.id) {
        stale = [...sent.current.keys()];
        nextSent.clear();
      }
      const images: { name: string; data: ArrayBuffer }[] = [];
      for (const name of project.images) {
        if (nextSent.has(name)) continue;
        const buf = await imageBytes(name);
        if (cancelled) return;
        if (!buf) continue;
        images.push({ name, data: buf.slice(0) });
        nextSent.set(name, buf.byteLength);
      }
      const removeImages = [...new Set([...stale, ...[...nextSent.keys()].filter((n) => !project.images.includes(n))])].filter((n) => !images.some((i) => i.name === n));
      for (const n of removeImages) nextSent.delete(n);
      if (cancelled) return;
      sent.current = nextSent;
      lastProject.current = doc.id;
      lastRefresh.current = refresh;
      lastEngine.current = engineKey;
      requestCompile({ force, main: project.main, files: project.files, images, removeImages, segments: project.segments, version: docVersion() });
    }, force ? 0 : 130);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [doc, loaded, status, fontsVersion, refresh, restoring]);
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
  const { doc, section, loaded, view, setView, setSection, load, importProject, setImages } = useStore();
  const compile = useCompileState();
  const [refresh, setRefresh] = useState(0);
  useAutoCompile(doc, loaded && view === 'editor', refresh);
  const [busy, setBusy] = useState<string | null>(null);
  const [theme, themePref, setThemePref] = useTheme();
  const { navOpen, setNavOpen, mode, setMode, ratio, startDrag, mainRef, gridColumns, gridRows, compact, stacked } = useLayoutPrefs();
  const lastSection = useRef(section);
  useEffect(() => {
    if (lastSection.current !== section && mode === 'preview' && ['info', 'settings', 'pages', 'bibliography', 'achievements', 'nomenclature', 'defense', 'index'].includes(section)) setMode('split');
    lastSection.current = section;
  }, [section, mode, setMode]);
  const hasDocument = loaded && useStore.getState().projects.some((p) => p.id === doc.id);
  const commentsOpen = useComments((s) => s.open);
  const [about, setAbout] = useState(false);
  const outlineOn = useOutline((s) => s.on);

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => { if (loaded && view === 'editor') startCompiler(); }, [loaded, view]);

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
    setBusy(tx("正在导出 PDF…"));
    try {
      const r = await exportPdf(serializeProject(doc).main);
      if (r.pdf) download(`${doc.info.title.split('\n')[0] || tx("论文")}.pdf`, r.pdf, 'application/pdf');
      else alert(tx("导出失败：") + r.diagnostics.map((d) => d.message).join('\n'));
    } finally { setBusy(null); }
  };
  const onSaveProject = async () => {
    // 工程 = JSON + 图片（base64），一个文件带走
    const images: Record<string, string> = {};
    for (const img of doc.images) {
      const buf = await imageBytes(img.name);
      if (buf) images[img.name] = btoa(Array.from(new Uint8Array(buf), (byte) => String.fromCharCode(byte)).join(''));
    }
    download(`${doc.info.title.split('\n')[0] || tx("论文")}.iota.json`, JSON.stringify({ ...doc, imageData: images }, null, 1), 'application/json');
  };
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
        alert(tx("无法打开文档：{{v0}}", { v0: error instanceof Error ? error.message : tx("文件读取失败。") }));
      }
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
      case 'body': return <RichSection title={tx("正文")} richKey="body" headings placeholder={tx("输入正文…")} />;
      case 'conclusion': return <RichSection title={tx("结论")} richKey="conclusion" headings={false} />;
      case 'bibliography': return <BibPanel which="bibliography" />;
      case 'appendix': return <RichSection title={tx("附录")} richKey="appendix" headings />;
      case 'achievements': return <BibPanel which="achievements" />;
      case 'defense': return <DefensePanel />;
      case 'acknowledgement': return <RichSection title={tx("致谢")} richKey="acknowledgement" headings={false} blocks={false} />;
      case 'index': return <IndexPanel />;
      case 'resume': return <RichSection title={tx("个人简历")} richKey="resume" headings={false} blocks={false} />;
    }
  })();

  const dot = compile.status === 'error' ? 'err' : compile.status === 'booting' || compile.compiling ? 'busy' : 'ok';
  const statusText = compile.status === 'booting' ? tx("正在准备预览…") : compile.status === 'error' ? tx("预览不可用") : busy ?? (compile.compiling ? tx("正在更新预览…") : compile.diagnostics.some((d) => d.severity === 'error') ? tx("排版失败") : tx("预览已更新"));
  const GROUP_ICON: Record<string, React.ReactNode> = { 设置: <SlidersHorizontal />, 前置: <BookText />, 主体: <PenLine />, 后置: <Library /> };

  return (
    <EditorEnvContext.Provider value={env}>
      <FluentProvider theme={theme === 'dark' ? fluentDark : fluentLight} className="fluent-root">
      <FontRecovery />
      <div className="app">
        {/* 顶栏并进功能区那一行：左边品牌与「文件」菜单，右边状态、导出、主题 */}
        {(() => { const leading = (
          <span className="rb-leading">
            <Menu positioning="below-start">
              <MenuTrigger disableButtonEnhancement>
                <Button appearance="primary" className="rb-file" onMouseDown={(e) => e.preventDefault()}>{tx("文件")}</Button>
              </MenuTrigger>
              <MenuPopover className="rb-file-menu">
                <MenuList>
                  <MenuItem icon={<Apps20Regular />} disabled={view === 'projects' && !hasDocument} onClick={() => setView(view === 'projects' ? 'editor' : 'projects')}>{view === 'projects' ? tx("返回文档") : tx("我的文档")}</MenuItem>
                  <MenuItem icon={<DocumentAdd20Regular />} onClick={onNew}>{tx("新建文档…")}</MenuItem>
                  <MenuDivider />
                  <MenuItem icon={<Save20Regular />} disabled={!hasDocument} onClick={onSaveProject}>{tx("下载副本（.iota.json）")}</MenuItem>
                  <MenuItem icon={<FolderOpen20Regular />} disabled={!loaded} onClick={onOpenProject}>{tx("打开…")}</MenuItem>
                  <MenuDivider />
                  <MenuItem icon={<DocumentPdf20Regular />} disabled={!hasDocument || compile.status !== 'ready' || !!busy} onClick={() => void onExportPdf()}>{tx("导出 PDF")}</MenuItem>
                  <MenuItem icon={<Document20Regular />} disabled={!hasDocument} onClick={onExportTypst}>{tx("导出 Typst 源文件")}</MenuItem>
                </MenuList>
              </MenuPopover>
            </Menu>
            {view === 'editor' && <span className="rb-proj">{doc.name}</span>}
          </span>
        ); const trailing = (
          <span className="rb-trailing">
            {view === 'editor' && <span className="status"><i className={`dot ${dot}`} />{statusText}</span>}

            <Menu positioning="below-end" checkedValues={{ theme: [themePref] }} onCheckedValueChange={(_, d) => setThemePref((d.checkedItems[0] ?? 'system') as ThemePref)}>
              <MenuTrigger disableButtonEnhancement>
                <Tooltip content={tx("外观：浅色 / 深色 / 跟随系统")} relationship="label" positioning="below">
                  <Button appearance="subtle" size="small" className="theme-btn" icon={theme === 'dark' ? <WeatherMoon20Regular /> : <WeatherSunny20Regular />} />
                </Tooltip>
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  <MenuItemRadio name="theme" value="light" icon={<WeatherSunny20Regular />}>{tx("浅色")}</MenuItemRadio>
                  <MenuItemRadio name="theme" value="dark" icon={<WeatherMoon20Regular />}>{tx("深色")}</MenuItemRadio>
                  <MenuItemRadio name="theme" value="system">{tx("跟随系统")}</MenuItemRadio>
                </MenuList>
              </MenuPopover>
            </Menu>
            <Menu positioning="below-end">
              <MenuTrigger disableButtonEnhancement>
                <button type="button" className="brand-btn" title={tx("iota-hit · 关于")}><Logo size={30} /></button>
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  <MenuItem icon={<Info20Regular />} onClick={() => setAbout(true)}>{tx("关于 iota-hit")}</MenuItem>
                  <MenuItem onClick={() => window.open('https://github.com/SchrodingerBlume/iota-hit-test', '_blank', 'noopener')}>GitHub</MenuItem>
                </MenuList>
              </MenuPopover>
            </Menu>
          </span>
        ); return view === 'projects' ? <Ribbon minimal leading={leading} trailing={trailing} layout={{ navOpen, setNavOpen, mode, setMode }} /> : <Ribbon leading={leading} trailing={trailing} layout={{ navOpen, setNavOpen, mode, setMode }} />; })()}
        {view === 'projects' ? <ProjectsView /> : (<>
        <div className={`main mode-${mode} ${navOpen ? '' : 'nav-closed'} ${compact ? 'is-compact' : ''} ${stacked ? 'is-stacked' : ''}`} ref={mainRef} style={{ gridTemplateColumns: gridColumns, gridTemplateRows: gridRows }}>
          {compact && navOpen && <div className="nav-backdrop" onClick={() => setNavOpen(false)} />}
          <nav className={`nav ${compact ? 'is-overlay' : ''}`} hidden={!navOpen} onClick={(e) => { if (compact && (e.target as HTMLElement).closest('button:not(.outline-item)')) setNavOpen(false); }}>
            {outlineOn && <div className="nav-outline"><h4>{tx("大纲")}</h4><OutlinePane /></div>}
            {[tx("设置"), tx("前置"), tx("主体"), tx("后置")].map((g) => (
              <div key={g}>
                <h4>{GROUP_ICON[g]}{g}</h4>
                {NAV.filter((n) => n.group === g).map((n) => {
                  const off = loaded && ((n.key === 'abstract' && !resolvePage(doc, 'abstract').value) || (n.key === 'nomenclature' && !resolvePage(doc, 'symbolsPage').value && !resolvePage(doc, 'abbreviationsPage').value) || (n.key === 'appendix' && !resolvePage(doc, 'appendix').value) || (n.key === 'achievements' && !resolvePage(doc, 'achievements').value) || (n.key === 'defense' && !resolvePage(doc, 'defense').value) || (n.key === 'resume' && !resolvePage(doc, 'resume').value) || (n.key === 'index' && !resolvePage(doc, 'index').value));
                  return <button key={n.key} type="button" className={`${section === n.key ? 'on' : ''} ${off ? 'off' : ''}`} aria-current={section === n.key ? 'page' : undefined} onClick={() => { setSection(n.key); if (mode === 'preview') setMode('split'); }}>{n.label}{off && <span className="k">{tx("不显示")}</span>}</button>;
                })}
              </div>
            ))}
          </nav>
          <section className={`work ${commentsOpen ? 'has-comments' : ''}`} hidden={mode === 'preview'}>
            {loaded ? <div className="work-inner" key={`${doc.id}:${section}`}>{panel}</div> : <div className="muted">{tx("正在打开文档…")}</div>}
            {commentsOpen && loaded && <CommentsPane />}
          </section>
          <LinkDialogHost />
          <Dialog open={about} onOpenChange={(_, d) => setAbout(d.open)}>
            <DialogSurface className="style-dialog">
              <DialogBody>
                <DialogTitle><span className="about-title"><Logo size={40} />iota-hit</span></DialogTitle>
                <DialogContent>
                  <p>{tx("哈尔滨工业大学学位论文在线编辑器。排版用 iota-hit 模板（hithesis 的 Typst 复刻），Typst 0.15.1 经 typst.ts 编成 wasm 在浏览器里运行。")}</p>
                  <p>{tx("字体：Noto Serif / Sans CJK SC、FandolKai、TeX Gyre Termes / Heros、DejaVu Sans Mono；也可读本机字体切到 Windows / macOS 档。")}</p>
                  <p className="muted">{tx("整站静态，没有服务器；工程与图片只存在这台浏览器里，记得定期「文件 → 保存工程」。")}</p>
                </DialogContent>
                <DialogActions><Button appearance="primary" onClick={() => setAbout(false)}>{tx("好")}</Button></DialogActions>
              </DialogBody>
            </DialogSurface>
          </Dialog>
          {mode === 'split' && <div className="splitter" title={tx("拖动调整比例（{{v0}}% : {{v1}}%）", { v0: Math.round(ratio * 100), v1: Math.round((1 - ratio) * 100) })} onPointerDown={startDrag} />}
          <div className="preview-slot" hidden={mode === 'editor'}><Preview onRefresh={() => setRefresh((n) => n + 1)} refreshDisabled={!hasDocument} /></div>
          <BlockMenu />
        </div>
        {/* 手机：底部一条切换 编辑 / 分栏 / 预览 与目录抽屉，够不着功能区「视图」页时用 */}
        {compact && (
          <div className="mobile-bar" role="toolbar">
            <button type="button" className={navOpen ? 'on' : ''} onClick={() => setNavOpen(!navOpen)} title={tx("导航窗格")}><Navigation20Regular />{tx("导航")}</button>
            <button type="button" className={mode === 'editor' ? 'on' : ''} onClick={() => setMode('editor')}>{tx("编辑")}</button>
            <button type="button" className={mode === 'split' ? 'on' : ''} onClick={() => setMode('split')}>{tx("并排查看")}</button>
            <button type="button" className={mode === 'preview' ? 'on' : ''} onClick={() => setMode('preview')}>{tx("预览")}</button>
          </div>
        )}
        </>)}
      </div>
      </FluentProvider>
    </EditorEnvContext.Provider>
  );
}
