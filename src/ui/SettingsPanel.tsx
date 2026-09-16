import { useStore } from '../model/store';
import { AXES, SWITCHES, SWITCH_GROUPS, resolveSwitch } from '../model/options';
import { LengthInput } from './LengthInput';
import { TriSwitch } from './TriSwitch';
import { FontCard } from './FontCard';
import { t } from '../i18n';

export function SettingsPanel() {
  const settings = useStore((s) => s.doc.settings);
  const setSettings = useStore((s) => s.setSettings);
  return (
    <>
      <h2>{t("论文设置")}</h2>
      <div className="card">
        <h3>{t("论文类型")}</h3>
        {AXES.filter((a) => !a.applies || a.applies(settings)).map((a) => (
          <div className="axis" key={a.key}>
            <div className="lab" title={a.hint}>{a.label}</div>
            <div>
              <select value={settings[a.key] as string} onChange={(e) => setSettings({ [a.key]: e.target.value } as any)}>
                {a.choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
          </div>
        ))}
      </div>
      <FontCard />
      {SWITCH_GROUPS.map((g) => {
        const defs = SWITCHES.filter((d) => d.group === g && (!d.applies || d.applies(settings)));
        if (!defs.length) return null;
        return (
          <div className="card" key={g}>
            <h3>{g}</h3>
            {defs.map((d) => <TriSwitch key={d.key} def={d} settings={settings} onChange={(v) => setSettings({ [d.key]: v } as any)} />)}
            {g === t("排版引擎") && resolveSwitch<boolean>(SWITCHES.find((d) => d.key === 'charGrid')!, settings).effective && (
              <label className="tb-field" title={t("一格的宽度（Word 页面设置里的「字符间距」）。留空 = 模板本档的值，终稿 12.45 pt；导出时写成 layout: (char-pitch: …)")}>
                {t("网格跨度")} <LengthInput value={settings.charPitch === 'auto' ? '' : `${settings.charPitch}pt`} defaultUnit="pt" allowed={['pt']} placeholder={t("模板")} width={110} onChange={(v) => setSettings({ charPitch: v ? parseFloat(v) : 'auto' })} />
              </label>
            )}
          </div>
        );
      })}
    </>
  );
}
