// 关键词这种「一串短项」的输入：一项一个标签，✕ 删，回车 / 逗号 / 分号 / 失焦时把输入框里的加进去。
import { useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';

export function TagInput({ value, onChange, placeholder, dataInfo }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; dataInfo?: string }) {
  const [draft, setDraft] = useState('');
  const commit = () => {
    const parts = draft.split(/[;；,，]/).map((s) => s.trim()).filter(Boolean);
    if (parts.length) onChange([...value, ...parts.filter((p) => !value.includes(p))]);
    setDraft('');
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === '，' || e.key === ';' || e.key === '；') { e.preventDefault(); commit(); }
    else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
  };
  return (
    <div className="tags" onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement)?.focus()}>
      {value.map((t, i) => (
        <span key={t + i} className="tag-item">
          {t}
          <button type="button" title="删除" onClick={(e) => { e.stopPropagation(); onChange(value.filter((_, j) => j !== i)); }}><X /></button>
        </span>
      ))}
      <input data-info={dataInfo} value={draft} placeholder={value.length ? '' : placeholder ?? '输入后回车'} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onBlur={commit} />
    </div>
  );
}
