import { useStore } from '../model/store';
import { INFO_FIELDS, INFO_GROUPS, localInfoFields } from '../model/info';
import type { LocalInfoPage } from '../model/types';
import { resolvePage } from '../model/pages';
import { InfoField } from './InfoField';
import { SettingSwitch } from './TriSwitch';
import { PageSettings } from './panels';
import { t } from '../i18n';
const tx = t;

export function InfoPanel() {
  const info = useStore((s) => s.doc.info);
  const settings = useStore((s) => s.doc.settings);
  const setInfo = useStore((s) => s.setInfo);
  return (
    <>
      <h2>{t("论文信息")}</h2>
      {INFO_GROUPS.map((g) => {
        const fields = INFO_FIELDS.filter((f) => f.group === g && !f.place && (!f.applies || f.applies(settings)));
        if (!fields.length) return null;
        return (
          <div className="card" key={g}>
            <h3>{g}</h3>
            <div className="grid2">
              {fields.map((f) => <InfoField key={f.key} f={f} value={info[f.key]} onChange={(v) => setInfo({ [f.key]: v })} />)}
            </div>
          </div>
        );
      })}
    </>
  );
}

/** 只改这一页的元信息：留空印「论文信息」那一份（占位符里显示），填了只改这一页 */
function LocalInfoCard({ page }: { page: LocalInfoPage }) {
  const info = useStore((s) => s.doc.info);
  const local = useStore((s) => s.doc.localInfo?.[page]);
  const settings = useStore((s) => s.doc.settings);
  const setLocalInfo = useStore((s) => s.setLocalInfo);
  return (
    <div className="card">
      <h3>{tx("本页专用信息")}</h3>
      <p className="field-hint">{tx("留空时使用“论文信息”中的内容；填写后仅覆盖当前页面。")}</p>
      <div className="grid2">
        {localInfoFields(page, settings).map((f) => (
          <InfoField key={f.key} f={f} value={local?.[f.key] ?? (f.kind === 'keywords' ? [] : '')} onChange={(v) => setLocalInfo(page, { [f.key]: v })}
            placeholder={String(info[f.key] || f.placeholder || '')} hint={f.kind === 'textarea' ? f.hint : undefined} attr={`${page}.${f.key}`} />
        ))}
      </div>
    </div>
  );
}

export function CoverPanel() {
  return (
    <>
      <h2>{tx("封面")}</h2>
      <PageSettings pages={['cover']}><SettingSwitch k="titleEnXiaoer" /></PageSettings>
      <LocalInfoCard page="cover" />
    </>
  );
}

export function TitlepagePanel() {
  const shown = useStore((s) => resolvePage(s.doc, 'titlepage').value);
  return (
    <>
      <h2>{tx("内封")}</h2>
      <PageSettings pages={['titlepage']}><SettingSwitch k="titleEnXiaoerTitlepage" /></PageSettings>
      {shown && <LocalInfoCard page="titlepage" />}
    </>
  );
}
