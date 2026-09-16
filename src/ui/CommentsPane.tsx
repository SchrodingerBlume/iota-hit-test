// 批注窗格（Word 右边那一栏）：每条批注一张卡，点卡片选中正文里那段；能回复、标记已解决、删除。
// 批注本体在 doc.comments，正文里的圈定是 comment 标记（data-comment-id）。
import { useMemo, useState } from 'react';
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
    if (r && ed) { ed.chain().focus().setTextSelection(r).run(); setActive(c.id); }
  };
  const resolvedCount = comments.filter((c) => sectionOf(c.key) === section && c.resolved).length;
  return (
    <aside className="comments-pane" aria-label={t("批注")}>
      <div className="comments-head">
        <span><Comment20Regular />{t("批注")}{' '}<span className="muted">{here.length}</span></span>
        <Input size="small" value={author} placeholder={t("审阅者姓名")} onChange={(_, d) => setAuthor(d.value)} style={{ width: 110 }} />
        <Tooltip content={t("收起批注窗格")} relationship="label"><Button size="small" appearance="subtle" icon={<Dismiss20Regular />} onClick={() => setOpen(false)} /></Tooltip>
      </div>
      {resolvedCount > 0 && <button type="button" className="comments-toggle" onClick={() => setShowResolved((v) => !v)}>{showResolved ? t("隐藏") : t("显示")}{t("已解决的")}{' '}{resolvedCount} {' '}{t("条")}</button>}
      {!here.length && <p className="muted comments-empty">{t("此部分没有批注。")}</p>}
      {here.map((c) => (
        <div key={c.id} className={`comment-card ${active === c.id ? 'is-active' : ''} ${c.resolved ? 'is-resolved' : ''}`} onClick={() => jump(c)}>
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
