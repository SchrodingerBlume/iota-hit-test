import { useStore } from '../model/store';
import { INFO_FIELDS, INFO_GROUPS, type InfoFieldDef } from '../model/info';
import type { Info } from '../model/types';

function KeywordsInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  return (
    <input
      value={value.join('；')}
      placeholder={placeholder ?? '关键词一；关键词二'}
      onChange={(e) => onChange(e.target.value.split(/[;；,，]/).map((s) => s.trim()).filter((s, i, arr) => s || i === arr.length - 1))}
    />
  );
}

function FieldInput({ f, info, setInfo }: { f: InfoFieldDef; info: Info; setInfo: (p: Partial<Info>) => void }) {
  const v = info[f.key];
  if (f.kind === 'keywords') return <KeywordsInput value={v as string[]} onChange={(x) => setInfo({ [f.key]: x })} />;
  if (f.kind === 'textarea') return <textarea data-info={f.key} value={v as string} placeholder={f.placeholder} rows={2} onChange={(e) => setInfo({ [f.key]: e.target.value })} />;
  if (f.kind === 'month') return <input type="month" value={v as string} onChange={(e) => setInfo({ [f.key]: e.target.value })} />;
  return <input data-info={f.key} value={v as string} placeholder={f.placeholder} onChange={(e) => setInfo({ [f.key]: e.target.value })} />;
}

export function InfoPanel() {
  const info = useStore((s) => s.doc.info);
  const settings = useStore((s) => s.doc.settings);
  const setInfo = useStore((s) => s.setInfo);
  return (
    <>
      <h2>元信息</h2>
      <p className="lead">封面、内封、报告首页上的字段。当前档位用不上的字段已经折起来；留空的字段模板会印占位符，一眼看得出还没填。</p>
      {INFO_GROUPS.map((g) => {
        const fields = INFO_FIELDS.filter((f) => f.group === g && (!f.applies || f.applies(settings)));
        if (!fields.length) return null;
        return (
          <div className="card" key={g}>
            <h3>{g}</h3>
            <div className="grid2">
              {fields.map((f) => (
                <label className="field" key={f.key} style={f.kind === 'textarea' ? { gridColumn: '1 / -1' } : undefined}>
                  <span className="field-label">{f.label} <code className="muted">{f.param}</code></span>
                  <FieldInput f={f} info={info} setInfo={setInfo} />
                  {f.hint && <span className="field-hint">{f.hint}</span>}
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}
