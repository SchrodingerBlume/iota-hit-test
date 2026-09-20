import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore, type Section } from '../model/store';
import type { ThesisDoc } from '../model/types';
import { startCompiler, requestCompile, requestPara, resetForProject, exportPdf, useCompileState } from '../compiler/client';
import { serializeProject, serializePara, paraEligible, linebreaksInput } from '../typst/serialize';
import { chapterAt, chapterPages } from '../compiler/focus';
import { getEditor, onRegistryChange } from '../editor/registry';
import { BlockMenu } from '../editor/BlockMenu';
import { CommentsPane } from './CommentsPane';
import { Logo } from './Logo';
import { OutlinePane, useOutline } from './OutlinePane';
import { LinkDialogHost } from './LinkDialog';
import { useComments } from '../editor/comments';
import { collectRefTargets } from '../typst/pmToTypst';
import { computeNumbering } from '../typst/numbering';
import { docVersion } from '../editor/versions';
import { useInputState } from '../editor/inputState';
import { resolvePage } from '../model/pages';
import { EditorEnvContext, type EditorEnv } from '../editor/env';
import { imageBytes, putImage, safeImageName, imageDimensions } from '../editor/imageCache';
import { ProjectsView } from './ProjectsView';
import { FontRecovery } from './FontRecovery';
import { useFontState } from '../fonts/userFonts';
import { SettingsPanel } from './SettingsPanel';
import { InfoPanel, CoverPanel, TitlepagePanel } from './InfoPanel';
import { AbstractPanel, NomenclaturePanel, RichSection, BodySettings, BibPanel, DefensePanel, TocPanel, IndexPanel, PageSettings, OpenrightSwitch } from './panels';
import { Preview } from './Preview';
import { usePreviewSurface } from './PreviewEditLayer';
import { useTheme, type ThemePref } from './theme';
import { useLayoutPrefs } from './layout';
import { Ribbon, HistoryButtons } from './Ribbon';
import { FluentProvider, Menu, MenuTrigger, MenuPopover, MenuList, MenuItem, MenuItemRadio, MenuDivider, Button, Tooltip, Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions } from '@fluentui/react-components';
import { Fold } from './Fold';
import { SettingSwitch } from './TriSwitch';
import { watchReflow } from './reflow';
import { Home20Regular, Save20Regular, DocumentPdf20Regular, Document20Regular, Info20Regular, WeatherSunny20Regular, WeatherMoon20Regular, Navigation20Regular, ChevronLeft20Regular } from '@fluentui/react-icons';
import { fluentLight, fluentDark } from './fluent';
import { SlidersHorizontal, BookText, PenLine, Library } from 'lucide-react';
import { t as tx } from '../i18n';

const NAV: { key: Section; label: string; group: string; k?: string }[] = [
  { key: 'info', label: tx("论文信息"), group: tx("设置") },
  { key: 'settings', label: tx("论文设置"), group: tx("设置") },
  { key: 'cover', label: tx("封面"), group: tx("前置") },
  { key: 'titlepage', label: tx("内封"), group: tx("前置") },
  { key: 'abstract', label: tx("摘要"), group: tx("前置") },
  { key: 'nomenclature', label: tx("符号与缩略语"), group: tx("前置") },
  { key: 'toc', label: tx("目录"), group: tx("前置") },
  { key: 'body', label: tx("正文"), group: tx("主体") },
  { key: 'conclusion', label: tx("结论"), group: tx("主体") },
  { key: 'bibliography', label: tx("参考文献"), group: tx("后置") },
  { key: 'appendix', label: tx("附录"), group: tx("后置") },
  { key: 'achievements', label: tx("成果"), group: tx("后置") },
  { key: 'defense', label: tx("答辩决议"), group: tx("后置") },
  { key: 'acknowledgement', label: tx("致谢"), group: tx("后置") },
  { key: 'resume', label: tx("个人简历"), group: tx("后置") },
  { key: 'index', label: tx("索引"), group: tx("后置") },
];

