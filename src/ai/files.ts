// 发给模型的附件：图片原样（base64），PDF 与文本按接口折——Anthropic 认 PDF 与文本文档块；
// OpenAI 兼容的大多只认图片，PDF 就在本机用 pdf.js 抽成文字再发，文本文件直接贴
export interface Attachment { id: string; name: string; type: string; size: number; kind: 'image' | 'pdf' | 'text'; data: string }

const MAX = 20 * 1024 * 1024;
const TEXT_EXT = /\.(txt|md|markdown|bib|csv|tsv|json|tex|typ|yaml|yml|xml|html?|py|js|ts|rs|c|cpp|h|java|m|r)$/i;
const uid = () => Math.random().toString(36).slice(2, 9);

const readB64 = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] ?? ''); r.onerror = () => rej(r.error); r.readAsDataURL(f); });

export async function readAttachment(f: File): Promise<Attachment> {
  if (f.size > MAX) throw new Error(`${f.name}：超过 20 MB`);
  const base = { id: uid(), name: f.name, type: f.type, size: f.size };
  if (/^image\/(png|jpe?g|gif|webp)$/.test(f.type)) return { ...base, kind: 'image', data: await readB64(f) };
  if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) return { ...base, kind: 'pdf', type: 'application/pdf', data: await readB64(f) };
  if (f.type.startsWith('text/') || TEXT_EXT.test(f.name) || !f.type) return { ...base, kind: 'text', data: (await f.text()).normalize('NFC') };
  throw new Error(`${f.name}：只收图片、PDF 和文本文件`);
}

/** PDF 抽文字（按页，给不认 PDF 的接口用）；扫描件抽不出字就说明白 */
export async function pdfText(b64: string, name: string): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, 200); i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    let last: number | null = null, line = '';
    const lines: string[] = [];
    for (const it of tc.items as any[]) {
      if (typeof it.str !== 'string') continue;
      const y = Math.round(it.transform?.[5] ?? 0);
      if (last !== null && Math.abs(y - last) > 2) { lines.push(line); line = ''; }
      line += it.str; last = y;
    }
    lines.push(line);
    pages.push(`--- 第 ${i} 页 ---\n${lines.join('\n').trim()}`);
  }
  const text = pages.join('\n\n').trim();
  return text.replace(/--- 第 \d+ 页 ---\n?/g, '').trim() ? `${name}${doc.numPages > 200 ? `（只抽了前 200 页，共 ${doc.numPages} 页）` : ''}\n${text}` : `${name}：这份 PDF 抽不出文字（可能是扫描件），换成图片发或者换 Anthropic 接口`;
}

export const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
