// 批注窗格：选择批注卡片时同步选择正文范围。
// 批注本体在 doc.comments，正文里的圈定是 comment 标记（data-comment-id）。
// 窗格在编辑区右边时（宽屏）卡片照 Word 的样子跟被批注的那行对齐、之间画一条引线，当前那条对得最准、别的往两边让；
// 叠在下面时（窄屏）就是一列
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button, Textarea, Input, Tooltip } from '@fluentui/react-components';
import { Delete20Regular, Checkmark20Regular, ArrowUndo20Regular, Dismiss20Regular, Comment20Regular } from '@fluentui/react-icons';
import { useStore, type RichKey } from '../model/store';
import type { Comment } from '../model/types';
import { useComments } from '../editor/comments';
import { getEditor } from '../editor/registry';
import { t } from '../i18n';

const fmtTime = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/** 正文里这条批注圈的范围（编辑器挂着才找得到） */
export function commentRange(key: RichKey, id: string): { from: number; to: number } | null {
  const ed = getEditor(key);
  if (!ed) return null;
  let from = -1, to = -1;
  ed.state.doc.descendants((n, pos) => {
    if (!n.isText) return true;
    if (n.marks.some((m) => m.type.name === 'comment' && m.attrs.commentId === id)) { if (from < 0) from = pos; to = pos + n.nodeSize; }
    return false;
  });
  return from >= 0 ? { from, to } : null;
}

