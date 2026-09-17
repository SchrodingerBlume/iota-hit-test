// 统一的分段控件：自动档直接显示当前映射结果；自动为橙色，布尔开为绿色、关为红色。
import type { Settings } from '../model/types';
import { resolveSwitch, type SwitchDef, type Choice } from '../model/options';
import { t } from '../i18n';

export interface SegChoice<V = any> { value: V; label: string; tone?: 'on' | 'off' | 'accent'; hint?: string }

interface SegProps<V> {
  label: string;
  hint?: string;
  choices: SegChoice<V>[];
  /** 当前值：'auto' 或某个 choice 的 value */
  value: 'auto' | V;
  auto: { value: V; reason: string; mixed?: string };
  onChange: (v: 'auto' | V) => void;
  /** 固定为某值时也提示自动档会是什么 */
  showAutoWhenFixed?: boolean;
}

export function TriSeg<V>({ label, hint, choices, value, auto, onChange, showAutoWhenFixed = false }: SegProps<V>) {
  const isAuto = value === 'auto';
  const labelOf = (v: V) => choices.find((c) => c.value === v)?.label ?? String(v);
  const toneOf = (v: V) => choices.find((c) => c.value === v)?.tone ?? 'accent';
  const eff = isAuto ? auto.value : (value as V);
  return (
    <div className="triseg">
      <div className="triseg-lab" title={hint}>{label}</div>
      <div className="seg triseg-seg" role="radiogroup" aria-label={label}>
        <button type="button" role="radio" aria-checked={isAuto} className={`auto ${isAuto ? 'on' : ''}`} onClick={() => onChange('auto')} title={t("自动：{{reason}}", { reason: auto.reason })}>
          Auto<span className="triseg-arrow">→</span>{auto.mixed ? <b className="t-mixed">{auto.mixed}</b> : <b className={`t-${toneOf(auto.value)}`}>{labelOf(auto.value)}</b>}
        </button>
        {choices.map((c) => (
          <button key={String(c.value)} type="button" role="radio" aria-checked={!isAuto && value === c.value} className={`${!isAuto && value === c.value ? `on t-${c.tone ?? 'accent'}` : ''}`} onClick={() => onChange(c.value)} title={c.hint ?? t("固定为「{{label}}」", { label: c.label })}>{c.label}</button>
        ))}
      </div>
      <div className="triseg-note">
        {isAuto
          ? <>{t("自动 →")}{' '}{auto.mixed ? <b className="t-mixed">{auto.mixed}</b> : <b className={`t-${toneOf(eff)}`}>{labelOf(eff)}</b>} · {auto.reason}</>
          : <>{t("已固定为")}{' '}<b className={`t-${toneOf(eff)}`}>{labelOf(eff)}</b>{showAutoWhenFixed && (auto.mixed || auto.value !== value) && <span className="muted">{t("（自动档会是「")}{auto.mixed ?? labelOf(auto.value)}」：{auto.reason}）</span>}</>}
      </div>
    </div>
  );
}

export const ON_OFF: SegChoice<boolean>[] = [
  { value: false, label: t("关"), tone: 'off' },
  { value: true, label: t("开"), tone: 'on' },
];

/** 论文设置里的开关：从登记表取档位与 auto 映射 */
export function TriSwitch({ def, settings, onChange }: { def: SwitchDef<any>; settings: Settings; onChange: (value: 'auto' | any) => void }) {
  const raw = settings[def.key] as 'auto' | any;
  const { auto } = resolveSwitch<any>(def, settings);
  const isBool = def.choices.length === 2 && def.choices.every((c) => typeof c.value === 'boolean');
  const choices: SegChoice[] = isBool ? ON_OFF : (def.choices as Choice<any>[]).map((c) => ({ value: c.value, label: c.label, hint: c.hint, tone: 'accent' as const }));
  return <TriSeg label={def.label} hint={def.hint} choices={choices} value={raw} auto={auto} onChange={onChange} />;
}
