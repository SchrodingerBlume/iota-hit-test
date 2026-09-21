// 浏览器里的沙盒：Python 走 Pyodide（wasm，jsDelivr 上取，首次十几 MB）、JS 走一个空 Worker。都在本机，没有服务器。
// 附件放进 /data/<名>，要交回的文件写到 /out/，跑完把 /out 里新出现的收回来（图直接能 figure_write）。
// Worker 一直留着（变量、装好的包、/out 里的文件都在），超时或中止就终止重来
export interface SandboxFile { name: string; text?: string; bytes?: Uint8Array }
export interface SandboxFont { name: string; bytes: Uint8Array }
export interface SandboxResult { ok: boolean; stdout: string; stderr: string; result: string; files: { name: string; bytes: Uint8Array }[]; error?: string; ms: number }

const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/';

// 与 Worker 里的代码分开写成字符串：站点是静态的，Worker 脚本用 blob URL 起，不占构建
// pyodide 314 起只有 ES 模块（pyodide.js 在经典 Worker 里直接抛「Classic web workers are not supported」），所以起模块 Worker 动态 import
const PY_WORKER = `
let py = null, seen = new Map();
const post = (m, t) => self.postMessage(m, t || []);
async function boot() {
  const { loadPyodide } = await import(${JSON.stringify(PYODIDE + 'pyodide.mjs')});
  py = await loadPyodide({ indexURL: ${JSON.stringify(PYODIDE)}, env: { MPLBACKEND: 'AGG', HOME: '/home/pyodide' } });
  for (const d of ['/data', '/out']) try { py.FS.mkdir(d); } catch {}
}
// matplotlib 用论文那套字体：西文 Times / Arial 在前、中文宋体 / 黑体在后（matplotlib 3.6 起按字回退，但只对显式家族列表生效），负号别用 Unicode 减号
const MPL_PRELUDE = \`
import os as _os, matplotlib as _mpl
from matplotlib import font_manager as _fm
_names = []
for _f in sorted(_os.listdir('/fonts')):
    try:
        _fm.fontManager.addfont('/fonts/' + _f)
        _names.append(_fm.FontProperties(fname='/fonts/' + _f).get_name())
    except Exception:
        pass
def _pick(pats):
    for _p in pats:
        for _n in _names:
            if _p.lower() in _n.lower():
                return _n
_serif = [n for n in (_pick(['Times New Roman', 'TeX Gyre Termes', 'Times']), _pick(['SimSun', 'Songti', 'STSong', 'Noto Serif CJK', 'Source Han Serif'])) if n]
_sans = [n for n in (_pick(['Arial', 'TeX Gyre Heros', 'Helvetica']), _pick(['SimHei', 'Heiti', 'STHeiti', 'Noto Sans CJK', 'Source Han Sans', 'PingFang'])) if n]
_mpl.rcParams['font.serif'] = _serif + list(_mpl.rcParams['font.serif'])
_mpl.rcParams['font.sans-serif'] = _sans + list(_mpl.rcParams['font.sans-serif'])
# 泛称 serif 只会选 font.serif 里第一个能用的，按字回退要把家族列表直接放进 font.family
_mpl.rcParams['font.family'] = _serif or _sans or ['serif']
_mpl.rcParams['axes.unicode_minus'] = False
_mpl.rcParams['mathtext.fontset'] = 'stix'
\`;
const fontsIn = new Set();
self.onmessage = async (e) => {
  const { id, code, files, fonts } = e.data;
  const t0 = Date.now();
  let out = [], err = [];
  try {
    if (!py) { post({ id, progress: 'boot' }); await boot(); }
    py.setStdout({ batched: (s) => out.push(s) });
    py.setStderr({ batched: (s) => err.push(s) });
    for (const f of files || []) py.FS.writeFile('/data/' + f.name, f.bytes ? f.bytes : f.text, f.bytes ? undefined : { encoding: 'utf8' });
    try { py.FS.mkdir('/fonts'); } catch {}
    for (const f of fonts || []) { if (fontsIn.has(f.name)) continue; py.FS.writeFile('/fonts/' + f.name, f.bytes); fontsIn.add(f.name); }
    post({ id, progress: 'packages' });
    await py.loadPackagesFromImports(code);
    if (/matplotlib/.test(code) && fontsIn.size) { post({ id, progress: 'fonts' }); await py.loadPackagesFromImports('import matplotlib'); py.runPython(MPL_PRELUDE); }
    post({ id, progress: 'run' });
    let r = await py.runPythonAsync(code);
    let result = '';
    if (r !== undefined && r !== null) { try { result = typeof r === 'object' && r.toString ? String(r) : String(r); } catch { result = ''; } if (r && typeof r.destroy === 'function') try { r.destroy(); } catch {} }
    const outs = [];
    for (const n of py.FS.readdir('/out')) {
      if (n === '.' || n === '..') continue;
      const st = py.FS.stat('/out/' + n);
      if (py.FS.isDir(st.mode)) continue;
      const key = n + ':' + st.mtime.getTime() + ':' + st.size;
      if (seen.get(n) === key) continue;
      seen.set(n, key);
      outs.push({ name: n, bytes: py.FS.readFile('/out/' + n) });
    }
    post({ id, ok: true, stdout: out.join(''), stderr: err.join(''), result, files: outs, ms: Date.now() - t0 }, outs.map((o) => o.bytes.buffer));
  } catch (e) {
    post({ id, ok: false, stdout: out.join(''), stderr: err.join(''), result: '', files: [], error: String(e && e.message || e), ms: Date.now() - t0 });
  }
};
`;

