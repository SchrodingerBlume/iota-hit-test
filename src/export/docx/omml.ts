// MathML（MathLive 吐的那一档）→ Word 的 OMML。只认 MathLive 会产出的元素，不认识的当文字
const NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const BIG = new Set(['∑', '∏', '∫', '∬', '∭', '∮', '⋃', '⋂', '⋁', '⋀', '∐']);
const INVISIBLE = new Set(['⁡', '⁢', '⁣', '⁤']);
const ACCENT: Record<string, string> = { '^': '̂', 'ˆ': '̂', '¯': '̅', '‾': '̅', '⃗': '⃗', '→': '⃗', '˙': '̇', '¨': '̈', '~': '̃', '˜': '̃', 'ˇ': '̌', '´': '́', '`': '̀' };
const OPEN = new Set(['(', '[', '{', '|', '‖', '⟨', '⌊', '⌈']);
const CLOSE = new Set([')', ']', '}', '|', '‖', '⟩', '⌋', '⌉']);
/** 大算符的正身到哪为止：遇到关系号、加减、逗号就停（Word 里敲 ∑ 后面的那一串就是这么归的） */
const STOP = new Set(['=', '+', '−', '-', '±', '∓', '<', '>', '≤', '≥', '≠', '≈', '≡', '∈', '∉', '∝', '∼', '≃', '≅', ',', ';', '→', '⇒', '⟹', '⇔', '⟺', '∣', ':', '∪', '∩']);
/** MathLive 的 MathML 里夹着 HTML 的命名实体（`\ ` 出 &nbsp;），XML 不认 */
const ENTITIES: Record<string, string> = { nbsp: '#160', thinsp: '#8201', ensp: '#8194', emsp: '#8195', times: '#215', middot: '#183', hellip: '#8230', minus: '#8722', plusmn: '#177', deg: '#176', infin: '#8734', pi: '#960', alpha: '#945', beta: '#946', gamma: '#947', delta: '#948', epsilon: '#949', theta: '#952', lambda: '#955', mu: '#956', sigma: '#963', tau: '#964', phi: '#966', omega: '#969', cdot: '#8901', prime: '#8242' };
/** mathvariant → Word 的字体样式 / 字形 */
const STY: Record<string, string> = { bold: 'b', normal: 'p', 'bold-italic': 'bi', italic: 'i' };
const SCR: Record<string, string> = { 'double-struck': 'double-struck', script: 'script', 'bold-script': 'script', fraktur: 'fraktur', 'bold-fraktur': 'fraktur', 'sans-serif': 'sans-serif', 'bold-sans-serif': 'sans-serif', monospace: 'monospace' };

const run = (text: string, o: { upright?: boolean; variant?: string | null; nor?: boolean } = {}) => {
  if (!text) return '';
  const props = [o.nor ? '<m:nor/>' : '', o.variant && SCR[o.variant] ? `<m:scr m:val="${SCR[o.variant]}"/>` : '', o.variant && STY[o.variant] ? `<m:sty m:val="${STY[o.variant]}"/>` : o.upright ? '<m:sty m:val="p"/>' : ''].filter(Boolean).join('');
  return `<m:r>${props ? `<m:rPr>${props}</m:rPr>` : ''}<m:t xml:space="preserve">${esc(text)}</m:t></m:r>`;
};
const e = (inner: string) => `<m:e>${inner}</m:e>`;
/** 元素之间的文字节点：`\ ` 出来的是一个 &nbsp;，得留一个空格，别的空白扔掉 */
const textNode = (t: string) => { const s = t.replace(/[\s\u00a0]+/g, ' '); return run(s.trim() ? s.trim() : /\u00a0/.test(t) ? ' ' : ''); };
const isInvisible = (k: Element) => k.localName === 'mo' && INVISIBLE.has(k.textContent ?? '');
/** 结构元素的孩子：MathLive 会把隐形的函数应用号夹在 msub 的底与下标之间，去掉它再数位置 */
const kidsOf = (el: Element) => [...el.children].filter((k) => !isInvisible(k));
const bigBase = (el: Element) => { const b = kidsOf(el)[0]; return b?.localName === 'mo' && BIG.has(b.textContent ?? '') ? b.textContent! : null; };
const isNary = (k: Element) => (k.localName === 'mo' && BIG.has(k.textContent ?? '')) || (['msub', 'msup', 'msubsup', 'munder', 'mover', 'munderover'].includes(k.localName) && !!bigBase(k));
const isStop = (k: Element) => k.localName === 'mo' && STOP.has((k.textContent ?? '').trim());

