// 「字体方案」卡：内置字体 / 本机字体（windows 档）/ 本机字体（macos 档）。
// 后两档要先把字读进来——Chromium 走 Local Font Access API 一键读，其余浏览器选文件。
import { useStore } from '../model/store';
import { useCompileState } from '../compiler/client';
import { useFontState, roleAvailability } from '../fonts/userFonts';
import type { Fontset } from '../model/types';

const CHOICES: { value: Fontset; label: string; hint: string }[] = [
  { value: 'webapp', label: '内置字体', hint: 'Noto CJK、FandolKai、TeX Gyre，无需另行安装' },
  { value: 'windows', label: 'Windows 字体', hint: '宋体、黑体、楷体、Times New Roman 等，需加载本机字体' },
  { value: 'macos', label: 'macOS 字体', hint: 'Songti / Heiti / Kaiti SC + STFangsong + Times New Roman / Arial / Menlo / STIX Two Math' },
];

const fmtMB = (n: number) => (n / 1024 / 1024).toFixed(1);

export function FontCard() {
  const fontset = useStore((s) => s.doc.settings.fontset ?? 'webapp');
  const setSettings = useStore((s) => s.setSettings);
  const { fonts, busy, error, canQuery, readLocal, addFiles, removeFile } = useFontState();
  const families = useCompileState((s) => s.families);
  const status = useCompileState((s) => s.status);
  const roles = fontset === 'webapp' ? [] : roleAvailability(fontset);
  const missing = roles.filter((r) => !r.ok && !r.optional);
  void families; // 订阅它：字体表变了这张卡要重画

  return (
    <div className="card">
      <h3>字体方案</h3>
      <div className="fontset">
        {CHOICES.map((c) => (
          <label key={c.value} className={`fontset-opt ${fontset === c.value ? 'on' : ''}`}>
            <input type="radio" name="fontset" checked={fontset === c.value} onChange={() => setSettings({ fontset: c.value })} />
            <span><b>{c.label}</b><small>{c.hint}</small></span>
          </label>
        ))}
      </div>

      {fontset !== 'webapp' && (
        <>
          <div className="row" style={{ marginTop: 10 }}>
            {canQuery
              ? <button type="button" className="btn btn-primary" disabled={!!busy || status !== 'ready'} onClick={() => void readLocal()}>读取本机字体</button>
              : <span className="muted" style={{ fontSize: 12 }}>当前浏览器不支持读取系统字体，请选择字体文件。</span>}
            <label className="btn">
              选择字体文件…
              <input type="file" hidden multiple accept=".otf,.ttf,.ttc,.otc" disabled={!!busy} onChange={(e) => { if (e.target.files?.length) void addFiles(e.target.files); e.target.value = ''; }} />
            </label>
            {busy && <span className="muted" style={{ fontSize: 12 }}>{busy}</span>}
          </div>
          {error && <div className="diag err" style={{ marginTop: 8, padding: '6px 10px', borderRadius: 'var(--r-s)', border: '1px solid' }}>{error}</div>}
          <p className="muted" style={{ fontSize: 12, margin: '8px 0 6px' }}>
            字体仅在本机使用。选择的字体文件会保存在此浏览器中。
          </p>

          <table className="tbl roles">
            <tbody>
              {roles.map((r) => (
                <tr key={r.role} className={r.ok ? 'ok' : r.optional ? 'opt' : 'missing'}>
                  <td className="mark">{r.ok ? '✓' : r.optional ? '–' : '✗'}</td>
                  <td>{r.label}</td>
                  <td><code>{r.family}</code></td>
                  <td className="muted">{r.ok ? '已加载' : r.optional ? '可选' : '缺失，使用替代字体'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {missing.length > 0 && fonts.length === 0 && !busy && (
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>尚未加载本机字体，当前使用替代字体。</div>
          )}
          {missing.length > 0 && fonts.length > 0 && (
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>缺少 {missing.map((m) => m.family).join('、')}，当前使用替代字体。</div>
          )}

          {fonts.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary className="muted" style={{ fontSize: 12, cursor: 'pointer' }}>已装入 {fonts.length} 个字体文件，共 {fmtMB(fonts.reduce((s, f) => s + f.size, 0))} MB</summary>
              <ul className="font-list">
                {fonts.map((f) => (
                  <li key={f.id}>
                    <code>{f.name}</code> <span className="muted">{fmtMB(f.size)} MB · {f.source === 'local' ? '本机' : '文件'}</span>
                    {f.source === 'file' && <button type="button" className="del" title="移除" onClick={() => void removeFile(f.name)}>✕</button>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
