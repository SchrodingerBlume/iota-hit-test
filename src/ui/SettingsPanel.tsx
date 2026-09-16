import { useStore } from '../model/store';
import { AXES, SWITCHES, SWITCH_GROUPS } from '../model/options';
import { TriSwitch } from './TriSwitch';
import { FontCard } from './FontCard';

export function SettingsPanel() {
  const settings = useStore((s) => s.doc.settings);
  const setSettings = useStore((s) => s.setSettings);
  return (
    <>
      <h2>论文设置</h2>
      <div className="card">
        <h3>论文类型</h3>
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
          </div>
        );
      })}
    </>
  );
}
