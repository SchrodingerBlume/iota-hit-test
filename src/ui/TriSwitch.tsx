// 统一的分段控件：所有「auto / 值」型的选项都用它——布尔开关、多档选项、页面排不排。
//
//   [ Auto → 开 ] [ 关 ] [ 开 ]         布尔：开绿、关红、Auto 橙
//   [ Auto → A ] [ A ] [ 1 ] [ 一 ]     多档：选中的蓝
//
// Auto 段直接写出它现在映射到什么，下面一行小字说为什么。
import type { Settings } from '../model/types';
import { resolveSwitch, type SwitchDef, type Choice } from '../model/options';

export interface SegChoice<V = any> { value: V; label: string; tone?: 'on' | 'off' | 'accent'; hint?: string }

interface SegProps<V> {
  label: string;
  hint?: string;
  choices: SegChoice<V>[];
  /** 当前值：'auto' 或某个 choice 的 value */
  value: 'auto' | V;
  auto: { value: V; reason: string };
  onChange: (v: 'auto' | V) => void;
  /** 固定为某值时也提示自动档会是什么 */
  showAutoWhenFixed?: boolean;
}

export function TriSeg<V>({ label, hint, choices, value, auto, onChange, showAutoWhenFixed = true }: SegProps<V>) {
  const isAuto = value === 'auto';
  const labelOf = (v: V) => choices.find((c) => c.value === v)?.label ?? String(v);
  const toneOf = (v: V) => choices.find((c) => c.value === v)?.tone ?? 'accent';
  const eff = isAuto ? auto.value : (value as V);
  return (
    <div className="triseg">
      <div className="triseg-lab" title={hint}>{label}</div>
      <div className="seg triseg-seg" role="radiogroup" aria-label={label}>
        <button type="button" role="radio" aria-checked={isAuto} className={`auto ${isAuto ? 'on' : ''}`} onClick={() => onChange('auto')} title={`自动：${auto.reason}`}>
          Auto<span className="triseg-arrow">→</span><b className={`t-${toneOf(auto.value)}`}>{labelOf(auto.value)}</b>
        </button>
        {choices.map((c) => (
          <button key={String(c.value)} type="button" role="radio" aria-checked={!isAuto && value === c.value} className={`${!isAuto && value === c.value ? `on t-${c.tone ?? 'accent'}` : ''}`} onClick={() => onChange(c.value)} title={c.hint ?? `固定为「${c.label}」`}>{c.label}</button>
        ))}
      </div>
      <div className="triseg-note">
        {isAuto
          ? <>自动 → <b className={`t-${toneOf(eff)}`}>{labelOf(eff)}</b> · {auto.reason}</>
          : <>已固定为 <b className={`t-${toneOf(eff)}`}>{labelOf(eff)}</b>{showAutoWhenFixed && auto.value !== value && <span className="muted">（自动档会是「{labelOf(auto.value)}」：{auto.reason}）</span>}</>}
      </div>
    </div>
  );
}

export const ON_OFF: SegChoice<boolean>[] = [
  { value: false, label: '关', tone: 'off' },
  { value: true, label: '开', tone: 'on' },
];

/** 论文设置里的开关：从登记表取档位与 auto 映射 */
export function TriSwitch({ def, settings, onChange }: { def: SwitchDef<any>; settings: Settings; onChange: (value: 'auto' | any) => void }) {
  const raw = settings[def.key] as 'auto' | any;
  const { auto } = resolveSwitch<any>(def, settings);
  const isBool = def.choices.length === 2 && def.choices.every((c) => typeof c.value === 'boolean');
  const choices: SegChoice[] = isBool ? ON_OFF : (def.choices as Choice<any>[]).map((c) => ({ value: c.value, label: c.label, hint: c.hint, tone: 'accent' as const }));
  return <TriSeg label={def.label} hint={def.hint} choices={choices} value={raw} auto={auto} onChange={onChange} />;
}
