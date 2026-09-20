// 表格：在 TipTap 的表格上加三样——单元格的水平 / 垂直对齐、行高、以及按行 / 按列批量设置的命令。
// 列宽用 TipTap 自带的 colwidth（拖列线得到），序列化时折成 Typst 的 fr 比例。
import { TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { CellSelection } from '@tiptap/pm/tables';
import { Extension } from '@tiptap/core';

export type HAlign = 'left' | 'center' | 'right';
export type VAlign = 'top' | 'horizon' | 'bottom';

const alignAttrs = {
  align: {
    default: null,
    parseHTML: (el: HTMLElement) => el.getAttribute('data-align') || null,
    renderHTML: (a: any) => (a.align ? { 'data-align': a.align, style: `text-align: ${a.align}` } : {}),
  },
  valign: {
    default: null,
    parseHTML: (el: HTMLElement) => el.getAttribute('data-valign') || null,
    renderHTML: (a: any) => (a.valign ? { 'data-valign': a.valign, style: `vertical-align: ${a.valign === 'horizon' ? 'middle' : a.valign}` } : {}),
  },
};

export const AlignedTableCell = TableCell.extend({
  addAttributes() { return { ...this.parent?.(), ...alignAttrs }; },
});
export const AlignedTableHeader = TableHeader.extend({
  addAttributes() { return { ...this.parent?.(), ...alignAttrs }; },
});
export const SizedTableRow = TableRow.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      /** 行高，厘米；空 = 自动 */
      height: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-height') || null,
        renderHTML: (a: any) => (a.height ? { 'data-height': a.height, style: `height: ${Number(a.height) * 37.8}px` } : {}),
      },
    };
  },
});

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tableExtras: {
      /** 给光标所在行（或选区覆盖的行）的全部单元格设属性 */
      setRowCellsAttribute: (name: string, value: any) => ReturnType;
      /** 给光标所在行设属性（行高） */
      setRowAttribute: (name: string, value: any) => ReturnType;
      /** 光标所在列的宽度（像素），写进这一列每个单元格的 colwidth */
      setColumnWidth: (px: number | null) => ReturnType;
    };
  }
}

/** 光标所在的行与列：从选区往上找 tableRow / tableCell */
function cellContext(state: any): { rowPos: number; row: any; cellIndex: number; colIndex: number; tablePos: number; table: any } | null {
  const $from = state.selection.$from;
  let rowDepth = -1, cellDepth = -1, tableDepth = -1;
  for (let d = $from.depth; d > 0; d--) {
    const name = $from.node(d).type.name;
    if ((name === 'tableCell' || name === 'tableHeader') && cellDepth < 0) cellDepth = d;
    if (name === 'tableRow' && rowDepth < 0) rowDepth = d;
    if (name === 'table' && tableDepth < 0) { tableDepth = d; break; }
  }
  if (rowDepth < 0 || tableDepth < 0) return null;
  const row = $from.node(rowDepth);
  const cellIndex = cellDepth > 0 ? $from.index(rowDepth) : 0;
  // 折算成真正的列号（前面的格可能跨列）
  let colIndex = 0;
  for (let i = 0; i < cellIndex; i++) colIndex += row.child(i).attrs.colspan ?? 1;
  return { rowPos: $from.before(rowDepth), row, cellIndex, colIndex, tablePos: $from.before(tableDepth), table: $from.node(tableDepth) };
}

export const TableExtras = Extension.create({
  name: 'tableExtras',
  // 与 Word 一致：Backspace 删除选中的整行或整列，Delete 仅清除内容。
  addKeyboardShortcuts() {
    return {
      Backspace: () => {
        const sel = this.editor.state.selection;
        if (!(sel instanceof CellSelection)) return false;
        if (sel.isRowSelection()) return this.editor.commands.deleteRow();
        if (sel.isColSelection()) return this.editor.commands.deleteColumn();
        return false;
      },
    };
  },
  addCommands() {
    return {
      setRowCellsAttribute: (name, value) => ({ state, tr, dispatch }) => {
        const sel = state.selection;
        const rows = new Set<number>();
        if (sel instanceof CellSelection) {
          sel.forEachCell((_cell, pos) => { rows.add(state.doc.resolve(pos).before()); });
        } else {
          const ctx = cellContext(state);
          if (!ctx) return false;
          rows.add(ctx.rowPos);
        }
        if (!dispatch) return true;
        for (const rowPos of rows) {
          const row = state.doc.nodeAt(rowPos);
          if (!row) continue;
          let pos = rowPos + 1;
          row.forEach((cell) => { tr.setNodeMarkup(pos, undefined, { ...cell.attrs, [name]: value }); pos += cell.nodeSize; });
        }
        dispatch(tr);
        return true;
      },
      setRowAttribute: (name, value) => ({ state, tr, dispatch }) => {
        const ctx = cellContext(state);
        if (!ctx) return false;
        if (!dispatch) return true;
        tr.setNodeMarkup(ctx.rowPos, undefined, { ...ctx.row.attrs, [name]: value });
        dispatch(tr);
        return true;
      },
      setColumnWidth: (px) => ({ state, tr, dispatch }) => {
        const ctx = cellContext(state);
        if (!ctx) return false;
        if (!dispatch) return true;
        const { table, tablePos, colIndex } = ctx;
        let rowPos = tablePos + 1;
        table.forEach((row: any) => {
          let pos = rowPos + 1;
          let col = 0;
          row.forEach((cell: any) => {
            const span = cell.attrs.colspan ?? 1;
            if (col <= colIndex && colIndex < col + span) {
              const widths: (number | null)[] = Array.isArray(cell.attrs.colwidth) ? [...cell.attrs.colwidth] : new Array(span).fill(null);
              widths[colIndex - col] = px;
              tr.setNodeMarkup(pos, undefined, { ...cell.attrs, colwidth: widths.every((w) => w == null) ? null : widths });
            }
            col += span;
            pos += cell.nodeSize;
          });
          rowPos += row.nodeSize;
        });
        dispatch(tr);
        return true;
      },
    };
  },
});

/** 当前列宽（像素）与行高（厘米），给工具栏回显 */
export function currentCellInfo(state: any): { colwidth: number | null; colIndex: number | null; rowHeight: string | null; align: HAlign | null; valign: VAlign | null } {
  const ctx = cellContext(state);
  if (!ctx) return { colwidth: null, colIndex: null, rowHeight: null, align: null, valign: null };
  const cell = ctx.row.child(Math.min(ctx.cellIndex, ctx.row.childCount - 1));
  const cw = Array.isArray(cell?.attrs.colwidth) ? cell.attrs.colwidth[0] ?? null : null;
  return { colwidth: cw, colIndex: ctx.colIndex, rowHeight: ctx.row.attrs.height ?? null, align: cell?.attrs.align ?? null, valign: cell?.attrs.valign ?? null };
}
