// Alt 键提示（照 Word 的 KeyTip）：按住 Alt 亮出快速访问栏数字与选项卡字母，按字母进下一层；
// Esc 退一层、Alt 或点别处退出。徽标只提示，命令本身走原来的按钮。
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';

type Tip = { el: HTMLElement; tip: string };

const TAB_TIPS: Record<string, string> = { home: 'H', insert: 'N', cite: 'S', review: 'R', table: 'T', figure: 'P', view: 'V' };

/** 命令字母照 Word 取（同页重名或撞车的落自动分配）。 */
const CMD_TIPS: Record<string, string> = {
  '粘贴': 'V', '剪切': 'X', '复制': 'C', '格式刷': 'FP', '更改大小写': 'E', '清除格式': 'L',
  '加粗': 'B', '倾斜': 'I', '下划线': 'U', '删除线': 'D', '下标': 'J', '上标': 'G', '等宽字体': 'M',
  '项目符号': 'O', '编号列表': 'N', '取消本段首行缩进': 'T', '连续空段落': 'K', '空一格': 'Z', '显示/隐藏编辑标记': 'P',
  '正文段落': 'W', '一级标题': 'H1', '二级标题': 'H2', '三级标题': 'H3', '四级标题': 'H4',
  '查找': 'Q', '替换': 'R', '全选': 'A',
  '分页符': 'B', '页眉': 'H', '页脚': 'F', '表格': 'T', '图片': 'I', '链接': 'K', '符号': 'S', '插入符号': 'S', '公式': 'E', '行内公式': 'Q', '式中': 'W', '算法': 'A', '代码块': 'D', '代码清单': 'L', '定理': 'Y',
  '目录': 'T', '目录样式': 'Y', '插入引文': 'C', 'Zotero': 'Z', '管理源': 'M', '成果': 'G', '交叉引用': 'X', '插入脚注': 'F', '上一条': 'P', '下一条': 'N', '缩略语': 'A', '管理缩略语': 'U', '标记条目': 'K', '索引设置': 'I',
  '新建批注': 'C', '删除': 'D', '批注窗格': 'W', '字数统计': 'Z', '简转繁': 'F', '繁转简': 'J',
  '在上方插入行': 'A', '在下方插入行': 'B', '删除行': 'C', '在左侧插入列': 'D', '在右侧插入列': 'E', '删除列': 'F', '合并或拆分': 'M', '标题行': 'H', '删除表格': 'T', '浮动': 'O', '跨页': 'K', '自动调整': 'G',
  '每行': 'R', '分图题注': 'C', '图上标签': 'L', '标签色': 'D', '标签写法': 'P', '标签字号': 'S', '标签字体': 'F', '题注': 'T', '英文题注': 'E', '更改图片': 'G',
  '编辑': 'E', '并排查看': 'S', '预览': 'P', '导航窗格': 'N', '缩放': 'Z', '页宽': 'W', '单页': 'O', '多页': 'M',
};

/** 取一个控件的名字：图标钮用 aria-label / title（去掉括号里的提示），有字钮用它的字。 */
function labelOf(el: HTMLElement): string {
  if (el.classList.contains('rb-tri')) return el.querySelector('.rb-tri-name')?.textContent?.trim() ?? '';
  const named = el.getAttribute('aria-label') || el.getAttribute('title');
  if (named) return named.split(/[（(]/)[0].replace(/…+$/, '').trim();
  return (el.textContent ?? '').replace(/\s+/g, ' ').replace(/…+$/, '').trim();
}

/** 第一轮认下写好的字母（不许互为前缀），剩下的按字母表补，绝不留空。 */
function assign(pref: (string | undefined)[]): string[] {
  const taken: string[] = [];
  const out: (string | undefined)[] = pref.slice();
  const fits = (k: string) => !taken.some((t) => t === k || t.startsWith(k) || k.startsWith(t));
  out.forEach((k, i) => { if (k && fits(k)) { out[i] = k; taken.push(k); } else out[i] = undefined; });
  const first = new Set(taken.map((k) => k[0]));
  for (let i = 0; i < out.length; i++) {
    if (out[i]) continue;
    for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      if (first.has(ch) || !fits(ch)) continue;
      out[i] = ch; taken.push(ch); first.add(ch); break;
    }
  }
  return out.map((k, i) => k ?? `#${i + 1}`);
}

/** 根层：快速访问栏数字 + 可见选项卡的字母。 */
function collectTop(root: HTMLElement, tabs: { key: string; label: string }[]): Tip[] {
  const out: Tip[] = [];
  let n = 0;
  for (const el of root.querySelectorAll<HTMLElement>('.rb-leading button.rb-btn')) {
    if (el.classList.contains('rb-menu') || ++n > 9) continue;
    out.push({ el, tip: String(n) });
  }
  const byLabel = (text: string) => tabs.find((t) => t.label && text.startsWith(t.label))?.key;
  for (const el of root.querySelectorAll<HTMLElement>('.rb-tablist [role="tab"]')) {
    const key = byLabel((el.textContent ?? '').trim());
    const tip = key ? TAB_TIPS[key] : undefined;
    if (tip) out.push({ el, tip });
  }
  return out;
}

