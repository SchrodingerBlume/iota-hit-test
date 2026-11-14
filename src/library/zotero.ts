import type { BibEntry } from '../bib/bibtex';
import { downloadPdf, pdfAttachments, type ZoteroAuth } from '../bib/zotero';
import { associateLibraryDocument, getLibraryDocument, importLibraryPdf } from './store';

export interface PdfImportResult { imported: number; unchanged: number; missing: number; failed: string[] }
export async function importZoteroPdfs(auth: ZoteroAuth, library: string, entries: { itemKey: string; bib: BibEntry }[], options: { signal?: AbortSignal; progress?: (text: string) => void } = {}): Promise<PdfImportResult> {
  const { signal, progress = () => {} } = options;
  const result: PdfImportResult = { imported: 0, unchanged: 0, missing: 0, failed: [] };
  for (const [i, entry] of entries.entries()) {
    signal?.throwIfAborted();
    progress(`正在查找 PDF：${i + 1}/${entries.length} · ${entry.bib.fields.title || entry.bib.key}`);
    try {
      const attachments = await pdfAttachments(auth, library, entry.itemKey, signal);
      if (!attachments.length) result.missing++;
      for (const pdf of attachments) {
        signal?.throwIfAborted();
        const id = `zotero:${library}/${pdf.key}`, old = await getLibraryDocument(id);
        if (old?.zotero && (old.zotero.version === pdf.version || (pdf.md5 && old.zotero.md5 === pdf.md5))) {
          if (JSON.stringify(old.bib) !== JSON.stringify(entry.bib)) await associateLibraryDocument(id, entry.bib);
          result.unchanged++; continue;
        }
        try {
          const blob = await downloadPdf(auth, library, pdf, signal, (bytes, total) => progress(`正在下载 ${pdf.name}：${(bytes / 1048576).toFixed(1)}${total ? ` / ${(total / 1048576).toFixed(1)}` : ''} MB（文献 ${i + 1}/${entries.length}）`));
          await importLibraryPdf(blob, { id, name: pdf.name, bib: entry.bib, zotero: { library, itemKey: entry.itemKey, attachmentKey: pdf.key, version: pdf.version, md5: pdf.md5 }, signal, progress });
          result.imported++;
        } catch (e) { signal?.throwIfAborted(); result.failed.push(`${pdf.name}：${(e as Error).message}`); }
      }
    } catch (e) { signal?.throwIfAborted(); result.failed.push(`${entry.bib.key}：${(e as Error).message}`); }
  }
  return result;
}
