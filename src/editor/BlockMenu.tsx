// 右键一段 / 一条标题弹出的块级菜单（Word 右键里的「段落」「样式」那一组），
// 以及「修改样式」对话框。编辑区与预览区都能唤出，命令作用于同一份编辑器。
//
// 模板的口子只有两层：单条标题能改的是 #chapter(numbering:, openright:, spread:) 这几个
// 参数；字体、字号、对齐、行距、段前段后是*一级一条*的样式表（iota-hit(styles:)），
// 改了就是这一级所有标题一起变——这正是 Word「修改样式」的语义，也是模板刻意
// 不给单条标题开字体口子的原因（局部 styles 只接表格）。
import { useMemo, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import {
  Menu, MenuTrigger, MenuPopover, MenuList, MenuItem, MenuItemRadio, MenuItemCheckbox, MenuDivider, MenuGroup, MenuGroupHeader,
  Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions, DialogTrigger, Button, Dropdown, Option, Input, Label,
} from '@fluentui/react-components';
import { TextHeader120Regular, TextAlignLeft20Regular, TextParagraph20Regular, TextEditStyle20Regular, Translate20Regular, DocumentPageBreak20Regular, Dismiss20Regular } from '@fluentui/react-icons';
import { getEditor } from './registry';
import { useStore, type RichKey } from '../model/store';
import type { Settings, StyleEntry, StyleKey } from '../model/types';
import { levelLabels, styleKeyOfLevel } from '../typst/numbering';

interface MenuReq { key: RichKey; pos: number; x: number; y: number; nonce: number }
interface State {
  req: MenuReq | null;
  open: (r: Omit<MenuReq, 'nonce'>) => void;
  close: () => void;
  /** 「修改样式」对话框开着的那一级：0 = 正文，1–4 = 标题级别 */
  styleLevel: number | null;
  openStyle: (level: number) => void;
  closeStyle: () => void;
}
export const useBlockMenu = create<State>((set) => ({
  req: null,
  open: (r) => set({ req: { ...r, nonce: Date.now() } }),
  close: () => set({ req: null }),
  styleLevel: null,
  openStyle: (level) => set({ styleLevel: level, req: null }),
  closeStyle: () => set({ styleLevel: null }),
}));

const ZIHAO: { key: string; label: string; pt: number }[] = [
  { key: 'chuhao', label: '初号', pt: 42 }, { key: 'xiaochu', label: '小初', pt: 36 },
  { key: 'yihao', label: '一号', pt: 26 }, { key: 'xiaoyi', label: '小一', pt: 24 },
  { key: 'erhao', label: '二号', pt: 22 }, { key: 'xiaoer', label: '小二', pt: 18 },
  { key: 'sanhao', label: '三号', pt: 16 }, { key: 'xiaosan', label: '小三', pt: 15 },
  { key: 'sihao', label: '四号', pt: 14 }, { key: 'xiaosi', label: '小四', pt: 12 },
  { key: 'wuhao', label: '五号', pt: 10.5 }, { key: 'xiaowu', label: '小五', pt: 9 },
  { key: 'liuhao', label: '六号', pt: 7.5 }, { key: 'xiaoliu', label: '小六', pt: 6.5 },
];
const FONTS: { key: string; label: string }[] = [
  { key: 'songti', label: '宋体' }, { key: 'heiti', label: '黑体' }, { key: 'kaishu', label: '楷体' },
  { key: 'fangsong', label: '仿宋' }, { key: 'lishu', label: '隶书' }, { key: 'xinwei', label: '新魏' }, { key: 'kaishu-gb2312', label: '楷体_GB2312' },
];
const ALIGNS = [{ key: 'left', label: '左对齐' }, { key: 'center', label: '居中' }, { key: 'right', label: '右对齐' }] as const;
/** 模板默认（终稿档），做占位提示；报告档的行距略有不同，以预览为准 */
const TEMPLATE_DEFAULTS: Record<StyleKey, string> = {
  body: '宋体 · 小四 · 1.25 倍行距 · 两端对齐 · 首行缩进两字',
  chapter: '黑体 · 小二 · 居中 · 1.25 倍 · 段前 1 行 · 段后 0.8 行 · 字距 −0.4pt',
  section: '黑体 · 小三 · 左 · 1.25 倍 · 段前 0.5 行 · 段后 0.5 行',
  subsection: '黑体 · 四号 · 左 · 1.25 倍 · 段前 0.5 行 · 段后 0.5 行',
  subsubsection: '黑体 · 小四 · 左 · 1.25 倍',
};

/** 这一级叫什么：0 = 正文，其余按档位（章 / 节 / 条 / 款，报告从节起） */
function levelName(s: Settings, level: number): string {
  if (level === 0) return '正文';
  const l = levelLabels(s).find((x) => x.level === level);
  return l?.name ? `${l.name}标题` : `${level} 级标题`;
}

/** 块级菜单 + 样式对话框，挂在 App 里（FluentProvider 之内）一份 */
export function BlockMenu() {
  const req = useBlockMenu((s) => s.req);
  const close = useBlockMenu((s) => s.close);
  const openStyle = useBlockMenu((s) => s.openStyle);
  const styleLevel = useBlockMenu((s) => s.styleLevel);
  const settings = useStore((s) => s.doc.settings);
  // 每次弹出重新读一遍节点（nonce 变了就重读）
  const info = useMemo(() => {
    if (!req) return null;
    const ed = getEditor(req.key);
    const node = ed?.state.doc.nodeAt(req.pos);
    if (!ed || !node || (node.type.name !== 'heading' && node.type.name !== 'paragraph')) return null;
    const headingsAllowed = !!ed.schema.nodes.heading;
    return { ed, node, headingsAllowed };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req?.nonce]);
  const labels = levelLabels(settings);
  const isHeading = info?.node.type.name === 'heading';
  const level: number = isHeading ? info!.node.attrs.level : 0;

  const setLevel = (l: number) => {
    if (!info || !req) return;
    const chain = info.ed.chain().focus().setTextSelection(req.pos + 1);
    if (l === 0) chain.setParagraph().run(); else chain.setHeading({ level: l as 1 | 2 | 3 | 4 }).run();
  };
  const patchAttrs = (patch: Record<string, unknown>) => {
    if (!info || !req) return;
    const { ed, node } = info;
    ed.view.dispatch(ed.state.tr.setNodeMarkup(req.pos, undefined, { ...node.attrs, ...patch }));
  };
  const focusEn = () => {
    if (!info || !req) return;
    const dom = info.ed.view.nodeDOM(req.pos) as HTMLElement | null;
    window.setTimeout(() => dom?.querySelector<HTMLInputElement>('input[data-attr="en"]')?.focus(), 30);
  };
  const tri = (v: unknown): 'auto' | 'true' | 'false' => (v === true || v === 'true' ? 'true' : v === false || v === 'false' ? 'false' : 'auto');
  const checked: Record<string, string[]> = {
    level: [String(level)],
    opts: [...(isHeading && info!.node.attrs.numbered !== false ? ['numbered'] : []), ...(!isHeading && info?.node.attrs.noIndent ? ['noIndent'] : [])],
    openright: [tri(info?.node.attrs.openright)],
    spread: [tri(info?.node.attrs.spread)],
  };

  return (
    <>
      <Menu open={!!req && !!info} onOpenChange={(_, d) => { if (!d.open) close(); }} checkedValues={checked} positioning="below-start" hasIcons>
        <MenuTrigger disableButtonEnhancement>
          <span className="ctx-anchor" style={{ left: req?.x ?? 0, top: req?.y ?? 0 }} aria-hidden />
        </MenuTrigger>
        <MenuPopover className="ctx-menu">
          {info && (
            <MenuList>
              <MenuGroup>
                <MenuGroupHeader>{isHeading ? levelName(settings, level) : '段落'}</MenuGroupHeader>
                <MenuItemRadio name="level" value="0" icon={<TextParagraph20Regular />} onClick={() => setLevel(0)}>正文</MenuItemRadio>
                {info.headingsAllowed && labels.map((l) => (
                  <MenuItemRadio key={l.level} name="level" value={String(l.level)} icon={<TextHeader120Regular />} onClick={() => setLevel(l.level)}>
                    {l.name ? `${l.name}标题` : `${l.level} 级标题`} <span className="muted">· {l.sample}</span>
                  </MenuItemRadio>
                ))}
              </MenuGroup>
              <MenuDivider />
              {isHeading ? (
                <>
                  <MenuItemCheckbox name="opts" value="numbered" onClick={() => patchAttrs({ numbered: info.node.attrs.numbered === false })}>编号</MenuItemCheckbox>
                  <MenuItem icon={<Translate20Regular />} onClick={focusEn}>英文标题…</MenuItem>
                  {level === 1 && (
                    <>
                      <MenuDivider />
                      <MenuGroup>
                        <MenuGroupHeader>另起页（右手页起）</MenuGroupHeader>
                        {(['auto', 'true', 'false'] as const).map((v) => (
                          <MenuItemRadio key={v} name="openright" value={v} icon={v === 'auto' ? undefined : <DocumentPageBreak20Regular />} onClick={() => patchAttrs({ openright: v })}>{v === 'auto' ? 'Auto（跟文档设置）' : v === 'true' ? '是' : '否'}</MenuItemRadio>
                        ))}
                      </MenuGroup>
                      <MenuGroup>
                        <MenuGroupHeader>两字标题撑开（绪　论）</MenuGroupHeader>
                        {(['auto', 'true', 'false'] as const).map((v) => (
                          <MenuItemRadio key={v} name="spread" value={v} onClick={() => patchAttrs({ spread: v })}>{v === 'auto' ? 'Auto（跟文档设置）' : v === 'true' ? '撑开' : '不撑'}</MenuItemRadio>
                        ))}
                      </MenuGroup>
                    </>
                  )}
                </>
              ) : (
                <MenuItemCheckbox name="opts" value="noIndent" icon={<TextAlignLeft20Regular />} onClick={() => patchAttrs({ noIndent: !info.node.attrs.noIndent })}>这一段不首行缩进</MenuItemCheckbox>
              )}
              <MenuDivider />
              <MenuItem icon={<TextEditStyle20Regular />} onClick={() => openStyle(level)}>修改「{levelName(settings, level)}」样式…<span className="muted"> 全篇同级</span></MenuItem>
            </MenuList>
          )}
        </MenuPopover>
      </Menu>
      {styleLevel !== null && <StyleDialog level={styleLevel} />}
    </>
  );
}

/** 「修改样式」：Word 的字体对话框 + 段落对话框缩成一张，改的是模板样式表里这一级的那一条 */
function StyleDialog({ level }: { level: number }) {
  const closeStyle = useBlockMenu((s) => s.closeStyle);
  const settings = useStore((s) => s.doc.settings);
  const setSettings = useStore((s) => s.setSettings);
  const key: StyleKey = level === 0 ? 'body' : styleKeyOfLevel(settings, level);
  const [draft, setDraft] = useState<StyleEntry>(() => ({ ...(settings.styles?.[key] ?? {}) }));
  const set = (patch: Partial<StyleEntry>) => setDraft((d) => {
    const next = { ...d, ...patch };
    for (const k of Object.keys(next) as (keyof StyleEntry)[]) if (next[k] === undefined) delete next[k];
    return next;
  });
  const save = () => {
    const styles = { ...(settings.styles ?? {}) };
    if (Object.keys(draft).length) styles[key] = draft; else delete styles[key];
    setSettings({ styles });
    closeStyle();
  };
  const reset = () => setDraft({});
  const ls = draft.lineSpacing;
  const lsKey = ls === undefined ? 'auto' : typeof ls === 'number' ? String(ls) : 'exactly';
  const lsOptions = [['auto', 'Auto（模板）'], ['1', '单倍'], ['1.15', '1.15 倍'], ['1.25', '1.25 倍'], ['1.5', '1.5 倍'], ['2', '两倍'], ['exactly', '固定值…']] as const;
  const num = (v: string): number | undefined => { const n = parseFloat(v); return Number.isFinite(n) ? n : undefined; };
  const field = (label: string, control: ReactNode, hint?: string) => (
    <div className="style-field">
      <Label className="style-label">{label}</Label>
      <div className="style-control">{control}{hint && <small className="muted">{hint}</small>}</div>
    </div>
  );
  return (
    <Dialog open onOpenChange={(_, d) => { if (!d.open) closeStyle(); }}>
      <DialogSurface className="style-dialog">
        <DialogBody>
          <DialogTitle action={<DialogTrigger action="close"><Button appearance="subtle" icon={<Dismiss20Regular />} /></DialogTrigger>}>修改样式：{levelName(settings, level)}</DialogTitle>
          <DialogContent>
            <p className="muted style-hint">全篇同级一起变（与 Word 的「修改样式」一样）；留 Auto 的项按模板排。模板默认：{TEMPLATE_DEFAULTS[key]}</p>
            {field('中文字体', (
              <Dropdown size="small" value={FONTS.find((f) => f.key === draft.fontZh)?.label ?? 'Auto'} selectedOptions={[draft.fontZh ?? 'auto']} onOptionSelect={(_, d) => set({ fontZh: d.optionValue === 'auto' ? undefined : d.optionValue })}>
                <Option value="auto" text="Auto">Auto（模板）</Option>
                {FONTS.map((f) => <Option key={f.key} value={f.key} text={f.label}>{f.label}</Option>)}
              </Dropdown>
            ), '西文照模板的字体方案配（Times New Roman 一类）')}
            {field('字号', (
              <span className="style-row">
                <Dropdown size="small" value={typeof draft.size === 'number' ? `${draft.size} pt` : ZIHAO.find((z) => z.key === draft.size)?.label ?? 'Auto'} selectedOptions={[typeof draft.size === 'number' ? 'pt' : draft.size ?? 'auto']} onOptionSelect={(_, d) => set({ size: d.optionValue === 'auto' ? undefined : d.optionValue === 'pt' ? (typeof draft.size === 'number' ? draft.size : 12) : d.optionValue })}>
                  <Option value="auto" text="Auto">Auto（模板）</Option>
                  {ZIHAO.map((z) => <Option key={z.key} value={z.key} text={z.label}>{z.label} <span className="muted">{z.pt}pt</span></Option>)}
                  <Option value="pt" text="磅数…">磅数…</Option>
                </Dropdown>
                {typeof draft.size === 'number' && <Input size="small" type="number" step={0.5} min={5} max={72} value={String(draft.size)} onChange={(_, d) => { const n = num(d.value); if (n !== undefined) set({ size: n }); }} contentAfter="pt" style={{ width: 100 }} />}
              </span>
            ))}
            {field('加粗', (
              <Dropdown size="small" value={draft.bold === undefined ? 'Auto' : draft.bold ? '加粗' : '不加粗'} selectedOptions={[draft.bold === undefined ? 'auto' : String(draft.bold)]} onOptionSelect={(_, d) => set({ bold: d.optionValue === 'auto' ? undefined : d.optionValue === 'true' })}>
                <Option value="auto" text="Auto">Auto（模板）</Option>
                <Option value="true" text="加粗">加粗</Option>
                <Option value="false" text="不加粗">不加粗</Option>
              </Dropdown>
            ), '中文黑体本身够重，规范不要求加粗；宋体没有粗体面时按「伪粗」设置合成')}
            {field('对齐', (
              <Dropdown size="small" value={ALIGNS.find((a) => a.key === draft.align)?.label ?? 'Auto'} selectedOptions={[draft.align ?? 'auto']} onOptionSelect={(_, d) => set({ align: d.optionValue === 'auto' ? undefined : (d.optionValue as StyleEntry['align']) })}>
                <Option value="auto" text="Auto">Auto（模板）</Option>
                {ALIGNS.map((a) => <Option key={a.key} value={a.key} text={a.label}>{a.label}</Option>)}
              </Dropdown>
            ))}
            {field('行距', (
              <span className="style-row">
                <Dropdown size="small" value={lsOptions.find((o) => o[0] === lsKey)?.[1] ?? 'Auto'} selectedOptions={[lsKey]} onOptionSelect={(_, d) => { const v = d.optionValue!; set({ lineSpacing: v === 'auto' ? undefined : v === 'exactly' ? { exactly: typeof ls === 'object' && ls ? ls.exactly : 20 } : parseFloat(v) }); }}>
                  {lsOptions.map(([v, l]) => <Option key={v} value={v} text={l}>{l}</Option>)}
                </Dropdown>
                {typeof ls === 'object' && ls && <Input size="small" type="number" step={0.5} min={6} max={60} value={String(ls.exactly)} onChange={(_, d) => { const n = num(d.value); if (n !== undefined) set({ lineSpacing: { exactly: n } }); }} contentAfter="pt" style={{ width: 100 }} />}
              </span>
            ))}
            {field('段前 / 段后', (
              <span className="style-row">
                <Input size="small" type="number" step={0.5} min={0} max={10} placeholder="Auto" value={draft.above === undefined ? '' : String(draft.above)} onChange={(_, d) => set({ above: d.value === '' ? undefined : num(d.value) })} contentAfter="行" style={{ width: 110 }} />
                <Input size="small" type="number" step={0.5} min={0} max={10} placeholder="Auto" value={draft.below === undefined ? '' : String(draft.below)} onChange={(_, d) => set({ below: d.value === '' ? undefined : num(d.value) })} contentAfter="行" style={{ width: 110 }} />
              </span>
            ), 'Word 段落对话框的「段前 / 段后」，按行计；相邻两段取较大者')}
            {field('字符间距', (
              <Input size="small" type="number" step={0.1} min={-5} max={20} placeholder="Auto" value={draft.tracking === undefined ? '' : String(draft.tracking)} onChange={(_, d) => set({ tracking: d.value === '' ? undefined : num(d.value) })} contentAfter="pt" style={{ width: 110 }} />
            ), 'Word 字体对话框的「字符间距」，磅')}
            {key === 'body' && <p className="muted style-hint">首行缩进与两端对齐由模板按规范定，这里不开口子。</p>}
          </DialogContent>
          <DialogActions>
            <Button appearance="subtle" onClick={reset}>恢复模板默认</Button>
            <Button appearance="secondary" onClick={closeStyle}>取消</Button>
            <Button appearance="primary" onClick={save}>确定</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
