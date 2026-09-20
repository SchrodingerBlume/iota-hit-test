// 统一的分段控件：自动档直接显示当前映射结果；自动为橙色，布尔开为绿色、关为红色。
import type { Settings } from '../model/types';
import { resolveSwitch, SWITCHES, type SwitchDef, type Choice } from '../model/options';
import { useStore } from '../model/store';
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
  className?: string;
}

export function TriSeg<V>({ label, hint, choices, value, auto, onChange, showAutoWhenFixed = false, className }: SegProps<V>) {
  const isAuto = value === 'auto';
  const labelOf = (v: V) => choices.find((c) => c.value === v)?.label ?? String(v);
  const toneOf = (v: V) => choices.find((c) => c.value === v)?.tone ?? 'accent';
  const eff = isAuto ? auto.value : (value as V);
  return (
    <div className={`triseg ${className ?? ''}`}>
      <div className="triseg-lab" title={hint}>{label}</div>
      <div className="seg triseg-seg" role="radiogroup" aria-label={label}>
        <button type="button" role="radio" aria-checked={isAuto} className={`auto ${isAuto ? 'on' : ''}`} onClick={() => onChange('auto')} title={t("自动：{{reason}}", { reason: auto.reason })}>
          {t("自动")}{auto.mixed ? <b className="t-mixed">{auto.mixed}</b> : <b className={`t-${toneOf(auto.value)}`}>{labelOf(auto.value)}</b>}
        </button>
        {choices.map((c) => (
          <button key={String(c.value)} type="button" role="radio" aria-checked={!isAuto && value === c.value} className={`${!isAuto && value === c.value ? `on t-${c.tone ?? 'accent'}` : ''}`} onClick={() => onChange(c.value)} title={c.hint ?? t("固定为「{{label}}」", { label: c.label })}>{c.label}</button>
        ))}
      </div>
      <div className="triseg-note" title={auto.reason}>
        {isAuto
          ? auto.reason
          : <>{t("已固定为")}{' '}<b className={`t-${toneOf(eff)}`}>{labelOf(eff)}</b>{(showAutoWhenFixed || auto.mixed || auto.value !== value) && <> · {t("自动设置为“{{v}}”", { v: auto.mixed ?? labelOf(auto.value) })}</>}</>}
      </div>
    </div>
  );
}

export const ON_OFF: SegChoice<boolean>[] = [
  { value: false, label: t("关"), tone: 'off' },
  { value: true, label: t("开"), tone: 'on' },
];

/** 按键名取一个开关，接在它所属的那一页里（摘要、缩略语、附录……）；不适用于当前档的不画 */
export function SettingSwitch({ k, className }: { k: string; className?: string }) {
  const settings = useStore((s) => s.doc.settings);
  const setSettings = useStore((s) => s.setSettings);
  const def = SWITCHES.find((d) => d.key === k);
  if (!def || (def.applies && !def.applies(settings))) return null;
  return <TriSwitch def={def} settings={settings} onChange={(v) => setSettings({ [def.key]: v } as any)} className={className} />;
}

const onOffChoices = (def: SwitchDef<any>) => (def.choices.every((c: Choice<any>) => c.label === (c.value ? t("开") : t("关"))) ? def.choices : null);
/** 论文设置里的开关：从登记表取档位与 auto 映射 */
export function TriSwitch({ def, settings, onChange, className }: { def: SwitchDef<any>; settings: Settings; onChange: (value: 'auto' | any) => void; className?: string }) {
  const raw = settings[def.key] as 'auto' | any;
  const { auto } = resolveSwitch<any>(def, settings);
  const isBool = def.choices.length === 2 && def.choices.every((c) => typeof c.value === 'boolean');
  const choices: SegChoice[] = isBool && def.choices === onOffChoices(def) ? ON_OFF : (def.choices as Choice<any>[]).map((c) => ({ value: c.value, label: c.label, hint: c.hint, tone: c.tone ?? (isBool ? (c.value ? 'on' : 'off') : 'accent') }));
  return <TriSeg label={def.label} hint={def.hint} choices={choices} value={raw} auto={auto} onChange={onChange} className={className} />;
}
