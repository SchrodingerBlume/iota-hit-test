// 收 Typst 长度：数字框 + 单位下拉。空着（allowEmpty）= 交给模板 / 自动。
import { useEffect, useState } from 'react';
import { Input, Select, type InputProps } from '@fluentui/react-components';
import { parseLength, formatLength, UNIT_LABEL, type Unit } from '../model/length';

interface Props {
  value: unknown;
  defaultUnit: Unit;
  allowed?: Unit[];
  onChange: (v: string | undefined) => void;
  placeholder?: string;
  width?: number;
  size?: InputProps['size'];
  disabled?: boolean;
  title?: string;
  allowEmpty?: boolean;
}

const ALL: Unit[] = ['cm', 'mm', 'in', 'pt', 'em', '%'];

export function LengthInput({ value, defaultUnit, allowed, onChange, placeholder, width = 110, size = 'small', disabled, title, allowEmpty = true }: Props) {
  const units = allowed ?? ALL;
  const parsed = parseLength(value, defaultUnit, units);
  const [num, setNum] = useState(parsed ? String(parsed.value) : '');
  const [unit, setUnit] = useState<Unit>(parsed?.unit ?? defaultUnit);
  useEffect(() => { setNum(parsed ? String(parsed.value) : ''); setUnit(parsed?.unit ?? defaultUnit); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [parsed ? formatLength(parsed) : '']);
  const commit = (n: string, u: Unit) => {
    const s = n.trim();
    if (!s) { if (allowEmpty) onChange(undefined); return; }
    const v = parseFloat(s);
    if (!Number.isFinite(v)) return;
    onChange(formatLength({ value: v, unit: u }));
  };
  return (
    <span className="len-input" title={title} style={{ width }}>
      <Input size={size} type="number" step="any" value={num} disabled={disabled} placeholder={placeholder ?? (allowEmpty ? '自动' : '')} className="len-num"
        onChange={(_, d) => setNum(d.value)} onBlur={() => commit(num, unit)}
        onKeyDown={(e) => { if (e.nativeEvent.isComposing) return; if (e.key === 'Enter') { e.preventDefault(); commit(num, unit); (e.target as HTMLInputElement).blur(); } }} />
      <Select size={size} value={unit} disabled={disabled} className="len-unit" onChange={(_, d) => { const u = d.value as Unit; setUnit(u); if (num.trim()) commit(num, u); }}>
        {units.map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
      </Select>
    </span>
  );
}
