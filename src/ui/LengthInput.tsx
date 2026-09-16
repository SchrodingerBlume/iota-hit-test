// 收 Typst 长度的输入框：打 "8cm"、"12pt"、"2em"、"100%"，光打数按默认单位。认不出就标红、不提交。
import { useEffect, useState } from 'react';
import { Input, type InputProps } from '@fluentui/react-components';
import { parseLength, formatLength, UNIT_LABEL, type Unit } from '../model/length';

interface Props {
  value: unknown;
  /** 光写数字时的单位 */
  defaultUnit: Unit;
  allowed?: Unit[];
  onChange: (v: string | undefined) => void;
  placeholder?: string;
  width?: number;
  size?: InputProps['size'];
  disabled?: boolean;
  title?: string;
  /** 空着 = 交给模板 / 自动 */
  allowEmpty?: boolean;
}

export function LengthInput({ value, defaultUnit, allowed, onChange, placeholder, width = 110, size = 'small', disabled, title, allowEmpty = true }: Props) {
  const shown = (() => { const l = parseLength(value, defaultUnit, allowed); return l ? formatLength(l) : typeof value === 'string' ? value : ''; })();
  const [text, setText] = useState(shown);
  const [bad, setBad] = useState(false);
  useEffect(() => { setText(shown); setBad(false); }, [shown]);
  const commit = (t: string) => {
    const s = t.trim();
    if (!s) { if (allowEmpty) { setBad(false); onChange(undefined); } else setBad(true); return; }
    const l = parseLength(s, defaultUnit, allowed);
    if (!l) { setBad(true); return; }
    setBad(false);
    onChange(formatLength(l));
  };
  const units = (allowed ?? ['cm', 'mm', 'in', 'pt', 'em', '%']).map((u) => UNIT_LABEL[u]).join(' / ');
  return (
    <Input
      size={size}
      className={`len-input ${bad ? 'is-bad' : ''}`}
      value={text}
      disabled={disabled}
      placeholder={placeholder ?? `如 8${UNIT_LABEL[defaultUnit]}`}
      title={title ?? `单位：${units}；光写数按 ${UNIT_LABEL[defaultUnit]}`}
      onChange={(_, d) => { setText(d.value); if (bad) setBad(!parseLength(d.value.trim() || '0', defaultUnit, allowed)); }}
      onBlur={() => commit(text)}
      onKeyDown={(e) => { if (e.nativeEvent.isComposing || e.keyCode === 229) return; if (e.key === 'Enter') { e.preventDefault(); commit(text); (e.target as HTMLInputElement).blur(); } }}
      style={{ width }}
    />
  );
}