/** 一串孩子顺着转；大算符把后面直到下一个关系号 / 加减号为止的那一段收进正身（不然 Word 画一个虚线空框） */
function children(el: Element): string {
  const nodes = [...el.childNodes];
  let out = '';
  for (let i = 0; i < nodes.length; i++) {
    const c = nodes[i];
    if (c.nodeType !== 1) { out += textNode(c.textContent ?? ''); continue; }
    const k = c as Element;
    if (isNary(k)) {
      let body = '';
      let j = i + 1;
      for (; j < nodes.length; j++) {
        const n = nodes[j];
        if (n.nodeType !== 1) { body += textNode(n.textContent ?? ''); continue; }
        if (isStop(n as Element)) break;
        body += conv(n as Element);
      }
      out += naryOf(k, body);
      i = j - 1;
      continue;
    }
    out += conv(k);
  }
  return out;
}

function naryOf(el: Element, body: string): string {
  const kids = kidsOf(el);
  const chr = (el.localName === 'mo' ? el.textContent : kids[0]?.textContent) ?? '∑';
  const tag = el.localName;
  const sub = tag === 'msub' || tag === 'msubsup' || tag === 'munder' || tag === 'munderover' ? conv(kids[1]) : '';
  const sup = tag === 'msup' || tag === 'mover' ? conv(kids[1]) : tag === 'msubsup' || tag === 'munderover' ? conv(kids[2]) : '';
  const loc = tag === 'munder' || tag === 'mover' || tag === 'munderover' ? 'undOvr' : 'subSup';
  return `<m:nary><m:naryPr><m:chr m:val="${esc(chr)}"/><m:limLoc m:val="${loc}"/>${sub ? '' : '<m:subHide m:val="1"/>'}${sup ? '' : '<m:supHide m:val="1"/>'}</m:naryPr><m:sub>${sub}</m:sub><m:sup>${sup}</m:sup>${e(body)}</m:nary>`;
}

