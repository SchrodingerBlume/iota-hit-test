// 差异视图：本地历史与 Git 共用——左列行号、加减号、改动行着色，没改的折成一行
import { useMemo } from 'react';
import { lineDiff, withContext, countChanges } from '../history/diff';
import { t as tx } from '../i18n';

export function DiffView({ before, after, full = false }: { before: string; after: string; full?: boolean }) {
  const ops = useMemo(() => { const d = lineDiff(before, after); return full ? d : withContext(d); }, [before, after, full]);
  const n = useMemo(() => countChanges(ops), [ops]);
  if (ops.length === 1 && ops[0].type === 'skip' && ops[0].n === -1) return <p className="muted">{tx("内容过长，无法生成差异。")}</p>;
  if (!n.add && !n.del) return <p className="muted">{tx("没有改动。")}</p>;
  return (
    <div className="diff">
      <div className="diff-sum"><b className="diff-add">+{n.add}</b> <b className="diff-del">−{n.del}</b></div>
      <pre className="diff-body">
        {ops.map((o, i) => o.type === 'skip'
          ? <div key={i} className="diff-skip">{tx("… {{n}} 行未变 …", { n: o.n })}</div>
          : <div key={i} className={`diff-line is-${o.type}`}><span className="diff-mark">{o.type === 'add' ? '+' : o.type === 'del' ? '−' : ' '}</span>{o.text || ' '}</div>)}
      </pre>
    </div>
  );
}
