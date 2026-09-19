import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions } from '@fluentui/react-components';
import { useStore } from '../model/store';
import { useCompileState } from '../compiler/client';
import { roleAvailability, useFontState } from '../fonts/userFonts';
import { t } from '../i18n';

/** Restore granted fonts before warning, and warn again if a recovered family disappears. */
export function FontRecovery() {
  const preset = useStore((s) => s.doc.settings.fontset);
  const docId = useStore((s) => s.doc.id);
  const editing = useStore((s) => s.loaded && s.view === 'editor');
  const status = useCompileState((s) => s.status);
  const engineGen = useCompileState((s) => s.engineGen);
  const families = useCompileState((s) => s.families);
  const { busy, error, canQuery, readLocal, addFiles } = useFontState();
  const [restored, setRestored] = useState('');
  const [dismissed, setDismissed] = useState('');
  const stored = useRef<Promise<void> | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const key = `${docId}:${preset}`;
  // 引擎重启过：新 worker 里没有字体，本机 / 文件字体都重发一遍
  const lastGen = useRef(engineGen);
  useEffect(() => {
    if (!editing || status !== 'ready') return;
    let alive = true;
    void (async () => {
      useFontState.setState({ restoring: true });
      try {
        if (lastGen.current !== engineGen) { lastGen.current = engineGen; stored.current = null; useFontState.setState({ fonts: [] }); }
        stored.current ??= useFontState.getState().loadStored();
        await stored.current;
        if (preset !== 'webapp') await useFontState.getState().autoReadLocal();
      } finally { useFontState.setState({ restoring: false }); }
      if (alive) setRestored(key);
    })();
    return () => { alive = false; };
  }, [editing, status, key, preset, engineGen]);
  const missing = preset === 'webapp' ? [] : roleAvailability(preset).filter((font) => !font.optional && !font.ok);
  const signature = missing.length ? `${key}:${missing.map((font) => font.family).join(',')}` : '';
  useEffect(() => { if (!signature) setDismissed(''); }, [signature, families]);
  const open = editing && status === 'ready' && restored === key && !!signature && signature !== dismissed;
  return <Dialog open={open} onOpenChange={(_, data) => { if (!data.open && !busy) setDismissed(signature); }}>
    <DialogSurface>
      <DialogBody>
        <DialogTitle>{t("需要重新读取字体")}</DialogTitle>
        <DialogContent>
          <p>{t("以下字体未加载，当前预览使用替代字体：")}</p>
          <p>{missing.map((font) => font.family).join('、')}</p>
          {busy && <p role="status">{busy}</p>}
          {error && <p role="alert">{error}</p>}
          <input ref={input} type="file" hidden multiple accept=".otf,.ttf,.ttc,.otc" onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length) void addFiles(files); }} />
        </DialogContent>
        <DialogActions>
          <Button disabled={!!busy} onClick={() => setDismissed(signature)}>{t("暂时使用替代字体")}</Button>
          <Button disabled={!!busy} onClick={() => input.current?.click()}>{t("选择字体文件")}</Button>
          {canQuery && <Button appearance="primary" disabled={!!busy} onClick={() => void readLocal()}>{t("重新读取字体")}</Button>}
        </DialogActions>
      </DialogBody>
    </DialogSurface>
  </Dialog>;
}
