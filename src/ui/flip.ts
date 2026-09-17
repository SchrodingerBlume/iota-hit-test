// 重排落地时的位移动画（FLIP：先记旧位置，补丁打完量新位置，反向平移再过渡回 0）。
//
// 增量补丁会把没变的文字块（<g class="typst-text">）原样复用，所以同一个 DOM 节点补丁前后
// 各量一次就知道它挪了多远：改了一个字，后面整段的行都顺着滑过去，而不是瞬间跳到新位置；
// 新出现的块淡入。只处理视口附近的页，别的页看不见，不必花这个功夫。
// SVG 元素的 translate 属性是用户单位，要按页的缩放比换算。

// 展示层的页是母本的克隆，补丁后节点会换，所以按「页序 + 文字块 tid + 同页第几次出现」记
const runs = new Map<string, { x: number; y: number }>();
function keysOf(g: SVGGElement, i: number): [SVGGElement, string][] {
  const seen = new Map<string, number>();
  return [...g.querySelectorAll<SVGGElement>('g.typst-text')].map((t) => { const tid = t.getAttribute('data-tid') ?? ''; const n = seen.get(tid) ?? 0; seen.set(tid, n + 1); return [t, `${i}:${tid}:${n}`]; });
}
let scaleOf = new Map<Element, number>();

function pagesNear(container: HTMLElement, viewportTop: number, viewportBottom: number): [SVGGElement, number][] {
  const groups = [...container.querySelectorAll<SVGGElement>(':scope > svg.typst-doc > g.typst-page')];
  return groups.map((g, i): [SVGGElement, number] => [g, i]).filter(([g]) => {
    if (g.getAttribute('data-shown') !== '1') return false;
    const m = g.getScreenCTM();
    if (!m) return false;
    const h = (parseFloat(g.getAttribute('data-page-height') ?? '0') || 0) * m.a;
    return m.f + h >= viewportTop - 200 && m.f <= viewportBottom + 200;
  });
}

let inflight: SVGGElement[] = [];
let cleanupTimer = 0;
/** 上一轮动画还没走完就来了新一轮：先让它们各就各位，量出来的才是真位置 */
function settleInflight() {
  window.clearTimeout(cleanupTimer);
  for (const el of inflight) { el.classList.remove('flip-move', 'flip-in'); el.style.translate = ''; el.style.opacity = ''; }
  inflight = [];
}

/** 补丁前：记下视口附近每个文字块的位置 */
export function flipBefore(container: HTMLElement, viewportTop: number, viewportBottom: number) {
  settleInflight();
  runs.clear();
  scaleOf = new Map();
  for (const [g, i] of pagesNear(container, viewportTop, viewportBottom)) {
    for (const [t, k] of keysOf(g, i)) {
      const r = t.getBoundingClientRect();
      runs.set(k, { x: r.left, y: r.top });
    }
  }
}

/** 补丁后：挪了的块从旧位置滑过来，新块淡入 */
export function flipAfter(container: HTMLElement, viewportTop: number, viewportBottom: number) {
  const moved: { el: SVGGElement; dx: number; dy: number }[] = [];
  const fresh: SVGGElement[] = [];
  for (const [g, i] of pagesNear(container, viewportTop, viewportBottom)) {
    const scale = g.getScreenCTM()?.a ?? 1;
    scaleOf.set(g, scale);
    for (const [t, k] of keysOf(g, i)) {
      const old = runs.get(k);
      if (!old) { fresh.push(t); continue; }
      const r = t.getBoundingClientRect();
      const dx = (old.x - r.left) / scale;
      const dy = (old.y - r.top) / scale;
      if (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05) moved.push({ el: t, dx, dy });
    }
  }
  runs.clear();
  if (!moved.length && !fresh.length) return;
  // 太多块一起动（整页重排）就别做了，动画本身会成负担
  if (moved.length > 80 || fresh.length > 180) return;
  for (const { el, dx, dy } of moved) {
    el.classList.remove('flip-move');
    el.style.translate = `${dx}px ${dy}px`;
  }
  for (const el of fresh) { el.classList.remove('flip-in'); el.style.opacity = '0'; }
  // 强制一次样式计算，让起点生效
  void container.offsetWidth;
  inflight = [...moved.map((m) => m.el), ...fresh];
  requestAnimationFrame(() => {
    for (const { el } of moved) { el.classList.add('flip-move'); el.style.translate = '0px 0px'; }
    for (const el of fresh) { el.classList.add('flip-in'); el.style.opacity = ''; }
    cleanupTimer = window.setTimeout(settleInflight, 180);
  });
}