function conv(el: Element | undefined): string {
  if (!el) return '';
  const tag = el.localName;
  // MathLive 认不得的命令吐 merror：整条当转换失败，让上层退回去画图
  if (tag === 'merror') throw new Error('unsupported LaTeX');
  const kids = kidsOf(el);
  const text = (el.textContent ?? '');
  const variant = el.getAttribute('mathvariant');
  switch (tag) {
    case 'math': case 'mrow': case 'mstyle': case 'semantics': case 'mpadded': case 'mphantom': {
      // 括号对：开头是开号、结尾是闭号 → m:d
      if (tag === 'mrow' && kids.length >= 2 && kids[0].localName === 'mo' && OPEN.has(kids[0].textContent ?? '') && kids[kids.length - 1].localName === 'mo' && CLOSE.has(kids[kids.length - 1].textContent ?? '')) {
        const beg = kids[0].textContent ?? '(', end = kids[kids.length - 1].textContent ?? ')';
        const wrap = document.createElementNS('http://www.w3.org/1998/Math/MathML', 'mrow');
        kids.slice(1, -1).forEach((k) => wrap.appendChild(k.cloneNode(true)));
        return `<m:d><m:dPr><m:begChr m:val="${esc(beg)}"/><m:endChr m:val="${esc(end)}"/></m:dPr>${e(children(wrap))}</m:d>`;
      }
      // 分段函数：一个左花括号带着一张单列的表 → Word 的方程组（eqArr），右边不封口
      if (tag === 'mrow' && kids.length === 2 && kids[0].localName === 'mo' && OPEN.has(kids[0].textContent ?? '') && kids[1].localName === 'mtable') {
        return `<m:d><m:dPr><m:begChr m:val="${esc(kids[0].textContent ?? '{')}"/><m:endChr m:val=""/></m:dPr>${e(eqArr(kids[1]))}</m:d>`;
      }
      return children(el);
    }
    case 'mi': return run(text, { upright: text.length > 1 && /^[A-Za-z]+$/.test(text), variant });
    case 'mn': return run(text, { variant });
    case 'mo': {
      if (INVISIBLE.has(text)) return '';
      const t = text === '\\|' ? '‖' : text === '\\{' ? '{' : text === '\\}' ? '}' : text;
      return run(t, { upright: /^[a-z]{2,}$/i.test(t), variant });
    }
    case 'mtext': return run(text, { nor: true });
    case 'mspace': return run(' ');
    case 'mfrac': return `<m:f>${el.getAttribute('linethickness') === '0' ? '<m:fPr><m:type m:val="noBar"/></m:fPr>' : ''}<m:num>${conv(kids[0])}</m:num><m:den>${conv(kids[1])}</m:den></m:f>`;
    case 'msqrt': return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/>${e(children(el))}</m:rad>`;
    case 'mroot': return `<m:rad><m:deg>${conv(kids[1])}</m:deg>${e(conv(kids[0]))}</m:rad>`;
    case 'msup': case 'msub': case 'msubsup': {
      if (bigBase(el)) return naryOf(el, '');
      const base = kids[0];
      const sub = tag === 'msup' ? '' : conv(kids[1]);
      const sup = tag === 'msub' ? '' : conv(kids[tag === 'msup' ? 1 : 2]);
      if (tag === 'msup') return `<m:sSup>${e(conv(base))}<m:sup>${sup}</m:sup></m:sSup>`;
      if (tag === 'msub') return `<m:sSub>${e(conv(base))}<m:sub>${sub}</m:sub></m:sSub>`;
      return `<m:sSubSup>${e(conv(base))}<m:sub>${sub}</m:sub><m:sup>${sup}</m:sup></m:sSubSup>`;
    }
    case 'munder': case 'mover': case 'munderover': {
      if (bigBase(el)) return naryOf(el, '');
      const base = kids[0];
      const under = tag === 'mover' ? '' : conv(kids[1]);
      const over = tag === 'munder' ? '' : conv(kids[tag === 'mover' ? 1 : 2]);
      if (tag === 'mover' && el.getAttribute('accent') === 'true') {
        const ch = kids[1]?.textContent ?? '';
        if (ch === '¯' || ch === '‾') return `<m:bar><m:barPr><m:pos m:val="top"/></m:barPr>${e(conv(base))}</m:bar>`;
        return `<m:acc><m:accPr><m:chr m:val="${esc(ACCENT[ch] ?? ch)}"/></m:accPr>${e(conv(base))}</m:acc>`;
      }
      if (tag === 'munder' && el.getAttribute('accentunder') === 'true' && (kids[1]?.textContent === '̲' || kids[1]?.textContent === '_')) return `<m:bar><m:barPr><m:pos m:val="bot"/></m:barPr>${e(conv(base))}</m:bar>`;
      if (tag === 'munder') return `<m:limLow>${e(conv(base))}<m:lim>${under}</m:lim></m:limLow>`;
      if (tag === 'mover') return `<m:limUpp>${e(conv(base))}<m:lim>${over}</m:lim></m:limUpp>`;
      return `<m:limUpp>${e(`<m:limLow>${e(conv(base))}<m:lim>${under}</m:lim></m:limLow>`)}<m:lim>${over}</m:lim></m:limUpp>`;
    }
    case 'mfenced': {
      const beg = el.getAttribute('open') ?? '(', end = el.getAttribute('close') ?? ')';
      return `<m:d><m:dPr><m:begChr m:val="${esc(beg)}"/><m:endChr m:val="${esc(end)}"/></m:dPr>${kids.map((k) => e(conv(k))).join('')}</m:d>`;
    }
    case 'mtable': {
      const rows = kids.filter((k) => k.localName === 'mtr' || k.localName === 'mlabeledtr');
      const cols = Math.max(1, ...rows.map((r) => r.children.length));
      if (cols === 1) return eqArr(el);
      const body = rows.map((r) => `<m:mr>${[...r.children].map((c) => e(children(c))).join('')}${'<m:e/>'.repeat(cols - r.children.length)}</m:mr>`).join('');
      return `<m:m><m:mPr><m:mcs><m:mc><m:mcPr><m:count m:val="${cols}"/><m:mcJc m:val="center"/></m:mcPr></m:mc></m:mcs></m:mPr>${body}</m:m>`;
    }
    case 'mtr': case 'mtd': return children(el);
    case 'menclose': return children(el);
    case 'mmultiscripts': {
      // 前置上下标（张量记法）：底、后置对、<mprescripts/>、前置对
      const at = kids.findIndex((k) => k.localName === 'mprescripts');
      const post = (at < 0 ? kids : kids.slice(0, at)).slice(1), pre = at < 0 ? [] : kids.slice(at + 1);
      const pairs = (list: Element[]) => { const out: string[] = []; for (let i = 0; i < list.length; i += 2) { const s = conv(list[i]), p = conv(list[i + 1]); out.push(`<m:sSubSup>${e('')}<m:sub>${s}</m:sub><m:sup>${p}</m:sup></m:sSubSup>`); } return out.join(''); };
      const postX = post.length ? `<m:sSubSup>${e(conv(kids[0]))}<m:sub>${conv(post[0])}</m:sub><m:sup>${conv(post[1])}</m:sup></m:sSubSup>` : conv(kids[0]);
      return pre.length ? `<m:sPre><m:sub>${conv(pre[0])}</m:sub><m:sup>${conv(pre[1])}</m:sup>${e(postX)}</m:sPre>${pairs(post.slice(2))}` : postX;
    }
    default: return kids.length ? children(el) : run(text);
  }
}

/** 单列的表（cases / aligned 的行）→ Word 的方程组：一行一个 m:e */
function eqArr(table: Element): string {
  const rows = kidsOf(table).filter((k) => k.localName === 'mtr' || k.localName === 'mlabeledtr');
  return `<m:eqArr>${rows.map((r) => e([...r.children].map((c) => children(c)).join(''))).join('')}</m:eqArr>`;
}

/** 一段 MathML → `<m:oMath>…</m:oMath>`；display 时包成 oMathPara（Word 的「显示公式」），
 *  number 是 Word 认的编号写法：公式末尾 `#(1-1)` 会被右对齐到行尾 */
export function mathmlToOmml(mathml: string, opts: { display?: boolean; number?: string } = {}): string {
  const src = mathml.replace(/^<math[^>]*>|<\/math>$/g, '').replace(/&([a-zA-Z]+);/g, (m, name) => (['lt', 'gt', 'amp', 'quot', 'apos'].includes(name) ? m : ENTITIES[name] ? `&${ENTITIES[name]};` : ' '));
  const doc = new DOMParser().parseFromString(`<math xmlns="http://www.w3.org/1998/Math/MathML">${src}</math>`, 'application/xml');
  const root = doc.documentElement;
  const bad = root.localName === 'parsererror' || !!doc.querySelector('parsererror');
  if (bad) throw new Error('bad MathML');
  const inner = conv(root);
  const math = `<m:oMath>${inner}${opts.number ? run(`#${opts.number}`) : ''}</m:oMath>`;
  if (!opts.display) return `<m:oMath xmlns:m="${NS}">${inner}</m:oMath>`;
  return `<m:oMathPara xmlns:m="${NS}"><m:oMathParaPr><m:jc m:val="center"/></m:oMathParaPr>${math}</m:oMathPara>`;
}
