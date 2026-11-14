import { useEffect, useRef } from 'react';
import { basicSetup } from 'codemirror';
import { Compartment, EditorState, Transaction } from '@codemirror/state';
import { EditorView, hoverTooltip, keymap } from '@codemirror/view';
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { r } from '@codemirror/legacy-modes/mode/r';
import { autocompletion, type CompletionContext } from '@codemirror/autocomplete';
import { indentWithTab } from '@codemirror/commands';
import { lintGutter, setDiagnostics } from '@codemirror/lint';
import { connectRLanguageService, onRLanguageMessage, sendRLanguageMessage, useRLanguageService } from '../rplot/languageService';
import { t } from '../i18n';

interface EditorClient { uri: string; version: number; text: string; active: boolean; sync: () => Promise<void> }
const localCompletion = (context: CompletionContext) => {
  const word = context.matchBefore(/[\w.]+/); if (!word || (!context.explicit && word.from === word.to)) return null;
  const names = ['plot', 'lines', 'points', 'legend', 'text', 'abline', 'par', 'library', 'read.csv', 'seq', 'data.frame', 'ggplot', 'aes', 'geom_point', 'geom_line', 'geom_text', 'geom_text_repel', 'labs', 'theme_classic', 'theme_minimal', 'theme', 'element_text', 'grid.text', 'gpar', 'set.seed'];
  return { from: word.from, options: names.map((label) => ({ label, type: 'function' })) };
};
const offset = (state: EditorState, position: { line: number; character: number }) => {
  const line = state.doc.line(Math.max(1, Math.min(state.doc.lines, position.line + 1)));
  return line.from + Math.max(0, Math.min(line.length, position.character));
};
const position = (state: EditorState, offset: number) => { const line = state.doc.lineAt(offset); return { line: line.number - 1, character: offset - line.from }; };
const reportError = (e: unknown) => useRLanguageService.setState({ error: (e as Error).message || t('R 语言服务请求失败') });

