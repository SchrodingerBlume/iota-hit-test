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

/** PDF 一页画成 PNG（缩放 scale，1 ≈ 72dpi；crop 是页面比例 [x, y, w, h]），回 base64 */
export async function pdfRender(b64: string, page: number, scale = 2, crop?: [number, number, number, number]): Promise<{ data: string; width: number; height: number; pages: number }> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) }).promise;
  const p = await doc.getPage(Math.min(Math.max(1, page), doc.numPages));
  const vp = p.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
  await p.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport: vp } as any).promise;
  let out = canvas;
  if (crop) {
    const [x, y, w, h] = crop.map((v) => Math.min(1, Math.max(0, v))) as [number, number, number, number];
    out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(canvas.width * w)); out.height = Math.max(1, Math.round(canvas.height * h));
    out.getContext('2d')!.drawImage(canvas, Math.round(canvas.width * x), Math.round(canvas.height * y), out.width, out.height, 0, 0, out.width, out.height);
  }
  return { data: out.toDataURL('image/png').split(',')[1], width: out.width, height: out.height, pages: doc.numPages };
}

/** PDF 里嵌的位图（页面上画出来的那些 XObject），小于 minPx 的当装饰跳过 */
export async function pdfImages(b64: string, page: number | undefined, minPx = 120): Promise<{ page: number; data: string; width: number; height: number }[]> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) }).promise;
  const pages = page ? [Math.min(Math.max(1, page), doc.numPages)] : Array.from({ length: Math.min(doc.numPages, 60) }, (_, i) => i + 1);
  const out: { page: number; data: string; width: number; height: number }[] = [];
  const seen = new Set<string>();
  for (const n of pages) {
    const p = await doc.getPage(n);
    const ops = await p.getOperatorList();
    for (let i = 0; i < ops.fnArray.length; i++) {
      if (ops.fnArray[i] !== pdfjs.OPS.paintImageXObject && ops.fnArray[i] !== pdfjs.OPS.paintImageXObjectRepeat) continue;
      const name = ops.argsArray[i][0] as string;
      if (seen.has(name)) continue;
      seen.add(name);
      const img: any = await new Promise((res) => { try { p.objs.get(name, res); } catch { res(null); } });
      if (!img) continue;
      const w = img.width ?? img.bitmap?.width ?? 0, h = img.height ?? img.bitmap?.height ?? 0;
      if (w < minPx || h < minPx) continue;
      const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      if (img.bitmap) ctx.drawImage(img.bitmap, 0, 0);
      else if (img.data) {
        const rgba = new Uint8ClampedArray(w * h * 4);
        const k = img.kind; // 1 灰度 2 RGB 3 RGBA（pdf.js 的 ImageKind）
        for (let j = 0, q = 0; j < w * h; j++, q += 4) {
          if (k === 3) { rgba[q] = img.data[j * 4]; rgba[q + 1] = img.data[j * 4 + 1]; rgba[q + 2] = img.data[j * 4 + 2]; rgba[q + 3] = img.data[j * 4 + 3]; }
          else if (k === 2) { rgba[q] = img.data[j * 3]; rgba[q + 1] = img.data[j * 3 + 1]; rgba[q + 2] = img.data[j * 3 + 2]; rgba[q + 3] = 255; }
          else { const g = img.data[j]; rgba[q] = g; rgba[q + 1] = g; rgba[q + 2] = g; rgba[q + 3] = 255; }
        }
        ctx.putImageData(new ImageData(rgba, w, h), 0, 0);
      } else continue;
      out.push({ page: n, data: canvas.toDataURL('image/png').split(',')[1], width: w, height: h });
      if (out.length >= 40) return out;
    }
  }
  return out;
}