const JS_WORKER = `
const fmt = (v) => { if (typeof v === 'string') return v; if (v instanceof Uint8Array) return '<' + v.length + ' bytes>'; try { return JSON.stringify(v, null, 1); } catch { return String(v); } };
self.onmessage = async (e) => {
  const { id, code, files } = e.data;
  const t0 = Date.now();
  const logs = [], errs = [], outs = [];
  const con = { log: (...a) => logs.push(a.map(fmt).join(' ')), info: (...a) => logs.push(a.map(fmt).join(' ')), warn: (...a) => errs.push(a.map(fmt).join(' ')), error: (...a) => errs.push(a.map(fmt).join(' ')), table: (v) => logs.push(fmt(v)) };
  const fileMap = {}; for (const f of files || []) fileMap[f.name] = f.bytes ? f.bytes : f.text;
  const emit = (name, data) => { if (typeof data === 'string') data = new TextEncoder().encode(data); if (!(data instanceof Uint8Array)) throw new Error('emit(name, string | Uint8Array)'); outs.push({ name: String(name), bytes: data }); };
  try {
    const fn = new Function('console', 'files', 'emit', 'return (async () => {\\n' + code + '\\n})()');
    const r = await fn(con, fileMap, emit);
    self.postMessage({ id, ok: true, stdout: logs.join('\\n'), stderr: errs.join('\\n'), result: r === undefined ? '' : fmt(r), files: outs, ms: Date.now() - t0 }, outs.map((o) => o.bytes.buffer));
  } catch (err) {
    self.postMessage({ id, ok: false, stdout: logs.join('\\n'), stderr: errs.join('\\n'), result: '', files: [], error: String(err && err.stack || err), ms: Date.now() - t0 });
  }
};
`;

class Box {
  worker: Worker | null = null;
  constructor(private src: string, private module = false) {}
  run(code: string, files: SandboxFile[], timeoutMs: number, signal?: AbortSignal, onProgress?: (p: string) => void, fonts: SandboxFont[] = []): Promise<SandboxResult> {
    if (!this.worker) this.worker = new Worker(URL.createObjectURL(new Blob([this.src], { type: 'text/javascript' })), this.module ? { type: 'module' } : undefined);
    const w = this.worker;
    const id = Math.random().toString(36).slice(2);
    return new Promise((resolve) => {
      const done = (r: SandboxResult) => { clearTimeout(timer); w.removeEventListener('message', onMsg); signal?.removeEventListener('abort', kill); resolve(r); };
      const kill = () => { this.reset(); done({ ok: false, stdout: '', stderr: '', result: '', files: [], error: signal?.aborted ? '已中止' : `超过 ${Math.round(timeoutMs / 1000)} 秒没跑完，沙盒已重置（变量、装的包都没了）`, ms: timeoutMs }); };
      const timer = window.setTimeout(kill, timeoutMs);
      const onMsg = (e: MessageEvent) => { if (e.data?.id !== id) return; if (e.data.progress) { onProgress?.(e.data.progress); return; } done(e.data as SandboxResult); };
      w.addEventListener('message', onMsg);
      w.addEventListener('error', (e) => done({ ok: false, stdout: '', stderr: '', result: '', files: [], error: e.message, ms: 0 }), { once: true });
      signal?.addEventListener('abort', kill, { once: true });
      w.postMessage({ id, code, files, fonts }, [...files.flatMap((f) => (f.bytes ? [f.bytes.buffer] : [])), ...fonts.map((f) => f.bytes.buffer)]);
    });
  }
  reset() { this.worker?.terminate(); this.worker = null; }
}

export const pyBox = new Box(PY_WORKER, true);
export const jsBox = new Box(JS_WORKER);
