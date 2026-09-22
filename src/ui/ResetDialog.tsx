// 「我的文档」页上的重置：清引擎缓存（下次重新下载）、还原默认设置（localStorage 那些偏好，含字体读取的选择）、
// 清除全部项目数据（IndexedDB 整库 + 设置 + 缓存；要确认三遍，最后一遍得把那句话打出来）
import { useState } from 'react';
import { Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions, Button, Checkbox, Input } from '@fluentui/react-components';
import { ArrowReset20Regular, Warning20Regular } from '@fluentui/react-icons';
import { t } from '../i18n';

const DB = 'iota4web';
const PHRASE = t("清除全部数据");

async function clearCaches() { try { for (const k of await caches.keys()) await caches.delete(k); } catch { /* */ } }
function clearPrefs() { try { for (const k of Object.keys(localStorage)) if (k.startsWith('iota4web-')) localStorage.removeItem(k); } catch { /* */ } }
function deleteDatabase(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB);
    req.onsuccess = () => resolve(); req.onerror = () => resolve(); req.onblocked = () => resolve();
  });
}

export function ResetDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [ack, setAck] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const close = () => { if (busy) return; setStep(0); setAck(false); setTyped(''); onClose(); };
  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    try { await fn(); } finally { location.reload(); }
  };
  return (
    <Dialog open={open} onOpenChange={(_, d) => { if (!d.open) close(); }}>
      <DialogSurface className="reset-dialog">
        <DialogBody>
          <DialogTitle>{step === 0 ? t("重置") : t("清除全部项目数据")}</DialogTitle>
          <DialogContent>
            {step === 0 && (
              <div className="reset-list">
                <section>
                  <h4>{t("清除排版引擎缓存")}</h4>
                  <p className="muted">{t("删掉缓存里的排版引擎、字体和模板包，下次打开重新下载（约 130 MB）。引擎表现异常、模板更新后没生效时用。文档与设置不动。")}</p>
                  <Button disabled={!!busy} onClick={() => void run('engine', clearCaches)}>{busy === 'engine' ? t("正在清除…") : t("清除并重新下载")}</Button>
                </section>
                <section>
                  <h4>{t("还原默认设置")}</h4>
                  <p className="muted">{t("界面布局、主题、预览显示、本地历史节奏、审阅者姓名、Agent 小窗位置、是否读取本机字体的选择等回到初始；文档、图片与 Agent 的密钥不动。浏览器自己给出的字体访问授权要在地址栏的站点设置里撤销。")}</p>
                  <Button disabled={!!busy} onClick={() => void run('prefs', async () => clearPrefs())}>{busy === 'prefs' ? t("正在还原…") : t("还原默认设置")}</Button>
                </section>
                <section className="is-danger">
                  <h4><Warning20Regular />{t("清除全部项目数据")}</h4>
                  <p className="muted">{t("删掉这个浏览器里保存的全部文档、图片、本地历史、Git 记录、自己选的字体文件、Agent 的设置与对话，连同设置与缓存。不可恢复——先把要留的文档下载副本。")}</p>
                  <Button disabled={!!busy} className="btn-danger-fill" onClick={() => setStep(1)}>{t("我要清除全部数据…")}</Button>
                </section>
              </div>
            )}
            {step === 1 && (
              <div className="reset-list">
                <p>{t("这会删掉此浏览器里 HιT webapp 的一切：所有文档、图片、本地历史、Git 记录、字体文件、Agent 设置与对话。删了就没有了，本站不在服务器上存任何东西。")}</p>
                <Checkbox checked={ack} onChange={(_, d) => setAck(!!d.checked)} label={t("要留的文档我已经下载了副本，其余的都可以删")} />
              </div>
            )}
            {step === 2 && (
              <div className="reset-list">
                <p>{t("最后一遍确认：请在下面原样输入「{{phrase}}」。", { phrase: PHRASE })}</p>
                <Input value={typed} placeholder={PHRASE} onChange={(_, d) => setTyped(d.value)} autoFocus />
              </div>
            )}
          </DialogContent>
          <DialogActions>
            {step === 0 && <Button appearance="secondary" disabled={!!busy} onClick={close}>{t("关闭")}</Button>}
            {step === 1 && (<>
              <Button appearance="secondary" onClick={() => { setStep(0); setAck(false); }}>{t("取消")}</Button>
              <Button className="btn-danger-fill" disabled={!ack} onClick={() => setStep(2)}>{t("继续")}</Button>
            </>)}
            {step === 2 && (<>
              <Button appearance="secondary" disabled={!!busy} onClick={() => { setStep(0); setAck(false); setTyped(''); }}>{t("取消")}</Button>
              <Button className="btn-danger-fill" icon={<ArrowReset20Regular />} disabled={typed.trim() !== PHRASE || !!busy} onClick={() => void run('all', async () => { clearPrefs(); await clearCaches(); await deleteDatabase(); })}>{busy === 'all' ? t("正在清除…") : t("清除全部数据并重新开始")}</Button>
            </>)}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
