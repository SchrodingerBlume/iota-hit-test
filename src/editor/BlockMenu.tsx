// 段落快捷菜单与“修改样式”对话框。标题样式按级别保存，修改后应用于全文同级标题。
import { ZIHAO } from '../model/zihao';
import { useMemo, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import {
  Menu, MenuTrigger, MenuPopover, MenuList, MenuItem, MenuItemRadio, MenuItemCheckbox, MenuDivider, MenuGroup, MenuGroupHeader,
  Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions, DialogTrigger, Button, Dropdown, Option, Input, Label,
} from '@fluentui/react-components';
import { TextHeader120Regular, TextAlignLeft20Regular, TextParagraph20Regular, TextEditStyle20Regular, Translate20Regular, DocumentPageBreak20Regular, Dismiss20Regular, TableStackAbove20Regular, TableStackBelow20Regular, TableStackLeft20Regular, TableStackRight20Regular, TableDeleteRow20Regular, TableDeleteColumn20Regular, TableCellsMerge20Regular, TableCellsSplit20Regular, TableDismiss20Regular } from '@fluentui/react-icons';
import { getEditor } from './registry';
import { useStore, type RichKey } from '../model/store';
import type { Settings, StyleEntry, StyleKey } from '../model/types';
import { levelLabels, styleKeyOfLevel } from '../typst/numbering';
import { LengthInput } from '../ui/LengthInput';
import { ABS_UNITS, type Unit } from '../model/length';
import { t } from '../i18n';
const GAP_UNITS: Unit[] = ['lines', 'pt', 'em', 'mm', 'cm'];

interface MenuReq { key: RichKey; pos: number; x: number; y: number; nonce: number }
interface State {
  req: MenuReq | null;
  open: (r: Omit<MenuReq, 'nonce'>) => void;
  close: () => void;
  /** “修改样式”对话框当前编辑的级别：0 为正文，1—4 为标题。 */
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

const FONTS: { key: string; label: string }[] = [
  { key: 'songti', label: t("宋体") }, { key: 'heiti', label: t("黑体") }, { key: 'kaishu', label: t("楷体") },
  { key: 'fangsong', label: t("仿宋") }, { key: 'lishu', label: t("隶书") }, { key: 'xinwei', label: t("新魏") }, { key: 'kaishu-gb2312', label: t("楷体_GB2312") },
];
const ALIGNS = [{ key: 'left', label: t("左对齐") }, { key: 'center', label: t("居中") }, { key: 'right', label: t("右对齐") }] as const;
/** 模板默认（终稿档），做占位提示；报告档的行距略有不同，以预览为准 */
const TEMPLATE_DEFAULTS: Record<StyleKey, string> = {
  body: t("宋体 · 小四 · 1.25 倍行距 · 两端对齐 · 首行缩进两字"),
  chapter: t("黑体 · 小二 · 居中 · 1.25 倍 · 段前 1 行 · 段后 0.8 行 · 字距 −0.4pt"),
  section: t("黑体 · 小三 · 左 · 1.25 倍 · 段前 0.5 行 · 段后 0.5 行"),
  subsection: t("黑体 · 四号 · 左 · 1.25 倍 · 段前 0.5 行 · 段后 0.5 行"),
  subsubsection: t("黑体 · 小四 · 左 · 1.25 倍"),
  toc: t("宋体 · 小四 · 行距按学位（本科 1.25、研究生 1.2）"),
};

/** 这一级叫什么：0 = 正文，其余按档位（章 / 节 / 条 / 款，报告从节起） */
function levelName(s: Settings, level: number, part: 'body' | 'appendix' = 'body'): string {
  if (level === 0) return t("正文");
  if (level === -1) return t("目录");
  const l = levelLabels(s, part).find((x) => x.level === level);
  return l?.name ? t("{{name}}标题", { name: l.name }) : t("{{level}} 级标题", { level: level });
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
    // 点在表格里：多一组行列命令
    const $s = ed.state.selection.$from;
    let inTable = false;
    for (let d = $s.depth; d > 0; d--) if ($s.node(d).type.name === 'table') { inTable = true; break; }
    return { ed, node, headingsAllowed, inTable };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req?.nonce]);
  const part = req?.key === 'appendix' ? 'appendix' : 'body';
  const labels = levelLabels(settings, part);
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
                <MenuGroupHeader>{isHeading ? levelName(settings, level, part) : t("段落")}</MenuGroupHeader>
                <MenuItemRadio name="level" value="0" icon={<TextParagraph20Regular />} onClick={() => setLevel(0)}>{t("正文")}</MenuItemRadio>
                {info.headingsAllowed && labels.map((l) => (
                  <MenuItemRadio key={l.level} name="level" value={String(l.level)} icon={<TextHeader120Regular />} onClick={() => setLevel(l.level)}>
                    {l.name ? t("{{name}}标题", { name: l.name }) : t("{{level}} 级标题", { level: l.level })} <span className="muted">· {l.sample}</span>
                  </MenuItemRadio>
                ))}
              </MenuGroup>
              <MenuDivider />
              {isHeading ? (
                <>
                  <MenuItemCheckbox name="opts" value="numbered" onClick={() => patchAttrs({ numbered: info.node.attrs.numbered === false })}>{t("编号")}</MenuItemCheckbox>
                  <MenuItem icon={<Translate20Regular />} onClick={focusEn}>{t("英文标题…")}</MenuItem>
                  {level === 1 && (
                    <>
                      <MenuDivider />
                      <MenuGroup>
                        <MenuGroupHeader>{t("另起一页（从右手页开始）")}</MenuGroupHeader>
                        {(['auto', 'true', 'false'] as const).map((v) => (
                          <MenuItemRadio key={v} name="openright" value={v} icon={v === 'auto' ? undefined : <DocumentPageBreak20Regular />} onClick={() => patchAttrs({ openright: v })}>{v === 'auto' ? t("自动（使用文档设置）") : v === 'true' ? t("是") : t("否")}</MenuItemRadio>
                        ))}
                      </MenuGroup>
                      <MenuGroup>
                        <MenuGroupHeader>{t("两字标题分散对齐（绪　论）")}</MenuGroupHeader>
                        {(['auto', 'true', 'false'] as const).map((v) => (
                          <MenuItemRadio key={v} name="spread" value={v} onClick={() => patchAttrs({ spread: v })}>{v === 'auto' ? t("自动（使用文档设置）") : v === 'true' ? t("分散对齐") : t("不分散")}</MenuItemRadio>
                        ))}
                      </MenuGroup>
                    </>
                  )}
                </>
              ) : (
                <MenuItemCheckbox name="opts" value="noIndent" icon={<TextAlignLeft20Regular />} onClick={() => patchAttrs({ noIndent: !info.node.attrs.noIndent })}>{t("取消首行缩进")}</MenuItemCheckbox>
              )}
              {info.inTable && (
                <>
                  <MenuDivider />
                  <MenuGroup>
                    <MenuGroupHeader>{t("表格")}</MenuGroupHeader>
                    <MenuItem icon={<TableStackAbove20Regular />} onClick={() => info.ed.chain().focus().addRowBefore().run()}>{t("在上方插入行")}</MenuItem>
                    <MenuItem icon={<TableStackBelow20Regular />} onClick={() => info.ed.chain().focus().addRowAfter().run()}>{t("在下方插入行")}</MenuItem>
                    <MenuItem icon={<TableStackLeft20Regular />} onClick={() => info.ed.chain().focus().addColumnBefore().run()}>{t("在左侧插入列")}</MenuItem>
                    <MenuItem icon={<TableStackRight20Regular />} onClick={() => info.ed.chain().focus().addColumnAfter().run()}>{t("在右侧插入列")}</MenuItem>
                    <MenuItem icon={<TableDeleteRow20Regular />} onClick={() => info.ed.chain().focus().deleteRow().run()}>{t("删除行")}</MenuItem>
                    <MenuItem icon={<TableDeleteColumn20Regular />} onClick={() => info.ed.chain().focus().deleteColumn().run()}>{t("删除列")}</MenuItem>
                    <MenuItem icon={<TableCellsMerge20Regular />} disabled={!info.ed.can().mergeCells()} onClick={() => info.ed.chain().focus().mergeCells().run()}>{t("合并单元格")}</MenuItem>
                    <MenuItem icon={<TableCellsSplit20Regular />} disabled={!info.ed.can().splitCell()} onClick={() => info.ed.chain().focus().splitCell().run()}>{t("拆分单元格")}</MenuItem>
                    <MenuItem icon={<TableDismiss20Regular />} onClick={() => info.ed.chain().focus().deleteTable().run()}>{t("删除表格")}</MenuItem>
                  </MenuGroup>
                </>
              )}
              <MenuDivider />
              <MenuItem icon={<TextEditStyle20Regular />} onClick={() => openStyle(level)}>{t("修改「")}{levelName(settings, level, part)}{t("」样式…")}<span className="muted"> {' '}{t("应用于全文同级标题")}</span></MenuItem>
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
  const key: StyleKey = level === 0 ? 'body' : level === -1 ? 'toc' : styleKeyOfLevel(settings, level);
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
  const lsOptions = [['auto', t("自动")], ['1', t("单倍")], ['1.15', t("1.15 倍")], ['1.25', t("1.25 倍")], ['1.5', t("1.5 倍")], ['2', t("两倍")], ['multiple', t("多倍…")], ['exactly', t("固定值…")]] as const;
  const lsKey = ls === undefined ? 'auto' : typeof ls === 'number' ? (lsOptions.some((o) => o[0] === String(ls)) ? String(ls) : 'multiple') : 'exactly';
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
          <DialogTitle action={<DialogTrigger action="close"><Button appearance="subtle" icon={<Dismiss20Regular />} /></DialogTrigger>}>{t("修改样式：")}{levelName(settings, level)}</DialogTitle>
          <DialogContent>
            <p className="muted style-hint">{t("应用于全文同级样式")}{TEMPLATE_DEFAULTS[key]}</p>
            {field(t("中文字体"), (
              <Dropdown size="small" expandIcon={<i className="rb-caret" />} value={FONTS.find((f) => f.key === draft.fontZh)?.label ?? t("自动")} selectedOptions={[draft.fontZh ?? 'auto']} onOptionSelect={(_, d) => set({ fontZh: d.optionValue === 'auto' ? undefined : d.optionValue })}>
                <Option value="auto" text={t("自动")}>{t("自动")}</Option>
                {FONTS.map((f) => <Option key={f.key} value={f.key} text={f.label}>{f.label}</Option>)}
              </Dropdown>
            ), t("使用当前字体方案"))}
            {field(t("字号"), (
              <span className="style-row">
                <Dropdown size="small" expandIcon={<i className="rb-caret" />} value={typeof draft.size === 'number' ? `${draft.size} pt` : ZIHAO.find((z) => z.key === draft.size)?.label ?? t("自动")} selectedOptions={[typeof draft.size === 'number' ? 'pt' : draft.size ?? 'auto']} onOptionSelect={(_, d) => set({ size: d.optionValue === 'auto' ? undefined : d.optionValue === 'pt' ? (typeof draft.size === 'number' ? draft.size : 12) : d.optionValue })}>
                  <Option value="auto" text={t("自动")}>{t("自动")}</Option>
                  {ZIHAO.map((z) => <Option key={z.key} value={z.key} text={z.label}>{z.label} <span className="muted">{z.pt}pt</span></Option>)}
                  <Option value="pt" text={t("磅数…")}>{t("磅数…")}</Option>
                </Dropdown>
                {(typeof draft.size === 'number' || (typeof draft.size === 'string' && !/^[a-z]+$/.test(draft.size))) && <LengthInput value={draft.size} defaultUnit="pt" allowed={ABS_UNITS} allowEmpty={false} onChange={(v) => set({ size: v ?? 12 })} width={100} />}
              </span>
            ))}
            {field(t("加粗"), (
              <Dropdown size="small" expandIcon={<i className="rb-caret" />} value={draft.bold === undefined ? t("自动") : draft.bold ? t("加粗") : t("不加粗")} selectedOptions={[draft.bold === undefined ? 'auto' : String(draft.bold)]} onOptionSelect={(_, d) => set({ bold: d.optionValue === 'auto' ? undefined : d.optionValue === 'true' })}>
                <Option value="auto" text={t("自动")}>{t("自动")}</Option>
                <Option value="true" text={t("加粗")}>{t("加粗")}</Option>
                <Option value="false" text={t("不加粗")}>{t("不加粗")}</Option>
              </Dropdown>
            ), t("中文加粗"))}
            {field(t("对齐"), (
              <Dropdown size="small" expandIcon={<i className="rb-caret" />} value={ALIGNS.find((a) => a.key === draft.align)?.label ?? t("自动")} selectedOptions={[draft.align ?? 'auto']} onOptionSelect={(_, d) => set({ align: d.optionValue === 'auto' ? undefined : (d.optionValue as StyleEntry['align']) })}>
                <Option value="auto" text={t("自动")}>{t("自动")}</Option>
                {ALIGNS.map((a) => <Option key={a.key} value={a.key} text={a.label}>{a.label}</Option>)}
              </Dropdown>
            ))}
            {field(t("行距"), (
              <span className="style-row">
                <Dropdown size="small" expandIcon={<i className="rb-caret" />} value={lsOptions.find((o) => o[0] === lsKey)?.[1] ?? t("自动")} selectedOptions={[lsKey]} onOptionSelect={(_, d) => { const v = d.optionValue!; set({ lineSpacing: v === 'auto' ? undefined : v === 'exactly' ? { exactly: typeof ls === 'object' && ls ? ls.exactly : 20 } : v === 'multiple' ? (typeof ls === 'number' ? ls : 1.3) : parseFloat(v) }); }}>
                  {lsOptions.map(([v, l]) => <Option key={v} value={v} text={l}>{l}</Option>)}
                </Dropdown>
                {typeof ls === 'object' && ls && <LengthInput value={ls.exactly} defaultUnit="pt" allowed={ABS_UNITS} allowEmpty={false} onChange={(v) => set({ lineSpacing: { exactly: v ?? 20 } })} width={100} />}
                {lsKey === 'multiple' && <Input size="small" type="number" step={0.05} min={0.5} max={5} value={String(ls)} onChange={(_, d) => { const n = parseFloat(d.value); if (Number.isFinite(n) && n > 0) set({ lineSpacing: n }); }} contentAfter={t("倍")} style={{ width: 100 }} />}
              </span>
            ))}
            {field(t("段前 / 段后"), (
              <span className="style-row">
                <LengthInput value={draft.above ?? ''} defaultUnit="lines" allowed={GAP_UNITS} placeholder={t("段前：自动")} onChange={(v) => set({ above: v })} width={120} />
                <LengthInput value={draft.below ?? ''} defaultUnit="lines" allowed={GAP_UNITS} placeholder={t("段后：自动")} onChange={(v) => set({ below: v })} width={120} />
              </span>
            ), t("段前和段后"))}
            {field(t("字符间距"), (
              <LengthInput value={draft.tracking ?? ''} defaultUnit="pt" allowed={ABS_UNITS} placeholder="Auto" onChange={(v) => set({ tracking: v })} width={110} />
            ), t("字符间距"))}
            {key === 'body' && <p className="muted style-hint">{t("首行缩进和两端对齐使用当前论文模板。")}</p>}
          </DialogContent>
          <DialogActions>
            <Button appearance="subtle" onClick={reset}>{t("恢复模板默认")}</Button>
            <Button appearance="secondary" onClick={closeStyle}>{t("取消")}</Button>
            <Button appearance="primary" onClick={save}>{t("确定")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
