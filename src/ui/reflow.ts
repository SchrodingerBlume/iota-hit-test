// 设置页那种表单，窗口拉窄、拖分隔条、某一行开关换档时，行会折行、后面的行整体下挪——
// 都是瞬间跳。这里盯着容器尺寸，每次重排后把动了的元素从旧位置 transform 滑到新位置（FLIP）。
// 旧位置记的是布局位置（offset 链，不受进行中的 transform 影响）；动画进行中又动了，
// 就从此刻画面上的位置接着滑，不回跳。横向随着拖动一起连续挪的那几像素不算「动了」。
// 只动 transform、不动尺寸：尺寸一动 ResizeObserver 又响，会自己追着自己转
const EASE = 'cubic-bezier(0.22, 0.75, 0.2, 1)';
type Tagged = Animation & { reflow?: boolean };

function layoutPos(el: HTMLElement): { x: number; y: number } {
  let x = 0, y = 0;
  for (let e: HTMLElement | null = el; e; e = e.offsetParent as HTMLElement | null) { x += e.offsetLeft; y += e.offsetTop; }
  return { x, y };
}

export function watchReflow(root: HTMLElement, selector: string): () => void {
  const last = new WeakMap<Element, { x: number; y: number }>();
  const measure = () => {
    const base = layoutPos(root);
    const out = new Map<HTMLElement, { x: number; y: number }>();
    for (const el of root.querySelectorAll<HTMLElement>(selector)) { const p = layoutPos(el); out.set(el, { x: p.x - base.x, y: p.y - base.y }); }
    return out;
  };
  let raf = 0;
  const run = () => {
    raf = 0;
    const now = measure();
    const old = new Map<HTMLElement, { x: number; y: number } | undefined>();
    for (const [el, p] of now) { old.set(el, last.get(el)); last.set(el, p); }
    // 先把要量的都量完再起动画：动画一起、后面量到的矩形就带着它了
    const rootRect = root.getBoundingClientRect();
    const rects = new Map<HTMLElement, DOMRect>();
    for (const el of now.keys()) rects.set(el, el.getBoundingClientRect());
    const plan: { el: HTMLElement; x: number; y: number }[] = [];
    for (const [el, p] of now) {
      const o = old.get(el);
      if (!o) continue;
      // 父子都在盯着时，子只算相对父的那一截，不然整行下挪、里面的字又叠一次；
      // 父正在滑，子的画面位置也要减掉父的 transform 才是自己的
      let anc: HTMLElement | null = el.parentElement;
      while (anc && anc !== root && !now.has(anc)) anc = anc.parentElement;
      const top = !anc || anc === root;
      const ap = top ? { x: 0, y: 0 } : now.get(anc!)!;
      const ao = top ? { x: 0, y: 0 } : old.get(anc!);
      if (!ao) continue;
      const dx = (o.x - ao.x) - (p.x - ap.x), dy = (o.y - ao.y) - (p.y - ap.y);
      if (Math.abs(dy) < 1 && Math.abs(dx) < 24) continue;
      // 正在滑的：从画面上此刻的位置接着来
      const r = rects.get(el)!, ar = top ? rootRect : rects.get(anc!)!;
      plan.push({ el, x: dx + (r.left - ar.left) - (p.x - ap.x), y: dy + (r.top - ar.top) - (p.y - ap.y) });
    }
    for (const { el, x, y } of plan) {
      for (const a of el.getAnimations() as Tagged[]) if (a.reflow) a.cancel();
      const anim: Tagged = el.animate([{ transform: `translate(${x}px, ${y}px)` }, { transform: 'none' }], { duration: 260, easing: EASE });
      anim.reflow = true;
    }
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(run); };
  for (const [el, p] of measure()) last.set(el, p);
  const ro = new ResizeObserver(kick);
  ro.observe(root);
  const mo = new MutationObserver(kick);
  mo.observe(root, { childList: true, subtree: true });
  return () => { ro.disconnect(); mo.disconnect(); cancelAnimationFrame(raf); };
}