/** 命令层：当前这一页里所有能点的控件。 */
function collectCmd(root: HTMLElement): Tip[] {
  const els = root.querySelectorAll<HTMLElement>('.rb-body button, .rb-body [role="combobox"], .rb-body [role="button"]');
  const picked: { el: HTMLElement; pref?: string }[] = [];
  const seen = new Set<HTMLElement>();
  for (const el of els) {
    if (seen.has(el) || el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') continue;
    if (el.querySelector('button, [role="button"], [role="combobox"]')) continue;
    seen.add(el);
    const name = labelOf(el);
    if (!name) continue;
    const pref = el.classList.contains('rb-font') ? 'FF' : el.classList.contains('rb-size') ? 'FS' : CMD_TIPS[name];
    picked.push({ el, pref });
  }
  const tips = assign(picked.map((p) => p.pref));
  return picked.map((p, i) => ({ el: p.el, tip: tips[i] }));
}

export function KeyTips<T extends string>({ root, tabs, tab, bodyVisible }: { root: RefObject<HTMLElement | null>; tabs: { key: T; label: string }[]; tab: T; bodyVisible: boolean }) {
  const [mode, setMode] = useState<'off' | 'tabs' | 'cmd'>('off');
  const [buffer, setBuffer] = useState('');
  const [top, setTop] = useState<Tip[]>([]);
  const [cmd, setCmd] = useState<Tip[]>([]);
  const [boxes, setBoxes] = useState<{ el: HTMLElement; text: string; left: number; top: number }[]>([]);
  const [tick, setTick] = useState(0);
  const altArmed = useRef(false);
  const tabList = useMemo(() => [...tabs], [tabs]);

  const close = () => { setMode('off'); setBuffer(''); altArmed.current = false; };

  // 收徽标：进根层收一次；切页后（抽屉也许刚 peek 开）再收命令。
  useEffect(() => {
    if (mode === 'off') { setTop([]); setCmd([]); return; }
    const el = root.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => {
      setTop(collectTop(el, tabList));
      setCmd(mode === 'cmd' && bodyVisible ? collectCmd(el) : []);
    });
    return () => cancelAnimationFrame(raf);
  }, [mode, tab, bodyVisible, tabList, root]);

  // 摆徽标（按钮左上角），滚动、尺寸变了重摆。
  useLayoutEffect(() => {
    if (mode === 'off' || !root.current) { setBoxes([]); return; }
    const rr = root.current.getBoundingClientRect();
    const pool = mode === 'tabs' ? top : cmd;
    const out: typeof boxes = [];
    const seen = new Set<HTMLElement>();
    for (const { el, tip } of pool) {
      if (!tip.startsWith(buffer) || seen.has(el) || !el.isConnected) continue;
      seen.add(el);
      const r = el.getBoundingClientRect();
      if (r.width < 1) continue;
      out.push({ el, text: tip.slice(buffer.length), left: r.left - rr.left - 4, top: Math.max(0, r.top - rr.top - 5) });
    }
    setBoxes((prev) => (prev.length === out.length && prev.every((p, i) => p.el === out[i].el && p.text === out[i].text && Math.abs(p.left - out[i].left) < 0.5 && Math.abs(p.top - out[i].top) < 0.5) ? prev : out));
  }, [mode, top, cmd, buffer, tick, root]);

  useEffect(() => {
    if (mode === 'off') return;
    const bump = () => setTick((n) => n + 1);
    window.addEventListener('resize', bump);
    window.addEventListener('scroll', bump, true);
    return () => { window.removeEventListener('resize', bump); window.removeEventListener('scroll', bump, true); };
  }, [mode]);

  // 键盘：Alt 亮出，字母逐层选，Esc 退一层；控制键的组合键都放走。
  useEffect(() => {
    const pool = mode === 'tabs' ? top : cmd;
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Alt') {
        if (mode === 'off') { if (!e.repeat) altArmed.current = !e.ctrlKey && !e.metaKey && !e.shiftKey; }
        else { e.preventDefault(); e.stopPropagation(); close(); }
        if (!e.ctrlKey && !e.metaKey && !e.shiftKey) e.preventDefault();
        return;
      }
      if (mode === 'off') { altArmed.current = false; return; }
      altArmed.current = false;
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        if (buffer) setBuffer('');
        else if (mode === 'cmd') setMode('tabs');
        else close();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1 || !/[a-z0-9]/i.test(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      const next = buffer + e.key.toUpperCase();
      const exact = pool.find((x) => x.tip === next);
      if (exact) {
        if (mode === 'tabs' && exact.el.getAttribute('role') === 'tab') { exact.el.click(); setMode('cmd'); setBuffer(''); }
        else { exact.el.click(); close(); }
      } else if (pool.some((x) => x.tip.startsWith(next))) setBuffer(next);
      else setBuffer('');
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key !== 'Alt') return;
      const armed = altArmed.current;
      altArmed.current = false;
      if (armed && mode === 'off') { e.preventDefault(); setMode('tabs'); }
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onUp, true);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('keyup', onUp, true); };
  }, [mode, top, cmd, buffer, close]);

  // 点别处退出（点在按钮上照常执行，徽标层自己不吃事件）。
  useEffect(() => {
    if (mode === 'off') return;
    const down = () => close();
    document.addEventListener('mousedown', down, true);
    return () => document.removeEventListener('mousedown', down, true);
  }, [mode]);

  if (mode === 'off') return null;
  return (
    <div className="rb-kt-layer" aria-hidden>
      {boxes.map((b) => <span key={`${b.left}-${b.top}-${b.text}`} className="rb-kt" style={{ left: b.left, top: b.top }}>{b.text}</span>)}
    </div>
  );
}
