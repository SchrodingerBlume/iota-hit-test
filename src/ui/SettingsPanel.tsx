import { useStore } from '../model/store';
import { AXES, SWITCHES, SWITCH_GROUPS, BACHELOR_DOCUMENT_TYPES, axisChoices, settingUnavailable } from '../model/options';
import { TriSwitch } from './TriSwitch';
import { FontCard } from './FontCard';
import { OpenrightSwitch } from './panels';
import { t } from '../i18n';

export function SettingsPanel() {
  const settings = useStore((s) => s.doc.settings);
  const setSettings = useStore((s) => s.setSettings);
  return (
    <>
      <h2>{t("论文设置")}</h2>
      <div className="card">
        <h3>{t("论文类型")}</h3>
        {AXES.filter((a) => a.key !== 'bachelorDocumentType' && (!a.applies || a.applies(settings))).map((a) => (
          <div className="axis" key={a.key}>
            <div className="lab" title={a.hint}>{a.label}</div>
            <div style={a.key === 'degreeLevel' && settings.degreeLevel === 'bachelor' ? { display: 'flex', gap: 8 } : undefined}>
              <select style={a.key === 'degreeLevel' && settings.degreeLevel === 'bachelor' ? { flex: '1 1 0', minWidth: 0 } : undefined} value={settings[a.key] as string} onChange={(e) => setSettings({ [a.key]: e.target.value } as any)}>
                {axisChoices(a, settings).map((c) => <option key={c.value} value={c.value} disabled={!!settingUnavailable(settings, a.key, c.value)} title={settingUnavailable(settings, a.key, c.value)}>{c.label}</option>)}
              </select>
              {a.key === 'degreeLevel' && settings.degreeLevel === 'bachelor' && <select aria-label={t('本科文档类型')} style={{ flex: '1 1 0', minWidth: 0 }} value={settings.bachelorDocumentType ?? 'graduation'} onChange={e => setSettings({ bachelorDocumentType: e.target.value as 'graduation' | 'comprehensive' })}>
                {BACHELOR_DOCUMENT_TYPES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>}
            </div>
          </div>
        ))}
        {SWITCHES.filter((d) => d.place === 'type' && (d.keepVisible || !d.applies || d.applies(settings))).map((d) => <TriSwitch key={d.key} def={d} settings={settings} onChange={(v) => setSettings({ [d.key]: v } as any)} />)}
      </div>
      <FontCard />
      {SWITCH_GROUPS.map((g) => {
        const defs = SWITCHES.filter((d) => d.group === g && !d.place && (!d.applies || d.applies(settings)));
        if (!defs.length) return null;
        return (
          <div className="card" key={g}>
            <h3>{g}</h3>
            {defs.map((d) => {
              const sw = <TriSwitch key={d.key} def={d} settings={settings} onChange={(v) => setSettings({ [d.key]: v } as any)} />;
              // 全篇的右翻页总闸下面挂前置 / 正文两段各自的
              return d.key === 'openright' ? <div key={d.key} className="page-row">{sw}<OpenrightSwitch orKey="frontmatter" label={t("前置部分")} sub /></div> : sw;
            })}
          </div>
        );
      })}
    </>
  );
}