export function CommentsPane() {
  const comments = useStore((s) => s.doc.comments ?? []);
  const section = useStore((s) => s.section);
  const setComments = useStore((s) => s.setComments);
  const active = useComments((s) => s.active);
  const setActive = useComments((s) => s.setActive);
  const author = useComments((s) => s.author);
  const setAuthor = useComments((s) => s.setAuthor);
  const setOpen = useComments((s) => s.setOpen);
  const [reply, setReply] = useState<Record<string, string>>({});
  const [showResolved, setShowResolved] = useState(false);
  // 这一节里的批注（哪份富文本属于哪一节：正文 / 摘要 / 结论…）
  const here = useMemo(() => comments.filter((c) => sectionOf(c.key) === section && (showResolved || !c.resolved)), [comments, section, showResolved]);
  const patch = (id: string, p: Partial<Comment>) => setComments(comments.map((c) => (c.id === id ? { ...c, ...p } : c)));
  const remove = (c: Comment) => {
    const ed = getEditor(c.key);
    if (ed) ed.chain().focus().unsetComment(c.id).run();
    setComments(comments.filter((x) => x.id !== c.id));
    if (active === c.id) setActive(null);
  };
  const jump = (c: Comment) => {
    const r = commentRange(c.key, c.id);
    const ed = getEditor(c.key);
    if (r && ed) { ed.chain().focus().setTextSelection(r).scrollIntoView().run(); setActive(c.id); }
  };
  const resolvedCount = comments.filter((c) => sectionOf(c.key) === section && c.resolved).length;
  const pane = useRef<HTMLElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const cards = useRef(new Map<string, HTMLDivElement>());
  // 每次画完都量一遍：卡片贴到被批注那行的高度，引线从圈定的文字尾巴拉到卡片；正文高度变了（打字）也重量
  useLayoutEffect(() => {
    const el = pane.current;
    const cols = el?.parentElement;
    const inner = cols?.querySelector<HTMLElement>(':scope > .work-inner');
    if (!el || !cols || !inner) return;
    const place = () => {
      const paneRect = el.getBoundingClientRect(), innerRect = inner.getBoundingClientRect();
      const side = paneRect.left >= innerRect.right - 1;
      el.classList.toggle('is-anchored', side);
      const paths = svg.current;
      if (!side) { el.style.height = ''; for (const c of cards.current.values()) c.style.top = ''; if (paths) paths.innerHTML = ''; return; }
      const head = el.querySelector<HTMLElement>('.comments-head');
      const top0 = (head?.offsetHeight ?? 0) + 8 + (el.querySelector<HTMLElement>('.comments-toggle')?.offsetHeight ?? 0);
      // 目标高度：圈定文字头一段相对窗格顶的 y；找不到的（编辑器没挂）排到最后
      const items = here.map((c) => {
        const card = cards.current.get(c.id);
        const span = inner.querySelector<HTMLElement>(`span.cmt[data-comment-id="${CSS.escape(c.id)}"]`);
        const r = span?.getBoundingClientRect();
        return { c, card, want: r ? r.top - paneRect.top : Number.MAX_SAFE_INTEGER, anchor: r ? { x: r.right - innerRect.left, y: r.top + r.height / 2 - paneRect.top } : null, h: card?.offsetHeight ?? 0 };
      }).filter((it) => it.card).sort((a, b) => a.want - b.want);
      // 当前那条钉在目标位置，上面的往上让、下面的往下让；没有当前的就从上往下顺着摆
      const gap = 8;
      if (!items.length) { el.style.height = ''; if (paths) paths.innerHTML = ''; return; }
      const k = items.findIndex((it) => it.c.id === active);
      const tops = new Array<number>(items.length);
      const start = k >= 0 ? k : 0;
      tops[start] = items[start].want === Number.MAX_SAFE_INTEGER ? top0 : Math.max(top0, items[start].want);
      for (let i = start + 1; i < items.length; i++) tops[i] = Math.max(items[i].want === Number.MAX_SAFE_INTEGER ? 0 : items[i].want, tops[i - 1] + items[i - 1].h + gap);
      for (let i = start - 1; i >= 0; i--) tops[i] = Math.min(items[i].want, tops[i + 1] - items[i].h - gap);
      // 顶上让过头了（负值）：整列往下推
      const shift = Math.max(0, top0 - Math.min(...tops));
      let bottom = 0;
      items.forEach((it, i) => { const top = tops[i] + shift; it.card!.style.top = `${top}px`; bottom = Math.max(bottom, top + it.h); });
      el.style.height = `${Math.max(bottom + 12, innerRect.height)}px`;
      // 引线：svg 贴在窗格左边、盖着编辑区（左缘 = 编辑区左缘，顶 = 窗格顶），从圈定文字的尾巴水平拉到缝隙里再折到卡片
      if (paths) {
        const w = paneRect.left - innerRect.left;
        paths.style.width = `${w}px`; paths.style.height = `${el.offsetHeight}px`;
        paths.innerHTML = items.map((it, i) => it.anchor
          ? `<path class="${it.c.id === active ? 'on' : ''}" d="M${it.anchor.x.toFixed(1)},${it.anchor.y.toFixed(1)} H${(w - 12).toFixed(1)} L${w},${(tops[i] + shift + 14).toFixed(1)}" />`
          : '').join('');
      }
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(inner);
    window.addEventListener('resize', place);
    return () => { ro.disconnect(); window.removeEventListener('resize', place); };
  });
  return (
    <aside className="comments-pane" aria-label={t("批注")} ref={pane}>
      <svg className="comments-links" ref={svg} aria-hidden />
      <div className="comments-head">
        <span><Comment20Regular />{t("批注")}{' '}<span className="muted">{here.length}</span></span>
        <Input size="small" value={author} placeholder={t("审阅者姓名")} onChange={(_, d) => setAuthor(d.value)} className="comments-author" />
        <Tooltip content={t("收起批注窗格")} relationship="label"><Button size="small" appearance="subtle" icon={<Dismiss20Regular />} onClick={() => setOpen(false)} /></Tooltip>
      </div>
      {resolvedCount > 0 && <button type="button" className="comments-toggle" onClick={() => setShowResolved((v) => !v)}>{showResolved ? t("隐藏") : t("显示")}{t("显示已解决的批注")}{' '}{resolvedCount} {' '}{t("条")}</button>}
      {!here.length && <p className="muted comments-empty">{t("此部分没有批注。")}</p>}
      {here.map((c) => (
        <div key={c.id} ref={(n) => { if (n) cards.current.set(c.id, n); else cards.current.delete(c.id); }} className={`comment-card ${active === c.id ? 'is-active' : ''} ${c.resolved ? 'is-resolved' : ''}`} onClick={() => jump(c)}>
          <div className="comment-meta"><b>{c.author || t("（未署名）")}</b><span className="muted">{fmtTime(c.createdAt)}</span></div>
          <Textarea className="comment-text" value={c.text} placeholder={t("输入批注…")} resize="vertical" rows={2} onClick={(e) => e.stopPropagation()} onChange={(_, d) => patch(c.id, { text: d.value })} />
          {c.replies?.map((r, i) => (
            <div key={i} className="comment-reply"><div className="comment-meta"><b>{r.author || t("（未署名）")}</b><span className="muted">{fmtTime(r.createdAt)}</span></div><div>{r.text}</div></div>
          ))}
          <div className="comment-actions" onClick={(e) => e.stopPropagation()}>
            <Input size="small" value={reply[c.id] ?? ''} placeholder={t("回复…")} onChange={(_, d) => setReply({ ...reply, [c.id]: d.value })} onKeyDown={(e) => { if (e.nativeEvent.isComposing || e.keyCode === 229) return; if (e.key === 'Enter' && (reply[c.id] ?? '').trim()) { patch(c.id, { replies: [...(c.replies ?? []), { author, text: reply[c.id].trim(), createdAt: new Date().toISOString() }] }); setReply({ ...reply, [c.id]: '' }); } }} />
            <Tooltip content={c.resolved ? t("重新打开") : t("标为已解决")} relationship="label"><Button size="small" appearance="subtle" icon={c.resolved ? <ArrowUndo20Regular /> : <Checkmark20Regular />} onClick={() => patch(c.id, { resolved: !c.resolved })} /></Tooltip>
            <Tooltip content={t("删除批注")} relationship="label"><Button size="small" appearance="subtle" icon={<Delete20Regular />} onClick={() => remove(c)} /></Tooltip>
          </div>
        </div>
      ))}
    </aside>
  );
}

/** 富文本 key → 左栏的节 */
export function sectionOf(key: RichKey): string {
  switch (key) {
    case 'abstractZh': case 'abstractEn': return 'abstract';
    default: return key;
  }
}
