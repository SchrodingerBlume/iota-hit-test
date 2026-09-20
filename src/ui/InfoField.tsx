// 一格元信息：标签、输入框、提示。「论文信息」、摘要页的关键词、封面内封只改这一页的那几项都用它。
import type { InfoFieldDef } from '../model/info';
import { TagInput } from './TagInput';
import { t } from '../i18n';

type Value = string | string[];

function FieldInput({ f, value, onChange, placeholder, attr }: { f: InfoFieldDef; value: Value; onChange: (v: Value) => void; placeholder?: string; attr: string }) {
  if (f.kind === 'keywords') return <TagInput value={value as string[]} onChange={onChange} placeholder={f.key === 'keywords' ? t("输入关键词后按 Enter") : 'keyword, then Enter'} dataInfo={attr} />;
  if (f.kind === 'textarea') return <textarea data-info={attr} value={value as string} placeholder={placeholder} rows={2} onChange={(e) => onChange(e.target.value)} />;
  if (f.kind === 'month') return <input data-info={attr} type="month" value={value as string} onChange={(e) => onChange(e.target.value)} />;
  return <input data-info={attr} value={value as string} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}

/** attr 是输入框的 data-info，预览里点到这个字就跳到它；只改这一页的带页名（cover.title） */
export function InfoField({ f, value, onChange, placeholder = f.placeholder, hint = f.hint, attr = f.key, children }: { f: InfoFieldDef; value: Value; onChange: (v: Value) => void; placeholder?: string; hint?: string; attr?: string; children?: React.ReactNode }) {
  // 关键词那种带按钮的复合控件不能套 <label>：点标签任何地方都会转成点里面第一个按钮（第一个 ✕）
  const Tag = f.kind === 'keywords' ? 'div' : 'label';
  return (
    <Tag className="field" style={f.kind === 'textarea' ? { gridColumn: '1 / -1' } : undefined}>
      <span className="field-label">{f.label}</span>
      <FieldInput f={f} value={value} onChange={onChange} placeholder={placeholder} attr={attr} />
      {hint && <span className="field-hint">{hint}</span>}
      {children}
    </Tag>
  );
}
