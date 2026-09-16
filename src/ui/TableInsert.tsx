// 「插入表格」的二级菜单（Word 的样子）：拖格子选大小之外，还有「插入表格…」对话框（表格尺寸、
// 「自动调整」操作、为新表格记住此尺寸）与「从文本 / Markdown 插入…」（粘一段 GFM 表格、制表符或逗号分隔的行）。
import { useMemo, useState } from 'react';
import { Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions, DialogTrigger, Button, Input, Checkbox, Label, Textarea, RadioGroup, Radio } from '@fluentui/react-components';
import { Dismiss20Regular } from '@fluentui/react-icons';
import { parseTableText } from '../editor/tableImport';
import { LengthInput } from './LengthInput';

export type TableDialogKind = 'size' | 'text';
export type TableFit = 'content' | 'window' | 'fixed';
export interface TableDefaults { rows: number; cols: number; header: boolean; fit: TableFit; colWidth: number | string | 'auto' }

const DEFAULTS_KEY = 'iota4web-table-defaults';
export function readTableDefaults(): TableDefaults {
  const base: TableDefaults = { rows: 3, cols: 3, header: true, fit: 'content', colWidth: 'auto' };
  try { const v = JSON.parse(localStorage.getItem(DEFAULTS_KEY) ?? '{}'); return { ...base, ...v }; } catch { return base; }
}
function saveTableDefaults(d: TableDefaults) { try { localStorage.setItem(DEFAULTS_KEY, JSON.stringify(d)); } catch { /* */ } }

/** Word 的「插入表格」对话框：表格尺寸、“自动调整”操作、为新表格记住此尺寸 */
export function TableSizeDialog({ onInsert, onClose }: { onInsert: (rows: number, cols: number, header: boolean, fit: TableFit, colWidth: number | string) => void; onClose: () => void }) {
  const [d, setD] = useState<TableDefaults>(readTableDefaults);
  const [remember, setRemember] = useState(false);
  const set = (p: Partial<TableDefaults>) => setD((x) => ({ ...x, ...p }));
  const ok = d.rows >= 1 && d.rows <= 60 && d.cols >= 1 && d.cols <= 20;
  const submit = () => {
    if (remember) saveTableDefaults(d);
    // 固定列宽写「自动」= 与根据内容同义
    onInsert(d.rows, d.cols, d.header, d.fit === 'fixed' && d.colWidth === 'auto' ? 'content' : d.fit, d.colWidth === 'auto' ? 2.5 : d.colWidth);
  };
  return (
    <Dialog open onOpenChange={(_, ev) => { if (!ev.open) onClose(); }}>
      <DialogSurface className="style-dialog">
        <DialogBody>
          <DialogTitle action={<DialogTrigger action="close"><Button appearance="subtle" icon={<Dismiss20Regular />} /></DialogTrigger>}>插入表格</DialogTitle>
          <DialogContent>
            <fieldset className="dlg-fs">
              <legend>表格尺寸</legend>
              <div className="style-field"><Label className="style-label">列数</Label><Input type="number" min={1} max={20} value={String(d.cols)} onChange={(_, e) => set({ cols: Number(e.value) || 0 })} style={{ width: 120 }} autoFocus /></div>
              <div className="style-field"><Label className="style-label">行数</Label><Input type="number" min={1} max={60} value={String(d.rows)} onChange={(_, e) => set({ rows: Number(e.value) || 0 })} style={{ width: 120 }} /></div>
              <Checkbox label="第一行是表头（三线表的栏头，跨页时续页重排）" checked={d.header} onChange={(_, e) => set({ header: !!e.checked })} />
            </fieldset>
            <fieldset className="dlg-fs">
              <legend>“自动调整”操作</legend>
              <RadioGroup value={d.fit} onChange={(_, e) => set({ fit: e.value as TableFit })}>
                <span className="style-row">
                  <Radio value="fixed" label="固定列宽：" />
                  <LengthInput value={d.colWidth === 'auto' ? '' : d.colWidth} defaultUnit="cm" allowed={['cm', 'mm', 'in', 'pt', 'em', '%', 'fr']} disabled={d.fit !== 'fixed'} placeholder="自动" width={110} onChange={(v) => set({ colWidth: v ?? 'auto' })} />
                </span>
                <Radio value="content" label="根据内容调整表格" />
                <Radio value="window" label="根据窗口调整表格（撑满版心）" />
              </RadioGroup>
            </fieldset>
            <Checkbox label="为新表格记住此尺寸" checked={remember} onChange={(_, e) => setRemember(!!e.checked)} />
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onClose}>取消</Button>
            <Button appearance="primary" disabled={!ok} onClick={submit}>确定</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

const EXAMPLE = `| 试样 | 渗透率 / m² | 孔隙度 |
|:----|----------:|:-----:|
| 1 号 | $3.2\\times10^{-14}$ | 0.35 |
| 2 号 | $2.9\\times10^{-14}$ | 0.33 |`;

export function TableTextDialog({ onInsert, onClose }: { onInsert: (text: string, header: boolean) => void; onClose: () => void }) {
  const [text, setText] = useState('');
  const [header, setHeader] = useState(true);
  const parsed = useMemo(() => parseTableText(text), [text]);
  return (
    <Dialog open onOpenChange={(_, d) => { if (!d.open) onClose(); }}>
      <DialogSurface className="style-dialog table-text-dialog">
        <DialogBody>
          <DialogTitle action={<DialogTrigger action="close"><Button appearance="subtle" icon={<Dismiss20Regular />} /></DialogTrigger>}>从文本 / Markdown 插入表格</DialogTitle>
          <DialogContent>
            <p className="muted style-hint">粘一段 Markdown 表格（GFM，`|` 分列、`---` 分隔行、`:---:` 定对齐），或 Excel 复制来的制表符分隔行、CSV。单元格里的 **粗体**、*斜体*、`代码`、$公式$ 会照样转。</p>
            <Textarea value={text} onChange={(_, d) => setText(d.value)} placeholder={EXAMPLE} rows={9} resize="vertical" className="table-text-input" autoFocus spellCheck={false} />
            <div className="style-row" style={{ marginTop: 8, justifyContent: 'space-between' }}>
              <Checkbox label="第一行是表头" checked={parsed ? (parsed.header || header) : header} disabled={!!parsed?.header} onChange={(_, d) => setHeader(!!d.checked)} />
              <span className="muted">{parsed ? `识别到 ${parsed.rows.length} 行 × ${parsed.rows[0].length} 列${parsed.header ? '（含表头）' : ''}` : text.trim() ? '还认不出表来' : ''}</span>
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="subtle" onClick={() => setText(EXAMPLE)}>填个示例</Button>
            <Button appearance="secondary" onClick={onClose}>取消</Button>
            <Button appearance="primary" disabled={!parsed} onClick={() => onInsert(text, parsed?.header || header)}>插入</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