export function RCodeEditor({ value, onChange, disabled, languageEnabled = false }: { value: string; onChange: (value: string) => void; disabled: boolean; languageEnabled?: boolean }) {
  const host = useRef<HTMLDivElement>(null), view = useRef<EditorView | null>(null), callback = useRef(onChange);
  const client = useRef<EditorClient | null>(null), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const phase = useRLanguageService((s) => s.phase);
  callback.current = onChange;
  const readOnly = useRef(new Compartment());
  useEffect(() => {
    const complete = async (context: CompletionContext) => {
      const active = client.current; if (!active) return localCompletion(context);
      const word = context.matchBefore(/[\w.]*/);
      if (!word || (!context.explicit && word.from === word.to && context.state.sliceDoc(Math.max(0, context.pos - 2), context.pos) !== '::')) return null;
      try {
        await active.sync();
        const snapshot = context.state.doc.toString(); if (snapshot !== view.current?.state.doc.toString() || !active.active) return null;
        const result = await sendRLanguageMessage('textDocument/completion', { textDocument: { uri: active.uri }, position: position(context.state, context.pos) }, true);
        if (snapshot !== view.current?.state.doc.toString() || !active.active) return null;
        const items = Array.isArray(result) ? result : result?.items ?? [];
        return { from: word.from, options: items.map((item: any) => ({ label: item.label, type: item.kind === 3 ? 'function' : item.kind === 9 ? 'namespace' : 'variable', detail: item.detail, apply: item.textEdit?.newText ?? item.insertText ?? item.label })) };
      } catch (e) { if (active.active) reportError(e); return localCompletion(context); }
    };
    const editor = new EditorView({ parent: host.current!, state: EditorState.create({ doc: value, extensions: [
      basicSetup, StreamLanguage.define(r), syntaxHighlighting(HighlightStyle.define([
        { tag: tags.keyword, color: 'var(--r-code-keyword)' },
        { tag: tags.string, color: 'var(--r-code-string)' },
        { tag: [tags.number, tags.bool, tags.null, tags.atom], color: 'var(--r-code-number)' },
        { tag: tags.comment, color: 'var(--muted)', fontStyle: 'italic' },
        { tag: tags.operator, color: 'var(--accent-ink)' },
        { tag: tags.variableName, color: 'var(--ink)' },
        { tag: tags.standard(tags.variableName), color: 'var(--accent-ink)' },
      ])), lintGutter(), EditorState.tabSize.of(2), keymap.of([indentWithTab]), autocompletion({ override: [complete] }),
      readOnly.current.of([EditorState.readOnly.of(disabled), EditorView.editable.of(!disabled)]),
      EditorView.contentAttributes.of({ role: 'textbox', 'aria-label': t('R 绘图代码'), 'aria-multiline': 'true', spellcheck: 'false' }),
      hoverTooltip(async (editor, pos) => {
        const active = client.current; if (!active) return null;
        try {
          const snapshot = editor.state.doc.toString(); await active.sync();
          if (!active.active || snapshot !== editor.state.doc.toString()) return null;
          const result = await sendRLanguageMessage('textDocument/hover', { textDocument: { uri: active.uri }, position: position(editor.state, pos) }, true);
          if (!active.active || snapshot !== editor.state.doc.toString() || !result?.contents) return null;
          const contents = (Array.isArray(result.contents) ? result.contents : [result.contents]).map((s: any) => typeof s === 'string' ? s : s.value ?? '').join('\n').replace(/^```[^\n]*\n|```$/gm, '').trim();
          if (!contents) return null;
          return { pos: result.range ? offset(editor.state, result.range.start) : pos, end: result.range ? offset(editor.state, result.range.end) : pos,
            create() { const dom = document.createElement('pre'); dom.className = 'rplot-lsp-hover'; dom.textContent = contents; return { dom }; } };
        } catch (e) { if (active.active) reportError(e); return null; }
      }),
      EditorView.theme({ '&': { height: '100%', color: 'var(--ink)', backgroundColor: 'var(--panel-2)' }, '.cm-scroller': { fontFamily: 'var(--mono)', fontSize: '12px', lineHeight: '1.6', overflow: 'auto' }, '.cm-content': { minHeight: '300px', padding: '10px 0' }, '.cm-gutters': { color: 'var(--muted)', backgroundColor: 'var(--panel-2)', borderColor: 'var(--line)' }, '&.cm-focused': { outline: 'none' }, '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--accent-soft-2)' }, '.cm-cursor': { borderLeftColor: 'var(--ink)' }, '.cm-tooltip': { color: 'var(--ink)', backgroundColor: 'var(--panel)', borderColor: 'var(--line-2)' } }),
      EditorView.updateListener.of((u) => {
        if (!u.docChanged) return;
        if (!u.transactions.some((t) => t.isUserEvent('input.external'))) callback.current(u.state.doc.toString());
        clearTimeout(timer.current);
        timer.current = setTimeout(() => { void client.current?.sync().catch(reportError); }, 450);
      }),
    ] }) });
    view.current = editor;
    return () => { clearTimeout(timer.current); view.current = null; editor.destroy(); };
  }, []);
  useEffect(() => { const editor = view.current; if (editor && value !== editor.state.doc.toString()) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value }, annotations: Transaction.userEvent.of('input.external') }); }, [value]);
  useEffect(() => { view.current?.dispatch({ effects: readOnly.current.reconfigure([EditorState.readOnly.of(disabled), EditorView.editable.of(!disabled)]) }); }, [disabled]);
  useEffect(() => {
    const editor = view.current; if (!editor || !languageEnabled || phase !== 'ready') return;
    const active: EditorClient = { uri: `file:///home/web_user/iota-editor-${crypto.randomUUID()}.R`, version: 1, text: editor.state.doc.toString(), active: true, sync: async () => {} };
    client.current = active;
    const off = onRLanguageMessage((message) => {
      const params = message.params;
      if (!active.active || message.method !== 'textDocument/publishDiagnostics' || params?.uri !== active.uri || (params.version != null && params.version !== active.version) || active.text !== editor.state.doc.toString()) return;
      editor.dispatch(setDiagnostics(editor.state, (params.diagnostics ?? []).map((d: any) => ({ from: offset(editor.state, d.range.start), to: offset(editor.state, d.range.end), severity: d.severity === 1 ? 'error' : d.severity === 2 ? 'warning' : 'info', message: d.message, source: 'R LSP' }))));
    });
    const opened = connectRLanguageService().then(async () => { if (active.active) await sendRLanguageMessage('textDocument/didOpen', { textDocument: { uri: active.uri, languageId: 'r', version: active.version, text: active.text } }); });
    let queue = opened;
    active.sync = () => {
      queue = queue.catch(() => {}).then(async () => {
        await opened; if (!active.active) return;
        const text = editor.state.doc.toString(); if (text === active.text) return;
        active.text = text; active.version++;
        try { await sendRLanguageMessage('textDocument/didChange', { textDocument: { uri: active.uri, version: active.version }, contentChanges: [{ text }] }); }
        catch (e) { active.text = ''; throw e; }
      });
      return queue;
    };
    void opened.then(() => active.sync()).catch((e) => { if (active.active) reportError(e); });
    return () => {
      active.active = false; off(); if (client.current === active) client.current = null;
      if (view.current === editor) editor.dispatch(setDiagnostics(editor.state, []));
      if (useRLanguageService.getState().phase === 'ready') void sendRLanguageMessage('textDocument/didClose', { textDocument: { uri: active.uri } }).catch(() => {});
    };
  }, [languageEnabled, phase]);
  return <div className="rplot-code" ref={host} />;
}
