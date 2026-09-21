// 对话里模型说的话：Markdown 渲成 React（不经 HTML 字符串，模型的话不会变成标签），代码块带语言与复制，
// $…$ / $$…$$ 用 KaTeX 画。marked 只用来切记号
import { useState, type ReactNode } from 'react';
import { marked, type Token, type Tokens } from 'marked';
import { Copy16Regular, Checkmark16Regular } from '@fluentui/react-icons';
import { katexHtml } from '../editor/math/MathPreview';
import { t as tx } from '../i18n';

const Tex = ({ src, display }: { src: string; display: boolean }) => {
  const { html, error } = katexHtml(src, display);
  return <span className={`ag-math ${display ? 'is-display' : ''}`} title={error} dangerouslySetInnerHTML={{ __html: html }} />;
};

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(code); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* 剪贴板不可用 */ } };
  return (
    <div className="ag-code">
      <div className="ag-code-head"><span>{lang || 'text'}</span><button type="button" onClick={copy} title={tx("复制代码")}>{done ? <Checkmark16Regular /> : <Copy16Regular />}{done ? tx("已复制") : tx("复制")}</button></div>
      <pre><code>{code}</code></pre>
    </div>
  );
}

// 公式先从原文里摘出来换成占位符（不然 $x_1 + y_2$ 里的下划线会被 marked 当成斜体），围栏代码里的不摘
const MATH_RE = /\$\$([\s\S]+?)\$\$|(?<![\\$\w])\$(?!\s|\d)([^$\n]+?)(?<!\s)\$(?![\w$])/g;
const HOLD = /\uE000(\d+)\uE001/g;
function extractMath(text: string): { text: string; math: { src: string; display: boolean }[] } {
  const math: { src: string; display: boolean }[] = [];
  const parts = text.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/);
  const out = parts.map((seg, i) => (i % 2 ? seg : seg.replace(MATH_RE, (_m, a, b) => { math.push({ src: (a ?? b).trim(), display: a !== undefined }); return `\uE000${math.length - 1}\uE001`; })));
  return { text: out.join(''), math };
}
let mathTable: { src: string; display: boolean }[] = [];
function withMath(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0, m: RegExpExecArray | null, k = 0;
  HOLD.lastIndex = 0;
  while ((m = HOLD.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const mm = mathTable[Number(m[1])];
    if (mm) out.push(<Tex key={k++} src={mm.src} display={mm.display} />);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function inline(tokens: Token[] = []): ReactNode[] {
  return tokens.map((token, i) => {
    const t = token as any;
    switch (t.type) {
      case 'text': case 'escape': return t.tokens ? <span key={i}>{inline(t.tokens)}</span> : <span key={i}>{withMath(t.text)}</span>;
      case 'strong': return <strong key={i}>{inline(t.tokens)}</strong>;
      case 'em': return <em key={i}>{inline(t.tokens)}</em>;
      case 'del': return <del key={i}>{inline(t.tokens)}</del>;
      case 'codespan': return <code key={i} className="ag-inline-code">{t.text}</code>;
      case 'br': return <br key={i} />;
      case 'link': return <a key={i} href={/^(https?:|mailto:)/.test(t.href) ? t.href : undefined} target="_blank" rel="noreferrer">{inline(t.tokens)}</a>;
      case 'image': return <span key={i}>{t.text}</span>;
      case 'html': return <span key={i}>{t.raw}</span>;
      default: return <span key={i}>{t.raw ?? ''}</span>;
    }
  });
}

function blocks(tokens: Token[]): ReactNode[] {
  return tokens.map((token, i) => {
    const t = token as any;
    switch (t.type) {
      case 'space': return null;
      case 'paragraph': return <p key={i} className="ag-p">{inline(t.tokens)}</p>;
      case 'heading': { const Tag = `h${Math.min(6, Number(t.depth) + 2)}` as 'h3'; return <Tag key={i} className="ag-h">{inline(t.tokens)}</Tag>; }
      case 'code': return <CodeBlock key={i} lang={t.lang ?? ''} code={t.text} />;
      case 'blockquote': return <blockquote key={i}>{blocks(t.tokens)}</blockquote>;
      case 'list': return t.ordered
        ? <ol key={i} start={t.start || 1}>{t.items.map((it: Tokens.ListItem, j: number) => <li key={j}>{blocks(it.tokens)}</li>)}</ol>
        : <ul key={i}>{t.items.map((it: Tokens.ListItem, j: number) => <li key={j}>{it.task && <input type="checkbox" checked={!!it.checked} readOnly />}{blocks(it.tokens)}</li>)}</ul>;
      case 'table': return (
        <div key={i} className="ag-table"><table>
          <thead><tr>{t.header.map((c: Tokens.TableCell, j: number) => <th key={j} style={{ textAlign: t.align[j] ?? undefined }}>{inline(c.tokens)}</th>)}</tr></thead>
          <tbody>{t.rows.map((r: Tokens.TableCell[], ri: number) => <tr key={ri}>{r.map((c, j) => <td key={j} style={{ textAlign: t.align[j] ?? undefined }}>{inline(c.tokens)}</td>)}</tr>)}</tbody>
        </table></div>
      );
      case 'hr': return <hr key={i} />;
      case 'html': return <p key={i} className="ag-p">{t.raw}</p>;
      case 'text': return <p key={i} className="ag-p">{t.tokens ? inline(t.tokens) : withMath(t.text)}</p>;
      default: return <p key={i} className="ag-p">{t.raw ?? ''}</p>;
    }
  });
}

export function ChatMarkdown({ text }: { text: string }) {
  const ex = extractMath(text);
  let tokens: Token[];
  try { tokens = marked.lexer(ex.text, { gfm: true, breaks: true }); } catch { return <p className="ag-p">{text}</p>; }
  mathTable = ex.math;
  return <div className="ag-md">{blocks(tokens)}</div>;
}
