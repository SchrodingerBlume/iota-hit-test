// 插入 / 编辑链接：网址 + 显示的文本（Word 的「插入超链接」）。排成 Typst 的 #link("url")[文本]。
import { useState } from 'react';
import { Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions, DialogTrigger, Button, Input, Label } from '@fluentui/react-components';
import { Dismiss20Regular } from '@fluentui/react-icons';

export function LinkDialog({ initialHref, initialText, textLocked, onSubmit, onRemove, onClose }: { initialHref: string; initialText: string; textLocked?: boolean; onSubmit: (href: string, text: string) => void; onRemove?: () => void; onClose: () => void }) {
  const [href, setHref] = useState(initialHref);
  const [text, setText] = useState(initialText);
  const url = href.trim();
  const ok = /^(https?:\/\/|mailto:|doi:|ftp:\/\/)/i.test(url) || /^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(url);
  const normalized = () => (/^(https?:\/\/|mailto:|doi:|ftp:\/\/)/i.test(url) ? url : `https://${url}`);
  return (
    <Dialog open onOpenChange={(_, d) => { if (!d.open) onClose(); }}>
      <DialogSurface className="style-dialog">
        <DialogBody>
          <DialogTitle action={<DialogTrigger action="close"><Button appearance="subtle" icon={<Dismiss20Regular />} /></DialogTrigger>}>{initialHref ? t("编辑链接") : t("插入链接")}</DialogTitle>
          <DialogContent>
            <div className="style-field"><Label className="style-label">{t("地址")}</Label><Input value={href} placeholder={t("https://… 或 doi:10.…")} onChange={(_, d) => setHref(d.value)} autoFocus onKeyDown={(e) => { if (e.nativeEvent.isComposing || e.keyCode === 229) return; if (e.key === 'Enter' && ok) onSubmit(normalized(), text.trim() || url); }} /></div>
            <div className="style-field"><Label className="style-label">{t("显示文本")}</Label><Input value={text} placeholder={textLocked ? t("（选中的文字）") : t("留空就显示地址")} disabled={textLocked} onChange={(_, d) => setText(d.value)} onKeyDown={(e) => { if (e.nativeEvent.isComposing || e.keyCode === 229) return; if (e.key === 'Enter' && ok) onSubmit(normalized(), text.trim() || url); }} /></div>
          </DialogContent>
          <DialogActions>
            {onRemove && <Button appearance="subtle" onClick={onRemove}>{t("取消超链接")}</Button>}
            <Button appearance="secondary" onClick={onClose}>{t("取消")}</Button>
            <Button appearance="primary" disabled={!ok} onClick={() => onSubmit(normalized(), text.trim() || url)}>{t("确定")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

// 打开对话框的请求（⌘K、功能区按钮）；对话框本体挂在 App 里
import { create } from 'zustand';
import { getEditor } from '../editor/registry';
import { usePreviewSurface } from './PreviewEditLayer';
import { t } from '../i18n';
export const useLinkDialog = create<{ nonce: number; open: () => void; close: () => void }>((set) => ({ nonce: 0, open: () => set((s) => ({ nonce: s.nonce + 1 })), close: () => set({ nonce: 0 }) }));

export function LinkDialogHost() {
  const nonce = useLinkDialog((s) => s.nonce);
  const close = useLinkDialog((s) => s.close);
  if (!nonce) return null;
  const key = usePreviewSurface.getState().activeKey;
  const ed = key ? getEditor(key) : null;
  if (!ed) return null;
  const { from, to, empty } = ed.state.selection;
  const cur = ed.getAttributes('link');
  const selText = empty ? '' : ed.state.doc.textBetween(from, to, ' ');
  const submit = (href: string, text: string) => {
    if (empty && !cur.href) ed.chain().focus().insertContent({ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] }).run();
    else ed.chain().focus().extendMarkRange('link').setLink({ href }).run();
    close();
  };
  return <LinkDialog key={nonce} initialHref={String(cur.href ?? '')} initialText={selText} textLocked={!empty || !!cur.href} onSubmit={submit} onRemove={cur.href ? () => { ed.chain().focus().extendMarkRange('link').unsetLink().run(); close(); } : undefined} onClose={close} />;
}
