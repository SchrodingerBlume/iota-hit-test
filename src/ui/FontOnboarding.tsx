// 初次进站：引擎一就绪就问要不要读本机字体（Chromium 的 Local Font Access，一次授权）。答过就记住，新建文档默认照答的那档
import { useEffect, useState } from 'react';
import { Button, Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions } from '@fluentui/react-components';
import { useStore } from '../model/store';
import { useCompileState } from '../compiler/client';
import { useFontState } from '../fonts/userFonts';
import { rememberedFontset, rememberFontset, platformPreset } from '../fonts/pref';
import { t } from '../i18n';

export function FontOnboarding() {
  const editing = useStore((s) => s.loaded && s.view === 'editor');
  const fontset = useStore((s) => s.doc.settings.fontset);
  const setSettings = useStore((s) => s.setSettings);
  const status = useCompileState((s) => s.status);
  const { canQuery, busy, error, readLocal } = useFontState();
  const [decided, setDecided] = useState(() => rememberedFontset() !== null);
  // 上回在别处已经允许过的（权限还在）不用问，FontRecovery 会自己读
  useEffect(() => {
    if (!canQuery || decided) return;
    navigator.permissions.query({ name: 'local-fonts' as PermissionName }).then((p) => { if (p.state === 'granted') { rememberFontset(platformPreset()); setDecided(true); } }).catch(() => {});
  }, [canQuery, decided]);
  const skip = () => { rememberFontset('webapp'); setDecided(true); };
  // 先读、读成了再换档：换档在前的话 FontRecovery 会趁字还没到弹它那张「需要重新读取字体」
  const read = async () => {
    await readLocal();
    const err = useFontState.getState().error;
    if (!err) { const preset = platformPreset(); setSettings({ fontset: preset }); rememberFontset(preset); setDecided(true); return; }
    // 拒绝了的不再问；没找到字的留着让用户选
    if (/权限|denied|NotAllowed/i.test(err)) skip();
  };
  const open = canQuery && !decided && editing && status === 'ready' && fontset === 'webapp';
  return (
    <Dialog open={open} onOpenChange={(_, d) => { if (!d.open && !busy) skip(); }}>
      <DialogSurface className="font-onboard">
        <DialogBody>
          <DialogTitle>{t("读取本机字体？")}</DialogTitle>
          <DialogContent>
            <p>{t("用这台电脑上的宋体、黑体、楷体和 Times New Roman 排版，预览、导出的 PDF 与 Word 里看到的一致。字体只在本机读取，不上传；浏览器会问一次要不要允许。")}</p>
            <p className="muted">{t("不读也行：内置的 Noto 开源字体随时能用，之后在「论文设置 › 字体方案」里还能改。")}</p>
            {busy && <p role="status">{busy}</p>}
            {error && <p role="alert" className="diag err" style={{ padding: '6px 10px', borderRadius: 'var(--r-s)' }}>{error}</p>}
          </DialogContent>
          <DialogActions>
            <Button disabled={!!busy} onClick={skip}>{t("先用内置字体")}</Button>
            <Button appearance="primary" disabled={!!busy} onClick={() => void read()}>{t("读取本机字体")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
