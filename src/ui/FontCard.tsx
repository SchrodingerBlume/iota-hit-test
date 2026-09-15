// 「字体方案」卡：站内开源字体 / 本机字体（windows 档）/ 本机字体（macos 档）。
// 后两档要先把字读进来——Chromium 走 Local Font Access API 一键读，其余浏览器选文件。
import { useStore } from '../model/store';
import { useCompileState } from '../compiler/client';
import { useFontState, roleAvailability } from '../fonts/userFonts';
import type { Fontset } from '../model/types';

const CHOICES: { value: Fontset; label: string; hint: string }[] = [
  { value: 'webapp', label: '站内开源字体', hint: 'Noto Serif/Sans CJK、FandolKai、TeX Gyre——随站分发，哪儿都能编，但不是模板对拍用的那套字' },
  { value: 'windows', label: '本机字体 · Windows 档', hint: '中易宋黑楷仿 + Times New Roman / Arial / Consolas / Cambria Math。模板全部标定常数按这套量，与 Word 逐条对拍' },
  { value: 'macos', label: '本机字体 · macOS 档', hint: 'Songti / Heiti / Kaiti SC + STFangsong + Times New Roman / Arial / Menlo / STIX Two Math' },
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
              : <span className="muted" style={{ fontSize: 12 }}>这个浏览器不能直接读系统字体（Chrome / Edge 桌面版才行），请选文件：</span>}
            <label className="btn">
              选择字体文件…
              <input type="file" hidden multiple accept=".otf,.ttf,.ttc,.otc" disabled={!!busy} onChange={(e) => { if (e.target.files?.length) void addFiles(e.target.files); e.target.value = ''; }} />
            </label>
            {busy && <span className="muted" style={{ fontSize: 12 }}>{busy}</span>}
          </div>
          {error && <div className="diag err" style={{ marginTop: 8, padding: '6px 10px', borderRadius: 'var(--r-s)', border: '1px solid' }}>{error}</div>}
          <p className="muted" style={{ fontSize: 12, margin: '8px 0 6px' }}>
            字节只进这台浏览器的内存，交给页面里的排版引擎，不上传。本机读到的每次进站点一下就有；自己选的文件会存在浏览器里，下次自动装上。
            {fontset === 'windows' && ' macOS 上装了 Office 的话，SimSun / SimHei / KaiTi / FangSong 一般在 Office 的字体目录里，选文件那条路也能装。'}
          </p>

          <table className="tbl roles">
            <tbody>
              {roles.map((r) => (
                <tr key={r.role} className={r.ok ? 'ok' : r.optional ? 'opt' : 'missing'}>
                  <td className="mark">{r.ok ? '✓' : r.optional ? '–' : '✗'}</td>
                  <td>{r.label}</td>
                  <td><code>{r.family}</code></td>
                  <td className="muted">{r.ok ? '已装上' : r.optional ? '可选，没有就由模板回落' : '缺，模板会用回落字体，版面不再逐字对拍'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {missing.length > 0 && fonts.length === 0 && !busy && (
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>本机字体还没读进来，上面的表暂时都是缺；在此之前预览用回落字体排。</div>
          )}
          {missing.length > 0 && fonts.length > 0 && (
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>还缺 {missing.map((m) => m.family).join('、')}；模板本身认得这种情况，会接回落链继续排。</div>
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
