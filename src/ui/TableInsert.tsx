// 「插入表格」的二级菜单（Word 的样子）：拖格子选大小之外，还有「插入表格…」（填行列数）与
// 「从文本 / Markdown 插入…」（粘一段 GFM 表格、制表符或逗号分隔的行）两个对话框。
import { useMemo, useState } from 'react';
import { Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions, DialogTrigger, Button, Input, Checkbox, Label, Textarea } from '@fluentui/react-components';
import { Dismiss20Regular } from '@fluentui/react-icons';
import { parseTableText } from '../editor/tableImport';

export type TableDialogKind = 'size' | 'text';

export function TableSizeDialog({ onInsert, onClose }: { onInsert: (rows: number, cols: number, header: boolean) => void; onClose: () => void }) {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const [header, setHeader] = useState(true);
  const ok = rows >= 1 && rows <= 60 && cols >= 1 && cols <= 20;
  return (
    <Dialog open onOpenChange={(_, d) => { if (!d.open) onClose(); }}>
      <DialogSurface className="style-dialog">
        <DialogBody>
          <DialogTitle action={<DialogTrigger action="close"><Button appearance="subtle" icon={<Dismiss20Regular />} /></DialogTrigger>}>插入表格</DialogTitle>
          <DialogContent>
            <div className="style-field"><Label className="style-label">列数</Label><Input type="number" min={1} max={20} value={String(cols)} onChange={(_, d) => setCols(Number(d.value) || 0)} style={{ width: 120 }} autoFocus /></div>
            <div className="style-field"><Label className="style-label">行数</Label><Input type="number" min={1} max={60} value={String(rows)} onChange={(_, d) => setRows(Number(d.value) || 0)} style={{ width: 120 }} /></div>
            <Checkbox label="第一行是表头（三线表的栏头，跨页时续页重排）" checked={header} onChange={(_, d) => setHeader(!!d.checked)} />
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onClose}>取消</Button>
            <Button appearance="primary" disabled={!ok} onClick={() => onInsert(rows, cols, header)}>插入</Button>
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
