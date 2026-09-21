// 预览里等重排那一会儿的「就地挪字」：光标后面同一行的字形往右（左）挪出暂印那几个字的宽，删掉的字形当场藏起来
// ——Word 打字时后面的字是立刻让开的，先前只把暂印的字盖在原字上、删掉的用纸色遮，行中间打字就像把后面的字吃掉了。
// 改的都是展示层 SVG 上现成的 <use>（字形）与它上面那层 translate，记下原值，重排落地前（renderer 打补丁前）复原。
import type { CaretRect } from './previewEdit';

let patched: { el: Element; attr: string; value: string | null }[] = [];
const set = (el: Element, attr: string, value: string) => { patched.push({ el, attr, value: el.getAttribute(attr) }); el.setAttribute(attr, value); };

/** 复原（每次重算之前、渲染器打补丁之前都要调） */
export function restoreLineShift() {
  for (let i = patched.length - 1; i >= 0; i--) { const p = patched[i]; if (p.value === null) p.el.removeAttribute(p.attr); else p.el.setAttribute(p.attr, p.value); }
  patched = [];
}

/** 只认 translate / scale / matrix，从这一元素往上乘到 pageG 为止 */
function matrixTo(el: Element, pageG: Element): { a: number; d: number; e: number; f: number } {
  let a = 1, d = 1, e = 0, f = 0;
  for (let n: Element | null = el; n && n !== pageG; n = n.parentElement) {
    const tr = n.getAttribute('transform');
    if (!tr) continue;
    // 这一层的变换作用在里面已经算好的坐标上：x' = A·x + E
    let A = 1, D = 1, E = 0, F = 0;
    for (const m of tr.matchAll(/(translate|scale|matrix)\(([^)]*)\)/g)) {
      const v = m[2].split(/[\s,]+/).filter(Boolean).map(Number);
      if (m[1] === 'translate') { E += v[0] || 0; F += v[1] || 0; }
      else if (m[1] === 'scale') { A *= v[0] || 1; D *= v[1] ?? v[0] ?? 1; }
      else if (m[1] === 'matrix' && v.length === 6) { A *= v[0]; D *= v[3]; E += v[4]; F += v[5]; }
    }
    a *= A; d *= D; e = A * e + E; f = D * f + F;
  }
  return { a, d, e, f };
}

export interface LineShift<G extends { x: number; y: number; w: number; h: number }> {
  /** 光标所在行（页内坐标，pt）：行框上下沿、插入点 x */
  caret: CaretRect;
  /** 插入点后面的字形挪多少（pt，可负） */
  dx: number;
  /** 要藏起来的字形（左缘 x 与宽） */
  hide: G[];
}

/** 在展示层这一页上套一次；返回真藏起来了的那些（剩下的仍要用纸色遮） */
export function applyLineShift<G extends { x: number; y: number; w: number; h: number }>(pageG: SVGGElement, s: LineShift<G>): Set<G> {
  restoreLineShift();
  const hidden = new Set<G>();
  const y0 = s.caret.y - 0.5, y1 = s.caret.y + s.caret.h + 0.5;
  for (const run of pageG.querySelectorAll<SVGGElement>('g.typst-text')) {
    const M = matrixTo(run, pageG);
    if (M.f < y0 || M.f > y1 || !M.a) continue;
    const uses = [...run.querySelectorAll<SVGUseElement>(':scope > use')];
    if (!uses.length) continue;
    const xs = uses.map((u) => M.a * (parseFloat(u.getAttribute('x') ?? '0') || 0) + M.e);
    for (let i = 0; i < uses.length; i++) {
      const g = s.hide.find((h) => Math.abs(h.x - xs[i]) < 0.6 && M.f >= h.y - 0.5 && M.f <= h.y + h.h + 0.5);
      if (g) { set(uses[i], 'visibility', 'hidden'); hidden.add(g); }
    }
    if (!s.dx) continue;
    if (xs[0] >= s.caret.x - 0.5) {
      // 整段都在插入点之后：挪它上面那层 translate
      const holder = run.parentElement;
      const tr = holder?.getAttribute('transform') ?? '';
      const m = /translate\(([-\d.e]+)[\s,]+([-\d.e]+)\)/.exec(tr);
      if (holder && m) { set(holder, 'transform', tr.replace(m[0], `translate(${(+m[1] + s.dx).toFixed(3)},${m[2]})`)); continue; }
    }
    for (let i = 0; i < uses.length; i++) if (xs[i] >= s.caret.x - 0.5) set(uses[i], 'x', String((parseFloat(uses[i].getAttribute('x') ?? '0') || 0) + s.dx / M.a));
  }
  return hidden;
}