/** 文档一变就（防抖后）重新生成 Typst 并交给 worker */
function useAutoCompile(doc: ThesisDoc, loaded: boolean, refresh: number, previewFocused: boolean, composing: boolean) {
  const status = useCompileState((s) => s.status);
  const fontsVersion = useCompileState((s) => s.fontsVersion);
  const sent = useRef(new Map<string, number>());
  const lastProject = useRef<string | null>(null);
  const lastRefresh = useRef(refresh);
  const lastFonts = useRef(fontsVersion);
  const engineGen = useCompileState((s) => s.engineGen);
  const lastGen = useRef(engineGen);
  // 换断行引擎 / 网格这类全篇生效的设置，增量编译会留下旧版面的碎片，整个重来
  const engineKey = `${doc.settings.linebreaker}|${doc.settings.wordCompat}`;
  const lastEngine = useRef(engineKey);
  const restoring = useFontState((s) => s.restoring);
  // 长文档：打字时只编光标所在的一章，停手后再整编一次校准
  const fullTimer = useRef(0);
  const lastFocusId = useRef('');
  const [fullTick, setFullTick] = useState(0);
  const lastFull = useRef(0);
  const paraTimer = useRef(0);
  /** 段级即时回显最近一次发出的时刻 + 一小段：这期间章级编译等停手再来 */
  const paraActiveUntil = useRef(0);
  const docRef = useRef(doc);
  docRef.current = doc;
  // 打字即时回显：直接听正文编辑器的事务（工程 JSON 要停 100 ms 才回灌），光标所在是纯文字段就先只编这一段（85 ms）
  useEffect(() => {
    if (!loaded) return;
    let ed = getEditor('body');
    const onTr = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (!transaction.docChanged) return;
      const e = getEditor('body');
      const cs = useCompileState.getState();
      if (!e || e.isDestroyed || cs.status !== 'ready' || cs.pageCount < FOCUS_PAGES || !cs.artifact || useFontState.getState().restoring) return;
      const $from = e.state.selection.$from;
      if ($from.depth < 1) return;
      const node = $from.node(1).toJSON();
      if (!paraEligible(node)) return;
      const idx = $from.index(0), from = $from.before(1), to = $from.after(1), version = docVersion();
      paraActiveUntil.current = performance.now() + 600;
      window.clearTimeout(paraTimer.current);
      paraTimer.current = window.setTimeout(() => {
        const d = docRef.current;
        const p = serializePara(d, idx, { node, pos: from });
        requestPara({ main: p.main, segments: p.segments, version, key: 'body', from, to, inputs: linebreaksInput(d.settings) ? { linebreaks: linebreaksInput(d.settings)! } : {} });
      }, 30);
    };
    const attach = () => { ed?.off('transaction', onTr); ed = getEditor('body'); ed?.on('transaction', onTr); };
    attach();
    const off = onRegistryChange(attach);
    return () => { off(); ed?.off('transaction', onTr); window.clearTimeout(paraTimer.current); };
  }, [loaded]);
  useEffect(() => () => window.clearTimeout(fullTimer.current), []);
  useEffect(() => {
    if (!loaded || status !== 'ready' || composing) return;
    // 读 store 里的现值：引擎刚重启时 FontRecovery 的 effect 先跑、把 restoring 拨成 true，闭包里的还是旧的 false，
    // 按旧值就会先用替代字体编一遍、字体到了再编一遍——预览闪一下「字体丢了」
    if ((restoring || useFontState.getState().restoring) && doc.settings.fontset !== 'webapp') return;
    let cancelled = false;
    // 换了工程：预览区已被项目管理页卸掉，渲染器没有上一版可以打差，增量产物会让它崩（reflexo 的 module unwrap），整个重编
    // 字体表换了也整个重来：增量差分里的字形还指着旧字体，渲染器接不上
    const force = refresh !== lastRefresh.current || engineKey !== lastEngine.current || lastProject.current !== doc.id || fontsVersion !== lastFonts.current || engineGen !== lastGen.current;
    if (lastProject.current !== doc.id) { resetForProject(doc.id); useComments.getState().setActive(null); usePreviewSurface.getState().set({ activeKey: null, focused: false }); }
    const cs = useCompileState.getState();
    const pageCount = cs.pageCount;
    // 只编一章的条件：整编过、页数多、光标在正文的某一章里（预览里直接编辑也走这条：那份字形表是这一章自己的，并进整编那份用）
    const wantFull = fullTick !== lastFull.current;
    lastFull.current = fullTick;
    let focus: { id: string; chapter: number; start: number; baseCount: number; page: number } | null = null;
    if (!force && !wantFull && pageCount >= FOCUS_PAGES && cs.artifact) {
      const k = chapterAt(doc.body, getEditor('body'));
      const cp = k ? chapterPages(doc.body, cs.glyphs, cs.segments, cs.mapVersion, pageCount) : null;
      if (k && cp && cp.pages[k - 1] !== undefined) {
        const start = cp.pages[k - 1];
        const next = cp.pages[k] ?? cp.end;
        focus = { id: `${doc.id}:body:${k}:${cs.focusGen}`, chapter: k, start, baseCount: Math.max(0, next - start), page: start - cp.pages[0] + 1 };
      }
    }
    // 打字即时回显在跑（见下面那个 effect）：章级编译推后到停手 400 ms
    const para = focus && performance.now() < paraActiveUntil.current;
    if (focus) {
      // 停手一会儿再整编（校准页码、目录、跨章引用）
      window.clearTimeout(fullTimer.current);
      fullTimer.current = window.setTimeout(() => setFullTick((n) => n + 1), FULL_AFTER_IDLE);
    }
    const t = window.setTimeout(async () => {
      const project = serializeProject(doc, { preview: true, focus: focus ? { chapter: focus.chapter, page: focus.page } : undefined });
      // 换了项目：图片名字空间变了，worker 里映射的旧图全撤掉，重新发
      let stale: string[] = [];
      const nextSent = new Map(sent.current);
      if (lastProject.current !== doc.id || engineGen !== lastGen.current) {
        // 换了工程、或引擎重启过（新 worker 里什么图都没有）：全部重发
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
      lastFonts.current = fontsVersion;
      lastGen.current = engineGen;
      lastEngine.current = engineKey;
      lastFocusId.current = focus?.id ?? '';
      requestCompile({
        docId: doc.id,
        force,
        // 首次排版、小文档与预览直接编辑需要精确字形表。长文档在左侧连续输入时沿用旧表，
        // 避免每次击键都扫描约 200 页；位置映射会把旧表换算到当前文档。
        // 只编一章时那份字形表只有一章，便宜，每次都要
        glyphs: !!focus || force || previewFocused || wantFull || pageCount < 80,
        focus: focus ? { id: focus.id, start: focus.start, baseCount: focus.baseCount } : undefined,
        main: project.main,
        files: project.files,
        inputs: linebreaksInput(doc.settings) ? { linebreaks: linebreaksInput(doc.settings)! } : {},
        images,
        removeImages,
        segments: project.segments,
        version: docVersion(),
      });
    // 防抖按上一次编译的耗时来：编译在 worker 里，主线程不等它，排队的只留最新一份，所以不必等用户停手太久
    }, force ? 0 : para ? 400 : focus ? 150 : Math.min(600, Math.max(180, (useCompileState.getState().lastMs ?? 0) * 0.3)));
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [doc, loaded, status, fontsVersion, engineGen, refresh, restoring, previewFocused, composing, fullTick]);
  return sent;
}
/** 页数到了这个数才只编一章；停手这么久之后整编 */
const FOCUS_PAGES = 40;
const FULL_AFTER_IDLE = 2500;

function download(name: string, data: BlobPart, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function App() {
  const { doc, section, loaded, view, setView, setSection, load, setImages } = useStore();
  const compile = useCompileState();
  const [refresh, setRefresh] = useState(0);
  const previewFocused = usePreviewSurface((s) => s.focused);
  const composing = useInputState((s) => s.composing);
  useAutoCompile(doc, loaded && view === 'editor', refresh, previewFocused, composing);
  const [busy, setBusy] = useState<string | null>(null);
  const [theme, themePref, setThemePref] = useTheme();
  const { navOpen, setNavOpen, mode, setMode, ratio, startDrag, mainRef, gridColumns, gridRows, compact, stacked } = useLayoutPrefs();
  // 设置类页面的表单：容器变窄、行折行、行增减时各元素滑到新位置
  const reflowStop = useRef<(() => void) | null>(null);
  const reflowRef = useCallback((el: HTMLDivElement | null) => { reflowStop.current?.(); reflowStop.current = el && !el.querySelector('.editor') ? watchReflow(el, '.card, .card > *, .triseg > *, .axis > *') : null; }, []);
  const lastSection = useRef(section);
  useEffect(() => {
    if (lastSection.current !== section && mode === 'preview' && ['info', 'settings', 'cover', 'titlepage', 'toc', 'bibliography', 'achievements', 'nomenclature', 'defense', 'index'].includes(section)) setMode('split');
    lastSection.current = section;
  }, [section, mode, setMode]);
  const hasDocument = loaded && useStore.getState().projects.some((p) => p.id === doc.id);
  const commentsOpen = useComments((s) => s.open);
  const [about, setAbout] = useState(false);
  const outlineFolded = useOutline((s) => s.folded);

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
  const onExportDocx = async () => {
    setBusy(tx("正在生成 Word 文档…"));
    try {
      const { buildDocx } = await import('../export/docx/build');
      const blob = await buildDocx(doc);
      download(`${doc.info.title.split('\n')[0] || tx("论文")}.docx`, blob, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    } catch (e) { alert(tx("生成 Word 文档失败：") + String((e as Error)?.message ?? e)); }
    finally { setBusy(null); }
  };
  const onExportTypst = () => {
    const project = serializeProject(doc);
    download('main.typ', project.main, 'text/plain');
    for (const [name, text] of Object.entries(project.files)) download(name, text, 'text/plain');
  };

  const panel = (() => {
    switch (section) {
      case 'settings': return <SettingsPanel />;
      case 'info': return <InfoPanel />;
      case 'cover': return <CoverPanel />;
      case 'titlepage': return <TitlepagePanel />;
      case 'toc': return <TocPanel />;
      case 'abstract': return <AbstractPanel />;
      case 'nomenclature': return <NomenclaturePanel />;
      case 'body': return <RichSection title={tx("正文")} richKey="body" headings placeholder={tx("输入正文…")} settings={<BodySettings />} />;
      case 'conclusion': return <RichSection title={tx("结论")} richKey="conclusion" headings={false} extra={<div className="card"><OpenrightSwitch orKey="conclusion" label={tx("右手页起")} /></div>} />;
      case 'bibliography': return <BibPanel which="bibliography" />;
      case 'appendix': return <RichSection title={tx("附录")} richKey="appendix" headings placeholder={tx("输入附录…")} settings={<><PageSettings pages={['appendix']}><SettingSwitch k="appendixNumbering" /></PageSettings><p className="lead">{tx("题注编号、标题、列表那几组开关正文与附录共用，在「正文 → 设置」里。")}</p></>} />;
      case 'achievements': return <BibPanel which="achievements" />;
      case 'defense': return <DefensePanel />;
      case 'acknowledgement': return <RichSection title={tx("致谢")} richKey="acknowledgement" headings={false} blocks={false} extra={<div className="card"><OpenrightSwitch orKey="acknowledgement" label={tx("右手页起")} /></div>} />;
      case 'index': return <IndexPanel />;
      case 'resume': return <RichSection title={tx("个人简历")} richKey="resume" headings={false} blocks={false} extra={<PageSettings pages={['resume']} />} />;
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
                  <MenuItem icon={<Save20Regular />} disabled={!hasDocument} onClick={onSaveProject}>{tx("下载副本（.iota.json）")}</MenuItem>
                  <MenuDivider />
                  <MenuItem icon={<DocumentPdf20Regular />} disabled={!hasDocument || compile.status !== 'ready' || !!busy} onClick={() => void onExportPdf()}>{tx("导出 PDF")}</MenuItem>
                  <MenuItem icon={<Document20Regular />} disabled={!hasDocument} onClick={onExportTypst}>{tx("导出 Typst 源文件")}</MenuItem>
                  <MenuItem icon={<Document20Regular />} disabled={!hasDocument} onClick={() => void onExportDocx()}>{tx("导出 Word 文档（.docx）")}</MenuItem>
                </MenuList>
              </MenuPopover>
            </Menu>
            {view === 'editor' && (
              <Tooltip content={tx("主页")} relationship="label" withArrow positioning="below">
                <Button appearance="subtle" size="small" className="rb-btn" icon={<Home20Regular />} onMouseDown={(e) => e.preventDefault()} onClick={() => setView('projects')} />
              </Tooltip>
            )}
            {view === 'editor' && <HistoryButtons />}
          </span>
        ); const trailing = (
          <span className="rb-trailing">
            {view === 'editor' && <span className="status"><i className={`dot ${dot}`} /><span key={statusText} className="status-text">{statusText}</span></span>}

            <Menu positioning="below-end" checkedValues={{ theme: [themePref] }} onCheckedValueChange={(_, d) => setThemePref((d.checkedItems[0] ?? 'system') as ThemePref)}>
              <MenuTrigger disableButtonEnhancement>
                <Tooltip content={tx("外观：浅色 / 深色 / 跟随系统")} relationship="label" positioning="below">
                  <Button appearance="subtle" size="small" className="theme-btn rb-menu" icon={theme === 'dark' ? <WeatherMoon20Regular /> : <WeatherSunny20Regular />} />
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
          <nav className={`nav ${compact ? 'is-overlay' : ''}`} hidden={compact && !navOpen} inert={!navOpen} onClick={(e) => { if (compact && (e.target as HTMLElement).closest('button:not(.outline-item)')) setNavOpen(false); }}>
            <div className="nav-inner">
            {compact && <button type="button" className="nav-collapse" title={tx("收起左侧导航")} aria-label={tx("收起左侧导航")} onClick={() => setNavOpen(false)}><ChevronLeft20Regular /></button>}
            {[tx("设置"), tx("前置"), tx("主体"), tx("后置")].map((g) => (
              <div key={g}>
                <h4>{GROUP_ICON[g]}{g}</h4>
                {NAV.filter((n) => n.group === g).map((n) => {
                  const off = loaded && ((n.key === 'titlepage' && !resolvePage(doc, 'titlepage').value) || (n.key === 'abstract' && !resolvePage(doc, 'abstract').value) || (n.key === 'nomenclature' && !resolvePage(doc, 'symbolsPage').value && !resolvePage(doc, 'abbreviationsPage').value) || (n.key === 'appendix' && !resolvePage(doc, 'appendix').value) || (n.key === 'achievements' && !resolvePage(doc, 'achievements').value) || (n.key === 'defense' && !resolvePage(doc, 'defense').value) || (n.key === 'resume' && !resolvePage(doc, 'resume').value) || (n.key === 'index' && !resolvePage(doc, 'index').value));
                  const btn = <button key={n.key} type="button" className={`${section === n.key ? 'on' : ''} ${off ? 'off' : ''}`} aria-current={section === n.key ? 'page' : undefined} onClick={() => { setSection(n.key); if (mode === 'preview') setMode('split'); }}>{n.label}{off && <span className="k">{tx("不显示")}</span>}</button>;
                  // 正文与附录底下常驻大纲（Word 的导航窗格），可收起
                  if (n.key !== 'body' && n.key !== 'appendix') return btn;
                  const folded = !!outlineFolded[n.key];
                  return (
                    <div key={n.key} className="nav-with-outline">
                      <div className="nav-row">{btn}<Fold className="outline-fold" open={!folded} title={folded ? tx("展开大纲") : tx("收起大纲")} onClick={() => useOutline.getState().toggle(n.key)} /></div>
                      <div className={`outline-wrap ${folded ? 'is-folded' : ''}`} inert={folded}><div className="outline-wrap-inner"><OutlinePane richKey={n.key as 'body' | 'appendix'} onJump={() => { if (section !== n.key) setSection(n.key); if (mode === 'preview') setMode('split'); }} /></div></div>
                    </div>
                  );
                })}
              </div>
            ))}
            </div>
          </nav>
          {!compact && <Fold className="nav-toggle" open={navOpen} title={navOpen ? tx("收起左侧导航") : tx("展开左侧导航")} onClick={() => setNavOpen(!navOpen)} />}
          <section className={`work ${commentsOpen ? 'has-comments' : ''}`} hidden={mode === 'preview'}>
            {loaded ? <div className="work-inner" key={`${doc.id}:${section}`} ref={reflowRef}>{panel}</div> : <div className="muted">{tx("正在打开文档…")}</div>}
            {commentsOpen && loaded && <CommentsPane />}
          </section>
          <LinkDialogHost />
          <Dialog open={about} onOpenChange={(_, d) => setAbout(d.open)}>
            <DialogSurface className="style-dialog">
              <DialogBody>
                <DialogTitle><span className="about-title"><Logo size={40} />iota-hit</span></DialogTitle>
                <DialogContent>
                  <p>{tx("哈尔滨工业大学学位论文在线编辑器。文档使用 iota-hit 模板排版；预览引擎基于 Typst 0.15.1，并加入接近 Microsoft Word 的中文断行规则。所有排版均在浏览器中完成。")}</p>
                  <p>{tx("字体：Noto Serif / Sans CJK SC、FandolKai、TeX Gyre Termes / Heros、DejaVu Sans Mono；也可读本机字体切到 Windows / macOS 档。")}</p>
                  <p className="muted">{tx("文档和图片保存在当前浏览器中。请定期通过“文件 → 下载副本”备份。")}</p>
                  <p className="muted">{tx("导出 Word 时的参考文献由 citeproc-js（Frank Bennett，CPAL 许可）按 GB/T 7714 排版。")}</p>
                  <p className="muted">{tx("Typst 是 Typst GmbH 的商标；本站与 Typst GmbH、typst.ts 及各项目作者无关。随站分发的软件、字体、Typst 包的版权与许可证全文见")}<a href={`${import.meta.env.BASE_URL}licenses.txt`} target="_blank" rel="noopener">{tx("开源许可与声明")}</a>{tx("。")}</p>
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
