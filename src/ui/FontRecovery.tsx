import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions } from '@fluentui/react-components';
import { useStore } from '../model/store';
import { useCompileState } from '../compiler/client';
import { roleAvailability, useFontState } from '../fonts/userFonts';

/** Restore granted fonts before warning, and warn again if a recovered family disappears. */
export function FontRecovery() {
  const preset = useStore((s) => s.doc.settings.fontset);
  const docId = useStore((s) => s.doc.id);
  const editing = useStore((s) => s.loaded && s.view === 'editor');
  const status = useCompileState((s) => s.status);
  const families = useCompileState((s) => s.families);
  const { busy, error, canQuery, readLocal, addFiles } = useFontState();
  const [restored, setRestored] = useState('');
  const [dismissed, setDismissed] = useState('');
  const stored = useRef<Promise<void> | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const key = `${docId}:${preset}`;
  useEffect(() => {
    if (!editing || status !== 'ready') return;
    let alive = true;
    void (async () => {
      stored.current ??= useFontState.getState().loadStored();
      await stored.current;
      if (preset !== 'webapp') await useFontState.getState().autoReadLocal();
      if (alive) setRestored(key);
    })();
    return () => { alive = false; };
  }, [editing, status, key, preset]);
  const missing = preset === 'webapp' ? [] : roleAvailability(preset).filter((font) => !font.optional && !font.ok);
  const signature = missing.length ? `${key}:${missing.map((font) => font.family).join(',')}` : '';
  useEffect(() => { if (!signature) setDismissed(''); }, [signature, families]);
  const open = editing && status === 'ready' && restored === key && !!signature && signature !== dismissed;
  return <Dialog open={open} onOpenChange={(_, data) => { if (!data.open && !busy) setDismissed(signature); }}>
    <DialogSurface>
      <DialogBody>
        <DialogTitle>需要重新读取字体</DialogTitle>
        <DialogContent>
          <p>当前文档缺少以下字体，预览暂时使用替代字体：</p>
          <p>{missing.map((font) => font.family).join('、')}</p>
          {busy && <p role="status">{busy}</p>}
          {error && <p role="alert">{error}</p>}
          <input ref={input} type="file" hidden multiple accept=".otf,.ttf,.ttc,.otc" onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length) void addFiles(files); }} />
        </DialogContent>
        <DialogActions>
          <Button disabled={!!busy} onClick={() => setDismissed(signature)}>暂时使用替代字体</Button>
          <Button disabled={!!busy} onClick={() => input.current?.click()}>选择字体文件</Button>
          {canQuery && <Button appearance="primary" disabled={!!busy} onClick={() => void readLocal()}>重新读取字体</Button>}
        </DialogActions>
      </DialogBody>
    </DialogSurface>
  </Dialog>;
}
