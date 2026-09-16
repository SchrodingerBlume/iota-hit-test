import { useStore } from '../model/store';
import { INFO_FIELDS, INFO_GROUPS, type InfoFieldDef } from '../model/info';
import type { Info } from '../model/types';
import { TagInput } from './TagInput';
import { t } from '../i18n';

function FieldInput({ f, info, setInfo }: { f: InfoFieldDef; info: Info; setInfo: (p: Partial<Info>) => void }) {
  const v = info[f.key];
  if (f.kind === 'keywords') return <TagInput value={v as string[]} onChange={(x) => setInfo({ [f.key]: x })} placeholder={f.key === 'keywords' ? t("输入一个关键词后回车") : 'keyword, then Enter'} dataInfo={f.key} />;
  if (f.kind === 'textarea') return <textarea data-info={f.key} value={v as string} placeholder={f.placeholder} rows={2} onChange={(e) => setInfo({ [f.key]: e.target.value })} />;
  if (f.kind === 'month') return <input data-info={f.key} type="month" value={v as string} onChange={(e) => setInfo({ [f.key]: e.target.value })} />;
  return <input data-info={f.key} value={v as string} placeholder={f.placeholder} onChange={(e) => setInfo({ [f.key]: e.target.value })} />;
}

export function InfoPanel() {
  const info = useStore((s) => s.doc.info);
  const settings = useStore((s) => s.doc.settings);
  const setInfo = useStore((s) => s.setInfo);
  return (
    <>
      <h2>{t("论文信息")}</h2>
      {INFO_GROUPS.map((g) => {
        const fields = INFO_FIELDS.filter((f) => f.group === g && (!f.applies || f.applies(settings)));
        if (!fields.length) return null;
        return (
          <div className="card" key={g}>
            <h3>{g}</h3>
            <div className="grid2">
              {fields.map((f) => (
                <label className="field" key={f.key} style={f.kind === 'textarea' ? { gridColumn: '1 / -1' } : undefined}>
                  <span className="field-label">{f.label}</span>
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
