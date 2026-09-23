// 免责声明：第一次打开必须同意才能用（挡在整个界面前面，没有关闭、不能点外面、Esc 也不走）。
// 同意过就记在本机；声明本身改了（VERSION 加一）会再问一次。顶栏上常留一颗「开发中」，点开还能再看
import { useState } from 'react';
import { create } from 'zustand';
import { Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions, Button, Checkbox } from '@fluentui/react-components';
import { Warning20Filled } from '@fluentui/react-icons';
import { Logo } from './Logo';
import { t } from '../i18n';

const KEY = 'iota4web-disclaimer';
/** 声明的版本：改了文字就加一，让同意过的人再看一遍 */
const VERSION = 1;
const accepted = (): boolean => { try { return Number(localStorage.getItem(KEY)) >= VERSION; } catch { return false; } };

export const useDisclaimer = create<{ accepted: boolean; reading: boolean; accept: () => void; read: (v: boolean) => void }>((set) => ({
  accepted: accepted(),
  reading: false,
  accept: () => { try { localStorage.setItem(KEY, String(VERSION)); } catch { /* */ } set({ accepted: true }); },
  read: (reading) => set({ reading }),
}));

/** 声明正文：首次的那道闸与「关于」里复看都用它 */
export function DisclaimerText() {
  return (
    <div className="dc-text">
      <p className="dc-lead"><Warning20Filled />{t("本产品目前处于活跃开发阶段。")}</p>
      <p>{t("功能、界面、数据格式、导出结果与排版表现都可能随时更改或出错，工程文件也可能在版本之间不兼容。我们不保证任何一次排版的结果符合学校或期刊的格式要求。")}</p>
      <p>{t("请勿把本站当作唯一的写作与存档工具：文档只保存在当前浏览器中，清理浏览数据、更换设备或浏览器升级都可能导致丢失。请自行频繁备份（“文件 → 下载副本”），并在提交前用官方模板核对成稿。")}</p>
      <p>{t("本站按“现状”提供，不作任何明示或默示的担保。因使用本站（含预览、导出 PDF / Word、Agent 功能及其产生的内容）而造成的任何损失——包括但不限于数据丢失、格式不合规、延误答辩或投稿、学术与法律后果——均由使用者自行承担，与 hithesis 团队及本站作者、以及 Typst、typst.ts 等上游项目的作者无关。")}</p>
      <p className="muted">{t("Agent 功能会把你填入的密钥与文档内容直接发给你选定的模型服务方，请自行确认其隐私政策与合规要求。")}</p>
    </div>
  );
}

export function DisclaimerGate() {
  const ok = useDisclaimer((s) => s.accepted);
  const reading = useDisclaimer((s) => s.reading);
  const accept = useDisclaimer((s) => s.accept);
  const read = useDisclaimer((s) => s.read);
  const [ack, setAck] = useState(false);
  const first = !ok;
  return (
    <Dialog open={first || reading} modalType={first ? 'alert' : 'modal'} onOpenChange={(_, d) => { if (!d.open && !first) read(false); }}>
      <DialogSurface className="dc-dialog">
        <DialogBody>
          <DialogTitle><span className="dc-title"><Logo size={34} />{t("使用前请知悉")}</span></DialogTitle>
          <DialogContent>
            <DisclaimerText />
            {first && <Checkbox className="dc-ack" checked={ack} onChange={(_, d) => setAck(!!d.checked)} label={t("我已阅读并理解上述内容，自愿承担使用本站的全部风险")} />}
          </DialogContent>
          <DialogActions>
            {first
              ? <Button appearance="primary" disabled={!ack} onClick={accept}>{t("同意并开始使用")}</Button>
              : <Button appearance="primary" onClick={() => read(false)}>{t("知道了")}</Button>}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

/** 顶栏上常留的那颗：一眼看出还在开发中，点开复看声明 */
export function DevBadge() {
  const read = useDisclaimer((s) => s.read);
  return <button type="button" className="dev-badge" title={t("本产品处于活跃开发阶段，点击查看免责声明")} onClick={() => read(true)}><Warning20Filled />{t("开发中")}</button>;
}
