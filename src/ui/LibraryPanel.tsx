import { useEffect, useRef, useState } from 'react';
import { Button, Input, Spinner } from '@fluentui/react-components';
import { useStore } from '../model/store';
import { mergeEntries } from '../bib/csl';
import { fmtSize } from '../ai/files';
import { associateLibraryDocument, getLibraryFile, importLibraryPdf, refreshLibrary, removeLibraryDocument, searchLibrary, useLibrary, type LibraryFile, type LibraryHit } from '../library/store';
import { ZoteroDialog } from './ZoteroDialog';
import { t } from '../i18n';

export function LibraryPanel() {
  const { documents, error: loadError } = useLibrary();
  const references = useStore((s) => s.doc.references);
  const [zotero, setZotero] = useState(false), [query, setQuery] = useState(''), [hits, setHits] = useState<LibraryHit[] | null>(null);
  const [selected, setSelected] = useState(''), [page, setPage] = useState(1), [mode, setMode] = useState<'pdf' | 'text'>('pdf');
  const [file, setFile] = useState<LibraryFile | null>(null), [url, setUrl] = useState('');
  const [busy, setBusy] = useState(''), [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null), controller = useRef<AbortController | null>(null);
  const doc = documents.find((d) => d.id === selected);
  useEffect(() => { void refreshLibrary().catch(() => {}); return () => controller.current?.abort(); }, []);
  useEffect(() => {
    let alive = true, value = ''; setFile(null); setUrl('');
    if (selected) void getLibraryFile(selected).then((f) => { if (!alive || !f) return; value = URL.createObjectURL(f.blob); setUrl(value); setFile(f); }).catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; if (value) URL.revokeObjectURL(value); };
  }, [selected]);
  const add = async (files: File[]) => {
    if (busy) return;
    const abort = new AbortController(); controller.current = abort; setError('');
    try {
      for (const [i, f] of files.entries()) {
        abort.signal.throwIfAborted(); setBusy(`${i + 1}/${files.length} · ${f.name}`);
        const added = await importLibraryPdf(f, { name: f.name, signal: abort.signal, progress: setBusy }); setSelected(added.id); setPage(1);
      }
      setQuery(''); setHits(null);
    } catch (e) { if (!abort.signal.aborted) setError((e as Error).message); }
    finally { if (controller.current === abort) { controller.current = null; setBusy(''); } }
  };
  const search = async () => {
    setBusy(t('正在检索资料库…')); setError('');
    try { setHits(await searchLibrary(query, { limit: 50 })); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(''); }
  };
  const download = () => { if (!url || !doc) return; const a = document.createElement('a'); a.href = url; a.download = doc.name; a.click(); };
  const addReference = async () => {
    if (!doc?.bib) return;
    const store = useStore.getState(), merged = mergeEntries(store.doc.references, [doc.bib]);
    store.setReferences(merged.entries);
    await associateLibraryDocument(doc.id, merged.entries.find((e) => doc.bib?.source ? e.source === doc.bib.source : e.key === doc.bib?.key));
  };
  const shown = hits ? documents.filter((d) => hits.some((h) => h.id === d.id)) : documents.filter((d) => `${d.title} ${d.name} ${d.bib?.key ?? ''} ${d.bib?.fields.author ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <div className="library-panel">
    <h2>{t('资料库')}</h2>
    <p className="field-hint">{t('保存文献 PDF 原文，跨工程共用。AI 可按需检索全文、读取指定页码和查看原页；只有读取的内容会发送给当前配置的模型。')}</p>
    <div className="library-toolbar">
      <Button onClick={() => setZotero(true)} disabled={!!busy}>{t('从 Zotero 导入')}</Button>
      <Button onClick={() => input.current?.click()} disabled={!!busy}>{t('添加 PDF')}</Button>
      <Button onClick={() => { void refreshLibrary().catch((e) => setError(e.message)); }} disabled={!!busy}>{t('刷新列表')}</Button>
      <input ref={input} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => { void add(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
      <span className="muted">{t('{{n}} 份 PDF', { n: documents.length })}</span>
    </div>
    <div className="library-search"><Input aria-label={t('搜索资料')} placeholder={t('搜索题名、文件名或引用键')} value={query} onChange={(_, d) => { setQuery(d.value); setHits(null); }} onKeyDown={(e) => { if (e.key === 'Enter' && query.trim() && !busy) void search(); }} /><Button disabled={!!busy || !query.trim()} onClick={() => void search()}>{t('全文检索')}</Button></div>
    {busy && <div className="library-progress" role="status"><Spinner size="extra-tiny" />{busy}{controller.current && <Button size="small" onClick={() => controller.current?.abort()}>{t('停止')}</Button>}</div>}
    {(error || loadError) && <p role="alert" className="library-error">{error || loadError}</p>}
    {hits && <div className="library-hits"><strong>{t('找到 {{n}} 处匹配（最多显示 50 处）', { n: hits.length })}</strong>{hits.map((h) => <button key={`${h.id}/${h.page}`} onClick={() => { setSelected(h.id); setMode('text'); setPage(h.page); }}><b>{h.title} · {t('第 {{n}} 页', { n: h.page })}</b><span>{h.excerpt}</span></button>)}</div>}
    <div className="library-work">
      <div className="library-list" aria-label={t('资料清单')}>
        {shown.map((d) => <button className={selected === d.id ? 'is-selected' : ''} key={d.id} onClick={() => { setSelected(d.id); setPage(1); }}><strong>{d.title}</strong><span>{d.bib?.key ? `@${d.bib.key} · ` : ''}{d.name}</span><small>{fmtSize(d.size)} · {d.pageCount ? `${d.pageCount} ${t('页')}` : t('页数未知')} · {d.status === 'ready' ? t('可检索全文') : d.status === 'scanned' ? t('扫描件，可查看原页') : t('文字索引失败，原文已保存')}</small></button>)}
        {!shown.length && <p className="muted">{documents.length ? t('没有匹配的资料') : t('尚无资料。可从 Zotero 下载 PDF，或添加本机文件。')}</p>}
      </div>
      <section className="library-reader" aria-label={t('资料阅读器')}>
        {doc ? <>
          <h3>{doc.title}</h3>
          <div className="library-toolbar"><Button size="small" appearance={mode === 'pdf' ? 'primary' : 'secondary'} onClick={() => setMode('pdf')}>{t('PDF 原文')}</Button><Button size="small" appearance={mode === 'text' ? 'primary' : 'secondary'} onClick={() => setMode('text')}>{t('提取文字')}</Button><Button size="small" disabled={!url} onClick={download}>{t('下载 PDF')}</Button><Button size="small" disabled={!!busy} onClick={() => { void removeLibraryDocument(doc.id).then(() => { setSelected(''); setHits(null); }).catch((e) => setError(e.message)); }}>{t('移除资料')}</Button></div>
          <label className="library-associate">{t('关联本篇文献')}<select aria-label={t('关联本篇文献')} value={references.find((e) => doc.bib?.source ? e.source === doc.bib.source : e.key === doc.bib?.key)?.id ?? ''} onChange={(e) => { void associateLibraryDocument(doc.id, references.find((r) => r.id === e.target.value)).catch((err) => setError(err.message)); }}><option value="">{t('未关联本篇文献')}</option>{references.map((e) => <option key={e.id} value={e.id}>@{e.key} · {e.fields.title || e.key}</option>)}</select></label>
          {doc.bib && <div className="library-bib"><span>@{doc.bib.key} · {doc.bib.fields.author}</span><Button size="small" onClick={() => { void addReference().catch((e) => setError(e.message)); }}>{t('加入本篇参考文献')}</Button></div>}
          {doc.zotero && <p className="field-hint muted">Zotero · {doc.zotero.library} · {doc.zotero.attachmentKey}</p>}
          {doc.error && <p className="library-error">{doc.error}</p>}
          {mode === 'text' ? <><label className="library-page">{t('页码')}<Input type="number" min={1} max={Math.max(1, doc.pageCount)} value={String(page)} onChange={(_, d) => setPage(Math.max(1, Math.min(Math.max(1, doc.pageCount), Number(d.value) || 1)))} /></label><pre className="library-text">{file?.pages[page - 1] || t('本页没有可提取的文字。请查看 PDF 原文；AI 也可调用 library_render 阅读原页。')}</pre></> : url ? <iframe title={t('PDF 原文')} src={url} /> : <Spinner size="small" />}
        </> : <p className="muted">{t('选择一份 PDF 查看原文、提取文字和文献关联。')}</p>}
      </section>
    </div>
    <ZoteroDialog open={zotero} onClose={() => setZotero(false)} entries={references} onChange={(e) => useStore.getState().setReferences(e)} />
  </div>;
}
