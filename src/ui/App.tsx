import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useStore, type Section } from '../model/store';
import type { ThesisDoc } from '../model/types';
import { startCompiler, requestCompile, requestPara, resetForProject, exportPdf, useCompileState, setFocusPlacer, LONG_DOC } from '../compiler/client';
import { serializeProject, serializePara, paraEligible, linebreaksInput } from '../typst/serialize';
import { chapterAt, chapterPages } from '../compiler/focus';
import { getEditor, onRegistryChange } from '../editor/registry';
import { BlockMenu } from '../editor/BlockMenu';
import { CommentsPane } from './CommentsPane';
import { AgentPane } from './AgentPane';
import { useAgent } from '../ai/state';
import { Logo } from './Logo';
import { OutlinePane, useOutline } from './OutlinePane';
import { LinkDialogHost } from './LinkDialog';
import { useComments } from '../editor/comments';
import { collectRefTargets } from '../typst/pmToTypst';
import { computeNumbering } from '../typst/numbering';
import { docVersion, versionOf } from '../editor/versions';
import { useInputState } from '../editor/inputState';
import { resolvePage } from '../model/pages';
import { EditorEnvContext, type EditorEnv } from '../editor/env';
import { imageBytes, putImage, safeImageName, imageDimensions } from '../editor/imageCache';
import { ProjectsView } from './ProjectsView';
import { FontRecovery } from './FontRecovery';
import { useFontState } from '../fonts/userFonts';
import { SettingsPanel } from './SettingsPanel';
import { InfoPanel, CoverPanel, TitlepagePanel } from './InfoPanel';
import { AbstractPanel, NomenclaturePanel, RichSection, BodySettings, BibPanel, DefensePanel, DeclarationsPanel, TocPanel, IndexPanel, PageSettings, OpenrightSwitch } from './panels';
import { Preview } from './Preview';
import { usePreviewSurface } from './PreviewEditLayer';
import { useTheme, type ThemePref } from './theme';
import { useLayoutPrefs } from './layout';
import { useMedia, PHONE } from './useMedia';
import { Ribbon, HistoryButtons } from './Ribbon';
import { FluentProvider, Menu, MenuTrigger, MenuPopover, MenuList, MenuItem, MenuItemRadio, MenuDivider, Button, Tooltip, Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions } from '@fluentui/react-components';
import { Fold } from './Fold';
import { SettingSwitch } from './TriSwitch';
import { watchReflow } from './reflow';
import { Home20Regular, Save20Regular, ArrowDownload20Regular, DocumentPdf20Regular, Document20Regular, Info20Regular, WeatherSunny20Regular, WeatherMoon20Regular, Navigation20Regular, ChevronLeft20Regular, BotSparkle20Regular, History20Regular, BranchFork20Regular } from '@fluentui/react-icons';
import { useHistoryDialog } from './HistoryDialog';
import { useGitDialog } from './GitDialog';
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
  { key: 'declarations', label: tx("声明"), group: tx("后置") },
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
  const lastReq = useRef<{ doc: ThesisDoc; key: { focus: string; glyphs: boolean } } | null>(null);
  // 只编一章落地时按当时的整编算它顶在哪几页（整编在后台跑，产物发出去之后章的起始页可能挪了）
  useEffect(() => {
    setFocusPlacer((k) => {
      const cs = useCompileState.getState();
      const cp = chapterPages(docRef.current.body, cs.glyphs, cs.segments, cs.mapVersion, cs.pageCount);
      if (!cp || cp.pages[k - 1] === undefined) return null;
      const start = cp.pages[k - 1];
      return { start, baseCount: Math.max(0, (cp.pages[k] ?? cp.end) - start) };
    });
    return () => setFocusPlacer(null);
  }, []);
  // 光标换到别的章：先把那一章编一遍暖着（前台那条道的缓存是按章的，冷的一章第一击要好几秒），停手时才编
  const [warmTick, setWarmTick] = useState(0);
  const warmChapter = useRef(0);
  useEffect(() => {
    if (!loaded) return;
    let ed = getEditor('body');
    const onSel = () => {
      const e = getEditor('body');
      const cs = useCompileState.getState();
      if (!e || e.isDestroyed || cs.status !== 'ready' || cs.pageCount < LONG_DOC || !cs.artifact) return;
      const k = chapterAt(docRef.current.body, e);
      if (!k || k === warmChapter.current) return;
      warmChapter.current = k;
      setWarmTick((n) => n + 1);
    };
    const attach = () => { ed?.off('selectionUpdate', onSel); ed = getEditor('body'); ed?.on('selectionUpdate', onSel); };
    attach();
    const off = onRegistryChange(attach);
    return () => { off(); ed?.off('selectionUpdate', onSel); };
  }, [loaded]);
  // 打字即时回显：直接听正文编辑器的事务（工程 JSON 要停 100 ms 才回灌），光标所在是纯文字段就先只编这一段（85 ms）
  useEffect(() => {
    if (!loaded) return;
    let ed = getEditor('body');
    const onTr = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (!transaction.docChanged) return;
      const e = getEditor('body');
      const cs = useCompileState.getState();
      if (!e || e.isDestroyed || cs.status !== 'ready' || cs.pageCount < LONG_DOC || !cs.artifact || useFontState.getState().restoring) return;
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
  // 排一次编译。*节流不是防抖*：连续打字时不重新计时，到点按当时最新的文档编（编译在 worker 里、队里只留最新一份），
  // 十几页的稿每个字都能上屏，几百页的按只编一章 / 只编一段那两条走；force / 整编要立刻发
  const compileTimer = useRef(0);
  useEffect(() => () => { window.clearTimeout(fullTimer.current); window.clearTimeout(compileTimer.current); }, []);
  const previewFocusedRef = useRef(previewFocused);
  previewFocusedRef.current = previewFocused;
  const fire = async (force: boolean, wantFull: boolean) => {
    const doc = docRef.current;
    const cs = useCompileState.getState();
    const pageCount = cs.pageCount;
    // 只编一章的条件：整编过、页数多、光标在正文的某一章里（预览里直接编辑也走这条：那份字形表是这一章自己的，并进整编那份用）
    let focus: { id: string; chapter: number; start: number; baseCount: number; page: number } | null = null;
    if (!force && !wantFull && pageCount >= LONG_DOC && cs.artifact) {
      const k = chapterAt(doc.body, getEditor('body'));
      const cp = k ? chapterPages(doc.body, cs.glyphs, cs.segments, cs.mapVersion, pageCount) : null;
      if (k && cp && cp.pages[k - 1] !== undefined) {
        const start = cp.pages[k - 1];
        const next = cp.pages[k] ?? cp.end;
        focus = { id: `${doc.id}:body:${k}:${cs.focusGen}`, chapter: k, start, baseCount: Math.max(0, next - start), page: start - cp.pages[0] + 1 };
        warmChapter.current = k;
      }
    }
    // 上一次真发出去的是哪份文档：没变的（光标换章的暖身编译）不必再排整编；文档、要编的范围、要不要字形表都没变
    // （字体恢复的开关翻一下、状态变一下这类）就一个字都不编——几百页的稿一次整编几秒，落地还要重排一遍预览
    const docChanged = lastReq.current?.doc !== doc;
    // 首次排版、小文档与预览直接编辑需要精确字形表。长文档在左侧连续输入时沿用旧表，避免每次击键都扫描约 200 页；
    // 位置映射会把旧表换算到当前文档。只编一章时那份字形表只有一章，便宜，每次都要
    const glyphs = !!focus || force || previewFocusedRef.current || wantFull || pageCount < 80;
    const reqKey = { focus: focus?.id ?? '', glyphs };
    // 少要一份字形表不是重编的理由
    if (!force && !wantFull && !docChanged && lastReq.current?.key.focus === reqKey.focus && (!glyphs || lastReq.current.key.glyphs)) return;
    // 这一份算发出去了（下面读图要等）：等的时候 effect 再跑一遍不会再发一份一样的
    lastReq.current = { doc, key: reqKey };
    if (focus && docChanged) {
      // 停手一会儿再整编（校准页码、目录、跨章引用）；整编在后台那条道上跑的话不挡打字，早点校准
      window.clearTimeout(fullTimer.current);
      fullTimer.current = window.setTimeout(() => setFullTick((n) => n + 1), cs.bgReady ? FULL_AFTER_IDLE_BG : FULL_AFTER_IDLE);
    }
    const project = serializeProject(doc, { preview: true, focus: focus ? { chapter: focus.chapter, page: focus.page } : undefined });
    // 换了项目：图片名字空间变了，worker 里映射的旧图全撤掉，重新发
    let stale: string[] = [];
    const nextSent = new Map(sent.current);
    const gen = useCompileState.getState().engineGen;
    if (lastProject.current !== doc.id || gen !== lastGen.current) {
      // 换了工程、或引擎重启过（新 worker 里什么图都没有）：全部重发
      stale = [...sent.current.keys()];
      nextSent.clear();
    }
    lastProject.current = doc.id;
    lastGen.current = gen;
    const images: { name: string; data: ArrayBuffer }[] = [];
    for (const name of project.images) {
      if (nextSent.has(name)) continue;
      const buf = await imageBytes(name);
      if (docRef.current.id !== doc.id) return;
      if (!buf) continue;
      images.push({ name, data: buf.slice(0) });
      nextSent.set(name, buf.byteLength);
    }
    const removeImages = [...new Set([...stale, ...[...nextSent.keys()].filter((n) => !project.images.includes(n))])].filter((n) => !images.some((i) => i.name === n));
    for (const n of removeImages) nextSent.delete(n);
    if (docRef.current.id !== doc.id) return;
    sent.current = nextSent;
    lastFocusId.current = focus?.id ?? '';
    requestCompile({
      docId: doc.id,
      force,
      glyphs,
      focus: focus ? { id: focus.id, chapter: focus.chapter, start: focus.start, baseCount: focus.baseCount } : undefined,
      main: project.main,
      files: project.files,
      inputs: linebreaksInput(doc.settings) ? { linebreaks: linebreaksInput(doc.settings)! } : {},
      images,
      removeImages,
      segments: project.segments,
      version: compiledVersion(doc),
    });
  };
  const fireRef = useRef(fire);
  fireRef.current = fire;
  useEffect(() => {
    if (!loaded || status !== 'ready' || composing) return;
    // 读 store 里的现值：引擎刚重启时 FontRecovery 的 effect 先跑、把 restoring 拨成 true，闭包里的还是旧的 false，
    // 按旧值就会先用替代字体编一遍、字体到了再编一遍——预览闪一下「字体丢了」
    if ((restoring || useFontState.getState().restoring) && doc.settings.fontset !== 'webapp') return;
    // 换了工程：预览区已被项目管理页卸掉，渲染器没有上一版可以打差，增量产物会让它崩（reflexo 的 module unwrap），整个重编
    // 字体表换了也整个重来：增量差分里的字形还指着旧字体，渲染器接不上
    const force = refresh !== lastRefresh.current || engineKey !== lastEngine.current || lastProject.current !== doc.id || fontsVersion !== lastFonts.current || engineGen !== lastGen.current;
    if (lastProject.current !== doc.id) { resetForProject(doc.id); useComments.getState().setActive(null); usePreviewSurface.getState().set({ activeKey: null, focused: false }); }
    lastRefresh.current = refresh;
    lastFonts.current = fontsVersion;
    lastEngine.current = engineKey;
    const wantFull = fullTick !== lastFull.current;
    lastFull.current = fullTick;
    // 已经排着一次：到点按最新的文档编，不重新计时（防抖会让连续打字期间一次都不编）
    if (compileTimer.current && !force && !wantFull) return;
    const cs = useCompileState.getState();
    const long = cs.pageCount >= LONG_DOC && !!cs.artifact;
    // 打字即时回显在跑（见上面那个 effect）：章级编译推后到停手 400 ms；长文档按只编一章的节奏，短文档按上一次耗时的三成
    const para = long && performance.now() < paraActiveUntil.current;
    const delay = force || wantFull ? 0 : para ? 400 : long ? 60 : Math.min(600, Math.max(30, (cs.lastMs ?? 0) * 0.3));
    window.clearTimeout(compileTimer.current);
    compileTimer.current = window.setTimeout(() => { compileTimer.current = 0; void fireRef.current(force, wantFull); }, delay);
  }, [doc, loaded, status, fontsVersion, engineGen, refresh, restoring, previewFocused, composing, fullTick, warmTick]);
  return sent;
}
/** 产物的版本 = 回灌进 store 的那份 JSON 截自哪一版（几份富文本里最新的那一份）；一份都没截过版（刚载入没改过）按现版 */
const RICH_KEYS = ['abstractZh', 'abstractEn', 'body', 'conclusion', 'appendix', 'acknowledgement', 'resume'] as const;
function compiledVersion(doc: ThesisDoc): number {
  const v = Math.max(-1, ...RICH_KEYS.map((k) => versionOf(doc[k] as object) ?? -1));
  return v < 0 ? docVersion() : v;
}
/** 停手这么久之后整编：整编与打字同一个 worker 时要等久些，在后台那条道上跑就早点 */
const FULL_AFTER_IDLE = 2500;
const FULL_AFTER_IDLE_BG = 1000;

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
  const { navOpen, setNavOpen, mode, setMode, ratio, startDrag, mainRef, gridColumns, gridRows, compact, stacked, agentOverlay } = useLayoutPrefs();
  const phone = useMedia(PHONE);
  // 设置类页面的表单：容器变窄、行折行、行增减时各元素滑到新位置
  const reflowStop = useRef<(() => void) | null>(null);
  const reflowRef = useCallback((el: HTMLDivElement | null) => { reflowStop.current?.(); reflowStop.current = el && !el.querySelector('.editor') ? watchReflow(el, '.card, .card > *, .triseg > *, .axis > *') : null; }, []);
  const lastSection = useRef(section);
  useEffect(() => {
    if (lastSection.current !== section && mode === 'preview' && ['info', 'settings', 'cover', 'titlepage', 'toc', 'bibliography', 'achievements', 'nomenclature', 'defense', 'declarations', 'index'].includes(section)) setMode('split');
    lastSection.current = section;
  }, [section, mode, setMode]);
  const hasDocument = loaded && useStore.getState().projects.some((p) => p.id === doc.id);
  const commentsOpen = useComments((s) => s.open);
  const agentOpen = useAgent((s) => s.open);
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
      else alert(tx("无法导出 PDF：") + r.diagnostics.map((d) => d.message).join('\n'));
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
    setBusy(tx("正在导出 Word 文档…"));
    try {
      const { buildDocx } = await import('../export/docx/build');
      const blob = await buildDocx(doc);
      download(`${doc.info.title.split('\n')[0] || tx("论文")}.docx`, blob, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    } catch (e) { alert(tx("无法导出 Word 文档：") + String((e as Error)?.message ?? e)); }
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
      case 'conclusion': return <RichSection title={tx("结论")} richKey="conclusion" headings={false} extra={<div className="card"><OpenrightSwitch orKey="conclusion" label={tx("从奇数页开始")} /></div>} />;
      case 'bibliography': return <BibPanel which="bibliography" />;
      case 'appendix': return <RichSection title={tx("附录")} richKey="appendix" headings placeholder={tx("输入附录…")} settings={<PageSettings pages={['appendix']}><SettingSwitch k="appendixNumbering" /></PageSettings>} />;
      case 'achievements': return <BibPanel which="achievements" />;
      case 'defense': return <DefensePanel />;
      case 'declarations': return <DeclarationsPanel />;
      case 'acknowledgement': return <RichSection title={tx("致谢")} richKey="acknowledgement" headings={false} blocks={false} extra={<div className="card"><OpenrightSwitch orKey="acknowledgement" label={tx("从奇数页开始")} /></div>} />;
      case 'index': return <IndexPanel />;
      case 'resume': return <RichSection title={tx("个人简历")} richKey="resume" headings={false} blocks={false} extra={<PageSettings pages={['resume']} />} />;
    }
  })();

  const dot = compile.status === 'error' ? 'err' : compile.status === 'booting' || compile.compiling || compile.bgCompiling ? 'busy' : 'ok';
  const statusText = compile.status === 'booting' ? tx("正在准备预览…") : compile.status === 'error' ? tx("预览不可用") : busy ?? (compile.compiling ? tx("正在更新预览…") : compile.bgCompiling ? tx("正在后台重排全文…") : compile.diagnostics.some((d) => d.severity === 'error') ? tx("排版失败") : compile.lastMs !== null ? tx("预览已更新（{{s}} 秒）", { s: (compile.lastMs / 1000).toFixed(1) }) : tx("预览已更新"));
  const GROUP_ICON: Record<string, React.ReactNode> = { 设置: <SlidersHorizontal />, 前置: <BookText />, 主体: <PenLine />, 后置: <Library /> };

  return (
    <EditorEnvContext.Provider value={env}>
      <FluentProvider theme={theme === 'dark' ? fluentDark : fluentLight} className="fluent-root">
      <FontRecovery />
      <div className="app" data-emph={doc.settings.emphKaishu === true ? 'kaishu' : 'italic'}>
        {/* 顶栏并进功能区那一行：左边照 Word 的快速访问工具栏——主页、保存、撤消 / 恢复、导出；右边状态、主题 */}
        {(() => { const canExportPdf = hasDocument && compile.status === 'ready' && !busy; const leading = (
          <span className="rb-leading">
            {view === 'editor' && (<>
              <Tooltip content={tx("返回主页")} relationship="label" withArrow positioning="below">
                <Button appearance="subtle" size="small" className="rb-btn" icon={<Home20Regular />} onMouseDown={(e) => e.preventDefault()} onClick={() => setView('projects')} />
              </Tooltip>
              <Tooltip content={tx("下载副本（.iota.json）")} relationship="label" withArrow positioning="below">
                <Button appearance="subtle" size="small" className="rb-btn" icon={<Save20Regular />} disabled={!hasDocument} onMouseDown={(e) => e.preventDefault()} onClick={() => void onSaveProject()} />
              </Tooltip>
              <Tooltip content={tx("本地历史：自动存的快照，看差异、整份恢复")} relationship="label" withArrow positioning="below">
                <Button appearance="subtle" size="small" className="rb-btn rb-adv" icon={<History20Regular />} disabled={!hasDocument} onMouseDown={(e) => e.preventDefault()} onClick={() => useHistoryDialog.getState().set(true)} />
              </Tooltip>
              <Tooltip content={tx("Git：有名称的提交、差异、恢复，连上 GitHub 能推能拉")} relationship="label" withArrow positioning="below">
                <Button appearance="subtle" size="small" className="rb-btn rb-adv" icon={<BranchFork20Regular />} disabled={!hasDocument} onMouseDown={(e) => e.preventDefault()} onClick={() => useGitDialog.getState().set(true)} />
              </Tooltip>
              <HistoryButtons />
              <Menu positioning="below-start">
                <span className="rb-split">
                  <Tooltip content={tx("导出 PDF")} relationship="label" withArrow positioning="below">
                    <Button appearance="subtle" size="small" className="rb-btn" icon={<ArrowDownload20Regular />} disabled={!canExportPdf} onMouseDown={(e) => e.preventDefault()} onClick={() => void onExportPdf()} />
                  </Tooltip>
                  <MenuTrigger disableButtonEnhancement>
                    <Button appearance="subtle" size="small" className="rb-btn rb-menu" aria-label={tx("其他导出格式")} disabled={!hasDocument} onMouseDown={(e) => e.preventDefault()} />
                  </MenuTrigger>
                </span>
                <MenuPopover>
                  <MenuList>
                    <MenuItem icon={<DocumentPdf20Regular />} disabled={!canExportPdf} onClick={() => void onExportPdf()}>{tx("导出 PDF")}</MenuItem>
                    <MenuItem icon={<Document20Regular />} disabled={!hasDocument} onClick={onExportTypst}>{tx("导出 Typst 源文件")}</MenuItem>
                    <MenuItem icon={<Document20Regular />} disabled={!hasDocument} onClick={() => void onExportDocx()}>{tx("导出 Word 文档（.docx）")}</MenuItem>
                    {/* 手机顶栏放不下本地历史与 Git 两颗钮，收进这个菜单 */}
                    {phone && (<>
                      <MenuDivider />
                      <MenuItem icon={<History20Regular />} disabled={!hasDocument} onClick={() => useHistoryDialog.getState().set(true)}>{tx("本地历史…")}</MenuItem>
                      <MenuItem icon={<BranchFork20Regular />} disabled={!hasDocument} onClick={() => useGitDialog.getState().set(true)}>{tx("Git…")}</MenuItem>
                    </>)}
                  </MenuList>
                </MenuPopover>
              </Menu>
            </>)}
          </span>
        ); const trailing = (
          <span className="rb-trailing">
            {view === 'editor' && <span className="status"><i className={`dot ${dot}`} /><span key={statusText} className="status-text">{statusText}</span></span>}
            {view === 'editor' && (
              <Tooltip content={tx("Agent：接你自己的模型，让它读、改这篇论文")} relationship="label" positioning="below">
                <Button appearance="subtle" size="small" className={`agent-btn ${agentOpen ? 'on' : ''}`} icon={<BotSparkle20Regular />} onClick={() => useAgent.getState().setOpen(!agentOpen)}>{phone ? undefined : 'Agent'}</Button>
              </Tooltip>
            )}

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
            <Menu positioning="below-end" checkedValues={{ theme: [themePref] }} onCheckedValueChange={(_, d) => setThemePref((d.checkedItems[0] ?? 'system') as ThemePref)}>
              <MenuTrigger disableButtonEnhancement>
                <button type="button" className="brand-btn" title={tx("iota4web · 关于")}><Logo size={30} /></button>
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  <MenuItem icon={<Info20Regular />} onClick={() => setAbout(true)}>{tx("关于 iota4web")}</MenuItem>
                  <MenuItem onClick={() => window.open('https://github.com/SchrodingerBlume/iota-hit-test', '_blank', 'noopener')}>GitHub</MenuItem>
                  {/* 手机顶栏放不下外观钮，挪到这里 */}
                  {phone && (<>
                    <MenuDivider />
                    <MenuItemRadio name="theme" value="light" icon={<WeatherSunny20Regular />}>{tx("浅色")}</MenuItemRadio>
                    <MenuItemRadio name="theme" value="dark" icon={<WeatherMoon20Regular />}>{tx("深色")}</MenuItemRadio>
                    <MenuItemRadio name="theme" value="system">{tx("跟随系统")}</MenuItemRadio>
                  </>)}
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
                  const off = loaded && ((n.key === 'titlepage' && !resolvePage(doc, 'titlepage').value) || (n.key === 'abstract' && !resolvePage(doc, 'abstract').value) || (n.key === 'nomenclature' && !resolvePage(doc, 'symbolsPage').value && !resolvePage(doc, 'abbreviationsPage').value) || (n.key === 'appendix' && !resolvePage(doc, 'appendix').value) || (n.key === 'achievements' && !resolvePage(doc, 'achievements').value) || (n.key === 'defense' && !resolvePage(doc, 'defense').value) || (n.key === 'declarations' && !resolvePage(doc, 'declarations').value) || (n.key === 'resume' && !resolvePage(doc, 'resume').value) || (n.key === 'index' && !resolvePage(doc, 'index').value));
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
          <section className="work" hidden={mode === 'preview'}>
            {/* 批注栏够宽才放右边，不够就叠到下面：按 .work 的宽（容器查询），不按窗口 */}
            <div className={`work-cols ${commentsOpen ? 'has-comments' : ''}`}>
              {loaded ? <div className="work-inner" key={`${doc.id}:${section}`} ref={reflowRef}>{panel}</div> : <div className="muted">{tx("正在打开文档…")}</div>}
              {commentsOpen && loaded && <CommentsPane />}
            </div>
          </section>
          <LinkDialogHost />
          <Dialog open={about} onOpenChange={(_, d) => setAbout(d.open)}>
            <DialogSurface className="style-dialog">
              <DialogBody>
                <DialogTitle><span className="about-title"><Logo size={40} />iota-hit</span></DialogTitle>
                <DialogContent>
                  <p>{tx("哈尔滨工业大学学位论文在线编辑器，使用 iota-hit 模板排版。预览引擎基于 Typst 0.15.1，并采用接近 Microsoft Word 的中文断行规则。全部排版均在浏览器中完成。")}</p>
                  <p>{tx("内置 Noto CJK、FandolKai、TeX Gyre 和 DejaVu Sans Mono 字体；也可读取本机字体并使用 Windows 或 macOS 字体方案。")}</p>
                  <p className="muted">{tx("文档和图片仅保存在当前浏览器中。请定期选择“文件 → 下载副本”进行备份。")}</p>
                  <p className="muted">{tx("导出 Word 时的参考文献由 citeproc-js（Frank Bennett，CPAL 许可）按 GB/T 7714 排版。")}</p>
                  <p className="muted">{tx("Typst 是 Typst GmbH 的商标；本站与 Typst GmbH、typst.ts 及各项目作者无关。随站分发的软件、字体、Typst 包的版权与许可证全文见")}<a href={`${import.meta.env.BASE_URL}licenses.txt`} target="_blank" rel="noopener">{tx("开源许可与声明")}</a>{tx("。")}</p>
                </DialogContent>
                <DialogActions><Button appearance="primary" onClick={() => setAbout(false)}>{tx("确定")}</Button></DialogActions>
              </DialogBody>
            </DialogSurface>
          </Dialog>
          {mode === 'split' && <div className="splitter" title={tx("拖动调整比例（{{v0}}% : {{v1}}%）", { v0: Math.round(ratio * 100), v1: Math.round((1 - ratio) * 100) })} onPointerDown={startDrag} />}
          <div className="preview-slot" hidden={mode === 'editor'}><Preview onRefresh={() => setRefresh((n) => n + 1)} refreshDisabled={!hasDocument} /></div>
          {agentOpen && loaded && <AgentPane overlay={agentOverlay} />}
          <BlockMenu />
        </div>
        {/* 手机：底部一条切换 编辑 / 分栏 / 预览 与目录抽屉，够不着功能区「视图」页时用 */}
        {compact && (
          <div className="mobile-bar" role="toolbar" style={{ '--i': mode === 'editor' ? 1 : mode === 'split' ? 2 : 3 } as CSSProperties}>
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
