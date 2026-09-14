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
      <p className="lead">校区、学位、阶段这几根轴决定整份版面；其余开关默认交给模板按档位映射，下面每一条都写着自动档现在等于什么。</p>
      <div className="card">
        <h3>档位</h3>
        {AXES.map((a) => (
          <div className="axis" key={a.key}>
            <div className="lab">{a.label}</div>
            <div>
              <select value={settings[a.key] as string} onChange={(e) => setSettings({ [a.key]: e.target.value } as any)}>
                {a.choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
              <div className="hint">{a.hint}</div>
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
