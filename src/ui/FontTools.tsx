// 开始页字体组里 Word 有的那几件：字体、字号、增大 / 减小字号、字体颜色。
// 都落到模板的接口——四个中文字族、zihao 字号表；颜色是 Typst 的 text(fill:)
import { useState } from 'react';
import type { Editor } from '@tiptap/core';
import { Dropdown, Option, Popover, PopoverTrigger, PopoverSurface, Tooltip, Button } from '@fluentui/react-components';
import { TextColor20Regular, FontIncrease20Regular, FontDecrease20Regular } from '@fluentui/react-icons';
import { ZIHAO, INLINE_FONTS, BLOCK_SIZE, type FontRole } from '../model/zihao';
import { B, refocusPreviewAfter } from '../editor/tools';
import { t as tx } from '../i18n';

const caret = <i className="rb-caret" />;

/** 光标所在段落按模板默认是多大字 */
function blockSize(ed: Editor): string {
  const $p = ed.state.selection.$from;
  for (let d = $p.depth; d > 0; d--) { const n = $p.node(d); if (n.type.name === 'heading') return BLOCK_SIZE[`h${n.attrs.level}`] ?? 'xiaosi'; }
  return BLOCK_SIZE.paragraph;
}

export function FontFamilyPicker({ ed }: { ed: Editor | null }) {
  const role: FontRole | undefined = ed?.getAttributes('fontFamily').role;
  const cur = INLINE_FONTS.find((f) => f.key === role);
  return (
    <Tooltip content={tx("中文字体")} relationship="description" positioning="below" withArrow>
      <Dropdown size="small" className="rb-font" expandIcon={caret} disabled={!ed} value={cur?.label ?? tx("默认")} selectedOptions={[role ?? 'auto']}
        onOptionSelect={(_, d) => refocusPreviewAfter(() => { const c = ed!.chain().focus(); (d.optionValue === 'auto' ? c.unsetFontFamily() : c.setFontFamily(d.optionValue as FontRole)).run(); })}>
        <Option value="auto" text={tx("默认")}>{tx("默认（使用样式）")}</Option>
        {INLINE_FONTS.map((f) => <Option key={f.key} value={f.key} text={f.label}><span data-font={f.key}>{f.label}</span></Option>)}
      </Dropdown>
    </Tooltip>
  );
}

export function FontSizePicker({ ed }: { ed: Editor | null }) {
  const size: string | undefined = ed?.getAttributes('fontSize').size;
  const cur = ZIHAO.find((z) => z.key === size);
  const base = ed ? blockSize(ed) : 'xiaosi';
  const set = (key: string) => refocusPreviewAfter(() => { const c = ed!.chain().focus(); (key === base ? c.unsetFontSize() : c.setFontSize(key)).run(); });
  const step = (dir: 1 | -1) => {
    const i = ZIHAO.findIndex((z) => z.key === (size ?? base));
    const next = ZIHAO[i - dir];
    if (next) set(next.key);
  };
  return (
    <>
      <Tooltip content={tx("字号采用模板的中文字号表（初号至小六）。")} relationship="description" positioning="below" withArrow>
        <Dropdown size="small" className="rb-size" expandIcon={caret} disabled={!ed} value={cur?.label ?? tx("默认")} selectedOptions={[size ?? 'auto']} onOptionSelect={(_, d) => (d.optionValue === 'auto' ? refocusPreviewAfter(() => ed!.chain().focus().unsetFontSize().run()) : set(d.optionValue!))}>
          <Option value="auto" text={tx("默认")}>{tx("默认（使用样式）")}</Option>
          {ZIHAO.map((z) => <Option key={z.key} value={z.key} text={z.label}>{z.label}<span className="muted"> {z.pt}pt</span></Option>)}
        </Dropdown>
      </Tooltip>
      <B title={tx("增大字号")} icon={<FontIncrease20Regular />} disabled={!ed} run={() => step(1)} />
      <B title={tx("减小字号")} icon={<FontDecrease20Regular />} disabled={!ed} run={() => step(-1)} />
    </>
  );
}

/** Word 的「标准色」那一排 */
const STANDARD = [['#c00000', tx("深红")], ['#ff0000', tx("红色")], ['#ffc000', tx("橙色")], ['#ffff00', tx("黄色")], ['#92d050', tx("浅绿")], ['#00b050', tx("绿色")], ['#00b0f0', tx("浅蓝")], ['#0070c0', tx("蓝色")], ['#002060', tx("深蓝")], ['#7030a0', tx("紫色")]] as const;

export function FontColorButton({ ed }: { ed: Editor | null }) {
  const [last, setLast] = useState('#ff0000');
  const [open, setOpen] = useState(false);
  const cur: string | undefined = ed?.getAttributes('textColor').color;
  const apply = (color: string | null) => { setOpen(false); refocusPreviewAfter(() => { const c = ed!.chain().focus(); (color ? c.setTextColor(color) : c.unsetTextColor()).run(); }); if (color) setLast(color); };
  return (
    <Popover open={open} onOpenChange={(_, d) => setOpen(d.open)} positioning="below-start" trapFocus={false}>
      <span className="rb-split">
        <Tooltip content={tx("字体颜色")} relationship="label" positioning="below" withArrow>
          <Button appearance="subtle" className="rb-btn rb-color" disabled={!ed} icon={<span className="rb-color-ico"><TextColor20Regular /><i style={{ background: cur ?? last }} /></span>} onMouseDown={(e) => e.preventDefault()} onClick={() => apply(last)} />
        </Tooltip>
        <PopoverTrigger disableButtonEnhancement>
          <Button appearance="subtle" className="rb-btn rb-menu" aria-label={tx("字体颜色")} disabled={!ed} onMouseDown={(e) => e.preventDefault()} />
        </PopoverTrigger>
      </span>
      <PopoverSurface className="pv-pop rb-colors">
        <button type="button" className={`pv-row ${cur ? '' : 'on'}`} onClick={() => apply(null)}><i className="pv-swatch" style={{ background: 'var(--ink)' }} />{tx("自动")}</button>
        <div className="pv-pop-sub">{tx("标准色")}</div>
        <div className="rb-color-grid">
          {STANDARD.map(([c, name]) => <button key={c} type="button" className={`rb-color-cell ${cur === c ? 'on' : ''}`} title={name} style={{ background: c }} onClick={() => apply(c)} />)}
        </div>
        <label className="pv-row">{tx("其他颜色…")}<input type="color" value={cur ?? last} onChange={(e) => apply(e.target.value)} /></label>
      </PopoverSurface>
    </Popover>
  );
}
