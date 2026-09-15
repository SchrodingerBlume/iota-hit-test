// 三态开关。
//
// 模板里这些选项的默认都是 auto——不是「没设」，而是「模板按学位、阶段、校区
// 自己算」。所以开关有三个停靠位：  关 ｜ A ｜ 开
//
//   · 滑块在两端 = 用户明确定了（开是蓝、关是灰）
//   · 滑块居中印「A」= 自动。这时向映射到的那一端延伸一段淡蓝「影子」，
//     那一端的字加重，下面一行小字写明「自动 → 开 · 为什么」
//
// 于是选自动档时也一眼知道它现在等于什么，而且知道换了学位它会跟着变。
// 点两端选定，点中间回自动；键盘 ← → 移动，A 回自动。
import type { Settings } from '../model/types';
import { resolveSwitch, type SwitchDef, type Choice } from '../model/options';

interface Props {
  def: SwitchDef<any>;
  settings: Settings;
  onChange: (value: 'auto' | any) => void;
}

export function TriSwitch({ def, settings, onChange }: Props) {
  const raw = settings[def.key] as 'auto' | any;
  const { effective, auto, isAuto } = resolveSwitch<any>(def, settings);
  const isBool = def.choices.length === 2 && def.choices.every((c) => typeof c.value === 'boolean');
  if (!isBool) return <MultiChoice def={def} raw={raw} auto={auto} isAuto={isAuto} onChange={onChange} />;

  const [off, on] = def.choices as Choice<boolean>[];
  const pos = isAuto ? 1 : raw === true ? 2 : 0;
  const target = auto.value ? 'on' : 'off';

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); onChange(pos === 2 ? 'auto' : false); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); onChange(pos === 0 ? 'auto' : true); }
    else if (e.key.toLowerCase() === 'a') { e.preventDefault(); onChange('auto'); }
  };

  return (
    <div className="tri">
      <div>
        <div className="tri-lab" title={def.hint}>{def.label}</div>
      </div>
      <div className="tri-track" data-pos={pos} role="radiogroup" aria-label={def.label} onKeyDown={onKey}>
        {isAuto && <span className={`ghost ${target === 'on' ? 'right' : 'left'}`} aria-hidden />}
        <span className="thumb" aria-hidden />
        <button type="button" role="radio" aria-checked={pos === 0} className={`stop off ${pos === 0 ? 'is-current' : ''} ${isAuto && target === 'off' ? 'is-target' : ''}`} onClick={() => onChange(false)} title={`固定为「${off.label}」`}>{off.label}</button>
        <button type="button" role="radio" aria-checked={pos === 1} className={`stop auto ${pos === 1 ? 'is-current' : ''}`} onClick={() => onChange('auto')} title="自动：交给模板按档位决定">A</button>
        <button type="button" role="radio" aria-checked={pos === 2} className={`stop on ${pos === 2 ? 'is-current' : ''} ${isAuto && target === 'on' ? 'is-target' : ''}`} onClick={() => onChange(true)} title={`固定为「${on.label}」`}>{on.label}</button>
      </div>
      <div className="tri-note">
        {isAuto
          ? <><span className="auto-tag">A</span>自动 → <b>{effective ? on.label : off.label}</b> · {auto.reason}</>
          : <>已固定为 <b>{raw ? on.label : off.label}</b>{auto.value !== raw && <>（自动档会是「{auto.value ? on.label : off.label}」：{auto.reason}）</>}</>}
      </div>
    </div>
  );
}

/** 多于两档的选项（附录编号 A/1/一、学位类别）：分段按钮，自动那一段印出映射值 */
function MultiChoice({ def, raw, auto, isAuto, onChange }: { def: SwitchDef<any>; raw: any; auto: { value: any; reason: string }; isAuto: boolean; onChange: (v: any) => void }) {
  const labelOf = (v: any) => def.choices.find((c) => c.value === v)?.label ?? String(v);
  return (
    <div className="multi">
      <div className="tri-lab" title={def.hint}>{def.label}</div>
      <span className="seg" role="radiogroup" aria-label={def.label}>
        <button type="button" role="radio" aria-checked={isAuto} className={`auto ${isAuto ? 'on' : ''}`} onClick={() => onChange('auto')} title="自动：交给模板按档位决定">
          A <small>→{labelOf(auto.value)}</small>
        </button>
        {def.choices.map((c) => (
          <button key={String(c.value)} type="button" role="radio" aria-checked={!isAuto && raw === c.value} className={!isAuto && raw === c.value ? 'on' : ''} onClick={() => onChange(c.value)} title={c.hint ?? c.label}>{c.label}</button>
        ))}
      </span>
      <div className="tri-note">
        {isAuto
          ? <><span className="auto-tag">A</span>自动 → <b>{labelOf(auto.value)}</b> · {auto.reason}</>
          : <>已固定为 <b>{labelOf(raw)}</b>{auto.value !== raw && <>（自动档会是「{labelOf(auto.value)}」：{auto.reason}）</>}</>}
      </div>
    </div>
  );
}
